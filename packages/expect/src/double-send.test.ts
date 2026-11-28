import { newId, type DataLayerEvent, type Hit, type Request, type RequestFrame } from '@tagreeve/core';
import { ga4HitIds } from '@tagreeve/decoders';
import { describe, expect, test } from 'vitest';
import { evaluate } from './evaluate.ts';
import { parseScenario } from './scenario.ts';

const runId = newId('run');
const TID = 'G-PWTEST0001';
const PIXEL = '100000000000001';
const CID = '555000111.1700000001';
const TXN = 'PWLEAK-D100-TXN';
const NAME = 'builtin: doubleSend';

const MAIN: RequestFrame = { main: true, n: 0, page: 1 };
const SUB: RequestFrame = { main: false, n: 1, page: 1 };
const SUB2: RequestFrame = { main: false, n: 2, page: 1 };

interface Sent {
  hit: Hit;
  req: Request;
}

function request(t: number, over: Partial<Request> = {}): Request {
  return {
    type: 'request', id: newId('request'), runId, stepId: null, t, method: 'GET', url: 'https://www.google-analytics.com/g/collect', resourceType: 'image',
    frameUrl: null, initiator: null, headers: {}, postData: null, outcome: 'passed', frame: MAIN, ...over,
  };
}

const consent = { analytics: 'unknown', ads: 'unknown', adUserData: 'unknown', adPersonalization: 'unknown', raw: {} } as Hit['consent'];

function ga4(t: number, frame: RequestFrame | undefined, over: Partial<Hit> & { cid?: string | null; reqOver?: Partial<Request> } = {}): Sent {
  const { cid = CID, event = 'purchase', reqOver = {}, ...hitOver } = over;
  const url = `https://www.google-analytics.com/g/collect?v=2&tid=${TID}${cid ? `&cid=${cid}` : ''}&en=${event}&ep.transaction_id=${TXN}`;
  const req = request(t, { url, ...reqOver });
  if (frame) req.frame = frame;
  else delete req.frame;
  const hit: Hit = {
    type: 'hit', id: newId('hit'), runId, stepId: null, requestId: req.id, t, vendor: 'ga4', event, consent, ids: {}, page: 'http://localhost:3000/',
    transport: 'image', params: { tid: TID, transaction_id: TXN }, fields: [], idFields: [], fieldsComplete: true, ...hitOver,
  };
  return { hit, req };
}

function meta(t: number, frame: RequestFrame, params: Record<string, string> = { pixelId: PIXEL, value: '10' }): Sent {
  const req = request(t, { url: 'https://www.facebook.com/tr/?id=x', frame });
  const hit: Hit = { ...ga4(t, frame).hit, requestId: req.id, vendor: 'meta', event: 'Purchase', params };
  return { hit, req };
}

function push(t: number, args: unknown[], frame: RequestFrame = MAIN): DataLayerEvent {
  return { type: 'dataLayerEvent', id: newId('dataLayerEvent'), runId, stepId: null, t, event: null, gtmUniqueEventId: null, args, isConsentCommand: false, frame: { main: frame.main, n: frame.n } };
}

const doc = (t: number, frame: RequestFrame = MAIN): Request => request(t, { url: 'http://localhost:3000/', resourceType: 'document', frame });

type Records = Parameters<typeof evaluate>[0];
const run = (records: unknown[], yaml = 'start: /') => evaluate(records as Records, parseScenario(yaml));
const results = (records: unknown[], yaml?: string) => run(records, yaml).filter((r) => r.expectation === NAME);
const failing = (records: unknown[]) => results(records).filter((r) => !r.pass);

function pair(over: { b?: Parameters<typeof ga4>[2]; frameB?: RequestFrame; gap?: number } = {}) {
  const a = ga4(1000, MAIN);
  const b = ga4(1000 + (over.gap ?? 400), over.frameB ?? SUB, over.b);
  return { a, b, records: [a.req, a.hit, b.req, b.hit] };
}

describe('two frames', () => {
  test('a pair from the main frame and a sub frame warns with the vendor, tag, event, count and frames', () => {
    const { a, b, records } = pair();
    expect(ga4HitIds(a.req)[0]!.cid).toBe(CID);
    expect(ga4HitIds(b.req)[0]!.cid).toBe(CID);
    const r = results(records);
    expect(r).toHaveLength(1);
    expect(r[0]!.pass).toBe(false);
    expect(r[0]!.severity).toBe('warn');
    for (const text of ['ga4', TID, 'purchase', '2', 'main frame and sub frame']) expect(r[0]!.message).toContain(text);
    expect(r[0]!.evidence).toEqual([a.hit.id, b.hit.id]);
  });

  test('a document request of the sub frame between the hits does not hide the pair', () => {
    const { a, b } = pair();
    const between = doc(1200, SUB);
    expect(between.t).toBeGreaterThan(a.hit.t);
    expect(between.t).toBeLessThan(b.hit.t);
    const r = failing([a.req, a.hit, between, b.req, b.hit]);
    expect(r).toHaveLength(1);
    expect(r[0]!.evidence).toEqual([a.hit.id, b.hit.id]);
  });

  test('a Shopify checkout_completed and a GA4 purchase count as one event', () => {
    const { a, b, records } = pair({ b: { event: 'checkout_completed' } });
    expect([a.hit.event, b.hit.event]).toEqual(['purchase', 'checkout_completed']);
    expect(failing(records)).toHaveLength(1);
  });

  test('purchase and add_to_cart do not', () => {
    const { a, b, records } = pair({ b: { event: 'add_to_cart' } });
    expect([a.hit.event, b.hit.event]).toEqual(['purchase', 'add_to_cart']);
    expect(failing(records)).toHaveLength(0);
  });

  test('a sub frame on another page is not paired, and a sub frame with no page is', () => {
    const popup = pair({ frameB: { ...SUB, page: 2 } });
    expect([popup.a.req.frame!.page, popup.b.req.frame!.page]).toEqual([1, 2]);
    expect(failing(popup.records)).toHaveLength(0);
    const none = pair({ frameB: { main: false, n: 1 } });
    expect(none.b.req.frame!.page).toBeUndefined();
    const r = failing(none.records);
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toContain('main frame and sub frame');
  });

  test('two different sub frames of one document are paired', () => {
    const a = ga4(1000, SUB);
    const b = ga4(1400, SUB2);
    expect(a.req.frame!.n).not.toBe(b.req.frame!.n);
    const r = failing([doc(100), a.req, a.hit, doc(1100, SUB2), b.req, b.hit]);
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toContain('sub frame');
  });

  test('two different sub frames of different navigations are not paired', () => {
    const a = ga4(1000, SUB);
    const b = ga4(1400, SUB2);
    const load = doc(1200, MAIN);
    expect(load.t > a.hit.t && load.t < b.hit.t).toBe(true);
    expect(failing([a.req, a.hit, load, b.req, b.hit])).toHaveLength(0);
  });
});

describe('not a double send', () => {
  test('another client ID has no result', () => {
    const { a, b, records } = pair({ b: { cid: '555000999.1700000002' } });
    expect(ga4HitIds(a.req)[0]!.cid).not.toBe(ga4HitIds(b.req)[0]!.cid);
    expect(results(records)).toHaveLength(0);
  });

  test('a page load between the hits has no result', () => {
    const { a, b } = pair();
    const load = doc(1200, MAIN);
    expect(load.t).toBeGreaterThan(a.hit.t);
    expect(load.t).toBeLessThan(b.hit.t);
    expect(results([a.req, a.hit, load, b.req, b.hit])).toHaveLength(0);
  });

  test('one param different passes', () => {
    const { a, b, records } = pair({ b: { params: { tid: TID, transaction_id: 'other' } } });
    expect(a.hit.params).not.toEqual(b.hit.params);
    const r = results(records);
    expect(r).toHaveLength(1);
    expect(r[0]!.pass).toBe(true);
    expect(r[0]!.evidence).toEqual([]);
  });

  test('a gap of 1001 ms passes and 1000 ms warns', () => {
    const late = pair({ gap: 1001 });
    expect(late.b.hit.t - late.a.hit.t).toBe(1001);
    expect(results(late.records)[0]!.pass).toBe(true);
    expect(failing(pair({ gap: 1000 }).records)).toHaveLength(1);
  });

  test('another tid has no result', () => {
    const { a, b, records } = pair({ b: { params: { tid: 'G-PWTEST0002', transaction_id: TXN } } });
    expect(a.hit.params.tid).not.toBe(b.hit.params.tid);
    expect(results(records)).toHaveLength(0);
  });

  test('a google-ads trio for one event has no result', () => {
    const records = ['/pagead/viewthroughconversion/000000001/', '/rmkt/collect/000000001/', '/ccm/collect'].flatMap((p, i) => {
      const req = request(1000 + i * 5, { url: `https://www.google.com${p}?label=x` });
      const hit: Hit = { ...ga4(1000 + i * 5, MAIN).hit, requestId: req.id, vendor: 'google-ads', event: 'conversion', params: { conversionId: '000000001', label: 'x' } };
      return [req, hit];
    });
    expect(records.filter((r) => (r as Hit).vendor === 'google-ads')).toHaveLength(3);
    expect(results(records)).toHaveLength(0);
  });

  test('a server container hit that equals a browser hit is never compared', () => {
    const a = ga4(1000, MAIN);
    const server = ga4(1300, MAIN, { reqOver: { captured: 'serverContainer' } });
    expect(server.req.captured).toBe('serverContainer');
    expect(server.hit.params).toEqual(a.hit.params);
    expect(results([a.req, a.hit, server.req, server.hit])).toHaveLength(0);
  });

  test('two ga4 hits with params {tid} and two client IDs have no result', () => {
    const a = ga4(1000, MAIN, { event: 'page_view', params: { tid: TID } });
    const b = ga4(1200, SUB, { event: 'page_view', params: { tid: TID }, cid: '555000999.1700000002' });
    expect(ga4HitIds(a.req)[0]!.cid).not.toBe(ga4HitIds(b.req)[0]!.cid);
    expect(results([a.req, a.hit, b.req, b.hit])).toHaveLength(0);
  });

  test('a hit with no readable client ID is not compared', () => {
    const { a, b, records } = pair({ b: { cid: null } });
    const noCids = [ga4(1000, MAIN, { cid: null }), ga4(1400, SUB, { cid: null })];
    expect(ga4HitIds(a.req)[0]!.cid).toBe(CID);
    expect(ga4HitIds(b.req)[0]!.cid).toBeUndefined();
    expect(results(records)).toHaveLength(0);
    for (const s of noCids) expect(ga4HitIds(s.req)[0]!.cid).toBeUndefined();
    expect(results(noCids.flatMap((s) => [s.req, s.hit]))).toHaveLength(0);
  });
});

describe('vendor and tag key', () => {
  test('a meta pair with a pixelId names the pixel ID', () => {
    const a = meta(1000, MAIN);
    const b = meta(1400, SUB);
    const r = failing([a.req, a.hit, b.req, b.hit]);
    expect(r).toHaveLength(1);
    for (const text of ['meta', PIXEL, 'Purchase']) expect(r[0]!.message).toContain(text);
  });

  test('a meta pair with no pixelId names the vendor alone', () => {
    const a = meta(1000, MAIN, { value: '10' });
    const b = meta(1400, SUB, { value: '10' });
    expect(a.hit.params.pixelId).toBeUndefined();
    expect(b.hit.params.pixelId).toBeUndefined();
    const r = failing([a.req, a.hit, b.req, b.hit]);
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toContain('meta');
    expect(r[0]!.message).toContain('Purchase');
    for (const text of [PIXEL, 'undefined', 'null']) expect(r[0]!.message).not.toContain(text);
  });

  test('the pair with only the vendor changed to google-ads is not counted', () => {
    const { a, b, records } = pair();
    a.hit.vendor = 'google-ads';
    b.hit.vendor = 'google-ads';
    expect([a.hit.vendor, b.hit.vendor]).toEqual(['google-ads', 'google-ads']);
    expect(results(records)).toHaveLength(0);
  });
});

describe('one frame', () => {
  const same = () => {
    const a = ga4(1000, MAIN);
    const b = ga4(1300, MAIN);
    return { a, b, base: [a.req, a.hit, b.req, b.hit] };
  };
  const purchase = (t: number, extra: Record<string, unknown> = {}) => push(t, [{ event: 'purchase', ecommerce: { value: '10' }, ...extra }]);

  test('two equal hits from the main frame and no push are twice from the main frame', () => {
    const { a, b, base } = same();
    const r = failing(base);
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toContain('twice from the main frame');
    expect(r[0]!.message).toContain('one push or none was recorded');
    expect(r[0]!.evidence).toEqual([a.hit.id, b.hit.id]);
    expect(failing([...base, purchase(900)])[0]!.message).toContain('one push or none was recorded');
  });

  test('two deep-equal pushes say the event was also pushed twice', () => {
    const { base } = same();
    expect(failing([...base, purchase(950), purchase(1000)])[0]!.message).toContain('the event was also pushed twice');
  });

  test('two pushes that differ in one value say different contents and print no value', () => {
    const { base } = same();
    const pushes = [push(950, [{ event: 'purchase', ecommerce: { value: 'SECRET-A' } }]), push(1000, [{ event: 'purchase', ecommerce: { value: 'SECRET-B' } }])];
    const r = failing([...base, ...pushes]);
    expect(r[0]!.message).toContain('the event was pushed 2 times with different contents');
    expect(r[0]!.message).not.toContain('SECRET');
  });

  test.each([
    ['the array form', (v: string) => [['event', 'purchase', { v }]]],
    ['the gtag arguments form', (v: string) => ['event', 'purchase', { v }]],
    ['the arguments-like object form', (v: string) => [{ 0: 'event', 1: 'purchase', 2: { v } }]],
    ['the GTM form', (v: string) => [{ event: 'purchase', v }]],
  ])('a push in %s is matched by its event name', (_name, make) => {
    const { base } = same();
    expect(failing([...base, push(950, make('x')), push(1000, make('x'))])[0]!.message).toContain('the event was also pushed twice');
  });

  test('a push whose name cannot be read is not matched', () => {
    const { base } = same();
    const pushes = [push(950, [{ event: 7 }]), push(1000, [['event']])];
    expect(pushes).toHaveLength(2);
    const message = failing([...base, ...pushes])[0]!.message;
    expect(message).toContain('one push or none was recorded');
    expect(message).not.toContain('pushed twice');
    expect(message).not.toContain('pushed 2 times');
  });

  test('hits that differ in one param are not reported', () => {
    const a = ga4(1000, MAIN);
    const b = ga4(1300, MAIN, { params: { tid: TID, transaction_id: 'x' } });
    expect(failing([a.req, a.hit, b.req, b.hit])).toHaveLength(0);
  });

  test('pushes of page 1 do not count for a pair on page 2', () => {
    const page2: RequestFrame = { main: true, n: 3, page: 2 };
    const a = ga4(1000, page2);
    const b = ga4(1300, page2);
    const pushes = [purchase(950), purchase(960), push(1000, [{ event: 'purchase', ecommerce: { value: '10' } }], page2)];
    expect(pushes[0]!.frame!.n).not.toBe(page2.n);
    expect(failing([a.req, a.hit, b.req, b.hit, ...pushes])[0]!.message).toContain('one push or none was recorded');
  });

  test('a batched request that holds the event twice with two equal pushes is reported', () => {
    const line = `en=purchase&cid=${CID}&ep.transaction_id=${TXN}`;
    const a = ga4(1000, MAIN, { reqOver: { method: 'POST', url: `https://www.google-analytics.com/g/collect?v=2&tid=${TID}`, postData: `${line}\n${line}` } });
    const b: Hit = { ...a.hit, id: newId('hit') };
    expect(ga4HitIds(a.req)).toHaveLength(2);
    const r = failing([a.req, a.hit, b, purchase(950), purchase(1000)]);
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toContain('twice from the main frame');
    expect(r[0]!.message).toContain('the event was also pushed twice');
  });

  test('gtm stamps and functions are dropped before the comparison', () => {
    const { base } = same();
    const stamped = [purchase(950, { 'gtm.uniqueEventId': 7 }), purchase(1000, { 'gtm.uniqueEventId': 8 })];
    expect((stamped[0]!.args[0] as Record<string, unknown>)['gtm.uniqueEventId']).not.toBe((stamped[1]!.args[0] as Record<string, unknown>)['gtm.uniqueEventId']);
    const m1 = failing([...base, ...stamped])[0]!.message;
    expect(m1).toContain('the event was also pushed twice');
    expect(m1).not.toContain('with different contents');
    const fns = [purchase(950, { eventCallback: () => 1 }), purchase(1000, { eventCallback: () => 2 })];
    expect((fns[0]!.args[0] as Record<string, unknown>).eventCallback).not.toBe((fns[1]!.args[0] as Record<string, unknown>).eventCallback);
    expect(failing([...base, ...fns])[0]!.message).toContain('the event was also pushed twice');
  });

  test('the deep-equal message takes precedence over different contents', () => {
    const { base } = same();
    const pushes = [purchase(950), purchase(1000), push(1100, [{ event: 'purchase', ecommerce: { value: '99' } }])];
    const m = failing([...base, ...pushes])[0]!.message;
    expect(m).toContain('the event was also pushed twice');
    expect(m).not.toContain('with different contents');
  });

  test('pushes count only up to 1000 ms from the first hit and inside the document', () => {
    const { a, base } = same();
    const load = doc(-1000);
    const olds = [purchase(a.hit.t - 1500), purchase(a.hit.t - 1400)];
    expect(olds.every((p) => p.t > load.t && p.t < a.hit.t)).toBe(true);
    expect(failing([load, ...base, ...olds])[0]!.message).toContain('one push or none was recorded');
    const near = [purchase(a.hit.t - 600), purchase(a.hit.t - 500)];
    expect(failing([load, ...base, ...near])[0]!.message).toContain('the event was also pushed twice');
    const between = doc(a.hit.t - 550);
    expect(failing([load, between, ...base, ...near])[0]!.message).toContain('one push or none was recorded');
  });
});

describe('what is printed', () => {
  test('a planted transaction ID and client ID appear in no message or evidence, and no param name', () => {
    const a = ga4(1000, MAIN);
    const b = ga4(1400, SUB);
    const pushes = [push(950, [{ event: 'purchase', ecommerce: { transaction_id: TXN } }]), push(1000, [{ event: 'purchase', ecommerce: { transaction_id: TXN } }])];
    expect(a.req.url).toContain(CID);
    expect(a.hit.params.transaction_id).toBe(TXN);
    expect(JSON.stringify(pushes)).toContain(TXN);
    const [r] = failing([a.req, a.hit, b.req, b.hit, ...pushes]);
    const text = `${r!.message}${JSON.stringify(r!.evidence)}`;
    for (const v of [TXN, CID, '555000111', 'transaction_id', 'ep.transaction_id', 'ecommerce.transaction_id']) expect(text).not.toContain(v);
  });

  test('a value-like event name prints as (other)', () => {
    const name = 'jane.doe@example.test';
    const a = ga4(1000, MAIN, { event: name });
    const b = ga4(1400, SUB, { event: name });
    const [r] = failing([a.req, a.hit, b.req, b.hit]);
    expect(r!.message).toContain('(other)');
    expect(r!.message).not.toContain(name);
  });
});

describe('the scenario', () => {
  test('accepts doubleSend fail and refuses another severity', () => {
    expect(parseScenario('start: /\noptions:\n  builtins: { doubleSend: fail }').options.builtins).toEqual({ doubleSend: 'fail' });
    expect(() => parseScenario('start: /\noptions:\n  builtins: { doubleSend: maybe }')).toThrow('options.builtins.doubleSend: must be fail or warn');
  });

  test('fail makes the result a failure', () => {
    const { records } = pair();
    expect(results(records, 'start: /\noptions:\n  builtins: { doubleSend: fail }')[0]!.severity).toBe('fail');
  });
});
