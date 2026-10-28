import { describe, expect, it } from 'vitest';
import { buildReviewEvent, freshDraft } from './review';
import type { PracticeSnapshot, StudySession } from './models';

const now = '2026-10-27T02:00:00.000Z';
const snapshot: PracticeSnapshot = {
  id: 'q',
  knowledgeUnitId: 'k',
  question: '问题',
  standardAnswer: '答案',
  answerCriteria: [],
  hints: [],
  mnemonics: '',
  confusionWarnings: '',
  sourceReferences: [],
  revision: 1,
};
function session(): StudySession {
  return {
    id: 's',
    generation: 'test',
    planVersion: 0,
    draftVersion: 0,
    projectId: 'p',
    queue: [snapshot],
    index: 0,
    status: 'active',
    createdAt: now,
    completedAt: null,
    draft: { ...freshDraft(now), wasAnswerRevealed: true, revealedAt: '2026-10-27T02:00:05.000Z' },
  };
}

describe('review evidence', () => {
  it('does not infer an independent recall from direct reveal or a high subjective score', () => {
    const event = buildReviewEvent(session(), snapshot, 'ungraded', 4, now);
    expect(event.wasIndependentRecall).toBe(false);
    expect(event.assessmentSource).toBe('none');
    expect(event.assessmentResult).toBe('ungraded');
    expect(event.responseDuration).toBe(5000);
  });
  it('labels mental recall as self report even when a user claims correctness', () => {
    const value = session();
    value.draft.attemptedBeforeReveal = true;
    const event = buildReviewEvent(value, snapshot, 'correct', 3, now);
    expect(event.assessmentSource).toBe('self_report');
    expect(event.wasIndependentRecall).toBe(true);
  });
  it('records typed and manually checked evidence without claiming automated grading', () => {
    const value = session();
    value.draft.responseMode = 'typed';
    value.draft.userResponse = '我的回答';
    const event = buildReviewEvent(value, snapshot, 'incorrect', 4, now);
    expect(event.assessmentSource).toBe('user_checked');
    expect(event.wasIndependentRecall).toBe(true);
    expect(event.assessmentResult).toBe('incorrect');
    expect(event.subjectiveMastery).toBe(4);
  });
});
