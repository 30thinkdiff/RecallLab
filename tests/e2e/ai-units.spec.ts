import { test, expect } from '@playwright/test';
test('unit-first drafting retains source chapters, per-candidate review marks and deferred edits after reload', async ({
  page,
}) => {
  const source =
    '# 来源章节\n蓝晶资料要求保留出处和原文位置。修订时须保留旧版。例如，可用纸质记录。\n\n# 修订章节\n蓝晶修订要求保留旧内容和修改原因。';
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'public-units.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  await page.getByLabel('我已核对警告，确认要保存的内容').check();
  await page.getByRole('button', { name: '仅保存资料', exact: true }).click();
  await page.getByRole('link', { name: 'AI 辅助整理', exact: true }).click();
  let calls = 0;
  await page.route('https://unit-fixture.example/**', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.response_format.json_schema.schema.properties).toHaveProperty('question');
    const data = JSON.parse(body.messages[1].content).document_data as string;
    expect(data.length).toBeLessThan(source.length);
    calls++;
    await route.fulfill({
      json: {
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                question: data.includes('出处')
                  ? '如何记录蓝晶资料来源？'
                  : '如何记录蓝晶资料修订？',
              }),
            },
          },
        ],
      },
    });
  });
  await page.getByLabel('启用本次 AI 辅助', { exact: true }).check();
  await page.getByLabel('引用方式').selectOption('units');
  await page.getByLabel('接口地址').fill('https://unit-fixture.example/v1');
  await page.getByLabel('模型名称').fill('unit-protocol-fixture');
  await page.getByLabel('我已查看发送内容，同意本次发送到上方地址').check();
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.locator('.ai-candidate')).toHaveCount(2);
  expect(calls).toBe(2);
  await expect(page.getByLabel('知识单元核对')).toContainText('规则规划 2');
  const first = page.locator('.ai-candidate').nth(0),
    second = page.locator('.ai-candidate').nth(1);
  await first.getByRole('button', { name: '已核对此条', exact: true }).click();
  await second.locator('summary').first().click();
  await second.getByRole('button', { name: '已核对此条', exact: true }).click();
  await first.getByLabel('候选题干').fill('资料来源需要保留哪些信息？');
  await expect(first).toContainText('本条尚未标记核对');
  await expect(first.getByLabel('标准答案（原文，未由模型改写）')).toHaveValue(/保留出处/u);
  const merges = first.getByRole('button', { name: '与上项合并', exact: true });
  await expect(merges.nth(1)).toBeDisabled();
  await merges.first().click();
  await expect(first.getByLabel('要点内容', { exact: true })).toHaveCount(2);
  await expect(second).toContainText('此版本已由你标记核对');
  await second.getByRole('button', { name: '暂不制卡', exact: true }).click();
  await expect(page.getByTestId('ai-draft-status')).toContainText('草稿已保存');
  await page.reload();
  await page.getByLabel('审阅范围').selectOption('deferred');
  await expect(page.locator('.ai-candidate')).toHaveCount(1);
  await page.locator('.ai-candidate summary').first().click();
  await expect(page.getByLabel('候选题干')).toHaveValue('如何记录蓝晶资料修订？');
  await expect(page.getByLabel('选择此候选')).toBeDisabled();
  await page
    .getByLabel('知识单元核对')
    .getByText('查看章节、遗漏及暂不制卡', { exact: true })
    .click();
  await page.getByRole('button', { name: '恢复此单元核对', exact: true }).click();
  await expect(page.getByLabel('知识单元核对')).toContainText('0 个暂不制卡');
  await page.getByLabel('审阅范围').selectOption('unreviewed');
  await expect(page.getByLabel('候选题干')).toHaveValue('资料来源需要保留哪些信息？');
  const integrity = await page.evaluate(async () => {
    const p = '/src/persistence/database.ts';
    const { db } = await import(p);
    return {
      cards: await db.practiceItems.count(),
      drafts: await db.aiDrafts.count(),
      version: db.verno,
    };
  });
  expect(integrity).toEqual({ cards: 0, drafts: 1, version: 8 });
});
