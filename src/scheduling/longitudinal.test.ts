import { it, expect, vi } from 'vitest';
import { RecallDatabase } from '../persistence/database';
import { Repository } from '../persistence/repository';
import { ScheduleService } from './service';
import { buildPlan, localDay } from './planner';
import { tokenOf } from '../domain/revisions';
import { exportBackup, restoreBackup } from '../persistence/backup';
import { reviewStatistics } from './analytics';
const input = {
  question: '虚构规则的要求是什么？',
  standardAnswer: '甲与乙两个必需内容。',
  answerCriteria: '甲\n乙',
  hints: '回忆第一项',
  mnemonics: '',
  confusionWarnings: '',
  sourceLabel: '公开虚构长期测试',
};
it('simulates 30 days, three projects, DST, competing budgets and revisions without fabricated scheduling', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const db = new RecallDatabase(`longitudinal-${crypto.randomUUID()}`),
    repo = new Repository(db),
    tz = 'America/New_York';
  const scheduler = new ScheduleService(db, () => new Date(), tz);
  try {
    vi.setSystemTime(new Date('2026-10-25T14:00:00Z'));
    const ids: string[] = [];
    for (let p = 0; p < 3; p++) {
      const id = await repo.saveProject({
        name: `虚构项目 ${p}`,
        description: '',
        learningGoal: '',
        targetDate: '2026-11-02',
        dailyTimeBudget: 6,
        newCardLimit: 2,
        priority: p + 1,
      });
      ids.push(id);
      for (let i = 0; i < 5; i++)
        await repo.saveCard(id, {
          ...input,
          question: `虚构项目 ${p} 条目 ${i} 的两个要求是什么？`,
        });
    }
    let graded = 0,
      practice = 0;
    for (let day = 0; day < 30; day++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 25 + day, 14)));
      const now = new Date();
      if (day === 12 || day === 18) {
        const c = (await db.practiceItems.where('projectId').equals(ids[0]!).toArray())[0]!;
        const preserve = day === 18;
        await repo.saveCard(
          c.projectId,
          {
            ...input,
            question: c.question,
            standardAnswer: preserve ? `${c.standardAnswer}  ` : '更正：丙与丁两个必需内容。',
          },
          c.id,
          {
            expectedRevisionId: c.currentRevisionId,
            changeType: preserve ? 'cosmetic' : 'substantive',
            changeSummary: preserve ? '仅调整空白' : '更正错误答案',
            impactOnLearningState: preserve ? 'preserve' : 'reset',
          },
        );
        const updated = (await db.practiceItems.get(c.id))!;
        expect(updated.learningStateId === c.learningStateId).toBe(preserve);
      }
      for (const [p, id] of ids.entries()) {
        if (day % 7 === 0) {
          const sid = await repo.startSession(id);
          let s = (await db.sessions.get(sid))!;
          const logs = await db.schedulingLogs.count();
          s = await repo.updateDraft(
            sid,
            s.index,
            { responseMode: 'typed', userResponse: '公开自由练习' },
            tokenOf(s),
          );
          s = await repo.updateDraft(sid, s.index, {}, tokenOf(s), 'reveal');
          await repo.submitReview(sid, s.index, 'correct', 4, tokenOf(s));
          practice++;
          expect(await db.schedulingLogs.count()).toBe(logs);
          s = (await db.sessions.get(sid))!;
          if (s.status === 'active') await repo.endSession(sid, s.index, tokenOf(s));
        }
        const project = (await db.projects.get(id))!;
        const plan = buildPlan(
          project,
          await db.practiceItems.toArray(),
          await db.memoryStates.toArray(),
          await db.reviewEvents.toArray(),
          now,
          tz,
        );
        expect(plan.selected.length).toBeLessThanOrEqual(3 - (day % 7 === 0 ? 1 : 0));
        expect(plan.selected.filter((r) => r.reason === 'new').length).toBeLessThanOrEqual(2);
        if (!plan.selected.length) continue;
        const sid = await scheduler.start(id);
        while (true) {
          let s = (await db.sessions.get(sid))!;
          if (s.status !== 'active') break;
          const roll = (day + p + s.index) % 9;
          s = await repo.updateDraft(
            sid,
            s.index,
            { responseMode: 'typed', userResponse: '公开虚构作答 Chinese / English' },
            tokenOf(s),
          );
          if (roll === 2) s = await repo.updateDraft(sid, s.index, {}, tokenOf(s), 'hint');
          s = await repo.updateDraft(sid, s.index, {}, tokenOf(s), 'reveal');
          const perf = roll === 0 ? 'incorrect' : roll === 3 ? 'partially_correct' : 'correct';
          await repo.submitReview(sid, s.index, perf, 4, tokenOf(s), 'easy');
          const e = await db.reviewEvents.get(`${sid}:${s.index}`);
          if (e!.scheduling!.grade !== null) graded++;
          if (roll === 2) expect(e!.scheduling!.grade).toBeNull();
          else if (perf !== 'correct') expect(e!.scheduling!.grade).toBe(1);
        }
        const after = buildPlan(
          project,
          await db.practiceItems.toArray(),
          await db.memoryStates.toArray(),
          await db.reviewEvents.toArray(),
          now,
          tz,
        );
        expect(after.completedToday).toBeLessThanOrEqual(3);
      }
      if (day === 14) {
        const b = await exportBackup(db);
        await restoreBackup(db, b);
        expect((await exportBackup(db)).data.reviewEvents).toEqual(b.data.reviewEvents);
      }
    }
    expect(localDay(new Date('2026-11-01T05:30Z'), tz)).toBe('2026-11-01');
    expect(localDay(new Date('2026-11-01T06:30Z'), tz)).toBe('2026-11-01');
    expect(graded).toBeGreaterThan(50);
    expect(practice).toBe(15);
    const backup = await exportBackup(db);
    expect(backup.data.memoryStates.reduce((sum, m) => sum + m.card.reps, 0)).toBe(graded);
    const stats = reviewStatistics(
      await db.practiceItems.toArray(),
      await db.reviewEvents.toArray(),
      await db.memoryStates.toArray(),
      await db.schedulingLogs.toArray(),
      await db.revisions.toArray(),
      new Date(),
      tz,
    );
    expect(stats.recentScheduled).toBeLessThanOrEqual(63);
    console.info(
      JSON.stringify({
        days: 30,
        projects: 3,
        items: 15,
        events: backup.data.reviewEvents.length,
        formalGrades: graded,
        freePractice: practice,
        memoryStates: backup.data.memoryStates.length,
      }),
    );
    await restoreBackup(db, backup);
    expect((await exportBackup(db)).data.schedulingLogs).toEqual(backup.data.schedulingLogs);
  } finally {
    await db.delete();
    vi.useRealTimers();
  }
}, 30000);
