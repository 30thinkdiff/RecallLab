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
    expect(db.verno).toBe(2);
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
    const copy = await db.recoveryBackups.toCollection().first();
    expect(JSON.parse(copy!.json).data.reviewEvents).toEqual(before?.data.reviewEvents);
    await expect(exportBackup(db)).resolves.toMatchObject({ databaseVersion: 2 });
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
});
