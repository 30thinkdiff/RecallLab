import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
test('Chinese Identity-H font pages decode without external font services', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:5174/'))
      external.push(r.url());
  });
  await page.goto('/#import');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(fileURLToPath(new URL('../fixtures/import/chinese-cid.pdf', import.meta.url)));
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(/虚构学习资料/);
  await expect(page.getByLabel('第 10 页原文', { exact: true })).toHaveValue(/标准答案/);
  const pages = page.locator('.source-page textarea');
  expect(await pages.count()).toBe(10);
  for (const area of await pages.all()) expect(await area.inputValue()).not.toContain('\uFFFD');
  expect(external).toEqual([]);
});
