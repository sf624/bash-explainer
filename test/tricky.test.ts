import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { descendants, field, hasError } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { arithLiteral, intValue } from '../src/arith';
import { ansiCValue, staticWordValue } from '../src/staticword';
import { exampleFor, parseExpansion } from '../src/expansion';
import { createTreeSitterParser } from '../src/syntax/adapters/tree-sitter';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = await createTreeSitterParser({
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
