import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { sha256, sectionsOf } from './text';
import { MAX_PDF_BYTES, type ParsedMaterial } from './types';
import type { DocumentPage } from '../domain/models';
import { pageText, textQuality } from './pdf-layout';

GlobalWorkerOptions.workerSrc = workerUrl;
class PdfImportError extends Error {}
export async function parsePdfBytes(
  bytes: Uint8Array,
  filename: string,
  onProgress?: (page: number, total: number) => void,
): Promise<ParsedMaterial> {
  if (bytes.length > MAX_PDF_BYTES)
    throw new PdfImportError('PDF 单次上限为 20 MB，请拆分后导入。');
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new PdfImportError('文件不是有效的 PDF，请重新导出或选择其他文件。');
  const id = crypto.randomUUID();
  const hash = await sha256(bytes);
  const task = getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const work = async (): Promise<ParsedMaterial> => {
      const pdf = await task.promise;
      if (pdf.numPages > 200) throw new PdfImportError('当前单次支持最多 200 页，请先拆分 PDF。');
      const pages: DocumentPage[] = [];
      let content = '';
      for (let number = 1; number <= pdf.numPages; number++) {
        if (timedOut) throw new PdfImportError('PDF 提取超时，请拆分文件后重试。');
        onProgress?.(number, pdf.numPages);
        const startOffset = content.length;
        let text = '';
        let status: DocumentPage['status'] = 'ready';
        const warnings: string[] = [];
        try {
          const page = await pdf.getPage(number);
          const extracted = await page.getTextContent();
          text = pageText(extracted.items.filter((item) => 'str' in item));
          status = textQuality(text);
          if (status === 'empty')
            warnings.push('未提取到文字：可能是空白页或扫描图片，当前没有 OCR。');
          if (status === 'suspect') warnings.push('此页可能有乱码或缺字，请对照原 PDF 核对。');
          page.cleanup();
        } catch {
          if (timedOut) throw new PdfImportError('PDF 提取超时，请拆分文件后重试。');
          status = 'failed';
          warnings.push('此页文字提取失败，没有将其视为成功。请对照原文件，或重新导出 PDF。');
        }
        pages.push({ number, text, startOffset, status, warnings });
        content += text + '\n\n';
        if (content.length > 2_000_000)
          throw new PdfImportError('提取的文字过多，请拆分 PDF 后导入。');
      }
      if (!pages.some((page) => page.text.trim()))
        throw new PdfImportError(
          '未提取到可用文字，可能是扫描件或空白 PDF。当前没有 OCR；请换用文字型 PDF 或导出 TXT。',
        );
      const warnings = [
        '当前仅提取文字，不包含图片和版式；阅读顺序也可能不同，请对照原 PDF 核对。',
      ];
      for (const page of pages)
        for (const warning of page.warnings) warnings.push(`第 ${page.number} 页：${warning}`);
      return {
        candidates: [],
        document: {
          id,
          filename,
          fileType: 'pdf',
          sourceHash: hash,
          byteLength: bytes.length,
          extractedContent: content,
          pages,
          sections: pages.flatMap((page) =>
            sectionsOf(page.text, id, page.number, page.startOffset),
          ),
          extractionStatus: pages.some((page) => page.status !== 'ready')
            ? 'partial'
            : 'needs_review',
          warnings,
          parserVersion: 'PDF.js-5.5.207-text-1',
        },
      };
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        void task.destroy();
        reject(new PdfImportError('PDF 提取超时，请拆分文件后重试。'));
      }, 45000);
    });
    return await Promise.race([work(), timeout]);
  } catch (cause) {
    if (cause instanceof PdfImportError) throw cause;
    if (cause instanceof Error && cause.name === 'PasswordException')
      throw new PdfImportError('PDF 已加密或需要密码，请在原软件中导出可读取的副本。');
    throw new PdfImportError(
      'PDF 文字提取失败，文件可能损坏或格式不受支持。请重新导出，或改用 TXT/Markdown。',
    );
  } finally {
    if (timer) clearTimeout(timer);
    await task.destroy().catch(() => undefined);
  }
}
