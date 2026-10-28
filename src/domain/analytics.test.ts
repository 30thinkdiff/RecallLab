import { describe, expect, it } from 'vitest';
import legacy from '../../tests/fixtures/legacy-v1.json';
import { validateBackup } from '../persistence/backup-format';
import { migrateBackup } from '../persistence/migration';
import { itemEvidence, summarize, dailyCounts } from './analytics';

describe('evidence statistics', () => {
  it('keeps corrected old successes out of current valid statistics', () => {
    const data = migrateBackup(validateBackup(legacy));
    const item = data.practiceItems.find((item) => item.id === 'q-crystal')!;
    const evidence = itemEvidence(item, data.reviewEvents, data.revisions);
    expect(evidence.allStats).toMatchObject({
      total: 3,
      correct: 2,
      incorrect: 1,
      hinted: 1,
      unhinted: 2,
    });
    expect(evidence.currentStats).toMatchObject({ total: 0, correct: 0 });
    expect(evidence.currentStats.latest).toBeUndefined();
  });
  it('does not discard low confidence correct answers or reinterpret high self-ratings as correctness', () => {
    const data = migrateBackup(validateBackup(legacy));
    const stats = summarize(data.reviewEvents);
    expect(stats.correct).toBe(3);
    expect(stats.incorrect).toBe(1);
    expect(
      data.reviewEvents.find((event) => event.assessmentResult === 'incorrect')?.subjectiveMastery,
    ).toBe(4);
    expect(
      data.reviewEvents.find((event) => event.practiceItemId === 'q-long')?.subjectiveMastery,
    ).toBe(0);
  });
  it('groups exact observations by an explicit timezone without creating empty dates or fitted trends', () => {
    const data = migrateBackup(validateBackup(legacy));
    expect(dailyCounts(data.reviewEvents, 'Asia/Shanghai')).toEqual([
      ['2026-10-20', 2],
      ['2026-10-21', 1],
      ['2026-10-22', 1],
    ]);
    const event = { ...data.reviewEvents[0]!, timestamp: '2026-10-20T23:30:00.000Z' };
    expect(dailyCounts([event], 'Asia/Shanghai')).toEqual([['2026-10-21', 1]]);
    expect(dailyCounts([], 'UTC')).toEqual([]);
  });
  it('separates prompted correct from independent correct and excludes skips from hint denominators', () => {
    const data = migrateBackup(validateBackup(legacy));
    const base = data.reviewEvents[0]!;
    const events = [
      {
        ...base,
        assessmentResult: 'correct' as const,
        hintLevelUsed: 1,
        wasIndependentRecall: false,
      },
      {
        ...base,
        id: 'independent',
        assessmentResult: 'correct' as const,
        hintLevelUsed: 0,
        wasIndependentRecall: true,
      },
      { ...base, id: 'skip', assessmentResult: 'skipped' as const, subjectiveMastery: null },
    ];
    expect(summarize(events)).toMatchObject({
      total: 3,
      attempts: 2,
      hinted: 1,
      hintedCorrect: 1,
      independentCorrect: 1,
    });
  });
});
