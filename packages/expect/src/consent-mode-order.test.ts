import { newId, type ConsentEpoch, type ConsentState, type DataLayerEvent, type Hit, type Request, type Step } from '@tagreeve/core';
import { describe, expect, test } from 'vitest';
import { consentModeOrder, type ConsentModeOrder } from './consent-mode-order.ts';
import { epochForHit } from './evaluate.ts';
import { parseScenario, ScenarioError, type ConsentModeExpectation } from './scenario.ts';

const runId = newId('run');
const TID = 'G-PWTEST0001';

const MAIN = { main: true, n: 0 };
const SUB = { main: false, n: 1 };

const all = (v: 'granted' | 'denied' | 'unknown'): ConsentState => ({ analytics: v, ads: v, adUserData: v, adPersonalization: v });
const signals = (v: 'granted' | 'denied') => ({ ad_storage: v, analytics_storage: v, ad_user_data: v, ad_personalization: v });

function push(t: number, args: unknown[], over: Partial<DataLayerEvent> = {}): DataLayerEvent {
  return { type: 'dataLayerEvent', id: newId('dataLayerEvent'), runId, stepId: null, t, event: null, gtmUniqueEventId: null, args, isConsentCommand: false, frame: MAIN, ...over };
}

const config = (t: number, over: Partial<DataLayerEvent> = {}) => push(t, ['config', TID], over);
const dflt = (t: number, over: Partial<DataLayerEvent> = {}, body: Record<string, unknown> = signals('denied')) => push(t, ['consent', 'default', body], over);
const update = (t: number, over: Partial<DataLayerEvent> = {}, body: Record<string, unknown> = signals('granted')) => push(t, ['consent', 'update', body], over);

function hit(t: number, consent: Partial<ConsentState> = {}, over: Partial<Hit> & { gcd?: string } = {}): Hit {
  const { gcd, ...rest } = over;
  return {
    type: 'hit', id: newId('hit'), runId, stepId: null, requestId: 'req_none', t, vendor: 'ga4', event: 'page_view',
    consent: { ...all('unknown'), ...consent, raw: gcd ? { gcd } : {} },
    ids: {}, page: 'http://localhost:3000/', transport: 'image', params: { tid: TID }, ...rest,
  };
}

function epoch(over: Partial<ConsentEpoch> & Pick<ConsentEpoch, 'startT' | 'label'>): ConsentEpoch {
  return { type: 'consentEpoch', id: newId('consentEpoch'), runId, endT: null, source: 'banner', state: all('unknown'), ...over };
}

/** An undecided epoch that ends at `at`, then the decision. */
function decision(at: number, action: 'accept' | 'reject', over: Partial<ConsentEpoch> = {}): ConsentEpoch[] {
  const v = action === 'accept' ? 'granted' : 'denied';
  return [
    epoch({ startT: 0, endT: at, label: 'undecided', source: 'start', state: all('denied') }),
    epoch({ startT: at, label: v, state: all(v), ...over }),
  ];
}

interface Run {
  dataLayer?: DataLayerEvent[];
  hits?: Hit[];
  epochs?: ConsentEpoch[];
  expected?: ConsentModeExpectation;
}

function judge({ dataLayer = [], hits = [], epochs = [epoch({ startT: 0, label: 'undecided', source: 'start' })], expected }: Run): ConsentModeOrder | undefined {
  return consentModeOrder({ dataLayer, hits, epochs, epochAt: (t) => epochForHit(epochs, t, 50), expected });
}

const must = (r: ConsentModeOrder | undefined): ConsentModeOrder => {
  expect(r).toBeDefined();
  return r!;
};

describe('queue order', () => {
  test('a config command and then a default warns with the frame kind, the layer and both push IDs', () => {
    const c = config(10);
    const d = dflt(20);
    const r = must(judge({ dataLayer: [c, d] }));
    expect(r.pass).toBe(false);
    expect(r.message).toContain('main frame dataLayer');
    expect(r.evidence).toEqual([c.id, d.id]);
  });

  test('a default before config passes', () => {
    const r = must(judge({ dataLayer: [dflt(10), config(20)] }));
    expect(r.pass).toBe(true);
    expect(r.evidence).toEqual([]);
  });

  test('the arguments-like object form of the default counts', () => {
    const c = config(10);
    const d = push(20, [{ 0: 'consent', 1: 'default', 2: signals('denied') }]);
    expect(d.args[0]).not.toBeInstanceOf(Array);
    const r = must(judge({ dataLayer: [c, d] }));
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual([c.id, d.id]);
  });

  test('the arguments-like object form of config counts', () => {
    const c = push(10, [{ 0: 'config', 1: TID }]);
    const r = must(judge({ dataLayer: [c, dflt(20)] }));
    expect(r.pass).toBe(false);
  });

  test('gtm.js and then a default, with no config, passes and says order was not judged', () => {
    const gtm = push(5, [{ event: 'gtm.js', 'gtm.start': 5 }], { event: 'gtm.js' });
    const d = dflt(10);
    const hits = [hit(30, {}, { gcd: '13r3r3r3r5' })];
    const dataLayer = [gtm, d];
    expect(dataLayer.findIndex((e) => e.event === 'gtm.js')).toBeLessThan(dataLayer.indexOf(d));
    expect(dataLayer.some((e) => e.args[0] === 'config')).toBe(false);
    expect(hits[0]!.consent.raw.gcd).toBeDefined();
    const r = must(judge({ dataLayer, hits }));
    expect(r.pass).toBe(true);
    expect(r.message).toContain('order was not judged');
    expect(r.message).toContain('gtm.js came before the default');
  });
});

describe('queues of one frame and one layer', () => {
  test('a main frame with the default first and a sub frame with it late names only the sub frame', () => {
    const r = must(judge({ dataLayer: [dflt(10), config(20), config(30, { frame: SUB }), dflt(40, { frame: SUB })] }));
    expect(r.pass).toBe(false);
    expect(r.message).toContain('sub frame');
    expect(r.message).not.toContain('main frame');
  });

  test('two layers of one frame are judged apart', () => {
    const r = must(judge({ dataLayer: [dflt(10), config(20), config(30, { layer: 'myLayer' }), dflt(40, { layer: 'myLayer' })] }));
    expect(r.pass).toBe(false);
    expect(r.message).toContain('myLayer');
    expect(r.message).not.toContain('dataLayer');
  });

  test('a config in one frame is not paired with a default in another', () => {
    const lateInOneFrame = [config(10), dflt(20)];
    expect(must(judge({ dataLayer: lateInOneFrame })).pass).toBe(false);
    const c = config(10);
    const d = dflt(20, { frame: SUB });
    expect(c.frame!.main).toBe(true);
    expect(d.frame!.main).toBe(false);
    const r = must(judge({ dataLayer: [c, d] }));
    expect(r.message).not.toContain('after the first config');
    expect(r.pass).toBe(true);
  });

  test('a config in one layer is not paired with a default in another', () => {
    expect(must(judge({ dataLayer: [config(10), dflt(20)] })).pass).toBe(false);
    const c = config(10);
    const d = dflt(20, { layer: 'myLayer' });
    expect(c.layer).not.toBe(d.layer);
    const r = must(judge({ dataLayer: [c, d] }));
    expect(r.message).not.toContain('after the first config');
    expect(r.pass).toBe(true);
  });
});

describe('later documents', () => {
  const step = (t: number): Step => ({ type: 'step', id: newId('step'), runId, index: 1, label: 'visit-2', startedAt: t, endedAt: t + 5 });
  const documentRequest = (t: number): Request =>
    ({ type: 'request', id: newId('request'), runId, stepId: null, t, method: 'GET', url: 'http://localhost:3000/second', resourceType: 'document', frame: { main: true, n: 0 } }) as unknown as Request;

  function twoDocuments(second: (t: number) => DataLayerEvent[]) {
    const first = [dflt(10), config(20)];
    const later = second(100);
    const records = [...first, step(60), documentRequest(61), ...later];
    const between = records.filter((r) => r.type === 'step' || r.type === 'request');
    expect(between).toHaveLength(2);
    expect(between.every((r) => ('startedAt' in r ? r.startedAt : r.t) > 20 && ('startedAt' in r ? r.startedAt : r.t) < 100)).toBe(true);
    expect([...first, ...later].every((e) => e.frame!.main && layerOf(e) === 'dataLayer')).toBe(true);
    return [...first, ...later];
  }
  const layerOf = (e: DataLayerEvent) => e.layer ?? 'dataLayer';

  test('default, config, then default, config passes', () => {
    const r = must(judge({ dataLayer: twoDocuments((t) => [dflt(t), config(t + 10)]) }));
    expect(r.pass).toBe(true);
  });

  test('default, config, then config, default passes: only the first default and the first config are judged', () => {
    const r = must(judge({ dataLayer: twoDocuments((t) => [config(t), dflt(t + 10)]) }));
    expect(r.pass).toBe(true);
  });
});

describe('update gap', () => {
  const dataLayer = (updateT: number, over: Partial<DataLayerEvent> = {}) => [dflt(100), config(110), update(updateT, over)];
  const epochs = [...decision(1000, 'accept')];
  const slow = () => hit(1100, { analytics: 'denied' }, { gcd: '13p3p3p3p5' });

  test('a hit between the decision and the update warns with the hit ID', () => {
    const h = slow();
    const u = update(1300);
    const r = must(judge({ dataLayer: [dflt(100), config(110), u], hits: [h], epochs }));
    expect(h.t).toBeGreaterThan(epochs[1]!.startT);
    expect(h.t).toBeLessThan(u.t);
    expect(r.pass).toBe(false);
    expect(r.evidence).toContain(h.id);
    expect(r.message).toContain('sent after the decision and before the update');
    expect(r.message).toContain('analytics_storage');
  });

  test('the same hit after the update does not warn', () => {
    const h = { ...slow(), t: 1400 };
    const u = update(1300);
    expect(u.t).toBeLessThan(h.t);
    const r = must(judge({ dataLayer: [dflt(100), config(110), u], hits: [h], epochs }));
    expect(r.pass).toBe(true);
  });

  test('a hit that already says granted does not warn', () => {
    const h = hit(1100, { analytics: 'granted', ads: 'granted' }, { gcd: '13r3r3r3r5' });
    const u = update(1300);
    expect(h.t).toBeLessThan(u.t);
    expect(must(judge({ dataLayer: [dflt(100), config(110), u], hits: [h], epochs })).pass).toBe(true);
  });

  test('an update pushed only in a sub frame is not the update of the main frame', () => {
    const h = slow();
    const u = update(1300, { frame: SUB });
    expect(u.frame!.main).toBe(false);
    expect(h.t).toBeLessThan(u.t);
    const r = must(judge({ dataLayer: [dflt(100), config(110), u], hits: [h], epochs }));
    expect(r.pass).toBe(true);
    expect(r.message).not.toContain('before the update');
  });

  test('an accept with a default pushed and no update push passes and says the update was not in the dataLayer', () => {
    const d = dflt(100);
    const dl = [d, config(110)];
    expect(dl.some((e) => consentUpdate(e))).toBe(false);
    const r = must(judge({ dataLayer: dl, epochs }));
    expect(r.pass).toBe(true);
    expect(r.message).toContain('update was not in the dataLayer');
  });

  test('a hit of another vendor in the same place does not warn', () => {
    const h = hit(1100, { analytics: 'denied' }, { vendor: 'meta' });
    const u = update(1300);
    expect(h.vendor).toBe('meta');
    expect(h.t).toBeGreaterThan(epochs[1]!.startT);
    expect(h.t).toBeLessThan(u.t);
    expect(must(judge({ dataLayer: [dflt(100), config(110), u], hits: [h], epochs })).pass).toBe(true);
    expect(dataLayer(1300)).toHaveLength(3);
  });

  function consentUpdate(e: DataLayerEvent) {
    return e.args[0] === 'consent' && e.args[1] === 'update';
  }
});

describe('the expected default', () => {
  const grantsAds = { ad_storage: 'granted', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };

  test('a main frame default that grants ad_storage warns and names it', () => {
    const d = dflt(10, {}, grantsAds);
    const r = must(judge({ dataLayer: [d, config(20)], expected: { default: 'denied' } }));
    expect(r.pass).toBe(false);
    expect(r.message).toContain('ad_storage');
    expect(r.message).not.toContain('analytics_storage');
    expect(r.evidence).toEqual([d.id]);
  });

  test('a mapping states only the signals it names', () => {
    const d = dflt(10, {}, grantsAds);
    expect(must(judge({ dataLayer: [d, config(20)], expected: { default: { analytics_storage: 'denied' } } })).pass).toBe(true);
  });

  test('a region with only a global default warns', () => {
    const r = must(judge({ dataLayer: [dflt(10), config(20)], expected: { region: ['DK'] } }));
    expect(r.pass).toBe(false);
    expect(r.message).toContain('DK');
  });

  test('a region default pushed for the same codes passes, in any order of the codes', () => {
    const d = dflt(10, {}, { ...signals('denied'), region: ['US-CA', 'DK'] });
    const r = must(judge({ dataLayer: [d, config(20)], expected: { region: ['DK', 'US-CA'] } }));
    expect(r.pass).toBe(true);
  });

  test('a default pushed only in a sub frame is not compared', () => {
    const d = dflt(10, { frame: SUB }, grantsAds);
    expect(d.frame!.main).toBe(false);
    const r = must(judge({ dataLayer: [d, config(20, { frame: SUB })], expected: { default: 'denied' } }));
    expect(r.message).not.toContain('ad_storage');
    expect(r.pass).toBe(true);
  });
});

describe('mode', () => {
  const epochs = decision(1000, 'accept');
  const early = (consent: Partial<ConsentState> = {}) => hit(500, consent, { gcd: '13p3p3p3p5' });

  test('basic warns on a Google hit in the undecided epoch', () => {
    const h = early(all('denied'));
    expect(epochs[0]!.endT).toBe(1000);
    expect(epochAtUndecided(h.t)).toBe(true);
    const r = must(judge({ hits: [h], epochs, expected: { mode: 'basic' } }));
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual([h.id]);
  });

  test('advanced passes when the hit shows the denied default', () => {
    const r = must(judge({ hits: [early(all('denied'))], epochs, expected: { mode: 'advanced', default: 'denied' } }));
    expect(r.pass).toBe(true);
  });

  test('advanced warns when the hit grants a signal the default denies', () => {
    const h = early({ ...all('denied'), ads: 'granted' });
    const r = must(judge({ hits: [h], epochs, expected: { mode: 'advanced', default: 'denied' } }));
    expect(r.pass).toBe(false);
    expect(r.message).toContain('ad_storage');
    expect(r.evidence).toEqual([h.id]);
  });

  test('a hit of another vendor in the undecided epoch is not reported', () => {
    const h = hit(500, all('denied'), { vendor: 'meta' });
    expect(h.vendor).toBe('meta');
    expect(epochAtUndecided(h.t)).toBe(true);
    expect(must(judge({ hits: [h], epochs, expected: { mode: 'basic' } })).pass).toBe(true);
  });

  test('basic with a banner action and no consent push still warns for a Google hit before it', () => {
    const h = early();
    const dl: DataLayerEvent[] = [];
    expect(dl.some((e) => e.isConsentCommand)).toBe(false);
    const r = must(judge({ dataLayer: dl, hits: [h], epochs, expected: { mode: 'basic' } }));
    expect(r.pass).toBe(false);
    expect(r.evidence).toEqual([h.id]);
  });

  test.each(['basic', 'advanced'] as const)('mode %s with no end to the undecided epoch passes and says the decision was not seen', (mode) => {
    const open = [epoch({ startT: 0, label: 'undecided', source: 'start', state: all('denied') })];
    const h = early(all('denied'));
    const noUpdate = judge({ dataLayer: [dflt(10, {}, signals('denied')), config(20)], hits: [h], epochs: open, expected: { mode } });
    expect(must(noUpdate).pass).toBe(true);
    expect(noUpdate!.message).toContain('decision was not seen');
    const denying = update(300, {}, signals('denied'));
    expect(denying.args[2]).toEqual(signals('denied'));
    const keepsDenied = judge({ dataLayer: [dflt(10, {}, signals('denied')), config(20), denying], hits: [h], epochs: open, expected: { mode } });
    expect(must(keepsDenied).pass).toBe(true);
    expect(keepsDenied!.message).toContain('decision was not seen');
  });

  function epochAtUndecided(t: number): boolean {
    return epochForHit(epochs, t, 50)?.label === 'undecided';
  }
});

describe('the state after an accept or a reject', () => {
  test('an accept that grants a signal outside the accept list warns and names it', () => {
    const u = update(1300, {}, { analytics_storage: 'granted', ad_storage: 'granted' });
    const r = must(
      judge({
        dataLayer: [dflt(100, {}, signals('denied')), config(110), u],
        epochs: decision(1000, 'accept', { state: { ...all('denied'), analytics: 'granted', ads: 'granted' } }),
        expected: { accept: ['analytics_storage'] },
      }),
    );
    expect(r.pass).toBe(false);
    expect(r.message).toContain('ad_storage');
    expect(r.message).not.toContain('analytics_storage is');
    expect(r.evidence).toContain(u.id);
  });

  test('an accept that grants exactly the accept list passes', () => {
    const r = must(
      judge({
        dataLayer: [dflt(100, {}, signals('denied')), config(110), update(1300, {}, { analytics_storage: 'granted' })],
        epochs: decision(1000, 'accept', { state: { ...all('denied'), analytics: 'granted' } }),
        expected: { accept: ['analytics_storage'] },
      }),
    );
    expect(r.pass).toBe(true);
  });

  test('a reject with no update push passes when the default denies all four', () => {
    const dl: DataLayerEvent[] = [];
    expect(dl.some((e) => e.args[1] === 'update')).toBe(false);
    const r = must(judge({ dataLayer: dl, epochs: decision(1000, 'reject'), expected: { default: 'denied' } }));
    expect(r.pass).toBe(true);
    expect(r.message).toBe('no update was needed: the default denies all four');
  });

  test('with a granted default, a reject whose update denies all four passes', () => {
    const r = must(
      judge({
        dataLayer: [dflt(100, {}, signals('granted')), config(110), update(1300, {}, signals('denied'))],
        epochs: decision(1000, 'reject'),
        expected: { default: 'granted' },
      }),
    );
    expect(r.pass).toBe(true);
  });

  test('with a granted default, a reject whose update keeps ad_storage granted warns and names it', () => {
    const r = must(
      judge({
        dataLayer: [dflt(100, {}, signals('granted')), config(110), update(1300, {}, { analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })],
        epochs: decision(1000, 'reject'),
        expected: { default: 'granted' },
      }),
    );
    expect(r.pass).toBe(false);
    expect(r.message).toContain('ad_storage');
  });

  test('an accept with a default pushed and no update push passes, says so, and does not say the accept failed', () => {
    const dl = [dflt(100, {}, signals('denied'))];
    const epochs = decision(1000, 'accept');
    expect(epochs[1]!.label).toBe('granted');
    expect(dl.some((e) => e.args[1] === 'update')).toBe(false);
    const r = must(judge({ dataLayer: dl, epochs, expected: { accept: ['analytics_storage'] } }));
    expect(r.pass).toBe(true);
    expect(r.message).toContain('update was not in the dataLayer');
    expect(r.message).not.toMatch(/fail/i);
  });
});

describe('a default that is not in the dataLayer', () => {
  const hits = () => [hit(30, all('denied'), { gcd: '11p1p1p1p5' })];

  test('with the option set, hits that show a default pass and say it was set outside the dataLayer', () => {
    const h = hits();
    expect(h[0]!.consent.raw.gcd).toBe('11p1p1p1p5');
    const r = must(judge({ hits: h, expected: { default: 'denied' } }));
    expect(r.pass).toBe(true);
    expect(r.message).toContain('default was set outside the dataLayer');
    expect(r.message).toContain('no order was judged');
  });

  test('without the option the same run has no result', () => {
    const h = hits();
    expect(h.length).toBeGreaterThan(0);
    expect(judge({ hits: h })).toBeUndefined();
  });
});

describe('what has nothing to judge', () => {
  test('Google hits and no consent push give no result', () => {
    const hits = [hit(10, {}, { gcd: '13r3r3r3r5' }), hit(20, {}, { vendor: 'google-ads' })];
    const dl = [config(5), push(6, [{ event: 'gtm.js' }])];
    expect(hits.every((h) => h.vendor === 'ga4' || h.vendor === 'google-ads')).toBe(true);
    expect(dl.some((e) => e.args[0] === 'consent')).toBe(false);
    expect(judge({ dataLayer: dl, hits })).toBeUndefined();
  });

  test('a consent update with no default gives no result', () => {
    expect(judge({ dataLayer: [update(10)] })).toBeUndefined();
  });
});

describe('options.consentMode in a scenario', () => {
  const parse = (body: string) => parseScenario(`start: /x\noptions:\n  consentMode:${body}\n`);
  const issues = (body: string): string => {
    try {
      parse(body);
    } catch (e) {
      expect(e).toBeInstanceOf(ScenarioError);
      return (e as ScenarioError).message;
    }
    throw new Error('expected a ScenarioError');
  };

  test.each([
    ['not a mapping', ' basic', 'options.consentMode'],
    ['no key', ' {}', 'options.consentMode'],
    ['an unknown key', ' { foo: 1 }', 'foo'],
    ['a bad mode', ' { mode: hybrid }', 'consentMode.mode'],
    ['a bad default', ' { default: maybe }', 'consentMode.default'],
    ['an unknown signal in default', ' { default: { functionality_storage: denied } }', 'consentMode.default'],
    ['a bad value in default', ' { default: { ad_storage: yes } }', 'consentMode.default'],
    ['an unknown signal in accept', ' { accept: [security_storage] }', 'consentMode.accept'],
    ['a region that is not a code', ' { region: [denmark] }', 'consentMode.region'],
    ['21 regions', ` { region: [${Array.from({ length: 21 }, (_, i) => `D${String.fromCharCode(65 + (i % 26))}`).join(', ')}] }`, 'consentMode.region'],
  ])('%s is a scenario error that names the key', (_, body, key) => {
    expect(issues(body)).toContain(key);
  });

  test('a bad mode names both allowed forms', () => {
    const message = issues(' { mode: hybrid }');
    expect(message).toContain('basic');
    expect(message).toContain('advanced');
  });

  test('a valid mapping with all four keys parses', () => {
    const scenario = parse(' { mode: advanced, default: denied, accept: [analytics_storage], region: [DK, US-CA] }');
    expect(scenario.options.consentMode).toEqual({ mode: 'advanced', default: 'denied', accept: ['analytics_storage'], region: ['DK', 'US-CA'] });
  });

  test('a default mapping of the four signals parses', () => {
    const scenario = parse(' { default: { ad_storage: granted, analytics_storage: denied, ad_user_data: denied, ad_personalization: denied } }');
    expect(scenario.options.consentMode?.default).toEqual({ ad_storage: 'granted', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  });

  test('consentModeOrder is a builtin name that takes a severity', () => {
    const scenario = parseScenario('start: /x\noptions:\n  builtins: { consentModeOrder: fail }\n');
    expect(scenario.options.builtins).toEqual({ consentModeOrder: 'fail' });
  });
});

test('a planted value in an extra key of a consent push is not in the result', () => {
  const token = 'PWLEAK-M100-TOKEN';
  const d = dflt(20, {}, { ...signals('denied'), pw_note: token });
  expect(JSON.stringify(d.args)).toContain(token);
  const r = must(judge({ dataLayer: [config(10), d], expected: { default: 'denied' } }));
  expect(r.pass).toBe(false);
  expect(JSON.stringify(r)).not.toContain(token);
});
