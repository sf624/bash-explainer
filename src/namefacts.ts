import type { Shell } from './dialect';
import { lookupCommand } from './dict/aliases';
import type { Lang } from './i18n';
import { nameSaid, type NameSaid } from './messages';
import type { ExecEnv } from './semantics/env';
import { type NameFacts, nameFacts, type NameResolution } from './semantics/names';

// What a command name is, for the badge of the panel and the kind the other outputs say (docs/design/name-kinds.md):
// the facts of src/semantics/names.ts (`nameFacts`, read from `resolveName`), with their texts from the catalog
// (src/messages.ts `nameSaid`) in the line's language. The analyzer puts it on the token of each command name.

/** On a token of a command name: what it is here, what else the same name is, and the texts of both. */
export interface NameInfo extends NameFacts {
  said: NameSaid;
}

/** Whether the dictionary describes a program of this name (not a builtin's entry). */
export const isProgram = (name: string): boolean => {
  const spec = lookupCommand(name);
  return !!spec && !spec.builtin;
};

/** The name facts of `res`, said in `lang`; `env`: where a command that runs it runs it (`sudo echo`). */
export function nameInfo(lang: Lang, res: NameResolution, shell?: Shell, env?: ExecEnv): NameInfo {
  const facts = nameFacts(res, { program: isProgram, ...(env ? { env } : {}), ...(shell ? { shell } : {}) });
  return { ...facts, said: nameSaid(lang, facts) };
}
