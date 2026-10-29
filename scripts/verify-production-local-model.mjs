/* global indexedDB, fetch, AbortSignal */
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
if (process.env.RECALLLAB_PRODUCTION_MODEL_TEST !== '1') {
  console.info(
    'Opt-in only: production companion and an already installed model are required. No download or install.',
  );
  process.exit(0);
}
const origin = 'http://127.0.0.1:5173';
const fixture = JSON.parse(await readFile('evaluation/v052/corpus.json', 'utf8')).cases.find(
  (c) => c.id === 'paragraphs',
);
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const backupPath = path.join(os.tmpdir(), `recalllab-v052-public-${randomUUID()}.json`);
const stats = {
  date: '2026-10-29',
  actor: 'AI engineering scripted acceptance, not an actual learner or independent human judge',
  provider: 'real existing local 1.5B, no response mocking/proxy',
  modelCalls: 0,
  externalRequests: 0,
};
async function database(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('RecallLab');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const names = [
      'practiceItems',
      'reviewEvents',
      'memoryStates',
      'schedulingLogs',
      'sourceDocuments',
      'revisions',
      'aiDrafts',
    ];
    const tx = db.transaction(names, 'readonly');
    const values = await Promise.all(
      names.map(
        (n) =>
          new Promise((resolve, reject) => {
            const r = tx.objectStore(n).getAll();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          }),
      ),
    );
    db.close();
    return Object.fromEntries(names.map((n, i) => [n, values[i]]));
  });
}
try {
  const context = await browser.newContext({
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    serviceWorkers: 'block',
  });
  await context.route('**/*', (route) => {
    const u = route.request().url();
    return /^https?:/.test(u) &&
      !u.startsWith(origin + '/') &&
      !u.startsWith('http://127.0.0.1:8089/')
      ? route.abort()
      : route.continue();
  });
  const page = await context.newPage();
  page.on('request', (r) => {
    if (r.url().includes('/v1/chat/completions')) stats.modelCalls++;
    if (/^https?:/.test(r.url()) && !/^http:\/\/127\.0\.0\.1:(5173|8089)\//.test(r.url()))
      stats.externalRequests++;
  });
  await page.goto(origin + '/#import');
  await page.getByLabel('选择学习资料').setInputFiles({
    name: 'public-production-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(fixture.text),
  });
  await page.getByLabel('我已核对警告，确认要保存的内容').check();
  await page.getByRole('button', { name: '仅保存资料', exact: true }).click();
  await page.getByRole('link', { name: 'AI 辅助整理', exact: true }).click();
  await expect(page.getByLabel('本机模型状态')).toContainText('本机启动器已连接');
  const status = await (await fetch(origin + '/local-ai/status')).json();
  const model = status.models.find((m) => m.id === 'qwen15');
  expect(model.installed).toBe(true);
  if (!model.running) {
    await page.getByLabel('同意本次按需启动或停止已安装模型', { exact: false }).check();
    await page.getByRole('button', { name: '按需启动 Qwen2.5 1.5B CPU', exact: true }).click();
  }
  await expect
    .poll(
      async () => {
        try {
          return (
            await fetch('http://127.0.0.1:8089/health', { signal: AbortSignal.timeout(2000) })
          ).ok;
        } catch {
          return false;
        }
      },
      { timeout: 45000 },
    )
    .toBe(true);
  stats.installedModelStartedThroughUi = !model.running;
  stats.modelReusedAlreadyRunning = model.running;
  await page.getByRole('button', { name: '重新检测模型', exact: true }).click();
  await page.getByLabel('启用本次 AI 辅助', { exact: true }).check();
  await page.getByLabel('服务类型').selectOption('compatible');
  await page.getByLabel('接口地址').fill('http://127.0.0.1:8089/v1');
  await page.getByLabel('模型名称').fill('qwen2.5-1.5b-instruct');
  await page.getByLabel('学习目标').selectOption('understanding');
  await page.getByLabel('引用方式').selectOption('units');
  await page.getByLabel('我已查看发送内容，同意本次发送到上方地址').check();
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.locator('.ai-candidate')).toHaveCount(2, { timeout: 110000 });
  stats.originalQuestions = await page
    .getByLabel('候选题干')
    .evaluateAll((nodes) => nodes.map((n) => n.value));
  expect((await database(page)).practiceItems).toHaveLength(0);
  for (const [i, unit] of fixture.units.entries()) {
    const row = page.locator('.ai-candidate').nth(i);
    if (i) await row.locator('summary').first().click();
    await row.getByLabel('候选题干').fill(unit.acceptableQuestions[0]);
    await expect(row.getByLabel('标准答案（原文，未由模型改写）')).toHaveValue(unit.quote);
  }
  await expect(page.getByTestId('ai-draft-status')).toContainText('草稿已保存');
  await page.reload();
  for (const [i, unit] of fixture.units.entries()) {
    const row = page.locator('.ai-candidate').nth(i);
    if (i) await row.locator('summary').first().click();
    await expect(row.getByLabel('候选题干')).toHaveValue(unit.acceptableQuestions[0]);
    await row.getByRole('button', { name: '已核对此条', exact: true }).click();
    await row.getByLabel('选择此候选').check();
  }
  stats.refreshRetainsEdits = true;
  stats.engineeringNormalizedQuestions = 2;
  await page.getByLabel('我已对照原资料', { exact: false }).check();
  await page.getByLabel('我已检查未覆盖原文', { exact: false }).check();
  await page.getByRole('button', { name: '确认保存所选候选', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已确认保存 2 条', exact: true })).toBeVisible();
  const confirmed = await database(page);
  expect(
    confirmed.practiceItems.every(
      (c) =>
        c.aiProvenance && !c.aiProvenance.isMock && c.aiProvenance.inferenceStrategy === 'units',
    ),
  ).toBe(true);
  expect(confirmed.sourceDocuments[0].extractedContent).toBe(fixture.text);
  stats.confirmedCards = confirmed.practiceItems.length;
  stats.sourceLocked = true;
  await page.getByRole('link', { name: '开始正式复习', exact: true }).click();
  await page.getByRole('button', { name: '开始本次复习（2 题）', exact: true }).click();
  await page.getByRole('button', { name: '输入作答', exact: true }).click();
  await page.getByLabel('你的回答').fill('资料保留出处和原文位置；修订保留旧内容和修改原因。');
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await page.getByLabel('自行核对结果', { exact: true }).selectOption('correct');
  await page.getByRole('radio', { name: '3 基本掌握', exact: true }).click();
  await page.getByRole('button', { name: '保存并下一题', exact: true }).click();
  await expect(page.locator('.assessment-footer')).toHaveCount(0);
  const before = await database(page);
  expect(before.reviewEvents).toHaveLength(1);
  expect(before.reviewEvents[0].scheduling.grade).toBe(3);
  stats.formalGrade = 3;
  stats.gradeActor = 'explicit scripted manual check in isolated test database, not model scoring';
  await page.goto(origin + '/#backup');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份', exact: true }).click();
  await (await downloading).saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  expect(backup.databaseVersion).toBe(7);
  expect(JSON.stringify(backup)).not.toContain('"apiKey"');
  await page.getByLabel('选择 JSON 备份').setInputFiles(backupPath);
  await expect(
    page.getByRole('heading', { name: '备份预览 · 数据库 v7', exact: true }),
  ).toBeVisible();
  await page.getByLabel('我确认以此备份替换当前数据').check();
  await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(page.getByText('恢复成功', { exact: false })).toBeVisible();
  const after = await database(page);
  const tables = [
    'practiceItems',
    'reviewEvents',
    'memoryStates',
    'schedulingLogs',
    'sourceDocuments',
    'revisions',
  ];
  for (const table of tables) expect(after[table]).toEqual(before[table]);
  stats.databaseVersion = backup.databaseVersion;
  stats.immutableEvidenceAndMemoryRestoreExact = true;
  stats.apiKeyAbsent = true;
  expect(stats.externalRequests).toBe(0);
  expect(stats.modelCalls).toBe(2);
  await writeFile(
    'evaluation/v052/production-model-statistics.json',
    JSON.stringify(stats, null, 2) + '\n',
  );
  console.info(JSON.stringify(stats));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await unlink(backupPath).catch(() => {});
}
