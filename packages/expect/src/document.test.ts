import { newId, type Request, type RequestFrame } from '@tagreeve/core';
import { expect, test } from 'vitest';
import { navigationTimes, pageLoadTimes, type DocumentContext } from './document.ts';

const runId = newId('run');
const MAIN: RequestFrame = { main: true, n: 0, page: 0 };
const SUB: RequestFrame = { main: false, n: 1, page: 0 };
const POPUP: RequestFrame = { main: true, n: 5, page: 1 };
const S1 = newId('step');

function doc(t: number, frame: RequestFrame | undefined, over: Partial<Request> = {}): Request {
  return {
    type: 'request', id: newId('request'), runId, stepId: null, t, method: 'GET', url: 'http://localhost:3000/', resourceType: 'document',
    frameUrl: null, initiator: null, headers: {}, postData: null, outcome: 'passed', ...(frame && { frame }), ...over,
  };
}

const ctx = (requests: Request[], visits: DocumentContext['visits'] = []): DocumentContext => ({ requests: new Map(requests.map((r) => [r.id, r])), visits });
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** The list `loaderReachesScope` built before the helper existed. */
function before(c: DocumentContext, loader: { frame?: RequestFrame }): number[] {
  const sameFrame = (r: Request) => {
    if (!(loader.frame && r.frame)) return r.frame?.main !== false;
    if (r.frame.n === loader.frame.n) return true;
    return !loader.frame.main && r.frame.main && loader.frame.page !== undefined && r.frame.page === loader.frame.page;
  };
  const aborted = (r: Request) => r.outcome === 'failed' && r.failure === 'net::ERR_ABORTED';
  return [...c.visits.map((v) => v.t), ...[...c.requests.values()].filter((r) => r.resourceType === 'document' && !aborted(r) && sameFrame(r)).map((r) => r.t)];
}

const MIXED = ctx(
  [doc(10, MAIN), doc(20, SUB), doc(30, POPUP), doc(40, undefined), doc(50, { main: false, n: 9, page: 0 }), doc(60, MAIN, { outcome: 'failed', failure: 'net::ERR_ABORTED' }), doc(70, MAIN, { resourceType: 'image' }), doc(80, { main: true, n: 0 })],
  [{ stepId: S1, t: 5 }],
);

test('navigationTimes returns the list that loaderReachesScope built, for every frame', () => {
  for (const frame of [MAIN, SUB, POPUP, { main: false, n: 9, page: 0 }, { main: true, n: 0 }, { main: false, n: 2 }, undefined]) {
    expect(navigationTimes(MIXED, frame)).toEqual(before(MIXED, { frame }));
  }
});

test('navigationTimes of the main frame lists the visit starts and its document requests, not aborted ones', () => {
  expect(sorted(navigationTimes(MIXED, MAIN))).toEqual([5, 10, 40, 80]);
});

test('navigationTimes of an embedded frame holds its own documents and the main frame of its page', () => {
  expect(sorted(navigationTimes(MIXED, SUB))).toEqual([5, 10, 20, 40]);
});

test('a sub frame\'s own document request is not in pageLoadTimes', () => {
  const c = ctx([doc(10, MAIN), doc(20, SUB)]);
  expect(navigationTimes(c, SUB)).toContain(20);
  expect(pageLoadTimes(c, SUB)).toEqual([10]);
});

test('a popup document request is not a page load of the opener', () => {
  const c = ctx([doc(10, MAIN), doc(20, POPUP)]);
  expect(pageLoadTimes(c, MAIN)).toEqual([10]);
  expect(pageLoadTimes(c, POPUP)).toEqual([20]);
});

test('an aborted document request is not a page load', () => {
  const c = ctx([doc(10, MAIN, { outcome: 'failed', failure: 'net::ERR_ABORTED' })]);
  expect(pageLoadTimes(c, MAIN)).toEqual([]);
});

test('a request or a frame with no page number counts for every page', () => {
  const c = ctx([doc(10, { main: true, n: 0 }), doc(20, POPUP)]);
  expect(pageLoadTimes(c, MAIN)).toEqual([10]);
  expect(sorted(pageLoadTimes(c, { main: true, n: 0 }))).toEqual([10, 20]);
});

test('a visit takes the page of its step\'s first main-frame document request', () => {
  const c = ctx([doc(15, POPUP, { stepId: S1 })], [{ stepId: S1, t: 10 }]);
  expect(pageLoadTimes(c, MAIN)).toEqual([]);
  expect(sorted(pageLoadTimes(c, POPUP))).toEqual([10, 15]);
});

test('a visit with no document request of its step counts for every page', () => {
  const c = ctx([], [{ stepId: S1, t: 10 }]);
  expect(pageLoadTimes(c, MAIN)).toEqual([10]);
  expect(pageLoadTimes(c, POPUP)).toEqual([10]);
});
