import { useState } from 'react';
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
import type { Performance, ReviewEvent, StudySession, SubjectiveMastery } from '../domain/models';
import { masteryLabels, performanceLabels } from '../domain/review';
import { repository } from '../persistence/repository';
import { ErrorNotice } from '../components/shared';
import { errorMessage, useAction } from '../components/actions';

export function Study({
  session,
  events,
  projectName,
}: {
  session: StudySession;
  events: ReviewEvent[];
  projectName: string;
}) {
  if (session.status === 'completed') {
    const completed = events.filter((event) => event.sessionId === session.id);
    const skipped = completed.filter((event) => event.assessmentResult === 'skipped').length;
    return (
      <div className="study-complete">
        <span className="complete-icon">
          <CheckCircle2 size={38} />
        </span>
        <div className="eyebrow">SESSION COMPLETE</div>
        <h1>这一轮，完成了。</h1>
        <p>
          完成 {completed.length - skipped} 题，跳过 {skipped} 题。学习记录已保存在本地。
        </p>
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
    <StudyQuestion
      key={`${session.id}:${session.index}`}
      session={session}
      projectName={projectName}
    />
  );
}

function StudyQuestion({ session, projectName }: { session: StudySession; projectName: string }) {
  const item = session.queue[session.index];
  const [mode, setMode] = useState(session.draft.responseMode);
  const [response, setResponse] = useState(session.draft.userResponse);
  const [confidence, setConfidence] = useState(session.draft.confidenceBeforeReveal);
  const [attempted, setAttempted] = useState(session.draft.attemptedBeforeReveal);
  const [mastery, setMastery] = useState<SubjectiveMastery | null>(null);
  const [performance, setPerformance] = useState<Performance>('ungraded');
  const [draftError, setDraftError] = useState('');
  const action = useAction();
  const revealed = session.draft.wasAnswerRevealed;
  const hints = session.draft.hintLevelUsed;
  if (!item) return <ErrorNotice message="学习队列无法读取，请保留数据并重新加载。" />;

  const patch = {
    responseMode: mode,
    userResponse: response,
    confidenceBeforeReveal: confidence,
    attemptedBeforeReveal: attempted,
  };
  // Each patch is merged inside a serialized IndexedDB transaction; a late input write
  // cannot overwrite hints/reveal flags or the next question's draft.
  function persist(value: Parameters<typeof repository.updateDraft>[2]) {
    void repository
      .updateDraft(session.id, session.index, value)
      .then(() => setDraftError(''))
      .catch((cause: unknown) => setDraftError(errorMessage(cause)));
  }
  async function submit(skipped = false) {
    if (!revealed) await repository.updateDraft(session.id, session.index, patch);
    await repository.submitReview(
      session.id,
      session.index,
      skipped ? 'skipped' : performance,
      skipped ? null : mastery,
    );
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
      <section className="question-panel" aria-label="当前题目">
        <div className="question-number">QUESTION {String(session.index + 1).padStart(2, '0')}</div>
        <h2 className="study-question">{item.question}</h2>
        {!revealed && (
          <>
            <div className="mode-switch" role="group" aria-label="作答模式">
              <button
                className={mode === 'quick' ? 'selected' : ''}
                disabled={action.busy}
                onClick={() => {
                  setMode('quick');
                  persist({ responseMode: 'quick' });
                }}
              >
                <MessageCircle size={15} /> 快速回忆
              </button>
              <button
                className={mode === 'typed' ? 'selected' : ''}
                disabled={action.busy}
                onClick={() => {
                  setMode('typed');
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
                  disabled={action.busy}
                  onChange={(event) => {
                    setResponse(event.target.value);
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
                  disabled={action.busy}
                  onClick={() => {
                    setAttempted(!attempted);
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
                disabled={action.busy}
                value={confidence ?? ''}
                onChange={(event) => {
                  const value = event.target.value === '' ? null : Number(event.target.value);
                  setConfidence(value);
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
          </>
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
              disabled={action.busy || hints >= item.hints.length}
              onClick={() =>
                void action.run(async () => {
                  await repository.updateDraft(session.id, session.index, patch, 'hint');
                })
              }
            >
              <Lightbulb size={16} />{' '}
              {item.hints.length ? `查看提示 (${hints}/${item.hints.length})` : '未设置提示'}
            </button>
            <button
              className="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await repository.updateDraft(session.id, session.index, patch, 'reveal');
                })
              }
            >
              <Eye size={16} /> 揭晓答案
            </button>
          </div>
        )}
        {revealed && (
          <>
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
              {item.sourceReferences.length > 0 && (
                <div className="source-note">
                  来源：{item.sourceReferences.map((source) => source.label).join('；')}
                </div>
              )}
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
              <select
                aria-label="自行核对结果"
                value={performance}
                onChange={(event) => setPerformance(event.target.value as Performance)}
              >
                <option value="ungraded">未核对 / 暂不判断</option>
                <option value="correct">{performanceLabels.correct}</option>
                <option value="partially_correct">{performanceLabels.partially_correct}</option>
                <option value="incorrect">{performanceLabels.incorrect}</option>
              </select>
              <h3>这次，你感觉掌握了多少？</h3>
              <p className="muted">主观评价单独记录，不代表客观正确率或记忆概率。</p>
              <div className="mastery-grid" role="radiogroup" aria-label="主观掌握评价">
                {masteryLabels.map((label, index) => (
                  <button
                    key={label}
                    role="radio"
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
                  disabled={mastery === null || action.busy}
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
          </>
        )}
        <ErrorNotice message={action.error || draftError} />
      </section>
      <div className="study-bottom">
        <span>
          已使用 {hints} 条提示 · {revealed ? '答案已揭晓，作答内容已锁定' : '作答与提示保存在本地'}
        </span>
        <button
          className="text-button"
          disabled={action.busy}
          onClick={() => void action.run(() => submit(true))}
        >
          <SkipForward size={14} /> 跳过此题
        </button>
      </div>
    </div>
  );
}
