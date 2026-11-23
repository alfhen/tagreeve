import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { canaryPool, type Flag, type RunRecords } from '../packages/core/src/index.ts';
import { outDir, root, run, runCli, scenario, site, type CliRun } from './cli-helpers.ts';

const temp: string[] = [];
let reject: CliRun;
let rejectHtml: string;

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

async function htmlOf(result: CliRun): Promise<string> {
  const { path } = JSON.parse(result.stdout) as { path: string };
  const out = join(await tempDir('report-routes-'), 'report.html');
  expect((await runCli(['report', path, '--html', out])).code).toBe(0);
  return readFile(out, 'utf8');
}

beforeAll(async () => {
  reject = await run('identifier-route-reject');
  rejectHtml = await htmlOf(reject);
}, 150_000);

const routeFlags = (records: RunRecords): Flag[] => records.flags.filter((f) => f.kind === 'identifierRoute');
const strip = (html: string) => html.replace(/<[^>]*>/g, ' ');
const section = (html: string, from: string, to: RegExp) => {
  const start = html.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const rest = html.slice(start + from.length);
  const end = rest.search(to);
  return end < 0 ? rest : rest.slice(0, end);
};
const routeSection = (html: string) => section(html, 'Identifier routes', /<h2>/);
const searchSection = (html: string) => section(html, 'Searched and skipped', /<h2>/);
const routeRows = (html: string) => {
  const part = routeSection(html);
  return (part.slice(0, part.indexOf('Searched and skipped')).match(/<tr>.*?<\/tr>/g) ?? []).filter((row) => !row.includes('<th'));
};

test('the gclid route row shows the route, the sink host, the epoch and the verdict', () => {
  const row = routeRows(rejectHtml).find((r) => r.includes('www.googleadservices.com'))!;
  expect(row).toBeDefined();
  expect(row).toContain('gclid');
  expect(row).toContain('denied');
  expect(row).toContain('FAIL');
});

test('Searched and skipped names the forms, the parts, the request count and the skipped count', () => {
  const records = reject.records!;
  const flag = records.flags.find((f) => f.kind === 'canarySearch')!;
  const count = /Searched (\d+) requests?/.exec(flag.detail)![1]!;
  const text = strip(searchSection(rejectHtml));
  for (const re of [/base64/, /SHA-256/i, /URL-encoded/i, /URL/, /body/i, /decoded/i]) expect(text).toMatch(re);
  expect(text).toContain(`${count} request`);
  expect(text).toContain(`Skipped: ${flag.recordIds.length} request`);
});

test('the list says headers, including Referer and Cookie, were not searched', () => {
  const text = strip(searchSection(rejectHtml));
  for (const re of [/headers/i, /Referer/, /Cookie/, /not searched/i]) expect(text).toMatch(re);
});

test('the report holds no form of a canary value or of the identity, and keeps its CSP', () => {
  const records = reject.records!;
  const email = records.run.identity?.email;
  expect(typeof email === 'string' && email.length > 0).toBe(true);
  const gclid = records.run.canaries!.find((c) => c.name === 'gclid')!.value;
  const ads = records.requests.find((q) => q.url.includes('AW-000000001'))!;
  expect(new URL(ads.url).searchParams.get('x')).toBe(Buffer.from(gclid).toString('base64'));
  expect(rejectHtml).toContain('Identifier routes');
  for (const form of [email!, ...Object.keys(canaryPool(records.run.canaries!, records.run.identity!).forms)]) expect(rejectHtml).not.toContain(form);
  expect(rejectHtml).toContain('Content-Security-Policy');
  expect(rejectHtml).toContain("default-src 'none'");
  expect(rejectHtml).not.toMatch(/<script|<link|<img|url\(|@import/i);
});

test('under reject the page-URL routes warn and the other routes fail, one row per flag', () => {
  const records = reject.records!;
  const flags = routeFlags(records);
  expect(flags.some((f) => f.route!.kind === 'pageUrl' && f.route!.sink.vendor === 'ga4')).toBe(true);
  expect(flags.some((f) => f.route!.sink.host === 'www.googleadservices.com')).toBe(true);
  const rows = routeRows(rejectHtml);
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(rows).toHaveLength(flags.length);
  const pageUrl = flags.filter((f) => f.route!.kind === 'pageUrl').length;
  expect(rows.filter((r) => r.includes('WARN') && !r.includes('FAIL'))).toHaveLength(pageUrl);
  expect(rows.filter((r) => r.includes('FAIL'))).toHaveLength(flags.length - pageUrl);
});

test('with send=granted every route row reads PASS', async () => {
  const granted = await run('identifier-route-granted');
  const records = granted.records!;
  expect(records.results.find((r) => r.expectation === 'builtin: identifierRoute')!.pass).toBe(true);
  const flags = routeFlags(records);
  expect(flags.length).toBeGreaterThanOrEqual(1);
  const rows = routeRows(await htmlOf(granted));
  expect(rows).toHaveLength(flags.length);
  for (const row of rows) {
    expect(row).toContain('PASS');
    expect(row).not.toMatch(/FAIL|WARN/);
  }
}, 150_000);

test('a run without canaries has neither the section nor the list', async () => {
  const dir = await tempDir('report-routes-off-');
  const file = join(dir, 's.yml');
  const original = await readFile(scenario('identifier-route-reject'), 'utf8');
  const copy = original.replace('  canaries: true\n', '');
  expect(original).toContain('canaries: true');
  expect(copy).not.toContain('canaries: true');
  await writeFile(file, copy);
  const off = await runCli(['run', file, '--site', site.url, '--out', outDir, '--json']);
  const records = off.records!;
  expect(records.run.canaries).toBeUndefined();
  expect(records.flags.some((f) => f.kind === 'canarySearch' || f.kind === 'identifierRoute')).toBe(false);
  const html = await htmlOf(off);
  expect(html).not.toContain('Identifier routes');
  expect(html).not.toContain('Searched and skipped');
  expect(rejectHtml).toContain('Identifier routes');
  expect(rejectHtml).toContain('Searched and skipped');
}, 150_000);
