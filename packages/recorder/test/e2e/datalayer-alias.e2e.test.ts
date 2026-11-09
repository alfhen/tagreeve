import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from '@tagreeve/fixture-site';
import { launchRecorder } from '../../src/index.ts';

let site: FixtureSite;
let outDir: string;

beforeAll(async () => {
  site = await startFixtureSite();
  outDir = await mkdtemp(join(tmpdir(), 'pw-dlalias-e2e-'));
});

afterAll(async () => {
  await site?.close();
  await rm(outDir, { recursive: true, force: true });
});

const kinds = (flags: { kind: string }[], kind: string) => flags.filter((f) => f.kind === kind);

async function run(mode: string, dataLayerNames?: string[], sabotage?: string) {
  const recorder = await launchRecorder({ networkMode: 'stub', outDir, site: site.url, ...(dataLayerNames ? { dataLayerNames } : {}) });
  try {
    const page = await recorder.visit(`${site.url}/datalayer-alias?mode=${mode}`);
    if (sabotage) await page.evaluate(sabotage);
    await recorder.wait(500);
  } catch (error) {
    await recorder.close().catch(() => undefined);
    throw error;
  }
  const started = Date.now();
  const { records } = await recorder.close();
  return { records, closeMs: Date.now() - started };
}

test('mode=alias records 3 pushes, gives no incomplete flag and does not wait out the posted deadline', async () => {
  const baseline = await run('alias');
  const { records, closeMs } = await run('alias', ['myLayer']);
  expect(records.dataLayerEvents.map((e) => e.event)).toEqual(['alias_one', 'alias_two', 'alias_three']);
  expect(kinds(records.flags, 'dataLayerIncomplete')).toEqual([]);
  // The posted-count wait is 1000 ms; a close that waited for it is that much slower than one with no alias name.
  expect(closeMs - baseline.closeMs).toBeLessThan(700);
}, 60_000);

test('mode=adopt records the child pushes once and gives no flag for the child frame', async () => {
  const { records } = await run('adopt');
  expect(records.dataLayerEvents.map((e) => e.event)).toEqual(['parent_one', 'child_one', 'child_two']);
  expect(kinds(records.flags, 'dataLayerIncomplete')).toEqual([]);
}, 60_000);

test('mode=status with dataLayerNames [status] gives one dataLayerNotHooked flag that names status', async () => {
  const { records } = await run('status', ['status']);
  const flags = records.flags.filter((f) => f.kind === 'dataLayerNotHooked');
  expect(flags).toHaveLength(1);
  expect(flags[0]!.detail).toContain('"status"');
}, 60_000);

const STALLS = {
  'a dataLayer getter': `Object.defineProperty(window, 'dataLayer', { configurable: true, get() { const t = Date.now(); while (Date.now() - t < 3000) {} return []; } });`,
  'the unload flush': `window.__tagreeveFlushUnload = () => { const t = Date.now(); while (Date.now() - t < 5000) {} };`,
};

for (const [name, sabotage] of Object.entries(STALLS)) {
  test(`page code that stalls ${name} cannot hide the dataLayerNotHooked flag`, async () => {
    const { records } = await run('status', ['status'], sabotage);
    const flags = records.flags.filter((f) => f.kind === 'dataLayerNotHooked');
    expect(flags).toHaveLength(1);
    expect(flags[0]!.detail).toContain('"status"');
  }, 60_000);
}
