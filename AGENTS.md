# Working on Tagreeve

This file is for coding agents and the people who run them. It says how a change gets from an idea to `main`, and the rules every change follows.

The spec is [docs/design.md](docs/design.md). The product goals are [docs/goals.md](docs/goals.md). The current plan is `docs/plan-0.8.0.md`. Each plan PR updates this line. No sort order is used to find the plan. `docs/plan-site.md` is not a release plan. Read all three before you change code.

## Rules for every change

- **No real data.** Never put real personal data, real store data, real container IDs or secrets in the repo, an issue or a PR. Fixtures use fake identities and fake IDs only: GA4 `G-PWTEST0001`, Google Ads `AW-000000001`, Meta pixel `100000000000001`, GTM `GTM-PWTEST1` and `GTM-PWNOVER`.
- **The `gtmAuth` value or the container config**, in any form, never appears in a record, a log line, an error message or test output.
- **Payments and log-ins** are `handoff` steps for a person on any hosted site. Log-ins are never automated on a hosted site. One exception for payments: an opt-in `payment` step may type a payment provider's documented test card on a hosted store. It runs only when all three hold before anything is typed: the CLI flag `--allow-test-payment <host>` names the exact `--site` host, that host is in the user-level allowlist file, and the provider is in test mode. Test mode is either declared by the user for that host in the allowlist file (`{ "host": "<host>", "testMode": "<provider id>" }`), or, without a declaration, shown by the provider's marker inside the element that holds the card frames. Only values from the provider table are typed. Loopback hosts (`localhost`, `127.0.0.1`, `::1`), such as the fixture site, may be automated through payment as before.
- **No hosted service.** Everything runs on the user's machine. The opt-in server container feature runs the user's own container in the user's Docker, and the container downloads its configuration from Google as it always does. Tagreeve never calls the GTM API. The feature is opt-in. Tagreeve never publishes an image that holds Google's files, and the container config is a secret like `gtmAuth`.
- **GTM templates.** Tagreeve ships GTM templates as files. It never installs or publishes them, and they never send event data.
- **CLI only.** Tagreeve is a command-line tool. There is no MCP server and no other agent interface: agents run the CLI and read its `--json` output. Agent-facing improvements go into the CLI. This changes only with the maintainer's say-so (#362).
- **Tests stay local.** E2E tests run only against `fixtures/site` in `stub` mode. The one exception is a `server` mode test whose host is the fixture's own loopback host, with or without the fixture's stand-in server container. No test needs Docker or the network. Never use a real store as an e2e target.
- **Browser.** Use context-level hooks only (`context.route`, `context.on('request')`, `context.addInitScript`, `context.exposeBinding`). Send a normal Chrome user agent, never one containing `HeadlessChrome`. No browser flags in the default launch. `--net-log` (opt-in) adds Chromium's `--log-net-log`, and nothing else uses a CDP session or a flag. CDP auto-attach on every target was measured and does not see unload-time requests (design §5.3).
- **Third-party code.** `@duckduckgo/autoconsent` (MPL-2.0) is an unmodified dependency. Never copy or patch its files. Tracker Radar, EasyPrivacy and Disconnect are not sources: never ship them or derive tracker entries from them. Tracker entries link to the vendor's own docs.
- **Releases.** The maintainer's merge of a version bump is the say-so for a release: CI publishes it. No agent runs `npm publish`, pushes a tag, starts the release workflow or reruns a job of it, and none creates a GitHub release. Never force-push `main`.

## Toolchain

- Node 22.18 or newer for the CLI. The docs site and `pnpm typecheck` need Node 22.22 or newer. pnpm 10.34.7 through corepack (`COREPACK_ENABLE_DOWNLOAD_PROMPT=0`).
- Playwright 1.64.1 exactly. `@duckduckgo/autoconsent` 16.51.0 exactly.
- New dependencies get an exact version that is at least two weeks old.
- Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`. For the docs site (`site/`, built with Astro and Starlight): `pnpm docs:build`, `pnpm docs:test`, and `pnpm docs:preview` to look at it.
- The home page demo and command panels show recorded runs in `site/demo/`. After a change to the CLI output they show, rerun `pnpm build && node --experimental-transform-types scripts/record-site-demo.ts` and commit the result. The replies in `site/demo/*.reply.md` are hand-written. The docs build fails when one cites a number or ID the record lacks.
- Browsers can fail to launch inside an agent's command sandbox. Run browser commands outside it.

## Writing

- Docs, commits and PR text use plain, short sentences.
- Code comments are rare. Write one only for a reason the code can't show: why it is this way, a hidden constraint, or a property a refactor must keep. Design reasoning goes in the PR.
- Diagrams are Mermaid code blocks (` ```mermaid `) in the markdown, with a one-line text summary under each. No images of diagrams.
- Match the style of the code around you.

## Gated paths

`.github/pipeline.json` lists the paths an agent never merges. A PR that touches one is merged by the maintainer. The list holds the goals, the plans, the design doc, this file, the CI and agent settings, the dependency and build config, the release script and the payment allowlists. The file is the list: read it, not this summary.

`docs/goals.md` changes only in its own PR, merged by the maintainer.

## How a change is made

Each change is one PR on its own branch from `main`. Big work is split into a plan first (`docs/plan-*.md`): each entry has a **Touches** line and an **Acceptance** line. Entries in the same wave can touch the same file when they edit different parts of it, so they can be built in parallel. Entries that edit the same part stay in different waves, and the Touches line names the function or section for a shared file. A conflict at landing goes through the land fix, one PR at a time.

A plan is checked against the goals and non-goals in `docs/goals.md` before anything is built. An agent that finds an entry widening the product or touching a non-goal stops the plan and asks the maintainer. Only the maintainer changes product scope.

One issue with no plan can go through as a quick fix. A triage agent reads the issue, the code and the goals, and decides build, plan or decline. A fix that is large or high risk is not built this way: it needs a plan. A quick fix gets the same goals check and the same loop.

The loop is run by the agent-pr-pipeline plugin for Claude Code. Its settings for this repo are in `.github/pipeline.json`. CodeRabbit reviews a PR only on request (`.coderabbit.yaml`), so no agent waits for a review that nobody asked for.

Every PR goes through the same loop. Each step is a separate agent, so no agent checks its own work.

1. **Implement.** An agent builds the plan entry on its branch, with unit tests and the e2e test named in the Acceptance line. It runs every check until it passes, and makes sure the e2e test fails when the feature is broken. It pushes the branch. It does not open the PR.
2. **Test from a clean clone.** A second agent clones the branch fresh and runs `pnpm install --frozen-lockfile`, `pnpm exec playwright install chromium` (add `--with-deps` on a machine without the system libraries, as CI does), lint, typecheck, unit tests, the e2e tests the PR adds or changes and up to 10 related test files that name the touched modules. CI runs the full e2e suite. It checks that the acceptance test exists and really ran. It changes no code.
3. **Adversarial review.** A third agent, on a stronger model, reviews the diff against the design doc and the plan entry. It looks for bugs, spec drift, privacy and security problems, scope creep, broken rules, and tests that pass for the wrong reason. It ranks each finding as blocker, major or minor.
   When the plan entry has a QA line, a QA agent also uses the built feature like a user, at the same time, and reports what it ran, what it expected and what happened.
4. **Architecture review.** A separate agent on a stronger model checks the PR against the design doc. It runs in round 1, again after any fix round that changed code, and in every round of a plan PR. It lists the new concepts the PR introduces and says whether they fit. It ranks each finding as blocker, major or minor, so a minor stays a minor. If the PR can fix a finding, the fix agent fixes it. If the design itself should change to fit this and later work, it stops the PR and asks the maintainer, with options and a recommendation. Only the maintainer changes the design.
5. **Fix.** If the tests failed or there are blockers or majors, a fix agent fixes them on the same branch, adding commits, never force-pushing. If it thinks a finding is wrong, it says why, with evidence. Then steps 2 and 3 run again, and step 4 runs again under its rule. The loop stops when there are no blockers or majors, or after four rounds, when a person decides. Blockers or majors on the same theme in two rounds also stop the PR for the maintainer.
6. **Minor pass.** When a code PR is clean and has minor findings in files the PR already changes, one fixer pass runs before the docs step. It never changes `.github`, `.claude`, `AGENTS.md`, `CLAUDE.md` or `docs/goals.md`, and it skips any minor that needs a design choice. A tester and a reviewer check only the commits of the pass. If the tests fail or the reviewer reports a blocker or major, the pass is dropped with a new revert commit, and the PR goes on. There is no second pass. Plan and docs PRs skip it.
7. **Docs.** When the code is clean, a docs agent updates every doc the change makes wrong or incomplete: `README.md`, `docs/` and the docs site in `site/`. It changes no code. If it changed anything, a clean-clone test and a docs review check the new head before the PR opens.
8. **Open the PR and handle the bots.** An agent opens a ready PR that says how it was tested and how many review rounds it took, with one line for each minor the pass fixed, and lists every untested item. It posts one checklist comment for every minor not fixed. It files a GitHub issue with the label `review-minor` only for a minor the reviewer marked as having a real effect. It waits for CI and the review bots (a bot that reviews only on request is asked for its review by the land step when it runs with `--review`), and replies on every bot thread: it fixes the point, or says why not. Code changed to answer a bot is tested and reviewed again by other agents before the PR can land.
9. **Merge safety and merge.** On the final head, a script checks the PR's changed files against the gated paths. For a PR the gate does not hold, a merge-safety agent on a stronger model decides `safe` or `person`: `person` for a public interface change the plan entry does not name, a high-risk quick fix, or anything it cannot judge. Agents merge only a PR that passed both and has no untested item. The maintainer merges every other PR. A PR is merged when CI passes on the head commit and a review bot has approved it, had its comments answered and raised nothing new on the head, or has completed a clean review of the head that was asked for after the push. Merges are squash merges through the plugin's merge script, which runs the gate again. The branch is deleted only after GitHub shows the PR as merged.

PR bodies put each `Closes #N` on its own line. GitHub closes only the first issue on a line like `Closes #1, #2`.

## Fixing review-minor issues

Open `review-minor` issues are fixed in batches between plan waves. Batches are grouped by the files they touch, so they can run in parallel. Each batch goes through the same loop as above. A batch that can't fully fix an issue leaves it open with a comment saying what is left.

## Releasing

The pipeline never releases Tagreeve: `autoRelease` is false in `.github/pipeline.json`. A release is made on the maintainer's say-so.

Releases are git tags with a built `dist/`. CI makes them: after a person merges a version bump to `main`, the `release.yml` workflow builds the release commit with `scripts/release.sh --at <sha> <version>`, pushes the tag, checks it and publishes to npm with trusted publishing. No agent publishes, pushes a tag, starts the release workflow or reruns a job of it. The details and the recovery steps are in `docs/release.md`. A release by hand uses `scripts/release.sh <version>` and is the maintainer's alone. After a release, run the check:

```bash
node scripts/check-npm-dist-tag.ts <version>
```

The check script exits non-zero unless npm serves the version under its dist-tag. Then check the tag installs:

```bash
npm i -g --install-links github:alfhen/tagreeve#v<version>
tagreeve --version
```

Release candidates (`-rc.N`) are field-tested on a real store before the final release. That is a supervised run in `stub` mode, outside the e2e suite, with a person at every payment and log-in handoff. A field test of a test payment is supervised by a person too, on a store the maintainer put in the allowlist.
