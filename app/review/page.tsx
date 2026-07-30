"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import "./review.css";

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

const STORAGE_KEY = "element-chemistry-reaction-review-v1";
const PAGE_SIZE = 60;

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
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [reviews, setReviews] = useState<ReviewMap>({});

  useEffect(() => {
    setReviews(loadReviewMap());
    fetch("/reactions.review.v1.json")
      .then((response) => {
        if (!response.ok) throw new Error(`数据加载失败：${response.status}`);
        return response.json();
      })
      .then((payload: Dataset) => {
        setData(payload);
        setSelectedId(payload.reactions[0]?.id || null);
      })
      .catch((reason: Error) => setError(reason.message));
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
      const reviewValue = review?.decision || "unreviewed";
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
  const reviewedCount = Object.keys(reviews).length;
  const verifiedCount = Object.values(reviews).filter((item) => item.decision === "verified").length;
  const currentIndex = selected ? filtered.findIndex((reaction) => reaction.id === selected.id) : -1;

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

  if (error) {
    return <main className="review-load-screen"><div><b>无法打开复核数据</b><p>{error}</p><a href="/">返回颜色题库</a></div></main>;
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
          <div><strong>反应式复核台</strong><small>宋天佑《无机化学》OCR 结构化校对</small></div>
        </div>
        <div className="review-top-stats" aria-label="复核进度">
          <span><b>{reviewedCount}</b> / {data.metadata.reactionCount} 已处理</span>
          <i><em style={{ width: `${reviewedCount / data.metadata.reactionCount * 100}%` }} /></i>
          <span className="review-verified-count">{verifiedCount} 条确认正确</span>
        </div>
        <nav className="review-nav">
          <a href="/">颜色题库</a>
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
            <p>{data.metadata.pagesScanned} 页 OCR · {data.metadata.conditionsCount} 项明确条件</p>
            <span>当前判断保存在本机浏览器；导出后再批量写回正式数据。</span>
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
                    {decision ? <i className={`decision-${decision.decision}`}>{decisionLabel(decision)}</i> : null}
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
                </div>
                <div className="review-source-ref">
                  <b>教材第 {selected.source.printedPage || "—"} 页</b>
                  <small>PDF 第 {selected.source.pdfPage} 页 · OCR 行 {selected.source.lineStart}</small>
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

              <details className="review-ocr-block">
                <summary><span>OCR 原始反应式</span><em>点击展开</em></summary>
                <code>{selected.equationRaw}</code>
              </details>

              <section className="review-evidence">
                <div className="review-section-title">
                  <div><span className="review-section-kicker">教材证据</span><h2>{selected.source.heading || "所在段落"}</h2></div>
                  <code>{selected.source.markdownPath}:{selected.source.lineStart}</code>
                </div>
                <p>{selected.source.evidenceText}</p>
              </section>

              <section className="review-decision-panel">
                <div className="review-section-title">
                  <div><span className="review-section-kicker">人工复核</span><h2>{decisionLabel(selectedReview)}</h2></div>
                  {selectedReview ? <button className="review-clear" onClick={clearDecision}>清除判断</button> : null}
                </div>
                <div className="review-decision-actions">
                  <button className={selectedReview?.decision === "verified" ? "active verified" : "verified"} onClick={() => updateDecision("verified")}>确认正确</button>
                  <button className={selectedReview?.decision === "needs_correction" ? "active correction" : "correction"} onClick={() => updateDecision("needs_correction")}>需要修订</button>
                  <button className={selectedReview?.decision === "rejected" ? "active rejected" : "rejected"} onClick={() => updateDecision("rejected")}>排除记录</button>
                </div>
                {selectedReview?.decision === "needs_correction" ? (
                  <label className="review-correction-editor">
                    <span>修订后的规范方程式</span>
                    <input
                      value={selectedReview.correctedEquation || ""}
                      onChange={(event) => updateReviewField("correctedEquation", event.target.value)}
                      placeholder="例如：2H2 + O2 -> 2H2O"
                    />
                    {selectedReview.correctedEquation ? (
                      <div><ChemEquation canonical={selectedReview.correctedEquation} raw={selectedReview.correctedEquation} /></div>
                    ) : null}
                  </label>
                ) : null}
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
