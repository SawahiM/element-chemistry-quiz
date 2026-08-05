"use client";

import type { ReactNode } from "react";

type PracticeArea = "colors" | "equations" | "paper";

export function ChemistryMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand-mark compact" : "brand-mark"} aria-hidden="true">
      <svg viewBox="0 0 48 48" role="img">
        <path d="M18 7h12M21 7v10L11 35.5A4 4 0 0 0 14.5 41h19a4 4 0 0 0 3.5-5.5L27 17V7" />
        <path className="brand-mark-liquid" d="M14.5 34h19" />
        <circle cx="20" cy="31" r="1.6" />
        <circle cx="28.5" cy="27" r="1.4" />
      </svg>
    </span>
  );
}

export function PracticeBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand compact" : "brand"}>
      <ChemistryMark compact={compact} />
      <div>
        <strong>无机化学基础知识练习</strong>
        {!compact ? <small>颜色性质 · 反应方程式 · 综合测试</small> : null}
      </div>
    </div>
  );
}

function ModeGlyph({ mode }: { mode: PracticeArea | "exam" }) {
  if (mode === "colors") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="7" r="3" /><circle cx="13" cy="7" r="3" /><circle cx="10" cy="12.5" r="3" /></svg>;
  }
  if (mode === "equations") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 6h5M12.5 6h5M4 14h12M10 3.5v5M10 11.5v5" /></svg>;
  }
  if (mode === "paper") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5zM12 2.5v3h3M7.5 9h5M7.5 12h5M7.5 15h3.5" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /><circle cx="10" cy="10" r="4" /></svg>;
}

export function PracticeNavigation({
  active,
  onColors,
  onEquations,
  onPaper,
  onExam,
  examActive = false,
  examDisabled = false,
}: {
  active: PracticeArea;
  onColors?: () => void;
  onEquations?: () => void;
  onPaper?: () => void;
  onExam?: () => void;
  examActive?: boolean;
  examDisabled?: boolean;
}) {
  const item = (mode: PracticeArea, label: string, onClick?: () => void) => (
    <button className={active === mode ? "active" : ""} onClick={onClick} disabled={!onClick} aria-current={active === mode ? "page" : undefined}>
      <span className="mode-glyph"><ModeGlyph mode={mode} /></span><b>{label}</b>
    </button>
  );
  return (
    <nav className="practice-nav" aria-label="练习模式">
      {item("colors", "颜色练习", onColors)}
      {item("equations", "方程式练习", onEquations)}
      {item("paper", "试卷模式", onPaper)}
      {onExam ? (
        <button className={examActive ? "active exam-mode" : "exam-mode"} onClick={onExam} disabled={examDisabled}>
          <span className="mode-glyph"><ModeGlyph mode="exam" /></span><b>考试模式</b>
        </button>
      ) : null}
    </nav>
  );
}

export function PracticeHeader({ brandCompact = false, children }: { brandCompact?: boolean; children: ReactNode }) {
  return <header className="topbar"><PracticeBrand compact={brandCompact} /><div className="topbar-actions">{children}</div></header>;
}
