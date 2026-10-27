import type { DocumentFormat } from '../domain/models';
import { parseTextBytes } from './text';
export async function parseMaterial(file: File) {
  const extensions: Record<string, DocumentFormat> = {
    json: 'json',
    csv: 'csv',
    tsv: 'tsv',
    txt: 'txt',
    md: 'markdown',
    markdown: 'markdown',
  };
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const format = extensions[extension];
  if (!format) throw new Error('当前支持 JSON、CSV、TSV、TXT、Markdown。Word 文档请先另存为 TXT。');
  if (file.size > 5 * 1024 * 1024) throw new Error('文字题库单次上限为 5 MB，请拆分文件。');
  return parseTextBytes(
    new Uint8Array(await file.arrayBuffer()),
    file.name,
    format as Exclude<DocumentFormat, 'pdf'>,
  );
}
