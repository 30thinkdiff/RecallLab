import { test, expect } from '@playwright/test';
import { createProject, addCard } from './helpers';

test('ten-card study round preserves distinct evidence, resumes and survives refresh', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await createProject(page);
  for (let index = 1; index <= 10; index++) await addCard(page, index);
  await page.getByRole('button', { name: '开始学习' }).click();
  await expect(page.getByRole('heading', { name: '先回忆，再看答案。' })).toBeVisible();
  // The answer must not be present in the DOM before reveal.
  await expect(
    page.getByText('答案 1：不查看资料，主动从记忆中提取知识。', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('尝试独立从记忆中提取');
  await page.getByLabel('揭晓前的信心').selectOption('3');
  await page.getByRole('button', { name: /查看提示/ }).click();
  await expect(page.getByText('先不要看资料', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('你的回答')).toHaveValue('尝试独立从记忆中提取');
  await expect(page.getByText('先不要看资料', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '揭晓答案' }).click();
  await expect(page.getByRole('button', { name: '保存并下一题' })).toBeDisabled();
  await page.getByLabel('自行核对结果').selectOption('partially_correct');
  await page.getByRole('radio', { name: '4 完全掌握' }).click();
  await page.getByRole('button', { name: '保存并下一题' }).click();
  await expect(page.getByText('第 2 / 10 题', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '跳过此题' }).click();
  await expect(page.getByText('第 3 / 10 题', { exact: true })).toBeVisible();
  // Direct reveal must stay distinct from independent recall.
  await page.getByRole('button', { name: '快速回忆', exact: true }).click();
  await page.getByRole('button', { name: '揭晓答案' }).click();
  await page.getByRole('radio', { name: '1 只有印象' }).click();
  await page.getByRole('button', { name: '保存并下一题' }).click();
  for (let index = 4; index <= 10; index++) {
    await expect(page.getByText(`第 ${index} / 10 题`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '我已尝试回忆' }).click();
    await page.getByRole('button', { name: '揭晓答案' }).click();
    await page.getByLabel('自行核对结果').selectOption('correct');
    await page.getByRole('radio', { name: '3 基本掌握' }).click();
    await page
      .getByRole('button', { name: index === 10 ? '保存并完成本轮' : '保存并下一题' })
      .click();
  }
  await expect(page.getByRole('heading', { name: '这一轮，完成了。' })).toBeVisible();
  await expect(page.getByText('完成 9 题，跳过 1 题。学习记录已保存在本地。')).toBeVisible();
  await page.getByRole('link', { name: '查看学习记录', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(10);
  const first = page.locator('.history-entry').filter({ hasText: '第 1 题：什么是主动回忆？' });
  await first.locator('summary').click();
  await expect(first).toContainText('部分正确');
  await expect(first).toContainText('自评 4 · 完全掌握');
  await expect(first).toContainText('无提示回忆尝试：否');
  await expect(first).toContainText('尝试独立从记忆中提取');
  const third = page.locator('.history-entry').filter({ hasText: '第 3 题：什么是主动回忆？' });
  await third.locator('summary').click();
  await expect(third).toContainText('无提示回忆尝试：否');
  await page.reload();
  await expect(page.locator('.history-entry')).toHaveCount(10);
  await page.getByRole('link', { name: '学习概览', exact: true }).click();
  await expect(page.locator('.stat-card').filter({ hasText: '已学习题目' })).toContainText('9');
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('project and card CRUD, cancellation, project isolation and historical answer snapshots', async ({
  page,
}) => {
  await page.goto('/');
  await createProject(page, '第一项目');
  await addCard(page, 1);
  await page.getByRole('button', { name: '开始学习' }).click();
  await page.getByRole('button', { name: '揭晓答案' }).click();
  await page.getByRole('radio', { name: '0 完全不会' }).click();
  await page.getByRole('button', { name: '保存并完成本轮' }).click();
  await page.getByRole('link', { name: '返回题库', exact: true }).click();
  await page.getByRole('button', { name: '编辑题目：第 1 题：什么是主动回忆？' }).click();
  await page.getByLabel('标准答案').fill('修改后的标准答案');
  await page.getByLabel('修改原因').fill('更正测试资料');
  await page.getByRole('button', { name: '保存题目' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: '学习记录', exact: true }).click();
  await page.locator('.history-entry summary').click();
  await expect(page.locator('.history-details')).toContainText(
    '答案 1：不查看资料，主动从记忆中提取知识。',
  );
  await expect(page.locator('.history-details')).not.toContainText('修改后的标准答案');
  await page.getByRole('link', { name: '学习项目', exact: true }).click();
  await createProject(page, '第二项目');
  await expect(page.getByRole('button', { name: '开始学习' })).toBeDisabled();
  await expect(page.locator('.library-card')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑项目' }).click();
  await page.getByLabel('项目名称').fill('第二项目改名');
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByRole('heading', { name: '第二项目改名', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('heading', { name: '第二项目改名', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('heading', { name: '学习项目', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '第二项目改名', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: /第一项目/ }).click();
  await page.getByRole('button', { name: '删除题目：第 1 题：什么是主动回忆？' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(0);
  await page.getByRole('link', { name: '学习记录', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(1);
});

test('a real browser restart retains projects, cards and learning records on disk', async ({
  playwright,
}, testInfo) => {
  const profile = testInfo.outputPath('browser-profile');
  let context = await playwright.chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
  });
  try {
    let page = await context.newPage();
    await page.goto('http://127.0.0.1:5174');
    await createProject(page, '重启浏览器验证');
    await addCard(page, 1);
    await page.getByRole('button', { name: '开始学习' }).click();
    await page.getByRole('button', { name: '揭晓答案' }).click();
    await page.getByRole('radio', { name: '2 会一部分' }).click();
    await page.getByRole('button', { name: '保存并完成本轮' }).click();
    await expect(page.getByRole('heading', { name: '这一轮，完成了。' })).toBeVisible();
    await context.close();
    context = await playwright.chromium.launchPersistentContext(profile, {
      headless: true,
      channel: 'chromium',
    });
    page = await context.newPage();
    await page.goto('http://127.0.0.1:5174/#projects');
    await expect(page.getByRole('heading', { name: '重启浏览器验证', exact: true })).toBeVisible();
    await page.getByRole('link', { name: /重启浏览器验证/ }).click();
    await expect(page.locator('.library-card')).toHaveCount(1);
    await page.getByRole('link', { name: '学习记录', exact: true }).click();
    await expect(page.locator('.history-entry')).toHaveCount(1);
    await expect(page.locator('.history-entry')).toContainText('自评 2 · 会一部分');
  } finally {
    await context.close();
  }
});

test('mobile workspace remains usable and has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await createProject(page, '手机上的复习');
  await addCard(page, 1);
  await page.getByRole('button', { name: '开始学习' }).click();
  await page.getByRole('button', { name: '揭晓答案' }).click();
  await page.getByRole('radio', { name: '3 基本掌握' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/study-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '保存并完成本轮' }).click();
  await expect(page.getByRole('heading', { name: '这一轮，完成了。' })).toBeVisible();
});
