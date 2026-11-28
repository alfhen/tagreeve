import { isDeepStrictEqual } from 'node:util';
import type { DataLayerEvent, Hit, Request, RequestFrame } from '@tagreeve/core';
import { ga4HitIds, guardFieldName } from '@tagreeve/decoders';
import { pageLoadTimes, type VisitStart } from './document.ts';
import { mappedEventName } from './event-map.ts';

export interface DoubleSend {
  pass: boolean;
  evidence: string[];
  message: string;
}

export interface DoubleSendInput {
  dataLayer: readonly DataLayerEvent[];
  /** Browser hits only. The caller leaves out server container hits. */
  hits: readonly Hit[];
  requests: ReadonlyMap<string, Request>;
  visits: readonly VisitStart[];
}

/** Two sends of one event this close are one double send. A fixed constant, not an option. */
const WINDOW_MS = 1000;
/** The decoder param that is the tag ID, per vendor. A vendor with none is compared on the vendor alone. */
const TAG_KEYS: Readonly<Record<string, string>> = { ga4: 'tid', meta: 'pixelId' };
const TAG_ID: Readonly<Record<string, RegExp>> = { ga4: /^[A-Za-z]{1,3}-[A-Za-z0-9]{4,20}$/, meta: /^\d{5,20}$/ };
const MAX_LISTED = 5;

interface Candidate {
  hit: Hit;
  frame: RequestFrame;
  cid: string | undefined;
}

interface Group {
  vendor: string;
  tag: string | undefined;
  name: string;
  hits: Candidate[];
}

const sameParams = (a: Record<string, string>, b: Record<string, string>) => isDeepStrictEqual(Object.entries(a).sort(), Object.entries(b).sort());

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The event name of a push, in the `gtag` form, the array form, the arguments-like object form and the GTM form. Undefined when it cannot be read. */
function pushedName(args: readonly unknown[]): string | undefined {
  const first = args[0];
  if (first === 'event') return typeof args[1] === 'string' ? args[1] : undefined;
  if (Array.isArray(first)) return first[0] === 'event' && typeof first[1] === 'string' ? first[1] : undefined;
  if (!isObject(first)) return undefined;
  if (typeof first.event === 'string') return first.event;
  return first[0] === 'event' && typeof first[1] === 'string' ? first[1] : undefined;
}

/** A push without its `gtm.*` stamps and its functions, for an in-memory comparison. */
function stripped(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => typeof v !== 'function').map(stripped);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => !k.startsWith('gtm.') && typeof v !== 'function').map(([k, v]) => [k, stripped(v)]));
}

function list(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Finds one event that a browser sent twice within 1000 ms with equal params: the same vendor, tag ID and mapped event name,
 * and for `ga4` the same client ID, with no page load between. The pair can come from two frames (a pixel frame and a theme)
 * or from one frame, where the pushes of its `dataLayer` say whether the event was also pushed twice.
 * Returns undefined when no two hits qualify as a pair of candidates. Everything is compared in memory.
 * The result holds the vendor, the tag ID, the event name through `guardFieldName`, counts, frame kinds and hit IDs. It never holds a param, a client ID or a pushed value.
 */
export function doubleSend({ dataLayer, hits, requests, visits }: DoubleSendInput): DoubleSend | undefined {
  const byRequest = new Map<string, Hit[]>();
  for (const hit of hits) {
    if (!(hit.vendor in TAG_KEYS) || hit.event === null) continue;
    byRequest.set(hit.requestId, [...(byRequest.get(hit.requestId) ?? []), hit]);
  }

  const groups = new Map<string, Group>();
  for (const [requestId, own] of byRequest) {
    const req = requests.get(requestId);
    if (!req?.frame) continue;
    const ids = own[0]!.vendor === 'ga4' ? ga4HitIds(req) : [];
    own.forEach((hit, i) => {
      const cid = ids[i]?.cid;
      if (hit.vendor === 'ga4' && !cid) return;
      const name = mappedEventName(hit.event!);
      const rawTag = hit.params[TAG_KEYS[hit.vendor]!];
      const key = JSON.stringify([hit.vendor, rawTag ?? null, name, cid ?? null]);
      const tag = rawTag !== undefined && TAG_ID[hit.vendor]!.test(rawTag) ? rawTag : undefined;
      const group = groups.get(key) ?? { vendor: hit.vendor, tag, name, hits: [] };
      group.hits.push({ hit, frame: req.frame!, cid });
      groups.set(key, group);
    });
  }

  const loadsByPage = new Map<number | undefined, number[]>();
  const loadsOf = (frame: RequestFrame): number[] => {
    let loads = loadsByPage.get(frame.page);
    if (!loads) {
      loads = pageLoadTimes({ requests, visits }, frame);
      loadsByPage.set(frame.page, loads);
    }
    return loads;
  };
  const loadBetween = (a: Candidate, b: Candidate) => loadsOf(b.frame).some((t) => t > a.hit.t && t <= b.hit.t);
  const pairable = (a: Candidate, b: Candidate) => {
    if (b.hit.t - a.hit.t > WINDOW_MS) return false;
    if (a.frame.page !== undefined && b.frame.page !== undefined && a.frame.page !== b.frame.page) return false;
    // Two different sub frames are not known to share a navigation.
    if (a.frame.n !== b.frame.n && !a.frame.main && !b.frame.main) return false;
    return sameParams(a.hit.params, b.hit.params) && !loadBetween(a, b);
  };

  let candidates = 0;
  const lines: { text: string; evidence: string[] }[] = [];
  for (const group of groups.values()) {
    const sorted = [...group.hits].sort((a, b) => a.hit.t - b.hit.t);
    if (sorted.length < 2) continue;
    if (sorted.some((c, i) => i > 0 && !loadBetween(sorted[i - 1]!, c))) candidates++;

    const parent = sorted.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
    const paired = new Set<number>();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j]!.hit.t - sorted[i]!.hit.t <= WINDOW_MS; j++) {
        if (!pairable(sorted[i]!, sorted[j]!)) continue;
        parent[root(j)] = root(i);
        paired.add(i).add(j);
      }
    }
    const clusters = new Map<number, Candidate[]>();
    for (const i of paired) clusters.set(root(i), [...(clusters.get(root(i)) ?? []), sorted[i]!]);

    for (const cluster of clusters.values()) {
      const frames = new Set(cluster.map((c) => c.frame.n));
      const kinds = [...(cluster.some((c) => c.frame.main) ? ['main frame'] : []), ...(cluster.some((c) => !c.frame.main) ? ['sub frame'] : [])];
      const count = cluster.length === 2 && frames.size === 1 ? 'twice' : `${cluster.length} times`;
      const subject = `${group.vendor} ${guardFieldName(group.name)}${group.tag ? ` for ${group.tag}` : ''}`;
      let note = '';
      if (frames.size === 1) note = `; ${pushNote(cluster, group.name)}`;
      lines.push({ text: `${subject} was sent ${count} from the ${list(kinds)}${note}`, evidence: cluster.map((c) => c.hit.id) });
    }
  }

  function pushNote(cluster: Candidate[], name: string): string {
    const first = cluster[0]!;
    const frameN = first.frame.n;
    const loads = loadsOf(first.frame);
    const start = Math.max(-Infinity, ...loads.filter((t) => t <= first.hit.t));
    const end = Math.min(Infinity, ...loads.filter((t) => t > first.hit.t));
    const pushes = dataLayer
      .filter((e) => e.frame?.n === frameN && e.t > start && e.t < end && Math.abs(e.t - first.hit.t) <= WINDOW_MS)
      .filter((e) => {
        const pushed = pushedName(e.args);
        return pushed !== undefined && mappedEventName(pushed) === name;
      })
      .sort((a, b) => a.t - b.t);
    const bodies = pushes.map((p) => stripped(p.args));
    const twice = pushes.some((p, i) => pushes.some((q, j) => j > i && q.t - p.t <= WINDOW_MS && isDeepStrictEqual(bodies[i], bodies[j])));
    if (twice) return 'the event was also pushed twice';
    if (pushes.length >= 2) return `the event was pushed ${pushes.length} times with different contents`;
    return 'one push or none was recorded';
  }

  if (candidates === 0 && lines.length === 0) return undefined;
  if (lines.length === 0) {
    return { pass: true, evidence: [], message: `Expected no event to be sent twice within ${WINDOW_MS} ms with equal params, found none.` };
  }
  const shown = lines.slice(0, MAX_LISTED).map((l) => l.text).join('; ');
  const more = lines.length > MAX_LISTED ? `; and ${lines.length - MAX_LISTED} more` : '';
  return {
    pass: false,
    evidence: [...new Set(lines.flatMap((l) => l.evidence))],
    message: `Expected no event to be sent twice within ${WINDOW_MS} ms with equal params: ${shown}${more}. Two tags, two triggers or two containers can each send the same event.`,
  };
}
