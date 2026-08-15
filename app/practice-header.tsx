"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type PracticeArea = "color" | "equation" | "paper" | "test";

const MODES: Array<{ mode: PracticeArea; label: string }> = [
  { mode: "color", label: "颜色练习" },
  { mode: "equation", label: "方程式练习" },
  { mode: "paper", label: "试卷模式" },
  { mode: "test", label: "考试模式" },
];

export function ChemistryMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" role="img">
        <path d="M18 7h12M21 7v10L11 35.5A4 4 0 0 0 14.5 41h19a4 4 0 0 0 3.5-5.5L27 17V7" />
        <path className="brand-mark-liquid" d="M14.5 34h19" />
        <circle cx="20" cy="31" r="1.6" />
        <circle cx="28.5" cy="27" r="1.4" />
      </svg>
    </span>
  );
}

export function PracticeBrand() {
  return (
    <Link href="/color" className="brand brand-link" aria-label="返回颜色练习">
      <ChemistryMark />
      <span>
        <strong>无机化学基础知识练习</strong>
        <small>颜色性质 · 反应方程式 · 综合测试</small>
      </span>
    </Link>
  );
}

function ModeGlyph({ mode }: { mode: PracticeArea }) {
  if (mode === "color") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="7" r="3" /><circle cx="13" cy="7" r="3" /><circle cx="10" cy="12.5" r="3" /></svg>;
  }
  if (mode === "equation") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 6h5M12.5 6h5M4 14h12M10 3.5v5M10 11.5v5" /></svg>;
  }
  if (mode === "paper") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5zM12 2.5v3h3M7.5 9h5M7.5 12h5M7.5 15h3.5" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /><circle cx="10" cy="10" r="4" /></svg>;
}

export function PracticeNavigation() {
  const pathname = usePathname();
  return (
    <nav className="practice-nav" aria-label="练习模式">
      {MODES.map(({ mode, label }) => {
        const href = `/${mode}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={mode}>
            <span className="mode-glyph"><ModeGlyph mode={mode} /></span><b>{label}</b>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppHeader() {
  return (
    <header className="topbar">
      <PracticeBrand />
      <div className="topbar-actions"><PracticeNavigation /></div>
    </header>
  );
}
