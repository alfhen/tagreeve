import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { root, run } from './cli-helpers.ts';

interface PushRef {
  event: string;
  renamedFrom?: string;
}

interface PushDiff {
  eventsAdded: PushRef[];
  eventsRemoved: PushRef[];
  pathsAdded: (PushRef & { path: string })[];
}

function diff(a: string, b: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [join(root, 'dist/cli.js'), 'diff', a, b, '--json'], { cwd: root }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

test('diff names an event as the run pushed it and keeps the older name in renamedFrom', async () => {
  const a = await run('datalayer-event-map-a');
  const b = await run('datalayer-event-map-b');
  expect(a.code).toBe(0);
  expect(b.code).toBe(0);
  const names = (r: typeof a) => r.records!.dataLayerEvents.map((e) => e.event);
  expect(names(a)).toContain('checkout_completed');
  expect(names(a)).not.toContain('purchase');
  expect(names(b)).toContain('purchase');
  expect(names(b)).not.toContain('checkout_completed');

  const out = await diff((JSON.parse(a.stdout) as { path: string }).path, (JSON.parse(b.stdout) as { path: string }).path);
  const d = (JSON.parse(out) as { dataLayer: PushDiff }).dataLayer;
  const coupon = d.pathsAdded.filter((p) => p.path === 'coupon');
  expect(coupon).toHaveLength(1);
  expect(coupon[0]).toMatchObject({ event: 'purchase', renamedFrom: 'checkout_completed' });
  expect([...d.pathsAdded, ...d.eventsAdded, ...d.eventsRemoved].some((r) => r.event === 'checkout_completed')).toBe(false);
}, 240_000);
