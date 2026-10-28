import { expect, it } from 'vitest';
import { generateCandidates } from './generation';
import { MockProvider } from './providers';
import { reviewQueue } from './review-queue';
it('orders missing evidence first, groups by source and exposes both duplicate candidates without auto-confirming', async () => {
  const state = await generateCandidates(
    [{ kind: 'document', id: 'fictional', text: '蓝晶协议要求保留原文。' }],
    'extract',
    'verbatim',
    new MockProvider(),
    'mock',
    new AbortController().signal,
    () => {},
  );
  const first = state.candidates[0]!;
  first.question = '蓝晶协议有什么要求？';
  state.candidates.push({
    ...structuredClone(first),
    id: 'duplicate',
    evidenceQuote: '不存在的原文',
  });
  const result = reviewQueue(state, []);
  expect(result[0]!.row.id).toBe('duplicate');
  expect(result[0]!.flags).toContain('来源或要点引用不足');
  expect(result.every((c) => c.comparisons.length === 1)).toBe(true);
  expect(result.every((c) => c.group === result[0]!.group)).toBe(true);
  expect(state.candidates.every((c) => !c.selected)).toBe(true);
});
