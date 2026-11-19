import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const release = /^\d+\.\d+\.\d+$/;
export const candidate =/^\d+\.\d+\.\d+-rc\.\d+$/;

export function distTagFor(version: string): 'next' | 'latest' {
  if (typeof version === 'string') {
    if (candidate.test(version)) return 'next';
    if (release.test(version)) return 'latest';
  }
  throw new Error(`Not a release version: ${JSON.stringify(version)}. Use X.Y.Z or X.Y.Z-rc.N.`);
}

export function distTagProblem(version: string, distTags: unknown): string | undefined {
  const tag = distTagFor(version);
  if (distTags === null || typeof distTags !== 'object' || Array.isArray(distTags)) {
    return 'npm did not return a dist-tags object';
  }
  const served = (distTags as Record<string, unknown>)[tag];
  if (served === undefined) return `dist-tag ${tag} is missing`;
  if (served !== version) return `dist-tag ${tag} points at ${String(served)}, not ${version}`;
  return undefined;
}

function main(version: string | undefined): number {
  try {
    const tag = distTagFor(version ?? '');
    const run = spawnSync('npm', ['view', 'tagreeve', 'dist-tags', '--json'], { encoding: 'utf8' });
    if (run.error || run.status !== 0) {
      throw new Error(`npm view failed${run.error ? `: ${run.error.message}` : ` with exit ${run.status}`}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(run.stdout);
    } catch {
      throw new Error('npm output is not JSON');
    }
    const problem = distTagProblem(version!, parsed);
    if (problem) throw new Error(problem);
    console.log(`ok: tagreeve@${tag} is ${version}`);
    return 0;
  } catch (err) {
    console.error(`check-npm-dist-tag: ${(err as Error).message}`);
    return 1;
  }
}

// import.meta.main is missing on Node 24.0 and 24.1, which satisfy engines.node.
const isEntry = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntry) process.exit(main(process.argv[2]));
