import type { ConsentState, Flag, FlagRoute, Hit, Request, ResultNote, Severity, TagreeveRecord } from '@tagreeve/core';
import { GOOGLE_VENDORS } from './consent-mode-setup.ts';
import { consentFields } from './scenario.ts';
import { effectiveConsentAt, epochForHit, type EvalEpoch } from './evaluate.ts';

export interface IdentifierRouteResult {
  pass: boolean;
  evidence: string[];
  message: string;
  severity: Severity;
  note?: ResultNote;
}

const MAX_LINES = 5;
const NOT_SEARCHED = 'headers, including Referer and Cookie, not searched';
const FORMS = 'exact, URL-encoded, base64, base64url, SHA-256 hex, base64 and base64url, GCL. and fb.1. prefixes';

/** Consent that holds no grant, or that denies `analytics_storage` or `ad_user_data`, forbids a planted value. */
function stateForbids(state: ConsentState): boolean {
  const known = consentFields.map((f) => state[f]).filter((v) => v !== 'unknown');
  if (known.length === 0 || known.every((v) => v === 'denied')) return true;
  return state.analytics === 'denied' || state.adUserData === 'denied';
}

function epochForbids(epoch: EvalEpoch | undefined): boolean {
  if (!epoch) return true;
  if (epoch.label === 'granted') return false;
  if (epoch.label === 'mixed') return stateForbids(epoch.state);
  return true;
}

/** Only a Google hit that carries its own consent takes it. Every other hit takes the consent of its epoch. */
function hitForbids(hit: Hit, epochs: readonly EvalEpoch[], grace: number): boolean {
  const own = GOOGLE_VENDORS.has(hit.vendor) && consentFields.some((f) => hit.consent[f] !== 'unknown');
  return own ? stateForbids(effectiveConsentAt(hit, epochs, grace)) : epochForbids(epochForHit(epochs, hit.t, grace));
}

type Level = 'ok' | 'warn' | 'fail';

interface Finding {
  line: string;
  level: Level;
  requestId: string;
  unlinked: boolean;
}

function judge(route: FlagRoute, request: Request | undefined, hits: readonly Hit[], epochs: readonly EvalEpoch[], grace: number): { level: Level; unlinked: boolean } {
  const pageOnly = route.kind === 'pageUrl';
  if (request?.captured === 'serverContainer') {
    // The link only places the call in an epoch, so every epoch up to the call is judged, whatever its link.
    const at = epochForHit(epochs, request.t, grace);
    const upTo = at ? epochs.slice(0, epochs.indexOf(at) + 1) : [];
    if (upTo.every(epochForbids)) return { level: pageOnly ? 'warn' : 'fail', unlinked: false };
    return { level: 'warn', unlinked: true };
  }
  const forbidden = hits.length > 0 ? hits.some((h) => hitForbids(h, epochs, grace)) : epochForbids(request ? epochForHit(epochs, request.t, grace) : undefined);
  if (!forbidden) return { level: 'ok', unlinked: false };
  return { level: pageOnly ? 'warn' : 'fail', unlinked: false };
}

function routeLine(route: FlagRoute, level: Level, unlinked: boolean): string {
  const from = route.source.source === 'identity' ? `identity ${route.source.name}` : `url param ${route.source.name}`;
  const base = `${from} -> request to ${route.sink.host}, param ${route.sink.field}, ${route.sink.transform}`;
  if (unlinked) return `${base} (server container call, consent was granted before it)`;
  return route.kind === 'pageUrl' && level === 'warn' ? `${base} (page URL only)` : base;
}

const count = (text: string, re: RegExp): number => Number(re.exec(text)?.[1] ?? 0);

/** What was searched and skipped, from the `canarySearch` flag. */
function searchedText(search: Flag): string {
  const requests = /Searched (\d+) requests?/.exec(search.detail)?.[1];
  const reasons: [number, string][] = [
    [count(search.detail, /compressed or binary body (\d+)/), 'compressed or binary body'],
    [count(search.detail, /body cut at 64 KiB (\d+)/), 'body cut at 64 KiB'],
    [count(search.detail, /net-log request with no body (\d+)/), 'net-log request with no body'],
  ];
  const parts = reasons.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  const skipped = `skipped ${search.recordIds.length}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
  if (requests === undefined) return `${search.detail} ${NOT_SEARCHED}; ${skipped}.`;
  return `searched forms (${FORMS}) in the URL, body and decoded fields of ${requests} request${requests === '1' ? '' : 's'}; ${NOT_SEARCHED}; ${skipped}.`;
}

/**
 * Judges the `identifierRoute` flags of a run by the consent of the epoch each sink left in. Returns nothing for a run with no `canarySearch` flag.
 * Route names come from the masked flag, never from the raw request.
 */
export function identifierRoute(records: readonly (TagreeveRecord | EvalEpoch)[], graceMs: number, override?: Severity): IdentifierRouteResult | undefined {
  const search = records.find((r): r is Flag => r.type === 'flag' && r.kind === 'canarySearch');
  if (!search) return undefined;
  const epochs = records.filter((r): r is EvalEpoch => r.type === 'consentEpoch').sort((a, b) => a.startT - b.startT);
  const requests = new Map(records.filter((r): r is Request => r.type === 'request').map((r) => [r.id as string, r]));
  const hitsByRequest = new Map<string, Hit[]>();
  for (const r of records) if (r.type === 'hit') hitsByRequest.set(r.requestId, [...(hitsByRequest.get(r.requestId) ?? []), r]);
  const routes = records.filter((r): r is Flag & { route: FlagRoute } => r.type === 'flag' && r.kind === 'identifierRoute' && r.route !== undefined);

  const findings: Finding[] = [];
  for (const { route } of routes) {
    const requestId = route.sink.requestId;
    const { level, unlinked } = judge(route, requests.get(requestId), hitsByRequest.get(requestId) ?? [], epochs, graceMs);
    if (level !== 'ok') findings.push({ line: routeLine(route, level, unlinked), level, requestId, unlinked });
  }
  const sorted = [...findings.filter((f) => f.level === 'fail'), ...findings.filter((f) => f.level === 'warn')];
  if (sorted.length === 0) {
    const allowed = routes.length;
    const head = allowed > 0 ? `No planted value reached a sink while consent forbade it (${allowed} route${allowed === 1 ? '' : 's'} allowed by consent); ` : 'No planted value found in the ';
    return { pass: true, evidence: [], message: `${head}${searchedText(search)}`, severity: override ?? 'fail' };
  }
  const failing = sorted.some((f) => f.level === 'fail');
  const shown = sorted.slice(0, MAX_LINES).map((f) => f.line).join('; ');
  const more = sorted.length > MAX_LINES ? `; and ${sorted.length - MAX_LINES} more` : '';
  const noted = !failing && sorted.some((f) => f.unlinked);
  return {
    pass: false,
    evidence: [...new Set(sorted.map((f) => f.requestId))],
    message: `Expected no planted value to reach a sink while consent forbids it, found ${sorted.length}: ${shown}${more}. Headers, including Referer and Cookie, were not searched.`,
    severity: failing ? (override ?? 'fail') : 'warn',
    ...(noted && { note: 'serverSendUnlinked' as const }),
  };
}
