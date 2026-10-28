import { it, expect } from 'vitest';
import { promptProblem } from './readiness';
it('keeps legacy answer-revealing templates and incomplete cards out of learning', () => {
  for (const question of ['请复述：完整原文答案', '待完善题干（条目 3）', ''])
    expect(promptProblem({ question, standardAnswer: '完整原文答案' })).not.toBeNull();
  expect(promptProblem({ question: '甲规则是什么？', standardAnswer: '虚构甲规则' })).toBeNull();
});
