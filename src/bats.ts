import type { Shell } from './dialect';
import type { Lang } from './i18n';
import { fact, type Fact } from './messages';
import { resolveName } from './semantics/names';
import { shellState } from './semantics/state';
import { lastStatements, statusModel } from './semantics/status';
import { builtinParse, commandName } from './semantics/effects';
import { processOf, STATEMENTS } from './semantics/env';
import { BATS_COMMANDS } from './dict/bats';
import type { ShellRegion } from './hosts';
import { ancestor, assignmentsOnly, descendants, field, fields, nameText, type SyntaxNode, type SyntaxTree } from './syntax/tree';

// What bats adds to a test file, said on its lines (docs/design/bats.md): the note on each `@test`, and two pitfalls
// that follow from bash itself once bats has made a test a function run with `set -e`. The extractor (src/hosts.ts)
// has made each test the function bats makes of it; the facts are read from the status model of that text.

const shorten = (text: string): string => {
  const one = text.replace(/\s*\n\s*/g, ' ');
  return one.length > 30 ? `${one.slice(0, 29)}…` : one;
};

/** The words of `run`'s command, after its options (`!`, `-N`, `--separate-stderr`…, `--`), as its spec reads them. */
function runCommand(n: SyntaxNode, shell: Shell | undefined): SyntaxNode[] {
  const words = fields(n, 'argument');
  const at = builtinParse('run', words, shell, BATS_COMMANDS.run).roles.find((r) => r.role.role === 'command');
  return at ? words.slice(at.word) : [];
}

const testLines = new WeakMap<SyntaxTree, number[]>();

/**
 * The lines of `region.tests` (where bats rewrote a test) on which bash reads a function definition: not those inside
 * a here-document or a quoted string, which bats rewrites too but bash takes as text. A definition inside a function
 * is a test only when that function runs as the file is read (bats registers a test when its line runs), as the model
 * reads it: when bats calls it as a test.
 */
export function batsTests(tree: SyntaxTree, region: Pick<ShellRegion, 'commands' | 'run'> & { tests: readonly number[] }): number[] {
  let out = testLines.get(tree);
  if (!out) {
    const called = new Set([...shellState(tree, undefined, { host: region.commands, run: region.run, read: 'script' }).hostCalls].filter(([, c]) => c.role === 'test').map(([d]) => d));
    const rows = new Set(descendants(tree.root, ['function_definition'])
      .filter((d) => called.has(d) || !ancestor(d, (a) => a.type === 'function_definition')).map((d) => d.startPosition.row));
    testLines.set(tree, (out = region.tests.filter((l) => rows.has(l))));
  }
  return out;
}

/**
 * The facts of `line` of a bats file whose tests start on the lines `tests` (in the extracted text, where they are
 * functions), each with the node it is about (the problems are on it); `region` gives bats' functions and how bats
 * runs the file, as the analyzer reads them. The caller filters them by the `notes.pitfalls` setting (`said`).
 */
export function batsFacts(tree: SyntaxTree, region: Pick<ShellRegion, 'commands' | 'run'>, tests: readonly number[], line: number, lang: Lang): { fact: Fact; node: SyntaxNode }[] {
  const out: { fact: Fact; node: SyntaxNode }[] = [];
  const def0 = tests.includes(line) && descendants(tree.root, ['function_definition']).find((d) => d.startPosition.row === line);
  if (def0) out.push({ fact: fact(lang, 'bats-test'), node: def0 });
  // (The model the analyzer reads for a bats file, which reads bats' functions by their specs.)
  const state = shellState(tree, undefined, { host: region.commands, run: region.run, read: 'script' });
  const status = statusModel(state);
  // The hooks bats calls once the file has run (src/semantics/walk/host.ts), said on their definitions.
  for (const [def, call] of state.hostCalls) {
    if (call.role === 'test' || def.startPosition.row !== line) continue;
    const when = call.process === 'test' ? call.role : call.role === 'before' ? 'file-before' : 'file-after';
    out.push({ fact: fact(lang, 'bats-hook', { name: nameText(field(def, 'name')!), when }), node: def });
  }
  // (bats calls `setup_suite` only from setup_suite.bash: of a test file, it warns.)
  const suite = descendants(tree.root, ['function_definition']).find((d) => d.startPosition.row === line && nameText(field(d, 'name')!) === 'setup_suite');
  if (suite) out.push({ fact: fact(lang, 'bats-setup-suite-in-test-file'), node: suite });
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
      out.push({ fact: fact(lang, 'bats-negation-ignored', { cmd: shorten(inner.text), form }), node: s });
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
      const words = runCommand(cmd, state.shell);
      if (!words.length) return;
      const text = shorten(words.map((w) => w.text).join(' '));
      if (k === 0) out.push({ fact: fact(lang, 'bats-run-in-pipeline', { cmd: text }), node: p });
      else if (processOf(state.env(cmd)).kind === 'subshell') out.push({ fact: fact(lang, 'bats-run-in-pipeline-stage', { cmd: text }), node: cmd });
    });
  }
  return out;
}
