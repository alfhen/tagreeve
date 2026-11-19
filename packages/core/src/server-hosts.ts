import { isLibraryLoadPath } from './library.ts';
import type { Request } from './records.ts';

/** A pattern is an exact host or `*.domain`, which matches any subdomain of `domain` but not `domain` itself. */
export function hostMatches(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    return p.startsWith('*.') ? h.endsWith(p.slice(1)) : h === p;
  });
}

export const LOAD_RESOURCE_TYPES: ReadonlySet<string> = new Set(['script', 'stylesheet', 'font', 'document']);

const bareHost = (h: string) => h.replace(/^\[|\]$/g, '');

/** True when the URL's host is one of `serverHosts`, with or without IPv6 brackets. An unparsable URL is on none. */
export function isServerHostUrl(url: string, serverHosts: readonly string[]): boolean {
  try {
    return hostMatches(bareHost(new URL(url).hostname), serverHosts.map(bareHost));
  } catch {
    return false;
  }
}

/**
 * A request to a `serverHosts` host that the local server container answers under `--server-container`:
 * everything except library loads and script, stylesheet, font and document loads. It does not ask the decoders,
 * because a first-party container often uses paths that none of them knows.
 */
export function isServerContainerRequest(req: Pick<Request, 'url' | 'resourceType'>, serverHosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol) || !isServerHostUrl(req.url, serverHosts)) return false;
  return !isLibraryLoadPath(url.pathname) && !LOAD_RESOURCE_TYPES.has(req.resourceType);
}
