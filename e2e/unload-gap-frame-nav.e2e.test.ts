import { expect, test } from 'vitest';
import { run } from './cli-helpers.ts';

test("a hit from a frame's next document does not cover a push from its earlier document", async () => {
  const { records } = await run('unload-gap-frame-nav');
  const push = records!.dataLayerEvents.find((e) => e.event === 'add_to_cart');
  expect(push).toBeDefined();
  const other = records!.hits.find((h) => h.vendor === 'ga4' && h.event === 'other_frame_ga');
  expect(other).toBeDefined();
  expect(other!.t).toBeGreaterThanOrEqual(push!.t);
  expect(other!.t).toBeLessThan(records!.steps.at(-1)!.endedAt!);
  const otherRequest = records!.requests.find((r) => r.id === other!.requestId);
  expect(otherRequest!.frameUrl).toContain('/unload-gap-frame-nav-frame');
  expect(records!.hits.some((h) => h.event === 'add_to_cart')).toBe(false);
  const gaps = records!.flags.filter((f) => f.kind === 'unloadGap');
  expect(gaps).toHaveLength(1);
  expect(gaps[0]!.recordIds).toEqual([push!.id]);
  expect(gaps[0]!.detail).toContain('"add_to_cart"');
}, 90_000);

test('a push from the main frame right before a navigation is not an unload gap', async () => {
  const { records } = await run('unload-gap-main-nav');
  const push = records!.dataLayerEvents.find((e) => e.event === 'add_to_cart');
  expect(push).toBeDefined();
  expect(push!.frame?.main).toBe(true);
  expect(records!.dataLayerEvents.some((e) => e.frame?.main === false)).toBe(false);
  expect(records!.hits.some((h) => h.event === 'add_to_cart')).toBe(false);
  expect(records!.requests.some((r) => new URL(r.url).pathname === '/' && r.url.startsWith('http://localhost'))).toBe(true);
  expect(records!.flags.filter((f) => f.kind === 'unloadGap')).toEqual([]);
}, 90_000);
