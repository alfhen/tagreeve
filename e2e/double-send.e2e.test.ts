import type { Hit } from '../packages/core/src/index.ts';
import { expect, test } from 'vitest';
import { run, runText } from './cli-helpers.ts';

interface Summary {
  results: { expectation: string; pass: boolean; severity?: string; message: string; evidence: string[] }[];
}

const NAME = 'builtin: doubleSend';
const TXN = 'PWLEAK-D100-TXN';
const CID = '555000111.1700000001';

async function doubleSend(name: string) {
  const r = await run(name);
  const summary = JSON.parse(r.stdout) as Summary;
  return { code: r.code, stdout: r.stdout, stderr: r.stderr, results: summary.results.filter((x) => x.expectation === NAME), records: r.records! };
}

const purchases = (hits: Hit[]) => hits.filter((h) => h.vendor === 'ga4' && h.event === 'purchase');

test('one purchase hit from the top frame and one from the embedded frame warn with doubleSend and exit 0', async () => {
  const { code, results, records } = await doubleSend('double-send-frames');
  const hits = purchases(records.hits);
  expect(hits).toHaveLength(2);
  const frames = hits.map((h) => records.requests.find((r) => r.id === h.requestId)!.frame!);
  expect(frames.map((f) => f.main).sort()).toEqual([false, true]);
  expect(hits.every((h) => records.requests.find((r) => r.id === h.requestId)!.url.includes(`cid=${CID}`))).toBe(true);
  expect(code).toBe(0);
  expect(results).toHaveLength(1);
  expect(results[0]!.pass).toBe(false);
  expect(results[0]!.severity).toBe('warn');
  expect(results[0]!.message).toContain('main frame and sub frame');
  expect(results[0]!.evidence.sort()).toEqual(hits.map((h) => h.id).sort());
  const text = await runText('double-send-frames');
  expect(text.stdout).toMatch(/WARN builtin: doubleSend/);
}, 150_000);

test('builtins: doubleSend: fail exits 1 on the same page', async () => {
  const { code, results, records } = await doubleSend('double-send-fail');
  expect(purchases(records.hits)).toHaveLength(2);
  expect(code).toBe(1);
  expect(results[0]!.pass).toBe(false);
  expect(results[0]!.severity).toBe('fail');
}, 90_000);

test('a page that sends the hit from the top frame only has no doubleSend result', async () => {
  const { code, results, records } = await doubleSend('double-send-top');
  const hits = purchases(records.hits);
  expect(hits).toHaveLength(1);
  expect(records.requests.find((r) => r.id === hits[0]!.requestId)!.frame!.main).toBe(true);
  expect(code).toBe(0);
  expect(results).toHaveLength(0);
}, 90_000);

test('a listener attached twice pushes purchase twice and sends two hits, and the warning says so', async () => {
  const { results, records } = await doubleSend('double-send-listener');
  const pushes = records.dataLayerEvents.filter((e) => JSON.stringify(e.args).includes('"purchase"'));
  expect(pushes).toHaveLength(2);
  expect(purchases(records.hits)).toHaveLength(2);
  expect(results).toHaveLength(1);
  expect(results[0]!.pass).toBe(false);
  expect(results[0]!.message).toContain('twice from the main frame');
  expect(results[0]!.message).toContain('the event was also pushed twice');
}, 90_000);

test('one push with two equal hits and one client ID warns', async () => {
  const { results, records } = await doubleSend('double-send-one');
  const pushes = records.dataLayerEvents.filter((e) => JSON.stringify(e.args).includes('"purchase"'));
  expect(pushes).toHaveLength(1);
  expect(purchases(records.hits)).toHaveLength(2);
  expect(results[0]!.pass).toBe(false);
  expect(results[0]!.message).toContain('one push or none was recorded');
}, 90_000);

test('two hits with different params do not warn', async () => {
  const { results, records } = await doubleSend('double-send-different');
  const hits = purchases(records.hits);
  expect(hits).toHaveLength(2);
  expect(hits[0]!.params).not.toEqual(hits[1]!.params);
  expect(results.filter((r) => !r.pass)).toHaveLength(0);
}, 90_000);

test('the transaction ID and the client ID are in the record and in no output', async () => {
  const { stdout, stderr, results, records } = await doubleSend('double-send-frames');
  expect(records.requests.some((r) => r.url.includes(TXN) && r.url.includes(CID))).toBe(true);
  const text = await runText('double-send-frames');
  const result = results[0]!;
  const planted = [TXN, CID, CID.split('.')[0]!];
  for (const v of planted) {
    for (const out of [stdout, stderr, text.stdout, text.stderr, result.message, JSON.stringify(result.evidence)]) expect(out).not.toContain(v);
  }
  expect(result.message).not.toContain('transaction_id');
  expect(JSON.stringify(result.evidence)).not.toContain('transaction_id');
}, 150_000);
