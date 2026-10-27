import { it, expect } from 'vitest';
import { decide } from './policy';
import type { ReviewEvent } from '../domain/models';
const e = {
  assessmentResult: 'correct',
  wasIndependentRecall: true,
  hintLevelUsed: 0,
  assessmentSource: 'user_checked',
  subjectiveMastery: 4,
} as ReviewEvent;
it('maps verified independent success by difficulty and never by five-point feeling', () => {
  expect(decide(e, true, 'hard').grade).toBe(2);
  expect(decide({ ...e, subjectiveMastery: 0 }, true, 'good').grade).toBe(3);
  expect(decide(e, true, 'easy').grade).toBe(4);
});
it('uses Again for failure and incomplete required recall even with high confidence', () => {
  for (const assessmentResult of ['incorrect', 'partially_correct'] as const)
    expect(decide({ ...e, assessmentResult }, true, 'hard').grade).toBe(1);
});
it('does not manufacture recall from hints, revealed answers, skipping, or temporary practice', () => {
  expect(decide({ ...e, hintLevelUsed: 1, wasIndependentRecall: false }, true).reason).toBe(
    'hinted',
  );
  expect(decide({ ...e, wasIndependentRecall: false }, true).reason).toBe('no_attempt');
  expect(decide({ ...e, assessmentResult: 'skipped' }, true).grade).toBeNull();
  expect(decide(e, false).reason).toBe('practice');
  expect(decide({ ...e, assessmentResult: 'ungraded' }, true).grade).toBeNull();
  expect(decide({ ...e, assessmentSource: 'self_report' }, true).source).toBe('self_report');
});
