import { z } from 'zod';
import { objectiveSchema } from '../ai/protocol';
import { source } from './source-schema';
const id = z.string().min(1).max(500),
  date = z.iso.datetime();
export const workingNoteRevisionSchema = z.object({
  id,
  knowledgeUnitId: id,
  projectId: id,
  version: z.number().int().nonnegative(),
  content: z.string().max(100000),
  sourceReferences: z.array(source),
  createdAt: date,
  recordedBy: z.enum(['system_snapshot', 'user']),
});
export type WorkingNoteRevision = z.infer<typeof workingNoteRevisionSchema>;
export const cardDraftValuesSchema = z.strictObject({
  question: z.string().max(5000),
  standardAnswer: z.string().max(20000),
  answerCriteria: z.string().max(10000),
  hints: z.string().max(5000),
  mnemonics: z.string().max(5000),
  confusionWarnings: z.string().max(5000),
  sourceLabel: z.string().max(1000),
  learningObjective: objectiveSchema.optional(),
  importance: z.number().int().min(1).max(3).optional(),
  paused: z.boolean().optional(),
});
const common = {
  epoch: id,
  id,
  projectId: id.optional(),
  practiceItemId: id.optional(),
  knowledgeUnitId: id.optional(),
  sessionId: id.optional(),
  baseRevisionId: id.optional(),
  baseNoteVersion: z.number().int().nonnegative().optional(),
  version: z.number().int().nonnegative(),
  createdAt: date,
  updatedAt: date,
};
export const editorDraftSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('card'), values: cardDraftValuesSchema }),
  z.object({
    ...common,
    kind: z.literal('note'),
    values: z.object({ content: z.string().max(100000) }),
  }),
]);
export type EditorDraft = z.infer<typeof editorDraftSchema>;
export type CardDraftValues = z.infer<typeof cardDraftValuesSchema>;
