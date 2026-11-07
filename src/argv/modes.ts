/** Options that cancel each other (xargs `-n1 -I{}`): which of them is in effect, and the text of those ignored. */
import type { CommandSpec } from './spec';
import type { ArgRole, ArgWord } from './interpret';

export type Ignoring = Map<ArgRole, { by: string }>;

/**
 * The modes of options that cancel each other (`ModeSpec.cancels`, `agreesWith`; xargs `-n2 -I{}`): the options read in
 * order, each one's effect on those in effect so far. Gives the mode still in effect (the last such option's) and, for
 * each option that is ignored, which option ignores it. Undefined for a spec whose modes do not. `words` are the
 * words of the line, for the value an option takes (`-n 1`, `-n1`, `-rn1`).
 */
export function settleModes(spec: CommandSpec, roles: [number, ArgRole][], words: readonly ArgWord[]): { mode?: string; ignored: Ignoring } | undefined {
  const modes = spec.modes ?? [];
  if (!modes.some((m) => m.cancels)) return undefined;
  const ignored: Ignoring = new Map();
  const live: { mode: string; role: Extract<ArgRole, { role: 'option' }> }[] = [];
  const byWord = new Map(roles);
  const visit = (word: number, role: ArgRole): void => {
    if (role.role === 'cluster') return role.letters.forEach((l) => visit(word, l));
    const m = role.role === 'option' ? modes.find((x) => x.name === role.spec.selects) : undefined;
    if (role.role !== 'option' || !m) return;
    const given = role.value ? words[word].value?.slice(role.value.attached) : byWord.get(word + 1)?.role === 'value' ? words[word + 1].value : undefined;
    // (An option that asks for nothing different from the mode in effect changes nothing: not in effect itself, not ignored. A value not known may be that one.)
    const same = m.agreesWith && live.some((l) => m.agreesWith!.modes.includes(l.mode)) && (given === undefined || (/^\d+$/.test(given) && Number(given) === m.agreesWith.value));
    if (same) return;
    for (let i = live.length - 1; i >= 0; i--) {
      if (!m.cancels?.includes(live[i].mode)) continue;
      ignored.set(live[i].role, { by: role.flag });
      live.splice(i, 1);
    }
    live.push({ mode: m.name, role });
  };
  roles.forEach(([word, role]) => visit(word, role));
  return { mode: live.at(-1)?.mode, ignored };
}

/** The text of an ignored option says so (`settleModes`): by which option. */
export function ignoring(role: ArgRole, ignored: Ignoring): ArgRole {
  if (role.role === 'cluster') return { ...role, letters: role.letters.map((l) => ignoring(l, ignored)) };
  const why = ignored.get(role);
  if (role.role !== 'option' || !why) return role;
  const { by } = why;
  const ja = `。後ろの \`${by}\` が取って代わるので、この指定は使われない`;
  const en = `. Ignored: the later \`${by}\` takes over`;
  return { ...role, text: { ja: role.text.ja + ja, en: role.text.en + en }, ignored: { by } };
}
