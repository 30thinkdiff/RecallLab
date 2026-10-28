import type { SourceDocument, SourceReference } from '../domain/models';
import type { EvidenceAnchor } from './provenance';
import { MAX_CHUNK_CHARS } from './protocol';
export interface AiSource {
  kind: 'document' | 'answer';
  id: string;
  text: string;
  document?: SourceDocument;
  expectedRevisionId?: string;
  question?: string;
  sourceReferences?: SourceReference[];
  range?: { start: number; end: number };
}
export interface TextChunk {
  id: string;
  start: number;
  end: number;
  text: string;
}
export function chunksOf(source: AiSource): TextChunk[] {
  if (!source.text.trim()) throw new Error('没有可分析的文字，请先完成解析或人工整理。');
  const range = source.range ?? { start: 0, end: source.text.length };
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start ||
    range.end > source.text.length
  )
    throw new Error('请选择有效原文范围');
  if (range.end - range.start > 100000)
    throw new Error('本批最多分析 10 万字符，请选择部分页面或原文范围。');
  const chunks: TextChunk[] = [];
  let start = range.start;
  while (start < range.end) {
    let end = Math.min(range.end, start + MAX_CHUNK_CHARS);
    if (end < range.end) {
      const boundary = source.text.lastIndexOf('\n', end);
      if (boundary > start + MAX_CHUNK_CHARS / 2) end = boundary;
    }
    chunks.push({
      id: `${source.id}:${start}:${end}`,
      start,
      end,
      text: source.text.slice(start, end),
    });
    if (end === range.end) break;
    start = Math.max(start + 1, end - 160);
  }
  return chunks;
}
export function locateQuote(
  text: string,
  quote: string,
  start = 0,
  end = text.length,
):
  | { status: 'matched'; anchor: EvidenceAnchor; layoutAdjusted?: boolean }
  | { status: 'missing' | 'ambiguous' } {
  const exact = quote.trim();
  if (!exact) return { status: 'missing' };
  const slice = text.slice(start, end),
    offset = slice.indexOf(exact);
  if (offset >= 0) {
    if (slice.indexOf(exact, offset + 1) >= 0) return { status: 'ambiguous' };
    return {
      status: 'matched',
      anchor: { start: start + offset, end: start + offset + exact.length, quote: exact },
    };
  }
  // Only normalize layout whitespace, never punctuation, letters, digits or OCR characters.
  // Retain a word boundary beside Latin letters/digits ("not able" must not match "notable").
  const layout = (value: string) => {
    let normalized = '';
    const positions: number[] = [];
    for (let i = 0; i < value.length; i++) {
      if (/\s/u.test(value[i]!)) {
        const begin = i;
        while (i + 1 < value.length && /\s/u.test(value[i + 1]!)) i++;
        const before = value[begin - 1] ?? '',
          after = value[i + 1] ?? '';
        const word = (c: string) => /[\p{L}\p{N}]/u.test(c) && !/\p{Script=Han}/u.test(c);
        if (word(before) || word(after)) {
          normalized += ' ';
          positions.push(begin);
        }
      } else {
        normalized += value[i];
        positions.push(i);
      }
    }
    return { normalized, positions };
  };
  const haystack = layout(slice),
    needle = layout(exact).normalized;
  if (!needle) return { status: 'missing' };
  const index = haystack.normalized.indexOf(needle);
  if (index < 0) return { status: 'missing' };
  if (haystack.normalized.indexOf(needle, index + 1) >= 0) return { status: 'ambiguous' };
  const a = haystack.positions[index]!,
    b = haystack.positions[index + needle.length - 1]! + 1;
  return {
    status: 'matched',
    layoutAdjusted: true,
    anchor: { start: start + a, end: start + b, quote: slice.slice(a, b) },
  };
}
export function referenceFor(doc: SourceDocument, anchor: EvidenceAnchor): SourceReference {
  if (doc.extractedContent.slice(anchor.start, anchor.end) !== anchor.quote)
    throw new Error('原文已变化，请重新生成或选择引用');
  const first = [...doc.pages].reverse().find((p) => p.startOffset <= anchor.start),
    last = [...doc.pages].reverse().find((p) => p.startOffset < anchor.end);
  const section = doc.sections.find(
    (s) => s.startOffset <= anchor.start && s.endOffset >= anchor.start,
  );
  return {
    documentId: doc.id,
    label: `${doc.filename}${doc.fileType === 'pdf' && first ? ` · 第 ${first.number}${last && last.number !== first.number ? `—${last.number}` : ''} 页` : ''}`,
    excerpt: anchor.quote,
    startOffset: anchor.start,
    endOffset: anchor.end,
    ...(doc.fileType === 'pdf' && first
      ? {
          page: first.number,
          ...(last && last.number !== first.number ? { endPage: last.number } : {}),
        }
      : {}),
    ...(section ? { sectionId: section.id } : {}),
  };
}
export function uncoveredText(text: string, anchors: EvidenceAnchor[], base = 0) {
  const intervals = anchors
    .map((a) => [Math.max(0, a.start - base), Math.min(text.length, a.end - base)] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const gaps: { start: number; end: number; text: string }[] = [];
  let end = 0;
  for (const [a, b] of intervals) {
    if (a > end) gaps.push({ start: base + end, end: base + a, text: text.slice(end, a) });
    end = Math.max(end, b);
  }
  if (end < text.length)
    gaps.push({ start: base + end, end: base + text.length, text: text.slice(end) });
  const meaningful = gaps.filter((g) => g.text.replace(/[\s\p{P}]/gu, '').length > 0);
  return {
    characters: meaningful.reduce((n, g) => n + g.text.replace(/\s/gu, '').length, 0),
    gaps: meaningful,
  };
}
export function exampleLike(quote: string) {
  return /例如|比如|举例|for example|e\.g\./iu.test(quote);
}
