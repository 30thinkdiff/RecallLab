export function promptProblem(item: {
  question: string;
  standardAnswer: string;
  learningIssue?: { reason: string };
}): string | null {
  if (item.learningIssue) return '题目已标记待核对：' + item.learningIssue.reason;
  const q = item.question.trim(),
    a = item.standardAnswer.trim();
  if (!q || !a) return '问题或标准答案不完整';
  if (/^待完善题干|^请复述\s*[:：]/u.test(q)) return '题干需要人工完善，不能把答案放进题面';
  if (q.replace(/\s/g, '') === a.replace(/\s/g, '')) return '题干与答案相同，请改写题干';
  const compact = (text: string) => text.normalize('NFKC').replace(/[\s\p{P}]/gu, '');
  if (compact(a).length >= 8 && compact(q).includes(compact(a)))
    return '题干直接包含完整标准答案，请改写题干';
  return null;
}
