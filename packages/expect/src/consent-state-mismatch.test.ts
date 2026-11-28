import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newId, type ConsentState, type DataLayerEvent, type Hit, type Request, type RequestFrame, type Step } from '@tagreeve/core';
import { describe, expect, test } from 'vitest';
import { CONSENT_MODE_URL } from './consent-mode-setup.ts';
import { evaluate, type EvalEpoch } from './evaluate.ts';
import { BUILTIN_NAMES, parseScenario } from './scenario.ts';

const runId = newId('run');
const TID = 'G-PWTEST0001';
const NAME = 'builtin: consentStateMismatch';

const MAIN: RequestFrame = { main: true, n: 0, page: 0 };
const SUB: RequestFrame = { main: false, n: 1, page: 0 };

const all = (v: 'granted' | 'denied' | 'unknown'): ConsentState => ({ analytics: v, ads: v, adUserData: v, adPersonalization: v });
const signals = (v: 'granted' | 'denied') => ({ ad_storage: v, analytics_storage: v, ad_user_data: v, ad_personalization: v });
/** What a hit says when its own `ads` and `analytics` are granted. */
const SAYS_GRANTED: Partial<ConsentState> = { ads: 'granted', analytics: 'granted' };

function push(t: number, args: unknown[], over: Partial<DataLayerEvent> = {}): DataLayerEvent {
  return { type: 'dataLayerEvent', id: newId('dataLayerEvent'), runId, stepId: null, t, event: null, gtmUniqueEventId: null, args, isConsentCommand: false, frame: MAIN, ...over };
}
const dflt = (t: number, over: Partial<DataLayerEvent> = {}, body: Record<string, unknown> = signals('denied')) => push(t, ['consent', 'default', body], over);
const update = (t: number, over: Partial<DataLayerEvent> = {}, body: Record<string, unknown> = signals('granted')) => push(t, ['consent', 'update', body], over);
const accept = (t = 1000, over: Partial<DataLayerEvent> = {}) => update(t, over, signals('granted'));
const reject = (t = 2000, over: Partial<DataLayerEvent> = {}) => update(t, over, signals('denied'));

function request(t: number, over: Partial<Request> = {}): Request {
  return {
    type: 'request', id: newId('request'), runId, stepId: null, t, method: 'GET', url: 'https://www.google-analytics.com/g/collect', resourceType: 'image',
    frameUrl: null, initiator: null, headers: {}, postData: null, outcome: 'passed', frame: MAIN, ...over,
  };
}

interface Sent {
  hit: Hit;
  req: Request;
}

/** A hit and the request that carried it. A `null` frame leaves the request with none. */
function sent(t: number, consent: Partial<ConsentState> = SAYS_GRANTED, over: Partial<Hit> & { frame?: RequestFrame | null; request?: Partial<Request> } = {}): Sent {
  const { frame = MAIN, request: reqOver = {}, ...hitOver } = over;
  const req = request(t, { ...reqOver });
  if (frame) req.frame = frame;
  else delete req.frame;
  const hit: Hit = {
    type: 'hit', id: newId('hit'), runId, stepId: null, requestId: req.id, t, vendor: 'ga4', event: 'page_view',
    consent: { ...all('unknown'), ...consent, raw: {} }, ids: {}, page: 'http://localhost:3000/', transport: 'image',
    params: { tid: TID }, fields: [], idFields: [], fieldsComplete: true, ...hitOver,
  };
  return { hit, req };
}

type Records = Parameters<typeof evaluate>[0];
const run = (records: unknown[], yaml = 'start: /') => evaluate(records as Records, parseScenario(yaml));
const mismatch = (records: unknown[], yaml?: string) => run(records, yaml).filter((r) => r.expectation === NAME);
const named = (records: unknown[], name: string) => run(records).find((r) => r.expectation === `builtin: ${name}`)!;

function epoch(startT: number, endT: number | null, label: EvalEpoch['label'], state: ConsentState): EvalEpoch {
  return { type: 'consentEpoch', id: newId('consentEpoch'), runId, startT, endT, source: 'test', label, state };
}

const inEvidence = (results: { evidence: string[] }[], id: string) => results.some((r) => r.evidence.includes(id));

/** The reported case: accept, then reject, then a hit that says granted 3000 ms later. */
function reported(over: Parameters<typeof sent>[2] = {}) {
  const acc = accept();
  const rej = reject();
  const s = sent(5000, SAYS_GRANTED, over);
  return { acc, rej, ...s };
}

describe('the reported case', () => {
  test('a granted hit after a reject update warns with the vendor, the tag, the frame and the signals', () => {
    const { acc, rej, hit, req } = reported();
    expect(rej.args).toEqual(['consent', 'update', signals('denied')]);
    expect([hit.consent.ads, hit.consent.analytics]).toEqual(['granted', 'granted']);
    expect(hit.t - rej.t).toBe(3000);
    const results = mismatch([acc, rej, req, hit]);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('warn');
    for (const text of ['ga4', TID, 'main frame', 'ad_storage', 'analytics_storage', CONSENT_MODE_URL]) expect(r.message).toContain(text);
    expect(r.evidence).toContain(hit.id);
    expect(r.evidence).toContain(rej.id);
    expect(r.evidence).not.toContain(acc.id);
  });

  test('a google-ads hit is named google-ads with its tag ID', () => {
    const rej = reject();
    const { hit, req } = sent(5000, { ads: 'granted' }, { vendor: 'google-ads', params: { conversionId: '000000001' } });
    expect(hit.vendor).toBe('google-ads');
    expect(hit.consent.ads).toBe('granted');
    const [r] = mismatch([accept(), rej, req, hit]);
    expect(r!.pass).toBe(false);
    for (const text of ['google-ads', 'AW-000000001', 'ad_storage']) expect(r!.message).toContain(text);
    expect(r!.evidence).toContain(hit.id);
  });

  test('the object form of the reject update denies like the array form', () => {
    const rej = push(2000, [{ 0: 'consent', 1: 'update', 2: signals('denied') }]);
    expect(rej.args[0]).not.toBeInstanceOf(Array);
    const { hit, req } = sent(5000);
    const [r] = mismatch([accept(), rej, req, hit]);
    expect(r!.pass).toBe(false);
    expect(r!.evidence).toContain(hit.id);
    expect(r!.evidence).toContain(rej.id);
  });

  test('a default pushed after an update is ignored', () => {
    const acc = accept(0);
    const d = dflt(1000);
    const { hit, req } = sent(4000);
    expect(d.args[1]).toBe('default');
    expect(hit.consent.ads).toBe('granted');
    expect(inEvidence(mismatch([acc, d, req, hit]), hit.id)).toBe(false);
  });
});

describe('the stable window', () => {
  test('a hit 1500 ms after the reject is skipped and counted', () => {
    const { acc, rej } = reported();
    const { hit, req } = sent(rej.t + 1500);
    expect(rej.t).toBe(2000);
    expect(hit.consent.ads).toBe('granted');
    const results = mismatch([acc, rej, req, hit]);
    expect(inEvidence(results, hit.id)).toBe(false);
    expect(results[0]!.pass).toBe(true);
    expect(results[0]!.message).toContain('1 hit skipped for an unstable window');
  });

  test('a hit 1500 ms before a later consent push of its frame is skipped', () => {
    const { acc, rej } = reported();
    const later = accept(6500);
    const { hit, req } = sent(5000);
    expect(hit.t - rej.t).toBeGreaterThan(2000);
    expect(later.t - hit.t).toBe(1500);
    const results = mismatch([acc, rej, later, req, hit]);
    expect(inEvidence(results, hit.id)).toBe(false);
    expect(results[0]!.message).toContain('1 hit skipped for an unstable window');
  });

  test('a hit 2500 ms after the reject is reported', () => {
    const { acc, rej } = reported();
    const { hit, req } = sent(rej.t + 2500);
    expect(hit.consent.ads).toBe('granted');
    expect(inEvidence(mismatch([acc, rej, req, hit]), hit.id)).toBe(true);
  });
});

describe('frames are judged apart', () => {
  test('a granted hit of a sub frame that its own dataLayer denied is reported as a sub frame', () => {
    const rej = reject(2000, { frame: SUB });
    const { hit, req } = sent(5000, SAYS_GRANTED, { frame: SUB });
    expect(rej.frame).toEqual(SUB);
    expect(req.frame!.n).toBe(1);
    const [r] = mismatch([accept(1000, { frame: SUB }), rej, req, hit]);
    expect(r!.pass).toBe(false);
    expect(r!.message).toContain('sub frame');
    expect(r!.message).not.toContain('main frame');
    expect(r!.evidence).toContain(hit.id);
    expect(r!.evidence).toContain(rej.id);
  });

  test('the same hit sent from the main frame, where the state is granted, is not reported', () => {
    const rej = reject(2000, { frame: SUB });
    const { hit, req } = sent(5000, SAYS_GRANTED, { frame: MAIN });
    expect(rej.frame!.main).toBe(false);
    expect(req.frame!.n).toBe(0);
    const results = mismatch([accept(1000, { frame: SUB }), rej, accept(), req, hit]);
    expect(results).toHaveLength(1);
    expect(inEvidence(results, hit.id)).toBe(false);
  });
});

describe('what is not judged', () => {
  test('a signal denied only by a default push is not reported and is counted', () => {
    const d = dflt(0);
    const { hit, req } = sent(4000);
    expect(d.args).toEqual(['consent', 'default', signals('denied')]);
    expect(hit.consent.ads).toBe('granted');
    expect(inEvidence(mismatch([d, reject(1000), req, hit]), hit.id)).toBe(true);
    const [r] = mismatch([d, req, hit]);
    expect(r).toBeDefined();
    expect(r!.pass).toBe(true);
    expect(r!.evidence).not.toContain(hit.id);
    expect(r!.message).toContain('1 hit skipped as a default-only denial');
  });

  test('two layers of one frame that disagree are skipped and counted as ambiguous', () => {
    const { acc, rej, hit, req } = reported();
    const other = accept(1000, { layer: 'otherLayer' });
    expect(other.layer).toBe('otherLayer');
    expect(hit.consent.ads).toBe('granted');
    const results = mismatch([acc, rej, other, req, hit], 'start: /\noptions:\n  dataLayerNames: [otherLayer]\n');
    expect(inEvidence(results, hit.id)).toBe(false);
    expect(results[0]!.message).toContain('1 hit skipped as ambiguous');
  });

  test('a hit whose request has no frame is skipped and counted', () => {
    const { acc, rej, hit, req } = reported();
    const noFrame = sent(5000, SAYS_GRANTED, { frame: null });
    expect(noFrame.req.frame).toBeUndefined();
    expect(noFrame.hit.consent.ads).toBe('granted');
    const results = mismatch([acc, rej, req, hit, noFrame.req, noFrame.hit]);
    expect(results[0]!.evidence).toContain(hit.id);
    expect(inEvidence(results, noFrame.hit.id)).toBe(false);
    expect(results[0]!.message).toContain('1 hit skipped for no frame');
  });

  test('a Meta hit is not judged', () => {
    const { acc, rej, hit, req } = reported();
    const meta = sent(5000, SAYS_GRANTED, { vendor: 'meta' });
    expect(meta.hit.vendor).toBe('meta');
    expect(inEvidence(mismatch([acc, rej, req, hit, meta.req, meta.hit]), meta.hit.id)).toBe(false);
  });

  test('a server container hit is not judged', () => {
    const { acc, rej } = reported();
    const server = sent(5000, SAYS_GRANTED, { request: { captured: 'serverContainer' } });
    expect(server.req.captured).toBe('serverContainer');
    expect(server.hit.consent.ads).toBe('granted');
    expect(inEvidence(mismatch([acc, rej, server.req, server.hit]), server.hit.id)).toBe(false);
  });
});

describe('no pair is reported twice', () => {
  const idsHit = (t: number, consent: Partial<ConsentState>) => sent(t, consent, { fields: ['cid'], idFields: ['cid'] });

  test('a hit with ads granted and analytics denied is in both results, for different signals', () => {
    const { hit, req } = idsHit(5000, { ads: 'granted', analytics: 'denied' });
    expect([hit.consent.ads, hit.consent.analytics]).toEqual(['granted', 'denied']);
    const records = [accept(), reject(), req, hit];
    const denied = named(records, 'deniedIdentifiers');
    expect(denied.pass).toBe(false);
    expect(denied.evidence).toContain(hit.id);
    expect(denied.message).toContain('analytics denied');
    const [r] = mismatch(records);
    expect(r!.evidence).toContain(hit.id);
    expect(r!.message).toContain('ad_storage');
    expect(r!.message).not.toContain('analytics_storage');
  });

  test('a hit that says denied after the reject is not in consentStateMismatch', () => {
    const { hit, req } = idsHit(5000, all('denied'));
    expect([hit.consent.ads, hit.consent.analytics]).toEqual(['denied', 'denied']);
    const records = [accept(), reject(), req, hit];
    expect(named(records, 'deniedIdentifiers').evidence).toContain(hit.id);
    expect(inEvidence(mismatch(records), hit.id)).toBe(false);
  });

  test('a hit before the first answer is in earlyIdentifiers only', () => {
    const { hit, req } = idsHit(500, all('unknown'));
    expect(hit.consent.ads).toBe('unknown');
    const epochs = [epoch(0, 2000, 'undecided', all('unknown')), epoch(2000, null, 'denied', all('denied'))];
    const records = [...epochs, accept(), reject(), req, hit];
    expect(named(records, 'earlyIdentifiers').evidence).toContain(hit.id);
    expect(inEvidence(mismatch(records), hit.id)).toBe(false);
  });

  test('a hit that says granted after a reject still passes deniedIdentifiers', () => {
    const { hit, req } = idsHit(5000, SAYS_GRANTED);
    expect(hit.idFields).toEqual(['cid']);
    const records = [epoch(0, 2000, 'undecided', all('unknown')), epoch(2000, null, 'denied', all('denied')), accept(), reject(), req, hit];
    const denied = named(records, 'deniedIdentifiers');
    expect(denied.pass).toBe(true);
    expect(denied.evidence).not.toContain(hit.id);
  });
});

describe('a run with nothing to judge has no result', () => {
  test('a granted hit and no consent push', () => {
    const { hit, req } = sent(5000);
    expect(hit.consent.ads).toBe('granted');
    expect(mismatch([req, hit])).toEqual([]);
  });

  test('a reject pushed only in another frame', () => {
    const rej = reject(2000, { frame: SUB });
    const { hit, req } = sent(5000);
    expect(rej.frame!.main).toBe(false);
    expect(req.frame!.main).toBe(true);
    expect(mismatch([accept(1000, { frame: SUB }), rej, req, hit])).toEqual([]);
  });

  test('a Google hit with no consent signal', () => {
    const { hit, req } = sent(5000, all('unknown'));
    expect(hit.consent.ads).toBe('unknown');
    expect(mismatch([accept(), reject(), req, hit])).toEqual([]);
  });
});

describe('records without frames', () => {
  test('a record made before version 5 does not throw and does not warn', () => {
    const { acc, rej, hit, req } = reported({ frame: null });
    const bare = [acc, rej].map((p) => ({ ...p, frame: undefined }));
    expect(bare.every((p) => p.frame === undefined)).toBe(true);
    expect(req.frame).toBeUndefined();
    expect(hit.consent.ads).toBe('granted');
    let results: ReturnType<typeof mismatch> = [];
    expect(() => (results = mismatch([...bare, req, hit]))).not.toThrow();
    expect(results.some((r) => !r.pass)).toBe(false);
  });

  test('a hit whose request is not in the record is not reported', () => {
    const { acc, rej } = reported();
    const { hit } = sent(5000);
    expect(hit.consent.ads).toBe('granted');
    expect(inEvidence(mismatch([acc, rej, hit]), hit.id)).toBe(false);
  });
});

describe('no value is printed', () => {
  test('a gcs, a gcd and a pushed value are not in the result', () => {
    const token = 'PWLEAK-G100-TOKEN';
    const rej = update(2000, {}, { ...signals('denied'), pw_note: token });
    const { hit, req } = sent(5000);
    hit.consent.raw = { gcs: 'G111', gcd: '11t1t1t1t5' };
    expect(JSON.stringify(rej.args)).toContain(token);
    expect(hit.consent.raw).toEqual({ gcs: 'G111', gcd: '11t1t1t1t5' });
    const results = mismatch([accept(), rej, req, hit]);
    expect(results[0]!.pass).toBe(false);
    const text = JSON.stringify(results);
    for (const value of ['G111', '11t1t1t1t5', token]) expect(text).not.toContain(value);
  });
});

describe('documents', () => {
  const visitStep = (startedAt: number): Step =>
    ({ type: 'step', id: newId('step'), runId, index: 0, label: 'go', startedAt, endedAt: startedAt + 10 }) as unknown as Step;
  const withVisit = 'start: /\nsteps:\n  - { visit: /, label: go }\n';
  const doc = (t: number, frame: RequestFrame, over: Partial<Request> = {}) => request(t, { resourceType: 'document', url: 'http://localhost:3000/', frame, ...over });

  test('a visit step between the update and the hit skips the hit as a new document', () => {
    const { hit, req } = sent(5000);
    const step = visitStep(3500);
    const nav = doc(3500, MAIN, { stepId: step.id });
    const [r] = mismatch([accept(), reject(), step, nav, req, hit], withVisit);
    expect(r!.pass).toBe(true);
    expect(r!.evidence).not.toContain(hit.id);
    expect(r!.message).toContain('1 hit skipped as in a new document');
  });

  test('a main-frame document request between the update and the hit skips the hit', () => {
    const { hit, req } = sent(5000);
    const [r] = mismatch([accept(), reject(), doc(3500, MAIN), req, hit]);
    expect(r!.message).toContain('1 hit skipped as in a new document');
  });

  test('an aborted document request is not a page load', () => {
    const { hit, req } = sent(5000);
    const aborted = doc(3500, MAIN, { outcome: 'failed', failure: 'net::ERR_ABORTED' });
    expect(inEvidence(mismatch([accept(), reject(), aborted, req, hit]), hit.id)).toBe(true);
  });

  test('a gtm.js push or a default with no navigation does not skip the hit', () => {
    const gtm = push(3500, [{ event: 'gtm.js' }], { event: 'gtm.js' });
    const d = dflt(3600);
    const { hit, req } = sent(6000);
    expect(inEvidence(mismatch([accept(), reject(), gtm, req, hit]), hit.id)).toBe(true);
    expect(inEvidence(mismatch([accept(), reject(), d, req, hit]), hit.id)).toBe(true);
  });

  test('the document request of the hit\'s own sub frame does not skip the hit', () => {
    const first = sent(500, SAYS_GRANTED, { frame: MAIN });
    const frameDoc = doc(3000, SUB);
    const { hit, req } = sent(6000, SAYS_GRANTED, { frame: SUB });
    const records = [accept(100, { frame: SUB }), reject(300, { frame: SUB }), first.req, first.hit, frameDoc, req, hit];
    expect(frameDoc.frame!.main).toBe(false);
    expect(inEvidence(mismatch(records), hit.id)).toBe(true);
  });

  test('a popup page load does not skip a hit of the opener', () => {
    const popup = doc(3500, { main: true, n: 5, page: 1 });
    const { hit, req } = sent(5000);
    expect(popup.frame!.page).not.toBe(req.frame!.page);
    expect(inEvidence(mismatch([accept(), reject(), popup, req, hit]), hit.id)).toBe(true);
  });

  test('a visit whose first document request is on another page does not skip the hit', () => {
    const { hit, req } = sent(5000);
    const step = visitStep(3500);
    const nav = doc(3510, { main: true, n: 5, page: 1 }, { stepId: step.id });
    expect(inEvidence(mismatch([accept(), reject(), step, nav, req, hit], withVisit), hit.id)).toBe(true);
  });

  test('a visit with no document request of its step skips the hit', () => {
    const { hit, req } = sent(5000);
    const [r] = mismatch([accept(), reject(), visitStep(3500), req, hit], withVisit);
    expect(r!.message).toContain('1 hit skipped as in a new document');
  });
});

describe('the stored demo record', () => {
  test('site/demo/reject.jsonl gets no consentStateMismatch result and keeps its other results', () => {
    const dir = new URL('../../../site/demo/', import.meta.url);
    const records = readFileSync(fileURLToPath(new URL('reject.jsonl', dir)), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { type: string; vendor?: string; consent?: { raw?: Record<string, string> } });
    expect(records.some((r) => r.type === 'hit' && r.vendor === 'ga4' && r.consent?.raw?.gcs !== undefined)).toBe(true);
    expect(records.some((r) => r.type === 'dataLayerEvent')).toBe(false);
    const text = readFileSync(fileURLToPath(new URL('scenarios/reject.yml', dir)), 'utf8');
    const results = evaluate(records as never, parseScenario(text));
    expect(results.some((r) => r.expectation === NAME)).toBe(false);
    expect(results.slice(2).map((r) => r.expectation)).toEqual([
      'builtin: unknownDestination',
      'builtin: sandboxPageUrl',
      'builtin: deniedIdentifiers',
      'builtin: earlyIdentifiers',
      'builtin: consentModeSetup',
      'builtin: earlyIdentityPush',
      'builtin: idHandover',
      'builtin: possibleRealData',
    ]);
  });
});

test('consentStateMismatch is a builtin name that takes a severity', () => {
  expect(BUILTIN_NAMES).toContain('consentStateMismatch');
  const yaml = 'start: /x\noptions:\n  builtins: { consentStateMismatch: fail }\n';
  expect(parseScenario(yaml).options.builtins).toEqual({ consentStateMismatch: 'fail' });
  const { acc, rej, hit, req } = reported();
  expect(mismatch([acc, rej, req, hit], yaml)[0]!.severity).toBe('fail');
});
