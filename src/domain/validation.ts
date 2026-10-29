import { automaticGoalSchema } from '../learning/evidence';
import { objectiveSchema } from '../ai/protocol';
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1, '请填写必填内容').max(max, `最多 ${max} 字`);
export const projectInputSchema = z.object({
  automaticGoal: automaticGoalSchema.optional(),
  name: text(100),
  description: z.string().trim().max(2000),
  learningGoal: z.string().trim().max(1000),
  targetDate: z.string().refine((value) => {
    if (!value) return true;
    const timestamp = Date.parse(value);
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === value
    );
  }, '请输入有效日期'),
  dailyTimeBudget: z.number().int().min(1).max(1440),
  priority: z.number().int().min(1).max(3).optional(),
  newCardLimit: z.number().int().min(0).max(1000).optional(),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const cardInputSchema = z.object({
  learningObjective: objectiveSchema.optional(),
  question: text(5000),
  standardAnswer: text(20000),
  hints: z.string().max(5000),
  answerCriteria: z.string().max(10000),
  mnemonics: z.string().trim().max(5000),
  confusionWarnings: z.string().trim().max(5000),
  sourceLabel: z.string().trim().max(1000),
});
export type CardInput = z.infer<typeof cardInputSchema>;

export function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
