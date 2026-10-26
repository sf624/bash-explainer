// What a host runs of a script once the script has run (docs/design/bats.md): bats sources a test file with
// `set -eET` on, then calls each test in a process of its own, after the file's `setup` and before its `teardown`,
// and `setup_file` and `teardown_file` in one more process, around the tests. The walk reads those calls as bash
// runs them, so the bodies have the states of their calls, and the status model sees `set -e` in them.
import { field, type SyntaxNode } from '../../syntax/tree';
import { merge, type ShellState, withStatus } from '../shellstate';
import type { Target, Walker } from './walker';

const rootOf = (n: SyntaxNode): SyntaxNode => {
  let r = n;
  while (r.parent) r = r.parent;
  return r;
};

/**
 * The functions the host calls once the script has run, each in a process of its own (bats-core 1.13, libexec/
 * bats-core/bats-exec-file and bats-exec-test): `tests`, the rows of the function definitions it calls as tests;
 * `each`, the functions it calls in each test's process, before the test and after it; `file`, those it calls in a
 * process of their own, before every test and after them. A function the script does not define is not called. The
 * functions run after are called on the left of `||` (bats: `teardown || status=$?`), where bash ignores `set -e`.
 */
export interface HostRun {
  /** The set options on when the script starts (bats: errexit, errtrace, functrace). The shebang's do not apply. */
  readonly set: readonly string[];
  readonly tests: readonly number[];
  readonly each: { readonly before: string; readonly after: string };
  readonly file: { readonly before: string; readonly after: string };
}

/** How the host calls a function: as a test, or as a hook before or after the tests (`each`) or all of them (`file`). */
export interface HostCall {
  readonly role: 'test' | 'before' | 'after';
  readonly process: 'test' | 'file';
  /** Called where bash ignores `set -e` (the functions run after). */
  readonly ignored: boolean;
}

/** The cache key of a run, for the models of a tree. */
export const hostRunKey = (run: HostRun): string => ` run:${run.set.join(',')}:${run.tests.join(',')}:${Object.values(run.each).join(',')}:${Object.values(run.file).join(',')}`;

/**
 * Walks what the host runs once the script has run to `end`. The file's process runs `file.before`, whose changes of
 * variables and functions may reach the tests (bats exports to them what it exports), so they are not known there;
 * then `file.after`. Each test's process starts from `end` (bats sources the file again in it), and runs
 * `each.before`, the test, and `each.after`, also when the test is ended by `set -e` or `exit` (bats runs it from its
 * EXIT trap then).
 */
export function hostRun(w: Walker, root: SyntaxNode, end: ShellState): void {
  const run = w.hosted;
  if (!run) return;
  const fn = (name: string): SyntaxNode | undefined => {
    const f = end.functions.get(name);
    return f && f.state !== 'off' ? f.def : undefined;
  };
  const since = w.changeCount;
  let file = call(w, fn(run.file.before), end, { role: 'before', process: 'file', ignored: false });
  const reach = new Set([...w.lastChange].filter(([k, i]) => i > since && (k.startsWith('variables ') || k.startsWith('functions '))).map(([k]) => k));
  file = call(w, fn(run.file.after), file, { role: 'after', process: 'file', ignored: true });
  // (The definitions on the rows of the tests: a row bats rewrites inside a string or a here-document holds none.)
  const rows = new Set(run.tests);
  const tests = [...w.functionDefs.values()].flat().filter((d) => rows.has(d.startPosition.row) && rootOf(d) === root);
  for (const def of tests.sort((a, b) => a.startIndex - b.startIndex)) {
    const name = field(def, 'name')!.text;
    // (A test the script does not define at its end, or defines otherwise: bats says "unknown test name".)
    if (fn(name) !== def) continue;
    const target: Extract<Target, { kind: 'program' }> = { kind: 'program', dead: w.mode.dead, exits: [] };
    w.targets.push(target);
    let st = call(w, fn(run.each.before), w.widen(end, reach), { role: 'before', process: 'test', ignored: false });
    st = call(w, def, st, { role: 'test', process: 'test', ignored: false });
    w.targets.pop();
    call(w, fn(run.each.after), merge([st, ...target.exits], w.posix), { role: 'after', process: 'test', ignored: true });
  }
}

/** The state after the host calls `def` from `st` (none: `st`); `how` is kept for the environment and status models. */
function call(w: Walker, def: SyntaxNode | undefined, st: ShellState, how: HostCall): ShellState {
  if (!def) return st;
  w.hostCalls.set(def, how);
  const walk = (): ShellState => w.walkBody(def, withStatus(st, undefined), { def, saved: new Map() });
  return how.ignored ? w.quietly(walk) : walk();
}
