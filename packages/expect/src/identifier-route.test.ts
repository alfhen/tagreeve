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

  const meta = (browserT: number, serverT: number, confidence: HitVia['confidence'], epochs: ReturnType<typeof epoch>[]) => {
    const browserReq = request(browserT, 'www.facebook.com');
    const browserHit = hit(browserReq, 'meta', state(), { event: 'Purchase' });
    const req = request(serverT, 'graph.facebook.com', { captured: 'serverContainer' });
    const server = hit(req, 'meta-capi', state(), { via: { hitId: browserHit.id, by: 'eventId', confidence } });
    expect(server.via?.confidence).toBe(confidence);
    return got([...epochs, search(), browserReq, browserHit, req, server, route(req, 'direct', { vendor: 'meta-capi' })]);
  };
  const grant = [epoch(0, 'undecided', ALL_DENIED), epoch(500, 'granted', ALL_GRANTED)];

  test('with a grant, an exact link passes and a probable link warns with serverSendProbableLink', () => {
    const exact = meta(700, 800, 'exact', grant);
    expect(exact.pass).toBe(true);
    const probable = meta(700, 800, 'probable', grant);
    expect(probable.pass).toBe(false);
    expect(probable.severity).toBe('warn');
    expect(probable.note).toBe('serverSendProbableLink');
  });

  test('with a grant, an exact link decides by the linked browser hit', () => {
    const epochs = [epoch(0, 'undecided', ALL_DENIED), epoch(500, 'granted', ALL_GRANTED), epoch(1000, 'denied', ALL_DENIED)];
    expect(meta(700, 1500, 'exact', epochs).pass).toBe(true);
    const late = meta(1400, 1500, 'exact', epochs);
    expect(late.pass).toBe(false);
    expect(late.severity).toBe('fail');
    expect(late.note).toBeUndefined();
  });

  test('a probable link in a run whose epochs only deny fails and does not warn', () => {
    const result = meta(700, 1500, 'probable', denied);
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('fail');
    expect(result.note).toBeUndefined();
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

describe('identifierRouteAllow', () => {
  const denied = epoch(0, 'denied', ALL_DENIED);
  const strip = (r: Result) => ({ pass: r.pass, severity: r.severity, note: r.note, evidence: r.evidence });
  const direct = (host: string) => {
    const req = request(500, host);
    return { req, flag: route(req, 'direct') };
  };

  test('a direct route to an allowed host passes, the same route to another host fails', () => {
    const allow = "options: { identifierRouteAllow: ['www.googleadservices.com'] }";
    const a = direct('www.googleadservices.com');
    const ok = got([denied, search(), a.req, a.flag], allow);
    expect(ok.pass).toBe(true);
    expect(ok.message).toMatch(/allowed by identifierRouteAllow: 1 routes? to www\.googleadservices\.com/);
    expect(ok.evidence).not.toContain(a.req.id);
    const b = direct('other.example.net');
    expect(b.flag.route!.sink.host).toBe('other.example.net');
    expect(['www.googleadservices.com']).not.toContain(b.flag.route!.sink.host);
    const bad = got([denied, search(), b.req, b.flag], allow);
    expect(bad.pass).toBe(false);
    expect(bad.severity).toBe('fail');
    expect(bad.evidence).toContain(b.req.id);
  });

  test('*.cmp.example allows subdomains but not the bare domain, and counts per host', () => {
    const allow = "options: { identifierRouteAllow: ['*.cmp.example'] }";
    const a = direct('api.cmp.example');
    const ok = got([denied, search(), a.req, a.flag], allow);
    expect(ok.pass).toBe(true);
    expect(ok.message).toMatch(/allowed by identifierRouteAllow: 1 routes? to api\.cmp\.example/);
    const bare = direct('cmp.example');
    expect(bare.flag.route!.sink.host).toBe('cmp.example');
    const bad = got([denied, search(), bare.req, bare.flag], allow);
    expect(bad.pass).toBe(false);
    expect(bad.severity).toBe('fail');
    expect(bad.evidence).toContain(bare.req.id);

    const three = [direct('api.cmp.example'), direct('api.cmp.example'), direct('cdn.cmp.example')];
    expect(three.map((x) => x.flag.route!.sink.host)).toEqual(['api.cmp.example', 'api.cmp.example', 'cdn.cmp.example']);
    const all = got([denied, search(), ...three.flatMap((x) => [x.req, x.flag])], allow);
    expect(all.pass).toBe(true);
    expect(all.message).toMatch(/2 routes to api\.cmp\.example/);
    expect(all.message).toMatch(/1 routes? to cdn\.cmp\.example/);
    expect(all.message).not.toContain('3 routes');
    expect(all.message).not.toContain('*.cmp.example');
    expect(all.evidence).toEqual([]);
  });

  test('an allowed route adds no fail, warn or request ID, and unlisted routes are judged as before', () => {
    const allow = "options: { identifierRouteAllow: ['www.googleadservices.com'] }";
    const page = request(400, 'www.googleadservices.com');
    const pageRoute = route(page, 'pageUrl');
    const alone = got([denied, search(), page, pageRoute], allow);
    expect(alone.pass).toBe(true);
    expect(alone.severity).toBe('fail');
    expect(alone.message).toContain('allowed by identifierRouteAllow');
    expect(got([denied, search(), page, pageRoute]).severity).toBe('warn');

    const a = direct('www.googleadservices.com');
    const u = request(600, 'www.google-analytics.com');
    const warnFlag = route(u, 'pageUrl');
    const warned = got([denied, search(), a.req, a.flag, u, warnFlag], allow);
    expect(warned.severity).toBe('warn');
    expect(warned.message).toContain('allowed by identifierRouteAllow: 1 route');
    expect(warned.message).toContain('www.googleadservices.com');
    expect(warned.evidence).not.toContain(a.req.id);
    expect(strip(warned)).toEqual(strip(got([denied, search(), u, warnFlag])));

    const f = request(700, 'other.example.net');
    const failFlag = route(f, 'direct');
    const failed = got([denied, search(), a.req, a.flag, f, failFlag], allow);
    expect(failed.severity).toBe('fail');
    expect(failed.message).toContain('allowed by identifierRouteAllow: 1 route');
    expect(failed.evidence).toEqual([f.id]);
    expect(strip(failed)).toEqual(strip(got([denied, search(), f, failFlag])));
  });

  test('an empty list gives the same result as no option', () => {
    const granted = epoch(0, 'granted', ALL_GRANTED);
    const p = direct('sink.example.net');
    const w = request(500, 'sink.example.net');
    const x = direct('sink.example.net');
    const cases: [unknown[], boolean, string][] = [
      [[granted, search(), p.req, p.flag], true, 'fail'],
      [[denied, search(), w, route(w, 'pageUrl')], false, 'warn'],
      [[denied, search(), x.req, x.flag], false, 'fail'],
    ];
    for (const [records, pass, severity] of cases) {
      const withEmpty = got(records, 'options: { identifierRouteAllow: [] }');
      const without = got(records);
      expect(strip(withEmpty)).toEqual(strip(without));
      expect(withEmpty.message).toBe(without.message);
      expect(withEmpty.pass).toBe(pass);
      expect(withEmpty.severity).toBe(severity);
      expect(withEmpty.message).not.toContain('allowed by identifierRouteAllow');
    }
  });});

describe('E81 the pass head when routes were allowed', () => {
  const allow = "options: { identifierRouteAllow: ['*.cmp.example'] }";
  const TAIL =
    'searched forms (plain text, URL-encoded, base64, base64url and SHA-256 (hex, base64, base64url), and with the GCL. and fb.1. cookie prefixes) in the URL, body and decoded fields of 41 requests; headers, including Referer and Cookie, not searched; skipped 0 (1 compressed or binary body).';
  const denied = epoch(0, 'denied', ALL_DENIED);
  const granted = epoch(0, 'granted', ALL_GRANTED);

  test('E81-1 every route allowed gives the judged-sink head', () => {
    const req = request(500, 'api.cmp.example');
    const flag = route(req, 'direct');
    expect(flag.route!.sink.host).toBe('api.cmp.example');
    const r = got([denied, search(), req, flag], allow);
    expect(r.pass).toBe(true);
    expect(r.message).toBe(`No planted value reached a judged sink; ${TAIL} (allowed by identifierRouteAllow: 1 route to api.cmp.example)`);
    expect(r.message).not.toContain('No planted value found');
    expect(r.message).not.toMatch(/nothing leaked|no leaks?\b/i);
    const three = [request(500, 'api.cmp.example'), request(510, 'api.cmp.example'), request(520, 'cdn.cmp.example')];
    const m = got([denied, search(), ...three.flatMap((q) => [q, route(q, 'direct')])], allow).message ?? '';
    expect(m.startsWith('No planted value reached a judged sink; ')).toBe(true);
    expect(m).toContain('2 routes to api.cmp.example');
    expect(m).toContain('1 route to cdn.cmp.example');
    expect(m).not.toContain('No planted value found');
  });

  test('E81-2 no routes keeps the old message', () => {
    for (const options of ['', allow]) {
      const records = [denied, search()];
      expect(records.some((x) => (x as Flag).kind === 'identifierRoute')).toBe(false);
      const r = got(records, options);
      expect(r.pass).toBe(true);
      expect(r.severity).toBe('fail');
      expect(r.evidence).toEqual([]);
      expect(r.message).toBe(`No planted value found in the ${TAIL}`);
    }
  });

  test('E81-3 only a host in the list counts as allowed', () => {
    const ok = request(500, 'api.cmp.example');
    const pos = got([granted, search(), ok, route(ok, 'direct')], allow);
    expect(pos.message!.startsWith('No planted value reached a judged sink; ')).toBe(true);
    expect(pos.message).toContain('allowed by identifierRouteAllow: 1 route to api.cmp.example');
    const bare = request(500, 'cmp.example');
    const bf = route(bare, 'direct');
    expect(bf.route!.sink.host).toBe('cmp.example');
    const neg = got([granted, search(), bare, bf], allow);
    expect(neg.message!.startsWith('No planted value reached a sink while consent forbade it (1 route allowed by consent); ')).toBe(true);
    expect(neg.message).not.toContain('reached a judged sink');
    expect(neg.message).not.toContain('allowed by identifierRouteAllow');
    for (const r of [pos, neg]) {
      expect(r.pass).toBe(true);
      expect(r.severity).toBe('fail');
      expect(r.evidence).toEqual([]);
    }
  });

  test('E81-4 a judged route keeps its head, with or without allowed routes', () => {
    const g = request(600, 'sink.example.net');
    const head = `No planted value reached a sink while consent forbade it (1 route allowed by consent); ${TAIL}`;
    expect(got([granted, search(), g, route(g, 'direct')]).message).toBe(head);
    const a = request(500, 'api.cmp.example');
    expect(got([granted, search(), a, route(a, 'direct'), g, route(g, 'direct')], allow).message).toBe(`${head} (allowed by identifierRouteAllow: 1 route to api.cmp.example)`);
  });

  test('E81-5 pass, severity, evidence and failing messages are unchanged', () => {
    const a = request(500, 'api.cmp.example');
    const allowed = got([denied, search(), a, route(a, 'direct')], allow);
    expect([allowed.pass, allowed.severity, allowed.evidence]).toEqual([true, 'fail', []]);
    const g = request(600, 'sink.example.net');
    const failed = got([denied, search(), a, route(a, 'direct'), g, route(g, 'direct')], allow);
    expect([failed.pass, failed.severity, failed.evidence]).toEqual([false, 'fail', [g.id]]);
    expect(failed.message).toBe('Expected no planted value to reach a sink while consent forbids it, found 1: url param gclid -> request to sink.example.net, param x, base64. Headers, including Referer and Cookie, were not searched. (allowed by identifierRouteAllow: 1 route to api.cmp.example)');
    const w = request(600, 'sink.example.net');
    const warned = got([denied, search(), a, route(a, 'direct'), w, route(w, 'pageUrl')], allow);
    expect([warned.pass, warned.severity, warned.evidence]).toEqual([false, 'warn', [w.id]]);
    expect(warned.message).toBe('Expected no planted value to reach a sink while consent forbids it, found 1: url param gclid -> request to sink.example.net, param x, base64 (page URL only). Headers, including Referer and Cookie, were not searched. (allowed by identifierRouteAllow: 1 route to api.cmp.example)');
  });
});
