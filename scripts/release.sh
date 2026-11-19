#!/usr/bin/env bash
# Usage: scripts/release.sh [--no-tag | --at <sha>] <version>
# Builds a release commit with dist/ (and no build script) on a detached HEAD and tags it v<version>.
# The commit is reachable only from its tag and is never merged to main.
set -euo pipefail

tag=1
at=""
if [ "${1:-}" = "--no-tag" ]; then
  tag=0
  shift
elif [ "${1:-}" = "--at" ]; then
  if [ $# -lt 2 ]; then
    echo "usage: scripts/release.sh [--no-tag | --at <sha>] <version>" >&2
    exit 2
  fi
  at="$2"
  shift 2
fi
if [ $# -ne 1 ]; then
  echo "usage: scripts/release.sh [--no-tag | --at <sha>] <version>" >&2
  exit 2
fi
version="$1"

# Explicit digit lists: a [0-9] range can match non-ASCII digits in some locales.
if ! [[ "$version" =~ ^[0123456789]+\.[0123456789]+\.[0123456789]+(-rc\.[0123456789]+)?$ ]]; then
  echo "refusing: version must be X.Y.Z or X.Y.Z-rc.N, got '$version'" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing: the working tree is not clean" >&2
  exit 1
fi

# --no-tag runs in CI clones, where HEAD is a branch commit that is not on main.
if [ -n "$at" ]; then
  # CI builds the commit that triggered the run, which main may have moved past by now.
  git fetch -q origin main
  if ! [[ "$at" =~ ^[0123456789abcdef]{40}$ ]] || [ "$(git rev-parse HEAD)" != "$at" ]; then
    echo "refusing: HEAD is not $at" >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor "$at" origin/main; then
    echo "refusing: $at is not on origin/main" >&2
    exit 1
  fi
  if [ -n "$(git ls-remote --tags origin "refs/tags/v$version")" ]; then
    git fetch -q origin "refs/tags/v$version:refs/tags/v$version"
    if [ "$(git rev-parse "v$version^{commit}^")" != "$at" ]; then
      echo "refusing: tag v$version on origin is not built on $at" >&2
      exit 1
    fi
    echo "Tag v$version is already on origin, built on $at."
    exit 0
  fi
elif [ "$tag" = 1 ]; then
  git fetch -q origin main
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "refusing: HEAD is not origin/main" >&2
    exit 1
  fi
fi

current=$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')
if [ "$current" != "$version" ]; then
  echo "refusing: package.json version is $current, not $version" >&2
  exit 1
fi

name="${GIT_AUTHOR_NAME:-$(git config user.name || true)}"
email="${GIT_AUTHOR_EMAIL:-$(git config user.email || true)}"
if [ -z "$name" ] || [ -z "$email" ]; then
  echo "refusing: no git identity. Set user.name and user.email, or GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL." >&2
  exit 1
fi
# git guesses a missing committer or tagger from the hostname, so pin all of them.
export GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$name}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$email}"

pnpm install --frozen-lockfile
pnpm build

git checkout -q --detach
# npm runs a nested install for git dependencies whose scripts include build, which races with the outer global install.
npm pkg delete scripts.build
git add -f dist package.json
git commit -q -m "Release v$version" -- dist package.json

if [ "$tag" = 1 ]; then
  git tag -a "v$version" -m "Release v$version"
  echo "Tagged v$version. Publish it with:"
  echo "  git push origin v$version"
else
  echo "Built release commit $(git rev-parse HEAD) without a tag."
fi
