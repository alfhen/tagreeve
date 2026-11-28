import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from './index.ts';

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

const variants = ['', '?order=late', '?grant=ad', '?update=early', '?update=late'];

describe('/consent-mode-order', () => {
  test.each(variants)('%s is served without an extension', async (query) => {
    const res = await fetch(`${site.url}/consent-mode-order${query}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  test('the page reads each variant from the query', async () => {
    const html = await (await fetch(`${site.url}/consent-mode-order`)).text();
    expect(html).toContain("q.get('order') === 'late'");
    expect(html).toContain("q.get('grant') === 'ad'");
    expect(html).toContain("q.get('update')");
    expect(html).toContain("update === 'early'");
    expect(html).toContain("update === 'late'");
  });

  test('the page has its own banner and loads neither site.js nor banner.js', async () => {
    const html = await (await fetch(`${site.url}/consent-mode-order`)).text();
    expect(html).toContain('id="pw-consent-banner"');
    expect(html).toContain('id="pw-accept"');
    expect(html).not.toContain('/assets/banner.js');
    expect(html).not.toContain('/assets/site.js');
  });

  test('the default is pushed before config, and after it with order=late', async () => {
    const html = await (await fetch(`${site.url}/consent-mode-order`)).text();
    expect(html).toContain("if (q.get('order') === 'late') { setConfig(); setDefault(); } else { setDefault(); setConfig(); }");
  });

  test('the late update is pushed 300 ms after the answer, the hit 100 ms after it', async () => {
    const html = await (await fetch(`${site.url}/consent-mode-order`)).text();
    expect(html).toContain('setTimeout(sendHit, 100)');
    expect(html).toContain('}, 300)');
  });

  test('the page names only the fake tag IDs', async () => {
    const html = await (await fetch(`${site.url}/consent-mode-order`)).text();
    const ids = html.match(/\b(?:G|AW|GTM)-[A-Z0-9]{4,}/g) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(['G-PWTEST0001', 'AW-000000001', 'GTM-PWTEST1', 'GTM-PWNOVER']).toContain(id);
  });
});
