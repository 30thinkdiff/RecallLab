import { it, expect } from 'vitest';
import { questionQuality } from './quality';
import { promptProblem } from './readiness';
import type { PracticeItem, SourceDocument } from './models';
it('flags deterministic quality risks without inventing grading criteria or semantic certainty', () => {
  const c = {
    id: 'c',
    question: '内容是什么？',
    standardAnswer: '公开虚构长答案'.repeat(60),
    answerCriteria: [],
    sourceReferences: [{ documentId: 'doc', page: 1, label: '虚构' }],
  } as unknown as PracticeItem;
  const doc = {
    id: 'doc',
    pages: [{ number: 1, method: 'ocr', status: 'suspect' }],
  } as SourceDocument;
  const flags = questionQuality([c], [doc]).get(c.id)!;
  expect(flags.map((i) => i.kind)).toEqual(
    expect.arrayContaining(['vague', 'criteria', 'ocr', 'source']),
  );
  expect(c.answerCriteria).toEqual([]);
  expect(
    promptProblem({
      question: '请记住完整答案：虚构的完整标准答案内容',
      standardAnswer: '虚构的完整标准答案内容',
    }),
  ).toBeTruthy();
});
it('detects numbered near-duplicate prompts within a project and ignores archived material', () => {
  const c = {
    id: '1',
    question: '虚构题 1：蓝晶规则是什么？',
    standardAnswer: '甲',
    answerCriteria: [],
    sourceReferences: [],
  } as unknown as PracticeItem;
  const map = questionQuality(
    [
      c,
      { ...c, id: '2', question: '虚构题 2：蓝晶规则是什么？' },
      { ...c, id: '3', archivedAt: '2026-10-28' },
    ],
    [],
  );
  expect(map.get('1')?.map((i) => i.kind)).toContain('similar');
  expect(map.has('3')).toBe(false);
});
