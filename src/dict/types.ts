import { Text, tx } from '../i18n';

export interface OptDoc {
  text: Text;
  /** The option consumes the next word (or the rest of a combined word) as its value. */
  arg?: boolean;
  /** Explanations for specific option values (e.g. `set -o pipefail`). */
  values?: Record<string, Text>;
  /** The option consumes words up to a terminator such as `;` or `+` (e.g. `find -exec`). */
  untilTerminator?: boolean;
}

export interface CommandDoc {
  summary: Text;
  builtin?: boolean;
  options?: Record<string, OptDoc>;
  /** Descriptions of positional arguments in order; the last one repeats. */
  positional?: Text[];
  /** After its own options, the remaining words form another command (sudo, xargs, env…). */
  wraps?: boolean;
  subcommands?: Record<string, CommandDoc>;
  /** Options are single words that never combine (find, java-style `-name`). */
  longSingleDash?: boolean;
}

/** `[names, ja, en, flags]` where names is `-r|--recursive` and flags may contain `arg`, `until`. */
export type OptSpec = [string, string, string, string?] | [string, string, string, string, Record<string, Text>];

export function cmd(
  ja: string,
  en: string,
  opts: OptSpec[] = [],
  extra: Partial<Omit<CommandDoc, 'summary' | 'options'>> = {},
): CommandDoc {
  const options: Record<string, OptDoc> = {};
  for (const [names, oja, oen, flags = '', values] of opts) {
    const doc: OptDoc = { text: tx(oja, oen) };
    if (flags.includes('arg')) doc.arg = true;
    if (flags.includes('until')) doc.untilTerminator = true;
    if (values) doc.values = values;
    for (const n of names.split('|')) options[n] = doc;
  }
  return { summary: tx(ja, en), options, ...extra };
}

export const pos = (ja: string, en: string): Text => tx(ja, en);
