import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'bump-version-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const files = ['package.json', 'README.md', 'docs/cli.md', 'docs/design.md', 'CHANGELOG.md'];
const scripts = ['bump-version.sh', 'release-plan.ts', 'check-npm-dist-tag.ts'];
const readme = (version: string): string =>
  `# Tagreeve\n\n> **Status: 0.7 (\`${version}\`).** Plays a visitor.\n\n> **In ${version}:** the prose line.\n`;
const cliLine = (version: string): string =>
  `\`npm i -g tagreeve@next\` installs the newest release candidate. The current release candidate is \`${version}\`. The newest final release is 0.6.2. The first Tagreeve release was 0.4.0-rc.1.`;
const CLI_HEAD = '`npm i -g tagreeve@next` installs the newest release candidate.';
const CLI_TAIL = 'The first Tagreeve release was 0.4.0-rc.1.';
const design = (version: string): string =>
  `# Tagreeve design\n\nStatus: revision 20, for release ${version}. Milestones are built.\n\n7. **0.7 (built, \`${version}\`):** the milestone prose.\n`;

let count = 0;
function copyAt(version: string): string {
  const dir = join(root, `copy-${count++}`);
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(join(dir, 'scripts'));
  for (const name of scripts) copyFileSync(join(import.meta.dirname, name), join(dir, 'scripts', name));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'tagreeve', version, type: 'module' }, null, 2)}\n`);
  writeFileSync(join(dir, 'README.md'), readme(version));
  writeFileSync(join(dir, 'docs/cli.md'), `# CLI\n\n${cliLine(version)}\n`);
  writeFileSync(join(dir, 'docs/design.md'), design(version));
  writeFileSync(join(dir, 'CHANGELOG.md'), `# Changelog\n\n## ${version}\n\nA line.\n`);
  return dir;
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');
const snapshot = (dir: string): string[] => files.map((file) => read(dir, file));
const cliText = (dir: string): string => read(dir, 'docs/cli.md').split('\n')[2] ?? '';
const bump = (dir: string, version: string) =>
  spawnSync('bash', [join(dir, 'scripts/bump-version.sh'), version], { cwd: dir, encoding: 'utf8' });
const versionOf = (dir: string): string => (JSON.parse(read(dir, 'package.json')) as { version: string }).version;

describe('bump-version.sh', () => {
  it('rewrites the version lines and leaves the prose alone', () => {
    const dir = copyAt('0.7.0-rc.3');
    const before = snapshot(dir);
    expect(read(dir, 'README.md')).toContain('> **In 0.7.0-rc.3:**');
    expect(read(dir, 'docs/design.md')).toContain('7. **0.7 (built, `0.7.0-rc.3`):**');
    expect(read(dir, 'CHANGELOG.md')).toContain('## 0.7.0-rc.3');
    const run = bump(dir, '0.7.0-rc.4');
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(versionOf(dir)).toBe('0.7.0-rc.4');
    const status = read(dir, 'README.md').split('\n').find((line) => line.startsWith('> **Status:')) ?? '';
    expect(status).toContain('`0.7.0-rc.4`');
    expect(status).not.toContain('`0.7.0-rc.3`');
    expect(read(dir, 'docs/cli.md')).toContain('The current release candidate is `0.7.0-rc.4`.');
    expect(cliText(dir)).toBe(`${CLI_HEAD} The current release candidate is \`0.7.0-rc.4\`. The newest final release is 0.6.2. ${CLI_TAIL}`);
    expect(read(dir, 'docs/design.md').split('\n')[2]).toMatch(/^Status: revision 20, for release 0\.7\.0-rc\.4\./);
    expect(read(dir, 'README.md')).toContain('> **In 0.7.0-rc.3:** the prose line.');
    expect(read(dir, 'docs/design.md')).toContain('7. **0.7 (built, `0.7.0-rc.3`):** the milestone prose.');
    expect(read(dir, 'CHANGELOG.md')).toBe(before[4]);
    for (const name of ['package.json', 'README.md', 'docs/cli.md', 'docs/design.md']) expect(run.stdout).toContain(name);
    expect(run.stdout).not.toMatch(/changed CHANGELOG\.md/);
    expect(run.stdout).toMatch(/CHANGELOG\.md.*README "In 0\.7\.0-rc\.3" line.*milestone line/);
  });

  it('writes the final form on a final version and the rc form again after it', () => {
    const dir = copyAt('0.7.0-rc.3');
    expect(bump(dir, '0.7.0').status).toBe(0);
    const cli = read(dir, 'docs/cli.md');
    const line = cliText(dir);
    expect(line).toBe(`${CLI_HEAD} The current release is \`0.7.0\`. The newest final release is 0.7.0. ${CLI_TAIL}`);
    expect(cli).not.toContain('The current release candidate is');
    expect(line.match(/`[^`]*`/g)).toEqual(['`npm i -g tagreeve@next`', '`0.7.0`']);
    expect(versionOf(dir)).toBe('0.7.0');
    expect(read(dir, 'README.md')).toContain('(`0.7.0`)');
    expect(read(dir, 'docs/design.md').split('\n')[2]).toContain('for release 0.7.0.');
    expect(bump(dir, '0.7.1-rc.1').status).toBe(0);
    expect(cliText(dir)).toBe(`${CLI_HEAD} The current release candidate is \`0.7.1-rc.1\`. The newest final release is 0.7.0. ${CLI_TAIL}`);
  });

  const refused = ['0.7.0-beta.1', 'v0.7.0', '0.7', '0.7.0-rc', '0.7.0-rc.1-x', ' 0.7.0', '0.7.0\n', '٠.7.0', '', '0.7.0-rc.2', '0.7.0-rc.3'];
  it.each(refused)('refuses %j and changes no file', (version) => {
    const dir = copyAt('0.7.0-rc.3');
    const before = snapshot(dir);
    const run = bump(dir, version);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/^refusing: /m);
    expect(run.stdout).not.toMatch(/changed /);
    expect(snapshot(dir)).toEqual(before);
  });

  it('refuses when a line to change is missing and changes no file', () => {
    const dir = copyAt('0.7.0-rc.3');
    writeFileSync(join(dir, 'docs/design.md'), '# Tagreeve design\n\nNo status here.\n');
    const before = snapshot(dir);
    const run = bump(dir, '0.7.0-rc.4');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('docs/design.md');
    expect(snapshot(dir)).toEqual(before);
  });

  const cases: Array<[string, string, boolean]> = [
    ['0.7.0-rc.9', '0.7.0-rc.10', true],
    ['0.7.0-rc.4', '0.7.0', true],
    ['0.7.0', '0.7.1-rc.1', true],
    ['0.9.0', '0.10.0-rc.1', true],
    ['0.7.0-rc.10', '0.7.0-rc.9', false],
    ['0.7.0', '0.7.0-rc.4', false],
    ['0.10.0', '0.9.0', false],
  ];
  it.each(cases)('from %s to %s the bump is accepted: %s', (start, next, ok) => {
    const dir = copyAt(start);
    const before = snapshot(dir);
    const run = bump(dir, next);
    if (ok) {
      expect(run.status).toBe(0);
      expect(versionOf(dir)).toBe(next);
    } else {
      expect(run.status).not.toBe(0);
      expect(snapshot(dir)).toEqual(before);
    }
  });
});
