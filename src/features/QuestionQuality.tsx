import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PracticeItem } from '../domain/models';
import { questionQuality } from '../domain/quality';
import { promptProblem } from '../domain/readiness';
import { db } from '../persistence/database';
import { repository } from '../persistence/repository';
import { useAction } from '../components/actions';
import { ErrorNotice } from '../components/shared';
import { SourceLinks } from './Documents';
export function QuestionQuality({
  projectId,
  cards,
  onEdit,
}: {
  projectId: string;
  cards: PracticeItem[];
  onEdit: (card: PracticeItem) => void;
}) {
  const documents = useLiveQuery(
    () => db.sourceDocuments.where('projectId').equals(projectId).toArray(),
    [projectId],
  );
  const current = useMemo(
    () => cards.filter((c) => c.projectId === projectId && !c.archivedAt),
    [cards, projectId],
  );
  const issues = useMemo(() => questionQuality(current, documents ?? []), [current, documents]);
  const [filter, setFilter] = useState('pending'),
    [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const action = useAction();
  const flagged = current.filter((c) => issues.get(c.id)?.length);
  const visible = flagged.filter(
    (c) =>
      filter === 'all' ||
      (filter === 'pending'
        ? c.qualityReviewedRevisionId !== c.currentRevisionId
        : issues.get(c.id)?.some((i) => i.kind === filter)),
  );
  const rows = visible.slice(page * 20, page * 20 + 20);
  return (
    <>
      <a className="text-link" href={`#project/${projectId}`}>
        返回项目题库
      </a>
      <h1>题目质量核对</h1>
      <p>
        确定性规则提示可能的问题，不代表机器已理解或验证内容。人工确认不改原文、不生成成绩，也不能使不完整题干进入学习。
      </p>
      <p>
        {flagged.length} 道有提示 ·{' '}
        {flagged.filter((c) => c.qualityReviewedRevisionId === c.currentRevisionId).length}{' '}
        道已人工检查本版
      </p>
      <a className="button secondary" href={`#pending/${projectId}`}>
        批量完善待用题干
      </a>
      <label>
        质量提示筛选
        <select
          aria-label="质量提示筛选"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="pending">尚未人工检查</option>
          <option value="all">所有提示</option>
          <option value="prompt">题干泄露或不完整</option>
          <option value="vague">题干笼统</option>
          <option value="criteria">长答案缺要点</option>
          <option value="similar">题干相似</option>
          <option value="source">来源完整性</option>
          <option value="ocr">OCR 待核对</option>
        </select>
      </label>
      {rows.map((c) => (
        <section className="candidate-card" key={c.id}>
          <h2>{c.question}</h2>
          <ul>
            {issues.get(c.id)?.map((i) => (
              <li key={i.kind}>{i.message}</li>
            ))}
          </ul>
          <details>
            <summary>查看答案与来源</summary>
            <p className="preserve-lines">{c.standardAnswer}</p>
            <SourceLinks sources={c.sourceReferences} />
          </details>
          <p className="muted">
            {promptProblem(c)
              ? '题干完善前不可学习'
              : c.qualityReviewedRevisionId === c.currentRevisionId
                ? '已人工检查本版，非机器验证'
                : '尚未人工检查本版'}
          </p>
          <div className="button-row">
            <button className="button secondary" onClick={() => onEdit(c)}>
              编辑题目与核对要点
            </button>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!selected[c.id]}
                onChange={(e) =>
                  setSelected((v) => ({
                    ...v,
                    [c.id]: e.target.checked ? c.currentRevisionId : '',
                  }))
                }
              />
              我已对照来源检查此版本
            </label>
          </div>
        </section>
      ))}
      <p role="status">
        当前 {visible.length} 道提示，第 {page + 1} 页，每页最多 20 道。确认后原始 OCR
        仍标为未验证，题目修订后需要重新检查。
      </p>
      <ErrorNotice message={action.error} />
      <div className="button-row">
        <button
          className="button"
          disabled={action.busy || !Object.values(selected).some(Boolean)}
          onClick={() =>
            void action.run(async () => {
              await repository.confirmQualityBatch(
                Object.entries(selected)
                  .filter(([, revision]) => revision)
                  .map(([id, expectedRevisionId]) => ({ id, expectedRevisionId })),
              );
              setSelected({});
            })
          }
        >
          保存选中的人工检查记录
        </button>
        <button className="button secondary" disabled={!page} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <button
          className="button secondary"
          disabled={(page + 1) * 20 >= visible.length}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
    </>
  );
}
