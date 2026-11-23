import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { canaryPool, readRun, type Flag, type RunRecords } from '../packages/core/src/index.ts';
import type { SuiteManifest } from '../packages/cli/src/suite.ts';
import { root, runCli, scenario, site } from './cli-helpers.ts';

const STATES = ['accept', 'reject', 'none', 'withdraw'] as const;
type State = (typeof STATES)[number];
const GCLID_SINK = 'www.googleadservices.com';
const GA4_SINK = 'www.google-analytics.com';

interface Suite {
  dir: string;
  manifest: SuiteManifest;
  runs: Record<State, RunRecords>;
  texts: Record<State, string>;
  html: string;
}

const temp: string[] = [];
let relay: Suite;
let rules: Suite;

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

/** A suite folder with one copy of the relay journey that can withdraw. `edit` changes the scenario text. */
async function suiteOf(prefix: string, extra: string[], edit: (text: string) => string = (t) => t): Promise<Suite & { out: string }> {
  const base = await tempDir(prefix);
  const scenarios = join(base, 'scenarios');
  await mkdir(scenarios);
  const original = await readFile(scenario('identifier-route-reject'), 'utf8');
  const text = edit(original.replace('  allowUnknownDestination: true\n', '  allowUnknownDestination: true\n  withdrawWith: "#pw-cookie-settings"\n'));
  expect(text).toContain('withdrawWith');
  await writeFile(join(scenarios, 'identifier-route-reject.yml'), text);
  const out = join(base, 'runs');
  const ran = await runCli(['suite', scenarios, ...extra, '--site', site.url, '--out', out]);
  expect(ran.stderr).not.toContain('Error');
  const [id] = await readdir(out);
  const dir = join(out, id!);
  const manifest = JSON.parse(await readFile(join(dir, 'suite.json'), 'utf8')) as SuiteManifest;
  const runs = {} as Record<State, RunRecords>;
  const texts = {} as Record<State, string>;
  for (const cell of manifest.cells) {
    const state = cell.labels.consent as State | undefined;
    if (!state) continue;
    runs[state] = await readRun(join(dir, cell.record!));
    texts[state] = await readFile(join(dir, cell.record!), 'utf8');
  }
  const file = join(base, 'report.html');
  const report = await runCli(['report', dir, '--html', file]);
  expect(report.code).toBe(0);
  return { dir, manifest, runs, texts, html: await readFile(file, 'utf8'), out };
}

beforeAll(async () => {
  relay = await suiteOf('report-consent-audit-', ['--consent', STATES.join(',')]);
  rules = await suiteOf('report-consent-rules-', ['--consent', STATES.join(',')], (text) =>
    text.replace('  canaries: true\n', '  canaries: true\n  builtins: { identifierRoute: warn }\n').replace('mustNot: []', 'mustNot:\n    - { vendor: google-ads }'),
  );
}, 400_000);

const strip = (html: string) => html.replace(/<[^>]*>/g, ' ');
const auditOf = (html: string) => {
  const start = html.indexOf('<section class="consent-audit">');
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start);
};
const column = (html: string, state: State): string => {
  const parts = html.split('<section class="audit-col"').slice(1);
  const part = parts.find((p) => p.startsWith(` data-state="${state}"`));
  expect(part, state).toBeDefined();
  return part!.slice(0, part!.indexOf('</section>'));
};
const routeFlags = (records: RunRecords): Flag[] => records.flags.filter((f) => f.kind === 'identifierRoute');
const builtin = (records: RunRecords, name: string) => records.results.find((r) => r.expectation === `builtin: ${name}`);
const cellOf = (suite: Suite, state: State) => suite.manifest.cells.find((c) => c.labels.consent === state)!;
const items = (html: string) => html.match(/<li class="s-[a-z-]+">.*?<\/li>/g) ?? [];

test('the Consent audit section has a column per state with verdict, routes, setup and what was searched', () => {
  const { runs, html } = relay;
  const reject = routeFlags(runs.reject);
  expect(reject.some((f) => f.route?.kind === 'pageUrl' && f.route.sink.vendor === 'ga4' && f.route.sink.host === GA4_SINK && f.route.source.name === 'gclid')).toBe(true);
  expect(reject.some((f) => f.route?.sink.host === GCLID_SINK && f.route.source.name === 'gclid')).toBe(true);
  expect(routeFlags(runs.none).some((f) => f.route?.sink.host === GCLID_SINK)).toBe(true);
  expect(builtin(runs.none, 'identifierRoute')?.pass).toBe(false);

  expect(html).toContain('Consent audit');
  for (const state of STATES) {
    expect(html).toContain(`<h4>${state}</h4>`);
    const col = column(html, state);
    expect(col).toContain('consentModeSetup');
    expect(col).toContain('Searched and skipped');
    expect(col).toContain('Parts not searched');
  }
  const reject$ = items(column(html, 'reject'));
  expect(reject$.find((li) => li.includes(GA4_SINK) && li.includes('gclid'))).toMatch(/WARN/);
  expect(reject$.find((li) => li.includes(GA4_SINK) && li.includes('gclid'))).not.toMatch(/FAIL/);
  expect(reject$.find((li) => li.includes(GCLID_SINK) && li.includes('gclid'))).toMatch(/FAIL/);
  const none = column(html, 'none');
  expect(none).toContain('gclid');
  expect(items(none).find((li) => li.includes('identifierRoute'))).toMatch(/FAIL/);
});

test('the section starts with what the report is and what a pass means, and says headers were not searched', () => {
  const text = strip(relay.html);
  const start = text.indexOf('Consent audit');
  const firstColumn = text.indexOf('accept', start + 'Consent audit'.length);
  const lead = text.slice(start, firstColumn);
  expect(lead).toMatch(/what was sent/i);
  expect(lead).toMatch(/likely problems/i);
  expect(lead).toMatch(/people decide/i);
  expect(text.indexOf('no planted value was found in the searched forms')).toBeGreaterThan(text.search(/people decide/i));
  const section = strip(auditOf(relay.html));
  for (const re of [/URL/, /body/i, /decoded/i, /headers/i, /not searched/i]) expect(section).toMatch(re);
});

test('a suite without --consent has no Consent audit section', async () => {
  const base = await tempDir('report-consent-off-');
  const scenarios = join(base, 'scenarios');
  await mkdir(scenarios);
  await writeFile(join(scenarios, 'identifier-route-reject.yml'), await readFile(scenario('identifier-route-reject'), 'utf8'));
  await runCli(['suite', scenarios, '--site', site.url, '--out', join(base, 'runs')]);
  const [id] = await readdir(join(base, 'runs'));
  const dir = join(base, 'runs', id!);
  const manifest = JSON.parse(await readFile(join(dir, 'suite.json'), 'utf8')) as SuiteManifest;
  expect('consent' in manifest).toBe(false);
  expect(manifest.cells.some((c) => c.labels.consent !== undefined)).toBe(false);
  const file = join(base, 'report.html');
  expect((await runCli(['report', dir, '--html', file])).code).toBe(0);
  expect(await readFile(file, 'utf8')).not.toContain('Consent audit');
}, 150_000);

test('accept reads PASS from its own record and reject reads FAIL naming identifierRoute', () => {
  const { manifest, runs, html } = relay;
  expect(cellOf(relay, 'accept').status).toBe('pass');
  expect(cellOf(relay, 'reject').status).toBe('fail');
  expect(cellOf(relay, 'reject').failed?.checks).toContain('identifierRoute');
  const rejectResult = builtin(runs.reject, 'identifierRoute')!;
  expect(rejectResult.pass).toBe(false);
  expect(rejectResult.severity).toBe('fail');
  expect(runs.accept.results.every((r) => r.pass)).toBe(true);
  expect(manifest.consent).toEqual([...STATES]);
  const accept = column(html, 'accept');
  expect(accept).toContain('<strong>PASS</strong>');
  expect(accept).not.toContain('FAIL');
  const reject = column(html, 'reject');
  expect(reject).toContain('<strong>FAIL</strong></p>');
  expect(reject).toContain('identifierRoute');
});

test('the report holds no identity, canary or observed value and says what was searched', async () => {
  const { runs, texts, html } = relay;
  for (const state of STATES) {
    const run = runs[state];
    expect(run.run.identity!.email).toBeTruthy();
    expect(run.run.identity!.phone).toBeTruthy();
    expect(texts[state]).toContain(run.run.identity!.email);
    expect(texts[state]).toContain(run.run.identity!.phone);
    const gclid = run.run.canaries!.find((c) => c.name === 'gclid')!;
    expect(gclid.value).toContain(state.toUpperCase());
    for (const value of [run.run.identity!.email, run.run.identity!.phone, ...run.run.canaries!.map((c) => c.value), ...canaryPool(run.run.canaries!, run.run.identity).forms.keys()]) {
      expect(html, `${state} ${value}`).not.toContain(value);
    }
  }
  const gclid = runs.reject.run.canaries!.find((c) => c.name === 'gclid')!.value;
  const ads = runs.reject.requests.find((r) => r.url.includes('AW-000000001'))!;
  expect(new URL(ads.url).searchParams.get('x')).toBe(Buffer.from(gclid).toString('base64'));
  const cid = '1111111111.2222222222';
  expect(STATES.some((s) => runs[s].requests.some((r) => r.url.includes(cid)))).toBe(true);
  expect(html).not.toContain(cid);
});

test('the section shows the consentMatrix table with the hit counts of each vendor in state order', () => {
  const entries = (relay.manifest as unknown as { consentMatrix: { vendors: { vendor: string; states: Record<string, { hits: number }> }[] }[] }).consentMatrix;
  expect(entries).toHaveLength(1);
  const vendors = entries[0]!.vendors;
  expect(vendors.map((v) => v.vendor)).toEqual(expect.arrayContaining(['ga4', 'google-ads']));
  for (const v of vendors) for (const state of STATES) expect(typeof v.states[state]?.hits).toBe('number');
  expect(vendors.find((v) => v.vendor === 'ga4')!.states.withdraw!.hits).toBe(0);
  const rows = relay.html.match(/<tr><th scope="row">[^<]*<\/th>(?:<td>[^<]*<\/td>)+<\/tr>/g) ?? [];
  for (const v of vendors) {
    const row = rows.find((r) => r.startsWith(`<tr><th scope="row">${v.vendor}</th>`));
    expect(row, v.vendor).toBeDefined();
    const counts = [...row!.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(counts).toEqual(STATES.map((s) => String(v.states[s]!.hits)));
  }
});

test('a rule that fails in its own state is named in that column and skipped in the others', () => {
  const { manifest, runs, html } = rules;
  const cell = (state: State) => cellOf(rules, state);
  expect(cell('reject').failed?.rules).toBe(1);
  expect(cell('reject').rulesSkipped).toBeUndefined();
  for (const state of ['accept', 'none', 'withdraw'] as const) expect(cell(state).rulesSkipped).toBe(1);
  expect(manifest.consent).toEqual([...STATES]);
  const rule = runs.reject.results.find((r) => r.expectation.startsWith('mustNot') && r.expectation.includes('google-ads'))!;
  expect(rule.pass).toBe(false);
  for (const state of ['accept', 'none', 'withdraw'] as const) expect(runs[state].results.some((r) => r.expectation.startsWith('mustNot'))).toBe(false);
  for (const state of ['reject', 'none', 'withdraw'] as const) {
    const result = builtin(runs[state], 'identifierRoute')!;
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('warn');
  }

  const reject = column(html, 'reject');
  expect(reject).toContain('FAIL');
  const failed = items(reject).find((li) => li.includes('mustNot') && li.includes('google-ads'))!;
  expect(failed).toMatch(/FAIL/);
  expect(items(reject).find((li) => li.includes('identifierRoute'))).toMatch(/WARN/);
  for (const state of ['none', 'withdraw'] as const) {
    const li = items(column(html, state)).find((i) => i.includes('identifierRoute'))!;
    expect(li).toMatch(/WARN/);
    expect(li).not.toMatch(/FAIL/);
  }
  for (const state of ['accept', 'none', 'withdraw'] as const) {
    const col = column(html, state);
    const m = /(\d+) rules? (?:was |were )?skipped|rules? skipped:? (\d+)/i.exec(strip(col));
    expect(Number(m?.[1] ?? m?.[2]), state).toBe(cell(state).rulesSkipped);
    expect(items(col).some((li) => li.includes('mustNot') && li.includes('FAIL'))).toBe(false);
  }
});
