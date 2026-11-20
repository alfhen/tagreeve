import type { Scenario, Step } from './scenario.ts';

export type ConsentState = Extract<Step, { kind: 'consent' }>['value'];
export const CONSENT_STATES: readonly ConsentState[] = ['accept', 'reject', 'none', 'withdraw'];

export function isConsentState(value: string): value is ConsentState {
  return (CONSENT_STATES as readonly string[]).includes(value);
}

/** The state of the scenario's first consent step. It is the one cell that keeps the scenario's rules. */
export function ownConsentState(scenario: Pick<Scenario, 'steps'>): ConsentState | undefined {
  const first = scenario.steps.find((s) => s.kind === 'consent');
  return first?.kind === 'consent' ? first.value : undefined;
}

export function ruleCount(scenario: Pick<Scenario, 'expect'>): number {
  return scenario.expect.must.length + scenario.expect.mustNot.length;
}

/** A copy of the scenario for one cell of a consent matrix. The input is not changed. */
export function withConsent(scenario: Scenario, state: ConsentState): Scenario {
  const at = scenario.steps.findIndex((s) => s.kind === 'consent');
  const expect = state === ownConsentState(scenario) ? { must: [...scenario.expect.must], mustNot: [...scenario.expect.mustNot] } : { must: [], mustNot: [] };
  if (at < 0) return { ...scenario, steps: [...scenario.steps], expect };
  const first = scenario.steps[at]!;
  const withdrawWith = scenario.options.withdrawWith;
  const inserted: Step[] =
    state === 'withdraw' && withdrawWith !== undefined
      ? [
          { kind: 'consent', value: 'accept', label: first.label, line: first.line },
          { kind: 'wait', value: 1000, label: '', line: first.line },
          { kind: 'click', value: withdrawWith, label: '', line: first.line },
          { kind: 'consent', value: 'withdraw', label: '', line: first.line },
        ]
      : [{ kind: 'consent', value: state, label: first.label, line: first.line }];
  const shift = inserted.length - 1;
  const moved = [...scenario.steps.slice(0, at), ...inserted, ...scenario.steps.slice(at + 1)].map((step, i) => {
    const was = i < at ? i : i - shift;
    const inserting = i >= at && i < at + inserted.length;
    // Default labels are kind-index, so a step that moved takes the label its new index gives it.
    const renamed = step.label === '' || (!inserting && step.label === `${step.kind}-${was + 1}`);
    return { step, renamed };
  });
  const taken = new Set(moved.filter((m) => !m.renamed).map((m) => m.step.label));
  const steps = moved.map(({ step, renamed }, i) => {
    if (!renamed) return step;
    let label = `${step.kind}-${i + 1}`;
    for (let n = 2; taken.has(label); n++) label = `${step.kind}-${i + 1}-${n}`;
    taken.add(label);
    return { ...step, label };
  });
  return { ...scenario, steps, expect };
}
