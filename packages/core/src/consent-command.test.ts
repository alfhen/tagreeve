import { expect, test } from 'vitest';
import { argumentsListOf, consentCommandOf } from './consent-command.ts';

const signals = { ad_storage: 'denied', analytics_storage: 'granted' };

test.each(['default', 'update'])('%s reads the same in the array and the object form', (command) => {
  const fromArray = consentCommandOf(['consent', command, signals]);
  expect(fromArray).toEqual({ command, signals });
  expect(consentCommandOf([{ 0: 'consent', 1: command, 2: signals }])).toEqual(fromArray);
});

test.each([
  ['an unknown sub-command', [{ 0: 'consent', 1: 'foo' }]],
  ['another command', [{ 0: 'config' }]],
  ['a gap in the keys', [{ 0: 'consent', 2: {} }]],
  ['an extra key', [{ 0: 'consent', 1: 'default', 2: {}, extra: 1 }]],
  ['two items', [{ 0: 'consent', 1: 'default', 2: {} }, {}]],
  ['a nested array', [['consent', 'default', {}]]],
  ['a wrong case', ['Consent', 'default', {}]],
  ['an array with an unknown sub-command', ['consent', 'foo', {}]],
  ['no args', []],
])('%s gives no command', (_, args) => {
  expect(consentCommandOf(args)).toBeUndefined();
});

const stamp = { 'gtm.uniqueEventId': 7 };
const stamps = { 'gtm.uniqueEventId': 7, 'gtm.start': 1 };
const plain = { 0: 'consent', 1: 'default', 2: signals };

test.each([['one gtm. key', stamp], ['two gtm. keys', stamps]])('%s is left out of the arguments list', (_, extra) => {
  const args = [{ ...plain, ...extra }];
  expect(argumentsListOf(args)).toEqual(['consent', 'default', signals]);
  expect(consentCommandOf(args)).toEqual({ command: 'default', signals });
});

test.each([
  ['foo', { ...plain, foo: 1 }],
  ['event', { ...plain, event: 'x' }],
  ['foo next to a gtm. key', { ...plain, ...stamp, foo: 1 }],
  ['gtm_uniqueEventId', { ...plain, gtm_uniqueEventId: 7 }],
  ['gtmx.uniqueEventId', { ...plain, 'gtmx.uniqueEventId': 7 }],
  ['x.gtm.uniqueEventId', { ...plain, 'x.gtm.uniqueEventId': 7 }],
  ['only gtm. keys', stamp],
])('an extra key of %s keeps the object from being an arguments list', (_, item) => {
  expect(argumentsListOf([item])).toBeUndefined();
  expect(consentCommandOf([item])).toBeUndefined();
});

test('one index key and a gtm. key still read as a list', () => {
  expect(argumentsListOf([{ 0: 'consent', ...stamp }])).toEqual(['consent']);
});
