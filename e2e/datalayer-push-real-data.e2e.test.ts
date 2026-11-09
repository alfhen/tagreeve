import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { run } from './cli-helpers.ts';

const EMAIL = 'fake.person@example.test';

interface Summary {
  path: string;
  flags: { kind: string; detail: string }[];
}

test('a push that holds a foreign email gets a possibleRealDataPush warning that does not change the exit code', async () => {
  const r = await run('datalayer-shapes');
  const records = r.records!;
  expect(JSON.stringify(records.dataLayerEvents.map((e) => e.args))).toContain(EMAIL);
  expect(records.run.identity?.email).not.toBe(EMAIL);

  const summary = JSON.parse(r.stdout) as Summary;
  const pushFlags = records.flags.filter((f) => f.kind === 'possibleRealDataPush');
  expect(summary.flags.some((f) => f.kind === 'possibleRealDataPush')).toBe(true);
  expect(pushFlags.length).toBeGreaterThan(0);
  const pushIds = new Set(records.dataLayerEvents.map((e) => e.id as string));
  for (const f of pushFlags) {
    expect(f.recordIds.some((id) => pushIds.has(id))).toBe(true);
    expect(f.detail).toMatch(/^dataLayer push dle_\S+ in step \S+ carries \d+ .*value\(s\) that are not from the run identity/);
    expect(f.detail).not.toContain(EMAIL);
    expect(f.detail).not.toContain('the body');
  }

  expect(r.failed).not.toContain('builtin: possibleRealData');
  expect(r.code).toBe(r.failed.length === 0 ? 0 : 1);

  expect(r.stdout).not.toContain(EMAIL);
  const lines = (await readFile(summary.path, 'utf8')).split('\n').filter(Boolean);
  expect(lines.some((l) => l.includes(EMAIL))).toBe(true);
  for (const line of lines) {
    if ((JSON.parse(line) as { type: string }).type === 'dataLayerEvent') continue;
    expect(line).not.toContain(EMAIL);
  }
}, 150_000);
