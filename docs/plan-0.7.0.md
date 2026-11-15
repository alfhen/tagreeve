# Plan for 0.7.0

0.7.0 is a polish release for tracking quality. It adds a plain GTM demo shop to the fixture site, so every new check is tested on a site with no platform as well as on the fake Shopify store. It adds three checks that work on any GTM site: rules on dataLayer pushes (#936), a warning for a test identity pushed before consent (#1392), and a warning when the GA4 client ID changes on the way into a checkout frame or onto a checkout host (#934). It fixes the Consent Mode setup check for consent commands pushed as a plain object (#1401) and the epoch-move matching of `diff` (#1457). It also clears the docs and chores left after 0.6.2. Each item is one PR. A PR is done when its acceptance test passes in CI, an adversarial review reports no blockers or majors, and it is squash-merged.

0.7.0 starts from `main` after the goals change (`7203f86`, "docs: goals: keep the core platform-neutral, Shopify as an addition (#1502)").

## Goals this release serves

From `docs/goals.md`:

- **Keep the core platform-neutral.** S11 adds a plain GTM demo shop with no Shopify page, host, name or frame. D11, I11, H11 and K11 each get one test case on a page with no platform. S11 marks the checks that are Shopify-specific today (`sandboxPageUrl`, `platformHosts`) as such in the docs.
- **Express expected behaviour as data, and report pass or fail with evidence.** D11 lets a scenario state which pushes must or must not happen, with which key paths and types (#936).
- **Be safe by default.** I11 warns when the run's own test email or phone, or their hashes, reach the dataLayer before consent (#1392). No message ever holds the value.
- **Record what a site sends to each tracking vendor, at each consent state.** K11 finds a `consent default` pushed as a plain object (#1401). H11 shows when the GA4 client ID does not carry over into a checkout (#934).
- **Compare two runs, or a run against a saved baseline.** E11 keeps a cross-epoch join that `pairNames` made (#1457).
- **Expose all of this to agents through the CLI, with stable `--json`.** New results and rule kinds are additive. The record stays at schema version 5.

Non-goals this release comes close to:

- **A second interface.** Unchanged. Every change is in the CLI and its `--json`.
- **Explaining why a tag did not fire.** H11 reports that IDs differ and where, not why.
- **Legal advice.** I11 warns; people decide what is allowed.

## Triage

Each issue was checked against `main` at `7203f86` by read-only agents on 2026-11-15. Results:

| Issue | Kind | Status on main | Entry | Where in the code |
| --- | --- | --- | --- | --- |
| #936 | feature | Open. `parseRule` refuses a `dataLayer` key. | D11 | `Rule` and `parseRule` in `packages/expect/src/scenario.ts`; `pushShapes` and its helpers in `push-shape.ts`; `Context`, `evaluateRuleHits`, `evaluateRule` and the `scoped` line of `evaluate()` in `evaluate.ts` |
| #1392, #937 | feature | Open. Design §13 says a test identity pushed before consent is not checked. The first half of #937 shipped in 0.6.1 (L09). | I11 | `ownValues` and `candidates` in `packages/core/src/identity.ts`; `BUILTIN_NAMES` in `scenario.ts`; `DEFAULT_SEVERITY` and `builtInChecks` in `evaluate.ts` |
| #934 | feature | Open. The GA4 decoder keeps `ids.client_id` as a flag only; the value is read from the request. H11 adds a `ga4HitIds` reader to the GA4 decoder, so no second parser exists. | H11 | `packages/decoders/src/ga4.ts` (`eventLines`); new `packages/expect/src/id-handover.ts`; `BUILTIN_NAMES`, `DEFAULT_SEVERITY`, `builtInChecks` |
| #1401 | bug | Open. `consent-mode-setup.ts:90` accepts only `isConsentCommand` pushes. `push-shape.ts` already reads the object form privately (`argumentsLike`, `commandOf`, `isObjectConsent`). | K11 | `consentModeSetup` in `packages/expect/src/consent-mode-setup.ts`; `argumentsLike`, `isObjectConsent` and `commandLabel` in `push-shape.ts`; a new helper in `packages/core` |
| #1457, #1465 | bug, cleanup | Open. Two greedy matchers: `pairNames` picks a join target, and the gone loop of `diffPushes` matches again without it. `diff.ts:8` still re-exports `PushGroup`. | E11 | `pairNames` and the gone loop of `diffPushes` in `packages/expect/src/diff.ts`; `diff.test.ts` |
| #1498 | test | Open. `rawRequest` in `identity-values.test.ts` uses a fresh ULID, whose time prefix can hold `123`. | X11 | `rawRequest` and `withHeaders` in `packages/expect/src/identity-values.test.ts` |
| #1453 | test | Open, still on milestone 0.6.2. | X11 | the strip regex of `unsafeFileTargets` in `scripts/server-container-guide.docs.test.ts` |
| #1275 | chore | Due since 2026-11-10. | X11 | `pnpm-workspace.yaml` |
| #1483, #1490, #1491, #1492, #1493, #1494, #1495, #1496 | docs | Open. #1483 changed meaning: after #1487 every card field shares the step deadline, so the line should say "at the step deadline". | C11 | released `## 0.6.2` section of `CHANGELOG.md`; `README.md` line 20; `docs/cli.md` line 168; `scripts/docs-text.docs.test.ts` line 200 |
| Plain GTM fixture | fixture | Every fixture page with a checkout is a Shopify page (`site.js` always injects the `/web-pixels@` sandbox). The plain pages are single-page cases with no journey. | S11 | new `fixtures/site/public/plain/`; the page map in `fixtures/site/src/index.ts`; `fixtures/site/README.md` |

## Close without a PR

- **#1486.** Covered by #1500 (`150ee39`): the build no longer refuses an old or partial default `dist`. Folders inside `dist` and `node_modules/.cache` stay refused, as #1500 decided.
- **#1489.** The "Eight other" line was never on `main`; the Known line reads "Other `review-minor` issues are open".
- **#922.** Every part is built, planned here, or moved to the Backlog. It closes when this plan merges, as the milestone says.

## Decisions

Decided by the maintainer on 2026-11-15:

1. **A plain GTM demo shop comes first.** S11 adds a local, offline shop inside the fixture site with a stand-in GTM container and a stand-in consent banner with Consent Mode: product, own checkout, thank-you. It has no Shopify page, host, name or frame. The checks of this release get their plain-GTM test case there.
2. **#934 is a general check, `idHandover`.** It covers any checkout in a frame or on another host, the Shopify sandbox included. It is not marked Shopify-specific.
3. **#1392 warns by default.** A scenario can set it to `fail`. There is no field count of `possibleRealDataPush` yet, so that flag stays warn-only too.
4. **The docs and chores left after 0.6.2 are in.** C11 and X11.

Decided in this plan:

- **The record stays at schema version 5.** No entry adds a record field. New built-in names and the `dataLayer` rule kind are additive in `--json`.
- **S11 needs no network.** The shop serves its own stand-in for `gtm.js` and `gtag.js`. It sends GA4 and Google Ads image hits to the Google collection hosts that `stub` mode answers, and pushes `gtag('event', 'purchase', ...)` with an `ecommerce` object. The banner is `assets/banner.js`, with a Consent Mode default of denied and an update on the banner answer.
- **S11 marks Shopify-specific checks in the docs only.** `sandboxPageUrl`, `platformHost` and `options.platformHosts` get a "Shopify-specific" mark in `docs/cli.md` and `docs/guide/what-it-checks.md`, and design §11 says how platform-specific checks are marked. No `platform` field goes into `--json`.
- **D11 syntax.** A rule has a `dataLayer` mapping: `{ event, has: [paths], types: { path: type }, kind, frame }`. `before`, `in`, `after`, `from` and `count` stay at rule level, as for `tag:`. Paths are the masked form that `--json` shows (`items[*].item_id`), with the `body.has` globs. A numbered index such as `items[3]` exits 2 with a hint to write `[*]`. Event names are as recorded, with no Shopify-to-GA4 mapping. An event name that reads `(other)` in the shapes exits 2.
- **D11 semantics.** `must` with `has` passes when at least the counted pushes of that event in scope hold every listed path. `mustNot` with `has` passes when no push of that event in scope holds any listed path. `types` holds when every matching push has exactly that type at the path. A `dataLayer` rule mixed with a hit filter, a `body.*` key or `vendor` exits 2. A `dataLayer` rule never gets `serverSendProbableLink` or `serverSendUnlinked`. When the dataLayer hook is incomplete in scope (`dataLayerIncomplete` or `dataLayerNotHooked`), a `mustNot` that would pass warns that the pushes could not all be read.
- **I11 is a built-in named `earlyIdentityPush`.** It reads stored records, so it also runs on `evaluate` of an old run. It looks at pushes in an `undecided`, `denied` or `withdrawn` epoch, and in a `mixed` epoch where `ad_user_data` or `analytics_storage` is denied, using the existing grace window. It matches the run identity's email and phone, their hashes, and the `extra` emails and phones. With no identity in the record it passes with the message that it could not check. It runs before the `possibleRealData` block, which returns early when there is no identity.
- **H11 compares the GA4 client ID, then the session ID.** Hits are grouped by GA4 measurement ID (`tid`). A context is the frame kind plus the page host, so a frame checkout and a checkout on another host both count. `sid` is compared only where `cid` matches. Hits with `analytics_storage` denied (`gcs` `G100` or `G1-0`) are left out, because cookieless pings rotate `cid`. Server container hits and hits without `cid` are left out. A run with one context passes. Click IDs (`gclid`, `fbc`, `fbp`) wait for the Backlog; H11 files that issue. Default severity `warn`.
- **K11 changes the Consent Mode setup check only.** `@tagreeve/core` exports `consentCommandOf(args)`, which reads the array form and the arguments-like object form. `consentModeSetup` and `push-shape.ts` both use it. `consentModeChanges` in `packages/consent/src/consent-mode.ts`, which feeds the epochs, is not changed in 0.7.0: changing it moves epochs and verdicts. K11 files that as a new issue for the Backlog.
- **E11: a cross-epoch join is binding.** `pairNames` returns the target epoch of each join (`joinedTo`). `diffPushes` first gives each joined node exactly the fresh node at (`joinedTo`, event, kind, frame), then runs the greedy pass on the rest. The greedy order for same-name moves with no join stays as it is and is written down as a known limit. No `--json` field changes.

## Order and waves

```mermaid
flowchart LR
  W1["Wave 1: S11, E11, X11, C11, K11"] --> W2["Wave 2: D11, I11"]
  W2 --> W3["Wave 3: H11"]
  W3 --> R["R17: release prep"]
```

The demo shop, the fixes and the chores first; then the two checks that need the shop; then the second built-in; then the release prep.

Why the waves are this way:

- **S11 first.** D11, I11 and H11 put their plain-GTM test case on the S11 shop.
- **`packages/expect/src/scenario.ts` and `evaluate.ts`.** D11 owns `Rule`, `parseRule`, a new `parsePushSelector`, `Context`, `evaluateRuleHits`, `evaluateRule` and the `scoped` line of `evaluate()`. I11 owns `BUILTIN_NAMES`, `DEFAULT_SEVERITY` and a new function in `builtInChecks`. Different parts, so both are in wave 2. H11 edits the same parts as I11 (`BUILTIN_NAMES`, `DEFAULT_SEVERITY`, `builtInChecks`), so it is in wave 3.
- **`packages/expect/src/push-shape.ts`.** K11 (wave 1) changes `argumentsLike`, `isObjectConsent` and `commandLabel` to use the core helper. D11 (wave 2) exports a per-push shape built from `commandOf`, `eventLabel` and `collectPaths`, after K11 has merged.
- **`site/demo/`.** I11 and H11 each add a built-in, which the recorded demo runs list. Each re-records them with `scripts/record-site-demo.ts`. They are in different waves.
- **`fixtures/site/src/index.ts`.** S11 adds the `/plain/*` routes in wave 1. D11 and I11 add one page each in wave 2 (different lines of the page map). H11 adds the `?checkout=offsite` variant of the S11 checkout in wave 3.
- **`fixtures/site/public/plain/checkout.html` and `assets/plain-gtm.js`.** I11 (wave 2) adds `?identity=early`; H11 (wave 3) adds `?checkout=offsite` and `?cid=rotate`. Different waves, different query modes.
- **`e2e/report-marks.e2e.test.ts`, `docs/guide/reading-results.md`, `scripts/site-docs.docs.test.ts`.** I11 and H11 each edit them for their own built-in, in different waves.
- **`docs/cli.md`.** C11 changes line 168 (the payment fill). K11 adds one sentence to the Consent Mode setup paragraph. S11 adds the Shopify-specific marks to the `builtins` rows. D11 adds a new section "Rules on dataLayer pushes" after "Rules on tags". I11 and H11 each add their `builtins` row and section. The parts differ within a wave.
- **`docs/design.md`.** S11, K11, D11, I11 and H11 each edit their own paragraph of §11; D11 and I11 edit §13; R17 writes §15.7.
- **`CHANGELOG.md`.** The plan PR adds the `## 0.7.0` block with all markers. Each entry replaces only its own marker. C11 also edits released lines of `## 0.6.2`, which no other entry touches.

## Rules for every PR

The rules in `AGENTS.md` and the earlier plans still hold: CLI only, no MCP server; no hosted service; fake IDs and identities only (`G-PWTEST0001`, `AW-000000001`, `100000000000001`, `GTM-PWTEST1`, `GTM-PWNOVER`); no cookie value, identity value, client ID, card value, `gtmAuth` or container config in any output; e2e only against `fixtures/site` in `stub` mode (and the stand-in container), with no Docker and no network; context-level hooks only; third-party code unmodified, and no tracker data from Tracker Radar, EasyPrivacy or Disconnect. The record schema stays at version 5.

More for 0.7.0:

- **Each PR adds a regression test that fails without the change,** and the PR description says which line was reverted to see it fail. A test-only issue names the mutation the strengthened test now catches. A cleanup with no behaviour change names the existing tests that must pass unchanged.
- **Every negative test checks first that its input holds what the check looks for.** A leak check first asserts the value is in the input or the record, then asserts it is absent from the output.
- **A statement that something does not happen is tested as the positive case with one change.** For example, I11's "a foreign email gives no finding" is paired with the same page and the run's own email, which does give one.
- **Each new check gets a test case on the S11 plain GTM shop.** A check that also has a Shopify case keeps it on the existing shop pages.
- **A check that works on one platform only is marked as such** in `docs/cli.md` and `docs/guide/what-it-checks.md`. The checks of this release are general and get no mark.
- **State the invariant first when a fix touches a function with several cases.** Write the rule in the PR, then a table test over the cases, then patch. This holds for E11 (`pairNames` and `diffPushes`) and D11 (`parseRule`).
- **A new default-warn check lists every test it changes (maintainer, 2026-11-15).** An entry that adds a check which warns by default names in its Touches, before the plan merges, every existing test whose expected results it changes, found by a search of the code (for example `git grep -nE 'toEqual\(\[SANDBOX\]\)|!== SANDBOX' e2e`). It changes only those assertions, and the new warning stays visible in them.
- **Never edit a file outside the Touches line.** A flaky test is reported, not patched. Known flaky: the second test of `e2e/unload-gap-frame-nav.e2e.test.ts`.
- **Page code is untrusted, but not an unbounded adversary** (#1442). Reviewers do not escalate a page that sabotages its own globals.
- **Reviewers file only bugs, leaks and wrong docs.** In-file nits go to the minor pass.
- **New e2e tests go in new files,** unless the entry names an existing file.
- **A message names a key by its masked path or a fixed label,** never by a value from a file or a page.
- **CHANGELOG.** Each PR replaces only its own marker. An entry with no change a user can see replaces its marker with one line that lists its issues, for the "Tests and cleanup" line R17 writes.

## PRs

### Wave 1

**S11 Plain GTM demo shop and Shopify-specific marks.** Round cap 4. Touches: new `fixtures/site/public/plain/product.html`, `fixtures/site/public/plain/checkout.html`, `fixtures/site/public/plain/thank-you.html`, new `fixtures/site/public/assets/plain-gtm.js` (the stand-in for `gtm.js` and `gtag.js`), the page map in `fixtures/site/src/index.ts` (the `/plain/*` routes), new `fixtures/site/src/pages-plain.test.ts`, `fixtures/site/README.md` (a new "Plain GTM pages" section), new `e2e/scenarios/plain-gtm-journey.yml`, new `e2e/plain-gtm.e2e.test.ts`, `docs/cli.md` (the `sandboxPageUrl` row and the `platformHosts` option), `docs/guide/what-it-checks.md` (the `sandboxPageUrl` and platform host entries), `docs/design.md` §11 (one paragraph on platform marks), `CHANGELOG.md` (the S11 marker).
- `/plain/product` loads `assets/banner.js` and `assets/plain-gtm.js`. Consent Mode starts denied. The banner answer pushes a `consent update`.
- `assets/plain-gtm.js` pushes `gtm.js` and page events to `window.dataLayer`, and sends GA4 hits (`tid=G-PWTEST0001`) and a Google Ads conversion (`AW-000000001`) to the Google collection hosts. It loads nothing from the internet.
- `/plain/checkout` is a form on the same host with the field IDs of the fake store's checkout. Submit goes to `/plain/thank-you`, which pushes `purchase` with an `ecommerce` object (`transaction_id`, `value`, `currency`, `items[*].item_id`) and sends a GA4 `purchase` hit.
- No page under `/plain/` holds `web-pixels`, `wpm@`, `myshopify`, `shopify` or a Shopify host, and none has an iframe.
- `docs/cli.md` and `docs/guide/what-it-checks.md` mark `sandboxPageUrl`, `platformHost` and `options.platformHosts` as Shopify-specific. Design §11 says a platform-specific check is marked in those two docs.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| S11-1 | behaviour | The plain journey runs with default `builtins` and exits 0, with no `sandboxPageUrl` or `platformHost` flag. | `pnpm exec vitest run --project e2e e2e/plain-gtm.e2e.test.ts`; the test reads the `--json` summary. |
| S11-2 | behaviour | The run records the purchase push with `ecommerce.transaction_id` and a GA4 `purchase` hit, both after the banner accept. | The same e2e test reads the records. |
| S11-3 | behaviour | `consentModeSetup` passes on the plain journey. | The same e2e test finds `builtin: consentModeSetup` with `pass`. |
| S11-4 | regression | No `/plain/` page holds a Shopify string or an iframe. | `pages-plain.test.ts` greps the served HTML and scripts for `web-pixels`, `wpm@`, `shopify` and `<iframe`. |
| S11-5 | error path | A request for a page that does not exist under `/plain/` returns 404. | `pages-plain.test.ts`. |
| S11-6 | behaviour | The docs mark `sandboxPageUrl` and `platformHosts` as Shopify-specific. | `pnpm docs:build`, then grep the built pages; `grep -n "Shopify-specific" docs/cli.md docs/guide/what-it-checks.md` lists both. |

Regression test: `e2e/plain-gtm.e2e.test.ts`, `fixtures/site/src/pages-plain.test.ts`.
Acceptance: `pnpm exec vitest run --project e2e e2e/plain-gtm.e2e.test.ts` passes, and fails on the old code because the `/plain/*` routes return 404.
QA: run `tagreeve run e2e/scenarios/plain-gtm-journey.yml --site <fixture url>` with accept and with reject, and read the summary and the HTML report.

**E11 `diff`: a cross-epoch join is binding (#1457, #1465).** Round cap 4. Touches: `pairNames` and the gone loop of `diffPushes` in `packages/expect/src/diff.ts`, the `PushGroup` re-export on `diff.ts:8`, `packages/expect/src/diff.test.ts` (the import line and a new four-label case), `CHANGELOG.md` (the E11 marker).
Closes #1457
Closes #1465
- `pairNames` records the target epoch of each cross-epoch join on the joined node (`joinedTo`).
- `diffPushes` first matches each joined gone node to exactly the fresh node at (`joinedTo`, event, kind, frame), then runs the greedy pass on the nodes left.
- A same-name move with no join keeps today's greedy order. The PR writes this down in the `diffPushes` docstring as a known limit.
- `diff.ts` no longer re-exports `PushGroup`. `diff.test.ts` imports it from `push-shape.ts`.
Invariants: A cross-epoch join that `pairNames` made is never undone by the gone loop. No `--json` field is added, removed or renamed.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| E11-1 | behaviour | With four epoch labels and two renamed events whose joins point to different neighbour epochs, `diffPushes` reports each move to the epoch `pairNames` chose. | `pnpm exec vitest run --project unit packages/expect/src/diff.test.ts`, the new case. |
| E11-2 | regression | Every existing `diff.test.ts` and `event-map.test.ts` case passes unchanged. | The same command, plus `packages/expect/src/event-map.test.ts`. |
| E11-3 | regression | `diff --json` output of the existing e2e diff files is unchanged. | `pnpm exec vitest run --project e2e e2e/diff.e2e.test.ts e2e/datalayer-diff.e2e.test.ts e2e/datalayer-renamed.e2e.test.ts`. |
| E11-4 | behaviour | `PushGroup` has one home. | `git grep -n "export type { PushGroup" packages/expect/src` prints nothing; `pnpm typecheck` passes. |
| E11-5 | error path | A joined node whose `joinedTo` target is missing among the fresh nodes falls back to the greedy pass and does not throw. | A unit case in `diff.test.ts`. |

Regression test: the four-label case of #1457 in `diff.test.ts`.
Acceptance: the new `diff.test.ts` case passes, and fails on the old code because the gone loop moves one renamed node to the other node's join target.

**X11 Tests and chores: request IDs, the placeholder strip and node-forge (#1498, #1453, #1275).** Round cap 2. Touches: `rawRequest` and `withHeaders` in `packages/expect/src/identity-values.test.ts`, the strip regex of `unsafeFileTargets` and its table rows in `scripts/server-container-guide.docs.test.ts`, `pnpm-workspace.yaml` (the `minimumReleaseAgeExclude` block), `CHANGELOG.md` (the X11 marker).
Closes #1498
Closes #1453
Closes #1275
- `rawRequest` uses a fixed request ID with no digits. The eight `possibleRealData` tests fail only when the phone digits leak.
- The strip regex takes a placeholder only after `name=` at a start, `?`, `&`, a space or a quote, and up to `&`, a quote or the line end. Two new rows (a quoted URL that ends in `<auth>`, and `id=<env id>&auth=<auth>`) give no targets.
- `pnpm-workspace.yaml` has no `minimumReleaseAgeExclude` block; `minimumReleaseAge: 20160` stays.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| X11-1 | regression | The eight `possibleRealData` tests pass when the request ID would have held `123`. | Temporarily give `rawRequest` the ID `req_01M7123QAAAAAAAAAAAAAAAAAA` on the old test: it fails; on the new test the fixed ID is used and the tests pass. `pnpm exec vitest run --project unit packages/expect/src/identity-values.test.ts`. |
| X11-2 | behaviour | A test still fails when the phone digits do leak into the message. | Mutate `evaluate.ts` to print the phone; the test fails. Restore. |
| X11-3 | behaviour | The two new placeholder rows give no unsafe targets. | `pnpm exec vitest run --project docs scripts/server-container-guide.docs.test.ts` after `pnpm docs:build`. |
| X11-4 | behaviour | `pnpm install --frozen-lockfile` passes without the node-forge exception. | Run it in a clean clone. |
| X11-5 | error path | A real unsafe target next to a placeholder is still reported. | The existing positive rows of the docs test pass. |

Acceptance: `pnpm test` passes with the fixed request ID, and the X11-1 mutation shows the old test failing on a `123` prefix.

**C11 Docs: the 0.6.2 notes, README and the payment deadline line (#1483, #1490 to #1496).** Round cap 2. Touches: the released `## 0.6.2` section of `CHANGELOG.md` (lines 5, 9, 14, 17, 18, 24, 28, 32 and the Upgrading section), `README.md` line 20, `docs/cli.md` line 168, `scripts/docs-text.docs.test.ts` line 200, `CHANGELOG.md` (the C11 marker).
Closes #1483
Closes #1490
Closes #1491
Closes #1492
Closes #1493
Closes #1494
Closes #1495
Closes #1496
- `docs/cli.md` line 168 says the fill ends "at the step deadline". Line 166 says "shares the step deadline" and stays.
- The 0.6.2 "Tests and cleanup" line no longer lists #1462, #1468, #1470, #1180 and #1181; each goes on the line that names its change. The PR checks each move against the commit.
- "A push finding with no path reads `in the push`" is its own `possibleRealDataPush` bullet.
- The 0.6.1 field-test sentence says "after its release".
- The warn-with-browser-hits line drops "With an exact count".
- The Upgrading section says the card fields share one step deadline, which a user cannot change.
- The #1456 line reads "A kind change does not report the `event` key path (#1456)." The docs test changes to that phrase in the same PR.
- `README.md` line 20 reads "A scoped `must` rule can now warn where 0.6.1 failed".
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| C11-1 | behaviour | `docs/cli.md` says "at the step deadline" for the card fill and no longer says "the deadline of the field's fill". | `grep -n "deadline of the field" docs/cli.md` prints nothing; `grep -n "at the step deadline" docs/cli.md` prints line 168 only, and `grep -n "shares the step deadline" docs/cli.md` prints line 166. |
| C11-2 | behaviour | The docs text test pins the new #1456 phrase. | `pnpm docs:build && pnpm exec vitest run --project docs scripts/docs-text.docs.test.ts`. |
| C11-3 | regression | `scripts/changelog-markers.test.ts` passes. | `pnpm exec vitest run --project unit scripts/changelog-markers.test.ts`. |
| C11-4 | error path | Putting the old #1456 phrase back makes the docs test fail. | Revert the CHANGELOG line only; the docs test fails. Restore. |

Acceptance: the docs project passes with the new phrase, and C11-4 shows it fails with the old one.

**K11 Consent Mode setup: consent commands pushed as an object (#1401).** Round cap 3. Touches: a new `consentCommandOf` in `packages/core/src` with its unit test and the `packages/core/src/index.ts` export, `argumentsLike`, `isObjectConsent` and `commandLabel` in `packages/expect/src/push-shape.ts`, `consentModeSetup` in `packages/expect/src/consent-mode-setup.ts` (line 90), `consent-mode-setup.test.ts` (the `dle` helper), `fixtures/site/public/consent-mode-hits.html` (a `?push=relay` mode), the consent-mode pages test in `fixtures/site/src`, `e2e/consent-mode-setup.e2e.test.ts` and a new `e2e/scenarios/consent-mode-setup-relay.yml`, `docs/cli.md` (one sentence in the Consent Mode setup paragraph), `docs/design.md` §11 (one sentence), `CHANGELOG.md` (the K11 marker).
Closes #1401
- `consentCommandOf(args)` returns the consent command for `['consent', 'default' | 'update', x]` and for `{0: 'consent', 1: 'default' | 'update', 2: x}`, and nothing for any other shape.
- `consentModeSetup` finds a `consent default` in either form. A relayed object-form default gives "found every signal set", not "outside the dataLayer".
- `push-shape.ts` uses the helper. Its labels and paths do not change.
- `isConsentCommand` on the record stays as recorded; no record field changes.
- `?push=relay` on `/consent-mode-hits` has a sandboxed child frame `postMessage` its `arguments`; the parent pushes `event.data`. This is a plain page with no Shopify parts.
- K11 files a new issue for `consentModeChanges` in `packages/consent/src/consent-mode.ts`, which still skips the object form for epochs.
Invariants: The helper accepts only `consent` with `default` or `update`. The check's verdict for an array-form push does not change.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| K11-1 | behaviour | The helper returns the same command for the array form and the object form. | `pnpm exec vitest run --project unit packages/core/src/` (the new test). |
| K11-2 | behaviour | A relayed object-form default passes the setup check. | `pnpm exec vitest run --project e2e e2e/consent-mode-setup.e2e.test.ts`, the relay case. |
| K11-3 | error path | `{0: 'consent', 1: 'foo'}` and `{0: 'config'}` are not consent commands. | The core unit test. |
| K11-4 | regression | `push-shape` labels and paths are unchanged. | `pnpm exec vitest run --project unit packages/expect/src/push-shape.test.ts` and `pnpm exec vitest run --project e2e e2e/datalayer-kinds.e2e.test.ts` pass unchanged. |
| K11-5 | regression | The relay push is recorded with `isConsentCommand: false`. | The e2e test reads the records. |

Acceptance: the relay e2e case passes, and fails on the old code because the message says `outside the dataLayer`.

### Wave 2

**D11 Rules on dataLayer pushes (#936).** Round cap 4. Touches: `Rule`, `parseRule` and a new `parsePushSelector` in `packages/expect/src/scenario.ts`; a new per-push shape export in `packages/expect/src/push-shape.ts` (built from `commandOf`, `eventLabel` and `collectPaths`; `pushShapes` output unchanged); new `packages/expect/src/push-rules.ts` and `push-rules.test.ts`; `Context`, `evaluateRuleHits`, `evaluateRule` and the `scoped` line of `evaluate()` in `packages/expect/src/evaluate.ts`; `packages/expect/src/index.ts` (exports); `scenario.test.ts` and `evaluate.test.ts`; new `e2e/datalayer-rules.e2e.test.ts` with `e2e/scenarios/datalayer-rules.yml` and `datalayer-rules-pass.yml`; `fixtures/site/public/datalayer-rules.html` (a purchase without `ecommerce.transaction_id`; `?complete=1` adds it), its line in the page map and its row in `fixtures/site/README.md`; a pages test; `docs/cli.md` (new section "Rules on dataLayer pushes" after "Rules on tags"), `docs/guide/what-it-checks.md`, the expectations section of `README.md`, `docs/design.md` §11 (rule table and filters) and §13 (privacy bullet), `CHANGELOG.md` (the D11 marker).
Closes #936
- A scenario rule can hold `dataLayer: { event, has, types, kind, frame }`, with `before`, `in`, `after`, `from` and `count` at rule level.
- `must` with `has` passes when the counted pushes of that event in scope hold every listed path; the result names the pushes by `dle_` ID.
- `mustNot` with `has` passes when no push of that event in scope holds any listed path.
- `types` holds when every matching push has exactly that type at the path.
- An unknown sub-key, a numbered index such as `items[3]`, a type outside string, number, boolean, null, object and array, or `dataLayer` mixed with a hit filter, a `body.*` key or `vendor` exits 2 and names the key.
- A `mustNot` that would pass while the dataLayer hook is incomplete in scope warns.
- One case runs on the S11 shop: `must` purchase with `ecommerce.transaction_id` passes on `/plain/thank-you`.
Invariants: No pushed value appears in any rule message or evidence. A path copied from a run's `--json` shapes matches that run. `before`, `in`, `after` and `from` select the same windows for pushes as for cookies. `mustNot` with no matching push in scope passes. A `dataLayer` rule never gets `serverSendProbableLink` or `serverSendUnlinked`.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| D11-1 | behaviour | `must` purchase with `has: [ecommerce.transaction_id]` exits 1 on `/datalayer-rules` and lists the push by `dle_` ID; with `?complete=1` it exits 0. | `pnpm exec vitest run --project e2e e2e/datalayer-rules.e2e.test.ts`. |
| D11-2 | behaviour | The same rule passes on the S11 `/plain/thank-you`. | The same e2e file, plain case. |
| D11-3 | behaviour | `mustNot` purchase with `before: consent` fails when the purchase is pushed before the banner answer, and passes with `after: <accept step>`. | The same e2e file. |
| D11-4 | error path | `items[3]`, type `int`, an unknown sub-key, and `dataLayer` with `vendor` each exit 2 and name the key. | `pnpm exec vitest run --project unit packages/expect/src/scenario.test.ts`. |
| D11-5 | behaviour | The fixture's sentinel values are in the push records and absent from stdout and the result messages. | The e2e test asserts the precondition on the JSONL, then the absence. |
| D11-6 | regression | The body, tag and cookie rule e2e files pass unchanged. | `pnpm exec vitest run --project e2e e2e/body-rules.e2e.test.ts e2e/cookie-rules.e2e.test.ts` and the tag rules file. |

Regression test: `push-rules.test.ts`, `scenario.test.ts`, `e2e/datalayer-rules.e2e.test.ts`.
Acceptance: `pnpm exec vitest run --project e2e e2e/datalayer-rules.e2e.test.ts` passes, and fails on the old code because `parseRule` refuses the `dataLayer` key and the run exits 2.
QA: write a rule from the `--json` shapes of a real run of the S11 shop and check it matches; try `items[3]`.

**I11 Test identity pushed before consent: `earlyIdentityPush` (#1392).** Round cap 3. Touches: a new export (`ownValueKinds`) in `packages/core/src/identity.ts` and `identity.test.ts`; `BUILTIN_NAMES` and the `builtins` docstring in `packages/expect/src/scenario.ts`; `DEFAULT_SEVERITY` (`warn`) and a new function in `builtInChecks` in `packages/expect/src/evaluate.ts`, placed before the `possibleRealData` block; `evaluate.test.ts`; the `BUILTIN_NAMES` assertion of the early-identifiers test; new `e2e/datalayer-identity-push.e2e.test.ts` with its scenarios; `fixtures/site/public/datalayer-identity.html` (`?after=1` pushes after the answer), its line in the page map and its row in `fixtures/site/README.md`; a pages test; `fixtures/site/public/plain/checkout.html` and `assets/plain-gtm.js` (`?identity=early` pushes the typed identity before the banner answer, and the default pushes it after accept) with `fixtures/site/src/pages-plain.test.ts`; `e2e/report-marks.e2e.test.ts` (the severity assertion also excludes `earlyIdentityPush`); `site/demo/*` (re-recorded); the builtin list in `site/src/lib/annotations.ts`; `docs/guide/reading-results.md` (the fence, its `Result:` line and the annotation lines stay in step) and `scripts/site-docs.docs.test.ts` (the pinned `Result:` line); `docs/cli.md` (the `builtins` row and a section), the `README.md` builtins list, `docs/design.md` §11 (builtins) and §13 (replace "Pushes are not checked for a test identity that was pushed before consent"), `CHANGELOG.md` (the I11 marker).
Closes #1392
Closes #937
- A push in an `undecided`, `denied` or `withdrawn` epoch, or in a `mixed` epoch with `ad_user_data` or `analytics_storage` denied, that holds the run's email or phone, a hash of them, or an `extra` email or phone, gives a `warn` result `builtin: earlyIdentityPush`.
- The result names the push by `dle_` ID, its key paths and the kind of value (email, phone, email hash, phone hash). It never holds the value.
- `builtins: { earlyIdentityPush: fail }` makes the result fail and the run exit 1.
- With no identity in the record the result passes with a message that it could not check.
- One case runs on the S11 shop: the plain checkout pushes the identity after accept and gives no finding; the same page with `?identity=early` gives one.
Invariants: No identity value or hash appears in any message, evidence or stdout. A push with only foreign values never gives this result (it stays `possibleRealDataPush`). A push in a granted epoch after the grace window never gives it. With no `builtins` override the exit code does not change.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| I11-1 | behaviour | An email push and an email-hash push before the banner answer give one `warn` result with `dle_` evidence, key paths and kinds; the run exits 0. | `pnpm exec vitest run --project e2e e2e/datalayer-identity-push.e2e.test.ts`. |
| I11-2 | behaviour | The email and its hex hash are in the push record and absent from text and `--json` stdout and from the result record. | The same e2e test, precondition then absence. |
| I11-3 | behaviour | `?after=1` with accept gives no finding; reject followed by a push gives one. | The same e2e test. |
| I11-4 | behaviour | `builtins: { earlyIdentityPush: fail }` exits 1. | The same e2e test. |
| I11-5 | regression | A foreign email before consent gives no `earlyIdentityPush`, and the same page with the run's own email gives one. | The same e2e test, paired cases. `e2e/datalayer-push-real-data.e2e.test.ts` passes unchanged. |
| I11-6 | error path | A record with no identity gives a pass with a message and no throw. | `pnpm exec vitest run --project unit packages/expect/src/evaluate.test.ts`. |

Acceptance: the new e2e test finds the `builtin: earlyIdentityPush` result, and fails on the old code because there is no such result.

### Wave 3

**H11 Client ID handover: `idHandover` (#934).** Round cap 4. Touches: new `packages/expect/src/id-handover.ts` and `id-handover.test.ts`; `BUILTIN_NAMES` in `scenario.ts`; `DEFAULT_SEVERITY` (`warn`) and the built-in block in `evaluate.ts`; `packages/expect/src/index.ts`; the S11 checkout gets `?checkout=offsite` (the checkout on the `127.0.0.1` host) and `?cid=rotate` in `fixtures/site/public/plain/checkout.html` and `assets/plain-gtm.js`; `fixtures/site/src/pages-plain.test.ts`; `packages/decoders/src/ga4.ts` and `ga4.test.ts` (a new `ga4HitIds(request)`); new `e2e/id-handover.e2e.test.ts` with its scenarios; the failed-result assertions that pin the list to the sandbox result (`toEqual([SANDBOX])` or `!== SANDBOX`) in `e2e/cli-consent.e2e.test.ts` (also the warning count of the `undecided-warn` run), `e2e/cli-checkout.e2e.test.ts`, `e2e/identity-country.e2e.test.ts`, `e2e/optional-fill.e2e.test.ts`, `e2e/test-payment.e2e.test.ts`, `e2e/test-payment-frames.e2e.test.ts` and `e2e/wait-url.e2e.test.ts`, which also expect the `idHandover` warning and nothing else; `e2e/report-marks.e2e.test.ts` (the severity assertion also excludes `idHandover`); `site/demo/*` (re-recorded); `site/src/lib/annotations.ts`; `docs/guide/reading-results.md` (the fence, its `Result:` line and the annotation lines stay in step) and `scripts/site-docs.docs.test.ts` (the pinned `Result:` line); `docs/cli.md` (the `builtins` row and a section), `docs/guide/what-it-checks.md`, `docs/design.md` §11, `CHANGELOG.md` (the H11 marker).
Closes #934
- H11 files a new Backlog issue for the click identifiers (`gclid`, `fbc`, `fbp`) that #934 also names, and comments on #934 with its number before the PR merges.
- `packages/decoders/src/ga4.ts` exports `ga4HitIds(request)`, built on `eventLines`, which returns the `cid` and `sid` of each hit in the order `decode` uses. It reads the request as `decode` sees it: a GA4 request wrapped by the Stape custom loader (`/pwstape?pk=...`) is unwrapped with `unwrapStapeLoader` first, so its hits keep their `cid`.
- On the Shopify fixture the main-frame hits (sent through the Stape loader, `cid` `1111...`) and the sandbox pixel hits (`cid` `3333...`) differ, so every Shopify fixture run warns. `id-handover.ts` calls it and parses no GA4 query or body itself. Nothing is stored in the record.
- GA4 hits are grouped by `tid`. A context is the frame kind plus the page host.
- When a measurement ID's `cid` differs between contexts, the result `builtin: idHandover` warns and names the measurement ID and both contexts by frame kind and host. It never holds an ID value, hash, length or prefix.
- `sid` is compared only where `cid` matches.
- Hits with `analytics_storage` denied, server container hits and hits without `cid` are left out.
- A run with one context passes.
- On the S11 shop, an on-site checkout with the same `cid` passes; `?checkout=offsite&cid=rotate` warns. On the Shopify fixture, the sandbox pixel's different `cid` warns.
Invariants: No ID value appears in any message, evidence or `--json`. Evidence is hit IDs only. With no `builtins` override the exit code does not change. No record field changes.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| H11-1 | behaviour | Same `cid` and `sid` across two contexts passes. | `pnpm exec vitest run --project unit packages/expect/src/id-handover.test.ts`. |
| H11-2 | behaviour | `?checkout=offsite&cid=rotate` on the S11 shop warns and names `G-PWTEST0001` and both contexts. | `pnpm exec vitest run --project e2e e2e/id-handover.e2e.test.ts`. |
| H11-3 | behaviour | The fixture's `cid` and `sid` strings are in the `request` records (URL or body) of the run's JSONL, and absent from stdout, `--json`, the result message and its evidence. | The same e2e test, precondition on the request records, then absence. |
| H11-7 | behaviour | A GA4 hit wrapped by the Stape custom loader yields its `cid` and `sid`. | `pnpm exec vitest run --project unit packages/decoders/src/ga4.test.ts`, a `/pwstape?pk=` case. |
| H11-4 | behaviour | Hits with `gcs=G100` and differing `cid`s pass, and the same hits with `gcs=G111` warn. | The unit test, paired cases. |
| H11-5 | behaviour | `builtins: { idHandover: fail }` exits 1. | The e2e test. |
| H11-6 | error path | Hits with no `cid` and a run with one context pass without a throw. | The unit test. |

Acceptance: `e2e/id-handover.e2e.test.ts` finds `builtin: idHandover` with `warn` on the offsite case, and fails on the old code because there is no such result.
QA: run the Shopify fixture journey and the S11 shop with default `builtins`; read the warning text.

### After the waves

**R17 Release prep.** The version, the CHANGELOG section from the markers, design §15.7 "Differences in 0.7", the re-recorded site demo, a `released section 0.7.0` case in `scripts/changelog-markers.test.ts`, and a release candidate for the field test. Written as its own entry when the waves have landed.

## CHANGELOG markers

The plan PR adds this above `## 0.6.2`, a blank line between each pair. Each entry replaces its marker with its line or lines.

```markdown
## 0.7.0

Not released yet. The newest release is 0.6.2, below.

<!-- S11 -->

<!-- E11 -->

<!-- X11 -->

<!-- C11 -->

<!-- K11 -->

<!-- D11 -->

<!-- I11 -->

<!-- H11 -->

<!-- R17 -->
```

Entry IDs: the earlier plans use ids up to R16 and some with 11 (M11, P11, Q11, R11), so this plan uses S11, E11, X11, C11, K11, D11, I11 and H11, which no earlier plan uses. R17 continues the release prep numbers.

`scripts/changelog-markers.test.ts` needs no change for the plan PR: it refuses the first `##` heading only when it is older than `package.json` (0.6.2), and it looks up each released section by name.

## After the PRs

The maintainer field-tests the 0.7.0 release candidate in `stub` mode, supervised, with a person at every payment and log-in handoff:

- **On the same kind of Shopify store as 0.6.2.** Count the `earlyIdentityPush`, `idHandover` and `possibleRealDataPush` results next to 0.6.2 on the same store. The `possibleRealDataPush` count decides whether it can ever fail by default.
- **On a plain GTM site, when the maintainer names one.** A run of the journey with default `builtins`. If none is named, the S11 shop is the only plain-GTM case of this release, and the field-test notes say so.

## Flagged concerns

- **Two new built-ins show in every run.** I11 and H11 add a line to every run's results, text summary and report. Every Shopify fixture run warns on `idHandover`, because the sandbox pixel sends another `cid`. An e2e test that counts warnings or result lines may change. Under the maintainer's rule (below), the files that break are in the Touches of the entry that breaks them: the seven e2e files that pin the failed list to the sandbox result and `e2e/report-marks.e2e.test.ts` (H11), `e2e/report-marks.e2e.test.ts` (I11), `docs/guide/reading-results.md` and `scripts/site-docs.docs.test.ts` (I11 and H11). An implementer that finds another test whose expected results change stops with a plan conflict.
- **K11 leaves the epochs alone.** A relayed object-form consent update still does not move the consent epoch. K11 files the issue; a later release decides it, because it moves verdicts.
- **E11 keeps a known limit.** Same-name moves with no join keep the greedy order. A full bipartite matching is more code and is left for a later issue if a case shows up.
- **D11 is the largest entry.** It shares `scenario.ts` and `evaluate.ts` with I11 in wave 2, in different functions. I11 rebases on D11 if both are open at once.
- **The S11 shop is not a field observation.** It follows the common gtag and GTM pattern. The milestone asked for fixtures copied from field observations; for plain GTM there are none yet.

## Out of scope

| Item | Why it waits |
| --- | --- |
| #933 | Cut by the milestone. |
| #931, #932, #935, #938, #939 | Backlog, by the milestone. |
| #1485 | The rename is done (#1487). Moving the vendor name table into core touches `evaluate.ts`, which D11, I11 and H11 change. Backlog. |
| #1442 | An accepted known limit. It stays open. |
| Click IDs in `idHandover` (`gclid`, `fbc`, `fbp`) | Backlog, after H11 has field data. H11 files the issue. |
| A `platform` field in `--json` results | The docs mark is enough for now; a field is a schema decision. |
| A hosted demo site | Not a PR of this repo. The S11 shop is local and offline. |
| An MCP server (#362) | AGENTS.md: CLI only. |
