import { afterAll, beforeAll, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from './index.ts';

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

test('/datalayer-rules pushes a purchase with no transaction ID before the banner is answered, and the sentinels', async () => {
  const html = await (await fetch(`${site.url}/datalayer-rules`)).text();
  expect(html).toContain('/assets/banner.js');
  expect(html).toContain("window.dataLayer.push({ event: 'purchase', ecommerce: ecommerce })");
  expect(html).toContain("if (q.get('complete') === '1') ecommerce.transaction_id = 'pw-rule-sentinel-order'");
  expect(html.match(/transaction_id/g)).toHaveLength(1);
  for (const sentinel of ['pw-rule-sentinel-coupon', 'pw-rule-sentinel-sku', 'pw-rule-sentinel-name', 'pw-rule-sentinel-order']) expect(html).toContain(sentinel);
});
