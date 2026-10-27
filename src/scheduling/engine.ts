import { createEmptyCard, fsrs, type Card } from 'ts-fsrs';
import type { PracticeItem } from '../domain/models';
import type { StoredCard, MemoryState, Grade } from './types';
export const algorithm = 'ts-fsrs@5.4.2/default-v1' as const;
export const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: false,
  enable_short_term: true,
});
export function storeCard(card: Card): StoredCard {
  const { due, last_review, ...rest } = card;
  return {
    ...rest,
    due: due.toISOString(),
    ...(last_review ? { last_review: last_review.toISOString() } : {}),
  };
}
export function initialMemory(item: PracticeItem, now: Date): MemoryState {
  const card = storeCard(createEmptyCard(now));
  const time = now.toISOString();
  return {
    id: item.learningStateId,
    learningStateId: item.learningStateId,
    projectId: item.projectId,
    practiceItemId: item.id,
    knowledgeUnitId: item.knowledgeUnitId,
    revisionId: item.currentRevisionId,
    algorithm,
    version: 0,
    card,
    due: card.due,
    createdAt: time,
    updatedAt: time,
  };
}
export function advance(card: StoredCard, now: Date, grade: Grade) {
  if (card.last_review && Date.parse(card.last_review) > now.getTime())
    throw new Error('本机时钟早于上次复习时间，请校准时间后继续。');
  const result = scheduler.next(card, now, grade);
  return {
    card: storeCard(result.card),
    log: {
      ...result.log,
      due: result.log.due.toISOString(),
      review: result.log.review.toISOString(),
    },
  };
}
