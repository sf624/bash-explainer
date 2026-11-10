import type { Lang } from './i18n';
import { quoteExpansions } from './fixes';
import { type Fact, fact, type Params } from './messages';
import { featureWorks, type Shell } from './dialect';
import { builtins } from './dict/builtins';
import { parseExpansion } from './expansion';
import { args, commandName, pathCommand, runCommands, specRuns } from './pitfalls';
import { replaceNode, replaceSpan, type Rewrite, stringShell } from './rewrite';
import { isFunction, type NameResolution, resolveName, resolveRun, testSpecAt } from './semantics/names';
import { shebangRefused, type StateModel } from './semantics/state';
import { errexitStops, firstUnbound, unboundRead } from './semantics/unbound';
import { expansionValue, type ExpansionValue } from './semantics/values';
import { globParts } from './semantics/chars';
import { isBash } from './shellfeatures';
import { partMeaning, wordFields, wordMeaning, wordOf } from './semantics/words';
import { staticWordValue } from './staticword';
import { ancestor, childrenOnRows, field, fields, isShebang, nameText, prefixAssignments, readsVariable, redirectionsOf } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';
import type { ArgRole, ArgvParse } from './argv/interpret';

// The pitfalls that follow from how the shell reads the words of a command: what the current shell expands before a
// command runs (`FOO=1 echo $FOO`, `sudo cmd > /etc/…`), and what word splitting and globbing do to an unquoted
// expansion (a path, `for f in $(ls)`, `for a in $*`, `[ $x = y ]`); a read of an unset variable under `set -u`, and
// options of a shebang that bash refuses. Each is found from the syntax tree, only on the line where its node starts,
// and said from the catalog (src/messages.ts) with the sections of the manual it is about.
// The style checks, which are not facts of the models, are in src/pitfalls.ts.

/** The file commands whose unquoted variables are worth a warning. */
const PATH_COMMANDS = new Set(['rm', 'cp', 'mv', 'cd', 'mkdir', 'touch', 'chmod', 'chown', 'ln', 'cat', 'source', '.']);
/** Of those, the ones that delete or overwrite what a path names: a wrong path given to them cannot be undone. */
const DESTRUCTIVE_COMMANDS = new Set(['rm', 'cp', 'mv']);

/**
 * The command a resolution runs, when it is known: an alias is its target. A function keeps its name: bash expands
 * the words before calling it, so `rm() { command rm -i "$@"; }; rm $f` splits `$f` all the same.
 */
function ranName(r: NameResolution): string | undefined {
  if (r.kind === 'alias') return r.sure && r.target ? ranName(r.target) : undefined;
  // (A path runs a file, never a builtin: `./cd` is not `cd`.)
  return pathCommand(r.name);
}

/** Static paths under the system directories that, by the FHS, only root writes (`/var/log`, `/var/lib` are for the programs' users too). */
const ROOT_ONLY_PATH = /^(\/etc|\/usr|\/boot|\/root|\/opt|\/sys|\/proc\/sys|\/lib)\//;

/** The path a redirection writes to, after quote removal when it is known. */
function destination(d: SyntaxNode | null | undefined): string {
  return !d ? '' : staticWordValue(d) ?? d.text.replace(/^["']/, '');
}

/** Is the node a parameter expansion (`$x`, `${x}`)? */
function isExpansion(n: SyntaxNode): boolean {
  return n.type === 'simple_expansion' || n.type === 'expansion';
}

/** `$?`, `$#`, `$$`, `$!` and `${#…}`: always a number, so safe unquoted. */
function alwaysNumber(n: SyntaxNode): boolean {
  return /^\$[?#$!]$/.test(n.text) || /^\$\{#/.test(n.text);
}

/**
 * `a=$@`, `x=${arr[@]}`, `local x="$@"`: the whole value of an assignment is every argument or element, which bash
 * joins into one string there (src/semantics/words.ts: no word splitting in `assignment-value`), with what to write
 * instead. Not a count or the keys (`${#a[@]}`, `${!a[@]}`), a slice (`${@: -1}`, often one element), an assignment
 * that is a prefix of a command (`x=$@ cmd`) or an argument of `export` (the environment holds strings), one to an
 * element (`a[0]=$@`), nor in a shell without arrays. The rewrites: an array, `x=("$@")`; and `x="$*"`, the same
 * string where the IFS in effect starts with a space (`"$*"` joins with its first character, the assignment with a space).
 */
function joinedArray(n: SyntaxNode, model: StateModel, shell: Shell | undefined): Params<'array-joined-in-assignment'> | undefined {
  if (!featureWorks('array', shell)) return undefined;
  const p = n.type === 'expansion' ? parseExpansion(n.text) : undefined;
  const all = n.type === 'simple_expansion' ? nameText(n) === '$@' : !!p && !p.prefix && p.op !== ':' && (p.subscript === undefined ? p.name === '@' : p.subscript === '@');
  const word = all ? wordOf(n) : undefined;
  if (word?.context !== 'assignment-value') return undefined;
  // (An assignment's value is one word.)
  const value = word.nodes[0];
  if (value !== n && !(value.type === 'string' && value.namedChildren.length === 1 && value.text === `"${n.text}"`)) return undefined;
  // (The assignment, and the command it is in: a statement of assignments, `local`…, or a prefix of a command.)
  const a = value.parent!;
  const cmd = a.parent!;
  const name = field(a, 'name')!;
  // (`export x=$@`: what goes into the environment is a string; an array is not exported.)
  if (name.type !== 'variable_name' || (field(cmd, 'name') && (a.field !== 'argument' || commandName(cmd) === 'export'))) return undefined;
  // (`=` or `+=`.)
  const op = a.text.slice(name.endIndex - a.startIndex, value.startIndex - a.startIndex);
  const starred = n.text === '$@' ? '$*' : n.text.replace(/^\$\{@/, '${*').replace('[@]', '[*]');
  const ifs = wordMeaning(n, model)!.ifs;
  const spaced = ifs.kind === 'default' || (ifs.kind === 'value' && ifs.value.startsWith(' '));
  return { v: name.text, op, word: value.text, args: !p?.subscript, rewrite: [replaceNode(value, `("${n.text}")`), ...(spaced ? [replaceNode(value, `"${starred}"`)] : [])] };
}

/** Literal text that the shell reads the same in any context, unquoted or in single quotes. */
const PLAIN = /^[\w@%+=:,./-]+$/;

/**
 * `v=1 cmd $v`: the command, from its name to its last word, through the shell of the script (`bash -c`, `sh -c`…),
 * which expands `$v` once `v` is set: `v=1 bash -c 'cmd "$v"'`. Mechanical only where that shell runs the same command
 * with the same words: the name runs a program, or a builtin that is one too (`echo`, `printf`), and no redirection is
 * among the words; each word is plain text, an expansion of the prefix's variables (`vars`, put in double quotes), text
 * in double quotes with only such expansions, or text in single quotes that reads the same in double quotes
 * (`'%s\n'`), as the words go inside single quotes. No other expansion, which that shell would expand, and no glob or
 * brace, which it may expand otherwise. `sh` may be dash: there only a program, or `echo` and `printf` with no option
 * and no `%q` or `%b`. Else the note shows the form, with no edits. A builtin that acts on this shell (`cd`, `read`), a
 * function or an alias, which no other shell has: the value set apart, first (`apart`), with no edits.
 */
function throughShell(n: SyntaxNode, vars: readonly string[], v: string, model: StateModel, shell: Shell | undefined): { rewrite: Rewrite; apart: boolean } {
  const name = field(n, 'name')!;
  const words = args(n);
  const last = words[words.length - 1];
  const prefixed = (x: SyntaxNode): boolean => isExpansion(x) && vars.some((w) => x.text === `$${w}` || x.text === `\${${w}}`);
  /** The word as the script of `sh -c` holds it, or undefined. */
  const inner = (x: SyntaxNode): string | undefined => {
    if (x.type === 'word') return PLAIN.test(x.text) ? x.text : undefined;
    if (prefixed(x)) return `"${x.text}"`;
    if (x.type === 'string') return !x.text.includes("'") && x.namedChildren.every((c) => c.type === 'string_content' || prefixed(c)) ? x.text : undefined;
    if (x.type === 'raw_string') return /^'([^$`"\\]|\\[^$`"\\\n])*'$/.test(x.text) ? `"${x.text.slice(1, -1)}"` : undefined;
    const parts = x.type === 'concatenation' ? x.namedChildren.map(inner) : [undefined];
    return parts.every((p) => p !== undefined) ? parts.join('') : undefined;
  };
  const r = resolveName(model, name.text, name, { shell, command: true });
  if (isFunction(r) || r.kind === 'alias' || (r.kind === 'builtin' && !builtins[r.name].program)) return { rewrite: { code: `${v}=…; ${name.text} … "$${v}"`, edits: [] }, apart: true };
  // (What is left runs a program, or a builtin that is one too: no keyword takes an assignment before it.)
  const program = stringShell(shell, name.text, words.map((w) => w.text));
  const among = redirectionsOf(n).some((d) => d.startIndex < last.endIndex && d.endIndex > name.startIndex);
  const script = words.map(inner);
  if (!program || among || !PLAIN.test(name.text) || script.includes(undefined)) return { rewrite: { code: `${shell ?? 'bash'} -c '… "$${v}"'`, edits: [] }, apart: false };
  return { rewrite: replaceSpan(name, last, `${program} -c '${[name.text, ...script].join(' ')}'`), apart: false };
}

/**
 * The words of a parse (numbered in its words) that the command reads as data: an operand or a value written in another
 * language (`OperandSpec.lang`, `ValueSpec.lang`: grep's pattern, sed's script), those of its subcommands too.
 */
function dataWords(p: ArgvParse): number[] {
  return p.roles.flatMap(({ word, role }) => (role.role === 'subcommand' ? dataWords(role.parse) : dataRole(role) ? [word] : []));
}

/** An expansion that bash word-splits or globs here (not in quotes, not with `IFS=` and `set -f` both). */
function bare(n: SyntaxNode, model: StateModel): boolean {
  // (Where no shell reads the words, an expansion in the text is one the host made before: make's `$@` is text by now.)
  if (!isExpansion(n) || model.noShell) return false;
  const m = partMeaning(n, model);
  return !!m && (m.split.applies !== false || m.glob.applies !== false);
}

/** The expansions of a word that bash word-splits or globs (`bare`): the word itself, or parts of it (`$d/x`). */
const barePartsIn = (w: SyntaxNode, model: StateModel): SyntaxNode[] => (bare(w, model) ? [w] : w.type === 'concatenation' ? w.namedChildren.filter((c) => bare(c, model)) : []);

/** Whether a word of the role `role` is one a command reads as data: an operand or a value written in another language. */
const dataRole = (role: ArgRole): boolean => (role.role === 'operand' || role.role === 'value') && !!role.spec?.lang;

/**
 * A word a command reads as data (`dataRole`) with an unquoted expansion whose value the model knows and bash globs or splits
 * there, so that it may not reach the command as it is: what the note `unquoted-value-as-data` is about. `command`: the command
 * that reads it (`grep`); `globs`: the parts of the value that make it a pattern (`globParts`); `bash`: bash runs the script.
 */
export interface DataValue { word: SyntaxNode; part: SyntaxNode; value: ExpansionValue; command: string; globs: readonly string[]; bash: boolean }

const dataValuesKept = new WeakMap<StateModel, Map<string, WeakMap<SyntaxNode, DataValue[]>>>();

/**
 * The words of the simple command `n`, and of the commands it runs (`specRuns`), that the note `unquoted-value-as-data` is
 * about (`DataValue`): the one source of what it says, which the word's row (src/explain/operand-texts.ts) and the value's
 * line (src/explain/values.ts) read. Kept for the model.
 */
export function dataValues(n: SyntaxNode, model: StateModel, shell: Shell | undefined): DataValue[] {
  let byShell = dataValuesKept.get(model);
  if (!byShell) dataValuesKept.set(model, (byShell = new Map()));
  let byNode = byShell.get(String(shell));
  if (!byNode) byShell.set(String(shell), (byNode = new WeakMap()));
  let found = byNode.get(n);
  if (!found) byNode.set(n, (found = findDataValues(n, model, shell)));
  return found;
}

function findDataValues(n: SyntaxNode, model: StateModel, shell: Shell | undefined): DataValue[] {
  const out: DataValue[] = [];
  for (const r of specRuns(n, model, shell)) {
    for (const k of dataWords(r.parse)) {
      const word = r.run.args[k];
      // (The expansion is named, with its value: `$r` of `/$r/p`.)
      for (const part of barePartsIn(word, model)) {
        const value = expansionValue(part, model);
        if (!value || !(value.glob || (value.words?.length ?? 0) > 1)) continue;
        const extglob = value.glob ? wordMeaning(part, model)!.glob.extglob : 'off';
        out.push({ word, part, value, command: r.parse.command, globs: value.glob ? globParts(value.text, extglob) : [], bash: isBash(model.shell) === 'yes' });
        break;
      }
    }
  }
  return out;
}

/** The `DataValue` of the word `word` of a simple command, if the note is about it. */
export function dataValueOf(word: SyntaxNode, model: StateModel, shell: Shell | undefined): DataValue | undefined {
  // (A word a spec reads is a word of a simple command.)
  return dataValues(ancestor(word, (a) => a.type === 'command')!, model, shell).find((d) => d.word === word);
}

/** The `DataValue` whose expansion is `part`, if the note is about it. */
export function dataValueAt(part: SyntaxNode, model: StateModel, shell: Shell | undefined): DataValue | undefined {
  const cmd = ancestor(part, (a) => a.type === 'command');
  return cmd ? dataValues(cmd, model, shell).find((d) => d.part === part) : undefined;
}

/** The facts (pitfalls) about words whose node starts on `line`. */
export function wordFacts(root: SyntaxNode, line: number, lang: Lang, model: StateModel, shell?: Shell): Fact[] {
  // (Each text once.)
  return wordFindings(root, lang, model, shell, line, line).map((f) => f.fact).filter((f, i, all) => all.findIndex((g) => g.text === f.text) === i);
}

/** A word fact found, with the node it is about (for a diagnostic's range); its level is the fact's. */
export interface WordFinding { fact: Fact; node: SyntaxNode }

/** The word facts whose node starts on a line from `from` to `to`, in one walk of the tree. */
export function wordFindings(root: SyntaxNode, lang: Lang, model: StateModel, shell: Shell | undefined, from: number, to: number): WordFinding[] {
  const bareParts = (w: SyntaxNode): SyntaxNode[] => barePartsIn(w, model);
  const facts: WordFinding[] = [];
  // (The node is the one being checked, unless a narrower one is given.)
  let at = root;
  const add = (f: Fact, node: SyntaxNode = at) => facts.push({ fact: f, node });
  const visit = (n: SyntaxNode) => {
    if (n.startPosition.row >= from && n.startPosition.row <= to) check((at = n));
    if (n.startPosition.row <= to && n.endPosition.row >= from) for (const c of childrenOnRows(n.namedChildren, from, to)) visit(c);
  };

  const check = (n: SyntaxNode) => {
    switch (n.type) {
      case 'simple_expansion': case 'expansion': case 'variable_name': {
        // `set -u` and a variable with no value: bash fails here. (Only at the first such read of the statement,
        // in the order bash expands it: the rest of it is not expanded.)
        const u = unboundRead(n, model, shell);
        if (u && firstUnbound(n, model, shell) === n) {
          // (The failed command's status 1 stops the shell with `set -e`, where it is not ignored.)
          const errexit = u.exits === 'command' ? errexitStops(n, model, shell) : undefined;
          // (`${x:-}` in place of `$x` or `${x}`, `${a[0]:-}` of `${a[0]}`; another form gets its value first.)
          const plain = n.type === 'simple_expansion' || n.text === `\${${u.shown}}`;
          const said = !shell || shell === 'bash' ? 'bash' : shell === 'dash' ? 'dash' : 'other';
          add(fact(lang, 'nounset-unbound', {
            v: u.shown, name: u.name, exits: u.exits, shell: said, environment: u.environment, ...(errexit ? { errexit } : {}), rewrite: plain ? [replaceNode(n, `\${${u.shown}:-}`)] : [],
          }), n);
        }
        const joined = joinedArray(n, model, shell);
        if (joined) add(fact(lang, 'array-joined-in-assignment', joined), n);
        break;
      }
      case 'command': {
        const name = commandName(n);
        const a = args(n);
        // `FOO=1 echo $FOO`: the shell expands `$FOO` before the command sees the new value (whatever it runs: `./x`).
        const written = field(n, 'name')?.text;
        // A shebang after a byte order mark: bash runs it as a command (the kernel reads `#!` only as the first two bytes).
        if (n.startIndex === 0 && written?.startsWith('\uFEFF#!')) add(fact(lang, 'shebang-bom', { word: written.slice(1), slash: written.includes('/') }), field(n, 'name')!);
        const prefix = prefixAssignments(n).map((c) => field(c, 'name')?.text).filter((v): v is string => !!v);
        for (const v of prefix) {
          const use = a.find((w) => readsVariable(w, v));
          if (written && use) {
            const { rewrite, apart } = throughShell(n, prefix, v, model, shell);
            add(fact(lang, 'prefix-assignment-expanded-first', { v, name: written, use: use.text, apart, rewrite: [rewrite] }), use);
            break;
          }
        }
        // Unquoted variables as paths of file commands, also those another command runs (`sudo rm -rf $d/x`), each command that
        // is run (`find . -exec cp $a {} \; -exec mv $b {} \;`).
        // (What the name runs, from the model: a function of that name is not `cp`.)
        for (const run of runCommands(n, model, shell)) {
          // (By the name's value, as the other checks read it: `\cp` and `'cp'` are cp.)
          const r = resolveRun(model, run, shell);
          const ran = r && ranName(r);
          if (!ran || !PATH_COMMANDS.has(ran)) continue;
          // (Each of them: quoting one leaves the others, `cp $a $b`.)
          const words = run.args.filter((w) => bareParts(w).length);
          for (const word of words) {
            // A value the model knows that stays one word, with nothing to glob (`TS=2024; rm -rf /tmp/build-$TS`): no harm
            // here, so a caveat; a value it does not know (`read`, `$1`, `$(date)`) may be anything.
            const fields = wordFields(word, model).fields;
            const quoted = quoteExpansions(word);
            add(fact(lang, 'unquoted-variable-as-path', {
              bare: word.text, rewrite: quoted ? [replaceNode(word, quoted)] : [], ...(DESTRUCTIVE_COMMANDS.has(ran) ? { destroys: true } : {}), ...(fields?.length === 1 ? { known: fields[0] } : {}),
            }), word);
          }
        }
        // Unquoted expansions whose value the model knows and bash globs or splits, in a word a command reads as data (an
        // operand or a value in another language: a pattern, a regex, a program; `p='^[A-Z]+$'; grep -E $p f`), not as a
        // file name (the note above): a file whose name matches takes the value's place. Not a value bash passes as it is.
        for (const { word, part, value: v, command, globs, bash } of dataValues(n, model, shell)) {
          // (The rewrite quotes the word's expansions.)
          const quoted = quoteExpansions(word);
          add(fact(lang, 'unquoted-value-as-data', {
            bare: part.text, value: v.text, glob: v.glob, ...((v.words?.length ?? 0) > 1 ? { words: v.words!.length } : {}), command, globs, bash, rewrite: quoted ? [replaceNode(word, quoted)] : [],
          }), word);
        }
        // `[ $x = y ]`: an empty or spaced value breaks the test. (When the name runs `[`: src/semantics/names.ts.)
        // The words of the test itself, not variables inside a `$(…)` in it.
        // (Not through splitting: an empty value drops the word whatever IFS and `set -f` are.)
        if (testSpecAt(model, n, shell)?.closingOperand) {
          // (Each of them: quoting one leaves the others, `[ $x = a -o $y = b ]`.)
          // (zsh does not split it, but drops it all the same when it is empty.)
          // (`"$x"` as written, also for `$*`, which in a test is meant as one word; none where quotes change the value, as in
          // `${x:-'a b'}`: src/fixes.ts, `quoteExpansions`.)
          for (const word of a.filter((e) => isExpansion(e) && !alwaysNumber(e))) {
            add(fact(lang, 'unquoted-variable-in-test', { bare: word.text, zsh: shell === 'zsh', rewrite: quoteExpansions(word) ? [replaceNode(word, `"${word.text}"`)] : [] }), word);
          }
        }
        // `sudo cmd > file`: the redirection is done by your shell, without sudo's rights.
        // Only for files that need root: system directories, not your logs or /dev/null. (The path after quote removal,
        // `'/etc'/x` is `/etc/x`; when it is not known, as written, from an opening quote: `"/etc/$f"`.)
        const toFile = redirectionsOf(n).find((c) => c.type === 'file_redirect' && !/^\d*>&/.test(c.text.trim())
          && /^(\/etc|\/proc|\/sys|\/usr|\/opt|\/root|\/boot|\/lib)\//.test(destination(field(c, 'destination'))));
        if (name === 'sudo' && toFile) {
          // The operator as written (`>`, `>>`, `2>`, `&>`, `>|`, `<`) tells what the file is needed for; a static path of
          // a system directory that only root writes is named in the note, any other target is not.
          const op = /^(\d*|&|{[A-Za-z_]\w*})(>>|>\||>|<>|<)/.exec(toFile.text.trim())![0];
          const kind = /<>?$/.test(op) ? 'read' : /^1?>\|?$/.test(op) ? 'write' : /^1?>>$/.test(op) ? 'append' : 'other';
          const path = staticWordValue(field(toFile, 'destination')!);
          add(fact(lang, 'redirect-by-your-shell', { op, kind, ...(path && kind !== 'read' && ROOT_ONLY_PATH.test(path) && /^[\w./+-]+$/.test(path) ? { file: path } : {}) }), toFile);
        }
        break;
      }
      case 'for_statement': case 'select_statement': {
        const value = field(n, 'value');
        if (!value) break;
        // `for f in $(ls …)`
        const cmd = value.type === 'command_substitution' && value.namedChildren[0]?.type === 'command' ? commandName(value.namedChildren[0]) : undefined;
        if (cmd === 'ls' || cmd === 'find') add(fact(lang, 'for-over-ls-output', { cmd }), value);
        // `for a in $*` / `for a in $@` (zsh gives each argument as one word, unsplit)
        // The rewrites: `for a in "$@"`, and `for a` alone where `$@` is the only word of the list.
        if (shell !== 'zsh' && value.type === 'simple_expansion' && /^\$[*@]$/.test(nameText(value))) {
          const head = n.text.slice(0, field(n, 'variable')!.endIndex - n.startIndex);
          const rewrite = [replaceSpan(n, value, `${head} in "$@"`), ...(fields(n, 'value').length === 1 ? [replaceSpan(n, value, head)] : [])];
          add(fact(lang, 'for-over-unquoted-args', { value: value.text, rewrite }), value);
        }
        break;
      }
      case 'comment': {
        // A shebang whose options bash refuses: the script stops before its first line when run directly.
        const refused = isShebang(n) ? shebangRefused(n.text) : undefined;
        if (refused) add(fact(lang, 'shebang-refused', refused));
        break;
      }
    }
  };
  visit(root);
  return facts;
}
