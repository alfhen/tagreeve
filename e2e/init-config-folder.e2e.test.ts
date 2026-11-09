import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { root } from './cli-helpers.ts';

const run = (args: string[], cwd: string) =>
  new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    execFile(args[0]!, args.slice(1), { cwd }, (error, stdout, stderr) => {
      const code = (error as { code?: unknown } | null)?.code;
      resolve({ stdout, stderr, code: error ? (typeof code === 'number' ? code : 1) : 0 });
    });
  });

const exists = (path: string) => stat(path).then(() => true, () => false);

test('init with a folder at tagreeve/config.yml exits 2 and creates nothing', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tagreeve-init-folder-'));
  try {
    expect((await run(['git', 'init', '-q'], cwd)).code).toBe(0);
    expect(await exists(join(cwd, 'tagreeve/scenarios'))).toBe(false);
    expect(await exists(join(cwd, 'tagreeve/baselines'))).toBe(false);
    await mkdir(join(cwd, 'tagreeve/config.yml'), { recursive: true });
    const result = await run([process.execPath, join(root, 'dist/cli.js'), 'init', '--json'], cwd);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('tagreeve/config.yml is not a file');
    expect(result.stdout.trim()).toBe('{"items":[]}');
    expect(await exists(join(cwd, 'tagreeve/scenarios'))).toBe(false);
    expect(await exists(join(cwd, 'tagreeve/baselines'))).toBe(false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
