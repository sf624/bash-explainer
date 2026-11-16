// What makes a command refuse its line, as the argument interpreter reads it (src/argv/interpret.ts): options that select
// different modes (`grep -E -F`: `ArgvParse.refused`), and a value the command refuses (`cut -d ab`: `ArgvParse.refusedValue`).
import type { ArgRole, ArgWord, RoleAt, ValueRole } from './interpret';
import type { CommandSpec } from './spec';

/**
 * Marks the values of known text the command refuses (`ValueSpec.refuses`: `cut -d ab`, `-dab`, `--delimiter=ab`) as
 * `invalid`; whether there is one.
 */
export function refusedValues(roles: readonly RoleAt[], words: readonly ArgWord[]): boolean {
  let found = false;
  const check = (v: ValueRole | undefined, text: string | undefined): void => {
    const why = v?.spec?.refuses && text !== undefined ? v.spec.refuses(text) : undefined;
    if (!why) return;
    v!.invalid = why;
    found = true;
  };
  for (const { word, role } of roles) {
    for (const r of role.role === 'cluster' ? role.letters : [role]) {
      if (r.role === 'value') check(r, words[word].value);
      else if (r.role === 'option' && r.value?.attached !== undefined) check(r.value, words[word].value?.slice(r.value.attached));
    }
  }
  return found;
}

/**
 * `grep -E -F`: with `conflictingModes`, an option that selects another mode than the first one given says that
 * the tool refuses the line. `first` holds the mode of the first such option, over the words in order, and
 * whether the line is refused.
 */
export function conflicting(spec: CommandSpec, role: ArgRole, first: { mode?: string; refused?: boolean }): ArgRole {
  if (!spec.conflictingModes) return role;
  if (role.role === 'cluster' || role.role === 'old-style') return { ...role, letters: role.letters.map((l) => conflicting(spec, l, first)) };
  if (role.role !== 'option' || !role.spec.selects) return role;
  first.mode ??= role.spec.selects;
  if (role.spec.selects === first.mode) return role;
  const why = spec.conflictingModes;
  first.refused = true;
  return { ...role, text: { ja: `${role.text.ja}。${why.ja}`, en: `${role.text.en}. ${why.en}` } };
}
