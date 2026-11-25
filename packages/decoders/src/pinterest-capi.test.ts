import { readFileSync } from 'node:fs';
import { newId, type Request } from '@tagreeve/core';
import { expect, test } from 'vitest';
import { decodeRequest, isCollectionEndpoint, pinterestEventKey } from './index.ts';

const URL_ = 'https://api.pinterest.com/v5/ad_accounts/100000000000002/events';
const TOKEN = 'pw-fixture-pinterest-token';
const H = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

function req(over: Partial<Request> = {}): Request {
  return {
    type: 'request',
    id: newId('request'),
    runId: newId('run'),
    stepId: null,
    t: 1_800_000_000_000,
    method: 'POST',
    url: URL_,
    resourceType: 'fetch',
    frameUrl: null,
    initiator: null,
    headers: { 'content-type': 'application/json' },
    postData: null,
    outcome: 'stubbed',
    ...over,
  };
}

const capture = JSON.parse(readFileSync(new URL('../fixtures/pinterest-capi/capture.json', import.meta.url), 'utf8')) as {
  method: string;
  url: string;
  resourceType: Request['resourceType'];
  body: unknown;
}[];

const pins = (hits: ReturnType<typeof decodeRequest>) => hits.filter((h) => h.vendor === 'pinterest-capi');

test('capture: one hit for each item, with event, event ID, page and the first hashed email', () => {
  const c = capture[0]!;
  const hits = pins(decodeRequest(req({ method: c.method, url: c.url, resourceType: c.resourceType, postData: JSON.stringify(c.body) })));
  expect(hits).toHaveLength(2);
  expect(hits[0]).toMatchObject({
    vendor: 'pinterest-capi',
    event: 'add_to_cart',
    page: 'https://shop.example.com/product',
    transport: 'fetch',
    ids: { event_id: true, hashedEmail: true },
    params: { eventId: 'pw-pin-event-1', hashedEmail: H },
  });
  expect(hits[0]!.fields).toEqual(expect.arrayContaining(['action_source', 'event_time']));
  expect(hits[1]).toMatchObject({ event: 'page_visit', page: 'https://shop.example.com/', ids: { event_id: true }, params: { eventId: 'pw-pin-event-2' } });
});

test('only the first of several hashed emails is read', () => {
  const body = JSON.stringify({ data: [{ event_name: 'checkout', event_id: 'pw-pin-event-3', user_data: { em: [H, H2] } }] });
  const [hit] = pins(decodeRequest(req({ postData: body })));
  expect(hit!.params.hashedEmail).toBe(H);
  expect(JSON.stringify(hit)).not.toContain(H2);
  expect(hit!.params['hashedEmail.1']).toBeUndefined();
});

test('a query on the URL still matches', () => {
  const body = JSON.stringify({ data: [{ event_name: 'checkout' }] });
  expect(pins(decodeRequest(req({ url: `${URL_}?test=true`, postData: body })))).toHaveLength(1);
});

test('a GET, another path, another host and the tag host give no hit', () => {
  const body = JSON.stringify({ data: [{ event_name: 'checkout' }] });
  for (const r of [
    req({ method: 'GET' }),
    req({ url: 'https://api.pinterest.com/v5/ad_accounts/100000000000002/audiences', postData: body }),
    req({ url: 'https://api.example.com/v5/ad_accounts/100000000000002/events', postData: body }),
    req({ method: 'GET', url: 'https://ct.pinterest.com/v3/?tid=2612345678901&event=addtocart' }),
  ]) {
    expect(pins(decodeRequest(r))).toHaveLength(0);
  }
});

test('the endpoint is a collection endpoint under any method, the audiences path is not', () => {
  expect(isCollectionEndpoint(req({ method: 'OPTIONS' }))).toBe(true);
  expect(isCollectionEndpoint(req({ method: 'GET' }))).toBe(true);
  expect(isCollectionEndpoint(req({ url: 'https://api.pinterest.com/v5/ad_accounts/100000000000002/audiences' }))).toBe(false);
});

test('a body that is not JSON gives one hit with fieldsComplete false', () => {
  const hits = decodeRequest(req({ postData: '{"data": [ not json' }));
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ vendor: 'pinterest-capi', event: null, fieldsComplete: false });
});

test('no hit holds the bearer token, though the call carried it', () => {
  const body = JSON.stringify({ data: [{ event_name: 'add_to_cart', event_id: 'pw-pin-event-1', user_data: { em: [H] } }] });
  const request = req({ headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, postData: body });
  expect(JSON.stringify(request)).toContain(TOKEN);
  const hits = decodeRequest(request);
  expect(pins(hits)).toHaveLength(1);
  expect(JSON.stringify(hits)).not.toContain(TOKEN);
});

test('the event key drops case and underscores only', () => {
  expect(pinterestEventKey('add_to_cart')).toBe('addtocart');
  expect(pinterestEventKey('PageVisit')).toBe('pagevisit');
  expect(pinterestEventKey('checkout')).toBe('checkout');
});
