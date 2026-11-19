import { ownValueKinds, type ConsentEpoch, type DataLayerEvent, type Identity, type OwnValueKind } from '@tagreeve/core';
import { guardFieldName, isValueSegment, OTHER_NAME } from '@tagreeve/decoders';

export interface EarlyIdentityPush {
  pass: boolean;
  evidence: string[];
  message: string;
}

type Leaves = Map<string, Set<OwnValueKind>>;

const MAX_DEPTH = 8;
const MAX_LISTED = 5;

const MIN_BARE_LOCAL = 6;
const AT_MARKERS = ['@', '_at_', '%40', '(at)'];

const SEP = '[^a-z0-9]*';
// Runs of separators in an address part match any separators (or none) in the key.
const loose = (part: string) => part.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(SEP);

const holdsLocalPart = (key: string, identity: Identity): boolean => {
  const [local = '', domain = ''] = identity.email.toLowerCase().split('@');
  const looseLocal = loose(local);
  if (looseLocal === '') return false;
  const k = key.toLowerCase();
  if (local.length >= MIN_BARE_LOCAL && new RegExp(looseLocal).test(k)) return true;
  const [label = '', next = ''] = domain.split('.');
  const atMarkers = AT_MARKERS.map((m) => m.replace(/[()]/g, '\\$&')).join('|');
  const alternatives = [`${SEP}(?:${atMarkers})`];
  if (loose(label) !== '') {
    const nextLabel = loose(next);
    const endsLabel = `(?=$|[^a-z0-9]${nextLabel === '' ? '' : `|${nextLabel}`})`;
    alternatives.push(`${SEP}${loose(label)}${endsLabel}`);
  }
  return new RegExp(`${looseLocal}(?:${alternatives.join('|')})`).test(k);
};

// A key can itself hold a value, so only a plain name is shown.
const safeKey = (key: string, identity: Identity) => {
  if (guardFieldName(key) !== key || isValueSegment(key)) return OTHER_NAME;
  return holdsLocalPart(key, identity) || ownValueKinds(key, identity).size > 0 ? OTHER_NAME : key;
};

/** Collects the key path and kinds of every leaf that holds one of the identity's own values. Never keeps a value. */
function ownLeaves(value: unknown, path: string, key: string, identity: Identity, depth: number, out: Leaves): void {
  if (depth > MAX_DEPTH) return;
  if (typeof value === 'string' || typeof value === 'number') {
    const kinds = ownValueKinds(`${key}=${value}`, identity);
    for (const k of ownValueKinds(String(value), identity)) kinds.add(k);
    if (kinds.size === 0) return;
    const name = path || '(value)';
    const found = out.get(name) ?? new Set<OwnValueKind>();
    for (const k of kinds) found.add(k);
    out.set(name, found);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) ownLeaves(item, `${path}[]`, key, identity, depth + 1, out);
    return;
  }
  for (const [k, child] of Object.entries(value)) {
    const childPath = path === '' ? safeKey(k, identity) : `${path}.${safeKey(k, identity)}`;
    const keyKinds = ownValueKinds(k, identity);
    if (keyKinds.size > 0) {
      const found = out.get(childPath) ?? new Set<OwnValueKind>();
      for (const kind of keyKinds) found.add(kind);
      out.set(childPath, found);
    }
    ownLeaves(child, childPath, k, identity, depth + 1, out);
  }
}

const withoutConsent = (epoch: ConsentEpoch): boolean =>
  epoch.label === 'mixed' ? epoch.state.adUserData === 'denied' || epoch.state.analytics === 'denied' : ['undecided', 'denied', 'withdrawn'].includes(epoch.label);

/**
 * Pushes that carry the run identity's email or phone, or their hashes, in an epoch without consent for user data or
 * analytics. `place` is the epoch placement `evaluate` uses for hits, so the grace window works the same.
 */
export function earlyIdentityPush(
  pushes: readonly DataLayerEvent[],
  place: (t: number) => ConsentEpoch | undefined,
  identity: Identity | undefined,
): EarlyIdentityPush {
  if (!identity) {
    return { pass: true, evidence: [], message: 'Could not check for the run identity in pushes before consent: no identity was given and the run record holds none.' };
  }
  const found: { id: string; leaves: Leaves }[] = [];
  for (const push of pushes) {
    const epoch = place(push.t);
    if (!epoch || !withoutConsent(epoch)) continue;
    const leaves: Leaves = new Map();
    for (const arg of push.args) ownLeaves(arg, '', '', identity, 0, leaves);
    if (leaves.size > 0) found.push({ id: push.id, leaves });
  }
  if (found.length === 0) return { pass: true, evidence: [], message: 'Expected no test identity in dataLayer pushes before consent, found none.' };
  const describe = (f: (typeof found)[number]) => `${f.id} (${[...f.leaves].map(([path, kinds]) => `${path}: ${[...kinds].join(', ')}`).join('; ')})`;
  const more = found.length > MAX_LISTED ? `; and ${found.length - MAX_LISTED} more` : '';
  return {
    pass: false,
    evidence: found.map((f) => f.id),
    message: `Expected no test identity in dataLayer pushes before consent, found ${found.length}: ${found.slice(0, MAX_LISTED).map(describe).join('; ')}${more}.`,
  };
}
