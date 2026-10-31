// The web page's Problems strip (docs/design/chrome-redesign.md, C2): the order of the problems, the one the cursor is
// at ("Ln 20 · 1/11"), and the next and previous one with wrap-around (‹ ›, F8 and Shift+F8). The page calls these with
// the cursor and the problem it last went to; they decide, the page only draws and selects (web/problem-list.ts).

/** Where a problem is: 0-based lines and columns, its end included, and its rule. */
export interface ProblemSpan {
  readonly startLine: number;
  readonly startCol: number;
  readonly endLine: number;
  readonly endCol: number;
  readonly code: string;
}

/** A place in the script: a 0-based line and column. */
export interface At {
  readonly line: number;
  readonly col: number;
}

/** Compares two places: negative when `a` comes first. */
const compare = (a: At, b: At): number => a.line - b.line || a.col - b.col;
const start = (p: ProblemSpan): At => ({ line: p.startLine, col: p.startCol });
const end = (p: ProblemSpan): At => ({ line: p.endLine, col: p.endCol });

/** The problems by their place in the script (start, then end); problems at the same place keep their order. */
export function byPlace<T extends ProblemSpan>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => compare(start(a), start(b)) || compare(end(a), end(b)));
}

/** Whether two problems are the same one (the list is built again at every check, so it is not the same object). */
export function sameProblem(a: ProblemSpan, b: ProblemSpan): boolean {
  return compare(start(a), start(b)) === 0 && compare(end(a), end(b)) === 0 && a.code === b.code;
}

/**
 * The index of the problem the cursor is in, in `sorted` (from `byPlace`): the one last gone to (`picked`), while the
 * cursor is still in it, else the first that holds the cursor; -1 when none does. (Two problems can share a range: the
 * one gone to tells them apart.)
 */
function inside(sorted: readonly ProblemSpan[], at: At, picked?: ProblemSpan): number {
  const holds = (p: ProblemSpan) => compare(start(p), at) <= 0 && compare(at, end(p)) <= 0;
  const mine = picked ? sorted.findIndex((p) => sameProblem(p, picked) && holds(p)) : -1;
  return mine >= 0 ? mine : sorted.findIndex(holds);
}

/**
 * Where the strip says the cursor is: the problem it is in, else the first problem on its line, as an index in
 * `sorted`; -1 when the cursor is at no problem (the strip then shows no position).
 */
export function problemAt(sorted: readonly ProblemSpan[], at: At, picked?: ProblemSpan): number {
  const i = inside(sorted, at, picked);
  return i >= 0 ? i : sorted.findIndex((p) => p.startLine === at.line);
}

/**
 * The index in `sorted` of the problem after the cursor (`back`: before it), round from the last to the first: after
 * the problem the cursor is in, else the first that starts after the cursor (the last that starts before it); -1 when
 * there are none.
 */
export function stepProblem(sorted: readonly ProblemSpan[], at: At, back: boolean, picked?: ProblemSpan): number {
  const n = sorted.length;
  if (!n) return -1;
  const i = inside(sorted, at, picked);
  if (i >= 0) return (i + (back ? n - 1 : 1)) % n;
  if (back) {
    const before = sorted.map((p) => compare(start(p), at) < 0).lastIndexOf(true);
    return before >= 0 ? before : n - 1;
  }
  const after = sorted.findIndex((p) => compare(start(p), at) > 0);
  return after >= 0 ? after : 0;
}
