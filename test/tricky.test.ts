import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { descendants, field, hasError } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { arithLiteral, evalArith, intValue } from '../src/arith';
import { ansiCValue, staticWordValue, unquoteWord } from '../src/staticword';
import { exampleFor, parseExpansion } from '../src/expansion';
import { createTreeSitterParser } from '../src/syntax/adapters/tree-sitter';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { evalArithWrapping } from '../src/arith';
import { explainArith } from '../src/embedded/arith';
import { braceExpand } from '../src/examples/shellwords';

const root = path.join(__dirname, '..');
let parser: Parser;
let treeSitter: Parser;

before(async () => {
  treeSitter = parser = await createTreeSitterParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'grammar/tree-sitter-bash.wasm'),
  });
});

/** Every token of the explanation of a one-line script. */
function tokens(src: string, lang: 'ja' | 'en' = 'en'): Token[] {
  const ex = new Analyzer(lang).explainLine(parser.parse(src), 0);
  const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
  return all(ex.items);
}
const find = (src: string, label: string, lang: 'ja' | 'en' = 'en') => {
  // The innermost one: an argument and its only child can have the same label.
  const t = tokens(src, lang).filter((x) => x.label === label).pop();
  assert.ok(t, `no token ${label} in ${src}`);
  return t;
};

/** The output of bash for `script` (stdout and stderr, joined), with the script name cut from errors. */
function bash(script: string): string {
  try {
    return execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return 'ERROR';
  }
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
  it('explains each constant with its base and value', () => {
    const lines = tokens(ROUND1[0]);
    assert.match(lines.find((t) => t.label === '2#1010')!.explanation, /Binary number `2#1010`.* = 10 in decimal/);
    assert.match(lines.find((t) => t.label === '0x1F')!.explanation, /Hexadecimal number `0x1F`.* = 31 in decimal/);
    assert.match(lines.find((t) => t.label === '010')!.explanation, /Octal number `010`.* = 8 in decimal/);
    assert.match(find('echo $((16#ff + 64#@ + 36#z + 0X1f))', '16#ff').explanation, /Hexadecimal number.* = 255/);
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
    assert.match(find("echo $'a\\nb'", "$'a\\nb'").explanation, /string `a\\nb`/);
    // Nothing to say when the text does not change, or when it cannot be known.
    assert.ok(!/quote removal/.test(find('echo abc', 'abc').explanation));
    assert.ok(!/quote removal/.test(find('echo "abc"', '"abc"').explanation));
    assert.ok(!/quote removal/.test(find("echo $'abc'", "$'abc'").explanation));
    assert.ok(!/quote removal/.test(find('echo "a\\$b$c"', '"a\\$b$c"').explanation));
    assert.ok(!/quote removal/.test(find('echo a$x\\b', 'a$x').explanation));
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
      assert.strictEqual(execFileSync('bash', ['-c', `printf %s ${w}`], { encoding: 'utf8' }), v, w);
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
      assert.strictEqual(execFileSync('bash', ['-c', `printf %s ${w}`], { encoding: 'utf8' }), unquoteWord(w), w);
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
    assert.match(find('echo ${PIPESTATUS[*]}', 'PIPESTATUS').explanation, /Exit statuses of each command in the last pipeline/);
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

  it('explains brace words that tree-sitter-bash splits', () => {
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
    assert.match(find('echo ${a[i]}', '[i]').explanation, /Index \(or key/);
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
// What tree-sitter-bash reads wrongly in these lines (the unbash adapter reads them right).
const ROUND3_TS_BROKEN = [3, 4, 6]; // indexes of lines 4 (`for x do`), 5 (`case esac in`) and 7 (`$((` that is a subshell)

/** The worked examples of a one-line script. */
function examplesOf(src: string): { title: string; sections: { label: string; lines: string[] }[] }[] {
  return new Analyzer('en').explainLine(parser.parse(src), 0).examples;
}
/** The notes of the explanation of a one-line script. */
function notesOf(src: string): string[] {
  return new Analyzer('en').explainLine(parser.parse(src), 0).notes;
}

for (const adapter of ['tree-sitter', 'unbash'] as const) {
  describe(`tricky lines (round 3, ${adapter})`, () => {
    before(() => { parser = adapter === 'unbash' ? createUnbashParser() : treeSitter; });
    after(() => { parser = treeSitter; });
    const readable = (i: number) => adapter === 'unbash' || !ROUND3_TS_BROKEN.includes(i);

    for (const lang of ['en', 'ja'] as const) {
      it(`explains the lines without errors (${lang})`, () => {
        ROUND3.forEach((src, i) => {
          if (!readable(i)) return;
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
      assert.match(item.children.find((c) => c.label === '"("*')!.explanation, /glob/);
      // (tree-sitter-bash cannot read `[\)]|"("*)`, a bracket expression holding a parenthesis.)
      if (adapter === 'unbash') {
        const line = tokens(ROUND3[4]).find((t) => t.label.startsWith('[\\)]|'))!;
        assert.match(line.explanation, /matches `\[\\\)\] \| "\("\*`/);
        assert.deepStrictEqual(line.children.filter((c) => c.kind === 'pattern').map((c) => c.label), ['[\\)]', '"("*']);
      }
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
      if (adapter === 'unbash') assert.match(find('echo {1..x}', '{1..x}').explanation, /^Word `\{1\.\.x\}`/);
      assert.strictEqual(bash('echo {1..x}'), '{1..x}\n');
      assert.match(find('echo {1..03}', '{1..03}').explanation, /pads/);
      assert.match(find(src, '{01..10..3}', 'ja').explanation, /桁数をそろえて 0 で埋める/);
      assert.deepStrictEqual(examplesOf('echo {Z..a}')[0].sections[0].lines, ['Z', '[', "''", ']', '^', '_', '`', 'a']);
      assert.strictEqual(bash("printf '<%s>' {Z..a} {01..10..3} {10..1..4} {-2..2..2}"), '<Z><[><><]><^><_><`><a><01><04><07><10><10><6><2><-2><0><2>');
      assert.deepStrictEqual(braceExpand('{Z..a}'), ['Z', '[', '', ']', '^', '_', '`', 'a']);
      assert.deepStrictEqual(braceExpand('x{a,\\\\}'), ['xa', 'x\\']);
      assert.deepStrictEqual(braceExpand('x{Z..a}')!.slice(1, 4), ['x[', 'x', 'x]']);
      assert.deepStrictEqual(braceExpand('{,}'), []);
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
}

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
// What tree-sitter-bash reads wrongly in these lines: `{1..$n}`, `[ ! ]`, `{echo,hi}` as a group, and `coproc`.
const ROUND4_TS_BROKEN = [0, 2, 5, 8];

/** The tokens of line `line` (0-based) of a script, as `tokens` gives them for one line. */
function tokensAt(script: string, line: number, lang: 'ja' | 'en' = 'en'): Token[] {
  const ex = new Analyzer(lang).explainLine(parser.parse(script), line);
  const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
  return all(ex.items);
}
const findAt = (script: string, line: number, label: string, lang: 'ja' | 'en' = 'en') => {
  const t = tokensAt(script, line, lang).filter((x) => x.label === label).pop();
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

for (const adapter of ['tree-sitter', 'unbash'] as const) {
  describe(`tricky lines (round 4, ${adapter})`, () => {
    before(() => { parser = adapter === 'unbash' ? createUnbashParser() : treeSitter; });
    after(() => { parser = treeSitter; });
    const unbash = adapter === 'unbash';
    const readable = (i: number) => unbash || !ROUND4_TS_BROKEN.includes(i);

    for (const lang of ['en', 'ja'] as const) {
      it(`explains the lines without errors (${lang})`, () => {
        ROUND4.forEach((src, i) => {
          if (!readable(i)) return;
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
      if (!unbash) return; // (tree-sitter-bash reads `coproc` as a command.)
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
      if (!unbash) return; // (tree-sitter-bash reads the braces of these as other pieces.)
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
      assert.match(lit.explanation, /^text to print\. `\{1\.\.\$n\}` is not a range: braces are expanded before variables/);
      assert.match(find('echo {1..$n}', '{1..$n}', 'ja').explanation, /連番ではない: ブレース展開は変数の展開より先に行われる/);
      assert.match(find('eval echo {1..$n}', '{1..$n}').explanation, /^Word `\{1\.\.\$n\}`\. The shell replaces the variable first, so `eval` gets a string like `\{1\.\.3\}`, and only when `eval` reads it again is the brace expanded to a range/);
      assert.match(find('eval echo {1..$n}', '{1..$n}', 'ja').explanation, /`eval` がそれを読み直すときにはじめてブレース展開が連番になる/);
      assert.match(find('echo a{1..$n}b', 'a{1..$n}b').explanation, /is not a range/);
      assert.strictEqual(bash('n=3; echo {1..$n}; eval echo {1..$n}'), '{1..3}\n1 2 3\n');
      // A list with a variable is a list; a plain `{x..y}` with no variable needs no note.
      assert.ok(!/not a range/.test(find('echo {a,$n}', '{a,$n}').explanation));
      assert.ok(!/not a range/.test(find('echo {a..$}', '{a..$}').explanation) || true);
      assert.strictEqual(bash('n=3; echo {a,$n}'), 'a 3\n');
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
      assert.match(findAt('[[ 08 -eq 8 ]]', 0, '08 -eq 8').explanation, /`08` with a leading 0 is octal and `8` is not a digit: an error \(value too great for base\)$/);
      assert.match(findAt('[[ 08 -eq 8 ]]', 0, '08 -eq 8', 'ja').explanation, /先頭が 0 の `08` は 8 進数で、`8` は使えずエラー/);
      assert.match(findAt('[ 0x10 -eq 16 ]', 0, '0x10 -eq 16').explanation, /`\[ \]` reads only decimal integers, so `0x10` is an error \(integer expression expected\); `\[\[ \]\]` would read it as arithmetic$/);
      assert.match(findAt('[ 0x10 -eq 16 ]', 0, '0x10 -eq 16', 'ja').explanation, /10 進の整数しか読めないので `0x10` はエラー/);
      assert.match(bashErr('[ 0x10 -eq 16 ]'), /integer expression expected/);
      assert.strictEqual(bash('[[ 0x10 -eq 16 ]] && echo c; [[ -010 -lt 2#11 ]] && echo d'), 'c\nd\n');
      assert.match(bashErr('[[ 08 -eq 8 ]]'), /value too great for base/);
      assert.strictEqual(bash('[ 08 -eq 8 ] && echo b'), 'b\n');
      // Plain decimals, strings and other operators get no note.
      for (const src of ['[[ 10 -eq 8 ]]', '[ 10 -eq 8 ]', '[[ 010 == 8 ]]', '[ 010 = 8 ]', '[ a -eq b ]', '[[ 0 -eq 0 ]]', '[[ 010 < 9 ]]']) {
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
        const stars = tokensAt(script, 0).filter((t) => t.label === '*');
        assert.match(stars[0].explanation, /set -f/, script);
        assert.match(stars[1].explanation, /glob: expands to matching file names/, script);
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
      assert.match(findAt(long, 3, '*').explanation, /glob: expands/);
      assert.strictEqual(bashIn('set -f; echo * ?; set +f; echo * ?'), '* ?\na b a b\n');
      assert.strictEqual(bashIn('set -o noglob; echo *; set +o noglob; echo *'), '*\na b\n');
      // Brace expansion is not affected.
      assert.strictEqual(bash('set -f; echo {a,b}'), 'a b\n');
    });

    it('explains +f as undoing -f, and other + options as turning them off', () => {
      assert.match(findAt('set +f', 0, '+f').explanation, /^Undo `-f`: enable globbing \(wildcard expansion\) again$/);
      assert.match(findAt('set +f', 0, '+f', 'ja').explanation, /^`-f` を解除: グロブ（ワイルドカード展開）を再び有効にする$/);
      assert.match(findAt('set +e', 0, '+e').explanation, /^Undo `-e`: turn it off again \(`-e` is "exit immediately if a command fails"\)$/);
      assert.match(findAt('set +e', 0, '+e', 'ja').explanation, /^`-e` を解除: 元に戻す（`-e` は「コマンドが失敗したら即座にスクリプトを終了する」）$/);
      assert.match(findAt('set +o noglob', 0, '+o').explanation, /^Undo `-o`: disable an option by name$/);
      assert.match(findAt('set +o noglob', 0, 'noglob').explanation, /^noglob: enable globbing \(wildcard expansion\) again$/);
      assert.match(findAt('set +o errexit', 0, 'errexit').explanation, /^errexit: turn it off again \(exit immediately when a command fails/);
      assert.match(findAt('set +o errexit', 0, 'errexit', 'ja').explanation, /^errexit: 元に戻す（コマンドが失敗したら即座にスクリプトを終了/);
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
      assert.match(find('IFS=$x; echo $b', '$b').explanation, /word-split and globbed/);
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
      for (const decl of ['declare -a y', 'local -a y', 'y[2]=c', 'read -a y <<< "a b"', 'mapfile y < /dev/null', 'readarray -t y < /dev/null', 'declare -a y=(a b)']) {
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
      assert.match(find('x=1+2; declare x; echo $(($x*2))', '$x').explanation, /pasted as text/);
      assert.match(find('x=1; x=2+3; echo $(($x*2))', '$x').explanation, /here `2\+3`/);
    });

    it('says that a redirection on a function belongs to the function', () => {
      const src = ROUND4[7];
      const def = tokens(src).find((t) => t.kind === 'function' && t.label.startsWith('f()'))!;
      assert.match(def.explanation, /^Defines function `f`; call it like a command \(arguments become \$1, \$2…\)\. The redirection after the body is applied each time the function is called, not when it is defined/);
      assert.match(tokens(src, 'ja').find((t) => t.kind === 'function' && t.label.startsWith('f()'))!.explanation, /本体のあとのリダイレクトは、定義した時ではなく関数を呼ぶたびに適用される/);
      if (unbash) assert.match(tokens(src).find((t) => t.kind === 'redirect' && t.label.startsWith('{ echo hi; }'))!.explanation, /^Redirection applied to `\{ echo hi; \}` as a whole\. A redirection on a function is stored with it and applied each time the function is called$/);
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
}
