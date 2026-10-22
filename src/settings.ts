// The settings of Bash Explainer: the keys VS Code lists in package.json (contributes.configuration),
// their types and defaults, and where each one has a meaning: VS Code, the web page, the command-line
// tool and the Language Server. test/settings-schema.test.ts keeps this list and package.json equal,
// so that a new VS Code setting cannot be forgotten on the other surfaces. A setting of one surface
// only, 'web', is not in package.json (VS Code has its own for it) and carries its own description.
// Pure code: the web page bundles it, so it reads no file itself.
import { EXAMPLE_KINDS, ExplainOptions } from './analyzer';
import { Shell } from './dialect';
import type { ExamplePlacement } from './ui/render';

/** Kinds of files with embedded shell code, as named in the `embedded.files` setting. */
export const EMBEDDED_FILES = ['dockerfile', 'makefile', 'yaml', 'packageJson', 'markdown', 'python', 'jenkinsfile'] as const;

export const PREFIX = 'bashExplainer.';

export interface Settings {
  language: 'auto' | 'en' | 'ja';
  'notes.idioms': boolean;
  'notes.pitfalls': boolean;
  shell: 'auto' | Shell;
  'yq.flavor': 'auto' | 'mikefarah4' | 'kislyuk' | 'mikefarah3';
  'diagnostics.enabled': boolean;
  'diagnostics.ignore': string[];
  'diagnostics.embedded': boolean;
  'examples.enabled': boolean;
  'examples.disabled': string[];
  'examples.placement': ExamplePlacement;
  'examples.inHover': boolean;
  'hover.enabled': boolean;
  'hover.followCursor': boolean;
  'hover.followDelay': number;
  'hover.maxDepth': number;
  'inline.enabled': boolean;
  'inline.maxLength': number;
  'panel.autoOpen': boolean;
  'highlight.enabled': boolean;
  'editor.wrap': boolean;
  languages: string[];
  'embedded.files': string[];
  customCommands: Record<string, unknown>;
}

export type SettingKey = keyof Settings;

/** Where a setting can be set: VS Code, the web page, the command-line tool, the Language Server. */
export type Surface = 'vscode' | 'web' | 'cli' | 'lsp';

export interface SettingSpec {
  key: SettingKey;
  type: 'boolean' | 'string' | 'number' | 'array' | 'object';
  default: unknown;
  /** The values a string may take. */
  enum?: readonly string[];
  /** The values the items of an array may take (any string when absent). */
  items?: readonly string[];
  minimum?: number;
  /** The group it is listed under (README, the web page). */
  group: 'display' | 'checks' | 'files' | 'dictionary';
  /** A short name, [Japanese, English], for the web page. */
  title: [string, string];
  /** Where it has a meaning, and so can be set. */
  surfaces: readonly Surface[];
  /** Why it has none on the other surfaces (for the docs and the tests). */
  elsewhere?: string;
  /** The description, [Japanese, English], of a setting that is not in package.json (those of the web page only). */
  description?: [string, string];
}

const ALL: readonly Surface[] = ['vscode', 'web', 'cli', 'lsp'];
const SHELLS = ['auto', 'bash', 'sh', 'dash', 'ash', 'yash', 'ksh', 'mksh', 'zsh'] as const;

export const SETTINGS: readonly SettingSpec[] = [
  { key: 'language', type: 'string', default: 'auto', enum: ['auto', 'ja', 'en'], group: 'display', title: ['言語', 'Language'], surfaces: ALL },
  { key: 'notes.idioms', type: 'boolean', default: true, group: 'display', title: ['定番の書き方の補足', 'Notes on idioms'], surfaces: ALL },
  { key: 'notes.pitfalls', type: 'boolean', default: true, group: 'display', title: ['よくある間違いの指摘', 'Pitfalls'], surfaces: ALL },
  { key: 'shell', type: 'string', default: 'auto', enum: SHELLS, group: 'checks', title: ['対象シェル', 'Shell'], surfaces: ALL },
  { key: 'yq.flavor', type: 'string', default: 'auto', enum: ['auto', 'mikefarah4', 'kislyuk', 'mikefarah3'], group: 'checks', title: ['yq の種類', 'yq flavor'], surfaces: ALL },
  {
    key: 'diagnostics.enabled', type: 'boolean', default: true, group: 'checks', title: ['警告', 'Warnings'], surfaces: ['vscode', 'web', 'lsp'],
    elsewhere: 'The command-line tool reports warnings when asked with --check.',
  },
  { key: 'diagnostics.ignore', type: 'array', default: [], group: 'checks', title: ['出さない警告', 'Warnings to leave out'], surfaces: ALL },
  { key: 'diagnostics.embedded', type: 'boolean', default: true, group: 'checks', title: ['他のファイル中のシェルの警告', 'Warnings in embedded shell code'], surfaces: ALL },
  { key: 'examples.enabled', type: 'boolean', default: true, group: 'display', title: ['具体例', 'Worked examples'], surfaces: ALL },
  { key: 'examples.disabled', type: 'array', default: [], items: EXAMPLE_KINDS, group: 'display', title: ['表示しない具体例', 'Kinds of examples to hide'], surfaces: ALL },
  {
    key: 'examples.placement', type: 'string', default: 'first', enum: ['first', 'last', 'bottom'], group: 'display', title: ['具体例の位置', 'Where examples go'], surfaces: ['vscode', 'web'],
    elsewhere: 'The text, Markdown and hover output of the command-line tool and the Language Server list the examples after the explanation.',
  },
  {
    key: 'examples.inHover', type: 'boolean', default: true, group: 'display', title: ['ホバーの具体例', 'Examples in the hover'], surfaces: ['vscode', 'lsp'],
    elsewhere: 'The web page and the command-line tool have no hover.',
  },
  {
    key: 'hover.enabled', type: 'boolean', default: true, group: 'display', title: ['ホバー', 'Hover'], surfaces: ['vscode', 'lsp'],
    elsewhere: 'The web page and the command-line tool have no hover.',
  },
  {
    key: 'hover.followCursor', type: 'boolean', default: false, group: 'display', title: ['カーソルに追従', 'Follow the cursor'], surfaces: ['vscode'],
    elsewhere: 'Only VS Code can show a hover by itself; the web page always follows the cursor.',
  },
  {
    key: 'hover.followDelay', type: 'number', default: 400, minimum: 0, group: 'display', title: ['追従までの遅延', 'Delay before following'], surfaces: ['vscode'],
    elsewhere: 'Goes with hover.followCursor.',
  },
  {
    key: 'hover.maxDepth', type: 'number', default: 0, minimum: 0, group: 'display', title: ['ホバーの階層の深さ', 'Hover depth'], surfaces: ['vscode', 'lsp'],
    elsewhere: 'The web page and the command-line tool have no hover.',
  },
  {
    key: 'inline.enabled', type: 'boolean', default: false, group: 'display', title: ['インライン要約', 'Inline summary'], surfaces: ['vscode'],
    elsewhere: 'The summary at the end of the line is drawn by VS Code.',
  },
  {
    key: 'inline.maxLength', type: 'number', default: 120, minimum: 20, group: 'display', title: ['インライン要約の長さ', 'Inline summary length'], surfaces: ['vscode'],
    elsewhere: 'Goes with inline.enabled.',
  },
  {
    key: 'panel.autoOpen', type: 'boolean', default: false, group: 'display', title: ['パネルを自動で開く', 'Open the panel by itself'], surfaces: ['vscode'],
    elsewhere: 'The web page always shows its panel; the others have none.',
  },
  {
    key: 'highlight.enabled', type: 'boolean', default: false, group: 'display', title: ['構文木による色分け', 'Colours from the syntax tree'], surfaces: ['vscode', 'lsp'],
    elsewhere: 'The web page always colours the script this way; the command-line tool shows no script.',
  },
  {
    key: 'editor.wrap', type: 'boolean', default: false, group: 'display', title: ['長い行の折り返し', 'Wrap long lines'], surfaces: ['web'],
    description: [
      'エディタで、長い行をウィンドウの幅で折り返します。オフのときは、長い行は横にスクロールします。',
      'Wraps long lines in the editor at the width of the window. When off, a long line scrolls sideways.',
    ],
    elsewhere: 'Only the web page has its own editor; VS Code has `editor.wordWrap`, and the command-line tool and the Language Server show no editor.',
  },
  {
    key: 'languages', type: 'array', default: ['shellscript'], group: 'files', title: ['対象の言語 ID', 'Language IDs'], surfaces: ['vscode', 'lsp'],
    elsewhere: 'The web page and the command-line tool choose the kind of file with their own File menu and --kind.',
  },
  {
    key: 'embedded.files', type: 'array', default: [...EMBEDDED_FILES], items: EMBEDDED_FILES, group: 'files', title: ['解説するファイルの種類', 'Files with shell code'], surfaces: ['vscode', 'lsp'],
    elsewhere: 'The web page and the command-line tool explain the file they are given, as the kind chosen (File menu, --kind).',
  },
  { key: 'customCommands', type: 'object', default: {}, group: 'dictionary', title: ['独自のコマンド', 'Your own commands'], surfaces: ALL },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export const settingSpec = (key: string): SettingSpec | undefined => BY_KEY.get(key as SettingKey);

/** The settings that have a meaning on a surface. */
export const settingsFor = (surface: Surface): SettingSpec[] => SETTINGS.filter((s) => s.surfaces.includes(surface));

/** A fresh copy of every default (arrays and objects are not shared). */
export function defaultSettings(): Settings {
  return Object.fromEntries(SETTINGS.map((s) => [s.key, structuredClone(s.default)])) as unknown as Settings;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why a value does not fit the setting, or undefined when it does. */
export function checkValue(spec: SettingSpec, value: unknown): string | undefined {
  const list = (vs: readonly string[]) => vs.join(', ');
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'expected true or false';
    case 'string':
      return typeof value === 'string' && spec.enum!.includes(value) ? undefined : `expected one of ${list(spec.enum!)}`;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected a number';
      return value < spec.minimum! ? `expected a number from ${spec.minimum}` : undefined;
    case 'array': {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return 'expected a list of strings';
      const bad = spec.items ? value.filter((v) => !spec.items!.includes(v)) : [];
      return bad.length ? `unknown ${list(bad)} (expected ${list(spec.items!)})` : undefined;
    }
    case 'object':
      return isObject(value) ? undefined : 'expected an object';
  }
}

/** A key left out, and why: not a setting, a value of the wrong type, or no meaning where it is read. */
export interface Ignored {
  key: string;
  reason: 'unknown' | 'invalid' | 'elsewhere';
  /** For `invalid`: what was expected. */
  detail?: string;
}

export interface ReadSettings {
  settings: Partial<Settings>;
  /** Keys that are not settings, and values of the wrong type, which are left out. */
  warnings: string[];
  /** The same, one entry per key. */
  ignored: Ignored[];
}

/**
 * The settings in an object, as a settings file or an editor gives them: flat keys as in VS Code's
 * settings.json, with or without `bashExplainer.` (`"bashExplainer.notes.idioms": false`), or nested
 * (`{ "bashExplainer": { "notes": { "idioms": false } } }`). `where` names the source in the warnings.
 */
export function readSettings(input: unknown, where: string): ReadSettings {
  const out: ReadSettings = { settings: {}, warnings: [], ignored: [] };
  if (!isObject(input)) {
    out.warnings.push(`${where}: expected an object of settings`);
    return out;
  }
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [name, value] of Object.entries(obj)) {
      const key = prefix + (prefix === '' && name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name);
      const spec = settingSpec(key);
      if (spec) {
        const why = checkValue(spec, value);
        if (why) {
          out.warnings.push(`${where}: ${PREFIX}${key}: ${why}; ignored`);
          out.ignored.push({ key, reason: 'invalid', detail: why });
        } else (out.settings as Record<string, unknown>)[key] = structuredClone(value);
      } else if (prefix === '' && key === 'bashExplainer' && isObject(value)) {
        walk(value, '');
      } else if (isObject(value) && SETTINGS.some((s) => s.key.startsWith(`${key}.`))) {
        walk(value, `${key}.`);
      } else {
        out.warnings.push(`${where}: unknown setting ${key}; ignored`);
        out.ignored.push({ key, reason: 'unknown' });
      }
    }
  };
  walk(input, '');
  return out;
}

/**
 * Settings to import, as a settings file holds them (the text of settings.json, the CLI's file or an
 * export of the web page): those that apply on the surface, and the keys left out. Throws a
 * SyntaxError when the text is not JSON, or not an object.
 */
export function importSettings(text: string, surface: Surface): { settings: Partial<Settings>; ignored: Ignored[] } {
  const json = parseJsonc(text);
  if (!isObject(json)) throw new SyntaxError('expected an object of settings');
  const read = readSettings(json, 'import');
  const settings: Partial<Settings> = {};
  const ignored = [...read.ignored];
  for (const [key, value] of Object.entries(read.settings)) {
    if (settingSpec(key)!.surfaces.includes(surface)) (settings as Record<string, unknown>)[key] = value;
    else ignored.push({ key, reason: 'elsewhere' });
  }
  return { settings, ignored };
}

/** The settings that differ from the defaults on a surface, as the text of a settings file. */
export function exportSettings(s: Settings, surface: Surface): string {
  return `${JSON.stringify(changedSettings(s, surface), null, 2)}\n`;
}

/** `key=value` from the command line: the value is read as JSON when it is JSON, else as a string. */
export function parseAssignment(text: string): { key: string; value: unknown } | undefined {
  const at = text.indexOf('=');
  if (at <= 0) return undefined;
  const raw = text.slice(at + 1);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  return { key: text.slice(0, at), value };
}

/**
 * JSON with comments and trailing commas, as VS Code's settings.json is written. Throws a
 * SyntaxError when it is not.
 */
export function parseJsonc(text: string): unknown {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // A string, copied as it is (with its escapes).
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      out += ' ';
    } else {
      out += c;
    }
  }
  // A comma before a closing bracket (outside strings: those were copied whole, but may hold `,]`).
  return JSON.parse(out.replace(/("(?:[^"\\]|\\.)*")|,(\s*[\]}])/g, (m, str: string | undefined, close: string) => str ?? close));
}

/** Where the command-line tool and the Language Server look for a settings file when none is given. */
export function defaultSettingsPath(env: Record<string, string | undefined>): string | undefined {
  const home = env.HOME || env.USERPROFILE;
  const base = env.XDG_CONFIG_HOME || (home ? `${home}/.config` : undefined);
  return base ? `${base}/bash-explainer/settings.json` : undefined;
}

/** The settings, in order of precedence: each layer overrides the ones before it. */
export function mergeSettings(...layers: Partial<Settings>[]): Settings {
  return Object.assign(defaultSettings(), ...layers);
}

/** The shell set (undefined: `auto`, from the file). */
export const forcedShell = (s: Settings): Shell | undefined => (s.shell === 'auto' ? undefined : s.shell);

/** What the analyzer takes from the settings. */
export function explainOptions(s: Settings): ExplainOptions {
  return {
    yqFlavor: s['yq.flavor'],
    examples: { enabled: s['examples.enabled'], disabled: s['examples.disabled'] },
    idioms: s['notes.idioms'],
    pitfalls: s['notes.pitfalls'],
    customCommands: s.customCommands,
  };
}

/** The settings that differ from the defaults, with the `bashExplainer.` prefix, as settings.json holds them. */
export function changedSettings(s: Settings, surface?: Surface): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of surface ? settingsFor(surface) : SETTINGS) {
    if (JSON.stringify(s[spec.key]) !== JSON.stringify(spec.default)) out[PREFIX + spec.key] = s[spec.key];
  }
  return out;
}

/** Every setting of a surface, with the `bashExplainer.` prefix. */
export function settingsJson(s: Settings, surface: Surface): Record<string, unknown> {
  return Object.fromEntries(settingsFor(surface).map((spec) => [PREFIX + spec.key, s[spec.key]]));
}

/** The descriptions of the settings, from package.json and its translations (package.nls*.json). */
export interface SettingText {
  description: string;
  /** The label of each value of an enum, or of the items of a list. */
  values?: Record<string, string>;
}

/**
 * The descriptions in one language, resolving the `%name%` references of package.json through the
 * translation file. Used when the web page is built.
 */
export function settingTexts(configuration: { properties: Record<string, any> }, nls: Record<string, string>): Record<string, SettingText> {
  const t = (s: string) => s.replace(/^%(.+)%$/, (m, name: string) => nls[name] ?? m);
  const out: Record<string, SettingText> = {};
  for (const [name, p] of Object.entries(configuration.properties)) {
    const enumOf = p.enum ? p : p.items?.enum ? p.items : undefined;
    out[name.slice(PREFIX.length)] = {
      description: t(p.markdownDescription ?? p.description),
      values: enumOf?.enumDescriptions ? Object.fromEntries((enumOf.enum as string[]).map((v, i) => [v, t(enumOf.enumDescriptions[i])])) : undefined,
    };
  }
  return out;
}
