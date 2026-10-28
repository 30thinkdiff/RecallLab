import { useReviewClock, useReviewData } from './review-data';
import { buildPlan } from '../scheduling/planner';
import { useAction } from '../components/actions';
import { ErrorNotice } from '../components/shared';
export function ReviewOverview() {
  const data = useReviewData(),
    now = useReviewClock(),
    action = useAction();
  if (!data) return null;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const plans = data.projects
    .map((project) => ({
      project,
      plan: buildPlan(project, data.cards, data.memories, data.events, now, timezone),
    }))
    .sort(
      (a, b) =>
        Number(b.plan.due + b.plan.retest > 0) - Number(a.plan.due + a.plan.retest > 0) ||
        (b.project.priority ?? 2) - (a.project.priority ?? 2),
    );
  const totals = plans.reduce(
    (a, { plan: p }) => ({
      due: a.due + p.due + p.retest,
      new: a.new + p.newCount,
      done: a.done + p.completedToday,
      relearn: a.relearn + p.relearn,
      pending: a.pending + p.pending,
      soon: a.soon + p.upcomingToday,
    }),
    { due: 0, new: 0, done: 0, relearn: 0, pending: 0, soon: 0 },
  );
  const active = data.sessions.find(
    (s) => s.status === 'active' && s.reviewPlan && data.projects.some((p) => p.id === s.projectId),
  );
  const next = plans.find((p) => p.plan.selected.length);
  return (
    <section className="question-panel" aria-label="今日复习概览">
      <div className="section-heading">
        <h2>今日复习</h2>
        <a className="text-link" href="#daily">
          查看安排与设置
        </a>
      </div>
      <div className="review-metrics">
        {[
          ['今日到期', totals.due],
          ['今日稍后到点', totals.soon],
          ['待建立调度的新题', totals.new],
          ['今日已完成练习', totals.done],
          ['修订后需重新学习', totals.relearn],
          ['待完善题干', totals.pending],
        ].map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="muted">
        旧记录保留，新调度从可靠评价开始。无提示失败、提示练习与主观感受分别记录。
      </p>
      <ErrorNotice message={action.error} />
      <button
        className="button"
        disabled={action.busy || (!active && !next)}
        onClick={() =>
          void action.run(async () => {
            const id =
              active?.id ??
              (await (
                await import('../scheduling/service')
              ).scheduleService.start(next!.project.id));
            location.hash = `study/${id}`;
          })
        }
      >
        {active ? '继续未完成复习' : '开始今日复习'}
      </button>
    </section>
  );
}
