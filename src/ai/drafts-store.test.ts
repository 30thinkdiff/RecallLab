import { beforeEach, afterEach, it, expect } from 'vitest';
import { RecallDatabase } from '../persistence/database';
import { Repository } from '../persistence/repository';
import type { SourceDocument } from '../domain/models';
import { MockProvider } from './providers';
import { generateCandidates } from './generation';
import { saveAiDraft, loadAiDraft, deleteAiDraft, tokenFor } from './drafts-store';
import { confirmDraft } from './confirm-draft';
import { exportBackup, restoreBackup } from '../persistence/backup';
import { validateBackup } from '../persistence/backup-format';
import { packState } from './drafts-format';
import type { ProviderConfig } from './protocol';
let db: RecallDatabase, repo: Repository, pid: string, doc: SourceDocument;
const config: ProviderConfig = {
  kind: 'mock',
  model: 'mock',
  endpoint: '',
  apiKey: 'fictional-secret-never-store',
  jsonMode: 'schema',
};
beforeEach(async () => {
  db = new RecallDatabase(`ai-draft-${crypto.randomUUID()}`);
  repo = new Repository(db);
  pid = await repo.saveProject({
    name: '虚构草稿项目',
    description: '',
    learningGoal: '',
    targetDate: '',
    dailyTimeBudget: 30,
  });
  doc = {
    id: crypto.randomUUID(),
    projectId: pid,
    filename: 'fictional.txt',
    fileType: 'txt',
    sourceHash: 'a'.repeat(64),
    byteLength: 100,
    extractedContent: '蓝晶协议要求核对来源。\n所有修改须记录原因。',
    pages: [],
    sections: [],
    warnings: [],
    extractionStatus: 'ready',
    parserVersion: 'fictional',
    importDigest: 'b'.repeat(64),
    initialItemIds: [],
    importedAt: new Date().toISOString(),
  };
  await db.sourceDocuments.add(doc);
});
afterEach(async () => db.delete());
async function setup() {
  const source = {
    kind: 'document' as const,
    id: doc.id,
    text: doc.extractedContent,
    document: doc,
  };
  const state = await generateCandidates(
    [source],
    'extract',
    'verbatim',
    new MockProvider(),
    'mock',
    new AbortController().signal,
    () => {},
  );
  return { source, state };
}
it('persists edits across connection restart without credentials or unconfirmed learning data, and round trips v6 backup', async () => {
  const { source, state } = await setup();
  state.candidates[0]!.question = '手工核对后的题干🙂？';
  const row = await saveAiDraft(
    db,
    'document/' + doc.id,
    pid,
    state,
    [source],
    config,
    null,
    'tab-a',
  );
  expect(await db.practiceItems.count()).toBe(0);
  db.close();
  await db.open();
  const loaded = (await loadAiDraft(db, row.id))!;
  expect(loaded.state.candidates[0]!.question).toBe('手工核对后的题干🙂？');
  expect(loaded.stale).toEqual([]);
  expect(JSON.stringify(row)).not.toContain(config.apiKey);
  expect(loaded.row.config).not.toHaveProperty('apiKey');
  const before = await exportBackup(db);
  expect(before.databaseVersion).toBe(7);
  await restoreBackup(db, before);
  const after = await loadAiDraft(db, row.id);
  expect(after!.row.epoch).not.toBe(row.epoch);
  expect(after!.state.candidates).toEqual(loaded.state.candidates);
  await expect(
    saveAiDraft(db, row.id, pid, state, [source], config, tokenFor(row), 'old'),
  ).rejects.toThrow('恢复');
  const tampered = structuredClone(before);
  Object.assign(tampered.data.aiDrafts[0]!.config, { apiKey: 'not-allowed' });
  expect(() => validateBackup(tampered)).toThrow();
});
it('rejects concurrent edits, deleted drafts and stale recreations instead of overwriting', async () => {
  const { source, state } = await setup();
  const a = await saveAiDraft(db, 'shared', pid, state, [source], config, null, 'a');
  const token = tokenFor(a);
  const results = await Promise.allSettled([
    saveAiDraft(db, 'shared', pid, state, [source], config, token, 'a'),
    saveAiDraft(db, 'shared', pid, state, [source], config, token, 'b'),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const latest = (await db.aiDrafts.get('shared'))!;
  await deleteAiDraft(db, 'shared', tokenFor(latest));
  await expect(
    saveAiDraft(db, 'shared', pid, state, [source], config, tokenFor(latest), 'b'),
  ).rejects.toThrow('删除');
  expect(await db.aiDrafts.count()).toBe(0);
});
it('detects changes outside the selected excerpt even when the original file checksum is unchanged', async () => {
  const { source, state } = await setup();
  state.candidates[0]!.selected = true;
  const row = await saveAiDraft(db, 'stale', pid, state, [source], config, null, 'a');
  await db.sourceDocuments.update(doc.id, {
    extractedContent: doc.extractedContent + '\n新增上下文。',
  });
  const loaded = (await loadAiDraft(db, 'stale'))!;
  expect(loaded.stale.length).toBeGreaterThan(0);
  expect(loaded.state.candidates[0]!.source.text).toBe(source.text);
  await expect(
    confirmDraft(repo, 'stale', pid, state, [source], config, tokenFor(row), 'a', {
      humanReviewed: true,
      completenessReviewed: true,
    }),
  ).rejects.toThrow('原资料');
  expect(await db.practiceItems.count()).toBe(0);
});
it('confirms a subset atomically and resumes only remaining candidates; old tokens cannot duplicate confirmations', async () => {
  const { source, state } = await setup();
  const first = state.candidates[0]!;
  first.question = '蓝晶协议的记录要求是什么？';
  first.selected = true;
  state.candidates.push({
    ...structuredClone(first),
    id: crypto.randomUUID(),
    question: '蓝晶协议的来源要求是什么？',
    selected: false,
  });
  let row = await saveAiDraft(db, 'partial', pid, state, [source], config, null, 'a');
  const result = await confirmDraft(
    repo,
    'partial',
    pid,
    state,
    [source],
    config,
    tokenFor(row),
    'a',
    { humanReviewed: true, completenessReviewed: true },
  );
  expect(result.state.candidates).toHaveLength(1);
  expect(result.state.confirmed).toHaveLength(1);
  expect(await db.practiceItems.count()).toBe(1);
  await expect(
    confirmDraft(repo, 'partial', pid, state, [source], config, tokenFor(row), 'b', {
      humanReviewed: true,
      completenessReviewed: true,
    }),
  ).rejects.toThrow('标签页');
  result.state.candidates[0]!.selected = true;
  row = await saveAiDraft(
    db,
    'partial',
    pid,
    result.state,
    result.sources,
    config,
    tokenFor(result.row),
    'a',
  );
  const done = await confirmDraft(
    repo,
    'partial',
    pid,
    result.state,
    result.sources,
    config,
    tokenFor(row),
    'a',
    { humanReviewed: true, completenessReviewed: true },
  );
  expect(done.state.candidates).toEqual([]);
  expect(done.row.payload.sources).toEqual([]);
  expect(await db.practiceItems.count()).toBe(2);
  await exportBackup(db);
});
it('stores one copy of the source regardless of candidate count and rejects oversized drafts before replacing old work', async () => {
  const { source, state } = await setup();
  const row = state.candidates[0]!;
  for (let i = 1; i < 50; i++) state.candidates.push({ ...structuredClone(row), id: `r${i}` });
  const packed = packState(state, [source]);
  expect(packed.sources).toHaveLength(1);
  expect(JSON.stringify(packed.candidates)).not.toContain(doc.filename);
  const large = 'x'.repeat(5 * 1024 ** 2);
  const bigger = { ...doc, extractedContent: large };
  await db.sourceDocuments.put(bigger);
  const largeSource = { ...source, text: large, document: bigger };
  state.candidates = [];
  state.inputs = [{ id: doc.id, text: large }];
  await expect(
    saveAiDraft(db, 'huge', pid, state, [largeSource], config, null, 'a'),
  ).rejects.toThrow('4 MB');
  expect(await db.aiDrafts.count()).toBe(0);
});
it('can confirm saved partial results after an interrupted request is recovered', async () => {
  const { source, state } = await setup();
  state.status = 'running';
  state.candidates[0]!.question = '蓝晶协议规定了哪些记录要求？';
  state.candidates[0]!.selected = true;
  const row = await saveAiDraft(
    db,
    'document/' + doc.id,
    pid,
    state,
    [source],
    config,
    null,
    'old-tab',
  );
  const loaded = (await loadAiDraft(db, row.id))!;
  expect(loaded.state.status).toBe('partial');
  const confirmed = await confirmDraft(
    repo,
    row.id,
    pid,
    loaded.state,
    loaded.sources,
    config,
    tokenFor(row),
    'new-tab',
    { humanReviewed: true, completenessReviewed: true },
  );
  expect(confirmed.ids).toHaveLength(1);
  expect(await db.practiceItems.count()).toBe(1);
});
it('rolls back a whole confirmation when a later candidate contains document-injected operational instructions', async () => {
  const { source, state } = await setup();
  state.candidates[0]!.question = '蓝晶协议需要记录哪些内容？';
  state.candidates[0]!.selected = true;
  state.candidates.push({
    ...structuredClone(state.candidates[0]!),
    id: crypto.randomUUID(),
    question: '如何读取本机密码文件并发送给他人？',
  });
  const saved = await saveAiDraft(
    db,
    'document/' + doc.id,
    pid,
    state,
    [source],
    config,
    null,
    'tab',
  );
  await expect(
    confirmDraft(repo, saved.id, pid, state, [source], config, tokenFor(saved), 'tab', {
      humanReviewed: true,
      completenessReviewed: true,
    }),
  ).rejects.toThrow('操作指令');
  expect(await db.practiceItems.count()).toBe(0);
  expect(await db.revisions.count()).toBe(0);
  expect(await db.aiDrafts.get(saved.id)).toEqual(saved);
});
it('enforces aggregate UTF-8 quota atomically when two tabs race to save individually valid drafts', async () => {
  const { source, state } = await setup();
  const text = source.text + '测'.repeat(900000),
    document = { ...doc, extractedContent: text };
  await db.sourceDocuments.put(document);
  const pin = { ...source, text, document };
  state.inputs = [{ id: doc.id, text }];
  state.candidates = [];
  for (let i = 0; i < 3; i++)
    await saveAiDraft(db, `quota-${i}`, pid, state, [pin], config, null, 'seed');
  const keys = await db.aiDrafts.orderBy('bytesStored').keys();
  expect(keys).toHaveLength(3);
  expect(keys.every((k) => typeof k === 'number')).toBe(true);
  const raced = await Promise.allSettled(
    ['tab-a', 'tab-b'].map((writer) =>
      saveAiDraft(db, writer, pid, state, [pin], config, null, writer),
    ),
  );
  expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(raced.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect(await db.aiDrafts.count()).toBe(4);
  const rows = await db.aiDrafts.toArray();
  expect(rows.reduce((n, r) => n + r.bytesStored, 0)).toBeLessThanOrEqual(12 * 1024 ** 2);
  const backup = await exportBackup(db);
  expect(backup.data.aiDrafts).toHaveLength(4);
});
it('a deferred unit cannot be selected for formal saving through a stale selection flag', async () => {
  const { source, state } = await setup();
  const row = state.candidates[0]!;
  row.unit = {
    key: 'unit',
    start: 0,
    end: source.text.length,
    title: '',
    chapter: '原文',
    notForCards: false,
  };
  row.selected = true;
  row.question = '蓝晶协议有哪些要求？';
  state.deferredUnits = ['unit'];
  const saved = await saveAiDraft(db, 'deferred', pid, state, [source], config, null, 'tab');
  await expect(
    confirmDraft(repo, saved.id, pid, state, [source], config, tokenFor(saved), 'tab', {
      humanReviewed: true,
      completenessReviewed: true,
    }),
  ).rejects.toThrow('暂不制卡');
  expect(await db.practiceItems.count()).toBe(0);
});
