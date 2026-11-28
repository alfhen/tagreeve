import type { DataLayerEvent, Hit } from '../packages/core/src/index.ts';
import { expect, test } from 'vitest';
import { run, runText } from './cli-helpers.ts';

interface Summary {
  results: { expectation: string; pass: boolean; severity?: string; message: string; evidence: string[] }[];
}

const NAME = 'builtin: consentModeOrder';

async function order(name: string) {
  const r = await run(name);
  const summary = JSON.parse(r.stdout) as Summary;
  return { code: r.code, stdout: r.stdout, result: summary.results.find((x) => x.expectation === NAME), records: r.records! };
}

const commandOf = (e: DataLayerEvent) => (e.args[0] === 'consent' ? `consent ${String(e.args[1])}` : String(e.args[0]));
const mainPush = (events: DataLayerEvent[], command: string) => events.find((e) => e.frame?.main === true && commandOf(e) === command);
const googleHit = (hits: Hit[]) => hits.find((h) => h.vendor === 'ga4' && h.event === 'page_view');

test('a default pushed after config warns with consentModeOrder and exits 0', async () => {
  const { code, result, records } = await order('consent-mode-order-late');
  const config = mainPush(records.dataLayerEvents, 'config');
  const def = mainPush(records.dataLayerEvents, 'consent default');
  expect(config, 'a main frame config push').toBeDefined();
  expect(def, 'a main frame consent default push').toBeDefined();
  expect(config!.t).toBeLessThanOrEqual(def!.t);
  expect(records.dataLayerEvents.indexOf(config!)).toBeLessThan(records.dataLayerEvents.indexOf(def!));
  expect(googleHit(records.hits), 'a Google hit').toBeDefined();
  expect(code).toBe(0);
  expect(result).toBeDefined();
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('warn');
  expect(result!.message).toContain('main frame dataLayer');
  expect(result!.evidence).toEqual([config!.id, def!.id]);
  const text = await runText('consent-mode-order-late');
  expect(text.stdout).toMatch(/WARN builtin: consentModeOrder/);
}, 150_000);

test('builtins: consentModeOrder: fail exits 1 on the same page', async () => {
  const { code, result, records } = await order('consent-mode-order-late-fail');
  const config = mainPush(records.dataLayerEvents, 'config');
  const def = mainPush(records.dataLayerEvents, 'consent default');
  expect(records.dataLayerEvents.indexOf(config!)).toBeLessThan(records.dataLayerEvents.indexOf(def!));
  expect(googleHit(records.hits)).toBeDefined();
  expect(code).toBe(1);
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('fail');
}, 90_000);

test('the default pushed first passes', async () => {
  const { code, result, records } = await order('consent-mode-order-first');
  const config = mainPush(records.dataLayerEvents, 'config');
  const def = mainPush(records.dataLayerEvents, 'consent default');
  expect(config).toBeDefined();
  expect(def).toBeDefined();
  expect(records.dataLayerEvents.indexOf(def!)).toBeLessThan(records.dataLayerEvents.indexOf(config!));
  expect(googleHit(records.hits)).toBeDefined();
  expect(code).toBe(0);
  expect(result!.pass).toBe(true);
}, 90_000);

test('options.consentMode: a default that grants ad_storage warns, names it and exits 0', async () => {
  const { code, result, records } = await order('consent-mode-order-option');
  const def = mainPush(records.dataLayerEvents, 'consent default');
  expect(def).toBeDefined();
  expect((def!.args[2] as Record<string, unknown>).ad_storage).toBe('granted');
  expect(code).toBe(0);
  expect(result).toBeDefined();
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('warn');
  expect(result!.message).toContain('ad_storage');
  expect(result!.evidence).toContain(def!.id);
}, 90_000);

test('options.consentMode with builtins: consentModeOrder: fail exits 1', async () => {
  const { code, result, records } = await order('consent-mode-order-option-fail');
  expect((mainPush(records.dataLayerEvents, 'consent default')!.args[2] as Record<string, unknown>).ad_storage).toBe('granted');
  expect(code).toBe(1);
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('fail');
  expect(result!.message).toContain('ad_storage');
}, 90_000);

test('the same page without the option gives no finding for ad_storage', async () => {
  const { code, result, records } = await order('consent-mode-order-no-option');
  expect((mainPush(records.dataLayerEvents, 'consent default')!.args[2] as Record<string, unknown>).ad_storage).toBe('granted');
  expect(code).toBe(0);
  expect(result?.message ?? '').not.toContain('ad_storage');
}, 90_000);

test('a hit sent between the answer and the update push warns for the update gap and names the hit', async () => {
  const { code, result, records } = await order('consent-mode-order-update-late');
  const hit = googleHit(records.hits);
  const update = mainPush(records.dataLayerEvents, 'consent update');
  const granted = records.consentEpochs.find((e) => e.label === 'granted');
  expect(hit, 'a Google hit').toBeDefined();
  expect(update, 'a main frame consent update push').toBeDefined();
  expect(granted, 'a granted epoch').toBeDefined();
  expect(granted!.startT).toBeLessThan(hit!.t);
  expect(hit!.t).toBeLessThan(update!.t);
  expect(code).toBe(0);
  expect(result).toBeDefined();
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('warn');
  expect(result!.evidence).toContain(hit!.id);
  expect(result!.message).toContain('sent after the decision and before the update');
}, 90_000);

test('the same hit sent after the update push does not warn', async () => {
  const { code, result, records } = await order('consent-mode-order-update-early');
  const hit = googleHit(records.hits);
  const update = mainPush(records.dataLayerEvents, 'consent update');
  expect(hit, 'a Google hit').toBeDefined();
  expect(update, 'a main frame consent update push').toBeDefined();
  expect(update!.t).toBeLessThan(hit!.t);
  expect(code).toBe(0);
  expect(result?.message ?? '').not.toContain('before the update');
}, 90_000);

test('a token in an extra key of a consent push is in the record and in no output', async () => {
  const token = 'PWLEAK-M100-TOKEN';
  const { code, result, records, stdout } = await order('consent-mode-order-leak');
  const planted = records.dataLayerEvents.find((e) => JSON.stringify(e).includes(token));
  expect(planted, 'a dataLayerEvent that holds the token').toBeDefined();
  expect(commandOf(planted!)).toBe('consent default');
  expect(records.dataLayerEvents.indexOf(mainPush(records.dataLayerEvents, 'config')!)).toBeLessThan(records.dataLayerEvents.indexOf(planted!));
  expect(code).toBe(0);
  expect(result, 'a consentModeOrder result').toBeDefined();
  expect(result!.pass).toBe(false);
  expect(result!.message).not.toContain(token);
  expect(JSON.stringify(result!.evidence)).not.toContain(token);
  expect(stdout).not.toContain(token);
  const text = await runText('consent-mode-order-leak');
  expect(text.stdout).toMatch(/consentModeOrder/);
  expect(text.stdout).not.toContain(token);
  expect(text.stderr).not.toContain(token);
}, 150_000);
