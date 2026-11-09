import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { root } from './cli-helpers.ts';

test('init with a folder at tagreeve/config.yml exits 2 and does not skip the config', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tagreeve-init-folder-'));
  try {
    await mkdir(join(cwd, 'tagreeve/config.yml'), { recursive: true });
    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      execFile(process.execPath, [join(root, 'dist/cli.js'), 'init', '--json'], { cwd }, (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code;
        resolve({ stdout, stderr, code: error ? (typeof code === 'number' ? code : 1) : 0 });
      });
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a file');
    const items = (JSON.parse(result.stdout) as { items: Array<{ path: string; action: string }> }).items;
    expect(items.some((i) => i.action === 'skipped')).toBe(false);
    expect(items.some((i) => i.path === 'tagreeve/config.yml')).toBe(false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
