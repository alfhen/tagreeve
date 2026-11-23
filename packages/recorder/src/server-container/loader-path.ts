import type { Request } from '@tagreeve/core';
import { unwrapStapeLoader } from '@tagreeve/decoders';

/** The paths of the stock image's GA4 client and Data Client. A loader value that decodes to any other path is sent unchanged. */
const SERVER_CLIENT_PATHS: ReadonlySet<string> = new Set(['/g/collect', '/data']);

export const STAPE_LOADER_LOSES = "what Stape's hosting layer does with a loader request: its own headers, Cookie Keeper and any change to the path or body";

export interface ContainerPath {
  pathAndQuery: string;
  unwrapped: boolean;
}

/** The path and query to send to the local container for a live request URL. Never throws. */
export function containerPathFor(url: string): ContainerPath {
  let live: URL;
  try {
    live = new URL(url);
  } catch {
    return { pathAndQuery: url, unwrapped: false };
  }
  const unchanged = { pathAndQuery: `${live.pathname}${live.search}`, unwrapped: false };
  const real = unwrapStapeLoader({ url } as Request);
  if (!real) return unchanged;
  try {
    const target = new URL(real.url);
    if (!SERVER_CLIENT_PATHS.has(target.pathname)) return unchanged;
    return { pathAndQuery: `${target.pathname}${target.search}`, unwrapped: true };
  } catch {
    return unchanged;
  }
}
