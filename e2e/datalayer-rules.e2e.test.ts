import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { outDir, run, runCli, site, type CliRun } from './cli-helpers.ts';

interface Summary {
  results: { expectation: string; pass: boolean; message: string; evidence: string[] }[];
}

const SENTINELS = ['pw-rule-sentinel-coupon', 'pw-rule-sentinel-sku', 'pw-rule-sentinel-name', 'pw-rule-sentinel-order'];

const dataLayerResults = (r: CliRun) => (JSON.parse(r.stdout) as Summary).results.filter((x) => /^(?:must|mustNot): /.test(x.expectation) && x.expectation.includes('dataLayer'));
const purchasePushes = (r: CliRun) => r.records!.dataLayerEvents.filter((e) => e.event === 'purchase');

let counter = 0;

async function runText(text: string): Promise<CliRun> {
  const file = join(outDir, `datalayer-rules-${++counter}.yml`);
  await writeFile(file, text);
  return runCli(['run', file, '--site', site.url, '--out', outDir, '--json']);
}

const onPage = (rules: string) =>
  `start: /datalayer-rules
steps:
  - wait: 1s
  - consent: accept
    label: answer
  - wait: 1s
expect:
${rules}
options: { seed: 1, allowUnknownDestination: true }
`;

describe('/datalayer-rules', () => {
  test('a purchase without transaction_id fails the rule and names the push, and ?complete=1 passes', async () => {
    const failing = await run('datalayer-rules');
    const passing = await run('datalayer-rules-pass');

    expect(failing.code, failing.stderr).toBe(1);
    const [fail] = dataLayerResults(failing);
    expect(dataLayerResults(failing)).toHaveLength(1);
    expect(fail!.expectation.startsWith('must:')).toBe(true);
    expect(fail!.pass).toBe(false);
    const purchase = purchasePushes(failing);
    expect(purchase).toHaveLength(1);
    expect(purchase[0]!.id.startsWith('dle_')).toBe(true);
    expect(fail!.evidence).toContain(purchase[0]!.id);

    expect(passing.code, passing.stderr).toBe(0);
    const [pass] = dataLayerResults(passing);
    expect(pass!.pass).toBe(true);
    expect(pass!.evidence).toEqual([purchasePushes(passing)[0]!.id]);
  }, 150_000);

  test('mustNot purchase before consent fails, and after the accept step passes', async () => {
    const before = await runText(onPage('  mustNot:\n    - { dataLayer: { event: purchase }, before: consent }'));
    const records = before.records!;
    const purchase = purchasePushes(before)[0]!;
    const firstUpdate = records.dataLayerEvents.find((e) => e.isConsentCommand && e.args[1] === 'update')!;
    expect(purchase).toBeDefined();
    expect(firstUpdate).toBeDefined();
    expect(purchase.t).toBeLessThan(firstUpdate.t);

    expect(before.code, before.stderr).toBe(1);
    const [early] = dataLayerResults(before);
    expect(early!.pass).toBe(false);
    expect(early!.evidence).toEqual([purchase.id]);

    const after = await runText(onPage('  mustNot:\n    - { dataLayer: { event: purchase }, after: answer }'));
    expect(after.code, after.stderr).toBe(0);
    const [late] = dataLayerResults(after);
    expect(late!.pass).toBe(true);
    expect(late!.evidence).toEqual([]);
  }, 150_000);

  test('no pushed value appears in the output, the messages or the evidence', async () => {
    const failing = await run('datalayer-rules');
    const passing = await run('datalayer-rules-pass');
    for (const r of [failing, passing]) {
      const args = JSON.stringify(r.records!.dataLayerEvents.map((e) => e.args));
      for (const sentinel of SENTINELS)expect(args, sentinel).toContain(sentinel);
      expect(dataLayerResults(r)).toHaveLength(1);
      const results = r.records!.results;
      for (const sentinel of SENTINELS) {
        expect(r.stdout).not.toContain(sentinel);
        expect(r.stderr).not.toContain(sentinel);
        for (const result of results) {
          expect(result.message ?? '').not.toContain(sentinel);
          expect(JSON.stringify(result.evidence)).not.toContain(sentinel);
        }
      }
    }
    expect(dataLayerResults(failing)[0]!.message).toContain('ecommerce.transaction_id');
  }, 150_000);
});

describe('the plain GTM shop', () => {
  test('a purchase with transaction_id passes on /plain/thank-you', async () => {
    const r = await runText(`start: /plain/product
steps:
  - consent: accept
  - visit: /plain/checkout
  - fill:
      "#email": email
      "#first-name": firstName
      "#last-name": lastName
      "#phone": phone
      "#address1": address1
      "#city": city
      "#zip": zip
      "#country": SE
  - click: "#place-order"
  - wait: 3s
expect:
  must:
    - dataLayer: { event: purchase, has: [ecommerce.transaction_id] }
options: { seed: 1 }
`);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(r.records!.hits.some((h) => h.page?.includes('/plain/thank-you'))).toBe(true);
    const [result] = dataLayerResults(r);
    expect(result!.pass).toBe(true);
    const purchase = purchasePushes(r);
    expect(purchase).toHaveLength(1);
    expect(result!.evidence).toEqual([purchase[0]!.id]);
  }, 150_000);
});

describe('a bad dataLayer rule', () => {
  const offline = async (name: string, rule: string, text: string): Promise<CliRun> => {
    const file = join(outDir, `${name}.yml`);
    await writeFile(file, `start: /\nexpect:\n  must:\n    - ${rule}\n`);
    expect(await readFile(file, 'utf8')).toContain(text);
    return runCli(['run', file, '--site', 'http://127.0.0.1:9', '--json']);
  };

  test('a numbered index exits 2 with a hint to write [*]', async () => {
    const r = await offline('datalayer-rules-index', '{ dataLayer: { event: purchase, has: ["ecommerce.items[3].item_id"] } }', 'items[3]');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('dataLayer.has');
    expect(r.stderr).toContain('[*]');
  }, 60_000);

  test('an event name that reads (other) exits 2 and the value is not printed', async () => {
    const email = 'fake.person@example.test';
    const r = await offline('datalayer-rules-event', `{ dataLayer: { event: "${email}" } }`, email);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('dataLayer.event');
    expect(r.stderr).not.toContain(email);
    expect(r.stdout).not.toContain(email);
  }, 60_000);
});
