import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { outDir, runCli, type CliRun, scenario, site } from './cli-helpers.ts';

const testOrigin = () => ({ TAGREEVE_TEST_GTM_ORIGIN: site.containerUrl });
const isLoader = (url: string) => url.includes('gtm.js') && new URL(url).searchParams.has('l');
const isMainDoc = (q: { resourceType: string; frame?: { main: boolean } }) => q.resourceType === 'document' && q.frame?.main === true;
const notAborted = (q: { outcome: string; failure?: string }) => !(q.outcome === 'failed' && q.failure === 'net::ERR_ABORTED');

const pushRule = (r: CliRun) => r.records!.results.find((x) => x.expectation.startsWith('mustNot: ') && x.expectation.includes('dataLayer'))!;

test('a click that navigates the main page bounds the embedded loader, so the rule passes', async () => {
  const r = await runCli(['run', scenario('datalayer-frame-loader-nav'), '--site', site.url, '--out', outDir, '--json'], testOrigin());
  const { requests, flags, dataLayerEvents, run } = r.records!;
  const loader = requests.find((q) => isLoader(q.url) && q.frame?.main === false);
  expect(loader).toBeDefined();
  expect(typeof loader!.frame!.page).toBe('number');
  const later = requests.find((q) => isMainDoc(q) && notAborted(q) && q.t > loader!.t);
  expect(later).toBeDefined();
  expect(later!.frame!.page).toBe(loader!.frame!.page);
  expect(flags.filter((f) => f.kind === 'dataLayerNotHooked').some((f) => f.recordIds.includes(loader!.id))).toBe(true);
  for (const q of requests) {
    if (!q.frame) continue;
    expect(typeof q.frame.page).toBe('number');
    expect(q.frame.page).toBe(0);
  }
  expect(run.recordSchemaVersion).toBe(5);
  expect(dataLayerEvents.some((e) => e.frame?.main === true)).toBe(true);
  expect(dataLayerEvents.some((e) => e.frame?.main === false)).toBe(true);
  for (const e of dataLayerEvents) expect(e.frame).not.toHaveProperty('page');
  expect(r.code).toBe(0);
  const result = pushRule(r);
  expect(result.pass).toBe(true);
  expect(result.severity).toBeUndefined();
  expect(r.stdout).not.toContain('could not all be read');
}, 90_000);

test('a click that opens a popup leaves the warning, because the popup is another page', async () => {
  const text = (await readFile(scenario('datalayer-frame-loader-nav'), 'utf8')).replace('start: /datalayer-frame-loader', 'start: /datalayer-frame-loader?popup=1');
  const file = join(outDir, `frame-loader-popup-${Math.random().toString(36).slice(2)}.yml`);
  await writeFile(file, text);
  const r = await runCli(['run', file, '--site', site.url, '--out', outDir, '--json'], testOrigin());
  const { requests } = r.records!;
  const loader = requests.find((q) => isLoader(q.url) && q.frame?.main === false)!;
  expect(loader.frame!.page).toBe(0);
  const after = requests.filter((q) => isMainDoc(q) && q.t > loader.t);
  expect(after.some((q) => q.frame!.page === 1)).toBe(true);
  expect(after.some((q) => notAborted(q) && q.frame!.page === 0)).toBe(false);
  const result = pushRule(r);
  expect(result).toMatchObject({ pass: false, severity: 'warn' });
  expect(r.stdout).toContain('could not all be read');
  expect(r.code).toBe(0);
}, 90_000);

test('a popup document gets its own page number when an earlier blank popup sent no request', async () => {
  const text = (await readFile(scenario('datalayer-frame-loader-nav'), 'utf8')).replace('start: /datalayer-frame-loader', 'start: /datalayer-frame-loader?blank=1');
  const file = join(outDir, `frame-loader-blank-${Math.random().toString(36).slice(2)}.yml`);
  await writeFile(file, text);
  const r = await runCli(['run', file, '--site', site.url, '--out', outDir, '--json'], testOrigin());
  const doc = r.records!.requests.find((q) => isMainDoc(q) && new URL(q.url).pathname === '/datalayer-frame');
  expect(doc).toBeDefined();
  expect(doc!.frame!.page).toBe(2);
}, 90_000);
