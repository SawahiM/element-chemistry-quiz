import assert from "node:assert/strict";
import test from "node:test";
import { equationAnswerIsExact, formulaElements, parseEquationAnswer } from "../app/equation-policy.ts";

const expected = [
  { formula: "NaOH", coefficientNum: 2, coefficientDen: 1 },
  { formula: "H2", coefficientNum: 1, coefficientDen: 1 },
];

test("equation answers ignore substance order and optional coefficient one", () => {
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
