import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { templateShim } from './template-shim.ts';

const source = readFileSync(new URL('../../../packages/recorder/src/gtm-templates/web-tag-reporter.tpl', import.meta.url), 'utf8');
const EXECUTE = '{"type": 8, "boolean": true}';
const config = { container: 'GTM-PWTEST1', version: '3', tags: [], logUrl: 'http://localhost/log' };

function reportTags(shim: string): void {
  const win = { pwContainer: {} as { reportTags?: () => void }, tagreeveTagReport: () => undefined };
  new Function('window', 'fetch', 'setTimeout', shim)(win, () => Promise.resolve(), (fn: () => void) => fn());
  win.pwContainer.reportTags!();
}

test('the shim grants callInWindow for a key with execute', () => {
  expect(source).toContain(EXECUTE);
  expect(() => reportTags(templateShim(config, source))).not.toThrow();
});

test('the shim refuses callInWindow for a key listed without execute', () => {
  const withoutExecute = source.replace(EXECUTE, '{"type": 8, "boolean": false}');
  expect(withoutExecute).not.toBe(source);
  expect(() => reportTags(templateShim(config, withoutExecute))).toThrow(/callInWindow has no permission for tagreeveTagReport/);
});
