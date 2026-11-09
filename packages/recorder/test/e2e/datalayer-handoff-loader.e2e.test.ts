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
  outDir = await mkdtemp(join(tmpdir(), 'pw-dlhandoff-e2e-'));
});

afterAll(async () => {
  await site?.close();
  await rm(outDir, { recursive: true, force: true });
});

const LOADER = 'https://www.googletagmanager.com/gtm.js?id=GTM-PWTEST1&l=myLayer';

async function loadDuringHandoff(dataLayerNames: string[] | undefined) {
  const recorder = await launchRecorder({ networkMode: 'stub', outDir, site: site.url, ...(dataLayerNames ? { dataLayerNames } : {}) });
  try {
    const page = await recorder.visit(`${site.url}/`);
    recorder.setHandoff(true);
    await page.evaluate(async (src) => {
      await new Promise<void>((resolve) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.head.append(script);
      });
    }, LOADER);
    await recorder.wait(300);
    recorder.setHandoff(false);
  } catch (error) {
    await recorder.close().catch(() => undefined);
    throw error;
  }
  const { records } = await recorder.close();
  const loader = records.requests.find((r) => r.url.includes('/gtm.js'));
  return { flags: records.flags.filter((f) => f.kind === 'dataLayerNotHooked'), loader };
}

test('a loader sent during a handoff names its layer, and the stored URL is redacted', async () => {
  const { flags, loader } = await loadDuringHandoff(['myLayer']);
  expect(loader).toBeDefined();
  expect(loader!.redacted).toBe('handoff');
  expect(loader!.url).not.toContain('myLayer');
  expect(loader!.url).toMatch(/l=(\[|%5B)redacted(\]|%5D)/);
  expect(flags).toEqual([]);
}, 60_000);

test('without the option the same loader raises one flag that names the layer', async () => {
  const { flags, loader } = await loadDuringHandoff(undefined);
  expect(loader!.redacted).toBe('handoff');
  expect(loader!.url).not.toContain('myLayer');
  expect(flags).toHaveLength(1);
  expect(flags[0]!.detail).toContain('"myLayer"');
}, 60_000);
