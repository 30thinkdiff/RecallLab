import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Clock3, FlaskConical, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { db } from './persistence/database';
import { repository } from './persistence/repository';
import { DataBoundary, ConfirmDialog, ErrorNotice } from './components/shared';
import { useAction } from './components/actions';
import { CardForm, ProjectForm } from './features/Forms';
import { History, Overview, ProjectDetail, Projects } from './features/Workspace';
import { Study } from './features/Study';
import type { LearningProject, PracticeItem } from './domain/models';
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
  const rawData = useLiveQuery(async () => {
    return db.transaction(
      'r',
      [
        db.projects,
        db.practiceItems,
        db.reviewEvents,
        db.sessions,
        db.revisions,
        db.draftRecoveries,
      ],
      async () => {
        const [projects, cards, events, sessions, revisions, draftRecoveries] = await Promise.all([
          db.projects.toArray(),
          db.practiceItems.toArray(),
          db.reviewEvents.toArray(),
          db.sessions.toArray(),
          db.revisions.toArray(),
          db.draftRecoveries.toArray(),
        ]);
        return { projects, cards, events, sessions, revisions, draftRecoveries };
      },
    );
  });
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
  const [section, id] = route.split('/');
  const project = data.projects.find((project) => project.id === id);
  const session = data.sessions.find((session) => session.id === id);
  const item = data.allCards.find((card) => card.id === id);
  const createProject = () => setModal({ type: 'project' });
  const activePage = ['home', 'history', 'backup', 'archive'].includes(section ?? '')
    ? section
    : 'projects';
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
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
            { name: '学习概览', route: 'home', icon: LayoutDashboard },
            { name: '学习项目', route: 'projects', icon: BookOpen },
            { name: '学习记录', route: 'history', icon: Clock3 },
            { name: '备份与恢复', route: 'backup', icon: ShieldCheck },
            { name: '归档内容', route: 'archive', icon: BookOpen },
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
          RECALL. REFLECT. REPEAT.<span>M1 · 主动回忆学习闭环</span>
        </div>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <header className="topbar">
          <span>
            个人学习空间 <span className="topbar-separator">/</span>{' '}
            {activePage === 'home'
              ? '学习概览'
              : activePage === 'history'
                ? '学习记录'
                : '学习项目'}
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
            <Overview data={data} onCreate={createProject} />
          ) : section === 'projects' ? (
            <Projects data={data} onCreate={createProject} />
          ) : section === 'history' ? (
            <History data={data} />
          ) : section === 'item' && item ? (
            <ItemDetail key={`${item.id}:${item.currentRevisionId}`} item={item} data={data} />
          ) : section === 'archive' ? (
            <ArchivePage projects={data.allProjects} cards={data.allCards} />
          ) : section === 'backup' ? (
            <BackupPage />
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
            <Study
              session={session}
              events={data.events}
              cards={data.allCards}
              projectName={
                data.projects.find((project) => project.id === session.projectId)?.name ?? ''
              }
            />
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
            location.hash = `project/${id}`;
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
