import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newId, type Flag, type HitConsent, type Hit, type HitVia, type Request, type Result, type RouteKind, type Run } from '@tagreeve/core';
import { describe, expect, test } from 'vitest';
import { evaluate, type EvalEpoch } from './evaluate.ts';
import { parseScenario } from './scenario.ts';

const runId = newId('run');
const NAME = 'builtin: identifierRoute';

const state = (over: Partial<Record<'analytics' | 'ads' | 'adUserData' | 'adPersonalization', 'granted' | 'denied' | 'unknown'>> = {}, base: 'granted' | 'denied' | 'unknown' = 'unknown'): HitConsent => ({
  analytics: base,
  ads: base,
  adUserData: base,
  adPersonalization: base,
  raw: {},
  ...over,
});
const ALL_DENIED = state({}, 'denied');
const ALL_GRANTED = state({}, 'granted');

function epoch(startT: number, label: EvalEpoch['label'], st: HitConsent, outcome?: EvalEpoch['outcome']): EvalEpoch {
  return { type: 'consentEpoch', id: newId('consentEpoch'), runId, startT, endT: null, source: 'test', label, state: st, ...(outcome && { outcome }) };
}

function request(t: number, host = 'sink.example.net', over: Partial<Request> = {}): Request {
  return { type: 'request', id: newId('request'), runId, stepId: null, t, method: 'GET', url: `https://${host}/collect`, resourceType: 'image', frameUrl: null, initiator: null, headers: {}, postData: null, outcome: 'stubbed', ...over };
}

function hit(req: Request, vendor: string, consent: HitConsent = state(), over: Partial<Hit> = {}): Hit {
  return { type: 'hit', id: newId('hit'), runId, stepId: null, requestId: req.id, t: req.t, vendor, event: 'page_view', consent, ids: {}, page: null, transport: 'image', params: {}, fields: [], idFields: [], fieldsComplete: true, ...over };
}

function route(req: Request, kind: RouteKind, over: { field?: string; name?: string; vendor?: string; host?: string } = {}): Flag {
  const host = over.host ?? new URL(req.url).hostname;
  const name = over.name ?? 'gclid';
  return {
    type: 'flag', id: newId('flag'), runId, kind: 'identifierRoute', recordIds: [req.id],
    detail: `url param ${name} -> request to ${host}, param x, base64`,
    route: { kind, source: { source: 'urlParam', name }, sink: { requestId: req.id, host, vendor: over.vendor ?? 'unknown', field: over.field ?? 'x', transform: 'base64' }, hops: [] },
  };
}

const SEARCH_DETAIL =
  'Searched 41 requests to non-first-party hosts for 6 canary values as plain text, URL-encoded, base64, base64url and SHA-256 (hex, base64, base64url), and with the GCL. and fb.1. cookie prefixes. ' +
  'Searched: URL, body and decoded fields. Not searched: headers (Referer and Cookie). ' +
  'Skipped: compressed or binary body 1, body cut at 64 KiB 0, net-log request with no body 0.';

function search(skipped: string[] = []): Flag {
  return { type: 'flag', id: newId('flag'), runId, kind: 'canarySearch', recordIds: skipped, detail: SEARCH_DETAIL };
}

const runRecord = { type: 'run', id: runId, scenario: 's', site: 'http://localhost:3000/', startedAt: 0 } as unknown as Run;

function judge(records: unknown[], options = ''): Result[] {
  return evaluate([runRecord, ...records] as never, parseScenario(`start: /\n${options}`));
}

const route1 = (records: unknown[], options = ''): Result | undefined => judge(records, options).find((r) => r.expectation === NAME);
const got = (records: unknown[], options = ''): Result => route1(records, options)!;

/** A sink request with one hit and one route flag. */
function sink(t: number, vendor: string, kind: RouteKind, consent: HitConsent = state()) {
  const req = request(t, vendor === 'meta' ? 'www.facebook.com' : 'www.google-analytics.com');
  return { req, h: hit(req, vendor, consent), flag: route(req, kind, { vendor }) };
}

describe('severity and kind', () => {
  const denied = epoch(0, 'denied', ALL_DENIED);
  test('a pageUrl route alone is a warning, the same route as unknown a failure', () => {
    const page = sink(500, 'ga4', 'pageUrl');
    expect(denied.label).toBe('denied');
    expect(page.h.consent).toEqual(state());
    const warn = got([denied, search(), page.req, page.h, page.flag]);
    expect(warn.pass).toBe(false);
    expect(warn.severity).toBe('warn');
    const other = sink(500, 'ga4', 'unknown');
    const fail = got([denied, search(), other.req, other.h, other.flag]);
    expect(fail.pass).toBe(false);
    expect(fail.severity).toBe('fail');
  });

  test('builtins identifierRoute: warn turns the failure into a warning, another key leaves it', () => {
    const s = sink(500, 'ga4', 'unknown');
    const records = [denied, search(), s.req, s.h, s.flag];
    expect(got(records, 'options:\n  builtins: { identifierRoute: warn }').severity).toBe('warn');
    expect(got(records, 'options:\n  builtins: { identifierRoute: warn }').pass).toBe(false);
    expect(got(records, 'options:\n  builtins: { deniedIdentifiers: warn }').severity).toBe('fail');
    expect(got(records).severity).toBe('fail');
  });

  test('a severity that is not fail or warn is refused for the severity, not as an unknown check', () => {
    expect(() => parseScenario('start: /\noptions:\n  builtins: { identifierRoute: maybe }')).toThrow(/must be fail or warn/);
    expect(() => parseScenario('start: /\noptions:\n  builtins: { identifierRoute: maybe }')).not.toThrow(/unknown builtin check/);
  });
});

describe('when the result exists', () => {
  test('only a record with a canarySearch flag gets the result, and no other result changes', () => {
    const base = [epoch(0, 'denied', ALL_DENIED)];
    const withFlag = [...base, search()];
    expect(withFlag.some((r) => (r as Flag).kind === 'canarySearch')).toBe(true);
    const first = judge(withFlag);
    expect(first.filter((r) => r.expectation === NAME)).toHaveLength(1);
    expect(first.find((r) => r.expectation === NAME)!.pass).toBe(true);
    const second = judge(base);
    expect(second.some((r) => r.expectation === NAME)).toBe(false);
    expect(first.filter((r) => r.expectation !== NAME).map((r) => [r.expectation, r.pass])).toEqual(second.map((r) => [r.expectation, r.pass]));
  });
});

describe('the pass message', () => {
  test('names the forms and parts searched, that headers were not, and the counts, and never says no leaks', () => {
    const { message } = got([epoch(0, 'granted', ALL_GRANTED), search(['req_1'])]);
    for (const re of [/base64/, /SHA-256/i, /URL/, /body/i, /headers/i, /Referer/, /Cookie/, /41 requests/, /skipped 1 \(1 compressed or binary body\)/i]) expect(message).toMatch(re);
    expect(message).not.toMatch(/no leaks/i);
  });
});

describe('the consent a sink takes', () => {
  test('a Google hit takes its own consent', () => {
    const own = sink(500, 'ga4', 'unknown', state({ analytics: 'denied' }, 'granted'));
    expect(own.h.consent.analytics).toBe('denied');
    expect(got([epoch(0, 'granted', ALL_GRANTED), search(), own.req, own.h, own.flag]).severity).toBe('fail');
    const ok = sink(500, 'ga4', 'unknown', ALL_GRANTED);
    expect(got([epoch(0, 'denied', ALL_DENIED), search(), ok.req, ok.h, ok.flag]).pass).toBe(true);
  });

  test('a request with no decoded hit takes the epoch of its time, with the grace window', () => {
    const epochs = [epoch(0, 'undecided', ALL_DENIED), epoch(1000, 'denied', ALL_DENIED), epoch(2000, 'granted', ALL_GRANTED)];
    const at = (t: number) => {
      const req = request(t);
      return got([...epochs, search(), req, route(req, 'unknown')], 'options:\n  graceWindow: 50ms');
    };
    expect(at(1500).pass).toBe(false);
    expect(at(1970).pass).toBe(true);
    expect(at(1920).pass).toBe(false);
  });

  test('a mixed consent with only ad_personalization denied passes, with ad_user_data denied it fails', () => {
    const epochs = [epoch(0, 'granted', ALL_GRANTED)];
    const one = state({ adPersonalization: 'denied' }, 'granted');
    const a = sink(500, 'ga4', 'unknown', one);
    expect(a.h.consent.adPersonalization).toBe('denied');
    expect(got([...epochs, search(), a.req, a.h, a.flag]).pass).toBe(true);
    const b = sink(500, 'ga4', 'unknown', state({ adPersonalization: 'denied', adUserData: 'denied' }, 'granted'));
    expect(got([...epochs, search(), b.req, b.h, b.flag]).pass).toBe(false);
  });

  test('a mixed consent with only analytics denied fails, for a Google hit and for a non-Google sink', () => {
    const grantedEpoch = epoch(0, 'granted', ALL_GRANTED);
    const a = sink(500, 'ga4', 'unknown', state({ analytics: 'denied' }, 'granted'));
    expect(a.h.consent.analytics).toBe('denied');
    const failing = got([grantedEpoch, search(), a.req, a.h, a.flag]);
    expect(failing.pass).toBe(false);
    expect(failing.severity).toBe('fail');
    const fixed = sink(500, 'ga4', 'unknown', ALL_GRANTED);
    expect(got([grantedEpoch, search(), fixed.req, fixed.h, fixed.flag]).pass).toBe(true);

    const meta = sink(500, 'meta', 'unknown');
    const mixed = epoch(0, 'mixed', state({ adPersonalization: 'denied' }, 'granted'));
    expect(mixed.label).toBe('mixed');
    expect(got([mixed, search(), meta.req, meta.h, meta.flag]).pass).toBe(true);
    const analyticsDenied = epoch(0, 'mixed', state({ adPersonalization: 'denied', analytics: 'denied' }, 'granted'));
    const result = got([analyticsDenied, search(), meta.req, meta.h, meta.flag]);
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('fail');
  });

  test('a Meta hit in an undecided epoch with no Consent Mode default fails', () => {
    const undecided = epoch(0, 'undecided', state());
    const s = sink(500, 'meta', 'unknown');
    expect(undecided.label).toBe('undecided');
    expect(Object.values(undecided.state).filter((v) => v === 'unknown')).toHaveLength(4);
    const result = got([undecided, search(), s.req, s.h, s.flag]);
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('fail');
  });

  test('a non-Google sink in a withdrawn epoch fails, the same sink in the granted epoch before it passes', () => {
    const epochs = [epoch(0, 'undecided', ALL_DENIED), epoch(1000, 'granted', ALL_GRANTED), epoch(2000, 'withdrawn', ALL_DENIED, 'granted')];
    const at = (t: number) => {
      const s = sink(t, 'meta', 'unknown');
      expect(s.h.vendor).toBe('meta');
      return got([...epochs, search(), s.req, s.h, s.flag]);
    };
    expect(epochs[2]!.label).toBe('withdrawn');
    const late = at(2500);
    expect(late.pass).toBe(false);
    expect(late.severity).toBe('fail');
    expect(at(1500).pass).toBe(true);
  });

  test('only a Google vendor takes the consent the hit carries', () => {
    const denied = epoch(0, 'denied', ALL_DENIED);
    const google = sink(500, 'ga4', 'unknown', ALL_GRANTED);
    const meta = sink(500, 'meta', 'unknown', ALL_GRANTED);
    expect(google.h.consent.analytics).toBe('granted');
    expect(denied.label).toBe('denied');
    expect(got([denied, search(), google.req, google.h, google.flag]).pass).toBe(true);
    const result = got([denied, search(), meta.req, meta.h, meta.flag]);
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('fail');
  });
});

describe('a server container call', () => {
  const via = (to: Hit): HitVia => ({ hitId: to.id, by: 'eventId', confidence: 'exact' });
  const call = (extra: Partial<Request> = {}) => request(1500, 'collect.example.net', { captured: 'serverContainer', ...extra });
  const denied = [epoch(0, 'undecided', ALL_DENIED), epoch(1000, 'denied', ALL_DENIED)];
  const withGrant = [epoch(0, 'undecided', ALL_DENIED), epoch(500, 'granted', ALL_GRANTED), epoch(1000, 'denied', ALL_DENIED)];

  test('unlinked: fails when every epoch forbids it, otherwise warns with serverSendUnlinked', () => {
    const req = call();
    const records = [search(), req, hit(req, 'ga4', state()), route(req, 'unknown')];
    expect(req.captured).toBe('serverContainer');
    const fail = got([...denied, ...records]);
    expect(fail.pass).toBe(false);
    expect(fail.severity).toBe('fail');
    expect(fail.note).toBeUndefined();
    const warn = got([...withGrant, ...records]);
    expect(warn.pass).toBe(false);
    expect(warn.severity).toBe('warn');
    expect(warn.note).toBe('serverSendUnlinked');
  });

  test('linked: the link does not change the verdict', () => {
    const browserReq = request(1400, 'www.google-analytics.com');
    const browserHit = hit(browserReq, 'ga4', state());
    const req = call();
    const server = hit(req, 'ga4', state(), { via: via(browserHit) });
    expect(server.via?.hitId).toBe(browserHit.id);
    const records = [search(), browserReq, browserHit, req, server, route(req, 'unknown')];
    const fail = got([...denied, ...records]);
    expect(fail.severity).toBe('fail');
    expect(fail.note).toBeUndefined();
    const warn = got([...withGrant, ...records]);
    expect(warn.pass).toBe(false);
    expect(warn.severity).toBe('warn');
    expect(warn.note).toBe('serverSendUnlinked');
  });

  test('the same request captured by the browser is judged as an ordinary sink', () => {
    const req = request(1500, 'collect.example.net');
    expect(req.captured).toBeUndefined();
    const result = got([...withGrant, search(), req, hit(req, 'ga4', state()), route(req, 'unknown')]);
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('fail');
    expect(result.note).toBeUndefined();
  });
});

describe('the message and evidence', () => {
  test('a failing message lists at most 5 route lines, the evidence holds every failing request ID and only those', () => {
    const sinks = [1, 2, 3, 4, 5, 6, 7].map((n) => {
      const req = request(500, `sink${n}.example.net`);
      return { req, flag: route(req, 'unknown') };
    });
    const flags = sinks.map((s) => s.flag);
    expect(flags).toHaveLength(7);
    expect(new Set(flags.map((f) => f.route!.sink.host)).size).toBe(7);
    const epochRecord = epoch(0, 'denied', ALL_DENIED);
    expect(epochRecord.label).toBe('denied');
    const result = got([epochRecord, search(), ...sinks.flatMap((s) => [s.req, s.flag])]);
    expect(result.pass).toBe(false);
    expect(sinks.filter((s) => (result.message ?? '').includes(s.req.url.split('/')[2]!))).toHaveLength(5);
    expect([...result.evidence].sort()).toEqual(sinks.map((s) => s.req.id as string).sort());
    const ids = new Set(sinks.map((s) => s.req.id as string));
    for (const id of result.evidence) expect(ids.has(id)).toBe(true);
  });

  test('the sink field comes from the masked flag, an observed key in the request body is not printed', () => {
    const email = 'jane@shop.example.net';
    const req = request(500, 'www.facebook.com', { method: 'POST', postData: JSON.stringify({ [email]: Buffer.from('TEST-GCLID-7-REJECT-0001').toString('base64') }) });
    expect(req.postData).toContain(email);
    const flag = route(req, 'unknown', { field: '(other)' });
    const result = got([epoch(0, 'denied', ALL_DENIED), search(), req, flag]);
    expect(result.pass).toBe(false);
    expect(result.message).toContain('(other)');
    expect(JSON.stringify(result)).not.toContain(email);
  });
});

describe('a stored record without canaries', () => {
  test('site/demo/reject.jsonl gives the same results as before and no identifierRoute result', () => {
    const dir = new URL('../../../site/demo/', import.meta.url);
    const records = readFileSync(fileURLToPath(new URL('reject.jsonl', dir)), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { type: string; kind?: string; canaries?: unknown });
    expect(records.some((r) => r.type === 'flag' && r.kind === 'canarySearch')).toBe(false);
    expect(records.find((r) => r.type === 'run')!.canaries).toBeUndefined();
    const text = readFileSync(fileURLToPath(new URL('scenarios/reject.yml', dir)), 'utf8');
    const results = evaluate(records as never, parseScenario(text));
    expect(results.some((r) => r.expectation === NAME)).toBe(false);
    const names = results.map((r) => r.expectation);
    expect(names.slice(2)).toEqual([
      'builtin: unknownDestination',
      'builtin: sandboxPageUrl',
      'builtin: deniedIdentifiers',
      'builtin: earlyIdentifiers',
      'builtin: consentModeSetup',
      'builtin: earlyIdentityPush',
      'builtin: idHandover',
      'builtin: possibleRealData',
    ]);
    expect(names.slice(0, 2).every((n) => n.startsWith('mustNot: '))).toBe(true);
    expect(results.map((r) => r.pass)).toEqual([false, false, true, false, true, true, true, true, true, false]);
  });
});
