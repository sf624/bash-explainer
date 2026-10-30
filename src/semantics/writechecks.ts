// What the trust scan (src/semantics/trust.ts) checks of the values the script writes, once it has read the whole
// script: those read as arithmetic, as command names and as prompts, and those a builtin's words read
// (src/semantics/deferred.ts). Each check gives why nothing is trusted, if so.
import { builtins } from '../dict/builtins';
import { quietPrompt } from './allow';
import { alwaysNumeric, changedUnseen } from './vars';
import type { WrittenValue } from './written';

/**
 * What a write gives a variable: a number, nothing (unset), the value it had (`declare x` outside a function: maybe
 * one from the environment), text with these names in it (see `WrittenValue`), or text not known.
 */
export type Value = WrittenValue;

export interface Write {
  /** A plain assignment (see the head of src/semantics/trust.ts). */
  plain: boolean;
  value: Value;
  /** The function whose body holds it (undefined: the top level), and whether it is in the text of an eval, trap or alias. */
  fn: string | undefined;
  foreign: boolean;
  /** Made by a nameref declaration (`declare -n r=x`). */
  nameref?: boolean;
  /** Made by `+=` (`n+=1`): an integer adds to the value it had, which arithmetic reads (see `Scan.appended`). */
  append?: true;
}

/** The builtins a command name read from a variable may be (`debug=false; $debug`): they change nothing. */
const SAFE_BUILTINS = new Set(['true', 'false', ':', 'echo', 'test', '[']);

/**
 * The values of the names read as arithmetic (`arith`, to which it adds the names those values read) are run as
 * expressions: each must be text the script wrote.
 */
export function arithReads(arith: Set<string>, writesOf: ReadonlyMap<string, readonly Write[]>, refUnknown: ReadonlySet<string>): string | undefined {
  const queue = [...arith];
  const seen = new Set(queue);
  while (queue.length) {
    const name = queue.pop()!;
    if (alwaysNumeric(name)) continue;
    const writes = writesOf.get(name);
    if (!writes) return `arithmetic reads \`${name}\`, which the script never sets`;
    if (refUnknown.has(name)) return `arithmetic reads \`${name}\`, a nameref whose target is not known`;
    if (writes.every((w) => w.append)) return `arithmetic reads \`${name}\`, which only \`+=\` sets`;
    for (const w of writes) {
      if (w.value === 'unknown' && !w.nameref) return `arithmetic reads \`${name}\`, which may be set to text not known`;
      if (w.value === 'kept') return `arithmetic reads \`${name}\`, which a declaration may keep from the environment`;
      if (typeof w.value !== 'object') continue;
      for (const x of w.value.names) {
        if (!seen.has(x)) {
          seen.add(x);
          queue.push(x);
          arith.add(x);
        }
      }
    }
  }
  return undefined;
}

/**
 * A command named by a variable (`variables`): each value the script gives it must be a command that changes
 * nothing, or a function (which runs where the walk does not see it: added to `callbacks`); unquoted, not empty
 * (`cmd=; $cmd eval x=2` runs `eval`).
 */
export function commandNames(variables: readonly { name: string; quoted: boolean }[], writesOf: ReadonlyMap<string, readonly Write[]>, functions: ReadonlySet<string>, callbacks: Set<string>): string | undefined {
  const why = 'a command name not known';
  for (const { name, quoted } of variables) {
    const writes = writesOf.get(name) ?? [];
    if (!writes.length || (!quoted && writesOf.has('IFS'))) return why;
    for (const w of writes) {
      const v = w.value;
      if (!w.plain || typeof v !== 'object' || !v.fixed || (!quoted && (v.text === '' || /[\s*?[]/.test(v.text)))) return why;
      if (functions.has(v.text)) callbacks.add(v.text);
      else if (builtins[v.text] && !SAFE_BUILTINS.has(v.text)) return why;
    }
  }
  return undefined;
}

/**
 * PS4 (`ps4`: its writes, also through namerefs) is expanded before each command `set -x` traces (also `bash -x
 * script`): a value that may assign (arithmetic, `${x:=w}`, a subscript) or run a command changes the shell where the
 * walk does not see it.
 */
export function ps4Writes(ps4: readonly Write[]): string | undefined {
  // (A value kept from the environment is assumed quiet: README, Limitations.)
  const loud = (w: Write): boolean => w.value !== 'none' && w.value !== 'kept' && w.value !== 'number' && (w.value === 'unknown' || !w.value.fixed || !quietPrompt(w.value.text));
  return ps4.some(loud) ? 'PS4, which `set -x` expands before each command, may assign or run a command' : undefined;
}

/**
 * `${x@P}` (the variables `prompts`) expands the value again, as a prompt: each value the script gives it must run
 * nothing and assign nothing, and none may be added with `+=` (`x='\0'; x+='44((u=2))'` joins texts that are quiet
 * alone).
 */
export function promptReads(prompts: ReadonlySet<string>, writesOf: ReadonlyMap<string, readonly Write[]>, refUnknown: ReadonlySet<string>, refTargets: ReadonlySet<string>): string | undefined {
  for (const name of prompts) {
    const writes = writesOf.get(name);
    if (!writes || changedUnseen(name) || refUnknown.has(name) || refTargets.has(name)
      || writes.some((w) => w.append || w.value === 'unknown' || w.value === 'kept' || (typeof w.value === 'object' && (!w.value.fixed || !quietPrompt(w.value.text))))) {
      return 'a prompt expansion (`@P`) of a value that may run a command or assign';
    }
  }
  return undefined;
}

/**
 * Every value the script gives the variable `name` (`null`: unset) by its writes `writes`, where each is one the walk
 * follows: a plain assignment of text known in full (`x=-e`), or one that unsets it (`unset x`, `local x`).
 * Undefined where it may get another: one the script does not write (`read x`, `for x in`, `x=(…)`, `x[0]=`, `x+=y`,
 * `x=$y`, `${x:=w}`, `declare -l x`), a nameref or a nameref's target (`target`), or one bash sets (`REPLY`,
 * `OPTARG`, `_`).
 */
export function valuesWritten(name: string, writes: readonly Write[], target: boolean): (string | null)[] | undefined {
  if (changedUnseen(name) || target) return undefined;
  const texts = new Set<string | null>([null]);
  for (const x of writes) {
    if (x.value === 'none') continue;
    if (!x.plain || x.append || typeof x.value !== 'object' || !x.value.fixed) return undefined;
    texts.add(x.value.text);
  }
  return [...texts];
}
