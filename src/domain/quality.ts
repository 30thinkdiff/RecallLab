import type { PracticeItem, SourceDocument } from './models';
import { promptProblem } from './readiness';
export interface QualityIssue {
  kind: 'prompt' | 'vague' | 'criteria' | 'similar' | 'source' | 'ocr';
  message: string;
}
export function questionQuality(cards: PracticeItem[], documents: SourceDocument[]) {
  const docMap = new Map(documents.map((d) => [d.id, d]));
  const keys = new Map<string, number>();
  const key = (q: string) =>
    q
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\p{P}\d]/gu, '');
  for (const c of cards)
    if (!c.archivedAt) keys.set(key(c.question), (keys.get(key(c.question)) ?? 0) + 1);
  return new Map(
    cards
      .filter((c) => !c.archivedAt)
      .map((c) => {
        const issues: QualityIssue[] = [];
        const blocked = promptProblem(c);
        if (blocked) issues.push({ kind: 'prompt', message: blocked });
        if (
          c.question.trim().length < 5 ||
          /^(?:请复述(?:该|本|这)|内容是什么|要求是什么)/u.test(c.question)
        )
          issues.push({ kind: 'vague', message: '题干可能过于笼统，请明确需要回忆的内容' });
        if (c.standardAnswer.length >= 300 && c.answerCriteria.length < 2)
          issues.push({
            kind: 'criteria',
            message: '长答案缺少清晰的必需要点，建议人工补写核对要点',
          });
        if ((keys.get(key(c.question)) ?? 0) > 1)
          issues.push({
            kind: 'similar',
            message: '题干在忽略编号、标点后相同，可能混淆；请比较来源与答案',
          });
        const pages = c.sourceReferences.flatMap(
          (r) =>
            docMap
              .get(r.documentId ?? '')
              ?.pages.filter(
                (p) => p.number >= (r.page ?? 1) && p.number <= (r.endPage ?? r.page ?? 1),
              ) ?? [],
        );
        if (pages.some((p) => p.method === 'ocr'))
          issues.push({
            kind: 'ocr',
            message: '来源含 OCR，原始识别文字未经机器验证，请对照原文件人工核对',
          });
        if (
          pages.some((p) => ['failed', 'suspect'].includes(p.status)) ||
          /�|\[缺失\]|\[截断\]/u.test(c.standardAnswer)
        )
          issues.push({ kind: 'source', message: '来源或答案存在缺失/异常标记，请检查完整性' });
        return [c.id, issues];
      }),
  );
}
