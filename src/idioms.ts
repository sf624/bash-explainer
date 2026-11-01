import type { Shell } from './dialect';
import { Lang } from './i18n';
import { interpret } from './argv/interpret';
import type { ArgvParse } from './argv/interpret';
import { has, values } from './argv/query';
import { argWordFor } from './argv/words';
import { lookupCommand } from './dict/aliases';
import { hasGlob } from './embedded/glob';
import { staticWordValue } from './staticword';
import { ancestor, descendants, field, fields, nameText, redirectionsOf } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';
import { option } from './semantics/state';
import type { StatusModel } from './semantics/status';
import { bracketWords, writtenAsBracket } from './testexpr';
import { codeSpan } from './label';
import { type Fact, fact } from './messages';
import type { IdiomId } from './messages-idioms';
import { S } from './messages-sentence';

export interface Redirect {
  op: string;
  /** Explicit file descriptor, or '' for the operator's default. */
  fd: string;
  dest: string;
}

/** Where a file descriptor points after a command's redirections (`RedirectOrder`): what it was at first, closed, a file, a here-document or a here-string. */
export type FdTarget =
  | { kind: 'original'; fd: number }
  | { kind: 'closed' }
  | { kind: 'file'; name: string }
  | { kind: 'heredoc'; delimiter?: string }
  | { kind: 'herestring' };

/**
 * The redirections of a command applied left to right, as bash does (3.6): where each descriptor they touch points in
 * the end, in the order of the descriptors (`table`); with `stderrFirst`, the index of a `2>&1` that a later redirection
 * of stdout to a file (the last one, `stdoutTo`) follows, so that stderr goes to the original stdout, not to the file.
 * Texts: the catalog's `redirections-in-order` and `stderr-to-original-stdout` (src/messages-redirects.ts).
 */
export interface RedirectOrder {
  table: { fd: number; to: FdTarget }[];
  stderrFirst?: { dup: number; stdoutTo: number };
}

/** Two targets are one: the same original descriptor, both closed, the same file. */
export const sameTarget = (a: FdTarget | undefined, b: FdTarget | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Apply redirections left to right, as bash does, and say where each file descriptor ends up. Only given when the
 * order matters (several redirections including a duplication). `stderrPiped`: the command is a stage joined by `|&`,
 * whose implicit `2>&1` comes after its own redirections (3.2.3; `stderrPiped` of src/semantics/env.ts).
 */
export function redirectOrder(written: Redirect[], opts: { stderrPiped?: boolean } = {}): RedirectOrder | undefined {
  const redirs = opts.stderrPiped ? [...written, { op: '>&', fd: '2', dest: '1' }] : written;
  if (redirs.length < 2 || !redirs.some((r) => r.op === '>&' || r.op === '<&')) return undefined;
  const orig = (fd: number): FdTarget => ({ kind: 'original', fd });
  const table = new Map<number, FdTarget>([[0, orig(0)], [1, orig(1)], [2, orig(2)]]);
  const touched: number[] = [];
  const set = (fd: number, to: FdTarget) => {
    table.set(fd, to);
    if (!touched.includes(fd)) touched.push(fd);
  };
  let stderrFirst: RedirectOrder['stderrFirst'];
  redirs.forEach((r, idx) => {
    // `{name}>…` takes a free descriptor of its own (10 or higher), which this table of the first ones leaves out.
    if (/^\{.*\}$/.test(r.fd)) return;
    const fd = r.fd !== '' ? Number(r.fd) : r.op.startsWith('<') ? 0 : 1;
    switch (r.op) {
      case '>&': case '<&':
        if (r.dest === '-') set(fd, { kind: 'closed' });
        else if (/^\d+-$/.test(r.dest)) {
          // `n>&m-` moves m to n: a copy, then m is closed.
          const from = Number(r.dest.slice(0, -1));
          set(fd, table.get(from) ?? orig(from));
          set(from, { kind: 'closed' });
        } else if (/^\d+$/.test(r.dest)) {
          set(fd, table.get(Number(r.dest)) ?? orig(Number(r.dest)));
          // `2>&1 >file`: stderr copied stdout before stdout was redirected (to the last file stdout goes to).
          const later = redirs.map((x, i) => ({ x, i })).filter(({ x, i }) => i > idx && (x.fd === '' || x.fd === '1') && /^>>?$|^>\|$/.test(x.op));
          if (fd === 2 && r.dest === '1' && later.length) stderrFirst = { dup: idx, stdoutTo: later[later.length - 1].i };
        } else if (r.op === '>&' && fd === 1) {
          // `>&file` and `1>&file` are `&>file`.
          set(1, { kind: 'file', name: r.dest });
          set(2, { kind: 'file', name: r.dest });
        } else {
          // `2>&$fd`: where the word leads (an error unless it gives a number: `2>&f` is an ambiguous redirect).
          set(fd, { kind: 'file', name: r.dest });
        }
        break;
      case '&>': case '&>>':
        set(1, { kind: 'file', name: r.dest });
        set(2, { kind: 'file', name: r.dest });
        break;
      case '<<': case '<<-':
        // (Named by its delimiter, which tells several apart: `cat 3<<A 4<<B <&4`.)
        set(fd, r.dest ? { kind: 'heredoc', delimiter: r.dest } : { kind: 'heredoc' });
        break;
      case '<<<':
        set(fd, { kind: 'herestring' });
        break;
      default:
        set(fd, { kind: 'file', name: r.dest });
    }
  });
  if (!touched.length) return undefined;
  return { table: touched.sort((a, b) => a - b).map((fd) => ({ fd, to: table.get(fd)! })), ...(stderrFirst ? { stderrFirst } : {}) };
}

// The idioms are read from the tree, not from a statement's text: a word is what bash makes of it
// (`IFS="" read`, `"$#"`), the options of a command come from its argv parse (`read -rd '' f`, `xargs -n 1 -0`),
// and a command in quotes is not run (`echo '$(mktemp)'`).

/** What a command runs, when its name is written plainly (`true`, `"true"`, `\true`). */
export const nameOf = (c: SyntaxNode | null | undefined): string | undefined => (c?.type === 'command' && field(c, 'name') ? staticWordValue(field(c, 'name')!.namedChildren[0]) : undefined);
const argsOf = (c: SyntaxNode): SyntaxNode[] => fields(c, 'argument');
/** The values of a command's arguments, undefined where they are not known without running anything. */
const wordsOf = (c: SyntaxNode): (string | undefined)[] => argsOf(c).map((w) => staticWordValue(w));
/** The argv parse of a command (src/argv/), when its name and spec are known. */
const parseOf = (c: SyntaxNode, shell: Shell | undefined): ArgvParse | undefined => {
  const name = nameOf(c);
  const spec = name === undefined ? undefined : lookupCommand(name);
  return spec && interpret(spec, argsOf(c).map(argWordFor(shell)), { name, lookup: lookupCommand });
};
/** The parses of a command and of the commands it runs with its words (`sudo -u w xargs -0 rm`: sudo's, xargs's, rm's) named `name`. */
const parsesOf = (c: SyntaxNode, name: string, shell: Shell | undefined): ArgvParse[] => {
  const out: ArgvParse[] = [];
  const visit = (parse: ArgvParse | undefined, n: string | undefined): void => {
    if (!parse) return;
    if (n === name) out.push(parse);
    for (const { role } of parse.roles) if (role.role === 'command') visit(role.parse, role.name);
  };
  visit(parseOf(c, shell), nameOf(c));
  return out;
};
/** The values the option `name` is given, as bash passes them (`-d ''` and `-rd ''` give '', `-rd'' f` gives `f`). */
const optionValues = (c: SyntaxNode, name: string, shell: Shell | undefined): (string | undefined)[] => {
  const args = argsOf(c);
  return values(parseOf(c, shell)!, name).map((v) => staticWordValue(args[v.word])?.slice(v.at ?? 0));
};
const commandIs = (c: SyntaxNode, ...names: string[]): boolean => names.includes(nameOf(c)!);
/** What the builtin a simple command names ends (`CommandSpec.ends`: `continue` ends the pass of a loop). */
const endsOf = (c: SyntaxNode): string | undefined => {
  const name = nameOf(c);
  return name === undefined ? undefined : lookupCommand(name)?.ends;
};
/** The tokens of a node (its operators and keywords), in order. */
const tokensOf = (n: SyntaxNode): string[] => n.children.filter((c) => !c.named).map((c) => c.text);

/** A word that is one expansion alone, with or without double quotes around it (`$x`, `"${x}"`). */
const expansionOf = (w: SyntaxNode | undefined): SyntaxNode | undefined => {
  const e = w?.type === 'string' && w.children.length === 3 ? w.namedChildren[0] : w;
  return e?.type === 'simple_expansion' || e?.type === 'expansion' ? e : undefined;
};
/**
 * The parameter a word expands to when it is that parameter alone (`$0`, `"$#"`, `${f}`, `"${BASH_SOURCE[0]}"`),
 * with its subscript; not `${#x}`, `${!x}` or `${x:-y}`, which give other text.
 */
const parameterOf = (w: SyntaxNode | undefined): { name: string; index?: string } | undefined => {
  const e = expansionOf(w);
  if (e?.type === 'simple_expansion') return { name: nameText(e.namedChildren[0]) };
  // (`${#}` is `$#`: the adapter reads its `#` as an operator.)
  if (e?.children.length === 3 && e.children[1].text === '#') return { name: '#' };
  if (e?.children.length !== 3 || !e.children[1].named) return undefined;
  const v = e.children[1];
  return v.type === 'subscript' ? { name: field(v, 'name')!.text, index: field(v, 'index')!.text } : { name: v.text };
};
/** The path the script was started by: `$0`, or `$BASH_SOURCE` (its first element) when it is sourced. */
const isScriptPath = (w: SyntaxNode | undefined): boolean => {
  const p = parameterOf(w);
  return !!p && (p.name === '0' ? p.index === undefined : p.name === 'BASH_SOURCE' && (p.index === undefined || p.index === '0'));
};
/** The only command of a `$( )`, when it is one. */
const substitutedCommand = (w: SyntaxNode | undefined): SyntaxNode | undefined => {
  const e = w?.type === 'string' && w.children.length === 3 ? w.namedChildren[0] : w;
  return e?.type === 'command_substitution' && e.namedChildren.length === 1 ? e.namedChildren[0] : undefined;
};
/** Whether `c` is the only command of a `$( )`. */
const isSubstituted = (c: SyntaxNode): boolean => c.parent!.type === 'command_substitution' && c.parent!.namedChildren.length === 1;
/** The arguments after a leading `--` (`dirname -- "$0"`). */
const operandsOf = (c: SyntaxNode): SyntaxNode[] => (wordsOf(c)[0] === '--' ? argsOf(c).slice(1) : argsOf(c));
/** `$(dirname "$0")`, `"$(dirname -- "${BASH_SOURCE[0]}")"`: the directory of the script. */
const isScriptDir = (w: SyntaxNode | undefined): boolean => {
  const c = substitutedCommand(w);
  return !!c && commandIs(c, 'dirname') && operandsOf(c).length === 1 && isScriptPath(operandsOf(c)[0]);
};
/** `cd "$(dirname "$0")"`, `cd -- "$(dirname -- "$0")"`. */
const cdScriptDir = (c: SyntaxNode): boolean => commandIs(c, 'cd') && operandsOf(c).length === 1 && isScriptDir(operandsOf(c)[0]);
const isPwd = (c: SyntaxNode | undefined): boolean => !!c && commandIs(c, 'pwd') && ['', '-P'].includes(wordsOf(c).join(' '));
/**
 * `$(cd "$(dirname "$0")" && pwd)` (or `; pwd`, `pwd -P`, and `cd … &> /dev/null`, which hides only what `cd` prints):
 * the absolute path of the script's directory.
 */
const scriptDirPath = (c: SyntaxNode): boolean => {
  if (!cdScriptDir(c)) return false;
  // (Redirections of `cd`, its own children, leave what `pwd` prints.)
  const p = c.parent!;
  if (p.type === 'list') return p.namedChildren[0] === c && tokensOf(p)[0] === '&&' && isPwd(p.namedChildren[1]) && isSubstituted(p);
  return p.type === 'command_substitution' && p.namedChildren.length === 2 && p.namedChildren[0] === c && isPwd(p.namedChildren[1]);
};

/** Where stdout and stderr end up after a command's redirections, when the targets are plain words. */
export const outputsOf = (n: SyntaxNode): { out?: string; err?: string } => {
  const to: { out?: string; err?: string } = {};
  for (const r of redirectionsOf(n).filter((x) => x.type === 'file_redirect')) {
    const fd = field(r, 'descriptor')?.text ?? '';
    const op = tokensOf(r)[0];
    // (A redirection being typed has no target yet.)
    const target = field(r, 'destination');
    const dest = target && staticWordValue(target);
    // (`>&word` sends both when the word is not a number; `&>` and `&>>` have no descriptor.)
    if (op === '&>' || op === '&>>' || (op === '>&' && fd === '' && !/^\d+$/.test(dest ?? ''))) to.out = to.err = dest;
    else if (op === '>&' && fd === '2' && dest === '1') to.err = to.out;
    else if (op === '>&' && (fd === '' || fd === '1') && dest === '2') to.out = to.err;
    else if (['>', '>>', '>|'].includes(op) && (fd === '' || fd === '1')) to.out = dest;
    else if (['>', '>>', '>|'].includes(op) && fd === '2') to.err = dest;
  }
  return to;
};
/** `command -v jq >/dev/null 2>&1`, `type -P jq &>/dev/null`, `hash jq`, `which jq`: a check that prints nothing. */
const quietCheck = (c: SyntaxNode, status: StatusModel): boolean => {
  const shell = status.state.shell;
  if (!(commandIs(c, 'which', 'hash') || (commandIs(c, 'command') && has(parseOf(c, shell)!, '-v')) || (commandIs(c, 'type') && has(parseOf(c, shell)!, '-P')))) return false;
  const { out, err } = outputsOf(c);
  return out === '/dev/null' && err === '/dev/null';
};
/** `[[ "${BASH_SOURCE[0]}" == "$0" ]]`, `[ "$0" -ef "$BASH_SOURCE" ]`: whether the script is the one started. */
const runDirectly = (n: SyntaxNode): boolean => {
  const b = n.type === 'extended_test' && n.namedChildren.length === 1 && n.namedChildren[0].type === 'binary_expression' ? n.namedChildren[0] : undefined;
  const [left, op, right] = b ? [field(b, 'left'), field(b, 'operator')!.text, field(b, 'right')]
    : testWords(n)?.length === 3 ? [testWords(n)![0], staticWordValue(testWords(n)![1]), testWords(n)![2]] : [];
  // (`!=` asks the same question: whether it is sourced.)
  if (!['=', '==', '!=', '-ef'].includes(op!)) return false;
  const source = (w: SyntaxNode | undefined) => isScriptPath(w) && parameterOf(w)!.name === 'BASH_SOURCE';
  const zero = (w: SyntaxNode | undefined) => isScriptPath(w) && parameterOf(w)!.name === '0';
  return (source(left) && zero(right)) || (zero(left) && source(right));
};

/**
 * Whether one `set` command turns errexit, nounset and pipefail all on, however the options are written (`-euo`, `-eou`,
 * `-o pipefail -eu`, `-e -u -o pipefail`, `-o errexit -o nounset -o pipefail`…).
 */
const strictMode = (c: SyntaxNode): boolean => {
  if (!commandIs(c, 'set')) return false;
  const words = wordsOf(c);
  const on = new Set<string | undefined>();
  const short: Record<string, string> = { e: 'errexit', u: 'nounset' };
  const set = (name: string | undefined, sign: string) => { if (sign === '-') on.add(name); else on.delete(name); };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined || !/^[-+][a-zA-Z]+$/.test(w)) break;
    // As in bash, each `o` of a bundle takes the next word as an option name, and the other letters still apply.
    for (const letter of w.slice(1)) {
      if (letter === 'o') {
        if (i + 1 < words.length) set(words[++i], w[0]);
      } else if (short[letter]) set(short[letter], w[0]);
    }
  }
  return on.has('errexit') && on.has('nounset') && on.has('pipefail');
};

/** `: "${VAR:?…}"` (`ops` `:?`, `?`), `: "${VAR:=…}"` (`:=`, `=`): the null command, run for the expansion of its first word. */
const colonExpansion = (...ops: string[]) => (c: SyntaxNode): boolean => {
  const e = commandIs(c, ':') ? expansionOf(argsOf(c)[0]) : undefined;
  return e?.type === 'expansion' && e.children[1].type === 'variable_name' && ops.includes(e.children[2].text);
};
/** `cmd || true`, `cmd || :`: what runs on the right surely succeeds (the builtin, not a function of that name; also `command true`, `/bin/true`). */
const orTrue = (n: SyntaxNode, status: StatusModel): boolean => n.type === 'list' && tokensOf(n)[0] === '||' && status.succeeds(n.namedChildren[1]);
/**
 * `trap 'rm -f "$tmp"' EXIT`: an action for EXIT. Not `trap - EXIT` and `trap '' EXIT`, which take the action away,
 * nor `trap -p EXIT`, which prints it.
 */
const exitTrap = (c: SyntaxNode): boolean => {
  if (!commandIs(c, 'trap')) return false;
  const words = wordsOf(c);
  const at = words[0] === '--' ? 1 : 0;
  const action = words[at];
  // (bash takes `exit` in any case, and a number that is 0 (`00`, ` 0`, `+0`), for EXIT.)
  return words.length > at + 1 && !(action !== undefined && (action === '' || action.startsWith('-')))
    && words.slice(at + 1).some((w) => w !== undefined && (w.toUpperCase() === 'EXIT' || (/^\s*[-+]?\d+\s*$/.test(w) && Number(w) === 0)));
};
/** `exec > >(tee -a log) 2>&1`: from here on, stdout goes through `tee` (or `logger`). `>>` and `&>>` do the same: a pipe has no end to append to. */
const execTee = (c: SyntaxNode): boolean => {
  return commandIs(c, 'exec') && !argsOf(c).length && redirectionsOf(c).some((r) => {
    const fd = field(r, 'descriptor')?.text ?? '';
    const dest = field(r, 'destination');
    return r.type === 'file_redirect' && (['&>', '&>>'].includes(tokensOf(r)[0]) || (['>', '>>'].includes(tokensOf(r)[0]) && (fd === '' || fd === '1')))
      && dest?.type === 'process_substitution' && commandIs(dest.namedChildren[0], 'tee', 'logger');
  });
};
/** `shift $((OPTIND-1))`, `shift "$(( OPTIND - 1 ))"`. */
const shiftOptind = (c: SyntaxNode): boolean => {
  const w = commandIs(c, 'shift') && argsOf(c).length === 1 ? argsOf(c)[0] : undefined;
  const a = w?.type === 'string' && w.children.length === 3 ? w.namedChildren[0] : w;
  const e = a?.type === 'arithmetic_expansion' ? a.namedChildren[0] : undefined;
  return e?.type === 'binary_expression' && field(e, 'left')!.text === 'OPTIND' && field(e, 'operator')!.text === '-' && field(e, 'right')?.text === '1';
};
/** `args=$(getopt -o ab: -- "$@")`. */
const getoptArgs = (c: SyntaxNode): boolean => commandIs(c, 'getopt') && isSubstituted(c) && argsOf(c).some((w) => w.type === 'string' && parameterOf(w)?.name === '@');
/** `eval set -- "$args"`. */
const evalSet = (c: SyntaxNode): boolean => commandIs(c, 'eval') && argsOf(c).length > 2 && wordsOf(c).slice(0, 2).join(' ') === 'set --';
/** `while [ $# -gt 0 ]`, `while (( $# ))`: a loop over the arguments. (`[ $# > 0 ]` is `[ $# ]` with stdout to the file `0`: always true.) */
const argsLoop = (n: SyntaxNode): boolean => {
  const c = whileOf(n) && field(n, 'condition');
  const count = (w: SyntaxNode | undefined) => parameterOf(w)?.name === '#';
  const zero = (w: SyntaxNode | undefined) => staticWordValue(w!) === '0';
  const words = c && testWords(c);
  if (words) {
    const [left, op, right] = words;
    return words.length === 3 && count(left) && ['-gt', '-ne', '!='].includes(staticWordValue(op)!) && zero(right);
  }
  const e = (c?.type === 'extended_test' || c?.type === 'arithmetic_command') && c.namedChildren.length === 1 ? c.namedChildren[0] : undefined;
  if (c?.type === 'arithmetic_command' && count(e)) return true;
  return e?.type === 'binary_expression' && count(field(e, 'left')) && zero(field(e, 'right'))
    && (c!.type === 'arithmetic_command' ? ['>', '!='] : ['-gt', '-ne', '!=', '>']).includes(field(e, 'operator')!.text);
};
/** `[ -e "$f" ] || continue`: a test of a name, and `continue` when it is not there. */
const globGuard = (n: SyntaxNode, status: StatusModel): boolean => {
  if (n.type !== 'list' || tokensOf(n)[0] !== '||' || endsOf(n.namedChildren[1]) !== 'pass' || argsOf(n.namedChildren[1]).length) return false;
  const t = n.namedChildren[0];
  const u = t.type === 'extended_test' && t.namedChildren[0].type === 'unary_expression' ? t.namedChildren[0] : undefined;
  const [op, operand] = u ? [field(u, 'operator')!.text, u.namedChildren[1]]
    : testWords(t)?.length === 2 ? [staticWordValue(testWords(t)![0]), testWords(t)![1]] : [];
  const name = parameterOf(operand)?.name ?? '';
  if (!['-e', '-f'].includes(op!) || !/^\w+$/.test(name)) return false;
  // (Only in a `for` over a glob of that name: `for f in "$@"` has none to keep.)
  const loop = ancestor(n, (a) => LOOPS.has(a.type));
  const globbed = (v: SyntaxNode) => (v.type === 'concatenation' ? v.namedChildren : [v]).some((c) => c.type === 'word' && hasGlob(c.text));
  if (loop?.type !== 'for_statement' || field(loop, 'variable')?.text !== name || !fields(loop, 'value').some(globbed)) return false;
  // (With nullglob or failglob on, or on some paths, a glob that matches nothing may give no name to skip: the note would not hold.)
  const st = status.state.at(n).run;
  return [option(st, 'shopt', 'nullglob'), option(st, 'shopt', 'failglob')].every((o) => o === 'off' || o === 'default');
};
const LOOPS = new Set(['for_statement', 'c_style_for_statement', 'while_statement', 'select_statement']);

/** The words of `[ … ]` (by its spelling, closed with `]`) between the brackets; undefined for any other node. */
const testWords = (n: SyntaxNode): SyntaxNode[] | undefined => {
  if (!writtenAsBracket(n)) return undefined;
  const b = bracketWords(n);
  return b.close ? b.words : undefined;
};

/** A statement's shape in the tree; `status` says what surely succeeds (src/semantics/status.ts). */
type Shape = (n: SyntaxNode, status: StatusModel) => boolean;
/** `IFS=`, `IFS=''`: an assignment of the empty string. */
const emptyValue = (a: SyntaxNode): boolean => {
  const v = field(a, 'value');
  return !v || staticWordValue(v) === '';
};
/** A shape of a command. */
const command = (test: (c: SyntaxNode, shell: Shell | undefined) => boolean): Shape => (n, status) => n.type === 'command' && test(n, status.state.shell);

// (`until` is a `while_statement` too, with that keyword first.)
const whileOf = (n: SyntaxNode): SyntaxNode | undefined => (n.type === 'while_statement' && n.children[0].type === 'while' ? n : undefined);
/** `while true`, `while :`: a loop whose only condition is a command that surely succeeds (not a function `true`). */
const endless = (n: SyntaxNode, status: StatusModel): boolean => {
  const w = whileOf(n);
  const c = w && field(w, 'condition');
  return !!c && status.succeeds(c);
};
/** `while … read … done < file` (`process`: `< <(command)`): the loop is redirected, and a command in it reads. */
const readLoop = (process: boolean) => (n: SyntaxNode): boolean => {
  const body = n.type === 'redirected_statement' ? field(n, 'body') : undefined;
  if (body?.type !== 'while_statement') return false;
  const redirects = redirectionsOf(n).filter((c) => c.type === 'file_redirect');
  const r = redirects.length === 1 ? redirects[0] : undefined;
  if (!r || !/^<(?!<)/.test(r.text) || (field(r, 'destination')?.type === 'process_substitution') !== process) return false;
  return descendants(body, ['command']).some((c) => nameOf(c) === 'read');
};
const loopCommand = (name: string) => (n: SyntaxNode): boolean => {
  const w = whileOf(n);
  return nameOf(w && field(w, 'condition')) === name;
};

interface Idiom {
  test: Shape;
  /** Its note: an entry of the catalog (src/messages-idioms.ts). */
  id: IdiomId;
  /** Not reported when this other idiom (by index) is found, e.g. a `cd` that is part of a larger idiom. */
  unless?: number;
}

/** Well-known patterns, found in the tree of a statement. */
const IDIOMS: Idiom[] = [
  {
    test: command((c, shell) => commandIs(c, 'read') && c.namedChildren.some((a) => a.type === 'variable_assignment' && field(a, 'name')!.text === 'IFS' && emptyValue(a)) && has(parseOf(c, shell)!, '-r')),
    id: 'idiom-ifs-read-raw',
  },
  {
    test: command(scriptDirPath),
    id: 'idiom-script-dir',
  },
  {
    test: command(cdScriptDir),
    unless: 1,
    id: 'idiom-cd-script-dir',
  },
  {
    test: quietCheck,
    id: 'idiom-quiet-check',
  },
  {
    test: runDirectly,
    id: 'idiom-run-directly',
  },
  {
    test: command(strictMode),
    id: 'idiom-strict-mode',
  },
  {
    test: command(colonExpansion(':?', '?')),
    id: 'idiom-require-variable',
  },
  {
    test: command(colonExpansion(':=', '=')),
    id: 'idiom-default-variable',
  },
  {
    test: orTrue,
    id: 'idiom-or-true',
  },
  {
    test: command(exitTrap),
    id: 'idiom-exit-trap',
  },
  {
    test: execTee,
    id: 'idiom-exec-tee',
  },
  {
    test: endless,
    id: 'idiom-endless-loop',
  },
  {
    test: command((c) => commandIs(c, 'mktemp') && isSubstituted(c)),
    id: 'idiom-mktemp',
  },
  {
    test: readLoop(false),
    id: 'idiom-read-file-loop',
  },
  {
    test: readLoop(true),
    id: 'idiom-read-command-loop',
  },
  {
    test: loopCommand('getopts'),
    id: 'idiom-getopts-loop',
  },
  {
    test: command(shiftOptind),
    id: 'idiom-shift-optind',
  },
  {
    test: loopCommand('getopt'),
    id: 'idiom-getopt-loop',
  },
  {
    test: command(getoptArgs),
    id: 'idiom-getopt-args',
  },
  {
    test: command(evalSet),
    id: 'idiom-eval-set',
  },
  {
    test: argsLoop,
    id: 'idiom-args-loop',
  },
  {
    test: command((c, shell) => commandIs(c, 'read') && optionValues(c, '-d', shell).includes('')),
    id: 'idiom-read-nul',
  },
  {
    test: command((c, shell) => parsesOf(c, 'find', shell).some((p) => p.roles.some(({ word, role }) => role.role === 'expression' && staticWordValue(argsOf(c)[word]) === '-print0'))),
    id: 'idiom-find-print0',
  },
  {
    test: command((c, shell) => parsesOf(c, 'xargs', shell).some((p) => has(p, '-0'))),
    id: 'idiom-xargs-nul',
  },
  {
    test: (n) => n.type === 'while_statement' && n.children[0].type === 'until',
    id: 'idiom-until',
  },
  {
    test: command((c) => commandIs(c, 'mapfile', 'readarray')),
    id: 'idiom-mapfile',
  },
  {
    test: globGuard,
    id: 'idiom-glob-guard',
  },
  {
    test: command((c, shell) => commandIs(c, 'read') && optionValues(c, '-p', shell).some((p) => p !== undefined && /\b[yY](es)?\/[nN](o)?\b/.test(p))),
    id: 'idiom-yes-no',
  },
];

/**
 * How the sentence of a line (src/linesentence.ts) says the parts an idiom's sentence names: commands by their names,
 * a word by its value or its placeholder, the body of a block by its lines (or its commands, on one line).
 */
export interface IdiomSpeaker {
  names(commands: readonly SyntaxNode[]): string;
  word(w: SyntaxNode): string;
  body(block: SyntaxNode): string;
}

/** `cmd >&2` with `echo` or `printf`: a message for stderr (no other redirection, no assignment before it). */
const errorMessage = (c: SyntaxNode): boolean => {
  if (!commandIs(c, 'echo', 'printf') || c.namedChildren.some((x) => x.type === 'variable_assignment')) return false;
  const [r, ...more] = redirectionsOf(c);
  const fd = r?.type === 'file_redirect' ? field(r, 'descriptor')?.text ?? '' : undefined;
  return !more.length && (fd === '' || fd === '1') && tokensOf(r)[0] === '>&' && field(r, 'destination')?.text === '2';
};

/**
 * `sort | uniq -c | sort -rn [| head -n N]`, the most frequent lines first, with their counts: the stages before it
 * (whose output it counts), and how many lines it keeps (`undefined`: all; `null`: some, a number not known here).
 */
const countLines = (n: SyntaxNode, shell: Shell | undefined): { before: SyntaxNode[]; top: number | null | undefined } | undefined => {
  if (n.type !== 'pipeline') return undefined;
  const st = n.namedChildren;
  const i = st.findIndex((c, k) => commandIs(c, 'sort') && commandIs(st[k + 1], 'uniq') && commandIs(st[k + 2], 'sort'));
  if (i < 0) return undefined;
  const [first, uniq, last, head] = st.slice(i);
  const counted = has(parseOf(uniq, shell)!, '-c') && !has(parseOf(first, shell)!, '-u') && has(parseOf(last, shell)!, '-n') && has(parseOf(last, shell)!, '-r');
  if (!counted || st.length > i + 4 || (head && !commandIs(head, 'head'))) return undefined;
  if (!head) return { before: st.slice(0, i), top: undefined };
  const n1 = optionValues(head, '-n', shell);
  const top = !argsOf(head).length ? 10 : n1.length === 1 && /^\d+$/.test(n1[0] ?? '') ? Number(n1[0]) : null;
  return { before: st.slice(0, i), top };
};

/** The idioms with a sentence of their own: the line's sentence says them so (src/linesentence.ts). Texts: src/messages-sentence.ts. */
const SAID: { test: Shape; say: (n: SyntaxNode, lang: Lang, say: IdiomSpeaker, status: StatusModel) => string }[] = [
  { test: command(strictMode), say: (_n, lang) => S.strictMode(lang) },
  { test: command(exitTrap), say: (_n, lang) => S.exitTrap(lang) },
  { test: quietCheck, say: (_n, lang) => S.quietCheck(lang) },
  { test: readLoop(false), say: (n, lang, say) => S.readLines(lang, say.word(field(redirectionsOf(n).find((r) => r.type === 'file_redirect')!, 'destination')!), say.body(field(n, 'body')!)) },
  { test: endless, say: (n, lang, say) => S.endless(lang, say.body(n)) },
  { test: (n, status) => !!countLines(n, status.state.shell), say: (n, lang, say, status) => {
    const { before, top } = countLines(n, status.state.shell)!;
    return S.countLines(lang, before.length ? say.names(before) : undefined, top);
  } },
  { test: command(errorMessage), say: (n, lang) => S.errorMessage(lang, codeSpan(nameOf(n)!)) },
];

/** The sentence of an idiom that statement `n` is, as a clause of the line's sentence; undefined when it is none. */
export function idiomSaid(n: SyntaxNode, status: StatusModel, lang: Lang, say: IdiomSpeaker): string | undefined {
  return SAID.find((i) => i.test(n, status))?.say(n, lang, say, status);
}

/** Notes for the idioms found in the given statements, without duplicates. */
export function findIdioms(statements: readonly SyntaxNode[], lang: Lang, status: StatusModel): string[] {
  return idiomsFound(statements, lang, status).map((f) => f.fact.text);
}

/** The notes of `findIdioms`, each with the narrowest statement it was found in (where the part hover shows it). */
export function idiomsFound(statements: readonly SyntaxNode[], lang: Lang, status: StatusModel): { fact: Fact; node: SyntaxNode }[] {
  const width = (n: SyntaxNode) => n.endIndex - n.startIndex;
  const found = IDIOMS.map((idiom) => statements.filter((n) => idiom.test(n, status)).sort((a, b) => width(a) - width(b))[0]);
  return IDIOMS.flatMap((idiom, i) => (found[i] && !(idiom.unless !== undefined && found[idiom.unless])
    ? [{ fact: fact(lang, idiom.id), node: found[i] }] : []));
}
