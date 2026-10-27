// The rewrites of the notes on exit statuses (docs/design/oracles.md, 3.2 and 3.3; test/rewrites.test.ts has the
// model): a declaration that hides the status of its `$( )` (`declaration-masks-status`), `((i++))` at 0
// (`postfix-increment-status`), and `test && cmd` at the end of a function or a script
// (`function-last-test-returns-status`, `function-last-test-stops-script`, `script-last-test-returns-status`). The
// rewrites of hand-written inputs, then the rewritten scripts run in bash (5.2, and 5.3 when `$BASH_EXPLAINER_BASH53`
// names one) in a cgroup: in the state the author had in mind the rewrite does what the original does, in the others
// the hazard is gone; it parses (`bash -n`), and explaining it raises no fact of the same id.
import * as assert from 'assert';
import type { FactId } from '../src/messages';
import { factsOf, programs, type Ran, RECORDERS, rewrites, run } from './support/rewrites';

const DRIVER = '"$BASH" -n f.sh || echo @syntax; "$BASH" f.sh; echo "@run=$?"';
const status = (r: Ran, k: string): string | undefined => new RegExp(`^@${k}=(\\d+)`, 'm').exec(r.out)?.[1];
const code = (src: string, id: FactId, lang: 'en' | 'ja' = 'en'): string => factsOf(src, id, undefined, lang)[0].text;

describe('the rewrites of `declaration-masks-status`', () => {
  const fix = (src: string): [string, string][] => rewrites(src, 'declaration-masks-status');
  it('declare the names, then assign them, so that the status is that of `$( )`', () => {
    assert.deepStrictEqual(fix('f() {\n  local x=$(g)\n}\nf'), [['local x; x=$(g)', 'f() {\n  local x; x=$(g)\n}\nf']]);
    assert.deepStrictEqual(fix('f() {\n  local u=$(g) || return\n}\nf')[0][1], 'f() {\n  local u; u=$(g) || return\n}\nf');
    // (Only the words with a `$( )` move: bash expands every word first, so `b=$a` reads the `a` from before, as it still does.)
    assert.deepStrictEqual(fix('export a=$(g) b=$a')[0][0], 'export a b=$a; a=$(g)');
    assert.deepStrictEqual(fix('f() {\n  local a[0]=$(g)\n}\nf')[0][0], 'local a; a[0]=$(g)');
    // (After `&&`, in a pipeline: in a group.)
    assert.deepStrictEqual(fix('true && export q=$(g)')[0][1], 'true && { export q; q=$(g); }');
    assert.deepStrictEqual(fix('f() { local x=$(g) | cat; }\nf')[0][1], 'f() { { local x; x=$(g); } | cat; }\nf');
  });
  it('make the names read-only after they are set', () => {
    assert.deepStrictEqual(fix('readonly z=$(g) w=1'), [['z=$(g); readonly z w=1', 'z=$(g); readonly z w=1']]);
    // (`local -r`, `declare -r`, `typeset -r`: without `r`, then `readonly` of every name it declares.)
    assert.deepStrictEqual(fix('f() {\n  local -r a=1 b=$(g) c\n}\nf')[0][0], 'local a=1 b c; b=$(g); readonly a b c');
    assert.deepStrictEqual(fix('f() {\n  declare -ri y=$(g) 2>/dev/null\n}\nf')[0][0], 'declare -i y 2>/dev/null; y=$(g); readonly y');
    assert.deepStrictEqual(fix('typeset -i -r n=$(g)')[0][0], 'typeset -i n; n=$(g); readonly n');
  });
  it('are what the note says; none is carried first in a list with `readonly`, nor in a string another shell runs', () => {
    assert.match(code('f() {\n  local x=$(g)\n}\nf', 'declaration-masks-status'), /Split it: `local x; x=\$\(g\)`$/);
    assert.match(code('f() {\n  local x=$(g)\n}\nf', 'declaration-masks-status', 'ja'), /`local x; x=\$\(g\)` と分けて書きます$/);
    // (`readonly r=$(g) || exit`: the `||` would test `readonly`.)
    const [ro] = factsOf('readonly r=$(g) || exit', 'declaration-masks-status');
    assert.match(ro.text, /Split it: `r=\$\(g\); readonly r`$/);
    assert.strictEqual(ro.rewrite, undefined);
    const [c] = factsOf("bash -c 'f() { local x=$(g); }; f'", 'declaration-masks-status');
    assert.match(c.text, /Split it: `local x; x=\$\(g\)`$/);
    assert.strictEqual(c.rewrite, undefined);
  });

  // `g` prints 42, and fails when `RW_FAIL` is 1. `hides`: the status printed after the line, which the original
  // gives as 0 (not for a declaration that makes the names read-only: `readonly` comes last, and its status is 0).
  const recorders = `${RECORDERS}g() { echo 42; return "\${RW_FAIL:-0}"; }\n`;
  const inputs: { src: string; hides?: string }[] = [
    { src: 'f() {\n  local x=$(g)\n  echo "@st=$?"\n  declare -p x\n}\nf\n', hides: 'st' },
    { src: 'f() {\n  local -r a=1 b=$(g) c\n  declare -p a b c\n}\nf\n' },
    { src: 'f() {\n  declare -ri y=$(g) 2>/dev/null\n  declare -p y\n}\nf\n' },
    { src: 'readonly z=$(g) w=1\ndeclare -p z w\n' },
    { src: 'a=old\nexport a=$(g) b=$a\necho "@st=$?"\ndeclare -p a b\n', hides: 'st' },
    { src: 'f() {\n  true && export q=$(g)\n  echo "@st=$?"\n  declare -p q\n}\nf\n', hides: 'st' },
    { src: 'f() {\n  local u=$(g) || return 3\n  echo "@u=$u"\n}\nf\necho "@f=$?"\n', hides: 'f' },
  ];
  for (const { name, program } of programs) {
    for (const { src, hides } of inputs) {
      for (const errexit of [false, true]) {
        const script = errexit ? `set -e\n${src}echo @next\n` : src;
        it(`pass the failure of \`$( )\` on in ${name}${errexit ? ', with `set -e`' : ''}: ${JSON.stringify(src)}`, async () => {
          const [[, after]] = rewrites(script, 'declaration-masks-status');
          const fail = { env: { RW_FAIL: '1' }, recorders };
          const [before, rewritten, beforeOk, afterOk] = await Promise.all([run(program, script, DRIVER, fail), run(program, after, DRIVER, fail),
            run(program, script, DRIVER, { recorders }), run(program, after, DRIVER, { recorders })]);
          // (The meaning is kept: when `g` succeeds, the same values, with the same attributes.)
          assert.deepStrictEqual(afterOk, beforeOk);
          assert.match(afterOk.out, /42/);
          assert.doesNotMatch(rewritten.out, /@syntax/);
          // (The hazard is gone: `set -e` stops at the failure, and the status after the line is that of `$( )`.)
          if (errexit) {
            assert.match(before.out, /^@next$/m);
            assert.doesNotMatch(rewritten.out, /^@next$/m);
            assert.notStrictEqual(status(rewritten, 'run'), '0');
          } else if (hides) {
            assert.strictEqual(status(before, hides), '0');
            assert.notStrictEqual(status(rewritten, hides), '0');
          }
        });
      }
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const { src } of inputs) for (const [, s] of fix(src)) assert.deepStrictEqual(factsOf(s, 'declaration-masks-status'), [], s);
  });
});

describe('the rewrites of `postfix-increment-status`', () => {
  const fix = (src: string): [string, string][] => rewrites(src, 'postfix-increment-status');
  it('assign, increment first, or, where `set -e` stops there, ignore the status', () => {
    assert.deepStrictEqual(fix('set -e\ni=0\n((i++))'), [['i=$((i+1))', 'set -e\ni=0\ni=$((i+1))'], ['((++i))', 'set -e\ni=0\n((++i))'], ['((i++)) || true', 'set -e\ni=0\n((i++)) || true']]);
    assert.deepStrictEqual(fix('i=0\n((i++))').map(([c]) => c), ['i=$((i+1))', '((++i))']);
    // (The statement as written, in a group after `&&`.)
    assert.deepStrictEqual(fix('set -e\ntrue && (( a[k]++ ))').map(([, s]) => s)[2], 'set -e\ntrue && { (( a[k]++ )) || true; }');
    assert.deepStrictEqual(fix('set -e\ntrue && (( a[k]++ ))').map(([c]) => c).slice(0, 2), ['a[k]=$((a[k]+1))', '((++a[k]))']);
  });
  it('are what the note says', () => {
    assert.match(code('set -e\ni=0\n((i++))', 'postfix-increment-status'), /Write `i=\$\(\(i\+1\)\)`, `\(\(\+\+i\)\)` or `\(\(i\+\+\)\) \|\| true`$/);
    assert.match(code('i=0\n((i++))', 'postfix-increment-status', 'ja'), /`i=\$\(\(i\+1\)\)` や `\(\(\+\+i\)\)` なら 0 になる$/);
    const [c] = factsOf("bash -c 'set -e; i=0; ((i++))'", 'postfix-increment-status');
    assert.match(c.text, /Write `i=\$\(\(i\+1\)\)`, `\(\(\+\+i\)\)` or `\(\(i\+\+\)\) \|\| true`$/);
    assert.strictEqual(c.rewrite, undefined);
  });

  // The value of `i` comes from the environment: 1, the state the author had in mind (the status is 0), then 0 and
  // unset, where `((i++))` gives status 1.
  const inputs = ['((i++))\necho "@st=$? i=$i"\n', 'set -e\n((i++))\necho "@st=$? i=$i"\n', 'set -e\ntrue && ((i++))\necho "@st=$? i=$i"\n',
    'set -e\nf() {\n  (( i++ ))\n  echo "@in i=$i"\n}\nf\necho "@st=$? i=$i"\n'];
  for (const { name, program } of programs) {
    for (const src of inputs) {
      it(`give status 0 and the same value in ${name}: ${JSON.stringify(src)}`, async () => {
        const one = await run(program, src, DRIVER, { env: { i: '1' } });
        assert.match(one.out, /^@st=0 i=2$/m);
        for (const [c, script] of fix(src)) {
          assert.deepStrictEqual(await run(program, script, DRIVER, { env: { i: '1' } }), one, c);
          for (const env of [{ i: '0' }, {}] as Record<string, string>[]) {
            const before = await run(program, src, DRIVER, { env });
            const after = await run(program, script, DRIVER, { env });
            assert.doesNotMatch(after.out, /@syntax/, c);
            assert.match(after.out, /^@st=0 i=1$/m, c);
            // (The original fails there: its status is 1, or `set -e` stops before the line after.)
            assert.match(before.out, src.startsWith('set -e') ? /^@run=1$/m : /^@st=1 i=1$/m, c);
          }
        }
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const src of inputs) for (const [, s] of fix(src)) assert.deepStrictEqual(factsOf(s, 'postfix-increment-status'), [], s);
  });
});

describe('the rewrites of `test && cmd` at the end of a function or of a script', () => {
  const fix = (src: string, id: FactId): [string, string][] => rewrites(src, id);
  it('write an `if`, or end the function with `return 0`, the script with `exit 0`', () => {
    assert.deepStrictEqual(fix('#!/bin/bash\nset -e\nf() {\n  [ -f x ] && echo y # c\n}\nf\necho', 'function-last-test-stops-script'), [
      ['if [ -f x ]; then echo y; fi', '#!/bin/bash\nset -e\nf() {\n  if [ -f x ]; then echo y; fi # c\n}\nf\necho'],
      ['return 0', '#!/bin/bash\nset -e\nf() {\n  [ -f x ] && echo y # c\n  return 0\n}\nf\necho']]);
    assert.deepStrictEqual(fix('#!/bin/bash\nset -e\nf() { [ -f x ] && echo y; }\nf', 'function-last-test-returns-status').map(([, s]) => s), [
      '#!/bin/bash\nset -e\nf() { if [ -f x ]; then echo y; fi; }\nf', '#!/bin/bash\nset -e\nf() { [ -f x ] && echo y; return 0; }\nf']);
    // (The last line, with no newline after it; `a && b && c`, and a newline after `&&`.)
    assert.deepStrictEqual(fix('#!/bin/bash\n[ -f x ] && [ -f y ] &&\n  echo y', 'script-last-test-returns-status'), [
      ['if [ -f x ] && [ -f y ]; then\n  echo y; fi', '#!/bin/bash\nif [ -f x ] && [ -f y ]; then\n  echo y; fi'], ['exit 0', '#!/bin/bash\n[ -f x ] && [ -f y ] &&\n  echo y\nexit 0']]);
  });
  it('put `fi` and `return 0` before the bodies of here-documents, or after them on a line of their own', () => {
    assert.deepStrictEqual(fix('#!/bin/bash\nset -e\nf() { [[ -f x ]] && cat <<EOF; }\nhi\nEOF\nf', 'function-last-test-returns-status').map(([, s]) => s), [
      '#!/bin/bash\nset -e\nf() { if [[ -f x ]]; then cat <<EOF; fi; }\nhi\nEOF\nf', '#!/bin/bash\nset -e\nf() { [[ -f x ]] && cat <<EOF; return 0; }\nhi\nEOF\nf']);
    assert.deepStrictEqual(fix('#!/bin/bash\nset -e\nf() {\n  grep -q x <<EOF && cat <<EOF2 # c\nx\nEOF\nhi\nEOF2\n}\nf', 'function-last-test-returns-status').map(([, s]) => s), [
      '#!/bin/bash\nset -e\nf() {\n  if grep -q x <<EOF; then cat <<EOF2; fi # c\nx\nEOF\nhi\nEOF2\n}\nf',
      '#!/bin/bash\nset -e\nf() {\n  grep -q x <<EOF && cat <<EOF2 # c\nx\nEOF\nhi\nEOF2\n  return 0\n}\nf']);
  });
  it('are what the notes say; none is carried in a string another shell runs', () => {
    const src = '#!/bin/bash\nset -e\nf() {\n  [ -f x ] && echo y\n}\nf\necho';
    assert.match(code(src, 'function-last-test-stops-script'), /Write `if \[ -f x \]; then echo y; fi`, or end the function with `return 0`$/);
    assert.match(code(src, 'function-last-test-stops-script', 'ja'), /`if \[ -f x \]; then echo y; fi` と書くか、最後に `return 0` を置く$/);
    assert.match(code('#!/bin/bash\nset -e\nf() { [ -f x ] && echo y; }\nf', 'function-last-test-returns-status', 'ja'), /`if \[ -f x \]; then echo y; fi` と書くか、最後に `return 0` を置く$/);
    assert.match(code('#!/bin/bash\n[ -f x ] && echo y', 'script-last-test-returns-status'), /Write `if \[ -f x \]; then echo y; fi`, or end the script with `exit 0`$/);
    // (A here-document: the first line of the code.)
    assert.match(code('#!/bin/bash\nset -e\nf() {\n  [ -f x ] && cat <<EOF\nhi\nEOF\n}\nf', 'function-last-test-returns-status'), /Write `if \[ -f x \]; then cat <<EOF; fi …`/);
    for (const s of ["set -e\nbash -c 'set -e\nf() {\n  [ -f x ] && echo y\n}\nf\necho'", "bash -c 'set -e; f() { [ -f x ] && echo y; }; f; echo'"]) {
      const [c] = factsOf(s, 'function-last-test-stops-script');
      assert.match(c.text, /Write `if \[ -f x \]; then echo y; fi`, or end the function with `return 0`$/);
      assert.strictEqual(c.rewrite, undefined);
    }
  });

  // Each input, its id, and the state the author had in mind: the files or the variables that make the test true.
  // `@next` marks what runs after the call.
  const inputs: { src: string; id: FactId; files?: string[]; env?: Record<string, string> }[] = [
    { src: '#!/bin/bash\nset -e\nf() {\n  [ -f x ] && echo "@y"\n}\nf\necho @next\n', id: 'function-last-test-stops-script', files: ['x'] },
    { src: '#!/bin/bash\nset -e\nf() {\n  [ -f x ] && echo "@y"\n}\necho @start\nf\n', id: 'function-last-test-returns-status', files: ['x'] },
    { src: '#!/bin/bash\nset -e\nf() { [[ -f x ]] && cat <<EOF; }\n@hi\nEOF\nf\n', id: 'function-last-test-returns-status', files: ['x'] },
    { src: '#!/bin/bash\nset -e\nf() {\n  grep -q x <<EOF && cat <<EOF2\n$X\nEOF\n@there\nEOF2\n}\nf\necho @next\n', id: 'function-last-test-stops-script', env: { X: 'x' } },
    { src: '#!/bin/bash\necho @start\n[ -f x ] && echo "@y"\n', id: 'script-last-test-returns-status', files: ['x'] },
    { src: '#!/bin/bash\n[ -f x ] &&\n  [ -f y ] && echo "@y"', id: 'script-last-test-returns-status', files: ['x', 'y'] },
  ];
  for (const { name, program } of programs) {
    for (const { src, id, files = [], env = {} } of inputs) {
      it(`end with status 0 when the test fails in ${name}: ${JSON.stringify(src)}`, async () => {
        const ok = await run(program, src, DRIVER, { files, env });
        const no = await run(program, src, DRIVER);
        assert.match(ok.out, /^@(y|hi|there)$/m);
        // (When the test fails, the original's status is 1: the script's, or the call's, where `set -e` stops.)
        assert.strictEqual(status(no, 'run'), '1');
        for (const [c, script] of fix(src, id)) {
          // (The meaning is kept: when the test is true, the rewrite runs as the original does.)
          assert.deepStrictEqual(await run(program, script, DRIVER, { files, env }), ok, c);
          // (The hazard is gone: when it fails, the status is 0, and the script goes on after the call.)
          const after = await run(program, script, DRIVER);
          assert.doesNotMatch(after.out, /@syntax|^@(y|hi|there)$/m, c);
          assert.strictEqual(status(after, 'run'), '0', c);
          if (/@next/.test(src)) assert.match(after.out, /^@next$/m, c);
        }
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const { src, id } of inputs) for (const [, s] of fix(src, id)) assert.deepStrictEqual(factsOf(s, id), [], s);
  });
});
