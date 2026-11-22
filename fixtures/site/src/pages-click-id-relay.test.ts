import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from './index.ts';

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

describe.each(['/click-id-relay', '/click-id-relay-send'])('%s', (path) => {
  test('is a plain page that loads banner.js and holds no Shopify string', async () => {
    const res = await fetch(`${site.url}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<script src="/assets/banner.js"></script>');
    expect(html).not.toMatch(/shopify|myshopify|web-pixels|<iframe/i);
  });
});

test('the relay page sets the two cookies and the send page sends the cookie value as base64', async () => {
  const relay = await (await fetch(`${site.url}/click-id-relay`)).text();
  expect(relay).toContain('_pw_click');
  expect(relay).toContain('_pw_other=TEST-NOCANARY-0001');
  const send = await (await fetch(`${site.url}/click-id-relay-send?send=granted`)).text();
  expect(send).toContain('AW-000000001');
  expect(send).toContain('btoa(');
  expect(send).toContain("'send') === 'granted'");
});
