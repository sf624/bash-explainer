import type { Lang } from './i18n';
import { type Fact, fact } from './messages';
import type { Shell } from './dialect';
import { args, commandName, readsVariable } from './pitfalls';
import { type NameResolution, resolveName, testSpecAt } from './semantics/names';
import type { StateModel } from './semantics/state';
import { partMeaning } from './semantics/words';
import { field, prefixAssignments } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';

// The pitfalls that follow from how the shell reads the words of a command: what the current shell expands before a
// command runs (`FOO=1 echo $FOO`, `sudo cmd > /etc/…`), and what word splitting and globbing do to an unquoted
// expansion (a path, `for f in $(ls)`, `for a in $*`, `[ $x = y ]`). Each is found from the syntax tree, only on the
// line where its node starts, and said from the catalog (src/messages.ts) with the sections of the manual it is about.
// The style checks, which are not facts of the models, are in src/pitfalls.ts.

/** The file commands whose unquoted variables are worth a warning. */
const PATH_COMMANDS = new Set(['rm', 'cp', 'mv', 'cd', 'mkdir', 'touch', 'chmod', 'chown', 'ln', 'cat', 'source', '.']);

/**
 * The command a resolution runs, when it is known: an alias is its target. A function keeps its name: bash expands
 * the words before calling it, so `rm() { command rm -i "$@"; }; rm $f` splits `$f` all the same.
 */
function ranName(r: NameResolution): string | undefined {
  if (r.kind === 'alias') return r.sure && r.target ? ranName(r.target) : undefined;
  return r.name.split('/').pop();
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
  /** An expansion that bash word-splits or globs here (not in quotes, not with `IFS=` and `set -f` both). */
  const bare = (n: SyntaxNode): boolean => {
    if (!isExpansion(n)) return false;
    const m = partMeaning(n, model);
    return !!m && (m.split.applies !== false || m.glob.applies !== false);
  };
  const facts: Fact[] = [];
  const add = (f: Fact) => { if (!facts.some((g) => g.text === f.text)) facts.push(f); };
  const visit = (n: SyntaxNode) => {
    if (n.startPosition.row === line) check(n);
    if (n.startPosition.row <= line && n.endPosition.row >= line) for (const c of n.namedChildren) visit(c);
  };

  const check = (n: SyntaxNode) => {
    switch (n.type) {
      case 'command': {
        const name = commandName(n);
        const a = args(n);
        // `FOO=1 echo $FOO`: the shell expands `$FOO` before the command sees the new value.
        const prefix = prefixAssignments(n).map((c) => field(c, 'name')?.text).filter((v): v is string => !!v);
        for (const v of prefix) {
          const use = a.find((w) => readsVariable(w, v));
          if (name && use) {
            add(fact(lang, 'prefix-assignment-expanded-first', { v, name, use: use.text }));
            break;
          }
        }
        // Unquoted variables as paths of file commands.
        // (What the name runs, from the model: a function of that name is not `cp`.)
        const nameNode = field(n, 'name');
        const ran = nameNode && /^[\w./+-]+$/.test(nameNode.text) ? ranName(resolveName(model, nameNode.text, nameNode, { shell, command: true })) : undefined;
        if (ran && PATH_COMMANDS.has(ran)) {
          const word = a.find((w) => bare(w) || (w.type === 'concatenation' && w.namedChildren.some((c) => bare(c))));
          if (word) add(fact(lang, 'unquoted-variable-as-path', { bare: word.text }));
        }
        // `[ $x = y ]`: an empty or spaced value breaks the test. (When the name runs `[`: src/semantics/names.ts.)
        // The words of the test itself, not variables inside a `$(…)` in it.
        // (Not through splitting: an empty value drops the word whatever IFS and `set -f` are.)
        if (testSpecAt(model, n, shell)?.closingOperand) {
          const word = a.find((e) => isExpansion(e) && !alwaysNumber(e));
          if (word) add(fact(lang, 'unquoted-variable-in-test', { bare: word.text }));
        }
        break;
      }
      case 'redirected_statement': {
        // `sudo cmd > file`: the redirection is done by your shell, without sudo's rights.
        const body = field(n, 'body');
        // Only for files that need root: system directories, not your logs or /dev/null.
        const toFile = n.namedChildren.some((c) => c.type === 'file_redirect' && !/^\d*>&/.test(c.text.trim())
          && /^(\/etc|\/proc|\/sys|\/usr|\/opt|\/root|\/boot|\/lib)\//.test(field(c, 'destination')?.text.replace(/^["']/, '') ?? ''));
        if (body?.type === 'command' && commandName(body) === 'sudo' && toFile) add(fact(lang, 'redirect-by-your-shell'));
        break;
      }
      case 'for_statement': case 'select_statement': {
        const value = field(n, 'value');
        if (!value) break;
        // `for f in $(ls …)`
        const cmd = value.type === 'command_substitution' && value.namedChildren[0]?.type === 'command' ? commandName(value.namedChildren[0]) : undefined;
        if (cmd === 'ls' || cmd === 'find') add(fact(lang, 'for-over-ls-output', { cmd }));
        // `for a in $*` / `for a in $@`
        if (value.type === 'simple_expansion' && /^\$[*@]$/.test(value.text)) add(fact(lang, 'for-over-unquoted-args', { value: value.text }));
        break;
      }
    }
  };
  visit(root);
  return facts;
}
