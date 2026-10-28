import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { rate } from './helpers';
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url));
async function selectPage(page: Page, number: number) {
  const area = page.getByLabel(`第 ${number} 页原文`, { exact: true });
  await area.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await area.press('Shift');
  const article = page
    .locator('.source-page')
    .filter({ has: page.getByRole('heading', { name: `第 ${number} 页`, exact: true }) });
  await article.getByRole('button', { name: '用选中原文创建问答', exact: true }).click();
}

test('text PDF page selection, source trace, learning, revision and backup round trip are consistent', async ({
  page,
}, testInfo) => {
  const outbound: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:5174')
      outbound.push(url.origin);
  });
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('text-two-pages.pdf'));
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(
    /Alpha source paragraph/,
  );
  await expect(page.getByLabel('第 2 页原文', { exact: true })).toHaveValue(
    /Beta source paragraph on page two/,
  );
  await selectPage(page, 2);
  await page.getByLabel('第 1 题问题', { exact: true }).fill('What is the fictional beta source?');
  await page.getByRole('checkbox', { name: '我已核对警告，确认要保存的内容', exact: true }).check();
  await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始学习（加入本轮新题）', exact: true }).click();
  await rate(page, true);
  await page.getByRole('link', { name: '返回题库', exact: true }).click();
  await page
    .getByRole('button', { name: '编辑题目：What is the fictional beta source?', exact: true })
    .click();
  await page
    .getByLabel('标准答案')
    .fill('A user-corrected explanation, separate from original text.');
  await page.getByLabel('修改原因').fill('Clarify the fictional material');
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: '查看学习历史与版本', exact: true }).click();
  await expect(page.locator('.diff-table')).toContainText('A user-corrected explanation');
  await page.locator('.history-entry summary').click();
  await expect(page.locator('.history-details')).toContainText('Beta source paragraph on page two');
  await expect(page.locator('.history-details')).not.toContainText('A user-corrected explanation');
  await page
    .getByRole('link', { name: 'text-two-pages.pdf · 第 2 页', exact: true })
    .first()
    .click();
  await expect(page.getByLabel('第 2 页原文', { exact: true })).toHaveValue(
    /Beta source paragraph on page two/,
  );
  await expect(page.getByLabel('第 2 页原文', { exact: true })).not.toHaveValue(/user-corrected/);
  await page.getByRole('link', { name: '备份与恢复', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出完整备份', exact: true }).click(),
  ]);
  const path = testInfo.outputPath('pdf-source-backup.json');
  await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, 'utf8')) as {
    data: {
      sourceDocuments: { pages: { number: number }[] }[];
      reviewEvents: { snapshot: { sourceReferences: { page: number }[] } }[];
    };
  };
  expect(backup.data.sourceDocuments[0]?.pages.map((p) => p.number)).toEqual([1, 2]);
  expect(backup.data.reviewEvents[0]?.snapshot.sourceReferences[0]?.page).toBe(2);
  await page.getByLabel('选择 JSON 备份').setInputFiles(path);
  await page.getByRole('checkbox', { name: '我确认以此备份替换当前数据', exact: true }).check();
  await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('恢复成功');
  await page.getByRole('link', { name: '学习资料', exact: true }).click();
  await page.getByRole('link', { name: /text-two-pages.pdf/ }).click();
  await expect(page.getByLabel('第 2 页原文', { exact: true })).toHaveValue(
    /Beta source paragraph on page two/,
  );
  expect(outbound).toEqual([]);
  await page.screenshot({ path: 'test-results/pdf-source-desktop.png', fullPage: true });
});

for (const [filename, pattern] of [
  ['scanned.pdf', /没有 OCR/],
  ['broken.pdf', /PDF 文字提取失败/],
] as const) {
  test(`${filename} cannot be silently imported as extracted text`, async ({ page }) => {
    await page.goto('/#import');
    await page.getByLabel('选择学习资料').setInputFiles(fixture(filename));
    await expect(page.getByRole('alert')).toContainText(pattern);
    await page.getByRole('link', { name: '学习资料', exact: true }).click();
    await expect(page.getByRole('heading', { name: '还没有学习资料', exact: true })).toBeVisible();
  });
}

test('partially textual PDF explicitly reports the missing page and requires review', async ({
  page,
}) => {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('mixed-pages.pdf'));
  await expect(page.getByText(/第 2 页：未提取到文字/)).toBeVisible();
  await selectPage(page, 1);
  await page.getByLabel('第 1 题问题', { exact: true }).fill('Fictional alpha question');
  await expect(page.getByRole('button', { name: '确认导入 1 道题', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '我已核对警告，确认要保存的内容', exact: true }).check();
  await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
});

test('unstructured TXT can be organized manually from actual selected text', async ({ page }) => {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('prose.txt'));
  await expect(page.getByRole('heading', { name: '候选题目（0）', exact: true })).toBeVisible();
  const area = page.getByLabel('资料原文', { exact: true });
  await area.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await area.press('Shift');
  await page.getByRole('button', { name: '用选中原文创建问答', exact: true }).click();
  await page.getByLabel('第 1 题问题', { exact: true }).fill('为这段虚构原文提出的问题');
  await page.getByRole('checkbox', { name: '我已核对警告，确认要保存的内容', exact: true }).check();
  await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
});

test('mobile PDF source selection is usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('text-two-pages.pdf'));
  await expect(page.getByLabel('第 2 页原文', { exact: true })).toBeVisible();
  await selectPage(page, 2);
  await page.getByLabel('第 1 题问题', { exact: true }).fill('Mobile source question');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('checkbox', { name: '我已核对警告，确认要保存的内容', exact: true }).check();
  await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
});
