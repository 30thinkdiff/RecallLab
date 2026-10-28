import type { Backup } from './backup-format';
import { validateBackup } from './backup-format';
import type {
  KnowledgeUnit,
  LearningProject,
  PracticeItem,
  PracticeItemRevision,
  PracticeSnapshot,
  ReviewEvent,
  StudySession,
  DraftRecovery,
} from '../domain/models';
import { legacyStateId, revisionId } from '../domain/revisions';

export interface LearningData {
  projects: LearningProject[];
  knowledgeUnits: KnowledgeUnit[];
  practiceItems: PracticeItem[];
  reviewEvents: ReviewEvent[];
  sessions: StudySession[];
  revisions: PracticeItemRevision[];
  draftRecoveries: DraftRecovery[];
}
export const dataTables = [
  'projects',
  'knowledgeUnits',
  'practiceItems',
  'reviewEvents',
  'sessions',
  'revisions',
  'draftRecoveries',
] as const;
export const legacyTables = dataTables.slice(0, 5);

export function migrateBackup(input: Backup): LearningData {
  if (input.databaseVersion === 2) return input.data as LearningData;
  const observed = new Map<string, PracticeSnapshot>();
  function add(snapshot: PracticeSnapshot) {
    const key = revisionId(snapshot.id, snapshot.revision);
    const existing = observed.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(snapshot))
      throw new Error('同一旧修订包含矛盾快照，请保留原始备份并检查');
    observed.set(key, snapshot);
  }
  for (const item of input.data.practiceItems)
    add({
      id: item.id,
      knowledgeUnitId: item.knowledgeUnitId,
      question: item.question,
      standardAnswer: item.standardAnswer,
      answerCriteria: item.answerCriteria,
      hints: item.hints,
      mnemonics: item.mnemonics,
      confusionWarnings: item.confusionWarnings,
      sourceReferences: item.sourceReferences,
      revision: item.revision,
    });
  input.data.reviewEvents.forEach((event) => add(event.snapshot));
  input.data.sessions.forEach((session) => session.queue.forEach(add));
  const revisions: PracticeItemRevision[] = [];
  for (const item of input.data.practiceItems) {
    let previous: string | null = null;
    for (const snapshot of [...observed.values()]
      .filter((snapshot) => snapshot.id === item.id)
      .sort((a, b) => a.revision - b.revision)) {
      const key = revisionId(item.id, snapshot.revision);
      revisions.push({
        id: key,
        practiceItemId: item.id,
        revisionNumber: snapshot.revision,
        previousRevisionId: previous,
        changeType: 'legacy',
        changeSummary: '由旧题库与历史快照恢复；修改原因未知，保守隔离各版本学习证据。',
        impactOnLearningState: 'reset',
        learningStateId: legacyStateId(item.id, snapshot.revision),
        createdAt: snapshot.revision === item.revision ? item.updatedAt : item.createdAt,
        snapshot,
      });
      previous = key;
    }
  }
  const data: LearningData = {
    projects: input.data.projects,
    knowledgeUnits: input.data.knowledgeUnits,
    practiceItems: input.data.practiceItems.map((item) => ({
      ...item,
      currentRevisionId: revisionId(item.id, item.revision),
      learningStateId: legacyStateId(item.id, item.revision),
    })),
    // Preserve the original event rows byte-for-byte in JSON form: no backfilled scores or snapshots.
    reviewEvents: input.data.reviewEvents,
    sessions: input.data.sessions.map((session) => ({
      ...session,
      generation: crypto.randomUUID(),
      planVersion: 0,
      draftVersion: 0,
      queue: session.queue.map((snapshot) => ({
        ...snapshot,
        revisionId: revisionId(snapshot.id, snapshot.revision),
        learningStateId: legacyStateId(snapshot.id, snapshot.revision),
      })),
    })),
    revisions,
    draftRecoveries: [],
  };
  validateBackup({ ...input, databaseVersion: 2, data });
  return data;
}
