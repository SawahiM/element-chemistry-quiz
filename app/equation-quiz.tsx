"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { coefficientIsExact, equationAnswerIsExact, formulaElements } from "./equation-policy";
import { publicPath } from "./public-path";
import { loadSessionResource, peekSessionResource } from "./session-cache";
import { loadAccountData, saveAccountData } from "./account-storage";
import { appendHistory, loadPracticeHistory, type HistoryRecord } from "./history-storage";

export type Participant = {
  side: "reactant" | "product";
  position: number;
  formulaCanonical: string;
  coefficientNum: number;
  coefficientDen: number;
  phase: string | null;
  formationMarker: string | null;
  parseStatus: string;
};

type ReactionCondition = { valueText: string; rawText: string; relatedFormula: string | null };
export type Reaction = {
  id: string;
  equationCanonical: string;
  direction: string;
  balanceStatus: string;
  parseStatus: string;
  eligibleForQuiz: boolean;
  isExercise: boolean;
  participants: Participant[];
  conditions: ReactionCondition[];
  source: {
    pdfPage: number;
    printedPage: number | null;
    heading: string | null;
    evidenceText: string;
  };
};

export type ReactionDataset = {
  metadata: { reactionCount: number; parsedCount: number; balancedCount: number; schemaVersion: string };
  reactions: Reaction[];
};

export type Direction = "forward" | "reverse";
type QuizMode = "practice" | "exam_setup" | "exam_running" | "exam_result";
export type EquationQuestion = { id: string; reaction: Reaction; direction: Direction };
export type EquationResponse = {
  formulas: string[];
  knownCoefficients: string[];
  answerCoefficients: string[];
};
type ActiveField = { kind: keyof EquationResponse; index: number };
type AnswerRecord = { question: EquationQuestion; response: EquationResponse; correct: boolean; requireBalancing: boolean; fixedCount: boolean };
type ExamConfig = { durationMinutes: number; totalPoints: number; forward: number; reverse: number };
type StoredEquationSession = {
  version?: number;
  question?: { id?: string; reactionId?: string; direction?: string };
  response?: EquationResponse;
  submitted?: boolean;
  direction?: Direction;
  requireBalancing?: boolean;
  fixedCount?: boolean;
  scope?: string[];
  stats?: { answered: number; correct: number; streak: number };
  examConfig?: ExamConfig;
};

const SESSION_KEY = "element-chemistry-equation-quiz-v1";
const ELEMENTS = [
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar",
  "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr",
  "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe",
  "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu",
  "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn",
  "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr",
  "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
];
const ELEMENT_GROUPS = [
  { label: "氢", elements: ["H"] },
  { label: "碱金属与碱土金属", elements: ["Li", "Na", "K", "Rb", "Cs", "Fr", "Be", "Mg", "Ca", "Sr", "Ba", "Ra"] },
  { label: "硼族与碳族", elements: ["B", "Al", "Ga", "In", "Tl", "C", "Si", "Ge", "Sn", "Pb"] },
  { label: "氮族、氧族与卤素", elements: ["N", "P", "As", "Sb", "Bi", "O", "S", "Se", "Te", "Po", "F", "Cl", "Br", "I", "At"] },
  { label: "第四周期过渡金属", elements: ["Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn"] },
  { label: "铜锌副族与铂系", elements: ["Cu", "Ag", "Au", "Zn", "Cd", "Hg", "Ru", "Rh", "Pd", "Os", "Ir", "Pt"] },
  { label: "镧系", elements: ["La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu"] },
  { label: "锕系", elements: ["Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr"] },
];

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function Formula({ value }: { value: string }) {
  const html = katex.renderToString(`\\ce{${value}}`, {
    throwOnError: false,
    strict: "ignore",
    output: "html",
  });
  return <span className="eq-formula" aria-label={value} dangerouslySetInnerHTML={{ __html: html }} />;
}

function normalizeMarkdownMath(value: string): string {
  return value
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression: string) => `$${expression.trim()}$`);
}

function MarkdownText({ children }: { children: string }) {
  return (
    <div className="markdown-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          a: ({ node, children: content, ...props }) => {
            void node;
            return <a {...props} target="_blank" rel="noreferrer">{content}</a>;
          },
        }}
      >
        {normalizeMarkdownMath(children)}
      </ReactMarkdown>
    </div>
  );
}

function coefficient(participant: Participant): string {
  if (participant.coefficientNum === participant.coefficientDen) return "";
  if (participant.coefficientDen === 1) return String(participant.coefficientNum);
  return `${participant.coefficientNum}/${participant.coefficientDen}`;
}

function marker(participant: Participant): string {
  const phase = participant.phase ? `(${participant.phase})` : "";
  const formation = participant.formationMarker === "gas_release"
    ? "↑"
    : participant.formationMarker === "precipitate"
      ? "↓"
      : "";
  return `${phase}${formation}`;
}

function displayParticipant(participant: Participant, showCoefficient = true) {
  return `${showCoefficient ? coefficient(participant) : ""}${participant.formulaCanonical}${marker(participant)}`;
}

function reactionElements(reaction: Reaction): string[] {
  return formulaElements(reaction.participants.map((part) => part.formulaCanonical));
}

export function validReactions(data: ReactionDataset, scope: Set<string>): Reaction[] {
  return data.reactions.filter((reaction) => {
    const reactants = reaction.participants.filter((part) => part.side === "reactant");
    const products = reaction.participants.filter((part) => part.side === "product");
    return reaction.eligibleForQuiz
      && reaction.parseStatus === "parsed"
      && !reaction.isExercise
      && reactants.length > 0
      && products.length > 0
      && reaction.participants.every((part) => part.parseStatus === "parsed")
      && reactionElements(reaction).some((element) => scope.has(element));
  });
}

function restoreEquationPracticeHistory(records: HistoryRecord[], data: ReactionDataset): AnswerRecord[] {
  const reactionMap = new Map(data.reactions.map((reaction) => [reaction.id, reaction]));
  return records.map((record) => {
    const payload = record.payload as {
      question?: { id?: string; direction?: Direction; reaction?: { id?: string } };
      response?: EquationResponse;
      requireBalancing?: boolean;
      fixedCount?: boolean;
    };
    const reaction = payload.question?.reaction?.id ? reactionMap.get(payload.question.reaction.id) : undefined;
    const response = payload.response;
    if (!reaction || !payload.question?.id || !response || !Array.isArray(response.formulas) || !Array.isArray(response.knownCoefficients) || !Array.isArray(response.answerCoefficients)) return null;
    return {
      question: { id: payload.question.id, reaction, direction: payload.question.direction === "reverse" ? "reverse" : "forward" },
      response: {
        formulas: [...response.formulas],
        knownCoefficients: [...response.knownCoefficients],
        answerCoefficients: [...response.answerCoefficients],
      },
      correct: record.correct === true,
      requireBalancing: payload.requireBalancing !== false,
      fixedCount: payload.fixedCount !== false,
    };
  }).filter((entry): entry is AnswerRecord => entry !== null);
}

function equationPracticeStats(entries: AnswerRecord[]) {
  return entries.reduce((stats, entry) => ({
    answered: stats.answered + 1,
    correct: stats.correct + Number(entry.correct),
    streak: entry.correct ? stats.streak + 1 : 0,
  }), { answered: 0, correct: 0, streak: 0 });
}

export function questionFor(reactions: Reaction[], direction: Direction, previousId?: string): EquationQuestion {
  const pool = reactions.filter((reaction) => reaction.id !== previousId);
  const reaction = (pool.length ? pool : reactions)[Math.floor(Math.random() * (pool.length ? pool.length : reactions.length))];
  if (!reaction) throw new Error("当前范围内没有可用的方程式");
  return { id: `${direction}-${reaction.id}-${Date.now()}-${Math.random()}`, reaction, direction };
}

export function hiddenParticipants(question: EquationQuestion): Participant[] {
  return question.reaction.participants
    .filter((part) => part.side === (question.direction === "forward" ? "product" : "reactant"))
    .sort((left, right) => left.position - right.position);
}

function visibleParticipants(question: EquationQuestion): Participant[] {
  return question.reaction.participants
    .filter((part) => part.side === (question.direction === "forward" ? "reactant" : "product"))
    .sort((left, right) => left.position - right.position);
}

export function blankResponse(question: EquationQuestion, fixedCount: boolean): EquationResponse {
  const answerCount = fixedCount ? hiddenParticipants(question).length : 1;
  return {
    formulas: Array(answerCount).fill(""),
    knownCoefficients: Array(visibleParticipants(question).length).fill(""),
    answerCoefficients: Array(answerCount).fill(""),
  };
}

export function exact(question: EquationQuestion, response: EquationResponse, requireBalancing: boolean): boolean {
  if (requireBalancing && (
    response.knownCoefficients.some((value) => !value.trim())
    || response.answerCoefficients.some((value) => !value.trim())
  )) return false;
  const hiddenExact = equationAnswerIsExact(
    response.formulas.map((formula, index) =>
      requireBalancing ? `${response.answerCoefficients[index] || ""}${formula}` : formula
    ),
    hiddenParticipants(question).map((part) => ({
      formula: part.formulaCanonical,
      coefficientNum: part.coefficientNum,
      coefficientDen: part.coefficientDen,
    })),
    requireBalancing,
  );
  if (!hiddenExact || !requireBalancing) return hiddenExact;
  return visibleParticipants(question).every((part, index) =>
    coefficientIsExact(response.knownCoefficients[index] || "", part.coefficientNum, part.coefficientDen)
  );
}

function conditionLabel(reaction: Reaction): string {
  return reaction.conditions.map((condition) => condition.valueText || condition.rawText).filter(Boolean).join(" · ") || "教材未另注条件";
}

function sourcePageLabel(reaction: Reaction): string {
  return reaction.source.printedPage ? `教材第 ${reaction.source.printedPage} 页` : `PDF 第 ${reaction.source.pdfPage} 页`;
}

function EquationLine({
  question,
  requireBalancing,
  response,
  fixedCount,
  activeField,
  submitted,
  onField,
  onActivate,
  onAdd,
  onRemove,
}: {
  question: EquationQuestion;
  requireBalancing: boolean;
  response: EquationResponse;
  fixedCount: boolean;
  activeField: ActiveField;
  submitted: boolean;
  onField: (kind: keyof EquationResponse, index: number, value: string) => void;
  onActivate: (field: ActiveField) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const visible = visibleParticipants(question);
  const visibleLine = visible.map((part, index) => (
    <span className="eq-visible-part" key={`${part.side}-${part.position}`}>
      {index ? <b className="eq-plus">+</b> : null}
      {requireBalancing ? (
        <input
          className="eq-coefficient-input"
          value={response.knownCoefficients[index] || ""}
          disabled={submitted}
          inputMode="numeric"
          onFocus={() => onActivate({ kind: "knownCoefficients", index })}
          onChange={(event) => onField("knownCoefficients", index, event.target.value)}
          aria-label={`${part.formulaCanonical} 的系数`}
          placeholder="系数"
        />
      ) : null}
      <Formula value={displayParticipant(part, false)} />
    </span>
  ));
  const inputs = (
    <div className="eq-answer-side">
      {response.formulas.map((answer, index) => (
        <span className="eq-answer-slot" key={`${question.id}-${index}`}>
          {index ? <b className="eq-plus">+</b> : null}
          {requireBalancing ? (
            <input
              className="eq-coefficient-input"
              value={response.answerCoefficients[index] || ""}
              disabled={submitted}
              inputMode="numeric"
              onFocus={() => onActivate({ kind: "answerCoefficients", index })}
              onChange={(event) => onField("answerCoefficients", index, event.target.value)}
              aria-label={`第 ${index + 1} 个${question.direction === "forward" ? "产物" : "反应物"}的系数`}
              placeholder="系数"
            />
          ) : null}
          <input
            className="eq-formula-input"
            ref={(node) => { if (node && activeField.kind === "formulas" && index === activeField.index) node.dataset.active = "true"; }}
            value={answer}
            disabled={submitted}
            onFocus={() => onActivate({ kind: "formulas", index })}
            onChange={(event) => onField("formulas", index, event.target.value)}
            aria-label={`第 ${index + 1} 个${question.direction === "forward" ? "产物" : "反应物"}`}
            placeholder={requireBalancing ? "系数＋化学式" : "化学式"}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {!fixedCount && response.formulas.length > 1 && !submitted
            ? <button className="eq-remove" onClick={() => onRemove(index)} aria-label={`删除第 ${index + 1} 个空格`}>×</button>
            : null}
        </span>
      ))}
      {!fixedCount && !submitted ? <button className="eq-add" onClick={onAdd}>＋ 添加物质</button> : null}
    </div>
  );
  return (
    <div className="equation-composer">
      <div className="equation-side">{question.direction === "forward" ? visibleLine : inputs}</div>
      <div className="equation-arrow">
        <span>{conditionLabel(question.reaction)}</span>
        <b>{question.reaction.direction === "reversible" ? "⇌" : "⟶"}</b>
      </div>
      <div className="equation-side">{question.direction === "forward" ? inputs : visibleLine}</div>
    </div>
  );
}

export function EquationExamQuestion({
  question,
  response,
  requireBalancing,
  fixedCount,
  onChange,
}: {
  question: EquationQuestion;
  response: EquationResponse;
  requireBalancing: boolean;
  fixedCount: boolean;
  onChange: (response: EquationResponse) => void;
}) {
  const [activeField, setActiveField] = useState<ActiveField>({ kind: "formulas", index: 0 });
  const keypadElements = reactionElements(question.reaction);
  const includesElectron = question.reaction.participants.some((part) => part.formulaCanonical.includes("e^-"));
  const updateField = (kind: keyof EquationResponse, index: number, value: string) => {
    const next = { ...response, [kind]: response[kind].map((item, itemIndex) => itemIndex === index ? value : item) };
    onChange(next);
  };
  const appendToken = (token: string) => {
    const values = response[activeField.kind];
    updateField(activeField.kind, activeField.index, `${values[activeField.index] || ""}${token}`);
  };
  const backspace = () => {
    const values = response[activeField.kind];
    updateField(activeField.kind, activeField.index, (values[activeField.index] || "").slice(0, -1));
  };
  const addAnswer = () => onChange({
    ...response,
    formulas: [...response.formulas, ""],
    answerCoefficients: [...response.answerCoefficients, ""],
  });
  const removeAnswer = (index: number) => {
    onChange({
      ...response,
      formulas: response.formulas.filter((_, itemIndex) => itemIndex !== index),
      answerCoefficients: response.answerCoefficients.filter((_, itemIndex) => itemIndex !== index),
    });
    setActiveField({ kind: "formulas", index: 0 });
  };

  return <>
    <div className="quiz-meta"><span className="type-tag">填空题</span><span>{question.direction === "forward" ? "根据反应物和条件完成产物" : "根据产物和条件倒推反应物"} · {requireBalancing ? "需配平" : "忽略系数"}</span></div>
    <div className="equation-prompt"><span>{question.direction === "forward" ? "完成方程式的产物一侧" : "补全方程式的反应物一侧"}</span><h1>{fixedCount ? `已给出 ${hiddenParticipants(question).length} 个作答位置` : "可按需要增加或删除物质"}</h1></div>
    <EquationLine question={question} requireBalancing={requireBalancing} response={response} fixedCount={fixedCount} activeField={activeField} submitted={false} onField={updateField} onActivate={setActiveField} onAdd={addAnswer} onRemove={removeAnswer} />
    <div className="touch-keyboard">
      <div className="keyboard-heading"><span>元素键盘</span><small>元素种类由已知一侧确定</small></div>
      <div className="keyboard-layout">
        <div className="element-key-grid">{keypadElements.map((element) => <button key={element} onClick={() => appendToken(element)}>{element}</button>)}{includesElectron ? <button onClick={() => appendToken("e^-")}>e⁻</button> : null}{["(", ")", "[", "]", "+", "-", "^"].map((token) => <button className="symbol-key" key={token} onClick={() => appendToken(token)}>{token}</button>)}</div>
        <div className="number-keypad">{["7", "8", "9", "4", "5", "6", "1", "2", "3", "/", "0"].map((number) => <button key={number} onClick={() => appendToken(number)}>{number}</button>)}<button className="backspace-key" onClick={backspace}>⌫</button></div>
      </div>
    </div>
  </>;
}

export function EquationExamReviewCard({
  question,
  response,
  requireBalancing,
  index,
}: {
  question: EquationQuestion;
  response: EquationResponse;
  requireBalancing: boolean;
  index: number;
}) {
  const correct = exact(question, response, requireBalancing);
  const answered = response.formulas.some((answer) => answer.trim())
    || response.knownCoefficients.some((answer) => answer.trim())
    || response.answerCoefficients.some((answer) => answer.trim());
  return <details className={correct ? "exam-review-card correct-review" : "exam-review-card wrong-review"}>
    <summary><span>第 {index + 1} 题</span><b>{question.direction === "forward" ? "正推产物" : "逆推反应物"}</b><em>{correct ? "正确" : answered ? "错误" : "未作答"}</em></summary>
    <div className="exam-review-body equation-review-body">
      <p><b>你的答案：</b>{response.formulas.map((formula, answerIndex) => `${requireBalancing ? response.answerCoefficients[answerIndex] || "?" : ""}${formula}`).filter(Boolean).join(" + ") || "未作答"}</p>
      <p><b>标准方程式：</b><Formula value={question.reaction.equationCanonical} /></p>
      <p><b>条件：</b>{conditionLabel(question.reaction)}</p>
      <div className="equation-ocr-text"><MarkdownText>{question.reaction.source.evidenceText}</MarkdownText></div>
      <span className="page-reference"><b>{sourcePageLabel(question.reaction)}</b><small>PDF 第 {question.reaction.source.pdfPage} 页</small></span>
    </div>
  </details>;
}

export default function EquationQuiz() {
  const [data, setData] = useState<ReactionDataset | null>(() => peekSessionResource(publicPath("/reactions.quiz.v1.json")));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("forward");
  const [requireBalancing, setRequireBalancing] = useState(true);
  const [fixedCount, setFixedCount] = useState(true);
  const [scope, setScope] = useState<Set<string>>(() => new Set(ELEMENTS));
  const [scopeDraft, setScopeDraft] = useState<Set<string>>(() => new Set(ELEMENTS));
  const [scopeOpen, setScopeOpen] = useState(false);
  const [question, setQuestion] = useState<EquationQuestion | null>(null);
  const [response, setResponse] = useState<EquationResponse>({ formulas: [], knownCoefficients: [], answerCoefficients: [] });
  const [activeField, setActiveField] = useState<ActiveField>({ kind: "formulas", index: 0 });
  const [submitted, setSubmitted] = useState(false);
  const [history, setHistory] = useState<AnswerRecord[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [stats, setStats] = useState({ answered: 0, correct: 0, streak: 0 });
  const [mode, setMode] = useState<QuizMode>("practice");
  const [examConfig, setExamConfig] = useState<ExamConfig>({ durationMinutes: 20, totalPoints: 100, forward: 10, reverse: 10 });
  const [examQuestions, setExamQuestions] = useState<EquationQuestion[]>([]);
  const [examResponses, setExamResponses] = useState<EquationResponse[]>([]);
  const [examIndex, setExamIndex] = useState(0);
  const [examStartedAt, setExamStartedAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const restored = useRef(false);
  const savedExamStartRef = useRef<number | null>(null);

  useEffect(() => {
    loadSessionResource<ReactionDataset>(publicPath("/reactions.quiz.v1.json"), "方程式题库载入失败")
      .then((payload) => setData(payload))
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const pool = useMemo(() => data ? validReactions(data, scope) : [], [data, scope]);

  const setNewQuestion = useCallback((nextDirection = direction, nextFixed = fixedCount, reactions = pool) => {
    if (!reactions.length) return;
    const next = questionFor(reactions, nextDirection, question?.reaction.id);
    setQuestion(next);
    setDirection(nextDirection);
    setResponse(blankResponse(next, nextFixed));
    setActiveField({ kind: "formulas", index: 0 });
    setSubmitted(false);
    setHistoryIndex(history.length);
  }, [direction, fixedCount, history.length, pool, question?.reaction.id]);

  useEffect(() => {
    if (!data || question || restored.current) return;
    const timer = window.setTimeout(async () => {
      restored.current = true;
      try {
        const [stored, historyRecords] = await Promise.all([
          loadAccountData<StoredEquationSession>(SESSION_KEY),
          loadPracticeHistory("equation"),
        ]);
        const restoredHistory = restoreEquationPracticeHistory(historyRecords, data);
        setHistory(restoredHistory);
        setStats(equationPracticeStats(restoredHistory));
        const reactionMap = new Map(data.reactions.map((reaction) => [reaction.id, reaction]));
        if ((stored?.version === 2 || stored?.version === 3) && stored.question?.reactionId) {
          const submittedIndex = stored.submitted && stored.question.id
            ? restoredHistory.findIndex((record) => record.question.id === stored.question?.id)
            : -1;
          if (submittedIndex >= 0) {
            const record = restoredHistory[submittedIndex];
            setDirection(record.question.direction);
            setRequireBalancing(record.requireBalancing);
            setFixedCount(record.fixedCount);
            setQuestion(record.question);
            setResponse(record.response);
            setSubmitted(true);
            setHistoryIndex(submittedIndex);
            setExamConfig(stored.examConfig || examConfig);
            return;
          }
          const restoredReaction = reactionMap.get(stored.question.reactionId);
          if (restoredReaction && !stored.submitted) {
            const restoredDirection: Direction = stored.question.direction === "reverse" ? "reverse" : "forward";
            const restoredScope = new Set<string>((stored.scope || ELEMENTS).filter((item: string) => ELEMENTS.includes(item)));
            setDirection(restoredDirection);
            setRequireBalancing(stored.requireBalancing !== false);
            setFixedCount(stored.fixedCount !== false);
            setScope(restoredScope.size ? restoredScope : new Set(ELEMENTS));
            setQuestion({ id: stored.question.id || `restored-${restoredDirection}-${restoredReaction.id}`, reaction: restoredReaction, direction: restoredDirection });
            const restoredResponse = stored.response;
            setResponse(
              restoredResponse
              && Array.isArray(restoredResponse.formulas)
              && Array.isArray(restoredResponse.knownCoefficients)
              && Array.isArray(restoredResponse.answerCoefficients)
                ? restoredResponse
                : blankResponse({ id: "restore", reaction: restoredReaction, direction: restoredDirection }, stored.fixedCount !== false),
            );
            setHistoryIndex(restoredHistory.length);
            setSubmitted(false);
            setExamConfig(stored.examConfig || examConfig);
            return;
          }
        }
      } catch { /* Start a clean equation session when no valid server record exists. */ }
      const reactions = validReactions(data, new Set(ELEMENTS));
      const first = questionFor(reactions, "forward");
      setQuestion(first);
      setResponse(blankResponse(first, true));
      setSubmitted(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data, examConfig, question]);

  useEffect(() => {
    if (!question || !data || mode !== "practice") return;
    const timer = window.setTimeout(() => {
      void saveAccountData(SESSION_KEY, {
        version: 3,
        question: { id: question.id, reactionId: question.reaction.id, direction: question.direction },
        response,
        submitted,
        direction,
        requireBalancing,
        fixedCount,
        scope: [...scope],
        stats,
        examConfig,
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [data, direction, examConfig, fixedCount, mode, question, requireBalancing, response, scope, stats, submitted]);

  const updateField = (kind: keyof EquationResponse, index: number, value: string) => {
    setResponse((current) => ({
      ...current,
      [kind]: current[kind].map((item, itemIndex) => itemIndex === index ? value : item),
    }));
    if (mode === "exam_running") {
      setExamResponses((current) => current.map((answer, questionIndex) =>
        questionIndex === examIndex
          ? { ...answer, [kind]: answer[kind].map((item, itemIndex) => itemIndex === index ? value : item) }
          : answer
      ));
    }
  };

  const addAnswer = () => {
    setResponse((current) => ({
      ...current,
      formulas: [...current.formulas, ""],
      answerCoefficients: [...current.answerCoefficients, ""],
    }));
    if (mode === "exam_running") {
      setExamResponses((current) => current.map((answer, index) => index === examIndex
        ? { ...answer, formulas: [...answer.formulas, ""], answerCoefficients: [...answer.answerCoefficients, ""] }
        : answer));
    }
    setActiveField({ kind: "formulas", index: response.formulas.length });
  };

  const removeAnswer = (index: number) => {
    const nextFormulas = response.formulas.filter((_, answerIndex) => answerIndex !== index);
    const nextCoefficients = response.answerCoefficients.filter((_, answerIndex) => answerIndex !== index);
    setResponse((current) => ({ ...current, formulas: nextFormulas, answerCoefficients: nextCoefficients }));
    if (mode === "exam_running") {
      setExamResponses((current) => current.map((answer, questionIndex) =>
        questionIndex === examIndex
          ? {
              ...answer,
              formulas: answer.formulas.filter((_, answerIndex) => answerIndex !== index),
              answerCoefficients: answer.answerCoefficients.filter((_, answerIndex) => answerIndex !== index),
            }
          : answer
      ));
    }
    setActiveField({ kind: "formulas", index: Math.max(0, Math.min(activeField.index, nextFormulas.length - 1)) });
  };

  const appendToken = (token: string) => {
    if (submitted) return;
    if (activeField.kind !== "formulas" && !/^[0-9/]$/.test(token)) return;
    updateField(activeField.kind, activeField.index, `${response[activeField.kind][activeField.index] || ""}${token}`);
  };

  const backspace = () => {
    if (submitted) return;
    updateField(activeField.kind, activeField.index, (response[activeField.kind][activeField.index] || "").slice(0, -1));
  };

  const responseComplete = response.formulas.every((formula) => formula.trim())
    && (!requireBalancing || (
      response.knownCoefficients.every((value) => value.trim())
      && response.answerCoefficients.every((value) => value.trim())
    ));
  const isCorrect = question ? exact(question, response, requireBalancing) : false;
  const submitPractice = () => {
    if (!question || submitted || !responseComplete) return;
    const correct = exact(question, response, requireBalancing);
    setSubmitted(true);
    setHistory((current) => [...current, {
      question,
      response: {
        formulas: [...response.formulas],
        knownCoefficients: [...response.knownCoefficients],
        answerCoefficients: [...response.answerCoefficients],
      },
      correct,
      requireBalancing,
      fixedCount,
    }]);
    setHistoryIndex(history.length);
    setStats((current) => ({
      answered: current.answered + 1,
      correct: current.correct + Number(correct),
      streak: correct ? current.streak + 1 : 0,
    }));
    void appendHistory([{
      clientKey: `equation-practice-${question.id}`,
      recordType: "practice",
      quizKind: "equation",
      source: "practice",
      correct,
      payload: {
        version: 1,
        question,
        response: { formulas: [...response.formulas], knownCoefficients: [...response.knownCoefficients], answerCoefficients: [...response.answerCoefficients] },
        requireBalancing,
        fixedCount,
      },
      createdAt: Math.floor(Date.now() / 1000),
    }]);
  };

  const showHistory = (index: number) => {
    const record = history[index];
    if (!record) return;
    setQuestion(record.question);
    setDirection(record.question.direction);
    setResponse({
      formulas: [...record.response.formulas],
      knownCoefficients: [...record.response.knownCoefficients],
      answerCoefficients: [...record.response.answerCoefficients],
    });
    setRequireBalancing(record.requireBalancing);
    setFixedCount(record.fixedCount);
    setHistoryIndex(index);
    setSubmitted(true);
  };

  const nextPractice = () => {
    if (historyIndex < history.length - 1) showHistory(historyIndex + 1);
    else setNewQuestion(direction);
  };

  const changeDirection = (next: Direction) => {
    if (mode === "practice") setNewQuestion(next);
    else setDirection(next);
  };

  const changeFixedCount = (next: boolean) => {
    setFixedCount(next);
    if (question && !submitted) setResponse(blankResponse(question, next));
  };

  const commitScope = () => {
    if (!data || !scopeDraft.size) return;
    const nextPool = validReactions(data, scopeDraft);
    if (!nextPool.length) return;
    setScope(new Set(scopeDraft));
    setScopeOpen(false);
    if (mode === "practice") setNewQuestion(direction, fixedCount, nextPool);
  };

  const examTotal = examConfig.forward + examConfig.reverse;
  const startExam = () => {
    if (!pool.length || examTotal < 1) return;
    const directions = shuffled([
      ...Array(examConfig.forward).fill("forward" as Direction),
      ...Array(examConfig.reverse).fill("reverse" as Direction),
    ]);
    const questions = directions.map((item, index) => {
      const generated = questionFor(pool, item, index ? undefined : question?.reaction.id);
      return { ...generated, id: `exam-${Date.now()}-${index}-${generated.id}` };
    });
    const answerRows = questions.map((item) => blankResponse(item, fixedCount));
    const now = Date.now();
    setExamQuestions(questions);
    setExamResponses(answerRows);
    setExamIndex(0);
    setQuestion(questions[0]);
    setDirection(questions[0].direction);
    setResponse(answerRows[0]);
    setSubmitted(false);
    setExamStartedAt(now);
    savedExamStartRef.current = null;
    setRemainingSeconds(examConfig.durationMinutes * 60);
    setMode("exam_running");
  };

  const showExamQuestion = useCallback((index: number) => {
    const next = examQuestions[index];
    if (!next) return;
    setExamIndex(index);
    setQuestion(next);
    setDirection(next.direction);
    const stored = examResponses[index] || blankResponse(next, fixedCount);
    setResponse({
      formulas: [...stored.formulas],
      knownCoefficients: [...stored.knownCoefficients],
      answerCoefficients: [...stored.answerCoefficients],
    });
    setActiveField({ kind: "formulas", index: 0 });
  }, [examQuestions, examResponses, fixedCount]);

  const finishExam = useCallback(() => {
    const endedAt = Date.now();
    if (examStartedAt !== null && savedExamStartRef.current !== examStartedAt) {
      savedExamStartRef.current = examStartedAt;
      const results = examQuestions.map((item, index) => {
        const answer = examResponses[index] || blankResponse(item, fixedCount);
        return { question: item, response: answer, correct: exact(item, answer, requireBalancing) };
      });
      const createdAt = Math.floor(endedAt / 1000);
      void appendHistory([
        {
          clientKey: `equation-exam-${examStartedAt}`,
          recordType: "exam",
          quizKind: "equation",
          source: "exam",
          payload: { version: 1, config: examConfig, results, requireBalancing, fixedCount, startedAt: examStartedAt, endedAt },
          createdAt,
        },
        ...results.map((result, index) => ({
          clientKey: `equation-exam-question-${examStartedAt}-${index}`,
          recordType: "practice" as const,
          quizKind: "equation" as const,
          source: "exam" as const,
          correct: result.correct,
          payload: { version: 1, question: result.question, response: result.response, requireBalancing, fixedCount },
          createdAt,
        })),
      ]);
    }
    setMode("exam_result");
  }, [examConfig, examQuestions, examResponses, examStartedAt, fixedCount, requireBalancing]);

  useEffect(() => {
    if (mode !== "exam_running" || examStartedAt === null) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - examStartedAt) / 1000);
      setRemainingSeconds(Math.max(0, examConfig.durationMinutes * 60 - elapsed));
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [examConfig.durationMinutes, examStartedAt, mode]);

  useEffect(() => {
    if (mode !== "exam_running" || examStartedAt === null || remainingSeconds !== 0) return;
    const timer = window.setTimeout(finishExam, 0);
    return () => window.clearTimeout(timer);
  }, [examStartedAt, finishExam, mode, remainingSeconds]);

  if (loadError) return <main className="loading"><div><b>无法载入方程式题库</b><p>{loadError}</p></div></main>;
  if (!data || !question) return <main className="loading"><div className="loader" /><p>正在整理反应物、条件与产物…</p></main>;

  const keypadElements = formulaElements(visibleParticipants(question).map((part) => part.formulaCanonical));
  const includesElectron = question.reaction.participants.some((part) => /^e\^-/.test(part.formulaCanonical));
  const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
  const examResults = examQuestions.map((item, index) => ({
    question: item,
    response: examResponses[index] || blankResponse(item, fixedCount),
    correct: exact(item, examResponses[index] || blankResponse(item, fixedCount), requireBalancing),
  }));
  const examCorrect = examResults.filter((result) => result.correct).length;
  const examAnswered = examResults.filter((result) =>
    result.response.formulas.some((answer) => answer.trim())
    || result.response.knownCoefficients.some((answer) => answer.trim())
    || result.response.answerCoefficients.some((answer) => answer.trim())
  ).length;
  const score = examTotal ? Math.round(examCorrect / examTotal * examConfig.totalPoints) : 0;
  const usedSeconds = examStartedAt === null ? 0 : Math.max(0, examConfig.durationMinutes * 60 - remainingSeconds);
  const scopeSummary = scope.size === ELEMENTS.length ? "全部元素" : scope.size <= 8 ? [...scope].join(" · ") : `已选 ${scope.size} 个元素`;

  return (
    <main className="app-shell equation-app">
      {scopeOpen ? (
        <div className="scope-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setScopeOpen(false); }}>
          <section className="scope-modal" role="dialog" aria-modal="true" aria-labelledby="equation-scope-title">
            <header className="scope-modal-header">
              <div><span className="panel-label">全局出题范围</span><h2 id="equation-scope-title">选择考察元素</h2><p>方程式只要涉及所选元素之一即可入题。</p></div>
              <button className="scope-close" onClick={() => setScopeOpen(false)} aria-label="关闭">×</button>
            </header>
            <div className="scope-modal-body">
              <div className="scope-section-heading">
                <div><h3>教材章节与元素</h3><p>先用章节快速选择，也可逐个微调。</p></div>
                <div><button onClick={() => setScopeDraft(new Set())}>清空</button><button onClick={() => setScopeDraft(new Set(ELEMENTS))}>全选</button></div>
              </div>
              <div className="chapter-group-grid">
                {ELEMENT_GROUPS.map((group) => {
                  const count = group.elements.filter((element) => scopeDraft.has(element)).length;
                  const state = count === group.elements.length ? "selected" : count ? "partial" : "";
                  return <button className={state} key={group.label} onClick={() => {
                    setScopeDraft((current) => {
                      const next = new Set(current);
                      const selected = group.elements.every((element) => next.has(element));
                      group.elements.forEach((element) => selected ? next.delete(element) : next.add(element));
                      return next;
                    });
                  }}><span>{group.label}</span><small>{group.elements.join(" ")}</small><em>{count}/{group.elements.length}</em></button>;
                })}
              </div>
              <div className="element-key-grid scope-element-grid">
                {ELEMENTS.map((element) => <button className={scopeDraft.has(element) ? "selected" : ""} key={element} onClick={() => setScopeDraft((current) => {
                  const next = new Set(current);
                  if (next.has(element)) next.delete(element); else next.add(element);
                  return next;
                })}>{element}</button>)}
              </div>
            </div>
            <footer className="scope-modal-footer">
              <span>{scopeDraft.size ? `将限定为 ${scopeDraft.size} 个元素` : "请至少选择一个元素"}</span>
              <div><button className="navigation-action" onClick={() => setScopeOpen(false)}>取消</button><button className="primary-action" disabled={!scopeDraft.size} onClick={commitScope}>应用范围</button></div>
            </footer>
          </section>
        </div>
      ) : null}

      {mode === "exam_setup" ? (
        <section className="exam-screen equation-exam-screen">
          <div className="exam-heading"><span className="panel-label">考试设置</span><h1>方程式专项考试</h1><p>设置题量、时长与分值，准备好后开始作答。</p></div>
          <div className="exam-config-grid">
            <label className="exam-field"><span>限时（分钟）</span><input type="number" min="1" max="180" value={examConfig.durationMinutes} onChange={(event) => setExamConfig({ ...examConfig, durationMinutes: Math.max(1, Number(event.target.value) || 1) })} /></label>
            <label className="exam-field"><span>试卷总分</span><input type="number" min="10" max="1000" value={examConfig.totalPoints} onChange={(event) => setExamConfig({ ...examConfig, totalPoints: Math.max(10, Number(event.target.value) || 100) })} /></label>
          </div>
          <div className="exam-counts equation-exam-counts">
            <label className="exam-count-card"><span>反应物＋条件 → 产物</span><small>正向完成方程式</small><input type="number" min="0" max="100" value={examConfig.forward} onChange={(event) => setExamConfig({ ...examConfig, forward: Math.max(0, Number(event.target.value) || 0) })} /><em>题</em></label>
            <label className="exam-count-card"><span>产物＋条件 → 反应物</span><small>逆向倒推方程式</small><input type="number" min="0" max="100" value={examConfig.reverse} onChange={(event) => setExamConfig({ ...examConfig, reverse: Math.max(0, Number(event.target.value) || 0) })} /><em>题</em></label>
          </div>
          <div className="exam-option-summary"><span>{requireBalancing ? "要求配平" : "不检测系数"}</span><span>{fixedCount ? "固定物质数" : "可自由增删物质"}</span><button onClick={() => { setScopeDraft(new Set(scope)); setScopeOpen(true); }}>{scopeSummary}</button></div>
          <div className="exam-summary"><span>共 <b>{examTotal}</b> 题</span><span>限时 <b>{examConfig.durationMinutes}</b> 分钟</span><span>满分 <b>{examConfig.totalPoints}</b> 分</span></div>
          <div className="exam-screen-actions"><button className="primary-action" disabled={!examTotal} onClick={startExam}>开始考试</button></div>
        </section>
      ) : mode === "exam_result" ? (
        <section className="exam-screen result-screen equation-result">
          <div className="score-orb"><strong>{score}</strong><span>/ {examConfig.totalPoints} 分</span></div>
          <div className="exam-heading"><span className="panel-label">考试完成</span><h1>{score >= examConfig.totalPoints * .8 ? "方程式掌握得很扎实" : "继续巩固反应网络"}</h1><p>作答 {examAnswered} / {examTotal} 题，答对 {examCorrect} 题，用时 {Math.floor(usedSeconds / 60)} 分 {usedSeconds % 60} 秒。</p></div>
          <section className="exam-review-list">
            <div className="exam-review-heading"><span className="panel-label">整卷解析</span><h2>作答、标准方程式与教材依据</h2></div>
            {examResults.map((result, index) => <details className={result.correct ? "exam-review-card correct-review" : "exam-review-card wrong-review"} key={result.question.id}>
              <summary><span>第 {index + 1} 题</span><b>{result.question.direction === "forward" ? "正推产物" : "逆推反应物"}</b><em>{result.correct ? "正确" : result.response.formulas.some((answer) => answer.trim()) ? "错误" : "未作答"}</em></summary>
              <div className="exam-review-body equation-review-body">
                <p><b>你的答案：</b>{result.response.formulas.map((formula, answerIndex) =>
                  `${requireBalancing ? result.response.answerCoefficients[answerIndex] || "?" : ""}${formula}`
                ).filter(Boolean).join(" + ") || "未作答"}</p>
                <p><b>标准方程式：</b><Formula value={result.question.reaction.equationCanonical.replace("->", "->")} /></p>
                <p><b>条件：</b>{conditionLabel(result.question.reaction)}</p>
                <div className="equation-ocr-text"><MarkdownText>{result.question.reaction.source.evidenceText}</MarkdownText></div>
                <span className="page-reference"><b>{sourcePageLabel(result.question.reaction)}</b><small>PDF 第 {result.question.reaction.source.pdfPage} 页</small></span>
              </div>
            </details>)}
          </section>
          <div className="exam-screen-actions"><button className="primary-action" onClick={() => setMode("exam_setup")}>再考一次</button></div>
        </section>
      ) : (
        <section className="workspace equation-workspace">
          <aside className="control-panel">
            {mode === "exam_running" ? (
              <div className="exam-progress-panel">
                <div className="panel-label">考试进行中</div>
                <div className="exam-progress-number"><strong>{examIndex + 1}</strong><span>/ {examQuestions.length}</span></div>
                <div className="exam-progress-bar"><i style={{ width: `${(examIndex + 1) / examQuestions.length * 100}%` }} /></div>
                <div className="exam-question-map">{examQuestions.map((item, index) => <button className={`${index === examIndex ? "current" : ""} ${examResponses[index]?.formulas.some((answer) => answer.trim()) ? "answered" : ""}`} key={item.id} onClick={() => showExamQuestion(index)}>{index + 1}</button>)}</div>
                <button className="end-exam-button" onClick={() => { if (window.confirm("确定提前交卷吗？")) finishExam(); }}>提前交卷</button>
              </div>
            ) : (
              <>
                <div className="panel-label">题目格式</div>
                <button className={direction === "forward" ? "format-button active" : "format-button"} onClick={() => changeDirection("forward")}><span className="format-icon">物→产</span><span><b>根据反应物写产物</b><small>条件与反应箭头已给出</small></span></button>
                <button className={direction === "reverse" ? "format-button active" : "format-button"} onClick={() => changeDirection("reverse")}><span className="format-icon">产→物</span><span><b>根据产物倒推反应物</b><small>条件与反应箭头已给出</small></span></button>
                <div className="equation-options">
                  <label><input type="checkbox" checked={requireBalancing} onChange={(event) => setRequireBalancing(event.target.checked)} /><span><b>要求配平</b><small>检测所有物质的系数</small></span></label>
                  <label><input type="checkbox" checked={fixedCount} onChange={(event) => changeFixedCount(event.target.checked)} /><span><b>固定物质种类数</b><small>关闭后可自由增删空格</small></span></label>
                </div>
                <section className="element-scope-control"><div><span>考察元素</span><b>{scopeSummary}</b></div><div className="scope-control-actions"><button onClick={() => { setScopeDraft(new Set(scope)); setScopeOpen(true); }}>章节多选</button><button onClick={() => { setScopeDraft(new Set(scope)); setScopeOpen(true); }}>自定义</button><button onClick={() => { setScope(new Set(ELEMENTS)); setNewQuestion(direction, fixedCount, validReactions(data, new Set(ELEMENTS))); }}>全选</button></div></section>
                <div className="stats-grid"><div><span>{stats.answered}</span><small>已答</small></div><div><span>{accuracy}%</span><small>正确率</small></div><div><span>{stats.streak}</span><small>连续正确</small></div></div>
              </>
            )}
          </aside>

          <section className="quiz-card equation-card">
            <div className="quiz-meta"><span className="type-tag">填空题</span><span>{direction === "forward" ? "根据反应物和条件完成产物" : "根据产物和条件倒推反应物"} · {requireBalancing ? "需配平" : "忽略系数"}</span></div>
            <div className="equation-prompt"><span>{direction === "forward" ? "完成方程式的产物一侧" : "补全方程式的反应物一侧"}</span><h1>{fixedCount ? `已给出 ${hiddenParticipants(question).length} 个作答位置` : "可按需要增加或删除物质"}</h1></div>
            <EquationLine question={question} requireBalancing={requireBalancing} response={response} fixedCount={fixedCount} activeField={activeField} submitted={submitted} onField={updateField} onActivate={setActiveField} onAdd={addAnswer} onRemove={removeAnswer} />
            <div className="touch-keyboard">
              <div className="keyboard-heading"><span>元素键盘</span><small>元素种类由已知一侧确定</small></div>
              <div className="keyboard-layout">
                <div className="element-key-grid">{keypadElements.map((element) => <button key={element} onClick={() => appendToken(element)}>{element}</button>)}{includesElectron ? <button onClick={() => appendToken("e^-")}>e⁻</button> : null}{["(", ")", "[", "]", "+", "-", "^"].map((token) => <button className="symbol-key" key={token} onClick={() => appendToken(token)}>{token}</button>)}</div>
                <div className="number-keypad">{["7", "8", "9", "4", "5", "6", "1", "2", "3", "/", "0"].map((number) => <button key={number} onClick={() => appendToken(number)}>{number}</button>)}<button className="backspace-key" onClick={backspace}>⌫</button></div>
              </div>
            </div>
            <div className="quiz-actions">
              {mode === "exam_running" ? <><button className="navigation-action" disabled={!examIndex} onClick={() => showExamQuestion(examIndex - 1)}>上一题</button>{examIndex + 1 === examQuestions.length ? <button className="primary-action" onClick={() => { if (window.confirm("确定提交试卷吗？")) finishExam(); }}>提交试卷</button> : <button className="primary-action" onClick={() => showExamQuestion(examIndex + 1)}>下一题</button>}</> : <>
                <button className="navigation-action" disabled={!history.length || historyIndex === 0} onClick={() => showHistory(Math.max(0, historyIndex - 1))}>上一题</button>
                {!submitted ? <button className="primary-action" disabled={!responseComplete} onClick={submitPractice}>确认答案</button> : null}
                <button className={submitted ? "primary-action" : "navigation-action"} onClick={nextPractice}>{submitted ? "下一题" : "跳过并下一题"}</button>
              </>}
            </div>
          </section>

          <aside className={submitted ? "source-panel revealed" : "source-panel"}>
            {!submitted ? <div className="source-placeholder"><div className="source-symbol">式</div><h2>作答后查看答案</h2><p>标准方程式、反应条件、教材原文和页码会显示在这里。</p><ul><li>物质顺序可互换</li><li>系数 1 可以省略</li><li>相态与箭头不参与检测</li></ul></div> : <div className="source-content">
              <span className={isCorrect ? "result-badge good" : "result-badge bad"}>{isCorrect ? "回答正确" : "答案尚不完整"}</span>
              <h2>标准方程式</h2>
              <div className="equation-reference"><Formula value={question.reaction.equationCanonical} /></div>
              <article className="evidence-card correct-evidence"><div className="evidence-heading"><b>{conditionLabel(question.reaction)}</b><span>{sourcePageLabel(question.reaction)}</span></div><MarkdownText>{question.reaction.source.evidenceText}</MarkdownText><span className="page-reference"><b>{sourcePageLabel(question.reaction)}</b><small>PDF 第 {question.reaction.source.pdfPage} 页</small></span></article>
              <details className="page-preview"><summary><span><b>教材原页</b><small>PDF 第 {question.reaction.source.pdfPage} 页</small></span><em>点击展开原页</em></summary><a href={publicPath(`/page-images/pdf_${String(question.reaction.source.pdfPage).padStart(4, "0")}.jpeg`)} target="_blank" rel="noreferrer"><img src={publicPath(`/page-images/pdf_${String(question.reaction.source.pdfPage).padStart(4, "0")}.jpeg`)} alt={`${sourcePageLabel(question.reaction)}原图`} width="1317" height="1871" loading="lazy" /></a></details>
            </div>}
          </aside>
        </section>
      )}
    </main>
  );
}
