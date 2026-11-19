#!/usr/bin/env bash
# Usage: scripts/bump-version.sh <version>
# Sets the version in package.json and in the README, docs/cli.md and docs/design.md lines that name it.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: scripts/bump-version.sh <version>" >&2
  exit 2
fi
version="$1"

# Explicit digit lists: a [0-9] range can match non-ASCII digits in some locales.
if ! [[ "$version" =~ ^[0123456789]+\.[0123456789]+\.[0123456789]+(-rc\.[0123456789]+)?$ ]]; then
  echo "refusing: version must be X.Y.Z or X.Y.Z-rc.N, got '$version'" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

# The script comes on stdin, with no argument: release-plan.ts treats argv[1] as its own entry check.
BUMP_VERSION="$version" node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const next = process.env.BUMP_VERSION;
const refuse = (message) => {
  console.error(`refusing: ${message}`);
  process.exit(1);
};

// Same comparison as release-plan.ts, so there is one ordering rule.
const { compareVersions } = await import(pathToFileURL('scripts/release-plan.ts').href);

const pkgText = readFileSync('package.json', 'utf8');
const current = JSON.parse(pkgText).version;
if (compareVersions(next, current) <= 0) refuse(`${next} is not higher than the current version ${current}`);

const isFinal = !next.includes('-rc.');
const versionText = /`\d+\.\d+\.\d+(?:-rc\.\d+)?`/;
const edits = [];
const edit = (file, change) => {
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  if (after === before) refuse(`${file} has no line to change`);
  edits.push([file, after]);
};

const pkgPattern = /^(\s*"version":\s*)"[^"\n]*"/m;
if (!pkgPattern.test(pkgText)) refuse('package.json has no version line');
edits.push(['package.json', pkgText.replace(pkgPattern, `$1"${next}"`)]);

edit('README.md', (text) => {
  const status = /^> \*\*Status:.*$/m;
  if (!status.test(text)) refuse('README.md has no Status line');
  return text.replace(status, (line) => line.replace(versionText, `\`${next}\``));
});

edit('docs/cli.md', (text) => {
  const pattern = /The current (release candidate|release) is `[^`]*`\.(?: The newest final release is (\d+\.\d+\.\d+)\.)?/;
  const found = text.match(pattern);
  if (!found) refuse('docs/cli.md has no current-release sentence');
  const wasFinal = found[1] === 'release';
  const newestFinal = isFinal ? next : wasFinal ? current : found[2];
  const tail = newestFinal === undefined ? '' : ` The newest final release is ${newestFinal}.`;
  const head = isFinal ? `The current release is \`${next}\`.` : `The current release candidate is \`${next}\`.`;
  return text.replace(pattern, `${head}${tail}`);
});

edit('docs/design.md', (text) => {
  const lines = text.split('\n');
  const line3 = /^(Status: revision \d+, for release )\d+\.\d+\.\d+(?:-rc\.\d+)?\./;
  if (!line3.test(lines[2] ?? '')) refuse('docs/design.md line 3 is not "Status: revision N, for release <version>."');
  lines[2] = lines[2].replace(line3, `$1${next}.`);
  return lines.join('\n');
});

for (const [file, text] of edits) {
  writeFileSync(file, text);
  console.log(`changed ${file}`);
}
console.log(`Version is now ${next}. Still to write by hand: the CHANGELOG.md section, the README "In ${current}" line and the docs/design.md section 15 milestone line.`);
JS
