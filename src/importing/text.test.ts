import { describe, it, expect } from 'vitest';
import { parseText, parseTextBytes, decodeText, sha256 } from './text';
import { duplicateReasons } from './types';

const parse = (text: string, format: 'json' | 'csv' | 'tsv' | 'txt' | 'markdown') =>
  parseText(text, format, 'fictional-document', `虚构.${format}`);
describe('structured source parsing', () => {
  it('parses 69 JSON records and locates escaped strings and nested optional data in the original file', () => {
    const items = Array.from({ length: 69 }, (_, index) => ({
      question: `虚构问题 ${index} 🙂`,
      answer: `中文、逗号, "引号"\n多行答案 ${index}`,
      hints: ['第一提示', '第二提示'],
      metadata: { value: '{[not structure]}' },
    }));
    const text = JSON.stringify({ items }, null, 2);
    const result = parse(text, 'json');
    expect(result.candidates).toHaveLength(69);
    for (let i = 0; i < 69; i++) {
      expect(result.candidates[i]?.standardAnswer).toBe(items[i]?.answer);
      expect(JSON.parse(result.candidates[i]!.source.excerpt!)).toEqual(items[i]);
    }
  });
  it.each([
    ['csv', ','],
    ['tsv', '\t'],
    ['csv', ';'],
  ] as const)('handles quoted multiline %s fields with delimiter %s', (format, delimiter) => {
    const text = `question${delimiter}answer\r\n"中文问题,🙂"${delimiter}"第一行,逗号\n第二行含""引号"""\r\n`;
    const result = parse(text, format);
    expect(result.candidates[0]).toMatchObject({
      question: '中文问题,🙂',
      standardAnswer: '第一行,逗号\n第二行含"引号"',
    });
    expect(result.candidates[0]?.source.excerpt).toContain('第二行');
  });
  it('retains real Markdown headings, multiline answers and Chinese Q/A boundaries', () => {
    const text =
      '# 第一章 虚构知识\nQ: 甲是什么？\nA: 第一要点\n第二要点\n\n## 第二章 对比\n问：乙是什么？\n答：另一答案';
    const result = parse(text, 'markdown');
    expect(result.candidates).toHaveLength(2);
    expect(result.sections).toHaveLength(2);
    expect(result.candidates[0]?.standardAnswer).toBe('第一要点\n第二要点');
    expect(result.candidates[1]?.source.sectionId).toBe(result.sections[1]?.id);
  });
  it('does not invent questions from unstructured prose and leaves incomplete candidates editable', () => {
    expect(parse('这是一段普通讲义，没有明确问答。', 'txt').candidates).toEqual([]);
    expect(parse('这是一段普通讲义，没有明确问答。', 'txt').warnings.length).toBeGreaterThan(0);
    expect(parse('Q: 没有答案的问题', 'txt').candidates[0]?.standardAnswer).toBe('');
    expect(parse('[{"answer":"只有答案"}]', 'json').candidates[0]?.question).toBe('');
  });
  it('rejects broken JSON/CSV, backup files, empty files and invalid encodings with useful messages', () => {
    expect(() => parse('{broken', 'json')).toThrow('JSON');
    expect(() => parse('{"format":"RecallLabBackup"}', 'json')).toThrow('备份与恢复');
    expect(() => parse('question,answer\n"unclosed,x', 'csv')).toThrow('引号');
    expect(() => parse('', 'txt')).toThrow('没有');
    expect(() => decodeText(new Uint8Array([0xff, 0x80, 0x90]))).toThrow('UTF-8');
  });
  it('supports BOM Unicode and preserves the source hash independently of edited answers', async () => {
    const bytes = new TextEncoder().encode('\uFEFF问：虚构问题\n答：虚构答案');
    const result = await parseTextBytes(bytes, '资料.txt', 'txt');
    expect(result.candidates[0]?.standardAnswer).toBe('虚构答案');
    expect(result.document.sourceHash).toBe(await sha256(bytes));
    expect(await sha256(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('flags duplicates without treating a changed answer as permission to overwrite old content', () => {
    const result = parse(
      '[{"question":"相同问题","answer":"甲"},{"question":"相同问题","answer":"乙"}]',
      'json',
    );
    const reasons = duplicateReasons(result.candidates, [
      { question: '相同问题', standardAnswer: '旧答案' },
    ]);
    expect(reasons.size).toBe(2);
    expect(reasons.get(result.candidates[0]!.id)).toContain('答案不同');
  });
});
