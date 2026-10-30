import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
async function state(page: Page) {
  return page.evaluate(async () => {
    const { db } = await (import('/src/persistence/database.ts' + '') as Promise<
      typeof import('../../src/persistence/database')
    >);
    return {
      events: await db.reviewEvents.toArray(),
      memories: await db.memoryStates.toArray(),
      sessions: await db.sessions.toArray(),
      projects: await db.projects.toArray(),
      cards: await db.practiceItems.toArray(),
      recoveries: await db.draftRecoveries.toArray(),
    };
  });
}
async function upload(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: '创建学习任务', exact: true }).first().click();
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(fileURLToPath(new URL('../fixtures/import/bank-69.json', import.meta.url)));
  await page.getByRole('button', { name: '确认导入 69 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '目标与自动学习方案' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '目标与自动学习方案' })).toBeVisible();
  const date = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await page.getByLabel('目标日期', { exact: true }).fill(date);
  await page.getByLabel('每天最多学习时间（分钟）').fill('30');
  await page.getByRole('button', { name: '自动安排并开始学习', exact: true }).click();
  await expect(page.getByRole('heading', { name: '先回忆，再看答案。' })).toBeVisible();
}
test('goal flow: public 69 bank, exact feedback, refresh/pause, human correction, immutable revision and full backup', async ({
  page,
}) => {
  await upload(page);
  expect((await state(page)).cards).toHaveLength(69);
  await expect(page.getByRole('radio', { name: '3 基本掌握', exact: true })).toHaveCount(0);
  let before = await state(page);
  const active = before.sessions.find((s) => s.status === 'active' && s.reviewPlan?.adaptive)!;
  const item = active.queue[active.index]!;
  await page.getByRole('textbox', { name: '你的回答', exact: true }).fill(item.standardAnswer);
  await expect(page.getByText('正在保存草稿…', { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toHaveValue(
    item.standardAnswer,
  );
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await expect(page.getByText(/系统不能确定这次回答/)).toBeVisible();
  await page.getByRole('button', { name: '全部正确，继续', exact: true }).click();
  await expect.poll(async () => (await state(page)).events.length).toBe(1);
  let saved = await state(page);
  expect(saved.events[0]).toMatchObject({
    assessmentSource: 'user_checked',
    subjectiveMastery: null,
    scheduling: { grade: 3 },
  });
  const next = saved.sessions.find((s) => s.id === active.id)!;
  await page
    .getByRole('textbox', { name: '你的回答', exact: true })
    .fill(next.queue[next.index]!.standardAnswer);
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await page.getByRole('button', { name: '回答错误，继续', exact: true }).click();
  await expect.poll(async () => (await state(page)).events.length).toBe(2);
  saved = await state(page);
  expect(
    saved.events.some((e) => e.assessmentResult === 'incorrect' && e.scheduling?.grade === 1),
  ).toBe(true);
  await page.getByRole('textbox', { name: '你的回答', exact: true }).fill('暂停时保留的虚构草稿');
  await page.getByRole('link', { name: '暂停并返回学习方案' }).click();
  await page.getByRole('button', { name: '继续上次学习', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '你的回答', exact: true })).toHaveValue(
    '暂停时保留的虚构草稿',
  );
  before = await state(page);
  const first = before.cards.find((c) => c.id === item.id)!;
  await page.evaluate(
    async ({ pid, id, revision, question }) => {
      const { repository } = await (import('/src/persistence/repository.ts' + '') as Promise<
        typeof import('../../src/persistence/repository')
      >);
      await repository.saveCard(
        pid,
        {
          question,
          standardAnswer: '更正后虚构标准答案',
          answerCriteria: '',
          hints: '',
          mnemonics: '',
          confusionWarnings: '',
          sourceLabel: '',
        },
        id,
        {
          expectedRevisionId: revision,
          changeType: 'substantive',
          changeSummary: '公开验收：更正错误资料',
          impactOnLearningState: 'reset',
        },
      );
    },
    {
      pid: first.projectId,
      id: first.id,
      revision: first.currentRevisionId,
      question: first.question,
    },
  );
  saved = await state(page);
  expect(saved.cards.find((c) => c.id === item.id)!.learningStateId).not.toBe(
    first.learningStateId,
  );
  expect(saved.events).toEqual(before.events);
  const result = await page.evaluate(async () => {
    const { db } = await (import('/src/persistence/database.ts' + '') as Promise<
      typeof import('../../src/persistence/database')
    >);
    const { exportBackup, restoreBackup } = await (import(
      '/src/persistence/backup.ts' + ''
    ) as Promise<typeof import('../../src/persistence/backup')>);
    const b = await exportBackup(db);
    await restoreBackup(db, b);
    return {
      same:
        JSON.stringify({
          ...(await exportBackup(db)).data,
          sessions: (await exportBackup(db)).data.sessions.map((s) => ({
            ...s,
            generation: 'rotated',
          })),
        }) ===
        JSON.stringify({
          ...b.data,
          sessions: b.data.sessions.map((s) => ({ ...s, generation: 'rotated' })),
        }),
      version: b.databaseVersion,
    };
  });
  expect(result).toEqual({ same: true, version: 8 });
});
test('cross-tab stale inputs stay protected; skips and flagged questions do not become FSRS failures', async ({
  page,
  context,
}) => {
  await upload(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByRole('textbox', { name: '你的回答', exact: true })).toBeVisible();
  await second.getByRole('textbox', { name: '你的回答', exact: true }).fill('另一个标签页的草稿');
  await page.getByRole('button', { name: '跳过，稍后再学', exact: true }).click();
  await expect.poll(async () => (await state(page)).events.length).toBe(1);
  await expect
    .poll(async () =>
      (await state(second)).recoveries.some((r) => r.draft.userResponse === '另一个标签页的草稿'),
    )
    .toBe(true);
  const saved = await state(page);
  expect(saved.events[0]!.scheduling?.grade).toBeNull();
  await page.getByRole('button', { name: '题目有问题，暂不学习', exact: true }).click();
  await expect
    .poll(async () => (await state(page)).cards.filter((c) => c.learningIssue).length)
    .toBe(1);
  expect((await state(page)).events.every((e) => e.scheduling?.grade === null)).toBe(true);
});

test('short exact answers have explainable feedback that can be corrected; detailed omission overrides high subjective mastery', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#import-task');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'public-short.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([
        {
          question: '虚构通信协议的标识是什么？',
          standardAnswer: '蓝晶信号',
          answerCriteria: ['完整标识'],
        },
        {
          question: '虚构二号通信协议的标识是什么？',
          standardAnswer: '白晶信号',
          answerCriteria: ['完整标识'],
        },
      ]),
    ),
  });
  await page.getByRole('button', { name: '确认导入 2 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '目标与自动学习方案' })).toBeVisible();
  await page.getByRole('button', { name: '自动安排并开始学习', exact: true }).click();
  let s = await state(page);
  let active = s.sessions.find((s) => s.status === 'active')!;
  await page
    .getByRole('textbox', { name: '你的回答', exact: true })
    .fill(active.queue[active.index]!.standardAnswer);
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await expect(page.getByText(/与短标准答案一致/)).toBeVisible();
  await page.getByRole('button', { name: '更正此次判断' }).click();
  await page.getByRole('button', { name: '回答错误，继续', exact: true }).click();
  await expect.poll(async () => (await state(page)).events.length).toBe(1);
  expect((await state(page)).events[0]).toMatchObject({
    quickFeedback: { overridden: true },
    scheduling: { grade: 1 },
  });
  s = await state(page);
  active = s.sessions.find((s) => s.status === 'active')!;
  await page
    .getByRole('textbox', { name: '你的回答', exact: true })
    .fill(active.queue[active.index]!.standardAnswer);
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await page.getByText('详细核对与可选评价', { exact: true }).click();
  await page.getByLabel('必需要点 1 核对').selectOption('omitted');
  await page.getByRole('button', { name: '按逐项结果继续' }).click();
  await expect.poll(async () => (await state(page)).events.length).toBe(2);
  const e = (await state(page)).events.find((e) => e.assessmentMode === 'detailed')!;
  expect(e.scheduling?.grade).toBe(1);
  expect(e.criterionChecks?.[0]?.result).toBe('omitted');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
