import { afterAll, beforeAll, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from './index.ts';

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

test('/datalayer-kinds pushes the two purchase forms, a plain object and an arguments-like consent update', async () => {
  const html = await (await fetch(`${site.url}/datalayer-kinds`)).text();
  expect(html).toContain("window.gtag('event', 'purchase', { value: 25.5 })");
  expect(html).toContain("{ event: 'purchase', ecommerce: { value: 25.5 } }");
  expect(html).toContain("{ page_type: 'checkout', note: 'pw-planted-value-1' }");
  expect(html).toContain("{ 0: 'consent', 1: 'update', 2: { ad_storage: 'granted' } }");
  expect(html).not.toContain('site.js');
});
