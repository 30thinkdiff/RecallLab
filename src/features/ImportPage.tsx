import { useEffect, useRef, useState } from 'react';
import type { LearningProject, PracticeItem, SourceReference } from '../domain/models';
import { parseMaterial } from '../importing/file';
import { duplicateReasons, type ImportCandidate, type ParsedMaterial } from '../importing/types';
import { commitImport } from '../importing/service';
import { cardInputSchema } from '../domain/validation';
import { repository } from '../persistence/repository';
import { errorMessage, useAction } from '../components/actions';
import { ErrorNotice } from '../components/shared';
import { SourceReader } from './SourceReader';
import { promptProblem } from '../domain/readiness';
import { tokenOf } from '../domain/revisions';

export function ImportPage({
  projects,
  cards,
  initialProjectId,
  goalFlow = false,
}: {
  projects: LearningProject[];
  cards: PracticeItem[];
  initialProjectId?: string;
  goalFlow?: boolean;
}) {
  const [parsed, setParsed] = useState<ParsedMaterial | null>(null);
  const [rows, setRows] = useState<ImportCandidate[]>([]);
  const [projectId, setProjectId] = useState(
    initialProjectId && projects.some((project) => project.id === initialProjectId)
      ? initialProjectId
      : goalFlow
        ? 'new'
        : (projects[0]?.id ?? 'new'),
  );
  const [projectName, setProjectName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [ack, setAck] = useState(false);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<Awaited<ReturnType<typeof commitImport>> | null>(null);
  const version = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceFile = useRef<File | null>(null);
  const parseController = useRef<AbortController | null>(null);
  useEffect(() => () => parseController.current?.abort(), []);
  const action = useAction();
  const existing = cards.filter((card) => card.projectId === projectId);
  const duplicates = duplicateReasons(rows, existing);
  const selected = rows.filter((row) => row.selected);
  const invalid = selected.filter((row) => !cardInputSchema.safeParse(row).success);
  const selectedDuplicates = selected.filter((row) => duplicates.has(row.id));
  function reset() {
    setDirty(false);
    action.clearError();
    version.current++;
    parseController.current?.abort();
    sourceFile.current = null;
    setParsed(null);
    setRows([]);
    setResult(null);
    setError('');
    setLoading(false);
    setAck(false);
    setAllowDuplicates(false);
    setPage(0);
    if (fileInput.current) fileInput.current.value = '';
  }
  async function read(file: File, ocr = false) {
    if (dirty && !window.confirm('重新解析会替换尚未保存的候选编辑。确定放弃这些修改并继续吗？')) {
      if (file !== sourceFile.current && fileInput.current) fileInput.current.value = '';
      return;
    }
    setDirty(false);
    parseController.current?.abort();
    const controller = new AbortController();
    parseController.current = controller;
    sourceFile.current = file;
    action.clearError();
    const request = ++version.current;
    setLoading(true);
    setProgress('正在读取并解析资料…');
    setError('');
    setParsed(null);
    setResult(null);
    setRows([]);
    setAck(false);
    setAllowDuplicates(false);
    setPage(0);
    try {
      const material = await parseMaterial(
        file,
        (page, total) => {
          if (request === version.current)
            setProgress(`${ocr ? '本地 OCR' : '正在提取 PDF'}：第 ${page} / ${total} 页`);
        },
        {
          signal: controller.signal,
          ocr,
          onOcrProgress: (page, total, fraction) => {
            if (request === version.current)
              setProgress(`本地 OCR：第 ${page} / ${total} 页 · ${Math.round(fraction * 100)}%`);
          },
        },
      );
      if (request !== version.current) return;
      setParsed(material);
      const matches = duplicateReasons(material.candidates, existing);
      setRows(material.candidates.map((row) => ({ ...row, selected: !matches.has(row.id) })));
      setProjectName(file.name.replace(/\.[^.]+$/, ''));
    } catch (cause) {
      if (request === version.current) setError(errorMessage(cause));
    } finally {
      if (request === version.current) setLoading(false);
    }
  }
  function addSelection(source: SourceReference) {
    setDirty(true);
    const row: ImportCandidate = {
      id: crypto.randomUUID(),
      selected: true,
      origin: 'selection',
      question: '',
      standardAnswer: source.excerpt ?? '',
      hints: '',
      answerCriteria: '',
      mnemonics: '',
      confusionWarnings: '',
      sourceLabel: source.label,
      source,
    };
    setRows((rows) => [...rows, row]);
    setPage(Math.floor(rows.length / 10));
  }
  function selectRows(select: (row: ImportCandidate) => boolean) {
    setDirty(true);
    setRows((rows) => rows.map((row) => ({ ...row, selected: select(row) })));
  }
  function change(id: string, patch: Partial<ImportCandidate>) {
    setDirty(true);
    setRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  return (
    <>
      <div className="eyebrow">YOUR MATERIAL, YOUR KNOWLEDGE</div>
      <h1>导入资料</h1>
      <p className="page-intro">
        上传 → 解析 → 预览并确认 → 开始学习。只追加内容，不清除现有题目和历史。
      </p>
      <ol className="import-steps" aria-label="导入步骤">
        {['上传', '解析', '预览并确认', '开始学习'].map((label, index) => (
          <li
            className={(result ? 3 : parsed ? 2 : loading ? 1 : 0) === index ? 'active' : ''}
            key={label}
          >
            {index + 1} · {label}
          </li>
        ))}
      </ol>
      {!result && (
        <section className="question-panel">
          <label>
            选择学习资料
            <input
              ref={fileInput}
              type="file"
              accept=".json,.csv,.tsv,.txt,.md,.markdown,.pdf"
              disabled={loading || action.busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void read(file);
              }}
            />
          </label>
          <p className="muted">
            支持 JSON/CSV/TSV/TXT/Markdown（5 MB、1000 道题）及文字型 PDF（20 MB、200 页）。UTF-8
            或带标记的 UTF-16。完整数据库备份请使用“备份与恢复”。
          </p>
          <details>
            <summary>查看支持格式与示例</summary>
            <pre className="format-example">
              {
                'JSON：[{"question":"问题","answer":"标准答案"}]\nCSV：question,answer（含逗号或换行的字段用双引号包围）\nTSV：问题与答案两列，以制表符分隔\nTXT / Markdown：\nQ: 问题一\nA: 标准答案，可跨多行\n\n问：问题二\n答：标准答案'
              }
            </pre>
          </details>
          {(parsed || loading || error) && (
            <button className="text-button" disabled={action.busy} onClick={reset}>
              取消本次导入
            </button>
          )}
          {loading && <p role="status">{progress}</p>}
        </section>
      )}
      <ErrorNotice message={error || action.error} />
      {parsed && !result && (
        <>
          <section className="import-target">
            <p className="muted">当前预览：{parsed.document.filename}</p>
            <p>
              {projectId === 'new'
                ? `将新建题库：${projectName}`
                : '将追加到所选题库，保留已有内容。'}
            </p>
            <details open={!goalFlow}>
              <summary>修改题库名称与保存位置</summary>
              <h2>导入到哪里？</h2>
              <div className="form-grid">
                <label>
                  目标学习项目
                  <select
                    value={projectId}
                    disabled={action.busy}
                    onChange={(event) => {
                      setProjectId(event.target.value);
                      setAllowDuplicates(false);
                    }}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                    <option value="new">创建新项目</option>
                  </select>
                </label>
                {projectId === 'new' && (
                  <label>
                    新项目名称
                    <input
                      required
                      maxLength={100}
                      value={projectName}
                      disabled={action.busy}
                      onChange={(event) => setProjectName(event.target.value)}
                    />
                  </label>
                )}
              </div>
            </details>
          </section>
          {parsed.document.fileType === 'pdf' && (
            <section className="info-note" aria-label="PDF 页面类型">
              <p>
                文字页 {parsed.document.pages.filter((p) => p.kind === 'text').length} · 图文混合页{' '}
                {parsed.document.pages.filter((p) => p.kind === 'mixed').length} · 图片页{' '}
                {parsed.document.pages.filter((p) => p.kind === 'image').length} · 空白页{' '}
                {parsed.document.pages.filter((p) => p.kind === 'blank').length} · 解析异常页{' '}
                {parsed.document.pages.filter((p) => p.kind === 'failed').length}
              </p>
              {parsed.document.pages.some(
                (p) =>
                  p.kind === 'mixed' ||
                  (p.status !== 'ready' &&
                    (p.kind === 'image' || p.kind === 'failed' || p.status === 'suspect')),
              ) && (
                <>
                  <p>
                    可在本机尝试简体中文及英文
                    OCR，仅处理图片、疑似乱码或图文混合页面。首次按需加载约 8 MB 资源，可能占用数百
                    MB 内存；识别后须与页面图像核对。
                  </p>
                  <button
                    className="button secondary"
                    disabled={action.busy}
                    onClick={() => {
                      if (sourceFile.current) void read(sourceFile.current, true);
                    }}
                  >
                    在本机识别图片文字（OCR）
                  </button>
                </>
              )}
            </section>
          )}
          {parsed.pdfReport && (
            <details>
              <summary>本次提取统计（不含正文）</summary>
              <p>来源软件：{parsed.pdfReport.creator || '未提供'}</p>
              <ul>
                {parsed.pdfReport.pages.map((p) => (
                  <li key={p.number}>
                    第 {p.number} 页：文字片段 {p.items} 个 · {p.characters} 字符
                    {p.errorName ? ` · 解析异常 ${p.errorName}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {parsed.document.warnings.length > 0 && (
            <section className="info-note">
              <h3>请核对提取结果</h3>
              {parsed.document.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  disabled={action.busy}
                  checked={ack}
                  onChange={(event) => setAck(event.target.checked)}
                />
                我已核对警告，确认要保存的内容
              </label>
            </section>
          )}
          {parsed.coverage && (
            <section className="info-note" aria-label="内容核查">
              <h2>内容核查</h2>
              {parsed.document.title && <p>文档：{parsed.document.title}</p>}
              <p>
                可读文字 {parsed.coverage.readablePages} / {parsed.coverage.totalPages} 页 · 识别{' '}
                {parsed.coverage.sections} 个章节 · {rows.length} 个候选条目
              </p>
              <p>
                尚未归类 {parsed.coverage.unassignedCharacters} 个非空白字符 ·{' '}
                {parsed.coverage.reviewItems} 个条目需重点核对 · {parsed.coverage.crossPageItems}{' '}
                个跨页条目
              </p>
              {!!parsed.coverage.unassigned.length && (
                <details>
                  <summary>查看尚未归类的原文</summary>
                  {parsed.coverage.unassigned.map((r) => (
                    <div key={r.startOffset}>
                      <button
                        className="text-button"
                        onClick={() =>
                          document
                            .getElementById(`source-page-${parsed.document.id}-${r.page}`)
                            ?.scrollIntoView({ block: 'center' })
                        }
                      >
                        第 {r.page} 页 · 定位原文
                      </button>
                      <p className="preserve-lines">
                        {parsed.document.extractedContent.slice(r.startOffset, r.endOffset)}
                      </p>
                    </div>
                  ))}
                </details>
              )}
              <p>
                {parsed.coverage.problemPages.length
                  ? `可能缺失或异常的页面：${parsed.coverage.problemPages.join('、')}`
                  : '所有页面均有可读文字；这不代表知识提取已经完整，请抽查原文。'}
              </p>
            </section>
          )}
          <div className="import-confirm">
            <p>请抽查题干、完整答案与来源。字段完整不代表内容正确。</p>
            <p>
              将保存 1 份资料、追加 {selected.length} 道题；跳过 {rows.length - selected.length}{' '}
              道。其中 {selected.filter((row) => promptProblem(row)).length}{' '}
              道待完善，保存为草稿，不进入学习。已有题库和学习历史保留。
            </p>
            <button
              className="button"
              disabled={
                action.busy ||
                invalid.length > 0 ||
                !parsed.document.pages.some((p) => p.status !== 'failed' && p.text.trim()) ||
                (projectId === 'new' && !projectName.trim()) ||
                (selectedDuplicates.length > 0 && !allowDuplicates) ||
                (parsed.document.warnings.length > 0 && !ack)
              }
              onClick={() =>
                void action.run(async () => {
                  const target =
                    projectId === 'new'
                      ? {
                          newProject: {
                            name: projectName,
                            description: '',
                            learningGoal: '',
                            targetDate: '',
                            dailyTimeBudget: 20,
                          },
                        }
                      : { projectId };
                  const saved = await commitImport(
                    repository,
                    parsed,
                    rows,
                    target,
                    allowDuplicates,
                    ack,
                  );
                  setResult(saved);
                  if (goalFlow && saved.itemIds.length > 0 && saved.skipped === 0)
                    window.location.assign(`#learn/${saved.projectId}`);
                })
              }
            >
              {action.busy
                ? '正在保存…'
                : selected.length
                  ? `确认导入 ${selected.length} 道题`
                  : '仅保存资料'}
            </button>
          </div>
          <section>
            <div className="section-heading">
              <h2>候选题目（{rows.length}）</h2>
              <span className="muted">
                已选 {selected.length} 道 · 待补全 {invalid.length} 道 · 疑似重复 {duplicates.size}{' '}
                道
              </span>
            </div>
            <p className="muted">
              待完善题干会保留为知识草稿，完善前不会进入学习队列。问题与答案都可修改。相同问题的候选仅提示，不覆盖旧题；导入不会继承旧学习成绩。
            </p>
            <div className="button-row">
              {invalid.length > 0 && (
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    selectRows(
                      (row) => cardInputSchema.safeParse(row).success && !duplicates.has(row.id),
                    )
                  }
                >
                  选择字段完整且非重复的题目
                </button>
              )}
              <button
                className="button secondary"
                disabled={action.busy}
                onClick={() => selectRows((row) => !duplicates.has(row.id))}
              >
                选择非重复题目
              </button>
              <button
                className="text-button"
                disabled={action.busy}
                onClick={() => selectRows(() => false)}
              >
                全部取消选择
              </button>
            </div>
            {rows.slice(page * 10, page * 10 + 10).map((row, index) => (
              <article className="candidate-card" key={row.id} data-testid="import-candidate">
                <div className="section-heading">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={action.busy}
                      onChange={(event) => change(row.id, { selected: event.target.checked })}
                    />
                    导入第 {page * 10 + index + 1} 题
                  </label>
                  {duplicates.has(row.id) && <span className="tag">{duplicates.get(row.id)}</span>}
                </div>
                {promptProblem(row) && <p className="info-note">待完善：{promptProblem(row)}</p>}
                {row.reviewNotes?.map((note) => (
                  <p className="info-note" key={note}>
                    {note}
                  </p>
                ))}
                <p className="source-note">{row.source.label}</p>
                <div className="form-grid">
                  <label>
                    问题
                    <textarea
                      aria-label={`第 ${page * 10 + index + 1} 题问题`}
                      rows={2}
                      maxLength={5000}
                      value={row.question}
                      disabled={action.busy}
                      onChange={(event) => change(row.id, { question: event.target.value })}
                    />
                  </label>
                  <label>
                    标准答案
                    <textarea
                      aria-label={`第 ${page * 10 + index + 1} 题答案`}
                      rows={3}
                      maxLength={20000}
                      value={row.standardAnswer}
                      disabled={action.busy}
                      onChange={(event) => change(row.id, { standardAnswer: event.target.value })}
                    />
                  </label>
                </div>
                {row.selected && !cardInputSchema.safeParse(row).success && (
                  <p className="field-error">请补全问题和标准答案，再确认导入。</p>
                )}
                <details>
                  <summary>提示、核对要点与原文来源</summary>
                  <label>
                    提示
                    <textarea
                      rows={2}
                      disabled={action.busy}
                      maxLength={5000}
                      value={row.hints}
                      onChange={(event) => change(row.id, { hints: event.target.value })}
                    />
                  </label>
                  <label>
                    核对要点
                    <textarea
                      rows={2}
                      disabled={action.busy}
                      maxLength={10000}
                      value={row.answerCriteria}
                      onChange={(event) => change(row.id, { answerCriteria: event.target.value })}
                    />
                  </label>
                  <p className="source-note">{row.source.label}</p>
                  <p className="preserve-lines">{row.source.excerpt}</p>
                </details>
              </article>
            ))}
            {rows.length > 10 && (
              <div className="button-row pagination">
                <button
                  className="button secondary"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <span>
                  {page + 1} / {Math.ceil(rows.length / 10)}
                </span>
                <button
                  className="button secondary"
                  disabled={(page + 1) * 10 >= rows.length}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            )}
            {!rows.length && <p>没有自动生成题目。可在下方原文中选择文字，再填写问题。</p>}
          </section>
          {selectedDuplicates.length > 0 && (
            <label className="checkbox-label info-note">
              <input
                type="checkbox"
                disabled={action.busy}
                checked={allowDuplicates}
                onChange={(event) => setAllowDuplicates(event.target.checked)}
              />
              我已核对，仍然追加这些重复候选（不替换旧题）
            </label>
          )}
          <SourceReader
            document={parsed.document}
            previews={parsed.previews}
            onSelect={action.busy ? undefined : addSelection}
          />
        </>
      )}
      {result && (
        <section className="study-complete">
          <h2>导入完成</h2>
          {goalFlow && (
            <a className="button" href={`#learn/${result.projectId}`}>
              设置目标并自动安排
            </a>
          )}
          <p>
            已追加 {result.itemIds.length} 道题，跳过 {result.skipped} 道候选。已有学习历史保留。
          </p>
          <p className="muted">
            按计划学习会建立间隔安排；完整轮次作为临时练习。待完善题干保存后可批量处理，不进入学习队列。
          </p>
          <div className="button-row">
            <button
              className="button"
              disabled={action.busy || !result.itemIds.length}
              onClick={() =>
                void action.run(async () => {
                  const { scheduleService } = await import('../scheduling/service');
                  location.hash = `study/${await scheduleService.start(result.projectId, { mode: 'new' })}`;
                })
              }
            >
              按计划学习新题（FSRS）
            </button>
            <button
              className="button"
              disabled={action.busy || !result.itemIds.length}
              onClick={() =>
                void action.run(async () => {
                  const id = await repository.startSession(result.projectId);
                  const session = await repository.db.sessions.get(id);
                  if (session && !session.reviewPlan && session.index < session.queue.length)
                    await repository.syncSession(id, session.index, tokenOf(session), {
                      includeNew: true,
                    });
                  location.hash = `study/${id}`;
                })
              }
            >
              开始学习（加入本轮新题）
            </button>
            <a className="button secondary" href={`#project/${result.projectId}`}>
              返回项目题库
            </a>
            <a className="text-link" href={`#document/${result.documentId}`}>
              查看资料与来源
            </a>
            <a className="button secondary" href={`#ai/document/${result.documentId}`}>
              AI 辅助整理
            </a>
          </div>
          <button className="text-button" onClick={reset}>
            继续导入其他资料
          </button>
        </section>
      )}
    </>
  );
}
