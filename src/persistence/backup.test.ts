import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(db.verno).toBe(3);
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
    await expect(exportBackup(db)).resolves.toMatchObject({ databaseVersion: 3 });
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
      if (table !== 'sourceDocuments') await old.table(table).bulkAdd(rows);
    old.close();
    const before = await inspectBeforeUpgrade(name);
    expect(before?.databaseVersion).toBe(2);
    const current = new RecallDatabase(name);
    await current.open();
    expect(current.verno).toBe(3);
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
      if (table !== 'sourceDocuments') await old.table(table).bulkAdd(rows);
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
