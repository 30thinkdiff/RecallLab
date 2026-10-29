import { DATABASE_VERSION } from './version';
import type { RecallDatabase } from './database';
import { backupSchema, validateBackup, type Backup } from './backup-format';
import { dataTables, v5Tables, legacyTables, v2Tables, v3Tables, migrateBackup } from './migration';

// Dexie.exists() may delete its temporary database when a missing-name probe aborts.
// A concurrent tab can create real data in between; never delete a database to inspect it.
async function openExistingDatabase(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let missing = false;
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction!.abort();
    };
    request.onerror = () => {
      if (missing && request.error?.name === 'AbortError') resolve(null);
      else reject(request.error ?? new Error('无法读取本地数据库，请保留浏览器数据。'));
    };
    request.onsuccess = () => resolve(request.result);
  });
}
export async function inspectBeforeUpgrade(name: string): Promise<Backup | null> {
  const existing = await openExistingDatabase(name);
  if (!existing) return null;
  try {
    const version = Math.floor(existing.version / 10);
    if (Math.floor(version) > DATABASE_VERSION)
      throw new Error('这份数据来自更新版本，请使用最新 RecallLab 打开；不要清除网站数据。');
    if (version >= DATABASE_VERSION) return null;
    const tables =
      version === 1
        ? legacyTables
        : version === 2
          ? v2Tables
          : version === 3
            ? v3Tables
            : version < 6
              ? v5Tables
              : dataTables;
    const data = await new Promise<Record<string, unknown[]>>((resolve, reject) => {
      const result: Record<string, unknown[]> = {};
      const transaction = existing.transaction([...tables], 'readonly');
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error('读取升级前数据失败，请保留浏览器数据。'));
      for (const table of tables) {
        const request = transaction.objectStore(table).getAll();
        request.onsuccess = () => {
          result[table] = request.result;
        };
      }
    });
    // Export the original layout even when later relational validation blocks upgrade.
    return backupSchema.parse({
      format: 'RecallLabBackup',
      formatVersion: 1,
      databaseVersion: version,
      createdAt: new Date().toISOString(),
      data,
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
        databaseVersion: DATABASE_VERSION,
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
  if (new TextEncoder().encode(text).length > 128 * 1024 * 1024)
    throw new Error('备份超过 128 MB，暂不支持通过浏览器恢复');
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
  migrated.aiDrafts = migrated.aiDrafts.map((d) => ({
    ...d,
    epoch: crypto.randomUUID(),
    version: 1,
    writerId: 'restore',
  }));
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
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
