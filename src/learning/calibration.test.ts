import { it, expect } from 'vitest';
import { calibrationReport } from './calibration';
import { initialMemory, advance } from '../scheduling/engine';
import { buildReviewEvent, freshDraft } from '../domain/review';
import { snapshotOf } from '../domain/revisions';
import type { LearningProject, PracticeItem, ReviewEvent, StudySession } from '../domain/models';
import type { SchedulingLog } from '../scheduling/types';
const origin = '2026-09-01T10:00:00Z';
const project: LearningProject = {
  id: 'p',
  name: '公开虚构校准',
  description: '',
  learningGoal: '',
  targetDate: '',
  dailyTimeBudget: 30,
  createdAt: origin,
  updatedAt: origin,
};
const card: PracticeItem = {
  id: 'c',
  projectId: project.id,
  knowledgeUnitId: 'k',
  question: '虚构概念的要求是什么？',
  standardAnswer: '虚构完整答案',
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
  createdAt: origin,
  updatedAt: origin,
};
function pair(n: number) {
  const previous = new Date(Date.parse(origin) + n * 86400000),
    now = new Date(previous.getTime() + 86400000);
  const snapshot = snapshotOf(card);
  const session: StudySession = {
    id: 'session' + n,
    projectId: 'p',
    index: 0,
    queue: [snapshot],
    status: 'active',
    createdAt: now.toISOString(),
    completedAt: null,
    generation: 'public',
    planVersion: 0,
    draftVersion: 0,
    reviewPlan: {
      compact: true,
      mode: 'daily',
      timezone: 'UTC',
      createdAt: now.toISOString(),
      budgetMinutes: 30,
      entries: {},
    },
    draft: {
      ...freshDraft(now.toISOString(), 'typed'),
      userResponse: '公开虚构回答',
      wasAnswerRevealed: true,
      revealedAt: now.toISOString(),
    },
  };
  const event = buildReviewEvent(
    session,
    snapshot,
    n % 2 === 0 ? 'correct' : 'incorrect',
    null,
    now.toISOString(),
  );
  event.reviewedAt = now.toISOString();
  event.scheduling = {
    policyVersion: 'v1',
    grade: n % 2 === 0 ? 3 : 1,
    reason: n % 2 === 0 ? 'success' : 'failure',
    source: 'user_checked',
    criteriaMet: n % 2 === 0,
    difficulty: n % 2 === 0 ? 'good' : null,
  };
  const before = advance(initialMemory(card, previous).card, previous, 3).card;
  const log: SchedulingLog = {
    id: 'log' + n,
    eventId: event.id,
    projectId: 'p',
    practiceItemId: 'c',
    learningStateId: 'state1',
    revisionId: 'r1',
    timestamp: now.toISOString(),
    decision: event.scheduling,
    versionBefore: 1,
    versionAfter: 2,
    before,
    after: { ...before, stability: 999999 },
  };
  return { event, log };
}
it('uses frozen pre-answer predictions, chronological ordering and qualified IDs; excludes hints, subjective-only and invalid versions', () => {
  const pairs = Array.from({ length: 24 }, (_, i) => pair(i));
  const bad = pair(30);
  bad.event.hintLevelUsed = 1;
  const subjective = pair(31);
  subjective.event.assessmentSource = 'self_report';
  const future = pair(32);
  future.log.before!.last_review = '2099-01-01T00:00:00Z';
  const stale = pair(33);
  stale.log.learningStateId = 'old-state';
  const all = [...pairs, bad, subjective, future, stale],
    events: ReviewEvent[] = all.map((p) => p.event),
    logs = all.map((p) => p.log);
  const original = JSON.stringify({ events, logs });
  const report = calibrationReport([card], events, [...logs].reverse());
  expect(report.eligible).toBe(24);
  expect(report.eventIds).toEqual(pairs.map((p) => p.event.id));
  expect(report.chronologicalHoldout?.count).toBe(8);
  expect(report.scores?.brier).toBeGreaterThanOrEqual(0);
  expect(report.scores?.brier).toBeLessThanOrEqual(1);
  expect(report.parametersOptimized).toBe(false);
  expect(
    calibrationReport(
      [card],
      events,
      logs.map((l) => ({ ...l, after: undefined })),
    ).scores,
  ).toEqual(report.scores);
  expect(JSON.stringify({ events, logs })).toBe(original);
  expect(
    calibrationReport([{ ...card, learningStateId: 'corrected-state' }], events, logs),
  ).toMatchObject({ eligible: 0, scores: null, parametersOptimized: false });
});
