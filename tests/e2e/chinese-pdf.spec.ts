import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { rate } from './helpers';
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url));
test('fictional embedded CID/ToUnicode Chinese bank supports chapters, batch import, learning, cross-page sources and backup', async ({
  page,
}, testInfo) => {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('chinese-cid.pdf'));
  await expect(page.getByRole('heading', { name: '候选题目（69）', exact: true })).toBeVisible();
  await expect(page.getByLabel('内容核查')).toContainText('6 个章节');
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(/虚构学习资料/);
  await expect(page.getByLabel('第 10 页原文', { exact: true })).toHaveValue(/标准答案/);
  await page.getByRole('checkbox', { name: '我已核对警告，确认要保存的内容', exact: true }).check();
  await page.getByRole('button', { name: '确认导入 69 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始学习（加入本轮新题）', exact: true }).click();
  await rate(page, false);
  await page.getByRole('link', { name: '学习资料', exact: true }).click();
  await page.getByRole('link', { name: /chinese-cid.pdf/ }).click();
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(/虚构学习资料/);
  await page.getByRole('link', { name: '备份与恢复', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出完整备份', exact: true }).click(),
  ]);
  const path = testInfo.outputPath('fictional-chinese-backup.json');
  await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, 'utf8'));
  expect(backup.data.practiceItems).toHaveLength(69);
  expect(backup.data.sourceDocuments[0].sections).toHaveLength(6);
  expect(
    backup.data.practiceItems.some((c: { sourceReferences: { endPage?: number }[] }) =>
      c.sourceReferences.some((r) => r.endPage),
    ),
  ).toBe(true);
  await page.getByLabel('选择 JSON 备份').setInputFiles(path);
  await page.getByRole('checkbox', { name: '我确认以此备份替换当前数据', exact: true }).check();
  await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('恢复成功');
});
test('cross-page Chinese answer retains continuation, excludes footer and has an actual page range', async ({
  page,
}) => {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('chinese-cross-page.pdf'));
  await expect(page.getByRole('heading', { name: '候选题目（3）', exact: true })).toBeVisible();
  await expect(page.getByLabel('第 1 题答案', { exact: true })).toHaveValue(/后续内容丙/);
  await expect(page.getByLabel('第 1 题答案', { exact: true })).not.toHaveValue(/\n1\n/);
  await expect(
    page.getByText('chinese-cross-page.pdf · 第 1–2 页', { exact: true }).first(),
  ).toBeVisible();
});
