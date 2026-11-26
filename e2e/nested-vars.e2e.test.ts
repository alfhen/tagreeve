import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { outDir, root, runCli, site } from './cli-helpers.ts';

const temp: string[] = [];

afterAll(async () => {
  await Promise.all(temp.map((dir) => rm(dir, { recursive: true, force: true })));
});

test('a start whose variable holds another variable opens the filled page', async () => {
  const parent = join(root, 'test-results');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'nested-vars-'));
  temp.push(dir);
  const file = join(dir, 's.yml');
  const source = 'start: "{path}"\nvars:\n  path: /plain/{x}\n  x: product\noptions:\n  allowUnknownDestination: true\nsteps:\n  - wait: 1s\nexpect:\n  must: []\n  mustNot: []\n';
  await writeFile(file, source);
  expect(source).toContain('{x}');
  const r = await runCli(['run', file, '--site', site.url, '--out', outDir, '--json']);
  const urls = r.records!.requests.map((q) => new URL(q.url)).filter((u) => u.origin === site.url);
  expect(urls.some((u) => u.pathname === '/plain/product')).toBe(true);
  expect(urls.some((u) => u.href.includes('%7B'))).toBe(false);
}, 150_000);
