"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import { formulaElements } from "./equation-policy";
import { ALL_ELEMENTS, elementScopeTitle, ElementScopePicker } from "./element-scope-picker";
import { publicPath } from "./public-path";
import { loadSessionResource, peekSessionResource } from "./session-cache";
import { stateContextText, structuredStateKey, type StateCategory } from "./material-state";
import { forbiddenColorPair, takeWithFinalConflictCheck } from "./question-policy";
import {
  acceptedColorIds as acceptedIdsFor,
  colorAcceptanceIndex,
  colorNames,
  colorTermsHaveAcceptanceRelation,
  groupByAcceptedColor,
  observationAcceptsColor,
  type ColorTerm,
} from "./color-semantics";

type Observation = {
  id: string;
  substanceId: string;
  colorId: string;
  formula: string | null;
  formulaMhchem: string | null;
  name: string | null;
  displayLabel: string;
  displayMode: "mhchem" | "text";
  color: string;
  acceptedColorIds: string[];
  physicalState: string | null;
  stateCategory: StateCategory;
  stateForm: string | null;
  stateVariantType: string | null;
  stateVariantLabelRaw: string | null;
  stateBasis: "explicit" | "contextual" | "reference_inferred" | "unresolved";
  stateInferenceRule: string;
  medium: string | null;
  conditions: string | null;
  focusElement: string | null;
  colorQuestionEligible: boolean;
  selectionQuestionEligible: boolean;
};

type Materials = { colors: ColorTerm[]; observations: Observation[] };

type Participant = {
  side: "reactant" | "product";
  position: number;
  formulaCanonical: string;
  coefficientNum: number;
  coefficientDen: number;
  phase: string | null;
  formationMarker: string | null;
  parseStatus: string;
};

type ReactionCondition = {
  valueText: string;
  rawText: string;
  relatedFormula: string | null;
};

type Reaction = {
  id: string;
  parseStatus: string;
  eligibleForQuiz: boolean;
  isExercise: boolean;
  participants: Participant[];
  conditions: ReactionCondition[];
};

type ReactionDataset = { reactions: Reaction[] };
type ColorQuestion = { target: Observation; targetColorId: string; targetColor: string; choices: Observation[]; colorChoices?: string[] };
type PaperData = {
  colorOf: ColorQuestion[];
  whichOne: ColorQuestion[];
  whichAre: ColorQuestion[];
  forward: Reaction[];
  balanced: Reaction[];
};
type PaperConfig = { colorOf: number; whichOne: number; whichAre: number; forward: number; balanced: number };
type PaperBlock =
  | { kind: "title"; units: number }
  | { kind: "heading"; title: string; units: number }
  | { kind: "colorOf"; item: ColorQuestion; number: number; units: number }
  | { kind: "whichOne"; item: ColorQuestion; number: number; units: number }
  | { kind: "whichAre"; item: ColorQuestion; number: number; units: number }
  | { kind: "forward"; reaction: Reaction; number: number; units: number }
  | { kind: "balanced"; reaction: Reaction; number: number; units: number };
type ChoiceAnswer = { number: number; answer: string };
type AnswerBlock =
  | { kind: "answerTitle" }
  | { kind: "answerTable"; answers: ChoiceAnswer[]; index: number }
  | { kind: "answerHeading"; title: string }
  | { kind: "answerEquation"; reaction: Reaction; number: number };

const DEFAULT_CONFIG: PaperConfig = { colorOf: 10, whichOne: 10, whichAre: 10, forward: 10, balanced: 10 };
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const SECTION_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const ALL_ELEMENT_SET = new Set(ALL_ELEMENTS);
const S_BLOCK_STUDY_ELEMENTS = new Set(["Li", "Na", "K", "Rb", "Cs", "Fr", "Be", "Mg", "Ca", "Sr", "Ba", "Ra"]);

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
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

function Formula({ observation }: { observation: Observation }) {
  if (observation.displayMode !== "mhchem" || !observation.formulaMhchem) {
    return <span>{observation.displayLabel}</span>;
  }
  const html = katex.renderToString(`\\ce{${observation.formulaMhchem}}`, {
    throwOnError: false,
    strict: "ignore",
    output: "html",
  });
  return <span aria-label={observation.displayLabel} dangerouslySetInnerHTML={{ __html: html }} />;
}

function FormulaText({ value }: { value: string }) {
  const html = katex.renderToString(`\\ce{${value}}`, {
    throwOnError: false,
    strict: "ignore",
    output: "html",
  });
  return <span aria-label={value} dangerouslySetInnerHTML={{ __html: html }} />;
}

function hasPrintableColor(item: Observation): boolean {
  return item.color.length <= 6 && !/[A-Za-z0-9*()（）]/.test(item.color);
}

function paperColorConflict(data: Materials) {
  const acceptance = colorAcceptanceIndex(data.colors);
  const names = colorNames(data.colors);
  return (leftColorId: string, rightColorId: string): boolean =>
    colorTermsHaveAcceptanceRelation(acceptance, leftColorId, rightColorId)
    || forbiddenColorPair(names.get(leftColorId) || "", names.get(rightColorId) || "");
}

function makeColorOf(data: Materials, count: number): ColorQuestion[] {
  const observations = data.observations;
  const names = colorNames(data.colors);
  const conflicts = paperColorConflict(data);
  const eligible = shuffled(uniqueBy(
    observations.filter((item) => item.colorQuestionEligible && hasPrintableColor(item)),
    (item) => `${item.substanceId}|${item.color}|${structuredStateKey(item)}`,
  ));
  return eligible.slice(0, count).map((target) => {
    const accepted = new Set(acceptedIdsFor(target));
    const targetColorId = shuffled([...accepted])[0];
    const targetColor = names.get(targetColorId) || target.color;
    const distractors = takeWithFinalConflictCheck(
      [targetColorId],
      shuffled(data.colors.filter((color) => !accepted.has(color.id) && color.name.length <= 6)),
      3,
      (color) => color.id,
      conflicts,
    )
      .map((color) => color.name);
    return { target, targetColorId, targetColor, choices: [], colorChoices: shuffled([targetColor, ...distractors]) };
  });
}

function makeWhichOne(data: Materials, count: number): ColorQuestion[] {
  const observations = data.observations;
  const names = colorNames(data.colors);
  const eligible = uniqueBy(
    observations.filter((item) => item.selectionQuestionEligible && hasPrintableColor(item)),
    (item) => `${item.substanceId}|${item.color}`,
  );
  const groups = groupByAcceptedColor(eligible);
  const colors = shuffled([...groups.keys()]);
  return colors.slice(0, count).map((targetColorId) => {
    const group = groups.get(targetColorId) || [];
    const target = shuffled(group)[0];
    const correctSubstances = new Set(group.map((item) => item.substanceId));
    const wrong = uniqueBy(
      shuffled(eligible.filter((item) => !correctSubstances.has(item.substanceId))),
      (item) => item.substanceId,
    ).slice(0, 3);
    return {
      target,
      targetColorId,
      targetColor: names.get(targetColorId) || target.color,
      choices: shuffled([target, ...wrong]),
    };
  });
}

function makeWhichAre(data: Materials, count: number): ColorQuestion[] {
  const observations = data.observations;
  const names = colorNames(data.colors);
  const eligible = uniqueBy(
    observations.filter((item) => item.selectionQuestionEligible && hasPrintableColor(item)),
    (item) => `${item.substanceId}|${item.color}`,
  );
  const groups = groupByAcceptedColor(eligible);
  const colors = shuffled([...groups.entries()]
    .filter(([, items]) => new Set(items.map((item) => item.substanceId)).size >= 3)
    .map(([colorId]) => colorId));
  return colors.slice(0, count).map((targetColorId) => {
    const group = uniqueBy(shuffled(groups.get(targetColorId) || []), (item) => item.substanceId);
    const correct = group.slice(0, 3);
    const allCorrectIds = new Set(group.map((item) => item.substanceId));
    const wrong = uniqueBy(
      shuffled(eligible.filter((item) => !allCorrectIds.has(item.substanceId))),
      (item) => item.substanceId,
    ).slice(0, 3);
    return {
      target: correct[0],
      targetColorId,
      targetColor: names.get(targetColorId) || correct[0].color,
      choices: shuffled([...correct, ...wrong]),
    };
  });
}

function observationStudyElements(observation: Observation): Set<string> {
  const elements = new Set<string>();
  if (observation.focusElement && ALL_ELEMENT_SET.has(observation.focusElement)) elements.add(observation.focusElement);
  const formulaSymbols = observation.formula?.match(/[A-Z][a-z]?/g) || [];
  const firstAllowed = formulaSymbols.find((symbol) => ALL_ELEMENT_SET.has(symbol));
  if (firstAllowed && (S_BLOCK_STUDY_ELEMENTS.has(firstAllowed) || !elements.size)) elements.add(firstAllowed);
  return elements;
}

function materialsForElementScope(data: Materials, scope: Set<string>): Materials {
  return {
    ...data,
    observations: data.observations.filter((observation) =>
      [...observationStudyElements(observation)].some((symbol) => scope.has(symbol))),
  };
}

function usableReactions(data: ReactionDataset, scope: Set<string>): Reaction[] {
  return data.reactions.filter((reaction) => {
    const reactants = reaction.participants.filter((part) => part.side === "reactant");
    const products = reaction.participants.filter((part) => part.side === "product");
    return reaction.eligibleForQuiz
      && reaction.parseStatus === "parsed"
      && !reaction.isExercise
      && reactants.length > 0
      && products.length > 0
      && reaction.participants.length <= 5
      && reaction.participants.reduce((length, part) => length + part.formulaCanonical.length, 0) <= 45
      && reaction.participants.every((part) => part.parseStatus === "parsed")
      && formulaElements(reaction.participants.map((part) => part.formulaCanonical)).some((element) => scope.has(element));
  });
}

function reactionSignature(reaction: Reaction): string {
  const participants = [...reaction.participants]
    .sort((left, right) => left.side.localeCompare(right.side) || left.position - right.position)
    .map((part) => `${part.side}:${part.formulaCanonical}`)
    .join("|");
  return `${participants}|${reactionConditionLabel(reaction)}`;
}

function createPaper(materials: Materials, reactions: ReactionDataset, config: PaperConfig, scope: Set<string>): PaperData {
  const scopedMaterials = materialsForElementScope(materials, scope);
  const reactionPool = uniqueBy(shuffled(usableReactions(reactions, scope)), reactionSignature);
  const forward = reactionPool.slice(0, config.forward);
  const balanced = reactionPool.slice(forward.length, forward.length + config.balanced);
  return {
    colorOf: makeColorOf(scopedMaterials, config.colorOf),
    whichOne: makeWhichOne(scopedMaterials, config.whichOne),
    whichAre: makeWhichAre(scopedMaterials, config.whichAre),
    forward,
    balanced,
  };
}

function paperQuestionCount(paper: PaperData): number {
  return paper.colorOf.length + paper.whichOne.length + paper.whichAre.length + paper.forward.length + paper.balanced.length;
}

function requestedQuestionCount(config: PaperConfig): number {
  return Object.values(config).reduce((total, count) => total + count, 0);
}

function shortageMessage(paper: PaperData, config: PaperConfig): string | null {
  const actual = paperQuestionCount(paper);
  const requested = requestedQuestionCount(config);
  return actual < requested ? `所选元素范围只能生成 ${actual}/${requested} 道不重复题目，请重新选择考察元素` : null;
}

function buildPaperBlocks(paper: PaperData): PaperBlock[] {
  let number = 1;
  let sectionIndex = 0;
  const blocks: PaperBlock[] = [{ kind: "title", units: 3 }];
  const addGroup = (title: string, groups: Array<{ kind: "colorOf" | "whichOne" | "whichAre"; items: ColorQuestion[]; units: number } | { kind: "forward" | "balanced"; items: Reaction[]; units: number }>) => {
    if (!groups.some((group) => group.items.length)) return;
    blocks.push({ kind: "heading", title: `${SECTION_NUMERALS[sectionIndex++] || sectionIndex}、${title}`, units: 2 });
    groups.forEach((group) => group.items.forEach((item) => {
      if (group.kind === "forward" || group.kind === "balanced") {
        blocks.push({ kind: group.kind, reaction: item as Reaction, number: number++, units: group.units });
      } else {
        blocks.push({ kind: group.kind, item: item as ColorQuestion, number: number++, units: group.units });
      }
    }));
  };
  addGroup("判断物质的颜色", [{ kind: "colorOf", items: paper.colorOf, units: 3 }]);
  addGroup("根据颜色选择物质", [
    { kind: "whichOne", items: paper.whichOne, units: 3 },
    { kind: "whichAre", items: paper.whichAre, units: 4 },
  ]);
  addGroup("完善化学方程式", [
    { kind: "forward", items: paper.forward, units: 2 },
    { kind: "balanced", items: paper.balanced, units: 3 },
  ]);

  return blocks;
}

function answerLetter(index: number): string {
  return index >= 0 ? LETTERS[index] : "—";
}

function buildAnswerBlocks(paper: PaperData): AnswerBlock[] {
  let number = 1;
  const choices: ChoiceAnswer[] = [];
  paper.colorOf.forEach((item) => choices.push({
    number: number++,
    answer: answerLetter((item.colorChoices || []).findIndex((color) => color === item.targetColor)),
  }));
  paper.whichOne.forEach((item) => choices.push({
    number: number++,
    answer: answerLetter(item.choices.findIndex((choice) => choice.substanceId === item.target.substanceId)),
  }));
  paper.whichAre.forEach((item) => choices.push({
    number: number++,
    answer: item.choices
      .map((choice, index) => observationAcceptsColor(choice, item.targetColorId) ? LETTERS[index] : "")
      .filter(Boolean)
      .join(""),
  }));

  const blocks: AnswerBlock[] = [{ kind: "answerTitle" }];
  for (let index = 0; index < choices.length; index += 10) {
    blocks.push({ kind: "answerTable", answers: choices.slice(index, index + 10), index });
  }
  if (paper.forward.length || paper.balanced.length) blocks.push({ kind: "answerHeading", title: "化学方程式" });
  [...paper.forward, ...paper.balanced].forEach((reaction) => {
    blocks.push({ kind: "answerEquation", reaction, number: number++ });
  });
  return blocks;
}

function paginateMeasured(blocks: PaperBlock[], heights: number[], pageHeight: number): PaperBlock[][] {
  const pages: PaperBlock[][] = [[]];
  let usedHeight = 0;
  blocks.forEach((block, index) => {
    const blockHeight = heights[index] || 0;
    const nextHeight = heights[index + 1] || 0;
    const requiredHeight = block.kind === "heading" ? blockHeight + nextHeight : blockHeight;
    if (pages.at(-1)?.length && usedHeight + requiredHeight > pageHeight) {
      pages.push([]);
      usedHeight = 0;
    }
    pages.at(-1)?.push(block);
    usedHeight += blockHeight;
  });
  return pages.filter((page) => page.length);
}

function pageSignature(pages: PaperBlock[][]): string {
  return pages.map((page) => page.map((block) => {
    if (block.kind === "title") return "title";
    if (block.kind === "heading") return block.title;
    return `${block.kind}-${block.number}`;
  }).join("|")).join("/");
}

function paginateAnswerMeasured(blocks: AnswerBlock[], heights: number[], pageHeight: number): AnswerBlock[][] {
  const pages: AnswerBlock[][] = [[]];
  let usedHeight = 0;
  blocks.forEach((block, index) => {
    const blockHeight = heights[index] || 0;
    const nextHeight = heights[index + 1] || 0;
    const requiredHeight = block.kind === "answerHeading" ? blockHeight + nextHeight : blockHeight;
    if (pages.at(-1)?.length && usedHeight + requiredHeight > pageHeight) {
      pages.push([]);
      usedHeight = 0;
    }
    pages.at(-1)?.push(block);
    usedHeight += blockHeight;
  });
  return pages.filter((page) => page.length);
}

function answerPageSignature(pages: AnswerBlock[][]): string {
  return pages.map((page) => page.map((block) => {
    if (block.kind === "answerTitle") return "title";
    if (block.kind === "answerHeading") return block.title;
    if (block.kind === "answerTable") return `table-${block.index}`;
    return `equation-${block.number}`;
  }).join("|")).join("/");
}

function PaperPage({ page, totalPages, title, children }: { page: number; totalPages: number; title: string; children: React.ReactNode }) {
  return (
    <section className="paper-page" aria-label={`试卷第 ${page} 页`}>
      <header className="paper-header">{title}</header>
      <div className="paper-body">{children}</div>
      <footer className="paper-footer">{page}/{totalPages}</footer>
    </section>
  );
}

function AnswerPage({ children, page, title }: { children: React.ReactNode; page: number; title: string }) {
  return (
    <section className="paper-page paper-answer-page" aria-label={`参考答案第 ${page} 页`}>
      <header className="paper-header">{title}</header>
      <div className="paper-body">{children}</div>
    </section>
  );
}

function BigTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="paper-section-title">{children}</h2>;
}

function estimatedChoiceWidth(value: string): number {
  return [...value].reduce((width, character) => width + (/[⺀-鿿豈-﫿]/.test(character) ? 1 : .7), 2.4);
}

function choiceColumns(widthHints: string[]): number {
  const widths = widthHints.map(estimatedChoiceWidth);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const widest = Math.max(...widths);
  if (widthHints.length === 4 && total <= 35 && widest <= 8.8) return 4;
  if (widthHints.length === 6 && total <= 34 && widest <= 5.6) return 6;
  if (widthHints.length === 6 && widest <= 11.4) return 3;
  return 2;
}

function ChoiceLine({ choices, widthHints }: { choices: React.ReactNode[]; widthHints: string[] }) {
  const columns = choiceColumns(widthHints);
  return <div className={`paper-choices choices-${columns}`}>{choices.map((choice, index) => <span key={index}><b>{LETTERS[index]}.</b> {choice}</span>)}</div>;
}

function ColorOfQuestion({ item, number }: { item: ColorQuestion; number: number }) {
  const state = stateContextText(item.target);
  return (
    <div className="paper-question">
      <div className="paper-stem"><span className="paper-question-number">{number}.{"\t"}</span><span className="paper-stem-content">{state ? `（${state}）` : ""}<Formula observation={item.target} /> 的颜色为</span></div>
      <ChoiceLine choices={(item.colorChoices || []).map((color) => `${color}`)} widthHints={item.colorChoices || []} />
    </div>
  );
}

function SubstanceQuestion({ item, number, multiple = false }: { item: ColorQuestion; number: number; multiple?: boolean }) {
  return (
    <div className="paper-question">
      <div className="paper-stem"><span className="paper-question-number">{number}.{"\t"}</span><span className="paper-stem-content">下列物质中，{multiple ? `颜色为${item.targetColor}的有` : `何种物质颜色为${item.targetColor}？`}</span></div>
      <ChoiceLine choices={item.choices.map((choice) => <span key={choice.id}><Formula observation={choice} /><small className="paper-state">（{stateContextText(choice)}）</small></span>)} widthHints={item.choices.map((choice) => `${choice.displayLabel}${stateContextText(choice)}`)} />
    </div>
  );
}

function coefficientBlank() {
  return <span className="coefficient-blank">({"  "})</span>;
}

function participantMarker(participant: Participant): string {
  const phase = participant.phase ? `(${participant.phase})` : "";
  const marker = participant.formationMarker === "gas_release" ? "↑" : participant.formationMarker === "precipitate" ? "↓" : "";
  return `${phase}${marker}`;
}

function ParticipantMarker({ participant }: { participant: Participant }) {
  const marker = participantMarker(participant);
  return marker ? <span className="paper-participant-marker">{marker}</span> : null;
}

function reactionConditionLabel(reaction: Reaction): string {
  return [...new Set((reaction.conditions || [])
    .map((condition) => condition.valueText || condition.rawText)
    .filter(Boolean))].join("、");
}

function EquationQuestion({ reaction, number, balancing }: { reaction: Reaction; number: number; balancing: boolean }) {
  const reactants = reaction.participants.filter((part) => part.side === "reactant").sort((a, b) => a.position - b.position);
  const products = reaction.participants.filter((part) => part.side === "product").sort((a, b) => a.position - b.position);
  const [stacked, setStacked] = useState(false);
  const lineRef = useRef<HTMLDivElement>(null);
  const condition = reactionConditionLabel(reaction);
  const reactionStudyElements = formulaElements(reaction.participants.map((part) => part.formulaCanonical)).join(" ");

  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const sideWidth = (selector: string) => {
      const side = line.querySelector<HTMLElement>(selector);
      if (!side) return 0;
      const participants = Array.from(side.children) as HTMLElement[];
      const gap = Number.parseFloat(window.getComputedStyle(side).columnGap || "0");
      return participants.reduce((width, participant) => width + participant.getBoundingClientRect().width, 0)
        + Math.max(0, participants.length - 1) * gap;
    };
    const numberWidth = line.querySelector<HTMLElement>(".paper-question-number")?.getBoundingClientRect().width || 0;
    const arrow = line.querySelector<HTMLElement>(".paper-transition");
    const arrowStyle = arrow ? window.getComputedStyle(arrow) : null;
    const arrowWidth = arrow
      ? arrow.getBoundingClientRect().width
        + Number.parseFloat(arrowStyle?.marginLeft || "0")
        + Number.parseFloat(arrowStyle?.marginRight || "0")
      : 0;
    setStacked(numberWidth + sideWidth(".paper-reactants") + arrowWidth + sideWidth(".paper-products") > line.clientWidth + .5);
  }, [balancing, reaction]);

  return (
    <div className="paper-question paper-fill-question">
      <div ref={lineRef} data-study-elements={reactionStudyElements} className={stacked ? "paper-stem paper-equation-line equation-stacked" : "paper-stem paper-equation-line"}><span className="paper-question-number">{number}.{"\t"}</span>
        <span className="paper-equation-side paper-reactants">
          {reactants.map((part, index) => <span className="paper-participant" key={`${part.formulaCanonical}-${index}`}>
            {index ? <span className="paper-plus">＋</span> : null}
            {balancing ? coefficientBlank() : null}<FormulaText value={part.formulaCanonical} /><ParticipantMarker participant={part} />
          </span>)}
        </span>
        <span className="paper-transition">
          {condition ? <span className="paper-condition">{condition}</span> : null}
          {balancing
            ? <span className="paper-arrow paper-long-equals" aria-label="长等号" />
            : <span className="paper-arrow">→</span>}
        </span>
        <span className="paper-equation-side paper-products">
          {products.map((part, index) => <span className="paper-participant" key={`${part.formulaCanonical}-${index}`}>
            {index ? <span className="paper-plus">＋</span> : null}
            {balancing ? coefficientBlank() : null}<span className="formula-blank" aria-label="化学式填空" /><ParticipantMarker participant={part} />
          </span>)}
        </span>
      </div>
    </div>
  );
}

function participantCoefficient(participant: Participant): string {
  if (participant.coefficientNum === participant.coefficientDen) return "";
  if (participant.coefficientDen === 1) return String(participant.coefficientNum);
  return `${participant.coefficientNum}/${participant.coefficientDen}`;
}

function AnswerEquation({ reaction, number }: { reaction: Reaction; number: number }) {
  const reactants = reaction.participants.filter((part) => part.side === "reactant").sort((a, b) => a.position - b.position);
  const products = reaction.participants.filter((part) => part.side === "product").sort((a, b) => a.position - b.position);
  const [stacked, setStacked] = useState(false);
  const lineRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const sideWidth = (selector: string) => {
      const side = line.querySelector<HTMLElement>(selector);
      if (!side) return 0;
      const participants = Array.from(side.children) as HTMLElement[];
      const gap = Number.parseFloat(window.getComputedStyle(side).columnGap || "0");
      return participants.reduce((width, participant) => width + participant.getBoundingClientRect().width, 0)
        + Math.max(0, participants.length - 1) * gap;
    };
    const numberWidth = line.querySelector<HTMLElement>(".paper-question-number")?.getBoundingClientRect().width || 0;
    const transition = line.querySelector<HTMLElement>(".paper-transition");
    const transitionStyle = transition ? window.getComputedStyle(transition) : null;
    const transitionWidth = transition
      ? transition.getBoundingClientRect().width
        + Number.parseFloat(transitionStyle?.marginLeft || "0")
        + Number.parseFloat(transitionStyle?.marginRight || "0")
      : 0;
    setStacked(numberWidth + sideWidth(".paper-reactants") + transitionWidth + sideWidth(".paper-products") > line.clientWidth + .5);
  }, [reaction]);

  const renderSide = (parts: Participant[], sideClass: string) => <span className={`paper-equation-side ${sideClass}`}>
    {parts.map((part, index) => <span className="paper-participant" key={`${part.formulaCanonical}-${index}`}>
      {index ? <span className="paper-plus">＋</span> : null}
      {participantCoefficient(part) ? <b className="paper-answer-coefficient">{participantCoefficient(part)}</b> : null}
      <FormulaText value={part.formulaCanonical} /><ParticipantMarker participant={part} />
    </span>)}
  </span>;

  return <div className="paper-question paper-answer-equation">
    <div ref={lineRef} className={stacked ? "paper-stem paper-equation-line equation-stacked" : "paper-stem paper-equation-line"}>
      <span className="paper-question-number">{number}.{"\t"}</span>
      {renderSide(reactants, "paper-reactants")}
      <span className="paper-transition paper-answer-transition"><span className="paper-arrow">→</span></span>
      {renderSide(products, "paper-products")}
    </div>
  </div>;
}

function AnswerBlockView({ block }: { block: AnswerBlock }) {
  if (block.kind === "answerTitle") return <h1 className="paper-title">参考答案</h1>;
  if (block.kind === "answerHeading") return <h2 className="paper-answer-heading">{block.title}</h2>;
  if (block.kind === "answerEquation") return <AnswerEquation reaction={block.reaction} number={block.number} />;
  return <table className="paper-answer-table"><tbody>
    <tr><th>编号</th>{block.answers.map((item) => <th key={item.number}>{item.number}</th>)}</tr>
    <tr><th>答案</th>{block.answers.map((item) => <td key={item.number}>{item.answer}</td>)}</tr>
  </tbody></table>;
}

function PaperBlockView({ block, title }: { block: PaperBlock; title: string }) {
  if (block.kind === "title") return <h1 className="paper-title">{title}</h1>;
  if (block.kind === "heading") return <BigTitle>{block.title}</BigTitle>;
  if (block.kind === "colorOf") return <ColorOfQuestion item={block.item} number={block.number} />;
  if (block.kind === "whichOne") return <SubstanceQuestion item={block.item} number={block.number} />;
  if (block.kind === "whichAre") return <SubstanceQuestion item={block.item} number={block.number} multiple />;
  return <EquationQuestion reaction={block.reaction} number={block.number} balancing={block.kind === "balanced"} />;
}

export default function PaperMode() {
  const cachedMaterials = peekSessionResource<Materials>(publicPath("/materials.v1.json"));
  const cachedReactions = peekSessionResource<ReactionDataset>(publicPath("/reactions.quiz.v1.json"));
  const [materials, setMaterials] = useState<Materials | null>(cachedMaterials);
  const [reactions, setReactions] = useState<ReactionDataset | null>(cachedReactions);
  const [paper, setPaper] = useState<PaperData | null>(() => cachedMaterials && cachedReactions ? createPaper(cachedMaterials, cachedReactions, DEFAULT_CONFIG, new Set(ALL_ELEMENTS)) : null);
  const [config, setConfig] = useState<PaperConfig>(DEFAULT_CONFIG);
  const [elementScope, setElementScope] = useState<Set<string>>(() => new Set(ALL_ELEMENTS));
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<PaperBlock[][]>([]);
  const [answerPages, setAnswerPages] = useState<AnswerBlock[][]>([]);
  const measureRef = useRef<HTMLDivElement>(null);
  const answerMeasureRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => paper ? buildPaperBlocks(paper) : [], [paper]);
  const answerBlocks = useMemo(() => paper ? buildAnswerBlocks(paper) : [], [paper]);
  const documentTitle = useMemo(() => elementScopeTitle(elementScope), [elementScope]);

  useEffect(() => {
    Promise.all([
      loadSessionResource<Materials>(publicPath("/materials.v1.json"), "物质库载入失败"),
      loadSessionResource<ReactionDataset>(publicPath("/reactions.quiz.v1.json"), "方程式题库载入失败"),
    ])
      .then(([nextMaterials, nextReactions]) => {
        setMaterials(nextMaterials);
        setReactions(nextReactions);
        const nextPaper = createPaper(nextMaterials, nextReactions, DEFAULT_CONFIG, new Set(ALL_ELEMENTS));
        const shortage = shortageMessage(nextPaper, DEFAULT_CONFIG);
        if (shortage) setError(shortage);
        else setPaper(nextPaper);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const regenerate = useCallback(() => {
    if (!materials || !reactions) return;
    const nextPaper = createPaper(materials, reactions, config, elementScope);
    const shortage = shortageMessage(nextPaper, config);
    if (shortage) {
      setGenerationNotice(shortage);
      return;
    }
    setPaper(nextPaper);
    setGenerationNotice(null);
    setScopeError(null);
  }, [materials, reactions, config, elementScope]);

  const applyElementScope = useCallback((nextScope: Set<string>): boolean => {
    if (!materials || !reactions || !nextScope.size) return false;
    const nextPaper = createPaper(materials, reactions, config, nextScope);
    const shortage = shortageMessage(nextPaper, config);
    if (shortage) {
      setScopeError(shortage);
      return false;
    }
    setElementScope(new Set(nextScope));
    setPaper(nextPaper);
    setGenerationNotice(null);
    setScopeError(null);
    return true;
  }, [materials, reactions, config]);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure || !blocks.length || measure.children.length !== blocks.length) {
      if (!blocks.length) setPages([]);
      return;
    }
    const updatePagination = () => {
      const measuredElements = Array.from(measure.children);
      const rects = measuredElements.map((element) => element.getBoundingClientRect());
      const heights = measuredElements.map((element, index) => {
        if (rects[index + 1]) return rects[index + 1].top - rects[index].top;
        const style = window.getComputedStyle(element);
        return rects[index].height + Number.parseFloat(style.marginBottom || "0");
      });
      const nextPages = paginateMeasured(blocks, heights, measure.clientHeight);
      setPages((current) => pageSignature(current) === pageSignature(nextPages) ? current : nextPages);
    };
    updatePagination();
    const observer = new ResizeObserver(updatePagination);
    Array.from(measure.children).forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [blocks]);

  useLayoutEffect(() => {
    const measure = answerMeasureRef.current;
    if (!showAnswers || !measure || !answerBlocks.length || measure.children.length !== answerBlocks.length) {
      if (!showAnswers) setAnswerPages([]);
      return;
    }
    const updatePagination = () => {
      const measuredElements = Array.from(measure.children);
      const rects = measuredElements.map((element) => element.getBoundingClientRect());
      const heights = measuredElements.map((element, index) => {
        if (rects[index + 1]) return rects[index + 1].top - rects[index].top;
        const style = window.getComputedStyle(element);
        return rects[index].height + Number.parseFloat(style.marginBottom || "0");
      });
      const nextPages = paginateAnswerMeasured(answerBlocks, heights, measure.clientHeight);
      setAnswerPages((current) => answerPageSignature(current) === answerPageSignature(nextPages) ? current : nextPages);
    };
    updatePagination();
    const observer = new ResizeObserver(updatePagination);
    Array.from(measure.children).forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [answerBlocks, showAnswers]);

  if (error) return <main className="loading"><h1>试卷无法生成</h1><p>{error}</p></main>;
  if (!paper) return <main className="loading"><div className="loader" /><p>正在生成 A4 试卷…</p></main>;

  const totalQuestions = paperQuestionCount(paper);
  const updateCount = (key: keyof PaperConfig, value: number) => setConfig((current) => ({
    ...current,
    [key]: Math.min(50, Math.max(0, value || 0)),
  }));
  return (
    <main className="paper-mode">
      <nav className="paper-toolbar" aria-label="试卷工具栏">
        <div className="paper-toolbar-controls">
          <div className="paper-counts" aria-label="各题型题数">
            {([
              ["colorOf", "颜色判断"], ["whichOne", "物质单选"], ["whichAre", "物质多选"],
              ["forward", "补全产物"], ["balanced", "补全配平"],
            ] as Array<[keyof PaperConfig, string]>).map(([key, label]) => (
              <label key={key}><span>{label}</span><input type="number" min="0" max="50" value={config[key]} onChange={(event) => updateCount(key, Number(event.target.value))} /></label>
            ))}
          </div>
          <ElementScopePicker scope={elementScope} onApply={applyElementScope} error={scopeError} />
          <span>共 {totalQuestions} 题 · {pages.length} 页 A4</span>
          {generationNotice ? <span className="paper-generation-note">{generationNotice}</span> : null}
          <button onClick={regenerate}>更新试卷</button>
          <button className={showAnswers ? "paper-answer-toggle active" : "paper-answer-toggle"} onClick={() => setShowAnswers((current) => !current)}>{showAnswers ? "隐藏参考答案" : "显示参考答案"}</button>
          <button className="paper-print-button" onClick={() => window.print()}>打印试卷</button>
        </div>
      </nav>
      <div className="paper-measure-body" ref={measureRef} aria-hidden="true">
        {blocks.map((block, blockIndex) => <PaperBlockView block={block} title={documentTitle} key={`measure-${blockIndex}`} />)}
      </div>
      {showAnswers ? <div className="paper-measure-body paper-answer-measure-body" ref={answerMeasureRef} aria-hidden="true">
        {answerBlocks.map((block, blockIndex) => <AnswerBlockView block={block} key={`answer-measure-${blockIndex}`} />)}
      </div> : null}
      <div className="paper-stack">
        {pages.map((blocks, pageIndex) => (
          <PaperPage page={pageIndex + 1} totalPages={pages.length} title={documentTitle} key={pageIndex}>
            {blocks.map((block, blockIndex) => <PaperBlockView block={block} title={documentTitle} key={`${pageIndex}-${blockIndex}`} />)}
          </PaperPage>
        ))}
        {showAnswers ? answerPages.map((answerPage, pageIndex) => (
          <AnswerPage page={pageIndex + 1} title={documentTitle} key={`answer-page-${pageIndex}`}>
            {answerPage.map((block, blockIndex) => <AnswerBlockView block={block} key={`answer-${pageIndex}-${blockIndex}`} />)}
          </AnswerPage>
        )) : null}
      </div>
    </main>
  );
}
