import type {
  LearningProject,
  PracticeItem,
  PracticeItemRevision,
  ReviewEvent,
} from '../domain/models';
import { dateTime } from '../components/actions';
import { masteryLabels, performanceLabels } from '../domain/review';
import { evidenceIsCurrent } from '../domain/revisions';

export function EventHistory({
  events,
  projects,
  cards,
  revisions,
}: {
  events: ReviewEvent[];
  projects: LearningProject[];
  cards: PracticeItem[];
  revisions: PracticeItemRevision[];
}) {
  return (
    <div className="history-list">
      {events.map((event) => (
        <details className="history-entry" key={event.id}>
          <summary>
            <div>
              <small>
                {projects.find((project) => project.id === event.projectId)?.name} ·{' '}
                {dateTime(event.timestamp)}
              </small>
              <h3>{event.snapshot.question}</h3>
              <div className="revision-evidence-label">
                修订 {event.snapshot.revision} ·{' '}
                {cards.find(
                  (card) =>
                    card.id === event.practiceItemId && evidenceIsCurrent(event, card, revisions),
                )
                  ? '适用于当前知识'
                  : '旧版历史 · 不计当前表现'}
              </div>
              <div className="card-tags">
                <span>{event.responseMode === 'quick' ? '快速回忆' : '输入作答'}</span>
                <span>{event.hintLevelUsed ? `${event.hintLevelUsed} 条提示` : '未使用提示'}</span>
                <span>{performanceLabels[event.assessmentResult]}</span>
                <span>
                  {event.subjectiveMastery === null
                    ? '无主观评分'
                    : `自评 ${event.subjectiveMastery} · ${masteryLabels[event.subjectiveMastery]}`}
                </span>
              </div>
            </div>
            <span className="text-link">详情</span>
          </summary>
          <div className="history-details">
            <div className="history-evidence">
              <span>
                评价来源：
                {event.assessmentSource === 'self_report'
                  ? '自评（未观察到完整作答）'
                  : event.assessmentSource === 'user_checked'
                    ? '用户人工核对'
                    : '未核对'}
              </span>
              <span>无提示回忆尝试：{event.wasIndependentRecall ? '是' : '否'}</span>
              <span>答案已揭晓：{event.wasAnswerRevealed ? '是' : '否'}</span>
              <span>
                揭晓前信心：
                {event.confidenceBeforeReveal === null ? '未填写' : event.confidenceBeforeReveal}
              </span>
              <span>作答用时（含暂停）：{Math.round(event.responseDuration / 1000)} 秒</span>
              <span>题目修订：{event.snapshot.revision}</span>
            </div>
            {cards.find((card) => card.id === event.practiceItemId)?.revision !==
              event.snapshot.revision && (
              <p className="info-note">
                题目已修订。此处保留练习时的标准答案和评价，没有追溯改写。
              </p>
            )}
            <a className="text-link" href={`#item/${event.practiceItemId}`}>
              查看该题全部历史与版本
            </a>
            <h4>原始作答</h4>
            <p className="preserve-lines">
              {event.responseMode === 'quick'
                ? '脑中或口头回忆，未采集完整回答。'
                : event.userResponse || '未输入回答。'}
            </p>
            <h4>当时的标准答案</h4>
            <p className="preserve-lines">{event.snapshot.standardAnswer}</p>
            {event.hintLevelUsed > 0 && (
              <>
                <h4>当时使用的提示</h4>
                <ol>
                  {event.snapshot.hints.slice(0, event.hintLevelUsed).map((hint, index) => (
                    <li key={index}>{hint}</li>
                  ))}
                </ol>
              </>
            )}
            {event.snapshot.sourceReferences.length > 0 && (
              <p className="source-note">
                来源：{event.snapshot.sourceReferences.map((source) => source.label).join('；')}
              </p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
