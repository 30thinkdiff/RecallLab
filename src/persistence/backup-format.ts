import {
  automaticGoalSchema,
  timingSchema,
  feedbackSchema,
  assertLearningEvidence,
} from '../learning/evidence';
import { aiDraftSchema, assertDraftRecord, MAX_DRAFT_TOTAL_BYTES } from '../ai/drafts-format';
import { source, sourceDocumentSchema } from './source-schema';
export { sourceDocumentSchema } from './source-schema';
import { aiProvenanceSchema, assertAiAnchors } from '../ai/provenance';
import { objectiveSchema } from '../ai/protocol';
import {
  assessmentSchema,
  assessmentResult,
  assertCriterionEvidence,
  markSchema,
} from '../domain/assessment';
import { decide } from '../scheduling/policy';
import { z } from 'zod';
import {
  memorySchema,
  schedulingLogSchema,
  decisionSchema,
  planSchema,
} from '../scheduling/schema';
import { assertSourceReference } from '../domain/sources';

const id = z.string().min(1).max(300);
const date = z.iso.datetime();
const snapshot = z.object({
  learningObjective: objectiveSchema.optional(),
  aiProvenance: aiProvenanceSchema.optional(),
  id,
  knowledgeUnitId: id,
  question: z.string(),
  standardAnswer: z.string(),
  answerCriteria: z.array(z.string()),
  hints: z.array(z.string()),
  mnemonics: z.string(),
  confusionWarnings: z.string(),
  sourceReferences: z.array(source),
  revision: z.number().int().positive(),
  revisionId: id.optional(),
  learningStateId: id.optional(),
});
const draft = z.object({
  timing: timingSchema.optional(),
  assessment: assessmentSchema.optional(),
  responseMode: z.enum(['quick', 'typed']),
  userResponse: z.string().max(20000),
  hintLevelUsed: z.number().int().nonnegative(),
  wasAnswerRevealed: z.boolean(),
  attemptedBeforeReveal: z.boolean(),
  confidenceBeforeReveal: z.number().int().min(0).max(4).nullable(),
  startedAt: date,
  revealedAt: date.nullable(),
});
const project = z.object({
  automaticGoal: automaticGoalSchema.optional(),
  id,
  name: z.string(),
  description: z.string(),
  learningGoal: z.string(),
  targetDate: z.string(),
  dailyTimeBudget: z.number().int().min(1).max(1440),
  priority: z.number().int().min(1).max(3).optional(),
  newCardLimit: z.number().int().min(0).max(1000).optional(),
  createdAt: date,
  updatedAt: date,
  archivedAt: date.optional(),
});
const knowledge = z.object({
  learningObjective: objectiveSchema.optional(),
  aiProvenance: aiProvenanceSchema.optional(),
  id,
  projectId: id,
  title: z.string(),
  knowledgeType: z.enum([
    'fact',
    'definition',
    'list',
    'concept',
    'formula',
    'procedure',
    'application',
  ]),
  canonicalContent: z.string(),
  sourceReferences: z.array(source),
  importance: z.number(),
  difficulty: z.number().nullable(),
  tags: z.array(z.string()),
  verificationStatus: z.enum(['user_authored', 'unverified', 'verified']),
  createdAt: date,
  updatedAt: date,
});
const item = snapshot.omit({ revisionId: true }).extend({
  learningIssue: z.object({ reason: z.string().max(1000), at: date }).optional(),
  qualityReviewedRevisionId: id.optional(),
  projectId: id,
  practiceType: z.literal('free_recall'),
  focus: z.boolean().optional(),
  verificationStatus: z.literal('user_authored'),
  currentRevisionId: id.optional(),
  createdAt: date,
  updatedAt: date,
  archivedAt: date.optional(),
});
const event = z.object({
  timing: timingSchema.optional(),
  quickFeedback: feedbackSchema.optional(),
  assessmentMode: z.enum(['simple', 'detailed']).optional(),
  criterionChecks: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        criterion: z.string(),
        result: markSchema,
        source: z.literal('user_checked'),
      }),
    )
    .optional(),
  reviewedAt: date.optional(),
  attemptedBeforeReveal: z.boolean().optional(),
  id,
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  scheduling: decisionSchema.optional(),
  projectId: id,
  practiceItemId: id,
  knowledgeUnitId: id,
  sessionId: id,
  queueIndex: z.number().int().nonnegative(),
  timestamp: date,
  responseMode: z.enum(['quick', 'typed']),
  userResponse: z.string(),
  assessmentResult: z.enum(['correct', 'partially_correct', 'incorrect', 'ungraded', 'skipped']),
  subjectiveMastery: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .nullable(),
  confidenceBeforeReveal: z.number().int().min(0).max(4).nullable(),
  hintLevelUsed: z.number().int().nonnegative(),
  wasAnswerRevealed: z.boolean(),
  wasIndependentRecall: z.boolean(),
  responseDuration: z.number().nonnegative(),
  errorTypes: z.array(z.string()),
  interventionType: z.literal('hint').nullable(),
  assessmentSource: z.enum(['self_report', 'user_checked', 'deterministic', 'none']),
  snapshot,
});
const session = z.object({
  reviewPlan: planSchema.optional(),
  id,
  projectId: id,
  queue: z.array(snapshot),
  index: z.number().int().nonnegative(),
  status: z.enum(['active', 'completed', 'ended']),
  createdAt: date,
  completedAt: date.nullable(),
  draft,
  generation: id.optional(),
  planVersion: z.number().int().nonnegative().optional(),
  draftVersion: z.number().int().nonnegative().optional(),
  lastWriterId: z.string().optional(),
});
const revision = z.object({
  id,
  practiceItemId: id,
  revisionNumber: z.number().int().positive(),
  previousRevisionId: id.nullable(),
  changeType: z.enum([
    'initial',
    'legacy',
    'cosmetic',
    'clarification',
    'substantive',
    'replacement',
  ]),
  changeSummary: z.string(),
  impactOnLearningState: z.enum(['preserve', 'reset']),
  learningStateId: id,
  createdAt: date,
  snapshot,
});
const recovery = z.object({
  id,
  sessionId: id,
  practiceItemId: id,
  revision: z.number().int().positive(),
  createdAt: date,
  reason: z.string(),
  draft,
});
export const backupSchema = z.object({
  format: z.literal('RecallLabBackup'),
  formatVersion: z.literal(1),
  databaseVersion: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
  ]),
  createdAt: date,
  data: z.object({
    aiDrafts: z.array(aiDraftSchema).max(20).default([]),
    projects: z.array(project),
    knowledgeUnits: z.array(knowledge),
    practiceItems: z.array(item),
    reviewEvents: z.array(event),
    sessions: z.array(session),
    revisions: z.array(revision).default([]),
    draftRecoveries: z.array(recovery).default([]),
    sourceDocuments: z.array(sourceDocumentSchema).default([]),
    memoryStates: z.array(memorySchema).default([]),
    schedulingLogs: z.array(schedulingLogSchema).default([]),
  }),
});
export type Backup = z.infer<typeof backupSchema>;

export function validateBackup(raw: unknown): Backup {
  const backup = backupSchema.parse(raw);
  const data = backup.data;
  if (backup.databaseVersion < 4 && (data.memoryStates.length || data.schedulingLogs.length))
    throw new Error('旧版本备份不能包含调度数据');
  const maps = Object.fromEntries(
    Object.entries(data).map(([name, rows]) => {
      const map = new Map(rows.map((row) => [row.id, row]));
      if (map.size !== rows.length) throw new Error(`${name} 存在重复 ID`);
      return [name, map];
    }),
  );
  function requireRef(table: keyof typeof data, value: string, context: string) {
    if (!maps[table]?.has(value)) throw new Error(`${context} 引用不存在：${table}`);
  }
  for (const draft of data.aiDrafts) {
    requireRef('projects', draft.projectId, '候选草稿');
    assertDraftRecord(draft);
  }
  if (data.aiDrafts.reduce((n, d) => n + d.bytesStored, 0) > MAX_DRAFT_TOTAL_BYTES)
    throw new Error('草稿总容量超过 12 MB');
  if (backup.databaseVersion < 6 && data.aiDrafts.length)
    throw new Error('旧版备份不能含有持久候选草稿');
  const items = new Map(data.practiceItems.map((item) => [item.id, item]));
  const revisions = new Map(data.revisions.map((revision) => [revision.id, revision]));
  const documents = new Map(data.sourceDocuments.map((document) => [document.id, document]));
  function validateSources(refs: z.infer<typeof source>[], projectId: string) {
    for (const ref of refs) {
      if (!ref.documentId) continue;
      const doc = documents.get(ref.documentId);
      if (!doc || doc.projectId !== projectId) throw new Error('来源资料不存在或跨项目引用');
      assertSourceReference(ref, doc, projectId);
    }
  }
  for (const doc of data.sourceDocuments) {
    requireRef('projects', doc.projectId, '资料');
    const pageNumbers = new Set<number>();
    let pageIndex = 0;
    let previousEnd = 0;
    for (const page of doc.pages) {
      if (
        page.number !== ++pageIndex ||
        page.startOffset < previousEnd ||
        (pageIndex === 1 && page.startOffset !== 0)
      )
        throw new Error('资料页码或原文顺序不一致');
      previousEnd = page.startOffset + page.text.length;
      if (
        pageNumbers.has(page.number) ||
        doc.extractedContent.slice(page.startOffset, page.startOffset + page.text.length) !==
          page.text
      )
        throw new Error('资料页面与提取原文不一致');
      pageNumbers.add(page.number);
    }
    const sections = new Set<string>();
    for (const section of doc.sections) {
      if (
        sections.has(section.id) ||
        section.startOffset > section.endOffset ||
        section.endOffset > doc.extractedContent.length ||
        (section.page && !pageNumbers.has(section.page))
      )
        throw new Error('资料章节位置无效');
      sections.add(section.id);
    }
    for (const itemId of doc.initialItemIds)
      if (items.get(itemId)?.projectId !== doc.projectId) throw new Error('资料导入题目引用无效');
  }
  const stateOwners = new Map<string, string>();
  for (const revision of data.revisions) {
    const owner = stateOwners.get(revision.learningStateId);
    if (owner && owner !== revision.practiceItemId) throw new Error('学习状态不能跨题目共享');
    stateOwners.set(revision.learningStateId, revision.practiceItemId);
  }
  const memories = new Map(data.memoryStates.map((m) => [m.id, m]));
  const eventsById = new Map(data.reviewEvents.map((e) => [e.id, e]));
  for (const memory of data.memoryStates) {
    const item = items.get(memory.practiceItemId);
    const rev = revisions.get(memory.revisionId);
    if (
      !item ||
      item.projectId !== memory.projectId ||
      memory.id !== memory.learningStateId ||
      !rev ||
      rev.practiceItemId !== item.id ||
      rev.learningStateId !== memory.learningStateId ||
      rev.snapshot.knowledgeUnitId !== memory.knowledgeUnitId ||
      memory.due !== memory.card.due
    )
      throw new Error('记忆调度状态与内容版本不一致');
    if (item && item.learningStateId === memory.learningStateId && memory.card.reps > 0) {
      const comparable = (text: string) => text.replace(/\s+/g, '').replace(/。$/u, '');
      if (
        item.learningObjective !== rev!.snapshot.learningObjective ||
        comparable(item.question) !== comparable(rev!.snapshot.question) ||
        comparable(item.standardAnswer) !== comparable(rev!.snapshot.standardAnswer) ||
        item.answerCriteria.length !== rev!.snapshot.answerCriteria.length ||
        item.answerCriteria.some(
          (c, i) => comparable(c) !== comparable(rev!.snapshot.answerCriteria[i] ?? ''),
        )
      )
        throw new Error('有效记忆状态不能继承不同知识内容的成绩');
    }
  }
  if (
    backup.databaseVersion < 8 &&
    (data.projects.some((p) => p.automaticGoal) ||
      data.practiceItems.some((p) => p.learningIssue) ||
      data.sessions.some(
        (s) =>
          s.reviewPlan?.adaptive ||
          s.reviewPlan?.compact ||
          s.reviewPlan?.goalUpdatedAt ||
          s.reviewPlan?.remainingBudgetSeconds !== undefined ||
          s.draft.timing,
      ) ||
      data.reviewEvents.some((e) => e.timing || e.quickFeedback || e.schemaVersion === 5))
  )
    throw new Error('目标/行为证据需要v8或更新的数据格式');
  for (const log of data.schedulingLogs) {
    const event = eventsById.get(log.eventId),
      memory = memories.get(log.learningStateId);
    if (
      !event ||
      !memory ||
      log.id !== log.eventId ||
      event.practiceItemId !== log.practiceItemId ||
      event.projectId !== log.projectId ||
      event.snapshot.learningStateId !== log.learningStateId ||
      event.snapshot.revisionId !== log.revisionId ||
      JSON.stringify(event.scheduling) !== JSON.stringify(log.decision) ||
      log.timestamp !== event.timestamp ||
      log.versionAfter < log.versionBefore ||
      log.versionAfter > memory.version
    )
      throw new Error('调度日志与原始学习事件不一致');
    if (
      log.decision.grade !== null &&
      (!log.before ||
        !log.after ||
        !log.fsrsLog ||
        log.fsrsLog.rating !== log.decision.grade ||
        log.after.due !== log.decision.nextDue ||
        log.fsrsLog.review !== (event.reviewedAt ?? log.timestamp))
    )
      throw new Error('FSRS 日志缺少真实更新证据');
    if (log.decision.grade === null && (log.before || log.after || log.fsrsLog))
      throw new Error('无评分事件不能伪造 FSRS 日志');
  }
  for (const log of data.schedulingLogs) {
    const event = eventsById.get(log.eventId)!;
    const expected = decide(
      event,
      log.decision.reason !== 'practice',
      log.decision.difficulty ?? 'good',
    );
    for (const field of ['grade', 'reason', 'source', 'criteriaMet', 'difficulty'] as const)
      if (expected[field] !== log.decision[field]) throw new Error('调度评分与实际回忆证据矛盾');
  }
  for (const memory of data.memoryStates) {
    const logs = data.schedulingLogs.filter((l) => l.learningStateId === memory.id);
    const graded = logs
      .filter((l) => l.decision.grade !== null)
      .sort((a, b) => a.versionAfter - b.versionAfter);
    if (
      memory.card.reps !== graded.length ||
      memory.version !== Math.max(0, ...logs.map((l) => l.versionAfter))
    )
      throw new Error('记忆状态缺少对应的真实调度日志');
    if (
      graded.length &&
      JSON.stringify(graded[graded.length - 1]!.after) !== JSON.stringify(memory.card)
    )
      throw new Error('记忆状态与最近一次调度结果不一致');
    const changed = logs
      .filter((l) => l.versionAfter > l.versionBefore)
      .sort((a, b) => a.versionAfter - b.versionAfter)
      .slice(-1)[0];
    if (memory.retestDue !== changed?.decision.retestDue)
      throw new Error('复测时间缺少原始教学事件依据');
    if (
      !graded.length &&
      (memory.card.state !== 0 ||
        memory.card.last_review ||
        memory.card.stability !== 0 ||
        memory.card.difficulty !== 0)
    )
      throw new Error('未复习的新状态不能伪造掌握记录');
  }
  for (const e of data.reviewEvents) {
    assertCriterionEvidence(e);
    assertLearningEvidence(e);
    if (e.schemaVersion === 4 && !e.assessmentMode) throw new Error('新版事件缺少核对方式');
  }
  for (const s of data.sessions)
    if (s.draft.assessment) {
      const snap = s.queue[s.index];
      if (!snap || !s.draft.wasAnswerRevealed) throw new Error('核对草稿缺少对应的揭晓题目');
      assessmentResult(s.draft.assessment, snap);
    }
  for (const event of data.reviewEvents)
    if (event.schemaVersion >= 3) {
      if (
        event.reviewedAt &&
        (event.scheduling?.reviewedAt !== event.reviewedAt ||
          Date.parse(event.reviewedAt) > Date.parse(event.timestamp))
      )
        throw new Error('回忆发生时间与保存记录不一致');
      if (
        (event.responseMode === 'typed' &&
          event.wasIndependentRecall &&
          !event.userResponse.trim()) ||
        (event.attemptedBeforeReveal === false && event.wasIndependentRecall)
      )
        throw new Error('正式复习缺少揭晓前的回忆证据');
      const source =
        event.assessmentResult === 'skipped' || event.assessmentResult === 'ungraded'
          ? 'none'
          : event.responseMode === 'typed'
            ? event.quickFeedback?.checker === 'exact-short-v1'
              ? 'deterministic'
              : 'user_checked'
            : 'self_report';
      if (event.assessmentSource !== source) throw new Error('正式复习评价来源不一致');
    }
  for (const event of data.reviewEvents)
    if (event.scheduling && !data.schedulingLogs.some((l) => l.eventId === event.id))
      throw new Error('正式复习事件缺少调度决策日志');
  const fields = [
    'id',
    'knowledgeUnitId',
    'question',
    'standardAnswer',
    'answerCriteria',
    'hints',
    'mnemonics',
    'confusionWarnings',
    'sourceReferences',
    'revision',
    'learningObjective',
    'aiProvenance',
  ] as const;
  const sameContent = (a: z.infer<typeof snapshot>, b: z.infer<typeof snapshot>) =>
    fields.every((field) => JSON.stringify(a[field]) === JSON.stringify(b[field]));
  for (const unit of data.knowledgeUnits) {
    requireRef('projects', unit.projectId, '知识单元');
    validateSources(unit.sourceReferences, unit.projectId);
    if (unit.aiProvenance) {
      assertAiAnchors(unit.aiProvenance);
      if (
        !data.revisions.some(
          (r) =>
            r.snapshot.knowledgeUnitId === unit.id &&
            r.snapshot.standardAnswer === unit.canonicalContent &&
            r.snapshot.question === unit.title &&
            JSON.stringify(r.snapshot.aiProvenance) === JSON.stringify(unit.aiProvenance),
        )
      )
        throw new Error('知识单元的 AI 来源记录与修订不一致');
    }
  }
  for (const item of data.practiceItems) {
    if (
      item.qualityReviewedRevisionId &&
      revisions.get(item.qualityReviewedRevisionId)?.practiceItemId !== item.id
    )
      throw new Error('人工质量确认引用了其他题目版本');
    requireRef('projects', item.projectId, '题目');
    requireRef('knowledgeUnits', item.knowledgeUnitId, '题目');
    if (
      data.knowledgeUnits.find((unit) => unit.id === item.knowledgeUnitId)?.projectId !==
      item.projectId
    )
      throw new Error('知识单元跨项目引用');
    validateSources(item.sourceReferences, item.projectId);
    if (backup.databaseVersion >= 2) {
      const revision = revisions.get(item.currentRevisionId ?? '');
      if (
        !revision ||
        revision.practiceItemId !== item.id ||
        revision.revisionNumber !== item.revision ||
        revision.learningStateId !== item.learningStateId
      )
        throw new Error('当前修订引用不一致');
      if (!sameContent(revision.snapshot, item)) throw new Error('当前题目与修订快照不一致');
    }
  }
  for (const revision of data.revisions) {
    requireRef('practiceItems', revision.practiceItemId, '修订');
    requireRef('knowledgeUnits', revision.snapshot.knowledgeUnitId, '修订');
    validateSources(
      revision.snapshot.sourceReferences,
      items.get(revision.practiceItemId)!.projectId,
    );
    if (
      revision.snapshot.id !== revision.practiceItemId ||
      revision.snapshot.revision !== revision.revisionNumber
    )
      throw new Error('修订快照身份不一致');
    if (
      revision.id !== `${revision.practiceItemId}:r${revision.revisionNumber}` ||
      (revision.snapshot.revisionId && revision.snapshot.revisionId !== revision.id) ||
      (revision.snapshot.learningStateId &&
        revision.snapshot.learningStateId !== revision.learningStateId)
    )
      throw new Error('修订标识不一致');
    if (
      ['substantive', 'replacement'].includes(revision.changeType) &&
      revision.impactOnLearningState !== 'reset'
    )
      throw new Error('实质性更正不能继承旧学习状态');
    if (
      revision.impactOnLearningState === 'reset' &&
      data.revisions.some(
        (previous) =>
          previous.practiceItemId === revision.practiceItemId &&
          previous.revisionNumber < revision.revisionNumber &&
          previous.learningStateId === revision.learningStateId,
      )
    )
      throw new Error('重新学习状态不能复用旧标识');
    if (revision.previousRevisionId) {
      const previous = revisions.get(revision.previousRevisionId);
      if (
        !previous ||
        previous.practiceItemId !== revision.practiceItemId ||
        previous.revisionNumber >= revision.revisionNumber
      )
        throw new Error('修订链无效');
      if (
        revision.impactOnLearningState === 'preserve' &&
        previous.learningStateId !== revision.learningStateId
      )
        throw new Error('学习状态继承不一致');
      if (
        revision.impactOnLearningState === 'reset' &&
        previous.learningStateId === revision.learningStateId
      )
        throw new Error('实质性修订未隔离学习证据');
    }
  }
  for (const revision of data.revisions) {
    const trace = revision.snapshot.aiProvenance;
    if (!trace) continue;
    assertAiAnchors(trace);
    const confirmed = revisions.get(trace.confirmedRevisionId);
    if (!confirmed || confirmed.practiceItemId !== revision.practiceItemId)
      throw new Error('AI 确认版本不存在或跨题引用');
    if (
      !trace.modifiedAfterConfirmation &&
      (trace.confirmedRevisionId !== revision.id ||
        trace.objective !== revision.snapshot.learningObjective ||
        trace.confirmation.question !== revision.snapshot.question ||
        trace.confirmation.answer !== revision.snapshot.standardAnswer ||
        JSON.stringify(trace.confirmation.criteria) !==
          JSON.stringify(revision.snapshot.answerCriteria))
    )
      throw new Error('AI 确认内容与当时版本不一致');
    if (trace.sourceKind === 'document') {
      const doc = documents.get(trace.inputId);
      if (
        !doc ||
        doc.projectId !== items.get(revision.practiceItemId)?.projectId ||
        doc.sourceHash !== trace.documentHash ||
        doc.extractedContent.slice(trace.inputStart, trace.inputStart + trace.inputText.length) !==
          trace.inputText
      )
        throw new Error('AI 原文引用已失效');
    } else {
      const input = revisions.get(trace.inputRevisionId ?? '');
      if (
        !input ||
        input.practiceItemId !== revision.practiceItemId ||
        input.snapshot.standardAnswer !== trace.inputText
      )
        throw new Error('AI 评分要点缺少原答案版本');
    }
  }
  const activeProjects = new Set<string>();
  for (const session of data.sessions) {
    requireRef('projects', session.projectId, '轮次');
    if (
      session.index > session.queue.length ||
      (session.status === 'completed' && session.index !== session.queue.length)
    )
      throw new Error('学习进度超出队列');
    if (session.status === 'active') {
      const activeKey = `${session.projectId}:${session.reviewPlan ? 'scheduled' : 'free'}`;
      if (activeProjects.has(activeKey) || session.index === session.queue.length)
        throw new Error('活动轮次无效或重复');
      activeProjects.add(activeKey);
    }
    if (
      backup.databaseVersion >= 2 &&
      (session.generation === undefined ||
        session.planVersion === undefined ||
        session.draftVersion === undefined)
    )
      throw new Error('缺少轮次并发版本');
    for (const snapshot of session.queue) {
      requireRef('practiceItems', snapshot.id, '轮次');
      requireRef('knowledgeUnits', snapshot.knowledgeUnitId, '轮次');
      if (items.get(snapshot.id)?.projectId !== session.projectId)
        throw new Error('轮次题目跨项目');
      if (
        backup.databaseVersion >= 2 &&
        (!snapshot.revisionId ||
          !revisions.has(snapshot.revisionId) ||
          revisions.get(snapshot.revisionId)?.learningStateId !== snapshot.learningStateId)
      )
        throw new Error('轮次修订引用无效');
      if (
        backup.databaseVersion >= 2 &&
        !sameContent(snapshot, revisions.get(snapshot.revisionId!)!.snapshot)
      )
        throw new Error('轮次与修订内容不一致');
    }
    const current = session.queue[session.index];
    if (current && session.draft.hintLevelUsed > current.hints.length)
      throw new Error('提示记录超出题目提示');
  }
  const positions = new Set<string>();
  for (const event of data.reviewEvents) {
    requireRef('projects', event.projectId, '事件');
    requireRef('practiceItems', event.practiceItemId, '事件');
    requireRef('sessions', event.sessionId, '事件');
    requireRef('knowledgeUnits', event.knowledgeUnitId, '事件');
    const session = data.sessions.find((s) => s.id === event.sessionId);
    if (
      session?.projectId !== event.projectId ||
      event.snapshot.id !== event.practiceItemId ||
      event.snapshot.knowledgeUnitId !== event.knowledgeUnitId ||
      items.get(event.practiceItemId)?.projectId !== event.projectId
    )
      throw new Error('事件身份或项目引用不一致');
    if (
      !session ||
      event.queueIndex >= session.index ||
      session.queue[event.queueIndex]?.id !== event.practiceItemId
    )
      throw new Error('事件与已完成进度不一致');
    const position = `${event.sessionId}:${event.queueIndex}`;
    if (positions.has(position)) throw new Error('复习事件位置重复');
    positions.add(position);
    if (
      backup.databaseVersion >= 2 &&
      !revisions.has(
        event.snapshot.revisionId ?? `${event.practiceItemId}:r${event.snapshot.revision}`,
      )
    )
      throw new Error('历史修订引用不存在');
    if (
      backup.databaseVersion >= 2 &&
      !sameContent(
        event.snapshot,
        revisions.get(
          event.snapshot.revisionId ?? `${event.practiceItemId}:r${event.snapshot.revision}`,
        )!.snapshot,
      )
    )
      throw new Error('历史事件与修订快照不一致');
    if (!sameContent(event.snapshot, session.queue[event.queueIndex]!))
      throw new Error('事件与已完成队列快照不一致');
    if (
      event.hintLevelUsed > event.snapshot.hints.length ||
      (event.wasIndependentRecall && event.hintLevelUsed > 0) ||
      (event.assessmentResult === 'skipped' && event.subjectiveMastery !== null)
    )
      throw new Error('复习证据条件不一致');
  }
  for (const session of data.sessions)
    for (let index = 0; index < session.index; index++)
      if (!positions.has(`${session.id}:${index}`)) throw new Error('已完成进度缺少学习事件');
  for (const recovery of data.draftRecoveries) {
    requireRef('sessions', recovery.sessionId, '暂存作答');
    requireRef('practiceItems', recovery.practiceItemId, '暂存作答');
    if (!revisions.has(`${recovery.practiceItemId}:r${recovery.revision}`))
      throw new Error('暂存作答引用的修订不存在');
    if (
      data.sessions.find((session) => session.id === recovery.sessionId)?.projectId !==
      items.get(recovery.practiceItemId)?.projectId
    )
      throw new Error('暂存作答跨项目引用');
  }
  return backup;
}
