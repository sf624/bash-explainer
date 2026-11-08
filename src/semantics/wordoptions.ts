// The state where a word is expanded (src/semantics/words.ts): the options a word's meaning reads, POSIX mode, the
// glob options, the IFS and braceexpand, kept per state; and how a shell other than bash changes them (`wordsFollowed`).
import { type Shell } from '../dialect';
import { wordsFollowed } from '../shellfeatures';
import { defaultOn, option, type OptionState, type ShellState, type Tri } from './state';
import type { GlobState, IfsState } from './words';

export const on = (s: OptionState, kind: 'set' | 'shopt', name: string, posix: boolean): Tri =>
  s === 'default' ? (defaultOn(kind, name, posix) ? 'on' : 'off') : s;

/** The IFS of a state. */
export function ifsOf(st: ShellState): IfsState {
  const v = st.variables.get('IFS');
  if (!v || v.set === 'off') return { kind: 'default' };
  return v.set === 'on' && v.value !== undefined ? { kind: 'value', value: v.value, at: v.at } : { kind: 'unknown', at: v.at };
}

function globOf(st: ShellState, posix: boolean): GlobState {
  const opt = (kind: 'set' | 'shopt', name: string): Tri => on(option(st, kind, name), kind, name, posix);
  const gi = st.variables.get('GLOBIGNORE');
  return {
    noglob: opt('set', 'noglob'), nullglob: opt('shopt', 'nullglob'), failglob: opt('shopt', 'failglob'), dotglob: opt('shopt', 'dotglob'),
    nocaseglob: opt('shopt', 'nocaseglob'), extglob: opt('shopt', 'extglob'), globstar: opt('shopt', 'globstar'), globskipdots: opt('shopt', 'globskipdots'),
    globignore: !gi || gi.set === 'off' || gi.value === '' ? 'unset' : gi.set === 'on' && gi.value !== undefined ? { value: gi.value } : 'unknown',
  };
}

/** What the meaning of a word reads of its state: POSIX mode, the glob options, the IFS, braceexpand. */
export interface WordOptions { posix: Tri; glob: GlobState; ifs: IfsState; braceOpt: Tri; ofShell?: Map<Shell, WordOptions> }
const NONE = {};
type OptionsCache = WeakMap<object, WeakMap<object, WeakMap<object, WeakMap<object, WordOptions>>>>;
const stateOptions: OptionsCache = new WeakMap();
/**
 * The options of `st` that words read: one object for the states that share them (the same `set` and `shopt` maps,
 * IFS and GLOBIGNORE), so that the meanings of a word can be kept by it (`Shape.walked`).
 */
export function optionsOf(st: ShellState, shell?: Shell): WordOptions {
  const keys: object[] = [st.set, st.shopt, st.variables.get('IFS') ?? NONE, st.variables.get('GLOBIGNORE') ?? NONE];
  let m = stateOptions as WeakMap<object, unknown>;
  for (const k of keys.slice(0, -1)) {
    let next = m.get(k) as WeakMap<object, unknown> | undefined;
    if (!next) m.set(k, (next = new WeakMap()));
    m = next;
  }
  let o = m.get(keys[3]) as WordOptions | undefined;
  if (!o) {
    const posix = on(option(st, 'set', 'posix'), 'set', 'posix', false);
    o = { posix, glob: globOf(st, posix === 'on'), ifs: ifsOf(st), braceOpt: on(option(st, 'set', 'braceexpand'), 'set', 'braceexpand', false) };
    m.set(keys[3], o);
  }
  // (The shell is part of what a meaning is kept by: the models of one script for two shells share the states.)
  if (!shell || shell === 'bash') return o;
  const ofShell = (o.ofShell ??= new Map<Shell, WordOptions>());
  return ofShell.get(shell) ?? ofShell.set(shell, { ...o, ...(wordsFollowed(shell) ? { posix: 'on' as const, glob: globIn(o.glob, shell) } : {}), ofShell: undefined }).get(shell)!;
}

/**
 * The glob options of the common sh (`wordsFollowed`), which has `set -f` and none of bash's `shopt` options
 * (`shoptIn` says so to the explanations): each is off, `globskipdots` too (dash and busybox ash match `.` and `..` with `.*`), and GLOBIGNORE is
 * an ordinary variable. In `sh`, which may also be bash in POSIX mode (macOS), `globskipdots` is not known, nor a
 * GLOBIGNORE the script sets.
 */
function globIn(g: GlobState, shell: Shell): GlobState {
  const sh = shell === 'sh';
  return {
    noglob: g.noglob, nullglob: 'off', failglob: 'off', dotglob: 'off', nocaseglob: 'off', extglob: 'off', globstar: 'off',
    globskipdots: sh ? 'unknown' : 'off', globignore: sh && g.globignore !== 'unset' ? 'unknown' : 'unset',
  };
}
