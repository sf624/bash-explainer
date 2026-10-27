// The readers the explanation of most parts calls (docs/design/analyzer.md, step 3): what a name runs, the spec of a
// command, the shell options and the meaning of a word where a node is, and what the options of the command whose
// words are explained (`Explainer.command`) give. They read the models; the one text they make is `globOff`'s, the
// end of a note on a word that is not globbed.
import { givenOptions, has as hasOption, operands, restrictedRefusal, values } from '../argv/query';
import type { ArgvParse } from '../argv/interpret';
import type { CommandSpec } from '../argv/spec';
import { impliedWords, lookupCommand } from '../dict/aliases';
import { customCommandSpec } from '../dict/custom';
import type { Flavor } from '../embedded/regex';
import { isProgram } from '../namefacts';
import type { ExecEnv } from '../semantics/env';
import { type NameResolution, resolveName } from '../semantics/names';
import { attribute, type OptionState, shoptIn } from '../semantics/state';
import { type ExpansionStep, ifsOf, type WordMeaning, wordMeaning } from '../semantics/words';
import { literalContent, staticWordValue, surelyHasSlash } from '../staticword';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';
import { same } from './nodes';

const SHOPT_NAMES = ['globstar', 'dotglob', 'nocaseglob', 'nocasematch', 'nullglob', 'failglob', 'extglob', 'lastpipe', 'expand_aliases'] as const;
export type ShoptName = typeof SHOPT_NAMES[number];
/** An option's state (see `OptionState`), or `unsupported` in a shell that does not have it. */
export type ShoptState = OptionState | 'unsupported';
export type ShoptStates = Record<ShoptName, ShoptState>;

/** What the command name `name` runs at `at` (src/semantics/names.ts). */
export function resolve(cx: Explainer, name: string, at: SyntaxNode, opts: { quoted?: boolean; env?: ExecEnv } = {}): NameResolution {
  return resolveName(cx.state, name, at, { shell: cx.shell, command: true, program: isProgram, ...opts });
}

/** The spec of a command a wrapper runs: from the customCommands setting, the host, or the dictionary. */
export function specFor(cx: Explainer, name: string): CommandSpec | undefined {
  return customCommandSpec(cx.opts.customCommands?.[name.split('/').pop()!]) ?? hostCommand(cx, name) ?? lookupCommand(name);
}

/** The spec of a command with none: no options, no operands. */
export const NO_SPEC: CommandSpec = { summary: { ja: '', en: '' } };

/** A command the host defines (a function of bats, which a path does not name). */
export function hostCommand(cx: Explainer, name: string): CommandSpec | undefined {
  const host = cx.opts.hostCommands;
  return host && Object.hasOwn(host, name) ? host[name] : undefined;
}

/**
 * Whether `n` runs in a restricted shell (`#!/bin/bash -r`, `bash -r -c`, `rbash`: Bash manual 6.10), from the state
 * there: `shopt restricted_shell` is on (src/semantics/walk/child.ts, `restrictedStart`).
 */
export function restrictedAt(cx: Explainer, n: SyntaxNode): boolean {
  return shoptIn(cx.state.at(n).run, 'restricted_shell', cx.shell) === 'on';
}

/**
 * What a restricted shell refuses of this call of a builtin at `at` (`restrictedRefusal`): the word bash names, or
 * undefined. `words` are those after its name; a file is named with a `/` when its word surely has one, known or not
 * (`. "$d/lib.sh"`, `. ~/x`: `surelyHasSlash`).
 */
export function restrictedCall(cx: Explainer, at: SyntaxNode, spec: CommandSpec, parse: ArgvParse, words: readonly SyntaxNode[]): { word?: string } | undefined {
  if (!restrictedAt(cx, at)) return undefined;
  return restrictedRefusal(spec, parse, words.map((a) => staticWordValue(a) ?? (surelyHasSlash(a) ? a.text : undefined)));
}

/** The shell options at `n` (src/semantics/state.ts): when it runs, or (`parse`) when bash read it. */
export function shoptAt(cx: Explainer, n: SyntaxNode, when: 'run' | 'parse' = 'run'): ShoptStates {
  const st = cx.state.at(n)[when];
  return Object.fromEntries(SHOPT_NAMES.map((name) => [name, shoptIn(st, name, cx.state.shell)])) as ShoptStates;
}

/** The meaning of the word that holds `n` (src/semantics/words.ts). */
export function wordAt(cx: Explainer, n: SyntaxNode): WordMeaning | undefined {
  return wordMeaning(n, cx.state);
}

/**
 * What to say of a word with `*` or `?` that is not globbed where it is (`set -f`, or a redirection target in
 * POSIX mode): it stays as it is. Empty when it is globbed; `may` when `set -f` is on some paths only.
 */
export function globOff(cx: Explainer, n: SyntaxNode): string {
  const glob = wordAt(cx, n)?.steps.find((s) => s.kind === 'glob');
  if (!glob || glob.applies === true) return '';
  if (glob.why === 'noglob') {
    return glob.applies === false
      ? cx.s('。ただし `set -f`（`set -o noglob`）でグロブが無効になっているので、展開されずこの文字のまま渡される', '. But `set -f` (`set -o noglob`) has turned globbing off, so it is not expanded and stays as written')
      : '';
  }
  return glob.why === 'posix-mode' && glob.applies === false
    ? cx.s('。ただし POSIX モードではリダイレクト先はグロブ展開されないので、この名前のファイルになる', '. But in POSIX mode a redirection target is not globbed: the file has this very name')
    : '';
}

/** The IFS where `n` runs (src/semantics/words.ts): its characters, or undefined when it is not known there. */
export function ifsAt(cx: Explainer, n: SyntaxNode): string | undefined {
  const ifs = ifsOf(cx.state.at(n).run);
  return ifs.kind === 'default' ? ' \t\n' : ifs.kind === 'value' ? ifs.value : undefined;
}

/** Whether a glob step is off by `set -f`, may be (on some paths), or on. */
export function globState(glob: ExpansionStep): 'off' | 'may' | 'on' {
  return glob.why === 'noglob' ? (glob.applies === false ? 'off' : 'may') : 'on';
}

/** The text of an unquoted word (or concatenation of unquoted parts), where braces and globs take effect. */
export function unquotedWord(a: SyntaxNode): string | undefined {
  const plain = (x: SyntaxNode) => x.type === 'word' || x.type === 'number' || x.type === 'brace_expression';
  if (plain(a) || (a.type === 'concatenation' && a.namedChildren.every(plain))) return a.text;
  return undefined;
}

/** Whether `name` is an associative array (`declare -A`) where `n` runs: its subscripts are strings, not arithmetic. */
export function isAssoc(cx: Explainer, name: string, n: SyntaxNode): boolean {
  return arrayKind(cx, name, n) === 'assoc';
}

/**
 * Whether the array `name` is associative where `n` runs (its subscripts are keys), surely indexed (they are
 * arithmetic), or either. A nameref is followed to the name it refers to. Indexed needs the `A` attribute off for
 * sure: not after a file read with `source` or anything else the model does not read (`declare -A "$v"`, `$cmd`).
 */
export function arrayKind(cx: Explainer, name: string, n: SyntaxNode): 'assoc' | 'indexed' | 'unknown' {
  const st = cx.state.at(n).run;
  // (Namerefs that refer to each other: bash warns of a circular reference.)
  const seen = new Set<string>();
  while (!seen.has(name)) {
    seen.add(name);
    const ref = attribute(st, name, 'n');
    const target = st.variables.get(name)?.value;
    if (ref === 'unknown' || (ref === 'on' && !/^[A-Za-z_]\w*$/.test(target ?? ''))) return 'unknown';
    if (ref === 'off') {
      const a = attribute(st, name, 'A');
      return a === 'on' ? 'assoc' : a === 'unknown' || st.opaque || unseenDeclarations(cx) ? 'unknown' : 'indexed';
    }
    name = target!;
  }
  return 'unknown';
}

/**
 * Whether the script may declare a variable the model does not see (`declare -A "$v"`, `$cmd`, `source`; why the model
 * is blind, src/semantics/trust.ts), not only read text it does not know as arithmetic, use a subscript the trust
 * cannot place, or run a trap that may break a loop: those declare nothing.
 */
function unseenDeclarations(cx: Explainer): boolean {
  const why = cx.state.blind;
  return why !== undefined && !/^(?:arithmetic |an integer variable |indirect expansion|`\w+` may not be associative|a trap's action may end)/.test(why);
}

export function inArithmetic(n: SyntaxNode): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === 'arithmetic_expansion' || p.type === 'c_style_for_statement') return true;
    if (p.type === 'arithmetic_command') return true;
    if (p.type === 'extended_test' || p.type === 'compound_statement') return false;
  }
  // Unary and binary expressions are always inside a test or arithmetic.
  /* c8 ignore next */
  return false;
}

/** Whether the current command is given the option `names` name, written in any of its forms (src/argv/query.ts). */
export function given(cx: Explainer, ...names: string[]): boolean {
  return hasOption(cx.command!.parse, ...names);
}

/**
 * The values given to the option `names` name, in order, with the option as written (`of`) and which of its
 * values each is; `text` is the value's text when it is plain text (also in the option's word: `-efoo`).
 */
export function optionValues(cx: Explainer, ...names: string[]): { text?: string; of: string; index: number }[] {
  const { nodes, parse } = cx.command!;
  return values(parse, ...names).map(({ word, at, role }) => ({ text: literalContent(nodes[word])?.text.slice(at ?? 0), of: role.of, index: role.index }));
}

/**
 * The regex dialect of the current command: the modes its options select (`selects` in its spec: grep's `-E`, `-F`,
 * `-P`, sed's `-E`), with those of the words its name implies (`egrep` is `grep -E`); BRE when none does.
 */
export function regexFlavor(cx: Explainer): Flavor | 'fixed' {
  const { cmd, parse, spec } = cx.command!;
  const implied = impliedWords(cmd.split('/').pop()!).map((w) => spec.options?.find((o) => o.names.includes(w))?.selects);
  const selected = new Set([...givenOptions(parse).map(({ role }) => (role.role === 'option' ? role.spec.selects : undefined)), ...implied]);
  return selected.has('pcre') ? 'pcre' : selected.has('fixed') ? 'fixed' : selected.has('ere') ? 'ere' : 'bre';
}

/** How tr uses the set in `a`: its position among the sets (the operands) and the -d/-s options. */
export function trContext(cx: Explainer, a: SyntaxNode): { role: 'from' | 'to' | 'delete' | 'squeeze'; sets: string[] } {
  const { nodes, parse } = cx.command!;
  const sets = operands(parse).map(({ word }) => nodes[word]);
  const idx = sets.findIndex((w) => same(w, a));
  const lits = sets.map((w) => literalContent(w)?.text ?? w.text);
  if (given(cx, '-d')) return { role: idx === 0 ? 'delete' : 'squeeze', sets: lits };
  if (given(cx, '-s') && sets.length === 1) return { role: 'squeeze', sets: lits };
  return { role: idx === 0 ? 'from' : 'to', sets: lits };
}
