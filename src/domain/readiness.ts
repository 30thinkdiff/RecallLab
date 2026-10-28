export function promptProblem(item: { question: string; standardAnswer: string }): string | null {
  const q = item.question.trim(),
    a = item.standardAnswer.trim();
  if (!q || !a) return '问题或标准答案不完整';
  if (/^待完善题干|^请复述\s*[:：]/u.test(q)) return '题干需要人工完善，不能把答案放进题面';
  if (q.replace(/\s/g, '') === a.replace(/\s/g, '')) return '题干与答案相同，请改写题干';
  return null;
}
