import type { Shell } from './dialect';
import { lookupCommand } from './dict/aliases';
import { builtins } from './dict/builtins';
import type { Lang } from './i18n';
import { nameSaid, type NameSaid } from './messages';
import type { ExecEnv } from './semantics/env';
import { type NameFacts, nameFacts, type NameResolution, resolveName } from './semantics/names';
import type { StateModel } from './semantics/state';
import type { SyntaxNode } from './syntax/tree';

// What a command name is, for the badge of the panel and the kind the other outputs say (docs/design/name-kind.md):
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

/** The usual path of the program of this name, when the dictionary gives one (`CommandSpec.path`). */
const programPath = (name: string): string | undefined => (Object.hasOwn(builtins, name) ? builtins[name].program : lookupCommand(name))?.path;

/**
 * The name facts of `res`, the name at `at` (its command name, word or reserved word) in the script of `cx`, said in
 * `lang`; `env`: where a command that runs it runs it (`sudo echo`). The other meanings are reached from where the
 * name is, in the shell around that command.
 */
export function nameInfo(lang: Lang, res: NameResolution, cx: { state: StateModel; shell?: Shell }, at: SyntaxNode, env?: ExecEnv): NameInfo {
  const last = env?.links[env.links.length - 1];
  const around = last?.kind === 'slot' && (last.slot.run === 'exec' || last.slot.lookup) ? { links: env!.links.slice(0, -1) } : env;
  const shell = cx.shell ? { shell: cx.shell } : {};
  const facts = nameFacts(res, {
    program: isProgram, path: programPath, ...(env ? { env } : {}), ...shell,
    lookup: (o) => resolveName(cx.state, res.name, at, { ...shell, program: isProgram, ...(around?.links.length ? { env: around } : {}), ...o }),
  });
  return { ...facts, said: nameSaid(lang, facts) };
}
