import { expect, it } from 'vitest';
import { pageText, textQuality } from './pdf-layout';
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
});
