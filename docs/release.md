# Releasing

Releases are git tags. Each tag points at a commit that carries a built `dist/`. That commit is reachable only from its tag and is never merged to main. CI builds, tags and publishes it. A person only merges the release-prep PR.

## How a release runs

1. Bump `version` in `package.json` and merge the change to main. The merge is the release decision. `package.json` is a gated path, so a person merges it.
2. The push to main starts the `release` workflow (`.github/workflows/release.yml`). It has no other trigger, no manual start and no dry-run path. Runs queue one at a time.
3. `plan` compares `package.json` at the commit before the push and at the pushed commit, so a push of several commits still counts the bump. `scripts/release-plan.ts` prints one line: `release <version> <dist-tag>`, or a `skip:` line. It skips when the version did not change and is on npm, when the version is already on npm, and when the tag `v<version>` is already on the remote. It stops the run on a version that is not `X.Y.Z` or `X.Y.Z-rc.N`, on a version lower than before, and on a failed `npm view`.
4. `tag` runs `scripts/release.sh --at <sha> <version>` as the `github-actions[bot]` identity and pushes the annotated tag `v<version>`. `--at` builds the commit that started the run even when main has moved on, if that commit is on `origin/main`. It also handles a rerun: when the tag is already on the remote and is built on that commit, it exits 0 and changes nothing.
5. `check` calls the `release-tag` workflow at the tag. It checks the tag against `package.json`, checks that the tag points at the tested commit, packs the tarball, installs it, runs `tagreeve --version` and a fixture scenario, and runs `npm publish --dry-run`.
6. `publish` runs only after `check` passed, in the GitHub environment `npm`. It installs npm 11.21.2, checks that npm is 11.21 or newer, and runs `scripts/release-plan.ts --guard`. The guard refuses to move a dist-tag backward, and prints `published` when the version is already on npm, which skips the publish. Otherwise it runs `npm publish --tag next` for a release candidate (`-rc.N`) or `npm publish --tag latest` for a final release. There is no token. npm trusts the workflow through OIDC and adds provenance.
7. `verify` runs `node scripts/check-npm-dist-tag.ts <version>` up to 10 times, 30 seconds apart, because npm's view lags. It turns the run red unless npm serves the version under its dist-tag.

Then check the result yourself:

```bash
npm view tagreeve@<version> version
npm view tagreeve dist-tags --json
```

Install with `npm i -g tagreeve@next` (release candidate) or `npm i -g tagreeve` (final), and check the tag installs:

```bash
npm i -g --install-links github:alfhen/tagreeve#v<version>
tagreeve --version
```

## Settings

These are the maintainer's. No pull request changes them.

- npmjs.com, package `tagreeve`, trusted publisher: GitHub Actions, repository `alfhen/tagreeve`, workflow `release.yml`, environment `npm`. The publisher must allow `npm publish` and dist-tag changes.
- GitHub, environment `npm`: deployment branches limited to `main`. `publish` runs in a push run on `main`, so `main` alone is enough.
- After the first CI publish works, turn on "disallow tokens" on npmjs.com.

npm 11.21 or newer is needed for trusted publishing with dist-tag changes. The workflow installs one pinned npm because the npm in Node 24 is older.

The first real publish is the first test of this setup, because `--dry-run` exchanges no token. If it fails, the tag is already pushed. Fix the setting and rerun the failed `publish` job.

## When a job fails

A rerun uses the workflow file of the original commit, so a bug in `release.yml` is not fixed by a rerun. It needs a new version bump, or the release by hand.

- `plan` red: read the message. A bad or lower version needs a new bump. A failed `npm view` is npm or the network, so rerun the run.
- `tag` red: rerun it. It is safe to rerun. It works after main has moved, because of `--at`, and it passes without changes when the tag is already on the remote.
- `check` red: the tag exists, so a new bump is needed for a real defect. A flaky step is fixed by a rerun.
- `publish` red or cancelled: npm may have accepted the version. Run `npm view tagreeve@<version> version` and `npm view tagreeve dist-tags --json` first. Then rerun `publish`. Its guard skips the publish when the version is there, and lets `verify` run. A wrong dist-tag is set by the maintainer by hand. Nothing else republishes. A guard that exits 2 means the dist-tag holds a higher version, so skip this version.
- `verify` red after a good publish: rerun `verify`, not `publish`.
- A cancelled release run: GitHub keeps one pending run, so a later push can cancel a pending release. Rerun the cancelled run. A later `package.json` push also does it, because `plan` plans a release for a version that is not on npm yet.

## Release by hand

Only the maintainer does this, when CI is down.

1. Check out main at the merge commit, with a clean tree. If CI already pushed the tag `v<version>`, run `git fetch origin tag v<version>`, check out the tag, check that it is built on the merge commit (`git rev-parse v<version>^{commit}^`), and skip to step 4.
2. Run `scripts/release.sh <version>`. It builds, then commits `dist/` and a `package.json` without the `build` script on a detached HEAD and creates the annotated tag `v<version>`. The commit and tag use the maintainer's identity (`user.name` and `user.email`, or `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL`).
3. Push the tag with the command the script prints, and wait for the `release-tag` workflow.
4. Publish from the tag commit with your own one-time password: `npm publish --tag next` for a release candidate, or `npm publish --tag latest` for a final release. Then run `node scripts/check-npm-dist-tag.ts <version>`.

A by-hand publish has no provenance.

## The script

`scripts/release.sh` refuses to run if `<version>` is not `X.Y.Z` or `X.Y.Z-rc.N` (ASCII digits only), if the tree is dirty, or if `package.json` does not match `<version>`. Without `--at` it also refuses when HEAD is not origin/main. With `--at <sha>` it requires HEAD to be that SHA and the SHA to be on origin/main. It does not push and it does not create a GitHub release.

The release commit drops the `build` script because npm runs a nested install for git dependencies that have one, and that install races with the outer one.

CI runs `scripts/release.sh --no-tag` in a temporary clone and installs the result, so a broken release commit shows up before a tag exists.

## Public Suffix List

The `serverHosts` check and the first-party check use the Public Suffix List that ships inside `tldts`. Nothing fetches it at run time. Before each release, bump `tldts` in the root package, `packages/recorder` and `packages/expect` to the newest version that is at least two weeks old. A bump needs no code change.
