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

const section = (text: string, from: string, to: string): string => {
  const start = text.indexOf(from);
  if (start < 0) throw new Error(`section start not found: ${from}`);
  const end = text.indexOf(to, start + 1);
  if (end < 0) throw new Error(`section end not found: ${to}`);
  return text.slice(start, end);
};
const line = (text: string, needle: string): string => {
  const found = text.split('\n').find((l) => l.includes(needle));
  if (found === undefined) throw new Error(`line not found: ${needle}`);
  return found;
};

test('section and line throw when a bound or a line is missing', () => {
  expect(() => section('## A\ntext\n## B', '## Renamed', '## B')).toThrow('section start not found');
  expect(() => section('## A\ntext\n## B', '## A', '## Renamed')).toThrow('section end not found');
  expect(section('## A\ntext\n## B', '## A', '## B')).toBe('## A\ntext\n');
  expect(() => line('one\ntwo', 'three')).toThrow('line not found');
  expect(line('one\ntwo', 'tw')).toBe('two');
});

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
  expect(line(design, 'Version 5 adds `TagReport.t`')).toContain('`answeredBefore` or `concurrentRequest`');
  expect(line(design, 'Version 5 adds `TagReport.t`')).toContain('`possibleRealDataPush`');
});

test('0.6.1 docs text: guides and changelog', () => {
  const reports = read('docs/guide/tag-reports.md');
  const noReports = line(reports, 'A rule with no report for its container');
  expect(noReports).toContain('install the reporter template in the container and run with `--gtm-override`');
  expect(reports).not.toContain('`tagNameUnknown`. The HTML report shows both');
  const guide = read('docs/guide/server-container.md');
  expect(guide).toMatch(/\| Client ID \|[^\n]*\n(?:\|[^\n]*\n)*\| \| \| `concurrentRequest` \|/);
  const log = read('CHANGELOG.md');
  const rc3 = section(log, '## 0.6.0-rc.3', '## 0.6.0-rc.2');
  expect(line(rc3, 'tag IDs as numbers')).not.toContain('published container');
  expect(line(rc3, 'tag IDs as numbers')).toContain('GTM preview');
  expect(rc3).toContain('or reloads after its input was found');
  expect(section(log, '## 0.6.1', '## 0.6.0\n')).not.toContain('<!-- C09 -->');
});

test('0.6.1 docs text: the path defaults say a path of the wrong kind is skipped', () => {
  const cli = read('docs/cli.md');
  const skipped = 'is skipped like a missing one';
  expect(line(cli, '| `--autoconsent-rules <file>`')).toContain(skipped);
  expect(line(cli, '| `--tracker-list <file>`')).toContain(skipped);
  expect(line(cli, '| `--stores <file>`')).toContain(skipped);
  expect(line(read('docs/design.md'), '**CLI:** `tagreeve run`')).toContain('is skipped like a missing one');
});

test('0.6.2 docs text: cli.md', () => {
  const cli = read('docs/cli.md');
  expect(line(cli, 'A `handoff` step waits for a person.')).toContain('`min(420px, 100vw - 32px)`');
  expect(line(cli, 'A `handoff` step waits for a person.')).toContain('cut after the fourth line with an ellipsis');
  expect(line(cli, 'A `handoff` step waits for a person.')).toContain('14 px radius');
  expect(cli).not.toContain('The label is at most 300 px wide');
  expect(line(cli, 'At the step, the page is on the allowed host')).toContain('`test mode could not be checked: the card frame could not be read`');
  expect(line(cli, 'At the step, the page is on the allowed host')).not.toContain('or `the card frame could not be read`');
  expect(line(cli, 'At the step, the page is on the allowed host')).toContain('While Tagreeve looks for the card frames, it is `card field <field> could not be filled: the card frame could not be read`');
  expect(line(cli, 'The step types into the first matching card iframe')).toContain('`card field <field> could not be filled: the card frame could not be read`');
  const init = section(cli, '### `tagreeve init`', '### `tagreeve template web`');
  expect(init).toContain('it checks every target. If any target is refused, it creates nothing');
  expect(init).toContain('`{ "items": [] }`');
  expect(init).toContain('`Could not write .gitignore: a file or folder is in the way`');
  expect(line(cli, '`wait` also takes a URL')).toContain('When the remembered form is no longer in the page');
  expect(line(cli, '`wait` also takes a URL')).toContain('inside a submit button');
  const diff = section(cli, '### `tagreeve diff', '### `tagreeve baseline save');
  expect(diff).toContain('`pushKind` (`gtag` or `object`)');
  expect(diff).toContain('`kind` stays the move type');
  expect(diff).toContain('`push kind changed: purchase (renamed from checkout_completed)`');
  expect(diff).toContain('adds no `pathsAdded` or `pathsRemoved` entry for `event`');
  expect(diff).toContain('only when the epochs are neighbours');
});

test('0.6.2 docs text: design.md, guides and records.ts', () => {
  const design = read('docs/design.md');
  expect(design).not.toContain('(0.6.0-rc.1) loads');
  expect(design).toContain('saved before 0.6.0-rc.2, loads and warns that pushes are not compared');
  expect(design).toContain('`moved` or `kindChanged` entry of a joined pair has `renamedFrom` too');
  expect(design).toContain('adds no `pathsAdded` or `pathsRemoved` entry for `event`');
  expect(design).toContain('A send from `pagehide` or `visibilitychange` is answered in the page and never reaches the container');
  expect(design).toContain('tries every placement of up to 10 such hits');
  expect(design).toContain('reads `in the push`');
  const guide = read('docs/guide/server-container.md');
  expect(line(guide, '- `serverSendProbableLink`')).toContain('`identity.hashesMatch`');
  expect(line(guide, '- `serverSendProbableLink`')).toContain('`pagehide`');
  expect(line(guide, '- `serverSendProbableLink`')).toContain('shares a client ID with the call');
  expect(line(guide, '- `serverSendUnlinked`')).toContain('up to 10 calls');
  expect(line(read('docs/guide/reading-results.md'), '- `possibleRealDataPush`')).toContain('never fails a run');
  expect(read('packages/core/src/records.ts')).toContain('the flag kind `possibleRealDataPush` and the `HitLinkMiss.clientId` value `concurrentRequest`');
});

test('#1477: the 0.6.2 changelog says a kind change does not report the event path', () => {
  const released = section(read('CHANGELOG.md'), '## 0.6.2', '## 0.6.1\n');
  expect(released).toContain('a kind change of a joined pair does not report the `event` key path');
  const kind =
    'A kind change compares the two groups without the `event` key path of the object form, because the gtag form holds the event name in its arguments, so it adds no `pathsAdded` or `pathsRemoved` entry for `event`. A gtag body with its own `event` key keeps the path on both sides.';
  expect(line(read('docs/cli.md'), '`kindChanged` is a list of')).toContain(kind);
  expect(line(read('docs/design.md'), '`tagreeve diff a b` groups hits')).toContain(kind);
});

test('#1478: the payment frame deadlines are named, not "the step deadline"', () => {
  const frames = line(read('docs/cli.md'), 'At the step, the page is on the allowed host');
  expect(frames).not.toContain('Every wait on a card frame ends by the step deadline');
  expect(frames).toContain('end by the shorter of the step timeout and 5 s');
  expect(frames).toContain('The fill of each card field has its own deadline of the step timeout');
  expect(frames).toContain('at most 500 ms after its deadline');
});

test('#1479: the payment fill reason `inputs not readable` is documented', () => {
  const fill = line(read('docs/cli.md'), 'The step types into the first matching card iframe');
  expect(fill).toContain('`inputs not readable` in place of the list');
  expect(fill).toContain('while Tagreeve reads the frame state during the fill');
});

test('#1480: design section 11 gives no push kind warning for a baseline without kinds', () => {
  const design = read('docs/design.md');
  expect(design).not.toContain('give path changes and a `push kind changed` warning, and `changed` is true');
  expect(design).toContain('it gives no `push kind changed` warning. When a baseline and a run both carry kinds');
  expect(design).toContain('a `push kind changed` warning and path changes other than `event`');
});

test('#1481: the server container guide names the unload send exception', () => {
  const guide = read('docs/guide/server-container.md');
  expect(line(guide, 'The client ID link is narrower.')).toContain('A send from `pagehide` or `visibilitychange` does not count as that other request');
});

test('0.6.1 changelog lines are corrected', () => {
  const released = section(read('CHANGELOG.md'), '## 0.6.1\n', '## 0.6.0\n');
  expect(released).not.toContain('get no push findings');
  expect(released).toContain('A record from 0.6.0 or earlier has no push flags. Nothing adds them to a stored record.');
  expect(released).toContain('**A `must` rule with an exact `count` can warn with `serverSendUnlinked`**');
  expect(line(released, '`consentModeSetup` names a hit with no tag ID')).toMatch(/\(#1306, #1308, #1309, #1385\)\.$/);
});
