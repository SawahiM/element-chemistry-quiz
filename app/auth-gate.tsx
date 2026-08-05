"use client";

import { FormEvent, useEffect, useState } from "react";

type User = {
  id: string;
  username: string | null;
  displayName: string;
  accountType: "registered" | "guest";
};

type AuthMode = "login" | "register";

async function authRequest(path: string, body?: Record<string, string>): Promise<User> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { user?: User; error?: string };
  if (!response.ok || !payload.user) throw new Error(payload.error || "账户服务暂时不可用");
  return payload.user;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function enterAs(nextUser: User) {
    setUser(nextUser);
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) window.location.replace(returnTo);
  }

  useEffect(() => {
    authRequest("/api/auth/session")
      .then(enterAs)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      enterAs(await authRequest(`/api/auth/${mode}`, { username, password }));
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function continueAsGuest() {
    setSubmitting(true);
    setError("");
    try {
      enterAs(await authRequest("/api/auth/guest", {}));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "游客模式暂时不可用");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setUser(null);
    setMode("login");
  }

  if (checking) {
    return <main className="auth-loading" aria-live="polite"><span className="auth-loader" /><p>正在验证访问凭据…</p></main>;
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-intro" aria-labelledby="auth-title">
          <div className="auth-brand"><span>EC</span> Element Chemistry</div>
          <p className="auth-eyebrow">个人化学学习空间</p>
          <h1 id="auth-title">每一次练习，<br />都只属于你。</h1>
          <p className="auth-lead">登录后，答题记录与考试进度会安全地保存在你的独立账户中。</p>
          <div className="auth-points">
            <span><b>独立</b>每个账户的数据完全隔离</span>
            <span><b>连续</b>换设备登录也能继续学习</span>
            <span><b>轻量</b>无需注册也可使用游客模式</span>
          </div>
        </section>
        <section className="auth-card" aria-label="账户访问">
          <div className="auth-tabs" role="tablist">
            <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }} role="tab" aria-selected={mode === "login"}>登录</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }} role="tab" aria-selected={mode === "register"}>注册</button>
          </div>
          <div className="auth-card-copy">
            <h2>{mode === "login" ? "欢迎回来" : "创建个人账户"}</h2>
            <p>{mode === "login" ? "继续你的元素化学学习记录" : "用户名不区分大小写，密码至少 8 位"}</p>
          </div>
          <form onSubmit={submit}>
            <label><span>用户名</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} required placeholder="例如 chemistry_learner" /></label>
            <label><span>密码</span><input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required placeholder="至少 8 位" /></label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="auth-primary" disabled={submitting}>{submitting ? "请稍候…" : mode === "login" ? "登录并进入" : "注册并进入"}</button>
          </form>
          <div className="auth-divider"><span>或</span></div>
          <button className="auth-guest" disabled={submitting} onClick={continueAsGuest}>游客模式</button>
          <p className="auth-guest-note">浏览器会保存一枚临时游客凭据；清除 Cookie 后可能无法找回游客记录。</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="account-chip" aria-label="当前账户">
        <a className="account-chip-link" href="/history" title="查看历史记录">
          <span className="account-avatar">{user.accountType === "guest" ? "游" : user.displayName.slice(0, 1).toUpperCase()}</span>
          <span><b>{user.displayName}</b><small>{user.accountType === "guest" ? "游客 · 历史记录" : "账户 · 历史记录"}</small></span>
        </a>
        <button onClick={logout}>退出</button>
      </div>
      {children}
    </>
  );
}
