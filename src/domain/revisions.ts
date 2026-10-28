import type {
  PracticeItem,
  PracticeItemRevision,
  PracticeSnapshot,
  ReviewEvent,
  StudySession,
  SessionToken,
} from './models';

export const revisionId = (itemId: string, number: number) => `${itemId}:r${number}`;
export const legacyStateId = (itemId: string, number: number) =>
  `${revisionId(itemId, number)}:learning`;
export function snapshotOf(item: PracticeItem): PracticeSnapshot {
  return {
    id: item.id,
    knowledgeUnitId: item.knowledgeUnitId,
    question: item.question,
    standardAnswer: item.standardAnswer,
    answerCriteria: [...item.answerCriteria],
    hints: [...item.hints],
    mnemonics: item.mnemonics,
    confusionWarnings: item.confusionWarnings,
    sourceReferences: structuredClone(item.sourceReferences),
    revision: item.revision,
    revisionId: item.currentRevisionId,
    learningStateId: item.learningStateId,
  };
}
export function evidenceIsCurrent(
  event: ReviewEvent,
  item: PracticeItem,
  revisions: PracticeItemRevision[],
) {
  const state =
    event.snapshot.learningStateId ??
    revisions.find((r) => r.id === revisionId(event.practiceItemId, event.snapshot.revision))
      ?.learningStateId;
  return event.practiceItemId === item.id && state === item.learningStateId;
}
export function tokenOf(session: StudySession): SessionToken {
  const snapshot = session.queue[session.index];
  return {
    generation: session.generation,
    planVersion: session.planVersion,
    draftVersion: session.draftVersion,
    revisionId:
      snapshot?.revisionId ?? (snapshot ? revisionId(snapshot.id, snapshot.revision) : ''),
  };
}
export class ConflictError extends Error {
  constructor(message = '另一页面已更新草稿，请保留本页输入并载入最新状态。') {
    super(message);
    this.name = 'ConflictError';
  }
}
export const changeLabels = {
  initial: '首次创建',
  legacy: '旧版迁移（影响未知）',
  cosmetic: '格式性修改',
  clarification: '澄清说明',
  substantive: '实质性更正',
  replacement: '知识替换',
} as const;
