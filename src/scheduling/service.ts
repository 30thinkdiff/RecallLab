import { db as defaultDb, type RecallDatabase } from '../persistence/database';
import type { ReviewEvent, StudySession } from '../domain/models';
import { promptProblem } from '../domain/readiness';
import { snapshotOf, ConflictError } from '../domain/revisions';
import { freshDraft } from '../domain/review';
import { initialMemory, advance } from './engine';
import { decide } from './policy';
import { buildPlan, isDue, type QueueOptions } from './planner';
import type { Difficulty, ReviewPlan, MemoryState, SchedulingLog } from './types';
export class ScheduleService {
  constructor(
    readonly db: RecallDatabase = defaultDb,
    readonly clock = () => new Date(),
    readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) {}
  async start(projectId: string, options: QueueOptions = {}) {
    return this.db.transaction('rw', this.db.tables, async () => {
      const project = await this.db.projects.get(projectId);
      if (!project || project.archivedAt) throw new Error('学习项目不可用');
      const active = await this.db.sessions
        .where('[projectId+status]')
        .equals([projectId, 'active'])
        .filter((s) => !!s.reviewPlan)
        .first();
      if (active) return active.id;
      const now = this.clock();
      const plan = buildPlan(
        project,
        await this.db.practiceItems.toArray(),
        await this.db.memoryStates.toArray(),
        await this.db.reviewEvents.toArray(),
        now,
        this.timezone,
        options,
      );
      if (!plan.selected.length)
        throw new Error(
          plan.budgetExhausted
            ? '今天的预计学习预算已用完，可暂停或明确选择临时加练。'
            : '当前没有符合条件的题目。可检查到期时间、筛选或待完善内容。',
        );
      const entries: ReviewPlan['entries'] = {};
      for (const row of plan.selected) {
        let memory = await this.db.memoryStates.get(row.item.learningStateId);
        if (!memory) {
          memory = initialMemory(row.item, now);
          await this.db.memoryStates.add(memory);
        }
        entries[row.item.id] = {
          stateVersion: memory.version,
          reason: row.reason,
          canSchedule: row.canSchedule,
        };
      }
      const session: StudySession = {
        id: crypto.randomUUID(),
        projectId,
        queue: plan.selected.map((r) => snapshotOf(r.item)),
        index: 0,
        status: 'active',
        createdAt: now.toISOString(),
        completedAt: null,
        draft: freshDraft(now.toISOString()),
        generation: crypto.randomUUID(),
        planVersion: 0,
        draftVersion: 0,
        reviewPlan: {
          mode: options.mode ?? 'daily',
          practiceOnly: options.mode === 'custom' || !!options.extraPractice,
          timezone: this.timezone,
          createdAt: now.toISOString(),
          budgetMinutes: project.dailyTimeBudget,
          entries,
        },
      };
      await this.db.sessions.add(session);
      return session.id;
    });
  }
  async focus(projectId: string, itemId: string, focus: boolean) {
    await this.db.transaction('rw', this.db.practiceItems, async () => {
      const item = await this.db.practiceItems.get(itemId);
      if (!item || item.projectId !== projectId || item.archivedAt) throw new Error('题目不可用');
      await this.db.practiceItems.update(itemId, { focus });
    });
  }
}
export const scheduleService = new ScheduleService();
export async function refreshReviewPlan(db: RecallDatabase, session: StudySession, now: Date) {
  if (!session.reviewPlan) return;
  const plan = session.reviewPlan;
  for (const snapshot of session.queue.slice(session.index)) {
    const item = await db.practiceItems.get(snapshot.id);
    if (!item || promptProblem(item)) continue;
    let memory = await db.memoryStates.get(item.learningStateId);
    if (!memory) {
      memory = initialMemory(item, now);
      await db.memoryStates.add(memory);
    }
    const retry = !!memory.retestDue && Date.parse(memory.retestDue) <= now.getTime();
    const fresh = memory.card.reps === 0 && !memory.retestDue;
    const due = isDue(memory, now, plan.timezone);
    plan.entries[item.id] = {
      stateVersion: memory.version,
      reason: due ? 'due' : retry ? 'retest' : fresh ? 'new' : 'practice',
      canSchedule: !plan.practiceOnly && plan.mode !== 'custom' && (due || retry || fresh),
    };
  }
}
export async function applyScheduling(
  db: RecallDatabase,
  session: StudySession,
  event: ReviewEvent,
  difficulty: Difficulty,
  now: Date,
): Promise<ReviewEvent> {
  const entry = session.reviewPlan?.entries[event.practiceItemId];
  const current = await db.practiceItems.get(event.practiceItemId);
  if (
    !entry ||
    !current ||
    promptProblem(current) ||
    current.learningStateId !== event.snapshot.learningStateId
  )
    throw new ConflictError('题目或复习计划已变化，请保留输入并更新本轮题目。');
  const memory = await db.memoryStates.get(current.learningStateId);
  if (!memory || memory.version !== entry.stateVersion)
    throw new ConflictError('此题的复习状态已在另一页面更新，请更新本轮计划后继续。');
  const decision = decide(event, entry.canSchedule, difficulty);
  let updated: MemoryState = memory;
  const log: SchedulingLog = {
    id: event.id,
    eventId: event.id,
    projectId: event.projectId,
    practiceItemId: event.practiceItemId,
    learningStateId: memory.id,
    revisionId: current.currentRevisionId,
    timestamp: event.timestamp,
    decision,
    versionBefore: memory.version,
    versionAfter: memory.version,
  };
  if (decision.grade !== null) {
    const result = advance(memory.card, now, decision.grade);
    decision.nextDue = result.card.due;
    updated = {
      ...memory,
      card: result.card,
      due: result.card.due,
      retestDue: undefined,
      revisionId: current.currentRevisionId,
      version: memory.version + 1,
      updatedAt: now.toISOString(),
    };
    log.before = memory.card;
    log.after = result.card;
    log.fsrsLog = result.log;
  } else if (['hinted', 'no_attempt', 'ungraded'].includes(decision.reason)) {
    decision.retestDue = new Date(now.getTime() + 10 * 60_000).toISOString();
    updated = {
      ...memory,
      retestDue: decision.retestDue,
      version: memory.version + 1,
      updatedAt: now.toISOString(),
    };
  }
  if (updated !== memory) await db.memoryStates.put(updated);
  log.versionAfter = updated.version;
  await db.schedulingLogs.add(log);
  return { ...event, schemaVersion: 3, scheduling: decision };
}
