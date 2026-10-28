import { test, expect, type Page } from '@playwright/test';
import { createProject, addCard, rate } from './helpers';
const original = '蓝晶协议要求先校验来源。\n再记录版本。\n例如，可以保留副本。';
async function material(page: Page) {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'fictional-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(original),
  });
  await page.getByLabel('我已核对警告，确认要保存的内容').check();
  await page.getByRole('button', { name: '仅保存资料', exact: true }).click();
  await page.getByRole('link', { name: 'AI 辅助整理', exact: true }).click();
  await expect(page.getByRole('heading', { name: /AI 辅助整理/ })).toBeVisible();
}
async function mock(page: Page) {
  await page.getByLabel('启用本次 AI 辅助', { exact: true }).check();
  await page.getByLabel('服务类型').selectOption('mock');
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.locator('.ai-candidate')).toHaveCount(1);
}
async function ack(page: Page) {
  await page.getByLabel('我已对照原资料', { exact: false }).check();
  await page.getByLabel('我已检查未覆盖原文', { exact: false }).check();
}
function output(quote = original) {
  return {
    items: [
      {
        question: '蓝晶协议需要完成哪两个步骤？',
        answerSuggestion: '不可替换原文的模型改写。',
        evidenceQuote: quote,
        criteria: [
          { text: '校验来源', quote: '先校验来源。', importance: 'required' },
          { text: '记录版本', quote: '再记录版本。', importance: 'required' },
        ],
        hints: [],
        mnemonic: '模拟建议',
        confusion: '',
        qualityNotes: ['这是待核对的模型意见。'],
      },
    ],
  };
}
async function network(page: Page) {
  await page.getByLabel('启用本次 AI 辅助', { exact: true }).check();
  await page.getByLabel('接口地址').fill('https://models.example.test/v1');
  await page.getByLabel('模型名称').fill('fictional-model');
}

test('AI off stays local; mock candidates require confirmation, preserve edits across navigation and enter FSRS with provenance through backup', async ({
  page,
}) => {
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/chat/completions') || r.url().includes('/api/chat')) requests++;
  });
  await material(page);
  expect(requests).toBe(0);
  await expect(page.getByLabel('启用本次 AI 辅助', { exact: true })).not.toBeChecked();
  await mock(page);
  await expect(page.getByRole('heading', { name: /模拟演示，非真实 AI/ })).toBeVisible();
  await page.getByLabel('候选题干').fill('蓝晶协议的两步要求是什么？');
  await page.getByLabel('选择此候选').check();
  await expect(page.getByRole('button', { name: '确认保存所选候选' })).toBeDisabled();
  const route = page.url();
  await page.getByRole('link', { name: '学习资料', exact: true }).click();
  await page.goto(route);
  await expect(page.getByLabel('候选题干')).toHaveValue('蓝晶协议的两步要求是什么？');
  await expect(page.getByLabel('要点 3 为必需')).not.toBeChecked();
  await ack(page);
  await page.getByRole('button', { name: '确认保存所选候选' }).click();
  await expect(page.getByRole('heading', { name: '已确认保存 1 条' })).toBeVisible();
  await page.getByRole('link', { name: '开始正式复习', exact: true }).click();
  await page.getByRole('button', { name: '开始本次复习（1 题）' }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('先校验来源，再记录版本。');
  await rate(page, true);
  const data = await page.evaluate(async () => {
    const d = '/src/persistence/database.ts',
      b = '/src/persistence/backup.ts';
    const { db } = await import(d);
    const { exportBackup, restoreBackup } = await import(b);
    const before = await exportBackup(db);
    await restoreBackup(db, before);
    const after = await exportBackup(db);
    return { before: before.data, after: after.data };
  });
  expect(data.before.practiceItems[0].standardAnswer).toBe(original);
  expect(data.before.practiceItems[0].aiProvenance.isMock).toBe(true);
  expect(data.before.reviewEvents[0].scheduling.grade).toBe(3);
  expect(data.after.practiceItems).toEqual(data.before.practiceItems);
  expect(data.after.schedulingLogs).toEqual(data.before.schedulingLogs);
  expect(requests).toBe(0);
});

test('external provider requires fresh consent and never persists key; unsupported quote cannot save', async ({
  page,
}) => {
  let count = 0;
  await page.route('https://models.example.test/**', async (route) => {
    count++;
    const body = route.request().postDataJSON();
    expect(body.messages[1].content).toContain(original.replaceAll('\n', '\\n'));
    expect(body).not.toHaveProperty('tools');
    await route.fulfill({
      json: {
        choices: [
          { finish_reason: 'stop', message: { content: JSON.stringify(output('不存在的引用')) } },
        ],
      },
    });
  });
  await material(page);
  await network(page);
  await page.getByLabel('本次密钥').fill('fictional-secret');
  await expect(page.getByRole('button', { name: '生成候选', exact: true })).toBeDisabled();
  expect(count).toBe(0);
  await page.getByLabel('我已查看发送内容', { exact: false }).check();
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.locator('.ai-candidate')).toHaveCount(1);
  expect(count).toBe(1);
  await expect(page.getByText('来源不足：引用不在本次原文范围中', { exact: true })).toBeVisible();
  await page.getByLabel('选择此候选').check();
  await ack(page);
  await page.getByRole('button', { name: '确认保存所选候选' }).click();
  await expect(page.getByRole('alert')).toContainText('来源不足');
  const clean = await page.evaluate(async () => {
    const p = '/src/persistence/database.ts';
    const { db } = await import(p);
    return {
      items: await db.practiceItems.count(),
      storage: JSON.stringify({ ...localStorage, ...sessionStorage }),
      backups: await db.recoveryBackups.toArray(),
    };
  });
  expect(clean.items).toBe(0);
  expect(JSON.stringify(clean)).not.toContain('fictional-secret');
  await page.getByLabel('来源原文（可修正', { exact: false }).fill(original);
  await ack(page);
  await page.getByRole('button', { name: '确认保存所选候选' }).click();
  await expect(page.getByRole('heading', { name: '已确认保存 1 条' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('启用本次 AI 辅助', { exact: true })).not.toBeChecked();
});

test('rubric suggestions leave standard answer intact, allow merge and reset effective state on confirmation', async ({
  page,
}) => {
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await rate(page, true);
  await page.getByRole('link', { name: '返回题库', exact: true }).click();
  const before = await page.evaluate(async () => {
    const p = '/src/persistence/database.ts';
    const { db } = await import(p);
    return (await db.practiceItems.toArray())[0];
  });
  await page.goto(`/#ai/item/${before.id}`);
  await mock(page);
  await expect(page.getByLabel('已有标准答案（保持不变）')).toHaveValue(before.standardAnswer);
  await page.getByRole('button', { name: '添加人工要点' }).click();
  const criteria = page.locator('.ai-criterion');
  await criteria.last().getByLabel('要点内容', { exact: true }).fill('保留原文要求');
  await criteria.last().getByLabel('要点依据', { exact: false }).fill('不查看资料');
  await criteria.last().getByRole('button', { name: '与上项合并' }).click();
  await page.getByLabel('选择此候选').check();
  await ack(page);
  await page.getByRole('button', { name: '确认保存所选候选' }).click();
  await expect(page.getByRole('heading', { name: '已确认保存 1 条' })).toBeVisible();
  const after = await page.evaluate(async (id) => {
    const p = '/src/persistence/database.ts';
    const { db } = await import(p);
    return await db.practiceItems.get(id);
  }, before.id);
  expect(after.standardAnswer).toBe(before.standardAnswer);
  expect(after.learningStateId).not.toBe(before.learningStateId);
  expect(after.aiProvenance.inputRevisionId).toBe(before.currentRevisionId);
  expect(after.answerCriteria).toHaveLength(1);
  await page.getByRole('link', { name: '查看来源与记录' }).click();
  await page.getByText('模拟演示来源（非真实 AI）', { exact: true }).click();
  await expect(
    page.getByText('引用已逐字定位；语义与完整性由用户核对', { exact: false }),
  ).toBeVisible();
});

test('malformed output and unavailable model retain source; cancel produces no confirmed learning data', async ({
  page,
}) => {
  let mode = 'broken';
  await page.route('https://models.example.test/**', async (route) => {
    if (mode === 'broken')
      await route.fulfill({
        json: { choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] },
      });
    else await route.abort('failed');
  });
  await material(page);
  await network(page);
  await page.getByLabel('我已查看发送内容', { exact: false }).check();
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.getByText('模型没有返回有效 JSON', { exact: false })).toBeVisible();
  mode = 'network';
  await page.getByLabel('我已查看发送内容', { exact: false }).check();
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.getByText('无法连接模型服务', { exact: false })).toBeVisible();
  const counts = await page.evaluate(async () => {
    const p = '/src/persistence/database.ts';
    const { db } = await import(p);
    return [
      await db.sourceDocuments.count(),
      await db.practiceItems.count(),
      await db.reviewEvents.count(),
    ];
  });
  expect(counts).toEqual([1, 0, 0]);
});

test('mobile AI preview and editing fit viewport; draft clearing asks before dropping edits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await material(page);
  await mock(page);
  await page.getByLabel('候选题干').fill('保留的中文题干？');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '清空草稿并重新选择' }).click();
  await expect(page.getByLabel('候选题干')).toHaveValue('保留的中文题干？');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '清空草稿并重新选择' }).click();
  await expect(page.locator('.ai-candidate')).toHaveCount(0);
});
