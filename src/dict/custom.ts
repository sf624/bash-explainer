import type { CommandSpec, OperandSpec, OptionSpec } from '../argv/spec';
import type { Text } from '../i18n';
import { mergeOptions } from './types';

/**
 * A command described in the `bashExplainer.customCommands` setting, for tools the dictionary does not
 * know (in-house scripts…): a command spec (src/argv/spec.ts) written in JSON. The same text is used in
 * every display language.
 */
export interface CustomCommand {
  summary: string;
  /** `gnu` (the default): options may follow operands; `posix`: the first operand ends them; `single-dash`: `-name value`. */
  style?: 'gnu' | 'posix' | 'single-dash';
  options?: { names: string[]; description: string; takesValue?: boolean }[];
  /** The operands in order; `repeat` is `?`, `*` or `+`, as in a regular expression (absent: exactly one). */
  operands?: { name?: string; description: string; repeat?: '?' | '*' | '+' }[];
  subcommands?: Record<string, CustomCommand>;
}

/**
 * The shape of the setting up to 0.6: `options` as an object (`"-o|--output": "text"` or
 * `{ "description", "takesValue" }`) and `arguments`, the texts of the operands (each optional, the last one
 * repeating). 0.7 still reads it, converted to the shape above; a later release drops it.
 */
interface OldCustomCommand {
  options?: Record<string, unknown>;
  arguments?: unknown[];
}

const STYLES = ['gnu', 'posix', 'single-dash'];
const REPEATS = ['?', '*', '+'];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (s: string): Text => ({ ja: s, en: s });

/** The spec of a custom command; undefined when the setting is malformed (parts that are malformed are left out). */
export function customCommandSpec(c: unknown): CommandSpec | undefined {
  if (!isObject(c) || typeof c.summary !== 'string') return undefined;
  const spec: CommandSpec = { summary: text(c.summary), options: options(c) };
  if (typeof c.style === 'string' && STYLES.includes(c.style)) spec.style = c.style as CommandSpec['style'];
  const pattern = operands(c);
  if (pattern.length) spec.operands = [{ pattern }];
  if (isObject(c.subcommands)) {
    const subs = Object.entries(c.subcommands).flatMap(([name, s]) => {
      const sub = customCommandSpec(s);
      return sub ? [[name, sub] as const] : [];
    });
    if (subs.length) spec.subcommands = Object.fromEntries(subs);
  }
  return spec;
}

function options(c: Record<string, unknown>): OptionSpec[] {
  const out: OptionSpec[] = [];
  const add = (names: string[], v: unknown): void => {
    const desc = typeof v === 'string' ? v : isObject(v) && typeof v.description === 'string' ? v.description : undefined;
    if (desc === undefined || !names.length) return;
    out.push({ names, text: text(desc), ...(isObject(v) && v.takesValue === true ? { value: { name: 'VALUE' } } : {}) });
  };
  if (Array.isArray(c.options)) {
    for (const o of c.options) {
      if (isObject(o) && Array.isArray(o.names)) add(o.names.filter((n): n is string => typeof n === 'string'), o);
    }
  } else if (isObject(c.options)) {
    // The old shape: `-o|--output` names several spellings of one option, as in the built-in dictionary.
    for (const [names, v] of Object.entries((c as OldCustomCommand).options!)) add(names.split('|').map((n) => n.trim()), v);
  }
  return mergeOptions(out);
}

function operands(c: Record<string, unknown>): OperandSpec[] {
  if (Array.isArray(c.operands)) {
    return c.operands.flatMap((o, i): OperandSpec[] => {
      if (!isObject(o) || typeof o.description !== 'string') return [];
      const repeat = typeof o.repeat === 'string' && REPEATS.includes(o.repeat) ? { repeat: o.repeat as OperandSpec['repeat'] } : {};
      return [{ name: typeof o.name === 'string' ? o.name : `ARG${i + 1}`, text: text(o.description), ...repeat }];
    });
  }
  // The old shape: each optional, and the last one repeats.
  const texts = Array.isArray(c.arguments) ? (c as OldCustomCommand).arguments!.filter((a): a is string => typeof a === 'string') : [];
  return texts.map((a, i) => ({ name: `ARG${i + 1}`, text: text(a), repeat: i < texts.length - 1 ? '?' : '*' }));
}
