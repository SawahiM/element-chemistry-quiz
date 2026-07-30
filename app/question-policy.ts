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
  const selected: T[] = [];
  const colorsInQuestion = [...requiredColors];
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const color = colorOf(candidate);
    if (colorsInQuestion.some((existing) => forbiddenColorPair(existing, color, forbiddenPairs))) continue;
    selected.push(candidate);
    colorsInQuestion.push(color);
  }
  if (hasForbiddenColorCooccurrence(colorsInQuestion, forbiddenPairs)) {
    throw new Error("最终选项包含禁止同时出现的颜色");
  }
  return selected;
}
