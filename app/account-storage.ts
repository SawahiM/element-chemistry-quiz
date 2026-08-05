export async function loadAccountData<T>(key: string): Promise<T | null> {
  const response = await fetch(`/api/user-data?key=${encodeURIComponent(key)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`账户数据读取失败（${response.status}）`);
  const payload = await response.json() as { value: T | null };
  return payload.value;
}

const saveQueues = new Map<string, Promise<void>>();

export function saveAccountData(key: string, value: unknown): Promise<void> {
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const response = await fetch(`/api/user-data?key=${encodeURIComponent(key)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!response.ok) throw new Error(`账户数据保存失败（${response.status}）`);
  });
  saveQueues.set(key, next);
  const cleanup = () => { if (saveQueues.get(key) === next) saveQueues.delete(key); };
  void next.then(cleanup, cleanup);
  void next.catch(() => undefined);
  return next;
}

export async function deleteAccountData(key: string): Promise<void> {
  const response = await fetch(`/api/user-data?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok && response.status !== 404) throw new Error(`账户数据删除失败（${response.status}）`);
}
