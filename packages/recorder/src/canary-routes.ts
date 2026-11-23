import { canaryPool, fieldHashes, isServerHostUrl, MAX_POST_DATA, newId, readings, type Canary, type CanaryPool, type Checkpoint, type CheckpointCookie, type CookieHop, type Flag, type FlagRoute, type Hit, type HitHop, type Id, type Identity, type Request, type RouteHop, type RouteKind } from '@tagreeve/core';
import { bodyEntries, guardFieldName, OTHER_NAME, PAGE_FIELDS } from '@tagreeve/decoders';
import { hostMatches } from '@tagreeve/expect';
import { getDomain } from 'tldts';

export interface CanaryRouteInput {
  runId: Id<'run'>;
  siteUrl: string;
  firstPartyHosts?: readonly string[];
  serverHosts?: readonly string[];
  requests: readonly Request[];
  hits: readonly Hit[];
  /** A cookie whose `canary` is the sink's canary, seen in a checkpoint before the sink, makes a cookie route. */
  checkpoints?: readonly Checkpoint[];
  canaries: readonly Canary[];
  identity?: Pick<Identity, 'email' | 'phone'> | null;
  /** The forms looked for. Default: `canaryPool(canaries, identity)`. */
  pool?: CanaryPool;
}

const BODY_FIELD = '(body)';
const PATH_FIELD = '(path)';
const FRAGMENT_FIELD = '(fragment)';
const MAX_DEPTH = 2;
const COMPRESSED = /^(?:gzip|br|deflate|zstd|compress)\b/i;
// A gzip body read as text holds control characters; readable text does not.
const BINARY = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/;

/** The same forms and order as `canaryPool`, so the first of two equal forms names the transform. */
function transformForms(value: string): [string, string][] {
  const buffer = Buffer.from(value);
  return [
    [value, 'plain'],
    [encodeURIComponent(value), 'url'],
    [buffer.toString('base64'), 'base64'],
    [buffer.toString('base64url'), 'base64url'],
    ...[...fieldHashes(value)].map((hash): [string, string] => [hash, 'sha256']),
  ];
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function decodeOrSame(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function isFirstParty(host: string, siteHost: string, firstPartyHosts: readonly string[]): boolean {
  if (host === siteHost || hostMatches(host, firstPartyHosts)) return true;
  const domain = getDomain(siteHost, { allowPrivateDomains: true });
  return domain !== null && getDomain(host, { allowPrivateDomains: true }) === domain;
}

function isBinaryBody(req: Request): boolean {
  const encoding = Object.entries(req.headers).find(([name]) => name.toLowerCase() === 'content-encoding')?.[1];
  if (encoding !== undefined && COMPRESSED.test(encoding.trim())) return true;
  return req.postData !== null && BINARY.test(req.postData);
}

interface Occurrence {
  name: string;
  transform: string;
  /** The name as sent, to compare with the canary name. Never stored. */
  raw: string;
  /** The name as stored: masked when it looks like a value. */
  field: string;
  value: string;
}

function pairsOf(text: string): [string, string][] {
  const url = /^https?:\/\//i.test(text) ? parse(text) : undefined;
  if (url) {
    const hash = url.hash.slice(1);
    return [...url.searchParams, ...(hash.includes('=') ? new URLSearchParams(hash) : [])];
  }
  if (!text.includes('=')) return [];
  return text.split(/[&;]\s*/).flatMap((pair): [string, string][] => {
    const eq = pair.indexOf('=');
    return eq < 0 ? [] : [[pair.slice(0, eq), pair.slice(eq + 1)]];
  });
}

/**
 * The canaries in a value: the value itself, or a value inside it when it is a URL or a query string, such as the
 * page URL in a page field. The pool decides what counts as a canary.
 */
function scan(text: string, pool: CanaryPool, transforms: ReadonlyMap<string, string>, depth = 0): { name: string; transform: string }[] {
  const found = new Map<string, { name: string; transform: string }>();
  const layers = readings(text);
  const name = pool.match(text);
  if (name !== undefined) {
    const read = layers.find((layer) => transforms.has(layer));
    found.set(name, { name, transform: read === undefined ? 'other' : transforms.get(read)! });
  }
  if (depth < MAX_DEPTH) {
    for (const layer of layers) {
      for (const [, value] of pairsOf(layer)) {
        for (const inner of scan(value, pool, transforms, depth + 1)) if (!found.has(inner.name)) found.set(inner.name, inner);
      }
    }
  }
  return [...found.values()];
}

function occurrencesOf(req: Request, url: URL, hits: readonly Hit[], searchBody: boolean, pool: CanaryPool, transforms: ReadonlyMap<string, string>): Occurrence[] {
  const out: Occurrence[] = [];
  const add = (raw: string, value: string, field = pool.match(raw) === undefined ? guardFieldName(raw) : OTHER_NAME) => {
    for (const { name, transform } of scan(value, pool, transforms)) {
      if (!out.some((o) => o.name === name && o.transform === transform && o.field === field && o.value === value)) out.push({ name, transform, raw, field, value });
    }
  };
  for (const [key, value] of url.searchParams) {
    add(key, value);
    add(key, key, OTHER_NAME);
  }
  for (const segment of url.pathname.split('/')) if (segment) add(PATH_FIELD, decodeOrSame(segment), PATH_FIELD);
  const hash = url.hash.slice(1);
  if (hash.includes('=')) {
    for (const [key, value] of new URLSearchParams(hash)) {
      add(key, value);
      add(key, key, OTHER_NAME);
    }
  }
  else if (hash) add(FRAGMENT_FIELD, hash, FRAGMENT_FIELD);
  if (searchBody && req.postData) {
    for (const { name, value } of bodyEntries(req).entries) {
      add(name, value);
      // A page can use a value as a key.
      add(name, name, OTHER_NAME);
    }
    // What the entries do not show, such as an unparsable or a multipart body.
    for (const [form, name] of pool.forms) {
      if (req.postData.includes(form) && !out.some((o) => o.name === name)) out.push({ name, transform: transforms.get(form) ?? 'other', raw: BODY_FIELD, field: BODY_FIELD, value: form });
    }
  }
  for (const hit of hits) {
    for (const [key, value] of Object.entries(hit.params)) {
      add(key, value);
      add(key, key, OTHER_NAME);
    }
  }
  return out;
}

type PageFieldTable = Record<string, { page: readonly string[]; referrer: readonly string[] } | undefined>;

function pageFieldsOf(vendor: string): readonly string[] {
  const fields = (PAGE_FIELDS as PageFieldTable)[vendor];
  return fields ? [...fields.page, ...fields.referrer] : [];
}

function routeKind(occurrences: Occurrence[], pageFields: ReadonlySet<string>, pages: ReadonlySet<string>, identity: boolean): { kind: RouteKind; chosen: Occurrence } {
  if (identity) return { kind: 'direct', chosen: occurrences[0]! };
  const own = occurrences.find((o) => o.raw === o.name);
  if (own) return { kind: 'direct', chosen: own };
  const isPage = (o: Occurrence) => pageFields.has(o.raw) || pages.has(o.value);
  const other = occurrences.find((o) => !isPage(o));
  return other ? { kind: 'unknown', chosen: other } : { kind: 'pageUrl', chosen: occurrences[0]! };
}

function firstSighting(checkpoints: readonly Checkpoint[], canary: string, t: number): { checkpoint: Checkpoint; cookie: CheckpointCookie } | undefined {
  let best: { checkpoint: Checkpoint; cookie: CheckpointCookie } | undefined;
  for (const checkpoint of checkpoints) {
    if (checkpoint.t === undefined || checkpoint.t >= t || (best && best.checkpoint.t! <= checkpoint.t)) continue;
    const cookie = checkpoint.cookies.find((c) => c.firstParty && c.canary === canary);
    if (cookie) best = { checkpoint, cookie };
  }
  return best;
}

/** The browser hit a server container call was linked to, as a hop, and the hit's name for the detail. */
function linkedHit(own: readonly Hit[], byId: ReadonlyMap<string, Hit>): { hop: HitHop; label: string } | undefined {
  const via = (own.find((h) => h.via?.confidence === 'exact') ?? own.find((h) => h.via))?.via;
  const browser = via && byId.get(via.hitId);
  if (!via || !browser) return undefined;
  return { hop: { kind: 'hit', hitId: via.hitId, confidence: via.confidence }, label: browser.event === null ? browser.vendor : `${browser.vendor} ${guardFieldName(browser.event)}` };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The `identifierRoute` flags and the one `canarySearch` flag of a run with canaries. Headers are not searched. */
export function buildCanaryFlags(input: CanaryRouteInput): Flag[] {
  const { runId, siteUrl, firstPartyHosts = [], serverHosts = [], requests, hits, checkpoints = [], canaries, identity = null } = input;
  if (canaries.length === 0) return [];
  const pool = input.pool ?? canaryPool(canaries, identity);
  const transforms = new Map<string, string>();
  const values = [...canaries.map((c) => c.value), ...(identity ? [identity.email, identity.phone] : [])];
  for (const value of values) for (const [form, transform] of transformForms(value)) if (!transforms.has(form)) transforms.set(form, transform);
  const canaryNames = new Set(canaries.map((c) => c.name));
  const siteHost = parse(siteUrl)?.hostname ?? '';
  const hitsByRequest = new Map<string, Hit[]>();
  const hitsById = new Map(hits.map((h) => [h.id as string, h]));
  for (const hit of hits) hitsByRequest.set(hit.requestId, [...(hitsByRequest.get(hit.requestId) ?? []), hit]);

  const flags: Flag[] = [];
  const skipped = { binary: new Set<string>(), cut: new Set<string>(), netLog: new Set<string>() };
  let searched = 0;
  for (const req of requests) {
    const url = parse(req.url);
    if (!url || !/^https?:$/.test(url.protocol)) continue;
    if (isFirstParty(url.hostname, siteHost, firstPartyHosts) || isServerHostUrl(req.url, serverHosts)) continue;
    searched += 1;
    const binary = isBinaryBody(req);
    if (binary) skipped.binary.add(req.id);
    else if (req.postData !== null && req.postData.length >= MAX_POST_DATA) skipped.cut.add(req.id);
    if (req.captured === 'netlog' && req.postData === null && req.method !== 'GET' && req.method !== 'HEAD') skipped.netLog.add(req.id);
    const own = hitsByRequest.get(req.id) ?? [];
    const occurrences = occurrencesOf(req, url, own, !binary, pool, transforms);
    const vendor = own[0]?.vendor ?? 'unknown';
    const pageFields = new Set(own.flatMap((h) => pageFieldsOf(h.vendor)));
    const pages = new Set(own.flatMap((h) => (h.page ? [h.page] : [])));
    for (const name of new Set(occurrences.map((o) => o.name))) {
      const { kind, chosen } = routeKind(occurrences.filter((o) => o.name === name), pageFields, pages, !canaryNames.has(name));
      const source: FlagRoute['source'] = canaryNames.has(name) ? { source: 'urlParam', name } : { source: 'identity', name };
      const seen = kind === 'unknown' && source.source === 'urlParam' ? firstSighting(checkpoints, name, req.t) : undefined;
      const cookie: CookieHop[] = seen ? [{ kind: 'cookie', name: pool.match(seen.cookie.name) === undefined ? guardFieldName(seen.cookie.name) : OTHER_NAME, checkpointId: seen.checkpoint.id }] : [];
      const linked = req.captured === 'serverContainer' ? linkedHit(own, hitsById) : undefined;
      const hops: RouteHop[] = [...cookie, ...(linked ? [linked.hop] : [])];
      const route: FlagRoute = { kind: seen ? 'cookie' : kind, source, sink: { requestId: req.id, host: url.hostname, vendor, field: chosen.field, transform: chosen.transform }, hops };
      const from = source.source === 'urlParam' ? `url param ${name}` : `identity ${name}`;
      const viaCookie = seen ? ` -> cookie ${cookie[0]!.name} (checkpoint ${seen.checkpoint.label})` : '';
      const tail = linked
        ? ` -> hit (${linked.label}) -> server call (${vendor}, ${chosen.field}, ${chosen.transform}), link ${linked.hop.confidence}`
        : ` -> request to ${url.hostname}, param ${chosen.field}, ${chosen.transform}`;
      flags.push({ type: 'flag', id: newId('flag'), runId, kind: 'identifierRoute', recordIds: [req.id], detail: `${from}${viaCookie}${tail}`, route });
    }
  }

  const ids = [...new Set([...skipped.binary, ...skipped.cut, ...skipped.netLog])];
  const what = `${plural(canaries.length, 'canary value')}${identity ? ' and the identity email and phone' : ''}`;
  const detail =
    `Searched ${plural(searched, 'request')} to non-first-party hosts for ${what} as plain text, URL-encoded, base64, base64url and SHA-256 (hex, base64, base64url), and with the GCL. and fb.1. cookie prefixes. ` +
    'Searched: URL, body and decoded fields. Not searched: headers (Referer and Cookie). ' +
    `Skipped: compressed or binary body ${skipped.binary.size}, body cut at 64 KiB ${skipped.cut.size}, net-log request with no body ${skipped.netLog.size}.`;
  flags.push({ type: 'flag', id: newId('flag'), runId, kind: 'canarySearch', recordIds: ids, detail });
  return flags;
}
