// Where the stdout that a command starts with goes: the one answer to "does anything depend on the order of its `2>&1`
// and `>file`" (docs/design/sources.md, M3). The environment's links mark processes, and stdout also changes without one
// (`{ cmd; } > f`), so this walks the tree from the command up, and through a function's calls and the command that
// runs a string. Read by src/explain/redirections.ts: the descriptors a command's own redirections set are `redirectOrder`'s.
import { field, descendants, fields, substitutionForm, type SyntaxNode } from '../syntax/tree';
import { staticWordValue } from '../staticword';
import { commandName } from './effects';
import { type CallLink, subshellReasons } from './env';
import { writesElsewhere } from './redirects';
import { documentRoot, scriptWord, type StateModel } from './state';

/**
 * `pipe`: a pipe (a stage but the last, `<( )`, a coprocess). `capture`: a command substitution (`$( )`, `${ …; }`).
 * `redirected`: a redirection of a statement around the command, of its function, or of its call. `plain`: nothing
 * around it, in every call the script has, all seen, with no stdout `exec` in the script, and not in what a host calls.
 * `unknown`: anything else: the calls differ, or may be unseen; `>( )`, `${| …; }`; a test of bats; a stdout `exec`.
 */
export type StdoutGoes = 'pipe' | 'capture' | 'redirected' | 'plain' | 'unknown';

/** Where the stdout that the command or statement `n` starts with goes, before its own redirections. */
export function stdoutAt(model: StateModel, n: SyntaxNode): StdoutGoes {
  if (descendants(documentRoot(n), ['command']).some(movesStdout)) return 'unknown';
  // (Only a function's call from itself says nothing, and every function that has one has a call from outside it.)
  return from(model, n, false, new Map())!;
}

/** Whether a command is an `exec` that sends the shell's stdout elsewhere (`exec > log`, `command exec >&2`). */
function movesStdout(c: SyntaxNode): boolean {
  if (!writesElsewhere(c)) return false;
  const name = commandName(c);
  const first = fields(c, 'argument')[0];
  return name === 'exec' || ((name === 'command' || name === 'builtin') && !!first && staticWordValue(first) === 'exec');
}

/**
 * The answer from `start` up, the redirections of `start` itself counted when `own`; undefined for a function's call
 * from itself, which says nothing of its own. `seen`: the functions asked, with their answers (undefined while asked).
 */
function from(model: StateModel, start: SyntaxNode, own: boolean, seen: Map<SyntaxNode, StdoutGoes | undefined>): StdoutGoes | undefined {
  for (let x = start; ; x = x.parent!) {
    if ((own || x !== start) && writesElsewhere(x)) return 'redirected';
    const why = subshellReasons(x);
    if (why.includes('pipeline-stage') || why.includes('coproc')) return 'pipe';
    if (x.type === 'process_substitution') return x.text.startsWith('<') ? 'pipe' : 'unknown';
    if (x.type === 'command_substitution') return substitutionForm(x) === '${|' ? 'unknown' : 'capture';
    if (x.type === 'function_definition') return ofCalls(model, x, seen);
    if (!x.parent) {
      // (A string another command runs: where that command writes. The document's own top: nothing around it.)
      const word = scriptWord(x);
      return word ? from(model, word, true, seen) : 'plain';
    }
  }
}

/** The answer of all the calls of a function, when the model sees them all and they agree. */
function ofCalls(model: StateModel, def: SyntaxNode, seen: Map<SyntaxNode, StdoutGoes | undefined>): StdoutGoes | undefined {
  if (seen.has(def)) return seen.get(def);
  seen.set(def, undefined);
  // (A function only a host calls has a host link: unknown.)
  const link = model.env(field(def, 'body')!).links.find((l): l is CallLink => l.kind === 'call' && l.def === def);
  const answers = new Set(link && !link.unsure ? link.sites.map((s) => from(model, s.at, true, seen)).filter((a) => a !== undefined) : ['unknown' as const]);
  const out = answers.size > 1 ? 'unknown' : [...answers][0];
  seen.set(def, out);
  return out;
}
