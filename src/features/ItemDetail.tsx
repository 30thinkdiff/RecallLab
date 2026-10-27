import { useState } from 'react';
import type {
  PracticeItem,
  PracticeItemRevision,
  PracticeSnapshot,
  ReviewEvent,
} from '../domain/models';
import { itemEvidence, dailyCounts } from '../domain/analytics';
import { changeLabels } from '../domain/revisions';
import { masteryLabels, performanceLabels } from '../domain/review';
import { dateTime } from '../components/actions';
import { downloadJson } from '../persistence/backup';
import { SourceLinks } from './Documents';
import { EventHistory } from './EventHistory';
import type { WorkspaceData } from './Workspace';

export function ItemDetail({ item, data }: { item: PracticeItem; data: WorkspaceData }) {
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const evidence = itemEvidence(item, data.allEvents, data.revisions);
  const revisions = data.revisions
    .filter((revision) => revision.practiceItemId === item.id)
    .sort((a, b) => a.revisionNumber - b.revisionNumber);
  const selected = scope === 'current' ? evidence.current : evidence.all;
  const currentRevision = revisions.find((revision) => revision.id === item.currentRevisionId);
  const recoveries = data.draftRecoveries
    .filter((recovery) => recovery.practiceItemId === item.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const archivedProject = data.allProjects.find(
    (project) => project.id === item.projectId,
  )?.archivedAt;
  return (
    <>
      <a
        className="text-link breadcrumb"
        href={archivedProject ? '#archive' : `#project/${item.projectId}`}
      >
        返回{archivedProject ? '归档内容' : '项目题库'}
      </a>
      <div className="eyebrow">ONE QUESTION, A COMPLETE HISTORY</div>
      <h1>{item.question}</h1>
      <p className="page-intro">
        当前有效修订 {item.revision} · {item.archivedAt ? '已归档，不参与正常学习' : '有效题目'} ·{' '}
        {currentRevision ? changeLabels[currentRevision.changeType] : ''}
      </p>
      <section className="answer-panel">
        <span className="section-kicker">当前标准答案</span>
        <p className="preserve-lines">{item.standardAnswer}</p>
        {item.sourceReferences.length > 0 && <SourceLinks sources={item.sourceReferences} />}
        {item.answerCriteria.length > 0 && (
          <ul>
            {item.answerCriteria.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        )}
      </section>
      {evidence.allStats.attempts > 0 && evidence.currentStats.attempts === 0 && (
        <p className="info-note" role="status">
          新版需要重新学习。你曾练习旧版内容，存在学习过旧答案的风险；这不代表已经形成错误记忆。建议优先进行一次无提示重新测试。
        </p>
      )}
      <h2>全部历史与当前有效表现</h2>
      <p className="muted">
        当前有效证据按学习状态标识筛选。明确声明不改变考核的格式/澄清修订可以继承；实质性更正和知识替换不继承。
      </p>
      <div className="table-scroll">
        <table className="evidence-table">
          <thead>
            <tr>
              <th>指标</th>
              <th>历史全部</th>
              <th>当前有效</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['总练习记录', 'total'],
                ['非跳过练习', 'attempts'],
                ['人工核对正确', 'correct'],
                ['人工核对部分正确', 'partial'],
                ['人工核对不正确', 'incorrect'],
                ['人工核对正确 · 有提示', 'hintedCorrect'],
                ['人工核对正确 · 无提示回忆', 'independentCorrect'],
                ['无提示回忆尝试', 'unhinted'],
              ] as const
            ).map(([label, key]) => (
              <tr key={key}>
                <th>{label}</th>
                <td>{evidence.allStats[key]}</td>
                <td>{evidence.currentStats[key]}</td>
              </tr>
            ))}
            <tr>
              <th>提示使用（非跳过练习）</th>
              <td>
                {evidence.allStats.hinted} / {evidence.allStats.attempts}
              </td>
              <td>
                {evidence.currentStats.hinted} / {evidence.currentStats.attempts}
              </td>
            </tr>
            <tr>
              <th>最近主观评价</th>
              <td>{evidence.allStats.latest?.subjectiveMastery ?? '暂无'}</td>
              <td>{evidence.currentStats.latest?.subjectiveMastery ?? '暂无'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted">
        人工核对是用户判断；提示后正确与无提示回忆分开记录，没有系统独立验证的正确率或记忆能力分数。
      </p>
      <section>
        <div className="section-heading">
          <h2>练习分布</h2>
          <label className="filter-label">
            统计范围
            <select
              aria-label="统计范围"
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              <option value="current">当前有效证据</option>
              <option value="all">全部历史（含旧版）</option>
            </select>
          </label>
        </div>
        <EvidenceCharts events={selected} />
      </section>
      <RevisionComparison revisions={revisions} currentId={item.currentRevisionId} />
      <section>
        <h2>修订时间线与版本分布</h2>
        <p className="muted">
          只展示实际保存或可从旧快照恢复的版本；迁移修订的原修改原因和精确时间未知。
        </p>
        <div className="revision-timeline">
          {revisions.map((revision) => (
            <details className="revision-entry" key={revision.id}>
              <summary>
                修订 {revision.revisionNumber} · {changeLabels[revision.changeType]}{' '}
                {revision.id === item.currentRevisionId ? '· 当前版本' : '· 历史版本'}
                <small>
                  {dateTime(revision.createdAt)} ·{' '}
                  {
                    evidence.all.filter(
                      (event) => event.snapshot.revision === revision.revisionNumber,
                    ).length
                  }{' '}
                  次练习
                </small>
              </summary>
              <p>{revision.changeSummary}</p>
              <p className="muted">
                {revision.impactOnLearningState === 'preserve'
                  ? '学习要求不变，保留此前有效证据'
                  : '独立学习状态，不继承上一状态成绩'}
              </p>
              <p className="preserve-lines">{revision.snapshot.standardAnswer}</p>
            </details>
          ))}
        </div>
      </section>
      <section>
        <h2>历次学习事件（从早到晚）</h2>
        {evidence.all.length ? (
          <EventHistory
            events={evidence.all}
            projects={data.allProjects}
            cards={data.allCards}
            revisions={data.revisions}
          />
        ) : (
          <p>还没有正式学习事件。</p>
        )}
      </section>
      <section>
        <h2>未提交作答与冲突副本</h2>
        <p className="muted">这些是暂存原始输入，不是正式练习成绩。不会自动粘贴到新版答案中。</p>
        {recoveries.length ? (
          recoveries.map((recovery) => (
            <details className="revision-entry" key={recovery.id}>
              <summary>
                修订 {recovery.revision} · {recovery.reason}
                <small>{dateTime(recovery.createdAt)}</small>
              </summary>
              <p className="preserve-lines">{recovery.draft.userResponse || '（无文本输入）'}</p>
              <p className="muted">
                使用 {recovery.draft.hintLevelUsed} 条提示 ·{' '}
                {recovery.draft.wasAnswerRevealed ? '已揭晓' : '未揭晓'}
              </p>
              <button
                className="button secondary"
                onClick={() => downloadJson(recovery, `RecallLab-draft-${recovery.id}.json`)}
              >
                下载暂存副本
              </button>
            </details>
          ))
        ) : (
          <p>暂无暂存副本。</p>
        )}
      </section>
    </>
  );
}

function EvidenceCharts({ events }: { events: ReviewEvent[] }) {
  if (!events.length)
    return <div className="empty-card">数据不足：当前范围尚无练习记录，不生成趋势。</div>;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = dailyCounts(events, timezone);
  const max = Math.max(...days.map(([, count]) => count));
  const ratings = events.filter((event) => event.subjectiveMastery !== null);
  return (
    <div className="evidence-charts">
      <div className="chart-panel">
        <h3>按日期练习次数</h3>
        <p className="muted">按浏览器时区 {timezone}，包含跳过。</p>
        <div className="date-chart" role="img" aria-label="按日期的实际练习次数">
          {days.map(([day, count]) => (
            <div className="count-bar" key={day}>
              <span>{day}</span>
              <meter min={0} max={max} value={count} aria-label={`${day} ${count}次`} />
              <b>{count}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-panel">
        <h3>人工核对结果分布</h3>
        {(['correct', 'partially_correct', 'incorrect', 'ungraded', 'skipped'] as const).map(
          (result) => {
            const count = events.filter((event) => event.assessmentResult === result).length;
            return (
              <div className="count-bar" key={result}>
                <span>{performanceLabels[result]}</span>
                <meter
                  min={0}
                  max={events.length}
                  value={count}
                  aria-label={`${performanceLabels[result]} ${count}次`}
                />
                <b>{count}</b>
              </div>
            );
          },
        )}
      </div>
      <div className="chart-panel rating-chart">
        <h3>主观评价变化</h3>
        {ratings.length < 2 ? (
          <p>数据不足：至少两次自评后显示离散记录。</p>
        ) : (
          <>
            <svg viewBox="0 0 600 155" role="img" aria-label="主观评分离散记录，无趋势拟合">
              <line x1="25" x2="580" y1="130" y2="130" stroke="#d9e1cf" />
              {[0, 1, 2, 3, 4].map((level) => (
                <text key={level} x="3" y={133 - level * 28} fontSize="10" fill="#7b886d">
                  {level}
                </text>
              ))}
              {ratings.map((event, index) => (
                <circle
                  key={event.id}
                  cx={35 + (index / Math.max(1, ratings.length - 1)) * 535}
                  cy={130 - event.subjectiveMastery! * 28}
                  r="5"
                  fill="#718b55"
                >
                  <title>
                    {dateTime(event.timestamp)} · 修订 {event.snapshot.revision} ·{' '}
                    {masteryLabels[event.subjectiveMastery!]}
                  </title>
                </circle>
              ))}
            </svg>
            <p className="muted">按实际练习顺序显示自评点，不拟合趋势；各版本仍须分别解释。</p>
          </>
        )}
      </div>
    </div>
  );
}

const compareFields: [keyof PracticeSnapshot, string][] = [
  ['question', '问题'],
  ['standardAnswer', '标准答案'],
  ['answerCriteria', '核对要点'],
  ['hints', '渐进提示'],
  ['mnemonics', '助记技巧'],
  ['confusionWarnings', '易混提醒'],
  ['sourceReferences', '来源说明'],
];
function showField(snapshot: PracticeSnapshot, key: keyof PracticeSnapshot) {
  if (key === 'sourceReferences')
    return snapshot.sourceReferences.map((source) => source.label).join('\n');
  const value = snapshot[key];
  return Array.isArray(value) ? value.join('\n') : String(value ?? '');
}
function RevisionComparison({
  revisions,
  currentId,
}: {
  revisions: PracticeItemRevision[];
  currentId: string;
}) {
  const [leftId, setLeftId] = useState(revisions.at(-2)?.id ?? currentId);
  const [rightId, setRightId] = useState(currentId);
  const left = revisions.find((revision) => revision.id === leftId);
  const right = revisions.find((revision) => revision.id === rightId);
  if (!left || !right) return null;
  const changed = compareFields.filter(
    ([key]) => showField(left.snapshot, key) !== showField(right.snapshot, key),
  );
  return (
    <section>
      <h2>版本差异</h2>
      <div className="button-row">
        <label>
          比较旧版本
          <select
            aria-label="比较旧版本"
            value={leftId}
            onChange={(event) => setLeftId(event.target.value)}
          >
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                修订 {revision.revisionNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          比较新版本
          <select
            aria-label="比较新版本"
            value={rightId}
            onChange={(event) => setRightId(event.target.value)}
          >
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                修订 {revision.revisionNumber}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>{right.changeSummary}</p>
      {changed.length ? (
        <div className="table-scroll">
          <table className="diff-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>修订 {left.revisionNumber}</th>
                <th>修订 {right.revisionNumber}</th>
              </tr>
            </thead>
            <tbody>
              {changed.map(([key, label]) => (
                <tr key={key}>
                  <th>{label}</th>
                  <td>
                    <del className="preserve-lines">
                      {showField(left.snapshot, key) || '（空）'}
                    </del>
                  </td>
                  <td>
                    <ins className="preserve-lines">
                      {showField(right.snapshot, key) || '（空）'}
                    </ins>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">所选版本的题目内容相同。</p>
      )}
    </section>
  );
}
