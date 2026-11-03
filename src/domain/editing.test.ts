import { it, expect } from 'vitest';
import { preservesRequirements } from './editing';
import type { PracticeItem } from './models';
const item = {
  question: 'A concept?',
  standardAnswer: 'a b',
  answerCriteria: [],
  learningObjective: undefined,
} as unknown as PracticeItem;
const input = {
  question: 'A concept?',
  standardAnswer: 'a b',
  answerCriteria: '',
  hints: '',
  mnemonics: '',
  confusionWarnings: '',
  sourceLabel: '',
};
it('keeps lexical spaces, formula/code symbols, case and required criteria significant', () => {
  for (const answer of ['ab', 'A b', 'a+b', 'a b。'])
    expect(preservesRequirements(item, { ...input, standardAnswer: answer })).toBe(false);
  expect(preservesRequirements(item, { ...input, hints: '用户辅助信息' })).toBe(true);
  expect(preservesRequirements(item, { ...input, answerCriteria: '新增必须项' })).toBe(false);
});
it('allows only lossless line-ending representation changes', () => {
  expect(
    preservesRequirements(
      { ...item, standardAnswer: 'line1\r\nline2' },
      { ...input, standardAnswer: 'line1\nline2' },
    ),
  ).toBe(true);
  expect(
    preservesRequirements(
      { ...item, standardAnswer: 'if x:\n    act()' },
      { ...input, standardAnswer: 'if x:\nact()' },
    ),
  ).toBe(false);
});
