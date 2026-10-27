export interface ExtractedTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}
export function pageText(items: ExtractedTextItem[]) {
  let text = '';
  let previous: ExtractedTextItem | undefined;
  for (const item of items) {
    if (previous && text && !text.endsWith('\n')) {
      const moved = Math.abs((item.transform[5] ?? 0) - (previous.transform[5] ?? 0));
      if (moved > Math.max(2, Math.abs(item.height) * 0.4)) text += '\n';
      else {
        const gap = (item.transform[4] ?? 0) - ((previous.transform[4] ?? 0) + previous.width);
        if (gap > 1 && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' ';
      }
    }
    text += item.str;
    if (item.hasEOL) text += '\n';
    previous = item;
  }
  return text.trim();
}
export function textQuality(text: string): 'ready' | 'empty' | 'suspect' {
  if (!text.trim()) return 'empty';
  if (
    text.includes('\uFFFD') ||
    Array.from(text).some(
      (char) => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)),
    )
  )
    return 'suspect';
  return 'ready';
}

export function unreadablePdfMessage(statuses: readonly ('ready' | 'empty' | 'suspect' | 'failed')[]) {
  const failures = statuses.filter((status) => status === 'failed').length;
  if (failures)
    return `未能从 PDF 提取文字：${failures}/${statuses.length} 页解析失败。可能是字体、字符映射或 PDF.js 兼容性问题，不能认定文件是扫描件。请保留原 PDF 并报告此问题。`;
  return '未提取到可用文字，可能是扫描件或空白 PDF。当前没有 OCR；请换用文字型 PDF 或导出 TXT。';
}
