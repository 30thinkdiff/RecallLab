import type { LearningProject, PracticeItem } from '../domain/models';
import { repository } from '../persistence/repository';
import { useAction } from '../components/actions';
import { ErrorNotice } from '../components/shared';

export function ArchivePage({
  projects,
  cards,
}: {
  projects: LearningProject[];
  cards: PracticeItem[];
}) {
  const action = useAction();
  return (
    <>
      <div className="eyebrow">KEPT, NEVER ERASED</div>
      <h1>归档内容</h1>
      <p className="page-intro">
        归档不会删除历史证据。恢复项目后，其未归档题目可再次学习；恢复题目后可选择加入当前轮次。
      </p>
      <ErrorNotice message={action.error} />
      <h2>已归档项目</h2>
      {projects
        .filter((project) => project.archivedAt)
        .map((project) => (
          <article className="library-card" key={project.id}>
            <div>
              <h3>{project.name}</h3>
              <p className="muted">
                {cards.filter((card) => card.projectId === project.id).length} 道题目（含归档）
              </p>
            </div>
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() => void action.run(() => repository.restoreProject(project.id))}
            >
              恢复项目
            </button>
          </article>
        ))}
      <h2>已归档题目</h2>
      {cards
        .filter((card) => card.archivedAt)
        .map((card) => (
          <article className="library-card" key={card.id}>
            <div>
              <h3>{card.question}</h3>
              <p className="muted">
                {projects.find((project) => project.id === card.projectId)?.name} · 修订{' '}
                {card.revision}
              </p>
              <details>
                <summary>查看已归档题目</summary>
                <p className="preserve-lines">{card.standardAnswer}</p>
                <a className="text-link" href={`#item/${card.id}`}>
                  题目历史与版本
                </a>
              </details>
            </div>
            <button
              className="button secondary"
              disabled={
                action.busy ||
                !!projects.find((project) => project.id === card.projectId)?.archivedAt
              }
              onClick={() => void action.run(() => repository.restoreCard(card.projectId, card.id))}
            >
              恢复题目
            </button>
          </article>
        ))}
      {!projects.some((project) => project.archivedAt) &&
        !cards.some((card) => card.archivedAt) && <p>暂无归档内容。</p>}
    </>
  );
}
