import { useEffect, useState } from 'react';
import { checkModel, type ModelAvailability } from '../ai/availability';
import type { ProviderConfig } from '../ai/protocol';
interface LocalStatus {
  token: string;
  models: {
    id: string;
    name: string;
    endpoint: string;
    model: string;
    installed: boolean;
    temporary: boolean;
    bytes: number;
    owned: boolean;
    running: boolean;
  }[];
  adoption?: { bytes: number; free: number; available: boolean };
}
export function ModelStatus({
  config,
  onConfig,
  disabled = false,
}: {
  disabled?: boolean;
  config: ProviderConfig;
  onConfig: (p: Partial<ProviderConfig>) => void;
}) {
  const [state, setState] = useState<ModelAvailability | null>(null),
    [local, setLocal] = useState<LocalStatus | null>(null),
    [message, setMessage] = useState(''),
    [allowStart, setAllowStart] = useState(false),
    [allowCopy, setAllowCopy] = useState(false),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), 5000);
    let alive = true;
    void checkModel(config, control.signal).then((s) => {
      if (alive) setState(s);
    });
    void fetch('/local-ai/status', { signal: control.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (alive && s?.models && typeof s.token === 'string') setLocal(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
      control.abort();
      clearTimeout(timer);
    };
  }, [config, retry]);
  async function command(action: string, id?: string) {
    if (!local) return;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(`/local-ai/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-RecallLab-Token': local.token },
        body: JSON.stringify({ id, consent: action === 'adopt' ? allowCopy : allowStart }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message || '本机操作未完成');
      setMessage(data.message);
      setRetry((n) => n + 1);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '本机操作未完成');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="info-note" aria-label="本机模型状态">
      <strong>本机 AI 状态</strong>
      <p role="status">{state?.message ?? '正在检测服务和模型…'}</p>
      <button
        className="button secondary"
        type="button"
        disabled={busy || disabled}
        onClick={() => setRetry((n) => n + 1)}
      >
        重新检测模型
      </button>
      {state?.status === 'missing-model' && state.models.length > 0 && (
        <label>
          已安装模型
          <select
            disabled={disabled || busy}
            value=""
            onChange={(e) => onConfig({ model: e.target.value })}
          >
            <option value="">请选择</option>
            {state.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.bytes ? ` · ${(m.bytes / 1024 ** 3).toFixed(2)} GB` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <p>
        CPU 模型可能占用数 GB 内存，生成可能较慢或遗漏内容。模型已连接不代表生成质量可靠。Mock
        只用于演示。
      </p>
      {local ? (
        <>
          <p>
            本机启动器已连接。模型只在你明确点击时启动，关闭启动器会停止由它启动的模型；不设置开机服务。
          </p>
          {local.models.map((m) => (
            <div key={m.id}>
              <p>
                {m.name} · {m.installed ? '运行文件已找到' : '缺少运行器或模型文件'} ·{' '}
                {(m.bytes / 1024 ** 3).toFixed(2)} GB{' '}
                {m.temporary ? '· 仍在临时目录，重启可能丢失' : ''}
              </p>
              <button
                className="button secondary"
                disabled={busy || disabled}
                onClick={() =>
                  onConfig({ kind: 'compatible', endpoint: m.endpoint, model: m.model, apiKey: '' })
                }
              >
                使用 {m.name}
              </button>
              {!m.running && (
                <button
                  className="button"
                  disabled={busy || disabled || !m.installed || !allowStart}
                  onClick={() => void command('start', m.id)}
                >
                  按需启动 {m.name}
                </button>
              )}
              {m.owned && (
                <button
                  className="button secondary"
                  disabled={busy || disabled || !allowStart}
                  onClick={() => void command('stop', m.id)}
                >
                  停止本次模型
                </button>
              )}
            </div>
          ))}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={allowStart}
              onChange={(e) => setAllowStart(e.target.checked)}
            />
            同意本次按需启动或停止已安装模型（不下载、不安装系统软件）
          </label>
          {local.adoption?.available && (
            <>
              <p>
                可把已下载运行环境保存到持久目录：约 {(local.adoption.bytes / 1024 ** 3).toFixed(2)}{' '}
                GB；当前可用 {(local.adoption.free / 1024 ** 3).toFixed(2)}{' '}
                GB。本机复制，不联网下载；保存后至少保留 2 GB 可用空间。
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={allowCopy}
                  onChange={(e) => setAllowCopy(e.target.checked)}
                />
                同意占用上述空间保存已有模型与运行器
              </label>
              <button
                className="button secondary"
                disabled={
                  busy || !allowCopy || local.adoption.free < local.adoption.bytes + 2 * 1024 ** 3
                }
                onClick={() => void command('adopt')}
              >
                保存现有模型到持久目录
              </button>
            </>
          )}
        </>
      ) : (
        <p>
          网页不能自行安装或启动系统程序。需要恢复本机服务时，在项目目录双击“打开RecallLab.sh”启动按需启动器，再回到此页；没有模型文件时会明确提示，不会自动下载。也可使用已安装的
          Ollama。
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
