import { expect, test } from 'vitest';
import { run } from './cli-helpers.ts';

test('wait with a url and a timeout fails at the given limit', async () => {
  const started = Date.now();
  const r = await run('wait-url-timeout');
  expect(Date.now() - started).toBeLessThan(20_000);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain('page did not reach /never* within 2s');
}, 90_000);
