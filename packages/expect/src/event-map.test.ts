import { describe, expect, test } from 'vitest';
import { diffPushes } from './diff.ts';
import { keepPushGroups, normalizePushGroups, parseEventMap } from './event-map.ts';
import type { PushGroup } from './push-shape.ts';

const group = (event: string, paths: string[] = []): PushGroup => ({ epoch: 'undecided', event, frame: 'main', paths: paths.map((path) => ({ path, types: ['string'] })) });

describe('parseEventMap', () => {
  test('reads events and paths', () => {
    const map = parseEventMap('{"events":{"a":"b"},"paths":{"b":{"x.y":"z"}}}', 'm.json');
    expect(map.events.a).toBe('b');
    expect(map.paths.b!['x.y']).toBe('z');
  });

  test('an empty object is a valid map', () => {
    const map = parseEventMap('{}', 'm.json');
    expect(Object.keys(map.events)).toEqual([]);
    expect(Object.keys(map.paths)).toEqual([]);
  });

  test.each([
    ['not json {', 'm.json: the event map is not valid JSON.'],
    ['[]', 'must be a JSON object'],
    ['{"rename":{}}', 'top-level key 1 is not "events" or "paths"'],
    ['{"events":{"a":3}}', '"events" key 1 must map to an event name'],
    ['{"events":[]}', '"events" must be an object'],
    ['{"paths":{"b":{"x":"<script>"}}}', '"paths" key 1, key 1 must map to a key path'],
    ['{"paths":{"b":"x"}}', '"paths" key 1 must be an object'],
    ['{"paths":{"b":{".":"e","value":"total"}}}', '"paths" key 1 with the "." source key takes no other key'],
  ])('rejects %s', (text, message) => {
    expect(() => parseEventMap(text, 'm.json')).toThrow(message);
  });

  test('an error names the file and the key and never a value', () => {
    for (const text of ['{"events":{"a":"secret-value-1 <"}}', '{"events":{"a":{"x":"secret-value-1"}}}', 'secret-value-1']) {
      expect(() => parseEventMap(text, 'm.json')).toThrow('m.json');
      expect(() => parseEventMap(text, 'm.json')).not.toThrow(/secret-value-1/);
    }
  });

  test('a bad event name is named by position and never by text', () => {
    expect(() => parseEventMap('{"events":{"ok":"x","bad/name":"x"}}', 'm.json')).toThrow('"events" key 2 is not an event name');
    expect(() => parseEventMap('{"events":{"bad/name":"x"}}', 'm.json')).not.toThrow(/bad\/name/);
    expect(() => parseEventMap('{"paths":{"bad/name":{}}}', 'm.json')).toThrow('"paths" key 1 is not an event name');
    expect(() => parseEventMap('{"paths":{"bad/name":{}}}', 'm.json')).not.toThrow(/bad\/name/);
  });

  test('an unknown top-level key is named by position and never by text', () => {
    const attempt = () => parseEventMap('{"zz<script>":1}', 'm.json');
    expect(attempt).toThrow('m.json: top-level key 1 is not "events" or "paths"');
    expect(attempt).not.toThrow(/zz<script>/);
    expect(() => parseEventMap('{"events":{},"extra":1}', 'm.json')).toThrow('top-level key 2');
  });

  test('key positions follow the written order, integer-like keys included', () => {
    expect(() => parseEventMap('{"events":{"bad/name":"x","5":"y"}}', 'm.json')).toThrow('"events" key 1 is not an event name');
    expect(() => parseEventMap('{"events":{"ok":"x","5":"y","bad/name":"z"}}', 'm.json')).toThrow('"events" key 3');
    expect(() => parseEventMap('{"events":{"ok":"x","5":3}}', 'm.json')).toThrow('"events" key 2 must map to an event name');
    expect(() => parseEventMap('{"paths":{"a":{"x":"y"},"b":{"ok":"y","bad key":"z"}}}', 'm.json')).toThrow('"paths" key 2, key 2 is not a key path');
    expect(() => parseEventMap('{"paths":{"a":{"ok":"y","bad key":"z"}}}', 'm.json')).not.toThrow(/bad key|"a"/);
  });

  test('keys with escapes, nested values and a repeated key are read in order', () => {
    const text = '{ "paths" : { "a" : { "x\\"y" : "z" } , "b" : [1,{"k":"]"}] }, "events":{"c":"d"}}';
    expect(() => parseEventMap(text, 'm.json')).toThrow('"paths" key 1, key 1 is not a key path');
    expect(() => parseEventMap('{"events":{"a":"b","a":"c","d":"e e"}}', 'm.json')).not.toThrow();
    expect(() => parseEventMap('{"events":{"a":"b","a":"c","d/":"e"}}', 'm.json')).toThrow('"events" key 3');
  });

  test('a prototype key does not reach the result', () => {
    const map = parseEventMap('{"events":{"__proto__":"x"}}', 'm.json');
    expect(Object.keys(map.events)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('normalizePushGroups', () => {
  test('a paths entry keyed by the user-renamed name applies to the recorded group', () => {
    const map = parseEventMap('{"events":{"legacy":"checkout_completed"},"paths":{"checkout_completed":{"ecommerce":"data"}}}', 'm.json');
    const input = [group('legacy', ['ecommerce.value'])];
    expect(input[0]!.paths.map((p) => p.path)).toEqual(['ecommerce.value']);
    expect(normalizePushGroups(input, map)[0]!.paths.map((p) => p.path)).toEqual(['data.value']);
  });

  test('the longest matching source key renames a path, whatever the file order', () => {
    const map = parseEventMap('{"paths":{"b":{"ecommerce":"data","ecommerce.value":"value"}}}', 'm.json');
    const [mapped] = normalizePushGroups([group('b', ['ecommerce.value', 'ecommerce.id'])], map);
    expect(mapped!.paths.map((p) => p.path)).toEqual(['value', 'data.id']);
  });

  test('applies the built-in table and leaves consent and gtag labels alone', () => {
    const out = normalizePushGroups([group('checkout_completed'), group('consent update'), group('gtag config'), group('constructor')]);
    expect(out.map((g) => g.event)).toEqual(['purchase', 'consent update', 'gtag config', 'constructor']);
  });

  test('a user map matches the recorded name first, then maps the result through the table', () => {
    const map = parseEventMap('{"events":{"checkout_completed":"custom","legacy":"checkout_completed"}}', 'm.json');
    expect(normalizePushGroups([group('checkout_completed'), group('legacy')], map).map((g) => g.event)).toEqual(['custom', 'purchase']);
  });

  test('paths apply under the recorded name, the renamed name and the final name', () => {
    for (const key of ['checkout_completed', 'purchase', 'custom']) {
      const events = key === 'custom' ? '"events":{"checkout_completed":"custom"},' : '';
      const map = parseEventMap(`{${events}"paths":{"${key}":{"ecommerce":"data"}}}`, 'm.json');
      const [mapped] = normalizePushGroups([group('checkout_completed', ['ecommerce.value'])], map);
      expect(mapped!.paths.map((p) => p.path), key).toEqual(['data.value']);
    }
  });

  test('a swap map applies each paths entry to one group only', () => {
    const map = parseEventMap('{"events":{"a":"b","b":"a"},"paths":{"b":{"x":"one"}}}', 'm.json');
    const out = normalizePushGroups([group('a', ['x']), group('b', ['x'])], map);
    expect(out.map((g) => [g.event, g.paths.map((p) => p.path)])).toEqual([['b', ['one']], ['a', ['x']]]);
  });

  test('a chain map applies each paths entry to one group only', () => {
    const map = parseEventMap('{"events":{"a":"b","b":"c"},"paths":{"b":{"x":"one"}}}', 'm.json');
    const out = normalizePushGroups([group('a', ['x']), group('b', ['x'])], map);
    expect(out.map((g) => [g.event, g.paths.map((p) => p.path)])).toEqual([['b', ['one']], ['c', ['x']]]);
  });

  test('a user entry for a Shopify name wins over the built-in pairing', () => {
    const map = parseEventMap('{"events":{"checkout_completed":"custom"}}', 'm.json');
    expect(normalizePushGroups([group('checkout_completed')], map)[0]!.event).toBe('custom');
  });

  test('a path rename covers the path, its children and array items, and only in the named event', () => {
    const map = parseEventMap('{"paths":{"purchase":{"ecommerce":"data"}}}', 'm.json');
    const out = normalizePushGroups([group('purchase', ['ecommerce', 'ecommerce.items[*].id', 'ecommerceX', 'value']), group('other', ['ecommerce'])], map);
    expect(out[0]!.paths.map((p) => p.path)).toEqual(['data', 'data.items[*].id', 'ecommerceX', 'value']);
    expect(out[1]!.paths.map((p) => p.path)).toEqual(['ecommerce']);
  });

  test('a rename to the root maps an object push to a gtag event push', () => {
    const map = parseEventMap('{"paths":{"purchase":{"ecommerce":"."}}}', 'm.json');
    const object = group('purchase', ['event', 'ecommerce.value', 'ecommerce.items[*].id']);
    const gtag = group('purchase', ['value', 'items[*].id']);
    expect(normalizePushGroups([object], map)[0]!.paths.map((p) => p.path)).toEqual(['value', 'items[*].id']);
    expect(diffPushes([object], [gtag], { eventMap: map }).changed).toBe(false);
    expect(diffPushes([object], [gtag]).changed).toBe(true);
  });

  test('a root rename drops the source path itself', () => {
    const map = parseEventMap('{"paths":{"purchase":{"ecommerce":"."}}}', 'm.json');
    expect(normalizePushGroups([group('purchase', ['event', 'ecommerce', 'ecommerce[*]'])], map)[0]!.paths.map((p) => p.path)).toEqual(['[*]']);
  });

  test('a rename from the root maps a gtag event push to an object push', () => {
    const map = parseEventMap('{"paths":{"purchase":{".":"ecommerce"}}}', 'm.json');
    const gtag = group('purchase', ['value', 'items[*].id', '[*]']);
    const object = group('purchase', ['event', 'ecommerce.value', 'ecommerce.items[*].id', 'ecommerce[*]']);
    expect(normalizePushGroups([gtag], map)[0]!.paths.map((p) => p.path).sort()).toEqual(['ecommerce.items[*].id', 'ecommerce.value', 'ecommerce[*]', 'event']);
    expect(diffPushes([gtag], [object], { eventMap: map }).changed).toBe(false);
    expect(diffPushes([gtag], [object]).changed).toBe(true);
  });

  test('a root to root rename is rejected', () => {
    expect(() => parseEventMap('{"paths":{"purchase":{".":"."}}}', 'm.json')).toThrow('"paths" key 1, key 1 must name a key path');
  });
});

describe('push kind', () => {
  const kinded = (event: string, kind: 'gtag' | 'object', paths: string[] = []): PushGroup => ({ ...group(event, paths), kind });
  const kindsOf = (groups: PushGroup[]) => groups.map((g) => g.kind);

  test('a root rename sets the kind of the mapped shape', () => {
    const toGtag = parseEventMap(JSON.stringify({ paths: { purchase: { ecommerce: '.' } } }), 'm.json');
    expect(kindsOf(normalizePushGroups([kinded('purchase', 'object', ['event', 'ecommerce.value'])], toGtag))).toEqual(['gtag']);
    const toObject = parseEventMap(JSON.stringify({ paths: { purchase: { '.': 'ecommerce' } } }), 'm.json');
    expect(kindsOf(normalizePushGroups([kinded('purchase', 'gtag', ['value'])], toObject))).toEqual(['object']);
    const under = parseEventMap(JSON.stringify({ paths: { purchase: { value: 'ecommerce.value' } } }), 'm.json');
    expect(kindsOf(normalizePushGroups([kinded('purchase', 'object', ['value'])], under))).toEqual(['object']);
  });

  test('a built-in rename keeps the kind', () => {
    expect(kindsOf(normalizePushGroups([kinded('checkout_completed', 'object')]))).toEqual(['object']);
  });

  test('a gtag and an object purchase still pair and give path changes with a root rename', () => {
    const map = parseEventMap(JSON.stringify({ paths: { purchase: { '.': 'ecommerce' } } }), 'm.json');
    const d = diffPushes([kinded('purchase', 'gtag', ['value', 'currency'])], [kinded('purchase', 'object', ['event', 'ecommerce.value'])], { eventMap: map });
    expect(d.eventsAdded).toEqual([]);
    expect(d.eventsRemoved).toEqual([]);
    expect(d.pathsRemoved.map((p) => p.path)).toEqual(['ecommerce.currency']);
    expect(d.kindChanged).toEqual([]);
  });

  test('a Shopify object push pairs with a gtag purchase and warns once', () => {
    const d = diffPushes([kinded('checkout_completed', 'object', ['event', 'value'])], [kinded('purchase', 'gtag', ['value', 'currency'])]);
    expect(d.kindChanged).toEqual([{ epoch: 'undecided', event: 'purchase', frame: 'main', from: 'object', to: 'gtag', renamedFrom: 'checkout_completed' }]);
    expect(d.eventsRemoved).toEqual([]);
    expect(d.eventsAdded).toEqual([]);
    expect(d.pathsRemoved).toEqual([]);
    expect(d.pathsAdded.map((p) => p.path)).toEqual(['currency']);
  });

  test('a user entry for a Shopify name wins over the built-in pairing', () => {
    const map = parseEventMap(JSON.stringify({ events: { checkout_completed: 'order_done' } }), 'm.json');
    const a = [kinded('checkout_completed', 'object', ['value'])];
    const b = [kinded('order_done', 'gtag', ['value'])];
    expect(diffPushes(a, b).kindChanged).toEqual([]);
    const d = diffPushes(a, b, { eventMap: map });
    expect(d.kindChanged).toEqual([{ epoch: 'undecided', event: 'order_done', frame: 'main', from: 'object', to: 'gtag', renamedFrom: 'checkout_completed' }]);
    expect(d.eventsRemoved).toEqual([]);
  });

  test('two purchase groups of different kinds on one side stay two nodes', () => {
    const both = [kinded('purchase', 'gtag', ['value']), kinded('purchase', 'object', ['event'])];
    const d = diffPushes(both, [kinded('purchase', 'gtag', ['value'])]);
    expect(d.kindChanged).toEqual([]);
    expect(d.eventsRemoved).toEqual([{ epoch: 'undecided', event: 'purchase', kind: 'object', frame: 'main' }]);
    const e = diffPushes([kinded('checkout_completed', 'object', ['event'])], both);
    expect(e.kindChanged).toEqual([]);
    expect(e.eventsAdded).toEqual([{ epoch: 'undecided', event: 'purchase', kind: 'gtag', frame: 'main' }]);
  });
});

describe('null sections', () => {
  test.each(['{"events":null,"paths":null}', '{"events":{"a":"b"},"events":null}'])('%s parses to empty maps', (json) => {
    const map = parseEventMap(json, 'm.json');
    expect(map.events).toEqual({});
    expect(map.paths).toEqual({});
  });
});

describe('keepPushGroups', () => {
  test('keeps the recorded name and applies the paths of that name', () => {
    const map = parseEventMap('{"paths":{"a":{"x":"y"}}}', 'm.json');
    const [kept] = keepPushGroups([group('a', ['x'])], map);
    expect(kept).toMatchObject({ event: 'a' });
    expect(kept!.paths.map((p) => p.path)).toEqual(['y']);
  });

  test('a recorded name that another event is renamed to does not take that event paths entry through the built-in name', () => {
    const map = parseEventMap('{"events":{"other":"purchase"},"paths":{"purchase":{"x":"y"}}}', 'm.json');
    const [kept] = keepPushGroups([group('checkout_completed', ['x'])], map);
    expect(kept!.paths.map((p) => p.path)).toEqual(['x']);
    const [plain] = keepPushGroups([group('checkout_completed', ['x'])], parseEventMap('{"paths":{"purchase":{"x":"y"}}}', 'm.json'));
    expect(plain!.paths.map((p) => p.path)).toEqual(['y']);
  });
});
