export type NewHistoryRecord = {
  clientKey: string;
  recordType: "exam" | "practice";
  quizKind: "color" | "equation" | "unified";
  source: "practice" | "exam";
  correct?: boolean;
  payload: unknown;
  createdAt?: number;
};

export type HistoryRecord = NewHistoryRecord & {
  id: string;
  correct: boolean | null;
  createdAt: number;
};

let writeQueue: Promise<void> = Promise.resolve();
let historyValue: HistoryRecord[] | undefined;
let historyRequest: Promise<HistoryRecord[]> | undefined;
let historyCacheEpoch = 0;

export function peekHistory(): HistoryRecord[] | undefined {
  return historyValue;
}

export function clearHistorySessionCache(): void {
  historyCacheEpoch += 1;
  historyValue = undefined;
  historyRequest = undefined;
  writeQueue = Promise.resolve();
}

export function appendHistory(records: NewHistoryRecord[]): Promise<void> {
  const next = writeQueue.catch(() => undefined).then(async () => {
    const response = await fetch("/api/history", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ records }),
    });
    if (!response.ok) throw new Error(`历史记录保存失败（${response.status}）`);
    historyValue = undefined;
    historyRequest = undefined;
  });
  writeQueue = next;
  void next.catch(() => undefined);
  return next;
}

export async function loadHistory(): Promise<HistoryRecord[]> {
  if (historyValue) return historyValue;
  if (historyRequest) return historyRequest;
  const requestEpoch = historyCacheEpoch;
  historyRequest = fetch("/api/history", { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`历史记录读取失败（${response.status}）`);
    const body = await response.json() as { records: HistoryRecord[] };
    if (requestEpoch === historyCacheEpoch) historyValue = body.records;
    historyRequest = undefined;
    return body.records;
  }).catch((error) => {
    historyRequest = undefined;
    throw error;
  });
  return historyRequest;
}

export async function loadPracticeHistory(quizKind: "color" | "equation"): Promise<HistoryRecord[]> {
  return (await loadHistory())
    .filter((record) => record.recordType === "practice" && record.source === "practice" && record.quizKind === quizKind)
    .sort((left, right) => left.createdAt - right.createdAt);
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
  if (!response.ok) throw new Error(`历史记录删除失败（${response.status}）`);
  if (historyValue) historyValue = historyValue.filter((record) => record.id !== id);
}

export async function clearHistory(): Promise<void> {
  const response = await fetch("/api/history?all=true", { method: "DELETE", credentials: "same-origin" });
  if (!response.ok) throw new Error(`历史记录清空失败（${response.status}）`);
  historyValue = [];
  historyRequest = undefined;
}
