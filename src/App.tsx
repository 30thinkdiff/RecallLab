import { useState } from 'react';
import { BookOpen, FlaskConical, LayoutDashboard, ShieldCheck } from 'lucide-react';

export function App() {
  const [page, setPage] = useState('overview');
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="RecallLab 首页">
          <span className="brand-icon">
            <FlaskConical size={25} />
          </span>
          <span>
            RecallLab<small>记忆实验室</small>
          </span>
        </a>
        <div className="nav-label">学习工作台</div>
        <nav aria-label="主导航">
          <button
            className={page === 'overview' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('overview')}
          >
            <LayoutDashboard size={19} /> 学习概览
          </button>
          <button
            className={page === 'projects' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('projects')}
          >
            <BookOpen size={19} /> 学习项目
          </button>
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={18} />
          <strong>你的学习，保存在本地</strong>
          <p>无需账号，无需 AI 密钥。</p>
        </div>
        <div className="sidebar-footer">
          RECALL. REFLECT. REPEAT.<span>M0 · 工程基础</span>
        </div>
      </aside>
      <main id="main-content">
        <header className="topbar">
          <span>个人学习空间</span>
          <span className="local-badge">
            <i /> 本地优先
          </span>
        </header>
        <div className="page-content">
          <div className="eyebrow">YOUR LEARNING, WITH EVIDENCE</div>
          <h1>{page === 'overview' ? '让每一次回忆，都有收获。' : '学习项目'}</h1>
          <p className="page-intro">从主动回忆开始，把熟悉的知识变成真正记得住的知识。</p>
          <section className="welcome-panel">
            <span className="section-kicker">从这里开始</span>
            <h2>留一点空间，给下一次想起来。</h2>
            <p>RecallLab 工程基础已就绪。下一步将加入项目、问答题与本地学习记录。</p>
            <div className="process-line">
              <span>建立项目</span>
              <b>→</b>
              <span>主动回忆</span>
              <b>→</b>
              <span>记录与反思</span>
            </div>
          </section>
          <p className="muted">M0 体验检查点 · 当前尚未开放学习功能。</p>
        </div>
      </main>
    </div>
  );
}
