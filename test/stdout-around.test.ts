// Where a command's stdout starts out, and so whether anything depends on the order of its `2>&1` and `>file`
// (`stdoutAt`, src/semantics/stdout.ts; docs/design/sources.md, M3): each row against bash. The quick fix `>file 2>&1` is
// offered only where the model shows nothing around the command; where a row's output changes with the order, and the
// script means that, no fix may be offered.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { documentIssues } from '../src/document';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { shellState } from '../src/semantics/state';
import { stdoutAt } from '../src/semantics/stdout';
import { writesElsewhere } from '../src/semantics/redirects';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { runBash } from './support/bash';
import { explain } from './support/explain';

const parser = createUnbashParser();
const M = '2>&1 >/dev/null';
const SWAPPED = '>/dev/null 2>&1';
const MAKE = 'make() { echo out; echo err >&2; }\n';

type Answer = 'pipe' | 'capture' | 'redirected' | 'plain' | 'unknown';
/** A script, its answer, and what bash prints on stdout as it is, and with the order swapped (none: not run here). */
interface Row { src: string; goes: Answer; got?: string; swapped?: string }

const rows: Row[] = [
  // A redirection around the command: of a statement, of the function, of the call. That file gets the errors.
  { src: `{ make ${M}; } > out; cat out`, goes: 'redirected', got: 'err\n', swapped: '' },
  { src: `( make ${M} ) > out; cat out`, goes: 'redirected', got: 'err\n', swapped: '' },
  { src: `for i in 1; do make ${M}; done > out; cat out`, goes: 'redirected', got: 'err\n', swapped: '' },
  { src: `f() { make ${M}; } > out; f; cat out`, goes: 'redirected', got: 'err\n', swapped: '' },
  { src: `f() { make ${M}; }; f > out; cat out`, goes: 'redirected', got: 'err\n', swapped: '' },
  // (Inside a pipe or a capture too: they get nothing, and the file has it.)
  { src: `{ make ${M}; } > out | sed 's/^/p:/'; cat out`, goes: 'redirected', got: 'err\n', swapped: '' },
  { src: `err=$( { make ${M}; } > out ); echo "[$err]"; cat out`, goes: 'redirected', got: '[]\nerr\n', swapped: '[]\n' },
  { src: `f() { make ${M}; } > out; x=$(f); echo "[$x]"; cat out`, goes: 'redirected', got: '[]\nerr\n', swapped: '[]\n' },
  { src: `f() { make ${M}; }; x=$(f > out); echo "[$x]"; cat out`, goes: 'redirected', got: '[]\nerr\n', swapped: '[]\n' },
  { src: `bash -c 'make() { echo out; echo err >&2; }; make ${M}' > out; cat out`, goes: 'redirected', got: 'err\n', swapped: '' },
  { src: `{ make ${M}; } 1<>out; cat out`, goes: 'redirected', got: 'err\n', swapped: '' },
  // A pipe.
  { src: `make ${M} | sed 's/^/p:/'`, goes: 'pipe', got: 'p:err\n', swapped: '' },
  { src: `{ make ${M}; } | sed 's/^/p:/'`, goes: 'pipe', got: 'p:err\n', swapped: '' },
  { src: `for i in 1; do make ${M}; done | sed 's/^/p:/'`, goes: 'pipe', got: 'p:err\n', swapped: '' },
  { src: `f() { make ${M}; }; f | sed 's/^/p:/'`, goes: 'pipe', got: 'p:err\n', swapped: '' },
  { src: `cat <(make ${M})`, goes: 'pipe', got: 'err\n', swapped: '' },
  { src: `coproc { make ${M}; }; cat <&"\${COPROC[0]}"`, goes: 'pipe', got: 'err\n', swapped: '' },
  { src: `bash -c 'make() { echo out; echo err >&2; }; make ${M}' | sed 's/^/p:/'`, goes: 'pipe', got: 'p:err\n', swapped: '' },
  // A command substitution.
  { src: `err=$(make ${M}); echo "[$err]"`, goes: 'capture', got: '[err]\n', swapped: '[]\n' },
  { src: `f() { make ${M}; }; x=$(f); echo "[$x]"`, goes: 'capture', got: '[err]\n', swapped: '[]\n' },
  { src: `g() { make ${M}; }; f() { g; g; }; x=$(f); echo "[$x]"`, goes: 'capture', got: '[err\nerr]\n', swapped: '[]\n' },
  { src: `f() { make ${M}; [ -n "$1" ] || f x; }; x=$(f); echo "[$x]"`, goes: 'capture', got: '[err\nerr]\n', swapped: '[]\n' },
  // Nothing around it: the fix, which sends both to the file, as its text says.
  { src: `make ${M}`, goes: 'plain', got: 'err\n', swapped: '' },
  { src: `true | make ${M}`, goes: 'plain', got: 'err\n', swapped: '' },
  { src: `f() { make ${M}; }; f`, goes: 'plain', got: 'err\n', swapped: '' },
  { src: `g() { make ${M}; }; f() { g; g; }; f`, goes: 'plain', got: 'err\nerr\n', swapped: '' },
  { src: `f() { make ${M}; [ -n "$1" ] || f x; }; f`, goes: 'plain', got: 'err\nerr\n', swapped: '' },
  { src: `g() { [ -n "$1" ] || f x; }; f() { make ${M}; g "$1"; }; f`, goes: 'plain', got: 'err\nerr\n', swapped: '' },
  // Not known: the caveat, with no fix. Calls that differ, and a recursive call in a pipe.
  { src: `f() { make ${M}; }; f | sed 's/^/p:/'; x=$(f); echo "[$x]"`, goes: 'unknown', got: 'p:err\n[err]\n', swapped: '[]\n' },
  { src: `f() { make ${M}; }; f; err=$(f); echo "[$err]"`, goes: 'unknown', got: 'err\n[err]\n', swapped: '[]\n' },
  { src: `f() { make ${M}; [ -n "$1" ] || f x | cat; }; f`, goes: 'unknown', got: 'err\nerr\n', swapped: '' },
  // A stdout `exec`, in the script or in the capture itself, which then gets nothing.
  { src: `exec 3>&1 >> log; make ${M}; cat log >&3`, goes: 'unknown', got: 'err\n', swapped: '' },
  { src: `err=$(exec > log; make ${M}); echo "[$err]"; cat log`, goes: 'unknown', got: '[]\nerr\n', swapped: '[]\n' },
  { src: `command exec 3>&1 >> log; make ${M}; cat log >&3`, goes: 'unknown', got: 'err\n', swapped: '' },
  // A function with a call not seen, or none: a library's, `export -f`, a trap.
  { src: `f() { make ${M}; }`, goes: 'unknown' },
  { src: `f() { make ${M}; }; export -f f; f`, goes: 'unknown' },
  { src: `f() { make ${M}; }; trap f EXIT`, goes: 'unknown' },
  // `>( )`, whose stdout is not the command's around it; a string `eval` runs in a function, as far as its calls are read.
  { src: `tee >(make ${M}) </dev/null >/dev/null`, goes: 'unknown' },
  { src: `f() { eval 'make ${M}'; }; f`, goes: 'unknown' },
];

/** The caveat of the row's line: the line that holds the `2>&1`. */
function read(src: string): { caveat: boolean; fix: boolean; alone: string | undefined } {
  const ex = explain(src, src.split('\n').findIndex((l) => l.includes(M)));
  const f = ex.facts?.find((x) => x.id === 'stderr-to-original-stdout');
  const table = ex.notes.find((n) => n.includes('Redirections apply'))!;
  return { caveat: !!f, fix: !!f?.rewrite?.length, alone: /\(only the error messages[^)]*\)$/.exec(table)?.[0] };
}

const ALONE: Partial<Record<Answer, string>> = {
  pipe: '(only the error messages go into the pipe)',
  capture: '(only the error messages make the substitution\'s value)',
  redirected: '(only the error messages go where a redirection around the command sends stdout)',
};

describe('where stdout starts out, against bash', () => {
  for (const r of rows) {
    it(`${r.goes}: ${r.src}`, () => {
      const said = read(r.src);
      // The answers: known, "only the errors" and no caveat; plain, the fix; not known, the caveat alone.
      assert.deepStrictEqual(said, { caveat: !ALONE[r.goes], fix: r.goes === 'plain', alone: ALONE[r.goes] });
      if (r.got === undefined) return;
      const run = (s: string) => runBash(MAKE + s, { files: [] }).stdout;
      assert.strictEqual(run(r.src), r.got);
      assert.strictEqual(run(r.src.split(M).join(SWAPPED)), r.swapped);
    });
  }

  it('offers no quick fix but where the answer is plain', () => {
    const fixed = rows.filter((r) => documentIssues({ lines: r.src.split('\n'), tree: parser.parse(r.src) }, 'en', {}).some((i) => i.code === 'stderr-to-original-stdout' && i.fixes?.length));
    assert.deepStrictEqual(fixed.map((r) => r.goes), rows.filter((r) => r.goes === 'plain').map((r) => r.goes));
    assert.deepStrictEqual(fixed.map((r) => r.src), rows.filter((r) => r.goes === 'plain').map((r) => r.src));
  });

  it('answers for the statement asked, before its own redirections', () => {
    const at = (src: string) => {
      const tree = parser.parse(src);
      return stdoutAt(shellState(tree, 'bash'), descendants(tree.root, ['command'])[0]);
    };
    assert.strictEqual(at('make >o'), 'plain');
    assert.strictEqual(at('make >o | cat'), 'pipe');
    // (Another `exec` is no `exec`: its name decides, and a redirection does.)
    assert.strictEqual(at('make; exec 3>f'), 'plain');
    assert.strictEqual(at('make; command ls >f'), 'plain');
    assert.strictEqual(at('make; command >f'), 'plain');
    assert.strictEqual(at('make; builtin exec >&2'), 'unknown');
    assert.strictEqual(at('make; a=1 >f'), 'plain');
  });

  it('reads what sends stdout elsewhere, by the descriptor the redirection sets', () => {
    const writes = (src: string) => writesElsewhere(descendants(parser.parse(src).root, ['command'])[0]);
    assert.deepStrictEqual(['a >f', 'a >>f', 'a 1>f', 'a &>f', 'a >&2', 'a 1<>f', 'a 1<&3'].filter((s) => !writes(s)), []);
    assert.deepStrictEqual(['a 2>f', 'a <f', 'a <>f', 'a 3>f', 'a 2>&1', 'a <<<x'].filter(writes), []);
  });

  it('knows no stdout in what a host calls: a test of bats, and what it runs with `run`', () => {
    for (const body of [`make ${M}`, `run bash -c 'make ${M}'`]) {
      const bats = `@test "a" {\n  ${body}\n}\n`;
      const extracted = extractShell(hostKind('', 't.bats', bats)!, bats);
      const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, bats.split('\n'), 1, 'en')!;
      assert.ok(ex.facts!.some((f) => f.id === 'stderr-to-original-stdout'), body);
      assert.ok(!ex.notes.some((n) => n.includes('only the error messages')), body);
    }
    const bats = `f() { make ${M}; }\n@test "a" {\n  run f\n}\n`;
    const extracted = extractShell(hostKind('', 't.bats', bats)!, bats);
    const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, bats.split('\n'), 0, 'en')!;
    assert.ok(ex.facts!.some((f) => f.id === 'stderr-to-original-stdout'));
    assert.ok(!ex.notes.some((n) => n.includes('only the error messages')));
  });
});
