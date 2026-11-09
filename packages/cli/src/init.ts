import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Io } from './run.ts';
import { gitIgnoreStatus } from './git-ignore.ts';
import { DEFAULT_BASELINES, DEFAULT_CONFIG, DEFAULT_RUNS, DEFAULT_SCENARIOS } from './defaults.ts';

export const IGNORE_LINE = `/${DEFAULT_RUNS}/`;
const FOLDERS = [DEFAULT_SCENARIOS, DEFAULT_BASELINES];
const CONFIG = DEFAULT_CONFIG;
const STARTER_CONFIG = `configSchemaVersion: 1
# Allowed keys: site, out, options. See docs/cli.md, "Project config".
# site:
# out:
# options:
`;

class NotAFolder extends Error {
  constructor() {
    super('not a folder');
  }
}

type Action = 'created' | 'skipped' | 'added';
interface Item {
  path: string;
  action: Action;
  text: string;
}

async function ensureIgnoreLine(cwd: string): Promise<Item> {
  const file = join(cwd, '.gitignore');
  let current: string | undefined;
  try {
    current = await readFile(file, 'utf8');
  } catch {
    current = undefined;
  }
  if (current?.split(/\r?\n/).some((line) => line.trim() === IGNORE_LINE)) return { path: '.gitignore', action: 'skipped', text: `Skipped .gitignore: it already has ${IGNORE_LINE}` };
  if ((await gitIgnoreStatus(join(cwd, DEFAULT_RUNS), { probe: 'folder' })) === 'ignored') return { path: '.gitignore', action: 'skipped', text: `Skipped .gitignore: git already ignores ${DEFAULT_RUNS}/` };
  const prefix = current === undefined || current === '' || current.endsWith('\n') ? '' : '\n';
  await appendFile(file, `${prefix}${IGNORE_LINE}\n`);
  return current === undefined
    ? { path: '.gitignore', action: 'created', text: `Created .gitignore with ${IGNORE_LINE}` }
    : { path: '.gitignore', action: 'added', text: `Added ${IGNORE_LINE} to .gitignore` };
}

async function ensureFolder(cwd: string, folder: string): Promise<Item> {
  const found = await stat(join(cwd, folder)).catch(() => undefined);
  if (found && !found.isDirectory()) throw new NotAFolder();
  if (found) return { path: `${folder}/`, action: 'skipped', text: `Skipped ${folder}/: it exists` };
  await mkdir(join(cwd, folder), { recursive: true });
  return { path: `${folder}/`, action: 'created', text: `Created ${folder}/` };
}

async function ensureConfig(cwd: string): Promise<Item> {
  const found = await stat(join(cwd, CONFIG)).catch(() => undefined);
  if (found && !found.isFile()) throw Object.assign(new Error('not a file'), { code: 'NOTFILE' });
  if (found) return { path: CONFIG, action: 'skipped', text: `Skipped ${CONFIG}: it exists` };
  await mkdir(dirname(join(cwd, CONFIG)), { recursive: true });
  await writeFile(join(cwd, CONFIG), STARTER_CONFIG, { flag: 'wx' });
  return { path: CONFIG, action: 'created', text: `Created ${CONFIG}` };
}

function failureText(path: string, error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (error instanceof NotAFolder) return `${path.replace(/\/$/, '')} is not a folder\n`;
  if (code === 'NOTFILE') return `${path} is not a file\n`;
  const reason = code === 'EACCES' || code === 'EPERM' ? 'permission denied' : code === 'EEXIST' ? 'it exists' : code === 'ENOTDIR' || code === 'EISDIR' ? 'a file or folder is in the way' : 'the write failed';
  return `Could not write ${path}: ${reason}\n`;
}

export async function initCommand(io: Io, json = false, cwd: string = process.cwd()): Promise<number> {
  const steps: Array<[string, () => Promise<Item>]> = [
    ...FOLDERS.map((folder): [string, () => Promise<Item>] => [`${folder}/`, () => ensureFolder(cwd, folder)]),
    [CONFIG, () => ensureConfig(cwd)],
    ['.gitignore', () => ensureIgnoreLine(cwd)],
  ];
  const items: Item[] = [];
  for (const [path, step] of steps) {
    try {
      const item = await step();
      items.push(item);
      if (!json) io.stdout(`${item.text}\n`);
    } catch (error) {
      if (json) io.stdout(`${JSON.stringify({ items: items.map(({ path, action }) => ({ path, action })) })}\n`);
      io.stderr(failureText(path, error));
      return 2;
    }
  }
  if (json) io.stdout(`${JSON.stringify({ items: items.map(({ path, action }) => ({ path, action })) })}\n`);
  return 0;
}
