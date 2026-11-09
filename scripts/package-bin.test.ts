import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('package.json has the tagreeve bin only', () => {
  const pkg = JSON.parse(read('package.json')) as { bin: Record<string, string> };
  expect(Object.keys(pkg.bin)).toEqual(['tagreeve']);
});

test('the build has one entry point', () => {
  const match = /entryPoints:\s*\{([^}]*)\}/.exec(read('scripts/build.ts'));
  expect(match).not.toBeNull();
  expect(match![1]!.split(',').filter((entry) => entry.trim())).toHaveLength(1);
});

const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = join(root, 'node_modules/.cache');
mkdirSync(cacheDir, { recursive: true });
const tmp = mkdtempSync(join(cacheDir, 'tagreeve-package-bin-'));
const outdir = join(tmp, 'pkg/dist');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const distCli = join(root, 'dist/cli.js');
const distMtime = existsSync(distCli) ? statSync(distCli).mtimeMs : null;

test('the built CLI prints the web template in both forms', () => {
  execFileSync(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('./build.ts', import.meta.url)), '--outdir', outdir], { stdio: 'pipe' });
  writeFileSync(join(tmp, 'pkg/package.json'), read('package.json'));
  const cli = join(outdir, 'cli.js');
  const file = read('packages/recorder/src/gtm-templates/web-tag-reporter.tpl');
  expect(execFileSync(process.execPath, [cli, 'template', 'web'], { encoding: 'utf8' })).toBe(file);
  const json = JSON.parse(execFileSync(process.execPath, [cli, 'template', 'web', '--json'], { encoding: 'utf8' })) as { template: string; setup: { publish: boolean } };
  expect(json.template).toBe(file);
  expect(json.setup.publish).toBe(false);
}, 60_000);

test('the built CLI fails and prints no template when the bundled template is missing', () => {
  const bundled = join(outdir, 'templates/tagreeve-tag-reporter.tpl');
  expect(existsSync(bundled)).toBe(true);
  const decoy = join(tmp, 'recorder/src/gtm-templates/web-tag-reporter.tpl');
  mkdirSync(join(decoy, '..'), { recursive: true });
  writeFileSync(decoy, 'DECOY-SENTINEL-OUTSIDE-PACKAGE');
  expect(existsSync(decoy)).toBe(true);
  rmSync(join(outdir, 'templates'), { recursive: true });
  const result = spawnSync(process.execPath, [join(outdir, 'cli.js'), 'template', 'web'], { encoding: 'utf8' });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('missing from this install');
  expect(result.stdout + result.stderr).not.toContain('DECOY-SENTINEL');
}, 60_000);

test('the build refuses to empty a source folder or the repo root', () => {
  const fake = realpathSync(mkdtempSync(join(tmpdir(), 'tagreeve-decoy-')));
  mkdirSync(join(fake, 'scripts'), { recursive: true });
  mkdirSync(join(fake, 'packages/cli/src'), { recursive: true });
  copyFileSync(join(root, 'scripts/build.ts'), join(fake, 'scripts/build.ts'));
  writeFileSync(join(fake, 'package.json'), JSON.stringify({ dependencies: {} }));
  for (const dir of ['packages/cli/src', 'scripts', '.']) {
    const sentinel = join(fake, dir, 'SENTINEL');
    writeFileSync(sentinel, 'keep');
    const result = spawnSync(process.execPath, ['--experimental-transform-types', join(fake, 'scripts/build.ts'), '--outdir', join(fake, dir)], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--outdir must');
    expect(existsSync(sentinel)).toBe(true);
  }
  rmSync(fake, { recursive: true, force: true });
}, 60_000);

test('building into a temp folder leaves dist/cli.js as it was', () => {
  const after = existsSync(distCli) ? statSync(distCli).mtimeMs : null;
  expect(after).toBe(distMtime);
});
