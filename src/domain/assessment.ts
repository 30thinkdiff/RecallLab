import { z } from 'zod';
import type { Performance, PracticeSnapshot, ReviewEvent } from './models';
export const markSchema = z.enum(['correct', 'omitted', 'incorrect', 'uncertain']);
export type CriterionMark = z.infer<typeof markSchema>;
export const assessmentSchema = z.object({
  mode: z.enum(['simple', 'detailed']),
  marks: z.array(markSchema).max(10000),
  performance: z.enum(['correct', 'partially_correct', 'incorrect', 'ungraded']),
  mastery: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .nullable(),
  difficulty: z.enum(['hard', 'good', 'easy']),
});
export type AssessmentDraft = z.infer<typeof assessmentSchema>;
export const markLabels: Record<CriterionMark, string> = {
  correct: '已正确回忆',
  omitted: '遗漏',
  incorrect: '回忆错误',
  uncertain: '无法确认',
};
export function freshAssessment(): AssessmentDraft {
  return { mode: 'simple', marks: [], performance: 'ungraded', mastery: null, difficulty: 'good' };
}
export function aggregateMarks(marks: CriterionMark[]): Performance {
  if (!marks.length) return 'ungraded';
  if (marks.includes('incorrect')) return 'incorrect';
  if (marks.includes('omitted')) return 'partially_correct';
  if (marks.includes('uncertain')) return 'ungraded';
  return 'correct';
}
export function assessmentResult(draft: AssessmentDraft, snapshot: PracticeSnapshot): Performance {
  assessmentSchema.parse(draft);
  if (draft.mode === 'simple') return draft.performance;
  if (!snapshot.answerCriteria.length || draft.marks.length !== snapshot.answerCriteria.length)
    throw new Error('请按当前版本的全部必需要点核对');
  return aggregateMarks(draft.marks);
}
export function assertCriterionEvidence(event: ReviewEvent) {
  if (event.assessmentMode === 'detailed') {
    const checks = event.criterionChecks;
    if (
      !checks?.length ||
      checks.length !== event.snapshot.answerCriteria.length ||
      checks.some(
        (c, i) =>
          c.index !== i ||
          c.criterion !== event.snapshot.answerCriteria[i] ||
          c.source !== 'user_checked',
      )
    )
      throw new Error('逐项核对与当时的必需要点不一致');
    if (
      event.assessmentResult !== 'skipped' &&
      aggregateMarks(checks.map((c) => c.result)) !== event.assessmentResult
    )
      throw new Error('逐项核对不能被整体评分覆盖');
  } else if (event.criterionChecks?.length) throw new Error('简洁核对不能冒充逐项证据');
}
