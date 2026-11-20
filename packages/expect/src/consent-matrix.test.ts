import { describe, expect, test } from 'vitest';
import { isConsentState, ownConsentState, ruleCount, withConsent } from './consent-matrix.ts';
import { parseScenario } from './scenario.ts';

const BODY = `start: /
options:
  withdrawWith: "#pw-cookie-settings"
steps:
  - consent: accept
  - visit: /b
  - consent: reject
expect:
  must:
    - vendor: ga4
      event: page_view
  mustNot:
    - vendor: meta
`;

const strip = (steps: { kind: string; value: unknown; label: string }[]) => steps.map(({ kind, value, label }) => ({ kind, value, label }));

describe('withConsent', () => {
  test('sets only the first consent step', () => {
    const s = parseScenario(BODY);
    const steps = withConsent(s, 'reject').steps;
    expect(steps.map((x) => [x.kind, x.value])).toEqual([['consent', 'reject'], ['visit', '/b'], ['consent', 'reject']]);
  });

  test('withdraw answers accept, waits, clicks and withdraws', () => {
    const s = parseScenario(BODY);
    const by_hand = parseScenario(`start: /
steps:
  - consent: accept
  - wait: 1s
  - click: "#pw-cookie-settings"
  - consent: withdraw
  - visit: /b
  - consent: reject
`);
    expect(strip(withConsent(s, 'withdraw').steps)).toEqual(strip(by_hand.steps));
  });

  test('keeps rules in the own cell and empties them in the others', () => {
    const s = parseScenario(BODY);
    expect(withConsent(s, 'accept').expect).toEqual(s.expect);
    for (const state of ['reject', 'none', 'withdraw'] as const) expect(withConsent(s, state).expect).toEqual({ must: [], mustNot: [] });
  });

  test('does not change the input', () => {
    const s = parseScenario(BODY);
    const before = JSON.stringify(s);
    for (const state of ['accept', 'reject', 'none', 'withdraw'] as const) withConsent(s, state);
    expect(JSON.stringify(s)).toBe(before);
  });

  test('a moved default label follows its index', () => {
    const s = parseScenario(`start: /
options:
  withdrawWith: "#x"
steps:
  - consent: accept
  - visit: /b
  - checkpoint: end
`);
    expect(withConsent(s, 'withdraw').steps.map((x) => x.label)).toEqual(['consent-1', 'wait-2', 'click-3', 'consent-4', 'visit-5', 'end']);
  });

  test('an inserted step does not take a label another step keeps', () => {
    const s = parseScenario(`start: /
options:
  withdrawWith: "#x"
steps:
  - consent: accept
    label: wait-2
  - visit: /b
`);
    const labels = withConsent(s, 'withdraw').steps.map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toBe('wait-2');
  });
});

describe('helpers', () => {
  test('ownConsentState and ruleCount', () => {
    const s = parseScenario(BODY);
    expect(ownConsentState(s)).toBe('accept');
    expect(ruleCount(s)).toBe(2);
    expect(isConsentState('maybe')).toBe(false);
  });

  test('withdrawWith must be a selector', () => {
    expect(() => parseScenario('start: /\noptions:\n  withdrawWith: 3\n')).toThrow(/withdrawWith/);
  });
});
