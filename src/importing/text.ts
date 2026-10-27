import Papa from 'papaparse';
import type { DocumentFormat, DocumentSection, SourceReference } from '../domain/models';
import type { ImportCandidate, ParsedMaterial } from './types';
import { MAX_CARDS, MAX_TEXT_BYTES } from './types';

export async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function decodeText(bytes: Uint8Array) {
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? 'utf-16le'
      : bytes[0] === 254 && bytes[1] === 255
        ? 'utf-16be'
        : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new Error('文字编码无法识别。请在原软件中另存为 UTF-8 的 TXT、CSV 或 TSV 后重试。');
  }
}
const questionMark = /^\s*(?:#{1,6}\s+)?(?:\d+[.、)）]\s*)?(?:Q|问|问题|题目)\s*[:：]\s*(.*)$/iu;
const answerMark = /^\s*(?:A|答|答案|标准答案)\s*[:：]\s*(.*)$/iu;
const heading = /^(?:#{1,6}\s+(.+?)\s*#*|((?:第[一二三四五六七八九十百零\d]+[章节篇]).*))$/u;
export function sectionsOf(
  text: string,
  id: string,
  page?: number,
  startOffset = 0,
): DocumentSection[] {
  const sections: DocumentSection[] = [];
  for (const line of text.matchAll(/[^\n]+/g)) {
    if (questionMark.test(line[0])) continue;
    const title = heading.exec(line[0].trim());
    if (title)
      sections.push({
        id: `${id}:section:${startOffset + (line.index ?? 0)}`,
        title: (title[1] ?? title[2] ?? '').trim(),
        startOffset: startOffset + (line.index ?? 0),
        endOffset: startOffset + text.length,
        ...(page ? { page } : {}),
      });
  }
  sections.forEach((section, index) => {
    section.endOffset = sections[index + 1]?.startOffset ?? startOffset + text.length;
  });
  return sections;
}
function reference(
  text: string,
  documentId: string,
  filename: string,
  start: number,
  end: number,
  index: number,
  sections: DocumentSection[],
): SourceReference {
  const section = [...sections]
    .reverse()
    .find((section) => start >= section.startOffset && start < section.endOffset);
  return {
    documentId,
    label: `${filename} · 第 ${index} 条`,
    startOffset: start,
    endOffset: end,
    excerpt: text.slice(start, end),
    recordIndex: index,
    ...(section ? { sectionId: section.id } : {}),
  };
}
function candidate(
  raw: Record<string, unknown>,
  id: string,
  source: SourceReference,
): ImportCandidate {
  const get = (...keys: string[]) => {
    for (const key of keys) if (typeof raw[key] === 'string') return raw[key] as string;
    return '';
  };
  const multiline = (...keys: string[]) => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && value.every((line) => typeof line === 'string'))
        return value.join('\n');
    }
    return '';
  };
  return {
    id,
    selected: true,
    origin: 'rule',
    question: get('question', '问题', '题目'),
    standardAnswer: get('standardAnswer', 'answer', '标准答案', '答案'),
    hints: multiline('hints', '提示'),
    answerCriteria: multiline('answerCriteria', '核对要点'),
    mnemonics: get('mnemonics', '助记'),
    confusionWarnings: get('confusionWarnings', '易混提醒'),
    sourceLabel: source.label,
    source,
  };
}
// Locate actual top-level object spans, including escaped strings; never invent JSON source quotes.
function jsonRanges(text: string, arrayKey: string | null): [number, number][] {
  let start = text.search(/\S/);
  if (arrayKey) {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        const begin = i;
        for (i++; i < text.length; i++) {
          if (text[i] === '\\') {
            i++;
            continue;
          }
          if (text[i] === '"') break;
        }
        if (depth === 1 && JSON.parse(text.slice(begin, i + 1)) === arrayKey) {
          let after = i + 1;
          while (/\s/.test(text[after] ?? '')) after++;
          if (text[after] !== ':') continue;
          after++;
          while (/\s/.test(text[after] ?? '')) after++;
          if (text[after] === '[') {
            start = after;
            break;
          }
        }
      } else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
  const ranges: [number, number][] = [];
  let arrays = 0,
    objects = 0,
    begin = start;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') {
          i++;
          continue;
        }
        if (text[i] === '"') break;
      }
    } else if (ch === '[') arrays++;
    else if (ch === ']') {
      arrays--;
      if (arrays === 0) break;
    } else if (ch === '{') {
      if (arrays === 1 && objects === 0) begin = i;
      objects++;
    } else if (ch === '}') {
      objects--;
      if (arrays === 1 && objects === 0) ranges.push([begin, i + 1]);
    }
  }
  return ranges;
}
export function parseText(
  text: string,
  format: Exclude<DocumentFormat, 'pdf'>,
  id: string,
  filename: string,
) {
  if (!text.trim()) throw new Error('文件没有可读取的文字，请选择包含学习内容的文件。');
  if (text.includes('\0'))
    throw new Error('文件包含无法识别的二进制内容，请导出为文字文件后重试。');
  const sections = sectionsOf(text, id);
  const warnings: string[] = [];
  const candidates: ImportCandidate[] = [];
  if (format === 'json') {
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new Error('JSON 文件不完整或格式有误，请检查引号、逗号和括号。');
    }
    const root =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    if (root?.format === 'RecallLabBackup')
      throw new Error('这是完整数据库备份。请到“备份与恢复”使用；题库导入不会替换现有数据。');
    const key = Array.isArray(root?.items)
      ? 'items'
      : Array.isArray(root?.questions)
        ? 'questions'
        : null;
    const rows = Array.isArray(raw) ? raw : key ? (root![key] as unknown[]) : null;
    if (!rows || !rows.length)
      throw new Error('JSON 题库应为问答数组，或包含 items / questions 数组；请参考页面示例。');
    if (rows.length > MAX_CARDS) throw new Error(`单次最多导入 ${MAX_CARDS} 道题，请拆分文件。`);
    if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)))
      throw new Error('每条 JSON 题目应为包含问题与答案的对象。');
    const ranges = jsonRanges(text, key);
    rows.forEach((row, index) => {
      const range = ranges[index];
      if (!range) throw new Error('无法准确定位 JSON 记录，请检查题库结构。');
      candidates.push(
        candidate(
          row as Record<string, unknown>,
          `${id}:candidate:${index}`,
          reference(text, id, filename, range[0], range[1], index + 1, sections),
        ),
      );
    });
  } else if (format === 'csv' || format === 'tsv') {
    const records: { cells: string[]; start: number; end: number }[] = [];
    let cursor = 0;
    const errors: string[] = [];
    Papa.parse<string[]>(text, {
      delimiter: format === 'tsv' ? '\t' : '',
      delimitersToGuess: [',', ';', '\t'],
      skipEmptyLines: 'greedy',
      step(result) {
        records.push({ cells: result.data, start: cursor, end: result.meta.cursor });
        cursor = result.meta.cursor;
        for (const error of result.errors) errors.push(error.message);
      },
    });
    if (errors.length)
      throw new Error('表格分隔或引号不完整。请将含逗号、换行的字段放在双引号内，再导出 CSV/TSV。');
    const header = records.shift();
    if (!header || !records.length) throw new Error('表格需要标题行和至少一条问答。');
    const names = header.cells.map((cell) => cell.trim());
    if (new Set(names).size !== names.length) throw new Error('表格有重复列名，请先修正标题行。');
    if (
      !names.some((name) => ['question', '问题', '题目'].includes(name)) ||
      !names.some((name) => ['answer', 'standardAnswer', '答案', '标准答案'].includes(name))
    )
      throw new Error('没有找到问题/答案列。请使用 question,answer 或 问题,答案 作为标题。');
    if (records.length > MAX_CARDS) throw new Error(`单次最多导入 ${MAX_CARDS} 道题，请拆分文件。`);
    records.forEach((row, index) => {
      if (row.cells.length !== names.length)
        throw new Error(`第 ${index + 2} 行列数不一致，请检查分隔符及引号。`);
      const object = Object.fromEntries(names.map((name, i) => [name, row.cells[i] ?? '']));
      candidates.push(
        candidate(
          object,
          `${id}:candidate:${index}`,
          reference(text, id, filename, row.start, row.end, index + 1, sections),
        ),
      );
    });
  } else {
    let active: { start: number; question: string[]; answer: string[] | null } | null = null;
    let unassigned = 0;
    const flush = (end: number) => {
      if (active) {
        const index = candidates.length;
        candidates.push(
          candidate(
            {
              question: active.question.join('\n').trim(),
              answer: active.answer?.join('\n').trim() ?? '',
            },
            `${id}:candidate:${index}`,
            reference(text, id, filename, active.start, end, index + 1, sections),
          ),
        );
        active = null;
      }
    };
    for (const line of text.matchAll(/[^\n]*(?:\n|$)/g)) {
      if (!line[0]) continue;
      const value = line[0].replace(/[\r\n]+$/, '');
      const start = line.index ?? 0;
      const q = questionMark.exec(value);
      const a = answerMark.exec(value);
      if (q) {
        flush(start);
        active = { start, question: [q[1] ?? ''], answer: null };
      } else if (heading.test(value.trim())) {
        flush(start);
      } else if (a && active && active.answer === null) {
        active.answer = [a[1] ?? ''];
      } else if (active) {
        (active.answer ?? active.question).push(value);
      } else if (value.trim()) unassigned++;
    }
    flush(text.length);
    if (candidates.length > MAX_CARDS)
      throw new Error(`单次最多导入 ${MAX_CARDS} 道题，请拆分文件。`);
    if (unassigned) warnings.push(`有 ${unassigned} 行未纳入明确问答，请在原文预览中核对。`);
    if (!candidates.length)
      warnings.push('未识别明确问答。可选择原文片段，手工填写问题；不会自动编造题目。');
  }
  return { candidates, sections, warnings };
}
export async function parseTextBytes(
  bytes: Uint8Array,
  filename: string,
  format: Exclude<DocumentFormat, 'pdf'>,
  id = crypto.randomUUID(),
): Promise<ParsedMaterial> {
  if (bytes.length > MAX_TEXT_BYTES) throw new Error('文字题库单次上限为 5 MB，请拆分后导入。');
  const text = decodeText(bytes);
  const parsed = parseText(text, format, id, filename);
  return {
    candidates: parsed.candidates,
    document: {
      id,
      filename,
      fileType: format,
      sourceHash: await sha256(bytes),
      byteLength: bytes.length,
      extractedContent: text,
      pages: [{ number: 1, text, startOffset: 0, status: 'ready', warnings: [] }],
      sections: parsed.sections,
      warnings: parsed.warnings,
      extractionStatus: parsed.warnings.length ? 'needs_review' : 'ready',
      parserVersion: 'RecallLab-text-1',
    },
  };
}
