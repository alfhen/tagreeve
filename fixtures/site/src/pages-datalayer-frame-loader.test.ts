import { afterAll, beforeAll, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from './index.ts';

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

test('/datalayer-frame-loader embeds the child in an iframe and has a link to leave', async () => {
  const res = await fetch(`${site.url}/datalayer-frame-loader`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('<iframe src="/datalayer-frame-loader-child"');
  expect(html).toContain('id="go"');
});

test('/datalayer-frame-loader-child loads gtm.js with an l= layer', async () => {
  const res = await fetch(`${site.url}/datalayer-frame-loader-child`);
  expect(res.status).toBe(200);
  expect(await res.text()).toMatch(/gtm\.js\?id=GTM-PWTEST1&amp;l=myLayer/);
});
