import { test, expect } from '@playwright/test';
import { createProject, addCard } from './helpers';
test('detailed criterion evidence survives pause and refresh, overrides mastery, and remains in history and backup', async ({
  page,
}) => {
  await page.goto('/#projects');
  await createProject(page, '虚构要点核对');
  await addCard(page, 1);
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '开始本次复习（1 题）', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('公开虚构回答：遗漏第二项。');
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await page.getByLabel('核对方式').selectOption('detailed');
  await page.getByLabel('必需要点 1 核对').selectOption('correct');
  await page.getByLabel('必需要点 2 核对').selectOption('omitted');
  await page.getByRole('radio', { name: '4 完全掌握', exact: true }).click();
  await expect(page.getByTestId('draft-status')).toContainText('草稿已保存');
  await page.getByRole('link', { name: '暂停并返回今日复习', exact: true }).click();
  await page.getByRole('button', { name: '继续未完成复习', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('必需要点 2 核对')).toHaveValue('omitted');
  await expect(page.getByRole('radio', { name: '4 完全掌握', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: '保存并完成本轮', exact: true }).click();
  await expect(page.getByLabel('本次复习结果')).toContainText('Again');
  await page.getByRole('link', { name: '查看学习记录', exact: true }).click();
  await page.locator('.history-entry summary').first().click();
  await expect(page.getByLabel('当时的逐项核对')).toContainText('遗漏');
  const stats = await page.evaluate(async () => {
    const p = '/src/persistence/database.ts',
      b = '/src/persistence/backup.ts';
    const { db } = await import(p);
    const { exportBackup, restoreBackup } = await import(b);
    const before = await exportBackup(db);
    await restoreBackup(db, before);
    return { before: before.data.reviewEvents, after: (await exportBackup(db)).data.reviewEvents };
  });
  expect(stats.before).toEqual(stats.after);
  expect(stats.after[0].criterionChecks).toHaveLength(2);
});
test('quality warnings are paged, human acknowledgement is version-bound and never makes a leaking prompt eligible', async ({
  page,
}) => {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'fictional-quality.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([
        { question: '请复述：完整虚构答案用于检查', answer: '完整虚构答案用于检查' },
        { question: '内容是什么？', answer: '公开虚构长答案。'.repeat(60) },
      ]),
    ),
  });
  await page.getByRole('button', { name: '确认导入 2 道题', exact: true }).click();
  await page.getByRole('link', { name: '返回项目题库', exact: true }).click();
  await page.getByRole('link', { name: '题目质量核对', exact: true }).click();
  await expect(
    page.getByText('长答案缺少清晰的必需要点，建议人工补写核对要点', { exact: true }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: '我已对照来源检查此版本', exact: true }).first().check();
  await page.getByRole('button', { name: '保存选中的人工检查记录', exact: true }).click();
  await expect(page.getByText(/1 道已人工检查本版/)).toBeVisible();
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  await expect(page.getByText('待完善题干', { exact: true })).toBeVisible();
  const available = await page.evaluate(async () => {
    const p = '/src/persistence/repository.ts';
    const { repository } = await import(p);
    const project = (await repository.db.projects.toArray())[0];
    return (await repository.available(project.id)).length;
  });
  expect(available).toBe(1);
});
