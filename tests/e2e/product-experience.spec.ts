import { test, expect, type Page } from '@playwright/test';
async function upload(page: Page, bank: object[]) {
  await page.goto('/#import-task');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'public-experience.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bank)),
  });
}
const simple = {
  question: '虚构传输规范采用什么信号？',
  standardAnswer: '青晶信号',
  answerCriteria: ['完整标识'],
};
async function persisted(page: Page) {
  return page.evaluate(async () => {
    const { db } = await (import('/src/persistence/database.ts' + '') as Promise<
      typeof import('../../src/persistence/database')
    >);
    return {
      events: await db.reviewEvents.toArray(),
      cards: await db.practiceItems.toArray(),
      memories: await db.memoryStates.toArray(),
    };
  });
}
test('incomplete candidates stay blocked, complete subset can be explicitly imported, pending prompts never enter formal learning', async ({
  page,
}) => {
  await upload(page, [
    simple,
    { question: '待完善题干 2', standardAnswer: '需要人工整理的虚构知识陈述' },
    { question: '虚构第三项的规定是什么？', standardAnswer: '' },
  ]);
  await expect(page.getByRole('button', { name: '确认导入 3 道题', exact: true })).toBeDisabled();
  expect((await persisted(page)).cards).toHaveLength(0);
  await page.getByRole('button', { name: '选择字段完整且非重复的题目', exact: true }).click();
  await page.getByRole('button', { name: '确认导入 2 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成' })).toBeVisible();
  await expect(page.getByText('已追加 2 道题，跳过 1 道候选。已有学习历史保留。')).toBeVisible();
  await page.getByRole('link', { name: '设置目标并自动安排' }).click();
  await expect(page.getByLabel('自动规划建议')).toContainText('范围内可学习 1 道 · 待完善 1 道');
  await page.getByRole('button', { name: '自动安排并开始学习', exact: true }).click();
  await expect(page.getByRole('heading', { name: simple.question, exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '你的回答', exact: true }).fill(simple.standardAnswer);
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await page.getByRole('button', { name: '采用核对反馈并继续', exact: true }).click();
  await expect(page.getByLabel('今天的进展与下一步')).toContainText('1 道待完善内容尚未进入学习');
  const s = await persisted(page);
  expect(s.cards).toHaveLength(2);
  expect(s.memories).toHaveLength(1);
  expect(s.events).toHaveLength(1);
});
for (const width of [1440, 390])
  test(`default goal, completion, source and next due remain usable at width ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await upload(page, [simple]);
    const confirmation = page.locator('.import-confirm');
    await expect(confirmation).toBeVisible();
    expect((await confirmation.boundingBox())!.height).toBeLessThan(360);
    await info.attach(`import-${width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
    await expect(page.getByRole('heading', { name: '目标与自动学习方案' })).toBeVisible();
    await expect(page.getByLabel('学习章节')).not.toBeVisible();
    await page.getByText('调整范围与高级设置', { exact: true }).click();
    await page.getByLabel('每日新题上限（留空由系统安排）').fill('0');
    await expect(
      page.getByRole('button', { name: '自动安排并开始学习', exact: true }),
    ).toBeDisabled();
    await page.getByLabel('每日新题上限（留空由系统安排）').fill('');
    await page.getByText('调整范围与高级设置', { exact: true }).click();
    await page.getByRole('button', { name: '自动安排并开始学习', exact: true }).click();
    await expect(page.getByText('本题已记录活跃作答', { exact: false })).not.toBeVisible();
    await page.getByText('为什么复习这题 · 时间与预算', { exact: true }).click();
    await expect(page.getByText('本题已记录活跃作答', { exact: false })).toBeVisible();
    await page.getByText('为什么复习这题 · 时间与预算', { exact: true }).click();
    await page.getByRole('textbox', { name: '你的回答', exact: true }).fill(simple.standardAnswer);
    await page.getByRole('button', { name: '提交回答', exact: true }).click();
    await expect(page.locator('.answer-panel a').first()).toHaveAttribute('href', /^#document\//);
    await page.getByRole('button', { name: '采用核对反馈并继续', exact: true }).click();
    const summary = page.getByLabel('今天的进展与下一步');
    await expect(summary).toContainText('今天实际练习 1 次');
    await expect(summary).toContainText('当前范围仍薄弱 0 道');
    await expect(summary).toContainText('下一次可能的复习时间');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await info.attach(`completion-${width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    const before = await persisted(page);
    await page.goto('/#home');
    await page.getByRole('button', { name: '继续今天的学习', exact: true }).click();
    await expect(page.getByRole('heading', { name: '目标与自动学习方案' })).toBeVisible();
    await expect(page.getByText('下一次可能的复习时间', { exact: false })).toBeVisible();
    expect((await persisted(page)).events).toEqual(before.events);
  });
test('failed recall finishes with a concrete retest and current weak content instead of a mastery claim', async ({
  page,
}) => {
  await upload(page, [
    {
      ...simple,
      standardAnswer: '这是公开虚构材料的长答案。'.repeat(15),
      answerCriteria: ['第一项必要内容', '第二项必要内容'],
    },
  ]);
  await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
  await page.getByRole('button', { name: '自动安排并开始学习', exact: true }).click();
  await page.getByRole('textbox', { name: '你的回答', exact: true }).fill('没有想起来');
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await page.getByRole('button', { name: '回答错误，继续', exact: true }).click();
  const summary = page.getByLabel('今天的进展与下一步');
  await expect(summary).toContainText('仍薄弱 1 道');
  await expect(summary).toContainText('至少等待10分钟');
  await summary.getByText('查看薄弱内容', { exact: true }).click();
  await expect(summary.getByRole('listitem')).toContainText(simple.question);
  expect((await persisted(page)).events[0]).toMatchObject({
    assessmentSource: 'user_checked',
    scheduling: { grade: 1 },
  });
});
test('an observed active-time budget stops work, and a missed day resumes with preserved history and a fresh daily budget', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-01T06:30:00Z') });
  await upload(page, [
    simple,
    { ...simple, question: '虚构备用协议采用什么信号？', standardAnswer: '白晶信号' },
  ]);
  await page.getByRole('button', { name: '确认导入 2 道题', exact: true }).click();
  await page.getByLabel('每天最多学习时间（分钟）').fill('2');
  await page.getByRole('button', { name: '自动安排并开始学习', exact: true }).click();
  const answer = page.getByRole('textbox', { name: '你的回答', exact: true });
  await expect(answer).toBeVisible();
  const text = await page.evaluate(async () => {
    const { db } = await (import('/src/persistence/database.ts' + '') as Promise<
      typeof import('../../src/persistence/database')
    >);
    const s = (await db.sessions.toArray()).find((s) => s.status === 'active')!;
    return s.queue[s.index]!.standardAnswer;
  });
  await answer.fill(text);
  for (let i = 0; i < 5; i++) {
    await page.clock.runFor(15000);
    await answer.press('End');
    await answer.press('Space');
  }
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await page.getByRole('button', { name: '采用核对反馈并继续', exact: true }).click();
  await expect(page.getByLabel('今天的进展与下一步')).toContainText('今天的预计预算已用完');
  const before = await persisted(page);
  expect(before.events[0]!.timing!.activeMs).toBeGreaterThanOrEqual(75000);
  await page.clock.setSystemTime(new Date('2026-11-03T06:30:00Z'));
  await page.goto('/#home');
  await page.getByRole('button', { name: '继续今天的学习', exact: true }).click();
  await expect(answer).toBeVisible();
  expect((await persisted(page)).events).toEqual(before.events);
});
