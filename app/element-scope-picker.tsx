"use client";

import { useState } from "react";

type ElementGroup = { id: string; label: string; elements: string[]; title?: string };

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
export const ALL_ELEMENTS = PERIODIC_ROWS.flatMap((row) => row.filter((symbol): symbol is string => Boolean(symbol)))
  .concat(LANTHANIDE_ROW, ACTINIDE_ROW);

const CHAPTER_GROUPS: ElementGroup[] = [
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
  { id: "noble_gases", label: "稀有气体", elements: ["He", "Ne", "Ar", "Kr", "Xe", "Rn", "Og"] },
];

const PRESETS: ElementGroup[] = [
  { id: "period4_transition", label: "第四周期过渡金属", title: "第四周期过渡金属元素化学测试", elements: ["Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn"] },
  { id: "metalloids", label: "类金属", title: "类金属元素化学测试", elements: ["B", "Si", "Ge", "As", "Sb", "Te"] },
  { id: "active_nonmetals", label: "活泼非金属", title: "活泼非金属元素化学测试", elements: ["C", "N", "O", "F", "P", "S", "Cl", "Se", "Br", "I"] },
  { id: "variable_valence", label: "竞赛常见变价金属", title: "常见变价金属元素化学测试", elements: ["Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Mo", "W"] },
  { id: "coordination_color", label: "典型配位与有色离子", title: "配位化学与有色离子测试", elements: ["Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Mo", "Ru", "Rh", "Pd", "W", "Os", "Ir", "Pt"] },
  { id: "amphoteric", label: "常见两性元素", title: "常见两性元素化学测试", elements: ["Be", "Al", "Zn", "Ga", "Ge", "Cr", "Sn", "Pb"] },
];

function sameElements(scope: Set<string>, elements: string[]): boolean {
  return scope.size === elements.length && elements.every((symbol) => scope.has(symbol));
}

export function elementScopeTitle(scope: Set<string>): string {
  if (sameElements(scope, ALL_ELEMENTS)) return "元素化学综合测试";
  const chapter = CHAPTER_GROUPS.find((group) => sameElements(scope, group.elements));
  if (chapter) return `${chapter.label}元素化学测试`;
  const preset = PRESETS.find((group) => sameElements(scope, group.elements));
  if (preset) return preset.title || `${preset.label}元素化学测试`;

  const remaining = new Set(scope);
  const descriptors: string[] = [];
  CHAPTER_GROUPS.forEach((group) => {
    if (group.elements.every((symbol) => remaining.has(symbol))) {
      descriptors.push(group.label);
      group.elements.forEach((symbol) => remaining.delete(symbol));
    }
  });
  ALL_ELEMENTS.filter((symbol) => remaining.has(symbol)).forEach((symbol) => descriptors.push(`元素${symbol}`));
  const shown = descriptors.slice(0, 6);
  return `元素化学测试（${shown.join("、")}${descriptors.length > shown.length ? "、…" : ""}）`;
}

export function ElementScopePicker({
  scope,
  onApply,
  error,
}: {
  scope: Set<string>;
  onApply: (next: Set<string>) => boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"groups" | "custom">("groups");
  const [draft, setDraft] = useState<Set<string>>(() => new Set(scope));
  const summary = scope.size === ALL_ELEMENTS.length
    ? "全部元素"
    : scope.size <= 8 ? [...scope].join(" · ") : `已选 ${scope.size} 个元素`;
  const openEditor = (nextView: "groups" | "custom") => {
    setDraft(new Set(scope));
    setView(nextView);
    setOpen(true);
  };
  const toggleGroup = (group: ElementGroup) => setDraft((current) => {
    const next = new Set(current);
    const selected = group.elements.every((symbol) => next.has(symbol));
    group.elements.forEach((symbol) => selected ? next.delete(symbol) : next.add(symbol));
    return next;
  });
  const toggleElement = (symbol: string) => setDraft((current) => {
    const next = new Set(current);
    if (next.has(symbol)) next.delete(symbol);
    else next.add(symbol);
    return next;
  });
  const applyDraft = () => {
    if (draft.size && onApply(new Set(draft))) setOpen(false);
  };

  return <>
    <section className="paper-scope-control" aria-label="考察元素范围">
      <span>考察元素</span><b>{summary}</b>
      <button onClick={() => openEditor("groups")}>章节多选</button>
      <button onClick={() => openEditor("custom")}>自定义</button>
      <button onClick={() => onApply(new Set(ALL_ELEMENTS))}>全选</button>
      {error ? <em>{error}</em> : null}
    </section>
    {open ? <div className="scope-modal-backdrop" onMouseDown={(event) => {
      if (event.currentTarget === event.target) setOpen(false);
    }}>
      <section className="scope-modal" role="dialog" aria-modal="true" aria-labelledby="paper-scope-title">
        <header className="scope-modal-header">
          <div><span className="panel-label">试卷全局出题范围</span><h2 id="paper-scope-title">选择考察元素</h2><p>当前选择 {draft.size} 个元素；颜色题和方程式题均按此范围生成。</p></div>
          <button className="scope-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
        </header>
        <div className="scope-tabs" role="tablist">
          <button className={view === "groups" ? "active" : ""} onClick={() => setView("groups")}>章节分组与预设</button>
          <button className={view === "custom" ? "active" : ""} onClick={() => setView("custom")}>自定义周期表</button>
        </div>
        <div className="scope-modal-body">
          {view === "groups" ? <>
            <div className="scope-section-heading">
              <div><h3>宋天佑教材章节</h3><p>可多选，各组取并集。</p></div>
              <div><button onClick={() => setDraft(new Set())}>清空</button><button onClick={() => setDraft(new Set(ALL_ELEMENTS))}>全选</button></div>
            </div>
            <div className="chapter-group-grid">{CHAPTER_GROUPS.map((group) => {
              const selectedCount = group.elements.filter((symbol) => draft.has(symbol)).length;
              const state = selectedCount === group.elements.length ? "selected" : selectedCount ? "partial" : "";
              return <button className={state} onClick={() => toggleGroup(group)} key={group.id}><span>{group.label}</span><small>{group.elements.join(" ")}</small><em>{selectedCount}/{group.elements.length}</em></button>;
            })}</div>
            <div className="scope-section-heading preset-heading"><div><h3>竞赛重点预设</h3><p>点击后替换当前选择，仍可继续增删。</p></div></div>
            <div className="preset-grid">{PRESETS.map((preset) => <button onClick={() => setDraft(new Set(preset.elements))} key={preset.id}><b>{preset.label}</b><small>{preset.elements.join(" ")}</small></button>)}</div>
          </> : <>
            <div className="scope-section-heading">
              <div><h3>在元素周期表上选择</h3><p>点击元素切换选中状态。</p></div>
              <div><button onClick={() => setDraft(new Set())}>清空</button><button onClick={() => setDraft(new Set(ALL_ELEMENTS))}>全选</button></div>
            </div>
            <div className="periodic-table-scroll"><div className="periodic-table" aria-label="元素周期表">
              {PERIODIC_ROWS.flatMap((row, rowIndex) => row.map((symbol, columnIndex) => symbol ? <button className={draft.has(symbol) ? "selected" : ""} style={{ gridColumn: columnIndex + 1, gridRow: rowIndex + 1 }} onClick={() => toggleElement(symbol)} aria-pressed={draft.has(symbol)} key={symbol}>{symbol}</button> : null))}
              <span className="series-marker lanthanide-marker" aria-hidden="true">镧系</span>
              {LANTHANIDE_ROW.map((symbol, index) => <button className={draft.has(symbol) ? "selected" : ""} style={{ gridColumn: index + 4, gridRow: 9 }} onClick={() => toggleElement(symbol)} aria-pressed={draft.has(symbol)} key={symbol}>{symbol}</button>)}
              <span className="series-marker actinide-marker" aria-hidden="true">锕系</span>
              {ACTINIDE_ROW.map((symbol, index) => <button className={draft.has(symbol) ? "selected" : ""} style={{ gridColumn: index + 4, gridRow: 10 }} onClick={() => toggleElement(symbol)} aria-pressed={draft.has(symbol)} key={symbol}>{symbol}</button>)}
            </div></div>
          </>}
          {!draft.size ? <p className="scope-error modal-error">至少选择一个元素。</p> : null}
          {error ? <p className="scope-error modal-error">{error}</p> : null}
        </div>
        <footer className="scope-modal-footer"><span>所选范围会同时应用于整张试卷。</span><div><button onClick={() => setOpen(false)}>取消</button><button className="primary-action" disabled={!draft.size} onClick={applyDraft}>应用范围并重新生成</button></div></footer>
      </section>
    </div> : null}
  </>;
}
