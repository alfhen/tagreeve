import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createIdentity, type Flag, type Hit } from '../packages/core/src/index.ts';
import { standInContainerPath } from '../fixtures/site/src/index.ts';
import { run, type CliRun } from './cli-helpers.ts';

const AUTH = 'pw-fixture-auth';
const CONFIG = Buffer.from(`id=GTM-PWTEST1&env=1&auth=${AUTH}`).toString('base64');
const TOKEN = 'pw-fixture-pinterest-token';
const EMAIL = createIdentity(1).email;
const EMAIL_HASH = createHash('sha256').update(EMAIL).digest('hex');

let upstream: http.Server;
let linked: CliRun;
let other: CliRun;
let linkedFile: string;

beforeAll(async () => {
  upstream = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('// fake google file'));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const env = {
    TAGREEVE_TEST_SERVER_CONTAINER_CMD: standInContainerPath,
    TAGREEVE_TEST_SERVER_CONTAINER_UPSTREAM: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    TAGREEVE_SERVER_CONTAINER_CONFIG: CONFIG,
  };
  linked = await run('pinterest-capi-server', ['--server-container', '--var', `email=${EMAIL}`], env);
  linkedFile = (JSON.parse(linked.stdout) as { path: string }).path;
  other = await run('pinterest-capi-server', ['--server-container', '--var', `email=${EMAIL}`, '--var', 'eid=pw-pin-event-9'], env);
}, 240_000);

afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

const routeFlags = (): Flag[] => linked.records!.flags.filter((f) => f.kind === 'identifierRoute');

function pieces(result: CliRun) {
  const records = result.records!;
  const call = records.requests.find((q) => q.captured === 'serverContainer' && new URL(q.url).hostname === 'api.pinterest.com');
  const capi = records.hits.find((h) => h.requestId === call?.id && h.vendor === 'pinterest-capi');
  const tag = records.hits.find((h): h is Hit => h.vendor === 'pinterest' && h.event === 'addtocart');
  return { call, capi, tag };
}

test('the record holds the container call, its hit, the tag hit and the hashed email', () => {
  const { call, capi, tag } = pieces(linked);
  expect(call).toBeDefined();
  expect(call!.method).toBe('POST');
  expect(call!.postData).toContain(EMAIL_HASH);
  expect(capi!.event).toBe('add_to_cart');
  expect(tag!.params.eventId).toBe('pw-pin-event-1');
  expect(capi!.params.eventId).toBe('pw-pin-event-1');
});

test('the call links to the Pinterest tag hit by event ID, exact, and the route has it as the one hop', () => {
  const { call, capi, tag } = pieces(linked);
  expect(capi!.via).toEqual({ hitId: tag!.id, by: 'eventId', confidence: 'exact' });
  const found = routeFlags().find((f) => f.route!.sink.requestId === call!.id)!;
  expect(found.route!.sink.vendor).toBe('pinterest-capi');
  expect(found.route!.sink.transform).toBe('sha256');
  expect(found.route!.hops).toEqual([{ kind: 'hit', hitId: tag!.id, confidence: 'exact' }]);
});

test('the identifierRoute result fails, names the call as evidence and the run exits 1', () => {
  const { call } = pieces(linked);
  const verdict = (JSON.parse(linked.stdout) as { results: { expectation: string; pass: boolean; severity: string; evidence: string[] }[] }).results.find((r) => r.expectation === 'builtin: identifierRoute')!;
  expect(verdict.pass).toBe(false);
  expect(verdict.severity).toBe('fail');
  expect(verdict.evidence).toContain(call!.id);
  expect(linked.code).toBe(1);
});

test('a call with another event ID is never linked exact', () => {
  const { capi, tag } = pieces(other);
  expect(capi).toBeDefined();
  expect(tag).toBeDefined();
  expect(capi!.params.eventId).toBe('pw-pin-event-9');
  expect(capi!.params.eventId).not.toBe(tag!.params.eventId);
  expect(capi!.via === undefined || capi!.via.confidence === 'probable').toBe(true);
});

test('no output holds the token, the bearer header, the hashed email in stdout, stderr or route flags, or the container config', async () => {
  const { call } = pieces(linked);
  expect(call!.headers.authorization).toBe('[redacted]');
  expect(call!.secretsRedacted).toContain('authorization');
  const file = await readFile(linkedFile, 'utf8');
  expect(file).toContain(EMAIL_HASH);
  for (const text of [file, linked.stdout, linked.stderr]) {
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(`Bearer ${TOKEN}`);
    expect(text).not.toContain(CONFIG);
    expect(text).not.toContain(AUTH);
  }
  for (const text of [linked.stdout, linked.stderr, JSON.stringify(routeFlags())]) expect(text).not.toContain(EMAIL_HASH);
});
