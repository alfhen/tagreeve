import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { canaryPool, type Flag, type RunRecords } from '../packages/core/src/index.ts';
import { outDir, root, run, runCli, runText, scenario, site, type CliRun } from './cli-helpers.ts';

const SCENARIO = 'identifier-route-reject';
const temp: string[] = [];
let reject: CliRun;

afterAll(async () => {
  await Promise.all(temp.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeAll(async () => {
  reject = await run(SCENARIO);
}, 150_000);

async function tempDir(prefix: string): Promise<string> {
  const parent = join(root, 'test-results');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, prefix));
  temp.push(dir);
  return dir;
}

async function runCopy(prefix: string, edit: (text: string) => string): Promise<{ text: string; result: CliRun }> {
  const dir = await tempDir(prefix);
  const file = join(dir, 's.yml');
  const text = edit(await readFile(scenario(SCENARIO), 'utf8'));
  await writeFile(file, text);
  return { text, result: await runCli(['run', file, '--site', site.url, '--out', outDir, '--json']) };
}

const canary = (records: RunRecords, name: string) => records.run.canaries!.find((c) => c.name === name)!.value;
const adsRequest = (records: RunRecords) => records.requests.find((q) => q.url.includes('AW-000000001'));
const routes = (records: RunRecords): Flag[] => records.flags.filter((f) => f.kind === 'identifierRoute');
const b64 = (text: string) => Buffer.from(text).toString('base64');

test('under reject the gclid canary in the Google Ads request gives one unknown base64 route', () => {
  const records = reject.records!;
  const gclid = canary(records, 'gclid');
  const ads = adsRequest(records)!;
  expect(new URL(ads.url).searchParams.get('x')).toBe(b64(gclid));
  const found = routes(records).filter((f) => f.route!.sink.requestId === ads.id);
  expect(found).toHaveLength(1);
  const { route, recordIds, detail } = found[0]!;
  expect(route!.kind).toBe('unknown');
  expect(route!.sink.transform).toBe('base64');
  expect(route!.sink.vendor).toBe('google-ads');
  expect(route!.hops).toEqual([]);
  expect(JSON.stringify(route!.source)).toContain('gclid');
  expect(recordIds).toContain(ads.id);
  expect(detail.startsWith('url param gclid -> request to ')).toBe(true);
});

test('the GA4 page view of the relay page gives a pageUrl route for gclid', () => {
  const records = reject.records!;
  const gclid = canary(records, 'gclid');
  const view = records.hits.find((h) => h.vendor === 'ga4' && h.page?.includes(gclid))!;
  expect(view).toBeDefined();
  const found = routes(records).find((f) => f.route!.sink.requestId === view.requestId && f.route!.source.name === 'gclid')!;
  expect(found.route!.kind).toBe('pageUrl');
  expect(found.route!.sink.vendor).toBe('ga4');
});

test('the run has one canarySearch flag that names the forms and parts and counts requests', () => {
  const searches = reject.records!.flags.filter((f) => f.kind === 'canarySearch');
  expect(searches).toHaveLength(1);
  const { detail } = searches[0]!;
  for (const re of [/base64/, /SHA-256/i, /URL/, /body/i, /headers/i, /Referer/, /Cookie/]) expect(detail).toMatch(re);
  expect(Number(/Searched (\d+) request/.exec(detail)?.[1])).toBeGreaterThan(0);
});

test('the relay page sets the first-party cookies _pw_click and _pw_other', () => {
  const cookies = reject.records!.checkpoints.flatMap((c) => c.cookies);
  for (const name of ['_pw_click', '_pw_other']) expect(cookies.find((c) => c.name === name)?.firstParty, name).toBe(true);
});

test('send=granted sends no conversion while consent is rejected', async () => {
  const { text, result } = await runCopy('route-granted-', (t) => t.replace('visit: /click-id-relay-send', 'visit: /click-id-relay-send?send=granted'));
  expect(text).toContain('/click-id-relay-send?send=granted');
  expect(result.failed).toEqual(reject.failed);
  expect(result.records!.requests.some((q) => q.url.includes('/click-id-relay-send?send=granted'))).toBe(true);
  expect(adsRequest(reject.records!)).toBeDefined();
  expect(adsRequest(result.records!)).toBeUndefined();
  expect(routes(result.records!).filter((f) => f.route!.sink.vendor === 'google-ads')).toEqual([]);
}, 150_000);

test('a run without canaries has neither flag and no identifierRoute result, and the other results match', async () => {
  const { text, result } = await runCopy('route-off-', (t) => t.replace('  canaries: true\n', ''));
  expect(text).not.toContain('canaries');
  const kinds = new Set(reject.records!.flags.map((f) => f.kind));
  expect(kinds.has('identifierRoute')).toBe(true);
  expect(kinds.has('canarySearch')).toBe(true);
  expect(result.records!.flags.filter((f) => f.kind === 'identifierRoute' || f.kind === 'canarySearch')).toEqual([]);
  expect(result.records!.results.some((x) => /identifierRoute|canarySearch/.test(x.expectation))).toBe(false);
  // J13 judges the canary flags, so the run with canaries has one more result and fails on it.
  expect(reject.failed).toContain('builtin: identifierRoute');
  expect(result.code).toBe(0);
  expect(result.failed).toEqual(reject.failed.filter((name) => name !== 'builtin: identifierRoute'));
}, 150_000);

test('no flag and no output holds a form of a canary value or the identity', async () => {
  const text = await runText(SCENARIO);
  const records = reject.records!;
  expect(new URL(adsRequest(records)!.url).searchParams.get('x')).toBe(b64(canary(records, 'gclid')));
  const flags = records.flags.filter((f) => f.kind === 'identifierRoute' || f.kind === 'canarySearch');
  expect(flags.length).toBeGreaterThan(1);
  for (const form of canaryPool(records.run.canaries!, records.run.identity).forms.keys()) {
    for (const flag of flags) expect(JSON.stringify(flag)).not.toContain(form);
    expect(reject.stdout).not.toContain(form);
    expect(text.stdout).not.toContain(form);
  }
  expect(text.stdout).toContain('identifierRoute:');
  expect(text.stdout).toContain('canarySearch:');
}, 150_000);
