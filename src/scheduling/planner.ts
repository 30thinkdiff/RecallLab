import type { LearningProject, PracticeItem, ReviewEvent } from '../domain/models';
import { promptProblem } from '../domain/readiness';
import type { MemoryState, ReviewMode, QueueReason } from './types';
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
export function localDay(date: Date, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  let formatter = dayFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    if (dayFormatters.size > 20) dayFormatters.clear();
    dayFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(date);
  return ['year', 'month', 'day'].map((k) => parts.find((p) => p.type === k)!.value).join('-');
}
export function isDue(memory: MemoryState, now: Date, timezone: string) {
  return (
    !memory.retestDue &&
    memory.card.reps > 0 &&
    (memory.card.state === 2
      ? localDay(new Date(memory.due), timezone) <= localDay(now, timezone)
      : Date.parse(memory.due) <= now.getTime())
  );
}
export interface QueueOptions {
  mode?: ReviewMode;
  sectionId?: string;
  customIds?: string[];
  extraPractice?: boolean;
}
export function buildPlan(
  project: LearningProject,
  cards: PracticeItem[],
  memories: MemoryState[],
  events: ReviewEvent[],
  now: Date,
  timezone: string,
  options: QueueOptions = {},
) {
  const mode = options.mode ?? 'daily',
    day = localDay(now, timezone);
  const all = cards.filter((c) => c.projectId === project.id && !c.archivedAt),
    ready = all.filter((c) => !promptProblem(c)),
    map = new Map(memories.map((m) => [m.id, m]));
  const current = (c: PracticeItem) => map.get(c.learningStateId);
  const due = (c: PracticeItem) => {
    const m = current(c);
    return !!m && isDue(m, now, timezone);
  };
  const retry = (c: PracticeItem) => {
    const m = current(c);
    return !!m?.retestDue && Date.parse(m.retestDue) <= now.getTime();
  };
  const fresh = (c: PracticeItem) => {
    const m = current(c);
    return (!m || m.card.reps === 0) && !m?.retestDue;
  };
  const weak = (c: PracticeItem) => {
    if (current(c)?.retestDue) return true;
    const latest = events
      .filter(
        (e) =>
          e.practiceItemId === c.id &&
          e.snapshot.learningStateId === c.learningStateId &&
          e.assessmentResult !== 'skipped' &&
          e.assessmentResult !== 'ungraded',
      )
      .sort(
        (a, b) =>
          (a.reviewedAt ?? a.timestamp).localeCompare(b.reviewedAt ?? b.timestamp) ||
          a.queueIndex - b.queueIndex ||
          a.id.localeCompare(b.id),
      )
      .slice(-1)[0];
    return (
      !!latest &&
      (latest.assessmentResult === 'incorrect' ||
        latest.assessmentResult === 'partially_correct' ||
        latest.hintLevelUsed > 0)
    );
  };
  const spent = events.filter(
    (e) =>
      e.projectId === project.id &&
      e.assessmentResult !== 'skipped' &&
      localDay(new Date(e.reviewedAt ?? e.timestamp), timezone) === day,
  );
  const quota = Math.max(1, Math.floor(project.dailyTimeBudget / 2));
  const remaining = Math.max(0, quota - spent.length);
  const firstSeen = new Map<string, string>();
  for (const e of events)
    if (e.scheduling && e.assessmentResult !== 'skipped' && e.snapshot.learningStateId) {
      const key = e.snapshot.learningStateId;
      const old = firstSeen.get(key);
      if (!old || (e.reviewedAt ?? e.timestamp) < old)
        firstSeen.set(key, e.reviewedAt ?? e.timestamp);
    }
  const introduced = new Set(
    spent
      .filter(
        (e) =>
          e.scheduling &&
          e.snapshot.learningStateId &&
          localDay(new Date(firstSeen.get(e.snapshot.learningStateId)!), timezone) === day,
      )
      .map((e) => e.snapshot.learningStateId),
  );
  const newRemaining = Math.max(0, (project.newCardLimit ?? 10) - introduced.size);
  let pool = ready;
  if (mode === 'due') pool = pool.filter((c) => due(c) || retry(c));
  if (mode === 'new') pool = pool.filter(fresh);
  if (mode === 'weak') pool = pool.filter(weak);
  if (mode === 'chapter')
    pool = pool.filter((c) => c.sourceReferences.some((r) => r.sectionId === options.sectionId));
  if (mode === 'custom') pool = pool.filter((c) => options.customIds?.includes(c.id));
  if (mode === 'daily') pool = pool.filter((c) => due(c) || retry(c) || c.focus || fresh(c));
  const rank = (c: PracticeItem) => (due(c) ? 0 : retry(c) ? 1 : c.focus ? 2 : 3);
  pool.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 0 ? current(a)!.due.localeCompare(current(b)!.due) : 0) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  const examNear =
    !!project.targetDate &&
    project.targetDate >= day &&
    (Date.parse(project.targetDate) - Date.parse(day)) / 86400000 <= 7;
  if (examNear) pool.sort((a, b) => rank(a) - rank(b) || Number(weak(b)) - Number(weak(a)));
  const selected: { item: PracticeItem; reason: QueueReason; canSchedule: boolean }[] = [];
  let newCount = 0;
  const cap = options.extraPractice ? Math.max(1, Math.min(100, pool.length)) : remaining;
  for (const item of pool) {
    if (selected.length >= cap) break;
    const isNew = fresh(item);
    if (isNew && mode !== 'custom' && newCount >= newRemaining) continue;
    const canSchedule =
      mode !== 'custom' && !options.extraPractice && (due(item) || retry(item) || isNew);
    if (isNew) newCount++;
    selected.push({
      item,
      reason: due(item)
        ? 'due'
        : retry(item)
          ? 'retest'
          : isNew
            ? 'new'
            : item.focus
              ? 'focus'
              : 'practice',
      canSchedule,
    });
  }
  return {
    selected,
    due: ready.filter(due).length,
    retest: ready.filter(retry).length,
    upcomingToday: ready.filter((c) => {
      const m = current(c);
      if (!m || due(c) || retry(c)) return false;
      const next = m.retestDue ?? (m.card.reps > 0 ? m.due : null);
      return (
        !!next && Date.parse(next) > now.getTime() && localDay(new Date(next), timezone) === day
      );
    }).length,
    newCount: ready.filter(fresh).length,
    pending: all.length - ready.length,
    relearn: ready.filter(
      (c) =>
        fresh(c) &&
        memories.some(
          (m) =>
            m.practiceItemId === c.id && m.learningStateId !== c.learningStateId && m.card.reps > 0,
        ),
    ).length,
    completedToday: spent.length,
    budgetRemaining: remaining * 2,
    budgetExhausted: remaining === 0,
    examNear,
  };
}
