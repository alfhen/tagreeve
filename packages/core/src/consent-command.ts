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
