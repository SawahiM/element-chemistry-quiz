import fs from "node:fs/promises";
import katex from "katex";
import "katex/contrib/mhchem";

const root = new URL("../", import.meta.url);
const materials = JSON.parse(await fs.readFile(new URL("public/materials.v1.json", root), "utf8"));
const language = JSON.parse(await fs.readFile(new URL("public/question-formats.cqf.json", root), "utf8"));

const failures = [];
const seenFormula = new Set();
for (const row of materials.observations) {
  if (!row.formulaMhchem || seenFormula.has(row.formulaMhchem)) continue;
  seenFormula.add(row.formulaMhchem);
  try {
    katex.renderToString(`\\ce{${row.formulaMhchem}}`, { throwOnError: true, strict: "ignore" });
  } catch (error) {
    failures.push({ formula: row.formulaMhchem, message: error.message });
  }
}

const missingSources = materials.observations.filter((row) => !row.sources?.length);
const eligibleSingle = materials.observations.filter((row) => row.colorQuestionEligible);
const eligibleMulti = materials.observations.filter((row) => row.selectionQuestionEligible);
const colorGroups = new Map();
for (const row of eligibleMulti) {
  const group = colorGroups.get(row.colorId) || new Set();
  group.add(row.substanceId);
  colorGroups.set(row.colorId, group);
}
const viableMultiColors = [...colorGroups.values()].filter((group) => group.size >= 3).length;
const singleReverseViable = eligibleMulti.filter((target) => {
  const substancesWithTargetColor = colorGroups.get(target.colorId) || new Set();
  const wrongSubstances = new Set(eligibleMulti.filter((row) => {
    const whiteColorlessConflict = target.color !== row.color &&
      [target.color, row.color].every((color) => color === "白色" || color === "无色");
    return !substancesWithTargetColor.has(row.substanceId) && !whiteColorlessConflict;
  }).map((row) => row.substanceId));
  return wrongSubstances.size >= 3;
}).length;

if (language.language !== "ChemQuizFormat" || !language.version.startsWith("1.")) {
  throw new Error("ChemQuizFormat header is invalid");
}
const requiredFormats = ["color_of", "which_one_is_color", "which_are_color"];
if (requiredFormats.some((id) => !language.formats.some((format) => format.id === id))) {
  throw new Error("All three question formats are required");
}
if (missingSources.length) throw new Error(`${missingSources.length} observations have no source`);
if (eligibleSingle.length < 4) throw new Error("Not enough single-choice observations");
if (viableMultiColors < 2) throw new Error("Not enough colors for multiple-choice generation");
if (singleReverseViable !== eligibleMulti.length) {
  throw new Error(`${eligibleMulti.length - singleReverseViable} observations cannot generate four-choice reverse questions`);
}
const reverseSingleFormat = language.formats.find((item) => item.id === "which_one_is_color");
if (reverseSingleFormat?.questionType !== "single_choice" || reverseSingleFormat?.choices?.count !== 4) {
  throw new Error("Reverse single-choice format is invalid");
}
const colorFormat = language.formats.find((item) => item.id === "color_of");
const forbiddenPairs = colorFormat?.choices?.distractors?.forbidColorPairs || [];
if (!forbiddenPairs.some((pair) => pair.includes("白色") && pair.includes("无色"))) {
  throw new Error("White/colorless distractor exclusion is missing");
}
const leadRows = materials.observations.filter((row) => ["PbO", "PbO2", "PbCO3"].includes(row.formula));
if (!leadRows.length || leadRows.some((row) => row.focusElement !== "Pb")) {
  throw new Error("Lead compounds do not share the expected focus element");
}
const ammoniumSulfideRows = materials.observations.filter((row) => row.formula === "(NH4)2S");
const ammoniumSulfideColors = new Set(ammoniumSulfideRows.map((row) => row.color));
if (
  ammoniumSulfideColors.size !== 2
  || !ammoniumSulfideColors.has("黄色")
  || !ammoniumSulfideColors.has("橙色")
  || ammoniumSulfideRows.some((row) => !row.colorQuestionEligible || !row.selectionQuestionEligible)
) {
  throw new Error("(NH4)2S must accept both yellow and orange");
}
const colorsByQualifiedSubstance = new Map();
for (const row of materials.observations) {
  const key = JSON.stringify([
    row.substanceId,
    row.physicalState,
    row.observationKind,
    row.medium,
    row.conditions,
  ]);
  const colors = colorsByQualifiedSubstance.get(key) || new Set();
  colors.add(row.colorId);
  colorsByQualifiedSubstance.set(key, colors);
}
const multiColorQualifiedSubstances = [...colorsByQualifiedSubstance.values()]
  .filter((colors) => colors.size > 1).length;

console.log(JSON.stringify({
  observations: materials.observations.length,
  uniqueFormulasRendered: seenFormula.size,
  mhchemRenderFailures: failures.length,
  failureExamples: failures.slice(0, 10),
  eligibleSingle: eligibleSingle.length,
  eligibleMulti: eligibleMulti.length,
  viableMultiColors,
  singleReverseViable,
  focusElementCount: new Set(materials.observations.map((row) => row.focusElement).filter(Boolean)).size,
  ammoniumSulfideAcceptedColors: [...ammoniumSulfideColors].sort(),
  multiColorQualifiedSubstances,
  whiteColorlessMutualExclusion: true,
  formats: language.formats.map((item) => item.id),
}, null, 2));

if (failures.length) process.exitCode = 2;
