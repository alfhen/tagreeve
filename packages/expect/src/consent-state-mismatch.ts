import { signalToField, type DataLayerEvent, type Hit, type Request } from '@tagreeve/core';
import { CONSENT_MODE_URL, GOOGLE_VENDORS } from './consent-mode-setup.ts';
import { pageLoadTimes, type VisitStart } from './document.ts';
import { frameConsent, layerOf, type FrameConsent } from './frame-consent.ts';
import { CONSENT_SIGNALS, type ConsentSignal } from './scenario.ts';

export type { VisitStart };

export interface ConsentStateMismatch {
  pass: boolean;
  evidence: string[];
  message: string;
}

export interface ConsentStateMismatchInput {
  dataLayer: readonly DataLayerEvent[];
  /** Browser hits only. The caller leaves out server container hits. */
  hits: readonly Hit[];
  requests: ReadonlyMap<string, Request>;
  visits: readonly VisitStart[];
}

/** Tags queue gtag commands and GA4 batches events, so a hit near a change can legitimately carry the old or the new state. */
const STABLE_MS = 2000;
const TAG_ID = /^[A-Za-z]{1,3}-[A-Za-z0-9]{4,20}$/;
const MAX_LISTED = 5;

const SKIPS = {
  noFrame: 'for no frame',
  ambiguous: 'as ambiguous, since the layers of the frame disagree',
  unstable: 'for an unstable window',
  defaultOnly: 'as a default-only denial',
  newDocument: 'as in a new document',
} as const;
type Skip = keyof typeof SKIPS;

function list(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function tagId(hit: Hit): string {
  const conversionId = hit.params.conversionId;
  const tid = hit.vendor === 'ga4' ? hit.params.tid : conversionId && /^\d+$/.test(conversionId) ? `AW-${conversionId}` : undefined;
  return tid && TAG_ID.test(tid) ? tid : '(no tag ID)';
}

interface FrameLayers {
  layers: { layer: string; consent: FrameConsent }[];
  events: Map<string, DataLayerEvent>;
  commandTimes: number[];
}

/**
 * Judges a Google browser hit against the consent state that the `dataLayer` of its own frame shows.
 * A hit is reported only when its own signal says granted and the frame's state denies it by a `consent update` push.
 * A signal denied only by a default is not judged: consent can be raised outside the `dataLayer`.
 * Returns undefined when no Google browser hit that states a consent signal has a consent command in its frame.
 * The result holds vendor names, tag IDs, signal names, frame kinds, counts and record IDs. It never holds a `gcs` or `gcd` value or a pushed value.
 */
export function consentStateMismatch({ dataLayer, hits, requests, visits }: ConsentStateMismatchInput): ConsentStateMismatch | undefined {
  const frames = new Map<number, FrameLayers>();
  const framesOf = (n: number): FrameLayers => {
    let found = frames.get(n);
    if (!found) {
      const own = dataLayer.filter((e) => e.frame?.n === n);
      const layers = [...new Set(own.map(layerOf))]
        .map((layer) => ({ layer, consent: frameConsent(dataLayer, n, layer) }))
        .filter((l) => l.consent.commandTimes.length > 0);
      found = { layers, events: new Map(own.map((e) => [e.id, e])), commandTimes: layers.flatMap((l) => l.consent.commandTimes) };
      frames.set(n, found);
    }
    return found;
  };

  const skipped: Record<Skip, number> = { noFrame: 0, ambiguous: 0, unstable: 0, defaultOnly: 0, newDocument: 0 };
  const reported = new Map<string, { frame: string; vendor: string; tag: string; hits: Set<string>; signals: Set<ConsentSignal> }>();
  const evidence: string[] = [];
  const loadsByPage = new Map<number | undefined, number[]>();
  let considered = 0;

  for (const hit of hits) {
    if (!GOOGLE_VENDORS.has(hit.vendor)) continue;
    const granted = CONSENT_SIGNALS.filter((s) => hit.consent[signalToField[s]] === 'granted');
    if (CONSENT_SIGNALS.every((s) => hit.consent[signalToField[s]] === 'unknown')) continue;
    const request = requests.get(hit.requestId);
    if (!request) continue;
    const frame = request.frame;
    if (!frame) {
      skipped.noFrame++;
      continue;
    }
    const layers = framesOf(frame.n);
    if (layers.layers.length === 0) continue;
    considered++;

    const states = layers.layers.map((l) => l.consent.stateAt(hit.t));
    const valuesOf = (s: ConsentSignal) => states.map((st) => st.state[signalToField[s]]);
    if (granted.some((s) => valuesOf(s).includes('granted') && valuesOf(s).includes('denied'))) {
      skipped.ambiguous++;
      continue;
    }
    const denied = granted.filter((s) => valuesOf(s).includes('denied'));
    if (denied.length === 0) continue;
    const pushes = new Map<ConsentSignal, string>();
    for (const s of denied) {
      for (const st of states) {
        const by = st.state[signalToField[s]] === 'denied' ? st.setBy[signalToField[s]] : undefined;
        if (by?.command === 'update') pushes.set(s, by.id);
      }
    }
    if (pushes.size === 0) {
      skipped.defaultOnly++;
      continue;
    }
    if (layers.commandTimes.some((t) => Math.abs(t - hit.t) <= STABLE_MS)) {
      skipped.unstable++;
      continue;
    }
    let loads = loadsByPage.get(frame.page);
    if (!loads) {
      loads = pageLoadTimes({ requests, visits }, frame);
      loadsByPage.set(frame.page, loads);
    }
    const live = [...pushes].filter(([, id]) => {
      const at = layers.events.get(id)?.t ?? -Infinity;
      return !loads.some((t) => t > at && t <= hit.t);
    });
    if (live.length === 0) {
      skipped.newDocument++;
      continue;
    }

    const key = `${frame.main}\0${hit.vendor}\0${tagId(hit)}`;
    const entry = reported.get(key) ?? { frame: frame.main ? 'main frame' : 'sub frame', vendor: hit.vendor, tag: tagId(hit), hits: new Set<string>(), signals: new Set<ConsentSignal>() };
    entry.hits.add(hit.id);
    for (const [s] of live) entry.signals.add(s);
    reported.set(key, entry);
    evidence.push(hit.id, ...live.map(([, id]) => id));
  }

  // A hit with no frame is counted in the result of the others and never makes a result alone.
  if (considered === 0) return undefined;

  const skipNote = (Object.keys(SKIPS) as Skip[])
    .filter((k) => skipped[k] > 0)
    .map((k) => `${skipped[k]} hit${skipped[k] === 1 ? '' : 's'} skipped ${SKIPS[k]}`)
    .join('; ');
  const note = skipNote ? ` ${skipNote[0]!.toUpperCase()}${skipNote.slice(1)}.` : '';

  if (reported.size === 0) {
    return { pass: true, evidence: [], message: `Expected no Google hit to say granted for a signal that the dataLayer of its frame denied by a consent update, found none.${note}` };
  }
  const lines = [...reported.values()].map((e) => {
    const signals = CONSENT_SIGNALS.filter((s) => e.signals.has(s));
    return `${e.hits.size} ${e.vendor} hit${e.hits.size === 1 ? '' : 's'} for ${e.tag} in the ${e.frame} said granted for ${list(signals)}`;
  });
  const shown = lines.slice(0, MAX_LISTED).join('; ');
  const more = lines.length > MAX_LISTED ? `; and ${lines.length - MAX_LISTED} more` : '';
  return {
    pass: false,
    evidence: [...new Set(evidence)],
    message: `Expected a Google hit not to say granted for a signal that the dataLayer of its frame denied by a consent update: ${shown}${more}. The hit and the dataLayer disagree. Either the page changed consent without a push, or the tag read an old state. See ${CONSENT_MODE_URL}.${note}`,
  };
}
