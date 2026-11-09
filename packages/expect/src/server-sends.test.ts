import { createIdentity, hashEmail, newId, type ConsentState, type Hit, type HitVia, type Request, type Result, type Step } from '@tagreeve/core';
import { describe, expect, test } from 'vitest';
import { effectiveConsentAt, epochForHit, evaluate, judgeIndex, judgedAt, placeHitsInEpochs, type EvalEpoch } from './evaluate.ts';
import { parseScenario } from './scenario.ts';

const runId = newId('run');
const identity = createIdentity(1);
const unknown = { analytics: 'unknown', ads: 'unknown', adUserData: 'unknown', adPersonalization: 'unknown', raw: {} } as const;
const denied = { analytics: 'denied', ads: 'denied', adUserData: 'denied', adPersonalization: 'denied', raw: {} } as const;
const granted = { analytics: 'granted', ads: 'granted', adUserData: 'granted', adPersonalization: 'granted', raw: {} } as const;

const DENIED_UNTIL = 1000;
const epochs: EvalEpoch[] = [
  { type: 'consentEpoch', id: newId('consentEpoch'), runId, startT: 0, endT: DENIED_UNTIL, source: 'test', label: 'denied', state: denied },
  { type: 'consentEpoch', id: newId('consentEpoch'), runId, startT: DENIED_UNTIL, endT: null, source: 'test', label: 'granted', state: granted },
];

interface Pair {
  hit: Hit;
  req: Request;
}

function pair(over: Partial<Hit>, server: boolean): Pair {
  const req: Request = {
    type: 'request', id: newId('request'), runId, stepId: null, t: over.t ?? 0, method: 'POST',
    url: server ? 'https://graph.facebook.com/v21.0/100000000000001/events' : 'https://www.facebook.com/tr/', resourceType: server ? 'fetch' : 'image',
    frameUrl: server ? null : 'http://localhost:3000/', initiator: server ? 'serverContainer' : null, headers: {}, postData: null, outcome: 'stubbed',
    ...(server && { captured: 'serverContainer' as const }),
  };
  const hit: Hit = {
    type: 'hit', id: newId('hit'), runId, stepId: null, requestId: req.id, t: 0, vendor: 'meta', event: 'Purchase',
    consent: unknown, ids: {}, page: null, transport: 'image', params: {}, fields: [], idFields: [], fieldsComplete: true, ...over,
  };
  return { hit, req };
}

const browser = (t: number, over: Partial<Hit> = {}) => pair({ t, ...over }, false);

function capi(t: number, via: HitVia | undefined, over: Partial<Hit> = {}): Pair {
  return pair({ t, vendor: 'meta-capi', transport: 'POST', fields: ['user_data.em[]'], idFields: ['user_data.em[]'], ...(via && { via }), ...over }, true);
}

const link = (to: Pair, confidence: HitVia['confidence']): HitVia => ({ hitId: to.hit.id, by: 'eventId', confidence });

function step(label: string, startedAt: number, endedAt: number): Step {
  return { type: 'step', id: newId('step'), runId, index: 0, kind: 'wait', label, startedAt, endedAt } as unknown as Step;
}

function run(yaml: string, pairs: Pair[], extra: unknown[] = []): Result[] {
  const records = [...pairs.flatMap((p) => [p.hit, p.req]), ...epochs, ...extra];
  return evaluate(records as never, parseScenario(`start: /\n${yaml}`), { identity });
}

const check = (results: Result[], name: string) => results.find((r) => r.expectation === `builtin: ${name}`)!;

describe('judgedAt', () => {
  test('a browser hit keeps its own time, a linked server hit takes its via hit, an unlinked one has none', () => {
    const via = browser(500);
    const linked = capi(1500, link(via, 'exact'));
    const unlinked = capi(1600, undefined);
    const index = judgeIndex([via.hit, linked.hit, unlinked.hit], [via.req, linked.req, unlinked.req]);
    expect(judgedAt(via.hit, index)).toBe(500);
    expect(judgedAt(linked.hit, index)).toBe(500);
    expect(judgedAt(unlinked.hit, index)).toBeUndefined();
  });

  test('a link to a hit that is not in the record counts as unlinked', () => {
    const lost = capi(1500, { hitId: newId('hit'), by: 'eventId', confidence: 'exact' });
    expect(judgedAt(lost.hit, judgeIndex([lost.hit], [lost.req]))).toBeUndefined();
  });

  test('placeHitsInEpochs and effectiveConsentAt use it', () => {
    const via = browser(500);
    const linked = capi(1500, link(via, 'exact'));
    const index = judgeIndex([via.hit, linked.hit], [via.req, linked.req]);
    expect(epochForHit(epochs, linked.hit.t)?.label).toBe('granted');
    expect(placeHitsInEpochs([linked.hit], epochs, 50, index).get(linked.hit)?.label).toBe('denied');
    expect(effectiveConsentAt(linked.hit, epochs, 50, index).adUserData).toBe('denied');
    const unlinked = capi(1500, undefined);
    const none: ConsentState = effectiveConsentAt(unlinked.hit, epochs, 50, judgeIndex([unlinked.hit], [unlinked.req]));
    expect(none.adUserData).toBe('unknown');
  });
});

describe('deniedIdentifiers on a server hit', () => {
  test('an exact link to a hit in the denied epoch fails, though the server hit was sent in the granted one', () => {
    const via = browser(500);
    const sent = capi(1500, link(via, 'exact'));
    expect(epochForHit(epochs, sent.hit.t)?.label).not.toBe(epochForHit(epochs, via.hit.t)?.label);
    const result = check(run('', [via, sent]), 'deniedIdentifiers');
    expect(result.pass).toBe(false);
    expect(result.severity).toBe('fail');
    expect(result.note).toBeUndefined();
    expect(result.evidence).toEqual([sent.hit.id]);
    expect(result.message).toContain('meta-capi');
  });

  test('a probable link fails at warn with the note serverSendProbableLink', () => {
    const via = browser(500);
    const sent = capi(1500, link(via, 'probable'));
    const result = check(run('', [via, sent]), 'deniedIdentifiers');
    expect(result).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendProbableLink', evidence: [sent.hit.id] });
  });

  test('a probable link next to an exact one still fails', () => {
    const via = browser(500);
    const results = run('', [via, capi(1500, link(via, 'probable')), capi(1600, link(via, 'exact'))]);
    expect(check(results, 'deniedIdentifiers')).toMatchObject({ pass: false, severity: 'fail' });
  });

  test('a probable leak next to an unlinked hit with identifiers warns with serverSendUnlinked', () => {
    const via = browser(500);
    const probable = capi(1200, link(via, 'probable'));
    const unlinked = capi(1300, undefined);
    const result = check(run('', [via, probable, unlinked]), 'deniedIdentifiers');
    expect(result).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked' });
    expect(result.evidence).toEqual(expect.arrayContaining([probable.hit.id, unlinked.hit.id]));
    expect(result.message).toContain('Cannot evaluate');
  });

  test('an exact leak next to a probable one and an unlinked hit still fails', () => {
    const via = browser(500);
    const results = run('', [via, capi(1200, link(via, 'probable')), capi(1250, link(via, 'exact')), capi(1300, undefined)]);
    expect(check(results, 'deniedIdentifiers')).toMatchObject({ pass: false, severity: 'fail' });
  });

  test('a link to a hit in the granted epoch passes, though the server hit was sent in the denied one', () => {
    const via = browser(1200);
    const sent = capi(500, link(via, 'exact'));
    expect(epochForHit(epochs, sent.hit.t)?.label).toBe('denied');
    const result = check(run('', [via, sent]), 'deniedIdentifiers');
    expect(result.pass).toBe(true);
    expect(result.note).toBeUndefined();
  });

  test('a hit with no link cannot be judged: cannot evaluate at warn with the note serverSendUnlinked', () => {
    const sent = capi(500, undefined);
    const results = run('', [browser(100), sent]);
    for (const name of ['deniedIdentifiers', 'earlyIdentifiers']) {
      expect(check(results, name)).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked', evidence: [sent.hit.id] });
    }
  });

  test('an unreadable browser hit keeps its result and severity next to an unlinked server hit', () => {
    const cut = browser(500, { vendor: 'meta', fieldsComplete: false, fields: ['ev'], idFields: [] });
    const unlinked = capi(600, undefined);
    const result = check(run('', [cut, unlinked]), 'deniedIdentifiers');
    expect(result).toMatchObject({ pass: false, severity: 'fail', note: 'cannotEvaluateBody' });
    expect(result.evidence).toEqual(expect.arrayContaining([cut.hit.id, unlinked.hit.id]));
  });

  test('an unreadable browser hit keeps its severity next to a probable server hit that leaks', () => {
    const via = browser(500);
    const sent = capi(1500, link(via, 'probable'));
    const cut = browser(600, { vendor: 'meta', fieldsComplete: false, fields: ['ev'], idFields: [] });
    const result = check(run('', [via, sent, cut]), 'deniedIdentifiers');
    expect(result).toMatchObject({ pass: false, severity: 'fail' });
    expect(result.note).toBeUndefined();
    expect(check(run('', [via, sent]), 'deniedIdentifiers')).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendProbableLink' });
  });

  test('a pass that rests on a probable link carries the note', () => {
    const via = browser(1200);
    const sent = capi(500, link(via, 'probable'));
    const results = run('', [via, sent]);
    expect(check(results, 'deniedIdentifiers')).toMatchObject({ pass: true, note: 'serverSendProbableLink' });
    const exact = run('', [via, capi(500, link(via, 'exact'))]);
    expect(check(exact, 'deniedIdentifiers').note).toBeUndefined();
  });

  test('an unlinked hit with no identifiers leaves the checks alone', () => {
    const quiet = capi(500, undefined, { fields: ['event_name'], idFields: [] });
    const results = run('', [quiet]);
    expect(check(results, 'deniedIdentifiers').pass).toBe(true);
    expect(check(results, 'earlyIdentifiers').pass).toBe(true);
  });
});

describe('rules on a server hit', () => {
  const rule = (yaml: string, pairs: Pair[], extra: unknown[] = []) => run(`expect:\n${yaml}`, pairs, extra)[0]!;

  test('in: epoch(denied) uses the via hit time, not the server hit time', () => {
    const via = browser(500);
    const sent = capi(1500, link(via, 'exact'));
    const text = '  mustNot:\n    - { vendor: meta-capi, in: epoch(denied) }';
    expect(rule(text, [via, sent])).toMatchObject({ pass: false, evidence: [sent.hit.id] });
    expect(rule('  must:\n    - { vendor: meta-capi, in: epoch(granted) }', [via, sent]).pass).toBe(false);
  });

  test('after: uses the via hit time', () => {
    const via = browser(500);
    const sent = capi(1500, link(via, 'exact'));
    const go = step('go', 0, 800);
    expect(sent.hit.t).toBeGreaterThanOrEqual(go.endedAt!);
    const text = 'steps:\n  - { wait: 1s, label: go }\nexpect:\n  mustNot:\n    - { vendor: meta-capi, after: go }';
    expect(run(text, [via, sent], [go])[0]!.pass).toBe(true);
  });

  test('a failing mustNot on a probable link warns, a passing must on one carries the note', () => {
    const via = browser(500);
    const sent = capi(1500, link(via, 'probable'));
    expect(rule('  mustNot:\n    - { vendor: meta-capi, in: epoch(denied) }', [via, sent])).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendProbableLink' });
    expect(rule('  must:\n    - { vendor: meta-capi, in: epoch(denied) }', [via, sent])).toMatchObject({ pass: true, note: 'serverSendProbableLink' });
  });

  test('a probable link does not soften a verdict that does not depend on time', () => {
    const via = browser(500);
    const sent = capi(1500, link(via, 'probable'), { page: 'https://shop.example/web-pixels@abc/sandbox/modern/' });
    const flag = { type: 'flag', id: newId('flag'), runId, kind: 'possibleRealData', recordIds: [sent.req.id, sent.hit.id], detail: 'a foreign email' };
    const results = run('expect:\n  mustNot:\n    - { vendor: meta-capi }', [via, sent], [flag]);
    expect(results[0]).toMatchObject({ pass: false });
    expect(results[0]!.severity).toBeUndefined();
    expect(results[0]!.note).toBeUndefined();
    expect(check(results, 'possibleRealData')).toMatchObject({ pass: false, severity: 'fail' });
    expect(check(results, 'possibleRealData').note).toBeUndefined();
    expect(check(results, 'sandboxPageUrl')).toMatchObject({ pass: false, severity: 'fail' });
    expect(check(results, 'sandboxPageUrl').note).toBeUndefined();
  });

  test('a consent-scoped rule that meets an unlinked hit cannot be judged', () => {
    const sent = capi(1500, undefined);
    expect(rule('  mustNot:\n    - { vendor: meta-capi, in: epoch(denied) }', [sent])).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked', evidence: [sent.hit.id] });
    expect(rule('  must:\n    - { vendor: meta-capi, consent.adUserData: granted }', [sent])).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked' });
  });

  test('a scoped mustNot that passes on a probable link carries the note', () => {
    const via = browser(1200);
    const sent = capi(500, link(via, 'probable'));
    expect(rule('  mustNot:\n    - { vendor: meta-capi, in: epoch(denied) }', [via, sent])).toMatchObject({ pass: true, note: 'serverSendProbableLink' });
  });

  test('a failing must stays as it is when an unlinked hit could not change it', () => {
    const unlinked = capi(1500, undefined);
    const wrong = browser(1200, { vendor: 'meta-capi', params: { em: 'a'.repeat(64) }, fields: ['em'], idFields: ['em'] });
    const hashes = rule('  must:\n    - { vendor: meta-capi, in: epoch(granted), identity.hashesMatch: true }', [wrong, unlinked]);
    expect(hashes.pass).toBe(false);
    expect(hashes.note).toBeUndefined();
    expect(hashes.severity).toBeUndefined();
    const overflow = rule('  must:\n    - { vendor: meta-capi, in: epoch(granted), count: 0 }', [browser(1100, { vendor: 'meta-capi' }), unlinked]);
    expect(overflow.pass).toBe(false);
    expect(overflow.note).toBeUndefined();
    expect(overflow.severity).toBeUndefined();
  });

  test('a scoped hashesMatch must on a probable link with a wrong hash still fails', () => {
    const via = browser(1200);
    const sent = capi(1300, link(via, 'probable'), { params: { 'user_data.em[]': 'a'.repeat(64) } });
    const result = rule('  must:\n    - { vendor: meta-capi, in: epoch(granted), identity.hashesMatch: true }', [via, sent]);
    expect(result.pass).toBe(false);
    expect(result.severity).toBeUndefined();
    expect(result.note).toBeUndefined();
  });

  test('a failing scoped must does not fail on an unlinked hit that is sent after the epoch', () => {
    const sent = capi(1500, undefined);
    expect(rule('  must:\n    - { vendor: meta-capi, in: epoch(denied) }', [sent])).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked' });
  });

  test('a passing scoped must with an upper count bound cannot be judged against an unlinked hit', () => {
    const via = browser(1100, { vendor: 'meta-capi' });
    const sent = capi(500, undefined);
    expect(rule('  must:\n    - { vendor: meta-capi, in: epoch(granted), count: \'<= 1\' }', [via, sent])).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked' });
  });

  test('an exact count that one of two unlinked hits would meet cannot be judged', () => {
    const results = rule('  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 1 }', [capi(500, undefined), capi(600, undefined)]);
    expect(results).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked' });
  });

  describe('an exact count tries every placement of the unlinked hits', () => {
    const wrongEm = { fields: ['em'], params: { em: 'a'.repeat(64) } };
    const rightEm = { fields: ['em'], params: { em: hashEmail(identity.email).hex } };
    const only = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 1, body.only: [event_name] }';
    const hashes = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 1, identity.hashesMatch: true }';
    const plain = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 1 }';
    const dirty = { fields: ['event_name', 'email'], idFields: [] };
    const clean = { fields: ['event_name'], idFields: [] };

    // Invariant: a hard verdict needs every placement of the unlinked hits to give it. Each row has an A and a B, both unlinked.
    const table: { shape: string; yaml: string; a: Partial<Hit>; b: Partial<Hit>; warns: boolean }[] = [
      { shape: 'plain count, two hits', yaml: plain, a: {}, b: {}, warns: true },
      { shape: 'body.only, A outside and B clean', yaml: only, a: dirty, b: clean, warns: true },
      { shape: 'body.only, A clean and B outside', yaml: only, a: clean, b: dirty, warns: true },
      { shape: 'body.only, both outside', yaml: only, a: dirty, b: dirty, warns: false },
      { shape: 'hashesMatch, A wrong and B right', yaml: hashes, a: wrongEm, b: rightEm, warns: true },
      { shape: 'hashesMatch, both wrong', yaml: hashes, a: wrongEm, b: wrongEm, warns: false },
    ];
    test.each(table)('$shape', ({ yaml, a, b, warns }) => {
      const result = rule(yaml, [capi(500, undefined, a), capi(600, undefined, b)]);
      expect(result.pass).toBe(false);
      if (warns) expect(result).toMatchObject({ severity: 'warn', note: 'serverSendUnlinked' });
      else expect(result.note).toBeUndefined();
    });

    test('with more than 10 unlinked hits in scope it warns without a search', () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => capi(100 + i, undefined, { ...dirty }));
      expect(rule(only, many(10)).note).toBeUndefined();
      expect(rule(only, many(11))).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked' });
    });
  });

  describe('an exact count tries every placement of the probable links', () => {
    const exact = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 1 }';

    test('a failing count that one hit placed by its own time would meet warns', () => {
      const viaX = browser(500);
      const viaY = browser(600);
      const results = rule(exact, [viaX, viaY, capi(1500, link(viaX, 'probable')), capi(1600, link(viaY, 'probable'))]);
      expect(results).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendProbableLink' });
    });

    test('a passing count that one hit placed by its own time would break carries the note', () => {
      const viaX = browser(500);
      const viaY = browser(1200);
      const direct = browser(100, { vendor: 'meta-capi' });
      const two = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 2 }';
      const results = rule(two, [direct, viaX, viaY, capi(1500, link(viaX, 'probable')), capi(600, link(viaY, 'probable'))]);
      expect(results).toMatchObject({ pass: true, note: 'serverSendProbableLink' });
    });

    test('a count that every placement gives the same verdict for has no note', () => {
      const viaX = browser(500);
      const viaY = browser(600);
      const three = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 3 }';
      const results = rule(three, [viaX, viaY, capi(100, link(viaX, 'probable')), capi(200, link(viaY, 'probable'))]);
      expect(results.pass).toBe(false);
      expect(results.note).toBeUndefined();
    });

    test('a count that leaving out one of two probable hits would meet warns', () => {
      const viaX = browser(500);
      const viaY = browser(600);
      const results = rule(exact, [viaX, viaY, capi(100, link(viaX, 'probable')), capi(200, link(viaY, 'probable'))]);
      expect(results).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendProbableLink' });
    });

    test('a failing count with a direct browser hit next to a probable hit warns when moving it would meet the count', () => {
      const direct = browser(100, { vendor: 'meta-capi' });
      const viaX = browser(500);
      const results = rule(exact, [direct, viaX, capi(1500, link(viaX, 'probable'))]);
      expect(results).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendProbableLink' });
    });

    test('probable hits outside the rule scope do not make a failing count warn', () => {
      const vias = Array.from({ length: 7 }, (_, i) => browser(500 + i));
      const other = vias.map((v, i) => capi(1500 + i, link(v, 'probable'), { vendor: 'ga4' }));
      const results = rule(exact, [...vias, ...other]);
      expect(results.pass).toBe(false);
      expect(results.note).toBeUndefined();
    });

    test('a count that only an unlinked and a probable hit placed together would meet warns', () => {
      const via = browser(1200, { vendor: 'ga4' });
      const two = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 2 }';
      const results = rule(two, [via, capi(500, link(via, 'probable')), capi(600, undefined)]);
      expect(results).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked' });
    });

    describe('a hit placed by its own time alone changes the verdict', () => {
      const onlyOne = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 1, body.only: [event_name] }';
      const hashOne = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 1, identity.hashesMatch: true }';
      const cleanBody = { fields: ['event_name'], idFields: [] };
      const rightEm = { fields: ['em'], params: { em: hashEmail(identity.email).hex } };
      const table: { shape: string; yaml: string; own: Partial<Hit>; warns: boolean }[] = [
        { shape: 'plain count', yaml: exact, own: {}, warns: true },
        { shape: 'body.only, a clean hit', yaml: onlyOne, own: cleanBody, warns: true },
        { shape: 'identity.hashesMatch, a right hash', yaml: hashOne, own: rightEm, warns: true },
        { shape: 'body.only, a dirty hit', yaml: onlyOne, own: { fields: ['event_name', 'email'], idFields: [] }, warns: false },
      ];
      test.each(table)('a hit linked into granted and sent in denied: $shape', ({ yaml, own, warns }) => {
        const later = browser(1200);
        const sent = capi(600, link(later, 'probable'), own);
        expect(judgedAt(sent.hit, judgeIndex([later.hit, sent.hit], [later.req, sent.req]))).toBe(1200);
        const result = rule(yaml, [later, sent]);
        expect(result.pass).toBe(false);
        if (warns) expect(result).toMatchObject({ severity: 'warn', note: 'serverSendProbableLink' });
        else expect(result.note).toBeUndefined();
      });

      test('a passing count that the hit placed by its own time would break carries the note', () => {
        const later = browser(1200);
        const direct = browser(100, { vendor: 'meta-capi' });
        const results = rule(exact, [direct, later, capi(600, link(later, 'probable'))]);
        expect(results).toMatchObject({ pass: true, note: 'serverSendProbableLink' });
      });
    });

    describe('every placement is tried up to 10 hits', () => {
      const only = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 1, body.only: [event_name] }';
      const dirty = { fields: ['event_name', 'email'], idFields: [] };
      const probables = (n: number) => {
        const vias = Array.from({ length: n }, (_, i) => browser(500 + i));
        return [...vias, ...vias.map((v, i) => capi(1500 + i, link(v, 'probable'), dirty))];
      };

      test('10 dirty probable hits fail, 11 warn', () => {
        const ten = rule(only, probables(10));
        expect(ten.pass).toBe(false);
        expect(ten.severity).not.toBe('warn');
        expect(ten.note).toBeUndefined();
        expect(rule(only, probables(11))).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendProbableLink' });
      });

      test('4 dirty unlinked and 4 dirty probable hits fail', () => {
        const unlinked = Array.from({ length: 4 }, (_, i) => capi(100 + i, undefined, dirty));
        const result = rule(only, [...probables(4), ...unlinked]);
        expect(result.pass).toBe(false);
        expect(result.severity).not.toBe('warn');
        expect(result.note).toBeUndefined();
      });

      test('an exact browser leak next to 7 probable hits still fails a count of 0', () => {
        const zero = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: 0 }';
        const result = rule(zero, [browser(100, { vendor: 'meta-capi' }), ...probables(7)]);
        expect(result.pass).toBe(false);
        expect(result.severity).not.toBe('warn');
        expect(result.note).toBeUndefined();
      });
    });

    describe('an at-least count places each probable hit by its link or its own time', () => {
      const atLeastTwo = '  must:\n    - { vendor: meta-capi, in: epoch(denied), count: ">= 2" }';

      test('one hit by its link and one by its own time meet it', () => {
        const viaX = browser(500);
        const viaY = browser(1200);
        const results = rule(atLeastTwo, [viaX, viaY, capi(1500, link(viaX, 'probable')), capi(600, link(viaY, 'probable'))]);
        expect(results).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendProbableLink' });
      });

      test('an unlinked and a probable hit placed together meet it', () => {
        const via = browser(1200);
        const results = rule(atLeastTwo, [via, capi(600, link(via, 'probable')), capi(700, undefined)]);
        expect(results).toMatchObject({ pass: false, severity: 'warn', note: 'serverSendUnlinked' });
      });

      test('two hits that no placement can bring into scope fail', () => {
        const viaX = browser(1200);
        const viaY = browser(1300);
        const result = rule(atLeastTwo, [viaX, viaY, capi(1500, link(viaX, 'probable')), capi(1600, link(viaY, 'probable'))]);
        expect(result.pass).toBe(false);
        expect(result.note).toBeUndefined();
      });
    });
  });

  test('a rule without a consent scope counts an unlinked hit as it does any other', () => {
    const sent = capi(1500, undefined);
    expect(rule('  must:\n    - { vendor: meta-capi }', [sent])).toMatchObject({ pass: true });
    const found = rule('  mustNot:\n    - { vendor: meta-capi }', [sent]);
    expect(found.pass).toBe(false);
    expect(found.severity).toBeUndefined();
  });

  test('before: consent never takes an unlinked hit as early', () => {
    const sent = capi(1500, undefined);
    const results = run('expect:\n  mustNot:\n    - { vendor: meta-capi, before: consent }', [sent]);
    expect(results[0]).toMatchObject({ note: 'serverSendUnlinked' });
  });
});
