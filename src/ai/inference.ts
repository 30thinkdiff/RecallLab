import { AiError, modelOutputSchema, type SuggestedItem } from './protocol';
// IDs refer only to this request. The model cannot choose arbitrary files or URLs.
export function sourceSpans(text: string) {
  const spans: { id: string; start: number; end: number; text: string }[] = [];
  const boundary = /[。；！？]|[.!?;](?=\s|$)|\n+/gu;
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].length;
    if (text.slice(start, end).trim())
      spans.push({ id: `s${spans.length + 1}`, start, end, text: text.slice(start, end) });
    start = end;
    if (spans.length === 79) break;
  }
  if (text.slice(start).trim())
    spans.push({ id: `s${spans.length + 1}`, start, end: text.length, text: text.slice(start) });
  return spans;
}
export class ResolvedOutput {
  constructor(
    readonly data: { items: SuggestedItem[] },
    readonly wire: { items: SuggestedItem[] },
  ) {}
}
export function resolveReferences(raw: unknown, text: string) {
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) throw new AiError('invalid-output', '模型输出结构无效，没有修改题库。');
  const spans = sourceSpans(text);
  function resolve(quote: string) {
    const match = /^s(\d+)(?:\.\.s(\d+))?$/u.exec(quote.trim());
    if (!match) return quote; // Literal citations still undergo the normal source check.
    const first = spans[Number(match[1]) - 1],
      last = spans[Number(match[2] ?? match[1]) - 1];
    return first && last && last.end >= first.end ? text.slice(first.start, last.end) : quote;
  }
  return new ResolvedOutput(
    {
      items: parsed.data.items.map((item) => ({
        ...item,
        evidenceQuote: resolve(item.evidenceQuote),
        criteria: item.criteria.map((c) => ({ ...c, quote: resolve(c.quote) })),
      })),
    },
    parsed.data,
  );
}
