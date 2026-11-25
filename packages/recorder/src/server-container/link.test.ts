import { createIdentity, hashEmail, newId, type Hit, type Request } from '@tagreeve/core';
import { describe, expect, test } from 'vitest';
import { linkServerHits, type InFlightWindow } from './link.ts';

const identity = createIdentity(1);
const hosts = ['sgtm.example.invalid'];

function request(url: string, over: Partial<Request> = {}): Request {
  return {
    type: 'request', id: newId('request'), runId: newId('run'), stepId: null, t: 1, method: 'POST', url, resourceType: 'fetch',
    frameUrl: null, initiator: null, headers: {}, postData: null, outcome: 'passed', ...over,
  };
}

const serverRequest = (url: string, over: Partial<Request> = {}) => request(url, { captured: 'serverContainer', initiator: 'serverContainer', outcome: 'stubbed', ...over });

function hit(req: Request, vendor: string, event: string | null, t: number, params: Record<string, string> = {}): Hit {
  return {
    type: 'hit', id: newId('hit'), runId: req.runId, stepId: null, requestId: req.id, t, vendor, event,
    consent: { ads: 'unknown', analytics: 'unknown', adUserData: 'unknown', adPersonalization: 'unknown', raw: {} },
    ids: {}, page: null, transport: 'fetch', params,
  };
}

function link(pairs: Array<[Request, Hit]>, serverHosts = hosts, inFlight?: Array<[Request, InFlightWindow]>) {
  const out = linkServerHits({
    hits: pairs.map(([, h]) => h),
    requests: pairs.map(([r]) => r),
    serverHosts,
    identity,
    ...(inFlight ? { inFlight: new Map(inFlight.map(([r, w]) => [r.id, w])) } : {}),
  });
  return out.map((h) => h.via);
}

const pixelReq = request('https://www.facebook.com/tr/?id=1&ev=Purchase&eid=evt-12345678', { t: 10 });
const pixel = hit(pixelReq, 'meta', 'Purchase', 10, { eid: 'evt-12345678' });

describe('rule 1: event ID and event name', () => {
  test('both match one browser hit: exact', () => {
    const capiReq = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 50 });
    const capi = hit(capiReq, 'meta-capi', 'Purchase', 50, { eventId: 'evt-12345678' });
    expect(link([[pixelReq, pixel], [capiReq, capi]])[1]).toEqual({ hitId: pixel.id, by: 'eventId', confidence: 'exact' });
  });

  test('the same ID with another name is probable', () => {
    const capiReq = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 50 });
    const capi = hit(capiReq, 'meta-capi', 'Lead', 50, { eventId: 'evt-12345678' });
    expect(link([[pixelReq, pixel], [capiReq, capi]])[1]).toEqual({ hitId: pixel.id, by: 'eventId', confidence: 'probable' });
  });

  describe('a Pinterest call and a Pinterest tag hit', () => {
    const tagReq = request('https://ct.pinterest.com/v3/?event=addtocart', { t: 10 });
    const pin = (vendor: string, event: string, eventId: string, over: Partial<Request> = {}) => {
      const req = vendor === 'pinterest-capi' ? serverRequest('https://api.pinterest.com/v5/ad_accounts/100000000000002/events', { t: 50, ...over }) : tagReq;
      return [req, hit(req, vendor, event, req.t, { eventId })] as [Request, Hit];
    };
    const via = (browser: [Request, Hit], server: [Request, Hit]) => link([browser, server])[1];
    const exact = (hitId: string) => ({ hitId, by: 'eventId', confidence: 'exact' });

    test('names that differ in case and underscores are exact, and both events stay as sent', () => {
      const tag = pin('pinterest', 'addtocart', 'pw-pin-event-1');
      const call = pin('pinterest-capi', 'add_to_cart', 'pw-pin-event-1');
      expect(via(tag, call)).toEqual(exact(tag[1].id));
      expect(tag[1].event).toBe('addtocart');
      expect(call[1].event).toBe('add_to_cart');
    });

    test('page_visit meets pagevisit, and checkout meets checkout', () => {
      const t1 = pin('pinterest', 'pagevisit', 'pw-pin-event-2');
      expect(via(t1, pin('pinterest-capi', 'page_visit', 'pw-pin-event-2'))).toEqual(exact(t1[1].id));
      const t2 = pin('pinterest', 'checkout', 'pw-pin-event-3');
      expect(via(t2, pin('pinterest-capi', 'checkout', 'pw-pin-event-3'))).toEqual(exact(t2[1].id));
    });

    test('another event ID is not exact', () => {
      const tag = pin('pinterest', 'addtocart', 'pw-pin-event-9');
      expect(via(tag, pin('pinterest-capi', 'add_to_cart', 'pw-pin-event-1'))?.confidence).not.toBe('exact');
    });

    test('the key is for the Pinterest pair only', () => {
      const metaTag = [tagReq, hit(tagReq, 'meta', 'addtocart', 10, { eventId: 'pw-pin-event-1' })] as [Request, Hit];
      expect(via(metaTag, pin('pinterest-capi', 'add_to_cart', 'pw-pin-event-1'))?.confidence).not.toBe('exact');
      const tag = pin('pinterest', 'addtocart', 'pw-pin-event-1');
      const metaCall = [serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 50 })] as [Request];
      expect(via(tag, [metaCall[0], hit(metaCall[0], 'meta-capi', 'add_to_cart', 50, { eventId: 'pw-pin-event-1' })])?.confidence).not.toBe('exact');
      const ga = [tagReq, hit(tagReq, 'ga4', 'add_to_cart', 10, { eventId: 'pw-pin-event-1' })] as [Request, Hit];
      const gaCall = serverRequest('https://www.google-analytics.com/g/collect', { t: 50 });
      expect(via(ga, [gaCall, hit(gaCall, 'ga4', 'addtocart', 50, { eventId: 'pw-pin-event-1' })])?.confidence).not.toBe('exact');
    });
  });

  test('two browser hits with the same ID and name are not exact', () => {
    const other = hit(request('https://www.facebook.com/tr/?ev=Purchase&eid=evt-12345678', { t: 20 }), 'meta', 'Purchase', 20, { eid: 'evt-12345678' });
    const capiReq = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 50 });
    const capi = hit(capiReq, 'meta-capi', 'Purchase', 50, { eventId: 'evt-12345678' });
    const via = link([[pixelReq, pixel], [{ ...pixelReq, id: other.requestId }, other], [capiReq, capi]])[2];
    expect(via?.confidence).toBe('probable');
    expect(via?.hitId).toBe(other.id);
  });

  describe('send time', () => {
    const callReq = () => serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 1000 });
    const pix = (t: number) => {
      const r = request('https://www.facebook.com/tr/?id=1&ev=Purchase&eid=evt-12345678', { t });
      return [r, hit(r, 'meta', 'Purchase', t, { eid: 'evt-12345678' })] as const;
    };
    const run = (pixels: Array<readonly [Request, Hit]>, inFlight?: Array<[Request, InFlightWindow]>, over: Partial<Request> = {}) => {
      const req = { ...callReq(), ...over };
      const c = hit(req, 'meta-capi', 'Purchase', 1000, { eventId: 'evt-12345678' });
      expect(req.captured).toBe('serverContainer');
      expect(c.event).toBe('Purchase');
      for (const [, h] of pixels) {
        expect(h.params.eid).toBe(c.params.eventId);
        expect(h.event).toBe(c.event);
      }
      const out = linkServerHits({
        hits: [...pixels.map(([, h]) => h), c],
        requests: [...pixels.map(([r]) => r), req],
        serverHosts: hosts,
        identity,
        ...(inFlight ? { inFlight: new Map(inFlight.map(([r, w]) => [r.id, w])) } : {}),
      });
      return out[out.length - 1]!;
    };
    const isExact = (h: Hit) => h.via?.by === 'eventId' && h.via.confidence === 'exact';

    test('a pixel hit sent after the call is not an exact match', () => {
      const out = run([pix(2900)]);
      expect(isExact(out)).toBe(false);
      expect(out.linkMiss?.eventId).toBe('noMatch');
    });

    test('a pixel hit sent before the call is exact', () => {
      const p = pix(900);
      expect(run([p]).via).toEqual({ hitId: p[1].id, by: 'eventId', confidence: 'exact' });
    });

    test('a pixel hit sent at the call time is exact', () => {
      const p = pix(1000);
      expect(run([p]).via).toEqual({ hitId: p[1].id, by: 'eventId', confidence: 'exact' });
    });

    test('an unknown call time keeps the old behaviour', () => {
      const p = pix(2900);
      const over = { t: undefined as unknown as number };
      expect(over.t).toBeUndefined();
      expect(run([p], undefined, over).via).toEqual({ hitId: p[1].id, by: 'eventId', confidence: 'exact' });
    });

    test('the in-flight send time wins over the hit time', () => {
      const p = pix(900);
      expect(p[1].t).toBe(900);
      expect(run([p], [[p[0], { sentAt: 900, answeredAt: 1200 }]]).via).toEqual({ hitId: p[1].id, by: 'eventId', confidence: 'exact' });
      const late = run([p], [[p[0], { sentAt: 1100, answeredAt: 1200 }]]);
      expect(isExact(late)).toBe(false);
      expect(late.linkMiss?.eventId).toBe('noMatch');
    });

    test('the miss reason counts only hits sent before the call', () => {
      const after = run([pix(2900), pix(3000)]);
      expect(after.linkMiss?.eventId).toBe('noMatch');
      expect(isExact(after)).toBe(false);
      expect(run([pix(900), pix(950)]).linkMiss?.eventId).toBe('several');
      const early = pix(900);
      expect(run([early, pix(2900)]).via).toEqual({ hitId: early[1].id, by: 'eventId', confidence: 'exact' });
    });
  });

  test('a GA4 call with the same event ID and name is exact too', () => {
    const ga4Req = serverRequest('https://www.google-analytics.com/g/collect', { t: 50 });
    const ga4 = hit(ga4Req, 'ga4', 'Purchase', 50, { event_id: 'evt-12345678' });
    expect(link([[pixelReq, pixel], [ga4Req, ga4]])[1]?.confidence).toBe('exact');
  });

  test('a browser hit is never given a via, and a call is never exact to another call', () => {
    const a = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 40 });
    const b = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 50 });
    const hitA = hit(a, 'meta-capi', 'Purchase', 40, { eventId: 'evt-12345678' });
    const hitB = hit(b, 'meta-capi', 'Purchase', 50, { eventId: 'evt-12345678' });
    expect(link([[pixelReq, pixel], [a, hitA], [b, hitB]])).toEqual([
      undefined,
      { hitId: pixel.id, by: 'eventId', confidence: 'exact' },
      { hitId: pixel.id, by: 'eventId', confidence: 'exact' },
    ]);
  });
});

describe('rule 2: client ID and event name in flight', () => {
  const browserCall = (cid: string, t: number) => request(`https://sgtm.example.invalid/g/collect?cid=${cid}&en=Purchase`, { t });
  const serverCall = (cid: string, t: number) => serverRequest(`https://www.google-analytics.com/g/collect?cid=${cid}&en=Purchase`, { t });

  test('one browser hit in flight when the call arrived: exact by clientId', () => {
    const b = browserCall('pw-client-0001', 100);
    const bHit = hit(b, 'ga4', 'Purchase', 100);
    const c = serverCall('pw-client-0001', 150);
    const via = link([[b, bHit], [c, hit(c, 'ga4', 'Purchase', 150)]], hosts, [[b, { sentAt: 100, answeredAt: 200 }]])[1];
    expect(via).toEqual({ hitId: bHit.id, by: 'clientId', confidence: 'exact' });
  });

  const linked = (pairs: Array<[Request, Hit]>, inFlight: Array<[Request, InFlightWindow]>) =>
    linkServerHits({ hits: pairs.map(([, h]) => h), requests: pairs.map(([r]) => r), serverHosts: hosts, identity, inFlight: new Map(inFlight.map(([r, w]) => [r.id, w])) });
  const loaderCall = (query: string, t: number) =>
    request(`https://sgtm.example.invalid/pwloader?k=${encodeURIComponent(Buffer.from(`/g/collect?${query}`).toString('base64'))}`, { t });

  test('a Stape loader browser hit in flight is read for its client ID: exact by clientId, no linkMiss', () => {
    const b = loaderCall('v=2&tid=G-PWTEST0001&en=Purchase&cid=pw-client-0001', 100);
    const bHit = hit(b, 'ga4', 'Purchase', 100);
    const c = serverCall('pw-client-0001', 150);
    const out = linkServerHits({ hits: [bHit, hit(c, 'ga4', 'Purchase', 150)], requests: [b, c], serverHosts: hosts, identity, inFlight: new Map([[b.id, { sentAt: 100, answeredAt: 200 }]]) })[1];
    expect(out?.via).toEqual({ hitId: bHit.id, by: 'clientId', confidence: 'exact' });
    expect(out?.linkMiss).toBeUndefined();
  });

  test('a concurrent loader request with the same client ID is concurrentRequest', () => {
    const a = browserCall('pw-client-0001', 100);
    const other = loaderCall('v=2&tid=G-PWTEST0001&en=PageView&cid=pw-client-0001', 120);
    const c = serverCall('pw-client-0001', 150);
    const out = linked([[a, hit(a, 'ga4', 'Purchase', 100)], [other, hit(other, 'ga4', 'PageView', 120)], [c, hit(c, 'ga4', 'Purchase', 150)]], [[a, { sentAt: 100, answeredAt: 200 }]])[2];
    expect(out?.linkMiss).toEqual({ eventId: 'none', clientId: 'concurrentRequest' });
    expect(out?.via).toMatchObject({ confidence: 'probable' });
  });

  test('a loader that wraps another client ID, or cannot be decoded, still misses', () => {
    const c = serverCall('pw-client-0001', 150);
    for (const b of [loaderCall('en=Purchase&cid=pw-client-0009', 100), request('https://sgtm.example.invalid/pwloader?k=%25%25not-base64%25%25', { t: 100 })]) {
      const out = linked([[b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', 150)]], [[b, { sentAt: 100, answeredAt: 200 }]])[1];
      expect(out?.via).toBeUndefined();
      expect(out?.linkMiss).toEqual({ eventId: 'none', clientId: 'noSameKeyHit' });
    }
  });

  test('two browser hits in flight: probable, never one of them picked as exact', () => {
    const a = browserCall('pw-client-0001', 100);
    const b = browserCall('pw-client-0001', 110);
    const c = serverCall('pw-client-0001', 150);
    const windows: Array<[Request, InFlightWindow]> = [[a, { sentAt: 100, answeredAt: 200 }], [b, { sentAt: 110, answeredAt: 200 }]];
    const via = link([[a, hit(a, 'ga4', 'Purchase', 100)], [b, hit(b, 'ga4', 'Purchase', 110)], [c, hit(c, 'ga4', 'Purchase', 150)]], hosts, windows)[2];
    expect(via?.confidence).toBe('probable');
  });

  test('an earlier answered request with the same key blocks the exact link', () => {
    const a = browserCall('pw-client-0001', 100);
    const b = browserCall('pw-client-0001', 130);
    const c = serverCall('pw-client-0001', 150);
    const windows: Array<[Request, InFlightWindow]> = [[a, { sentAt: 100, answeredAt: 120 }], [b, { sentAt: 130, answeredAt: 200 }]];
    const via = link([[a, hit(a, 'ga4', 'Purchase', 100)], [b, hit(b, 'ga4', 'Purchase', 130)], [c, hit(c, 'ga4', 'Purchase', 150)]], hosts, windows)[2];
    expect(via?.confidence).toBe('probable');
  });

  test('a request with the same key sent after the call is not a candidate', () => {
    const a = browserCall('pw-client-0001', 100);
    const b = browserCall('pw-client-0001', 160);
    const c = serverCall('pw-client-0001', 150);
    const aHit = hit(a, 'ga4', 'Purchase', 100);
    const windows: Array<[Request, InFlightWindow]> = [[a, { sentAt: 100, answeredAt: 200 }], [b, { sentAt: 160, answeredAt: 250 }]];
    const via = link([[a, aHit], [b, hit(b, 'ga4', 'Purchase', 160)], [c, hit(c, 'ga4', 'Purchase', 150)]], hosts, windows)[2];
    expect(via).toEqual({ hitId: aHit.id, by: 'clientId', confidence: 'exact' });
  });

  test('an earlier request with no window still counts as a tie', () => {
    const a = browserCall('pw-client-0001', 100);
    const b = browserCall('pw-client-0001', 130);
    const c = serverCall('pw-client-0001', 150);
    const via = link([[a, hit(a, 'ga4', 'Purchase', 100)], [b, hit(b, 'ga4', 'Purchase', 130)], [c, hit(c, 'ga4', 'Purchase', 150)]], hosts, [[b, { sentAt: 130, answeredAt: 200 }]])[2];
    expect(via?.confidence).toBe('probable');
  });

  test('two lines of one event in one request: probable', () => {
    const b = browserCall('pw-client-0001', 100);
    const c = serverCall('pw-client-0001', 150);
    const via = link([[b, hit(b, 'ga4', 'Purchase', 100)], [b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', 150)]], hosts, [[b, { sentAt: 100, answeredAt: 200 }]])[2];
    expect(via?.confidence).toBe('probable');
  });

  test.each([
    ['after the answer', 200],
    ['before the request was sent', 99],
  ])('a call %s: probable', (_name, at) => {
    const b = browserCall('pw-client-0001', 100);
    const c = serverCall('pw-client-0001', at);
    const via = link([[b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', Math.max(at, 100))]], hosts, [[b, { sentAt: 100, answeredAt: 200 }]])[1];
    expect(via?.confidence).toBe('probable');
  });

  test('a request with no recorded window is probable', () => {
    const b = browserCall('pw-client-0001', 100);
    const c = serverCall('pw-client-0001', 150);
    expect(link([[b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', 150)]], hosts, [])[1]?.confidence).toBe('probable');
  });

  test('another event name never links by rule 2', () => {
    const b = browserCall('pw-client-0001', 100);
    const c = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 150, postData: JSON.stringify({ data: [{ user_data: { fbp: 'pw-client-0001' } }] }) });
    const via = link([[b, hit(b, 'ga4', 'purchase', 100)], [c, hit(c, 'meta-capi', 'Purchase', 150)]], hosts, [[b, { sentAt: 100, answeredAt: 200 }]])[1];
    expect(via).toMatchObject({ by: 'clientId', confidence: 'probable' });
  });

  test('a hit to a host outside serverHosts is not exact', () => {
    const b = request('https://www.google-analytics.com/g/collect?cid=pw-client-0001&en=Purchase', { t: 100 });
    const c = serverCall('pw-client-0001', 150);
    const via = link([[b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', 150)]], hosts, [[b, { sentAt: 100, answeredAt: 200 }]])[1];
    expect(via?.confidence).toBe('probable');
  });

  test('a different client ID is not exact', () => {
    const b = browserCall('pw-client-0001', 100);
    const c = serverCall('pw-client-0009', 150);
    expect(link([[b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', 150)]], hosts, [[b, { sentAt: 100, answeredAt: 200 }]])[1]).toBeUndefined();
  });

  test('rule 1 still wins over rule 2', () => {
    const b = browserCall('pw-client-0001', 100);
    const bHit = hit(b, 'ga4', 'Purchase', 100);
    const idReq = request('https://sgtm.example.invalid/g/collect?cid=pw-client-0001&en=Purchase', { t: 90 });
    const idHit = hit(idReq, 'ga4', 'Purchase', 90, { event_id: 'evt-12345678' });
    const c = serverCall('pw-client-0001', 150);
    const callHit = hit(c, 'ga4', 'Purchase', 150, { event_id: 'evt-12345678' });
    const via = link([[b, bHit], [idReq, idHit], [c, callHit]], hosts, [[b, { sentAt: 100, answeredAt: 200 }]])[2];
    expect(via).toEqual({ hitId: idHit.id, by: 'eventId', confidence: 'exact' });
  });
});

describe('rule 3: a shared value', () => {
  const serverHostReq = (path: string, t: number, over: Partial<Request> = {}) => request(`https://sgtm.example.invalid${path}`, { t, ...over });

  test('a client ID and event name on a request in flight link as probable, not exact', () => {
    const inFlight = serverHostReq('/g/collect?cid=pw-client-0001&en=Purchase', 100);
    const browser = hit(inFlight, 'ga4', 'Purchase', 100);
    const callReq = serverRequest('https://www.google-analytics.com/g/collect?cid=pw-client-0001&en=Purchase', { t: 110 });
    const call = hit(callReq, 'ga4', 'Purchase', 110);
    expect(link([[inFlight, browser], [callReq, call]])[1]).toEqual({ hitId: browser.id, by: 'clientId', confidence: 'probable' });
  });

  test('a client ID alone links, from the body too', () => {
    const browserReq = serverHostReq('/data', 100, { postData: JSON.stringify({ client_id: 'pw-client-0002' }) });
    const browser = hit(browserReq, 'sgtm', 'page_view', 100);
    const callReq = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 120, postData: JSON.stringify({ data: [{ user_data: { fbp: 'pw-client-0002' } }] }) });
    const call = hit(callReq, 'meta-capi', 'Lead', 120);
    expect(link([[browserReq, browser], [callReq, call]])[1]).toMatchObject({ by: 'clientId', confidence: 'probable' });
  });

  test('the latest hit to a serverHosts host wins over a later hit elsewhere', () => {
    const early = serverHostReq('/g/collect?cid=pw-client-0003', 100);
    const late = request('https://www.google-analytics.com/g/collect?cid=pw-client-0003', { t: 200 });
    const earlyHit = hit(early, 'ga4', 'a', 100);
    const lateHit = hit(late, 'ga4', 'b', 200);
    const callReq = serverRequest('https://www.google-analytics.com/g/collect?cid=pw-client-0003', { t: 300 });
    expect(link([[early, earlyHit], [late, lateHit], [callReq, hit(callReq, 'ga4', 'c', 300)]])[2]?.hitId).toBe(earlyHit.id);
  });

  test('without a serverHosts hit it takes the latest browser hit that holds the value', () => {
    const first = request('https://www.google-analytics.com/g/collect?cid=pw-client-0004', { t: 100 });
    const second = request('https://www.google-analytics.com/g/collect?cid=pw-client-0004', { t: 200 });
    const secondHit = hit(second, 'ga4', 'b', 200);
    const callReq = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 300, postData: JSON.stringify({ data: [{ user_data: { fbp: 'pw-client-0004' } }] }) });
    expect(link([[first, hit(first, 'ga4', 'a', 100)], [second, secondHit], [callReq, hit(callReq, 'meta-capi', 'x', 300)]])[2]?.hitId).toBe(secondHit.id);
  });

  test('an identity hash links a hit before the first server hit and not one after it', () => {
    const hash = hashEmail(identity.email).hex;
    const before = request('https://www.facebook.com/tr/?ud[em]=' + hash, { t: 100 });
    const after = request('https://www.facebook.com/tr/?ud[em]=' + hash, { t: 400 });
    const callReq = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 300, postData: JSON.stringify({ data: [{ user_data: { em: [hash] } }] }) });
    const call = hit(callReq, 'meta-capi', 'x', 300);
    const beforeHit = hit(before, 'meta', 'x', 100);
    expect(link([[before, beforeHit], [after, hit(after, 'meta', 'y', 400)], [callReq, call]])[2]).toEqual({ hitId: beforeHit.id, by: 'identity', confidence: 'probable' });
    expect(link([[after, hit(after, 'meta', 'y', 400)], [callReq, call]])[1]).toBeUndefined();
  });

  test('the plain email of the run identity links as well', () => {
    const browserReq = request('https://www.facebook.com/tr/', { t: 100, postData: `email=${encodeURIComponent(identity.email)}` });
    const callReq = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 300, postData: JSON.stringify({ email: identity.email }) });
    expect(link([[browserReq, hit(browserReq, 'meta', 'x', 100)], [callReq, hit(callReq, 'meta-capi', 'x', 300)]])[1]).toMatchObject({ by: 'identity' });
  });

  test('a value under 8 characters does not count', () => {
    const browserReq = request('https://www.google-analytics.com/g/collect?cid=short1', { t: 100 });
    const callReq = serverRequest('https://www.google-analytics.com/g/collect?cid=short1', { t: 300 });
    expect(link([[browserReq, hit(browserReq, 'ga4', 'a', 100)], [callReq, hit(callReq, 'ga4', 'b', 300)]])[1]).toBeUndefined();
  });

  test('no shared value gives no via', () => {
    const callReq = serverRequest('https://www.googleadservices.com/pagead/conversion/1/', { t: 300 });
    expect(link([[pixelReq, pixel], [callReq, hit(callReq, 'google-ads', 'conversion', 300)]])[1]).toBeUndefined();
  });
});

describe('linkMiss', () => {
  const browserCall = (cid: string, t: number) => request(`https://sgtm.example.invalid/g/collect?cid=${cid}&en=Purchase`, { t });
  const serverCall = (cid: string | null, t: number) => serverRequest(`https://www.google-analytics.com/g/collect?${cid ? `cid=${cid}&` : ''}en=Purchase`, { t });
  const linked = (pairs: Array<[Request, Hit]>, inFlight?: Array<[Request, InFlightWindow]>) =>
    linkServerHits({
      hits: pairs.map(([, h]) => h),
      requests: pairs.map(([r]) => r),
      serverHosts: hosts,
      identity,
      ...(inFlight ? { inFlight: new Map(inFlight.map(([r, w]) => [r.id, w])) } : {}),
    });
  const missOf = (pairs: Array<[Request, Hit]>, inFlight?: Array<[Request, InFlightWindow]>) => linked(pairs, inFlight).map((h) => h.linkMiss);

  test('an exact link by event ID has none, and a browser hit has none', () => {
    const capiReq = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 50 });
    const capi = hit(capiReq, 'meta-capi', 'Purchase', 50, { eventId: 'evt-12345678' });
    expect(missOf([[pixelReq, pixel], [capiReq, capi]])).toEqual([undefined, undefined]);
  });

  test('an exact link by client ID has none', () => {
    const b = browserCall('pw-client-0001', 100);
    const c = serverCall('pw-client-0001', 150);
    expect(missOf([[b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', 150)]], [[b, { sentAt: 100, answeredAt: 200 }]])[1]).toBeUndefined();
  });

  test('no event ID and no client ID', () => {
    const c = serverCall(null, 150);
    expect(missOf([[c, hit(c, 'ga4', 'Purchase', 150)]])[0]).toEqual({ eventId: 'none', clientId: 'noClientId' });
  });

  test('no event name is none and noClientId', () => {
    const c = serverCall('pw-client-0001', 150);
    expect(missOf([[c, hit(c, 'ga4', null, 150, { event_id: 'evt-12345678' })]])[0]).toEqual({ eventId: 'none', clientId: 'noClientId' });
  });

  test('an event ID no browser hit carries is noMatch', () => {
    const c = serverCall(null, 150);
    expect(missOf([[pixelReq, pixel], [c, hit(c, 'ga4', 'Purchase', 150, { event_id: 'other-1234567' })]])[1]).toMatchObject({ eventId: 'noMatch' });
  });

  test('an event ID two browser hits carry is several', () => {
    const other = request('https://www.facebook.com/tr/?id=1&ev=Purchase&eid=evt-12345678', { t: 20 });
    const c = serverCall(null, 150);
    const call = hit(c, 'ga4', 'Purchase', 150, { event_id: 'evt-12345678' });
    expect(missOf([[pixelReq, pixel], [other, hit(other, 'meta', 'Purchase', 20, { eid: 'evt-12345678' })], [c, call]])[2]).toMatchObject({ eventId: 'several' });
  });

  test('a client ID no browser hit shares is noSameKeyHit', () => {
    const b = browserCall('pw-client-0001', 100);
    const c = serverCall('pw-client-0002', 150);
    expect(missOf([[b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', 150)]])[1]).toEqual({ eventId: 'none', clientId: 'noSameKeyHit' });
  });

  test('two same-key hits are severalSameKeyHits', () => {
    const a = browserCall('pw-client-0001', 100);
    const b = browserCall('pw-client-0001', 110);
    const c = serverCall('pw-client-0001', 150);
    const windows: Array<[Request, InFlightWindow]> = [[a, { sentAt: 100, answeredAt: 200 }], [b, { sentAt: 110, answeredAt: 200 }]];
    expect(missOf([[a, hit(a, 'ga4', 'Purchase', 100)], [b, hit(b, 'ga4', 'Purchase', 110)], [c, hit(c, 'ga4', 'Purchase', 150)]], windows)[2]).toEqual({ eventId: 'none', clientId: 'severalSameKeyHits' });
  });

  test('with no epoch starts, one same-key hit answered before the call stays answeredBefore with its probable via', () => {
    const b = browserCall('pw-client-0001', 100);
    const c = serverCall('pw-client-0001', 250);
    const call = linked([[b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', 250)]], [[b, { sentAt: 100, answeredAt: 200 }]])[1];
    expect(call?.linkMiss).toEqual({ eventId: 'none', clientId: 'answeredBefore' });
    expect(call?.via).toMatchObject({ confidence: 'probable' });
  });

  test('another container request with the same client ID and another name sent in flight is concurrentRequest, not exact', () => {
    const a = browserCall('pw-client-0001', 100);
    const other = request('https://sgtm.example.invalid/g/collect?cid=pw-client-0001&en=PageView', { t: 120 });
    const c = serverCall('pw-client-0001', 150);
    const out = linked([[a, hit(a, 'ga4', 'Purchase', 100)], [other, hit(other, 'ga4', 'PageView', 120)], [c, hit(c, 'ga4', 'Purchase', 150)]], [[a, { sentAt: 100, answeredAt: 200 }]])[2];
    expect(out?.linkMiss).toEqual({ eventId: 'none', clientId: 'concurrentRequest' });
    expect(out?.via).toMatchObject({ confidence: 'probable' });
  });

  test('a container request with no decoded hit sent in flight is concurrentRequest', () => {
    const a = browserCall('pw-client-0001', 100);
    const silent = request('https://sgtm.example.invalid/other', { t: 120 });
    const c = serverCall('pw-client-0001', 150);
    const out = linkServerHits({
      hits: [hit(a, 'ga4', 'Purchase', 100), hit(c, 'ga4', 'Purchase', 150)],
      requests: [a, silent, c],
      serverHosts: hosts,
      identity,
      inFlight: new Map([[a.id, { sentAt: 100, answeredAt: 200 }]]),
    });
    expect(out[1]?.linkMiss).toEqual({ eventId: 'none', clientId: 'concurrentRequest' });
  });

  test('a library load from a server host sent in flight does not break the exact link', () => {
    const a = browserCall('pw-client-0001', 100);
    const load = request('https://sgtm.example.invalid/gtm.js?id=GTM-PWTEST1', { t: 120, resourceType: 'script' });
    const c = serverCall('pw-client-0001', 150);
    const out = linkServerHits({
      hits: [hit(a, 'ga4', 'Purchase', 100), hit(c, 'ga4', 'Purchase', 150)],
      requests: [a, load, c],
      serverHosts: hosts,
      identity,
      inFlight: new Map([[a.id, { sentAt: 100, answeredAt: 200 }]]),
    });
    expect(out[1]?.linkMiss).toBeUndefined();
    expect(out[1]?.via).toMatchObject({ confidence: 'exact' });
  });

  test('a container request with the same client ID and another name sent before the window does not break the exact link', () => {
    const early = request('https://sgtm.example.invalid/g/collect?cid=pw-client-0001&en=PageView', { t: 50 });
    const a = browserCall('pw-client-0001', 100);
    const c = serverCall('pw-client-0001', 150);
    const out = linkServerHits({
      hits: [hit(early, 'ga4', 'PageView', 50), hit(a, 'ga4', 'Purchase', 100), hit(c, 'ga4', 'Purchase', 150)],
      requests: [early, a, c],
      serverHosts: hosts,
      identity,
      inFlight: new Map([[a.id, { sentAt: 100, answeredAt: 200 }]]),
    });
    expect(out[2]?.linkMiss).toBeUndefined();
    expect(out[2]?.via).toMatchObject({ confidence: 'exact', by: 'clientId' });
  });

  test('an unload send with the same client ID in flight does not break the exact link', () => {
    const a = browserCall('pw-client-0001', 100);
    const beacon = request('https://sgtm.example.invalid/g/collect?cid=pw-client-0001&en=PageView', { t: 120, initiator: 'unload' });
    const c = serverCall('pw-client-0001', 150);
    const out = linkServerHits({
      hits: [hit(a, 'ga4', 'Purchase', 100), hit(c, 'ga4', 'Purchase', 150)],
      requests: [a, beacon, c],
      serverHosts: hosts,
      identity,
      inFlight: new Map([[a.id, { sentAt: 100, answeredAt: 200 }]]),
    });
    expect(out[1]?.linkMiss).toBeUndefined();
    expect(out[1]?.via).toMatchObject({ confidence: 'exact', by: 'clientId' });
  });

  test('a container request with another client ID and another name does not break the exact link', () => {
    const a = browserCall('pw-client-0001', 100);
    const other = request('https://sgtm.example.invalid/g/collect?cid=pw-client-0002&en=PageView', { t: 120 });
    const c = serverCall('pw-client-0001', 150);
    expect(missOf([[a, hit(a, 'ga4', 'Purchase', 100)], [other, hit(other, 'ga4', 'PageView', 120)], [c, hit(c, 'ga4', 'Purchase', 150)]], [[a, { sentAt: 100, answeredAt: 200 }]])[2]).toBeUndefined();
  });

  test('one same-key hit with no window is answeredBefore', () => {
    const b = browserCall('pw-client-0001', 100);
    const c = serverCall('pw-client-0001', 150);
    expect(missOf([[b, hit(b, 'ga4', 'Purchase', 100)], [c, hit(c, 'ga4', 'Purchase', 150)]])[1]).toMatchObject({ clientId: 'answeredBefore' });
  });

  test('the reason holds no ID or value', () => {
    const c = serverCall('pw-client-0001', 150);
    const h = hit(c, 'ga4', 'Purchase', 150, { event_id: 'evt-12345678' });
    expect(JSON.stringify([c, h])).toContain('pw-client-0001');
    expect(JSON.stringify([c, h])).toContain('evt-12345678');
    const miss = missOf([[c, h]]);
    expect(miss).toBeDefined();
    const text = JSON.stringify(miss);
    expect(text).not.toContain('pw-client');
    expect(text).not.toContain('evt-');
  });
});

describe('rule 1: a later browser hit in the same consent epoch', () => {
  const pix = (t: number) => {
    const r = request('https://www.facebook.com/tr/?id=1&ev=Purchase&eid=evt-12345678', { t, method: 'GET' });
    return [r, hit(r, 'meta', 'Purchase', t, { eid: 'evt-12345678' })] as const;
  };
  const run = (pixels: Array<readonly [Request, Hit]>, epochStarts?: number[]) => {
    const req = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 1000 });
    const c = hit(req, 'meta-capi', 'Purchase', 1000, { eventId: 'evt-12345678' });
    expect(req.t).toBe(1000);
    for (const [, h] of pixels) {
      expect(h.params.eid).toBe(c.params.eventId);
      expect(h.event).toBe(c.event);
    }
    const out = linkServerHits({
      hits: [...pixels.map(([, h]) => h), c],
      requests: [...pixels.map(([r]) => r), req],
      serverHosts: hosts,
      identity,
      ...(epochStarts ? { epochStarts } : {}),
    });
    return out[out.length - 1]!;
  };
  const isExact = (h: Hit) => h.via?.by === 'eventId' && h.via.confidence === 'exact';

  test('(a) a hit 900 ms after the call, in the same epoch, links exact', () => {
    const p = pix(1900);
    expect(p[1].t).toBe(1900);
    const epochStarts = [0];
    expect(run([p], epochStarts).via).toEqual({ hitId: p[1].id, by: 'eventId', confidence: 'exact' });
  });

  test('(b) an epoch starting between the call and the hit blocks the link', () => {
    const p = pix(1900);
    const epochStarts = [0, 1500];
    expect(p[1].t).toBe(1900);
    expect(epochStarts).toContain(1500);
    const out = run([p], epochStarts);
    expect(isExact(out)).toBe(false);
    expect(out.linkMiss?.eventId).toBe('noMatch');
  });

  test('(c) a hit 6000 ms after the call does not link', () => {
    const p = pix(7000);
    expect(p[1].t).toBe(7000);
    const epochStarts = [0];
    const out = run([p], epochStarts);
    expect(isExact(out)).toBe(false);
    expect(out.linkMiss?.eventId).toBe('noMatch');
  });

  test('(d) one hit before and one after in the same epoch give several', () => {
    const epochStarts = [0];
    const out = run([pix(900), pix(1900)], epochStarts);
    expect(isExact(out)).toBe(false);
    expect(out.linkMiss?.eventId).toBe('several');
  });

  test('(e) without epoch starts a later hit does not link', () => {
    const p = pix(1900);
    expect(p[1].t).toBe(1900);
    const out = run([p]);
    expect(isExact(out)).toBe(false);
    expect(out.linkMiss?.eventId).toBe('noMatch');
  });

  test('a later hit with an event ID shorter than 8 characters does not link', () => {
    const id = 'evt1234';
    const r = request(`https://www.facebook.com/tr/?id=1&ev=Purchase&eid=${id}`, { t: 1900, method: 'GET' });
    const h = hit(r, 'meta', 'Purchase', 1900, { eid: id });
    const req = serverRequest('https://graph.facebook.com/v21.0/1/events', { t: 1000 });
    const c = hit(req, 'meta-capi', 'Purchase', 1000, { eventId: id });
    expect(id.length).toBeLessThan(8);
    const epochStarts = [0];
    const out = linkServerHits({ hits: [h, c], requests: [r, req], serverHosts: hosts, identity, epochStarts })[1]!;
    expect(isExact(out)).toBe(false);
    expect(out.linkMiss?.eventId).toBe('noMatch');
  });
});

describe('rule 2: a call after the answer', () => {
  const SGTM = 'https://sgtm.example.invalid/g/collect';
  const callUrl = (cid: string, en: string) => `https://www.google-analytics.com/g/collect?cid=${cid}&en=${en}`;
  interface Opts {
    callAt?: number;
    cid?: string;
    en?: string;
    host?: string;
    window?: InFlightWindow | null;
    epochStarts?: number[] | null;
    extra?: Array<{ url: string; t: number; hit?: string; initiator?: 'unload' }>;
    second?: boolean;
  }
  function setup(o: Opts = {}) {
    const b = request(`${o.host ?? 'https://sgtm.example.invalid'}/g/collect?cid=pw-client-0001&en=Purchase`, { t: 100 });
    const c = serverRequest(callUrl(o.cid ?? 'pw-client-0001', o.en ?? 'Purchase'), { t: o.callAt ?? 500 });
    const hits = [hit(b, 'ga4', 'Purchase', 100)];
    const requests = [b];
    const windows: Array<[string, InFlightWindow]> = [];
    const w = o.window === undefined ? { sentAt: 100, answeredAt: 200 } : o.window;
    if (w) windows.push([b.id, w]);
    if (o.second) {
      const b2 = request(`${SGTM}?cid=pw-client-0001&en=Purchase`, { t: 120 });
      hits.push(hit(b2, 'ga4', 'Purchase', 120));
      requests.push(b2);
      windows.push([b2.id, { sentAt: 120, answeredAt: 220 }]);
    }
    for (const x of o.extra ?? []) {
      const r = request(x.url, { t: x.t, ...(x.initiator ? { initiator: x.initiator } : {}) });
      requests.push(r);
      if (x.hit) hits.push(hit(r, 'ga4', x.hit, x.t));
      windows.push([r.id, { sentAt: x.t, answeredAt: x.t + 10 }]);
    }
    const call = hit(c, 'ga4', o.en ?? 'Purchase', c.t);
    const out = linkServerHits({
      hits: [...hits, call],
      requests: [...requests, c],
      serverHosts: hosts,
      identity,
      inFlight: new Map(windows),
      ...(o.epochStarts === null ? {} : { epochStarts: o.epochStarts ?? [50] }),
    });
    return { call: out[out.length - 1]!, b: out[0]!, w: w ?? null, callAt: c.t };
  }
  const exact = (b: Hit) => ({ hitId: b.id, by: 'clientId', confidence: 'exact' });
  const miss = (clientId: string) => ({ eventId: 'none', clientId });

  test('a call 300 ms after the answer is exact by client ID', () => {
    const r = setup();
    expect(r.callAt - r.w!.answeredAt).toBe(300);
    expect(r.call.via).toEqual(exact(r.b));
    expect(r.call.linkMiss).toBeUndefined();
  });

  test('2000 ms after the answer is exact, 2001 ms is answeredBefore', () => {
    const a = setup({ callAt: 2200 });
    expect(a.callAt - a.w!.answeredAt).toBe(2000);
    expect(a.call.via).toEqual(exact(a.b));
    expect(a.call.linkMiss).toBeUndefined();
    const late = setup({ callAt: 2201 });
    expect(late.callAt - late.w!.answeredAt).toBe(2001);
    expect(late.call.linkMiss).toEqual(miss('answeredBefore'));
    expect(late.call.via?.confidence).toBe('probable');
  });

  test('the window runs from the answer, not the send', () => {
    const r = setup({ window: { sentAt: 100, answeredAt: 1500 }, callAt: 3400 });
    expect(r.callAt - r.w!.answeredAt).toBe(1900);
    expect(r.callAt - r.w!.sentAt).toBeGreaterThan(2000);
    expect(r.call.via).toEqual(exact(r.b));
  });

  test('two same-key hits are severalSameKeyHits', () => {
    const r = setup({ second: true });
    expect(r.callAt).toBeGreaterThan(220);
    expect(r.w!.answeredAt).toBeLessThan(r.callAt);
    expect(r.call.linkMiss).toEqual(miss('severalSameKeyHits'));
    expect(r.call.via?.confidence).not.toBe('exact');
  });

  test('a hit with no window stays answeredBefore, with epoch starts too', () => {
    const r = setup({ window: null });
    expect(r.w).toBeNull();
    expect(r.call.linkMiss).toEqual(miss('answeredBefore'));
  });

  test('another client ID, another event or another host does not link', () => {
    const cid = setup({ cid: 'pw-client-0002' });
    expect(new URL(callUrl('pw-client-0002', 'Purchase')).searchParams.get('cid')).not.toBe('pw-client-0001');
    expect(cid.call.linkMiss).toEqual(miss('noSameKeyHit'));
    expect(cid.call.via?.confidence).not.toBe('exact');
    const en = setup({ en: 'PageView' });
    expect('PageView').not.toBe('Purchase');
    expect(en.call.linkMiss?.clientId).toBe('noSameKeyHit');
    expect(en.call.via?.confidence).not.toBe('exact');
    const host = setup({ host: 'https://other.example.invalid' });
    expect(hosts).not.toContain('other.example.invalid');
    expect(host.call.via?.confidence).not.toBe('exact');
  });

  describe('a request in between', () => {
    const same = (t: number, over: Partial<NonNullable<Opts['extra']>[number]> = {}) => ({ url: `${SGTM}?cid=pw-client-0001&en=PageView`, t, hit: 'PageView', ...over });
    test.each([150, 300])('a same-ID request at %i is concurrentRequest', (t) => {
      const r = setup({ extra: [same(t)] });
      expect(t).toBeGreaterThan(r.w!.sentAt);
      expect(t).toBeLessThan(r.callAt);
      expect(same(t).url).toContain('cid=pw-client-0001');
      expect(r.call.linkMiss).toEqual(miss('concurrentRequest'));
      expect(r.call.via?.confidence).toBe('probable');
    });
    test('a request with no decoded hit is concurrentRequest', () => {
      const r = setup({ extra: [{ url: 'https://sgtm.example.invalid/other', t: 300 }] });
      expect(300).toBeGreaterThan(r.w!.sentAt);
      expect(300).toBeLessThan(r.callAt);
      expect(r.call.linkMiss).toEqual(miss('concurrentRequest'));
    });
    test('another client ID does not block', () => {
      const other = same(300, { url: `${SGTM}?cid=pw-client-0002&en=PageView` });
      expect(other.url).not.toContain('cid=pw-client-0001');
      const r = setup({ extra: [other] });
      expect(r.call.via).toEqual(exact(r.b));
    });
    test.each([50, 600])('a same-ID request at %i does not block', (t) => {
      const r = setup({ extra: [same(t)] });
      expect(t < r.w!.sentAt || t > r.callAt).toBe(true);
      expect(r.call.via).toEqual(exact(r.b));
    });
    test('an unload send does not block', () => {
      const x = same(300, { initiator: 'unload' });
      expect(x.initiator).toBe('unload');
      const r = setup({ extra: [x] });
      expect(r.call.via).toEqual(exact(r.b));
    });
    test('concurrentRequest wins over a late call and over an epoch start', () => {
      expect(setup({ callAt: 2700, extra: [same(300)] }).call.linkMiss).toEqual(miss('concurrentRequest'));
      expect(setup({ epochStarts: [250], extra: [same(300)] }).call.linkMiss).toEqual(miss('concurrentRequest'));
    });
  });

  describe('epoch starts', () => {
    test.each([
      [[300], 'answeredBefore'],
      [[500], 'answeredBefore'],
      [[100], 'exact'],
      [[50], 'exact'],
      [[600], 'exact'],
      [null, 'answeredBefore'],
    ] as const)('epochStarts %j gives %s', (starts, want) => {
      const r = setup({ epochStarts: starts === null ? null : [...starts] });
      for (const t of starts ?? []) {
        const inSpan = t > r.w!.sentAt && t <= r.callAt;
        expect(inSpan).toBe(want === 'answeredBefore');
      }
      if (want === 'exact') {
        expect(r.call.via).toEqual(exact(r.b));
        expect(r.call.linkMiss).toBeUndefined();
      } else {
        expect(r.call.linkMiss).toEqual(miss('answeredBefore'));
        expect(r.call.via?.confidence).toBe('probable');
      }
    });
  });
});
