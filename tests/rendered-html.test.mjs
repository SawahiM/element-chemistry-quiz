import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import test, { after, before } from "node:test";

let server;
let baseUrl;

async function freePort() {
  return await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => resolve(address.port));
    });
  });
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Next.js test server did not start");
});

after(() => {
  server?.kill();
});

async function render(pathname = "/") {
  return await fetch(`${baseUrl}${pathname}`, { headers: { accept: "text/html" } });
}

test("server-renders the credential-check shell before the chemistry quiz", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>无机化学基础知识练习<\/title>/i);
  assert.match(html, /正在验证访问凭据/);
  assert.doesNotMatch(html, /正在整理物质与颜色关系/);
  assert.doesNotMatch(html, /codex-preview|Starter Project|Building your site/i);
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /<html lang="zh-CN" suppressHydrationWarning>/);
});

test("server-renders the protected account history route", async () => {
  const response = await render("/history");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>历史记录 · 元素化学<\/title>/i);
  assert.match(html, /正在验证访问凭据/);
});

test("server-renders the unlisted administrator route behind the account gate", async () => {
  const response = await render("/chemquiz-control");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>数据管理 · ChemQuiz<\/title>/i);
  assert.match(html, /正在验证访问凭据/);
  assert.match(html, /noindex/i);

  const header = await readFile(new URL("../app/practice-header.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../server/account-api.ts", import.meta.url), "utf8");
  const adminPage = await readFile(new URL("../app/chemquiz-control/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(header, /chemquiz-control/);
  assert.match(api, /requireAdmin\(request\)/);
  assert.match(api, /authorization instanceof Response/);
  assert.match(api, /registration_enabled/);
  assert.match(api, /admin_audit_logs/);
  assert.match(api, /users\.status = 'active'/);
  assert.doesNotMatch(api, /body\.role/);
  assert.doesNotMatch(api, /body\.displayName/);
  assert.doesNotMatch(adminPage, /name="displayName"/);
  assert.doesNotMatch(adminPage, /name="role"/);
  assert.match(adminPage, /<form key=\{detail\.user\.id\} className="admin-edit-form"/);
  assert.match(api, /push\("display_name", value\)/);
  assert.match(adminPage, /function selectUser\(user: UserRow\)/);
  assert.match(adminPage, /onClick=\{\(\) => selectUser\(user\)\}/);
  assert.match(adminPage, /function DataRecord/);
  assert.match(adminPage, /function HistoryRecord/);
  assert.match(adminPage, /if \(createRequestPending\.current\) return/);
  assert.match(adminPage, /disabled=\{creating\}/);
  assert.doesNotMatch(adminPage, /detail\.(data|history|sessions)/);
  assert.match(api, /OCTET_LENGTH\(payload\) AS "sizeBytes"/);
  assert.match(api, /CREATE TABLE IF NOT EXISTS login_events/);
  assert.match(api, /loginIpAddress\(request\)/);
  assert.match(api, /CHEMQUIZ_TRUST_PROXY/);
  assert.match(api, /ip_address AS "ipAddress"/);
  assert.match(adminPage, /<h3>登录 IP<\/h3>/);
  const detailStart = api.indexOf("async function adminUserDetail");
  const detailEnd = api.indexOf("async function adminCreateUser", detailStart);
  const detailBlock = api.slice(detailStart, detailEnd);
  assert.doesNotMatch(detailBlock, /history_records|user_data|auth_sessions|payload/);
});

test("development and production both require a loopback PostgreSQL database", async () => {
  const database = await readFile(new URL("../db/index.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../server/account-api.ts", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const launcher = await readFile(new URL("../启动本地题库.bat", import.meta.url), "utf8");

  assert.match(database, /process\.env\.DATABASE_URL/);
  assert.match(database, /\["127\.0\.0\.1", "localhost", "::1", "\[::1\]"\]/);
  assert.match(database, /getDatabase/);
  assert.match(api, /getDatabase\(\)\.query/);
  assert.equal(manifest.dependencies.postgres, "^3.4.9");
  assert.equal(manifest.dependencies["@electric-sql/pglite"], undefined);
  assert.equal(manifest.dependencies["drizzle-orm"], undefined);
  assert.match(launcher, /DATABASE_URL=postgresql:\/\/quizapp:.*@127\.0\.0\.1:5432\/quizapp/);
  assert.doesNotMatch(`${database}\n${api}`, /PGlite|neon\.tech/i);
});

test("bundled dataset stores ammonium sulfide as a colorless aqueous solution", async () => {
  const materials = JSON.parse(
    await readFile(new URL("../public/materials.v1.json", import.meta.url), "utf8"),
  );
  const rows = materials.observations.filter((row) => row.formula === "(NH4)2S");
  assert.deepEqual([...new Set(rows.map((row) => row.color))], ["无色"]);
  assert.ok(rows.every((row) => row.stateCategory === "solution" && row.medium === "水"));
  assert.ok(rows.every((row) => row.colorQuestionEligible && row.selectionQuestionEligible));
});

test("structured material states drive quiz, paper, and history displays", async () => {
  const materials = JSON.parse(
    await readFile(new URL("../public/materials.v1.json", import.meta.url), "utf8"),
  );
  assert.equal(materials.observations.some((row) => row.formula === "CrF6"), false);
  const iodineTrifluoride = materials.observations.find((row) => row.formula === "IF3");
  assert.equal(iodineTrifluoride?.stateCategory, "solid");
  assert.match(iodineTrifluoride?.conditions || "", /低温下.*-28/);

  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const paper = await readFile(new URL("../app/paper-mode.tsx", import.meta.url), "utf8");
  const history = await readFile(new URL("../app/history/page.tsx", import.meta.url), "utf8");
  assert.match(page, /stateContextText\(question\.target\)/);
  assert.match(page, /stateBasisLabel\(observation\)/);
  assert.match(paper, /structuredStateKey\(item\)/);
  assert.match(paper, /stateContextText\(choice\)/);
  assert.match(history, /stateBasisLabel\(item\)/);
});

test("quiz keeps navigable practice and exam histories with post-exam review", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const practiceHeader = await readFile(new URL("../app/practice-header.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(page, /practiceHistory/);
  assert.match(page, /previousQuestion/);
  assert.match(page, /examAnswers/);
  assert.match(page, /showExamQuestion/);
  assert.match(page, /ExamReviewCard/);
  assert.match(page, /所有题目、作答结果与教材依据/);
  assert.match(page, /SESSION_STORAGE_KEY/);
  assert.match(page, /saveAccountData/);
  assert.doesNotMatch(page, /window\.localStorage\.setItem/);
  assert.match(page, /restoreSavedSession/);
  assert.match(page, /setTimeout\(restoreSavedSession, 0\)/);
  assert.doesNotMatch(page, /是否保留并恢复/);
  assert.doesNotMatch(page, /清空并重新开始/);
  assert.match(page, /practiceDraft/);
  const createPracticeStart = page.indexOf("const createPracticeQuestion");
  const createPracticeEnd = page.indexOf("const showExamQuestion", createPracticeStart);
  const createPracticeBlock = page.slice(createPracticeStart, createPracticeEnd);
  assert.match(createPracticeBlock, /setPracticeDraft/);
  assert.doesNotMatch(createPracticeBlock, /setPracticeHistory/);
  assert.match(page, /setPracticeHistory\(\(entries\) => \[\.\.\.entries, completed\]\)/);
  assert.match(page, /loadPracticeHistory\("color"\)/);
  assert.match(page, /restoreColorPracticeHistory/);
  assert.doesNotMatch(page, /practiceHistory: practiceHistory\.map/);
  assert.match(layout, /<AppHeader \/>/);
  assert.doesNotMatch(page, /<PracticeHeader>/);
  assert.match(practiceHeader, /无机化学基础知识练习/);
  assert.match(practiceHeader, /颜色练习/);
  assert.match(practiceHeader, /方程式练习/);
  assert.match(practiceHeader, /试卷模式/);
  assert.match(practiceHeader, /考试模式/);
  assert.match(page, /correct-missed/);
  assert.match(page, /missed-correct/);
  assert.match(page, /CHAPTER_ELEMENT_GROUPS/);
  assert.match(page, /COMPETITION_ELEMENT_PRESETS/);
  assert.match(page, /第四周期过渡金属/);
  assert.match(page, /自定义周期表/);
  assert.match(page, /generateScopedQuestion/);
  assert.match(page, /materialsForElementScope/);
  assert.match(page, /elementScope: \[\.\.\.elementScope\]/);
  assert.match(page, /label: "氢"/);
  assert.match(page, /label: "稀有气体"/);
  assert.match(page, /const ALLOWED_ELEMENTS = ALL_ELEMENT_SYMBOLS/);
});

test("account history supports exams, compact practice, wrong answers, and deletion", async () => {
  const historyPage = await readFile(new URL("../app/history/page.tsx", import.meta.url), "utf8");
  const historyCss = await readFile(new URL("../app/history/history.css", import.meta.url), "utf8");
  const historyStorage = await readFile(new URL("../app/history-storage.ts", import.meta.url), "utf8");
  const authGate = await readFile(new URL("../app/auth-gate.tsx", import.meta.url), "utf8");
  const colorQuiz = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const equationQuiz = await readFile(new URL("../app/equation-quiz.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../server/account-api.ts", import.meta.url), "utf8");
  assert.match(authGate, /href="\/history"/);
  assert.match(historyPage, /考试记录/);
  assert.match(historyPage, /做题记录/);
  assert.match(historyPage, /错题整理/);
  assert.match(historyPage, /history-prompt-box/);
  assert.match(historyPage, /equationReactants/);
  assert.match(historyPage, /ReactMarkdown/);
  assert.match(historyPage, /remarkMath/);
  assert.match(historyPage, /StandardEquation/);
  assert.match(historyPage, /displayMode: display/);
  assert.match(historyPage, /deleteHistoryRecord/);
  assert.match(historyPage, /window\.confirm/);
  assert.match(historyPage, /clearHistory/);
  assert.match(historyPage, /isUnifiedExamPayload/);
  assert.match(historyPage, /payload\.unified === true/);
  assert.match(historyPage, /payload\.version === 3/);
  assert.match(historyPage, /item\.quizKind === "unified"/);
  assert.match(historyPage, /颜色与方程式综合考试/);
  assert.match(historyPage, /result\.kind === "color"/);
  assert.doesNotMatch(historyPage, /ColorExamPayload|EquationExamPayload|颜色部分|方程式部分/);
  assert.match(historyPage, /history-hero/);
  assert.doesNotMatch(historyPage, /返回题库|history-back/);
  assert.doesNotMatch(historyPage, /neutral=\{tab === "wrong"\}/);
  assert.match(historyCss, /history-question-grid/);
  assert.match(historyCss, /min-width: 128px/);
  assert.match(historyCss, /width: max-content/);
  assert.match(historyCss, /is-correct \.history-prompt-box/);
  assert.match(historyCss, /is-wrong \.history-prompt-box/);
  assert.match(historyCss, /history-answer-panel > span:first-child/);
  assert.doesNotMatch(historyCss, /history-answer-grid p span \{/);
  assert.match(historyPage, /className="history-answer-panel history-standard-answer"/);
  assert.doesNotMatch(historyPage, /<p className="history-standard-answer"/);
  assert.match(historyStorage, /\/api\/history\?all=true/);
  assert.match(colorQuiz, /color-practice-/);
  assert.match(colorQuiz, /color-exam-/);
  assert.match(equationQuiz, /equation-practice-/);
  assert.match(equationQuiz, /equation-exam-/);
  assert.match(equationQuiz, /loadPracticeHistory\("equation"\)/);
  assert.match(equationQuiz, /restoreEquationPracticeHistory/);
  assert.doesNotMatch(equationQuiz, /<PracticeHeader>/);
  assert.match(equationQuiz, /ReactMarkdown/);
  assert.match(equationQuiz, /remarkPlugins=\{\[remarkGfm, remarkMath\]\}/);
  assert.match(equationQuiz, /rehypePlugins=\{\[rehypeKatex\]\}/);
  assert.match(equationQuiz, /<MarkdownText>\{question\.reaction\.source\.evidenceText\}<\/MarkdownText>/);
  assert.match(equationQuiz, /<MarkdownText>\{result\.question\.reaction\.source\.evidenceText\}<\/MarkdownText>/);
  assert.match(api, /DELETE FROM history_records WHERE id = \$1 AND user_id = \$2/);
  assert.match(api, /DELETE FROM history_records WHERE user_id = \$1/);
  assert.match(api, /record\.quizKind === "unified"/);
});
