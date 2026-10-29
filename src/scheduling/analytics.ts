import type { PracticeItem, ReviewEvent, PracticeItemRevision } from '../domain/models';
import type { MemoryState, SchedulingLog } from './types';
import { evidenceIsCurrent } from '../domain/revisions';
import { promptProblem } from '../domain/readiness';
import { localDay } from './planner';
export function reviewStatistics(
  cards: PracticeItem[],
  events: ReviewEvent[],
  memories: MemoryState[],
  logs: SchedulingLog[],
  revisions: PracticeItemRevision[],
  now: Date,
  timezone: string,
) {
  const ready = cards.filter((c) => !c.archivedAt && !promptProblem(c));
  const current = events.filter((e) => ready.some((c) => evidenceIsCurrent(e, c, revisions)));
  const independent = current.filter(
    (e) => e.wasIndependentRecall && e.assessmentResult !== 'skipped',
  );
  const manual = independent.filter(
    (e) =>
      e.assessmentSource === 'user_checked' &&
      e.assessmentResult !== 'ungraded' &&
      e.userResponse.trim(),
  );
  const correct = manual.filter((e) => e.assessmentResult === 'correct').length;
  const reported = independent.filter(
    (e) => e.assessmentSource === 'self_report' && e.assessmentResult !== 'ungraded',
  );
  const today = localDay(now, timezone),
    cutoff = new Date(Date.parse(today) - 6 * 86400000).toISOString().slice(0, 10);
  const actual = events.filter((e) => e.assessmentResult !== 'skipped');
  const todayEvents = actual.filter(
    (e) => localDay(new Date(e.reviewedAt ?? e.timestamp), timezone) === today,
  );
  const recent = actual.filter((e) => {
    const d = localDay(new Date(e.reviewedAt ?? e.timestamp), timezone);
    return d >= cutoff && d <= today;
  });
  const versions = new Map(logs.map((l) => [l.eventId, l.versionAfter]));
  const latest = new Map<string, ReviewEvent>();
  for (const event of [...independent].sort(
    (a, b) =>
      (a.reviewedAt ?? a.timestamp).localeCompare(b.reviewedAt ?? b.timestamp) ||
      (versions.get(a.id) ?? 0) - (versions.get(b.id) ?? 0) ||
      a.queueIndex - b.queueIndex,
  ))
    latest.set(event.practiceItemId, event);
  const distribution = [
    { label: '今日及逾期', count: 0 },
    { label: '未来 1–3 天', count: 0 },
    { label: '未来 4–7 天', count: 0 },
    { label: '7 天以后', count: 0 },
  ];
  for (const card of ready) {
    const m = memories.find((m) => m.id === card.learningStateId);
    if (!m || (!m.card.reps && !m.retestDue)) continue;
    const d = localDay(new Date(m.retestDue ?? m.due), timezone);
    const days = (Date.parse(d) - Date.parse(today)) / 86400000;
    distribution[days <= 0 ? 0 : days <= 3 ? 1 : days <= 7 ? 2 : 3]!.count++;
  }
  return {
    literalSamples: independent.filter(
      (e) => e.assessmentSource === 'deterministic' && e.assessmentResult === 'correct',
    ).length,
    manualSamples: manual.length,
    manualCorrect: correct,
    accuracy: manual.length ? correct / manual.length : null,
    reported: reported.length,
    reportedCorrect: reported.filter((e) => e.assessmentResult === 'correct').length,
    hintedSuccess: current.filter((e) => e.hintLevelUsed > 0 && e.assessmentResult === 'correct')
      .length,
    todayCompleted: todayEvents.length,
    recentPractice: recent.length,
    recentScheduled: recent.filter((e) => e.scheduling && e.scheduling.grade !== null).length,
    latest,
    distribution,
  };
}
