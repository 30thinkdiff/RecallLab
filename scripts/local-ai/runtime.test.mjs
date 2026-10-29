// @vitest-environment node
import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
it('validates an existing supported runtime before building and never needs a system installation', () => {
  const result = spawnSync('bash', ['打开RecallLab.sh', '--check-runtime'], {
    cwd: process.cwd(),
    env: { ...process.env, RECALLLAB_NODE_BIN: process.execPath },
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(process.version);
  expect(result.stderr).toBe('');
});
