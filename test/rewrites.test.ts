// The rewrites the catalog's facts suggest (docs/design/oracles.md, 3.2 and 3.3): each fact of a mechanical id carries
// its rewrites as data, and its text renders them. Here, for the ids that have them so far, the rewrites of hand-written
// inputs, and the rewritten scripts run in bash (5.2, and 5.3 when `$BASH_EXPLAINER_BASH53` names one) in a cgroup:
// the meaning is kept (in the state the author had in mind, the rewrite does what the original does), the hazard is
// gone (in the other states, none of its signs), the rewrite parses (`bash -n`), and explaining it raises no fact of
// the same id. Commands that would act (`cp`, `rm`, `tar`) are recorders, defined through BASH_ENV (test/support/rewrites.ts).
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { factsOf, programs, type Ran, rewrites, run } from './support/rewrites';

const parser = createUnbashParser();

describe('the rewrites of `failure-reported-as-success`', () => {
  const fix = (src: string, shell?: Shell): string[] => rewrites(src, 'failure-reported-as-success', shell).map(([, s]) => s);
  it('end with `exit 1` in a script, `return 1` in a function, and `return 1 2>/dev/null || exit 1` where the file may be sourced', () => {
    assert.deepStrictEqual(fix('#!/bin/bash\ncp a b 2>/dev/null || echo "copy failed"'), ['#!/bin/bash\ncp a b 2>/dev/null || { echo "copy failed" >&2; exit 1; }']);
    assert.deepStrictEqual(fix('cp a b || echo failed'), ['cp a b || { echo failed >&2; return 1 2>/dev/null || exit 1; }']);
    assert.deepStrictEqual(fix('f() {\n  cp a b || echo failed >&2\n}\nf'), ['f() {\n  cp a b || { echo failed >&2; return 1; }\n}\nf']);
    assert.deepStrictEqual(fix('set -e\ncp a b || echo failed >> log\nls'), ['set -e\ncp a b || { echo failed >> log; return 1 2>/dev/null || exit 1; }\nls']);
    // (Where `set -e` is on in a function: `exit 1` in a script; `return 1` in a file that may be sourced, then `set -e` stops at the call.)
    assert.deepStrictEqual(fix('#!/bin/bash\nset -e\nf() {\n  cp a b || echo failed\n  ls\n}\nf'), ['#!/bin/bash\nset -e\nf() {\n  cp a b || { echo failed >&2; exit 1; }\n  ls\n}\nf']);
    assert.deepStrictEqual(fix('set -e\nf() {\n  cp a b || echo failed\n  ls\n}\nf'), ['set -e\nf() {\n  cp a b || { echo failed >&2; return 1; }\n  ls\n}\nf']);
    // (A group on the right: the whole of it in the new group, its last message on stderr.)
    assert.deepStrictEqual(fix('#!/bin/sh\ncp a b || { echo a; echo b; }', 'sh'), ['#!/bin/sh\ncp a b || { { echo a; echo b >&2; }; exit 1; }']);
    // (A message sent somewhere by the group around it stays there.)
    assert.deepStrictEqual(fix('#!/bin/bash\ncp a b || { echo m; } > log'), ['#!/bin/bash\ncp a b || { { echo m; } > log; exit 1; }']);
  });
  it('in a string another shell runs: `exit 1`, said, but not carried as edits, which would need quoting', () => {
    const [f] = factsOf("bash -c 'set -e; cp a b || echo failed; ls'", 'failure-reported-as-success');
    assert.match(f.text, /To stop the script, write `… \|\| \{ echo failed >&2; exit 1; \}`$/);
    assert.strictEqual(f.rewrite, undefined);
    const [g] = factsOf("bash -c 'for f in *.log; do rm \"$f\"; done'", 'unmatched-glob-runs-once');
    assert.match(g.text, /Start the body with `\[ -e "\$f" \] \|\| continue`, or turn on `shopt -s nullglob` before the loop$/);
    assert.strictEqual(g.rewrite, undefined);
  });
  it('are what the note says, which names how the sourced form works', () => {
    const [f] = factsOf('cp a b || { echo a\n  echo b; }', 'failure-reported-as-success');
    assert.match(f.text, /To pass the failure on, write `… \|\| \{ \{ echo a …`: it returns when the file is sourced, and exits when it is run$/);
    assert.strictEqual(f.rewrite![0].code, '{ { echo a\n  echo b >&2; }; return 1 2>/dev/null || exit 1; }');
    const ja = new Analyzer('ja').explainLine(parser.parse('cp a b || echo failed'), 0).facts![0];
    assert.match(ja.text, /失敗を伝えるには `… \|\| \{ echo failed >&2; return 1 2>\/dev\/null \|\| exit 1; \}` と書きます。ファイルが `source` で読み込まれたときは `return` で戻り、実行されたときは `exit` で終わります$/);
  });
  it('says the case of a file with no shebang as a condition, and not for a code block typed into a terminal', () => {
    assert.match(factsOf('cp a b || echo failed', 'failure-reported-as-success')[0].text, /^ⓘ Caveat: if this file is run as a script, this is its last command, so when `cp a b` fails/);
    const md = new Analyzer('en').explainLine(parser.parse('cp a b || echo failed'), 0, undefined, { host: { kind: 'markdown' } }).facts ?? [];
    assert.deepStrictEqual(md.filter((f) => f.id === 'failure-reported-as-success'), []);
    // (A script a host runs, a Dockerfile `RUN`, is run as a script.)
    const run = new Analyzer('en').explainLine(parser.parse('cp a b || echo failed'), 0, undefined, { host: { kind: 'dockerfile' } }).facts ?? [];
    assert.match(run.find((f) => f.id === 'failure-reported-as-success')!.text, /^ⓘ Caveat: this is the last command of the script.*`… \|\| \{ echo failed >&2; exit 1; \}`$/);
  });

  // Each input, and how its file is read: run (a shebang) or maybe sourced. `@next` marks what runs after the line.
  const inputs: { src: string; sourced: boolean; errexit?: boolean }[] = [
    { src: '#!/bin/bash\ncp a b 2>/dev/null || echo "copy failed"\n', sourced: false },
    { src: 'cp a b || echo "copy failed"\n', sourced: true },
    { src: '#!/bin/bash\nf() {\n  tar -czf b.tgz docs || echo failed >&2\n}\nf\necho "@f=$?"\n', sourced: false },
    { src: 'f() {\n  cp a b || { echo a; echo b; }\n}\nf\necho "@f=$?"\n', sourced: true },
    { src: 'set -e\ncp a b || echo failed\necho @next\n', sourced: true, errexit: true },
    { src: '#!/bin/bash\nset -e\ncp a b || echo failed\necho @next\n', sourced: false, errexit: true },
    { src: 'set -e\ng() {\n  cp a b || echo failed\n  echo @next\n}\ng\necho @next\n', sourced: true, errexit: true },
  ];
  /** Run as a program; and, for a file that may be sourced, sourced at the top level and inside a function, each in a subshell. */
  const driver = (sourced: boolean): string => `"$BASH" -n f.sh || echo @syntax; "$BASH" f.sh; echo "@run=$?"${sourced
    ? '; ( . ./f.sh; echo "@in=$?" ); echo "@sourced=$?"; ( g2() { . ./f.sh; echo "@in-g=$?"; }; g2; echo "@after-g=$?" )' : ''}`;
  const STATUS = /^@(run|in|in-g|after-g|sourced|f)=/;
  /** The lines printed, but the statuses and what runs after the line: what the rewrite must print as the original does. */
  const said = (r: Ran): string[] => `${r.out}${r.err}`.split('\n').filter((l) => l && !STATUS.test(l) && l !== '@next').sort();
  for (const { name, program } of programs) {
    for (const { src, sourced, errexit } of inputs) {
      it(`pass the failure on in ${name}: ${JSON.stringify(src)}`, async () => {
        const [[, script]] = rewrites(src, 'failure-reported-as-success');
        const fail = { RW_FAIL: '1' };
        const [before, after, beforeOk, afterOk] = await Promise.all([run(program, src, driver(sourced), { env: fail }), run(program, script, driver(sourced), { env: fail }),
          run(program, src, driver(sourced)), run(program, script, driver(sourced))]);
        // (The meaning is kept: when the command succeeds, the rewrite runs as the original does; when it fails, it says the same.)
        assert.deepStrictEqual(afterOk, beforeOk);
        assert.deepStrictEqual(said(after), said(before));
        assert.doesNotMatch(after.out + after.err, /@syntax/);
        // (The hazard: the original's status is 0 where it is the script's or the function's, and it goes on under `set -e`.)
        const status = (r: Ran, k: string): string | undefined => new RegExp(`^@${k}=(\\d+)$`, 'm').exec(r.out)?.[1];
        if (errexit) {
          assert.match(before.out, /^@next$/m);
          assert.doesNotMatch(after.out, /^@next$/m);
          assert.strictEqual(status(after, 'run'), '1');
          // (Sourced, the file's `set -e` stops the shell that sources it, as a failure would without `||`.)
          if (sourced) assert.deepStrictEqual([status(after, 'in'), status(after, 'sourced')], [undefined, '1']);
          return;
        }
        const own = /@f=/.test(src) ? 'f' : 'run';
        assert.strictEqual(status(before, own), '0');
        assert.strictEqual(status(after, own), '1');
        // (The message is on stderr.)
        assert.match(after.err, /failed|^b$/m);
        // (Sourced, the file returns 1, and the shell that sourced it goes on.)
        if (sourced && own === 'run') assert.deepStrictEqual([status(after, 'in'), status(after, 'in-g'), status(after, 'after-g')], ['1', '1', '0']);
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const { src } of inputs) for (const [, s] of rewrites(src, 'failure-reported-as-success')) assert.deepStrictEqual(factsOf(s, 'failure-reported-as-success'), [], s);
  });
});

describe('the rewrites of `unmatched-glob-runs-once`', () => {
  const fix = (src: string, shell?: Shell): [string, string][] => rewrites(src, 'unmatched-glob-runs-once', shell);
  it('test the name first in the body, or turn on nullglob before the statement of the loop', () => {
    assert.deepStrictEqual(fix('for f in *.log; do rm "$f"; done'), [
      ['[ -e "$f" ] || continue', 'for f in *.log; do [ -e "$f" ] || continue; rm "$f"; done'],
      ['shopt -s nullglob', 'shopt -s nullglob\nfor f in *.log; do rm "$f"; done']]);
    // (On a line of its own, indented as the line it goes before; before `a &&` and after `then`, followed by `;`.)
    assert.deepStrictEqual(fix('  # c\n  a && for f in *; do\n\techo "$f"\n  done | sort'), [
      ['[ -e "$f" ] || continue', '  # c\n  a && for f in *; do\n\t[ -e "$f" ] || continue\n\techo "$f"\n  done | sort'],
      ['shopt -s nullglob', '  # c\n  shopt -s nullglob\n  a && for f in *; do\n\techo "$f"\n  done | sort']]);
    assert.deepStrictEqual(fix('if x; then for f in *; do rm "$f"; done; fi').map(([, s]) => s)[1], 'if x; then shopt -s nullglob; for f in *; do rm "$f"; done; fi');
    // (No nullglob in sh, nor before a loop that is a function's body.)
    assert.deepStrictEqual(fix('#!/bin/sh\nfor f in *.log; do rm "$f"; done', 'sh').map(([code]) => code), ['[ -e "$f" ] || continue']);
    assert.deepStrictEqual(fix('f() for x in *.txt; do echo "$x"; done\nf').map(([code]) => code), ['[ -e "$x" ] || continue']);
  });
  it('are what the note says', () => {
    const [f] = factsOf('for f in *.log; do rm "$f"; done', 'unmatched-glob-runs-once');
    assert.match(f.text, /Start the body with `\[ -e "\$f" \] \|\| continue`, or turn on `shopt -s nullglob` before the loop$/);
    const [sh] = factsOf('#!/bin/sh\nfor f in *.log; do rm "$f"; done', 'unmatched-glob-runs-once', 'sh');
    assert.match(sh.text, /Start the body with `\[ -e "\$f" \] \|\| continue`$/);
  });
  it('are not given for a body with no command, which is a syntax error', () => {
    assert.deepStrictEqual(factsOf('for f in *.log; do\ndone', 'unmatched-glob-runs-once'), []);
  });

  const inputs = ['for f in *.log; do rm "$f"; done\necho @next\n', 'for f in *.log\ndo\n  rm "$f"\n  echo "@got $f"\ndone\n', 'true && for f in *.log; do\n  rm "$f"\ndone | cat\n'];
  for (const { name, program } of programs) {
    for (const src of inputs) {
      it(`never give the loop the pattern in ${name}: ${JSON.stringify(src)}`, async () => {
        const driver = '"$BASH" -n f.sh || echo @syntax; "$BASH" f.sh; echo "@run=$?"';
        const none = await run(program, src, driver);
        const some = await run(program, src, driver, { files: ['a.log', 'b.log'] });
        assert.match(none.out, /\*\.log/);
        for (const [code, script] of fix(src)) {
          // (The meaning is kept: with files that match, the rewrite runs as the original does.)
          assert.deepStrictEqual(await run(program, script, driver, { files: ['a.log', 'b.log'] }), some, code);
          // (The hazard is gone: with none, the body never runs.)
          const after = await run(program, script, driver);
          assert.doesNotMatch(after.out + after.err, /\*\.log|@rm|@got|@syntax/, code);
          assert.match(after.out, /^@run=0$/m, code);
        }
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const src of inputs) for (const [, s] of fix(src)) assert.deepStrictEqual(factsOf(s, 'unmatched-glob-runs-once'), [], s);
  });
});
