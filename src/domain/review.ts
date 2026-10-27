import type {
  Performance,
  PracticeSnapshot,
  ReviewEvent,
  StudyDraft,
  StudySession,
  SubjectiveMastery,
} from './models';

export const masteryLabels = ['完全不会', '只有印象', '会一部分', '基本掌握', '完全掌握'] as const;
export const performanceLabels: Record<Performance, string> = {
  correct: '核对正确',
  partially_correct: '部分正确',
  incorrect: '不正确',
  ungraded: '未核对',
  skipped: '已跳过',
};

export function freshDraft(
  now: string,
  responseMode: StudyDraft['responseMode'] = 'quick',
): StudyDraft {
  return {
    responseMode,
    userResponse: '',
    hintLevelUsed: 0,
    wasAnswerRevealed: false,
    attemptedBeforeReveal: false,
    confidenceBeforeReveal: null,
    startedAt: now,
    revealedAt: null,
  };
}

export function buildReviewEvent(
  session: StudySession,
  snapshot: PracticeSnapshot,
  assessmentResult: Performance,
  subjectiveMastery: SubjectiveMastery | null,
  now: string,
): ReviewEvent {
  const draft = session.draft;
  const skipped = assessmentResult === 'skipped';
  if (!skipped && (!draft.wasAnswerRevealed || subjectiveMastery === null)) {
    throw new Error('请先揭晓答案并完成主观评价');
  }
  if (subjectiveMastery !== null && ![0, 1, 2, 3, 4].includes(subjectiveMastery)) {
    throw new Error('主观评价必须在 0–4 之间');
  }
  if (
    !['correct', 'partially_correct', 'incorrect', 'ungraded', 'skipped'].includes(assessmentResult)
  ) {
    throw new Error('无效的核对结果');
  }
  const attempted =
    draft.responseMode === 'typed' ? !!draft.userResponse.trim() : draft.attemptedBeforeReveal;
  return {
    id: `${session.id}:${session.index}`,
    schemaVersion: 1,
    projectId: session.projectId,
    practiceItemId: snapshot.id,
    knowledgeUnitId: snapshot.knowledgeUnitId,
    sessionId: session.id,
    queueIndex: session.index,
    timestamp: now,
    responseMode: draft.responseMode,
    userResponse: draft.userResponse,
    assessmentResult,
    subjectiveMastery: skipped ? null : subjectiveMastery,
    confidenceBeforeReveal: draft.confidenceBeforeReveal,
    hintLevelUsed: draft.hintLevelUsed,
    wasAnswerRevealed: draft.wasAnswerRevealed,
    wasIndependentRecall: !skipped && attempted && draft.hintLevelUsed === 0,
    responseDuration: Math.max(
      0,
      Date.parse(draft.revealedAt ?? now) - Date.parse(draft.startedAt),
    ),
    errorTypes: [],
    interventionType: draft.hintLevelUsed ? 'hint' : null,
    assessmentSource:
      skipped || assessmentResult === 'ungraded'
        ? 'none'
        : draft.responseMode === 'quick'
          ? 'self_report'
          : 'user_checked',
    snapshot,
  };
}
