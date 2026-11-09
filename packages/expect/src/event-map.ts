import { ga4EventName } from '@tagreeve/decoders';
import { labelKind, type PushGroup } from './push-shape.ts';

/** A user map for `diff`: event renames, and key path renames inside one event. Paths are keyed by the event name after the rename. */
export interface EventMap {
  events: Record<string, string>;
  paths: Record<string, Record<string, string>>;
}

const EVENT_NAME = /^[A-Za-z0-9_.: -]{1,200}$/;
const PATH_NAME = /^[A-Za-z0-9_.()[\]*-]{1,200}$/;
const ROOT = '.';
const TOP_KEYS = new Set(['events', 'paths']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface KeyEntry {
  key: string;
  start: number;
  end: number;
}

// Reads the keys of the JSON object that starts at `from`, in the order written. The text has already passed JSON.parse, so it is well formed.
function objectEntries(text: string, from: number): KeyEntry[] {
  let i = from;
  const skipSpace = (): void => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const readString = (): string => {
    const begin = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(begin, i)) as string;
  };
  const skipValue = (): void => {
    skipSpace();
    const c = text[i];
    if (c === '"') {
      readString();
    } else if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      skipSpace();
      while (text[i] !== close) {
        if (c === '{') {
          readString();
          skipSpace();
          i++;
        }
        skipValue();
        skipSpace();
        if (text[i] === ',') i++;
        skipSpace();
      }
      i++;
    } else {
      while (i < text.length && !/[\s,}\]]/.test(text[i]!)) i++;
    }
  };
  const entries: KeyEntry[] = [];
  i++;
  skipSpace();
  while (text[i] !== '}') {
    const key = readString();
    skipSpace();
    i++;
    skipSpace();
    const start = i;
    skipValue();
    entries.push({ key, start, end: i });
    skipSpace();
    if (text[i] === ',') i++;
    skipSpace();
  }
  return entries;
}

const valueOf = (text: string, e: KeyEntry): unknown => JSON.parse(text.slice(e.start, e.end));

/** Parses the text of an event map file. An error names the file and a key position, and never key or value text. */
export function parseEventMap(text: string, file: string): EventMap {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${file}: the event map is not valid JSON.`);
  }
  if (!isRecord(json)) throw new Error(`${file}: the event map must be a JSON object.`);
  const top = objectEntries(text, text.indexOf('{'));
  top.forEach((e, i) => {
    if (!TOP_KEYS.has(e.key)) throw new Error(`${file}: top-level key ${i + 1} is not "events" or "paths".`);
  });
  const map: EventMap = { events: Object.create(null) as Record<string, string>, paths: Object.create(null) as Record<string, Record<string, string>> };
  const events = json.events ?? {};
  if (!isRecord(events)) throw new Error(`${file}: "events" must be an object.`);
  const eventsEntry = !isRecord(json.events) ? undefined : top.findLast((e) => e.key === 'events');
  (eventsEntry === undefined ? [] : objectEntries(text, eventsEntry.start)).forEach((e, i) => {
    const to = valueOf(text, e);
    if (!EVENT_NAME.test(e.key)) throw new Error(`${file}: "events" key ${i + 1} is not an event name.`);
    if (typeof to !== 'string' || !EVENT_NAME.test(to)) throw new Error(`${file}: "events" key ${i + 1} must map to an event name.`);
    map.events[e.key] = to;
  });
  const paths = json.paths ?? {};
  if (!isRecord(paths)) throw new Error(`${file}: "paths" must be an object.`);
  const pathsEntry = !isRecord(json.paths) ? undefined : top.findLast((e) => e.key === 'paths');
  (pathsEntry === undefined ? [] : objectEntries(text, pathsEntry.start)).forEach((e, i) => {
    const at = `"paths" key ${i + 1}`;
    const renames = valueOf(text, e);
    if (!EVENT_NAME.test(e.key)) throw new Error(`${file}: ${at} is not an event name.`);
    if (!isRecord(renames)) throw new Error(`${file}: ${at} must be an object.`);
    const out: Record<string, string> = Object.create(null) as Record<string, string>;
    const inner = objectEntries(text, e.start);
    if (inner.some((p) => p.key === ROOT) && inner.length > 1) throw new Error(`${file}: ${at} with the "${ROOT}" source key takes no other key.`);
    inner.forEach((p, j) => {
      const to = valueOf(text, p);
      if (!PATH_NAME.test(p.key)) throw new Error(`${file}: ${at}, key ${j + 1} is not a key path.`);
      if (typeof to !== 'string' || (to !== ROOT && !PATH_NAME.test(to))) throw new Error(`${file}: ${at}, key ${j + 1} must map to a key path.`);
      if (p.key === ROOT && to === ROOT) throw new Error(`${file}: ${at}, key ${j + 1} must name a key path to move the root under.`);
      out[p.key] = to;
    });
    map.paths[e.key] = out;
  });
  return map;
}

/** The built-in name, for a Shopify standard event. Consent commands and gtag commands keep their labels. */
export function builtInEventName(event: string): string {
  return labelKind(event) === 'event' ? ga4EventName(event) : event;
}

// A rename to "." moves the paths below the source to the root, and drops the source path itself. A rename from "." moves every root path under the target.
function renamePath(path: string, renames: Record<string, string>): string | undefined {
  const bySpecificity = Object.entries(renames).sort(([x], [y]) => y.length - x.length);
  for (const [from, to] of bySpecificity) {
    if (path === from) return to === ROOT ? undefined : to;
    if (path.startsWith(`${from}.`) || path.startsWith(`${from}[`)) {
      const rest = path.slice(from.length);
      return to === ROOT ? rest.replace(/^\./, '') : `${to}${rest}`;
    }
  }
  return path;
}

/** Renames the events and paths of push groups. Groups that end up with the same epoch, event and frame are merged by the comparison. */
export function mapPushGroups(
  groups: PushGroup[],
  rename: (event: string) => string,
  paths: EventMap['paths'] | undefined,
  pathKeys: (recorded: string, final: string) => string[],
): PushGroup[] {
  return groups.map((g) => {
    const event = rename(g.event);
    const key = pathKeys(g.event, event).find((k) => paths !== undefined && Object.hasOwn(paths, k));
    const renames = key === undefined ? undefined : paths?.[key];
    if (!renames) return { ...g, event };
    const under = Object.hasOwn(renames, ROOT) ? renames[ROOT]! : undefined;
    if (under !== undefined) {
      // A gtag event push has no `event` key; the object push it maps to has one.
      const moved = g.paths.map((p) => ({ ...p, path: p.path.startsWith('[') ? `${under}${p.path}` : `${under}.${p.path}` }));
      return { ...g, event, ...(g.kind === undefined ? {} : { kind: 'object' as const }), paths: g.paths.some((p) => p.path === 'event') ? g.paths : [{ path: 'event', types: ['string'] }, ...moved] };
    }
    // A root rename maps an object push to a gtag event push, which has no `event` key.
    const toGtag = Object.values(renames).includes(ROOT);
    const mapped: PushGroup['paths'] = [];
    for (const p of g.paths) {
      if (toGtag && p.path === 'event') continue;
      const path = renamePath(p.path, renames);
      if (path !== undefined) mapped.push({ ...p, path });
    }
    return { ...g, event, ...(toGtag && g.kind !== undefined ? { kind: 'gtag' as const } : {}), paths: mapped };
  });
}

/** The name an event has after the built-in table and a user map. */
export function mappedEventName(event: string, userMap?: EventMap): string {
  return builtInEventName(userEventName(event, userMap?.events));
}

function userEventName(event: string, user: Record<string, string> | undefined): string {
  const named = builtInEventName(event);
  return user !== undefined && Object.hasOwn(user, event) ? user[event]! : user !== undefined && Object.hasOwn(user, named) ? user[named]! : named;
}

// In a swap or a chain, a recorded name can also be the name another group ends up with. Its paths entry then belongs to that group, so a name that is a target of the user map only counts as a key when `own` lists it.
function pathKeysFor(userMap: EventMap | undefined, own: (recorded: string, final: string) => string[], fallback: (recorded: string) => string[]) {
  const targets = new Set(Object.values(userMap?.events ?? {}));
  return (recorded: string, final: string): string[] => [...own(recorded, final), ...fallback(recorded).filter((k) => !targets.has(k))];
}

/** Applies the built-in table, then a user map when there is one. The user map is for the older side of a diff. */
export function normalizePushGroups(groups: PushGroup[], userMap?: EventMap): PushGroup[] {
  const user = userMap?.events;
  const pathKeys = pathKeysFor(userMap, (recorded, final) => [final, userEventName(recorded, user)], (recorded) => [recorded]);
  return mapPushGroups(groups, (event) => mappedEventName(event, userMap), userMap?.paths, pathKeys);
}

/** Keeps the recorded names and applies only the user's path renames. */
export function keepPushGroups(groups: PushGroup[], userMap?: EventMap): PushGroup[] {
  const pathKeys = pathKeysFor(userMap, (recorded) => [recorded], (recorded) => [builtInEventName(recorded)]);
  return mapPushGroups(groups, (event) => event, userMap?.paths, pathKeys);
}
