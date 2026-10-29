import { expect, it, vi } from 'vitest';
import corpus from '../../evaluation/v052/corpus.json';
import { guidedItem, planKnowledge, sourceCriteria } from './units';
import { generateCandidates, candidateEvidence } from './generation';
import { HttpProvider, messages } from './providers';
import { candidateQualityProblem } from './quality';
import { packState, packedStateSchema } from './drafts-format';
import type { AiProvider } from './protocol';
it('plans chapters with repeated numbering, preserves conditional prose and avoids unsupported articles', () => {
  const c = corpus.cases.find((c) => c.id === 'mixed-units')!;
  const units = planKnowledge({ kind: 'document', id: 'fiction', text: c.text });
  expect(units).toHaveLength(3);
  expect(new Set(units.map((u) => u.chapter)).size).toBe(2);
  expect(units.every((u) => c.text.slice(u.start, u.end) === u.text)).toBe(true);
  const noCards = corpus.cases.find((c) => c.id === 'article')!;
  expect(
    planKnowledge({ kind: 'document', id: 'article', text: noCards.text })[0]!.notForCards,
  ).toBe(true);
});
it('derives useful rubric statements instead of ordinals and keeps examples optional', () => {
  const c = corpus.cases.find((c) => c.id === 'long-answer')!;
  const points = sourceCriteria(c.units[0]!.quote);
  expect(points.filter((c) => c.importance === 'required')).toHaveLength(4);
  expect(points[0]!.text).toContain('检查标题与来源');
  expect(points.at(-1)!.importance).toBe('optional');
  expect(points.some((c) => /^第[一二三四]$/u.test(c.text))).toBe(false);
});
it('uses question-only real protocol, keeps raw question separate and cancels between units without losing earlier work', async () => {
  const c = corpus.cases.find((c) => c.id === 'paragraphs')!;
  const control = new AbortController();
  let count = 0;
  const fetcher = vi.fn<typeof fetch>(async () => {
    count++;
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify({ question: `第${count}项记录需要保留什么？` }) },
          },
        ],
      }),
    );
  });
  const provider = new HttpProvider(
    {
      kind: 'compatible',
      endpoint: 'http://127.0.0.1:8089/v1',
      model: 'fictional',
      apiKey: '',
      jsonMode: 'schema',
      strategy: 'units',
    },
    fetcher,
  );
  const state = await generateCandidates(
    [{ kind: 'document', id: 'fiction', text: c.text }],
    'extract',
    'verbatim',
    provider,
    'fictional',
    control.signal,
    (s) => {
      if (s.candidates.length === 1) control.abort();
    },
  );
  expect(state.status).toBe('cancelled');
  expect(state.candidates).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const row = state.candidates[0]!;
  expect(row.evidenceQuote).toBe('蓝晶资料需要保留出处和原文位置。');
  expect(row.original[0]!.evidenceQuote).toBe('');
  expect(row.original[0]!.criteria).toEqual([]);
  expect(row.criteria[0]!.text).toContain('出处');
  expect(candidateEvidence(row).valid).toBe(true);
  const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
  expect(body.response_format.json_schema.schema.properties).toHaveProperty('question');
  expect(body.response_format.json_schema.schema.properties).not.toHaveProperty('items');
});
it('does not mistake valid citations for semantic correctness or complete rubrics', () => {
  expect(candidateQualityProblem('蓝晶是否适用？', '是', '在其他条件满足时可能适用。')).toContain(
    '不确定性',
  );
  expect(candidateQualityProblem('能否证明？', '可以', '本段不能证明。')).toContain('否定');
  const unit = {
    key: 'x',
    start: 0,
    end: 10,
    chapter: '原文',
    title: '',
    text: '第一，检查来源。第二，保存版本。',
    notForCards: false,
  };
  const data = guidedItem('应如何处理资料？', unit, 'verbatim');
  expect(data.answerSuggestion).toBe(unit.text);
  const base = { kind: 'document' as const, id: 'x', text: unit.text };
  const row = {
    id: 'x',
    source: base,
    chunk: { id: 'x', start: 0, end: unit.text.length, text: unit.text },
    original: [data],
    question: data.question,
    answerSuggestion: unit.text,
    evidenceQuote: unit.text,
    criteria: [{ id: 'p', text: '第一', quotes: ['第一，检查来源。'], required: true }],
    adoptCriteria: true,
    hints: '',
    mnemonic: '',
    confusion: '',
    notes: [],
    selected: false,
  };
  expect(candidateEvidence(row).match.status).toBe('matched');
  expect(candidateEvidence(row).valid).toBe(false);
  const input = {
    task: 'extract' as const,
    objective: 'understanding' as const,
    text: '原文',
    maxItems: 1,
    chunkId: 'x',
  };
  expect(messages(input, 'units')[0]!.content).toContain('解释或比较');
  expect(messages({ ...input, objective: 'keywords' }, 'units')[0]!.content).toContain('关键词');
});
it('does not treat an English rule about examples as an optional example', () => {
  const points = sourceCriteria(
    'Examples can explain a record but are not mandatory evidence. For example, a paper copy may help.',
  );
  expect(points[0]!.importance).toBe('required');
  expect(points[1]!.importance).toBe('optional');
});

it('splits explicit counted actions into meaningful source quotes without guessing ambiguous lists', () => {
  const chinese = sourceCriteria(
    '核对分三步：先定位来源，再逐项比对，最后记录未确定的问题。每一步都必须保留结果。',
  );
  expect(chinese.map((p) => p.text)).toEqual([
    '先定位来源',
    '再逐项比对',
    '最后记录未确定的问题。',
    '每一步都必须保留结果。',
  ]);
  const english = sourceCriteria(
    'An audit requires three actions: identify the source, compare every required point, and record unresolved issues.',
  );
  expect(english).toHaveLength(3);
  expect(english.every((p) => p.importance === 'required')).toBe(true);
  expect(
    sourceCriteria('An audit requires three actions: identify the source, compare the record.'),
  ).toHaveLength(1);
});

it('refuses oversized unit plans before changing drafts and keeps oversized rubric failures saveable', async () => {
  const generate = vi.fn(async () => ({
    items: [
      {
        question: '如何核对？',
        answerSuggestion: '',
        evidenceQuote: '',
        criteria: [],
        hints: [],
        mnemonic: '',
        confusion: '',
        qualityNotes: [],
      },
    ],
  }));
  const provider: AiProvider = { kind: 'mock', strategy: 'units', generate };
  const many = {
    kind: 'document' as const,
    id: 'many',
    text: Array.from({ length: 201 }, (_, i) => `原文片段${i}要求保留记录。`).join('\n\n'),
  };
  const progress = vi.fn();
  await expect(
    generateCandidates(
      [many],
      'extract',
      'verbatim',
      provider,
      'fixture',
      new AbortController().signal,
      progress,
    ),
  ).rejects.toThrow('分批');
  expect(progress).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
  const dense = {
    kind: 'document' as const,
    id: 'dense',
    text: '核对分五步：先定位来源，再逐项比对，然后记录差异，再保存原文，最后核对副本。'.repeat(45),
  };
  const state = await generateCandidates(
    [dense],
    'extract',
    'verbatim',
    provider,
    'fixture',
    new AbortController().signal,
    progress,
  );
  expect(state.status).toBe('partial');
  expect(state.candidates).toEqual([]);
  expect(state.failures[0]!.message).toContain('要点过多');
  expect(packedStateSchema.safeParse(packState(state, [dense])).success).toBe(true);
});
