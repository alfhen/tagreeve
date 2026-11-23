# Audit consent across the four states

Tagreeve can run one journey in four consent states and put what each state sent on one page. It shows what was sent and flags likely problems. People decide what is allowed. This guide runs the two commands and reads the page. You need a working [first run](./first-run.md). All values below are fake.

The four states are `accept`, `reject`, `none` (the visitor never answers) and `withdraw` (the visitor accepts, then withdraws).

## Run the suite

The scenario needs a `consent` step, because the first one is the point where the states differ. For `withdraw` it also needs `options.withdrawWith`, the selector the browser clicks to reopen the consent choice. Add `canaries: true` to plant fake click IDs on the start URL:

```yaml
start: /
options:
  canaries: true
  withdrawWith: "#cookie-settings"
steps:
  - consent: reject
  - visit: /products
```

Then run the suite and write the report:

```bash
tagreeve suite tagreeve/scenarios --consent accept,reject,none,withdraw --site https://shop.example.com
tagreeve report tagreeve/runs/<date>/suite_<id> --html consent-audit.html
```

Each cell runs the scenario with the first `consent` step set to its state. The scenario's own rules run in the cell of their own state. The other cells run the built-in checks, and the page says how many rules they skipped.

## Read the Consent audit section

The section starts with a fixed line. It says that the report shows what was sent and flags likely problems, and that people decide what is allowed. It also says that a pass means no planted value was found in the searched forms. Tagreeve searched the URL, the body and decoded fields of each request. It did not search request headers, including `Referer` and `Cookie`.

Under the line, a table shows the hit count of each vendor in each state. A vendor that sends in `reject` or `none` is the first thing to look at.

Then there is one column for each state:

- **Verdict.** PASS, WARN or FAIL of the cell, as in the suite table.
- **Rules and built-in checks.** The rules and checks that failed or warned, by name.
- **Identifier routes.** One line for each group of planted values that reached the same host other than the store, in the same field and consent epoch with the same verdict. A line names the values, the request count, the sink host, the epoch and the verdict. A value seen only in the page URL field is a warning.
- **consentModeSetup.** Whether a Google hit shows a Consent Mode signal that was never set. It is a warning by default.
- **Searched and skipped.** The forms searched, the parts searched and not searched, and the requests that were skipped, such as compressed bodies.

Each column comes from its own record. If a record is missing, or names another state, the column says so and the page has a warning. The page holds names and counts only. It never shows a canary, an identity value or a value seen in a request.

See [Reading a run's results](./reading-results.md#identifier-routes) for the identifier routes of one run, and the [CLI page](../cli.md) for the suite options.
