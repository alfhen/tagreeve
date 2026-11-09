import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenario } from '@tagreeve/expect';
import { startFixtureSite, type FixtureSite } from '@tagreeve/fixture-site';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { launchRecorder, playScenario } from '../../src/index.ts';

let site: FixtureSite;
let outDir: string;

beforeAll(async () => {
  site = await startFixtureSite();
  const parent = fileURLToPath(new URL('../../../../test-results/', import.meta.url));
  await mkdir(parent, { recursive: true });
  outDir = await mkdtemp(join(parent, 'wait-url-form-'));
});

afterAll(async () => {
  await site?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

async function failureOf(steps: string): Promise<{ error: string; footerInvalid: boolean }> {
  const recorder = await launchRecorder({ networkMode: 'stub', outDir, site: site.url });
  try {
    const scenario = parseScenario(`start: /terms-footer\nsteps:\n${steps}  - wait: { url: "/thank-you*" }\n`);
    const error = await playScenario(recorder, scenario, { actionTimeoutMs: 2000 }).then(
      () => '',
      (e: Error) => e.message,
    );
    const page = recorder.context.pages()[0]!;
    const footerInvalid = await page.evaluate(() => (document.getElementById('newsletter-email') as HTMLInputElement).validity.valid === false);
    return { error, footerInvalid };
  } finally {
    await recorder.close().catch(() => undefined);
  }
}

test('a wait timeout after Pay lists the controls of the Pay form and not the footer form', async () => {
  const { error, footerInvalid } = await failureOf('  - click: { role: button, name: Pay now }\n');
  expect(footerInvalid).toBe(true);
  expect(error).toContain('Blocking controls: checkbox "terms" (required, not ticked).');
  expect(error).not.toContain('newsletter-email');
});

test('with no click before the wait, every control is listed', async () => {
  const { error } = await failureOf('  - wait: 100\n');
  expect(error).toContain('checkbox "terms" (required, not ticked)');
  expect(error).toContain('newsletter-email');
});
