import { newId, type Request, type Response, type Run } from '@tagreeve/core';
import { describe, expect, test } from 'vitest';
import { evaluate } from './evaluate.ts';
import { parseScenario } from './scenario.ts';

const runId = newId('run');
const HOST = 'sgtm.example.com';
const URL_OF_REJECTED = `https://${HOST}/pwloader0001/g/collect?tid=G-PWTEST0001&cid=pw-client.1`;
const NAME = 'builtin: serverContainerRejected';

function req(over: Partial<Request> = {}): Request {
  return {
    type: 'request',
    id: newId('request'),
    runId,
    stepId: null,
    t: 1,
    method: 'POST',
    url: URL_OF_REJECTED,
    resourceType: 'fetch',
    frameUrl: null,
    initiator: null,
    headers: {},
    postData: null,
    outcome: 'stubbed',
    ...over,
  };
}

function res(r: Request, status: number): Response {
  return { type: 'response', id: newId('response'), requestId: r.id, status, setCookieNames: [] };
}

function run(over: Partial<Run> = {}): Run {
  return {
    type: 'run',
    id: runId,
    serverContainer: { image: 'img', startedAt: 0, requests: 0, passThrough: { serverjs: 0, config: 0, destination: 0 }, refused: 0, unlinked: 0 },
    ...over,
  } as Run;
}

const scenario = (hosts: string[] = [HOST]) => parseScenario(`start: /\noptions: { serverHosts: [${hosts.join(', ')}] }`);

/** One request per status; `null` means no response record. */
function records(statuses: (number | null)[], over: Partial<Request> = {}) {
  const requests = statuses.map(() => req(over));
  const responses = requests.flatMap((r, i) => (statuses[i] === null ? [] : [res(r, statuses[i]!)]));
  return { requests, responses };
}

function check(statuses: (number | null)[], runOver: Partial<Run> = {}, hosts?: string[]) {
  const { requests, responses } = records(statuses);
  const out = evaluate([run(runOver), ...requests, ...responses], scenario(hosts)).filter((r) => r.expectation === NAME);
  return { out, requests };
}

test('requests the container never answered (outcome passed) are not counted', () => {
  const { requests, responses } = records([400, 400], { outcome: 'passed' });
  const out = evaluate([run(), ...requests, ...responses], scenario()).filter((r) => r.expectation === NAME);
  expect(out[0]!.pass).toBe(true);
  expect(out[0]!.message).toContain('No requests');
});

describe('when it warns', () => {
  test.each([
    [[400, 400, 200, 200], false],
    [[400, 400, 200], true],
    [[400, 400, 400, 200], true],
    [[400], false],
    [[500, 200, 200], false],
    [[399, 399], false],
    [[400, 400], true],
  ])('statuses %j warn: %s', (statuses, warns) => {
    const { out } = check(statuses);
    expect(out).toHaveLength(1);
    expect(out[0]!.pass).toBe(!warns);
    expect(out[0]!.severity).toBe('warn');
  });

  test('one rejected request of one passes', () => {
    expect(check([400]).out[0]!.pass).toBe(true);
  });

  test('half is not more than half, and 400 is rejected while 399 is not', () => {
    expect(check([400, 400, 200, 200]).out[0]!.pass).toBe(true);
    expect(check([400, 400, 399]).out[0]!.pass).toBe(false);
    expect(check([399, 399, 399]).out[0]!.pass).toBe(true);
  });
});

describe('the message', () => {
  test('lists status codes ascending with no answer last', () => {
    expect(check([400, 400, null, 200]).out[0]!.message).toBe('3 of 4 requests to the server container were rejected (400: 2, no answer: 1).');
    expect(check([500, 400, 404]).out[0]!.message).toBe('3 of 3 requests to the server container were rejected (400: 1, 404: 1, 500: 1).');
    expect(check([null, null, 200]).out[0]!.message).toContain('(no answer: 2)');
    expect(check([null, 400, 400]).out[0]!.message).toContain('(400: 2, no answer: 1)');
  });

  test('a request with no response shows as no answer: 1', () => {
    expect(check([null, 400]).out[0]!.message).toContain('no answer: 1');
  });

  test('the evidence is exactly the rejected request IDs', () => {
    const { out, requests } = check([400, 200, 503, 200, 400]);
    expect(out[0]!.pass).toBe(false);
    expect(new Set(out[0]!.evidence)).toEqual(new Set([requests[0]!.id, requests[2]!.id, requests[4]!.id]));
  });

  test('with no counted request it passes and says so', () => {
    const out = evaluate([run()], scenario()).filter((r) => r.expectation === NAME);
    expect(out[0]).toMatchObject({ pass: true, message: 'No requests to the server container to check.', evidence: [] });
  });

  test('holds no path, query, host or ID of the rejected requests', () => {
    const { requests, responses } = records([400, 400, 400]);
    const input = JSON.stringify(requests);
    for (const secret of [HOST, 'pwloader0001', 'G-PWTEST0001', 'pw-client.1']) expect(input).toContain(secret);
    const result = evaluate([run(), ...requests, ...responses], scenario()).find((r) => r.expectation === NAME)!;
    expect(result.pass).toBe(false);
    for (const absent of [HOST, 'pwloader0001', 'G-PWTEST0001', 'pw-client.1', '/g/collect', 'tid=', 'cid=']) expect(result.message).not.toContain(absent);
  });
});

describe('which requests count', () => {
  const rejected = (n: number) => Array.from({ length: n }, () => 400);

  test.each<[string, Partial<Request>]>([
    ['unload', { initiator: 'unload' }],
    ['redirect', { initiator: 'redirect' }],
    ['a container call', { captured: 'serverContainer' }],
    ['a net log request', { captured: 'netlog' }],
    ['a script', { resourceType: 'script' }],
    ['a stylesheet', { resourceType: 'stylesheet' }],
    ['a font', { resourceType: 'font' }],
    ['a document', { resourceType: 'document' }],
    ['a library path', { url: `https://${HOST}/gtag/js?id=G-PWTEST0001`, resourceType: 'xhr' }],
  ])('%s is not counted', (_name, over) => {
    const counted = records([200, 400]);
    const skipped = records(rejected(3), over);
    const out = evaluate([run(), ...counted.requests, ...counted.responses, ...skipped.requests, ...skipped.responses], scenario()).find((r) => r.expectation === NAME)!;
    expect(out.pass).toBe(true);
    expect(out.message).toBe('1 of 2 requests to the server container were rejected.');
  });

  test('the same requests count without the exclusion', () => {
    const { requests, responses } = records(rejected(3));
    expect(evaluate([run(), ...requests, ...responses], scenario()).find((r) => r.expectation === NAME)!.pass).toBe(false);
  });

  test('a host outside serverHosts is not counted, and the same records warn with the host listed', () => {
    const { requests, responses } = records(rejected(3));
    const other = evaluate([run(), ...requests, ...responses], scenario(['other.example.com'])).find((r) => r.expectation === NAME)!;
    expect(other).toMatchObject({ pass: true, message: 'No requests to the server container to check.' });
    expect(evaluate([run(), ...requests, ...responses], scenario()).find((r) => r.expectation === NAME)!.pass).toBe(false);
  });
});

describe('the run kind', () => {
  const rejecting = () => records(rejected3());
  const rejected3 = () => [400, 400, 400];
  const results = (runRecord: Run) => {
    const { requests, responses } = rejecting();
    return evaluate([runRecord, ...requests, ...responses], scenario()).filter((r) => r.expectation === NAME);
  };

  test('a working container gets a result, also without an identity', () => {
    expect(results(run())).toHaveLength(1);
    expect(results(run({ identity: null }))).toHaveLength(1);
  });

  test.each(['exited', 'notReady'])('a container with error %s gets no result', (error) => {
    expect(results(run({ serverContainer: { ...run().serverContainer!, error } as Run['serverContainer'] }))).toHaveLength(0);
  });

  test('the stand-in with an error gets no result, without a container it gets one', () => {
    expect(results(run({ testServerContainer: true, serverContainer: { ...run().serverContainer!, error: 'exited' } as Run['serverContainer'] }))).toHaveLength(0);
    expect(results(run({ testServerContainer: true, serverContainer: undefined }))).toHaveLength(1);
  });

  test('a run with no container gets no result', () => {
    expect(results(run({ serverContainer: undefined }))).toHaveLength(0);
  });

  test('a scenario can set it to fail', () => {
    const { requests, responses } = rejecting();
    const s = parseScenario(`start: /\noptions: { serverHosts: [${HOST}], builtins: { serverContainerRejected: fail } }`);
    expect(evaluate([run(), ...requests, ...responses], s).find((r) => r.expectation === NAME)!.severity).toBe('fail');
  });
});
