import type { Lang } from './i18n';
import { fact, type Fact } from './messages';
import { resolveName } from './semantics/names';
import { shellState } from './semantics/state';
import { lastStatements, statusModel } from './semantics/status';
import { builtinParse, commandName } from './semantics/effects';
import { processOf, STATEMENTS } from './semantics/env';
import { BATS_COMMANDS } from './dict/bats';
import { descendants, field, fields, type SyntaxNode, type SyntaxTree } from './syntax/tree';

// What bats adds to a test file, said on its lines (docs/design/bats.md): the note on each `@test`, and two pitfalls
// that follow from bash itself once bats has made a test a function run with `set -e`. The extractor (src/hosts.ts)
// has made each test the function bats makes of it; the facts are read from the status model of that text.

const shorten = (text: string): string => {
  const one = text.replace(/\s*\n\s*/g, ' ');
  return one.length > 30 ? `${one.slice(0, 29)}…` : one;
};

/** The words of `run`'s command, after its options (`!`, `-N`, `--separate-stderr`…, `--`), as its spec reads them. */
function runCommand(n: SyntaxNode): SyntaxNode[] {
  const words = fields(n, 'argument');
  const at = builtinParse('run', words, BATS_COMMANDS.run).roles.find((r) => r.role.role === 'command');
  return at ? words.slice(at.word) : [];
}

const testLines = new WeakMap<SyntaxTree, number[]>();

/**
 * The lines of `candidates` (where bats rewrote `@test`) on which bash reads a function definition: not those inside
 * a here-document or a quoted string, which bats rewrites too but bash takes as text.
 */
export function batsTests(tree: SyntaxTree, candidates: readonly number[]): number[] {
  let out = testLines.get(tree);
  if (!out) {
    const rows = new Set(descendants(tree.root, ['function_definition']).map((d) => d.startPosition.row));
    testLines.set(tree, (out = candidates.filter((l) => rows.has(l))));
  }
  return out;
}

/**
 * The facts of `line` of a bats file whose tests start on the lines `tests` (in the extracted text, where they are
 * functions). The caller filters them by the `notes.pitfalls` setting (`said`).
 */
export function batsFacts(tree: SyntaxTree, tests: readonly number[], line: number, lang: Lang): Fact[] {
  const out: Fact[] = [];
  if (tests.includes(line)) out.push(fact(lang, 'bats-test'));
  // (The model the analyzer reads for a bats file, which reads bats' functions by their specs.)
  const state = shellState(tree, undefined, { host: BATS_COMMANDS });
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
      // (`run !` runs one command: a pipeline needs bats_pipe, a group neither.)
      const inner = s.namedChildren.find((c) => STATEMENTS.has(c.type))!;
      const form = inner.type === 'command' ? 'command' : inner.type === 'pipeline' ? 'pipeline' : 'other';
      out.push(fact(lang, 'bats-negation-ignored', { cmd: shorten(inner.text), form }));
    }
  }
  // `run cmd | …`: the pipe gets run's output, which is none, and run's variables are set in a subshell; `… | run
  // cmd`: run reads the pipe, but sets its variables in a subshell too (unless lastpipe runs the last stage here).
  for (const p of descendants(tree.root, ['pipeline'])) {
    if (p.startPosition.row !== line) continue;
    p.namedChildren.filter((c) => STATEMENTS.has(c.type)).forEach((stage, k) => {
      // (`run cmd 2>&1 | …`: the command with its redirection; `>f | …` has none.)
      const cmd = stage.type === 'redirected_statement' ? field(stage, 'body') : stage;
      if (cmd?.type !== 'command' || commandName(cmd) !== 'run') return;
      // (A function of the file named `run` is not bats' own.)
      if (resolveName(state, 'run', cmd).kind === 'function') return;
      const words = runCommand(cmd);
      if (!words.length) return;
      const text = shorten(words.map((w) => w.text).join(' '));
      if (k === 0) out.push(fact(lang, 'bats-run-in-pipeline', { cmd: text }));
      else if (processOf(state.env(stage)).kind === 'subshell') out.push(fact(lang, 'bats-run-in-pipeline-stage', { cmd: text }));
    });
  }
  return out;
}
