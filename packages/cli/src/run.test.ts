import { chmod, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { RunArgs } from './args.ts';
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

test('a canary run whose var value holds a placeholder keeps the start unresolved, so the visit step fills it once', async () => {
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
  const seen = failStart.seen as { start: string; vars: Record<string, string> } | undefined;
  expect(seen?.start.startsWith('/p/{key}?gclid=')).toBe(true);
  expect(seen?.vars.key).toBe('{next}');
});

test('a canary run refuses a var value that holds a placeholder and a #', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pw-run-'));
  const scenario = join(dir, 's.yml');
  await writeFile(scenario, 'start: /p/{key}\nvars:\n  key: x\n  next: y\noptions: { canaries: true, seed: 7 }\nsteps:\n  - wait: 1s\nexpect:\n  must: []\n  mustNot: []\n');
  const err: string[] = [];
  const code = await runCommand({ scenario, site: 'http://127.0.0.1:9', vars: { key: '{next}#frag' }, out: dir } as unknown as RunArgs, { stdout: () => undefined, stderr: (t) => err.push(t) });
  expect(code).toBe(2);
  expect(err.join('')).toContain('fragment');
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
});

const refillVars = (next: string) => `vars:\n  key: '{next}'\n  next: ${next}\n  other: 'a#b'\n`;

test('a canary run with a refill does not refuse a # in a variable the start URL does not use', async () => {
  const r = await canaryRun(`start: /p/{key}\n${refillVars('y')}`, (text) => {
    expect(parseScenario(text).vars.other).toContain('#');
  });
  expect(r.err).not.toContain('fragment');
  expect(r.start?.startsWith('/p/{key}?gclid=')).toBe(true);
});

test.each([
  ['a # in a variable the start uses directly', `start: /p/{key}/{other}\n${refillVars('y')}`, 'other'],
  ['a # reached through another variable', `start: /p/{key}\nvars:\n  key: '{next}'\n  next: 'y#z'\n`, 'next'],
  ['a # in the inner variable beside an unused one', `start: /p/{key}\n${refillVars("'y#z'")}`, 'next'],
])('a canary run with a refill and %s still refuses', async (_label, head, name) => {
  const r = await canaryRun(head, (text) => {
    const vars = parseScenario(text).vars;
    expect(vars[name]).toContain('#');
    if (name === 'next') expect(vars.key).not.toContain('#');
  }, false);
  expect(r.code).toBe(2);
  expect(r.err).toContain('fragment');
});

test('with no refill a direct # variable is not refused and the canaries go before the #', async () => {
  const r = await canaryRun('start: "/p?x={frag}"\nvars:\n  frag: \'a#b\'\n', (text) => {
    expect(parseScenario(text).vars.frag).toContain('#');
  });
  expect(r.err).not.toContain('fragment');
  expect(r.start?.startsWith('/p?x=a&gclid=')).toBe(true);
  expect(r.start?.endsWith('#b')).toBe(true);
});
