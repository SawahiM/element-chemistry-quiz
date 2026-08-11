export const ABSOLUTE_FORBIDDEN_COLOR_PAIRS = [["白色", "无色"]];

function effectivePairs(pairs: string[][] = []): string[][] {
  return [...ABSOLUTE_FORBIDDEN_COLOR_PAIRS, ...pairs];
}

export function forbiddenColorPair(answer: string, distractor: string, pairs: string[][] = []): boolean {
  return answer !== distractor && effectivePairs(pairs).some(
    (pair) => pair.includes(answer) && pair.includes(distractor),
  );
}

export function hasForbiddenColorCooccurrence(colors: string[], pairs: string[][] = []): boolean {
  return colors.some((color, index) =>
    colors.slice(index + 1).some((other) => forbiddenColorPair(color, other, pairs)),
  );
}

export function takeWithFinalColorCheck<T>(
  requiredColors: string[],
  candidates: T[],
  count: number,
  colorOf: (candidate: T) => string,
  forbiddenPairs: string[][] = [],
): T[] {
  return takeWithFinalConflictCheck(
    requiredColors,
    candidates,
    count,
    colorOf,
    (left, right) => forbiddenColorPair(left, right, forbiddenPairs),
  );
}

export function takeWithFinalConflictCheck<K, T>(
  requiredKeys: K[],
  candidates: T[],
  count: number,
  keyOf: (candidate: T) => K,
  conflicts: (left: K, right: K) => boolean,
): T[] {
  const selected: T[] = [];
  const keysInQuestion = [...requiredKeys];
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const key = keyOf(candidate);
    if (keysInQuestion.some((existing) => conflicts(existing, key) || conflicts(key, existing))) continue;
    selected.push(candidate);
    keysInQuestion.push(key);
  }
  if (keysInQuestion.some((key, index) =>
    keysInQuestion.slice(index + 1).some((other) => conflicts(key, other) || conflicts(other, key)))) {
    throw new Error("最终选项包含有向冲突关系");
  }
  return selected;
}
