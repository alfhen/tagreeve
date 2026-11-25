import { fieldHashes, readings, type Identity } from './identity.ts';
import type { Canary } from './records.ts';

export const CANARY_NAMES = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'] as const;

export function canaryValues(seed: number, cell?: string): Canary[] {
  const where = (cell ?? 'run').toUpperCase();
  return CANARY_NAMES.map((name) => ({ source: 'urlParam', name, value: `TEST-${name.toUpperCase()}-${seed}-${where}-0001` }));
}

export interface CanaryPool {
  /** Every form that is looked for, mapped to the name of the canary or identity field it came from. */
  forms: ReadonlyMap<string, string>;
  /** The name a text belongs to: the text or a decoded layer of it is a form, or is a `GCL.` or `fb.1.` cookie that ends in a canary. */
  match(text: string): string | undefined;
}

const CLICK_ID_COOKIE = /^(?:GCL\.[^.]*\.|fb\.1\.\d+\.)(.+)$/;

function formsOf(value: string): string[] {
  const buffer = Buffer.from(value);
  return [value, encodeURIComponent(value), buffer.toString('base64'), buffer.toString('base64url'), ...fieldHashes(value)];
}

export function canaryPool(canaries: readonly Canary[], identity: Pick<Identity, 'email' | 'phone'> | null): CanaryPool {
  const forms = new Map<string, string>();
  const add = (name: string, value: string) => {
    for (const form of formsOf(value)) if (!forms.has(form)) forms.set(form, name);
  };
  for (const { name, value } of canaries) add(name, value);
  if (identity) {
    add('email', identity.email);
    add('phone', identity.phone);
  }
  const nameOf = (text: string): string | undefined => {
    const exact = forms.get(text);
    if (exact !== undefined) return exact;
    // Padded Base64 of a digest, or a value followed by =, is the unpadded form with its padding.
    const bare = text.replace(/=+$/, '');
    if (bare !== text) {
      const padded = forms.get(bare);
      if (padded !== undefined) return padded;
    }
    const token = CLICK_ID_COOKIE.exec(text)?.[1];
    return token === undefined ? undefined : forms.get(token);
  };
  return {
    forms,
    match(text) {
      for (const reading of readings(text)) {
        const name = nameOf(reading);
        if (name !== undefined) return name;
      }
      return undefined;
    },
  };
}
