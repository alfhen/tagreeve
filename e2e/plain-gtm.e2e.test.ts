import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import type { DataLayerEvent, Hit, Request } from '../packages/core/src/index.ts';
import { outDir, root, run, runCli, scenario, site, type CliRun } from './cli-helpers.ts';

interface Summary {
  path: string;
  results: { expectation: string; pass: boolean; message: string }[];
  flags: { kind: string }[];
}

const LOCAL = new Set(['localhost', '127.0.0.1']);
const GOOGLE_HOST = /(^|\.)(google-analytics\.com|doubleclick\.net|googleadservices\.com)$/;

const hostOf = (r: Request) => new URL(r.url).hostname;
const summaryOf = (r: CliRun) => JSON.parse(r.stdout) as Summary;
const consentCommand = (e: DataLayerEvent, kind: string) => e.isConsentCommand && e.args[1] === kind;
const consentArgs = (e: DataLayerEvent) => e.args[2] as Record<string, string>;
const ga4Hits = (hits: Hit[]) => hits.filter((h) => h.vendor === 'ga4');
const conversions = (hits: Hit[]) => hits.filter((h) => h.vendor === 'google-ads' && h.event === 'conversion' && h.params.conversionId === '000000001');

async function reportHtml(summary: Summary, name: string): Promise<string> {
  const file = join(outDir, name);
  const report = await runCli(['report', summary.path, '--html', file]);
  expect(report.code, report.stderr).toBe(0);
  const html = await readFile(file, 'utf8');
  expect(html.toLowerCase().startsWith('<!doctype html')).toBe(true);
  return html;
}

function assertReportHtml(html: string, ga4Count: number): void {
  expect(ga4Count).toBeGreaterThanOrEqual(1);
  const row = /<tr><th scope="row">Google Analytics 4 \(ga4\)<\/th>[\s\S]*?<\/tr>/.exec(html)?.[0];
  expect(row, 'the Google Analytics 4 timeline row').toBeDefined();
  expect(row).toMatch(/<span class="count">[1-9][0-9]* hit/);
  const item = /<li[^>]*>(?:(?!<li)[\s\S])*?<code>builtin: sandboxPageUrl<\/code>[\s\S]*?<\/li>/.exec(html)?.[0];
  expect(item, 'the sandboxPageUrl result').toBeDefined();
  expect(item).toContain('<span class="status">PASS</span>');
  const verdict = /<p class="verdict">([\s\S]*?)<\/p>/.exec(html)?.[1];
  expect(verdict, 'the verdict line').toBeDefined();
  expect(verdict!.startsWith('Verdict: ')).toBe(true);
  expect(verdict).not.toMatch(/sandboxPageUrl|platformHost/);
  const flags = /<h2>Flags<\/h2>([\s\S]*?)<h2>Fields seen while a signal was denied<\/h2>/.exec(html)?.[1];
  expect(flags, 'the Flags section').toBeDefined();
  expect(flags).not.toMatch(/sandboxPageUrl|platformHost/);
}

describe('plain GTM journey, accept', () => {
  let result: CliRun;
  let summary: Summary;

  beforeAll(async () => {
    result = await run('plain-gtm-journey');
    summary = summaryOf(result);
  }, 150_000);

  test('passes with the default built-in checks and sends GA4 and Google hits for the plain pages', () => {
    const records = result.records!;
    expect(result.code, result.stderr).toBe(0);
    expect(summary.results.every((r) => r.pass)).toBe(true);
    const plainHits = ga4Hits(records.hits).filter((h) => {
      const page = new URL(h.page ?? 'about:blank');
      return page.host === new URL(site.url).host && page.pathname.startsWith('/plain/');
    });
    expect(plainHits.length).toBeGreaterThanOrEqual(1);
    expect(records.requests.filter((r) => !LOCAL.has(hostOf(r)) && GOOGLE_HOST.test(hostOf(r))).length).toBeGreaterThanOrEqual(1);
    for (const name of ['builtin: sandboxPageUrl', 'builtin: unknownDestination']) {
      expect(summary.results.find((r) => r.expectation === name)?.pass, name).toBe(true);
    }
    expect(summary.flags.filter((f) => f.kind === 'sandboxPageUrl' || f.kind === 'platformHost')).toEqual([]);
  });

  test('records the purchase push and the GA4 purchase hit after the accept', () => {
    const { dataLayerEvents, hits } = result.records!;
    const update = dataLayerEvents.find((e) => consentCommand(e, 'update') && consentArgs(e).analytics_storage === 'granted');
    expect(update).toBeDefined();
    const push = dataLayerEvents.find((e) => e.event === 'purchase');
    expect(push).toBeDefined();
    const data = push!.args.find((a) => typeof a === 'object' && a !== null && 'ecommerce' in a) as { ecommerce: Record<string, unknown> & { items: { item_id: string }[] } };
    expect(data.ecommerce.transaction_id).toBeTruthy();
    expect(data.ecommerce.value).toBeDefined();
    expect(data.ecommerce.currency).toBeTruthy();
    expect(data.ecommerce.items[0]!.item_id).toBeTruthy();
    const hit = hits.find((h) => h.vendor === 'ga4' && h.event === 'purchase');
    expect(hit).toBeDefined();
    expect(hit!.consent.analytics).toBe('granted');
    expect(push!.t).toBeGreaterThan(update!.t);
    expect(hit!.t).toBeGreaterThan(update!.t);
  });

  test('consentModeSetup reads the gcd of the shop', () => {
    expect(ga4Hits(result.records!.hits).every((h) => h.consent.raw.gcd)).toBe(true);
    const check = summary.results.find((r) => r.expectation === 'builtin: consentModeSetup');
    expect(check?.pass).toBe(true);
    expect(check!.message).not.toContain('could not be read');
    expect(check!.message).toContain('found every signal set');
  });

  test('Consent Mode starts denied, the accept updates it, and every Google hit carries gcs and gcd', () => {
    const { dataLayerEvents, hits, requests } = result.records!;
    const signals = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];
    const def = dataLayerEvents.find((e) => consentCommand(e, 'default'));
    const update = dataLayerEvents.find((e) => consentCommand(e, 'update') && consentArgs(e).analytics_storage === 'granted');
    expect(def).toBeDefined();
    expect(update).toBeDefined();
    for (const s of signals) {
      expect(consentArgs(def!)[s], s).toBe('denied');
      expect(consentArgs(update!)[s], s).toBe('granted');
    }
    expect(def!.t).toBeLessThan(update!.t);

    const gtmJs = dataLayerEvents.filter((e) => e.event === 'gtm.js').sort((a, b) => a.t - b.t);
    expect(gtmJs.length).toBeGreaterThanOrEqual(3);
    gtmJs.forEach((e, i) => {
      const end = gtmJs[i + 1]?.t ?? Infinity;
      const ready = dataLayerEvents.some((x) => (x.event === 'gtm.dom' || x.event === 'gtm.load') && x.t > e.t && x.t < end);
      expect(ready, `gtm.dom or gtm.load after gtm.js #${i + 1}`).toBe(true);
    });

    expect(requests.some((r) => r.url.includes('tid=G-PWTEST0001'))).toBe(true);
    const sent = conversions(hits).filter((h) => h.t > update!.t);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    for (const h of sent) expect(h.consent.ads).toBe('granted');
    const google = hits.filter((h) => h.vendor === 'ga4' || h.vendor === 'google-ads');
    for (const h of google) {
      expect(h.consent.raw.gcs, h.id).toBeTruthy();
      expect(h.consent.raw.gcd, h.id).toBeTruthy();
    }
    for (const r of requests.filter((x) => !LOCAL.has(hostOf(x)))) expect(r.outcome, r.url).toBe('stubbed');
    expect(requests.some((r) => hostOf(r) === 'www.googletagmanager.com')).toBe(false);
  });

  test('the HTML report shows GA4 hits, the passing sandboxPageUrl check and no platform text', async () => {
    const html = await reportHtml(summary, 'accept.html');
    assertReportHtml(html, ga4Hits(result.records!.hits).length);
  }, 60_000);

  test('the scenario sets no platform option', () => {
    const text = readFileSync(scenario('plain-gtm-journey'), 'utf8');
    expect(text).not.toMatch(/builtins|allowUnknownDestination|platformHosts/);
  });
});

describe('plain GTM journey, reject', () => {
  let result: CliRun;
  let summary: Summary;

  beforeAll(async () => {
    const text = readFileSync(scenario('plain-gtm-journey'), 'utf8');
    expect(text).toContain('consent: accept');
    const file = join(outDir, 'plain-gtm-reject.yml');
    await writeFile(file, text.replace('consent: accept', 'consent: reject'));
    result = await runCli(['run', file, '--site', site.url, '--out', outDir, '--json'], {}, root);
    expect(result.code).not.toBe(2);
    summary = summaryOf(result);
  }, 150_000);

  test('every GA4 and Ads conversion hit is denied after a denied consent update', () => {
    const { dataLayerEvents, hits } = result.records!;
    const ga4 = ga4Hits(hits);
    expect(ga4.length).toBeGreaterThanOrEqual(1);
    for (const h of ga4) {
      expect(h.consent.raw.gcs, h.id).toBeTruthy();
      expect(h.consent.analytics, h.id).toBe('denied');
    }
    expect(dataLayerEvents.some((e) => consentCommand(e, 'update') && consentArgs(e).analytics_storage === 'denied')).toBe(true);
    for (const h of conversions(hits)) {
      expect(h.consent.raw.gcs, h.id).toBeTruthy();
      expect(h.consent.ads, h.id).toBe('denied');
    }
  });

  test('the HTML report shows GA4 hits, the passing sandboxPageUrl check and no platform text', async () => {
    const html = await reportHtml(summary, 'reject.html');
    assertReportHtml(html, ga4Hits(result.records!.hits).length);
  }, 60_000);
});
