import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureSite, type FixtureSite } from '@tagreeve/fixture-site';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { canaryValues } from '@tagreeve/core';
import { launchRecorder } from '../../src/index.ts';

const OTHER = 'TEST-NOCANARY-0001';
const canaries = canaryValues(7);
const gclid = canaries.find((c) => c.name === 'gclid')!.value;

let site: FixtureSite;
let outDir: string;

beforeAll(async () => {
  site = await startFixtureSite();
  const parent = fileURLToPath(new URL('../../../../test-results/', import.meta.url));
  await mkdir(parent, { recursive: true });
  outDir = await mkdtemp(join(parent, 'cookie-hop-'));
});

afterAll(async () => {
  await site?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

async function relay() {
  const recorder = await launchRecorder({ networkMode: 'stub', outDir, site: site.url, canaries });
  await recorder.visit(`${site.url}/click-id-relay?gclid=${gclid}`);
  await recorder.wait(500);
  return recorder;
}

test('a canary cookie gets its name, and no cookie value is stored', async () => {
  const recorder = await relay();
  const jar = await recorder.context.cookies();
  expect(decodeURIComponent(jar.find((c) => c.name === '_pw_click')!.value)).toBe(gclid);
  expect(jar.find((c) => c.name === '_pw_other')?.value).toBe(OTHER);
  const checkpoint = await recorder.checkpoint('relay', null);
  const { path } = await recorder.close();
  const click = checkpoint.cookies.find((c) => c.name === '_pw_click')!;
  const other = checkpoint.cookies.find((c) => c.name === '_pw_other')!;
  expect(click.canary).toBe('gclid');
  expect('canary' in other).toBe(false);
  for (const cookie of checkpoint.cookies) {
    const text = JSON.stringify(cookie);
    expect(text).not.toContain(gclid);
    expect(text).not.toContain(OTHER);
  }
  expect(await readFile(path, 'utf8')).not.toContain(OTHER);
}, 60_000);

test('a GCL cookie is matched by its token only', async () => {
  const recorder = await relay();
  const cookie = (value: string) => ({ name: '_pw_gcl', value, url: site.url });
  const find = async () => (await recorder.context.cookies()).find((c) => c.name === '_pw_gcl');
  await recorder.context.addCookies([cookie(`GCL.1700000000.${gclid}`)]);
  expect((await find())?.value).toBe(`GCL.1700000000.${gclid}`);
  const canary = await recorder.checkpoint('gcl-canary', null);
  await recorder.context.addCookies([cookie(`GCL.1700000000.${OTHER}`)]);
  expect((await find())?.value).toBe(`GCL.1700000000.${OTHER}`);
  const other = await recorder.checkpoint('gcl-other', null);
  await recorder.close();
  expect(canary.cookies.find((c) => c.name === '_pw_gcl')!.canary).toBe('gclid');
  expect('canary' in other.cookies.find((c) => c.name === '_pw_gcl')!).toBe(false);
  for (const ckp of [canary, other]) expect(JSON.stringify(ckp)).not.toContain('GCL.1700000000');
}, 60_000);
