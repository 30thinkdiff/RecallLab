import type { PracticeSnapshot, SessionToken, StudyDraft, StudySession } from '../domain/models';
import { ConflictError, tokenOf } from '../domain/revisions';
import { errorMessage } from '../components/actions';
import { repository, type DraftPatch, type Repository } from '../persistence/repository';

interface DraftView {
  draft: StudyDraft;
  pending: number;
  conflict: boolean;
  error: string;
}
// A serialized per-tab writer. React observes this store; liveQuery updates are inputs,
// never an unconditional effect that overwrites local edits.
export class StudyDraftController {
  private base: StudySession;
  private local: StudyDraft;
  private pending = 0;
  private conflict = false;
  private error = '';
  private chain: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private view: DraftView;
  private writerId = crypto.randomUUID();
  private recoveryKey: string;
  private hasLocalEdits = false;
  constructor(
    session: StudySession,
    private repo: Repository = repository,
  ) {
    this.base = structuredClone(session);
    this.local = structuredClone(session.draft);
    this.recoveryKey = `RecallLab:unsaved:${session.id}:${session.index}`;
    try {
      const buffered = sessionStorage.getItem(this.recoveryKey);
      if (buffered) {
        const data = JSON.parse(buffered) as { generation: string; draft: StudyDraft };
        if (data.generation === session.generation) {
          this.local = data.draft;
          this.conflict = true;
          this.error = '发现本页尚未处理的输入副本，请保留后载入最新状态。';
          this.hasLocalEdits = true;
        }
      }
    } catch {
      /* Storage may be unavailable; the in-memory and IndexedDB copies remain. */
    }
    this.view = this.snapshot();
  }
  private snapshot(): DraftView {
    return {
      draft: { ...this.local },
      pending: this.pending,
      conflict: this.conflict,
      error: this.error,
    };
  }
  private publish() {
    this.view = this.snapshot();
    this.listeners.forEach((listener) => listener());
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;
  private token(): SessionToken {
    return { ...tokenOf(this.base), writerId: this.writerId };
  }
  private buffer() {
    try {
      sessionStorage.setItem(
        this.recoveryKey,
        JSON.stringify({ generation: this.base.generation, draft: this.local }),
      );
    } catch {
      /* Keep the visible input, never clear it on a storage error. */
    }
  }
  private clearBuffer() {
    try {
      sessionStorage.removeItem(this.recoveryKey);
    } catch {
      /* optional per-tab protection */
    }
  }
  receive(session: StudySession) {
    const changedIdentity =
      session.generation !== this.base.generation ||
      session.index !== this.base.index ||
      tokenOf(session).revisionId !== tokenOf(this.base).revisionId;
    if (
      !changedIdentity &&
      session.planVersion === this.base.planVersion &&
      session.draftVersion <= this.base.draftVersion
    )
      return;
    // A liveQuery notification may arrive before our awaited write resolves.
    if (
      !changedIdentity &&
      session.lastWriterId === this.writerId &&
      session.planVersion === this.base.planVersion
    )
      return;
    if (this.pending || this.conflict || this.hasLocalEdits) {
      this.conflict = true;
      this.error = '另一页面已更新状态。本页输入已保留，未覆盖最新草稿。';
      this.buffer();
      this.publish();
      return;
    }
    this.base = structuredClone(session);
    this.local = structuredClone(session.draft);
    this.publish();
  }
  edit(patch: DraftPatch) {
    this.local = { ...this.local, ...patch };
    this.hasLocalEdits = true;
    this.buffer();
    if (this.conflict) {
      this.publish();
      return;
    }
    this.pending++;
    this.publish();
    this.chain = this.chain
      .then(async () => {
        if (this.conflict) return;
        const updated = await this.repo.updateDraft(
          this.base.id,
          this.base.index,
          patch,
          this.token(),
        );
        this.base = updated;
      })
      .catch((cause: unknown) => {
        this.conflict = true;
        this.error = errorMessage(cause);
        this.buffer();
      })
      .finally(() => {
        this.pending--;
        if (!this.pending && !this.conflict) {
          this.hasLocalEdits = false;
          this.clearBuffer();
        }
        this.publish();
      });
  }
  async flush() {
    await this.chain;
    if (this.conflict) throw new ConflictError(this.error);
  }
  async perform(action: 'hint' | 'reveal') {
    await this.flush();
    try {
      const updated = await this.repo.updateDraft(
        this.base.id,
        this.base.index,
        {},
        this.token(),
        action,
      );
      this.base = updated;
      this.local = structuredClone(updated.draft);
      this.publish();
      return updated;
    } catch (cause) {
      this.conflict = true;
      this.error = errorMessage(cause);
      this.buffer();
      this.publish();
      throw cause;
    }
  }
  async withCurrent<T>(task: (session: StudySession, token: SessionToken) => Promise<T>) {
    await this.flush();
    return task(this.base, this.token());
  }
  async retainAndReload() {
    await this.chain;
    const snapshot = this.base.queue[this.base.index];
    if (snapshot) await this.repo.retainConflictDraft(this.base.id, snapshot, this.local);
    const latest = await this.repo.db.sessions.get(this.base.id);
    if (!latest) throw new Error('轮次不存在，请下载本页输入副本');
    this.base = latest;
    this.local = structuredClone(latest.draft);
    this.conflict = false;
    this.error = '';
    this.hasLocalEdits = false;
    this.clearBuffer();
    this.publish();
  }
  async protectLocal() {
    await this.chain;
    if (this.hasLocalEdits || this.conflict) {
      const snapshot = this.base.queue[this.base.index];
      if (snapshot) await this.repo.retainConflictDraft(this.base.id, snapshot, this.local);
    }
  }
  originalSnapshot(): PracticeSnapshot | undefined {
    return this.base.queue[this.base.index];
  }
  acknowledgeTransition() {
    this.hasLocalEdits = false;
    this.conflict = false;
    this.clearBuffer();
  }
  // A navigation/unmount must not discard a losing tab's unsubmitted answer.
  dispose() {
    if (this.hasLocalEdits || this.conflict) void this.protectLocal().catch(() => this.buffer());
  }
}
