import type { ReviewData } from './review-data';
import { reviewStatistics } from '../scheduling/analytics';
import { dateTime } from '../components/actions';
export function ReviewStats({
  projectId,
  data,
  now,
}: {
  projectId?: string;
  data: ReviewData;
  now: Date;
}) {
  const ids = new Set(
    data.projects.filter((p) => !projectId || p.id === projectId).map((p) => p.id),
  );
  const cards = data.cards.filter((c) => ids.has(c.projectId)),
    events = data.events.filter((e) => ids.has(e.projectId));
  const stats = reviewStatistics(
    cards,
    events,
    data.memories,
    data.logs,
    data.revisions,
    now,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  return (
    <section className="question-panel" aria-label="可信复习统计">
      <h2>学习证据与复习负担</h2>
      <div className="review-metrics">
        {[
          ['今日完成练习记录', stats.todayCompleted],
          ['近 7 天正式复习次数', stats.recentScheduled],
          ['近 7 天练习记录（含教学）', stats.recentPractice],
          ['当前版本提示后成功', stats.hintedSuccess],
        ].map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <h3>无提示表现</h3>
      {stats.manualSamples > 0 && stats.manualSamples < 10 && (
        <p className="info-note">
          目前仅 {stats.manualSamples} 次人工核对样本，不能据此推断长期保持率。
        </p>
      )}
      <p>
        {stats.accuracy === null
          ? '尚无输入作答后人工核对的无提示样本。'
          : `无提示人工核对正确率：${Math.round(stats.accuracy * 100)}%（${stats.manualCorrect} / ${stats.manualSamples} 次）`}
      </p>
      <p>
        口头独立回忆自报：{stats.reportedCorrect} 次正确 / {stats.reported}{' '}
        次已核对自报。短答案文字一致核对：{stats.literalSamples} 次（不是语义正确率）。
      </p>
      <p className="muted">
        正确率仅使用当前有效知识版本、保留输入作答且无提示的人工核对。工作量保留实际发生的旧版练习；提示后成功不作为独立成功。数据不足不显示个人记忆概率，也没有训练个人最优参数。
      </p>
      <h3>到期分布</h3>
      <table>
        <thead>
          <tr>
            <th>本地复习日</th>
            <th>题数</th>
          </tr>
        </thead>
        <tbody>
          {stats.distribution.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>查看各题最近一次独立回忆</summary>
        {cards
          .filter((c) => !c.archivedAt)
          .map((c) => {
            const e = stats.latest.get(c.id);
            return (
              <p key={c.id}>
                <a className="text-link" href={`#item/${c.id}`}>
                  {c.question}
                </a>{' '}
                ·{' '}
                {e
                  ? `${e.assessmentSource === 'user_checked' ? '人工核对' : e.assessmentSource === 'self_report' ? '用户自报' : '未核对'}：${{ correct: '正确', incorrect: '失败', partially_correct: '部分正确', ungraded: '未核对', skipped: '跳过' }[e.assessmentResult]} · ${dateTime(e.reviewedAt ?? e.timestamp)}`
                  : '当前版本尚无独立回忆记录'}
              </p>
            );
          })}
      </details>
    </section>
  );
}
