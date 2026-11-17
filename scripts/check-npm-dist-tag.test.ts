import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { distTagFor, distTagProblem } from './check-npm-dist-tag.ts';

describe('distTagFor', () => {
  it.each([
    ['0.7.0-rc.1', 'next'],
    ['1.10.3-rc.12', 'next'],
    ['0.7.0', 'latest'],
    ['1.10.3', 'latest'],
  ])('%s -> %s', (version, tag) => {
    expect(distTagFor(version)).toBe(tag);
  });

  it.each(['v0.7.0', '0.7.0-beta.1', '', '0.7', '0.7.0-rc', '0.7.0-rc.1-x', ' 0.7.0'])('refuses %j', (version) => {
    expect(() => distTagFor(version)).toThrow();
  });
});

describe('distTagProblem', () => {
  it.each([
    ['0.7.0-rc.1', { latest: '0.6.2', next: '0.6.2' }, true],
    ['0.7.0-rc.1', { latest: '0.6.2', next: '0.7.0-rc.1' }, false],
    ['0.7.0-rc.1', { latest: '0.7.0-rc.1', next: '0.6.2' }, true],
    ['0.7.0-rc.1', { latest: '0.6.2', next: '0.7.0-rc.10' }, true],
    ['0.7.0-rc.1', { latest: '0.6.2' }, true],
    ['0.7.0', { latest: '0.6.2', next: '0.7.0' }, true],
    ['0.7.0', { latest: '0.7.0', next: '0.7.0-rc.1' }, false],
    ['0.7.0', { next: '0.7.0' }, true],
    ['0.7.0', {}, true],
    ['0.7.0', null, true],
  ])('%s with %j gives a problem: %s', (version, tags, problem) => {
    expect(Boolean(distTagProblem(version, tags))).toBe(problem);
  });

  it.each(['v0.7.0', '0.7.0-beta.1', ''])('refuses %j even when npm serves it', (version) => {
    expect(() => distTagProblem(version, { latest: version, next: version })).toThrow();
  });
});

describe('CLI', () => {
  const script = fileURLToPath(new URL('./check-npm-dist-tag.ts', import.meta.url));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });

  it.each([['v0.7.0'], ['0.7.0-beta.1'], [''], []])('exits non-zero for %j before reaching npm', (...args) => {
    const r = run(...args);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Not a release version');
  });
});
