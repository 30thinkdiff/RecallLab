import Dexie from 'dexie';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { RecallDatabase } from './database';
import { Repository } from './repository';
import { EditingService } from './editing-service';
import { exportBackup, restoreBackup, inspectBeforeUpgrade } from './backup';
import { validateBackup } from './backup-format';
import { cardEditToken } from '../domain/editing';
import { tokenOf } from '../domain/revisions';
import { ScheduleService } from '../scheduling/service';
import type { EditorDraft } from './editable-format';
const raw = {
  question: '虚构标识中应保留什么？',
  standardAnswer: 'a b',
  hints: '',
  answerCriteria: '完整名称',
  mnemonics: '',
  confusionWarnings: '',
  sourceLabel: '用户创建',
};
let db: RecallDatabase, repo: Repository, service: EditingService;
beforeEach(() => {
  db = new RecallDatabase(`v062-${crypto.randomUUID()}`);
  repo = new Repository(db);
  service = new EditingService(repo);
});
afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});
async function create() {
  const r = await service.saveCard(undefined, raw);
  return { ...r, item: (await db.practiceItems.get(r.id))! };
}
async function learn(projectId: string) {
  const scheduling = new ScheduleService(db);
  const id = await scheduling.start(projectId, { adaptive: true });
  let s = (await db.sessions.get(id))!;
  s = await repo.updateDraft(
    id,
    0,
    { responseMode: 'typed', userResponse: s.queue[0]!.standardAnswer },
    tokenOf(s),
  );
  s = await repo.updateDraft(id, 0, {}, tokenOf(s), 'reveal');
  await repo.submitReview(id, 0, 'correct', null, tokenOf(s));
}
it('creates without a file or pre-existing project, and no-change saves create no revision', async () => {
  const { item, projectId } = await create();
  expect(await db.projects.count()).toBe(1);
  expect(await db.sourceDocuments.count()).toBe(0);
  expect(item.creationOrigin).toBe('user');
  await service.saveCard(projectId, raw, { id: item.id, expectedToken: cardEditToken(item) });
  expect(await db.revisions.count()).toBe(1);
});
it('isolates meaningful space/symbol edits and requires a concise confirmation while retaining old event evidence', async () => {
  const { item, projectId } = await create();
  await learn(projectId);
  const before = await exportBackup(db);
  await expect(
    service.saveCard(
      projectId,
      { ...raw, standardAnswer: 'ab' },
      { id: item.id, expectedToken: cardEditToken(item) },
    ),
  ).rejects.toThrow('确认');
  await service.saveCard(
    projectId,
    { ...raw, standardAnswer: 'ab' },
    { id: item.id, expectedToken: cardEditToken(item), confirmReset: true },
  );
  const next = (await db.practiceItems.get(item.id))!;
  expect(next.learningStateId).not.toBe(item.learningStateId);
  expect(await db.memoryStates.get(next.learningStateId)).toBeUndefined();
  expect(await db.reviewEvents.toArray()).toEqual(before.data.reviewEvents);
  expect((await db.knowledgeUnits.get(item.knowledgeUnitId))!.canonicalContent).toBe('a b');
});
it('auxiliary edits preserve actual FSRS state; pause/importance changes create no content revision', async () => {
  const { item, projectId } = await create();
  await learn(projectId);
  const memory = await db.memoryStates.get(item.learningStateId);
  await service.saveCard(
    projectId,
    { ...raw, hints: '新提示' },
    { id: item.id, expectedToken: cardEditToken(item) },
  );
  let next = (await db.practiceItems.get(item.id))!;
  expect(next.learningStateId).toBe(item.learningStateId);
  expect(await db.memoryStates.get(item.learningStateId)).toEqual(memory);
  const revisions = await db.revisions.count();
  await service.saveCard(
    projectId,
    { ...raw, hints: '新提示', paused: true, importance: 3 },
    { id: item.id, expectedToken: cardEditToken(next) },
  );
  next = (await db.practiceItems.get(item.id))!;
  expect(next.paused).toBe(true);
  expect(next.importance).toBe(3);
  expect(await db.revisions.count()).toBe(revisions);
  expect(await db.memoryStates.get(item.learningStateId)).toEqual(memory);
});
it('rejects stale editors, including a preference-only update with unchanged content revision', async () => {
  const { item, projectId } = await create();
  await service.saveCard(
    projectId,
    { ...raw, importance: 3 },
    { id: item.id, expectedToken: cardEditToken(item) },
  );
  await expect(
    service.saveCard(
      projectId,
      { ...raw, standardAnswer: '另一答案' },
      { id: item.id, expectedToken: cardEditToken(item), confirmReset: true },
    ),
  ).rejects.toThrow('另一页面');
  expect((await db.practiceItems.get(item.id))!.standardAnswer).toBe('a b');
});
it('learning notes and confirmed answers edit independently; versions, original snapshots and backups survive', async () => {
  const { item, projectId } = await create();
  await learn(projectId);
  const before = await exportBackup(db);
  await service.saveNote(item.knowledgeUnitId, 0, '用户补充：独立学习稿');
  expect((await db.practiceItems.get(item.id))!.standardAnswer).toBe('a b');
  await expect(service.saveNote(item.knowledgeUnitId, 0, '过期编辑')).rejects.toThrow('另一页面');
  await service.saveCard(
    projectId,
    { ...raw, standardAnswer: '更新答案' },
    { id: item.id, expectedToken: cardEditToken(item), confirmReset: true },
  );
  expect((await db.knowledgeUnits.get(item.knowledgeUnitId))!.canonicalContent).toBe(
    '用户补充：独立学习稿',
  );
  expect(await db.reviewEvents.toArray()).toEqual(before.data.reviewEvents);
  const backup = await exportBackup(db);
  expect(backup.data.workingNoteRevisions.map((r) => r.content).sort()).toEqual(
    ['a b', '用户补充：独立学习稿'].sort(),
  );
  await restoreBackup(db, backup);
  expect((await exportBackup(db)).data.workingNoteRevisions).toEqual(
    backup.data.workingNoteRevisions,
  );
});
it('draft CAS and restored epochs block stale writes; cancel changes neither revisions nor memory', async () => {
  const { item, projectId } = await create();
  const now = new Date().toISOString();
  const initial: EditorDraft = {
    id: `card:${item.id}`,
    epoch: crypto.randomUUID(),
    kind: 'card',
    projectId,
    practiceItemId: item.id,
    baseRevisionId: cardEditToken(item),
    version: 0,
    values: raw,
    createdAt: now,
    updatedAt: now,
  };
  let d = await service.openDraft(initial);
  d = await service.writeDraft(d.id, d.version, { ...raw, standardAnswer: '未确认编辑' }, d.epoch);
  await expect(service.writeDraft(d.id, 0, raw, d.epoch)).rejects.toThrow('另一页面');
  const before = await exportBackup(db);
  await restoreBackup(db, before);
  await expect(service.writeDraft(d.id, d.version, raw, d.epoch)).rejects.toThrow('另一页面');
  d = (await db.editorDrafts.get(d.id))!;
  await service.cancelDraft(d.id, d.version, d.epoch);
  expect(await db.revisions.toArray()).toEqual(before.data.revisions);
  expect(await db.memoryStates.toArray()).toEqual(before.data.memoryStates);
  expect((await db.practiceItems.get(item.id))!.standardAnswer).toBe('a b');
});
it('new-project creation and card save roll back together if writing fails', async () => {
  const original = repo.saveCard.bind(repo);
  vi.spyOn(repo, 'saveCard').mockImplementation(async (...args) => {
    await original(...args);
    throw new Error('模拟事务故障');
  });
  await expect(service.saveCard(undefined, raw)).rejects.toThrow('故障');
  expect(await db.projects.count()).toBe(0);
  expect(await db.practiceItems.count()).toBe(0);
  expect(await db.revisions.count()).toBe(0);
});
it.each([false, true])(
  'native v8 upgrade protects byte-for-byte histories/FSRS or rolls back completely: damaged=%s',
  async (damaged) => {
    const { projectId } = await create();
    await learn(projectId);
    const before = await exportBackup(db);
    const nativeName = `native8-${crypto.randomUUID()}`,
      old = new Dexie(nativeName);
    const tables = db.tables.filter(
      (t) => !['editorDrafts', 'workingNoteRevisions'].includes(t.name),
    );
    old
      .version(8)
      .stores(
        Object.fromEntries(
          tables.map((t) => [
            t.name,
            [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(','),
          ]),
        ),
      );
    await old.open();
    for (const [name, rows] of Object.entries(before.data))
      if (old.tables.some((t) => t.name === name)) await old.table(name).bulkAdd(rows);
    if (damaged)
      await old
        .table('practiceItems')
        .update(before.data.practiceItems[0]!.id, { projectId: 'missing' });
    old.close();
    const inspection = await inspectBeforeUpgrade(nativeName);
    expect(inspection!.databaseVersion).toBe(8);
    const current = new RecallDatabase(nativeName);
    try {
      if (damaged) {
        await expect(current.open()).rejects.toThrow();
        current.close();
        const check = new Dexie(nativeName);
        await check.open();
        expect(check.verno).toBe(8);
        expect(check.tables.some((t) => t.name === 'editorDrafts')).toBe(false);
        expect(await check.table('reviewEvents').toArray()).toEqual(before.data.reviewEvents);
        expect(await check.table('recoveryBackups').count()).toBe(0);
        check.close();
      } else {
        await current.open();
        const after = await exportBackup(current);
        expect(after.data).toEqual(before.data);
        const protection = (await current.recoveryBackups.toArray())[0]!;
        expect(JSON.parse(protection.json).databaseVersion).toBe(8);
        expect(validateBackup(JSON.parse(protection.json)).data.reviewEvents).toEqual(
          before.data.reviewEvents,
        );
      }
    } finally {
      current.close();
      await Dexie.delete(nativeName);
    }
  },
);
