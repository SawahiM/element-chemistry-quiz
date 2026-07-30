import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the chemistry quiz loading shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>元素化学<\/title>/i);
  assert.match(html, /正在整理物质与颜色关系/);
  assert.doesNotMatch(html, /codex-preview|Starter Project|Building your site/i);
});

test("server-renders the reaction review route", async () => {
  const response = await render("/review");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>反应式复核台 · 元素化学<\/title>/i);
  assert.match(html, /正在整理反应方程式/);
});

test("reaction review dataset and interface cover the full extraction", async () => {
  const payload = JSON.parse(
    await readFile(new URL("../public/reactions.review.v1.json", import.meta.url), "utf8"),
  );
  assert.equal(payload.metadata.pagesScanned, 496);
  assert.equal(payload.metadata.reactionCount, payload.reactions.length);
  assert.equal(payload.metadata.electronReactionCount, 83);
  assert.equal(payload.metadata.electronParticipantCount, 83);
  assert.equal(payload.metadata.manualEditCount, 31);
  assert.equal(payload.metadata.verifiedReviewCount, 38);
  assert.equal(payload.metadata.rejectedReviewCount, 70);
  assert.ok(payload.reactions.length >= 1200);
  assert.ok(payload.reactions.every((reaction) => reaction.source?.pdfPage && reaction.source?.evidenceText));
  assert.ok(payload.reactions.some((reaction) => reaction.equationCanonical === "3NO2 + H2O -> 2HNO3 + NO"));
  assert.ok(payload.reactions.some((reaction) => reaction.conditions.some((condition) => condition.normalizedValue === "fusion")));
  const electronReactions = payload.reactions.filter((reaction) => (
    reaction.participants.some((participant) => /^e\^-(?:\([^()]+\))?$/.test(participant.formulaCanonical || ""))
  ));
  assert.equal(electronReactions.length, 83);
  assert.ok(electronReactions.every((reaction) => reaction.equationKind === "half_reaction"));
  assert.equal(payload.reactions.filter((reaction) => reaction.reviewStatus === "verified").length, 38);
  assert.equal(payload.reactions.filter((reaction) => reaction.reviewStatus === "rejected").length, 70);

  const reviewPage = await readFile(new URL("../app/review/page.tsx", import.meta.url), "utf8");
  assert.match(reviewPage, /ElementChemistryReactionReview/);
  assert.match(reviewPage, /localStorage\.setItem/);
  assert.match(reviewPage, /确认正确/);
  assert.match(reviewPage, /需要修订/);
  assert.match(reviewPage, /排除记录/);
  assert.match(reviewPage, /导出复核结果/);
  assert.match(reviewPage, /splitEquation/);
  assert.match(reviewPage, /ChemicalTerm/);
  assert.match(reviewPage, /bookPageImageUrl/);
  assert.match(reviewPage, /原书扫描图/);
  assert.match(reviewPage, /打开原图/);
  assert.match(reviewPage, /setImageZoom/);
  assert.doesNotMatch(reviewPage, /selected\.source\.evidenceText/);
  assert.match(reviewPage, /编辑反应数据/);
  assert.match(reviewPage, /addDraftParticipant/);
  assert.match(reviewPage, /addDraftCondition/);
  assert.match(reviewPage, /保存并重新校验/);
  assert.match(reviewPage, /http:\/\/localhost:3101/);
  assert.match(reviewPage, /method: "PUT"/);
  assert.match(reviewPage, /恢复 OCR 结果/);
});

test("bundled dataset stores appendix ranges as multiple accepted colors", async () => {
  const materials = JSON.parse(
    await readFile(new URL("../public/materials.v1.json", import.meta.url), "utf8"),
  );
  const rows = materials.observations.filter((row) => row.formula === "(NH4)2S");
  assert.deepEqual(
    [...new Set(rows.map((row) => row.color))].sort(),
    ["橙色", "黄色"].sort(),
  );
  assert.ok(rows.every((row) => row.colorQuestionEligible && row.selectionQuestionEligible));
});

test("quiz keeps navigable practice and exam histories with post-exam review", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /practiceHistory/);
  assert.match(page, /previousQuestion/);
  assert.match(page, /examAnswers/);
  assert.match(page, /showExamQuestion/);
  assert.match(page, /ExamReviewCard/);
  assert.match(page, /所有题目、作答结果与教材依据/);
  assert.match(page, /SESSION_STORAGE_KEY/);
  assert.match(page, /window\.localStorage\.setItem/);
  assert.match(page, /restoreSavedSession/);
  assert.match(page, /保留并继续/);
  assert.match(page, /清空并重新开始/);
  assert.match(page, /practiceDraft/);
  const createPracticeStart = page.indexOf("const createPracticeQuestion");
  const createPracticeEnd = page.indexOf("const showExamQuestion", createPracticeStart);
  const createPracticeBlock = page.slice(createPracticeStart, createPracticeEnd);
  assert.match(createPracticeBlock, /setPracticeDraft/);
  assert.doesNotMatch(createPracticeBlock, /setPracticeHistory/);
  assert.match(page, /setPracticeHistory\(\(entries\) => \[\.\.\.entries, completed\]\)/);
  assert.match(page, /storedRecordCount\(parsed\) > 0/);
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
