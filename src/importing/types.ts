import type { SourceDocument, SourceReference } from '../domain/models';
import type { CardInput } from '../domain/validation';
export type MaterialDraft = Omit<
  SourceDocument,
  'projectId' | 'importedAt' | 'importDigest' | 'initialItemIds'
>;
export interface ImportCandidate extends CardInput {
  id: string;
  selected: boolean;
  source: SourceReference;
  origin: 'rule' | 'selection';
}
export interface ParsedMaterial {
  document: MaterialDraft;
  candidates: ImportCandidate[];
}
export const MAX_CARDS = 1000;
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export function normalizedQuestion(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}
export function duplicateReasons(
  candidates: ImportCandidate[],
  existing: { question: string; standardAnswer: string; archivedAt?: string }[],
) {
  const seen = new Set<string>();
  const result = new Map<string, string>();
  for (const candidate of candidates) {
    const key = normalizedQuestion(candidate.question);
    const match = existing.find(
      (item) => !item.archivedAt && normalizedQuestion(item.question) === key,
    );
    if (key && (seen.has(key) || match))
      result.set(
        candidate.id,
        match
          ? match.standardAnswer.trim() === candidate.standardAnswer.trim()
            ? '项目中已有相同问题与答案'
            : '项目中有相同问题，但答案不同，请核对'
          : '本文件中有相同问题',
      );
    if (key) seen.add(key);
  }
  return result;
}
