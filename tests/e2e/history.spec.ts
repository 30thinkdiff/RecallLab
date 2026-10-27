import { test, expect } from '@playwright/test';
import { restoreFixture } from './helpers';

test('K/L: question detail shows all versions, differences, original answers and isolated current evidence', async ({
  page,
}) => {
  await restoreFixture(page);
  await page.getByRole('link', { name: '学习项目', exact: true }).click();
  await page.getByRole('link', { name: /虚构资料 · 项目甲/ }).click();
  await page.getByRole('link', { name: '虚构协议甲：蓝晶对应哪种颜色？', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '虚构协议甲：蓝晶对应哪种颜色？', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('.evidence-table tr').filter({ hasText: '总练习记录' })).toContainText(
    '3',
  );
  await expect(
    page.locator('.evidence-table tr').filter({ hasText: '总练习记录' }).locator('td').nth(1),
  ).toHaveText('0');
  await expect(page.getByText(/新版需要重新学习。你曾练习旧版内容/)).toBeVisible();
  await expect(page.locator('.history-entry')).toHaveCount(3);
  await expect(page.locator('.revision-entry')).toHaveCount(2);
  await expect(page.locator('.diff-table')).toContainText('旧答案：红色（测试中设定为错误）');
  await expect(page.locator('.diff-table')).toContainText('新版答案：蓝色');
  await page.locator('.history-entry summary').first().click();
  await expect(page.locator('.history-details').first()).toContainText('虚构用户的原始回答');
  await expect(page.locator('.history-details').first()).toContainText('旧答案：红色');
  await expect(page.locator('.history-entry').first()).toContainText('旧版历史 · 不计当前表现');
  await expect(page.locator('.history-entry').first()).toContainText('题目已修订');
  await page.getByLabel('统计范围').selectOption('all');
  await expect(page.getByRole('img', { name: '按日期的实际练习次数', exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: '主观评分离散记录，无趋势拟合', exact: true }),
  ).toBeVisible();
  await page.getByLabel('统计范围').selectOption('current');
  await expect(
    page.getByText('数据不足：当前范围尚无练习记录，不生成趋势。', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/item-history-desktop.png', fullPage: true });
});

test('question details keep current evidence for harmless revisions and expose draft recovery copies', async ({
  page,
  context,
}) => {
  const { createProject, addCard, editCard } = await import('./helpers');
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  const projectUrl = page.url();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('需要保留的旧题作答');
  const editor = await context.newPage();
  await editor.goto(projectUrl);
  await editCard(editor, 1, '修正后的虚构答案');
  await page.getByRole('button', { name: '保留输入并载入最新版', exact: true }).click();
  await editor.getByRole('link', { name: '查看学习历史与版本', exact: true }).click();
  await expect(
    editor.getByRole('heading', { name: '未提交作答与冲突副本', exact: true }),
  ).toBeVisible();
  const recovery = editor.locator('.revision-entry').filter({ hasText: '题目更新前的作答' });
  await recovery.locator('summary').click();
  await expect(recovery).toContainText('需要保留的旧题作答');
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await page.getByRole('radio', { name: '3 基本掌握', exact: true }).click();
  await page.getByRole('button', { name: '保存并完成本轮', exact: true }).click();
  await editor.goto(projectUrl);
  await editCard(editor, 1, '修正后的虚构答案。', 'cosmetic');
  await editor.getByRole('link', { name: '查看学习历史与版本', exact: true }).click();
  await expect(
    editor.locator('.evidence-table tr').filter({ hasText: '总练习记录' }).locator('td').nth(1),
  ).toHaveText('1');
  await expect(editor.locator('.history-entry')).toContainText('适用于当前知识');
});
