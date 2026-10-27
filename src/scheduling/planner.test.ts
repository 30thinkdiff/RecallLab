import { it, expect } from 'vitest';
import { buildPlan, localDay, isDue } from './planner';
import { initialMemory } from './engine';
import { snapshotOf } from '../domain/revisions';
import { buildReviewEvent, freshDraft } from '../domain/review';
import { decide } from './policy';
import type { LearningProject, PracticeItem, StudySession } from '../domain/models';
const project: LearningProject = {
  id: 'p',
  name: '虚构',
  description: '',
  learningGoal: '',
  targetDate: '2026-10-29',
  dailyTimeBudget: 30,
  newCardLimit: 10,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const card = (id: string): PracticeItem => ({
  id,
  projectId: 'p',
  knowledgeUnitId: 'k' + id,
  question: `虚构规则 ${id} 是什么？`,
  standardAnswer: '虚构答案',
  answerCriteria: [],
  practiceType: 'free_recall',
  hints: [],
  mnemonics: '',
  confusionWarnings: '',
  sourceReferences: [{ label: '虚构', sectionId: 'section-a' }],
  verificationStatus: 'user_authored',
  revision: 1,
  currentRevisionId: `${id}:r1`,
  learningStateId: `${id}:state1`,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
});
const now = new Date('2026-10-27T15:50:00Z'),
  tz = 'Asia/Shanghai';
function eventFor(c: PracticeItem, time = now) {
  const stamp = time.toISOString();
  const session: StudySession = {
    id: 's' + c.id,
    projectId: 'p',
    queue: [snapshotOf(c)],
    index: 0,
    status: 'active',
    createdAt: stamp,
    completedAt: null,
    draft: {
      ...freshDraft(stamp),
      responseMode: 'typed',
      userResponse: '虚构回答',
      wasAnswerRevealed: true,
    },
    generation: 'generation',
    planVersion: 0,
    draftVersion: 0,
  };
  const event = buildReviewEvent(session, snapshotOf(c), 'correct', 3, stamp);
  return { ...event, scheduling: decide(event, true) };
}
it('orders due, retest, focus and new items, and limits new material', () => {
  const cards = [card('new'), { ...card('focus'), focus: true }, card('retry'), card('due')];
  const due = initialMemory(cards[3]!, new Date('2026-10-20T00:00Z'));
  due.card = { ...due.card, state: 2, reps: 1 };
  due.due = due.card.due = '2026-10-27T20:00:00Z';
  const retry = initialMemory(cards[2]!, now);
  retry.retestDue = '2026-10-27T15:00:00Z';
  const result = buildPlan(project, cards, [due, retry], [], now, tz);
  expect(result.selected.map((r) => r.item.id)).toEqual(['retry', 'focus', 'new']);
  // The due card is tomorrow in Shanghai, so it is not due on October 27.
  expect(result.due).toBe(0);
  expect(result.selected.find((r) => r.item.id === 'focus')?.canSchedule).toBe(true);
  due.due = due.card.due = '2026-10-27T10:00:00Z';
  expect(buildPlan(project, cards, [due, retry], [], now, tz).selected[0]?.reason).toBe('due');
});
it('handles local midnight and exact minute learning steps without UTC-day shortcuts', () => {
  const c = card('a'),
    m = initialMemory(c, now);
  m.card = { ...m.card, state: 2, reps: 1 };
  m.due = m.card.due = '2026-10-27T16:30:00Z';
  expect(localDay(now, tz)).toBe('2026-10-27');
  expect(isDue(m, now, tz)).toBe(false);
  expect(isDue(m, new Date('2026-10-27T16:01:00Z'), tz)).toBe(true);
  m.card.state = 1;
  expect(isDue(m, new Date('2026-10-27T16:01:00Z'), tz)).toBe(false);
  expect(isDue(m, new Date('2026-10-27T16:30:00Z'), tz)).toBe(true);
  expect(localDay(new Date('2026-03-08T07:30:00Z'), 'America/New_York')).toBe('2026-03-08');
});
it('uses explicit budget estimates, resets on the local next day, and permits only non-scheduling extra practice', () => {
  const c = card('a'),
    e = eventFor(c);
  const p = { ...project, dailyTimeBudget: 2 };
  expect(buildPlan(p, [c], [], [e], now, tz).budgetExhausted).toBe(true);
  expect(buildPlan(p, [c], [], [e], now, tz).selected).toHaveLength(0);
  const extra = buildPlan(p, [c], [], [e], now, tz, {
    mode: 'custom',
    customIds: [c.id],
    extraPractice: true,
  });
  expect(extra.selected[0]?.canSchedule).toBe(false);
  expect(buildPlan(p, [c], [], [e], new Date('2026-10-27T16:01Z'), tz).budgetExhausted).toBe(false);
});
it('keeps pending prompts out, honors chapters and custom selection and does not bypass a future retest', () => {
  const c = card('a'),
    draft = { ...card('draft'), question: '待完善题干（条目 1）' };
  const m = initialMemory(c, now);
  m.retestDue = '2026-10-28T00:00Z';
  m.card.reps = 1;
  const p = buildPlan(project, [c, draft], [m], [], now, tz);
  expect(p.pending).toBe(1);
  expect(p.selected).toHaveLength(0);
  expect(
    buildPlan(project, [c, draft], [], [], now, tz, { mode: 'chapter', sectionId: 'other' })
      .selected,
  ).toHaveLength(0);
  expect(
    buildPlan(project, [c, draft], [], [], now, tz, { mode: 'custom', customIds: ['a'] })
      .selected[0]?.canSchedule,
  ).toBe(false);
});
