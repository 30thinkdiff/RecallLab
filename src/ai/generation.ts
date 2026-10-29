import { rubricProblems } from './content-audit';
import { guidedItem, planKnowledge, type KnowledgeSlice } from './units';
import { ResolvedOutput } from './inference';
import {
  AiError,
  MAX_GENERATED_ITEMS,
  modelOutputSchema,
  type AiProvider,
  type AiTask,
  type LearningObjective,
  type SuggestedItem,
} from './protocol';
import { chunksOf, locateQuote, exampleLike, type AiSource, type TextChunk } from './evidence';
import type { EvidenceAnchor } from './provenance';
export interface CriterionDraft {
  id: string;
  text: string;
  quotes: string[];
  required: boolean;
}
export interface AiCandidate {
  unit?: Omit<KnowledgeSlice, 'text'>;
  deferred?: boolean;
  reviewed?: boolean;
  id: string;
  source: AiSource;
  chunk: TextChunk;
  original: SuggestedItem[];
  question: string;
  answerSuggestion: string;
  evidenceQuote: string;
  criteria: CriterionDraft[];
  adoptCriteria: boolean;
  hints: string;
  mnemonic: string;
  confusion: string;
  notes: string[];
  selected: boolean;
  userEdited?: boolean;
}
export interface GenerationState {
  deferredUnits?: string[];
  strategy?: 'standard' | 'anchored' | 'units';
  confirmed?: { candidateId: string; itemId: string; sourceId: string }[];
  id: string;
  inputs: {
    id: string;
    text: string;
    revisionId?: string;
    range?: { start: number; end: number };
  }[];
  task: AiTask;
  objective: LearningObjective;
  provider: string;
  model: string;
  startedAt: string;
  candidates: AiCandidate[];
  completed: string[];
  failures: { chunkId: string; message: string }[];
  totalChunks: number;
  status: 'idle' | 'running' | 'completed' | 'partial' | 'cancelled';
}
export function candidateEvidence(row: AiCandidate) {
  const match = locateQuote(
    row.source.text,
    row.evidenceQuote,
    row.source.kind === 'document' ? row.chunk.start : 0,
    row.source.kind === 'document' ? row.chunk.end : row.source.text.length,
  );
  const notes: string[] = [...rubricProblems(row)];
  const anchors: EvidenceAnchor[] = [];
  for (const c of row.criteria.filter((c) => c.required && row.adoptCriteria)) {
    if (!c.text.trim() || !c.quotes.length)
      notes.push(`要点“${c.text.slice(0, 30)}”缺少内容或原文依据`);
    for (const quote of c.quotes) {
      const found = locateQuote(
        row.source.text,
        quote,
        row.source.kind === 'document' && match.status === 'matched' ? match.anchor.start : 0,
        row.source.kind === 'document' && match.status === 'matched'
          ? match.anchor.end
          : row.source.text.length,
      );
      if (found.status !== 'matched') notes.push(`要点“${c.text.slice(0, 30)}”没有唯一的原文依据`);
      else anchors.push(found.anchor);
    }
  }
  if (match.status === 'matched') {
    if (match.layoutAdjusted)
      notes.push('引用的空白排版与原文不同，已按真实位置还原原文；没有改动文字或标点');
    const before = row.source.text[match.anchor.start - 1],
      last = match.anchor.quote.at(-1);
    if ((before && !/[\s。；.!;：:]/u.test(before)) || (last && !/[。；.!;？！?]/u.test(last)))
      notes.push('引用可能从句中开始或结束，请核对上下文完整性');
  } else
    notes.push(
      match.status === 'missing'
        ? '来源不足：引用不在本次原文范围中'
        : '引用出现多次，请扩大证据或缩小原文范围定位',
    );
  if (row.source.document?.pages.some((p) => p.method === 'ocr'))
    notes.push('资料包含 OCR，文字尚未验证，请对照原始文件');
  return {
    match,
    anchors,
    notes,
    valid: match.status === 'matched' && !notes.some((n) => n.startsWith('要点')),
  };
}
function rowFor(
  source: AiSource,
  chunk: TextChunk,
  item: SuggestedItem,
  task: AiTask,
): AiCandidate {
  return {
    id: crypto.randomUUID(),
    source,
    chunk,
    original: [structuredClone(item)],
    question: task === 'criteria' || task === 'quality' ? (source.question ?? '') : item.question,
    answerSuggestion: item.answerSuggestion,
    evidenceQuote: item.evidenceQuote,
    adoptCriteria: task === 'extract' || task === 'criteria',
    criteria: item.criteria.map((c) => ({
      id: crypto.randomUUID(),
      text: c.text,
      quotes: [c.quote],
      required: c.importance === 'required' && !exampleLike(c.quote),
    })),
    hints: item.hints.join('\n'),
    mnemonic: item.mnemonic,
    confusion: item.confusion,
    notes: item.qualityNotes,
    selected: false,
  };
}
export async function generateCandidates(
  sources: AiSource[],
  task: AiTask,
  objective: LearningObjective,
  provider: AiProvider,
  model: string,
  signal: AbortSignal,
  onProgress: (s: GenerationState) => void,
  resume?: GenerationState,
): Promise<GenerationState> {
  for (const source of sources) chunksOf(source); // Keep the existing per-source range and size limits.
  if (provider.strategy === 'units' && task === 'quality')
    throw new AiError('configuration', '分知识方案用于制卡与要点整理；质量点评请选择原有方案。');
  const work: { source: AiSource; chunk: TextChunk; unit?: KnowledgeSlice }[] =
    provider.strategy === 'units'
      ? sources.flatMap((source) =>
          planKnowledge(source)
            .filter((u) => !u.notForCards)
            .flatMap((unit) =>
              chunksOf({ ...source, range: { start: unit.start, end: unit.end } }).map((chunk) => ({
                source,
                chunk,
                unit,
              })),
            ),
        )
      : sources.flatMap((source) => chunksOf(source).map((chunk) => ({ source, chunk })));
  if (sources.length > 50 || work.length > 200)
    throw new AiError(
      'configuration',
      '本批原文单元过多，请选择部分章节或页面后分批整理；已有草稿未改动。',
    );
  const state: GenerationState = resume
    ? structuredClone(resume)
    : {
        id: crypto.randomUUID(),
        strategy: provider.strategy ?? 'standard',
        inputs: sources.map((s) => ({
          id: s.id,
          text: s.text,
          revisionId: s.expectedRevisionId,
          range: s.range,
        })),
        task,
        objective,
        provider: provider.kind,
        model,
        startedAt: new Date().toISOString(),
        candidates: [],
        completed: [],
        failures: [],
        totalChunks: work.length,
        status: 'idle',
      };
  if (
    state.task !== task ||
    state.objective !== objective ||
    state.provider !== provider.kind ||
    state.model !== model ||
    (state.strategy ?? 'standard') !== (provider.strategy ?? 'standard')
  )
    throw new AiError(
      'configuration',
      '继续生成必须使用同一任务、目标和模型；也可明确清空后重新开始。',
    );
  if (
    JSON.stringify(state.inputs) !==
    JSON.stringify(
      sources.map((s) => ({
        id: s.id,
        text: s.text,
        revisionId: s.expectedRevisionId,
        range: s.range,
      })),
    )
  )
    throw new AiError('configuration', '原文或题目版本已变化，请保留原候选后重新生成。');
  state.status = 'running';
  state.failures = [];
  onProgress(structuredClone(state));
  for (const { source, chunk, unit } of work) {
    if (state.completed.includes(chunk.id) || (unit && state.deferredUnits?.includes(unit.key)))
      continue;
    if (signal.aborted) {
      state.status = 'cancelled';
      break;
    }
    if (state.candidates.length >= MAX_GENERATED_ITEMS) {
      state.status = 'partial';
      break;
    }
    try {
      const maxItems =
        task === 'extract' ? Math.min(8, MAX_GENERATED_ITEMS - state.candidates.length) : 1;
      const raw = await provider.generate(
        {
          task: unit ? 'rewrite' : task,
          objective,
          chunkId: chunk.id,
          text: chunk.text,
          question: unit?.title || source.question,
          maxItems:
            task === 'extract' ? Math.min(8, MAX_GENERATED_ITEMS - state.candidates.length) : 1,
        },
        signal,
      );
      const parsed = modelOutputSchema.safeParse(raw instanceof ResolvedOutput ? raw.data : raw);
      if (!parsed.success || parsed.data.items.length > maxItems)
        throw new AiError(
          'invalid-output',
          '模型输出结构无效，本段未应用；可继续其他段或人工整理。',
        );
      if (signal.aborted) {
        state.status = 'cancelled';
        break;
      }
      for (const [index, rawItem] of parsed.data.items.entries()) {
        const item = unit
          ? guidedItem(
              rawItem.question,
              { ...unit, text: chunk.text, start: chunk.start, end: chunk.end },
              objective,
            )
          : rawItem;
        const original = raw instanceof ResolvedOutput ? raw.wire.items[index]! : rawItem;
        if (state.candidates.length >= MAX_GENERATED_ITEMS) break;
        const previous =
          source.kind === 'answer'
            ? state.candidates.find((c) => c.source.id === source.id)
            : undefined;
        if (
          item.criteria.length + (previous?.criteria.length ?? 0) > 200 ||
          item.criteria.filter((c) => c.importance === 'required').length +
            (previous?.criteria.filter((c) => c.required).length ?? 0) >
            100
        )
          throw new AiError(
            'invalid-output',
            '本段评分要点过多，请缩小原文范围后分批整理；已有候选保留。',
          );
        if (previous) {
          previous.original.push(structuredClone(original));
          previous.criteria.push(...rowFor(source, chunk, item, task).criteria);
          previous.notes.push(...item.qualityNotes);
        } else {
          const row = rowFor(source, chunk, item, task);
          row.original = [structuredClone(original)];
          if (unit) {
            const { text, ...meta } = unit;
            void text;
            row.unit = meta;
          }
          state.candidates.push(row);
        }
      }
      state.completed.push(chunk.id);
    } catch (e) {
      if (signal.aborted) {
        state.status = 'cancelled';
        break;
      }
      state.failures.push({
        chunkId: chunk.id,
        message: e instanceof AiError ? e.message : '本段生成失败，可重试；没有修改题库。',
      });
    }
    onProgress(structuredClone(state));
  }
  if (state.status === 'running')
    state.status =
      state.failures.length ||
      work.some(
        ({ chunk, unit }) =>
          !state.completed.includes(chunk.id) && !(unit && state.deferredUnits?.includes(unit.key)),
      )
        ? 'partial'
        : 'completed';
  onProgress(structuredClone(state));
  return state;
}
