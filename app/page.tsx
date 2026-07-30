"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import EquationQuiz from "./equation-quiz";
import { forbiddenColorPair, takeWithFinalColorCheck } from "./question-policy";

type Source = {
  source_id: string;
  pdf_page: number;
  printed_page: number | null;
  evidence_text: string;
};

type Observation = {
  id: string;
  substanceId: string;
  colorId: string;
  formula: string | null;
  formulaMhchem: string | null;
  focusElement: string | null;
  name: string | null;
  displayLabel: string;
  displayMode: "mhchem" | "text";
  color: string;
  colorKind: string;
  physicalState: string | null;
  observationKind: string;
  medium: string | null;
  conditions: string | null;
  colorQuestionEligible: boolean;
  selectionQuestionEligible: boolean;
  sources: Source[];
};

type Materials = {
  metadata: {
    dataset_version?: string;
    substanceCount: number;
    observationCount: number;
    sourceCount: number;
    colorQuestionEligibleCount: number;
    selectionQuestionEligibleCount: number;
  };
  observations: Observation[];
};

type Choice = {
  id: string;
  label: string;
  observation?: Observation;
};

type QuestionFormat = "color_of" | "which_one_is_color" | "which_are_color";

type FormatSpec = {
  id: QuestionFormat;
  label: string;
  questionType: "single_choice" | "multiple_choice";
  generator: "observation_to_color" | "color_to_one_substance" | "color_to_substances";
  choices: {
    count: number;
    correctCount?: { min: number; max: number };
    distractors?: {
      focusElementProbability?: number;
      focusElementMaxChoices?: number;
      forbidColorPairs?: string[][];
    };
  };
};

type FormatLanguage = {
  language: "ChemQuizFormat";
  version: string;
  formats: FormatSpec[];
};

type GeneratedQuestion = {
  id: string;
  format: QuestionFormat;
  target: Observation;
  targetColor?: string;
  choices: Choice[];
  correctIds: Set<string>;
  evidence: Observation[];
};

type EvidenceGroup = {
  key: string;
  representative: Observation;
  colors: string[];
  sources: Source[];
};

type PracticeEntry = {
  question: GeneratedQuestion;
  selected: Set<string>;
  submitted: boolean;
};

type StoredQuestion = {
  id: string;
  format: QuestionFormat;
  targetId: string;
  targetColor?: string;
  choices: Array<{ id: string; label: string; observationId?: string }>;
  correctIds: string[];
  evidenceIds: string[];
};

type StoredSession = {
  version: 1;
  datasetVersion: string;
  savedAt: string;
  elementScope?: string[];
  appMode: AppMode;
  practiceHistory: Array<{
    question: StoredQuestion;
    selected: string[];
    submitted: boolean;
  }>;
  practiceDraft?: {
    question: StoredQuestion;
    selected: string[];
  };
  practiceIndex: number;
  stats: { answered: number; correct: number; streak: number };
  examConfig: ExamConfig;
  examQuestions: StoredQuestion[];
  examAnswers: string[][];
  examIndex: number;
  examStartedAt: number | null;
  examEndedAt: number | null;
};

type AppMode = "practice" | "exam_setup" | "exam_running" | "exam_result";

type ExamConfig = {
  durationMinutes: number;
  totalPoints: number;
  counts: Record<QuestionFormat, number>;
};

type ExamBreakdown = Record<QuestionFormat, { answered: number; correct: number }>;

const FORMAT_ORDER: QuestionFormat[] = ["color_of", "which_one_is_color", "which_are_color"];
const SESSION_STORAGE_KEY = "element-chemistry-quiz-session-v1";

const DEFAULT_EXAM_CONFIG: ExamConfig = {
  durationMinutes: 20,
  totalPoints: 100,
  counts: { color_of: 10, which_one_is_color: 10, which_are_color: 10 },
};

type ElementGroup = { id: string; label: string; elements: string[] };

const NOBLE_GASES = new Set(["He", "Ne", "Ar", "Kr", "Xe", "Rn", "Og"]);
const PERIODIC_ROWS: Array<Array<string | null>> = [
  ["H", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "He"],
  ["Li", "Be", null, null, null, null, null, null, null, null, null, null, "B", "C", "N", "O", "F", "Ne"],
  ["Na", "Mg", null, null, null, null, null, null, null, null, null, null, "Al", "Si", "P", "S", "Cl", "Ar"],
  ["K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr"],
  ["Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe"],
  ["Cs", "Ba", "La", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn"],
  ["Fr", "Ra", "Ac", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og"],
];
const LANTHANIDE_ROW = ["Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu"];
const ACTINIDE_ROW = ["Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr"];
const ALL_ELEMENT_SYMBOLS = PERIODIC_ROWS.flatMap((row) => row.filter((symbol): symbol is string => Boolean(symbol)))
  .concat(LANTHANIDE_ROW, ACTINIDE_ROW);
const ALLOWED_ELEMENTS = ALL_ELEMENT_SYMBOLS;
const DEFAULT_ELEMENT_SCOPE = new Set(ALLOWED_ELEMENTS);
const LEGACY_DEFAULT_ELEMENT_SCOPE = new Set(
  ALL_ELEMENT_SYMBOLS.filter((symbol) => symbol !== "H" && !NOBLE_GASES.has(symbol)),
);
const S_BLOCK_STUDY_ELEMENTS = new Set(["Li", "Na", "K", "Rb", "Cs", "Fr", "Be", "Mg", "Ca", "Sr", "Ba", "Ra"]);

const CHAPTER_ELEMENT_GROUPS: ElementGroup[] = [
  { id: "hydrogen", label: "氢", elements: ["H"] },
  { id: "alkali_alkaline", label: "碱金属和碱土金属", elements: ["Li", "Na", "K", "Rb", "Cs", "Fr", "Be", "Mg", "Ca", "Sr", "Ba", "Ra"] },
  { id: "boron", label: "硼族", elements: ["B", "Al", "Ga", "In", "Tl"] },
  { id: "carbon", label: "碳族", elements: ["C", "Si", "Ge", "Sn", "Pb"] },
  { id: "nitrogen", label: "氮族", elements: ["N", "P", "As", "Sb", "Bi"] },
  { id: "oxygen", label: "氧族", elements: ["O", "S", "Se", "Te", "Po"] },
  { id: "halogen", label: "卤素", elements: ["F", "Cl", "Br", "I", "At"] },
  { id: "copper_zinc", label: "铜锌副族", elements: ["Cu", "Ag", "Au", "Zn", "Cd", "Hg"] },
  { id: "titanium", label: "钛副族", elements: ["Ti", "Zr", "Hf"] },
  { id: "vanadium", label: "钒副族", elements: ["V", "Nb", "Ta"] },
  { id: "chromium", label: "铬副族", elements: ["Cr", "Mo", "W"] },
  { id: "manganese", label: "锰副族", elements: ["Mn", "Tc", "Re"] },
  { id: "iron", label: "铁系", elements: ["Fe", "Co", "Ni"] },
  { id: "platinum", label: "铂系", elements: ["Ru", "Rh", "Pd", "Os", "Ir", "Pt"] },
  { id: "lanthanides", label: "镧系", elements: ["La", ...LANTHANIDE_ROW] },
  { id: "actinides", label: "锕系", elements: ["Ac", ...ACTINIDE_ROW] },
  { id: "noble_gases", label: "稀有气体", elements: [...NOBLE_GASES] },
];

const COMPETITION_ELEMENT_PRESETS: ElementGroup[] = [
  { id: "period4_transition", label: "第四周期过渡金属", elements: ["Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn"] },
  { id: "metalloids", label: "类金属", elements: ["B", "Si", "Ge", "As", "Sb", "Te"] },
  { id: "active_nonmetals", label: "活泼非金属", elements: ["C", "N", "O", "F", "P", "S", "Cl", "Se", "Br", "I"] },
  { id: "variable_valence", label: "竞赛常见变价金属", elements: ["Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Mo", "W"] },
  { id: "coordination_color", label: "典型配位与有色离子", elements: ["Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Mo", "Ru", "Rh", "Pd", "W", "Os", "Ir", "Pt"] },
  { id: "amphoteric", label: "常见两性元素", elements: ["Be", "Al", "Zn", "Ga", "Ge", "Cr", "Sn", "Pb"] },
];

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function normalizeMarkdownMath(value: string): string {
  return value
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression: string) => `$${expression.trim()}$`);
}

function MarkdownText({ children, inline = false }: { children: string; inline?: boolean }) {
  const markdown = normalizeMarkdownMath(children);
  if (inline) {
    return (
      <span className="markdown-text inline">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          skipHtml
          components={{
            p: ({ children: content }) => <>{content}</>,
            a: ({ node: _node, children: content, ...props }) => <a {...props} target="_blank" rel="noreferrer">{content}</a>,
          }}
        >
          {markdown}
        </ReactMarkdown>
      </span>
    );
  }
  return (
    <div className="markdown-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          a: ({ node: _node, children: content, ...props }) => <a {...props} target="_blank" rel="noreferrer">{content}</a>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function Formula({ observation, compact = false }: { observation: Observation; compact?: boolean }) {
  if (observation.displayMode !== "mhchem" || !observation.formulaMhchem) {
    return <span className={compact ? "formula compact" : "formula"}>{observation.displayLabel}</span>;
  }
  const html = katex.renderToString(`\\ce{${observation.formulaMhchem}}`, {
    throwOnError: false,
    strict: "ignore",
    output: "html",
  });
  return (
    <span className={compact ? "formula compact" : "formula"} aria-label={observation.displayLabel}>
      <span dangerouslySetInnerHTML={{ __html: html }} />
      {observation.name ? <span className="formula-note">（{observation.name}）</span> : null}
    </span>
  );
}

function sourcePageLabel(source: Source): string {
  return source.printed_page ? `教材第 ${source.printed_page} 页` : `PDF 第 ${source.pdf_page} 页`;
}

function PagePreview({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  const imageUrl = `/page-images/pdf_${String(source.pdf_page).padStart(4, "0")}.jpeg`;
  return (
    <details className="page-preview" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span><b>{sourcePageLabel(source)}</b><small>PDF 第 {source.pdf_page} 页</small></span>
        <em>{open ? "收起原页" : "点击展开原页"}</em>
      </summary>
      {open ? (
        <a href={imageUrl} target="_blank" rel="noreferrer" title="单独查看原页图片">
          <img
            src={imageUrl}
            alt={`《无机化学》${sourcePageLabel(source)}原图`}
            width="1317"
            height="1871"
            loading="lazy"
            decoding="async"
          />
        </a>
      ) : null}
    </details>
  );
}

function qualifier(observation: Observation): string {
  const parts = [observation.conditions, observation.medium, observation.physicalState].filter(Boolean);
  return parts.length ? `（${parts.join("；")}）` : "";
}

function hasSameQualifier(left: Observation, right: Observation): boolean {
  return left.physicalState === right.physicalState
    && left.observationKind === right.observationKind
    && left.medium === right.medium
    && left.conditions === right.conditions;
}

function groupEvidenceObservations(observations: Observation[]): EvidenceGroup[] {
  const groups = new Map<string, EvidenceGroup>();
  for (const observation of observations) {
    const sourceSignature = observation.sources
      .map((source) => [source.pdf_page, source.printed_page, source.evidence_text])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const key = JSON.stringify([
      observation.substanceId,
      observation.physicalState,
      observation.observationKind,
      observation.medium,
      observation.conditions,
      sourceSignature,
    ]);
    const existing = groups.get(key);
    if (existing) {
      if (!existing.colors.includes(observation.color)) existing.colors.push(observation.color);
      existing.sources = uniqueBy([...existing.sources, ...observation.sources], (source) =>
        JSON.stringify([source.pdf_page, source.printed_page, source.evidence_text])
      );
      continue;
    }
    groups.set(key, {
      key,
      representative: observation,
      colors: [observation.color],
      sources: observation.sources,
    });
  }
  return [...groups.values()].map((group) => {
    const evidence = group.sources.map((source) => source.evidence_text).join("\n");
    group.colors.sort((left, right) => {
      const leftIndex = evidence.indexOf(left.replace(/色$/, ""));
      const rightIndex = evidence.indexOf(right.replace(/色$/, ""));
      if (leftIndex < 0 && rightIndex < 0) return left.localeCompare(right, "zh-CN");
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    });
    return group;
  });
}

function answerIsExact(question: GeneratedQuestion, selected: Set<string>): boolean {
  if (question.format !== "which_are_color") {
    return selected.size === 1 && question.correctIds.has([...selected][0]);
  }
  return selected.size === question.correctIds.size
    && [...selected].every((id) => question.correctIds.has(id));
}

function serializeQuestion(question: GeneratedQuestion): StoredQuestion {
  return {
    id: question.id,
    format: question.format,
    targetId: question.target.id,
    targetColor: question.targetColor,
    choices: question.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      observationId: choice.observation?.id,
    })),
    correctIds: [...question.correctIds],
    evidenceIds: question.evidence.map((observation) => observation.id),
  };
}

function restoreQuestion(stored: StoredQuestion, data: Materials): GeneratedQuestion | null {
  const observations = new Map(data.observations.map((observation) => [observation.id, observation]));
  const target = observations.get(stored.targetId);
  if (!target || !FORMAT_ORDER.includes(stored.format)) return null;
  const choices = stored.choices.map((choice) => {
    const observation = choice.observationId ? observations.get(choice.observationId) : undefined;
    if (choice.observationId && !observation) return null;
    return { id: choice.id, label: choice.label, observation };
  });
  if (choices.some((choice) => choice === null)) return null;
  const evidence = stored.evidenceIds
    .map((id) => observations.get(id))
    .filter((observation): observation is Observation => Boolean(observation));
  return {
    id: stored.id,
    format: stored.format,
    target,
    targetColor: stored.targetColor,
    choices: choices as Choice[],
    correctIds: new Set(stored.correctIds),
    evidence: evidence.length ? evidence : [target],
  };
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StoredSession>;
  const isQuestion = (question: unknown): question is StoredQuestion => {
    if (!question || typeof question !== "object") return false;
    const candidate = question as Partial<StoredQuestion>;
    return typeof candidate.id === "string"
      && typeof candidate.targetId === "string"
      && typeof candidate.format === "string"
      && Array.isArray(candidate.choices)
      && Array.isArray(candidate.correctIds)
      && Array.isArray(candidate.evidenceIds);
  };
  return session.version === 1
    && typeof session.datasetVersion === "string"
    && typeof session.savedAt === "string"
    && (session.elementScope === undefined || (
      Array.isArray(session.elementScope)
      && session.elementScope.every((symbol) => typeof symbol === "string")
    ))
    && ["practice", "exam_setup", "exam_running", "exam_result"].includes(session.appMode || "")
    && Array.isArray(session.practiceHistory)
    && session.practiceHistory.every((entry) =>
      Boolean(entry)
      && isQuestion(entry.question)
      && Array.isArray(entry.selected)
      && typeof entry.submitted === "boolean"
    )
    && (
      session.practiceDraft === undefined
      || (
        Boolean(session.practiceDraft)
        && isQuestion(session.practiceDraft.question)
        && Array.isArray(session.practiceDraft.selected)
      )
    )
    && Array.isArray(session.examQuestions)
    && session.examQuestions.every(isQuestion)
    && Array.isArray(session.examAnswers)
    && Boolean(session.stats)
    && Boolean(session.examConfig);
}

function storedRecordCount(session: StoredSession): number {
  const answeredPractice = session.practiceHistory.filter((entry) => entry.submitted).length;
  return answeredPractice + session.examQuestions.length;
}

function observationsForReview(question: GeneratedQuestion, data: Materials): Observation[] {
  if (question.format === "color_of") return question.evidence;
  return uniqueBy(
    question.choices.flatMap((choice) =>
      choice.observation
        ? data.observations.filter((observation) => observation.substanceId === choice.observation?.substanceId)
        : []
    ),
    (observation) => observation.id,
  );
}

function ExamReviewCard({
  question,
  selected,
  index,
  data,
}: {
  question: GeneratedQuestion;
  selected: Set<string>;
  index: number;
  data: Materials;
}) {
  const exact = answerIsExact(question, selected);
  const reviewObservations = observationsForReview(question, data);
  const evidenceGroups = groupEvidenceObservations(reviewObservations);
  const sourcePages = uniqueBy(
    reviewObservations.flatMap((observation) => observation.sources),
    (source) => String(source.pdf_page),
  );
  return (
    <details className={exact ? "exam-review-card correct-review" : "exam-review-card wrong-review"}>
      <summary>
        <span>第 {index + 1} 题</span>
        <b>
          {question.format === "color_of"
            ? <><Formula observation={question.target} compact /> 的颜色</>
            : <>选择呈 {question.targetColor} 的物质</>}
        </b>
        <em>{selected.size ? (exact ? "正确" : "错误") : "未作答"}</em>
      </summary>
      <div className="exam-review-body">
        <div className="exam-review-prompt">
          {question.format === "color_of" ? (
            <><Formula observation={question.target} /><span>{qualifier(question.target) || "教材所述通常状态"}是什么颜色？</span></>
          ) : (
            <><strong>{question.targetColor}</strong><span>{question.format === "which_one_is_color" ? "选择唯一符合的物质" : "选择所有符合的物质"}</span></>
          )}
        </div>
        <div className="exam-review-choices">
          {question.choices.map((choice, choiceIndex) => {
            const picked = selected.has(choice.id);
            const correct = question.correctIds.has(choice.id);
            const missedCorrect = question.format === "which_are_color" && correct && !picked;
            const state = correct
              ? missedCorrect ? "correct missed-correct" : "correct picked-correct"
              : picked ? "wrong" : "";
            return (
              <div className={`exam-review-choice ${state}`} key={choice.id}>
                <span>{choiceIndex + 1}</span>
                <b>{choice.observation ? <Formula observation={choice.observation} compact /> : choice.label}</b>
                <em>{correct ? missedCorrect ? "漏选" : "已选正确" : picked ? "你的选择" : ""}</em>
              </div>
            );
          })}
        </div>
        <div className="exam-review-analysis">
          <h3>教材解析</h3>
          {evidenceGroups.map((group) => {
            const observation = group.representative;
            const source = group.sources[0];
            const correctOption = question.format === "color_of" || question.correctIds.has(observation.substanceId);
            return (
              <article className={correctOption ? "evidence-card correct-evidence" : "evidence-card"} key={group.key}>
                <div className="evidence-heading"><Formula observation={observation} compact /><b>{group.colors.join(" / ")}</b></div>
                {question.format !== "color_of" ? <span className={correctOption ? "evidence-role correct" : "evidence-role"}>{correctOption ? "正确选项" : "其他选项"}</span> : null}
                {source?.evidence_text ? <MarkdownText>{source.evidence_text}</MarkdownText> : null}
                {source ? <span className="page-reference"><b>{sourcePageLabel(source)}</b><small>PDF 第 {source.pdf_page} 页</small></span> : null}
              </article>
            );
          })}
          <div className="page-previews">
            <h3>教材原页</h3>
            {sourcePages.map((source) => <PagePreview source={source} key={source.pdf_page} />)}
          </div>
        </div>
      </div>
    </details>
  );
}

function generateColorQuestion(data: Materials, spec: FormatSpec, previousId?: string): GeneratedQuestion {
  const policy = spec.choices.distractors;
  const eligible = data.observations.filter((item) => item.colorQuestionEligible && item.id !== previousId);
  if (!eligible.length) throw new Error("所选元素范围内没有可用于该题型的物质");
  const target = randomItem(eligible);
  const acceptedObservations = uniqueBy(
    data.observations.filter(
      (item) =>
        item.colorQuestionEligible
        && item.substanceId === target.substanceId
        && hasSameQualifier(item, target),
    ),
    (item) => item.colorId,
  );
  const acceptedColorIds = new Set(acceptedObservations.map((item) => item.colorId));
  const correctForSubstance = new Set(
    data.observations.filter((item) => item.substanceId === target.substanceId).map((item) => item.colorId),
  );
  const distractorCandidates = data.observations.filter(
    (item) =>
      item.selectionQuestionEligible &&
      item.colorId !== target.colorId &&
      !correctForSubstance.has(item.colorId) &&
      !forbiddenColorPair(target.color, item.color, policy?.forbidColorPairs),
  );
  const preferred = distractorCandidates.filter(
    (item) =>
      item.observationKind === target.observationKind &&
      (!target.physicalState || item.physicalState === target.physicalState),
  );
  const contextual = uniqueBy(
    [...shuffled(preferred), ...shuffled(distractorCandidates)],
    (item) => item.colorId,
  );
  const related = target.focusElement
    ? contextual.filter((item) => item.focusElement === target.focusElement)
    : [];
  const favorRelated = related.length > 0 && Math.random() < (policy?.focusElementProbability ?? 0);
  const relatedCount = favorRelated
    ? Math.min(policy?.focusElementMaxChoices ?? 0, related.length, spec.choices.count - 1)
    : 0;
  const chosenRelated = shuffled(related).slice(0, relatedCount);
  const relatedColorIds = new Set(related.map((item) => item.colorId));
  const chosenColorIds = new Set(chosenRelated.map((item) => item.colorId));
  const general = contextual.filter(
    (item) => !chosenColorIds.has(item.colorId) && !relatedColorIds.has(item.colorId),
  );
  const overflow = contextual.filter((item) => !chosenColorIds.has(item.colorId));
  const rankedDistractors = uniqueBy(
    [...chosenRelated, ...general, ...overflow],
    (item) => item.colorId,
  );
  const distractors = takeWithFinalColorCheck(
    [target.color],
    rankedDistractors,
    spec.choices.count - 1,
    (item) => item.color,
    policy?.forbidColorPairs,
  );
  if (distractors.length < spec.choices.count - 1) throw new Error("所选元素范围过窄，无法生成足够的颜色选项");
  const choices = shuffled([
    { id: target.colorId, label: target.color },
    ...distractors.map((item) => ({ id: item.colorId, label: item.color })),
  ]);
  return {
    id: `${target.id}-${Date.now()}`,
    format: "color_of",
    target,
    choices,
    correctIds: acceptedColorIds,
    evidence: acceptedObservations,
  };
}

function generateSingleSubstanceQuestion(data: Materials, spec: FormatSpec, previousId?: string): GeneratedQuestion {
  const policy = spec.choices.distractors;
  const eligible = data.observations.filter(
    (item) => item.selectionQuestionEligible && item.id !== previousId,
  );
  if (!eligible.length) throw new Error("所选元素范围内没有可用于该题型的物质");
  const target = randomItem(eligible);
  const substancesWithTargetColor = new Set(
    data.observations
      .filter((item) => item.selectionQuestionEligible && item.colorId === target.colorId)
      .map((item) => item.substanceId),
  );
  const wrongPool = uniqueBy(
    shuffled(eligible.filter(
      (item) =>
        !substancesWithTargetColor.has(item.substanceId) &&
        !forbiddenColorPair(target.color, item.color, policy?.forbidColorPairs),
    )),
    (item) => item.substanceId,
  ).sort((a, b) => {
    const sameKind = Number(b.observationKind === target.observationKind) - Number(a.observationKind === target.observationKind);
    if (sameKind) return sameKind;
    return Number(b.physicalState === target.physicalState) - Number(a.physicalState === target.physicalState);
  });
  const wrongCount = spec.choices.count - 1;
  const relatedWrong = target.focusElement
    ? wrongPool.filter((item) => item.focusElement === target.focusElement)
    : [];
  const favorRelated = relatedWrong.length > 0 && Math.random() < (policy?.focusElementProbability ?? 0);
  const relatedCount = favorRelated
    ? Math.min(policy?.focusElementMaxChoices ?? 0, relatedWrong.length, wrongCount)
    : 0;
  const chosenRelated = shuffled(relatedWrong).slice(0, relatedCount);
  const chosenSubstances = new Set(chosenRelated.map((item) => item.substanceId));
  const relatedSubstances = new Set(relatedWrong.map((item) => item.substanceId));
  const generalWrong = wrongPool.filter(
    (item) => !chosenSubstances.has(item.substanceId) && !relatedSubstances.has(item.substanceId),
  );
  const overflowWrong = wrongPool.filter((item) => !chosenSubstances.has(item.substanceId));
  const rankedWrong = uniqueBy(
    [...chosenRelated, ...generalWrong, ...overflowWrong],
    (item) => item.substanceId,
  );
  const wrong = takeWithFinalColorCheck(
    [target.color],
    rankedWrong,
    wrongCount,
    (item) => item.color,
    policy?.forbidColorPairs,
  );
  if (wrong.length < wrongCount) throw new Error("所选元素范围过窄，无法生成四个物质选项");
  const choices = shuffled([
    { id: target.substanceId, label: target.displayLabel, observation: target },
    ...wrong.map((item) => ({ id: item.substanceId, label: item.displayLabel, observation: item })),
  ]);
  return {
    id: `${target.id}-${Date.now()}`,
    format: "which_one_is_color",
    target,
    targetColor: target.color,
    choices,
    correctIds: new Set([target.substanceId]),
    evidence: [target],
  };
}

function generateSelectionQuestion(data: Materials, spec: FormatSpec, previousColor?: string): GeneratedQuestion {
  const policy = spec.choices.distractors;
  const eligible = data.observations.filter((item) => item.selectionQuestionEligible);
  const byColor = new Map<string, Observation[]>();
  eligible.forEach((item) => {
    const group = byColor.get(item.colorId) || [];
    group.push(item);
    byColor.set(item.colorId, group);
  });
  const viable = [...byColor.entries()].filter(
    ([, rows]) => uniqueBy(rows, (row) => row.substanceId).length >= 3,
  );
  if (!viable.length) throw new Error("所选元素范围内没有一种颜色对应足够多的物质，无法生成多选题");
  const candidates = viable.filter(([, rows]) => rows[0].color !== previousColor);
  const [, rawCorrect] = randomItem(candidates.length ? candidates : viable);
  const correctPool = uniqueBy(shuffled(rawCorrect), (row) => row.substanceId);
  const limits = spec.choices.correctCount || { min: 2, max: 3 };
  const desiredCorrect = limits.min + Math.floor(Math.random() * (limits.max - limits.min + 1));
  const correctCount = Math.min(correctPool.length, desiredCorrect);
  const correct = correctPool.slice(0, correctCount);
  const targetColor = correct[0].color;
  const substancesWithColor = new Set(rawCorrect.map((item) => item.substanceId));
  const preferredKind = correct[0].observationKind;
  const wrongPool = uniqueBy(
    shuffled(eligible.filter(
      (item) =>
        !substancesWithColor.has(item.substanceId) &&
        !forbiddenColorPair(targetColor, item.color, policy?.forbidColorPairs),
    )),
    (item) => item.substanceId,
  ).sort((a, b) => Number(b.observationKind === preferredKind) - Number(a.observationKind === preferredKind));
  const wrongCount = spec.choices.count - correctCount;
  const correctFocusElements = new Set(correct.map((item) => item.focusElement).filter(Boolean));
  const relatedWrong = wrongPool.filter(
    (item) => item.focusElement && correctFocusElements.has(item.focusElement),
  );
  const favorRelated = relatedWrong.length > 0 && Math.random() < (policy?.focusElementProbability ?? 0);
  const relatedCount = favorRelated
    ? Math.min(policy?.focusElementMaxChoices ?? 0, relatedWrong.length, wrongCount)
    : 0;
  const chosenRelated = shuffled(relatedWrong).slice(0, relatedCount);
  const chosenSubstances = new Set(chosenRelated.map((item) => item.substanceId));
  const relatedSubstances = new Set(relatedWrong.map((item) => item.substanceId));
  const generalWrong = wrongPool.filter(
    (item) => !chosenSubstances.has(item.substanceId) && !relatedSubstances.has(item.substanceId),
  );
  const overflowWrong = wrongPool.filter((item) => !chosenSubstances.has(item.substanceId));
  const rankedWrong = uniqueBy(
    [...chosenRelated, ...generalWrong, ...overflowWrong],
    (item) => item.substanceId,
  );
  const wrong = takeWithFinalColorCheck(
    correct.map((item) => item.color),
    rankedWrong,
    wrongCount,
    (item) => item.color,
    policy?.forbidColorPairs,
  );
  if (wrong.length < wrongCount) throw new Error("所选元素范围过窄，无法生成足够的物质选项");
  const choices = shuffled([
    ...correct.map((item) => ({ id: item.substanceId, label: item.displayLabel, observation: item })),
    ...wrong.map((item) => ({ id: item.substanceId, label: item.displayLabel, observation: item })),
  ]);
  return {
    id: `${correct[0].colorId}-${Date.now()}`,
    format: "which_are_color",
    target: correct[0],
    targetColor,
    choices,
    correctIds: new Set(correct.map((item) => item.substanceId)),
    evidence: correct,
  };
}

function generateQuestion(
  data: Materials,
  language: FormatLanguage,
  format: QuestionFormat,
  previous?: GeneratedQuestion | null,
): GeneratedQuestion {
  const spec = language.formats.find((item) => item.id === format);
  if (!spec) throw new Error(`未找到题目格式：${format}`);
  if (format === "color_of") return generateColorQuestion(data, spec, previous?.target.id);
  if (format === "which_one_is_color") return generateSingleSubstanceQuestion(data, spec, previous?.target.id);
  return generateSelectionQuestion(data, spec, previous?.targetColor);
}

function observationStudyElements(observation: Observation): Set<string> {
  const elements = new Set<string>();
  if (observation.focusElement && DEFAULT_ELEMENT_SCOPE.has(observation.focusElement)) {
    elements.add(observation.focusElement);
  }
  const formulaElements = observation.formula?.match(/[A-Z][a-z]?/g) || [];
  const firstAllowed = formulaElements.find((symbol) => DEFAULT_ELEMENT_SCOPE.has(symbol));
  if (firstAllowed && (S_BLOCK_STUDY_ELEMENTS.has(firstAllowed) || !elements.size)) {
    elements.add(firstAllowed);
  }
  return elements;
}

function materialsForElementScope(data: Materials, scope: Set<string>): Materials {
  return {
    ...data,
    observations: data.observations.filter((observation) =>
      [...observationStudyElements(observation)].some((symbol) => scope.has(symbol))
    ),
  };
}

function generateScopedQuestion(
  data: Materials,
  language: FormatLanguage,
  format: QuestionFormat,
  scope: Set<string>,
  previous?: GeneratedQuestion | null,
): GeneratedQuestion {
  return generateQuestion(materialsForElementScope(data, scope), language, format, previous);
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ColorQuiz({ onSwitchToEquations }: { onSwitchToEquations: () => void }) {
  const [data, setData] = useState<Materials | null>(null);
  const [formatLanguage, setFormatLanguage] = useState<FormatLanguage | null>(null);
  const [format, setFormat] = useState<GeneratedQuestion["format"]>("color_of");
  const [question, setQuestion] = useState<GeneratedQuestion | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [practiceHistory, setPracticeHistory] = useState<PracticeEntry[]>([]);
  const [practiceDraft, setPracticeDraft] = useState<PracticeEntry | null>(null);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [stats, setStats] = useState({ answered: 0, correct: 0, streak: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appMode, setAppMode] = useState<AppMode>("practice");
  const [examConfig, setExamConfig] = useState<ExamConfig>(DEFAULT_EXAM_CONFIG);
  const [examQuestions, setExamQuestions] = useState<GeneratedQuestion[]>([]);
  const [examAnswers, setExamAnswers] = useState<Set<string>[]>([]);
  const [examIndex, setExamIndex] = useState(0);
  const [examStartedAt, setExamStartedAt] = useState<number | null>(null);
  const [examEndedAt, setExamEndedAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [pendingRestore, setPendingRestore] = useState<StoredSession | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [elementScope, setElementScope] = useState<Set<string>>(() => new Set(DEFAULT_ELEMENT_SCOPE));
  const [scopeDraft, setScopeDraft] = useState<Set<string>>(() => new Set(DEFAULT_ELEMENT_SCOPE));
  const [scopeEditorOpen, setScopeEditorOpen] = useState(false);
  const [scopeEditorView, setScopeEditorView] = useState<"groups" | "custom">("groups");
  const [generationError, setGenerationError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/materials.v1.json"),
      fetch("/question-formats.cqf.json"),
    ])
      .then(async ([dataResponse, formatResponse]) => {
        if (!dataResponse.ok || !formatResponse.ok) throw new Error("物质库或题目格式载入失败");
        return [await dataResponse.json(), await formatResponse.json()] as [Materials, FormatLanguage];
      })
      .then(([payload, language]) => {
        setData(payload);
        setFormatLanguage(language);
        try {
          const saved = window.localStorage.getItem(SESSION_STORAGE_KEY);
          if (saved) {
            const parsed: unknown = JSON.parse(saved);
            const datasetVersion = payload.metadata.dataset_version || "unknown";
            if (
              isStoredSession(parsed)
              && parsed.datasetVersion === datasetVersion
              && storedRecordCount(parsed) > 0
            ) {
              setPendingRestore(parsed);
              return;
            }
            window.localStorage.removeItem(SESSION_STORAGE_KEY);
          }
        } catch {
          window.localStorage.removeItem(SESSION_STORAGE_KEY);
        }
        const first = generateScopedQuestion(payload, language, "color_of", DEFAULT_ELEMENT_SCOPE);
        setQuestion(first);
        setPracticeDraft({ question: first, selected: new Set(), submitted: false });
        setStorageReady(true);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const startFreshSession = useCallback(() => {
    if (!data || !formatLanguage) return;
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    const first = generateScopedQuestion(data, formatLanguage, "color_of", DEFAULT_ELEMENT_SCOPE);
    setQuestion(first);
    setFormat("color_of");
    setSelected(new Set());
    setSubmitted(false);
    setPracticeHistory([]);
    setPracticeDraft({ question: first, selected: new Set(), submitted: false });
    setPracticeIndex(0);
    setStats({ answered: 0, correct: 0, streak: 0 });
    setExamConfig(DEFAULT_EXAM_CONFIG);
    setExamQuestions([]);
    setExamAnswers([]);
    setExamIndex(0);
    setExamStartedAt(null);
    setExamEndedAt(null);
    setRemainingSeconds(0);
    setElementScope(new Set(DEFAULT_ELEMENT_SCOPE));
    setScopeDraft(new Set(DEFAULT_ELEMENT_SCOPE));
    setScopeEditorOpen(false);
    setGenerationError(null);
    setAppMode("practice");
    setPendingRestore(null);
    setStorageReady(true);
  }, [data, formatLanguage]);

  const restoreSavedSession = useCallback(() => {
    if (!data || !pendingRestore) return;
    const restoredPractice = pendingRestore.practiceHistory.map((entry) => {
      const restoredQuestion = restoreQuestion(entry.question, data);
      return restoredQuestion
        ? { question: restoredQuestion, selected: new Set(entry.selected), submitted: entry.submitted }
        : null;
    });
    if (restoredPractice.some((entry) => entry === null)) {
      startFreshSession();
      return;
    }
    const restoredEntries = restoredPractice as PracticeEntry[];
    const practiceEntries = restoredEntries.filter((entry) => entry.submitted);
    const storedDraftQuestion = pendingRestore.practiceDraft
      ? restoreQuestion(pendingRestore.practiceDraft.question, data)
      : null;
    if (pendingRestore.practiceDraft && !storedDraftQuestion) {
      startFreshSession();
      return;
    }
    const legacyDraft = [...restoredEntries].reverse().find((entry) => !entry.submitted) || null;
    const restoredDraft: PracticeEntry | null = storedDraftQuestion
      ? {
          question: storedDraftQuestion,
          selected: new Set(pendingRestore.practiceDraft?.selected || []),
          submitted: false,
        }
      : legacyDraft;
    if (!practiceEntries.length && !restoredDraft) {
      startFreshSession();
      return;
    }
    const restoredExam = pendingRestore.examQuestions
      .map((storedQuestion) => restoreQuestion(storedQuestion, data));
    const examValid = restoredExam.every((item) => item !== null);
    const examItems = examValid ? restoredExam as GeneratedQuestion[] : [];
    const answers = examItems.map((_, index) => new Set(pendingRestore.examAnswers[index] || []));
    const originallyActive = restoredEntries[pendingRestore.practiceIndex];
    const matchingSubmittedIndex = originallyActive?.submitted
      ? practiceEntries.findIndex((entry) => entry.question.id === originallyActive.question.id)
      : -1;
    const restoredPracticeIndex = matchingSubmittedIndex >= 0
      ? matchingSubmittedIndex
      : restoredDraft
        ? practiceEntries.length
        : Math.max(0, practiceEntries.length - 1);
    const restoredExamIndex = Math.min(
      Math.max(0, examItems.length - 1),
      Math.max(0, pendingRestore.examIndex),
    );
    let restoredMode = pendingRestore.appMode;
    if ((restoredMode === "exam_running" || restoredMode === "exam_result") && !examItems.length) {
      restoredMode = "practice";
    }
    let restoredRemaining = 0;
    let restoredStartedAt = pendingRestore.examStartedAt;
    let restoredEndedAt = pendingRestore.examEndedAt;
    if (restoredMode === "exam_running") {
      const startedAt = pendingRestore.examStartedAt || Date.now();
      restoredStartedAt = startedAt;
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      restoredRemaining = Math.max(0, pendingRestore.examConfig.durationMinutes * 60 - elapsed);
      if (restoredRemaining === 0) {
        restoredMode = "exam_result";
        restoredEndedAt = Date.now();
      }
    }
    const activePractice = restoredPracticeIndex === practiceEntries.length && restoredDraft
      ? restoredDraft
      : practiceEntries[restoredPracticeIndex] || restoredDraft!;
    const activeExam = examItems[restoredExamIndex];
    const showExam = restoredMode === "exam_running" || restoredMode === "exam_result";
    const activeQuestion = showExam && activeExam ? activeExam : activePractice.question;
    const activeSelected = showExam && activeExam
      ? answers[restoredExamIndex] || new Set<string>()
      : activePractice.selected;
    let restoredScope = new Set(
      (pendingRestore.elementScope || ALLOWED_ELEMENTS)
        .filter((symbol) => DEFAULT_ELEMENT_SCOPE.has(symbol)),
    );
    const wasLegacyFullSelection = restoredScope.size === LEGACY_DEFAULT_ELEMENT_SCOPE.size
      && [...LEGACY_DEFAULT_ELEMENT_SCOPE].every((symbol) => restoredScope.has(symbol));
    if (wasLegacyFullSelection) restoredScope = new Set(DEFAULT_ELEMENT_SCOPE);

    setPracticeHistory(practiceEntries);
    setPracticeDraft(restoredDraft);
    setPracticeIndex(restoredPracticeIndex);
    setStats(pendingRestore.stats);
    setExamConfig(pendingRestore.examConfig);
    setExamQuestions(examItems);
    setExamAnswers(answers);
    setExamIndex(restoredExamIndex);
    setExamStartedAt(restoredStartedAt);
    setExamEndedAt(restoredEndedAt);
    setRemainingSeconds(restoredRemaining);
    setElementScope(restoredScope.size ? restoredScope : new Set(DEFAULT_ELEMENT_SCOPE));
    setScopeDraft(restoredScope.size ? new Set(restoredScope) : new Set(DEFAULT_ELEMENT_SCOPE));
    setQuestion(activeQuestion);
    setFormat(activeQuestion.format);
    setSelected(new Set(activeSelected));
    setSubmitted(restoredMode === "practice" ? activePractice.submitted : false);
    setAppMode(restoredMode);
    setPendingRestore(null);
    setStorageReady(true);
  }, [data, pendingRestore, startFreshSession]);

  useEffect(() => {
    if (!storageReady || !data || (!practiceHistory.length && !practiceDraft)) return;
    const timer = window.setTimeout(() => {
      const session: StoredSession = {
        version: 1,
        datasetVersion: data.metadata.dataset_version || "unknown",
        savedAt: new Date().toISOString(),
        elementScope: [...elementScope],
        appMode,
        practiceHistory: practiceHistory.map((entry) => ({
          question: serializeQuestion(entry.question),
          selected: [...entry.selected],
          submitted: entry.submitted,
        })),
        practiceDraft: practiceDraft ? {
          question: serializeQuestion(practiceDraft.question),
          selected: [...practiceDraft.selected],
        } : undefined,
        practiceIndex,
        stats,
        examConfig,
        examQuestions: examQuestions.map(serializeQuestion),
        examAnswers: examAnswers.map((answer) => [...answer]),
        examIndex,
        examStartedAt,
        examEndedAt,
      };
      try {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      } catch {
        // If browser storage is unavailable or full, the in-memory session remains usable.
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [
    appMode,
    data,
    examAnswers,
    examConfig,
    examEndedAt,
    examIndex,
    examQuestions,
    examStartedAt,
    elementScope,
    practiceHistory,
    practiceDraft,
    practiceIndex,
    stats,
    storageReady,
  ]);

  const showPracticeEntry = useCallback((index: number, entries = practiceHistory) => {
    const entry = entries[index];
    if (!entry) return;
    setPracticeIndex(index);
    setQuestion(entry.question);
    setFormat(entry.question.format);
    setSelected(new Set(entry.selected));
    setSubmitted(entry.submitted);
  }, [practiceHistory]);

  const showPracticeDraft = useCallback((draft = practiceDraft) => {
    if (!draft) return;
    setPracticeIndex(practiceHistory.length);
    setQuestion(draft.question);
    setFormat(draft.question.format);
    setSelected(new Set(draft.selected));
    setSubmitted(false);
  }, [practiceDraft, practiceHistory.length]);

  const createPracticeQuestion = useCallback((nextFormat = format, scope = elementScope) => {
    if (!data || !formatLanguage) return false;
    try {
      const previous = question || practiceHistory.at(-1)?.question;
      const next = generateScopedQuestion(data, formatLanguage, nextFormat, scope, previous);
      const entry: PracticeEntry = { question: next, selected: new Set(), submitted: false };
      setPracticeDraft(entry);
      setPracticeIndex(practiceHistory.length);
      setQuestion(next);
      setFormat(nextFormat);
      setSelected(new Set());
      setSubmitted(false);
      setGenerationError(null);
      return true;
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "当前元素范围无法生成题目");
      return false;
    }
  }, [data, elementScope, format, formatLanguage, practiceHistory, question]);

  const showExamQuestion = useCallback((index: number) => {
    const next = examQuestions[index];
    if (!next) return;
    setExamIndex(index);
    setQuestion(next);
    setFormat(next.format);
    setSelected(new Set(examAnswers[index] || []));
    setSubmitted(false);
  }, [examAnswers, examQuestions]);

  const previousQuestion = useCallback(() => {
    if (appMode === "exam_running") {
      showExamQuestion(Math.max(0, examIndex - 1));
      return;
    }
    if (!practiceHistory.length) return;
    const previousIndex = practiceIndex >= practiceHistory.length
      ? practiceHistory.length - 1
      : Math.max(0, practiceIndex - 1);
    showPracticeEntry(previousIndex);
  }, [appMode, examIndex, practiceHistory.length, practiceIndex, showExamQuestion, showPracticeEntry]);

  const nextQuestion = useCallback(() => {
    if (appMode === "exam_running") {
      showExamQuestion(Math.min(examQuestions.length - 1, examIndex + 1));
      return;
    }
    if (practiceIndex < practiceHistory.length - 1) {
      showPracticeEntry(practiceIndex + 1);
      return;
    }
    if (practiceIndex === practiceHistory.length - 1 && practiceDraft) {
      showPracticeDraft();
      return;
    }
    createPracticeQuestion(format);
  }, [appMode, createPracticeQuestion, examIndex, examQuestions.length, format, practiceDraft, practiceHistory.length, practiceIndex, showExamQuestion, showPracticeDraft, showPracticeEntry]);

  const showCurrentPractice = useCallback(() => {
    if (practiceIndex < practiceHistory.length) {
      showPracticeEntry(practiceIndex);
    } else if (practiceDraft) {
      showPracticeDraft();
    } else if (practiceHistory.length) {
      showPracticeEntry(practiceHistory.length - 1);
    } else {
      createPracticeQuestion("color_of");
    }
  }, [createPracticeQuestion, practiceDraft, practiceHistory.length, practiceIndex, showPracticeDraft, showPracticeEntry]);

  const changeFormat = (value: GeneratedQuestion["format"]) => {
    createPracticeQuestion(value);
  };

  const openScopeEditor = (view: "groups" | "custom" = "groups") => {
    setScopeDraft(new Set(elementScope));
    setScopeEditorView(view);
    setGenerationError(null);
    setScopeEditorOpen(true);
  };

  const toggleScopeGroup = (group: ElementGroup) => {
    setScopeDraft((current) => {
      const next = new Set(current);
      const fullySelected = group.elements.every((symbol) => next.has(symbol));
      group.elements.forEach((symbol) => {
        if (fullySelected) next.delete(symbol);
        else next.add(symbol);
      });
      return next;
    });
  };

  const toggleScopeElement = (symbol: string) => {
    if (!DEFAULT_ELEMENT_SCOPE.has(symbol)) return;
    setScopeDraft((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const commitElementScope = (nextScope: Set<string>) => {
    if (!nextScope.size || !data || !formatLanguage) return;
    if (appMode === "practice" && !createPracticeQuestion(format, nextScope)) return;
    if (!materialsForElementScope(data, nextScope).observations.length) {
      setGenerationError("所选元素范围内没有可用的物质记录");
      return;
    }
    setElementScope(new Set(nextScope));
    setScopeDraft(new Set(nextScope));
    setScopeEditorOpen(false);
    setGenerationError(null);
  };

  const scopeSummary = elementScope.size === DEFAULT_ELEMENT_SCOPE.size
    ? "全部元素"
    : elementScope.size <= 8
      ? [...elementScope].join(" · ")
      : `已选 ${elementScope.size} 个元素`;

  const examTotal = useMemo(
    () => FORMAT_ORDER.reduce((total, item) => total + examConfig.counts[item], 0),
    [examConfig],
  );

  const startExam = () => {
    if (!data || !formatLanguage || examTotal < 1) return;
    try {
      const scopedData = materialsForElementScope(data, elementScope);
      const sequence = shuffled(FORMAT_ORDER.flatMap((item) => Array(examConfig.counts[item]).fill(item) as QuestionFormat[]));
      const questions: GeneratedQuestion[] = [];
      sequence.forEach((item, index) => {
        const generated = generateQuestion(scopedData, formatLanguage, item, questions.at(-1));
        questions.push({ ...generated, id: `exam-${Date.now()}-${index}-${generated.id}` });
      });
      const first = questions[0];
      const now = Date.now();
      setExamQuestions(questions);
      setExamAnswers(questions.map(() => new Set()));
      setExamIndex(0);
      setExamStartedAt(now);
      setExamEndedAt(null);
      setRemainingSeconds(examConfig.durationMinutes * 60);
      setFormat(sequence[0]);
      setQuestion(first);
      setSelected(new Set());
      setSubmitted(false);
      setGenerationError(null);
      setAppMode("exam_running");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "当前元素范围无法生成完整试卷");
    }
  };

  const finishExam = useCallback(() => {
    setExamEndedAt(Date.now());
    setSubmitted(false);
    setAppMode("exam_result");
  }, []);

  useEffect(() => {
    if (appMode !== "exam_running" || examStartedAt === null) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - examStartedAt) / 1000);
      setRemainingSeconds(Math.max(0, examConfig.durationMinutes * 60 - elapsed));
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [appMode, examConfig.durationMinutes, examStartedAt]);

  useEffect(() => {
    if (appMode === "exam_running" && examStartedAt !== null && remainingSeconds === 0) finishExam();
  }, [appMode, examStartedAt, finishExam, remainingSeconds]);

  const toggleChoice = (id: string) => {
    if (submitted || !question) return;
    setSelected((current) => {
      const next = new Set(current);
      if (question.format !== "which_are_color") {
        next.clear();
        next.add(id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      if (appMode === "exam_running") {
        setExamAnswers((answers) => answers.map((answer, index) => index === examIndex ? new Set(next) : answer));
      } else {
        setPracticeDraft((draft) =>
          draft && practiceIndex === practiceHistory.length
            ? { ...draft, selected: new Set(next) }
            : draft
        );
      }
      return next;
    });
  };

  const isExact = useMemo(() => {
    return question ? answerIsExact(question, selected) : false;
  }, [question, selected]);

  const submit = useCallback(() => {
    if (!question || !selected.size || submitted) return;
    if (appMode === "exam_running") return;
    setSubmitted(true);
    const completed: PracticeEntry = { question, selected: new Set(selected), submitted: true };
    setPracticeHistory((entries) => [...entries, completed]);
    setPracticeDraft(null);
    setPracticeIndex(practiceHistory.length);
    setStats((current) => ({
      answered: current.answered + 1,
      correct: current.correct + Number(isExact),
      streak: isExact ? current.streak + 1 : 0,
    }));
  }, [appMode, isExact, practiceHistory.length, question, selected, submitted]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!question || scopeEditorOpen || (appMode !== "practice" && appMode !== "exam_running")) return;
      const number = Number(event.key);
      if (number >= 1 && number <= question.choices.length && !submitted) {
        toggleChoice(question.choices[number - 1].id);
      } else if (event.key === "ArrowLeft") {
        previousQuestion();
      } else if (event.key === "ArrowRight") {
        nextQuestion();
      } else if (event.key === "Enter") {
        if (appMode === "exam_running") {
          if (examIndex + 1 === examQuestions.length) {
            if (window.confirm("确定提交试卷吗？提交后不能再修改答案。")) finishExam();
          }
          else nextQuestion();
        } else if (submitted) nextQuestion();
        else submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [appMode, examIndex, examQuestions.length, finishExam, nextQuestion, previousQuestion, question, scopeEditorOpen, submitted, submit]);

  if (loadError) {
    return <main className="loading"><div><b>无法载入物质数据库</b><p>{loadError}</p></div></main>;
  }
  if (data && formatLanguage && pendingRestore) {
    const savedTime = new Date(pendingRestore.savedAt);
    return (
      <main className="recovery-screen">
        <section className="recovery-card">
          <span className="recovery-mark">续</span>
          <div className="panel-label">发现上次的本地记录</div>
          <h1>是否保留并恢复？</h1>
          <p>记录只保存在当前设备的这个浏览器中，不会上传。继续后会恢复题目、答案、练习统计以及考试进度或结果。</p>
          <div className="recovery-summary">
            <div><strong>{pendingRestore.practiceHistory.filter((entry) => entry.submitted).length}</strong><span>道已作答记录</span></div>
            <div><strong>{pendingRestore.examQuestions.length}</strong><span>道考试记录</span></div>
            <div><strong>{Number.isNaN(savedTime.getTime()) ? "—" : savedTime.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</strong><span>最近保存</span></div>
          </div>
          <div className="recovery-actions">
            <button className="navigation-action danger-action" onClick={startFreshSession}>清空并重新开始</button>
            <button className="primary-action" onClick={restoreSavedSession}>保留并继续</button>
          </div>
        </section>
      </main>
    );
  }
  if (!data || !formatLanguage || !question) {
    return <main className="loading"><div className="loader" /><p>正在整理物质与颜色关系…</p></main>;
  }

  const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
  const reviewObservations = question.format === "color_of"
    ? question.evidence
    : uniqueBy(
        question.choices.flatMap((choice) =>
          choice.observation
            ? data.observations.filter((observation) => observation.substanceId === choice.observation?.substanceId)
            : []
        ),
        (observation) => observation.id,
      );
  const sourcePages = uniqueBy(
    reviewObservations.flatMap((observation) => observation.sources),
    (source) => String(source.pdf_page),
  );
  const evidenceGroups = groupEvidenceObservations(reviewObservations);
  const examQuestionResults = examQuestions.map((item, index) => ({
    question: item,
    selected: examAnswers[index] || new Set<string>(),
    correct: answerIsExact(item, examAnswers[index] || new Set<string>()),
  }));
  const examCorrect = examQuestionResults.filter((result) => result.correct).length;
  const examAnswered = examQuestionResults.filter((result) => result.selected.size > 0).length;
  const examBreakdown = examQuestionResults.reduce<ExamBreakdown>((breakdown, result) => {
    const item = breakdown[result.question.format];
    item.answered += Number(result.selected.size > 0);
    item.correct += Number(result.correct);
    return breakdown;
  }, {
    color_of: { answered: 0, correct: 0 },
    which_one_is_color: { answered: 0, correct: 0 },
    which_are_color: { answered: 0, correct: 0 },
  });
  const examScore = examTotal ? Math.round((examCorrect / examTotal) * examConfig.totalPoints) : 0;
  const examUsedSeconds = examStartedAt === null
    ? 0
    : Math.min(
        examConfig.durationMinutes * 60,
        Math.floor(((examEndedAt ?? Date.now()) - examStartedAt) / 1000),
      );
  const elementScopeControl = (
    <section className="element-scope-control">
      <div>
        <span>考察元素</span>
        <b>{scopeSummary}</b>
      </div>
      <div className="scope-control-actions">
        <button onClick={() => openScopeEditor("groups")}>章节多选</button>
        <button onClick={() => openScopeEditor("custom")}>自定义</button>
        <button onClick={() => commitElementScope(new Set(DEFAULT_ELEMENT_SCOPE))}>全选</button>
      </div>
      {generationError ? <p className="scope-error">{generationError}</p> : null}
    </section>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">EC</span>
          <div><strong>元素化学 · 色谱</strong><small>宋天佑《无机化学》颜色性质训练</small></div>
        </div>
        <div className="topbar-actions">
          <div className="quiz-switch" aria-label="题库切换">
            <button className="active">颜色 Quiz</button>
            <button onClick={onSwitchToEquations}>方程式 Quiz</button>
          </div>
          <a className="topbar-button topbar-link" href="/review">反应式复核</a>
          {appMode === "exam_running" ? (
            <div className={remainingSeconds <= 60 ? "exam-clock urgent" : "exam-clock"}>
              <span>考试倒计时</span><b>{formatDuration(remainingSeconds)}</b>
            </div>
          ) : (
            <div className="dataset-pill"><span className="live-dot" />现场生成 · {data.metadata.substanceCount.toLocaleString()} 种物质</div>
          )}
          {appMode === "practice" ? <button className="topbar-button" onClick={() => setAppMode("exam_setup")}>考试模式</button> : null}
        </div>
      </header>

      {scopeEditorOpen ? (
        <div
          className="scope-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setScopeEditorOpen(false);
          }}
        >
          <section className="scope-modal" role="dialog" aria-modal="true" aria-labelledby="scope-modal-title">
            <header className="scope-modal-header">
              <div>
                <span className="panel-label">全局出题范围</span>
                <h2 id="scope-modal-title">选择考察元素</h2>
                <p>当前选择 {scopeDraft.size} 个元素。</p>
              </div>
              <button className="scope-close" onClick={() => setScopeEditorOpen(false)} aria-label="关闭">×</button>
            </header>
            <div className="scope-tabs" role="tablist">
              <button className={scopeEditorView === "groups" ? "active" : ""} onClick={() => setScopeEditorView("groups")}>章节分组与预设</button>
              <button className={scopeEditorView === "custom" ? "active" : ""} onClick={() => setScopeEditorView("custom")}>自定义周期表</button>
            </div>
            <div className="scope-modal-body">
              {scopeEditorView === "groups" ? (
                <>
                  <div className="scope-section-heading">
                    <div><h3>宋天佑教材章节</h3><p>可多选；各组取并集，再点击应用。</p></div>
                    <div><button onClick={() => setScopeDraft(new Set())}>清空</button><button onClick={() => setScopeDraft(new Set(DEFAULT_ELEMENT_SCOPE))}>全选</button></div>
                  </div>
                  <div className="chapter-group-grid">
                    {CHAPTER_ELEMENT_GROUPS.map((group) => {
                      const selectedCount = group.elements.filter((symbol) => scopeDraft.has(symbol)).length;
                      const state = selectedCount === group.elements.length ? "selected" : selectedCount ? "partial" : "";
                      return (
                        <button className={state} onClick={() => toggleScopeGroup(group)} key={group.id}>
                          <span>{group.label}</span>
                          <small>{group.elements.join(" ")}</small>
                          <em>{selectedCount}/{group.elements.length}</em>
                        </button>
                      );
                    })}
                  </div>
                  <div className="scope-section-heading preset-heading">
                    <div><h3>竞赛重点预设</h3><p>点击后会直接替换当前选择，仍可继续增删。</p></div>
                  </div>
                  <div className="preset-grid">
                    {COMPETITION_ELEMENT_PRESETS.map((preset) => (
                      <button onClick={() => setScopeDraft(new Set(preset.elements))} key={preset.id}>
                        <b>{preset.label}</b><small>{preset.elements.join(" ")}</small>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="scope-section-heading">
                    <div><h3>在元素周期表上选择</h3><p>点击任意元素切换选中状态。</p></div>
                    <div><button onClick={() => setScopeDraft(new Set())}>清空</button><button onClick={() => setScopeDraft(new Set(DEFAULT_ELEMENT_SCOPE))}>全选</button></div>
                  </div>
                  <div className="periodic-table-scroll">
                    <div className="periodic-table" aria-label="元素周期表">
                      {PERIODIC_ROWS.flatMap((row, rowIndex) =>
                        row.map((symbol, columnIndex) => symbol ? (
                          <button
                            className={scopeDraft.has(symbol) ? "selected" : ""}
                            style={{ gridColumn: columnIndex + 1, gridRow: rowIndex + 1 }}
                            onClick={() => toggleScopeElement(symbol)}
                            aria-pressed={scopeDraft.has(symbol)}
                            key={symbol}
                          >
                            {symbol}
                          </button>
                        ) : null)
                      )}
                      <span className="series-marker lanthanide-marker" aria-hidden="true">镧系</span>
                      {LANTHANIDE_ROW.map((symbol, index) => (
                        <button
                          className={scopeDraft.has(symbol) ? "selected" : ""}
                          style={{ gridColumn: index + 4, gridRow: 9 }}
                          onClick={() => toggleScopeElement(symbol)}
                          aria-pressed={scopeDraft.has(symbol)}
                          key={symbol}
                        >
                          {symbol}
                        </button>
                      ))}
                      <span className="series-marker actinide-marker" aria-hidden="true">锕系</span>
                      {ACTINIDE_ROW.map((symbol, index) => (
                        <button
                          className={scopeDraft.has(symbol) ? "selected" : ""}
                          style={{ gridColumn: index + 4, gridRow: 10 }}
                          onClick={() => toggleScopeElement(symbol)}
                          aria-pressed={scopeDraft.has(symbol)}
                          key={symbol}
                        >
                          {symbol}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {generationError ? <p className="scope-error modal-error">{generationError}</p> : null}
            </div>
            <footer className="scope-modal-footer">
              <span>{scopeDraft.size ? `将限定为 ${scopeDraft.size} 个元素` : "请至少选择一个元素"}</span>
              <div>
                <button className="navigation-action" onClick={() => setScopeEditorOpen(false)}>取消</button>
                <button className="primary-action" disabled={!scopeDraft.size} onClick={() => commitElementScope(scopeDraft)}>应用范围</button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {appMode === "exam_setup" ? (
        <section className="exam-screen">
          <div className="exam-heading">
            <span className="panel-label">考试设置</span>
            <h1>生成一份限时试卷</h1>
            <p>三种题型按设定数量随机混排并等权计分。考试中可前后浏览并修改答案，不显示解析；交卷或倒计时结束后统一评分并提供整卷解析。</p>
          </div>
          <div className="exam-config-grid">
            <label className="exam-field"><span>限时（分钟）</span><input type="number" min="1" max="180" value={examConfig.durationMinutes} onChange={(event) => setExamConfig((current) => ({ ...current, durationMinutes: Math.min(180, Math.max(1, Number(event.target.value) || 1)) }))} /></label>
            <label className="exam-field"><span>试卷总分</span><input type="number" min="10" max="1000" step="10" value={examConfig.totalPoints} onChange={(event) => setExamConfig((current) => ({ ...current, totalPoints: Math.min(1000, Math.max(10, Number(event.target.value) || 100)) }))} /></label>
          </div>
          <div className="exam-counts">
            {FORMAT_ORDER.map((item) => (
              <label className="exam-count-card" key={item}>
                <span>{formatLanguage.formats.find((formatItem) => formatItem.id === item)?.label}</span>
                <small>{item === "which_are_color" ? "多项选择" : "单项选择"}</small>
                <input type="number" min="0" max="100" value={examConfig.counts[item]} onChange={(event) => setExamConfig((current) => ({
                  ...current,
                  counts: { ...current.counts, [item]: Math.min(100, Math.max(0, Number(event.target.value) || 0)) },
                }))} />
                <em>题</em>
              </label>
            ))}
          </div>
          {elementScopeControl}
          <div className="exam-summary"><span>共 <b>{examTotal}</b> 题</span><span>限时 <b>{examConfig.durationMinutes}</b> 分钟</span><span>满分 <b>{examConfig.totalPoints}</b> 分</span></div>
          <div className="exam-screen-actions">
            <button className="skip-action" onClick={() => { setAppMode("practice"); showCurrentPractice(); }}>返回练习</button>
            <button className="primary-action" disabled={examTotal < 1} onClick={startExam}>开始考试</button>
          </div>
        </section>
      ) : appMode === "exam_result" ? (
        <section className="exam-screen result-screen">
          <div className="score-orb"><strong>{examScore}</strong><span>/ {examConfig.totalPoints} 分</span></div>
          <div className="exam-heading">
            <span className="panel-label">考试完成</span>
            <h1>{examScore >= examConfig.totalPoints * 0.8 ? "掌握得很扎实" : examScore >= examConfig.totalPoints * 0.6 ? "基础已经建立" : "建议继续练习"}</h1>
            <p>共作答 {examAnswered} / {examTotal} 题，答对 {examCorrect} 题，用时 {formatDuration(examUsedSeconds)}。</p>
          </div>
          <div className="result-breakdown">
            {FORMAT_ORDER.map((item) => {
              const result = examBreakdown[item];
              const planned = examConfig.counts[item];
              return <div key={item}><span>{formatLanguage.formats.find((formatItem) => formatItem.id === item)?.label}</span><b>{result.correct} / {planned}</b><small>作答 {result.answered} 题</small></div>;
            })}
          </div>
          <section className="exam-review-list">
            <div className="exam-review-heading">
              <span className="panel-label">整卷解析</span>
              <h2>所有题目、作答结果与教材依据</h2>
              <p>点击任意题目展开选项、正确答案和原文出处。</p>
            </div>
            {examQuestionResults.map((result, index) => (
              <ExamReviewCard
                question={result.question}
                selected={result.selected}
                index={index}
                data={data}
                key={result.question.id}
              />
            ))}
          </section>
          <div className="exam-screen-actions">
            <button className="skip-action" onClick={() => { setAppMode("practice"); showCurrentPractice(); }}>返回练习</button>
            <button className="primary-action" onClick={() => setAppMode("exam_setup")}>再考一次</button>
          </div>
        </section>
      ) : (
      <section className="workspace">
        <aside className="control-panel">
          {appMode === "exam_running" ? (
            <div className="exam-progress-panel">
              <div className="panel-label">考试进行中</div>
              <div className="exam-progress-number"><strong>{examIndex + 1}</strong><span>/ {examQuestions.length}</span></div>
              <div className="exam-progress-bar"><i style={{ width: `${((examIndex + 1) / examQuestions.length) * 100}%` }} /></div>
              <p>当前题型</p>
              <b>{formatLanguage.formats.find((item) => item.id === format)?.label}</b>
              <div className="exam-question-map" aria-label="考试题目导航">
                {examQuestions.map((item, index) => (
                  <button
                    className={`${index === examIndex ? "current" : ""} ${examAnswers[index]?.size ? "answered" : ""}`}
                    onClick={() => showExamQuestion(index)}
                    aria-label={`第 ${index + 1} 题，${examAnswers[index]?.size ? "已作答" : "未作答"}`}
                    key={item.id}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
              <div className="exam-progress-clock"><small>剩余时间</small><strong>{formatDuration(remainingSeconds)}</strong></div>
              <button className="end-exam-button" onClick={() => { if (window.confirm("确定提前交卷吗？未作答题目将不计分。")) finishExam(); }}>提前交卷</button>
            </div>
          ) : (
          <>
          <div className="panel-label">题目格式</div>
          <button className={format === "color_of" ? "format-button active" : "format-button"} onClick={() => changeFormat("color_of")}>
            <span className="format-icon">A→色</span><span><b>{formatLanguage.formats.find((item) => item.id === "color_of")?.label}</b><small>单项选择 · 4 个选项</small></span>
          </button>
          <button className={format === "which_one_is_color" ? "format-button active" : "format-button"} onClick={() => changeFormat("which_one_is_color")}>
            <span className="format-icon">色→1A</span><span><b>{formatLanguage.formats.find((item) => item.id === "which_one_is_color")?.label}</b><small>单项选择 · 4 个选项</small></span>
          </button>
          <button className={format === "which_are_color" ? "format-button active" : "format-button"} onClick={() => changeFormat("which_are_color")}>
            <span className="format-icon">色→A</span><span><b>{formatLanguage.formats.find((item) => item.id === "which_are_color")?.label}</b><small>多项选择 · 6 个选项</small></span>
          </button>

          {elementScopeControl}

          <div className="stats-grid">
            <div><span>{stats.answered}</span><small>已答</small></div>
            <div><span>{accuracy}%</span><small>正确率</small></div>
            <div><span>{stats.streak}</span><small>连续正确</small></div>
          </div>

          <div className="database-note">
            <b>物质数据库</b>
            <p>{data.metadata.observationCount.toLocaleString()} 条规范观察</p>
            <p>{data.metadata.sourceCount.toLocaleString()} 条原文来源</p>
            <span>题目不会预先保存，每次按格式规则重新组合。</span>
          </div>
          </>
          )}
        </aside>

        <section className="quiz-card">
          <div className="quiz-meta">
            <span className="type-tag">{format === "which_are_color" ? "多项选择" : "单项选择"}</span>
            <span>{appMode === "exam_running"
              ? `第 ${examIndex + 1} / ${examQuestions.length} 题 · `
              : practiceIndex < practiceHistory.length
                ? `练习记录 ${practiceIndex + 1} / ${practiceHistory.length} · `
                : `新题 · 已记录 ${practiceHistory.length} 题 · `}
              {format === "color_of"
              ? "选择最符合教材描述的颜色"
              : format === "which_one_is_color"
                ? "从四种物质中选择唯一正确项"
                : "可能有两个或三个正确选项"}</span>
          </div>

          <div className="question-area">
            {format === "color_of" ? (
              <>
                <div className="hero-formula"><Formula observation={question.target} /></div>
                <div className="qualifier"><MarkdownText inline>{qualifier(question.target) || "教材所述通常状态"}</MarkdownText></div>
                <h1>是什么颜色？</h1>
              </>
            ) : (
              <>
                <div className="question-kicker">下列物质中，呈</div>
                <div className="hero-color">{question.targetColor}</div>
                <h1>{format === "which_one_is_color" ? "的是哪一种？" : "的有哪些？"}</h1>
              </>
            )}
          </div>

          <div className={format === "which_are_color" ? "choices multi" : "choices"}>
            {question.choices.map((choice, index) => {
              const picked = selected.has(choice.id);
              const correct = question.correctIds.has(choice.id);
              const missedCorrect = question.format === "which_are_color" && correct && !picked;
              const state = submitted
                ? correct
                  ? missedCorrect ? "correct correct-missed" : "correct correct-picked"
                  : picked ? "wrong" : ""
                : picked ? "selected" : "";
              return (
                <button key={`${question.id}-${choice.id}`} className={`choice ${state}`} onClick={() => toggleChoice(choice.id)}>
                  <span className="choice-key">{index + 1}</span>
                  <span className="choice-label">
                    {choice.observation ? <Formula observation={choice.observation} compact /> : choice.label}
                    {choice.observation && qualifier(choice.observation) ? <small><MarkdownText inline>{qualifier(choice.observation)}</MarkdownText></small> : null}
                  </span>
                  <span className="choice-state">{submitted && correct ? "✓" : submitted && picked ? "×" : format === "which_are_color" ? "□" : "○"}</span>
                </button>
              );
            })}
          </div>

          <div className="quiz-actions">
            {appMode === "exam_running" ? (
              <>
                <button className="navigation-action" disabled={examIndex === 0} onClick={previousQuestion}>上一题</button>
                {examIndex + 1 === examQuestions.length ? (
                  <button className="primary-action" onClick={() => { if (window.confirm("确定提交试卷吗？提交后不能再修改答案。")) finishExam(); }}>提交试卷 <span>Enter</span></button>
                ) : (
                  <button className="primary-action" onClick={nextQuestion}>下一题 <span>Enter</span></button>
                )}
              </>
            ) : (
              <>
                <button className="navigation-action" disabled={!practiceHistory.length || practiceIndex === 0} onClick={previousQuestion}>上一题</button>
                {!submitted ? <button className="primary-action" disabled={!selected.size} onClick={submit}>确认答案 <span>Enter</span></button> : null}
                <button className={submitted ? "primary-action" : "navigation-action"} onClick={nextQuestion}>
                  {submitted || practiceIndex < practiceHistory.length ? "下一题" : "跳过并下一题"}
                  {submitted ? <span>Enter</span> : null}
                </button>
              </>
            )}
          </div>
        </section>

        <aside className={submitted ? "source-panel revealed" : "source-panel"}>
          {!submitted ? (
            <div className="source-placeholder">
              <div className="source-symbol">原</div>
              <h2>作答后查看依据</h2>
              <p>正确答案、OCR 证据原句和教材页码会显示在这里。</p>
              <ul><li>化学式由 mhchem 排版</li><li>答案来自规范观察</li><li>原文按钮直达 PDF 页</li></ul>
            </div>
          ) : (
            <div className="source-content">
              <span className={isExact ? "result-badge good" : "result-badge bad"}>{isExact ? "回答正确" : "再看一下原文"}</span>
              <h2>{question.format === "color_of" ? "教材依据" : "各选项颜色与教材依据"}</h2>
              {evidenceGroups.map((group) => {
                const observation = group.representative;
                const source = group.sources[0];
                const correctOption = question.format === "color_of" || question.correctIds.has(observation.substanceId);
                return (
                  <article className={correctOption ? "evidence-card correct-evidence" : "evidence-card"} key={group.key}>
                    <div className="evidence-heading"><Formula observation={observation} compact /><b>{group.colors.join(" / ")}</b></div>
                    {question.format !== "color_of" ? <span className={correctOption ? "evidence-role correct" : "evidence-role"}>{correctOption ? "正确选项" : "其他选项"}</span> : null}
                    {source?.evidence_text ? <MarkdownText>{source.evidence_text}</MarkdownText> : null}
                    {source ? <span className="page-reference"><b>{sourcePageLabel(source)}</b><small>PDF 第 {source.pdf_page} 页</small></span> : null}
                  </article>
                );
              })}
              <div className="page-previews">
                <h3>教材原页</h3>
                {sourcePages.map((source) => <PagePreview source={source} key={source.pdf_page} />)}
              </div>
            </div>
          )}
        </aside>
      </section>
      )}
      <footer><span>题目规则 CQF {formatLanguage.version}</span><span>快捷键：1–6 选择，←/→ 上一题/下一题，Enter 确认或继续</span><span>仅使用高置信度教材记录</span></footer>
    </main>
  );
}

export default function Home() {
  const [quizBank, setQuizBank] = useState<"color" | "equation">("color");
  return quizBank === "color"
    ? <ColorQuiz onSwitchToEquations={() => setQuizBank("equation")} />
    : <EquationQuiz onSwitchToColors={() => setQuizBank("color")} />;
}
