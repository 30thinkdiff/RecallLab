import type { PracticeItem, PracticeSnapshot, ReviewEvent } from '../domain/models';
import { usableTiming } from './evidence';
export const complexityBucket = (item: PracticeSnapshot) =>
  item.answerCriteria.length >= 3 || item.standardAnswer.length > 180
    ? 'long'
    : item.standardAnswer.length > 60
      ? 'medium'
      : 'short';
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
// Pre-index qualified observations once per plan instead of parsing every historical clock per card.
export function durationEstimator(events: ReviewEvent[], personal = true) {
  const own = new Map<string, number[]>(),
    peers = new Map<string, { values: number[]; states: Set<string> }>();
  for (const e of events) {
    if (
      !personal ||
      !e.snapshot.learningStateId ||
      !e.wasIndependentRecall ||
      !['user_checked', 'deterministic'].includes(e.assessmentSource) ||
      e.hintLevelUsed ||
      !usableTiming(e.timing) ||
      e.assessmentResult === 'skipped'
    )
      continue;
    const key = e.snapshot.learningStateId,
      ms = e.timing!.activeMs / 1000,
      values = own.get(key) ?? [];
    values.push(ms);
    own.set(key, values);
    const bucket = complexityBucket(e.snapshot),
      p = peers.get(bucket) ?? { values: [], states: new Set<string>() };
    p.values.push(ms);
    p.states.add(key);
    peers.set(bucket, p);
  }
  const medians = new Map(
    [...own]
      .filter(([, v]) => v.length >= 3)
      .map(([k, v]) => [k, { value: median(v), count: v.length }]),
  );
  const bucketMedians = new Map(
    [...peers]
      .filter(([, p]) => p.values.length >= 5 && p.states.size >= 3)
      .map(([k, p]) => [k, { value: median(p.values), count: p.values.length }]),
  );
  return (item: PracticeItem, fresh = false) => {
    const base = Math.max(
      30,
      Math.min(600, 20 + item.standardAnswer.length * 0.45 + item.answerCriteria.length * 12),
    );
    const observed = medians.get(item.learningStateId) ?? bucketMedians.get(complexityBucket(item));
    const recall = observed
      ? Math.max(base * 0.5, Math.min(base * 2, base * 0.35 + observed.value * 0.65))
      : base;
    return {
      seconds: Math.ceil(recall + 15 + (fresh ? 45 : 0)),
      recallSeconds: Math.ceil(recall),
      source: observed ? ('observed' as const) : ('generic' as const),
      samples: observed?.count ?? 0,
    };
  };
}
export function estimateSeconds(
  item: PracticeItem,
  events: ReviewEvent[],
  fresh = false,
  personal = true,
) {
  return durationEstimator(events, personal)(item, fresh);
}
