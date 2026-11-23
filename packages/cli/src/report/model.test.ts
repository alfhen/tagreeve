import { newId, type ConsentEpoch, type ConsentState, type Flag, type Hit, type Request, type Result, type RunRecords } from '@tagreeve/core';
import { decodeRequest } from '@tagreeve/decoders';
import { TAG_REPORTER_HINT } from '@tagreeve/expect';
import { describe, expect, test } from 'vitest';
import { buildReportModel, type ReportModel } from './model.ts';

const runId = newId('run');
const state = (over: Partial<ConsentState> = {}): ConsentState => ({ analytics: 'unknown', ads: 'unknown', adUserData: 'unknown', adPersonalization: 'unknown', ...over });
const DENIED = state({ analytics: 'denied', ads: 'denied', adUserData: 'denied', adPersonalization: 'denied' });
const GRANTED = state({ analytics: 'granted', ads: 'granted', adUserData: 'granted', adPersonalization: 'granted' });

function epoch(label: ConsentEpoch['label'], startT: number, st: ConsentState, endT: number | null = null): ConsentEpoch {
  return { type: 'consentEpoch', id: newId('consentEpoch'), runId, startT, endT, source: 'test', label, state: st };
}

function hit(vendor: string, t: number, over: Partial<Hit> = {}, consent: Partial<ConsentState> = {}): Hit {
  return {
    type: 'hit',
    id: newId('hit'),
    runId,
    stepId: null,
    requestId: newId('request'),
    t,
    vendor,
    event: 'page_view',
    consent: { ...state(consent), raw: {} },
    ids: {},
    page: null,
    transport: 'image',
    params: {},
    fields: [],
    fieldsComplete: true,
    idFields: [],
    ...over,
  };
}

function result(expectation: string, pass: boolean, over: Partial<Result> = {}): Result {
  return { type: 'result', id: newId('result'), runId, expectation, pass, evidence: [], ...over };
}

function records(over: Partial<RunRecords> & { version?: number; graceWindowMs?: number } = {}): RunRecords {
  const { version = 2, graceWindowMs, ...rest } = over;
  return {
    run: {
      type: 'run',
      id: runId,
      recordSchemaVersion: version,
      scenario: 'scenario.yml',
      site: 'http://127.0.0.1:4000/identifiers?state=denied',
      startedAt: 1_800_000_000_000,
      pingwrightVersion: '0.3.0',
      browser: { name: 'chromium', version: '156' },
      networkMode: 'stub',
      gtmOverride: null,
      containerVersions: {},
      identity: null,
      ...(graceWindowMs !== undefined && { graceWindowMs }),
    },
    steps: [],
    requests: [],
    responses: [],
    hits: [],
    dataLayerEvents: [],
    tagReports: [],
    consentEpochs: [epoch('undecided', 0, state(), 1000), epoch('denied', 1000, DENIED, 2000), epoch('withdrawn', 2000, DENIED)],
    checkpoints: [],
    results: [],
    flags: [],
    collectorReports: [],
    invalidReports: [],
    ...rest,
  };
}

function marksOf(model: ReportModel, vendor: string): string[] {
  return model.rows.find((r) => r.vendor === vendor)!.segments.map((s) => s.mark);
}

test('columns follow the consent epochs, one row per vendor, with hit counts', () => {
  const model = buildReportModel(
    records({ hits: [hit('meta', 500), hit('meta', 600), hit('ga4', 1500, {}, { analytics: 'granted' })] }),
  );
  expect(model.columns.map((c) => c.label)).toEqual(['undecided', 'denied', 'withdrawn']);
  expect(model.rows.map((r) => [r.vendor, r.hits])).toEqual([['ga4', 1], ['meta', 2]]);
  expect(model.rows[1]!.segments.map((s) => s.hits)).toEqual([2, 0, 0]);
  expect(marksOf(model, 'meta')).toEqual(['early', 'nothing', 'nothing']);
});

test('a record with no epochs has one undecided column', () => {
  const model = buildReportModel(records({ consentEpochs: [], hits: [hit('meta', 1)] }));
  expect(model.columns.map((c) => c.label)).toEqual(['undecided']);
  expect(marksOf(model, 'meta')).toEqual(['early']);
});

test('a denied hit with no identifiers is a ping, a granted hit is full, no hit is nothing', () => {
  const model = buildReportModel(records({ hits: [hit('meta', 1500), hit('ga4', 1500, {}, { analytics: 'granted', ads: 'granted' })] }));
  expect(marksOf(model, 'meta')).toEqual(['nothing', 'ping', 'nothing']);
  expect(model.rows[1]!.segments[1]!.label).toBe('hit sent while denied, no identifiers recorded');
  expect(marksOf(model, 'ga4')[1]).toBe('full');
});

test('a segment with one leaking hit and one granted hit shows leak', () => {
  const model = buildReportModel(
    records({
      consentEpochs: [epoch('denied', 0, DENIED)],
      hits: [hit('ga4', 100, { idFields: ['uid'] }, { analytics: 'denied' }), hit('ga4', 200, {}, { analytics: 'granted' })],
    }),
  );
  expect(marksOf(model, 'ga4')).toEqual(['leak']);
});

test('identifier names flag a hit by the signal of their class', () => {
  const model = buildReportModel(
    records({
      hits: [
        hit('meta', 1500, { idFields: ['ud[em]'] }),
        hit('ga4', 1500, { idFields: ['user_id'] }, { analytics: 'granted', ads: 'denied', adUserData: 'denied' }),
      ],
    }),
  );
  expect(marksOf(model, 'meta')[1]).toBe('leak');
  const ga4 = model.rows.find((r) => r.vendor === 'ga4')!.segments[1]!;
  expect(ga4.mark).toBe('mixed');
  expect(ga4.label).toBe('some signals denied');
});

test('an sgtm hit with a granted gcs in a denied epoch is a leak', () => {
  const model = buildReportModel(records({ hits: [hit('sgtm', 1500, { idFields: ['external_id'] }, { analytics: 'granted', ads: 'granted' })] }));
  expect(marksOf(model, 'sgtm')[1]).toBe('leak');
});

test('an unknown Meta hit in a denied epoch takes the epoch state', () => {
  const model = buildReportModel(records({ hits: [hit('meta', 1500, { idFields: ['external_id'] })] }));
  expect(marksOf(model, 'meta')[1]).toBe('leak');
});

test('a denied hit with a cut body is unchecked, never ping', () => {
  const model = buildReportModel(records({ hits: [hit('sgtm', 1500, { fieldsComplete: false })] }));
  const seg = model.rows[0]!.segments[1]!;
  expect(seg.mark).toBe('unchecked');
  expect(seg.label).toBe('body not fully recorded');
});

test('a denied hit on a version 1 record is unchecked and fields say not recorded', () => {
  const old = hit('ga4', 1500, { idFields: undefined, fields: undefined, fieldsComplete: undefined });
  const model = buildReportModel(records({ version: 1, hits: [old] }));
  expect(marksOf(model, 'ga4')[1]).toBe('unchecked');
  expect(model.fields).toBeUndefined();
  expect(model.header.schemaVersion).toBe(1);
});

test('unchecked beats mixed, full and ping', () => {
  const model = buildReportModel(
    records({
      consentEpochs: [epoch('denied', 0, DENIED)],
      hits: [
        hit('ga4', 100, { fieldsComplete: false }),
        hit('ga4', 110),
        hit('ga4', 120, {}, { analytics: 'granted', ads: 'denied', adUserData: 'denied' }),
        hit('ga4', 130, {}, { analytics: 'granted', ads: 'granted', adUserData: 'granted' }),
      ],
    }),
  );
  expect(marksOf(model, 'ga4')).toEqual(['unchecked']);
});

test('a segment with granted and ping hits is mixed, and mixed beats full', () => {
  const both = buildReportModel(
    records({ consentEpochs: [epoch('denied', 0, DENIED)], hits: [hit('ga4', 100, {}, { analytics: 'granted', ads: 'granted' }), hit('ga4', 110, {}, { analytics: 'denied', ads: 'denied' })] }),
  );
  expect(marksOf(both, 'ga4')).toEqual(['mixed']);
  expect(both.rows[0]!.segments[0]!.label).toBe('granted and denied hits');
  const withMixedHit = buildReportModel(
    records({ consentEpochs: [epoch('denied', 0, DENIED)], hits: [hit('ga4', 100, {}, { analytics: 'granted', ads: 'granted' }), hit('ga4', 110, {}, { analytics: 'granted', ads: 'denied' })] }),
  );
  expect(marksOf(withMixedHit, 'ga4')).toEqual(['mixed']);
  expect(withMixedHit.rows[0]!.segments[0]!.label).toBe('some signals denied');
});

test('a hit with an unknown state before an answer is early with the label before an answer', () => {
  const model = buildReportModel(records({ hits: [hit('meta', 500)] }));
  const seg = model.rows[0]!.segments[0]!;
  expect(seg.mark).toBe('early');
  expect(seg.label).toBe('before an answer');
});

test('an unknown state after an answer stays full, and early outranks full in a segment', () => {
  const after = buildReportModel(records({ consentEpochs: [epoch('granted', 0, state())], hits: [hit('meta', 500)] }));
  expect(marksOf(after, 'meta')).toEqual(['full']);
  const both = buildReportModel(records({ hits: [hit('meta', 500), hit('meta', 510, {}, { analytics: 'granted' })] }));
  expect(marksOf(both, 'meta')[0]).toBe('early');
});

test('an early hit does not hide granted and denied hits in the same segment', () => {
  const model = buildReportModel(
    records({
      consentEpochs: [epoch('undecided', 0, state())],
      hits: [hit('ga4', 500), hit('ga4', 510, {}, { analytics: 'granted', ads: 'granted' }), hit('ga4', 520, {}, { analytics: 'denied', ads: 'denied' })],
    }),
  );
  expect(marksOf(model, 'ga4')).toEqual(['mixed']);
  expect(model.rows[0]!.segments[0]!.label).toBe('granted and denied hits');
});

test('evidence from a cannot-evaluate result gives unchecked, not leak', () => {
  const h = hit('ga4', 100, { fieldsComplete: false }, { analytics: 'denied', ads: 'denied' });
  const cannot = result('mustNot: {"vendor":"ga4","in":"epoch(denied)"}', false, { evidence: [h.id], note: 'cannotEvaluateBody' });
  const model = buildReportModel(records({ consentEpochs: [epoch('denied', 0, DENIED)], hits: [h], results: [cannot] }));
  expect(marksOf(model, 'ga4')).toEqual(['unchecked']);
});

test('a hit flagged only through its identifier names is a leak from the deniedIdentifiers evidence', () => {
  const h = hit('ga4', 100, { idFields: [], fields: ['custom_id'] }, { analytics: 'denied', ads: 'denied' });
  const failed = result('builtin: deniedIdentifiers', false, { evidence: [h.id] });
  const epochs = [epoch('denied', 0, DENIED)];
  const without = buildReportModel(records({ consentEpochs: epochs, hits: [h] }));
  expect(marksOf(without, 'ga4')).toEqual(['ping']);
  const model = buildReportModel(records({ consentEpochs: epochs, hits: [h], results: [failed] }));
  expect(marksOf(model, 'ga4')).toEqual(['leak']);
  expect(model.rows[0]!.segments[0]!.label).toBe('identifiers sent while denied');
});

test('a rule shows the value of sentBy', () => {
  const model = buildReportModel(records({ results: [result('mustNot: {"vendor":"ga4","host":"www.google-analytics.com","sentBy":"browser"}', true)] }));
  expect(model.expectations[0]!.text).toBe('mustNot: vendor: ga4, host: www.google-analytics.com, sentBy: browser');
});

test('a result that passed has no severity, one that failed or warned has it', () => {
  const model = buildReportModel(records({ results: [result('builtin: a', true, { severity: 'fail' }), result('builtin: b', false), result('builtin: c', false, { severity: 'warn' })] }));
  expect(model.expectations.map((e) => e.severity)).toEqual([undefined, 'fail', 'warn']);
});

describe('consent-scoped mustNot evidence', () => {
  const failed = (expectation: string, h: Hit) => result(expectation, false, { evidence: [h.id] });
  const granted = () => hit('ga4', 100, {}, { analytics: 'granted', ads: 'granted' });

  test('a failed mustNot with no consent scope leaves a granted hit full', () => {
    const h = granted();
    const model = buildReportModel(records({ consentEpochs: [epoch('granted', 0, GRANTED)], hits: [h], results: [failed('mustNot: {"vendor":"ga4"}', h)] }));
    expect(marksOf(model, 'ga4')).toEqual(['full']);
  });

  test.each([
    ['in epoch(denied)', '{"vendor":"ga4","in":"epoch(denied)"}'],
    ['in epoch(label=denied)', '{"vendor":"ga4","in":"epoch(label=denied)"}'],
    ['in epoch(analytics=denied)', '{"vendor":"ga4","in":"epoch(analytics=denied)"}'],
    ['in epoch(label=withdrawn)', '{"vendor":"ga4","in":"epoch(label=withdrawn)"}'],
    ['consent.ad_storage: denied', '{"vendor":"ga4","consent.ads":"denied"}'],
    ['a nested consent group', '{"vendor":"ga4","consent":{"ads":"denied"}}'],
    ['before consent', '{"vendor":"ga4","before":"consent"}'],
  ])('a failed mustNot with %s marks its hit as leak', (_name, entry) => {
    const h = granted();
    const model = buildReportModel(records({ consentEpochs: [epoch('granted', 0, GRANTED)], hits: [h], results: [failed(`mustNot: ${entry}`, h)] }));
    expect(marksOf(model, 'ga4')).toEqual(['leak']);
  });

  test('a hit named by a rule has its own label, not the identifier one', () => {
    const h = granted();
    const model = buildReportModel(records({ consentEpochs: [epoch('granted', 0, GRANTED)], hits: [h], results: [failed('mustNot: {"vendor":"ga4","in":"epoch(denied)"}', h)] }));
    expect(model.rows[0]!.segments[0]!.label).toBe('named by a failed consent-scoped rule');
  });

  test('a passing consent-scoped mustNot and a cannot-evaluate one mark nothing', () => {
    const h = granted();
    const entry = 'mustNot: {"vendor":"ga4","in":"epoch(denied)"}';
    const model = buildReportModel(
      records({
        consentEpochs: [epoch('granted', 0, GRANTED)],
        hits: [h],
        results: [result(entry, true, { evidence: [h.id] }), result(entry, false, { evidence: [h.id], note: 'cannotEvaluateBody' })],
      }),
    );
    expect(marksOf(model, 'ga4')).toEqual(['full']);
  });
});

test('a custom graceWindow puts a boundary hit in the same epoch as the check', () => {
  const boundary = hit('meta', 900);
  const epochs = [epoch('undecided', 0, state(), 1000), epoch('granted', 1000, GRANTED)];
  const fallback = buildReportModel(records({ consentEpochs: epochs, hits: [boundary] }));
  expect(fallback.rows[0]!.segments.map((s) => s.hits)).toEqual([1, 0]);
  const wide = buildReportModel(records({ consentEpochs: epochs, graceWindowMs: 100, hits: [boundary] }));
  expect(wide.rows[0]!.segments.map((s) => s.hits)).toEqual([0, 1]);
});

test('a real decoded GA4 G100 hit with cid is a ping', () => {
  const request: Request = {
    type: 'request',
    id: newId('request'),
    runId,
    stepId: null,
    t: 1500,
    method: 'GET',
    url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-PWTEST0001&cid=1111111111.2222222222&en=page_view&gcs=G100',
    resourceType: 'image',
    frameUrl: null,
    initiator: null,
    headers: {},
    postData: null,
    outcome: 'stubbed',
  };
  const hits = decodeRequest(request).map((h) => ({ ...h, t: 1500 }));
  const model = buildReportModel(records({ hits }));
  expect(marksOf(model, 'ga4')[1]).toBe('ping');
});

test('expectations: statuses, builtin names, notes and a value-free form', () => {
  const entry = JSON.stringify({ vendor: 'ga4', params: { em: 'pw-fixture@example.com' }, ids: { 'hashes.em': 'abc123' }, page: { matches: 'secret' }, 'body.has': ['user_data'], 'consent.ads': 'denied', in: 'epoch(denied)', from: 'accept' });
  const model = buildReportModel(
    records({
      results: [
        result(`mustNot: ${entry}`, false, { evidence: ['hit_1', 'hit_2', 'hit_3', 'hit_4', 'hit_5', 'hit_6', 'hit_7'], message: 'secret message' }),
        result('builtin: deniedIdentifiers', false, { severity: 'warn' }),
        result('must: {"cookie":"_pwid"}', true, { note: 'stubNoCookies' }),
        result('must: {"body.only":["a"]}', false, { note: 'cannotEvaluateBody' }),
        result('builtin: unknownDestination', true),
      ],
    }),
  );
  const [leak, warn, stub, cannot, builtin] = model.expectations;
  expect(leak!.status).toBe('FAIL');
  expect(leak!.text).toBe('mustNot: vendor: ga4, params.em, ids.hashes.em, page.matches, body.has: user_data, consent.ads: denied, in: epoch(denied), from: accept');
  expect(leak!.evidence).toHaveLength(5);
  expect(leak!.evidenceCount).toBe(7);
  expect(warn).toMatchObject({ status: 'WARN', kind: 'builtin', text: 'builtin: deniedIdentifiers', severity: 'warn' });
  expect(stub!.status).toBe('PASS');
  expect(stub!.note).toContain('stubbed endpoints set no cookies');
  expect(cannot!.status).toBe('CANNOT EVALUATE');
  expect(cannot!.note).toBe('cannot evaluate: body not fully recorded');
  expect(builtin!.status).toBe('PASS');
  expect(JSON.stringify(model)).not.toContain('secret');
  expect(JSON.stringify(model)).not.toContain('pw-fixture');
});

test('an unreadable expectation shows as a bare rule', () => {
  const model = buildReportModel(records({ results: [result('mustNot: {not json pw-fixture@example.com', true)] }));
  expect(model.expectations[0]!.text).toBe('rule');
});

test('flags count by kind and show hosts only', () => {
  const request: Request = {
    type: 'request',
    id: newId('request'),
    runId,
    stepId: null,
    t: 1,
    method: 'GET',
    url: 'https://tracker.example.com/path?secret=1',
    resourceType: 'image',
    frameUrl: null,
    initiator: null,
    headers: {},
    postData: null,
    outcome: 'stubbed',
  };
  const flag = { type: 'flag' as const, id: newId('flag'), runId, kind: 'unknownDestination', recordIds: [request.id], detail: 'GET https://tracker.example.com/path?secret=1' };
  const model = buildReportModel(records({ requests: [request], flags: [flag, { ...flag, id: newId('flag') }] }));
  expect(model.flags).toEqual([{ kind: 'unknownDestination', count: 2, hosts: ['tracker.example.com'] }]);
});

test('platformHost flags carry counts per host', () => {
  const mk = (url: string): Request => ({
    type: 'request', id: newId('request'), runId, stepId: null, t: 1, method: 'GET', url, resourceType: 'image', frameUrl: null,
    initiator: null, headers: {}, postData: null, outcome: 'stubbed',
  });
  const requests = [mk('https://cdn.shopify.com/a?x=1'), mk('https://cdn.shopify.com/b?x=1'), mk('https://other.example.invalid/c?x=1')];
  const flags = requests.map((r) => ({ type: 'flag' as const, id: newId('flag'), runId, kind: 'platformHost', recordIds: [r.id], detail: `GET ${r.url}` }));
  const model = buildReportModel(records({ requests, flags }));
  expect(model.flags).toEqual([
    { kind: 'platformHost', count: 3, hosts: ['cdn.shopify.com', 'other.example.invalid'], hostCounts: [{ host: 'cdn.shopify.com', count: 2 }, { host: 'other.example.invalid', count: 1 }] },
  ]);
});

test('fields list names seen while a signal was denied, and guard value-like names', () => {
  const model = buildReportModel(
    records({
      hits: [
        hit('sgtm', 1500, { fields: ['event_name', 'user_data.email_address', `user_data.${'a'.repeat(64)}`] }),
        hit('sgtm', 500, { fields: ['before_answer_only'] }),
      ],
    }),
  );
  expect(model.fields).toEqual([{ vendor: 'sgtm', names: ['event_name', 'user_data.(other)', 'user_data.email_address'] }]);
});

test('the header keeps the host only', () => {
  const model = buildReportModel(records());
  expect(model.header.host).toBe('127.0.0.1:4000');
  expect(model.header.networkMode).toBe('stub');
});

describe('earlyIdentifiers evidence', () => {
  const early = (over: Partial<Hit> = {}) => hit('meta', 100, { idFields: [], fields: ['fbp'], ...over });
  const check = (evidence: string[], over: Partial<Result> = {}) => result('builtin: earlyIdentifiers', false, { evidence, severity: 'warn', ...over });

  test('a hit in the evidence is a leak with its own label, and one outside it stays early', () => {
    const flagged = early({ idFields: ['ud[em]'], fields: ['ud[em]'] });
    const clean = early();
    expect(marksOf(buildReportModel(records({ hits: [clean], results: [check([flagged.id])] })), 'meta')).toEqual(['early', 'nothing', 'nothing']);
    const model = buildReportModel(records({ hits: [flagged], results: [check([flagged.id])] }));
    expect(marksOf(model, 'meta')).toEqual(['leak', 'nothing', 'nothing']);
    expect(model.rows[0]!.segments[0]!.label).toBe('identifiers sent before an answer');
  });

  test('the label from deniedIdentifiers wins when a hit is in both results', () => {
    const h = early({ idFields: ['ud[em]'], fields: ['ud[em]'] });
    const denied = result('builtin: deniedIdentifiers', false, { evidence: [h.id], severity: 'warn' });
    for (const results of [[check([h.id]), denied], [denied, check([h.id])]]) {
      const model = buildReportModel(records({ hits: [h], results }));
      expect(model.rows[0]!.segments[0]!.label).toBe('identifiers sent while denied');
    }
  });

  test('a segment holding both identifier labels reads as the denied label', () => {
    const a = early({ idFields: ['ud[em]'], fields: ['ud[em]'] });
    const b = early({ idFields: ['ud[em]'], fields: ['ud[em]'] });
    const denied = result('builtin: deniedIdentifiers', false, { evidence: [b.id], severity: 'warn' });
    const model = buildReportModel(records({ hits: [a, b], results: [check([a.id]), denied] }));
    expect(model.rows[0]!.segments[0]!.label).toBe('identifiers sent while denied');
  });

  test('a cannot-evaluate result marks nothing', () => {
    const h = early();
    const model = buildReportModel(records({ hits: [h], results: [check([h.id], { note: 'fieldsNotRecorded' })] }));
    expect(marksOf(model, 'meta')).toEqual(['early', 'nothing', 'nothing']);
  });
});

describe('deniedIdentifiers evidence', () => {
  const denied = () => hit('sgtm', 1500);
  const failedCheck = (h: Hit, severity: 'fail' | 'warn') => result('builtin: deniedIdentifiers', false, { evidence: [h.id], severity });

  test('every evidence hit marks its own segment as a leak', () => {
    const early = hit('sgtm', 500);
    const late = denied();
    const check = result('builtin: deniedIdentifiers', false, { evidence: [early.id, late.id], severity: 'warn' });
    const model = buildReportModel(records({ hits: [early, late], results: [check] }));
    expect(marksOf(model, 'sgtm')).toEqual(['leak', 'leak', 'nothing']);
  });

  test.each(['fail', 'warn'] as const)('a denied hit with no idFields named in a failed check at %s is a leak, not a ping', (severity) => {
    const h = denied();
    expect(marksOf(buildReportModel(records({ hits: [h] })), 'sgtm')).toEqual(['nothing', 'ping', 'nothing']);
    const model = buildReportModel(records({ hits: [h], results: [failedCheck(h, severity)] }));
    expect(marksOf(model, 'sgtm')).toEqual(['nothing', 'leak', 'nothing']);
    expect(model.rows[0]!.segments[1]!.label).toBe('identifiers sent while denied');
  });

  test('a passing check and a cannot-evaluate check mark nothing', () => {
    const h = denied();
    const model = buildReportModel(
      records({ hits: [h], results: [result('builtin: deniedIdentifiers', true, { evidence: [h.id] }), result('builtin: deniedIdentifiers', false, { evidence: [h.id], note: 'cannotEvaluateBody' })] }),
    );
    expect(marksOf(model, 'sgtm')).toEqual(['nothing', 'ping', 'nothing']);
  });
});

describe('server container hits', () => {
  function server(vendor: string, t: number, via: Hit | undefined, confidence: 'exact' | 'probable' = 'exact'): { hit: Hit; request: Request } {
    const request = { type: 'request', id: newId('request'), runId, captured: 'serverContainer' } as unknown as Request;
    return { request, hit: hit(vendor, t, { requestId: request.id, ...(via && { via: { hitId: via.id, by: 'eventId', confidence } }) }) };
  }

  const via = hit('meta', 500);

  test('a linked server hit is placed in the epoch of its via hit and has its own row', () => {
    const sent = server('meta-capi', 2500, via);
    const model = buildReportModel(records({ hits: [via, sent.hit], requests: [sent.request] }));
    expect(model.columns.map((c) => c.label)).toEqual(['undecided', 'denied', 'withdrawn']);
    const row = model.rows.find((r) => r.vendor === 'meta-capi')!;
    expect(row.server).toBe(true);
    expect(row.segments.map((s) => s.hits)).toEqual([1, 0, 0]);
    expect(model.rows.find((r) => r.vendor === 'meta')!.server).toBeUndefined();
    expect(model.serverContainer).toEqual({ hits: 1, exact: 1, probable: 0, unlinked: 0 });
  });

  test('a probable link is counted in its segment', () => {
    const sent = server('meta-capi', 2500, via, 'probable');
    const model = buildReportModel(records({ hits: [via, sent.hit], requests: [sent.request] }));
    expect(model.rows.find((r) => r.server)!.segments[0]).toMatchObject({ hits: 1, probable: 1 });
    expect(model.serverContainer).toMatchObject({ probable: 1, exact: 0 });
  });

  test('an unlinked hit is in a column after the last epoch', () => {
    const sent = server('meta-capi', 500, undefined);
    const model = buildReportModel(records({ hits: [via, sent.hit], requests: [sent.request] }));
    expect(model.columns.map((c) => c.label)).toEqual(['undecided', 'denied', 'withdrawn', 'unlinked']);
    const segments = model.rows.find((r) => r.server)!.segments;
    expect(segments.map((s) => s.hits)).toEqual([0, 0, 0, 1]);
    expect(segments[3]).toMatchObject({ mark: 'full', label: 'no link to a browser hit' });
    expect(model.serverContainer).toMatchObject({ unlinked: 1 });
  });

  test('an unlinked hit with identifier names cannot be called clean', () => {
    const sent = server('meta-capi', 500, undefined);
    sent.hit.idFields = ['user_data.em[]'];
    const model = buildReportModel(records({ hits: [sent.hit], requests: [sent.request] }));
    expect(model.rows[0]!.segments.at(-1)).toMatchObject({ mark: 'unchecked', label: 'no link to a browser hit, consent state unknown' });
  });

  test('a result that could not judge an unlinked hit is cannot evaluate and names no leak', () => {
    const sent = server('meta-capi', 500, undefined);
    const unjudged = result('builtin: deniedIdentifiers', false, { severity: 'warn', note: 'serverSendUnlinked', evidence: [sent.hit.id] });
    const model = buildReportModel(records({ hits: [sent.hit], requests: [sent.request], results: [unjudged] }));
    expect(model.expectations[0]).toMatchObject({ status: 'CANNOT EVALUATE' });
    expect(model.rows[0]!.segments.some((s) => s.mark === 'leak')).toBe(false);
  });

  test('the tag report notes have their texts', () => {
    const noReports = result('tag: GA4', false, { severity: 'warn', note: 'noTagReports' });
    const noName = result('tag: GA4', false, { severity: 'warn', note: 'tagNameUnknown' });
    const model = buildReportModel(records({ results: [noReports, noName] }));
    expect(model.expectations[0]!.note).toBe('cannot evaluate: no tag report from this container. For web tags, install the reporter and run with --gtm-override: tagreeve template web --json');
    expect(model.expectations[0]!.note).toContain(TAG_REPORTER_HINT);
    expect(model.expectations.map((e) => e.status)).toEqual(['CANNOT EVALUATE', 'CANNOT EVALUATE']);
    expect(model.expectations[1]!.note).toBe('cannot evaluate: the tag has no name in its report or in expectedTags');
  });

  test('an unlinked hit named in the evidence of a failed exact leak is not marked as a leak', () => {
    const sent = server('meta-capi', 500, undefined);
    sent.hit.idFields = ['user_data.em[]'];
    const failed = result('builtin: deniedIdentifiers', false, { evidence: [sent.hit.id] });
    const model = buildReportModel(records({ hits: [sent.hit], requests: [sent.request], results: [failed] }));
    expect(model.rows[0]!.segments.some((s) => s.mark === 'leak')).toBe(false);
    expect(model.rows[0]!.segments.at(-1)).toMatchObject({ mark: 'unchecked' });
  });

  test('a run with no server hit has no serverContainer field and no server row', () => {
    const model = buildReportModel(records({ hits: [via] }));
    expect(model).not.toHaveProperty('serverContainer');
    expect(model.rows.some((r) => r.server)).toBe(false);
  });
});

test('the header carries the run label and has no key without one', () => {
  const base = records();
  expect(buildReportModel({ ...base, run: { ...base.run, label: 'ca-307' } }).header.label).toBe('ca-307');
  expect(buildReportModel(base).header).not.toHaveProperty('label');
});

describe('identifier routes', () => {
  const searchFlag = (): Flag => ({
    type: 'flag',
    id: newId('flag'),
    runId,
    kind: 'canarySearch',
    recordIds: [],
    detail: 'Searched 1 request to non-first-party hosts for 2 values as plain text, URL-encoded, base64, base64url and SHA-256 (hex, base64, base64url). Searched: URL, body and decoded fields. Not searched: headers (Referer and Cookie). Skipped: compressed or binary body 0, body cut at 64 KiB 0, net-log request with no body 0.',
  });
  const sinkRequest = (t: number): Request => ({
    type: 'request',
    id: newId('request'),
    runId,
    stepId: null,
    t,
    method: 'GET',
    url: 'https://ads.example.test/c?x=abc',
    resourceType: 'image',
    frameUrl: null,
    initiator: null,
    headers: {},
    postData: null,
    outcome: 'stubbed',
  });
  const routeFlag = (request: Request, kind: 'direct' | 'pageUrl' | 'unknown'): Flag => ({
    type: 'flag',
    id: newId('flag'),
    runId,
    kind: 'identifierRoute',
    recordIds: [request.id],
    detail: 'url param gclid -> request',
    route: { kind, source: { source: 'urlParam', name: 'gclid' }, sink: { requestId: request.id, host: 'ads.example.test', vendor: 'unknown', field: 'x', transform: 'base64' }, hops: [] },
  });

  test('each route gets its own verdict and the epoch of its sink', () => {
    const denied = sinkRequest(1500);
    const granted = sinkRequest(2500);
    const model = buildReportModel(
      records({
        consentEpochs: [epoch('undecided', 0, state(), 1000), epoch('denied', 1000, DENIED, 2000), epoch('granted', 2000, GRANTED)],
        requests: [denied, granted],
        flags: [searchFlag(), routeFlag(denied, 'direct'), routeFlag(denied, 'pageUrl'), routeFlag(granted, 'direct')],
      }),
    );
    expect(model.routes!.rows.map((r) => [r.epoch, r.verdict])).toEqual([['denied', 'FAIL'], ['denied', 'WARN'], ['granted', 'PASS']]);
    expect(model.routes!.search).toMatchObject({ requests: 1, skipped: 0, reasons: [] });
  });

  test('a stored warn severity turns a failing row into WARN', () => {
    const denied = sinkRequest(1500);
    const model = buildReportModel(
      records({
        consentEpochs: [epoch('denied', 0, DENIED)],
        requests: [denied],
        flags: [searchFlag(), routeFlag(denied, 'direct')],
        results: [result('builtin: identifierRoute', false, { severity: 'warn', evidence: [denied.id] })],
      }),
    );
    expect(model.routes!.rows.map((r) => r.verdict)).toEqual(['WARN']);
  });

  test('a row whose request is not in the stored evidence reads PASS', () => {
    const denied = sinkRequest(1500);
    const model = buildReportModel(
      records({
        consentEpochs: [epoch('denied', 0, DENIED)],
        requests: [denied],
        flags: [searchFlag(), routeFlag(denied, 'direct')],
        results: [result('builtin: identifierRoute', true, { severity: 'fail' })],
      }),
    );
    expect(model.routes!.rows.map((r) => r.verdict)).toEqual(['PASS']);
  });

  const NAMES = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'];
  const hostRequest = (t: number, host: string): Request => ({ ...sinkRequest(t), url: `https://${host}/c?x=abc` });
  const namedRoute = (request: Request, name: string, over: { host?: string; field?: string; transform?: string; kind?: 'direct' | 'pageUrl' | 'unknown'; hops?: NonNullable<Flag['route']>['hops'] } = {}): Flag => {
    const flag = routeFlag(request, over.kind ?? 'direct');
    const route = flag.route!;
    return {
      ...flag,
      route: {
        ...route,
        source: { source: 'urlParam', name },
        sink: { ...route.sink, host: over.host ?? route.sink.host, field: over.field ?? route.sink.field, transform: (over.transform ?? route.sink.transform) as typeof route.sink.transform },
        hops: over.hops ?? [],
      },
    };
  };
  const sevenRequests = (host: string, t = 1500) => Array.from({ length: 7 }, (_, i) => hostRequest(t + i, host));
  const fanOut = (requests: Request[]) => requests.flatMap((q) => NAMES.map((n) => namedRoute(q, n, { host: new URL(q.url).host })));
  const routeFlagCount = (flags: Flag[]) => flags.filter((f) => f.kind === 'identifierRoute').length;

  test('6 canaries in 7 requests to one host make one row', () => {
    const requests = sevenRequests('ads.example.test');
    const flags = fanOut(requests);
    expect(routeFlagCount(flags)).toBe(42);
    expect(new Set(flags.map((f) => f.route!.sink.requestId)).size).toBe(7);
    const { rows } = buildReportModel(records({ consentEpochs: [epoch('denied', 0, DENIED)], requests, flags: [searchFlag(), ...flags] })).routes!;
    expect(rows).toHaveLength(1);
    for (const name of NAMES) expect(rows[0]!.line).toContain(name);
    expect(rows[0]!.line).toContain('7 requests');
    expect(rows[0]).toMatchObject({ flags: 42, requests: 7, verdict: 'FAIL', epoch: 'denied', host: 'ads.example.test' });
  });

  test('the same routes to a second host make two rows', () => {
    const a = sevenRequests('ads.example.test');
    const b = sevenRequests('other.example.test', 1600);
    const flags = [...fanOut(a), ...fanOut(b)];
    expect(new Set(flags.map((f) => f.route!.sink.host)).size).toBe(2);
    const { rows } = buildReportModel(records({ consentEpochs: [epoch('denied', 0, DENIED)], requests: [...a, ...b], flags: [searchFlag(), ...flags] })).routes!;
    expect(rows.map((r) => r.host)).toEqual(['ads.example.test', 'other.example.test']);
    for (const row of rows) {
      for (const name of NAMES) expect(row.line).toContain(name);
      expect(row.line).toContain('7 requests');
    }
    expect(rows.reduce((n, r) => n + r.flags, 0)).toBe(84);
  });

  test('a direct FAIL route and a pageUrl WARN route stay two rows', () => {
    const q = hostRequest(1500, 'ads.example.test');
    const { rows } = buildReportModel(
      records({ consentEpochs: [epoch('denied', 0, DENIED)], requests: [q], flags: [searchFlag(), namedRoute(q, 'gclid'), namedRoute(q, 'gclid', { kind: 'pageUrl' })] }),
    ).routes!;
    expect(rows.map((r) => [r.verdict, r.flags])).toEqual([['FAIL', 1], ['WARN', 1]]);
  });

  test('a FAIL route is never shown under a PASS row', () => {
    const first = hostRequest(1500, 'ads.example.test');
    const second = hostRequest(1501, 'ads.example.test');
    const evidence = [first.id];
    expect(evidence).not.toContain(second.id);
    const { rows } = buildReportModel(
      records({
        consentEpochs: [epoch('denied', 0, DENIED)],
        requests: [first, second],
        flags: [searchFlag(), namedRoute(first, 'gclid'), namedRoute(second, 'gclid')],
        results: [result('builtin: identifierRoute', false, { severity: 'fail', evidence })],
      }),
    ).routes!;
    expect(rows.map((r) => [r.verdict, r.flags, r.requests])).toEqual([['FAIL', 1, 1], ['PASS', 1, 1]]);
  });

  test.each([
    ['field', { field: 'y' }],
    ['transform', { transform: 'plain' }],
    ['kind', { kind: 'unknown' as const }],
    ['epoch', { later: true }],
  ])('routes that differ only in %s are two rows', (_name, change) => {
    const first = hostRequest(1500, 'ads.example.test');
    const second = hostRequest('later' in change ? 2500 : 1501, 'ads.example.test');
    const a = namedRoute(first, 'gclid', { field: 'x', transform: 'base64', kind: 'direct' });
    const { later, ...over } = change as { later?: boolean; field?: string; transform?: string; kind?: 'unknown' };
    const b = namedRoute(second, 'fbclid', { field: 'x', transform: 'base64', kind: 'direct', ...over });
    const differing = [a.route!.sink.field !== b.route!.sink.field, a.route!.sink.transform !== b.route!.sink.transform, a.route!.kind !== b.route!.kind, Boolean(later)];
    expect(differing.filter(Boolean)).toHaveLength(1);
    const { rows } = buildReportModel(
      records({
        consentEpochs: [epoch('denied', 0, DENIED, 2000), epoch('undecided', 2000, state())],
        requests: [first, second],
        flags: [searchFlag(), a, b],
        results: [result('builtin: identifierRoute', false, { severity: 'fail', evidence: [first.id, second.id] })],
      }),
    ).routes!;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.verdict === 'FAIL')).toBe(true);
  });

  test('two routes that differ only in source name share one row', () => {
    const q = hostRequest(1500, 'ads.example.test');
    const { rows } = buildReportModel(records({ consentEpochs: [epoch('denied', 0, DENIED)], requests: [q], flags: [searchFlag(), namedRoute(q, 'gclid'), namedRoute(q, 'fbclid')] })).routes!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.line).toContain('gclid');
    expect(rows[0]!.line).toContain('fbclid');
  });

  test('a cookie hop name stays in the row', () => {
    const q = hostRequest(1500, 'ads.example.test');
    const flag = namedRoute(q, 'gclid', { hops: [{ kind: 'cookie', name: '_gcl_aw' }] as never });
    const { rows } = buildReportModel(records({ consentEpochs: [epoch('denied', 0, DENIED)], requests: [q], flags: [searchFlag(), flag] })).routes!;
    expect(rows[0]!.line).toContain('url param gclid via cookie _gcl_aw');
  });

  test('routes whose sink request is missing group into one unknown-epoch row', () => {
    const ghost = hostRequest(1500, 'ads.example.test');
    const flags = [namedRoute(ghost, 'gclid'), namedRoute(ghost, 'fbclid')];
    const input = records({ consentEpochs: [epoch('denied', 0, DENIED)], requests: [], flags: [searchFlag(), ...flags] });
    expect(input.requests.some((r) => r.id === ghost.id)).toBe(false);
    const { rows } = buildReportModel(input).routes!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.epoch).toBe('unknown');
    expect(rows[0]!.line).toContain('gclid');
    expect(rows[0]!.line).toContain('fbclid');
    expect(rows[0]!.line).toContain('1 request');
    expect(rows[0]!.line).not.toContain('1 requests');
  });

  test('a run without a canarySearch flag has no routes view', () => {
    expect(buildReportModel(records())).not.toHaveProperty('routes');
  });
});
