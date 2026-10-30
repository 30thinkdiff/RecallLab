import { estimateSeconds } from '../learning/estimates';
import { buildAdaptivePlan } from '../learning/adaptive';
import { projectInputSchema } from '../domain/validation';
import { automaticGoalSchema } from '../learning/evidence';
import { db as defaultDb, type RecallDatabase } from '../persistence/database';
import type { ReviewEvent, StudySession } from '../domain/models';
import { promptProblem } from '../domain/readiness';
import { snapshotOf, ConflictError } from '../domain/revisions';
import { freshDraft } from '../domain/review';
import { initialMemory, advance } from './engine';
import { decide } from './policy';
import { buildPlan, isDue, type QueueOptions } from './planner';
import type { Difficulty, ReviewPlan, MemoryState, SchedulingLog } from './types';
export class NoReviewWorkError extends Error {
  override name = 'NoReviewWorkError';
}
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
      if (active) {
        const promoted =
          options.adaptive === true &&
          !!project.automaticGoal &&
          !active.reviewPlan?.adaptive &&
          !active.reviewPlan?.practiceOnly;
        if (promoted)
          active.reviewPlan = {
            ...active.reviewPlan!,
            adaptive: true,
            compact: true,
            mode: 'daily',
          };
        if (active.reviewPlan?.adaptive) {
          // Resume always uses current cards, flags, goals and time; preserve the current draft.
          await rebuildAdaptiveTail(this.db, active, this.clock(), true);
          active.planVersion++;
          active.draftVersion++;
          await this.db.sessions.put(active);
        }
        return active.id;
      }
      const now = this.clock();
      const adaptive = options.adaptive === true && !!project.automaticGoal;
      const plan = (adaptive ? buildAdaptivePlan : buildPlan)(
        project,
        await this.db.practiceItems.where('projectId').equals(project.id).toArray(),
        await this.db.memoryStates.where('projectId').equals(project.id).toArray(),
        await this.db.reviewEvents.where('projectId').equals(project.id).toArray(),
        now,
        this.timezone,
        options,
      );
      if (!plan.selected.length)
        throw new NoReviewWorkError(
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
        if (
          memory.practiceItemId !== row.item.id ||
          memory.projectId !== projectId ||
          memory.knowledgeUnitId !== row.item.knowledgeUnitId
        )
          throw new ConflictError('记忆状态不匹配当前题目，请保留数据并恢复可信备份。');
        entries[row.item.id] = {
          stateVersion: memory.version,
          reason: row.reason,
          canSchedule: row.canSchedule,
          ...('explanation' in row
            ? {
                explanation: row.explanation as string,
                estimatedSeconds: row.estimatedSeconds as number,
              }
            : {}),
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
        draft: freshDraft(now.toISOString(), adaptive ? 'typed' : 'quick'),
        generation: crypto.randomUUID(),
        planVersion: 0,
        draftVersion: 0,
        reviewPlan: {
          ...(adaptive
            ? {
                adaptive: true,
                compact: true,
                goalUpdatedAt: project.updatedAt,
                remainingBudgetSeconds: Math.max(
                  0,
                  project.dailyTimeBudget * 60 -
                    ('allocatedSeconds' in plan ? plan.allocatedSeconds : 0),
                ),
              }
            : {}),
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
  async configureGoal(projectId: string, raw: unknown, expectedUpdatedAt: string) {
    const input = projectInputSchema
      .pick({ targetDate: true, dailyTimeBudget: true })
      .extend({ automaticGoal: automaticGoalSchema })
      .parse(raw);
    return this.db.transaction('rw', this.db.projects, async () => {
      const project = await this.db.projects.get(projectId);
      if (!project || project.archivedAt || project.updatedAt !== expectedUpdatedAt)
        throw new ConflictError('目标已在另一页面更新，请先载入最新目标。');
      const updated = {
        ...project,
        ...input,
        updatedAt: new Date(Math.max(Date.now(), Date.parse(project.updatedAt) + 1)).toISOString(),
      };
      await this.db.projects.put(updated);
      return updated;
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
  if (session.reviewPlan.adaptive) {
    await rebuildAdaptiveTail(db, session, now, true);
    return;
  }
  const plan = session.reviewPlan;
  for (const snapshot of session.queue.slice(session.index)) {
    const item = await db.practiceItems.get(snapshot.id);
    if (!item || promptProblem(item)) continue;
    let memory = await db.memoryStates.get(item.learningStateId);
    if (!memory) {
      memory = initialMemory(item, now);
      await db.memoryStates.add(memory);
    }
    if (
      memory.practiceItemId !== item.id ||
      memory.projectId !== item.projectId ||
      memory.knowledgeUnitId !== item.knowledgeUnitId
    )
      throw new ConflictError('记忆状态与当前题目不一致');
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
    (promptProblem(current) && event.assessmentResult !== 'skipped') ||
    current.learningStateId !== event.snapshot.learningStateId
  )
    throw new ConflictError('题目或复习计划已变化，请保留输入并更新本轮题目。');
  const memory = await db.memoryStates.get(current.learningStateId);
  if (
    !memory ||
    memory.practiceItemId !== current.id ||
    memory.projectId !== current.projectId ||
    memory.knowledgeUnitId !== current.knowledgeUnitId ||
    memory.version !== entry.stateVersion
  )
    throw new ConflictError('此题的复习状态已在另一页面更新，请更新本轮计划后继续。');
  const reviewedAt = new Date(session.draft.revealedAt ?? event.timestamp);
  if (reviewedAt.getTime() > now.getTime())
    throw new Error('本机时间早于作答时间，请校准时间后保存；草稿仍保留。');
  const decision = decide(event, entry.canSchedule, difficulty);
  decision.reviewedAt = reviewedAt.toISOString();
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
    const result = advance(memory.card, reviewedAt, decision.grade);
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
    decision.retestDue = new Date(reviewedAt.getTime() + 10 * 60_000).toISOString();
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
  return {
    ...event,
    schemaVersion: event.schemaVersion >= 4 ? event.schemaVersion : 3,
    reviewedAt: reviewedAt.toISOString(),
    attemptedBeforeReveal:
      session.draft.responseMode === 'typed'
        ? !!session.draft.userResponse.trim()
        : session.draft.attemptedBeforeReveal,
    scheduling: decision,
  };
}

export async function rebuildAdaptiveTail(
  db: RecallDatabase,
  session: StudySession,
  now: Date,
  keepCurrent = false,
) {
  if (!session.reviewPlan?.adaptive) return;
  const project = await db.projects.get(session.projectId);
  if (!project) return;
  const cards = await db.practiceItems.where('projectId').equals(project.id).toArray();
  const events = await db.reviewEvents.where('projectId').equals(project.id).toArray();
  const memories = await db.memoryStates.where('projectId').equals(project.id).toArray();
  const day = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: session.reviewPlan!.timezone }).format(date);
  const excluded = events
    .filter(
      (e) => e.sessionId === session.id && day(new Date(e.reviewedAt ?? e.timestamp)) === day(now),
    )
    .flatMap((e) => (e.snapshot.learningStateId ? [e.snapshot.learningStateId] : []));
  const prefix = session.queue.slice(0, session.index);
  const current = keepCurrent ? session.queue[session.index] : undefined;
  if (current?.learningStateId) excluded.push(current.learningStateId);
  const currentItem = current ? cards.find((c) => c.id === current.id) : undefined;
  const reserved = currentItem
    ? estimateSeconds(
        currentItem,
        events,
        !memories.find((m) => m.id === currentItem.learningStateId)?.card.reps,
      ).seconds
    : 0;
  const plan = buildAdaptivePlan(
    project,
    cards,
    memories,
    events,
    now,
    session.reviewPlan.timezone,
    { excludeStates: excluded, reservedSeconds: reserved },
  );
  const remaining = [
    ...(current ? [current] : []),
    ...plan.selected.map((r) => snapshotOf(r.item)),
  ];
  const entries: ReviewPlan['entries'] = {};
  for (const snapshot of remaining) {
    const item = cards.find((c) => c.id === snapshot.id);
    if (!item) continue;
    let memory = memories.find((m) => m.id === item.learningStateId);
    if (!memory) {
      memory = initialMemory(item, now);
      await db.memoryStates.add(memory);
    }
    const row = plan.selected.find((r) => r.item.id === item.id);
    const retry = !!memory.retestDue && Date.parse(memory.retestDue) <= now.getTime();
    const fresh = memory.card.reps === 0 && !memory.retestDue;
    entries[item.id] = {
      stateVersion: memory.version,
      reason:
        row?.reason ??
        (isDue(memory, now, session.reviewPlan.timezone)
          ? 'due'
          : retry
            ? 'retest'
            : fresh
              ? 'new'
              : 'practice'),
      canSchedule:
        row?.canSchedule ?? (isDue(memory, now, session.reviewPlan.timezone) || retry || fresh),
      ...(row ? { estimatedSeconds: row.estimatedSeconds, explanation: row.explanation } : {}),
    };
  }
  session.queue = [...prefix, ...remaining];
  session.status = remaining.length ? 'active' : 'completed';
  session.completedAt = remaining.length ? null : now.toISOString();
  session.reviewPlan = {
    ...session.reviewPlan,
    entries,
    remainingBudgetSeconds: Math.max(0, project.dailyTimeBudget * 60 - plan.allocatedSeconds),
    goalUpdatedAt: project.updatedAt,
    createdAt: now.toISOString(),
    budgetMinutes: project.dailyTimeBudget,
  };
}
