import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quiz modes use direct routes inside one persistent app header", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const header = await readFile(new URL("../app/practice-header.tsx", import.meta.url), "utf8");
  const routes = await Promise.all(["color", "equation", "test", "paper"].map(async (route) => ({
    route,
    source: await readFile(new URL(`../app/${route}/page.tsx`, import.meta.url), "utf8"),
  })));

  for (const route of routes) {
    assert.match(route.source, new RegExp(`initialArea="${route.route}"`));
  }
  assert.match(layout, /<AppHeader \/>/);
  assert.match(header, /usePathname/);
  for (const route of ["color", "equation", "test", "paper"]) {
    assert.match(header, new RegExp(`mode: "${route}"`));
  }
  assert.match(header, /<Link href=\{href\}/);
  assert.doesNotMatch(header, /exam-mode/);
  assert.doesNotMatch(source, /window\.history\.pushState/);
  assert.match(source, /window\.history\.replaceState/);
  assert.doesNotMatch(source, /window\.addEventListener\("popstate"/);
});

test("unified exam mixes registered color and equation question types", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const equation = await readFile(new URL("../app/equation-quiz.tsx", import.meta.url), "utf8");

  assert.match(source, /UNIFIED_EXAM_TYPE_REGISTRY/);
  assert.match(source, /id: "color_of"/);
  assert.match(source, /id: "which_one_is_color"/);
  assert.match(source, /id: "which_are_color"/);
  assert.match(source, /id: "equation_forward"/);
  assert.match(source, /id: "equation_reverse"/);
  assert.match(source, /shuffled\(generated\)/);
  assert.match(source, /统一计时、计分和交卷/);
  assert.match(source, /UNIFIED_EXAM_SESSION_KEY/);
  assert.match(source, /unified: true/);
  assert.match(source, /clientKey: `unified-exam-\$\{startedAt\}`/);
  assert.match(source, /quizKind: "unified"/);
  assert.match(source, /version: 3/);
  assert.doesNotMatch(source, /unified-color-exam-|unified-equation-exam-/);
  assert.match(equation, /export function EquationExamQuestion/);
  assert.match(equation, /export function EquationExamReviewCard/);
});

test("one shared header exposes the unified test route without a special button style", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const equation = await readFile(new URL("../app/equation-quiz.tsx", import.meta.url), "utf8");
  const paper = await readFile(new URL("../app/paper-mode.tsx", import.meta.url), "utf8");
  const header = await readFile(new URL("../app/practice-header.tsx", import.meta.url), "utf8");

  assert.match(header, /mode: "test", label: "考试模式"/);
  assert.match(header, /MODES\.map/);
  assert.doesNotMatch(page, /<PracticeHeader/);
  assert.doesNotMatch(equation, /<PracticeHeader/);
  assert.doesNotMatch(paper, /PracticeBrand|PracticeNavigation/);
  assert.doesNotMatch(page, />返回练习</);
});

test("mode resources are lazy-loaded once and retained for the browser session", async () => {
  const cache = await readFile(new URL("../app/session-cache.ts", import.meta.url), "utf8");
  const account = await readFile(new URL("../app/account-storage.ts", import.meta.url), "utf8");
  const history = await readFile(new URL("../app/history-storage.ts", import.meta.url), "utf8");
  const files = await Promise.all(["page.tsx", "equation-quiz.tsx", "paper-mode.tsx", "history/page.tsx"].map((path) => readFile(new URL(`../app/${path}`, import.meta.url), "utf8")));

  assert.match(cache, /resourceValues = new Map/);
  assert.match(cache, /resourceRequests = new Map/);
  assert.match(cache, /peekSessionResource/);
  assert.match(cache, /if \(cached !== undefined\) return Promise\.resolve\(cached\)/);
  for (const source of files) assert.match(source, /loadSessionResource/);
  assert.match(account, /accountValues\.set\(key, value\)/);
  assert.match(account, /peekAccountData/);
  assert.match(account, /clearAccountSessionCache/);
  assert.match(history, /if \(historyValue\) return historyValue/);
  assert.match(history, /historyValue = undefined/);
  assert.match(history, /clearHistorySessionCache/);
});

test("cached equation restore survives Strict Mode effect replay", async () => {
  const equation = await readFile(new URL("../app/equation-quiz.tsx", import.meta.url), "utf8");
  const effectStart = equation.indexOf("if (!data || question || restored.current) return;");
  const timerStart = equation.indexOf("window.setTimeout(async () => {", effectStart);
  const restoredMarker = equation.indexOf("restored.current = true;", effectStart);

  assert.ok(effectStart >= 0, "equation restore effect should exist");
  assert.ok(timerStart > effectStart, "equation restore should be deferred");
  assert.ok(
    restoredMarker > timerStart,
    "restore marker must be set inside the deferred callback so Strict Mode cleanup cannot leave the page loading",
  );
});

test("shared header geometry stays stable while modes load and paper controls align", async () => {
  const globalCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(layout, /className="authenticated-app"><AppHeader\s*\/>\{children\}<\/div>/);
  assert.match(globalCss, /\.authenticated-app\s*\{[^}]*min-height:\s*100dvh[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
  assert.match(globalCss, /\.authenticated-app\s*>\s*main\s*\{[^}]*flex:\s*1 0 auto/);
  assert.match(globalCss, /html\s*\{[^}]*scrollbar-gutter:\s*stable/);
  assert.match(globalCss, /\.paper-toolbar-controls\s*\{[^}]*width:\s*min\(1530px, 100%\)/);
});

test("completed unified exams reopen on setup with an independent previous-result snapshot", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const resultRoute = await readFile(new URL("../app/test/result/page.tsx", import.meta.url), "utf8");

  assert.match(page, /setLastResult\(resultSnapshot\)/);
  assert.match(page, /setMode\(nextMode === "result" \? "setup"/);
  assert.match(page, />上次考试结果<\/button>/);
  assert.match(page, /router\.push\(publicPath\("\/test\/result"\)\)/);
  assert.match(page, /router\.replace\(publicPath\("\/test"\)\)/);
  assert.match(page, /resultConfig = lastResult\?\.config \?\? config/);
  assert.match(page, /resultItems = lastResult\?\.items \?\? items/);
  assert.match(resultRoute, /testResultRoute/);
  assert.match(css, /\.exam-setup-actions \.primary-action\s*\{[^}]*margin-left:\s*auto/);
});

test("unified exam progress counts answered questions instead of the current index", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /const currentAnsweredCount = items\.filter\(unifiedItemAnswered\)\.length/);
  assert.match(page, /<strong>\{currentAnsweredCount\}<\/strong><span>\/ \{items\.length\}<\/span>/);
  assert.match(page, /aria-valuenow=\{currentAnsweredCount\}/);
  assert.match(page, /currentAnsweredCount \/ items\.length \* 100/);
});
