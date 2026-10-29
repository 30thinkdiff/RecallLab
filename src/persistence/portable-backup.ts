import { z } from 'zod';
import { validateBackup, type Backup } from './backup-format';
export const MAX_BACKUP_FILE_BYTES = 50 * 1024 ** 2;
export const MAX_EXPANDED_BACKUP_BYTES = 128 * 1024 ** 2;
export const BACKUP_REFERENCE_PREFIX = String.fromCharCode(0) + 'r:';
const marker = BACKUP_REFERENCE_PREFIX;
const utf8 = new TextEncoder();
const bytes = (text: string) => utf8.encode(text).length;
const envelopeSchema = z.strictObject({
  format: z.literal('RecallLabBackup'),
  formatVersion: z.literal(2),
  encoding: z.literal('exact-string-pool-v1'),
  databaseVersion: z.number().int().min(1).max(7),
  createdAt: z.iso.datetime(),
  strings: z.array(z.string()).max(200000),
  payload: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
async function digest(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', utf8.encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function packBackup(backup: Backup) {
  const strings: string[] = [],
    index = new Map<string, number>();
  let references = 0;
  const plain = JSON.stringify(backup);
  if (bytes(plain) > MAX_EXPANDED_BACKUP_BYTES)
    throw Error('学习数据超过当前128 MB安全恢复范围，请保留浏览器数据，不要清除。');
  const frequency = new Map<string, number>();
  const count = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.length >= 8 || value.startsWith(marker))
        frequency.set(value, (frequency.get(value) ?? 0) + 1);
    } else if (Array.isArray(value)) value.forEach(count);
    else if (value && typeof value === 'object') Object.values(value).forEach(count);
  };
  count(backup);
  const share = new Set(
    [...frequency]
      .filter(
        ([text, n]) => text.startsWith(marker) || (n > 1 && bytes(JSON.stringify(text)) >= 32),
      )
      .map(([text]) => text),
  );
  const payload = JSON.stringify(backup, (_key, value: unknown) => {
    if (typeof value !== 'string' || !share.has(value)) return value;
    let i = index.get(value);
    if (i === undefined) {
      i = strings.length;
      if (strings.length >= 200000) throw Error('备份来源片段过多，请保留现有数据。');
      strings.push(value);
      index.set(value, i);
    }
    references++;
    return marker + i;
  });
  const core = {
    format: 'RecallLabBackup' as const,
    formatVersion: 2 as const,
    encoding: 'exact-string-pool-v1' as const,
    databaseVersion: backup.databaseVersion,
    createdAt: backup.createdAt,
    strings,
    payload,
  };
  const value = { ...core, sha256: await digest(JSON.stringify(core)) };
  return {
    value,
    logicalBytes: bytes(plain),
    fileBytes: bytes(JSON.stringify(value)),
    references,
    uniqueStrings: strings.length,
  };
}
export async function portableBackup(backup: Backup) {
  const logicalBytes = bytes(JSON.stringify(backup));
  if (logicalBytes < 8 * 1024 ** 2)
    return { value: backup, logicalBytes, fileBytes: logicalBytes, pooled: false };
  const packed = await packBackup(backup);
  if (packed.fileBytes < logicalBytes && packed.fileBytes <= MAX_BACKUP_FILE_BYTES)
    return { ...packed, pooled: true };
  return { value: backup, logicalBytes, fileBytes: logicalBytes, pooled: false };
}
export async function parsePortableBackup(text: string): Promise<Backup> {
  if (bytes(text) > MAX_EXPANDED_BACKUP_BYTES)
    throw Error('普通备份文件超过128 MB，未改动当前数据。');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error('不是有效的JSON备份');
  }
  if (!raw || typeof raw !== 'object' || !('formatVersion' in raw) || raw.formatVersion !== 2)
    return validateBackup(raw);
  if (bytes(text) > MAX_BACKUP_FILE_BYTES) throw Error('来源去重备份文件超过50 MB，未改动数据。');
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw Error('来源去重备份结构不完整，未改动数据。');
  const { sha256, ...core } = parsed.data;
  if ((await digest(JSON.stringify(core))) !== sha256)
    throw Error('备份校验失败，文件可能损坏；未改动数据。');
  const sizes = core.strings.map((s) => bytes(JSON.stringify(s)));
  let expanded = bytes(core.payload);
  const decoded: unknown = JSON.parse(core.payload, (_key, value: unknown) => {
    if (typeof value !== 'string' || !value.startsWith(marker)) return value;
    const index = value.slice(marker.length);
    if (
      !/^(0|[1-9]\d*)$/u.test(index) ||
      !Number.isSafeInteger(Number(index)) ||
      Number(index) >= core.strings.length
    )
      throw Error('备份来源引用无效，未改动数据。');
    const i = Number(index);
    expanded += sizes[i]! - bytes(JSON.stringify(value));
    if (expanded > MAX_EXPANDED_BACKUP_BYTES)
      throw Error('备份展开超过128 MB安全上限，未改动数据。');
    return core.strings[i]!;
  });
  const backup = validateBackup(decoded);
  if (backup.databaseVersion !== core.databaseVersion || backup.createdAt !== core.createdAt)
    throw Error('备份版本或时间信息不一致。');
  return backup;
}
