import type { LearningProject, PracticeItem, ReviewEvent } from '../domain/models';
import type { MemoryState, QueueReason } from '../scheduling/types';
import { isDue, localDay, type QueueOptions } from '../scheduling/planner';
import { scheduler } from '../scheduling/engine';
import { promptProblem } from '../domain/readiness';
import { estimateSeconds, durationEstimator } from './estimates';
export interface AdaptiveOptions extends QueueOptions {
  personal?: boolean;
  reservedSeconds?: number;
  excludeStates?: string[];
  importance?: Record<string, number>;
}
export function daysToGoal(project: LearningProject, now: Date, tz: string) {
  return project.targetDate
    ? Math.round((Date.parse(project.targetDate) - Date.parse(localDay(now, tz))) / 86400000)
    : null;
}
export function predictedRecall(memory: MemoryState | undefined, at: Date) {
  if (
    !memory?.card.last_review ||
    memory.card.reps < 1 ||
    memory.card.stability <= 0 ||
    Date.parse(memory.card.last_review) > at.getTime()
  )
    return null;
  const value = scheduler.get_retrievability(memory.card, at, false);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}
export function buildAdaptivePlan(
  project: LearningProject,
  cards: PracticeItem[],
  memories: MemoryState[],
  events: ReviewEvent[],
  now: Date,
  tz: string,
  options: AdaptiveOptions = {},
) {
  const day = localDay(now, tz),
    days = daysToGoal(project, now, tz);
  const map = new Map(memories.map((m) => [m.id, m]));
  const history = new Map<string, ReviewEvent[]>();
  for (const e of events.filter((e) => e.projectId === project.id)) {
    const key = e.snapshot.learningStateId;
    if (!key) continue;
    const h = history.get(key) ?? [];
    h.push(e);
    history.set(key, h);
  }
  for (const h of history.values())
    h.sort(
      (a, b) =>
        (a.reviewedAt ?? a.timestamp).localeCompare(b.reviewedAt ?? b.timestamp) ||
        a.id.localeCompare(b.id),
    );
  const all = cards.filter((c) => c.projectId === project.id && !c.archivedAt);
  const ready = all.filter(
    (c) =>
      !promptProblem(c) &&
      !c.learningIssue &&
      (!project.automaticGoal?.sectionId ||
        c.sourceReferences.some((s) => s.sectionId === project.automaticGoal!.sectionId)),
  );
  const states = new Set(ready.map((c) => c.learningStateId));
  const effective = events.filter((e) => states.has(e.snapshot.learningStateId!));
  const estimateDuration = durationEstimator(effective, options.personal !== false);
  const today = events.filter(
    (e) =>
      e.projectId === project.id &&
      e.assessmentResult !== 'skipped' &&
      localDay(new Date(e.reviewedAt ?? e.timestamp), tz) === day,
  );
  const activeSeconds = today.reduce((s, e) => s + (e.timing?.activeMs ?? 0) / 1000, 0);
  const spent = today.reduce(
    (s, e) =>
      s +
      ((history.get(e.snapshot.learningStateId ?? '') ?? []).find(
        (x) => x.assessmentResult !== 'skipped',
      )?.id === e.id
        ? 45
        : 0) +
      (e.timing
        ? e.timing.activeMs / 1000 + 15
        : estimateSeconds(
            { ...e.snapshot, learningStateId: e.snapshot.learningStateId ?? '' } as PracticeItem,
            events,
            false,
            options.personal !== false,
          ).seconds),
    0,
  );
  const remaining = Math.max(0, project.dailyTimeBudget * 60 - spent);
  const introduced = new Set(
    today
      .filter(
        (e) =>
          e.scheduling &&
          !(history.get(e.snapshot.learningStateId ?? '') ?? []).some(
            (old) =>
              old.scheduling &&
              (old.reviewedAt ?? old.timestamp) < (e.reviewedAt ?? e.timestamp) &&
              localDay(new Date(old.reviewedAt ?? old.timestamp), tz) < day,
          ),
      )
      .map((e) => e.snapshot.learningStateId),
  );
  let newLeft = Math.max(0, (project.automaticGoal?.dailyNewLimit ?? 1000) - introduced.size);
  let due = 0,
    retest = 0,
    newCount = 0,
    relearn = 0,
    delayed = 0,
    attention = 0;
  const candidates = ready.flatMap((item) => {
    const memory = map.get(item.learningStateId),
      h = history.get(item.learningStateId) ?? [];
    const latest = [...h]
      .reverse()
      .find((e) => !['skipped', 'ungraded'].includes(e.assessmentResult));
    const fresh = (!memory || memory.card.reps === 0) && !memory?.retestDue;
    const retry = !!memory?.retestDue && Date.parse(memory.retestDue) <= now.getTime();
    const overdue = !!memory && isDue(memory, now, tz);
    if (overdue) due++;
    if (retry) retest++;
    if (fresh) newCount++;
    if (
      fresh &&
      memories.some(
        (m) => m.practiceItemId === item.id && m.id !== item.learningStateId && m.card.reps > 0,
      )
    )
      relearn++;
    const failures = h.filter(
      (e) =>
        ['incorrect', 'partially_correct'].includes(e.assessmentResult) &&
        e.scheduling?.grade === 1,
    );
    const failuresToday = failures.filter(
      (e) => localDay(new Date(e.reviewedAt ?? e.timestamp), tz) === day,
    ).length;
    if (failuresToday >= 3) {
      attention++;
      return [];
    }
    const weak =
      !!latest &&
      (latest.hintLevelUsed > 0 ||
        ['incorrect', 'partially_correct'].includes(latest.assessmentResult));
    const earlyCheck =
      days !== null &&
      days >= 0 &&
      days <= 2 &&
      project.automaticGoal?.objective === 'exam' &&
      !!item.focus &&
      !overdue &&
      !retry &&
      !fresh &&
      !h.some((e) => localDay(new Date(e.reviewedAt ?? e.timestamp), tz) === day);
    if (!overdue && !retry && !fresh && !earlyCheck) return [];
    if (
      weak &&
      latest &&
      now.getTime() - Date.parse(latest.reviewedAt ?? latest.timestamp) < 600000
    ) {
      delayed++;
      return [];
    }
    if (options.excludeStates?.includes(item.learningStateId)) return [];
    if (options.mode === 'new' && !fresh) return [];
    if (options.mode === 'due' && !overdue && !retry) return [];
    if (options.mode === 'weak' && !weak) return [];
    if (options.mode === 'custom' && !options.customIds?.includes(item.id)) return [];
    if (
      options.mode === 'chapter' &&
      !item.sourceReferences.some((r) => r.sectionId === options.sectionId)
    )
      return [];
    const estimate = estimateDuration(item, fresh);
    if (
      estimate.source === 'generic' &&
      ['verbatim', 'understanding'].includes(project.automaticGoal?.objective ?? '')
    )
      estimate.seconds = Math.ceil(estimate.seconds * 1.15);
    const overdueDays = memory
      ? Math.max(0, (now.getTime() - Date.parse(memory.retestDue ?? memory.due)) / 86400000)
      : 0;
    const recall = predictedRecall(memory, now);
    const importance =
      Math.max(1, Math.min(5, options.importance?.[item.knowledgeUnitId] ?? 1)) *
      (item.focus ? 1.5 : 1);
    const score =
      (fresh ? 25 : 45) +
      Math.min(30, overdueDays * 5) +
      (weak ? 45 : 0) +
      (retry ? 30 : 0) +
      (recall === null ? 0 : (1 - recall) * 20) +
      (days !== null && days <= 7 && fresh ? 30 : 0) +
      importance * 8;
    const reason: QueueReason = retry ? 'retest' : overdue ? 'due' : fresh ? 'new' : 'focus';
    const canSchedule = !earlyCheck && options.mode !== 'custom' && !options.extraPractice;
    const explanation = [
      reason === 'due'
        ? '达到FSRS复习时间'
        : reason === 'retest'
          ? '提示/揭晓后需要无提示复测'
          : fresh
            ? '引入尚未建立可靠记录的知识'
            : '考前重点抽查，不改变长期间隔',
      weak ? '近期回忆失败或依赖提示' : '',
      failures.length >= 2 ? '反复困难：先核对原文和要点，必要时拆小任务' : '',
      estimate.source === 'observed'
        ? `参考${estimate.samples}次合格作答耗时`
        : '暂无足够耗时样本，使用题长/要点的通用估计',
    ]
      .filter(Boolean)
      .join('；');
    return [
      {
        item,
        reason,
        canSchedule,
        estimatedSeconds: estimate.seconds,
        explanation,
        score,
        density: score / Math.sqrt(estimate.seconds),
        weak,
        overdueDays,
        fresh,
        estimateSource: estimate.source,
      },
    ];
  });
  candidates.sort(
    (a, b) =>
      b.density - a.density || b.overdueDays - a.overdueDays || a.item.id.localeCompare(b.item.id),
  );
  const selected: typeof candidates = [];
  let used = 0;
  const capacity = Math.max(
    0,
    (options.extraPractice ? project.dailyTimeBudget * 60 : remaining) -
      (options.reservedSeconds ?? 0),
  );
  const add = (c: (typeof candidates)[number]) => {
    if (
      selected.includes(c) ||
      selected.length >= 50 ||
      c.estimatedSeconds + used > capacity ||
      (c.fresh && newLeft <= 0)
    )
      return false;
    selected.push(c);
    used += c.estimatedSeconds;
    if (c.fresh) newLeft--;
    return true;
  };
  const remedies = candidates.filter((c) => c.weak || c.reason === 'retest');
  if (remedies.length) add(remedies[0]!);
  const starved = [...candidates]
    .filter((c) => c.overdueDays >= 3)
    .sort((a, b) => b.overdueDays - a.overdueDays || a.item.id.localeCompare(b.item.id));
  if (starved.length) add(starved[0]!);
  // Coverage gets a limited reservation near the deadline, not the whole budget.
  if (days !== null && days > 0) {
    for (const c of candidates.filter((c) => c.fresh)) {
      if (
        selected.filter((x) => x.fresh).reduce((s, x) => s + x.estimatedSeconds, 0) >=
        capacity * 0.3
      )
        break;
      add(c);
    }
  }
  for (const c of remedies) {
    if (
      selected
        .filter((x) => x.weak || x.reason === 'retest')
        .reduce((s, x) => s + x.estimatedSeconds, 0) >=
      capacity * 0.25
    )
      break;
    add(c);
  }
  for (const c of candidates) add(c);
  const same = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
    a.item.knowledgeUnitId === b.item.knowledgeUnitId ||
    (a.item.standardAnswer.length >= 8 &&
      a.item.standardAnswer.trim() === b.item.standardAnswer.trim());
  for (let i = 1; i < selected.length; i++)
    if (same(selected[i - 1]!, selected[i]!)) {
      const next = selected.findIndex((c, j) => j > i && !same(selected[i - 1]!, c));
      if (next > i) {
        const displaced = selected[i]!;
        selected[i] = selected[next]!;
        selected[next] = displaced;
        selected[i]!.explanation += ' 同源或完全同答案条目尽量间隔，不代表机器理解了相似概念。';
      }
    }
  return {
    selected,
    due,
    retest,
    newCount,
    pending: all.length - ready.length,
    relearn,
    completedToday: today.length,
    budgetRemaining: Math.round((remaining / 60) * 10) / 10,
    budgetExhausted: remaining < 1,
    estimatedSeconds: used,
    recordedActiveSeconds: Math.round(activeSeconds),
    allocatedSeconds: Math.round(spent),
    delayed,
    attention,
    daysToGoal: days,
    examNear: days !== null && days >= 0 && days <= 7,
    eligible: candidates.length,
    unfit: candidates.filter((c) => c.estimatedSeconds > capacity).length,
  };
}
export function forecastGoal(
  project: LearningProject,
  cards: PracticeItem[],
  memories: MemoryState[],
  events: ReviewEvent[],
  now: Date,
  tz: string,
) {
  const plan = buildAdaptivePlan(project, cards, memories, events, now, tz);
  const ready = cards.filter(
    (c) =>
      c.projectId === project.id &&
      !c.archivedAt &&
      !promptProblem(c) &&
      !c.learningIssue &&
      (!project.automaticGoal?.sectionId ||
        c.sourceReferences.some((r) => r.sectionId === project.automaticGoal!.sectionId)),
  );
  const byId = new Map(memories.map((m) => [m.id, m]));
  const days = plan.daysToGoal;
  const horizon = days === null ? 14 : Math.max(0, days);
  const newCards = ready.filter((c) => !byId.get(c.learningStateId)?.card.reps);
  const currentStates = new Set(ready.map((c) => c.learningStateId));
  const duration = durationEstimator(
    events.filter((e) => currentStates.has(e.snapshot.learningStateId!)),
  );
  const cost = (c: PracticeItem, fresh = false) => {
    const e = duration(c, fresh);
    return e.source === 'generic' &&
      ['verbatim', 'understanding'].includes(project.automaticGoal?.objective ?? '')
      ? Math.ceil(e.seconds * 1.15)
      : e.seconds;
  };
  const firstCost = newCards.reduce((s, c) => s + cost(c, true), 0);
  const repeats = horizon > 1 ? Math.min(3, Math.ceil(horizon / 7)) : 0;
  const followup = newCards.reduce((s, c) => s + cost(c) * repeats, 0);
  const dueCost = ready
    .filter((c) => {
      const m = byId.get(c.learningStateId);
      return m?.card.reps && Date.parse(m.retestDue ?? m.due) <= now.getTime() + horizon * 86400000;
    })
    .reduce((s, c) => s + cost(c), 0);
  const minimum = firstCost + dueCost,
    expected = minimum + followup;
  const contingency = expected * 0.25;
  const available = Math.max(0, horizon * project.dailyTimeBudget * 60 - plan.allocatedSeconds);
  const gap = Math.max(0, Math.ceil((expected + contingency - available) / 60));
  const predictedCoverage = ready.filter((c) => {
    const m = byId.get(c.learningStateId);
    return m && m.card.reps > 0;
  }).length;
  return {
    ...plan,
    total: cards.filter((c) => c.projectId === project.id && !c.archivedAt).length,
    ready: ready.length,
    covered: predictedCoverage,
    horizon,
    minimumMinutes: Math.ceil(minimum / 60),
    expectedMinutes: Math.ceil(expected / 60),
    remedyMinutes: Math.ceil(contingency / 60),
    availableMinutes: Math.floor(available / 60),
    gapMinutes: gap,
    suggestedDailyMinutes: horizon
      ? Math.ceil((expected + contingency + plan.allocatedSeconds) / 60 / horizon)
      : null,
    status:
      days !== null && days <= 0
        ? ('expired' as const)
        : gap
          ? ('risk' as const)
          : ('possible' as const),
    estimateSamples: events.filter(
      (e) => e.projectId === project.id && e.timing && e.wasIndependentRecall,
    ).length,
  };
}
