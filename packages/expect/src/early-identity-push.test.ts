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

const withEmail = (email: string) => ({ ...identity, email });
const keyed = (email: string, key: string, value: unknown = email) => check([...undecided, push(100, { [key]: value })], { identity: withEmail(email) });

test('a key named like the identity email local part shows when it is a plain name', () => {
  const id = withEmail('user@example.test');
  const p = push(100, { event: 'login', user: { email: 'user@example.test' } });
  expect(JSON.stringify(p.args)).toContain('user@example.test');
  const r = check([...undecided, p], { identity: id });
  expect(r.pass).toBe(false);
  expect(r.message).toContain('user.email: email');
  expect(r.message).not.toContain('(other).email');
});

test.each([
  ['info@example.test', 'user_info'],
  ['data@example.test', 'user_data'],
])('a plain key holding a short common local part (%s) is shown', (email, key) => {
  const r = keyed(email, key);
  expect(r.pass).toBe(false);
  expect(r.message).toContain(`${key}: email`);
  expect(r.message).not.toContain('(other)');
});

test.each(['ab_at_example_test', 'ab_example_test'])('a key with a short local part next to an at-marker or the domain reads (other): %s', (key) => {
  expect(key).toContain('ab');
  const r = keyed('ab@example.test', key);
  expect(r.pass).toBe(false);
  expect(r.message).toContain('(other): email');
  for (const leak of [key, 'ab@example.test', 'ab']) expect(r.message).not.toContain(leak);
});

test('a key that only starts like the domain label is shown: user_examples', () => {
  const r = keyed('user@example.test', 'user_examples');
  expect(r.pass).toBe(false);
  expect(r.message).toContain('user_examples: email');
  expect(r.message).not.toContain('(other)');
});

test('a key with the domain label followed by the next domain label reads (other): userexampletest', () => {
  const r = keyed('user@example.test', 'userexampletest');
  expect(r.pass).toBe(false);
  expect(r.message).toContain('(other): email');
  for (const leak of ['userexampletest', 'user@example.test']) expect(r.message).not.toContain(leak);
});

test.each(['userexamplecooptest', 'user_example_co_op_test', 'userexampleco-optest'])('a key that holds user@example.co-op.test reads (other): %s', (key) => {
  const r = keyed('user@example.co-op.test', key);
  expect(r.pass).toBe(false);
  expect(r.message).toContain('(other): email');
  expect(r.message).not.toContain('user');
});

test.each([
  ['user@my-shop.test', 'usermyshoptest'],
  ['user@my-shop.test', 'user_my_shop_test'],
  ['user@xn--bcher-kva.test', 'userxnbcherkvatest'],
  ['first.last@example.test', 'first_last_example_test'],
  ['first.last@example.test', 'firstlastexampletest'],
])('a key that holds %s with separators in the address reads (other): %s', (email, key) => {
  const r = keyed(email, key);
  expect(r.pass).toBe(false);
  expect(r.message).toContain('(other): email');
  expect(r.message).not.toContain('user');
  expect(r.message).not.toContain('first');
});

test.each(['user_at_example_test', 'user_example_test', 'user@example.test', 'user%40example.test', 'user(at)example.test'])('a key that holds user@example.test reads (other): %s', (key) => {
  expect(key).toContain('user');
  const r = keyed('user@example.test', key);
  expect(r.pass).toBe(false);
  expect(r.message).toContain('(other): email');
  for (const leak of [key, 'user@example.test', 'user']) expect(r.message).not.toContain(leak);
});

test('a key equal to the default identity local part reads (other)', () => {
  const local = identity.email.split('@')[0]!;
  const r = keyed(identity.email, local);
  expect(r.pass).toBe(false);
  expect(r.message).toContain('(other): email');
  expect(r.message).not.toContain(local);
  expect(r.message).not.toContain(identity.email);
});

test('a key that contains a long local part reads (other)', () => {
  const key = 'x_longlocalpart_y';
  expect(key).toContain('longlocalpart');
  const r = keyed('longlocalpart@example.test', key);
  expect(r.message).toContain('(other): email');
  expect(r.message).not.toContain('longlocalpart');
});

test('foreign values never warn, under keys that look like the email parts', () => {
  const id = withEmail('user@example.test');
  const page = (value: string) => push(100, { user: value, user_at_example_test: value, nested: { user: { email: value } } });
  const foreign = check([...undecided, page('fake.person@example.test')], { identity: id });
  expect(foreign.pass).toBe(true);
  expect(foreign.evidence).toEqual([]);
  expect(foreign.message).not.toContain('fake.person@example.test');
  const own = check([...undecided, page('user@example.test')], { identity: id });
  expect(own.pass).toBe(false);
  expect(own.message).not.toContain('user@example.test');
});

test('a trailing separator in the local part does not block the at-marker', () => {
  const r = keyed('u_@example.test', 'u__at_example');
  expect(r.pass).toBe(false);
  expect(r.message).toContain('(other): email');
  expect(r.message).not.toContain('u__at_example');
});

test('dots in the local part do not shorten it for the bare-local check', () => {
  const email = 'j.o.h.n@example.test';
  for (const key of ['j.o.h.n', 'john']) {
    const r = keyed(email, key);
    expect(r.pass).toBe(false);
    expect(r.message).toContain('(other): email');
    expect(r.message).not.toContain('j.o.h.n');
  }
});

const buyer = { ...createIdentity(1), email: 'buyer@example.test', phone: '+4512345678', extra: [] as string[] };
const pushed = (item: unknown) => check([...undecided, push(10, item)], { identity: buyer });
const argsHold = (item: unknown, text: string) => expect(JSON.stringify([item])).toContain(text);
const noneOf = (message: string | undefined, ...values: string[]) => {
  for (const v of values) expect(message ?? '').not.toContain(v);
};

test('whole-email matching: a foreign email containing the run email is not the run own', () => {
  argsHold({ user: { email: 'other.buyer@example.test' } }, 'other.buyer@example.test');
  expect(pushed({ user: { email: 'other.buyer@example.test' } })).toMatchObject({ pass: true, evidence: [] });
  const own = pushed({ user: { email: 'buyer@example.test' } });
  expect(own.pass).toBe(false);
  expect(own.message).toContain('user.email: email');
});

test('a digest of the run email or phone is found under digest, percent-encoded, with no value in the message', () => {
  const email = encodeURIComponent(hashEmail('buyer@example.test').base64);
  const phone = encodeURIComponent(hashPhone(buyer.phone).base64);
  argsHold({ digest: email }, email);
  argsHold({ digest: phone }, phone);
  const e = pushed({ digest: email });
  expect(e.pass).toBe(false);
  expect(e.message).toContain('digest: email hash');
  const p = pushed({ digest: phone });
  expect(p.pass).toBe(false);
  expect(p.message).toContain('digest: phone hash');
  const hashes = [hashEmail('buyer@example.test'), hashPhone(buyer.phone)].flatMap((h) => [h.hex, h.base64, h.base64url, encodeURIComponent(h.base64)]);
  noneOf(`${e.message}${p.message}`, 'buyer@example.test', buyer.phone, '4512345678', ...hashes);
});

test('a key that is the run email is found whatever the child is, with the masked path', () => {
  for (const child of [true, null, { a: 1 }]) {
    const item = { 'buyer@example.test': child };
    expect(Object.keys(item)[0]).toContain('buyer@example.test');
    const r = pushed(item);
    expect(r.pass).toBe(false);
    expect(r.evidence).toHaveLength(1);
    expect(r.message).toContain('(other): email');
    noneOf(r.message, 'buyer@example.test', 'buyer');
  }
});

test('the foreign pair of percent-encoded email, key and digest passes and the own pair fails', () => {
  const foreignDigest = encodeURIComponent(hashEmail('other.buyer@example.test').base64);
  const foreign = [{ e: 'other.buyer%40example.test' }, { 'other.buyer@example.test': true }, { digest: foreignDigest }];
  argsHold(foreign[0], 'other.buyer');
  argsHold(foreign[1], 'other.buyer');
  for (const f of foreign) expect(pushed(f)).toMatchObject({ pass: true, evidence: [] });
  const ownDigest = encodeURIComponent(hashEmail('buyer@example.test').base64);
  const own = [{ e: 'buyer%40example.test' }, { 'buyer@example.test': true }, { digest: ownDigest }];
  argsHold(own[0], 'buyer%40example.test');
  argsHold(own[1], 'buyer@example.test');
  argsHold(own[2], ownDigest);
  for (const o of own) expect(pushed(o).pass).toBe(false);
});

test('a plain phone is the run own only when its digits are equal', () => {
  for (const v of ['+45123456789', '+994512345678', '9912345678']) {
    argsHold({ p: v }, v);
    expect(pushed({ p: v })).toMatchObject({ pass: true, evidence: [] });
  }
  for (const v of ['+4512345678', '+45 12 34 56 78']) {
    argsHold({ p: v }, v);
    const r = pushed({ p: v });
    expect(r.pass).toBe(false);
    expect(r.message).toContain('p: phone');
    noneOf(r.message, v, '12 34 56 78', '4512345678', '12345678');
  }
});

test('known limit: base64 readings keep the contains rule', () => {
  const email = Buffer.from('other.buyer@example.test').toString('base64');
  const phone = Buffer.from('+994512345678').toString('base64');
  expect(Buffer.from(email, 'base64').toString()).toContain('other.buyer@example.test');
  expect(Buffer.from(phone, 'base64').toString()).toContain('+994512345678');
  expect(pushed({ d: email }).pass).toBe(false);
  expect(pushed({ d: phone }).pass).toBe(false);
});
