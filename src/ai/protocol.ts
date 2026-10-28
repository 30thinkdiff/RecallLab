import { z } from 'zod';
export const objectiveSchema = z.enum(['verbatim', 'keywords', 'understanding', 'exam']);
export type LearningObjective = z.infer<typeof objectiveSchema>;
export const objectiveLabels: Record<LearningObjective, string> = {
  verbatim: '原文背诵',
  keywords: '关键词记忆',
  understanding: '概念理解',
  exam: '考试复习',
};
export type AiTask = 'extract' | 'rewrite' | 'criteria' | 'quality';
export const MAX_GENERATED_ITEMS = 50,
  MAX_CHUNK_ITEMS = 8,
  MAX_CHUNK_CHARS = 3500,
  MAX_RESPONSE_BYTES = 1024 * 1024;
const short = z.string().max(3000);
export const suggestedCriterionSchema = z.strictObject({
  text: short,
  quote: z.string().max(12000),
  importance: z.enum(['required', 'optional']),
});
export const suggestedItemSchema = z.strictObject({
  question: short,
  answerSuggestion: z.string().max(20000),
  evidenceQuote: z.string().max(12000),
  criteria: z.array(suggestedCriterionSchema).max(30),
  hints: z.array(short).max(5),
  mnemonic: short,
  confusion: short,
  qualityNotes: z.array(short).max(8),
});
export const modelOutputSchema = z.strictObject({
  items: z.array(suggestedItemSchema).max(MAX_CHUNK_ITEMS),
});
export type SuggestedItem = z.infer<typeof suggestedItemSchema>;
export interface AiRequest {
  task: AiTask;
  objective: LearningObjective;
  chunkId: string;
  text: string;
  question?: string;
  maxItems: number;
}
export interface AiProvider {
  readonly kind: ProviderKind;
  generate(input: AiRequest, signal: AbortSignal): Promise<unknown>;
}
export type ProviderKind = 'mock' | 'ollama' | 'compatible';
export interface ProviderConfig {
  kind: ProviderKind;
  endpoint: string;
  model: string;
  apiKey: string;
  jsonMode: 'schema' | 'json';
}
export interface Disclosure {
  destination: 'none' | 'local' | 'external';
  origin: string;
  characters: number;
}
export class AiError extends Error {
  constructor(
    readonly code:
      | 'configuration'
      | 'consent'
      | 'network'
      | 'timeout'
      | 'cancelled'
      | 'authentication'
      | 'rate-limit'
      | 'service'
      | 'invalid-output'
      | 'too-large',
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
