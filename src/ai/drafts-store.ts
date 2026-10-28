import type { RecallDatabase } from '../persistence/database';
import type { ProviderConfig } from './protocol';
import type { AiSource } from './evidence';
import type { GenerationState } from './generation';
import { ConflictError } from '../domain/revisions';
import {
  aiDraftSchema,
  assertDraftRecord,
  packState,
  unpackState,
  savedConfigSchema,
  MAX_DRAFT_BYTES,
  MAX_DRAFT_TOTAL_BYTES,
  MAX_DRAFTS,
  type AiDraftRecord,
  type DraftToken,
} from './drafts-format';
import { assertCurrentSources, sourceChanges } from './source-state';
export function tokenFor(d: AiDraftRecord): DraftToken {
  return { epoch: d.epoch, version: d.version };
}
export function requireDraftVersion(
  current: AiDraftRecord | undefined,
  expected: DraftToken | null,
) {
  if (
    expected
      ? !current || current.epoch !== expected.epoch || current.version !== expected.version
      : Boolean(current)
  )
    throw new ConflictError(
      '另一标签页、删除或恢复操作已更新草稿，当前编辑未覆盖新版本。请导出当前编辑或载入最新草稿。',
    );
}
export function activeSources(state: GenerationState, sources: AiSource[]) {
  return sources.filter(
    (s) =>
      s.kind === 'document' ||
      !state.confirmed?.some((c) => c.sourceId === s.id) ||
      state.candidates.some((c) => c.source.id === s.id),
  );
}
export async function loadAiDraft(db: RecallDatabase, id: string) {
  return db.transaction(
    'r',
    [db.aiDrafts, db.sourceDocuments, db.practiceItems, db.projects],
    async () => {
      const row = await db.aiDrafts.get(id);
      if (!row) return null;
      const checked = aiDraftSchema.parse(row);
      assertDraftRecord(checked);
      const { state, sources } = unpackState(checked.payload);
      if (state.status === 'running') state.status = 'partial';
      const stale = await sourceChanges(db, activeSources(state, sources), row.projectId);
      return { row: checked, state, sources, stale };
    },
  );
}
export async function saveAiDraft(
  db: RecallDatabase,
  id: string,
  projectId: string,
  state: GenerationState,
  sources: AiSource[],
  config: ProviderConfig,
  expected: DraftToken | null,
  writerId: string,
) {
  const payload = packState(state, sources);
  const safeConfig = savedConfigSchema.parse({
    kind: config.kind,
    model: config.model,
    endpoint: config.endpoint,
    jsonMode: config.jsonMode,
    ...(config.strategy ? { strategy: config.strategy } : {}),
  });
  return db.transaction(
    'rw',
    [db.aiDrafts, db.sourceDocuments, db.practiceItems, db.projects],
    async () => {
      const old = await db.aiDrafts.get(id);
      requireDraftVersion(old, expected);
      await assertCurrentSources(db, activeSources(state, sources), projectId);
      const now = new Date().toISOString();
      const next: AiDraftRecord = {
        id,
        projectId,
        epoch: old?.epoch ?? crypto.randomUUID(),
        version: (old?.version ?? 0) + 1,
        writerId,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        config: safeConfig,
        payload,
        bytesStored: 1,
      };
      next.bytesStored = new TextEncoder().encode(JSON.stringify(next)).length + 32;
      if (next.bytesStored > MAX_DRAFT_BYTES)
        throw new Error(
          '草稿超过 4 MB，未自动保存。请保留页面并导出当前草稿，缩小整理批次后重试。',
        );
      const sizes = await db.aiDrafts.orderBy('bytesStored').keys();
      const total =
        sizes.reduce<number>((n, v) => n + Number(v), 0) -
        (old?.bytesStored ?? 0) +
        next.bytesStored;
      if (total > MAX_DRAFT_TOTAL_BYTES || (!old && sizes.length >= MAX_DRAFTS))
        throw new Error(
          '候选草稿达到 12 MB 或 20 份上限，未覆盖原有草稿。请先导出或删除不需要的草稿。',
        );
      await db.aiDrafts.put(aiDraftSchema.parse(next));
      return next;
    },
  );
}
export async function deleteAiDraft(db: RecallDatabase, id: string, expected: DraftToken | null) {
  return db.transaction('rw', db.aiDrafts, async () => {
    const old = await db.aiDrafts.get(id);
    requireDraftVersion(old, expected);
    await db.aiDrafts.delete(id);
  });
}
