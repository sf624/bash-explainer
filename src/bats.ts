import type { Lang } from './i18n';
import { fact, type Fact } from './messages';
import { resolveName } from './semantics/names';
import { shellState } from './semantics/state';
import { lastStatements, statusModel } from './semantics/status';
import { STATEMENTS } from './semantics/env';
import { descendants, field, fields, type SyntaxNode, type SyntaxTree } from './syntax/tree';

// What bats adds to a test file, said on its lines (docs/design/bats.md): the note on each `@test`, and two pitfalls
// that follow from bash itself once bats has made a test a function run with `set -e`. The extractor (src/hosts.ts)
// has made each test the function bats makes of it; the facts are read from the status model of that text.

const shorten = (text: string): string => {
  const one = text.replace(/\s*\n\s*/g, ' ');
  return one.length > 30 ? `${one.slice(0, 29)}…` : one;
};

/** The words of `run`'s command, after its options (`!`, `-N`, `--separate-stderr`…, `--`). */
function runCommand(n: SyntaxNode): SyntaxNode[] {
  const words = fields(n, 'argument');
  let i = 0;
  while (i < words.length && (words[i].text === '!' || words[i].text.startsWith('-'))) {
    if (words[i++].text === '--') break;
  }
  return words.slice(i);
}

/**
 * The facts of `line` of a bats file whose tests start on the lines `tests` (in the extracted text, where they are
 * functions). `pitfalls`: whether to say the pitfalls too.
 */
export function batsFacts(tree: SyntaxTree, tests: readonly number[], line: number, lang: Lang, pitfalls: boolean): Fact[] {
  const out: Fact[] = [];
  if (tests.includes(line)) out.push(fact(lang, 'bats-test'));
  if (!pitfalls) return out;
  const state = shellState(tree);
  const status = statusModel(state);
  // `! cmd` in a test, not its last command: bash ignores `set -e` after `!`, so it fails nothing.
  for (const def of descendants(tree.root, ['function_definition'])) {
    if (!tests.includes(def.startPosition.row)) continue;
    // (No body: a line bats itself reads wrongly, `@test "a" { echo {x}`.)
    const body = field(def, 'body');
    if (!body) continue;
    const last = lastStatements(body);
    for (const s of body.namedChildren.filter((c) => STATEMENTS.has(c.type))) {
      // (Bash ignores `set -e` for a statement of the body only when it is `! cmd` itself.)
      if (s.startPosition.row !== line || last.includes(s) || status.errexit(s).ignored?.at !== s) continue;
      out.push(fact(lang, 'bats-negation-ignored', { cmd: shorten(s.namedChildren.find((c) => STATEMENTS.has(c.type))!.text) }));
    }
  }
  // `run cmd | …`: the pipe gets run's output, which is none, and run's variables are set in a subshell.
  for (const p of descendants(tree.root, ['pipeline'])) {
    // (`run cmd 2>&1 | …`: the command with its redirection; `>f | …` has none.)
    const first = p.namedChildren[0];
    const cmd = first.type === 'redirected_statement' ? field(first, 'body') : first;
    if (p.startPosition.row !== line || cmd?.type !== 'command' || field(cmd, 'name')!.text !== 'run') continue;
    // (A function of the file named `run` is not bats' own.)
    if (resolveName(state, 'run', cmd).kind === 'function') continue;
    const words = runCommand(cmd);
    if (!words.length) continue;
    out.push(fact(lang, 'bats-run-in-pipeline', { cmd: shorten(words.map((w) => w.text).join(' ')) }));
  }
  return out;
}
