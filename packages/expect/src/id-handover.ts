import type { Hit, Request } from '@tagreeve/core';
import { ga4HitIds } from '@tagreeve/decoders';

export interface IdHandover {
  pass: boolean;
  evidence: string[];
  message: string;
}

interface Seen {
  hitId: string;
  cid: string;
  sid: string | undefined;
}

interface HitContext {
  label: string;
  seen: Seen[];
}

const MAX_LISTED = 3;

const hostOf = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
};

const contextLabel = (req: Request, hit: Hit): string => `${req.frame!.main ? 'main frame' : 'sub frame'} on ${hostOf(hit.page) ?? hostOf(req.frameUrl) ?? 'an unknown host'}`;

/** `hits` must hold browser hits only. Compares the GA4 client ID, then the session ID, between the contexts of each measurement ID. Never keeps an ID value in its result. */
export function idHandover(hits: readonly Hit[], requests: ReadonlyMap<string, Request>): IdHandover {
  const byRequest = new Map<string, Hit[]>();
  for (const hit of hits) {
    if (hit.vendor !== 'ga4') continue;
    byRequest.set(hit.requestId, [...(byRequest.get(hit.requestId) ?? []), hit]);
  }

  const byTid = new Map<string, Map<string, HitContext>>();
  for (const [requestId, group] of byRequest) {
    const req = requests.get(requestId);
    if (!req?.frame) continue;
    const ids = ga4HitIds(req);
    group.forEach((hit, i) => {
      const cid = ids[i]?.cid;
      if (!cid || !hit.params.tid || hit.consent.analytics === 'denied') return;
      const label = contextLabel(req, hit);
      const contexts = byTid.get(hit.params.tid!) ?? new Map<string, HitContext>();
      const context = contexts.get(label) ?? { label, seen: [] };
      context.seen.push({ hitId: hit.id, cid, sid: ids[i]?.sid });
      contexts.set(label, context);
      byTid.set(hit.params.tid!, contexts);
    });
  }

  const problems: string[] = [];
  const evidence = new Set<string>();
  const flag = (text: string, a: HitContext, b: HitContext) => {
    problems.push(text);
    for (const s of [...a.seen, ...b.seen]) evidence.add(s.hitId);
  };
  for (const [tid, contexts] of byTid) {
    const list = [...contexts.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const cidsB = new Set(b.seen.map((s) => s.cid));
        const shared = new Set(a.seen.map((s) => s.cid).filter((c) => cidsB.has(c)));
        if (shared.size === 0) {
          flag(`${tid}: client ID differs between ${a.label} and ${b.label}`, a, b);
          continue;
        }
        const sidsOf = (c: HitContext) => new Set(c.seen.filter((s) => shared.has(s.cid) && s.sid).map((s) => s.sid!));
        const sidsA = sidsOf(a);
        const sidsB = sidsOf(b);
        if (sidsA.size > 0 && sidsB.size > 0 && ![...sidsA].some((v) => sidsB.has(v))) flag(`${tid}: session ID differs between ${a.label} and ${b.label}`, a, b);
      }
    }
  }

  if (problems.length === 0) return { pass: true, evidence: [], message: 'Expected the GA4 client and session ID to carry over between contexts, found no difference.' };
  const more = problems.length > MAX_LISTED ? `; and ${problems.length - MAX_LISTED} more` : '';
  return {
    pass: false,
    evidence: [...evidence],
    message: `Expected the GA4 client and session ID to carry over between contexts, found ${problems.length} difference${problems.length === 1 ? '' : 's'}: ${problems.slice(0, MAX_LISTED).join('; ')}${more}.`,
  };
}
