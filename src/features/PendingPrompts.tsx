import { useState } from 'react';
import type { PracticeItem } from '../domain/models';
import { promptProblem } from '../domain/readiness';
import { repository } from '../persistence/repository';
import { useAction } from '../components/actions';
import { ErrorNotice } from '../components/shared';
export function PendingPrompts({ projectId, cards }: { projectId: string; cards: PracticeItem[] }) {
  const [changes, setChanges] = useState<
    Record<string, { question: string; expectedRevisionId: string }>
  >({});
  const [saved, setSaved] = useState(0);
  const action = useAction();
  const pending = cards.filter(
    (c) => c.projectId === projectId && !c.archivedAt && promptProblem(c),
  );
  return (
    <>
      <a className="text-link" href={`#project/${projectId}`}>
        返回项目题库
      </a>
      <h1>批量完善题干</h1>
      <p>
        保留原答案与来源，只填写合适的问题。保存后重新建立学习状态；待完善内容不会进入学习队列。
      </p>
      {pending.map((card) => (
        <section className="candidate-card" key={card.id}>
          <p className="muted">{card.sourceReferences[0]?.label ?? '手工录入'}</p>
          <label>
            待完善题干
            <textarea
              aria-label={`完善题干 ${card.id}`}
              value={changes[card.id]?.question ?? ''}
              onChange={(e) =>
                setChanges({
                  ...changes,
                  [card.id]: {
                    question: e.target.value,
                    expectedRevisionId:
                      changes[card.id]?.expectedRevisionId ?? card.currentRevisionId,
                  },
                })
              }
            />
          </label>
          <details>
            <summary>查看标准答案与来源</summary>
            <p className="preserve-lines">{card.standardAnswer}</p>
          </details>
        </section>
      ))}
      <ErrorNotice message={action.error} />
      <p role="status">{saved ? `已完善 ${saved} 道题` : `共 ${pending.length} 道待完善`}</p>
      <button
        className="button"
        disabled={action.busy || !Object.values(changes).some((c) => c.question.trim())}
        onClick={() =>
          void action.run(async () => {
            setSaved(
              await repository.completePrompts(
                projectId,
                Object.entries(changes)
                  .filter(([, c]) => c.question.trim())
                  .map(([id, c]) => ({ id, ...c })),
              ),
            );
            setChanges({});
          })
        }
      >
        批量保存已填写题干
      </button>
    </>
  );
}
