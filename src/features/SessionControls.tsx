import { useState } from 'react';
import type { PracticeItem, StudySession } from '../domain/models';
import { tokenOf } from '../domain/revisions';
import { repository } from '../persistence/repository';
import { ConfirmDialog, ErrorNotice } from '../components/shared';
import { useAction } from '../components/actions';
import type { StudyDraftController } from './study-draft';

export function SessionControls({
  session,
  cards,
  controller,
}: {
  session: StudySession;
  cards: PracticeItem[];
  controller?: StudyDraftController;
}) {
  const action = useAction();
  const [confirm, setConfirm] = useState<'end' | 'restart' | null>(null);
  const [deferred, setDeferred] = useState(false);
  const planned = new Set(session.queue.map((snapshot) => snapshot.id));
  const added = session.reviewPlan
    ? []
    : cards.filter(
        (card) => card.projectId === session.projectId && !card.archivedAt && !planned.has(card.id),
      );
  async function sync(includeNew: boolean) {
    if (controller) await controller.synchronize(includeNew);
    else await repository.syncSession(session.id, session.index, tokenOf(session), { includeNew });
  }
  async function finish(restart: boolean) {
    await controller?.protectLocal();
    const latest = await repository.db.sessions.get(session.id);
    if (!latest || latest.status !== 'active') throw new Error('本轮已结束，请查看最新状态');
    if (restart) {
      const id = await repository.restartSession(latest.id, latest.index, tokenOf(latest));
      location.hash = `study/${id}`;
    } else await repository.endSession(latest.id, latest.index, tokenOf(latest));
    controller?.acknowledgeTransition();
  }
  return (
    <section className="session-controls" aria-label="本轮管理">
      {added.length > 0 && (
        <div className="queue-notice">
          <span>
            题库新增 {added.length} 道题。
            {deferred ? '已选择下轮再学，本轮题量不变。' : '是否加入本轮剩余练习？'}
          </span>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() => void action.run(() => sync(true))}
            >
              加入本轮剩余练习
            </button>
            <button className="text-button" onClick={() => setDeferred(true)}>
              下轮再学
            </button>
          </div>
        </div>
      )}
      <div className="button-row">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={() => void action.run(() => sync(false))}
        >
          更新本轮题目
        </button>
        <button className="button secondary" onClick={() => setConfirm('end')}>
          结束当前轮次
        </button>
        {!session.reviewPlan && (
          <button className="text-button" onClick={() => setConfirm('restart')}>
            重新开始一轮
          </button>
        )}
        {session.reviewPlan && (
          <a className="text-link" href="#daily">
            暂停并返回今日复习
          </a>
        )}
      </div>
      <details className="remaining-list">
        <summary>查看本轮剩余题目（{session.queue.length - session.index}）</summary>
        <ol>
          {session.queue.slice(session.index).map((snapshot, index) => {
            const item = cards.find((card) => card.id === snapshot.id);
            return (
              <li key={`${snapshot.id}:${index}`}>
                {snapshot.question}{' '}
                <span className="muted">
                  修订 {snapshot.revision}
                  {item?.archivedAt
                    ? ' · 已归档，将移除'
                    : item?.revision !== snapshot.revision
                      ? ` · 可更新至 ${item?.revision}`
                      : ''}
                </span>
              </li>
            );
          })}
        </ol>
      </details>
      <ErrorNotice message={action.error} />
      {confirm && (
        <ConfirmDialog
          title={confirm === 'end' ? '结束当前轮次' : '重新开始一轮'}
          confirmLabel={confirm === 'end' ? '确认结束本轮' : '确认重新开始'}
          description="已完成的学习事件全部保留。当前未提交作答会另存为暂存副本，不生成答错或跳过记录。重新开始只建立新轮次，不重置历史或学习状态。"
          onClose={() => setConfirm(null)}
          onConfirm={() => finish(confirm === 'restart')}
        />
      )}
    </section>
  );
}
