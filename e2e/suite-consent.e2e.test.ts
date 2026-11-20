import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from '../fixtures/site/src/index.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'dist/cli.js');
const suiteDir = join(root, 'e2e/suites/consent');
const STATES = ['accept', 'reject', 'none', 'withdraw'] as const;
const OWN_RULES = 2;

interface Manifest {
  suiteSchemaVersion: number;
  consent: string[];
  cells: { scenario: string; labels: Record<string, string>; record: string; rulesSkipped?: number }[];
}

interface Line {
  type: string;
  label?: string;
  expectation?: string;
  consentCell?: string;
  recordSchemaVersion?: number;
}

let site: FixtureSite;
let outDir: string;
let dir: string;
let manifest: Manifest;
let stdout: string;
let records: Record<string, Line[]>;

function cliRun(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, out, err) => {
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout: out, stderr: err });
    });
  });
}

beforeAll(async () => {
  site = await startFixtureSite();
  const parent = join(root, 'test-results');
  await mkdir(parent, { recursive: true });
  outDir = await mkdtemp(join(parent, 'suite-consent-'));
  const r = await cliRun(['suite', suiteDir, '--consent', STATES.join(','), '--site', site.url, '--out', outDir]);
  stdout = r.stdout;
  const [id] = await readdir(outDir);
  dir = join(outDir, id!);
  manifest = JSON.parse(await readFile(join(dir, 'suite.json'), 'utf8')) as Manifest;
  records = {};
  for (const state of STATES) {
    const text = await readFile(join(dir, `plain-journey.${state}.published.jsonl`), 'utf8');
    records[state] = text.trim().split('\n').map((l) => JSON.parse(l) as Line);
  }
}, 180_000);

afterAll(async () => {
  await site?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

const labels = (state: string) => records[state]!.filter((l) => l.type === 'consentEpoch').map((l) => l.label);
const results = (state: string) => records[state]!.filter((l) => l.type === 'result').map((l) => l.expectation!);

test('four cells, four records, and a table column for each state', () => {
  expect(manifest.suiteSchemaVersion).toBe(3);
  expect(manifest.consent).toEqual([...STATES]);
  expect(manifest.cells.map((c) => [c.scenario, c.labels.consent])).toEqual(STATES.map((s) => ['plain-journey', s]));
  for (const state of STATES) {
    const run = records[state]![0]!;
    expect(run.consentCell).toBe(state);
    expect(run.recordSchemaVersion).toBe(5);
  }
  expect(stdout.split('\n')[0]!.split(/\s+/)).toEqual(['scenario', ...STATES]);
});

test('the folder holds the four records', async () => {
  expect((await readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort()).toEqual(STATES.map((s) => `plain-journey.${s}.published.jsonl`).sort());
});

test('each cell plays its own consent state', () => {
  expect(labels('accept')).toContain('granted');
  expect(labels('reject')).toContain('denied');
  expect(labels('reject')).not.toContain('granted');
  expect(labels('none')).toContain('undecided');
  expect(labels('none')).not.toContain('denied');
  expect(labels('none')).not.toContain('granted');
  expect(labels('withdraw')).toContain('withdrawn');
});

test('the scenario rules run in the accept cell only', () => {
  const own = results('accept').filter((e) => e.startsWith('must:') || e.startsWith('mustNot:'));
  expect(own).toHaveLength(OWN_RULES);
  expect(manifest.cells[0]!.rulesSkipped).toBeUndefined();
  for (const [i, state] of STATES.entries()) {
    if (state === 'accept') continue;
    const found = results(state);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((e) => e.startsWith('builtin: '))).toBe(true);
    expect(manifest.cells[i]!.rulesSkipped).toBe(OWN_RULES);
  }
});

test('report refuses a consent suite and writes no file', async () => {
  const html = join(outDir, 'consent.html');
  const r = await cliRun(['report', dir, '--html', html]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain('consent suites are shown from 0.8.0-rc.1');
  await expect(access(html)).rejects.toThrow();
});

test('a bad --consent value exits 2 and runs nothing', async () => {
  const r = await cliRun(['suite', suiteDir, '--consent', 'maybe', '--site', site.url, '--out', join(outDir, 'bad')]);
  expect(r.code).toBe(2);
  await expect(access(join(outDir, 'bad'))).rejects.toThrow();
});
