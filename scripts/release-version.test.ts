import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

describe('release.sh --at', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-at-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nif [ "$1" = build ]; then mkdir -p dist; echo "" > dist/cli.js; fi\n');
  chmodSync(join(bin, 'pnpm'), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 't@example.com',
  };
  const git = (cwd: string, ...args: string[]): string => {
    const run = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
  };
  let count = 0;
  const fresh = (): string => mkdtempSync(join(root, `t${count++}-`));
  const pkg = '{"name":"x","version":"0.7.0-rc.4","scripts":{"build":"true"}}\n';

  function setup() {
    const base = fresh();
    const origin = join(base, 'origin.git');
    const first = join(base, 'first');
    git(base, 'init', '-q', '--bare', origin);
    git(base, 'clone', '-q', origin, first);
    git(first, 'checkout', '-q', '-b', 'main');
    mkdirSync(join(first, 'scripts'));
    copyFileSync(join(import.meta.dirname, 'release.sh'), join(first, 'scripts', 'release.sh'));
    writeFileSync(join(first, 'package.json'), pkg);
    git(first, 'add', '-A');
    git(first, 'commit', '-q', '-m', 'A');
    const a = git(first, 'rev-parse', 'HEAD');
    git(first, 'push', '-q', 'origin', 'main');
    git(first, 'checkout', '-q', '-b', 'side');
    git(first, 'commit', '-q', '--amend', '-m', 'A prime');
    const aPrime = git(first, 'rev-parse', 'HEAD');
    git(first, 'push', '-q', 'origin', 'side');
    const second = join(base, 'second');
    git(base, 'clone', '-q', '-b', 'main', origin, second);
    git(second, 'commit', '-q', '--allow-empty', '-m', 'B');
    const b = git(second, 'rev-parse', 'HEAD');
    git(second, 'push', '-q', 'origin', 'main');
    const cloneAt = (sha: string): string => {
      const dirAt = join(fresh(), 'clone');
      git(base, 'clone', '-q', origin, dirAt);
      git(dirAt, 'fetch', '-q', 'origin', 'main', 'side');
      git(dirAt, 'checkout', '-q', '--detach', sha);
      return dirAt;
    };
    const tagLine = () => git(base, 'ls-remote', origin, 'refs/tags/v0.7.0-rc.4');
    return { a, b, aPrime, cloneAt, tagLine };
  }

  const release = (cwd: string, ...args: string[]) => {
    const run = spawnSync('bash', [join(cwd, 'scripts', 'release.sh'), ...args], { cwd, env, encoding: 'utf8' });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  };
  const localTag = (cwd: string) => git(cwd, 'tag', '-l', 'v0.7.0-rc.4');

  it('builds and tags the release when main has moved past the SHA', () => {
    const { a, cloneAt } = setup();
    const clone = cloneAt(a);
    const run = release(clone, '--at', a, '0.7.0-rc.4');
    expect(run.status).toBe(0);
    expect(git(clone, 'rev-parse', 'v0.7.0-rc.4^{commit}^')).toBe(a);
  });

  it('refuses when HEAD is not the SHA', () => {
    const { a, b, cloneAt } = setup();
    const clone = cloneAt(b);
    const run = release(clone, '--at', a, '0.7.0-rc.4');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/^refusing:/m);
    expect(localTag(clone)).toBe('');
  });

  it('refuses a SHA that is not on origin/main', () => {
    const { aPrime, cloneAt, tagLine } = setup();
    const clone = cloneAt(aPrime);
    const run = release(clone, '--at', aPrime, '0.7.0-rc.4');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`refusing: ${aPrime} is not on origin/main`);
    expect(localTag(clone)).toBe('');
    expect(tagLine()).toBe('');
  });

  it('exits 0 on a rerun when the tag is on origin, and leaves it alone', () => {
    const { a, cloneAt, tagLine } = setup();
    const clone = cloneAt(a);
    expect(release(clone, '--at', a, '0.7.0-rc.4').status).toBe(0);
    git(clone, 'push', '-q', 'origin', 'v0.7.0-rc.4');
    const pushed = tagLine();
    expect(pushed).not.toBe('');
    const rerun = release(cloneAt(a), '--at', a, '0.7.0-rc.4');
    expect(rerun.status).toBe(0);
    expect(tagLine()).toBe(pushed);
  });

  it('refuses when the tag on origin is not built on the SHA', () => {
    const { a, b, cloneAt, tagLine } = setup();
    const atB = cloneAt(b);
    expect(release(atB, '--at', b, '0.7.0-rc.4').status).toBe(0);
    git(atB, 'push', '-q', 'origin', 'v0.7.0-rc.4');
    const pushed = tagLine();
    const run = release(cloneAt(a), '--at', a, '0.7.0-rc.4');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`refusing: tag v0.7.0-rc.4 on origin is not built on ${a}`);
    expect(tagLine()).toBe(pushed);
  });

  it('without --at still refuses when HEAD is not origin/main', () => {
    const { a, cloneAt, tagLine } = setup();
    const clone = cloneAt(a);
    const run = release(clone, '0.7.0-rc.4');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refusing: HEAD is not origin/main');
    expect(localTag(clone)).toBe('');
    expect(tagLine()).toBe('');
  });
});
