import { it, expect } from 'vitest';
import {
  packBackup,
  parsePortableBackup,
  portableBackup,
  BACKUP_REFERENCE_PREFIX,
} from './portable-backup';
import { validateBackup } from './backup-format';
import legacy from '../../tests/fixtures/legacy-v1.json';
const plain = () => validateBackup(legacy);
it('round trips exact repeated evidence, Unicode and a literal codec marker without rewriting history', async () => {
  const b = plain();
  b.data.projects[0]!.description = '中文🙂 é é '.repeat(40) + BACKUP_REFERENCE_PREFIX + '7';
  const packed = await packBackup(b);
  expect(packed.references).toBeGreaterThan(0);
  const restored = await parsePortableBackup(JSON.stringify(packed.value));
  expect(restored).toEqual(b);
  expect(await parsePortableBackup(JSON.stringify(b))).toEqual(b);
  expect((await portableBackup(b)).pooled).toBe(false);
});
it('rejects tampering before applying data and detects invalid reference expansion', async () => {
  const packed = await packBackup(plain());
  packed.value.strings.push('tampered');
  await expect(parsePortableBackup(JSON.stringify(packed.value))).rejects.toThrow('校验');
  await expect(parsePortableBackup('{')).rejects.toThrow('JSON');
  await expect(parsePortableBackup(JSON.stringify({ formatVersion: 2 }))).rejects.toThrow('结构');
});
it('restores legacy data larger than 50 MiB and its small pooled equivalent with every byte intact', async () => {
  const b = plain(),
    projectId = b.data.projects[0]!.id;
  const body = '公开虚构容量材料🙂Chinese English。'.repeat(70000);
  for (let i = 0; i < 20; i++)
    b.data.sourceDocuments.push({
      id: `public-large-${i}`,
      projectId,
      filename: `public-${i}.txt`,
      fileType: 'txt',
      sourceHash: 'a'.repeat(64),
      byteLength: new TextEncoder().encode(body).length,
      extractedContent: body,
      pages: [],
      sections: [],
      warnings: [],
      extractionStatus: 'ready',
      parserVersion: 'fixture',
      importDigest: 'b'.repeat(64),
      initialItemIds: [],
      importedAt: new Date().toISOString(),
    });
  const text = JSON.stringify(b),
    logical = new TextEncoder().encode(text).length;
  expect(logical).toBeGreaterThan(50 * 1024 ** 2);
  expect(logical).toBeLessThan(128 * 1024 ** 2);
  const portable = await portableBackup(b);
  expect(portable.pooled).toBe(true);
  expect(portable.fileBytes).toBeLessThan(logical / 4);
  const pooled = await parsePortableBackup(JSON.stringify(portable.value)),
    legacy = await parsePortableBackup(text);
  expect(pooled.data.reviewEvents).toEqual(b.data.reviewEvents);
  expect(legacy.data.sourceDocuments[19]!.extractedContent).toBe(body);
  expect(pooled.data.sourceDocuments[19]!.extractedContent).toBe(body);
}, 30000);
it('refuses expansion bombs and nonexistent pool references even with a self-consistent envelope hash', async () => {
  const encoder = new TextEncoder();
  const hashed = async (core: object) => {
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(core)));
    return {
      ...core,
      sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    };
  };
  const core = {
    format: 'RecallLabBackup',
    formatVersion: 2,
    encoding: 'exact-string-pool-v1',
    databaseVersion: 7,
    createdAt: new Date().toISOString(),
    strings: ['x'.repeat(1024 ** 2)],
    payload: JSON.stringify(Array.from({ length: 130 }, () => BACKUP_REFERENCE_PREFIX + '0')),
  };
  await expect(parsePortableBackup(JSON.stringify(await hashed(core)))).rejects.toThrow('128 MB');
  await expect(
    parsePortableBackup(
      JSON.stringify(
        await hashed({ ...core, payload: JSON.stringify(BACKUP_REFERENCE_PREFIX + '9') }),
      ),
    ),
  ).rejects.toThrow('引用无效');
});
