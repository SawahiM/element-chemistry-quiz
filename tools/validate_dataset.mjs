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
const allowedStateCategories = new Set(["solid", "liquid", "gas", "solution", "unknown"]);
const formsByCategory = {
  solid: new Set([null, "crystal", "powder", "precipitate", "film", "amorphous", "bulk", "suspension", "smoke", "other"]),
  liquid: new Set([null, "melt", "bead", "colloid", "mist", "other"]),
  gas: new Set([null, "vapor", "flame", "other"]),
  solution: new Set([null]),
  unknown: new Set([null]),
};
const missingStructuredStates = materials.observations.filter((row) =>
  !allowedStateCategories.has(row.stateCategory)
  || !row.physicalState
  || !row.stateBasis
  || typeof row.stateConfidence !== "number"
  || !row.stateInferenceRule
  || !row.stateEvidenceText
);
const incompatibleStructuredStates = materials.observations.filter((row) =>
  !formsByCategory[row.stateCategory]?.has(row.stateForm ?? null)
  || (row.stateCategory === "unknown") !== (row.stateBasis === "unresolved")
);
const eligibleSingle = materials.observations.filter((row) => row.colorQuestionEligible);
const eligibleMulti = materials.observations.filter((row) => row.selectionQuestionEligible);
const acceptedColorIds = (row) => row.acceptedColorIds?.length ? row.acceptedColorIds : [row.colorId];
const colorGroups = new Map();
for (const row of eligibleMulti) {
  for (const colorId of acceptedColorIds(row)) {
    const group = colorGroups.get(colorId) || new Set();
    group.add(row.substanceId);
    colorGroups.set(colorId, group);
  }
}
const viableMultiColors = [...colorGroups.values()].filter((group) => group.size >= 3).length;
const colorNames = new Map(materials.colors.map((color) => [color.id, color.name]));
const reverseTargets = eligibleMulti.flatMap((target) => acceptedColorIds(target).map((colorId) => ({ colorId })));
const singleReverseViable = reverseTargets.filter(({ colorId }) => {
  const substancesWithTargetColor = colorGroups.get(colorId) || new Set();
  const targetColor = colorNames.get(colorId);
  const wrongSubstances = new Set(eligibleMulti.filter((row) => {
    const whiteColorlessConflict = targetColor !== row.color &&
      [targetColor, row.color].every((color) => color === "白色" || color === "无色");
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
if (missingStructuredStates.length) throw new Error(`${missingStructuredStates.length} observations have incomplete structured states`);
if (incompatibleStructuredStates.length) throw new Error(`${incompatibleStructuredStates.length} observations have incompatible category/form/basis combinations`);
if (eligibleSingle.length < 4) throw new Error("Not enough single-choice observations");
if (viableMultiColors < 2) throw new Error("Not enough colors for multiple-choice generation");
if (singleReverseViable !== reverseTargets.length) {
  throw new Error(`${reverseTargets.length - singleReverseViable} accepted observation/color pairs cannot generate four-choice reverse questions`);
}
if (!materials.rawColorMappings?.length || materials.rawColorMappings.length !== materials.metadata.rawColorExpressionCount) {
  throw new Error("Raw color mappings are missing or incomplete");
}
if (materials.colors.some((color) => !color.acceptedColorIds?.includes(color.id) || !Array.isArray(color.sourceAliases))) {
  throw new Error("Standard colors must expose reflexive connections and reverse raw aliases");
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
  ammoniumSulfideColors.size !== 1
  || !ammoniumSulfideColors.has("无色")
  || ammoniumSulfideRows.some((row) => row.stateCategory !== "solution" || row.medium !== "水")
  || ammoniumSulfideRows.some((row) => !row.colorQuestionEligible || !row.selectionQuestionEligible)
) {
  throw new Error("(NH4)2S must be represented as a colorless aqueous solution");
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
  reverseTargetPairs: reverseTargets.length,
  focusElementCount: new Set(materials.observations.map((row) => row.focusElement).filter(Boolean)).size,
  ammoniumSulfideColors: [...ammoniumSulfideColors].sort(),
  multiColorQualifiedSubstances,
  whiteColorlessMutualExclusion: true,
  stateCategories: Object.fromEntries([...allowedStateCategories].map((category) => [
    category,
    materials.observations.filter((row) => row.stateCategory === category).length,
  ])),
  stateUnknownCount: materials.observations.filter((row) => row.stateCategory === "unknown").length,
  formats: language.formats.map((item) => item.id),
}, null, 2));

if (failures.length) process.exitCode = 2;
