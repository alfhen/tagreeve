import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenario } from '@tagreeve/expect';
import { startFixtureSite, type FixtureSite } from '@tagreeve/fixture-site';
import type { Page } from 'playwright';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { HANDOFF_HOST_ID, launchRecorder, playScenario } from '../../src/index.ts';

let site: FixtureSite;
let outDir: string;

beforeAll(async () => {
  site = await startFixtureSite();
  const parent = fileURLToPath(new URL('../../../../test-results/', import.meta.url));
  await mkdir(parent, { recursive: true });
  outDir = await mkdtemp(join(parent, 'handoff-hardening-'));
});

afterAll(async () => {
  await site?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

const terminal = (_text: string, signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));

const LONG_TEXT = 'Pay the test order with the fake card on the checkout page, then wait here until the confirmation number shows up on screen';

async function open(path: string, text: string, initScript?: string) {
  const recorder = await launchRecorder({ networkMode: 'stub', outDir, site: site.url, headed: false, handoffOverlay: true });
  if (initScript) await recorder.context.addInitScript(initScript);
  const scenario = parseScenario(`start: ${path}\nsteps:\n  - handoff: ${JSON.stringify(text)}\n`);
  const played = playScenario(recorder, scenario, { handoffResolver: terminal, print: () => {} });
  played.catch(() => undefined);
  await expect.poll(() => recorder.context.pages().length, { timeout: 20_000 }).toBe(1);
  const page = recorder.context.pages()[0]!;
  await expect.poll(() => page.url(), { timeout: 20_000 }).toContain(path);
  await page.waitForLoadState('load');
  return { recorder, page, played };
}

async function pillBox(page: Page) {
  const host = page.locator(`#${HANDOFF_HOST_ID}`);
  await host.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await host.boundingBox();
  if (!box) throw new Error('the pill has no box');
  return box;
}

async function clickDone(page: Page) {
  const box = await pillBox(page);
  await page.mouse.click(box.x + box.width - 26, box.y + box.height / 2);
}

test('a page that patches textContent, style and getRootNode never receives the label or the host', async () => {
  const run = await open('/handoff-patched', 'Pay the test order');
  await pillBox(run.page);
  await clickDone(run.page);
  await run.played;
  await expect.poll(() => run.page.locator(`#${HANDOFF_HOST_ID}`).count(), { timeout: 10_000 }).toBe(0);
  const seen = await run.page.evaluate(
    () => (window as unknown as { __pwPatched: { textContent: string[]; style: string[]; rootNodes: string[] } }).__pwPatched,
  );
  expect(seen.textContent).not.toContain('Pay the test order');
  expect(seen.style).not.toContain('div#tagreeve-handoff');
  expect(seen.rootNodes).not.toContain('[object ShadowRoot]');
  await run.recorder.close();
}, 60_000);

test('a page that patches Function.prototype.call and Event.prototype.stopPropagation never sees the label or the closed root', async () => {
  const run = await open('/handoff', 'Pay the test order', `(() => {
    const seen = { call: [], stop: [], str: [] };
    window.__pwSeen = seen;
    const NativeString = String;
    window.String = function (v) {
      const text = NativeString(v);
      if (text.includes('Pay the test order')) seen.str.push(text);
      return text;
    };
    const call = Function.prototype.call;
    Function.prototype.call = function (self, ...args) {
      try { seen.call.push(String(self) + '|' + args.map(String).join(',')); } catch {}
      return call.apply(this, [self, ...args]);
    };
    const stop = Event.prototype.stopPropagation;
    Event.prototype.stopPropagation = function () {
      try { seen.stop.push(String(this.currentTarget)); } catch {}
      return stop.call(this);
    };
  })();`);
  const box = await pillBox(run.page);
  await run.page.mouse.move(box.x + 20, box.y + box.height / 2);
  await run.page.mouse.down();
  await run.page.mouse.move(box.x - 40, box.y - 40, { steps: 4 });
  await run.page.mouse.up();
  await clickDone(run.page);
  await run.played;
  const seen = await run.page.evaluate(() => (window as unknown as { __pwSeen: { call: string[]; stop: string[]; str: string[] } }).__pwSeen);
  expect(seen.str.join('\n')).not.toContain('Pay the test order');
  expect(seen.call.join('\n')).not.toContain('Pay the test order');
  expect(seen.call.join('\n')).not.toContain('HTMLSpanElement');
  expect(seen.stop).not.toContain('[object ShadowRoot]');
  await run.recorder.close();
}, 60_000);

// The Done button is in a closed shadow root that no page script can reach, so its own box is found by its fill colour (#2f7d4f) in a screenshot.
async function doneBox(page: Page) {
  const shot = (await page.screenshot({ scale: 'css' })).toString('base64');
  const box = await page.evaluate(async (png) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.abs(data[i]! - 0x2f) < 6 && Math.abs(data[i + 1]! - 0x7d) < 6 && Math.abs(data[i + 2]! - 0x4f) < 6) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }, shot);
  if (!box) throw new Error('the Done button is not drawn');
  return box;
}

test('a long handoff text keeps the pill inside a 390 px viewport with the Done button whole', async () => {
  const run = await open('/handoff', LONG_TEXT);
  let timer: NodeJS.Timeout | undefined;
  try {
    for (const width of [1280, 390]) {
      await run.page.setViewportSize({ width, height: 844 });
      const limit = Math.min(420, width - 32);
      await expect.poll(async () => (await pillBox(run.page)).width, { timeout: 10_000 }).toBeLessThanOrEqual(limit);
      const box = await pillBox(run.page);
      const done = await doneBox(run.page);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(done.width).toBeGreaterThan(40);
      expect(done.x).toBeGreaterThanOrEqual(box.x);
      expect(done.x + done.width).toBeLessThanOrEqual(box.x + box.width);
      expect(done.y).toBeGreaterThanOrEqual(box.y);
      expect(done.y + done.height).toBeLessThanOrEqual(box.y + box.height);
      expect(done.x + done.width).toBeLessThanOrEqual(width);
      const hit = await run.page.evaluate(
        ([id, x, y]) => document.elementFromPoint(x as number, y as number) === document.getElementById(id as string),
        [HANDOFF_HOST_ID, done.x + done.width / 2, done.y + done.height / 2],
      );
      expect(hit).toBe(true);
    }
    const done = await doneBox(run.page);
    await run.page.mouse.click(done.x + done.width / 2, done.y + done.height / 2);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('a click at the centre of the Done button did not end the wait')), 10_000);
    });
    await Promise.race([run.played, timeout]);
  } finally {
    clearTimeout(timer);
    await run.recorder.close();
  }
}, 60_000);
