import { z } from 'zod';
import { source, sourceDocumentSchema } from '../persistence/source-schema';
import { objectiveSchema, suggestedItemSchema } from './protocol';
import type { GenerationState } from './generation';
import type { AiSource } from './evidence';
export const MAX_DRAFT_BYTES = 4 * 1024 ** 2,
  MAX_DRAFT_TOTAL_BYTES = 12 * 1024 ** 2,
  MAX_DRAFTS = 20;
const id = z.string().min(1).max(600),
  range = z.strictObject({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  });
const document = sourceDocumentSchema.omit({ extractedContent: true, pages: true }).extend({
  pages: z.array(
    sourceDocumentSchema.shape.pages.element
      .omit({ text: true })
      .extend({ textLength: z.number().int().nonnegative() }),
  ),
});
const sourcePin = z.strictObject({
  kind: z.enum(['document', 'answer']),
  id,
  text: z.string().max(20000000),
  document: document.optional(),
  question: z.string().max(5000).optional(),
  expectedRevisionId: id.optional(),
  sourceReferences: z.array(source).optional(),
  range: range.optional(),
});
const row = z.strictObject({
  unit: z
    .strictObject({
      key: id,
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      chapter: z.string().max(3000),
      title: z.string().max(5000),
      notForCards: z.boolean(),
    })
    .optional(),
  deferred: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  id,
  sourceId: id,
  chunk: range.extend({ id }),
  original: z.array(suggestedItemSchema).max(50),
  question: z.string().max(5000),
  answerSuggestion: z.string().max(20000),
  evidenceQuote: z.string().max(12000),
  criteria: z
    .array(
      z.strictObject({
        id,
        text: z.string().max(10000),
        quotes: z.array(z.string().max(20000)).max(30),
        required: z.boolean(),
      }),
    )
    .max(200),
  adoptCriteria: z.boolean(),
  hints: z.string().max(5000),
  mnemonic: z.string().max(5000),
  confusion: z.string().max(5000),
  notes: z.array(z.string().max(3000)).max(200),
  selected: z.boolean(),
  userEdited: z.boolean().optional(),
});
export const packedStateSchema = z.strictObject({
  deferredUnits: z.array(id).max(200).optional(),
  id,
  inputs: z
    .array(z.strictObject({ id, revisionId: id.optional(), range: range.optional() }))
    .max(50),
  task: z.enum(['extract', 'rewrite', 'criteria', 'quality']),
  objective: objectiveSchema,
  provider: z.enum(['mock', 'ollama', 'compatible']),
  model: z.string().min(1).max(200),
  strategy: z.enum(['standard', 'anchored', 'units']).optional(),
  startedAt: z.iso.datetime(),
  candidates: z.array(row).max(50),
  completed: z.array(id).max(200),
  failures: z.array(z.strictObject({ chunkId: id, message: z.string().max(1000) })).max(200),
  totalChunks: z.number().int().nonnegative().max(200),
  status: z.enum(['idle', 'running', 'completed', 'partial', 'cancelled']),
  confirmed: z
    .array(z.strictObject({ candidateId: id, itemId: id, sourceId: id }))
    .max(50)
    .optional(),
  sources: z.array(sourcePin).max(50),
});
export const savedConfigSchema = z.strictObject({
  kind: z.enum(['mock', 'ollama', 'compatible']),
  endpoint: z.string().max(2000),
  model: z.string().max(200),
  jsonMode: z.enum(['schema', 'json']),
  strategy: z.enum(['standard', 'anchored', 'units']).optional(),
});
export const aiDraftSchema = z.strictObject({
  id,
  projectId: id,
  epoch: id,
  version: z.number().int().positive(),
  writerId: id,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  bytesStored: z.number().int().positive().max(MAX_DRAFT_BYTES),
  config: savedConfigSchema,
  payload: packedStateSchema,
});
export type AiDraftRecord = z.infer<typeof aiDraftSchema>;
export type DraftToken = Pick<AiDraftRecord, 'epoch' | 'version'>;
export function packState(state: GenerationState, sources: AiSource[]) {
  const unique = new Map(sources.map((s) => [`${s.kind}:${s.id}`, s]));
  for (const row of state.candidates) unique.set(`${row.source.kind}:${row.source.id}`, row.source);
  const pins = [...unique.values()].map((s) => {
    const { document: doc, ...rest } = s;
    return {
      ...rest,
      ...(doc
        ? {
            document: {
              ...doc,
              extractedContent: undefined,
              pages: doc.pages.map((p) => {
                const { text, ...page } = p;
                return { ...page, textLength: text.length };
              }),
            },
          }
        : {}),
    };
  });
  const payload = packedStateSchema.parse({
    ...state,
    inputs: state.inputs.map(({ text, ...input }) => {
      void text;
      return input;
    }),
    candidates: state.candidates.map((c) => {
      const { source, chunk, ...rest } = c;
      return {
        ...rest,
        sourceId: `${source.kind}:${source.id}`,
        chunk: { id: chunk.id, start: chunk.start, end: chunk.end },
      };
    }),
    sources: pins,
  });
  return payload;
}
export function unpackState(payload: z.infer<typeof packedStateSchema>) {
  const parsed = packedStateSchema.parse(payload);
  const sources: AiSource[] = parsed.sources.map((s) => {
    const { document: doc, ...rest } = s;
    return {
      ...rest,
      ...(doc
        ? {
            document: {
              ...doc,
              extractedContent: s.text,
              pages: doc.pages.map((p) => {
                const { textLength, ...page } = p;
                return { ...page, text: s.text.slice(p.startOffset, p.startOffset + textLength) };
              }),
            },
          }
        : {}),
    };
  });
  const byId = new Map(sources.map((s) => [`${s.kind}:${s.id}`, s]));
  const state: GenerationState = {
    ...parsed,
    inputs: parsed.inputs.map((i) => {
      const s = sources.find((s) => s.id === i.id);
      if (!s) throw Error('草稿缺少原文快照');
      return { ...i, text: s.text };
    }),
    candidates: parsed.candidates.map((c) => {
      const { sourceId, chunk, ...rest } = c;
      const s = byId.get(sourceId);
      if (!s || chunk.start > chunk.end || chunk.end > s.text.length)
        throw Error('草稿原文位置无效');
      return {
        ...rest,
        source: s,
        chunk: { ...chunk, text: s.text.slice(chunk.start, chunk.end) },
      };
    }),
  };
  return { state, sources };
}

export function assertDraftRecord(record: AiDraftRecord) {
  const actual = new TextEncoder().encode(JSON.stringify(record)).length;
  if (actual > MAX_DRAFT_BYTES || record.bytesStored < actual)
    throw new Error('草稿容量记录无效或超过 4 MB');
  if (
    new Set(record.payload.sources.map((s) => `${s.kind}:${s.id}`)).size !==
    record.payload.sources.length
  )
    throw new Error('草稿来源快照重复');
  for (const pin of record.payload.sources)
    if (
      pin.document &&
      (pin.document.projectId !== record.projectId ||
        pin.document.id !== pin.id ||
        pin.document.pages.some((p) => p.startOffset + p.textLength > pin.text.length))
    )
      throw new Error('草稿资料归属或页面位置无效');
  unpackState(record.payload);
}
