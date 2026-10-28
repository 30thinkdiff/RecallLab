import type { DocumentFormat } from '../domain/models';
import { parseTextBytes } from './text';
export async function parseMaterial(
  file: File,
  onProgress?: (page: number, total: number) => void,
  options?: import('./pdf').PdfOptions,
) {
  const extensions: Record<string, DocumentFormat> = {
    json: 'json',
    csv: 'csv',
    tsv: 'tsv',
    txt: 'txt',
    md: 'markdown',
    markdown: 'markdown',
    pdf: 'pdf',
  };
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const format = extensions[extension];
  if (!format)
    throw new Error(
      '当前支持 JSON、CSV、TSV、TXT、Markdown、文字型 PDF。Word 文档请先另存为 TXT。',
    );
  if (format === 'pdf') {
    if (file.size > 20 * 1024 * 1024) throw new Error('PDF 单次上限为 20 MB，请拆分后导入。');
    const { parsePdfBytes } = await import('./pdf');
    return parsePdfBytes(new Uint8Array(await file.arrayBuffer()), file.name, onProgress, options);
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('文字题库单次上限为 5 MB，请拆分文件。');
  return parseTextBytes(
    new Uint8Array(await file.arrayBuffer()),
    file.name,
    format as Exclude<DocumentFormat, 'pdf'>,
  );
}
