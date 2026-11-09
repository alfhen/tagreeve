import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { decodedVendors, stubbedVendors } from '../site/src/lib/vendors.ts';
import { docsUrl, newDocsContext, root } from './docs-test-helpers.ts';

const safeHeading = 'Known vendor hits stay local.';

let browser: Browser | undefined;

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium' });
});

afterAll(async () => {
  await browser?.close();
});

test('the vendors, safe by default, the name and the sign-off render in that order with their headings', async () => {
  const context = await newDocsContext(browser!);
  const page = await context.newPage();
  await page.goto(`${docsUrl}/`);

  const vendors = page.getByRole('region', { name: 'Vendors', exact: true });
  const safe = page.getByRole('region', { name: safeHeading });
  const name = page.getByRole('region', { name: "There's a new sheriff in tag town." });
  const signOff = page.getByRole('region', { name: 'Sign-off' });
  const sections = [vendors, safe, name, signOff];
  for (const section of sections) expect(await section.count()).toBe(1);
  const handles = await Promise.all(sections.map((s) => s.elementHandle()));
  const inOrder = await page.evaluate(
    (els) => els.every((el, i) => i === 0 || Boolean(els[i - 1]!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING)),
    handles,
  );
  expect(inOrder).toBe(true);

  for (const label of ['decoded', 'stubbed & recorded', 'on the way']) expect(await vendors.getByText(label, { exact: true }).count(), label).toBe(1);
  expect(await vendors.locator('[data-vendors="decoded"] > span').allTextContents()).toEqual([...decodedVendors]);
  expect(await vendors.locator('[data-vendors="stubbed"] > span').allTextContents()).toEqual([...stubbedVendors, '+ --tracker-list']);

  expect(await safe.locator('h2').textContent()).toBe(safeHeading);
  expect(await safe.getByText('// safe by default').count()).toBe(1);
  for (const code of ['stub mode', 'fake identity', 'handoff', 'tagreeve/runs/**/*.jsonl']) expect(await safe.getByText(code, { exact: true }).count(), code).toBe(1);

  expect(await name.locator('h2').textContent()).toBe("There's a new sheriff in tag town.");
  expect(await name.getByText(/^Pronounced like "tag reeve"\. Formerly \w+\.$/).count()).toBe(1);

  expect(await signOff.getByRole('img', { name: 'TAGREEVE' }).count()).toBe(1);
  expect(await signOff.getByText('the new tag sheriff in town').count()).toBe(1);
  await context.close();
});

test('the sign-off banner fits a 390 px screen: the font shrinks and nothing scrolls sideways', async () => {
  const context = await newDocsContext(browser!, { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${docsUrl}/`);
  const banner = page.locator('[data-banner]');
  const fit = await banner.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right, fontSize: parseFloat(getComputedStyle(el).fontSize), width: window.innerWidth, scroll: el.scrollWidth <= el.clientWidth };
  });
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.width);
  expect(fit.scroll).toBe(true);
  expect(fit.fontSize).toBeLessThan(15);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});

const demoFile = (name: string) => readFileSync(join(root, 'site/demo', name), 'utf8');

test('the --json panel keeps its recorded indent in the text, and a flag never breaks across lines', async () => {
  const context = await newDocsContext(browser!, { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${docsUrl}/`);
  const recorded = demoFile('reject.json').replace(/\n$/, '').split('\n');
  expect(recorded.some((line) => line.startsWith('  "'))).toBe(true);
  await page.locator('button[data-command="json"]').click();
  const lines = await page.locator('[data-command-panel="json"] [data-command-line]').allTextContents();
  expect(lines.slice(1)).toEqual(recorded);

  await page.locator('button[data-command="run"]').click();
  const flag = page.locator('[data-command-panel="run"] [data-command-line]').first().locator('span', { hasText: '--site' });
  expect(await flag.count()).toBe(1);
  expect(await flag.evaluate((el) => el.getClientRects().length)).toBe(1);
  await context.close();
});

test('the run panel shows its Result line at 1440 x 900 without scrolling the panel', async () => {
  const context = await newDocsContext(browser!, { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${docsUrl}/`);
  const panel = page.locator('[data-command-panel="run"]');
  expect(await panel.locator('[data-command-line]', { hasText: /^Result: / }).count()).toBe(1);
  const fit = await panel.evaluate((el) => {
    const line = [...el.querySelectorAll('[data-command-line]')].find((l) => l.textContent?.startsWith('Result: '))!;
    return { clipped: el.scrollHeight > el.clientHeight, inside: line.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom };
  });
  expect(fit).toEqual({ clipped: false, inside: true });
  await context.close();
});

test('the agent demo island gets only the story host, the prompt and the scenarios', async () => {
  const context = await newDocsContext(browser!);
  const page = await context.newPage();
  await page.goto(`${docsUrl}/`);
  const props = await page.locator('astro-island[component-url*="AgentDemo"]').getAttribute('props');
  expect(props).not.toBeNull();
  expect(Object.keys(JSON.parse(props!) as object).sort()).toEqual(['scenarios', 'storyHost', 'userPrompt']);
  for (const output of ['Manifest: ', 'Diff ', '"expectation"']) expect(props, output).not.toContain(output);
  await context.close();
});
