import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findDeadLinks, findExternalRefs } from './check-docs-dist.ts';

describe('findExternalRefs', () => {
  it('passes local references', () => {
    const html = '<script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/a.css"><a href="https://github.com/x">x</a>';
    expect(findExternalRefs('a.html', html)).toEqual([]);
  });

  it('flags an external script src', () => {
    expect(findExternalRefs('a.html', '<script src="https://cdn.example.com/a.js"></script>')).toHaveLength(1);
  });

  it('flags an external stylesheet href', () => {
    expect(findExternalRefs('a.html', '<link rel="stylesheet" href="//cdn.example.com/a.css">')).toHaveLength(1);
  });

  it('flags an external CSS url()', () => {
    expect(findExternalRefs('a.css', '@font-face{src:url(https://cdn.example.com/f.woff2)}')).toHaveLength(1);
    expect(findExternalRefs('a.css', 'a{background:url(/local.png)}')).toEqual([]);
  });

  it('flags a quoted external CSS @import', () => {
    expect(findExternalRefs('a.css', '@import "https://cdn.example.com/theme.css";')).toEqual(['@import https://cdn.example.com/theme.css']);
    expect(findExternalRefs('a.css', "@import './local.css';")).toEqual([]);
  });

  it('flags the preload stylesheet form', () => {
    expect(findExternalRefs('a.html', '<link rel="preload stylesheet" href="https://evil.example.com/a.css" as="style">')).toHaveLength(1);
    expect(findExternalRefs('a.html', '<link rel="preload stylesheet" href="/assets/a.css" as="style">')).toEqual([]);
  });

  it('flags srcset, modulepreload and icon links', () => {
    expect(findExternalRefs('a.html', '<source srcset="/a.png 1x, https://evil.example.com/b.png 2x">')).toHaveLength(1);
    expect(findExternalRefs('a.html', '<link rel="modulepreload" href="https://evil.example.com/a.js">')).toHaveLength(1);
    expect(findExternalRefs('a.html', '<link rel="icon" href="https://evil.example.com/a.ico">')).toHaveLength(1);
  });

  it('flags Google Fonts anywhere', () => {
    expect(findExternalRefs('a.js', 'x="fonts.googleapis.com"')).toEqual(['fonts.googleapis.com']);
  });
});

describe('findDeadLinks', () => {
  const files = new Set(['index.html', 'docs/cli.html', 'docs/guide/first-run.html', 'favicon.ico', '_astro/app.js']);
  const pages = (firstRun: string) =>
    new Map([
      ['index.html', '<a href="/docs/cli">CLI</a>'],
      ['docs/cli.html', '<h2 id="exit-codes">Exit codes</h2><h2 id="85-what-the-server-container-sends-on">8.5</h2>'],
      ['docs/guide/first-run.html', firstRun],
    ]);

  it('passes good page links, fragments, assets and outside links', () => {
    const html =
      '<link rel="icon" href="/favicon.ico"><script src="/_astro/app.js"></script><h2 id="install">Install</h2>' +
      '<a href="/docs/cli#exit-codes">a</a><a href="../cli#85-what-the-server-container-sends-on">b</a>' +
      '<a href="#install">c</a><a href="/">d</a><a href="https://github.com/alfhen/tagreeve/blob/main/LICENSE">e</a>' +
      '<a href="mailto:x@example.com">f</a><script>const t = \'<a href="/nowhere">\';</script>';
    expect(findDeadLinks(pages(html), files)).toEqual([]);
  });

  it('reports a link to a page that was not built', () => {
    expect(findDeadLinks(pages('<a href="/docs/does-not-exist">x</a>'), files)).toEqual([
      'docs/guide/first-run.html: /docs/does-not-exist (no such page or file)',
    ]);
  });

  it('reports a fragment that is not on the target page', () => {
    expect(findDeadLinks(pages('<a href="/docs/cli#_8-5-what-the-server-container-sends-on">x</a><a href="#nope">y</a>'), files)).toEqual([
      'docs/guide/first-run.html: /docs/cli#_8-5-what-the-server-container-sends-on (no #_8-5-what-the-server-container-sends-on on /docs/cli)',
      'docs/guide/first-run.html: #nope (no #nope on /docs/guide/first-run)',
    ]);
  });
});

describe('CLI', () => {
  const script = fileURLToPath(new URL('./check-docs-dist.ts', import.meta.url));
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'check-docs-dist-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const makeDist = (name: string, html: string): string => {
    const dir = join(root, name);
    mkdirSync(dir);
    writeFileSync(join(dir, 'index.html'), html);
    return dir;
  };
  const bad = makeDist('bad', '<script src="https://cdn.example.com/a.js"></script>');
  const needle = ['import', 'meta', 'main'].join('.');
  const run = (entry: string, dist: string) => spawnSync(process.execPath, [entry, dist], { encoding: 'utf8' });

  it('exits 1 and names the external reference', () => {
    const r = run(script, bad);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('external reference(s)');
  });

  it('exits 1 when started through a symlink', () => {
    const link = join(root, 'link.ts');
    symlinkSync(script, link);
    const r = run(link, bad);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('external reference(s)');
  });

  it('exits 1 on a runtime without the entry flag, by path and through a symlink', () => {
    const dir = join(root, 'noflag');
    mkdirSync(dir);
    const copy = join(dir, 'check-docs-dist.ts');
    writeFileSync(copy, readFileSync(script, 'utf8').replaceAll(needle, 'undefined'));
    const link = join(dir, 'link.ts');
    symlinkSync(copy, link);
    for (const entry of [copy, link]) {
      const r = run(entry, bad);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('external reference(s)');
    }
  });

  it('exits 1 on a dead internal link', () => {
    const r = run(script, makeDist('dead', '<a href="/nowhere">x</a>'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('dead internal link(s)');
  });

  it('exits 0 on a clean dist', () => {
    const r = run(script, makeDist('good', '<p>hi</p>'));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('no script relies on the runtime entry flag', () => {
    const users = readdirSync(scriptsDir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(join(scriptsDir, f), 'utf8').split('\n').some((l) => !l.trim().startsWith('//') && l.includes(needle)));
    expect(users).toEqual([]);
  });
});
