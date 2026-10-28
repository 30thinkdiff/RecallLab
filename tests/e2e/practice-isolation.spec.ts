import { test, expect } from '@playwright/test';
import { createProject, addCard, rate } from './helpers';
test('free practice and scheduled review resume separately and only the latter changes FSRS', async ({
  page,
}) => {
  await page.goto('/#projects');
  await createProject(page, '虚构两种轮次');
  await addCard(page, 1);
  await addCard(page, 2);
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '开始本次复习（2 题）', exact: true }).click();
  await expect(page).toHaveURL(/#study\//);
  const formal = page.url();
  await page.getByRole('link', { name: '返回题库', exact: true }).click();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await expect(page).toHaveURL(/#study\//);
  expect(page.url()).not.toBe(formal);
  await expect(page.getByLabel('复习安排说明')).toHaveCount(0);
  await page.getByRole('button', { name: '我已尝试回忆', exact: true }).click();
  await rate(page);
  const counts = await page.evaluate(async () => {
    const path = '/src/persistence/database.ts';
    const { db } = await import(path);
    const backupPath = '/src/persistence/backup.ts';
    const { exportBackup } = await import(backupPath);
    const backup = await exportBackup(db);
    return {
      events: await db.reviewEvents.count(),
      logs: await db.schedulingLogs.count(),
      active: backup.data.sessions.filter((s: { status: string }) => s.status === 'active').length,
    };
  });
  expect(counts).toEqual({ events: 1, logs: 0, active: 2 });
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '继续未完成复习', exact: true }).click();
  await expect(page).toHaveURL(formal);
  await expect(page.getByLabel('复习安排说明')).toBeVisible();
});
