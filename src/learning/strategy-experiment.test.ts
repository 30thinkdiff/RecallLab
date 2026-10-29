import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildAdaptivePlan, forecastGoal } from './adaptive';
import { buildPlan, isDue } from '../scheduling/planner';
import { initialMemory, advance } from '../scheduling/engine';
import { freshDraft, buildReviewEvent } from '../domain/review';
import { snapshotOf } from '../domain/revisions';
import type { LearningProject, PracticeItem, ReviewEvent, StudySession } from '../domain/models';
import type { MemoryState, Grade } from '../scheduling/types';
type Scenario = {
  name: string;
  count: number;
  days: number;
  success: number;
  long?: boolean;
  slow?: boolean;
  miss?: number[];
  grow?: boolean;
  revise?: boolean;
  change?: boolean;
};
const scenarios: Scenario[] = [
  { name: '69题7天考试', count: 69, days: 7, success: 0.85 },
  { name: '100题30天分散', count: 100, days: 30, success: 0.85 },
  { name: '69题高正确率', count: 69, days: 7, success: 0.98 },
  { name: '69题经常遗忘', count: 69, days: 7, success: 0.4 },
  { name: '69题长答案', count: 69, days: 7, success: 0.8, long: true },
  { name: '69题实际作答偏慢', count: 69, days: 7, success: 0.85, slow: true },
  { name: '持续增加新知识', count: 69, days: 14, success: 0.85, grow: true },
  { name: '12题提前覆盖', count: 12, days: 7, success: 0.98 },
  { name: '连续三天未学', count: 69, days: 14, success: 0.8, miss: [3, 4, 5] },
  { name: '资料中途修订', count: 69, days: 14, success: 0.85, revise: true },
  { name: '目标与预算改变', count: 69, days: 14, success: 0.85, change: true },
];
const initial = '2026-10-30T14:00:00Z',
  tz = 'America/New_York'; // Includes the actual autumn DST boundary.
const date = (day: number) => new Date(Date.parse(initial) + day * 86400000);
const project: LearningProject = {
  id: 'public',
  name: '公开虚构模拟',
  description: '',
  learningGoal: '',
  targetDate: '2026-11-06',
  dailyTimeBudget: 30,
  createdAt: initial,
  updatedAt: initial,
  automaticGoal: { version: 'goal-v1', objective: 'exam' },
};
function card(n: number, long = false): PracticeItem {
  return {
    id: `q${String(n).padStart(4, '0')}`,
    projectId: 'public',
    knowledgeUnitId: `k${n}`,
    question: `虚构条目${n}的要求是什么？`,
    standardAnswer: long ? '公开虚构内容与必要说明。'.repeat(35) : '蓝晶信号表示可进行下一步操作。',
    answerCriteria: long ? ['必要内容甲', '必要内容乙', '必要内容丙'] : [],
    practiceType: 'free_recall',
    hints: ['虚构提示'],
    mnemonics: '',
    confusionWarnings: '',
    focus: n % 10 === 0,
    sourceReferences: [],
    verificationStatus: 'user_authored',
    revision: 1,
    currentRevisionId: `q${n}:r1`,
    learningStateId: `q${n}:state1`,
    createdAt: initial,
    updatedAt: initial,
  };
}
function simulate(s: Scenario, strategy: 'A' | 'B' | 'C') {
  let p = { ...project, targetDate: date(s.days).toISOString().slice(0, 10) };
  const cards = Array.from({ length: s.count }, (_, i) => card(i, s.long));
  const states = new Map<string, MemoryState>(),
    events: ReviewEvent[] = [],
    frozen: string[] = [];
  const attempts = new Map<string, number>();
  const originalCoverage = new Set<string>();
  let seconds = 0,
    overrun = 0,
    estimatedViolations = 0,
    earlyStrong = 0,
    nonDueUpdates = 0,
    maxOverdue = 0,
    observedSelections = 0,
    changed = false;
  for (let day = 0; day < s.days; day++) {
    if (s.grow && day > 0) for (let k = 0; k < 2; k++) cards.push(card(cards.length, s.long));
    if (s.revise && day === Math.floor(s.days / 2))
      for (const c of cards.slice(0, 5)) {
        c.standardAnswer += '新增的更正内容。';
        c.currentRevisionId = c.id + ':r2';
        c.learningStateId = c.id + ':state2';
        c.revision = 2;
      }
    if (s.change && day === 3) {
      p = {
        ...p,
        targetDate: date(s.days + 7)
          .toISOString()
          .slice(0, 10),
        dailyTimeBudget: 15,
        updatedAt: date(day).toISOString(),
      };
      changed = true;
    }
    if (s.miss?.includes(day)) continue;
    let elapsed = 0;
    const completed = new Set<string>();
    const dayStart = date(day).getTime();
    const oldQueue =
      strategy === 'A'
        ? buildPlan(p, cards, [...states.values()], events, new Date(dayStart), tz).selected
        : [];
    if (strategy === 'A' && oldQueue.length * 120 > p.dailyTimeBudget * 60) estimatedViolations++;
    let sequence = 0;
    while (elapsed < p.dailyTimeBudget * 60 && sequence < 50) {
      const at = new Date(dayStart + elapsed * 1000);
      const adaptive =
        strategy === 'A'
          ? null
          : buildAdaptivePlan(p, cards, [...states.values()], events, at, tz, {
              personal: strategy === 'C',
              excludeStates: [...completed],
            });
      if (
        adaptive &&
        adaptive.estimatedSeconds > Math.max(0, p.dailyTimeBudget * 60 - adaptive.allocatedSeconds)
      )
        estimatedViolations++;
      const row = strategy === 'A' ? oldQueue[sequence] : adaptive?.selected[0];
      if (!row) break;
      const item = row.item;
      let memory = states.get(item.learningStateId);
      const fresh = !memory || memory.card.reps === 0;
      if ('estimateSource' in row && row.estimateSource === 'observed') observedSelections++;
      if (memory && !isDue(memory, at, tz) && !memory.retestDue && !fresh) {
        earlyStrong++;
        if (row.canSchedule) nonDueUpdates++;
      }
      const n = Number(item.id.slice(1)),
        ordinal = (attempts.get(item.learningStateId) ?? 0) + 1;
      attempts.set(item.learningStateId, ordinal);
      // Fixed pseudo-random responses independent of FSRS and the planner. This is NOT a validated human memory model.
      const draw = ((n * 37 + ordinal * 53 + day * 11) % 100) / 100;
      const hinted = draw >= s.success && draw < s.success + 0.08;
      const correct = draw < s.success;
      const grade: Grade | null = hinted ? null : correct ? 3 : 1;
      const recall = Math.round(
        (s.long ? 180 + (n % 5) * 35 : 22 + (n % 5) * 8) * (s.slow ? 2.4 : 1),
      );
      const actual = recall + 15 + (fresh ? 45 : 0);
      const reveal = new Date(at.getTime() + recall * 1000);
      const finished = new Date(at.getTime() + actual * 1000);
      const snap = snapshotOf(item);
      const session: StudySession = {
        id: `sim-${strategy}-${day}-${sequence}`,
        projectId: p.id,
        index: 0,
        queue: [snap],
        status: 'active',
        createdAt: at.toISOString(),
        completedAt: null,
        generation: 'simulation',
        planVersion: 0,
        draftVersion: 0,
        reviewPlan: {
          compact: true,
          mode: 'daily',
          timezone: tz,
          createdAt: at.toISOString(),
          budgetMinutes: p.dailyTimeBudget,
          entries: {},
        },
        draft: {
          ...freshDraft(at.toISOString(), 'typed'),
          userResponse: correct ? item.standardAnswer : '虚构回答遗漏',
          wasAnswerRevealed: true,
          revealedAt: reveal.toISOString(),
          hintLevelUsed: hinted ? 1 : 0,
          timing: {
            version: 'active-v1',
            presentedAt: at.toISOString(),
            attemptedAt: at.toISOString(),
            observedAt: reveal.toISOString(),
            activeMs: recall * 1000,
            backgroundMs: 0,
            idleMs: 0,
            unknownMs: 0,
            interruptions: 0,
          },
        },
      };
      const e = buildReviewEvent(
        session,
        snap,
        correct || hinted ? 'correct' : 'incorrect',
        null,
        finished.toISOString(),
      );
      e.reviewedAt = reveal.toISOString();
      e.scheduling = {
        policyVersion: 'v1',
        grade: row.canSchedule ? grade : null,
        reason: !row.canSchedule ? 'practice' : hinted ? 'hinted' : correct ? 'success' : 'failure',
        source: e.assessmentSource,
        criteriaMet: correct || hinted,
        difficulty: grade === 3 ? 'good' : null,
      };
      if (!memory) memory = initialMemory(item, at);
      if (row.canSchedule) {
        if (grade) {
          const next = advance(memory.card, reveal, grade);
          memory = {
            ...memory,
            card: next.card,
            due: next.card.due,
            retestDue: undefined,
            version: memory.version + 1,
            updatedAt: finished.toISOString(),
          };
        } else
          memory = {
            ...memory,
            retestDue: new Date(reveal.getTime() + 600000).toISOString(),
            version: memory.version + 1,
          };
        states.set(memory.id, memory);
      }
      events.push(e);
      frozen.push(JSON.stringify(e));
      completed.add(item.learningStateId);
      originalCoverage.add(item.id);
      elapsed += actual;
      sequence++;
    }
    seconds += elapsed;
    if (elapsed > p.dailyTimeBudget * 60) overrun++;
    for (const c of cards) {
      const m = states.get(c.learningStateId);
      if (m?.card.reps)
        maxOverdue = Math.max(
          maxOverdue,
          Math.max(0, (dayStart + elapsed * 1000 - Date.parse(m.due)) / 86400000),
        );
    }
    expect(events.map((e) => JSON.stringify(e))).toEqual(frozen);
  }
  const forecast = forecastGoal(p, cards, [...states.values()], events, date(s.days), tz);
  return {
    scenario: s.name,
    strategy,
    days: s.days,
    items: cards.length,
    attempts: events.length,
    originalCoverage: originalCoverage.size,
    currentLatestIndependentSuccess: cards.filter(
      (c) =>
        [...events]
          .reverse()
          .find(
            (e) =>
              e.snapshot.learningStateId === c.learningStateId &&
              e.wasIndependentRecall &&
              e.scheduling?.grade,
          )?.assessmentResult === 'correct',
    ).length,
    currentCoverage: cards.filter((c) => (states.get(c.learningStateId)?.card.reps ?? 0) > 0)
      .length,
    simulatedTaskMinutes: Math.round(seconds / 6) / 10,
    estimatedBudgetViolations: estimatedViolations,
    simulatedBudgetOverrunDays: overrun,
    nonDueFocusedExposures: earlyStrong,
    nonDueFSRSUpdates: nonDueUpdates,
    maxOverdueDays: Math.round(maxOverdue * 10) / 10,
    observedEstimateSelections: observedSelections,
    historyUnchanged: events.every((e, i) => JSON.stringify(e) === frozen[i]),
    revisedOldStatesRetained: s.revise
      ? [...states.values()].filter(
          (m) => m.id.endsWith('state1') && !cards.some((c) => c.learningStateId === m.id),
        ).length
      : 0,
    goalChanged: changed,
    finalForecast: forecast.status,
  };
}
it('compares retained V0.5.2 fixed queue A, goal/budget B and observed-duration C under identical fictional response rules', () => {
  const rows = scenarios.flatMap((s) => (['A', 'B', 'C'] as const).map((p) => simulate(s, p)));
  expect(rows).toHaveLength(33);
  expect(rows.every((r) => r.historyUnchanged)).toBe(true);
  expect(rows.every((r) => r.estimatedBudgetViolations === 0)).toBe(true);
  expect(rows.filter((r) => r.nonDueFSRSUpdates > 0)).toEqual([]);
  expect(rows.some((r) => r.strategy === 'C' && r.observedEstimateSelections > 0)).toBe(true);
  const path = 'evaluation/v06/strategy-results.json';
  if (process.env.RECALLLAB_WRITE_EVAL === '1') {
    mkdirSync('evaluation/v06', { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          kind: 'deterministic program simulation; no measured human recall improvement',
          clock: initial,
          timezone: tz,
          rows,
        },
        null,
        2,
      ) + '\n',
    );
  }
  expect(rows).toEqual(JSON.parse(readFileSync(path, 'utf8')).rows);
}, 120000);
