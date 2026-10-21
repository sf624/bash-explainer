// The settings file of the command-line tool and the Language Server: JSON (comments allowed) with
// the keys of VS Code's settings, with or without `bashExplainer.`.
import * as fs from 'fs';
import { defaultSettingsPath, parseJsonc, readSettings, Settings } from '../src/settings';

export class SettingsFileError extends Error {}

/**
 * The file to read: the one given (`--config`), else $BASH_EXPLAINER_CONFIG, else
 * $XDG_CONFIG_HOME/bash-explainer/settings.json (~/.config/… by default). The default file may be
 * missing; a file that was named must be there.
 */
export function settingsFile(given: string | undefined, env: NodeJS.ProcessEnv): { path: string; required: boolean } | undefined {
  if (given !== undefined) return { path: given, required: true };
  if (env.BASH_EXPLAINER_CONFIG) return { path: env.BASH_EXPLAINER_CONFIG, required: true };
  const path = defaultSettingsPath(env);
  return path ? { path, required: false } : undefined;
}

/** The settings in the file, and warnings about keys and values left out. Throws SettingsFileError. */
export function readSettingsFile(file: { path: string; required: boolean }): { settings: Partial<Settings>; warnings: string[] } {
  let text: string;
  try {
    text = fs.readFileSync(file.path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' && !file.required) return { settings: {}, warnings: [] };
    throw new SettingsFileError(`cannot read the settings file ${file.path}: ${code ?? e}`);
  }
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch (e) {
    throw new SettingsFileError(`the settings file ${file.path} is not JSON: ${(e as Error).message}`);
  }
  return readSettings(json, file.path);
}
