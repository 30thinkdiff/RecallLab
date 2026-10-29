import type { PracticeItem, ReviewEvent } from '../domain/models';
import type { SchedulingLog } from '../scheduling/types';
import { scheduler } from '../scheduling/engine';
// Predictions use the frozen PRE-review card, never the already updated card or future answer.
export function calibrationReport(
  cards: PracticeItem[],
  events: ReviewEvent[],
  logs: SchedulingLog[],
) {
  const states = new Set(cards.filter((c) => !c.archivedAt).map((c) => c.learningStateId));
  const eventMap = new Map(events.map((e) => [e.id, e]));
  const rows = logs
    .flatMap((log) => {
      const e = eventMap.get(log.eventId),
        before = log.before;
      if (
        !e ||
        !before?.last_review ||
        !states.has(log.learningStateId) ||
        !e.wasIndependentRecall ||
        e.hintLevelUsed ||
        !['user_checked', 'deterministic'].includes(e.assessmentSource) ||
        !log.decision.grade ||
        !['correct', 'incorrect', 'partially_correct'].includes(e.assessmentResult)
      )
        return [];
      const at = new Date(e.reviewedAt ?? e.timestamp);
      if (at.getTime() - Date.parse(before.last_review) < 86400000) return [];
      const p = Math.max(
        0.000001,
        Math.min(0.999999, scheduler.get_retrievability(before, at, false)),
      );
      return [
        {
          id: log.eventId,
          at: at.toISOString(),
          probability: p,
          outcome: e.assessmentResult === 'correct' ? 1 : 0,
        },
      ];
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const heldOut = rows.slice(Math.floor(rows.length * 0.7));
  const score = (data: typeof rows) => ({
    count: data.length,
    brier: data.reduce((n, r) => n + (r.probability - r.outcome) ** 2, 0) / data.length,
    logLoss:
      -data.reduce(
        (n, r) =>
          n + r.outcome * Math.log(r.probability) + (1 - r.outcome) * Math.log(1 - r.probability),
        0,
      ) / data.length,
  });
  return {
    algorithm: 'ts-fsrs@5.4.2/default-v1',
    eligible: rows.length,
    eventIds: rows.map((r) => r.id),
    status: rows.length >= 20 ? ('descriptive-only' as const) : ('insufficient' as const),
    scores: rows.length >= 20 ? score(rows) : null,
    chronologicalHoldout: rows.length >= 20 ? score(heldOut) : null,
    parametersOptimized: false,
    parametersVersion: 'default-v1',
    plan: 'Future optimizer: freeze eligible IDs and parameter version; chronological train/validation; compare held-out Brier/log-loss and calibration; retain default on insufficient data or regression. No fit or causal learning-effect claim.',
  };
}
