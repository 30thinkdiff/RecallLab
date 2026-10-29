import { it, expect } from 'vitest';
import corpus from '../../evaluation/v052/corpus.json';
it('keeps public source-contained references explicit, allows multiple questions and never claims human annotation', () => {
  expect(corpus.cases).toHaveLength(24);
  expect(corpus.independentHumanGold).toBe(false);
  expect(new Set(corpus.cases.map((c) => c.id)).size).toBe(24);
  for (const c of corpus.cases) {
    expect(c.annotation.independentHumanReview).toBe('not-performed');
    for (const u of c.units) {
      expect(c.text).toContain(u.quote);
      expect(u.acceptableQuestions.length).toBeGreaterThanOrEqual(2);
      for (const p of u.required) {
        expect(u.quote).toContain(p.point);
        expect(c.text).toContain(p.sourceQuote);
      }
    }
    if (!c.units.length) expect(c.notForCards.length).toBeGreaterThan(0);
  }
});
