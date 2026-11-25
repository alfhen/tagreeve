import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Hit, type RunRecords } from '../packages/core/src/index.ts';
import { standInContainerPath } from '../fixtures/site/src/index.ts';
import { run, type CliRun } from './cli-helpers.ts';

const CONFIG = Buffer.from('id=GTM-PWTEST1&env=1&auth=pw-fixture-auth').toString('base64');
const PROXY_PASSWORD_MARK = /HTTP_PROXY|Proxy-Authorization/;
const URL_USERINFO = /\/\/[^\s/@:"\\]+:[^\s/@"\\]+@/;
const ACCESS_TOKEN = 'pw-fixture-access-token';
const CLIENT_ID = 'pw-client-0001';
const STAND_IN_EMAIL_HASH = createHash('sha256').update('pw-fixture@example.invalid').digest('hex');

let upstream: http.Server;
let env: Record<string, string>;

beforeAll(async () => {
  upstream = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('// fake google file'));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  env = {
    TAGREEVE_TEST_SERVER_CONTAINER_CMD: standInContainerPath,
    TAGREEVE_TEST_SERVER_CONTAINER_UPSTREAM: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    TAGREEVE_SERVER_CONTAINER_CONFIG: CONFIG,
  };
});

afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

const containerGa4 = (records: RunRecords): Hit => {
  const fromContainer = new Set(records.requests.filter((r) => r.captured === 'serverContainer').map((r) => r.id));
  const hits = records.hits.filter((h) => h.vendor === 'ga4' && fromContainer.has(h.requestId));
  expect(hits).toHaveLength(1);
  return hits[0]!;
};

async function expectPrecondition(r: CliRun): Promise<Hit> {
  const records = r.records!;
  const call = containerGa4(records);
  const request = records.requests.find((q) => q.id === call.requestId)!;
  expect(new URL(request.url).searchParams.get('cid')).toBe(CLIENT_ID);
  expect(call.event).toBe('purchase');
  expect(call.params.eventId ?? call.params.eid ?? call.params.event_id).toBeUndefined();
  expect(request.postData ?? '').not.toContain('event_id');
  const browser = records.hits.filter((h) => h.vendor === 'ga4' && h.event === 'purchase' && h.requestId !== call.requestId);
  expect(browser).toHaveLength(1);
  return call;
}

async function expectNoLeaks(r: CliRun): Promise<void> {
  const text = r.records ? await readFile((JSON.parse(r.stdout) as { path: string }).path, 'utf8') : '';
  const all = text + r.stdout + r.stderr;
  expect(text).toContain(STAND_IN_EMAIL_HASH);
  const container = r.records!.run.serverContainer!;
  expect(container.requests).toBeGreaterThan(0);
  expect(container.refused).toBe(0);
  expect(text).toMatch(/graph\.facebook\.com\/v21\.0\/100000000000001\/events\?access_token=/);
  expect(all).not.toContain(CONFIG);
  expect(all).not.toContain('pw-fixture-auth');
  expect(all).not.toContain(ACCESS_TOKEN);
  expect(r.stdout + r.stderr).not.toContain(STAND_IN_EMAIL_HASH);
  expect(all).not.toMatch(PROXY_PASSWORD_MARK);
  expect(all).not.toMatch(URL_USERINFO);
}

describe('a client ID link while the browser request is in flight', () => {
  let forward: CliRun;
  let answerFirst: CliRun;
  let late: CliRun;
  let concurrent: CliRun;
  let epoch: CliRun;

  beforeAll(async () => {
    forward = await run('server-container-ga4-forward', ['--server-container'], env);
    answerFirst = await run('server-container-ga4-answer-first', ['--server-container'], env);
    late = await run('server-container-ga4-answered-late', ['--server-container'], env);
    concurrent = await run('server-container-ga4-answered-concurrent', ['--server-container'], env);
    epoch = await run('server-container-ga4-answered-epoch', ['--server-container'], env);
  }, 300_000);

  const tOf = (r: CliRun, h: Hit) => r.records!.requests.find((q) => q.id === h.requestId)!.t;
  const browserPurchase = (r: CliRun, call: Hit) => r.records!.hits.find((h) => h.vendor === 'ga4' && h.event === 'purchase' && h.requestId !== call.requestId)!;
  const mustNot = (r: CliRun) => r.records!.results.find((x) => x.expectation.includes('mustNot'))!;

  test('a container that answers after its tags send is linked exactly and fails the run', async () => {
    const call = await expectPrecondition(forward);
    expect(call.via).toMatchObject({ by: 'clientId', confidence: 'exact' });
    expect(forward.code).toBe(1);
    const result = forward.records!.results.find((r) => r.expectation.includes('mustNot'))!;
    expect(result.pass).toBe(false);
    expect(result.severity).not.toBe('warn');
    expect(result.note).not.toBe('serverSendProbableLink');
    expect(result.evidence).toContain(call.id);
    await expectNoLeaks(forward);
  });

  test('a container that answers first and calls 300 ms later is now exact and fails the run', async () => {
    const call = await expectPrecondition(answerFirst);
    expect(call.via).toMatchObject({ by: 'clientId', confidence: 'exact' });
    expect(answerFirst.code).toBe(1);
    const result = mustNot(answerFirst);
    expect(result.pass).toBe(false);
    expect(result.severity).not.toBe('warn');
    expect(result.note).not.toBe('serverSendProbableLink');
    expect(result.evidence).toContain(call.id);
    await expectNoLeaks(answerFirst);
  });

  test('a call 3000 ms after the answer stays probable, warns and exits 0', async () => {
    const call = await expectPrecondition(late);
    expect(tOf(late, call) - tOf(late, browserPurchase(late, call))).toBeGreaterThanOrEqual(3000);
    expect(call.via).toMatchObject({ by: 'clientId', confidence: 'probable' });
    expect(call.linkMiss?.clientId).toBe('answeredBefore');
    expect(late.code).toBe(0);
    const result = mustNot(late);
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('warn');
    expect(result.note).toBe('serverSendProbableLink');
    await expectNoLeaks(late);
  });

  test('a same-client-ID request between the hit and the call gives concurrentRequest', async () => {
    const call = await expectPrecondition(concurrent);
    const hitT = tOf(concurrent, browserPurchase(concurrent, call));
    const between = concurrent.records!.requests.filter(
      (q) => q.captured !== 'serverContainer' && q.t > hitT && q.t < tOf(concurrent, call) && new URL(q.url).searchParams.get('cid') === CLIENT_ID,
    );
    expect(between.length).toBeGreaterThanOrEqual(1);
    expect(call.linkMiss?.clientId).toBe('concurrentRequest');
    expect(call.via?.confidence).not.toBe('exact');
    await expectNoLeaks(concurrent);
  });

  test('a consent change between the hit and the call gives answeredBefore and a warning', async () => {
    const call = await expectPrecondition(epoch);
    const hitT = tOf(epoch, browserPurchase(epoch, call));
    const callT = tOf(epoch, call);
    expect(epoch.records!.consentEpochs.some((e) => e.startT > hitT && e.startT <= callT)).toBe(true);
    expect(call.linkMiss?.clientId).toBe('answeredBefore');
    expect(call.via?.confidence).toBe('probable');
    expect(epoch.code).toBe(0);
    expect(mustNot(epoch).severity).toBe('warn');
    await expectNoLeaks(epoch);
  });
});
