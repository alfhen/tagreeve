import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import type { Request, RunRecords } from '../packages/core/src/index.ts';
import { run, runText, type CliRun } from './cli-helpers.ts';

const NAME = 'builtin: idHandover';
const TID = 'G-PWTEST0001';
const CID = '3333333333.4444444444';
const ROTATED = '5555555555.6666666666';
const SID = '1730000000';

interface Summary {
  results: { expectation: string; pass: boolean; severity?: string; message: string; evidence: string[] }[];
}

const resultOf = (r: CliRun) => (JSON.parse(r.stdout) as Summary).results.find((x) => x.expectation === NAME)!;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hostOf = (url: string | null) => new URL(url ?? 'about:blank').hostname;
const sentBy = (records: RunRecords, host: string, ids: string[] = []): Request[] =>
  records.hits
    .filter((h) => h.vendor === 'ga4' && h.params.tid === TID && hostOf(h.page) === host && ids.every((id) => records.requests.find((q) => q.id === h.requestId)!.url.includes(id)))
    .map((h) => records.requests.find((q) => q.id === h.requestId)!);

test('offsite checkout with the same cid passes, and the hit after the answer is not analytics-denied', async () => {
  const r = await run('id-handover-offsite');
  const records = r.records!;
  const local = sentBy(records, 'localhost', [CID]);
  const offsite = sentBy(records, '127.0.0.1', [CID]);
  expect(local.length).toBeGreaterThan(0);
  expect(offsite.length).toBeGreaterThan(0);
  expect(offsite.some((q) => !q.url.includes('gcs=G100'))).toBe(true);
  expect(resultOf(r).pass).toBe(true);
  expect(r.code).toBe(0);
}, 150_000);

test('offsite checkout with a rotated cid warns, names the ID and both contexts, and keeps exit 0', async () => {
  const r = await run('id-handover-rotate');
  const records = r.records!;
  expect(sentBy(records, 'localhost', [CID]).length).toBeGreaterThan(0);
  expect(sentBy(records, '127.0.0.1', [ROTATED]).some((q) => !q.url.includes('gcs=G100'))).toBe(true);
  const result = resultOf(r);
  expect(result.pass).toBe(false);
  expect(result.severity).toBe('warn');
  for (const part of [TID, 'localhost', '127.0.0.1', 'main frame']) expect(result.message).toContain(part);
  expect(result.message).not.toMatch(/(localhost|127\.0\.0\.1):\d/);
  expect(result.evidence.every((id) => id.startsWith('hit_'))).toBe(true);
  expect(r.code).toBe(0);
}, 150_000);

test('the cid and sid strings are in the request records and in no output, message or evidence', async () => {
  const json = await run('id-handover-rotate');
  const text = await runText('id-handover-rotate');
  const records = json.records!;
  const strings = [CID, ROTATED, SID];
  for (const s of strings) expect(records.requests.some((q) => q.url.includes(s) || (q.postData ?? '').includes(s)), s).toBe(true);
  const result = resultOf(json);
  expect(result.pass).toBe(false);
  expect(text.stdout).toContain('WARN builtin: idHandover');
  const needles = strings.flatMap((s) => [s, s.split('.')[0]!, sha(s)]);
  for (const n of needles) {
    expect(json.stdout).not.toContain(n);
    expect(json.stderr).not.toContain(n);
    expect(text.stdout).not.toContain(n);
    expect(text.stderr).not.toContain(n);
    expect(result.message).not.toContain(n);
    expect(JSON.stringify(result.evidence)).not.toContain(n);
  }
  expect(result.evidence.every((id) => id.startsWith('hit_'))).toBe(true);
}, 150_000);

test('builtins idHandover: fail makes the rotate run exit 1, and the default exits 0', async () => {
  const strict = await run('id-handover-rotate-fail');
  expect(resultOf(strict).severity).toBe('fail');
  expect(resultOf(strict).pass).toBe(false);
  expect(strict.code).toBe(1);
  const plain = await run('id-handover-rotate');
  expect(resultOf(plain).severity).toBe('warn');
  expect(plain.code).toBe(0);
}, 200_000);

const ROTATED_SID = '1730009999';

const frameHits = (records: RunRecords, main: boolean, ids: string[]): Request[] =>
  records.hits
    .filter((h) => h.vendor === 'ga4' && h.params.tid === TID && h.consent.analytics !== 'denied')
    .map((h) => records.requests.find((q) => q.id === h.requestId)!)
    .filter((q) => q.outcome === 'stubbed' && q.frame?.main === main && ids.every((id) => q.url.includes(id)));

const expectNoIds = (r: CliRun, message: string, ids: string[]) => {
  for (const s of ids) {
    expect(r.records!.requests.some((q) => q.url.includes(s) || (q.postData ?? '').includes(s)), s).toBe(true);
    for (const n of [s, s.split('.')[0]!]) {
      expect(r.stdout).not.toContain(n);
      expect(r.stderr).not.toContain(n);
      expect(message).not.toContain(n);
    }
  }
};

test('a sandboxed frame with the same cid and sid as the top frame passes', async () => {
  const r = await run('id-handover-frame');
  const records = r.records!;
  expect(frameHits(records, true, [CID, `sid=${SID}`]).length).toBeGreaterThan(0);
  expect(frameHits(records, false, [CID, `sid=${SID}`]).length).toBeGreaterThan(0);
  expect(frameHits(records, false, [CID]).every((q) => !(q.frameUrl ?? '').includes('/web-pixels@'))).toBe(true);
  const sandbox = (JSON.parse(r.stdout) as Summary).results.find((x) => x.expectation === 'builtin: sandboxPageUrl');
  expect(sandbox?.pass).toBe(true);
  expect(resultOf(r).pass).toBe(true);
  expect(r.code).toBe(0);
}, 150_000);

test('a sandboxed frame with a rotated cid warns, names both frames, and keeps exit 0', async () => {
  const r = await run('id-handover-frame-rotate-cid');
  const records = r.records!;
  expect(frameHits(records, true, [CID]).length).toBeGreaterThan(0);
  expect(frameHits(records, false, [ROTATED]).length).toBeGreaterThan(0);
  const result = resultOf(r);
  expect(result.pass).toBe(false);
  expect(result.severity).toBe('warn');
  for (const part of [TID, 'main frame', 'sub frame']) expect(result.message).toContain(part);
  expectNoIds(r, result.message, [CID, ROTATED, SID]);
  expect(r.code).toBe(0);
}, 150_000);

test('a sandboxed frame with a rotated sid and the same cid warns about the session ID', async () => {
  const r = await run('id-handover-frame-rotate-sid');
  const records = r.records!;
  expect(frameHits(records, true, [CID, `sid=${SID}`]).length).toBeGreaterThan(0);
  expect(frameHits(records, false, [CID, `sid=${ROTATED_SID}`]).length).toBeGreaterThan(0);
  const result = resultOf(r);
  expect(result.pass).toBe(false);
  expect(result.severity).toBe('warn');
  for (const part of [TID, 'main frame', 'sub frame', 'session ID differs']) expect(result.message).toContain(part);
  expect(result.message).not.toContain('client ID differs');
  expectNoIds(r, result.message, [CID, SID, ROTATED_SID]);
  expect(r.code).toBe(0);
}, 150_000);
