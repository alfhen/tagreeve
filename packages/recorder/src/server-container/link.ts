import { pinterestEventKey, unwrapStapeLoader } from '@tagreeve/decoders';
import { hashEmail, isServerContainerRequest, isServerHostUrl, type Hit, type HitLinkMiss, type Identity, type Request } from '@tagreeve/core';

/** A shared value shorter than this proves nothing. */
const MIN_VALUE_LENGTH = 8;
const CLIENT_ID_NAMES = new Set(['cid', 'client_id', 'clientid', 'fbp']);

function eventIdOf(hit: Hit): string | undefined {
  return hit.params.eventId ?? hit.params.eid ?? hit.params.event_id;
}

/** Event names match literally. A Pinterest tag hit and a Pinterest Conversions API hit match by `pinterestEventKey`. */
function sameEventName(server: Hit, browser: Hit): boolean {
  if (server.vendor === 'pinterest-capi' && browser.vendor === 'pinterest' && server.event !== null && browser.event !== null) {
    return pinterestEventKey(server.event) === pinterestEventKey(browser.event);
  }
  return server.event === browser.event;
}

function collectNamed(value: unknown, names: ReadonlySet<string>, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNamed(item, names, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (names.has(key.toLowerCase()) && (typeof item === 'string' || typeof item === 'number')) out.add(String(item));
      else collectNamed(item, names, out);
    }
  }
}

function clientIdsOf(request: Request): Set<string> {
  const found = new Set<string>();
  const addQuery = (query: URLSearchParams) => {
    for (const [key, value] of query) if (CLIENT_ID_NAMES.has(key.toLowerCase().replace(/^ud\[(.*)\]$/, '$1'))) found.add(value);
  };
  try {
    addQuery(new URL(request.url).searchParams);
  } catch {
    // An unparsable URL holds no client ID.
  }
  // A Stape loader packs the GA4 query into one encoded parameter. Used in memory only.
  const unwrapped = unwrapStapeLoader(request);
  if (unwrapped) {
    try {
      addQuery(new URL(unwrapped.url).searchParams);
    } catch {
      // Not a URL, no client ID.
    }
  }
  const body = request.postData;
  if (body) {
    try {
      collectNamed(JSON.parse(body) as unknown, CLIENT_ID_NAMES, found);
    } catch {
      for (const line of body.split(/\r?\n/)) addQuery(new URLSearchParams(line));
    }
  }
  return new Set([...found].filter((v) => v.length >= MIN_VALUE_LENGTH));
}

function holdsIdentity(request: Request, identity: Identity | null): boolean {
  if (!identity?.email) return false;
  const email = identity.email.trim().toLowerCase();
  const values = [email, hashEmail(identity.email).hex].filter((v) => v.length >= MIN_VALUE_LENGTH);
  const raw = `${request.url}\n${request.postData ?? ''}`;
  let decoded = '';
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the raw text only.
  }
  const text = `${raw}\n${decoded}`.toLowerCase();
  return values.some((v) => text.includes(v));
}

interface Facts {
  hit: Hit;
  request: Request | undefined;
  eventId: string | undefined;
  clientIds: Set<string>;
  identity: boolean;
  onServerHost: boolean;
}

/** When a browser request was sent to the container and when its answer arrived, in the clock that stamps container calls. */
export interface InFlightWindow {
  sentAt: number;
  answeredAt: number;
}

export interface LinkInput {
  hits: readonly Hit[];
  requests: readonly Request[];
  serverHosts: readonly string[];
  identity: Identity | null;
  /** By request ID. A request with no answer time is not here, so it never counts as in flight. */
  inFlight?: ReadonlyMap<string, InFlightWindow>;
  /** Start times of the run's consent epochs, on the request clock, in any order. Rule (1) reads them for hits sent after the call, rule (2) for an answered request. Without them neither applies. */
  epochStarts?: readonly number[];
}

/** How long after a call a browser hit with the call's event ID may still be its source. */
const LATER_HIT_WINDOW_MS = 5000;
/** How long after the answer to a browser request a container call may still be its call. */
const ANSWERED_WINDOW_MS = 2000;

function sharedKind(server: Facts, browser: Facts): 'eventId' | 'clientId' | 'identity' | undefined {
  if (server.eventId && server.eventId.length >= MIN_VALUE_LENGTH && server.eventId === browser.eventId) return 'eventId';
  for (const id of server.clientIds) if (browser.clientIds.has(id)) return 'clientId';
  if (server.identity && browser.identity) return 'identity';
  return undefined;
}

/**
 * Adds `via` to each hit decoded from a server container call. The proxy cannot see which browser hit led to a call,
 * so the first rule that fits decides: (1) the event ID and event name (a Pinterest call and a Pinterest tag hit compare names without case and `_`) match exactly one browser hit sent at or before the call (at its request time, when that is known), or sent after the call, at most 5000 ms after it, with an event ID of at least 8 characters and no consent epoch starting after the call and at or before that hit (needs `epochStarts`), `exact`; two or more such hits give no exact link;
 * (2) the client ID and event name match exactly one browser hit to a `serverHosts` host sent before the call, and its request to the
 * container was still in flight when the call arrived, `exact`; with `epochStarts` it is also `exact` when the answer came at most 2000 ms before the call and no consent epoch
 * started after the hit was sent and at or before the call; two or more such hits, in flight or answered, give no exact link, and neither does another
 * container-routed request that shares a client ID or has no decoded hit and was sent in between (`concurrentRequest`, which wins over a late call or an epoch start);
 * (3) a shared value, `probable`: the latest earlier hit to a `serverHosts` host, else the latest earlier browser hit.
 * No match leaves the hit unlinked. Browser hits are returned as they are.
 */
export function linkServerHits({ hits, requests, serverHosts, identity, inFlight, epochStarts }: LinkInput): Hit[] {
  const byId = new Map(requests.map((r) => [r.id, r]));
  const facts: Facts[] = hits.map((hit) => {
    const request = byId.get(hit.requestId);
    const onServerHost = request ? isServerHostUrl(request.url, serverHosts) : false;
    return {
      hit,
      request,
      eventId: eventIdOf(hit),
      clientIds: request ? clientIdsOf(request) : new Set(),
      identity: request ? holdsIdentity(request, identity) : false,
      onServerHost,
    };
  });
  const hitRequestIds = new Set(hits.map((h) => h.requestId));
  const sentAtOf = (requestId: string, t: number) => inFlight?.get(requestId)?.sentAt ?? t;
  const hasConcurrentRequest = (only: Facts, from: number, to: number, callClientIds: ReadonlySet<string>) =>
    requests.some((r) => {
      if (r.captured === 'serverContainer' || r.id === only.hit.requestId || r.initiator === 'unload' || !isServerContainerRequest(r, serverHosts)) return false;
      const sentAt = sentAtOf(r.id, r.t);
      if (sentAt < from || sentAt > to) return false;
      if (!hitRequestIds.has(r.id)) return true;
      return [...clientIdsOf(r)].some((id) => callClientIds.has(id));
    });
  const isServer = (f: Facts) => f.request?.captured === 'serverContainer';
  const browser = facts.filter((f) => !isServer(f));
  const sortedStarts = epochStarts ? [...epochStarts].sort((a, b) => a - b) : undefined;
  // The first epoch start after the call. A later hit before it is in the call's epoch.
  const nextEpochStart = (callAt: number) => {
    let lo = 0;
    let hi = sortedStarts!.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedStarts![mid]! > callAt) hi = mid;
      else lo = mid + 1;
    }
    return sortedStarts![lo] ?? Infinity;
  };
  return facts.map((f): Hit => {
    if (!isServer(f)) return f.hit;
    const callAt = f.request?.t;
    const epochEnd = callAt !== undefined && sortedStarts ? nextEpochStart(callAt) : undefined;
    const exact =
      f.eventId === undefined
        ? []
        : browser.filter((b) => {
            if (b.eventId !== f.eventId || !sameEventName(f.hit, b.hit)) return false;
            if (callAt === undefined) return true;
            const sentAt = sentAtOf(b.hit.requestId, b.hit.t);
            return sentAt <= callAt || (epochEnd !== undefined && f.eventId!.length >= MIN_VALUE_LENGTH && sentAt - callAt <= LATER_HIT_WINDOW_MS && sentAt < epochEnd);
          });
    if (exact.length === 1) return { ...f.hit, via: { hitId: exact[0]!.hit.id, by: 'eventId', confidence: 'exact' } };
    const eventIdMiss: HitLinkMiss['eventId'] = f.eventId === undefined || f.hit.event === null ? 'none' : exact.length === 0 ? 'noMatch' : 'several';
    const sameKey =
      callAt === undefined || f.hit.event === null
        ? []
        : browser.filter((b) => {
            if (!b.onServerHost || b.hit.event !== f.hit.event) return false;
            const sentAt = sentAtOf(b.hit.requestId, b.hit.t);
            if (sentAt > callAt) return false;
            for (const id of f.clientIds) if (b.clientIds.has(id)) return true;
            return false;
          });
    // An earlier request with the same key, answered or not, could be the one this call belongs to.
    const only = sameKey.length === 1 ? sameKey[0]! : undefined;
    const window = only && inFlight?.get(only.hit.requestId);
    const inFlightNow = only !== undefined && window && callAt !== undefined && callAt < window.answeredAt;
    // An answered request counts only with epoch starts, so a run that cannot see consent changes keeps the old result.
    const answeredNow = only !== undefined && window && callAt !== undefined && sortedStarts !== undefined && callAt >= window.answeredAt;
    const concurrent = (inFlightNow || answeredNow) && hasConcurrentRequest(only, window.sentAt, callAt, f.clientIds);
    if (inFlightNow && !concurrent) {
      return { ...f.hit, via: { hitId: only.hit.id, by: 'clientId', confidence: 'exact' } };
    }
    if (answeredNow && !concurrent && callAt - window.answeredAt <= ANSWERED_WINDOW_MS && !sortedStarts.some((t) => t > window.sentAt && t <= callAt)) {
      return { ...f.hit, via: { hitId: only.hit.id, by: 'clientId', confidence: 'exact' } };
    }
    const clientIdMiss: HitLinkMiss['clientId'] =
      f.hit.event === null || f.clientIds.size === 0
        ? 'noClientId'
        : sameKey.length === 0
          ? 'noSameKeyHit'
          : sameKey.length > 1
            ? 'severalSameKeyHits'
            : concurrent
              ? 'concurrentRequest'
              : 'answeredBefore';
    const linkMiss: HitLinkMiss = { eventId: eventIdMiss, clientId: clientIdMiss };
    const earlier = browser.flatMap((b) => {
      const by = b.hit.t <= f.hit.t ? sharedKind(f, b) : undefined;
      return by ? [{ b, by }] : [];
    });
    const pool = earlier.some((c) => c.b.onServerHost) ? earlier.filter((c) => c.b.onServerHost) : earlier;
    const latest = pool.reduce<(typeof pool)[number] | undefined>((best, c) => (best === undefined || c.b.hit.t >= best.b.hit.t ? c : best), undefined);
    return latest ? { ...f.hit, via: { hitId: latest.b.hit.id, by: latest.by, confidence: 'probable' }, linkMiss } : { ...f.hit, linkMiss };
  });
}
