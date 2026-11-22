import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { canaryPool, type Flag, type Result, type RunRecords } from '../packages/core/src/index.ts';
import { outDir, root, run, runCli, scenario, site, type CliRun } from './cli-helpers.ts';

const REJECT = 'identifier-route-reject';
const GRANTED = 'identifier-route-granted';
const NAME = 'builtin: identifierRoute';
const temp: string[] = [];
let reject: CliRun;

afterAll(async () => {
  await Promise.all(temp.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeAll(async () => {
  reject = await run(REJECT);
}, 150_000);

async function runCopy(prefix: string, edit: (text: string) => string): Promise<{ text: string; result: CliRun }> {
  const parent = join(root, 'test-results');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, prefix));
  temp.push(dir);
  const file = join(dir, 's.yml');
  const text = edit(await readFile(scenario(REJECT), 'utf8'));
  await writeFile(file, text);
  return { text, result: await runCli(['run', file, '--site', site.url, '--out', outDir, '--json']) };
}

const routeResult = (r: CliRun): Result | undefined => r.records?.results.find((x) => x.expectation === NAME);
const routes = (records: RunRecords): Flag[] => records.flags.filter((f) => f.kind === 'identifierRoute');
const adsRequest = (records: RunRecords) => records.requests.find((q) => q.url.includes('AW-000000001'));

test('under reject the gclid route to the Google Ads host fails the run with the request as evidence', () => {
  const records = reject.records!;
  const ads = adsRequest(records)!;
  expect(ads).toBeDefined();
  const result = routeResult(reject)!;
  expect(result).toBeDefined();
  expect(result.pass).toBe(false);
  expect(result.severity).toBe('fail');
  expect(result.message).toContain('url param gclid');
  expect(result.message).toContain('www.googleadservices.com');
  expect(result.evidence).toContain(ads.id);
  expect(reject.code).toBe(1);
});

test('the text run prints the failing check', async () => {
  const text = await runCli(['run', scenario(REJECT), '--site', site.url, '--out', outDir]);
  expect(text.code).toBe(1);
  expect(text.stdout).toContain('  FAIL builtin: identifierRoute');
}, 150_000);

test('accept with send=granted passes, and the message says what was searched and what was not', async () => {
  const granted = await run(GRANTED);
  const records = granted.records!;
  expect(records.flags.some((f) => f.kind === 'canarySearch')).toBe(true);
  expect(routes(records).some((f) => f.route!.source.name === 'gclid')).toBe(true);
  const result = routeResult(granted)!;
  expect(result).toBeDefined();
  expect(result.pass).toBe(true);
  for (const re of [/base64/, /SHA-256/i, /URL/, /body/i, /headers/i, /Referer/, /Cookie/, /\d+ request/, /skipped/i]) expect(result.message).toMatch(re);
  expect(result.message).not.toMatch(/no leaks/i);
  const text = await runCli(['run', scenario(GRANTED), '--site', site.url, '--out', outDir]);
  expect(text.stdout).toContain('  PASS builtin: identifierRoute');
}, 150_000);

test('under reject, send=granted leaves only a pageUrl route, which warns and exits 0', async () => {
  const { text, result } = await runCopy('route-page-', (t) => t.replace('visit: /click-id-relay-send', 'visit: /click-id-relay-send?send=granted'));
  expect(text).toContain('visit: /click-id-relay-send?send=granted');
  const records = result.records!;
  expect(routes(records).some((f) => f.route!.kind === 'pageUrl')).toBe(true);
  expect(routes(records).some((f) => f.route!.sink.vendor === 'google-ads')).toBe(false);
  const found = routeResult(result)!;
  expect(found.pass).toBe(false);
  expect(found.severity).toBe('warn');
  expect(result.code).toBe(0);
}, 150_000);

test('builtins identifierRoute: warn makes the reject run exit 0', async () => {
  const { text, result } = await runCopy('route-warn-', (t) => t.replace('  canaries: true\n', '  canaries: true\n  builtins: { identifierRoute: warn }\n'));
  expect(text).toContain('builtins: { identifierRoute: warn }');
  const found = routeResult(result)!;
  expect(found.pass).toBe(false);
  expect(found.severity).toBe('warn');
  expect(result.code).toBe(0);
}, 150_000);

test('the result, the --json output and the text output hold no form of a canary value or the identity', async () => {
  const records = reject.records!;
  const gclid = records.run.canaries!.find((c) => c.name === 'gclid')!.value;
  expect(new URL(adsRequest(records)!.url).searchParams.get('x')).toBe(Buffer.from(gclid).toString('base64'));
  const result = routeResult(reject)!;
  expect(result).toBeDefined();
  const text = await runCli(['run', scenario(REJECT), '--site', site.url, '--out', outDir]);
  for (const form of canaryPool(records.run.canaries!, records.run.identity).forms.keys()) {
    expect(JSON.stringify(result)).not.toContain(form);
    expect(reject.stdout).not.toContain(form);
    expect(text.stdout).not.toContain(form);
  }
}, 150_000);
