import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
import { editingService } from '../persistence/editing-service';
import type { EditorDraft } from '../persistence/editable-format';
import { EditorDraftController } from './editor-draft';
import { SourceLinks } from './Documents';
import { ErrorNotice } from '../components/shared';
import { dateTime, errorMessage } from '../components/actions';
import { downloadJson } from '../persistence/backup';
export function WorkingNote({ id }: { id: string }) {
  const [record, setRecord] = useState<EditorDraft>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      const unit = await db.knowledgeUnits.get(id);
      if (!unit) throw new Error('学习稿不存在，请返回题库或资料');
      const now = new Date().toISOString();
      const d = await editingService.openDraft({
        id: `note:${id}`,
        kind: 'note',
        epoch: crypto.randomUUID(),
        version: 0,
        knowledgeUnitId: id,
        projectId: unit.projectId,
        baseNoteVersion: unit.noteVersion ?? 0,
        values: { content: unit.canonicalContent },
        createdAt: now,
        updatedAt: now,
      });
      if (active) setRecord(d);
    })().catch((e) => {
      if (active) setError(errorMessage(e));
    });
    return () => {
      active = false;
    };
  }, [id]);
  if (!record)
    return (
      <>
        <p>正在恢复学习稿…</p>
        <ErrorNotice message={error} />
      </>
    );
  return <NoteFields key={record.epoch} record={record} />;
}
function NoteFields({ record }: { record: EditorDraft }) {
  const [controller] = useState(() => new EditorDraftController(record));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const unit = useLiveQuery(
    () => db.knowledgeUnits.get(record.knowledgeUnitId!),
    [record.knowledgeUnitId],
  );
  const versions = useLiveQuery(
    () =>
      db.workingNoteRevisions
        .where('knowledgeUnitId')
        .equals(record.knowledgeUnitId!)
        .reverse()
        .sortBy('version'),
    [record.knowledgeUnitId],
  );
  const cards = useLiveQuery(
    () => db.practiceItems.where('knowledgeUnitId').equals(record.knowledgeUnitId!).toArray(),
    [record.knowledgeUnitId],
  );
  const content = view.values && 'content' in view.values ? view.values.content : '';
  const changed = !!unit && unit.canonicalContent !== content;
  useEffect(() => {
    if (!changed || view.error || view.pending) return;
    const timer = window.setTimeout(() => void controller.saveNote(), 800);
    return () => window.clearTimeout(timer);
  }, [changed, content, view.error, view.pending, controller]);
  if (!unit) return <p>正在读取学习稿…</p>;
  return (
    <>
      <a className="text-link breadcrumb" href={`#project/${unit.projectId}`}>
        返回题库
      </a>
      <h1>编辑学习稿</h1>
      <p>这是可编辑的用户学习稿。补充内容不代表原始资料；修改不会覆盖已确认的练习答案。</p>
      <SourceLinks sources={unit.sourceReferences} />
      <label>
        学习稿正文
        <textarea
          aria-label="学习稿正文"
          rows={14}
          maxLength={100000}
          value={content}
          onChange={(e) => controller.edit({ content: e.target.value })}
        />
      </label>
      <p role="status" data-testid="note-status">
        {view.error
          ? '保存暂停，本页输入保留'
          : view.pending
            ? '正在保存…'
            : changed
              ? '草稿已保存在本机，正在整理版本…'
              : `学习稿已自动保存 · 版本 ${unit.noteVersion ?? 0}`}
      </p>
      <ErrorNotice message={view.error} />
      <button
        className="button"
        disabled={!!view.error || !!view.pending || !changed}
        onClick={() => void controller.saveNote()}
      >
        立即保存学习稿
      </button>
      {view.error && (
        <button
          className="button secondary"
          onClick={() =>
            downloadJson({ ...view.record, values: view.values }, 'RecallLab-note-draft.json')
          }
        >
          下载本页输入
        </button>
      )}
      <details>
        <summary>版本记录与原文依据</summary>
        {(versions ?? []).map((v) => (
          <details key={v.id}>
            <summary>
              版本 {v.version} · {v.recordedBy === 'user' ? '用户整理' : '原始学习稿快照'} ·{' '}
              {dateTime(v.createdAt)}
            </summary>
            <p className="preserve-lines">{v.content}</p>
          </details>
        ))}
      </details>
      <h2>独立练习题</h2>
      <p>
        如需采用学习稿中的内容，请打开题目编辑标准答案，并确认重新安排学习；题目更改也不会覆盖本学习稿。
      </p>
      {(cards ?? []).map((card) => (
        <p key={card.id}>
          <a className="text-link" href={`#item/${card.id}`}>
            {card.question}
          </a>
        </p>
      ))}
    </>
  );
}
