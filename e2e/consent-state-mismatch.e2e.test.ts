import type { DataLayerEvent, Hit } from '../packages/core/src/index.ts';
import { expect, test } from 'vitest';
import { run, runText } from './cli-helpers.ts';

interface Summary {
  results: { expectation: string; pass: boolean; severity?: string; message: string; evidence: string[] }[];
}

const NAME = 'builtin: consentStateMismatch';

async function mismatch(name: string) {
  const r = await run(name);
  const summary = JSON.parse(r.stdout) as Summary;
  return { code: r.code, stdout: r.stdout, result: summary.results.find((x) => x.expectation === NAME), records: r.records! };
}

const denies = (e: DataLayerEvent) => e.args[0] === 'consent' && e.args[1] === 'update' && (e.args[2] as Record<string, unknown>).ad_storage === 'denied';
const googleHit = (hits: Hit[]) => hits.find((h) => h.vendor === 'ga4' && h.event === 'page_view');

test('a granted hit after a reject update warns with consentStateMismatch naming the main frame, and exits 0', async () => {
  const { code, result, records } = await mismatch('consent-state-mismatch-main');
  const reject = records.dataLayerEvents.find((e) => e.frame?.main === true && denies(e));
  const hit = googleHit(records.hits);
  expect(reject, 'a main frame consent update push that denies').toBeDefined();
  expect(hit, 'a GA4 hit').toBeDefined();
  expect(hit!.consent.ads).toBe('granted');
  expect(hit!.t - reject!.t).toBeGreaterThan(2000);
  expect(code).toBe(0);
  expect(result).toBeDefined();
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('warn');
  expect(result!.message).toContain('main frame');
  expect(result!.evidence).toContain(hit!.id);
  expect(result!.evidence).toContain(reject!.id);
  const text = await runText('consent-state-mismatch-main');
  expect(text.stdout).toMatch(/WARN builtin: consentStateMismatch/);
}, 150_000);

test('builtins: consentStateMismatch: fail exits 1 on the same page', async () => {
  const { code, result, records } = await mismatch('consent-state-mismatch-fail');
  expect(records.dataLayerEvents.some((e) => e.frame?.main === true && denies(e))).toBe(true);
  expect(googleHit(records.hits)!.consent.ads).toBe('granted');
  expect(code).toBe(1);
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('fail');
}, 90_000);

test('a frame that denies by its own update and sends a granted hit is reported as a sub frame', async () => {
  const { code, result, records } = await mismatch('consent-state-mismatch-frame');
  const reject = records.dataLayerEvents.find(denies);
  const hit = googleHit(records.hits);
  expect(reject, 'a consent update push that denies').toBeDefined();
  expect(hit, 'a GA4 hit').toBeDefined();
  expect(reject!.frame!.main).toBe(false);
  expect(records.requests.find((r) => r.id === hit!.requestId)!.frame!.n).toBe(reject!.frame!.n);
  expect(records.dataLayerEvents.some((e) => e.frame?.main === true && denies(e))).toBe(false);
  expect(code).toBe(0);
  expect(result).toBeDefined();
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('warn');
  expect(result!.message).toContain('sub frame');
  expect(result!.evidence).toContain(hit!.id);
  expect(result!.evidence).toContain(reject!.id);
}, 90_000);

test('a gcs, a gcd and a token in an extra key of the update are in the record and in no output', async () => {
  const token = 'PWLEAK-G100-TOKEN';
  const { code, result, records, stdout } = await mismatch('consent-state-mismatch-leak');
  const planted = records.dataLayerEvents.find((e) => JSON.stringify(e).includes(token));
  const hit = googleHit(records.hits);
  expect(planted, 'a dataLayerEvent that holds the token').toBeDefined();
  expect(hit!.consent.raw).toMatchObject({ gcs: 'G111', gcd: '11t1t1t1t5' });
  expect(code).toBe(0);
  expect(result, 'a consentStateMismatch result').toBeDefined();
  expect(result!.pass).toBe(false);
  const values = [token, 'G111', '11t1t1t1t5'];
  for (const v of values) {
    expect(result!.message).not.toContain(v);
    expect(JSON.stringify(result!.evidence)).not.toContain(v);
  }
  expect(stdout).not.toContain(token);
  const text = await runText('consent-state-mismatch-leak');
  expect(text.stdout).not.toContain(token);
  expect(text.stderr).not.toContain(token);
  for (const line of text.stdout.split('\n').filter((l) => l.includes('consentStateMismatch'))) {
    expect(line).not.toContain('G111');
    expect(line).not.toContain('11t1t1t1t5');
  }
}, 150_000);
