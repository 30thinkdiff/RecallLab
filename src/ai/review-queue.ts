import type { PracticeItem } from '../domain/models';
import { candidateQualityProblem } from './quality';
import { normalizedQuestion } from '../importing/types';
import { candidateAnswer } from './apply';
import { candidateEvidence, type GenerationState } from './generation';
export function reviewQueue(state: GenerationState, cards: PracticeItem[]) {
  return state.candidates
    .map((row, index) => {
      const evidence = candidateEvidence(row),
        flags: string[] = [];
      const answerKey = normalizedQuestion(candidateAnswer(row, state));
      const peers = state.candidates.filter(
        (other) =>
          other.id !== row.id &&
          (normalizedQuestion(other.question) === normalizedQuestion(row.question) ||
            (answerKey.length >= 8 &&
              normalizedQuestion(candidateAnswer(other, state)) === answerKey)),
      );
      const existing = cards.filter(
        (c) =>
          !c.archivedAt &&
          c.id !== (row.source.kind === 'answer' ? row.source.id : '') &&
          (normalizedQuestion(c.question) === normalizedQuestion(row.question) ||
            (answerKey.length >= 8 && normalizedQuestion(c.standardAnswer) === answerKey)),
      );
      if (!evidence.valid) flags.push('来源或要点引用不足');
      if (candidateQualityProblem(row.question, candidateAnswer(row, state), row.evidenceQuote))
        flags.push('题干需要完善');
      if (peers.length || existing.length) flags.push('疑似重复，需比较差异');
      if (row.source.document?.pages.some((p) => p.method === 'ocr')) flags.push('OCR 文字待核对');
      if (
        candidateAnswer(row, state).length > 160 &&
        (!row.adoptCriteria || row.criteria.filter((c) => c.required).length < 2)
      )
        flags.push('长答案要点可能不足');
      if (evidence.notes.some((n) => n.includes('句中'))) flags.push('引用边界待核对');
      if (/伪系统指令|密码文件|删除学习历史|忽略前面的规则/u.test(row.evidenceQuote))
        flags.push('原文含操作指令，仅作为待核对资料');
      const score = flags.reduce(
        (n, flag) =>
          n +
          (flag.startsWith('来源')
            ? 100
            : flag.startsWith('题干')
              ? 90
              : flag.startsWith('疑似')
                ? 85
                : 50),
        0,
      );
      const group = `${row.source.id}/${row.unit?.chapter ?? row.chunk.id}`;
      return {
        row,
        index,
        flags,
        score,
        group,
        comparisons: [
          ...peers.map((c) => ({
            label: '本批候选',
            question: c.question,
            answer: candidateAnswer(c, state),
          })),
          ...existing.map((c) => ({
            label: '已有题目',
            question: c.question,
            answer: c.standardAnswer,
          })),
        ],
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
