import { newId, type ConsentEpoch, type Hit, type Request, type RunRecords } from '@tagreeve/core';
import { meta } from '@tagreeve/decoders';
import { describe, expect, test } from 'vitest';
import { stateTable, type RecordsByState } from './state-table.ts';

const state = { analytics: 'denied', ads: 'denied', adUserData: 'denied', adPersonalization: 'denied' } as const;
const consent = { ...state, raw: {} };

function makeRun(labels: ConsentEpoch['label'][] = ['undecided']): RunRecords {
  const runId = newId('run');
  return {
    run: {
      type: 'run', id: runId, recordSchemaVersion: 5, scenario: 's', site: 'http://localhost:3000', startedAt: 0,
      pingwrightVersion: '0.8.0', browser: { name: 'chromium', version: '1' }, networkMode: 'stub', gtmOverride: null,
      containerVersions: {}, identity: null,
    },
    steps: [], requests: [], responses: [], hits: [], dataLayerEvents: [], tagReports: [],
    consentEpochs: labels.map((label, i) => ({ type: 'consentEpoch', id: newId('consentEpoch'), runId, startT: i * 1000, endT: null, source: 'test', label, state })),
    checkpoints: [], results: [], flags: [], collectorReports: [], invalidReports: [],
  } as RunRecords;
}

function hit(run: RunRecords, over: Partial<Hit>): Hit {
  const h = {
    type: 'hit', id: newId('hit'), runId: run.run.id, stepId: null, requestId: newId('request'), t: 0, vendor: 'ga4',
    event: 'page_view', consent, ids: {}, page: null, transport: 'GET', params: {}, fields: ['cid', 'en'], ...over,
  } as Hit;
  run.hits.push(h);
  return h;
}

const listsOf = (t: ReturnType<typeof stateTable>, vendor: string, s: 'reject' | 'none' | 'withdraw') => t.vendors.find((v) => v.vendor === vendor)?.notInAccept[s];

function distinct(extra: (name: string) => string[]): RecordsByState {
  const accept = makeRun();
  hit(accept, {});
  const reject = makeRun();
  hit(reject, {});
  hit(reject, { fields: extra('x_reject') });
  hit(reject, { event: 'reject_only' });
  hit(reject, { vendor: 'meta', event: null, fields: [] });
  const none = makeRun();
  hit(none, {});
  hit(none, { fields: extra('x_none') });
  hit(none, { event: 'none_only' });
  hit(none, { vendor: 'tiktok', event: null, fields: [] });
  const withdraw = makeRun(['undecided', 'granted', 'withdrawn']);
  hit(withdraw, { t: 2500, fields: extra('x_withdraw') });
  hit(withdraw, { t: 2500, event: 'withdraw_only' });
  hit(withdraw, { t: 2500, vendor: 'pinterest', event: null, fields: [] });
  hit(withdraw, { t: 100 });
  return { accept: [accept], reject: [reject], none: [none], withdraw: [withdraw] };
}

describe('not in accept', () => {
  test('each state lists only its own vendors, events and fields', () => {
    const t = stateTable(distinct((n) => ['cid', 'en', n]));
    expect(listsOf(t, 'ga4', 'reject')).toEqual({ events: ['reject_only'], fields: ['x_reject'] });
    expect(listsOf(t, 'ga4', 'none')).toEqual({ events: ['none_only'], fields: ['x_none'] });
    expect(listsOf(t, 'ga4', 'withdraw')).toEqual({ events: ['withdraw_only'], fields: ['x_withdraw'] });
    expect(t.vendorsNotInAccept).toEqual({ reject: ['meta'], none: ['tiktok'], withdraw: ['pinterest'] });
    expect(t.vendors.find((v) => v.vendor === 'ga4')!.notInAccept).not.toHaveProperty('accept');
  });

  test('a field name that accept also has is not listed', () => {
    const t = stateTable(distinct(() => ['cid', 'en']));
    for (const s of ['reject', 'none', 'withdraw'] as const) expect(listsOf(t, 'ga4', s)!.fields).toEqual([]);
  });
});

describe('the epoch filter', () => {
  function rejectWithLateHit(t: number) {
    const reject = makeRun(['undecided', 'denied', 'granted']);
    hit(reject, { t: 500 });
    const late = hit(reject, { t, event: 'late', fields: ['cid', 'x_late'], ids: { x_id: true } });
    return { reject, late };
  }

  test('a granted-epoch hit is left out of count, events, fields and ID names', () => {
    const { reject, late } = rejectWithLateHit(2500);
    expect(late.t).toBeGreaterThanOrEqual(2000);
    expect(reject.hits.filter((h) => h !== late).some((h) => h.event === 'late' || h.fields?.includes('x_late') || h.ids.x_id)).toBe(false);
    const cell = stateTable({ reject: [reject] }).vendors[0]!.states.reject!;
    expect(cell.hits).toBe(1);
    expect(cell.events).toEqual(['page_view']);
    expect(cell.fields).toEqual(['cid', 'en']);
    expect(cell.ids).toEqual([]);
  });

  test('the same hit in the denied epoch is counted', () => {
    const { reject } = rejectWithLateHit(1500);
    const cell = stateTable({ reject: [reject] }).vendors[0]!.states.reject!;
    expect(cell.hits).toBe(2);
    expect(cell.events).toEqual(['late', 'page_view']);
    expect(cell.fields).toContain('x_late');
    expect(cell.ids).toEqual(['x_id']);
  });
});

describe('event names', () => {
  test('value-like event text is counted as a hit and stored as other', () => {
    const run = makeRun();
    hit(run, { event: 'page_view' });
    hit(run, { event: 'jane.doe@example.test' });
    hit(run, { event: 'x'.repeat(65) });
    const cell = stateTable({ accept: [run] }).vendors[0]!.states.accept!;
    expect(cell.hits).toBe(3);
    expect(cell.events).toEqual(['(other)', 'page_view']);
  });

  test('phone, client ID, UUID and hash event names are counted and stored as other', () => {
    const values = ['4512345678', '1234567890.1234567890', '550e8400-e29b-41d4-a716-446655440000', 'd41d8cd98f00b204e9800998ecf8427e'];
    const run = makeRun();
    hit(run, { event: 'page_view' });
    for (const event of values) hit(run, { event });
    expect(run.hits.map((h) => h.event)).toEqual(['page_view', ...values]);
    const table = stateTable({ accept: [run] });
    expect(table.vendors[0]!.states.accept!.hits).toBe(5);
    const json = JSON.stringify(table);
    for (const v of values) expect(json).not.toContain(v);
    expect(table.vendors[0]!.states.accept!.events).toEqual(['(other)', 'page_view']);
  });

  test('value-like field names are stored as other', () => {
    const run = makeRun();
    hit(run, { fields: ['cid', 'jane.doe@example.test', '4512345678'] });
    const cell = stateTable({ accept: [run] }).vendors[0]!.states.accept!;
    expect(cell.fields).toEqual(['(other)', 'cid']);
  });

  test('a Meta hit with an email and a phone as ud[] keys leaves neither in the table', () => {
    const run = makeRun();
    const request = {
      type: 'request', id: newId('request'), runId: run.run.id, stepId: null, t: 0, method: 'GET',
      url: 'https://www.facebook.com/tr?id=100000000000001&ev=PageView&ud[jane.doe@example.test]=abc&ud[4512345678]=x',
      resourceType: 'image', frameUrl: 'http://localhost:3000/', initiator: null, headers: {}, postData: null, outcome: 'stubbed',
    } as Request;
    const hits = meta.decode(request);
    expect(hits.length).toBe(1);
    for (const h of hits) run.hits.push({ ...h, runId: run.run.id });
    const table = stateTable({ accept: [run] });
    const json = JSON.stringify(table);
    expect(json).not.toContain('jane.doe@example.test');
    expect(json).not.toContain('4512345678');
    expect(table.vendors[0]!.states.accept!.ids).toContain('(other)');
  });
});

describe('counts', () => {
  test('accept counts every hit, withdraw only the withdrawn epoch, none leaves out a granted epoch', () => {
    const accept = makeRun(['undecided', 'granted']);
    hit(accept, { t: 100 });
    hit(accept, { t: 1500 });
    const withdraw = makeRun(['undecided', 'granted', 'withdrawn']);
    hit(withdraw, { t: 100 });
    hit(withdraw, { t: 1500 });
    hit(withdraw, { t: 2500 });
    const none = makeRun(['undecided', 'granted']);
    hit(none, { t: 100 });
    const granted = hit(none, { t: 1500, event: 'g', fields: ['x_g'], ids: { gid: true } });
    expect(granted.t).toBeGreaterThanOrEqual(1000);
    const states = stateTable({ accept: [accept], none: [none], withdraw: [withdraw] }).vendors[0]!.states;
    expect(states.accept!.hits).toBe(2);
    expect(states.withdraw!.hits).toBe(1);
    expect(states.none!.hits).toBe(1);
    expect(states.none!.events).not.toContain('g');
    expect(states.none!.fields).not.toContain('x_g');
    expect(states.none!.ids).toEqual([]);
    const moved = makeRun(['undecided', 'granted']);
    hit(moved, { t: 100 });
    hit(moved, { t: 200 });
    expect(stateTable({ none: [moved] }).vendors[0]!.states.none!.hits).toBe(2);
  });

  test('vendors count apart, and names come from fields and ids', () => {
    const run = makeRun();
    hit(run, { vendor: 'ga4', ids: { client_id: true } });
    hit(run, { vendor: 'google-ads', ids: { client_id: true } });
    const t = stateTable({ accept: [run] });
    expect(t.vendors.map((v) => [v.vendor, v.states.accept!.hits])).toEqual([['ga4', 1], ['google-ads', 1]]);
    expect(t.vendors[0]!.states.accept).toMatchObject({ fields: ['cid', 'en'], ids: ['client_id'] });
  });

  test('names only: a field value in params is not in the output', () => {
    const run = makeRun();
    hit(run, { params: { cid: 'secret-value-123' } });
    expect(JSON.stringify(stateTable({ accept: [run] }))).not.toContain('secret-value-123');
  });

  test('without accept records no not-in-accept lists are built', () => {
    const reject = makeRun();
    hit(reject, { fields: ['cid', 'x_reject'] });
    const t = stateTable({ reject: [reject] });
    expect(t.vendors[0]!.states.reject!.hits).toBe(1);
    expect(t.vendors[0]!.notInAccept).toEqual({});
    expect(t.vendorsNotInAccept).toEqual({});
  });
});
