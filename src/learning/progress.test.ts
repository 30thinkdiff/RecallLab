import { it, expect } from 'vitest';
import { learningProgress, nextReviewAt } from './progress';
import { initialMemory } from '../scheduling/engine';
import { snapshotOf } from '../domain/revisions';
import type { LearningProject, PracticeItem, ReviewEvent } from '../domain/models';
const now = new Date('2026-11-01T06:30:00Z'),
  tz = 'America/New_York';
const project: LearningProject = {
  id: 'p',
  name: '公开虚构',
  description: '',
  learningGoal: '',
  targetDate: '2026-11-08',
  dailyTimeBudget: 30,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  automaticGoal: { version: 'goal-v1', objective: 'exam' },
};
const card: PracticeItem = {
  id: 'c',
  projectId: 'p',
  knowledgeUnitId: 'k',
  question: '虚构规则应保留什么？',
  standardAnswer: '原文',
  answerCriteria: [],
  practiceType: 'free_recall',
  hints: [],
  mnemonics: '',
  confusionWarnings: '',
  sourceReferences: [],
  verificationStatus: 'user_authored',
  revision: 1,
  currentRevisionId: 'r1',
  learningStateId: 'state1',
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const event = (patch: Partial<ReviewEvent> = {}): ReviewEvent => ({
  id: 'e',
  schemaVersion: 5,
  projectId: 'p',
  practiceItemId: 'c',
  knowledgeUnitId: 'k',
  sessionId: 's',
  queueIndex: 0,
  timestamp: now.toISOString(),
  reviewedAt: now.toISOString(),
  responseMode: 'typed',
  userResponse: '原文',
  assessmentResult: 'correct',
  subjectiveMastery: null,
  confidenceBeforeReveal: null,
  hintLevelUsed: 0,
  wasAnswerRevealed: true,
  wasIndependentRecall: true,
  responseDuration: 12,
  errorTypes: [],
  interventionType: null,
  assessmentSource: 'user_checked',
  snapshot: snapshotOf(card),
  ...patch,
});
it('reports actual repeated attempts separately from covered items; skip does not become completion', () => {
  const events = [
    event(),
    event({ id: 'repeat' }),
    event({ id: 'skip', assessmentResult: 'skipped' }),
    event({ id: 'other', projectId: 'other' }),
  ];
  expect(learningProgress(project, [card], events, now, tz)).toMatchObject({
    todayRecords: 2,
    todayItems: 1,
    weak: [],
  });
});
it('never transfers old-version difficulty to a corrected answer, while retaining its actual daily history', () => {
  const failure = event({ assessmentResult: 'incorrect' }),
    updated = { ...card, learningStateId: 'state2', currentRevisionId: 'r2' };
  expect(learningProgress(project, [updated], [failure], now, tz)).toMatchObject({
    todayRecords: 1,
    weak: [],
  });
  expect(
    nextReviewAt(project, [updated], [initialMemory(card, now)], [failure], now),
  ).toBeUndefined();
});
it('hints remain weak and a later skipped, ungraded or purely subjective record does not manufacture success', () => {
  const hinted = event({ hintLevelUsed: 1, wasIndependentRecall: false });
  for (const next of [
    event({ assessmentResult: 'skipped' }),
    event({ assessmentResult: 'ungraded' }),
    event({ assessmentSource: 'self_report', subjectiveMastery: 4 }),
    event({ wasIndependentRecall: false }),
  ]) {
    expect(
      learningProgress(
        project,
        [card],
        [
          hinted,
          { ...next, id: 'later', reviewedAt: new Date(now.getTime() + 1000).toISOString() },
        ],
        now,
        tz,
      ).weak,
    ).toHaveLength(1);
  }
});
it('a subsequent qualified independent success clears the current weak flag without rewriting the failure', () => {
  const fail = event({ assessmentResult: 'partially_correct' }),
    success = event({
      id: 'later',
      reviewedAt: new Date(now.getTime() + 1000).toISOString(),
      assessmentSource: 'deterministic',
    }),
    before = structuredClone(fail);
  expect(learningProgress(project, [card], [fail, success], now, tz).weak).toHaveLength(0);
  expect(fail).toEqual(before);
});
it('uses the ten-minute retest floor and excludes archived, pending, other-section and obsolete memory states', () => {
  const memory = initialMemory(card, now),
    failure = event({ assessmentResult: 'incorrect' });
  expect(nextReviewAt(project, [card], [memory], [failure], now)).toBe(now.getTime() + 600000);
  for (const excluded of [
    { ...card, archivedAt: now.toISOString() },
    { ...card, learningIssue: { reason: '需核对', at: now.toISOString() } },
    { ...card, learningStateId: 'obsolete' },
  ])
    expect(nextReviewAt(project, [excluded], [memory], [failure], now)).toBeUndefined();
  expect(
    nextReviewAt(
      { ...project, automaticGoal: { ...project.automaticGoal!, sectionId: 's2' } },
      [card],
      [memory],
      [failure],
      now,
    ),
  ).toBeUndefined();
  expect(
    nextReviewAt(project, [card], [memory], [failure], new Date(now.getTime() + 600001)),
  ).toBeUndefined();
});
it('keeps the same local day over the repeated DST hour and distinguishes a different timezone midnight', () => {
  const e = event({ reviewedAt: '2026-11-01T05:30:00Z' });
  expect(learningProgress(project, [card], [e], now, tz).todayRecords).toBe(1);
  const midnight = new Date('2026-11-01T16:30:00Z');
  expect(learningProgress(project, [card], [e], midnight, 'Asia/Shanghai').todayRecords).toBe(0);
  expect(learningProgress(project, [card], [e], midnight, tz).todayRecords).toBe(1);
});

it('reports the retest waiting floor even before the FSRS short learning interval is due', () => {
  const failed = event({ assessmentResult: 'incorrect' });
  expect(learningProgress(project, [card], [failed], now, tz).retestWaiting).toBe(1);
  expect(
    learningProgress(project, [card], [failed], new Date(now.getTime() + 600001), tz).retestWaiting,
  ).toBe(0);
});
