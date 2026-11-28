import { chmod, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Request } from '../packages/core/src/index.ts';
import { standInContainerPath } from '../fixtures/site/src/index.ts';
import { outDir, run, runCli, site, type CliRun } from './cli-helpers.ts';

const CONFIG = Buffer.from('id=GTM-PWTEST1&env=1&auth=pw-fixture-auth').toString('base64');
const NAME = 'builtin: serverContainerRejected';
const COUNTS = /^(\d+) of (\d+) requests to the server container were rejected \(400: \1\)\.$/;

interface Summary {
  results: { expectation: string; pass: boolean; severity: string; message?: string; evidence: string[] }[];
  [key: string]: unknown;
}

let upstream: http.Server;
let env: Record<string, string>;
let scenarioPath = '';
let failScenarioPath = '';
let okScenarioPath = '';

const OPTIONS = 'options: { seed: 1, network: server, serverHosts: [127.0.0.1], allowUnknownDestination: true, builtins: { possibleRealData: warn';

beforeAll(async () => {
  upstream = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('// fake google file'));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  env = {
    TAGREEVE_TEST_SERVER_CONTAINER_CMD: standInContainerPath,
    TAGREEVE_TEST_SERVER_CONTAINER_UPSTREAM: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    TAGREEVE_SERVER_CONTAINER_CONFIG: CONFIG,
  };
  const scenarioWith = (start: string, extra: string) => `start: ${start}\nsteps:\n  - wait: 2s\nexpect:\n  must: []\n  mustNot: []\n${OPTIONS}${extra} } }\n`;
  scenarioPath = join(outDir, 'rejecting.yml');
  failScenarioPath = join(outDir, 'rejecting-fail.yml');
  okScenarioPath = join(outDir, 'accepting.yml');
  await writeFile(scenarioPath, scenarioWith('/server-container-link?n=5&reject=400', ''));
  await writeFile(failScenarioPath, scenarioWith('/server-container-link?n=5&reject=400', ', serverContainerRejected: fail'));
  await writeFile(okScenarioPath, scenarioWith('/server-container-link?n=5', ''));
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

const runFile = (file: string, extra: string[] = []) => runCli(['run', file, '--site', site.url, '--out', outDir, ...extra], env);
const summaryOf = (r: CliRun) => JSON.parse(r.stdout) as Summary;
const containerLine = (text: string) => text.split('\n').find((l) => l.startsWith('Server container:')) ?? '';

function resultLines(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes(NAME));
  const out = [lines[start]!];
  for (let i = start + 1; i < lines.length && lines[i]!.startsWith('       '); i++) out.push(lines[i]!);
  return out;
}

describe('a stand-in container that answers most requests with 400', () => {
  let json: CliRun;
  let text: CliRun;

  beforeAll(async () => {
    json = await runFile(scenarioPath, ['--json', '--server-container']);
    text = await runFile(scenarioPath, ['--server-container']);
  }, 180_000);

  test('the --json run has one warning with the counts and status codes', () => {
    const results = summaryOf(json).results.filter((r) => r.expectation === NAME);
    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('warn');
    const match = COUNTS.exec(result.message ?? '');
    expect(match).not.toBeNull();
    const [n, m] = [Number(match![1]), Number(match![2])];
    expect(n).toBeGreaterThan(m / 2);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(result.evidence).toHaveLength(n);
  });

  test('the text run shows the suffix with the same counts and a WARN line', () => {
    const [, n, m] = COUNTS.exec(summaryOf(json).results.find((r) => r.expectation === NAME)!.message!)!;
    expect(text.stdout).toContain(`WARN ${NAME}`);
    expect(containerLine(text.stdout)).toMatch(new RegExp(`; ${n} of ${m} requests rejected$`));
  });

  test('no path, query, host or ID of the rejected requests is in the result or the line', () => {
    const rejected = json.records!.requests.filter((r: Request) => r.url.includes('127.0.0.1') && r.url.includes('reject=400') && !r.captured);
    expect(rejected.length).toBeGreaterThanOrEqual(2);
    for (const r of rejected) for (const part of ['/g/collect', 'reject=400', '127.0.0.1']) expect(r.url).toContain(part);
    const result = summaryOf(json).results.find((r) => r.expectation === NAME)!;
    const shown = [JSON.stringify(result), ...resultLines(text.stdout), containerLine(text.stdout)].join('\n');
    for (const part of ['/g/collect', 'reject=400', '127.0.0.1', 'tid=']) expect(shown).not.toContain(part);
  });

  test('the default severity exits 0 with no failing result, and fail exits 1 on that result alone', async () => {
    expect(json.code).toBe(0);
    const failing = (s: Summary) => s.results.filter((r) => !r.pass && r.severity === 'fail').map((r) => r.expectation);
    expect(failing(summaryOf(json))).toEqual([]);
    const strict = await runFile(failScenarioPath, ['--json', '--server-container']);
    expect(strict.code).toBe(1);
    expect(failing(summaryOf(strict))).toEqual([NAME]);
  }, 120_000);

  test('the record and the summary gain no field', () => {
    expect(json.records!.run.recordSchemaVersion).toBe(5);
    expect(Object.keys(json.records!.run.serverContainer!).sort()).toEqual(['image', 'passThrough', 'refused', 'requests', 'startedAt', 'unlinked']);
    const summary = summaryOf(json);
    expect(Object.keys(summary).sort()).toEqual(['epochs', 'flags', 'hits', 'ok', 'pass', 'path', 'results', 'runId', 'serverContainer', 'skippedFields', 'testServerContainer']);
    expect(Object.keys(summary.serverContainer as object).sort()).toEqual(['calls', 'exact', 'forwarded', 'notExact', 'probable', 'unlinked']);
  });
});

describe('the same run without the 400 switch', () => {
  test('passes, and the Server container line has no rejected count', async () => {
    const json = await runFile(okScenarioPath, ['--json', '--server-container']);
    const results = summaryOf(json).results.filter((r) => r.expectation === NAME);
    expect(results).toHaveLength(1);
    expect(results[0]!.pass).toBe(true);
    const text = await runFile(okScenarioPath, ['--server-container']);
    expect(containerLine(text.stdout)).toContain('Server container:');
    expect(containerLine(text.stdout)).not.toContain('requests rejected');
  }, 180_000);
});

describe('runs without a server container', () => {
  const triples = (r: CliRun) => summaryOf(r).results.map((x) => [x.expectation, x.pass, x.severity]);
  const BUILTINS = [
    ['builtin: unknownDestination', true, 'fail'],
    ['builtin: sandboxPageUrl', true, 'fail'],
    ['builtin: deniedIdentifiers', true, 'fail'],
    ['builtin: earlyIdentifiers', true, 'warn'],
    ['builtin: consentModeSetup', true, 'warn'],
    ['builtin: earlyIdentityPush', true, 'warn'],
    ['builtin: idHandover', true, 'warn'],
    ['builtin: possibleRealData', true, 'fail'],
  ];

  test('the server-container page keeps its results', async () => {
    const r = await run('server-container');
    expect(r.code).toBe(0);
    expect(triples(r)).toEqual(BUILTINS);
  }, 60_000);

  test('the plain GTM shop keeps its results', async () => {
    const r = await run('plain-gtm-journey');
    expect(r.code).toBe(0);
    expect(triples(r)).toEqual([
      ['must: {"vendor":"ga4","event":"purchase","consent.analytics":"granted"}', true, 'fail'],
      ['must: {"vendor":"google-ads","event":"conversion","consent.ads":"granted"}', true, 'fail'],
      ...BUILTINS.flatMap((b) => (b[0] === 'builtin: consentModeSetup' ? [b, ['builtin: consentModeOrder', true, 'warn']] : [b])),
    ]);
  }, 60_000);
});

describe('a container that ends during the run', () => {
  test('exits 2 with the record path and no rejected text', async () => {
    const exiting = join(outDir, 'exiting-stand-in');
    await writeFile(exiting, `#!${process.execPath}\nimport http from 'node:http';\nhttp.createServer((req, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');\nsetTimeout(() => process.exit(0), 800);\n`);
    await chmod(exiting, 0o755);
    const r = await run('server-container', ['--server-container'], { ...env, TAGREEVE_TEST_SERVER_CONTAINER_CMD: exiting });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Record: ');
    for (const text of [r.stdout, r.stderr]) {
      expect(text).not.toContain('requests rejected');
      expect(text).not.toContain('serverContainerRejected');
    }
  }, 60_000);
});
