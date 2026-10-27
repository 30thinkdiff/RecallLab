import { test, expect } from '@playwright/test';
import { createProject, addCard } from './helpers';

test('H: concurrent tabs either converge on observed updates or explicitly retain conflicting inputs', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await expect(page.getByTestId('draft-status')).toContainText('草稿已保存');
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByLabel('你的回答')).toBeVisible();
  await Promise.all([
    page.getByLabel('你的回答').fill('甲页面的并发答案'),
    second.getByLabel('你的回答').fill('乙页面的并发答案'),
  ]);
  await expect(page.getByTestId('draft-status')).not.toContainText('正在保存');
  await expect(second.getByTestId('draft-status')).not.toContainText('正在保存');
  const conflictA = await page
    .getByRole('heading', { name: '另一页面已更新草稿', exact: true })
    .count();
  const conflictB = await second
    .getByRole('heading', { name: '另一页面已更新草稿', exact: true })
    .count();
  if (conflictA || conflictB) {
    const losing = conflictA ? page : second;
    await expect(losing.getByLabel('本页保留的输入')).toHaveValue(/页面的并发答案/);
    await losing.getByRole('button', { name: '保留本页输入并载入最新草稿', exact: true }).click();
    await expect(
      losing.getByRole('heading', { name: '另一页面已更新草稿', exact: true }),
    ).toHaveCount(0);
  }
  await expect
    .poll(
      async () =>
        (await page.getByLabel('你的回答').inputValue()) ===
        (await second.getByLabel('你的回答').inputValue()),
    )
    .toBe(true);
});

test('I/J: reveal locks both pages, simultaneous submissions create only one event', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  await addCard(page, 2);
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('揭晓前固定的原始回答');
  await expect(page.getByTestId('draft-status')).toContainText('草稿已保存');
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByLabel('你的回答')).toHaveValue('揭晓前固定的原始回答');
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await expect(second.getByRole('combobox', { name: '自行核对结果' })).toBeVisible();
  await expect(second.getByLabel('你的回答')).toHaveCount(0);
  await expect(second.getByText('揭晓前固定的原始回答', { exact: true })).toBeVisible();
  await Promise.all([
    page.getByRole('radio', { name: '3 基本掌握', exact: true }).click(),
    second.getByRole('radio', { name: '3 基本掌握', exact: true }).click(),
  ]);
  // Dispatch both on the same known index before either tab observes advancement.
  await Promise.all([
    page
      .getByRole('button', { name: '保存并下一题', exact: true })
      .evaluate((button: HTMLButtonElement) => button.click()),
    second
      .getByRole('button', { name: '保存并下一题', exact: true })
      .evaluate((button: HTMLButtonElement) => button.click()),
  ]);
  await expect(page.getByText('第 2 / 2 题', { exact: true })).toBeVisible();
  await expect(second.getByText('第 2 / 2 题', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '学习记录', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.locator('.history-entry summary').click();
  await expect(page.locator('.history-details')).toContainText('揭晓前固定的原始回答');
});

test('stale standard-answer editors cannot overwrite a correction made in another tab', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  const second = await context.newPage();
  await second.goto(page.url());
  for (const editor of [page, second]) {
    await editor
      .getByRole('button', { name: '编辑题目：第 1 题：什么是主动回忆？', exact: true })
      .click();
    await editor.getByLabel('修改原因').fill('并发修正测试');
  }
  await page.getByLabel('标准答案').fill('先保存的新答案');
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await second.getByLabel('标准答案').fill('后保存的过期页面答案');
  await second.getByRole('button', { name: '保存题目', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('其他页面修改');
  await expect(second.getByLabel('标准答案')).toHaveValue('后保存的过期页面答案');
  await second.getByRole('button', { name: '取消', exact: true }).click();
  await second.locator('.library-answer summary').click();
  await expect(second.locator('.library-answer')).toContainText('先保存的新答案');
});
