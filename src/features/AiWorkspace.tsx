import { candidateQualityProblem } from '../ai/quality';
import { reviewQueue } from '../ai/review-queue';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../persistence/database';
import { repository } from '../persistence/repository';
import { ErrorNotice } from '../components/shared';
import { useAction } from '../components/actions';
import { promptProblem } from '../domain/readiness';
import type { PracticeItem } from '../domain/models';
import {
  objectiveLabels,
  type AiTask,
  type LearningObjective,
  type ProviderConfig,
} from '../ai/protocol';
import { destination, providerFor } from '../ai/providers';
import {
  candidateEvidence,
  generateCandidates,
  type AiCandidate,
  type GenerationState,
} from '../ai/generation';
import { candidateAnswer, duplicateCandidates, generationMetrics } from '../ai/apply';
import { referenceFor, uncoveredText, type AiSource } from '../ai/evidence';
import { aiSession } from '../ai/session';
import { useAiDraft, type LoadedDraft } from './useAiDraft';
import { confirmDraft } from '../ai/confirm-draft';
import { downloadJson } from '../persistence/backup';
import { packState } from '../ai/drafts-format';
import { assertCurrentSources } from '../ai/source-state';
import { ModelStatus } from './ModelStatus';

const taskNames: Record<AiTask, string> = {
  extract: '整理候选知识与题目',
  rewrite: '完善题干（保留标准答案）',
  criteria: '建议评分要点（保留标准答案）',
  quality: '提出质量与易混提醒',
};
export function AiWorkspace({
  kind,
  id,
  cards,
}: {
  kind: string;
  id: string;
  cards: PracticeItem[];
}) {
  const document = useLiveQuery(
    () => (kind === 'document' ? db.sourceDocuments.get(id) : undefined),
    [kind, id],
  );
  const [draftProjectId, setDraftProjectId] = useState<string | undefined>();
  const item = cards.find((c) => c.id === id);
  const projectId =
    kind === 'document'
      ? (document?.projectId ?? draftProjectId)
      : kind === 'item'
        ? (item?.projectId ?? draftProjectId)
        : id;
  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  );
  const key = `${kind}/${id}`;
  const [enabled, setEnabled] = useState(aiSession.enabled);
  const [config, setConfig] = useState<ProviderConfig>({ ...aiSession.config });
  const [state, setState] = useState<GenerationState | undefined>();
  const [task, setTask] = useState<AiTask>(
    state?.task ?? (kind === 'document' ? 'extract' : kind === 'item' ? 'criteria' : 'rewrite'),
  );
  const [objective, setObjective] = useState<LearningObjective>(
    state?.objective ?? item?.learningObjective ?? 'verbatim',
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    kind === 'item'
      ? [id]
      : cards
          .filter((c) => c.projectId === id && !c.archivedAt && promptProblem(c))
          .slice(0, 50)
          .map((c) => c.id),
  );
  const [firstPage, setFirstPage] = useState(1),
    [lastPage, setLastPage] = useState(0);
  const [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [complete, setComplete] = useState(false);
  const [reviewFilter, setReviewFilter] = useState('all');
  const [saved, setSaved] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null),
    running = useRef(false);
  const action = useAction();
  const busy = state?.status === 'running';
  const hasDraft = Boolean(state?.candidates.length);
  const restoreDraft = useCallback((value: LoadedDraft | null) => {
    if (!value) {
      setState(undefined);
      setSaved([]);
      setReviewed(false);
      setComplete(false);
      return;
    }
    setDraftProjectId(value.row.projectId);
    setState(value.state);
    setTask(value.state.task);
    setObjective(value.state.objective);
    setConfig({ ...value.row.config, apiKey: '' });
    setSelectedIds(value.sources.filter((s) => s.kind === 'answer').map((s) => s.id));
    setSaved(value.state.confirmed?.map((c) => c.itemId) ?? []);
    setReviewed(false);
    setComplete(false);
    setConsent(false);
    const doc = value.sources.find((s) => s.document);
    if (doc?.document) {
      const pages = doc.document.pages;
      setFirstPage(pages.find((p) => p.startOffset === doc.range?.start)?.number ?? 1);
      setLastPage(
        doc.range?.end && doc.range.end < doc.text.length
          ? (pages.find((p) => p.startOffset === doc.range?.end)?.number ?? 1) - 1
          : 0,
      );
    }
  }, []);
  const draft = useAiDraft(key, restoreDraft);
  useEffect(() => () => abort.current?.abort(), []);
  function update(next: GenerationState) {
    setState(next);
    if (projectId) draft.queue(next, draft.pinned.current, config, projectId);
  }
  function edit(rowId: string, patch: Partial<AiCandidate>) {
    if (!state) return;
    update({
      ...state,
      candidates: state.candidates.map((c) =>
        c.id === rowId
          ? {
              ...c,
              ...patch,
              userEdited: c.userEdited || Object.keys(patch).some((k) => k !== 'selected'),
            }
          : c,
      ),
    });
    setReviewed(false);
    setComplete(false);
  }
  function changeConfig(patch: Partial<ProviderConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    aiSession.config = next;
    setConsent(false);
  }
  const available = cards.filter((c) => !c.archivedAt && c.projectId === projectId);
  const reviewEntries = state ? reviewQueue(state, available) : [];
  const sources: AiSource[] =
    kind === 'document' && document
      ? [
          {
            kind: 'document',
            id: document.id,
            text: document.extractedContent,
            document,
            ...(document.pages.length
              ? {
                  range: {
                    start:
                      document.pages[Math.min(firstPage, document.pages.length) - 1]?.startOffset ??
                      0,
                    end:
                      lastPage && lastPage < document.pages.length
                        ? (document.pages[lastPage]?.startOffset ??
                          document.extractedContent.length)
                        : document.extractedContent.length,
                  },
                }
              : {}),
          },
        ]
      : available
          .filter((c) => selectedIds.includes(c.id))
          .slice(0, 50)
          .map((c) => ({
            kind: 'answer',
            id: c.id,
            text: c.standardAnswer,
            question: c.question,
            expectedRevisionId: c.currentRevisionId,
            sourceReferences: c.sourceReferences,
          }));
  const chars = sources.reduce(
    (n, s) => n + (s.range ? s.range.end - s.range.start : s.text.length),
    0,
  );
  let disclosure = '',
    configurationError = '';
  try {
    const d = destination(config, chars);
    disclosure = `${d.destination === 'external' ? '外部服务' : d.destination === 'local' ? '本机模型' : '模拟演示'}：${d.origin}；${sources.length} 份输入，共 ${chars} 字符。`;
  } catch (e) {
    configurationError = e instanceof Error ? e.message : '接口配置无效';
  }
  const duplicate = state
    ? duplicateCandidates(
        state.candidates,
        available.filter((c) => !saved.includes(c.id)),
      )
    : new Set<string>();
  const metrics = state
    ? generationMetrics(
        state,
        available.filter((c) => !saved.includes(c.id)),
        saved.length,
      )
    : null;
  const unquoted = state?.inputs.map((input) => {
    const start = input.range?.start ?? 0,
      end = input.range?.end ?? input.text.length;
    const anchors = state.candidates
      .filter((c) => c.source.id === input.id)
      .flatMap((c) => {
        const m = candidateEvidence(c).match;
        return m.status === 'matched' ? [m.anchor] : [];
      });
    return uncoveredText(input.text.slice(start, end), anchors, start);
  });
  async function generate() {
    if (running.current) return;
    await action.run(async () => {
      if (!enabled) throw new Error('请先主动启用本次 AI 辅助。');
      if (!sources.length) throw new Error('请先选择需要整理的内容。');
      if (chars > 100000) throw new Error('本批最多 10 万字符，请缩小页面或题目范围。');
      const generationSources = state?.inputs.length ? draft.pinned.current : sources;
      await assertCurrentSources(db, generationSources, projectId!);
      draft.pinned.current = generationSources;
      const provider = providerFor(config, consent, chars);
      abort.current = new AbortController();
      running.current = true;
      setConsent(false);
      setReviewed(false);
      setComplete(false);
      setSaved([]);
      try {
        await generateCandidates(
          generationSources,
          task,
          objective,
          provider,
          config.kind === 'mock' ? 'mock' : config.model,
          abort.current.signal,
          update,
          state,
        );
      } finally {
        running.current = false;
      }
    });
  }
  if (!draft.loaded) return <p role="status">正在恢复本地候选草稿…</p>;
  if (!projectId || !project || (kind === 'document' && !document && !state))
    return <p role="status">正在读取原文与项目；若内容已被恢复操作替换，请返回资料重新选择。</p>;
  if ((project.archivedAt || item?.archivedAt) && !state)
    return <p>此内容已归档，请恢复后再整理。</p>;
  return (
    <>
      <a
        className="text-link breadcrumb"
        href={
          kind === 'document'
            ? `#document/${id}`
            : kind === 'item'
              ? `#item/${id}`
              : `#project/${projectId}`
        }
      >
        返回原内容
      </a>
      <div className="eyebrow">SOURCE FIRST · HUMAN CONFIRMED</div>
      <h1>
        AI 辅助整理 <span className="tag">Alpha</span>
      </h1>
      <p className="page-intro">
        选择内容 → 生成建议 → 对照原文 → 人工确认 → 开始学习。AI 只提出候选，不判断你的回答对错。
      </p>
      <p className="info-note">
        默认关闭。候选和修改自动保存在当前浏览器，刷新后可恢复；API
        密钥不保存。草稿含私人资料，只有人工确认后才成为学习题目。
      </p>
      <ModelStatus disabled={Boolean(busy) || hasDraft} config={config} onConfig={changeConfig} />
      <p role="status" data-testid="ai-draft-status">
        {draft.saving ? '正在保存草稿…' : draft.status}
      </p>
      <ErrorNotice message={draft.error} />
      {draft.stale.map((m) => (
        <p className="info-note" key={m}>
          {m}
        </p>
      ))}
      {state && (
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() =>
              downloadJson(
                {
                  format: 'RecallLabAiDraft',
                  version: 1,
                  payload: packState(state, draft.pinned.current),
                },
                'RecallLab-候选草稿.json',
              )
            }
          >
            导出当前候选草稿
          </button>
          <button
            className="button secondary"
            disabled={busy || draft.saving}
            onClick={() => {
              if (
                !draft.error ||
                window.confirm('载入最新草稿会替换当前未保存编辑，请先导出。确定继续？')
              )
                void draft.restore();
            }}
          >
            载入最新草稿
          </button>
        </div>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => {
            setEnabled(e.target.checked);
            aiSession.enabled = e.target.checked;
            setConsent(false);
            if (!e.target.checked) {
              changeConfig({ apiKey: '' });
            }
          }}
        />
        启用本次 AI 辅助
      </label>
      {enabled && (
        <>
          <fieldset disabled={busy || hasDraft} className="ai-settings">
            <legend>本次整理范围与目标</legend>
            <label>
              学习目标
              <select
                value={objective}
                onChange={(e) => {
                  setObjective(e.target.value as LearningObjective);
                  setConsent(false);
                }}
              >
                {Object.entries(objectiveLabels).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              整理任务
              <select
                value={task}
                onChange={(e) => {
                  setTask(e.target.value as AiTask);
                  setConsent(false);
                }}
              >
                {(kind === 'document' ? ['extract'] : ['rewrite', 'criteria', 'quality']).map(
                  (t) => (
                    <option key={t} value={t}>
                      {taskNames[t as AiTask]}
                    </option>
                  ),
                )}
              </select>
            </label>
            {kind === 'document' && document && (
              <>
                <p>
                  {document.filename} · 原文 {document.extractedContent.length} 字符 ·{' '}
                  {document.pages.length} 页
                </p>
                {document.pages.length > 0 && (
                  <div className="form-grid">
                    <label>
                      起始页
                      <input
                        type="number"
                        min={1}
                        max={document.pages.length}
                        value={firstPage}
                        onChange={(e) => {
                          setFirstPage(e.target.valueAsNumber || 1);
                          setConsent(false);
                        }}
                      />
                    </label>
                    <label>
                      结束页（0 为末页）
                      <input
                        type="number"
                        min={0}
                        max={document.pages.length}
                        value={lastPage}
                        onChange={(e) => {
                          setLastPage(e.target.valueAsNumber || 0);
                          setConsent(false);
                        }}
                      />
                    </label>
                  </div>
                )}
              </>
            )}
            {kind !== 'document' && (
              <details open={kind === 'project'}>
                <summary>选取题目（本批最多 50 条）</summary>
                {available.map((c) => (
                  <label className="checkbox-label" key={c.id}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(c.id)}
                      onChange={(e) => {
                        setSelectedIds(
                          e.target.checked
                            ? [...selectedIds, c.id].slice(0, 50)
                            : selectedIds.filter((v) => v !== c.id),
                        );
                        setConsent(false);
                      }}
                    />
                    {c.question}
                  </label>
                ))}
              </details>
            )}
            <details>
              <summary>查看本次会发送的原始内容</summary>
              {sources.map((s) => (
                <pre className="ai-original" key={s.id}>
                  {s.question ? `问题：${s.question}\n标准答案：\n` : ''}
                  {s.text.slice(s.range?.start ?? 0, s.range?.end ?? s.text.length)}
                </pre>
              ))}
            </details>
          </fieldset>
          <fieldset disabled={busy} className="ai-settings">
            <legend>模型连接（仅本次内存保存）</legend>
            <label>
              服务类型
              <select
                value={config.kind}
                disabled={hasDraft}
                onChange={(e) => {
                  const v = e.target.value as ProviderConfig['kind'];
                  changeConfig({
                    kind: v,
                    apiKey: '',
                    ...(v === 'ollama'
                      ? { endpoint: 'http://127.0.0.1:11434', model: '' }
                      : v === 'compatible'
                        ? { endpoint: 'http://127.0.0.1:8089/v1', model: 'qwen2.5-1.5b-instruct' }
                        : {}),
                  });
                }}
              >
                <option value="compatible">兼容接口（本机或自行选择的 HTTPS 服务）</option>
                <option value="ollama">本机 Ollama</option>
                <option value="mock">模拟演示（不是真实 AI）</option>
              </select>
            </label>
            {config.kind !== 'mock' && (
              <>
                <label>
                  接口地址
                  <input
                    value={config.endpoint}
                    disabled={hasDraft}
                    onChange={(e) => changeConfig({ endpoint: e.target.value })}
                    autoComplete="off"
                  />
                </label>
                <label>
                  模型名称
                  <input
                    value={config.model}
                    disabled={hasDraft}
                    onChange={(e) => changeConfig({ model: e.target.value })}
                    autoComplete="off"
                  />
                </label>
                <label>
                  本次密钥（本机通常留空）
                  <input
                    type="password"
                    value={config.apiKey}
                    onChange={(e) => changeConfig({ apiKey: e.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label>
                  引用方式
                  <select
                    value={config.strategy ?? 'standard'}
                    disabled={hasDraft}
                    onChange={(e) =>
                      changeConfig({ strategy: e.target.value as 'standard' | 'anchored' })
                    }
                  >
                    <option value="standard">逐字引用（原有方案）</option>
                    <option value="anchored">原文片段编号（试验方案，仍需核对）</option>
                  </select>
                </label>
                <label>
                  输出格式
                  <select
                    value={config.jsonMode}
                    disabled={hasDraft}
                    onChange={(e) =>
                      changeConfig({ jsonMode: e.target.value as ProviderConfig['jsonMode'] })
                    }
                  >
                    <option value="schema">结构化输出</option>
                    <option value="json">JSON（仅用于兼容模型）</option>
                  </select>
                </label>
              </>
            )}
          </fieldset>
          <p className="info-note">
            {disclosure || configurationError}{' '}
            仅发送所选原文、所选题目的题干及本次任务与目标；不发送学习记录、其他文件或整个数据库。外部服务的留存规则由该服务决定。
          </p>
          {config.kind !== 'mock' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              我已查看发送内容，同意本次发送到上方地址
            </label>
          )}
          <div className="button-row">
            <button
              className="button"
              disabled={
                busy ||
                Boolean(state?.confirmed?.length) ||
                state?.status === 'completed' ||
                !draft.canConfirm ||
                Boolean(configurationError) ||
                (config.kind !== 'mock' && !consent)
              }
              onClick={() => void generate()}
            >
              {state?.status === 'completed'
                ? '本批生成已完成'
                : hasDraft
                  ? '继续未完成段落'
                  : '生成候选'}
            </button>
            {busy && (
              <button className="button secondary" onClick={() => abort.current?.abort()}>
                取消生成
              </button>
            )}
            {state && !busy && (
              <button
                className="button secondary"
                onClick={() => {
                  if (window.confirm('清空尚未确认的候选与编辑？已经保存的题目不受影响。')) {
                    void action.run(async () => {
                      await draft.remove();
                      setState(undefined);
                      setSaved([]);
                      setReviewed(false);
                      setComplete(false);
                      setConsent(false);
                    });
                  }
                }}
              >
                清空草稿并重新选择
              </button>
            )}
          </div>
        </>
      )}
      <ErrorNotice message={action.error} />
      {state && (
        <section aria-label="AI 候选预览">
          <h2>候选预览 · {state.provider === 'mock' ? '模拟演示，非真实 AI' : state.model}</h2>
          <p role="status">
            已处理 {state.completed.length}/{state.totalChunks} 段 · {state.candidates.length}{' '}
            条候选 ·{' '}
            {state.status === 'running'
              ? '生成中'
              : state.status === 'cancelled'
                ? '已取消，保留已有候选'
                : state.status === 'partial'
                  ? '部分完成，请检查失败与批量上限'
                  : '生成已结束，仍需人工核对'}
          </p>
          {state.failures.map((f) => (
            <p className="info-note" key={f.chunkId}>
              {f.message}
            </p>
          ))}
          {metrics && (
            <p>
              引用逐字定位 {metrics.sourceMatched} 条 · 来源不足 {metrics.missingSource} 条 ·
              疑似重复 {metrics.duplicates} 条。匹配只证明文字存在，不证明答案受支持或完整。
            </p>
          )}
          <button
            className="button secondary"
            disabled={busy || !draft.canConfirm}
            onClick={() => {
              update({
                ...state,
                candidates: state.candidates.map((c) => ({
                  ...c,
                  selected:
                    candidateEvidence(c).valid &&
                    !duplicate.has(c.id) &&
                    !candidateQualityProblem(
                      c.question,
                      candidateAnswer(c, state),
                      c.evidenceQuote,
                    ),
                })),
              });
              setReviewed(false);
              setComplete(false);
            }}
          >
            选择可核对候选
          </button>
          {unquoted && (
            <p className="info-note">
              本批原文尚有 {unquoted.reduce((n, g) => n + g.characters, 0)}{' '}
              个字符未被候选引用覆盖。引用覆盖不是知识完整性判断，请对照发送范围中的原文检查遗漏。
            </p>
          )}
          {state.candidates.length > 0 && (
            <>
              <label>
                审阅范围
                <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
                  <option value="all">全部候选（优先显示待核对风险）</option>
                  <option value="risk">有质量提示</option>
                  <option value="source">来源或引用不足</option>
                  <option value="duplicate">疑似重复</option>
                  <option value="edited">我已修改</option>
                </select>
              </label>
              <button
                className="button secondary"
                disabled={busy || !draft.canConfirm}
                onClick={() => {
                  const flagged = new Set(
                    reviewEntries
                      .filter((c) => !candidateEvidence(c.row).valid || c.comparisons.length)
                      .map((c) => c.row.id),
                  );
                  update({
                    ...state,
                    candidates: state.candidates.map((c) =>
                      flagged.has(c.id) ? { ...c, selected: false } : c,
                    ),
                  });
                  setReviewed(false);
                  setComplete(false);
                }}
              >
                取消选择来源不足及重复候选
              </button>
              <p className="muted">
                提示由规则检查产生，不能发现所有语义问题；批量选择仍需你核对。修改会自动保存，已确认的条目不再显示。
              </p>
            </>
          )}
          {Array.from(new Set(reviewEntries.map((entry) => entry.group))).map((group) => {
            const entries = reviewEntries.filter(
              (entry) =>
                entry.group === group &&
                (reviewFilter === 'all' ||
                  (reviewFilter === 'risk' && entry.flags.length) ||
                  (reviewFilter === 'source' && !candidateEvidence(entry.row).valid) ||
                  (reviewFilter === 'duplicate' && entry.comparisons.length) ||
                  (reviewFilter === 'edited' && entry.row.userEdited)),
            );
            if (!entries.length) return null;
            const first = entries[0]!.row;
            return (
              <section className="question-panel" key={group} aria-label="按来源分组的候选">
                <h3>
                  {first.source.document?.filename ?? first.source.question ?? '已有标准答案'} ·
                  原文段 {first.chunk.start + 1}—{first.chunk.end}
                </h3>
                {entries.map(({ row, index, flags, comparisons }) => (
                  <div key={row.id}>
                    {flags.length > 0 && <p className="info-note">待核对：{flags.join(' · ')}</p>}
                    {comparisons.length > 0 && (
                      <details>
                        <summary>比较重复题目的答案差异</summary>
                        <p>当前候选：{candidateAnswer(row, state)}</p>
                        {comparisons.map((c, i) => (
                          <p className="preserve-lines" key={i}>
                            {c.label}：{c.question}
                            {c.answer}
                          </p>
                        ))}
                      </details>
                    )}
                    <CandidateEditor
                      row={row}
                      state={state}
                      index={index}
                      busy={Boolean(busy) || !draft.canConfirm}
                      duplicate={duplicate.has(row.id)}
                      edit={(patch) => edit(row.id, patch)}
                    />
                  </div>
                ))}
              </section>
            );
          })}
          {state.candidates.length > 0 && (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                我已对照原资料核对所选题干、答案、引用和 OCR 文字；AI 意见不是正确性证明
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={complete}
                  disabled={busy}
                  onChange={(e) => setComplete(e.target.checked)}
                />
                我已检查未覆盖原文、必要内容与例子，确认所选答案和评分要点完整合理
              </label>
              <p className="muted">
                改动已有题干、学习目标或必需要点会重新开始该题的有效学习状态；历史记录保留。标准答案保持不变。
              </p>
              <button
                className="button"
                disabled={
                  busy ||
                  action.busy ||
                  !reviewed ||
                  !complete ||
                  !draft.canConfirm ||
                  !state.candidates.some((c) => c.selected)
                }
                onClick={() =>
                  void action.run(async () => {
                    await draft.flush();
                    const result = await confirmDraft(
                      repository,
                      key,
                      projectId,
                      state,
                      draft.pinned.current,
                      config,
                      draft.token.current,
                      draft.writer.current,
                      { humanReviewed: reviewed, completenessReviewed: complete },
                    );
                    draft.adopt(result.row);
                    draft.pinned.current = result.sources;
                    setState(result.state);
                    setSaved(result.state.confirmed?.map((c) => c.itemId) ?? result.ids);
                    setReviewed(false);
                    setComplete(false);
                  })
                }
              >
                确认保存所选候选
              </button>
            </>
          )}
        </section>
      )}
      {saved.length > 0 && (
        <div className="empty-card" role="status">
          <h2>已确认保存 {saved.length} 条</h2>
          <p>原始建议、来源和本次人工确认已随题目保存。</p>
          <div className="button-row">
            <a className="button" href={`#daily/${projectId}`}>
              开始正式复习
            </a>
            <a className="button secondary" href={`#item/${saved[0]}`}>
              查看来源与记录
            </a>
            <a className="text-link" href={`#project/${projectId}`}>
              返回题库
            </a>
          </div>
        </div>
      )}
    </>
  );
}
function CandidateEditor({
  row,
  state,
  index,
  busy,
  duplicate,
  edit,
}: {
  row: AiCandidate;
  state: GenerationState;
  index: number;
  busy: boolean;
  duplicate: boolean;
  edit: (patch: Partial<AiCandidate>) => void;
}) {
  const evidence = candidateEvidence(row),
    answer = candidateAnswer(row, state);
  const required = row.criteria.filter((c) => c.required),
    gap = uncoveredText(
      row.source.kind === 'answer' ? row.source.text : row.evidenceQuote,
      evidence.anchors,
      row.source.kind === 'document' && evidence.match.status === 'matched'
        ? evidence.match.anchor.start
        : 0,
    );
  const problem = candidateQualityProblem(row.question, answer, row.evidenceQuote);
  return (
    <details className="ai-candidate" open={index === 0}>
      <summary>
        候选 {index + 1} · {row.question || '待完善题干'} {duplicate ? '· 疑似重复' : ''}{' '}
        {evidence.valid ? '· 引用已定位' : '· 来源不足'}
      </summary>
      <fieldset disabled={busy}>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={row.selected}
            onChange={(e) => edit({ selected: e.target.checked })}
          />
          选择此候选
        </label>
        <label>
          候选题干
          <textarea
            value={row.question}
            maxLength={5000}
            onChange={(e) => edit({ question: e.target.value })}
          />
        </label>
        {problem && <p className="info-note">{problem}</p>}
        <label>
          来源原文（可修正为实际存在的完整引用）
          <textarea
            value={row.evidenceQuote}
            rows={4}
            maxLength={12000}
            onChange={(e) => edit({ evidenceQuote: e.target.value })}
          />
        </label>
        {evidence.match.status === 'matched' && row.source.document && (
          <p className="muted">{referenceFor(row.source.document, evidence.match.anchor).label}</p>
        )}
        <details>
          <summary>查看该段完整原文</summary>
          <pre className="ai-original">
            {row.source.kind === 'answer' ? row.source.text : row.chunk.text}
          </pre>
        </details>
        {evidence.notes.map((n) => (
          <p className="info-note" key={n}>
            {n}
          </p>
        ))}
        <label>
          {row.source.kind === 'answer'
            ? '已有标准答案（保持不变）'
            : state.objective === 'verbatim'
              ? '确认后标准答案（直接使用上述原文）'
              : 'AI 建议答案（须核对、可编辑）'}
          <textarea
            rows={4}
            value={answer}
            readOnly={row.source.kind === 'answer' || state.objective === 'verbatim'}
            maxLength={20000}
            onChange={(e) => edit({ answerSuggestion: e.target.value })}
          />
        </label>
        <details>
          <summary>AI 原始答案建议、解释与质量意见（均未验证）</summary>
          {row.original.map((o, i) => (
            <div key={i}>
              <p>AI 原始题干：{o.question}</p>
              <p>AI 原始引用（片段模式可能是编号）：{o.evidenceQuote}</p>
              <p className="preserve-lines">{o.answerSuggestion}</p>
              <ul>
                {o.criteria.map((c, j) => (
                  <li key={j}>
                    {c.text} · {c.importance === 'required' ? '模型建议必需' : '模型建议可选'} ·{' '}
                    {c.quote}
                  </li>
                ))}
              </ul>
              {o.qualityNotes.map((n, j) => (
                <p key={j}>{n}</p>
              ))}
            </div>
          ))}
          <p>助记建议：{row.mnemonic || '无'}</p>
          <p>易混提醒：{row.confusion || '无'}</p>
          <p>提示：{row.hints || '无'}</p>
        </details>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={row.adoptCriteria}
            onChange={(e) => edit({ adoptCriteria: e.target.checked })}
          />
          采用以下评分要点（勾选为必需；例子默认不必需）
        </label>
        {row.adoptCriteria && (
          <>
            <p className="muted">
              {required.length} 个必需要点。尚有 {gap.characters}{' '}
              个原文字符未被必需要点引用覆盖；字符覆盖不等于语义完整。请逐段检查是否遗漏。
            </p>
            {gap.gaps.length > 0 && (
              <details>
                <summary>查看未覆盖原文</summary>
                {gap.gaps.map((g, i) => (
                  <p className="preserve-lines" key={i}>
                    {g.text}
                  </p>
                ))}
              </details>
            )}
            {row.criteria.map((c, i) => (
              <div className="ai-criterion" key={c.id}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={c.required}
                    onChange={(e) =>
                      edit({
                        criteria: row.criteria.map((d) =>
                          d.id === c.id ? { ...d, required: e.target.checked } : d,
                        ),
                      })
                    }
                  />
                  要点 {i + 1} 为必需
                </label>
                <label>
                  要点内容
                  <input
                    value={c.text}
                    maxLength={3000}
                    onChange={(e) =>
                      edit({
                        criteria: row.criteria.map((d) =>
                          d.id === c.id ? { ...d, text: e.target.value } : d,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  要点依据（逐字引用；多处引用每行一处）
                  <textarea
                    value={c.quotes.join('\n')}
                    onChange={(e) =>
                      edit({
                        criteria: row.criteria.map((d) =>
                          d.id === c.id
                            ? { ...d, quotes: e.target.value.split('\n').filter(Boolean) }
                            : d,
                        ),
                      })
                    }
                  />
                </label>
                <div className="button-row">
                  <button
                    className="button subtle"
                    onClick={() => edit({ criteria: row.criteria.filter((d) => d.id !== c.id) })}
                  >
                    删除要点 {i + 1}
                  </button>
                  {i > 0 && (
                    <button
                      className="button subtle"
                      onClick={() => {
                        const a = row.criteria[i - 1]!;
                        edit({
                          criteria: row.criteria
                            .filter((d) => d.id !== c.id)
                            .map((d) =>
                              d.id === a.id
                                ? {
                                    ...a,
                                    text: `${a.text}；${c.text}`,
                                    quotes: [...new Set([...a.quotes, ...c.quotes])],
                                    required: a.required || c.required,
                                  }
                                : d,
                            ),
                        });
                      }}
                    >
                      与上项合并
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              className="button secondary"
              onClick={() =>
                edit({
                  criteria: [
                    ...row.criteria,
                    { id: crypto.randomUUID(), text: '', quotes: [], required: true },
                  ],
                })
              }
            >
              添加人工要点
            </button>
          </>
        )}
      </fieldset>
    </details>
  );
}
