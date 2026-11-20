import { newId, type Request } from '@tagreeve/core';
import { expect, test } from 'vitest';
import { decodeRequest, PAGE_FIELDS } from './index.ts';

const MARKER = 'https://shop.example.com/pw-page-marker';
const BASE_PAGE = 'https://shop.example.com/pw-base-page';

function req(over: Partial<Request>): Request {
  return {
    type: 'request',
    id: newId('request'),
    runId: newId('run'),
    stepId: null,
    t: 1_800_000_000_000,
    method: 'GET',
    url: 'https://example.com/',
    resourceType: 'image',
    frameUrl: 'https://frame.example.com/pw-frame',
    initiator: null,
    headers: {},
    postData: null,
    outcome: 'stubbed',
    ...over,
  };
}

const query = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

interface Sample {
  name: string;
  vendor: string;
  names: readonly string[];
  key: (name: string) => string;
  fixed?: Record<string, string>;
  others: Record<string, string>;
  build: (fields: Record<string, string>) => Request;
}

const samples: Sample[] = [
  {
    name: 'ga4',
    vendor: 'ga4',
    names: PAGE_FIELDS.ga4.page,
    key: (n) => n,
    fixed: { v: '2', tid: 'G-PWTEST0001' },
    others: { en: 'page_view', dr: 'https://ref.example.com/', dt: 'Title' },
    build: (f) => req({ url: `https://region1.google-analytics.com/g/collect?${query(f)}` }),
  },
  {
    name: 'google-ads',
    vendor: 'google-ads',
    names: PAGE_FIELDS['google-ads'].page,
    key: (n) => n,
    others: { label: 'fake-label', ref: 'https://ref.example.com/', value: '1' },
    build: (f) => req({ url: `https://www.googleadservices.com/pagead/conversion/000000001/?${query(f)}` }),
  },
  {
    name: 'meta',
    vendor: 'meta',
    names: PAGE_FIELDS.meta.page,
    key: (n) => n,
    others: { id: '100000000000001', ev: 'PageView', rl: 'https://ref.example.com/', eid: 'e-1' },
    build: (f) => req({ url: `https://www.facebook.com/tr/?${query(f)}` }),
  },
  {
    name: 'meta-capi',
    vendor: 'meta-capi',
    names: PAGE_FIELDS['meta-capi'].page,
    key: (n) => n,
    others: { event_name: 'Purchase', event_id: 'pw-event-1', action_source: 'website' },
    build: (f) =>
      req({
        method: 'POST',
        url: 'https://graph.facebook.com/v21.0/100000000000001/events?access_token=pw-fixture-access-token',
        resourceType: 'fetch',
        headers: { 'content-type': 'application/json' },
        postData: JSON.stringify({ data: [f] }),
      }),
  },
  {
    name: 'pinterest',
    vendor: 'pinterest',
    names: PAGE_FIELDS.pinterest.page,
    key: (n) => n.slice('ad.'.length),
    others: { ref: 'https://ref.example.com/', sh: '720', sw: '1280' },
    build: (f) =>
      req({ url: `https://ct.pinterest.com/v3/?${query({ tid: '2612345678901', event: 'pagevisit', ad: JSON.stringify(f) })}` }),
  },
  {
    name: 'sgtm data client',
    vendor: 'sgtm',
    names: PAGE_FIELDS.sgtm.page,
    key: (n) => n,
    others: { event_name: 'purchase', page_title: 'Title', page_referrer: 'https://ref.example.com/' },
    build: (f) =>
      req({
        method: 'POST',
        url: 'https://sgtm.example.com/data?v=2&event=purchase',
        resourceType: 'fetch',
        postData: JSON.stringify(f),
      }),
  },
  {
    name: 'tracker',
    vendor: 'reddit',
    names: PAGE_FIELDS.tracker.page,
    key: (n) => n,
    others: { id: 'x', ev: 'PageVisit', ref: 'https://ref.example.com/', title: 'Title' },
    build: (f) => req({ url: `https://alb.reddit.com/rp.gif?${query(f)}` }),
  },
];

function pageOf(sample: Sample, fields: Record<string, string>): string | null | undefined {
  const request = sample.build(fields);
  const [hit] = decodeRequest(request).filter((h) => h.vendor === sample.vendor);
  return hit?.page;
}

function assertInRequest(request: Request): void {
  expect(request.url + (request.postData ?? '')).toContain('pw-page-marker');
}

test('the module names each decoder page fields in order and the referrer fields', () => {
  expect(PAGE_FIELDS.ga4).toEqual({ page: ['dl'], referrer: ['dr'] });
  expect(PAGE_FIELDS['google-ads']).toEqual({ page: ['url', 'dl'], referrer: ['ref'] });
  expect(PAGE_FIELDS.meta).toEqual({ page: ['dl'], referrer: ['rl'] });
  expect(PAGE_FIELDS['meta-capi'].page).toEqual(['event_source_url']);
  expect(PAGE_FIELDS.pinterest.page).toEqual(['ad.loc']);
  expect(PAGE_FIELDS.sgtm.page).toEqual(['page_location']);
  expect(PAGE_FIELDS.tracker.page).toEqual(['dl', 'page_location', 'page_url', 'url', 'u', 'loc', 'href']);
});

for (const sample of samples) {
  for (const name of sample.names) {
    test(`${sample.name}: a marker under ${name} is the page`, () => {
      const fields = { ...sample.fixed, ...sample.others, [sample.key(name)]: MARKER };
      assertInRequest(sample.build(fields));
      expect(pageOf(sample, fields)).toBe(MARKER);
    });
  }

  for (const other of Object.keys(sample.others)) {
    test(`${sample.name}: a marker under ${other} is not the page`, () => {
      const named = Object.fromEntries(sample.names.map((n) => [sample.key(n), BASE_PAGE]));
      const fields = { ...sample.fixed, ...sample.others, ...named, [other]: MARKER };
      assertInRequest(sample.build(fields));
      expect(pageOf(sample, fields)).toBe(BASE_PAGE);
    });
  }
}

test('google-ads: url wins over dl', () => {
  const sample = samples.find((s) => s.name === 'google-ads');
  if (!sample) throw new Error('no google-ads sample');
  const fields = { ...sample.others, url: 'https://shop.example.com/a', dl: 'https://shop.example.com/b' };
  expect(pageOf(sample, fields)).toBe('https://shop.example.com/a');
});
