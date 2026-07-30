import assert from "node:assert/strict";
import test from "node:test";
import { hasForbiddenColorCooccurrence, takeWithFinalColorCheck } from "../app/question-policy.ts";

const forbiddenPairs = [["白色", "无色"]];
const choose = (required, candidates, count) => takeWithFinalColorCheck(
  required,
  candidates,
  count,
  (item) => item.color,
  forbiddenPairs,
);
const colors = (items) => items.map((item) => item.color);

test("white and colorless never coexist when both are distractors", () => {
  const result = choose(
    ["红色"],
    [{ color: "白色" }, { color: "无色" }, { color: "黄色" }, { color: "蓝色" }],
    3,
  );
  assert.deepEqual(colors(result), ["白色", "黄色", "蓝色"]);
});

test("colorless is rejected when white is the answer", () => {
  const result = choose(
    ["白色"],
    [{ color: "无色" }, { color: "黄色" }, { color: "蓝色" }],
    2,
  );
  assert.deepEqual(colors(result), ["黄色", "蓝色"]);
});

test("white is rejected when colorless is already selected", () => {
  const result = choose(
    ["红色"],
    [{ color: "无色" }, { color: "白色" }, { color: "黄色" }, { color: "绿色" }],
    3,
  );
  assert.deepEqual(colors(result), ["无色", "黄色", "绿色"]);
});

test("the absolute white/colorless guard works without format configuration", () => {
  const result = takeWithFinalColorCheck(
    ["红色"],
    [{ color: "白色" }, { color: "无色" }, { color: "黄色" }, { color: "蓝色" }],
    3,
    (item) => item.color,
  );
  assert.equal(hasForbiddenColorCooccurrence(["红色", ...colors(result)]), false);
  assert.equal(result.length, 3);
});

test("random candidate order never produces white and colorless together", () => {
  const source = ["白色", "无色", "黄色", "蓝色", "绿色", "红色"].map((color) => ({ color }));
  for (let trial = 0; trial < 20_000; trial += 1) {
    const candidates = [...source].sort(() => Math.random() - 0.5);
    const result = takeWithFinalColorCheck([], candidates, 4, (item) => item.color);
    assert.equal(hasForbiddenColorCooccurrence(colors(result)), false);
    assert.equal(result.length, 4);
  }
});
