import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { readTemplateSections, readWebTagReporterTemplate } from './tpl.ts';

describe('readTemplateSections', () => {
  const text = [
    '___INFO___',
    '',
    '{"type":"TAG"}',
    '',
    '___SANDBOXED_JS_FOR_WEB_TEMPLATE___',
    '',
    'data.gtmOnSuccess();',
    '',
    '___WEB_PERMISSIONS___',
    '',
    JSON.stringify([
      { instance: { key: { publicId: 'read_event_metadata' }, param: [] } },
      {
        instance: {
          key: { publicId: 'read_data_layer' },
          param: [
            { key: 'keyPatterns', value: { type: 2, listItem: [{ type: 1, string: 'event' }] } },
          ],
        },
      },
      {
        instance: {
          key: { publicId: 'access_globals' },
          param: [
            {
              key: 'keys',
              value: {
                type: 2,
                listItem: [
                  {
                    type: 3,
                    mapKey: [{ type: 1, string: 'key' }],
                    mapValue: [{ type: 1, string: 'someFn' }],
                  },
                  { type: 3, mapKey: [{ type: 1, string: 'read' }], mapValue: [{ type: 8, boolean: true }] },
                ],
              },
            },
          ],
        },
      },
    ]),
    '',
    '___NOTES___',
    '',
    'Some notes',
  ].join('\n');

  it('splits the sections by name', () => {
    const t = readTemplateSections(text);
    expect(Object.keys(t.sections)).toEqual([
      'INFO',
      'SANDBOXED_JS_FOR_WEB_TEMPLATE',
      'WEB_PERMISSIONS',
      'NOTES',
    ]);
    expect(t.sections['NOTES']).toBe('Some notes');
    expect(t.sandboxedJs).toBe('data.gtmOnSuccess();');
  });

  it('parses the permissions and their keys', () => {
    const t = readTemplateSections(text);
    expect(t.permissions.map((p) => [p.id, p.keys])).toEqual([
      ['read_event_metadata', []],
      ['read_data_layer', ['event']],
      ['access_globals', ['someFn']],
    ]);
    expect(t.permissions[2]!.entries).toEqual([{ key: 'someFn', read: false, write: false, execute: false }]);
  });

  it('reads the key and the flags by name when mapKey is in another order', () => {
    const mapKey = ['execute', 'write', 'key', 'read'].map((string) => ({ type: 1, string }));
    const mapValue = [
      { type: 8, boolean: true },
      { type: 8, boolean: false },
      { type: 1, string: 'otherFn' },
      { type: 8, boolean: true },
    ];
    const reordered = [
      '___WEB_PERMISSIONS___',
      JSON.stringify([
        {
          instance: {
            key: { publicId: 'access_globals' },
            param: [{ key: 'keys', value: { type: 2, listItem: [{ type: 3, mapKey, mapValue }] } }],
          },
        },
      ]),
    ].join('\n');
    const [permission] = readTemplateSections(reordered).permissions;
    expect(permission!.entries).toEqual([{ key: 'otherFn', read: true, write: false, execute: true }]);
    expect(permission!.keys).toEqual(['otherFn']);
  });

  it('skips a map entry with no key and ignores the server sections', () => {
    const server = [
      '___SANDBOXED_JS_FOR_SERVER___',
      'server();',
      '___SERVER_PERMISSIONS___',
      JSON.stringify([{ instance: { key: { publicId: 'send_http' } } }]),
    ].join('\n');
    const t = readTemplateSections(server);
    expect(t.sandboxedJs).toBe('');
    expect(t.permissions).toEqual([]);
    expect(t.sections['SANDBOXED_JS_FOR_SERVER']).toBe('server();');
  });

  it('reads the shipped template', () => {
    const file = new URL('./web-tag-reporter.tpl', import.meta.url);
    const t = readTemplateSections(readFileSync(file, 'utf8'));
    expect(Object.keys(t.sections)).toEqual([
      'TERMS_OF_SERVICE',
      'INFO',
      'TEMPLATE_PARAMETERS',
      'SANDBOXED_JS_FOR_WEB_TEMPLATE',
      'WEB_PERMISSIONS',
      'TESTS',
      'NOTES',
    ]);
  });
});

describe('readWebTagReporterTemplate', () => {
  it('reads the template next to the sources', () => {
    const file = readFileSync(new URL('./web-tag-reporter.tpl', import.meta.url), 'utf8');
    expect(file).toContain('___WEB_PERMISSIONS___');
    expect(readWebTagReporterTemplate()).toBe(file);
  });

  it('surfaces an error other than ENOENT and does not try the next place', async () => {
    const calls: string[] = [];
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      readFileSync: (place: URL) => {
        calls.push(place.pathname);
        throw Object.assign(new Error('is a directory'), { code: 'EISDIR' });
      },
    }));
    try {
      const mocked = await import('./tpl.ts');
      expect(() => mocked.readWebTagReporterTemplate()).toThrow('is a directory');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('/templates/tagreeve-tag-reporter.tpl');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});
