import type { DocumentPage } from '../domain/models';
import type { ImportCandidate } from './types';
import { MAX_CARDS } from './types';
import { sectionsOf } from './text';

export interface ContentCoverage {
  totalPages: number;
  readablePages: number;
  sections: number;
  candidates: number;
  unassignedCharacters: number;
  unassigned: { page: number; startOffset: number; endOffset: number }[];
  reviewItems: number;
  crossPageItems: number;
  problemPages: number[];
}
const auxiliary = /^\s*(?:口诀|助记(?:技巧)?|记忆口诀|解释|解析)\s*[:：]/u;
const footer = /^\s*(?:[-—–]\s*)?(?:第\s*)?\d+(?:\s*[/／]\s*\d+|\s*页)?(?:\s*[-—–])?\s*$/u;
const qmark = /^\s*(?:#{1,6}\s*)?(?:问题|问|Q)\s*[:：]\s*/iu;
const amark = /^\s*(?:答案|标准答案|答|A)\s*[:：]\s*/iu;
const numbered = /^\s*(?:#{1,6}\s*)?(?:(\d{1,3})\s*[．.、)）]|[（(]\s*(\d{1,3})\s*[）)])\s*/u;
// Explicit answers are sliced from the source. Statement recall retains the whole original item.
export function extractNumbered(text: string, pages: DocumentPage[], id: string, filename: string) {
  const sections = sectionsOf(text, id);
  for (const section of sections)
    section.page = [...pages]
      .reverse()
      .find((page) => page.startOffset <= section.startOffset)?.number;
  const lines = Array.from(text.matchAll(/[^\n]+/gu), (m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
  const titleLine =
    sections.length &&
    lines[0] &&
    lines[0].start < sections[0]!.startOffset &&
    lines[0].text.trim().length <= 200
      ? lines[0]
      : undefined;
  const title = titleLine?.text.trim();
  const sectionAt = (start: number) => [...sections].reverse().find((s) => start >= s.startOffset);
  const bareSections = new Set(
    lines.filter((l) => numbered.exec(l.text)?.[1]).map((l) => sectionAt(l.start)?.id ?? ''),
  );
  const starts = lines.flatMap((line) => {
    if (sections.some((s) => s.startOffset === line.start) || footer.test(line.text)) return [];
    const q = qmark.exec(line.text);
    const n = numbered.exec(line.text);
    if (!q && !n) return [];
    if (!q && n?.[2] && bareSections.has(sectionAt(line.start)?.id ?? '')) return [];
    // Bare list entries without a title delimiter inside an answer remain answer subpoints.
    if (!q && !/[：:？?]/u.test(line.text) && line.text.trim().length > 150) return [];
    return [{ ...line, prefix: (q ?? n)![0].length, explicit: !!q }];
  });
  if (starts.length > MAX_CARDS) throw new Error(`单次最多识别 ${MAX_CARDS} 个条目，请拆分资料。`);
  const covered: [number, number][] = [];
  const candidates: ImportCandidate[] = [];
  for (const [i, start] of starts.entries()) {
    const nextHeading =
      sections.find((s) => s.startOffset > start.start)?.startOffset ?? text.length;
    let end = Math.min(starts[i + 1]?.start ?? text.length, nextHeading);
    while (end > start.start && /\s/u.test(text[end - 1]!)) end--;
    const excerpt = text.slice(start.start, end);
    const bodyLines = excerpt
      .slice(start.prefix)
      .split('\n')
      .filter((l) => !footer.test(l));
    const auxIndex = bodyLines.findIndex((l) => auxiliary.test(l));
    const main = (auxIndex < 0 ? bodyLines : bodyLines.slice(0, auxIndex)).join('\n').trim();
    const answerMarker = main.split('\n').findIndex((l) => amark.test(l));
    let question = '',
      standardAnswer = '';
    if (answerMarker >= 0) {
      const a = main.split('\n');
      question = a.slice(0, answerMarker).join('\n').trim();
      standardAnswer = a.slice(answerMarker).join('\n').replace(amark, '').trim();
    } else if (!start.explicit) {
      const delimiter = /[:：]/u.exec(main);
      if (delimiter) {
        question = main.slice(0, delimiter.index).trim();
        standardAnswer = main.slice(delimiter.index + 1).trim();
      } else {
        const qm = /[？?]/u.exec(main);
        if (qm) {
          question = main.slice(0, qm.index + 1).trim();
          standardAnswer = main.slice(qm.index + 1).trim();
        } else question = main;
      }
    } else question = main;
    const statement = !!question && !standardAnswer && !start.explicit && !/[？?]/u.test(question);
    if (statement) {
      standardAnswer = main;
      question = `待完善题干（条目 ${i + 1}）`;
    }
    const first = [...pages].reverse().find((p) => p.startOffset <= start.start);
    const last = [...pages].reverse().find((p) => p.startOffset < end);
    const affected = pages.filter(
      (p) => p.number >= (first?.number ?? 1) && p.number <= (last?.number ?? 1),
    );
    const reviewNotes = [
      ...(statement
        ? ['未发现明确问答分隔；答案和来源已保留，请人工完善题干。完善前不进入学习队列。']
        : []),
      ...(!question || !standardAnswer ? ['未找到完整问题与答案，请补全。'] : []),
      ...(affected.some((p) => p.status !== 'ready')
        ? ['来源页面存在提取疑点，请对照原文件。']
        : []),
      ...(auxIndex >= 0 ? ['已将口诀或解释与标准答案分开，请核对。'] : []),
      ...(affected.some((p) => p.method === 'ocr') ? ['来自 OCR，必须对照页面图像确认。'] : []),
      ...(/[：:，,、（(]$/u.test(standardAnswer) ? ['答案末尾可能未完，请核对是否截断。'] : []),
    ];
    const section = sectionAt(start.start);
    const label = `${filename} · 第 ${first?.number ?? 1}${last && last.number !== first?.number ? `–${last.number}` : ''} 页`;
    candidates.push({
      id: `${id}:candidate:${i}`,
      selected: true,
      origin: 'rule',
      question,
      standardAnswer,
      hints: '',
      answerCriteria: '',
      mnemonics: auxIndex >= 0 ? bodyLines.slice(auxIndex).join('\n') : '',
      confusionWarnings: '',
      sourceLabel: label,
      reviewNotes,
      source: {
        documentId: id,
        page: first?.number ?? 1,
        ...(last && last.number !== first?.number ? { endPage: last.number } : {}),
        label,
        startOffset: start.start,
        endOffset: end,
        excerpt,
        recordIndex: i + 1,
        ...(section ? { sectionId: section.id } : {}),
      },
    });
    covered.push([start.start, end]);
  }
  const unassigned = lines
    .filter(
      (l) =>
        l !== titleLine &&
        !footer.test(l.text) &&
        !sections.some((s) => s.startOffset === l.start) &&
        !covered.some(([a, b]) => l.start >= a && l.end <= b),
    )
    .map((l) => ({
      page: [...pages].reverse().find((p) => p.startOffset <= l.start)?.number ?? 1,
      startOffset: l.start,
      endOffset: l.end,
    }));
  const unassignedCharacters = unassigned.reduce(
    (sum, r) =>
      sum + Array.from(text.slice(r.startOffset, r.endOffset)).filter((c) => !/\s/u.test(c)).length,
    0,
  );
  const coverage: ContentCoverage = {
    totalPages: pages.length,
    readablePages: pages.filter((p) => p.text.trim() && p.status !== 'failed').length,
    sections: sections.length,
    candidates: candidates.length,
    unassignedCharacters,
    unassigned,
    reviewItems: candidates.filter((c) => c.reviewNotes?.length).length,
    crossPageItems: candidates.filter((c) => c.source.endPage).length,
    problemPages: pages.filter((p) => p.status !== 'ready').map((p) => p.number),
  };
  return { candidates, sections, coverage, title };
}
