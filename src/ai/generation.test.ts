import { afterEach, beforeEach, it, expect } from 'vitest';
import { RecallDatabase } from '../persistence/database';
import { Repository } from '../persistence/repository';
import { exportBackup, restoreBackup } from '../persistence/backup';
import { validateBackup } from '../persistence/backup-format';
import type { SourceDocument } from '../domain/models';
import { snapshotOf } from '../domain/revisions';
import { MockProvider } from './providers';
import { chunksOf, locateQuote, referenceFor, uncoveredText, type AiSource } from './evidence';
import { candidateEvidence, generateCandidates } from './generation';
import { confirmCandidates, candidateAnswer, duplicateCandidates } from './apply';
import type { AiProvider } from './protocol';
let db: RecallDatabase, repo: Repository, pid: string, doc: SourceDocument, source: AiSource;
const text = '蓝晶协议要求先校验来源。\n再记录版本。\n例如，可以保留副本。';
beforeEach(async () => {
  db = new RecallDatabase(`test-ai-${crypto.randomUUID()}`);
  repo = new Repository(db);
  pid = await repo.saveProject({
    name: '虚构协议',
    description: '',
    learningGoal: '',
    targetDate: '',
    dailyTimeBudget: 30,
  });
  const split = text.indexOf('再');
  doc = {
    id: crypto.randomUUID(),
    projectId: pid,
    filename: 'fictional.pdf',
    fileType: 'pdf',
    sourceHash: 'a'.repeat(64),
    byteLength: 100,
    parserVersion: 'fictional-1',
    importDigest: 'b'.repeat(64),
    extractedContent: text,
    importedAt: new Date().toISOString(),
    pages: [
      { number: 1, text: text.slice(0, split), startOffset: 0, status: 'ready', warnings: [] },
      { number: 2, text: text.slice(split), startOffset: split, status: 'ready', warnings: [] },
    ],
    sections: [],
    warnings: [],
    extractionStatus: 'ready',
    initialItemIds: [],
  };
  await db.sourceDocuments.add(doc);
  source = { kind: 'document', id: doc.id, text, document: doc };
});
afterEach(async () => db.delete());
async function run(s = source, task: 'extract' | 'criteria' | 'rewrite' | 'quality' = 'extract') {
  return generateCandidates(
    [s],
    task,
    'verbatim',
    new MockProvider(),
    'mock',
    new AbortController().signal,
    () => {},
  );
}
const ack = { humanReviewed: true, completenessReviewed: true };
it('matches only unique exact citations, derives page ranges and reports uncovered text rather than semantic accuracy', () => {
  expect(locateQuote('蓝晶蓝晶', '蓝晶').status).toBe('ambiguous');
  expect(locateQuote(text, '不存在').status).toBe('missing');
  const match = locateQuote(text, text);
  if (match.status !== 'matched') throw Error();
  expect(referenceFor(doc, match.anchor)).toMatchObject({ page: 1, endPage: 2, excerpt: text });
  expect(
    uncoveredText(text, [{ start: 0, end: 13, quote: text.slice(0, 13) }]).characters,
  ).toBeGreaterThan(0);
  const chunks = chunksOf({ ...source, text: '完整句。\n'.repeat(1000) });
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((c) => c.text.length <= 3500)).toBe(true);
  expect(chunks[1]!.start).toBeLessThan(chunks[0]!.end);
});
it('does not write unconfirmed candidates; verbatim answer remains exact and examples are optional', async () => {
  const state = await run();
  expect(await db.practiceItems.count()).toBe(0);
  const row = state.candidates[0]!;
  expect(row.criteria.at(-1)!.required).toBe(false);
  row.question = '蓝晶协议的两步是什么？';
  row.answerSuggestion = '模型偷偷改写';
  row.selected = true;
  expect(candidateAnswer(row, state)).toBe(text);
  expect(candidateEvidence(row).valid).toBe(true);
  await expect(
    confirmCandidates(repo, pid, state, { ...ack, completenessReviewed: false }),
  ).rejects.toThrow('完整性');
  const [id] = await confirmCandidates(repo, pid, state, ack);
  const item = (await db.practiceItems.get(id!))!;
  expect(item.standardAnswer).toBe(text);
  expect(item.aiProvenance?.original.items[0]?.question).toBe('这段原文说明了哪些内容？');
  expect(item.aiProvenance?.confirmation.question).toBe(row.question);
  expect(item.aiProvenance?.isMock).toBe(true);
  expect(item.sourceReferences[0]).toMatchObject({ page: 1, endPage: 2 });
  await expect(confirmCandidates(repo, pid, state, ack)).rejects.toThrow('已确认');
  const backup = await exportBackup(db);
  await restoreBackup(db, backup);
  expect(snapshotOf((await db.practiceItems.get(id!))!)).toEqual(snapshotOf(item));
  const forged = structuredClone(backup);
  forged.data.revisions[0]!.snapshot.aiProvenance!.evidence.quote = '编造';
  expect(() => validateBackup(forged)).toThrow();
});
it('rolls back all cards on missing evidence or stale document in a later selected row', async () => {
  const state = await run();
  const a = state.candidates[0]!;
  a.question = '协议第一步？';
  a.selected = true;
  state.candidates.push({
    ...structuredClone(a),
    id: crypto.randomUUID(),
    question: '协议第二步？',
    evidenceQuote: '没有这句',
  });
  await expect(confirmCandidates(repo, pid, state, ack)).rejects.toThrow('来源不足');
  expect(await db.practiceItems.count()).toBe(0);
  expect(await db.revisions.count()).toBe(0);
  state.candidates.pop();
  await db.sourceDocuments.update(doc.id, { sourceHash: 'b'.repeat(64) });
  await expect(confirmCandidates(repo, pid, state, ack)).rejects.toThrow('原资料');
  expect(await db.practiceItems.count()).toBe(0);
});
it('rejects missing criterion anchors, duplicate questions, empty rubrics and leaking prompts', async () => {
  const state = await run();
  const row = state.candidates[0]!;
  row.selected = true;
  row.question = '有效问题？';
  row.criteria[0]!.quotes = [];
  await expect(confirmCandidates(repo, pid, state, ack)).rejects.toThrow('原文依据');
  row.criteria[0]!.quotes = ['编造引用'];
  expect(candidateEvidence(row).valid).toBe(false);
  row.criteria = [];
  row.question = text;
  await expect(confirmCandidates(repo, pid, state, ack)).rejects.toThrow('题干');
  row.question = '有效问题？';
  const second = { ...structuredClone(row), id: crypto.randomUUID() };
  state.candidates.push(second);
  expect(duplicateCandidates(state.candidates, []).size).toBe(1);
  await expect(confirmCandidates(repo, pid, state, ack)).rejects.toThrow('重复');
});
it('criteria changes require current revision and reset memory without altering original answer or immutable history', async () => {
  const initial = await run();
  initial.candidates[0]!.selected = true;
  const [id] = await confirmCandidates(repo, pid, initial, ack);
  const old = (await db.practiceItems.get(id!))!;
  const s: AiSource = {
    kind: 'answer',
    id: old.id,
    text: old.standardAnswer,
    question: old.question,
    expectedRevisionId: old.currentRevisionId,
    sourceReferences: old.sourceReferences,
  };
  const state = await run(s, 'criteria');
  const row = state.candidates[0]!;
  row.selected = true;
  row.answerSuggestion = 'AI新答案';
  row.criteria[0]!.text = '确认来源';
  await confirmCandidates(repo, pid, state, ack);
  const next = (await db.practiceItems.get(id!))!;
  expect(next.standardAnswer).toBe(text);
  expect(next.learningStateId).not.toBe(old.learningStateId);
  expect(next.sourceReferences).toEqual(old.sourceReferences);
  expect((await db.revisions.get(old.currentRevisionId))!.snapshot).toEqual(snapshotOf(old));
  await expect(confirmCandidates(repo, pid, state, ack)).rejects.toThrow();
  await exportBackup(db);
});
it('preserves state on quality-only confirmation with unchanged goal and rubric, and keeps trace after later manual revisions', async () => {
  const initial = await run();
  initial.candidates[0]!.selected = true;
  const [id] = await confirmCandidates(repo, pid, initial, ack);
  const old = (await db.practiceItems.get(id!))!;
  const state = await run(
    {
      kind: 'answer',
      id: old.id,
      text,
      question: old.question,
      expectedRevisionId: old.currentRevisionId,
    },
    'quality',
  );
  state.candidates[0]!.selected = true;
  expect(state.candidates[0]!.adoptCriteria).toBe(false);
  await confirmCandidates(repo, pid, state, ack);
  const next = (await db.practiceItems.get(id!))!;
  expect(next.learningStateId).toBe(old.learningStateId);
  expect(next.answerCriteria).toEqual(old.answerCriteria);
  await repo.saveCard(
    pid,
    { ...next, standardAnswer: '更正后的新答案。', hints: '', answerCriteria: '', sourceLabel: '' },
    id,
    {
      expectedRevisionId: next.currentRevisionId,
      changeType: 'substantive',
      changeSummary: '纠正虚构答案',
      impactOnLearningState: 'reset',
    },
  );
  const newer = (await db.practiceItems.get(id!))!;
  expect(newer.aiProvenance?.modifiedAfterConfirmation).toBe(true);
  expect(newer.aiProvenance?.confirmation.answer).toBe(text);
  await exportBackup(db);
});
it('rejects malicious or invalid output, retains good chunks after faults, cancellation and resume', async () => {
  const long = { ...source, text: '公开虚构句。\n'.repeat(700) };
  let calls = 0;
  const provider: AiProvider = {
    kind: 'mock',
    generate: async (input, signal) => {
      calls++;
      if (calls === 2) throw Error('private server body');
      return new MockProvider().generate(input, signal);
    },
  };
  const state = await generateCandidates(
    [long],
    'extract',
    'verbatim',
    provider,
    'mock',
    new AbortController().signal,
    () => {},
  );
  expect(state.status).toBe('partial');
  expect(state.failures[0]!.message).not.toContain('private');
  expect(state.candidates.length).toBeGreaterThan(0);
  const resumed = await generateCandidates(
    [long],
    'extract',
    'verbatim',
    new MockProvider(),
    'mock',
    new AbortController().signal,
    () => {},
    state,
  );
  expect(resumed.status).toBe('completed');
  await expect(
    generateCandidates(
      [{ ...long, text: 'changed' }],
      'extract',
      'verbatim',
      new MockProvider(),
      'mock',
      new AbortController().signal,
      () => {},
      state,
    ),
  ).rejects.toThrow('变化');
  const abort = new AbortController();
  abort.abort();
  const cancelled = await generateCandidates(
    [source],
    'extract',
    'verbatim',
    new MockProvider(),
    'mock',
    abort.signal,
    () => {},
  );
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.candidates).toEqual([]);
  for (const raw of [{ items: [{ tool: 'delete_history' }] }, 'bad JSON']) {
    const bad = await generateCandidates(
      [source],
      'extract',
      'verbatim',
      { kind: 'mock', generate: async () => raw },
      'mock',
      new AbortController().signal,
      () => {},
    );
    expect(bad.failures).toHaveLength(1);
    expect(bad.candidates).toEqual([]);
  }
});
