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

describe('/double-send', () => {
  test.each(['', '?mode=top', '?mode=listener', '?mode=one', '?mode=different'])('%s is served as HTML', async (query) => {
    await get(`/double-send${query}`);
  });

  test('the page embeds the frame, reads its mode from the query and loads no site script', async () => {
    const html = await get('/double-send');
    expect(html).toContain("frame.src = '/double-send-frame'");
    expect(html).toContain("q.get('mode')");
    expect(html).not.toContain('/assets/banner.js');
    expect(html).not.toContain('/assets/site.js');
  });

  test('the frame is served and sends the same hit', async () => {
    const html = await get('/double-send-frame');
    expect(html).toContain('/g/collect?v=2&tid=G-PWTEST0001&cid=555000111.1700000001&en=purchase');
  });

  test('the pages name only the fake tag IDs', async () => {
    for (const path of ['/double-send', '/double-send-frame']) {
      const ids = (await get(path)).match(/\b(?:G|AW|GTM)-[A-Z0-9]{4,}/g) ?? [];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(['G-PWTEST0001', 'AW-000000001', 'GTM-PWTEST1', 'GTM-PWNOVER']).toContain(id);
    }
  });
});
