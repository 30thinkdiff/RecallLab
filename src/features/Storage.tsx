import { useEffect, useState, type ReactNode } from 'react';
import { db } from '../persistence/database';
import {
  downloadJson,
  exportBackup,
  inspectBeforeUpgrade,
  parseBackup,
  restoreBackup,
} from '../persistence/backup';
import type { Backup } from '../persistence/backup-format';
import { ErrorNotice } from '../components/shared';
import { errorMessage, useAction } from '../components/actions';
import { useLiveQuery } from 'dexie-react-hooks';

export function StorageGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'backup' | 'ready'>('checking');
  const [backup, setBackup] = useState<Backup | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState('');
  const action = useAction();
  useEffect(() => {
    let cancelled = false;
    void inspectBeforeUpgrade(db.name)
      .then((backup) => {
        if (!cancelled) {
          setBackup(backup);
          setState(backup ? 'backup' : 'ready');
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (state === 'ready') return children;
  return (
    <main className="page-content storage-gate">
      <h1>{state === 'backup' ? '先备份，再升级学习数据' : '检查本地数据'}</h1>
      <ErrorNotice message={error || action.error} />
      {backup ? (
        <>
          <p>
            发现 M0/M1 数据：{backup.data.projects.length} 个项目，
            {backup.data.practiceItems.length} 道题，{backup.data.reviewEvents.length}{' '}
            条学习记录（包含归档内容）。
          </p>
          <p>
            请先下载完整 JSON
            并妥善保存。升级将保留原始历史，并在本地保留额外恢复副本；失败时回滚，不清空数据库。
          </p>
          <div className="button-row">
            <button
              className="button"
              onClick={() => {
                downloadJson(backup);
                setDownloaded(true);
              }}
            >
              下载升级前备份
            </button>
            <button
              className="button secondary"
              disabled={!downloaded || action.busy}
              onClick={() =>
                void action.run(async () => {
                  await db.open();
                  setState('ready');
                })
              }
            >
              已保存备份，升级并继续
            </button>
          </div>
        </>
      ) : (
        <p role="status">
          {error ? '请保留浏览器数据，不要清除网站存储。' : '正在检查，不会自动删除数据…'}
        </p>
      )}
    </main>
  );
}

export function BackupPage() {
  const [candidate, setCandidate] = useState<Backup | null>(null);
  const [fileError, setFileError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const action = useAction();
  const copies = useLiveQuery(() => db.recoveryBackups.orderBy('createdAt').reverse().toArray());
  return (
    <>
      <div className="eyebrow">YOUR DATA, UNDER YOUR CONTROL</div>
      <h1>备份与恢复</h1>
      <p className="page-intro">
        完整保存项目、归档内容、题目版本、轮次、原始作答和暂存副本。文件只在你的设备上处理。
      </p>
      <section className="question-panel">
        <h2>导出完整 JSON</h2>
        <p>请定期下载并妥善保存。JSON 含你的学习资料和原始回答，导出不会上传。</p>
        <button
          className="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              downloadJson(await exportBackup(db));
              setMessage('已生成备份下载，请检查浏览器下载目录。');
            })
          }
        >
          导出完整备份
        </button>
        <h2>从备份恢复</h2>
        <p className="info-note">
          恢复将替换当前学习数据。确认前会校验结构与引用，事务内自动保留当前数据副本；失败将整体回滚。
        </p>
        <label>
          选择 JSON 备份
          <input
            type="file"
            accept="application/json,.json"
            disabled={action.busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              setCandidate(null);
              setConfirmed(false);
              setFileError('');
              setMessage('');
              if (file) {
                if (file.size > 50 * 1024 * 1024) {
                  setFileError('备份超过 50 MB');
                  return;
                }
                void file
                  .text()
                  .then((text) => setCandidate(parseBackup(text)))
                  .catch((cause: unknown) => setFileError(errorMessage(cause)));
              }
            }}
          />
        </label>
        {candidate && (
          <div className="restore-preview">
            <h3>备份预览 · 数据库 v{candidate.databaseVersion}</h3>
            <p>
              {candidate.data.projects.length} 个项目 · {candidate.data.practiceItems.length} 道题 ·{' '}
              {candidate.data.reviewEvents.length} 条事件 · {candidate.data.revisions.length} 个修订
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              我确认以此备份替换当前数据
            </label>
            <button
              className="button danger"
              disabled={!confirmed || action.busy}
              onClick={() =>
                void action.run(async () => {
                  await restoreBackup(db, candidate);
                  setCandidate(null);
                  setConfirmed(false);
                  setMessage('恢复成功。已保留恢复前副本；请回到项目检查数据。');
                })
              }
            >
              确认恢复备份
            </button>
          </div>
        )}
        <ErrorNotice message={fileError || action.error} />
        {message && <p role="status">{message}</p>}
      </section>
      <section>
        <h2>自动保护副本</h2>
        <p className="muted">
          迁移及恢复前的原始副本保存在本地；不会递归包含在普通导出文件中。可下载后通过上方入口恢复。
        </p>
        {copies?.length ? (
          copies.map((copy) => (
            <div className="recovery-row" key={copy.id}>
              <span>
                {copy.reason === 'migration' ? '升级前' : '恢复前'} · {copy.createdAt}
              </span>
              <button
                className="button secondary"
                onClick={() =>
                  downloadJson(
                    JSON.parse(copy.json) as unknown,
                    `RecallLab-recovery-${copy.id}.json`,
                  )
                }
              >
                下载保护副本
              </button>
            </div>
          ))
        ) : (
          <p>暂无自动副本。</p>
        )}
      </section>
    </>
  );
}
