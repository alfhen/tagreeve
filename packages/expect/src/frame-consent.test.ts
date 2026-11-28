import { newId, type DataLayerEvent } from '@tagreeve/core';
import { expect, test } from 'vitest';
import { frameConsent as replay_ } from './frame-consent.ts';

const frameConsent = (events: DataLayerEvent[], n = 0, layer?: string) => replay_(events, n, layer);

const runId = newId('run');

function push(t: number, args: unknown[], over: Partial<DataLayerEvent> = {}): DataLayerEvent {
  return { type: 'dataLayerEvent', id: newId('dataLayerEvent'), runId, stepId: null, t, event: null, gtmUniqueEventId: null, args, isConsentCommand: false, frame: { main: true, n: 0 }, ...over };
}

const denied = { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };

test('the state at a time names the command and the push that set each signal', () => {
  const def = push(10, ['consent', 'default', denied]);
  const upd = push(20, ['consent', 'update', { analytics_storage: 'granted' }]);
  const replay = frameConsent([def, upd]);
  expect(replay.stateAt(15).state).toEqual({ analytics: 'denied', ads: 'denied', adUserData: 'denied', adPersonalization: 'denied' });
  expect(replay.stateAt(15).setBy.analytics).toEqual({ command: 'default', id: def.id });
  const after = replay.stateAt(25);
  expect(after.state.analytics).toBe('granted');
  expect(after.state.ads).toBe('denied');
  expect(after.setBy.analytics).toEqual({ command: 'update', id: upd.id });
  expect(after.setBy.ads).toEqual({ command: 'default', id: def.id });
});

test('the state before any command is unknown, and the time bound can be exclusive', () => {
  const upd = push(20, ['consent', 'update', { ad_storage: 'granted' }]);
  const replay = frameConsent([upd]);
  expect(replay.stateAt(19).state.ads).toBe('unknown');
  expect(replay.stateAt(19).setBy).toEqual({});
  expect(replay.stateAt(20).state.ads).toBe('granted');
  expect(replay.stateAt(20, false).state.ads).toBe('unknown');
});

test('an object-form update is counted', () => {
  const upd = push(20, [{ 0: 'consent', 1: 'update', 2: { ad_storage: 'granted' } }]);
  const replay = frameConsent([push(10, ['consent', 'default', denied]), upd]);
  expect(replay.stateAt(30).state.ads).toBe('granted');
  expect(replay.stateAt(30).setBy.ads).toEqual({ command: 'update', id: upd.id });
});

test('the times of every consent command are listed, also the ones the replay leaves out', () => {
  const events = [
    push(10, ['consent', 'default', { ...denied, region: ['DK'] }]),
    push(15, ['config', 'G-PWTEST0001']),
    push(20, ['consent', 'update', { ad_storage: 'granted' }]),
    push(30, [{ 0: 'consent', 1: 'default', 2: denied }]),
  ];
  const replay = frameConsent(events);
  expect(replay.commandTimes).toEqual([10, 20, 30]);
  expect(replay.changes.map((c) => c.t)).toEqual([20]);
});

test('an update of another frame is not counted', () => {
  const counted = push(20, ['consent', 'update', { ad_storage: 'granted' }]);
  const other = push(20, ['consent', 'update', { ad_storage: 'granted' }], { frame: { main: false, n: 1 } });
  expect(counted.frame!.n).not.toBe(other.frame!.n);
  expect(frameConsent([counted]).stateAt(30).state.ads).toBe('granted');
  expect(frameConsent([other]).stateAt(30).state.ads).toBe('unknown');
  expect(frameConsent([other]).commandTimes).toEqual([]);
  expect(frameConsent([other], 1).stateAt(30).state.ads).toBe('granted');
});

test('an update of another layer is not counted', () => {
  const counted = push(20, ['consent', 'update', { ad_storage: 'granted' }]);
  const other = push(20, ['consent', 'update', { ad_storage: 'granted' }], { layer: 'myLayer' });
  expect(counted.layer).not.toBe(other.layer);
  expect(frameConsent([counted]).stateAt(30).state.ads).toBe('granted');
  expect(frameConsent([other]).stateAt(30).state.ads).toBe('unknown');
  expect(frameConsent([other]).commandTimes).toEqual([]);
  expect(frameConsent([other], 0, 'myLayer').stateAt(30).state.ads).toBe('granted');
});

test('a push with no frame belongs to no frame', () => {
  const old = push(20, ['consent', 'update', { ad_storage: 'granted' }]);
  delete old.frame;
  expect(frameConsent([old]).commandTimes).toEqual([]);
});
