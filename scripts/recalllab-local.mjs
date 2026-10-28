import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { createLocalServer } from './local-ai/server.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const local = await createLocalServer({ root, port: Number(process.env.RECALLLAB_PORT || 5173) });
  console.log(
    `RecallLab 已打开：${local.origin}。没有启动模型；只在网页明确授权后按需启动。关闭此窗口结束启动器。`,
  );
  if (process.argv.includes('--open'))
    spawn(
      process.platform === 'win32'
        ? 'explorer'
        : process.platform === 'darwin'
          ? 'open'
          : 'xdg-open',
      [local.origin],
      { stdio: 'ignore' },
    ).on('error', () => {});
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.once(signal, () => {
      void local.close().then(() => process.exit(0));
    });
} catch (error) {
  console.error(
    error.code === 'EADDRINUSE'
      ? 'RecallLab 端口已被占用，请继续使用现有窗口，或先关闭旧启动器。'
      : '启动失败，请保留原数据。',
  );
  process.exitCode = 1;
}
