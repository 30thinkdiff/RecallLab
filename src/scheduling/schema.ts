import { z } from 'zod';
const id = z.string().min(1).max(300),
  date = z.iso.datetime();
export const storedCardSchema = z.object({
  due: date,
  stability: z.number().finite().nonnegative(),
  difficulty: z.number().finite().nonnegative(),
  elapsed_days: z.number().nonnegative(),
  scheduled_days: z.number().nonnegative(),
  learning_steps: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  last_review: date.optional(),
});
export const decisionSchema = z.object({
  reviewedAt: date.optional(),
  policyVersion: z.literal('v1'),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  reason: z.enum([
    'success',
    'failure',
    'partial_failure',
    'hinted',
    'no_attempt',
    'skipped',
    'ungraded',
    'practice',
  ]),
  source: z.enum(['self_report', 'user_checked', 'deterministic', 'none']),
  criteriaMet: z.boolean().nullable(),
  difficulty: z.enum(['hard', 'good', 'easy']).nullable(),
  nextDue: date.optional(),
  retestDue: date.optional(),
});
export const planSchema = z.object({
  remainingBudgetSeconds: z.number().finite().nonnegative().max(86400).optional(),
  goalUpdatedAt: date.optional(),
  adaptive: z.boolean().optional(),
  compact: z.boolean().optional(),
  practiceOnly: z.boolean().optional(),
  mode: z.enum(['daily', 'due', 'new', 'weak', 'chapter', 'custom']),
  timezone: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, '复习计划时区无效'),
  createdAt: date,
  budgetMinutes: z.number().int().min(1).max(1440),
  entries: z.record(
    id,
    z.object({
      explanation: z.string().max(2000).optional(),
      estimatedSeconds: z.number().positive().max(3600).optional(),
      stateVersion: z.number().int().nonnegative(),
      reason: z.enum(['due', 'retest', 'focus', 'new', 'practice']),
      canSchedule: z.boolean(),
    }),
  ),
});
export const memorySchema = z.object({
  id,
  projectId: id,
  practiceItemId: id,
  knowledgeUnitId: id,
  learningStateId: id,
  revisionId: id,
  algorithm: z.literal('ts-fsrs@5.4.2/default-v1'),
  version: z.number().int().nonnegative(),
  card: storedCardSchema,
  due: date,
  retestDue: date.optional(),
  createdAt: date,
  updatedAt: date,
});
export const schedulingLogSchema = z.object({
  id,
  eventId: id,
  projectId: id,
  practiceItemId: id,
  learningStateId: id,
  revisionId: id,
  timestamp: date,
  decision: decisionSchema,
  versionBefore: z.number().int().nonnegative(),
  versionAfter: z.number().int().nonnegative(),
  before: storedCardSchema.optional(),
  after: storedCardSchema.optional(),
  fsrsLog: z
    .object({
      rating: z.number().int().min(1).max(4),
      state: z.number().int().min(0).max(3),
      due: date,
      stability: z.number().finite().nonnegative(),
      difficulty: z.number().finite().nonnegative(),
      elapsed_days: z.number().nonnegative(),
      last_elapsed_days: z.number().nonnegative(),
      scheduled_days: z.number().nonnegative(),
      learning_steps: z.number().int().nonnegative(),
      review: date,
    })
    .optional(),
});
