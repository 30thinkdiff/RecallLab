import { test, expect } from '@playwright/test';
import { createProject, addCard, editCard, rate } from './helpers';

test('A: twenty new cards are opt-in and do not disturb the current answer', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  await addCard(page, 2);
  const projectUrl = page.url();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('当前正在输入的原始回答');
  await expect(page.getByTestId('draft-status')).toContainText('草稿已保存');
  const editor = await context.newPage();
  await editor.goto(projectUrl);
  for (let i = 3; i <= 22; i++) await addCard(editor, i);
  await expect(page.getByText(/题库新增 20 道题/)).toBeVisible();
  await expect(page.getByText('第 1 / 2 题', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下轮再学', exact: true }).click();
  await expect(page.getByText(/已选择下轮再学/)).toBeVisible();
  await page.getByRole('button', { name: '加入本轮剩余练习', exact: true }).click();
  await expect(page.getByText('第 1 / 22 题', { exact: true })).toBeVisible();
  await expect(page.getByLabel('你的回答')).toHaveValue('当前正在输入的原始回答');
});

test('B: refreshing a pending revision keeps the current draft and presents the new answer', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  await addCard(page, 2);
  const projectUrl = page.url();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('第一题草稿');
  const editor = await context.newPage();
  await editor.goto(projectUrl);
  await editCard(editor, 2, '待答题目修正后的标准答案');
  await page.getByRole('button', { name: '更新本轮题目', exact: true }).click();
  await expect(page.getByLabel('你的回答')).toHaveValue('第一题草稿');
  await rate(page);
  await expect(
    page.getByRole('heading', { name: '第 2 题：什么是主动回忆？', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await expect(page.getByText('待答题目修正后的标准答案', { exact: true })).toBeVisible();
});

test('C/D: a current correction blocks old grading, protects input and preserves old evidence', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  const projectUrl = page.url();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await rate(page, true);
  await page.getByRole('link', { name: '返回题库', exact: true }).click();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('针对旧版问题的作答');
  const editor = await context.newPage();
  await editor.goto(projectUrl);
  await editCard(editor, 1, '更正后的可靠答案');
  await expect(page.getByRole('heading', { name: '当前题目已更新', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '揭晓答案', exact: true })).toBeDisabled();
  await expect(page.getByLabel('本页保留的输入')).toHaveValue('针对旧版问题的作答');
  await page.getByRole('button', { name: '保留输入并载入最新版', exact: true }).click();
  await expect(page.getByRole('heading', { name: '当前题目已更新', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('你的回答')).toHaveValue('');
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await expect(page.getByText('更正后的可靠答案', { exact: true })).toBeVisible();
  await editor.reload();
  await expect(
    editor.getByText('新版需要重新学习 · 建议无提示测试', { exact: true }),
  ).toBeVisible();
  await editor.getByRole('link', { name: '学习记录', exact: true }).click();
  await editor.locator('.history-entry summary').click();
  await expect(editor.locator('.history-details')).toContainText(
    '答案 1：不查看资料，主动从记忆中提取知识。',
  );
});

test('E: cosmetic revisions keep current valid progress', async ({ page }) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await rate(page, true);
  await page.getByRole('link', { name: '返回题库', exact: true }).click();
  await editCard(page, 1, '答案 1：不查看资料，主动从记忆中提取知识。\n', 'cosmetic');
  await expect(page.getByText('最近自评：基本掌握', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '学习概览', exact: true }).click();
  await expect(page.locator('.stat-card').filter({ hasText: '已学习题目' })).toContainText('1');
});

test('F/G: archiving pending and current tasks creates no false event; ending retains saved events', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  await addCard(page, 2);
  await addCard(page, 3);
  const projectUrl = page.url();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  const editor = await context.newPage();
  await editor.goto(projectUrl);
  await editor
    .getByRole('button', { name: '删除题目：第 2 题：什么是主动回忆？', exact: true })
    .click();
  await editor.getByRole('button', { name: '确认删除', exact: true }).click();
  await rate(page);
  await expect(
    page.getByRole('heading', { name: '第 3 题：什么是主动回忆？', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('第三题未提交作答');
  await page.getByRole('button', { name: '结束当前轮次', exact: true }).click();
  await page.getByRole('button', { name: '确认结束本轮', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本轮已结束。', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看学习记录', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await editor.getByRole('link', { name: '归档内容', exact: true }).click();
  await expect(
    editor.getByRole('heading', { name: '第 2 题：什么是主动回忆？', exact: true }),
  ).toBeVisible();
  await editor.getByRole('button', { name: '恢复题目', exact: true }).click();
  await expect(
    editor.getByRole('heading', { name: '第 2 题：什么是主动回忆？', exact: true }),
  ).toHaveCount(0);
});
