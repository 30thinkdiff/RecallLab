import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
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

test('answer-revealing legacy prompts are held for batch completion before formal review', async ({
  page,
}) => {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'fictional-pending.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([{ question: '请复述：完整虚构标准答案', answer: '完整虚构标准答案' }]),
    ),
  });
  await page.getByRole('button', { name: '确认导入 1 道题', exact: true }).click();
  await page.getByRole('link', { name: '返回项目题库', exact: true }).click();
  await page.getByRole('link', { name: '批量管理待完善题干', exact: true }).click();
  await page.getByRole('textbox', { name: /完善题干 / }).fill('这条虚构规则的要求是什么？');
  await page.getByRole('button', { name: '批量保存已填写题干', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已完善 1 道题');
  await page.getByRole('link', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '开始本次复习（1 题）', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '这条虚构规则的要求是什么？', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /完整虚构标准答案/ })).toHaveCount(0);
});
