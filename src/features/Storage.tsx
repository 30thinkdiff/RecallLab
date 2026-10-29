import { portableBackup, parsePortableBackup } from '../persistence/portable-backup';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { db } from '../persistence/database';
import {
  downloadJson,
  exportBackup,
  inspectBeforeUpgrade,
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
            发现旧版学习数据：{backup.data.projects.length} 个项目，
            {backup.data.practiceItems.length} 道题，{backup.data.reviewEvents.length}{' '}
            条学习记录（包含归档内容）。
          </p>
          <p>
            请先下载完整 JSON
            并妥善保存。升级将保留原始历史，并在本地保留额外恢复副本；失败时回滚，不清空数据库。升级后请使用当前或更新版本；旧程序可能忽略新增资料信息，不支持降级编辑。
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
  const [filename, setFilename] = useState('');
  const readVersion = useRef(0);
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
        <p>
          请定期下载并妥善保存。JSON 含你的学习资料、原始回答及 AI
          草稿，导出不会上传，不含接口密钥。大型数据自动将重复原文无损去重，不删除证据。支持50
          MB文件、展开后最多128 MB；旧版程序不能恢复去重格式。
        </p>
        <button
          className="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const backup = await exportBackup(db);
              const artifact = await portableBackup(backup);
              downloadJson(artifact.value);
              setMessage(
                `已生成${artifact.pooled ? '来源去重备份（需V0.5.2或更新版恢复）' : '兼容备份'} ${(artifact.fileBytes / 1024 ** 2).toFixed(2)} MB，原始数据 ${(artifact.logicalBytes / 1024 ** 2).toFixed(2)} MB，包含 ${backup.data.aiDrafts.length} 份草稿。请妥善保存私人文件。`,
              );
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
              const version = ++readVersion.current;
              setFilename(file?.name ?? '');
              setCandidate(null);
              setConfirmed(false);
              setFileError('');
              setMessage('');
              if (file) {
                if (file.size > 128 * 1024 * 1024) {
                  setFileError('备份超过 128 MB');
                  return;
                }
                void file
                  .text()
                  .then(parsePortableBackup)
                  .then((backup) => {
                    if (version === readVersion.current) setCandidate(backup);
                  })
                  .catch((cause: unknown) => {
                    if (version === readVersion.current) setFileError(errorMessage(cause));
                  });
              }
            }}
          />
        </label>
        {candidate && (
          <div className="restore-preview">
            <h3>备份预览 · 数据库 v{candidate.databaseVersion}</h3>
            {candidate.databaseVersion < 4 && (
              <p className="info-note">
                此旧备份不含正式间隔复习状态。恢复后保留旧学习记录，调度从新评价开始；恢复前仍会保护当前完整数据。
              </p>
            )}
            <p className="muted">
              {filename} · 导出时间 {candidate.createdAt}
            </p>
            <p>
              {candidate.data.projects.length} 个项目 · {candidate.data.practiceItems.length} 道题 ·{' '}
              {candidate.data.reviewEvents.length} 条事件 · {candidate.data.revisions.length} 个修订
              · {candidate.data.sourceDocuments.length} 份资料 ·{' '}
              {candidate.data.memoryStates.length} 个记忆状态 ·{' '}
              {candidate.data.schedulingLogs.length} 条调度决策 · {candidate.data.aiDrafts.length}{' '}
              份 AI 草稿
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
