import { getDatabase } from "@/db";
import { isIP } from "node:net";

const SESSION_COOKIE = "quiz_session";
const GUEST_COOKIE = "quiz_guest";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const GUEST_TTL_SECONDS = 60 * 60 * 24 * 180;
const PASSWORD_ITERATIONS = 120_000;
const SESSION_LOOKUP_CACHE_SECONDS = 10;
const VALID_DATA_KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

type AccountUser = {
  id: string;
  username: string | null;
  displayName: string;
  accountType: "registered" | "guest";
  role: "user" | "admin";
};
type LoginRow = AccountUser & { passwordHash: string; status: "active" | "disabled" };
type SqlParameter = string | number | boolean | null;

let schemaReady: Promise<void> | null = null;
const sessionUserCache = new Map<string, { user: AccountUser; validUntil: number }>();
const sessionUserRequests = new Map<string, Promise<AccountUser | null>>();

async function rows<T extends Record<string, unknown>>(statement: string, params: SqlParameter[] = []): Promise<T[]> {
  const result = await getDatabase().query<T>(statement, params);
  return result.rows;
}

async function execute(statement: string, params: SqlParameter[] = []): Promise<void> {
  await getDatabase().query(statement, params);
}

async function ensureAccountSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await execute(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, account_type TEXT NOT NULL,
        guest_credential_hash TEXT, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active', last_login_at BIGINT, login_count BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
      )`);
      await execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'");
      await execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'");
      await execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at BIGINT");
      await execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count BIGINT NOT NULL DEFAULT 0");
      await execute("UPDATE users SET display_name = username WHERE account_type = 'registered' AND username IS NOT NULL AND display_name <> username");
      await execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username)");
      await execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_guest_credential ON users (guest_credential_hash)");
      await execute(`CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL
      )`);
      await execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id)");
      await execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions (expires_at)");
      await execute(`CREATE TABLE IF NOT EXISTS login_events (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip_address TEXT NOT NULL, created_at BIGINT NOT NULL
      )`);
      await execute("CREATE INDEX IF NOT EXISTS idx_login_events_user_created_at ON login_events (user_id, created_at DESC)");
      await execute(`CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data_key TEXT NOT NULL,
        payload TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await execute(`CREATE TABLE IF NOT EXISTS history_records (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_key TEXT NOT NULL, record_type TEXT NOT NULL, quiz_kind TEXT NOT NULL, source TEXT NOT NULL,
        correct BOOLEAN, payload TEXT NOT NULL, created_at BIGINT NOT NULL
      )`);
      await execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_history_user_client_key ON history_records (user_id, client_key)");
      await execute("CREATE INDEX IF NOT EXISTS idx_history_user_created_at ON history_records (user_id, created_at)");
      await execute("CREATE INDEX IF NOT EXISTS idx_history_user_type_correct ON history_records (user_id, record_type, correct)");
      await execute(`CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at BIGINT NOT NULL
      )`);
      await execute(`CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY, admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        action TEXT NOT NULL, target_user_id TEXT, details TEXT NOT NULL, created_at BIGINT NOT NULL
      )`);
      await execute("CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs (created_at)");
      await execute(`INSERT INTO app_settings (setting_key, setting_value, updated_at)
        VALUES ('registration_enabled', 'true', $1) ON CONFLICT (setting_key) DO NOTHING`, [Math.floor(Date.now() / 1000)]);
      const adminUsername = process.env.CHEMQUIZ_ADMIN_USERNAME?.trim().toLowerCase() ?? "";
      const adminPassword = process.env.CHEMQUIZ_ADMIN_PASSWORD ?? "";
      if (adminUsername && adminPassword.length >= 12 && /^[a-z0-9_\-.]{3,32}$/.test(adminUsername)) {
        const existingAdmin = await rows<{ role: string }>("SELECT role FROM users WHERE username = $1", [adminUsername]);
        if (!existingAdmin[0]) {
          const now = Math.floor(Date.now() / 1000);
          await execute(`INSERT INTO users
            (id, username, password_hash, account_type, display_name, role, status, created_at, updated_at)
            VALUES ($1, $2, $3, 'registered', $4, 'admin', 'active', $5, $6)
            ON CONFLICT (username) DO NOTHING`,
          [crypto.randomUUID(), adminUsername, await hashPassword(adminPassword), adminUsername, now, now]);
        } else if (existingAdmin[0].role !== "admin") {
          console.error("CHEMQUIZ_ADMIN_USERNAME conflicts with an existing non-admin account.");
        }
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function randomToken(length = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(length)));
}

async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, expectedText] = encoded.split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 1 || !saltText || !expectedText) return false;
  const expected = fromBase64Url(expectedText);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = fromBase64Url(saltText).slice().buffer as ArrayBuffer;
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, expected.length * 8));
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.min(actual.length, expected.length); index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

function cookies(request: Request): Record<string, string> {
  return Object.fromEntries((request.headers.get("cookie") ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    return separator < 0 ? [] : [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  }));
}

function externalOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? forwardedProtocol : null;
  return host && protocol ? `${protocol}://${host}` : new URL(request.url).origin;
}

function setCookie(name: string, value: string, request: Request, maxAge: number): string {
  const secure = externalOrigin(request).startsWith("https://") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function jsonError(error: string, status: number): Response { return Response.json({ error }, { status }); }
function jsonUser(user: AccountUser, status = 200): Response { return Response.json({ user }, { status }); }
function sameOrigin(request: Request): boolean { const origin = request.headers.get("origin"); return !origin || origin === externalOrigin(request); }

function normalizeIpAddress(value: string | null): string | null {
  if (!value) return null;
  let candidate = value.trim();
  if (candidate.startsWith("[") && candidate.includes("]")) candidate = candidate.slice(1, candidate.indexOf("]"));
  if (candidate.toLowerCase().startsWith("::ffff:") && isIP(candidate.slice(7)) === 4) candidate = candidate.slice(7);
  return isIP(candidate) ? candidate : null;
}

function loginIpAddress(request: Request): string {
  if (!["1", "true"].includes(process.env.CHEMQUIZ_TRUST_PROXY?.trim().toLowerCase() ?? "")) return "unknown";
  const realIp = normalizeIpAddress(request.headers.get("x-real-ip"));
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1) ?? null;
  return normalizeIpAddress(forwarded) ?? "unknown";
}

async function currentUser(request: Request): Promise<AccountUser | null> {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const cached = sessionUserCache.get(tokenHash);
  if (cached?.validUntil && cached.validUntil > now) return cached.user;
  sessionUserCache.delete(tokenHash);
  const inFlight = sessionUserRequests.get(tokenHash);
  if (inFlight) return inFlight;
  const lookup = (async () => {
    const result = await rows<AccountUser & { sessionExpiresAt: string | number }>(
      `SELECT users.id, users.username, users.display_name AS "displayName", users.account_type AS "accountType", users.role,
        auth_sessions.expires_at AS "sessionExpiresAt"
       FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = $1 AND auth_sessions.expires_at > $2 AND users.status = 'active'`,
      [tokenHash, now],
    );
    const row = result[0];
    if (!row) return null;
    const user: AccountUser = { id: row.id, username: row.username, displayName: row.displayName, accountType: row.accountType, role: row.role };
    sessionUserCache.set(tokenHash, { user, validUntil: Math.min(Number(row.sessionExpiresAt), now + SESSION_LOOKUP_CACHE_SECONDS) });
    return user;
  })().finally(() => sessionUserRequests.delete(tokenHash));
  sessionUserRequests.set(tokenHash, lookup);
  return lookup;
}

function clearUserSessionCache(userId: string): void {
  for (const [tokenHash, cached] of sessionUserCache) {
    if (cached.user.id === userId) sessionUserCache.delete(tokenHash);
  }
}

async function createSession(userId: string, request: Request): Promise<string> {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await execute("INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
    [await sha256(token), userId, now + SESSION_TTL_SECONDS, now]);
  await execute("INSERT INTO login_events (id, user_id, ip_address, created_at) VALUES ($1, $2, $3, $4)",
    [crypto.randomUUID(), userId, loginIpAddress(request), now]);
  return token;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  return await request.json().catch(() => ({})) as Record<string, unknown>;
}

async function register(request: Request): Promise<Response> {
  const body = await readBody(request);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-z0-9_\-.]{3,32}$/.test(username)) return jsonError("用户名需为 3–32 位字母、数字、点、横线或下划线", 400);
  if (password.length < 8 || password.length > 128) return jsonError("密码长度需为 8–128 位", 400);
  const registration = await rows<{ enabled: string }>(
    "SELECT setting_value AS enabled FROM app_settings WHERE setting_key = 'registration_enabled'",
  );
  if (registration[0]?.enabled === "false") return jsonError("管理员已暂停新账户注册", 403);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    await execute(`INSERT INTO users (id, username, password_hash, account_type, display_name, last_login_at, login_count, created_at, updated_at)
      VALUES ($1, $2, $3, 'registered', $4, $5, 1, $6, $7)`, [id, username, await hashPassword(password), username, now, now, now]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return jsonError("该用户名已被使用", 409);
    throw error;
  }
  const user: AccountUser = { id, username, displayName: username, accountType: "registered", role: "user" };
  const response = jsonUser(user, 201);
  response.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, await createSession(id, request), request, SESSION_TTL_SECONDS));
  return response;
}

async function login(request: Request): Promise<Response> {
  const body = await readBody(request);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const result = await rows<LoginRow>(`SELECT id, username, display_name AS "displayName", account_type AS "accountType",
    password_hash AS "passwordHash", role, status FROM users WHERE username = $1 AND account_type = 'registered'`, [username]);
  const row = result[0];
  if (!row || !await verifyPassword(password, row.passwordHash)) return jsonError("用户名或密码不正确", 401);
  if (row.status !== "active") return jsonError("该账户已被管理员停用", 403);
  const user: AccountUser = { id: row.id, username: row.username, displayName: row.displayName, accountType: row.accountType, role: row.role };
  const now = Math.floor(Date.now() / 1000);
  await execute("UPDATE users SET last_login_at = $1, login_count = login_count + 1, updated_at = $1 WHERE id = $2", [now, user.id]);
  const response = jsonUser(user);
  response.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, await createSession(user.id, request), request, SESSION_TTL_SECONDS));
  return response;
}

async function guest(request: Request): Promise<Response> {
  let credential = cookies(request)[GUEST_COOKIE];
  let user: AccountUser | null = null;
  if (credential) {
    const result = await rows<AccountUser>(`SELECT id, username, display_name AS "displayName", account_type AS "accountType", role
      FROM users WHERE guest_credential_hash = $1 AND account_type = 'guest' AND status = 'active'`, [await sha256(credential)]);
    user = result[0] ?? null;
  }
  if (!user) {
    credential = randomToken();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const displayName = `游客 ${id.slice(0, 6)}`;
    await execute(`INSERT INTO users (id, account_type, guest_credential_hash, display_name, created_at, updated_at)
      VALUES ($1, 'guest', $2, $3, $4, $5)`, [id, await sha256(credential), displayName, now, now]);
    user = { id, username: null, displayName, accountType: "guest", role: "user" };
  }
  const guestLoginAt = Math.floor(Date.now() / 1000);
  await execute("UPDATE users SET last_login_at = $1, login_count = login_count + 1, updated_at = $1 WHERE id = $2", [guestLoginAt, user.id]);
  const response = jsonUser(user, 201);
  response.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, await createSession(user.id, request), request, SESSION_TTL_SECONDS));
  response.headers.append("Set-Cookie", setCookie(GUEST_COOKIE, credential, request, GUEST_TTL_SECONDS));
  return response;
}

async function userData(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user) return jsonError("未登录", 401);
  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  if (!VALID_DATA_KEY.test(key)) return jsonError("数据键无效", 400);
  if (request.method === "GET") {
    const result = await rows<{ payload: string; updatedAt: string | number }>(
      `SELECT payload, updated_at AS "updatedAt" FROM user_data WHERE user_id = $1 AND data_key = $2`, [user.id, key]);
    const row = result[0];
    return Response.json(row ? { value: JSON.parse(row.payload), updatedAt: Number(row.updatedAt) } : { value: null });
  }
  if (request.method === "DELETE") {
    await execute("DELETE FROM user_data WHERE user_id = $1 AND data_key = $2", [user.id, key]);
    return new Response(null, { status: 204 });
  }
  const body = await readBody(request);
  if (!("value" in body)) return jsonError("缺少 value", 400);
  const payload = JSON.stringify(body.value);
  if (new TextEncoder().encode(payload).byteLength > 2_000_000) return jsonError("账户数据超过 2 MB 限制", 413);
  const now = Math.floor(Date.now() / 1000);
  await execute(`INSERT INTO user_data (user_id, data_key, payload, updated_at) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, data_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
  [user.id, key, payload, now]);
  return Response.json({ saved: true, updatedAt: now });
}

async function history(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user) return jsonError("未登录", 401);
  if (request.method === "GET") {
    const result = await rows<Record<string, unknown>>(`SELECT id, client_key AS "clientKey", record_type AS "recordType",
      quiz_kind AS "quizKind", source, correct, payload, created_at AS "createdAt"
      FROM history_records WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`, [user.id]);
    return Response.json({ records: result.map((row) => ({
      ...row,
      createdAt: Number(row.createdAt),
      correct: row.correct === null ? null : Boolean(row.correct),
      payload: JSON.parse(String(row.payload)),
    })) });
  }
  if (request.method === "DELETE") {
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get("all") === "true") {
      await execute("DELETE FROM history_records WHERE user_id = $1", [user.id]);
      return new Response(null, { status: 204 });
    }
    const id = searchParams.get("id") ?? "";
    if (!id) return jsonError("缺少记录 ID", 400);
    await execute("DELETE FROM history_records WHERE id = $1 AND user_id = $2", [id, user.id]);
    return new Response(null, { status: 204 });
  }
  const body = await readBody(request);
  const records = Array.isArray(body.records) ? body.records : [];
  if (!records.length || records.length > 200) return jsonError("历史记录数量无效", 400);
  const now = Math.floor(Date.now() / 1000);
  const values: SqlParameter[] = [];
  const placeholders: string[] = [];
  for (const value of records) {
    if (!value || typeof value !== "object") return jsonError("历史记录格式无效", 400);
    const record = value as Record<string, unknown>;
    const clientKey = typeof record.clientKey === "string" ? record.clientKey.slice(0, 160) : "";
    const recordType = record.recordType === "exam" || record.recordType === "practice" ? record.recordType : null;
    const quizKind = record.quizKind === "color" || record.quizKind === "equation" || record.quizKind === "unified" ? record.quizKind : null;
    const source = record.source === "exam" || record.source === "practice" ? record.source : null;
    const payload = JSON.stringify(record.payload ?? null);
    if (!clientKey || !recordType || !quizKind || !source || payload.length > 1_500_000) return jsonError("历史记录格式无效", 400);
    const offset = values.length;
    placeholders.push(`(${Array.from({ length: 9 }, (_, index) => `$${offset + index + 1}`).join(", ")})`);
    values.push(crypto.randomUUID(), user.id, clientKey, recordType, quizKind, source,
      typeof record.correct === "boolean" ? record.correct : null, payload,
      typeof record.createdAt === "number" ? Math.floor(record.createdAt) : now);
  }
  await execute(`INSERT INTO history_records
    (id, user_id, client_key, record_type, quiz_kind, source, correct, payload, created_at)
    VALUES ${placeholders.join(", ")} ON CONFLICT (user_id, client_key) DO NOTHING`, values);
  return Response.json({ saved: records.length }, { status: 201 });
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

async function requireAdmin(request: Request): Promise<AccountUser | Response> {
  const user = await currentUser(request);
  if (!user) return jsonError("未登录", 401);
  if (user.role !== "admin") return jsonError("需要管理员权限", 403);
  return user;
}

async function audit(adminId: string, action: string, targetUserId: string | null, details: Record<string, unknown> = {}): Promise<void> {
  await execute(`INSERT INTO admin_audit_logs (id, admin_user_id, action, target_user_id, details, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)`,
  [crypto.randomUUID(), adminId, action, targetUserId, JSON.stringify(details), Math.floor(Date.now() / 1000)]);
}

async function adminOverview(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const accountType = url.searchParams.get("accountType");
  const status = url.searchParams.get("status");
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = 50;
  const filters: string[] = [];
  const params: SqlParameter[] = [];
  if (query) {
    params.push(`%${query}%`);
    filters.push(`(LOWER(COALESCE(u.username, '')) LIKE $${params.length} OR LOWER(u.display_name) LIKE $${params.length} OR LOWER(u.id) LIKE $${params.length})`);
  }
  if (accountType === "registered" || accountType === "guest") {
    params.push(accountType);
    filters.push(`u.account_type = $${params.length}`);
  }
  if (status === "active" || status === "disabled") {
    params.push(status);
    filters.push(`u.status = $${params.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  params.push(limit, (page - 1) * limit);
  const userRowsPromise = rows<Record<string, unknown>>(`
    SELECT u.id, u.username, u.display_name AS "displayName", u.account_type AS "accountType", u.role, u.status,
      u.created_at AS "createdAt", u.updated_at AS "updatedAt", u.last_login_at AS "lastLoginAt", u.login_count AS "loginCount",
      (SELECT le.ip_address FROM login_events le WHERE le.user_id = u.id ORDER BY le.created_at DESC LIMIT 1) AS "lastLoginIp",
      COUNT(*) OVER() AS "filteredCount",
      COUNT(DISTINCT CASE WHEN s.expires_at > EXTRACT(EPOCH FROM NOW())::bigint THEN s.token_hash END) AS "activeSessions",
      COUNT(DISTINCT h.id) AS "answerCount",
      COUNT(DISTINCT CASE WHEN h.correct = true THEN h.id END) AS "correctCount",
      MAX(h.created_at) AS "lastAnswerAt"
    FROM users u
    LEFT JOIN auth_sessions s ON s.user_id = u.id
    LEFT JOIN history_records h ON h.user_id = u.id
    ${where}
    GROUP BY u.id
    ORDER BY COALESCE(u.last_login_at, u.created_at) DESC, u.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const summaryRowsPromise = rows<Record<string, unknown>>(`SELECT
    COUNT(*) AS "totalUsers",
    COUNT(*) FILTER (WHERE account_type = 'registered') AS "registeredUsers",
    COUNT(*) FILTER (WHERE account_type = 'guest') AS "guestUsers",
    COUNT(*) FILTER (WHERE status = 'disabled') AS "disabledUsers",
    COUNT(*) FILTER (WHERE last_login_at >= $1) AS "activeToday"
    FROM users`, [Math.floor(Date.now() / 1000) - 86400]);
  const answerRowsPromise = rows<Record<string, unknown>>(`SELECT COUNT(*) AS "totalAnswers",
    COUNT(*) FILTER (WHERE correct = true) AS "correctAnswers" FROM history_records`);
  const [userRows, summaryRows, answerRows] = await Promise.all([userRowsPromise, summaryRowsPromise, answerRowsPromise]);
  const normalizedUsers = userRows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    ["createdAt", "updatedAt", "lastLoginAt", "loginCount", "filteredCount", "activeSessions", "answerCount", "correctCount", "lastAnswerAt"].includes(key)
      ? (value === null ? null : Number(value)) : value,
  ])));
  const numberObject = (row: Record<string, unknown> | undefined) => Object.fromEntries(
    Object.entries(row ?? {}).map(([key, value]) => [key, Number(value ?? 0)]),
  );
  return Response.json({
    users: normalizedUsers,
    page,
    pageSize: limit,
    filteredCount: Number(userRows[0]?.filteredCount ?? 0),
    summary: { ...numberObject(summaryRows[0]), ...numberObject(answerRows[0]) },
  });
}

async function adminUserDetail(request: Request): Promise<Response> {
  const userId = new URL(request.url).searchParams.get("userId") ?? "";
  if (!userId) return jsonError("缺少账户 ID", 400);
  const userRows = await rows<Record<string, unknown>>(`SELECT id, username, display_name AS "displayName",
    account_type AS "accountType", role, status, created_at AS "createdAt", updated_at AS "updatedAt",
    last_login_at AS "lastLoginAt", login_count AS "loginCount" FROM users WHERE id = $1`, [userId]);
  if (!userRows[0]) return jsonError("账户不存在", 404);
  const user = Object.fromEntries(Object.entries(userRows[0]).map(([key, value]) => [key,
    ["createdAt", "updatedAt", "lastLoginAt", "loginCount"].includes(key) && value !== null ? Number(value) : value]));
  return Response.json({ user });
}

async function adminCreateUser(request: Request, admin: AccountUser): Promise<Response> {
  const body = await readBody(request);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-z0-9_\-.]{3,32}$/.test(username)) return jsonError("用户名格式无效", 400);
  if (password.length < 8 || password.length > 128) return jsonError("密码长度需为 8–128 位", 400);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    await execute(`INSERT INTO users (id, username, password_hash, account_type, display_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'registered', $2, 'user', 'active', $4, $5)`,
    [id, username, await hashPassword(password), now, now]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return jsonError("该用户名已被使用", 409);
    throw error;
  }
  await audit(admin.id, "user.create", id, { username });
  return Response.json({ id }, { status: 201 });
}

async function adminUpdateUser(request: Request, admin: AccountUser): Promise<Response> {
  const userId = new URL(request.url).searchParams.get("userId") ?? "";
  if (!userId) return jsonError("缺少账户 ID", 400);
  const existingRows = await rows<{ accountType: "registered" | "guest" }>(
    `SELECT account_type AS "accountType" FROM users WHERE id = $1`, [userId]);
  const existing = existingRows[0];
  if (!existing) return jsonError("账户不存在", 404);
  const body = await readBody(request);
  const updates: string[] = [];
  const params: SqlParameter[] = [];
  const details: Record<string, unknown> = {};
  const push = (column: string, value: SqlParameter) => { params.push(value); updates.push(`${column} = $${params.length}`); };
  if (body.username !== undefined) {
    if (existing.accountType !== "registered") return jsonError("游客账户没有用户名", 400);
    const value = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9_\-.]{3,32}$/.test(value)) return jsonError("用户名格式无效", 400);
    push("username", value);
    push("display_name", value);
    details.username = value;
  }
  if (body.status === "active" || body.status === "disabled") {
    if (userId === admin.id && body.status !== "active") return jsonError("不能停用自己的账户", 400);
    push("status", body.status); details.status = body.status;
  }
  if (typeof body.password === "string" && body.password) {
    if (existing.accountType !== "registered") return jsonError("游客账户不能设置密码", 400);
    if (body.password.length < 8 || body.password.length > 128) return jsonError("密码长度需为 8–128 位", 400);
    push("password_hash", await hashPassword(body.password)); details.passwordReset = true;
  }
  if (!updates.length) return jsonError("没有可更新的字段", 400);
  params.push(Math.floor(Date.now() / 1000));
  updates.push(`updated_at = $${params.length}`);
  params.push(userId);
  try { await execute(`UPDATE users SET ${updates.join(", ")} WHERE id = $${params.length}`, params); }
  catch (error) {
    if ((error as { code?: string }).code === "23505") return jsonError("该用户名已被使用", 409);
    throw error;
  }
  clearUserSessionCache(userId);
  if (body.status === "disabled" || (typeof body.password === "string" && body.password)) {
    await execute("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
  }
  await audit(admin.id, "user.update", userId, details);
  return Response.json({ saved: true });
}

async function adminDeleteUser(request: Request, admin: AccountUser): Promise<Response> {
  const userId = new URL(request.url).searchParams.get("userId") ?? "";
  if (!userId) return jsonError("缺少账户 ID", 400);
  if (userId === admin.id) return jsonError("不能删除自己的管理员账户", 400);
  const deleted = await rows<{ id: string }>("DELETE FROM users WHERE id = $1 RETURNING id", [userId]);
  if (!deleted[0]) return jsonError("账户不存在", 404);
  clearUserSessionCache(userId);
  await audit(admin.id, "user.delete", userId);
  return new Response(null, { status: 204 });
}

async function adminUserData(request: Request, admin: AccountUser): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? "";
  const key = url.searchParams.get("key")?.trim() ?? "";
  if (!userId) return jsonError("缺少账户 ID", 400);
  if (request.method === "GET") {
    if (!key) {
      const result = await rows<Record<string, unknown>>(`SELECT data_key AS "dataKey", updated_at AS "updatedAt",
        OCTET_LENGTH(payload) AS "sizeBytes" FROM user_data WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]);
      return Response.json({ data: result.map((row) => ({ ...row, updatedAt: Number(row.updatedAt), sizeBytes: Number(row.sizeBytes) })) });
    }
    if (!VALID_DATA_KEY.test(key)) return jsonError("数据键无效", 400);
    const result = await rows<Record<string, unknown>>(`SELECT payload, updated_at AS "updatedAt"
      FROM user_data WHERE user_id = $1 AND data_key = $2`, [userId, key]);
    if (!result[0]) return jsonError("数据项不存在", 404);
    return Response.json({ value: parseJson(result[0].payload), updatedAt: Number(result[0].updatedAt) });
  }
  if (!VALID_DATA_KEY.test(key)) return jsonError("数据键无效", 400);
  if (request.method === "DELETE") {
    await execute("DELETE FROM user_data WHERE user_id = $1 AND data_key = $2", [userId, key]);
    await audit(admin.id, "data.delete", userId, { key });
    return new Response(null, { status: 204 });
  }
  const body = await readBody(request);
  if (!("value" in body)) return jsonError("缺少 value", 400);
  const payload = JSON.stringify(body.value);
  if (new TextEncoder().encode(payload).byteLength > 2_000_000) return jsonError("账户数据超过 2 MB 限制", 413);
  const now = Math.floor(Date.now() / 1000);
  await execute(`INSERT INTO user_data (user_id, data_key, payload, updated_at) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, data_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
  [userId, key, payload, now]);
  await audit(admin.id, "data.update", userId, { key });
  return Response.json({ saved: true, updatedAt: now });
}

async function adminHistory(request: Request, admin: AccountUser): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!userId) return jsonError("缺少账户 ID", 400);
  if (request.method === "GET") {
    if (!id) {
      const result = await rows<Record<string, unknown>>(`SELECT id, client_key AS "clientKey", record_type AS "recordType",
        quiz_kind AS "quizKind", source, correct, created_at AS "createdAt", OCTET_LENGTH(payload) AS "sizeBytes"
        FROM history_records WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [userId]);
      return Response.json({ history: result.map((row) => ({ ...row, createdAt: Number(row.createdAt), sizeBytes: Number(row.sizeBytes) })) });
    }
    const result = await rows<Record<string, unknown>>(`SELECT payload, correct FROM history_records
      WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!result[0]) return jsonError("答题记录不存在", 404);
    return Response.json({ payload: parseJson(result[0].payload), correct: result[0].correct });
  }
  if (!id) return jsonError("缺少记录 ID", 400);
  if (request.method === "DELETE") {
    await execute("DELETE FROM history_records WHERE id = $1 AND user_id = $2", [id, userId]);
    await audit(admin.id, "history.delete", userId, { id });
    return new Response(null, { status: 204 });
  }
  const body = await readBody(request);
  const updates: string[] = [];
  const params: SqlParameter[] = [];
  if (body.correct === true || body.correct === false || body.correct === null) {
    params.push(body.correct); updates.push(`correct = $${params.length}`);
  }
  if ("payload" in body) {
    const payload = JSON.stringify(body.payload);
    if (payload.length > 1_500_000) return jsonError("答题记录超过大小限制", 413);
    params.push(payload); updates.push(`payload = $${params.length}`);
  }
  if (!updates.length) return jsonError("没有可更新的字段", 400);
  params.push(id, userId);
  await execute(`UPDATE history_records SET ${updates.join(", ")} WHERE id = $${params.length - 1} AND user_id = $${params.length}`, params);
  await audit(admin.id, "history.update", userId, { id });
  return Response.json({ saved: true });
}

async function adminSessions(request: Request): Promise<Response> {
  const userId = new URL(request.url).searchParams.get("userId") ?? "";
  if (!userId) return jsonError("缺少账户 ID", 400);
  const result = await rows<Record<string, unknown>>(`SELECT created_at AS "createdAt", expires_at AS "expiresAt",
    (expires_at > $2) AS active FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
  [userId, Math.floor(Date.now() / 1000)]);
  return Response.json({ sessions: result.map((row) => ({ ...row, createdAt: Number(row.createdAt), expiresAt: Number(row.expiresAt) })) });
}

async function adminRelated(request: Request): Promise<Response> {
  const userId = new URL(request.url).searchParams.get("userId") ?? "";
  if (!userId) return jsonError("缺少账户 ID", 400);
  const result = await rows<Record<string, unknown>>(`SELECT
    COALESCE((SELECT JSON_AGG(item) FROM (
      SELECT data_key AS "dataKey", updated_at AS "updatedAt", OCTET_LENGTH(payload) AS "sizeBytes"
      FROM user_data WHERE user_id = $1 ORDER BY updated_at DESC
    ) item), '[]'::json) AS data,
    COALESCE((SELECT JSON_AGG(item) FROM (
      SELECT id, client_key AS "clientKey", record_type AS "recordType", quiz_kind AS "quizKind", source, correct,
        created_at AS "createdAt", OCTET_LENGTH(payload) AS "sizeBytes"
      FROM history_records WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200
    ) item), '[]'::json) AS history,
    COALESCE((SELECT JSON_AGG(item) FROM (
      SELECT created_at AS "createdAt", expires_at AS "expiresAt", (expires_at > $2) AS active
      FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30
    ) item), '[]'::json) AS sessions,
    COALESCE((SELECT JSON_AGG(item) FROM (
      SELECT ip_address AS "ipAddress", created_at AS "createdAt"
      FROM login_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100
    ) item), '[]'::json) AS logins`, [userId, Math.floor(Date.now() / 1000)]);
  const row = result[0] ?? {};
  const normalize = (value: unknown, numericKeys: string[]) => (Array.isArray(value) ? value : []).map((item) =>
    Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, entry]) => [
      key, numericKeys.includes(key) ? Number(entry) : entry,
    ])));
  return Response.json({
    data: normalize(row.data, ["updatedAt", "sizeBytes"]),
    history: normalize(row.history, ["createdAt", "sizeBytes"]),
    sessions: normalize(row.sessions, ["createdAt", "expiresAt"]),
    logins: normalize(row.logins, ["createdAt"]),
  });
}

async function adminSettings(request: Request, admin: AccountUser): Promise<Response> {
  if (request.method === "GET") {
    const result = await rows<{ value: string }>(
      "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'registration_enabled'",
    );
    return Response.json({ registrationEnabled: result[0]?.value !== "false" });
  }
  const body = await readBody(request);
  if (typeof body.registrationEnabled !== "boolean") return jsonError("注册设置无效", 400);
  const now = Math.floor(Date.now() / 1000);
  await execute(`INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES ('registration_enabled', $1, $2)
    ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = EXCLUDED.updated_at`,
  [String(body.registrationEnabled), now]);
  await audit(admin.id, "settings.registration", null, { registrationEnabled: body.registrationEnabled });
  return Response.json({ registrationEnabled: body.registrationEnabled });
}

async function handleAdminApi(request: Request, path: string): Promise<Response> {
  const authorization = await requireAdmin(request);
  if (authorization instanceof Response) return authorization;
  if (path === "/api/admin/overview" && request.method === "GET") return adminOverview(request);
  if (path === "/api/admin/user" && request.method === "GET") return adminUserDetail(request);
  if (path === "/api/admin/users" && request.method === "POST") return adminCreateUser(request, authorization);
  if (path === "/api/admin/user" && request.method === "PATCH") return adminUpdateUser(request, authorization);
  if (path === "/api/admin/user" && request.method === "DELETE") return adminDeleteUser(request, authorization);
  if (path === "/api/admin/logout-user" && request.method === "POST") {
    const userId = new URL(request.url).searchParams.get("userId") ?? "";
    if (!userId) return jsonError("缺少账户 ID", 400);
    await execute("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
    clearUserSessionCache(userId);
    await audit(authorization.id, "session.revoke", userId);
    return new Response(null, { status: 204 });
  }
  if (path === "/api/admin/user-data" && ["GET", "PUT", "DELETE"].includes(request.method)) return adminUserData(request, authorization);
  if (path === "/api/admin/history" && ["GET", "PATCH", "DELETE"].includes(request.method)) return adminHistory(request, authorization);
  if (path === "/api/admin/sessions" && request.method === "GET") return adminSessions(request);
  if (path === "/api/admin/related" && request.method === "GET") return adminRelated(request);
  if (path === "/api/admin/settings" && ["GET", "PATCH"].includes(request.method)) return adminSettings(request, authorization);
  return jsonError("接口不存在", 404);
}

export async function handleAccountApi(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/auth/") && !path.startsWith("/api/admin/") && path !== "/api/user-data" && path !== "/api/history") return null;
  try {
    await ensureAccountSchema();
    if (!sameOrigin(request) && request.method !== "GET") return jsonError("请求来源无效", 403);
    if (path.startsWith("/api/admin/")) return handleAdminApi(request, path);
    if (path === "/api/auth/session" && request.method === "GET") {
      const user = await currentUser(request);
      return user ? jsonUser(user) : jsonError("请先登录或选择游客模式", 401);
    }
    if (path === "/api/auth/register" && request.method === "POST") return register(request);
    if (path === "/api/auth/login" && request.method === "POST") return login(request);
    if (path === "/api/auth/guest" && request.method === "POST") return guest(request);
    if (path === "/api/auth/logout" && request.method === "POST") {
      const token = cookies(request)[SESSION_COOKIE];
      if (token) {
        const tokenHash = await sha256(token);
        await execute("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
        sessionUserCache.delete(tokenHash);
      }
      const response = new Response(null, { status: 204 });
      response.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, "", request, 0));
      return response;
    }
    if (path === "/api/user-data" && ["GET", "PUT", "DELETE"].includes(request.method)) return userData(request);
    if (path === "/api/history" && ["GET", "POST", "DELETE"].includes(request.method)) return history(request);
    return jsonError("接口不存在", 404);
  } catch (error) {
    console.error("Account API error", error);
    return jsonError("账户服务暂时不可用", 500);
  }
}
