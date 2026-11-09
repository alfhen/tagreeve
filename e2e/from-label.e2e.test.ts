import { expect, test } from 'vitest';
import { run } from './cli-helpers.ts';

interface Summary {
  results: { expectation: string; pass: boolean; message: string; evidence: string[] }[];
}

test('from: counts the visit step own page-load hits, after: does not', async () => {
  const r = await run('from-label');
  const { results } = JSON.parse(r.stdout) as Summary;
  const from = results.find((x) => x.expectation.includes('"from":"product"'))!;
  const after = results.find((x) => x.expectation.includes('"after":"product"'))!;
  expect(from.pass).toBe(true);
  expect(from.message).toContain('matching hits from product, found 1 matching hit');
  expect(from.evidence).toHaveLength(1);
  expect(after.pass).toBe(true);
  expect(after.message).toContain('matching hits after product, found 0');
  for (const x of results.filter((y) => y.pass)) expect(x.message, x.expectation).not.toBe('');
  expect(r.code).toBe(0);
}, 90_000);
