import { exactShort, timingSchema, assertLearningEvidence } from '../learning/evidence';
import { assertAiAnchors, type AiConfirmation, type AiProvenance } from '../ai/provenance';
import {
  assessmentSchema,
  assessmentResult,
  freshAssessment,
  type AssessmentDraft,
} from '../domain/assessment';
import { db as defaultDb, type RecallDatabase } from './database';
import {
  cardInputSchema,
  lines,
  projectInputSchema,
  type CardInput,
  type ProjectInput,
} from '../domain/validation';
import { snapshotOf, revisionId, legacyStateId, tokenOf, ConflictError } from '../domain/revisions';
import { buildReviewEvent, freshDraft } from '../domain/review';
import type {
  ChangeType,
  Performance,
  PracticeItem,
  PracticeSnapshot,
  SessionToken,
  StudyDraft,
  StudySession,
  SubjectiveMastery,
  SourceReference,
} from '../domain/models';
import type { Difficulty } from '../scheduling/types';
import { promptProblem } from '../domain/readiness';
import { assertSourceReference } from '../domain/sources';

export interface RevisionInput {
  expectedRevisionId: string;
  changeType: Exclude<ChangeType, 'initial' | 'legacy'>;
  changeSummary: string;
  impactOnLearningState: 'preserve' | 'reset';
}
export type DraftPatch = Partial<
  Pick<
    StudyDraft,
    'userResponse' | 'responseMode' | 'confidenceBeforeReveal' | 'attemptedBeforeReveal' | 'timing'
  >
>;

export class Repository {
  constructor(readonly db: RecallDatabase = defaultDb) {}
  private async schedulingHooks(id: string) {
    const session = await this.db.sessions.get(id);
    return session?.reviewPlan ? import('../scheduling/service') : null;
  }
  // All business transitions use the same local transaction boundary. No network awaits here.
  private write<T>(task: () => Promise<T>) {
    return this.db.transaction('rw', this.db.tables, task);
  }
  private async requireProject(id: string) {
    const project = await this.db.projects.get(id);
    if (!project || project.archivedAt) throw new Error('学习项目不存在或已归档');
    return project;
  }
  private checkToken(session: StudySession, expected: SessionToken) {
    const current = tokenOf(session);
    if (
      current.generation !== expected.generation ||
      current.planVersion !== expected.planVersion ||
      current.draftVersion !== expected.draftVersion ||
      current.revisionId !== expected.revisionId
    )
      throw new ConflictError();
  }
  private async requireSession(
    id: string,
    index: number,
    token: SessionToken,
    validateContent = true,
  ) {
    const session = await this.db.sessions.get(id);
    if (!session || session.status !== 'active' || session.index !== index)
      throw new ConflictError('学习进度已变化，请载入最新状态。');
    await this.requireProject(session.projectId);
    this.checkToken(session, token);
    if (validateContent) {
      const snapshot = session.queue[index];
      const current = snapshot && (await this.db.practiceItems.get(snapshot.id));
      if (!current || current.archivedAt)
        throw new ConflictError('当前题目已归档，请更新本轮题目。');
      if (current.currentRevisionId !== token.revisionId)
        throw new ConflictError('当前题目已更新，请载入最新版并重新作答。');
    }
    return session;
  }
  async saveProject(raw: ProjectInput, id?: string) {
    const input = projectInputSchema.parse(raw);
    const now = new Date().toISOString();
    return this.write(async () => {
      const existing = id ? await this.requireProject(id) : undefined;
      const project = {
        ...input,
        automaticGoal: input.automaticGoal ?? existing?.automaticGoal,
        priority: input.priority ?? existing?.priority ?? 2,
        newCardLimit: input.newCardLimit ?? existing?.newCardLimit ?? 10,
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await this.db.projects.put(project);
      return project.id;
    });
  }
  async archiveProject(id: string) {
    await this.write(async () => {
      await this.requireProject(id);
      await this.db.projects.update(id, { archivedAt: new Date().toISOString() });
    });
  }
  async restoreProject(id: string) {
    await this.write(async () => {
      const project = await this.db.projects.get(id);
      if (!project) throw new Error('项目不存在');
      await this.db.projects.update(id, { archivedAt: undefined });
    });
  }
  async saveCard(
    projectId: string,
    raw: CardInput,
    id?: string,
    change?: RevisionInput,
    importedSources?: SourceReference[],
    aiConfirmation?: AiConfirmation,
  ) {
    const input = cardInputSchema.parse(raw);
    return this.write(async () => {
      await this.requireProject(projectId);
      const existing = id ? await this.db.practiceItems.get(id) : undefined;
      if (id && (!existing || existing.archivedAt || existing.projectId !== projectId))
        throw new Error('题目不存在');
      if (existing && (!change || change.expectedRevisionId !== existing.currentRevisionId))
        throw new ConflictError('题目已被其他页面修改，请保留输入并重新打开编辑。');
      if (existing && (!change?.changeSummary.trim() || change.changeSummary.length > 2000))
        throw new Error('请填写本次修改原因（最多 2000 字）');
      if (
        change &&
        !['cosmetic', 'clarification', 'substantive', 'replacement'].includes(change.changeType)
      )
        throw new Error('无效的修订类型');
      if (
        change &&
        ['substantive', 'replacement'].includes(change.changeType) &&
        change.impactOnLearningState !== 'reset'
      )
        throw new Error('实质性更正或知识替换必须重新学习');
      const learningObjective = input.learningObjective ?? existing?.learningObjective;
      const now = new Date().toISOString();
      const itemId = id ?? crypto.randomUUID();
      const number = (existing?.revision ?? 0) + 1;
      const impact = change?.impactOnLearningState ?? 'reset';
      // A user-supplied label is not sufficient proof that a revision is only cosmetic.
      // Never carry earlier recall evidence over to a different question, answer, or rubric.
      const comparable = (value: string) => value.replace(/\s+/g, '').replace(/。$/u, '');
      if (existing && impact === 'preserve') {
        const unchangedQuestion = comparable(existing.question) === comparable(input.question);
        const unchangedAnswer =
          comparable(existing.standardAnswer) === comparable(input.standardAnswer);
        const newCriteria = lines(input.answerCriteria);
        const unchangedCriteria =
          existing.answerCriteria.length === newCriteria.length &&
          existing.answerCriteria.every(
            (criterion, index) => comparable(criterion) === comparable(newCriteria[index] ?? ''),
          );
        if (
          !unchangedQuestion ||
          !unchangedAnswer ||
          !unchangedCriteria ||
          existing.learningObjective !== learningObjective
        )
          throw new Error(
            '题干、标准答案或核对要点有内容变化；请使用重新学习的修订类型，不能继承旧成绩',
          );
      }
      const knowledgeUnitId =
        existing && change?.changeType !== 'replacement'
          ? existing.knowledgeUnitId
          : crypto.randomUUID();
      if (existing && importedSources) throw new Error('不能替换既有题目的原始来源');
      const sourceReferences = importedSources
        ? structuredClone(importedSources)
        : existing?.sourceReferences.some((ref) => ref.documentId)
          ? existing.sourceReferences.map((ref, index) =>
              index === 0 ? { ...ref, label: input.sourceLabel || ref.label } : ref,
            )
          : input.sourceLabel
            ? [{ label: input.sourceLabel }]
            : [];
      for (const source of sourceReferences)
        if (source.documentId)
          assertSourceReference(
            source,
            await this.db.sourceDocuments.get(source.documentId),
            projectId,
          );
      let aiProvenance: AiProvenance | undefined = existing?.aiProvenance
        ? { ...structuredClone(existing.aiProvenance), modifiedAfterConfirmation: true }
        : undefined;
      if (aiConfirmation) {
        aiProvenance = {
          ...structuredClone(aiConfirmation),
          confirmedRevisionId: revisionId(itemId, number),
        };
        assertAiAnchors(aiProvenance);
        if (
          aiProvenance.objective !== learningObjective ||
          aiProvenance.confirmation.question !== input.question ||
          aiProvenance.confirmation.answer !== input.standardAnswer ||
          JSON.stringify(aiProvenance.confirmation.criteria) !==
            JSON.stringify(lines(input.answerCriteria))
        )
          throw new Error('AI 确认内容与实际保存字段不一致');
        if (aiProvenance.sourceKind === 'answer') {
          if (
            !existing ||
            aiProvenance.inputId !== existing.id ||
            aiProvenance.inputRevisionId !== existing.currentRevisionId ||
            aiProvenance.inputText !== existing.standardAnswer
          )
            throw new ConflictError('AI 依据的标准答案已修订，请保留候选并重新核对');
          if (
            aiProvenance.confirmation.criterionMode === 'unchanged' &&
            JSON.stringify(aiProvenance.confirmation.criteria) !==
              JSON.stringify(existing.answerCriteria)
          )
            throw new Error('不能把修改后的评分要点标成未变化');
        } else {
          const doc = await this.db.sourceDocuments.get(aiProvenance.inputId);
          if (
            !doc ||
            doc.projectId !== projectId ||
            doc.sourceHash !== aiProvenance.documentHash ||
            doc.extractedContent.slice(
              aiProvenance.inputStart,
              aiProvenance.inputStart + aiProvenance.inputText.length,
            ) !== aiProvenance.inputText
          )
            throw new ConflictError('AI 依据的原资料已变化，请重新生成');
        }
      }
      const item: PracticeItem = {
        id: itemId,
        projectId,
        knowledgeUnitId,
        question: input.question,
        ...(learningObjective ? { learningObjective } : {}),
        ...(aiProvenance ? { aiProvenance } : {}),
        standardAnswer: input.standardAnswer,
        answerCriteria: lines(input.answerCriteria),
        hints: lines(input.hints),
        mnemonics: input.mnemonics,
        confusionWarnings: input.confusionWarnings,
        sourceReferences,
        practiceType: 'free_recall',
        ...(existing?.focus === undefined ? {} : { focus: existing.focus }),
        verificationStatus: 'user_authored',
        revision: number,
        currentRevisionId: revisionId(itemId, number),
        learningStateId:
          existing && impact === 'preserve'
            ? existing.learningStateId
            : legacyStateId(itemId, number),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await this.db.revisions.add({
        id: item.currentRevisionId,
        practiceItemId: item.id,
        revisionNumber: number,
        previousRevisionId: existing?.currentRevisionId ?? null,
        changeType: change?.changeType ?? 'initial',
        changeSummary: change?.changeSummary.trim() ?? '首次创建',
        impactOnLearningState: impact,
        learningStateId: item.learningStateId,
        createdAt: now,
        snapshot: snapshotOf(item),
      });
      const unit = await this.db.knowledgeUnits.get(knowledgeUnitId);
      await this.db.knowledgeUnits.put({
        id: knowledgeUnitId,
        projectId,
        title: item.question,
        knowledgeType: unit?.knowledgeType ?? 'fact',
        canonicalContent: item.standardAnswer,
        ...(item.learningObjective ? { learningObjective: item.learningObjective } : {}),
        ...(item.aiProvenance ? { aiProvenance: item.aiProvenance } : {}),
        sourceReferences: item.sourceReferences,
        importance: unit?.importance ?? 1,
        difficulty: unit?.difficulty ?? null,
        tags: unit?.tags ?? [],
        verificationStatus: 'user_authored',
        createdAt: unit?.createdAt ?? now,
        updatedAt: now,
      });
      await this.db.practiceItems.put(item);
      return item.id;
    });
  }
  async completePrompts(
    projectId: string,
    changes: { id: string; question: string; expectedRevisionId: string }[],
  ) {
    return this.write(async () => {
      for (const change of changes) {
        const card = await this.db.practiceItems.get(change.id);
        if (
          !card ||
          card.projectId !== projectId ||
          card.currentRevisionId !== change.expectedRevisionId
        )
          throw new ConflictError('待完善题目已变化，请保留编辑并重新载入。');
        if (promptProblem({ ...card, question: change.question }))
          throw new Error('请填写不会直接透露答案的有效题干');
        await this.saveCard(
          projectId,
          {
            ...card,
            question: change.question,
            hints: card.hints.join('\n'),
            answerCriteria: card.answerCriteria.join('\n'),
            sourceLabel: card.sourceReferences[0]?.label ?? '',
          },
          card.id,
          {
            expectedRevisionId: change.expectedRevisionId,
            changeType: 'substantive',
            changeSummary: '完善题干，避免题面透露答案',
            impactOnLearningState: 'reset',
          },
        );
      }
      return changes.length;
    });
  }
  async archiveCard(projectId: string, id: string) {
    await this.write(async () => {
      await this.requireProject(projectId);
      const item = await this.db.practiceItems.get(id);
      if (!item || item.projectId !== projectId) throw new Error('题目不存在');
      await this.db.practiceItems.update(id, { archivedAt: new Date().toISOString() });
    });
  }
  async restoreCard(projectId: string, id: string) {
    await this.write(async () => {
      await this.requireProject(projectId);
      const item = await this.db.practiceItems.get(id);
      if (!item || item.projectId !== projectId) throw new Error('题目不存在');
      await this.db.practiceItems.update(id, { archivedAt: undefined });
    });
  }
  private async available(projectId: string) {
    return (await this.db.practiceItems.where('projectId').equals(projectId).toArray())
      .filter((item) => !item.archivedAt && !promptProblem(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  async startSession(projectId: string): Promise<string> {
    return this.write(async () => {
      await this.requireProject(projectId);
      const active = await this.db.sessions
        .where('[projectId+status]')
        .equals([projectId, 'active'])
        .filter((session) => !session.reviewPlan)
        .first();
      if (active) return active.id;
      const items = await this.available(projectId);
      if (!items.length) throw new Error('请先添加至少一道可学习题目，或完善待完善题干');
      const now = new Date().toISOString();
      const session: StudySession = {
        id: crypto.randomUUID(),
        projectId,
        queue: items.map(snapshotOf),
        index: 0,
        status: 'active',
        createdAt: now,
        completedAt: null,
        draft: freshDraft(now),
        generation: crypto.randomUUID(),
        planVersion: 0,
        draftVersion: 0,
      };
      await this.db.sessions.add(session);
      return session.id;
    });
  }
  async updateDraft(
    sessionId: string,
    index: number,
    patch: DraftPatch,
    token: SessionToken,
    action?: 'hint' | 'reveal',
  ): Promise<StudySession> {
    return this.write(async () => {
      const session = await this.requireSession(sessionId, index, token);
      if (session.draft.wasAnswerRevealed)
        throw new ConflictError('答案已揭晓，不能修改揭晓前的作答证据');
      if (patch.timing) timingSchema.parse(patch.timing);
      const draft = { ...session.draft, ...patch };
      if (draft.userResponse.length > 20000) throw new Error('答案最多 20000 字');
      if (!['quick', 'typed'].includes(draft.responseMode)) throw new Error('无效的作答模式');
      if (
        draft.confidenceBeforeReveal !== null &&
        ![0, 1, 2, 3, 4].includes(draft.confidenceBeforeReveal)
      )
        throw new Error('无效的信心程度');
      if (action === 'hint')
        draft.hintLevelUsed = Math.min(
          draft.hintLevelUsed + 1,
          session.queue[index]?.hints.length ?? 0,
        );
      if (action === 'reveal') {
        draft.wasAnswerRevealed = true;
        draft.revealedAt = new Date().toISOString();
      }
      const updated = {
        ...session,
        draft,
        draftVersion: session.draftVersion + 1,
        lastWriterId: token.writerId,
      };
      await this.db.sessions.put(updated);
      return updated;
    });
  }
  async clearLearningIssue(itemId: string, expectedRevisionId: string) {
    await this.write(async () => {
      const item = await this.db.practiceItems.get(itemId);
      if (!item || item.currentRevisionId !== expectedRevisionId)
        throw new ConflictError('题目已修改，请载入最新内容');
      await this.db.practiceItems.update(itemId, { learningIssue: undefined });
    });
  }
  async confirmQualityBatch(rows: { id: string; expectedRevisionId: string }[]) {
    await this.write(async () => {
      for (const r of rows) await this.confirmQuality(r.id, r.expectedRevisionId);
    });
  }
  async confirmQuality(itemId: string, expectedRevisionId: string) {
    await this.write(async () => {
      const item = await this.db.practiceItems.get(itemId);
      if (!item || item.archivedAt || item.currentRevisionId !== expectedRevisionId)
        throw new ConflictError('题目已更新，请重新核对当前版本');
      await this.db.practiceItems.update(itemId, { qualityReviewedRevisionId: expectedRevisionId });
    });
  }
  async updateAssessment(
    sessionId: string,
    index: number,
    patch: Partial<AssessmentDraft>,
    token: SessionToken,
  ) {
    return this.write(async () => {
      const session = await this.requireSession(sessionId, index, token);
      if (!session.draft.wasAnswerRevealed) throw new Error('请先独立作答并揭晓，再核对要点');
      const assessment = assessmentSchema.parse({
        ...freshAssessment(),
        ...session.draft.assessment,
        ...patch,
      });
      assessmentResult(assessment, session.queue[index]!);
      const updated = {
        ...session,
        draft: { ...session.draft, assessment },
        draftVersion: session.draftVersion + 1,
        lastWriterId: token.writerId,
      };
      await this.db.sessions.put(updated);
      return updated;
    });
  }
  private async retain(
    session: StudySession,
    reason: string,
    draft = session.draft,
    snapshot = session.queue[session.index],
  ) {
    if (
      snapshot &&
      (draft.userResponse ||
        draft.hintLevelUsed ||
        draft.wasAnswerRevealed ||
        draft.attemptedBeforeReveal)
    ) {
      await this.db.draftRecoveries.add({
        id: crypto.randomUUID(),
        sessionId: session.id,
        practiceItemId: snapshot.id,
        revision: snapshot.revision,
        createdAt: new Date().toISOString(),
        reason,
        draft: structuredClone(draft),
      });
    }
  }
  async retainConflictDraft(sessionId: string, snapshot: PracticeSnapshot, draft: StudyDraft) {
    await this.write(async () => {
      const session = await this.db.sessions.get(sessionId);
      const item = await this.db.practiceItems.get(snapshot.id);
      if (!session || !item || item.projectId !== session.projectId)
        throw new Error('原记录已变化，请下载本页输入副本');
      if (!(await this.db.revisions.get(revisionId(snapshot.id, snapshot.revision))))
        throw new Error('原修订已不在当前数据中，请下载本页输入副本');
      await this.retain(session, '另一标签页更新：本页输入副本', draft, snapshot);
    });
  }
  async syncSession(
    sessionId: string,
    index: number,
    token: SessionToken,
    options: { includeNew?: boolean; reloadCurrent?: boolean } = {},
  ) {
    const scheduling = await this.schedulingHooks(sessionId);
    return this.write(async () => {
      const session = await this.requireSession(sessionId, index, token, false);
      if (session.reviewPlan && options.includeNew)
        throw new Error('今日计划按预算安排，新题请在今日复习中选择。');
      const items = await this.available(session.projectId);
      const byId = new Map(items.map((item) => [item.id, item]));
      const oldCurrent = session.queue[index];
      const current = oldCurrent && byId.get(oldCurrent.id);
      const changed = !!oldCurrent && (!current || current.currentRevisionId !== token.revisionId);
      if (changed && current && !options.reloadCurrent)
        throw new ConflictError('当前题目已更新，请明确载入最新版并重新作答');
      const prefix = session.queue.slice(0, index);
      const remaining = session.queue.slice(index).flatMap((snapshot) => {
        const item = byId.get(snapshot.id);
        return item ? [snapshotOf(item)] : [];
      });
      if (options.includeNew) {
        const planned = new Set(session.queue.map((item) => item.id));
        remaining.push(...items.filter((item) => !planned.has(item.id)).map(snapshotOf));
      }
      if (changed)
        await this.retain(session, current ? '题目更新前的作答' : '当前题目归档前的作答');
      const now = new Date().toISOString();
      const updated: StudySession = {
        ...session,
        queue: [...prefix, ...remaining],
        draft: changed ? freshDraft(now, session.draft.responseMode) : session.draft,
        planVersion: session.planVersion + 1,
        draftVersion: session.draftVersion + 1,
        status: remaining.length ? 'active' : 'completed',
        completedAt: remaining.length ? null : now,
      };
      if (scheduling) await scheduling.refreshReviewPlan(this.db, updated, new Date(now));
      await this.db.sessions.put(updated);
      return updated;
    });
  }
  async endSession(sessionId: string, index: number, token: SessionToken) {
    return this.write(async () => {
      const session = await this.requireSession(sessionId, index, token, false);
      await this.retain(session, '轮次结束前的作答');
      await this.db.sessions.put({
        ...session,
        status: 'ended',
        completedAt: new Date().toISOString(),
        planVersion: session.planVersion + 1,
        draftVersion: session.draftVersion + 1,
      });
    });
  }
  async restartSession(sessionId: string, index: number, token: SessionToken) {
    return this.write(async () => {
      const session = await this.requireSession(sessionId, index, token, false);
      await this.endSession(sessionId, index, token);
      return this.startSession(session.projectId);
    });
  }
  async submitReview(
    sessionId: string,
    index: number,
    performance: Performance,
    mastery: SubjectiveMastery | null,
    token: SessionToken,
    difficulty: Difficulty = 'good',
    automaticCheck = false,
    issueReason?: string,
  ) {
    const scheduling = await this.schedulingHooks(sessionId);
    return this.write(async () => {
      const existing = await this.db.sessions.get(sessionId);
      if (!existing || existing.status !== 'active' || existing.index !== index) return false;
      const session = await this.requireSession(sessionId, index, token);
      const item = session.queue[index];
      if (!item) throw new Error('学习队列损坏');
      const now = new Date().toISOString();
      let event = buildReviewEvent(session, item, performance, mastery, now);
      if (session.reviewPlan?.compact) {
        const docs = await this.db.sourceDocuments.bulkGet(
          item.sourceReferences.flatMap((r) => (r.documentId ? [r.documentId] : [])),
        );
        const sourceReady = docs.every(
          (d) =>
            d &&
            d.extractionStatus === 'ready' &&
            !d.warnings.length &&
            d.pages.every((p) => p.method !== 'ocr' && p.status === 'ready'),
        );
        const literalMatch = exactShort(item, session.draft.userResponse);
        if (
          automaticCheck &&
          (!sourceReady ||
            !literalMatch ||
            performance !== 'correct' ||
            !event.wasIndependentRecall ||
            event.hintLevelUsed)
        )
          throw new Error('本次回答不能自动核对，请快速人工确认。');
        event = {
          ...event,
          schemaVersion: 5,
          quickFeedback: {
            checker: automaticCheck ? 'exact-short-v1' : 'manual-v1',
            literalMatch,
            overridden: !automaticCheck && literalMatch,
            sourceReady,
          },
          ...(automaticCheck ? { assessmentSource: 'deterministic' as const } : {}),
        };
        assertLearningEvidence(event);
      }
      if (session.reviewPlan) {
        if (!scheduling) throw new ConflictError();
        event = await scheduling.applyScheduling(
          this.db,
          session,
          event,
          session.draft.assessment?.difficulty ?? difficulty,
          new Date(now),
        );
      }
      if (issueReason) {
        if (performance !== 'skipped' || issueReason.length > 1000)
          throw new Error('问题标记需跳过当前题目并保留历史');
        await this.db.practiceItems.update(item.id, {
          learningIssue: { reason: issueReason, at: now },
        });
        event.errorTypes = [...event.errorTypes, 'item_flagged'];
      }
      await this.db.reviewEvents.add(event);
      const nextIndex = index + 1;
      const available = new Map(
        (await this.available(session.projectId)).map((item) => [item.id, item]),
      );
      const remaining = session.queue.slice(nextIndex).flatMap((snapshot) => {
        const item = available.get(snapshot.id);
        return item ? [snapshotOf(item)] : [];
      });
      const updated: StudySession = {
        ...session,
        queue: [...session.queue.slice(0, nextIndex), ...remaining],
        index: nextIndex,
        status: remaining.length ? 'active' : 'completed',
        completedAt: remaining.length ? null : now,
        draft: freshDraft(now, session.draft.responseMode),
        planVersion: session.planVersion + 1,
        draftVersion: session.draftVersion + 1,
      };
      if (session.reviewPlan?.adaptive && scheduling)
        await scheduling.rebuildAdaptiveTail(this.db, updated, new Date(now));
      await this.db.sessions.put(updated);
      return true;
    });
  }
}
export const repository = new Repository();
