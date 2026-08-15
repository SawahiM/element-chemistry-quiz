const resourceValues = new Map<string, unknown>();
const resourceRequests = new Map<string, Promise<unknown>>();

export function peekSessionResource<T>(url: string): T | null {
  return (resourceValues.get(url) as T | undefined) ?? null;
}

export function loadSessionResource<T>(url: string, errorMessage: string): Promise<T> {
  const cached = resourceValues.get(url) as T | undefined;
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = resourceRequests.get(url) as Promise<T> | undefined;
  if (pending) return pending;
  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(errorMessage);
      const value = await response.json() as T;
      resourceValues.set(url, value);
      resourceRequests.delete(url);
      return value;
    })
    .catch((error) => {
      resourceRequests.delete(url);
      throw error;
    });
  resourceRequests.set(url, request);
  return request;
}
