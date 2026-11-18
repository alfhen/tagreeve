import type { DataLayerEvent } from '@tagreeve/core';
import { describe, expect, test } from 'vitest';
import { evaluatePushRule, type PushRuleInput } from './push-rules.ts';
import { labelKind, pushShapes, NO_EVENT } from './push-shape.ts';
import { parseScenario, type Count, type PushSelector, type Rule } from './scenario.ts';

let n = 0;

/** Records `args` as the recorder does: `event` is read the way its `eventName` reads it. */
function push(args: unknown[], extra: Partial<DataLayerEvent> = {}): DataLayerEvent {
  n += 1;
  const first = args[0];
  const event =
    args[0] === 'event' && typeof args[1] === 'string'
      ? args[1]
      : typeof first === 'object' && first !== null && !Array.isArray(first) && typeof (first as { event?: unknown }).event === 'string'
        ? (first as { event: string }).event
        : null;
  return {
    type: 'dataLayerEvent',
    id: `dle_${n}`,
    runId: 'run_1',
    stepId: null,
    t: n,
    event,
    gtmUniqueEventId: null,
    args,
    isConsentCommand: args[0] === 'consent' && (args[1] === 'default' || args[1] === 'update'),
    frame: { main: true, n: 0 },
    ...extra,
  } as unknown as DataLayerEvent;
}

function rule(kind: Rule['kind'], dataLayer: PushSelector, count?: Count): Rule {
  return { kind, description: JSON.stringify({ dataLayer }), line: 1, filter: { consent: {}, ids: {}, params: {} }, dataLayer, ...(count && { count }) };
}

const everywhere = (pushes: DataLayerEvent[], extra: Partial<PushRuleInput> = {}): PushRuleInput => ({ pushes, inScope: () => true, where: '', hookIncomplete: false, ...extra });

const SECRET = 'pw-secret-order-value';
const withId = push(['event', 'purchase', { ecommerce: { transaction_id: SECRET, value: 10 } }]);
const withoutId = push(['event', 'purchase', { ecommerce: { value: 'ten' } }]);

describe('has and count', () => {
  const pushes = [withId, withoutId];

  test('must passes with the pushes that hold every path, and count raises the bar', () => {
    const has = rule('must', { event: 'purchase', has: ['ecommerce.transaction_id', 'ecommerce.value'] });
    const one = evaluatePushRule(has, everywhere(pushes));
    expect(one.pass).toBe(true);
    expect(one.evidence).toEqual([withId.id]);
    const two = evaluatePushRule(rule('must', has.dataLayer!, { op: '>=', n: 2 }), everywhere(pushes));
    expect(two.pass).toBe(false);
    expect(two.evidence).toEqual([withId.id, withoutId.id]);
  });

  test('an item path and a ** path match a nested array of objects', () => {
    const items = push(['event', 'view_item', { ecommerce: { items: [{ item_id: 'a' }, { item_id: 'b' }] } }]);
    for (const path of ['ecommerce.items[*].item_id', '**.item_id', 'ecommerce.*.item_id']) {
      expect(evaluatePushRule(rule('must', { event: 'view_item', has: [path] }), everywhere([items])).pass, path).toBe(true);
    }
    expect(evaluatePushRule(rule('must', { event: 'view_item', has: ['item_id'] }), everywhere([items])).pass).toBe(false);
  });

  test('mustNot fails when any push holds any listed path, and passes when none does', () => {
    const listed = rule('mustNot', { event: 'purchase', has: ['ecommerce.coupon', 'ecommerce.value'] });
    const failing = evaluatePushRule(listed, everywhere(pushes));
    expect(failing.pass).toBe(false);
    expect(failing.evidence).toEqual([withId.id, withoutId.id]);
    const none = evaluatePushRule(rule('mustNot', { event: 'purchase', has: ['ecommerce.coupon'] }), everywhere(pushes));
    expect(none.pass).toBe(true);
    expect(none.evidence).toEqual([]);
  });

  test('mustNot with no matching push in scope passes, and the same rule with one push fails', () => {
    const refund = rule('mustNot', { event: 'refund' });
    expect(evaluatePushRule(refund, everywhere(pushes)).pass).toBe(true);
    const one = push(['event', 'refund', { value: 1 }]);
    const failing = evaluatePushRule(refund, everywhere([...pushes, one]));
    expect(failing.pass).toBe(false);
    expect(failing.evidence).toEqual([one.id]);
    expect(evaluatePushRule(refund, everywhere([...pushes, one], { inScope: () => false })).pass).toBe(true);
  });

  test('kind and frame select only those pushes', () => {
    const object = push([{ event: 'purchase', ecommerce: { transaction_id: 'x' } }]);
    const embedded = push(['event', 'purchase', { ecommerce: { transaction_id: 'x' } }], { frame: { main: false, n: 1 } });
    const all = [withId, object, embedded];
    expect(evaluatePushRule(rule('must', { event: 'purchase', kind: 'object' }), everywhere(all)).evidence).toEqual([object.id]);
    expect(evaluatePushRule(rule('must', { event: 'purchase', kind: 'gtag' }), everywhere(all)).evidence).toEqual([withId.id, embedded.id]);
    expect(evaluatePushRule(rule('must', { event: 'purchase', frame: 'embedded' }), everywhere(all)).evidence).toEqual([embedded.id]);
    expect(evaluatePushRule(rule('must', { event: 'purchase', frame: 'unknown' }), everywhere(all)).pass).toBe(false);
  });

  test('a push is in scope by its time', () => {
    const early = push(['event', 'purchase', { ecommerce: { value: 1 } }], { t: 5 });
    const late = push(['event', 'purchase', { ecommerce: { value: 1 } }], { t: 50 });
    const r = evaluatePushRule(rule('mustNot', { event: 'purchase' }), everywhere([early, late], { inScope: (t) => t < 10, where: ' before consent' }));
    expect(r.evidence).toEqual([early.id]);
    expect(r.message).toContain('before consent');
  });
});

describe('types', () => {
  const number = push(['event', 'purchase', { ecommerce: { value: 12 } }]);
  const string = push(['event', 'purchase', { ecommerce: { value: SECRET } }]);
  const types = rule('must', { event: 'purchase', types: { 'ecommerce.value': 'number' } });

  test('holds when every push has the type there', () => {
    const r = evaluatePushRule(types, everywhere([number, push(['event', 'purchase', { ecommerce: { value: 3 } }])]));
    expect(r.pass).toBe(true);
  });

  test('fails when one push has another type, and the message names the path and types but not the value', () => {
    expect(JSON.stringify(string.args)).toContain(SECRET);
    const r = evaluatePushRule(types, everywhere([number, string]));
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual([string.id]);
    expect(r.message).toContain('ecommerce.value');
    expect(r.message).toMatch(/number/);
    expect(r.message).toMatch(/string in 1 push/);
    expect(r.message).not.toContain(SECRET);
  });

  test('a push without the path does not hold the type', () => {
    const r = evaluatePushRule(types, everywhere([number, push(['event', 'purchase', { ecommerce: { currency: 'USD' } }])]));
    expect(r.pass).toBe(false);
    expect(r.message).toContain('absent');
  });

  test('mixed types at one path are not exactly the type', () => {
    const mixed = push(['event', 'purchase', { ecommerce: { items: [{ price: 1 }, { price: 'x' }] } }]);
    expect(evaluatePushRule(rule('must', { event: 'purchase', types: { 'ecommerce.items[*].price': 'number' } }), everywhere([mixed])).pass).toBe(false);
  });
});

describe('a path copied from the shapes matches', () => {
  const deep = (depth: number): unknown => (depth === 0 ? { leaf: 1 } : { down: deep(depth - 1) });
  const step = [
    push(['event', 'purchase', { ecommerce: { transaction_id: 't', value: 10, items: [{ item_id: 'a', price: 1 }, { item_id: 'b', price: 2 }], coupon: null, extra: {} } }]),
    push(['event', 'purchase', { ecommerce: { value: 20 } }]),
    push([{ event: 'view_item', ecommerce: { items: [{ item_id: 'a' }], nested: { a: { b: 1 } } } }]),
    push([{ event: 'view_item', ecommerce: { items: [{ item_id: 'b' }], nested: { a: { b: 2 } } } }]),
    push([{ 0: 'event', 1: 'add_to_cart', 2: { items: [{ item_id: 'c', quantity: 1 }], currency: 'USD' } }]),
    push(['event', 'deep_branch', { tree: deep(10) }]),
    push(['event', 'embedded_event', { a: 1 }], { frame: { main: false, n: 1 } }),
    push(['consent', 'update', { ad_storage: 'granted' }]),
    push(['config', 'G-PWTEST0001']),
    push([{ event: 'gtm.js', 'gtm.start': 1 }]),
    push([{ note: 'no event' }]),
  ];
  const { steps } = pushShapes({ steps: [], dataLayerEvents: step });
  const shapes = steps.flatMap((s) => s.events);
  const pageEvents = shapes.filter((s) => labelKind(s.event) === 'event' && s.event !== NO_EVENT && s.event !== '(other)' && !s.event.startsWith('gtm.'));

  test('the shapes hold the paths and shapes the cases depend on', () => {
    const paths = shapes.flatMap((s) => s.paths.map((p) => p.path));
    expect(paths).toContain('ecommerce.items[*].item_id');
    expect(shapes.some((s) => s.event === 'add_to_cart' && s.kind === 'gtag')).toBe(true);
    const cut = paths.find((p) => p.startsWith('tree.down'))!;
    expect(cut.split('.').length).toBeLessThanOrEqual(8);
    expect(shapes.filter((s) => s.event === 'purchase')).toHaveLength(1);
    expect(pageEvents.length).toBeGreaterThanOrEqual(5);
  });

  test.each(pageEvents.flatMap((s) => s.paths.map((p) => [s.event, s.kind, s.frame, p.path] as const)))('%s %s %s has %s', (event, kind, frame, path) => {
    const shape = pageEvents.find((s) => s.event === event && s.kind === kind && s.frame === frame)!;
    const selector = { event, kind, frame, has: [path] };
    const parsed = parseScenario(`start: /\nexpect:\n  must:\n    - { dataLayer: ${JSON.stringify(selector)} }\n`).expect.must[0]!;
    const r = evaluatePushRule(parsed, everywhere(step));
    expect(r.pass).toBe(true);
    expect(r.evidence.length).toBeGreaterThan(0);
    for (const id of r.evidence) expect(shape.ids).toContain(id);
  });

  test.each(pageEvents.filter((s) => s.event !== 'purchase').map((s) => [s.event, s] as const))('%s: all paths and single types hold for every push of the shape', (_event, shape) => {
    const types = Object.fromEntries(shape.paths.filter((p) => p.types.length === 1).map((p) => [p.path, p.types[0]!]));
    const r = evaluatePushRule(rule('must', { event: shape.event, kind: shape.kind, frame: shape.frame, has: shape.paths.map((p) => p.path), types }), everywhere(step));
    expect(r.pass).toBe(true);
    expect(r.evidence).toEqual(shape.ids);
  });

  test('a path of the group that only one push holds is held by that push', () => {
    const purchase = shapes.find((s) => s.event === 'purchase')!;
    const r = evaluatePushRule(rule('must', { event: 'purchase', has: ['ecommerce.transaction_id'] }), everywhere(step));
    expect(r.evidence).toEqual([purchase.ids[0]]);
  });
});

describe('the rule text through the parser', () => {
  test('a parsed rule evaluates the same as the object', () => {
    const scenario = parseScenario('start: /\nexpect:\n  mustNot:\n    - { dataLayer: { event: purchase, has: [ecommerce.transaction_id] } }');
    const r = evaluatePushRule(scenario.expect.mustNot[0]!, everywhere([withId, withoutId]));
    expect(r.evidence).toEqual([withId.id]);
  });
});

test("a mustNot that would pass with the hook incomplete is a warn that cannot be evaluated, with no evidence", () => {
  const rule = { kind: "mustNot", dataLayer: { event: "purchase" } } as Rule;
  expect(evaluatePushRule(rule, everywhere([], { hookIncomplete: true }))).toMatchObject({ pass: false, severity: "warn", evidence: [] });
  expect(evaluatePushRule(rule, everywhere([]))).toMatchObject({ pass: true });
});

describe('a path that names an object or array', () => {
  const withItems = push(['event', 'purchase', { ecommerce: { value: 1, items: [{ item_id: 'a' }] } }]);
  const without = push(['event', 'purchase', { currency: 'USD' }]);
  const dl = (extra: Omit<PushSelector, 'event'>): PushSelector => ({ event: 'purchase', ...extra });

  test.each(['ecommerce', 'ecommerce.items', 'ecommerce.items[*]', '**.items'])('mustNot has %s fails on a push that holds it and passes on one that does not', (path) => {
    const bad = evaluatePushRule(rule('mustNot', dl({ has: [path] })), everywhere([withItems]));
    expect(bad.pass).toBe(false);
    expect(bad.evidence).toEqual([withItems.id]);
    expect(evaluatePushRule(rule('mustNot', dl({ has: [path] })), everywhere([without])).pass).toBe(true);
  });

  test.each(['ecommerce', 'ecommerce.items'])('must has %s passes on a push that holds it and fails on one that does not', (path) => {
    expect(evaluatePushRule(rule('must', dl({ has: [path] })), everywhere([withItems])).pass).toBe(true);
    expect(evaluatePushRule(rule('must', dl({ has: [path] })), everywhere([without])).pass).toBe(false);
  });

  test('types reads object and array there', () => {
    const ok = rule('must', dl({ types: { 'ecommerce.items': 'array', ecommerce: 'object', 'ecommerce.items[*]': 'object' } }));
    expect(evaluatePushRule(ok, everywhere([withItems])).pass).toBe(true);
    expect(evaluatePushRule(ok, everywhere([withItems, without])).pass).toBe(false);
  });
});

describe('message wording', () => {
  const x = () => push(['event', 'X', { a: 1, b: 2 }]);
  const typed: PushSelector = { event: 'X', has: ['a', 'b'], types: { b: 'number' } };

  test('a mustNot with two offending pushes says found 2 pushes', () => {
    const ys = [push(['event', 'Y', { user: { email: 'fake' } }]), push(['event', 'Y', { user: { email: 'fake' } }])];
    const r = evaluatePushRule(rule('mustNot', { event: 'Y', has: ['**.email'] }), everywhere(ys));
    expect(r.pass).toBe(false);
    expect(r.severity).toBeUndefined();
    expect(r.evidence).toEqual(ys.map((p) => p.id));
    expect(r.message).toContain('found 2 pushes');
    expect(r.message).not.toContain('pushs');
  });

  test('a types failure reads should be, found', () => {
    const e = x();
    const r = evaluatePushRule(rule('must', { event: 'X', types: { b: 'string' } }), everywhere([e]));
    expect(r.pass).toBe(false);
    expect(r.severity).toBeUndefined();
    expect(r.evidence).toEqual([e.id]);
    expect(r.message).toContain('b should be string, found number in 1 push');
    expect(r.message).not.toContain('is string but found');
  });

  test('a passing must names the types it checked', () => {
    const e = x();
    const r = evaluatePushRule(rule('must', typed), everywhere([e]));
    expect(r).toMatchObject({ pass: true, evidence: [e.id] });
    expect(r.severity).toBeUndefined();
    expect(r.message).toContain('b: number');
  });

  test('a types-only pass names the types', () => {
    const e = x();
    const r = evaluatePushRule(rule('must', { event: 'X', types: { b: 'number' } }), everywhere([e]));
    expect(r.pass).toBe(true);
    expect(r.evidence).toEqual([e.id]);
    expect(r.severity).toBeUndefined();
    expect(r.message).toContain('b: number');
  });

  test('the incomplete-hook warn names the types, with and without has', () => {
    for (const sel of [typed, { event: 'X', types: { b: 'number' } }]) {
      const e = x();
      const r = evaluatePushRule(rule('must', sel), everywhere([e], { hookIncomplete: true }));
      expect(r).toMatchObject({ pass: false, severity: 'warn', evidence: [e.id] });
      expect(r.message).toContain('b: number');
      expect(r.message).toContain('could not all be read');
    }
  });
});

describe('a push past the pushShapes caps', () => {
  const COUPON = 'pw-secret-coupon-value';
  const wide = (withCoupon: boolean) => {
    const o: Record<string, unknown> = { event: 'page' };
    for (let i = 0; i < 250; i++) o[`k${i}`] = 1;
    if (withCoupon) o.coupon = COUPON;
    return o;
  };
  const deepObject = () => {
    let o: Record<string, unknown> = { coupon: COUPON };
    for (let i = 9; i >= 0; i--) o = { [`a${i}`]: o };
    return { event: 'page', ...o };
  };
  const wideCoupon = push([wide(true)]);
  const deepCoupon = push([deepObject()]);
  const dl = (selector: Omit<PushSelector, 'event'>): PushSelector => ({ event: 'page', ...selector });

  test('mustNot has fails on a path past 200 paths and names the push', () => {
    expect(JSON.stringify(wideCoupon.args)).toContain(COUPON);
    const out = evaluatePushRule(rule('mustNot', dl({ has: ['coupon'] })), everywhere([wideCoupon]));
    expect(out.pass).toBe(false);
    expect(out.evidence).toEqual([wideCoupon.id]);
    expect(out.message).toBe('Expected no "page" push holding any of coupon, found 1 push (1 before narrowing).');
    expect(JSON.stringify(out)).not.toContain(COUPON);
  });

  test('mustNot has **.path fails on a path past depth 8', () => {
    expect(JSON.stringify(deepCoupon.args)).toContain('coupon');
    const out = evaluatePushRule(rule('mustNot', dl({ has: ['**.coupon'] })), everywhere([deepCoupon]));
    expect(out.pass).toBe(false);
    expect(out.evidence).toEqual([deepCoupon.id]);
    expect(JSON.stringify(out)).not.toContain(COUPON);
  });

  test('must with a count of 0 fails on a path past the caps', () => {
    for (const op of ['=', '<='] as const) {
      const out = evaluatePushRule(rule('must', dl({ has: ['coupon'] }), { op, n: 0 }), everywhere([wideCoupon]));
      expect(out.pass, op).toBe(false);
    }
  });

  test('must types reads the type past the caps', () => {
    expect(evaluatePushRule(rule('must', dl({ types: { '**.coupon': 'string' } })), everywhere([wideCoupon])).pass).toBe(true);
    const out = evaluatePushRule(rule('must', dl({ types: { '**.coupon': 'number' } })), everywhere([wideCoupon]));
    expect(out.pass).toBe(false);
    expect(out.evidence).toEqual([wideCoupon.id]);
    expect(out.message).toContain('**.coupon should be number, found string in 1 push');
    expect(JSON.stringify(out)).not.toContain(COUPON);
    const deep = evaluatePushRule(rule('must', dl({ types: { '**.coupon': 'number' } })), everywhere([deepCoupon]));
    expect(deep.pass).toBe(false);
    expect(JSON.stringify(deep)).not.toContain(COUPON);
  });

  test('the same wide push without coupon still passes mustNot, and an incomplete hook warns', () => {
    const plain = push([wide(false)]);
    const out = evaluatePushRule(rule('mustNot', dl({ has: ['coupon'] })), everywhere([plain]));
    expect(out.pass).toBe(true);
    expect(out.evidence).toEqual([]);
    expect(out.message).toContain('found none (1 before narrowing)');
    const warn = evaluatePushRule(rule('mustNot', dl({ has: ['coupon'] })), everywhere([plain], { hookIncomplete: true }));
    expect(warn).toMatchObject({ pass: false, severity: 'warn' });
  });
});
