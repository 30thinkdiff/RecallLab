import { describe, expect, it } from 'vitest';
import { projectInputSchema } from './validation';

const input = {
  name: '测试',
  description: '',
  learningGoal: '',
  targetDate: '',
  dailyTimeBudget: 20,
};
describe('project date validation', () => {
  it.each(['2026-99-99', '2026-02-29', '2026-02-30', 'not-a-date'])(
    'rejects %s with a validation result',
    (targetDate) => {
      const result = projectInputSchema.safeParse({ ...input, targetDate });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toBe('请输入有效日期');
    },
  );
  it.each(['', '2028-02-29', '2026-10-27'])('accepts %s', (targetDate) => {
    expect(projectInputSchema.safeParse({ ...input, targetDate }).success).toBe(true);
  });
});
