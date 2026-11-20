import { describe, expect, test } from 'vitest';
import { canaryPool, canaryValues, CANARY_NAMES } from './canary.ts';
import { createIdentity, fieldHashes } from './identity.ts';

const values = (seed: number, cell?: string) => canaryValues(seed, cell).map((c) => c.value);

describe('canaryValues', () => {
  test('seed 7 with no cell gives TEST-<PARAM>-7-RUN-0001 for the six names, in order', () => {
    expect(canaryValues(7)).toEqual(CANARY_NAMES.map((name) => ({ source: 'urlParam', name, value: `TEST-${name.toUpperCase()}-7-RUN-0001` })));
    expect(canaryValues(7)[0]!.value).toBe('TEST-GCLID-7-RUN-0001');
    expect(CANARY_NAMES).toEqual(['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid']);
  });

  test('a cell replaces RUN in upper case', () => {
    expect(canaryValues(7, 'reject')[0]!.value).toBe('TEST-GCLID-7-REJECT-0001');
  });

  test('two seeds or two cells differ for every name, one seed and cell repeat', () => {
    for (const [a, b] of [[values(7), values(8)], [values(7, 'accept'), values(7, 'reject')]] as const) {
      a.forEach((value, i) => expect(value).not.toBe(b[i]));
    }
    expect(canaryValues(7, 'accept')).toEqual(canaryValues(7, 'accept'));
  });

  test('every value starts with TEST-', () => {
    for (const value of [...values(7), ...values(1, 'withdraw')]) expect(value.startsWith('TEST-')).toBe(true);
  });
});

describe('canaryPool', () => {
  const canaries = canaryValues(7);
  const identity = createIdentity(7);
  const pool = canaryPool(canaries, identity);
  const base64 = (text: string, kind: 'base64' | 'base64url') => Buffer.from(text).toString(kind);

  test.each([
    ['gclid', canaries[0]!.value],
    ['email', identity.email],
    ['phone', identity.phone],
  ])('holds every form of the %s value', (name, value) => {
    const forms = [value, encodeURIComponent(value), base64(value, 'base64'), base64(value, 'base64url'), ...fieldHashes(value.trim().toLowerCase())];
    for (const form of forms) expect(pool.forms.get(form)).toBe(name);
    expect(forms.length).toBeGreaterThanOrEqual(7);
  });

  test('matches the click ID cookies to their canary and not a changed token', () => {
    expect(pool.match('GCL.1700000000.TEST-GCLID-7-RUN-0001')).toBe('gclid');
    expect(pool.match('fb.1.1700000000000.TEST-FBCLID-7-RUN-0001')).toBe('fbclid');
    expect(pool.match('GCL.1700000000.TEST-GCLID-7-RUN-0002')).toBeUndefined();
    expect(pool.match('fb.1.1700000000000.TEST-FBCLID-7-RUN-0000')).toBeUndefined();
  });

  test('matches a decoded layer and the digest of an identity value', () => {
    expect(pool.match(encodeURIComponent(canaries[1]!.value))).toBe('gbraid');
    expect(pool.match(base64(canaries[2]!.value, 'base64'))).toBe('wbraid');
    expect(pool.match([...fieldHashes(identity.email)][0]!)).toBe('email');
  });

  test('without an identity only the canaries are held', () => {
    const only = canaryPool(canaries, null);
    expect(only.match(identity.email)).toBeUndefined();
    expect(only.match(canaries[3]!.value)).toBe('fbclid');
  });
});
