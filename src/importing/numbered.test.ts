import { expect, it } from 'vitest';
import { extractNumbered } from './numbered';
import { assertSourceReference } from '../domain/sources';
import type { SourceDocument } from '../domain/models';
function parse(parts: string[]) {
  let content = '';
  const pages = parts.map((text, i) => {
    const page = {
      number: i + 1,
      text,
      startOffset: content.length,
      status: 'ready' as const,
      warnings: [],
    };
    content += text + '\n\n';
    return page;
  });
  return { ...extractNumbered(content, pages, 'd', 'fiction.pdf'), text: content, pages };
}
it('retains cross-page answers, resets numbers per section and excludes page numbers and mnemonic lines', () => {
  const r = parse([
    '虚构标题\n第一部分 基础\n1．规则甲：原文第一段\n（1）子点不得拆卡\n1',
    '原文第二段。\n2. 规则乙：原文乙。\n口诀：测试口诀。\n第二部分 应用\n1．规则丙：原文丙。\n2',
  ]);
  expect(r.candidates).toHaveLength(3);
  expect(r.sections).toHaveLength(2);
  expect(r.candidates[0]?.standardAnswer).toBe('原文第一段\n（1）子点不得拆卡\n\n原文第二段。');
  expect(r.candidates[0]?.source).toMatchObject({ page: 1, endPage: 2 });
  expect(r.candidates[1]?.standardAnswer).toBe('原文乙。');
  expect(r.candidates[1]?.mnemonics).toContain('测试口诀');
  expect(r.coverage.crossPageItems).toBe(1);
  const document: SourceDocument = {
    filename: 'fiction.pdf',
    fileType: 'pdf',
    importedAt: new Date().toISOString(),
    sourceHash: 'a'.repeat(64),
    byteLength: 1,
    extractionStatus: 'needs_review',
    warnings: [],
    parserVersion: 'test',
    importDigest: 'b'.repeat(64),
    initialItemIds: [],
    id: 'd',
    projectId: 'p',
    extractedContent: r.text,
    pages: r.pages,
    sections: r.sections,
  };
  for (const row of r.candidates)
    expect(() => assertSourceReference(row.source, document, 'p')).not.toThrow();
  expect(() =>
    assertSourceReference({ ...r.candidates[0]!.source, endPage: 1 }, document, 'p'),
  ).toThrow();
});
it('supports explicit questions, parenthesized top-level points and Chinese numbered chapter headings', () => {
  const r = parse([
    '虚构标题\n一、基础规则\n（1）名称甲：答案甲。\n（2）名称乙：答案乙。\n二、应用规则\n问题：名称丙是什么？\n答案：答案丙。',
  ]);
  expect(r.sections).toHaveLength(2);
  expect(r.candidates.map((c) => c.standardAnswer)).toEqual(['答案甲。', '答案乙。', '答案丙。']);
});
it('keeps unstructured prose unassigned and flags statement-style recall, missing and damaged answers', () => {
  expect(parse(['只有普通正文，没有问答或编号。']).candidates).toHaveLength(0);
  const r = parse(['1. 虚构知识陈述。\n2．规则乙：未完，\n问题：未给出答案']);
  expect(r.candidates[0]?.standardAnswer).toBe('虚构知识陈述。');
  expect(r.candidates[0]?.reviewNotes).not.toHaveLength(0);
  expect(r.coverage.reviewItems).toBe(3);
  expect(r.candidates[2]?.standardAnswer).toBe('');
});
it('uses source character offsets verbatim with Unicode, including supplementary characters', () => {
  const r = parse(['第一部分 示例\n1．规则🙂：原文𠮷字。\n2．名称：末段。']);
  for (const c of r.candidates)
    expect(r.text.slice(c.source.startOffset, c.source.endOffset)).toBe(c.source.excerpt);
  expect(r.coverage.unassignedCharacters).toBe(0);
});
