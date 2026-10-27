import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { sha256 } from './text';
import { MAX_PDF_BYTES, type ParsedMaterial } from './types';
import type { DocumentPage } from '../domain/models';
import { extractNumbered } from './numbered';
import { classifyPdfPage, pageText, reconcileOcrText, textQuality, unreadablePdfMessage } from './pdf-layout';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import type { createLocalOcr } from './ocr';

GlobalWorkerOptions.workerSrc = workerUrl;
class PdfImportError extends Error {}
export interface PdfOptions {
  signal?: AbortSignal;
  ocr?: boolean;
  onOcrProgress?: (page: number, total: number, fraction: number) => void;
}
export async function parsePdfBytes(
  bytes: Uint8Array,
  filename: string,
  onProgress?: (page: number, total: number) => void,
  options: PdfOptions = {},
): Promise<ParsedMaterial> {
  if (bytes.length > MAX_PDF_BYTES)
    throw new PdfImportError('PDF 单次上限为 20 MB，请拆分后导入。');
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new PdfImportError('文件不是有效的 PDF，请重新导出或选择其他文件。');
  if (options.signal?.aborted) throw new DOMException('已取消本次解析', 'AbortError');
  const id = crypto.randomUUID();
  const hash = await sha256(bytes);
  const controller = new AbortController();
  const task = getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: true,
    cMapUrl: `${import.meta.env.BASE_URL}pdf-assets/5.5.207/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdf-assets/5.5.207/standard_fonts/`,
    wasmUrl: `${import.meta.env.BASE_URL}pdf-assets/5.5.207/wasm/`,
  });
  let ocr: Awaited<ReturnType<typeof createLocalOcr>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let currentPage = 0,
    total = 0,
    timedOut = false;
  const cancel = () => {
    controller.abort();
    void task.destroy();
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const abortPromise = new Promise<never>((_, reject) =>
    controller.signal.addEventListener(
      'abort',
      () => reject(new DOMException('已取消本次解析', 'AbortError')),
      { once: true },
    ),
  );
  const check = () => {
    if (controller.signal.aborted) throw new DOMException('已取消本次解析', 'AbortError');
  };
  try {
    const work = async (): Promise<ParsedMaterial> => {
      const pdf = await task.promise;
      total = pdf.numPages;
      if (total > 200) throw new PdfImportError('当前单次支持最多 200 页，请先拆分 PDF。');
      const metadata = await pdf.getMetadata().catch(() => undefined);
      const pages: DocumentPage[] = [];
      const report: NonNullable<ParsedMaterial['pdfReport']> = {
        creator: String((metadata?.info as { Creator?: unknown } | undefined)?.Creator ?? ''),
        pages: [],
      };
      const previews: Record<number, string> = {};
      let content = '',
        ocrPages = 0;
      for (let number = 1; number <= total; number++) {
        check();
        currentPage = number;
        onProgress?.(number, total);
        const startOffset = content.length;
        let text = '',
          items = 0;
        let status: DocumentPage['status'] = 'ready';
        let kind: DocumentPage['kind'] = 'failed',
          method: DocumentPage['method'] = 'text',
          confidence: number | undefined,
          errorName: string | undefined;
        const warnings: string[] = [];
        let page: PDFPageProxy | undefined;
        try {
          page = await pdf.getPage(number);
          const extracted = await page.getTextContent();
          const textItems = extracted.items.filter((item) => 'str' in item);
          items = textItems.length;
          text = pageText(textItems);
          status = textQuality(text);
        } catch (cause) {
          check();
          status = 'failed';
          errorName = cause instanceof Error ? cause.name : 'UnknownError';
          console.warn('RecallLab: PDF page text extraction failed', {
            page: number,
            name: errorName,
            reason: cause instanceof Error ? cause.message : String(cause),
          });
          warnings.push('文字解析失败，不能据此判定为扫描件。');
        }
        const textLayer = text;
        let images = false,
          inspectionFailed = false;
        try {
          if (!page) throw new Error();
          const operators = await page.getOperatorList();
          images = operators.fnArray.some((op) =>
            [
              OPS.paintImageXObject,
              OPS.paintInlineImageXObject,
              OPS.paintImageMaskXObject,
              OPS.paintImageXObjectRepeat,
            ].includes(op),
          );
        } catch {
          check();
          inspectionFailed = true;
          warnings.push('页面图像检查失败，请核对原文件；未据此判定为扫描件。');
        }
        if (inspectionFailed && !text.trim()) {
          status = 'failed';
          errorName ??= 'ImageInspectionError';
        }
        kind = classifyPdfPage(status, images);
        if (status === 'empty')
          warnings.push(
            images
              ? '未提取到文字：页面含图片，尚未运行本地 OCR。'
              : '未提取到文字或图片：此页可能为空白。',
          );
        if (kind === 'mixed')
          warnings.push(
            '图文混合页：图片里的文字尚未识别，可选择本地 OCR；请核对是否遗漏图片内容。',
          );
        if (status === 'suspect') warnings.push('此页可能有乱码或缺字，请对照原 PDF 核对。');
        if (
          page &&
          options.ocr &&
          ((status !== 'ready' && (images || status === 'suspect')) || kind === 'mixed')
        ) {
          if (++ocrPages > 20)
            throw new PdfImportError('本地 OCR 单次最多处理 20 页，请拆分扫描资料。');
          if (!ocr) {
            const { createLocalOcr } = await import('./ocr');
            ocr = await createLocalOcr(controller.signal, (f) =>
              options.onOcrProgress?.(currentPage, total, f),
            );
          }
          try {
            const recognized = await ocr.recognize(page);
            check();
            const outcome = reconcileOcrText(textLayer, recognized.text);
            text = outcome.text;
            previews[number] = recognized.preview;
            if (outcome.hasOcrText) {
              confidence = recognized.confidence;
              method = 'ocr';
              status = 'suspect';
              warnings.push('文字来自本地 OCR，尚未验证；请对照页面图像修改问题和答案。');
              if (confidence < 75)
                warnings.push('识别把握较低，可能有缺字或误字，请重点核对。');
            } else {
              status = outcome.preservedNativeText ? textQuality(textLayer) : 'empty';
              warnings.push(
                outcome.preservedNativeText
                  ? 'OCR 没有识别出图片中的附加文字，原 PDF 文字层已保留；请核对图片部分。'
                  : 'OCR 没有识别出文字，请核对页面清晰度。',
              );
            }
          } catch (cause) {
            check();
            const outcome = reconcileOcrText(textLayer, '');
            text = outcome.text;
            status = outcome.preservedNativeText ? textQuality(textLayer) : 'failed';
            warnings.push(
              outcome.preservedNativeText
                ? '本地 OCR 未能完成，已保留原 PDF 文字层；图片部分尚未验证。'
                : cause instanceof Error && cause.message.startsWith('本地')
                  ? cause.message
                  : '本地 OCR 未能完成，此页仍未识别，请重试。',
            );
          }
        }
        pages.push({
          number,
          text,
          startOffset,
          status,
          warnings,
          kind,
          method,
          ...(method === 'ocr' ? { textLayer } : {}),
          ...(confidence === undefined ? {} : { confidence }),
        });
        report.pages.push({
          number,
          items,
          characters: text.length,
          kind,
          ...(errorName ? { errorName } : {}),
        });
        content += text + '\n\n';
        page?.cleanup();
        if (content.length > 2_000_000)
          throw new PdfImportError('提取的文字过多，请拆分 PDF 后导入。');
      }
      if (!pages.some((p) => p.text.trim()) && !pages.some((p) => p.kind === 'image')) {
        if (pages.every((p) => p.kind === 'blank'))
          throw new PdfImportError('PDF 没有可读取的文字或图片，可能为空白文档。');
        throw new PdfImportError(unreadablePdfMessage(pages.map((p) => p.status)));
      }
      const warnings = [
        '文字层和 OCR 都可能受版式影响，请与原 PDF 核对。OCR 不是经过验证的原文答案。',
      ];
      for (const page of pages)
        for (const warning of page.warnings) warnings.push(`第 ${page.number} 页：${warning}`);
      const organized = extractNumbered(content, pages, id, filename);
      return {
        candidates: organized.candidates,
        coverage: organized.coverage,
        pdfReport: report,
        previews,
        document: {
          id,
          filename,
          ...(organized.title ? { title: organized.title } : {}),
          fileType: 'pdf',
          sourceHash: hash,
          byteLength: bytes.length,
          extractedContent: content,
          pages,
          sections: organized.sections,
          extractionStatus: pages.some((p) => p.status !== 'ready') ? 'partial' : 'needs_review',
          warnings,
          parserVersion: 'PDF.js-5.5.207-legacy-structured-ocr-3',
        },
      };
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          timedOut = true;
          reject(
            new PdfImportError(
              options.ocr
                ? '本地 OCR 超时，请缩小页数后重试。'
                : 'PDF 提取超时，请拆分文件后重试。',
            ),
          );
          cancel();
        },
        options.ocr ? 300_000 : 45_000,
      );
    });
    return await Promise.race([work(), timeout, abortPromise]);
  } catch (cause) {
    if (cause instanceof PdfImportError) throw cause;
    if (controller.signal.aborted && !timedOut)
      throw new DOMException('已取消本次解析', 'AbortError');
    if (cause instanceof Error && cause.name === 'PasswordException')
      throw new PdfImportError('PDF 已加密或需要密码，请在原软件中导出可读取的副本。');
    throw new PdfImportError('PDF 文字提取失败，文件可能损坏或格式不受支持。请保留原文件后重试。');
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    await ocr?.close().catch(() => undefined);
    await task.destroy().catch(() => undefined);
  }
}
