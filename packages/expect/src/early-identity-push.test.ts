import { createIdentity, hashEmail, hashPhone, newId, type ConsentEpoch, type ConsentState, type DataLayerEvent, type Result } from '@tagreeve/core';
import { expect, test } from 'vitest';
import { evaluate } from './evaluate.ts';
import { BUILTIN_NAMES, parseScenario } from './scenario.ts';

const runId = newId('run');
const identity = { ...createIdentity(1), extra: ['second.buyer@example.test'] };
const NAME = 'builtin: earlyIdentityPush';

const state = (analytics: string, ads: string, adUserData: string): ConsentState => ({ analytics, ads, adUserData, adPersonalization: ads, raw: {} }) as ConsentState;
const unknown = state('unknown', 'unknown', 'unknown');
const granted = state('granted', 'granted', 'granted');

function epoch(startT: number, endT: number | null, label: ConsentEpoch['label'], s: ConsentState): ConsentEpoch {
  return { type: 'consentEpoch', id: newId('consentEpoch'), runId, startT, endT, source: 'test', label, state: s };
}

function push(t: number, item: unknown): DataLayerEvent {
  return { type: 'dataLayerEvent', id: newId('dataLayerEvent'), runId, stepId: null, t, event: 'login', gtmUniqueEventId: null, args: [item], isConsentCommand: false };
}

function check(records: unknown[], options: { identity?: typeof identity } = { identity }, yaml = 'start: /'): Result {
  return evaluate(records as never, parseScenario(yaml), options).find((r) => r.expectation === NAME)!;
}

const undecided = [epoch(0, null, 'undecided', unknown)];
const grantedLater = [epoch(0, 1000, 'undecided', unknown), epoch(1000, null, 'granted', granted)];

test('earlyIdentityPush is a builtin name', () => {
  expect(BUILTIN_NAMES).toContain('earlyIdentityPush');
});

test('an email and its hash in two pushes before the answer warn, naming push, path and kind but no value', () => {
  const a = push(100, { event: 'login', user: { email: identity.email } });
  const b = push(120, { event: 'login', user: { sha256_email_address: hashEmail(identity.email).hex } });
  const r = check([...undecided, a, b]);
  expect(r.pass).toBe(false);
  expect(r.severity).toBe('warn');
  expect(r.evidence).toEqual([a.id, b.id]);
  expect(r.message).toContain('user.email: email');
  expect(r.message).toContain('user.sha256_email_address: email hash');
  for (const secret of [identity.email, hashEmail(identity.email).hex]) expect(r.message).not.toContain(secret);
});

test('a phone hash and a value in an array are found', () => {
  const r = check([...undecided, push(100, { users: [{ ph: hashPhone(identity.phone).hex }, { tel: identity.phone }] })]);
  expect(r.message).toContain('users[].ph: phone hash');
  expect(r.message).toContain('users[].tel: phone');
});

test('a key that is the email is masked in the key path', () => {
  const r = check([...undecided, push(100, { [identity.email]: identity.email })]);
  expect(r.pass).toBe(false);
  expect(r.message).not.toContain(identity.email);
});

test('a foreign email, a push in the granted epoch and a push in the grace window pass', () => {
  const own = { user: { email: identity.email } };
  expect(check([...undecided, push(100, { user: { email: 'fake.person@example.test' } })]).pass).toBe(true);
  expect(check([...grantedLater, push(1500, own)]).pass).toBe(true);
  expect(check([...grantedLater, push(990, own)]).pass).toBe(true);
  expect(check([...grantedLater, push(900, own)]).pass).toBe(false);
});

test('a mixed epoch with only ads denied passes and one with adUserData denied warns', () => {
  const own = push(100, { user: { email: identity.email } });
  expect(check([epoch(0, null, 'mixed', state('granted', 'denied', 'granted')), own]).pass).toBe(true);
  expect(check([epoch(0, null, 'mixed', state('granted', 'granted', 'denied')), own]).pass).toBe(false);
});

test('the identity comes from the run record when no option is given', () => {
  const run = { type: 'run', id: runId, identity };
  expect(check([run, ...undecided, push(100, { user: { email: identity.email } })], {}).pass).toBe(false);
});

test('with no identity it passes and says it could not check', () => {
  const r = check([...undecided, push(100, { user: { email: identity.email } })], {});
  expect(r.pass).toBe(true);
  expect(r.message).toMatch(/could not check/i);
  expect(r.message).not.toContain(identity.email);
});

test('the phone as digits, as a string or a number, is found without the value', () => {
  const digits = identity.phone.replace(/\D/g, '');
  for (const value of [digits, Number(digits)]) {
    const r = check([...undecided, push(100, { user: { phone_number: value } })]);
    expect(r.pass).toBe(false);
    expect(r.message).toContain('user.phone_number: phone');
    expect(r.message).not.toContain(digits);
  }
});

test('a fail override sets the severity', () => {
  const r = check([...undecided, push(100, { user: { email: identity.email } })], { identity }, 'start: /\noptions:\n  builtins: { earlyIdentityPush: fail }');
  expect(r.severity).toBe('fail');
  expect(r.pass).toBe(false);
});
