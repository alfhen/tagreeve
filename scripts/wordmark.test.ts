import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./wordmark.ts', import.meta.url));
const brandFiles = ['lockup.svg', 'lockup-dark.svg', 'social-preview.svg'].map((f) => fileURLToPath(new URL(`../brand/${f}`, import.meta.url)));

function run(args: string[]) {
  const before = brandFiles.map((f) => readFileSync(f, 'utf8'));
  const result = spawnSync(process.execPath, ['--experimental-transform-types', script, ...args], { encoding: 'utf8' });
  expect(brandFiles.map((f) => readFileSync(f, 'utf8'))).toEqual(before);
  return result;
}

describe('wordmark script', () => {
  for (const [name, args] of [
    ['no argument', []],
    ['a missing file', ['/nonexistent-dir/jost-missing.woff']],
  ] as const) {
    it(`exits 2 with a usage line for ${name} and writes no brand file`, () => {
      const result = run([...args]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Usage: node scripts/wordmark.ts <path to the Jost Medium .woff file>');
      expect(result.stderr).not.toMatch(/@fontsource|node_modules/);
    });
  }
});
