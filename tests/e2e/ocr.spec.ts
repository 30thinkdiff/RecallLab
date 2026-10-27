import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url));
test('local Chinese multi-page OCR is explicit, reviewable, editable and never uploads material', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const external: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:5174/'))
      external.push(r.url());
  });
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('chinese-scanned.pdf'));
  await expect(page.getByLabel('PDF 页面类型')).toContainText('图片页 2');
  await expect(page.getByRole('button', { name: '仅保存资料', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '在本机识别图片文字（OCR）', exact: true }).click();
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(/虚构|学习|资料/, {
    timeout: 120000,
  });
  await expect(page.getByLabel('第 2 页原文', { exact: true })).toHaveValue(/后续|标准|答案/);
  await expect(page.getByText(/本页文字来自 OCR，尚未验证/).first()).toBeVisible();
  await page.getByText('查看第 1 页图像，对照 OCR', { exact: true }).click();
  await expect(page.getByRole('img', { name: '第 1 页识别前的图像', exact: true })).toBeVisible();
  // OCR never claims a verified answer. Editing a candidate leaves the OCR quote unchanged.
  const firstAnswer = page.getByLabel('第 1 题答案', { exact: true });
  await expect(firstAnswer).toBeVisible();
  await firstAnswer.fill('人工核对后的虚构答案。');
  const confirm = page.getByRole('button', { name: /^确认导入 \d+ 道题$/ });
  await expect(confirm).toBeDisabled();
  await page.getByRole('checkbox', { name: '我已核对警告，确认要保存的内容', exact: true }).check();
  await confirm.click();
  await expect(page.getByRole('heading', { name: '导入完成', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看资料与来源', exact: true }).click();
  await expect(page.getByLabel('第 1 页原文', { exact: true })).not.toHaveValue(/人工核对后的/);
  await page.getByRole('link', { name: '备份与恢复', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出完整备份', exact: true }).click(),
  ]);
  const path = testInfo.outputPath('fictional-ocr-backup.json');
  await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, 'utf8'));
  expect(
    backup.data.sourceDocuments[0].pages.every((p: { method: string }) => p.method === 'ocr'),
  ).toBe(true);
  expect(backup.data.sourceDocuments[0].pages[0].confidence).toBeGreaterThanOrEqual(0);
  await page.getByLabel('选择 JSON 备份').setInputFiles(path);
  await page.getByRole('checkbox', { name: '我确认以此备份替换当前数据', exact: true }).check();
  await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('恢复成功');
  expect(external).toEqual([]);
});
test('cancelling OCR stops the import and leaves no document or late preview', async ({ page }) => {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('chinese-scanned.pdf'));
  await page.getByRole('button', { name: '在本机识别图片文字（OCR）', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/OCR/);
  await page.getByRole('button', { name: '取消本次导入', exact: true }).click();
  await expect(page.getByRole('heading', { name: /候选题目/ })).toHaveCount(0);
  await page.getByRole('link', { name: '学习资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有学习资料', exact: true })).toBeVisible();
});
for (const [name, pattern] of [
  ['blank.pdf', /空白文档/],
  ['encrypted.pdf', /已加密/],
  ['broken.pdf', /文字提取失败/],
] as const) {
  test(`${name} has its own actionable diagnosis`, async ({ page }) => {
    await page.goto('/#import');
    await page.getByLabel('选择学习资料').setInputFiles(fixture(name));
    await expect(page.getByRole('alert')).toContainText(pattern);
  });
}

test('blurred scan remains explicitly uncertain and oversized PDF is rejected before parsing', async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('blurred-scan.pdf'));
  await page.getByRole('button', { name: '在本机识别图片文字（OCR）', exact: true }).click();
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toBeVisible({ timeout: 120000 });
  await expect(page.getByText(/OCR.*尚未验证|OCR 没有识别出文字/).first()).toBeVisible();
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'oversized.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole('alert')).toContainText('20 MB');
});

test('English OCR and mixed-page OCR keep native text evidence separate', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('english-scanned.pdf'));
  await page.getByRole('button', { name: '在本机识别图片文字（OCR）', exact: true }).click();
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(
    /Alpha source paragraph/i,
    { timeout: 120000 },
  );
  await page.getByLabel('选择学习资料').setInputFiles(fixture('mixed-inline.pdf'));
  await expect(page.getByLabel('PDF 页面类型')).toContainText('图文混合页 1');
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(
    /Fictional Alpha footer/,
  );
  await page.getByRole('button', { name: '在本机识别图片文字（OCR）', exact: true }).click();
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(/虚构|学习|资料/, {
    timeout: 120000,
  });
  await page.getByText('查看原 PDF 文字层（未被 OCR 覆盖）', { exact: true }).click();
  await expect(page.getByText('Fictional Alpha footer.', { exact: true })).toBeVisible();
});
