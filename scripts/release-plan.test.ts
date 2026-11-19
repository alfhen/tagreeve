import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compareVersions, guard, plan, type GuardDeps, type PlanDeps } from './release-plan.ts';

describe('compareVersions', () => {
  it.each([
    ['0.7.0-rc.10', '0.7.0-rc.9', 1],
    ['0.7.0-rc.9', '0.7.0-rc.10', -1],
    ['0.7.0', '0.7.0-rc.4', 1],
    ['0.7.0-rc.4', '0.7.0', -1],
    ['0.10.0', '0.9.9', 1],
    ['1.0.0-rc.1', '0.99.9', 1],
    ['0.7.0-rc.3', '0.7.0-rc.3', 0],
  ])('%s against %s is %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it('refuses a version that is not X.Y.Z or X.Y.Z-rc.N', () => {
    expect(() => compareVersions('0.7.0-beta.1', '0.7.0')).toThrow(/Not a release version/);
  });
});

function deps(over: { before: string; sha: string; onNpm?: string[]; tags?: string[] }): PlanDeps {
  return {
    versionAt: (rev) => (rev === 'before' ? over.before : over.sha),
    npmVersions: () => over.onNpm ?? [],
    remoteHasTag: (tag) => (over.tags ?? []).includes(tag),
  };
}

describe('plan', () => {
  it.each([
    ['0.7.0-rc.3', '0.7.0-rc.4', [], [], 'release 0.7.0-rc.4 next'],
    ['0.7.0-rc.3', '0.7.0', [], [], 'release 0.7.0 latest'],
    ['0.7.0-rc.9', '0.7.0-rc.10', [], [], 'release 0.7.0-rc.10 next'],
    ['0.7.0-rc.3', '0.7.0-rc.3', ['0.7.0-rc.3'], [], 'skip: version unchanged'],
    ['0.7.0-rc.3', '0.7.0-rc.3', [], [], 'release 0.7.0-rc.3 next'],
    ['0.7.0-rc.3', '0.7.0-rc.3', [], ['v0.7.0-rc.3'], 'skip: v0.7.0-rc.3 tag exists, rerun publish'],
    ['0.7.0-rc.3', '0.7.0-rc.4', [], ['v0.7.0-rc.4'], 'skip: v0.7.0-rc.4 tag exists, rerun publish'],
    ['0.7.0-rc.3', '0.7.0-rc.4', ['0.7.0-rc.4'], [], 'skip: v0.7.0-rc.4 already on npm'],
    ['0.7.0-rc.3', '0.7.0-rc.4', ['0.7.0-rc.4'], ['v0.7.0-rc.4'], 'skip: v0.7.0-rc.4 already on npm'],
  ])('%s to %s gives %s', (before, sha, onNpm, tags, line) => {
    expect(plan('before', 'sha', deps({ before, sha, onNpm, tags }))).toBe(line);
  });

  it.each([
    ['0.7.0-rc.3', '0.7.0-beta.1'],
    ['0.7.0-rc.4', '0.7.0-rc.3'],
    ['0.7.0-rc.10', '0.7.0-rc.9'],
    ['0.7.0', '0.7.0-rc.4'],
  ])('refuses %s to %s', (before, sha) => {
    expect(() => plan('before', 'sha', deps({ before, sha }))).toThrow();
  });

  it('lets a failed npm read stop the plan', () => {
    const failing = { ...deps({ before: '0.7.0-rc.3', sha: '0.7.0-rc.4' }), npmVersions: () => { throw new Error('npm failed'); } };
    expect(() => plan('before', 'sha', failing)).toThrow('npm failed');
  });
});

function guardDeps(listings: string[][], tags: Record<string, unknown> = {}) {
  const calls = { reads: 0, waits: [] as number[] };
  const stub: GuardDeps = {
    npmVersions: () => listings[Math.min(calls.reads++, listings.length - 1)]!,
    npmDistTags: () => tags,
    sleep: async (ms) => {
      calls.waits.push(ms);
    },
  };
  return { calls, stub };
}

describe('guard', () => {
  const rc4 = '0.7.0-rc.4';

  it('stops when the dist-tag holds a higher version', async () => {
    const { stub } = guardDeps([['0.7.0-rc.5']], { next: '0.7.0-rc.5' });
    await expect(guard(rc4, 'next', stub)).rejects.toThrow(/higher/);
  });

  it('prints published when the version is on npm, also under a higher dist-tag', async () => {
    const { stub } = guardDeps([[rc4, '0.7.0-rc.5']], { next: '0.7.0-rc.5' });
    await expect(guard(rc4, 'next', stub)).resolves.toBe('published');
  });

  it('prints published when the dist-tag names the version although the version reads miss it', async () => {
    await expect(guard(rc4, 'next', guardDeps([[]], { next: rc4 }).stub)).resolves.toBe('published');
  });

  it('prints publish when the dist-tag does not exist or holds a lower version', async () => {
    await expect(guard(rc4, 'next', guardDeps([[]], { latest: '0.6.2' }).stub)).resolves.toBe('publish');
    await expect(guard(rc4, 'next', guardDeps([[]], { next: '0.7.0-rc.3' }).stub)).resolves.toBe('publish');
  });

  it('reads again until the version shows up', async () => {
    const { calls, stub } = guardDeps([[], [], [rc4]]);
    await expect(guard(rc4, 'next', stub)).resolves.toBe('published');
    expect(calls.reads).toBe(3);
    expect(calls.waits).toEqual([30_000, 30_000]);
  });

  it('reads 5 times 30 s apart before it decides the version is missing', async () => {
    const { calls, stub } = guardDeps([[]]);
    await expect(guard(rc4, 'next', stub)).resolves.toBe('publish');
    expect(calls.reads).toBe(5);
    expect(calls.waits).toEqual([30_000, 30_000, 30_000, 30_000]);
  });

  it('lets a failed read stop it', async () => {
    const stub: GuardDeps = { npmVersions: () => { throw new Error('npm failed'); }, npmDistTags: () => ({}), sleep: async () => {} };
    await expect(guard(rc4, 'next', stub)).rejects.toThrow('npm failed');
  });

  it('refuses a dist-tag that does not fit the version', async () => {
    await expect(guard(rc4, 'latest', guardDeps([[]]).stub)).rejects.toThrow();
  });
});

describe('release-plan.ts in a temp repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-plan-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const identity = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' };
  const git = (cwd: string, ...args: string[]): string => {
    const run = spawnSync('git', args, { cwd, env: { ...process.env, ...identity }, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
  };
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  const bin = join(dir, 'bin');
  git(dir, 'init', '-q', '--bare', origin);
  git(dir, 'init', '-q', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', origin);
  mkdirSync(join(work, 'scripts'));
  for (const file of ['release-plan.ts', 'check-npm-dist-tag.ts']) copyFileSync(join(import.meta.dirname, file), join(work, 'scripts', file));
  const commit = (message: string, version?: string): string => {
    if (version) writeFileSync(join(work, 'package.json'), `${JSON.stringify({ name: 'x', version })}\n`);
    else writeFileSync(join(work, 'README.md'), `${message}\n`);
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', message);
    return git(work, 'rev-parse', 'HEAD');
  };
  const one = commit('one', '0.7.0-rc.3');
  const two = commit('two', '0.7.0-rc.4');
  const three = commit('three');
  git(work, 'push', '-q', 'origin', 'main');

  mkdirSync(bin);
  writeFileSync(
    join(bin, 'npm'),
    '#!/bin/sh\n[ -n "$STUB_EXIT" ] && exit "$STUB_EXIT"\ncase "$*" in\n  *versions*) echo "$STUB_VERSIONS" ;;\n  *dist-tags*) echo "$STUB_TAGS" ;;\nesac\n',
  );
  chmodSync(join(bin, 'npm'), 0o755);

  const run = (args: string[], stub: Record<string, string>) => {
    const out = spawnSync(process.execPath, ['scripts/release-plan.ts', ...args], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, ...identity, PATH: `${bin}:${process.env.PATH}`, ...stub },
    });
    return { status: out.status, stdout: out.stdout, stderr: out.stderr };
  };

  it('plans a release when the bump is not in the last commit', () => {
    expect(run([one, three], { STUB_VERSIONS: '["0.7.0-rc.3"]' })).toMatchObject({ status: 0, stdout: 'release 0.7.0-rc.4 next\n' });
  });

  it('compares the whole push, not only the last commit', () => {
    const versions = { STUB_VERSIONS: '["0.7.0-rc.3","0.7.0-rc.4"]' };
    expect(run([one, three], versions)).toMatchObject({ status: 0, stdout: 'skip: v0.7.0-rc.4 already on npm\n' });
    expect(run([two, three], versions)).toMatchObject({ status: 0, stdout: 'skip: version unchanged\n' });
  });

  it('plans a rerun of an unchanged version that is not on npm', () => {
    expect(run([two, three], { STUB_VERSIONS: '["0.7.0-rc.3"]' })).toMatchObject({ status: 0, stdout: 'release 0.7.0-rc.4 next\n' });
  });

  it('refuses a lower version and a failed npm read', () => {
    const lower = run([three, one], { STUB_VERSIONS: '[]' });
    expect(lower.status).toBe(2);
    expect(lower.stdout).toBe('');
    expect(lower.stderr).not.toBe('');
    const failed = run([one, three], { STUB_EXIT: '1' });
    expect(failed.status).toBe(2);
    expect(failed.stdout).not.toContain('release');
    expect(failed.stderr).not.toBe('');
  });

  it('prints the guard answers', () => {
    const tags = JSON.stringify({ latest: '0.6.2', next: '0.7.0-rc.5' });
    expect(run(['--guard', '0.7.0-rc.4', 'next'], { STUB_VERSIONS: '["0.6.2","0.7.0-rc.4","0.7.0-rc.5"]', STUB_TAGS: tags })).toMatchObject({ status: 0, stdout: 'published\n' });
    expect(run(['--guard', '0.7.0-rc.4', 'next'], { STUB_EXIT: '1' })).toMatchObject({ status: 2, stdout: '' });
  });

  it('prints the tag-exists line when the tag is on the remote', () => {
    git(work, 'tag', '-a', '-m', 'Release v0.7.0-rc.4', 'v0.7.0-rc.4', two);
    git(work, 'push', '-q', 'origin', 'v0.7.0-rc.4');
    expect(run([one, three], { STUB_VERSIONS: '["0.7.0-rc.3"]' })).toMatchObject({ status: 0, stdout: 'skip: v0.7.0-rc.4 tag exists, rerun publish\n' });
  });
});
