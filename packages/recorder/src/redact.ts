const REDACTED_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'access-token', 'x-api-key']);
const REDACTED = '[redacted]';

/** The lower-case names of the headers whose values `redactHeaders` replaces. */
export function secretHeaderNamesIn(headers: Record<string, string>): string[] {
  return Object.keys(headers)
    .map((k) => k.toLowerCase())
    .filter((k) => REDACTED_HEADERS.has(k));
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, REDACTED_HEADERS.has(k.toLowerCase()) ? REDACTED : v]),
  );
}

/** Query and body names whose values are vendor secrets. The Meta Conversions API sends its access token in the URL. */
export const SECRET_VALUE_NAMES = ['access_token', 'appsecret_proof'] as const;

const SECRET_NAME_SET = new Set<string>(SECRET_VALUE_NAMES);
const NAMES = SECRET_VALUE_NAMES.join('|');
const IN_URL = new RegExp(`([?&;])(${NAMES})=[^&#]*`, 'gi');
const IN_FORM = new RegExp(`(^|&)(${NAMES})=[^&]*`, 'gi');
const IN_JSON = new RegExp(`("(?:${NAMES})"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}\\]\\s]+)`, 'gi');

/** The URL with the values of the secret names replaced. */
export function redactSecretsInUrl(url: string): string {
  return url.replace(IN_URL, `$1$2=${REDACTED}`);
}

/** A JSON or form body with the values of the secret names replaced. Text that is neither is checked for both shapes. */
export function redactSecretsInBody(body: string): string {
  return body.replace(IN_JSON, `$1"${REDACTED}"`).replace(IN_FORM, `$1$2=${REDACTED}`);
}

function collectNames(scan: (note: (m: string, ...groups: unknown[]) => string) => void): string[] {
  const found = new Set<string>();
  scan((_, ...groups) => {
    for (const g of groups) if (typeof g === 'string' && SECRET_NAME_SET.has(g.toLowerCase())) found.add(g.toLowerCase());
    return '';
  });
  return [...found];
}

/** The lower-case secret names whose values `redactSecretsInUrl` replaces in the URL. */
export function secretNamesInUrl(url: string): string[] {
  return collectNames((note) => url.replace(IN_URL, note));
}

/** The lower-case secret names whose values `redactSecretsInBody` replaces in the body. */
export function secretNamesInBody(body: string): string[] {
  return collectNames((note) => {
    const afterJson = body.replace(IN_JSON, (m) => note(m, m.slice(1, m.indexOf('"', 1))) + `"${REDACTED}"`);
    afterJson.replace(IN_FORM, note);
  });
}
