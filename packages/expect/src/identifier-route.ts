import { hostMatches } from '@tagreeve/core';
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

type FindingNote = 'serverSendUnlinked' | 'serverSendProbableLink';

interface Finding {
  line: string;
  level: Level;
  requestId: string;
  note?: FindingNote;
}

interface Verdict {
  level: Level;
  note?: FindingNote;
}

/** With a grant, an exact link decides by the linked browser hit. A probable link or none only warns. */
function judgeServerCall(hits: readonly Hit[], hitsById: ReadonlyMap<string, Hit>, epochs: readonly EvalEpoch[], grace: number): Verdict {
  const linked = hits.flatMap((h) => {
    const browser = h.via ? hitsById.get(h.via.hitId) : undefined;
    return h.via && browser ? [{ confidence: h.via.confidence, browser }] : [];
  });
  const exact = linked.filter((l) => l.confidence === 'exact');
  if (exact.some((l) => hitForbids(l.browser, epochs, grace))) return { level: 'fail' };
  if (hits.length > 0 && exact.length === hits.length) return { level: 'ok' };
  if (hits.length > 0 && linked.length === hits.length) return { level: 'warn', note: 'serverSendProbableLink' };
  return { level: 'warn', note: 'serverSendUnlinked' };
}

function judge(route: FlagRoute, request: Request | undefined, hits: readonly Hit[], hitsById: ReadonlyMap<string, Hit>, epochs: readonly EvalEpoch[], grace: number): Verdict {
  const pageOnly = route.kind === 'pageUrl';
  const failLevel: Level = pageOnly ? 'warn' : 'fail';
  if (request?.captured === 'serverContainer') {
    // Every epoch up to the call is judged first, whatever its link: the link only places the call.
    const at = epochForHit(epochs, request.t, grace);
    const upTo = at ? epochs.slice(0, epochs.indexOf(at) + 1) : [];
    if (upTo.every(epochForbids)) return { level: failLevel };
    const verdict = judgeServerCall(hits, hitsById, epochs, grace);
    return verdict.level === 'fail' ? { level: failLevel } : verdict;
  }
  const forbidden = hits.length > 0 ? hits.some((h) => hitForbids(h, epochs, grace)) : epochForbids(request ? epochForHit(epochs, request.t, grace) : undefined);
  return { level: forbidden ? failLevel : 'ok' };
}

function routeLine(route: FlagRoute, level: Level, note: FindingNote | undefined): string {
  const from = route.source.source === 'identity' ? `identity ${route.source.name}` : `url param ${route.source.name}`;
  const base = `${from} -> request to ${route.sink.host}, param ${route.sink.field}, ${route.sink.transform}`;
  if (note === 'serverSendUnlinked') return `${base} (server container call, consent was granted before it)`;
  if (note === 'serverSendProbableLink') return `${base} (server container call, probable link)`;
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
  const forms = /\bas (plain text.+?)\. Searched:/.exec(search.detail)?.[1];
  if (requests === undefined || forms === undefined) return `${search.detail} ${NOT_SEARCHED}; ${skipped}.`;
  return `searched forms (${forms}) in the URL, body and decoded fields of ${requests} request${requests === '1' ? '' : 's'}; ${NOT_SEARCHED}; ${skipped}.`;
}

/**
 * Judges the `identifierRoute` flags of a run by the consent of the epoch each sink left in. Returns nothing for a run with no `canarySearch` flag.
 * Route names come from the masked flag, never from the raw request.
 */
export function identifierRoute(records: readonly (TagreeveRecord | EvalEpoch)[], graceMs: number, override?: Severity, allow: readonly string[] = []): IdentifierRouteResult | undefined {
  const search = records.find((r): r is Flag => r.type === 'flag' && r.kind === 'canarySearch');
  if (!search) return undefined;
  const epochs = records.filter((r): r is EvalEpoch => r.type === 'consentEpoch').sort((a, b) => a.startT - b.startT);
  const requests = new Map(records.filter((r): r is Request => r.type === 'request').map((r) => [r.id as string, r]));
  const hitsByRequest = new Map<string, Hit[]>();
  const hitsById = new Map<string, Hit>();
  for (const r of records) if (r.type === 'hit') hitsById.set(r.id, r);
  for (const r of records) if (r.type === 'hit') hitsByRequest.set(r.requestId, [...(hitsByRequest.get(r.requestId) ?? []), r]);
  const routes = records.filter((r): r is Flag & { route: FlagRoute } => r.type === 'flag' && r.kind === 'identifierRoute' && r.route !== undefined);

  const findings: Finding[] = [];
  const allowedByHost = new Map<string, number>();
  let judged = 0;
  for (const { route } of routes) {
    if (allow.length > 0 && hostMatches(route.sink.host, allow)) {
      allowedByHost.set(route.sink.host, (allowedByHost.get(route.sink.host) ?? 0) + 1);
      continue;
    }
    judged++;
    const requestId = route.sink.requestId;
    const { level, note } = judge(route, requests.get(requestId), hitsByRequest.get(requestId) ?? [], hitsById, epochs, graceMs);
    if (level !== 'ok') findings.push({ line: routeLine(route, level, note), level, requestId, note });
  }
  const allowedText = allowedByHost.size === 0 ? '' : ` (allowed by identifierRouteAllow: ${[...allowedByHost].map(([host, n]) => `${n} route${n === 1 ? '' : 's'} to ${host}`).join(', ')})`;
  const sorted = [...findings.filter((f) => f.level === 'fail'), ...findings.filter((f) => f.level === 'warn')];
  if (sorted.length === 0) {
    const allowed = judged;
    const head = allowed > 0 ? `No planted value reached a sink while consent forbade it (${allowed} route${allowed === 1 ? '' : 's'} allowed by consent); ` : 'No planted value found in the ';
    return { pass: true, evidence: [], message: `${head}${searchedText(search)}${allowedText}`, severity: override ?? 'fail' };
  }
  const failing = sorted.some((f) => f.level === 'fail');
  const shown = sorted.slice(0, MAX_LINES).map((f) => f.line).join('; ');
  const more = sorted.length > MAX_LINES ? `; and ${sorted.length - MAX_LINES} more` : '';
  const note = failing ? undefined : sorted.find((f) => f.note === 'serverSendUnlinked')?.note ?? sorted.find((f) => f.note)?.note;
  return {
    pass: false,
    evidence: [...new Set(sorted.map((f) => f.requestId))],
    message: `Expected no planted value to reach a sink while consent forbids it, found ${sorted.length}: ${shown}${more}. Headers, including Referer and Cookie, were not searched.${allowedText}`,
    severity: failing ? (override ?? 'fail') : 'warn',
    ...(note && { note }),
  };
}
