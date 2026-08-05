"use client";

import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { clearHistory, deleteHistoryRecord, loadHistory, type HistoryRecord } from "../history-storage";
import { publicPath } from "../public-path";
import "./history.css";

type Tab = "exams" | "practice" | "wrong";
type Source = { pdf_page: number; printed_page: number | null; evidence_text: string };
type Observation = { id: string; displayLabel: string; displayMode: "mhchem" | "text"; formulaMhchem: string | null; sources: Source[] };
type Materials = { observations: Observation[] };
type StoredColorQuestion = {
  id: string;
  format: "color_of" | "which_one_is_color" | "which_are_color";
  targetId: string;
  targetColor?: string;
  choices: Array<{ id: string; label: string; observationId?: string }>;
  correctIds: string[];
  evidenceIds: string[];
};
type ColorPracticePayload = { question: StoredColorQuestion; selected: string[] };
type ColorExamPayload = {
  config: { durationMinutes: number; totalPoints: number; counts: Record<string, number> };
  questions: StoredColorQuestion[];
  answers: string[][];
  startedAt: number;
  endedAt: number;
};
type EquationResponse = { formulas: string[]; knownCoefficients: string[]; answerCoefficients: string[] };
type EquationReaction = {
  id: string;
  equationCanonical: string;
  conditions: Array<{ valueText?: string; rawText?: string }>;
  source: { evidenceText: string; pdfPage: number; printedPage: number | null; heading: string | null };
};
type EquationQuestion = { id: string; direction: "forward" | "reverse"; reaction: EquationReaction };
type EquationPracticePayload = { question: EquationQuestion; response: EquationResponse; requireBalancing: boolean; fixedCount: boolean };
type EquationExamPayload = {
  config: { durationMinutes: number; totalPoints: number; forward: number; reverse: number };
  results: Array<{ question: EquationQuestion; response: EquationResponse; correct: boolean }>;
  requireBalancing: boolean;
  startedAt: number;
  endedAt: number;
};

function Formula({ value, display = false }: { value: string; display?: boolean }) {
  const html = katex.renderToString(`\\ce{${value}}`, { throwOnError: false, strict: "ignore", output: "html", displayMode: display });
  return display
    ? <div className="history-formula history-formula-display" aria-label={value} dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="history-formula" aria-label={value} dangerouslySetInnerHTML={{ __html: html }} />;
}

function normalizeMarkdownMath(value: string) {
  return value
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression: string) => `$${expression.trim()}$`);
}

function MarkdownText({ children }: { children: string }) {
  return <div className="history-markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml>{normalizeMarkdownMath(children)}</ReactMarkdown></div>;
}

function StandardEquation({ reaction }: { reaction: EquationReaction }) {
  const conditions = reaction.conditions.map((item) => item.valueText || item.rawText).filter(Boolean).join("；");
  return <div className="history-standard-equation">{conditions ? <span>{conditions}</span> : null}<Formula value={reaction.equationCanonical} display /></div>;
}

function dateLabel(seconds: number) {
  return new Date(seconds * 1000).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function duration(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)} 分 ${safe % 60} 秒`;
}

function colorPrompt(question: StoredColorQuestion, observations: Map<string, Observation>) {
  if (question.format !== "color_of") return <span>{question.targetColor || "颜色题"}</span>;
  const target = observations.get(question.targetId);
  return target?.displayMode === "mhchem" && target.formulaMhchem
    ? <Formula value={target.formulaMhchem} />
    : <span>{target?.displayLabel || "物质"}</span>;
}

function ColorQuestionDetails({ payload, observations, index }: { payload: ColorPracticePayload; observations: Map<string, Observation>; index?: number }) {
  const { question, selected } = payload;
  const exact = selected.length === question.correctIds.length && selected.every((id) => question.correctIds.includes(id));
  const choiceLabel = (id: string) => question.choices.find((choice) => choice.id === id)?.label || id;
  const evidence = question.evidenceIds.map((id) => observations.get(id)).filter((item): item is Observation => Boolean(item));
  return (
    <details className={`history-question ${exact ? "is-correct" : "is-wrong"}`}>
      <summary>
        {index !== undefined ? <span className="history-index">第 {index + 1} 题</span> : null}
        <span className="history-prompt-box">{colorPrompt(question, observations)}</span>
      </summary>
      <div className="history-analysis">
        <div className="history-answer-grid">
          <p><span>你的答案</span><b>{selected.length ? selected.map(choiceLabel).join("、") : "未作答"}</b></p>
          <p><span>正确答案</span><b>{question.correctIds.map(choiceLabel).join("、")}</b></p>
        </div>
        {evidence.length ? <div className="history-evidence-list">{evidence.map((item) => (
          <article key={item.id}><b>{item.displayLabel}</b><p>{item.sources[0]?.evidence_text || "教材记录"}</p><small>{item.sources[0]?.printed_page ? `教材第 ${item.sources[0].printed_page} 页` : `PDF 第 ${item.sources[0]?.pdf_page || "—"} 页`}</small></article>
        ))}</div> : null}
      </div>
    </details>
  );
}

function equationReactants(equation: string) {
  return equation.split(/\s*(?:<=>|->|<-|=)\s*/)[0] || equation;
}

function equationAnswer(payload: EquationPracticePayload) {
  return payload.response.formulas.map((formula, index) => `${payload.requireBalancing ? payload.response.answerCoefficients[index] || "" : ""}${formula}`).filter(Boolean).join(" + ") || "未作答";
}

function EquationQuestionDetails({ payload, correct, index }: { payload: EquationPracticePayload; correct: boolean; index?: number }) {
  const reaction = payload.question.reaction;
  return (
    <details className={`history-question ${correct ? "is-correct" : "is-wrong"}`}>
      <summary>
        {index !== undefined ? <span className="history-index">第 {index + 1} 题</span> : null}
        <span className="history-prompt-box"><Formula value={equationReactants(reaction.equationCanonical)} /></span>
      </summary>
      <div className="history-analysis">
        <div className="history-answer-grid">
          <p><span>你的答案</span><b>{equationAnswer(payload)}</b></p>
          <p className="history-standard-answer"><span>标准方程式</span><StandardEquation reaction={reaction} /></p>
        </div>
        <article className="history-equation-evidence"><b>教材原文</b><MarkdownText>{reaction.source.evidenceText}</MarkdownText><small>{reaction.source.printedPage ? `教材第 ${reaction.source.printedPage} 页` : `PDF 第 ${reaction.source.pdfPage} 页`}</small></article>
      </div>
    </details>
  );
}

function ExamResult({ record, observations }: { record: HistoryRecord; observations: Map<string, Observation> }) {
  if (record.quizKind === "color") {
    const payload = record.payload as ColorExamPayload;
    const results = payload.questions.map((question, index) => ({ question, selected: payload.answers[index] || [] }));
    const correct = results.filter(({ question, selected }) => selected.length === question.correctIds.length && selected.every((id) => question.correctIds.includes(id))).length;
    const answered = results.filter((item) => item.selected.length).length;
    const score = results.length ? Math.round(correct / results.length * payload.config.totalPoints) : 0;
    const formatLabels: Record<string, string> = { color_of: "物质 → 颜色", which_one_is_color: "颜色 → 单一物质", which_are_color: "颜色 → 多种物质" };
    const breakdown = Object.keys(payload.config.counts).map((format) => {
      const matching = results.filter((item) => item.question.format === format);
      return { format, answered: matching.filter((item) => item.selected.length).length, correct: matching.filter(({ question, selected }) => selected.length === question.correctIds.length && selected.every((id) => question.correctIds.includes(id))).length };
    });
    return <div className="history-exam-result"><div className="history-score"><strong>{score}</strong><span>/ {payload.config.totalPoints} 分</span></div><div><h3>{score >= payload.config.totalPoints * .8 ? "掌握得很扎实" : score >= payload.config.totalPoints * .6 ? "基础已经建立" : "建议继续练习"}</h3><p>共作答 {answered} / {results.length} 题，答对 {correct} 题，用时 {duration(Math.floor((payload.endedAt - payload.startedAt) / 1000))}。</p></div><div className="history-result-breakdown">{breakdown.map((item) => <div key={item.format}><span>{formatLabels[item.format] || item.format}</span><b>{item.correct} / {payload.config.counts[item.format]}</b><small>作答 {item.answered} 题</small></div>)}</div><section className="history-exam-review"><h4>整卷解析</h4>{results.map((result, index) => <ColorQuestionDetails key={`${result.question.id}-${index}`} payload={result} observations={observations} index={index} />)}</section></div>;
  }
  const payload = record.payload as EquationExamPayload;
  const correct = payload.results.filter((item) => item.correct).length;
  const answered = payload.results.filter((item) => item.response.formulas.some((value) => value.trim())).length;
  const score = payload.results.length ? Math.round(correct / payload.results.length * payload.config.totalPoints) : 0;
  return <div className="history-exam-result"><div className="history-score"><strong>{score}</strong><span>/ {payload.config.totalPoints} 分</span></div><div><h3>{score >= payload.config.totalPoints * .8 ? "方程式掌握得很扎实" : "继续巩固反应网络"}</h3><p>共作答 {answered} / {payload.results.length} 题，答对 {correct} 题，用时 {duration(Math.floor((payload.endedAt - payload.startedAt) / 1000))}。</p></div><section className="history-exam-review"><h4>整卷解析</h4>{payload.results.map((result, index) => <EquationQuestionDetails key={`${result.question.id}-${index}`} payload={{ question: result.question, response: result.response, requireBalancing: payload.requireBalancing, fixedCount: true }} correct={result.correct} index={index} />)}</section></div>;
}

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>("exams");
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      loadHistory(),
      fetch(publicPath("/materials.v1.json")).then((response) => response.ok ? response.json() as Promise<Materials> : Promise.reject(new Error("题库加载失败"))),
    ]).then(([history, data]) => { setRecords(history); setMaterials(data); }).catch((reason) => setError(reason instanceof Error ? reason.message : "历史记录加载失败")).finally(() => setLoading(false));
  }, []);

  const observations = useMemo(() => new Map((materials?.observations || []).map((item) => [item.id, item])), [materials]);
  const exams = records.filter((item) => item.recordType === "exam");
  const practice = records.filter((item) => item.recordType === "practice" && item.source === "practice");
  const wrong = records.filter((item) => item.recordType === "practice" && item.correct === false);
  const visible = tab === "exams" ? exams : tab === "practice" ? practice : wrong;

  async function remove(id: string) {
    setRecords((current) => current.filter((item) => item.id !== id));
    try { await deleteHistoryRecord(id); } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); void loadHistory().then(setRecords); }
  }

  async function clearAll() {
    if (!records.length || !window.confirm("确定清空当前账户的全部历史记录吗？此操作无法撤销。")) return;
    const previous = records;
    setRecords([]);
    setError("");
    try { await clearHistory(); } catch (reason) { setRecords(previous); setError(reason instanceof Error ? reason.message : "清空失败"); }
  }

  return (
    <main className="history-page">
      <header className="history-topbar"><a href={publicPath("/")} className="history-back">← 返回题库</a><div><span>PERSONAL ARCHIVE</span><h1>历史记录</h1><p>考试、练习和需要再次巩固的题目都在这里。</p></div></header>
      <div className="history-tab-row"><nav className="history-tabs" aria-label="历史记录分类">{([
        ["exams", "考试记录", exams.length], ["practice", "做题记录", practice.length], ["wrong", "错题整理", wrong.length],
      ] as Array<[Tab, string, number]>).map(([value, label, count]) => <button className={tab === value ? "active" : ""} onClick={() => setTab(value)} key={value}><span>{label}</span><b>{count}</b></button>)}</nav><button className="history-clear" type="button" onClick={clearAll} disabled={!records.length}>清空</button></div>
      {error ? <p className="history-error">{error}</p> : null}
      {loading ? <section className="history-empty"><span className="auth-loader" /><p>正在整理账户记录…</p></section> : !visible.length ? <section className="history-empty"><b>{tab === "wrong" ? "暂时没有错题" : "还没有记录"}</b><p>{tab === "exams" ? "完成一场考试后，结果会自动保存在这里。" : "确认答案后，题目会立即写入你的账户。"}</p><a href={publicPath("/")}>开始做题</a></section> : <section className={`history-list ${tab === "exams" ? "history-exam-list" : "history-question-grid"}`}>{visible.map((record) => (
        <article className="history-record" key={record.id}>
          <div className="history-record-meta"><span>{record.quizKind === "color" ? "颜色" : "方程式"}{record.recordType === "exam" ? "考试" : record.source === "exam" ? "考试错题" : "练习"}</span><time>{dateLabel(record.createdAt)}</time><button onClick={() => remove(record.id)} aria-label="删除这条记录">删除</button></div>
          {record.recordType === "exam" ? <details className="history-exam"><summary><span>{record.quizKind === "color" ? "颜色知识考试" : "化学方程式考试"}</span><b>查看考试结果</b></summary><ExamResult record={record} observations={observations} /></details> : record.quizKind === "color" ? <ColorQuestionDetails payload={record.payload as ColorPracticePayload} observations={observations} /> : <EquationQuestionDetails payload={record.payload as EquationPracticePayload} correct={record.correct === true} />}
        </article>
      ))}</section>}
    </main>
  );
}
