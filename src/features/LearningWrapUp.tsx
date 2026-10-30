import { useReviewData, useReviewClock } from './review-data';
import { forecastGoal } from '../learning/adaptive';
import { learningProgress, nextReviewAt } from '../learning/progress';
import { dateTime, useAction } from '../components/actions';
import { ErrorNotice } from '../components/shared';
import { scheduleService } from '../scheduling/service';

export function LearningWrapUp({ projectId }: { projectId: string }) {
  const data = useReviewData(projectId, true),
    now = useReviewClock(),
    action = useAction();
  const project = data?.projects.find((p) => p.id === projectId);
  if (!data || !project) return <p role="status">正在整理下一步建议…</p>;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const plan = forecastGoal(project, data.cards, data.memories, data.events, now, timezone);
  const progress = learningProgress(project, data.cards, data.events, now, timezone);
  const next = nextReviewAt(project, data.cards, data.memories, data.events, now);
  return (
    <section className="question-panel learning-wrap-up" aria-label="今天的进展与下一步">
      <h2>接下来怎么学</h2>
      <p>
        本项目今天实际练习 {progress.todayRecords} 次，涉及 {progress.todayItems}{' '}
        道题。包含重复和当天旧版记录，跳过另计。
      </p>
      <p>
        当前范围仍薄弱 {progress.weak.length}{' '}
        道：最近一次核对有遗漏、错误或使用提示；这不是机器测得的掌握率。
      </p>
      {!!progress.weak.length && (
        <details>
          <summary>查看薄弱内容</summary>
          <ul>
            {progress.weak.slice(0, 5).map((c) => (
              <li key={c.id}>{c.question}</li>
            ))}
          </ul>
          {progress.weak.length > 5 && <p>其余内容会按预算安排，不需要现在全部补完。</p>}
        </details>
      )}
      {plan.budgetExhausted ? (
        <p role="status">
          今天的预计预算已用完。记录已保留，明天回到首页继续，系统会按当时到期情况重新安排。
        </p>
      ) : plan.selected.length > 0 ? (
        <p role="status">
          现在仍可安排 {plan.selected.length} 道题，预计 {Math.ceil(plan.estimatedSeconds / 60)}{' '}
          分钟。可以继续，也可以先休息，不要求刷完整个题库。
        </p>
      ) : plan.delayed > 0 || progress.retestWaiting > 0 ? (
        <p role="status">
          先休息一下。刚失败或用提示的题至少等待10分钟，再做无提示复测；刚看完答案不代表已经记住。
        </p>
      ) : plan.attention > 0 ? (
        <p role="status">
          有反复困难的内容，今天暂停自动重复。建议先核对来源或把长答案拆成更小的任务。
        </p>
      ) : plan.unfit > 0 ? (
        <p role="status">
          剩余预计预算不足以完成当前题目。可以先休息，下次继续；也可在目标中明确调整时间或范围。
        </p>
      ) : plan.newCount > 0 ? (
        <p role="status">今天暂不增加新题。已保留当前范围和新题限制，下一学习日会重新安排。</p>
      ) : (
        <p role="status">
          当前没有需要立即开始的任务。下次从首页继续即可，系统会重新检查到期内容。
        </p>
      )}
      {next && !plan.budgetExhausted && !plan.selected.length && (
        <p>
          下一次可能的复习时间：{dateTime(new Date(next).toISOString())}
          。到期按本地日期和当时进度重新计算。
        </p>
      )}
      {plan.status === 'expired' ? (
        <p role="status">目标日期已到或已过。可以调整期限继续学习，不承诺考试结果。</p>
      ) : plan.gapMinutes > 0 ? (
        <p role="status">
          目标存在时间风险：当前工作量情景比可用时间多约 {plan.gapMinutes}{' '}
          分钟。可延长期限、调整范围或明确增加预算；这是估计。
        </p>
      ) : (
        <p>当前估计工作量仍可安排，但不保证全部掌握或考试通过。</p>
      )}
      {plan.qualityPending > 0 && (
        <p>
          {plan.qualityPending} 道待完善内容尚未进入学习。
          <a href={`#pending/${project.id}`}>核对待完善内容</a>
        </p>
      )}
      <div className="button-row">
        {plan.selected.length > 0 && (
          <button
            className="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                window.location.assign(
                  `#study/${await scheduleService.start(project.id, { adaptive: true })}`,
                );
              })
            }
          >
            继续自动安排
          </button>
        )}
        <a className="button secondary" href={`#learn/${project.id}`}>
          调整目标与查看安排
        </a>
      </div>
      <ErrorNotice message={action.error} />
    </section>
  );
}
