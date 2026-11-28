import { argumentsListOf, consentCommandOf, type ConsentEpoch, type ConsentState, type DataLayerEvent, type Hit } from '@tagreeve/core';
import { GCD_SIGNALS, gcdSignals } from '@tagreeve/decoders';
import { CONSENT_MODE_URL, GOOGLE_VENDORS } from './consent-mode-setup.ts';
import { frameConsent, layerOf } from './frame-consent.ts';
import { CONSENT_SIGNALS, type ConsentModeDefault, type ConsentModeExpectation, type ConsentSignal } from './scenario.ts';

export interface ConsentModeOrder {
  pass: boolean;
  evidence: string[];
  message: string;
}

export interface ConsentModeOrderInput {
  dataLayer: readonly DataLayerEvent[];
  /** Browser hits only. The caller leaves out server container hits. */
  hits: readonly Hit[];
  epochs: readonly ConsentEpoch[];
  /** The epoch that holds a time, as the other checks place a hit (with the grace window). */
  epochAt: (t: number) => ConsentEpoch | undefined;
  /** `options.consentMode` of the scenario. */
  expected?: ConsentModeExpectation;
}

type Value = 'granted' | 'denied';

const FIELD_OF: Record<ConsentSignal, keyof ConsentState> = {
  ad_storage: 'ads',
  analytics_storage: 'analytics',
  ad_user_data: 'adUserData',
  ad_personalization: 'adPersonalization',
};

const NO_UPDATE = 'the consent update was not in the dataLayer, so the update gap and the state after the decision were not judged';

interface Finding {
  text: string;
  evidence: string[];
}

function list(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function argsList(args: readonly unknown[]): readonly unknown[] | undefined {
  return typeof args[0] === 'string' ? args : argumentsListOf(args);
}

function frameKind(event: DataLayerEvent): string {
  return event.frame === undefined ? 'frame of unknown kind' : event.frame.main ? 'main frame' : 'sub frame';
}

function isGtmJs(event: DataLayerEvent): boolean {
  const [item] = event.args;
  return event.event === 'gtm.js' || (typeof item === 'object' && item !== null && (item as { event?: unknown }).event === 'gtm.js');
}

function valueOf(raw: unknown): Value | undefined {
  return raw === 'granted' || raw === 'denied' ? raw : undefined;
}

function resolveDefault(option: ConsentModeDefault | undefined): Partial<Record<ConsentSignal, Value>> {
  if (option === undefined) return {};
  if (typeof option === 'string') return Object.fromEntries(CONSENT_SIGNALS.map((s) => [s, option]));
  return { ...option };
}

function namesOf(signals: Iterable<ConsentSignal>): ConsentSignal[] {
  const set = new Set(signals);
  return CONSENT_SIGNALS.filter((s) => set.has(s));
}

/**
 * Judges the order of the consent default and of `config` in each (frame, layer) queue, the gap between a banner
 * decision and the `consent update` push, and, with `options.consentMode`, the setup the scenario states.
 * It reads only pushes that show in the dataLayer: a consent call that does not show gives a pass with a note, never a warning.
 * Returns undefined when it has nothing to judge: no default was pushed and the scenario states no setup.
 * The result holds signal names, `granted` or `denied`, frame kinds, layer names, expected region codes and record IDs.
 */
export function consentModeOrder({ dataLayer, hits, epochs, epochAt, expected }: ConsentModeOrderInput): ConsentModeOrder | undefined {
  const pushes = [...dataLayer].sort((a, b) => a.t - b.t);
  const commandOf = (e: DataLayerEvent) => consentCommandOf(e.args);
  const defaultPushed = pushes.some((e) => commandOf(e)?.command === 'default');
  if (!defaultPushed && !expected) return undefined;

  const findings: Finding[] = [];
  const notes = new Set<string>();
  const google = hits.filter((h) => GOOGLE_VENDORS.has(h.vendor));

  // Rule 1: the first default against the first config, once for each (frame, layer).
  const queues = new Map<string, DataLayerEvent[]>();
  for (const e of pushes) {
    const key = `${e.frame?.n ?? -1}\0${layerOf(e)}`;
    queues.set(key, [...(queues.get(key) ?? []), e]);
  }
  let judged = 0;
  for (const queue of queues.values()) {
    const first = queue.findIndex((e) => commandOf(e)?.command === 'default');
    if (first < 0) continue;
    const where = `${frameKind(queue[first]!)} ${layerOf(queue[first]!)}`;
    const config = queue.findIndex((e) => argsList(e.args)?.[0] === 'config');
    if (config < 0) {
      notes.add(`order was not judged in the ${where}: ${queue.slice(0, first).some(isGtmJs) ? 'gtm.js came before the default and no config command was pushed' : 'no config command was pushed'}`);
    } else if (config < first) {
      judged++;
      findings.push({
        text: `In the ${where} the consent default was pushed after the first config command. Google reads the setup in the order of the queue, so a config before the default can send a hit with no default.`,
        evidence: [queue[config]!.id, queue[first]!.id],
      });
    } else judged++;
  }

  const main = pushes.filter((e) => e.frame?.main === true);
  const mainUpdates = main.filter((e) => commandOf(e)?.command === 'update');
  const mainDefaults = main.filter((e) => commandOf(e)?.command === 'default');

  // The global default and the region codes that the main frame pushed.
  const pushedDefault: Partial<Record<ConsentSignal, { value: Value; id: string }>> = {};
  const pushedRegions = new Set<string>();
  for (const e of mainDefaults) {
    const signals = commandOf(e)!.signals;
    if (typeof signals !== 'object' || signals === null) continue;
    const region = (signals as { region?: unknown }).region;
    if (region !== undefined) {
      for (const code of Array.isArray(region) ? region : [region]) if (typeof code === 'string') pushedRegions.add(code);
      continue;
    }
    for (const s of CONSENT_SIGNALS) {
      const value = valueOf((signals as Record<string, unknown>)[s]);
      if (value) pushedDefault[s] = { value, id: e.id };
    }
  }
  const expectedDefault = resolveDefault(expected?.default);
  const defaultOf = (s: ConsentSignal): Value | undefined => expectedDefault[s] ?? pushedDefault[s]?.value;
  const defaultDeniesAll = CONSENT_SIGNALS.every((s) => defaultOf(s) === 'denied');

  const decided = epochs.filter((e) => e.label !== 'undecided').sort((a, b) => a.startT - b.startT);
  const grants = (e: ConsentEpoch) => CONSENT_SIGNALS.some((s) => e.state[FIELD_OF[s]] === 'granted');

  // Rule 2: a hit between the decision and the update push of the main frame.
  for (const epoch of decided) {
    if (mainUpdates.length === 0) {
      if (grants(epoch)) notes.add(NO_UPDATE);
      continue;
    }
    const update = mainUpdates.find((u) => u.t >= epoch.startT && (epoch.endT === null || u.t < epoch.endT));
    if (!update) continue;
    const late = new Map<Hit, ConsentSignal[]>();
    for (const hit of google) {
      if (hit.t < epoch.startT || hit.t >= update.t) continue;
      const denied = CONSENT_SIGNALS.filter((s) => epoch.state[FIELD_OF[s]] === 'granted' && hit.consent[FIELD_OF[s]] === 'denied');
      if (denied.length > 0) late.set(hit, denied);
    }
    if (late.size === 0) continue;
    const signals = namesOf([...late.values()].flat());
    findings.push({
      text: `${late.size} Google hit${late.size === 1 ? ' was' : 's were'} sent after the decision and before the update push of the main frame, and say ${list(signals)} denied where the decision grants ${signals.length === 1 ? 'it' : 'them'}.`,
      evidence: [...[...late.keys()].map((h) => h.id), update.id],
    });
  }

  if (expected) {
    // Rule 3: the default and the regional default.
    const mismatched = CONSENT_SIGNALS.filter((s) => expectedDefault[s] !== undefined && pushedDefault[s] !== undefined && pushedDefault[s]!.value !== expectedDefault[s]);
    if (mismatched.length > 0) {
      findings.push({
        text: `The main frame default does not match the setup the scenario states: ${list(mismatched.map((s) => `${s} is ${pushedDefault[s]!.value}, expected ${expectedDefault[s]}`))}.`,
        evidence: [...new Set(mismatched.map((s) => pushedDefault[s]!.id))],
      });
    }
    if (expected.region && mainDefaults.length > 0) {
      const missing = expected.region.filter((code) => !pushedRegions.has(code));
      if (missing.length > 0) {
        findings.push({
          text: `The scenario expects a regional default for ${list(missing)}, and the main frame pushed none for ${missing.length === 1 ? 'it' : 'them'}. The test machine has no region, so the check reads the push only.`,
          evidence: mainDefaults.map((e) => e.id),
        });
      }
    }

    // Rule 3: the hits of the undecided epoch.
    if (expected.mode) {
      const undecided = epochs.find((e) => e.label === 'undecided');
      if (!undecided || undecided.endT === null) {
        notes.add(`the decision was not seen, possibly made outside the dataLayer, so mode ${expected.mode} was not judged`);
      } else {
        const early = google.filter((h) => epochAt(h.t)?.label === 'undecided');
        if (expected.mode === 'basic' && early.length > 0) {
          findings.push({
            text: `Mode basic expects no Google hit before the decision, and ${early.length} Google hit${early.length === 1 ? ' was' : 's were'} sent before it.`,
            evidence: early.map((h) => h.id),
          });
        }
        if (expected.mode === 'advanced') {
          const grantedOver = new Map<Hit, ConsentSignal[]>();
          for (const hit of early) {
            const over = CONSENT_SIGNALS.filter((s) => (defaultOf(s) ?? valueOf(undecided.state[FIELD_OF[s]])) === 'denied' && hit.consent[FIELD_OF[s]] === 'granted');
            if (over.length > 0) grantedOver.set(hit, over);
          }
          if (grantedOver.size > 0) {
            const signals = namesOf([...grantedOver.values()].flat());
            findings.push({
              text: `Mode advanced expects the hits before the decision to show the default, and ${grantedOver.size} Google hit${grantedOver.size === 1 ? '' : 's'} grant${grantedOver.size === 1 ? 's' : ''} ${list(signals)} where the default denies ${signals.length === 1 ? 'it' : 'them'}.`,
              evidence: [...grantedOver.keys()].map((h) => h.id),
            });
          }
        }
      }
    }

    // Rule 3: the state after an accept or a reject.
    const accepted = new Set(expected.accept ?? CONSENT_SIGNALS);
    const updateFrame = mainUpdates[0]?.frame;
    const replay = updateFrame && frameConsent(dataLayer, updateFrame.n, layerOf(mainUpdates[0]!));
    decided.forEach((epoch, i) => {
      const outcome = epoch.label === 'withdrawn' ? epoch.outcome : epoch.label;
      if (outcome !== 'granted' && outcome !== 'denied') return;
      const update = mainUpdates.find((u) => u.t >= epoch.startT && (epoch.endT === null || u.t < epoch.endT));
      if (!update || !replay) {
        if (outcome === 'denied' && i === 0 && defaultDeniesAll) notes.add('no update was needed: the default denies all four');
        else notes.add(NO_UPDATE);
        return;
      }
      const { state, setBy } = replay.stateAt(epoch.endT ?? Infinity, false);
      const wrong = CONSENT_SIGNALS.filter((s) => {
        const actual = valueOf(state[FIELD_OF[s]]);
        const want = outcome === 'denied' ? 'denied' : accepted.has(s) ? 'granted' : defaultOf(s);
        return actual !== undefined && want !== undefined && actual !== want;
      });
      if (wrong.length === 0) return;
      const what = outcome === 'denied' ? 'reject' : 'accept';
      findings.push({
        text: `After the ${what} the main frame state is not what the scenario states: ${list(wrong.map((s) => `${s} is ${state[FIELD_OF[s]]}`))}. A ${what} should ${outcome === 'denied' ? 'deny all four signals' : `grant ${list(namesOf(accepted))} and keep the others as the default`}.`,
        evidence: [update.id, ...new Set(wrong.map((s) => setBy[FIELD_OF[s]]?.id).filter((id): id is string => id !== undefined))],
      });
    });

    // Rule 4: a default that is not in the dataLayer.
    const showsDefault = google.some((h) => {
      const signals = gcdSignals(h.consent.raw.gcd);
      return signals !== undefined && GCD_SIGNALS.some((n) => !signals[n].notSet && signals[n].default !== 'unknown');
    });
    if (!defaultPushed && showsDefault) notes.add('the default was set outside the dataLayer (template API, TCF or other), so no order was judged');
  }

  const evidence = [...new Set(findings.flatMap((f) => f.evidence))];
  if (findings.length > 0) {
    const also = notes.size > 0 ? ` Also: ${[...notes].join('; ')}.` : '';
    return { pass: false, evidence, message: `${findings.map((f) => f.text).join(' ')}${also} See ${CONSENT_MODE_URL}` };
  }
  if (notes.size > 0) return { pass: true, evidence: [], message: [...notes].join('; ') };
  return {
    pass: true,
    evidence: [],
    message: expected
      ? 'Expected Consent Mode to be set up as the scenario states, and in order, found it so.'
      : `Expected the consent default before the first config command in each queue, found it so (${judged} queue${judged === 1 ? '' : 's'}).`,
  };
}
