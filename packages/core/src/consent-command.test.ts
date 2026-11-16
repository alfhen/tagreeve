import { expect, test } from 'vitest';
import { consentCommandOf } from './consent-command.ts';

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
