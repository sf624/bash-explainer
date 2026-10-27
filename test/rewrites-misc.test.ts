// The rewrites of `wrapper-assignment-expanded-first`, `unbraced-element`, `regex-backslash-dropped` and
// `bracket-close-glued` (docs/design/oracles.md, 3.1 and step 4): exact rewrites of hand-written inputs, the notes
// rendered from them, and the rewritten scripts run in bash (5.2, and 5.3 when `$BASH_EXPLAINER_BASH53` names one), in
// a cgroup, as test/rewrites.test.ts does: the meaning is kept, the hazard is gone, the rewrite parses, and explaining
// it raises no fact of the same id. `sudo` is a stand-in that runs its command through `env`.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { FactId } from '../src/messages';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { factsOf, programs, RECORDERS, rewrites, run } from './support/rewrites';

const parser = createUnbashParser();
const fix = (src: string, id: FactId): string[] => rewrites(src, id).map(([, s]) => s);
const codes = (src: string, id: FactId): string[] => rewrites(src, id).map(([c]) => c);
const SYNTAX = '"$BASH" -n f.sh || echo @syntax; ';

describe('the rewrite of `wrapper-assignment-expanded-first`', () => {
  const ID = 'wrapper-assignment-expanded-first';
  it('puts the command and its arguments in the string of `sh -c`', () => {
    assert.deepStrictEqual(rewrites('sudo v=1 echo got $v', ID), [["sh -c 'echo got $v'", "sudo v=1 sh -c 'echo got $v'"]]);
    // (Quotes inside the string are made safe; the quotes the author wrote stay as they are; `${v}` is the same variable.)
    assert.deepStrictEqual(fix("sudo v=1 printf '%s|' \"a b\" \"${v}\"\necho x", ID), ["sudo v=1 sh -c 'printf '\\''%s|'\\'' \"a b\" \"${v}\"'\necho x"]);
    assert.deepStrictEqual(fix('f() {\n  sudo -E v=1 cmd ${v}x\n}', ID), ["f() {\n  sudo -E v=1 sh -c 'cmd ${v}x'\n}"]);
  });
  it('is said, but not carried as edits, where the string would be expanded by another shell than this one', () => {
    // (`$HOME` and `$(…)` are expanded here now; in the string, the new shell would expand them.)
    for (const src of ['sudo v=1 echo $v $HOME', 'sudo v=1 echo $v $(date)', 'sudo v=1 echo `date` $v', 'sudo v=1 echo ${v:-x}']) {
      const [f] = factsOf(src, ID);
      assert.strictEqual(f.rewrite, undefined, src);
      assert.match(f.text, /go through a shell: `sudo v=… sh -c '.*'`$/, src);
    }
    // (And in a string another command reads as a script, where the code would need quoting.)
    const [g] = factsOf("bash -c 'sudo v=1 echo got $v'", ID);
    assert.strictEqual(g.rewrite, undefined);
    assert.match(g.text, /go through a shell: `sudo v=… sh -c 'echo got \$v'`$/);
  });
  it('is what the note says', () => {
    assert.match(factsOf('sudo v=1 echo got $v', ID)[0].text, /go through a shell: `sudo v=… sh -c 'echo got \$v'`$/);
    const ja = new Analyzer('ja').explainLine(parser.parse('sudo v=1 echo got $v'), 0).facts!.find((f) => f.id === ID)!;
    assert.match(ja.text, /設定した値を使うなら `sudo v=… sh -c 'echo got \$v'` のようにシェル経由にします$/);
  });

  const inputs = ['echo got $v', 'echo got "$v"', "printf '%s|' \"a b\" $v"].map((c) => `sudo v=1 ${c}\n`);
  const states = [['v unset', 'unset v\n'], ['v set before', 'v=old\n']];
  for (const { name, program } of programs) {
    for (const cmd of inputs) {
      it(`gives the command the value the wrapper sets in ${name}: ${JSON.stringify(cmd)}`, async () => {
        const recorders = `${RECORDERS}sudo() { env "$@"; }\n`;
        const driver = `${SYNTAX}"$BASH" f.sh`;
        const rewritten = fix(cmd, ID)[0];
        // (The meaning is kept: where `v` is 1 already, the rewrite does what the original does.)
        assert.deepStrictEqual(await run(program, `v=1\n${rewritten}`, driver, { recorders }), await run(program, `v=1\n${cmd}`, driver, { recorders }));
        for (const [state, prefix] of states) {
          const before = await run(program, prefix + cmd, driver, { recorders });
          const after = await run(program, prefix + rewritten, driver, { recorders });
          // (The hazard: the original sees what `v` is here; the rewrite, what the wrapper sets.)
          assert.doesNotMatch(before.out, /(^|[\s|])1(\||$)/m, state);
          assert.match(after.out, /(^|[\s|])1(\||$)/m, state);
          assert.doesNotMatch(after.out + after.err, /old|@syntax/, state);
        }
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const cmd of inputs) assert.deepStrictEqual(factsOf(fix(cmd, ID)[0], ID), [], cmd);
  });
});

describe('the rewrite of `unbraced-element`', () => {
  const ID = 'unbraced-element';
  it('puts the name and the subscript in braces', () => {
    assert.deepStrictEqual(rewrites('a=(x y)\necho $a[1]', ID), [['${a[1]}', 'a=(x y)\necho ${a[1]}']]);
    assert.deepStrictEqual(fix('a=(x y)\necho "pre $a[1]post"', ID), ['a=(x y)\necho "pre ${a[1]}post"']);
    assert.deepStrictEqual(fix('declare -A m=([k]=v)\necho $m[k]', ID), ['declare -A m=([k]=v)\necho ${m[k]}']);
    assert.deepStrictEqual(fix('a=(x y)\necho $a[@]', ID), ['a=(x y)\necho ${a[@]}']);
  });
  it('is said, but not carried as edits, in a string another command reads as a script', () => {
    const [f] = factsOf("bash -c 'a=(x y); echo $a[1]'", ID);
    assert.strictEqual(f.rewrite, undefined);
    assert.match(f.text, /For the element, write `\$\{a\[1\]\}` with braces$/);
  });
  it('is what the note says', () => {
    assert.match(factsOf('a=(x y)\necho $a[1]', ID)[0].text, /\(a glob too, here\)\. For the element, write `\$\{a\[1\]\}` with braces$/);
    assert.match(factsOf('a=(x y)\necho "$a[1]"', ID)[0].text, /^⚠ Pitfall: `\$a\[1\]` is not an element of the array: it is `\$a` \(that is `\$\{a\[0\]\}`\) followed by the text `\[1\]`\. For the element, write `\$\{a\[1\]\}` with braces$/);
    const ja = new Analyzer('ja').explainLine(parser.parse('a=(x y)\necho $a[1]'), 1).facts!.find((f) => f.id === ID)!;
    assert.match(ja.text, /要素は `\$\{a\[1\]\}` と波かっこで囲んで書きます$/);
  });

  // (Each with the file its unquoted `$a[1]` matches as a glob, if any.)
  const inputs: [src: string, want: string, glob?: string][] = [['a=(x y)\necho $a[1]\n', 'y', 'x1'], ['a=(x y)\necho "$a[1]"\n', 'y'], ['a=(x y)\necho pre$a[1]post\n', 'preypost', 'prex1post'],
    ['declare -A m=([k]=v)\necho $m[k]\n', 'v', 'k']];
  for (const { name, program } of programs) {
    for (const [src, want, glob] of inputs) {
      it(`give the element, not \`$a\` and the text, in ${name}: ${JSON.stringify(src)}`, async () => {
        const driver = `${SYNTAX}"$BASH" f.sh`;
        const [[, script]] = rewrites(src, ID);
        // (With files that match `$a[1]` as a glob, and with none: the original prints the first element and the text, or a file; the rewrite, the element.)
        for (const files of [[], ...(glob ? [[glob]] : [])]) {
          const before = await run(program, src, driver, { files });
          const after = await run(program, script, driver, { files });
          assert.strictEqual(after.out.trim(), want, `${files}`);
          assert.notStrictEqual(before.out, after.out, `${files}`);
          assert.doesNotMatch(after.out + after.err, /@syntax|\[/, `${files}`);
        }
        assert.match((await run(program, src, driver)).out, /\[/);
        if (glob) assert.strictEqual((await run(program, src, driver, { files: [glob] })).out.trim(), glob);
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const [src] of inputs) assert.deepStrictEqual(factsOf(fix(src, ID)[0], ID), [], src);
  });
});

describe('the rewrite of `regex-backslash-dropped`', () => {
  const ID = 'regex-backslash-dropped';
  it('keeps the regex in a variable, before the statement that holds the test', () => {
    assert.deepStrictEqual(rewrites('[[ $x =~ \\bfoo ]] && echo yes', ID), [["re='\\bfoo'; [[ $x =~ $re ]]", "re='\\bfoo'\n[[ $x =~ $re ]] && echo yes"]]);
    // (Before the whole `if`, `while`, pipeline or function without braces the test is part of, indented as it is; inside a block, in the block.)
    assert.deepStrictEqual(fix('if a; then\n  :\nelif [[ $x =~ \\bz ]]; then\n  :\nfi', ID), ["re='\\bz'\nif a; then\n  :\nelif [[ $x =~ $re ]]; then\n  :\nfi"]);
    assert.deepStrictEqual(fix('# c\n  while [[ $x =~ \\bz ]]; do :; done | cat', ID), ["# c\n  re='\\bz'\n  while [[ $x =~ $re ]]; do :; done | cat"]);
    assert.deepStrictEqual(fix('f() {\n  a && [[ $x =~ \\<z ]]\n}', ID), ["f() {\n  re='\\<z'\n  a && [[ $x =~ $re ]]\n}"]);
    assert.deepStrictEqual(fix('f() [[ $x =~ \\bz ]]', ID), ["re='\\bz'\nf() [[ $x =~ $re ]]"]);
    // (Quoted parts of the right side stay where they are; a quote in the regex is escaped.)
    assert.deepStrictEqual(rewrites('[[ "$x" =~ \\bfoo"b ar"\\\' ]]', ID), [["re='\\bfoo'; [[ \"$x\" =~ $re\"b ar\"\\' ]]", "re='\\bfoo'\n[[ \"$x\" =~ $re\"b ar\"\\' ]]"]]);
    assert.deepStrictEqual(fix("[[ $x =~ \\bfoo\\' ]]", ID), ["re='\\bfoo\\'\\'''\n[[ $x =~ $re ]]"]);
  });
  it('takes a name the document does not use', () => {
    assert.deepStrictEqual(codes('re=1\n[[ $x =~ \\bz ]]', ID), ["re2='\\bz'; [[ $x =~ $re2 ]]"]);
    assert.deepStrictEqual(codes('echo "$re" ${re2}\n[[ $x =~ \\bz ]]', ID), ["re3='\\bz'; [[ $x =~ $re3 ]]"]);
    // (A word that only contains the name, or a regex like `\bre`, is no use of it.)
    assert.deepStrictEqual(codes('more=1\n[[ $x =~ \\bre ]]', ID), ["re='\\bre'; [[ $x =~ $re ]]"]);
    // (A script run by `bash -c` is a part of the document too.)
    assert.match(factsOf("re=1; bash -c '[[ $x =~ \\bz ]]'", ID)[0].text, /Keep the regex in a variable \(`re2='\\bz'; /);
  });
  it('is said, but not carried as edits, in a string another command reads as a script', () => {
    const [f] = factsOf("bash -c '[[ $x =~ \\bz ]]'", ID);
    assert.strictEqual(f.rewrite, undefined);
    assert.match(f.text, /Keep the regex in a variable \(`re='\\bz'; \[\[ \$x =~ \$re \]\]`\) or use/);
  });
  it('is what the note says', () => {
    assert.match(factsOf('[[ $x =~ \\bfoo ]]', ID)[0].text, /Keep the regex in a variable \(`re='\\bfoo'; \[\[ \$x =~ \$re \]\]`\) or use `\[\[:space:\]\]` or `\[\[:alnum:\]_\]` instead$/);
    const ja = new Analyzer('ja').explainLine(parser.parse('[[ $x =~ \\bfoo ]]'), 0).facts!.find((f) => f.id === ID)!;
    assert.match(ja.text, /変数に入れる（`re='\\bfoo'; \[\[ \$x =~ \$re \]\]`）か/);
  });

  // Each input, and the pattern `grep -E` reads for what the author meant.
  const inputs: [src: string, pattern: string][] = [
    ['[[ $x =~ \\bfoo ]] && echo match || echo no\n', '\\bfoo'],
    ['if false; then :; elif [[ $x =~ a\\sb ]]; then echo match; else echo no; fi\n', 'a\\sb'],
    ['[[ $x =~ \\bfoo"x" ]] && echo match || echo no\n', '\\bfoox'],
    ['re=keep\n[[ $x =~ \\<foo\\> ]] && echo match || echo no\necho "re=$re"\n', '\\<foo\\>'],
  ];
  const strings = ['a foo', 'foo', 'bfoo', 'foobar', 'xfoo', 'a b', 'asb', 'ab', 'a foox', 'foox', 'bfoox'];
  for (const { name, program } of programs) {
    for (const [src, pattern] of inputs) {
      it(`reads the backslash as a regex operator in ${name}: ${JSON.stringify(src)}`, async () => {
        // For each string: what the script says, and what grep says for the same regex (`match` or `no`).
        const driver = `${SYNTAX}for s in ${strings.map((s) => `'${s}'`).join(' ')}; do r=$(x=$s "$BASH" f.sh | head -1); `
          + `if printf %s "$s" | grep -qE '${pattern}'; then g=match; else g=no; fi; echo "$s|$r|$g"; done; x=foo "$BASH" f.sh`;
        const [[, script]] = rewrites(src, ID);
        const after = (await run(program, script, driver)).out.split('\n').filter(Boolean);
        const before = (await run(program, src, driver)).out.split('\n').filter(Boolean);
        // (The meaning is kept: the rewrite says what grep says, for every string.)
        const rows = after.filter((l) => l.includes('|'));
        assert.strictEqual(rows.length, strings.length);
        for (const row of rows) { const [s, r, g] = row.split('|'); assert.strictEqual(r, g, s); }
        // (The hazard: the original is wrong for some string.)
        assert.ok(before.filter((l) => l.includes('|')).some((l) => { const [, r, g] = l.split('|'); return r !== g; }), pattern);
        assert.doesNotMatch(after.join('\n'), /@syntax/);
        // (The name the script has is not touched.)
        if (src.includes('re=keep')) assert.match(after.join('\n'), /^re=keep$/m);
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const [src] of inputs) assert.deepStrictEqual(factsOf(fix(src, ID)[0], ID), [], src);
  });
});

describe('the rewrite of `bracket-close-glued`', () => {
  const ID = 'bracket-close-glued';
  it('puts a space before the `]`', () => {
    assert.deepStrictEqual(rewrites('[ -f a.txt]', ID), [['a.txt ]', '[ -f a.txt ]']]);
    assert.deepStrictEqual(fix('if [ -n "a b"]; then\n  echo y\nfi', ID), ['if [ -n "a b" ]; then\n  echo y\nfi']);
    assert.deepStrictEqual(fix('[ a = a] && echo y', ID), ['[ a = a ] && echo y']);
  });
  it('is said, but not carried as edits, in a string another command reads as a script', () => {
    const [f] = factsOf("bash -c '[ -f a.txt]'", ID);
    assert.strictEqual(f.rewrite, undefined);
    assert.match(f.text, /`\]` needs a space before it \(`a\.txt \]`\)$/);
  });
  it('is what the note says', () => {
    assert.match(factsOf('[ -f a.txt]', ID)[0].text, /status 2\)\. `\]` needs a space before it \(`a\.txt \]`\)$/);
    const ja = new Analyzer('ja').explainLine(parser.parse('[ -f a.txt]'), 0).facts!.find((f) => f.id === ID)!;
    assert.match(ja.text, /`\]` の前に空白が要ります（`a\.txt \]`）$/);
  });

  const inputs = ['[ -f a.txt]\necho "@$?"\n', 'if [ -f a.txt]; then echo yes; else echo no; fi\n'];
  for (const { name, program } of programs) {
    for (const src of inputs) {
      it(`closes the test in ${name}: ${JSON.stringify(src)}`, async () => {
        const driver = `${SYNTAX}"$BASH" f.sh`;
        const [[, script]] = rewrites(src, ID);
        const [presentBefore, absentBefore, present, absent] = await Promise.all([run(program, src, driver, { files: ['a.txt'] }), run(program, src, driver),
          run(program, script, driver, { files: ['a.txt'] }), run(program, script, driver)]);
        // (The hazard: the original fails with status 2, whether the file is there or not.)
        for (const b of [presentBefore, absentBefore]) assert.match(b.err, /missing/);
        assert.deepStrictEqual([presentBefore.out, absentBefore.out], src.includes('@') ? ['@2\n', '@2\n'] : ['no\n', 'no\n']);
        // (The meaning is kept: the rewrite tells the file that is there from the file that is not.)
        assert.deepStrictEqual([present.out, absent.out], src.includes('@') ? ['@0\n', '@1\n'] : ['yes\n', 'no\n']);
        assert.strictEqual(present.err + absent.err, '');
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const src of inputs) assert.deepStrictEqual(factsOf(fix(src, ID)[0], ID), [], src);
  });
});
