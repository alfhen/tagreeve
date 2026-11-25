import { fileURLToPath } from 'node:url';
import { newId, readRun, type ConsentEpoch, type Hit, type Request, type RunRecords } from '@tagreeve/core';
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

describe('spaced and coloned event names', () => {
  const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const MD5 = 'd41d8cd98f00b204e9800998ecf8427e';
  const UUID = '550e8400-e29b-41d4-a716-446655440000';
  const PHONE = '4512345678';
  const CLICK = 'abc1defg2hijk3lmno4pqrs5tuvw6xyz7';

  const chunks = (s: string, w: number, sep: string) => s.match(new RegExp(`.{1,${w}}`, 'g'))!.join(sep);
  const OTHER = '(other)';

  function eventsOf(names: string[]) {
    const run = makeRun();
    for (const event of names) hit(run, { event });
    expect(run.hits.map((h) => h.event)).toEqual(names);
    const table = stateTable({ accept: [run] });
    return { table, events: table.vendors[0]!.states.accept!.events };
  }

  function expectOther(names: string[], mustNot: string[] = []) {
    for (const name of names) {
      const { table, events } = eventsOf([name]);
      expect(events, name).toEqual([OTHER]);
      const json = JSON.stringify(table);
      for (const m of [name, ...mustNot]) expect(json, name).not.toContain(m);
    }
  }

  test('names with spaces or a colon read as themselves', () => {
    const { events } = eventsOf(['Add To Wishlist', 'Start Trial', 'gtm:foo', 'Step 1 of 3', 'Level 10 Complete', 'page_view']);
    expect(events).toEqual(['Add To Wishlist', 'Level 10 Complete', 'Start Trial', 'Step 1 of 3', 'gtm:foo', 'page_view']);
  });

  test('a phone number split by spaces, - or . reads other', () => {
    expectOther(
      ['4512 3456 78', '45 12 34 56 7 8', '45 12 34 56 78 call', 'call us 45 12 34 56 78', 'Order 45 12 34 56 78', '45-12-34-56-78 call', 'call 45.12.34.56.78', 'tel:4512345678', '451 23 subscription 45 678'],
      [PHONE],
    );
  });

  test('a hash split into words reads other', () => {
    const names = [
      chunks(SHA, 8, ' '), chunks(SHA, 1, ' '), chunks(SHA, 16, ' '), `${SHA.slice(0, 30)} ${SHA.slice(30)}`,
      `Hash ${chunks(SHA, 8, ' ')}`, `${chunks(SHA, 8, ' ')} Hash`, `${SHA.slice(0, 32)} hash ${SHA.slice(32)}`,
      chunks(MD5, 8, ' '), `Hash ${chunks(MD5, 8, ' ')}`, `${chunks(MD5, 8, ' ')} Hash`, `${MD5.slice(0, 16)} ${MD5.slice(16)}`,
      'abcdef12abcdef34 hash abcdef56abcdef78',
    ];
    expectOther(names);
    const { table } = eventsOf(names);
    expect(JSON.stringify(table)).not.toMatch(/[0-9a-f]{8}/);
  });

  test('a UUID split or written with spaces reads other', () => {
    const forms = ['550e8400 e29b 41d4 a716 446655440000', '550e8400-e29b 41d4-a716 446655440000', '550e84 00-e29b-41d4 a716-4466 55440000'];
    expectOther([...forms, ...forms.map((f) => `Id ${f}`), ...forms.map((f) => `${f} id`)], ['446655440000']);
  });

  test('an @, over 64 characters or over 6 words reads other', () => {
    const long = Array(6).fill('m'.repeat(10)).join(' ');
    expect(long.length).toBe(65);
    expectOther(['a b@c.com', 'x user @ example.com', long, 'a b c d e f g'], ['b@c.com', 'example.com']);
  });

  test('digits spread over a name are capped at 3', () => {
    expect(eventsOf(['1 2 3', '1 2 3 4']).events).toEqual([OTHER, '1 2 3']);
  });

  test('up to 6 words and 64 characters read as themselves, one more does not', () => {
    const ok = `${'m'.repeat(10)} `.repeat(5) + 'm'.repeat(9);
    const long = `${'m'.repeat(10)} `.repeat(5) + 'm'.repeat(10);
    expect([ok.length, long.length]).toEqual([64, 65]);
    expect(eventsOf(['kz kz kz kz kz kz', 'kz kz kz kz kz kz kz', ok, long]).events).toEqual([OTHER, 'kz kz kz kz kz kz', ok]);
  });

  test('a span of words that reads as a value as a whole reads other', () => {
    const names = ['AbCdEfGh IjKlMnOp QrStUv1w', 'Start AbCdEfGh IjKlMnOp QrStUv1w', 'AbCdEfGhIjKlMnOpQrStUv1w Start', 'abcdefab cdefabcd efabcdef abcdefab', 'Token abcdefab cdefabcd efabcdef abcdefab'];
    for (const n of names) expect((n.match(/\d/g) ?? []).length).toBeLessThanOrEqual(3);
    expectOther(names, ['AbCdEfGh', 'abcdefab']);
  });

  test('a value joined by : or . inside a word reads other', () => {
    expectOther(
      ['ref:AbCdEfGhIjKlMnOpQrStUv1w', 'AbCdEfGh:IjKlMnOp:QrStUv1w', 'x:abcdefabcdefabcdefabcdefabcdefab', 'Start x.AbCdEfGhIjKlMnOpQrStUv1w', 'Token abcdefab.cdefabcd.efabcdef.abcdefab'],
      ['AbCdEfGh', 'abcdefab'],
    );
  });

  test('two spaced custom events stay apart in notInAccept', () => {
    const accept = makeRun();
    hit(accept, {});
    hit(accept, { event: 'Start Trial' });
    const reject = makeRun();
    hit(reject, {});
    hit(reject, { event: 'Add To Wishlist' });
    expect(accept.hits.map((h) => h.event)).toContain('Start Trial');
    expect(reject.hits.map((h) => h.event)).toContain('Add To Wishlist');
    expect(listsOf(stateTable({ accept: [accept], reject: [reject] }), 'ga4', 'reject')!.events).toEqual(['Add To Wishlist']);
  });

  test('no split of a phone number, hash, UUID or click ID reads as itself', () => {
    const started = performance.now();
    const built: Array<{ name: string; value: string }> = [];
    const withPlain = (value: string, names: string[]) => {
      for (const n of names) built.push({ name: n, value }, { name: `Start ${n}`, value }, { name: `${n} Start`, value });
    };
    const splits = (v: string, seps: string[]) => {
      const out: string[] = [];
      for (const sep of seps) {
        for (let i = 1; i < v.length; i++) out.push(`${v.slice(0, i)}${sep}${v.slice(i)}`);
        for (const w of [1, 2, 3, 5, 8, 16]) out.push(chunks(v, w, sep));
      }
      return out;
    };
    withPlain(PHONE, splits(PHONE, [' ', '-']));
    withPlain(SHA, splits(SHA, [' ', '-']));
    withPlain(MD5, splits(MD5, [' ', '-']));
    withPlain(UUID, splits(UUID, [' ', '-']));
    withPlain(CLICK, splits(CLICK, [' ']));
    built.push({ name: `Start ${CLICK}`, value: CLICK }, { name: `${CLICK} Start`, value: CLICK });
    for (const { name, value } of built) {
      expect(name.replaceAll(/[ -]/g, '').includes(value.replaceAll('-', '')), name).toBe(true);
      if (value === CLICK) expect(name.includes(' '), name).toBe(true);
    }
    const names = [...new Set(built.map((b) => b.name))];
    const { events } = eventsOf(names);
    expect(events).toEqual([OTHER]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('names with no space and no colon read as on main, and the demo records read as before', async () => {
    const demo = (f: string) => readRun(fileURLToPath(new URL(`../../../site/demo/${f}`, import.meta.url)));
    const table = stateTable({ accept: [await demo('accept.jsonl')], reject: [await demo('reject.jsonl')] });
    const events = (vendor: string) => table.vendors.find((v) => v.vendor === vendor)!.states.accept!.events;
    expect(events('ga4')).toEqual(['page_view', 'user_engagement']);
    expect(events('google-ads')).toEqual(['add_to_cart', 'consent_update', 'gtag.config', 'page_view', 'remarketing', 'view_item']);
    expect(events('meta')).toEqual(['AddToCart', 'PageView']);
    for (const v of table.vendors) expect(v.notInAccept.reject!.events).toEqual([]);
  });
});
