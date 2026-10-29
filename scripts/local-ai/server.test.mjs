// @vitest-environment node
import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createLocalServer } from './server.mjs';
/* global fetch */
it('never starts at startup, requires origin/token/explicit consent and only stops owned children', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recalllab-launcher-test-'));
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist', 'index.html'), 'fictional app');
  await fs.writeFile(path.join(root, 'model'), 'fictional model');
  await fs.writeFile(path.join(root, 'bin'), 'fictional runtime');
  let spawned = 0,
    killed = 0;
  const local = await createLocalServer({
    root,
    port: 0,
    registry: [
      {
        id: 'test',
        name: 'fake runtime',
        model: 'fictional',
        port: 1,
        binary: path.join(root, 'bin'),
        filePath: path.join(root, 'model'),
        temporary: false,
      },
    ],
    spawnModel: (binary, args, options) => {
      expect(binary).toBe(path.join(root, 'bin'));
      expect(args).toContain('--no-webui');
      expect(options.shell).toBe(false);
      expect(options.env.LD_LIBRARY_PATH).toBe(root);
      spawned++;
      const child = new EventEmitter();
      child.kill = () => {
        killed++;
        child.emit('exit');
      };
      return child;
    },
  });
  try {
    const status = await (await fetch(local.origin + '/local-ai/status')).json();
    expect(spawned).toBe(0);
    expect(status.models[0].installed).toBe(true);
    expect(JSON.stringify(status)).not.toContain(root);
    const post = (p, data, origin = local.origin, token = status.token) =>
      fetch(local.origin + '/local-ai/' + p, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', 'X-RecallLab-Token': token },
        body: JSON.stringify(data),
      });
    expect((await post('start', { id: 'test', consent: true }, 'https://evil.test')).status).toBe(
      403,
    );
    expect((await post('start', { id: 'test', consent: false })).status).toBe(403);
    expect((await post('start', { id: 'test', consent: true }, local.origin, 'wrong')).status).toBe(
      403,
    );
    expect((await post('start', { id: '/etc/passwd', consent: true })).status).toBe(400);
    expect(spawned).toBe(0);
    expect((await post('start', { id: 'test', consent: true })).status).toBe(202);
    expect(spawned).toBe(1);
    expect((await post('stop', { id: 'test', consent: true })).status).toBe(200);
    expect(killed).toBe(1);
    expect((await post('stop', { id: 'test', consent: true })).status).toBe(409);
    const { get } = await import('node:http');
    const statusCode = await new Promise((resolve) => {
      get(local.origin + '/local-ai/status', { headers: { Host: 'evil.test' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
    });
    expect(statusCode).toBe(403);
    expect(await (await fetch(local.origin)).text()).toBe('fictional app');
  } finally {
    await local.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('copies only existing fixtures after consent, verifies their checksum and installs atomically', async () => {
  const { createHash } = await import('node:crypto');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recalllab-adopt-test-'));
  const src = path.join(root, 'source');
  await fs.mkdir(src);
  await fs.writeFile(path.join(src, 'llama-server'), 'fake runtime');
  await fs.writeFile(path.join(src, 'fake.gguf'), 'fake model');
  const hash = createHash('sha256').update('fake model').digest('hex');
  const model = {
    id: 'test',
    name: 'fake model',
    file: 'fake.gguf',
    model: 'fake',
    port: 1,
    sha: hash,
    temporary: true,
    binary: path.join(src, 'llama-server'),
    filePath: path.join(src, 'fake.gguf'),
  };
  const local = await createLocalServer({ root, port: 0, registry: [model] });
  try {
    const status = await (await fetch(local.origin + '/local-ai/status')).json();
    const post = (consent) =>
      fetch(local.origin + '/local-ai/adopt', {
        method: 'POST',
        headers: {
          Origin: local.origin,
          'Content-Type': 'application/json',
          'X-RecallLab-Token': status.token,
        },
        body: JSON.stringify({ consent }),
      });
    expect((await post(false)).status).toBe(403);
    expect((await post(true)).status).toBe(200);
    expect(
      await fs.readFile(path.join(root, '.local-ai', 'installed', 'models', 'fake.gguf'), 'utf8'),
    ).toBe('fake model');
    expect(await fs.readFile(model.filePath, 'utf8')).toBe('fake model');
  } finally {
    await local.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('reports a missing model link without starting or downloading a replacement', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recalllab-missing-model-'));
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist', 'index.html'), 'fictional app');
  await fs.writeFile(path.join(root, 'bin'), 'fictional runtime');
  await fs.symlink(path.join(root, 'missing-target'), path.join(root, 'model-link'));
  let started = false;
  const local = await createLocalServer({
    root,
    port: 0,
    registry: [
      {
        id: 'missing',
        name: 'missing fixture',
        model: 'fixture',
        port: 1,
        binary: path.join(root, 'bin'),
        filePath: path.join(root, 'model-link'),
        temporary: false,
      },
    ],
    spawnModel: () => {
      started = true;
      throw Error('must not start');
    },
  });
  try {
    const status = await (await fetch(local.origin + '/local-ai/status')).json();
    expect(status.models[0]).toMatchObject({ installed: false, running: false, bytes: 0 });
    const response = await fetch(local.origin + '/local-ai/start', {
      method: 'POST',
      headers: {
        Origin: local.origin,
        'Content-Type': 'application/json',
        'X-RecallLab-Token': status.token,
      },
      body: JSON.stringify({ id: 'missing', consent: true }),
    });
    expect(response.status).toBe(409);
    expect(started).toBe(false);
    expect(JSON.stringify(status)).not.toContain(root);
  } finally {
    await local.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
