import { Pool, type QueryResultRow } from "pg";

const SESSION_COOKIE = "quiz_session";
const GUEST_COOKIE = "quiz_guest";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const GUEST_TTL_SECONDS = 60 * 60 * 24 * 180;
const PASSWORD_ITERATIONS = 120_000;
const VALID_DATA_KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

type AccountUser = { id: string; username: string | null; displayName: string; accountType: "registered" | "guest" };
type LoginRow = AccountUser & { passwordHash: string };
let client: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getSql(): Pool {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  client ??= new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return client;
}

async function rows<T extends QueryResultRow>(statement: string, params: unknown[] = []): Promise<T[]> {
  const result = await getSql().query<T>(statement, params);
  return result.rows;
}

async function execute(statement: string, params: unknown[] = []): Promise<void> {
  await getSql().query(statement, params);
}

async function ensureAccountSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await execute(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, account_type TEXT NOT NULL,
        guest_credential_hash TEXT, display_name TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
      )`);
      await execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username)");
      await execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_guest_credential ON users (guest_credential_hash)");
      await execute(`CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL
      )`);
      await execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id)");
      await execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions (expires_at)");
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

async function currentUser(request: Request): Promise<AccountUser | null> {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const result = await rows<AccountUser>(
    `SELECT users.id, users.username, users.display_name AS "displayName", users.account_type AS "accountType"
     FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
     WHERE auth_sessions.token_hash = $1 AND auth_sessions.expires_at > $2`,
    [await sha256(token), Math.floor(Date.now() / 1000)],
  );
  return result[0] ?? null;
}

async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await execute("INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
    [await sha256(token), userId, now + SESSION_TTL_SECONDS, now]);
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
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    await execute(`INSERT INTO users (id, username, password_hash, account_type, display_name, created_at, updated_at)
      VALUES ($1, $2, $3, 'registered', $4, $5, $6)`, [id, username, await hashPassword(password), username, now, now]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return jsonError("该用户名已被使用", 409);
    throw error;
  }
  const user: AccountUser = { id, username, displayName: username, accountType: "registered" };
  const response = jsonUser(user, 201);
  response.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, await createSession(id), request, SESSION_TTL_SECONDS));
  return response;
}

async function login(request: Request): Promise<Response> {
  const body = await readBody(request);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const result = await rows<LoginRow>(`SELECT id, username, display_name AS "displayName", account_type AS "accountType",
    password_hash AS "passwordHash" FROM users WHERE username = $1 AND account_type = 'registered'`, [username]);
  const row = result[0];
  if (!row || !await verifyPassword(password, row.passwordHash)) return jsonError("用户名或密码不正确", 401);
  const user: AccountUser = { id: row.id, username: row.username, displayName: row.displayName, accountType: row.accountType };
  const response = jsonUser(user);
  response.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, await createSession(user.id), request, SESSION_TTL_SECONDS));
  return response;
}

async function guest(request: Request): Promise<Response> {
  let credential = cookies(request)[GUEST_COOKIE];
  let user: AccountUser | null = null;
  if (credential) {
    const result = await rows<AccountUser>(`SELECT id, username, display_name AS "displayName", account_type AS "accountType"
      FROM users WHERE guest_credential_hash = $1 AND account_type = 'guest'`, [await sha256(credential)]);
    user = result[0] ?? null;
  }
  if (!user) {
    credential = randomToken();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const displayName = `游客 ${id.slice(0, 6)}`;
    await execute(`INSERT INTO users (id, account_type, guest_credential_hash, display_name, created_at, updated_at)
      VALUES ($1, 'guest', $2, $3, $4, $5)`, [id, await sha256(credential), displayName, now, now]);
    user = { id, username: null, displayName, accountType: "guest" };
  }
  const response = jsonUser(user, 201);
  response.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, await createSession(user.id), request, SESSION_TTL_SECONDS));
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
  const values: unknown[] = [];
  const placeholders: string[] = [];
  for (const value of records) {
    if (!value || typeof value !== "object") return jsonError("历史记录格式无效", 400);
    const record = value as Record<string, unknown>;
    const clientKey = typeof record.clientKey === "string" ? record.clientKey.slice(0, 160) : "";
    const recordType = record.recordType === "exam" || record.recordType === "practice" ? record.recordType : null;
    const quizKind = record.quizKind === "color" || record.quizKind === "equation" ? record.quizKind : null;
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

export async function handleAccountApi(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/auth/") && path !== "/api/user-data" && path !== "/api/history") return null;
  try {
    await ensureAccountSchema();
    if (!sameOrigin(request) && request.method !== "GET") return jsonError("请求来源无效", 403);
    if (path === "/api/auth/session" && request.method === "GET") {
      const user = await currentUser(request);
      return user ? jsonUser(user) : jsonError("请先登录或选择游客模式", 401);
    }
    if (path === "/api/auth/register" && request.method === "POST") return register(request);
    if (path === "/api/auth/login" && request.method === "POST") return login(request);
    if (path === "/api/auth/guest" && request.method === "POST") return guest(request);
    if (path === "/api/auth/logout" && request.method === "POST") {
      const token = cookies(request)[SESSION_COOKIE];
      if (token) await execute("DELETE FROM auth_sessions WHERE token_hash = $1", [await sha256(token)]);
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
