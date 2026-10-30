import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import Dexie from 'dexie';
import { RecallDatabase } from '../persistence/database';
import { dataTables } from '../persistence/migration';
import { Repository } from '../persistence/repository';
import { ScheduleService } from '../scheduling/service';
import { tokenOf } from '../domain/revisions';
import { exportBackup, restoreBackup } from '../persistence/backup';
import { estimateSeconds } from './estimates';
let db: RecallDatabase, repo: Repository, service: ScheduleService, pid: string, ids: string[];
const raw = (n: number) => ({
  question: `虚构城市${n}的标识是什么？`,
  standardAnswer: `标识${n}`,
  hints: '虚构提示',
  answerCriteria: '完整标识',
  mnemonics: '',
  confusionWarnings: '',
  sourceLabel: '',
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T02:00:00Z'));
  db = new RecallDatabase(`goal-test-${crypto.randomUUID()}`);
  repo = new Repository(db);
  service = new ScheduleService(db, () => new Date(), 'Asia/Shanghai');
  pid = await repo.saveProject({
    name: '公开虚构任务',
    description: '',
    learningGoal: '',
    targetDate: '2026-11-03',
    dailyTimeBudget: 30,
  });
  ids = [];
  for (let i = 0; i < 8; i++) ids.push(await repo.saveCard(pid, raw(i)));
  const p = (await db.projects.get(pid))!;
  await service.configureGoal(
    pid,
    {
      targetDate: p.targetDate,
      dailyTimeBudget: 30,
      automaticGoal: { version: 'goal-v1', objective: 'exam' },
    },
    p.updatedAt,
  );
});
afterEach(async () => {
  await db.delete();
  vi.useRealTimers();
});
async function answer(
  opts: { hint?: boolean; response?: string; skip?: boolean; seconds?: number } = {},
) {
  const sid = await service.start(pid, { adaptive: true });
  let s = (await db.sessions.get(sid))!;
  const index = s.index;
  const item = s.queue[index]!;
  const response = opts.response ?? item.standardAnswer;
  const presented = Date.now();
  vi.setSystemTime(new Date(presented + (opts.seconds ?? 10) * 1000));
  s = await repo.updateDraft(
    sid,
    index,
    {
      responseMode: 'typed',
      userResponse: response,
      timing: {
        version: 'active-v1',
        presentedAt: new Date(presented).toISOString(),
        attemptedAt: new Date(presented).toISOString(),
        observedAt: new Date().toISOString(),
        activeMs: (opts.seconds ?? 10) * 1000,
        backgroundMs: 0,
        idleMs: 0,
        unknownMs: 0,
        interruptions: 0,
      },
    },
    tokenOf(s),
  );
  if (opts.hint) s = await repo.updateDraft(sid, index, {}, tokenOf(s), 'hint');
  if (!opts.skip) s = await repo.updateDraft(sid, index, {}, tokenOf(s), 'reveal');
  return { s, index, item };
}
it('writes exact evidence, immutable event, FSRS state and remaining adaptive plan atomically; retains them through backup', async () => {
  const { s, index, item } = await answer();
  const before = structuredClone(s);
  await repo.submitReview(s.id, index, 'correct', null, tokenOf(s), 'good', true);
  const e = (await db.reviewEvents.toArray())[0]!;
  expect(e).toMatchObject({
    schemaVersion: 5,
    subjectiveMastery: null,
    assessmentSource: 'deterministic',
    assessmentResult: 'correct',
    quickFeedback: { checker: 'exact-short-v1', literalMatch: true, overridden: false },
    scheduling: { grade: 3 },
  });
  expect((await db.memoryStates.get(item.learningStateId!))?.card.reps).toBe(1);
  expect((await db.sessions.get(s.id))?.queue.slice(0, index + 1)).toEqual(
    before.queue.slice(0, index + 1),
  );
  await expect(repo.submitReview(s.id, index, 'incorrect', null, tokenOf(s))).resolves.toBe(false);
  expect(await db.reviewEvents.count()).toBe(1);
  const backup = await exportBackup(db);
  await restoreBackup(db, backup);
  const after = await exportBackup(db);
  expect({
    ...after.data,
    sessions: after.data.sessions.map((s) => ({ ...s, generation: 'rotated' })),
  }).toEqual({
    ...backup.data,
    sessions: backup.data.sessions.map((s) => ({ ...s, generation: 'rotated' })),
  });
  expect(after.data.sessions[0]?.generation).not.toBe(backup.data.sessions[0]?.generation);
  const tampered = structuredClone(backup);
  tampered.data.reviewEvents[0]!.userResponse = '与答案不一致';
  await expect(restoreBackup(db, tampered)).rejects.toThrow();
  expect((await db.reviewEvents.toArray())[0]).toEqual(e);
});
it('rejects forged automatic successes; hints, skipped and unknown answers never become independent successes', async () => {
  const { s, index, item } = await answer({ hint: true });
  await expect(
    repo.submitReview(s.id, index, 'correct', null, tokenOf(s), 'easy', true),
  ).rejects.toThrow();
  expect(await db.reviewEvents.count()).toBe(0);
  await repo.submitReview(s.id, index, 'correct', null, tokenOf(s), 'easy');
  const first = (await db.reviewEvents.toArray())[0]!;
  expect(first.scheduling?.grade).toBeNull();
  expect((await db.memoryStates.get(item.learningStateId!))?.retestDue).toBeTruthy();
  const second = await answer({ skip: true });
  await repo.submitReview(second.s.id, second.index, 'skipped', null, tokenOf(second.s));
  const e = (await db.reviewEvents.toArray()).find((e) => e.assessmentResult === 'skipped')!;
  expect(e.scheduling?.grade).toBeNull();
  expect((await db.memoryStates.get(second.item.learningStateId!))?.card.reps).toBe(0);
});
it('allows correcting a literal match to failure without subjective mastery and does not infer failure from mismatched text', async () => {
  const { s, index, item } = await answer();
  await repo.submitReview(s.id, index, 'incorrect', null, tokenOf(s), 'easy');
  const e = (await db.reviewEvents.toArray())[0]!;
  expect(e.scheduling?.grade).toBe(1);
  expect(e.quickFeedback?.overridden).toBe(true);
  expect(e.assessmentSource).toBe('user_checked');
  const next = await answer({ response: '另一种可能正确的表达' });
  await expect(
    repo.submitReview(next.s.id, next.index, 'correct', null, tokenOf(next.s), 'good', true),
  ).rejects.toThrow();
  await repo.submitReview(next.s.id, next.index, 'ungraded', null, tokenOf(next.s));
  expect((await db.memoryStates.get(next.item.learningStateId!))?.card.reps).toBe(0);
  expect((await db.memoryStates.get(item.learningStateId!))?.card.lapses).toBeGreaterThanOrEqual(0);
});
it('preserves a paused draft and isolates corrected answers; formatting revisions preserve memory', async () => {
  const a = await answer();
  await repo.submitReview(a.s.id, a.index, 'correct', null, tokenOf(a.s), 'good', true);
  const learned = (await db.practiceItems.get(a.item.id))!;
  const old = (await db.memoryStates.get(learned.learningStateId))!;
  await repo.saveCard(
    pid,
    { ...raw(0), question: learned.question, standardAnswer: `  ${learned.standardAnswer}  ` },
    learned.id,
    {
      changeType: 'cosmetic',
      changeSummary: '整理空白',
      impactOnLearningState: 'preserve',
      expectedRevisionId: learned.currentRevisionId,
    },
  );
  expect((await db.practiceItems.get(learned.id))!.learningStateId).toBe(old.id);
  const current = (await db.practiceItems.get(learned.id))!;
  await repo.saveCard(
    pid,
    { ...raw(0), question: current.question, standardAnswer: '已更正的虚构答案' },
    current.id,
    {
      changeType: 'substantive',
      changeSummary: '修正答案',
      impactOnLearningState: 'reset',
      expectedRevisionId: current.currentRevisionId,
    },
  );
  expect((await db.practiceItems.get(current.id))!.learningStateId).not.toBe(old.id);
  expect(await db.memoryStates.get(old.id)).toEqual(old);
  const sid = await service.start(pid, { adaptive: true });
  let s = (await db.sessions.get(sid))!;
  s = await repo.updateDraft(
    sid,
    s.index,
    { userResponse: '尚未提交的私有输入（虚构）', responseMode: 'typed' },
    tokenOf(s),
  );
  const before = await exportBackup(db);
  const p = (await db.projects.get(pid))!;
  await service.configureGoal(
    pid,
    { targetDate: '2026-11-05', dailyTimeBudget: 20, automaticGoal: p.automaticGoal },
    p.updatedAt,
  );
  expect(await service.start(pid, { adaptive: true })).toBe(sid);
  const resumed = (await db.sessions.get(sid))!;
  expect(resumed.draft.userResponse).toBe(s.draft.userResponse);
  expect(resumed.queue[resumed.index]!.id).toBe(s.queue[s.index]!.id);
  expect((await exportBackup(db)).data.reviewEvents).toEqual(before.data.reviewEvents);
  await expect(
    service.configureGoal(
      pid,
      { targetDate: '2026-12-01', dailyTimeBudget: 10, automaticGoal: p.automaticGoal },
      p.updatedAt,
    ),
  ).rejects.toThrow();
});
it('learns durations only from enough trustworthy active attempts, never from a 20-minute absence', async () => {
  for (let i = 0; i < 6; i++) {
    const a = await answer();
    await repo.submitReview(a.s.id, a.index, 'correct', null, tokenOf(a.s), 'good', true);
  }
  const events = await db.reviewEvents.toArray(),
    item = (await db.practiceItems.get(ids[7]!))!;
  expect(estimateSeconds(item, events, false).source).toBe('observed');
  const absent = events.map((e) => ({ ...e, timing: { ...e.timing!, backgroundMs: 1200000 } }));
  expect(estimateSeconds(item, absent, false).source).toBe('generic');
});
it.each([false, true])(
  'v7 to v8 protects raw histories and drafts; rejects damaged upgrades with full rollback: %s',
  async (broken) => {
    const a = await answer();
    await repo.submitReview(a.s.id, a.index, 'correct', null, tokenOf(a.s));
    const backup = await exportBackup(db);
    // A real old v7 layout, not a version-header-only test. Remove all newly introduced optional semantics.
    const data = structuredClone(backup.data);
    for (const p of data.projects) delete p.automaticGoal;
    for (const s of data.sessions) {
      delete s.reviewPlan!.adaptive;
      delete s.reviewPlan!.compact;
      delete s.reviewPlan!.goalUpdatedAt;
      delete s.reviewPlan!.remainingBudgetSeconds;
      for (const entry of Object.values(s.reviewPlan!.entries)) {
        delete entry.explanation;
        delete entry.estimatedSeconds;
      }
      delete s.draft.timing;
    }
    for (const e of data.reviewEvents) {
      e.schemaVersion = 3;
      e.subjectiveMastery = 3;
      delete e.quickFeedback;
      delete e.timing;
    }
    if (broken) data.practiceItems[0]!.currentRevisionId = 'missing-revision';
    const name = `real-v7-${crypto.randomUUID()}`;
    const oldDb = new Dexie(name);
    oldDb
      .version(7)
      .stores(Object.fromEntries([...dataTables, 'recoveryBackups'].map((n) => [n, 'id'])));
    await oldDb.open();
    for (const table of dataTables) await oldDb.table(table).bulkAdd(data[table]);
    oldDb.close();
    const upgraded = new RecallDatabase(name);
    try {
      if (broken) {
        await expect(upgraded.open()).rejects.toThrow();
        upgraded.close();
        const rawDb = new Dexie(name);
        await rawDb.open();
        expect(rawDb.verno).toBe(7);
        expect(await rawDb.table('recoveryBackups').count()).toBe(0);
        expect(
          (await rawDb.table('practiceItems').get(data.practiceItems[0]!.id)).currentRevisionId,
        ).toBe('missing-revision');
        rawDb.close();
      } else {
        await upgraded.open();
        expect(upgraded.verno).toBe(8);
        expect((await exportBackup(upgraded)).data).toEqual(data);
        const copies = await upgraded.recoveryBackups.toArray();
        expect(copies).toHaveLength(1);
        expect(JSON.parse(copies[0]!.json)).toMatchObject({
          databaseVersion: 7,
          data: JSON.parse(JSON.stringify(data)),
        });
      }
    } finally {
      upgraded.close();
      await Dexie.delete(name);
    }
  },
);
it('keeps drafts across a local day and DST change, replenishes due tasks and restores the resulting backup', async () => {
  const first = await answer();
  await repo.submitReview(first.s.id, first.index, 'correct', null, tokenOf(first.s), 'good', true);
  let s = (await db.sessions.get(first.s.id))!;
  s = await repo.updateDraft(s.id, s.index, { userResponse: '跨日继续的虚构作答' }, tokenOf(s));
  const oldEvents = await db.reviewEvents.toArray();
  vi.setSystemTime(new Date('2026-11-01T06:01:00Z'));
  expect(await service.start(pid, { adaptive: true })).toBe(s.id);
  s = (await db.sessions.get(s.id))!;
  expect(s.draft.userResponse).toBe('跨日继续的虚构作答');
  expect(s.queue[s.index]!.id).not.toBe(first.item.id);
  expect(s.queue.slice(s.index + 1).some((q) => q.id === first.item.id)).toBe(true);
  const b = await exportBackup(db);
  await restoreBackup(db, b);
  expect(await db.reviewEvents.toArray()).toEqual(oldEvents);
});
it('does not bypass required detailed checks with a quick positive result and stops adding work after recorded budget is exhausted', async () => {
  const a = await answer();
  const s = await repo.updateAssessment(
    a.s.id,
    a.index,
    { mode: 'detailed', marks: ['omitted'], mastery: 4, performance: 'correct' },
    tokenOf(a.s),
  );
  await repo.submitReview(s.id, s.index, 'correct', null, tokenOf(s));
  expect((await db.reviewEvents.toArray())[0]!.scheduling?.grade).toBe(1);
  const b = await answer({ seconds: 1800 });
  const timed = b.s;
  await repo.submitReview(timed.id, timed.index, 'correct', null, tokenOf(timed));
  const finished = (await db.sessions.get(timed.id))!;
  expect(finished.status).toBe('completed');
  expect(finished.index).toBe(finished.queue.length);
});
it('adopts a legacy formal session without losing its draft and refreshes newly added cards even when the goal timestamp is unchanged', async () => {
  const sid = await service.start(pid);
  let s = (await db.sessions.get(sid))!;
  expect(s.reviewPlan?.compact).toBeUndefined();
  s = await repo.updateDraft(
    sid,
    0,
    { userResponse: '旧版正式练习的虚构草稿', responseMode: 'typed' },
    tokenOf(s),
  );
  expect(await service.start(pid, { adaptive: true })).toBe(sid);
  let resumed = (await db.sessions.get(sid))!;
  expect(resumed.reviewPlan).toMatchObject({ compact: true, adaptive: true });
  expect(resumed.draft).toEqual(s.draft);
  const p = (await db.projects.get(pid))!;
  const added = await repo.saveCard(pid, raw(99));
  expect((await db.projects.get(pid))!.updatedAt).toBe(p.updatedAt);
  await service.start(pid, { adaptive: true });
  resumed = (await db.sessions.get(sid))!;
  expect(resumed.queue.some((q) => q.id === added)).toBe(true);
  expect(resumed.draft.userResponse).toBe(s.draft.userResponse);
  expect(await db.reviewEvents.count()).toBe(0);
});
