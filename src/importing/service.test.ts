import { beforeEach, afterEach, it, expect } from 'vitest';
import { RecallDatabase } from '../persistence/database';
import { Repository } from '../persistence/repository';
import { parseTextBytes } from './text';
import { commitImport } from './service';
import { tokenOf } from '../domain/revisions';
import { exportBackup, restoreBackup } from '../persistence/backup';
let db: RecallDatabase;
let repo: Repository;
beforeEach(() => {
  db = new RecallDatabase(`import-${crypto.randomUUID()}`);
  repo = new Repository(db);
});
afterEach(async () => {
  await db.delete();
});
const project = {
  name: '虚构新项目',
  description: '',
  learningGoal: '',
  targetDate: '',
  dailyTimeBudget: 20,
};
const material = async (items = [{ question: '新问题', answer: '新答案' }]) =>
  parseTextBytes(new TextEncoder().encode(JSON.stringify(items)), '题库.json', 'json');
it('imports an entire bank atomically into an existing project without clearing old cards or history', async () => {
  const projectId = await repo.saveProject(project);
  await repo.saveCard(projectId, {
    question: '旧题',
    standardAnswer: '旧答案',
    hints: '',
    answerCriteria: '',
    mnemonics: '',
    confusionWarnings: '',
    sourceLabel: '',
  });
  const sessionId = await repo.startSession(projectId);
  let session = (await db.sessions.get(sessionId))!;
  session = await repo.updateDraft(sessionId, 0, {}, tokenOf(session), 'reveal');
  await repo.submitReview(sessionId, 0, 'correct', 4, tokenOf(session));
  const before = await db.reviewEvents.toArray();
  const parsed = await material(
    Array.from({ length: 69 }, (_, i) => ({ question: `新问题 ${i}`, answer: `答案 ${i}` })),
  );
  const result = await commitImport(repo, parsed, parsed.candidates, { projectId });
  expect(result.itemIds).toHaveLength(69);
  expect(await db.practiceItems.count()).toBe(70);
  expect(await db.reviewEvents.toArray()).toEqual(before);
  expect(await db.sourceDocuments.count()).toBe(1);
  const backup = await exportBackup(db);
  await restoreBackup(db, backup);
  expect((await exportBackup(db)).data.sourceDocuments).toEqual(backup.data.sourceDocuments);
});
it('does not write anything during parsing or a cancelled preview', async () => {
  await material();
  expect(await db.projects.count()).toBe(0);
  expect(await db.sourceDocuments.count()).toBe(0);
  expect(await db.practiceItems.count()).toBe(0);
});
it('rolls back source, project, units and earlier rows if a later card write fails', async () => {
  const parsed = await material([
    { question: '第一题', answer: '甲' },
    { question: '第二题', answer: '乙' },
  ]);
  let count = 0;
  const fail = () => {
    if (++count === 2) throw new Error('模拟写入失败');
  };
  db.revisions.hook('creating', fail);
  await expect(
    commitImport(repo, parsed, parsed.candidates, { newProject: project }),
  ).rejects.toThrow('模拟写入失败');
  db.revisions.hook('creating').unsubscribe(fail);
  for (const table of [
    db.projects,
    db.sourceDocuments,
    db.knowledgeUnits,
    db.practiceItems,
    db.revisions,
  ])
    expect(await table.count()).toBe(0);
});
it('is idempotent under duplicate confirm calls and refuses a changed replay', async () => {
  const parsed = await material();
  const target = { newProject: project };
  const results = await Promise.all([
    commitImport(repo, parsed, parsed.candidates, target),
    commitImport(repo, parsed, parsed.candidates, target),
  ]);
  expect(results[0]?.itemIds).toEqual(results[1]?.itemIds);
  expect(await db.projects.count()).toBe(1);
  expect(await db.practiceItems.count()).toBe(1);
  await expect(
    commitImport(
      repo,
      parsed,
      parsed.candidates.map((row) => ({ ...row, standardAnswer: '改后的答案' })),
      target,
    ),
  ).rejects.toThrow('已保存');
});
it('rechecks duplicates inside the transaction, and never replaces a matching old answer', async () => {
  const parsed = await material();
  const first = await commitImport(repo, parsed, parsed.candidates, { newProject: project });
  const second = await material();
  await expect(
    commitImport(repo, second, second.candidates, { projectId: first.projectId }),
  ).rejects.toThrow('重复');
  expect(await db.sourceDocuments.count()).toBe(1);
  await commitImport(repo, second, second.candidates, { projectId: first.projectId }, true);
  expect(await db.practiceItems.count()).toBe(2);
});
it('rejects missing required fields before writing a project and can import only explicitly selected valid rows', async () => {
  const parsed = await material();
  parsed.candidates[0]!.standardAnswer = '';
  await expect(
    commitImport(repo, parsed, parsed.candidates, { newProject: project }),
  ).rejects.toThrow();
  expect(await db.projects.count()).toBe(0);
});
it('keeps source and historical snapshots when an imported answer is corrected', async () => {
  const parsed = await material();
  const result = await commitImport(repo, parsed, parsed.candidates, { newProject: project });
  const id = result.itemIds[0]!;
  const sessionId = await repo.startSession(result.projectId);
  let session = (await db.sessions.get(sessionId))!;
  session = await repo.updateDraft(sessionId, 0, {}, tokenOf(session), 'reveal');
  await repo.submitReview(sessionId, 0, 'correct', 4, tokenOf(session));
  const before = await db.reviewEvents.toArray();
  const item = (await db.practiceItems.get(id))!;
  await repo.saveCard(
    result.projectId,
    { ...parsed.candidates[0]!, standardAnswer: '更正答案' },
    id,
    {
      expectedRevisionId: item.currentRevisionId,
      changeType: 'substantive',
      changeSummary: '更正资料',
      impactOnLearningState: 'reset',
    },
  );
  expect(await db.reviewEvents.toArray()).toEqual(before);
  expect((await db.practiceItems.get(id))?.sourceReferences).toEqual(item.sourceReferences);
  expect((await db.sourceDocuments.get(result.documentId))?.extractedContent).toBe(
    parsed.document.extractedContent,
  );
});

it('rejects altered source text and page order in restored backups', async () => {
  const parsed = await material();
  await commitImport(repo, parsed, parsed.candidates, { newProject: project });
  const backup = await exportBackup(db);
  backup.data.sourceDocuments[0]!.pages[0]!.number = 2;
  await expect(restoreBackup(db, backup)).rejects.toThrow('页码');
  expect((await db.sourceDocuments.toArray())[0]?.pages[0]?.number).toBe(1);
});

it('rejects empty or failed PDF extraction at the transaction boundary without creating a project', async () => {
  const parsed = await material();
  parsed.document.fileType = 'pdf';
  parsed.candidates = [];
  for (const status of ['empty', 'failed'] as const) {
    parsed.document.pages = [
      {
        number: 1,
        text: status === 'failed' ? 'failed output' : '',
        startOffset: 0,
        status,
        warnings: [],
      },
    ];
    await expect(commitImport(repo, parsed, [], { newProject: project })).rejects.toThrow(
      '没有可保存的文字',
    );
  }
  expect(await db.projects.count()).toBe(0);
  expect(await db.sourceDocuments.count()).toBe(0);
});
