import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Play,
  Search,
  Clock3,
  CheckCircle2,
  Layers3,
} from 'lucide-react';
import type { LearningProject, PracticeItem, ReviewEvent, StudySession } from '../domain/models';
import { masteryLabels, performanceLabels } from '../domain/review';
import { dateTime } from '../components/actions';

export interface WorkspaceData {
  projects: LearningProject[];
  cards: PracticeItem[];
  events: ReviewEvent[];
  sessions: StudySession[];
}

export function Overview({ data, onCreate }: { data: WorkspaceData; onCreate: () => void }) {
  const activeCards = new Set(data.cards.map((card) => card.id));
  const learned = new Set(
    data.events
      .filter(
        (event) => event.assessmentResult !== 'skipped' && activeCards.has(event.practiceItemId),
      )
      .map((event) => event.practiceItemId),
  );
  const latest = new Map<string, ReviewEvent>();
  data.events
    .filter((event) => event.subjectiveMastery !== null && activeCards.has(event.practiceItemId))
    .forEach((event) => latest.set(event.practiceItemId, event));
  const levels = masteryLabels.map(
    (_, index) => [...latest.values()].filter((event) => event.subjectiveMastery === index).length,
  );
  const recent = data.events.slice(-4).reverse();
  return (
    <>
      <div className="eyebrow">YOUR LEARNING, WITH EVIDENCE</div>
      <div className="page-heading">
        <div>
          <h1>让每一次回忆，都有收获。</h1>
          <p className="page-intro">从主动回忆开始，把熟悉的知识变成真正记得住的知识。</p>
        </div>
        <button className="button" onClick={onCreate}>
          <Plus size={17} /> 创建项目
        </button>
      </div>
      <div className="stats-grid">
        {[
          {
            label: '学习项目',
            value: data.projects.length,
            icon: BookOpen,
            note: '每个目标，一个空间',
          },
          {
            label: '题库总量',
            value: data.cards.length,
            icon: Layers3,
            note: '由你亲手整理的问答',
          },
          {
            label: '已学习题目',
            value: learned.size,
            icon: CheckCircle2,
            note: '已保存评价，不含跳过',
          },
          {
            label: '练习记录',
            value: data.events.length,
            icon: Clock3,
            note: '包含跳过，记录每次尝试',
          },
        ].map(({ label, value, icon: Icon, note }) => (
          <div className="stat-card" key={label}>
            <div className="stat-title">
              {label}
              <Icon size={17} />
            </div>
            <strong>
              {value}
              <span>{label === '学习项目' ? '个' : label === '练习记录' ? '条' : '题'}</span>
            </strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <section className="welcome-panel">
        <div>
          <span className="section-kicker">一点点练习，一点点扎实</span>
          <h2>{data.cards.length ? '给记忆一次主动出场的机会。' : '今天，先从一个问题开始。'}</h2>
          <p>
            {data.cards.length
              ? '选择一个项目，先独立回忆，再核对答案。你可以随时暂停，下次回来继续。'
              : '创建学习项目，写下想掌握的问题和答案。无需上传资料，也能开始你的第一轮学习。'}
          </p>
          <a className="button" href="#projects">
            {data.cards.length ? '开始今天的学习' : '前往学习项目'}
            <ArrowRight size={16} />
          </a>
        </div>
        <div className="recall-graphic" aria-hidden="true">
          <div className="graphic-card back" />
          <div className="graphic-card front">
            <FlaskMark />
            <span>
              主动想起来，
              <br />
              才是学习的开始。
            </span>
            <div className="graphic-dots">
              <i />
              <i />
              <i />
            </div>
          </div>
          <span className="graphic-caption">SMALL STEPS. LASTING KNOWLEDGE.</span>
        </div>
      </section>
      <div className="overview-columns">
        <section>
          <div className="section-heading">
            <h2>
              我的学习项目 <span>{data.projects.length}</span>
            </h2>
            <a href="#projects" className="text-link">
              查看全部 <ArrowRight size={14} />
            </a>
          </div>
          {data.projects.length ? (
            <div className="compact-projects">
              {data.projects.slice(0, 3).map((project) => (
                <a className="compact-project" href={`#project/${project.id}`} key={project.id}>
                  <span className="project-symbol">
                    <BookOpen size={20} />
                  </span>
                  <div>
                    <strong>{project.name}</strong>
                    <small>
                      {data.cards.filter((card) => card.projectId === project.id).length} 道题 ·
                      每日计划 {project.dailyTimeBudget} 分钟
                    </small>
                  </div>
                  <ArrowRight size={16} />
                </a>
              ))}
            </div>
          ) : (
            <div className="empty-card">
              <BookOpen size={28} strokeWidth={1.2} />
              <h3>为你的下一个目标，建一个项目。</h3>
              <p>考试备考、专业知识，或任何你想记住的事。</p>
              <button className="text-button" onClick={onCreate}>
                <Plus size={15} /> 创建第一个项目
              </button>
            </div>
          )}
        </section>
        <section>
          <div className="section-heading">
            <h2>最近的主观评价</h2>
            <span className="muted">每题最近一次</span>
          </div>
          <div className="mastery-summary">
            {masteryLabels.map((label, index) => (
              <div className="mastery-bar-row" key={label}>
                <span>
                  <b className={`level-dot level-${index}`} />
                  {label}
                </span>
                <progress
                  value={levels[index] ?? 0}
                  max={Math.max(latest.size, 1)}
                  aria-label={label}
                />
                <b>{levels[index]}</b>
              </div>
            ))}
            <p className="muted">来自你的自评，不表示客观掌握率。尚未评价的题目未计入。</p>
          </div>
        </section>
      </div>
      <section>
        <div className="section-heading">
          <h2>最近学习记录</h2>
          <a className="text-link" href="#history">
            全部记录 <ArrowRight size={14} />
          </a>
        </div>
        {recent.length ? (
          <div className="recent-list">
            {recent.map((event) => (
              <div key={event.id}>
                <span className="recent-dot" />
                <strong>{event.snapshot.question}</strong>
                <span className="tag">
                  {event.subjectiveMastery === null
                    ? '已跳过'
                    : `自评 ${event.subjectiveMastery} · ${masteryLabels[event.subjectiveMastery]}`}
                </span>
                <time>{dateTime(event.timestamp)}</time>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-line">还没有学习记录。完成一次回忆后，你的足迹会出现在这里。</div>
        )}
      </section>
      <footer className="page-footer">
        以记录为依据，以回忆为练习。<span>Local-first · AI-optional</span>
      </footer>
    </>
  );
}

function FlaskMark() {
  return (
    <span className="graphic-mark" aria-hidden="true">
      R<span>↗</span>
    </span>
  );
}

export function Projects({ data, onCreate }: { data: WorkspaceData; onCreate: () => void }) {
  return (
    <>
      <div className="eyebrow">A SPACE FOR EVERY GOAL</div>
      <div className="page-heading">
        <div>
          <h1>学习项目</h1>
          <p className="page-intro">整理你的问题，让每个学习目标都有清晰的起点。</p>
        </div>
        <button className="button" onClick={onCreate}>
          <Plus size={17} /> 创建项目
        </button>
      </div>
      {data.projects.length ? (
        <div className="project-grid">
          {data.projects.map((project) => {
            const count = data.cards.filter((card) => card.projectId === project.id).length;
            const active = data.sessions.find(
              (session) => session.projectId === project.id && session.status === 'active',
            );
            return (
              <a className="project-card" href={`#project/${project.id}`} key={project.id}>
                <div className="project-card-top">
                  <span className="project-symbol">
                    <BookOpen size={23} />
                  </span>
                  {active && <span className="tag">有未完成的学习</span>}
                </div>
                <h2>{project.name}</h2>
                <p>{project.description || '从一个问题开始，逐步构建你的知识。'}</p>
                <div className="project-goal">{project.learningGoal || '尚未设置学习目标'}</div>
                <div className="project-meta">
                  <span>
                    {count} 道题 · {project.dailyTimeBudget} 分钟 / 天
                  </span>
                  <ArrowRight size={17} />
                </div>
                {project.targetDate && <small>目标日期：{project.targetDate}</small>}
              </a>
            );
          })}
        </div>
      ) : (
        <div className="empty-card spacious">
          <BookOpen size={38} strokeWidth={1.2} />
          <h2>你的第一个学习项目</h2>
          <p>选择一个具体的目标，添加问答，然后开始主动回忆。</p>
          <button className="button" onClick={onCreate}>
            <Plus size={16} /> 创建第一个项目
          </button>
        </div>
      )}
    </>
  );
}

export function ProjectDetail({
  project,
  data,
  onEdit,
  onDelete,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onStart,
  busy,
}: {
  project: LearningProject;
  data: WorkspaceData;
  onEdit: () => void;
  onDelete: () => void;
  onAddCard: () => void;
  onEditCard: (card: PracticeItem) => void;
  onDeleteCard: (card: PracticeItem) => void;
  onStart: () => void;
  busy: boolean;
}) {
  const [search, setSearch] = useState('');
  const cards = data.cards.filter((card) => card.projectId === project.id);
  const matching = cards.filter((card) =>
    card.question.toLowerCase().includes(search.toLowerCase()),
  );
  const active = data.sessions.find(
    (session) => session.projectId === project.id && session.status === 'active',
  );
  const events = data.events.filter((event) => event.projectId === project.id);
  const learned = new Set(
    events
      .filter((event) => event.assessmentResult !== 'skipped')
      .map((event) => event.practiceItemId),
  );
  return (
    <>
      <a href="#projects" className="text-link breadcrumb">
        学习项目 / 题库
      </a>
      <div className="page-heading">
        <div>
          <h1>{project.name}</h1>
          <p className="page-intro">
            {project.description || '每一道题，都是一次主动回忆的机会。'}
          </p>
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={onEdit}>
            <Pencil size={15} /> 编辑项目
          </button>
          <button className="icon-button danger-text" aria-label="删除项目" onClick={onDelete}>
            <Trash2 size={18} />
          </button>
        </div>
      </div>
      <div className="project-banner">
        <div>
          <span className="section-kicker">学习目标</span>
          <h2>{project.learningGoal || '从准确回答这些问题开始。'}</h2>
          <p>
            {cards.length} 道题 · 已学习 {cards.filter((card) => learned.has(card.id)).length} 道 ·{' '}
            {events.length} 条练习记录 · 每日计划 {project.dailyTimeBudget} 分钟
            {project.targetDate ? ` · 目标 ${project.targetDate}` : ''}
          </p>
        </div>
        <button className="button" disabled={busy || !cards.length} onClick={onStart}>
          <Play size={17} />{' '}
          {active ? `继续学习 (${active.index}/${active.queue.length})` : '开始学习'}
        </button>
      </div>
      {active && (
        <p className="info-note">
          当前学习轮次使用开始时的题目快照。新增与修改将在下一轮生效；请先完成本轮再删除题目。
        </p>
      )}
      <div className="section-heading">
        <h2>
          问答题库 <span>{cards.length}</span>
        </h2>
        <div className="button-row">
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="搜索题目"
              placeholder="搜索问题…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button className="button" onClick={onAddCard}>
            <Plus size={16} /> 添加问答题
          </button>
        </div>
      </div>
      {matching.length ? (
        <div className="card-list">
          {matching.map((card, index) => {
            const last = events
              .filter(
                (event) => event.practiceItemId === card.id && event.subjectiveMastery !== null,
              )
              .at(-1);
            return (
              <article className="library-card" key={card.id}>
                <div className="library-card-main">
                  <span className="card-number">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{card.question}</h3>
                    <div className="card-tags">
                      <span>自由回忆</span>
                      <span>{card.hints.length} 条提示</span>
                      <span>修订 {card.revision}</span>
                      {last?.subjectiveMastery !== undefined && last.subjectiveMastery !== null && (
                        <span className="tag">
                          最近自评：{masteryLabels[last.subjectiveMastery]}
                        </span>
                      )}
                    </div>
                    <details className="library-answer">
                      <summary>查看标准答案</summary>
                      <p className="preserve-lines">{card.standardAnswer}</p>
                    </details>
                  </div>
                </div>
                <div className="card-controls">
                  <button
                    className="icon-button"
                    aria-label={`编辑题目：${card.question}`}
                    onClick={() => onEditCard(card)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button danger-text"
                    disabled={!!active}
                    aria-label={`删除题目：${card.question}`}
                    onClick={() => onDeleteCard(card)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-card spacious">
          <Layers3 size={32} strokeWidth={1.2} />
          <h3>{search ? '没有找到相关问题' : '先添加第一道问答题'}</h3>
          <p>{search ? '试试其他关键词。' : '写下问题与标准答案，就可以开始一轮学习。'}</p>
          {!search && (
            <button className="button" onClick={onAddCard}>
              <Plus size={16} /> 添加问答题
            </button>
          )}
        </div>
      )}
    </>
  );
}

export function History({ data }: { data: WorkspaceData }) {
  const [projectId, setProjectId] = useState('');
  const events = data.events
    .filter((event) => !projectId || event.projectId === projectId)
    .slice()
    .reverse();
  return (
    <>
      <div className="eyebrow">EVERY ATTEMPT LEAVES A TRACE</div>
      <div className="page-heading">
        <div>
          <h1>学习记录</h1>
          <p className="page-intro">原始作答、自行核对与主观评价，各自保留。</p>
        </div>
        <label className="filter-label">
          筛选项目
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">全部项目</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="info-note">
        当前核对均由你自行完成，没有系统自动评分。记录中的“无提示回忆”描述作答条件，不代表答案正确。M1
        尚未启用间隔调度。
      </p>
      {events.length ? (
        <div className="history-list">
          {events.map((event) => (
            <details className="history-entry" key={event.id}>
              <summary>
                <div>
                  <small>
                    {data.projects.find((project) => project.id === event.projectId)?.name} ·{' '}
                    {dateTime(event.timestamp)}
                  </small>
                  <h3>{event.snapshot.question}</h3>
                  <div className="card-tags">
                    <span>{event.responseMode === 'quick' ? '快速回忆' : '输入作答'}</span>
                    <span>
                      {event.hintLevelUsed ? `${event.hintLevelUsed} 条提示` : '未使用提示'}
                    </span>
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
                    {event.confidenceBeforeReveal === null
                      ? '未填写'
                      : event.confidenceBeforeReveal}
                  </span>
                  <span>作答用时（含暂停）：{Math.round(event.responseDuration / 1000)} 秒</span>
                  <span>题目修订：{event.snapshot.revision}</span>
                </div>
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
      ) : (
        <div className="empty-card spacious">
          <Clock3 size={36} strokeWidth={1.2} />
          <h3>每一次尝试，都值得记录。</h3>
          <p>完成学习并保存评价后，在这里回看真实的学习过程。</p>
          <a href="#projects" className="button">
            前往学习项目 <ArrowRight size={16} />
          </a>
        </div>
      )}
    </>
  );
}
