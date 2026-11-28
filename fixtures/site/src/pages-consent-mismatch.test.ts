import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startFixtureSite, type FixtureSite } from './index.ts';

let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
});

afterAll(async () => {
  await site.close();
});

const get = async (path: string) => {
  const res = await fetch(`${site.url}${path}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  return res.text();
};

describe('/consent-state-mismatch', () => {
  test.each(['', '?leak=1', '?frame=1'])('%s is served without an extension', async (query) => {
    await get(`/consent-state-mismatch${query}`);
  });

  test('the page grants, denies 200 ms later and sends its hit 2500 ms after the denial', async () => {
    const html = await get('/consent-state-mismatch');
    expect(html).toContain("gtag('consent', 'update', granted)");
    expect(html).toContain("gtag('consent', 'update', denied); }, 200)");
    expect(html).toContain('}, 2700)');
    expect(html).toContain('gcs=G111&gcd=11t1t1t1t5');
  });

  test('the page reads each variant from the query and loads no site script', async () => {
    const html = await get('/consent-state-mismatch');
    expect(html).toContain("q.get('frame') === '1'");
    expect(html).toContain("q.get('leak') === '1'");
    expect(html).not.toContain('/assets/banner.js');
    expect(html).not.toContain('/assets/site.js');
  });

  test('the frame is served and pushes the same updates', async () => {
    const html = await get('/consent-state-mismatch-frame');
    expect(html).toContain("gtag('consent', 'update'");
    expect(html).toContain('}, 2700)');
    expect(html).toContain('/g/collect?v=2&tid=G-PWTEST0001');
  });

  test('the pages name only the fake tag IDs', async () => {
    for (const path of ['/consent-state-mismatch', '/consent-state-mismatch-frame']) {
      const ids = (await get(path)).match(/\b(?:G|AW|GTM)-[A-Z0-9]{4,}/g) ?? [];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(['G-PWTEST0001', 'AW-000000001', 'GTM-PWTEST1', 'GTM-PWNOVER']).toContain(id);
    }
  });
});
