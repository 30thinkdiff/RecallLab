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
const source = z.object({
  label: z.string(),
  documentId: z.string().optional(),
  page: z.number().int().positive().optional(),
  endPage: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  sectionId: z.string().optional(),
  recordIndex: z.number().int().positive().optional(),
});
const snapshot = z.object({
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
  id,
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
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
  assessmentSource: z.enum(['self_report', 'user_checked', 'none']),
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
export const sourceDocumentSchema = z.object({
  id,
  projectId: id,
  filename: z.string().min(1).max(500),
  title: z.string().max(200).optional(),
  fileType: z.enum(['json', 'csv', 'tsv', 'txt', 'markdown', 'pdf']),
  importedAt: date,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().nonnegative(),
  extractedContent: z.string(),
  pages: z.array(
    z.object({
      number: z.number().int().positive(),
      text: z.string(),
      startOffset: z.number().int().nonnegative(),
      status: z.enum(['ready', 'empty', 'failed', 'suspect']),
      method: z.enum(['text', 'ocr']).optional(),
      textLayer: z.string().optional(),
      confidence: z.number().min(0).max(100).optional(),
      kind: z.enum(['text', 'image', 'mixed', 'blank', 'failed']).optional(),
      warnings: z.array(z.string()),
    }),
  ),
  sections: z.array(
    z.object({
      id,
      title: z.string(),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
      page: z.number().int().positive().optional(),
    }),
  ),
  extractionStatus: z.enum(['ready', 'needs_review', 'partial']),
  warnings: z.array(z.string()),
  parserVersion: z.string(),
  importDigest: z.string().regex(/^[a-f0-9]{64}$/),
  initialItemIds: z.array(id),
});
export const backupSchema = z.object({
  format: z.literal('RecallLabBackup'),
  formatVersion: z.literal(1),
  databaseVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  createdAt: date,
  data: z.object({
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
  }
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
        log.fsrsLog.review !== log.timestamp)
    )
      throw new Error('FSRS 日志缺少真实更新证据');
    if (log.decision.grade === null && (log.before || log.after || log.fsrsLog))
      throw new Error('无评分事件不能伪造 FSRS 日志');
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
  ] as const;
  const sameContent = (a: z.infer<typeof snapshot>, b: z.infer<typeof snapshot>) =>
    fields.every((field) => JSON.stringify(a[field]) === JSON.stringify(b[field]));
  for (const unit of data.knowledgeUnits) {
    requireRef('projects', unit.projectId, '知识单元');
    validateSources(unit.sourceReferences, unit.projectId);
  }
  for (const item of data.practiceItems) {
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
  const activeProjects = new Set<string>();
  for (const session of data.sessions) {
    requireRef('projects', session.projectId, '轮次');
    if (
      session.index > session.queue.length ||
      (session.status === 'completed' && session.index !== session.queue.length)
    )
      throw new Error('学习进度超出队列');
    if (session.status === 'active') {
      if (activeProjects.has(session.projectId) || session.index === session.queue.length)
        throw new Error('活动轮次无效或重复');
      activeProjects.add(session.projectId);
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
