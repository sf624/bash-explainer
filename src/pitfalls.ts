import { interpret, type ArgRole, type ArgvParse } from './argv/interpret';
import { downloadsTo, givenOptions, has, readsScriptFromStdin, regexWords } from './argv/query';
import type { CommandSpec, OptionSpec } from './argv/spec';
import { argWordFor } from './argv/words';
import type { Shell } from './dialect';
import { canonicalName, impliedOptions, lookupCommand } from './dict/aliases';
import { Lang } from './i18n';
import { argWordIn, bracesIn } from './semantics/argwords';
import { type ExecEnv, readAs, runsString, slotEnvs } from './semantics/env';
import { commandName as staticName, plainName } from './semantics/effects';
import { resolveName, resolveRun } from './semantics/names';
import { option, type StateModel } from './semantics/state';
import { ancestor, childrenOnRows, descendants, field, fields, redirectionsOf } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';
import { bracketWords, operatorFits, testFails, writtenAsBracket } from './testexpr';
import { staticWordValue, unquoteWord } from './staticword';
import { parseExpansion } from './expansion';
import { hasUnquotedExpansion, quoteExpansions } from './fixes';
import type { ConventionId } from './conventions';
import { marked, type Note } from './messages';
import { STYLE_LEVELS, type StyleCase, type StyleCode } from './messages-levels';
import { type Rewrite, replaceNode, replaceSpan, stopCommand, textBetween, type TextEdit } from './rewrite';

// Style checks: common mistakes in how a script is written (`[-f x]`, `x = 1`, `{echo`, a `}` without `;`,
// `rm -rf $DIR/…`, `read` without `-r`, `<` and `>` or a missing `]` inside `[ ]`), explained where they appear: what
// goes wrong and how to write it instead. Each is found from the syntax tree, and only on the line where its node
// starts. The pitfalls that state what the shell does with a word, from the models, are facts with a catalog entry
// (src/wordfacts.ts, src/messages.ts), not here.

const pick = (lang: Lang) => (ja: string, en: string) => (lang === 'ja' ? ja : en);

/** The variable an expansion reads (`DIR` for `$DIR` or `${DIR}`), when it is a plain one. */
function varName(n: SyntaxNode): string | undefined {
  const v = n.namedChildren.find((c) => c.type === 'variable_name');
  return v?.text;
}

/**
 * The variable an `rm -r` word starts with when an empty value leaves a path from the root (`$DIR/*`, `"$DIR"/*`,
 * `"${DIR}/x"`, `"$DIR/"*`, `"$DIR""/x"`): the expansion, its name, what is left (`/*`), and whether it is the plain
 * value (`$v`, `${v}`, `${v:-}`), which `${v:?}` can stand for, and the test that it is not empty (`[ -n "${v%/}" ]`),
 * when one can be written. Not for an expansion that is never empty (`${#v}`, `${v:-x}`, `${v:?}`), nor HOME and PWD,
 * which are always set.
 */
function rootTarget(w: SyntaxNode): { e: SyntaxNode; v: string; left: string; plain: boolean; test?: string } | undefined {
  const first = w.type === 'concatenation' ? w.namedChildren[0] : w.type === 'string' ? w : undefined;
  if (!first) return undefined;
  // In quotes, the expansion right after the opening quote; a string of only it is skipped over (`"$DIR""/x"`).
  const inner = first.type === 'string' ? first.namedChildren[0] : first;
  if (!inner || inner.startIndex !== first.startIndex + (first === inner ? 0 : 1)) return undefined;
  if (inner.type !== 'simple_expansion' && inner.type !== 'expansion') return undefined;
  const sub = inner.namedChildren.find((c) => c.type === 'subscript');
  const special = inner.namedChildren.find((c) => c.type === 'special_variable_name');
  const all = special ? ['@', '*'].includes(special.text) : ['@', '*'].includes(sub?.namedChildren[1]?.text ?? '');
  const alone = first !== inner && first.namedChildren.length === 1 && first.text === `"${inner.text}"`;
  const left = alone ? w.text.slice(first.endIndex - w.startIndex) : (first !== inner ? '"' : '') + w.text.slice(inner.endIndex - w.startIndex);
  if (!/^["']?\//.test(left)) return undefined;
  // `$@`, `$*`, `${a[@]}`, `${!a[@]}`: no words at all when there are none (`set --`, `a=()`); a check counts them.
  if (all) {
    const p = inner.type === 'expansion' ? parseExpansion(inner.text) : undefined;
    if (p?.op) return undefined;
    const name = sub?.namedChildren[0].text;
    return { e: inner, v: inner.text, left, plain: false, test: name ? `[ "\${#${name}[@]}" -gt 0 ]` : '[ "$#" -gt 0 ]' };
  }
  if (special) return undefined;
  // An element, `${a[0]}`, is named with its subscript.
  const v = sub ? sub.text : varName(inner);
  if (!v || ['HOME', 'PWD'].includes(v)) return undefined;
  const ref = /^\w+$/.test(v) ? `$${v}` : `\${${v}}`;
  // Inside `"…"` of a check, a quote or backslash in the expansion means something else than where it stands: no check then.
  const quotable = !/['"\\]/.test(inner.text);
  const gen = (plain: boolean) => ({ e: inner, v, left, plain, test: quotable ? `[ -n "${plain ? ref : inner.text}" ]` : undefined });
  if (inner.type === 'simple_expansion') return gen(true);
  const p = parseExpansion(inner.text);
  if (!p || p.prefix === '#') return undefined;
  const word = p.parts.find((q) => q.role === 'word')?.text ?? '';
  // What the default word is after quote removal, where the expansion stands (`''` and `""` are empty, `"lit"` is `lit`);
  // undefined when it holds an expansion.
  const value = unquoteWord(word.replace(/\$'([^'\\]*)'/g, "'$1'"), first.type === 'string');
  if (!p.prefix && (!p.op || (['-', ':-', '=', ':='].includes(p.op) && value === ''))) return gen(true);
  // Never empty: an error when empty, or a default of literal text when empty. (`${v-x}` is empty when v is set
  // and empty; `${v:+x}` when v is empty; `${v:-$w}` when w is empty too.)
  if (p.op === ':?' || ((p.op === ':-' || p.op === ':=') && value)) return undefined;
  // `${v%…}`, `${v/…}`, `${v:1}`, `${v:+x}`, `${v@Q}` (unset v), `${!v}`…: may be empty, with no form that `:?` can stand for.
  return gen(false);
}

/**
 * The command the name of the simple command `n` runs, as the checks of commands read it (see `pathCommand`): from its
 * value (src/semantics/effects.ts), so that `\read` and `'rm'` are `read` and `rm`; undefined when it is not known
 * without running anything (`$cmd`). The checks of the syntax read the name as written instead (`plainName`).
 */
export function commandName(n: SyntaxNode): string | undefined {
  const name = staticName(n);
  return name === undefined ? undefined : pathCommand(name);
}

/**
 * The command a name runs, as the checks read it: the name itself; for a path, the program of its last part when the
 * dictionary knows it (`/bin/rm` is rm, as the explanation reads it), else none. A path runs that file, never a builtin
 * (3.7.2): `./read` is not `read`, nor `./cd` the `cd` builtin.
 */
export function pathCommand(name: string): string | undefined {
  if (!name.includes('/')) return name;
  const spec = lookupCommand(name);
  return spec && !spec.builtin ? name.slice(name.lastIndexOf('/') + 1) : undefined;
}

export function args(n: SyntaxNode): SyntaxNode[] {
  return fields(n, 'argument');
}

/**
 * A command that the simple command `n` runs: itself, or one that its words run through a command slot of its spec
 * (`sudo rm …`, `env X=1 rm …`, `xargs rm …`, `nice nohup rm …`): the word of its name, its arguments, and where it
 * runs (src/semantics/env.ts) when a slot runs it. Not a string a slot runs as a script (`bash -c '…'`): its words
 * are not words of this line.
 */
export interface RunCommand { nameWord: SyntaxNode; name: string | undefined; args: SyntaxNode[]; env?: ExecEnv }

/** The commands the simple command `n` runs (see `RunCommand`), itself first. */
export function runCommands(n: SyntaxNode, model: StateModel, shell: Shell | undefined): RunCommand[] {
  const nameWord = field(n, 'name');
  if (!nameWord) return [];
  const name = commandName(n);
  const a = args(n);
  const out: RunCommand[] = [{ nameWord, name, args: a }];
  const spec = name === undefined ? undefined : lookupCommand(name);
  // (A function or an alias of that name runs something else: its words have no spec.)
  if (!spec || !a.length) return out;
  const kind = resolveRun(model, out[0], shell)!.kind;
  if (kind === 'function' || kind === 'alias') return out;
  // (The words as the command gets them, where the model knows them: `x=';'; find . -exec echo {} $x` ends at `$x`.)
  const parse = interpret(spec, a.map(argWordIn(model)), { name, lookup: lookupCommand });
  let envs: Map<SyntaxNode, ExecEnv> | undefined;
  // (`words` are the words of the line that `p` read: the indexes of its roles count in them.)
  const visit = (p: ArgvParse, ps: CommandSpec | undefined, words: readonly SyntaxNode[]): void => {
    // (find refuses the line and runs nothing: `find . -exec rm {} ;` has no `\;` to end the command, the `;` is the shell's.)
    if (p.refusal) return;
    for (const { word, role } of p.roles) {
      if (role.role === 'subcommand') visit(role.parse, role.spec, words);
      // An expression with a spec of its own is read by that spec from its first word: find's actions run commands
      // (`-exec cp $a {} \;`; the `{}` and the `;` or `+` are find's words, not the command's).
      if (role.role === 'expression' && word === p.expression && ps?.expressionSpec) {
        const rest = words.slice(word, p.end);
        visit(interpret(ps.expressionSpec, rest.map(argWordIn(model)), { name: p.command, lookup: lookupCommand }), ps.expressionSpec, rest);
      }
      if (role.role !== 'command' || !role.parse) continue;
      if (role.name !== undefined && !runsString(role.slot)) {
        envs ??= slotEnvs(model.env(n), parse, spec, a, model.shell, lookupCommand);
        out.push({ nameWord: words[word], name: pathCommand(role.name), args: words.slice(word + 1, role.parse.end), env: envs.get(words[word]) });
      }
      visit(role.parse, role.spec, words);
    }
  };
  visit(parse, spec, a);
  return out;
}

/** The codes of the style checks, and their levels (src/messages-levels.ts, beside the catalog's). */
export { STYLE_LEVELS, type StyleCode };

/**
 * The habit each style check's advice is, when it is one (docs/design/basis-spec-convention.md, 2.3: the checks sorted
 * "both"): its fact bites only with values or a setup the line does not control, and the advice rules it out beyond
 * this line. `null`: the advice is how to write what was meant (sorted "fact"). Total, so that a new check must decide.
 */
export const STYLE_CONVENTIONS: Record<StyleCode, ConventionId | null> = {
  'bracket-no-space': null, 'assignment-with-spaces': null, 'brace-no-space': null, 'brace-close-no-separator': null,
  // (It bites only when the variable is empty.)
  'rm-empty-variable-root': 'guard-empty-path',
  // (Only when the input has a backslash.)
  'read-without-r': 'read-r',
  'redirect-in-bracket': null, 'bracket-close-in-word': null, 'and-or-in-bracket': null,
  // (Only when the download is cut, or is not what was meant.)
  'download-run-by-shell': 'read-before-run',
  'trap-goes-on': null,
  // (Only when `$PATH` has the name, or the script is started from another directory.)
  'source-searches-path': 'source-by-script-path',
  // (Only with a character special in a regex, or a value that is part of a longer text.)
  'pattern-from-variable': 'grep-fixed-strings',
};

/**
 * The sections of the bash 5.2 manual each style check's fact is about (src/manual.ts), as the catalog's entries cite
 * theirs: data for now, as the basis of the check (docs/design/basis-spec-convention.md, decision 5). Each was checked
 * against the manual of the bash-doc package (bash 5.2); the comment quotes the sentence the check rests on. None for
 * `pattern-from-variable`, which is about grep, not bash.
 */
export const STYLE_REFS: Record<StyleCode, readonly string[]> = {
  // 4.1 (`test`): "Each operator and operand must be a separate argument." 3.7.2: "If that function is not defined,
  // the shell prints an error message and returns an exit status of 127."
  'bracket-no-space': ['4.1', '3.7.2'],
  // 3.4: "A variable may be assigned to by a statement of the form name=[value]". 3.7.1: "If any words remain after
  // expansion, the first word is taken to be the name of the command and the remaining words are the arguments."
  'assignment-with-spaces': ['3.4', '3.7.1'],
  // 3.2.5.3: "The braces are reserved words, so they must be separated from the list by blanks or other shell
  // metacharacters."
  'brace-no-space': ['3.2.5.3'],
  // 3.2.5.3: "{ list; }" … "The semicolon (or newline) following list is required."
  'brace-close-no-separator': ['3.2.5.3'],
  // 3.5.3, `${parameter:?word}`: "If parameter is null or unset, the expansion of word … is written to the standard
  // error and the shell, if it is not interactive, exits." 3.5.8: the word is "replaced with an alphabetically sorted
  // list of filenames matching the pattern".
  'rm-empty-variable-root': ['3.5.3', '3.5.8'],
  // 4.2 (`read`): "The backslash character ‘\’ may be used to remove any special meaning for the next character read
  // and for line continuation." `-r`: "If this option is given, backslash does not act as an escape character."
  'read-without-r': ['4.2'],
  // 3.6: "Before a command is executed, its input and output may be redirected using a special notation interpreted
  // by the shell." 3.2.5.2: "When used with [[, the ‘<’ and ‘>’ operators sort lexicographically using the current
  // locale."
  'redirect-in-bracket': ['3.6', '3.2.5.2'],
  // 4.1: "When the [ form is used, the last argument to the command must be a ]." 3.5.7: "Unquoted implicit null
  // arguments, resulting from the expansion of parameters that have no values, are removed" (`$v]` is not one).
  'bracket-close-in-word': ['4.1', '3.5.7'],
  // 3.2.4: "AND and OR lists are sequences of one or more pipelines separated by the control operators ‘&&’ and
  // ‘||’". 4.1: "When the [ form is used, the last argument to the command must be a ]."
  'and-or-in-bracket': ['3.2.4', '4.1'],
  // 6.1, `-s`: "If this option is present, or if no arguments remain after option processing, then commands are read
  // from the standard input."
  'download-run-by-shell': ['6.1'],
  // 4.1 (`trap`): "The commands in arg are to be read and executed when the shell receives signal sigspec." 3.7.6:
  // "The shell exits by default upon receipt of a SIGHUP." (That the script then goes on is implied, not stated.)
  'trap-goes-on': ['4.1', '3.7.6'],
  // 4.1 (`.`): "If filename does not contain a slash, the PATH variable is used to find filename … When Bash is not in
  // POSIX mode, it searches the current directory if filename is not found in $PATH." 6.11: "The . and source builtins
  // do not search the current directory for the filename argument if it is not found by searching PATH."
  'source-searches-path': ['4.1', '6.11'],
  'pattern-from-variable': [],
};

/**
 * Whether the findings of each style check carry rewrites (`StyleFinding.rewrite`, docs/design/oracles.md 3.2): the
 * checks whose fix follows from the code the note is about (`[-f x]` → `[ -f x ]`), and the advice whose rewrite reads
 * what was meant (`source lib.sh` → `source "$(dirname "${BASH_SOURCE[0]}")"/lib.sh`, not a file of `$PATH`; `grep "$x"`
 * → `grep -F "$x"`, the value as it is). Not a download to read, nor a trap's action, whose code is in a string. Total,
 * so that a new check must decide; test/suggestions.test.ts checks it against the classification and the corpus.
 */
export const STYLE_REWRITES: Record<StyleCode, boolean> = {
  'bracket-no-space': true, 'assignment-with-spaces': true, 'brace-no-space': true, 'brace-close-no-separator': true,
  'rm-empty-variable-root': true, 'read-without-r': true, 'redirect-in-bracket': true, 'bracket-close-in-word': true,
  'and-or-in-bracket': true, 'download-run-by-shell': false, 'trap-goes-on': false, 'source-searches-path': true,
  'pattern-from-variable': true,
};

/**
 * A style check found on a node: its note, whose code is the check's; where it suggests a mechanical rewrite, those
 * with edits (`rewrite`: alternatives, each complete, the first recommended; src/rewrite.ts), whose code its text shows.
 */
export interface StyleFinding extends Note { code: StyleCode; node: SyntaxNode; rewrite?: readonly Rewrite[] }

/** The text from the start of `from` to the end of `to` (a later node of the same tree), with `edits` made within it. */
function edited(from: SyntaxNode, to: SyntaxNode, edits: readonly TextEdit[]): string {
  return [...edits].sort((x, y) => y.start - x.start).reduce((t, e) => t.slice(0, e.start - from.startIndex) + e.text + t.slice(e.end - from.startIndex), textBetween(from, to));
}

/** The rewrite that makes `edits` (insertions and replacements) in the text from `from` to `to`, shown as that whole text. */
function editSpan(from: SyntaxNode, to: SyntaxNode, edits: readonly TextEdit[]): Rewrite {
  return replaceSpan(from, to, edited(from, to, edits));
}

/** Whether the text of a word ends with a `]` (or `}`) that a backslash escapes (`b\]`): an odd run of backslashes before it. */
const escapedEnd = (text: string): boolean => /(^|[^\\])(\\\\)*\\.$/.test(text);

/** Notes for the pitfalls whose node starts on `line`. */
export function pitfallNotes(root: SyntaxNode, line: number, lang: Lang, model: StateModel, shell: Shell | undefined): string[] {
  return [...new Set(pitfallFindings(root, lang, line, line, model, shell).map((f) => f.text))];
}

/**
 * Whether the variable `name` has a value with some static text in it where `at` runs, on every path, as far as the
 * model may be relied on (`DIR=/opt/app`, `B="$S/build"`): then it is never empty there.
 */
function neverEmpty(model: StateModel, name: string, at: SyntaxNode): boolean {
  const v = model.at(at).run.variables.get(name);
  if (!v || v.set !== 'on' || !model.trusts(name)) return false;
  return v.value !== undefined ? v.value !== '' : !!v.source && hasStaticText(v.source);
}

/**
 * Whether the part `p` of a word may expand to nothing: an expansion (a variable unless the model knows it has some
 * text, `neverEmpty`; not a length, `${#x}`, a default of plain text, `${x:-d}`, nor `${x:?}`, which fails when empty),
 * or quotes around such parts (`"$x"`, `''`); not text of its own (`hasStaticText`), nor `$(( ))`, a number.
 */
function mayBeEmpty(model: StateModel, p: SyntaxNode): boolean {
  if (p.type === 'arithmetic_expansion') return false;
  if (p.type === 'simple_expansion' || p.type === 'expansion') {
    const e = p.type === 'expansion' ? parseExpansion(p.text) : undefined;
    const word = e?.parts.find((x) => x.role === 'word')?.text;
    if (e?.prefix === '#' || e?.op === ':?' || ((e?.op === ':-' || e?.op === ':=') && word && /^[\w./-]+$/.test(word))) return false;
    const name = p.namedChildren.length === 1 && p.namedChildren[0].type === 'variable_name' ? p.namedChildren[0].text : undefined;
    return !name || !neverEmpty(model, name, p);
  }
  if (p.type === 'string') return p.namedChildren.every((c) => mayBeEmpty(model, c));
  return !hasStaticText(p);
}

/** Whether a word has text of its own, outside its expansions (`"$S/build"`, `${S}x`, `'a'`). */
function hasStaticText(n: SyntaxNode): boolean {
  switch (n.type) {
    case 'word': case 'string_content': return n.text !== '';
    case 'raw_string': return n.text.length > 2;
    case 'string': case 'concatenation': return n.namedChildren.some(hasStaticText);
    default: return false;
  }
}

/**
 * Whether the command name `name` at `at` runs something that takes `=` as an argument: a function, an alias, a
 * builtin (`export = x`), or a program the dictionary knows (`sed = f`, `echo ===`). Not a name the dictionary does
 * not know, which is most likely a variable (`x = 1`).
 */
function runsCommand(model: StateModel, name: string, at: SyntaxNode, shell: Shell | undefined): boolean {
  const r = resolveName(model, name, at, { shell, command: true, program: (p) => !!lookupCommand(p) });
  return r.kind !== 'file' || r.known || !!r.sourced;
}

/** A command a command runs that is a builtin or a program (not a function or an alias of that name), with its spec and the parse of its words. */
interface SpecRun { run: RunCommand; name: string; spec: CommandSpec; parse: ArgvParse; values: (string | undefined)[] }

/** The commands the simple command `n` runs (`runCommands`) that are builtins or programs the dictionary knows. */
function specRuns(n: SyntaxNode, model: StateModel, shell: Shell | undefined): SpecRun[] {
  const out: SpecRun[] = [];
  for (const run of runCommands(n, model, shell)) {
    const spec = run.name === undefined ? undefined : lookupCommand(run.name);
    if (!spec) continue;
    const kind = resolveRun(model, run, shell)?.kind;
    if (kind !== 'builtin' && kind !== 'file') continue;
    // (The words as the command gets them, where the model knows them: `e=-e; grep $e p f` reads `p` as the pattern.)
    const parse = interpret(spec, run.args.map(argWordIn(model)), { name: run.name, lookup: lookupCommand });
    out.push({ run, name: run.name!, spec, parse, values: run.args.map((w) => staticWordValue(w)) });
  }
  return out;
}

/** Whether a redirection of the command `n` takes its standard output elsewhere (`> f`, `&> f`, `>&2`; not `2> f`). */
function stdoutRedirected(n: SyntaxNode): boolean {
  return redirectionsOf(n).some((r) => r.type === 'file_redirect' && /^(1?>|&>)/.test(r.text));
}

/** Whether a redirection or a here-document gives the command `n` another standard input (`< f`, `<<EOF`, `<<<`). */
function stdinRedirected(n: SyntaxNode): boolean {
  return redirectionsOf(n).some((r) => r.type === 'heredoc_redirect' || r.type === 'herestring_redirect' || (r.type === 'file_redirect' && /^0?</.test(r.text)));
}

/**
 * The command that `n`, a statement, runs to download something to its standard output (`curl URL`, `wget -qO- URL`,
 * `sudo curl URL`; `CommandSpec.downloads`), with the option of its spec that writes the download to a file instead.
 */
function downloader(n: SyntaxNode | undefined, model: StateModel, shell: Shell | undefined): { name: string; option: string } | undefined {
  if (n?.type !== 'command' || stdoutRedirected(n)) return undefined;
  const run = specRuns(n, model, shell).find((r) => downloadsTo(r.spec, r.parse, r.values) === 'stdout');
  if (!run) return undefined;
  const writes = (o: OptionSpec) => [o.value ?? []].flat().some((v) => v.io === 'write');
  return { name: run.name, option: run.spec.options!.find(writes)!.names[0] };
}

/** The one command a substitution runs (`$(curl URL)`, `"$(curl URL)"`, `<(curl URL)`), if it is all the word holds. */
function substitutedCommand(w: SyntaxNode, kind: 'command_substitution' | 'process_substitution'): SyntaxNode | undefined {
  const sub = w.type === kind ? w : w.type === 'string' && w.namedChildren.length === 1 && w.text === `"${w.namedChildren[0].text}"` ? w.namedChildren[0] : undefined;
  if (sub?.type !== kind) return undefined;
  const stmts = sub.namedChildren.filter((c) => c.type !== 'comment');
  return stmts.length === 1 ? stmts[0] : undefined;
}

/** The signals that end a script by default, which a trap's action catches, with their numbers: a hangup, Ctrl+C, `kill`. */
const STOPS = { HUP: 1, INT: 2, TERM: 15 } as const;

/** A signal as `trap` reads it (`INT`, `SIGINT`, `int`, `2`): its name without `SIG`, in capitals, when it is one of `STOPS`. */
function signalName(v: string | undefined): keyof typeof STOPS | undefined {
  const name = v === undefined ? undefined : /^\d+$/.test(v) ? Object.entries(STOPS).find(([, k]) => k === Number(v))?.[0] : v.toUpperCase().replace(/^SIG/, '');
  return name !== undefined && name in STOPS ? name as keyof typeof STOPS : undefined;
}

/**
 * The variable a word is, when it is all the word holds (`$x`, `"$x"`, `${x}`, `"${x}"`): a named variable, not a
 * positional or special parameter, an element, or an expansion with an operator.
 */
function wholeVariable(w: SyntaxNode): { name: string; text: string } | undefined {
  const e = w.type === 'string' && w.namedChildren.length === 1 && w.text === `"${w.namedChildren[0].text}"` ? w.namedChildren[0] : w;
  if (e.type === 'simple_expansion') {
    const v = e.namedChildren[0];
    return v?.type === 'variable_name' && /^[A-Za-z_]\w*$/.test(v.text) ? { name: v.text, text: e.text } : undefined;
  }
  const p = e.type === 'expansion' ? parseExpansion(e.text) : undefined;
  return p && !p.op && !p.prefix && p.subscript === undefined && /^[A-Za-z_]\w*$/.test(p.name) ? { name: p.name, text: e.text } : undefined;
}

/**
 * The rewrite that has grep read its patterns as fixed strings (`grep "$x" f` → `grep -F "$x" f`), shown as the text
 * from the command's name to the pattern `w` or the last word it changes: `-F` after the name; in place of each option
 * given that selects another mode, which `-F` would conflict with ("conflicting matchers specified"): `-E` → `-F`,
 * `--extended-regexp` → `-F`, the letter in a cluster (`-iE` → `-iF`; in quotes, the whole word in single quotes:
 * `"-iE"` → `'-iF'`); `grep -F` in place of a name that implies one (`egrep`, `implied`). None where another word whose
 * value is not known may be an option, which GNU grep takes anywhere: one before the pattern (`grep $opts "$x"`,
 * `grep "$o" -e "$x"`), or one an unquoted expansion may split (`grep "$x" $opts f`; a quoted word after the pattern is
 * taken as a file, `grep "$x" "$f"`).
 */
function fixedStrings(r: SpecRun, implied: boolean, w: SyntaxNode): Rewrite | undefined {
  const name = r.run.nameWord;
  if (r.run.args.some((a, i) => a !== w && r.values[i] === undefined && (a.endIndex <= w.startIndex || hasUnquotedExpansion(a)))) return undefined;
  const edits: TextEdit[] = implied ? [{ start: name.startIndex, end: name.endIndex, text: `${canonicalName(r.name)} -F` }] : [];
  let last = w;
  for (const { word, role } of givenOptions(r.parse)) {
    if (role.role !== 'option' || !role.spec.selects) continue;
    const node = r.run.args[word];
    const value = r.values[word];
    if (node.endIndex > last.endIndex) last = node;
    if (r.parse.roles.find((x) => x.word === word)!.role.role !== 'cluster') edits.push({ start: node.startIndex, end: node.endIndex, text: '-F' });
    else if (value === node.text) edits.push({ start: node.startIndex + role.part![0], end: node.startIndex + role.part![1], text: 'F' });
    // (A word whose value is not known returned above: it is before the pattern, or an unquoted expansion; a quoted one
    // after it, `"$o"`, is no option to the interpreter.)
    else edits.push({ start: node.startIndex, end: node.endIndex, text: `'${`${value!.slice(0, role.part![0])}F${value!.slice(role.part![1])}`.replace(/'/g, "'\\''")}'` });
  }
  if (!edits.length) edits.push({ start: name.endIndex, end: name.endIndex, text: ' -F' });
  return editSpan(name, last, edits);
}

/**
 * Whether grep reads a pattern besides the one of word `word`, which its mode applies to too: another word in the
 * language of a pattern (`-e 'a.b' -e "$x"`), or an option that gives the patterns in place of the first operand (the
 * condition of the operands' alternative, the spec's `fills`: `-e`, and `-f pats`, whose file holds patterns) besides
 * the one whose value `word` is.
 */
function otherPatterns(r: SpecRun, word: number): boolean {
  const isPattern = (role: ArgRole) => (role.role === 'operand' || role.role === 'value') && role.spec?.lang === 'regex';
  if (r.parse.roles.some((x) => x.word !== word && isPattern(x.role))) return true;
  // (Some alternative fits: the operands of grep are optional, and the last one repeats.)
  const when = r.spec.operands![r.parse.alternative!].when;
  const fills = when && 'option' in when ? when.option : [];
  const gives = (o: OptionSpec) => o.names.some((name) => fills.includes(name));
  const own = r.parse.roles.find((x) => x.word === word)!.role;
  const given = givenOptions(r.parse).filter(({ role }) => role.role === 'option' && gives(role.spec)).length;
  return given > (own.role === 'value' && gives(own.option!) ? 1 : 0);
}

/** A variable named as a pattern (`pattern`, `regex`, `re`, `expr`): its value is meant as one. */
const PATTERN_NAME = /pat|regexp?|(^|_)re(_|$)|expr/i;
/** The characters of a regular expression that are special (in a BRE, an ERE or a PCRE). */
const REGEX_SPECIAL = /[.[\]*^$\\+?(){}|]/;

/**
 * The rewrite of `[-f x]` (`open` is `[`) or `[[-f x]]` (`[[`): a space after the opener in the name, and before the
 * closer at the end of the last word when it is glued there (`x]`). None when that closer is escaped (`x\]`) or is
 * not the opener's (`[[-f x]`).
 */
function bracketSpaced(nameWord: SyntaxNode, last: SyntaxNode, open: '[' | '[['): Rewrite | undefined {
  const close = open === '[' ? ']' : ']]';
  if (!last.text.endsWith(close) || escapedEnd(last.text)) return undefined;
  const at = nameWord.startIndex + open.length;
  return editSpan(nameWord, last, [{ start: at, end: at, text: ' ' }, ...(last.text === close ? [] : [{ start: last.endIndex - close.length, end: last.endIndex - close.length, text: ' ' }])]);
}

/**
 * The rewrite of `x = 1` (or `x =1`) as the assignment `x=1`: where `=` and at most one word follow the name (`x = a b`
 * has no one meaning), with nothing else among them (a redirection).
 */
function assignmentJoined(n: SyntaxNode, name: string, a: readonly SyntaxNode[]): Rewrite | undefined {
  const apart = a[0].text === '=';
  if (a.length > (apart ? 2 : 1)) return undefined;
  const nameWord = field(n, 'name')!;
  const last = a[a.length - 1];
  if (n.namedChildren.some((c) => c !== nameWord && !a.includes(c) && c.startIndex > nameWord.startIndex && c.startIndex < last.endIndex)) return undefined;
  return replaceSpan(nameWord, last, `${name}=${apart ? a[1]?.text ?? '' : a[0].text.slice(1)}`);
}

/**
 * The rewrite of `{echo a;}`: a space after `{` in the name `{echo`, and where the `}` is glued to the command, a `;`
 * before it: as its last word (`{echo a }`: `{ echo a; }`), or at the end of its last word (`{echo a}`). Where the `}`
 * follows the command already (`;}`, a new line: the tree has it as an error), only the space. None when no `}` is
 * found (`{oops`).
 */
function braceSpaced(n: SyntaxNode, nameWord: SyntaxNode, a: readonly SyntaxNode[]): Rewrite | undefined {
  const space = { start: nameWord.startIndex + 1, end: nameWord.startIndex + 1, text: ' ' };
  const last = a[a.length - 1];
  if (last?.type === 'word' && last.text === '}') {
    const at = (a.length > 1 ? a[a.length - 2] : nameWord).endIndex;
    return editSpan(nameWord, last, [space, { start: at, end: at, text: ';' }]);
  }
  if (last?.type === 'word' && last.text.endsWith('}') && !escapedEnd(last.text)) {
    return editSpan(nameWord, last, [space, { start: last.endIndex - 1, end: last.endIndex - 1, text: '; ' }]);
  }
  const kids = n.parent!.children;
  const i = kids.indexOf(n);
  const close = kids[i + 1]?.type === ';' ? kids[i + 2] : kids[i + 1];
  return close?.type === 'error' && close.text === '}' ? editSpan(nameWord, close, [space]) : undefined;
}

/**
 * Whether `redirect`, a redirection of the command `[` (`n`) before its last word, stands for a comparison: its target
 * is a number (`[ 5>3 ]`, `[ $a 2>5 ]`), or it stands where a binary operator would (`operatorAt`). Elsewhere it is
 * plainly meant as a redirection, and the test is the one written: `[ "$n" -gt 0 2>"$log" ]`, `[ -t 0 < "$tty" ]`.
 */
function comparisonAt(n: SyntaxNode, redirect: SyntaxNode): boolean {
  // (With no word after it, `[ a < > c ]`, which bash refuses, it is still said.)
  const dest = field(redirect, 'destination');
  return !dest || /^\d+$/.test(staticWordValue(dest) ?? '') || operatorAt(n, redirect);
}

/** `operatorFits` (src/testexpr.ts) of `redirect`, a redirection of the command `[` (`n`) before its last word. */
function operatorAt(n: SyntaxNode, redirect: SyntaxNode): boolean {
  const { words } = bracketWords(n);
  const at = words.findIndex((w) => w.startIndex > redirect.startIndex);
  const fd = field(redirect, 'descriptor')?.text;
  return operatorFits(words, at < 0 ? words.length : at, fd && /^\d+$/.test(fd) ? fd : undefined);
}

/**
 * The rewrite of `[ $a < $b ]` (`redirect`, a redirection of the command `[`, `n`) as the comparison `[ $a \< $b ]`:
 * the operator escaped and a word of its own, and the digits before it a word too (`[ 5>3 ]`: `[ 5 \> 3 ]`). Only
 * where it stands as a binary operator (`operatorAt`: `[ $a 2>5 ]` would have four words, and is no comparison),
 * closed by `]`, with no other redirection before it; not `>>`, `<>` or `>|`.
 */
function escapedComparison(n: SyntaxNode, redirect: SyntaxNode): Rewrite | undefined {
  const m = /^(\d*)([<>])(?![<>|&])/.exec(redirect.text);
  const dest = field(redirect, 'destination');
  const close = args(n).at(-1)!;
  if (!m || !dest || close.text !== ']' || !operatorAt(n, redirect) || redirectionsOf(n).some((r) => r !== redirect && r.startIndex < close.startIndex)) return undefined;
  // (`[ $a>$b ]`: a blank before it, or the operator would be part of the word before.)
  const pre = /\s/.test(n.text.charAt(redirect.startIndex - n.startIndex - 1)) ? '' : ' ';
  return editSpan(field(n, 'name')!, close, [{ start: redirect.startIndex, end: redirect.endIndex, text: `${pre}${m[1] ? `${m[1]} ` : ''}\\${m[2]} ${dest.text}` }]);
}

/** The style checks whose node starts on a line from `from` to `to`, in one walk of the tree, with the model of the tree and its shell. */
export function pitfallFindings(root: SyntaxNode, lang: Lang, from: number, to: number, model: StateModel, shell: Shell | undefined): StyleFinding[] {
  const s = pick(lang);
  const found: StyleFinding[] = [];
  // (`rewrite`: the rewrites the text shows the code of; the finding carries those with edits, as a fact does. `c`:
  // what the check found that its level depends on, `STYLE_LEVELS`.)
  const add = (code: StyleCode, node: SyntaxNode, ja: string, en: string, rewrite: readonly Rewrite[] = [], c: StyleCase = {}) => {
    const convention = STYLE_CONVENTIONS[code];
    const edits = rewrite.filter((r) => r.edits.length);
    const entry = STYLE_LEVELS[code];
    const level = typeof entry === 'function' ? entry(c) : entry;
    found.push({ ...marked(lang, level, s(ja, en), { kind: 'pitfall' }), code, node, ...(convention ? { convention } : {}), ...(edits.length ? { rewrite: edits } : {}) });
  };
  const visit = (n: SyntaxNode) => {
    if (n.startPosition.row >= from && n.startPosition.row <= to) check(n);
    if (n.startPosition.row <= to && n.endPosition.row >= from) for (const c of childrenOnRows(n.namedChildren, from, to)) visit(c);
  };

  const check = (n: SyntaxNode) => {
    switch (n.type) {
      case 'command': {
        if (writtenAsBracket(n)) bracket(n);
        // The checks of the syntax read the name as written, a plain word: their rewrites edit its text, and quotes
        // already make it another word (`"[-f" x]`, `\{echo`). Those of what runs read the command it runs (`\read`).
        const written = field(n, 'name') && plainName(n);
        const name = commandName(n);
        const a = args(n);
        // `[-f x]`: the name is one word, `[-f`. (`[[-f x]]` too: `[[` is a reserved word only as a word of its own.)
        if (written && /^\[[^\]]/.test(written) && a.at(-1)?.text.endsWith(']')) {
          const nameWord = field(n, 'name')!;
          const open = written.startsWith('[[') ? '[[' : '[';
          const fix = bracketSpaced(nameWord, a.at(-1)!, open);
          const how = fix ? `\`${fix.code}\`` : `\`${open} ${written.slice(open.length)} …\``;
          if (open === '[') {
            add('bracket-no-space', nameWord, `\`[\` は普通のコマンドなので、あとに空白が要ります（\`${written}\` は別のコマンド名になる）。${how} のように書きます`,
              `\`[\` is an ordinary command, so a space must follow it (\`${written}\` reads as another command name). Write ${how}`, fix ? [fix] : []);
          } else {
            add('bracket-no-space', nameWord, `\`[[\` は1つの単語として書いたときだけ予約語になるので、あとに空白が要ります（\`${written}\` はコマンド名になる）。${how} のように書きます`,
              `\`[[\` is a reserved word only as a word of its own, so a space must follow it (\`${written}\` reads as a command name). Write ${how}`, fix ? [fix] : []);
          }
        }
        // `x = 1`: a command named x, not an assignment.
        if (written && /^[A-Za-z_]\w*$/.test(written) && a.length && (a[0].text === '=' || /^=\S/.test(a[0].text)) && !runsCommand(model, written, field(n, 'name')!, shell)) {
          const fix = assignmentJoined(n, written, a);
          const how = fix ? `\`${fix.code}\`` : `\`${written}=…\``;
          add('assignment-with-spaces', n, `\`${written} ${a[0].text}…\` は代入ではなく、\`${written}\` というコマンドを実行します。代入は \`=\` の前後に空白を入れずに ${how} と書きます`,
            `\`${written} ${a[0].text}…\` runs a command named \`${written}\`; it is not an assignment. Write ${how} with no spaces around \`=\``, fix ? [fix] : []);
        }
        // `{echo a;}`: no space after `{`, so it is a command named `{echo`.
        if (written && /^\{[A-Za-z_]\w*$/.test(written)) {
          const fix = braceSpaced(n, field(n, 'name')!, a);
          const how = fix && !fix.code.includes('\n') ? `\`${fix.code}\`` : `\`{ ${written.slice(1)} …; }\``;
          add('brace-no-space', field(n, 'name')!, `\`${written}\` は \`{\` の直後に空白がないので、グループの開始ではなく \`${written}\` というコマンド名です。\`{\` の後には空白が必要で、\`}\` の前には \`;\` か改行が必要です: ${how}`,
            `there is no space after \`{\`, so \`${written}\` is a command name, not the start of a group. \`{\` needs a space after it, and \`}\` needs a \`;\` or newline before it: ${how}`, fix ? [fix] : []);
        }
        // `{ echo a; echo b }`: `}` is an argument of the last command, and the group is never closed. (Not in zsh, where
        // a `}` closes the group anywhere unless IGNORE_CLOSE_BRACES is set: zshoptions.)
        const lastArg = a[a.length - 1];
        if (shell !== 'zsh' && lastArg?.type === 'word' && lastArg.text === '}' && n.parent?.type === 'compound_statement' && n.parent.incomplete) {
          // (`;` right before the `}`, after the words and redirections before it: `echo b >f; }`.)
          const at = Math.max(...n.children.filter((c) => c.endIndex <= lastArg.startIndex).map((c) => c.endIndex));
          const fix = editSpan(n, lastArg, [{ start: at, end: at, text: ';' }]);
          // (The name as written: `{ ./x b }`, `{ $cmd b }`.)
          const head = field(n, 'name')!.text;
          add('brace-close-no-separator', lastArg, `\`}\` の前に \`;\` か改行が必要です。このままでは \`}\` は \`${head}\` の引数で、\`{ }\` のグループが閉じていません: \`${fix.code}\``,
            `\`}\` needs a \`;\` or a newline before it. As written, \`}\` is an argument of \`${head}\` and the \`{ }\` group is never closed: \`${fix.code}\``, [fix]);
        }
        // `rm -rf $DIR/…`: an empty DIR removes from the root. (Also when another command runs it: `sudo rm -rf $DIR/…`.)
        for (const run of runCommands(n, model, shell)) {
          if (run.name === 'rm' && run.args.some((w) => /^-[a-zA-Z]*[rR]/.test(w.text) || w.text === '--recursive')) rmFromRoot(n, run.args);
        }
        // `read` without -r eats backslashes.
        // Only when it reads into a variable; `read` alone or `read -n 1` waits for a key. Only the builtin: not a
        // function of that name (src/semantics/names.ts).
        const readsVar = a.some((w) => /^[A-Za-z_]\w*$/.test(w.text));
        if (name === 'read' && readsVar && !a.some((w) => /^-[a-zA-Z]*[rnN]/.test(w.text)) && resolveRun(model, { nameWord: field(n, 'name')! }, shell)!.kind === 'builtin') {
          // (A path runs no builtin, `pathCommand`; a name in quotes or with a backslash does, and the rewrite writes it plainly.)
          const fix = replaceNode(field(n, 'name')!, 'read -r');
          add('read-without-r', n, `\`-r\` を付けないと、入力のバックスラッシュ（\`\\\`）がエスケープとして消えます。ふつうは \`${fix.code}\` と書きます`,
            `without \`-r\`, backslashes in the input are taken as escapes and lost. Usually write \`${fix.code}\``, [fix]);
        }
        downloadRun(n);
        trapGoesOn(n);
        sourceSearchesPath(n);
        patternFromVariable(n);
        break;
      }
    }
  };

  /**
   * A shell that runs what a download prints, unseen: from a pipe (`curl URL | sh`, `wget -qO- URL | sudo bash -s`), a
   * process substitution (`bash <(curl URL)`, `source <(curl URL)`) or a string (`sh -c "$(curl URL)"`, `eval "$(curl URL)"`).
   * What reads its script from stdin, or runs a file or a string, comes from the specs (`OperandAlt.stdin`, `io: 'run'`,
   * a slot that runs a string), and what downloads to stdout too (`CommandSpec.downloads`).
   */
  const downloadRun = (n: SyntaxNode) => {
    const runs = specRuns(n, model, shell);
    // (`runner`: what runs the file instead, `source` for a string this shell runs.)
    const say = (at: SyntaxNode, sh: string, dl: { name: string; option: string }, stream: boolean, runner = sh) => {
      const fix = s(`先にファイルへダウンロードし（\`${dl.name} ${dl.option} ファイル …\`）、中身を確かめてから実行します（\`${runner} ファイル\`）`,
        `Download it to a file first (\`${dl.name} ${dl.option} FILE …\`), check it, then run the file (\`${runner} FILE\`)`);
      add('download-run-by-shell', at, stream
        ? `\`${sh}\` は \`${dl.name}\` がダウンロードするスクリプトを、誰も読まないまま、届いた行から順に実行します。ダウンロードが途中で切れても、届いた行（途中で切れた最後の行も）は実行されます。${fix}`
        : `\`${sh}\` は \`${dl.name}\` がダウンロードするスクリプトを、誰も読まないまま実行します。ダウンロードが途中で切れても、届いた分が実行されます。${fix}`,
      stream
        ? `\`${sh}\` runs the script \`${dl.name}\` downloads without anyone reading it, each line as it arrives: if the download breaks off, the lines that came still run, the last one perhaps cut short. ${fix}`
        : `\`${sh}\` runs the script \`${dl.name}\` downloads without anyone reading it: if the download breaks off, the part that came still runs. ${fix}`);
    };
    // `curl URL | bash`: the stage before gives the shell its script. (Not `bash < f`: stdin is the file.)
    const p = n.parent;
    if (p?.type === 'pipeline' && !stdinRedirected(n)) {
      const sh = runs.find((r) => readsScriptFromStdin(r.spec, r.parse, r.values));
      const dl = sh && downloader(p.namedChildren[p.namedChildren.indexOf(n) - 1], model, shell);
      if (sh && dl) return say(n, sh.name, dl, true);
    }
    for (const r of runs) {
      for (const { word, role } of r.parse.roles) {
        const w = r.run.args[word];
        // `bash <(curl URL)`, `. <(curl URL)`: a file it runs, read from a pipe as the download goes.
        const piped = role.role === 'operand' && role.spec?.io === 'run' ? substitutedCommand(w, 'process_substitution') : undefined;
        // `sh -c "$(curl URL)"`, `eval "$(curl URL)"`: the string is the whole download. (Not a trap's, run later.)
        const slot = role.role === 'command' && runsString(role.slot) && !role.slot.later ? role.slot : undefined;
        const dl = downloader(piped ?? (slot && substitutedCommand(w, 'command_substitution')), model, shell);
        if (dl) return say(w, r.name, dl, !!piped, slot?.run === 'current-shell' ? (shell === undefined || shell === 'bash' ? 'source' : '.') : r.name);
      }
    }
  };

  /**
   * `source lib.sh`, `. lib.sh`: a name with no `/` is looked for in the directories of `$PATH` first (the operand's
   * `searchesPath`, while `sourcepath` is on), and then in the current directory, which is where the script was
   * started from (in POSIX mode, and in sh, only in `$PATH`). Not for a path (`./lib.sh`), a name whose value is not
   * known, with `-p` (bash 5.3: the directories are given), with `sourcepath` off or not known to be on, nor in zsh
   * or ksh, whose `.` searches otherwise. Its rewrites put a directory before the name: the script's, which the note
   * recommends (cron starts elsewhere), where the shell names it; then the current directory's, `./`, which reads the
   * file the search would find there.
   */
  const sourceSearchesPath = (n: SyntaxNode) => {
    const posixShell = shell === 'sh' || shell === 'dash' || shell === 'ash';
    if (shell !== undefined && shell !== 'bash' && !posixShell) return;
    for (const r of specRuns(n, model, shell)) {
      for (const { word, role } of r.parse.roles) {
        const search = role.role === 'operand' ? role.spec?.searchesPath : undefined;
        const file = r.values[word];
        if (!search || !file || file.includes('/') || has(r.parse, ...search.instead)) continue;
        // (Only the builtin searches: `sudo source f` starts a program of that name, which the wrappers' note is about.)
        if (resolveRun(model, r.run, shell)!.kind !== 'builtin') return;
        const st = model.at(n).run;
        const on = option(st, 'shopt', search.shopt);
        if (!posixShell && on !== 'on' && on !== 'default') return;
        const posix = posixShell || option(st, 'set', 'posix') === 'on';
        const cmd = `${r.name} ${file}`;
        const w = r.run.args[word];
        const before = (text: string) => editSpan(r.run.nameWord, w, [{ start: w.startIndex, end: w.startIndex, text }]);
        // (The script's directory: bash names the file being read in `BASH_SOURCE`, sourced too; sh has only `$0`, the
        // script's own path where the file is run, and the caller's where it is sourced. Typed into a terminal, there
        // is no script.)
        const read = readAs(model.env(n), model.read);
        const dir = read === 'terminal' ? undefined : !posixShell ? '"$(dirname "${BASH_SOURCE[0]}")"/' : read === 'script' ? '"$(dirname "$0")"/' : undefined;
        const [fromDir, here] = [dir && before(dir), before('./')];
        const fix = fromDir
          ? s(`スクリプトのディレクトリからのパス（\`${fromDir.code}\`）か、カレントディレクトリから読むなら \`${here.code}\` と書きます`,
            `Write a path from the script's directory, \`${fromDir.code}\`, or \`${here.code}\` to read it from the current directory`)
          : s(`カレントディレクトリから読むなら \`${here.code}\` と書きます`, `Write \`${here.code}\` to read it from the current directory`);
        add('source-searches-path', w, posix
          ? `\`${cmd}\` は \`${file}\` を \`$PATH\` のディレクトリからだけ探し、カレントディレクトリは探しません（POSIX の動作）。\`$PATH\` になければ失敗し、あればそのファイルが実行されます。${fix}`
          : `\`${cmd}\` は \`${file}\` をまず \`$PATH\` のディレクトリから探し、見つからないときだけカレントディレクトリを探します。\`$PATH\` に同じ名前のファイルがあればそちらが実行され、カレントディレクトリはスクリプトの場所ではなく、起動したときの場所です（cron なら \`$HOME\`）。${fix}`,
        posix
          ? `\`${cmd}\` looks for \`${file}\` only in the directories of \`$PATH\`, not in the current directory (as POSIX says): it fails unless \`$PATH\` has it, and then runs the file found there. ${fix}`
          : `\`${cmd}\` looks for \`${file}\` in the directories of \`$PATH\` first, and only then in the current directory: a file of that name in \`$PATH\` runs instead, and the current directory is where the script was started from, not where it lies (cron starts in \`$HOME\`). ${fix}`,
        fromDir ? [fromDir, here] : [here]);
        return;
      }
    }
  };

  /**
   * `grep "$USER" f`, `grep -e "$x" f`: a pattern (an operand or a value in `lang: 'regex'`) that is only a variable is
   * read as a regular expression, so it matches inside longer text, and its special characters have their meaning.
   * Not with a fixed string (`-F`, `fgrep`: the mode `fixed`), an option that matches only whole words or lines
   * (`whole`: `-w`, `-x`), a pattern with text of its own (`"^$USER:"`), a positional parameter (`"$1"`, often meant
   * as a pattern), a variable named as a pattern (`"$pattern"`), nor one whose known value has special characters.
   * Where grep has other patterns (`-e 'a.b' -e "$x"`, `-f pats`), the note gives no `-F`, which would read them as
   * fixed strings too (`otherPatterns`), and says so.
   */
  const patternFromVariable = (n: SyntaxNode) => {
    for (const r of specRuns(n, model, shell)) {
      // (The options an alias implies are in the spec of the command it is: `egrep`, `-E` of grep.)
      const implied = impliedOptions(r.name, r.spec);
      const given = givenOptions(r.parse).map(({ role }) => role);
      for (const word of regexWords(r.parse, implied)) {
        const w = r.run.args[word];
        const v = wholeVariable(w);
        const known = v && model.trusts(v.name) ? model.at(w).run.variables.get(v.name)?.value : undefined;
        if (!v || PATTERN_NAME.test(v.name) || (known !== undefined && REGEX_SPECIAL.test(known))) continue;
        const others = otherPatterns(r, word);
        // (Where a word whose text is not known may be an option, the note says what to do, with no code: `-F` conflicts
        // with an option that selects another mode, and goes in its place.)
        const fix = others ? undefined : fixedStrings(r, implied.some((o) => o.selects), w);
        const other = given.find((o) => o.role === 'option' && o.spec.selects)?.flag ?? (implied.some((o) => o.selects) ? r.name : undefined);
        const fixed = fix ? s(`\`${fix.code}\` と書き`, `write \`${fix.code}\``)
          : other === undefined ? s('`-F` を付け', 'add `-F`')
            : other === r.name ? s(`\`${r.name}\` の代わりに \`${canonicalName(r.name)} -F\` を使い`, `use \`${canonicalName(r.name)} -F\` in place of \`${r.name}\``)
              : s(`\`${other}\` の代わりに \`-F\` を付け`, `write \`-F\` in place of \`${other}\``);
        const advice = others
          ? s('値をそのまま探す `-F` はすべてのパターンに効き、ほかのパターンも固定文字列として読まれます',
            '`-F`, which would look for the value as it is, applies to every pattern: the others would be read as plain text too')
          : s(`値をそのまま探すには ${fixed}、意図に合わせて \`-w\`（単語全体）か \`-x\`（行全体）も付けます`,
            `To look for the value as it is, ${fixed}, with \`-w\` (whole words) or \`-x\` (whole lines) as meant`);
        add('pattern-from-variable', w, `\`${r.name}\` は \`${v.text}\` の値を、ただの文字列ではなく正規表現として読みます。長い文字列の一部にも一致し（\`bob\` は \`bobby\` にも一致）、値の中の \`.\`・\`*\`・\`[\` などは特別な意味を持ちます。${advice}`,
          `\`${r.name}\` reads the value of \`${v.text}\` as a regular expression, not as plain text: it matches inside longer text too (\`bob\` matches \`bobby\`), and \`.\`, \`*\`, \`[\` and the like in the value have their special meaning. ${advice}`, fix ? [fix] : []);
        return;
      }
    }
  };

  /**
   * `trap 'echo bye' INT` (or TERM, HUP): when the signal comes, bash runs the action and goes on where it was, so the
   * script does not stop. Only for an action whose text is known, and which surely does not end the shell
   * (`endsShell`). Not `trap '' INT` (ignore it), nor `trap - INT` (the default again).
   */
  const trapGoesOn = (n: SyntaxNode) => {
    const r = specRuns(n, model, shell)[0];
    // (Its own words: `sudo trap` runs no builtin.)
    const at = r?.parse.roles.find(({ role }) => role.role === 'command' && role.slot.later);
    if (!at) return;
    const w = r.run.args[at.word];
    const signals = [...new Set(r.parse.roles.flatMap(({ word, role }) => (role.role === 'operand' && role.spec?.name === 'SIGNAL' ? [signalName(r.values[word])] : [])))]
      .filter((x) => x !== undefined);
    if (!signals.length) return;
    const script = model.script([w], slotEnvs(model.env(n), r.parse, r.spec, r.run.args, model.shell, lookupCommand).get(w)!);
    if ('why' in script || script.text === '' || endsShell(script.tree.root, new Set()) !== false) return;
    const code = (x: keyof typeof STOPS) => `\`exit ${128 + STOPS[x]}\``;
    const named = signals.map((x) => (x === 'INT' ? s('`INT`（Ctrl+C）', '`INT` (Ctrl+C)') : `\`${x}\``));
    const list = s(named.join('・'), named.length > 1 ? `${named.slice(0, -1).join(', ')} or ${named.at(-1)}` : named[0]);
    const exits = signals.length === 1
      ? s(`${code(signals[0])}（128 + \`${signals[0]}\` の番号 ${STOPS[signals[0]]}）`, `${code(signals[0])} (128 + ${STOPS[signals[0]]}, the number of \`${signals[0]}\`)`)
      : s(`\`exit\` と 128 + シグナルの番号をシグナルごとの \`trap\` で書きます（${signals.map((x) => `\`${x}\` は ${code(x)}`).join('、')}）`,
        `\`exit\` and 128 + the signal's number, in a trap of each signal (${signals.map((x) => `${code(x)} for \`${x}\``).join(', ')})`);
    // (A space between code and Japanese, not after a closing parenthesis.)
    const sp = (t: string) => (t.endsWith('`') ? ' ' : '');
    add('trap-goes-on', w, `${list}${sp(list)}を受けると、bash はこの処理を実行したあと、スクリプトを中断したところから続けるので、スクリプトは止まりません。止めるには、処理の最後に ${exits}${signals.length === 1 ? `${sp(exits)}を書きます` : ''}`,
      `when ${list} comes, bash runs this action and then goes on with the script from where it was, so the script does not stop. To stop it, end the action with ${exits}`);
  };

  /**
   * Whether the commands under `root` (a trap's action, a function body) may end the shell: `exit`, `exec cmd`, a
   * `kill` of `$$`, or a function that does (`seen`: the bodies on the way). Undefined when it cannot be told: a name
   * that is neither a builtin, a function of the script nor a program the dictionary knows (a function of a file
   * `source` reads), or an alias.
   */
  const endsShell = (root: SyntaxNode, seen: Set<SyntaxNode>): boolean | undefined => {
    let unknown = false;
    for (const c of descendants(root, ['command'])) {
      const nameWord = field(c, 'name');
      if (!nameWord) continue;
      const r = resolveName(model, nameWord.text, nameWord, { shell, command: true, program: (p) => !!lookupCommand(p) });
      if (r.kind === 'function') {
        // (A function the name runs is defined in the script.)
        /* c8 ignore next */
        for (const def of model.definitions.functions.get(nameWord.text) ?? []) {
          // (A definition being typed may have no body yet: `f()  f; }`.)
          const body = field(def, 'body');
          if (!body || seen.has(body)) continue;
          seen.add(body);
          const ends = endsShell(body, seen);
          if (ends !== false) return ends;
        }
        continue;
      }
      if (r.kind === 'alias' || (r.kind === 'file' && !r.known)) {
        unknown = true;
        continue;
      }
      // (A builtin, or a program the dictionary knows.)
      const spec = lookupCommand(nameWord.text)!;
      const a = args(c);
      // (`kill -s INT $$`, `kill 0`: the signal again, to the shell itself or its process group.)
      if (spec.ends === 'shell' || (commandName(c) === 'kill' && a.some((w) => /\$\$|\$\{\$\}|\$\{?BASHPID\b|^-?0$/.test(w.text)))) return true;
      // `exec cmd`: the command replaces the shell (`exec 2>&1` alone does not).
      if (interpret(spec, a.map(argWordFor(model.shell, bracesIn(model))), { lookup: lookupCommand }).roles.some(({ role }) => role.role === 'command' && role.slot.replacesShell)) return true;
    }
    return unknown ? undefined : false;
  };

  /** `rm -r` with these words: the first that removes from the root when a variable in it is empty. */
  // (`n`: the command, where the check before it stops.)
  const rmFromRoot = (n: SyntaxNode, words: readonly SyntaxNode[]) => {
    for (const w of words) {
      const t = rootTarget(w);
      if (!t) continue;
      const { e, v, left } = t;
      // (Nor a plain value the script surely set to some text: `DIR=/opt/app; rm -rf $DIR/*`.)
      if (t.plain && neverEmpty(model, v, e)) continue;
      // (A check before it, `[ -n "$DIR" ] || exit 1`, leaves the warning: the model does not narrow a value through
      // a test, docs/design/semantics.md 4.15.)
      const safe = t.plain && quoteExpansions(w, new Map([[e, `\${${v}:?}`]]));
      if (safe) {
        const fix = replaceNode(w, safe);
        add('rm-empty-variable-root', w, `\`${v}\` が空だと \`rm -r ${left}\` になり、ルートから削除してしまいます。\`${fix.code}\` と書くと、空のときは止まります`,
          `if \`${v}\` is empty this becomes \`rm -r ${left}\`, deleting from the root. Write \`${fix.code}\` to stop when it is empty`, [fix]);
      } else {
        // `${DIR%/}` has no form with `:?` (and is empty for DIR=/ too); `${x:-*.txt}` has no quoted form.
        const what = t.plain ? v : e.text;
        if (t.test) {
          // (The check stops where the code runs: `exit 1` in a script, `return 1` in a function, both where it may be
          // sourced. Said, but carried as no edits: the warning stays after it, since the model does not narrow a value
          // through a test, docs/design/semantics.md 4.15; a quick fix would not clear it.)
          const check = `${t.test} || ${stopCommand(n, model, !!ancestor(n, (x) => x.type === 'function_definition'))}`;
          add('rm-empty-variable-root', w, `\`${what}\` が空だと \`rm -r ${left}\` になり、ルートから削除してしまいます。前に \`${check}\` と書くと、空のときは止まります`,
            `if \`${what}\` is empty this becomes \`rm -r ${left}\`, deleting from the root. Write \`${check}\` before it to stop when it is empty`);
        } else {
          // (A quote or backslash in the expansion: a check in quotes would not read it the same.)
          add('rm-empty-variable-root', w, `\`${what}\` が空だと \`rm -r ${left}\` になり、ルートから削除してしまいます。空でないことを前に確かめてください`,
            `if \`${what}\` is empty this becomes \`rm -r ${left}\`, deleting from the root. Check that it is not empty before it`);
        }
      }
      break;
    }
  };

  /** `[ … ]`, by its spelling: what goes wrong in how it is written. */
  const bracket = (n: SyntaxNode) => {
    // `[ $a < $b ]`, `[ 5>3 ]`: `<` and `>` are redirections of the command `[`. (Not those after its last word,
    // `[ … ] >f`, nor those plainly meant as redirections: to a device, `2>/dev/null`, a copy of a descriptor, `2>&1`,
    // or where no comparison would be, `comparisonAt`.)
    const end = args(n).at(-1)?.startIndex ?? -1;
    const meant = (e: SyntaxNode) => /&/.test(e.children.find((c) => !c.named)!.type) || /^\/dev\//.test(field(e, 'destination')?.text ?? '') || !comparisonAt(n, e);
    const redirect = n.namedChildren.find((e) => e.type === 'file_redirect' && e.startIndex > field(n, 'name')!.startIndex && e.startIndex < end && !meant(e));
    if (redirect) {
      const op = redirect.text.match(/^\d*[<>]+/)![0];
      const fix = escapedComparison(n, redirect);
      const ja = fix ? `エスケープして \`${fix.code}\` と書くか、\`[[ ]]\` を使います` : `\`[[ ]]\` を使うか、\`\\${op.match(/[<>]/)![0]}\` とエスケープします`;
      const en = fix ? `Escape it to compare strings by order, \`${fix.code}\`, or use \`[[ ]]\`` : `Use \`[[ ]]\` to compare strings by order, or escape it as \`\\${op.match(/[<>]/)![0]}\``;
      add('redirect-in-bracket', redirect, `\`[ ]\` の中の \`${op}\` は比較ではなくリダイレクトとして読まれます。文字列の順序の比較は${fix ? '、' : ' '}${ja}`,
        `\`${op}\` inside \`[ ]\` is read as a redirection, not a comparison. ${en}`, fix ? [fix] : []);
    }
    const { words, close } = bracketWords(n);
    const last = words[words.length - 1];
    const next = n.parent?.children[n.parent.children.indexOf(n) + 2];
    const sep = n.parent?.children[n.parent.children.indexOf(n) + 1];
    if (!close && last && /[^\s]\]$/.test(last.text)) {
      // `[ -f $x]`. (With a last word of known text, `[ -f x]`, the analyzer says it: `bracket-close-glued`.)
      if (staticWordValue(last) !== undefined) return;
      // (When what is before the `]` may be empty, `"$x"]` may be `]` alone, which closes `[`: one argument fewer.)
      const parts = last.type === 'concatenation' ? last.namedChildren : [last];
      // (`"$x"\]` too: the `]` is quoted, still one character.)
      const before = staticWordValue(parts.at(-1)!) === ']' ? parts.slice(0, -1) : [];
      // (The rewrite, a space before the `]`: none when it is escaped, `"$x"\]`, which a space leaves a character.)
      const fix = escapedEnd(last.text) ? [] : [replaceNode(last, `${last.text.slice(0, -1)} ]`)];
      const fixed = fix.length ? { ja: `（\`${fix[0].code}\`）`, en: ` (\`${fix[0].code}\`)` } : { ja: '', en: '' };
      if (before.length && before.every((p) => mayBeEmpty(model, p))) {
        const v = before.map((p) => p.text).join('');
        const earlier = words.slice(0, -1);
        const runs = `[ ${[...earlier.map((w) => w.text), ']'].join(' ')}`;
        // What that shorter test does, read as `test` reads it (src/testexpr.ts): a word in double quotes is one operand.
        const texts = earlier.map((w) => staticWordValue(w) ?? (w.type === 'string' ? 'x' : null));
        const outcome = texts.includes(null) ? undefined : !texts.length ? 'false' : testFails(texts) ? 'error' : texts.length === 1 ? 'true' : undefined;
        const [ja, en] = outcome === 'false' ? ['偽（終了ステータス 1）になります（単語のない条件は偽）', 'false (status 1), as a test of no words is']
          : outcome === 'error' ? ['たいてい「unary operator expected」などのエラーになります（終了ステータス 2）', 'usually an error such as "unary operator expected" (status 2)']
          : outcome === 'true' ? ['真になります（単語1つだけの条件は、空でなければ真）。意図した条件ではありません', 'true, as one word alone is when it is not empty: not the condition meant']
          : ['その引数のない条件になり、意図した条件ではありません', 'a test without that argument: not the condition meant'];
        add('bracket-close-in-word', last, `\`${last.text}\` の \`]\` は単語の一部です。\`${v}\` が空のときは単語が \`]\` だけになって \`[\` を閉じ、\`${runs}\` は${ja}。値があるときは閉じの \`]\` がなく、エラーになります（\`missing ']'\`、終了ステータス 2）。\`]\` の前に空白が要ります${fixed.ja}`,
          `the \`]\` in \`${last.text}\` is part of the word. When \`${v}\` is empty, the word is \`]\` alone and closes \`[\`, and \`${runs}\` is ${en}. With a value, \`[\` has no closing \`]\` and fails ("missing ']'", status 2). \`]\` needs a space before it${fixed.en}`, fix, { maybeEmpty: true });
        return;
      }
      add('bracket-close-in-word', last, `\`${last.text}\` の \`]\` は単語の一部として読まれ、閉じの \`]\` がありません（\`missing ']'\`）。\`]\` の前に空白が要ります${fixed.ja}`,
        `the \`]\` in \`${last.text}\` is read as part of the word, so \`[\` has no closing \`]\` ("missing ']'"). \`]\` needs a space before it${fixed.en}`, fix);
    } else if (!close && (sep?.type === '&&' || sep?.type === '||') && next?.type === 'command' && args(next).at(-1)?.text === ']') {
      // `[ a && b ]`: a `]` at the end of the left, a `[` at the start of the right.
      const fix = editSpan(n, next, [{ start: n.endIndex, end: n.endIndex, text: ' ]' }, { start: next.startIndex, end: next.startIndex, text: '[ ' }]);
      add('and-or-in-bracket', sep, `\`[ ]\` の中の \`${sep.type}\` は \`[\` の引数ではなく、コマンドをつなぐ演算子です。\`]\` が足りず、\`${fix.code}\` と分けて書くか、\`[[ ]]\` を使います`,
        `\`${sep.type}\` inside \`[ ]\` is not an argument of \`[\` but the operator that joins commands, so \`[\` loses its \`]\`. Write \`${fix.code}\`, or use \`[[ ]]\``, [fix]);
    }
  };
  visit(root);
  return found;
}
