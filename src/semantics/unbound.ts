// Where a script reads a variable that is unset under `set -u`, and bash fails ("`x: unbound variable`"): read from
// the shell state (src/semantics/state.ts) and said by src/wordfacts.ts (`nounset-unbound`, src/messages.ts).
// test/fixtures/probes/words.json checks it against bash (each row's `unbound`).
import type { Shell } from '../dialect';
import { parseExpansion } from '../expansion';
import { ancestor, descendants, field, fields, type SyntaxNode } from '../syntax/tree';
import { processOf, STATEMENTS } from './env';
import { resolveName } from './names';
import { attribute, option, type StateModel } from './state';
import { conditionOf, statusModel } from './status';
import { unreliableNames } from './words';

/** The nodes an arithmetic name may be in and still be read whenever the expression runs: not after `&&`, `||` or `?`. */
const ARITH_EVERY = new Set(['binary_expression', 'unary_expression', 'postfix_expression', 'parenthesized_expression', 'ternary_expression']);

/** A read that bash fails on under `set -u` (`unboundRead`). */
export interface UnboundRead {
  /** The parameter as bash names it in its error (`x`, `a[0]`), and the variable. */
  shown: string;
  name: string;
  /**
   * What stops: the script's shell, a subshell of it (`$( )`, a pipeline's stage), the shell running it (not known
   * which), or only the command, which fails with status 1 (a redirection of a program, made in its own process).
   */
  exits: 'script' | 'subshell' | 'shell' | 'command';
  /** Whether the variable may still come from the environment: not after `unset x`, nor in a function after `local x`. */
  environment: boolean;
}

/** The redirections whose words, or here-document, the shell expands for the command. */
const REDIRECTS = new Set(['file_redirect', 'herestring_redirect', 'heredoc_redirect']);

/**
 * The parameter that `n` surely reads unset under `set -u`, where bash fails ("`x: unbound variable`") and the shell
 * running it exits. `n` is an expansion (`$x`, `${x}`, `${#x}`, `${x[0]}`, `${x:1}`, `${x#p}`…: not `${x-w}`,
 * `${x:+w}`, `${x=w}`, `${x?w}`, `${!x}`, `${a[@]}`, nor a special or positional parameter), or a name read in `$(( ))`
 * or `(( ))` wherever the expression runs. Said only when it is so on every path: `set -u` is on, and the variable has
 * no value there (`declare x`, `unset x`, or set by no command before), the model trusts what it saw (not blind;
 * nothing it does not read ran on the way; a function body only when every call is seen), nothing earlier in the
 * same command sets it (`a=1 b=$a`, `${x:=1} $x`), no condition that the read depends on reads the name (`[[ -v x
 * ]] && echo "$x"`: the script tests it first), and no statement before it tests the name (`testedBefore`). A name
 * in capitals, which may come from the environment (as the variables bash sets itself), is left out. In a redirection or a here-document of a program (`cat < "$f"`), bash
 * fails in the program's own process: only the command fails, with status 1; other shells (dash) differ there, so a
 * redirection or a here-document is read for bash only (and a redirection of a builtin elsewhere).
 */
export function unboundRead(n: SyntaxNode, model: StateModel, shell?: Shell): UnboundRead | undefined {
  if (model.blind) return undefined;
  let name: string;
  let shown: string;
  if (n.type === 'simple_expansion') {
    name = shown = n.text.slice(1);
  } else if (n.type === 'expansion') {
    const p = n.startPosition.row === n.endPosition.row ? parseExpansion(n.text) : undefined;
    if (!p || p.prefix === '!' || (p.op && /^:?[-=+?]$/.test(p.op)) || (p.subscript !== undefined && !/^\w+$/.test(p.subscript))) return undefined;
    name = p.name;
    shown = p.subscript === undefined ? name : `${name}[${p.subscript}]`;
  } else {
    let x = n;
    while (x.parent && ARITH_EVERY.has(x.parent.type)) {
      const up = x.parent;
      if (up.type === 'ternary_expression' && up.namedChildren[0] !== x) return undefined;
      const op = up.type === 'binary_expression' ? field(up, 'operator')?.type : undefined;
      if ((op === '&&' || op === '||') && x.field === 'right') return undefined;
      if (op === '=' && x.field === 'left') return undefined;
      x = up;
    }
    if (n.type !== 'variable_name' || !(x.parent?.type === 'arithmetic_expansion' || x.parent?.type === 'arithmetic_command')) return undefined;
    name = shown = n.text;
  }
  if (!/^[A-Za-z_]\w*$/.test(name) || name === name.toUpperCase()) return undefined;
  const bash = !shell || shell === 'bash';
  if (!bash && ancestor(n, (a) => a.type === 'heredoc_body')) return undefined;
  const st = model.at(n).run;
  if (option(st, 'set', 'nounset') !== 'on' || st.opaque) return undefined;
  const statement = ancestor(n, (a) => STATEMENTS.has(a.type))!;
  if (model.dead(statement) || setBefore(statement, n, name) || unreliableNames(n).has(name) || guarded(n, name) || testedBefore(n, statement, name)) return undefined;
  const isFunction = (a: SyntaxNode): boolean => a.type === 'function_definition';
  for (let fn = ancestor(n, isFunction); fn; fn = ancestor(fn, isFunction)) {
    if (!model.closed(field(fn, 'name')!.text) || !model.calls.get(fn)?.size) return undefined;
  }
  let program = false;
  const redirect = ancestor(n, (a) => REDIRECTS.has(a.type));
  const command = redirect?.parent?.type === 'command' && field(redirect.parent, 'name') ? ranBy(redirect.parent, model) ?? null : undefined;
  if (command === null) return undefined;
  if (command) {
    const r = /^[\w./+-]+$/.test(command.text) ? resolveName(model, command.text, command, { command: true }) : undefined;
    // (`command f` runs no function: it looks `f` up as a builtin or a file.)
    if (command !== field(redirect!.parent!, 'name') && r?.kind === 'function') return undefined;
    program = bash && r?.kind === 'file' && !r.missed && !r.disabled && !r.sourced;
    if (!program && !((r?.kind === 'builtin' && !r.missed && !r.disabled) || (r?.kind === 'function' && r.sure))) return undefined;
  }
  const v = st.variables.get(name);
  // (Unset on every path. A nameref is left out: what it reads is its target's.)
  if (v && (v.set !== 'off' || attribute(st, name, 'n') !== 'off')) return undefined;
  const p = processOf(model.env(n));
  const exits = program ? 'command' : !p.sure ? 'shell' : p.kind === 'main' ? 'script' : p.kind === 'subshell' ? 'subshell' : 'shell';
  return { shown, name, exits, environment: !v || !removed(v.at, n) };
}

const firstCache = new WeakMap<StateModel, Map<string, WeakMap<SyntaxNode, SyntaxNode | undefined>>>();

/**
 * The read that bash fails on first (`unboundRead`) in the statement of `n` (not in a statement or a substitution
 * inside it), in the order bash expands a simple command: its words, then its assignments (`a=$x echo "$y"` fails
 * on `y`), then its redirections, each in turn (a here-document where its operator is). Bash expands no more of
 * the statement after it, so the reads after it are not said to fail.
 */
export function firstUnbound(n: SyntaxNode, model: StateModel, shell?: Shell): SyntaxNode | undefined {
  const s = ancestor(n, (a) => STATEMENTS.has(a.type))!;
  let byShell = firstCache.get(model);
  if (!byShell) firstCache.set(model, (byShell = new Map()));
  let cache = byShell.get(shell ?? 'bash');
  if (!cache) byShell.set(shell ?? 'bash', (cache = new WeakMap()));
  if (cache.has(s)) return cache.get(s);
  const top = (d: SyntaxNode): SyntaxNode => {
    let x = d;
    while (x.parent !== s) x = x.parent!;
    return x;
  };
  const rank = (d: SyntaxNode): number => {
    const t = top(d);
    return s.type !== 'command' ? 0 : t.type === 'variable_assignment' && t.field !== 'argument' ? 1 : t.field === 'redirect' ? 2 : 0;
  };
  const key = (d: SyntaxNode): number[] => [rank(d), s.children.indexOf(top(d)), d.startIndex];
  const before = (a: number[], b: number[]): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const reads = descendants(s, ['simple_expansion', 'expansion', 'variable_name'])
    .filter((d) => ancestor(d, (a) => STATEMENTS.has(a.type)) === s).map((d) => ({ d, k: key(d) })).sort((a, b) => before(a.k, b.k));
  const first = reads.find(({ d }) => unboundRead(d, model, shell))?.d;
  cache.set(s, first);
  return first;
}

/**
 * Whether `set -e` stops the shell when the simple command of `n` fails (in a redirection of a program): where
 * errexit is on and not ignored, the script, or the subshell that runs it.
 */
export function errexitStops(n: SyntaxNode, model: StateModel, shell?: Shell): 'script' | 'subshell' | undefined {
  const c = statusModel(model, shell).errexit(ancestor(n, (a) => a.type === 'command')!);
  return c.active === 'on' && c.checked === true && c.stops !== 'unknown' ? c.stops : undefined;
}

/**
 * The word that names what the command `c` runs, for its redirections: its name, or after `command` (without `-v` or
 * `-V`: then it is the builtin `command` that runs) the first word that is not an option (`command -p cat < "$f"`:
 * `cat`, made in a process of its own). Undefined when the command has no name, or `command` has no such word or
 * its options are not plain.
 */
function ranBy(c: SyntaxNode, model: StateModel): SyntaxNode | undefined {
  const name = field(c, 'name');
  if (name?.text !== 'command') return name;
  if (resolveName(model, 'command', name, { command: true }).kind !== 'builtin') return undefined;
  const words = fields(c, 'argument');
  let i = 0;
  for (; /^-/.test(words[i]?.text ?? '') && words[i].text !== '--'; i++) {
    if (!/^-p+$/.test(words[i].text)) return /^-[pvV]+$/.test(words[i].text) ? name : undefined;
  }
  if (words[i]?.text === '--') i++;
  // (`command command cat`: the second runs `cat`.)
  return words[i] && words[i].text !== 'command' ? words[i] : undefined;
}

/**
 * Whether `n` is in the value of an assignment that an assignment before it in the same command sets `name` for
 * (`a=1 b=$a`). Not in the words of the command, which bash expands first (`x=1 echo "$x"`), nor in the operands of
 * `declare`. (What `${x:=w}` and arithmetic assign is in `unreliableNames`.)
 */
function setBefore(statement: SyntaxNode, n: SyntaxNode, name: string): boolean {
  const plain = (a: SyntaxNode): boolean => a.type === 'variable_assignment' && a.field !== 'argument';
  return !!ancestor(n, plain) && descendants(statement, ['variable_assignment']).some((d) => d.endIndex <= n.startIndex && plain(d) && field(d, 'name')!.text === name);
}

/**
 * Whether `c` reads the variable `name` or tests it: an expansion of it (`${x+set}`, `"${x:-}"`), a name in
 * arithmetic, the operand of `-v` (`[[ -v x ]]`, `[ -v x ]`), or `declare -p x`.
 */
function reads(c: SyntaxNode | undefined, name: string): boolean {
  // (`$x` is read by its `variable_name`.)
  return !!c && descendants(c, ['expansion', 'variable_name', 'word']).some((d) => {
    if (d.type === 'expansion') return parseExpansion(d.text)?.name === name;
    if (d.text !== name) return false;
    if (d.type === 'variable_name') return d.parent?.type !== 'variable_assignment';
    const up = d.parent!;
    return up.children[up.children.indexOf(d) - 1]?.text === '-v' || (up.type === 'command' && /^(?:declare|typeset)$/.test(field(up, 'name')!.text));
  });
}

/**
 * Whether the read runs only after a test that reads the same name: in a branch of an `if` or `case`, the body of a
 * loop, or the right side of `&&` or `||` (in a list or in `[[ ]]`) whose condition reads it (`reads`). The test may
 * be what keeps it from running unset.
 */
function guarded(n: SyntaxNode, name: string): boolean {
  const names = (c: SyntaxNode | undefined): boolean => reads(c, name);
  for (let x = n; x.parent; x = x.parent) {
    const p = x.parent;
    switch (p.type) {
      case 'list': if (x !== p.namedChildren[0] && names(p.namedChildren[0])) return true; break;
      case 'binary_expression': {
        const op = field(p, 'operator')?.type;
        if ((op === '&&' || op === '||') && x.field === 'right' && names(field(p, 'left'))) return true;
        break;
      }
      case 'if_statement': case 'elif_clause': case 'while_statement': {
        // (An `elif` or `else` runs after the conditions of the `elif`s before it too.)
        const conditions = [p, ...p.namedChildren.filter((c) => c.type === 'elif_clause' && c.endIndex <= x.startIndex)].flatMap((c) => conditionOf(c)!);
        if (!conditions.includes(x) && conditions.some(names)) return true;
        break;
      }
      case 'for_statement': case 'select_statement':
        if (x.field === 'body' && p.namedChildren.some((c) => c.field !== 'body' && names(c))) return true;
        break;
      case 'case_statement': if (x.type === 'case_item' && names(field(p, 'value'))) return true; break;
    }
  }
  return false;
}

/** The guarding reads of each name in a tree (`guards`), cached per root. */
const guardCache = new WeakMap<SyntaxNode, Map<string, SyntaxNode[]>>();

/**
 * Whether a read before the statement `statement` of `n` tests the variable `name`, or ends the shell when it is not
 * set (`guards`): `[[ -v x ]] || exit 1`, `[ -z "${x:-}" ] && die`, `if [ -z "${x-}" ]; then return 1; fi`, `:
 * "${x:?}"`. What follows such a test is often what runs only when it passed: without following the flow through
 * the test (which the model does not do), the read is not said to fail. In a function, a test anywhere outside it
 * counts too (it may run before the call).
 */
function testedBefore(n: SyntaxNode, statement: SyntaxNode, name: string): boolean {
  let root = n;
  while (root.parent) root = root.parent;
  let byName = guardCache.get(root);
  if (!byName) guardCache.set(root, (byName = guards(root)));
  const fn = ancestor(n, (a) => a.type === 'function_definition');
  const outside = (d: SyntaxNode) => !!fn && (d.endIndex <= fn.startIndex || d.startIndex >= fn.endIndex);
  return (byName.get(name) ?? []).some((d) => d.endIndex <= statement.startIndex || outside(d));
}

/**
 * The reads of each name that test whether it is set, or end the shell when it is not: `${x?w}`, `${x:?w}`,
 * `${x=w}` and `${x:=w}` anywhere; the operand of `-v` (`[[ -v x ]]`, `[ -v x ]`); and in a test or a condition (`[[
 * ]]`, `[`, `test`, the condition of an `if` or a loop, the left side of `&&` or `||`), `${x-w}`, `${x:-w}`,
 * `${x+w}`, `${x:+w}` and `declare -p x`. (`echo "${x-}"` alone tests nothing: a later `$x` still fails.)
 */
function guards(root: SyntaxNode): Map<string, SyntaxNode[]> {
  const out = new Map<string, SyntaxNode[]>();
  const add = (name: string, d: SyntaxNode) => out.set(name, [...(out.get(name) ?? []), d]);
  for (const d of descendants(root, ['expansion', 'word'])) {
    if (d.type === 'expansion') {
      const p = parseExpansion(d.text);
      if (p?.op && /^:?[-=+?]$/.test(p.op) && (/[=?]/.test(p.op) || inTest(d))) add(p.name, d);
      continue;
    }
    const up = d.parent!;
    const before = up.children[up.children.indexOf(d) - 1]?.text;
    const declare = up.type === 'command' && /^(?:declare|typeset)$/.test(field(up, 'name')!.text) && fields(up, 'argument').some((a) => /^-[a-zA-Z]*p/.test(a.text));
    if (/^[A-Za-z_]\w*$/.test(d.text) && (before === '-v' || (declare && inTest(d)))) add(d.text, d);
  }
  return out;
}

/** Whether `d` is in a test or a condition: `[[ ]]`, `[` or `test`, the condition of an `if` or a loop, the left side of `&&` or `||`. */
function inTest(d: SyntaxNode): boolean {
  for (let x = d; x.parent; x = x.parent) {
    const p = x.parent;
    if (p.type === 'extended_test' || (p.type === 'command' && /^(?:\[|test)$/.test(field(p, 'name')?.text ?? ''))) return true;
    if (p.type === 'list' && x === p.namedChildren[0]) return true;
    if (['if_statement', 'elif_clause', 'while_statement'].includes(p.type) && conditionOf(p)!.includes(x)) return true;
  }
  return false;
}

/**
 * Whether the command `at` that left the variable without a value surely ran before `n` and leaves none from the
 * environment: `unset x`, or `local x` (`declare x` in a function) where `n` reads the local one. A `declare x`
 * outside a function keeps a value the variable has from the environment.
 */
function removed(at: SyntaxNode, n: SyntaxNode): boolean {
  const command = at.type === 'command' ? at : ancestor(at, (a) => a.type === 'command');
  const name = command && field(command, 'name')?.text;
  const local = name === 'local' || ((name === 'declare' || name === 'typeset') && !!ancestor(command!, (a) => a.type === 'function_definition')
    && !command!.namedChildren.some((c) => c.field === 'argument' && /^-[a-zA-Z]*g/.test(c.text)));
  if (name !== 'unset' && !local) return false;
  // (It runs on every path to `n`: a statement of a list that holds `n`, before it.)
  let x = command!;
  while (x.parent && !(x.parent.startIndex <= n.startIndex && n.endIndex <= x.parent.endIndex)) {
    if (x.parent.type !== 'compound_statement' && x.parent.type !== 'redirected_statement') return false;
    x = x.parent;
  }
  return x.endIndex <= n.startIndex && ['program', 'compound_statement', 'do_group'].includes(x.parent!.type);
}
