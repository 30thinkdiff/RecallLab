import { z } from 'zod';
import { objectiveSchema, suggestedItemSchema } from './protocol';
export const anchorSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  quote: z.string().min(1).max(20000),
});
export type EvidenceAnchor = z.infer<typeof anchorSchema>;
export const aiProvenanceSchema = z.strictObject({
  version: z.literal(1),
  runId: z.string().min(1).max(300),
  candidateId: z.string().min(1).max(300),
  provider: z.enum(['mock', 'ollama', 'compatible']),
  model: z.string().min(1).max(200),
  isMock: z.boolean(),
  task: z.enum(['extract', 'rewrite', 'criteria', 'quality']),
  objective: objectiveSchema,
  generatedAt: z.iso.datetime(),
  sourceKind: z.enum(['document', 'answer']),
  inputId: z.string().min(1).max(300),
  inputRevisionId: z.string().max(300).optional(),
  documentHash: z.string().max(100).optional(),
  inputStart: z.number().int().nonnegative(),
  inputText: z.string().min(1).max(20000),
  original: z.strictObject({ items: z.array(suggestedItemSchema).max(50) }),
  evidence: anchorSchema,
  acceptedCriteria: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(10000),
        anchors: z.array(anchorSchema).min(1).max(30),
      }),
    )
    .max(100),
  confirmation: z.strictObject({
    at: z.iso.datetime(),
    humanReviewed: z.literal(true),
    completenessReviewed: z.literal(true),
    answerMode: z.enum(['verbatim', 'paraphrase', 'unchanged']),
    criterionMode: z.enum(['unchanged', 'ai-confirmed']),
    question: z.string().min(1).max(5000),
    answer: z.string().min(1).max(20000),
    criteria: z.array(z.string()).max(100),
  }),
  confirmedRevisionId: z.string().min(1).max(300),
  modifiedAfterConfirmation: z.boolean().optional(),
  metrics: z.strictObject({
    candidates: z.number().int().nonnegative(),
    sourceMatched: z.number().int().nonnegative(),
    missingSource: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    edited: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(),
  }),
});
export type AiProvenance = z.infer<typeof aiProvenanceSchema>;
export type AiConfirmation = Omit<AiProvenance, 'confirmedRevisionId'>;
export function assertAiAnchors(trace: AiProvenance) {
  aiProvenanceSchema.parse(trace);
  if (trace.isMock !== (trace.provider === 'mock')) throw new Error('模拟来源与模型标记不一致');
  for (const anchor of [trace.evidence, ...trace.acceptedCriteria.flatMap((c) => c.anchors)]) {
    const start = anchor.start - trace.inputStart,
      end = anchor.end - trace.inputStart;
    if (
      start < 0 ||
      end <= start ||
      end > trace.inputText.length ||
      trace.inputText.slice(start, end) !== anchor.quote
    )
      throw new Error('AI 引用不能定位到当时的原始输入');
  }
  if (
    trace.confirmation.criterionMode === 'ai-confirmed' &&
    JSON.stringify(trace.confirmation.criteria) !==
      JSON.stringify(trace.acceptedCriteria.map((c) => c.text))
  )
    throw new Error('已确认要点与引用证据不一致');
  if (
    trace.task === 'extract' &&
    trace.confirmation.answerMode === 'verbatim' &&
    trace.confirmation.answer !== trace.evidence.quote
  )
    throw new Error('原文背诵不能用 AI 改写覆盖原文答案');
  if (trace.sourceKind === 'answer' && trace.confirmation.answer !== trace.inputText)
    throw new Error('已有标准答案不能由 AI 建议改写');
}
