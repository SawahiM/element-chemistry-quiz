const accountValues = new Map<string, unknown | null>();
const accountRequests = new Map<string, Promise<unknown | null>>();
const saveQueues = new Map<string, Promise<void>>();
let accountCacheEpoch = 0;

export function peekAccountData<T>(key: string): T | null | undefined {
  return accountValues.has(key) ? accountValues.get(key) as T | null : undefined;
}

export function clearAccountSessionCache(): void {
  accountCacheEpoch += 1;
  accountValues.clear();
  accountRequests.clear();
  saveQueues.clear();
}

export async function loadAccountData<T>(key: string): Promise<T | null> {
  const cached = peekAccountData<T>(key);
  if (cached !== undefined) return cached;
  const pending = accountRequests.get(key) as Promise<T | null> | undefined;
  if (pending) return pending;
  const requestEpoch = accountCacheEpoch;
  const request = fetch(`/api/user-data?key=${encodeURIComponent(key)}`, {
    credentials: "same-origin",
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) throw new Error(`账户数据读取失败（${response.status}）`);
    const payload = await response.json() as { value: T | null };
    if (requestEpoch === accountCacheEpoch) accountValues.set(key, payload.value);
    accountRequests.delete(key);
    return payload.value;
  }).catch((error) => {
    accountRequests.delete(key);
    throw error;
  });
  accountRequests.set(key, request);
  return request;
}

export function saveAccountData(key: string, value: unknown): Promise<void> {
  accountValues.set(key, value);
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const response = await fetch(`/api/user-data?key=${encodeURIComponent(key)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!response.ok) {
      accountValues.delete(key);
      throw new Error(`账户数据保存失败（${response.status}）`);
    }
  });
  saveQueues.set(key, next);
  const cleanup = () => { if (saveQueues.get(key) === next) saveQueues.delete(key); };
  void next.then(cleanup, cleanup);
  void next.catch(() => undefined);
  return next;
}

export async function deleteAccountData(key: string): Promise<void> {
  accountValues.delete(key);
  accountRequests.delete(key);
  const response = await fetch(`/api/user-data?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok && response.status !== 404) throw new Error(`账户数据删除失败（${response.status}）`);
}
