import { useState } from 'react';
import { useReviewClock, useReviewData } from './review-data';
import { buildPlan, localDay } from '../scheduling/planner';
import { scheduleService } from '../scheduling/service';
import type { ReviewMode } from '../scheduling/types';
import { promptProblem } from '../domain/readiness';
import { useAction, dateTime } from '../components/actions';
import { ErrorNotice } from '../components/shared';
export function DailyReview({
  initialProjectId,
  onEditProject,
}: {
  initialProjectId?: string;
  onEditProject: (id: string) => void;
}) {
  const data = useReviewData(),
    now = useReviewClock();
  const [selectedProject, setProject] = useState(initialProjectId ?? '');
  const [mode, setMode] = useState<ReviewMode>('daily');
  const [sectionId, setSectionId] = useState('');
  const [customIds, setCustomIds] = useState<string[]>([]);
  const action = useAction();
  if (!data) return <p role="status">正在读取复习安排…</p>;
  const projects = [...data.projects].sort(
    (a, b) =>
      (b.priority ?? 2) - (a.priority ?? 2) ||
      (a.targetDate || '9999').localeCompare(b.targetDate || '9999'),
  );
  const project = projects.find((p) => p.id === selectedProject) ?? projects[0];
  if (!project)
    return (
      <>
        <h1>今日复习</h1>
        <p>先创建学习项目或导入资料。</p>
        <a className="button" href="#import">
          导入资料
        </a>
      </>
    );
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const plan = buildPlan(project, data.cards, data.memories, data.events, now, timezone, {
    mode,
    sectionId,
    customIds,
  });
  const active = data.sessions.find(
    (s) => s.projectId === project.id && s.status === 'active' && s.reviewPlan,
  );
  const sections = data.documents
    .filter((d) => d.projectId === project.id)
    .flatMap((d) => d.sections.map((s) => ({ ...s, filename: d.filename })));
  const cards = data.cards.filter((c) => c.projectId === project.id && !c.archivedAt);
  return (
    <>
      <div className="eyebrow">RECALL AT THE RIGHT TIME</div>
      <h1>今日复习</h1>
      <p className="page-intro">
        先复习到期内容，再做无提示复测和重点练习，最后引入适量新知识。随时暂停，已完成记录会保留。
      </p>
      <label>
        复习项目
        <select
          aria-label="复习项目"
          value={project.id}
          onChange={(e) => {
            setProject(e.target.value);
            setCustomIds([]);
            setSectionId('');
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="review-metrics">
        {[
          ['今日到期', plan.due],
          ['今日稍后到点', plan.upcomingToday],
          ['待无提示复测', plan.retest],
          ['待建立调度的新题', plan.newCount],
          ['修订后需重新学习', plan.relearn],
          ['待完善题干', plan.pending],
          ['今日已完成练习', plan.completedToday],
        ].map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className="question-panel">
        <h2>学习预算与目标</h2>
        <p>
          每天 {project.dailyTimeBudget} 分钟 · 每天最多引入 {project.newCardLimit ?? 10} 道新题 ·
          目标日期 {project.targetDate || '未设置'} · 优先级{' '}
          {{ 1: '低', 2: '普通', 3: '高' }[project.priority ?? 2]}
        </p>
        <p>
          今天预计剩余 {plan.budgetRemaining} 分钟。按每题约 2
          分钟估算题数配额，不代表测得的实际专注时间；未尝试而跳过不扣配额。
        </p>
        {plan.examNear && (
          <p className="info-note">
            目标日期临近，同级任务优先当前版本的薄弱内容；提前加练不会改变长期调度。
          </p>
        )}
        <button className="button secondary" onClick={() => onEditProject(project.id)}>
          设置学习预算与目标
        </button>
      </section>
      <section className="question-panel">
        <h2>选择本次范围</h2>
        {active && (
          <p className="info-note">
            有未完成计划，优先继续其原范围和草稿；如需切换范围，可先进入并结束本轮，已完成历史保留。
          </p>
        )}
        <label>
          复习范围
          <select
            aria-label="复习范围"
            value={active?.reviewPlan?.mode ?? mode}
            disabled={!!active}
            onChange={(e) => setMode(e.target.value as ReviewMode)}
          >
            <option value="daily">今日计划</option>
            <option value="due">只复习到期与无提示复测</option>
            <option value="new">只学新题</option>
            <option value="weak">只练薄弱项</option>
            <option value="chapter">按章节选择</option>
            <option value="custom">自定义临时练习（不更新 FSRS）</option>
          </select>
        </label>
        {mode === 'chapter' && (
          <label>
            选择章节
            <select
              aria-label="选择章节"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              <option value="">请选择</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.filename} · {s.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === 'custom' && (
          <details open>
            <summary>选择临时练习题目</summary>
            {cards
              .filter((c) => !promptProblem(c))
              .map((c) => (
                <label className="checkbox-label" key={c.id}>
                  <input
                    type="checkbox"
                    checked={customIds.includes(c.id)}
                    onChange={(e) =>
                      setCustomIds(
                        e.target.checked
                          ? [...customIds, c.id]
                          : customIds.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.question}
                </label>
              ))}
          </details>
        )}
        <ErrorNotice message={action.error} />
        {plan.budgetExhausted && !active && (
          <p role="status">
            今天的预计预算已用完。可以暂停，也可以明确选择临时加练，后者不更新长期状态。
          </p>
        )}
        <div className="button-row">
          <button
            className="button"
            disabled={action.busy || (!active && !plan.selected.length)}
            onClick={() =>
              void action.run(async () => {
                location.hash = `study/${await scheduleService.start(project.id, { mode, sectionId, customIds })}`;
              })
            }
          >
            {active ? '继续未完成复习' : `开始本次复习（${plan.selected.length} 题）`}
          </button>
          {plan.budgetExhausted && !active && (
            <button
              className="button secondary"
              disabled={action.busy || (mode === 'custom' && !customIds.length)}
              onClick={() =>
                void action.run(async () => {
                  location.hash = `study/${await scheduleService.start(project.id, { mode, sectionId, customIds, extraPractice: true })}`;
                })
              }
            >
              临时加练（不更新 FSRS）
            </button>
          )}
          <a className="text-link" href={`#pending/${project.id}`}>
            完善待核对题干（{plan.pending}）
          </a>
        </div>
        <details>
          <summary>查看预计队列与原因</summary>
          <ol>
            {plan.selected.map((row) => (
              <li key={row.item.id}>
                {row.item.question} ·{' '}
                {
                  {
                    due: '今日到期',
                    retest: '无提示复测',
                    focus: '重点加练',
                    new: '新题',
                    practice: '临时练习',
                  }[row.reason]
                }
                {row.canSchedule ? '' : ' · 不更新长期状态'}
              </li>
            ))}
          </ol>
        </details>
      </section>
      <details>
        <summary>重点题目与最近安排</summary>
        {cards.map((c) => {
          const memory = data.memories.find((m) => m.id === c.learningStateId);
          return (
            <div className="review-item" key={c.id}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!c.focus}
                  disabled={action.busy}
                  onChange={(e) =>
                    void action.run(() => scheduleService.focus(project.id, c.id, e.target.checked))
                  }
                />
                重点：{c.question}
              </label>
              <p className="muted">
                {promptProblem(c)
                  ? '待完善，不参与调度'
                  : memory?.retestDue
                    ? `等待无提示复测：${dateTime(memory.retestDue)}`
                    : memory?.card.reps
                      ? `下次到期：${dateTime(memory.due)}`
                      : '尚未建立可靠复习记录'}{' '}
                ·{' '}
                <a href={`#item/${c.id}`} className="text-link">
                  查看历史与来源
                </a>
              </p>
            </div>
          );
        })}
      </details>
      <details>
        <summary>复习规则与默认设置</summary>
        <p>
          本地日期：{localDay(now, timezone)}（{timezone}
          ）。长期复习按本地到期日列入今日，分钟级学习与补救到点后开放。队列顺序为到期→无提示复测→重点→新题，新题还受每日上限约束。过期计划不会强制自动完成，暂停可保留草稿。
        </p>
        <p>
          FSRS 默认目标保持率 90%
          是通用初始设置，没有训练个人参数，也不是实测记忆概率。口头回忆来自自报，输入作答由你人工核对；系统不自动评分。
        </p>
      </details>
    </>
  );
}
