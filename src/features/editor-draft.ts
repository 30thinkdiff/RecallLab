import { editingService, type EditingService } from '../persistence/editing-service';
import { editorDraftSchema, type EditorDraft } from '../persistence/editable-format';
export class EditorDraftController {
  private current: EditorDraft;
  private values: EditorDraft['values'];
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private error = '';
  private listeners = new Set<() => void>();
  private view: ReturnType<EditorDraftController['snapshot']>;
  constructor(
    record: EditorDraft,
    readonly service: EditingService = editingService,
  ) {
    this.current = record;
    this.values = record.values;
    this.view = this.snapshot();
  }
  private snapshot() {
    return { record: this.current, values: this.values, pending: this.pending, error: this.error };
  }
  private emit() {
    this.view = this.snapshot();
    this.listeners.forEach((fn) => fn());
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.view;
  edit(values: EditorDraft['values']) {
    this.values = values;
    if (this.error) {
      this.emit();
      return;
    }
    this.pending++;
    this.emit();
    this.chain = this.chain
      .then(async () => {
        if (this.error) return;
        this.current = await this.service.writeDraft(
          this.current.id,
          this.current.version,
          values,
          this.current.epoch,
        );
      })
      .catch((e) => {
        this.error = e instanceof Error ? e.message : '编辑草稿保存失败，请保留本页输入';
      })
      .finally(() => {
        this.pending--;
        this.emit();
      });
  }
  async flush() {
    await this.chain;
    if (this.error) throw new Error(this.error);
    return this.current;
  }
  saveNote() {
    this.pending++;
    this.emit();
    this.chain = this.chain
      .then(async () => {
        if (this.error) return;
        const d = this.current;
        if (d.kind !== 'note' || !d.knowledgeUnitId) throw new Error('学习稿类型不匹配');
        await this.service.saveNote(
          d.knowledgeUnitId,
          d.baseNoteVersion ?? 0,
          d.values.content,
          d.id,
          d.version,
          d.epoch,
        );
        await this.refresh();
      })
      .catch((e) => {
        this.error = e instanceof Error ? e.message : '学习稿保存失败，本页输入保留';
      })
      .finally(() => {
        this.pending--;
        this.emit();
      });
    return this.chain;
  }
  async refresh() {
    const latest = await this.service.repo.db.editorDrafts.get(this.current.id);
    if (!latest || latest.epoch !== this.current.epoch || latest.version !== this.current.version)
      throw new Error('编辑草稿已变化，请保留输入并载入最新');
    this.current = latest;
    this.emit();
    return latest;
  }
  async protect() {
    const d = {
      ...this.current,
      id: `recovery:${this.current.id}:${crypto.randomUUID()}`,
      values: this.values,
      epoch: crypto.randomUUID(),
      version: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.service.openDraft(editorDraftSchema.parse(d));
  }
}
