import { runInNewContext } from 'node:vm';
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

test('the relay page sends its page view once, after the consent answer', async () => {
  const html = await (await fetch(`${site.url}/click-id-relay`)).text();
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const href = 'http://127.0.0.1:1/click-id-relay?gclid=TEST-GCLID';
  const load = (stored: string | null) => {
    const sent: string[] = [];
    const listeners: Array<(c: string) => void> = [];
    const win: Record<string, unknown> = {
      URLSearchParams,
      location: { href, search: '?gclid=TEST-GCLID' },
      document: { cookie: '' },
      Image: function () {
        return {
          set src(u: string) {
            sent.push(u);
          },
        };
      },
      pwConsent: { choice: () => stored, onAnswer: (cb: (c: string) => void) => listeners.push(cb) },
    };
    win.window = win;
    runInNewContext(code, win);
    return { sent, answer: (c: string) => listeners.forEach((cb) => cb(c)) };
  };
  for (const c of ['accept', 'reject']) {
    const page = load(null);
    expect(page.sent).toHaveLength(0);
    page.answer(c);
    page.answer('accept');
    expect(page.sent).toHaveLength(1);
    const q = new URL(page.sent[0]!).searchParams;
    expect(q.get('tid')).toBe('G-PWTEST0001');
    expect(q.get('dl')).toBe(href);
    const stored = load(c);
    expect(stored.sent).toHaveLength(1);
    stored.answer('reject');
    expect(stored.sent).toHaveLength(1);
  }
});
