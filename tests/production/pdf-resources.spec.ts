import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url));
test('built application serves Chinese CMaps and the matching Worker locally', async ({ page }) => {
  const cmapStatuses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/cmaps/')) cmapStatuses.push(r.status());
  });
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('predefined-cmap.pdf'));
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(/中文测试规则/);
  expect(cmapStatuses.length).toBeGreaterThan(0);
  expect(cmapStatuses.every((s) => s === 200)).toBe(true);
});
test('built application loads OCR models and WASM without CDN or uploaded material', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:5175/'))
      external.push(r.url());
  });
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('chinese-scanned.pdf'));
  await page.getByRole('button', { name: '在本机识别图片文字（OCR）', exact: true }).click();
  await expect(page.getByLabel('第 2 页原文', { exact: true })).toHaveValue(/答案|标准|后续/, {
    timeout: 90000,
  });
  expect(external).toEqual([]);
});
