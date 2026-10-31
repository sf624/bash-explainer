// The web page's Problems strip (src/ui/problemNav.ts; docs/design/chrome-redesign.md, C2): the problems in the order of
// the script, where the cursor is ("Ln 20 · 1/11"), and the next and previous problem with wrap-around (F8, Shift+F8).
import * as assert from 'assert';
import { byPlace, problemAt, type ProblemSpan, sameProblem, stepProblem } from '../src/ui/problemNav';

const p = (startLine: number, startCol: number, endLine: number, endCol: number, code = 'c'): ProblemSpan => ({ startLine, startCol, endLine, endCol, code });

describe('the Problems strip: order, position and the next problem', () => {
  // Line 2 has two problems; line 5 two with the same range; a problem over lines 7 and 8.
  const list = byPlace([p(5, 4, 5, 9, 'b'), p(2, 10, 2, 12), p(0, 0, 0, 3), p(2, 0, 2, 4), p(5, 4, 5, 9, 'a'), p(7, 2, 8, 1)]);

  it('orders the problems by place, and keeps the order of two at the same place', () => {
    assert.deepStrictEqual(list.map((x) => [x.startLine, x.startCol, x.code]), [[0, 0, 'c'], [2, 0, 'c'], [2, 10, 'c'], [5, 4, 'b'], [5, 4, 'a'], [7, 2, 'c']]);
    assert.deepStrictEqual(byPlace([p(1, 0, 1, 9, 'x'), p(1, 0, 1, 2, 'y')]).map((x) => x.code), ['y', 'x']);
  });

  it('tells the same problem from a copy of the list, by its range and rule', () => {
    assert.ok(sameProblem(p(5, 4, 5, 9, 'a'), { ...list[4] }));
    assert.ok(!sameProblem(list[3], list[4]));
    assert.ok(!sameProblem(p(5, 4, 5, 8, 'a'), list[4]));
  });

  it('says where the cursor is: the problem it is in, else the first of its line, else nowhere', () => {
    // In the second problem of line 2 (its end included), at the line's start (its first), between them (the first of the line).
    assert.strictEqual(problemAt(list, { line: 2, col: 11 }), 2);
    assert.strictEqual(problemAt(list, { line: 2, col: 12 }), 2);
    assert.strictEqual(problemAt(list, { line: 2, col: 0 }), 1);
    assert.strictEqual(problemAt(list, { line: 2, col: 7 }), 1);
    // On a line with none, and inside a problem over two lines.
    assert.strictEqual(problemAt(list, { line: 3, col: 0 }), -1);
    assert.strictEqual(problemAt(list, { line: 8, col: 0 }), 5);
    assert.strictEqual(problemAt([], { line: 0, col: 0 }), -1);
    // Two problems with one range: the one gone to, while the cursor is in it; else the first.
    assert.strictEqual(problemAt(list, { line: 5, col: 9 }), 3);
    assert.strictEqual(problemAt(list, { line: 5, col: 9 }, list[4]), 4);
    assert.strictEqual(problemAt(list, { line: 5, col: 9 }, { ...list[4] }), 4);
    assert.strictEqual(problemAt(list, { line: 2, col: 1 }, list[4]), 1);
  });

  it('goes to the next problem and the previous one, round from the last to the first', () => {
    const walk = (back: boolean) => {
      const seen: number[] = [];
      let at = { line: 0, col: 0 };
      let picked: ProblemSpan | undefined;
      for (let k = 0; k < list.length + 1; k++) {
        const i = stepProblem(list, at, back, picked);
        seen.push(i);
        picked = list[i];
        at = { line: picked.endLine, col: picked.endCol };
      }
      return seen;
    };
    // From inside the first: every problem once (the two at one place too), then the first again.
    assert.deepStrictEqual(walk(false), [1, 2, 3, 4, 5, 0, 1]);
    assert.deepStrictEqual(walk(true), [5, 4, 3, 2, 1, 0, 5]);
  });

  it('goes from a place between problems to the next one that starts after it, or the last before it', () => {
    assert.strictEqual(stepProblem(list, { line: 2, col: 7 }, false), 2);
    assert.strictEqual(stepProblem(list, { line: 2, col: 7 }, true), 1);
    assert.strictEqual(stepProblem(list, { line: 3, col: 0 }, false), 3);
    assert.strictEqual(stepProblem(list, { line: 3, col: 0 }, true), 2);
    // After the last: round to the first; before the first: round to the last.
    assert.strictEqual(stepProblem(list, { line: 9, col: 0 }, false), 0);
    const later = byPlace([p(3, 2, 3, 5), p(6, 0, 6, 1)]);
    assert.strictEqual(stepProblem(later, { line: 1, col: 0 }, true), 1);
    assert.strictEqual(stepProblem(later, { line: 1, col: 0 }, false), 0);
    assert.strictEqual(stepProblem([], { line: 0, col: 0 }, false), -1);
  });
});
