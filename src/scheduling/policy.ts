import type { ReviewEvent } from '../domain/models';
import type { Difficulty, ReviewDecision } from './types';
export function decide(
  event: ReviewEvent,
  canSchedule: boolean,
  difficulty: Difficulty = 'good',
): ReviewDecision {
  if (!['hard', 'good', 'easy'].includes(difficulty)) throw new Error('无效的回忆难度');
  const base = {
    policyVersion: 'v1' as const,
    grade: null,
    source: event.assessmentSource,
    criteriaMet:
      event.assessmentResult === 'ungraded' || event.assessmentResult === 'skipped'
        ? null
        : event.assessmentResult === 'correct',
    difficulty: null,
  };
  if (event.assessmentResult === 'skipped') return { ...base, reason: 'skipped' };
  if (!canSchedule) return { ...base, reason: 'practice' };
  if (event.hintLevelUsed > 0) return { ...base, reason: 'hinted' };
  if (!event.wasIndependentRecall) return { ...base, reason: 'no_attempt' };
  if (event.assessmentResult === 'ungraded') return { ...base, reason: 'ungraded' };
  if (event.assessmentResult === 'incorrect') return { ...base, grade: 1, reason: 'failure' };
  if (event.assessmentResult === 'partially_correct')
    return { ...base, grade: 1, reason: 'partial_failure' };
  return {
    ...base,
    grade: ({ hard: 2, good: 3, easy: 4 } as const)[difficulty],
    reason: 'success',
    difficulty,
  };
}
export const reasonLabels: Record<ReviewDecision['reason'], string> = {
  success: '无提示回忆，并由你核对为必需内容全部正确',
  failure: '已尝试独立回忆，但你核对为失败，安排重新学习',
  partial_failure: '完整复述任务遗漏必需内容，按失败安排重新学习',
  hinted: '使用了提示，属于教学练习，需要无提示复测',
  no_attempt: '未记录揭晓前的回忆尝试，不推断记住或忘记',
  skipped: '已跳过，不推断遗忘，也不更新记忆状态',
  ungraded: '尚未核对，不生成成功或失败评分',
  practice: '临时或提前练习，不更新长期记忆状态',
};
export const gradeLabels = {
  1: 'Again · 重新学习',
  2: 'Hard · 正确但费力',
  3: 'Good · 正确、正常难度',
  4: 'Easy · 正确且轻松',
} as const;
