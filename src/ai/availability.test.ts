import { it, expect, vi } from 'vitest';
import { checkModel } from './availability';
import type { ProviderConfig } from './protocol';
const config: ProviderConfig = {
  kind: 'compatible',
  endpoint: 'http://127.0.0.1:8089/v1',
  model: 'fictional',
  apiKey: '',
  jsonMode: 'schema',
};
it('checks installed models locally without sending source material or persisting credentials', async () => {
  const fn = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ data: [{ id: 'fictional' }] })),
  );
  expect((await checkModel(config, new AbortController().signal, fn)).status).toBe('ready');
  expect(fn.mock.calls[0]?.[0]).toContain('/models');
  const missing = await checkModel({ ...config, model: 'other' }, new AbortController().signal, fn);
  expect(missing.status).toBe('missing-model');
  const external = vi.fn();
  expect(
    (
      await checkModel(
        { ...config, endpoint: 'https://example.test/v1' },
        new AbortController().signal,
        external,
      )
    ).status,
  ).toBe('unsupported');
  expect(external).not.toHaveBeenCalled();
});
it('supports Ollama tags, separates mock/authentication/service failures and handles invalid addresses', async () => {
  const signal = new AbortController().signal;
  expect(
    (
      await checkModel(
        { ...config, kind: 'ollama', model: 'fictional' },
        signal,
        async () =>
          new Response(JSON.stringify({ models: [{ name: 'fictional:latest', size: 100 }] })),
      )
    ).status,
  ).toBe('ready');
  expect((await checkModel({ ...config, kind: 'mock' }, signal)).status).toBe('mock');
  expect(
    (await checkModel(config, signal, async () => new Response('', { status: 401 }))).status,
  ).toBe('authentication');
  expect(
    (
      await checkModel(config, signal, async () => {
        throw Error('private service error');
      })
    ).message,
  ).not.toContain('private');
  expect((await checkModel({ ...config, endpoint: '' }, signal)).status).toBe('unsupported');
});
