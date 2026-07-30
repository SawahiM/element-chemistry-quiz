export type EquationAnswerPart = {
  formula: string;
  coefficientNum: number;
  coefficientDen: number;
};

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function normalizeFormula(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "")
    .replace(/[↑↓]/g, "")
    .replace(/\((?:aq|s|l|g)\)$/i, "")
    .replace(/[{}]/g, "");
}

export function parseEquationAnswer(value: string): EquationAnswerPart | null {
  const compact = value.trim().replace(/\s+/g, "");
  if (!compact) return null;
  const match = compact.match(/^((\d+)(?:\/(\d+))?)?(.+)$/);
  if (!match) return null;
  const coefficientNum = match[2] ? Number(match[2]) : 1;
  const coefficientDen = match[3] ? Number(match[3]) : 1;
  const formula = normalizeFormula(match[4]);
  if (!formula || coefficientNum < 1 || coefficientDen < 1) return null;
  const divisor = gcd(coefficientNum, coefficientDen);
  return {
    formula,
    coefficientNum: coefficientNum / divisor,
    coefficientDen: coefficientDen / divisor,
  };
}

function signature(part: EquationAnswerPart, requireBalancing: boolean): string {
  const formula = normalizeFormula(part.formula);
  return requireBalancing
    ? `${formula}|${part.coefficientNum}/${part.coefficientDen}`
    : formula;
}

export function equationAnswerIsExact(
  answerValues: string[],
  expected: EquationAnswerPart[],
  requireBalancing: boolean,
): boolean {
  const answers = answerValues.map(parseEquationAnswer).filter((part): part is EquationAnswerPart => Boolean(part));
  if (answers.length !== answerValues.filter((value) => value.trim()).length || answers.length !== expected.length) {
    return false;
  }
  const actualSignatures = answers.map((part) => signature(part, requireBalancing)).sort();
  const expectedSignatures = expected.map((part) => signature(part, requireBalancing)).sort();
  return actualSignatures.every((value, index) => value === expectedSignatures[index]);
}

export function formulaElements(formulas: string[]): string[] {
  return [...new Set(
    formulas.flatMap((formula) => normalizeFormula(formula).match(/[A-Z][a-z]?/g) || []),
  )];
}
