import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

const installProblem = (text: string): string | undefined =>
  /npm i -g tagreeve@next(?![\w-])/.test(text)
    ? 'gives npm i -g tagreeve@next as the install command'
    : !/npm i -g tagreeve(?![@\w-])/.test(text)
      ? 'does not give npm i -g tagreeve as the install command'
      : /tagreeve[^.\n]*installs `0\.3\.0`/.test(text)
        ? 'says tagreeve installs 0.3.0'
        : undefined;

const installSection = (cli: string): string => cli.slice(cli.indexOf('## Install'), cli.indexOf('\n## ', cli.indexOf('## Install') + 1));

const enterAlwaysProblem = (text: string): string | undefined =>
  /Enter in the terminal always works/.test(text) ? 'says Enter always works' : undefined;

test('install text gives the bare npm i -g tagreeve and no tagreeve 0.3.0', () => {
  expect(installProblem(read('README.md'))).toBeUndefined();
  expect(installProblem(read('docs/guide/first-run.md'))).toBeUndefined();
  expect(installProblem(installSection(read('docs/cli.md')))).toBeUndefined();
  expect(installProblem(read('site/src/lib/prompt.ts'))).toBeUndefined();
});

test('the install check fails on @next, a missing install line or a tagreeve 0.3.0 claim', () => {
  expect(installProblem('Run `npm i -g tagreeve@next`.')).toBeDefined();
  expect(installProblem('`npm i -g tagreeve` and `npm i -g tagreeve@next`.')).toBeDefined();
  expect(installProblem('Install tagreeve.')).toBeDefined();
  expect(installProblem('`npm i -g tagreeve` installs `0.3.0`.')).toBeDefined();
  expect(installProblem('Run `npm i -g tagreeve`.')).toBeUndefined();
});

test('the docs do not say Enter always works', () => {
  expect(enterAlwaysProblem(read('docs/cli.md'))).toBeUndefined();
  expect(enterAlwaysProblem(read('docs/design.md'))).toBeUndefined();
  expect(enterAlwaysProblem('Enter in the terminal always works.')).toBeDefined();
});

test('the docs do not say a body rule hides the handoff pill', () => {
  expect(read('docs/cli.md')).not.toMatch(/rule such as `body \{ display: none \}`/);
});

test('the changelog has 0.3.0 above rc.2 and rc.1, with no leftover markers', () => {
  const log = read('CHANGELOG.md');
  const final = log.indexOf('## 0.3.0\n');
  const rc2 = log.indexOf('## 0.3.0-rc.2');
  const rc1 = log.indexOf('## 0.3.0-rc.1');
  expect(final).toBeGreaterThan(-1);
  expect(final).toBeLessThan(rc2);
  expect(rc2).toBeLessThan(rc1);
  expect(log).toContain('### Known in 0.3.0\n');
  expect(log.slice(final, rc2)).not.toMatch(/<!-- T\d+ -->/);
});

test('the version in the README and cli.md equals package.json', () => {
  const version = (JSON.parse(read('package.json')) as { version: string }).version;
  expect(version).toMatch(/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/);
  for (const file of ['README.md', 'docs/cli.md']) {
    const named = read(file).match(/`\d+\.\d+\.\d+(?:-rc\.\d+)?`/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    expect(new Set(named)).toEqual(new Set([`\`${version}\``]));
  }
});

test('design section 11 lists deniedIdentifiers as a built-in check', () => {
  expect(read('docs/design.md')).toMatch(/`options\.builtins` sets the severity[^\n]*`deniedIdentifiers`/);
});

const loginRuleProblem = (agents: string, design: string): string | undefined => {
  const section13 = design.slice(design.indexOf('**Other rules**'), design.indexOf('## 14.'));
  return /Log-ins are never automated on a hosted site/.test(agents) && /Log-ins are handoff steps/.test(section13)
    ? undefined
    : 'AGENTS.md or design section 13 no longer says log-ins are handoff steps on a hosted site';
};

test('AGENTS.md and design section 13 say log-ins are handoff steps on a hosted site', () => {
  expect(loginRuleProblem(read('AGENTS.md'), read('docs/design.md'))).toBeUndefined();
  expect(loginRuleProblem('Payments are handoff steps.', '**Other rules**\n- Payments are handoffs.\n## 14.')).toBeDefined();
});

const section = (text: string, from: string, to: string): string => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from) + 1));
const line = (text: string, needle: string): string => text.split('\n').find((l) => l.includes(needle)) ?? '';

test('0.6.1 docs text: cli.md', () => {
  const cli = read('docs/cli.md');
  expect(cli).not.toContain('Neither message');
  expect(cli).toContain('No message holds any text from the file');
  expect(cli).not.toContain('names the path you gave');
  expect(cli).not.toContain('only a missing path counts as absent');
  expect(cli).not.toContain('saved by 0.6.0-rc.1');
  expect(cli).toContain('saved before 0.6.0-rc.2');
  expect(line(cli, '| 2 | Usage error')).toContain('`baseline save` that cannot name or write its file');
  expect(line(cli, '| 2 | Usage error')).not.toContain('`baseline save` with one path on a suite record');
  expect(section(cli, '### `tagreeve diff', '### `tagreeve baseline save')).toContain('`kindChanged` is a list of `{ epoch, event, frame, from, to }`');
  expect(cli).toContain('answeredBefore, concurrentRequest } }');
  expect(cli).toContain('`possibleRealDataPush` flag');
});

test('0.6.1 docs text: design.md', () => {
  const design = read('docs/design.md');
  expect(design).not.toContain('only a missing path counts as absent');
  expect(design.indexOf('its flag is not given: `suite` with no folder')).toBeGreaterThan(-1);
  expect(line(design, '| `tag: {')).toContain('`success`, `failure`, `exception` or `timeout`');
  expect(section(design, '### 5.2 Capture', '### 5.3')).toContain('lists each missed name once, at most five');
  expect(section(design, '## 13.', '## 14.')).toContain('shows a value-like event name as `(other)` in the record');
  expect(design).toContain('The miss reason is `concurrentRequest`');
});

test('0.6.1 docs text: guides and changelog', () => {
  const reports = read('docs/guide/tag-reports.md');
  expect(reports).toContain('`--gtm-override`');
  const guide = read('docs/guide/server-container.md');
  expect(guide).toMatch(/\| Client ID \|[^\n]*\n(?:\|[^\n]*\n)*\| \| \| `concurrentRequest` \|/);
  const log = read('CHANGELOG.md');
  const rc3 = section(log, '## 0.6.0-rc.3', '## 0.6.0-rc.2');
  expect(line(rc3, 'tag IDs as numbers')).not.toContain('published container');
  expect(line(rc3, 'tag IDs as numbers')).toContain('GTM preview');
  expect(rc3).toContain('or reloads after its input was found');
  expect(section(log, '## 0.6.1', '## 0.6.0\n')).not.toContain('<!-- C09 -->');
});
