"use client";

export const dynamic = "force-static";

import { useCallback, useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import "./review.css";
import { publicPath } from "../public-path";

type Participant = {
  side: "reactant" | "product";
  position: number;
  formulaRaw: string;
  formulaCanonical: string | null;
  coefficientNum: number;
  coefficientDen: number;
  phase: "s" | "l" | "g" | "aq" | null;
  formationMarker: "gas_release" | "precipitate" | null;
  parseStatus: "parsed" | "needs_review";
};

type Condition = {
  type: string;
  operator: string;
  valueText: string | null;
  valueNum: number | null;
  valueNumHigh: number | null;
  unit: string | null;
  relatedFormula: string | null;
  normalizedValue: string | null;
  rawText: string;
};

type Reaction = {
  id: string;
  equationRaw: string;
  equationCanonical: string | null;
  equationKind: "molecular" | "ionic" | "half_reaction";
  direction: string;
  balanceStatus: "balanced" | "imbalanced" | "uncheckable";
  parseStatus: "parsed" | "needs_review";
  isExercise: boolean;
  uncertaintyFlags: string[];
  isManualEdit: boolean;
  manualEditUpdatedAt: string | null;
  reviewStatus: "unreviewed" | "verified" | "rejected";
  participants: Participant[];
  conditions: Condition[];
  source: {
    pdfPage: number;
    printedPage: number | null;
    heading: string | null;
    evidenceText: string;
    markdownPath: string;
    lineStart: number;
    lineEnd: number;
  };
};

type Dataset = {
  metadata: {
    schemaVersion: string;
    reactionCount: number;
    parsedCount: number;
    balancedCount: number;
    needsReviewCount: number;
    imbalancedCount: number;
    uncheckableCount: number;
    conditionsCount: number;
    pagesScanned: number;
    electronReactionCount: number;
    electronParticipantCount: number;
    manualEditCount: number;
    verifiedReviewCount: number;
    rejectedReviewCount: number;
    unreviewedCount: number;
  };
  reactions: Reaction[];
};

type DecisionValue = "verified" | "needs_correction" | "rejected";
type ReviewDecision = {
  decision: DecisionValue;
  correctedEquation?: string;
  note?: string;
  updatedAt: string;
};
type ReviewMap = Record<string, ReviewDecision>;

type QualityFilter = "all" | "ready" | "priority" | "imbalanced" | "uncheckable";
type KindFilter = "all" | Reaction["equationKind"];
type DecisionFilter = "all" | "unreviewed" | DecisionValue;
type EditableParticipant = {
  clientId: string;
  side: "reactant" | "product";
  formulaCanonical: string;
  coefficientNum: number;
  coefficientDen: number;
  phase: Participant["phase"];
  formationMarker: Participant["formationMarker"];
};
type EditableCondition = {
  clientId: string;
  type: string;
  rawText: string;
  relatedFormula: string;
};
type ReactionDraft = {
  direction: string;
  participants: EditableParticipant[];
  conditions: EditableCondition[];
};
type SaveState = "idle" | "saving" | "saved" | "error";

const STORAGE_KEY = "element-chemistry-reaction-review-v1";
const EDIT_API = "http://localhost:3101";
const PAGE_SIZE = 60;
const DEFAULT_IMAGE_ZOOM = 100;

const KIND_LABELS: Record<Reaction["equationKind"], string> = {
  molecular: "分子反应",
  ionic: "离子反应",
  half_reaction: "半反应",
};

const CONDITION_LABELS: Record<string, string> = {
  temperature: "温度",
  medium: "介质",
  concentration: "浓度",
  catalyst: "催化剂",
  light: "光照",
  pressure: "压力",
  excess: "用量",
  atmosphere: "气氛",
  operation: "操作",
  other: "附加条件",
};

const FLAG_LABELS: Record<string, string> = {
  generic_formula: "含通式变量",
  no_element_formula: "物质式未识别",
  unremoved_latex_or_text: "含未解析排版",
  unbalanced_brackets: "括号疑似残缺",
};

function qualityOf(reaction: Reaction): Exclude<QualityFilter, "all"> {
  if (reaction.parseStatus === "needs_review") return "priority";
  if (reaction.balanceStatus === "imbalanced") return "imbalanced";
  if (reaction.balanceStatus === "uncheckable") return "uncheckable";
  return "ready";
}

function qualityLabel(reaction: Reaction): string {
  const quality = qualityOf(reaction);
  if (quality === "ready") return "结构完整 · 配平通过";
  if (quality === "imbalanced") return "配平异常";
  if (quality === "uncheckable") return "暂不可配平检查";
  return "解析异常";
}

function decisionLabel(decision?: ReviewDecision): string {
  if (!decision) return "未复核";
  if (decision.decision === "verified") return "已确认";
  if (decision.decision === "needs_correction") return "需修订";
  return "已排除";
}

function pageImageUrl(pdfPage: number): string {
  return publicPath(`/page-images/pdf_${String(pdfPage).padStart(4, "0")}.jpeg`);
}

function clientId(prefix: string, index = 0): string {
  return `${prefix}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function draftFromReaction(reaction: Reaction): ReactionDraft {
  return {
    direction: reaction.direction,
    participants: reaction.participants.map((participant, index) => ({
      clientId: clientId("participant", index),
      side: participant.side,
      formulaCanonical: participant.formulaCanonical || participant.formulaRaw,
      coefficientNum: participant.coefficientNum,
      coefficientDen: participant.coefficientDen,
      phase: participant.phase,
      formationMarker: participant.formationMarker,
    })),
    conditions: reaction.conditions.map((condition, index) => ({
      clientId: clientId("condition", index),
      type: condition.type,
      rawText: condition.rawText,
      relatedFormula: condition.relatedFormula || "",
    })),
  };
}

function editableParticipantDisplay(participant: EditableParticipant): string {
  const coefficient = participant.coefficientDen === 1
    ? (participant.coefficientNum === 1 ? "" : String(participant.coefficientNum))
    : `${participant.coefficientNum}/${participant.coefficientDen}`;
  const phase = participant.phase ? `(${participant.phase})` : "";
  const marker = participant.formationMarker === "gas_release"
    ? "↑"
    : participant.formationMarker === "precipitate"
      ? "↓"
      : "";
  return `${coefficient}${participant.formulaCanonical}${phase}${marker}`;
}

function equationFromDraft(draft: ReactionDraft): string | null {
  const renderSide = (side: "reactant" | "product") => draft.participants
    .filter((participant) => participant.side === side && participant.formulaCanonical.trim())
    .map(editableParticipantDisplay)
    .join(" + ");
  const reactants = renderSide("reactant");
  const products = renderSide("product");
  if (!reactants || !products) return null;
  const arrow = draft.direction === "irreversible" ? "->" : "<=>";
  return `${reactants} ${arrow} ${products}`;
}

function splitEquation(value: string): { left: string[]; right: string[]; arrow: string } | null {
  const match = value.match(/^(.*?)\s*(<=>|->)\s*(.*?)$/);
  if (!match) return null;
  return {
    left: match[1].split(/\s+\+\s+/),
    right: match[3].split(/\s+\+\s+/),
    arrow: match[2],
  };
}

function ChemicalTerm({ value }: { value: string }) {
  const marker = value.endsWith("↑") ? "↑" : value.endsWith("↓") ? "↓" : "";
  const formula = (marker ? value.slice(0, -1) : value).replaceAll("•", "\\bullet");
  const html = katex.renderToString(`\\ce{${formula}}`, {
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
  return (
    <span className="review-chemical-term">
      <span dangerouslySetInnerHTML={{ __html: html }} />
      {marker ? <sup className="review-formation-marker">{marker}</sup> : null}
    </span>
  );
}

function ChemEquation({
  canonical,
  raw,
  compact = false,
}: {
  canonical: string | null;
  raw: string;
  compact?: boolean;
}) {
  const parsed = canonical ? splitEquation(canonical) : null;
  if (canonical && parsed) {
    const renderSide = (terms: string[]) => terms.map((term, index) => (
      <span className="review-equation-piece" key={`${term}-${index}`}>
        {index ? <span className="review-plus">+</span> : null}
        <ChemicalTerm value={term} />
      </span>
    ));
    return (
      <span className={compact ? "review-equation compact structured" : "review-equation structured"}>
        <span className="review-equation-side">{renderSide(parsed.left)}</span>
        <span className="review-equation-arrow">{parsed.arrow === "<=>" ? "⇌" : "⟶"}</span>
        <span className="review-equation-side">{renderSide(parsed.right)}</span>
      </span>
    );
  }
  if (canonical) {
    return <span className={compact ? "review-equation compact" : "review-equation"}><ChemicalTerm value={canonical} /></span>;
  }
  const html = katex.renderToString(raw, {
    displayMode: !compact,
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
  return (
    <span
      className={compact ? "review-equation compact" : "review-equation"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function participantDisplay(participant: Participant): string {
  const coefficient = participant.coefficientDen === 1
    ? (participant.coefficientNum === 1 ? "" : String(participant.coefficientNum))
    : `${participant.coefficientNum}/${participant.coefficientDen}`;
  const phase = participant.phase ? `(${participant.phase})` : "";
  const marker = participant.formationMarker === "gas_release"
    ? "↑"
    : participant.formationMarker === "precipitate"
      ? "↓"
      : "";
  return `${coefficient}${participant.formulaCanonical || participant.formulaRaw}${phase}${marker}`;
}

function ParticipantFormula({ participant }: { participant: Participant }) {
  return (
    <ChemEquation
      canonical={participant.formulaCanonical ? participantDisplay(participant) : null}
      raw={participant.formulaRaw}
      compact
    />
  );
}

function loadReviewMap(): ReviewMap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export default function ReactionReviewPage() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("priority");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [reviews, setReviews] = useState<ReviewMap>({});
  const [imageZoom, setImageZoom] = useState(DEFAULT_IMAGE_ZOOM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ReactionDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [editServiceAvailable, setEditServiceAvailable] = useState<boolean | null>(null);
  const [manualEditIds, setManualEditIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setReviews(loadReviewMap());
    fetch(publicPath("/reactions.review.v1.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`数据加载失败：${response.status}`);
        return response.json();
      })
      .then((payload: Dataset) => {
        setData(payload);
        setSelectedId(payload.reactions[0]?.id || null);
      })
      .catch((reason: Error) => setError(reason.message));
    fetch(`${EDIT_API}/api/edits`)
      .then((response) => {
        if (!response.ok) throw new Error("本地保存服务不可用");
        return response.json();
      })
      .then((payload: { editIds: string[] }) => {
        setManualEditIds(new Set(payload.editIds || []));
        setEditServiceAvailable(true);
      })
      .catch(() => setEditServiceAvailable(false));
  }, []);

  const persistReviews = useCallback((next: ReviewMap) => {
    setReviews(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.reactions.filter((reaction) => {
      const review = reviews[reaction.id];
      const quality = qualityOf(reaction);
      const qualityMatch = qualityFilter === "all"
        || quality === qualityFilter
        || (qualityFilter === "priority" && quality !== "ready");
      const kindMatch = kindFilter === "all" || reaction.equationKind === kindFilter;
      const reviewValue = reaction.reviewStatus !== "unreviewed"
        ? reaction.reviewStatus
        : reaction.balanceStatus === "balanced"
          ? "verified"
          : review?.decision || "unreviewed";
      const decisionMatch = decisionFilter === "all" || reviewValue === decisionFilter;
      const searchMatch = !needle || [
        reaction.equationCanonical,
        reaction.equationRaw,
        reaction.source.heading,
        reaction.source.pdfPage,
        reaction.source.printedPage,
        ...reaction.conditions.map((condition) => condition.rawText),
      ].some((value) => String(value || "").toLowerCase().includes(needle));
      return qualityMatch && kindMatch && decisionMatch && searchMatch;
    });
  }, [data, search, qualityFilter, kindFilter, decisionFilter, reviews]);

  useEffect(() => {
    setPage(0);
  }, [search, qualityFilter, kindFilter, decisionFilter]);

  useEffect(() => {
    if (filtered.length && !filtered.some((item) => item.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = data?.reactions.find((reaction) => reaction.id === selectedId) || null;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const reviewedCount = data
    ? data.reactions.filter((reaction) => (
        reaction.reviewStatus !== "unreviewed"
        || (reaction.balanceStatus === "balanced" && reaction.reviewStatus !== "rejected")
        || Boolean(reviews[reaction.id])
      )).length
    : 0;
  const currentIndex = selected ? filtered.findIndex((reaction) => reaction.id === selected.id) : -1;

  useEffect(() => {
    setImageZoom(DEFAULT_IMAGE_ZOOM);
    if (selected) setDraft(draftFromReaction(selected));
    setEditorOpen(false);
    setSaveState("idle");
    setSaveMessage("");
  }, [selected?.id]);

  const updateDecision = useCallback((decision: DecisionValue) => {
    if (!selected) return;
    const current = reviews[selected.id];
    persistReviews({
      ...reviews,
      [selected.id]: {
        decision,
        correctedEquation: current?.correctedEquation || selected.equationCanonical || "",
        note: current?.note || "",
        updatedAt: new Date().toISOString(),
      },
    });
  }, [persistReviews, reviews, selected]);

  const updateReviewField = useCallback((field: "correctedEquation" | "note", value: string) => {
    if (!selected) return;
    const current = reviews[selected.id];
    persistReviews({
      ...reviews,
      [selected.id]: {
        decision: current?.decision || "needs_correction",
        correctedEquation: field === "correctedEquation" ? value : current?.correctedEquation || selected.equationCanonical || "",
        note: field === "note" ? value : current?.note || "",
        updatedAt: new Date().toISOString(),
      },
    });
  }, [persistReviews, reviews, selected]);

  const clearDecision = useCallback(() => {
    if (!selected) return;
    const next = { ...reviews };
    delete next[selected.id];
    persistReviews(next);
  }, [persistReviews, reviews, selected]);

  const exportReviews = useCallback(() => {
    const payload = {
      format: "ElementChemistryReactionReview",
      version: 1,
      exportedAt: new Date().toISOString(),
      datasetSchemaVersion: data?.metadata.schemaVersion,
      decisions: reviews,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reaction-review-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [data, reviews]);

  const moveSelection = useCallback((step: number) => {
    if (!filtered.length) return;
    const nextIndex = Math.min(filtered.length - 1, Math.max(0, currentIndex + step));
    const next = filtered[nextIndex];
    setSelectedId(next.id);
    setPage(Math.floor(nextIndex / PAGE_SIZE));
  }, [currentIndex, filtered]);

  const updateDraftParticipant = useCallback((
    itemId: string,
    patch: Partial<EditableParticipant>,
  ) => {
    setDraft((current) => current ? {
      ...current,
      participants: current.participants.map((participant) => (
        participant.clientId === itemId ? { ...participant, ...patch } : participant
      )),
    } : current);
    setSaveState("idle");
  }, []);

  const addDraftParticipant = useCallback((side: "reactant" | "product") => {
    setDraft((current) => current ? {
      ...current,
      participants: [
        ...current.participants,
        {
          clientId: clientId("participant"),
          side,
          formulaCanonical: "",
          coefficientNum: 1,
          coefficientDen: 1,
          phase: null,
          formationMarker: null,
        },
      ],
    } : current);
    setSaveState("idle");
  }, []);

  const removeDraftParticipant = useCallback((itemId: string) => {
    setDraft((current) => current ? {
      ...current,
      participants: current.participants.filter((participant) => participant.clientId !== itemId),
    } : current);
    setSaveState("idle");
  }, []);

  const updateDraftCondition = useCallback((
    itemId: string,
    patch: Partial<EditableCondition>,
  ) => {
    setDraft((current) => current ? {
      ...current,
      conditions: current.conditions.map((condition) => (
        condition.clientId === itemId ? { ...condition, ...patch } : condition
      )),
    } : current);
    setSaveState("idle");
  }, []);

  const addDraftCondition = useCallback(() => {
    setDraft((current) => current ? {
      ...current,
      conditions: [
        ...current.conditions,
        {
          clientId: clientId("condition"),
          type: "other",
          rawText: "",
          relatedFormula: "",
        },
      ],
    } : current);
    setSaveState("idle");
  }, []);

  const removeDraftCondition = useCallback((itemId: string) => {
    setDraft((current) => current ? {
      ...current,
      conditions: current.conditions.filter((condition) => condition.clientId !== itemId),
    } : current);
    setSaveState("idle");
  }, []);

  const reloadDataset = useCallback(async (keepSelectedId: string) => {
    const response = await fetch(publicPath(`/reactions.review.v1.json?updated=${Date.now()}`), {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`数据刷新失败：${response.status}`);
    const payload = await response.json() as Dataset;
    setData(payload);
    setSelectedId(keepSelectedId);
    return payload.reactions.find((reaction) => reaction.id === keepSelectedId) || null;
  }, []);

  const saveDraft = useCallback(async () => {
    if (!selected || !draft) return;
    const reactants = draft.participants.filter((item) => item.side === "reactant" && item.formulaCanonical.trim());
    const products = draft.participants.filter((item) => item.side === "product" && item.formulaCanonical.trim());
    if (!reactants.length || !products.length) {
      setSaveState("error");
      setSaveMessage("反应物和产物至少各保留一项。");
      return;
    }
    setSaveState("saving");
    setSaveMessage("正在写入本地数据并重新校验……");
    try {
      const response = await fetch(`${EDIT_API}/api/edits/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: draft.direction,
          participants: draft.participants
            .filter((participant) => participant.formulaCanonical.trim())
            .map((participant) => ({
              side: participant.side,
              formulaCanonical: participant.formulaCanonical.trim(),
              coefficientNum: participant.coefficientNum,
              coefficientDen: participant.coefficientDen,
              phase: participant.phase,
              formationMarker: participant.formationMarker,
            })),
          conditions: draft.conditions
            .filter((condition) => condition.rawText.trim())
            .map((condition) => ({
              type: condition.type,
              rawText: condition.rawText.trim(),
              relatedFormula: condition.relatedFormula.trim() || null,
            })),
        }),
      });
      const result = await response.json() as {
        ok: boolean;
        error?: string;
        balanceStatus?: Reaction["balanceStatus"];
      };
      if (!response.ok || !result.ok) throw new Error(result.error || "保存失败");
      const refreshed = await reloadDataset(selected.id);
      setManualEditIds((current) => new Set([...current, selected.id]));
      setEditServiceAvailable(true);
      const nextReviews = {
        ...reviews,
        [selected.id]: {
          decision: refreshed?.balanceStatus === "balanced" ? "verified" as const : "needs_correction" as const,
          correctedEquation: refreshed?.equationCanonical || "",
          note: reviews[selected.id]?.note || "",
          updatedAt: new Date().toISOString(),
        },
      };
      persistReviews(nextReviews);
      setSaveState("saved");
      setSaveMessage(
        refreshed?.balanceStatus === "balanced"
          ? "已保存到正式数据，重新检查后配平通过。"
          : "已保存到正式数据，并保留在异常复核队列中。",
      );
    } catch (reason) {
      setEditServiceAvailable(false);
      setSaveState("error");
      setSaveMessage(reason instanceof Error ? reason.message : "保存失败");
    }
  }, [draft, persistReviews, reloadDataset, reviews, selected]);

  const removeManualEdit = useCallback(async () => {
    if (!selected || !manualEditIds.has(selected.id)) return;
    setSaveState("saving");
    setSaveMessage("正在恢复 OCR 提取结果……");
    try {
      const response = await fetch(`${EDIT_API}/api/edits/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "恢复失败");
      await reloadDataset(selected.id);
      setManualEditIds((current) => {
        const next = new Set(current);
        next.delete(selected.id);
        return next;
      });
      setSaveState("saved");
      setSaveMessage("已恢复为 OCR 提取结果。");
    } catch (reason) {
      setSaveState("error");
      setSaveMessage(reason instanceof Error ? reason.message : "恢复失败");
    }
  }, [manualEditIds, reloadDataset, selected]);

  if (error) {
    return <main className="review-load-screen"><div><b>无法打开复核数据</b><p>{error}</p><a href={publicPath("/")}>返回颜色题库</a></div></main>;
  }
  if (!data) {
    return <main className="review-load-screen"><div className="review-loader" /><p>正在整理反应方程式……</p></main>;
  }

  const selectedReview = selected ? reviews[selected.id] : undefined;

  return (
    <main className="review-shell">
      <header className="review-topbar">
        <div className="review-brand">
          <span className="review-brand-mark">Rx</span>
          <div><strong>反应式复核台</strong><small>宋天佑《无机化学》原书扫描页对照复核</small></div>
        </div>
        <div className="review-top-stats" aria-label="复核进度">
          <span><b>{reviewedCount}</b> / {data.metadata.reactionCount} 已确认</span>
          <i><em style={{ width: `${reviewedCount / data.metadata.reactionCount * 100}%` }} /></i>
          <span className="review-verified-count">
            {data.metadata.verifiedReviewCount} 条人工确认 · {data.metadata.rejectedReviewCount} 条排除
          </span>
        </div>
        <nav className="review-nav">
          <a href={publicPath("/")}>颜色题库</a>
          <button onClick={exportReviews} disabled={!reviewedCount}>导出复核结果</button>
        </nav>
      </header>

      <section className="review-workspace">
        <aside className="review-filters">
          <div className="review-panel-heading">
            <span>筛选范围</span>
            <b>{filtered.length.toLocaleString()} 条结果</b>
          </div>

          <label className="review-search">
            <span>搜索</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="化学式、页码或章节"
            />
          </label>

          <fieldset>
            <legend>自动检查</legend>
            {([
              ["all", "全部反应", data.metadata.reactionCount],
              ["ready", "配平通过", data.metadata.balancedCount],
              ["priority", "优先复核", data.metadata.needsReviewCount + data.metadata.imbalancedCount + data.metadata.uncheckableCount],
              ["imbalanced", "配平异常", data.metadata.imbalancedCount],
              ["uncheckable", "暂不可检查", data.metadata.uncheckableCount],
            ] as Array<[QualityFilter, string, number]>).map(([value, label, count]) => (
              <button
                className={qualityFilter === value ? "active" : ""}
                onClick={() => setQualityFilter(value)}
                key={value}
              >
                <span>{label}</span><b>{count}</b>
              </button>
            ))}
          </fieldset>

          <fieldset>
            <legend>方程式类型</legend>
            {([
              ["all", "全部类型"],
              ["molecular", "分子反应"],
              ["ionic", "离子反应"],
              ["half_reaction", "半反应"],
            ] as Array<[KindFilter, string]>).map(([value, label]) => (
              <button
                className={kindFilter === value ? "active" : ""}
                onClick={() => setKindFilter(value)}
                key={value}
              >
                <span>{label}</span>
              </button>
            ))}
          </fieldset>

          <fieldset>
            <legend>人工状态</legend>
            <select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value as DecisionFilter)}>
              <option value="all">全部状态</option>
              <option value="unreviewed">未复核</option>
              <option value="verified">已确认</option>
              <option value="needs_correction">需修订</option>
              <option value="rejected">已排除</option>
            </select>
          </fieldset>

          <div className="review-dataset-note">
            <b>首轮数据范围</b>
            <p>
              {data.metadata.pagesScanned} 页原书扫描图 · {data.metadata.conditionsCount} 项明确条件
              · {data.metadata.electronReactionCount} 条含电子反应
            </p>
            <span>{data.metadata.manualEditCount} 条人工修订已写入正式数据；配平通过项自动视为确认。</span>
          </div>
        </aside>

        <section className="review-list-panel">
          <div className="review-list-toolbar">
            <span>按 PDF 页码排列</span>
            <div>
              <button disabled={page === 0} onClick={() => setPage((current) => current - 1)}>上一页</button>
              <b>{page + 1} / {pageCount}</b>
              <button disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>下一页</button>
            </div>
          </div>
          <div className="review-reaction-list">
            {visible.length ? visible.map((reaction) => {
              const quality = qualityOf(reaction);
              const decision = reviews[reaction.id];
              return (
                <button
                  className={`review-list-item ${selectedId === reaction.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(reaction.id)}
                  key={reaction.id}
                >
                  <span className="review-list-meta">
                    <b>PDF {reaction.source.pdfPage}</b>
                    <em className={`quality-${quality}`}>{qualityLabel(reaction)}</em>
                    {reaction.isManualEdit ? <i className="manual-edit-badge">已修改</i> : null}
                    {reaction.reviewStatus !== "unreviewed"
                      ? <i className={`decision-${reaction.reviewStatus}`}>
                          {reaction.reviewStatus === "verified" ? "已合并确认" : "已合并排除"}
                        </i>
                      : reaction.balanceStatus === "balanced"
                        ? <i className="decision-verified">自动确认</i>
                        : decision ? <i className={`decision-${decision.decision}`}>{decisionLabel(decision)}</i> : null}
                  </span>
                  <ChemEquation canonical={reaction.equationCanonical} raw={reaction.equationRaw} compact />
                  <small>{reaction.source.heading || "教材正文"}</small>
                </button>
              );
            }) : <div className="review-empty">没有符合当前条件的反应式。</div>}
          </div>
        </section>

        <section className="review-detail">
          {selected ? (
            <>
              <header className="review-detail-heading">
                <div>
                  <span className={`review-quality-badge quality-${qualityOf(selected)}`}>{qualityLabel(selected)}</span>
                  <span className="review-kind-badge">{KIND_LABELS[selected.equationKind]}</span>
                  {selected.isManualEdit ? <span className="review-manual-badge">人工修订数据</span> : null}
                </div>
                <div className="review-source-ref">
                  <b>教材第 {selected.source.printedPage || "—"} 页</b>
                  <small>原书扫描图 · PDF 第 {selected.source.pdfPage} 页</small>
                </div>
              </header>

              <div className="review-equation-card">
                <span className="review-section-kicker">规范化方程式</span>
                <ChemEquation canonical={selected.equationCanonical} raw={selected.equationRaw} />
                {selected.conditions.length ? (
                  <div className="review-condition-row">
                    {selected.conditions.map((condition, index) => (
                      <span key={`${condition.type}-${index}`}>
                        <b>{CONDITION_LABELS[condition.type] || condition.type}</b>
                        {condition.relatedFormula ? `${condition.relatedFormula}：` : ""}
                        {condition.rawText}
                      </span>
                    ))}
                  </div>
                ) : <p className="review-no-condition">教材方程式箭头及物质旁未标出附加条件</p>}
              </div>

              {selected.uncertaintyFlags.length ? (
                <div className="review-warning">
                  <b>自动解析提示</b>
                  <div>{selected.uncertaintyFlags.map((flag) => <span key={flag}>{FLAG_LABELS[flag] || flag}</span>)}</div>
                </div>
              ) : null}

              <section className="review-participants">
                <div>
                  <span className="review-section-kicker">反应物</span>
                  {selected.participants.filter((item) => item.side === "reactant").map((participant) => (
                    <div className={participant.parseStatus === "parsed" ? "" : "participant-warning"} key={`${participant.side}-${participant.position}`}>
                      <ParticipantFormula participant={participant} />
                      <small>{participant.phase ? `物态 ${participant.phase}` : "未标物态"}</small>
                    </div>
                  ))}
                </div>
                <span className="review-arrow" aria-hidden="true">→</span>
                <div>
                  <span className="review-section-kicker">产物</span>
                  {selected.participants.filter((item) => item.side === "product").map((participant) => (
                    <div className={participant.parseStatus === "parsed" ? "" : "participant-warning"} key={`${participant.side}-${participant.position}`}>
                      <ParticipantFormula participant={participant} />
                      <small>
                        {participant.formationMarker === "gas_release"
                          ? "放出气体"
                          : participant.formationMarker === "precipitate"
                            ? "生成沉淀"
                            : participant.phase ? `物态 ${participant.phase}` : "未标物态"}
                      </small>
                    </div>
                  ))}
                </div>
              </section>

              <section className="review-evidence">
                <div className="review-section-title">
                  <div>
                    <span className="review-section-kicker">教材原书</span>
                    <h2>PDF 第 {selected.source.pdfPage} 页{selected.source.printedPage ? ` · 书页 ${selected.source.printedPage}` : ""}</h2>
                  </div>
                  <div className="review-image-tools" aria-label="原书图片缩放工具">
                    <button
                      type="button"
                      onClick={() => setImageZoom((value) => Math.max(50, value - 25))}
                      disabled={imageZoom <= 50}
                      aria-label="缩小原书图片"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="review-zoom-value"
                      onClick={() => setImageZoom(DEFAULT_IMAGE_ZOOM)}
                      title="恢复适应宽度"
                    >
                      {imageZoom}%
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageZoom((value) => Math.min(250, value + 25))}
                      disabled={imageZoom >= 250}
                      aria-label="放大原书图片"
                    >
                      +
                    </button>
                    <a
                      href={pageImageUrl(selected.source.pdfPage)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开原图
                    </a>
                  </div>
                </div>
                <div className="review-book-page-frame">
                  <img
                    src={pageImageUrl(selected.source.pdfPage)}
                    alt={`宋天佑《无机化学》PDF 第 ${selected.source.pdfPage} 页原书扫描图`}
                    style={{ width: `${imageZoom}%` }}
                  />
                </div>
              </section>

              <section className="review-structure-editor">
                <div className="review-section-title">
                  <div>
                    <span className="review-section-kicker">结构化数据修订</span>
                    <h2>{selected.isManualEdit ? "已写入人工修订" : "修改方程式"}</h2>
                  </div>
                  <button
                    className="review-editor-toggle"
                    type="button"
                    onClick={() => setEditorOpen((current) => !current)}
                  >
                    {editorOpen ? "收起编辑器" : "编辑反应数据"}
                  </button>
                </div>
                {editServiceAvailable === false ? (
                  <p className="review-save-warning">本地保存服务尚未连接。编辑不受影响，连接后即可写入数据。</p>
                ) : null}
                {editorOpen && draft ? (
                  <div className="review-editor-body">
                    <div className="review-editor-preview">
                      <div>
                        <span className="review-section-kicker">修改预览</span>
                        <ChemEquation
                          canonical={equationFromDraft(draft)}
                          raw={equationFromDraft(draft) || "请补全反应物和产物"}
                        />
                      </div>
                      <label>
                        <span>反应方向</span>
                        <select
                          value={draft.direction}
                          onChange={(event) => {
                            setDraft((current) => current ? { ...current, direction: event.target.value } : current);
                            setSaveState("idle");
                          }}
                        >
                          <option value="irreversible">不可逆 →</option>
                          <option value="reversible">可逆 ⇌</option>
                          <option value="equilibrium">平衡 ⇌</option>
                        </select>
                      </label>
                    </div>

                    <div className="review-editor-sides">
                      {(["reactant", "product"] as const).map((side) => (
                        <fieldset key={side}>
                          <legend>{side === "reactant" ? "反应物" : "产物"}</legend>
                          {draft.participants.filter((item) => item.side === side).map((participant) => (
                            <div className="review-editor-participant" key={participant.clientId}>
                              <label className="coefficient-field">
                                <span>系数</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={participant.coefficientNum}
                                  onChange={(event) => updateDraftParticipant(participant.clientId, {
                                    coefficientNum: Math.max(1, Number(event.target.value) || 1),
                                  })}
                                />
                              </label>
                              <label className="formula-field">
                                <span>化学式</span>
                                <input
                                  value={participant.formulaCanonical}
                                  onChange={(event) => updateDraftParticipant(participant.clientId, {
                                    formulaCanonical: event.target.value,
                                  })}
                                  placeholder="例如 H2O、Fe^3+、e^-"
                                />
                              </label>
                              <label>
                                <span>物态</span>
                                <select
                                  value={participant.phase || ""}
                                  onChange={(event) => updateDraftParticipant(participant.clientId, {
                                    phase: (event.target.value || null) as Participant["phase"],
                                  })}
                                >
                                  <option value="">未标</option>
                                  <option value="s">(s) 固态</option>
                                  <option value="l">(l) 液态</option>
                                  <option value="g">(g) 气态</option>
                                  <option value="aq">(aq) 水溶液</option>
                                </select>
                              </label>
                              <label>
                                <span>生成标记</span>
                                <select
                                  value={participant.formationMarker || ""}
                                  onChange={(event) => updateDraftParticipant(participant.clientId, {
                                    formationMarker: (event.target.value || null) as Participant["formationMarker"],
                                  })}
                                >
                                  <option value="">无</option>
                                  <option value="gas_release">↑ 气体</option>
                                  <option value="precipitate">↓ 沉淀</option>
                                </select>
                              </label>
                              <button
                                type="button"
                                className="review-editor-remove"
                                onClick={() => removeDraftParticipant(participant.clientId)}
                                aria-label={`删除${side === "reactant" ? "反应物" : "产物"} ${participant.formulaCanonical}`}
                              >
                                删除
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="review-editor-add"
                            onClick={() => addDraftParticipant(side)}
                          >
                            + 添加{side === "reactant" ? "反应物" : "产物"}
                          </button>
                        </fieldset>
                      ))}
                    </div>

                    <fieldset className="review-editor-conditions">
                      <legend>反应条件</legend>
                      {draft.conditions.map((condition) => (
                        <div key={condition.clientId}>
                          <select
                            value={condition.type}
                            onChange={(event) => updateDraftCondition(condition.clientId, { type: event.target.value })}
                            aria-label="条件类型"
                          >
                            {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                              <option value={value} key={value}>{label}</option>
                            ))}
                          </select>
                          <input
                            value={condition.rawText}
                            onChange={(event) => updateDraftCondition(condition.clientId, { rawText: event.target.value })}
                            placeholder="条件内容，例如 75 ℃、浓硫酸、光照"
                            aria-label="条件内容"
                          />
                          <input
                            value={condition.relatedFormula}
                            onChange={(event) => updateDraftCondition(condition.clientId, { relatedFormula: event.target.value })}
                            placeholder="关联物质（可选）"
                            aria-label="条件关联物质"
                          />
                          <button
                            type="button"
                            className="review-editor-remove"
                            onClick={() => removeDraftCondition(condition.clientId)}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                      <button type="button" className="review-editor-add" onClick={addDraftCondition}>+ 添加条件</button>
                    </fieldset>

                    <div className="review-editor-savebar">
                      <div>
                        <button
                          type="button"
                          className="review-save-data"
                          onClick={saveDraft}
                          disabled={saveState === "saving"}
                        >
                          {saveState === "saving" ? "正在保存……" : "保存并重新校验"}
                        </button>
                        {manualEditIds.has(selected.id) ? (
                          <button
                            type="button"
                            className="review-restore-data"
                            onClick={removeManualEdit}
                            disabled={saveState === "saving"}
                          >
                            恢复 OCR 结果
                          </button>
                        ) : null}
                      </div>
                      {saveMessage ? <p className={`save-${saveState}`}>{saveMessage}</p> : null}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="review-decision-panel">
                <div className="review-section-title">
                  <div>
                    <span className="review-section-kicker">人工复核</span>
                    <h2>
                      {selected.reviewStatus === "verified"
                        ? "已合并确认"
                        : selected.reviewStatus === "rejected"
                          ? "已合并排除"
                          : selected.balanceStatus === "balanced" && !selectedReview
                            ? "配平通过 · 自动确认"
                            : decisionLabel(selectedReview)}
                    </h2>
                  </div>
                  {selectedReview ? <button className="review-clear" onClick={clearDecision}>清除判断</button> : null}
                </div>
                <div className="review-decision-actions">
                  <button className={selectedReview?.decision === "verified" ? "active verified" : "verified"} onClick={() => updateDecision("verified")}>确认正确</button>
                  <button className={selectedReview?.decision === "needs_correction" ? "active correction" : "correction"} onClick={() => updateDecision("needs_correction")}>需要修订</button>
                  <button className={selectedReview?.decision === "rejected" ? "active rejected" : "rejected"} onClick={() => updateDecision("rejected")}>排除记录</button>
                </div>
                {selectedReview ? (
                  <label className="review-note-editor">
                    <span>复核备注</span>
                    <textarea
                      value={selectedReview.note || ""}
                      onChange={(event) => updateReviewField("note", event.target.value)}
                      placeholder="记录原页核对结果、疑似 OCR 错误或处理建议"
                    />
                  </label>
                ) : null}
              </section>

              <footer className="review-detail-nav">
                <button disabled={currentIndex <= 0} onClick={() => moveSelection(-1)}>← 上一条</button>
                <span>{currentIndex + 1} / {filtered.length}</span>
                <button disabled={currentIndex < 0 || currentIndex + 1 >= filtered.length} onClick={() => moveSelection(1)}>下一条 →</button>
              </footer>
            </>
          ) : <div className="review-empty detail-empty">请选择一条反应式。</div>}
        </section>
      </section>
    </main>
  );
}
