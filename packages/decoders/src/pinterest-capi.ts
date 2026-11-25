import type { Hit, Request } from '@tagreeve/core';
import { PAGE_FIELDS } from './page-fields.ts';
import { defaultHitId, type Decoder, type NewHitId } from './decoder.ts';
import { bodyComplete, jsonEntries, withFields } from './fields.ts';

type Json = Record<string, unknown>;

const EVENTS_PATH = /^\/v5\/ad_accounts\/([^/]+)\/events\/?$/;

function eventsAccount(req: Pick<Request, 'url'>): string | undefined {
  try {
    const url = new URL(req.url);
    return url.hostname === 'api.pinterest.com' ? EVENTS_PATH.exec(url.pathname)?.[1] : undefined;
  } catch {
    return undefined;
  }
}

/** True for any method, so the CORS preflight of a browser call is stubbed too. */
export function isPinterestCapiEndpoint(req: Pick<Request, 'url'>): boolean {
  return eventsAccount(req) !== undefined;
}

/**
 * The tag names events `addtocart` and the Conversions API names them `add_to_cart`. The key drops case and `_`
 * so the two compare equal. It is for the link rule only; `hit.event` keeps the name as sent.
 */
export function pinterestEventKey(name: string): string {
  return name.toLowerCase().replaceAll('_', '');
}

function isObject(v: unknown): v is Json {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  const first: unknown = Array.isArray(v) ? v[0] : v;
  if (typeof first === 'string') return first === '' ? undefined : first;
  return typeof first === 'number' ? String(first) : undefined;
}

function eventItems(body: string | null): Json[] | undefined {
  if (!body) return undefined;
  try {
    const json: unknown = JSON.parse(body);
    const data = isObject(json) ? json.data : undefined;
    return Array.isArray(data) && data.every(isObject) ? (data as Json[]) : undefined;
  } catch {
    return undefined;
  }
}

function decodeItem(item: Json, req: Request, newHitId: NewHitId, complete: boolean): Hit {
  const userData = isObject(item.user_data) ? item.user_data : {};
  const ids: Hit['ids'] = {};
  const params: Record<string, string> = {};
  // Only the first value, as the tag's `pd.em` is one value.
  const email = str(userData.em);
  if (email) {
    ids.hashedEmail = true;
    params.hashedEmail = email;
  }
  const eventId = str(item.event_id);
  if (eventId) {
    ids.event_id = true;
    params.eventId = eventId;
  }
  return withFields({
    type: 'hit',
    id: newHitId(),
    runId: req.runId,
    stepId: req.stepId,
    requestId: req.id,
    t: req.t,
    vendor: 'pinterest-capi',
    event: str(item.event_name) ?? null,
    consent: { ads: 'unknown', analytics: 'unknown', adUserData: 'unknown', adPersonalization: 'unknown', raw: {} },
    ids,
    page: str(item[PAGE_FIELDS['pinterest-capi'].page[0]]) ?? null,
    transport: req.resourceType === 'ping' ? 'beacon' : req.resourceType,
    params,
  }, jsonEntries(item), complete);
}

export const pinterestCapi: Decoder = {
  name: 'pinterest-capi',
  match: (req) => req.method.toUpperCase() === 'POST' && eventsAccount(req) !== undefined,
  isCollectionEndpoint: isPinterestCapiEndpoint,
  decode(req: Request, newHitId: NewHitId = defaultHitId): Hit[] {
    if (req.method.toUpperCase() !== 'POST' || eventsAccount(req) === undefined) return [];
    const items = eventItems(req.postData);
    if (!items) return [decodeItem({}, req, newHitId, false)];
    const complete = bodyComplete(req);
    return items.map((item) => decodeItem(item, req, newHitId, complete));
  },
};
