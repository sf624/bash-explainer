// The state another shell starts with (`bash -c`, docs/design/semantics.md 4.13), for the walk of the shell state
// (src/semantics/walk/walker.ts): what reaches it from the script's shell, and the options it is started with.
import { SET_LETTERS } from '../effects';
import { RESTRICTED_READONLY } from '../vars';
import { type ExecEnv, reachOf } from '../env';
import type { FunctionState, OptionState, ShellState, Tri, VariableState } from '../shellstate';
import type { SyntaxNode } from '../../syntax/tree';
import { type ChildPass, NAME, passed, passedMemo } from './shared';
import type { Walker } from './walker';

/**
 * A restricted shell's start (`bash -r`, `rbash`, `#!/bin/bash -r`: Bash manual 6.10), as set at `at`: `shopt
 * restricted_shell` is on, and the variables of `RESTRICTED_READONLY` are read-only (with a value bash gives `SHELL`
 * and `PATH`, and the environment's, if any, to the others). What the restricted shell refuses is said where the
 * script does it (src/explain/), from this state.
 */
export function restrictedStart(st: ShellState, at: SyntaxNode): ShellState {
  let variables = st.variables;
  for (const name of RESTRICTED_READONLY) {
    const v = variables.get(name);
    const set: Tri = v ? v.set : name === 'SHELL' || name === 'PATH' ? 'on' : 'unknown';
    variables = variables.with(name, { ...(v ?? { declared: 'on', at }), set, attrs: { ...v?.attrs, r: { state: 'on', at } } });
  }
  return restrictedFromHere({ ...st, variables });
}

/**
 * `set -r`: the shell is restricted from here on (6.10), its variables as they were, as bash 5.2 does (5.3 also makes
 * those of `RESTRICTED_READONLY` read-only: docs/design/bash-versions.md). The state marks it with `shopt
 * restricted_shell` on, which bash itself leaves off after `set -r`.
 */
export function restrictedFromHere(st: ShellState): ShellState {
  return { ...st, shopt: st.shopt.with('restricted_shell', 'on') };
}

/**
 * The state another shell starts with (`bash -c`, docs/design/semantics.md 4.13): the variables of `outer` that
 * reach it through `env`, the slots of the command that starts it (`linksAfter`: what reached `outer` is in it)
 * (exported, with a value: an array is not passed), and those the slots set (`given`); the
 * exported functions, when it is bash and every link passes them; the set options with an exported SHELLOPTS, the
 * shopt options with an exported BASHOPTS (bash); then the options it is started with (`bash -e -O extglob -c`). A
 * shell that reads startup files (`-l`, `-i`, an exported BASH_ENV) may have any name the script has; one started
 * after code the outer walk does not read (`opaque`) may have any name that reaches it.
 */
export function childStart(w: Walker, outer: ShellState, env: ExecEnv, pass: ChildPass, at: SyntaxNode): ShellState {
  let st = w.initial(at);
  const exported = (name: string): boolean => (outer.variables.get(name)?.attrs.x?.state ?? 'off') === 'on';
  const reach = reachOf(env, exported('SHELLOPTS'));
  // (`sh` may be bash, which reads exported functions, SHELLOPTS and BASHOPTS, or dash, which reads none.)
  const bashLike: Tri = w.bash ? 'on' : w.shell === 'sh' ? 'unknown' : 'off';
  if (reach.variables !== 'none') {
    let vars = outer.variables.mapped(passed, passedMemo);
    for (const name of pass.removed) vars = vars.with(name, undefined);
    // (bash sets its own at start, whatever the environment gives.)
    st = { ...st, variables: vars.withAll(new Map(st.variables)) };
  }
  // (`env -i x=1 bash -c …` passes `x`.)
  for (const name of pass.given) if (NAME.test(name)) st = { ...st, variables: st.variables.with(name, { declared: 'on', set: 'on', attrs: { x: { state: 'on', at } }, at }) };
  if (reach.functions === 'exported' && bashLike !== 'off') {
    const fns = new Map<string, FunctionState>();
    for (const [name, f] of outer.functions) {
      if (f.state === 'off' || f.exported === 'off') continue;
      fns.set(name, { state: f.state === 'on' && f.exported === 'on' && bashLike === 'on' ? 'on' : 'unknown', def: f.def, exported: 'on', readonly: 'off', ...(bashLike === 'unknown' ? { imported: 'sh' as const } : {}) });
      // (Its body is walked where this shell calls it.)
      w.collectDefinitions(f.def);
    }
    st = { ...st, functions: st.functions.withAll(fns) };
  }
  // (bash turns on the options SHELLOPTS and BASHOPTS name; it turns none off.)
  const inherit = (kind: 'set' | 'shopt', on: boolean): void => {
    if (!on || bashLike === 'off') return;
    const opts = new Map<string, OptionState>();
    for (const [name, o] of outer[kind]) if (o === 'on' || o === 'unknown') opts.set(name, o === 'on' && bashLike === 'on' ? 'on' : 'unknown');
    st = { ...st, [kind]: st[kind].withAll(opts) };
  };
  // The options it is started with: `-e`, `+x`, `-o pipefail`, `-O extglob` (bash), `--posix`; `-l`, `-i` read startup files.
  let startup = false;
  let restricted = false;
  for (const { flag, value } of pass.invocation) {
    const on = flag[0] === '-';
    const letter = flag.slice(1);
    if (flag === '--posix') st = w.builtins.setPosix(st, true, at);
    else if (['-l', '--login', '-i'].includes(flag)) startup = true;
    else if (/^[-+]o$/.test(flag) && value) st = value === 'posix' ? w.builtins.setPosix(st, on, at) : { ...st, set: st.set.with(value, on ? 'on' : 'off') };
    else if (/^[-+]O$/.test(flag) && value) st = { ...st, shopt: st.shopt.with(value, on ? 'on' : 'off') };
    else if (SET_LETTERS[letter]) st = { ...st, set: st.set.with(SET_LETTERS[letter], on ? 'on' : 'off') };
    else if (flag === '-r' || flag === '--restricted') restricted = true;
  }
  // (Then bash turns on the options an exported SHELLOPTS and BASHOPTS name, also those turned off above.)
  inherit('set', reach.options !== 'none');
  inherit('shopt', reachOf(env, exported('BASHOPTS')).options !== 'none');
  // (A path before ran code the outer walk does not read, which may have exported any variable or function: where they
  // reach this shell, a name it has not set may be set, as `unlessUnread` says of the outer shell.)
  if (outer.opaque && reach.variables !== 'none') st = w.opaque(st);
  // bash runs the file an exported BASH_ENV names before the string: what it sets is not known, as for startup files.
  const bashEnv = st.variables.get('BASH_ENV');
  if (w.bash && bashEnv && bashEnv.set !== 'off' && bashEnv.value !== '') startup = true;
  if (startup) {
    st = w.opaque(st);
    // (What they run is not read: nothing is trusted.)
    if (!w.blind) w.walkAgain('another shell runs its startup files first');
    const vars = new Map<string, VariableState>();
    for (const [name, v] of outer.variables) if (!st.variables.has(name)) vars.set(name, { declared: 'unknown', set: 'unknown', attrs: {}, at: v.at });
    const fns = new Map<string, FunctionState>();
    for (const [name, f] of outer.functions) if (!st.functions.has(name)) fns.set(name, { state: 'unknown', def: f.def, exported: 'unknown', readonly: 'off', imported: 'startup' });
    st = { ...st, variables: st.variables.withAll(vars), functions: st.functions.withAll(fns) };
  }
  // (A restricted shell, `-r`: the restrictions apply after the startup files, 6.10.)
  return restricted ? restrictedStart(st, at) : st;
}
