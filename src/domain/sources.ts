import type { SourceDocument, SourceReference } from './models';

export function assertSourceReference(
  ref: SourceReference,
  document: SourceDocument | undefined,
  projectId: string,
) {
  if (!ref.documentId) return;
  if (!document || ref.documentId !== document.id || document.projectId !== projectId)
    throw new Error('来源资料不存在或不属于此项目');
  const { startOffset: start, endOffset: end } = ref;
  if (
    start === undefined ||
    end === undefined ||
    start >= end ||
    start < 0 ||
    end > document.extractedContent.length ||
    document.extractedContent.slice(start, end) !== ref.excerpt
  )
    throw new Error('来源原文与位置不一致，请重新选择原文');
  if (ref.endPage && (!ref.page || ref.endPage < ref.page)) throw new Error('来源跨页范围无效');
  if (ref.page) {
    const first = document.pages.find((page) => page.number === ref.page);
    const last = document.pages.find((page) => page.number === (ref.endPage ?? ref.page));
    if (
      !first ||
      !last ||
      start < first.startOffset ||
      start >= first.startOffset + first.text.length ||
      end > last.startOffset + last.text.length ||
      end <= last.startOffset ||
      document.pages.some(
        (page) =>
          page.number >= first.number && page.number <= last.number && page.status === 'failed',
      )
    )
      throw new Error('来源页码与原文位置不一致');
  }
  if (
    ref.sectionId &&
    !document.sections.some(
      (section) =>
        section.id === ref.sectionId && start >= section.startOffset && start < section.endOffset,
    )
  )
    throw new Error('来源章节与位置不一致');
}
