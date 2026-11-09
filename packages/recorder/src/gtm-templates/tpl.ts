import { readFileSync } from 'node:fs';

export type PermissionEntry = { key: string; read: boolean; write: boolean; execute: boolean };

export type TemplatePermission = {
  id: string;
  keys: string[];
  entries: PermissionEntry[];
};

export type TemplateSections = {
  sections: Record<string, string>;
  sandboxedJs: string;
  permissions: TemplatePermission[];
};

const MARKER = /^___([A-Z_]+)___[ \t]*$/;

type ParamValue = {
  type?: number;
  string?: string;
  listItem?: ParamValue[];
  mapKey?: ParamValue[];
  mapValue?: ParamValue[];
  boolean?: boolean;
};
type RawPermission = {
  instance: { key: { publicId: string }; param?: { key: string; value: ParamValue }[] };
};

export function readTemplateSections(text: string): TemplateSections {
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current !== null) sections[current] = lines.join('\n').trim();
  };
  for (const line of text.split(/\r?\n/)) {
    const m = MARKER.exec(line);
    if (m) {
      flush();
      current = m[1]!;
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  const sandboxedJs = sections['SANDBOXED_JS_FOR_WEB_TEMPLATE'] ?? '';
  const raw = sections['WEB_PERMISSIONS'];
  const entries = raw ? (JSON.parse(raw) as RawPermission[]) : [];
  return { sections, sandboxedJs, permissions: entries.map(parsePermission) };
}

function parsePermission(entry: RawPermission): TemplatePermission {
  const entries: PermissionEntry[] = [];
  for (const param of entry.instance.param ?? []) {
    for (const item of param.value.listItem ?? []) {
      if (item.string !== undefined) {
        entries.push({ key: item.string, read: false, write: false, execute: false });
        continue;
      }
      const field = (name: string) => {
        const index = item.mapKey?.findIndex((k) => k.string === name) ?? -1;
        return index < 0 ? undefined : item.mapValue?.[index];
      };
      const key = field('key')?.string;
      if (key === undefined) continue;
      entries.push({
        key,
        read: field('read')?.boolean === true,
        write: field('write')?.boolean === true,
        execute: field('execute')?.boolean === true,
      });
    }
  }
  return { id: entry.instance.key.publicId, keys: entries.map((e) => e.key), entries };
}

export const PACKAGE_TEMPLATE_FILE = 'tagreeve-tag-reporter.tpl';

// Bundled, import.meta.url is in dist/ and the build puts the file in dist/templates/. From source it sits next to this file.
// Nothing outside the package is tried, and only a missing file moves on to the next place.
export function readWebTagReporterTemplate(): string {
  const places = [
    new URL(`./templates/${PACKAGE_TEMPLATE_FILE}`, import.meta.url),
    new URL('./web-tag-reporter.tpl', import.meta.url),
  ];
  for (const place of places) {
    try {
      return readFileSync(place, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('The web tag reporter template is missing from this install.');
}
