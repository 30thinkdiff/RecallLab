import type { PracticeItem } from './models';
import { cardInputSchema, lines, type CardInput } from './validation';

// Only normalize the encoding of line endings. Lexical spaces, punctuation,
// case, indentation and required criteria remain part of the success standard.
export const displayText = (text: string) => text.replace(/\r\n/g, '\n');
export function preservesRequirements(item: PracticeItem, raw: CardInput) {
  const input = cardInputSchema.parse(raw),
    criteria = lines(input.answerCriteria);
  return (
    displayText(item.question) === displayText(input.question) &&
    displayText(item.standardAnswer) === displayText(input.standardAnswer) &&
    item.answerCriteria.length === criteria.length &&
    item.answerCriteria.every((c, i) => displayText(c) === displayText(criteria[i]!)) &&
    item.learningObjective === (input.learningObjective ?? item.learningObjective)
  );
}
export function cardUnchanged(item: PracticeItem, raw: CardInput) {
  const input = cardInputSchema.parse(raw);
  return (
    preservesRequirements(item, input) &&
    item.question === input.question &&
    item.standardAnswer === input.standardAnswer &&
    JSON.stringify(item.answerCriteria) === JSON.stringify(lines(input.answerCriteria)) &&
    JSON.stringify(item.hints) === JSON.stringify(lines(input.hints)) &&
    item.mnemonics === input.mnemonics &&
    item.confusionWarnings === input.confusionWarnings &&
    (item.sourceReferences[0]?.label ?? '') === input.sourceLabel
  );
}
export const cardEditToken = (item: PracticeItem) =>
  `${item.currentRevisionId}@${item.editVersion ?? 0}`;
