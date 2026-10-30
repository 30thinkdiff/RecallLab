import { test, expect } from '@playwright/test';
test('accepts conservative exact feedback, persists Good without subjective mastery and labels the historical source accurately', async ({
  page,
}) => {
  await page.goto('/#import-task');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'public-exact.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([
        {
          question: '虚构通信协议采用什么标识？',
          standardAnswer: '青晶信号',
          answerCriteria: ['完整标识'],
        },
      ]),
    ),
  });
  await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '目标与自动学习方案' })).toBeVisible();
  await page.getByRole('button', { name: '自动安排并开始学习', exact: true }).click();
  await page.getByRole('textbox', { name: '你的回答', exact: true }).fill('青晶信号');
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await page.getByRole('button', { name: '采用核对反馈并继续', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这一轮，完成了。' })).toBeVisible();
  await expect(page.getByLabel('本次复习结果')).toContainText('Good');
  const rows = await page.evaluate(async () => {
    const { db } = await (import('/src/persistence/database.ts' + '') as Promise<
      typeof import('../../src/persistence/database')
    >);
    return db.reviewEvents.toArray();
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    assessmentSource: 'deterministic',
    subjectiveMastery: null,
    quickFeedback: { checker: 'exact-short-v1', overridden: false },
    scheduling: { grade: 3 },
  });
  await page.goto('/#history');
  await page.locator('.history-entry summary').click();
  await expect(page.getByText('严格文字一致（非语义验证）', { exact: false })).toBeVisible();
  await expect(page.getByText('本页活跃作答', { exact: false })).toBeVisible();
});
