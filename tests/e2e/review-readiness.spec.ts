import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url));
test('OCR initialization failure preserves native text and declining a reparse keeps candidate edits', async ({
  page,
}) => {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles(fixture('mixed-inline.pdf'));
  await page.route('**/ocr-assets/7/worker.min.js', (r) => r.abort());
  await page.getByRole('button', { name: '在本机识别图片文字（OCR）', exact: true }).click();
  await expect(page.getByLabel('第 1 页原文', { exact: true })).toHaveValue(
    /Fictional Alpha footer/,
  );
  await expect(page.getByText(/第 1 页：本地 OCR 未能完成，已保留原 PDF 文字层/)).toBeVisible();
  await page.getByLabel('第 1 页原文', { exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByLabel('第 1 页原文', { exact: true }).press('Shift');
  await page.getByRole('button', { name: '用选中原文创建问答', exact: true }).click();
  await page.getByLabel('第 1 题问题', { exact: true }).fill('尚未保存的问题');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '在本机识别图片文字（OCR）', exact: true }).click();
  await expect(page.getByLabel('第 1 题问题', { exact: true })).toHaveValue('尚未保存的问题');
});
