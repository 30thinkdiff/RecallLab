import { test, expect } from '@playwright/test';
test('risk filters group source, compare duplicates and preserve edits through the draft library and public evaluation', async ({
  page,
}) => {
  const text = '蓝晶协议要求核对来源。所有修改必须记录原因。';
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'public-review.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await page.getByLabel('我已核对警告，确认要保存的内容').check();
  await page.getByRole('button', { name: '仅保存资料', exact: true }).click();
  await page.getByRole('link', { name: 'AI 辅助整理', exact: true }).click();
  const base = {
    question: '蓝晶协议有什么要求？',
    answerSuggestion: '',
    evidenceQuote: text,
    criteria: [],
    hints: [],
    mnemonic: '',
    confusion: '',
    qualityNotes: [],
  };
  await page.route('https://public-model.example/**', (route) =>
    route.fulfill({
      json: {
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                items: [
                  base,
                  { ...base, evidenceQuote: '所有修改必须记录原因。' },
                  { ...base, question: '还有哪些要求？', evidenceQuote: '不存在的原文' },
                ],
              }),
            },
          },
        ],
      },
    }),
  );
  await page.getByLabel('启用本次 AI 辅助', { exact: true }).check();
  await page.getByLabel('接口地址').fill('https://public-model.example/v1');
  await page.getByLabel('模型名称').fill('public-fixture');
  await page.getByLabel('我已查看发送内容，同意本次发送到上方地址', { exact: false }).check();
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.locator('.ai-candidate')).toHaveCount(3);
  await page.getByLabel('审阅范围').selectOption('source');
  await expect(page.locator('.ai-candidate')).toHaveCount(1);
  await page.getByLabel('审阅范围').selectOption('duplicate');
  await expect(page.locator('.ai-candidate')).toHaveCount(2);
  await expect(page.getByText('比较重复题目的答案差异', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '取消选择来源不足及重复候选' }).click();
  await expect(page.getByLabel('选择此候选').first()).not.toBeChecked();
  await page.getByLabel('候选题干').first().fill('修改后如何核对蓝晶协议？');
  await expect(page.getByTestId('ai-draft-status')).toContainText('草稿已保存');
  await page.getByRole('link', { name: 'AI 整理草稿', exact: true }).click();
  await page.getByRole('link', { name: '继续整理', exact: true }).click();
  await page.getByLabel('审阅范围').selectOption('edited');
  await expect(page.getByLabel('候选题干')).toHaveValue('修改后如何核对蓝晶协议？');
  await page.getByRole('link', { name: 'AI 整理草稿', exact: true }).click();
  await page.getByRole('link', { name: '查看真实模型评测与限制' }).click();
  await expect(page.getByRole('heading', { name: '本地模型效果评测' })).toBeVisible();
  await expect(
    page.getByText('程序检查结果；引用存在不等于答案正确', { exact: true }),
  ).toBeVisible();
  await page.getByText('不完整来源', { exact: true }).click();
  await expect(page.getByText('候选答案：是', { exact: true })).toBeVisible();
});
