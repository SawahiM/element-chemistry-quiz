"use client";

import { FormEvent, SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./admin.css";

type Summary = {
  totalUsers: number;
  registeredUsers: number;
  guestUsers: number;
  disabledUsers: number;
  activeToday: number;
  totalAnswers: number;
  correctAnswers: number;
};

type UserRow = {
  id: string;
  username: string | null;
  displayName: string;
  accountType: "registered" | "guest";
  role: "user" | "admin";
  status: "active" | "disabled";
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  lastLoginIp: string | null;
  lastAnswerAt: number | null;
  loginCount: number;
  activeSessions: number;
  answerCount: number;
  correctCount: number;
};

type Detail = {
  user: Pick<UserRow, "id" | "username" | "displayName" | "accountType" | "role" | "status" | "createdAt" | "updatedAt" | "lastLoginAt" | "loginCount">;
};

type DataEntry = { dataKey: string; updatedAt: number; sizeBytes: number };
type HistoryEntry = {
  id: string;
  clientKey: string;
  recordType: "exam" | "practice";
  quizKind: "color" | "equation" | "unified";
  source: "exam" | "practice";
  correct: boolean | null;
  createdAt: number;
  sizeBytes: number;
};
type SessionEntry = { createdAt: number; expiresAt: number; active: boolean };
type LoginEntry = { ipAddress: string; createdAt: number };

type Overview = { users: UserRow[]; summary: Summary; page: number; pageSize: number; filteredCount: number };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function formatTime(value: number | null | undefined): string {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(value * 1000) : "从未";
}

function accountName(user: Pick<UserRow, "accountType" | "username" | "displayName">): string {
  return user.accountType === "registered" ? user.username ?? "未命名账户" : user.displayName;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function JsonEditor({ value, onSave, onDelete }: { value: unknown; onSave: (value: unknown) => Promise<void>; onDelete: () => Promise<void> }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try { await onSave(JSON.parse(text)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setBusy(false); }
  }

  return <div className="admin-json-editor">
    <textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} />
    {error ? <p className="admin-error">{error}</p> : null}
    <div><button disabled={busy} onClick={save}>保存 JSON</button><button className="danger" disabled={busy} onClick={onDelete}>删除</button></div>
  </div>;
}

function DataRecord({ userId, entry, onSave, onDelete }: {
  userId: string;
  entry: DataEntry;
  onSave: (key: string, value: unknown) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}) {
  const [value, setValue] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function toggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || value !== undefined || loading) return;
    setLoading(true); setError("");
    try {
      const result = await api<{ value: unknown }>(`/api/admin/user-data?userId=${encodeURIComponent(userId)}&key=${encodeURIComponent(entry.dataKey)}`);
      setValue(result.value);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取数据"); }
    finally { setLoading(false); }
  }
  return <details className="admin-record" onToggle={toggle}>
    <summary><b>{entry.dataKey}</b><span>{formatBytes(entry.sizeBytes)} · {formatTime(entry.updatedAt)}</span></summary>
    {loading ? <p className="admin-inline-loading">正在读取 JSON…</p> : error ? <p className="admin-error admin-inline-loading">{error}</p> : value !== undefined ? <JsonEditor value={value} onSave={async (next) => { await onSave(entry.dataKey, next); setValue(next); }} onDelete={() => onDelete(entry.dataKey)} /> : null}
  </details>;
}

function HistoryRecord({ userId, record, onSave, onDelete }: {
  userId: string;
  record: HistoryEntry;
  onSave: (id: string, correct: boolean | null, payload: unknown) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [payload, setPayload] = useState<unknown>();
  const [correct, setCorrect] = useState(record.correct);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function toggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || payload !== undefined || loading) return;
    setLoading(true); setError("");
    try {
      const result = await api<{ payload: unknown; correct: boolean | null }>(`/api/admin/history?userId=${encodeURIComponent(userId)}&id=${encodeURIComponent(record.id)}`);
      setPayload(result.payload); setCorrect(result.correct);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取答题记录"); }
    finally { setLoading(false); }
  }
  return <details className="admin-record" onToggle={toggle}>
    <summary><b>{record.recordType === "exam" ? "考试" : "练习"} · {record.quizKind}</b><span>{record.correct === null ? "未计分" : record.correct ? "正确" : "错误"} · {formatBytes(record.sizeBytes)} · {formatTime(record.createdAt)}</span></summary>
    {loading ? <p className="admin-inline-loading">正在读取记录 JSON…</p> : error ? <p className="admin-error admin-inline-loading">{error}</p> : payload !== undefined ? <HistoryEditor record={{ ...record, correct, payload }} onSave={async (id, nextCorrect, nextPayload) => { await onSave(id, nextCorrect, nextPayload); setCorrect(nextCorrect); setPayload(nextPayload); }} onDelete={onDelete} /> : null}
  </details>;
}

export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [accountType, setAccountType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dataEntries, setDataEntries] = useState<DataEntry[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [loginEntries, setLoginEntries] = useState<LoginEntry[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const detailRequest = useRef(0);
  const createRequestPending = useRef(false);

  const loadOverview = useCallback(async () => {
    const search = new URLSearchParams({ page: String(page) });
    if (query.trim()) search.set("q", query.trim());
    if (accountType) search.set("accountType", accountType);
    if (status) search.set("status", status);
    try {
      setError("");
      setOverview(await api<Overview>(`/api/admin/overview?${search}`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载后台数据"); }
    finally { setLoading(false); }
  }, [accountType, page, query, status]);

  const loadRelated = useCallback(async (userId: string, requestId: number) => {
    setRelatedLoading(true);
    try {
      const result = await api<{ data: DataEntry[]; history: HistoryEntry[]; sessions: SessionEntry[]; logins: LoginEntry[] }>(
        `/api/admin/related?userId=${encodeURIComponent(userId)}`,
      );
      if (requestId !== detailRequest.current) return;
      setDataEntries(result.data);
      setHistoryEntries(result.history);
      setSessions(result.sessions);
      setLoginEntries(result.logins);
    } catch (reason) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "无法加载账户关联数据");
    } finally {
      if (requestId === detailRequest.current) setRelatedLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (userId: string) => {
    const requestId = ++detailRequest.current;
    setDataEntries([]); setHistoryEntries([]); setSessions([]); setLoginEntries([]);
    try {
      const nextDetail = await api<Detail>(`/api/admin/user?userId=${encodeURIComponent(userId)}`);
      if (requestId !== detailRequest.current) return;
      setError("");
      setDetail(nextDetail);
      await loadRelated(userId, requestId);
    } catch (reason) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "无法加载账户详情");
    }
  }, [loadRelated]);

  function selectUser(user: UserRow) {
    const requestId = ++detailRequest.current;
    setSelectedId(user.id);
    setDetail({ user });
    setDataEntries([]); setHistoryEntries([]); setSessions([]); setLoginEntries([]);
    void loadRelated(user.id, requestId);
  }

  useEffect(() => {
    const timer = window.setTimeout(loadOverview, 220);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  useEffect(() => {
    api<{ registrationEnabled: boolean }>("/api/admin/settings")
      .then((result) => setRegistrationEnabled(result.registrationEnabled))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取管理设置"));
  }, []);

  async function refresh(message?: string) {
    await Promise.all([loadOverview(), selectedId ? loadDetail(selectedId) : Promise.resolve()]);
    if (message) { setNotice(message); window.setTimeout(() => setNotice(""), 2400); }
  }

  async function toggleRegistration() {
    try {
      const result = await api<{ registrationEnabled: boolean }>("/api/admin/settings", {
        method: "PATCH", body: JSON.stringify({ registrationEnabled: !registrationEnabled }),
      });
      setRegistrationEnabled(result.registrationEnabled);
      setNotice(result.registrationEnabled ? "已开放新账户注册" : "已暂停新账户注册");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "设置失败"); }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createRequestPending.current) return;
    createRequestPending.current = true;
    setCreating(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ id: string }>("/api/admin/users", { method: "POST", body: JSON.stringify({
        username: form.get("username"), password: form.get("password"),
      }) });
      event.currentTarget.reset(); setShowCreate(false); setSelectedId(result.id);
      await Promise.all([loadOverview(), loadDetail(result.id)]); setNotice("账户已创建");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败"); }
    finally { createRequestPending.current = false; setCreating(false); }
  }

  async function updateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    try {
      await api("/api/admin/user?userId=" + encodeURIComponent(detail.user.id), { method: "PATCH", body: JSON.stringify({
        ...(detail.user.accountType === "registered" ? { username: form.get("username") } : {}),
        status: form.get("status"), ...(password ? { password } : {}),
      }) });
      await refresh("账户资料已保存");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
  }

  async function revokeSessions() {
    if (!detail || !window.confirm(`确认让“${accountName(detail.user)}”的所有登录立即失效？`)) return;
    await api(`/api/admin/logout-user?userId=${encodeURIComponent(detail.user.id)}`, { method: "POST" });
    await refresh("全部会话已撤销");
  }

  async function deleteUser() {
    if (!detail || !window.confirm(`永久删除“${accountName(detail.user)}”及其全部做题数据？此操作不可撤销。`)) return;
    try {
      await api(`/api/admin/user?userId=${encodeURIComponent(detail.user.id)}`, { method: "DELETE" });
      detailRequest.current += 1; setSelectedId(""); setDetail(null); setDataEntries([]); setHistoryEntries([]); setSessions([]); await refresh("账户及关联数据已删除");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
  }

  async function saveData(key: string, value: unknown) {
    if (!detail) return;
    await api(`/api/admin/user-data?userId=${encodeURIComponent(detail.user.id)}&key=${encodeURIComponent(key)}`, {
      method: "PUT", body: JSON.stringify({ value }),
    });
    await refresh("账户数据已保存");
  }

  async function deleteData(key: string) {
    if (!detail || !window.confirm(`删除数据项 ${key}？`)) return;
    await api(`/api/admin/user-data?userId=${encodeURIComponent(detail.user.id)}&key=${encodeURIComponent(key)}`, { method: "DELETE" });
    await refresh("账户数据已删除");
  }

  async function addData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await saveData(String(form.get("key") ?? ""), JSON.parse(String(form.get("value") ?? "null")));
      event.currentTarget.reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "JSON 格式无效"); }
  }

  async function saveHistory(id: string, correct: boolean | null, payload: unknown) {
    if (!detail) return;
    await api(`/api/admin/history?userId=${encodeURIComponent(detail.user.id)}&id=${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify({ correct, payload }),
    });
    await refresh("答题记录已保存");
  }

  async function deleteHistory(id: string) {
    if (!detail || !window.confirm("删除这条答题记录？")) return;
    await api(`/api/admin/history?userId=${encodeURIComponent(detail.user.id)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh("答题记录已删除");
  }

  if (loading) return <main className="admin-state"><span className="auth-loader" /><p>正在加载管理控制台…</p></main>;
  if (!overview && error) return <main className="admin-state admin-denied"><b>无法进入管理控制台</b><p>{error}</p><Link href="/">返回 ChemQuiz</Link></main>;

  const summary = overview?.summary;
  const pages = Math.max(1, Math.ceil((overview?.filteredCount ?? 0) / (overview?.pageSize ?? 50)));
  const accuracy = summary?.totalAnswers ? Math.round(summary.correctAnswers / summary.totalAnswers * 100) : 0;

  return <main className="admin-shell">
    <header className="admin-hero">
      <div><p>CHEMQUIZ · PRIVATE CONTROL</p><h1>账户与学习数据</h1><span>管理员专用 · 所有变更均记录审计日志</span></div>
      <Link href="/">返回题库</Link>
    </header>
    {error ? <div className="admin-banner error"><span>{error}</span><button onClick={() => setError("")}>×</button></div> : null}
    {notice ? <div className="admin-banner success">{notice}</div> : null}
    <section className="admin-metrics">
      <article><span>全部账户</span><strong>{summary?.totalUsers ?? 0}</strong><small>{summary?.registeredUsers ?? 0} 注册 · {summary?.guestUsers ?? 0} 游客</small></article>
      <article><span>24 小时登录</span><strong>{summary?.activeToday ?? 0}</strong><small>{summary?.disabledUsers ?? 0} 个停用账户</small></article>
      <article><span>累计作答</span><strong>{summary?.totalAnswers ?? 0}</strong><small>总体正确率 {accuracy}%</small></article>
      <article className="admin-registration"><span>公开注册</span><strong className={registrationEnabled ? "on" : "off"}>{registrationEnabled ? "已开放" : "已暂停"}</strong><button onClick={toggleRegistration}>{registrationEnabled ? "暂停注册" : "开放注册"}</button></article>
    </section>
    <section className="admin-toolbar">
      <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索用户名、显示名或账户 ID" />
      <select value={accountType} onChange={(event) => { setAccountType(event.target.value); setPage(1); }}><option value="">全部账户类型</option><option value="registered">注册账户</option><option value="guest">游客账户</option></select>
      <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="active">正常</option><option value="disabled">已停用</option></select>
      <button className="primary" onClick={() => setShowCreate((value) => !value)}>＋ 新建账户</button>
    </section>
    {showCreate ? <form className="admin-create" onSubmit={createUser}><label>用户名<input name="username" required minLength={3} maxLength={32} disabled={creating} /></label><label>初始密码<input name="password" type="password" required minLength={8} maxLength={128} disabled={creating} /></label><button className="primary" disabled={creating}>{creating ? "正在创建…" : "创建注册账户"}</button></form> : null}
    <div className="admin-workspace">
      <section className="admin-user-list">
        <div className="admin-section-title"><div><h2>账户目录</h2><span>共 {overview?.filteredCount ?? 0} 个匹配项</span></div><button onClick={() => void loadOverview()}>刷新</button></div>
        <div className="admin-table-wrap"><table><thead><tr><th>账户</th><th>状态</th><th>登录情况</th><th>做题情况</th></tr></thead><tbody>{overview?.users.map((user) => <tr key={user.id} className={selectedId === user.id ? "selected" : ""} tabIndex={0} aria-selected={selectedId === user.id} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") selectUser(user); }} onClick={() => selectUser(user)}><td><b>{accountName(user)}</b><small>{user.id.slice(0, 13)}</small><em>{user.accountType === "guest" ? "游客" : user.role === "admin" ? "管理员" : "注册"}</em></td><td><span className={`status ${user.status}`}>{user.status === "active" ? "正常" : "停用"}</span></td><td><b>{user.activeSessions} 个有效会话</b><small>{formatTime(user.lastLoginAt)} · {user.lastLoginIp ?? "IP 未记录"}</small></td><td><b>{user.answerCount} 题 · {user.correctCount} 正确</b><small>最后作答 {formatTime(user.lastAnswerAt)}</small></td></tr>)}</tbody></table></div>
        <div className="admin-pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
      </section>
      <aside className="admin-detail">
        {!detail ? <div className="admin-empty"><b>选择一个账户</b><p>查看并管理资料、登录会话、账户数据与做题记录。</p></div> : <>
          <div className="admin-detail-head"><div><span>{detail.user.accountType === "guest" ? "游客账户" : detail.user.role === "admin" ? "管理员账户" : "注册账户"}</span><h2>{accountName(detail.user)}</h2><code>{detail.user.id}</code></div><button onClick={() => { detailRequest.current += 1; setSelectedId(""); setDetail(null); setDataEntries([]); setHistoryEntries([]); setSessions([]); setLoginEntries([]); }}>×</button></div>
          <div className="admin-detail-scroll">
            <section><h3>账户资料</h3><form key={detail.user.id} className="admin-edit-form" onSubmit={updateUser}>{detail.user.accountType === "registered" ? <label>用户名<input name="username" defaultValue={detail.user.username ?? ""} required /></label> : <p className="muted">游客账户没有用户名，以游客标识和账户 ID 区分。</p>}<label>状态<select name="status" defaultValue={detail.user.status}><option value="active">正常</option><option value="disabled">停用</option></select></label>{detail.user.accountType === "registered" ? <label>重置密码<input name="password" type="password" minLength={8} placeholder="留空则不修改" /></label> : null}<button className="primary">保存账户资料</button></form>
              <dl className="admin-facts"><div><dt>创建时间</dt><dd>{formatTime(detail.user.createdAt)}</dd></div><div><dt>最后登录</dt><dd>{formatTime(detail.user.lastLoginAt)}</dd></div><div><dt>累计登录</dt><dd>{detail.user.loginCount} 次</dd></div></dl>
              <div className="admin-danger-actions"><button onClick={revokeSessions}>撤销全部会话</button><button className="danger" onClick={deleteUser}>删除账户及数据</button></div>
            </section>
            <section><div className="admin-section-title"><div><h3>登录会话</h3><span>最近 {sessions.length} 条</span></div></div>{relatedLoading && !sessions.length ? <p className="admin-inline-loading">正在加载会话摘要…</p> : !sessions.length ? <p className="muted">没有登录会话</p> : <div className="admin-session-list">{sessions.map((session, index) => <div key={`${session.createdAt}-${index}`}><span className={`status ${session.active ? "active" : "disabled"}`}>{session.active ? "有效" : "过期"}</span><p>登录 {formatTime(session.createdAt)}<small>到期 {formatTime(session.expiresAt)}</small></p></div>)}</div>}</section>
            <section><div className="admin-section-title"><div><h3>登录 IP</h3><span>最近 {loginEntries.length} 条</span></div></div>{relatedLoading && !loginEntries.length ? <p className="admin-inline-loading">正在加载登录记录…</p> : !loginEntries.length ? <p className="muted">尚无 IP 记录</p> : <div className="admin-session-list">{loginEntries.map((entry, index) => <div key={`${entry.createdAt}-${index}`}><code>{entry.ipAddress}</code><p>登录时间<small>{formatTime(entry.createdAt)}</small></p></div>)}</div>}</section>
            <section><div className="admin-section-title"><div><h3>账户数据</h3><span>{dataEntries.length} 个数据键</span></div></div><form className="admin-add-data" onSubmit={addData}><input name="key" required pattern="[a-z0-9][a-z0-9_.-]{0,63}" placeholder="新数据键" /><textarea name="value" required defaultValue="{}" /><button>新增 / 覆盖</button></form>{relatedLoading && !dataEntries.length ? <p className="admin-inline-loading">正在加载数据键…</p> : dataEntries.map((entry) => <DataRecord userId={detail.user.id} entry={entry} onSave={saveData} onDelete={deleteData} key={entry.dataKey} />)}</section>
            <section><div className="admin-section-title"><div><h3>做题记录</h3><span>最近 {historyEntries.length} 条</span></div></div>{relatedLoading && !historyEntries.length ? <p className="admin-inline-loading">正在加载答题摘要…</p> : historyEntries.map((record) => <HistoryRecord userId={detail.user.id} record={record} onSave={saveHistory} onDelete={deleteHistory} key={record.id} />)}</section>
          </div>
        </>}
      </aside>
    </div>
  </main>;
}

function HistoryEditor({ record, onSave, onDelete }: {
  record: HistoryEntry & { payload: unknown };
  onSave: (id: string, correct: boolean | null, payload: unknown) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [correct, setCorrect] = useState(record.correct === null ? "null" : String(record.correct));
  const [text, setText] = useState(() => JSON.stringify(record.payload, null, 2));
  const [error, setError] = useState("");
  async function save() {
    try { setError(""); await onSave(record.id, correct === "null" ? null : correct === "true", JSON.parse(text)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
  }
  return <div className="admin-history-editor"><label>判定<select value={correct} onChange={(event) => setCorrect(event.target.value)}><option value="true">正确</option><option value="false">错误</option><option value="null">未计分</option></select></label><textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} />{error ? <p className="admin-error">{error}</p> : null}<div><button onClick={save}>保存记录</button><button className="danger" onClick={() => onDelete(record.id)}>删除记录</button></div></div>;
}
