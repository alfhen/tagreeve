import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { candidate, distTagFor, release } from './check-npm-dist-tag.ts';

export function compareVersions(a: string, b: string): number {
  const parse = (version: string): number[] => {
    if (!candidate.test(version) && !release.test(version)) throw new Error(`Not a release version: ${JSON.stringify(version)}`);
    const [core = '', rc] = version.split('-rc.');
    return [...core.split('.').map(Number), rc === undefined ? Infinity : Number(rc)];
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i]! !== right[i]!) return left[i]! < right[i]! ? -1 : 1;
  }
  return 0;
}

export interface PlanDeps {
  versionAt: (rev: string) => string | undefined;
  npmVersions: () => string[];
  remoteHasTag: (tag: string) => boolean;
}

export function plan(before: string, sha: string, deps: PlanDeps): string {
  const version = deps.versionAt(sha);
  if (version === undefined) throw new Error(`no package.json version at ${sha}`);
  const distTag = distTagFor(version);
  const old = deps.versionAt(before);
  if (old !== undefined && compareVersions(version, old) < 0) {
    throw new Error(`version ${version} is lower than ${old} at the before commit`);
  }
  if (deps.npmVersions().includes(version)) {
    return old === version ? 'skip: version unchanged' : `skip: v${version} already on npm`;
  }
  if (deps.remoteHasTag(`v${version}`)) return `skip: v${version} tag exists, rerun publish`;
  return `release ${version} ${distTag}`;
}

export interface GuardDeps {
  npmVersions: () => string[];
  npmDistTags: () => Record<string, unknown>;
  sleep: (ms: number) => Promise<void>;
}

const readTries = 5;
const waitMs = 30_000;

export async function guard(version: string, distTag: string, deps: GuardDeps): Promise<'published' | 'publish'> {
  if (distTagFor(version) !== distTag) throw new Error(`dist-tag ${distTag} does not fit version ${version}`);
  for (let i = 0; i < readTries; i++) {
    if (i > 0) await deps.sleep(waitMs);
    if (deps.npmVersions().includes(version)) return 'published';
  }
  const held = deps.npmDistTags()[distTag];
  if (held === undefined) return 'publish';
  if (held === version) return 'published';
  if (typeof held !== 'string' || compareVersions(held, version) > 0) {
    throw new Error(`dist-tag ${distTag} holds ${String(held)}, which is higher than ${version}`);
  }
  return 'publish';
}

function run(cmd: string, args: string[]): string {
  const out = spawnSync(cmd, args, { encoding: 'utf8' });
  if (out.error || out.status !== 0) {
    throw new Error(`${cmd} ${args[0]} failed${out.error ? `: ${out.error.message}` : ` with exit ${out.status}`}`);
  }
  return out.stdout;
}

function npmView(field: string): unknown {
  const out = run('npm', ['view', 'tagreeve', field, '--json']);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`npm view ${field} did not return JSON`);
  }
}

const realDeps = {
  versionAt(rev: string): string | undefined {
    if (/^0+$/.test(rev)) return undefined;
    if (rev.startsWith('-')) throw new Error(`bad revision ${rev}`);
    const pkg = JSON.parse(run('git', ['show', `${rev}:package.json`])) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  },
  npmVersions(): string[] {
    const list = npmView('versions');
    if (typeof list === 'string') return [list];
    if (!Array.isArray(list)) throw new Error('npm view versions did not return a list');
    return list.map(String);
  },
  npmDistTags(): Record<string, unknown> {
    const tags = npmView('dist-tags');
    if (tags === null || typeof tags !== 'object' || Array.isArray(tags)) throw new Error('npm did not return a dist-tags object');
    return tags as Record<string, unknown>;
  },
  remoteHasTag: (tag: string): boolean => run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]).trim() !== '',
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

async function main(args: string[]): Promise<number> {
  try {
    if (args[0] === '--guard') {
      if (args.length !== 3) throw new Error('usage: release-plan.ts --guard <version> <dist-tag>');
      console.log(await guard(args[1]!, args[2]!, realDeps));
    } else {
      if (args.length !== 2) throw new Error('usage: release-plan.ts <before> <sha>');
      console.log(plan(args[0]!, args[1]!, realDeps));
    }
    return 0;
  } catch (err) {
    console.error(`release-plan: ${(err as Error).message}`);
    return 2;
  }
}

const isEntry = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntry) process.exit(await main(process.argv.slice(2)));
