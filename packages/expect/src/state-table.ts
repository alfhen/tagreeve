import type { Hit, HitIds, RunRecords } from '@tagreeve/core';
import { CONSENT_STATES, type ConsentState } from './consent-matrix.ts';
import { DEFAULT_GRACE_MS, epochForHit, judgeIndex, judgedAt } from './evaluate.ts';

export interface StateCell {
  hits: number;
  events: string[];
  fields: string[];
  ids: string[];
}

export interface NotInAccept {
  events: string[];
  fields: string[];
}

export interface VendorStates {
  vendor: string;
  states: Partial<Record<ConsentState, StateCell>>;
  /** Per state other than accept: the events and fields of this vendor that its accept cell lacks. All of them when accept has none of the vendor. Absent when no accept record exists. */
  notInAccept: Partial<Record<ConsentState, NotInAccept>>;
}

export interface StateTable {
  vendors: VendorStates[];
  /** Per state other than accept: the vendors that the accept records lack. */
  vendorsNotInAccept: Partial<Record<ConsentState, string[]>>;
}

export type RecordsByState = Partial<Record<ConsentState, readonly RunRecords[]>>;

const byName = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

function idNames(ids: HitIds): string[] {
  const names: string[] = [];
  for (const [name, value] of Object.entries(ids)) {
    if (value === true) names.push(name);
    else if (name === 'hashes' && value && typeof value === 'object') {
      for (const [hash, h] of Object.entries(value)) if (h.present) names.push(`hashes.${hash}`);
    }
  }
  return names;
}

/** The hits a state's column counts: every hit for accept, those outside a granted epoch for reject and none, and those in the withdrawn epoch for withdraw. */
function countedHits(state: ConsentState, run: RunRecords): Hit[] {
  if (state === 'accept') return run.hits;
  const epochs = [...run.consentEpochs].sort((a, b) => a.startT - b.startT);
  const index = judgeIndex(run.hits, run.requests);
  const grace = run.run.graceWindowMs ?? DEFAULT_GRACE_MS;
  return run.hits.filter((hit) => {
    const t = judgedAt(hit, index);
    const label = t === undefined ? undefined : epochForHit(epochs, t, grace)?.label;
    return state === 'withdraw' ? label === 'withdrawn' : label !== 'granted';
  });
}

interface Tally {
  hits: number;
  events: Set<string>;
  fields: Set<string>;
  ids: Set<string>;
}

/** What each vendor got in each consent state, and what the other states got that accept did not. Names and counts only. */
export function stateTable(records: RecordsByState): StateTable {
  const tallies = new Map<string, Partial<Record<ConsentState, Tally>>>();
  for (const state of CONSENT_STATES) {
    for (const run of records[state] ?? []) {
      for (const hit of countedHits(state, run)) {
        const row = tallies.get(hit.vendor) ?? tallies.set(hit.vendor, {}).get(hit.vendor)!;
        const tally = (row[state] ??= { hits: 0, events: new Set(), fields: new Set(), ids: new Set() });
        tally.hits++;
        if (hit.event) tally.events.add(hit.event);
        for (const f of hit.fields ?? []) tally.fields.add(f);
        for (const id of idNames(hit.ids)) tally.ids.add(id);
      }
    }
  }
  const vendors: VendorStates[] = [];
  const vendorsNotInAccept: Partial<Record<ConsentState, string[]>> = {};
  for (const vendor of [...tallies.keys()].sort(byName)) {
    const row = tallies.get(vendor)!;
    const states: VendorStates['states'] = {};
    const notInAccept: VendorStates['notInAccept'] = {};
    for (const state of CONSENT_STATES) {
      if ((records[state] ?? []).length === 0) continue;
      const tally = row[state];
      states[state] = { hits: tally?.hits ?? 0, events: [...(tally?.events ?? [])].sort(byName), fields: [...(tally?.fields ?? [])].sort(byName), ids: [...(tally?.ids ?? [])].sort(byName) };
      if (state === 'accept' || !tally || (records.accept ?? []).length === 0) continue;
      const accept = row.accept;
      notInAccept[state] = {
        events: [...tally.events].filter((e) => !accept?.events.has(e)).sort(byName),
        fields: [...tally.fields].filter((f) => !accept?.fields.has(f)).sort(byName),
      };
      if (!accept) (vendorsNotInAccept[state] ??= []).push(vendor);
    }
    vendors.push({ vendor, states, notInAccept });
  }
  return { vendors, vendorsNotInAccept };
}
