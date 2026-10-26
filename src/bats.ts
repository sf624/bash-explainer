import type { Lang } from './i18n';
import { fact, type Fact } from './messages';
import { resolveName } from './semantics/names';
import { shellState } from './semantics/state';
import { lastStatements, statusModel } from './semantics/status';
import { builtinParse, commandName } from './semantics/effects';
import { processOf, STATEMENTS } from './semantics/env';
import { BATS_COMMANDS } from './dict/bats';
import type { ShellRegion } from './hosts';
import { assignmentsOnly, descendants, field, fields, type SyntaxNode, type SyntaxTree } from './syntax/tree';

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
 * functions); `region` gives bats' functions and how bats runs the file, as the analyzer reads them. The caller
 * filters them by the `notes.pitfalls` setting (`said`).
 */
export function batsFacts(tree: SyntaxTree, region: Pick<ShellRegion, 'commands' | 'run'>, tests: readonly number[], line: number, lang: Lang): Fact[] {
  const out: Fact[] = [];
  if (tests.includes(line)) out.push(fact(lang, 'bats-test'));
  // (The model the analyzer reads for a bats file, which reads bats' functions by their specs.)
  const state = shellState(tree, undefined, { host: region.commands, run: region.run });
  const status = statusModel(state);
  // The hooks bats calls once the file has run (src/semantics/walk/host.ts), said on their definitions.
  for (const [def, call] of state.hostCalls) {
    if (call.role === 'test' || def.startPosition.row !== line) continue;
    const when = call.process === 'test' ? call.role : call.role === 'before' ? 'file-before' : 'file-after';
    out.push(fact(lang, 'bats-hook', { name: field(def, 'name')!.text, when }));
  }
  // (bats calls `setup_suite` only from setup_suite.bash: of a test file, it warns.)
  if (descendants(tree.root, ['function_definition']).some((d) => d.startPosition.row === line && field(d, 'name')!.text === 'setup_suite')) out.push(fact(lang, 'bats-setup-suite-in-test-file'));
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
      // (`run !` runs one command: a pipeline needs bats_pipe, a group neither, and assignments alone are no command to run.)
      const inner = s.namedChildren.find((c) => STATEMENTS.has(c.type))!;
      const form = inner.type === 'command' && !assignmentsOnly(inner) ? 'command' : inner.type === 'pipeline' ? 'pipeline' : 'other';
      out.push(fact(lang, 'bats-negation-ignored', { cmd: shorten(inner.text), form }));
    }
  }
  // `run cmd | …`: the pipe gets run's output, which is none, and run's variables are set in a subshell; `… | run
  // cmd`: run reads the pipe, but sets its variables in a subshell too (unless lastpipe runs the last stage here).
  for (const p of descendants(tree.root, ['pipeline'])) {
    if (p.startPosition.row !== line) continue;
    p.namedChildren.filter((c) => STATEMENTS.has(c.type)).forEach((cmd, k) => {
      // (`run cmd 2>&1 | …`: its redirections are its own.)
      if (cmd.type !== 'command' || commandName(cmd) !== 'run') return;
      // (A function of the file named `run` is not bats' own.)
      if (resolveName(state, 'run', cmd).kind === 'function') return;
      const words = runCommand(cmd);
      if (!words.length) return;
      const text = shorten(words.map((w) => w.text).join(' '));
      if (k === 0) out.push(fact(lang, 'bats-run-in-pipeline', { cmd: text }));
      else if (processOf(state.env(cmd)).kind === 'subshell') out.push(fact(lang, 'bats-run-in-pipeline-stage', { cmd: text }));
    });
  }
  return out;
}
