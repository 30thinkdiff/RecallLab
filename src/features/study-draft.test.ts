import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecallDatabase } from '../persistence/database';
import { Repository } from '../persistence/repository';
import { StudyDraftController } from './study-draft';
import { exportBackup, restoreBackup } from '../persistence/backup';
let db: RecallDatabase;
let repo: Repository;
let id: string;
beforeEach(async () => {
  sessionStorage.clear();
  db = new RecallDatabase(`draft-${crypto.randomUUID()}`);
  repo = new Repository(db);
  const project = await repo.saveProject({
    name: '虚构并发',
    description: '',
    learningGoal: '',
    targetDate: '',
    dailyTimeBudget: 20,
  });
  await repo.saveCard(project, {
    question: '虚构问题',
    standardAnswer: '虚构答案',
    hints: '提示',
    answerCriteria: '',
    mnemonics: '',
    confusionWarnings: '',
    sourceLabel: '',
  });
  id = await repo.startSession(project);
});
afterEach(async () => {
  await db.delete();
  sessionStorage.clear();
});
async function current() {
  return (await db.sessions.get(id))!;
}

describe('serialized per-tab draft writer', () => {
  it('saves rapid normal input in order without spurious conflicts', async () => {
    const controller = new StudyDraftController(await current(), repo);
    controller.edit({ responseMode: 'typed' });
    for (const text of ['第', '第一', '第一份', '第一份回答'])
      controller.edit({ userResponse: text });
    await controller.flush();
    expect((await current()).draft.userResponse).toBe('第一份回答');
    expect(controller.getSnapshot()).toMatchObject({ pending: 0, conflict: false });
    expect(sessionStorage.length).toBe(0);
  });
  it('refuses one of two stale concurrent writers and keeps the losing local input', async () => {
    const base = await current();
    const first = new StudyDraftController(base, repo);
    const second = new StudyDraftController(base, repo);
    first.edit({ userResponse: '甲页面原始输入' });
    second.edit({ userResponse: '乙页面原始输入' });
    const result = await Promise.allSettled([first.flush(), second.flush()]);
    expect(result.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const loser = first.getSnapshot().conflict ? first : second;
    const losingInput = loser.getSnapshot().draft.userResponse;
    const saved = (await current()).draft.userResponse;
    expect(losingInput).not.toBe(saved);
    await loser.retainAndReload();
    expect((await current()).draft.userResponse).toBe(saved);
    expect((await db.draftRecoveries.toArray())[0]?.draft.userResponse).toBe(losingInput);
    expect(loser.getSnapshot().draft.userResponse).toBe(saved);
    expect(loser.getSnapshot().conflict).toBe(false);
  });
  it('adopts an observed remote draft when there is no unsaved local edit', async () => {
    const first = new StudyDraftController(await current(), repo);
    const second = new StudyDraftController(await current(), repo);
    first.edit({ userResponse: '已保存的新内容' });
    await first.flush();
    second.receive(await current());
    expect(second.getSnapshot().draft.userResponse).toBe('已保存的新内容');
    expect(second.getSnapshot().conflict).toBe(false);
    second.edit({ userResponse: '基于最新版本继续' });
    await second.flush();
    expect((await current()).draft.userResponse).toBe('基于最新版本继续');
  });
  it('never lets a stale writer change evidence after another tab reveals', async () => {
    const base = await current();
    const first = new StudyDraftController(base, repo);
    const second = new StudyDraftController(base, repo);
    await first.perform('reveal');
    second.edit({ userResponse: '揭晓后的伪造输入' });
    await expect(second.flush()).rejects.toThrow();
    expect((await current()).draft).toMatchObject({ wasAnswerRevealed: true, userResponse: '' });
    expect(second.getSnapshot().draft.userResponse).toBe('揭晓后的伪造输入');
  });
  it('retains a losing page input on navigation instead of discarding it', async () => {
    const base = await current();
    const first = new StudyDraftController(base, repo);
    const second = new StudyDraftController(base, repo);
    first.edit({ userResponse: '获胜草稿' });
    await first.flush();
    second.edit({ userResponse: '需要保护的旧页面输入' });
    await expect(second.flush()).rejects.toThrow();
    await second.protectLocal();
    expect((await db.draftRecoveries.toArray())[0]?.draft.userResponse).toBe(
      '需要保护的旧页面输入',
    );
  });
  it('invalidates every old page token on backup restore even when row IDs and versions match', async () => {
    const controller = new StudyDraftController(await current(), repo);
    const backup = await exportBackup(db);
    await restoreBackup(db, backup);
    controller.edit({ userResponse: '恢复前页面的旧写入' });
    await expect(controller.flush()).rejects.toThrow();
    expect((await current()).draft.userResponse).toBe('');
  });
  it('requires explicit reload when a clean tab observes a restored generation', async () => {
    const controller = new StudyDraftController(await current(), repo);
    await restoreBackup(db, await exportBackup(db));
    controller.receive(await current());
    expect(controller.getSnapshot().conflict).toBe(true);
    await expect(controller.perform('reveal')).rejects.toThrow();
    await controller.retainAndReload();
    expect(controller.getSnapshot().conflict).toBe(false);
  });
});

it('serializes an immediate reveal after its own queue refresh without waiting for React liveQuery', async () => {
  const controller = new StudyDraftController(await current(), repo);
  controller.edit({ responseMode: 'typed', userResponse: '保留的原始作答' });
  await controller.flush();
  const sync = controller.synchronize(false);
  const reveal = controller.perform('reveal');
  await Promise.all([sync, reveal]);
  expect(controller.getSnapshot().conflict).toBe(false);
  expect((await current()).draft).toMatchObject({
    userResponse: '保留的原始作答',
    wasAnswerRevealed: true,
  });
});
it('accepts its own plan-version notification before the refresh promise resolves and retains edits queued behind it', async () => {
  const controller = new StudyDraftController(await current(), repo);
  controller.edit({ userResponse: '先前草稿' });
  await controller.flush();
  const original = repo.syncSession.bind(repo);
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let committed!: () => void;
  const done = new Promise<void>((r) => {
    committed = r;
  });
  vi.spyOn(repo, 'syncSession').mockImplementation(async (...args) => {
    const updated = await original(...args);
    controller.receive(updated);
    committed();
    await gate;
    return updated;
  });
  const sync = controller.synchronize(false);
  await done;
  controller.edit({ userResponse: '同步期间继续输入' });
  release();
  await sync;
  await controller.flush();
  expect(controller.getSnapshot().conflict).toBe(false);
  expect((await current()).draft.userResponse).toBe('同步期间继续输入');
});
it('does not treat a different writer queue refresh as its own while local work is pending', async () => {
  const base = await current(),
    owner = new StudyDraftController(base, repo),
    other = new StudyDraftController(base, repo);
  await other.synchronize(false);
  owner.edit({ userResponse: '另页输入不能丢' });
  owner.receive(await current());
  await expect(owner.flush()).rejects.toThrow();
  expect(owner.getSnapshot().draft.userResponse).toBe('另页输入不能丢');
  expect((await current()).draft.userResponse).toBe('');
});
