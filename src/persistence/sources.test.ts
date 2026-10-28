import { afterEach, beforeEach, expect, it } from 'vitest';
import { RecallDatabase } from './database';
import { Repository } from './repository';
import { exportBackup, restoreBackup } from './backup';
import type { SourceDocument } from '../domain/models';
let db: RecallDatabase;
let repo: Repository;
let projectId: string;
let document: SourceDocument;
beforeEach(async () => {
  db = new RecallDatabase(`sources-${crypto.randomUUID()}`);
  repo = new Repository(db);
  projectId = await repo.saveProject({
    name: '虚构资料',
    description: '',
    learningGoal: '',
    targetDate: '',
    dailyTimeBudget: 20,
  });
  document = {
    id: 'source-test',
    projectId,
    filename: '虚构.txt',
    fileType: 'txt',
    importedAt: '2026-10-27T08:00:00.000Z',
    sourceHash: 'a'.repeat(64),
    byteLength: 18,
    extractedContent: '原始标准答案',
    pages: [{ number: 1, text: '原始标准答案', startOffset: 0, status: 'ready', warnings: [] }],
    sections: [],
    extractionStatus: 'ready',
    warnings: [],
    parserVersion: 'test',
    importDigest: 'b'.repeat(64),
    initialItemIds: [],
  };
  await db.sourceDocuments.add(document);
});
afterEach(async () => {
  await db.delete();
});
const input = {
  question: '虚构问题',
  standardAnswer: '原始标准答案',
  answerCriteria: '',
  hints: '',
  mnemonics: '',
  confusionWarnings: '',
  sourceLabel: '虚构资料 第1页',
};
it('keeps original source text and old revision evidence when an imported answer changes', async () => {
  const id = await repo.saveCard(projectId, input, undefined, undefined, [
    {
      documentId: document.id,
      label: input.sourceLabel,
      page: 1,
      startOffset: 0,
      endOffset: 6,
      excerpt: '原始标准答案',
    },
  ]);
  const original = (await db.practiceItems.get(id))!;
  await repo.saveCard(
    projectId,
    { ...input, standardAnswer: '更正后的学习答案', sourceLabel: '显示名称已改' },
    id,
    {
      expectedRevisionId: original.currentRevisionId,
      changeType: 'substantive',
      changeSummary: '更正答案',
      impactOnLearningState: 'reset',
    },
  );
  const current = (await db.practiceItems.get(id))!;
  expect(current.sourceReferences[0]).toMatchObject({
    documentId: document.id,
    excerpt: '原始标准答案',
  });
  expect((await db.sourceDocuments.get(document.id))?.extractedContent).toBe('原始标准答案');
  expect((await db.revisions.get(original.currentRevisionId))?.snapshot.standardAnswer).toBe(
    input.standardAnswer,
  );
  const backup = await exportBackup(db);
  expect(backup.databaseVersion).toBe(4);
  await restoreBackup(db, backup);
  expect((await db.sourceDocuments.get(document.id))?.sourceHash).toBe(document.sourceHash);
});
it('rejects invented quotes, pages and cross-project references without leaving a partial card', async () => {
  await expect(
    repo.saveCard(projectId, input, undefined, undefined, [
      {
        documentId: document.id,
        label: '错误',
        page: 2,
        startOffset: 0,
        endOffset: 6,
        excerpt: '原始标准答案',
      },
    ]),
  ).rejects.toThrow('页码');
  await expect(
    repo.saveCard(projectId, input, undefined, undefined, [
      { documentId: document.id, label: '错误', startOffset: 0, endOffset: 3, excerpt: '编造原文' },
    ]),
  ).rejects.toThrow('原文');
  const other = await repo.saveProject({
    name: '其他项目',
    description: '',
    learningGoal: '',
    targetDate: '',
    dailyTimeBudget: 20,
  });
  await expect(
    repo.saveCard(other, input, undefined, undefined, [
      {
        documentId: document.id,
        label: '错误',
        startOffset: 0,
        endOffset: 6,
        excerpt: '原始标准答案',
      },
    ]),
  ).rejects.toThrow('项目');
  expect(await db.practiceItems.count()).toBe(0);
  expect(await db.revisions.count()).toBe(0);
});

it('round trips an explicitly initialized memory state without backfilling any reviews', async () => {
  const id = await repo.saveCard(projectId, input);
  const item = (await db.practiceItems.get(id))!;
  const { initialMemory } = await import('../scheduling/engine');
  const memory = initialMemory(item, new Date('2026-10-27T12:00:00Z'));
  await db.memoryStates.add(memory);
  const backup = await exportBackup(db);
  expect(backup.data.memoryStates).toEqual([memory]);
  expect(backup.data.schedulingLogs).toEqual([]);
  await restoreBackup(db, backup);
  expect(await db.memoryStates.get(item.learningStateId)).toEqual(memory);
  expect(await db.reviewEvents.count()).toBe(0);
  const bad = structuredClone(backup);
  bad.data.memoryStates[0]!.learningStateId = 'wrong';
  await expect(restoreBackup(db, bad)).rejects.toThrow('版本');
  expect(await db.memoryStates.get(item.learningStateId)).toEqual(memory);
});
