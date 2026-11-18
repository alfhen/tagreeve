import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { distTagFor } from './check-npm-dist-tag.ts';

const versions = [
  '0.7.0',
  '1.10.3',
  '0.7.0-rc.1',
  '1.10.3-rc.12',
  '0.7.0-beta.1',
  'v0.7.0',
  '0.7',
  '0.7.0-rc',
  '0.7.0-rc.1-x',
  ' 0.7.0',
  '0.7.0\n',
  '٠.7.0',
  '',
];

const dir = mkdtempSync(join(tmpdir(), 'release-version-'));
mkdirSync(join(dir, 'scripts'));
const script = join(dir, 'scripts', 'release.sh');
copyFileSync(join(import.meta.dirname, 'release.sh'), script);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function accepted(version: string): boolean {
  try {
    distTagFor(version);
    return true;
  } catch {
    return false;
  }
}

describe('release.sh version check', () => {
  const argLists: Array<(version: string) => string[]> = [
    (version) => ['--no-tag', version],
    (version) => [version],
  ];

  it.each(versions)('agrees with distTagFor on %j', (version) => {
    for (const args of argLists) {
      const run = spawnSync('bash', [script, ...args(version)], { cwd: dir, encoding: 'utf8' });
      const refused = /^refusing: version must be/m.test(run.stderr);
      expect(refused).toBe(!accepted(version));
      if (refused) {
        expect(run.status).toBe(1);
        expect(run.stderr).not.toMatch(/fatal:|ENOENT|pnpm/);
        expect(run.stdout).toBe('');
        expect(readdirSync(dir)).toEqual(['scripts']);
        expect(readdirSync(join(dir, 'scripts'))).toEqual(['release.sh']);
      }
    }
  });
});
