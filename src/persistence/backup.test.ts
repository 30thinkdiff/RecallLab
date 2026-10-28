import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import legacyJson from '../../tests/fixtures/legacy-v1.json';
import { validateBackup } from './backup-format';
import { RecallDatabase } from './database';
import { exportBackup, inspectBeforeUpgrade, parseBackup, restoreBackup } from './backup';
import { evidenceIsCurrent } from '../domain/revisions';
import { migrateBackup } from './migration';

const names: string[] = [];
afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name);
});
async function legacyDatabase() {
  const name = `legacy-${crypto.randomUUID()}`;
  names.push(name);
  const db = new Dexie(name);
  db.version(1).stores({
    projects: 'id, updatedAt',
    knowledgeUnits: 'id, projectId',
    practiceItems: 'id, projectId, knowledgeUnitId',
    reviewEvents: 'id, projectId, practiceItemId, sessionId, timestamp, &[sessionId+queueIndex]',
    sessions: 'id, projectId, status, [projectId+status]',
  });
  await db.open();
  for (const [table, rows] of Object.entries(legacyJson.data)) await db.table(table).bulkAdd(rows);
  db.close();
  return name;
}

describe('backup and real v1 upgrade', () => {
  it('exports the real v1 layout before upgrade and preserves every original event and archive', async () => {
    const name = await legacyDatabase();
    const before = await inspectBeforeUpgrade(name);
    expect(before?.databaseVersion).toBe(1);
    expect(before?.data.reviewEvents).toEqual(
      [...legacyJson.data.reviewEvents].sort((a, b) => a.id.localeCompare(b.id)),
    );
    const db = new RecallDatabase(name);
    await db.open();
    expect(db.verno).toBe(5);
    expect(await db.reviewEvents.toArray()).toEqual(
      [...legacyJson.data.reviewEvents].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(await db.practiceItems.count()).toBe(5);
    expect((await db.practiceItems.get('q-archived'))?.archivedAt).toBeTruthy();
    expect((await db.sessions.get('s-active'))?.draft.userResponse).toBe(
      '尚未完成的虚构长答案草稿',
    );
    const item = await db.practiceItems.get('q-crystal');
    const revisions = await db.revisions.toArray();
    const event = await db.reviewEvents.get('s-second:0');
    expect(revisions.filter((r) => r.practiceItemId === 'q-crystal')).toHaveLength(2);
    expect(evidenceIsCurrent(event!, item!, revisions)).toBe(false);
    const copy = await db.recoveryBackups
      .filter(
        (copy) => (JSON.parse(copy.json) as { databaseVersion: number }).databaseVersion === 1,
      )
      .first();
    expect(JSON.parse(copy!.json).data.reviewEvents).toEqual(before?.data.reviewEvents);
    await expect(exportBackup(db)).resolves.toMatchObject({ databaseVersion: 5 });
    db.close();
  });

  it('aborts upgrade on inconsistent references without dropping or rewriting the original v1 database', async () => {
    const name = await legacyDatabase();
    const legacy = new Dexie(name);
    await legacy.open();
    await legacy.table('practiceItems').update('q-long', { projectId: 'missing' });
    legacy.close();
    const db = new RecallDatabase(name);
    await expect(db.open()).rejects.toThrow('引用');
    db.close();
    const original = new Dexie(name);
    await original.open();
    expect(original.verno).toBe(1);
    expect(await original.table('reviewEvents').count()).toBe(4);
    expect(await original.table('practiceItems').count()).toBe(5);
    original.close();
  });

  it('round trips all learning data and retains a pre-restore backup, invalidating stale session writers', async () => {
    const name = `restore-${crypto.randomUUID()}`;
    names.push(name);
    const db = new RecallDatabase(name);
    await restoreBackup(db, validateBackup(legacyJson));
    const exported = await exportBackup(db);
    const generation = exported.data.sessions[0]?.generation;
    await restoreBackup(db, parseBackup(JSON.stringify(exported)));
    const after = await exportBackup(db);
    expect(after.data.reviewEvents).toEqual(exported.data.reviewEvents);
    expect(after.data.revisions).toEqual(exported.data.revisions);
    expect(after.data.sessions[0]?.generation).not.toBe(generation);
    expect(await db.recoveryBackups.count()).toBe(2);
    db.close();
  });

  it('rejects malformed and broken-reference backups before changing existing data', async () => {
    const name = `invalid-${crypto.randomUUID()}`;
    names.push(name);
    const db = new RecallDatabase(name);
    await restoreBackup(db, validateBackup(legacyJson));
    const before = await exportBackup(db);
    const bad = structuredClone(before);
    bad.data.reviewEvents[0]!.sessionId = 'missing';
    await expect(restoreBackup(db, bad)).rejects.toThrow('引用');
    expect((await exportBackup(db)).data).toEqual(before.data);
    expect(() => parseBackup('{broken')).toThrow('JSON');
    expect(() => parseBackup(JSON.stringify({ ...legacyJson, formatVersion: 999 }))).toThrow();
    db.close();
  });

  it('rolls back all replacements if a write fails after the restore has begun', async () => {
    const name = `rollback-${crypto.randomUUID()}`;
    names.push(name);
    const db = new RecallDatabase(name);
    await restoreBackup(db, validateBackup(legacyJson));
    const before = await exportBackup(db);
    const fail = () => {
      throw new Error('simulated disk failure');
    };
    db.revisions.hook('creating', fail);
    await expect(restoreBackup(db, before)).rejects.toThrow('simulated');
    db.revisions.hook('creating').unsubscribe(fail);
    expect((await exportBackup(db)).data).toEqual(before.data);
    expect(await db.recoveryBackups.count()).toBe(1);
    db.close();
  });

  it('does not invent missing revision numbers or inherit unknown old revision results', () => {
    const data = migrateBackup(validateBackup(legacyJson));
    expect(
      data.revisions
        .filter((r) => r.practiceItemId === 'q-crystal')
        .map((r) => r.impactOnLearningState),
    ).toEqual(['reset', 'reset']);
    expect(data.reviewEvents).toEqual(legacyJson.data.reviewEvents);
  });
  it.each(['eventSnapshot', 'currentHints', 'missingEvent', 'substantiveInheritance'] as const)(
    'rejects inconsistent backup semantics: %s',
    (scenario) => {
      const input = validateBackup({
        ...legacyJson,
        databaseVersion: 2,
        data: migrateBackup(validateBackup(legacyJson)),
      });
      const bad = structuredClone(input);
      if (scenario === 'eventSnapshot')
        bad.data.reviewEvents[0]!.snapshot.standardAnswer = '被篡改的历史答案';
      if (scenario === 'currentHints') bad.data.practiceItems[0]!.hints = ['与修订矛盾的提示'];
      if (scenario === 'missingEvent') bad.data.reviewEvents.pop();
      if (scenario === 'substantiveInheritance') {
        const current = bad.data.revisions.find((revision) => revision.id === 'q-crystal:r2')!;
        const previous = bad.data.revisions.find((revision) => revision.id === 'q-crystal:r1')!;
        current.changeType = 'substantive';
        current.impactOnLearningState = 'preserve';
        current.learningStateId = previous.learningStateId;
        bad.data.practiceItems.find((item) => item.id === 'q-crystal')!.learningStateId =
          previous.learningStateId;
      }
      expect(() => validateBackup(bad)).toThrow();
    },
  );
  it('can recover a damaged current dataset while retaining its exact pre-restore copy', async () => {
    const name = `damaged-${crypto.randomUUID()}`;
    names.push(name);
    const db = new RecallDatabase(name);
    await restoreBackup(db, validateBackup(legacyJson));
    const good = await exportBackup(db);
    await db.practiceItems.update('q-long', { standardAnswer: '损坏后的内容' });
    await expect(exportBackup(db)).rejects.toThrow('快照');
    await restoreBackup(db, good);
    expect((await db.practiceItems.get('q-long'))?.standardAnswer).not.toBe('损坏后的内容');
    const copies = await db.recoveryBackups.toArray();
    expect(copies.some((copy) => copy.json.includes('损坏后的内容'))).toBe(true);
    expect((await exportBackup(db)).data.reviewEvents).toEqual(good.data.reviewEvents);
    db.close();
  });
  it('upgrades a real v2 database without rewriting evidence, and accepts its old backup', async () => {
    const name = `v2-${crypto.randomUUID()}`;
    names.push(name);
    const data = migrateBackup(validateBackup(legacyJson));
    const old = new Dexie(name);
    old.version(2).stores({
      projects: 'id, updatedAt',
      knowledgeUnits: 'id, projectId',
      practiceItems: 'id, projectId, knowledgeUnitId',
      reviewEvents: 'id, projectId, practiceItemId, sessionId, timestamp, &[sessionId+queueIndex]',
      sessions: 'id, projectId, status, [projectId+status]',
      revisions: 'id, practiceItemId, learningStateId, &[practiceItemId+revisionNumber]',
      draftRecoveries: 'id, sessionId, practiceItemId, createdAt',
      recoveryBackups: 'id, createdAt',
    });
    await old.open();
    for (const [table, rows] of Object.entries(data))
      if (!['sourceDocuments', 'memoryStates', 'schedulingLogs'].includes(table))
        await old.table(table).bulkAdd(rows);
    old.close();
    const before = await inspectBeforeUpgrade(name);
    expect(before?.databaseVersion).toBe(2);
    const current = new RecallDatabase(name);
    await current.open();
    expect(current.verno).toBe(5);
    expect((await exportBackup(current)).data.reviewEvents).toEqual(before?.data.reviewEvents);
    expect(await current.sourceDocuments.count()).toBe(0);
    await restoreBackup(current, before!);
    expect((await exportBackup(current)).data.revisions).toEqual(before?.data.revisions);
    current.close();
  });
  it('rolls back a v2 to v3 upgrade when old references are broken', async () => {
    const name = `v2-broken-${crypto.randomUUID()}`;
    names.push(name);
    const old = new Dexie(name);
    old.version(2).stores({
      projects: 'id',
      knowledgeUnits: 'id',
      practiceItems: 'id',
      reviewEvents: 'id',
      sessions: 'id',
      revisions: 'id',
      draftRecoveries: 'id',
      recoveryBackups: 'id',
    });
    await old.open();
    const data = migrateBackup(validateBackup(legacyJson));
    for (const [table, rows] of Object.entries(data))
      if (!['sourceDocuments', 'memoryStates', 'schedulingLogs'].includes(table))
        await old.table(table).bulkAdd(rows);
    await old.table('knowledgeUnits').update('k-q-long', { projectId: 'missing' });
    old.close();
    const current = new RecallDatabase(name);
    await expect(current.open()).rejects.toThrow('引用');
    current.close();
    const reopened = new Dexie(name);
    await reopened.open();
    expect(reopened.verno).toBe(2);
    expect(await reopened.table('reviewEvents').count()).toBe(4);
    expect(reopened.tables.some((table) => table.name === 'sourceDocuments')).toBe(false);
    reopened.close();
  });
});

it('v3 to v4 preserves old events, creates no FSRS evidence, protects a backup and rolls back damaged data', async () => {
  const data = migrateBackup(validateBackup(legacyJson));
  for (const broken of [false, true]) {
    const name = `v3-${crypto.randomUUID()}`;
    names.push(name);
    const old = new Dexie(name);
    old.version(3).stores({
      projects: 'id',
      knowledgeUnits: 'id',
      practiceItems: 'id',
      reviewEvents: 'id',
      sessions: 'id',
      revisions: 'id',
      draftRecoveries: 'id',
      recoveryBackups: 'id',
      sourceDocuments: 'id',
    });
    await old.open();
    for (const [table, rows] of Object.entries(data))
      if (!['memoryStates', 'schedulingLogs'].includes(table)) await old.table(table).bulkAdd(rows);
    if (broken) await old.table('practiceItems').update('q-long', { projectId: 'missing' });
    old.close();
    expect((await inspectBeforeUpgrade(name))?.databaseVersion).toBe(3);
    const upgraded = new RecallDatabase(name);
    if (broken) {
      await expect(upgraded.open()).rejects.toThrow();
      upgraded.close();
      const reopened = new Dexie(name);
      await reopened.open();
      expect(reopened.verno).toBe(3);
      expect(reopened.tables.some((t) => t.name === 'memoryStates')).toBe(false);
      reopened.close();
    } else {
      await upgraded.open();
      expect(upgraded.verno).toBe(5);
      expect(await upgraded.memoryStates.count()).toBe(0);
      expect(await upgraded.schedulingLogs.count()).toBe(0);
      expect(await upgraded.reviewEvents.toArray()).toEqual(
        [...data.reviewEvents].sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(await upgraded.recoveryBackups.count()).toBe(2);
      upgraded.close();
    }
  }
});

it('does not create or delete a database while probing an absent name', async () => {
  const name = `missing-probe-${crypto.randomUUID()}`;
  names.push(name);
  const deletion = vi.spyOn(indexedDB, 'deleteDatabase');
  try {
    expect(await inspectBeforeUpgrade(name)).toBeNull();
    expect(deletion).not.toHaveBeenCalled();
    expect((await indexedDB.databases()).some((d) => d.name === name)).toBe(false);
  } finally {
    deletion.mockRestore();
  }
});
it('simultaneous startup probes never delete a concurrent first writer or its original rows', async () => {
  const name = `startup-race-${crypto.randomUUID()}`;
  names.push(name);
  const db = new RecallDatabase(name),
    deletion = vi.spyOn(indexedDB, 'deleteDatabase');
  try {
    await Promise.all([
      inspectBeforeUpgrade(name),
      inspectBeforeUpgrade(name),
      db.projects.add(legacyJson.data.projects[0]!),
    ]);
    expect(deletion).not.toHaveBeenCalled();
    expect(await db.projects.toArray()).toEqual([legacyJson.data.projects[0]!]);
    expect(await inspectBeforeUpgrade(name)).toBeNull();
    expect(await db.projects.count()).toBe(1);
  } finally {
    deletion.mockRestore();
    db.close();
  }
});

it('upgrades real v4 scheduling data to v5 without changing evidence, exports a protection copy and explicitly tests legacy Dexie fallback', async () => {
  const { Repository } = await import('./repository');
  const { ScheduleService } = await import('../scheduling/service');
  const { tokenOf } = await import('../domain/revisions');
  const seedName = `seed-v5-${crypto.randomUUID()}`;
  names.push(seedName);
  const seed = new RecallDatabase(seedName),
    repo = new Repository(seed);
  const pid = await repo.saveProject({
    name: '虚构旧版复习',
    description: '',
    learningGoal: '',
    targetDate: '',
    dailyTimeBudget: 30,
  });
  await repo.saveCard(pid, {
    question: '蓝晶协议是什么？',
    standardAnswer: '先核对来源，再记录版本。',
    hints: '',
    answerCriteria: '',
    mnemonics: '',
    confusionWarnings: '',
    sourceLabel: '虚构资料',
  });
  const sid = await new ScheduleService(seed).start(pid);
  let session = (await seed.sessions.get(sid))!;
  session = await repo.updateDraft(
    sid,
    0,
    { responseMode: 'typed', userResponse: '先核对来源，再记录版本。' },
    tokenOf(session),
  );
  session = await repo.updateDraft(sid, 0, {}, tokenOf(session), 'reveal');
  await repo.submitReview(sid, 0, 'correct', 4, tokenOf(session));
  const original = await exportBackup(seed);
  const schema = Object.fromEntries(
    seed.tables.map((t) => [
      t.name,
      [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(','),
    ]),
  );
  seed.close();
  const name = `v4-scheduled-${crypto.randomUUID()}`;
  names.push(name);
  const old = new Dexie(name);
  old.version(4).stores(schema);
  await old.open();
  for (const [table, rows] of Object.entries(original.data)) await old.table(table).bulkAdd(rows);
  old.close();
  const before = (await inspectBeforeUpgrade(name))!;
  expect(before.databaseVersion).toBe(4);
  expect(before.data.memoryStates).toHaveLength(1);
  const current = new RecallDatabase(name);
  await current.open();
  expect(current.verno).toBe(5);
  expect((await exportBackup(current)).data).toEqual(before.data);
  const protectedCopy = JSON.parse((await current.recoveryBackups.toArray())[0]!.json);
  expect(protectedCopy.databaseVersion).toBe(4);
  expect(protectedCopy.data).toEqual(before.data);
  await restoreBackup(current, before);
  const restored = await exportBackup(current);
  expect(restored.databaseVersion).toBe(5);
  expect(restored.data.reviewEvents).toEqual(before.data.reviewEvents);
  expect(restored.data.memoryStates).toEqual(before.data.memoryStates);
  expect(restored.data.schedulingLogs).toEqual(before.data.schedulingLogs);
  current.close();
  const oldWriter = new Dexie(name);
  oldWriter.version(4).stores(schema);
  // Dexie 4 automatically retries VersionError without a requested version. Never claim the bump alone blocks old clients.
  await oldWriter.open();
  expect(oldWriter.backendDB().version).toBe(50);
  expect(await oldWriter.table('reviewEvents').toArray()).toEqual(before.data.reviewEvents);
  oldWriter.close();
});

it.each(['broken-reference', 'interrupted-backup'])(
  'rolls back v4 to v5 upgrade atomically: %s',
  async (failure) => {
    const name = `v4-rollback-${crypto.randomUUID()}`;
    names.push(name);
    const old = new Dexie(name);
    old.version(4).stores({
      projects: 'id',
      knowledgeUnits: 'id',
      practiceItems: 'id',
      reviewEvents: 'id',
      sessions: 'id',
      revisions: 'id',
      draftRecoveries: 'id',
      sourceDocuments: 'id',
      memoryStates: 'id',
      schedulingLogs: 'id',
      recoveryBackups: 'id',
    });
    await old.open();
    const data = migrateBackup(validateBackup(legacyJson));
    for (const [table, rows] of Object.entries(data)) await old.table(table).bulkAdd(rows);
    if (failure === 'broken-reference')
      await old.table('practiceItems').update('q-long', { projectId: 'missing' });
    const events = await old.table('reviewEvents').toArray();
    old.close();
    const current = new RecallDatabase(name);
    if (failure === 'interrupted-backup')
      current.recoveryBackups.hook('creating', () => {
        throw new Error('simulated v5 upgrade interruption');
      });
    await expect(current.open()).rejects.toThrow();
    current.close();
    const reopened = new Dexie(name);
    await reopened.open();
    expect(reopened.verno).toBe(4);
    expect(await reopened.table('reviewEvents').toArray()).toEqual(events);
    expect(await reopened.table('recoveryBackups').count()).toBe(0);
    reopened.close();
  },
);

it('refuses a future database before normal access without deleting its records', async () => {
  const name = `future-${crypto.randomUUID()}`;
  names.push(name);
  const future = new Dexie(name);
  future.version(6).stores({ projects: 'id' });
  await future.open();
  await future.table('projects').add({ id: 'future-evidence', text: '公开虚构的未来记录' });
  future.close();
  await expect(inspectBeforeUpgrade(name)).rejects.toThrow('更新版本');
  const current = new RecallDatabase(name);
  await expect(current.open()).rejects.toThrow('更新版本');
  current.close();
  const original = new Dexie(name);
  await original.open();
  expect(await original.table('projects').get('future-evidence')).toEqual({
    id: 'future-evidence',
    text: '公开虚构的未来记录',
  });
  expect(Math.floor(original.backendDB().version / 10)).toBe(6);
  original.close();
});
