/* global fetch, AbortSignal */
import http from 'node:http';
import process from 'node:process';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
const LEGACY = '/tmp/recalllab-v05-local';
const catalog = [
  {
    id: 'qwen15',
    name: 'Qwen2.5 1.5B CPU',
    model: 'qwen2.5-1.5b-instruct',
    file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    port: 8089,
    sha: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
  },
];
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.gz': 'application/gzip',
};
async function exists(p) {
  return fs.stat(p).then(
    (s) => s.isFile(),
    () => false,
  );
}
export async function createLocalServer({
  root,
  port = 5173,
  registry,
  legacy = LEGACY,
  spawnModel = spawn,
} = {}) {
  const secret = randomUUID(),
    children = new Map();
  let origin = '',
    closed = false;
  const cache = path.join(root, '.local-ai');
  async function models() {
    if (registry) return typeof registry === 'function' ? registry() : registry;
    return Promise.all(
      catalog.map(async (m) => {
        const durable = path.join(cache, 'installed', 'models', m.file),
          installed = await exists(durable);
        return {
          ...m,
          binary: installed
            ? path.join(cache, 'installed', 'runtime', 'llama-server')
            : path.join(legacy, 'build', 'bin', 'llama-server'),
          filePath: installed ? durable : path.join(legacy, m.file),
          temporary: !installed,
        };
      }),
    );
  }
  async function health(m) {
    try {
      const r = await fetch(`http://127.0.0.1:${m.port}/v1/models`, {
        signal: AbortSignal.timeout(1500),
      });
      const j = await r.json();
      return r.ok && j.data?.some((x) => x.id === m.model);
    } catch {
      return false;
    }
  }
  async function adoption() {
    const m = (await models())[0];
    if (!m?.temporary || !(await exists(m.filePath)) || !(await exists(m.binary)))
      return { available: false, bytes: 0, free: 0 };
    const dir = path.dirname(m.binary),
      files = (await fs.readdir(dir)).filter((n) =>
        /^(llama-server|lib[^/]+\.(so(\.\d+)*|dylib)|[^/]+\.dll)$/.test(n),
      );
    let bytes = (await fs.stat(m.filePath)).size;
    for (const n of files) bytes += (await fs.stat(path.join(dir, n))).size;
    const disk = await fs.statfs(root);
    return { available: true, bytes, free: disk.bavail * disk.bsize, files, m };
  }
  async function snapshot() {
    const list = await models();
    const adoptionPlan = await adoption();
    return {
      token: secret,
      models: await Promise.all(
        list.map(async (m) => ({
          id: m.id,
          name: m.name,
          model: m.model,
          endpoint: `http://127.0.0.1:${m.port}/v1`,
          installed: (await exists(m.binary)) && (await exists(m.filePath)),
          temporary: m.temporary,
          bytes: await fs.stat(m.filePath).then(
            (s) => s.size,
            () => 0,
          ),
          owned: children.has(m.id),
          running: await health(m),
        })),
      ),
      adoption: {
        available: adoptionPlan.available,
        bytes: adoptionPlan.bytes,
        free: adoptionPlan.free,
      },
    };
  }
  const response = (res, code, data) => {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.end(JSON.stringify(data));
  };
  let adopting = false;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) {
        response(res, 403, { message: '拒绝非本机地址' });
        return;
      }
      const url = new URL(req.url, origin);
      if (url.pathname === '/local-ai/status' && req.method === 'GET') {
        response(res, 200, await snapshot());
        return;
      }
      if (url.pathname.startsWith('/local-ai/')) {
        if (
          req.method !== 'POST' ||
          req.headers.origin !== origin ||
          req.headers['x-recalllab-token'] !== secret ||
          req.headers['content-type'] !== 'application/json'
        ) {
          response(res, 403, { message: '请从本机 RecallLab 页面明确授权' });
          return;
        }
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 2048) {
            response(res, 413, { message: '请求过大' });
            return;
          }
        }
        const input = JSON.parse(raw);
        if (input.consent !== true) {
          response(res, 403, { message: '本次操作需要主动同意' });
          return;
        }
        if (url.pathname === '/local-ai/adopt') {
          if (adopting) {
            response(res, 409, { message: '正在保存，请稍候' });
            return;
          }
          const plan = await adoption();
          if (!plan.available || plan.free < plan.bytes + 2 * 1024 ** 3) {
            response(res, 409, { message: '没有可保存的已有运行环境，或保存后不足 2 GB 余量' });
            return;
          }
          adopting = true;
          const stage = path.join(cache, `stage-${randomUUID()}`);
          try {
            await fs.mkdir(path.join(stage, 'runtime'), { recursive: true });
            for (const file of plan.files)
              await fs.copyFile(
                path.join(path.dirname(plan.m.binary), file),
                path.join(stage, 'runtime', file),
              );
            await fs.chmod(path.join(stage, 'runtime', 'llama-server'), 0o700);
            await fs.mkdir(path.join(stage, 'models'));
            const copy = path.join(stage, 'models', plan.m.file);
            await fs.copyFile(plan.m.filePath, copy);
            const hash = createHash('sha256');
            for await (const bytes of createReadStream(copy)) hash.update(bytes);
            if (hash.digest('hex') !== plan.m.sha) throw Error('model-integrity');
            await fs.rename(stage, path.join(cache, 'installed'));
            response(res, 200, {
              message: '已有运行环境已保存到持久目录，没有联网下载。可按需启动。',
            });
          } catch {
            await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
            response(res, 500, { message: '保存失败，原运行环境未改动；请检查空间并重试。' });
          } finally {
            adopting = false;
          }
          return;
        }
        const m = (await models()).find((x) => x.id === input.id);
        if (!m) {
          response(res, 400, { message: '未知模型；不能执行自定义命令或文件路径' });
          return;
        }
        if (url.pathname === '/local-ai/start') {
          if (await health(m)) {
            response(res, 200, { message: '该模型已在运行，可直接使用。' });
            return;
          }
          if (children.has(m.id)) {
            response(res, 200, { message: '模型正在加载，请稍后重新检测。' });
            return;
          }
          if (!(await exists(m.binary)) || !(await exists(m.filePath))) {
            response(res, 409, { message: '缺少运行器或模型；没有自动下载或安装。' });
            return;
          }
          const child = spawnModel(
            m.binary,
            [
              '-m',
              m.filePath,
              '--alias',
              m.model,
              '--host',
              '127.0.0.1',
              '--port',
              String(m.port),
              '-c',
              '8192',
              '-t',
              '2',
              '-ngl',
              '0',
              '--cors-origins',
              origin,
              '--no-cors-credentials',
              '--no-webui',
              '--log-disable',
            ],
            {
              stdio: 'ignore',
              shell: false,
              env: {
                ...process.env,
                LD_LIBRARY_PATH: path.dirname(m.binary),
                ...(process.platform === 'darwin'
                  ? { DYLD_LIBRARY_PATH: path.dirname(m.binary) }
                  : {}),
              },
            },
          );
          children.set(m.id, child);
          child.once('exit', () => children.delete(m.id));
          child.once('error', () => children.delete(m.id));
          response(res, 202, { message: '已按本次授权开始加载；请稍后重新检测。' });
          return;
        }
        if (url.pathname === '/local-ai/stop') {
          const child = children.get(m.id);
          if (!child) {
            response(res, 409, { message: '本启动器未启动该模型，不停止其他程序。' });
            return;
          }
          child.kill('SIGTERM');
          response(res, 200, { message: '正在停止本次启动的模型。' });
          return;
        }
        response(res, 404, { message: '不支持此操作' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        response(res, 405, { message: '不支持的方法' });
        return;
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const dist = path.join(root, 'dist'),
        target = path.resolve(dist, `.${rel}`);
      if (!target.startsWith(dist + path.sep)) {
        response(res, 403, { message: '不支持此路径' });
        return;
      }
      const real = await fs.realpath(target).catch(() => null);
      if (real && !real.startsWith(dist + path.sep)) {
        response(res, 403, { message: '不支持此路径' });
        return;
      }
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile()) {
        response(res, 404, { message: '页面未构建或文件不存在，请使用项目启动入口。' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control':
          path.extname(target) === '.html' || target.endsWith('service-worker.js')
            ? 'no-cache'
            : 'public, max-age=3600',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(target).pipe(res);
    } catch {
      if (!res.headersSent)
        response(res, 500, { message: '本机操作未完成，没有读取其他文件或修改学习数据。' });
      else res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  async function close() {
    if (closed) return;
    closed = true;
    for (const child of children.values()) child.kill('SIGTERM');
    children.clear();
    await new Promise((r) => server.close(r));
  }
  return { origin, server, close };
}
