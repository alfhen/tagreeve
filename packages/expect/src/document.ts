import type { Request, RequestFrame } from '@tagreeve/core';

/** A `visit` step start: the step ID and the time it began. */
export interface VisitStart {
  stepId: string;
  t: number;
}

export interface DocumentContext {
  requests: ReadonlyMap<string, Request>;
  visits: readonly VisitStart[];
}

const aborted = (r: Request) => r.outcome === 'failed' && r.failure === 'net::ERR_ABORTED';
const isDocument = (r: Request) => r.resourceType === 'document' && !aborted(r);

/**
 * The navigations that unload a frame's document: the `visit` step starts and the document requests that did not abort
 * and were made by that frame. An embedded frame is also unloaded by a navigation of the main frame of its page, when both pages are numbered.
 * Without a frame on either side, any main-frame request counts.
 */
export function navigationTimes(ctx: DocumentContext, frame: RequestFrame | undefined): number[] {
  const sameFrame = (r: Request) => {
    if (!(frame && r.frame)) return r.frame?.main !== false;
    if (r.frame.n === frame.n) return true;
    return !frame.main && r.frame.main && frame.page !== undefined && r.frame.page === frame.page;
  };
  return [...ctx.visits.map((v) => v.t), ...[...ctx.requests.values()].filter((r) => isDocument(r) && sameFrame(r)).map((r) => r.t)];
}

/**
 * The page loads of the page that holds `frame`: the `visit` step starts and the main-frame document requests that did not abort.
 * A popup is a page of its own, so its document request is not a load of the opener. A sub frame's own document request is not a page load.
 * A request or a frame with no page number counts for every page. A `visit` takes the page of its step's first main-frame document request,
 * and counts for every page when the step has none or it has no page number.
 */
export function pageLoadTimes(ctx: DocumentContext, frame: RequestFrame | undefined): number[] {
  const mains = [...ctx.requests.values()].filter((r) => isDocument(r) && r.frame?.main !== false).sort((a, b) => a.t - b.t);
  const samePage = (page: number | undefined) => frame?.page === undefined || page === undefined || page === frame.page;
  const visits = ctx.visits
    .filter((v) => samePage(mains.find((r) => r.stepId === v.stepId)?.frame?.page))
    .map((v) => v.t);
  return [...visits, ...mains.filter((r) => samePage(r.frame?.page)).map((r) => r.t)];
}
