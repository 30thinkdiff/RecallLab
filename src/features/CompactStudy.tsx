import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Performance, PracticeItem, StudySession } from '../domain/models';
import { StudyDraftController } from './study-draft';
import { repository } from '../persistence/repository';
import { db } from '../persistence/database';
import { useLiveQuery } from 'dexie-react-hooks';
import { exactShort } from '../learning/evidence';
import { AttemptClock } from '../learning/timing';
import { SourceLinks } from './Documents';
import { tokenOf } from '../domain/revisions';
import { useAction } from '../components/actions';
import { ErrorNotice } from '../components/shared';
import { markLabels, type CriterionMark, assessmentResult } from '../domain/assessment';
export function CompactStudy({ session, cards }: { session: StudySession; cards: PracticeItem[] }) {
  const item = session.queue[session.index]!;
  const [controller] = useState(() => new StudyDraftController(session));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [clock] = useState(
    () => new AttemptClock(Date.now(), session.draft.startedAt, session.draft.timing),
  );
  const frozen = useRef(session.draft.wasAnswerRevealed);
  const [override, setOverride] = useState(false),
    [details, setDetails] = useState(false);
  const action = useAction();
  const docs = useLiveQuery(
    () =>
      db.sourceDocuments.bulkGet(
        item.sourceReferences.flatMap((r) => (r.documentId ? [r.documentId] : [])),
      ),
    [item],
  );
  useEffect(() => controller.receive(session), [controller, session]);
  useEffect(() => {
    let lastSave = Date.now();
    const sample = () => {
      if (
        frozen.current ||
        controller.getSnapshot().conflict ||
        controller.getSnapshot().draft.wasAnswerRevealed
      )
        return;
      const now = Date.now();
      clock.environment(now, document.visibilityState === 'visible', document.hasFocus());
      if (
        now - lastSave >= 5000 &&
        document.hasFocus() &&
        document.visibilityState === 'visible' &&
        clock.snapshot(now).attemptedAt
      ) {
        controller.edit({ timing: clock.snapshot(now) });
        lastSave = now;
      }
    };
    const interval = setInterval(sample, 2000);
    const environment = () => {
      if (!frozen.current) {
        clock.environment(Date.now(), document.visibilityState === 'visible', document.hasFocus());
        sample();
      }
    };
    document.addEventListener('visibilitychange', environment);
    window.addEventListener('focus', environment);
    window.addEventListener('blur', environment);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', environment);
      window.removeEventListener('focus', environment);
      window.removeEventListener('blur', environment);
      if (
        !frozen.current &&
        !controller.getSnapshot().conflict &&
        !controller.getSnapshot().draft.wasAnswerRevealed &&
        clock.snapshot(Date.now()).attemptedAt
      )
        controller.edit({ timing: clock.snapshot(Date.now()) });
      controller.dispose();
    };
  }, [clock, controller]);
  const current = cards.find((c) => c.id === item.id);
  const conflict =
    view.conflict ||
    !current ||
    !!current.archivedAt ||
    current.currentRevisionId !== item.revisionId;
  const blocked = action.busy || conflict;
  const revealed = session.draft.wasAnswerRevealed;
  const match = exactShort(item, view.draft.userResponse);
  const sourceReady =
    !!docs &&
    docs.every(
      (d) =>
        d &&
        d.extractionStatus === 'ready' &&
        !d.warnings.length &&
        d.pages.every((p) => p.method !== 'ocr' && p.status === 'ready'),
    );
  const canAuto =
    match &&
    sourceReady &&
    view.draft.hintLevelUsed === 0 &&
    !details &&
    view.draft.assessment?.mode !== 'detailed';
  async function reveal() {
    frozen.current = true;
    controller.edit({ timing: clock.snapshot(Date.now()) });
    try {
      await controller.perform('reveal');
    } catch (e) {
      frozen.current = false;
      throw e;
    }
  }
  async function submit(performance: Performance, automatic = false, issue?: string) {
    if (!frozen.current) {
      frozen.current = true;
      controller.edit({ timing: clock.snapshot(Date.now()) });
    }
    if (
      performance !== 'skipped' &&
      view.draft.assessment &&
      view.draft.assessment.mode !== 'detailed'
    )
      controller.editAssessment({ performance });
    await controller.withCurrent((latest, token) =>
      repository.submitReview(
        latest.id,
        latest.index,
        performance,
        null,
        token,
        view.draft.assessment?.difficulty ?? 'good',
        automatic,
        issue,
      ),
    );
  }
  async function reload() {
    await controller.protectLocal();
    const s = await db.sessions.get(session.id);
    if (!s) throw Error('轮次不存在');
    if (current?.currentRevisionId !== item.revisionId) {
      await repository.syncSession(s.id, s.index, tokenOf(s), { reloadCurrent: true });
      controller.acknowledgeTransition();
    } else await controller.retainAndReload();
  }
  return (
    <section className="study-workspace">
      <div className="study-topline">
        <a href={`#learn/${session.projectId}`}>暂停并返回学习方案</a>
        <span>第{session.index + 1}题 · 简洁学习</span>
      </div>
      <h1>先回忆，再看答案。</h1>
      {(view.draft.timing?.activeMs ?? 0) / 1000 +
        15 +
        (session.reviewPlan?.entries[item.id]?.reason === 'new' ? 45 : 0) >=
        (session.reviewPlan?.remainingBudgetSeconds ?? Infinity) && (
        <p role="status">
          今天的预算已接近用完，可暂停并保留输入。实际耗时可能超过估计；完成当前题后会按剩余时间重新规划。
        </p>
      )}
      <h2>{item.question}</h2>
      <details className="study-context">
        <summary>为什么复习这题 · 时间与预算</summary>
        <p className="muted">
          {session.reviewPlan?.entries[item.id]?.explanation ?? '系统根据当前目标安排'}
          。可随时暂停。
        </p>
        <p className="muted">
          本题已记录活跃作答{Math.floor((view.draft.timing?.activeMs ?? 0) / 1000)}
          秒；当前计划剩余预算约{Math.ceil((session.reviewPlan?.remainingBudgetSeconds ?? 0) / 60)}
          分钟（含本题，属于估算）。
        </p>
        <p className="muted">
          活跃作答只记录本页交互，后台与长时间空闲不计；它不是脑内回忆时间测量。
        </p>
      </details>
      {conflict && (
        <section role="alert">
          <p>题目或另一页面状态已更新，当前输入保留；请载入最新状态后继续。</p>
          <textarea aria-label="本页保留的输入" value={view.draft.userResponse} readOnly />
          <button className="button" onClick={() => void action.run(reload)}>
            保留输入并载入最新
          </button>
        </section>
      )}
      {!revealed ? (
        <>
          <label>
            你的回答
            <textarea
              autoFocus
              aria-label="你的回答"
              rows={5}
              value={view.draft.userResponse}
              disabled={blocked}
              onChange={(e) => {
                clock.interact(Date.now());
                controller.edit({ userResponse: e.target.value, responseMode: 'typed' });
              }}
            />
          </label>
          {view.draft.hintLevelUsed > 0 && (
            <div className="info-note">
              已使用提示：{item.hints.slice(0, view.draft.hintLevelUsed).join('；')}
              。本次不作为独立成功回忆。
            </div>
          )}
          <div className="button-row">
            <button className="button" disabled={blocked} onClick={() => void action.run(reveal)}>
              提交回答
            </button>
            {item.hints.length > 0 && (
              <button
                className="button secondary"
                disabled={blocked || view.draft.hintLevelUsed >= item.hints.length}
                onClick={() =>
                  void action.run(async () => {
                    await controller.perform('hint');
                  })
                }
              >
                需要提示
              </button>
            )}
            <button
              className="text-button"
              disabled={blocked}
              onClick={() => void action.run(reveal)}
            >
              暂时不会，查看答案
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="preserve-lines">
            你的原始回答：{view.draft.userResponse || '未输入，直接查看答案'}
          </p>
          <div className="answer-panel">
            <h3>标准答案</h3>
            <p className="preserve-lines">{item.standardAnswer}</p>
            <SourceLinks sources={item.sourceReferences} />
          </div>
          {canAuto && !override ? (
            <>
              <p role="status">文字核对：与短标准答案一致。不是语义判断，仍可更正。</p>
              <button
                className="button"
                disabled={blocked}
                onClick={() => void action.run(() => submit('correct', true))}
              >
                采用核对反馈并继续
              </button>
              <button className="button subtle" onClick={() => setOverride(true)}>
                更正此次判断
              </button>
            </>
          ) : view.draft.assessment?.mode === 'detailed' ? (
            <p>本次以已填写的逐项核对结果为准；请展开下方详细核对后继续。</p>
          ) : (
            <>
              <p>系统不能确定这次回答是否满足全部必需内容，请快速确认。不匹配不会自动判错。</p>
              <div className="button-row">
                <button
                  className="button"
                  disabled={blocked}
                  onClick={() => void action.run(() => submit('correct'))}
                >
                  全部正确，继续
                </button>
                <button
                  className="button secondary"
                  disabled={blocked}
                  onClick={() => void action.run(() => submit('partially_correct'))}
                >
                  遗漏必需内容，继续
                </button>
                <button
                  className="button secondary"
                  disabled={blocked}
                  onClick={() => void action.run(() => submit('incorrect'))}
                >
                  回答错误，继续
                </button>
                <button
                  className="button subtle"
                  disabled={blocked}
                  onClick={() => void action.run(() => submit('ungraded'))}
                >
                  无法判断，稍后复测
                </button>
              </div>
            </>
          )}
          <details onToggle={(e) => setDetails(e.currentTarget.open)}>
            <summary>详细核对与可选评价</summary>
            <p>
              必需内容遗漏按失败处理；整体人工判断和文字一致都不是系统语义验证。难度默认Good，速度不影响评分。
            </p>
            {item.answerCriteria.map((c, i) => (
              <label key={i}>
                {c}
                <select
                  aria-label={`必需要点 ${i + 1} 核对`}
                  value={view.draft.assessment?.marks[i] ?? 'uncertain'}
                  onChange={(e) => {
                    const marks = item.answerCriteria.map(
                      (_, j) => view.draft.assessment?.marks[j] ?? 'uncertain',
                    );
                    marks[i] = e.target.value as CriterionMark;
                    controller.editAssessment({ mode: 'detailed', marks });
                  }}
                >
                  {Object.entries(markLabels).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {view.draft.assessment?.mode === 'detailed' && (
              <button
                className="button"
                disabled={blocked}
                onClick={() =>
                  void action.run(() => submit(assessmentResult(view.draft.assessment!, item)))
                }
              >
                按逐项结果继续
              </button>
            )}
            <label>
              回忆难度（可选）
              <select
                value={view.draft.assessment?.difficulty ?? 'good'}
                onChange={(e) =>
                  controller.editAssessment({
                    difficulty: e.target.value as 'hard' | 'good' | 'easy',
                  })
                }
              >
                <option value="good">正常（默认）</option>
                <option value="hard">正确但费力</option>
                <option value="easy">正确且轻松</option>
              </select>
            </label>
            <p>不填写主观0—4级也可以学习；详细旧版流程仍可从高级复习使用。</p>
          </details>
        </>
      )}
      <div className="button-row">
        <button
          className="text-button"
          disabled={blocked}
          onClick={() => void action.run(() => submit('skipped'))}
        >
          跳过，稍后再学
        </button>
        <button
          className="text-button"
          disabled={blocked}
          onClick={() => void action.run(() => submit('skipped', false, '题目或标准答案需要核对'))}
        >
          题目有问题，暂不学习
        </button>
      </div>
      <ErrorNotice message={action.error || view.error} />
      <p className="muted">{view.pending ? '正在保存草稿…' : '草稿保存在本机，可随时暂停'}</p>
    </section>
  );
}
