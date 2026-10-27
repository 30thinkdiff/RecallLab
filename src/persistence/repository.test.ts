import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecallDatabase } from './database';
import { Repository, type RevisionInput } from './repository';
import { evidenceIsCurrent, tokenOf } from '../domain/revisions';
import type { CardInput, ProjectInput } from '../domain/validation';
import { exportBackup } from './backup';
const project: ProjectInput = {
  name: '虚构项目',
  description: '',
  learningGoal: '',
  targetDate: '',
  dailyTimeBudget: 20,
};
const card: CardInput = {
  question: '虚构蓝晶是什么颜色？',
  standardAnswer: '旧答案红色',
  hints: '回想颜色\n回想协议',
  answerCriteria: '正确颜色',
  mnemonics: '',
  confusionWarnings: '',
  sourceLabel: '虚构资料',
};
let db: RecallDatabase;
let repo: Repository;
beforeEach(() => {
  db = new RecallDatabase(`test-${crypto.randomUUID()}`);
  repo = new Repository(db);
});
afterEach(async () => {
  await db.delete();
});
async function session(id: string) {
  return (await db.sessions.get(id))!;
}
async function token(id: string) {
  return tokenOf(await session(id));
}
async function setup(count = 1) {
  const projectId = await repo.saveProject(project);
  const items = [];
  for (let i = 0; i < count; i++)
    items.push(await repo.saveCard(projectId, { ...card, question: `虚构问题 ${i}` }));
  return { projectId, items, sessionId: await repo.startSession(projectId) };
}
async function edit(
  projectId: string,
  item: string,
  kind: RevisionInput['changeType'] = 'substantive',
  impact: RevisionInput['impactOnLearningState'] = 'reset',
) {
  const current = (await db.practiceItems.get(item))!;
  return repo.saveCard(
    projectId,
    { ...card, question: current.question, standardAnswer: '修正答案蓝色' },
    item,
    {
      expectedRevisionId: current.currentRevisionId,
      changeType: kind,
      changeSummary: '修正虚构颜色',
      impactOnLearningState: impact,
    },
  );
}
async function reveal(id: string, index = 0) {
  return repo.updateDraft(id, index, {}, await token(id), 'reveal');
}

describe('repository transitions and revision evidence', () => {
  it('validates input and isolates projects', async () => {
    const { projectId, items } = await setup();
    const second = await repo.saveProject({ ...project, name: '另一项目' });
    await expect(repo.saveCard(second, card, items[0])).rejects.toThrow('不存在');
    await expect(repo.startSession(second)).rejects.toThrow('至少');
    await expect(repo.saveCard(projectId, { ...card, question: ' ' })).rejects.toThrow();
    expect(await db.knowledgeUnits.count()).toBe(1);
  });
  it('edits and archives a project without deleting its evidence, and can restore it', async () => {
    const { projectId } = await setup();
    await repo.saveProject({ ...project, name: '新名称' }, projectId);
    await repo.archiveProject(projectId);
    await expect(repo.startSession(projectId)).rejects.toThrow();
    expect(await db.practiceItems.count()).toBe(1);
    await repo.restoreProject(projectId);
    expect(await repo.startSession(projectId)).toBeTruthy();
  });
  it('keeps one active session under concurrent starts', async () => {
    const { projectId, sessionId } = await setup();
    expect(await Promise.all([repo.startSession(projectId), repo.startSession(projectId)])).toEqual(
      [sessionId, sessionId],
    );
    expect(await db.sessions.count()).toBe(1);
  });
  it('persists draft and hints across a connection restart', async () => {
    const { sessionId } = await setup();
    await repo.updateDraft(
      sessionId,
      0,
      { responseMode: 'typed', userResponse: '保留输入' },
      await token(sessionId),
      'hint',
    );
    db.close();
    await db.open();
    expect((await session(sessionId)).draft).toMatchObject({
      userResponse: '保留输入',
      hintLevelUsed: 1,
    });
  });
  it('blocks pre-reveal grading and rolls back the event', async () => {
    const { sessionId } = await setup();
    await expect(
      repo.submitReview(sessionId, 0, 'correct', 4, await token(sessionId)),
    ).rejects.toThrow('揭晓');
    expect(await db.reviewEvents.count()).toBe(0);
    expect((await session(sessionId)).index).toBe(0);
  });
  it('stores contradictory manual performance and self-rating without converting hints to independent recall', async () => {
    const { sessionId } = await setup();
    await repo.updateDraft(
      sessionId,
      0,
      { responseMode: 'typed', userResponse: '原始回答' },
      await token(sessionId),
      'hint',
    );
    await reveal(sessionId);
    await expect(
      repo.updateDraft(sessionId, 0, { userResponse: '看完答案再改' }, await token(sessionId)),
    ).rejects.toThrow('证据');
    await repo.submitReview(sessionId, 0, 'incorrect', 4, await token(sessionId));
    expect(await db.reviewEvents.toCollection().first()).toMatchObject({
      userResponse: '原始回答',
      assessmentResult: 'incorrect',
      subjectiveMastery: 4,
      hintLevelUsed: 1,
      wasIndependentRecall: false,
      assessmentSource: 'user_checked',
    });
  });
  it('deduplicates concurrent submissions and never advances twice', async () => {
    const { sessionId } = await setup(2);
    await reveal(sessionId);
    const base = await token(sessionId);
    expect(
      (
        await Promise.all([
          repo.submitReview(sessionId, 0, 'correct', 4, base),
          repo.submitReview(sessionId, 0, 'correct', 4, base),
        ])
      ).sort(),
    ).toEqual([false, true]);
    expect(await db.reviewEvents.count()).toBe(1);
    expect((await session(sessionId)).index).toBe(1);
  });
  it('preserves old event rows and resets current evidence after a substantive correction', async () => {
    const { projectId, items, sessionId } = await setup();
    await reveal(sessionId);
    await repo.submitReview(sessionId, 0, 'correct', 4, await token(sessionId));
    const before = await db.reviewEvents.toArray();
    await edit(projectId, items[0]!);
    expect(await db.reviewEvents.toArray()).toEqual(before);
    const item = (await db.practiceItems.get(items[0]!))!;
    expect(evidenceIsCurrent(before[0]!, item, await db.revisions.toArray())).toBe(false);
    expect(before[0]!.snapshot.standardAnswer).toBe('旧答案红色');
    expect(await db.revisions.count()).toBe(2);
  });
  it('preserves valid evidence for an explicitly declared cosmetic change', async () => {
    const { projectId, items, sessionId } = await setup();
    await reveal(sessionId);
    await repo.submitReview(sessionId, 0, 'correct', 2, await token(sessionId));
    const old = (await db.practiceItems.get(items[0]!))!;
    await repo.saveCard(
      projectId,
      { ...card, question: old.question, standardAnswer: '旧答案 红色' },
      old.id,
      {
        expectedRevisionId: old.currentRevisionId,
        changeType: 'cosmetic',
        changeSummary: '调整空格',
        impactOnLearningState: 'preserve',
      },
    );
    const event = (await db.reviewEvents.toArray())[0]!;
    expect(
      evidenceIsCurrent(
        event,
        (await db.practiceItems.get(items[0]!))!,
        await db.revisions.toArray(),
      ),
    ).toBe(true);
  });
  it('rejects a cosmetic label when the answer or required criteria changes', async () => {
    const { projectId, items } = await setup();
    const itemId = items[0]!;
    const current = (await db.practiceItems.get(itemId))!;
    const claim = {
      expectedRevisionId: current.currentRevisionId,
      changeType: 'cosmetic' as const,
      changeSummary: '声称仅调整格式',
      impactOnLearningState: 'preserve' as const,
    };
    await expect(
      repo.saveCard(
        projectId,
        { ...card, question: current.question, standardAnswer: '另一个答案' },
        itemId,
        claim,
      ),
    ).rejects.toThrow('不能继承旧成绩');
    await expect(
      repo.saveCard(
        projectId,
        { ...card, question: current.question, answerCriteria: '不同的核对要求' },
        itemId,
        claim,
      ),
    ).rejects.toThrow('不能继承旧成绩');
    expect((await db.practiceItems.get(itemId))?.currentRevisionId).toBe(
      current.currentRevisionId,
    );
    expect(await db.revisions.count()).toBe(1);
  });
  it('allows formatting-only adjustments to retain learning evidence', async () => {
    const { projectId, items } = await setup();
    const itemId = items[0]!;
    const current = (await db.practiceItems.get(itemId))!;
    await repo.saveCard(
      projectId,
      { ...card, question: current.question, standardAnswer: '旧答案 红色' },
      itemId,
      {
        expectedRevisionId: current.currentRevisionId,
        changeType: 'cosmetic',
        changeSummary: '插入空格',
        impactOnLearningState: 'preserve',
      },
    );
    expect((await db.practiceItems.get(itemId))?.learningStateId).toBe(
      current.learningStateId,
    );
  });
  it('does not allow a substantive correction to inherit a learning state', async () => {
    const { projectId, items } = await setup();
    await expect(edit(projectId, items[0]!, 'substantive', 'preserve')).rejects.toThrow('重新学习');
    expect(await db.revisions.count()).toBe(1);
  });
  it('creates a separate knowledge unit for knowledge replacement', async () => {
    const { projectId, items } = await setup();
    const before = await db.practiceItems.get(items[0]!);
    await edit(projectId, items[0]!, 'replacement');
    expect((await db.practiceItems.get(items[0]!))?.knowledgeUnitId).not.toBe(
      before?.knowledgeUnitId,
    );
    expect(await db.knowledgeUnits.count()).toBe(2);
  });
  it('rejects a stale card edit instead of overwriting a newer correction', async () => {
    const { projectId, items } = await setup();
    const base = (await db.practiceItems.get(items[0]!))!;
    await edit(projectId, base.id);
    await expect(
      repo.saveCard(projectId, card, base.id, {
        expectedRevisionId: base.currentRevisionId,
        changeType: 'cosmetic',
        changeSummary: '旧页面',
        impactOnLearningState: 'preserve',
      }),
    ).rejects.toThrow('其他页面');
    expect(await db.revisions.count()).toBe(2);
  });
  it('blocks current old-version reveal and grading, then preserves its input on explicit reload', async () => {
    const { projectId, items, sessionId } = await setup();
    await repo.updateDraft(
      sessionId,
      0,
      { responseMode: 'typed', userResponse: '旧版草稿' },
      await token(sessionId),
    );
    await edit(projectId, items[0]!);
    await expect(reveal(sessionId)).rejects.toThrow('题目已更新');
    await expect(
      repo.submitReview(sessionId, 0, 'correct', 4, await token(sessionId)),
    ).rejects.toThrow('题目已更新');
    await repo.syncSession(sessionId, 0, await token(sessionId), { reloadCurrent: true });
    expect((await session(sessionId)).draft.userResponse).toBe('');
    expect((await session(sessionId)).queue[0]?.standardAnswer).toBe('修正答案蓝色');
    expect((await db.draftRecoveries.toArray())[0]?.draft.userResponse).toBe('旧版草稿');
    expect(await db.reviewEvents.count()).toBe(0);
  });
  it('adds 20 cards only when explicitly requested and preserves the current input', async () => {
    const { projectId, sessionId } = await setup(2);
    await repo.updateDraft(sessionId, 0, { userResponse: '正在回答' }, await token(sessionId));
    for (let i = 0; i < 20; i++) await repo.saveCard(projectId, { ...card, question: `新增 ${i}` });
    expect((await session(sessionId)).queue).toHaveLength(2);
    await repo.syncSession(sessionId, 0, await token(sessionId));
    expect((await session(sessionId)).queue).toHaveLength(2);
    await repo.syncSession(sessionId, 0, await token(sessionId), { includeNew: true });
    expect((await session(sessionId)).queue).toHaveLength(22);
    expect((await session(sessionId)).draft.userResponse).toBe('正在回答');
  });
  it('refreshes a pending question and preserves every completed prefix snapshot and event', async () => {
    const { projectId, items, sessionId } = await setup(3);
    await reveal(sessionId);
    await repo.submitReview(sessionId, 0, 'ungraded', 2, await token(sessionId));
    const before = await db.reviewEvents.toArray();
    const pending = (await session(sessionId)).queue[2]!;
    await edit(projectId, pending.id);
    await repo.syncSession(sessionId, 1, await token(sessionId));
    expect((await session(sessionId)).queue[2]?.revision).toBe(2);
    expect(await db.reviewEvents.toArray()).toEqual(before);
    expect((await session(sessionId)).queue[0]?.id).toBe(before[0]?.practiceItemId);
    expect(items).toHaveLength(3);
  });
  it('archives current and pending questions without inventing skip events, and supports restore', async () => {
    const { projectId, sessionId } = await setup(3);
    const queue = (await session(sessionId)).queue;
    await repo.archiveCard(projectId, queue[1]!.id);
    await repo.archiveCard(projectId, queue[0]!.id);
    await expect(reveal(sessionId)).rejects.toThrow('已归档');
    await repo.syncSession(sessionId, 0, await token(sessionId));
    expect((await session(sessionId)).queue.map((q) => q.id)).toEqual([queue[2]!.id]);
    expect(await db.reviewEvents.count()).toBe(0);
    await repo.restoreCard(projectId, queue[0]!.id);
    await repo.syncSession(sessionId, 0, await token(sessionId), { includeNew: true });
    expect((await session(sessionId)).queue).toHaveLength(2);
  });
  it('ends and restarts a round without clearing events or pretending to reset memory', async () => {
    const { sessionId } = await setup(2);
    await reveal(sessionId);
    await repo.submitReview(sessionId, 0, 'correct', 3, await token(sessionId));
    await repo.updateDraft(sessionId, 1, { userResponse: '未提交' }, await token(sessionId));
    const newId = await repo.restartSession(sessionId, 1, await token(sessionId));
    expect(newId).not.toBe(sessionId);
    expect((await session(sessionId)).status).toBe('ended');
    expect(await db.reviewEvents.count()).toBe(1);
    expect((await db.draftRecoveries.toArray())[0]?.draft.userResponse).toBe('未提交');
    expect((await session(newId)).index).toBe(0);
    await expect(exportBackup(db)).resolves.toBeTruthy();
  });
  it('rejects stale draft writes and writes issued before another tab reveals', async () => {
    const { sessionId } = await setup();
    const old = await token(sessionId);
    await repo.updateDraft(sessionId, 0, { userResponse: '新草稿' }, old);
    await expect(repo.updateDraft(sessionId, 0, { userResponse: '旧页面' }, old)).rejects.toThrow(
      '另一页面',
    );
    expect((await session(sessionId)).draft.userResponse).toBe('新草稿');
    const beforeReveal = await token(sessionId);
    await reveal(sessionId);
    await expect(
      repo.updateDraft(sessionId, 0, { userResponse: '揭晓后旧输入' }, beforeReveal),
    ).rejects.toThrow();
    expect((await session(sessionId)).draft.userResponse).toBe('新草稿');
  });
  it('stale tokens cannot target another item after the queue changes', async () => {
    const { projectId, sessionId } = await setup(2);
    const old = await token(sessionId);
    const current = (await session(sessionId)).queue[0]!;
    await repo.archiveCard(projectId, current.id);
    await repo.syncSession(sessionId, 0, old);
    await expect(
      repo.updateDraft(sessionId, 0, { userResponse: '错误题目的回答' }, old),
    ).rejects.toThrow();
    expect((await session(sessionId)).draft.userResponse).toBe('');
  });
});
