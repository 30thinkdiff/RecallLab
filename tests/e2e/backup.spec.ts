import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import legacy from '../fixtures/legacy-v1.json' with { type: 'json' };
import { restoreFixture } from './helpers';

async function seedNativeV1(page: Page) {
  await page.goto('/tests/fixtures/blank.html');
  await page.evaluate(async (data) => {
    await new Promise<void>((resolve, reject) => {
      // Dexie schema v1 uses native IndexedDB version 10. Indexes match the released M0/M1 layout.
      const request = indexedDB.open('RecallLab-test', 10);
      request.onupgradeneeded = () => {
        const database = request.result;
        const schema: Record<string, string[]> = {
          projects: ['updatedAt'],
          knowledgeUnits: ['projectId'],
          practiceItems: ['projectId', 'knowledgeUnitId'],
          reviewEvents: [
            'projectId',
            'practiceItemId',
            'sessionId',
            'timestamp',
            '[sessionId+queueIndex]',
          ],
          sessions: ['projectId', 'status', '[projectId+status]'],
        };
        for (const [name, indexes] of Object.entries(schema)) {
          const store = database.createObjectStore(name, { keyPath: 'id' });
          for (const index of indexes)
            store.createIndex(
              index,
              index.startsWith('[') ? index.slice(1, -1).split('+') : index,
              { unique: index === '[sessionId+queueIndex]' },
            );
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction(Object.keys(data), 'readwrite');
        for (const [name, rows] of Object.entries(data))
          for (const row of rows) tx.objectStore(name).put(row);
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onabort = () => {
          database.close();
          reject(tx.error);
        };
      };
    });
  }, legacy.data);
}

test('M: actual v1 browser database downloads a pre-upgrade backup and preserves old records on upgrade', async ({
  page,
}, testInfo) => {
  await seedNativeV1(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '先备份，再升级学习数据', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '已保存备份，升级并继续', exact: true }),
  ).toBeDisabled();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载升级前备份', exact: true }).click(),
  ]);
  const file = testInfo.outputPath('pre-upgrade.json');
  await download.saveAs(file);
  const backup = JSON.parse(await readFile(file, 'utf8')) as typeof legacy;
  expect(backup.databaseVersion).toBe(1);
  expect(backup.data.reviewEvents.map((event) => event.id).sort()).toEqual(
    legacy.data.reviewEvents.map((event) => event.id).sort(),
  );
  await page.getByRole('button', { name: '已保存备份，升级并继续', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '让每一次回忆，都有收获。', exact: true }),
  ).toBeVisible();
  await page.goto('/#item/q-crystal');
  await expect(page.locator('.history-entry')).toHaveCount(3);
  await expect(page.locator('.revision-entry')).toHaveCount(2);
  await page.goto('/#study/s-active');
  await expect(page.getByLabel('你的回答')).toHaveValue('尚未完成的虚构长答案草稿');
  await page.getByRole('link', { name: '备份与恢复', exact: true }).click();
  await expect(page.locator('.recovery-row')).toHaveCount(5);
  await expect(page.locator('.recovery-row').first()).toContainText('升级前');
});

test('N: backup restore and a real browser restart retain revision links and historical evidence', async ({
  playwright,
  browserName,
}, testInfo) => {
  const profile = testInfo.outputPath('profile');
  let context = await playwright[browserName].launchPersistentContext(profile, {
    headless: true,
    ...(browserName === 'chromium' ? { channel: 'chromium' } : {}),
    baseURL: 'http://127.0.0.1:5174',
    timezoneId: 'Asia/Shanghai',
  });
  try {
    let page = await context.newPage();
    await page.clock.install({ time: new Date('2026-10-27T08:00:00.000Z') });
    await restoreFixture(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出完整备份', exact: true }).click(),
    ]);
    const file = testInfo.outputPath('full-backup.json');
    await download.saveAs(file);
    const exported = JSON.parse(await readFile(file, 'utf8')) as {
      databaseVersion: number;
      data: { reviewEvents: unknown[]; revisions: unknown[]; sessions: unknown[] };
    };
    expect(exported.databaseVersion).toBe(6);
    expect(exported.data.reviewEvents).toHaveLength(4);
    expect(exported.data.revisions).toHaveLength(6);
    await page.getByLabel('选择 JSON 备份').setInputFiles(file);
    await page.getByRole('checkbox', { name: '我确认以此备份替换当前数据', exact: true }).check();
    await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('恢复成功');
    await context.close();
    context = await playwright[browserName].launchPersistentContext(profile, {
      headless: true,
      ...(browserName === 'chromium' ? { channel: 'chromium' } : {}),
      baseURL: 'http://127.0.0.1:5174',
      timezoneId: 'Asia/Shanghai',
    });
    page = await context.newPage();
    await page.goto('/#item/q-crystal');
    await expect(page.locator('.history-entry')).toHaveCount(3);
    await expect(page.locator('.revision-entry')).toHaveCount(2);
    await expect(page.locator('.diff-table')).toContainText('新版答案：蓝色');
    await expect(
      page.locator('.evidence-table tr').filter({ hasText: '总练习记录' }).locator('td').nth(1),
    ).toHaveText('0');
    await page.goto('/#study/s-active');
    await expect(page.getByLabel('你的回答')).toHaveValue('尚未完成的虚构长答案草稿');
  } finally {
    await context.close();
  }
});

test('invalid backup is rejected before replacement and an archived current task cannot be graded', async ({
  page,
  context,
}) => {
  const { createProject, addCard } = await import('./helpers');
  await page.goto('/');
  await createProject(page);
  await addCard(page, 1);
  await addCard(page, 2);
  const projectUrl = page.url();
  await page.getByRole('link', { name: '备份与恢复', exact: true }).click();
  await page.getByLabel('选择 JSON 备份').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...legacy, data: { ...legacy.data, reviewEvents: [] } })),
  });
  await expect(page.getByRole('alert')).toContainText('缺少学习事件');
  await expect(page.getByRole('button', { name: '确认恢复备份', exact: true })).toHaveCount(0);
  await page.goto(projectUrl);
  await expect(page.locator('.library-card')).toHaveCount(2);
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.getByRole('button', { name: '揭晓答案', exact: true }).click();
  await page.getByRole('radio', { name: '3 基本掌握', exact: true }).click();
  const editor = await context.newPage();
  await editor.goto(projectUrl);
  await editor
    .getByRole('button', { name: '删除题目：第 1 题：什么是主动回忆？', exact: true })
    .click();
  await editor.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('heading', { name: '当前题目已归档', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存并下一题', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保留输入并移除归档题', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '第 2 题：什么是主动回忆？', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '学习记录', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(0);
});

test('a late read of a previously selected backup cannot replace the latest validated file', async ({
  page,
}) => {
  await page.goto('/#backup');
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function (this: File) {
      if (this.name === 'slow-old.json')
        return new Promise<string>((resolve) => {
          Object.assign(window, {
            releaseSlowBackup: () => {
              void original.call(this).then(resolve);
            },
          });
        });
      return original.call(this);
    };
  });
  await page.getByLabel('选择 JSON 备份').setInputFiles({
    name: 'slow-old.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...legacy, formatVersion: 999 })),
  });
  await page.getByLabel('选择 JSON 备份').setInputFiles({
    name: 'latest-valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await expect(
    page.getByRole('heading', { name: '备份预览 · 数据库 v1', exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { releaseSlowBackup: () => void }).releaseSlowBackup(),
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.restore-preview')).toContainText('latest-valid.json');
});

test('v4 upgrade first downloads a backup, preserves formal scheduling byte-for-byte and rejects a native v4 open request', async ({
  page,
}, testInfo) => {
  await page.goto('/tests/fixtures/blank.html');
  const before = await page.evaluate(async () => {
    const d = '/src/persistence/database.ts',
      r = '/src/persistence/repository.ts',
      b = '/src/persistence/backup.ts',
      s = '/src/scheduling/service.ts',
      v = '/src/domain/revisions.ts';
    const { db } = await import(d),
      { repository } = await import(r),
      { exportBackup } = await import(b),
      { ScheduleService } = await import(s),
      { tokenOf } = await import(v);
    const pid = await repository.saveProject({
      name: '虚构 v4 学习资料',
      description: '',
      learningGoal: '',
      targetDate: '',
      dailyTimeBudget: 30,
    });
    await repository.saveCard(pid, {
      question: '蓝晶协议要求什么？',
      standardAnswer: '核对来源，并保留版本。',
      hints: '',
      answerCriteria: '',
      mnemonics: '',
      confusionWarnings: '',
      sourceLabel: '虚构资料',
    });
    const sid = await new ScheduleService(db).start(pid);
    let session = await db.sessions.get(sid);
    session = await repository.updateDraft(
      sid,
      0,
      { responseMode: 'typed', userResponse: '核对来源，并保留版本。' },
      tokenOf(session),
    );
    session = await repository.updateDraft(sid, 0, {}, tokenOf(session), 'reveal');
    await repository.submitReview(sid, 0, 'correct', 4, tokenOf(session));
    const backup = await exportBackup(db),
      name = db.name;
    const schema = db.tables
      .filter((t: import('dexie').Table) => t.name !== 'aiDrafts')
      .map((t: import('dexie').Table) => ({
        name: t.name,
        key: t.schema.primKey.keyPath,
        indexes: t.schema.indexes.map((i: import('dexie').IndexSpec) => ({
          name: i.name,
          key: i.keyPath,
          unique: i.unique,
          multi: i.multi,
        })),
      }));
    db.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 40);
      req.onupgradeneeded = () => {
        for (const table of schema) {
          const store = req.result.createObjectStore(table.name, { keyPath: table.key });
          for (const index of table.indexes)
            store.createIndex(index.name, index.key, {
              unique: index.unique,
              multiEntry: index.multi,
            });
        }
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const native = req.result;
        const tx = native.transaction(
          Object.keys(backup.data).filter((k) => k !== 'aiDrafts'),
          'readwrite',
        );
        for (const [table, rows] of Object.entries(backup.data).filter(
          ([table]) => table !== 'aiDrafts',
        ))
          for (const row of rows as { id: string }[]) tx.objectStore(table).add(row);
        tx.oncomplete = () => {
          native.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    return backup.data;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '先备份，再升级学习数据' })).toBeVisible();
  await expect(page.getByRole('button', { name: '已保存备份，升级并继续' })).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载升级前备份' }).click();
  const path = testInfo.outputPath('fictional-v4-before-upgrade.json');
  await (await download).saveAs(path);
  const { readFile } = await import('node:fs/promises');
  const copy = JSON.parse(await readFile(path, 'utf8'));
  expect(copy.databaseVersion).toBe(4);
  expect(copy.data).toEqual(before);
  await page.getByRole('button', { name: '已保存备份，升级并继续' }).click();
  await expect(page.getByRole('heading', { name: '先备份，再升级学习数据' })).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const d = '/src/persistence/database.ts',
      b = '/src/persistence/backup.ts';
    const { db } = await import(d),
      { exportBackup } = await import(b);
    const f = '/src/persistence/backup-format.ts';
    const { validateBackup } = await import(f);
    const after = await exportBackup(db);
    const oldWriter = await new Promise<string>((resolve) => {
      const req = indexedDB.open(db.name, 40);
      req.onerror = () => resolve(req.error?.name ?? 'unknown');
      req.onsuccess = () => {
        req.result.close();
        resolve('unexpected success');
      };
    });
    return {
      after,
      version: db.verno,
      oldWriter,
      copies: (await db.recoveryBackups.toArray()).map((c: { json: string }) =>
        validateBackup(JSON.parse(c.json)),
      ),
    };
  });
  expect(result.version).toBe(6);
  expect(result.after.databaseVersion).toBe(6);
  expect(result.after.data).toEqual(before);
  expect(result.oldWriter).toBe('VersionError');
  expect(
    result.copies.some(
      (c: { databaseVersion: number; data: unknown }) =>
        c.databaseVersion === 4 && JSON.stringify(c.data) === JSON.stringify(before),
    ),
  ).toBe(true);
});
