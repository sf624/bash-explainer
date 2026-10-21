import type { CommandSpec, OptionSpec } from '../argv/spec';
import { mergeOptions } from './types';

/**
 * A command described in the `bashExplainer.customCommands` setting, for tools the dictionary
 * does not know (in-house scripts…). The same text is used in every display language.
 */
export interface CustomCommand {
  summary: string;
  /** Option → description, or { description, takesValue }. */
  options?: Record<string, string | { description: string; takesValue?: boolean }>;
  /** Descriptions of the positional arguments in order; the last one repeats. */
  arguments?: string[];
}

/** The spec of a custom command; undefined when the setting is malformed. */
export function customCommandSpec(c: unknown): CommandSpec | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const cc = c as CustomCommand;
  if (typeof cc.summary !== 'string') return undefined;
  const text = (s: string) => ({ ja: s, en: s });
  const options: OptionSpec[] = [];
  for (const [names, v] of Object.entries(cc.options ?? {})) {
    const desc = typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.description === 'string' ? v.description : undefined;
    if (desc === undefined) continue;
    // `-o|--output` names several spellings of one option, as in the built-in dictionary.
    options.push({ names: names.split('|').map((n) => n.trim()), text: text(desc), ...(typeof v === 'object' && v.takesValue ? { value: { name: 'VALUE' } } : {}) });
  }
  const args = Array.isArray(cc.arguments) ? cc.arguments.filter((a): a is string => typeof a === 'string') : [];
  const spec: CommandSpec = { summary: text(cc.summary), options: mergeOptions(options) };
  // Each operand optional, and the last one repeats.
  if (args.length) spec.operands = [{ pattern: args.map((a, i) => ({ name: `ARG${i + 1}`, text: text(a), repeat: i < args.length - 1 ? '?' : '*' })) }];
  return spec;
}
