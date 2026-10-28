import { test, expect, type Page } from '@playwright/test';
const source = '蓝晶协议需要先核对来源。\n所有修改必须记录原因。';
async function createDraft(page: Page) {
  await page.goto('/#import');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'fictional-draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(source),
  });
  await page.getByLabel('我已核对警告，确认要保存的内容').check();
  await page.getByRole('button', { name: '仅保存资料', exact: true }).click();
  await page.getByRole('link', { name: 'AI 辅助整理', exact: true }).click();
  await page.getByLabel('启用本次 AI 辅助', { exact: true }).check();
  await page.getByLabel('服务类型').selectOption('mock');
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.locator('.ai-candidate')).toHaveCount(1);
  await saved(page);
  return page.url();
}
async function saved(page: Page) {
  await expect(page.getByText('草稿已保存，可刷新或关闭页面', { exact: true })).toBeVisible();
}
test('refresh preserves edited question, criteria, source and task; confirmation removes completed candidates without revisiting them', async ({
  page,
}) => {
  await createDraft(page);
  await page.getByLabel('候选题干').fill('刷新后继续核对的题干🙂？');
  await page.getByLabel('要点内容', { exact: true }).first().fill('人工修改的要点');
  await saved(page);
  await page.reload();
  await expect(page.getByLabel('候选题干')).toHaveValue('刷新后继续核对的题干🙂？');
  await expect(page.getByLabel('要点内容', { exact: true }).first()).toHaveValue('人工修改的要点');
  await expect(page.getByLabel('启用本次 AI 辅助', { exact: true })).not.toBeChecked();
  await page.getByLabel('选择此候选').check();
  await page.getByLabel('我已对照原资料', { exact: false }).check();
  await page.getByLabel('我已检查未覆盖原文', { exact: false }).check();
  await page.getByRole('button', { name: '确认保存所选候选' }).click();
  await expect(page.getByRole('heading', { name: '已确认保存 1 条' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.ai-candidate')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '已确认保存 1 条' })).toBeVisible();
  const counts = await page.evaluate(async () => {
    const p = '/src/persistence/database.ts';
    const { db } = await import(p);
    return [await db.practiceItems.count(), await db.aiDrafts.count()];
  });
  expect(counts).toEqual([1, 1]);
});
test('two tabs cannot silently overwrite the same draft and can explicitly reload latest saved edits', async ({
  page,
  context,
}) => {
  const url = await createDraft(page);
  const peer = await context.newPage();
  await peer.goto(url);
  await expect(peer.getByLabel('候选题干')).toBeVisible();
  await page.getByLabel('候选题干').fill('甲页已保存的新版题干？');
  await saved(page);
  await expect(peer.getByRole('alert')).toContainText('另一标签页');
  await expect(peer.getByLabel('候选题干')).not.toHaveValue('甲页已保存的新版题干？');
  peer.once('dialog', (d) => d.accept());
  await peer.getByRole('button', { name: '载入最新草稿' }).click();
  await expect(peer.getByLabel('候选题干')).toHaveValue('甲页已保存的新版题干？');
  await expect(peer.getByRole('alert')).toHaveCount(0);
});
test('changed full source makes recovered candidates readonly; edits remain available for export', async ({
  page,
}) => {
  const url = await createDraft(page);
  await page.getByLabel('候选题干').fill('保留旧来源的手工编辑？');
  await saved(page);
  await page.evaluate(async () => {
    const p = '/src/persistence/database.ts';
    const { db } = await import(p);
    const doc = (await db.sourceDocuments.toArray())[0];
    await db.sourceDocuments.update(doc.id, {
      extractedContent: doc.extractedContent + '\n原文背景发生变化。',
    });
  });
  await page.reload();
  await expect(page.getByText('草稿来源已过期，仅可查看和导出', { exact: true })).toBeVisible();
  await expect(page.getByLabel('候选题干')).toHaveValue('保留旧来源的手工编辑？');
  await expect(page.getByLabel('候选题干')).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认保存所选候选' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '导出当前候选草稿' })).toBeEnabled();
  expect(page.url()).toBe(url);
});
test('actual browser restart recovers candidate edits from IndexedDB', async ({
  playwright,
  browserName,
}, testInfo) => {
  const profile = testInfo.outputPath('profile');
  let context = await playwright[browserName].launchPersistentContext(profile, {
    headless: true,
    ...(browserName === 'chromium' ? { channel: 'chromium' } : {}),
    baseURL: 'http://127.0.0.1:5174',
  });
  try {
    let page = await context.newPage();
    const route = await createDraft(page);
    await page.getByLabel('候选题干').fill('重启后仍然保留的候选题？');
    await saved(page);
    await context.close();
    context = await playwright[browserName].launchPersistentContext(profile, {
      headless: true,
      ...(browserName === 'chromium' ? { channel: 'chromium' } : {}),
      baseURL: 'http://127.0.0.1:5174',
    });
    page = await context.newPage();
    await page.goto(route);
    await expect(page.getByLabel('候选题干')).toHaveValue('重启后仍然保留的候选题？');
  } finally {
    await context.close();
  }
});
test('local model status distinguishes a missing model and mock without starting a service', async ({
  page,
}) => {
  await page.route('http://127.0.0.1:8089/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'other-fictional' }] } }),
  );
  await createDraft(page);
  await expect(
    page.getByText('模拟演示，不是 AI，也不需要模型服务。', { exact: true }),
  ).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '清空草稿并重新选择' }).click();
  await page.getByLabel('服务类型').selectOption('compatible');
  await expect(
    page.getByText('服务已连接，但没有找到所选模型。请选择已安装模型；不会自动下载。', {
      exact: true,
    }),
  ).toBeVisible();
});
