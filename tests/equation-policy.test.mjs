import assert from "node:assert/strict";
import test from "node:test";
import { coefficientIsExact, equationAnswerIsExact, formulaElements, parseEquationAnswer } from "../app/equation-policy.ts";

const expected = [
  { formula: "NaOH", coefficientNum: 2, coefficientDen: 1 },
  { formula: "H2", coefficientNum: 1, coefficientDen: 1 },
];

test("normalized equation parts ignore substance order", () => {
  assert.equal(equationAnswerIsExact(["H2", "2NaOH"], expected, true), true);
});

test("coefficients are ignored when balancing is disabled", () => {
  assert.equal(equationAnswerIsExact(["NaOH", "9H2"], expected, false), true);
});

test("balancing mode rejects missing non-unit coefficients", () => {
  assert.equal(equationAnswerIsExact(["NaOH", "H2"], expected, true), false);
});

test("state and formation markers are not graded", () => {
  assert.equal(equationAnswerIsExact(["2NaOH(aq)", "H2↑"], expected, true), true);
});

test("fractional coefficients and element keyboard symbols parse", () => {
  assert.deepEqual(parseEquationAnswer("3/2 O2"), {
    formula: "O2",
    coefficientNum: 3,
    coefficientDen: 2,
  });
  assert.deepEqual(formulaElements(["KMnO4", "H2SO4"]), ["K", "Mn", "O", "H", "S"]);
});

test("separate coefficient fields require an explicit equivalent value", () => {
  assert.equal(coefficientIsExact("", 1, 1), false);
  assert.equal(coefficientIsExact("1", 1, 1), true);
  assert.equal(coefficientIsExact("2/4", 1, 2), true);
  assert.equal(coefficientIsExact("2", 1, 1), false);
});
