import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from './index.ts';

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

const forbidden = [/web-pixels/i, /wpm@/i, /myshopify/i, /shopify/i, /shop\.app/i, /<iframe/i];

describe.each(['/plain/product', '/plain/checkout', '/plain/thank-you'])('%s', (path) => {
  test('loads banner.js and plain-gtm.js from the shop and holds no Shopify string or iframe', async () => {
    const res = await fetch(`${site.url}${path}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<script src="/assets/banner.js"></script>');
    expect(html).toContain('<script src="/assets/plain-gtm.js"></script>');
    const texts = [html];
    for (const asset of ['banner.js', 'plain-gtm.js']) {
      const script = await fetch(`${site.url}/assets/${asset}`);
      expect(script.status).toBe(200);
      texts.push(await script.text());
    }
    for (const text of texts) for (const re of forbidden) expect(text).not.toMatch(re);
  });
});

test('/plain/checkout is a form with the fake store field IDs that goes to /plain/thank-you', async () => {
  const html = await (await fetch(`${site.url}/plain/checkout`)).text();
  for (const id of ['email', 'first-name', 'last-name', 'phone', 'address1', 'city', 'zip', 'country']) {
    expect(html).toContain(`id="${id}"`);
  }
  expect(html).toMatch(/<form[^>]*action="\/plain\/thank-you"/);
  expect(html).toContain('type="submit"');
});

test('plain-gtm.js pushes the typed email after the banner answer, and at once with ?identity=early', async () => {
  const script = await (await fetch(`${site.url}/assets/plain-gtm.js`)).text();
  expect(script).toContain("get('identity') === 'early'");
  expect(script).toContain("event: 'identify'");
  expect(script).toContain('pwConsent.onAnswer(pushIdentity)');
  expect((await fetch(`${site.url}/plain/checkout?identity=early`)).status).toBe(200);
});

test('a page that is not in the plain shop is 404 next to a 200 for the product page', async () => {
  expect((await fetch(`${site.url}/plain/product`)).status).toBe(200);
  expect((await fetch(`${site.url}/plain/nope`)).status).toBe(404);
});

test('plain-gtm.js links the product page to the checkout on 127.0.0.1 with ?checkout=offsite and rotates the cid with ?cid=rotate', async () => {
  const script = await (await fetch(`${site.url}/assets/plain-gtm.js`)).text();
  expect(script).toContain("get('checkout') === 'offsite'");
  expect(script).toContain("'//127.0.0.1:'");
  expect(script).toContain("get('cid') === 'rotate'");
  expect(script).toContain("'&sid=' + SID");
});

test('the offsite checkout page returns 200 and no served text holds a Shopify string or an iframe', async () => {
  const res = await fetch(`${site.url}/plain/checkout?cid=rotate`);
  expect(res.status).toBe(200);
  const texts = [await res.text()];
  for (const asset of ['banner.js', 'plain-gtm.js']) texts.push(await (await fetch(`${site.url}/assets/${asset}`)).text());
  expect((await fetch(`${site.url}/plain/product?checkout=offsite&cid=rotate`)).status).toBe(200);
  for (const text of texts) for (const re of forbidden) expect(text).not.toMatch(re);
});
