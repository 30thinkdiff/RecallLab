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
it('warns about identical source answers even when generated questions use different wording', async () => {
  const state = await generateCandidates(
    [{ kind: 'document', id: 'public', text: '蓝晶资料必须保留来源与版本。' }],
    'extract',
    'verbatim',
    new MockProvider(),
    'mock',
    new AbortController().signal,
    () => {},
  );
  const first = state.candidates[0]!;
  first.question = '蓝晶资料需要保留什么？';
  state.candidates.push({
    ...structuredClone(first),
    id: 'different-wording',
    question: '记录蓝晶资料有哪些要求？',
  });
  const rows = reviewQueue(state, []);
  expect(rows.every((r) => r.comparisons.length === 1)).toBe(true);
});
