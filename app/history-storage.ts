export type NewHistoryRecord = {
  clientKey: string;
  recordType: "exam" | "practice";
  quizKind: "color" | "equation";
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

export function appendHistory(records: NewHistoryRecord[]): Promise<void> {
  const next = writeQueue.catch(() => undefined).then(async () => {
    const response = await fetch("/api/history", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ records }),
    });
    if (!response.ok) throw new Error(`历史记录保存失败（${response.status}）`);
  });
  writeQueue = next;
  void next.catch(() => undefined);
  return next;
}

export async function loadHistory(): Promise<HistoryRecord[]> {
  const response = await fetch("/api/history", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`历史记录读取失败（${response.status}）`);
  const body = await response.json() as { records: HistoryRecord[] };
  return body.records;
}

export async function loadPracticeHistory(quizKind: "color" | "equation"): Promise<HistoryRecord[]> {
  return (await loadHistory())
    .filter((record) => record.recordType === "practice" && record.source === "practice" && record.quizKind === quizKind)
    .sort((left, right) => left.createdAt - right.createdAt);
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
  if (!response.ok) throw new Error(`历史记录删除失败（${response.status}）`);
}

export async function clearHistory(): Promise<void> {
  const response = await fetch("/api/history?all=true", { method: "DELETE", credentials: "same-origin" });
  if (!response.ok) throw new Error(`历史记录清空失败（${response.status}）`);
}
