import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

test('the npm package lists the changelog, readme, license and package.json', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'], { cwd: root, encoding: 'utf8' });
  const [pack] = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
  const paths = pack!.files.map((file) => file.path);
  for (const path of ['CHANGELOG.md', 'README.md', 'LICENSE', 'package.json']) {
    expect(paths, path).toContain(path);
  }
});
