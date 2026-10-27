import { expect, it } from 'vitest';
import { pageText, textQuality, unreadablePdfMessage , reconcileOcrText } from './pdf-layout';
it('keeps extraction order, line changes and word gaps without inventing content', () => {
  expect(
    pageText([
      { str: 'Hello', transform: [1, 0, 0, 1, 0, 100], width: 20, height: 12, hasEOL: false },
      { str: 'world', transform: [1, 0, 0, 1, 24, 100], width: 20, height: 12, hasEOL: false },
      { str: 'Next line', transform: [1, 0, 0, 1, 0, 80], width: 30, height: 12, hasEOL: true },
    ]),
  ).toBe('Hello world\nNext line');
});
it('flags empty and replacement/control characters instead of silently accepting broken extraction', () => {
  expect(textQuality(' \n')).toBe('empty');
  expect(textQuality('文字�缺失')).toBe('suspect');
  expect(textQuality('异常\0内容')).toBe('suspect');
  expect(textQuality('有效文字🙂\n下一行')).toBe('ready');
  expect(textQuality('缺少映射\uE123')).toBe('suspect');
  expect(textQuality('破损代理\uD800')).toBe('suspect');
});

it('does not misdiagnose decoder failures as scanned documents', () => {
  expect(unreadablePdfMessage(['failed', 'failed'])).toContain('解析失败');
  expect(unreadablePdfMessage(['failed', 'empty'])).toContain('1/2');
  expect(unreadablePdfMessage(['empty', 'empty'])).toContain('不能仅凭');
});

it('distinguishes text, mixed, image-only, blank and decoder errors', async () => {
  const { classifyPdfPage } = await import('./pdf-layout');
  expect(classifyPdfPage('ready', false)).toBe('text');
  expect(classifyPdfPage('ready', true)).toBe('mixed');
  expect(classifyPdfPage('empty', true)).toBe('image');
  expect(classifyPdfPage('empty', false)).toBe('blank');
  expect(classifyPdfPage('failed', true)).toBe('failed');
});

it('keeps native text usable if OCR finds no text or is unavailable', () => {
  const native = 'Fictional native footer, still usable.';
  expect(reconcileOcrText(native, '')).toEqual({
    text: native,
    hasOcrText: false,
    preservedNativeText: true,
  });
  expect(reconcileOcrText(native, '   ')).toMatchObject({
    text: native,
    preservedNativeText: true,
  });
  expect(reconcileOcrText('', '')).toEqual({
    text: '',
    hasOcrText: false,
    preservedNativeText: false,
  });
  expect(reconcileOcrText(native, 'OCR words')).toEqual({
    text: 'OCR words',
    hasOcrText: true,
    preservedNativeText: false,
  });
});
