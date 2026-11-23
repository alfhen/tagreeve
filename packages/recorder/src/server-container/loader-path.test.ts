import { describe, expect, test } from 'vitest';
import { containerPathFor } from './loader-path.ts';

const b64 = (text: string) => Buffer.from(text).toString('base64');
const loader = (inner: string, extra = '') => `https://sgtm.example.invalid/pwloader?k=${encodeURIComponent(b64(inner))}${extra}`;

describe('containerPathFor', () => {
  test('unwraps a /g/collect loader to its decoded path and query', () => {
    expect(containerPathFor(loader('/g/collect?v=2&tid=G-PWTEST0001'))).toEqual({ pathAndQuery: '/g/collect?v=2&tid=G-PWTEST0001', unwrapped: true });
  });

  test('unwraps a /data loader', () => {
    expect(containerPathFor(loader('/data?v=2&tid=G-PWTEST0001'))).toEqual({ pathAndQuery: '/data?v=2&tid=G-PWTEST0001', unwrapped: true });
  });

  test('keeps no other query parameter', () => {
    expect(containerPathFor(loader('/g/collect?v=2&tid=G-PWTEST0001', '&x=1'))).toEqual({ pathAndQuery: '/g/collect?v=2&tid=G-PWTEST0001', unwrapped: true });
  });

  test.each(['/s?v=2', '/g/collect/extra?v=2'])('sends a loader that decodes to %s unchanged', (inner) => {
    const url = loader(inner);
    const live = new URL(url);
    expect(containerPathFor(url)).toEqual({ pathAndQuery: `${live.pathname}${live.search}`, unwrapped: false });
  });

  test('sends a URL with two decodable values unchanged', () => {
    const url = `https://sgtm.example.invalid/pwloader?k=${encodeURIComponent(b64('/g/collect?v=2'))}&j=${encodeURIComponent(b64('/data?v=2'))}`;
    const live = new URL(url);
    expect(containerPathFor(url)).toEqual({ pathAndQuery: `${live.pathname}${live.search}`, unwrapped: false });
  });

  test('sends a plain request unchanged', () => {
    expect(containerPathFor('https://sgtm.example.invalid/g/collect?v=2')).toEqual({ pathAndQuery: '/g/collect?v=2', unwrapped: false });
  });

  test('does not throw on a bad URL', () => {
    expect(containerPathFor('not a url').unwrapped).toBe(false);
  });
});
