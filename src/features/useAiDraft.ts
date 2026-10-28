import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
import type { GenerationState } from '../ai/generation';
import type { AiSource } from '../ai/evidence';
import type { ProviderConfig } from '../ai/protocol';
import { loadAiDraft, saveAiDraft, deleteAiDraft, tokenFor } from '../ai/drafts-store';
import type { DraftToken } from '../ai/drafts-format';
import { errorMessage } from '../components/actions';
export type LoadedDraft = NonNullable<Awaited<ReturnType<typeof loadAiDraft>>>;
export function useAiDraft(key: string, onRestore: (loaded: LoadedDraft | null) => void) {
  const writer = useRef(crypto.randomUUID()),
    token = useRef<DraftToken | null>(null),
    pinned = useRef<AiSource[]>([]),
    mounted = useRef(true),
    blocked = useRef(false);
  const [loaded, setLoaded] = useState(false),
    [status, setStatus] = useState('正在查找本地草稿…'),
    [error, setError] = useState(''),
    [stale, setStale] = useState<string[]>([]),
    [saving, setSaving] = useState(false);
  const pending = useRef<{
      state: GenerationState;
      sources: AiSource[];
      config: ProviderConfig;
      projectId: string;
    } | null>(null),
    drain = useRef<Promise<void> | null>(null);
  const head = useLiveQuery(async () => {
    const row = await db.aiDrafts.get(key);
    return row ? { epoch: row.epoch, version: row.version, writerId: row.writerId } : null;
  }, [key]);
  useEffect(() => {
    if (!loaded || head === undefined || !token.current) return;
    if (
      (!head || head.epoch !== token.current.epoch || head.version !== token.current.version) &&
      head?.writerId !== writer.current
    ) {
      blocked.current = true;
      setError(
        '另一标签页或恢复操作已更新草稿。当前输入保留在此页面，未覆盖新版本；请导出或载入最新草稿。',
      );
    }
  }, [head, loaded]);
  const sequence = useRef(0);
  const install = useCallback(
    (value: LoadedDraft | null) => {
      pending.current = null;
      blocked.current = false;
      token.current = value ? tokenFor(value.row) : null;
      pinned.current = value?.sources ?? [];
      setStale(value?.stale ?? []);
      setError('');
      onRestore(value);
      setStatus(
        value
          ? value.stale.length
            ? '草稿来源已过期，仅可查看和导出'
            : '草稿已恢复；模型请求仍需重新同意'
          : '尚无候选草稿',
      );
      setLoaded(true);
    },
    [onRestore],
  );
  const restore = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const value = await loadAiDraft(db, key);
      if (mounted.current && seq === sequence.current) install(value);
    } catch (e) {
      if (mounted.current && seq === sequence.current) {
        setError(errorMessage(e));
        setLoaded(true);
      }
    }
  }, [key, install]);
  useEffect(() => {
    mounted.current = true;
    const seq = ++sequence.current;
    void loadAiDraft(db, key)
      .then((value) => {
        if (mounted.current && seq === sequence.current) install(value);
      })
      .catch((e) => {
        if (mounted.current && seq === sequence.current) {
          setError(errorMessage(e));
          setLoaded(true);
        }
      });
    return () => {
      mounted.current = false;
      sequence.current = seq + 1;
    };
  }, [key, install]);
  const flush = useCallback(async () => {
    if (drain.current) return drain.current;
    if (!pending.current) return;
    if (blocked.current) throw new Error('草稿有版本冲突，请先导出编辑或载入最新草稿。');
    const job = async () => {
      if (mounted.current) setSaving(true);
      try {
        while (pending.current) {
          const next = pending.current;
          pending.current = null;
          const row = await saveAiDraft(
            db,
            key,
            next.projectId,
            next.state,
            next.sources,
            next.config,
            token.current,
            writer.current,
          );
          token.current = tokenFor(row);
          if (mounted.current) {
            setStatus('草稿已保存，可刷新或关闭页面');
            setError('');
          }
        }
      } catch (e) {
        blocked.current = true;
        if (mounted.current) setError(errorMessage(e));
        throw e;
      } finally {
        drain.current = null;
        if (mounted.current) setSaving(false);
      }
    };
    drain.current = job();
    return drain.current;
  }, [key]);
  function queue(
    state: GenerationState,
    sources: AiSource[],
    config: ProviderConfig,
    projectId: string,
  ) {
    pinned.current = sources;
    pending.current = { state, sources, config, projectId };
    void flush().catch(() => {});
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current || drain.current || blocked.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function remove() {
    await flush();
    await deleteAiDraft(db, key, token.current);
    token.current = null;
    pending.current = null;
    blocked.current = false;
    pinned.current = [];
    setStale([]);
    setError('');
    setStatus('草稿已删除，正式题目不受影响');
  }
  return {
    loaded,
    status,
    error,
    stale,
    saving,
    token,
    pinned,
    writer,
    queue,
    flush,
    remove,
    restore,
    adopt(row: { epoch: string; version: number }) {
      token.current = { epoch: row.epoch, version: row.version };
      setStatus('草稿已保存，可刷新或关闭页面');
    },
    canConfirm: !error && !stale.length,
  };
}
