import type { LearningProject, PracticeItem, ReviewEvent } from '../domain/models';
import type { MemoryState } from '../scheduling/types';
import { promptProblem } from '../domain/readiness';
import { localDay } from '../scheduling/planner';

// Reporting only. These helpers never grade an answer or mutate scheduler evidence.
function currentCards(project: LearningProject, cards: PracticeItem[]) {
  return cards.filter(
    (c) =>
      c.projectId === project.id &&
      !c.archivedAt &&
      !promptProblem(c) &&
      (!project.automaticGoal?.sectionId ||
        c.sourceReferences.some((r) => r.sectionId === project.automaticGoal!.sectionId)),
  );
}
function latestEvidence(events: ReviewEvent[], states: Set<string>) {
  const latest = new Map<string, ReviewEvent>();
  for (const e of events) {
    const key = e.snapshot.learningStateId;
    if (
      !key ||
      !states.has(key) ||
      ['skipped', 'ungraded'].includes(e.assessmentResult) ||
      !['user_checked', 'deterministic'].includes(e.assessmentSource) ||
      (!e.wasIndependentRecall && e.hintLevelUsed === 0)
    )
      continue;
    const previous = latest.get(key);
    if (!previous || (previous.reviewedAt ?? previous.timestamp) < (e.reviewedAt ?? e.timestamp))
      latest.set(key, e);
  }
  return latest;
}
export function nextReviewAt(
  project: LearningProject,
  cards: PracticeItem[],
  memories: MemoryState[],
  events: ReviewEvent[],
  now: Date,
) {
  const states = new Set(currentCards(project, cards).map((c) => c.learningStateId));
  const latest = latestEvidence(
    events.filter((e) => e.projectId === project.id),
    states,
  );
  const future = memories
    .filter((m) => m.projectId === project.id && states.has(m.id))
    .map((m) => {
      const e = latest.get(m.id);
      return Math.max(
        Date.parse(m.retestDue ?? m.due),
        e &&
          (e.hintLevelUsed > 0 || ['incorrect', 'partially_correct'].includes(e.assessmentResult))
          ? Date.parse(e.reviewedAt ?? e.timestamp) + 600000
          : 0,
      );
    })
    .filter((t) => Number.isFinite(t) && t > now.getTime());
  return future.length ? Math.min(...future) : undefined;
}
export function learningProgress(
  project: LearningProject,
  cards: PracticeItem[],
  events: ReviewEvent[],
  now: Date,
  timezone: string,
) {
  const ready = currentCards(project, cards),
    states = new Set(ready.map((c) => c.learningStateId));
  const latest = latestEvidence(
    events.filter((e) => e.projectId === project.id),
    states,
  );
  const weak = ready.filter((c) => {
    const e = latest.get(c.learningStateId);
    return (
      e && (e.hintLevelUsed > 0 || ['incorrect', 'partially_correct'].includes(e.assessmentResult))
    );
  });
  const today = events.filter(
    (e) =>
      e.projectId === project.id &&
      e.assessmentResult !== 'skipped' &&
      localDay(new Date(e.reviewedAt ?? e.timestamp), timezone) === localDay(now, timezone),
  );
  return {
    todayRecords: today.length,
    todayItems: new Set(today.map((e) => e.practiceItemId)).size,
    weak,
    retestWaiting: weak.filter((c) => {
      const e = latest.get(c.learningStateId)!;
      return Date.parse(e.reviewedAt ?? e.timestamp) + 600000 > now.getTime();
    }).length,
  };
}
