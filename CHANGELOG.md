# Changelog

## 0.9.1

`npm i -g tagreeve` installs this release. 0.9.1 is a patch release after 0.9.0. It has no new command, option or record field. The record stays at schema version 5. A 0.9.0 record reads as before.

### Fixes in 0.9.1

- Variables: a `{name}` inside a variable value is now filled, three levels deep too, in the start URL and in every visit path. A variable cycle exits 2 before the recorder starts and names the place and the variables, never a value. A canary run plants the canaries on the fully filled start (#1666, #1671).
- `identifierRoute`: a padded Base64 SHA-256 digest of a canary or of the identity email now reads transform `sha256`, as the unpadded digest does. A canary followed by `=` reads `plain` (#1667, #1670).

### Upgrading from 0.9.0

- **A nested variable now opens the filled page, so checks can fail where they passed.** A start URL or visit path that used a variable holding a `{name}` opened the literal `%7Bname%7D` path in 0.9.0, and the run could exit 0 on the wrong page. It now opens the filled page, and the rules run against that page.
- **A variable cycle exits 2.** A cycle made by `{a}` and `{b}` pointing at each other, in the config or in a `--var` value, stops the run before the recorder starts.
- **A `#` in a used variable now runs.** 0.9.0 refused a canary run when a used variable held a `#`. It now runs, with the canaries planted before the `#`.
- **A padded digest reads `sha256` and a canary followed by `=` reads `plain`.** Report rows and route lines that were split between `other` and the plain form now merge. No verdict changes.
- **A new release needs a new server image.** On arm64 (Apple silicon), run `tagreeve server-container build` after `npm i -g tagreeve`. A run with `--server-container` exits 2 with "The image tagreeve-sgtm:<version> is not available" until the image for that version exists. On amd64 the command builds nothing.

### Known in 0.9.1

Issues still open that you can meet, in addition to those in 0.7.0:

- The canary search reads only the forms it lists. It skips gzip and binary bodies, bodies cut at 64 KiB and net-log requests with no body, and it does not search headers. A pass means no planted value was found in the searched forms.
- The Stape loader unwrap covers `/g/collect` and `/data`. Stape's hosting layer may act on a loader request in other ways, and the record says so in fixed text.

## 0.9.0

`npm i -g tagreeve` installs this release. 0.9.0 is the final release after 0.9.0-rc.1, with no changes since the candidate. It has no new command or option. The record stays at schema version 5, and a 0.8 record reads as before. It was field-tested on a real store with no regressions.

### What 0.9.0 adds

- Decode Pinterest Conversions API calls from server containers as `pinterest-capi`, and link them to browser hits by event ID (#1648, #1663).

### Fixes in 0.9.0

- Server container: a call that arrives up to 2000 ms after its one same-key hit was answered, with no other same-client request or consent change between, is now an exact client-ID link, so a rule that only warned on it can now fail the run (#1640, #1659).
- Canaries: a control character inside a reserved name is refused, a `#` in an unused variable no longer refuses the run, and padded Base64 SHA-256 digests of canary and identity values now match (#1612, #1660).
- Consent matrix keeps event names with spaces or colons when they read as names (#1611, #1661).
- `dataLayer`: an iframe loader is bounded by a main-frame navigation of its page. A popup's first document request now has a frame, so a main-frame loader followed only by a popup navigation can warn (#1591, #1664).

### Upgrading from 0.8

- **Some warnings are now failures.** A server call behind a container that answers first, with one same-key hit and no concurrent request or consent change, is `exact`. A `mustNot`, `deniedIdentifiers`, `earlyIdentifiers` or `identifierRoute` result that was a `serverSendProbableLink` warning is now a judged link that can fail the run and exit 1.
- **`answeredBefore` and `concurrentRequest` cover different calls.** `answeredBefore` keeps its meaning and covers fewer calls: only a call more than 2000 ms after the answer, after a consent change, or with no answer time. An answered call with a concurrent request is now `concurrentRequest` where it was `answeredBefore`. Scripts that count either reason in `serverContainer.notExact` see different numbers.
- **A new vendor, `pinterest-capi`.** A baseline made before 0.9.0 shows added hits for a run that records the call. A rule for `vendor: pinterest` is not changed. A custom tracker-list entry with the vendor key `pinterest-capi` is now refused, as for any decoder key. A browser request to `api.pinterest.com/v5/.../events` is now stubbed in `stub` mode, and its hit replaces the unknown destination flag.
- **`Request.frame` has an optional `page`.** The schema version stays 5. A script that compares frames with strict equality sees one more key. A record made before 0.9.0 reads as before.
- **Stored event names change.** A spaced or coloned event name that read `(other)` in a stored suite now reads as itself, so a `suite.json` made by 0.8 differs in `events` and `notInAccept`.
- **A canary can newly fail a run.** A padded Base64 SHA-256 digest of a canary value, or of the identity email or phone, that was in a request before and went unseen is now found. A route flag for it reads transform `other`.
- **A new release needs a new server image.** On arm64 (Apple silicon), run `tagreeve server-container build` after `npm i -g tagreeve`. A run with `--server-container` exits 2 with "The image tagreeve-sgtm:<version> is not available" until the image for that version exists. On amd64 the command builds nothing.

### Known in 0.9.0

Issues still open that you can meet, in addition to those in 0.7.0:

- The canary search reads only the forms it lists. It skips gzip and binary bodies, bodies cut at 64 KiB and net-log requests with no body, and it does not search headers. A pass means no planted value was found in the searched forms.
- The Stape loader unwrap covers `/g/collect` and `/data`. Stape's hosting layer may act on a loader request in other ways, and the record says so in fixed text.

## 0.8.1

`npm i -g tagreeve` installs this release. 0.8.1 is a patch release after 0.8.0. It has no new command, option or record field. The record stays at schema version 5. A 0.8.0 record reads as before.

### Fixes in 0.8.1

- `diff --by-page` prints only the path of a recorded page after `recorded as`, never the query or the fragment, and `diff --json` holds the same path in `page`. A canary run's fake `TEST-` click IDs no longer reach the diff output. A recorded page that is not a URL is cut at the first `?` or `#`, and shown as `(other)` when what is left does not start with `/`. Baseline keys do not change (#1606).
- The `identifierRoute` pass message no longer says "No planted value found" when every route went to a host in `options.identifierRouteAllow`. It now starts "No planted value reached a judged sink;", then names the allowed hosts. `pass`, severity and evidence do not change (#1634).
- The Stape loader e2e test stand-in exits 300 ms after its first health answer, so the exit no longer races the container start (#1625). This changes a test only.

### Upgrading from 0.8.0

- **A script that reads the `recorded as` text of `diff --by-page`, or `page` in `diff --json`, sees a path where it saw a URL.**
- **A new release needs a new server image.** On arm64 (Apple silicon), run `tagreeve server-container build` after `npm i -g tagreeve`. A run with `--server-container` exits 2 with "The image tagreeve-sgtm:<version> is not available" until the image for that version exists. On amd64 the command builds nothing.

### Known in 0.8.1

Issues still open that you can meet, in addition to those in 0.7.0:

- A server GA4 hit behind a container that answers before its call stays `probable` (#1640), so its identifier routes warn with `serverSendProbableLink`.
- A Pinterest Conversions API call to api.pinterest.com gets no link to a browser hit, so its identifier routes warn under accept (#1648).
- The canary search reads only the forms it lists. It skips gzip and binary bodies, bodies cut at 64 KiB and net-log requests with no body, and it does not search headers. A pass means no planted value was found in the searched forms.
- The Stape loader unwrap covers `/g/collect` and `/data`. Stape's hosting layer may act on a loader request in other ways, and the record says so in fixed text.

## 0.8.0

`npm i -g tagreeve` installs this release. 0.8.0 adds everything in the 0.8.0 release candidates (below), with no code change after rc.4. It has no new command. The record stays at schema version 5. To upgrade from 0.7.0, read the next section.

### What 0.8.0 adds

- A consent audit. `suite --consent accept,reject,none,withdraw` runs each scenario once per consent state and prints what each vendor got in each state. `options.canaries: true` plants six fake click IDs on the start URL, and the run follows each canary, and the run's own identity, to the vendor requests it reaches: through the page URL, a first-party cookie or the local server container. The `identifierRoute` built-in check fails when a canary reaches a vendor that the consent in force did not allow. `options.identifierRouteAllow` lists hosts it does not judge, such as a consent tool's own hosts. The HTML report of a consent suite has a Consent audit section, and the run report an Identifier routes section with one row per group of routes.
- Server container: a Stape loader request for `/g/collect` or `/data` goes to the local container at its real path, and a server GA4 hit behind a Stape loader links to its browser hit by client ID. A request with a replaced secret lists the secret names, never a value.
- Server container links: a server call links to a browser hit by event ID only when the hit was sent at or before the call. A Meta Conversions API call also links by event ID to a pixel hit sent up to 5 s after it, when no consent epoch starts in between.
- Server container: for `deniedIdentifiers` and `earlyIdentifiers`, an unlinked server call is judged by its own send time when its epoch is granted. A call sent in a denied, undecided, mixed or withdrawn epoch, or in none, stays `cannot evaluate` with `serverSendUnlinked`.
- Install docs give `npm i -g tagreeve` for the final release and name the tag for release candidates.
- 0.8.0 was field-tested on a real Shopify store with a first-party server container, through rc.1 to rc.4.

### Fixes in 0.8.0

- Server-side rules read `cannot evaluate`, with the `serverContainerRejected` note, when the container rejects most browser requests. They failed or passed on missing data before.
- The identity matcher counts an email or phone as the run's own only when the whole value matches.
- `idHandover` compares session IDs per client ID.
- `dataLayer` rules: a `dataLayerNotHooked` loader survives an aborted navigation and a popup or other frame, and a `__proto__` type path is checked.
- Consent commands read a nested array and ignore `gtm.` keys in an indexed consent default.
- `diff` shows a `dataLayer` path that moved to a neighbouring consent epoch as one moved path.
- A baseline compare gives one warning, not drift, when a gcd letter changes between `p` and `q`, or between `t` and `v`.
- `addToCart` failures name the store's status and the cart path, and a 429 is named as rate limited.
- A late browser hit no longer takes a false event ID link after a consent withdrawal.
- The fixture site sends the relay page view after the consent step.

### Upgrading from 0.7.0

- **A new built-in check can fail.** `identifierRoute` fails by default, but only for a run with `options.canaries: true`. A run without canaries is not affected.
- **Server-side rules can read cannot evaluate.** When the local container rejects most browser requests, a `sentBy: server` rule or a rule with no `sentBy` now warns where 0.7.0 failed or passed.
- **The identity matcher is stricter.** It counts only a whole email or phone value, so a run can show a foreign value that 0.7.0 hid.
- **A moved `dataLayer` path is one line in `diff`.** `diff --json` gets `dataLayer.pathsMoved`.
- **Server hits are recorded for `*.google-analytics.com`.** The local container's own GA4 calls to `*.google-analytics.com` are recorded, so a rule such as `mustNot: { vendor: ga4, host: region1.google-analytics.com }` now matches server hits too. Add `sentBy: browser` to keep it to browser hits.
- **A new release needs a new server image.** On arm64 (Apple silicon), run `tagreeve server-container build` after `npm i -g tagreeve`. A run with `--server-container` exits 2 with "The image tagreeve-sgtm:<version> is not available" until the image for that version exists. On amd64 the command builds nothing.
- **The record stays at version 5.** A 0.7.0 record reads as before.

### Known in 0.8.0

Issues still open that you can meet, in addition to those in 0.7.0:

- A server GA4 hit behind a container that answers before its call stays `probable` (#1640), so its identifier routes warn with `serverSendProbableLink`.
- A Pinterest Conversions API call to api.pinterest.com gets no link to a browser hit, so its identifier routes warn under accept (#1648).
- `diff --by-page` can print the fake `TEST-` canary values from a canary run's page URL (#1606).
- The canary search reads only the forms it lists. It skips gzip and binary bodies, bodies cut at 64 KiB and net-log requests with no body, and it does not search headers. A pass means no planted value was found in the searched forms.
- The Stape loader unwrap covers `/g/collect` and `/data`. Stape's hosting layer may act on a loader request in other ways, and the record says so in fixed text.

## 0.8.0-rc.4

The fourth release candidate, after the rc.3 field test. Install it with `npm i -g tagreeve@next`. It has no new command. The record stays at schema version 5. To go back to the final release, run `npm i -g tagreeve`.

- Server container: for `deniedIdentifiers` and `earlyIdentifiers`, an unlinked server call is judged by its own send time when its epoch is granted in both the label and the consent state. A Google hit that states its own consent must state every field granted. The pass message counts it as judged by its send time (granted). A call sent in a denied, undecided, mixed or withdrawn epoch, or in none, stays `cannot evaluate` with `serverSendUnlinked` (#1645, #1644).
- On arm64 (Apple silicon), run `tagreeve server-container build` after `npm i -g tagreeve@next`. A run with `--server-container` exits 2 with "The image tagreeve-sgtm:<version> is not available" until the image for that version exists. On amd64 the command builds nothing.

### Known in 0.8.0-rc.4

- A server GA4 hit behind a container that answers before its call stays `probable` (#1640), so its identifier routes warn with `serverSendProbableLink`.
- A Pinterest Conversions API call to api.pinterest.com gets no link to a browser hit, so its identifier routes warn under accept.

## 0.8.0-rc.3

The third release candidate, after the rc.2 field test. Install it with `npm i -g tagreeve@next`. It has no new command. The record stays at schema version 5. To go back to the final release, run `npm i -g tagreeve`.

- Server container: a Meta Conversions API call links by event ID (of at least 8 characters) to a pixel hit sent up to 5 s after the call, when no consent epoch starts between the call and the hit. A hit across a consent change still does not link (#1641, #1639).
- On arm64 (Apple silicon), run `tagreeve server-container build` after `npm i -g tagreeve@next`. A run with `--server-container` exits 2 with "The image tagreeve-sgtm:<version> is not available" until the image for that version exists. On amd64 the command builds nothing.

### Known in 0.8.0-rc.3

- A server GA4 hit behind a container that answers before its call stays `probable` (#1640), so its identifier routes warn with `serverSendProbableLink`.

## 0.8.0-rc.2

The second release candidate, after the rc.1 field test. Install it with `npm i -g tagreeve@next`. It has no new command. The record stays at schema version 5. To go back to the final release, run `npm i -g tagreeve`.

- Server container: a server call links to a browser hit by event ID only when the browser hit was sent at or before the call, so a late hit no longer takes a false link after a consent withdrawal (#1632, #1628, #1629).
- Server container: a server GA4 hit behind a Stape loader links to its browser hit by client ID, read from the loader request's real query (#1633, #1627).
- A new scenario option, `options.identifierRouteAllow`, lists hosts the `identifierRoute` check does not judge, such as a consent tool's own hosts. It takes the same `*.domain` form as `firstPartyHosts`. The result message counts the allowed routes per host (#1635, #1631).
- The run report and the consent audit column show one row per group of identifier routes, not one row per flag. A group shares the host, field, transform, route kind, epoch and verdict (#1636, #1630).

## 0.8.0-rc.1

The first release candidate of 0.8.0. Install it with `npm i -g tagreeve@next`. 0.8.0-rc.1 adds a consent audit and fixes after 0.7.0. It has no new command. The record stays at schema version 5. To go back to the final release, run `npm i -g tagreeve`.

### What 0.8.0-rc.1 adds

- A consent matrix. `suite --consent accept,reject,none,withdraw` runs each scenario once per consent state as a cell, with its own record and table column, and prints what each vendor got in each state. `withdrawWith` is a scenario option, and `suite.json` gets an optional `consentMatrix` (#1391).
- Canaries. `options.canaries: true` plants six fake click IDs on the start URL (gclid, gbraid, wbraid, fbclid, msclkid, ttclid). A start URL that already holds one of them exits 2. The summaries name the canaries and never print a value (#1391).
- Identifier routes. A run follows a canary or the run's own identity to the vendor requests it reaches: direct, through the page URL, through a first-party cookie or through the local server container. The `identifierRoute` and `canarySearch` flags say what was found and what was searched or skipped (#1391).
- The `identifierRoute` built-in check. It fails when a canary reaches a vendor that the consent in force did not allow, and warns on a page URL route alone. Runs without canaries keep their results and exit codes. Set it with `builtins: { identifierRoute: warn }` (#1391).
- The consent audit report. The HTML report of a consent suite has a Consent audit section, and the run report an Identifier routes section (#1391).
- Server container: a Stape loader request for `/g/collect` or `/data` goes to the local container at its real path, where it got a 404 before. The Server container line adds the count (#1622).
- Server container: a request with a replaced secret lists the secret names in `secretsRedacted`, never a value (#1585).
- Install docs give `npm i -g tagreeve`, and `@next` for the newest release candidate (#1587).
- Docs name the earlier fixes, the `platformHost` flag, the Server container counts and the consent command forms (#1583, #1533, #1532).

### Fixes in 0.8.0-rc.1

- Server-side rules read cannot evaluate, with the `serverContainerRejected` note, when the container rejects most browser requests. They failed or passed on missing data before (#1579).
- The identity matcher counts an email or phone as the run's own only when the whole value matches, so foreign values that merely contain it are reported (#1519).
- `idHandover` compares session IDs per client ID, so another client's session cannot hide a difference (#1531).
- `dataLayer` rules: a `dataLayerNotHooked` loader survives an aborted navigation and a popup or other frame, an unknown key that looks like a value is masked in the error, and a `__proto__` type path is checked (#1530).
- Consent commands read a nested array and ignore `gtm.` keys, such as the `gtm.uniqueEventId` stamp, in an indexed consent default (#1532, #1513).
- `diff` shows a `dataLayer` path that moved to a neighbouring consent epoch as one moved path, not a missing path plus a new path (#1584).
- A baseline compare gives one warning, not drift, when a gcd letter changes between `p` and `q`, or between `t` and `v` (#1569).
- `addToCart` failures name the store's status and the cart path, and a 429 is named as rate limited (#1576).
- The fixture site sends the relay page view after the consent step (#1618).

### Upgrading from 0.7.0

- **A new built-in check can fail.** `identifierRoute` fails by default, but only for a run with `options.canaries: true`. A run without canaries is not affected.
- **Server-side rules can read cannot evaluate.** When the local container rejects most browser requests, a `sentBy: server` rule or a rule with no `sentBy` now warns where 0.7.0 failed or passed.
- **The identity matcher is stricter.** It counts only a whole email or phone value, so a run can show a foreign value that 0.7.0 hid.
- **A moved `dataLayer` path is one line in `diff`.** `diff --json` gets `dataLayer.pathsMoved`.
- **Server hits are recorded for `*.google-analytics.com`.** Since #1622 the local container's own GA4 calls to `*.google-analytics.com` are recorded, so a rule such as `mustNot: { vendor: ga4, host: region1.google-analytics.com }` now matches server hits too. Add `sentBy: browser` to keep it to browser hits.
- **A new release needs a new server image.** On arm64 (Apple silicon), run `tagreeve server-container build` after `npm i -g tagreeve@next`. A run with `--server-container` exits 2 with "The image tagreeve-sgtm:<version> is not available" until the image for that version exists. On amd64 the command builds nothing.
- **The record stays at version 5.** A 0.7.0 record reads as before.

### Known in 0.8.0-rc.1

Issues still open that you can meet, in addition to those in 0.7.0:

- The canary search reads only the forms it lists. It skips gzip and binary bodies, bodies cut at 64 KiB and net-log requests with no body, and it does not search headers. A pass means no planted value was found in the searched forms.
- Observed runtime IDs are not searched. Only the planted click IDs and the run's identity are (#1391, slice 3).
- The Stape loader unwrap covers `/g/collect` and `/data`. Stape's hosting layer may act on a loader request in other ways, and the record says so in fixed text.

## 0.7.0

`npm i -g tagreeve` installs this release. 0.7.0 adds everything in the 0.7.0 release candidates (below), with no code change after rc.4. It has no new command. The record stays at schema version 5. To upgrade from 0.6.2, read the next section.

### What 0.7.0 adds

- Three new built-in checks, each `warn` by default and settable to `fail`. `earlyIdentityPush` warns when a `dataLayer` push carries the run's own test email or phone, or a hash of either, before consent, and never prints the value. `idHandover` warns when the GA4 client ID, or the session ID where the client ID matches, differs between two contexts of one measurement ID, and never prints an ID. `serverContainerRejected` warns when the local server container rejects more than half of the browser requests it gets, and at least 2, and the `Server container` line then says how many.
- Rules on dataLayer pushes: `dataLayer: { event, has, types, kind, frame }` in `must` and `mustNot` checks which pushes a page makes, by event name, key paths and types, and reads each push in full. It never reads or prints a pushed value.
- Consent Mode setup check: a `consent default` pushed as a plain object, for example relayed from a sandboxed frame, counts as pushed.
- `diff` keeps a cross-epoch join of a renamed event.
- The fixture site has a plain GTM demo shop under `/plain/`, and the docs mark the Shopify-specific options.
- The npm package includes `CHANGELOG.md`, and releases are published from CI with npm provenance.
- Fixes in the release candidates: the `earlyIdentityPush` masking of keys that hold the email local part, the `idHandover` message for one context, and the CA certificates of the server container runner.

### Upgrading from 0.6.2

- **Three new built-in checks can warn.** `earlyIdentityPush` and `idHandover` warn by default, so a run that passed cleanly in 0.6.2 can now show a warning. `serverContainerRejected` runs only with `--server-container`. Set any of them to `fail` in `builtins` to make it fail the run. A warning does not change the exit code.
- **A `consent default` pushed as a plain object now counts for `consentModeSetup`.** A run that warned on it in 0.6.2 can pass.
- **`dataLayer:` is a new rule kind.** An existing scenario is not affected.
- **`diff` keeps a cross-epoch join.** A renamed event that 0.6.2 showed as moved or as removed and added can now show as one joined pair.
- **The record stays at version 5.** A 0.6.2 record reads as before.

### Known in 0.7.0

Issues still open that you can meet:

- `network: stub` and `server` mode can still let a hit reach a real vendor account, for an unknown destination in `stub` and for a hosted `serverHosts` host in `server`.
- Records keep the full flag detail, including query values. Do not share a record from a page that sends an identifier in a query.
- `--server-container` needs Docker. The container downloads its configuration from Google at every start, so a run needs the network for three Google paths, and Google sees the container's request with your `gtm_auth`.
- The local container is Google's image. Stape-only features are missing, and with the live config it serves the published version. To test an unpublished server workspace, use a config from its preview environment.
- On a multi-page run a server container call rarely links `exact` by client ID, because later calls see several hits with the same client ID. `serverContainer.notExact` counts these calls.
- Sends from `pagehide` or `visibilitychange` are answered in the page, also to your `serverHosts`, so the container never gets them.
- The Meta Conversions API, Pinterest and Criteo template tags are not yet proven to reach the recording proxy.
- The `payment` step is not confirmed on a real Shopify checkout. The test-mode marker on the page, the expiry format and the card frame paths are inferred. If one does not match, the step fails closed and the error names the frame path and the inputs' attributes. It checks the card host before each short fill try, which narrows the window in which typing could go to another host but cannot close it.
- The payment hang fix (#1339) and the server-mode link fixes (#1029, #1223) are covered by tests. They were not tried on a real store.
- The Shopify platform-host list holds only hosts that a Shopify docs page names. Other Shopify hosts stay `unknownDestination`.
- Playwright's request interception sometimes misses a redirect hop. The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload`.
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is not built.
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- Page code that sabotages itself on purpose can still hide the untrapped list of the `dataLayer` count check (#1442).
- `diff` moves events of the same name with no join in a greedy order, so with several of them the pairing can differ from the one you expect.
- A consent update pushed as a plain object does not move the consent epoch. Only the Consent Mode setup check reads it, so a later hit can still be labelled with the earlier epoch.
- The reporter's own entry is in `tags[]` once for each event. The timeout status and the version string of a published container are field checks.
- A report sent while the page navigates can be lost, so `notFired` can list a tag that fired.
- Any page script can call the binding or change what the tally reads, so a tag report and the count check are what the page said, not proof.
- The server tag reporter is not built.
- The `dataLayer` hook after real `gtm.js` re-wraps, and `gtm.uniqueEventId` on real pushes, are field checks (#922). Arguments-like pushes from the pixel sandbox are read as `gtag` commands in shapes only.
- The count check compares only the document each frame holds when the run closes. A page that replaced `push` on an earlier page of the run only is not flagged, and a page that edits its `dataLayer` in place can be flagged.
- `consentModeSetup` reads the `gcd` letters, whose format is documented only by the community.
- Hits and pushes are not joined per frame (#931, #932).
- A blocking control with no `aria-label`, `name` or `id` has no name in a `wait` timeout message.
- A baseline can drift on one GA4 hit whose `gcd` differs only between a consent default and a default plus update for the same consent state, so two runs of one scenario can give drift and no drift (#1569).
- When the store rate-limits the session, an `addToCart` step fails with "click did not add to cart" and does not name the 429 answer (#1576).
- Other `review-minor` issues are open. They are test gaps, wording, build edge cases and a vendor name table.

## 0.7.0-rc.4

The fourth release candidate, after the rc.3 field test. Install it with `npm i -g tagreeve@next`.

- New built-in check `serverContainerRejected`: with `--server-container`, it warns when more than half of the browser requests to the local server container, and at least 2, get status 400 or higher or no response. The message gives counts and status codes only, for example `22 of 27 requests to the server container were rejected (400: 22).` The `Server container` line then ends with `; <n> of <m> requests rejected`. It is `warn` by default and can be set to `fail`. Runs without a server container keep their results (#1570).
- The package is published from CI with npm provenance. A merged version bump on main tags, checks and publishes the release, and `scripts/bump-version.sh` sets the version in `package.json` and the docs (#1573).
- The Public Suffix List in `tldts` is updated to 7.4.19.

## 0.7.0-rc.3

The third release candidate, after the rc.2 field test. Install it with `npm i -g tagreeve@next`.

- `earlyIdentityPush` reads a `dataLayer` key as `(other)` when it holds the local part of the test email, with any run of separators, next to an at-marker, or next to the domain label when the key ends there, a separator follows or the next domain label follows. A key that only starts like the domain label, such as `user_examples`, is shown (#1555).
- `idHandover` with one qualifying context still passes, and its message now says nothing was compared, for example `Only one context qualified for comparison (checkout), so nothing was compared.` (#1563).
- The npm package includes `CHANGELOG.md` (#1564).
- The CA certificates that Tagreeve makes for the server container runner always load, because the serial is now always a minimal positive DER integer (#1560).
- Release checks: `scripts/release.sh` and the npm dist-tag checker accept the same versions, `X.Y.Z` or `X.Y.Z-rc.N` with ASCII digits, and `check-docs-dist.ts` runs its checks on Node 23.x and 24.0 and 24.1 (#1556, #1559).

Tests: a fixture for `idHandover` with GA4 hits from the top frame and a sandbox frame, and a steadier e2e test. No change in output (#1557, #1558).

## 0.7.0-rc.2

The second release candidate, after the rc.1 field test. Install it with `npm i -g tagreeve@next`.

- `earlyIdentityPush` no longer masks an ordinary key because it merely contains a short local part of the test email, so `user.email` shows as it is with `user@example.test`. A key that holds the email next to an at-marker or the domain, or a local part of 6 characters or more, still reads `(other)` (#1517).
- Rules on dataLayer pushes: messages read `found 2 pushes` and `b should be string, found number in 1 push`, and a passing rule names the types it checked (#1536).
- A `must` or `mustNot` dataLayer rule reads each push in full, so a path past the first 200 paths or past depth 8 no longer gives a wrong result: a `mustNot` no longer passes while the push holds the path, and a `must` with `types` or a count no longer misreads it. The push shapes in `--json`, `diff` and baselines keep their caps (#1521).
- Docs: `docs/cli.md` no longer says `evaluate` runs `earlyIdentityPush` on an older run (#1537).
- Release steps: publish by hand after the `release-tag` workflow passes, then run `scripts/check-npm-dist-tag.ts` to check the npm tag (#1535, #1546).

Tests and cleanup: the diff test for many joins no longer depends on the clock, one e2e test is steadier, and the agent rules name the plan order. No change in output. Issues: #1526, #1504, #1507.

## 0.7.0-rc.1

Release candidate. Install it with `npm i -g tagreeve@next`.

0.7.0-rc.1 adds two built-in checks and a rule kind for `dataLayer` pushes, fixes `diff` and the Consent Mode setup check, and adds a plain GTM demo shop to the fixture site. It has no new command. The record stays at schema version 5.

### What 0.7.0-rc.1 fixes and adds

- The fixture site has a plain GTM demo shop under `/plain/`, with no Shopify page. The docs mark `sandboxPageUrl`, `platformHost` and `options.platformHosts` as Shopify-specific.
- `diff` keeps a cross-epoch join of a renamed event. Before, a second search could move it to another epoch or report it as removed and added. The greedy order of same-name moves with no join is a known limit (#1457, #1465).
- Consent Mode setup check: a `consent default` pushed as a plain object with index keys, for example relayed from a sandboxed frame, now counts as pushed (#1401).
- Rules on dataLayer pushes: `dataLayer: { event, has, types, kind, frame }` in `must` and `mustNot` checks which pushes a page makes, by event name, key paths and types. It never reads or prints a pushed value, takes `before`, `in`, `after`, `from` and `count`, and warns when the dataLayer hook is incomplete in scope (#936).
- New built-in check `earlyIdentityPush`: it warns when a `dataLayer` push carries the run's own test email or phone, or a hash of either, before consent. It names the push, key path and kind and never prints the value. It is `warn` by default and can be set to `fail` (#1392, #937).
- New built-in check `idHandover`: it warns when the GA4 client ID, or the session ID where the client ID matches, differs between two contexts of one measurement ID, such as a checkout in a frame or on another host. It names the measurement ID and both contexts and never prints an ID. It is `warn` by default and can be set to `fail` (#934).
- Docs: the 0.6.2 notes are corrected, and the card fill ends "at the step deadline" in `docs/cli.md` (#1483, #1490, #1491, #1492, #1493, #1494, #1495, #1496).

Tests and cleanup: the request ID in the identity tests holds no digits, the docs test strip takes quoted and spaced placeholders, and the node-forge release-age exception is gone. No change in output. Issues: #1498, #1453, #1275.

### Upgrading from 0.6.2

- **Two new built-in checks can warn.** `earlyIdentityPush` and `idHandover` warn by default, so a run that passed cleanly in 0.6.2 can now show a warning. Set either to `fail` in `builtins` to make it fail the run. A warning does not change the exit code.
- **A `consent default` pushed as a plain object now counts for `consentModeSetup`.** A run that warned on it in 0.6.2 can pass.
- **`dataLayer:` is a new rule kind.** An existing scenario is not affected.
- **`diff` keeps a cross-epoch join.** A renamed event that 0.6.2 showed as moved or as removed and added can now show as one joined pair.
- **The record stays at version 5.** A 0.6.2 record reads as before.

### Known in 0.7.0-rc.1

Issues still open that you can meet:

- `network: stub` and `server` mode can still let a hit reach a real vendor account, for an unknown destination in `stub` and for a hosted `serverHosts` host in `server`.
- Records keep the full flag detail, including query values. Do not share a record from a page that sends an identifier in a query.
- `--server-container` needs Docker. The container downloads its configuration from Google at every start, so a run needs the network for three Google paths, and Google sees the container's request with your `gtm_auth`.
- The local container is Google's image. Stape-only features are missing, and with the live config it serves the published version. To test an unpublished server workspace, use a config from its preview environment.
- On a multi-page run a server container call rarely links `exact` by client ID, because later calls see several hits with the same client ID. `serverContainer.notExact` counts these calls.
- Sends from `pagehide` or `visibilitychange` are answered in the page, also to your `serverHosts`, so the container never gets them.
- The Meta Conversions API, Pinterest and Criteo template tags are not yet proven to reach the recording proxy.
- The `payment` step is not confirmed on a real Shopify checkout. The test-mode marker on the page, the expiry format and the card frame paths are inferred. If one does not match, the step fails closed and the error names the frame path and the inputs' attributes. It checks the card host before each short fill try, which narrows the window in which typing could go to another host but cannot close it.
- The payment hang fix (#1339) and the server-mode link fixes (#1029, #1223) are covered by tests. They were not tried on a real store.
- The Shopify platform-host list holds only hosts that a Shopify docs page names. Other Shopify hosts stay `unknownDestination`.
- Playwright's request interception sometimes misses a redirect hop. The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload`.
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is not built.
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- Page code that sabotages itself on purpose can still hide the untrapped list of the `dataLayer` count check (#1442).
- `diff` moves events of the same name with no join in a greedy order, so with several of them the pairing can differ from the one you expect.
- A consent update pushed as a plain object does not move the consent epoch. Only the Consent Mode setup check reads it, so a later hit can still be labelled with the earlier epoch.
- The reporter's own entry is in `tags[]` once for each event. The timeout status and the version string of a published container are field checks.
- A report sent while the page navigates can be lost, so `notFired` can list a tag that fired.
- Any page script can call the binding or change what the tally reads, so a tag report and the count check are what the page said, not proof.
- The server tag reporter is not built.
- The `dataLayer` hook after real `gtm.js` re-wraps, and `gtm.uniqueEventId` on real pushes, are field checks (#922). Arguments-like pushes from the pixel sandbox are read as `gtag` commands in shapes only.
- The count check compares only the document each frame holds when the run closes. A page that replaced `push` on an earlier page of the run only is not flagged, and a page that edits its `dataLayer` in place can be flagged.
- `consentModeSetup` reads the `gcd` letters, whose format is documented only by the community.
- Hits and pushes are not joined per frame (#931, #932).
- A blocking control with no `aria-label`, `name` or `id` has no name in a `wait` timeout message.
- Other `review-minor` issues are open. They are test gaps, wording, build edge cases and a vendor name table.

## 0.6.2

`npm i -g tagreeve` installs this release. 0.6.2 fixes many of the issues found in the review of 0.6.1. The rest are listed under Known in 0.6.2. It has no new command and no new option. The record stays at schema version 5. 0.6.1 was field-tested after its release, on a Shopify store with a real GTM web container.

### What 0.6.2 fixes

- A test payment ends by its deadline when a card frame stops answering before the fill. The reason reads `the card frame could not be read`. The grace after the deadline no longer restarts at each await, and the card fields share the step deadline (#1404, #1418, #1462).
- A click inside a submit button remembers the button's form for the next `wait` timeout. When that form is gone, the timeout lists every blocking control (#1419, #1415).
- The handoff label uses the room up to the pill's width limit, and the pill has a 14 px radius, so four lines are not cut at the corners (#1428, #1411).
- A scoped `must` rule tries every placement of the unlinked and probable server hits in scope. A probable hit is placed by its link, by its own time or left out. The rule warns when a placement could change the verdict. A rule with `body` or `identity.hashesMatch` tries every subset up to 10 such hits and always warns above 10. A plain exact count is searched by number with no cap. At-least and at-most counts try the same placements.
- An unload send no longer breaks a client ID link between a server hit and its browser hit.
- `diff`: a move or a kind change of a joined pair names the recorded event with `renamedFrom`, and a move has an optional `pushKind` in `--json`. A cross-epoch join forms only when it can become a move. The `push kind changed` warning says `(renamed from <name>)` for a joined pair. A kind change does not report the `event` key path (#1456).
- A `possibleRealDataPush` finding with no field path reads `in the push`, not `in the body`.
- `tagreeve init` creates nothing when one of its targets is refused (#1455).
- The plain-hash message names the vendors that sent the plain field. A plain city, postal code or country is judged by one rule for vendors that require hashes. A value that only a binary-edged or glued base64 token holds is counted next to a longer value it ends, not merged into it (#1349, #1350, #1352, #1007, #1162, #1470).
- Every duration key in a scenario fails with the same message: "must be a duration such as 4s, 500ms or 2m" (#1327).
- `template web` reads the template only from the recorder package. When the bundled file is missing, it exits 2 with an error and prints nothing else (#1180).
- `pnpm build --outdir` refuses a non-empty folder outside the repo that holds no build, and `pnpm test` no longer deletes `dist/` (#1468, #1181).
- The docs match the code on frame deadlines, `inputs not readable`, unload sends and the `event` key path of a kind change. Three lines of 0.6.1 are corrected (#1395, #1397, #1413, #1435, #1436, #1437, #1445, #1446, #1447, #1438, #1439, #1477, #1478, #1479, #1480, #1481).
- Site: the agent callout on a guide follows the first paragraph (#750). The finished demo hit list scrolls and keeps every hit (#837). The run panel shows its Result line (#838). The commands panel keeps its indent when copied and does not split `--site` (#835). The docs theme fade covers the header and the sidebar (#857). The demo reply check allows only the numbers a reply can state (#759).

Tests and cleanup: one rule or one owner for the folder names and the `Defaults:` line, Google loader URLs, layer names, GTM tag statuses, durations, push shapes, the event map, `GOOGLE_VENDORS`, `expectedTagsOf`, the "and N more" list helper and `gcdLetterAt`. `suite` lets a usage error go up to `main`, as `run` does, with the same text and exit code. The `dataLayer` hook, the unload gap, push shape, diff and payment tests check their inputs first and cover more cases. No change in output. Issues: #972, #1041, #1049, #1061, #1330, #1137, #1132, #1236, #1357, #1238, #1318, #1105, #1106, #1107, #1108, #1325, #1124, #1169, #1365, #954, #1380, #1425, #1312, #1317, #1251, #1252, #1291, #1209, #1379, #1243, #1355, #1359, #1358, #1300, #1218, #1217, #1171, #1172, #1212, #1213, #1116, #1117, #1118, #1178, #1332, #1186, #1150, #1224, #1222, #1305, #1307, #1167, #1378, #1144, #1341, #1146, #1192, #1244, #1340, #1195, #1155, #1156, #908, #1338, #1412, #1202, #1417, #1467, #1474, #760, #729, #866.

### Upgrading from 0.6.1

- **A `must` rule can warn where 0.6.1 failed.** With `--server-container`, a scoped rule now warns with `serverSendUnlinked` or `serverSendProbableLink` when some placement of the unlinked or probable-linked server hits in scope gives another verdict. This is true even when browser hits are in the evidence. A run that exited 1 in 0.6.1 can exit 0, and a rule that gave PASS can warn.
- **A call with an unload send keeps its client ID link.** A send from `pagehide` or `visibilitychange` no longer gives `concurrentRequest`.
- **The card fields share one step deadline.** A user cannot change it.
- **The handoff label is wider on a wide window** and still fits a narrow one.
- **A `wait` timeout lists every control** when the clicked form is gone from the page.
- **`diff --json` has new fields.** A `moved` or `kindChanged` entry can have `renamedFrom`, and a `moved` entry can have `pushKind`. A cross-epoch event join needs a neighbouring epoch.
- **A `possibleRealDataPush` finding with no path** reads `in the push`, not `in the body`.
- **`tagreeve init` refuses before it writes.** When a target is refused, it creates nothing.
- **A scenario with a bad duration key** fails with one message for every key.
- **The record stays at version 5.** A 0.6.1 record reads as before.

### Known in 0.6.2

Issues still open that you can meet:

- `network: stub` and `server` mode can still let a hit reach a real vendor account, for an unknown destination in `stub` and for a hosted `serverHosts` host in `server`.
- Records keep the full flag detail, including query values. Do not share a record from a page that sends an identifier in a query.
- `--server-container` needs Docker. The container downloads its configuration from Google at every start, so a run needs the network for three Google paths, and Google sees the container's request with your `gtm_auth`.
- The local container is Google's image. Stape-only features are missing, and with the live config it serves the published version. To test an unpublished server workspace, use a config from its preview environment.
- On a multi-page run a server container call rarely links `exact` by client ID, because later calls see several hits with the same client ID. `serverContainer.notExact` counts these calls.
- Sends from `pagehide` or `visibilitychange` are answered in the page, also to your `serverHosts`, so the container never gets them.
- The Meta Conversions API, Pinterest and Criteo template tags are not yet proven to reach the recording proxy.
- The `payment` step is not confirmed on a real Shopify checkout. The test-mode marker on the page, the expiry format and the card frame paths are inferred. If one does not match, the step fails closed and the error names the frame path and the inputs' attributes. It checks the card host before each short fill try, which narrows the window in which typing could go to another host but cannot close it.
- The payment hang fix (#1339) and the server-mode link fixes (#1029, #1223) are covered by tests. They were not tried on a real store.
- The Shopify platform-host list holds only hosts that a Shopify docs page names. Other Shopify hosts stay `unknownDestination`.
- Playwright's request interception sometimes misses a redirect hop. The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload`.
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is not built.
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- A test identity pushed to the `dataLayer` before consent is not reported yet. A check is planned for 0.7.0 (#1392).
- Page code that sabotages itself on purpose can still hide the untrapped list of the `dataLayer` count check (#1442).
- `diff` can undo a cross-epoch join when it matches moved events by epoch (#1457).
- The reporter's own entry is in `tags[]` once for each event. The timeout status and the version string of a published container are field checks.
- A report sent while the page navigates can be lost, so `notFired` can list a tag that fired.
- Any page script can call the binding or change what the tally reads, so a tag report and the count check are what the page said, not proof.
- The server tag reporter is not built.
- The `dataLayer` hook after real `gtm.js` re-wraps, and `gtm.uniqueEventId` on real pushes, are field checks (#922). Arguments-like pushes from the pixel sandbox are read as `gtag` commands in shapes only, so consent commands in them do not count as a `consent default` push for `consentModeSetup`.
- The count check compares only the document each frame holds when the run closes. A page that replaced `push` on an earlier page of the run only is not flagged, and a page that edits its `dataLayer` in place can be flagged.
- `consentModeSetup` reads the `gcd` letters, whose format is documented only by the community.
- Hits and pushes are not joined per frame (#931, #932).
- A blocking control with no `aria-label`, `name` or `id` has no name in a `wait` timeout message.
- Other `review-minor` issues are open. They are test gaps, wording, build edge cases and a vendor name table.

## 0.6.1

`npm i -g tagreeve` installs this release. 0.6.1 fixes three leaks and a set of smaller bugs found after 0.6.0. It has no new command and no new option. The record stays at schema version 5.

### What 0.6.1 fixes

- A `dataLayer` push that holds an email, phone or hash that is not from the run identity now gets a `possibleRealDataPush` flag. It is a warning: the `possibleRealData` check does not count it and the exit code does not change. The flag detail names the push and the key paths, never the value. The text summary shows one `possibleRealDataPush: x<n>` line. The second half of #937, a failing check for a test identity pushed before consent, is #1392 and is planned for 0.7.0 (#937, #1322).
- A tag name with a hex token after a character such as `!`, `$`, `^` or `~` reads `(other)` (#1322).
- `diff` names an event as the run pushed it. A pair joined by the event table or an event map shows `renamedFrom` in `--json` and `(renamed from <name>)` in the text (#1246). `changed` is true when a push kind changed (#1370).
- An event map error gives a key position and no key text, and positions follow the order written in the file. A swap or chain map applies each `paths` entry to one event (#1316, #1314, #1315).
- An arguments-like `consent` push other than `default` or `update` reads `gtag consent`, and an arguments-like `gtm.*` event has no paths (#1373).
- `consentModeSetup` names a hit with no tag ID by its vendor, lists letter sets with an `l` first and counts the tag IDs it leaves out. A page parameter can no longer set the Google Ads conversion ID (#1306, #1308, #1309, #1385).
- A baseline whose `dataLayer` push groups are partly kinded is refused as an invalid `dataLayer` section (#1374). The warning for a baseline with no `dataLayer` section says `saved before 0.6.0-rc.2`.
- `tagreeve init` exits 2 with `tagreeve/config.yml is not a file` when a folder is at that path, instead of skipping it (#1329).
- A `wait` timeout after a click on a form's submit control lists only the blocking controls of that form (#990).
- A test payment fill cannot hang past its deadline when a card frame stops responding (#1339).
- The handoff label is at most 300 px wide and wraps to at most four lines. The full text is in its `title`. The Done button is as tall as the bar (#1384).
- A `dataLayer` name the hook could not trap, such as `status`, gives the `dataLayerNotHooked` flag when a loader names it (#1235).
- One array under two names, or an array a child frame adopts from its parent, no longer gives a false `dataLayerIncomplete` flag or makes close wait for the posted-count deadline (#1299, #1360).
- A `must` rule with an exact count and unlinked server hits reads `serverSendUnlinked` when a subset of them could change the verdict (#1223).
- A server container call no longer links `exact` by client ID when another container request that shares the client ID, or has no decoded hit, was sent in between. The miss reason is `concurrentRequest`, also a key of `serverContainer.notExact.clientId` (#1029).
- `scripts/wordmark.ts` takes the font path as an argument and no longer reads `node_modules` (#727). In the site intro, focus moves to the new Skip button when the menubar one is hidden (#867).
- The docs say what the code does for the path defaults, the tag `status` values, the `dataLayerNotHooked` and `unloadGap` text, the `diff` and baseline text, the exit 2 row and the tag reports advice. They also cover the changes above (#1288, #1289, #1319, #1323, #1334, #1342, #1344, #1353, #1366, #1377, #1389). Two lines of 0.6.0-rc.3 are corrected (#1294, #1337). The `/datalayer-kinds` row of `fixtures/site/README.md` has all its columns (#1368).

### Upgrading from 0.6.0

- **Pushes are scanned for data not from the run identity.** A finding is a `possibleRealDataPush` warning. It never changes the exit code. A record from 0.6.0 or earlier has no push flags. Nothing adds them to a stored record.
- **`diff` names events as recorded.** A pair joined by the event table or an event map has `renamedFrom`. `changed` counts a change of push kind.
- **A baseline with mixed push kinds exits 2.** Only a hand edit makes one. Save the baseline again.
- **A folder at `tagreeve/config.yml` exits 2** in `tagreeve init`.
- **A `wait` timeout lists only the clicked form's controls,** not every blocking control on the page.
- **The handoff label wraps.** It shows at most four lines, and the full text is in its `title`.
- **A `must` rule with an exact `count` can warn with `serverSendUnlinked`** when some subset of the unlinked server hits in scope could change its verdict, where 0.6.0 gave PASS or FAIL.
- **A new rule 2 miss reason, `concurrentRequest`,** in the hit's link miss and in `serverContainer.notExact.clientId`. A call with a concurrent request no longer links `exact`.
- **The record stays at version 5.** A 0.6.0 record reads as before.

### Known in 0.6.1

Issues still open that you can meet:

- `network: stub` and `server` mode can still let a hit reach a real vendor account, for an unknown destination in `stub` and for a hosted `serverHosts` host in `server`.
- Records keep the full flag detail, including query values. Do not share a record from a page that sends an identifier in a query.
- `--server-container` needs Docker. The container downloads its configuration from Google at every start, so a run needs the network for three Google paths, and Google sees the container's request with your `gtm_auth`.
- The local container is Google's image. Stape-only features are missing, and with the live config it serves the published version. To test an unpublished server workspace, use a config from its preview environment.
- On a multi-page run a server container call rarely links `exact` by client ID, because later calls see several hits with the same client ID. The stricter tie in 0.6.1 makes `exact` rarer still. `serverContainer.notExact` counts these calls.
- Sends from `pagehide` or `visibilitychange` are answered in the page, also to your `serverHosts`, so the container never gets them.
- The Meta Conversions API, Pinterest and Criteo template tags are not yet proven to reach the recording proxy.
- The `payment` step is not confirmed on a real Shopify checkout. The test-mode marker on the page, the expiry format and the card frame paths are inferred. If one does not match, the step fails closed and the error names the frame path and the inputs' attributes. It checks the card host before each short fill try, which narrows the window in which typing could go to another host but cannot close it.
- The Shopify platform-host list holds only hosts that a Shopify docs page names. Other Shopify hosts stay `unknownDestination`.
- Playwright's request interception sometimes misses a redirect hop. The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload`.
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is not built.
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- A test identity pushed to the `dataLayer` before consent is not reported yet. A check is planned for 0.7.0 (#1392).
- The handoff label is capped at 300 px, so on a very narrow viewport it can be wider than the page (#1428).
- Page code that sabotages itself on purpose can still hide the untrapped list of the `dataLayer` count check (#1442).
- The reporter's own entry is in `tags[]` once for each event. The timeout status and the version string of a published container are field checks.
- A report sent while the page navigates can be lost, so `notFired` can list a tag that fired.
- Any page script can call the binding or change what the tally reads, so a tag report and the count check are what the page said, not proof.
- The server tag reporter is not built.
- The `dataLayer` hook after real `gtm.js` re-wraps, and `gtm.uniqueEventId` on real pushes, are field checks (#922). Arguments-like pushes from the pixel sandbox are read as `gtag` commands in shapes only, so consent commands in them do not count as a `consent default` push for `consentModeSetup`.
- The count check compares only the document each frame holds when the run closes. A page that replaced `push` on an earlier page of the run only is not flagged, and a page that edits its `dataLayer` in place can be flagged.
- `consentModeSetup` reads the `gcd` letters, whose format is documented only by the community.
- Hits and pushes are not joined per frame (#931, #932).
- A blocking control with no `aria-label`, `name` or `id` has no name in a `wait` timeout message.
- The other open `review-minor` issues are in the Backlog milestone. They are test gaps, wording and edge cases.

Field-tested on a real store with a real GTM web container in a workspace preview (0.6.0-rc.2 and rc.3). 0.6.1 has no field test of its own.

## 0.6.0

`npm i -g tagreeve` installs this release. 0.6.0 adds everything in the 0.6.0 release candidates (below). To upgrade from 0.5.0, read the next section.

### What 0.6.0 adds

- Project folder and config: `tagreeve init` makes `tagreeve/scenarios/` and `tagreeve/baselines/`, writes a starter `tagreeve/config.yml` and keeps `tagreeve/runs/` out of git. `run` and `suite` write to `tagreeve/runs/<date>/` by default, read their other defaults from the `tagreeve/` folder, and take `--label <name>`. `baseline save` and `run --baseline` have default paths, and `suite --baseline` checks every cell against its own baseline.
- Server container: a container call links to a browser hit by client ID and event name, so a leak through the container's forwarding can fail a run. A call that is not an exact link records why, and `--json` counts them in `serverContainer.notExact`.
- Web tag reports: `tagreeve template web` prints a GTM template that reports the status of each tag. The run record holds the reports. `tag` rules in `must` and `mustNot` read them, and `expectedTags` in the GTM override file names the tags that should fire. The reporter template works in real GTM.
- `dataLayer`: each push records its frame and its layer, and `options.dataLayerNames` hooks a custom layer name. The summary, `diff` and baselines compare masked push shapes, each with a kind (`gtag` or `object`). The hook leaves `push` as the page assigned it, so a theme that wraps `push` no longer hides pushes. A `dataLayerReassigned` flag and a `dataLayerIncomplete` flag name the cases the hook cannot follow. `diff` and `baseline` treat a Shopify standard event and its GA4 name as one event, for example `checkout_completed` and `purchase`. `diff --event-map <file>` renames the events and key paths of the first run to those of the second.
- Consent Mode: the `consentModeSetup` check warns when a Google hit shows a signal that was never set, and names the `gcd` letters per Google tag ID.
- Shop Pay hosts: `pay.shopify.com`, `shop.app`, `cdn.shopifycloud.com` and `*.shopifysvc.com` are platform hosts. A request to them is flagged `platformHost` and does not fail the run.
- Handoff text goes to stderr, so `--json` stdout is only JSON. `wait` with a `url` takes a `timeout`, and a timeout message lists the form controls that block submission.

### Upgrading from 0.5.0

- **Record schema version 5.** A 0.5 reader warns on a version 5 record. Records from 0.5.0 still read. `suite.json` is version 3, and `report` reads versions 1 to 3.
- **The default `--out` changes.** `run` and `suite` write to `tagreeve/runs/<date>/`, not `runs/`. Pass `--out runs` to keep the old folder.
- **A scenario with `options.network: live` no longer loads** (exit 2). Pass `--network live` on the command line.
- **A new `consentModeSetup` line in every summary.** It is a warning by default. `options.builtins.consentModeSetup: fail` makes it fail the run. The text summary also has a `dataLayer:` line.
- **A leak through a server container call can now fail a run.** A call that links exactly by client ID and event name is checked like a browser hit, so a rule that only warned before can fail.
- **`tagreeve init` writes `tagreeve/config.yml`.** The config refuses unknown keys, and a plain key with a control byte exits 2.
- **The handoff text is on stderr.** Under `run --json` and `suite --json`, stdout holds only the JSON.
- **A warning when the record folder is not ignored by git.** `run` and `suite` print it on stderr when the folder is in a git work tree and no rule ignores it. With the new default `--out`, a 0.5.0 user in a repo without `tagreeve init` sees it. `tagreeve init`, or a `/tagreeve/runs/` line in `.gitignore`, silences it.
- **Shop Pay hosts are platform hosts.** `pay.shopify.com`, `shop.app`, `cdn.shopifycloud.com` and `*.shopifysvc.com` get the flag `platformHost`, not `unknownDestination`. A run that failed on them in 0.5.0 can pass. `options.platformHosts: false` flags them as `unknownDestination` again, together with `cdn.shopify.com` and `monorail-edge.shopifysvc.com`, so a Shopify run then fails.
- **A blocking form control is named only by its `aria-label`, `name` or `id` attribute,** never by page text, in a `wait` timeout message.
- **Baselines.** A baseline saved by 0.5.0 still loads and warns "pushes not compared". A baseline that holds push shapes from 0.6.0-rc.2 compares with kinds merged and warns once. Save it again to compare kinds. `baseline save` refuses a name that could write outside `tagreeve/baselines/`. The Result line counts baseline warnings, and the exit code does not change.
- **Small changes you can see:** an option with no command exits 2; `init --json` prints `{ "items": [...] }`; the `consentModeSetup` message names the `gcd` letters; a pushed string that is not a known `gtag` command reads `gtag (other)`.

### Known in 0.6.0

Issues still open that you can meet:

- `network: stub` and `server` mode can still let a hit reach a real vendor account, for an unknown destination in `stub` and for a hosted `serverHosts` host in `server`.
- Records keep the full flag detail, including query values. Do not share a record from a page that sends an identifier in a query.
- `--server-container` needs Docker. The container downloads its configuration from Google at every start, so a run needs the network for three Google paths, and Google sees the container's request with your `gtm_auth`.
- The local container is Google's image. Stape-only features are missing, and with the live config it serves the published version. To test an unpublished server workspace, use a config from its preview environment.
- Sends from `pagehide` or `visibilitychange` are answered in the page, also to your `serverHosts`, so the container never gets them.
- The Meta Conversions API, Pinterest and Criteo template tags are not yet proven to reach the recording proxy.
- The `payment` step is not confirmed on a real Shopify checkout. The test-mode marker on the page, the expiry format and the card frame paths are inferred. If one does not match, the step fails closed and the error names the frame path and the inputs' attributes. It checks the card host before each short fill try, which narrows the window in which typing could go to another host but cannot close it.
- The Shopify platform-host list holds only hosts that a Shopify docs page names. Other Shopify hosts stay `unknownDestination`.
- Playwright's request interception sometimes misses a redirect hop. The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload`.
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is not built.
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- `possibleRealData` gives 38 to 72 warnings per run on a Shopify storefront. They do not change the exit code, but they bury other findings (#1017).
- Closing the recorder never returns when a same-process iframe is in a busy loop (#1301).
- A child frame that adopts the parent's `dataLayer` array, or one array hooked under two names, can get a false `dataLayerIncomplete` flag (#1360, #1299).
- The reporter's own entry is in `tags[]` once for each event. The timeout status and the version string of a published container are field checks.
- A report sent while the page navigates can be lost, so `notFired` can list a tag that fired.
- Any page script can call the binding or change what the tally reads, so a tag report and the count check are what the page said, not proof.
- The server tag reporter is not built.
- The `dataLayer` hook after real `gtm.js` re-wraps, and `gtm.uniqueEventId` on real pushes, are field checks (#922). Arguments-like pushes from the pixel sandbox are read as `gtag` commands in shapes only, so consent commands in them do not count as a `consent default` push for `consentModeSetup`.
- The count check compares only the document each frame holds when the run closes. A page that replaced `push` on an earlier page of the run only is not flagged, and a page that edits its `dataLayer` in place can be flagged.
- `consentModeSetup` reads the `gcd` letters, whose format is documented only by the community. It labels some Google hits "(no tag ID)" (#1385).
- Hits and pushes are not joined per frame (#931, #932).
- An exact client ID link can go to the wrong browser hit (#1029), and rule 2 rarely fires on a multi-page run (#1084).
- A `wait` timeout can list a blocking control outside the submitted form (#990).
- A blocking control with no `aria-label`, `name` or `id` has no name in a `wait` timeout message (#1004).
- The handoff bar truncates long instruction text. The full text is on stderr (#1384).
- The other open `review-minor` issues are in the Backlog milestone. They are test gaps, wording and edge cases.

Field-tested on a real store with a real GTM web container in a workspace preview (0.6.0-rc.2 and rc.3).

## 0.6.0-rc.3

Release candidate. Install it with `npm i -g tagreeve@next`.

### Upgrading from 0.6.0-rc.2

- **The record stays at schema version 5.** The flag kinds `dataLayerIncomplete` (a frame whose `dataLayer` holds pushes the run did not record, from C08) and `dataLayerReassigned` (a page replaced `window.dataLayer` after a Google loader request, now written by J08) and the optional field `InvalidReport.got` are new within version 5. A 0.6.0-rc.2 reader reads these records as before.
- **The handoff text is on stderr.** Under `run --json` and `suite --json`, stdout holds only the JSON.
- **The reporter template sends tag IDs as strings.** A 0.6.0-rc.2 template still works, because the parser also accepts numbers.
- **The Result line counts baseline warnings.** The exit code does not change.
- **Push shapes have a `kind`.** A baseline saved by 0.6.0-rc.2 compares with kinds merged and warns once. Save it again to compare kinds.
- **The `consentModeSetup` message names the `gcd` letters.**
- **Small changes you can see:** a `tag` rule with an unknown `status` exits 2; an option with no command exits 2; a config key with a control byte exits 2; a pushed string that is not a known `gtag` command reads `gtag (other)`, so an rc.2 baseline can warn once; the HTML report shows `noTagReports` and `tagNameUnknown` as CANNOT EVALUATE; `init --json` prints the items done before a failure.

### What 0.6.0-rc.3 adds

- Fixed: the web tag reporter works in real GTM, which gives tag IDs as numbers. In 0.6.0-rc.2 every report seen in a GTM preview was recorded as an invalid report (`tagReport:tagId`). The template now sends IDs as strings, and the parser also accepts numbers, so a 0.6.0-rc.2 template keeps working.
- An invalid tag report now has `got`, the type of the rejected value. It never holds the value. The record stays at version 5.
- The template's `read_data_layer` permission now lists `allowedKeys: specific`, so an import cannot widen it to every key.

- A run now gets a `dataLayerIncomplete` flag for a frame whose `dataLayer` holds more items than the run recorded, for example when a theme replaces `push` (#1281). The flag names the frame number, the layer and both counts. It checks only the document each frame holds when the run closes.
- `close` now ends the late tag report wait before the unload flush and the session stop (#1187).

- The handoff instructions, the Enter prompt, the reminder and the end message go to stderr. Under `run --json` and `suite --json`, stdout holds only the JSON.

- `consentModeSetup` names the `gcd` letters per Google tag ID, such as `gcd letters: rrll`. It names a Google Ads hit by its `AW-` ID, does not take a page parameter `tid` for a tag ID, and says when no Google hit carried `gcd`. The decoders export `gcdLetters`.

- **The Result line counts baseline warnings.** `Result: pass with 3 warnings` now adds the `Warning:` lines of the `Baseline` block to the warnings of the expectations. `ok`, `pass` and the exit code do not change.

- Fix: the HTML report shows a `tag` rule with no tag report, or with no tag name, as CANNOT EVALUATE, not FAIL or WARN. The no-report note says to install the reporter and run with `--gtm-override`. A tag name with a hex token joined to a word by `.`, `_`, `+`, a bracket or a quote now reads `(other)`.

- A push that starts with a string reads `gtag <command>` only for a known `gtag` command (`config`, `consent`, `event`, `get`, `js`, `set`). Any other string reads `gtag (other)`, so a pushed string is never printed (#1174). The docs name the push labels and the path caps (#1175, #1170).

- `baseline save` errors name the file and the key. A name that cannot make a baseline file names the scenario, store or variant and the record path. A bad `dataLayer` section reads `<file> has an invalid dataLayer section`. A folder or file that cannot be written gives the path and the errno code, never a raw Node error (#1145, #1207, #1194, #1143).

- A `tag` rule with a `status` outside `success`, `failure`, `exception` and `timeout` exits 2 (#1226).
- `diff --event-map`: `paths` also match the recorded and the renamed event name, a user entry for a Shopify name wins over the built-in pairing, and a bad event name error gives the key position (#1249, #1253, #1254).
- The docs say a number `id` in a tag rule, such as `id: 13`, is read as its decimal string and matches tag `13` (#1227).

- **The `dataLayer` hook survives a replaced `push`.** `push` on a hooked array stays exactly the function the page assigned, so a theme or loader that wraps it, or assigns `Array.prototype.push`, no longer hides pushes. A push that reaches the array is recorded once, and `gtmUniqueEventId` is read after the push returns. A push that a page wrapper drops without calling through is not recorded, because it never reached the array. Only items added at the end are recorded: an `unshift`, a `splice`, a sort or a length write records nothing. A page that replaces `window.dataLayer` after a Google loader request gets a `dataLayerReassigned` flag, and pushes to the new array are still recorded (#926, #1281).

- `wait` with a `url` takes an optional `timeout`, such as `wait: { url: "/thank-you*", timeout: 90s }`. Any other key next to `url` is refused with "url only takes timeout" (#1283).
- The `wait` URL docs say how a blocking control is printed (#1205).

- Push shapes have a `kind`, `gtag` or `object`, so `gtag('event', 'purchase', …)` and `{ event: 'purchase', … }` are two groups. A `gtag()` call pushed as an object with the keys `0`, `1` and `2` reads as the command it holds. A baseline saved by 0.6.0-rc.2 compares with kinds merged and warns once (#1247).

- `init` exits 2 and says the path is not a folder when a file is at `tagreeve/scenarios` or `tagreeve/baselines` (#1052).
- `init --json` prints the items done so far when a step fails, then exits 2 (#1133).
- The git-ignore probe file is `run_probe.jsonl`, so a `run_*.jsonl` rule counts as ignoring run records (#1139).
- `init` asks git about the `tagreeve/runs/` folder itself, so a `.gitignore` with only `*.jsonl` still gets the `/tagreeve/runs/` line (#1140).

- Fixed: a card frame that moves, or reloads after its input was found, while a test payment fill runs out of time now fails with the gone-frame reason, not a Playwright timeout message (#1164, #1161, #1163).

- An option with no command, such as `tagreeve --event-map x.json`, exits 2 (#1255).
- `template` with an unknown name says so without echoing it, and extra arguments get their own message (#1182).
- The `template web --json` steps say the override file holds the secret `gtmAuth` (#1104).
- A plain key with a control byte in the project config exits 2 and is not printed (#1269).

- `possibleRealData` counts a shorter email or phone value that has its own place in a body, such as `ann%40shop.example` next to `joann%40shop.example`, in every form it reads (#848). The `dataLayerNotHooked` flag names every missed layer, up to five, and says how many more there are (#1239).

- The `unloadGap` detail prints a value-like event name as `(other)` (#1267). A flag kind that is not listed as prose has any URL at the end of its detail masked, so a new kind is masked by default (#1268).
- The summary `dataLayer:` line lists page events before `consent …`, `gtag …` and `gtm.*` labels (#1173). The demo diff uses the paths the run panel shows (#1199).

### Known in 0.6.0-rc.3

Issues still open that you can meet:

- The reporter's own entry is in `tags[]` once for each event. The timeout status and the version string of a published container are field checks.
- A report sent while the page navigates can be lost, so `notFired` can list a tag that fired.
- Any page script can call the binding or change what the tally reads, so a tag report and the count check are what the page said, not proof.
- The server tag reporter is not built.
- The `dataLayer` hook after real `gtm.js` re-wraps, and `gtm.uniqueEventId` on real pushes, are field checks (#922). Arguments-like pushes from the pixel sandbox are read as `gtag` commands in shapes only, so consent commands in them do not count as a `consent default` push for `consentModeSetup`.
- The count check compares only the document each frame holds when the run closes. A page that replaced `push` on an earlier page of the run only is not flagged, and a page that edits its `dataLayer` in place can be flagged.
- `consentModeSetup` reads the `gcd` letters, whose format is documented only by the community.
- Hits and pushes are not joined per frame (#931, #932).
- An exact client ID link can go to the wrong browser hit (#1029), and rule 2 rarely fires on a multi-page run (#1084).
- A `wait` timeout can list a blocking control outside the submitted form (#990).
- A blocking control with no `aria-label`, `name` or `id` has no name in a `wait` timeout message (#1004).

## 0.6.0-rc.2

Release candidate. Install it with `npm i -g tagreeve@next`.

### Upgrading from 0.6.0-rc.1

- **Record schema version 5.** A 0.6.0-rc.1 reader warns on a version 5 record. A version 4 record reads as before.
- **A new `consentModeSetup` line in every summary.** It is a warning by default. `options.builtins.consentModeSetup: fail` makes it fail the run.
- **`tagreeve init` writes `tagreeve/config.yml`** and refuses unknown options.
- **The text summary has a `dataLayer:` line** with the push and event counts.
- **A blocking form control is named only by its `aria-label`, `name` or `id` attribute, never by page text** (#1004 stays open).

### What 0.6.0-rc.2 adds

- Record schema version 5. It adds `TagReport.t`, `TagReport.frame` and `TagReport.client`, `Request.frame`, `DataLayerEvent.layer` and `Hit.linkMiss`, the notes `noTagReports` and `tagNameUnknown`, and the flag kinds `dataLayerReassigned` and `dataLayerNotHooked`. `dataLayerReassigned` was not written until 0.6.0-rc.3 (#1266). A version 4 record reads as before.

- Added the built-in check `consentModeSetup`. It warns when a Google hit shows a Consent Mode signal that was never set (`gcd` letter `l`), for example a default without `ad_user_data` and `ad_personalization`. It is `warn` by default and `options.builtins.consentModeSetup: fail` makes it fail the run.

- `baseline save` refuses a scenario, store or variant name that could write outside `tagreeve/baselines/`. It exits 2 and asks for an explicit path (#1069).

- `tagreeve init` writes a starter `tagreeve/config.yml` when none exists (#1086). `init --json` prints `{ "items": [...] }`, and any other option is a usage error (#1051). A failed `init` names the relative path, keeps the lines already printed and exits 2 (#1048).

- A project config without `configSchemaVersion` now says which line to add (#1085). `configSchemaVersion: 1` is in the README and the 0.6.0-rc.1 notes below.

- The old-runs notice, for `run` and `suite`, names the real folder. The `suite` notice prints after the payment gates, and the suite site, folder and test-payment errors now add the help hint.

- Fix: a default rule, tracker, stores or scenario path that cannot be read now exits 2 with its fixed relative path. Only a missing path counts as absent. A folder or a dangling link named `*.json` in `tagreeve/autoconsent` is not listed.
- Fix: the git-ignore warning no longer shows when a rule such as `records/**` or `*.jsonl` ignores the record files.

- Fix: a `wait` timeout message never holds error text in a blocking control's name. Every blocking control is named by its `aria-label`, `name` or `id`, never by page text.

- A test payment fill that loses its card frame to a navigation reports "the card frame is gone or not served from the card host", not a Playwright message. The input count reason keeps the path of the document that was checked.

- The run record now holds web tag reports. A page binding, `tagreeveTagReport`, receives what the Tagreeve tag reporter template sends: for each event, the status of each tag. A bad report becomes an invalid report with an error class and no body. `Run.containerVersions` is set from the reports, and `Request.frame` says which frame sent a request. The run waits up to 2.5 s at the end for late reports. The fixture container has an opt-in reporter on `/container/tags`.

- Added `tagreeve template web`. It prints the web tag reporter's GTM template. `--json` prints the template with the setup fields and steps, so an agent can install it with its own GTM access. Tagreeve never calls the GTM API.

- The `--json` summary has `dataLayer`: the shape of each push per step, event and frame, with key paths and types, array indexes as `[*]` and no values. A key or event name that looks like a value reads `(other)`. The text summary has one `dataLayer:` line with the push and event counts (#928).

- `baseline save <record> x/y.json` makes the folder `x/` (#1076). `suite --baseline` hints at the ordering when the scenario folder is missing (#1075), gives a hint that fits an invalid file (#1074), no longer finds a missing file by matching `ENOENT` in the message (#1073), and exits 2 when two cells map to one baseline file name (#1068). The `suite --baseline` docs describe the drift text as it is (#1077).

- Added `tag` rules, in `must` and `mustNot`: `tag: { id: "77" }` or `tag: { name: "GA4 - *" }`, with optional `container`, `event`, `status` and `side`, and `count`, `after` and `from`. They read the web tag reports. A rule with no report cannot be evaluated (`noTagReports`), and a name pattern on a tag with no name does the same (`tagNameUnknown`). The summary has a `Tags` line and a `tags` field with the fired tags and, from `expectedTags` in the GTM override file, the expected tags that did not fire. That never fails a run (#922).

- `diff` and `baseline` compare the masked `dataLayer` push shapes (#940). `diff` lists a gone or new event, a missing or new key path and a type change, and `diff --across-frames` treats an event that moved between frames as the same event. A baseline gets an optional `dataLayer` section. Push changes are warnings and never change the exit code. A baseline saved by 0.6.0-rc.1 still loads and warns "pushes not compared". `baselineSchemaVersion` stays 1.

- Updated `node-forge` to 1.4.2 (#719). It builds and signs the server container certificates only.

- The dataLayer frame number comes from one helper, with no side-effect call (#1033). The main and embedded filters read the recorded `frame.main` (#1036). The frame e2e navigates the embedded frame between two pushes and checks `args` and the written file (#1034, #1035).

- A server container call that is not `exact` records why (#1084). Each such hit has `linkMiss`, with a class name for rule 1 (`eventId`: `none`, `noMatch`, `several`) and rule 2 (`clientId`: `noClientId`, `noSameKeyHit`, `severalSameKeyHits`, `answeredBefore`). `--json` `serverContainer.notExact` holds the counts, with no IDs and no values. The linking rule is unchanged. The server container guide says to send a unique event ID with each event for an exact link, and that the client ID rule rarely fires on a multi-page run.

- Add `options.dataLayerNames` to hook a `dataLayer` under a custom name (an `l=` name). Pushes to it are recorded with `layer`. A Google loader that names a layer that is not hooked gives a `dataLayerNotHooked` flag (#927).

- `diff` and `baseline` treat a Shopify standard event and its GA4 name as the same `dataLayer` event, for example `checkout_completed` and `purchase` (#930). The table is `SHOPIFY_TO_GA4` in `@tagreeve/decoders`, shared with the `unloadGap` check. `diff --event-map <file>` renames events and key paths of the first run to those of the second. A map file error names the file and the key, never a value.

- Fix config and summary text. A quoted or block-scalar key in the project config exits 2, and so does a second YAML document (#1063, #1062). A relative sandbox page with a space is masked like an absolute one (#920). A flag detail that is not a URL keeps its advice text when an event name holds `: /` (#918).

### Known in 0.6.0-rc.2

Issues still open that you can meet:

- The web tag reporter was not run in real GTM before the field test. The `callInWindow` name, the reporter's own entry in `tags[]`, the version string in preview and the timeout status are field checks.
- A report sent while the page navigates is lost, so `notFired` can list a tag that fired.
- Any page script can call the binding, so a tag report is what the page said, not proof.
- The server tag reporter is not built (OPEN 1).
- The `dataLayer` hook after real `gtm.js`, `gtm.uniqueEventId` on real pushes, and pushes from Shopify app pixels are field checks (#922).
- A loader that re-wraps `dataLayer.push` can hide later pushes from the hook (#926).
- `consentModeSetup` reads the `gcd` letters, whose format is documented only by the community.
- Hits and pushes are not joined per frame (#931, #932).
- An exact client ID link can go to the wrong browser hit (#1029), and rule 2 rarely fires on a multi-page run (#1084).
- A blocking control with no `aria-label`, `name` or `id` has no name in a `wait` timeout message (#1004).

Deferred out of this release: the `dataLayer` hook that survives a re-wrap (#926).

## 0.6.0-rc.1

Release candidate. Install it with `npm i -g tagreeve@next`.

### Upgrading from 0.5.0

- **The default `--out` changes.** `run` and `suite` write to `tagreeve/runs/<date>/`, not `runs/`. Pass `--out runs` to keep the old folder.
- **A scenario with `options.network: live` no longer loads** (exit 2). Pass `--network live` on the command line.
- **Record schema version 4.** `Run.label`, `Run.store`, `DataLayerEvent.frame` and exact client ID links are new. A 0.5 reader warns on a version 4 record.
- **`suite.json` is version 3.** `report` reads versions 1 to 3.
- **A leak through a server container call can now fail a run.** A call that links exactly by client ID and event name is checked like a browser hit, so a rule that only warned before can fail.

### What 0.6.0-rc.1 adds

- `run` and `suite` write to `tagreeve/runs/<date>/` when you give no `--out`. The old default was `runs/`. If `./runs/` holds records, a note on stderr says so. Pass `--out runs` to keep the old folder.

- Breaking: a scenario with `options.network: live` now fails to load (exit 2). Move `live` to the command line with `--network live`.

- When a `wait: { url }` step times out, the message lists the controls that block submission on every open page: an unticked required checkbox, a control that fails validation, or one marked `aria-invalid`. Each entry shows the role or type, the name and the reason. The name comes from a label heuristic, so a control's error text can still repeat a typed value (#810, #827, #1005).

- A suite verdict names a built-in check that failed in a run unless that run's own report already named it. A stores file now refuses a rules file that exists but cannot be read.

A test card fill is now bound to the card frame document that was checked. If the frame navigates during a fill, nothing is typed into the new document. A frame that has gone, or is no longer served from the card host or at the path of the field, when the input is checked gives the gone-frame reason, and input attributes in that reason are scrubbed of typed values.

- A plain address field on a Conversions API event is reported as plain, not as a wrong hash.

- Fixed: `unloadGap` no longer counts a redirected GA4 hit from the top frame as a hit from an embedded frame that has the same URL, so a missing hit is flagged (#879, #880, #881, #882).

- `run` and `suite` take `--label <name>` (1 to 40 lowercase letters, digits or hyphens). The default folder becomes `tagreeve/runs/<date>-<label>/`, `Run.label` holds the label, and the summary, `--json` and the HTML report show it. A `suite --stores` cell record has `Run.store`. Record schema version is 4 and `suite.json` is version 3 (#811).

- A server container call now links exactly by client ID and event name when exactly one browser hit with them had its request to the container in flight. A leak through the container's GA4 forwarding then fails the run instead of warning. Ties and different event names stay `probable` (#901).

- Shop Pay hosts (`pay.shopify.com`, `shop.app`, `cdn.shopifycloud.com` and `*.shopifysvc.com`) are platform hosts, so their requests get the flag `platformHost` and not `unknownDestination` (#585, #886).

- `suite` runs with no folder and no site: it uses `tagreeve/scenarios/`, and `tagreeve/stores.json` for the sites. `run` and `suite` also read `tagreeve/trackers.json` as the tracker list and `tagreeve/autoconsent/*.json` as autoconsent rules when the file or folder exists and the flag is not given. A flag replaces its default. The text summary has a `Defaults:` line, and `--json` and `suite.json` have `defaults: [{ setting, path }]`. `--allow-test-payment` still needs `--site` or `--stores` on the command line, so a default file never supplies the host (#811).

- Each `dataLayer` event records which frame pushed it: `frame` is `{ main, n }`, with no URL (#922).

- New command `tagreeve init`: it makes `tagreeve/scenarios/` and `tagreeve/baselines/` and adds `/tagreeve/runs/` to `.gitignore`. `run` and `suite` now print a warning when the record folder is in a git work tree and not ignored (#811).

- New file `tagreeve/config.yml`, and `--config <file>` to read another one. The file holds `configSchemaVersion: 1`. It holds `site`, `out` and the scenario options `allowUnknownDestination`, `builtins`, `firstPartyHosts`, `platformHosts`, `serverHosts`, `unloadGapIgnore` and `identifierFields`. `run` no longer needs `--site` when the config has one. A scenario's own option wins. The config refuses `network`, `serverContainer`, `serverContainerConfig`, `allowTestPayment`, `gtmOverride` and unknown keys. The file is plain YAML: anchors, aliases, tags and merge keys are refused. No error shows a value. `--allow-test-payment` still needs `--site` on the command line (#811).

- `baseline save <record>` with one path writes `tagreeve/baselines/<scenario>[.<store>][.<variant>].json` and makes the folder. `run --baseline` with no file reads `tagreeve/baselines/<scenario>.json`; put the bare flag last. New `suite --baseline [<folder>]` checks every cell against its own baseline file. It reads all the files before a browser starts and exits 2 when one is missing. A drifting cell is `FAIL (baseline drift)`, the suite exits 1, and `suite.json` cells get `baseline: { file, drift, added, removed, countChanges }` (#811).

### Known in 0.6.0-rc.1

Issues still open that you can meet:

- `--server-container` needs Docker. The container downloads its configuration from Google at every start, so a run needs the network for three Google paths, and Google sees the container's request with your `gtm_auth`.
- The local container is Google's image. Stape-only features are missing, and with the live config it serves the published version. To test an unpublished server workspace, use a config from its preview environment.
- Sends from `pagehide` or `visibilitychange` are answered in the page, also to your `serverHosts`, so the container never gets them.
- The Meta Conversions API, Pinterest and Criteo template tags are not yet proven to reach the recording proxy.
- The exact link by client ID and event name is proven only when the container answers the browser after its tags send. If the built-in GA4 client answers first, these calls stay `probable` and only warn. The field test of this release shows which it is.
- An exact client ID link can go to the wrong browser hit when another request to the container, with another event name or no decoded hit, is in flight. A leak through that call can then pass instead of warn (#1029).
- The names in a `wait` timeout message come from a label heuristic. Error text without a listed marker can still get into a name, for example one that repeats a typed fake-identity value (#1005, #986). Building the name clones the label in the page, which can run custom-element constructors or start image fetches that the record then shows (#988).
- The Shopify terms checkbox signal in a `wait` timeout message is not confirmed on a real checkout. The list of controls also includes any invalid control on the page, also outside the submitted form, and a disabled required checkbox (#990, #994).
- The Shopify platform-host list holds only hosts that a Shopify docs page names. Other Shopify hosts stay `unknownDestination`.
- The `payment` step is not confirmed on a real Shopify checkout. The test-mode marker on the page, the expiry format and the card frame paths are inferred. If one does not match, the step fails closed and the error names the frame path and the inputs' attributes.
- The payment step checks the card host before each short fill try. That narrows the window in which typing could go to another host but cannot close it, because Playwright cannot check the host and type in one step.
- The body scan can still merge two values when the shorter one occurs only in encoded form, so a count and place list can be wrong. The request is still flagged (#848).
- `possibleRealData` gives 38 to 72 warnings per run on a Shopify storefront. They do not change the exit code, but they bury other findings (#1017).
- `suite --baseline` compares two cells with one file when their baseline names are equal, for example scenario `a.workspace.yml` on the published variant and `a.yml` on variant `workspace` (#1068).
- The warning that records are not git-ignored fires when an ignore rule like `records/**` matches the files but not the folder (#1047). It also fires when the repo ignores records by file pattern, like `*.jsonl`, and not the folder (#1054).
- A second YAML document in `tagreeve/config.yml` is ignored without a message (#1062). Quoted and block-scalar keys pass the plain-YAML check, and a key with an escaped newline can forge a second config-error line on stderr (#1063).
- A default lookup, such as `tagreeve/autoconsent`, ignores a filesystem error and skips a symlinked file without a message. The run goes on without your rules (#1040).
- `unloadGap` can miss a real gap. A push that a frame sends after its own navigation started is grouped with the next document, so a hit from that document covers it (#958).
- A `wait` step calls the page for its list of blocking controls with no time limit. On a busy page the step can run past its timeout or hang before it reports (#989).
- `init` prints Node's error with the absolute path and does not say what it did (#1048). `init --json` exits 0 with text, not JSON (#1051). The old-runs notice prints a literal `<date>` instead of the folder (#971).
- `network: stub` and `server` mode can still let a hit reach a real vendor account, for an unknown destination in `stub` and for a hosted `serverHosts` host in `server`.
- `baseline save` does not check the scenario or variant in a record. A shared or hand-edited record with a name like `../../x` makes it write outside `tagreeve/baselines/`. Read a record from someone else before you save a baseline from it (#1069).
- Records keep the full flag detail, including query values. Do not share a record from a page that sends an identifier in a query.
- The `sandboxPageUrl` message does not mask a path segment of a relative page that holds a space (#920). A flag text for `unloadGap` can be cut short when a dataLayer event name holds `: /` (#918).
- The server container guide's encode steps can leave an editor backup or swap file with the plain auth string. Delete such files with `plain.txt` (#913).
- Playwright's request interception sometimes misses a redirect hop. The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload`.
- `unloadGap` compares dataLayer event names to hit names literally, apart from the GA4 aliases.
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is not built.
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- The tag-firing reporter templates and `expectedTags` are not built. They come in 0.6.0-rc.2 with the dataLayer and Consent Mode checks.
- The node-forge bump (#719) waits until node-forge 1.4.2, published 2026-10-27, is two weeks old, so it lands on or after 2026-11-10.

The other open `review-minor` issues are open in the 0.6.0 milestone.

## 0.5.0

`npm i -g tagreeve` installs this release. 0.5.0 adds everything in the 0.4.0 and 0.5.0 release candidates (below) and the changes under "Since rc.2". To upgrade from 0.3.0, read the next section.

### What 0.5.0 adds

- Server container: `--server-container` runs your own server container in Docker and records every call it makes to a vendor. Those calls are decoded and checked like browser hits. A hit rule can select by sender with `sentBy`. The guide shows how to test an unpublished server workspace through its preview environment.
- Checks and rules: the `meta-capi` decoder, the `earlyIdentifiers` check, `from:` on hit and cookie rules, `identity.hashesMatch` over every value of a Conversions API field, and a stricter `unloadGap`.
- Steps and runs: handoff steps that end by themselves, the opt-in `payment` step for a provider's test card, `--viewport`, and fake identities by country.
- Several runs: `tagreeve suite --stores` runs each scenario against several stores, and `tagreeve baseline save` with `run --baseline` catches drift in the shape of a run.
- Output: summaries show query names only and mask value-like path segments, and every command has its own `--help`.

### Upgrading from 0.3.0

- **The package and the command have a new name.** Uninstall the old package, then run `npm i -g tagreeve`, in this order. The steps are in the 0.4.0-rc.1 section below. The command is `tagreeve`. The old command alias is gone.
- **Environment variables and the config folder.** Variables start with `TAGREEVE_`. The config folder is `$XDG_CONFIG_HOME/tagreeve/`, else `~/.config/tagreeve/`.
- **Record schema version 3.** Records from 0.3.0 still read. A 0.3 reader warns on a version 3 record. Records keep the key `pingwrightVersion`.
- **`suite.json` is version 2.** `report` reads versions 1 and 2.
- **Requests to Shopify infrastructure hosts** (`cdn.shopify.com`, `monorail-edge.shopifysvc.com`) are flagged `platformHost` and no longer fail the `unknownDestination` check. Set `options.platformHosts: false` to get the old behaviour.
- **A run can show a new warning.** `earlyIdentifiers` is `warn` by default. It does not change the exit code unless you set it to `fail`.
- **`identity.hashesMatch` is stricter.** It checks every value of a Conversions API `em` or `ph`, and a plain `ct`, `zp` or `country` on such an event fails the check, so a rule that passed can now fail.
- **`--by-page` keys change.** Path segments that look like a value read `*`. A `--by-page` baseline saved on a page with such a segment drifts once. Save it again.
- **Summaries show less.** The text and `--json` summaries show a flag's request with query names only. Records keep the full detail.

### Since rc.2

- `sentBy: browser` or `sentBy: server` in a hit rule selects hits by sender. A browser-only `mustNot` on a Google host no longer fails on the server container's own forwarding with `--server-container` (#900, #902).

- Fix: when the `tagreeve-sgtm` server container image is missing, the message lists the local `tagreeve-sgtm` tags, or says `none`. `suite --server-container` stops with exit 2 before any scenario starts (#898).

- The text and `--json` summaries no longer print a value from a flag's URL. A relative or protocol-relative URL is redacted like an absolute one, a path segment that looks like a value reads `(other)`, and a bare query item reads `(other)`. Records are unchanged (#870, #871, #869, #874, #853).

### Known in 0.5.0

Issues still open that you can meet:

- `--server-container` needs Docker. The container downloads its configuration from Google at every start, so a run needs the network for three Google paths, and Google sees the container's request with your `gtm_auth`.
- The local container is Google's image. Stape-only features are missing: the custom loader and its domain features, Cookie Keeper, the geo and bot headers Stape adds, store ID headers, request logs and the CDN. With the live config it serves the published version. To test an unpublished server workspace, use a config from its preview environment (see the server container guide).
- Sends from `pagehide` or `visibilitychange` are answered in the page, also to your `serverHosts`, so the container never gets them. A purchase sent at unload shows no server rows (#816).
- The Meta Conversions API, Pinterest and Criteo template tags are not yet proven to reach the recording proxy.
- Link rule 2 (a link by client ID and event name) is not built. Links between container calls and browser hits are exact by event ID only. A leak through a container call with no event ID, such as the built-in GA4 tag, links at best as probable, so it is only a warning (#901).
- The Shopify platform-host list holds only `cdn.shopify.com` and `monorail-edge.shopifysvc.com`. Other Shopify telemetry, checkout and payments hosts stay `unknownDestination` (#585). Turning `options.platformHosts` off flags those two hosts as `unknownDestination` again, which fails the run (#886).
- The `payment` step is not confirmed on a real Shopify checkout. The test-mode marker on the page, the expiry format and the card frame paths are inferred. If one does not match, the step fails closed and the error names the frame path and the inputs' attributes. A required terms checkbox at checkout is not covered by the step (#810).
- The payment step checks the card host before each short fill try. That narrows the window in which typing could go to another host but cannot close it, because Playwright cannot check the host and type in one step (#845).
- The body scan can still merge two values when the shorter one occurs only in encoded form, so the count and place list are wrong. The request is still flagged (#848).
- A plain `ct`, `zp` or `country` that does not match on a Conversions API event is reported as hashed (#850).
- A hit from a redirect hop has no frame id and still matches by frame URL (#879).
- The suite verdict can hide a check's failure in a run with no leak when another run named a leak (#822).
- Records keep the full flag detail, including query values. Do not share a record from a page that sends an identifier in a query.
- The `sandboxPageUrl` message does not mask a path segment of a relative page that holds a space (#920). A flag text for `unloadGap` can be cut short when a dataLayer event name holds `: /` (#918).
- The server container guide's encode steps can leave an editor backup or swap file with the plain auth string. Delete such files with `plain.txt` (#913).
- `earlyIdentifiers` is `warn` by default.
- Playwright's request interception sometimes misses a redirect hop. The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload`.
- `unloadGap` compares dataLayer event names to hit names literally, apart from the GA4 aliases.
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is not built.
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- The tag-firing reporter templates, `expectedTags` and `tagreeve init` are planned for 0.6.0.
- The node-forge bump (#719) waits until node-forge 1.4.2, published 2026-10-27, is two weeks old, so it lands on or after 2026-11-10.

The other open `review-minor` issues are open in the 0.6.0 milestone. They are test gaps, wording and edge cases.

## 0.5.0-rc.2

Release candidate. Install it with `npm i -g tagreeve@next`.

- The `payment` step finds each Shopify card field by its `name` or `autocomplete` and its frame by document path. A frame with the right title but another path is skipped. When the input count is not 1, the error lists the frame path and the `name`, `autocomplete` and `type` of each visible input (#788, #684, #691).

- Fix: a server container call made up to one second after a handoff closes is stored without its body and query values. A container call is no longer sent an empty `Cookie` header when the browser sends none (#772, #768).

- Fixes in the body scan: two different values no longer merge into one finding when one contains the other, a JSON path of digits is no longer read as a phone number, a part typed as binary in a text body is named by its field, and a body of over 100,000 values no longer overflows the stack. (#667, #668, #669, #670, #673)

- `identity.hashesMatch` checks every value of a Conversions API `em` or `ph`. Further values are hit params `hashedEmail.1`, `hashedEmail.2` and so on. A filter on `ids.hashes.<field>.matchesIdentity` is computed from the run identity on a `meta-capi` hit; the record keeps null. Every further value of `fn`, `ln`, `ct`, `zp` and `country` is checked too, and a plain `ct`, `zp` or `country` on a Conversions API event fails the check. (#712, #714, #715, #808)

- An unknown option now prints one line, `Unknown option --bogus.`. `tagreeve <command> --help` prints the options of that command for every command. A mistyped option before the command keeps the command name in the usage hint.

- `suite --stores` now exits 2 when `--allow-test-payment` matches no store and a payment scenario would run. A stores file whose `autoconsentRules` file is missing is rejected when the file is read.

- `diff --by-page` and `baseline save --by-page` now mask a path segment that holds `@`, a percent-encoded byte, an email, a phone number or a hash. `diff` treats `platformHost` flag changes as allowed and hides them unless `--all-flags` is given. The docs list the masking rules in full. (#705, #706, #743)

- The verdict names a failed `deniedIdentifiers` check when only early identifiers are named, and an `earlyIdentifiers` warning when only denied identifiers are named. Each check is hidden only when its own findings are already in the sentence (#663, #805).

- Fix: the text and `--json` summaries show a flag's request with query names only, never values (`?a&b`). A query name that looks like a value reads `(other)`. The `sandboxPageUrl` message names the page by host and path. Records keep the full flag detail otherwise. Path segments are not masked yet. (#679, #801)

- `unloadGap` now matches a GA4 hit to a push by frame document, not by frame URL. Two `about:srcdoc` frames, or two frames with one URL, no longer cover each other (#723, #722, #724, #725).

- The recording proxy refuses every spelling of the unspecified address (`::0`, `0`, `0:0:0:0:0:0:0:0`), and checks the address it bound. `tagreeve server-container build` on arm64 now says Docker is needed when the Docker daemon does not answer (#718, #791).

- Adds `from: <step label>` to hit and cookie rules. The window starts at the labelled step's start, so a visit step's own page-load hits count. `after:` still starts at the step's end. A rule with both is a scenario error. (#789, #806)

### Known in 0.5.0-rc.2

Issues still open that you can meet:

- `--server-container` needs Docker. The container downloads its configuration from Google at every start, so a run needs the network for three Google paths, and Google sees the container's request with your `gtm_auth`.
- The Meta Conversions API, Pinterest and Criteo template tags are not yet proven to reach the recording proxy. Check C0, items 1 to 3, runs in the rc.2 field test.
- Link rule 2 (a link by client ID and event name) is not built. Links between container calls and browser hits are exact by event ID only. A leak through a container call with no event ID, such as the built-in GA4 tag, links at best as probable, so it is only a warning (#783).
- The Shopify platform-host list holds only `cdn.shopify.com` and `monorail-edge.shopifysvc.com`. Other Shopify telemetry, checkout and payments hosts stay `unknownDestination` (#585).
- The fix for the Shopify card fields (#788) is not yet confirmed on a real checkout. The rc.2 field test confirms it. If it fails, the error names the frame path and the inputs' attributes.
- The payment step checks the card host before each short fill try. That narrows the window in #691 but cannot close it, because Playwright cannot check the host and type in one step (#845).
- A flag's detail keeps query values in records. The text and `--json` summaries show query names only, except a `sandboxPageUrl` page that is not an absolute URL, which keeps its query (#679, #782, #870). Path segments are not masked in flag detail (#871).
- A bare query item with no `=` is shown as a name unless it looks like a value (#869).
- A hit from a redirect hop has no frame id and still matches by frame URL (#879).
- The suite verdict can hide a check's failure in a run with no leak when another run named a leak (#822).
- Stape-only features do not exist in the local container, which is Google's image: the custom loader and its domain features, Cookie Keeper, the geo and bot headers Stape adds, store ID headers, request logs and the CDN. Unpublished server workspaces are not available either.
- `earlyIdentifiers` is `warn` by default.
- Playwright's request interception sometimes misses a redirect hop. The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload`.
- `unloadGap` compares dataLayer event names to hit names literally, apart from the GA4 aliases.
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is not built.
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- The tag-firing reporter templates, `expectedTags` and `tagreeve init` are planned for 0.6.0.
- The node-forge bump waits until the release is two weeks old, on 2026-11-10 (#719).

The other open `review-minor` issues are in the 0.5.0 milestone.

## 0.5.0-rc.1

Release candidate. Install it with `npm i -g tagreeve@next`.

### Added

- Adds a `meta-capi` decoder for Meta Conversions API calls (`graph.facebook.com/v<n>/<id>/events`). One hit for each event in `data`. In `stub` mode the endpoint is answered with a success body. Part of #358.

- `tagreeve suite <dir> --stores <stores.json>` runs each scenario against several stores. Cells carry `labels.store`, records are named `<scenario>.<store>.<variant>.jsonl`, and diffs compare variants within a store. `suite.json` is now version 2 and adds `stores` and `SuiteDiff.store`. `report` reads version 1 and 2. A payment scenario runs only for the store that `--allow-test-payment` names. (#360)

- Requests to `cdn.shopify.com` and `monorail-edge.shopifysvc.com` are flagged `platformHost` instead of `unknownDestination`, so they no longer fail the `unknownDestination` check. They are still listed in the summary and the report. Set `options.platformHosts: false` to restore the old behaviour. (#585)

- Adds `tagreeve server-container build`, which builds the Docker image for the coming server container feature (arm64 builds locally from Google's image, pinned by digest; amd64 needs no build). Adds the runner, the per-run `--internal` network, the relay and egress probe, the owner-labelled sweep and a stand-in container for tests. Tagreeve never pushes an image. Part of #358.

- Adds `--server-container` and `--server-container-config` to `run` and `suite`. Tagreeve runs your own server container in Docker, sends the non-load requests to your `serverHosts` to it, and records every call it makes to a vendor. The calls are decoded and checked like browser hits and answered locally. Nothing is sent on, except three Google requests the container needs to load its configuration. A hit from the container links to a browser hit with `Hit.via`. Record schema version 3. Part of #358.

- A hit that the server container sent on is judged by the browser hit it links to, for `before`, `in: epoch(...)`, `after`, `deniedIdentifiers` and `earlyIdentifiers`, and in `diff` and `baseline`. Only an exact link can fail a run: a failure that rests on a probable link is a warning with the note `serverSendProbableLink`, and a hit with no link is `cannot evaluate` with the note `serverSendUnlinked`. The summary has a `Server container` line and `--json` has `serverContainer`. The report shows server vendors as their own rows. Part of #358.

### Changed

- The release workflow test is stricter: it checks job permissions, publish lines, `github.token` and docker pushes. (#546)

- `--by-page` keys now replace path segments that look like a value, such as a checkout token, with `*`. A `--by-page` baseline saved on a page with a token drifts once. Save it again.

### Fixed

- `unloadGap` now also warns when an embedded frame pushed a tracking event shortly before the run ended (browser close), not only before a navigation (#261, #550).
- A GA4 hit sent from the same frame as the push now covers the event, whatever its custom name, so custom event names no longer give a false `unloadGap` (#261, #550).
- The `/unload-gap?mode=` fixture page writes the mode into the iframe `src` on the server (#552).

### Removed

- The old command alias. Use `tagreeve`. (#546)

### Known in 0.5.0-rc.1

Issues still open that you can meet:

- `--server-container` needs Docker. The container downloads its configuration from Google at every start, so a run needs the network for three Google paths, and Google sees the container's request with your `gtm_auth`. That is what your container does in production too.
- The Meta Conversions API, Pinterest and Criteo template tags are not yet proven to reach the recording proxy, and links between container calls and browser hits are exact by event ID only. The rc.1 field test runs these checks (Check C0, items 1 to 3).
- The Shopify platform-host list holds only the hosts that a Shopify docs page names, so far `cdn.shopify.com` and `monorail-edge.shopifysvc.com`. Other Shopify telemetry, checkout and payments hosts stay `unknownDestination` (#585).
- Stape-only features do not exist in the local container, which is Google's image: the custom loader and its domain features, Cookie Keeper, the geo and bot headers Stape adds, store ID headers, request logs and the CDN. Unpublished server workspaces are not available either. The container loads a published version or a named environment.
- A container call forwarded just after a handoff closes is not redacted (#772). The container gets all request headers, not only `Cookie` (#769), and an empty `Cookie` header when the browser has none (#768).
- `platformHost` flags are not allowed in `diff`, so `diff` and `suite` show more noise than `run` (#743).
- `--allow-test-payment` with a host that matches no store skips every payment cell without a message (#735).
- A missing `autoconsentRules` file is found only when each run starts (#737).
- Only the first value of a multi-value `em` or `ph` on a Conversions API event is kept and checked (#712). Plaintext `ct`, `zp` and `country` on such an event pass `identity.hashesMatch` (#715), and `ids.hashes.<f>.matchesIdentity` is always null on `meta-capi` hits (#714).
- `--by-page` keys keep email-shaped and percent-encoded value segments (#705).
- A frame URL is not a frame identity, so a hit from another frame with the same URL can cover a push (#723).
- The Shopify payment runtime is not yet checked on a real checkout. The test-mode marker, the card input selector and the expiry format are unconfirmed (#695, #648). A supervised field test runs it with a declared host. If a value does not match, the step fails closed and says why.
- `earlyIdentifiers` is `warn` by default.
- The `--json` summary flags (`unknownDestination`, `firstPartySubdomain`, `stubBypass`, `possibleRedirectHop`) carry the full request URL, including query values. Do not share the summary from a page that sends an identifier in a query (#679).
- The verdict can hide a failed `deniedIdentifiers` when only early identifiers are named (#663).
- A text part of a multipart body that is typed as binary is reported `in the body`, not by its field name (#669).
- A mistyped option before the command loses the command name in the usage hint (#657), and the hint can name the wrong command (#644). Most per-command `--help` prints the general usage (#641). The unknown-option line is very long (#640).
- The possible-real-data check merges two different emails or two different phones when one contains the other, so the count and the place are wrong (#667). A number prefix in a JSON path can be flagged as a phone (#668). The binary-share check counts UTF-16 units, not code points (#673). A body with about 100k or more leaf texts overflows the stack (#670).
- Playwright's request interception sometimes misses a redirect hop (#180). The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload` (#256).
- `unloadGap` compares dataLayer event names to hit names literally.
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is not built (#514).
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- The tag-firing reporter templates, `expectedTags` and `tagreeve init` are planned for 0.6.0.

Other open `review-minor` issues are test gaps, wording, or edge cases with no effect on a normal run. They carry the `review-minor` label.

## 0.4.0-rc.3

Release candidate. Install it with `npm i -g tagreeve@next`.

### Changes
- The `payment` step now types into the exact card iframe that it checked. It skips hidden duplicate frames and frames served from another host, and uses the one visible input in the frame. If several visible inputs match, it fails with the count instead of guessing. A fill error now keeps its reason: `card field number could not be filled: <reason>`, with typed values removed. `card frame not found` also says why. This targets the Shopify Payments failure in the rc.2 field test; it is not confirmed on a real store. (#682, #648)

- The declaration hint after `test mode not detected` names the provider of the `payment` step that failed. It appears only when the allowlist file would accept the entry, so it no longer suggests the `fixture` provider on a hosted host or a loopback host without the test seam. The declared-payment e2e now checks that a run prints no email, email hash or cookie value. (#646, #647, #649)

### Known in 0.4.0-rc.3

Issues still open that you can meet:

- The Shopify payment runtime is not yet checked on a real checkout. The card input selector (`input`, narrowed to the visible inputs in the verified frame), the expiry format (`12/40` against a masked "MM / YY" field) and the root cause of the rc.2 failure (#682) are still not confirmed. A supervised field test runs it with a declared host. If a value does not match, the step fails closed and the error now says why.
- `earlyIdentifiers` is `warn` by default. The field test decides whether it becomes `fail` for 0.4.0.
- The `--json` summary flags (`unknownDestination`, `firstPartySubdomain`, `stubBypass`, `possibleRedirectHop`) carry the full request URL, including query values. Do not share the summary from a page that sends an identifier in a query (#679).
- The verdict can hide a failed `deniedIdentifiers` when only early identifiers are named (#663).
- A text part of a multipart body that is typed as binary is reported `in the body`, not by its field name (#669).
- A mistyped option before the command loses the command name in the usage hint (#657), and the hint can name the wrong command (#644). Most per-command `--help` prints the general usage (#641). The unknown-option line is very long (#640).
- The possible-real-data check merges two different emails or two different phones when one contains the other, so the count and the place are wrong (#667). A number prefix in a JSON path can be flagged as a phone (#668). The binary-share check counts UTF-16 units, not code points (#673).
- Playwright's request interception sometimes misses a redirect hop (#180). The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload` (#256).
- `unloadGap` compares dataLayer event names to hit names literally (#261).
- `--viewport` takes `<W>x<H>` only. A `mobile` preset is planned for 0.5.0 (#514).
- The leak check misses a URL-encoded email (#565).
- Platform infrastructure hosts fill the `unknownDestination` list (#585).
- A gap frame is requested twice when `mode` is given (#552).
- `identity.country` has local formats for US, SE, GB and DE. Other countries keep US-shaped data and the run warns.
- No test covers a suite child without `suite.json` beside a valid one (#593). The cookie already-set e2e leak check skips the report (#543).
- Server-to-vendor traffic is not visible to Tagreeve (#358), and several stores in one suite (#360) is planned. Both are deferred to 0.5.0.

Other open `review-minor` issues are test gaps, wording, or edge cases with no effect on a normal run. They carry the `review-minor` label.

## 0.4.0-rc.2

Release candidate. Install it with `npm i -g tagreeve@next`.

### Changes
- The built-in check `earlyIdentifiers` warns when a hit sent before the first consent answer carries an identifier, such as a hashed email, and its consent signal is unknown. It is `warn` by default, so no exit code changes. Set `options.builtins: { earlyIdentifiers: fail }` to fail a run. The report marks such a hit `leak` with the label `identifiers sent before an answer`, and the verdict names the vendors. A hit with only `fbp` or `cid` is not flagged. (#626, #627)

- A host in the test payment allowlist can declare its test mode: `{ "host": "shop.example.com", "testMode": "shopify-test" }`. A declared host needs no marker on the page. Without a declaration, the marker must now sit inside the card form. The record, the `TEST PAYMENT` line and `--json` say whether the test mode was declared or seen on the page. A failed `payment` step now leaves `Step.payment` unset until the first key is typed, and `test mode not detected` shows the declaration to write. (#611, #603, #604, #633)

- `possibleRealData` now names the path of a value in a JSON or form body, for example `in customerHashed.country`, and no longer says `in the body` for it. A multipart body is split into parts, and its text fields are scanned and named. When the body is binary as a whole, its binary parts are skipped and its text parts are still scanned. A multi-line body is checked line by line, so one compressed line no longer hides a text line. (#610, #620, #622, #623)

- A usage error now prints the message and one line, `Run tagreeve <command> --help for the options.`, not the full help text. `--help` still prints it. (#613)

### Fixed
- `run --baseline` compares scenario names without `.yml` or `.yaml`, so a baseline saved from `checkout` matches a run of `checkout.yml`. (#612)

- The baseline counts of added, removed and changed tuples come from the diff, so two tuples with the same change count as two. (#589)

- A baseline saved with sorted keys, for example by `jq -S`, compares the same. (#591)

- Hits that move across one consent answer, with the same total, are a warning and no longer drift. A move across two answers or a changed total is still drift. (#618)

- Baseline drift sets `pass` to false in the `--json` summary, as well as `ok`. (#590)

- `possibleRealData` no longer scans compressed or binary request bodies, such as a session-replay beacon. Bytes in them can look like an email by chance. The URL is still scanned, and a text body is scanned as before. (#614)

- `possibleRealData` now counts C1 control characters (0x80-0x9f) the same way for bodies as for base64 text: they are not binary. A body with 10% of them is now scanned. (#624)

- A form field with an empty name, such as `=value`, is placed in `the body` in a `possibleRealData` finding, not in a blank place. (#672)

- `identity.hashesMatch` no longer says a hit carried no identity fields when it carried only plain city, postal code or country. It now says the hit carried no hashed identity field, only plain fields that are not checked. (#595)

### Known in 0.4.0-rc.2

Issues still open that you can meet:

- The Shopify payment runtime is not yet checked on a real checkout: the test-mode marker, the card input selectors and the expiry format (`12/40` against a masked field). A supervised field test runs it with a declared host. If a value does not match, the step fails closed and a later release fixes it. Tests do not yet check the selectors or the order of the checks (#648).
- `earlyIdentifiers` is `warn` by default. The rc.2 field test decides whether it becomes `fail` for 0.4.0.
- The `--json` summary flags (`unknownDestination`, `firstPartySubdomain`, `stubBypass`, `possibleRedirectHop`) carry the full request URL, including query values. Do not share the summary from a page that sends an identifier in a query (#679).
- The verdict can hide a failed `deniedIdentifiers` when only early identifiers are named (#663).
- A text part of a multipart body that is typed as binary is reported `in the body`, not by its field name (#669).
- A mistyped option before the command loses the command name in the usage hint (#657), and the hint can name the wrong command (#644). Most per-command `--help` prints the general usage (#641). The unknown-option line is very long (#640).
- With two payment steps for different providers, the declaration hint names the first step's provider, not the one that failed (#647). The hint can also suggest an allowlist entry that the file refuses, which breaks later runs (#646). Check the hint before you copy it.
- The possible-real-data check merges two different emails or two different phones when one contains the other, so the count and the place are wrong (#667). A number prefix in a JSON path can be flagged as a phone (#668). The binary-share check counts UTF-16 units, not code points (#673).
- Playwright's request interception sometimes misses a redirect hop (#180). The `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload` (#256).
- The leak check misses a URL-encoded email (#565).
- Platform infrastructure hosts fill the `unknownDestination` list (#585).
- A gap frame is requested twice when `mode` is given (#552).
- Server-to-vendor traffic is not visible to Tagreeve (#358), and several stores in one suite (#360) is planned. Both are deferred to 0.5.0.

Other open `review-minor` issues are test gaps, wording, or edge cases with no effect on a normal run. They carry the `review-minor` label.

## 0.4.0-rc.1

Release candidate. Install it with `npm i -g tagreeve@next`.

### Pingwright is now Tagreeve

The tool, the npm package, the command, the repository and the docs site have a new name. To move over:

1. `npm uninstall -g pingwright`
2. `npm i -g tagreeve@next`

Do the steps in this order. The old package owns the `pingwright` command link, so installing first fails with EEXIST.

- The command is `tagreeve`. The old name `pingwright` still runs the same CLI. It prints `pingwright is now tagreeve; this alias goes in 0.5.0` on stderr, and stdout and the exit code are the same.
- The docs are at https://tagreeve.dev and the code at https://github.com/alfhen/tagreeve. GitHub redirects the old repository links.
- Environment variables start with `TAGREEVE_`. The user config folder is `$XDG_CONFIG_HOME/tagreeve/`, else `~/.config/tagreeve/`.
- Records and scenarios need no change. Records keep the key `pingwrightVersion`, so older records still read, and the report labels it `Tagreeve`.

### Changes
- A `handoff` step can end by itself: `until` (a URL or an element), `settle` and `timeout`. The step record says what ended it in `handoffEnd`. `wait` takes `{ url }` too. (#515)
- New `payment` step: types a payment provider's documented test card (`shopify-bogus`, `shopify-test`) on a hosted store. It is opt-in with three checks: `--allow-test-payment <host>` equal to the `--site` host, the host in `~/.config/tagreeve/test-payment-hosts.json`, and the provider's test mode on the page. Log-ins stay handoff steps, and `fill`, `select` and `evaluate` still refuse card fields. From the first key until the run ends, non-tracking requests are redacted. The summary prints `TEST PAYMENT`. `suite` runs these scenarios only with `--with-test-payment` and `--allow-test-payment`. (#463, #529)
- New option `--viewport <W>x<H>` on `run` and `suite`, and `options.viewport` in the scenario. The record has `Run.viewport` and the report shows it. It sets the window size only: the user agent and client hints stay desktop. `mobile` and other values exit 2. (#514)
- `identity.country` now picks the format of the fake identity. GB and DE are added beside US and SE. A country with no format keeps US-shaped data and the run warns. (#32)
- A `fill` entry can be `{ value: phone, optional: true }`. A field that is not on the page is skipped, and the summary and `--json` list it. New option `optionalTimeout`. (#586)
- The real-phone warning says why the number looks real and names the fictional range for the country. German drama numbers get no warning. (#583)
- `tagreeve baseline save` keeps the shape of a run as names and counts, and `run --baseline` fails with exit 1 when a key or tuple appears or disappears. A missing or invalid baseline exits 2. (#359)
- Docs: design §8.5 says what is visible of a server container and what is not. `expectedTags` is stored and not evaluated. (#358)
- Docs: design §5.3 now has the measured rate of the missed redirect hop and its cause. Playwright's request interception drops the hop. New flag `possibleRedirectHop` marks a request handed to Chromium that either failed with `net::ERR_FAILED` and no response, or got a non-redirect status together with a `Location` header. It covers both shapes of a missed hop that were measured: a hop that fails CORS and a hop that allows it. The hop itself is still not recorded or stubbed. (#180)
- **Report: a segment with an early hit, a granted hit and a denied hit shows `mixed`.** It showed `early` and hid the denied hit.
- **Fixed.** `tagreeve report` on a suite with a malformed cell `failed` field now says it is not a suite manifest, instead of failing with a TypeError. (#506)
- **Fixed.** `tagreeve report` accepts the `--out` folder of `suite`. It uses the one `suite_*` folder inside and says which on stderr. With several, the error lists them. (#581)
- `possibleRealData` now names where the foreign value was found: the hit parameter path, `the URL` or `the body`. It never prints the value. (#582)
- `identity.hashesMatch` says when the hit carried no identity fields at all, and that server side matching is not visible to Tagreeve. A hit with fields that do not match keeps `Not matching: <field>`. (#584)

### Known in 0.4.0-rc.1

Issues still open that you can meet:

- Playwright's request interception sometimes misses a redirect hop (about 9 in 100 runs on a bare context with `route.continue`). That is the cause of #180. The new `possibleRedirectHop` flag marks a likely miss in `stub` and `server` mode. `live` mode has no such flag.
- With `--net-log`, requests seen only in the net log are labelled by timing, and an early `srcdoc` iframe request can still read `unload` (#256).
- Server-to-vendor traffic is not visible to Tagreeve. Design section 8.5 says what is and is not. The rest of #358, such as evaluating `expectedTags`, is planned for 0.5.0.
- `--viewport` takes `<W>x<H>` only. There is no `mobile` preset (#514).
- `identity.country` has local formats for US, SE, GB and DE. NL, DK, NO and other countries keep US-shaped data and the run warns.
- The `payment` step has not been checked on a real store. The Shopify values it relies on (the test-mode marker text, the card iframe selectors and the card host) may not match. If they do not, the step fails closed and types nothing.
- Platform infrastructure hosts fill the `unknownDestination` list (#585). Planned for 0.5.0.
- Several stores in one suite (#360) and `unloadGap` at the end of a run (#261) are deferred to 0.5.0.
- After a baseline drift, `pass` stays true while `ok` is false (#590). Read `ok`.
- Baseline matching depends on JSON property order (#591), and the summary counts come from deduplicated text lines (#589).
- `wait: { url }` matches any page, not only the active page (#569).
- The leak check misses a URL-encoded email (#565).
- `Step.payment` is set before any key is typed (#603). No test covers the Shopify payment runtime and the typed name (#604).
- The no-identity-fields message also fires for fields that were not checked (#595).
- A suite child without `suite.json` beside a valid one has no test (#593). No test checks that `suite` passes `--viewport` to its runs (#601). No leak test covers the new `skippedFields` output (#599).
- A gap frame is requested twice when `mode` is given (#552).
- Some e2e leak checks cannot fail: the SE `possibleRealData` check (#598), the baseline hash and cookie checks (#588), the handoff `until` check (#570) and the cookie already-set check (#543).
- Rename gaps: CI does not check that the old-name alias prints the version (#606), and the docs tell users to install `tagreeve` before it is on npm (#607). Use `npm i -g tagreeve@next` for this release.

Other open `review-minor` issues are wording or test gaps in the plan and design docs: #526, #531, #533, #535, #536, #538, #546, #555, #560, #561, #562 and #563.

## 0.3.0

`npm i -g pingwright` installs this release. 0.3.0 adds everything in 0.3.0-rc.1 and 0.3.0-rc.2 (below) and the changes under "Since rc.2". To upgrade from 0.2.0, read the first section.

### Upgrading from 0.2.0

- **A run that passed can now exit 1.** The `deniedIdentifiers` check is on by default with severity `fail`. It fails when an identifier goes out on a denied hit, or when a denied hit has a body that was not fully recorded. To keep exit code 0 while you fix the cause, set `options.builtins: { deniedIdentifiers: warn }`. See rc.1 below for the list of identifiers.
- **Record schema version 2.** 0.2 readers warn on a version 2 record. Version 1 records still read. All new fields hold names and numbers, never values.
- **New in the scenario format.** `body.has`, `body.only` and `body.ignore` rules on payload field names, `cookie` rules, `{ role, name }` and `{ any: [...] }` locators, and a `select` step. `body.has` and `body.only` take a leaf name such as `**.email`.
- **New commands.** `pingwright suite` runs a folder of scenarios once per variant and writes `suite.json`. `pingwright report` writes one HTML file for a run or a suite, with names and counts only, no script and no request.
- **New network mode.** `--network server` is `stub` plus pass-through for the hosts in `options.serverHosts`, so cookies set by a server container can be seen.
- **Handoff.** A headed handoff shows a Done button in the page. Enter in the terminal still works.
- **Output.** Every result in `--json` has `severity`. A result can have `note`, and the terminal summary prints it under the result.

### Since rc.2

#### Report

- The verdict names built-in checks apart from scenario rules: `no leaks; 1 rule failed; built-in check sandboxPageUrl failed in 4 runs`. It no longer says "failed expectations" (#511).
- The verdict and the timeline headers use plain vendor names, such as Google Analytics 4 and server container. Row headers read `Name (key)` (#512).
- The report title says what was tested, for example `Pingwright suite: published vs workspace on shop.example.com, 2026-10-31`. The suite ID is in the details list (#513).
- The verdict uses `sends` for one vendor (#505). The `unchecked` legend names the unknown-signal case (#497).

#### Terminal notes

- The text summary prints the note under a result, passing or failing, for example that a plain name matches a top-level field only. `--json` has the note code in `note` (#510, #520).

#### Cookie rule

- A `cookie` rule no longer says a cookie was stored by the browser when it was already set before the response. The message reads `the cookie was already set before this response`, with no `cookieNotStored` note. A checkpoint taken within 50 ms after the request no longer counts as evidence (#470, #485, #518).

### Known in 0.3.0

Issues still open that you can meet:

- Under the recorder, Playwright sometimes does not report a redirect response or the cross-origin request after it (4 of 30 runs in a live-mode probe; not seen in about 220 CI runs of the stub-mode redirect tests). A hit or cookie reached only through such a hop can be missing from the record, so a `mustNot` rule or a before-consent check can pass without seeing it. In `stub` mode the hop can reach the network with no `stubBypass` flag, but the request before it gets a `possibleRedirectHop` flag. Live mode has no such flag. In live mode, `--net-log` can record a collection request the recorder missed, without its body. It does not recover cookies (#180).
- The `country` option does not localise zip, phone or address (#32).
- With `--net-log`, only requests inside a navigation window are labelled `unload`. Requests seen only in the net log outside such a window get the initiator `netlog`. The label is a guess from timing, so an early `srcdoc` iframe request on a later page can still read `unload`. This corrects the rc.2 wording (#256, #323).
- `unloadGap` maps only a small table of Shopify standard event names to GA4 names, and a custom event name that no vendor answered is skipped. Other custom names are compared literally. This corrects the rc.2 wording (#261).
- In the report, a segment with `early`, granted and denied hits shows `early` and not `mixed` (#496).
- A hand-edited `suite.json` with a malformed failed cell makes `report` throw instead of saying it is not a suite manifest (#506).
- `docs/cli.md` says a locator timeout lists only controls of the requested role, but roles outside button, radio, checkbox, link, tab and option get the general list (#490).

Not in 0.3.0: opt-in test payment steps for unattended checkout runs (#463), server-container visibility, baselines for CI drift checks, one scenario across several stores, WebKit support and an MCP server (#358 to #362), and a better release setup (#144).

## 0.3.0-rc.2

Release candidate. Install it with `npm i -g pingwright@next`.

### Report marks and severity

- A hit with unknown consent before the first answer now has its own mark, `early`, ranked above `full`. A hit on a page with a denied Consent Mode default is still `ping` (#378).
- The marks table says that `unchecked` covers identifier names whose consent signal is unknown, and that a hit with both granted and denied signals shows `mixed` (#448).
- The report shows `on failure: fail` or `on failure: warn` on a failed or warned result only. A passing result shows no severity (#458).
- Every result in `--json` has `severity`. A rule with none recorded reads `fail` (#349).

### Suite and report layout

- A suite cell says what failed: `FAIL: 5 rules, deniedIdentifiers` or `WARN: 1 rule`. It counts the failed rules and names the failed built-in checks, and never prints a rule or a message. A run that did not finish stays `ERROR (exit 2)`. The terminal table and the report use the same text (#457).
- The report starts with a plain-language verdict, then the results table, the per-run vendor timelines and the diff tables last. The verdict names vendors, consent states and counts per variant. A single-run report has the same verdict line at the top (#459).
- `diff` and the suite diff tables print `unloadGap: 0 -> 1` for a flag with no host. "(no host)" is gone (#348).

### Cookie and body rules

- A `cookie` rule that finds a `Set-Cookie` header now says whether the browser kept the cookie: `found _dcid from Set-Cookie (7 requests); stored by the browser`, or `no later checkpoint has it` with `note: cookieNotStored`. The rule still fails on the attempt. The message shows names and counts only (#461).
- `body.has` and `body.only` take a leaf name, `**.email`, which matches `email` at any depth. A plain name still matches a top-level field only. When it matches nothing but a nested field has that name, the result says so and has `note: nestedNameOnly` (#462).

### Fixed

- `serverHosts` uses the Public Suffix List (`tldts`) to reject wildcards on public suffixes. `*.police.uk`, `*.uk.com`, `*.fly.dev` and `*.onrender.com` are now rejected, and `*.abc.de` is no longer rejected. `*.wordpress.com` stays rejected through a short local list (#427).
- A `click` or `wait` on a `{ role, name }` locator that times out now lists the closest controls of that role, ranked by name, for example `Closest radio controls: "White (01)", "Black (02)".` If the page has none of that role, the error says so first (#460).
- The Done pill calls the DOM accessors it needs at show and hide time from copies taken at document start, so a page that patches `textContent`, `style`, `getRootNode`, `String`, `Function.prototype.call` or `Event.prototype.stopPropagation` never sees the label or the host. The Done click reads `isTrusted` from a captured getter and treats a throw as untrusted (#446, #494, #398, #492).
- The Done pill is at most the viewport width minus 32 px, and a long handoff text shrinks before the Done button does (#464).

### Handoff

- A late "not waiting" answer no longer stops the Done pill polling after a wake, so the pill hides when the second handoff ends (#444).
- A stale "not waiting" answer no longer hides the Done pill while a handoff is waiting (#502, #500).
- A page that cannot answer the wake no longer blocks Enter or Done from ending a handoff (#445).
- Tests now show the pill stops asking for the handoff state when none is waiting, and asks again on the next handoff (#443).

### Docs

- The README says the 0.3 sections need `npm i -g pingwright@next`, and that the plain install gives 0.2.0 (#450, #481).
- The Shopify guide says a handoff ends when the person clicks Done or presses Enter (#449).
- The handoff docs say a `body` rule does not hide the Done pill, because the host is a sibling of `<body>`. A rule such as `html { display: none }` can still hide it (#454, #480).
- The docs no longer say Enter always works (#451).
- Design section 11 lists `deniedIdentifiers` as a built-in check (#455).
- `docs/cli.md` says only a `--net-log` POST hit has no body (#479).

### Known in 0.3.0-rc.2

Not in rc.2:

- Opt-in test payment steps for unattended checkout runs (#463).
- Server-container visibility, baselines for CI drift checks, one scenario across several stores, WebKit support and an MCP server (#358 to #362).
- A better release setup (#144).

Known issues in rc.2:

- The recorder sometimes misses a redirect response and the cross-origin hop after it. In `stub` mode such a hop can reach the network with no record and no `stubBypass` flag (#180).
- The `country` option does not localise zip, phone or address (#32).
- With `--net-log`, requests seen only in the net log are all labelled with initiator `unload`, and early `srcdoc` requests can be labelled `unload` (#256, #323).
- `unloadGap` compares dataLayer event names to hit names literally (#261).
- A cookie set by a response still in flight at the last checkpoint can read as `cookieNotStored` (#485).
- In the report, a segment with `early`, granted and denied hits shows `early` and not `mixed` (#496).
- The report legend for `unchecked` does not mention identifier names whose consent signal is unknown (#497).
- The verdict says "send" for a single vendor (#505).
- A hand-edited `suite.json` with a malformed failed cell makes `report` throw instead of saying it is not a suite manifest (#506).
- `docs/cli.md` says a locator timeout lists only controls of the requested role, but roles outside button, radio, checkbox, link, tab and option get the general list (#490).

## 0.3.0-rc.1

Release candidate. Install it with `npm i -g pingwright@next`.

### Exit codes can change

The new `deniedIdentifiers` check is on by default and its severity is `fail`. A run that sent an identifier on a denied hit passed in 0.2 and now exits 1. Identifiers are `user_id`, `uid`, hashed `user_data` fields, client-ID hashes, and any field with a 64-character hex value. To keep exit code 0 while you fix the cause, set the check to `warn`:

```yaml
options:
  builtins: { deniedIdentifiers: warn }
```

The check also fails when a denied hit has a body that was not fully recorded: cut at 64 KiB, JSON that did not parse, or a `--net-log` hit with no body. `cid`, `client_id`, `fbp` and click IDs are not flagged. See "deniedIdentifiers" in [docs/cli.md](docs/cli.md).

### Record schema version 2

- `Run.recordSchemaVersion` is 2. 0.2 readers warn on it. Version 1 records still read.
- New optional fields: `Hit.fields` (names of non-empty payload fields), `Hit.fieldsComplete`, `Hit.idFields`, `Checkpoint.t`, `Run.graceWindowMs`, `Run.variant`, `Result.note` and `Step.locator`. They hold names and numbers, never values.
- A rule that needs field names and finds a version 1 record, or a body cut at 64 KiB, reports `cannot evaluate` and does not pass, unless the recorded fields already decide the rule.

### New rules and checks

- `body.has`, `body.only` and `body.ignore` check the field names of a hit, with `*` globs. `body.only` applies to every selected hit.
- `cookie` checks cookie names with `before`, `in` and `after`. In `stub` mode a pass carries the note `stubNoCookies`.
- `deniedIdentifiers` is a built-in check. `options.identifierFields` adds names to it.

### New commands

- `pingwright suite <dir> --site <url>` runs every scenario once per variant (`--variant published`, `--variant name=override.json`), prints a table with the diff between variants, and writes `suite.json`. Scenarios with a `handoff` step are skipped unless `--with-handoff` is given.
- `pingwright report <run.jsonl | suite dir> --html <out.html>` writes one HTML file with names and counts only. It has no script and makes no request.

### New steps and handoff

- `click` and `wait` accept `{ role, name }` and `{ any: [selectors] }`. A timeout lists the closest controls on the page.
- `select` chooses an option by value, then by label, and reads it back.
- A headed handoff shows a Done button in the page. Enter in the terminal still works.

### Server network mode

`--network server` is `stub` plus pass-through for the hosts in `options.serverHosts`. Every other collection request is still stubbed. It exists so that cookies set by a server container can be seen. Sends a page makes while it unloads are still answered in the page, also to server hosts.

Known in 0.3.0-rc.1, fixed in 0.3.0-rc.2:

- `diff` prints `unloadGap (no host)` for flags without a host (#348).
- In `--json` output, `expect` results have no `severity` (#349).
- Enter in the terminal can fail to end a handoff when a page does not answer the wake call (#445).

## 0.2.0

Added a GTM workspace override (`--gtm-override`, also through a Stape-style custom loader), `pingwright diff`, a Pinterest decoder, a curated tracker list that is stubbed and decoded, `--net-log`, the `builtins` severity option, and a Shopify checkout pattern.

Notes:

- In `stub` mode, a hit that a sandboxed frame without `allow-same-origin` (such as a Shopify custom pixel) sends while it unloads is not recorded. Pingwright raises an `unloadGap` warning. To record it, run with `--network live --net-log`. Unload sends from other frames are answered in the page and recorded, unless the tab goes to another origin.
- For Shopify custom pixels, set `builtins: { sandboxPageUrl: warn }`. The pixel runs in a sandboxed iframe, and a vendor that receives the sandbox URL as the page URL is a defect to report, not to fail on.
- A failed `identity.hashesMatch` names the params that do not match and the fields that do (#347).

Known in 0.2.0:

- `diff` prints `unloadGap (no host)` for flags without a host (#348).
- In `--json` output, `expect` results have no `severity`, so a script reads `null` (#349).
