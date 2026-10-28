import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { RecallDatabase } from '../persistence/database';
import { Repository } from '../persistence/repository';
import { ScheduleService } from './service';
import { tokenOf } from '../domain/revisions';
import { exportBackup, restoreBackup } from '../persistence/backup';
import type { Performance } from '../domain/models';
let db: RecallDatabase,
  repo: Repository,
  scheduler: ScheduleService,
  projectId: string,
  itemId: string;
const raw = {
  question: '虚构规则甲是什么？',
  standardAnswer: '虚构答案甲',
  hints: '虚构提示',
  answerCriteria: '必须完整',
  mnemonics: '',
  confusionWarnings: '',
  sourceLabel: '虚构',
};
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
  db = new RecallDatabase(`scheduled-${crypto.randomUUID()}`);
  repo = new Repository(db);
  scheduler = new ScheduleService(db, () => new Date(), 'Asia/Shanghai');
  projectId = await repo.saveProject({
    name: '虚构',
    description: '',
    learningGoal: '',
    targetDate: '2026-11-01',
    dailyTimeBudget: 30,
  });
  itemId = await repo.saveCard(projectId, raw);
});
afterEach(async () => {
  await db.delete();
  vi.useRealTimers();
});
async function prepare({
  hint = false,
  attempt = true,
  mode = 'daily',
}: { hint?: boolean; attempt?: boolean; mode?: 'daily' | 'custom' } = {}) {
  const id = await scheduler.start(projectId, {
    mode,
    customIds: [itemId],
    extraPractice: mode === 'custom',
  });
  let s = (await db.sessions.get(id))!;
  s = await repo.updateDraft(
    id,
    0,
    { responseMode: 'typed', userResponse: attempt ? '公开虚构作答' : '' },
    tokenOf(s),
  );
  if (hint) s = await repo.updateDraft(id, 0, {}, tokenOf(s), 'hint');
  s = await repo.updateDraft(id, 0, {}, tokenOf(s), 'reveal');
  return s;
}
async function submit(
  performance: Performance = 'correct',
  opts: Parameters<typeof prepare>[0] = {},
) {
  const s = await prepare(opts);
  await repo.submitReview(s.id, 0, performance, 4, tokenOf(s), 'easy');
  return { s, event: (await db.reviewEvents.toArray())[0]! };
}
it('initializes only when explicitly starting review, atomically schedules a real independent success and restores it', async () => {
  expect(await db.memoryStates.count()).toBe(0);
  const { event } = await submit();
  expect(event.scheduling?.grade).toBe(4);
  expect(event.userResponse).toBe('公开虚构作答');
  expect(event.assessmentSource).toBe('user_checked');
  const item = (await db.practiceItems.get(itemId))!;
  expect((await db.memoryStates.get(item.learningStateId))?.card.reps).toBe(1);
  const backup = await exportBackup(db);
  await restoreBackup(db, backup);
  expect((await exportBackup(db)).data.memoryStates).toEqual(backup.data.memoryStates);
});
it('does not turn forgetting into Hard, despite maximal subjective mastery', async () => {
  const { event } = await submit('incorrect');
  expect(event.subjectiveMastery).toBe(4);
  expect(event.scheduling?.grade).toBe(1);
});
it.each([
  { hint: true, attempt: true },
  { hint: false, attempt: false },
])('teaching practice creates only a retest, not FSRS success (%j)', async (opts) => {
  const { event } = await submit('correct', opts);
  expect(event.scheduling?.grade).toBeNull();
  const m = (await db.memoryStates.toArray())[0]!;
  expect(m.card.reps).toBe(0);
  expect(m.retestDue).toBe('2026-10-27T12:10:00.000Z');
  expect((await db.schedulingLogs.toArray())[0]?.fsrsLog).toBeUndefined();
});
it('skipping preserves memory and does not invent failure', async () => {
  const id = await scheduler.start(projectId);
  const s = (await db.sessions.get(id))!;
  await repo.submitReview(id, 0, 'skipped', null, tokenOf(s));
  expect((await db.memoryStates.toArray())[0]?.version).toBe(0);
  expect((await db.reviewEvents.toArray())[0]?.scheduling?.reason).toBe('skipped');
});
it('temporary practice never schedules even when correct or after refreshing the queue', async () => {
  const s = await prepare({ mode: 'custom' });
  const updated = await repo.syncSession(s.id, 0, tokenOf(s), {});
  await repo.submitReview(updated.id, 0, 'correct', 4, tokenOf(updated), 'easy');
  expect((await db.reviewEvents.toArray())[0]?.scheduling?.reason).toBe('practice');
  expect((await db.memoryStates.toArray())[0]?.card.reps).toBe(0);
});
it('simultaneous tabs commit one raw event, one scheduling log and one state transition', async () => {
  const s = await prepare();
  const results = await Promise.allSettled([
    repo.submitReview(s.id, 0, 'correct', 4, tokenOf(s)),
    repo.submitReview(s.id, 0, 'correct', 4, tokenOf(s)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled' && r.value === true)).toHaveLength(1);
  expect(await db.reviewEvents.count()).toBe(1);
  expect(await db.schedulingLogs.count()).toBe(1);
  expect((await db.memoryStates.toArray())[0]?.card.reps).toBe(1);
});
it('a failed scheduling write rolls back the event, state and session position', async () => {
  const s = await prepare();
  const fail = () => {
    throw new Error('虚构磁盘失败');
  };
  db.schedulingLogs.hook('creating', fail);
  await expect(repo.submitReview(s.id, 0, 'correct', 4, tokenOf(s))).rejects.toThrow('磁盘失败');
  db.schedulingLogs.hook('creating').unsubscribe(fail);
  expect(await db.reviewEvents.count()).toBe(0);
  expect((await db.memoryStates.toArray())[0]?.card.reps).toBe(0);
  expect((await db.sessions.get(s.id))?.index).toBe(0);
});
it('substantive corrections isolate old memory while cosmetic changes preserve it', async () => {
  await submit();
  let item = (await db.practiceItems.get(itemId))!;
  const state = item.learningStateId;
  await repo.saveCard(projectId, { ...raw, standardAnswer: raw.standardAnswer + '。' }, itemId, {
    expectedRevisionId: item.currentRevisionId,
    changeType: 'cosmetic',
    changeSummary: '仅标点',
    impactOnLearningState: 'preserve',
  });
  item = (await db.practiceItems.get(itemId))!;
  expect(item.learningStateId).toBe(state);
  expect((await db.memoryStates.get(state))?.card.reps).toBe(1);
  await repo.saveCard(projectId, { ...raw, standardAnswer: '更正后的答案' }, itemId, {
    expectedRevisionId: item.currentRevisionId,
    changeType: 'substantive',
    changeSummary: '更正错误',
    impactOnLearningState: 'reset',
  });
  item = (await db.practiceItems.get(itemId))!;
  expect(item.learningStateId).not.toBe(state);
  await scheduler.start(projectId);
  expect((await db.memoryStates.get(item.learningStateId))?.card.reps).toBe(0);
  expect((await db.memoryStates.get(state))?.card.reps).toBe(1);
  expect(await db.reviewEvents.count()).toBe(1);
});

it('rejects a backup that re-labels actual failure as Hard even with matching forged log rating', async () => {
  await submit('incorrect');
  const backup = await exportBackup(db);
  backup.data.reviewEvents[0]!.scheduling!.grade = 2;
  backup.data.schedulingLogs[0]!.decision.grade = 2;
  backup.data.schedulingLogs[0]!.fsrsLog!.rating = 2;
  await expect(restoreBackup(db, backup)).rejects.toThrow('矛盾');
  expect((await db.reviewEvents.toArray())[0]?.scheduling?.grade).toBe(1);
});

it('shows only current-version manual evidence while retaining real historical workload', async () => {
  const { event } = await submit();
  const { reviewStatistics } = await import('./analytics');
  let stats = reviewStatistics(
    await db.practiceItems.toArray(),
    await db.reviewEvents.toArray(),
    await db.memoryStates.toArray(),
    await db.schedulingLogs.toArray(),
    await db.revisions.toArray(),
    new Date(),
    'Asia/Shanghai',
  );
  expect(stats.manualSamples).toBe(1);
  expect(stats.accuracy).toBe(1);
  expect(stats.reported).toBe(0);
  expect(stats.recentScheduled).toBe(1);
  expect(stats.distribution.reduce((sum, r) => sum + r.count, 0)).toBe(1);
  const current = (await db.practiceItems.get(itemId))!;
  await repo.saveCard(projectId, { ...raw, standardAnswer: '新的正确答案' }, itemId, {
    expectedRevisionId: current.currentRevisionId,
    changeType: 'substantive',
    changeSummary: '更正',
    impactOnLearningState: 'reset',
  });
  stats = reviewStatistics(
    await db.practiceItems.toArray(),
    await db.reviewEvents.toArray(),
    await db.memoryStates.toArray(),
    await db.schedulingLogs.toArray(),
    await db.revisions.toArray(),
    new Date(),
    'Asia/Shanghai',
  );
  expect(stats.accuracy).toBeNull();
  expect(stats.recentScheduled).toBe(1);
  expect(stats.distribution.every((r) => r.count === 0)).toBe(true);
  expect((await db.reviewEvents.get(event.id))?.snapshot.standardAnswer).toBe(raw.standardAnswer);
});
it('reports hinted success without relabeling it as independent correctness or scheduled success', async () => {
  await submit('correct', { hint: true });
  const { reviewStatistics } = await import('./analytics');
  const s = reviewStatistics(
    await db.practiceItems.toArray(),
    await db.reviewEvents.toArray(),
    await db.memoryStates.toArray(),
    await db.schedulingLogs.toArray(),
    await db.revisions.toArray(),
    new Date(),
    'Asia/Shanghai',
  );
  expect(s.hintedSuccess).toBe(1);
  expect(s.manualSamples).toBe(0);
  expect(s.accuracy).toBeNull();
  expect(s.recentScheduled).toBe(0);
  expect(s.todayCompleted).toBe(1);
  const bad = await exportBackup(db);
  bad.data.memoryStates[0]!.retestDue = '2027-01-01T00:00:00.000Z';
  await expect(restoreBackup(db, bad)).rejects.toThrow('复测时间');
});

it('rejects a backup that aliases two different questions to the same learning state', async () => {
  await submit();
  const otherId = await repo.saveCard(projectId, { ...raw, question: '另一道虚构题' });
  const backup = await exportBackup(db);
  const a = backup.data.practiceItems.find((c) => c.id === itemId)!,
    b = backup.data.practiceItems.find((c) => c.id === otherId)!;
  b.learningStateId = a.learningStateId;
  const revision = backup.data.revisions.find((r) => r.id === b.currentRevisionId)!;
  revision.learningStateId = a.learningStateId!;
  revision.snapshot.learningStateId = a.learningStateId;
  await expect(restoreBackup(db, backup)).rejects.toThrow('跨题目');
  expect((await db.practiceItems.get(otherId))?.learningStateId).not.toBe(a.learningStateId);
});

it('rejects retaining real FSRS grades for a changed answer mislabeled as a cosmetic revision', async () => {
  await submit();
  const item = (await db.practiceItems.get(itemId))!;
  await repo.saveCard(projectId, { ...raw, standardAnswer: raw.standardAnswer + '。' }, itemId, {
    expectedRevisionId: item.currentRevisionId,
    changeType: 'cosmetic',
    changeSummary: '标点',
    impactOnLearningState: 'preserve',
  });
  const backup = await exportBackup(db);
  const current = backup.data.practiceItems.find((c) => c.id === itemId)!;
  current.standardAnswer = '不同知识内容';
  backup.data.revisions.find((r) => r.id === current.currentRevisionId)!.snapshot.standardAnswer =
    current.standardAnswer;
  await expect(restoreBackup(db, backup)).rejects.toThrow('不同知识内容');
  expect((await db.memoryStates.toArray())[0]?.card.reps).toBe(1);
});

it('anchors a paused overnight answer to the actual recall time, without manufacturing another day of retention', async () => {
  const s = await prepare();
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
  await repo.submitReview(s.id, 0, 'correct', 3, tokenOf(s), 'good');
  const event = (await db.reviewEvents.toArray())[0]!,
    memory = (await db.memoryStates.toArray())[0]!;
  expect(event.timestamp).toBe('2026-10-28T12:00:00.000Z');
  expect(event.reviewedAt).toBe('2026-10-27T12:00:00.000Z');
  expect(memory.card.last_review).toBe(event.reviewedAt);
  expect(Date.parse(memory.due)).toBeLessThan(Date.now());
  await expect(exportBackup(db)).resolves.toBeDefined();
});

it('produces only actually performed reviews across a controlled week and shows the resulting workload', async () => {
  const { buildPlan } = await import('./planner');
  let performed = 0;
  for (let day = 0; day < 7; day++) {
    vi.setSystemTime(new Date(Date.parse('2026-10-27T12:00:00Z') + day * 86400000));
    const project = (await db.projects.get(projectId))!;
    const plan = buildPlan(
      project,
      await db.practiceItems.toArray(),
      await db.memoryStates.toArray(),
      await db.reviewEvents.toArray(),
      new Date(),
      'Asia/Shanghai',
    );
    if (!plan.selected.length) continue;
    const s = await prepare();
    await repo.submitReview(s.id, 0, 'correct', 3, tokenOf(s), 'good');
    performed++;
  }
  const { reviewStatistics } = await import('./analytics');
  const stats = reviewStatistics(
    await db.practiceItems.toArray(),
    await db.reviewEvents.toArray(),
    await db.memoryStates.toArray(),
    await db.schedulingLogs.toArray(),
    await db.revisions.toArray(),
    new Date(),
    'Asia/Shanghai',
  );
  expect(performed).toBeGreaterThan(1);
  expect(performed).toBeLessThanOrEqual(7);
  expect(stats.recentScheduled).toBe(performed);
  expect(stats.manualSamples).toBe(performed);
  expect((await db.memoryStates.toArray())[0]?.card.reps).toBe(performed);
  await expect(exportBackup(db)).resolves.toBeDefined();
});
