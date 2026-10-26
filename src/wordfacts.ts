import type { Lang } from './i18n';
import { quoteExpansions } from './fixes';
import { type Fact, fact, type Params } from './messages';
import { featureWorks, type Shell } from './dialect';
import { parseExpansion } from './expansion';
import { args, commandName, pathCommand, runCommands } from './pitfalls';
import { type NameResolution, resolveName, testSpecAt } from './semantics/names';
import { shebangRefused, type StateModel } from './semantics/state';
import { errexitStops, firstUnbound, unboundRead } from './semantics/unbound';
import { partMeaning, wordFields, wordOf } from './semantics/words';
import { staticWordValue } from './staticword';
import { childrenOnRows, field, isShebang, prefixAssignments, readsVariable, redirectionsOf } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';

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
 * element (`a[0]=$@`), nor in a shell without arrays.
 */
function joinedArray(n: SyntaxNode, shell: Shell | undefined): Params<'array-joined-in-assignment'> | undefined {
  if (!featureWorks('array', shell)) return undefined;
  const p = n.type === 'expansion' ? parseExpansion(n.text) : undefined;
  const all = n.type === 'simple_expansion' ? n.text === '$@' : !!p && !p.prefix && p.op !== ':' && (p.subscript === undefined ? p.name === '@' : p.subscript === '@');
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
  return { v: name.text, op, word: value.text, args: !p?.subscript, list: `("${n.text}")`, string: `"${starred}"` };
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
  /** An expansion that bash word-splits or globs here (not in quotes, not with `IFS=` and `set -f` both). */
  const bare = (n: SyntaxNode): boolean => {
    if (!isExpansion(n)) return false;
    const m = partMeaning(n, model);
    return !!m && (m.split.applies !== false || m.glob.applies !== false);
  };
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
            v: u.shown, name: u.name, exits: u.exits, shell: said, environment: u.environment, ...(errexit ? { errexit } : {}), ...(plain ? { fix: `\${${u.shown}:-}` } : {}),
          }), n);
        }
        const joined = joinedArray(n, shell);
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
            add(fact(lang, 'prefix-assignment-expanded-first', { v, name: written, use: use.text }), use);
            break;
          }
        }
        // Unquoted variables as paths of file commands, also those another command runs (`sudo rm -rf $d/x`).
        // (What the name runs, from the model: a function of that name is not `cp`.)
        for (const run of runCommands(n, model, shell)) {
          const nameNode = run.nameWord;
          const ran = /^[\w./+-]+$/.test(nameNode.text) ? ranName(resolveName(model, nameNode.text, nameNode, { shell, command: true, ...(run.env ? { env: run.env } : {}) })) : undefined;
          if (!ran || !PATH_COMMANDS.has(ran)) continue;
          const word = run.args.find((w) => bare(w) || (w.type === 'concatenation' && w.namedChildren.some((c) => bare(c))));
          if (!word) continue;
          // A value the model knows that stays one word, with nothing to glob (`TS=2024; rm -rf /tmp/build-$TS`): no harm
          // here, so a caveat; a value it does not know (`read`, `$1`, `$(date)`) may be anything.
          const fields = wordFields(word, model).fields;
          add(fact(lang, 'unquoted-variable-as-path', {
            bare: word.text, quoted: quoteExpansions(word), ...(DESTRUCTIVE_COMMANDS.has(ran) ? { destroys: true } : {}), ...(fields?.length === 1 ? { known: fields[0] } : {}),
          }), word);
          break;
        }
        // `[ $x = y ]`: an empty or spaced value breaks the test. (When the name runs `[`: src/semantics/names.ts.)
        // The words of the test itself, not variables inside a `$(…)` in it.
        // (Not through splitting: an empty value drops the word whatever IFS and `set -f` are.)
        if (testSpecAt(model, n, shell)?.closingOperand) {
          const word = a.find((e) => isExpansion(e) && !alwaysNumber(e));
          // (zsh does not split it, but drops it all the same when it is empty.)
          if (word) add(fact(lang, 'unquoted-variable-in-test', { bare: word.text, zsh: shell === 'zsh' }), word);
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
        if (shell !== 'zsh' && value.type === 'simple_expansion' && /^\$[*@]$/.test(value.text)) add(fact(lang, 'for-over-unquoted-args', { value: value.text }), value);
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
