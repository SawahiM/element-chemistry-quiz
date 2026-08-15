export type StateCategory = "solid" | "liquid" | "gas" | "solution" | "unknown";

export type MaterialStateView = {
  physicalState?: string | null;
  stateCategory: StateCategory;
  stateForm: string | null;
  stateFormRaw?: string | null;
  stateVariantType?: string | null;
  stateVariantLabelRaw?: string | null;
  stateBasis: "explicit" | "contextual" | "reference_inferred" | "unresolved";
  stateEvidenceText?: string | null;
  stateInferenceRule?: string | null;
  medium?: string | null;
  conditions?: string | null;
};

const CATEGORY_LABELS: Record<StateCategory, string> = {
  solid: "固体",
  liquid: "液体",
  gas: "气体",
  solution: "溶液",
  unknown: "状态未明",
};

const FORM_LABELS: Record<string, string> = {
  crystal: "晶体",
  powder: "粉末",
  precipitate: "沉淀",
  film: "薄膜",
  amorphous: "无定形体",
  bulk: "块状",
  melt: "熔体",
  bead: "熔珠",
  vapor: "蒸气",
  colloid: "胶体",
  suspension: "悬浊物",
  smoke: "烟",
  mist: "雾",
  flame: "火焰",
  other: "其他形态",
};

export function stateBasisLabel(observation: MaterialStateView): string {
  if (observation.stateInferenceRule?.startsWith("R-MANUAL-")) return "人工复核";
  return {
    explicit: "原文明示",
    contextual: "原文语境判定",
    reference_inferred: "资料推定",
    unresolved: "状态未确定",
  }[observation.stateBasis];
}

export function stateLabel(observation: MaterialStateView): string {
  if (observation.stateCategory === "solution" && observation.medium) {
    const medium = observation.medium.trim();
    if (medium === "水" || medium === "水中") return "水溶液";
    if (medium.endsWith("溶液")) return medium;
    return `${medium}溶液`;
  }
  const category = CATEGORY_LABELS[observation.stateCategory] || observation.physicalState || "状态未明";
  const form = observation.stateForm ? FORM_LABELS[observation.stateForm] || observation.stateFormRaw : null;
  const variant = observation.stateVariantLabelRaw?.trim();
  return `${category}${form ? ` · ${form}` : ""}${variant ? `（${variant}）` : ""}`;
}

function conditionParts(observation: MaterialStateView): string[] {
  const state = stateLabel(observation);
  const parts = (observation.conditions || "")
    .split(/[；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== state && !(state === "水溶液" && item === "水溶液"));
  return [...new Set(parts)];
}

export function stateContextParts(observation: MaterialStateView): string[] {
  const state = stateLabel(observation);
  const medium = observation.medium?.trim();
  return [
    state,
    observation.stateCategory !== "solution" && medium ? medium : null,
    ...conditionParts(observation),
  ].filter((item): item is string => Boolean(item));
}

export function stateContextText(observation: MaterialStateView): string {
  return stateContextParts(observation).join("；");
}

export function stateQualifier(observation: MaterialStateView): string {
  const text = stateContextText(observation);
  return text ? `（${text}）` : "";
}

export function sameStructuredState(left: MaterialStateView, right: MaterialStateView): boolean {
  return left.stateCategory === right.stateCategory
    && left.stateForm === right.stateForm
    && left.stateVariantType === right.stateVariantType
    && left.stateVariantLabelRaw === right.stateVariantLabelRaw
    && left.medium === right.medium
    && left.conditions === right.conditions;
}

export function structuredStateKey(observation: MaterialStateView): string {
  return JSON.stringify([
    observation.stateCategory,
    observation.stateForm,
    observation.stateVariantType,
    observation.stateVariantLabelRaw,
    observation.medium,
    observation.conditions,
  ]);
}
