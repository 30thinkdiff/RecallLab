import type { PracticeItem, PracticeItemRevision, ReviewEvent } from './models';
import { evidenceIsCurrent } from './revisions';

export function summarize(events: ReviewEvent[]) {
  const attempts = events.filter((event) => event.assessmentResult !== 'skipped');
  const checked = events.filter(
    (event) =>
      event.assessmentSource !== 'none' &&
      ['correct', 'partially_correct', 'incorrect'].includes(event.assessmentResult),
  );
  return {
    total: events.length,
    attempts: attempts.length,
    correct: checked.filter((event) => event.assessmentResult === 'correct').length,
    partial: checked.filter((event) => event.assessmentResult === 'partially_correct').length,
    incorrect: checked.filter((event) => event.assessmentResult === 'incorrect').length,
    hintedCorrect: checked.filter(
      (event) => event.assessmentResult === 'correct' && event.hintLevelUsed > 0,
    ).length,
    independentCorrect: checked.filter(
      (event) => event.assessmentResult === 'correct' && event.wasIndependentRecall,
    ).length,
    unhinted: attempts.filter((event) => event.wasIndependentRecall).length,
    hinted: attempts.filter((event) => event.hintLevelUsed > 0).length,
    latest: [...events]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
      .filter((event) => event.subjectiveMastery !== null)
      .at(-1),
  };
}
export function itemEvidence(
  item: PracticeItem,
  events: ReviewEvent[],
  revisions: PracticeItemRevision[],
) {
  const all = events
    .filter((event) => event.practiceItemId === item.id)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const current = all.filter((event) => evidenceIsCurrent(event, item, revisions));
  return { all, current, allStats: summarize(all), currentStats: summarize(current) };
}
export function dailyCounts(events: ReviewEvent[], timeZone: string) {
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const days = new Map<string, number>();
  for (const event of events) {
    const day = format.format(new Date(event.timestamp));
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b));
}
