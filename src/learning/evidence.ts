import { z } from 'zod';
import type { PracticeSnapshot, ReviewEvent } from '../domain/models';
export const automaticGoalSchema = z.object({
  objective: z.enum(['verbatim', 'keywords', 'understanding', 'exam']),
  sectionId: z.string().max(300).optional(),
  dailyNewLimit: z.number().int().min(0).max(1000).optional(),
  version: z.literal('goal-v1'),
});
export type AutomaticGoal = z.infer<typeof automaticGoalSchema>;
export const timingSchema = z.object({
  version: z.literal('active-v1'),
  presentedAt: z.iso.datetime(),
  attemptedAt: z.iso.datetime().nullable(),
  observedAt: z.iso.datetime(),
  activeMs: z.number().finite().min(0).max(86400000),
  backgroundMs: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  idleMs: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  unknownMs: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  interruptions: z.number().int().min(0).max(1000000),
});
export type AttemptTiming = z.infer<typeof timingSchema>;
export const feedbackSchema = z.object({
  checker: z.enum(['exact-short-v1', 'manual-v1']),
  literalMatch: z.boolean(),
  overridden: z.boolean(),
  sourceReady: z.boolean(),
});
export type QuickFeedback = z.infer<typeof feedbackSchema>;
export function exactShort(item: PracticeSnapshot, response: string) {
  const answer = item.standardAnswer.trim();
  return (
    answer.length > 0 &&
    answer.length <= 80 &&
    !/[\n；;]/u.test(answer) &&
    item.answerCriteria.length <= 1 &&
    response.trim().normalize('NFC') === answer.normalize('NFC')
  );
}
export function usableTiming(timing?: AttemptTiming): boolean {
  if (!timing || !timing.attemptedAt || !timingSchema.safeParse(timing).success) return false;
  const wall = Date.parse(timing.observedAt) - Date.parse(timing.attemptedAt);
  const pre = Math.max(0, Date.parse(timing.attemptedAt) - Date.parse(timing.presentedAt));
  const inactive = Math.max(0, timing.backgroundMs + timing.idleMs + timing.unknownMs - pre);
  return (
    timing.activeMs >= 1000 &&
    timing.activeMs <= 600000 &&
    wall > 0 &&
    timing.activeMs <= wall + 1000 &&
    inactive <= wall * 0.2 &&
    pre <= 60000
  );
}
export function assertLearningEvidence(event: ReviewEvent) {
  const f = event.quickFeedback;
  if (
    event.assessmentSource === 'deterministic' &&
    (!f ||
      f.checker !== 'exact-short-v1' ||
      !f.literalMatch ||
      f.overridden ||
      !f.sourceReady ||
      event.assessmentResult !== 'correct' ||
      event.responseMode !== 'typed' ||
      !event.wasIndependentRecall ||
      event.hintLevelUsed > 0 ||
      !exactShort(event.snapshot, event.userResponse))
  )
    throw new Error('自动核对缺少对应的短答案一致证据');
  if (f?.checker === 'exact-short-v1' && event.assessmentSource !== 'deterministic')
    throw new Error('自动核对与评价来源不一致');
  if (f && f.literalMatch !== exactShort(event.snapshot, event.userResponse))
    throw new Error('原始回答与文字核对结果不一致');
}
