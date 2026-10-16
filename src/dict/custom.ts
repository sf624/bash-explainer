import { CommandDoc, OptDoc } from './types';

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

/** The dictionary entry for a custom command; undefined when the setting is malformed. */
export function customCommandDoc(c: unknown): CommandDoc | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const cc = c as CustomCommand;
  if (typeof cc.summary !== 'string') return undefined;
  const text = (s: string) => ({ ja: s, en: s });
  const options: Record<string, OptDoc> = {};
  for (const [names, v] of Object.entries(cc.options ?? {})) {
    const desc = typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.description === 'string' ? v.description : undefined;
    if (desc === undefined) continue;
    const doc: OptDoc = { text: text(desc), ...(typeof v === 'object' && v.takesValue ? { arg: true } : {}) };
    // `-o|--output` names several spellings of one option, as in the built-in dictionary.
    for (const n of names.split('|')) options[n.trim()] = doc;
  }
  const args = Array.isArray(cc.arguments) ? cc.arguments.filter((a): a is string => typeof a === 'string') : [];
  return { summary: text(cc.summary), options, ...(args.length ? { positional: args.map(text) } : {}) };
}
