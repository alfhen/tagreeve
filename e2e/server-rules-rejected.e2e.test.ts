import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { standInContainerPath } from '../fixtures/site/src/index.ts';
import { outDir, runCli, scenario, site, type CliRun } from './cli-helpers.ts';

const CONFIG = Buffer.from('id=GTM-PWTEST1&env=1&auth=pw-fixture-auth').toString('base64');
const REJECTED = /^builtin: serverContainerRejected$/;
const MESSAGE = 'cannot evaluate: the server container rejected most browser requests';
const SERVER_MUST = /^must: .*"sentBy":"server"/;
const BROWSER_MUSTNOT = /^mustNot: .*"sentBy":"browser"/;
const CAPI_MUSTNOT = /^mustNot: .*meta-capi/;
const BROWSER_MUST = /^must: .*127\.0\.0\.1/;
const LEAKS = ['/g/collect', 'reject=400', '127.0.0.1', 'tid=', 'G-PWTEST0001'];

interface Result {
  expectation: string;
  pass: boolean;
  severity: string;
  message?: string;
  note?: string;
}
interface Summary {
  path: string;
  results: Result[];
}

let upstream: http.Server;
let env: Record<string, string>;
let rejecting: CliRun;
let rejectingText: CliRun;
let accepting: CliRun;
let html = '';

const summaryOf = (r: CliRun) => JSON.parse(r.stdout) as Summary;
const one = (r: CliRun, pattern: RegExp) => {
  const found = summaryOf(r).results.filter((x) => pattern.test(x.expectation));
  expect(found).toHaveLength(1);
  return found[0]!;
};
const runFile = (file: string, extra: string[]) => runCli(['run', file, '--site', site.url, '--out', outDir, '--server-container', ...extra], env);

beforeAll(async () => {
  upstream = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('// fake google file'));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  env = {
    TAGREEVE_TEST_SERVER_CONTAINER_CMD: standInContainerPath,
    TAGREEVE_TEST_SERVER_CONTAINER_UPSTREAM: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    TAGREEVE_SERVER_CONTAINER_CONFIG: CONFIG,
  };
  const rejectingPath = scenario('server-rules-rejected');
  const acceptingPath = join(outDir, 'server-rules-accepting.yml');
  const yml = await readFile(rejectingPath, 'utf8');
  expect(yml).toContain('&reject=400');
  await writeFile(acceptingPath, yml.replace('&reject=400', ''));
  rejecting = await runFile(rejectingPath, ['--json']);
  rejectingText = await runFile(rejectingPath, []);
  accepting = await runFile(acceptingPath, ['--json']);
  const out = join(outDir, 'server-rules-rejected.html');
  const report = await runCli(['report', summaryOf(rejecting).path, '--html', out]);
  expect(report.code, report.stderr).toBe(0);
  html = await readFile(out, 'utf8');
}, 300_000);

afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

describe('the 400 run', () => {
  test('the input rejects, and the server must cannot evaluate and warns', () => {
    expect(summaryOf(rejecting).results.filter((r) => REJECTED.test(r.expectation)).map((r) => r.pass)).toEqual([false]);
    const result = one(rejecting, SERVER_MUST);
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('warn');
    expect(result.note).toBe('serverContainerRejected');
    expect(result.message).toBe(MESSAGE);
    expect(rejecting.code).toBe(0);
    expect(rejecting.records!.run.recordSchemaVersion).toBe(5);
  });

  test('a sentBy browser mustNot and a must with no sentBy keep their verdicts', () => {
    expect(one(rejecting, REJECTED).pass).toBe(false);
    for (const pattern of [BROWSER_MUSTNOT, BROWSER_MUST]) {
      const result = one(rejecting, pattern);
      expect(result.pass).toBe(true);
      expect(result.note).toBeUndefined();
    }
  });

  test('a mustNot with no sentBy cannot evaluate when no server hit is there', () => {
    expect(one(rejecting, REJECTED).pass).toBe(false);
    expect(rejecting.records!.hits.filter((h) => h.vendor === 'meta-capi' && h.event === 'Purchase')).toEqual([]);
    const result = one(rejecting, CAPI_MUSTNOT);
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('warn');
    expect(result.note).toBe('serverContainerRejected');
    expect(rejecting.code).toBe(0);
  });

  test('the text summary shows the note under the rule, and the report reads CANNOT EVALUATE', () => {
    const lines = rejectingText.stdout.split('\n');
    const at = lines.findIndex((l) => l.startsWith('  WARN must:') && l.includes('"sentBy":"server"'));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toBe(`       note: ${MESSAGE}`);
    const item = html.split('<li').find((part) => /<code>must: [^<]*sentBy[^<]*server/.test(part));
    expect(item, 'the server must in the report').toBeDefined();
    expect(item).toContain('<span class="status">CANNOT EVALUATE</span>');
    expect(item).toMatch(/<span class="note">[^<]*the server container rejected most browser requests/);
  });

  test('the message and the note text name no path, query, host or ID of the rejected requests', () => {
    const rejected = rejecting.records!.requests.filter((r) => !r.captured && LEAKS.every((p) => r.url.includes(p)));
    expect(rejected.length).toBeGreaterThanOrEqual(2);
    const noted = summaryOf(rejecting).results.filter((r) => r.note === 'serverContainerRejected');
    expect(noted.length).toBeGreaterThanOrEqual(1);
    for (const r of noted) expect(r.message).toBe(MESSAGE);
    const notes = [...html.matchAll(/<span class="note">([^<]*)<\/span>/g)].map((m) => m[1]!);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    const noteLines = rejectingText.stdout.split('\n').filter((l) => l.startsWith('       note:'));
    for (const shown of [...noted.map((r) => r.message!), ...noteLines, ...notes]) for (const part of LEAKS) expect(shown).not.toContain(part);
  });
});

describe('the same run without the 400 switch', () => {
  test('judges the server must on the hits the container sent', () => {
    expect(one(accepting, REJECTED).pass).toBe(true);
    const result = one(accepting, SERVER_MUST);
    expect(result.pass).toBe(true);
    expect(result.note).toBeUndefined();
    expect(summaryOf(accepting).results.filter((r) => r.note === 'serverContainerRejected')).toEqual([]);
  });
});
