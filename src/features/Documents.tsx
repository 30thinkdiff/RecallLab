import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { LearningProject, PracticeItem, SourceReference } from '../domain/models';
import { db } from '../persistence/database';
import { repository } from '../persistence/repository';
import { SourceReader } from './SourceReader';
import { ErrorNotice } from '../components/shared';
import { dateTime, useAction } from '../components/actions';
import { normalizedQuestion } from '../importing/types';

export function SourceLinks({ sources }: { sources: SourceReference[] }) {
  return (
    <div className="source-note">
      来源：
      {sources.map((source, index) => (
        <span key={index}>
          {index ? '；' : ''}
          {source.documentId ? (
            <a className="text-link" href={`#document/${source.documentId}/${source.page ?? ''}`}>
              {source.label}
            </a>
          ) : (
            source.label
          )}
        </span>
      ))}
    </div>
  );
}
export function Documents({ projects }: { projects: LearningProject[] }) {
  const documents = useLiveQuery(() =>
    db.sourceDocuments.orderBy('importedAt').reverse().toArray(),
  );
  const [filter, setFilter] = useState('');
  const visible = documents?.filter((document) => !filter || document.projectId === filter) ?? [];
  return (
    <>
      <div className="eyebrow">SOURCES, BEFORE ANSWERS</div>
      <div className="page-heading">
        <div>
          <h1>学习资料</h1>
          <p className="page-intro">
            保留提取原文、章节与题目来源。编辑学习答案不会改写这里的原文。
          </p>
        </div>
        <a className="button" href="#import">
          导入资料
        </a>
      </div>
      <label className="filter-label">
        筛选资料项目
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="">全部项目</option>
          {projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name}
              {project.archivedAt ? '（已归档）' : ''}
            </option>
          ))}
        </select>
      </label>
      {visible.length ? (
        <div className="project-grid">
          {visible.map((document) => (
            <a className="project-card" href={`#document/${document.id}`} key={document.id}>
              <span className="tag">
                {document.fileType.toUpperCase()} ·{' '}
                {document.extractionStatus === 'ready' ? '已提取' : '需人工核对'}
              </span>
              <h2>{document.filename}</h2>
              <p>
                {projects.find((project) => project.id === document.projectId)?.name} ·{' '}
                {document.sections.length} 个章节
                {document.fileType === 'pdf' ? ` · ${document.pages.length} 页` : ''}
              </p>
              <small>{dateTime(document.importedAt)}</small>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty-card spacious">
          <h2>还没有学习资料</h2>
          <p>导入明确问答题库，或从原文选择内容整理为问答。</p>
          <a className="button" href="#import">
            导入第一份资料
          </a>
        </div>
      )}
    </>
  );
}
export function DocumentDetail({
  documentId,
  projects,
  cards,
  page,
}: {
  documentId: string;
  projects: LearningProject[];
  cards: PracticeItem[];
  page?: string;
}) {
  const document = useLiveQuery(() => db.sourceDocuments.get(documentId), [documentId]);
  const [source, setSource] = useState<SourceReference | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [saved, setSaved] = useState('');
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const action = useAction();
  useEffect(() => {
    if (document && page)
      globalThis.document
        .getElementById(`source-page-${document.id}-${page}`)
        ?.scrollIntoView({ block: 'center' });
  }, [document, page]);
  if (!document)
    return <p role="status">正在查找资料；若资料已被恢复操作替换，可返回学习资料重新选择。</p>;
  const archived = projects.find((project) => project.id === document.projectId)?.archivedAt;
  const linked = cards.filter((card) =>
    card.sourceReferences.some((ref) => ref.documentId === document.id),
  );
  const duplicate = cards.some(
    (card) =>
      card.projectId === document.projectId &&
      !card.archivedAt &&
      normalizedQuestion(card.question) === normalizedQuestion(question),
  );
  return (
    <>
      <a className="text-link breadcrumb" href="#documents">
        返回学习资料
      </a>
      <h1>{document.filename}</h1>
      <p className="page-intro">
        {document.fileType.toUpperCase()} · {dateTime(document.importedAt)} · {linked.length}{' '}
        道关联题目
      </p>
      {!archived && (
        <p>
          <a className="button secondary" href={`#ai/document/${document.id}`}>
            AI 辅助整理
          </a>
        </p>
      )}
      {document.warnings.map((warning) => (
        <p className="info-note" key={warning}>
          {warning}
        </p>
      ))}
      <details className="file-information">
        <summary>查看文件信息</summary>
        <p className="muted">校验值（SHA-256）：{document.sourceHash}</p>
        <p className="muted">
          原文件大小：{document.byteLength}{' '}
          字节。这里只保存提取文字与来源信息，不保存原文件二进制；请保留原文件。
        </p>
      </details>
      {source && (
        <section className="question-panel">
          <h2>从原文创建问答</h2>
          <p className="muted">标准答案可编辑；下面的来源原文会保留。</p>
          <label>
            候选问题
            <textarea
              aria-label="原文候选问题"
              maxLength={5000}
              disabled={action.busy}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <label>
            标准答案
            <textarea
              aria-label="原文候选答案"
              rows={4}
              maxLength={20000}
              disabled={action.busy}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
          <details>
            <summary>查看选中原文</summary>
            <p className="preserve-lines">{source.excerpt}</p>
          </details>
          {duplicate && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={allowDuplicate}
                onChange={(event) => setAllowDuplicate(event.target.checked)}
              />
              项目已有相同问题，我确认追加独立题目
            </label>
          )}
          <button
            className="button"
            disabled={
              action.busy ||
              !!archived ||
              !question.trim() ||
              !answer.trim() ||
              answer.length > 20000 ||
              (duplicate && !allowDuplicate)
            }
            onClick={() =>
              void action.run(async () => {
                const id = await repository.saveCard(
                  document.projectId,
                  {
                    question,
                    standardAnswer: answer,
                    hints: '',
                    answerCriteria: '',
                    mnemonics: '',
                    confusionWarnings: '',
                    sourceLabel: source.label,
                  },
                  undefined,
                  undefined,
                  [source],
                );
                setSaved(id);
                setSource(null);
              })
            }
          >
            保存原文问答
          </button>
        </section>
      )}
      <ErrorNotice message={action.error} />
      {saved && (
        <p role="status">
          问答已保存。
          <a className="text-link" href={`#project/${document.projectId}`}>
            返回项目开始学习
          </a>
        </p>
      )}
      {archived && <p className="info-note">所属项目已归档，恢复项目后可以继续创建问答。</p>}
      <SourceReader
        document={document}
        onSelect={
          archived || action.busy
            ? undefined
            : (source) => {
                setSource(source);
                setQuestion('');
                setAnswer(source.excerpt ?? '');
                setAllowDuplicate(false);
              }
        }
      />
      <section>
        <h2>关联知识与题目</h2>
        {linked.length ? (
          linked.map((card) => (
            <p key={card.id}>
              <a className="text-link" href={`#item/${card.id}`}>
                {card.question}
              </a>
              {card.archivedAt ? '（已归档）' : ''}
            </p>
          ))
        ) : (
          <p>尚无关联题目。选择原文即可创建。</p>
        )}
      </section>
    </>
  );
}
