import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

// npm 10 runs the prepare script in pack even with --ignore-scripts, so pack a copy without scripts.
function packedPaths(): string[] {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: unknown };
  const dir = mkdtempSync(join(tmpdir(), 'package-files-'));
  try {
    const rest = { ...manifest };
    delete rest.scripts;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(rest));
    for (const entry of readdirSync(root)) {
      if (entry === 'package.json' || entry === 'node_modules' || entry === '.git') continue;
      cpSync(join(root, entry), join(dir, entry), { recursive: true });
    }
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'], {
      cwd: dir,
      encoding: 'utf8',
    });
    const [pack] = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
    return pack!.files.map((file) => file.path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the npm package lists the changelog, readme, license and package.json', () => {
  const paths = packedPaths();
  for (const path of ['CHANGELOG.md', 'README.md', 'LICENSE', 'package.json']) {
    expect(paths, path).toContain(path);
  }
});
