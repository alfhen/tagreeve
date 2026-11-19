import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Action {
  runs?: { using?: string; steps?: { run?: string; uses?: string }[] };
}

interface Workflow {
  on: { push: { tags: string[] }; workflow_call?: { inputs?: Record<string, unknown> } };
  permissions?: Record<string, string> | string;
  jobs: Record<string, { permissions?: Record<string, string> | string; secrets?: unknown; uses?: string; steps?: { run?: string; uses?: string }[] }>;
}

const path = new URL('../.github/workflows/release-tag.yml', import.meta.url);
const text = readFileSync(path, 'utf8');
const workflow = parse(text) as Workflow;

const runLinesOf = (wf: Pick<Workflow, 'jobs'>): string[] =>
  Object.values(wf.jobs)
    .flatMap((job) => job.steps ?? [])
    .flatMap((step) => (step.run ?? '').replace(/\\\r?\n/g, '').split(/\n|&&|\|\||;|\|/));

const runLines = runLinesOf(workflow);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const readRepoFile = (rel: string): string | undefined => {
  try {
    return readFileSync(`${repoRoot}${rel}`, 'utf8');
  } catch {
    return undefined;
  }
};

const localWorkflow = /^\.\/\.github\/workflows\/[\w.-]+\.ya?ml$/;

const isReadOnly = (permissions: Record<string, string> | string | undefined): boolean =>
  permissions === undefined ||
  permissions === 'read-all' ||
  (typeof permissions === 'object' && Object.values(permissions).every((level) => level !== 'write'));

const localActionDir = /^\.\/(?:[\w.-]+\/)*[\w.-]*$/;

function readLocalAction(uses: string, readLocal: (rel: string) => string | undefined): string | undefined {
  if (!localActionDir.test(uses) || uses.split('/').includes('..')) return undefined;
  const dir = uses.slice(2).replace(/\/$/, '');
  const prefix = dir ? `${dir}/` : '';
  return readLocal(`${prefix}action.yml`) ?? readLocal(`${prefix}action.yaml`);
}

export function workflowProblems(source: string, readLocal: (rel: string) => string | undefined = readRepoFile, depth = 0): string[] {
  return problemsOf(parse(source) as Workflow, source, readLocal, depth);
}

function problemsOf(wf: Pick<Workflow, 'permissions' | 'jobs'>, source: string, readLocal: (rel: string) => string | undefined, depth: number): string[] {
  const problems: string[] = [];
  if (!isReadOnly(wf.permissions)) problems.push('top-level permissions are not read-only');
  for (const [name, job] of Object.entries(wf.jobs)) {
    if (!isReadOnly(job.permissions)) problems.push(`job ${name} permissions are not read-only`);
    if ('secrets' in job) problems.push(`job ${name} passes secrets`);
    const uses = [job.uses, ...(job.steps ?? []).map((step) => step.uses)];
    for (const use of uses) {
      if (use && /publish|release/i.test(use)) problems.push(`uses ${use}`);
    }
    if (job.uses?.startsWith('./')) {
      const nested = localWorkflow.test(job.uses) && depth < 5 ? readLocal(job.uses.slice(2)) : undefined;
      if (nested === undefined) problems.push(`cannot check local workflow ${job.uses}`);
      else problems.push(...workflowProblems(nested, readLocal, depth + 1).map((problem) => `${job.uses}: ${problem}`));
    }
    for (const step of job.steps ?? []) {
      if (!step.uses?.startsWith('./')) continue;
      const text = depth < 5 ? readLocalAction(step.uses, readLocal) : undefined;
      if (text === undefined) {
        problems.push(`cannot check local action ${step.uses}`);
        continue;
      }
      const runs = (parse(text) as Action | null)?.runs;
      if (runs?.using !== 'composite') {
        problems.push(`cannot check local action ${step.uses}`);
        continue;
      }
      const steps = runs.steps ?? [];
      const nested = problemsOf({ jobs: { action: { steps } } }, text, readLocal, depth + 1);
      problems.push(...nested.map((problem) => `${step.uses}: ${problem}`));
    }
  }
  if (/secrets\./i.test(source)) problems.push('secrets context');
  if (/NODE_AUTH_TOKEN|NPM_TOKEN|GH_TOKEN|GITHUB_TOKEN/.test(source)) problems.push('token name');
  if (/github\.token/i.test(source)) problems.push('github.token');
  const lines = runLinesOf(wf);
  const publishes = lines.filter((line) => /\b(npm|pnpm|yarn)\b.*\bpublish\b/.test(line));
  for (const line of publishes) {
    if (!line.includes('--dry-run')) problems.push(`publish without --dry-run: ${line.trim()}`);
    if (!line.includes('--tag "$dist_tag"')) problems.push(`publish without --tag "$dist_tag": ${line.trim()}`);
  }
  for (const line of lines) {
    if (/gh\s+release/.test(line)) problems.push(`gh release: ${line.trim()}`);
    if (/docker\s+(push|login)\b/.test(line) || (/\bbuild\b/.test(line) && /--push\b/.test(line))) {
      problems.push(`docker publish: ${line.trim()}`);
    }
  }
  return problems;
}

const base = (extra: string, perms = 'permissions:\n  contents: read\n') =>
  `name: x\non:\n  push:\n    tags: ['v*']\n${perms}jobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n${extra}`;

describe('release-tag workflow', () => {
  it('runs on pushed v tags only', () => {
    expect(workflow.on.push.tags).toEqual(['v*']);
    expect(Object.keys(workflow.on)).toEqual(['push', 'workflow_call']);
  });

  it('has read-only permissions and no id-token', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(text).not.toMatch(/id-token/);
  });

  it('holds no secrets', () => {
    expect(text).not.toMatch(/secrets\./i);
    expect(text).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|GH_TOKEN|GITHUB_TOKEN/);
  });

  it('never creates a GitHub release', () => {
    expect(runLines.filter((line) => /gh\s+release/.test(line))).toEqual([]);
    expect(text).not.toMatch(/action-gh-release|create-release/);
  });

  it('only runs npm publish as a dry run', () => {
    const publishes = runLines.filter((line) => /(npm|pnpm|yarn)\s+publish/.test(line));
    expect(publishes.length).toBeGreaterThan(0);
    for (const line of publishes) expect(line).toContain('--dry-run');
  });

  it('chooses next for release candidates and latest otherwise', () => {
    expect(text).toMatch(/v\*-rc\.\*\) dist_tag=next/);
    expect(text).toMatch(/\*\) dist_tag=latest/);
  });

  it('passes every rule', () => {
    expect(workflowProblems(text)).toEqual([]);
  });
});

describe('workflow rules', () => {
  const good = '      - run: npm publish --dry-run --tag "$dist_tag"\n';

  it('accepts a clean workflow', () => {
    expect(workflowProblems(base(good))).toEqual([]);
  });

  it('fails a job with write permissions', () => {
    const wf = `${base(good)}  b:\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: write\n    steps:\n${good}`;
    expect(workflowProblems(wf)).toEqual(['job b permissions are not read-only']);
  });

  it('fails write-all on a job', () => {
    const wf = `${base(good)}  b:\n    runs-on: ubuntu-24.04\n    permissions: write-all\n    steps:\n${good}`;
    expect(workflowProblems(wf)).toHaveLength(1);
  });

  it('fails write permissions at the top level', () => {
    expect(workflowProblems(base(good, 'permissions:\n  contents: write\n'))).toEqual(['top-level permissions are not read-only']);
  });

  it.each(['npm', 'pnpm', 'yarn'])('fails %s publish without --dry-run', (tool) => {
    const problems = workflowProblems(base(`      - run: ${tool} publish --tag "$dist_tag"\n`));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('without --dry-run');
  });

  it('fails a publish after other words on the line', () => {
    expect(workflowProblems(base('      - run: cd x && pnpm -r publish --tag "$dist_tag"\n'))).toHaveLength(1);
  });

  it('fails a uses value that publishes or releases', () => {
    expect(workflowProblems(base(`${good}      - uses: softprops/action-gh-release@v2\n`))).toEqual(['uses softprops/action-gh-release@v2']);
    expect(workflowProblems(base(`${good}      - uses: JS-DevTools/npm-publish@v3\n`))).toEqual(['uses JS-DevTools/npm-publish@v3']);
  });

  it('accepts read-all at the top level and on a job', () => {
    expect(workflowProblems(base(good, 'permissions: read-all\n'))).toEqual([]);
    const wf = `${base(good)}  b:\n    runs-on: ubuntu-24.04\n    permissions: read-all\n    steps:\n${good}`;
    expect(workflowProblems(wf)).toEqual([]);
  });

  it('fails write-all at the top level', () => {
    expect(workflowProblems(base(good, 'permissions: write-all\n'))).toEqual(['top-level permissions are not read-only']);
  });

  it('checks a local reusable workflow', () => {
    const wf = `${base(good)}  b:\n    uses: ./.github/workflows/build.yml\n`;
    const read = (rel: string) => (rel === '.github/workflows/build.yml' ? base(good) : undefined);
    expect(workflowProblems(wf, read)).toEqual([]);
    const bad = (): string => base('      - run: npm publish --tag "$dist_tag"\n');
    expect(workflowProblems(wf, bad)).toEqual(['./.github/workflows/build.yml: publish without --dry-run: npm publish --tag "$dist_tag"']);
  });

  it('refuses a local workflow it cannot read or that is not under .github/workflows', () => {
    const missing = `${base(good)}  b:\n    uses: ./.github/workflows/gone.yml\n`;
    expect(workflowProblems(missing, () => undefined)).toEqual(['cannot check local workflow ./.github/workflows/gone.yml']);
    const elsewhere = `${base(good)}  b:\n    uses: ./other/build.yml\n`;
    expect(workflowProblems(elsewhere, () => base(good))).toEqual(['cannot check local workflow ./other/build.yml']);
  });

  it('stops a local workflow that calls itself', () => {
    const self = `${base(good)}  b:\n    uses: ./.github/workflows/loop.yml\n`;
    expect(workflowProblems(self, () => self).length).toBeGreaterThan(0);
  });

  it('fails a job-level secrets key, including inherit', () => {
    const own = `${base(good)}  b:\n    uses: org/repo/.github/workflows/build.yml@v1\n    secrets:\n      T: x\n`;
    expect(workflowProblems(own)).toEqual(['job b passes secrets']);
    const inherit = `${base(good)}  b:\n    uses: org/repo/.github/workflows/build.yml@v1\n    secrets: inherit\n`;
    expect(workflowProblems(inherit)).toEqual(['job b passes secrets']);
  });

  it.each([
    'x="a #b" npm publish --tag "$dist_tag"',
    'docker build --label "desc=build #42" --push .',
    "npm --registry 'https://r.example/?a=1&b=2' publish --tag \"$dist_tag\"",
  ])('still reports %s', (line) => {
    expect(workflowProblems(base(`${good}      - run: |\n          ${line}\n`)).length).toBeGreaterThan(0);
  });

  it('checks the uses of a reusable-workflow job', () => {
    const wf = `${base(good)}  b:\n    uses: org/repo/.github/workflows/publish.yml@v1\n`;
    expect(workflowProblems(wf)).toEqual(['uses org/repo/.github/workflows/publish.yml@v1']);
  });

  it('joins backslash continuations before checking a publish', () => {
    const wf = base('      - run: |\n          npm publish \\\n            --tag "$dist_tag"\n');
    const problems = workflowProblems(wf);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('without --dry-run');
  });

  it('accepts a continued publish that has the flags', () => {
    const wf = base('      - run: |\n          npm publish \\\n            --dry-run \\\n            --tag "$dist_tag"\n');
    expect(workflowProblems(wf)).toEqual([]);
  });

  it('does not join a command after a blank line to a trailing backslash', () => {
    const wf = base('      - run: |\n          npm publish --tag "$dist_tag" \\\n\n          echo --dry-run\n');
    const problems = workflowProblems(wf);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('without --dry-run');
  });

  it('does not take --dry-run from a later command joined by a continuation', () => {
    const wf = base('      - run: |\n          npm publish --tag "$dist_tag" \\\n            && echo --dry-run\n');
    const problems = workflowProblems(wf);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('without --dry-run');
  });

  it('keeps a token split by a continuation whole', () => {
    const wf = base(`${good}      - run: |\n          docker pu\\\n          sh ghcr.io/x/y\n`);
    expect(workflowProblems(wf)).toHaveLength(1);
  });

  it('fails github.token', () => {
    expect(workflowProblems(base(`${good}      - run: echo \${{ github.token }}\n`))).toEqual(['github.token']);
  });

  it('fails a publish line without the dist tag', () => {
    const problems = workflowProblems(base('      - run: npm publish --dry-run\n'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('--tag "$dist_tag"');
  });

  it.each(['docker push ghcr.io/x/y', 'docker login ghcr.io', 'docker buildx build --push .', 'docker build --push .'])('fails %s', (line) => {
    const problems = workflowProblems(base(`${good}      - run: ${line}\n`));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('docker publish');
  });

  it('lets a plain docker build through', () => {
    expect(workflowProblems(base(`${good}      - run: docker build -t x .\n`))).toEqual([]);
  });

  it('opens a step-level local action and refuses a publish in it', () => {
    const wf = base(`${good}      - uses: ./.github/actions/ship\n`);
    const action = (steps: string) => `name: ship\nruns:\n  using: composite\n  steps:\n${steps}`;
    const bad = action('    - run: npm publish --tag "$dist_tag"\n      shell: bash\n');
    expect(workflowProblems(wf, (rel) => (rel === '.github/actions/ship/action.yml' ? bad : undefined))).toEqual([
      './.github/actions/ship: publish without --dry-run: npm publish --tag "$dist_tag"',
    ]);
    const clean = action('    - run: echo hi\n      shell: bash\n');
    expect(workflowProblems(wf, (rel) => (rel === '.github/actions/ship/action.yaml' ? clean : undefined))).toEqual([]);
    expect(workflowProblems(wf, () => undefined)).toEqual(['cannot check local action ./.github/actions/ship']);
    const node = 'name: ship\nruns:\n  using: node20\n  main: index.js\n';
    expect(workflowProblems(wf, () => node)).toEqual(['cannot check local action ./.github/actions/ship']);
    expect(workflowProblems(base(`${good}      - uses: ./../x\n`), () => clean)).toEqual(['cannot check local action ./../x']);
  });

  it('refuses a nested workflow or action that names a token or secret', () => {
    const wf = `${base(good)}  b:\n    uses: ./.github/workflows/build.yml\n`;
    const named = base(`${good}      - run: echo "$NPM_TOKEN"\n`);
    expect(workflowProblems(wf, () => named)).toEqual(['./.github/workflows/build.yml: token name']);
    const ctx = base(`${good}      - run: echo \${{ secrets.X }}\n`);
    expect(workflowProblems(wf, () => ctx)).toEqual(['./.github/workflows/build.yml: secrets context']);
    const step = base(`${good}      - uses: ./a\n`);
    expect(workflowProblems(step, () => 'runs:\n  using: composite\n  steps:\n    - run: echo $GH_TOKEN\n')).toEqual(['./a: token name']);
  });

  it('fails gh release in a nested workflow', () => {
    const nested = base(`${good}      - run: gh release create v1\n`);
    const wf = base('', 'permissions:\n  contents: read\n').replace('jobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n', 'jobs:\n  a:\n    uses: ./.github/workflows/build.yml\n');
    expect(workflowProblems(wf, () => nested)).toEqual(['./.github/workflows/build.yml: gh release: gh release create v1']);
  });

  it('still finds gh release behind a quoted #', () => {
    const wf = parse(base('      - run: |\n          NOTE="a #1" gh release create v1\n')) as Workflow;
    expect(runLinesOf(wf).filter((line) => /gh\s+release/.test(line))).not.toEqual([]);
  });
});

describe('release-tag workflow as a called workflow', () => {
  const steps = workflow.jobs['check-tag']!.steps as { run?: string; if?: string }[];
  const peel = steps.find((step) => step.run?.includes('refs/tags/$tag:refs/tags/$tag'));

  it('takes its tag and commit from the inputs or from the push', () => {
    expect(Object.keys(workflow.on.workflow_call?.inputs ?? {})).toEqual(['ref', 'sha']);
    expect(text).not.toMatch(/GITHUB_REF_NAME/);
    expect(text).toMatch(/ref: \$\{\{ inputs\.sha \|\| github\.sha \}\}/);
    expect(text.match(/inputs\.ref \|\| github\.ref_name/g)).toHaveLength(1);
    expect(text).toMatch(/env:\n\s+tag: \$\{\{ inputs\.ref \|\| github\.ref_name \}\}/);
    expect(text).toContain('test "$tag" = "v$version"');
    expect(text).toContain('case "$tag" in');
  });

  it('runs the peel step for a pushed tag too', () => {
    expect(peel).toBeDefined();
    expect(peel).not.toHaveProperty('if');
  });

  describe('peel step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-peel-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' };
    const git = (cwd: string, ...args: string[]): string => {
      const run = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
      return run.stdout.trim();
    };
    const origin = join(dir, 'origin.git');
    const seed = join(dir, 'seed');
    git(dir, 'init', '-q', '--bare', origin);
    git(dir, 'init', '-q', seed);
    git(seed, 'commit', '-q', '--allow-empty', '-m', 'one');
    const one = git(seed, 'rev-parse', 'HEAD');
    git(seed, 'commit', '-q', '--allow-empty', '-m', 'two');
    const two = git(seed, 'rev-parse', 'HEAD');
    git(seed, 'tag', '-a', '-m', 'on one', 'v0.0.1', one);
    git(seed, 'tag', '-a', '-m', 'on two', 'v0.0.2', two);
    git(seed, 'push', '-q', origin, 'HEAD:refs/heads/main', 'v0.0.1', 'v0.0.2');

    const runPeel = (tag: string, sha: string, n: number): number | null => {
      const clone = join(dir, `clone${n}`);
      git(dir, 'init', '-q', clone);
      git(clone, 'remote', 'add', 'origin', `file://${origin}`);
      git(clone, 'fetch', '-q', '--depth=1', 'origin', sha);
      git(clone, 'checkout', '-q', '--detach', 'FETCH_HEAD');
      return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', peel!.run!], { cwd: clone, env: { ...env, tag }, encoding: 'utf8' }).status;
    };

    it('passes when the tag peels to the checked-out commit', () => {
      expect(runPeel('v0.0.2', two, 1)).toBe(0);
    });

    it('fails when the tag points at another commit', () => {
      expect(runPeel('v0.0.1', two, 2)).not.toBe(0);
    });

    it('fails when the tag is not on the remote', () => {
      expect(runPeel('v0.0.3', two, 3)).not.toBe(0);
    });
  });
});

interface ReleaseStep {
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}

interface ReleaseJob {
  needs?: string | string[];
  if?: string;
  environment?: string | { name?: string };
  permissions?: Record<string, string> | string;
  secrets?: unknown;
  uses?: string;
  env?: Record<string, string>;
  steps?: ReleaseStep[];
}

interface ReleaseWorkflow {
  on: Record<string, { branches?: string[]; paths?: string[]; tags?: unknown } | undefined>;
  permissions?: Record<string, string> | string;
  concurrency?: unknown;
  jobs: Record<string, ReleaseJob>;
}

const botName = 'github-actions[bot]';
const botEmail = '41898282+github-actions[bot]@users.noreply.github.com';
const minNpm = [11, 21, 0];
const statusFunction = /\b(always|cancelled|failure|success)\s*\(/;
const checkCall = './.github/workflows/release-tag.yml';

const sameList = (value: unknown, expected: string[]): boolean => Array.isArray(value) && value.length === expected.length && expected.every((item, i) => value[i] === item);

const needsOf = (job: ReleaseJob): string[] => (Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : []);

export function releaseProblems(source: string, readLocal: (rel: string) => string | undefined = readRepoFile): string[] {
  const wf = parse(source) as ReleaseWorkflow;
  const problems: string[] = [];
  const on = wf.on ?? {};
  if (!sameList(Object.keys(on), ['push'])) problems.push(`triggers are ${Object.keys(on).join(', ')}, not push only`);
  const push = on.push ?? {};
  if (!sameList(push.branches, ['main'])) problems.push('push branches are not [main]');
  if (!sameList(push.paths, ['package.json'])) problems.push('push paths are not [package.json]');
  if ('tags' in push) problems.push('push has tags');
  const group = wf.concurrency as { group?: string; 'cancel-in-progress'?: boolean } | undefined;
  if (group?.group !== 'release' || group['cancel-in-progress'] !== false) problems.push('concurrency is not release without cancel');

  const writes = (permissions: ReleaseJob['permissions']): boolean =>
    permissions === 'write-all' || (typeof permissions === 'object' && Object.values(permissions).includes('write'));
  if (writes(wf.permissions)) problems.push('top-level permissions have write');

  for (const [name, job] of Object.entries(wf.jobs)) {
    if (job.permissions === 'write-all') problems.push(`job ${name} has write-all`);
    if (typeof job.permissions === 'object') {
      for (const [key, level] of Object.entries(job.permissions)) {
        const allowed = (name === 'tag' && key === 'contents') || (name === 'publish' && key === 'id-token');
        if (level === 'write' && !allowed) problems.push(`job ${name} has ${key}: write`);
      }
    }
    if ('secrets' in job) problems.push(`job ${name} passes secrets`);
    const calls = [job.uses, ...(job.steps ?? []).map((step) => step.uses)];
    for (const use of calls) {
      if (!use) continue;
      const exempt = name === 'check' && use === checkCall;
      if (/publish|release/i.test(use) && !exempt) problems.push(`uses ${use}`);
      if (!use.startsWith('./') && !/@[0-9a-f]{40}$/.test(use)) problems.push(`uses ${use} is not pinned by commit SHA`);
    }
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith('./')) problems.push(`local action ${step.uses}`);
    }
    if (job.uses === checkCall && name === 'check') {
      const nested = readLocal(checkCall.slice(2));
      if (nested === undefined) problems.push(`cannot check local workflow ${checkCall}`);
      else problems.push(...workflowProblems(nested, readLocal, 1).map((problem) => `${checkCall}: ${problem}`));
    } else if (job.uses?.startsWith('./') && !/publish|release/i.test(job.uses)) {
      problems.push(`local workflow ${job.uses} is not the check call`);
    }
  }

  if (/secrets\./i.test(source)) problems.push('secrets context');
  if (/NODE_AUTH_TOKEN|NPM_TOKEN|GH_TOKEN|GITHUB_TOKEN/.test(source)) problems.push('token name');
  if (/github\.token/i.test(source)) problems.push('github.token');
  if (/_authToken|registry-url|\.npmrc/.test(source)) problems.push('npm auth setup');
  for (const [name, job] of Object.entries(wf.jobs)) {
    for (const line of runLinesOf({ jobs: { [name]: job } })) {
      if (/\b(npm|pnpm|yarn)\b.*\bpublish\b/.test(line)) {
        if (!line.includes('--tag')) problems.push(`publish without --tag: ${line.trim()}`);
        if (!line.includes('--dry-run') && name !== 'publish') problems.push(`publish outside the publish job: ${line.trim()}`);
      }
      if (/\bnpm\s+stage\b/.test(line)) problems.push(`npm stage: ${line.trim()}`);
      if (/gh\s+release/.test(line)) problems.push(`gh release: ${line.trim()}`);
      if (/docker\s+(push|login)\b/.test(line)) problems.push(`docker publish: ${line.trim()}`);
    }
  }

  const tag = wf.jobs.tag;
  if (!tag) problems.push('no tag job');
  else {
    const envs = [tag.env, ...(tag.steps ?? []).map((step) => step.env)].map((env) => env ?? {});
    for (const [key, value] of [
      ['GIT_AUTHOR_NAME', botName],
      ['GIT_COMMITTER_NAME', botName],
      ['GIT_AUTHOR_EMAIL', botEmail],
      ['GIT_COMMITTER_EMAIL', botEmail],
    ] as const) {
      const values = envs.map((env) => env[key]).filter((item) => item !== undefined);
      if (values.length === 0 || values.some((item) => item !== value)) problems.push(`tag job ${key} is not ${value}`);
    }
  }
  for (const match of source.matchAll(/GIT_(?:AUTHOR|COMMITTER)_EMAIL:\s*(\S+)/g)) {
    if (match[1] !== botEmail) problems.push(`bot email ${match[1]}`);
  }

  const publish = wf.jobs.publish;
  if (!publish) {
    problems.push('no publish job');
    return problems;
  }
  const environment = typeof publish.environment === 'object' ? publish.environment.name : publish.environment;
  if (environment !== 'npm') problems.push('publish does not use environment npm');
  for (const need of ['tag', 'check']) {
    if (!needsOf(publish).includes(need)) problems.push(`publish does not need ${need}`);
  }
  for (const condition of [publish.if, ...(publish.steps ?? []).map((step) => step.if)]) {
    if (condition !== undefined && statusFunction.test(String(condition))) problems.push(`status function in if: ${String(condition)}`);
  }

  const lines = runLinesOf({ jobs: { publish } }).map((line) => line.trim());
  const install = lines.findIndex((line) => /^npm install -g npm@\S+$/.test(line));
  const check = lines.findIndex((line) => /\bnpm --version\b/.test(line));
  const publishing = lines.findIndex((line) => /^npm publish\b/.test(line));
  const pinned = install < 0 ? undefined : /^npm install -g npm@(\d+)\.(\d+)\.(\d+)$/.exec(lines[install]!);
  if (!pinned) problems.push('publish does not install an exact npm version');
  else {
    const have = pinned.slice(1).map(Number);
    const differs = have.findIndex((part, i) => part !== minNpm[i]);
    if (differs >= 0 && have[differs]! < minNpm[differs]!) problems.push(`npm ${pinned.slice(1).join('.')} is older than ${minNpm.join('.')}`);
  }
  if (check < 0 || !(publish.steps ?? []).some((step) => step.run?.includes('npm --version') && step.run.includes(minNpm.join('.')))) {
    problems.push(`publish does not check npm --version against ${minNpm.join('.')}`);
  }
  if (publishing < 0) problems.push('publish has no npm publish');
  if (install >= 0 && check >= 0 && install > check) problems.push('npm is installed after the version check');
  if (check >= 0 && publishing >= 0 && check > publishing) problems.push('npm publish runs before the version check');

  const steps = publish.steps ?? [];
  const guardAt = steps.findIndex((step) => step.run?.includes('release-plan.ts --guard'));
  const publishAt = steps.findIndex((step) => /^\s*npm publish\b/m.test(step.run ?? ''));
  if (guardAt < 0 || !steps[guardAt]!.id) problems.push('publish has no release-plan.ts --guard step with an id');
  else if (publishAt >= 0 && guardAt > publishAt) problems.push('the guard runs after npm publish');
  else if (publishAt >= 0 && !String(steps[publishAt]!.if ?? '').includes(`steps.${steps[guardAt]!.id}.outputs`)) {
    problems.push('the npm publish step does not depend on the guard output');
  }
  return problems;
}

describe('release workflow', () => {
  const releaseText = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const release = parse(releaseText) as ReleaseWorkflow;

  it('passes every rule', () => {
    expect(releaseProblems(releaseText)).toEqual([]);
  });

  it('runs only on a push to main that changes package.json', () => {
    expect(Object.keys(release.on)).toEqual(['push']);
    expect(release.on.push).toEqual({ branches: ['main'], paths: ['package.json'] });
  });

  it('gives only tag contents: write and only publish id-token: write', () => {
    expect(Object.entries(release.jobs).map(([name, job]) => [name, job.permissions])).toEqual([
      ['plan', { contents: 'read' }],
      ['tag', { contents: 'write' }],
      ['check', { contents: 'read' }],
      ['publish', { 'id-token': 'write', contents: 'read' }],
      ['verify', { contents: 'read' }],
    ]);
    expect(releaseText.match(/id-token/g)).toHaveLength(1);
  });

  const pushTag = '      - name: Push the tag\n';
  const installStep = '      - name: Install the pinned npm\n        run: npm install -g npm@11.21.2\n';
  const guardIf = "        if: steps.guard.outputs.result == 'publish'\n";
  const topPermissions = 'permissions:\n  contents: read\n\njobs:';
  const edits: Array<[string, (text: string) => string]> = [
    ['id-token: write on the tag job', (t) => t.replace('    permissions:\n      contents: write\n', '    permissions:\n      contents: write\n      id-token: write\n')],
    ['contents: write on the publish job', (t) => t.replace('      id-token: write\n      contents: read\n', '      id-token: write\n      contents: write\n')],
    ['a secrets expression', (t) => t.replace(pushTag, `      - run: echo \${{ secrets.X }}\n${pushTag}`)],
    ['a token env name', (t) => t.replace('      VERSION: ${{ needs.plan.outputs.version }}\n      DIST_TAG', '      NPM_TOKEN: x\n      DIST_TAG')],
    ['secrets: inherit on check', (t) => t.replace('    uses: ./.github/workflows/release-tag.yml\n', '    uses: ./.github/workflows/release-tag.yml\n    secrets: inherit\n')],
    ['no --tag on npm publish', (t) => t.replace('npm publish --tag "$DIST_TAG"', 'npm publish')],
    ['npm publish in the tag job', (t) => t.replace(pushTag, `      - run: npm publish --tag next\n${pushTag}`)],
    ['no environment on publish', (t) => t.replace('    environment: npm\n', '')],
    ['npm stage', (t) => t.replace(pushTag, `      - run: npm stage --help\n${pushTag}`)],
    ['gh release', (t) => t.replace(pushTag, `      - run: gh release create v0\n${pushTag}`)],
    ['check dropped from publish.needs', (t) => t.replace('needs: [plan, tag, check]', 'needs: [plan, tag]')],
    ['if: always() on publish', (t) => t.replace('    environment: npm\n', '    environment: npm\n    if: always()\n')],
    ['!cancelled() on a publish step', (t) => t.replace(guardIf, '        if: ${{ !cancelled() }}\n')],
    ['failure() on a publish step', (t) => t.replace(guardIf, '        if: failure()\n')],
    ['workflow_dispatch', (t) => t.replace('on:\n  push:', 'on:\n  workflow_dispatch:\n  push:')],
    ['a second branch', (t) => t.replace('branches: [main]', 'branches: [main, dev]')],
    ['a second path', (t) => t.replace('paths: [package.json]', 'paths: [package.json, pnpm-lock.yaml]')],
    ['no npm install step', (t) => t.replace(installStep, '')],
    ['an npm range', (t) => t.replace('npm@11.21.2', 'npm@^11.21.0')],
    ['npm@latest', (t) => t.replace('npm@11.21.2', 'npm@latest')],
    ['npm@11', (t) => t.replace('npm@11.21.2', 'npm@11')],
    ['npm@11.20.0', (t) => t.replace('npm@11.21.2', 'npm@11.20.0')],
    ['the install after the version check', (t) => t.replace(installStep, '').replace('      - name: Skip the publish', '      - run: npm install -g npm@11.21.2\n      - name: Skip the publish')],
    ['the install after npm publish', (t) => t.replace(installStep, '').replace(/(npm publish --tag "\$DIST_TAG"\n)/, '$1      - run: npm install -g npm@11.21.2\n')],
    ['top-level id-token: write', (t) => t.replace(topPermissions, 'permissions:\n  contents: read\n  id-token: write\n\njobs:')],
    ['top-level contents: write', (t) => t.replace(topPermissions, 'permissions:\n  contents: write\n\njobs:')],
    ['an action pinned to a tag', (t) => t.replace(/actions\/setup-node@[0-9a-f]{40} # v7\.1\.0/, 'actions/setup-node@v7')],
    ['no guard step', (t) => t.replace(/      - name: Skip the publish when the version is on npm\n(?:        .*\n)+?(?=      - name: Publish)/, '')],
    ['no if on npm publish', (t) => t.replace(guardIf, '')],
    [
      'a second check job',
      (t) => t.replace('\n  publish:', '\n  check2:\n    needs: tag\n    permissions:\n      contents: read\n    uses: ./.github/workflows/release-tag.yml\n    with:\n      ref: ${{ needs.tag.outputs.tag }}\n      sha: ${{ needs.tag.outputs.sha }}\n\n  publish:'),
    ],
    ['another called workflow path', (t) => t.replace('    uses: ./.github/workflows/release-tag.yml\n', '    uses: ./.github/workflows/release-tag2.yml\n')],
    ['another bot id', (t) => t.replaceAll('41898282+', '41898283+')],
    ['another environment name', (t) => t.replace('environment: npm', 'environment: npm-ci')],
  ];

  it.each(edits)('fails on %s', (_name, edit) => {
    const edited = edit(releaseText);
    expect(edited).not.toBe(releaseText);
    const read = (rel: string) => readRepoFile(rel.endsWith('release-tag2.yml') ? '.github/workflows/release-tag.yml' : rel);
    expect(releaseProblems(edited, read).length).toBeGreaterThan(0);
  });

  it('names a copied called workflow as a uses problem', () => {
    const edited = releaseText.replace('    uses: ./.github/workflows/release-tag.yml\n', '    uses: ./.github/workflows/release-tag2.yml\n');
    const problems = releaseProblems(edited, readRepoFile);
    expect(problems).toContain('uses ./.github/workflows/release-tag2.yml');
    expect(problems.join('\n')).not.toContain('cannot check local workflow');
  });
});
