// What a builtin does to the shell's state, read from its parse by its spec (src/argv/spec.ts: `shellEffect`, and the
// values and operands of `type: 'variable'` or `'function'`). The walk of the state (src/semantics/walk/) and the
// trust scan (src/semantics/trust.ts) both read the effects here, so that they never disagree on what a builtin sets.
import { interpret, type ArgRole, type ArgvParse } from '../argv/interpret';
import type { CommandSpec, ValueSpec, VariableSet } from '../argv/spec';
import { argWord } from '../argv/words';
import type { Shell } from '../dialect';
import { builtins } from '../dict/builtins';
import { staticWordValue } from '../staticword';
import { field, type SyntaxNode } from '../syntax/tree';

/** The declaration builtins (their words may be assignments: `declare x=1`). */
export const DECLARATIONS: ReadonlySet<string> = new Set(['declare', 'typeset', 'local', 'export', 'readonly']);

/** `set` letters and the options they stand for. */
export const SET_LETTERS: Readonly<Record<string, string>> = {
  a: 'allexport', b: 'notify', e: 'errexit', f: 'noglob', h: 'hashall', k: 'keyword', m: 'monitor', n: 'noexec', p: 'privileged',
  t: 'onecmd', u: 'nounset', v: 'verbose', x: 'xtrace', B: 'braceexpand', C: 'noclobber', E: 'errtrace', H: 'histexpand', P: 'physical', T: 'functrace',
};

const names = new WeakMap<SyntaxNode, string | null>();
/** The static name of the simple command `c` (`'exit'` is `exit`), or undefined when it is not known here (`$cmd`) or it has none (`a=1`). */
export function commandName(c: SyntaxNode): string | undefined {
  let name = names.get(c);
  if (name === undefined) {
    // (A command with no name, `a=1`, has none.)
    const word = field(c, 'name')?.namedChildren[0];
    names.set(c, (name = (word && staticWordValue(word)) ?? null));
  }
  return name ?? undefined;
}

/** The name of the simple command `c` when bash may read it as an alias: a plain word, with no quote or expansion. */
export function aliasName(c: SyntaxNode): string | undefined {
  const word = field(c, 'name')!.namedChildren[0];
  const name = commandName(c);
  return word.type === 'word' && word.text === name ? name : undefined;
}

/**
 * `alias name=value` (or `'name=value'`): the name and what it stands for (static, or the text without its outer quotes).
 * A name is any text without a `/`, `$`, backquote, `=`, quote, blank or metacharacter (bash's `legal_alias_name`):
 * `[`, `{` and `a!b` are names too.
 */
export function aliasOf(a: SyntaxNode): { name: string; value: string } | undefined {
  const v = staticWordValue(a);
  const text = v ?? a.text;
  const m = /^([^\s/$`='"\\()<>;&|]+)=(['"]?)([\s\S]*)\2$/.exec(text);
  if (!m) return undefined;
  return { name: m[1], value: v !== undefined ? v.slice(v.indexOf('=') + 1) : m[3] };
}

/** The words of a builtin read with its spec (or `spec`: a function of the host, bats' `run`). */
export function builtinParse(name: string, args: readonly SyntaxNode[], spec = builtins[name]): ArgvParse {
  return interpret(spec, args.map(argWord), { name });
}

/**
 * What `command` or `builtin` with the words `args` runs, by the command slot of its spec: the command's name
 * (undefined: not known here) and its words; `lookup` when it runs nothing (`command -v x` only looks it up; `command`
 * alone).
 */
export function wrapped(name: 'command' | 'builtin', args: readonly SyntaxNode[]): { name: string | undefined; args: SyntaxNode[] } | { lookup: true } {
  const at = builtinParse(name, args).roles.find((r) => r.role.role === 'command');
  return at ? { name: staticWordValue(args[at.word]), args: args.slice(at.word + 1) } : { lookup: true };
}

/**
 * A variable a builtin sets: the word that names it (none for one the builtin knows: `REPLY`), its name (undefined: not
 * known here), how it sets it; `maybe`: or not at all.
 */
export interface VariableWrite { node: SyntaxNode | undefined; name: string | undefined; sets: VariableSet; maybe?: boolean }

/** The name a word gives a builtin (from `at` in its value: `-vx`), or undefined when it is not known here. */
export const wordName = (n: SyntaxNode, at = 0): string | undefined => staticWordValue(n)?.slice(at);

/** The values given in the parse (in their own word, or in the option's: `-vx`), with their specs. */
function givenValues(parse: ArgvParse): { word: number; at: number; spec: ValueSpec | undefined }[] {
  const out: { word: number; at: number; spec: ValueSpec | undefined }[] = [];
  for (const { word, role } of parse.roles) {
    if (role.role === 'value') out.push({ word, at: 0, spec: role.spec });
    for (const r of role.role === 'cluster' ? role.letters : [role]) {
      if ((r.role === 'option' || r.role === 'unknown-option') && r.value?.attached !== undefined) out.push({ word, at: r.value.attached, spec: r.value.spec });
    }
  }
  return out;
}

/**
 * The variables the builtin `spec` sets with the words `args` read as `parse` (`read -a NAME`, `printf -v NAME`,
 * `getopts OPTS NAME`, `mapfile NAME`, `wait -p NAME`), in order; its default (`REPLY`, `MAPFILE`) when no word names one,
 * and those it always sets (bats' `run`: `status`, `output`, `lines`).
 */
export function variableWrites(spec: CommandSpec, parse: ArgvParse, args: readonly SyntaxNode[]): VariableWrite[] {
  const out: VariableWrite[] = [];
  for (const v of givenValues(parse)) if (v.spec?.sets) out.push({ node: args[v.word], name: wordName(args[v.word], v.at), sets: v.spec.sets });
  for (const { word, role } of parse.roles) if (role.role === 'operand' && role.spec?.sets) out.push({ node: args[word], name: wordName(args[word]), sets: role.spec.sets });
  const byDefault = spec.shellEffect?.byDefault;
  if (!out.length && byDefault) out.push({ node: undefined, name: byDefault.name, sets: byDefault.sets });
  for (const v of spec.shellEffect?.always ?? []) out.push({ node: undefined, ...v });
  return out;
}

/** The words that name a function the builtin runs later (`mapfile -C f`, `complete -F f`), with their names (undefined: not known here). */
export function callbacks(parse: ArgvParse, args: readonly SyntaxNode[]): (string | undefined)[] {
  return givenValues(parse).filter((v) => v.spec?.type === 'function').map((v) => wordName(args[v.word], v.at));
}

/**
 * The options `set` turns on or off with the words `args` read as `parse`, in order (`set -e +e` turns errexit on,
 * then off: the last one wins): `-x`, `+x`, `-o name`, `+o name`. A letter `set` does not have is no option
 * (`set +Z` is an error), except ksh's `-G` (globstar). A name of `-o` not known here is `undefined`.
 */
export function setOptionWrites(parse: ArgvParse, args: readonly SyntaxNode[], shell?: Shell): { name: string | undefined; on: boolean }[] {
  const out: { name: string | undefined; on: boolean }[] = [];
  for (const { word, role } of parse.roles) {
    for (const r of role.role === 'cluster' ? role.letters : [role] as ArgRole[]) {
      if (r.role === 'option' || r.role === 'unknown-option') {
        const letter = r.flag.slice(1);
        const name = letter === 'G' && shell === 'ksh' ? 'globstar' : SET_LETTERS[letter];
        if (name) out.push({ name, on: r.flag[0] === '-' });
      } else if (r.role === 'value') {
        out.push({ name: staticWordValue(args[word]), on: r.of !== '+o' });
      }
    }
  }
  return out;
}
