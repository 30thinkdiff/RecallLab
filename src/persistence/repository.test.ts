import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecallDatabase } from './database';
import { Repository } from './repository';
import type { CardInput, ProjectInput } from '../domain/validation';

const project: ProjectInput = {
  name: '心理学',
  description: '',
  learningGoal: '',
  targetDate: '',
  dailyTimeBudget: 20,
};
const card: CardInput = {
  question: '什么是主动回忆？',
  standardAnswer: '不查看答案，主动提取记忆。',
  hints: '先不要看答案\n从记忆中提取',
  answerCriteria: '不查看答案\n主动提取',
  mnemonics: '',
  confusionWarnings: '',
  sourceLabel: '手工笔记',
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

describe('local repository', () => {
  it('creates, edits and archives projects while retaining their learning evidence', async () => {
    const id = await repo.saveProject(project);
    await repo.saveProject({ ...project, name: '改名' }, id);
    expect((await db.projects.get(id))?.name).toBe('改名');
    await repo.saveCard(id, card);
    await repo.archiveProject(id);
    expect((await db.projects.get(id))?.archivedAt).toBeTruthy();
    expect(await db.practiceItems.count()).toBe(1);
    await expect(repo.startSession(id)).rejects.toThrow('不存在');
  });

  it('separates knowledge and practice and rejects empty content', async () => {
    const id = await repo.saveProject(project);
    await expect(repo.saveCard(id, { ...card, question: '  ' })).rejects.toThrow();
    expect(await db.knowledgeUnits.count()).toBe(0);
    await repo.saveCard(id, card);
    expect(await db.knowledgeUnits.count()).toBe(1);
    expect(await db.practiceItems.count()).toBe(1);
  });

  it('persists data across a closed and reopened IndexedDB connection', async () => {
    const id = await repo.saveProject(project);
    await repo.saveCard(id, card);
    const sessionId = await repo.startSession(id);
    await repo.updateDraft(sessionId, 0, {}, 'reveal');
    await repo.submitReview(sessionId, 0, 'ungraded', 2);
    db.close();
    await db.open();
    expect((await db.projects.get(id))?.name).toBe(project.name);
    expect(await db.practiceItems.count()).toBe(1);
    expect(await db.reviewEvents.count()).toBe(1);
  });

  it('isolates projects and prevents a card from being edited through a different project', async () => {
    const first = await repo.saveProject(project);
    const second = await repo.saveProject({ ...project, name: '第二项目' });
    const itemId = await repo.saveCard(first, card);
    await expect(repo.saveCard(second, card, itemId)).rejects.toThrow();
    await expect(repo.startSession(second)).rejects.toThrow('至少');
    const sessionId = await repo.startSession(first);
    expect((await db.sessions.get(sessionId))?.queue).toHaveLength(1);
  });

  it('starts only one active session when start is clicked twice', async () => {
    const id = await repo.saveProject(project);
    await repo.saveCard(id, card);
    const [first, second] = await Promise.all([repo.startSession(id), repo.startSession(id)]);
    expect(first).toBe(second);
    expect(await db.sessions.count()).toBe(1);
  });

  it('commits an event and queue advancement once under concurrent double submission', async () => {
    const id = await repo.saveProject(project);
    await repo.saveCard(id, card);
    await repo.saveCard(id, { ...card, question: '第二题' });
    const session = await repo.startSession(id);
    await repo.updateDraft(session, 0, { attemptedBeforeReveal: true }, 'reveal');
    const results = await Promise.all([
      repo.submitReview(session, 0, 'correct', 4),
      repo.submitReview(session, 0, 'correct', 4),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(await db.reviewEvents.count()).toBe(1);
    expect((await db.sessions.get(session))?.index).toBe(1);
  });

  it('retains the original question revision after the answer is edited', async () => {
    const id = await repo.saveProject(project);
    const item = await repo.saveCard(id, card);
    const session = await repo.startSession(id);
    await repo.saveCard(id, { ...card, standardAnswer: '新的答案' }, item);
    await repo.updateDraft(session, 0, {}, 'reveal');
    await repo.submitReview(session, 0, 'ungraded', 1);
    const event = await db.reviewEvents.toCollection().first();
    expect(event?.snapshot.standardAnswer).toBe(card.standardAnswer);
    expect(event?.snapshot.revision).toBe(1);
    expect((await db.practiceItems.get(item))?.revision).toBe(2);
  });

  it('freezes evidence after reveal and preserves hint usage across response mode changes', async () => {
    const id = await repo.saveProject(project);
    await repo.saveCard(id, card);
    const session = await repo.startSession(id);
    await repo.updateDraft(session, 0, {}, 'hint');
    await repo.updateDraft(
      session,
      0,
      { responseMode: 'typed', userResponse: '我自己的答案' },
      'reveal',
    );
    await expect(repo.updateDraft(session, 0, { userResponse: '改成标准答案' })).rejects.toThrow(
      '证据',
    );
    await repo.submitReview(session, 0, 'partially_correct', 4);
    const event = await db.reviewEvents.toCollection().first();
    expect(event?.hintLevelUsed).toBe(1);
    expect(event?.wasIndependentRecall).toBe(false);
    expect(event?.assessmentResult).toBe('partially_correct');
    expect(event?.subjectiveMastery).toBe(4);
    expect(event?.userResponse).toBe('我自己的答案');
  });

  it('keeps reveal, hints and drafts when resuming a session', async () => {
    const id = await repo.saveProject(project);
    await repo.saveCard(id, card);
    const session = await repo.startSession(id);
    await repo.updateDraft(
      session,
      0,
      { responseMode: 'typed', userResponse: '保存的输入' },
      'hint',
    );
    db.close();
    await db.open();
    expect(await repo.startSession(id)).toBe(session);
    expect((await db.sessions.get(session))?.draft.userResponse).toBe('保存的输入');
    expect((await db.sessions.get(session))?.draft.hintLevelUsed).toBe(1);
  });

  it('skips without fabricating a score and preserves previous events on card deletion', async () => {
    const id = await repo.saveProject(project);
    const item = await repo.saveCard(id, card);
    const session = await repo.startSession(id);
    await expect(repo.archiveCard(id, item)).rejects.toThrow('当前学习');
    await repo.submitReview(session, 0, 'skipped', null);
    await repo.archiveCard(id, item);
    const event = await db.reviewEvents.toCollection().first();
    expect(event?.subjectiveMastery).toBeNull();
    expect(event?.assessmentResult).toBe('skipped');
    expect(event?.wasAnswerRevealed).toBe(false);
    expect(event?.wasIndependentRecall).toBe(false);
    expect((await db.practiceItems.get(item))?.archivedAt).toBeTruthy();
  });

  it('rolls back the event when the user has not revealed and rated the answer', async () => {
    const id = await repo.saveProject(project);
    await repo.saveCard(id, card);
    const session = await repo.startSession(id);
    await expect(repo.submitReview(session, 0, 'correct', 4)).rejects.toThrow('揭晓');
    expect(await db.reviewEvents.count()).toBe(0);
    expect((await db.sessions.get(session))?.index).toBe(0);
  });
});
