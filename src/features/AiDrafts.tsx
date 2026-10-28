import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
import { useAction } from '../components/actions';
import { ErrorNotice } from '../components/shared';
import { deleteAiDraft, tokenFor } from '../ai/drafts-store';
export function AiDrafts() {
  const rows = useLiveQuery(() =>
    db.transaction('r', db.aiDrafts, async () => {
      // Fetch only the current record at a time, then retain metadata rather than source bodies.
      const keys = await db.aiDrafts.orderBy('updatedAt').reverse().primaryKeys();
      const metadata = [];
      for (const key of keys) {
        const row = await db.aiDrafts.get(key);
        if (row)
          metadata.push({
            id: row.id,
            projectId: row.projectId,
            model: row.payload.provider === 'mock' ? '模拟演示（非真实 AI）' : row.payload.model,
            updatedAt: row.updatedAt,
            count: row.payload.candidates.length,
            bytes: row.bytesStored,
            token: tokenFor(row),
          });
      }
      return metadata;
    }),
  );
  const action = useAction();
  return (
    <>
      <h1>AI 整理草稿</h1>
      <p className="page-intro">
        保存在当前浏览器，含原文和未确认编辑，不含密钥。它们尚未成为正式题目。完整备份会包含这些私人内容。
      </p>
      <ErrorNotice message={action.error} />
      <p>每份最多 4 MB，总计 12 MB / 20 份。来源变化后只可查看和导出，确认时会再次检查。</p>
      <a className="text-link" href="#ai-evaluation">
        查看真实模型评测与限制
      </a>
      {rows?.length === 0 && <p>暂无草稿。从学习资料或题目详情进入 AI 辅助整理。</p>}
      {rows?.map((row) => (
        <section className="question-panel" key={row.id}>
          <h2>
            {row.model} · {row.count} 条待整理
          </h2>
          <p>
            {new Date(row.updatedAt).toLocaleString()} · {(row.bytes / 1024).toFixed(1)} KB
          </p>
          <div className="button-row">
            <a className="button" href={`#ai/${row.id}`}>
              继续整理
            </a>
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() => {
                if (window.confirm('删除这份未确认草稿？正式题目和学习记录不受影响。'))
                  void action.run(() => deleteAiDraft(db, row.id, row.token));
              }}
            >
              删除草稿
            </button>
          </div>
        </section>
      ))}
    </>
  );
}
