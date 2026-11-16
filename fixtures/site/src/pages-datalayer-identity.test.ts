import { afterAll, beforeAll, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from './index.ts';

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

test('/datalayer-identity is served with the banner and pushes the fixture identity at once or after the answer', async () => {
  const res = await fetch(`${site.url}/datalayer-identity`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('<script src="/assets/banner.js"></script>');
  expect(html).not.toContain('site.js');
  expect(html).toContain("{ event: 'login', user: { email: email } }");
  expect(html).toContain('sha256_email_address');
  expect(html).toContain("get('after')");
  expect((await fetch(`${site.url}/datalayer-identity?after=1`)).status).toBe(200);
});
