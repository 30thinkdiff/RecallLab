import type { Repository } from '../persistence/repository';
import type { GenerationState } from './generation';
import type { AiSource } from './evidence';
import type { ProviderConfig } from './protocol';
import { packState, type DraftToken } from './drafts-format';
import { requireDraftVersion, saveAiDraft } from './drafts-store';
import { confirmCandidates } from './apply';
export async function confirmDraft(
  repo: Repository,
  id: string,
  projectId: string,
  state: GenerationState,
  sources: AiSource[],
  config: ProviderConfig,
  expected: DraftToken | null,
  writerId: string,
  ack: { humanReviewed: boolean; completenessReviewed: boolean },
) {
  return repo.db.transaction('rw', repo.db.tables, async () => {
    const current = await repo.db.aiDrafts.get(id);
    requireDraftVersion(current, expected);
    if (
      !current ||
      current.projectId !== projectId ||
      JSON.stringify(packState(state, sources)) !==
        JSON.stringify({
          ...current.payload,
          status: current.payload.status === 'running' ? 'partial' : current.payload.status,
        })
    )
      throw new Error('请等待当前修改自动保存后再确认；没有写入题库。');
    const selected = state.candidates.filter((c) => c.selected);
    const ids = await confirmCandidates(repo, projectId, state, ack);
    const next: GenerationState = {
      ...state,
      candidates: state.candidates.filter((c) => !c.selected),
      confirmed: [
        ...(state.confirmed ?? []),
        ...selected.map((c, i) => ({ candidateId: c.id, itemId: ids[i]!, sourceId: c.source.id })),
      ],
    };
    const pins = next.candidates.length ? sources : [];
    if (!next.candidates.length) {
      next.inputs = [];
      next.status = 'completed';
    }
    const row = await saveAiDraft(repo.db, id, projectId, next, pins, config, expected, writerId);
    return { row, state: next, sources: pins, ids };
  });
}
