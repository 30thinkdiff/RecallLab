import { webcrypto } from 'node:crypto';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// jsdom does not implement the native dialog methods; E2E uses real Chromium dialogs.
if (typeof HTMLDialogElement !== 'undefined') {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });

  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
