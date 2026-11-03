import { Repository, repository } from './repository';
import { cardEditToken, cardUnchanged, preservesRequirements } from '../domain/editing';
import { cardInputSchema, type CardInput } from '../domain/validation';
import { ConflictError } from '../domain/revisions';
import { assertSourceReference } from '../domain/sources';
import type { SourceReference, SessionToken } from '../domain/models';
import { editorDraftSchema, type EditorDraft } from './editable-format';
export class EditingService {
  constructor(readonly repo: Repository = repository) {}
  private write<T>(fn: () => Promise<T>) {
    return this.repo.db.transaction('rw', this.repo.db.tables, fn);
  }
  async openDraft(record: EditorDraft) {
    return this.write(async () => {
      const old = await this.repo.db.editorDrafts.get(record.id);
      if (old) return old;
      const value = editorDraftSchema.parse(record);
      await this.validateDraftRefs(value);
      await this.capacity(value);
      await this.repo.db.editorDrafts.add(value);
      return value;
    });
  }
  private async validateDraftRefs(record: EditorDraft) {
    const { db } = this.repo;
    if (record.projectId && !(await db.projects.get(record.projectId)))
      throw new Error('原项目已变化，请导出本页输入');
    if (
      record.practiceItemId &&
      (await db.practiceItems.get(record.practiceItemId))?.projectId !== record.projectId
    )
      throw new Error('原题目已变化，请导出本页输入');
    if (
      record.knowledgeUnitId &&
      (await db.knowledgeUnits.get(record.knowledgeUnitId))?.projectId !== record.projectId
    )
      throw new Error('原学习稿已变化，请导出本页输入');
    if (
      record.sessionId &&
      (await db.sessions.get(record.sessionId))?.projectId !== record.projectId
    )
      throw new Error('原学习任务已变化，请导出本页输入');
  }
  private async capacity(record: EditorDraft) {
    const rows = await this.repo.db.editorDrafts.toArray();
    const other = rows.filter((r) => r.id !== record.id);
    if (
      other.length >= 100 ||
      new TextEncoder().encode(JSON.stringify([...other, record])).byteLength > 12 * 1024 * 1024
    )
      throw new Error('编辑草稿空间已满，请保存或导出已有草稿后重试');
  }
  async writeDraft(id: string, version: number, values: EditorDraft['values'], epoch: string) {
    return this.write(async () => {
      const old = await this.repo.db.editorDrafts.get(id);
      if (!old || old.version !== version || old.epoch !== epoch)
        throw new ConflictError('另一页面已修改编辑草稿，本页输入保留');
      const next = editorDraftSchema.parse({
        ...old,
        values,
        version: version + 1,
        updatedAt: new Date().toISOString(),
      });
      await this.validateDraftRefs(next);
      await this.capacity(next);
      await this.repo.db.editorDrafts.put(next);
      return next;
    });
  }
  async cancelDraft(id: string, version: number, epoch: string) {
    return this.write(async () => {
      await this.requireDraft(id, version, epoch);
      await this.repo.db.editorDrafts.delete(id);
    });
  }
  private async requireDraft(id: string, version: number, epoch: string) {
    const draft = await this.repo.db.editorDrafts.get(id);
    if (!draft || draft.version !== version || draft.epoch !== epoch)
      throw new ConflictError('编辑草稿已在另一页面变化，本页内容保留');
    return draft;
  }
  async saveCard(
    projectId: string | undefined,
    raw: CardInput,
    options: {
      id?: string;
      expectedToken?: string;
      confirmReset?: boolean;
      draftId?: string;
      draftVersion?: number;
      draftEpoch?: string;
    } = {},
  ) {
    const input = cardInputSchema.parse(raw);
    return this.write(async () => {
      let draft: EditorDraft | undefined;
      if (options.draftId) {
        draft = await this.requireDraft(
          options.draftId,
          options.draftVersion!,
          options.draftEpoch!,
        );
        if (
          draft.kind !== 'card' ||
          draft.practiceItemId !== options.id ||
          draft.projectId !== projectId ||
          JSON.stringify(cardInputSchema.parse(draft.values)) !== JSON.stringify(input)
        )
          throw new ConflictError('请等待本页编辑保存后重试');
      }
      const old = options.id ? await this.repo.db.practiceItems.get(options.id) : undefined;
      if (
        options.id &&
        (!old ||
          old.archivedAt ||
          old.projectId !== projectId ||
          cardEditToken(old) !== options.expectedToken ||
          (draft && draft.baseRevisionId !== options.expectedToken))
      )
        throw new ConflictError('题目已在另一页面修改，请保留编辑并载入最新版');
      const preserve = old ? preservesRequirements(old, input) : false;
      if (old && !preserve && !options.confirmReset)
        throw new Error('请确认更新内容并重新安排学习，旧记录会保留');
      const pid =
        projectId ??
        (await this.repo.saveProject({
          name: input.question.slice(0, 100),
          description: '',
          learningGoal: '',
          targetDate: '',
          dailyTimeBudget: 30,
          automaticGoal: { version: 'goal-v1', objective: input.learningObjective ?? 'exam' },
        }));
      let id = old?.id;
      const contentChanged = !old || !cardUnchanged(old, input);
      if (contentChanged)
        id = await this.repo.saveCard(
          pid,
          input,
          id,
          old
            ? {
                expectedRevisionId: old.currentRevisionId,
                changeType: preserve ? 'cosmetic' : 'substantive',
                impactOnLearningState: preserve ? 'preserve' : 'reset',
                changeSummary: preserve
                  ? '系统记录：用户在简洁编辑中更新辅助信息或无损行尾格式，考核要求不变'
                  : '系统记录：用户确认更新题干、标准答案或必需要点，重新安排学习',
              }
            : undefined,
        );
      else if (
        (input.importance ?? old.importance ?? 2) !== (old.importance ?? 2) ||
        (input.paused ?? old.paused ?? false) !== (old.paused ?? false)
      )
        await this.repo.db.practiceItems.update(id!, {
          importance: input.importance ?? old.importance ?? 2,
          paused: input.paused ?? old.paused ?? false,
          editVersion: (old.editVersion ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        });
      if (options.draftId) await this.repo.db.editorDrafts.delete(options.draftId);
      return { id: id!, projectId: pid, changed: contentChanged, reset: !!old && !preserve };
    });
  }
  async correctInStudy(
    sessionId: string,
    index: number,
    token: SessionToken,
    draft: EditorDraft,
    input: CardInput,
    confirmReset: boolean,
  ) {
    if (draft.kind !== 'card' || draft.sessionId !== sessionId || !draft.practiceItemId)
      throw new Error('编辑草稿不属于当前学习题');
    const old = await this.repo.db.practiceItems.get(draft.practiceItemId);
    const save = () =>
      this.saveCard(draft.projectId, input, {
        id: draft.practiceItemId,
        expectedToken: draft.baseRevisionId,
        confirmReset,
        draftId: draft.id,
        draftVersion: draft.version,
        draftEpoch: draft.epoch,
      });
    if (
      old &&
      cardUnchanged(old, input) &&
      (old.paused ?? false) === (input.paused ?? old.paused ?? false) &&
      (old.importance ?? 2) === (input.importance ?? old.importance ?? 2)
    )
      return { ...(await save()), advanced: false };
    return { ...(await this.repo.correctInStudy(sessionId, index, token, save)), advanced: true };
  }
  async createSourceNote(documentId: string) {
    return this.write(async () => {
      const doc = await this.repo.db.sourceDocuments.get(documentId);
      if (!doc) throw new Error('原始资料不存在');
      const id = `note:${doc.id}`;
      const existing = await this.repo.db.knowledgeUnits.get(id);
      if (existing) return id;
      if (doc.extractedContent.length > 100000)
        throw new Error('这份资料较长，请选择一段原文整理为题目；完整原文仍保留');
      const refs: SourceReference[] = [
        {
          documentId: doc.id,
          label: doc.inputOrigin === 'pasted' ? '用户粘贴的原始快照' : doc.filename,
          excerpt: doc.extractedContent,
          startOffset: 0,
          endOffset: doc.extractedContent.length,
        },
      ];
      refs.forEach((r) => assertSourceReference(r, doc, doc.projectId));
      const now = new Date().toISOString();
      await this.repo.db.knowledgeUnits.add({
        id,
        projectId: doc.projectId,
        title: doc.inputOrigin === 'pasted' ? '粘贴内容的学习稿' : doc.filename,
        knowledgeType: 'fact',
        canonicalContent: doc.extractedContent,
        sourceReferences: refs,
        importance: 1,
        difficulty: null,
        tags: ['working-note'],
        verificationStatus: 'user_authored',
        createdAt: now,
        updatedAt: now,
        noteVersion: 0,
      });
      await this.repo.db.workingNoteRevisions.add({
        id: `${id}:n0`,
        knowledgeUnitId: id,
        projectId: doc.projectId,
        version: 0,
        content: doc.extractedContent,
        sourceReferences: refs,
        createdAt: now,
        recordedBy: 'system_snapshot',
      });
      return id;
    });
  }
  async saveNote(
    id: string,
    expectedVersion: number,
    content: string,
    draftId?: string,
    draftVersion?: number,
    draftEpoch?: string,
  ) {
    return this.write(async () => {
      if (content.length > 100000) throw new Error('学习稿最多100000字');
      const unit = await this.repo.db.knowledgeUnits.get(id);
      if (!unit || (unit.noteVersion ?? 0) !== expectedVersion)
        throw new ConflictError('学习稿已在另一页面修改，请保留输入并载入最新版本');
      const project = await this.repo.db.projects.get(unit.projectId);
      if (!project || project.archivedAt) throw new Error('学习项目已归档');
      let draft: EditorDraft | undefined;
      if (draftId) {
        draft = await this.requireDraft(draftId, draftVersion!, draftEpoch!);
        if (
          draft.kind !== 'note' ||
          draft.knowledgeUnitId !== id ||
          draft.baseNoteVersion !== expectedVersion ||
          draft.values.content !== content
        )
          throw new ConflictError('请等待学习稿草稿保存后重试');
      }
      if (unit.canonicalContent === content) return unit;
      const now = new Date().toISOString(),
        version = expectedVersion + 1;
      if (!(await this.repo.db.workingNoteRevisions.get(`${id}:n${expectedVersion}`)))
        await this.repo.db.workingNoteRevisions.add({
          id: `${id}:n${expectedVersion}`,
          knowledgeUnitId: id,
          projectId: unit.projectId,
          version: expectedVersion,
          content: unit.canonicalContent,
          sourceReferences: unit.sourceReferences,
          createdAt: unit.updatedAt,
          recordedBy: 'system_snapshot',
        });
      await this.repo.db.workingNoteRevisions.add({
        id: `${id}:n${version}`,
        knowledgeUnitId: id,
        projectId: unit.projectId,
        version,
        content,
        sourceReferences: unit.sourceReferences,
        createdAt: now,
        recordedBy: 'user',
      });
      const next = { ...unit, canonicalContent: content, noteVersion: version, updatedAt: now };
      await this.repo.db.knowledgeUnits.put(next);
      if (draft) await this.repo.db.editorDrafts.put({ ...draft, baseNoteVersion: version });
      return next;
    });
  }
}
export const editingService = new EditingService();
