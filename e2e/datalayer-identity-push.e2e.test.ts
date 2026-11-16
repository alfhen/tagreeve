import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import type { DataLayerEvent, RunRecords } from '../packages/core/src/index.ts';
import { run, runText, type CliRun } from './cli-helpers.ts';

const EMAIL = 'pw-fixture@example.com';
const HASH = createHash('sha256').update(EMAIL).digest('hex');
const NAME = 'builtin: earlyIdentityPush';

interface Summary {
  results: { expectation: string; pass: boolean; severity?: string; message: string; evidence: string[] }[];
}

const resultsOf = (r: CliRun) => (JSON.parse(r.stdout) as Summary).results.filter((x) => x.expectation === NAME);
const holds = (e: DataLayerEvent, value: string) => JSON.stringify(e.args).includes(value);
const pushesOf = (records: RunRecords, value: string) => records.dataLayerEvents.filter((e) => holds(e, value));
const answerAt = (records: RunRecords, label: string) => records.consentEpochs.find((e) => e.label === label)!.startT;

test('an email push and an email hash push before the answer give one warning that names both and keeps exit 0', async () => {
  const r = await run('datalayer-identity-push');
  const records = r.records!;
  expect(records.run.identity?.email).toBe(EMAIL);
  const [emailPush] = pushesOf(records, EMAIL);
  const [hashPush] = pushesOf(records, HASH);
  expect(emailPush).toBeDefined();
  expect(hashPush).toBeDefined();
  const granted = answerAt(records, 'granted');
  expect(emailPush!.t).toBeLessThan(granted);
  expect(hashPush!.t).toBeLessThan(granted);

  const results = resultsOf(r);
  expect(results).toHaveLength(1);
  const [result] = results;
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('warn');
  expect(result!.evidence).toEqual(expect.arrayContaining([emailPush!.id, hashPush!.id]));
  expect(result!.evidence.every((id) => id.startsWith('dle_'))).toBe(true);
  expect(result!.message).toContain('user.email: email');
  expect(result!.message).toContain('user.sha256_email_address: email hash');
  expect(r.code).toBe(0);
}, 150_000);

test('the email and its hash are in the push records and in no output or result record', async () => {
  const json = await run('datalayer-identity-push');
  const text = await runText('datalayer-identity-push');
  const records = json.records!;
  expect(pushesOf(records, EMAIL).length).toBeGreaterThan(0);
  expect(pushesOf(records, HASH).length).toBeGreaterThan(0);
  const result = records.results.find((x) => x.expectation === NAME)!;
  expect(result.pass).toBe(false);
  expect(text.stdout).toContain('earlyIdentityPush');
  for (const secret of [EMAIL, HASH]) {
    expect(text.stdout).not.toContain(secret);
    expect(json.stdout).not.toContain(secret);
    expect(result.message).not.toContain(secret);
    expect(JSON.stringify(result.evidence)).not.toContain(secret);
  }
}, 150_000);

test('a push after an accept gives no finding, and a push after a reject gives a warning', async () => {
  const accept = await run('datalayer-identity-after');
  const acceptPush = pushesOf(accept.records!, EMAIL)[0];
  expect(acceptPush).toBeDefined();
  expect(acceptPush!.t).toBeGreaterThanOrEqual(answerAt(accept.records!, 'granted'));
  expect(resultsOf(accept).map((r) => r.pass)).toEqual([true]);

  const reject = await run('datalayer-identity-reject');
  const rejectPush = pushesOf(reject.records!, EMAIL)[0];
  expect(rejectPush).toBeDefined();
  expect(rejectPush!.t).toBeGreaterThanOrEqual(answerAt(reject.records!, 'denied'));
  const [result] = resultsOf(reject);
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('warn');
  expect(result!.evidence).toContain(rejectPush!.id);
  expect(reject.code).toBe(0);
}, 150_000);

test('builtins earlyIdentityPush: fail turns the warning into exit 1', async () => {
  const r = await run('datalayer-identity-push-fail');
  expect(r.code).toBe(1);
  expect(r.failed).toContain(NAME);
  expect(resultsOf(r)[0]!.severity).toBe('fail');
}, 150_000);

test('a foreign email before consent stays a possibleRealDataPush flag, and the run own email on the same page warns', async () => {
  const foreign = await run('datalayer-identity-foreign');
  const records = foreign.records!;
  expect(records.run.identity?.email).not.toBe(EMAIL);
  expect(pushesOf(records, EMAIL).length).toBeGreaterThan(0);
  expect(records.flags.some((f) => f.kind === 'possibleRealDataPush')).toBe(true);
  expect(resultsOf(foreign).map((r) => r.pass)).toEqual([true]);

  const own = await run('datalayer-identity-push');
  expect(resultsOf(own).map((r) => r.pass)).toEqual([false]);
}, 150_000);

test('on the plain shop the checkout pushes the typed email after the accept, and with ?identity=early before the answer', async () => {
  const late = await run('plain-identity-default');
  const lateRecords = late.records!;
  const lateEmail = lateRecords.run.identity!.email;
  const latePush = pushesOf(lateRecords, lateEmail)[0];
  expect(latePush).toBeDefined();
  expect(latePush!.t).toBeGreaterThanOrEqual(answerAt(lateRecords, 'granted'));
  expect(resultsOf(late).map((r) => r.pass)).toEqual([true]);

  const early = await run('plain-identity-early');
  const earlyRecords = early.records!;
  const earlyPush = pushesOf(earlyRecords, earlyRecords.run.identity!.email)[0];
  expect(earlyPush).toBeDefined();
  expect(earlyPush!.t).toBeLessThan(answerAt(earlyRecords, 'granted'));
  const [result] = resultsOf(early);
  expect(result!.pass).toBe(false);
  expect(result!.severity).toBe('warn');
  expect(result!.evidence).toContain(earlyPush!.id);
  expect(early.code).toBe(0);
}, 150_000);
