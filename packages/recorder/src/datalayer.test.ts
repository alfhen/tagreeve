import { runInNewContext } from 'node:vm';
import { newId } from '@tagreeve/core';
import { expect, test } from 'vitest';
import { DATALAYER_BINDING, DATALAYER_TALLY, dataLayerEventFromPayload, dataLayerInitScript } from './datalayer.ts';

const MAIN = { main: true, n: 0 };

interface Sent {
  t: number;
  args: string;
  layer?: string;
  d?: string;
  a?: number;
  uid?: number;
  reassigned?: true;
}

function pageWith(
  setup: string,
  names: string[] = [],
  binding: (payload: Sent) => unknown = () => Promise.resolve(),
): { sent: Sent[]; run: (code: string) => unknown; flush: () => Promise<void> } {
  const sent: Sent[] = [];
  const sandbox: Record<string, unknown> = {
    performance: { timeOrigin: 1000, now: () => 5 },
    Node: class {},
    queueMicrotask,
    addEventListener: () => {},
    [DATALAYER_BINDING]: (payload: Sent) => {
      sent.push(payload);
      return binding(payload);
    },
  };
  sandbox.window = sandbox;
  runInNewContext(setup + dataLayerInitScript(names), sandbox);
  return { sent, run: (code) => runInNewContext(code, sandbox), flush: () => new Promise((resolve) => setTimeout(resolve, 0)) };
}

const argsOf = (sent: Sent[]) => sent.map((s) => JSON.parse(s.args) as unknown);

test('hooks a dataLayer created after the init script', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = window.dataLayer || []; dataLayer.push({ event: 'a' }, { event: 'b' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }], [{ event: 'b' }]]);
  expect(page.sent[0]?.t).toBe(1005);
});

test('hooks a dataLayer created before the init script, including items already in it', async () => {
  const page = pageWith(`window.dataLayer = [{ event: 'early' }];`);
  page.run(`dataLayer.push({ event: 'late' })`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'early' }], [{ event: 'late' }]]);
});

test('a gtag arguments object is reported as its argument list', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; function gtag() { dataLayer.push(arguments); } gtag('consent', 'update', { ad_storage: 'granted' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([['consent', 'update', { ad_storage: 'granted' }]]);
});

test('the push still reaches the array and a replaced dataLayer is hooked again', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'a' });`);
  expect(page.run('dataLayer.length')).toBe(1);
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'b' });`);
  await page.flush();
  expect(argsOf(page.sent.filter((s) => !s.reassigned))).toEqual([[{ event: 'a' }], [{ event: 'b' }]]);
});

test('values that cannot be serialised do not break the push', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; const o = {}; o.self = o; dataLayer.push(o);`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([['[unserializable]']]);
  expect(page.run('dataLayer.length')).toBe(1);
});

test('turns payloads into records on the shared clock', () => {
  const runId = newId('run');
  const consent = dataLayerEventFromPayload({ t: 1000, args: '["consent","default",{"ad_storage":"denied"}]' }, runId, 50, MAIN);
  expect(consent).toMatchObject({
    type: 'dataLayerEvent',
    runId,
    t: 1050,
    event: null,
    isConsentCommand: true,
    args: ['consent', 'default', { ad_storage: 'denied' }],
  });
  const event = dataLayerEventFromPayload(
    { t: 1, args: '[{"event":"purchase","gtm.uniqueEventId":7}]' },
    runId,
    0,
    MAIN,
  );
  expect(event).toMatchObject({ event: 'purchase', gtmUniqueEventId: 7, isConsentCommand: false });
  const gtagEvent = dataLayerEventFromPayload({ t: 1, args: '["event","add_to_cart",{}]' }, runId, 0, MAIN);
  expect(gtagEvent?.event).toBe('add_to_cart');
});

test('a payload carries the frame flag and number it is given', () => {
  const runId = newId('run');
  const payload = { t: 1, args: '[{"event":"x"}]' };
  const first = dataLayerEventFromPayload(payload, runId, 0, { main: false, n: 3 });
  expect(first?.frame).toEqual({ main: false, n: 3 });
  expect(dataLayerEventFromPayload(payload, runId, 0, MAIN)?.frame).toEqual({ main: true, n: 0 });
});

test('malformed payloads are dropped', () => {
  const runId = newId('run');
  expect(dataLayerEventFromPayload({ t: 1, args: 'nope' }, runId, 0, MAIN)).toBeUndefined();
  expect(dataLayerEventFromPayload({ t: 1, args: '{}' }, runId, 0, MAIN)).toBeUndefined();
});

test('a push over the size limit keeps its event name and drops the deep values', async () => {
  const page = pageWith('');
  page.run(
    `window.dataLayer = []; dataLayer.push({ event: 'purchase', 'gtm.uniqueEventId': 9, ecommerce: { value: 5, items: Array.from({ length: 400 }, (_, i) => ({ item_id: 'SKU' + i, item_name: 'Fake tee ' + i })) } });`,
  );
  await page.flush();
  expect(page.sent[0]!.args.length).toBeLessThanOrEqual(10000);
  const event = dataLayerEventFromPayload(page.sent[0]!, newId('run'), 0, MAIN);
  expect(event).toMatchObject({ event: 'purchase', gtmUniqueEventId: 9, isConsentCommand: false });
  const push = event?.args[0] as { ecommerce: { value: number; items: unknown[] } };
  expect(push.ecommerce.value).toBe(5);
  expect(push.ecommerce.items.every((item) => item === '[truncated]')).toBe(true);
});

test('a large gtag call keeps the command, so a consent update is still a consent command', async () => {
  const page = pageWith('');
  page.run(
    `window.dataLayer = []; function gtag() { dataLayer.push(arguments); } gtag('consent', 'update', { analytics_storage: 'granted', note: 'x'.repeat(20000), more: { a: 'y'.repeat(9000) } });`,
  );
  await page.flush();
  const event = dataLayerEventFromPayload(page.sent[0]!, newId('run'), 0, MAIN);
  expect(event).toMatchObject({ isConsentCommand: true });
  expect((event?.args[2] as Record<string, unknown>).analytics_storage).toBe('granted');
});

test('a named layer is hooked and its pushes carry the layer name', async () => {
  const page = pageWith('', ['myLayer']);
  page.run(`window.myLayer = window.myLayer || []; myLayer.push({ event: 'a' }); window.dataLayer = []; dataLayer.push({ event: 'b' });`);
  await page.flush();
  expect(page.sent.map((s) => s.layer)).toEqual(['myLayer', undefined]);
  expect(page.run('myLayer.length')).toBe(1);
  const runId = newId('run');
  expect(dataLayerEventFromPayload(page.sent[0]!, runId, 0, MAIN)?.layer).toBe('myLayer');
  expect(dataLayerEventFromPayload(page.sent[1]!, runId, 0, MAIN)).not.toHaveProperty('layer');
});

test('a layer name that is not an identifier is dropped from the payload', () => {
  const runId = newId('run');
  expect(dataLayerEventFromPayload({ t: 1, args: '[{"event":"x"}]', layer: 'a b' }, runId, 0, MAIN)).not.toHaveProperty('layer');
  expect(dataLayerEventFromPayload({ t: 1, args: '[{"event":"x"}]', layer: 'dataLayer' }, runId, 0, MAIN)).not.toHaveProperty('layer');
});

test('a name is trapped only when absent or a configurable array', async () => {
  const page = pageWith(
    `Object.defineProperty(window, 'fixed', { value: [], configurable: false }); window.early = [{ event: 'early' }];`,
    ['fixed', 'Shopify', 'early', 'location', '__proto__', 'constructor', 'prototype', 'toString'],
  );
  page.run(`early.push({ event: 'late' });`);
  await page.flush();
  expect(page.sent.map((s) => s.layer)).toEqual(['early', 'early']);
  expect(page.run(`Object.getOwnPropertyDescriptor(window, 'Shopify')`)).toBeUndefined();
  expect(page.run(`Object.getOwnPropertyDescriptor(window, 'fixed').value.length`)).toBe(0);
  expect(page.run(`Object.prototype.hasOwnProperty.call(window, 'toString')`)).toBe(false);
});

test('names outside the identifier pattern never reach the script', () => {
  const script = dataLayerInitScript(['ok', 'x"; alert(1); "', 'a-b']);
  expect(script).toContain('["dataLayer","ok"]');
  expect(script).not.toContain('alert');
});

test('Shopify and location are not trapped while absent', () => {
  expect(dataLayerInitScript(['Shopify', 'location', 'ok'])).toContain('["dataLayer","ok"]');
  const page = pageWith('', ['Shopify', 'location']);
  expect(page.run(`Object.getOwnPropertyDescriptor(window, 'Shopify')`)).toBeUndefined();
  expect(page.run(`Object.getOwnPropertyDescriptor(window, 'location')`)).toBeUndefined();
  page.run(`window.Shopify = { theme: 1 };`);
  expect(page.run(`Object.getOwnPropertyDescriptor(window, 'Shopify').value.theme`)).toBe(1);
});

type Tally = { d: string; arrays: { layer: string; a: number | null; length: number; posted: number }[] };

test('the tally returns the token, array number, length and posted count', async () => {
  const page = pageWith('', ['myLayer']);
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'a' }, { event: 'b' }); window.myLayer = [{ event: 'c' }];`);
  const tally = page.run(`${DATALAYER_TALLY}()`) as Tally;
  expect(typeof tally.d).toBe('string');
  expect(tally.arrays).toEqual([
    { layer: 'dataLayer', a: 1, length: 2, posted: 2 },
    { layer: 'myLayer', a: 1, length: 1, posted: 1 },
  ]);
  await page.flush();
  expect(page.sent.map((s) => [s.d, s.a])).toEqual([[tally.d, 1], [tally.d, 1], [tally.d, 1]]);
});

test('a replaced array gets the next array number and an unhooked array reports a null', () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'a' }); window.dataLayer = []; dataLayer.push({ event: 'b' });`);
  expect((page.run(`${DATALAYER_TALLY}()`) as Tally).arrays).toEqual([{ layer: 'dataLayer', a: 2, length: 1, posted: 1 }]);
  page.run(`Object.defineProperty(window, 'dataLayer', { value: [1, 2, 3], configurable: true });`);
  expect((page.run(`${DATALAYER_TALLY}()`) as Tally).arrays).toEqual([{ layer: 'dataLayer', a: null, length: 3, posted: 0 }]);
});

test('two documents get different tokens', () => {
  const first = pageWith('').run(`${DATALAYER_TALLY}()`) as Tally;
  const second = pageWith('').run(`${DATALAYER_TALLY}()`) as Tally;
  expect(first.d).not.toBe(second.d);
  expect(first.d.length).toBeLessThanOrEqual(64);
});

test('the tally posts nothing and never throws into the page', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'a' });`);
  page.run(`${DATALAYER_TALLY}(); ${DATALAYER_TALLY}()`);
  await page.flush();
  expect(page.sent).toHaveLength(1);
  page.run(`Object.defineProperty(window, 'dataLayer', { get() { throw new Error('x'); }, configurable: true });`);
  expect(() => page.run(`${DATALAYER_TALLY}()`)).not.toThrow();
});

test('the tally catches up a push that skipped the base and counts it as posted while its post is queued', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; window.saved = dataLayer; Array.prototype.push.call(saved, { event: 'a' });`);
  expect((page.run(`${DATALAYER_TALLY}()`) as Tally).arrays).toEqual([{ layer: 'dataLayer', a: 1, length: 1, posted: 1 }]);
  expect(page.sent).toHaveLength(0);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }]]);
  expect((page.run(`${DATALAYER_TALLY}()`) as Tally).arrays[0]).toMatchObject({ length: 1, posted: 1 });
  expect(page.sent).toHaveLength(1);
});

const WRAP_THROUGH = `window.dataLayer = window.dataLayer || [];
  const saved = dataLayer.push; let id = 100;
  dataLayer.push = function () { const r = saved.apply(this, arguments); for (const i of arguments) i['gtm.uniqueEventId'] = ++id; return r; };`;

test('a call-through wrapper is recorded once per push and its id is read after the push returns', async () => {
  const page = pageWith('');
  page.run(`${WRAP_THROUGH} dataLayer.push({ event: 'a' }); dataLayer.push({ event: 'b' });`);
  await page.flush();
  expect(page.sent.map((s) => [JSON.parse(s.args)[0].event, s.uid])).toEqual([['a', 101], ['b', 102]]);
  const event = dataLayerEventFromPayload(page.sent[0]!, newId('run'), 0, MAIN);
  expect(event?.gtmUniqueEventId).toBe(101);
});

test('push returns exactly the function the page assigned last', () => {
  const page = pageWith('');
  expect(page.run(`window.dataLayer = []; const mine = function () { return 1; }; dataLayer.push = mine; dataLayer.push === mine`)).toBe(true);
  expect(page.run(`dataLayer.push = Array.prototype.push; dataLayer.push === Array.prototype.push`)).toBe(true);
});

test('a wrapper that drops the push records nothing for it', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'before' }); dataLayer.push = function () { return dataLayer.length; }; dataLayer.push({ event: 'dropped' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'before' }]]);
});

test('an assigned native push is recorded by the growth check, in order', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push = Array.prototype.push; dataLayer.push({ event: 'a' }, { event: 'b' }); dataLayer.push({ event: 'c' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }], [{ event: 'b' }], [{ event: 'c' }]]);
  expect(page.run('dataLayer.length')).toBe(3);
});

test('an identity-guarded wrapper installed three times runs twice and records each push once', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; window.runs = 0; let saved, mine;
    const install = () => { if (dataLayer.push === mine) return; saved = dataLayer.push; mine = function () { runs++; return saved.apply(this, arguments); }; dataLayer.push = mine; };
    install(); install(); install(); dataLayer.push({ event: 'a' });`);
  await page.flush();
  expect(page.run('runs')).toBe(1);
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }]]);
});

test('an in-place edit in front of the known items is not recorded, and a repeated item is recorded twice', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; const o = { event: 'o' }; dataLayer.push(o); dataLayer.push(o); Array.prototype.unshift.call(dataLayer, { event: 'u' });`);
  page.run(`dataLayer.push`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'o' }], [{ event: 'o' }]]);
  page.run(`dataLayer.push({ event: 'after' })`);
  await page.flush();
  expect(argsOf(page.sent).at(-1)).toEqual([{ event: 'after' }]);
});

test('a sort or a front splice resets what is known and records nothing', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'b' }, { event: 'a' }); dataLayer.sort((x, y) => x.event.localeCompare(y.event)); dataLayer.splice(0, 1);`);
  page.run(`dataLayer.push`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'b' }], [{ event: 'a' }]]);
});

test('an unshift into an empty hooked array is recorded as appends in order', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; Array.prototype.unshift.call(dataLayer, { event: 'a' }, { event: 'b' });`);
  page.run(`dataLayer.push`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }], [{ event: 'b' }]]);
});

test('window.dataLayer = window.dataLayer || [] keeps the sync, so a later native push is recorded', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = window.dataLayer || []; window.dataLayer = window.dataLayer || []; window.saved = dataLayer;`);
  page.run(`Array.prototype.push.call(saved, { event: 'late' });`);
  expect((page.run(`${DATALAYER_TALLY}()`) as Tally).arrays).toEqual([{ layer: 'dataLayer', a: 1, length: 1, posted: 1 }]);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'late' }]]);
});

test('a throwing getter on an item does not reach the page', async () => {
  const page = pageWith('');
  expect(() => page.run(`window.dataLayer = []; const o = { get event() { throw new Error('x'); }, get 'gtm.uniqueEventId'() { throw new Error('y'); } }; dataLayer.push(o); dataLayer.push({ event: 'ok' });`)).not.toThrow();
  await page.flush();
  expect(argsOf(page.sent)).toEqual([['[unserializable]'], [{ event: 'ok' }]]);
});

test('a throwing element getter on the array does not reach the page', async () => {
  const page = pageWith('');
  expect(() => page.run(`window.dataLayer = []; dataLayer.push({ event: 'a' }); Object.defineProperty(dataLayer, 1, { get() { throw new Error('x'); }, configurable: true }); dataLayer.length = 2; dataLayer.push({ event: 'b' }); dataLayer.push;`)).not.toThrow();
  await page.flush();
});

test('replacing window.dataLayer with a new array posts a reassigned notice and keeps recording', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'a' }); window.dataLayer = []; dataLayer.push({ event: 'b' });`);
  await page.flush();
  expect(page.sent.filter((s) => s.reassigned)).toHaveLength(1);
  expect(page.sent.find((s) => s.reassigned)).toMatchObject({ args: '[]' });
  expect(argsOf(page.sent.filter((s) => !s.reassigned))).toEqual([[{ event: 'a' }], [{ event: 'b' }]]);
  expect(dataLayerEventFromPayload(page.sent.find((s) => s.reassigned)!, newId('run'), 0, MAIN)).toBeUndefined();
});

test('assigning the same array again posts no reassigned notice', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = window.dataLayer || []; window.dataLayer = window.dataLayer || [];`);
  await page.flush();
  expect(page.sent.filter((s) => s.reassigned)).toHaveLength(0);
});

test('the tally reading the name queues no second check, so a push that skips the base after the read stays unrecorded', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; window.saved = dataLayer; Array.prototype.push.call(saved, { event: 'a' });`);
  await page.flush();
  page.run(`${DATALAYER_TALLY}(); Array.prototype.push.call(saved, { event: 'late' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }]]);
  expect(page.run('saved.length')).toBe(2);
});

test('a page read of the name does queue a check that records the late push', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; window.saved = dataLayer; dataLayer.length; Array.prototype.push.call(saved, { event: 'late' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'late' }]]);
});

test('a frozen array is hooked without throwing and keeps its early items', async () => {
  const page = pageWith(`window.dataLayer = Object.freeze([{ event: 'early' }]);`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'early' }]]);
  expect(() => page.run(`${DATALAYER_TALLY}()`)).not.toThrow();
  expect(page.run('dataLayer.length')).toBe(1);
});

test('a non-configurable push stays the page function and the growth check still records', async () => {
  const page = pageWith('');
  page.run(`const l = []; globalThis.mine = function (...a) { return Array.prototype.push.apply(this, a); }; Object.defineProperty(l, 'push', { value: mine, configurable: false, writable: false }); window.dataLayer = l; dataLayer.push({ event: 'x' });`);
  expect(page.run('dataLayer.push === mine')).toBe(true);
  expect((page.run(`${DATALAYER_TALLY}()`) as Tally).arrays).toEqual([{ layer: 'dataLayer', a: 1, length: 1, posted: 1 }]);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'x' }]]);
});

test('a binding that throws, rejects or is missing never reaches the page; a throw or a missing binding is not counted as posted', async () => {
  const bindings: [string, (payload: Sent) => unknown][] = [
    ['throws', () => { throw new Error('binding gone'); }],
    ['rejects', () => Promise.reject(new Error('binding gone'))],
  ];
  for (const [label, binding] of bindings) {
    const page = pageWith('', [], binding);
    expect(() => page.run(`window.dataLayer = []; dataLayer.push({ event: 'a' }); dataLayer.length`), label).not.toThrow();
    await page.flush();
    expect(page.run('dataLayer.length'), label).toBe(1);
    const posted = (page.run(`${DATALAYER_TALLY}()`) as Tally).arrays[0]!.posted;
    expect(posted, label).toBe(label === 'throws' ? 0 : 1);
  }
  const absent = pageWith('');
  absent.run(`delete window[${JSON.stringify(DATALAYER_BINDING)}]; window.dataLayer = []; dataLayer.push({ event: 'a' });`);
  await absent.flush();
  expect(absent.run('dataLayer.length')).toBe(1);
  expect((absent.run(`${DATALAYER_TALLY}()`) as Tally).arrays[0]!.posted).toBe(0);
});

function realm(sent: Sent[], tag: string) {
  const sandbox: Record<string, unknown> = {
    performance: { timeOrigin: 1000, now: () => 5 },
    Node: class {},
    queueMicrotask,
    addEventListener: () => {},
    [DATALAYER_BINDING]: (payload: Sent) => {
      sent.push({ ...payload, layer: tag });
      return Promise.resolve();
    },
  };
  sandbox.window = sandbox;
  runInNewContext(dataLayerInitScript(), sandbox);
  return sandbox;
}

test('a second frame that takes the same array leaves push alone and records nothing twice', async () => {
  const sent: Sent[] = [];
  const parent = realm(sent, 'parent');
  const child = realm(sent, 'child');
  runInNewContext(
    `window.dataLayer = []; globalThis.runs = 0; const base = dataLayer.push; globalThis.gtmWrap = function (...a) { runs++; return base.apply(this, a); }; dataLayer.push = gtmWrap; dataLayer.push({ event: 'a' });`,
    parent,
  );
  child.parentLayer = parent.dataLayer;
  runInNewContext(`window.dataLayer = parentLayer;`, child);
  runInNewContext(`dataLayer.push({ event: 'b' });`, parent);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(runInNewContext(`dataLayer.push === gtmWrap`, parent)).toBe(true);
  expect(runInNewContext(`runs`, parent)).toBe(2);
  expect(sent.map((s) => `${s.layer}:${(JSON.parse(s.args) as { event: string }[])[0]?.event}`)).toEqual(['parent:a', 'parent:b']);
});

test('a push accessor the page defined is kept', async () => {
  const page = pageWith('');
  page.run(`globalThis.calls = 0; const l = []; Object.defineProperty(l, 'push', { configurable: true, get() { return function (...a) { calls++; return Array.prototype.push.apply(this, a); }; } }); window.dataLayer = l; dataLayer.push({ event: 'x' });`);
  await page.flush();
  expect(page.run(`calls`)).toBe(1);
  expect(argsOf(page.sent)).toEqual([[{ event: 'x' }]]);
});

type FullTally = Tally & { untrapped: string[] };
const tallyOf = (run: (code: string) => unknown): FullTally => {
  const raw = JSON.parse(JSON.stringify(run(`${DATALAYER_TALLY}()`))) as Omit<FullTally, 'untrapped'> & { untrapped: string };
  return { ...raw, untrapped: JSON.parse(raw.untrapped) as string[] };
};

test('one array under two names gives one tally entry, under the name it was hooked with', async () => {
  const page = pageWith('', ['myLayer']);
  page.run(`window.dataLayer = []; window.myLayer = window.dataLayer; dataLayer.push({ event: 'a' }, { event: 'b' }, { event: 'c' });`);
  await page.flush();
  const tally = tallyOf(page.run);
  expect(tally.arrays).toEqual([{ layer: 'dataLayer', a: 1, length: 3, posted: 3 }]);
  expect(page.sent.every((s) => s.layer === undefined)).toBe(true);
});

test('an array hooked under the second name is counted once, under that name', async () => {
  const page = pageWith('', ['myLayer']);
  page.run(`window.myLayer = []; window.dataLayer = window.myLayer; myLayer.push({ event: 'a' });`);
  await page.flush();
  const tally = tallyOf(page.run);
  expect(tally.arrays).toEqual([{ layer: 'myLayer', a: 1, length: 1, posted: 1 }]);
  expect(page.sent.map((s) => s.layer)).toEqual(['myLayer']);
});

test('a second realm that adopts a marked array gives no tally entry', async () => {
  const sent: Sent[] = [];
  const parent = realm(sent, 'parent');
  const child = realm(sent, 'child');
  runInNewContext(`window.dataLayer = []; dataLayer.push({ event: 'a' });`, parent);
  child.parentLayer = parent.dataLayer;
  runInNewContext(`window.dataLayer = parentLayer; dataLayer.push({ event: 'b' });`, child);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(tallyOf((code) => runInNewContext(code, child)).arrays).toEqual([]);
  expect(tallyOf((code) => runInNewContext(code, parent)).arrays).toEqual([{ layer: 'dataLayer', a: 1, length: 2, posted: 2 }]);
});

test('a page array with no marker and no hook in this realm keeps a: null', () => {
  const page = pageWith('', []);
  page.run(`Object.defineProperty(window, 'dataLayer', { value: [{ event: 'a' }], configurable: true, enumerable: true, writable: true });`);
  expect(tallyOf(page.run).arrays).toEqual([{ layer: 'dataLayer', a: null, length: 1, posted: 0 }]);
});

test('page code cannot change the untrapped list a later tally returns', () => {
  const page = pageWith(`Object.defineProperty(globalThis, 'status', { get() { return ''; }, set() {}, configurable: true });`, ['status', 'myLayer']);
  page.run(`const t = ${DATALAYER_TALLY}(); t.untrapped = ['myLayer'];`);
  expect(tallyOf(page.run).untrapped).toEqual(['status']);
});

test('page code cannot change the untrapped list by replacing Array methods', () => {
  const page = pageWith(`Object.defineProperty(globalThis, 'status', { get() { return ''; }, set() {}, configurable: true });`, ['status', 'myLayer']);
  page.run(`Array.prototype.slice = () => ['myLayer', 'dataLayer']; Array.prototype[Symbol.iterator] = function* () {}; JSON.stringify = () => '[]';`);
  expect(tallyOf(page.run).untrapped).toEqual(['status']);
});

test('page code that breaks Set or makes the array iterator throw cannot hide the untrapped list', () => {
  for (const sabotage of [`window.Set = null;`, `Array.prototype[Symbol.iterator] = function () { throw 1; };`]) {
    const page = pageWith(`Object.defineProperty(globalThis, 'status', { get() { return ''; }, set() {}, configurable: true });`, ['status', 'myLayer']);
    page.run(sabotage);
    expect(tallyOf(page.run).untrapped).toEqual(['status']);
  }
});

test('a name the page defined as an accessor is untrapped and not replaced', () => {
  const page = pageWith(`Object.defineProperty(globalThis, 'status', { get() { return ''; }, set() {}, configurable: true });`, ['status', 'myLayer']);
  expect(tallyOf(page.run).untrapped).toEqual(['status']);
  expect(page.run(`'value' in Object.getOwnPropertyDescriptor(window, 'status')`)).toBe(false);
});

test('two stacked call-through wrappers report once and reach the array', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = [];
    for (let i = 0; i < 2; i++) { const saved = dataLayer.push; dataLayer.push = function () { return saved.apply(this, arguments); }; }
    dataLayer.push({ event: 'a' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }]]);
  expect(page.run('dataLayer.length')).toBe(1);
});

test('a wrapper that calls Array.prototype.push records each push once', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push = function () { return Array.prototype.push.apply(this, arguments); }; dataLayer.push({ event: 'a' }); dataLayer.push({ event: 'b' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }], [{ event: 'b' }]]);
});

test('a wrapper that pushes a copy through the saved push records both items', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; const saved = dataLayer.push;
    dataLayer.push = function (item) { saved.call(this, { ...item, copy: true }); return saved.apply(this, arguments); };
    dataLayer.push({ event: 'a' });`);
  await page.flush();
  expect(page.run('dataLayer.length')).toBe(2);
  expect(argsOf(page.sent)).toEqual([[{ event: 'a', copy: true }], [{ event: 'a' }]]);
});

test('a fixed-function identity-guarded install does not throw or recurse', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; globalThis.n = 0; let saved;
    const mine = function () { n++; return saved.apply(this, arguments); };
    function install() { if (dataLayer.push === mine) return; saved = dataLayer.push; dataLayer.push = mine; }
    install(); install(); install();`);
  expect(() => page.run(`dataLayer.push({ event: 'a' })`)).not.toThrow();
  await page.flush();
  expect(page.run('n')).toBe(1);
  expect(page.sent).toHaveLength(1);
});

test('a push made while a wrapper runs goes through the wrapper and is recorded once', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; globalThis.calls = []; const saved = dataLayer.push;
    dataLayer.push = function () {
      const r = saved.apply(this, arguments);
      for (const item of arguments) { calls.push(item.event); if (item.event === 'a') dataLayer.push({ event: 'nested' }); }
      return r;
    };
    dataLayer.push({ event: 'a' });`);
  expect(page.run('calls')).toEqual(['a', 'nested']);
  expect(page.run('dataLayer.length')).toBe(2);
  await page.flush();
  expect(argsOf(page.sent).map((a) => ((a as Array<{ event: string }>)[0]!).event).sort()).toEqual(['a', 'nested']);
});

test('a deferred call to the saved push is not reported again and does not loop', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; globalThis.n = 0; const saved = dataLayer.push;
    dataLayer.push = function () { n++; const args = arguments; Promise.resolve().then(() => saved.apply(this, args)); return 0; };
    dataLayer.push({ event: 'a' });`);
  await new Promise((r) => setTimeout(r, 10));
  expect(page.run('n')).toBe(1);
  expect(page.run('dataLayer.length')).toBe(1);
  await page.flush();
  expect(page.sent).toHaveLength(1);
});

test('putting the saved push back removes the wrapper', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; globalThis.n = 0; const saved = dataLayer.push;
    dataLayer.push = function () { n++; return saved.apply(this, arguments); };
    dataLayer.push({ event: 'a' }); dataLayer.push = saved; dataLayer.push({ event: 'b' });`);
  expect(page.run('n')).toBe(1);
  expect(page.run('dataLayer.length')).toBe(2);
  await page.flush();
  expect(page.sent).toHaveLength(2);
});

test('a cached entry still runs its own wrapper after an out-of-order unwrap', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; globalThis.log = [];
    const s0 = dataLayer.push;
    dataLayer.push = function () { log.push(1); return s0.apply(this, arguments); };
    const s1 = dataLayer.push;
    dataLayer.push = function () { log.push(2); return s1.apply(this, arguments); };
    globalThis.cached = dataLayer.push;
    dataLayer.push = s0;`);
  expect(() => page.run(`cached.call(dataLayer, { event: 'a' })`)).not.toThrow();
  expect(page.run('dataLayer.length')).toBe(1);
  expect(page.run('log')).toEqual([2, 1]);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }]]);
});

test('a saved call-through keeps its wrapper when a new wrapper is added after an unwrap', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; globalThis.log = [];
    const s0 = dataLayer.push;
    dataLayer.push = function () { log.push(1); return s0.apply(this, arguments); };
    const s1 = dataLayer.push;
    dataLayer.push = function () { log.push(2); return s1.apply(this, arguments); };
    dataLayer.push = s0;
    const s2 = dataLayer.push;
    dataLayer.push = function () { log.push(3); return s2.apply(this, arguments); };
    s1.call(dataLayer, { event: 'a' });`);
  expect(page.run('log')).toEqual([1]);
});

test('a cached top entry assigned back after a restore is active again', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; globalThis.n = 0;
    const s0 = dataLayer.push;
    dataLayer.push = function () { n++; return s0.apply(this, arguments); };
    globalThis.top = dataLayer.push;
    dataLayer.push = s0;
    dataLayer.push = top;
    dataLayer.push({ event: 'a' });`);
  expect(page.run('dataLayer.push === top')).toBe(true);
  expect(page.run('n')).toBe(1);
});

test('an extra item pushed through the saved push is recorded', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; const s0 = dataLayer.push;
    dataLayer.push = function () { s0.call(this, { event: 'extra' }); return s0.apply(this, arguments); };
    dataLayer.push({ event: 'a' });`);
  expect(page.run('dataLayer.length')).toBe(2);
  await page.flush();
  expect(argsOf(page.sent).map((a) => ((a as Array<{ event: string }>)[0]!).event).sort()).toEqual(['a', 'extra']);
});

test('the same object pushed twice through an Array.prototype.push wrapper is reported twice', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push = function () { return Array.prototype.push.apply(this, arguments); };
    const o = { event: 'a' }; dataLayer.push(o); dataLayer.push(o);`);
  expect(page.run('dataLayer.length')).toBe(2);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }], [{ event: 'a' }]]);
});

test('a marker-guarded install runs the page wrapper once however often it is called', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; globalThis.n = 0;
    function install() { if (dataLayer.push.mine) return; const saved = dataLayer.push;
      const w = function () { n++; return saved.apply(this, arguments); }; w.mine = true; dataLayer.push = w; }
    install(); install(); install(); dataLayer.push({ event: 'a' });`);
  expect(page.run('n')).toBe(1);
  expect(page.run('dataLayer.length')).toBe(1);
  await page.flush();
  expect(page.sent).toHaveLength(1);
});

test('assigning a non-function to push is kept, as without the hook', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push = undefined;`);
  expect(page.run('dataLayer.push')).toBeUndefined();
});

test('a hole made by an index write is skipped and later items are recorded', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'a' }); dataLayer[3] = { event: 'h' };
    dataLayer.push = Array.prototype.push; dataLayer.push({ event: 'b' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }], [{ event: 'h' }], [{ event: 'b' }]]);
});

test('a length shrink resets the known length and later appends are recorded', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push = Array.prototype.push; dataLayer.push({ event: 'a' }, { event: 'b' });`);
  await page.flush();
  page.run(`dataLayer.length = 1; dataLayer.push;`);
  await page.flush();
  page.run(`dataLayer.push({ event: 'c' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }], [{ event: 'b' }], [{ event: 'c' }]]);
});

test('a length write that makes holes does not throw and records later pushes', async () => {
  const page = pageWith('');
  page.run(`window.dataLayer = []; dataLayer.push({ event: 'a' }); dataLayer.length = 3;
    dataLayer.push = Array.prototype.push; dataLayer.push({ event: 'b' });`);
  await page.flush();
  expect(argsOf(page.sent)).toEqual([[{ event: 'a' }], [{ event: 'b' }]]);
});

test('a non-configurable or frozen push never throws into page code', async () => {
  const page = pageWith('');
  expect(() =>
    page.run(`window.dataLayer = [];
      const a = []; Object.defineProperty(a, 'push', { value: Array.prototype.push, configurable: false, writable: false });
      window.dataLayer = a; a.push({ event: 'a' });
      const b = Object.freeze([]); window.dataLayer = b; try { b.push({ event: 'b' }); } catch {}`),
  ).not.toThrow();
  const pre = pageWith(`const z = []; Object.defineProperty(z, 'push', { value: Array.prototype.push, configurable: false }); window.dataLayer = z;`);
  expect(() => pre.run(`dataLayer.push({ event: 'c' }); dataLayer.length`)).not.toThrow();
  await pre.flush();
  expect(argsOf(pre.sent)).toEqual([[{ event: 'c' }]]);
});

