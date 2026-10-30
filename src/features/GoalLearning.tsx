import { nextReviewAt } from '../learning/progress';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
import { useReviewData, useReviewClock } from './review-data';
import { forecastGoal } from '../learning/adaptive';
import { calibrationReport } from '../learning/calibration';
import { scheduleService, NoReviewWorkError } from '../scheduling/service';
import { repository } from '../persistence/repository';
import { objectiveLabels, type LearningObjective } from '../ai/protocol';
import { useAction, dateTime } from '../components/actions';
import { ErrorNotice } from '../components/shared';
import type { LearningProject, StudySession } from '../domain/models';
export function LearningHome({
  projects,
  sessions,
  onCreate,
}: {
  projects: LearningProject[];
  sessions: StudySession[];
  onCreate: () => void;
}) {
  const action = useAction();
  const total = useLiveQuery(() => db.practiceItems.count(), []);
  const historyCount = useLiveQuery(() => db.reviewEvents.count(), []);
  const active = sessions.find((s) => s.status === 'active' && s.reviewPlan?.adaptive);
  const next =
    projects.find((p) => p.id === active?.projectId) ??
    [...projects].sort(
      (a, b) =>
        (b.priority ?? 2) - (a.priority ?? 2) ||
        (a.targetDate || '9999').localeCompare(b.targetDate || '9999'),
    )[0];
  return (
    <>
      <h1>让每一次回忆，都有收获。</h1>
      <p className="page-intro">
        给出资料、目标和每天可用时间，系统安排练习。你负责回忆，遇到不准确的内容随时更正。
      </p>
      <div className="button-row">
        <a className="button" href="#import-task">
          创建学习任务
        </a>
        {next && (
          <button
            className="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                if (!next.automaticGoal) {
                  window.location.assign(`#learn/${next.id}`);
                  return;
                }
                try {
                  window.location.assign(
                    `#study/${await scheduleService.start(next.id, { adaptive: true })}`,
                  );
                } catch (error) {
                  if (error instanceof NoReviewWorkError)
                    window.location.assign(`#learn/${next.id}`);
                  else throw error;
                }
              })
            }
          >
            继续今天的学习
          </button>
        )}
        <button className="button secondary" onClick={onCreate}>
          创建项目
        </button>
      </div>
      <ErrorNotice message={action.error} />
      <section className="question-panel">
        <h2>学习进展</h2>
        <p>
          {projects.length} 个项目 · {total ?? 0} 道题 · {historyCount ?? 0}{' '}
          条实际练习记录。记录数量不代表掌握率。
        </p>
        {projects.map((p) => (
          <div className="review-item" key={p.id}>
            <strong>{p.name}</strong>
            <p>
              每天最多 {p.dailyTimeBudget} 分钟 ·{' '}
              {p.targetDate ? `目标 ${p.targetDate}` : '尚未设置期限'}
            </p>
            <a className="button secondary" href={`#learn/${p.id}`}>
              查看目标与系统建议
            </a>{' '}
            <a className="text-link" href={`#project/${p.id}`}>
              管理题库
            </a>
          </div>
        ))}
        {!projects.length && <p>先导入资料，也可手动创建项目。没有AI仍可规划和复习。</p>}
      </section>
      <details>
        <summary>高级功能</summary>
        <a href="#overview">完整学习统计</a> · <a href="#backup">备份与恢复</a> ·{' '}
        <a href="#ai-drafts">AI整理草稿</a>
      </details>
    </>
  );
}
export function GoalLearning({ projectId }: { projectId?: string }) {
  const data = useReviewData(projectId, true),
    now = useReviewClock();
  if (!data) return <p role="status">正在计算学习建议…</p>;
  const project =
    data.projects.find((p) => p.id === projectId) ??
    [...data.projects].sort(
      (a, b) =>
        (b.priority ?? 2) - (a.priority ?? 2) ||
        (a.targetDate || '9999').localeCompare(b.targetDate || '9999'),
    )[0];
  if (!project)
    return (
      <>
        <h1>创建学习任务</h1>
        <p>先导入一份资料，再设置目标与时间。</p>
        <a className="button" href="#import-task">
          导入资料
        </a>
      </>
    );
  return <GoalPanel key={project.id} project={project} data={data} now={now} />;
}
function GoalPanel({
  project,
  data,
  now,
}: {
  project: LearningProject;
  data: NonNullable<ReturnType<typeof useReviewData>>;
  now: Date;
}) {
  const [date, setDate] = useState(project.targetDate),
    [minutes, setMinutes] = useState(project.dailyTimeBudget),
    [objective, setObjective] = useState<LearningObjective>(
      project.automaticGoal?.objective ?? 'exam',
    ),
    [section, setSection] = useState(project.automaticGoal?.sectionId ?? ''),
    [limit, setLimit] = useState(project.automaticGoal?.dailyNewLimit?.toString() ?? ''),
    [base, setBase] = useState(project.updatedAt);
  const action = useAction(),
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const preview = {
    ...project,
    targetDate: date,
    dailyTimeBudget: Math.min(1440, Math.max(1, minutes || 1)),
    automaticGoal: {
      version: 'goal-v1' as const,
      objective,
      ...(section ? { sectionId: section } : {}),
      ...(limit !== '' ? { dailyNewLimit: Number(limit) } : {}),
    },
  };
  const plan = forecastGoal(preview, data.cards, data.memories, data.events, now, tz);
  const calibration = calibrationReport(data.cards, data.events, data.logs);
  const active = data.sessions.find(
    (s) => s.projectId === project.id && s.status === 'active' && s.reviewPlan,
  );
  const stale = base !== project.updatedAt;
  const sections = data.documents.flatMap((d) =>
    d.sections.map((s) => ({ ...s, filename: d.filename })),
  );
  async function saveGoal() {
    const p = await scheduleService.configureGoal(
      project.id,
      { targetDate: date, dailyTimeBudget: minutes, automaticGoal: preview.automaticGoal },
      base,
    );
    setBase(p.updatedAt);
  }
  async function start() {
    const same =
      project.targetDate === date &&
      project.dailyTimeBudget === minutes &&
      JSON.stringify(project.automaticGoal) === JSON.stringify(preview.automaticGoal);
    if (!same) {
      const updated = await scheduleService.configureGoal(
        project.id,
        { targetDate: date, dailyTimeBudget: minutes, automaticGoal: preview.automaticGoal },
        base,
      );
      setBase(updated.updatedAt);
    }
    window.location.assign(`#study/${await scheduleService.start(project.id, { adaptive: true })}`);
  }
  const nextDue = nextReviewAt(preview, data.cards, data.memories, data.events, now);
  return (
    <>
      <h1>目标与自动学习方案</h1>
      <p className="page-intro">
        {project.name}：系统安排新题、复习和补救，不需要逐题设置次数。建议会随实际进度更新。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(start);
        }}
      >
        <div className="form-grid">
          <label>
            学习目标
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value as LearningObjective)}
            >
              {Object.entries(objectiveLabels).map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标日期
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            每天最多学习时间（分钟）
            <input
              type="number"
              min={1}
              max={1440}
              required
              value={minutes}
              onChange={(e) => setMinutes(e.target.valueAsNumber)}
            />
          </label>
        </div>
        <p className="muted">
          按目标日期前的完整学习日估算，不计目标日。没有期限时显示未来14天的滚动情景，不保证考试结果。
        </p>
        {stale && (
          <section role="alert">
            <p>目标已在另一页面修改，本页内容保留。</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setDate(project.targetDate);
                setMinutes(project.dailyTimeBudget);
                setObjective(project.automaticGoal?.objective ?? 'exam');
                setSection(project.automaticGoal?.sectionId ?? '');
                setLimit(project.automaticGoal?.dailyNewLimit?.toString() ?? '');
                setBase(project.updatedAt);
              }}
            >
              载入最新目标
            </button>
          </section>
        )}
        <section className="question-panel" aria-label="自动规划建议">
          <h2>系统建议</h2>
          <p>
            范围内可学习 {plan.ready} 道 · 待完善 {plan.qualityPending} 道 · 范围外{' '}
            {plan.outsideScope} 道 · 已尝试覆盖 {plan.covered} 道（不代表掌握）。
          </p>
          {plan.pending > 0 && <p>待完善和范围外内容不计入以下工作量，不能视为已覆盖全部资料。</p>}
          <p>
            今天建议 {plan.selected.length} 道，预计 {Math.ceil(plan.estimatedSeconds / 60)}{' '}
            分钟；估算剩余预算 {plan.budgetRemaining} 分钟。到期 {plan.due}，待无提示复测{' '}
            {plan.retest}，未学习 {plan.newCount}。
          </p>
          {plan.status === 'expired' ? (
            <p role="status">目标日期已到或已过，不能承诺按时完成。可以继续复习并调整期限。</p>
          ) : plan.gapMinutes > 0 ? (
            <p role="status">
              目标可能超出时间：工作量情景比可用时间多约 {plan.gapMinutes} 分钟，建议每天约{' '}
              {plan.suggestedDailyMinutes} 分钟，或缩小范围/延长期限。此估计有较大不确定性。
            </p>
          ) : (
            <p role="status">
              当前情景可容纳预计工作量，仍需持续核对实际速度；不保证全部掌握或考试通过。
            </p>
          )}
          <details>
            <summary>查看工作量依据与不确定性</summary>{' '}
            <p>
              本次引入新题{plan.selected.filter((r) => r.fresh).length}
              道；新题与复习、补救共享每天预算，后续按实际反馈重排。
            </p>
            <p>
              {plan.selected.filter((r) => r.estimateSource === 'observed').length
                ? '部分耗时参考合格的本机活跃作答样本，仍不是专注时间测量。'
                : '尚无足够合格耗时样本，按题长与必需要点使用通用估计。'}
            </p>
            <p>
              最低覆盖/已到期工作约{plan.minimumMinutes}分钟；加入后续复习约{plan.expectedMinutes}
              分钟，另留约{plan.remedyMinutes}分钟补救余量；当前{plan.horizon}个学习日共约
              {plan.availableMinutes}分钟可用。后续次数是情景规则，不是确定的未来复习结果。
            </p>
            <p>
              今日记录活跃作答{plan.recordedActiveSeconds}
              秒；预算还包括估算的核对/新知识阅读环节。后台、长时间空闲不算真实作答，不用速度判断记住或忘记。
            </p>
          </details>
          {plan.budgetExhausted && (
            <p role="status">
              今日预算已用完，进度与草稿保留，下个学习日会重新安排。也可明确增加今天预算或从高级入口临时练习。
            </p>
          )}
          {plan.delayed > 0 && (
            <p>{plan.delayed}道近期失败/提示题等待至少10分钟后无提示复测，刚看完答案不算掌握。</p>
          )}
          {plan.attention > 0 && (
            <p>{plan.attention}道今天反复失败，暂停自动重复；建议对照来源、检查要点或拆小任务。</p>
          )}
          {plan.unfit > 0 && <p>{plan.unfit}道预计单题耗时超过剩余预算，需要增加时间或拆分。</p>}
          {active && <p>当前题目及草稿保留；完成后按最新目标更新剩余任务。</p>}
          {active?.reviewPlan?.practiceOnly && (
            <p>上次是临时练习，继续时不更新长期记忆；完成这轮后再开始正式自动计划。</p>
          )}
          {data.cards.some((c) =>
            c.sourceReferences.some((r) =>
              data.documents.some(
                (d) =>
                  d.id === r.documentId &&
                  (d.extractionStatus !== 'ready' ||
                    d.warnings.length > 0 ||
                    d.pages.some((p) => p.method === 'ocr')),
              ),
            ),
          ) && <p>部分来源含OCR或解析提醒，需要结合原文人工核对，不能自动当作已验证文字。</p>}
          <ErrorNotice message={action.error} />
          <button
            type="button"
            className="button secondary"
            disabled={action.busy || stale}
            onClick={() => void action.run(saveGoal)}
          >
            保存目标
          </button>
          <button
            className="button"
            type="submit"
            disabled={action.busy || stale || (!active && !plan.selected.length)}
          >
            {active ? '继续上次学习' : '自动安排并开始学习'}
          </button>
          {!plan.selected.length && !plan.budgetExhausted && nextDue && (
            <p>
              下一次可能的复习时间：{dateTime(new Date(nextDue).toISOString())}
              。到点后重新计算，不强制提前练习。
            </p>
          )}
          <details>
            <summary>调整范围与高级设置</summary>
            <label>
              学习章节
              <select value={section} onChange={(e) => setSection(e.target.value)}>
                <option value="">全部项目内容</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.filename} · {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              每日新题上限（留空由系统安排）
              <input
                type="number"
                min={0}
                max={1000}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
            <p>
              重要题目可在“今日复习”的高级管理中标记。默认优先补救、逾期及期限内覆盖，不会反复刷未到期强项。
            </p>
            <a href={`#daily/${project.id}`}>高级复习与重点管理</a> ·{' '}
            <a href={`#project/${project.id}`}>手动题库与完整轮次</a>
          </details>
          <details>
            <summary>查看本次推荐及原因</summary>
            <ol>
              {plan.selected.map((r) => (
                <li key={r.item.id}>
                  {r.item.question} · 约{r.estimatedSeconds}秒 · {r.explanation}
                  {r.canSchedule ? '' : ' · 不更新长期状态'}
                </li>
              ))}
            </ol>
          </details>
        </section>
      </form>
      {plan.pending > 0 && (
        <p>
          <a href={`#pending/${project.id}`}>处理待核对内容</a> ·{' '}
          <a href={`#quality/${project.id}`}>检查题目质量</a>
        </p>
      )}
      {data.cards
        .filter((c) => c.projectId === project.id && c.learningIssue)
        .map((c) => (
          <div className="info-note" key={c.id}>
            <p>
              {c.question}：{c.learningIssue!.reason}
            </p>
            <a href={`#item/${c.id}`}>查看并修订</a>
            <button
              className="button subtle"
              onClick={() =>
                void action.run(() => repository.clearLearningIssue(c.id, c.currentRevisionId))
              }
            >
              我已处理，重新纳入学习
            </button>
          </div>
        ))}
      <details>
        <summary>学习证据与模型校准</summary>
        <p>FSRS保持默认5.4.2/0.90，没有训练个人参数；学习速度估计与记忆稳定性是不同数据。</p>
        <p>合格的跨日、无提示输入核对证据 {calibration.eligible} 条。</p>
        {calibration.scores ? (
          <p>
            默认模型的描述性Brier {calibration.scores.brier.toFixed(3)}，时间顺序后段Log Loss{' '}
            {calibration.chronologicalHoldout!.logLoss.toFixed(3)}
            。这是预测校准描述，不证明学习效果或个性化已改善。
          </p>
        ) : (
          <p>数据不足，不显示个人记忆概率或拟合优劣结论。</p>
        )}
        <a href="#history">完整原始历史</a>
      </details>
    </>
  );
}
