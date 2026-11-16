import { createHash } from 'node:crypto';
import { newId, type Hit, type Request } from '@tagreeve/core';
import { decodeRequest } from '@tagreeve/decoders';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { idHandover } from './id-handover.ts';
import { evaluate } from './evaluate.ts';
import { BUILTIN_NAMES, parseScenario } from './scenario.ts';

const TID = 'G-PWTEST0001';
const CID_A = '4821907365.1730000001';
const CID_B = '5555555555.1730000002';
const SID_A = '1730000011';
const SID_B = '1730000022';

interface Spec {
  main?: boolean;
  host?: string;
  port?: number;
  path?: string;
  tid?: string;
  cid?: string;
  sid?: string;
  gcs?: string;
  gcd?: string;
  server?: boolean;
}

function build(spec: Spec, n: number): { hit: Hit; request: Request } {
  const host = spec.host ?? 'localhost';
  const page = `http://${host}:${spec.port ?? 3000}${spec.path ?? '/plain/product'}`;
  const query = [
    'v=2',
    `tid=${spec.tid ?? TID}`,
    ...(spec.cid ? [`cid=${spec.cid}`] : []),
    ...(spec.sid ? [`sid=${spec.sid}`] : []),
    'en=page_view',
    `dl=${encodeURIComponent(page)}`,
    ...(spec.gcs ? [`gcs=${spec.gcs}`] : []),
    ...(spec.gcd ? [`gcd=${spec.gcd}`] : []),
  ].join('&');
  const request: Request = {
    type: 'request',
    id: newId('request'),
    runId: newId('run'),
    stepId: null,
    t: 1_800_000_000_000,
    method: 'GET',
    url: `https://www.google-analytics.com/g/collect?${query}`,
    resourceType: 'image',
    frameUrl: page,
    initiator: null,
    headers: {},
    postData: null,
    outcome: 'stubbed',
    frame: { main: spec.main ?? true, n: spec.main === false ? 2 : 1 },
    ...(spec.server ? { captured: 'serverContainer' as const } : {}),
  };
  const [hit] = decodeRequest(request, () => `hit_FIXED${n}` as Hit['id']);
  return { hit: hit!, request };
}

function run(specs: Spec[]) {
  const built = specs.map((spec, n) => build(spec, n));
  const hits = built.map((b) => b.hit);
  const requests = new Map(built.map((b) => [b.request.id as string, b.request]));
  return { hits, requests, result: idHandover(hits, requests) };
}

const check = (specs: Spec[]) => {
  const { result } = run(specs);
  return result;
};

const ctxA: Spec = { main: true, host: 'localhost', cid: CID_A, sid: SID_A };
const ctxB: Spec = { main: true, host: '127.0.0.1', cid: CID_A, sid: SID_A };

describe('same IDs', () => {
  test('the same cid and sid in two contexts pass', () => {
    const { hits, requests, result } = run([ctxA, { ...ctxB, main: false }]);
    expect(new Set(hits.map((h) => `${requests.get(h.requestId)!.frame!.main} ${new URL(h.page!).host}`)).size).toBe(2);
    for (const h of hits) {
      const q = new URL(requests.get(h.requestId)!.url).searchParams;
      expect(q.get('cid')).toBe(CID_A);
      expect(q.get('sid')).toBe(SID_A);
    }
    expect(result.pass).toBe(true);
  });

  test('idHandover is a builtin name', () => {
    expect(BUILTIN_NAMES).toContain('idHandover');
  });

  test('a scenario accepts builtins: { idHandover: fail }', () => {
    const s = parseScenario('start: /\noptions: { builtins: { idHandover: fail } }');
    expect(s.options.builtins).toMatchObject({ idHandover: 'fail' });
  });
});

describe('consent of the compared hits', () => {
  const differing: Spec[] = [{ ...ctxA, gcs: 'G100' }, { ...ctxB, cid: CID_B, gcs: 'G100' }];

  test('differing cids pass when the hits are analytics-denied and warn for G111', () => {
    expect(CID_A).not.toBe(CID_B);
    expect(check(differing).pass).toBe(true);
    expect(check([{ ...differing[0]!, gcs: 'G110' }, { ...differing[1]!, gcs: 'G110' }]).pass).toBe(true);
    expect(check([{ ...differing[0]!, gcs: 'G111' }, { ...differing[1]!, gcs: 'G111' }]).pass).toBe(false);
  });

  test('a hit without consent signal is counted', () => {
    expect(check([{ ...ctxA, cid: CID_A }, { ...ctxB, cid: CID_B }]).pass).toBe(false);
  });

  test('a gcd with a denied analytics letter leaves the hit out', () => {
    const denied = '13q3q3q3q5';
    expect(check([{ ...ctxA, gcd: denied }, { ...ctxB, cid: CID_B, gcd: denied }]).pass).toBe(true);
    expect(check([{ ...ctxA, gcd: '13r3r3r3r5' }, { ...ctxB, cid: CID_B, gcd: '13r3r3r3r5' }]).pass).toBe(false);
  });
});

describe('no throw and pass when there is nothing to compare', () => {
  test('a hit without a cid next to one with a cid passes', () => {
    const { hits, requests } = run([{ ...ctxA, cid: undefined }, ctxB]);
    expect(new URL(requests.get(hits[0]!.requestId)!.url).searchParams.has('cid')).toBe(false);
    expect(() => idHandover(hits, requests)).not.toThrow();
    expect(idHandover(hits, requests).pass).toBe(true);
  });

  test('one context with differing cids passes', () => {
    const { hits, requests } = run([ctxA, { ...ctxA, cid: CID_B, path: '/plain/checkout' }]);
    expect(() => idHandover(hits, requests)).not.toThrow();
    expect(idHandover(hits, requests).pass).toBe(true);
  });

  test('an empty list and a list without GA4 hits pass', () => {
    expect(() => idHandover([], new Map())).not.toThrow();
    expect(idHandover([], new Map()).pass).toBe(true);
    const { hits, requests } = run([ctxA]);
    const other = [{ ...hits[0]!, vendor: 'meta' }];
    expect(() => idHandover(other, requests)).not.toThrow();
    expect(idHandover(other, requests).pass).toBe(true);
  });

  test('a request with no frame is left out, since its context is unknown', () => {
    const { hits, requests } = run([ctxA, { ...ctxB, cid: CID_B }]);
    expect(idHandover(hits, requests).pass).toBe(false);
    const bare = new Map([...requests].map(([id, r]) => [id, { ...r, frame: undefined }]));
    expect(idHandover(hits, bare).pass).toBe(true);
  });

  test('two ports of one host are one context', () => {
    expect(check([ctxA, { ...ctxA, cid: CID_B, port: 4000 }]).pass).toBe(true);
  });

  test('two ports of 127.0.0.1 are one context, and one host changed to localhost warns without a port', () => {
    const one: Spec = { ...ctxA, host: '127.0.0.1', port: 3000 };
    const two: Spec = { ...ctxA, host: '127.0.0.1', port: 4000, cid: CID_B };
    const { hits, requests } = run([one, two]);
    const ports = hits.map((h) => new URL(h.page!).port);
    expect(ports[0]).not.toBe(ports[1]);
    expect(one.cid).not.toBe(two.cid);
    expect(idHandover(hits, requests).pass).toBe(true);
    const changed = check([one, { ...two, host: 'localhost' }]);
    expect(changed.pass).toBe(false);
    expect(changed.message).toContain(TID);
    expect(changed.message).not.toMatch(/(localhost|127\.0\.0\.1):\d/);
  });

  test('a hit whose request is missing is skipped', () => {
    const { hits } = run([ctxA, { ...ctxB, cid: CID_B }]);
    expect(() => idHandover(hits, new Map())).not.toThrow();
    expect(idHandover(hits, new Map()).pass).toBe(true);
  });
});

test('a batched request keeps each hit with its own cid when an earlier hit is left out', () => {
  const { hits, requests } = run([{ ...ctxA, gcs: 'G100' }, { ...ctxB, cid: CID_B }]);
  const [first, second] = hits;
  const request = { ...requests.get(first!.requestId)!, method: 'POST', postData: `en=page_view&gcs=G100\nen=scroll&cid=${CID_B}&gcs=G111` };
  const batched = new Map([[request.id as string, request]]);
  const batch = [first!, { ...second!, requestId: request.id, consent: { ...second!.consent, analytics: 'granted' as const } }];
  expect(batch[1]!.requestId).toBe(batch[0]!.requestId);
  expect(idHandover(batch, batched).pass).toBe(true);
  const other = { ...hits[0]!, id: 'hit_OTHER' as Hit['id'] };
  expect(idHandover([...batch, other], batched).pass).toBe(true);
});

describe('session ID', () => {
  test('same cid with a different sid warns with the fixed label and holds no sid', () => {
    const differing = check([ctxA, { ...ctxB, sid: SID_B }]);
    expect(differing.pass).toBe(false);
    expect(differing.message).toContain('session ID differs');
    expect(differing.message).not.toContain(SID_A);
    expect(differing.message).not.toContain(SID_B);
    expect(check([ctxA, ctxB]).pass).toBe(true);
  });

  test('the sid is not compared where the cid differs', () => {
    const differing = check([ctxA, { ...ctxB, cid: CID_B, sid: SID_B }]);
    expect(differing.pass).toBe(false);
    expect(differing.message).toContain('client ID differs');
    expect(differing.message).not.toContain('session ID differs');
  });

  test('a missing sid on one side is not a difference', () => {
    expect(check([ctxA, { ...ctxB, sid: undefined }]).pass).toBe(true);
  });
});

describe('grouping and contexts', () => {
  const a: Spec = { ...ctxA };
  const b: Spec = { ...ctxA, cid: CID_B };

  test('a different measurement ID each does not warn', () => {
    expect(a.cid).not.toBe(b.cid);
    expect(check([a, { ...b, host: '127.0.0.1', tid: 'G-PWTEST0002' }]).pass).toBe(true);
  });

  test('two pages of one frame kind on one host are one context', () => {
    expect(check([a, { ...b, path: '/plain/checkout' }]).pass).toBe(true);
  });

  test('main frame versus sub frame on one host warns, naming the tid and both contexts', () => {
    const r = check([a, { ...b, main: false }]);
    expect(r.pass).toBe(false);
    expect(r.message).toContain(TID);
    expect(r.message).toContain('main frame on localhost');
    expect(r.message).toContain('sub frame on localhost');
  });

  test('one frame kind on two hosts warns', () => {
    const r = check([a, { ...b, host: '127.0.0.1' }]);
    expect(r.pass).toBe(false);
    expect(r.message).toContain(TID);
    expect(r.message).toContain('localhost');
    expect(r.message).toContain('127.0.0.1');
  });

  test('a server container hit is left out, so the pair passes', () => {
    const verdict = (specs: Spec[]) => {
      const { hits, requests } = run(specs);
      const records = [...hits, ...requests.values()];
      return evaluate(records, parseScenario('start: /')).find((r) => r.expectation === 'builtin: idHandover')!;
    };
    expect(verdict([a, { ...b, host: '127.0.0.1' }]).pass).toBe(false);
    expect(verdict([a, { ...b, host: '127.0.0.1', server: true }]).pass).toBe(true);
  });
});

describe('no ID in the result', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const make = (cidA: string, cidB: string, sidA: string, sidB: string) =>
    run([{ ...ctxA, cid: cidA, sid: sidA }, { ...ctxB, cid: cidB, sid: sidB }]);

  test('different values and lengths give the same message and evidence', () => {
    const short = make('4821907365.1730000001', '5555555555.1730000002', '1730000011', '1730000022');
    const long = make('99120384756123.1739999999888', '77700011223344.1738888888777', '1739999900011122', '1739999900033344');
    for (const r of [short, long]) expect(r.result.pass).toBe(false);
    expect(short.result.message).toBe(long.result.message);
    expect(short.result.evidence).toEqual(long.result.evidence);
    for (const r of [short, long]) {
      const ids = new Set(r.hits.map((h) => h.id as string));
      for (const e of r.result.evidence) expect(ids.has(e)).toBe(true);
    }
    const json = JSON.stringify(long.result);
    for (const fake of ['99120384756123.1739999999888', '77700011223344.1738888888777', '1739999900011122', '1739999900033344']) {
      expect(long.hits.some((h) => long.requests.get(h.requestId)!.url.includes(fake))).toBe(true);
      expect(json).not.toContain(fake);
      expect(json).not.toContain(fake.slice(0, 6));
      expect(json).not.toContain(sha(fake));
    }
  });

  test('the sid-differs variant leaks nothing either', () => {
    const one = run([ctxA, { ...ctxB, sid: '1730000022' }]);
    const two = run([{ ...ctxA, sid: '1739999900011122' }, { ...ctxB, sid: '1739999900033344' }]);
    expect(one.result.pass).toBe(false);
    expect(one.result.message).toBe(two.result.message);
    expect(one.result.evidence).toEqual(two.result.evidence);
    const json = JSON.stringify(two.result);
    for (const fake of ['1739999900011122', '1739999900033344']) {
      expect(two.hits.some((h) => two.requests.get(h.requestId)!.url.includes(`sid=${fake}`))).toBe(true);
      expect(json).not.toContain(fake);
      expect(json).not.toContain(fake.slice(0, 6));
      expect(json).not.toContain(sha(fake));
    }
  });

  test('the module reads GA4 IDs only through ga4HitIds', () => {
    const text = readFileSync(new URL('./id-handover.ts', import.meta.url), 'utf8');
    expect(text).toContain('ga4HitIds');
    expect(text).not.toMatch(/searchParams|URLSearchParams|postData/);
  });
});
