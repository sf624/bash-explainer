import type { Lang } from './i18n';
import { quoteExpansions } from './fixes';
import { type Fact, fact } from './messages';
import type { Shell } from './dialect';
import { args, commandName, pathCommand, readsVariable } from './pitfalls';
import { type NameResolution, resolveName, testSpecAt } from './semantics/names';
import { shebangRefused, type StateModel } from './semantics/state';
import { errexitStops, firstUnbound, unboundRead } from './semantics/unbound';
import { partMeaning } from './semantics/words';
import { staticWordValue } from './staticword';
import { field, prefixAssignments, redirectionsOf } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';

// The pitfalls that follow from how the shell reads the words of a command: what the current shell expands before a
// command runs (`FOO=1 echo $FOO`, `sudo cmd > /etc/…`), and what word splitting and globbing do to an unquoted
// expansion (a path, `for f in $(ls)`, `for a in $*`, `[ $x = y ]`); a read of an unset variable under `set -u`, and
// options of a shebang that bash refuses. Each is found from the syntax tree, only on the line where its node starts,
// and said from the catalog (src/messages.ts) with the sections of the manual it is about.
// The style checks, which are not facts of the models, are in src/pitfalls.ts.

/** The file commands whose unquoted variables are worth a warning. */
const PATH_COMMANDS = new Set(['rm', 'cp', 'mv', 'cd', 'mkdir', 'touch', 'chmod', 'chown', 'ln', 'cat', 'source', '.']);

/**
 * The command a resolution runs, when it is known: an alias is its target. A function keeps its name: bash expands
 * the words before calling it, so `rm() { command rm -i "$@"; }; rm $f` splits `$f` all the same.
 */
function ranName(r: NameResolution): string | undefined {
  if (r.kind === 'alias') return r.sure && r.target ? ranName(r.target) : undefined;
  // (A path runs a file, never a builtin: `./cd` is not `cd`.)
  return pathCommand(r.name);
}

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

/** The facts (pitfalls) about words whose node starts on `line`. */
export function wordFacts(root: SyntaxNode, line: number, lang: Lang, model: StateModel, shell?: Shell): Fact[] {
  // (Each text once.)
  return wordFindings(root, lang, model, shell, line, line).map((f) => f.fact).filter((f, i, all) => all.findIndex((g) => g.text === f.text) === i);
}

/**
 * A word fact found, with the node it is about (for a diagnostic's range). `mild`: what it says breaks only the
 * command, and the shell goes on (an unset read in a redirection of a program, `cat < "$f"` with `set -u`).
 */
export interface WordFinding { fact: Fact; node: SyntaxNode; mild?: boolean }

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
  const add = (f: Fact, node: SyntaxNode = at, mild = false) => facts.push({ fact: f, node, ...(mild ? { mild } : {}) });
  const visit = (n: SyntaxNode) => {
    if (n.startPosition.row >= from && n.startPosition.row <= to) check((at = n));
    if (n.startPosition.row <= to && n.endPosition.row >= from) for (const c of n.namedChildren) visit(c);
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
          }), n, u.exits === 'command' && !errexit);
        }
        break;
      }
      case 'command': {
        const name = commandName(n);
        const a = args(n);
        // `FOO=1 echo $FOO`: the shell expands `$FOO` before the command sees the new value (whatever it runs: `./x`).
        const written = field(n, 'name')?.text;
        const prefix = prefixAssignments(n).map((c) => field(c, 'name')?.text).filter((v): v is string => !!v);
        for (const v of prefix) {
          const use = a.find((w) => readsVariable(w, v));
          if (written && use) {
            add(fact(lang, 'prefix-assignment-expanded-first', { v, name: written, use: use.text }), use);
            break;
          }
        }
        // Unquoted variables as paths of file commands.
        // (What the name runs, from the model: a function of that name is not `cp`.)
        const nameNode = field(n, 'name');
        const ran = nameNode && /^[\w./+-]+$/.test(nameNode.text) ? ranName(resolveName(model, nameNode.text, nameNode, { shell, command: true })) : undefined;
        if (ran && PATH_COMMANDS.has(ran)) {
          const word = a.find((w) => bare(w) || (w.type === 'concatenation' && w.namedChildren.some((c) => bare(c))));
          if (word) add(fact(lang, 'unquoted-variable-as-path', { bare: word.text, quoted: quoteExpansions(word) }), word);
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
        if (name === 'sudo' && toFile) add(fact(lang, 'redirect-by-your-shell'), toFile);
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
        const refused = n.startPosition.row === 0 ? shebangRefused(n.text) : undefined;
        if (refused) add(fact(lang, 'shebang-refused', refused));
        break;
      }
    }
  };
  visit(root);
  return facts;
}
