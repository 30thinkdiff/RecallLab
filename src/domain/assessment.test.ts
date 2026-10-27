import { it, expect } from 'vitest';
import {
  aggregateMarks,
  freshAssessment,
  assessmentResult,
  assertCriterionEvidence,
} from './assessment';
import type { PracticeSnapshot } from './models';
const snapshot: PracticeSnapshot = {
  id: 'a',
  knowledgeUnitId: 'k',
  question: '虚构五项规则？',
  standardAnswer: '虚构内容',
  answerCriteria: ['甲', '乙', '丙', '丁', '戊'],
  hints: [],
  mnemonics: '',
  confusionWarnings: '',
  sourceReferences: [],
  revision: 1,
};
it('requires all necessary points, separates omissions, errors and uncertainty', () => {
  expect(aggregateMarks(['correct', 'correct'])).toBe('correct');
  expect(aggregateMarks(['correct', 'omitted'])).toBe('partially_correct');
  expect(aggregateMarks(['correct', 'incorrect', 'uncertain'])).toBe('incorrect');
  expect(aggregateMarks(['correct', 'uncertain'])).toBe('ungraded');
  expect(aggregateMarks([])).toBe('ungraded');
});
it('detailed marks override optimistic whole-answer claims and reject missing criteria', () => {
  const a = {
    ...freshAssessment(),
    mode: 'detailed' as const,
    performance: 'correct' as const,
    marks: ['correct', 'correct', 'omitted', 'correct', 'correct'] as const,
  };
  expect(assessmentResult({ ...a, marks: [...a.marks] }, snapshot)).toBe('partially_correct');
  expect(() => assessmentResult({ ...a, marks: ['correct'] }, snapshot)).toThrow('全部必需');
  expect(() =>
    assertCriterionEvidence({ assessmentMode: 'detailed', criterionChecks: [] } as never),
  ).toThrow();
});
