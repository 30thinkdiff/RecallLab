import { useLiveQuery } from 'dexie-react-hooks';
import { CompactStudy } from './CompactStudy';
import {
  freshAssessment,
  assessmentResult,
  markLabels,
  type CriterionMark,
  type AssessmentDraft,
} from '../domain/assessment';
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Lightbulb,
  Eye,
  Keyboard,
  MessageCircle,
  SkipForward,
} from 'lucide-react';
import type {
  Performance,
  ReviewEvent,
  StudySession,
  SubjectiveMastery,
  PracticeItem,
} from '../domain/models';
import { masteryLabels, performanceLabels } from '../domain/review';
import { repository } from '../persistence/repository';
import { ErrorNotice } from '../components/shared';
import { useAction } from '../components/actions';
import { tokenOf } from '../domain/revisions';
import { StudyDraftController } from './study-draft';
import { SourceLinks } from './Documents';
import { SessionControls } from './SessionControls';
import type { Difficulty, ReviewDecision } from '../scheduling/types';
import { reasonLabels, gradeLabels } from '../scheduling/policy';
import { dateTime } from '../components/actions';
import { downloadJson } from '../persistence/backup';

export function Study({
  session,
  events,
  projectName,
  cards,
}: {
  session: StudySession;
  events: ReviewEvent[];
  projectName: string;
  cards: PracticeItem[];
}) {
  const retained = useLiveQuery(
    () => repository.db.draftRecoveries.where('sessionId').equals(session.id).count(),
    [session.id],
  );
  const last = events
    .filter((e) => e.sessionId === session.id && e.queueIndex < session.index)
    .sort((a, b) => a.queueIndex - b.queueIndex)
    .slice(-1)[0]?.scheduling;
  if (session.status !== 'active') {
    const completed = events.filter((event) => event.sessionId === session.id);
    const skipped = completed.filter((event) => event.assessmentResult === 'skipped').length;
    return (
      <div className="study-complete">
        <span className="complete-icon">
          <CheckCircle2 size={38} />
        </span>
        <div className="eyebrow">SESSION COMPLETE</div>
        <h1>{session.status === 'ended' ? '本轮已结束。' : '这一轮，完成了。'}</h1>
        <p>
          完成 {completed.length - skipped} 题，跳过 {skipped} 题。学习记录已保存在本地。
        </p>
        {last && <DecisionFeedback decision={last} />}
        {session.reviewPlan && (
          <a
            className="button"
            href={session.reviewPlan.adaptive ? `#learn/${session.projectId}` : '#daily'}
          >
            查看今日复习与下次到期
          </a>
        )}
        <div className="completion-note">
          花一点时间回想：哪些内容还需要下一次独立回忆？
          <br />
          主观熟悉感并不等于经过验证的长期记忆。
        </div>
        <div className="button-row">
          <a className="button" href={`#project/${session.projectId}`}>
            返回题库 <ArrowRight size={16} />
          </a>
          <a className="button secondary" href="#history">
            查看学习记录
          </a>
        </div>
      </div>
    );
  }
  return (
    <>
      {last && <DecisionFeedback decision={last} />}
      {session.reviewPlan?.compact && !!retained && (
        <p role="status">
          该轮次已保护{retained}份未提交草稿，可在<a href={`#project/${session.projectId}`}>题库</a>
          的对应题目详情查看。
        </p>
      )}
      {session.reviewPlan?.compact ? (
        <CompactStudy
          key={`${session.id}:${session.index}:${session.queue[session.index]?.revisionId}`}
          session={session}
          cards={cards}
        />
      ) : (
        <StudyQuestion
          key={`${session.id}:${session.index}:${session.queue[session.index]?.revisionId}`}
          session={session}
          projectName={projectName}
          cards={cards}
        />
      )}
    </>
  );
}

function StudyQuestion({
  session,
  projectName,
  cards,
}: {
  session: StudySession;
  projectName: string;
  cards: PracticeItem[];
}) {
  const item = session.queue[session.index];
  const [controller] = useState(() => new StudyDraftController(session));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    controller.receive(session);
  }, [controller, session]);
  useEffect(() => () => controller.dispose(), [controller]);
  const {
    responseMode: mode,
    userResponse: response,
    confidenceBeforeReveal: confidence,
    attemptedBeforeReveal: attempted,
  } = view.draft;
  const assessment = view.draft.assessment ?? freshAssessment();
  const { mastery, difficulty } = assessment;
  const setMastery = (value: SubjectiveMastery) => controller.editAssessment({ mastery: value });
  const setDifficulty = (value: Difficulty) => controller.editAssessment({ difficulty: value });
  const setPerformance = (value: Performance) =>
    controller.editAssessment({ performance: value as AssessmentDraft['performance'] });
  const action = useAction();
  const revealed = session.draft.wasAnswerRevealed;
  const hints = session.draft.hintLevelUsed;
  if (!item) return <ErrorNotice message="学习队列无法读取，请保留数据并重新加载。" />;

  const performance = assessmentResult(assessment, item);
  const current = cards.find((card) => card.id === item.id);
  const contentConflict =
    !current || !!current.archivedAt || current.currentRevisionId !== item.revisionId;
  const blocked = action.busy || contentConflict || view.conflict;
  const persist = (patch: Parameters<StudyDraftController['edit']>[0]) => controller.edit(patch);
  async function submit(skipped = false) {
    await controller.withCurrent((latest, token) =>
      repository.submitReview(
        latest.id,
        latest.index,
        skipped ? 'skipped' : performance,
        skipped ? null : mastery,
        token,
        difficulty,
      ),
    );
  }
  async function reloadContent() {
    await controller.protectLocal();
    const latest = await repository.db.sessions.get(session.id);
    if (!latest) throw new Error('轮次不存在');
    await repository.syncSession(latest.id, latest.index, tokenOf(latest), { reloadCurrent: true });
    controller.acknowledgeTransition();
  }
  return (
    <div className="study-workspace">
      <div className="study-topline">
        <a href={`#project/${session.projectId}`} className="text-link">
          <ArrowLeft size={15} /> 返回题库
        </a>
        <span>{projectName}</span>
        <span>
          第 {session.index + 1} / {session.queue.length} 题
        </span>
      </div>
      <progress
        className="study-progress"
        value={session.index}
        max={session.queue.length}
        aria-label="本轮已完成题目"
      />
      <div className="study-heading">
        <div>
          <div className="eyebrow">A MOMENT TO REMEMBER</div>
          <h1>先回忆，再看答案。</h1>
        </div>
        <span className="tag">主动回忆</span>
      </div>
      {session.reviewPlan && (
        <section className="info-note" aria-label="复习安排说明">
          <p>
            {
              {
                due: '本题已到复习日',
                retest: '提示或揭晓后的无提示复测',
                new: '尚未建立可靠调度的新知识',
                focus: '你设置的重点题目，提前练习',
                practice: '临时练习',
              }[session.reviewPlan.entries[item.id]?.reason ?? 'practice']
            }{' '}
            ·{' '}
            {session.reviewPlan.entries[item.id]?.canSchedule
              ? '符合条件的评价将用于间隔安排'
              : '本次不更新长期记忆状态'}
          </p>
          <p>正确需满足全部必需内容；遗漏必需内容按失败处理。0–4 主观感受不决定调度评分。</p>
        </section>
      )}
      <SessionControls session={session} cards={cards} controller={controller} />
      {(contentConflict || view.conflict) && (
        <section className="conflict-panel" role="alert">
          <h2>
            {contentConflict
              ? current?.archivedAt
                ? '当前题目已归档'
                : '当前题目已更新'
              : '另一页面已更新草稿'}
          </h2>
          <p>已暂停旧状态的揭晓和评分。本页输入保留，不能静默覆盖其他页面或记入新版本。</p>
          <label>
            本页保留的输入
            <textarea readOnly value={response} rows={3} />
          </label>
          <div className="button-row">
            <button
              className="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  contentConflict ? reloadContent : () => controller.retainAndReload(),
                )
              }
            >
              {contentConflict
                ? current?.archivedAt
                  ? '保留输入并移除归档题'
                  : '保留输入并载入最新版'
                : '保留本页输入并载入最新草稿'}
            </button>
            <button
              className="button secondary"
              onClick={() =>
                downloadJson(
                  { question: item.question, revision: item.revision, draft: view.draft },
                  'RecallLab-local-draft.json',
                )
              }
            >
              下载本页输入副本
            </button>
          </div>
        </section>
      )}
      <p className="muted" role="status" data-testid="draft-status">
        {view.conflict
          ? '本页输入尚未合并，请处理冲突'
          : view.pending
            ? '正在保存草稿…'
            : '草稿已保存'}{' '}
        · 当前修订 {item.revision}
      </p>
      <section className="question-panel" aria-label="当前题目">
        <div className="question-number">QUESTION {String(session.index + 1).padStart(2, '0')}</div>
        <h2 className="study-question">{item.question}</h2>
        {!revealed && (
          <Fragment key="recall-input">
            <div className="mode-switch" role="group" aria-label="作答模式">
              <button
                className={mode === 'quick' ? 'selected' : ''}
                disabled={blocked}
                onClick={() => {
                  persist({ responseMode: 'quick' });
                }}
              >
                <MessageCircle size={15} /> 快速回忆
              </button>
              <button
                className={mode === 'typed' ? 'selected' : ''}
                disabled={blocked}
                onClick={() => {
                  persist({ responseMode: 'typed' });
                }}
              >
                <Keyboard size={15} /> 输入作答
              </button>
            </div>
            {mode === 'typed' ? (
              <label className="answer-input-label">
                你的回答
                <textarea
                  autoFocus
                  value={response}
                  rows={6}
                  maxLength={20000}
                  disabled={blocked}
                  onChange={(event) => {
                    persist({ userResponse: event.target.value });
                  }}
                  placeholder="先试着写下来，不必担心不完整…"
                />
                <small>输入自动保存在当前浏览器；核对方式为人工自行核对。</small>
              </label>
            ) : (
              <div className="recall-space">
                <MessageCircle size={26} strokeWidth={1.3} />
                <p>在脑中回想，或试着说出你的答案。</p>
                <button
                  className={attempted ? 'button soft' : 'button secondary'}
                  disabled={blocked}
                  onClick={() => {
                    persist({ attemptedBeforeReveal: !attempted });
                  }}
                >
                  {attempted ? (
                    <>
                      <Check size={16} /> 已记录回忆尝试
                    </>
                  ) : (
                    '我已尝试回忆'
                  )}
                </button>
              </div>
            )}
            <label className="confidence-label">
              揭晓前的信心 <span>可选</span>
              <select
                aria-label="揭晓前的信心"
                disabled={blocked}
                value={confidence ?? ''}
                onChange={(event) => {
                  const value = event.target.value === '' ? null : Number(event.target.value);
                  persist({ confidenceBeforeReveal: value });
                }}
              >
                <option value="">暂不填写</option>
                {masteryLabels.map((label, index) => (
                  <option key={label} value={index}>
                    {index} · {label}
                  </option>
                ))}
              </select>
            </label>
          </Fragment>
        )}
        {hints > 0 && (
          <div className="hint-panel">
            <strong>
              <Lightbulb size={16} /> 已使用的提示
            </strong>
            <ol>
              {item.hints.slice(0, hints).map((hint, index) => (
                <li key={index}>{hint}</li>
              ))}
            </ol>
          </div>
        )}
        {!revealed && (
          <div className="question-actions">
            <button
              className="button secondary"
              disabled={blocked || hints >= item.hints.length}
              onClick={() =>
                void action.run(async () => {
                  await controller.perform('hint');
                })
              }
            >
              <Lightbulb size={16} />{' '}
              {item.hints.length ? `查看提示 (${hints}/${item.hints.length})` : '未设置提示'}
            </button>
            <button
              className="button"
              disabled={blocked}
              onClick={() =>
                void action.run(async () => {
                  await controller.perform('reveal');
                })
              }
            >
              <Eye size={16} /> 揭晓答案
            </button>
          </div>
        )}
        {revealed && (
          <Fragment key="answer-assessment">
            {session.draft.responseMode === 'typed' && (
              <div className="original-response">
                <span className="section-kicker">你的原始回答</span>
                <p className="preserve-lines">
                  {session.draft.userResponse || '（未输入，直接揭晓答案）'}
                </p>
              </div>
            )}
            <div className="answer-panel">
              <span className="section-kicker">标准答案 · 手工录入</span>
              <p className="preserve-lines">{item.standardAnswer}</p>
              {item.answerCriteria.length > 0 && (
                <>
                  <h3>核对要点</h3>
                  <ul>
                    {item.answerCriteria.map((criterion, index) => (
                      <li key={index}>{criterion}</li>
                    ))}
                  </ul>
                </>
              )}
              {item.sourceReferences.length > 0 && <SourceLinks sources={item.sourceReferences} />}
              {item.mnemonics && (
                <p className="supplement preserve-lines">
                  <strong>助记技巧</strong>
                  {item.mnemonics}
                </p>
              )}
              {item.confusionWarnings && (
                <p className="supplement preserve-lines">
                  <strong>易混提醒</strong>
                  {item.confusionWarnings}
                </p>
              )}
            </div>
            <div className="assessment-panel">
              <div className="assessment-label">
                <h3>自行核对结果</h3>
                <span>
                  {session.draft.responseMode === 'quick'
                    ? '仅作为自评证据'
                    : '保存原回答，由你人工核对'}
                </span>
              </div>
              {item.answerCriteria.length > 0 && (
                <label>
                  核对方式
                  <select
                    aria-label="核对方式"
                    disabled={blocked}
                    value={assessment.mode}
                    onChange={(e) =>
                      controller.editAssessment({
                        mode: e.target.value as AssessmentDraft['mode'],
                        performance: 'ungraded',
                        marks:
                          assessment.marks.length === item.answerCriteria.length
                            ? assessment.marks
                            : item.answerCriteria.map(() => 'uncertain'),
                      })
                    }
                  >
                    <option value="simple">简洁核对（整体人工判断）</option>
                    <option value="detailed">逐项核对全部必需要点</option>
                  </select>
                </label>
              )}
              {assessment.mode === 'detailed' ? (
                <div aria-label="逐项人工核对">
                  <p className="muted">每项均由你人工核对，系统只汇总标记，不自动理解答案。</p>
                  {item.answerCriteria.map((criterion, index) => (
                    <label key={index}>
                      {index + 1}. {criterion}
                      <select
                        aria-label={`必需要点 ${index + 1} 核对`}
                        disabled={blocked}
                        value={assessment.marks[index] ?? 'uncertain'}
                        onChange={(e) => {
                          const marks = [...assessment.marks];
                          marks[index] = e.target.value as CriterionMark;
                          controller.editAssessment({ marks });
                        }}
                      >
                        {Object.entries(markLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <p role="status">
                    要点汇总：{performanceLabels[performance]}
                    。全部必需项确认正确才可通过；遗漏/错误按完整回忆失败，无法确认不冒充正确。
                  </p>
                </div>
              ) : (
                <select
                  aria-label="自行核对结果"
                  disabled={blocked}
                  value={performance}
                  onChange={(event) => setPerformance(event.target.value as Performance)}
                >
                  <option value="ungraded">未核对 / 暂不判断</option>
                  <option value="correct">
                    {session.reviewPlan ? '正确（必需内容全部满足）' : performanceLabels.correct}
                  </option>
                  <option value="partially_correct">{performanceLabels.partially_correct}</option>
                  <option value="incorrect">{performanceLabels.incorrect}</option>
                </select>
              )}
              {assessment.mode === 'simple' && (
                <p className="muted">
                  这是整体人工判断；选择正确表示你已核对全部必需内容。主观掌握感不能替代核对。
                </p>
              )}
              {session.reviewPlan &&
                performance === 'correct' &&
                hints === 0 &&
                (mode === 'typed' ? !!response.trim() : attempted) && (
                  <label>
                    独立回忆难度
                    <select
                      aria-label="独立回忆难度"
                      disabled={blocked}
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                    >
                      <option value="hard">正确但费力（Hard）</option>
                      <option value="good">正常难度（Good，默认）</option>
                      <option value="easy">正确且轻松（Easy）</option>
                    </select>
                  </label>
                )}
              {session.reviewPlan && (
                <p className="muted">
                  {mode === 'quick'
                    ? '口头回忆成绩来自你的自报，不是系统客观验证。'
                    : '保存原始回答，由你人工核对；系统未自动评分。'}
                  有提示、直接揭晓、跳过或未核对，都不会成为正常成功回忆。
                </p>
              )}
              <h3>这次，你感觉掌握了多少？</h3>
              <p className="muted">主观评价单独记录，不代表客观正确率或记忆概率。</p>
              <div className="mastery-grid" role="radiogroup" aria-label="主观掌握评价">
                {masteryLabels.map((label, index) => (
                  <button
                    key={label}
                    role="radio"
                    disabled={blocked}
                    aria-checked={mastery === index}
                    className={mastery === index ? 'mastery-option selected' : 'mastery-option'}
                    onClick={() => setMastery(index as SubjectiveMastery)}
                  >
                    <b>{index}</b>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="assessment-footer">
                <span className="muted">
                  {mastery === null
                    ? '请选择一项主观评价后保存。'
                    : `已选：${masteryLabels[mastery]}`}
                </span>
                <button
                  className="button"
                  disabled={mastery === null || blocked}
                  onClick={() => void action.run(() => submit())}
                >
                  {action.busy
                    ? '保存中…'
                    : session.index + 1 === session.queue.length
                      ? '保存并完成本轮'
                      : '保存并下一题'}
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>
          </Fragment>
        )}
        <ErrorNotice message={action.error || view.error} />
      </section>
      <div className="study-bottom">
        <span>
          已使用 {hints} 条提示 · {revealed ? '答案已揭晓，作答内容已锁定' : '作答与提示保存在本地'}
        </span>
        <button
          className="text-button"
          disabled={blocked}
          onClick={() => void action.run(() => submit(true))}
        >
          <SkipForward size={14} /> 跳过此题
        </button>
      </div>
    </div>
  );
}

function DecisionFeedback({ decision }: { decision: ReviewDecision }) {
  return (
    <section className="info-note" aria-label="本次复习结果">
      <p>{reasonLabels[decision.reason]}。</p>
      <p>
        {decision.grade === null ? '未更新 FSRS 长期状态' : gradeLabels[decision.grade]}
        {decision.nextDue ? ` · 下次到期：${dateTime(decision.nextDue)}` : ''}
        {decision.retestDue ? ` · 无提示复测：${dateTime(decision.retestDue)}` : ''}
      </p>
      {decision.grade !== null && (
        <small>间隔按揭晓时保留的回忆证据安排，稍后保存不会额外延长。</small>
      )}
      <small>
        {decision.source === 'deterministic'
          ? '来源：短答案文字一致核对，不是语义验证'
          : decision.source === 'self_report'
            ? '来源：用户自报'
            : decision.source === 'user_checked'
              ? '来源：保留作答后的人工核对'
              : '没有客观核验结果'}
      </small>
    </section>
  );
}
