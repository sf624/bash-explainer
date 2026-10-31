// The rewrites the catalog's facts suggest (docs/design/oracles.md, 3.2 and 3.3): each fact of a mechanical id carries
// its rewrites as data, and its text renders them. Here, for the ids that have them so far, the rewrites of hand-written
// inputs, and the rewritten scripts run in bash (5.2, and 5.3 when `$BASH_EXPLAINER_BASH53` names one) in a cgroup:
// the meaning is kept (in the state the author had in mind, the rewrite does what the original does), the hazard is
// gone (in the other states, none of its signs), the rewrite parses (`bash -n`), and explaining it raises no fact of
// the same id. Commands that would act (`cp`, `rm`, `tar`) are recorders, defined through BASH_ENV (test/support/rewrites.ts).
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { Analyzer } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
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
  it('are not carried as edits when the right side holds a here-document, whose body the group would cut off', () => {
    // (`cp a b || { echo x <<EOF⏎body⏎EOF; exit 1; }`: bash 5.2 and 5.3 say "here-document … delimited by end-of-file".)
    const [f] = factsOf('#!/bin/bash\ncp a b || echo x <<EOF\nbody\nEOF\n', 'failure-reported-as-success');
    assert.match(f.text, /To pass the failure on, write `… \|\| \{ echo x <<EOF …`$/);
    assert.strictEqual(f.rewrite, undefined);
  });
  it('are what the note says, which names how the sourced form works', () => {
    const [f] = factsOf('cp a b || { echo a\n  echo b; }', 'failure-reported-as-success');
    assert.match(f.text, /To pass the failure on, write `… \|\| \{ \{ echo a …`: it returns when the file is sourced, and exits when it is run$/);
    assert.strictEqual(f.rewrite![0].code, '{ { echo a\n  echo b >&2; }; return 1 2>/dev/null || exit 1; }');
    const ja = new Analyzer('ja').explainLine(parser.parse('cp a b || echo failed'), 0).facts![0];
    assert.match(ja.text, /失敗を伝えるには `… \|\| \{ echo failed >&2; return 1 2>\/dev\/null \|\| exit 1; \}` と書きます。ファイルが `source` で読み込まれたときは `return` で戻り、実行されたときは `exit` で終わります$/);
  });
  it('names a long command by its name, rather than cutting it in a word', () => {
    const said = (src: string): string => factsOf(`#!/bin/bash\n${src}`, 'failure-reported-as-success')[0].text.replace(/^.*? so when (.*?) fails.*?the status of (`.*?`):.*$/s, '$1 / $2');
    assert.strictEqual(said('tar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2'), '`tar` / `echo "failed" >&2`');
    assert.strictEqual(said('cp a b || echo "Backup failed: could not write the archive to the disk"'), '`cp a b` / `echo`');
    // (A short one whole; a long one with no plain name, shortened.)
    assert.strictEqual(said('cp -a src/ dst/ 2>/dev/null || echo failed'), '`cp -a src/ dst/ 2>/dev/null` / `echo failed`');
    assert.strictEqual(said('"$tool" --archive --verbose src/ dst/ || echo failed'), '`"$tool" --archive --verbose s…` / `echo failed`');
    assert.strictEqual(said('grep -q pattern file.txt | sort | head -n 1 || echo failed'), '`grep -q pattern file.txt | so…` / `echo failed`');
    // (Redirections with no command: no name either.)
    assert.strictEqual(said('>/a/very/long/path/to/some/file.log || echo failed'), '`>/a/very/long/path/to/some/fi…` / `echo failed`');
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
  it('give no test of the name where the list has words that are no globs, which it would skip too', () => {
    // (Before, `[ -e "$i" ] || continue` for `for i in a b *.c`, which skips `a` and `b`, no files.)
    assert.deepStrictEqual(fix('for i in a b *.c; do echo "$i"; done'), [['shopt -s nullglob', 'shopt -s nullglob\nfor i in a b *.c; do echo "$i"; done']]);
    assert.deepStrictEqual(fix('for i in {a,b} x{c,d} {*.c,*.h}; do :; done').map(([code]) => code), ['shopt -s nullglob']);
    assert.match(factsOf('for i in a *.c; do echo "$i"; done', 'unmatched-glob-runs-once')[0].text, /the text `\*\.c` itself\. Turn on `shopt -s nullglob` before the loop$/);
    assert.match(factsOf('for i in a *.c; do echo "$i"; done', 'unmatched-glob-runs-once', undefined, 'ja')[0].text, /という文字列がそのまま入ります。ループの前で `shopt -s nullglob` にします$/);
    // (In sh, which has no nullglob: none, and the note says only what happens.)
    const [sh] = factsOf('#!/bin/sh\nfor i in a *.c; do echo "$i"; done', 'unmatched-glob-runs-once', 'sh');
    assert.strictEqual(sh.rewrite, undefined);
    assert.match(sh.text, /the text `\*\.c` itself$/);
    assert.match(factsOf('#!/bin/sh\nfor i in a *.c; do echo "$i"; done', 'unmatched-glob-runs-once', 'sh', 'ja')[0].text, /という文字列がそのまま入ります$/);
  });
  it('say that the loop runs once in all only where the glob is the whole list', () => {
    // (Before, `for i in a b *.c` was said to run once with `i` set to `*.c`: it runs three times, the last with it.)
    const text = (src: string, lang?: 'ja'): string => factsOf(src, 'unmatched-glob-runs-once', undefined, lang)[0].text;
    assert.match(text('for f in *.log; do rm "$f"; done'), /: when no file matches `\*\.log`, the loop runs once with `f` set to the text `\*\.log` itself\. Start/);
    assert.match(text('for f in *.log; do rm "$f"; done', 'ja'), /`\*\.log` に一致するファイルが1つもないと、`f` に `\*\.log` という文字列がそのまま入って1回実行されます。本体の先頭に/);
    const src = 'for i in a b *.c; do echo "$i"; done';
    assert.match(text(src), /: when no file matches `\*\.c`, the loop still runs once for it, with `i` set to the text `\*\.c` itself\. Turn on/);
    assert.match(text(src, 'ja'), /: `\*\.c` に一致するファイルが1つもなくても、その分の1回は実行され、`i` には `\*\.c` という文字列がそのまま入ります。ループの前で/);
  });
  it('say the patterns that braces make, each of which the loop gets as text when nothing matches it', () => {
    // (Before, `for i in *.{c,h}` was said to run once with `i` set to `*.{c,h}`: bash expands the braces first, and
    // runs the loop with `*.c`, then `*.h`.)
    const text = (src: string, lang?: 'ja'): string => factsOf(src, 'unmatched-glob-runs-once', undefined, lang)[0].text;
    assert.match(text('for i in *.{c,h}; do echo "$i"; done'), /: `\*\.\{c,h\}` gives the patterns `\*\.c` and `\*\.h` before files are matched; for each that no file matches, the loop still runs once, with `i` set to its text itself\. Start the body with `\[ -e "\$i" \] \|\| continue`, or turn on/);
    assert.match(text('for i in *.{c,h}; do echo "$i"; done', 'ja'), /: `\*\.\{c,h\}` はファイルと照合する前に `\*\.c`・`\*\.h` になります。そのうち一致するファイルが1つもないものについても1回ずつ実行され、`i` にはその文字列がそのまま入ります。本体の先頭に/);
    assert.match(text('for i in ./{a,b,c}*.c; do echo "$i"; done'), /the patterns `\.\/a\*\.c`, `\.\/b\*\.c` and `\.\/c\*\.c` before/);
    // (A word the braces make that is no glob, which the test of the name would skip: no such test.)
    assert.match(text('for i in {a,*.c}; do echo "$i"; done'), /: when no file matches `\*\.c`, the loop still runs once for it, with `i` set to the text `\*\.c` itself\. Turn on/);
    assert.deepStrictEqual(fix('for i in {a,*.c}; do echo "$i"; done').map(([code]) => code), ['shopt -s nullglob']);
    // (The text the variable gets is the word's after the expansions and quote removal.)
    assert.match(text('x=a; for f in ${x}*.c; do echo "$f"; done'), /: when no file matches `\$\{x\}\*\.c`, the loop runs once with `f` set to the text `a\*\.c` itself/);
    assert.match(text('x="*.c *.h"; for f in $x; do echo "$f"; done'), /: `\$x` gives the patterns `\*\.c` and `\*\.h` before files are matched; for each that no file matches, the loop still runs once, with `f` set to its text itself\. Start/);
  });
  it('count the patterns of the braces where a value is not known, and name them as written', () => {
    // (Before, `for i in "$d"/*.{c,h}` was said to run once for `"$d"/*.{c,h}`, with that text: bash expands the
    // braces before `$d`, and runs the loop twice, with `sub/*.c` and `sub/*.h` where `d=sub`.)
    const text = (src: string, lang?: 'ja'): string => factsOf(src, 'unmatched-glob-runs-once', undefined, lang)[0].text;
    for (const [src, w] of [['for i in "$d"/*.{c,h}; do echo "$i"; done', '"\\$d"'], ['for i in $d/*.{c,h}; do echo "$i"; done', '\\$d'], ['for i in ~u/*.{c,h}; do echo "$i"; done', '~u']]) {
      assert.match(text(src), new RegExp(`: \`${w}/\\*\\.\\{c,h\\}\` gives the patterns \`${w}/\\*\\.c\` and \`${w}/\\*\\.h\` before files are matched; for each that no file matches, the loop still runs once, with \`i\` set to its text itself, after its expansions\\. Start the body with \`\\[ -e "\\$i" \\] \\|\\| continue\`, or turn on`), src);
      assert.match(text(src, 'ja'), new RegExp(`: \`${w}/\\*\\.\\{c,h\\}\` はファイルと照合する前に \`${w}/\\*\\.c\`・\`${w}/\\*\\.h\` になります。そのうち一致するファイルが1つもないものについても1回ずつ実行され、\`i\` には展開後のその文字列がそのまま入ります。本体の先頭に`), src);
    }
    // (Where the value is known, the patterns are named by their text.)
    assert.match(text('d=sub; for i in "$d"/*.{c,h}; do echo "$i"; done'), /: `"\$d"\/\*\.\{c,h\}` gives the patterns `sub\/\*\.c` and `sub\/\*\.h` before files are matched; for each that no file matches, the loop still runs once, with `i` set to its text itself\. Start/);
    // (But as written where the text reads otherwise as a pattern: the `*` of `$d` is quoted.)
    assert.match(text('d="a*b"; for i in "$d"/*.{c,h}; do echo "$i"; done'), /the patterns `"\$d"\/\*\.c` and `"\$d"\/\*\.h` before files are matched; for each that no file matches, the loop still runs once, with `i` set to its text itself\. Start/);
    assert.match(text('d="a*b"; for i in "$d"/*.c; do echo "$i"; done'), /: when no file matches `"\$d"\/\*\.c`, the loop runs once with `i` set to the text `a\*b\/\*\.c` itself\. Start/);
    for (const src of ['for f in "$d"/*.c; do echo "$f"; done', 'for f in ~u/*.c; do echo "$f"; done']) {
      assert.match(text(src), /, the loop runs once with `f` set to the text of the pattern itself, after its expansions\. Start the body with/, src);
      assert.match(text(src, 'ja'), /に一致するファイルが1つもないと、`f` に展開後のパターンの文字列がそのまま入って1回実行されます。本体の先頭に/, src);
    }
    // (A word not known here is no pattern, but may be one or give more words: no test of the name.)
    for (const src of ['for f in "$d" *.c; do echo "$f"; done', 'for f in $x *.c; do echo "$f"; done']) {
      assert.match(text(src), /: when no file matches `\*\.c`, the loop still runs once for it, with `f` set to the text `\*\.c` itself\. Turn on/, src);
      assert.deepStrictEqual(fix(src).map(([code]) => code), ['shopt -s nullglob'], src);
    }
    // (Nor is a word whose braces are not known here, nor a value split into a word and a pattern.)
    for (const src of ['if a; then set +B; fi; for f in {a,b} *.c; do echo "$f"; done', 'x="a *.c"; for f in $x; do echo "$f"; done']) {
      assert.match(text(src), /: when no file matches `\*\.c`, the loop still runs once for it, with `f` set to the text `\*\.c` itself\. Turn on/, src);
      assert.deepStrictEqual(fix(src).map(([code]) => code), ['shopt -s nullglob'], src);
    }
    assert.match(text('for f in "$d"/*.c a; do echo "$f"; done', 'ja'), /: `"\$d"\/\*\.c` に一致するファイルが1つもなくても、その分の1回は実行され、`f` には展開後のパターンの文字列がそのまま入ります。ループの前で/);
  });
  it('count a pattern where IFS is not known, whichever way bash quotes its glob characters', () => {
    // (With an IFS not known, bash may take the `*` of `$dir/*.log` as itself, or as a wildcard: either way, where no
    // file matches, the loop runs once with the text, in bash 5.2 and 5.3.)
    for (const b of ['bash', ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])]) {
      for (const ifs of [',', '*']) {
        const out = execFileSync(b, ['-c', `cd /; OLDIFS=$IFS; IFS='${ifs}'; read -r a b <<< "$1"; IFS=$OLDIFS; dir=nodir; for x in $dir/*.log; do echo "iter <$x>"; done; IFS='${ifs}'; for x in $dir/*.log; do echo "iter <$x>"; done`, '_', 'a,b']).toString();
        assert.strictEqual(out, 'iter <nodir/*.log>\niter <nodir/*.log>\n', `${b}: ${ifs}`);
      }
    }
    const text = (src: string): string => factsOf(src, 'unmatched-glob-runs-once')[0].text;
    for (const src of ['OLDIFS=$IFS; IFS=,; read -r a b <<< "$1"; IFS=$OLDIFS\nfor x in $dir/*.log; do echo "$x"; done', 'f() {\n  for x in $dir/*.log; do echo "$x"; done\n}\nIFS=,']) {
      assert.match(text(src), /: when no file matches `\$dir\/\*\.log`, the loop runs once with `x` set to the text of the pattern itself, after its expansions\. Start the body with `\[ -e "\$x" \] \|\| continue`/, src);
    }
  });
  it('take a quoted glob character as no pattern', () => {
    // (Before, `for i in {"*",*.c}` called `*` a pattern too, and the test of the name skipped it: bash passes `*`
    // always. And `for f in {"*",y}.c` had the note, with no pattern at all.)
    const [f] = factsOf('for i in {"*",*.c}; do echo "$i"; done', 'unmatched-glob-runs-once');
    assert.match(f.text, /: when no file matches `\*\.c`, the loop still runs once for it, with `i` set to the text `\*\.c` itself\. Turn on `shopt -s nullglob` before the loop$/);
    assert.deepStrictEqual(fix('for i in {"*",*.c}; do echo "$i"; done').map(([code]) => code), ['shopt -s nullglob']);
    assert.match(factsOf('for i in {"*",*.c}; do echo "$i"; done', 'unmatched-glob-runs-once', undefined, 'ja')[0].text, /: `\*\.c` に一致するファイルが1つもなくても、その分の1回は実行され、`i` には `\*\.c` という文字列がそのまま入ります。ループの前で `shopt -s nullglob` にします$/);
    // (No pattern: none quoted, none with `set -f`, nor where bash fails on the word or the braces are not known.)
    for (const src of ['for f in {"*",y}.c; do echo "$f"; done', 'for f in "*".c \'?\' \\*; do echo "$f"; done', 'set -f; for f in "$d"/*.c *.h; do echo "$f"; done',
      'unset x; for f in ${x:?}*.c; do echo "$f"; done', 'if a; then set +B; fi; for f in *.{c,h}; do echo "$f"; done', 'for f in $(ls); do echo "$f"; done']) {
      assert.deepStrictEqual(factsOf(src, 'unmatched-glob-runs-once'), [], src);
    }
  });
  it('count a part that may give several words as several, and offer no test of the name there', () => {
    // (Before, `for i in "${a[@]}"*.c` was said to run once, with `i` set to the pattern's text, and the test of the
    // name was offered: with `a=(x y)`, bash runs it twice, over `x` and `y*.c`, and the test would skip `x`.)
    const text = (src: string, lang?: 'ja'): string => factsOf(src, 'unmatched-glob-runs-once', undefined, lang)[0].text;
    for (const src of ['a=(x y); for i in "${a[@]}"*.c; do echo "$i"; done', 'for i in "${a[@]}"*.c; do echo "$i"; done', 'for i in "$@"/*.c; do echo "$i"; done',
      'for i in $@*.c; do echo "$i"; done', 'for i in "${!a[@]}"*.c; do echo "$i"; done', 'for i in "${!BASH_V@}"*.c; do echo "$i"; done', 'for i in ${a[*]}*.c; do echo "$i"; done',
      'for i in "${a[@]#x}"*.c; do echo "$i"; done', 'for i in "${@:2}"*.c; do echo "$i"; done', 'for i in *.c"$@"; do echo "$i"; done', 'for i in x${y:-"$@"}*.c; do echo "$i"; done',
      'a=(x y); x=\'a[@]\'; for i in "${!x}"*.c; do echo "$i"; done', 'a=(x y); declare -n r=\'a[@]\'; for i in "$r"*.c; do echo "$i"; done',
      'a=(x y); declare -n q=\'a[@]\'; declare -n r=q; for i in "$r"*.c; do echo "$i"; done', 'source ./f.sh; for i in "$r"*.c; do echo "$i"; done',
      'a=(x y); declare -n r=\'a[*]\'; for i in $r*.c; do echo "$i"; done', 'declare -n r=$1; for i in "$r"*.c; do echo "$i"; done', 'a=(x y); x=\'a[@]\'; for i in "${!x:-z}"*.c; do echo "$i"; done', 'for i in "${!b[0]}"*.c; do echo "$i"; done']) {
      const w = /in (\S+);/.exec(src)![1].replace(/[$*.?(){}[\]|\\^+]/g, '\\$&');
      assert.match(text(src), new RegExp(`: \`${w}\` may give several words before files are matched; for each of them that is a pattern and that no file matches, the loop still runs once, with \`i\` set to its text itself, after its expansions\\. Turn on \`shopt -s nullglob\` before the loop$`), src);
      assert.match(text(src, 'ja'), new RegExp(`: \`${w}\` はファイルと照合する前に複数の単語になることがあります。そのうちパターンで、一致するファイルが1つもないものについても1回ずつ実行され、\`i\` には展開後のその文字列がそのまま入ります。ループの前で \`shopt -s nullglob\` にします$`), src);
      assert.deepStrictEqual(fix(src).map(([code]) => code), ['shopt -s nullglob'], src);
    }
    assert.match(text('for i in "$@"*.{c,h}; do echo "$i"; done'), /: `"\$@"\*\.\{c,h\}` gives `"\$@"\*\.c` and `"\$@"\*\.h`, each of which may give several words before files are matched; for each of them that is a pattern and that no file matches, the loop still runs once/);
    assert.match(text('for i in "$@"*.{c,h}; do echo "$i"; done', 'ja'), /: `"\$@"\*\.\{c,h\}` は `"\$@"\*\.c`・`"\$@"\*\.h` になり、それぞれファイルと照合する前に複数の単語になることがあります。/);
    // (A word that is only such a part is no pattern, but may give several words: no test of the name.)
    assert.match(text('for i in "$@" *.c; do echo "$i"; done'), /: when no file matches `\*\.c`, the loop still runs once for it, with `i` set to the text `\*\.c` itself\. Turn on `shopt -s nullglob` before the loop$/);
    assert.deepStrictEqual(fix('for i in "$@" *.c; do echo "$i"; done').map(([code]) => code), ['shopt -s nullglob']);
    // (One word: `"$*"`, `"${a[*]}"`, a count, a nameref to a name, the output of a command substitution.)
    for (const src of ['for i in "$*"*.c; do echo "$i"; done', 'for i in "${a[*]}"*.c; do echo "$i"; done', 'for i in "${!a[*]}"*.c; do echo "$i"; done',
      'for i in "${#a[@]}"*.c; do echo "$i"; done', 'declare -n r=a; for i in "$r"*.c; do echo "$i"; done', 'for i in "$(echo "$@")"*.c; do echo "$i"; done',
      'a=(x y); declare -n r=\'a[*]\'; for i in "$r"*.c; do echo "$i"; done', 'declare -n q=p; declare -n p=q; for i in "$p"*.c; do echo "$i"; done',
      'for i in "$((x))"*.c; do echo "$i"; done', 'for i in ${x:-<(echo "$@")}*.c; do echo "$i"; done', 'd=$(cat f); for i in "$d"*.c; do echo "$i"; done']) {
      assert.match(text(src), /, the loop runs once with `i` set to the text of the pattern itself, after its expansions\. Start the body with `\[ -e "\$i" \] \|\| continue`/, src);
    }
  });
  it('say what `select` does with a pattern that matches nothing, and offer only nullglob', () => {
    // (Before, `select i in *.c` was said to run once with `i` set to `*.c`: the menu shows `*.c` as an entry.)
    const text = (src: string, lang?: 'ja'): string => factsOf(src, 'unmatched-glob-runs-once', undefined, lang)[0].text;
    assert.match(text('select i in *.c; do echo "$i"; done'), /: when no file matches `\*\.c`, the menu still shows it as an entry, and choosing it sets `i` to the text `\*\.c` itself\. Turn on `shopt -s nullglob` before the loop$/);
    assert.match(text('select i in *.c; do echo "$i"; done', 'ja'), /: `\*\.c` に一致するファイルが1つもなくても、メニューには項目として表示され、それを選ぶと `i` に `\*\.c` という文字列がそのまま入ります。ループの前で `shopt -s nullglob` にします$/);
    assert.match(text('select i in *.{c,h}; do echo "$i"; done'), /: `\*\.\{c,h\}` gives the patterns `\*\.c` and `\*\.h` before files are matched; each that no file matches is still shown in the menu, and choosing it sets `i` to its text itself\. Turn on/);
    assert.match(text('select i in *.{c,h}; do echo "$i"; done', 'ja'), /: `\*\.\{c,h\}` はファイルと照合する前に `\*\.c`・`\*\.h` になります。そのうち一致するファイルが1つもないものもメニューに表示され、それを選ぶと `i` にはその文字列がそのまま入ります。ループの前で/);
    assert.match(text('select i in "$d"/*.c; do echo "$i"; done'), /, the menu still shows it as an entry, and choosing it sets `i` to the text of the pattern itself, after its expansions\. Turn on/);
    assert.match(text('select i in "$@"*.c; do echo "$i"; done'), /: `"\$@"\*\.c` may give several words before files are matched; each of them that is a pattern and that no file matches is still shown in the menu, and choosing it sets `i` to its text itself, after its expansions\. Turn on/);
    assert.match(text('select i in "$@"*.c; do echo "$i"; done', 'ja'), /そのうちパターンで、一致するファイルが1つもないものもメニューに表示され、それを選ぶと `i` には展開後のその文字列がそのまま入ります。ループの前で/);
    for (const src of ['select i in *.c; do echo "$i"; done', 'select i in "$d"/*.c; do echo "$i"; done']) {
      assert.deepStrictEqual(fix(src).map(([code]) => code), ['shopt -s nullglob'], src);
    }
  });
  for (const { name, program } of programs) {
    it(`run the loop over each word of a part that gives several, in ${name}`, async () => {
      const driver = '"$BASH" f.sh';
      for (const [src, none, matched] of [['a=(x y); for i in "${a[@]}"*.c; do echo "@$i"; done\n', '@x\n@y*.c\n', '@x\n@y1.c\n'],
        ['set -- x y; for i in "$@"*.c; do echo "@$i"; done\n', '@x\n@y*.c\n', '@x\n@y1.c\n'], ['set -- x y; for i in $@*.c; do echo "@$i"; done\n', '@x\n@y*.c\n', '@x\n@y1.c\n'],
        ['a=(x y); for i in "${!a[@]}"*.c; do echo "@$i"; done\n', '@0\n@1*.c\n', '@0\n@11.c\n'], ['a=(x y); x=\'a[@]\'; for i in "${!x}"*.c; do echo "@$i"; done\n', '@x\n@y*.c\n', '@x\n@y1.c\n'],
        ['a=(x y); declare -n r=\'a[@]\'; for i in "$r"*.c; do echo "@$i"; done\n', '@x\n@y*.c\n', '@x\n@y1.c\n'],
        ['a=(x y); declare -n r=\'a[*]\'; for i in $r*.c; do echo "@$i"; done\n', '@x\n@y*.c\n', '@x\n@y1.c\n'], ['a=(x y); x=\'a[@]\'; for i in "${!x:-z}"*.c; do echo "@$i"; done\n', '@x\n@y*.c\n', '@x\n@y1.c\n']]) {
        assert.match(factsOf(src, 'unmatched-glob-runs-once')[0].text, /may give several words before files are matched/, src);
        assert.strictEqual((await run(program, src, driver)).out, none, src);
        assert.strictEqual((await run(program, src, driver, { files: ['y1.c', '11.c'] })).out, matched, src);
        // (nullglob drops only the pattern that matches nothing; the test of the name, not offered, would drop `x` too.)
        const [[, script]] = fix(src);
        assert.strictEqual((await run(program, script, driver)).out, none.split('\n')[0] + '\n', script);
        assert.strictEqual((await run(program, script, driver, { files: ['y1.c', '11.c'] })).out, matched, script);
        assert.strictEqual((await run(program, src.replace('do echo', 'do [ -e "$i" ] || continue; echo'), driver)).out, '', src);
      }
      // (One word, `x y*.c`: the loop runs once, and the test of the name that the note offers skips it.)
      const one = 'set -- x y; for i in "$*"*.c; do echo "@$i"; done\n';
      assert.strictEqual((await run(program, one, driver)).out, '@x y*.c\n');
      const [[code, test]] = fix(one);
      assert.strictEqual(code, '[ -e "$i" ] || continue');
      assert.strictEqual((await run(program, test, driver)).out, '');
      assert.strictEqual((await run(program, test, driver, { files: ['x y1.c'] })).out, '@x y1.c\n');
    });
    it(`show a pattern that matches nothing as an entry of the menu of select, in ${name}`, async () => {
      const src = 'select i in *.c; do echo "@$i"; break; done\n';
      const ran = await run(program, src, 'echo 1 | "$BASH" f.sh');
      assert.deepStrictEqual([ran.out, ran.err.includes('1) *.c\n')], ['@*.c\n', true]);
      assert.strictEqual((await run(program, 'select i in *.{c,h}; do echo "@$i"; break; done\n', 'echo 2 | "$BASH" f.sh')).out, '@*.h\n');
      assert.strictEqual((await run(program, src, 'echo 1 | "$BASH" f.sh', { files: ['x.c'] })).out, '@x.c\n');
      // (With nullglob, the menu leaves the pattern out; with no entry, `select` runs nothing.)
      const [[, script]] = fix(src);
      assert.deepStrictEqual(await run(program, script, 'echo 1 | "$BASH" f.sh'), { out: '', err: '', status: 0 });
      assert.strictEqual((await run(program, script, 'echo 1 | "$BASH" f.sh', { files: ['x.c'] })).out, '@x.c\n');
    });
    it(`give the loop each pattern that braces make, as its note says, in ${name}`, async () => {
      const driver = '"$BASH" f.sh';
      for (const [src, none] of [['for i in *.{c,h}; do echo "@$i"; done\n', '@*.c\n@*.h\n'], ['for i in {a,b}*.c; do echo "@$i"; done\n', '@a*.c\n@b*.c\n'],
        ['d=sub; for i in "$d"/*.{c,h}; do echo "@$i"; done\n', '@sub/*.c\n@sub/*.h\n']]) {
        assert.strictEqual((await run(program, src, driver, { files: ['sub/'] })).out, none, src);
        const said = [...factsOf(src, 'unmatched-glob-runs-once')[0].text.matchAll(/`([^`]*)`/g)].slice(1, 3).map((m) => `@${m[1]}\n`).join('');
        assert.strictEqual(said, none, src);
        const [[code, script]] = fix(src);
        assert.strictEqual(code, '[ -e "$i" ] || continue');
        assert.strictEqual((await run(program, script, driver, { files: ['sub/'] })).out, '', script);
      }
      const src = 'for i in *.{c,h}; do echo "@$i"; done\n';
      assert.strictEqual((await run(program, src, driver, { files: ['x.c'] })).out, '@x.c\n@*.h\n');
      assert.strictEqual((await run(program, fix(src)[0][1], driver, { files: ['x.c'] })).out, '@x.c\n');
    });
    it(`run the loop once for each pattern of the braces where the value is not known, in ${name}`, async () => {
      // (`$d` comes from the environment: the note counts two patterns, `"$d"/*.c` and `"$d"/*.h`.)
      const driver = '"$BASH" f.sh';
      for (const src of ['for i in "$d"/*.{c,h}; do echo "@$i"; done\n', 'for i in $d/*.{c,h}; do echo "@$i"; done\n']) {
        const env = { d: 'sub' };
        assert.match(factsOf(src, 'unmatched-glob-runs-once')[0].text, /gives the patterns `"?\$d"?\/\*\.c` and `"?\$d"?\/\*\.h` before files are matched/, src);
        assert.strictEqual((await run(program, src, driver, { env, files: ['sub/'] })).out, '@sub/*.c\n@sub/*.h\n', src);
        assert.strictEqual((await run(program, src, driver, { env, files: ['sub/x.c'] })).out, '@sub/x.c\n@sub/*.h\n', src);
        const [[code, test], [, nullglob]] = fix(src);
        assert.strictEqual(code, '[ -e "$i" ] || continue');
        for (const script of [test, nullglob]) {
          assert.strictEqual((await run(program, script, driver, { env, files: ['sub/'] })).out, '', script);
          assert.strictEqual((await run(program, script, driver, { env, files: ['sub/x.c'] })).out, '@sub/x.c\n', script);
        }
      }
    });
    it(`keep a quoted glob character as the text it is, in ${name}`, async () => {
      const driver = '"$BASH" f.sh';
      const src = 'for i in {"*",*.c}; do echo "@$i"; done\n';
      assert.strictEqual((await run(program, src, driver)).out, '@*\n@*.c\n');
      assert.strictEqual((await run(program, src, driver, { files: ['x.c'] })).out, '@*\n@x.c\n');
      // (nullglob leaves the `*` that is no pattern; the test of the name, which the note does not give, would skip it.)
      const [[, script]] = fix(src);
      assert.strictEqual((await run(program, script, driver)).out, '@*\n');
      assert.strictEqual((await run(program, script, driver, { files: ['x.c'] })).out, '@*\n@x.c\n');
      assert.strictEqual((await run(program, src.replace('do echo', 'do [ -e "$i" ] || continue; echo'), driver, { files: ['x.c'] })).out, '@x.c\n');
      // (No pattern, no note: the loop gets its words whatever the files.)
      const plain = 'for f in {"*",y}.c; do echo "@$f"; done\n';
      for (const files of [[], ['x.c', 'y.c']]) assert.strictEqual((await run(program, plain, driver, { files })).out, '@*.c\n@y.c\n');
    });
    it(`keep the other words of the list in ${name}`, async () => {
      const src = 'for i in a b *.c; do echo "@$i"; done\n';
      const driver = '"$BASH" f.sh';
      const [[, script]] = fix(src);
      assert.strictEqual((await run(program, src, driver, { files: ['x.c'] })).out, '@a\n@b\n@x.c\n');
      assert.strictEqual((await run(program, script, driver, { files: ['x.c'] })).out, '@a\n@b\n@x.c\n');
      assert.strictEqual((await run(program, script, driver)).out, '@a\n@b\n');
      // (With no file, the original runs three times, the last with the text of the glob, as its note says.)
      assert.strictEqual((await run(program, src, driver)).out, '@a\n@b\n@*.c\n');
      // (What the test of the name would do: skip `a` and `b`.)
      assert.strictEqual((await run(program, src.replace('do echo', 'do [ -e "$i" ] || continue; echo'), driver, { files: ['x.c'] })).out, '@x.c\n');
    });
  }
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

describe('the rewrites in a host file', () => {
  // (Their edits would be offsets in the extracted shell text, and their code in its syntax: `${MSG}` for make's
  // `$(MSG)`, `$f` for `$$f`; a new line in a `RUN` that a backslash continues ends the instruction.)
  const facts = (file: string, src: string, line: number) => {
    const extracted = extractShell(hostKind('', file)!, src);
    return (explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, src.split('\n'), line, 'en')?.facts ?? [])
      .filter((f) => f.id === 'failure-reported-as-success' || f.id === 'unmatched-glob-runs-once');
  };
  it('are not carried by the facts: in a Dockerfile, a workflow, a Makefile', () => {
    const cases: [string, string, number, string][] = [
      ['Dockerfile', 'FROM debian\nRUN cp a b || echo "x"\n', 1, 'failure-reported-as-success'],
      ['Dockerfile', 'FROM debian\nRUN set -e; \\\n    for f in *.log; do rm "$f"; done\n', 2, 'unmatched-glob-runs-once'],
      ['.github/workflows/ci.yml', 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          cp a b || echo "x"\n', 6, 'failure-reported-as-success'],
      ['Makefile', 'MSG = hi\nall:\n\tfor f in *.log; do rm "$$f"; done\n\tcp a b || echo "$(MSG)"\n', 2, 'unmatched-glob-runs-once'],
      ['Makefile', 'MSG = hi\nall:\n\tfor f in *.log; do rm "$$f"; done\n\tcp a b || echo "$(MSG)"\n', 3, 'failure-reported-as-success'],
    ];
    for (const [file, src, line, id] of cases) {
      const found = facts(file, src, line);
      assert.deepStrictEqual(found.map((f) => [f.id, f.rewrite]), [[id, undefined]], `${file}: ${src}`);
    }
    // (The note still says the fix, in the file's own syntax where the host replaced it: `$(MSG)`.)
    assert.match(facts('Makefile', 'MSG = hi\nall:\n\tcp a b || echo "$(MSG)"\n', 2)[0].text, /`… \|\| \{ echo "\$\(MSG\)" >&2; exit 1; \}`$/);
  });
});
