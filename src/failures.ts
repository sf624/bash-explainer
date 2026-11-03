// What happens to an exception nothing was meant to throw (docs/design/line-budget.md). Every product is synchronous, and one
// file can hold thousands of lines: a bug that throws on one line must not lose the others, nor the rest of that line. So there
// are few boundaries (`contained`: an example, a line, a document's problems); past one, the product says what it can, and the
// maintainer finds the failure where the product logs (`failuresGoTo`).
//
// It must not hide bugs: the test suite turns the boundaries off (`failuresThrow`, test/support/failures-throw.ts, named in
// .mocharc.cjs), so an unexpected throw fails a test as before. A refusal of the budget (src/examples/regexguard.ts) is expected and
// is caught where it is said; it never comes here. A test of the boundaries turns them on again for its own run.

/** Where it happened, and what was thrown. */
export interface Failure { where: string; error: unknown }

const logged = (f: Failure) => console.error(`Bash Explainer: internal error (${f.where}):`, f.error);

let sink: (f: Failure) => void = logged;
let throwing = false;

/** Where the failures go: the extension's output channel, the command-line tool's standard error. Returns what they went to before. */
export function failuresGoTo(to: (f: Failure) => void): (f: Failure) => void {
  const before = sink;
  sink = to;
  return before;
}

/** Whether a boundary lets its failure through, as the test suite wants it. Returns what it was before. */
export function failuresThrow(on: boolean): boolean {
  const before = throwing;
  throwing = on;
  return before;
}

/** What `run` gives, or, when it throws, what `instead` gives, once the failure has been told. */
export function contained<T>(where: string, run: () => T, instead: (error: unknown) => T): T {
  try {
    return run();
  } catch (error) {
    if (throwing) throw error;
    // (A sink that fails must not undo the boundary. The stack running out is no bug, and what asks says so: `stackFull`.)
    try {
      if (!stackFull(error)) sink({ where, error });
    } catch { /* nothing is left to tell */ }
    return instead(error);
  }
}

/** Whether `e` is the stack running out: no bug, but a text that nests deeper than this walk can follow (what says so: `Analyzer.explainLine`). */
export function stackFull(e: unknown): boolean {
  return e instanceof RangeError && /Maximum call stack/.test(e.message);
}

/** What `run` gives, or nothing where the stack runs out. */
export function unlessStackFull<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch (e) {
    if (!stackFull(e)) throw e;
    return undefined;
  }
}

/** The text of a failure for a log: its stack, which names where it was thrown. */
export function failureText(f: Failure): string {
  return `internal error (${f.where}): ${f.error instanceof Error ? f.error.stack ?? f.error.message : String(f.error)}`;
}

/** A sink that writes each failure once: a bug can throw on each of thousands of lines, in the same place. */
export function loggedOnce(write: (text: string) => void): (f: Failure) => void {
  const seen = new Set<string>();
  return (f) => {
    const key = f.error instanceof Error ? f.error.stack ?? f.error.message : String(f.error);
    if (seen.has(key)) return;
    seen.add(key);
    write(failureText(f));
  };
}
