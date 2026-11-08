import { expect, test } from 'vitest';
import { run } from './cli-helpers.ts';

interface Shape {
  event: string;
  kind: string;
  frame: string;
  paths: { path: string; types: string[] }[];
}

interface Summary {
  dataLayer?: { pushes: number; steps: { step: string; events: Shape[] }[] };
}

const PLANTED = 'pw-planted-value-1';

test('the two purchase forms are two groups, and an arguments-like consent update is a gtag group', async () => {
  const r = await run('datalayer-kinds');
  const records = r.records!;
  const pushes = records.dataLayerEvents;
  expect(pushes).toHaveLength(4);
  expect(pushes.filter((e) => e.event === 'purchase')).toHaveLength(2);
  const consent = pushes.find((e) => e.args.length === 1 && JSON.stringify(e.args[0]).includes('"consent"'))!;
  expect(consent.args[0]).toEqual({ 0: 'consent', 1: 'update', 2: { ad_storage: 'granted' } });
  expect(JSON.stringify(pushes.map((e) => e.args))).toContain(PLANTED);

  const { dataLayer } = JSON.parse(r.stdout) as Summary;
  const events = dataLayer!.steps.flatMap((s) => s.events);
  const purchases = events.filter((e) => e.event === 'purchase');
  expect(purchases.map((e) => e.kind).sort()).toEqual(['gtag', 'object']);
  expect(purchases.find((e) => e.kind === 'gtag')!.paths.map((p) => p.path)).toEqual(['value']);
  expect(purchases.find((e) => e.kind === 'object')!.paths.map((p) => p.path)).toEqual(['event', 'ecommerce.value']);

  const update = events.filter((e) => e.event === 'consent update');
  expect(update).toHaveLength(1);
  expect(update[0]).toMatchObject({ kind: 'gtag', paths: [{ path: 'ad_storage', types: ['string'] }] });

  const plain = events.filter((e) => e.event === '(no event)');
  expect(plain).toHaveLength(1);
  expect(plain[0]).toMatchObject({ kind: 'object' });
  expect(plain[0]!.paths.map((p) => p.path)).toEqual(['page_type', 'note']);

  expect(r.stdout).not.toContain(PLANTED);
  expect(r.stderr).not.toContain(PLANTED);
  expect(r.stdout).not.toContain('granted');
}, 150_000);
