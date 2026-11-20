import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { consentCommandOf } from '@tagreeve/core';
import { startFixtureSite, type FixtureSite } from '@tagreeve/fixture-site';
import { launchRecorder } from '../../src/index.ts';

let site: FixtureSite;
let outDir: string;

beforeAll(async () => {
  site = await startFixtureSite();
  outDir = await mkdtemp(join(tmpdir(), 'pw-dlstamp-e2e-'));
});

afterAll(async () => {
  await site?.close();
  await rm(outDir, { recursive: true, force: true });
});

interface Seen {
  isArray: boolean;
  tag: string;
  k0: unknown;
  k1: unknown;
  k2: unknown;
  stamp: unknown;
  wrapRuns: number;
  innerIsNative: boolean;
}

async function load(query: string) {
  const previous = process.env.TAGREEVE_TEST_GTM_ORIGIN;
  process.env.TAGREEVE_TEST_GTM_ORIGIN = site.containerUrl;
  let recorder;
  try {
    recorder = await launchRecorder({ networkMode: 'stub', outDir, site: site.url });
  } finally {
    if (previous === undefined) delete process.env.TAGREEVE_TEST_GTM_ORIGIN;
    else process.env.TAGREEVE_TEST_GTM_ORIGIN = previous;
  }
  let seen: Seen;
  let early;
  try {
    const step = recorder.beginStep('stamp', 0);
    const page = await recorder.visit(`${site.url}/consent-mode-hits?push=stamped${query}`);
    await recorder.wait(600);
    seen = await page.evaluate(() => {
      const w = window as unknown as { dataLayer: Record<string, unknown>[]; pwWrapRuns: number; pwInnerIsNative: boolean };
      const item = w.dataLayer.find((x) => x[0] === 'consent')!;
      return {
        isArray: Array.isArray(item),
        tag: Object.prototype.toString.call(item),
        k0: item[0],
        k1: item[1],
        k2: item[2],
        stamp: item['gtm.uniqueEventId'],
        wrapRuns: w.pwWrapRuns,
        innerIsNative: w.pwInnerIsNative,
      };
    });
    early = recorder.stepActivity(step).dataLayerEvents.filter((e) => e.frame?.main);
    recorder.endStep(step);
  } catch (error) {
    await recorder.close().catch(() => undefined);
    throw error;
  }
  const { records } = await recorder.close();
  return { seen, early, late: records.dataLayerEvents.filter((e) => e.frame?.main) };
}

function stampedPush(events: { args: unknown[] }[]) {
  const pushes = events.filter((e) => {
    const first = e.args[0] as Record<string, unknown> | undefined;
    return first !== null && typeof first === 'object' && first['0'] === 'consent';
  });
  expect(pushes).toHaveLength(1);
  return pushes[0]!;
}

function expectRecordedObject(event: { args: unknown[] }) {
  expect(event.args).toHaveLength(1);
  const item = event.args[0] as Record<string, unknown>;
  expect(typeof item).toBe('object');
  expect(item).not.toBeNull();
  expect(Array.isArray(item)).toBe(false);
  expect(item['0']).toBe('consent');
  expect(item['1']).toBe('default');
  expect(typeof item['2']).toBe('object');
  return item;
}

function expectPageShape(seen: Seen) {
  expect(seen.isArray).toBe(false);
  expect(seen.tag).toBe('[object Object]');
  expect(seen.k0).toBe('consent');
  expect(seen.k1).toBe('default');
  expect(seen.k2).not.toBeNull();
  expect(typeof seen.k2).toBe('object');
  expect(Array.isArray(seen.k2)).toBe(false);
  expect(typeof seen.stamp).toBe('number');
  expect(seen.wrapRuns).toBe(1);
}

function report(mode: string, when: string, event: { args: unknown[] }) {
  const item = event.args[0] as Record<string, unknown>;
  const present = 'gtm.uniqueEventId' in item;
  console.log(`stamp observation: mode=${mode} ${when}: gtm.uniqueEventId in args[0]: ${present ? 'yes' : 'no'}; consentCommandOf(args): ${JSON.stringify(consentCommandOf(event.args))}`);
}

test('default order: the wrapper stamps after the recorder hook; the record shape is reported', async () => {
  const { seen, early, late } = await load('');
  expectPageShape(seen);
  expect(seen.innerIsNative).toBe(false);
  const first = stampedPush(early);
  const second = stampedPush(late);
  expectRecordedObject(first);
  expectRecordedObject(second);
  report('default', 'after the push', first);
  report('default', 'after the later read', second);
}, 60_000);

test('order=inner: the wrapper is the array own push before the recorder hooks it; the record shape is reported', async () => {
  const { seen, early, late } = await load('&order=inner');
  expectPageShape(seen);
  expect(seen.innerIsNative).toBe(true);
  const first = stampedPush(early);
  const second = stampedPush(late);
  expectRecordedObject(first);
  expectRecordedObject(second);
  report('order=inner', 'after the push', first);
  report('order=inner', 'after the later read', second);
}, 60_000);

test('when=before: the key stamped before the inner push is in the recorded args', async () => {
  const { seen, early, late } = await load('&when=before');
  expectPageShape(seen);
  expect(seen.innerIsNative).toBe(false);
  for (const event of [stampedPush(early), stampedPush(late)]) {
    const item = expectRecordedObject(event);
    expect(typeof item['gtm.uniqueEventId']).toBe('number');
  }
}, 60_000);
