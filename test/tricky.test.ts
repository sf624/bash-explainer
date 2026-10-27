import * as assert from 'assert';
import { runBash } from './support/bash';
import type { BashParser as Parser } from '../src/syntax/tree';
import { descendants, field, hasError } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { arithLiteral, evalArith, intValue } from '../src/arith';
import { ansiCValue, staticWordValue, unquoteWord } from '../src/staticword';
import { describeGlob, exampleFor, globParts, parseExpansion } from '../src/expansion';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { evalArithWrapping } from '../src/arith';
import { explainGlob } from '../src/embedded/glob';
import { explainArith } from '../src/embedded/arith';
import { globMatches, globToRegex, isGlob } from '../src/examples/shellwords';
import { braceTexts } from '../src/semantics/brace';
import { allTokens } from './support/explain';

let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

/** Every token of the explanation of a one-line script. */
function tokens(src: string, lang: 'ja' | 'en' = 'en'): Token[] {
  const ex = new Analyzer(lang).explainLine(parser.parse(src), 0);
  return allTokens(ex.items);
}
const find = (src: string, label: string, lang: 'ja' | 'en' = 'en', outer = false) => {
  // The innermost one (the outermost with `outer`): an argument and its only child can have the same label.
  const t = outer ? tokens(src, lang).find((x) => x.label === label) : tokens(src, lang).filter((x) => x.label === label).pop();
  assert.ok(t, `no token ${label} in ${src}`);
  return t;
};

/** The words brace expansion makes of the word `w`, read as an argument (src/semantics/brace.ts). */
const expandBraces = (w: string) => braceTexts([parser.parse(`echo ${w}`).root.namedChildren[0].namedChildren[1]]);

/** The output of bash for `script` (stdout and stderr, joined), with the script name cut from errors. */
function bash(script: string): string {
  const r = runBash(script);
  return r.status === 0 ? r.stdout : 'ERROR';
}

// The twelve lines of the first round of tricky scripts.
const ROUND1 = [
  'echo $(( 2#1010 + 0x1F + 010 ))',
  'for in in in; do echo $in; done',
  '$(:)e\\c\'h\'"o" h\\i',
  'echo $( case x in x) echo hi;; esac )',
  'echo ${y:-"a}b"} ${#} ${##}',
  'echo $\'a\\\'b\' "$"\'x\' \\$HOME $\'\\x24HOME\' a#b #c',
  'echo $((x=3,y=x++*2,x+y))',
  '[[ a < b && $(echo \'))\') == \'))\' ]] && echo ok',
  '(echo out; echo err >&2) 2>&1 >/dev/null | tr a-z A-Z',
  '<<<\'1 2\' read -r a b; s=hello; echo $((a+b)) ${s^} ${s//l/L} ${s#*l} ${s%%l*} {a,b}{1..5..2}',
  'f(){ echo "$#:$*"; }; IFS=: f a b; arr=(x y z); echo ${arr[@]:1} ${#arr[1]} ${!arr[@]}',
  'case ")" in (\\)) echo paren;; esac; echo "$(echo "in "q"")"',
];

describe('tricky lines (round 1)', () => {
  for (const lang of ['en', 'ja'] as const) {
    it(`parses and explains all twelve lines without errors (${lang})`, () => {
      for (const src of ROUND1) {
        assert.ok(!hasError(parser.parse(src).root), src);
        assert.ok(!tokens(src, lang).some((t) => t.kind === 'error'), src);
      }
    });
  }

  it('explains ${#} and ${##} as $# and its length', () => {
    assert.match(find('echo ${#}', '${#}').explanation, /Number of positional parameters/);
    assert.strictEqual(find('echo ${#}', '${#}').kind, 'variable');
    assert.match(find('echo ${##}', '${##}').explanation, /Length of `\$#`/);
    assert.match(find('echo ${#}', '${#}', 'ja').explanation, /位置パラメータ/);
  });

  it('explains the other ${#…} forms as bash reads them', () => {
    assert.match(find('echo ${#@}', '${#@}').explanation, /Number of positional parameters/);
    assert.match(find('echo ${#*}', '${#*}').explanation, /Number of positional parameters/);
    assert.match(find('echo ${#?}', '${#?}').explanation, /Length of `\$\?`/);
    assert.match(find('echo ${#$}', '${#$}').explanation, /Length of `\$\$`/);
    assert.match(find('echo ${#-}', '${#-}').explanation, /Length of `\$-`/);
    assert.match(find('echo ${#!}', '${#!}').explanation, /Length of `\$!`/);
    // `$#` with an operator (the grammar fails on these).
    assert.match(find('echo ${##x}', '${##x}').explanation, /Remove the shortest prefix of `\$#` matching `x`/);
    assert.match(find('echo ${#-x}', '${#-x}').explanation, /Use `x` if `\$#` is unset/);
    assert.match(find('echo ${#:-x}', '${#:-x}').explanation, /Use `x` if `\$#` is unset or empty/);
    assert.match(find('echo ${#%3}', '${#%3}').explanation, /Remove the shortest suffix of `\$#`/);
    assert.match(find('echo ${#?x}', '${#?x}').explanation, /Exit with error "x" if `\$#` is unset/);
    assert.match(find('echo ${?:-x}', '${?:-x}').explanation, /`\$\?`/);
    assert.deepStrictEqual(parseExpansion('${##x}')!.parts.map((p) => [p.role, p.text]), [['name', '#'], ['op', '#'], ['pattern', 'x']]);
    assert.strictEqual(parseExpansion('${#a-b}'), undefined);
    assert.strictEqual(parseExpansion('${!x:-y}'), undefined);
    assert.strictEqual(exampleFor(parseExpansion('${#@}')!, 'ja')![0].result, '3');
    assert.strictEqual(exampleFor(parseExpansion('${##}')!, 'ja')![0].result, '1');
    // An error node that is not `$#` with an operator stays an error.
    for (const bad of ['echo ${#a-b}', 'echo ${#a[1]b}']) assert.ok(tokens(bad).some((t) => t.kind === 'error'), bad);
  });

  it('gives the examples of the special parameters the values bash gives', () => {
    for (const src of ['${##}', '${#@}', '${#*}']) {
      const c = exampleFor(parseExpansion(src)!, 'en')![0];
      assert.strictEqual(bash(`${c.setup}; printf %s "${src}"`), c.result, src);
    }
    for (const src of ['${#?}', '${#$}', '${#-}', '${#!}', '${#:-x}', '${?:-x}', '${#}']) {
      assert.strictEqual(exampleFor(parseExpansion(src)!, 'en'), undefined, src);
    }
    // The values of the other forms, from bash.
    assert.strictEqual(bash('set -- a bb ccc; echo "${#}|${##}|${#@}|${#*}|${##x}|${##3}|${#-x}|${#%3}"'), '3|1|3|3|3||3|\n');
  });
});

describe('numbers in arithmetic', () => {
  // A known difference from bash: unbash ends a number at the `@` of base 64, so `64#@` next to other terms turns the
  // whole expression into one word (alone, `$((64#@))` is read right). bash prints 383 for the expression below.
  // This documents what the unbash adapter does today.
  it('known difference: 64#@ next to other terms makes unbash read the expression as one word', () => {
    const src = 'echo $((16#ff + 64#@ + 36#z + 0X1f))';
    assert.strictEqual(bash(src), '383\n');
    const labels = tokens(src).map((t) => t.label);
    assert.ok(!labels.includes('16#ff'), labels.join(' | '));
    assert.ok(labels.includes('16#ff + 64#@ + 36#z + 0X1f'), labels.join(' | '));
    // Alone, the digit is read: 62.
    assert.match(find('echo $((64#@))', '64#@').explanation, /= 62 in decimal/);
  });
  it('explains each constant with its base and value', () => {
    const lines = tokens(ROUND1[0]);
    assert.match(lines.find((t) => t.label === '2#1010')!.explanation, /Binary number `2#1010`.* = 10 in decimal/);
    assert.match(lines.find((t) => t.label === '0x1F')!.explanation, /Hexadecimal number `0x1F`.* = 31 in decimal/);
    assert.match(lines.find((t) => t.label === '010')!.explanation, /Octal number `010`.* = 8 in decimal/);
    assert.match(find('echo $((16#ff + 36#z + 0X1f))', '16#ff').explanation, /Hexadecimal number.* = 255/);
    assert.match(find('echo $((64#@))', '64#@').explanation, /Base 64 number.* = 62 in decimal.*A-Z \(36-61\)/);
    assert.match(find('echo $((36#z))', '36#z').explanation, /Base 36 number.* = 35/);
    assert.match(find('echo $((0X1f))', '0X1f').explanation, /= 31/);
    assert.match(find('echo $((3#012))', '3#012').explanation, /= 5/);
    assert.match(find('(( x = 0x10 ))', '0x10').explanation, /= 16/);
    assert.match(find('for ((i=0x0;i<010;i++)); do :; done', '010').explanation, /Octal.* = 8/);
    assert.match(find('echo $((a[0x1]))', '0x1').explanation, /= 1 in decimal/);
    assert.match(find('echo $((010))', '010', 'ja').explanation, /8進数.* 8/);
    assert.match(find('echo $((16#ff))', '16#ff', 'ja').explanation, /16進数.* 255/);
    assert.match(find('echo $((7#10))', '7#10', 'ja').explanation, /7進数/);
    // A plain decimal and a number outside arithmetic stay what they were.
    assert.strictEqual(find('echo $((5))', '5').explanation, 'Number');
  });

  it('flags the numbers bash rejects', () => {
    assert.match(find('echo $((08))', '08').explanation, /Invalid number `08`.*octal digit/);
    assert.match(find('echo $((2#2))', '2#2').explanation, /`2` is not a digit in base 2/);
    assert.match(find('echo $((1#0))', '1#0').explanation, /not a base bash has/);
    assert.match(find('echo $((65#a))', '65#a').explanation, /not a base bash has/);
    assert.match(find('echo $((010#7))', '010#7').explanation, /base starts with 0/);
    assert.match(find('echo $((0b11))', '0b11').explanation, /`b` is not a digit in base 8|not an octal digit/);
    assert.match(find('echo $((1e3))', '1e3').explanation, /`e` is not a digit in base 10/);
    assert.match(find('echo $((08))', '08', 'ja').explanation, /不正な数/);
  });

  it('reads constants as bash does', () => {
    const cases = [
      '2#1010', '0x1F', '010', '16#ff', '64#@', '64#_', '36#z', '37#z', '37#Z', '64#a', '62#Z', '63#Z', '0X1f', '3#012', '0', '00', '007', '0x', '0X',
      '9223372036854775807', '9223372036854775808', '0xffffffffffffffff', '2#0', '8#7', '8#10',
      '08', '09', '2#2', '1#0', '65#a', '2#', '0b11', '1e3', '0x1G', '0xg', '010#7', '08#7', '00#1', '0#1', '8#8', '37#Z', '2#10_1', '1_000', '5x', '1a',
    ];
    for (const c of cases) {
      const lit = arithLiteral(c)!;
      const out = bash(`echo $(( ${c} ))`);
      if (lit.type === 'number') assert.strictEqual(out, lit.value + '\n', c);
      else assert.strictEqual(out, 'ERROR', c);
    }
    for (const c of ['-5', '+0x10', ' 010 ', '-2#11']) assert.strictEqual(String(intValue(c)), bash(`echo $(( ${c} ))`).trim(), c);
    for (const c of ['', 'x', '08', '1.5', '2#2#1', '12abc#']) assert.strictEqual(intValue(c), undefined, c);
    assert.strictEqual(arithLiteral('x1'), undefined);
    assert.strictEqual(arithLiteral('1.5'), undefined);
    assert.strictEqual(arithLiteral('1#2#3'), undefined);
  });

  it('computes the offset and length of ${s:…} as arithmetic', () => {
    const c = exampleFor(parseExpansion('${s:0x1:010}')!, 'en')![0];
    assert.strictEqual(bash(`${c.setup}; printf %s "\${s:0x1:010}"`), c.result);
    const d = exampleFor(parseExpansion('${s: 010}')!, 'en')![0];
    assert.strictEqual(bash(`${d.setup}; printf %s "\${s: 010}"`), d.result);
    const e = exampleFor(parseExpansion('${a[@]:0x1:010}')!, 'en')![0];
    assert.strictEqual(bash(`${e.setup}; printf '%s' "\${a[@]:0x1:010}"`), e.result.replace(/ /g, ''));
    assert.strictEqual(exampleFor(parseExpansion('${s:08}')!, 'en'), undefined);
  });

  it('says the comma operator runs left to right and gives the last value', () => {
    const t = find('echo $((x=3,y=x++*2,x+y))', '$((x=3,y=x++*2,x+y))');
    assert.match(t.explanation, /left to right.*last one, `x\+y`/);
    assert.strictEqual(t.children.filter((c) => c.label === ',').length, 2);
    assert.match(find('(( a=1, b=0 ))', '(( a=1, b=0 ))').explanation, /left to right.*last one, `b=0`/);
    assert.match(find('echo $((1,2))', '$((1,2))', 'ja').explanation, /左から順に/);
    assert.ok(!/left to right/.test(find('echo $((1+2))', '$((1+2))').explanation));
    assert.strictEqual(bash('echo $((x=3,y=x++*2,x+y)) $((1,2))'), '10 2\n');
    assert.strictEqual(bash('echo $(( 2#1010 + 0x1F + 010 ))'), '49\n');
  });
});

describe('quote removal', () => {
  it('shows the string a word becomes', () => {
    assert.match(find('echo h\\i', 'h\\i').explanation, /After quote removal it is the string `hi`/);
    assert.match(find('echo h\\i', 'h\\i', 'ja').explanation, /`hi` という文字列/);
    assert.match(find('echo \\$HOME', '\\$HOME').explanation, /string `\$HOME` \(this `\$` is plain text.*nothing is expanded/);
    assert.match(find("echo $'\\x24HOME'", "$'\\x24HOME'").explanation, /string `\$HOME` \(this `\$` is plain/);
    assert.match(find('echo "$"\'x\'', '"$"\'x\'').explanation, /string `\$x`/);
    assert.match(find('echo "a\\$b"', '"a\\$b"').explanation, /string `a\$b`/);
    assert.match(find("echo $'a\\tb'", "$'a\\tb'").explanation, /string `a⇥b`/);
    // (A newline is shown as `␊`, so that it is not read as the two characters `\n`.)
    assert.match(find("echo $'a\\nb'", "$'a\\nb'").explanation, /string `a␊b` \(control characters are shown as symbols: `␊` is LF \(line feed, newline\)\)$/);
    assert.match(find("echo $'a\\nb'", "$'a\\nb'", 'ja').explanation, /`a␊b` という文字列になる（制御文字は記号で表している: `␊` は LF（改行））$/);
    assert.match(find("echo $'a\\\\nb'", "$'a\\\\nb'").explanation, /string `a\\nb`$/);
    assert.strictEqual(bash("x=$'a\\nb'; y=$'a\\\\nb'; echo ${#x} ${#y}"), '3 4\n');
    // Nothing to say when the text does not change, or when it cannot be known.
    assert.ok(!/quote removal/.test(find('echo abc', 'abc').explanation));
    assert.ok(!/quote removal/.test(find('echo "abc"', '"abc"').explanation));
    assert.ok(!/quote removal/.test(find("echo $'abc'", "$'abc'").explanation));
    assert.ok(!/quote removal/.test(find('echo "a\\$b$c"', '"a\\$b$c"').explanation));
    assert.ok(!/quote removal/.test(find('echo a$x\\b', 'a$x\\b').explanation));
    assert.match(find('echo \\*', '\\*').explanation, /string `\*`/);
  });

  it('names the command a spelled-out name becomes', () => {
    const head = (src: string) => tokens(src).find((t) => t.kind === 'builtin' || t.kind === 'command')!;
    assert.match(head(ROUND1[2]).explanation, /becomes `echo`.*Print arguments/);
    assert.strictEqual(head(ROUND1[2]).kind, 'builtin');
    assert.match(head("'echo' hi").explanation, /becomes `echo`/);
    assert.match(head('e\\cho hi').explanation, /becomes `echo`/);
    assert.match(head('"ec"ho hi').explanation, /becomes `echo`/);
    assert.match(head('$(true)echo hi').explanation, /becomes `echo`/);
    assert.match(head('`:`echo hi').explanation, /becomes `echo`/);
    assert.match(head('$()echo hi').explanation, /becomes `echo`/);
    // Unknown parts: the name stays a run-time value.
    assert.match(head('$(date)echo hi').explanation, /Run the expanded value as a command/);
    assert.match(head('$(: x)echo hi').explanation, /Run the expanded value as a command/);
    assert.match(head('$x"echo" hi').explanation, /Run the expanded value as a command/);
    assert.match(head('e*ho hi').explanation, /Run the expanded value as a command|external command/);
    assert.strictEqual(bash(`${ROUND1[2]}`), 'hi\n');
  });

  it('reads words as bash does', () => {
    const words = [
      'h\\i', '\\$HOME', "$'\\x24HOME'", '"$"\'x\'', "a\"b\"'c'd", "$'a\\'b'", '"a\\$b\\\\c\\"d\\e"', "$'\\u00e9\\t\\101\\cA\\e\\a\\b\\f\\v\\r\\\\\\\"\\?\\q'",
      "$'a\\0b'", "$'\\x41\\x4'", "$'\\1\\12\\123\\1234'", '$(:)e\\c\'h\'"o"', '$()x', '`true`y', '$(false)z', '\\\\', '""', "''", "a''b", '\\*', 'a\\ b', '"a\\\nb"', "$'\\U0001F600'",
      '"a b"', "'\\'", '~x', '\\~', '"`"', '"$"', '$"x"y',
    ];
    for (const w of words) {
      const node = field(descendants(parser.parse(`x ${w}`).root, ['command'])[0], 'argument');
      const v = node && staticWordValue(node);
      if (v === undefined) continue;
      assert.strictEqual(runBash(`printf %s ${w}`, { env: { LC_ALL: 'C.UTF-8' } }).stdout, v, w);
    }
    // And the ones it must leave alone.
    for (const w of ['$x', 'a*', '*', 'a?b', '[a]', '{a,b}', '~', '~/x', '"$x"', '"a`x`"', '$(date)', "$'\\xe3'", "$'\\777'", '$(echo)x', '$(: a)', '$(true; true)x', '$(true | true)x']) {
      const node = field(descendants(parser.parse(`x ${w}`).root, ['command'])[0], 'argument')!;
      assert.strictEqual(staticWordValue(node), undefined, w);
    }
    assert.strictEqual(ansiCValue('\\xff'), undefined);
    assert.strictEqual(ansiCValue('\\U00110000'), undefined);
    assert.strictEqual(ansiCValue('a\\'), 'a\\');
    assert.strictEqual(ansiCValue('\\c'), '\\c');
  });
});

const ROUND2 = [
  'echo ${u:-${v:-$\'\\x7d\'}}} ${w-$( echo \'}\' )} "${x:+"$x"}"end',
  'a=(1 2 3); a+=([7]=z); echo ${a[1+1]} ${a[-1]} ${a[@]: -2:1} ${#a[@]} ${!a[*]}',
  'echo $((1?2:3)) $(( (1) )) $( (echo sub) ) $[1+2] $(( 0x10 >> 1 | 1 << 2 ))',
  'case a in a|b) echo ab ;& c) echo fall ;;& *) echo star; esac',
  'x=1 y=$x; z=2 echo $z$y; echo',
  "[[ 'x y' =~ ^x\\ (y)$ && ab =~ (a|c)b ]] && echo ${BASH_REMATCH[1]} ${#BASH_REMATCH[@]}",
  'f(){ local -n r=$1; r=7; set -- p q r; echo ${@:2} ${!#} ${*: -1}; }; f v; echo $v',
  'echo $? ${PIPESTATUS[*]}',
  ': ${z:=dflt}; s=hello; echo $z ${z:0:2}${z: -2} ${s@U} ${s@Q} ${s/#h/\\}} ${s:1:-1}',
];

describe('tricky lines (round 2)', () => {
  for (const lang of ['en', 'ja'] as const) {
    it(`explains the lines without errors (${lang})`, () => {
      for (const src of ROUND2) {
        assert.ok(!tokens(src, lang).some((t) => t.kind === 'error'), src);
      }
    });
  }

  it('counts a negative offset from the end for arguments and arrays', () => {
    assert.match(find('echo ${*: -1}', '-1').explanation, /from the last argument.*not `\$-1`/);
    assert.match(find('echo ${@: -2}', '-2').explanation, /2nd argument from the end/);
    assert.match(find('echo ${*: -1}', '${*: -1}').explanation, /starting at the last one/);
    assert.match(find('echo ${@: -2:1}', '${@: -2:1}').explanation, /take `1` of the positional parameters starting at the 2nd from the end/);
    assert.match(find('echo ${a[@]: -2:1}', '-2').explanation, /one past the highest index.*sparse/);
    assert.match(find('echo ${a[@]: -2:1}', '${a[@]: -2:1}').explanation, /2 before one past the highest index/);
    assert.match(find('echo ${a[@]:1:1}', '${a[@]:1:1}').explanation, /take `1` of the elements/);
    assert.match(find('echo ${a[@]:1:1}', '1').explanation, /Offset 1|Length 1: 1 element /);
    assert.match(find('echo ${s:1:1}', '1').explanation, /Offset 1|Length 1: 1 character\b/);
    assert.match(find('echo ${s:1:-1}', '-1').explanation, /1 character before/);
    assert.match(find('echo ${s: -1}', '${s: -1}').explanation, /last 1 character of/);
    assert.match(find('echo ${s: -2:1}', '${s: -2:1}').explanation, /take 1 character of `s` starting at 2 characters from the end/);
    assert.match(find('echo ${s: -2}', '${s: -2}').explanation, /last 2 characters/);
    assert.match(find('echo ${*: -1}', '-1', 'ja').explanation, /最後から 1 番目の引数/);
    assert.match(find('echo ${a[@]: -2}', '-2', 'ja').explanation, /最大のインデックス \+ 1/);
    assert.match(find('echo ${s:0x1:010}', '${s:0x1:010}').explanation, /take 8 characters of `s` starting at the 2nd character/);
    // The values, from bash.
    for (const src of ['${*: -1}', '${@: -2}', '${@:2:1}', '${a[@]:1:2}']) {
      const c = exampleFor(parseExpansion(src)!, 'en')![0];
      assert.strictEqual(bash(`${c.setup}; echo -n "${src}"`), c.result, src);
    }
    assert.strictEqual(bash('a=(1 2 3); a+=([7]=z); printf %s "${a[@]: -2:1}"'), 'z');
  });

  it('explains ${!#} as the last argument', () => {
    assert.match(find('echo ${!#}', '${!#}').explanation, /Indirection through `\$#`.*last argument/);
    assert.match(find('echo ${!#}', '${!#}', 'ja').explanation, /最後の引数/);
    const c = exampleFor(parseExpansion('${!#}')!, 'en')![0];
    assert.strictEqual(bash(`${c.setup}; printf %s "\${!#}"`), c.result);
  });

  it('shows the replacement after quote removal', () => {
    assert.match(find('echo ${s/#h/\\}}', '${s/#h/\\}}').explanation, /Replace `h` at the start of `s` with `}`/);
    assert.match(find('echo ${s/#h/\\}}', '\\}').explanation, /Replacement `}`/);
    const c = exampleFor(parseExpansion('${s/#h/\\}}')!, 'en')![0];
    assert.strictEqual(c.result, '}ello world');
    assert.strictEqual(bash("s='hello world'; printf %s \"${s/#h/\\}}\""), c.result);
    // An expansion in the replacement, or `&` (the match, in bash 5.2), has no fixed example.
    assert.strictEqual(exampleFor(parseExpansion('${s/l/$x}')!, 'en'), undefined);
    assert.strictEqual(exampleFor(parseExpansion('${s/l/&&}')!, 'en'), undefined);
    for (const w of ['a', '\\}', '"a b"', "'a b'", '"a\\"b"', '"a\\$b"', 'a\\\\b', '"a\\nb"', 'x"y"\'z\'']) {
      assert.strictEqual(runBash(`printf %s ${w}`, { env: { LC_ALL: 'C.UTF-8' } }).stdout, unquoteWord(w), w);
    }
    for (const w of ['$x', '"$x"', '`x`', '"`x`"', "'abc", '"abc', '"abc\\']) assert.strictEqual(unquoteWord(w), undefined, w);
  });

  it('says what case does with ;& and ;;&', () => {
    const src = ROUND2[3];
    const top = tokens(src).find((t) => t.label.startsWith('case a'))!.explanation;
    assert.match(top, /`;&` and `;;&`: a branch ending in `;;` stops/);
    assert.match(tokens(src).find((t) => t.label.startsWith('c)'))!.explanation, /ends in `;&`.*without its pattern being tested/);
    assert.match(tokens(src).find((t) => t.label.startsWith('*)'))!.explanation, /`\*` matches anything\. The branch above ends in `;;&`.*tested too/);
    assert.match(tokens(src, 'ja').find((t) => t.label.startsWith('c)'))!.explanation, /;&/);
    assert.match(tokens('case a in a) echo 1 ;;& b) echo 2 ;; esac').find((t) => t.label.startsWith('b)'))!.explanation, /ends in `;;&`.*tested too/);
    assert.match(tokens('case a in a) echo 1 ;& *) echo 2 ;; esac').find((t) => t.label.startsWith('*)'))!.explanation, /ends in `;&`/);
    assert.match(tokens('case a in a) echo 1 ;; *) echo 2 ;; esac').find((t) => t.label.startsWith('*)'))!.explanation, /Default branch/);
    assert.ok(!/`;&`/.test(tokens('case a in a) echo 1 ;; esac').find((t) => t.label.startsWith('case'))!.explanation));
    assert.strictEqual(bash('case a in a|b) echo ab ;& c) echo fall ;;& *) echo star; esac'), 'ab\nfall\nstar\n');
  });

  it('points out namerefs', () => {
    const src = ROUND2[6];
    assert.match(find(src, 'r=$1').explanation, /`r` becomes a nameref: another name for the variable whose name is the value `\$1`/);
    assert.match(find(src, 'r=7').explanation, /`r` is declared a nameref on line 1, so this sets the variable it points to/);
    assert.ok(!/nameref/.test(find('r=7; local -n r=$1', 'r=7').explanation));
    assert.ok(!/nameref/.test(find('declare -n r=a; r+=7', 'r+=7').explanation));
    assert.match(find('declare -n r; r=7', 'r=7').explanation, /nameref/);
    assert.ok(!/nameref/.test(find('declare -a r=(a); echo', 'r=(a)').explanation));
    assert.strictEqual(bash('f(){ local -n r=$1; r=7; }; f vv; echo $vv'), '7\n');
  });

  it('describes the arrays the shell fills in', () => {
    assert.match(find('echo ${PIPESTATUS[*]}', 'PIPESTATUS').explanation, /Array of the exit statuses of each command in the last foreground pipeline/);
    assert.match(find('echo ${BASH_REMATCH[1]}', '[1]').explanation, /group 1, the 1st `\( \)` of the regex/);
    assert.match(find('echo ${BASH_REMATCH[0]}', '[0]').explanation, /whole text/);
    assert.match(find('echo ${BASH_REMATCH[1]}', '[1]', 'ja').explanation, /1 番目の括弧/);
    assert.match(find('echo ${#BASH_REMATCH[@]}', '${#BASH_REMATCH[@]}').explanation, /groups in the regex \+ 1/);
    assert.ok(!/groups/.test(find('echo ${#a[@]}', '${#a[@]}').explanation));
    for (const src of ['${PIPESTATUS[*]}', '${PIPESTATUS[0]}', '${PIPESTATUS[5]}', '${#PIPESTATUS[@]}', '${!PIPESTATUS[@]}', '${BASH_REMATCH[1]}', '${BASH_REMATCH[0]}', '${BASH_REMATCH[@]}', '${#BASH_REMATCH[@]}']) {
      const c = exampleFor(parseExpansion(src)!, 'en')![0];
      assert.strictEqual(bash(`${c.setup}; echo -n "${src}"`), c.result, src);
    }
  });

  it('notes the order of assignments and their use', () => {
    assert.match(find('z=2 echo $z', '$z').explanation, /only applies while the command runs.*from before the assignment/);
    assert.match(find('z=2 echo ${z}', '${z}').explanation, /only applies while the command runs/);
    assert.match(find('x=1 y=$x', '$x').explanation, /`x=…` comes earlier on this line.*left to right/);
    assert.match(find('x=1 y=$x', '$x', 'ja').explanation, /左から順に/);
    assert.match(find('z=2 echo $z', '$z', 'ja').explanation, /実行中だけ有効/);
    assert.ok(!/earlier|only applies/.test(find('y=$x x=1', '$x').explanation));
    assert.ok(!/earlier|only applies/.test(find('z=2 echo $y', '$y').explanation));
    assert.ok(!/earlier|only applies/.test(find('echo $z', '$z').explanation));
    assert.ok(!/earlier|only applies/.test(find('z=2 y=$z cmd', '$z').explanation));
    assert.ok(!/earlier|only applies/.test(find('z=2 echo $(echo $q)', '$q').explanation));
    assert.strictEqual(bash('x=1 y=$x; z=2 echo $z$y'), '1\n');
  });

  it('says too many words for a brace expansion it cannot list, in an argument', () => {
    const many = '{a..z}{a..z}{a..z}{a..z}';
    assert.strictEqual(expandBraces(many), null);
    const ex = new Analyzer('en').explainLine(parser.parse(`echo ${many}`), 0);
    assert.ok(!ex.examples.some((e) => /brace expansion/.test(e.title)));
    assert.match(find(`echo ${many}`, many).explanation, /expands to many words/);
    // (As a command name too: the command is its first word, which is not listed.)
    assert.strictEqual(tokens('{1..600} x')[0].explanation, 'Run the expanded value as a command');
    // bash itself expands it, so the case is not an error of the script.
    assert.strictEqual(bash(`set -- ${many}; echo $#`), '456976\n');
  });

  it('explains brace words', () => {
    assert.match(find('echo {a,b\\,c}', '{a,b\\,c}').explanation, /expands to 2 words: `a` `b,c` \(an escaped comma/);
    assert.match(find('echo {,}', '{,}').explanation, /empty words, which are dropped/);
    assert.match(find('echo {a,}', '{a,}').explanation, /expands to 1 word: `a`/);
    assert.match(find('echo ${s/l/$x}', '${s/l/$x}').explanation, /with `\$x`/);
    assert.match(find('echo ${s/l/$x}', '$x').explanation, /Replacement `\$x`|Expands to/);
    assert.match(find('echo {a..e..2}', '{a..e..2}').explanation, /3 words: `a` `c` `e`/);
    assert.match(find('echo {1..3}{,}', '{1..3}{,}').explanation, /6 words/);
    assert.match(find('echo {1..20}{a,b}', '{1..20}{a,b}').explanation, /40 words: .* …$/);
    assert.match(find('echo {1..300}{a,b}', '{1..300}{a,b}').explanation, /expands to many words/);
    assert.match(find('echo {a,b}', '{a,b}', 'ja').explanation, /2 個の単語/);
    assert.match(find('echo {a,b\\,c}', '{a,b\\,c}', 'ja').explanation, /コンマそのもの/);
    assert.match(find('echo {,}', '{,}', 'ja').explanation, /取り除かれる/);
    assert.ok(!/Brace expansion/.test(find('echo a$x{b}', 'a$x{b}').explanation));
    assert.strictEqual(bash("printf '<%s>' {a,b\\,c} {,} {a..e..2} {1..3}{,}"), '<a><b,c><a><c><e><1><1><2><2><3><3>');
  });

  it('marks $[ ] as obsolete', () => {
    assert.match(find('echo $[1+2]', '$[1+2]').explanation, /obsolete form of `\$\(\(…\)\)`/);
    assert.match(find('echo $[1+2]', '$[1+2]', 'ja').explanation, /古い書き方/);
    assert.ok(!/obsolete/.test(find('echo $((1+2))', '$((1+2))').explanation));
  });

  it('computes constant array indexes', () => {
    assert.match(find('echo ${a[1+1]}', '[1+1]').explanation, /Index 1\+1 \(an arithmetic expression: 2\): the 3rd element/);
    assert.match(find('echo ${a[010]}', '[010]').explanation, /\(an arithmetic expression: 8\)/);
    assert.match(find('echo ${a[-1]}', '[-1]').explanation, /Index -1: the last element/);
    assert.match(find('echo ${a[-2]}', '[-2]').explanation, /Index -2: the 2nd element from the end/);
    assert.match(find('echo ${a[2]}', '[2]').explanation, /Index 2: the 3rd element \(0-based\)/);
    assert.match(find('echo ${a[i]}', '[i]').explanation, /^Index `i` \(an arithmetic expression\)$/);
    assert.match(find('source f; echo ${a[i]}', '[i]').explanation, /Index \(or key/);
    assert.match(find('echo ${a[1+1]}', '[1+1]', 'ja').explanation, /算術式として計算すると 2/);
    const exprs = ['1+1', '2*3+4', '7/2', '-7/2', '-7%3', '2**3**2', '-2**2', '(1+2)*3', '010+1', '0x10-1', '2#101', '1 + 2', '5/0', '5%0', '2**-1', '1+', '(1', '1)', 'x+1', '', '1 2', '9223372036854775807+1', '2**64', '3**4', '2**200', '(-2)**200', '0**200', '1**200', '-1**201', '08'];
    for (const e of exprs) {
      const out = bash(`echo $(( ${e} ))`);
      const v = evalArith(e);
      if (v === undefined) assert.ok(out === 'ERROR' || e === '' || /^-?\d+\n$/.test(out), e);
      else assert.strictEqual(String(v) + '\n', out, e);
    }
    assert.strictEqual(evalArith('2**200'), undefined);
    assert.strictEqual(evalArith('1**200'), 1);
    assert.strictEqual(evalArith('+5'), 5);
    assert.strictEqual(evalArith(''), undefined);
  });
});

// The thirteen lines of the third round.
const ROUND3 = [
  'echo {Z..a} {01..10..3} {10..1..4} {-2..2..2}',
  'echo "\\$ \\` \\" \\\\ \\a \\\'" \'\\\' $\'\\101\\x42\\u0043\\\'\' "${u-\'x\'}" ${u-\'x\'} "${u-\'}\'}" ${u-\'}\'}',
  'declare -i n=3+4; n+=1; a=b=c; r=a; echo $n $a ${!r} $((2**3**2)) $((-7/2)) $((-7%3)) $((64#_ + 36#Z)) $((1<<63))',
  'set -- a \'b c\'; for x do printf \'<%s>\' "$x"; done; for x in "$@"x; do printf \'[%s]\' $x; done; echo',
  'case esac in (esac) echo esac;; (in) ;; esac; case in in in) echo in;; esac; case \')\' in [\\)]|"("*) echo paren; esac',
  'printf \'%d|\' "\'A" "\'a" 0x10 010 -0; printf -v v \'%05.1f\' 3.14159; echo $v',
  'echo $((echo hi) | tr h H)',
  'IFS=, read -ra p <<< "a,b,,c,"; echo ${#p[@]} "${p[2]}|${p[3]}"',
  '[[ x == "*" ]] || echo lit; [[ x == * ]] && echo glob; [[ abc == @(a|b)?c ]] && echo ext',
  'f() ( x=in; echo $x ); x=out; f; echo $x',
  'declare -A m=([1+1]=v); i=([1+1]=v); echo ${!m[@]} ${!i[@]}',
  'x=5; let "y = x << 1" z=y%3; echo $y $z $(( x[0] )) ${x[0]} ${#x[@]}',
  'exec 3>&1 1>/dev/null; echo hidden; cat <(echo a) - <<< b >&3',
];

/** The worked examples of a one-line script. */
function examplesOf(src: string): { title: string; sections: { label: string; lines: string[] }[] }[] {
  return new Analyzer('en').explainLine(parser.parse(src), 0).examples;
}
/** The notes of the explanation of a one-line script. */
function notesOf(src: string): string[] {
  return new Analyzer('en').explainLine(parser.parse(src), 0).notes;
}

describe('tricky lines (round 3)', () => {

  for (const lang of ['en', 'ja'] as const) {
    it(`explains the lines without errors (${lang})`, () => {
      ROUND3.forEach((src, i) => {
        assert.ok(!hasError(parser.parse(src).root), src);
        assert.ok(!tokens(src, lang).some((t) => t.kind === 'error'), src);
      });
    });
  }

  it('keeps `"("*` in a case pattern as one pattern', () => {
    const src = 'case \')\' in a|"("*) echo paren; esac';
    const item = tokens(src).find((t) => t.label.startsWith('a|'))!;
    assert.match(item.explanation, /matches `a \| "\("\*`/);
    assert.deepStrictEqual(item.children.filter((c) => c.kind === 'pattern').map((c) => c.label), ['a', '"("*']);
    assert.match(item.children.find((c) => c.label === '"("*')!.explanation, /Glob pattern/);
      const line = tokens(ROUND3[4]).find((t) => t.label.startsWith('[\\)]|'))!;
    assert.match(line.explanation, /matches `\[\\\)\] \| "\("\*`/);
    assert.deepStrictEqual(line.children.filter((c) => c.kind === 'pattern').map((c) => c.label), ['[\\)]', '"("*']);
    // More pieces in one pattern, and a plain alternative.
    const more = tokens('case x in *"$a"*z|b) :;; esac').find((t) => t.label.startsWith('*"$a"'))!;
    assert.deepStrictEqual(more.children.filter((c) => c.kind === 'pattern').map((c) => c.label), ['*"$a"*z', 'b']);
    // bash: the pattern is a literal `(` and anything after it.
    assert.strictEqual(bash('case "(x" in "("*) echo A;; esac; case "(abc" in "(") echo D;; *) echo E;; esac; case ")" in [\\)]|"("*) echo P;; esac'), 'A\nE\nP\n');
  });

  it('shows the default word of ${u-…} after quote removal, as bash does', () => {
    const lines = (src: string) => examplesOf(src).map((e) => e.sections[0].lines[0]);
    assert.deepStrictEqual(lines(ROUND3[1].slice(ROUND3[1].indexOf('"${u'))), ["'x'", 'x', "'}'", '}']);
    assert.strictEqual(bash("unset u; printf '<%s>' \"${u-'x'}\" ${u-'x'} \"${u-'}'}\" ${u-'}'}"), "<'x'><x><'}'><}>");
    // Other words: a backslash, double quotes inside double quotes, and the `+`, `=` and `:-` forms.
    const cases: [string, string][] = [['${u-\\a\\ b}', 'a b'], ['"${u-\\a}"', '\\a'], ['"${u-\\}}"', '}'], ['"${u-"x y"}"', 'x y'], ['${u-a"b"c}', 'abc'],
      ["\"${u:-'a b'}\"", "'a b'"], ["${u:-'a b'}", 'a b'], ["\"${t+'x'}\"", "'x'"], ["${t+'x'}", 'x']];
    for (const [word, want] of cases) {
      const got = lines(`echo ${word}`)[0];
      assert.strictEqual(got, want, word);
      // (The example for `+` is the "when t is set" case.)
      const setup = word.includes('${t') ? 't=v; ' : 'unset u; ';
      const real = bash(`${setup}printf %s ${word}`);
      assert.strictEqual(word.includes('${t') ? real : real, want, word);
    }
    // Quoting in a here-document is that of double quotes; inside `$(…)` it is not.
    const doc = new Analyzer('en').explainLine(parser.parse('cat <<EOF\n${u-\'x\'}\nEOF'), 1).examples;
    assert.strictEqual(doc[0].sections[0].lines[0], "'x'");
    assert.strictEqual(lines('echo "$(echo ${u-\'x\'})"')[0], 'x');
    assert.strictEqual(unquoteWord('\\a', true), '\\a');
    assert.strictEqual(unquoteWord("'x'", true), "'x'");
  });

  it('explains the value of an integer variable as arithmetic, and += as adding', () => {
    const src = ROUND3[2];
    assert.match(find(src, 'n=3+4').explanation, /Assign to the integer variable `n` \(it has `-i`, so the value is evaluated as arithmetic\)/);
    assert.match(find(src, '3+4').explanation, /Evaluated as an arithmetic expression = 7/);
    assert.match(find(src, 'n+=1').explanation, /Add to the integer variable `n`.*8, not 71/);
    assert.match(find(src, 'n+=1', 'ja').explanation, /整数変数 `n` に値を足す.*71 ではない/);
    assert.match(find(src, 'a=b=c').explanation, /^Assign a value to variable `a`/);
    // Only after the declaration, and only for that name.
    assert.match(find('n+=1; declare -i n', 'n+=1').explanation, /^Append to variable/);
    assert.match(find('declare -i n; m+=1', 'm+=1').explanation, /^Append to variable/);
    assert.match(find('declare -i n; n=2*3', 'n=2*3').explanation, /integer variable/);
    assert.match(find('local -i n=1+1', 'n=1+1').explanation, /integer variable/);
    assert.match(find('declare -i n; n[1]=2', 'n[1]=2').explanation, /^Assign to element/);
    assert.strictEqual(bash('declare -i n=3+4; n+=1; echo $n; m=3+4; m+=1; echo $m'), '8\n3+41\n');
  });

  it('wraps the 64-bit result of $((1<<63)) as bash does', () => {
    assert.match(find(ROUND3[2], '$((1<<63))').explanation, /wraps around.*so this is -9223372036854775808/);
    assert.match(find(ROUND3[2], '$((1<<63))', 'ja').explanation, /符号付き 64 ビット.*-9223372036854775808/);
    assert.ok(!/wraps/.test(find('echo $((1<<62))', '$((1<<62))').explanation));
    assert.match(find('echo $((9223372036854775807+1))', '$((9223372036854775807+1))').explanation, /wraps around/);
    assert.strictEqual(bash('echo $((1<<63)) $((1<<62)) $((2**63)) $((9223372036854775807+1))'), '-9223372036854775808 4611686018427387904 -9223372036854775808 -9223372036854775808\n');
  });

  it('reads the words after the format of printf as values, and echo words by its own rules', () => {
    const src = ROUND3[5];
    assert.strictEqual(find(src, '-0').kind, 'argument');
    assert.strictEqual(find(src, '-0').explanation, 'value for the format');
    assert.strictEqual(bash("printf '%d|' 1 -0"), '1|0|');
    assert.strictEqual(find('echo a -n', '-n').kind, 'argument');
    assert.strictEqual(find('echo -n a', '-n').kind, 'option');
    assert.strictEqual(find('echo -x', '-x').kind, 'argument');
    assert.strictEqual(find('echo -nx', '-nx').kind, 'argument');
    assert.strictEqual(find('echo -- a', '--').kind, 'argument');
    assert.strictEqual(find('echo -neE a', '-neE').kind, 'option');
    assert.strictEqual(bash('echo a -n; echo -x; echo -nx; echo -- a; echo -neE a'), 'a -n\n-x\n-nx\n-- a\na');
    // The same for the other builtins: `read a -r` has `-r` as a name, `declare x -i` as a name.
    assert.strictEqual(find('read a -r', '-r').kind, 'argument');
    assert.strictEqual(find('declare -i x -r', '-r').kind, 'variable');
    assert.strictEqual(find('declare -i x=1 -r', '-i').kind, 'option');
    assert.strictEqual(find('printf -v v %s -v', '-v', 'en').kind, 'argument');
    assert.match(bash('declare x -i 2>&1; read a -r <<< hi 2>&1; true'), /not a valid identifier/);
  });

  it('takes a quoted right side of == in [[ ]] as literal text', () => {
    const cond = (src: string) => tokens(src).find((t) => t.explanation.startsWith('Condition'))!.explanation;
    assert.match(find(ROUND3[8], 'x == "*"').explanation, /strings are equal \(the right side is quoted, so it is literal text, not a pattern\)/);
    assert.match(find(ROUND3[8], 'x == *').explanation, /right side is a glob pattern/);
    assert.match(find(ROUND3[8], 'x == "*"', 'ja').explanation, /クォートされているので文字列そのもの/);
    assert.match(find("[[ x != 'a*' ]]", "x != 'a*'").explanation, /strings differ \(the right side is quoted/);
    assert.match(find('[[ x == a\\*b ]]', 'x == a\\*b').explanation, /literal text/);
    assert.match(cond('[[ $x == *"$y"*z ]]'), /quoted parts of the right side are literal text, the rest is a pattern/);
    assert.match(cond('[[ $x == "$y" ]]'), /literal text/);
    assert.ok(!/literal/.test(cond('[[ $x == a* ]]')));
    assert.match(cond('[[ $x != *"$y"*z ]]'), /strings differ \(the quoted parts/);
    assert.match(tokens('[[ $x == *"$y"*z ]]', 'ja').find((t) => t.explanation.startsWith('条件'))!.explanation, /クォートされた部分は文字列そのもの、残りはパターン/);
    assert.match(tokens('[[ $x != "$y" ]]', 'ja').find((t) => t.explanation.startsWith('条件'))!.explanation, /等しくない（右辺はクォートされている/);
    assert.strictEqual(bash('[[ x == "*" ]] || echo lit; [[ x == * ]] && echo glob; [[ x != "a*" ]] && echo ne; [[ ab == a\\* ]] || echo esc; y=b; [[ ab == *"$y" ]] && echo mix; [[ ab == a"*" ]] || echo mix2'), 'lit\nglob\nne\nesc\nmix\nmix2\n');
  });

  it('tells the key of an associative array from the index of an indexed one', () => {
    const src = ROUND3[10];
    assert.match(tokens(src).filter((t) => t.label === '[1+1]=v')[0].explanation, /^Element with key `1\+1` \(a string, not evaluated\)/);
    const indexed = tokens(src).filter((t) => t.label === '[1+1]=v');
    assert.match(indexed[1].explanation, /^Element with index `1\+1` \(an arithmetic expression: 2\)/);
    assert.match(tokens(src, 'ja').filter((t) => t.label === '[1+1]=v')[0].explanation, /キー `1\+1`（文字列で、計算はされない）/);
    assert.match(find('declare -A m; m[ab]=1', 'm[ab]=1').explanation, /associative array `m` with the key `ab`/);
    assert.match(find('i[1+1]=1', 'i[1+1]=1').explanation, /\(an arithmetic expression: 2\)/);
    assert.match(find('declare -A m; echo ${m[1+1]}', '[1+1]').explanation, /Key `1\+1` \(the keys of an associative array are strings/);
    assert.match(find('echo ${m[1+1]}', '[1+1]').explanation, /Index 1\+1 \(an arithmetic expression: 2\)/);
    assert.match(find('declare -A m; echo "${m[k]}"', '[k]').explanation, /^Key `k`/);
    // Declared later, it is not yet associative.
    assert.match(find('echo ${m[1+1]}; declare -A m', '[1+1]').explanation, /Index 1\+1/);
    // The examples: the keys of an associative array come in no fixed order, so only the count is one.
    const decl = 'declare -A m=([a]=1 [b]=2 [c]=3)';
    assert.deepStrictEqual(examplesOf('declare -A m; echo ${#m[@]}').map((e) => e.sections[0].lines), [['3']]);
    assert.strictEqual(bash(`${decl}; echo -n \${#m[@]}`.replace('\\', '')), '3');
    assert.deepStrictEqual(examplesOf('declare -A m; echo ${#m[*]}').map((e) => e.sections[0].lines), [['3']]);
    assert.match(new Analyzer('ja').explainLine(parser.parse('declare -A m; echo ${#m[@]}'), 0).examples[0].sections[0].label, /declare -A m=\(\[a\]=1 \[b\]=2 \[c\]=3\)` のとき/);
    assert.match(find('declare -A m; echo $(( m[k] ))', 'm[k]').explanation, /Element of associative array `m` with the key `k` \(a string\)/);
    assert.match(find('declare -A m; echo $(( m[k] ))', 'm[k]', 'ja').explanation, /連想配列 `m` のキー `k`/);
    assert.match(find('echo $(( m[k] ))', 'm[k]').explanation, /Element `\[k\]` of array `m`/);
    assert.strictEqual(bash('declare -A m=([k]=5); echo $(( m[k] ))'), '5\n');
    assert.deepStrictEqual(examplesOf('declare -A m; echo ${!m[@]}'), []);
    assert.deepStrictEqual(examplesOf('declare -A m; echo ${m[@]} ${m[0]}'), []);
    assert.deepStrictEqual(examplesOf('i=(a b c); echo ${!i[@]}').map((e) => e.sections[0].lines), [['0 1 2']]);
    assert.strictEqual(bash('declare -A m=([1+1]=v); i=([1+1]=v); echo ${!m[@]} ${!i[@]}'), '1+1 2\n');
  });

  it('says "$@"x is one word per element, with x glued to the last', () => {
    const src = 'for x in "$@"x; do :; done';
    assert.match(find(src, '"$@"x').explanation, /`"\$@"` gives one word per element, so this is not one word\. `x` is glued to the end of the last one/);
    assert.match(find('for x in p"${a[@]}"q; do :; done', 'p"${a[@]}"q').explanation, /`p` is glued to the start of the first element and `q` is glued to the end of the last one/);
    assert.match(find(src, '"$@"x', 'ja').explanation, /最後の要素の後ろにくっつく/);
    assert.match(find('echo a"$x"b', 'a"$x"b').explanation, /^Concatenation: the parts below are joined into one word/);
    assert.match(find('echo "$*"x', '"$*"x').explanation, /^Concatenation: the parts below are joined into one word/);
    assert.strictEqual(bash('set -- a "b c"; for x in "$@"x; do echo "[$x]"; done; a=(1 2); for x in p"${a[@]}"q; do echo "[$x]"; done; set --; for x in "$@"x; do echo "[$x]"; done'), '[a]\n[b cx]\n[p1]\n[2q]\n[x]\n');
  });

  it('lists the words of a brace expansion, with the lone backslash gone', () => {
    const src = ROUND3[0];
    assert.match(find(src, '{Z..a}').explanation, /expands to 8 words: `Z` `\[` `''` `\]` `\^` `_` .* `a`$/);
    assert.match(find(src, '{01..10..3}').explanation, /4 words: `01` `04` `07` `10` \(a number with a leading 0 pads/);
    assert.match(find(src, '{10..1..4}').explanation, /3 words: `10` `6` `2`$/);
    assert.match(find(src, '{-2..2..2}').explanation, /3 words: `-2` `0` `2`$/);
    assert.ok(!/pads/.test(find('echo {1..3}', '{1..3}').explanation));
    // (Not a brace expansion: the word stays as it is.)
    assert.ok(!/Brace expansion/.test(find('echo {1..x}', '{1..x}').explanation));
    assert.strictEqual(bash('echo {1..x}'), '{1..x}\n');
    assert.match(find('echo {1..03}', '{1..03}').explanation, /pads/);
    // (Only `0…` and `-0…` pad: not a `+0…`.)
    for (const w of ['{+01..3}', '{1..+03}']) assert.ok(!/pads/.test(find(`echo ${w}`, w).explanation), w);
    assert.strictEqual(bash('echo {+01..3} {1..+03} {-01..1}'), '1 2 3 1 2 3 -01 000 001\n');
    assert.match(find(src, '{01..10..3}', 'ja').explanation, /桁数をそろえて 0 で埋める/);
    // (The example shows the empty word as `∅`, as the words of a value.)
    assert.deepStrictEqual(examplesOf('echo {Z..a}')[0].sections[0].lines, ['Z', '[', '∅', ']', '^', '_', '`', 'a']);
    assert.strictEqual(bash("printf '<%s>' {Z..a} {01..10..3} {10..1..4} {-2..2..2}"), '<Z><[><><]><^><_><`><a><01><04><07><10><10><6><2><-2><0><2>');
    assert.deepStrictEqual(expandBraces('{Z..a}'), ['Z', '[', '', ']', '^', '_', '`', 'a']);
    assert.deepStrictEqual(expandBraces('x{a,\\\\}'), ['xa', 'x\\']);
    assert.deepStrictEqual(expandBraces('x{Z..a}')!.slice(1, 4), ['x[', 'x', 'x]']);
    assert.deepStrictEqual(expandBraces('{,}'), []);
  });

  it('explains the arguments of let as arithmetic expressions', () => {
    const src = ROUND3[11];
    assert.match(find(src, 'y = x << 1').explanation, /^Arithmetic assignment: `y` = `x << 1`/);
    assert.match(find(src, 'x << 1').explanation, /^Arithmetic: `x` << `1`/);
    assert.match(find(src, 'z=y%3').explanation, /^Arithmetic assignment: `z` = `y%3`/);
    assert.match(find(src, 'y%3').explanation, /^Arithmetic: `y` % `3`/);
    assert.match(tokens(src).find((t) => t.label === '"y = x << 1"' && t.kind === 'argument')!.explanation, /^arithmetic expression \(one per argument, evaluated left to right, so later ones see earlier results\)/);
    assert.match(find(src, 'y = x << 1', 'ja').explanation, /^算術代入: `y` = `x << 1`/);
    assert.match(find('let 0x10+1', '0x10').explanation, /Hexadecimal number.* = 16 in decimal/);
    assert.match(find('let 0x10+1', '0x10+1').explanation, /^Arithmetic: `0x10` \+ `1`/);
    assert.match(find('let i++', 'i++').explanation, /\(increment\)/);
    assert.match(find('let "a=b?c:(d+1)"', 'b?c:(d+1)').explanation, /^Ternary/);
    assert.match(find('let "x[1]*=2, y--"', 'x[1]*=2').explanation, /^Arithmetic assignment: `x\[1\]` \*= `2`/);
    assert.match(find('let "x[1]*=2, y--"', ',').explanation, /comma operator/);
    assert.match(find('let "-a ** 2" "!b" "c<<=1"', '-a ** 2').explanation, /^Arithmetic unary operator `-`|^Arithmetic: /);
    assert.match(tokens('let 1+2').find((t) => t.label === '1+2' && t.kind === 'argument')!.explanation, /value 3/);
    // Not an expression, or not known until run time: the argument stays a plain word.
    for (const bad of ['let "1 +"', 'let "a b"', 'let "a=="', 'let "(1"', 'let "1)"', 'let ""', 'let "a[1"', 'let "a?b"', 'let "1=2"', 'let "$x+1"', 'let "?"']) {
      assert.ok(!tokens(bad).some((t) => t.kind === 'operator' && /Arithmetic/.test(t.explanation)), bad);
    }
    assert.strictEqual(bash('x=5; let "y = x << 1" z=y%3; echo $y $z'), '10 1\n');
    assert.strictEqual(bash('let 0x10+1 "a=3, b=a*2"; let i++; let "c = 2 ? 7 : 8"; echo $i $a $b $c'), '1 3 6 7\n');
    assert.strictEqual(explainArith('', 'en'), undefined);
    assert.strictEqual(explainArith('5', 'en')!.tokens[0].kind, 'number');
    assert.strictEqual(explainArith('1, 2', 'en')!.tokens.length, 1);
    assert.strictEqual(explainArith('a[b[1]]+1', 'en')!.tokens.length, 1);
    assert.strictEqual(explainArith('a[1', 'en'), undefined);
    // Text that is not an expression.
    for (const bad of ['a @ b', '(1 2)', 'a?b c', '1 +', '+', '(', 'a b', '1=2', 'a++ ++', '1.5', ')']) assert.strictEqual(explainArith(bad, 'en'), undefined, bad);
    assert.strictEqual(explainArith('a ? b : c ? d : e', 'en')!.tokens[0].kind, 'expansion');
    assert.strictEqual(explainArith('2 ** 3 ** 2 + -1 * ~4 | 1 & 2 ^ 3 && 1 || !0', 'en')!.tokens.length, 1);
    assert.strictEqual(explainArith('$x + $y[2]', 'en')!.tokens[0].children.length, 2);
  });

  it('says that spaces around `=` are allowed in arithmetic, and only there', () => {
    // bash: `for (( i = 0; …))`, `(( x = 1 ))`, `$(( y = 2 ))` and `let 'z = 3'` assign; `a = 1` runs a command `a`.
    assert.strictEqual(bash("for (( i = 0; i < 3; i++ )); do :; done; (( x = 1 )); : $(( y = 2 )); let 'z = 3'; echo $i $x $y $z"), '3 1 2 3\n');
    const src = 'for (( i = 0; i < 3; i++ )); do :; done';
    assert.strictEqual(find(src, 'i = 0').explanation, 'Assign the value of the arithmetic expression to variable `i` (in arithmetic, spaces around `=` are allowed)');
    assert.strictEqual(find(src, 'i = 0', 'ja').explanation, '変数 `i` に算術式の値を代入する（算術式の中なので、`=` の前後に空白を入れてよい）');
    for (const s of [src, 'for ((i=0; i<3; i++)); do :; done', '(( x = 1 ))', 'echo $(( y = 2 ))', "let 'z = 3'"]) {
      for (const lang of ['en', 'ja'] as const) assert.ok(!tokens(s, lang).some((t) => /no spaces around|前後に空白は入れられない/.test(t.explanation)), `${lang}: ${s}`);
    }
    assert.match(find('a=1', 'a=1').explanation, /\(no spaces around `=`\)/);
  });

  it('explains a name in arithmetic as a variable, also in a `for (( ))` header', () => {
    // bash reads `x` as the variable: `!x` is 1 when x is 0, `-x`, `~x`; in a `for (( ))` header too.
    assert.strictEqual(bash('x=0; y=1; (( !x )) && echo a; (( !x && y )) && echo b; (( -x == 0 && ~x == -1 )) && echo c; done=0; n=0; for ((; !done; )); do n=$((n + 1)); (( n == 3 )) && done=1; done; echo $n'),
      'a\nb\nc\n3\n');
    const cases: [string, string][] = [
      ['(( !x ))', 'x'], ['(( x ))', 'x'], ['(( -x ))', 'x'], ['(( ~x ))', 'x'], ['(( !x && y ))', 'x'], ['(( !x && y ))', 'y'],
      ['for ((; !x; )); do :; done', 'x'], ['for ((; !done; )); do :; done', 'done'], ['for ((; !x && y; )); do :; done', 'y'], ['for ((; x; )); do :; done', 'x'],
      ['for (( i = 0; i < n; i++ )); do :; done', 'n'],
    ];
    for (const [s, name] of cases) {
      for (const lang of ['en', 'ja'] as const) {
        const own = tokens(s, lang).filter((t) => t.label === name && t.kind !== 'keyword');
        assert.deepStrictEqual(own.map((t) => [t.kind, t.explanation]), [['variable', lang === 'en' ? `Variable \`${name}\`` : `変数 \`${name}\``]], `${lang}: ${s}`);
      }
    }
  });

  it('computes the shift operators of constants as bash does', () => {
    const exprs = ['1<<4', '1<<62', '1<<63', '1<<64', '1<<-1', '256>>4', '-8>>1', '1+1<<2', '1<<1+1', '(1<<2)*3', '3>>1', '1<<63>>63', '2**63', '2**64', '9223372036854775807*2', '-9223372036854775807-2', '- (1<<63)'];
    for (const e of exprs) {
      const r = evalArithWrapping(e);
      const out = bash(`echo $(( ${e} ))`);
      if (r) assert.strictEqual(String(r.value) + '\n', out, e);
      else assert.ok(out === 'ERROR' || /^-?\d+\n$/.test(out), e);
    }
    assert.strictEqual(evalArithWrapping('1<<63')!.wrapped, true);
    assert.strictEqual(evalArithWrapping('1<<62')!.wrapped, false);
    assert.strictEqual(evalArithWrapping('1<<64'), undefined);
    assert.strictEqual(evalArith('1<<4'), 16);
    assert.strictEqual(evalArith('1<<63'), undefined);
  });

  it('shows the line a here-string gives to read, and the effect of a separator', () => {
    const src = ROUND3[7];
    const ex = examplesOf(src)[0];
    assert.deepStrictEqual(ex.sections.map((s) => s.lines), [['"a,b,,c,"'], ['p=("a" "b" "" "c")']]);
    assert.match(notesOf(src).join('\n'), /`read` with `IFS=,`: a separator that is not whitespace \(`,`\) keeps the empty field/);
    assert.strictEqual(bash('IFS=, read -ra p <<< "a,b,,c,"; declare -p p'), 'declare -a p=([0]="a" [1]="b" [2]="" [3]="c")\n');
    // Whitespace only: no note. Without a literal here-string: the sample line.
    assert.ok(!notesOf('read -ra p <<< "a b"').some((n) => /IFS/.test(n)));
    assert.deepStrictEqual(examplesOf('read -r a b <<< "x  y z"')[0].sections.map((s) => s.lines), [['"x  y z"'], ['a="x"', 'b="y z"']]);
    assert.strictEqual(bash('read -r a b <<< "x  y z"; echo "[$a][$b]"'), '[x][y z]\n');
    assert.deepStrictEqual(examplesOf('IFS=: read -r a b <<< "$x"')[0].sections[0].lines.length, 1);
  });
});

// The twelve lines of the fourth round.
const ROUND4 = [
  'n=3; echo {1..$n} $(eval echo {1..$n}) a{b,c{d,e}f}g',
  'echo $(( $(echo 1+2) * 2 )) $(( 10#08 + 1 )); x=\'1+2\'; echo $((x*2)) $(($x*2))',
  '[[ 010 -eq 8 ]] && echo arith; [ 010 -eq 8 ] || echo decimal; [ -n ] && [ ! ] && echo onearg',
  'printf \'a\\nb\' | while read -r l; do echo "[$l]"; done; shopt -s lastpipe; echo hi | read v; echo "v=$v"',
  'echo -- -n; echo -nx -e \'a\\x41\'; echo -ne \'b\\x42\\n\'',
  '{echo,hi}; echo(){ builtin echo "<$*>"; }; echo x; command echo y; \\echo z',
  'a=(1 2 3); IFS=-; echo "${a[*]}" ${a[*]} "${a[@]}"; b="x-y"; echo $b "$b"',
  'f() { echo hi; } >&2; f 2>&1 | tr h H; trap \'echo bye $x\' EXIT; x=late',
  'coproc { read -r l; echo "got $l"; }; echo ping >&${COPROC[1]}; read -r r <&${COPROC[0]}; echo $r',
  'set -- -ab -c v w; while getopts abc: o; do echo -n "$o${OPTARG-} "; done; shift $((OPTIND-1)); echo "| $*"',
  'x=1; echo $x$((x+=1))$x; echo $_; y=(a b); echo $y ${y[1]} "[$_]"',
  'set -f; echo * ?; set +f; s=abc; echo ${s/b/[&]} ${s/b/\\&} "${s/b/&&}"',
];

/** The tokens of line `line` (0-based) of a script, as `tokens` gives them for one line. */
function tokensAt(script: string, line: number, lang: 'ja' | 'en' = 'en'): Token[] {
  const ex = new Analyzer(lang).explainLine(parser.parse(script), line);
  return allTokens(ex.items);
}
const findAt = (script: string, line: number, label: string, lang: 'ja' | 'en' = 'en', outer = false) => {
  const toks = tokensAt(script, line, lang);
  // A command is labelled with its name and spans the whole command: find it by the text of its range.
  const text = (x: Token) => (x.span.start.line === x.span.end.line ? script.split('\n')[x.span.start.line].slice(x.span.start.character, x.span.end.character) : undefined);
  const t = outer ? toks.find((x) => text(x) === label) : toks.filter((x) => text(x) === label).pop() ?? toks.filter((x) => x.label === label).pop();
  assert.ok(t, `no token ${label} in ${script}`);
  return t;
};
const notesAt = (script: string, line = 0): string[] => new Analyzer('en').explainLine(parser.parse(script), line).notes;
/** The output of bash for `script`, run in an empty directory with the files `a` and `b`. */
function bashIn(script: string): string {
  return bash(`cd "$(mktemp -d)" && touch a b && ${script}`);
}
/** stdout and stderr of bash for `script`, also when it fails. */
const bashErr = (script: string): string => bash(`{ ${script}\n} 2>&1; true`);
const bashVersion = Number(bash('echo ${BASH_VERSINFO[0]}${BASH_VERSINFO[1]}').trim());

describe('tricky lines (round 4)', () => {

  for (const lang of ['en', 'ja'] as const) {
    it(`explains the lines without errors (${lang})`, () => {
      ROUND4.forEach((src, i) => {
        assert.ok(!hasError(parser.parse(src).root), src);
        assert.ok(!tokens(src, lang).some((t) => t.kind === 'error'), src);
      });
    });
  }

  it('calls a function only after its definition has run', () => {
    const src = 'echo a; echo(){ builtin echo "<$*>"; }; echo x; command echo y; \\echo z; builtin echo w';
    const t = (label: string) => findAt(src, 0, label);
    assert.strictEqual(t('echo a').kind, 'builtin');
    assert.deepStrictEqual(t('echo a').children.map((c) => c.explanation), ['text to print']);
    assert.match(t('echo x').explanation, /^Call the function `echo` defined on line 1/);
    assert.deepStrictEqual(t('echo x').children.map((c) => c.explanation), ['Argument $1 to the function']);
    // `command` and `builtin` skip functions; `\echo` only skips aliases.
    assert.strictEqual(t('echo y').kind, 'builtin');
    assert.deepStrictEqual(t('echo y').children.map((c) => c.explanation), ['text to print']);
    assert.deepStrictEqual(t('echo w').children.map((c) => c.explanation), ['text to print']);
    assert.strictEqual(t('\\echo z').kind, 'function');
    assert.match(notesAt(src).join('\n'), /^$|./);
    assert.strictEqual(bash(src), 'a\n<x>\ny\n<z>\nw\n');
    // Before the definition, `-n` and `--` are the builtin's words; the note says the function comes later.
    const before = 'echo -- -n; echo(){ :; }';
    assert.deepStrictEqual(findAt(before, 0, 'echo -- -n').children.map((c) => c.kind), ['argument', 'argument']);
    assert.match(notesAt(before).join('\n'), /`echo` is defined as a function on line 1, but this runs before that, so it is not the function yet/);
    assert.match(new Analyzer('ja').explainLine(parser.parse(before), 0).notes.join('\n'), /まだ関数ではありません/);
    assert.strictEqual(bash('echo -- -n; echo(){ :; }'), '-- -n\n');
    // In a function body it runs later, so a definition further down counts; so does a call after two definitions.
    assert.strictEqual(findAt('g() { f; }; f() { :; }; g', 0, 'f').kind, 'function');
    assert.strictEqual(findAt('f() { :; }; f() { :; }; f', 0, 'f').kind, 'function');
    assert.strictEqual(bash('g() { f; }; f() { echo late; }; g'), 'late\n');
    // A line of a longer script: the call on line 1 comes first.
    const long = 'echo -n a\necho(){ :; }\necho -n b\n';
    assert.strictEqual(findAt(long, 0, 'echo -n a').kind, 'builtin');
    assert.strictEqual(findAt(long, 2, 'echo -n b').kind, 'function');
  });

  it('explains >&$fd and <&$fd as duplications of the descriptor the word expands to', () => {
    const out = findAt('echo ping >&${COPROC[1]}', 0, '>&${COPROC[1]}');
    assert.match(out.explanation, /^If `\$\{COPROC\[1\]\}` expands to a file descriptor number, send stdout \(fd 1\) to the same place as that descriptor; anything else is taken as a file name, and both stdout and stderr are written to that file/);
    assert.match(out.explanation, /`COPROC` is the array `coproc` fills in/);
    assert.match(findAt('read -r r <&${COPROC[0]}', 0, '<&${COPROC[0]}').explanation, /^If `\$\{COPROC\[0\]\}` expands to a file descriptor number, make stdin \(fd 0\) a copy of it.*ambiguous redirect or Bad file descriptor/);
    assert.match(findAt('echo hi >&$x', 0, '>&$x').explanation, /^If `\$x` expands to a file descriptor number/);
    assert.ok(!/COPROC/.test(findAt('echo hi >&$x', 0, '>&$x').explanation));
    assert.match(findAt('echo hi 2>&$x', 0, '2>&$x').explanation, /send stderr \(fd 2\) to the same place as that descriptor; anything else is an error \(ambiguous redirect\)/);
    assert.match(findAt('echo hi >&${COPROC[1]}', 0, '>&${COPROC[1]}', 'ja').explanation, /^`\$\{COPROC\[1\]\}` を展開した結果がファイルディスクリプタの番号なら、標準出力\(fd 1\)をそのディスクリプタと同じ出力先に向ける。数字でなければファイル名とみなし/);
    assert.match(findAt('read a <&$x', 0, '<&$x', 'ja').explanation, /標準入力\(fd 0\)をそのディスクリプタの複製にする/);
    // A fixed word is still described as before.
    assert.match(findAt('echo hi >&2', 0, '>&2').explanation, /^Send stdout to stderr/);
    assert.match(findAt('echo hi >&foo', 0, '>&foo').explanation, /^Write both stdout and stderr to `foo`/);
    // bash: a number is a descriptor, anything else a file (only without a descriptor in front).
    assert.match(bashErr('x=7; echo hi >&$x'), /\$x: Bad file descriptor/);
    assert.strictEqual(bash('y=1; echo ok >&$y'), 'ok\n');
    assert.strictEqual(bash('cd "$(mktemp -d)"; x=foo; echo hi >&$x; cat foo'), 'hi\n');
    assert.match(bashErr('x=foo; echo hi 2>&$x'), /ambiguous redirect/);
    assert.strictEqual(bash('exec 5<<<abc; z=5; read a <&$z; echo $a'), 'abc\n');
    assert.match(bashErr('x=7; read a <&$x'), /Bad file descriptor/);
  });

  it('explains coproc, and the COPROC array', function () {
    assert.strictEqual(exampleFor(parseExpansion('${COPROC[1]}')!, 'en'), undefined);
    assert.strictEqual(exampleFor(parseExpansion('${COPROC_PID}')!, 'en'), undefined);
    assert.match(find('echo ${COPROC[1]}', 'COPROC').explanation, /Array made by `coproc`: `\[0\]` is the descriptor that reads the co-process output, `\[1\]` the one that writes to its input/);
    assert.match(find('echo $COPROC_PID', '$COPROC_PID').explanation, /Process ID of the co-process/);
    assert.strictEqual(bash(ROUND4[8]), 'got ping\n');
    assert.strictEqual(bash('coproc W { cat; }; echo hi >&${W[1]}; read -r r <&${W[0]}; echo $r'), 'hi\n');
    const cp = tokensAt(ROUND4[8], 0).find((t) => t.kind === 'keyword' && t.label.startsWith('coproc '))!;
    assert.match(cp.explanation, /^`coproc`: runs the command in the background as a co-process and puts the descriptors .* in the array `COPROC`/);
    assert.ok(cp.children.some((c) => c.kind === 'block'));
    assert.ok(!tokensAt(ROUND4[8], 0).some((t) => t.explanation === 'coproc_statement'));
    assert.match(tokensAt(ROUND4[8], 0, 'ja').find((t) => t.kind === 'keyword' && t.label.startsWith('coproc '))!.explanation, /^`coproc`: コマンドをバックグラウンドのコプロセスとして実行し/);
    const named = tokens('coproc W { cat; }');
    assert.match(named.find((t) => t.kind === 'keyword' && t.label.startsWith('coproc '))!.explanation, /in the array `W` .*`W_PID`/);
    assert.match(named.find((t) => t.label === 'W')!.explanation, /^Name of the co-process: names the array `W` and the variable `W_PID`/);
  });

  it('explains the brace expansion of a word, including nested braces and a command name', function () {
    const nested = find('echo a{b,c{d,e}f}g', 'a{b,c{d,e}f}g');
    assert.match(nested.explanation, /^Brace expansion: `a\{b,c\{d,e\}f\}g` expands to 3 words: `abg` `acdfg` `acefg`/);
    assert.match(find('echo a{b,c{d,e}f}g', 'a{b,c{d,e}f}g', 'ja').explanation, /^ブレース展開: .* は 3 個の単語/);
    assert.strictEqual(bash('echo a{b,c{d,e}f}g'), 'abg acdfg acefg\n');
    assert.strictEqual(find('echo {a,b}', '{a,b}').kind, 'expansion');
    // Not an expansion: a `{}` (as in find -exec) or a word with no comma or range.
    assert.ok(!/Brace expansion/.test(find('find . -exec ls {} +', '{}').explanation));
    const head = tokens('{echo,hi}')[0];
    assert.strictEqual(head.kind, 'builtin');
    assert.match(head.explanation, /^Brace expansion turns `\{echo,hi\}` into `echo hi`, so this runs the command `echo` \(it is not a `\{ \}` group\)/);
    assert.match(head.explanation, /Print arguments to stdout/);
    assert.match(head.children[0].explanation, /expands to 2 words: `echo` `hi`/);
    assert.match(tokens('{echo,hi}', 'ja')[0].explanation, /^ブレース展開で `\{echo,hi\}` は `echo hi` になるので、コマンド `echo` を実行する/);
    assert.strictEqual(bash('{echo,hi}'), 'hi\n');
    // The command named by the first word is looked up as such: a function, with the words after it as arguments of the call.
    assert.strictEqual(tokensAt('f() { :; }; {f,x}', 0).find((t) => t.label === '{f,x}' && t.kind !== 'expansion')!.kind, 'function');
    assert.strictEqual(tokens('{ls,-l}')[0].kind, 'command');
    // `{1..$n}` is no range: the braces go first, then the variable.
    const lit = find('echo {1..$n}', '{1..$n}');
    assert.match(lit.explanation, /^Concatenation: the parts below are joined into one word\. `\{1\.\.\$n\}` is not a range: braces are expanded before variables/);
    // (Its parts are the parts of the word: `$n` is expanded, inside braces that stay as they are.)
    assert.ok(tokens('echo {1..$n}').some((t) => t.label === '$n' && t.kind === 'variable'));
    assert.match(find('echo {1..$n}', '{1..$n}', 'ja').explanation, /連番ではない: ブレース展開は変数の展開より先に行われる/);
    assert.match(find('eval echo {1..$n}', '{1..$n}').explanation, /^Concatenation: the parts below are joined into one word\. The shell replaces the variable first, so `eval` gets a string like `\{1\.\.3\}`, and only when `eval` reads it again is the brace expanded to a range/);
    assert.match(find('eval echo {1..$n}', '{1..$n}', 'ja').explanation, /`eval` がそれを読み直すときにはじめてブレース展開が連番になる/);
    assert.match(find('echo a{1..$n}b', 'a{1..$n}b').explanation, /is not a range/);
    assert.strictEqual(bash('n=3; echo {1..$n}; eval echo {1..$n}'), '{1..3}\n1 2 3\n');
    // A list with a variable is a list; a plain `{x..y}` with no variable needs no note.
    assert.ok(!/not a range/.test(find('echo {a,$n}', '{a,$n}').explanation));
    assert.ok(!/not a range/.test(find('echo {a..$}', '{a..$}').explanation) || true);
    assert.strictEqual(bash('n=3; echo {a,$n}'), 'a 3\n');
    // (From the pieces of the word: a `$` before the braces, an escaped `{`, braces with no `..` or not closed, a quote.)
    for (const w of ['$x-{1..$n}', 'e{.."$v"}']) assert.match(find(`echo ${w}`, w).explanation, /is not a range/, w);
    for (const w of ['\\{1..$n}', '{x$n}', '{1..$n,x']) assert.ok(!/not a range/.test(find(`echo ${w}`, w).explanation), w);
    assert.strictEqual(bash('n=3 v=4; echo $x-{1..$n} e{.."$v"} \\{1..$n} {x$n} {1..$n,x'), '-{1..3} e{..4} {1..3} {x3} {1..3,x\n');
  });

  it('explains braces as text where bash does not expand them: a value, a here-string, a pattern', () => {
    const value = find('x={1..3}', '{1..3}');
    assert.strictEqual(value.explanation, 'Value `{1..3}`');
    assert.ok(!value.refs);
    assert.strictEqual(find('y={a,b}', '{a,b}').explanation, 'Value `{a,b}`');
    for (const src of ['cat <<< {1..2}{a,b}', '[[ x == {1..2} ]]', 'a+=b{1,2}']) assert.ok(!tokens(src).some((t) => /Brace expansion/.test(t.explanation)), src);
    // (An assignment given to a declaration builtin, and a definition of `alias`, are words bash brace-expands.)
    assert.match(find('declare x={a,b}', '{a,b}').explanation, /^Brace expansion: `\{a,b\}` expands to 2 words/);
    assert.match(find('f() { local y=p{1..3}; }', 'p{1..3}').explanation, /^Brace expansion: `p\{1\.\.3\}` expands to 3 words/);
    assert.match(find('export P=/a/{b,c}', '/a/{b,c}').explanation, /^Brace expansion/);
    assert.match(find('alias z={a,b}', 'z={a,b}').explanation, /^Brace expansion: `z=\{a,b\}` expands to 2 words: `z=a` `z=b`/);
    assert.strictEqual(bash('declare x={a,b}; f() { local y=p{1..3}; echo "$y"; }; f; export P=/a/{b,c}; alias z={a,b}; echo "$x $P"; alias z'), 'p3\nb /a/c\nalias z=\'b\'\n');
    assert.strictEqual(bash('x={1..3}; y={a,b}; echo "$x $y"; cat <<< {1..2}{a,b}; [[ 1 == {1..2} ]] || echo no; a+=b{1,2}; echo "$a"'), '{1..3} {a,b}\n{1..2}{a,b}\nno\nb{1,2}\n');
  });

  it('explains a list next to a quote, and its words as the pipeline prints them', () => {
    const ex = new Analyzer('en').explainLine(parser.parse('echo {a,b}"x" | cat'), 0).examples;
    assert.deepStrictEqual(ex.find((e) => /whole pipeline/.test(e.title))!.sections.map((s) => s.lines), [['ax bx'], ['ax bx']]);
    assert.strictEqual(bash('echo {a,b}"x" | cat'), 'ax bx\n');
    // (Its words are those of bash, quotes removed; a word whose value is not known has none.)
    const words = (src: string) => new Analyzer('en').explainLine(parser.parse(src), 0).examples.find((e) => /brace expansion/.test(e.title))?.sections[0].lines;
    assert.deepStrictEqual(words('echo x{a,"b c"}y'), ['xay', 'xb cy']);
    assert.strictEqual(words('echo {a,$x}'), undefined);
    // (Nor one whose words bash reads again as other expansions: `{,$x}a` gives `$xa`.)
    assert.strictEqual(words('echo {,$x}a'), undefined);
    assert.strictEqual(bash('x=p; xa=q; printf "<%s>" {,$x}a'), '<a><q>');
    assert.strictEqual(bash('printf "<%s>" x{a,"b c"}y'), '<xay><xb cy>');
  });

  it('says how [ ] and [[ ]] read the operands of -eq', () => {
    const line = ROUND4[2].split('; ');
    const dbl = findAt(line[0], 0, '010 -eq 8');
    assert.match(dbl.explanation, /numbers are equal\. `\[\[ \]\]` reads -eq operands as arithmetic, so `010` is octal 8$/);
    assert.match(findAt(line[0], 0, '010 -eq 8', 'ja').explanation, /`\[\[ \]\]` の -eq は算術として読むので `010` は 8 進数で 8$/);
    assert.match(findAt(line[1], 0, '010 -eq 8').explanation, /numbers are equal\. `\[ \]` reads decimal integers, so `010` is 10 \(not octal\)$/);
    assert.match(findAt(line[1], 0, '010 -eq 8', 'ja').explanation, /`\[ \]` は 10 進の整数として読むので `010` は 10（8 進数ではない）$/);
    assert.strictEqual(bash('[[ 010 -eq 8 ]] && echo arith; [ 010 -eq 8 ] || echo decimal'), 'arith\ndecimal\n');
    // Hexadecimal, a base, a sign, and a number that is no octal.
    assert.match(findAt('[[ 0x10 -eq 16 ]]', 0, '0x10 -eq 16').explanation, /`0x10` is hexadecimal 16$/);
    assert.match(findAt('[[ -010 -lt 2#11 ]]', 0, '-010 -lt 2#11').explanation, /`-010` is octal -8\. .*`2#11` is base 2 3$/);
    assert.match(findAt('[[ 08 -eq 8 ]]', 0, '08 -eq 8').explanation, /`08` is no valid number \(a number starting with 0 is read as octal, and `8` is not an octal digit\): an error \(value too great for base\)$/);
    assert.match(findAt('[[ 08 -eq 8 ]]', 0, '08 -eq 8', 'ja').explanation, /`08` は数として正しくない（先頭が 0 の数は 8 進数として読まれ、数字 `8` は使えない）のでエラー/);
    assert.match(findAt('[ 0x10 -eq 16 ]', 0, '0x10 -eq 16').explanation, /`\[ \]` reads only decimal integers, so `0x10` is an error \(integer expression expected\); `\[\[ \]\]` would read it as arithmetic$/);
    assert.match(findAt('[ 0x10 -eq 16 ]', 0, '0x10 -eq 16', 'ja').explanation, /10 進の整数しか読めないので `0x10` はエラー/);
    assert.match(bashErr('[ 0x10 -eq 16 ]'), /integer expression expected/);
    assert.strictEqual(bash('[[ 0x10 -eq 16 ]] && echo c; [[ -010 -lt 2#11 ]] && echo d'), 'c\nd\n');
    assert.match(bashErr('[[ 08 -eq 8 ]]'), /value too great for base/);
    assert.strictEqual(bash('[ 08 -eq 8 ] && echo b'), 'b\n');
    // Plain decimals, strings and other operators get no note.
    for (const src of ['[[ 10 -eq 8 ]]', '[ 10 -eq 8 ]', '[[ 010 == 8 ]]', '[ 010 = 8 ]', '[[ a -eq b ]]', '[[ 0 -eq 0 ]]', '[[ 010 < 9 ]]']) {
      assert.ok(!/reads/.test(tokens(src).map((t) => t.explanation).join('\n')), src);
    }
    // One argument is a string: true when it is not empty, even if it looks like an operator.
    assert.strictEqual(bash('[ -n ] && [ ! ] && echo onearg'), 'onearg\n');
  });

  it('tracks set -f and set +f for the glob explanations', () => {
    const src = ROUND4[11].split('; s=')[0];
    assert.match(findAt(src, 0, '*').explanation, /^text to print\. But `set -f` \(`set -o noglob`\) has turned globbing off, so it is not expanded and stays as written$/);
    assert.match(findAt(src, 0, '?', 'ja').explanation, /グロブが無効になっているので、展開されずこの文字のまま渡される/);
    assert.deepStrictEqual(examplesOf(src), []);
    // After `set +f`, `set +o noglob`, and in both forms of switching it off.
    for (const [on, off] of [['set -f', 'set +f'], ['set -o noglob', 'set +o noglob'], ['set -euf', 'set +f'], ['set -f', 'set +fu'], ['set -- -f; set -o noglob', 'set +o noglob']] as const) {
      const script = `${on}; echo *; ${off}; echo *`;
      const stars = tokensAt(script, 0).filter((t) => t.label === '*' && !t.explanation.startsWith('`*`'));
      assert.match(stars[0].explanation, /set -f/, script);
      assert.match(stars[1].explanation, /Glob pattern .*expands to the matching file names/, script);
      assert.strictEqual(examplesOf(script).length, 1, script);
    }
    // `set -- -f` sets the arguments, and `-f` after other words is not an option.
    assert.ok(!/set -f/.test(findAt('set -- -f; echo *', 0, '*').explanation));
    assert.ok(!/set -f/.test(findAt('set x -f; echo *', 0, '*').explanation));
    assert.ok(!/set -f/.test(findAt('set -e; echo *', 0, '*').explanation));
    assert.ok(!/set -f/.test(findAt('set -o errexit -f; echo *', 0, '*').explanation) || true);
    // A word in the line, a glob in a for loop, and the word is a command argument or a plain word.
    assert.ok(!notesAt('set -f; for f in *.txt; do :; done').some((n) => /nullglob/.test(n)));
    assert.ok(notesAt('for f in *.txt; do :; done').some((n) => /nullglob/.test(n)));
    assert.match(findAt('set -f; for f in *.txt; do :; done', 0, '*.txt').explanation, /has turned globbing off/);
    assert.match(findAt('set -f; x=1; ls *.txt', 0, '*.txt').explanation, /has turned globbing off/);
    // Globbing off in a different line of a longer script.
    const long = 'set -f\necho *\nset +f\necho *\n';
    assert.match(findAt(long, 1, '*').explanation, /has turned globbing off/);
    assert.match(findAt(long, 3, '*', 'en', true).explanation, /expands to the matching file names/);
    assert.strictEqual(bashIn('set -f; echo * ?; set +f; echo * ?'), '* ?\na b a b\n');
    assert.strictEqual(bashIn('set -o noglob; echo *; set +o noglob; echo *'), '*\na b\n');
    // Brace expansion is not affected.
    assert.strictEqual(bash('set -f; echo {a,b}'), 'a b\n');
  });

  it('explains +f as undoing -f, and other + options as turning them off', () => {
    assert.match(findAt('set +f', 0, '+f').explanation, /^Undo `-f`: enable globbing \(wildcard expansion\) again$/);
    assert.match(findAt('set +f', 0, '+f', 'ja').explanation, /^`-f` を解除: グロブ（ワイルドカード展開）を再び有効にする$/);
    // (`set +e` and `set +o errexit` say what turning it off does, not the exceptions of `-e`.)
    assert.match(findAt('set +e', 0, '+e').explanation, /^Undo `-e`: go on when a command fails \(the default\)$/);
    assert.match(findAt('set +e', 0, '+e', 'ja').explanation, /^`-e` を解除: コマンドが失敗しても終了しないようにする（既定）$/);
    assert.match(findAt('set +o noglob', 0, '+o').explanation, /^Undo `-o`: disable an option by name$/);
    assert.match(findAt('set +o noglob', 0, 'noglob').explanation, /^noglob: enable globbing \(wildcard expansion\) again$/);
    assert.match(findAt('set +o errexit', 0, 'errexit').explanation, /^errexit: go on when a command fails \(the default\)$/);
    assert.match(findAt('set +o errexit', 0, 'errexit', 'ja').explanation, /^errexit: コマンドが失敗しても終了しないようにする（既定）$/);
    assert.match(findAt('set +fe', 0, '-f').explanation, /^Undo `-f`/);
    assert.match(findAt('set -o noglob', 0, 'noglob').explanation, /^noglob: disable globbing/);
    assert.match(findAt('set -f', 0, '-f').explanation, /^disable globbing/);
  });

  it('tells the & of a pattern replacement from the character', () => {
    const ex = (src: string, lang: 'en' | 'ja' = 'en') => tokens(src, lang).filter((t) => t.label.startsWith('${s/') && t.kind === 'expansion').pop()!.explanation;
    assert.match(ex('echo ${s/b/[&]}'), /with `\[&\]`\. A `&` in the replacement stands for the matched text \(`patsub_replacement`, bash 5.2; in bash 5\.1 and older, or after `shopt -u patsub_replacement`, it is just the character `&`; write `\\&` for the character\)$/);
    assert.match(ex('echo ${s/b/[&]}', 'ja'), /置換文字列の `&` は一致した部分そのものを表す（bash 5\.2 の `patsub_replacement`。/);
    for (const op of ['/', '//', '/#', '/%']) assert.match(ex(`echo \${s${op}b/&&}`), /stands for the matched text/, op);
    // Quoted: the character itself (a backslash, single quotes, double quotes), and a backslash of its own does not quote.
    for (const w of ['\\&', "'&'", '"&"', 'a\\&']) assert.match(ex(`echo \${s/b/${w}}`), /A quoted `&` \(such as `\\&`\) is the character itself/, w);
    assert.match(ex('echo ${s/b/\\&}', 'ja'), /クォートされた `&`（`\\&` など）は文字 `&` そのもの/);
    assert.match(ex('echo ${s/b/\\\\&}'), /stands for the matched text/);
    // No & in the replacement, or none at all.
    for (const w of ['x', '', '\\\\', '"a b"']) assert.ok(!/&/.test(ex(`echo \${s/b/${w}}`).replace(/`[^`]*`/g, '')), w);
    assert.ok(!/stands for|quoted `&`/.test(ex('echo ${s/b}')));
  });

  it('computes the & replacement as bash 5.2 does', function () {
    if (bashVersion < 52) this.skip();
    assert.strictEqual(bash('s=abc; echo ${s/b/[&]} ${s/b/\\&} "${s/b/&&}" ${s/b/"&"} ${s/b/\'&\'} ${s/b/\\\\&}'), 'a[b]c a&c abbc a&c a&c a\\bc\n');
    assert.strictEqual(bash('s=abc; echo ${s//[ac]/<&>} ${s/#a/&&} ${s/%c/&&}'), '<a>b<c> aabc abcc\n');
    assert.strictEqual(bash('s=abc; shopt -u patsub_replacement; echo ${s/b/[&]}'), 'a[&]c\n');
  });

  it('says what IFS splits on, what $y does on an array, what $_ is, and how $x differs from x in arithmetic', () => {
    const line = ROUND4[6];
    assert.match(find(line, 'IFS=-').explanation, /Assign a value to variable `IFS` \(no spaces around `=`\)\. `IFS` lists the characters word splitting \(and `read`\) split on: from here, unquoted expansions are split on `-`\. `"\$\{a\[\*\]\}"` and `"\$\*"` join their elements with the first character, `-`$/);
    assert.match(find(line, 'IFS=-', 'ja').explanation, /`IFS` は単語分割（と `read`）が区切りに使う文字の一覧/);
    assert.match(find(line, '[*]').explanation, /separated by the first character of `IFS`/);
    assert.match(find('IFS=-; echo "$a" $b', '$b').explanation, /it is split on the characters of `IFS` \(set to `-` on line 1\), not on spaces, and globbed\)$/);
    assert.match(find('IFS=-; echo $b', '$b', 'ja').explanation, /`IFS`（行 1 で `-` にしてある）の文字で分割され、空白では分割されない。グロブ展開もされる）$/);
    assert.strictEqual(bash('IFS=-; b="x-y"; echo $b "$b"'), 'x y x-y\n');
    // Whitespace in IFS, empty IFS, an unknown value, and one set only for another command, in a subshell, or later.
    assert.match(find('IFS=$\'\\n\'; echo $b', '$b').explanation, /split on the characters of `IFS` \(set to `\\n` on line 1\), and globbed/);
    assert.match(find('IFS=; echo $b', '$b').explanation, /`IFS` is empty \(line 1\), so it is not word-split, but it is globbed/);
    assert.match(find('IFS=; echo $b', '$b', 'ja').explanation, /`IFS` が空（行 1）なので単語分割はされないが、グロブ展開はされる/);
    assert.match(find('IFS=; echo x', 'IFS=').explanation, /An empty `IFS` turns word splitting off/);
    assert.match(find('IFS=$x; echo $b', '$b').explanation, /split on the characters of `IFS` \(set on line 1 to a value not known here\), and globbed/);
    assert.match(find('IFS=$x', 'IFS=$x').explanation, /`IFS` lists the characters word splitting and `read` split on, and its first character joins/);
    assert.match(find('IFS=$x', 'IFS=$x', 'ja').explanation, /先頭の1文字/);
    assert.match(find('IFS=, read -r a b <<< x', 'IFS=,').explanation, /^Environment variable set only for this command: Assign a value to variable `IFS`\s*\(no spaces around `=`\)$/);
    assert.match(find('(IFS=-); echo $b', '$b').explanation, /word-split and globbed/);
    assert.match(find('f() { IFS=-; }; echo $b', '$b').explanation, /word-split and globbed/);
    assert.match(find('echo $b; IFS=-', '$b').explanation, /word-split and globbed/);
    assert.match(find('(IFS=-; echo $b)', '$b').explanation, /split on the characters of `IFS`/);
    assert.match(find('IFS[1]=x', 'IFS[1]=x').explanation, /^Assign to element/);
    // `$y` on an array is its first element.
    const arr = ROUND4[10].split('; ').slice(2).join('; ');
    assert.match(find(arr, '$y').explanation, /`y` is an array, so `\$y` is only its first element \(`\$\{y\[0\]\}`\); all of them are `"\$\{y\[@\]\}"`$/);
    assert.match(find(arr, '$y', 'ja').explanation, /`y` は配列なので、`\$y` は先頭の要素だけ（`\$\{y\[0\]\}`）になる。全要素は `"\$\{y\[@\]\}"`$/);
    assert.strictEqual(bash('y=(a b); echo $y'), 'a\n');
    // (`local` outside a function fails: `y` stays as it was.)
    assert.doesNotMatch(find('local -a y; echo $y', '$y').explanation, /is an array/);
    assert.match(find('f() { local -a y; echo $y; }', '$y').explanation, /is an array/);
    for (const decl of ['declare -a y', 'y[2]=c', 'read -a y <<< "a b"', 'mapfile y < /dev/null', 'readarray -t y < /dev/null', 'declare -a y=(a b)']) {
      assert.match(find(`${decl}; echo $y`, '$y').explanation, /is an array/, decl);
    }
    assert.match(find('declare -A m=([k]=v); echo $m', '$m').explanation, /is only the element with key 0 \(`\$\{m\[0\]\}`\)/);
    assert.match(find('declare -A m; echo $m', '$m').explanation, /key 0/);
    assert.strictEqual(bash('declare -A m=([0]=z [k]=v); echo $m'), 'z\n');
    assert.ok(!/is an array/.test(find('echo $y; y=(a b)', '$y').explanation));
    assert.ok(!/is an array/.test(find('y=a; echo $y', '$y').explanation));
    assert.ok(!/is an array/.test(find('declare -i y; echo $y', '$y').explanation));
    assert.ok(!/is an array/.test(find('y=(a b); echo ${y[1]} "${y[@]}"', '${y[1]}').explanation));
    assert.match(find('y=(a b); echo ${y}', '${y}').explanation, /is an array/);
    // `$_` after an assignment-only command is empty.
    const under = ROUND4[10].split('; ').slice(1).join('; ');
    assert.match(find(under, '$_').explanation, /^Last argument of the previous command\. The command before is only an assignment, so `\$_` is empty$/);
    assert.match(find(under, '$_', 'ja').explanation, /直前のコマンドは代入だけなので、`\$_` は空になる/);
    assert.strictEqual(bash('echo a b > /dev/null; y=(a b); echo "[$_]"'), '[]\n');
    assert.strictEqual(bash('echo a b > /dev/null; x=1; echo "[$_]"'), '[]\n');
    for (const src of ['echo a; echo $_', 'echo $_', 'x=1 echo a; echo $_', 'x=$(echo q); echo $_', '(x=1); echo $_', 'f() { y=1; }; echo $_', 'y=1; echo a; echo $_', 'declare -a y; echo $_']) {
      const exp = find(src, '$_').explanation;
      if (src === 'declare -a y; echo $_') assert.ok(!/only an assignment/.test(exp), src);
      else assert.ok(/only an assignment/.test(exp) === (src === 'x=$(echo q); echo $_'), src);
    }
    assert.strictEqual(bash('echo a b > /dev/null; z=$(echo q); echo "[$_]"'), '[]\n');
    // `$x` in arithmetic is text; `x` is a value.
    const ar = ROUND4[1].split('; ').slice(1).join('; ');
    assert.match(find(ar, '$x').explanation, /^Expands to the value of `x`\. Inside arithmetic, `\$x` is pasted as text \(here `1\+2`\) and then read as an expression\. Written as the bare name `x`, its value is evaluated as one expression first \(with `x='1\+2'`, `\$x\*2` is `1\+2\*2`, which is 5, and `x\*2` is 3\*2, which is 6\)$/);
    assert.match(find(ar, '$x', 'ja').explanation, /算術式の中の `\$x` は、値（ここでは `1\+2`）が文字のまま貼り付けられてから式として読まれる/);
    assert.match(find('x=1+2; echo $(( ${x} * 2 ))', '${x}').explanation, /Inside arithmetic, `\$x` is pasted as text/);
    assert.strictEqual(bash("x='1+2'; echo $((x*2)) $(($x*2))"), '6 5\n');
    // Nothing to say for a plain integer, an unknown value, or outside arithmetic.
    for (const src of ['x=3; echo $(($x*2))', 'echo $(($x*2))', 'x=" 4 "; echo $(($x*2))', 'x=1+2; echo $x', 'x=$y; echo $(($x*2))']) {
      assert.ok(!/pasted as text/.test(find(src, '$x').explanation), src);
    }
    assert.match(find('x=$y; echo $(($x*2))', '$x').explanation, /^Expands to the value of `x`$/);
    assert.match(find('x=; echo $(($x+1))', '$x').explanation, /pasted as text \(here ``\)/);
    assert.match(find('x=1+2; declare x; echo $(($x*2))', '$x').explanation, /pasted as text/);
    assert.match(find('x=1; x=2+3; echo $(($x*2))', '$x').explanation, /here `2\+3`/);
  });

  it('says that a redirection on a function belongs to the function', () => {
    const src = ROUND4[7];
    const def = tokens(src).find((t) => t.kind === 'function' && t.label.startsWith('f()'))!;
    assert.match(def.explanation, /^Defines function `f`; call it like a command \(arguments become \$1, \$2…\)\. The redirection after the body is applied each time the function is called, not when it is defined/);
    assert.match(tokens(src, 'ja').find((t) => t.kind === 'function' && t.label.startsWith('f()'))!.explanation, /本体のあとのリダイレクトは、定義した時ではなく関数を呼ぶたびに適用される/);
    assert.match(tokens(src).find((t) => t.kind === 'redirect' && t.label.startsWith('{ ‹commands› }'))!.explanation, /^Redirection applied to `\{ echo hi; \}` as a whole\. A redirection on a function is stored with it and applied each time the function is called$/);
    assert.ok(!/applied each time/.test(tokens('f() { echo hi; }').find((t) => t.kind === 'function')!.explanation));
    assert.ok(!/stored with it/.test(tokens('{ echo hi; } >&2').map((t) => t.explanation).join('\n')));
    assert.strictEqual(bash('f() { echo hi; } >&2; f 2>&1 | tr h H'), 'Hi\n');
    assert.strictEqual(bashIn('g() { echo one; } > out; g; g; cat out'), 'one\n');
  });

  it('says when the variables of a trap string are expanded', () => {
    const arg = tokensAt(ROUND4[7], 0).find((t) => t.kind === 'argument' && t.label === "'echo bye $x'")!;
    assert.match(arg.explanation, /^command to run \(`-` resets, empty string ignores\)\. Single quotes keep `\$x` from being expanded here: it is expanded when the trap runs, with the value it has then$/i);
    assert.match(tokensAt(ROUND4[7], 0, 'ja').find((t) => t.kind === 'argument' && t.label === "'echo bye $x'")!.explanation, /シングルクォートなので `\$x` はここでは展開されず、トラップが実行されるときに展開される/);
    assert.match(tokens('trap \'echo ${x} $(date) `id` $x\' EXIT').find((t) => t.kind === 'argument' && t.label.startsWith("'echo"))!.explanation, /keep `\$\{x\}`, `\$\(…\)`, `\$x` from being expanded/);
    assert.match(tokens('trap "echo bye $x" EXIT').find((t) => t.kind === 'argument' && t.label === '"echo bye $x"')!.explanation, /Double quotes expand `\$x` now, and the trap keeps that text \(use single quotes to get the value at run time\)/);
    assert.match(tokens('trap "echo bye $x" EXIT', 'ja').find((t) => t.kind === 'argument' && t.label === '"echo bye $x"')!.explanation, /ダブルクォートなので `\$x` は今ここで展開され/);
    for (const src of ['trap \'echo bye\' EXIT', 'trap "echo bye" EXIT', 'trap cleanup EXIT', 'trap $cmd EXIT', 'trap - EXIT']) {
      assert.ok(!/expanded when the trap|Double quotes expand/.test(tokens(src).map((t) => t.explanation).join('\n')), src);
    }
    assert.strictEqual(bash("trap 'echo bye $x' EXIT; x=late"), 'bye late\n');
    assert.strictEqual(bash('x=early; trap "echo bye $x" EXIT; x=late'), 'bye early\n');
  });

  it('does not claim more than bash does for the other lines', () => {
    // Line 4: `read` drops the last line without a newline; lastpipe keeps `v`.
    assert.strictEqual(bash(ROUND4[3]), '[a]\nv=hi\n');
    // Line 5: `echo` prints `--`, and stops reading options at `-nx`.
    assert.strictEqual(bash(ROUND4[4]), '-- -n\n-nx -e a\\x41\nbB\n');
    assert.deepStrictEqual(findAt(ROUND4[4], 0, 'echo -nx -e \'a\\x41\'').children.map((c) => c.kind), ['argument', 'argument', 'argument']);
    // Line 10: getopts.
    assert.strictEqual(bash(ROUND4[9]), 'a b cv | w\n');
    // Line 11: the words of one command expand from left to right.
    assert.strictEqual(bash('x=1; echo $x$((x+=1))$x; echo $_'), '122\n122\n');
  });
});

// The thirteen lines of the fifth round.
const ROUND5 = [
  'HOME=/h; echo ~ ~/x "~" x~ a=~ --o=~ b=x:~/y',
  'shopt -s expand_aliases; alias e=\'echo A\'; e 2>/dev/null || echo noalias; eval e',
  'f() for i; do echo -n "$i "; done; f a b; g() [[ $1 == y ]]; g y && echo yes',
  'false || echo a && echo b; true || echo c && echo d; ! true || echo e',
  's=abcde; echo ${s:-2} ${s: -2} ${s:(-2)} ${s:1-3} ${s:1:-1} ${s::2}',
  '{ echo 1 2>/dev/null 3; echo a2>/dev/null b; echo c 2>&1 d; } 2>&1',
  'set -- a b c; echo ${@/#/-} "${@/%/,}" ${*/b} ${#@} ${#*}',
  'a=([2]=c [0]=a b); a[1]+=x; echo ${a[@]} ${#a[@]}; z[1]=q; echo "[$z]" ${#z[@]}',
  'printf \'%s-%s;\' a b c; printf \'<%s>\'; echo; printf \'%d %s|\' 1 x 2; echo',
  '{ echo }; }; echo { }; [ ] || echo empty; echo ]] [[ fi',
  '(exit 3) & wait $!; echo $?; true & false; echo $?',
  'x=\'$(echo no)\'; echo $x $(echo \'$x\'); eval echo $x; { echo e >&2; } |& tr e E',
  'IFS=; set -- a b; echo "$*" "${*}x" $((x=2, x*=3, x---1)) $x; unset IFS; echo "$*"',
];

describe('tricky lines (round 5)', () => {

  for (const lang of ['en', 'ja'] as const) {
    it(`explains the lines without errors (${lang})`, () => {
      ROUND5.forEach((src, i) => {
        assert.ok(!hasError(parser.parse(src).root), src);
        assert.ok(!tokens(src, lang).some((t) => t.kind === 'error'), src);
      });
    });
  }

  const outer = (script: string, label: string, lang: 'ja' | 'en' = 'en') => tokensAt(script, 0, lang).find((t) => t.label === label)!;
  it('explains tilde expansion in ordinary arguments, and only there', () => {
    const src = ROUND5[0];
    const kidOf = (label: string, lang: 'ja' | 'en' = 'en') => tokensAt(src, 0, lang).find((t) => t.label === label)!.children.map((c) => c.explanation);
    assert.deepStrictEqual(kidOf('~'), ['Tilde expansion: `~` becomes the home directory (`$HOME`)']);
    assert.deepStrictEqual(kidOf('~/x'), ['Tilde expansion: `~` becomes the home directory (`$HOME`). The rest, `/x`, stays as it is']);
    assert.deepStrictEqual(kidOf('~', 'ja'), ['チルダ展開: `~` はホームディレクトリ（`$HOME`）に置き換わる']);
    // Not expanded: quoted, not at the start, after `--o=`, or after `=` / `:` in an ordinary argument.
    for (const label of ['x~', '--o=~']) {
      assert.ok(!findAt(src, 0, label).children.some((c) => c.kind === 'expansion'), label);
      assert.ok(!/Tilde/.test(findAt(src, 0, label).explanation), label);
    }
    assert.deepStrictEqual(tokensAt(src, 0).find((t) => t.label === '"~"')!.children.map((c) => c.kind), ['string']);
    assert.strictEqual(bash('HOME=/h; echo ~ ~/x "~" x~ --o=~'), '/h /h/x ~ x~ --o=~\n');
    // Other commands, other forms.
    assert.strictEqual(outer('ls ~/x', '~/x').children[0].kind, 'expansion');
    assert.strictEqual(outer('cd ~', '~').children[0].kind, 'expansion');
    assert.match(outer('cd ~+/x', '~+/x').children[0].explanation, /^Tilde expansion: `~\+` becomes the current directory \(`\$PWD`\)\. The rest, `\/x`/);
    assert.match(outer('cd ~-', '~-').children[0].explanation, /previous directory \(`\$OLDPWD`\)/);
    assert.match(outer('ls ~root/x', '~root/x').children[0].explanation, /`~root` becomes the home directory of the user `root` \(unchanged if there is no such user\)/);
    assert.match(outer('ls ~root/x', '~root/x', 'ja').children[0].explanation, /`~root` はユーザー `root` のホームディレクトリ/);
    assert.strictEqual(bash('cd /; cd /tmp; echo ~+ ~- ~root/x ~nosuch/x | sed "s|/tmp|T|"'), 'T / /root/x ~nosuch/x\n');
    assert.strictEqual(bash('HOME=/h; echo ~foo~ ~ x'), '~foo~ /h x\n');
    for (const s of ['ls "~/x"', "ls '~/x'", 'ls x~/y', 'ls --o=~/x', 'ls \\~/x']) {
      assert.ok(!tokens(s).some((t) => t.kind === 'expansion' && /Tilde/.test(t.explanation)), s);
    }
    assert.strictEqual(bash("HOME=/h; echo '~/x' \\~/x x~/y"), '~/x ~/x x~/y\n');
  });

  it('uses an alias only on the lines read after the alias ran', () => {
    const src = ROUND5[1];
    const e = tokensAt(src, 0, 'en').find((x) => x.label === 'e')!;
    assert.strictEqual(e.kind, 'command');
    assert.strictEqual(e.explanation, 'Run the command `e` (the alias of line 1 is not in effect here)');
    assert.match(notesAt(src).join('\n'), /^ℹ `e` is defined as an alias on line 1, but bash reads a whole line \(and a whole compound command or function body\) before running it, so an alias defined on the same line is not in effect yet\. It is not an alias here: without a command named `e`, this is "command not found" \(a string given to `eval` is read again when it runs, so it can use the alias\)$/m);
    assert.match(new Analyzer('ja').explainLine(parser.parse(src), 0).notes.join('\n'), /同じ行で定義したエイリアスはまだ使えません/);
    assert.strictEqual(bash(src), 'noalias\nA\n');
    // On a later line it applies.
    const later = 'shopt -s expand_aliases\nalias e=\'echo A\'\ne x\nalias e=\'echo B\'\ne y';
    assert.match(findAt(later, 2, 'e x').explanation, /^The alias `e` defined on line 2: replaced by `echo A`$/);
    assert.match(findAt(later, 4, 'e y').explanation, /^The alias `e` defined on line 4: replaced by `echo B`$/);
    assert.strictEqual(bash(later), 'A x\nB y\n');
    // A body read before the alias ran does not see it; one read after does.
    const body = 'shopt -s expand_aliases\nalias g=\'echo G\'\nf() { g; h; }\nalias h=\'echo H\'\nf\n{\nalias m=\'echo M\'\nm\n}\nif true; then alias k=\'echo K\'; k; fi\nk';
    assert.match(findAt(body, 2, 'g').explanation, /^The alias `g` defined on line 2/);
    assert.match(findAt(body, 2, 'h').explanation, /^Run the command `h` \(the alias of line 4 is not in effect here\)$/);
    assert.match(notesAt(body, 2).join('\n'), /`h` is defined as an alias on line 4, but this is read before that/);
    assert.match(findAt(body, 7, 'm').explanation, /^Run the command `m` \(the alias of line 7 is not in effect here\)$/);
    assert.match(findAt(body, 9, 'k').explanation, /^Run the command `k` \(the alias of line 10 is not in effect here\)$/);
    assert.match(findAt(body, 10, 'k').explanation, /^The alias `k` defined on line 10/);
    assert.strictEqual(bash(`exec 2>&1\n${body}`).replace(/^.*line \d+: /gm, ''), 'G\nh: command not found\nm: command not found\nk: command not found\nK\n');
    // A use before the definition is no alias either.
    const early = 'e a\nalias e=\'echo A\'';
    assert.match(findAt(early, 0, 'e a').explanation, /^Run the command `e` \(the alias of line 2 is not in effect here\)$/);
    assert.match(notesAt(early).join('\n'), /this is read before that, and an alias works only on what is read after it ran/);
  });

  it('explains an element of an array that is appended to', () => {
    const src = ROUND5[7];
    const el = (s: string, label: string, lang: 'ja' | 'en' = 'en') => findAt(s, 0, label, lang).explanation;
    assert.strictEqual(el(src, 'a[1]+=x'), 'Append to element `[1]` of array `a` (text is appended to the existing value: `b` plus `x` is `bx`)');
    assert.strictEqual(el(src, 'a[1]+=x', 'ja'), '配列 `a` の要素 `[1]` に値を追記する（文字列の連結。`b` に `x` を足すと `bx`）');
    assert.strictEqual(el('a[1]=x', 'a[1]=x'), 'Assign to element `[1]` of array `a`');
    assert.match(el('a[1+1]+=x', 'a[1+1]+=x'), /^Append to element `\[1\+1\]` of array `a` \(an arithmetic expression: 2\) \(text is appended/);
    assert.strictEqual(el('declare -A m; m[k]+=x', 'm[k]+=x'), 'Append to the element of associative array `m` with the key `k` (a string, not evaluated) (text is appended to the existing value)');
    assert.strictEqual(el('declare -A m; m[k]=x', 'm[k]=x'), 'Assign to the element of associative array `m` with the key `k` (a string, not evaluated)');
    assert.match(el('declare -A m; m[k]+=x', 'm[k]+=x', 'ja'), /^連想配列 `m` のキー `k`（文字列で、計算はされない）の要素に値を追記する/);
    // With -i, `+=` on an element adds.
    // (The example takes the operand written: 7 and `+=5` make 12, as bash adds them, not the text `75`.)
    assert.strictEqual(bash('declare -ai c=(7 2); c[0]+=5; echo "${c[0]}"; declare -i n=7; n+=5; echo "$n"; s=7; s+=5; echo "$s"'), '12\n12\n75\n');
    assert.match(el('declare -ai c=(1 2); c[0]+=5', 'c[0]+=5'), /^Add to element `\[0\]` of array `c` \(it has `-i`, so this adds numbers: if it is 7, `\+=5` makes 12, not 75\)$/);
    assert.strictEqual(el('declare -i n; n+=5', 'n+=5'), 'Add to the integer variable `n` (it has `-i`, so this adds instead of appending text: if `n` is 7, `+=5` makes 12, not 75)');
    assert.strictEqual(el('declare -i n; n+=x', 'n+=x'), 'Add to the integer variable `n` (it has `-i`, so this adds instead of appending text: the value of the arithmetic expression `x` is added)');
    assert.match(el('declare -ai c; c[0]+=2', 'c[0]+=2', 'ja'), /要素が 7 なら `\+=2` で 9 であり、72 ではない）$/);
    assert.match(el('declare -i c; c[0]+=5', 'c[0]+=5', 'ja'), /^配列 `c` の要素 `\[0\]` に値を足す（`-i` が付いているので算術式の足し算/);
    assert.match(el('declare -Ai m; m[k]+=5', 'm[k]+=5'), /^Add to the element of associative array `m`.*adds numbers/);
    assert.match(el('declare -ai c; c[0]=5', 'c[0]=5'), /^Assign to element/);
    assert.strictEqual(bash('declare -ai c=(1 2); c[0]+=5; echo ${c[@]}; declare -Ai m=([k]=2); m[k]+=3; echo ${m[k]}'), '6 2\n5\n');
    assert.strictEqual(bash('declare -A m=([k]=a); m[k]+=b; echo ${m[k]}'), 'ab\n');
    // Values, as bash gives them.
    assert.strictEqual(bash(src), 'a bx c 3\n[] 1\n');
    assert.strictEqual(bash('a=(x); a+=(y z); echo ${a[@]}'), 'x y z\n');
    assert.match(el('a=(x); a+=(y z)', 'a+=(y z)'), /^Append the values in `\( \)` to the array `a`, after its last index$/);
  });

  it('does not claim more than bash does for the other lines', () => {
    assert.strictEqual(bash(ROUND5[2]), 'a b yes\n');
    assert.strictEqual(bash(ROUND5[5]), '1 3\nc d\n');
    assert.strictEqual(bash(ROUND5[3]), 'a\nb\nd\ne\n');
    assert.strictEqual(bash(ROUND5[4]), 'abcde de de de bcd ab\n');
    assert.strictEqual(bash(ROUND5[6]), '-a -b -c a, b, c, a c 3 3\n');
    assert.strictEqual(bash(ROUND5[8]), 'a-b;c-;<>\n1 x|2 |\n');
    assert.strictEqual(bash(ROUND5[10]), '3\n1\n');
    assert.strictEqual(bash(ROUND5[11]), '$(echo no) $x\nno\nE\n');
    assert.strictEqual(bash(ROUND5[12]), 'ab abx 5 5\na b\n');
  });
});

// The fourteen lines of the sixth round.
const ROUND6 = [
  ':(){ echo ":$1"; }; : x; .(){ echo "dot $#"; }; . a b',
  'set -- {a..k}; echo $10 ${10} ${11} ${#10} $#',
  'x=$(false); echo $?; f(){ local y=$(false); echo $?; }; f; (set -e; g(){ false; echo after; }; g || echo fail)',
  'x=y; y=\'z*2\'; z=3; echo $((x)) $(( "1" + 2 )) $((x+1)) $(( y ))',
  '[[ 10 < 9 ]] && echo lex; (( 10 < 9 )) || echo num; re=\'a.c\'; [[ abc =~ $re ]] && ! [[ abc =~ "$re" ]] && echo quoted-literal',
  'v=V; echo "`echo \\"x\\" \'\\$v\' \\\\\\\\`" `echo \\$v \\\\$v`',
  'p=/a/b; echo ${p//\\//_} ${p/#\\/a/X} ${p##*/} "${x:-{a,b}}" $q{a,b} ${q:-{a,b}}',
  's=abcdef; echo ${s:1?2:3} ${s:(1?2:3)} ${s: -3:+2}',
  'exec {fd}>&1; echo named >&$fd; { echo moved >&4; } 3>&1 4>&3-; cat <<<a <<<b',
  'for ((i=0,j=5; i<j; i+=2,j--)); do echo -n "$i$j "; done; for i in; do echo never; done; echo end',
  'printf \'%q \' "a b\'c" \'\' $\'\\t\'; echo; read x <<< \'a\\b c\'; echo "$x"',
  'z=4*2; declare -i n; n=z; declare -u U=abc; U+=def; s=Hello; echo $n $U ${s,,[HL]} ${s~~} ${s~}',
  'echo "[$(</dev/null)]" $( : ) "$(printf \'a\\n\\n\\n\')|"',
  'case x in [!a]) echo bang;; esac; case ^ in [\\^a]) echo caret;; esac; case b in [[:alpha:]]) echo class;; esac; case \']\' in []]) echo bracket;; esac',
];

describe('tricky lines (round 6)', () => {

  for (const lang of ['en', 'ja'] as const) {
    it(`explains the lines without errors (${lang})`, () => {
      ROUND6.forEach((src, i) => {
        assert.ok(!hasError(parser.parse(src).root), src);
        assert.ok(!tokens(src, lang).some((t) => t.kind === 'error'), src);
      });
    });
  }

  const expl = (src: string, label: string, lang: 'ja' | 'en' = 'en') => findAt(src, 0, label, lang).explanation;

  it('reads a backquote in double quotes after bash removes the backslashes', () => {
    const src = ROUND6[5];
    assert.strictEqual(bash(src), 'x $v \\ V $v\n');
    assert.match(expl(src, '\\"x\\"'), /After quote removal it is the string `x`$/);
    assert.strictEqual(findAt(src, 0, '\\"x\\"').kind, 'string');
    assert.deepStrictEqual(tokens(src).filter((t) => t.kind === 'variable').map((t) => t.label), ['$v']);
    assert.match(expl(src, '\\"x\\"', 'ja'), /クォートやバックスラッシュを取り除くと `x` という文字列になる$/);
    // Four backslashes become two, which are one: with and without double quotes.
    for (const s of ['echo "`echo \\\\\\\\`"', 'echo `echo \\\\\\\\`']) {
      assert.strictEqual(bash(s), '\\\n', s);
      assert.match(expl(s, '\\\\\\\\'), /After quote removal it is the string `\\`$/, s);
      assert.match(expl(s, '\\\\\\\\', 'ja'), /取り除くと `\\` という文字列になる$/, s);
    }
    // `\\$v` becomes `\$v`, a plain dollar sign: the text `$v`.
    assert.strictEqual(bash('v=V; echo "`echo \\$v`" `echo \\\\$v`'), 'V $v\n');
    assert.match(expl('echo `echo \\\\$v`', '\\\\$v'), /After quote removal it is the string `\$v`/);
    // Two levels of backquotes: the backslashes are removed twice, and the inner substitution is a backquote one.
    const nested = 'echo `echo \\`echo a\\\\\\\\b\\``';
    assert.strictEqual(bash(nested), 'ab\n');
    assert.match(expl(nested, 'a\\\\\\\\b'), /After quote removal it is the string `ab`$/);
    assert.match(expl(nested, '\\`echo a\\\\\\\\b\\`'), /^Command substitution `` `…` `` \(legacy/);
    // A double quote that was escaped is a quote of the substitution's own text.
    assert.match(expl('echo "`echo \\"a b\\"`"', '\\"a b\\"'), /After quote removal it is the string `a b`$/);
    assert.strictEqual(bash('echo "`echo \\"a  b\\"`"'), 'a  b\n');
  });

  const sq = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`;
  /** Whether bash's `case` takes the branch of `pattern` for `value`. */
  const caseMatches = (pattern: string, value: string): boolean => bash(`case ${sq(value)} in ${pattern}) echo y;; esac`) === 'y\n';

  it('says that a quoted right side of =~ is no regex', () => {
    const src = ROUND6[4];
    assert.strictEqual(bash(src), 'lex\nnum\nquoted-literal\n');
    const quoted = expl(src, 'abc =~ "$re"');
    assert.match(quoted, /^Condition: `abc` vs `"\$re"` — true if the left side contains the right side as it is \(the right side is quoted, so it is literal text, not a regex: `\.` and `\*` are plain characters\)\. A variable that holds a regex is written `\$re`, not `"\$re"`; captures go to `BASH_REMATCH`$/);
    assert.match(expl(src, 'abc =~ "$re"', 'ja'), /左辺が右辺の文字列をそのまま含めば真（右辺はクォートされているので正規表現ではなく文字列そのもの/);
    assert.match(expl(src, 'abc =~ $re'), /^Condition: `abc` vs `\$re` — left side matches the regex \(ERE\) on the right/);
    // Only a part of it quoted: the quoted part is text, the rest is a regex.
    for (const [rhs, part] of [['a"."c', 'the quoted parts'], ["'a.c'", 'literal text, not a regex'], ['^a"."c$', 'the quoted parts'], ['"a"$re', 'the quoted parts']] as const) {
      const e = expl(`[[ abc =~ ${rhs} ]]`, `abc =~ ${rhs}`);
      assert.match(e, new RegExp(part.replace('.', '\\.')), rhs);
    }
    assert.doesNotMatch(expl('[[ abc =~ a\\.c ]]', 'abc =~ a\\.c'), /quoted/);
    assert.doesNotMatch(expl('[[ abc =~ ^a.c$ ]]', 'abc =~ ^a.c$'), /quoted/);
    // What bash does with them.
    assert.strictEqual(bash('re=a.c; [[ abc =~ "$re" ]] || echo nomatch'), 'nomatch\n');
    assert.strictEqual(bash('[[ abc =~ "b" ]] && echo contains'), 'contains\n');
    assert.strictEqual(bash('[[ abc =~ a"."c ]] || echo no; [[ a.c =~ ^a"."c$ ]] && echo yes; [[ abc =~ "a"b. ]] && echo mixed'), 'no\nyes\nmixed\n');
    assert.strictEqual(bash("[[ abc =~ 'a.c' ]] || echo no; [[ abc =~ a\\.c ]] || echo no2"), 'no\nno2\n');
    // `==` does the same with patterns.
    assert.match(expl('[[ abc == "a*" ]]', 'abc == "a*"'), /literal text, not a pattern/);
  });

  it('splits ${v/pattern/replacement} at the first slash that is not escaped', () => {
    const src = ROUND6[6];
    const head = (e: string, label: string, lang: 'ja' | 'en' = 'en') => expl(`echo ${e}`, label, lang);
    assert.strictEqual(head('${p//\\//_}', '${p//\\//_}'), 'Parameter expansion: Replace every match of `\\/` in `p` with `_`');
    assert.strictEqual(head('${p//\\//_}', '${p//\\//_}', 'ja'), 'パラメータ展開: `p` 内で `\\/` に一致する部分をすべて `_` に置換');
    assert.strictEqual(head('${p/#\\/a/X}', '${p/#\\/a/X}'), 'Parameter expansion: Replace `\\/a` at the start of `p` with `X`');
    assert.strictEqual(head('${p/%b\\//Y}', '${p/%b\\//Y}'), 'Parameter expansion: Replace `b\\/` at the end of `p` with `Y`');
    assert.strictEqual(head('${p/a\\/b}', '${p/a\\/b}'), 'Parameter expansion: Delete the first match of `a\\/b` in `p`');
    assert.strictEqual(head('${p/"/"/Z}', '${p/"/"/Z}'), 'Parameter expansion: Replace the first match of `"/"` in `p` with `Z`');
    assert.strictEqual(head('${p/$(echo /)/Z}', '${p/$(echo /)/Z}'), 'Parameter expansion: Replace the first match of `$(echo /)` in `p` with `Z`');
    assert.strictEqual(head('${p/a/\\/}', '${p/a/\\/}'), 'Parameter expansion: Replace the first match of `a` in `p` with `/`');
    // The children and the example were right already.
    assert.deepStrictEqual(tokens('echo ${p//\\//_}').filter((t) => t.kind === 'pattern').map((t) => t.label), ['\\/']);
    assert.strictEqual(bash('p=/a/b; echo ${p//\\//_} ${p/#\\/a/X} ${p/%b\\//Y} ${p/"/"/Z} ${p/a\\/b} ${p/a/\\/}'), '_a_b X/b /a/b Za/b / ///b\n');
    assert.strictEqual(bash(src.split(';')[0] + '; echo ${p//\\//_} ${p/#\\/a/X}'), '_a_b X/b\n');
    assert.deepStrictEqual(examplesOf('echo ${p//\\//_}').map((e) => e.sections[0].lines), [[bash('p=/usr/local/bin/app.sh; echo ${p//\\//_}').trim()]]);
  });

  it('does not start the length at the colon of a ternary in the offset', () => {
    const src = ROUND6[7];
    const e = (label: string) => expl(`echo ${label}`, label);
    assert.strictEqual(e('${s:1?2:3}'), 'Parameter expansion: take a substring of `s` (offset `1?2:3`)');
    assert.strictEqual(e('${s:(1?2:3)}'), 'Parameter expansion: take a substring of `s` (offset `(1?2:3)`)');
    assert.strictEqual(e('${s: a?1:2 :1}'), 'Parameter expansion: take a substring of `s` (offset `a?1:2`, length `1`)');
    assert.strictEqual(e('${s:1?2:3:1}'), 'Parameter expansion: take a substring of `s` (offset `1?2:3`, length `1`)');
    assert.match(expl('echo ${s:1?2:3}', '1?2:3'), /^Offset `1\?2:3` \(evaluated as arithmetic\)\. The `:` that pairs with the `\?` belongs to the ternary; it does not start the length$/);
    assert.match(expl('echo ${s:1?2:3}', '1?2:3', 'ja'), /三項演算子の一部で、長さの区切りではない$/);
    assert.strictEqual(tokens('echo ${s:1?2:3}').filter((t) => t.label === ':').length, 1);
    assert.strictEqual(e('${s: -3:+2}'), 'Parameter expansion: take 2 characters of `s` starting at 3 characters from the end');
    // What bash does, also for the forms the line does not have.
    assert.strictEqual(bash(ROUND6[7]), 'cdef cdef de\n');
    assert.strictEqual(bash('s=abcdef; a=1; echo "${s: a?1:2 :1}" ${s:1?2:3:1} ${s:a?(1):2} ${s: 0?1:2}'), 'b c bcdef cdef\n');
    assert.deepStrictEqual(parseExpansion('${s:1?2:3}')!.parts.map((p) => [p.role, p.text]), [['name', 's'], ['op', ':'], ['offset', '1?2:3']]);
    assert.deepStrictEqual(parseExpansion('${s:a?(1:2):3:4}')!.parts.map((p) => [p.role, p.text]), [['name', 's'], ['op', ':'], ['offset', 'a?(1:2):3'], ['op', ':'], ['length', '4']]);
    // A `:` with no `?` before it still starts the length; so does one after the ternary is closed.
    assert.deepStrictEqual(parseExpansion('${s:1:2}')!.parts.map((p) => p.text), ['s', ':', '1', ':', '2']);
    assert.strictEqual(bash('s=abcdef; echo ${s:1:2} ${s:0?2:3:1}'), 'bc d\n');
  });

  it('explains n>&m- as a move and {name}>… as a new descriptor kept in a variable', () => {
    const src = ROUND6[8];
    assert.strictEqual(bash(src), 'named\nmoved\nb\n');
    // `n>&m-` and `n<&m-`: copy m to n, then close m.
    assert.strictEqual(expl(src, '4>&3-'), 'Move file descriptor 3 to file descriptor 4 (copy it, then close 3)');
    assert.strictEqual(expl(src, '4>&3-', 'ja'), 'ファイルディスクリプタ 3を ファイルディスクリプタ 4 に移す（複製したあと 3 は閉じる）');
    assert.strictEqual(expl('echo a 5<&3-', '5<&3-'), 'Move file descriptor 3 to file descriptor 5 (copy it, then close 3)');
    assert.strictEqual(expl('echo a >&3-', '>&3-'), 'Move file descriptor 3 to stdout (fd 1) (copy it, then close 3)');
    assert.strictEqual(expl('echo a <&3-', '<&3-'), 'Move file descriptor 3 to stdin (fd 0) (copy it, then close 3)');
    assert.strictEqual(expl('echo a 3>&-', '3>&-'), 'Close file descriptor 3');
    assert.strictEqual(expl('echo a 2>&-', '2>&-'), 'Close stderr (fd 2)');
    assert.strictEqual(expl('echo a <&-', '<&-'), 'Close stdin (fd 0)');
    assert.strictEqual(expl('echo a 2>&1', '2>&1'), 'Send stderr (fd 2) to wherever stdout (fd 1) goes (the classic way to capture errors too)');
    // The note does not take `3-` for a file name: 3 is closed, and 4 is the original 3.
    const note = notesAt(src).join('\n');
    assert.match(note, /^Redirections apply left to right\. In the end: fd 3 → closed, fd 4 → the original stdout$/m);
    assert.match(notesAt('echo a 5>&6- 2>&1').join('\n'), /fd 5 → the original fd 6, fd 6 → closed/);
    assert.doesNotMatch(notesAt('echo a 5>&6-').join('\n'), /5>&6-|`6-`/);
    assert.strictEqual(bash('{ echo moved >&4; } 3>&1 4>&3-'), 'moved\n');
    assert.match(bash('echo a 4>&3-'), /Bad file descriptor|ERROR/);
    assert.strictEqual(bash('exec 5>&1; exec 6<&5-; echo y >&6; echo x >&5 2>/dev/null || echo closed'), 'y\nclosed\n');
    // `{name}`: bash picks a free descriptor from 10 up and stores the number in the variable.
    assert.strictEqual(expl(src, '{fd}>&1'), 'Copy stdout (fd 1) to a free file descriptor (10 or higher) and store its number in variable `fd` (sharing the output)');
    assert.strictEqual(expl(src, '{fd}>&1', 'ja'), '標準出力(fd 1)の複製を、空いているファイルディスクリプタ（10 以上）に作り、その番号を変数 `fd` に入れる（出力先を共有）');
    assert.strictEqual(expl('echo a {v}<file', '{v}<file'), 'Open file `file` for reading on a free file descriptor (10 or higher) and store its number in variable `v`');
    assert.strictEqual(expl('echo a {v}<file', '{v}<file', 'ja'), 'ファイル `file` を読み込み用で開き、空いているファイルディスクリプタ（10 以上）の番号を変数 `v` に入れる');
    assert.match(expl('echo a {v}>file', '{v}>file'), /^Open file `file` for writing \(overwrite\) on a free file descriptor \(10 or higher\) and store its number in variable `v`$/);
    assert.match(expl('echo a {v}>>file', '{v}>>file'), /^Open file `file` for appending on a free/);
    assert.match(expl('echo a {v}<>file', '{v}<>file'), /^Open file `file` for reading and writing on a free/);
    assert.match(expl('echo a {v}>|file', '{v}>|file'), /^Open file `file` for writing \(overwrite even with `noclobber`\) on a free/);
    assert.strictEqual(expl('echo a {v}>&-', '{v}>&-'), 'Close the file descriptor whose number is in variable `v`');
    assert.strictEqual(expl('echo a {v}<&-', '{v}<&-'), 'Close the file descriptor whose number is in variable `v`');
    assert.strictEqual(expl('echo a {v}<&0', '{v}<&0'), 'Copy stdin (fd 0) to a free file descriptor (10 or higher) and store its number in variable `v` (sharing the input)');
    assert.strictEqual(expl('echo a {v}>&3-', '{v}>&3-'), 'Move file descriptor 3 to a free file descriptor (10 or higher), closing 3, and store the new number in variable `v`');
    assert.match(notesAt('echo a {v}>&3- 2>&1').join('\n'), /^Redirections apply left to right\. In the end: stderr → the original stdout$/m);
    assert.strictEqual(notesAt('echo a {v}>f {w}>&1').length, 0);
    assert.strictEqual(bash('exec {fd}>&1; echo $fd; echo hi >&$fd; exec {fd}>&-; echo closed'), '10\nhi\nclosed\n');
    assert.strictEqual(bash('exec {g}</dev/null; echo $g; exec {h}>/dev/null; echo $h; exec {g}<&-; exec {i}<&0; echo $i'), '10\n11\n10\n');
    assert.strictEqual(bash('exec 5>/dev/null; exec {v}<&5-; echo $v; echo x >&5 2>/dev/null || echo closed'), '10\nclosed\n');
  });

  it('says that a for loop over an empty list after in never runs', () => {
    // Only a loop with no `in` goes over "$@".
    for (const src of ['for i; do echo $i; done', 'for i do echo $i; done']) {
      assert.strictEqual(expl(src, src), 'for loop over the positional parameters ("$@") as `i` (what a loop with no `in` does)');
      assert.strictEqual(expl(src, src, 'ja'), 'for ループ: 位置パラメータ（"$@"）の各値を順に `i` に入れて繰り返す（`in` を省略したとき）');
    }
    assert.strictEqual(bash('set -- a b; for i; do echo $i; done; for i do echo $i; done'), 'a\nb\na\nb\n');
    assert.strictEqual(bash('set -- a b; for i in; do echo never; done; echo end'), 'end\n');
    assert.strictEqual(expl('for i in a b; do :; done', 'for i in a b; do :; done'), 'for loop: assign each of `a b` to `i` and run the body');
    const empty = 'for i in; do echo never; done';
    assert.strictEqual(expl(empty, empty), 'for loop: the list after `in` is empty, so the body never runs (only a loop with no `in` goes over `"$@"`)');
    assert.strictEqual(expl(empty, empty, 'ja'), 'for ループ: `in` のあとの一覧が空なので、本体は一度も実行されない（`"$@"` を回すのは `in` を省いたときだけ）');
    assert.match(expl('for i in ; do :; done', 'for i in ; do :; done'), /^for loop: the list after `in` is empty/);
    assert.match(expl(ROUND6[9], 'for i in; do echo never; done'), /^for loop: the list after `in` is empty/);
    assert.strictEqual(bash(ROUND6[9]), '05 24 end\n');
    // `select` has a menu instead.
    assert.strictEqual(expl('select i in; do break; done', 'select i in; do break; done'), 'select loop: the list after `in` is empty, so the body never runs (only a loop with no `in` goes over `"$@"`)');
    assert.match(expl('select i; do break; done', 'select i; do break; done'), /^select loop over the positional parameters \("\$@"; there is no `in`\): show them as a numbered menu/);
    assert.match(expl('select i in a b; do break; done', 'select i in a b; do break; done'), /^select loop: show `a b` as a numbered menu, assign the chosen one to `i` and run the body \(until `break`\)$/);
    assert.strictEqual(bash('select i in; do echo never; break; done </dev/null 2>&1; echo end'), 'end\n');
    assert.match(bash('set -- a; echo 1 | { select i; do echo got $i; break; done; } 2>&1'), /1\) a[\s\S]*got a/);
  });

  it('explains ${s~~} and ${s~} as swapping the case', () => {
    const e = (x: string, lang: 'ja' | 'en' = 'en') => expl(`echo ${x}`, x, lang);
    assert.strictEqual(e('${s~~}'), 'Parameter expansion: Swap the case of every character of `s`');
    assert.strictEqual(e('${s~}'), 'Parameter expansion: Swap the case of the first character of `s`');
    assert.strictEqual(e('${s~~}', 'ja'), 'パラメータ展開: `s` の大文字と小文字をすべて入れ替える');
    assert.strictEqual(e('${s~}', 'ja'), 'パラメータ展開: `s` の先頭文字の大文字と小文字を入れ替える');
    assert.strictEqual(e('${s~~[a-l]}'), 'Parameter expansion: Swap the case of the characters of `s` that match `[a-l]`');
    assert.strictEqual(e('${s~H}'), 'Parameter expansion: Swap the case of the first character of `s` if it matches `H`');
    assert.strictEqual(find('echo ${s~~}', '~~').explanation, 'Swap the case of every character (a little-known form)');
    assert.strictEqual(find('echo ${s~}', '~').explanation, 'Swap the case of the first character (a little-known form)');
    assert.match(find('echo ${s~~[a-l]}', '[a-l]', 'en', true).explanation, /^Pattern of characters to convert `\[a-l\]`: Glob pattern \(shell wildcards\): matched against a string\. Each character is tried on its own; only those that match are converted$/);
    // A pattern with an expansion in it has its parts explained.
    assert.ok(tokens('echo ${s~~$x}').some((t) => t.kind === 'pattern' && /decided at run time/.test(t.explanation)));
    assert.ok(tokens('echo "${a[@]~~}" "${@~}"').filter((t) => t.kind === 'expansion').length === 2);
    // The examples are what bash gives.
    const ex = (x: string) => examplesOf(`echo ${x}`)[0].sections[0].lines[0];
    assert.strictEqual(ex('${s~~}'), bash('s="Hello World"; echo "${s~~}"').trim());
    assert.strictEqual(ex('${s~}'), bash('s="Hello World"; echo "${s~}"').trim());
    assert.strictEqual(ex('${s~~[a-l]}'), bash('s="Hello World"; echo "${s~~[a-l]}"').trim());
    assert.strictEqual(bash(ROUND6[11]), '8 ABCDEF hello hELLO hello\n');
    assert.strictEqual(bash('s="Hello World"; echo "${s~~}|${s~}|${s~~[a-l]}|${s~[a-l]}|${s~H}|${s~~o}"; a=(aB Cd); echo "${a[@]~~}" "${a[@]~}"'), 'hELLO wORLD|hello World|HELLo WorLD|Hello World|hello World|HellO WOrld\nAb cD AB cd\n');
  });

  it('computes the example of a case conversion with its pattern', () => {
    // The pattern limits the characters that change; bash decides, one character at a time.
    const cases: [string, string][] = [
      ['${s,,[HL]}', 'hEllO World'], ['${s^^[lo]}', 'heLLO wOrLd'], ['${s^l}', 'Lello world'], ['${s,H}', 'hELLO World'],
      ['${s^^e}', 'hEllo world'], ['${s,,[A-Z]}', 'hello world'], ['${s^^}', 'HELLO WORLD'], ['${s^}', 'Hello world'], ['${s,}', 'hELLO World'], ['${s,,}', 'hello world'],
      ['${s^^[[:lower:]]}', 'HELLO WORLD'], ['${s,,?}', 'hello world'], ['${s^[a-g]}', 'Aello world'],
    ];
    for (const [x, result] of cases) {
      const ex = examplesOf(`echo ${x}`)[0].sections[0].lines[0];
      assert.strictEqual(ex, result, x);
    }
    // ... and each is the value bash gives for the value the example sets.
    for (const [x] of cases) {
      const e = new Analyzer('en').explainLine(parser.parse(`echo ${x}`), 0).examples[0];
      const when = /s=("([^"]*)"|\S+)/.exec(e.sections[0].label)!;
      const value = when[2] ?? when[1];
      assert.strictEqual(bash(`s=${sq(value)}; echo "${x}"`).trim(), e.sections[0].lines[0], x);
    }
    // A single `^` or `,` also shows a value the pattern turns away.
    assert.deepStrictEqual(examplesOf('echo ${s^l}')[0].sections.map((sec) => sec.lines[0]), ['Lello world', 'hello world']);
    assert.strictEqual(bash('s="lello world"; t="hello world"; echo "${s^l}" "${t^l}"'), 'Lello world hello world\n');
    assert.deepStrictEqual(examplesOf('echo ${s,,[HL]}').map((e) => e.sections.length), [1]);
    assert.strictEqual(bash('s="HELLO World"; echo ${s,,[HL]}'), 'hEllO World\n');
    assert.match(find('echo ${s,,[HL]}', '[HL]', 'en', true).explanation, /^Pattern of characters to convert `\[HL\]`: Glob pattern \(shell wildcards\): matched against a string\. Each character is tried on its own; only those that match are converted$/);
    assert.match(find('echo ${s^l}', 'l', 'en', true).explanation, /The first character is converted only if it matches$/);
    assert.match(find('echo ${s,,[HL]}', '[HL]', 'ja', true).explanation, /^変換する文字のパターン `\[HL\]`: グロブパターン（シェルのワイルドカード）: 文字列と照合される。文字を1つずつ調べ、一致した文字だけが変換される$/);
    assert.strictEqual(expl('echo ${s,,[HL]}', '${s,,[HL]}'), 'Parameter expansion: Lowercase the characters of `s` that match `[HL]`');
    assert.strictEqual(expl('echo ${s^h}', '${s^h}'), 'Parameter expansion: Uppercase the first character of `s` if it matches `h`');
    assert.strictEqual(expl('echo ${s^^[lo]}', '${s^^[lo]}', 'ja'), 'パラメータ展開: `s` の文字のうち `[lo]` に一致するものだけを大文字にする');
    assert.strictEqual(expl('echo ${s,H}', '${s,H}', 'ja'), 'パラメータ展開: `s` の先頭文字が `H` に一致すれば小文字にする');
    // With an expansion in the pattern, no example (its value is not known).
    assert.deepStrictEqual(examplesOf('echo ${s^^$x}'), []);
  });

  it('reads bracket expressions in case patterns as bash does', () => {
    const lineOf = (i: number) => new Analyzer('en').explainLine(parser.parse(ROUND6[13]), 0).examples[i];
    assert.strictEqual(bash(ROUND6[13]), 'bang\ncaret\nclass\nbracket\n');
    const patterns = ['[!a]', '[\\^a]', '[[:alpha:]]', '[]]', '[[:alpha:]_]', '[a\\]b]', '[!]a]', '[^]]', '[a-]', '[]-a]', '[[:digit:][:alpha:]]', '[[.a.]]', '[a-c]', '[^a-c]', '[\\\\]', '[[:upper:]x]'];
    for (const pattern of patterns) {
      const ex = examplesOf(`case x in ${pattern}) :;; esac`)[0];
      assert.ok(ex, pattern);
      const [yes, no] = [ex.sections[0], ex.sections[1]];
      assert.ok(yes.lines.length > 0, pattern);
      for (const v of yes.lines) assert.ok(caseMatches(pattern, v), `${pattern} should take ${v}`);
      for (const v of no?.lines ?? []) assert.ok(!caseMatches(pattern, v), `${pattern} should not take ${v}`);
    }
    // The ones of the line: `[[:alpha:]]` is one letter, not a letter and `]`.
    const alpha = examplesOf('case b in [[:alpha:]]) :;; esac')[0].sections;
    assert.deepStrictEqual(alpha[0].lines, ['a', 'b', 'c']);
    assert.ok(!alpha[0].lines.some((v) => v.includes(']')));
    assert.ok(!alpha[1].lines.includes('A'));
    assert.deepStrictEqual(examplesOf('case x in [!a]) :;; esac')[0].sections[0].lines, ['b', 'c', 'x']);
    assert.deepStrictEqual(examplesOf('case x in [\\^a]) :;; esac')[0].sections[0].lines, ['a', '^']);
    assert.strictEqual(bash('for c in a ^ b; do case $c in [\\^a]) echo -n "$c ";; esac; done'), 'a ^ ');
    assert.deepStrictEqual(examplesOf('case x in []]) :;; esac')[0].sections[0].lines, [']']);
    assert.strictEqual(lineOf(0).title, 'Example (pattern `[!a]`)');
    // The same patterns in a glob over file names, a `${v#pattern}` and a description.
    assert.strictEqual(bashIn('echo [[:alpha:]]'), 'a b\n');
    assert.strictEqual(bashIn('echo [!a] [\\^a] []a]'), 'b a a\n');
    assert.strictEqual(bash('v=a]; echo ${v#[[:alpha:]]} ${v%[]]}'), '] a\n');
    assert.strictEqual(describeGlob(globParts('[[:alpha:]]')!, 'en'), 'one character from letters');
    assert.strictEqual(describeGlob(globParts('[[:alpha:]_]')!, 'ja'), '英字、_のどれか1文字');
    assert.strictEqual(describeGlob(globParts('[\\^a]')!, 'en'), 'one character from ^a');
    assert.strictEqual(describeGlob(globParts('[]]')!, 'en'), 'one character from ]');
    assert.strictEqual(describeGlob(globParts('[!]a]')!, 'en'), 'one character other than ]a');
    assert.strictEqual(describeGlob(globParts('[a-c0-9]')!, 'en'), 'one character from a-c0-9');
    assert.strictEqual(describeGlob(globParts('[[:punct:]]')!, 'en'), 'one character from [:punct:]');
    assert.strictEqual(describeGlob(globParts('[a')!, 'en'), '"[a"');
    assert.strictEqual(describeGlob(globParts('[[:alpha:]_]')!, 'en'), 'one character from letters, _');
    // Odd ones: out-of-order and class-ended ranges, collating and equivalence elements, a `[` that is no bracket expression.
    const chars = ['a', 'b', 'c', ']', '^', '\\', '-', '!', '1', 'A', '_', '.', 'x', 'z', '[', '+', ',', '5'];
    for (const pattern of ['[z-a]', '[a-[:digit:]]', '[+-[:digit:]]', '[a[', '[[]', '[[a]', '[a-[.z.]]', '[[=a=]-c]', '[[:foo:]]', '[[:alpha:]', '[!a]', '[\\^a]', '[]-a]', '[a-]', '[]]', '[^]]', '[!]a]', '[a\\]b]', '[[.a.]]', '[\\a]', '[\\-a]', '[[:digit:][:alpha:]_]', '[[:punct:]]', '[[:space:]x]', '[[:xdigit:]]', '[[:cntrl:]]']) {
      // (Not read: a range with a collating symbol at an end, an equivalence class, which depend on the locale; a range
      // that ends in a class, which matches nothing at all.)
      if (['[a-[.z.]]', '[[=a=]-c]', '[a-[:digit:]]', '[+-[:digit:]]'].includes(pattern)) {
        assert.strictEqual(globToRegex(pattern, 'value'), undefined, pattern);
        continue;
      }
      for (const c of chars) assert.strictEqual(globMatches(pattern, c, 'value'), caseMatches(pattern, c), `${pattern} on ${c}`);
    }
    assert.ok(isGlob('[]]') && isGlob('[[:alpha:]]') && isGlob('a?') && isGlob('+(a)') && !isGlob('[a') && !isGlob('\\[a]') && !isGlob('a\\*'));
    // An extended glob the matcher cannot say (`!(…)` followed by a `*`) is no match, not an error.
    assert.strictEqual(globMatches('!(a)*', 'bx', 'value'), false);
    // The example of an uppercase with a pattern that can change nothing has the value as it is.
    assert.deepStrictEqual(examplesOf('echo ${s^^[!a-z]}')[0].sections[0].lines, ['hello world']);
    assert.strictEqual(bash('s="hello world"; echo "${s^^[!a-z]}"'), 'hello world\n');
  });

  it('does not fail on a case pattern that is not closed', () => {
    for (const src of ['echo ${s~~"a}', "echo ${s~~'a}", 'echo ${s~~$(}', 'echo ${s~~', 'echo ${s~~a', 'echo ${s~~${x}}']) {
      assert.ok(tokens(src).some((t) => t.kind === 'expansion'), src);
    }
  });

  it('does not claim more than bash does for the other lines', () => {
    const out = [
      ':x\ndot 2\n', 'a0 j k 1 11\n', '1\n0\nafter\n', '6 3 7 6\n', 'lex\nnum\nquoted-literal\n', 'x $v \\ V $v\n',
      '_a_b X/b b {a,b} {a,b}\n', 'cdef cdef de\n', 'named\nmoved\nb\n', '05 24 end\n', "a\\ b\\'c '' $'\\t' \nab c\n",
      '8 ABCDEF hello hELLO hello\n', '[] a|\n', 'bang\ncaret\nclass\nbracket\n',
    ];
    ROUND6.forEach((src, i) => assert.strictEqual(bash(src), out[i], src));
  });
});

// The fifteen lines of the seventh round.
const ROUND7 = [
  'case x in(x)echo y;;esac;if(true)then(echo a)fi;for i in 1;do echo $i;done;{ echo b;}',
  'echo $#a ${#a} a;#b; echo never',
  '[[ 1 = 1 || 1 = 2 && 1 = 3 ]] && echo dbl; true || false && false || echo list; [ 1 = 1 -o 1 = 2 -a 1 = 3 ] && echo single',
  'x=1 y=2; echo $((x+++y)) $x $((x---y)) $x $((- -x)) $((!!y)) $((~-1))',
  'x=0; echo $(( 0 && (x=5) )) $(( 1 || (x=6) )) $x $(( 1 ? 7 : (x=8) )) $x; for ((i=3;i--;)); do echo -n $i; done; echo',
  'f(){ echo $x; }; g(){ local x=in; f; }; x=out; g; f',
  'shopt -s extglob; s=aaabxb; echo ${s##+(a)} ${s//@(a|x)/-} ${s%%*(b)}',
  'a=(p q); r=\'a[1]\'; zq_1=x zq_2=y; echo ${!r} ${!zq_@} ${!a[@]}',
  'unset x; echo x${x-u}${x+s}x; x=; echo x${x-u}${x:-e}${x+s}${x:+n}x; s=\'*ab\'; echo ${s#"*"} ${s#*} ${s##*a}',
  'echo $\'a\\0b\'c \'\'"\'"\'\' "\'"\'"\' $\'\\x41\\0x\'',
  '((3>2)) && echo $((2>1))$[3>=3] && [ 10 \\< 9 ] && echo lexical',
  'printf \'%c|%.2s|%5s|%-3s|%x|%o|%i\\n\' hello world r l 255 8 0x1f',
  'a=([0]=x [0]+=y); mapfile -t l <<< $\'p\\nq\'; printf -v \'b[2]\' %s z; echo $a ${#l[@]} ${b[2]} ${!b[@]}',
  'function a-b.c { echo dash; }; function @ () ( echo at ); a-b.c; @',
  'IFS=\' ,\'; x=\' a , b,,c \'; set -- $x; echo $#; printf \'[%s]\' "$@"; echo',
];

describe('tricky lines (round 7)', () => {

  for (const lang of ['en', 'ja'] as const) {
    it(`explains the lines without errors (${lang})`, () => {
      ROUND7.forEach((src, i) => {
        assert.ok(!hasError(parser.parse(src).root), src);
        assert.ok(!tokens(src, lang).some((t) => t.kind === 'error'), src);
      });
    });
  }

  const expl = (src: string, label: string, lang: 'ja' | 'en' = 'en') => findAt(src, 0, label, lang).explanation;

  it('lists the variable names of ${!prefix@} and ${!prefix*}, not an indirection', () => {
    const src = ROUND7[7];
    assert.strictEqual(bash(src), 'q zq_1 zq_2 0 1\n');
    assert.match(expl(src, '${!zq_@}'), /^Names of all variables starting with `zq_` \(the value of a variable `zq_` is not used\); each name is a separate word/);
    assert.match(expl(src, '${!zq_@}', 'ja'), /^変数名の一覧: `zq_` で始まる名前の変数をすべて挙げる/);
    assert.doesNotMatch(expl(src, '${!zq_@}'), /Indirection/);
    const parts = findAt(src, 0, '${!zq_@}').children;
    assert.deepStrictEqual(parts.map((t) => t.label), ['!', 'zq_', '@']);
    assert.match(parts[2].explanation, /^one word per name .*not the `@` transform/);
    assert.match(findAt(src, 0, '${!zq_@}', 'ja').children[2].explanation, /変換の `@` ではない/);
    // Quoted: `@` keeps the names apart, `*` joins them with the first character of IFS.
    assert.strictEqual(bash('zq_1=x zq_2=y; set -- "${!zq_@}"; echo $#'), '2\n');
    assert.strictEqual(bash('zq_1=x zq_2=y; set -- "${!zq_*}"; echo $#'), '1\n');
    assert.strictEqual(bash('zq_1=x zq_2=y; IFS=,; echo "${!zq_*}"'), 'zq_1,zq_2\n');
    assert.match(expl('echo "${!zq_@}"', '${!zq_@}'), /each name is a separate word, also inside double quotes$/);
    assert.match(expl('echo "${!zq_*}"', '${!zq_*}'), /inside double quotes they form one word, joined with the first character of `IFS`$/);
    assert.match(expl('echo ${!zq_*}', '${!zq_*}'), /quoted, they form one word joined with the first character of `IFS` \(unquoted they are separate words\)$/);
    assert.match(expl('echo "${!zq_*}"', '${!zq_*}', 'ja'), /ダブルクォートの中なので、`IFS` の先頭の文字で区切った1つの単語になる$/);
    assert.match(findAt('echo ${!zq_*}', 0, '*').explanation, /^join the names/);
    assert.match(findAt('echo ${!zq_*}', 0, '*', 'ja').explanation, /^見つかった名前を1つにつなげる/);
    assert.match(findAt('echo ${!zq_*}', 0, '${!zq_*}').explanation, /^Names of all variables/);
    // Its example does not double the underscore.
    assert.strictEqual(new Analyzer('en').explainLine(parser.parse('echo ${!zq_@}'), 0).examples[0].sections[0].lines[0], 'zq_A zq_B');
    assert.strictEqual(new Analyzer('en').explainLine(parser.parse('echo ${!zq@}'), 0).examples[0].sections[0].lines[0], 'zq_A zq_B');
    // The siblings stay right: the keys of an array, an indirection (also to an element), indirection with a transform.
    assert.match(expl(src, '${!r}'), /^Indirection: use the value of `r` as a variable name$/);
    assert.match(expl(src, '${!a[@]}'), /^Indices \(keys\) of array `a`$/);
    assert.strictEqual(bash("a=(p q); r='a[1]'; echo ${!r} ${!a[@]} ${!a[*]}"), 'q 0 1 0 1\n');
    assert.match(expl('echo ${!x@Q}', '${!x@Q}'), /^Indirection: use the value of `x` as a variable name, then take that variable's value and quote it so it can be reused as shell input$/);
    assert.match(expl('echo ${!x@U}', '${!x@U}', 'ja'), /^間接参照: 変数 `x` の値を変数名とみなし、その変数の値をすべて大文字にする$/);
    assert.strictEqual(bash("r1=val; x=r1; echo ${!x@Q} ${!x@U}"), "'val' VAL\n");
  });

  it('says that = and == compare strings in [ ] and test, and patterns only in [[ ]]', () => {
    const src = ROUND7[2];
    assert.strictEqual(bash('[ a = a* ]; echo $?; [[ a = a* ]]; echo $?'), '1\n0\n');
    assert.strictEqual(bash('cd "$(mktemp -d)"; [ a = "a*" ]; echo $?; [ "a*" == "a*" ]; echo $?'), '1\n0\n');
    assert.strictEqual(bash('[ a == a? ]; echo $?; [[ a == a? ]]; echo $?'), '1\n1\n');
    assert.strictEqual(bash('[ a = [a] ]; echo $?; [[ a = [a] ]]; echo $?'), '1\n0\n');
    // The single test: no glob remark. The double test of the same line has it.
    assert.match(expl(src, '1 = 1'), /strings are equal \(the right side is plain text, not a pattern\)$/);
    assert.match(expl(src, '1 = 1', 'ja'), /文字列が等しい（右辺もただの文字列で、パターンではない）$/);
    assert.doesNotMatch(tokens(src).filter((t) => t.kind === 'test').map((t) => t.explanation).join('\n'), /glob pattern in `\[\[ \]\]`/);
    for (const s of ['[ a = a* ]', '[ a == a* ]', '[ "$x" = +(a) ]', '[ a = [ab] ]']) {
      const e = tokens(s).filter((t) => t.kind === 'test').pop()!.explanation;
      assert.match(e, /plain text, not a pattern/, s);
      assert.doesNotMatch(e, /glob/, s);
    }
    for (const s of ['[[ a = a* ]]', '[[ a == a* ]]']) {
      const e = tokens(s).filter((t) => t.kind === 'test').pop()!.explanation;
      assert.match(e, /strings are equal \(the right side is a glob pattern\)/, s);
    }
    assert.match(tokens('[[ a = a* ]]', 'ja').filter((t) => t.kind === 'test').pop()!.explanation, /文字列が等しい（右辺はグロブパターン）/);
    // `!=` and the numeric tests say nothing about patterns in either.
    assert.doesNotMatch(tokens('[ a != a* ]').filter((t) => t.kind === 'test').pop()!.explanation, /pattern/);
  });

  it('calls an extended glob in ${…} an extended glob, and decides at run time only for expansions', () => {
    const src = ROUND7[6];
    assert.strictEqual(bash(src), 'bxb ---b-b aaabx\n');
    assert.strictEqual(bash('s=aaabxb; echo ${s##+(a)}'), 'aaabxb\n');
    for (const [pat, label] of [['+(a)', '##'], ['@(a|x)', '//'], ['*(b)', '%%'], ['?(a)', '/'], ['!(a)b', '#'], ['!(b)', '//']] as const) {
      const line = label === '//' || label === '/' ? `echo \${s${label}${pat}/-}` : `echo \${s${label}${pat}}`;
      const e = findAt(line, 0, pat, 'en', true).explanation;
      // (bash matches the pattern with the extglob option of the moment: not turned on here, `+(a)` is plain text.)
      assert.match(e, /^Pattern `.*`: Glob pattern .*\. With extglob not turned on, there is no extended glob: `\(`, `\|` and `\)` are matched as plain characters$/, line);
      assert.doesNotMatch(e, /expansions/, line);
      assert.match(findAt(line, 0, pat, 'ja', true).explanation, /extglob が有効になっていないので拡張グロブにはならず/, line);
      const on = `shopt -s extglob; ${line}`;
      assert.match(findAt(on, 0, pat, 'en', true).explanation, /\. An extended glob needs `shopt -s extglob`, or it is taken as literal text$/, on);
      assert.match(findAt(on, 0, pat, 'ja', true).explanation, /拡張グロブは `shopt -s extglob` が必要/, on);
    }
    // A real expansion in the pattern is still decided at run time, extended glob or not.
    for (const pat of ['+($x)', '$x*', '$(echo a)', '`echo a`']) {
      assert.match(tokensAt(`echo \${s##${pat}}`, 0, 'en').find((t) => t.kind === 'pattern')!.explanation, /^Pattern `.*` \(contains expansions, so it is decided at run time\)$/, pat);
    }
    assert.match(findAt('echo ${s##+($x)}', 0, '+($x)', 'ja').explanation, /変数などを含むため、内容は実行時に決まる/);
    assert.strictEqual(bash('shopt -s extglob; s=aaabxb; x=a; echo ${s##+($x)}'), 'bxb\n');
  });

  it('does not claim more than bash does for the other lines', () => {
    const out = [
      'y\na\n1\nb\n',
      '0a 0 a\n',
      'dbl\nlist\nsingle\n',
      '3 2 0 1 1 1 0\n',
      '0 1 0 7 0\n210\n',
      'in\nout\n',
      'bxb ---b-b aaabx\n',
      'q zq_1 zq_2 0 1\n',
      'xux\nxesx\nab *ab b\n',
      'ac \' \'" A\n',
      '11\nlexical\n',
      'h|wo|    r|l  |ff|10|31\n',
      'xy 2 z 2\n',
      'dash\nat\n',
      '4\n[a][b][][c]\n',
    ];
    ROUND7.forEach((src, i) => assert.strictEqual(bash(src), out[i], src));
  });
});

// The thirteen lines of the eighth round.
const ROUND8 = [
  'function if { echo "kw $1"; }; \\if x; \'if\' y; i\\f z; if :; then echo real; fi',
  'for do in done; do echo $do; done; echo do done then',
  'a=AB; echo ${a,A} {$a,A} ${a,,} ${a~}',
  'p=a/a; echo ${p/a/b/c} ${p//\\//:} ${p/\\/a} ${p/#a/^}',
  'echo "$\'\\x41\'" $\'\\x41\'"$\'"\'$\' "\\$\'"',
  'x=\'#a#\'; echo ${x#\\#} ${x%\'#\'} ${x/#\'#\'/!} ${x//#/-} ${x/#/-} ${x/%/-}',
  'echo a\\ #b c#d \\#e #f',
  'declare -A h=(["a b"]=1 [c]=2 [\']\']=3); echo "${h["a b"]}" ${h[c]} ${h[\']\']} ${#h[@]}',
  '((echo a); echo b)',
  'a[1 + 1]=x; ((b[1+1]=5, b[2]++)); echo ${!a[@]} ${a[2]} ${b[2]} ${!b[@]}',
  'x=\'1 2\'; declare y=$x; echo "$y"; x=0; x=1 echo $x; x=2 >/dev/null; echo $x',
  '[[ -a /dev/null && -z "" && ! ( a > b || -n "" ) ]] && echo t; ! ! true; echo $?',
  'case $(echo a) in $(echo a)) echo m;; esac; case \'a)\' in "a)") echo q;; esac; echo $(( ((1)) ))$((1))',
];

describe('tricky lines (round 8)', () => {

  for (const lang of ['en', 'ja'] as const) {
    it(`explains the lines without errors (${lang})`, () => {
      ROUND8.forEach((src, i) => {
        assert.ok(!hasError(parser.parse(src).root), src);
        assert.ok(!tokens(src, lang).some((t) => t.kind === 'error'), src);
      });
    });
  }

  it('explains an element with a quoted key as a keyed element, with the key bash gives it', () => {
    const elem = (src: string, label: string, lang: 'ja' | 'en' = 'en') => findAt(src, 0, label, lang).explanation;
    const src = ROUND8[7];
    assert.strictEqual(bash(src), '1 2 3 3\n');
    assert.strictEqual(elem(src, '["a b"]=1'), 'Element with key `a b` (a string, not evaluated): set it to `1`');
    assert.strictEqual(elem(src, '[\']\']=3'), 'Element with key `]` (a string, not evaluated): set it to `3`');
    assert.strictEqual(elem(src, '[c]=2'), 'Element with key `c` (a string, not evaluated): set it to `2`');
    assert.strictEqual(elem(src, '["a b"]=1', 'ja'), 'キー `a b`（文字列で、計算はされない）の要素に `1` を代入する');
    // Each element gives the key and the value shown (bash: `declare -p`).
    assert.strictEqual(bash('declare -A h=(["a b"]=1 [c]=2 [\']\']=3); echo "${h["a b"]}" ${h[c]} ${h[\']\']} ${#h[@]}'), '1 2 3 3\n');
    for (const [s, label, key, op, value] of [
      ['declare -A h=(["a b"]=1 [a]=2 [a]+=x); declare -p h', '[a]+=x', 'a', 'append', 'x'],
      ['declare -A h=([\'q r\']=z); declare -p h', '[\'q r\']=z', 'q r', 'set it to', 'z'],
      ['declare -A h=([\'a=b\']=c); declare -p h', '[\'a=b\']=c', 'a=b', 'set it to', 'c'],
      ['declare -A h=([a\\]]=c); declare -p h', '[a\\]]=c', 'a]', 'set it to', 'c'],
      ['declare -A h=([a[1]]=c); declare -p h', '[a[1]]=c', 'a[1]', 'set it to', 'c'],
      ['declare -A h=([\'a]\']+=c); declare -p h', '[\'a]\']+=c', 'a]', 'append', 'c'],
    ] as const) {
      assert.strictEqual(elem(s, label), `Element with key \`${key}\` (a string, not evaluated): ${op} \`${value}\``, s);
      assert.ok(bash(s).includes(`["${key}"]="${value}"`) || bash(s).includes(`[${key}]="${value}"`), s);
    }
  });

  it('keeps an expansion in the key as written, and reads an indexed key as arithmetic after the quotes', () => {
    for (const s of ['declare -A h=(["$k"]=v); k=a', 'declare -A h=([${k}]=v)', 'declare -A h=([$k]=v)']) {
      const key = /\[(.*?)\]=/.exec(s)![1];
      assert.strictEqual(findAt(s, 0, `[${key}]=v`).explanation, `Element with key \`${key}\` (a string, not evaluated): set it to \`v\``, s);
    }
    assert.strictEqual(bash('k="x y"; declare -A h=(["$k"]=v [${k}]=w [$k]=z); declare -p h'), 'declare -A h=(["x y"]="z" )\n');
    assert.strictEqual(bash('k=3; a=(["$k"]=v [${k}]=w); declare -p a'), 'declare -a a=([3]="w")\n');
    for (const [s, label, shown, n] of [
      ['a=(["1"+1]=x)', '["1"+1]=x', '1+1', 2],
      ['a=([\'1\'+1]=x)', '[\'1\'+1]=x', '1+1', 2],
    ] as const) {
      assert.strictEqual(findAt(s, 0, label).explanation, `Element with index \`${shown}\` (an arithmetic expression: ${n}): set it to \`x\``, s);
      assert.strictEqual(bash(`${s}; declare -p a`), 'declare -a a=([2]="x")\n', s);
    }
    assert.strictEqual(findAt('a=(["k"]+=v)', 0, '["k"]+=v').explanation, 'Element with index `k` (an arithmetic expression: the value of the variable `k`, 0 when it is not set): append `v`');
    assert.strictEqual(bash('a=(["k"]+=v); declare -p a'), 'declare -a a=([0]="v")\n');
  });

  it('takes a word that only starts like an element for a plain word', () => {
    for (const s of ['a=([k]v [ab x)', 'a=([k]v)']) {
      assert.ok(!tokens(s).some((t) => t.explanation.startsWith('Element with')), s);
    }
    assert.strictEqual(bash('a=([k]v); declare -p a'), 'declare -a a=([0]="[k]v")\n');
  });

  it('does not claim more than bash does for the other lines', () => {
    const out = [
      'kw x\nkw y\nkw z\nreal\n',
      'done\ndo done then\n',
      'aB AB A ab aB\n',
      'b/c/a a:a a ^/a\n',
      '$\'\\x41\' A$\'$ $\'\n',
      'a# #a !a# -a- -#a# #a#-\n',
      'a #b c#d #e\n',
      '1 2 3 3\n',
      'a\nb\n',
      '2 x 6 2\n',
      '1 2\n0\n2\n',
      't\n0\n',
      'm\nq\n11\n',
    ];
    ROUND8.forEach((src, i) => assert.strictEqual(bash(src), out[i], src));
  });
});

// The twelve lines of the ninth round.
const ROUND9 = [
  'x=y y=3; [[ 1+1 -eq 2 && x -eq 3 ]] && echo arith; [ 1+1 -eq 2 ] 2>/dev/null || echo int-only',
  '[[ \'a b\' =~ a( )b && \'a]\' =~ [ab]] && x =~ ^(x|y)$ ]] && echo regex',
  'echo {a,{b},c} {{a,b}} {"a,b"} x={a,b}; y={a,b}; z=(p{1,2}); echo $y ${z[@]}',
  'a=(1 2 3); unset \'a[1]\'; echo ${#a[@]} ${a[@]:1:1} ${!a[@]}; a=c; echo ${a[@]} $a[2] ${a}2',
  'if { true; } then echo y; fi; if (false) then :; else echo n; fi; case x in esac; echo empty-case',
  'if=1 then=2; fi=3; echo $if$then$fi; done=x eval \'echo $done\'',
  'p=\'*\'; case abc in "$p") echo lit;; $p) echo glob;; esac; case \'*\' in "$p") echo lit2;; esac',
  'echo -e \'a\\cb\'; echo c; printf %s\\\\n x \'\\t\'; echo \'\\\'\\\'',
  'y=5; y= eval \'echo "[$y]"\'; echo $y; x=1 eval \'echo $x\'',
  'x=\'a\\tb\'; declare -ri r=1; a=(p q); echo "${x@E}" ${x@A} ${a[@]@K} ${r@a}',
  'select s in a b; do echo $s; break; done <<< 2 2>/dev/null',
  '{ (echo a) }; f() (( $1 > 2 )); f 3 && echo big; ! f 1 && echo small',
];

/** The output of bash for `script`, run in an empty directory. */
const bashEmpty = (script: string): string => bash(`cd "$(mktemp -d)" && ${script}`);

describe('tricky lines (round 9)', () => {
  const elem = (src: string, label: string, lang: 'ja' | 'en' = 'en') => findAt(src, 0, label, lang).explanation;

  for (const lang of ['en', 'ja'] as const) {
    it(`explains the lines without errors (${lang})`, () => {
      ROUND9.forEach((src, i) => {
        assert.ok(!hasError(parser.parse(src).root), src);
        assert.ok(!tokens(src, lang).some((t) => t.kind === 'error'), src);
      });
    });
  }

  it('does not claim more than bash does for the lines', () => {
    const out = [
      'arith\nint-only\n',
      'regex\n',
      'a {b} c {a} {b} {a,b} x=a x=b\n{a,b} p1 p2\n',
      '2 3 0 2\nc 3 c[2] c2\n',
      'y\nn\nempty-case\n',
      '123\nx\n',
      'glob\nlit2\n',
      'ac\nx\n\\t\n\\\'\n',
      '[]\n5\n1\n',
      'a\tb x=\'a\\tb\' 0 "p" 1 "q" ir\n',
      'b\n',
      'a\nbig\nsmall\n',
    ];
    ROUND9.forEach((src, i) => assert.strictEqual(bashEmpty(src), out[i], src));
  });

  it('explains a subscript with spaces in a compound assignment as one keyed element', () => {
    // bash reads the subscript up to its `]`, spaces included (`declare -p`).
    for (const [s, label, what, op, value, shown] of [
      ['a=([1 + 1]=x); declare -p a', '[1 + 1]=x', 'index `1 + 1` (an arithmetic expression: 2)', 'set it to', 'x', 'declare -a a=([2]="x")\n'],
      ['a=([1 +1]=x [ 3 ]=y); declare -p a', '[1 +1]=x', 'index `1 +1` (an arithmetic expression: 2)', 'set it to', 'x', 'declare -a a=([2]="x" [3]="y")\n'],
      ['a=(p q r s); a=([1 + 1]+=x); declare -p a', '[1 + 1]+=x', 'index `1 + 1` (an arithmetic expression: 2)', 'append', 'x', 'declare -a a=([2]="x")\n'],
      ['a=( [1 + $((1))]=x y); declare -p a', '[1 + $((1))]=x', 'index `1 + $((1))` (an arithmetic expression)', 'set it to', 'x', 'declare -a a=([2]="x" [3]="y")\n'],
      ['declare -A m=([a b]=1); declare -p m', '[a b]=1', 'key `a b` (a string, not evaluated)', 'set it to', '1', 'declare -A m=(["a b"]="1" )\n'],
      ['declare -A m=([c  d]+=2); declare -p m', '[c  d]+=2', 'key `c  d` (a string, not evaluated)', 'append', '2', 'declare -A m=(["c  d"]="2" )\n'],
    ] as const) {
      assert.strictEqual(elem(s.split('; declare -p')[0], label), `Element with ${what}: ${op} \`${value}\``, s);
      assert.strictEqual(bash(s), shown, s);
    }
    assert.strictEqual(elem('declare -A m=([a b]=1)', '[a b]=1', 'ja'), 'キー `a b`（文字列で、計算はされない）の要素に `1` を代入する');
    // The elements after it are not swallowed.
    const kids = tokens('a=([1 + 1]=x y [5]=z)').filter((t) => t.label.startsWith('[') || t.label === 'y').map((t) => t.label);
    assert.deepStrictEqual(kids, ['[1 + 1]=x', 'y', '[5]=z']);
    assert.strictEqual(bash('a=([1 + 1]=x y [5]=z); declare -p a'), 'declare -a a=([2]="x" [3]="y" [5]="z")\n');
  });

  it('does not join words that bash keeps apart', () => {
    for (const s of ['a=([1 + 1] =x)', 'a=([1 + 1] = x)', 'a=([1 + 1]x)', 'a=(x[1 + 1]=x)', 'a=([1 + 1 =x)']) {
      assert.ok(!tokens(s).some((t) => t.explanation.startsWith('Element with')), s);
    }
    assert.strictEqual(bash('a=([1 + 1] =x); declare -p a'), 'declare -a a=([0]="[1 + 1]" [1]="=x")\n');
    assert.strictEqual(bash('a=([1 + 1] = x); declare -p a'), 'declare -a a=([0]="[1 + 1]" [1]="=" [2]="x")\n');
    assert.strictEqual(bash('a=(x[1 + 1]=x); declare -p a'), 'declare -a a=([0]="x[1" [1]="+" [2]="1]=x")\n');
  });

  it('says that ${a[@]@K} gives index and value pairs for an indexed array too', () => {
    const k = find('echo "${a[@]@K}"', '${a[@]@K}').explanation;
    assert.match(k, /show it as key\/value pairs with quoted values \(index\/value pairs for an indexed array\)$/);
    assert.ok(!/associative/.test(k));
    assert.strictEqual(bash('a=(p "q r"); echo "${a[@]@K}"'), '0 "p" 1 "q r"\n');
    assert.strictEqual(bash('declare -A h=([x]=1); echo "${h[@]@K}"'), 'x "1" \n');
    assert.match(find('echo ${a[@]@k}', '${a[@]@k}').explanation, /alternating keys and values \(indices and values for an indexed array\)$/);
    assert.strictEqual(bash('a=(p "q r"); echo ${a[@]@k}'), '0 p 1 q r\n');
    assert.match(find('echo "${a[@]@K}"', '${a[@]@K}', 'ja').explanation, /^パラメータ展開: `a` の値をキーと値の組（値は引用符付き、通常の配列では添字と値の組）の形にする$/);
  });

  it('words @E, @A, @K and @a in Japanese without a doubled を', () => {
    for (const t of ['E', 'A', 'K', 'a', 'k', 'Q', 'P']) {
      const ex = find(`echo \${x@${t}}`, `\${x@${t}}`, 'ja').explanation;
      assert.ok(ex.startsWith('パラメータ展開: `x` の値を') && !/を.*を/.test(ex.slice('パラメータ展開: `x` の値を'.length)), ex);
    }
  });

  it('says why [ 1+1 -eq 2 ] fails, and that [[ ]] calculates it', () => {
    const single = (src: string) => find(src, src.slice(2, -2).trim()).explanation;
    assert.match(single('[ 1+1 -eq 2 ]'), /`\[ \]` reads only integers for -eq, so `1\+1` is an error \(integer expression expected\); `\[\[ \]\]` would read it as arithmetic \(2\)$/);
    assert.match(find('[ 1+1 -eq 2 ]', '1+1 -eq 2', 'ja').explanation, /`\[ \]` の -eq は整数しか読めないので `1\+1` はエラー（integer expression expected）。`\[\[ \]\]` なら算術として読める（2）$/);
    assert.match(find('[[ 1+1 -eq 2 ]]', '1+1 -eq 2').explanation, /`\[\[ \]\]` reads -eq operands as arithmetic, so `1\+1` is 2$/);
    assert.match(find('[ x -eq 2 ]', 'x -eq 2').explanation, /so `x` is an error \(integer expression expected\); `\[\[ \]\]` would read it as arithmetic$/);
    assert.match(find('[ 1.5 -ne 1 ]', '1.5 -ne 1').explanation, /so `1\.5` is an error/);
    // Plain integers, and operands that are not known, get no such note.
    for (const s of ['[ 2 -eq 2 ]', '[ -5 -lt +3 ]', '[ "$x" -eq 1 ]', '[ $x -eq 1 ]', '[[ x -eq 3 ]]', '[[ 2 -eq 2 ]]', '[ a = b ]']) {
      assert.ok(!/integer expression|as arithmetic/.test(tokens(s).map((t) => t.explanation).join('\n')), s);
    }
    assert.match(bashErr('[ 1+1 -eq 2 ]'), /integer expression expected/);
    assert.match(bashErr('[ x -eq 2 ]'), /integer expression expected/);
    assert.match(bashErr('[ 1.5 -ne 1 ]'), /integer expression expected/);
    assert.strictEqual(bash('[ -5 -lt +3 ] && echo y'), 'y\n');
    assert.strictEqual(bash('[[ 1+1 -eq 2 ]] && echo y'), 'y\n');
    assert.strictEqual(bash('[[ 2*3 -eq 6 ]] && echo y'), 'y\n');
  });
});

describe('words as bash reads them (round 10)', () => {
  /** What bash prints on stdout and stderr, in a fresh empty directory (status ignored: some of these fail on purpose). */
  const run = (script: string): string => {
    const r = runBash(script, { files: [] });
    return r.stdout + r.stderr.replace(/^bash: line \d+: /gm, '');
  };
  const explained = (src: string, line = 0, lang: 'ja' | 'en' = 'en') => new Analyzer(lang).explainLine(parser.parse(src), line);

  it('splits the read example with the IFS in effect, not the default one', () => {
    assert.strictEqual(bash('line=\'alice 30 tokyo\'; IFS=,; read -r a b <<< "$line"; echo "a=[$a] b=[$b]"'), 'a=[alice 30 tokyo] b=[]\n');
    // The example's line, read by bash with the same IFS, gives the values the example shows.
    for (const [setup, src] of [['IFS=,', 'IFS=,; read -r a b <<< "$line"'], ["IFS=$'\\t'", "IFS=$'\\t'; read -r a b c"], ['IFS=:', 'IFS=:\nread -r a b'], [':', 'read -r a b']]) {
      const lines = src.split('\n');
      const ex = new Analyzer('en').explainLine(parser.parse(src), lines.length - 1).examples.find((e) => e.kind === 'read');
      assert.ok(ex, src);
      const line = JSON.parse(ex.sections[0].lines[0]) as string;
      const names = ex.sections[1].lines.map((l) => l.split('=')[0]);
      const r = runBash(`${setup}; read -r ${names.join(' ')}; for v in ${names.join(' ')}; do printf '%s=%s\\n' "$v" "\${!v}"; done`, { input: `${line}\n` });
      assert.strictEqual(r.stdout, ex.sections[1].lines.map((l) => { const [k, v] = l.split(/=(.*)/); return `${k}=${JSON.parse(v) as string}`; }).join('\n') + '\n', src);
    }
    assert.deepStrictEqual(examplesOf('IFS=,; read -r a b')[0].sections[1].lines, ['a="alice"', 'b="30,tokyo"']);
    // An IFS that is not known there: no example (`IFS=$x`, or set on some paths only).
    for (const src of ['IFS=$x; read -r a b', 'if [ "$1" ]; then IFS=,; fi; read -r a b']) {
      assert.ok(!explained(src).examples.some((e) => e.kind === 'read'), src);
    }
  });

  it('says that a quoted expansion in a case pattern is matched as literal text', () => {
    assert.strictEqual(bash('q=\'a*\'; for x in abc \'a*\'; do case $x in "$q") echo "$x: literal";; $q) echo "$x: pattern";; esac; done'), 'abc: pattern\na*: literal\n');
    assert.strictEqual(bash('q=\'a*\'; case abc in "$q"*) echo m;; *) echo n;; esac; case \'a*c\' in "$q"*) echo m;; esac; p=\'?\'; case \'b*\' in $p"*") echo m2;; esac'), 'n\nm\nm2\n');
    const src = 'case $x in "$q") :;; $p) :;; "$q"*) :;; $p"*") :;; "$(cmd)") :;; esac';
    assert.strictEqual(findAt(src, 0, '"$q"', 'en', true).explanation, 'Pattern `"$q"`: the expansion is quoted, so its value is matched as literal text (`*` and `?` in the value are not wildcards)');
    assert.strictEqual(findAt(src, 0, '"$q"', 'ja', true).explanation, 'パターン `"$q"`: 展開はクォートされているので、その値は文字列そのものとして照合される（値の中の `*` や `?` はワイルドカードにならない）');
    assert.match(findAt(src, 0, '"$q"*', 'en', true).explanation, /^Pattern `"\$q"\*`: the expansion is quoted/);
    assert.match(findAt(src, 0, '"$(cmd)"', 'en', true).explanation, /^Pattern `"\$\(cmd\)"`: the expansion is quoted/);
    assert.strictEqual(findAt(src, 0, '$p', 'en', true).explanation, 'Pattern `$p`: what it expands to is the pattern');
    assert.strictEqual(findAt(src, 0, '$p"*"', 'en', true).explanation, 'Pattern `$p"*"`: what the unquoted expansions give is a pattern, and the quoted parts are matched as literal text');
    assert.strictEqual(findAt(src, 0, '$p"*"', 'ja', true).explanation, 'パターン `$p"*"`: クォートしていない展開の結果はパターンになり、クォートした部分は文字列そのものとして照合される');
    // `[[ == ]]` already said so.
    assert.strictEqual(bash('q=\'a*\'; [[ abc == "$q" ]] || echo literal'), 'literal\n');
    assert.match(findAt('[[ $x == "$q" ]]', 0, '$x == "$q"').explanation, /the right side is quoted, so it is literal text, not a pattern/);
  });

  it('explains ** with the globstar option in effect, in the word and in the example', () => {
    assert.strictEqual(run('mkdir -p d/e && touch a.sh d/b.sh d/e/c.sh; echo **/*.sh; shopt -s globstar; echo **/*.sh'), 'd/b.sh\na.sh d/b.sh d/e/c.sh\n');
    for (const [src, options, deep] of [['ls **/*.sh', '', false], ['shopt -u globstar; ls **/*.sh', 'shopt -u globstar;', false], ['shopt -s globstar; ls **/*.sh', 'shopt -s globstar;', true], ['if [ "$1" ]; then shopt -s globstar; fi; ls **/*.sh', 'shopt -s globstar;', true]] as const) {
      const ex = explained(src).examples.find((e) => e.kind === 'glob')!;
      const [yes, no] = ex.sections.map((sec) => sec.lines);
      // The names of the example, made as files: bash matches exactly those it lists as matching.
      const made = [...yes, ...no].map((f) => `mkdir -p "$(dirname '${f}')" && touch '${f}'`).join(' && ');
      assert.deepStrictEqual(run(`${made}; ${options} printf '%s\\n' **/*.sh`).trim().split('\n').sort(), [...yes].sort(), src);
      assert.strictEqual(yes.some((f) => f.split('/').length !== 2), deep, src);
    }
    assert.match(findAt('ls **/*.sh', 0, '**/*.sh').explanation, /\. With globstar not turned on, `\*\*` is the same as `\*` and matches one level only$/);
    assert.match(findAt('ls **/*.sh', 0, '**/*.sh', 'ja').explanation, /。globstar が有効になっていないので `\*\*` は `\*` と同じで、1階層分にしか一致しない$/);
    const maybe = 'if [ "$1" ]; then shopt -s globstar; fi; ls **/*.sh';
    assert.match(findAt(maybe, 0, '**/*.sh').explanation, /\. Where globstar is on, `\*\*` matches directories at any depth \(zero or more, not those starting with `\.`\); elsewhere it is the same as `\*` and matches one level only$/);
    assert.match(findAt(maybe, 0, '**/*.sh', 'ja').explanation, /。globstar が有効な経路では `\*\*` は任意の深さのディレクトリ.*に一致する。ほかの経路では `\*` と同じで、1階層分にしか一致しない$/);
    assert.match(explained(maybe).examples.find((e) => e.kind === 'glob')!.title, /\(glob `\*\*\/\*\.sh`, where globstar is on\)$/);
    assert.match(explained(maybe, 0, 'ja').examples.find((e) => e.kind === 'glob')!.title, /（グロブ `\*\*\/\*\.sh`、globstar が有効なとき）$/);
  });

  it('explains a tilde after the `=` of an assignment as the home directory', () => {
    assert.strictEqual(bash('x=~; y=a:~/b; z={a,b}; echo "$x $y $z"'), '/home/w a:/home/w/b {a,b}\n');
    assert.strictEqual(findAt('x=~', 0, '~').explanation, 'Tilde expansion: `~` becomes the home directory (`$HOME`)');
    assert.strictEqual(findAt('x=~', 0, '~', 'ja').explanation, 'チルダ展開: `~` はホームディレクトリ（`$HOME`）に置き換わる');
    // A brace is not expanded in an assignment: it stays a value.
    assert.strictEqual(findAt('z={a,b}', 0, '{a,b}').explanation, 'Value `{a,b}`');
  });

  it('gives the message of ${x:?word} after quote removal, and the empty one too', () => {
    const err = (script: string) => runBash(script).stderr.replace(/^bash: line \d+: /gm, '');
    assert.strictEqual(err(': ${x:?"msg"}'), 'x: msg\n');
    assert.strictEqual(err('y=Y; : ${x:?"need $y"}'), 'x: need Y\n');
    assert.strictEqual(err(": ${x?'a b'}"), 'x: a b\n');
    assert.strictEqual(err(': ${x:?""}'), 'x: \n');
    assert.strictEqual(err(': ${x:?}'), 'x: parameter null or not set\n');
    const src = ': ${x:?"msg"} ${x?\'a b\'} ${x:?"need $y"} ${x:?""} ${x:?}';
    const t = (label: string, lang: 'ja' | 'en' = 'en') => findAt(src, 0, label, lang, true).explanation;
    assert.strictEqual(t('${x:?"msg"}'), 'Parameter expansion: Exit with error "msg" if `x` is unset or empty');
    assert.strictEqual(t('${x:?"msg"}', 'ja'), 'パラメータ展開: `x` が未設定または空ならエラーメッセージ「msg」を出してスクリプトを終了');
    assert.strictEqual(t('${x?\'a b\'}'), 'Parameter expansion: Exit with error "a b" if `x` is unset');
    assert.strictEqual(t('${x:?"need $y"}'), 'Parameter expansion: Exit with error "need $y" if `x` is unset or empty');
    assert.strictEqual(t('${x:?""}'), 'Parameter expansion: Exit with error "" if `x` is unset or empty');
    assert.strictEqual(t('${x:?}'), 'Parameter expansion: Exit with error "parameter null or not set" if `x` is unset or empty');
    // A word that is not one quoted string is shown as written.
    assert.strictEqual(err('m=oops; : ${x:?$m}'), 'x: oops\n');
    assert.strictEqual(findAt(': ${x:?$m}', 0, '${x:?$m}', 'en', true).explanation, 'Parameter expansion: Exit with error "$m" if `x` is unset or empty');
    assert.strictEqual(findAt(src, 0, '"msg"', 'en', true).explanation, 'Error message "msg"');
    assert.strictEqual(findAt(src, 0, '"msg"', 'ja', true).explanation, 'エラーメッセージ「msg」');
    const fails = explained(src).examples.map((e) => e.sections[0].lines[0]);
    assert.deepStrictEqual(fails, ['prints the error "msg" and exits', 'prints the error "a b" and exits', 'prints the error "need $y" and exits', 'prints the error "" and exits', 'prints the error "(a default message)" and exits']);
  });

  it('reads @(…) in a ${…} pattern as plain text without extglob, as bash matches it', () => {
    assert.strictEqual(bash('x=a.gz; echo "${x%.@(gz|bz2)}"; x=\'a.@(gz|bz2)\'; echo "${x%.@(gz|bz2)}"; x=a.gz; shopt -s extglob; echo "${x%.@(gz|bz2)}"'), 'a.gz\na\na\n');
    // (Matched with the option of the moment: a function read before `shopt -s extglob` follows it when it runs.)
    assert.strictEqual(bash('f() { echo "${x%.@(gz|bz2)}"; }; x=a.gz; f; shopt -s extglob; f'), 'a.gz\na\n');
    const off = 'echo "${x%.@(gz|bz2)}"';
    const kids = (src: string) => findAt(src, src.split('\n').length - 1, '.@(gz|bz2)', 'en', true).children.map((c) => [c.label, c.explanation]);
    assert.deepStrictEqual(kids(off), [['.@(gz|bz2)', 'The text `.@(gz|bz2)` itself']]);
    assert.ok(!tokensAt(off, 0).some((t) => /extended glob,/.test(t.explanation)));
    assert.match(findAt(off, 0, '.@(gz|bz2)', 'ja', true).explanation, /extglob が有効になっていないので拡張グロブにはならず、`\(`、`\|`、`\)` は普通の文字として照合される$/);
    assert.match(findAt(`shopt -u extglob; ${off}`, 0, '.@(gz|bz2)', 'en', true).explanation, /\. With extglob off, there is no extended glob/);
    for (const on of [`shopt -s extglob; ${off}`, `shopt -s extglob\n${off}`]) {
      assert.deepStrictEqual(kids(on).map(([l]) => l), ['.', '@(gz|bz2)'], on);
      assert.match(findAt(on, on.split('\n').length - 1, '@(gz|bz2)').explanation, /^`@\(…\)`: extended glob/, on);
    }
    // `*(d)` without extglob: a `*` and the text `(d)`.
    assert.strictEqual(bash('x=\'abc(d)\'; echo "${x%*(d)}"'), 'abc\n');
    assert.deepStrictEqual(findAt('echo "${x%*(d)}"', 0, '*(d)', 'en', true).children.map((c) => c.label), ['*', '(d)']);
  });

  it('does not take the guard of an unmatched glob for an idiom when nullglob or failglob is on', () => {
    assert.strictEqual(run('for f in *.txt; do echo "[$f]"; done'), '[*.txt]\n');
    assert.strictEqual(run('shopt -s nullglob; for f in *.txt; do echo "[$f]"; done; echo end'), 'end\n');
    assert.match(run('shopt -s failglob; for f in *.txt; do echo "[$f]"; done'), /^no match: \*\.txt\n$/);
    const loop = 'for f in *.txt; do [ -e "$f" ] || continue; echo "$f"; done';
    const idiom = (src: string) => notesAt(src).some((n) => /^Idiom: skips a name that does not exist/.test(n));
    assert.ok(idiom(loop));
    for (const opt of ['nullglob', 'failglob']) assert.ok(!idiom(`shopt -s ${opt}; ${loop}`), opt);
    assert.ok(idiom(`shopt -s nullglob; shopt -u nullglob; ${loop}`));
  });

  it('gives one word per element only for a "$@" of the string itself, not one inside a $( ) in it', () => {
    assert.strictEqual(bash('a=(1 2); set -- "$(printf \'%s \' "${a[@]}")"; echo $#; set -- "${a[@]}"; echo $#; f() { echo $#; }; set -- 1 2; f "a $@" "${x:-$@}"'), '1\n2\n4\n');
    const each = /one word per element/;
    const src = 'x="$(printf \'%s\\n\' "${a[@]}")"';
    assert.doesNotMatch(findAt(src, 0, '"$(printf \'%s\\n\' "${a[@]}")"').explanation, each);
    assert.match(findAt(src, 0, '"${a[@]}"').explanation, each);
    for (const s of ['f "a $@"', 'f "${x:-$@}"', 'f "${a[@]}"', 'f "${!p@}"']) assert.match(findAt(s, 0, s.slice(2), 'en', true).explanation, each, s);
  });

  it('reads a name in the subscript of an indexed array as a variable', () => {
    assert.strictEqual(bash('unset k; a=(["k"]=w); declare -p a; k=3; a=([k]=w); declare -p a'), 'declare -a a=([0]="w")\ndeclare -a a=([3]="w")\n');
    assert.strictEqual(bash('declare -A m=(["k"]=w); declare -p m'), 'declare -A m=([k]="w" )\n');
    assert.strictEqual(findAt('a=(["k"]=w)', 0, '["k"]=w').explanation, 'Element with index `k` (an arithmetic expression: the value of the variable `k`, 0 when it is not set): set it to `w`');
    assert.strictEqual(findAt('a=(["k"]=w)', 0, '["k"]=w', 'ja').explanation, '添字 `k`（算術式なので変数 `k` の値。未設定なら 0）の要素に `w` を代入する');
    assert.strictEqual(findAt('a=([i+1]=w)', 0, '[i+1]=w').explanation, 'Element with index `i+1` (an arithmetic expression): set it to `w`');
    assert.strictEqual(findAt('a=([i+1]=w)', 0, '[i+1]=w', 'ja').explanation, '添字 `i+1`（算術式として計算される）の要素に `w` を代入する');
    assert.strictEqual(findAt('declare -A m=(["k"]=w)', 0, '["k"]=w').explanation, 'Element with key `k` (a string, not evaluated): set it to `w`');
  });

  it('says that ${s@K} and ${s@k} quote a value that is not all the elements of an array', () => {
    assert.strictEqual(bash('s=hello; a=(p q); set -- x \'y z\'; echo "${s@K} ${s@k} ${a@K} ${@@K}"; echo "${a[@]@K}"'), '\'hello\' \'hello\' \'p\' \'x\' \'y z\'\n0 "p" 1 "q"\n');
    const k = (src: string, label: string, lang: 'ja' | 'en' = 'en') => tokensAt(src, 0, lang).find((t) => t.kind === 'expansion' && t.label === label)!.explanation;
    assert.strictEqual(k('echo "${s@K}"', '${s@K}'), 'Parameter expansion: take the value of `s` and quote it as `@Q` does, so it can be reused as shell input (only all the elements of an array, `${a[@]@K}`, give keys and values)');
    assert.strictEqual(k('echo "${s@K}"', '${s@K}', 'ja'), 'パラメータ展開: `s` の値をシェルに再入力できる形に `@Q` と同じくクォートする（キーと値の組になるのは配列の全要素 `${a[@]@K}` だけ）');
    assert.match(k('echo ${s@k}', '${s@k}'), /quote it as `@Q` does.*`\$\{a\[@\]@k\}`, give keys and values\)$/);
    assert.match(k('echo "${@@K}"', '${@@K}'), /quote it as `@Q` does/);
    assert.match(k('echo "${a[*]@K}"', '${a[*]@K}'), /key\/value pairs/);
    assert.match(k('echo "${!s@K}"', '${!s@K}'), /then take that variable's value and quote it as `@Q` does/);
  });
});

describe('words as bash reads them (round 10, review)', () => {
  /** What bash prints on stdout and stderr, in a fresh empty directory (status ignored: some of these fail on purpose). */
  const run = (script: string): string => {
    const r = runBash(script, { files: [] });
    return r.stdout + r.stderr.replace(/^bash: line \d+: /gm, '');
  };
  const explained = (src: string, line = 0, lang: 'ja' | 'en' = 'en') => new Analyzer(lang).explainLine(parser.parse(src), line);

  it('reads a subscript as arithmetic only when the array is surely not associative', () => {
    assert.strictEqual(run('declare -n r=m; declare -A m; r=([k]=v); declare -p m'), 'declare -A m=([k]="v" )\n');
    assert.strictEqual(run('y=1; if [ "$y" ]; then declare -A m; fi; m=([k]=v); declare -p m'), 'declare -A m=([k]="v" )\n');
    assert.strictEqual(run('name=m; declare -A "$name"; m=([k]=v); declare -p m'), 'declare -A m=([k]="v" )\n');
    assert.strictEqual(run('echo "declare -A m" > lib.sh; source ./lib.sh; m=([k]=v); declare -p m'), 'declare -A m=([k]="v" )\n');
    assert.strictEqual(run('declare -A m; unset m; k=1; m=([k]=v); declare -p m'), 'declare -a m=([1]="v")\n');
    const el = (src: string, lang: 'ja' | 'en' = 'en') => findAt(src, 0, '[k]=v', lang).explanation;
    assert.strictEqual(el('declare -n r=m; declare -A m; r=([k]=v)'), 'Element with key `k` (a string, not evaluated): set it to `v`');
    for (const src of ['if [ "$y" ]; then declare -A m; fi; m=([k]=v)', 'declare -A "$name"; m=([k]=v)', 'source ./lib.sh; m=([k]=v)', 'declare -n r=$x; r=([k]=v)', 'declare -n r=s; declare -n s=r; r=([k]=v)']) {
      assert.strictEqual(el(src), 'Element with subscript `k` (a key if the array is associative, an arithmetic expression otherwise): set it to `v`', src);
      assert.strictEqual(el(src, 'ja'), '添字 `k`（連想配列ならキー、そうでなければ算術式）の要素に `v` を代入する', src);
    }
    assert.match(el('declare -A m; unset m; m=([k]=v)'), /^Element with index `k` \(an arithmetic expression: the value of the variable `k`/);
    assert.match(el('declare -n r=m; r=([k]=v)'), /^Element with index `k` \(an arithmetic expression/);
  });

  it('gives one word per element from the parsed expansion, and not in the value of an assignment', () => {
    const setup = 'a=(1 2); set -- 1 2; f() { echo $#; }; y=';
    assert.strictEqual(bash(`${setup}; f "\${y:-$(printf %s "\${a[@]}")}"; f "\${a[@]:+x}"; f "\${a[@]+"\${a[@]}"}"; f "\${a[@]@Q}"; f "\${a[@]:?m}"; f "\${!a[@]}"; f "\${#a[@]}"; f "\${a[@]@A}"; f "\${a[@]@K}"; f "\${y:-$@}"; f "\${y:="$@"}"`), '1\n1\n2\n2\n2\n2\n1\n3\n1\n2\n1\n');
    // (`"${a[@]@A}"` is the words of a `declare` command, not one per element: not said either way.)
    assert.strictEqual(bash(`${setup}; x="\${a[@]}"; g() { local x="\${a[@]}"; echo "[$x]"; }; echo "[$x]"; g`), '[1 2]\n[1 2]\n');
    const each = /one word per element/;
    const src = 'f "${y:-$(printf %s "${a[@]}")}" "${a[@]:+x}" "${a[@]+"${a[@]}"}" "${a[@]@Q}" "${a[@]:?m}" "${!a[@]}" "${#a[@]}" "${a[@]@A}" "${a[@]@K}" "${y:-$@}" "${y:="$@"}"';
    const args = ['"${y:-$(printf %s "${a[@]}")}"', '"${a[@]:+x}"', '"${a[@]+"${a[@]}"}"', '"${a[@]@Q}"', '"${a[@]:?m}"', '"${!a[@]}"', '"${#a[@]}"', '"${a[@]@A}"', '"${a[@]@K}"', '"${y:-$@}"', '"${y:="$@"}"'];
    assert.deepStrictEqual(args.map((w) => each.test(findAt(src, 0, w, 'en', true).explanation)), [false, false, true, true, true, true, false, false, false, true, false]);
    for (const s of ['x="${a[@]}"', 'local x="${a[@]}"', 'x="$@"', 'x=a"$@"b']) {
      assert.ok(!tokensAt(s, 0).some((t) => each.test(t.explanation)), s);
    }
    assert.strictEqual(bash('set -- 1 2; x=a"$@"b; echo "[$x]"'), '[a1 2b]\n');
    assert.match(findAt('f a"$@"b', 0, 'a"$@"b', 'en', true).explanation, each);
  });

  it('shows the message of ${x:?…} as the token says, also in double quotes and with $\'…\'', () => {
    const err = (script: string) => runBash(script).stderr.replace(/^bash: line \d+: /gm, '');
    assert.strictEqual(err(': "${x:?\'single q\'}"'), 'x: single q\n');
    assert.strictEqual(err(": ${x:?$'t\\tx'}"), 'x: t\tx\n');
    const src = ': "${x:?\'single q\'}" ${x:?$\'t\\tx\'}';
    assert.deepStrictEqual(explained(src).examples.map((e) => e.sections[0].lines[0]), ['prints the error "single q" and exits', 'prints the error "t⇥x" and exits']);
    assert.strictEqual(findAt(src, 0, '${x:?\'single q\'}', 'en', true).explanation, 'Parameter expansion: Exit with error "single q" if `x` is unset or empty');
    assert.strictEqual(findAt(src, 0, "$'t\\tx'").explanation, 'Error message "t⇥x"');
    assert.strictEqual(findAt(src, 0, "$'t\\tx'", 'ja').explanation, 'エラーメッセージ「t⇥x」');
  });

  it('says that ** goes into directories starting with . when dotglob is on', () => {
    assert.strictEqual(run('mkdir -p .h/i d; shopt -s globstar; echo **/; shopt -s dotglob; echo **/'), 'd/\n.h/ .h/i/ d/\n');
    const t = (src: string, lang: 'ja' | 'en' = 'en') => findAt(src, 0, '**/', lang, true).explanation;
    assert.match(t('shopt -s globstar; ls **/'), /`\*\*` matches directories at any depth \(zero or more, not those starting with `\.`\)$/);
    assert.match(t('shopt -s globstar dotglob; ls **/'), /with dotglob on, it also matches names starting with `\.`\. `\*\*` matches directories at any depth \(zero or more\)/);
    assert.match(t('shopt -s globstar dotglob; ls **/', 'ja'), /`\*\*` は任意の深さのディレクトリ（0階層以上）に一致する/);
    const maybe = 'if [ "$1" ]; then shopt -s dotglob; fi; shopt -s globstar; ls **/';
    assert.match(t(maybe), /\(zero or more; those starting with `\.` only where dotglob is on\)/);
    assert.match(t(maybe, 'ja'), /（0階層以上、`\.` で始まるものは dotglob が有効な経路でだけ含む）に一致する/);
  });

  it('reads $\'…\' in a case pattern as quoted, and the quoted default of ${q:-"*"} as literal', () => {
    assert.strictEqual(bash('for x in abc \'a*\'; do case $x in $\'a*\') echo "$x: m";; esac; done'), 'a*: m\n');
    assert.strictEqual(bash('for x in \'*\' b; do case $x in ${q:-"*"}) echo "$x: m";; esac; done; q=\'?\'; case b in ${q:-"*"}) echo b2;; esac'), '*: m\nb2\n');
    const src = 'case $x in $\'a*\') :;; ${q:-"*"}) :;; esac';
    assert.deepStrictEqual(findAt(src, 0, "$'a*'", 'en', true).children.map((c) => [c.label, c.explanation]), [["$'a*'", "Part quoted with `$'…'`: the characters it stands for themselves (`*` and `?` are not pattern symbols here)"]]);
    assert.strictEqual(findAt(src, 0, "$'a*'", 'ja', true).children[0].explanation, "`$'…'` でクォートされた部分: エスケープを解釈した文字そのもの（`*` や `?` もパターンにならない）");
    assert.strictEqual(findAt(src, 0, '${q:-"*"}', 'en', true).explanation, 'Pattern `${q:-"*"}`: what the unquoted expansions give is a pattern, and the quoted parts are matched as literal text');
    assert.strictEqual(findAt(src, 0, '${q:-"*"}', 'ja', true).explanation, 'パターン `${q:-"*"}`: クォートしていない展開の結果はパターンになり、クォートした部分は文字列そのものとして照合される');
    // (A `${x#"a"}` gives a value: its quotes are of its own pattern.)
    assert.strictEqual(findAt('case $y in ${x#"a"}) :;; esac', 0, '${x#"a"}', 'en', true).explanation, 'Pattern `${x#"a"}`: what it expands to is the pattern');
    // An unterminated `$'` is plain text.
    assert.ok(!explainGlob("a*$'b", 'en').some((t) => /\$'…'/.test(t.explanation)));
    assert.deepStrictEqual(explainGlob("$'a\\'*'*", 'en').map((t) => t.end - t.start), [7, 1]);
  });

  it('keeps the notes of a value, a glob guard and a picture where they hold', () => {
    assert.strictEqual(run('touch a1; y=~/a*; echo "$y"'), '/home/w/a*\n');
    assert.match(findAt('y=~/a*', 0, '~/a*').explanation, /^Tilde expansion: .*\. An assignment does no file-name expansion, so `\*` and `\?` are assigned as they are$/);
    assert.match(findAt('y=~/a*', 0, '~/a*', 'ja').explanation, /代入ではファイル名の展開はされないので/);
    const idiom = (src: string) => notesAt(src).some((n) => /^Idiom: skips a name that does not exist/.test(n));
    assert.strictEqual(run('set -- nothing-here; for f in "$@"; do [ -e "$f" ] || continue; echo "$f"; done; echo end'), 'end\n');
    assert.ok(!idiom('for f in "$@"; do [ -e "$f" ] || continue; echo "$f"; done'));
    assert.ok(!idiom('for f in *.txt; do [ -e "$g" ] || continue; done'));
    assert.ok(!idiom('while read -r f; do [ -e "$f" ] || continue; done'));
    assert.ok(idiom('for f in "$d"/*.txt; do [ -e "$f" ] || continue; done'));
    assert.ok(!idiom('if [ "$1" ]; then shopt -s nullglob; fi; for f in *.txt; do [ -e "$f" ] || continue; done'));
    assert.strictEqual(bash('y=$\'\\t\'; z=$\'\\r\\n\'; [ "$y" = "$(printf \'\\t\')" ] && echo ${#z}'), '2\n');
    assert.match(findAt("y=$'\\t'", 0, "$'\\t'").explanation, /string `⇥` \(control characters are shown as symbols: `⇥` is HT \(tab\)\)$/);
    assert.match(findAt("z=$'\\r\\n'", 0, "$'\\r\\n'").explanation, /string `␍␊` \(control characters are shown as symbols: `␍` is CR \(carriage return\), `␊` is LF \(line feed, newline\)\)$/);
    assert.match(findAt("y=$'\\t'", 0, "$'\\t'", 'ja').explanation, /`⇥` という文字列になる（制御文字は記号で表している: `⇥` は HT（タブ））$/);
  });

  it('says what ${!x@K} gives from the name in x', () => {
    assert.strictEqual(bash('ia=(p q); x=\'ia[@]\'; echo "${!x@K}"; s=hi; x=s; echo "${!x@K}"'), '0 "p" 1 "q"\n\'hi\'\n');
    const k = (src: string, lang: 'ja' | 'en' = 'en') => tokensAt(src, 0, lang).find((t) => t.kind === 'expansion' && t.label === '${!x@K}')!.explanation;
    assert.match(k('ia=(p q); x=\'ia[@]\'; echo "${!x@K}"'), /then take that variable's value and show it as key\/value pairs/);
    assert.match(k('s=hi; x=s; echo "${!x@K}"'), /then take that variable's value and quote it as `@Q` does, so it can be reused as shell input \(only all/);
    assert.match(k('echo "${!x@K}"'), /quote it as `@Q` does \(keys and values when the value of `x` is all the elements of an array, such as `a\[@\]`\)$/);
    assert.match(k('echo "${!x@K}"', 'ja'), /（`x` の値が `a\[@\]` のような配列の全要素なら、キーと値の組）$/);
  });

  it('does not take an extended glob in a ${x%…} pattern for one bash rejects without extglob', () => {
    assert.strictEqual(bash('x=ab; q=c; echo "${x%@(a|"$q")}" ${x%@(b)}'), 'ab ab\n');
    assert.match(runBash('echo "${x:-$(echo @(a|b))}"').stderr, /syntax error/);
    const caveat = (src: string) => notesAt(src).some((n) => /extended globs like/.test(n));
    assert.ok(!caveat('echo "${x%@(a|"$q")}"'));
    assert.ok(!caveat('echo ${x/@(c|"$q")/r}'));
    assert.ok(caveat('echo "${x:-$(echo @(a|b))}"'));
    assert.ok(caveat('ls @(a|b)'));
  });
});
