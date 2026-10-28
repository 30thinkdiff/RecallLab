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

test('predefined Chinese CMap is fetched from the application, and corrupt mappings require review', async ({
  page,
}) => {
  const cmaps: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/cmaps/')) cmaps.push(r.url());
  });
  await page.goto('/#import');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(
      fileURLToPath(new URL('../fixtures/import/predefined-cmap.pdf', import.meta.url)),
    );
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(/中文测试规则/);
  expect(cmaps.length).toBeGreaterThan(0);
  expect(cmaps.every((u) => u.startsWith('http://127.0.0.1:5174/pdf-assets/'))).toBe(true);
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(
      fileURLToPath(new URL('../fixtures/import/chinese-corrupt-map.pdf', import.meta.url)),
    );
  await expect(page.getByText(/第 1 页：此页可能有乱码或缺字/)).toBeVisible();
});

test('legacy API and Worker retain Chinese decoding when newer runtime helpers are absent', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Promise, 'try', { value: undefined, writable: true, configurable: true });
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });
  await page.route('**/*pdf.worker*.mjs*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        'Promise.try=undefined;Uint8Array.prototype.toHex=undefined;\n' + (await response.text()),
    });
  });
  await page.goto('/#import');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(fileURLToPath(new URL('../fixtures/import/chinese-cid.pdf', import.meta.url)));
  await expect(page.getByLabel('第 10 页原文', { exact: true })).toHaveValue(/标准答案/);
});

test('a missing PDF page stays failed rather than becoming a scanned or successful page', async ({
  page,
}) => {
  await page.goto('/#import');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(fileURLToPath(new URL('../fixtures/import/missing-page.pdf', import.meta.url)));
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(/readable first page/);
  await expect(page.getByLabel('PDF 页面类型')).toContainText('解析异常页 1');
  await expect(page.getByLabel('内容核查')).toContainText('异常的页面：2');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(
      fileURLToPath(new URL('../fixtures/import/over-page-limit.pdf', import.meta.url)),
    );
  await expect(page.getByRole('alert')).toContainText('最多 200 页');
});

test('basic mobile Chinese PDF import remains readable and cancellable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#import');
  await page
    .getByLabel('选择学习资料')
    .setInputFiles(fileURLToPath(new URL('../fixtures/import/chinese-cid.pdf', import.meta.url)));
  await expect(page.getByRole('heading', { name: '候选题目（69）', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '取消本次导入', exact: true }).click();
  await expect(page.getByRole('heading', { name: /候选题目/ })).toHaveCount(0);
});
