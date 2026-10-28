import { expect, it } from 'vitest';
import { createEmptyCard, fsrs } from 'ts-fsrs';
import { advance, storeCard } from './engine';
it('uses the pinned FSRS algorithm for all four ratings with serializable dates', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const initial = storeCard(createEmptyCard(now));
  expect(initial.reps).toBe(0);
  expect(initial.state).toBe(0);
  const reference = fsrs({ request_retention: 0.9, enable_fuzz: false, enable_short_term: true });
  for (const rating of [1, 2, 3, 4] as const) {
    const result = advance(initial, now, rating);
    expect(result.card).toEqual(storeCard(reference.next(initial, now, rating).card));
    expect(result.log.rating).toBe(rating);
    expect(result.card.reps).toBe(1);
    expect(Date.parse(result.card.due)).toBeGreaterThan(now.getTime());
  }
  expect(initial.reps).toBe(0);
});
it('rejects a clock moving backwards instead of inventing elapsed time', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const reviewed = advance(storeCard(createEmptyCard(now)), now, 3).card;
  expect(() => advance(reviewed, new Date('2026-10-26T12:00:00Z'), 3)).toThrow('时钟');
});
