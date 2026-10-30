import { OfflineStatus } from './features/OfflineStatus';
import { useEffect, useState, lazy, Suspense } from 'react';
import { useWorkspaceData } from './features/workspace-data';
import { BookOpen, Clock3, FlaskConical, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { repository } from './persistence/repository';
import { DataBoundary, ConfirmDialog, ErrorNotice } from './components/shared';
import { useAction } from './components/actions';
import { CardForm, ProjectForm } from './features/Forms';
import { History, Overview, ProjectDetail, Projects } from './features/Workspace';
import { PendingPrompts } from './features/PendingPrompts';
const LearningHome = lazy(() =>
  import('./features/GoalLearning').then((m) => ({ default: m.LearningHome })),
);
const GoalLearning = lazy(() =>
  import('./features/GoalLearning').then((m) => ({ default: m.GoalLearning })),
);
const AiEvaluation = lazy(() =>
  import('./features/AiEvaluation').then((m) => ({ default: m.AiEvaluation })),
);
const AiDrafts = lazy(() => import('./features/AiDrafts').then((m) => ({ default: m.AiDrafts })));
const AiWorkspace = lazy(() =>
  import('./features/AiWorkspace').then((m) => ({ default: m.AiWorkspace })),
);
const QuestionQuality = lazy(() =>
  import('./features/QuestionQuality').then((m) => ({ default: m.QuestionQuality })),
);
const DailyReview = lazy(() =>
  import('./features/DailyReview').then((m) => ({ default: m.DailyReview })),
);
const Study = lazy(() => import('./features/Study').then((m) => ({ default: m.Study })));
import type { LearningProject, PracticeItem } from './domain/models';
const ImportPage = lazy(() =>
  import('./features/ImportPage').then((module) => ({ default: module.ImportPage })),
);
import { Documents, DocumentDetail } from './features/Documents';
import { ItemDetail } from './features/ItemDetail';
import { ArchivePage } from './features/Archive';
import { StorageGate, BackupPage } from './features/Storage';

type ModalState =
  | { type: 'project'; project?: LearningProject }
  | { type: 'card'; projectId: string; card?: PracticeItem }
  | { type: 'deleteProject'; project: LearningProject }
  | { type: 'deleteCard'; card: PracticeItem }
  | null;

export function App() {
  return (
    <DataBoundary>
      <StorageGate>
        <Workspace />
      </StorageGate>
    </DataBoundary>
  );
}

function Workspace() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'home');
  const [modal, setModal] = useState<ModalState>(null);
  const action = useAction();
  useEffect(() => {
    const onChange = () => setRoute(location.hash.slice(1) || 'home');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const rawData = useWorkspaceData(route);
  const projects =
    rawData?.projects
      .filter((project) => !project.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) ?? [];
  const ids = new Set(projects.map((project) => project.id));
  const data = {
    projects,
    allCards: rawData?.cards ?? [],
    allEvents:
      rawData?.events
        .slice()
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)) ?? [],
    allProjects: rawData?.projects ?? [],
    revisions: rawData?.revisions ?? [],
    draftRecoveries: rawData?.draftRecoveries ?? [],
    cards:
      rawData?.cards
        .filter((card) => !card.archivedAt && ids.has(card.projectId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) ?? [],
    events:
      rawData?.events
        .filter((event) => ids.has(event.projectId))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)) ?? [],
    sessions: rawData?.sessions.filter((session) => ids.has(session.projectId)) ?? [],
  };
  const [section, id, aiId] = route.split('/');
  const project = data.projects.find((project) => project.id === id);
  const session = data.sessions.find((session) => session.id === id);
  const item = data.allCards.find((card) => card.id === id);
  const createProject = () => setModal({ type: 'project' });
  const activePage = [
    'home',
    'overview',
    'learn',
    'goals',
    'import-task',
    'history',
    'backup',
    'archive',
    'import',
    'documents',
    'daily',
    'document',
    'ai-drafts',
    'ai-evaluation',
  ].includes(section ?? '')
    ? section
    : 'projects';
  return (
    <div className="app-shell">
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        跳到主要内容
      </a>
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="RecallLab 首页">
          <span className="brand-icon">
            <FlaskConical size={25} />
          </span>
          <span>
            RecallLab<small>记忆实验室</small>
          </span>
        </a>
        <div className="nav-label">学习工作台</div>
        <nav aria-label="主导航">
          {[
            { name: '创建学习任务', route: 'import-task', icon: BookOpen },
            { name: '继续今天学习', route: 'goals', icon: Clock3 },
            { name: '学习进展', route: 'home', icon: LayoutDashboard },
            { name: '学习项目', route: 'projects', icon: BookOpen },
          ].map(({ name, route, icon: Icon }) => (
            <a key={route} href={`#${route}`} className="nav-item">
              <Icon size={19} />
              {name}
            </a>
          ))}
          <details
            open={
              !['home', 'learn', 'goals', 'import-task'].includes(section ?? 'home') &&
              !(section === 'study' && session?.reviewPlan?.compact)
            }
          >
            <summary>高级功能与完整记录</summary>
            {[
              { name: '学习概览', route: 'overview', icon: LayoutDashboard },
              { name: '今日复习', route: 'daily', icon: Clock3 },
              { name: '学习记录', route: 'history', icon: Clock3 },
              { name: '备份与恢复', route: 'backup', icon: ShieldCheck },
              { name: '归档内容', route: 'archive', icon: BookOpen },
              { name: '导入资料', route: 'import', icon: BookOpen },
              { name: '学习资料', route: 'documents', icon: BookOpen },
              { name: 'AI 整理草稿', route: 'ai-drafts', icon: FlaskConical },
            ].map(({ name, route, icon: Icon }) => (
              <a
                key={route}
                href={`#${route}`}
                className={activePage === route ? 'nav-item active' : 'nav-item'}
                aria-current={activePage === route ? 'page' : undefined}
              >
                <Icon size={19} />
                {name}
              </a>
            ))}
          </details>
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={18} />
          <strong>你的学习，保存在本地</strong>
          <p>
            无需账号，无需 AI 密钥。
            <br />
            清除浏览器数据会丢失记录。
          </p>
        </div>
        <div className="sidebar-footer">
          RECALL. REFLECT. REPEAT.<span>0.6 · 目标驱动学习</span>
          <OfflineStatus />
        </div>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <header className="topbar">
          <span>
            个人学习空间 <span className="topbar-separator">/</span>{' '}
            {
              {
                home: '学习进展',
                overview: '完整学习概览',
                learn: '目标与计划',
                goals: '继续学习',
                'import-task': '创建学习任务',
                daily: '今日复习',
                history: '学习记录',
                projects: '学习项目',
                backup: '备份与恢复',
                archive: '归档内容',
                import: '导入资料',
                documents: '学习资料',
                'ai-drafts': 'AI 整理草稿',
                'ai-evaluation': '模型效果评测',
                document: '原文资料',
              }[activePage ?? 'projects']
            }
          </span>
          <span className="local-badge">
            <i /> 数据保存在当前浏览器
          </span>
        </header>
        <div className="page-content">
          <ErrorNotice message={action.error} />
          {!rawData ? (
            <p role="status">正在读取本地学习数据…</p>
          ) : section === 'home' ? (
            <Suspense fallback={<p>正在读取学习进展…</p>}>
              <LearningHome
                projects={data.projects}
                sessions={data.sessions}
                onCreate={createProject}
              />
            </Suspense>
          ) : section === 'overview' ? (
            <Overview data={data} onCreate={createProject} />
          ) : section === 'learn' || section === 'goals' ? (
            <Suspense fallback={<p>正在规划…</p>}>
              <GoalLearning
                key={id ?? 'goals'}
                projectId={
                  id ??
                  (section === 'goals'
                    ? data.sessions.find((s) => s.reviewPlan?.adaptive)?.projectId
                    : undefined)
                }
              />
            </Suspense>
          ) : section === 'daily' ? (
            <Suspense fallback={<p role="status">正在准备今日复习…</p>}>
              <DailyReview
                key={id ?? 'daily'}
                initialProjectId={id}
                onEditProject={(pid) => {
                  const p = data.projects.find((p) => p.id === pid);
                  if (p) setModal({ type: 'project', project: p });
                }}
              />
            </Suspense>
          ) : section === 'projects' ? (
            <Projects data={data} onCreate={createProject} />
          ) : section === 'history' ? (
            <History data={data} />
          ) : section === 'ai-evaluation' ? (
            <Suspense fallback={<p>正在读取固定评测…</p>}>
              <AiEvaluation />
            </Suspense>
          ) : section === 'ai-drafts' ? (
            <Suspense fallback={<p>正在读取草稿…</p>}>
              <AiDrafts />
            </Suspense>
          ) : section === 'import' || section === 'import-task' ? (
            <Suspense fallback={<p role="status">正在准备资料导入…</p>}>
              <ImportPage
                key={id ?? 'import'}
                projects={data.projects}
                cards={data.allCards}
                initialProjectId={id}
                goalFlow={section === 'import-task'}
                onManualCreate={(projectId) =>
                  setModal(projectId ? { type: 'card', projectId } : { type: 'project' })
                }
              />
            </Suspense>
          ) : section === 'ai' && id && aiId ? (
            <Suspense fallback={<p role="status">正在准备 AI 辅助整理…</p>}>
              <AiWorkspace key={`${id}/${aiId}`} kind={id} id={aiId} cards={data.allCards} />
            </Suspense>
          ) : section === 'documents' ? (
            <Documents projects={data.allProjects} />
          ) : section === 'document' && id ? (
            <DocumentDetail
              key={id}
              documentId={id}
              projects={data.allProjects}
              cards={data.allCards}
              page={route.split('/')[2]}
            />
          ) : section === 'item' && item ? (
            <ItemDetail key={`${item.id}:${item.currentRevisionId}`} item={item} data={data} />
          ) : section === 'archive' ? (
            <ArchivePage projects={data.allProjects} cards={data.allCards} />
          ) : section === 'backup' ? (
            <BackupPage />
          ) : section === 'quality' && id ? (
            <Suspense fallback={<p role="status">正在准备题目质量核对…</p>}>
              <QuestionQuality
                projectId={id}
                cards={data.allCards}
                onEdit={(card) => setModal({ type: 'card', projectId: card.projectId, card })}
              />
            </Suspense>
          ) : section === 'pending' && id ? (
            <PendingPrompts projectId={id} cards={data.allCards} />
          ) : section === 'project' && project ? (
            <ProjectDetail
              key={project.id}
              project={project}
              data={data}
              busy={action.busy}
              onEdit={() => setModal({ type: 'project', project })}
              onDelete={() => setModal({ type: 'deleteProject', project })}
              onAddCard={() => setModal({ type: 'card', projectId: project.id })}
              onEditCard={(card) => setModal({ type: 'card', projectId: project.id, card })}
              onDeleteCard={(card) => setModal({ type: 'deleteCard', card })}
              onStart={() =>
                void action.run(async () => {
                  const id = await repository.startSession(project.id);
                  location.hash = `study/${id}`;
                })
              }
            />
          ) : section === 'study' && session ? (
            <Suspense fallback={<p role="status">正在准备学习页面…</p>}>
              <Study
                session={session}
                events={data.events}
                cards={data.allCards}
                projectName={
                  data.projects.find((project) => project.id === session.projectId)?.name ?? ''
                }
              />
            </Suspense>
          ) : (
            <div className="empty-card spacious">
              <h1>没有找到此内容</h1>
              <p>项目可能已删除，或链接已失效。</p>
              <a className="button" href="#projects">
                返回学习项目
              </a>
            </div>
          )}
        </div>
      </main>
      {modal?.type === 'project' && (
        <ProjectForm
          project={modal.project}
          onClose={() => setModal(null)}
          onSaved={(id) => {
            setModal(null);
            location.hash = section === 'daily' ? `daily/${id}` : `project/${id}`;
          }}
        />
      )}
      {modal?.type === 'card' && (
        <CardForm projectId={modal.projectId} card={modal.card} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'deleteProject' && (
        <ConfirmDialog
          title="删除学习项目"
          description={`确定删除“${modal.project.name}”？项目和题库将从工作台隐藏。历史数据会保留，可从“归档内容”查看和恢复。`}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await repository.archiveProject(modal.project.id);
            location.hash = 'projects';
          }}
        />
      )}
      {modal?.type === 'deleteCard' && (
        <ConfirmDialog
          title="删除问答题"
          description="题目将从题库中隐藏，已有学习记录及当时的答案快照会保留。"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await repository.archiveCard(modal.card.projectId, modal.card.id);
          }}
        />
      )}
    </div>
  );
}
