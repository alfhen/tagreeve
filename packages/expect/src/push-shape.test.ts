import type { DataLayerEvent, Step } from '@tagreeve/core';
import { expect, test } from 'vitest';
import { pushShapes } from './push-shape.ts';

const FAKE_EMAIL = 'fake.person@example.test';
const GID = 'gid://shopify/Product/1234567890';
const TOKEN = 'a1B2c3D4e5F6g7H8i9J0k1L2m3';

let n = 0;
function push(item: unknown, extra: Partial<DataLayerEvent> = {}): DataLayerEvent {
  n += 1;
  const event = typeof item === 'object' && item !== null && 'event' in item ? String((item as { event: unknown }).event) : null;
  return {
    type: 'dataLayerEvent',
    id: `dle_${n}`,
    runId: 'run_1',
    stepId: null,
    t: n,
    event,
    gtmUniqueEventId: null,
    args: [item],
    isConsentCommand: false,
    frame: { main: true, n: 0 },
    ...extra,
  } as unknown as DataLayerEvent;
}

const shapes = (...events: DataLayerEvent[]) => pushShapes({ steps: [], dataLayerEvents: events });
const first = (...events: DataLayerEvent[]) => shapes(...events).steps[0]!.events;

test('an array index reads [*] and paths carry types', () => {
  const [purchase] = first(push({ event: 'purchase', ecommerce: { value: 12, items: [{ item_id: 'a' }, { item_id: 'b' }, { item_id: 'c' }, { item_id: 'd', price: 1 }] } }));
  expect(purchase!.paths).toEqual([
    { path: 'event', types: ['string'] },
    { path: 'ecommerce.value', types: ['number'] },
    { path: 'ecommerce.items[*].item_id', types: ['string'] },
    { path: 'ecommerce.items[*].price', types: ['number'] },
  ]);
});

test('a key that is an email, a GID or a token reads (other)', () => {
  const [group] = first(push({ event: 'x', [FAKE_EMAIL]: 1, [GID]: 2, [TOKEN]: 3 }));
  expect(group!.paths.filter((p) => p.path === '(other)')).toHaveLength(1);
  expect(JSON.stringify(group)).not.toMatch(/fake\.person|gid:|a1B2c3/);
});

test('an event name that is an email reads (other)', () => {
  const [group] = first(push({ event: FAKE_EMAIL, a: 1 }));
  expect(group!.event).toBe('(other)');
});

test('no value appears in the result', () => {
  const result = shapes(push({ event: 'x', note: 'secret-value-42', nested: { list: ['hidden-value'] } }));
  expect(JSON.stringify(result)).not.toMatch(/secret-value|hidden-value/);
});

test('groups are per event and frame kind, and record their ids and counts', () => {
  const events = first(
    push({ event: 'a' }),
    push({ event: 'a' }),
    push({ event: 'a' }, { frame: { main: false, n: 1 } }),
    push({ event: 'a' }, { frame: undefined }),
  );
  expect(events.map((e) => [e.event, e.frame, e.count])).toEqual([['a', 'main', 2], ['a', 'embedded', 1], ['a', 'unknown', 1]]);
  expect(events[0]!.ids).toHaveLength(2);
});

test('gtm.* pushes are counts only', () => {
  const [group] = first(push({ event: 'gtm.js', 'gtm.start': 1 }));
  expect(group).toMatchObject({ event: 'gtm.js', count: 1, paths: [] });
});

test('a consent command shows signal names and never values', () => {
  const [group] = first(push(null, { args: ['consent', 'default', { ad_storage: 'denied', analytics_storage: 'granted' }], isConsentCommand: true }));
  expect(group!.event).toBe('consent default');
  expect(group!.paths.map((p) => p.path)).toEqual(['ad_storage', 'analytics_storage']);
  expect(JSON.stringify(group)).not.toMatch(/denied|granted/);
});

test('a gtag event reads its parameters, and steps group by label', () => {
  const step = { id: 'stp_1', label: 'load' } as unknown as Step;
  const result = pushShapes({
    steps: [step],
    dataLayerEvents: [push(null, { event: 'add_to_cart', args: ['event', 'add_to_cart', { currency: 'USD' }], stepId: 'stp_1' as never })],
  });
  expect(result.steps).toEqual([{ step: 'load', events: [expect.objectContaining({ event: 'add_to_cart', paths: [{ path: 'currency', types: ['string'] }] })] }]);
});

test('types merge across pushes of one group', () => {
  const [group] = first(push({ event: 'x', v: 1 }), push({ event: 'x', v: 'a' }));
  expect(group!.paths.find((p) => p.path === 'v')!.types).toEqual(['number', 'string']);
});

test('a pushed string never prints, and a known gtag command keeps its label', () => {
  const secret = 'ord_abc';
  const strings = push(null, { args: [secret] });
  expect(JSON.stringify(strings.args)).toContain(secret);
  const result = shapes(strings, push(null, { args: [`${secret}_2`, { a: 1 }] }));
  expect(result.steps[0]!.events.map((g) => g.event)).toEqual(['gtag (other)']);
  expect(JSON.stringify(result)).not.toContain(secret);
  const known = ['config', 'consent', 'event', 'get', 'js', 'set'].map((c) => push(null, { args: [c, 'x'] }));
  expect(first(...known).map((g) => g.event)).toEqual(['gtag config', 'gtag consent', 'gtag event', 'gtag get', 'gtag js', 'gtag set']);
});

test('the two purchase forms are two groups with a kind each', () => {
  const groups = first(push(null, { event: 'purchase', args: ['event', 'purchase', { value: 1 }] }), push({ event: 'purchase', ecommerce: { value: 1 } }));
  expect(groups.map((g) => [g.event, g.kind])).toEqual([['purchase', 'gtag'], ['purchase', 'object']]);
  expect(groups[0]!.paths).toEqual([{ path: 'value', types: ['number'] }]);
});

test('an arguments-like consent update reads as the gtag command it holds', () => {
  const [group] = first(push({ 0: 'consent', 1: 'update', 2: { ad_storage: 'granted' } }));
  expect(group).toMatchObject({ event: 'consent update', kind: 'gtag', paths: [{ path: 'ad_storage', types: ['string'] }] });
  expect(JSON.stringify(group)).not.toContain('granted');
});

test('an arguments-like event, config and unknown command read as gtag', () => {
  const groups = first(
    push({ 0: 'event', 1: 'purchase', 2: { value: 1 } }),
    push({ 0: 'config', 1: 'G-PWTEST0001' }),
    push({ 0: 'custom', 1: 'x' }),
  );
  expect(groups.map((g) => [g.event, g.kind])).toEqual([['purchase', 'gtag'], ['gtag config', 'gtag'], ['gtag (other)', 'gtag']]);
  expect(groups[0]!.paths).toEqual([{ path: 'value', types: ['number'] }]);
  expect(groups[1]!.paths).toEqual([]);
});

test('an object that is not arguments-like stays an object push', () => {
  const nonString = { 0: 1, 1: 'update' };
  const gap = { 0: 'consent', 2: { a: 1 } };
  const extraKey = { 0: 'consent', extra: 1 };
  const tooLong = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [String(i), i === 0 ? 'event' : 'x']));
  for (const item of [nonString, gap, extraKey, tooLong]) {
    const [group] = first(push(item));
    expect(group).toMatchObject({ event: '(no event)', kind: 'object' });
  }
});

test('an arguments-like event name that looks like a value reads (other)', () => {
  const [group] = first(push({ 0: 'event', 1: 'fake.person@example.test' }));
  expect(group!.event).toBe('(other)');
});

test('an arguments-like consent push with a second item other than default or update reads gtag consent', () => {
  const [group] = first(push({ 0: 'consent', 1: 'foo', 2: {} }));
  expect(group!.event).toBe('gtag consent');
});

test('an arguments-like consent default keeps its label and signal names', () => {
  const [group] = first(push({ 0: 'consent', 1: 'default', 2: { ad_storage: 'denied' } }));
  expect(group!.event).toBe('consent default');
  expect(group!.paths.map((p) => p.path)).toEqual(['ad_storage']);
});

test('an arguments-like gtm.* event has a count and no paths', () => {
  const [group] = first(push({ 0: 'event', 1: 'gtm.dom', 2: { a: 1 } }));
  expect(group!.event).toBe('gtm.dom');
  expect(group!.count).toBe(1);
  expect(group!.paths).toEqual([]);
});
