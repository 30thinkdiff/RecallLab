import { db as defaultDb, type RecallDatabase } from './database';
import {
  cardInputSchema,
  lines,
  projectInputSchema,
  type CardInput,
  type ProjectInput,
} from '../domain/validation';
import { buildReviewEvent, freshDraft } from '../domain/review';
import type {
  Performance,
  PracticeItem,
  StudyDraft,
  StudySession,
  SubjectiveMastery,
} from '../domain/models';

export class Repository {
  constructor(readonly db: RecallDatabase = defaultDb) {}

  private async requireProject(id: string) {
    const project = await this.db.projects.get(id);
    if (!project || project.archivedAt) throw new Error('学习项目不存在或已删除');
    return project;
  }

  async saveProject(raw: ProjectInput, id?: string) {
    const input = projectInputSchema.parse(raw);
    const now = new Date().toISOString();
    return this.db.transaction('rw', this.db.projects, async () => {
      const existing = id ? await this.requireProject(id) : undefined;
      const project = {
        ...input,
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await this.db.projects.put(project);
      return project.id;
    });
  }

  async archiveProject(id: string) {
    await this.db.transaction('rw', this.db.projects, async () => {
      await this.requireProject(id);
      await this.db.projects.update(id, { archivedAt: new Date().toISOString() });
    });
  }

  async saveCard(projectId: string, raw: CardInput, id?: string) {
    const input = cardInputSchema.parse(raw);
    return this.db.transaction(
      'rw',
      this.db.projects,
      this.db.practiceItems,
      this.db.knowledgeUnits,
      async () => {
        await this.requireProject(projectId);
        const existing = id ? await this.db.practiceItems.get(id) : undefined;
        if (id && (!existing || existing.archivedAt || existing.projectId !== projectId))
          throw new Error('题目不存在');
        const now = new Date().toISOString();
        const knowledgeUnitId = existing?.knowledgeUnitId ?? crypto.randomUUID();
        const sourceReferences = input.sourceLabel ? [{ label: input.sourceLabel }] : [];
        const item: PracticeItem = {
          id: id ?? crypto.randomUUID(),
          projectId,
          knowledgeUnitId,
          question: input.question,
          standardAnswer: input.standardAnswer,
          answerCriteria: lines(input.answerCriteria),
          hints: lines(input.hints),
          mnemonics: input.mnemonics,
          confusionWarnings: input.confusionWarnings,
          sourceReferences,
          practiceType: 'free_recall',
          verificationStatus: 'user_authored',
          revision: (existing?.revision ?? 0) + 1,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        await this.db.knowledgeUnits.put({
          id: knowledgeUnitId,
          projectId,
          title: input.question,
          knowledgeType: 'fact',
          canonicalContent: input.standardAnswer,
          sourceReferences,
          importance: 1,
          difficulty: null,
          tags: [],
          verificationStatus: 'user_authored',
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        await this.db.practiceItems.put(item);
        return item.id;
      },
    );
  }

  async archiveCard(projectId: string, id: string) {
    await this.db.transaction(
      'rw',
      this.db.projects,
      this.db.practiceItems,
      this.db.sessions,
      async () => {
        await this.requireProject(projectId);
        const item = await this.db.practiceItems.get(id);
        if (!item || item.projectId !== projectId) throw new Error('题目不存在');
        const active = await this.db.sessions
          .where('[projectId+status]')
          .equals([projectId, 'active'])
          .count();
        if (active) throw new Error('请先完成当前学习，再删除题目');
        await this.db.practiceItems.update(id, { archivedAt: new Date().toISOString() });
      },
    );
  }

  async startSession(projectId: string): Promise<string> {
    return this.db.transaction(
      'rw',
      this.db.projects,
      this.db.practiceItems,
      this.db.sessions,
      async () => {
        await this.requireProject(projectId);
        const active = await this.db.sessions
          .where('[projectId+status]')
          .equals([projectId, 'active'])
          .first();
        if (active) return active.id;
        const items = (await this.db.practiceItems.where('projectId').equals(projectId).toArray())
          .filter((item) => !item.archivedAt)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        if (!items.length) throw new Error('请先添加至少一道题目');
        const now = new Date().toISOString();
        const session: StudySession = {
          id: crypto.randomUUID(),
          projectId,
          queue: items.map((item) => ({
            id: item.id,
            knowledgeUnitId: item.knowledgeUnitId,
            question: item.question,
            standardAnswer: item.standardAnswer,
            answerCriteria: item.answerCriteria,
            hints: item.hints,
            mnemonics: item.mnemonics,
            confusionWarnings: item.confusionWarnings,
            sourceReferences: item.sourceReferences,
            revision: item.revision,
          })),
          index: 0,
          status: 'active',
          createdAt: now,
          completedAt: null,
          draft: freshDraft(now),
        };
        await this.db.sessions.add(session);
        return session.id;
      },
    );
  }

  async updateDraft(
    sessionId: string,
    index: number,
    patch: Partial<
      Pick<
        StudyDraft,
        'userResponse' | 'responseMode' | 'confidenceBeforeReveal' | 'attemptedBeforeReveal'
      >
    >,
    action?: 'hint' | 'reveal',
  ) {
    await this.db.transaction('rw', this.db.projects, this.db.sessions, async () => {
      const session = await this.db.sessions.get(sessionId);
      if (!session || session.status !== 'active' || session.index !== index)
        throw new Error('学习进度已变化，请刷新页面');
      await this.requireProject(session.projectId);
      if (session.draft.wasAnswerRevealed) throw new Error('答案已揭晓，不能修改揭晓前的作答证据');
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
      await this.db.sessions.update(sessionId, { draft });
    });
  }

  async submitReview(
    sessionId: string,
    index: number,
    performance: Performance,
    mastery: SubjectiveMastery | null,
  ) {
    return this.db.transaction(
      'rw',
      this.db.projects,
      this.db.sessions,
      this.db.reviewEvents,
      async () => {
        const session = await this.db.sessions.get(sessionId);
        // A retry/double click or a second tab cannot append the same event or advance twice.
        if (!session || session.status !== 'active' || session.index !== index) return false;
        await this.requireProject(session.projectId);
        const item = session.queue[index];
        if (!item) throw new Error('学习队列损坏，请保留数据并联系维护者');
        const now = new Date().toISOString();
        await this.db.reviewEvents.add(buildReviewEvent(session, item, performance, mastery, now));
        const nextIndex = index + 1;
        const completed = nextIndex === session.queue.length;
        await this.db.sessions.update(sessionId, {
          index: nextIndex,
          status: completed ? 'completed' : 'active',
          completedAt: completed ? now : null,
          draft: freshDraft(now, session.draft.responseMode),
        });
        return true;
      },
    );
  }
}

export const repository = new Repository();
