import { createWorker, OEM, type Worker } from 'tesseract.js';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

export function abortError() {
  return new DOMException('已取消本次解析', 'AbortError');
}
export async function createLocalOcr(signal: AbortSignal, progress: (fraction: number) => void) {
  const base = `${import.meta.env.BASE_URL}ocr-assets/7/`;
  const absolute = (path: string) => new URL(base + path, location.href).href;
  let worker: Worker | undefined;
  const stop = () => {
    if (worker) void worker.terminate();
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) throw abortError();
  const pending = createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
    workerPath: absolute('worker.min.js'),
    corePath: absolute('core'),
    langPath: absolute('lang'),
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'write',
    logger: (m) => {
      if (!signal.aborted) progress(m.progress);
    },
    // Exceptions are handled by the job promise; never surface OCR internals or source text.
    errorHandler: () => undefined,
  });
  pending
    .then((w) => {
      worker = w;
      if (signal.aborted) void w.terminate();
    })
    .catch(() => undefined);
  try {
    worker = await pending;
    if (signal.aborted) throw abortError();
  } catch {
    signal.removeEventListener('abort', stop);
    throw signal.aborted
      ? abortError()
      : new Error('本地 OCR 资源未能加载，请重试。资料没有上传。');
  }
  return {
    async recognize(page: PDFPageProxy) {
      if (signal.aborted) throw abortError();
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, Math.sqrt(4_000_000 / (original.width * original.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建页面图像，请换用支持画布的浏览器。');
      const render = page.render({ canvas, canvasContext: context, viewport, background: 'white' });
      const cancelRender = () => render.cancel();
      signal.addEventListener('abort', cancelRender, { once: true });
      try {
        await render.promise;
        if (signal.aborted) throw abortError();
        const preview = canvas.toDataURL('image/png');
        const result = await worker!.recognize(canvas);
        if (signal.aborted) throw abortError();
        return { text: result.data.text.trim(), confidence: result.data.confidence, preview };
      } finally {
        signal.removeEventListener('abort', cancelRender);
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    async close() {
      signal.removeEventListener('abort', stop);
      await worker?.terminate();
    },
  };
}
