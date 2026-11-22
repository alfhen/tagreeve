import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { canaryPool, canaryValues, createIdentity, MAX_POST_DATA, newId, readRun, type Flag, type Hit, type Request } from '@tagreeve/core';
import { PAGE_FIELDS } from '@tagreeve/decoders';
import { buildCanaryFlags, type CanaryRouteInput } from './canary-routes.ts';

const runId = newId('run');
const canaries = canaryValues(7);
const gclid = canaries.find((c) => c.name === 'gclid')!.value;
const b64 = (text: string) => Buffer.from(text).toString('base64');
const identity = createIdentity(7);

function req(url: string, over: Partial<Request> = {}): Request {
  return { type: 'request', id: newId('request'), runId, stepId: null, t: 1, method: 'GET', url, resourceType: 'image', frameUrl: null, initiator: null, headers: {}, postData: null, outcome: 'stubbed', ...over };
}

function hit(request: Request, vendor: string, params: Record<string, string>, page: string | null = null): Hit {
  return { type: 'hit', id: newId('hit'), runId, stepId: null, requestId: request.id, t: 1, vendor, event: 'e', consent: { state: 'unknown', signals: {} } as unknown as Hit['consent'], ids: {}, page, transport: 'image', params };
}

function flagsFor(requests: Request[], hits: Hit[] = [], over: Partial<CanaryRouteInput> = {}): Flag[] {
  return buildCanaryFlags({ runId, siteUrl: 'http://localhost:3000', requests, hits, canaries, identity: null, ...over });
}

const routes = (flags: Flag[]) => flags.filter((f) => f.kind === 'identifierRoute');
const search = (flags: Flag[]) => flags.filter((f) => f.kind === 'canarySearch');
const VENDOR = 'https://www.googleadservices.com/pagead/conversion/000000001/';

describe('what is found and where', () => {
  test('a base64 canary in a vendor URL gives one unknown route that names no value', () => {
    const r = req(`${VENDOR}?x=${encodeURIComponent(b64(gclid))}`);
    expect(r.url).toContain(encodeURIComponent(b64(gclid)));
    const flags = routes(flagsFor([r], [hit(r, 'google-ads', {})]));
    expect(flags).toHaveLength(1);
    const { route, detail, recordIds } = flags[0]!;
    expect(route).toEqual({ kind: 'unknown', source: { source: 'urlParam', name: 'gclid' }, sink: { requestId: r.id, host: 'www.googleadservices.com', vendor: 'google-ads', field: 'x', transform: 'base64' }, hops: [] });
    expect(recordIds).toEqual([r.id]);
    expect(detail).toBe('url param gclid -> request to www.googleadservices.com, param x, base64');
    expect(JSON.stringify(flags)).not.toContain(gclid);
  });

  test('each place that can hold a canary gives a route, and a header does not', () => {
    const inUrl = req(`${VENDOR}?x=${gclid}`);
    const inBody = req(VENDOR, { method: 'POST', postData: `x=${gclid}` });
    const hitOnly = req(`${VENDOR}?q=1`);
    const redirect = req(`${VENDOR}?x=${gclid}`, { initiator: 'redirect' });
    const container = req(`${VENDOR}?x=${gclid}`, { captured: 'serverContainer' });
    expect(inBody.url).not.toContain(gclid);
    expect(hitOnly.url).not.toContain(gclid);
    const params = hit(hitOnly, 'google-ads', { custom: gclid });
    expect(hitOnly.postData).toBeNull();
    for (const r of [inUrl, inBody, redirect, container]) expect(routes(flagsFor([r]))).toHaveLength(1);
    const viaHit = routes(flagsFor([hitOnly], [params]));
    expect(viaHit).toHaveLength(1);
    expect(viaHit[0]!.route!.sink.field).toBe('custom');
    const header = req(`${VENDOR}?x=1`, { headers: { referer: `https://shop.example.net/?gclid=${gclid}` } });
    expect(header.url).not.toContain(gclid);
    expect(header.headers.referer).toContain(gclid);
    expect(routes(flagsFor([header]))).toEqual([]);
  });

  test('a canary under its own name or an identity value is direct, under another name unknown', () => {
    const own = req(`${VENDOR}?gclid=${gclid}`);
    expect(routes(flagsFor([own]))[0]!.route!.kind).toBe('direct');
    const other = req(`${VENDOR}?zz=${gclid}`);
    expect(routes(flagsFor([other]))[0]!.route!.kind).toBe('unknown');
    const hex = canaryPoolHex(identity.email);
    const mail = req(`${VENDOR}?x=${hex}`);
    const flags = routes(flagsFor([mail], [], { identity }));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ route: { kind: 'direct', source: { source: 'identity', name: 'email' }, sink: { transform: 'sha256' } } });
    expect(JSON.stringify(flags)).not.toContain(identity.email);
  });
});

function canaryPoolHex(email: string): string {
  const pool = canaryPool([], { email, phone: identity.phone });
  return [...pool.forms].find(([form, name]) => name === 'email' && /^[0-9a-f]{64}$/.test(form))![0];
}

describe('the pool decides', () => {
  test('a pool without the base64 forms finds no base64 canary, the full pool does', () => {
    const full = canaryPool(canaryValues(7), null);
    const drop = new Set(canaries.flatMap((c) => [Buffer.from(c.value).toString('base64'), Buffer.from(c.value).toString('base64url')]));
    const forms = new Map([...full.forms].filter(([form]) => !drop.has(form)));
    const reduced = { forms, match: (text: string) => forms.get(text) };
    const encoded = b64(gclid);
    expect(full.match(encoded)).toBe('gclid');
    expect(reduced.match(encoded)).toBeUndefined();
    expect(reduced.forms.has(encoded)).toBe(false);
    const r = req(`${VENDOR}?x=${encodeURIComponent(encoded)}`);
    expect(r.url).toContain(encodeURIComponent(encoded));
    const withFull = routes(flagsFor([r], [], { pool: full }));
    expect(withFull).toHaveLength(1);
    expect(withFull[0]!.route!.sink.transform).toBe('base64');
    expect(routes(flagsFor([r], [], { pool: reduced }))).toEqual([]);
  });
});

describe('hosts', () => {
  test.each([
    ['the site host', 'http://localhost:3000/collect', {}],
    ['a firstPartyHosts host', 'https://metrics.partner.example/collect', { firstPartyHosts: ['metrics.partner.example'] }],
    ['a serverHosts host', 'https://sgtm.partner.example/data', { serverHosts: ['sgtm.partner.example'] }],
  ])('%s is not a sink, the same request to a vendor host is', (_name, url, over) => {
    const inner = new URL(url);
    inner.searchParams.set('x', gclid);
    expect(inner.href).toContain(gclid);
    const vendor = req(`https://www.googleadservices.com/pagead/conversion/000000001/?x=${gclid}`);
    expect(routes(flagsFor([vendor], [], over))).toHaveLength(1);
    expect(routes(flagsFor([req(inner.href)], [], over))).toEqual([]);
  });
});

describe('route kind from the page fields', () => {
  const page = `https://shop.example.net/?gclid=${gclid}`;
  const vendors = Object.keys(PAGE_FIELDS).filter((v) => v !== 'tracker') as (keyof typeof PAGE_FIELDS)[];

  test.each(vendors)('%s: a page field gives pageUrl, the same value under another name unknown', (vendor) => {
    for (const f of PAGE_FIELDS[vendor].page) {
      const r = req(`${VENDOR}?${f}=${encodeURIComponent(page)}`);
      const h = hit(r, vendor, { [f]: page }, page);
      expect(r.url).toContain(encodeURIComponent(gclid));
      expect(h.params[f]).toContain(gclid);
      expect(h.page).toContain(gclid);
      const found = routes(flagsFor([r], [h])).filter((x) => x.route!.source.name === 'gclid');
      expect(found).toHaveLength(1);
      expect(found[0]!.route!.kind).toBe('pageUrl');
      const moved = req(`${VENDOR}?zz=${encodeURIComponent(page)}`);
      const mh = hit(moved, vendor, { zz: page }, 'https://shop.example.net/');
      expect(mh.page).not.toContain(gclid);
      expect(routes(flagsFor([moved], [mh])).find((x) => x.route!.source.name === 'gclid')!.route!.kind).toBe('unknown');
    }
    for (const f of PAGE_FIELDS[vendor].referrer) {
      const r = req(`${VENDOR}?${f}=${encodeURIComponent(page)}`);
      const h = hit(r, vendor, { [f]: page }, 'https://shop.example.net/');
      expect(h.page).not.toContain(gclid);
      expect(routes(flagsFor([r], [h])).find((x) => x.route!.source.name === 'gclid')!.route!.kind).toBe('pageUrl');
      const moved = req(`${VENDOR}?zz=${encodeURIComponent(page)}`);
      const mh = hit(moved, vendor, { zz: page }, 'https://shop.example.net/');
      expect(routes(flagsFor([moved], [mh])).find((x) => x.route!.source.name === 'gclid')!.route!.kind).toBe('unknown');
    }
  });
});

describe('a name that looks like a value', () => {
  test('a JSON key that is an email is stored and printed as (other)', () => {
    const body = JSON.stringify({ 'jane@shop.example.net': b64(gclid) });
    const r = req('https://api.partner.example/collect', { method: 'POST', postData: body });
    expect(r.postData).toContain('jane@shop.example.net');
    const flags = routes(flagsFor([r]));
    expect(flags).toHaveLength(1);
    expect(flags[0]!.route!.sink.field).toBe('(other)');
    expect(flags[0]!.detail).toContain('(other)');
    expect(JSON.stringify(flags)).not.toContain('jane@shop.example.net');
  });
});

describe('the canarySearch flag', () => {
  test('names forms and parts, says headers were not searched and counts the requests', () => {
    const [flag] = search(flagsFor([req(`${VENDOR}?x=1`), req('https://www.google-analytics.com/g/collect?v=2')]));
    for (const re of [/base64/, /SHA-256/i, /URL/, /body/i, /headers/i, /Referer/, /Cookie/, /Searched 2 requests/]) expect(flag!.detail).toMatch(re);
  });

  test('a gzip body is skipped with its request ID, a plain body is not', () => {
    const body = gzipSync(Buffer.from(`x=${gclid}`)).toString('latin1');
    expect(body).not.toContain(gclid);
    const zipped = req('https://api.partner.example/collect', { method: 'POST', postData: body });
    const plain = req('https://api.partner.example/plain', { method: 'POST', postData: 'a=1' });
    const [flag] = search(flagsFor([zipped, plain]));
    expect(flag!.detail).toMatch(/compressed or binary body 1/);
    expect(flag!.recordIds).toEqual([zipped.id]);
    expect(flag!.recordIds).not.toContain(plain.id);
  });

  test('a body cut at 64 KiB is counted under its own reason', () => {
    const cut = req('https://api.partner.example/collect', { method: 'POST', postData: 'a'.repeat(MAX_POST_DATA) });
    expect(cut.postData!.length).toBe(MAX_POST_DATA);
    const plain = req('https://api.partner.example/plain', { method: 'POST', postData: 'a=1' });
    const [flag] = search(flagsFor([cut, plain]));
    expect(flag!.detail).toMatch(/cut/i);
    expect(flag!.detail).toMatch(/64 KiB 1/);
    expect(flag!.recordIds).toEqual([cut.id]);
  });

  test('a net-log request with no body is counted under its own reason', () => {
    const netlog = req('https://api.partner.example/collect', { method: 'POST', captured: 'netlog', postData: null });
    expect(netlog.captured).toBe('netlog');
    expect(netlog.postData).toBeNull();
    const plain = req('https://api.partner.example/plain', { method: 'POST', postData: 'a=1' });
    const [flag] = search(flagsFor([netlog, plain]));
    expect(flag!.detail).toMatch(/net[- ]?log request with no body 1/i);
    expect(flag!.recordIds).toEqual([netlog.id]);
  });

  test('a run without canaries gets no flag', () => {
    expect(flagsFor([req(`${VENDOR}?x=${gclid}`)], [], { canaries: [] })).toEqual([]);
  });
});

describe('a recorded run', () => {
  test('the demo record has no route, one search flag, and its IDs are requests of the record', async () => {
    const path = new URL('../../../site/demo/reject.jsonl', import.meta.url);
    expect(readFileSync(path, 'utf8')).not.toContain('TEST-');
    const records = await readRun(path.pathname);
    expect(records.run.identity).toBeNull();
    const flags = buildCanaryFlags({ runId: records.run.id, siteUrl: records.run.site, requests: records.requests, hits: records.hits, canaries, identity: null, pool: canaryPool(canaryValues(7), null) });
    expect(routes(flags)).toEqual([]);
    expect(search(flags)).toHaveLength(1);
    const ids = new Set(records.requests.map((r) => r.id));
    for (const id of search(flags)[0]!.recordIds) expect(ids.has(id as Request['id'])).toBe(true);
  });
});
