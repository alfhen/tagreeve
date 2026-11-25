# Plan for 0.9.0

0.9.0 is a minor release. It makes three things more exact and fixes two small gaps:

- **Exact client-ID links for a container that answers first (#1640).** Some `serverSendProbableLink` warnings become judged links that can fail a run.
- **Pinterest Conversions API calls link to their browser hits by event ID (#1648).** It adds a decoder and a vendor, `pinterest-capi`.
- **An embedded-frame loader is bounded by a main-frame navigation again (#1591).** It adds one optional field to the record.
- **Event names with spaces or colons read as themselves when a value check holds (#1611).**
- **Three canary edge cases (#1612).**

Each item is one PR. A PR is done when its acceptance test passes in CI, an adversarial review reports no blockers or majors, and it is squash-merged. The release is cut as `0.9.0-rc.1`, field-tested, and then released as `0.9.0`.

0.9.0 starts from `main` at `cff2d31` ("Release prep for 0.8.1 (#1657)"). 0.8.1 is released.

## Goals this release serves

From `docs/goals.md`:

- **Record what a site sends to each tracking vendor, for a scripted visitor, at each consent state.** P90 records the Pinterest Conversions API calls that a local server container sends. F90 keeps a frame's document boundary right in the record.
- **Express expected behaviour as data, and report pass or fail with evidence.** L90 and P90 make more server calls linkable to the browser hit that led to them, so a rule can judge them. N90 keeps two different custom events apart in the state table.
- **Be safe by default.** N90 and C90 keep values out of stored names and make the canary check stricter. Every new check keeps the rule that no value is printed.

Non-goals this release comes close to:

- **Production monitoring.** Unchanged. Every entry works on a scripted run.
- **Changing GTM containers, a hosted service, a second interface.** Unchanged. P90 adds a decoder and a stand-in call only. It never calls the Pinterest API.
- **Legal advice or legal responsibility.** L90 turns some warnings into failures. A failure still means only that a call went out under a consent state that the rule forbids. People decide what is allowed.

## Triage

Each issue was read on 2026-11-25 against `main` at `cff2d31`. The maintainer set the scope: every issue in the 0.9.0 milestone is in.

| Issue | Kind | Status on main | Entry | Where in the code |
| --- | --- | --- | --- | --- |
| #1640 | feature, design change | Open. Rule (2) of `linkServerHits` gives `exact` only while the browser request is in flight. A container that answers first stays `probable`. The maintainer decided on 2026-11-24 to build it with guards. | L90 | `packages/recorder/src/server-container/link.ts` |
| #1648 | gap in links | Open. No decoder reads `api.pinterest.com`. A Pinterest call from the container is not a hit, so it has no `via`. | P90 | `packages/decoders/src/`, `link.ts`, `stub.ts`, the stand-in container |
| #1591 | limitation | Open. `loaderReachesScope` keeps only requests with the loader's own `frame.n`, so a main-frame navigation does not end an iframe loader's document. It fails safe with a warning. | F90 | `loaderReachesScope` in `packages/expect/src/evaluate.ts`, `frameRef` in `packages/recorder/src/recorder.ts`, `DataLayerFrame` in `packages/core/src/records.ts` |
| #1611 | bug | Open. `guardName` lets `EVENT_NAME` accept spaces and `:`, then `guardFieldName` turns both into `(other)`. Two custom events become one entry. | N90 | `guardName` in `packages/expect/src/state-table.ts` |
| #1612 | review follow-up | Open. Three edge cases in `run.ts` and `canary.ts`. None is a path real runs take today. | C90 | `packages/cli/src/run.ts`, `packages/core/src/canary.ts` |

The other open issues in Backlog stay there.

## Decisions

Decided by the maintainer:

1. **#1640 is built with guards** (comment on #1640, 2026-11-24). A link is `exact` by client ID when the call's browser request was already answered only if all of these hold: exactly one same-key browser hit (client ID, event name, `serverHosts` host); its request was answered at most 2000 ms before the call; no other container-routed request that shares a client ID with the call, or has no decoded hit, was sent between that hit and the call; no consent epoch starts between the hit and the call.
2. **A warning may become a failure in 0.9.0** when the entry and the release notes say so. L90 does. C90 item 3 can too.
3. **The scope is the 0.9.0 milestone:** #1640, #1648, #1591, #1611, #1612.

Decided in this plan:

- **L90 changes the rule in design §4** (choice: maintainer may change). Today §4 says a client ID link is `exact` only when the call arrives before Tagreeve sees the answer, and "a container that answers first leaves the link `probable`". After L90 a call that arrives after the answer is also `exact` when the four guards hold. The in-flight case is unchanged. Why it is honest enough: the proof of the old rule was timing, and the new rule keeps the same proof for the one case where timing cannot be seen, which is the answer-first container. Three guards stand in for it. A single same-key hit means no other request could be the source. At most 2000 ms is a short, fixed bound on how late the container's own tags may send. No request between the hit and the call, and no consent change, means nothing else could have caused the call or changed its consent state. A call that fails any guard stays as today.
  - **The window is 2000 ms, fixed.** It is a constant in `link.ts` next to `LATER_HIT_WINDOW_MS`. It is not an option.
  - **The distance is the call's arrival minus the answer time of the hit's request,** both on the clock that stamps container calls (`InFlightWindow.answeredAt`). A call at exactly 2000 ms counts.
  - **The concurrent test is the existing `hasConcurrentRequest`,** run over the whole span from the hit's send time to the call (`window.sentAt` to `callAt`). It already ignores unload sends and the call's own request.
  - **The epoch test uses the existing `epochStarts` input** of `linkServerHits`. An epoch start `t` with `window.sentAt < t <= callAt` blocks the link. Without `epochStarts` the new case never applies, so a caller that does not pass it keeps today's behaviour. The recorder already passes it (`recorder.ts`, the `linkServerHits` call in `close`). The in-flight case is not changed by this entry and does not read `epochStarts`.
  - **No new miss reason.** `HitLinkMiss.clientId` keeps its five values, so there is no record change. A call that fails the 2000 ms guard, the epoch guard, or has no answer time stays `answeredBefore`. The docs say `answeredBefore` now also covers a call that came more than 2000 ms after the answer and a call after a consent change. The `concurrentRequest` reason keeps its meaning and now also applies to a call that came after the answer.
  - **The answer-first call gets `by: "clientId"`, `confidence: "exact"`,** the same `via` as an in-flight link. The record does not say which of the two cases proved it, as the proof is in memory only.
- **#1648: there is no decoder for `api.pinterest.com`, and a shared ID exists.** Found on 2026-11-25:
  - `packages/decoders/src/pinterest.ts` decodes only `ct.pinterest.com/v3/` and `/user/`. `git grep -n "api.pinterest"` finds nothing in `packages/`, `fixtures/` or `e2e/`. The tracker list has no `api.pinterest.com` entry.
  - The Pinterest tag hit carries an event ID. The decoder reads `ed.event_id` (and `ed[event_id]`) into `params.eventId`. The recorded capture in `packages/decoders/fixtures/pinterest/capture.json` has `event_id` in `ed`. Pinterest's own help page on event codes shows `ed[event_id]=YOUR_EVENT_ID` (https://help.pinterest.com/en/business/article/add-event-codes).
  - Pinterest's Conversions API call is `POST https://api.pinterest.com/v5/ad_accounts/{ad_account_id}/events` with a JSON body `{ "data": [ {...} ] }`. Each item has `event_name`, `action_source`, `event_time` (Unix seconds), `event_id`, `event_source_url`, `user_data` (with `em` as an array of hashed emails) and `custom_data`. The token is sent as `Authorization: Bearer <access_token>`, not in the URL. The answer is `200` with `{ "num_events_received", "num_events_processed", "events": [ { "status", "error_message" } ] }`. Pinterest says `event_id` "can be used for deduping between events ingested via both the conversion API and Pinterest tracking" (https://developers.pinterest.com/docs/api/v5/events-create/). So the browser tag and the server call share the event ID, as Meta's pixel and Conversions API do. Rule (1) of `linkServerHits` can use it.
  - **The event names differ in form.** The tag sends `pagevisit`, `addtocart`, `checkout` (the capture shows these). The Conversions API names are `page_visit`, `add_to_cart`, `checkout` and so on (the `event_name` list in the page above). Rule (1) compares `hit.event` literally, so without a fix `page_visit` never meets `pagevisit`. The smallest honest fix is a name key used only for the Pinterest pair: lower case, with `_` removed. It is used only when both hits are Pinterest hits (`pinterest` and `pinterest-capi`). `hit.event` stays as the vendor sent it. The key is in `link.ts`, so it does not touch what rules, diff or baselines read.
  - **The new decoder is its own vendor, `pinterest-capi`,** as `meta-capi` is separate from `meta`. A rule written for `vendor: pinterest` keeps meaning the browser tag. This adds a vendor key, which the tracker list refuses as a custom vendor (docs/cli.md says a custom vendor must not be a built-in decoder key).
  - **The answer in `stub` and stand-in mode is `200` with the JSON above,** so a template tag does not read a `204` as a failure. It is in `packages/recorder/src/stub.ts`, beside `CAPI_ANSWER`.
  - **Baselines drift.** A run that records a Pinterest Conversions API call now has `pinterest-capi` hits where it had none. A baseline made before 0.9.0 shows them as added. A stub-mode run where the browser itself posts to `api.pinterest.com` now stubs that request and decodes it, where it was an unknown destination before. The upgrade notes say so.
- **#1591: one optional field, `page`, on `DataLayerFrame`, and no schema bump** (choice: maintainer may change). `Request.frame` gains `page?: number` (a new type `RequestFrame` that extends `DataLayerFrame`, which stays `{ main, n }` for `DataLayerEvent.frame` and `TagReport.frame`): the run's number of the page (tab or popup) that the frame belongs to. The recorder numbers pages as it numbers frames (a `WeakMap<Page, number>` beside `frameNumbers`, filled in `frameRef`). An iframe dies with a main-frame navigation of its own page, so a non-aborted main-frame document request with the same `page` ends the document of an embedded loader. A popup has another `page`, so its main document never ends it, which is the false pass the 0.8.0 plan avoided.
  - **Why `page` and not a detach time.** A detach time needs a new event stream or a stamp on a frame that is already gone. The page number needs only what the recorder already has when it makes the request record.
  - **No schema bump.** `records.ts` says a new optional field that an older reader of the same version reads correctly does not bump the version. An older reader ignores `page`. A record without `page` (any record made before 0.9.0) is read as today: the loader is not bounded by a main-frame navigation, and the rule warns. `RECORD_SCHEMA_VERSION` stays 5. The comment above it gains one line.
  - **The field is on requests only.** `frameRef` is used for requests and tag reports, but a push builds its frame apart, and `dataLayerEventFromPayload` and `parseTagReport` copy only `main` and `n`. Only `loaderReachesScope` reads `page`, and it reads requests. So pushes and tag reports gain nothing from it, and `datalayer.ts` and `tag-report.ts` stay out of Touches. `frameRef` returns a `RequestFrame` to the request builder, and the tag-report path keeps only `main` and `n`.
- **#1611: a spaced or coloned event name reads as itself under one rule** (choice: maintainer may change). The three review rounds of 0.8.1 each found a new split (a spaced phone number, then a hash split into words after a plain word). The rule must hold for any split, so it does not look for a pattern in the words. It limits what a name can hold. A name that has a space or a `:` is kept only when all of these hold:
  1. It is at most 64 characters, has at most 6 words (a word is a run with no space), and each word has only `A-Za-z0-9_.:-`. This is `EVENT_NAME`.
  2. It has at most 3 digit characters in all. The value kinds the product searches for hold an `@` or many digits: an email has an `@`, a phone number has at least 7 digits, a SHA-256 hash and a UUID have far more, as does a click ID. A split moves the spaces but cannot remove digits, so the cap holds for any split, before or after a plain word, with spaces or `-` between the pieces.
  3. No `@` anywhere, and no contiguous span of words, read joined with nothing between them, is a value segment by the existing `isValueSegment` and `guardFieldName` checks (email, phone, long token or hash). The check runs over every span, not only the whole name, because a plain word before or after a value must not hide it.
  Names with no space and no `:` are checked as today. Otherwise the name reads `(other)`.
  - **Where the rule stops.** A name made of letters only, such as a random token cut into words, has no digit to count. The rule keeps it. The same holds for an identity value with no `@` and 3 or fewer digits: a first name, a last name, a city, and an email local part (`<first>.<last>.<4 alnum>`, which has 0 to 4 digits). Split into words, one of these reads as itself. A canary value has many digits or an `@`, so a canary cannot read this way. This is the residual risk in Flagged concerns, and the dispute path below is for a case it cannot meet.
  - **If an eval below cannot be met by this rule,** the builder returns a `dispute` and N90 stays out of 0.9.0 with no code change. #1611 stays in Backlog, and the entry says so.
- **#1612: the three edge cases are fixed as the issue says** (choice: maintainer may change). Item 3 makes `canaryPool.match` match more, so a run can newly find a canary and fail. That is the fix, and the release notes say it.
- **Docs owners.** Each entry edits the docs of its own change, named on its Touches line. `docs/design.md` has one entry per wave. R90 writes the release docs (§15, the README line, the version lines).
- **CHANGELOG.** No entry edits `CHANGELOG.md`. Each PR body ends with `CHANGELOG: <one line>`, and the release entries write the sections from them.
- **Upgrade notes.** The `## 0.9.0` section of `CHANGELOG.md` has a part called "Upgrading from 0.8" with the items under Flagged concerns that change output: L90, P90, F90, N90 and C90 item 3.

## Order and waves

```mermaid
flowchart LR
  W1["Wave 1: L90, N90, C90"] --> W2["Wave 2: P90"]
  W2 --> W3["Wave 3: F90"]
  W3 --> RC["RC90: release prep for 0.9.0-rc.1"]
  RC --> R["R90: release prep for 0.9.0"]
```

Three waves, then the release candidate, then the release.

No two entries of one wave touch the same file, and a file that more than one entry edits is edited in different waves. Why the waves are this way:

- **P90 after L90.** Both edit `packages/recorder/src/server-container/link.ts` and its test (L90 rule (2), P90 rule (1) and the Pinterest name key), and `docs/design.md` §4, and `docs/guide/server-container.md`. P90 also reads the corrected rule text, so it is in wave 2.
- **F90 in wave 3.** It edits `docs/design.md` (the record text in §3 and the dataLayer loader text), which L90 (wave 1, §4) and P90 (wave 2, §4 and §6) edit. It also edits `packages/expect/src/evaluate.ts`, which no other entry edits, and `packages/core/src/records.ts` and `packages/recorder/src/recorder.ts`, which no other entry edits either. It is last because of `docs/design.md` only.
- **N90 and C90 in wave 1.** They share no file with each other or with L90. N90 edits only `packages/expect/src/state-table.ts` and its test. C90 edits `packages/cli/src/run.ts`, `packages/core/src/canary.ts`, their tests and `e2e/canaries.e2e.test.ts`. Neither edits `docs/design.md`.
- **`docs/design.md`.** L90 (wave 1, §4 rule (2), §8 Correlation line), P90 (wave 2, §4 rule (1), §6 decoder table), F90 (wave 3, §3 record text and the dataLayer loader text). R90 and RC90 edit §15 and the version lines only, after all of them.
- **`docs/guide/server-container.md`.** L90 (wave 1, the `answeredBefore` and `concurrentRequest` rows and the sentence under the table), P90 (wave 2, one sentence on Pinterest).
- **`docs/cli.md`.** P90 (wave 2, the `hashesMatch` paragraph and the decoder list). No other entry edits it. R90 edits only its version lines.
- **`packages/decoders/`.** P90 only.
- **`packages/recorder/src/recorder.ts`.** F90 only (`frameRef` and the page numbers). F90 also adds `frame-page.ts`.
- **`fixtures/site/`.** P90 (the stand-in container, a new page), F90 (a new page and its route). They edit `fixtures/site/src/index.ts` (the page route map) in different waves. L90 adds scenarios in `e2e/scenarios/` and a fixture helper only if the page `server-container-link` needs one (Touches).
- **`e2e/`.** Every entry adds its own new e2e file, except L90 (two existing files) and C90 (`e2e/canaries.e2e.test.ts`).

## Rules for every PR

The rules in `AGENTS.md` and the earlier plans still hold: CLI only, no MCP server; no hosted service and no GTM API; fake IDs and identities only (`G-PWTEST0001`, `AW-000000001`, `100000000000001`, `GTM-PWTEST1`, `GTM-PWNOVER`); no cookie value, identity value, client ID, card value, access token, `gtmAuth` or container config in any output; e2e only against `fixtures/site` in `stub` mode (and `server` mode on the fixture's loopback host with the stand-in container), with no Docker and no network; context-level hooks only; third-party code unmodified. Tracker entries and vendor field names come from the vendor's own docs, which the PR cites. Tracker Radar, EasyPrivacy and Disconnect are not sources.

More for 0.9.0:

- **The record stays at schema version 5.** F90 adds one optional field. L90 adds no miss reason. No other entry changes a record type.
- **A minor release may add a decoder and may turn a warning into a failure,** when the entry and the upgrade notes say so. L90, P90 and C90 item 3 are the entries that do. No other entry changes a pass, a warning or a failure.
- **Each PR adds a regression test that fails without the change,** and the PR body says which line was reverted to see it fail.
- **Every negative test checks its input first.** A leak check asserts the value is in the input or the record, then that it is absent from the output.
- **Never edit a file outside the Touches line.** A flaky test is reported, not patched. Known flaky: the second test of `e2e/unload-gap-frame-nav.e2e.test.ts` (#1608).
- **An entry that changes what an existing test states says so.** The PR body lists each test whose expected result changes on purpose and why. Where the plan names such a test, the entry changes it. Any other test that fails is a regression until shown otherwise.
- **New e2e tests go in new files,** unless the entry names an existing file.
- **CHANGELOG.** The PR body ends with `CHANGELOG: <one line>`.
- **Docs.** An entry that changes a rule, a record or a decoder edits the doc lines that state it, as its Touches line names. It leaves the rest to R90.

## PRs

### Wave 1

**L90 An exact client-ID link when the container answers before its call (#1640).** Round cap 4. Touches: `linkServerHits` and the comment above it in `packages/recorder/src/server-container/link.ts`; `packages/recorder/src/server-container/link.test.ts`; `packages/recorder/src/server-container/link-consent.test.ts` (one case changes, see L90-5); `e2e/server-container-link.e2e.test.ts` (the test `a container that answers first stays probable, warns and exits 0` changes on purpose); `e2e/server-container-link-miss.e2e.test.ts` (the `answeredBefore` checks change on purpose); `e2e/scenarios/server-container-ga4-answer-first.yml`, `e2e/scenarios/server-container-link-miss.yml` and new scenarios `e2e/scenarios/server-container-ga4-answered-late.yml`, `e2e/scenarios/server-container-ga4-answered-concurrent.yml` and `e2e/scenarios/server-container-ga4-answered-epoch.yml`; `fixtures/site/public/server-container-link.html` only if a case needs a page helper; `docs/design.md` §4 (rule (2) and the paragraph that says only an in-flight link is exact) and the Correlation line in §8; `docs/guide/server-container.md` (the `answeredBefore` and `concurrentRequest` rows, the paragraph under the table, and the `serverSendProbableLink` bullet); `docs/cli.md` only where a line says an answer-first container stays probable.
Closes #1640
- Rule (2) gives `by: "clientId"`, `confidence: "exact"` for a call that arrived after the same-key hit's answer when: exactly one same-key browser hit (as today, over every earlier same-key hit, answered or not); the call arrived at most 2000 ms after that request's answer; `hasConcurrentRequest` is false over the span from the hit's send to the call; no entry of `epochStarts` is after the hit's send and at or before the call. The in-flight case is as before.
- Without `epochStarts`, or with no answer time for the request, the new case does not apply.
- A call that fails a guard keeps today's result and its miss reason: `severalSameKeyHits`, `concurrentRequest` (also for an answered hit), or `answeredBefore` (late, after an epoch start, or no window).
- The design §4 text, the guide table and the guide `serverSendProbableLink` bullet say what changed: a container that answers first can now be linked `exact`, so a rule that judged such a call at `warn` can now fail the run.
Invariants: `linkServerHits` still returns browser hits unchanged. Rule (1) and rule (3) results are unchanged for every input that rule (2) did not link before. A call that was `exact` before is `exact` now with the same `via`. `HitLinkMiss` and `RECORD_SCHEMA_VERSION` are unchanged. The one case in `link-consent.test.ts` that pins an answered call after an epoch start is changed or added on purpose (L90-5). The only caller, in `recorder.ts`, is unchanged. The result of an input changes in two ways only: from `answeredBefore` to `exact`, and from `answeredBefore` to `concurrentRequest` (an answered call with a concurrent request). The reason order is as in the code: `severalSameKeyHits`, then `concurrentRequest`, then `answeredBefore`. The builder lists in the PR body every other e2e file that uses the stand-in container and any change of its result, and runs those files (`git grep -l "TAGREEVE_TEST_SERVER_CONTAINER_CMD" -- e2e`).
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| L90-1 | behaviour | One same-key hit, answered 300 ms before the call, no request between, no epoch start: the call is `exact` by `clientId`, with the hit's ID in `via.hitId`, and has no `linkMiss`. | `pnpm exec vitest run --project unit packages/recorder/src/server-container/link.test.ts`. It replaces the test `one same-key hit answered before the call is answeredBefore, and keeps its probable via`. It fails on `main`. |
| L90-2 | boundary | A call 2000 ms after the answer is `exact`. A call 2001 ms after is `answeredBefore` with the probable link it has today. | The same file. |
| L90-3 | guard | Two earlier same-key hits (both answered) give `severalSameKeyHits` and no exact link. A hit with no answer time gives `answeredBefore`. | The same file. The second case keeps the test at `one same-key hit with no window is answeredBefore`. |
| L90-4 | guard | Another container-routed request that shares the call's client ID, sent between the hit and the call, gives `concurrentRequest`. So does one with no decoded hit. A request sent before the hit, or after the call, does not. A request from `pagehide` does not. | The same file. |
| L90-5 | guard | An epoch start after the hit's send and at or before the call gives `answeredBefore`. An epoch start before the hit's send, or after the call, does not block. With no `epochStarts` the call is not linked. | The same file and `link-consent.test.ts`. |
| L90-6 | behaviour | End to end: with the container answering first and calling 300 ms later, the call is `exact`, the `mustNot` rule fails, the result has no `serverSendProbableLink` note and the run exits 1. The test `a container that answers first stays probable, warns and exits 0` is replaced by one that says this, and its name says the change. | `pnpm build`, then `pnpm exec vitest run --project e2e e2e/server-container-link.e2e.test.ts`. It fails on `main`. |
| L90-7 | guard | End to end: a call 2500 ms after the answer is `probable` and warns (`serverSendProbableLink`), exit 0; a request with the same client ID sent between hit and call gives `concurrentRequest`; a consent change between hit and call gives `answeredBefore` and a warning. Each case first asserts, from the record, that the hit, the answer gap and the other request or epoch it names are there. | `pnpm exec vitest run --project e2e e2e/server-container-link.e2e.test.ts e2e/server-container-link-miss.e2e.test.ts`. |
| L90-8 | regression | The `answeredBefore` checks in `e2e/server-container-link-miss.e2e.test.ts` hold on the new rule: the `link_none` case is exact; the `answeredBefore` count is at least one through the late case; no client ID, event ID or URL is in `notExact`. | The same file. |

Acceptance: L90-6 passes, and fails on `main`. L90-7 passes.

**N90 Event names with spaces or colons read as themselves when a value check holds (#1611).** Round cap 4. Touches: `guardName` and `EVENT_NAME` in `packages/expect/src/state-table.ts`; `packages/expect/src/state-table.test.ts`; `packages/cli/src/suite.test.ts` (one case through the stored matrix).
Closes #1611
- A name with a space or a `:` is kept when it passes the four checks in Decisions (shape, at most 3 digits, no `@`, no value span). Otherwise it reads `(other)`. Names with neither character are checked as today.
- If the rule cannot meet every eval, the builder returns a dispute and the PR is not opened.
Invariants: `guardFieldName`, `isValueSegment` and every other caller of them are unchanged. Every name that reads `(other)` today and is not spaced or coloned still reads `(other)`. A spaced or coloned name that reads as itself today is none, so no stored name changes except to become itself. No phone number, hash, email address, UUID or click ID reaches `suite.json` through a spaced name. A letters-only name, or one with 3 or fewer digits and no `@`, can (see Decisions, where the rule stops). The state table's `notInAccept` list now tells `Add To Wishlist` from `Start Trial`.
Evals (each case checks the planted value is in the input first):

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| N90-1 | behaviour | `Add To Wishlist`, `Start Trial`, `gtm:foo`, `Step 1 of 3` and `Level 10 Complete` read as themselves. | `pnpm exec vitest run --project unit packages/expect/src/state-table.test.ts`. It fails on `main`. |
| N90-2 | gap | A phone number split by spaces reads `(other)`: `+45 12 34 56 78`, `4512 3456 78`, `45 12 34 56 78 call`. Also after a plain word: `call us 45 12 34 56 78`, `Order 45 12 34 56 78`, and with `-` or `.` between pieces. | The same file. |
| N90-3 | gap | A SHA-256 hex hash split into 8-character words, into words of 1 to 16 characters, and into two parts, reads `(other)`: alone, after a plain word (`Hash a1b2c3d4 ...`), before one, and with a plain word between the pieces. The same for a 32-character hex hash. | The same file. |
| N90-4 | gap | A UUID split on its hyphens into words, split at other points, and written with spaces in place of hyphens, reads `(other)`: alone, after a plain word and before one. | The same file. |
| N90-5 | gap | An email, or a part that holds `@`, reads `(other)` even with spaces: `a b@c.com`, `x user @ example.com`. A name over 64 characters, or with more than 6 words, reads `(other)`. | The same file. |
| N90-6 | gap | Digits spread over a name cannot get past the cap: 4 single digits in 4 words read `(other)`, and 3 read as themselves. | The same file. |
| N90-7 | regression | The check holds for any split: a property test splits each of four generated values (a phone number, two hashes, a UUID) at every position and in several widths, with and without a plain word before or after, and none reads as itself. | The same file. It runs in the unit project, under one second. |
| N90-8 | behaviour | Through `suite.test.ts`: two runs whose reject cell sends `Add To Wishlist` and whose accept cell sends `Start Trial` give a `notInAccept` list with `Add To Wishlist`, and the stored `suite.json` has neither a phone number nor a hash from a spaced name. | `pnpm exec vitest run --project unit packages/cli/src/suite.test.ts`. |

Acceptance: N90-1 passes, and fails on `main`. N90-2 to N90-7 pass. The PR body says which line was reverted for each gap (for example the digit cap) to see N90-2, N90-3 and N90-6 fail.

**C90 The three canary edge cases (#1612).** Round cap 3. Touches: `queryNames` and the `#` refusal in `executeRun` in `packages/cli/src/run.ts`; `packages/cli/src/run.test.ts` (the cases for this entry only; the file is known to time out on some machines, see below); `canaryPool` in `packages/core/src/canary.ts`; `packages/core/src/canary.test.ts`; `e2e/canaries.e2e.test.ts` (new cases).
Closes #1612
- **Item 1.** `queryNames` strips tab, newline and carriage return from a parameter name before the reserved-name check, as navigation does. A start URL with `gc\tlid=` in its query is refused as already holding the `gclid` canary name.
- **Item 2.** The refusal for a `#` in a variable value still needs a `{placeholder}` left in the resolved start that names a variable (`refilled`, as on `main`). It then fires only when a variable that the fill puts into `start` holds a `#`: one whose `{name}` appears in the start URL, or in a variable value that appears there. A `#` in a variable the start does not use is allowed. A `#` in a variable the start uses directly, with no placeholder left to refill, is not refused, as on `main`: the canaries go before the `#`.
- **Item 3.** `canaryPool.match` also tries the text with trailing `=` removed before the cookie-token fallback, so a padded Base64 form of a canary or an identity value matches.
Invariants: `canaryPool.forms`, the canary values and every reading of `readings()` are unchanged. A text that matched before matches now with the same name. Nothing matches that holds no canary: a text with `=` that is not a padded form of a canary stays unmatched. Item 3 can find a canary where none was found, so a run can newly fail: the PR body and the upgrade notes say so.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| C90-1 | behaviour | A start URL with a tab, newline or carriage return inside a reserved name is refused (exit 2) with the existing "already holds" message. The control characters are in the input. | `pnpm exec vitest run --project unit packages/cli/src/run.test.ts -t canary`, and the e2e case in `e2e/canaries.e2e.test.ts`. It fails on `main`. |
| C90-2 | behaviour | A variable value with `#` that the start does not use does not refuse the run, even when another variable is refilled. With a refill, a `#` in a variable the start uses through a placeholder (for example `key: '{next}#frag'`, the case in `run.test.ts`) still refuses. A direct `#` variable with no refill (`start: /p?x={frag}`, `frag=a#b`) does not refuse, as on `main`. | The same files. The e2e case runs the real scenario and checks the exit code and the start URL the run recorded. |
| C90-3 | behaviour | `canaryPool.match` matches the padded Base64 form of a canary value and of the identity email, with the name of that canary. A string with trailing `=` that is not a form of a canary does not match. | `pnpm exec vitest run --project unit packages/core/src/canary.test.ts`. It fails on `main`. |
| C90-4 | regression | Every case in `canary.test.ts` that passed on `main` still passes without a changed expectation. | The same file. |

Acceptance: C90-1 and C90-3 pass, and fail on `main`. C90-2 passes.

The local unit tests `run.test.ts` and `runner.test.ts` time out on some machines and on a clean `main`. C90 adds cases to `run.test.ts`. The builder reports a timeout and does not patch it.

### Wave 2

**P90 Pinterest Conversions API calls link to their browser hits by event ID (#1648).** Round cap 4. Touches: `packages/decoders/src/pinterest-capi.ts` (new) and `packages/decoders/src/pinterest-capi.test.ts` (new); `packages/decoders/src/registry.ts`, `packages/decoders/src/registry.test.ts`; `vendorKeys` in `packages/decoders/src/decoder.ts`; `packages/decoders/src/index.ts`; `packages/decoders/src/page-fields.ts` and `packages/decoders/src/page-fields.test.ts` (the key list and the per-vendor page names it pins); `packages/decoders/fixtures/pinterest-capi/capture.json` (new, hand-written from the docs with fake IDs); `site/src/lib/vendors.test.ts` (it pins the decoded vendor list: a sample `api.pinterest.com` request is added to its list, and the expected vendors get `pinterest-capi`); `stubResponse` in `packages/recorder/src/stub.ts` and `packages/recorder/src/stub.test.ts` (the answer for the new endpoint); `packages/recorder/src/server-container/capture.test.ts` (the container answer for the new endpoint); rule (1) and the Pinterest name key in `packages/recorder/src/server-container/link.ts` and its test `packages/recorder/src/server-container/link.test.ts`; `packages/cli/src/report/names.ts` and its test; `fixtures/site/src/stand-in-container.ts` and `fixtures/site/src/stand-in-container.test.ts` (an opt-in Pinterest call); `fixtures/site/public/server-container-pinterest.html` (new), the route in `fixtures/site/src/index.ts`, `fixtures/site/src/pages-server-container-link.test.ts` or a new pages test, and the stand-in rows and the page list in `fixtures/site/README.md`; `e2e/scenarios/pinterest-capi-server.yml` (new) and `e2e/pinterest-capi-server.e2e.test.ts` (new); `docs/design.md` §4 rule (1) and the §6 decoder table (a new row) and the stub text in §8; `docs/cli.md` (the `hashesMatch` paragraph that names the vendors, and the decoder list); `docs/guide/server-container.md` (one sentence on Pinterest links).
Closes #1648
- **The decoder `pinterest-capi`.** It matches a `POST` to `api.pinterest.com/v5/ad_accounts/<id>/events` and decodes one hit for each item of `data`, as `meta-capi` does: `event` from `event_name`, `params.eventId` from `event_id`, `page` from `event_source_url`, `ids.event_id`, `ids.hashes.em` and `params.hashedEmail` from `user_data.em` (a hashed value, the first of the array, as the tag's `pd.em`), the other fields from `jsonEntries`, and no value from the `Authorization` header. A body that is not parsable gives one hit with `fieldsComplete` false. The field names are cited from Pinterest's page in the PR. `isCollectionEndpoint` is true for the endpoint under any method, so a CORS preflight is stubbed too.
- **The vendor key.** `pinterest-capi` is added to `vendorKeys` and to `PAGE_FIELDS` (`event_source_url`).
- **The stub answer.** `stubResponse` gives `200` with a Pinterest-shaped JSON body for the endpoint, in `stub` mode, in `server` mode for a host that is not a server host, and for a call the container makes.
- **The link.** Rule (1) of `linkServerHits` compares the event name through a key: a Pinterest hit pair (`pinterest` with `pinterest-capi`) compares `name.toLowerCase().replaceAll('_', '')`; every other pair compares literally as today. The event ID rule is unchanged (the same ID, at least 8 characters for a hit after the call). `hit.event` is never changed.
- **The stand-in call.** The stand-in container gains an opt-in `pinterest=<event_name>` query value on its trigger path. With it, the stand-in also sends `POST https://api.pinterest.com/v5/ad_accounts/100000000000002/events` through the proxy, with the event ID of the trigger, a hashed email and `Authorization: Bearer pw-fixture-pinterest-token`. Without it, nothing changes, so no existing e2e test sees a fourth call. The ad account ID `100000000000002` and the token are new fake fixture values, added to the fixture's README.
- **The fixture page.** `server-container-pinterest` sends the Pinterest tag's hit, `event=addtocart` with `ed={"event_id":"pw-pin-event-1"}` and `pd.em` (to `ct.pinterest.com`, which the stub answers), and the trigger request to the stand-in with `pinterest=add_to_cart` and the same event ID. The two event names differ in form on purpose, so the e2e test proves the name key.
Invariants: No decoder output changes for any request that is not on the new endpoint. `pinterest` decodes as before. Every rule (1) result for a pair that is not `pinterest` with `pinterest-capi` is unchanged. No existing e2e test changes its expected result, and no existing stand-in call is added or removed. No new field in a record type. The `Authorization` value and the access token are never in a record (the record redacts the header; a new test proves it), and the hashed email is a decoded field as `meta-capi` has it. Baselines drift as Decisions says: the PR body lists the changes, and the upgrade notes carry them.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| P90-1 | behaviour | A POST to the endpoint with two items decodes into two `pinterest-capi` hits with `event`, `params.eventId`, `page`, `ids.event_id`, `params.hashedEmail`. A GET, another path, another host and a `ct.pinterest.com` request give none. A body that is not JSON gives one hit with `fieldsComplete` false. The fixture capture has the field names and an example from the docs. | `pnpm exec vitest run --project unit packages/decoders/src/pinterest-capi.test.ts`. |
| P90-2 | behaviour | No hit, record or field holds the bearer token or the `Authorization` header value. The token is in the input first. | The same file, and the e2e test below on the record. |
| P90-3 | behaviour | `decodedVendors` holds `pinterest-capi`, and the sample request for it decodes to that vendor. | `pnpm exec vitest run --project unit site/src/lib/vendors.test.ts packages/decoders/src/registry.test.ts packages/decoders/src/page-fields.test.ts`. It fails on `main`, because the pinned list changes. |
| P90-4 | behaviour | The endpoint is stubbed in `stub` mode and answered with status 200 and a body that holds `num_events_received`. The container's call to it is answered the same. Another `api.pinterest.com` path is not changed. | `pnpm exec vitest run --project unit packages/recorder/src/stub.test.ts packages/recorder/src/server-container/capture.test.ts`. |
| P90-5 | behaviour | A `pinterest-capi` hit with event `add_to_cart` and event ID `pw-pin-event-1` links `exact`, by `eventId`, to one `pinterest` browser hit with event `addtocart` and the same ID. `page_visit` links to `pagevisit`, `checkout` to `checkout`. `add_to_cart` does not link to `addtocart` on a Meta hit, and a Pinterest pair with different IDs does not link. | `pnpm exec vitest run --project unit packages/recorder/src/server-container/link.test.ts`. It fails on `main`. |
| P90-6 | behaviour | End to end, in `server` mode on the fixture with the stand-in container: the record has a request to `api.pinterest.com` with `captured: 'serverContainer'`, a `pinterest-capi` hit decoded from it, and that hit's `via` is `{ hitId: <the tag hit>, by: 'eventId', confidence: 'exact' }`. The stand-in call has the hashed identity email and the run has an `identifierRoute` flag whose sink is that call, with vendor `pinterest-capi`, transform `sha256` and the tag hit as the one hop. The run fails with the evidence naming that call and exit 1. The test first asserts the call, the hit, the tag hit and the hashed email are in the record. | `pnpm build`, then `pnpm exec vitest run --project e2e e2e/pinterest-capi-server.e2e.test.ts`. It fails on `main`: there is no decoder, so no hit. |
| P90-7 | gap | The same e2e file proves the link is the event ID and the name key: a second case with a different event ID leaves the call unlinked or probable, never `exact`. | The same file. |
| P90-8 | behaviour | The e2e file asserts that no output holds the access token, the bearer header, the hashed email or the container config. | The same file. |
| P90-9 | regression | The existing e2e files that use the stand-in container still pass with their call counts unchanged. | `pnpm exec vitest run --project e2e e2e/server-container.e2e.test.ts e2e/identifier-route-server.e2e.test.ts`. |

Acceptance: P90-6 passes, and fails on `main`. P90-3 passes. P90-9 passes.

### Wave 3

**F90 An embedded-frame loader is bounded by a main-frame navigation of its page (#1591).** Round cap 4. Touches: `RequestFrame` (new), `Request` and the comment above `RECORD_SCHEMA_VERSION` in `packages/core/src/records.ts`; `packages/core/src/records.test.ts` only if it exists and pins the frame shape; `frameRef`, `frameNumber` and the page numbers in `packages/recorder/src/recorder.ts` (the request record only); `packages/recorder/src/frame-page.ts` (new, a small pure helper that numbers pages, so a unit test can reach it) and `packages/recorder/src/frame-page.test.ts` (new); `loaderReachesScope` in `packages/expect/src/evaluate.ts` and `packages/expect/src/evaluate.test.ts` (or the existing test file for it); `fixtures/site/public/datalayer-frame-loader.html` (new) and `fixtures/site/public/datalayer-frame-loader-child.html` (new), the route in `fixtures/site/src/index.ts`, a pages test, the page list in `fixtures/site/README.md`; `e2e/scenarios/datalayer-frame-loader-nav.yml` (new) and `e2e/datalayer-frame-loader-nav.e2e.test.ts` (new); `docs/design.md` (the record text for `Request.frame` in §3, and the dataLayer loader text, with the words "page number"); `docs/cli.md` only if a line says an iframe loader is not bounded.
Closes #1591
- **The record.** `Request.frame` becomes a `RequestFrame` (`DataLayerFrame` plus `page?: number`), the run's number of the page the frame belongs to. The recorder sets it on every request record. Pushes and tag reports are unchanged. Page numbers start at 0 and count pages as the recorder meets them (the first page, then each popup). No URL is written.
- **The check.** For a loader whose `frame` is not `main`, and has a `page`, a request is a boundary when it is a non-aborted document request of the same frame (as today), or a non-aborted main-frame document request with the same `page`. A loader or a request without `page` is judged as today. A main-frame loader is judged as today.
- **No schema bump.** `RECORD_SCHEMA_VERSION` stays 5. The comment above it says 0.9.0 adds, within version 5, the optional `Request.frame.page`.
Invariants: A record without `page` gives the same results as on `main`. A popup's main-frame document never ends an iframe loader of another page. A main-frame loader's boundaries are unchanged. `visitTimes` still end any loader's document. Nothing else reads `frame.page`, and no push or tag report holds it. No output text changes except that the warning "could not all be read" no longer appears for an iframe loader whose page navigated before the scope began.
Evals:

| Id | Kind | What must be true | How to check |
| --- | --- | --- | --- |
| F90-1 | behaviour | An iframe loader (`{ main: false, n: 1, page: 0 }`) flagged `dataLayerNotHooked`, then a main-frame document request on page 0, then a `mustNot dataLayer` rule with `after:` a later step: the rule passes with no "could not all be read" and no `warn`. | `pnpm exec vitest run --project unit packages/expect/src/evaluate.test.ts`. It fails on `main`. |
| F90-2 | guard | The same input with the main-frame navigation on page 1 (a popup) still gives `pass false`, `severity: warn`. An aborted main-frame document request does not bound the loader. The same input with no `page` on the loader or the request gives today's warning. | The same file. |
| F90-3 | regression | A main-frame loader and a visit step are bounded as on `main`. | The same file. |
| F90-4 | behaviour | The page numbering gives the same `page` to two requests from the same page, and a new `page` (the next number) to a popup. A push and a tag report have no `page`. | `pnpm exec vitest run --project unit packages/recorder/src/frame-page.test.ts packages/recorder/src/datalayer.test.ts packages/recorder/src/tag-report.test.ts`. |
| F90-5 | behaviour | End to end on the fixture: a page with an iframe that loads `gtm.js` with `l=<layer>` not hooked, then a click step that navigates the main page, then a `mustNot` dataLayer rule with `after:` a later step. The record has the iframe loader with `frame.main` false and a `page`, a main-frame document request with the same `page` after it, and the flag `dataLayerNotHooked` naming the loader. The rule passes and exits 0. The test first asserts those three records. | `pnpm build`, then `pnpm exec vitest run --project e2e e2e/datalayer-frame-loader-nav.e2e.test.ts`. It fails on `main` with the warning. |
| F90-6 | guard | End to end: the same page with the click opening a popup that navigates leaves the warning. | The same file. |

Acceptance: F90-5 passes, and fails on `main`. F90-2 passes.

## Release

**RC90 Release prep for 0.9.0-rc.1.** Written as its own entry after every entry above has merged. The PR runs `scripts/bump-version.sh 0.9.0-rc.1`, which sets `package.json` and the version lines of the README, `docs/cli.md` and `docs/design.md`. It writes the `## 0.9.0-rc.1` section of `CHANGELOG.md` from the PR lines, the README "In 0.9.0-rc.1" line, design §15 item 9 and a new §15.9 "Differences in 0.9", and re-records `site/demo/` if `pnpm docs:test` shows a change. The release notes carry the part "Upgrading from 0.8" (see Flagged concerns for what it lists). It also updates the "Still open" text of the 0.8.0 item: #1640, #1648, #1591, #1611 and #1612 are fixed. `package.json` is gated, so the maintainer merges it, and CI publishes the release under `next`. No agent publishes, tags or starts the release workflow.

Touches: `package.json`, the "In 0.9.0-rc.1" line of `README.md`, the version lines of `README.md`, `docs/cli.md` and `docs/design.md`, the `## 0.9.0-rc.1` section of `CHANGELOG.md`, `docs/design.md` §15, `site/demo/`.

Acceptance: `pnpm exec vitest run --project unit scripts/bump-version.test.ts` and `pnpm docs:test` pass on the release-prep PR.

**R90 Release prep for 0.9.0.** Written after the rc.1 field test and any fix PRs. It runs `scripts/bump-version.sh 0.9.0`, turns the `## 0.9.0-rc.1` section into `## 0.9.0` with the fix lines added, and updates the README line and design §15. It follows the same rules as RC90. CI publishes it under `latest` after the maintainer merges.

Touches: `package.json`, the "In 0.9.0" line and the version lines of `README.md`, the version lines of `docs/cli.md` and `docs/design.md`, the `## 0.9.0` section of `CHANGELOG.md`, `docs/design.md` §15, `site/demo/`.

Acceptance: `pnpm exec vitest run --project unit scripts/bump-version.test.ts` and `pnpm docs:test` pass on the release-prep PR.

## After the PRs

After CI publishes each of 0.9.0-rc.1 and 0.9.0, run `node scripts/check-npm-dist-tag.ts <version>` and the install check in `AGENTS.md`.

The maintainer field-tests 0.9.0-rc.1 in `stub` mode, supervised, with a person at every payment and log-in handoff:

- **On a store with a server container behind a container that answers first,** run `tagreeve run` with `--network server --server-container` and a `sentBy: server` rule. Count the calls that were `probable` in 0.8.1 and are `exact` now, and read each failure that is new. L90 is judged here: a wrong link is a false failure.
- **On a store with Pinterest Conversions API in the container,** check that the call is decoded as `pinterest-capi` and links to the tag hit, and that the template's answer handling works with the `200` body.
- **On a store with a Google loader in an iframe,** check that a click that navigates the page no longer leaves the "could not all be read" warning.
- **Run a baseline made with 0.8.1 against 0.9.0-rc.1** and read the drift (see Flagged concerns).

## Flagged concerns

Upgrade notes (the "Upgrading from 0.8" part of the release notes lists these):

- **L90 turns some warnings into failures.** A server call behind a container that answers first, with one same-key hit and no concurrent request or consent change, is `exact` now. A `mustNot`, `deniedIdentifiers`, `earlyIdentifiers` or `identifierRoute` result that was a `serverSendProbableLink` warning is now a judged link that can fail the run and exit 1. The tests `a container that answers first stays probable, warns and exits 0` and the `answeredBefore` checks in the link-miss e2e file change on purpose.
- **L90 widens the meaning of `answeredBefore`.** It now covers a call more than 2000 ms after the answer and a call after a consent change. Scripts that count `answeredBefore` in `serverContainer.notExact` see fewer.
- **P90 adds a vendor, `pinterest-capi`.** A baseline made before 0.9.0 shows added hits for a run that records the call. A rule for `vendor: pinterest` is not changed. A custom tracker-list entry with the vendor key `pinterest-capi` is now refused, as for any decoder key. A browser request to `api.pinterest.com/v5/.../events` is now stubbed in `stub` mode, and its hit replaces the unknown destination flag.
- **F90 adds an optional `page` to `Request.frame` only.** The schema version stays 5. A script that compares frames with strict equality sees one more key. A record made before 0.9.0 reads as before.
- **N90 changes stored names.** A spaced or coloned event name that read `(other)` in a stored suite now reads as itself, so a `suite.json` made by 0.8 differs in `events` and `notInAccept`.
- **C90 item 3 can newly fail a run,** when a padded Base64 form of a canary was in a request before and went unseen.

Risks:

- **L90 is a proof by guards, not by sequence.** Two same-key hits are the main protection. A call whose real source is a browser request the recorder never saw (a request that bypassed the page) can still link to the one hit it sees. The 2000 ms window is a guess at how late a container's own tags send, so a slow tag chain loses the link and keeps the warning. The field test checks both. The window is not an option, so no user can raise it.
- **P90's name key is for Pinterest only,** and rests on the names in Pinterest's two doc pages. A custom event name that has a `_` on one side only would compare equal to a different name in rare cases. Rule (1) also needs the same event ID, so the pair is narrow. A tag event that Pinterest names differently on the two sides is not linked.
- **P90 does not decode the tag's `custom` event name.** A custom event keeps the name the tag sends. The key only removes case and `_`.
- **F90 can end an iframe's document too early.** A main-frame document request that does not replace the page (an answer of 204, or a download that is not aborted) ends the loader's document in the model, as it already does for a main-frame loader. That is the unsafe direction (a false pass). It is rare, and the field test looks for it.
- **N90 keeps a name made of letters only.** A random token cut into words reads as itself. The product searches for no canary like that, since a canary has many digits or an `@`. An identity first name, last name, city or email local part split into words (no `@`, 3 or fewer digits) is kept too. A reviewer who wants it refused needs another rule, not a tighter cap. 
- **N90 can drop a real name.** A name with four or more digits and a space, such as `Event 2026 11 25`, reads `(other)`.
- **C90 is not a path real runs take.** The three cases are edge cases. The e2e cases use hand-built input.
- **A flaky test is reported, not patched.** `runner.test.ts`, `run.test.ts`, a timing case in `diff.test.ts` and `scripts/release-*.test.ts` time out on some machines. The second test of `e2e/unload-gap-frame-nav.e2e.test.ts` is known flaky (#1608). Two other e2e files hold the 800 ms stand-in timer that G81 removed from the Stape test (`e2e/server-container-rejected.e2e.test.ts` and `e2e/server-container.e2e.test.ts`).

## Out of scope

| Item | Why it waits |
| --- | --- |
| A longer or configurable 2000 ms window for L90 | The maintainer fixed it at 2000 ms. A later release can add an option if the field test shows a need. |
| A new `HitLinkMiss` reason for a late answer or an epoch start | It is a record change. `answeredBefore` covers both. |
| Linking Pinterest calls by a client ID or by identity | #1648 asks for the event ID only. |
| Decoding other Pinterest endpoints (`/v5/.../events` with `test=true`, the batch or the user-list APIs) | Out of the issue. Only the events endpoint is decoded. |
| A detach time on frames | F90 uses a page number, which is enough. |
| Letters-only value checks for spaced names | No value the product searches for is letters only. |
| Slice 3 of #1391 (observed runtime IDs, `document.cookie` and storage hooks, body decompression) | Only if a field test finds real leaks. |
| Other Backlog issues | Not in the 0.9.0 milestone. |
| An MCP server (#362) | AGENTS.md: CLI only. |
