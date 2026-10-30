import { test, expect, type Locator } from '@playwright/test';
import { promptProblem } from '../../src/domain/readiness';
import { mkdir, writeFile } from 'node:fs/promises';
const phase = process.env.RECALLLAB_JOURNEY_PHASE ?? 'candidate';
const bank = Array.from({ length: 69 }, (_, i) => ({
  question: `公开虚构条目${i + 1}采用什么信号？`,
  standardAnswer: `青晶信号${i + 1}`,
  answerCriteria: ['完整信号名称'],
}));
test('measures first useful question and twenty-answer decision burden with the same public 69-question bank', async ({
  page,
  browser,
}, info) => {
  const counts = {
    preparation: 0,
    goalRequirements: 0,
    answerEntry: 0,
    answerSubmission: 0,
    correctnessConfirmation: 0,
    extraPerQuestionManagement: 0,
    offscreenPrimaryActions: 0,
  };
  const click = async (l: Locator, key: keyof typeof counts) => {
    const b = await l.boundingBox();
    if (b && (b.y < 0 || b.y + b.height > (page.viewportSize()?.height ?? 1000)))
      counts.offscreenPrimaryActions++;
    counts[key]++;
    await l.click();
  };
  const started = Date.now();
  await page.goto('/');
  await click(page.getByRole('link', { name: '创建学习任务', exact: true }).first(), 'preparation');
  counts.preparation++;
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'public-task-69.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bank)),
  });
  await click(page.getByRole('button', { name: '确认导入 69 道题', exact: true }), 'preparation');
  if (phase === 'baseline')
    await click(page.getByRole('link', { name: '设置目标并自动安排', exact: true }), 'preparation');
  await expect(page.getByRole('heading', { name: '目标与自动学习方案' })).toBeVisible();
  const date = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  counts.goalRequirements++;
  await page.getByLabel('目标日期', { exact: true }).fill(date);
  counts.goalRequirements++;
  await page.getByLabel('每天最多学习时间（分钟）').fill('30');
  await click(
    page.getByRole('button', { name: '自动安排并开始学习', exact: true }),
    'goalRequirements',
  );
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toBeVisible();
  const firstQuestionMs = Date.now() - started;
  const get = () =>
    page.evaluate(async () => {
      const { db } = await (import('/src/persistence/database.ts' + '') as Promise<
        typeof import('../../src/persistence/database')
      >);
      const s = (await db.sessions.toArray()).find(
        (s) => s.status === 'active' && s.reviewPlan?.adaptive,
      )!;
      return {
        session: s,
        events: await db.reviewEvents.toArray(),
        cards: await db.practiceItems.toArray(),
        sources: await db.sourceDocuments.toArray(),
      };
    });
  let firstSavedMs = 0;
  for (let i = 0; i < 20; i++) {
    const s = (await get()).session,
      item = s.queue[s.index]!;
    counts.answerEntry++;
    await page.getByRole('textbox', { name: '你的回答', exact: true }).fill(item.standardAnswer);
    await click(page.getByRole('button', { name: '提交回答', exact: true }), 'answerSubmission');
    await click(
      page.getByRole('button', { name: '采用核对反馈并继续', exact: true }),
      'correctnessConfirmation',
    );
    await expect.poll(async () => (await get()).events.length).toBe(i + 1);
    if (!i) firstSavedMs = Date.now() - started;
  }
  const data = await get();
  expect(data.cards).toHaveLength(69);
  expect(data.events).toHaveLength(20);
  expect(
    data.events.every(
      (e) =>
        e.assessmentSource === 'deterministic' &&
        e.scheduling?.grade === 3 &&
        e.subjectiveMastery === null,
    ),
  ).toBe(true);
  expect(
    data.cards.every((c) => c.sourceReferences.some((r) => r.documentId === data.sources[0]!.id)),
  ).toBe(true);
  const document = data.sources[0]!;
  const references = new Map(bank.map((row) => [row.question, row.standardAnswer]));
  const quality = {
    sourceAnchored: data.cards.filter((c) =>
      c.sourceReferences.some((r) => r.documentId === document.id),
    ).length,
    literalExcerptMatched: data.cards.filter((c) =>
      c.sourceReferences.some(
        (r) =>
          r.documentId === document.id &&
          !!r.excerpt &&
          document.extractedContent.includes(r.excerpt) &&
          (r.startOffset === undefined ||
            document.extractedContent.slice(r.startOffset, r.endOffset) === r.excerpt),
      ),
    ).length,
    referenceQAPairsMatched: data.cards.filter(
      (c) => references.get(c.question) === c.standardAnswer,
    ).length,
    automatedPromptProblems: data.cards.filter((c) => promptProblem(c)).length,
    exactPromptDuplicates:
      data.cards.length -
      new Set(
        data.cards.map((c) => c.question.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()),
      ).size,
    semanticHumanAcceptance: null,
  };
  expect(quality).toMatchObject({
    sourceAnchored: 69,
    literalExcerptMatched: 69,
    referenceQAPairsMatched: 69,
    automatedPromptProblems: 0,
    exactPromptDuplicates: 0,
  });
  const pause = page.getByRole('link', { name: '暂停并返回学习方案' });
  await pause.click();
  await page.goto('/#home');
  let resumeOperations = 1;
  const direct = page.getByRole('button', { name: '继续今天的学习', exact: true });
  if (phase === 'baseline') {
    await page.getByRole('link', { name: '继续今天的学习', exact: true }).click();
    resumeOperations++;
    await page.getByRole('button', { name: '继续上次学习', exact: true }).click();
  } else await direct.click();
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toBeVisible();
  expect((await get()).events).toEqual(data.events);
  const result = {
    phase,
    codeSnapshot: process.env.RECALLLAB_UX_SHA ?? null,
    browser: browser.version(),
    viewport: page.viewportSize(),
    timezone: info.project.use.timezoneId ?? null,
    actor: 'Playwright script; not human reading, understanding or recall',
    fixture: '69 provided fictional Q/A entries; one current question per response',
    firstQuestionMs,
    firstSavedMs,
    counts,
    resumeOperations,
    preparationQuality: quality,
    realUserTime: null,
    delayedRecallOutcome: null,
  };
  await info.attach('product-journey-metrics', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  if (process.env.RECALLLAB_WRITE_UX === '1') {
    const output = process.env.RECALLLAB_UX_OUTPUT_DIR ?? 'evaluation/v061';
    await mkdir(output, { recursive: true });
    await writeFile(
      `${output}/${phase}-${info.repeatEachIndex}.json`,
      JSON.stringify(result, null, 2) + '\n',
    );
  }
  expect(counts.answerEntry).toBe(20);
  expect(counts.correctnessConfirmation).toBe(20);
  expect(counts.extraPerQuestionManagement).toBe(0);
  expect(resumeOperations).toBe(phase === 'baseline' ? 2 : 1);
});
