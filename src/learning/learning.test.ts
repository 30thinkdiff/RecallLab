import { it, expect } from 'vitest';
import { AttemptClock } from './timing';
import { exactShort, usableTiming } from './evidence';
import { buildAdaptivePlan, forecastGoal } from './adaptive';
import { initialMemory, advance } from '../scheduling/engine';
import { snapshotOf } from '../domain/revisions';
import type { PracticeItem, LearningProject, ReviewEvent } from '../domain/models';
import { calibrationReport } from './calibration';
export const testProject: LearningProject = {
  id: 'p',
  name: '公开虚构',
  description: '',
  learningGoal: '',
  targetDate: '2026-11-06',
  dailyTimeBudget: 30,
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  automaticGoal: { version: 'goal-v1', objective: 'exam' },
};
export const testCard = (id: string): PracticeItem => ({
  id,
  projectId: 'p',
  knowledgeUnitId: 'k' + id,
  question: `虚构条目${id}需要保留什么？`,
  standardAnswer: '原文',
  answerCriteria: [],
  practiceType: 'free_recall',
  hints: [],
  mnemonics: '',
  confusionWarnings: '',
  sourceReferences: [],
  verificationStatus: 'user_authored',
  revision: 1,
  currentRevisionId: id + ':r1',
  learningStateId: id + ':state',
  createdAt: testProject.createdAt,
  updatedAt: testProject.createdAt,
});
const now = new Date('2026-10-30T10:00:00Z'),
  tz = 'Asia/Shanghai';
it('does not count a hidden tab, a suspended timer or twenty minutes away as active recall', () => {
  const t = now.getTime(),
    c = new AttemptClock(t, now.toISOString());
  c.interact(t);
  c.snapshot(t + 2000);
  c.environment(t + 2000, false, false);
  c.snapshot(t + 4000);
  c.environment(t + 4000, true, true);
  const result = c.snapshot(t + 1204000);
  expect(result.activeMs).toBe(2000);
  expect(result.backgroundMs).toBe(2000);
  expect(result.unknownMs).toBeGreaterThan(1000000);
  expect(usableTiming(result)).toBe(false);
  const restored = new AttemptClock(t + 1300000, now.toISOString(), result);
  expect(restored.snapshot(t + 1300000).activeMs).toBe(2000);
});
it('expires activity after thirty seconds and uses exact short answers only, never similarity', () => {
  const t = now.getTime(),
    c = new AttemptClock(t, now.toISOString());
  c.interact(t);
  for (let i = 1; i <= 45; i++) c.snapshot(t + i * 2000);
  expect(c.snapshot(t + 90000).activeMs).toBe(30000);
  expect(c.snapshot(t + 90000).idleMs).toBe(60000);
  const card = testCard('1');
  expect(exactShort(card, ' 原文 ')).toBe(true);
  expect(exactShort(card, '原文相似')).toBe(false);
  expect(exactShort({ ...card, standardAnswer: '答案。'.repeat(30) }, '答案。'.repeat(30))).toBe(
    false,
  );
});
it('fits estimated work into budget and explicitly reports an infeasible/expired goal without touching histories', () => {
  const cards = Array.from({ length: 69 }, (_, i) => ({
    ...testCard(String(i)),
    standardAnswer: '公开长答案。'.repeat(30),
    answerCriteria: ['甲', '乙', '丙'],
  }));
  const before = JSON.stringify(cards);
  const p = forecastGoal(testProject, cards, [], [], now, tz);
  expect(p.estimatedSeconds).toBeLessThanOrEqual(1800);
  expect(p.gapMinutes).toBeGreaterThan(0);
  expect(p.suggestedDailyMinutes).toBeGreaterThan(30);
  expect(JSON.stringify(cards)).toBe(before);
  expect(
    forecastGoal({ ...testProject, targetDate: '2026-10-29' }, cards, [], [], now, tz).status,
  ).toBe('expired');
});
it('reserves a place for remedies despite many normal due items and does not repeat a strong not-due focus item', () => {
  const cards = Array.from({ length: 40 }, (_, i) => testCard(String(i)));
  const memories = cards.map((c) => {
    const m = initialMemory(c, now);
    m.card = advance(m.card, new Date(now.getTime() - 86400000), 3).card;
    m.due = now.toISOString();
    m.card.due = m.due;
    return m;
  });
  memories[39]!.retestDue = new Date(now.getTime() - 1000).toISOString();
  const strong = { ...testCard('strong'), focus: true };
  const sm = initialMemory(strong, now);
  sm.card = advance(sm.card, now, 3).card;
  sm.due = new Date(now.getTime() + 86400000 * 20).toISOString();
  sm.card.due = sm.due;
  const p = buildAdaptivePlan(
    { ...testProject, targetDate: '2026-11-20' },
    [...cards, strong],
    [...memories, sm],
    [],
    now,
    tz,
  );
  expect(p.selected.some((r) => r.item.id === '39')).toBe(true);
  expect(p.selected.some((r) => r.item.id === 'strong')).toBe(false);
  expect(p.estimatedSeconds).toBeLessThanOrEqual(1800);
});
it('separates an early exam check from FSRS and does not invent probabilities from absent evidence', () => {
  const card = { ...testCard('s'), focus: true };
  const memory = initialMemory(card, now);
  memory.card = advance(memory.card, now, 3).card;
  memory.due = new Date(now.getTime() + 86400000 * 10).toISOString();
  memory.card.due = memory.due;
  const p = buildAdaptivePlan(
    { ...testProject, targetDate: '2026-11-01' },
    [card],
    [memory],
    [],
    now,
    tz,
  );
  expect(p.selected[0]!.canSchedule).toBe(false);
  expect(calibrationReport([card], [], [])).toMatchObject({
    scores: null,
    parametersOptimized: false,
    status: 'insufficient',
  });
});
it('delays a failed independent recall instead of repeating immediately and caps same-day failure loops', () => {
  const card = testCard('fail');
  const memory = initialMemory(card, now);
  memory.card = advance(memory.card, now, 1).card;
  memory.due = new Date(now.getTime() - 1).toISOString();
  memory.card.due = memory.due;
  const event = {
    id: 'e',
    projectId: 'p',
    practiceItemId: card.id,
    snapshot: snapshotOf(card),
    timestamp: now.toISOString(),
    reviewedAt: now.toISOString(),
    assessmentResult: 'incorrect',
    hintLevelUsed: 0,
    scheduling: { grade: 1 },
  } as ReviewEvent;
  expect(buildAdaptivePlan(testProject, [card], [memory], [event], now, tz).selected).toHaveLength(
    0,
  );
  expect(
    buildAdaptivePlan(testProject, [card], [memory], [event], new Date(now.getTime() + 600001), tz)
      .selected,
  ).toHaveLength(1);
  expect(
    buildAdaptivePlan(
      testProject,
      [card],
      [memory],
      [event, { ...event, id: 'e2' }, { ...event, id: 'e3' }],
      new Date(now.getTime() + 600001),
      tz,
    ).attention,
  ).toBe(1);
});
it('interleaves explicitly identical answer groups without inventing semantic similarity and respects calendar goal days across DST', () => {
  const a = { ...testCard('a'), standardAnswer: '公开虚构的同一答案内容' },
    b = { ...testCard('b'), standardAnswer: a.standardAnswer },
    c = { ...testCard('c'), standardAnswer: '完全不同的虚构内容' };
  const plan = buildAdaptivePlan(testProject, [a, b, c], [], [], now, tz);
  expect(plan.selected.map((r) => r.item.id)).toEqual(['a', 'c', 'b']);
  const p = { ...testProject, targetDate: '2026-11-02' };
  expect(
    forecastGoal(p, [a], [], [], new Date('2026-11-01T04:30:00Z'), 'America/New_York').horizon,
  ).toBe(1);
  expect(
    forecastGoal(p, [a], [], [], new Date('2026-11-01T06:30:00Z'), 'America/New_York').horizon,
  ).toBe(1);
});
it('does not treat a quickly resumed partial clock as an uninterrupted personal-duration sample', () => {
  const start = now.getTime(),
    c = new AttemptClock(start, now.toISOString());
  c.interact(start);
  const saved = c.snapshot(start + 5000);
  expect(usableTiming(saved)).toBe(true);
  const resumed = new AttemptClock(start + 5500, now.toISOString(), saved);
  expect(usableTiming(resumed.snapshot(start + 6000))).toBe(false);
});
