// The rewrites of the word notes (src/wordfacts.ts; docs/design/oracles.md, 3.1 to 3.3), as test/rewrites.test.ts
// checks those of the first ids: the rewrites of hand-written inputs, the notes' texts rendered from them, and the
// rewritten scripts run in bash (5.2, and 5.3 when `$BASH_EXPLAINER_BASH53` names one) in a cgroup over the states of
// each id: the meaning is kept (the rewrite does in every state what the original does in the state the author had in
// mind), the hazard is gone, the rewrite parses (`bash -n`), and explaining it raises no fact of the same id.
import * as assert from 'assert';
import type { Shell } from '../src/dialect';
import type { FactId } from '../src/messages';
import { factsOf, programs, type Ran, rewrites, run } from './support/rewrites';

/** The rewritten scripts of the one fact of `id` in `src`. */
const scripts = (src: string, id: FactId, shell?: Shell): string[] => rewrites(src, id, shell).map(([, s]) => s);
/** The one fact of `id` in `src`, in `lang`. */
const only = (src: string, id: FactId, lang: 'en' | 'ja' = 'en', shell?: Shell) => {
  const facts = factsOf(src, id, shell, lang);
  assert.strictEqual(facts.length, 1, src);
  return facts[0];
};
/** A shell word for `s`. */
const sq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
/** Checks the syntax of f.sh, then runs it with the arguments `argv`. */
const driver = (argv: readonly string[] = [], before = ''): string => `${before}"$BASH" -n f.sh || echo @syntax; "$BASH" f.sh ${argv.map(sq).join(' ')}; echo "@run=$?"`;
/** Recorders that print each argument they are given, in `<>`. */
const SHOW = ['rm', 'cp', 'cat', 'cd'].map((c) => `${c}() { printf '@${c}'; printf ' <%s>' "$@"; echo; }`).join('\n');
/** What a run printed, both streams. */
const all = (r: Ran): string => r.out + r.err;

describe('the rewrites of `unquoted-variable-as-path`', () => {
  const id = 'unquoted-variable-as-path';
  it('quote only the expansions, where quotes keep the word', () => {
    assert.deepStrictEqual(scripts('rm -rf $DIR/*', id), ['rm -rf "$DIR"/*']);
    assert.deepStrictEqual(scripts('cp $a b', id), ['cp "$a" b']);
    assert.deepStrictEqual(scripts('sudo rm -rf $DIR/releases/$line', id), ['sudo rm -rf "$DIR/releases/$line"']);
    assert.deepStrictEqual(scripts('cp ~/$x/* e', id), ['cp ~/"$x"/* e']);
  });
  it('are what the note says, and none where quotes would change the word, or in a string another shell reads', () => {
    assert.match(only('rm -rf $DIR/*', id).text, /\. Write `"\$DIR"\/\*`$/);
    assert.match(only('rm -rf $DIR/*', id, 'ja').text, /。`"\$DIR"\/\*` と書く$/);
    const glob = only('cp ${x:-*.txt} e', id);
    assert.strictEqual(glob.rewrite, undefined);
    assert.doesNotMatch(glob.text, /Write/);
    const evaled = only("eval 'rm -rf $Q/*'", id);
    assert.strictEqual(evaled.rewrite, undefined);
    assert.match(evaled.text, /\. Write `"\$Q"\/\*`$/);
  });

  // Each input, the variable it reads, and whether its word is a glob (an empty value then names `/`: another note).
  const inputs: { src: string; v: string; glob?: boolean }[] = [
    { src: 'cp $a b\n', v: 'a' },
    { src: 'cat $f\n', v: 'f' },
    { src: 'cd $d && echo "@in"\n', v: 'd' },
    { src: 'rm -rf $d/*\n', v: 'd', glob: true },
  ];
  const BENIGN = 'VAL';
  /** Files present: two in the directory, and two in a directory of each value. */
  const present = (dirs: readonly string[]) => `touch x1 x2; for rw_d in ${dirs.filter(Boolean).map(sq).join(' ')}; do mkdir -p "$rw_d"; touch "$rw_d/x1" "$rw_d/x2"; done; `;
  for (const { name, program } of programs) {
    for (const { src, v, glob } of inputs) {
      it(`give with any value the words the original gives with a plain one, in ${name}: ${JSON.stringify(src)}`, async () => {
        const [script] = scripts(src, id);
        for (const files of [false, true]) {
          const values = ['a b', '*', ...(glob ? [] : [''])];
          const before = files ? present([BENIGN, ...values]) : '';
          const plain = await run(program, src, driver([], before), { env: { [v]: BENIGN }, recorders: SHOW });
          assert.strictEqual(plain.err, '');
          for (const value of values) {
            // (The meaning is kept: the words of the plain value, with this value in its place; no `*` globbed, no word split or lost.)
            const after = await run(program, script, driver([], before), { env: { [v]: value }, recorders: SHOW });
            assert.strictEqual(after.out, plain.out.split(BENIGN).join(value), `${value} ${files}`);
            assert.doesNotMatch(all(after), /@syntax/);
            // (The hazard: the original splits a value with a space.)
            if (value === 'a b') assert.notStrictEqual((await run(program, src, driver([], before), { env: { [v]: value }, recorders: SHOW })).out, after.out);
          }
        }
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const { src } of inputs) for (const s of scripts(src, id)) assert.deepStrictEqual(factsOf(s, id), [], s);
  });
});

describe('the rewrites of `unquoted-variable-in-test`', () => {
  const id = 'unquoted-variable-in-test';
  it('quote the word, as written', () => {
    assert.deepStrictEqual(scripts('[ $x = y ]', id), ['[ "$x" = y ]']);
    assert.deepStrictEqual(scripts('if [ -n ${x} ]; then :; fi', id), ['if [ -n "${x}" ]; then :; fi']);
    // (zsh drops an empty word all the same.)
    assert.deepStrictEqual(scripts('[ -n $x ]', id, 'zsh'), ['[ -n "$x" ]']);
  });
  it('are what the note says, and none where quotes would change the value', () => {
    assert.match(only('[ $x = y ]', id).text, /\. Write `"\$x"`$/);
    assert.match(only('[ $x = y ]', id, 'ja').text, /。`"\$x"` と書きます$/);
    assert.match(only('[ -n $x ]', id, 'en', 'zsh').text, /is not split in zsh.*\. Write `"\$x"`$/);
    assert.match(only('[ -n $x ]', id, 'ja', 'zsh').text, /zsh では.*。`"\$x"` と書きます$/);
    for (const shell of [undefined, 'zsh'] as const) {
      const f = only("[ -n ${x:-'a b'} ]", id, 'en', shell);
      assert.strictEqual(f.rewrite, undefined);
      assert.match(f.text, /is true\)$/);
      assert.match(only("[ -n ${x:-'a b'} ]", id, 'ja', shell).text, /真になります）$/);
    }
  });

  // Each input, and what it should print for a value (undefined: unset).
  const inputs: { src: string; says: (x: string | undefined) => string }[] = [
    { src: 'if [ $x = y ]; then echo @yes; else echo @no; fi\n', says: (x) => (x === 'y' ? '@yes' : '@no') },
    { src: '[ -n $x ] && echo @set || echo @empty\n', says: (x) => (x ? '@set' : '@empty') },
    { src: '[ $x ] && echo @set || echo @empty\n', says: (x) => (x ? '@set' : '@empty') },
  ];
  for (const { name, program } of programs) {
    for (const { src, says } of inputs) {
      it(`test the value itself in ${name}: ${JSON.stringify(src)}`, async () => {
        const [script] = scripts(src, id);
        // (The meaning is kept: with a plain value, the rewrite says what the original says.)
        for (const x of ['y', 'z']) assert.deepStrictEqual(await run(program, script, driver(), { env: { x } }), await run(program, src, driver(), { env: { x } }), x);
        // (The hazard is gone: no error, and the answer for the value as it is.)
        for (const x of [undefined, '', 'a b', '-n', '=']) {
          const after = await run(program, script, driver(), { env: x === undefined ? {} : { x } });
          assert.strictEqual(after.err, '', String(x));
          assert.strictEqual(after.out, `${says(x)}\n@run=0\n`, String(x));
        }
        // (The original goes wrong with an empty value or one with a space.)
        const empty = await run(program, src, driver(), { env: { x: '' } });
        const spaced = await run(program, src, driver(), { env: { x: 'a b' } });
        assert.ok(all(empty) !== `${says('')}\n@run=0\n` || all(spaced) !== `${says('a b')}\n@run=0\n`, all(empty) + all(spaced));
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const { src } of inputs) for (const s of scripts(src, id)) assert.deepStrictEqual(factsOf(s, id), [], s);
  });
});

describe('the rewrites of `for-over-unquoted-args`', () => {
  const id = 'for-over-unquoted-args';
  it('quote the list, or leave it out, with the loop as written', () => {
    assert.deepStrictEqual(rewrites('for a in $*; do :; done', id), [['for a in "$@"', 'for a in "$@"; do :; done'], ['for a', 'for a; do :; done']]);
    assert.deepStrictEqual(rewrites('select f in $@\ndo break; done', id), [['select f in "$@"', 'select f in "$@"\ndo break; done'], ['select f', 'select f\ndo break; done']]);
    // (A list of more words keeps them: no loop without a list.)
    assert.deepStrictEqual(rewrites('for a in $@ end; do :; done', id), [['for a in "$@"', 'for a in "$@" end; do :; done']]);
  });
  it('are what the note says', () => {
    assert.match(only('for f in $*; do :; done', id).text, /Write `for f in "\$@"` \(or just `for f`\)$/);
    assert.match(only('for f in $*; do :; done', id, 'ja').text, /`for f in "\$@"`（または `for f` だけ）と書きます$/);
    assert.match(only('for a in $@ end; do :; done', id).text, /Write `for a in "\$@"`$/);
    assert.match(only('for a in $@ end; do :; done', id, 'ja').text, /`for a in "\$@"` と書きます$/);
    const inner = only("bash -c 'for a in $@; do :; done'", id);
    assert.strictEqual(inner.rewrite, undefined);
    assert.match(inner.text, /Write `for a in "\$@"` \(or just `for a`\)$/);
  });

  const inputs = [
    'for a in $@; do printf \'<%s>\' "$a"; done; echo\n',
    'f() {\n  for x in $*\n  do\n    printf \'<%s>\' "$x"\n  done\n}\nf "$@"; echo\n',
    'for a in $@ end; do printf \'<%s>\' "$a"; done; echo\n',
  ];
  for (const { name, program } of programs) {
    for (const src of inputs) {
      it(`give each argument as it is in ${name}: ${JSON.stringify(src)}`, async () => {
        const end = src.includes('end') ? '<end>' : '';
        for (const script of scripts(src, id)) {
          // (The meaning is kept: with plain arguments, the rewrite does what the original does.)
          assert.deepStrictEqual(await run(program, script, driver(['ab', 'c'])), await run(program, src, driver(['ab', 'c'])));
          // (The hazard is gone: an argument with a space, an empty one and a `*` each stay one, as they are.)
          for (const argv of [['a b', 'c'], ['', 'c'], ['*']]) {
            const after = await run(program, script, driver(argv), { files: ['x1', 'x2'] });
            assert.strictEqual(all(after), `${argv.map((a) => `<${a}>`).join('')}${end}\n@run=0\n`, script);
            assert.notStrictEqual(all(await run(program, src, driver(argv), { files: ['x1', 'x2'] })), all(after));
          }
        }
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const src of inputs) for (const s of scripts(src, id)) assert.deepStrictEqual(factsOf(s, id), [], s);
  });
});

describe('the rewrites of `prefix-assignment-expanded-first`', () => {
  const id = 'prefix-assignment-expanded-first';
  it('run the command through `sh -c`, its words as that shell reads them', () => {
    assert.deepStrictEqual(rewrites('FOO=1 echo $FOO', id), [[`sh -c 'echo "$FOO"'`, `FOO=1 sh -c 'echo "$FOO"'`]]);
    // (A word in single quotes goes in double quotes; an expansion of each variable of the prefix in quotes; redirections stay outside.)
    assert.deepStrictEqual(scripts("FOO=new A=2 printf '<%s>\\n' \"$FOO a\" ${FOO}/b $A >o", id), [`FOO=new A=2 sh -c 'printf "<%s>\\n" "$FOO a" "\${FOO}"/b "$A"' >o`]);
    assert.deepStrictEqual(scripts('FOO=1 ./show x"$FOO"', id), [`FOO=1 sh -c './show x"$FOO"'`]);
  });
  it('are what the note says', () => {
    assert.match(only('FOO=1 echo $FOO', id).text, /To use the new value, go through a shell: `FOO=… sh -c 'echo "\$FOO"'`$/);
    assert.match(only('FOO=1 echo $FOO', id, 'ja').text, /新しい値を使うなら `FOO=… sh -c 'echo "\$FOO"'` のようにシェル経由にします$/);
  });
  // Where `sh -c` would not run the same command with the same words, the note shows the form, with no edits.
  for (const src of [
    // A builtin that acts on the shell, and one with no program of its name; a function; an alias.
    'FOO=1 cd $FOO', 'FOO=1 read $FOO', 'f() { :; }\nFOO=1 f $FOO', 'shopt -s expand_aliases\nalias e=echo\nFOO=1 e $FOO',
    // A name that is not plain text; a redirection among the words.
    'FOO=1 \\echo $FOO', 'FOO=1 echo $FOO >o x',
    // Another expansion, which that shell would expand; a glob or a brace; quotes that would end the script's.
    'FOO=1 echo $FOO $BAR', 'FOO=1 echo "$FOO $BAR"', 'FOO=1 echo $(echo) $FOO', 'FOO=1 echo "`x` $FOO"', 'FOO=1 echo $FOO *', 'FOO=1 echo $FOO {a,b}',
    "FOO=1 echo \"it's $FOO\"", "FOO=1 echo $FOO 'a$b'", "FOO=1 echo $FOO 'a\\'",
  ]) {
    it(`show the form, with no edits: ${JSON.stringify(src)}`, () => {
      const f = only(src, id);
      assert.strictEqual(f.rewrite, undefined);
      assert.match(f.text, /go through a shell: `FOO=… sh -c '… "\$FOO"'`$/);
    });
  }
  it('in a string another shell runs: said, not carried as edits', () => {
    const f = only("bash -c 'FOO=1 echo $FOO'", id);
    assert.strictEqual(f.rewrite, undefined);
    assert.match(f.text, /`FOO=… sh -c 'echo "\$FOO"'`$/);
  });

  // Each input, and the values the author had in mind: those of its prefix.
  const show = `printf '%s\\n' '#!/bin/sh' 'printf "<%s>" "$@"; echo' > show; chmod +x show; `;
  const inputs: { src: string; meant: Record<string, string> }[] = [
    { src: 'FOO=1 echo $FOO\n', meant: { FOO: '1' } },
    { src: "FOO=new printf '<%s>\\n' \"$FOO a\" $FOO\n", meant: { FOO: 'new' } },
    { src: 'FOO=1 A=2 ./show "$FOO" $A/b c\n', meant: { FOO: '1', A: '2' } },
  ];
  for (const { name, program } of programs) {
    for (const { src, meant } of inputs) {
      it(`give the command the new value in ${name}: ${JSON.stringify(src)}`, async () => {
        const [script] = scripts(src, id);
        const benign = await run(program, src, driver([], show), { env: meant, recorders: '' });
        assert.strictEqual(benign.err, '');
        // (The meaning is kept, and the hazard gone: whatever the variables were before, the rewrite gives the command
        // the words the original gives when they already had the new values; the original gives it the old ones.)
        for (const env of [{}, { FOO: 'old', A: 'old' }] as Record<string, string>[]) {
          assert.deepStrictEqual(await run(program, script, driver([], show), { env, recorders: '' }), benign, JSON.stringify(env));
          assert.notDeepStrictEqual(await run(program, src, driver([], show), { env, recorders: '' }), benign, JSON.stringify(env));
        }
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const { src } of inputs) for (const s of scripts(src, id)) assert.deepStrictEqual(factsOf(s, id), [], s);
  });
});

describe('the rewrites of `array-joined-in-assignment`', () => {
  const id = 'array-joined-in-assignment';
  it('assign an array, or the one string `"$*"` where the IFS starts with a space', () => {
    assert.deepStrictEqual(rewrites('x=$@', id), [['("$@")', 'x=("$@")'], ['"$*"', 'x="$*"']]);
    assert.deepStrictEqual(scripts('f() { local t="${a[@]}"; }', id), ['f() { local t=("${a[@]}"); }', 'f() { local t="${a[*]}"; }']);
    assert.deepStrictEqual(scripts("IFS=' :'\nb+=${@}", id), ["IFS=' :'\nb+=(\"${@}\")", "IFS=' :'\nb+=\"${*}\""]);
    // (`"$*"` joins with the first character of the IFS, an assignment of `$@` with a space: only the array.)
    assert.deepStrictEqual(scripts('IFS=:\nt=${a[@]}', id), ['IFS=:\nt=("${a[@]}")']);
    assert.deepStrictEqual(scripts('IFS=$1\nt=$@', id), ['IFS=$1\nt=("$@")']);
  });
  it('are what the note says', () => {
    assert.match(only('x=$@', id).text, /To keep them apart, assign an array: `x=\("\$@"\)`; if one string is meant, write `x="\$\*"`$/);
    assert.match(only('x=$@', id, 'ja').text, /配列にして `x=\("\$@"\)` と書き、1つの文字列にするつもりなら `x="\$\*"` と書きます$/);
    assert.match(only('IFS=:\nt=${a[@]}', id).text, /assign an array: `t=\("\$\{a\[@\]\}"\)`$/);
    assert.match(only('IFS=:\nt=${a[@]}', id, 'ja').text, /配列にして `t=\("\$\{a\[@\]\}"\)` と書きます$/);
  });

  // Each input prints the number of elements of its variable, each element, and their join (`${x[*]}`, also of a string).
  const inputs = [
    'x=$@\necho "#${#x[@]}"; printf \'<%s>\' "${x[@]}"; echo; printf \'[%s]\\n\' "${x[*]}"\n',
    'f() {\n  local t="$@"\n  echo "#${#t[@]}"; printf \'<%s>\' "${t[@]}"; echo; printf \'[%s]\\n\' "${t[*]}"\n}\nf "$@"\n',
    'a=("$@")\nb+=${a[@]}\necho "#${#b[@]}"; printf \'<%s>\' "${b[@]}"; echo; printf \'[%s]\\n\' "${b[*]}"\n',
  ];
  /** The lines of a run: the count, the elements, the join. */
  const lines = (r: Ran): string[] => r.out.split('\n');
  for (const { name, program } of programs) {
    for (const src of inputs) {
      it(`keep the arguments apart, or join them as the original does, in ${name}: ${JSON.stringify(src)}`, async () => {
        const [array, string] = scripts(src, id);
        for (const argv of [['x  y', 'b', 'c'], []]) {
          const before = await run(program, src, driver(argv));
          const kept = await run(program, array, driver(argv));
          assert.strictEqual(before.err + kept.err, '');
          // (The array: the same join, and the arguments apart, as many as were given.)
          assert.deepStrictEqual(lines(kept).slice(2), lines(before).slice(2));
          assert.deepStrictEqual(lines(kept).slice(0, 2), [`#${argv.length}`, argv.map((a) => `<${a}>`).join('') || '<>']);
          assert.notStrictEqual(lines(before)[0], lines(kept)[0]);
          // (The string: the same string.)
          assert.deepStrictEqual(await run(program, string, driver(argv)), before);
        }
      });
    }
    it(`join with a space where \`"$*"\` would join with the IFS, in ${name}`, async () => {
      // (Why the string is not given there: with `IFS=:`, the assignment joins with a space, `"$*"` with `:`.)
      const src = 'IFS=:\nx=$@\nprintf \'[%s]\\n\' "$x"\n';
      const argv = ['x  y', 'b'];
      assert.strictEqual(scripts(src, id).length, 1);
      assert.strictEqual((await run(program, src, driver(argv))).out, '[x  y b]\n@run=0\n');
      assert.strictEqual((await run(program, src.replace('$@', '"$*"'), driver(argv))).out, '[x  y:b]\n@run=0\n');
    });
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const src of inputs) for (const s of scripts(src, id)) assert.deepStrictEqual(factsOf(s, id), [], s);
  });
});

describe('the rewrites of `nounset-unbound`', () => {
  const id = 'nounset-unbound';
  it('give the expansion an empty default, where it is a plain one', () => {
    assert.deepStrictEqual(rewrites('set -u\necho "<$x>"', id), [['${x:-}', 'set -u\necho "<${x:-}>"']]);
    assert.deepStrictEqual(scripts('set -u\nprintf "%s" ${x}', id), ['set -u\nprintf "%s" ${x:-}']);
  });
  it('are what the note says, and none for another form', () => {
    assert.match(only('set -u\necho "$x"', id).text, /If it may be unset, write `\$\{x:-\}`$/);
    assert.match(only('set -u\necho "$x"', id, 'ja').text, /設定されていないことがあるなら `\$\{x:-\}` と書く$/);
    const length = only('set -u\necho ${#x}', id);
    assert.strictEqual(length.rewrite, undefined);
    assert.match(length.text, /Set it before this line$/);
    const inner = only("bash -c 'set -u; echo \"$x\"'", id);
    assert.strictEqual(inner.rewrite, undefined);
    assert.match(inner.text, /write `\$\{x:-\}`$/);
  });

  const inputs = ['set -u\necho "<$x>"\necho @next\n', "set -u\nprintf '<%s>' ${x}; echo\necho @next\n", 'set -eu\ncat <<EOF\n<$x>\nEOF\necho @next\n'];
  for (const { name, program } of programs) {
    for (const src of inputs) {
      it(`read an unset variable as empty in ${name}: ${JSON.stringify(src)}`, async () => {
        const [script] = scripts(src, id);
        // (The meaning is kept: with a value, empty or not, the rewrite does what the original does.)
        for (const x of ['', 'v']) assert.deepStrictEqual(await run(program, script, driver(), { env: { x } }), await run(program, src, driver(), { env: { x } }), x);
        // (The hazard is gone: unset, it is read as empty, and the script goes on.)
        const before = await run(program, src, driver());
        const after = await run(program, script, driver());
        assert.match(before.err, /x: unbound variable/);
        assert.deepStrictEqual(after, await run(program, src, driver(), { env: { x: '' } }));
        assert.match(after.out, /^<>\n@next\n@run=0\n$/);
      });
    }
  }
  it('leaves no fact of the same id in the rewritten scripts', () => {
    for (const src of inputs) for (const s of scripts(src, id)) assert.deepStrictEqual(factsOf(s, id), [], s);
  });
});
