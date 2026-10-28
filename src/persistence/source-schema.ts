import { z } from 'zod';
const id = z.string().min(1).max(300);
const date = z.iso.datetime();
export const source = z.object({
  label: z.string(),
  documentId: z.string().optional(),
  page: z.number().int().positive().optional(),
  endPage: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  sectionId: z.string().optional(),
  recordIndex: z.number().int().positive().optional(),
});
export const sourceDocumentSchema = z.object({
  id,
  projectId: id,
  filename: z.string().min(1).max(500),
  title: z.string().max(200).optional(),
  fileType: z.enum(['json', 'csv', 'tsv', 'txt', 'markdown', 'pdf']),
  importedAt: date,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().nonnegative(),
  extractedContent: z.string(),
  pages: z.array(
    z.object({
      number: z.number().int().positive(),
      text: z.string(),
      startOffset: z.number().int().nonnegative(),
      status: z.enum(['ready', 'empty', 'failed', 'suspect']),
      method: z.enum(['text', 'ocr']).optional(),
      textLayer: z.string().optional(),
      confidence: z.number().min(0).max(100).optional(),
      kind: z.enum(['text', 'image', 'mixed', 'blank', 'failed']).optional(),
      warnings: z.array(z.string()),
    }),
  ),
  sections: z.array(
    z.object({
      id,
      title: z.string(),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
      page: z.number().int().positive().optional(),
    }),
  ),
  extractionStatus: z.enum(['ready', 'needs_review', 'partial']),
  warnings: z.array(z.string()),
  parserVersion: z.string(),
  importDigest: z.string().regex(/^[a-f0-9]{64}$/),
  initialItemIds: z.array(id),
});
