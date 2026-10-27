import Dexie from 'dexie';
import type { RecallDatabase } from './database';
import { backupSchema, validateBackup, type Backup } from './backup-format';
import { dataTables, legacyTables, v2Tables, migrateBackup } from './migration';

export async function inspectBeforeUpgrade(name: string): Promise<Backup | null> {
  if (!(await Dexie.exists(name))) return null;
  const existing = new Dexie(name);
  try {
    await existing.open();
    if (existing.verno >= 3) return null;
    return await existing.transaction('r', existing.tables, async () => {
      const data: Record<string, unknown[]> = {};
      for (const name of existing.verno === 1 ? legacyTables : v2Tables)
        data[name] = await existing.table(name).toArray();
      // Export is possible even when later relational validation blocks the upgrade.
      return backupSchema.parse({
        format: 'RecallLabBackup',
        formatVersion: 1,
        databaseVersion: existing.verno,
        createdAt: new Date().toISOString(),
        data,
      });
    });
  } finally {
    existing.close();
  }
}

async function captureBackup(db: RecallDatabase) {
  return db.transaction(
    'r',
    dataTables.map((name) => db.table(name)),
    async () => {
      const data: Record<string, unknown[]> = {};
      for (const name of dataTables) data[name] = await db.table(name).toArray();
      return {
        format: 'RecallLabBackup',
        formatVersion: 1,
        databaseVersion: 3,
        createdAt: new Date().toISOString(),
        data,
      };
    },
  );
}

export async function exportBackup(db: RecallDatabase): Promise<Backup> {
  return validateBackup(await captureBackup(db));
}

export function parseBackup(text: string) {
  if (text.length > 50 * 1024 * 1024) throw new Error('备份超过 50 MB，暂不支持通过浏览器恢复');
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('不是有效的 JSON 备份');
  }
  return validateBackup(raw);
}

export async function restoreBackup(db: RecallDatabase, input: Backup) {
  // Revalidate inside the public API, not only in the file-picker UI.
  const backup = validateBackup(input);
  const migrated = migrateBackup(backup);
  // New generations invalidate all open tabs' pre-restore write tokens, even for identical IDs.
  migrated.sessions = migrated.sessions.map((session) => ({
    ...session,
    generation: crypto.randomUUID(),
  }));
  await db.transaction('rw', db.tables, async () => {
    // Even a damaged current dataset can be protected verbatim before restoring a valid backup.
    const current = await captureBackup(db);
    await db.recoveryBackups.add({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      reason: 'restore',
      json: JSON.stringify(current),
    });
    for (const name of dataTables) {
      await db.table(name).clear();
      await db.table(name).bulkAdd(migrated[name]);
    }
    // Reference checks are rerun on actual persisted rows before commit.
    await exportBackup(db);
  });
}

export function downloadJson(
  value: unknown,
  filename = `RecallLab-backup-${new Date().toISOString().replaceAll(':', '-')}.json`,
) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
