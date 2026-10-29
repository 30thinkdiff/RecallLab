import { extractNumbered } from '../importing/numbered';
import { sectionsOf } from '../importing/text';
import { promptProblem } from '../domain/readiness';
import { sourceSpans } from './inference';
import { exampleLike, locateQuote, type AiSource } from './evidence';
import type { SuggestedItem, LearningObjective } from './protocol';
export interface KnowledgeSlice {
  key: string;
  start: number;
  end: number;
  chapter: string;
  title: string;
  text: string;
  notForCards: boolean;
}
const unsuitable = /个人随笔|尚无结论|不适合直接作为标准答案|没有给出可核对的定义/u;
export function planKnowledge(source: AiSource): KnowledgeSlice[] {
  const start = source.range?.start ?? 0,
    end = source.range?.end ?? source.text.length;
  const sections = sectionsOf(source.text, source.id);
  const make = (a: number, b: number, title = ''): KnowledgeSlice => ({
    key: `${source.id}:${a}:${b}`,
    start: a,
    end: b,
    text: source.text.slice(a, b),
    title,
    chapter: [...sections].reverse().find((s) => s.startOffset <= a)?.title ?? '原文',
    notForCards: unsuitable.test(source.text.slice(a, b)),
  });
  if (source.kind === 'answer') return [make(0, source.text.length, source.question ?? '')];
  const numbered = extractNumbered(
    source.text,
    source.document?.pages ?? [],
    source.id,
    '原文',
  ).candidates;
  const planned: KnowledgeSlice[] = [];
  for (const row of numbered) {
    const found = locateQuote(
      source.text,
      row.standardAnswer,
      row.source.startOffset ?? 0,
      row.source.endOffset ?? source.text.length,
    );
    if (found.status === 'matched' && found.anchor.start >= start && found.anchor.end <= end)
      planned.push(
        make(found.anchor.start, found.anchor.end, promptProblem(row) ? '' : row.question),
      );
  }
  if (planned.length) return planned;
  // Paragraphs retain conditions and contrast sentences together. Headings alone are not facts.
  for (const block of source.text.slice(start, end).matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/gu)) {
    let a = start + block.index,
      b = a + block[0].length;
    const lines = source.text.slice(a, b).split('\n');
    while (
      lines.length &&
      /^\s*(?:#{1,6}\s|第[一二三四五六七八九十\d]+(?:部分|章|节))/u.test(lines[0]!)
    ) {
      a += lines.shift()!.length + 1;
    }
    const raw = source.text.slice(a, b);
    const instruction = raw.search(/\n\s*\[(?:伪系统|系统指令)/u);
    if (instruction >= 0) b = a + instruction;
    while (b > a && /\s/u.test(source.text[b - 1]!)) b--;
    if (b > a) planned.push(make(a, b));
  }
  return planned;
}
export function sourceCriteria(text: string) {
  return sourceSpans(text)
    .filter((s) => s.text.trim())
    .map((s) => ({
      text: s.text
        .trim()
        .replace(/^(?:答案\s*[:：]|第[一二三四五六七八九十]+\s*[，、:：.]|\d+\s*[.、．])\s*/u, ''),
      quote: s.text.trim(),
      importance:
        exampleLike(s.text) || /^\s*(?:例如|比如|For example|Examples)/iu.test(s.text)
          ? ('optional' as const)
          : ('required' as const),
    }))
    .filter((c) => c.text.length > 1);
}
export function guidedItem(
  question: string,
  unit: KnowledgeSlice,
  goal: LearningObjective,
): SuggestedItem {
  return {
    question,
    answerSuggestion: unit.text,
    evidenceQuote: unit.text,
    criteria: sourceCriteria(unit.text),
    hints: [],
    mnemonic: '',
    confusion: '',
    qualityNotes: [
      `答案及要点来自原文规则拆分（${goal}），模型只建议题干；必要性与语义仍需人工核对。`,
      ...(unit.notForCards ? ['文章缺少可核对结论，建议暂不制卡'] : []),
    ],
  };
}
