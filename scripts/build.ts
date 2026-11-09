import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const pkg = JSON.parse(readFileSync(path('package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

const outdirFlag = process.argv.indexOf('--outdir');
const outdir = outdirFlag < 0 ? path('dist') : resolve(process.argv[outdirFlag + 1] ?? '');
if (outdirFlag >= 0 && !process.argv[outdirFlag + 1]) throw new Error('--outdir needs a folder.');
// The build empties outdir, so inside the repo it may only be dist or a folder in dist or node_modules/.cache.
const inside = (dir: string) => !relative(path(dir), outdir).startsWith('..');
const ownedByBuild = inside('dist') || inside('node_modules/.cache');
if (inside('') && !ownedByBuild) throw new Error('--outdir must be outside the repo, or inside dist or node_modules/.cache.');
if (!relative(outdir, path('')).startsWith('..')) throw new Error('--outdir must not be the repo root or a folder that holds it.');
const holdsBuild = ['cli.js', 'templates/tagreeve-tag-reporter.tpl'].every((file) => existsSync(resolve(outdir, file)));
if (existsSync(outdir) && readdirSync(outdir).length > 0 && !holdsBuild) {
  throw new Error('--outdir must be empty, missing or a folder that holds a build (cli.js and templates/tagreeve-tag-reporter.tpl).');
}

const { build } = await import('esbuild');

// The root package does not depend on @tagreeve/*, so they are resolved from the sources.
const alias = Object.fromEntries(
  readdirSync(path('packages')).map((name) => [`@tagreeve/${name}`, path(`packages/${name}/src/index.ts`)]),
);

rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints: { cli: path('packages/cli/src/bin.ts') },
  outdir,
  splitting: true,
  chunkNames: '[name]-[hash]',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias,
  external: Object.keys(pkg.dependencies),
  banner: { js: '#!/usr/bin/env node' },
});
mkdirSync(resolve(outdir, 'rules'), { recursive: true });
cpSync(path('packages/consent/rules/fixture-site.json'), resolve(outdir, 'rules/fixture-site.json'));
mkdirSync(resolve(outdir, 'templates'), { recursive: true });
cpSync(path('packages/recorder/src/gtm-templates/web-tag-reporter.tpl'), resolve(outdir, 'templates/tagreeve-tag-reporter.tpl'));
chmodSync(resolve(outdir, 'cli.js'), 0o755);
