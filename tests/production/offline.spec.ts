import { test, expect } from '@playwright/test';
import { createProject, addCard } from '../e2e/helpers';
test('built app reopens offline in a fresh page and preserves independent answer drafts', async ({
  page,
  context,
}) => {
  await page.goto('/#projects');
  await createProject(page, '公开虚构离线学习');
  await addCard(page, 1);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '开始本次复习（1 题）', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('公开虚构离线前草稿');
  await expect(page.getByTestId('draft-status')).toContainText('草稿已保存');
  const url = page.url();
  await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByLabel('你的回答')).toHaveValue('公开虚构离线前草稿');
  await reopened.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await reopened.getByLabel('核对方式').selectOption('detailed');
  await reopened.getByLabel('必需要点 1 核对').selectOption('correct');
  await reopened.getByLabel('必需要点 2 核对').selectOption('correct');
  await reopened.getByRole('radio', { name: '3 基本掌握', exact: true }).click();
  await reopened.getByRole('button', { name: '保存并完成本轮', exact: true }).click();
  await expect(reopened.getByLabel('本次复习结果')).toContainText('Good');
  await context.setOffline(false);
});
