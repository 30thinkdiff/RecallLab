import { test, expect } from '@playwright/test';
import { createProject, addCard, rate } from './helpers';
import { fileURLToPath } from 'node:url';
test('daily budget settings, typed draft pause/resume and next-day due queue work without resetting history', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-27T09:00:00Z') });
  await page.goto('/#projects');
  await createProject(page, '虚构每日计划');
  await addCard(page, 1);
  await addCard(page, 2);
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '设置学习预算与目标', exact: true }).click();
  await page.getByLabel('每日计划（分钟）').fill('30');
  await page.getByLabel('每日新题上限').fill('2');
  await page.getByLabel('目标日期').fill('2026-11-01');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日复习', exact: true })).toBeVisible();
  await expect(page.getByText(/每天 30 分钟/)).toBeVisible();
  await page.getByLabel('复习范围').selectOption('new');
  await page.getByRole('button', { name: '开始本次复习（2 题）', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('公开虚构回忆内容');
  await expect(page.getByTestId('draft-status')).toContainText('草稿已保存');
  await page.getByRole('link', { name: '暂停并返回今日复习', exact: true }).click();
  await page.getByRole('button', { name: '继续未完成复习', exact: true }).click();
  await expect(page.getByLabel('你的回答')).toHaveValue('公开虚构回忆内容');
  await rate(page, false);
  await page.getByRole('button', { name: '跳过此题', exact: true }).click();
  await page.getByRole('link', { name: '查看今日复习与下次到期', exact: true }).click();
  await expect(page.getByText(/今日已完成练习/)).toBeVisible();
  await page.clock.setSystemTime(new Date('2026-10-28T09:00:00Z'));
  await page.reload();
  await page.getByText('查看预计队列与原因', { exact: true }).click();
  await expect(page.locator('li').filter({ hasText: '今日到期' })).toHaveCount(1);
});
test('exhausted budget offers explicit practice without scheduling and remains usable on mobile', async ({
  page,
}) => {
  await page.goto('/#projects');
  await createProject(page, '虚构两分钟预算');
  await addCard(page, 1);
  await addCard(page, 2);
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '设置学习预算与目标', exact: true }).click();
  await page.getByLabel('每日计划（分钟）').fill('2');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByRole('button', { name: '开始本次复习（1 题）', exact: true }).click();
  await page.getByRole('button', { name: '我已尝试回忆', exact: true }).click();
  await rate(page, true);
  await page.getByRole('link', { name: '查看今日复习与下次到期', exact: true }).click();
  await expect(page.getByText(/今天的预计预算已用完/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '临时加练（不更新 FSRS）', exact: true }).click();
  await page.getByRole('button', { name: '我已尝试回忆', exact: true }).click();
  await rate(page, true);
  await expect(page.getByLabel('本次复习结果')).toContainText('不更新长期记忆状态');
});
test('a confirmed fictional 69-question bank can enter version-bound spaced learning', async ({
  page,
}) => {
  await page.goto('/#import');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(fileURLToPath(new URL('../fixtures/import/bank-69.json', import.meta.url)));
  await page.getByRole('button', { name: '确认导入 69 道题', exact: true }).click();
  await page.getByRole('button', { name: '按计划学习新题（FSRS）', exact: true }).click();
  await expect(page.getByLabel('复习安排说明')).toContainText('新知识');
  await page.getByRole('button', { name: '我已尝试回忆', exact: true }).click();
  await rate(page, false);
  await expect(page.getByLabel('本次复习结果')).toContainText('Good');
});
