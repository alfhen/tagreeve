import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createIdentity, type Flag } from '../packages/core/src/index.ts';
import { standInContainerPath } from '../fixtures/site/src/index.ts';
import { run, type CliRun } from './cli-helpers.ts';

const AUTH = 'pw-fixture-auth';
const CONFIG = Buffer.from(`id=GTM-PWTEST1&env=1&auth=${AUTH}`).toString('base64');
const EMAIL = createIdentity(1).email;
const EMAIL_HASH = createHash('sha256').update(EMAIL).digest('hex');

let upstream: http.Server;
let result: CliRun;
let recordFile: string;

beforeAll(async () => {
  upstream = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('// fake google file'));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const env = {
    TAGREEVE_TEST_SERVER_CONTAINER_CMD: standInContainerPath,
    TAGREEVE_TEST_SERVER_CONTAINER_UPSTREAM: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    TAGREEVE_SERVER_CONTAINER_CONFIG: CONFIG,
  };
  result = await run('identifier-route-server', ['--server-container', '--var', `email=${EMAIL}`], env);
  recordFile = (JSON.parse(result.stdout) as { path: string }).path;
}, 180_000);

afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

const routeFlags = (): Flag[] => result.records!.flags.filter((f) => f.kind === 'identifierRoute');

function capiCall() {
  const records = result.records!;
  const call = records.requests.find((q) => q.captured === 'serverContainer' && new URL(q.url).hostname === 'graph.facebook.com')!;
  const pixel = records.hits.find((h) => h.vendor === 'meta' && h.event === 'Purchase')!;
  const capi = records.hits.find((h) => h.requestId === call.id && h.vendor === 'meta-capi')!;
  return { call, pixel, capi };
}

test('under reject the identity email reaches the container call as a hash, and the route has the browser hit as a hop', () => {
  const records = result.records!;
  expect(records.run.serverContainer!.requests).toBeGreaterThan(0);
  const { call, pixel, capi } = capiCall();
  expect(call.postData).toContain(EMAIL_HASH);
  expect(capi.via).toEqual({ hitId: pixel.id, by: 'eventId', confidence: 'exact' });
  const found = routeFlags().find((f) => f.route!.sink.requestId === call.id)!;
  expect(found.route!.source).toEqual({ source: 'identity', name: 'email' });
  expect(found.route!.sink.vendor).toBe('meta-capi');
  expect(found.route!.sink.transform).toBe('sha256');
  expect(found.route!.hops).toEqual([{ kind: 'hit', hitId: pixel.id, confidence: 'exact' }]);
  expect(found.detail).toMatch(/^identity email -> hit \(.+\) -> server call \(meta-capi, [^,]+, sha256\), link exact$/);
});

test('the identifierRoute result fails, names the call as evidence and the run exits 1', () => {
  const { call } = capiCall();
  const verdict = (JSON.parse(result.stdout) as { results: { expectation: string; pass: boolean; severity: string; evidence: string[] }[] }).results.find((r) => r.expectation === 'builtin: identifierRoute')!;
  expect(verdict.pass).toBe(false);
  expect(verdict.severity).toBe('fail');
  expect(verdict.evidence).toContain(call.id);
  expect(result.code).toBe(1);
});

test('no output holds the identity email, its hash, the auth value or the container config', async () => {
  const file = await readFile(recordFile, 'utf8');
  expect(file).toContain(EMAIL_HASH);
  for (const text of [result.stdout, result.stderr, JSON.stringify(routeFlags())]) {
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(encodeURIComponent(EMAIL));
    expect(text).not.toContain(EMAIL_HASH);
  }
  for (const text of [file, result.stdout, result.stderr]) {
    expect(text).not.toContain(CONFIG);
    expect(text).not.toContain(AUTH);
  }
});
