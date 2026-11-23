import { readFile, writeFile, chmod } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Hit, Request, RunRecords } from '../packages/core/src/index.ts';
import { standInContainerPath } from '../fixtures/site/src/index.ts';
import { outDir, runCli, site, type CliRun } from './cli-helpers.ts';

const CONFIG = Buffer.from('id=GTM-PWTEST1&env=1&auth=pw-fixture-auth').toString('base64');
const LOSES = "what Stape's hosting layer does with a loader request: its own headers, Cookie Keeper and any change to the path or body";
const OPTIONS = 'options: { seed: 1, network: server, serverHosts: [127.0.0.1], allowUnknownDestination: true, builtins: { possibleRealData: warn } }';
const TRANSLATED = /127\.0\.0\.1:\d+\/g\/collect\?/;

let upstream: http.Server;
let env: Record<string, string>;
let counter = 0;

beforeAll(async () => {
  upstream = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('// fake google file'));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  env = {
    TAGREEVE_TEST_SERVER_CONTAINER_CMD: standInContainerPath,
    TAGREEVE_TEST_SERVER_CONTAINER_UPSTREAM: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    TAGREEVE_SERVER_CONTAINER_CONFIG: CONFIG,
  };
});

afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

const send = (options: string) => `  - evaluate: "window.pwSendLinkHits(${options})"\n  - wait: 2s\n`;

async function runScenario(steps: string, args: string[], over: Record<string, string> = {}, start = '/server-container-link', opts = OPTIONS): Promise<CliRun> {
  const file = join(outDir, `loader-${counter++}.yml`);
  await writeFile(file, `start: ${start}\nsteps:\n${steps}expect:\n  must: []\n  mustNot: []\n${opts}\n`);
  return runCli(['run', file, '--site', site.url, '--out', outDir, ...args], { ...env, ...over });
}

const sgtmRequests = (records: RunRecords): Request[] => records.requests.filter((r) => r.url.startsWith(site.sgtmUrl) && !r.captured);
const pathOf = (r: Request) => new URL(r.url).pathname;
const decodedK = (r: Request) => Buffer.from(new URL(r.url).searchParams.get('k')!, 'base64').toString('utf8');
const containerGa4 = (records: RunRecords): Hit[] => {
  const ids = new Set(records.requests.filter((r) => r.captured === 'serverContainer').map((r) => r.id));
  return records.hits.filter((h) => h.vendor === 'ga4' && ids.has(h.requestId));
};
const browserGa4 = (records: RunRecords): Hit[] => {
  const ids = new Set(sgtmRequests(records).map((r) => r.id));
  return records.hits.filter((h) => h.vendor === 'ga4' && ids.has(h.requestId));
};
const statusOf = (records: RunRecords, r: Request) => records.responses.find((x) => x.requestId === r.id)?.status;
const recordText = async (r: CliRun) => readFile((JSON.parse(r.stdout) as { path: string }).path, 'utf8');
const loaderSteps = (extra = '') => send(`{ loader: 'stape', ${extra}eid: 'pw-eid-loader-1' }`) + send(`{ loader: 'stape', ${extra}eid: 'pw-eid-loader-2' }`);

describe('two Stape loader hits', () => {
  let loader: CliRun;
  let loaderText: CliRun;
  let plain: CliRun;
  let plainRecord: string;
  let loaderRecord: string;

  beforeAll(async () => {
    loader = await runScenario(loaderSteps(), ['--json', '--server-container']);
    loaderText = await runScenario(loaderSteps(), ['--server-container']);
    plain = await runScenario(send("{ eid: 'pw-eid-loader-1' }") + send("{ eid: 'pw-eid-loader-2' }"), ['--json', '--server-container']);
    loaderRecord = await recordText(loader);
    plainRecord = await recordText(plain);
  }, 300_000);

  test('reach the container at /g/collect, get 200 and link exactly; the run counts them', () => {
    const records = loader.records!;
    const requests = sgtmRequests(records);
    expect(requests).toHaveLength(2);
    for (const r of requests) {
      expect(pathOf(r)).toBe('/pwloader');
      expect(statusOf(records, r)).toBe(200);
    }
    expect(loader.code).toBe(0);
    const hits = containerGa4(records);
    expect(hits).toHaveLength(2);
    for (const h of hits) expect(h.via?.confidence).toBe('exact');
    expect(records.run.serverContainer!.loaderUnwrapped).toEqual({ loader: 'stape', requests: 2, loses: LOSES });
    expect(records.run.recordSchemaVersion).toBe(5);
    expect((JSON.parse(loader.stdout) as { serverContainer: { loaderUnwrapped: number } }).serverContainer.loaderUnwrapped).toBe(2);
    expect(loaderText.stdout).toContain('; 2 Stape loader requests sent as their real path');
  });

  test('the same hits without the loader link the same and have no loaderUnwrapped', () => {
    const records = plain.records!;
    for (const r of sgtmRequests(records)) expect(pathOf(r)).toBe('/g/collect');
    expect(plain.code).toBe(0);
    const hits = containerGa4(records);
    expect(hits).toHaveLength(2);
    for (const h of hits) expect(h.via?.confidence).toBe('exact');
    expect(records.run.serverContainer).not.toHaveProperty('loaderUnwrapped');
    expect(JSON.parse(plain.stdout).serverContainer).not.toHaveProperty('loaderUnwrapped');
  });

  test('the record keeps the loader URL and the browser hit says via stape-loader', () => {
    const records = loader.records!;
    for (const r of sgtmRequests(records)) {
      expect(pathOf(r)).toBe('/pwloader');
      expect([...new URL(r.url).searchParams.keys()]).toEqual(['k']);
    }
    const hits = browserGa4(records);
    expect(hits).toHaveLength(2);
    for (const h of hits) expect(h.transport.endsWith('via stape-loader')).toBe(true);
  });

  test('no record field, stdout or stderr holds the translated URL or a decoded query value', () => {
    expect(plainRecord).toMatch(TRANSLATED);
    for (const r of sgtmRequests(loader.records!)) expect(decodedK(r)).toContain('tid=G-PWTEST0001');
    expect(loaderRecord).not.toMatch(TRANSLATED);
    const shown = [loader.stdout, loaderText.stdout, loader.stderr, loaderText.stderr].join('\n');
    for (const part of ['tid=G-PWTEST0001', 'pw-eid-loader-1', 'pw-eid-loader-2', '/g/collect?']) expect(shown).not.toContain(part);
    const all = loaderRecord + shown;
    expect(all).not.toContain(CONFIG);
    expect(all).not.toContain('pw-fixture-auth');
  });
});

describe('a Stape loader hit with a client ID and no event ID', () => {
  test('links its server GA4 hit exactly by client ID, with no linkMiss', async () => {
    const r = await runScenario(send("{ loader: 'stape', cid: 'pw-client-loader-1', copy: true, after: true }"), ['--json', '--server-container']);
    const records = r.records!;
    const requests = sgtmRequests(records);
    expect(requests).toHaveLength(1);
    expect(pathOf(requests[0]!)).toBe('/pwloader');
    const hits = containerGa4(records);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.via?.by).toBe('clientId');
    expect(hits[0]!.via?.confidence).toBe('exact');
    expect(hits[0]!.linkMiss).toBeUndefined();
  }, 300_000);
});

describe('a loader request whose decoded path is /s', () => {
  test('reaches the container at the loader path, gets 404 and is not translated', async () => {
    const r = await runScenario(loaderSteps("path: 's', "), ['--json', '--server-container']);
    const records = r.records!;
    const requests = sgtmRequests(records);
    expect(requests).toHaveLength(2);
    for (const q of requests) {
      expect(pathOf(q)).toBe('/pwloader');
      expect(decodedK(q).startsWith('/s?')).toBe(true);
      expect(statusOf(records, q)).toBe(404);
    }
    expect(containerGa4(records)).toHaveLength(0);
    expect(records.run.serverContainer).not.toHaveProperty('loaderUnwrapped');
  }, 120_000);
});

describe('what the container receives', () => {
  test('a translated loader request has the method, headers and body of a plain one', async () => {
    const log = join(outDir, 'container-log.jsonl');
    const recording = join(outDir, 'recording-stand-in');
    await writeFile(
      recording,
      `#!${process.execPath}\nimport fs from 'node:fs';\nimport http from 'node:http';\nhttp.createServer((req, res) => {\n  const chunks = [];\n  req.on('data', (c) => chunks.push(c));\n  req.on('end', () => {\n    if (req.url !== '/healthz') fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }) + '\\n');\n    res.writeHead(200).end('ok');\n  });\n}).listen(Number(process.env.PORT), '127.0.0.1');\n`,
    );
    await chmod(recording, 0o755);
    const r = await runScenario(send("{ eid: 'pw-eid-plain-1' }") + send("{ loader: 'stape', eid: 'pw-eid-plain-2' }"), ['--json', '--server-container'], { TAGREEVE_TEST_SERVER_CONTAINER_CMD: recording });
    const [first, second] = sgtmRequests(r.records!);
    expect(pathOf(first!)).toBe('/g/collect');
    expect(pathOf(second!)).toBe('/pwloader');
    const entries = (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { method: string; url: string; headers: Record<string, string>; body: string })
      .filter((e) => new URL(e.url, 'http://x.invalid').pathname !== '/healthz');
    expect(entries).toHaveLength(2);
    const [a, b] = entries as [(typeof entries)[number], (typeof entries)[number]];
    for (const e of entries) {
      expect(e.method).toBe('POST');
      expect(new URL(e.url, 'http://x.invalid').pathname).toBe('/g/collect');
    }
    const query = (e: typeof a) => {
      const params = new URL(e.url, 'http://x.invalid').searchParams;
      params.delete('ep.event_id');
      params.delete('event_id');
      return params.toString();
    };
    expect(query(a)).toBe(query(b));
    expect(a.body).toBe(b.body);
    expect(a.body).toBe('');
    expect(a.headers).toEqual(b.headers);
  }, 120_000);
});

describe('a container that ends during the run', () => {
  test('a loader request whose fetch fails is counted and recorded as failed', async () => {
    const exiting = join(outDir, 'exiting-loader-stand-in');
    await writeFile(exiting, `#!${process.execPath}\nimport http from 'node:http';\nhttp.createServer((req, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');\nsetTimeout(() => process.exit(0), 800);\n`);
    await chmod(exiting, 0o755);
    const r = await runScenario('  - wait: 2s\n' + send("{ loader: 'stape', eid: 'pw-eid-loader-fail-1' }"), ['--json', '--server-container'], { TAGREEVE_TEST_SERVER_CONTAINER_CMD: exiting });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Record: ');
    const record = r.stderr.split('\n').find((l) => l.startsWith('Record: '))!.slice('Record: '.length).trim();
    const { readRun } = await import('../packages/core/src/index.ts');
    const records = await readRun(record);
    const loaderRequest = records.requests.find((q) => pathOf(q) === '/pwloader')!;
    expect(loaderRequest.outcome).toBe('failed');
    expect(records.run.serverContainer!.error).toBe('exited');
    expect(records.run.serverContainer!.loaderUnwrapped!.requests).toBe(1);
  }, 120_000);
});

describe('the reject option inside the wrapped query', () => {
  test('rejected loader requests are still counted as translated', async () => {
    const r = await runScenario('  - wait: 3s\n', ['--json', '--server-container'], {}, '/server-container-link?n=3&eid=pw-eid-loader-r-1&loader=stape&reject=400');
    const records = r.records!;
    const [first, second, third] = sgtmRequests(records);
    expect(decodedK(second!)).toMatch(/^\/g\/collect\?.*reject=400/);
    expect(decodedK(third!)).toMatch(/^\/g\/collect\?.*reject=400/);
    expect([first, second, third].map((q) => statusOf(records, q!))).toEqual([200, 400, 400]);
    const summary = JSON.parse(r.stdout) as { results: { expectation: string; message?: string }[] };
    expect(summary.results.find((x) => x.expectation === 'builtin: serverContainerRejected')!.message).toBe('2 of 3 requests to the server container were rejected (400: 2).');
    expect(records.run.serverContainer!.loaderUnwrapped!.requests).toBe(3);
  }, 120_000);
});

describe('a loader page without --server-container', () => {
  test('keeps the loader URL, has no serverContainer record and decodes the hit via stape-loader', async () => {
    const r = await runScenario('  - wait: 2s\n', ['--json'], {}, '/server-container-link?n=1&eid=pw-eid-loader-stub-1&loader=stape', 'options: { seed: 1, network: stub, serverHosts: [127.0.0.1], allowUnknownDestination: true, builtins: { possibleRealData: warn } }');
    expect(r.code).toBe(0);
    expect(r.records!.run.serverContainer).toBeUndefined();
    expect(await recordText(r)).not.toContain('loaderUnwrapped');
    const requests = sgtmRequests(r.records!);
    expect(requests).toHaveLength(1);
    expect(pathOf(requests[0]!)).toBe('/pwloader');
    expect(browserGa4(r.records!).filter((h) => h.transport.endsWith('via stape-loader'))).toHaveLength(1);
  }, 120_000);
});
