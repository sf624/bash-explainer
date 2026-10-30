// Worked examples use the script's own value where the model knows it (docs/design/expansion-values.md), the value the
// value line shows: `msg="hello world"; echo ${#msg}` is shown "When `msg="hello world"`" → 11, not a sample. Each
// case is checked with bash: what the example says of the script's value is what bash does with the same script.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { BashVersion } from '../src/bashversion';
import { exampleFor, parseExpansion } from '../src/expansion';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runBash } from './support/bash';

const parser = createUnbashParser();

/** The examples of the last line of `src`, as "label → lines" strings. */
function examples(src: string, lang: 'ja' | 'en' = 'en', bashVersion?: BashVersion): string[] {
  const tree = parser.parse(src);
  const ex = new Analyzer(lang).explainLine(tree, src.split('\n').length - 1, undefined, bashVersion ? { bashVersion } : {});
  return ex.examples.flatMap((e) => e.sections.map((sec) => `${sec.label} → ${sec.lines.join(' ') || sec.empty}`));
}

/** What bash prints for `src` with its last line replaced by `last`. */
function bash(src: string, last: string): string {
  const lines = src.split('\n');
  const r = runBash([...lines.slice(0, -1), last].join('\n'));
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
}

describe('worked examples of ${…} with the value of the script', () => {
  // [script (its last line is explained), the examples, the index of the case of the script's value]
  const cases: [string, string[], number][] = [
    ['msg="hello world"\necho ${#msg}', ['When `msg="hello world"` → 11'], 0],
    ['msg="hello world"\necho ${msg:-def}', ['When msg is unset or empty → def', 'When `msg="hello world"` → hello world'], 1],
    ['msg="hello world"\necho ${msg%% *}', ['When `msg="hello world"` → hello'], 0],
    ['x=abc\necho ${x:1:2}', ['When `x=abc` → bc'], 0],
    ['x=abc\necho ${x:+alt}', ['When `x=abc` → alt', 'When x is unset or empty → (empty string)'], 0],
    // The script's value does not show what the operator does: the sample that does follows.
    ['x=abc\necho ${x#z}', ['When `x=abc` → abc', 'When `x=zname` → name'], 0],
    ['x=abc\necho ${x%c}', ['When `x=abc` → ab'], 0],
    // Neither the script's value nor the sample shows what the operator does: the script's value alone.
    ['x=abc\necho ${x:0}', ['When `x=abc` → abc'], 0],
    ['x=abc\necho ${x/b/B}', ['When `x=abc` → aBc'], 0],
    // An empty value: the case of an empty value, in the place of the one with the same condition, or first.
    ['x=\necho ${x-d}', ['When x is unset → d', 'When `x=""` → (empty string)', 'When `x=hello` → hello'], 1],
    ['x=\necho ${x:-d}', ['When `x=""` → d', 'When x is unset or empty → d', 'When `x=hello` → hello'], 0],
    // The forms the model does not follow, from the script's value by the rules of the samples.
    ['x=abc\necho ${x@Q}', ["When `x=abc` → 'abc'"], 0],
    ['x="it\'s"\necho ${x@Q}', ["When `x=\"it's\"` → 'it'\\''s'"], 0],
    ['x=abc\necho ${x@U} ', ['When `x=abc` → ABC'], 0],
    ['x=ABC\necho ${x@L}', ['When `x=ABC` → abc'], 0],
    ['x=ABC\necho ${x@u}', ['When `x=ABC` → ABC', 'When `x=hello` → Hello'], 0],
    ['x=abc\necho ${x^^[ab]}', ['When `x=abc` → ABc'], 0],
    ['x=aBc\necho ${x~~}', ['When `x=aBc` → AbC'], 0],
    // (`~` with a pattern toggles the first letter when the pattern matches it: not a pattern substitution.)
    ['x=abc\necho ${x~[a-c]}', ['When `x=abc` → Abc', 'When `x="Hello World"` → Hello World'], 0],
    // A value with quotes or a dollar sign is shown as bash would assign it.
    ['x=\'a"b\'\necho ${#x}', ['When `x=\'a"b\'` → 3'], 0],
    ['x=\'$HOME\'\necho ${#x}', ['When `x=\'$HOME\'` → 5'], 0],
  ];
  for (const [src, want, own] of cases) {
    it(src.replace(/\n/g, '; '), () => {
      assert.deepStrictEqual(examples(src), want);
      const text = src.split('\n').pop()!.replace(/^echo /, '').trim();
      const got = bash(src, `printf %s "${text}"`);
      assert.strictEqual(want[own].replace(/^.* → /, ''), got || '(empty string)');
    });
  }

  it('says the same in Japanese', () => {
    assert.deepStrictEqual(examples('msg="hello world"\necho ${#msg}', 'ja'), ['`msg="hello world"` のとき → 11']);
    assert.deepStrictEqual(examples('x=abc\necho ${x#z}', 'ja'), ['`x=abc` のとき → abc', '`x=zname` のとき → name']);
  });

  it('keeps the samples where the model has no value, or the value cannot be shown as it is', () => {
    // Not known (a command's output, an argument, an array, the environment), unset, a control character, a backtick, long.
    assert.deepStrictEqual(examples('msg=$(date)\necho ${#msg}'), ['When `msg=hello` → 5']);
    assert.deepStrictEqual(examples('echo ${#HOME}'), ['When `HOME=hello` → 5']);
    assert.deepStrictEqual(examples('set -- abc\necho ${#1}'), ['When argument 1 is `hello` → 5']);
    // The value is known, but not what the expansion gives where the IFS is not known: no case of the script's value.
    assert.deepStrictEqual(examples('IFS=$(cmd)\nx=abc\necho ${#x}'), ['When `x=hello` → 5']);
    assert.deepStrictEqual(examples('IFS=$(cmd)\nx=abc\necho ${x^}'), ['When `x="hello world"` → Hello world']);
    assert.deepStrictEqual(examples('a=(x y)\necho ${#a[@]}'), ['When `a=(a b c)` → 3']);
    assert.deepStrictEqual(examples('unset u\necho ${#u}'), ['When `u=hello` → 5']);
    assert.deepStrictEqual(examples("x=$'a\\tb'\necho ${#x}"), ['When `x=hello` → 5']);
    assert.deepStrictEqual(examples("x='a`b'\necho ${#x}"), ['When `x=hello` → 5']);
    assert.deepStrictEqual(examples(`x=${'a'.repeat(61)}\necho \${#x}`), ['When `x=hello` → 5']);
    // A form the model does not follow and the samples do not either: `@E` of a value that is not ASCII.
    assert.deepStrictEqual(examples('x=é\necho ${x@U}'), ['When `x=hello` → HELLO']);
    // (A letter other than ASCII changes case by the locale: the model has no value of `${x^}` either.)
    assert.deepStrictEqual(examples('x=été\necho ${x^}'), ['When `x="hello world"` → Hello world']);
    assert.deepStrictEqual(examples('x=abc\necho ${x@E}'), ['When `x=a\\tb` → a<TAB>b']);
    // The model follows `${x:?}`, and bash fails on it: no value, the samples.
    assert.deepStrictEqual(examples('x=\necho ${x:?}'), ['When x is unset or empty → prints the error "(a default message)" and exits', 'When `x=hello` → hello']);
  });

  it('takes the value only for a variable (exampleFor)', () => {
    // An argument or an element has no value of the script here; the forms the samples do not compute stay as they are.
    assert.deepStrictEqual(exampleFor(parseExpansion('${1%.*}')!, 'en', { script: { value: 'a.b', result: 'a' } })!.map((c) => c.when), ['When argument 1 is `report.tar.gz`']);
    assert.deepStrictEqual(exampleFor(parseExpansion('${a[1]#x}')!, 'en', { script: { value: 'xy', result: 'y' } })!.map((c) => c.when), ['When `a[1]=xname`']);
    assert.deepStrictEqual(exampleFor(parseExpansion('${x@A}')!, 'en', { script: { value: 'v' } })!.map((c) => c.when), ['When `x=abc`']);
    assert.deepStrictEqual(exampleFor(parseExpansion('${x^}')!, 'en', { script: { value: 'v' } })!.map((c) => c.when), ['When `x="hello world"`']);
  });
});

describe('worked examples of tests and patterns with the value of the script', () => {
  /** Whether the test or pattern that is the last line of `src` succeeds in bash. */
  const succeeds = (src: string) => bash(src, `if ${src.split('\n').pop()}; then echo true; else echo false; fi`).trim() === 'true';

  // [script, the examples, the line of the script's value in them]
  const tests: [string, string[], string][] = [
    ['x=abc\n[ "$x" = abc ]', ['True when → x="abc"', 'False when → x="abcx"'], 'x="abc"'],
    ['y=zzz\n[ "$y" = abc ]', ['True when → y="abc"', 'False when → y="zzz"'], 'y="zzz"'],
    ['y=zzz\n[[ $y != abc ]]', ['True when → y="zzz"', 'False when → y="abc"'], 'y="zzz"'],
    ['y=zzz\ntest abc = "$y"', ['True when → y="abc"', 'False when → y="zzz"'], 'y="zzz"'],
    ['n=5\n[ "$n" -lt 2 ]', ['True when → n="1"', 'False when → n="5"'], 'n="5"'],
    ['n=5\n[ 2 -lt "$n" ]', ['True when → n="5"', 'False when → n="2"'], 'n="5"'],
    ['x=abc\n[ -z "$x" ]', ['True when → x=""', 'False when → x="abc"'], 'x="abc"'],
    ['x=\n[ -n "$x" ]', ['True when → x="abc"', 'False when → x=""'], 'x=""'],
    ['x=q\n[ -n $x ]', ['True when → x="q" x=""'], 'x="q"'],
  ];
  for (const [src, want, line] of tests) {
    it(src.replace(/\n/g, '; '), () => {
      assert.deepStrictEqual(examples(src), want);
      const section = want.find((w) => w.split(' → ')[1].split(' ').includes(line))!;
      assert.strictEqual(section.startsWith('True'), succeeds(src));
    });
  }

  it('keeps the samples where bash would not read the value as the cases do', () => {
    // `010` is 8 in arithmetic and 10 for `-eq`; nocasematch makes `[[ == ]]` ignore case; a value split into words.
    assert.deepStrictEqual(examples('n=010\n[ "$n" -gt 2 ]'), ['True when → n="3"', 'False when → n="2"']);
    // (The model has no value of `n` read by arithmetic, as the value line has none.)
    assert.deepStrictEqual(examples('n=5\n(( $n > 2 ))'), ['True when → n="3"', 'False when → n="2"']);
    assert.deepStrictEqual(examples('shopt -s nocasematch\nx=ABC\n[[ $x == abc ]]'), ['True when → x="abc"', 'False when → x="abcx"']);
    assert.deepStrictEqual(examples('x="a b"\n[ $x = abc ]'), ['True when → x="abc"', 'False when → x="abcx"']);
    // (A right side of `[[ == ]]` with a glob character is not compared as text by the cases.)
    assert.deepStrictEqual(examples('x=abc\n[[ $x == "a*" ]]'), ['True when → x="a*"', 'False when → x="a*x"']);
  });

  it('keeps the samples where the value is the pattern, or the other side has a tilde (checked with bash)', () => {
    // `x='a*'; [[ abc == $x ]]` is true: the unquoted value is a pattern. Quoted, it is text, and the case is the script's.
    for (const src of ["x='a*'\n[[ abc == $x ]]", "x='a*'\n[[ abc != $x ]]", "y='[ab]c'\n[[ bc = $y ]]"]) {
      assert.ok(!examples(src).some((e) => e.includes("a*") || e.includes('[ab]c')), src);
    }
    assert.strictEqual(succeeds("x='a*'\n[[ abc == $x ]]"), true);
    assert.deepStrictEqual(examples("x='a*'\n[[ abc == \"$x\" ]]"), ['True when → x="abc"', 'False when → x="a*"']);
    assert.strictEqual(succeeds("x='a*'\n[[ abc == \"$x\" ]]"), false);
    // A tilde expands to a home directory: `[[ $x == ~ ]]` with `x='~'` is false.
    assert.deepStrictEqual(examples('x=abc\n[[ $x == ~ ]]'), []);
    assert.deepStrictEqual(examples('[ "$x" = ~ ]'), []);
    assert.strictEqual(succeeds("x='~'\n[[ $x == ~ ]]"), false);
  });

  const patterns: [string, string[], string, boolean][] = [
    ['x=abc\n[[ $x == a* ]]', ['Values that match → abc aapp adata', 'Values that do not match → AAPP xaapp'], 'abc', true],
    ['y=zzz\n[[ $y == a* ]]', ['Values that match → aapp adata aerror', 'Values that do not match → zzz AAPP'], 'zzz', false],
    ['x=abc\n[[ $x =~ ^a ]]', ['Matches → abc a', 'Does not match → 1 A'], 'abc', true],
    ['y=zzz\n[[ $y =~ ^a ]]', ['Matches → a a xyz', 'Does not match → zzz 1'], 'zzz', false],
    ['y=zzz\n[[ $y =~ ^a"b"$ ]]', ['Matches → ab', 'Does not match → zzz a'], 'zzz', false],
  ];
  for (const [src, want, value, matches] of patterns) {
    it(src.replace(/\n/g, '; '), () => {
      assert.deepStrictEqual(examples(src), want);
      assert.strictEqual(want[matches ? 0 : 1].split(' → ')[1].split(' ')[0], value);
      assert.strictEqual(succeeds(src), matches);
    });
  }

  it('keeps the samples where the matchers could read the value otherwise than bash', () => {
    // Not ASCII (the classes take more in other locales); nocasematch not known; an empty value.
    assert.deepStrictEqual(examples('x=é\n[[ $x == a* ]]'), ['Values that match → aapp adata aerror', 'Values that do not match → AAPP xaapp']);
    assert.deepStrictEqual(examples('[ -f a ] && shopt -s nocasematch\nx=abc\n[[ $x =~ ^a ]]'), ['Matches → a a xyz', 'Does not match → 1 A']);
    assert.deepStrictEqual(examples('[ -f a ] && shopt -s nocasematch\nx=abc\n[[ $x == a* ]]'), ['Values that match → aapp adata aerror', 'Values that do not match → AAPP xaapp']);
    assert.deepStrictEqual(examples('x=\n[[ $x == a* ]]'), ['Values that match → aapp adata aerror', 'Values that do not match → AAPP xaapp']);
  });

  it('puts the value of the word of a decided `case` in the section of the branch it takes', () => {
    // `abc` matches `*c` too, but the branch before takes it: bash prints 1.
    const src = 'x=abc\ncase $x in a*) echo 1;; *c) echo 2;; esac';
    assert.deepStrictEqual(examples(src), [
      'Values that take this branch → abc aapp adata', 'Values that do not → AAPP xaapp',
      'Values that take this branch → appc datac errorc', 'Values that do not → abc appc.bak']);
    assert.strictEqual(bash(src, src.split('\n').pop()!), '1\n');
    // Not decided: the samples.
    assert.deepStrictEqual(examples('x=$(cmd)\ncase $x in a*) echo 1;; esac'), ['Values that take this branch → aapp adata aerror', 'Values that do not → AAPP xaapp']);
  });

  it('reads the here-string of `read` with its value', () => {
    const src = 'x=abc\nread -r a b <<< "$x y"';
    assert.deepStrictEqual(examples(src), ['Line read → "abc y"', 'Values stored → a="abc" b="y"']);
    assert.strictEqual(bash(src, `${src.split('\n').pop()}; printf '%s|%s' "$a" "$b"`), 'abc|y');
    assert.deepStrictEqual(examples('x=abc\nread -r a b <<< "$x \\$y"'), ['Line read → "alice 30 tokyo"', 'Values stored → a="alice" b="30 tokyo"']);
    assert.deepStrictEqual(examples('read -r a b <<< "$(cmd) y"'), ['Line read → "alice 30 tokyo"', 'Values stored → a="alice" b="30 tokyo"']);
    assert.deepStrictEqual(examples('x=abc\nread -r a b <<< $x'), ['Line read → "abc"', 'Values stored → a="abc" b=""']);
  });

  it('reads the line of `read` as the bash version set does, with the IFS in effect', () => {
    // (At the end of the last variable, bash 5.3 removes the `\v` of IFS, bash 5.2 does not.)
    const src = "IFS=$'\\v'\nread -r a b <<< 'x\v\vy\v\v'";
    assert.deepStrictEqual(examples(src), ['Line read → "x\\u000b\\u000by\\u000b\\u000b"', 'Values stored → a="x" b="\\u000by\\u000b\\u000b"']);
    assert.deepStrictEqual(examples(src, 'en', '5.3'), ['Line read → "x\\u000b\\u000by\\u000b\\u000b"', 'Values stored → a="x" b="\\u000by"']);
    assert.strictEqual(bash(src, `${src.split('\n').pop()}; printf '%q|%q' "$a" "$b"`), "x|$'\\vy\\v\\v'");
    // (The sample line is joined by the first character of IFS; with no name, REPLY gets the line as it is.)
    assert.deepStrictEqual(examples("IFS=$'\\r'\nread -r a b"), ['Line read → "alice\\r30\\rtokyo"', 'Values stored → a="alice" b="30\\rtokyo"']);
    assert.deepStrictEqual(examples('read -r <<< "  a b  "'), ['Line read → "  a b  "', 'Values stored → REPLY="  a b  "']);
    // (An IFS with byte 1, a mark of bash's own, splits erratically: no example.)
    assert.deepStrictEqual(examples("IFS=$'\\x01'\nread -r a b"), []);
  });
});
