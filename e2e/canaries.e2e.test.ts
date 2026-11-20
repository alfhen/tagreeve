import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { readRun, type Request, type RunRecords } from '../packages/core/src/index.ts';
import { outDir, root, run, runCli, runText, scenario, site } from './cli-helpers.ts';

const NAMES = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'];
const LINE = 'Canaries: gclid, gbraid, wbraid, fbclid, msclkid, ttclid on the start URL; identity email and phone';
const temp: string[] = [];

afterAll(async () => {
  await Promise.all(temp.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const parent = join(root, 'test-results');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, prefix));
  temp.push(dir);
  return dir;
}

const startRequest = (records: RunRecords, path = '/plain/product'): Request =>
  records.requests.find((q) => new URL(q.url).origin === site.url && new URL(q.url).pathname === path)!;

const expected = (seed: number, cell: string) => NAMES.map((name) => ({ source: 'urlParam', name, value: `TEST-${name.toUpperCase()}-${seed}-${cell}-0001` }));

test('the start URL carries the six canaries, built from the seed and RUN, and the record holds them', async () => {
  const r = await run('canaries');
  expect(r.code).not.toBe(2);
  const { run: meta } = r.records!;
  expect(meta.recordSchemaVersion).toBe(5);
  const seed = meta.identitySeed!;
  expect(seed).toBe(7);
  const params = new URL(startRequest(r.records!).url).searchParams;
  for (const name of NAMES) expect(params.get(name)).toBe(`TEST-${name.toUpperCase()}-${seed}-RUN-0001`);
  expect(meta.canaries).toEqual(expected(seed, 'RUN'));
  expect(meta.canaries!.every((c) => c.value.startsWith('TEST-'))).toBe(true);
  expect(JSON.stringify(meta.canaries)).not.toContain(meta.identity!.email);
}, 150_000);

test('a start URL with a similar name keeps it and gets the canaries too', async () => {
  const dir = await tempDir('canaries-similar-');
  const file = join(dir, 's.yml');
  await writeFile(file, (await readFile(scenario('canaries'), 'utf8')).replace('start: /plain/product', 'start: /plain/product?gclidx=1'));
  const r = await runCli(['run', file, '--site', site.url, '--out', outDir, '--json']);
  expect(r.code).not.toBe(2);
  const params = new URL(startRequest(r.records!).url).searchParams;
  expect(params.get('gclidx')).toBe('1');
  for (const name of NAMES) expect(params.has(name)).toBe(true);
  expect(r.records!.run.canaries).toBeDefined();
}, 150_000);

test('the text summary has the Canaries line and --json has the names', async () => {
  const text = await runText('canaries');
  expect(text.code).not.toBe(2);
  expect(text.stdout.split('\n')).toContain(LINE);
  const json = await run('canaries');
  expect((JSON.parse(json.stdout) as { canaries: string[] }).canaries).toEqual([...NAMES, 'email', 'phone']);
}, 150_000);

test('a suite --consent matrix plants each cell its own canaries', async () => {
  const dir = await tempDir('canaries-suite-');
  const suite = join(dir, 'suite');
  const out = join(dir, 'out');
  await mkdir(suite);
  await writeFile(join(suite, 'canaries.yml'), await readFile(scenario('canaries'), 'utf8'));
  await runCli(['suite', suite, '--consent', 'accept,reject', '--site', site.url, '--out', out]);
  const [id] = await readdir(out);
  const files = (await readdir(join(out, id!))).filter((f) => f.endsWith('.jsonl'));
  for (const state of ['accept', 'reject']) {
    const file = files.find((f) => f.includes(`.${state}.`));
    expect(file, state).toBeDefined();
    const records = await readRun(join(out, id!, file!));
    const seed = records.run.identitySeed!;
    expect(records.run.canaries).toEqual(expected(seed, state.toUpperCase()));
    expect(records.run.canaries![0]!.value).toBe(`TEST-GCLID-${seed}-${state.toUpperCase()}-0001`);
    const params = new URL(startRequest(records).url).searchParams;
    for (const c of records.run.canaries!) expect(params.get(c.name)).toBe(c.value);
  }
}, 300_000);

test('without the option a start URL that holds gclid runs as before and nothing names canaries', async () => {
  const dir = await tempDir('canaries-off-');
  const file = join(dir, 's.yml');
  const source = (await readFile(scenario('canaries'), 'utf8')).replace('start: /plain/product', 'start: /plain/product?gclid=pw-own-0001').replace('  canaries: true\n', '');
  expect(source).not.toContain('canaries');
  await writeFile(file, source);
  const json = await runCli(['run', file, '--site', site.url, '--out', outDir, '--json']);
  const text = await runCli(['run', file, '--site', site.url, '--out', outDir]);
  expect(json.code).not.toBe(2);
  const params = new URL(startRequest(json.records!).url).searchParams;
  expect(params.get('gclid')).toBe('pw-own-0001');
  for (const name of NAMES.slice(1)) expect(params.has(name)).toBe(false);
  const path = (JSON.parse(json.stdout) as { path: string }).path;
  const lines = (await readFile(path, 'utf8')).split('\n');
  expect(lines.filter((l) => /TEST-[A-Z]+-\d+-[A-Z]+-0001/.test(l))).toEqual([]);
  expect(json.records!.run).not.toHaveProperty('canaries');
  expect(text.stdout).not.toContain('Canaries:');
  expect(JSON.parse(json.stdout)).not.toHaveProperty('canaries');
}, 150_000);

test('no output prints a canary value or the identity email or phone', async () => {
  const json = await run('canaries');
  const text = await runText('canaries');
  const { run: meta, requests } = json.records!;
  const start = startRequest(json.records!);
  for (const c of meta.canaries!) expect(start.url).toContain(c.value);
  expect(meta.identity!.email).toContain('@');
  expect(meta.identity!.phone).toMatch(/^\+\d+$/);
  expect(requests.length).toBeGreaterThan(0);
  const needles = [...meta.canaries!.map((c) => c.value), meta.identity!.email, meta.identity!.phone];
  needles.push(...needles.map(encodeURIComponent));
  for (const output of [json.stdout, json.stderr, text.stdout, text.stderr]) {
    for (const needle of needles) expect(output).not.toContain(needle);
  }
}, 300_000);
