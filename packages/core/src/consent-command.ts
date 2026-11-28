import type { ConsentState, ConsentValue, DataLayerEvent } from './records.ts';

const MAX_ARGUMENTS = 16;
const CONSENT_COMMANDS = new Set(['default', 'update']);

export interface ConsentCommand {
  command: 'default' | 'update';
  signals: unknown;
}

/** A gtag() call pushed as its `arguments` object is recorded as one plain object with the keys "0" to "n-1". Returns its items. Keys that start with `gtm.` are GTM's own stamps and are left out. */
export function argumentsListOf(args: readonly unknown[]): unknown[] | undefined {
  const [item] = args;
  if (args.length !== 1 || typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
  const keys = Object.keys(item).filter((k) => !k.startsWith('gtm.'));
  if (keys.length < 1 || keys.length > MAX_ARGUMENTS || !keys.every((k, i) => k === String(i))) return undefined;
  const list = keys.map((_, i) => (item as Record<string, unknown>)[String(i)]);
  return typeof list[0] === 'string' ? list : undefined;
}

/** Reads `consent default` and `consent update` from a record's args, in the array form and the arguments-like object form. */
export function consentCommandOf(args: readonly unknown[]): ConsentCommand | undefined {
  const list = typeof args[0] === 'string' ? args : argumentsListOf(args);
  if (list === undefined || list[0] !== 'consent' || typeof list[1] !== 'string' || !CONSENT_COMMANDS.has(list[1])) return undefined;
  return { command: list[1] as ConsentCommand['command'], signals: list[2] };
}

/**
 * A recorded dataLayer event, or any object with its `t` and `args`. Consent commands look like
 * `['consent', 'update', { analytics_storage: 'granted' }]`. `id` is the record ID of the push, when it has one.
 */
export type ConsentPush = Pick<DataLayerEvent, 't' | 'args'> & { id?: string };

export interface ConsentModeChange {
  t: number;
  command: 'default' | 'update';
  /** State after the command, with earlier commands merged in. */
  state: ConsentState;
  /** Only the signals this command set. */
  signals: Partial<ConsentState>;
  /** The ID of the push the change came from, when the push had one. */
  id?: string;
}

export const unknownConsent: ConsentState = {
  analytics: 'unknown',
  ads: 'unknown',
  adUserData: 'unknown',
  adPersonalization: 'unknown',
};

const signalToField = {
  analytics_storage: 'analytics',
  ad_storage: 'ads',
  ad_user_data: 'adUserData',
  ad_personalization: 'adPersonalization',
} as const satisfies Record<string, keyof ConsentState>;

function toValue(raw: unknown): ConsentValue {
  return raw === 'granted' || raw === 'denied' ? raw : 'unknown';
}

export interface ConsentModeChangesOptions {
  /** Also read a command pushed as an `arguments`-like object. Off by default: the epochs read the array form only. */
  objectForm?: boolean;
}

/** `firstDecisionT` is the time of the first banner action; defaults after it are ignored, as they are after an update. */
export function consentModeChanges(pushes: readonly ConsentPush[], firstDecisionT = Infinity, { objectForm = false }: ConsentModeChangesOptions = {}): ConsentModeChange[] {
  const changes: ConsentModeChange[] = [];
  let state = unknownConsent;
  let updated = false;
  const listOf = (push: ConsentPush): readonly unknown[] | undefined => (objectForm && typeof push.args[0] !== 'string' ? argumentsListOf(push.args) : push.args);
  const isUpdate = (push: ConsentPush) => listOf(push)?.[1] === 'update';
  // A default in the same tick as an update comes first, whatever order the recorder saw them in.
  for (const push of [...pushes].sort((a, b) => a.t - b.t || Number(isUpdate(a)) - Number(isUpdate(b)))) {
    const list = listOf(push);
    if (!Array.isArray(list)) continue;
    const [name, command, signals] = list;
    if (name !== 'consent' || (command !== 'default' && command !== 'update')) continue;
    if (typeof signals !== 'object' || signals === null) continue;
    // A region-scoped default applies to visitors elsewhere than the test machine may be; it is not the global state.
    if (command === 'default' && 'region' in signals) continue;
    // An update or banner decision wins over a later default, so a default after one must not leak into later states.
    if (command === 'default' && (updated || push.t > firstDecisionT)) continue;
    if (command === 'update') updated = true;
    const delta: Partial<ConsentState> = {};
    for (const [signal, field] of Object.entries(signalToField)) {
      if (signal in signals) delta[field] = toValue((signals as Record<string, unknown>)[signal]);
    }
    state = { ...state, ...delta };
    changes.push({ t: push.t, command, state, signals: delta, ...(push.id === undefined ? {} : { id: push.id }) });
  }
  return changes;
}
