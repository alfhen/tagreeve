import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { readRun, type RunRecords } from '../packages/core/src/index.ts';
import type { ConsentMatrixEntry } from '../packages/cli/src/suite.ts';
import { epochForHit } from '../packages/expect/src/index.ts';
import { startFixtureSite, type FixtureSite } from '../fixtures/site/src/index.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'dist/cli.js');
const STATES = ['accept', 'reject', 'none', 'withdraw'] as const;
type State = (typeof STATES)[number];
const CLIENT_ID = '3333333333.4444444444';
const MEASUREMENT_ID = 'G-PWTEST0001';
const VENDORS = ['ga4', 'google-ads'];

let site: FixtureSite;
let parent: string;
let outDir: string;
let dir: string;
let stdout: string;
let manifestText: string;
let manifest: { consentMatrix: ConsentMatrixEntry[] };
const runs = {} as Record<State, RunRecords>;
const texts = {} as Record<State, string>;

function cliRun(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, out, err) => {
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout: out, stderr: err });
    });
  });
}

beforeAll(async () => {
  site = await startFixtureSite();
  parent = join(root, 'test-results');
  await mkdir(parent, { recursive: true });
  outDir = await mkdtemp(join(parent, 'suite-consent-table-'));
  const scenarios = join(outDir, 'scenarios');
  await mkdir(scenarios);
  const journey = await readFile(join(root, 'e2e/scenarios/plain-gtm-journey.yml'), 'utf8');
  await writeFile(join(scenarios, 'plain-gtm-journey.yml'), journey.replace('options: { seed: 1 }', 'options: { seed: 1, withdrawWith: "#pw-cookie-settings" }'));
  const r = await cliRun(['suite', scenarios, '--consent', STATES.join(','), '--site', site.url, '--out', join(outDir, 'runs')]);
  stdout = r.stdout;
  const [id] = await readdir(join(outDir, 'runs'));
  dir = join(outDir, 'runs', id!);
  manifestText = await readFile(join(dir, 'suite.json'), 'utf8');
  manifest = JSON.parse(manifestText) as typeof manifest;
  for (const state of STATES) {
    const file = join(dir, `plain-gtm-journey.${state}.published.jsonl`);
    texts[state] = await readFile(file, 'utf8');
    runs[state] = await readRun(file);
  }
}, 240_000);

afterAll(async () => {
  await site?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

function counted(state: State, run: RunRecords, vendor: string): number {
  const epochs = [...run.consentEpochs].sort((a, b) => a.startT - b.startT);
  return run.hits.filter((h) => {
    if (h.vendor !== vendor) return false;
    const label = epochForHit(epochs, h.t)?.label;
    return state === 'accept' ? true : state === 'withdraw' ? label === 'withdrawn' : label !== 'granted';
  }).length;
}

test('consentMatrix lists ga4 and google-ads with a count for each state', () => {
  const run = runs.withdraw;
  const epochs = [...run.consentEpochs].sort((a, b) => a.startT - b.startT);
  const outside = run.hits.filter((h) => h.vendor === 'ga4' && epochForHit(epochs, h.t)?.label !== 'withdrawn');
  expect(outside.some((h) => h.event === 'page_view')).toBe(true);

  expect(manifest.consentMatrix).toHaveLength(1);
  const entry = manifest.consentMatrix[0]!;
  expect(entry.scenario).toBe('plain-gtm-journey');
  for (const vendor of VENDORS) {
    const row = entry.vendors.find((v) => v.vendor === vendor)!;
    expect(row).toBeDefined();
    for (const state of STATES) {
      expect(row.states[state]!.hits).toBe(counted(state, runs[state], vendor));
    }
  }
  const ga4 = entry.vendors.find((v) => v.vendor === 'ga4')!;
  expect(ga4.states.withdraw!.hits).toBeLessThan(runs.withdraw.hits.filter((h) => h.vendor === 'ga4').length);
});

test('the vendor lines follow the table', () => {
  const lines = stdout.split('\n');
  expect(lines.some((l) => l.startsWith('ga4: accept '))).toBe(true);
  expect(lines.some((l) => l.startsWith('google-ads: accept '))).toBe(true);
});

test('run values, IDs and request URLs are in the records and not in suite.json or stdout', () => {
  const urls = new Set<string>();
  for (const state of STATES) {
    const run = runs[state];
    const identity = run.run.identity!;
    const vendorUrls = run.requests.filter((r) => /google-analytics|googleadservices|doubleclick|google\.com\/pagead/.test(r.url)).map((r) => r.url);
    expect(vendorUrls.length).toBeGreaterThan(0);
    for (const url of vendorUrls) urls.add(url);
    expect(texts[state]).toContain(identity.email);
    expect(texts[state]).toContain(identity.phone);
    for (const url of vendorUrls) expect(texts[state]).toContain(JSON.stringify(url).slice(1, -1));
  }
  expect(texts.accept).toContain(CLIENT_ID);
  expect(texts.accept).toContain(MEASUREMENT_ID);
  const secrets = [runs.accept.run.identity!.email, runs.accept.run.identity!.phone, CLIENT_ID, MEASUREMENT_ID, ...urls];
  for (const value of secrets) {
    expect(manifestText).not.toContain(value);
    expect(JSON.stringify(manifest.consentMatrix)).not.toContain(value);
    expect(stdout).not.toContain(value);
  }
});
