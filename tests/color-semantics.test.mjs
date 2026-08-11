import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  acceptedColorIds,
  colorAcceptanceIndex,
  colorTermsHaveAcceptanceRelation,
  groupByAcceptedColor,
  observationAcceptsColor,
} from "../app/color-semantics.ts";
import { takeWithFinalConflictCheck } from "../app/question-policy.ts";

const materials = JSON.parse(
  await readFile(new URL("../public/materials.v1.json", import.meta.url), "utf8"),
);
const colorByName = new Map(materials.colors.map((color) => [color.name, color]));
const nameByColorId = new Map(materials.colors.map((color) => [color.id, color.name]));

const acceptedNames = (colorName) => {
  const color = colorByName.get(colorName);
  assert.ok(color, `missing color ${colorName}`);
  return new Set(color.acceptedColorIds.map((id) => nameByColorId.get(id)));
};

test("standard color connections are directed and preserve conservative composites", () => {
  assert.deepEqual(acceptedNames("浅黄色"), new Set(["浅黄色", "黄色"]));
  assert.deepEqual(acceptedNames("黄色"), new Set(["黄色"]));
  assert.deepEqual(acceptedNames("橙红色"), new Set(["橙红色", "橙色"]));
  assert.deepEqual(acceptedNames("棕黑色"), new Set(["棕黑色", "棕色", "黑色"]));
  assert.deepEqual(acceptedNames("黄绿色"), new Set(["黄绿色"]));
});

test("every raw spelling has a bidirectional standard-term mapping", () => {
  assert.equal(materials.metadata.rawColorExpressionCount, materials.rawColorMappings.length);
  assert.ok(materials.rawColorMappings.length >= 132);
  assert.ok(materials.rawColorMappings.every((mapping) => mapping.colorIds.length > 0));
  for (const mapping of materials.rawColorMappings) {
    for (const colorId of mapping.colorIds) {
      const term = materials.colors.find((color) => color.id === colorId);
      assert.ok(term?.sourceAliases.includes(mapping.raw), `${mapping.raw} is missing from reverse aliases`);
    }
  }
});

test("white-yellow ranges include endpoints and familiar intermediate terms", () => {
  const mapping = materials.rawColorMappings.find((item) => item.raw === "白-黄");
  assert.ok(mapping);
  assert.deepEqual(
    new Set(mapping.colors),
    new Set(["白色", "近白色", "浅黄色", "淡黄色", "黄色"]),
  );

  const seleniumTetrachloride = materials.observations.filter((item) => item.formula === "SeCl4");
  assert.equal(seleniumTetrachloride.length, 2);
  for (const observation of seleniumTetrachloride) {
    const names = new Set(acceptedColorIds(observation).map((id) => nameByColorId.get(id)));
    assert.ok(names.has("白色"));
    assert.ok(names.has("浅黄色"));
    assert.ok(names.has("黄色"));
  }
});

test("reverse question groups use acceptable colors instead of exact color IDs", () => {
  const eligible = materials.observations.filter((item) => item.selectionQuestionEligible);
  const groups = groupByAcceptedColor(eligible);
  const yellowId = colorByName.get("黄色").id;
  const lightYellowRows = eligible.filter((item) => item.color === "浅黄色");
  assert.ok(lightYellowRows.length > 0);
  assert.ok(lightYellowRows.every((item) => observationAcceptsColor(item, yellowId)));
  assert.ok(lightYellowRows.every((item) => groups.get(yellowId).includes(item)));
});

test("final choices reject acceptance relations between every pair", () => {
  const acceptance = colorAcceptanceIndex(materials.colors);
  const lightYellowId = colorByName.get("浅黄色").id;
  const yellowId = colorByName.get("黄色").id;
  const blueId = colorByName.get("蓝色").id;
  const redId = colorByName.get("红色").id;
  const conflicts = (left, right) => colorTermsHaveAcceptanceRelation(acceptance, left, right);

  assert.equal(conflicts(lightYellowId, yellowId), true);
  assert.equal(conflicts(yellowId, lightYellowId), true);
  const selected = takeWithFinalConflictCheck(
    [redId],
    [lightYellowId, yellowId, blueId],
    3,
    (colorId) => colorId,
    conflicts,
  );
  assert.deepEqual(selected, [lightYellowId, blueId]);
});

test("pairwise acceptance conflicts apply only to substance-to-color questions", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const paper = await readFile(new URL("../app/paper-mode.tsx", import.meta.url), "utf8");
  const interactiveColorOf = page.slice(
    page.indexOf("function generateColorQuestion"),
    page.indexOf("function generateSingleSubstanceQuestion"),
  );
  const interactiveColorToOne = page.slice(
    page.indexOf("function generateSingleSubstanceQuestion"),
    page.indexOf("function generateSelectionQuestion"),
  );
  const interactiveColorToMany = page.slice(
    page.indexOf("function generateSelectionQuestion"),
    page.indexOf("function generateQuestion("),
  );
  assert.match(interactiveColorOf, /takeWithFinalConflictCheck/);
  assert.doesNotMatch(interactiveColorToOne, /takeWithFinalConflictCheck/);
  assert.doesNotMatch(interactiveColorToMany, /takeWithFinalConflictCheck/);

  const paperColorOf = paper.slice(paper.indexOf("function makeColorOf"), paper.indexOf("function makeWhichOne"));
  const paperReverse = paper.slice(paper.indexOf("function makeWhichOne"), paper.indexOf("function observationStudyElements"));
  assert.match(paperColorOf, /takeWithFinalConflictCheck/);
  assert.doesNotMatch(paperReverse, /takeWithFinalConflictCheck/);
});
