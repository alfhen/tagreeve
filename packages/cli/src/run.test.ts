import { chmod, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { RunArgs } from './args.ts';
import { fillVars } from '@tagreeve/core';
import { parseScenario } from '@tagreeve/expect';
import { prepareServerContainer, resolveNetwork, runCommand } from './run.ts';

const failStart = vi.hoisted(() => ({ on: false, message: undefined as string | undefined, seen: undefined as unknown as { start: string; vars: Record<string, string> } | undefined }));

vi.mock('@tagreeve/recorder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tagreeve/recorder')>();
  return {
    ...actual,
    recordScenario: async (opts: Parameters<typeof actual.recordScenario>[0]) => {
      failStart.seen = { start: opts.parsed.start, vars: opts.parsed.vars };
      if (!failStart.on) return actual.recordScenario(opts);
      const path = join(opts.outDir!, 'failed-start.jsonl');
      const step = JSON.stringify({ type: 'step', index: 0, label: 'start', error: `navigation to ${opts.parsed.start} failed` });
      await writeFile(path, `{"type":"run"}\n${step}\n`);
      const error = new actual.StepError('start', failStart.message ?? `navigation to ${opts.parsed.start} failed`);
      error.run = { path } as never;
      throw error;
    },
  };
});

test('--var for an inherited name exits 2 as undeclared', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yaml');
  await writeFile(scenario, 'start: /\nvars:\n  product: tee\nsteps:\n  - visit: /\nexpect:\n  must: []\n  mustNot: []\n');
  const err: string[] = [];
  const code = await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: { constructor: '1' }, out: dir } as unknown as RunArgs, {
    stdout: () => undefined,
    stderr: (t) => err.push(t),
  });
  expect(err.join('')).toContain('--var constructor not declared');
  expect(code).toBe(2);
});

async function netLogRun(options: string, extra: Partial<RunArgs>) {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yaml');
  await writeFile(scenario, `start: /\n${options}steps:\n  - visit: /\nexpect:\n  must: []\n  mustNot: []\n`);
  const err: string[] = [];
  const args = { scenario, site: 'http://127.0.0.1:9', vars: {}, out: dir, netLog: true, gtmOverride: join(dir, 'missing.json'), ...extra } as unknown as RunArgs;
  const code = await runCommand(args, { stdout: () => undefined, stderr: (t) => err.push(t) });
  return { code, err: err.join('') };
}

test('--net-log is refused when the scenario runs in stub mode', async () => {
  const { code, err } = await netLogRun('', {});
  expect(code).toBe(2);
  expect(err).toContain('--net-log needs --network live');
});

test('a scenario with network: live exits 2 and names --network live, also with --network live', async () => {
  for (const extra of [{}, { network: 'live' as const }]) {
    const { code, err } = await netLogRun('options:\n  network: live\n', extra);
    expect(code).toBe(2);
    expect(err).toContain('options.network: live is not allowed in a scenario. Pass --network live on the command line.');
  }
});

test('--net-log with --network live starts in live mode when the scenario sets no network', async () => {
  const { err } = await netLogRun('', { network: 'live' });
  expect(err).not.toContain('--net-log needs --network live');
  expect(err).toContain('live mode');
});

function resolve(options: string, args: { network?: RunArgs['network']; netLog?: boolean }) {
  const parsed = parseScenario(`start: /\n${options}steps:\n  - visit: /\n`);
  const err: string[] = [];
  const network = resolveNetwork({ network: args.network, netLog: args.netLog ?? false }, parsed, { stdout: () => undefined, stderr: (t) => err.push(t) });
  return { network, err: err.join('') };
}

test('--network server without serverHosts is refused and says what to set', () => {
  const { network, err } = resolve('', { network: 'server' });
  expect(network).toBeUndefined();
  expect(err).toContain('options.serverHosts');
});

test('server mode with a loopback host is accepted without a warning', () => {
  const { network, err } = resolve('options:\n  serverHosts: [127.0.0.1]\n', { network: 'server' });
  expect(network).toBe('server');
  expect(err).toBe('');
});

test('server mode with a hosted host warns on stderr', () => {
  const { network, err } = resolve('options:\n  network: server\n  serverHosts: [sgtm.example.com]\n', {});
  expect(network).toBe('server');
  expect(err).toContain('Warning: server mode');
  expect(err).toContain('sgtm.example.com');
});

test('--net-log stays live-only in server mode', () => {
  const { network, err } = resolve('options:\n  serverHosts: [127.0.0.1]\n', { network: 'server', netLog: true });
  expect(network).toBeUndefined();
  expect(err).toContain('--net-log needs --network live');
});

const FAKE_CONFIG = Buffer.from('id=GTM-PWTEST1&env=1&auth=pw-fixture-auth').toString('base64');

async function fakeDockerPath(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pw-docker-'));
  const bin = join(dir, 'docker');
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  return dir;
}

async function prepare(args: Parameters<typeof prepareServerContainer>[0], hosts: string[], env: NodeJS.ProcessEnv) {
  const err: string[] = [];
  const spec = await prepareServerContainer(args, hosts, { stdout: () => undefined, stderr: (t) => err.push(t) }, env);
  return { spec, err: err.join('') };
}

test('--server-container is refused outside server mode', () => {
  const parsed = parseScenario('start: /\noptions:\n  serverHosts: [127.0.0.1]\nsteps:\n  - visit: /\n');
  const err: string[] = [];
  const network = resolveNetwork({ network: undefined, netLog: false, serverContainer: true }, parsed, { stdout: () => undefined, stderr: (t) => err.push(t) });
  expect(network).toBeUndefined();
  expect(err.join('')).toContain('--server-container needs --network server');
});

test('--server-container is accepted in server mode', () => {
  const parsed = parseScenario('start: /\noptions:\n  network: server\n  serverHosts: [127.0.0.1]\nsteps:\n  - visit: /\n');
  expect(resolveNetwork({ network: undefined, netLog: false, serverContainer: true }, parsed, { stdout: () => undefined, stderr: () => undefined })).toBe('server');
});

test('a run without the flag never reads the config or the seam', async () => {
  const { spec, err } = await prepare({ serverContainerConfig: '/does/not/exist' }, ['127.0.0.1'], { TAGREEVE_TEST_SERVER_CONTAINER_UPSTREAM: 'not-a-url' });
  expect(spec).toBeNull();
  expect(err).toBe('');
});

test('the config comes from the environment variable and is validated before any browser starts', async () => {
  const docker = await fakeDockerPath('exit 0');
  const ok = await prepare({ serverContainer: true }, ['sgtm.example.com'], { TAGREEVE_SERVER_CONTAINER_CONFIG: FAKE_CONFIG, PATH: docker });
  expect(ok.spec).toMatchObject({ configSource: { kind: 'env' } });
  const missing = await prepare({ serverContainer: true }, ['sgtm.example.com'], {});
  expect(missing.spec).toBeUndefined();
  expect(missing.err).toContain('TAGREEVE_SERVER_CONTAINER_CONFIG');
  const bad = await prepare({ serverContainer: true }, ['sgtm.example.com'], { TAGREEVE_SERVER_CONTAINER_CONFIG: 'pw-not-a-config' });
  expect(bad.spec).toBeUndefined();
  expect(bad.err).toContain('base64');
  expect(bad.err).not.toContain('pw-not-a-config');
});

test('a config file readable by others is refused and the message holds neither the config nor the path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-config-'));
  const file = join(dir, 'secret-name-config.txt');
  await writeFile(file, FAKE_CONFIG);
  await chmod(file, 0o644);
  const open = await prepare({ serverContainer: true, serverContainerConfig: file }, ['sgtm.example.com'], {});
  expect(open.spec).toBeUndefined();
  expect(open.err).toContain('mode 0600');
  expect(open.err).not.toContain(FAKE_CONFIG);
  expect(open.err).not.toContain('secret-name');
  await chmod(file, 0o600);
  expect((await prepare({ serverContainer: true, serverContainerConfig: file }, ['sgtm.example.com'], { PATH: await fakeDockerPath('exit 0') })).spec).toMatchObject({ configSource: { kind: 'file', path: file } });
  expect((await prepare({ serverContainer: true, serverContainerConfig: join(dir, 'missing.txt') }, ['sgtm.example.com'], {})).spec).toBeUndefined();
});

test('the stand-in seam needs no config, and a bad seam value exits 2 without printing it', async () => {
  const env = { TAGREEVE_TEST_SERVER_CONTAINER_CMD: join(await fakeDockerPath('exit 0'), 'docker') };
  expect((await prepare({ serverContainer: true }, ['127.0.0.1'], env)).spec).toMatchObject({ configSource: { kind: 'env' } });
  const hosted = await prepare({ serverContainer: true }, ['sgtm.example.com'], env);
  expect(hosted.spec).toBeUndefined();
  expect(hosted.err).toContain('loopback');
  const upstream = await prepare({ serverContainer: true }, ['127.0.0.1'], { ...env, TAGREEVE_TEST_SERVER_CONTAINER_UPSTREAM: 'http://pw-secret-host.example.com' });
  expect(upstream.spec).toBeUndefined();
  expect(upstream.err).not.toContain('pw-secret-host');
});

test('without Docker the check exits before any browser, names the install page and holds no config', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'pw-nodocker-'));
  const r = await prepare({ serverContainer: true }, ['sgtm.example.com'], { TAGREEVE_SERVER_CONTAINER_CONFIG: FAKE_CONFIG, PATH: empty });
  expect(r.spec).toBeUndefined();
  expect(r.err).toContain('Docker is needed for --server-container');
  expect(r.err).toContain('https://docs.docker.com/get-docker/');
  expect(r.err).not.toContain(FAKE_CONFIG);
});

test('a missing image exits before any browser and names the build command', async () => {
  const docker = await fakeDockerPath('[ "$1" = image ] && exit 1\necho 27.0.0');
  const r = await prepare({ serverContainer: true }, ['sgtm.example.com'], { TAGREEVE_SERVER_CONTAINER_CONFIG: FAKE_CONFIG, PATH: docker });
  expect(r.spec).toBeUndefined();
  expect(r.err).toContain('tagreeve server-container build');
});

test('a bad digest override of the base image exits 2', async () => {
  const r = await prepare({ serverContainer: true }, ['sgtm.example.com'], { TAGREEVE_SERVER_CONTAINER_CONFIG: FAKE_CONFIG, TAGREEVE_SERVER_CONTAINER_BASE: 'not-a-digest' });
  if (process.arch !== 'arm64') {
    expect(r.spec).toBeUndefined();
    expect(r.err).toContain('TAGREEVE_SERVER_CONTAINER_BASE');
  }
});

test('canaries refuse a start URL whose variable resolves to a canary name, and allow a case variant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yaml');
  await writeFile(scenario, 'start: /plain/product?{key}=pw-1\nvars: { key: gclid }\noptions: { canaries: true }\nsteps:\n  - visit: /\nexpect:\n  must: []\n  mustNot: []\n');
  const err: string[] = [];
  const code = await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: {}, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: (t) => err.push(t) });
  expect(code).toBe(2);
  expect(err.join('')).toContain('already holds the gclid parameter');
  await writeFile(scenario, 'start: /plain/product?GCLID=pw-1\noptions: { canaries: true }\nsteps:\n  - visit: /\nexpect:\n  must: []\n  mustNot: []\n');
  const err2: string[] = [];
  failStart.on = true;
  try {
    await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: {}, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: (t) => err2.push(t) });
  } finally {
    failStart.on = false;
  }
  expect(err2.join('')).not.toContain('already holds');
});

test.each(['gclid', 'ttclid'])('canaries refuse a start URL that holds %s, name it and echo no value', async (name) => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yaml');
  const start = `/plain/product?${name}=pw-1`;
  await writeFile(scenario, `start: ${start}\noptions: { canaries: true }\nsteps:\n  - visit: /\nexpect:\n  must: []\n  mustNot: []\n`);
  const text = await readFile(scenario, 'utf8');
  expect(text).toContain('pw-1');
  expect(text.split('\n')[0]).toBe(`start: ${start}`);
  const err: string[] = [];
  const code = await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: {}, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: (t) => err.push(t) });
  const out = err.join('');
  expect(code).toBe(2);
  expect(out).toContain(name);
  for (const leak of ['pw-1', start, `http://127.0.0.1:9${start}`, `?${name}=`, 'unknown option', 'Run failed']) expect(out).not.toContain(leak);
});

test('a failed start visit of a canary run prints and records no canary value', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yml');
  await writeFile(scenario, 'start: /plain/product\noptions: { canaries: true, seed: 7 }\nsteps:\n  - wait: 1s\nexpect:\n  must: []\n  mustNot: []\n');
  const err: string[] = [];
  failStart.on = true;
  let code: number;
  try {
    code = await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: {}, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: (t) => err.push(t) });
  } finally {
    failStart.on = false;
  }
  expect(code).toBe(2);
  expect(err.join('')).not.toContain('TEST-');
  const file = (await readdir(dir)).find((f) => f.endsWith('.jsonl'))!;
  const lines = (await readFile(join(dir, file), 'utf8')).split('\n').filter(Boolean);
  expect((JSON.parse(lines[0]!) as { canaries?: unknown[] }).canaries).toHaveLength(6);
  expect(lines.filter((l) => l.startsWith('{"type":"step"')).join('')).not.toContain('TEST-');
});

test('a failed canary run names the base64 forms of a canary value too', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yml');
  await writeFile(scenario, 'start: /plain/product\noptions: { canaries: true, seed: 7 }\nsteps:\n  - wait: 1s\nexpect:\n  must: []\n  mustNot: []\n');
  const value = 'TEST-GCLID-7-RUN-0001';
  const forms = [Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url')];
  const err: string[] = [];
  failStart.message = `evaluate threw ${forms.join(' and ')}`;
  failStart.on = true;
  try {
    await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: {}, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: (t) => err.push(t) });
  } finally {
    failStart.on = false;
    failStart.message = undefined;
  }
  const out = err.join('');
  for (const form of forms) expect(out).not.toContain(form);
  expect(out).toContain('(url param gclid)');
});

test('a canary run whose var value holds a placeholder plants the canaries on the fully filled start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yml');
  await writeFile(scenario, 'start: /p/{key}\nvars:\n  key: x\n  next: y\noptions: { canaries: true, seed: 7 }\nsteps:\n  - wait: 1s\nexpect:\n  must: []\n  mustNot: []\n');
  failStart.on = true;
  failStart.seen = undefined;
  try {
    await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: { key: '{next}' }, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: () => undefined });
  } finally {
    failStart.on = false;
  }
  const seen = failStart.seen as { start: string } | undefined;
  expect(seen?.start.startsWith('/p/y?gclid=')).toBe(true);
});

test('a canary run runs a var value that holds a placeholder and a #, with the canaries before the #', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yml');
  await writeFile(scenario, "start: /p/{key}\nvars:\n  key: '{next}'\n  next: 'y#z'\noptions: { canaries: true, seed: 7 }\nsteps:\n  - wait: 1s\nexpect:\n  must: []\n  mustNot: []\n");
  expect(parseScenario(await readFile(scenario, 'utf8')).vars.next).toContain('#');
  const err: string[] = [];
  failStart.on = true;
  failStart.seen = undefined;
  try {
    await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: {}, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: (t) => err.push(t) });
  } finally {
    failStart.on = false;
  }
  const start = (failStart.seen as { start: string } | undefined)?.start;
  expect(err.join('')).not.toContain('fragment');
  expect(start?.startsWith('/p/y?gclid=')).toBe(true);
  expect(start?.endsWith('#z')).toBe(true);
});

const CANARY_TAIL = 'options: { canaries: true, seed: 7 }\nsteps:\n  - wait: 1s\nexpect:\n  must: []\n  mustNot: []\n';

async function canaryRun(head: string, check: (text: string) => void, stopAtStart = true) {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yml');
  await writeFile(scenario, head + CANARY_TAIL);
  check(await readFile(scenario, 'utf8'));
  const err: string[] = [];
  failStart.on = stopAtStart;
  failStart.seen = undefined;
  let code: number;
  try {
    code = await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: {}, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: (t) => err.push(t) });
  } finally {
    failStart.on = false;
  }
  return { code, err: err.join(''), start: (failStart.seen as { start: string } | undefined)?.start };
}

test.each([['tab', '\\t', '\t'], ['newline', '\\n', '\n'], ['carriage return', '\\r', '\r']])('canaries refuse a start URL with a raw %s inside a reserved name', async (_label, escape, raw) => {
  const r = await canaryRun(`start: "/plain/product?gc${escape}lid=pw-1"\n`, (text) => {
    expect(parseScenario(text).start).toContain(`gc${raw}lid`);
  });
  expect(r.code).toBe(2);
  expect(r.err).toContain('already holds the gclid parameter');
  expect(r.err).not.toContain('pw-1');
});

test.each([
  ['a percent-encoded tab', '/plain/product?gc%09lid=pw-1', '%09'],
  ['a name that is not reserved after the strip', '"/plain/product?gc\\tlidx=pw-1"', '\tlidx'],
])('canaries do not refuse a start URL with %s', async (_label, start, held) => {
  const r = await canaryRun(`start: ${start}\n`, (text) => {
    expect(parseScenario(text).start).toContain(held);
  });
  expect(r.err).not.toContain('already holds');
  expect(r.start).toBeDefined();
});

const refillVars = (next: string) => `vars:\n  key: '{next}'\n  next: ${next}\n  other: 'a#b'\n`;

test('a canary run with nested vars does not refuse a # in a variable the start URL does not use', async () => {
  const r = await canaryRun(`start: /p/{key}\n${refillVars('y')}`, (text) => {
    expect(parseScenario(text).vars.other).toContain('#');
  });
  expect(r.err).not.toContain('fragment');
  expect(r.start?.startsWith('/p/y?gclid=')).toBe(true);
});

test.each([
  ['a # in a variable the start uses directly', `start: /p/{key}/{other}\n${refillVars('y')}`, 'other'],
  ['a # reached through another variable', `start: /p/{key}\nvars:\n  key: '{next}'\n  next: 'y#z'\n`, 'next'],
])('a canary run with nested vars and %s keeps the canaries before the #', async (_label, head, name) => {
  const r = await canaryRun(head, (text) => {
    expect(parseScenario(text).vars[name]).toContain('#');
  });
  expect(r.err).not.toContain('fragment');
  expect(r.start).toContain('?gclid=');
  expect(r.start?.indexOf('?gclid=')).toBeLessThan(r.start!.indexOf('#'));
});

test('the gclid refusal sees a start that is filled through a nested variable', async () => {
  const r = await canaryRun('start: "/p?{q}"\nvars:\n  q: \'{r}\'\n  r: \'gclid=pw-1\'\n', (text) => {
    expect(parseScenario(text).vars.r).toBe('gclid=pw-1');
  }, false);
  expect(r.code).toBe(2);
  expect(r.err).toContain('already holds the gclid parameter');
  expect(r.err).not.toContain('pw-1');
});

const CYCLE = "vars:\n  loopone: 'pw-v1-{looptwo}'\n  looptwo: 'pw-v2-{loopone}'\n";

test.each([
  ['the start', `start: /p/{loopone}\n${CYCLE}`, '  - wait: 1s\n', {}, /start/],
  ['a visit step', `start: /\n${CYCLE}`, '  - wait: 1s\n  - visit: /p/{loopone}\n', {}, /step 2|visit-2/],
  ['the start, made by a --var value', "start: /p/{loopone}\nvars:\n  loopone: 'pw-v1-{looptwo}'\n  looptwo: 'pw-v2'\n", '  - wait: 1s\n', { looptwo: '{loopone}' }, /start/],
])('a variable cycle in %s exits 2 before the recorder starts, with no value', async (_label, head, steps, cliVars, where) => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yml');
  await writeFile(scenario, `${head}steps:\n${steps}expect:\n  must: []\n  mustNot: []\n`);
  expect((await readFile(scenario, 'utf8')) + JSON.stringify(cliVars)).toContain('pw-v1-');
  const err: string[] = [];
  failStart.on = true;
  failStart.seen = undefined;
  let code: number;
  try {
    code = await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: cliVars, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: (t) => err.push(t) });
  } finally {
    failStart.on = false;
  }
  const out = err.join('');
  expect(code).toBe(2);
  expect(failStart.seen).toBeUndefined();
  expect(out).toContain('loopone');
  expect(out).toContain('looptwo');
  expect(out).toMatch(where);
  expect(out).not.toContain('pw-v1-');
  expect(out).not.toContain('pw-v2');
});

test('with no refill a direct # variable is not refused and the canaries go before the #', async () => {
  const r = await canaryRun('start: "/p?x={frag}"\nvars:\n  frag: \'a#b\'\n', (text) => {
    expect(parseScenario(text).vars.frag).toContain('#');
  });
  expect(r.err).not.toContain('fragment');
  expect(r.start?.startsWith('/p?x=a&gclid=')).toBe(true);
  expect(r.start?.endsWith('#b')).toBe(true);
});

async function warnRun(head: string, steps: string, extra: Record<string, unknown> = {}, cliVars: Record<string, string> = {}, file?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = file ?? join(dir, 's.yml');
  if (!file) await writeFile(scenario, `${head}steps:\n${steps}expect:\n  must: []\n  mustNot: []\n`);
  const err: string[] = [];
  const out: string[] = [];
  failStart.on = true;
  failStart.seen = undefined as typeof failStart.seen;
  let code: number;
  try {
    code = await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: cliVars, out: dir, ...extra } as unknown as RunArgs, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
  } finally {
    failStart.on = false;
  }
  const lines = err.join('').split('\n');
  return { code, err: err.join(''), out: out.join(''), warnings: lines.filter((l) => l.startsWith('Warning: ')), seen: failStart.seen };
}

const WAIT = '  - wait: 1s\n';

test('an undeclared {name} in a variable value warns once and the recorder gets the same start', async () => {
  const head = 'start: "{path}"\nvars:\n  path: /collections/{nope}\n';
  const r = await warnRun(head, WAIT);
  expect(r.warnings).toHaveLength(1);
  expect(r.warnings[0]).toContain('{nope}');
  expect(r.warnings[0]).toContain('path');
  expect(r.warnings[0]).toContain('start');
  expect(r.seen!.start).toBe('{path}');
  expect(fillVars(r.seen!.start, r.seen!.vars)).toBe('/collections/{nope}');
  expect(r.code).toBe(2);
  const k = await warnRun(`${head}options:\n  canaries: true\n  seed: 7\n`, WAIT);
  expect(k.seen!.start.startsWith('/collections/{nope}?gclid=')).toBe(true);
  expect(k.warnings).toHaveLength(1);
});

test('the warning names step N for a visit path, and a --var value warns the same way', async () => {
  const a = await warnRun('start: /\nvars:\n  path: /collections/{nope}\n', `${WAIT}  - visit: "{path}"\n`);
  expect(a.warnings).toHaveLength(1);
  expect(a.warnings[0]).toContain('{nope}');
  expect(a.warnings[0]).toContain('path');
  expect(a.warnings[0]).toContain('step 2');
  expect(a.warnings[0]).not.toContain('(start)');
  expect(a.seen!.start).toBe('/');
  const text = 'start: "{path}"\nvars:\n  path: /c/plain\n';
  expect(parseScenario(`${text}steps:\n${WAIT}`).vars.path).not.toContain('{nope}');
  const b = await warnRun(text, WAIT, {}, { path: '/c/{nope}' });
  expect(b.warnings).toHaveLength(1);
  expect(b.warnings[0]).toMatch(/path.*\{nope\}.*start/);
  expect(b.seen!.vars.path).toBe('/c/{nope}');
});

test('the warning holds no value but the undeclared name', async () => {
  const a = await warnRun('start: "{path}"\nvars:\n  path: /pw-marker-7/{nope}\n', WAIT);
  expect(a.seen!.vars.path).toContain('pw-marker-7');
  expect(a.err).not.toContain('pw-marker-7');
  expect(a.warnings.some((l) => l.includes('path') && l.includes('{nope}'))).toBe(true);
  const b = await warnRun('start: "{path}"\nvars:\n  path: /c\n', WAIT, {}, { path: '/pw-cli-9/{nope}' });
  expect(b.seen!.vars.path).toContain('pw-cli-9');
  expect(b.err).not.toContain('pw-cli-9');
  expect(b.warnings.some((l) => l.includes('path') && l.includes('{nope}'))).toBe(true);
});

test('no warning for a declared nested variable, and the parser exit is unchanged', async () => {
  const head = 'start: "{path}"\nvars:\n  path: /collections/{known}\n  known: shirts\n';
  expect(parseScenario(`${head}steps:\n${WAIT}`).vars.path).toContain('{known}');
  const a = await warnRun(head, WAIT);
  expect(a.warnings).toEqual([]);
  expect(a.code).toBe(2);
  const text = 'start: "/x/{nope}"\nvars:\n  path: /c\n';
  expect(text).toContain('{nope}');
  const b = await warnRun(text, WAIT);
  expect(b.code).toBe(2);
  expect(b.err).toContain('uses {nope} but vars has no "nope"');
  expect(b.seen).toBeUndefined();
  expect(b.warnings).toEqual([]);
});

test('only a variable that supplies the start and holds the placeholder is named', async () => {
  const un = await warnRun('start: "{path}"\nvars:\n  path: /c/{nope}\n  spare: /s/{nope}\n', WAIT);
  expect(un.seen!.vars.spare).toContain('{nope}');
  expect(un.warnings.some((l) => l.includes('path'))).toBe(true);
  expect(un.warnings.some((l) => /\bspare\b/.test(l))).toBe(false);
  const head = 'start: "{path}"\nvars:\n  path: /c/{mid}\n  mid: /m/{nope}\n';
  const vars = parseScenario(`${head}steps:\n${WAIT}`).vars;
  expect(vars.path).toContain('{mid}');
  expect(vars.path).not.toContain('{nope}');
  const pass = await warnRun(head, WAIT);
  expect(pass.warnings).toHaveLength(1);
  expect(pass.warnings[0]).toMatch(/mid.*\{nope\}/);
  expect(pass.warnings.some((l) => /\bpath\b/.test(l))).toBe(false);
  const whole = await warnRun('start: "{path}"\nvars:\n  path: "{nope}"\n', WAIT);
  expect(whole.warnings).toHaveLength(1);
  expect(whole.warnings[0]).toMatch(/path.*\{nope\}/);
  const proto = await warnRun('start: "{path}"\nvars:\n  path: /c/{constructor}\n', WAIT);
  expect(proto.warnings).toHaveLength(1);
  expect(proto.warnings[0]).toMatch(/path.*\{constructor\}/);
});

test('one warning line for each variable, placeholder and place, and none on stdout with --json', async () => {
  const a = await warnRun('start: "{path}{path}"\nvars:\n  path: /c/{nope}/{nope}\n', `${WAIT}  - visit: "{path}"\n`);
  const nope = a.warnings.filter((l) => l.includes('{nope}'));
  expect(nope).toHaveLength(2);
  expect(nope.filter((l) => l.includes('(start)'))).toHaveLength(1);
  expect(nope.filter((l) => l.includes('step 2'))).toHaveLength(1);
  const b = await warnRun('start: "{path}"\nvars:\n  path: /c/{nope}/{nada}\n', WAIT);
  expect(b.warnings.filter((l) => l.includes('path') && l.includes('{nope}'))).toHaveLength(1);
  expect(b.warnings.filter((l) => l.includes('path') && l.includes('{nada}'))).toHaveLength(1);
  expect(b.warnings).toHaveLength(2);
  const c = await warnRun('start: "{path}"\nvars:\n  path: /collections/{nope}\n', WAIT, { json: true });
  expect(c.warnings).toHaveLength(1);
  expect(c.out).not.toContain('Warning: ');
  expect(c.out).not.toContain('{nope}');
});

test('the real scenario tiles-any.yml warns only for a --var value with an undeclared name', async () => {
  const file = join(process.cwd(), 'e2e/scenarios/tiles-any.yml');
  const a = await warnRun('', '', {}, {}, file);
  expect(a.warnings).toEqual([]);
  expect(a.seen!.start).toBe('/tiles?theme={theme}');
  expect(a.code).toBe(2);
  const b = await warnRun('', '', {}, { theme: 'radio-{nope}' }, file);
  expect(b.warnings).toHaveLength(1);
  expect(b.warnings[0]).toMatch(/theme.*\{nope\}.*start/);
  expect(b.seen!.start).toBe('/tiles?theme={theme}');
  expect(b.code).toBe(2);
});
