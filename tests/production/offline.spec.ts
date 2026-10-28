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

test('AI candidate edits survive offline fresh-page reopen and stay unconfirmed', async ({
  page,
  context,
}) => {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'public-offline.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('蓝晶资料需要核对原文。修改必须记录原因。'),
  });
  await page.getByLabel('我已核对警告，确认要保存的内容').check();
  await page.getByRole('button', { name: '仅保存资料', exact: true }).click();
  await page.getByRole('link', { name: 'AI 辅助整理', exact: true }).click();
  await page.getByLabel('启用本次 AI 辅助', { exact: true }).check();
  await page.getByLabel('服务类型').selectOption('mock');
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await page.getByLabel('候选题干').fill('离线恢复后如何核对蓝晶资料？');
  await expect(page.getByTestId('ai-draft-status')).toContainText('草稿已保存');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => {}));
  const url = page.url();
  await context.setOffline(true);
  await page.close();
  const next = await context.newPage();
  await next.goto(url);
  await expect(next.getByLabel('候选题干')).toHaveValue('离线恢复后如何核对蓝晶资料？');
  await expect(next.getByLabel('启用本次 AI 辅助', { exact: true })).not.toBeChecked();
  await expect(next.getByRole('heading', { name: /已确认保存/ })).toHaveCount(0);
  await next.getByRole('link', { name: 'AI 整理草稿', exact: true }).click();
  await expect(next.getByRole('link', { name: '继续整理', exact: true })).toBeVisible();
  await context.setOffline(false);
});
