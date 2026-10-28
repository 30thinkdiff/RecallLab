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
