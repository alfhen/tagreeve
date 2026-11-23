import { createIdentity, newId, type Flag, type Hit, type HitConsent, type Request, type Run } from '@tagreeve/core';
import { evaluate, parseScenario, type EvalEpoch } from '@tagreeve/expect';
import { expect, test } from 'vitest';
import { linkServerHits } from './link.ts';

const runId = newId('run');
const state = (v: 'granted' | 'denied' | 'unknown'): HitConsent => ({ analytics: v, ads: v, adUserData: v, adPersonalization: v, raw: {} });
const epoch = (startT: number, label: EvalEpoch['label'], st: HitConsent): EvalEpoch => ({ type: 'consentEpoch', id: newId('consentEpoch'), runId, startT, endT: null, source: 'test', label, state: st });

function request(url: string, t: number, over: Partial<Request> = {}): Request {
  return { type: 'request', id: newId('request'), runId, stepId: null, t, method: 'POST', url, resourceType: 'fetch', frameUrl: null, initiator: null, headers: {}, postData: null, outcome: 'passed', ...over };
}

function hit(req: Request, vendor: string, params: Record<string, string>): Hit {
  return { type: 'hit', id: newId('hit'), runId, stepId: null, requestId: req.id, t: req.t, vendor, event: 'Purchase', consent: state('unknown'), ids: {}, page: null, transport: 'fetch', params, fields: [], idFields: [], fieldsComplete: true };
}

test('a call made while consent was granted links to the hit sent before it, and identifierRoute passes', () => {
  const callReq = request('https://graph.facebook.com/v21.0/1/events', 1000, { captured: 'serverContainer', initiator: 'serverContainer', outcome: 'stubbed' });
  const call = hit(callReq, 'meta-capi', { eventId: 'evt-12345678' });
  const earlyReq = request('https://www.facebook.com/tr/?ev=Purchase&eid=evt-12345678', 900, { method: 'GET', resourceType: 'image' });
  const lateReq = request('https://www.facebook.com/tr/?ev=Purchase&eid=evt-12345678', 2900, { method: 'GET', resourceType: 'image' });
  const early = hit(earlyReq, 'meta', { eid: 'evt-12345678' });
  const late = hit(lateReq, 'meta', { eid: 'evt-12345678' });
  expect(callReq.captured).toBe('serverContainer');
  expect(early.params.eid).toBe(call.params.eventId);
  expect(late.params.eid).toBe(call.params.eventId);
  expect(early.event).toBe(call.event);
  expect(late.event).toBe(call.event);
  expect(early.t < callReq.t && callReq.t < 2000 && 2000 < late.t).toBe(true);

  const linked = linkServerHits({ hits: [early, call, late], requests: [earlyReq, callReq, lateReq], serverHosts: [], identity: createIdentity(1) });
  expect(linked[1]!.via).toEqual({ hitId: early.id, by: 'eventId', confidence: 'exact' });
  expect(linked[0]!.via).toBeUndefined();
  expect(linked[2]!.via).toBeUndefined();

  const search: Flag = {
    type: 'flag', id: newId('flag'), runId, kind: 'canarySearch', recordIds: [],
    detail: 'Searched 3 requests to non-first-party hosts for 1 canary values as plain text. Searched: URL, body and decoded fields. Not searched: headers (Referer and Cookie). Skipped: compressed or binary body 0.',
  };
  const route: Flag = {
    type: 'flag', id: newId('flag'), runId, kind: 'identifierRoute', recordIds: [callReq.id],
    detail: 'url param gclid -> request to graph.facebook.com, param x, base64',
    route: { kind: 'unknown', source: { source: 'urlParam', name: 'gclid' }, sink: { requestId: callReq.id, host: 'graph.facebook.com', vendor: 'meta-capi', field: 'x', transform: 'base64' }, hops: [] },
  };
  expect(route.route!.sink.requestId).toBe(callReq.id);
  const records = [
    { type: 'run', id: runId, scenario: 's', site: 'http://localhost:3000/', startedAt: 0 } as unknown as Run,
    epoch(0, 'granted', state('granted')),
    epoch(2000, 'denied', state('denied')),
    search, earlyReq, callReq, lateReq, ...linked, route,
  ];
  const result = evaluate(records as never, parseScenario('start: /\n')).find((r) => r.expectation === 'builtin: identifierRoute');
  expect(result?.pass).toBe(true);
});
