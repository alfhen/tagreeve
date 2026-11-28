import { consentCommandOf, consentModeChanges, unknownConsent, type ConsentModeChange, type ConsentState, type DataLayerEvent } from '@tagreeve/core';

export const DEFAULT_LAYER = 'dataLayer';

/** What set a signal: the command and the ID of the push. */
export interface SignalSource {
  command: 'default' | 'update';
  id: string;
}

export interface FrameConsentState {
  state: ConsentState;
  /** Only the signals that a command set by that time. */
  setBy: Partial<Record<keyof ConsentState, SignalSource>>;
}

export interface FrameConsent {
  /** The changes of the replay, in order. Region defaults and defaults after an update are left out, as in design §7.3. */
  changes: readonly ConsentModeChange[];
  /** The time of every consent command of this frame and layer, including the ones the replay leaves out. */
  commandTimes: readonly number[];
  /** The state after every change at or before `t`, or before `t` when `inclusive` is false. */
  stateAt(t: number, inclusive?: boolean): FrameConsentState;
}

export function layerOf(event: Pick<DataLayerEvent, 'layer'>): string {
  return event.layer ?? DEFAULT_LAYER;
}

/** True when the push was made by that frame and layer. A push with no `frame` (a record before version 5) belongs to no frame. */
export function inFrameLayer(event: DataLayerEvent, frameN: number, layer: string): boolean {
  return event.frame?.n === frameN && layerOf(event) === layer;
}

/**
 * Replays the consent commands of one frame and one layer, in the array and the arguments-like object form.
 * Pushes of another frame or another layer are not counted.
 */
export function frameConsent(events: readonly DataLayerEvent[], frameN: number, layer: string = DEFAULT_LAYER): FrameConsent {
  const own = events.filter((e) => inFrameLayer(e, frameN, layer));
  const changes = consentModeChanges(own.map((e) => ({ t: e.t, id: e.id, args: e.args })), Infinity, { objectForm: true });
  const commandTimes = own.filter((e) => consentCommandOf(e.args) !== undefined).map((e) => e.t);
  return {
    changes,
    commandTimes,
    stateAt(t, inclusive = true) {
      let state = unknownConsent;
      const setBy: FrameConsentState['setBy'] = {};
      for (const change of changes) {
        if (inclusive ? change.t > t : change.t >= t) break;
        state = change.state;
        for (const field of Object.keys(change.signals) as (keyof ConsentState)[]) {
          if (change.id !== undefined) setBy[field] = { command: change.command, id: change.id };
        }
      }
      return { state, setBy };
    },
  };
}
