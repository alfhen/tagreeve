import { readFile } from 'node:fs/promises';
import { parseProjectConfig, ProjectConfigError, type ProjectConfig } from '@tagreeve/expect';
import { DEFAULT_CONFIG, type DefaultUsed } from './defaults.ts';

export interface LoadedConfig {
  /** The path as the user gave it, or the default. */
  path: string;
  config: ProjectConfig;
  /** Set when the file came from the default path, not from `--config`. */
  defaultUsed?: DefaultUsed;
}

/** The message is ready for stderr. It names the file, the key and the line, never a value. */
export class ProjectConfigLoadError extends Error {}

/** Reads `--config <file>`, or `./tagreeve/config.yml` when it exists. Never looks in a parent folder. */
export async function loadProjectConfig(flag: string | undefined): Promise<LoadedConfig | undefined> {
  const path = flag ?? DEFAULT_CONFIG;
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (flag === undefined && code === 'ENOENT') return undefined;
    throw new ProjectConfigLoadError(`Cannot read ${path}: ${code ?? 'unknown error'}`);
  }
  try {
    const config = parseProjectConfig(text, path);
    return { path, config, ...(flag === undefined && { defaultUsed: { setting: 'config', path: DEFAULT_CONFIG } satisfies DefaultUsed }) };
  } catch (error) {
    if (!(error instanceof ProjectConfigError)) throw error;
    throw new ProjectConfigLoadError(`${path} is not a valid project config:\n${error.issues.map((i) => `  ${i}`).join('\n')}`);
  }
}

export function siteMissingMessage(config: LoadedConfig | undefined): string {
  return config ? `--site is required. Give --site or set site in ${config.path}.` : '--site is required';
}

export const ALLOW_TEST_PAYMENT_NEEDS_SITE = '--allow-test-payment needs --site on the command line. A site from the project config never supplies the host a test payment runs on.';
