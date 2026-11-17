import { globToRegExp, type DataLayerEvent } from '@tagreeve/core';
import { pushShapeOf, type PushDescription } from './push-shape.ts';
import { countHolds, describeCount, type Rule } from './scenario.ts';

/** `**.name` matches `name` at any depth, on a dot boundary. Otherwise `*` matches any characters. */
export function fieldGlob(pattern: string): RegExp {
  if (!pattern.startsWith('**.')) return globToRegExp(pattern);
  return new RegExp(`^(?:.*\\.)?${globToRegExp(pattern.slice(3)).source.slice(1, -1)}$`);
}

export interface PushRuleInput {
  pushes: readonly DataLayerEvent[];
  /** Whether a push at this time is inside the rule's `before`, `in`, `after` and `from`. */
  inScope: (t: number) => boolean;
  /** The rule's scope as text, such as ` before consent`. */
  where: string;
  /** True when a `dataLayerIncomplete` or `dataLayerNotHooked` flag falls in the rule's scope. */
  hookIncomplete: boolean;
}

export interface PushRuleOutcome {
  pass: boolean;
  evidence: string[];
  message: string;
  severity?: 'warn';
}

interface Push {
  id: string;
  t: number;
  shape: PushDescription;
  /** The leaf paths of the shape plus every object and array on the way to a leaf. */
  paths: Map<string, Set<string>>;
}

function withContainers(leaves: Map<string, Set<string>>): Map<string, Set<string>> {
  const all = new Map<string, Set<string>>();
  const add = (path: string, types: Iterable<string>) => {
    const set = all.get(path) ?? all.set(path, new Set()).get(path)!;
    for (const t of types) set.add(t);
  };
  for (const [path, types] of leaves) {
    add(path, types);
    for (let i = 1; i < path.length; i++) {
      if (path[i] === '.') add(path.slice(0, i), ['object']);
      else if (path.startsWith('[*]', i)) add(path.slice(0, i), ['array']);
    }
  }
  return all;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : /(s|x|ch|sh)$/.test(word) ? 'es' : 's'}`;

function holdsPath(push: Push, matcher: RegExp): boolean {
  for (const path of push.paths.keys()) if (matcher.test(path)) return true;
  return false;
}

/** The types found at a path, or `absent`. Several paths that a glob matches give one list. */
function typesAt(push: Push, matcher: RegExp): string[] {
  const found = new Set<string>();
  for (const [path, types] of push.paths) if (matcher.test(path)) for (const t of types) found.add(t);
  return found.size === 0 ? ['absent'] : [...found].sort();
}

/** Reads key paths and types only, so no message or evidence holds a pushed value. */
export function evaluatePushRule(rule: Rule, input: PushRuleInput): PushRuleOutcome {
  const sel = rule.dataLayer!;
  const matching: Push[] = input.pushes
    .map((e) => {
      const shape = pushShapeOf(e);
      return { id: e.id, t: e.t, shape, paths: withContainers(shape.paths) };
    })
    .filter((p) => p.shape.event === sel.event && (sel.kind === undefined || p.shape.kind === sel.kind) && (sel.frame === undefined || p.shape.frame === sel.frame));
  const selected = matching.filter((p) => input.inScope(p.t));
  const { where } = input;
  const qualifiers = [sel.kind, sel.frame && `${sel.frame} frame`].filter(Boolean);
  const subject = `"${sel.event}" push${qualifiers.length ? ` (${qualifiers.join(', ')})` : ''}`;
  const before = `${matching.length} before narrowing`;
  const matchers = (sel.has ?? []).map(fieldGlob);

  if (rule.kind === 'mustNot') {
    const offenders = matchers.length ? selected.filter((p) => matchers.some((m) => holdsPath(p, m))) : selected;
    const holding = sel.has ? ` holding any of ${sel.has.join(', ')}` : '';
    const found = offenders.length === 0 ? 'found none' : `found ${plural(offenders.length, 'push')}`;
    const pass = offenders.length === 0;
    const warn = pass && input.hookIncomplete;
    if (warn) {
      return {
        pass: false,
        evidence: [],
        message: `Expected no ${subject}${holding}${where}, found none (${before}), but the pushes could not all be read: the dataLayer hook is incomplete here, so a push may have been missed.`,
        severity: 'warn',
      };
    }
    return { pass, evidence: offenders.map((p) => p.id), message: `Expected no ${subject}${holding}${where}, ${found} (${before}).` };
  }

  if (sel.types) {
    const problems: string[] = [];
    const evidence = new Set<string>();
    for (const [path, type] of Object.entries(sel.types)) {
      const matcher = fieldGlob(path);
      const found = new Map<string, number>();
      for (const p of selected) {
        const types = typesAt(p, matcher);
        if (types.length === 1 && types[0] === type) continue;
        evidence.add(p.id);
        const label = types.join(' or ');
        found.set(label, (found.get(label) ?? 0) + 1);
      }
      if (found.size) problems.push(`${path} should be ${type}, found ${[...found].map(([label, n]) => `${label} in ${plural(n, 'push')}`).join(', ')}`);
    }
    if (problems.length) {
      return { pass: false, evidence: [...evidence], message: `Expected every ${subject}${where} to have the types in dataLayer.types: ${problems.join('; ')} (${before}).` };
    }
  }

  const holders = matchers.length ? selected.filter((p) => matchers.every((m) => holdsPath(p, m))) : selected;
  const count = rule.count ?? { op: '>=' as const, n: 1 };
  const pass = countHolds(count, holders.length);
  const typed = sel.types ? ` with types ${Object.entries(sel.types).map(([path, type]) => `${path}: ${type}`).join(', ')}` : '';
  const holding = `${sel.has ? ` holding ${sel.has.join(', ')}` : ''}${typed}`;
  const unseenPushCouldBreak = sel.types !== undefined || count.op === '<=' || count.op === '<' || count.op === '=';
  if (pass && input.hookIncomplete && unseenPushCouldBreak) {
    return {
      pass: false,
      evidence: holders.map((p) => p.id),
      message: `Expected ${describeCount(count)} ${subject}${holding}${where}, found ${holders.length} of ${selected.length} (${before}), but the pushes could not all be read: the dataLayer hook is incomplete here, so a push may have been missed.`,
      severity: 'warn',
    };
  }
  return {
    pass,
    evidence: (pass ? holders : selected).map((p) => p.id),
    message: `Expected ${describeCount(count)} ${subject}${holding}${where}, found ${holders.length} of ${selected.length} (${before}).`,
  };
}
