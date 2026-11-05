import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { binaryTestOperands, binaryTestOps, plainPatternOps, testOperandTexts } from '../src/dict/syntax';
import type { Lang } from '../src/i18n';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { type ModelRow, rowModel } from '../src/ui/panelRows';
import { runContained } from './support/contained';

// At depth 2, the condition of `[ … ]` and of `test …` has the rows the condition of `[[ … ]]` has: its operators and its operands, from the same
// tables. What differs is listed here (`SPELLED`, `DIFFER`), since it truly differs: `[` is a command, with arguments, so its right side of `=` is plain
// text and its numbers are decimal integers; what bash reads in the words comes from their number and their shape (src/testexpr.ts).

const parser = createUnbashParser();
const rowsOf = (src: string, lang: Lang = 'en', shell: 'bash' | 'sh' = 'bash'): ModelRow[] => {
  const ex = new Analyzer(lang).explainLine(parser.parse(src), src.split('\n').length - 1, shell, { reading: true });
  return rowModel(ex, { depth: 2, receives: false }, lang).rows;
};
const all = (rows: readonly ModelRow[]): ModelRow[] => rows.flatMap((r) => [r, ...all(r.children)]);
const more = (r: ModelRow): string[] => r.more.map((m) => m.map((p) => p.text).join(''));

/** A row under the condition, as the test compares it. A row of the tokens keeps its own text, which depth 1 says and this PR leaves alone. */
interface Shape { label: string; kind: string; text?: string; more: string[]; folded: boolean; children: Shape[] }
const shape = (r: ModelRow): Shape => ({
  label: r.label, kind: r.kind, ...(r.comesAt === 2 ? { text: r.text } : {}), more: more(r), folded: !!r.folded, children: r.children.map(shape),
});
/** The rows under the command or the compound command, but its `]`, `[[` and `]]`. */
const condition = (src: string, lang: Lang): Shape[] => {
  const [top] = rowsOf(src, lang);
  assert.ok(top, src);
  return top.children.filter((r) => !['[[', ']]'].includes(r.label) && !(r.label === ']' && src.startsWith('['))).map(shape);
};

/** Conditions, as `[` and `test` take them, and as `[[ ]]` writes them. */
const CONDITIONS: readonly (readonly [string, string?])[] = [
  ['-a file'], ['-e file'], ['-f x'], ['-d x'], ['-s x'], ['-z x'], ['-n x'], ['-v x'], ['-o noclobber'], ['-t 0'], ['-f "$x"'],
  ['"$x" = y'], ['"$x" != y'], ['a = b'], ['a == b'], ['a != b'], ['"a b" = c'], ['a = "b c"'],
  ['a \\< b', 'a < b'], ['a \\> b', 'a > b'], ['1 -eq 2'], ['1 -lt 2'], ['a -nt b'], ['a -ef b'],
  ['! -f x'], ['! a = b'], ['a'], ['! a'], ['"$x"'],
  ['a = b -a c = d', 'a = b && c = d'], ['a = b -o c = d', 'a = b || c = d'], ['-f x -a -d y', '-f x && -d y'], ['-f x -o -d y', '-f x || -d y'],
  ['\\( a = b \\)', '( a = b )'], ['\\( -f x \\)', '( -f x )'], ['! \\( a = b \\)', '! ( a = b )'], ['\\( a = b \\) -a -f x', '( a = b ) && -f x'],
];

/** Spelled otherwise: `\(` and `\<` are escaped, as the shell would read them itself; `&&` and `||` are `-a` and `-o`. */
const SPELLED: Readonly<Record<string, string>> = { '\\(': '(', '\\)': ')', '\\<': '<', '\\>': '>', '-a': '&&', '-o': '||' };

/** The texts that truly differ, as `[[ ]]` says them and as `[` says them. */
const DIFFER = (lang: Lang): Map<string, string> => new Map<string, string>([
  // (On the right of `=`, `[[ ]]` has a pattern, `[` plain text; so has the operator.)
  ...['=', '==', '!='].flatMap((op): [string, string][] => [
    [plainPatternOps.operator[op][lang], binaryTestOps[op][lang]],
    [testOperandTexts.plain[lang].replace('{op}', op), testOperandTexts.right[lang].replace('{op}', op)],
    [testOperandTexts.pattern[lang].replace('{op}', op), testOperandTexts.right[lang].replace('{op}', op)],
  ]),
  // (`[[ ]]` evaluates arithmetic; `[` reads decimal integers.)
  ...Object.keys(binaryTestOperands).filter((op) => binaryTestOperands[op] === 'number').map((op): [string, string] => [testOperandTexts.number[lang].replace('{op}', op), testOperandTexts.integer[lang].replace('{op}', op)]),
  // (`-a` and `-o` are older than `&&` and `||`.)
  [binaryTestOps['&&'][lang], binaryTestOps['-a'][lang]], [binaryTestOps['||'][lang], binaryTestOps['-o'][lang]],
]);

describe('the rows of the condition of `[` and `test`, as `[[ ]]` has them', () => {
  for (const lang of ['en', 'ja'] as const) {
    it(`has the same rows under the condition for \`[ … ]\`, \`test …\` and \`[[ … ]]\`, apart from what the test lists, ${lang}`, () => {
      const differ = DIFFER(lang);
      const spelled = (s: Shape): Shape => ({ ...s, label: s.label.split(' ').map((w) => SPELLED[w] ?? w).join(' '), children: s.children.map(spelled) });
      const asBracket = (s: Shape): Shape => ({ ...s, ...(s.text ? { text: differ.get(s.text) ?? s.text } : {}), more: s.more.map((m) => differ.get(m) ?? m), children: s.children.map(asBracket) });
      for (const [written, double] of CONDITIONS) {
        const bracket = condition(`[ ${written} ]`, lang);
        assert.ok(bracket.length, written);
        assert.deepStrictEqual(condition(`test ${written}`, lang), bracket, `test ${written}`);
        // (`-a` as a unary operator is `-a` in both, spelled the same way here.)
        assert.deepStrictEqual(bracket.map(spelled), condition(`[[ ${double ?? written} ]]`, lang).map(asBracket).map(spelled), written);
      }
    });
  }

  it('gives `-a` and `file` of `[ -a file ]` and `test -a file` rows under the condition, which start folded', () => {
    for (const src of ['[ -a file ]', 'test -a file']) {
      const row = all(rowsOf(src)).find((r) => r.label === '-a file')!;
      assert.strictEqual(row.folded, true, src);
      assert.deepStrictEqual(row.children.map((r) => [r.label, r.kind, r.text, r.comesAt]), [
        ['-a', 'operator', 'exists (same as `-e`, obsolescent)', 2],
        ['file', 'argument', 'The file `-a` tests', 2],
      ], src);
    }
  });

  it('says nothing of a pattern for `[` and `test`, and `]` stays an argument, no operator', () => {
    for (const lang of ['en', 'ja'] as const) {
      const said = (s: Shape): string[] => [s.text ?? '', ...s.more, ...s.children.flatMap(said)];
      const pattern = [testOperandTexts.pattern[lang].replace('{op}', '='), testOperandTexts.plain[lang].replace('{op}', '='), plainPatternOps.operator['='][lang]];
      for (const [written] of CONDITIONS) {
        for (const src of [`[ ${written} ]`, `test ${written}`]) for (const s of condition(src, lang).flatMap(said)) assert.ok(!pattern.includes(s), `${src}: ${s}`);
      }
    }
    const close = rowsOf('[ a = b ]')[0].children.find((r) => r.label === ']')!;
    assert.strictEqual(close.kind, 'argument');
    assert.match(close.text, /^The last argument/);
  });

  it('gives a word that may give no field or several no operand row, and no text of an operand', () => {
    // The shape is known only when it runs: `[ -f $x ]` with `x` empty is `[ -f ]`, a word that is not empty (checked with bash below).
    const operands = [testOperandTexts.file.en.replace('{op}', '-f'), testOperandTexts.compared.en.replace('{op}', '=')];
    for (const word of ['$x', '"$@"', '"${a[@]}"', '"x${a[@]}"', '$(c)', '${x:-a}', 'a*', '"a"*', '{a,b}', '$x$y']) {
      for (const src of [`[ -f ${word} ]`, `[ ${word} = y ]`, `test -f ${word}`]) {
        const said = all(rowsOf(src)).flatMap((r) => [r.text, ...more(r)]);
        assert.ok(!operands.some((o) => said.includes(o)), `${src}: ${said.join(' | ')}`);
        // (Its operator keeps its row, as the condition that names it says.)
        assert.ok(all(rowsOf(src)).some((r) => r.label === '-f' || r.label === '='), src);
      }
    }
    // Under a nameref (it may name an array) or with `nullglob`.
    for (const [before, word] of [["declare -n r='a[@]'", '"$r"'], ['shopt -s nullglob', 'a*'], ['IFS=', '$x']]) {
      const said = all(rowsOf(`${before}\n[ -f ${word} ]`)).flatMap((r) => [r.text, ...more(r)]);
      assert.ok(!said.includes(operands[0]), `${before}: ${said.join(' | ')}`);
    }
    // A word quoted whole is one field, a tilde too: the operand is said, on the row of its token.
    for (const word of ['"$x"', '"${x:-a}"', '"$(c)"', '~', "'a*'", '"$*"']) {
      const row = all(rowsOf(`[ -f ${word} ]`)).find((r) => r.label === word)!;
      assert.ok([row.text, ...more(row)].includes(operands[0]), word);
    }
  });

  it('reads the words by their number, as bash: no operator rows where bash takes a word or fails', () => {
    for (const written of ['a', '-f', '!', '=', '-a', '\\(', 'a b', 'a -a', '-q x', 'a b c']) {
      const under = rowsOf(`[ ${written} ]`)[0].children.filter((r) => r.label !== ']');
      assert.deepStrictEqual(under.map((r) => r.kind), written.split(' ').map(() => 'argument'), written);
      assert.ok(under.every((r) => !r.children.length), written);
    }
    // `-a` by its place: unary, then binary, then a word.
    const operators = (written: string) => all(rowsOf(`[ ${written} ]`)).filter((r) => r.kind === 'operator').map((r) => [r.label, r.text]);
    assert.deepStrictEqual(operators('-a f'), [['-a', 'exists (same as `-e`, obsolescent)']]);
    assert.deepStrictEqual(operators('f -a g'), [['-a', 'both are true (AND, obsolescent)']]);
    assert.deepStrictEqual(operators('-a -a -a'), [['-a', 'both are true (AND, obsolescent)']]);
    assert.deepStrictEqual(operators('-a = -a'), [['=', 'strings are equal (the right side is plain text, not a pattern)']]);
    assert.deepStrictEqual(operators('-o f'), [['-o', 'is an enabled shell option']]);
    assert.deepStrictEqual(operators('f -o g'), [['-o', 'either is true (OR, obsolescent)']]);
  });

  it('has them wherever the words run `test` or `[`, and not for a function of that name', () => {
    const under = (src: string, label: string) => all(rowsOf(src)).find((r) => r.label === label)!.children.map((r) => [r.label, r.kind, r.text]);
    const file = [['-f', 'operator', 'is an existing regular file'], ['a', 'argument', 'The file `-f` tests']];
    for (const src of ['env [ -f a ]', 'command test -f a', 'builtin [ -f a ]', '/usr/bin/[ -f a ]', '/usr/bin/test -f a', 'sudo test -f a', 'enable -n [\n[ -f a ]', 'nohup test -f a', 'if [ -f a ]; then :; fi', 'x=$([ -f a ])', 'bash -c \'[ -f a ]\'', 'eval "test -f a"']) {
      assert.deepStrictEqual(under(src, '-f a'), file, src);
    }
    assert.strictEqual(all(rowsOf('[ -f a ]', 'en', 'sh')).find((r) => r.label === '-f a')!.children.length, 2);
    // A function of that name reads its words itself; so does `[` with an alias's words that are not known.
    const words = all(rowsOf('[() { :; }\n[ -f a ]')).filter((r) => r.label === '-f' || r.label === 'a').map((r) => r.kind);
    assert.deepStrictEqual(words, ['option', 'argument']);
    // Another program has no `<`: its row says so, as its condition does.
    assert.match(all(rowsOf('/usr/bin/[ a \\< b ]')).find((r) => r.label === '\\<')!.text, /coreutils/);
    assert.deepStrictEqual(all(rowsOf('[ a \\< b ]')).find((r) => r.label === '\\<')!.text, binaryTestOps['<'].en);
  });

  it('leaves the rows of depth 1, and an explanation without the reading tree has no parts', () => {
    const ex = new Analyzer('en').explainLine(parser.parse('[ -a file ]'), 0, 'bash');
    assert.ok(!JSON.stringify(ex).includes('testParts'));
    const one = rowModel(new Analyzer('en').explainLine(parser.parse('[ ! -f x ]'), 0, 'bash', { reading: true }), { depth: 1, receives: false }, 'en');
    assert.deepStrictEqual(all(one.rows).map((r) => r.label), ['[', '! -f x', '-f x', ']']);
  });

  // An evaluator of the rows: what they say the test is, compared with what bash does on the same words.
  describe('against bash', () => {
    let dir = '';
    before(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'condition-rows-'));
      fs.writeFileSync(path.join(dir, 'file'), 'x');
      fs.mkdirSync(path.join(dir, 'd'));
    });
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const VARIABLES: Readonly<Record<string, string>> = { '"$x"': 'v', '"$e"': '' };
    const value = (label: string): string => VARIABLES[label] ?? label.replace(/^(['"])(.*)\1$/, '$2').replace(/\\(.)/g, '$1');
    const exists = (p: string) => fs.existsSync(path.join(dir, p));
    const UNARY: Readonly<Record<string, (w: string) => boolean>> = {
      '-a': exists, '-e': exists,
      '-f': (w) => exists(w) && fs.statSync(path.join(dir, w)).isFile(),
      '-d': (w) => exists(w) && fs.statSync(path.join(dir, w)).isDirectory(),
      '-z': (w) => w === '', '-n': (w) => w !== '', '-o': () => false, '-t': () => false, '-v': (w) => w === 'x',
    };
    const BINARY: Readonly<Record<string, (l: string, r: string) => boolean>> = {
      '=': (l, r) => l === r, '==': (l, r) => l === r, '!=': (l, r) => l !== r, '\\<': (l, r) => l < r, '\\>': (l, r) => l > r,
      '-eq': (l, r) => Number(l) === Number(r), '-ne': (l, r) => Number(l) !== Number(r), '-lt': (l, r) => Number(l) < Number(r), '-ef': (l, r) => exists(l) && l === r,
    };
    /** Whether the condition of this row is true, from its rows only: `kind`, and the words under it. */
    const truth = (r: ModelRow): boolean => {
      const under = r.children;
      if (r.kind !== 'test' && r.kind !== 'operator') return value(r.label) !== '';
      if (under[0].label === '\\(') return truth(under[1]);
      if (under[0].kind === 'operator' && under[0].label === '!') return !truth(under[1]);
      if (under.length === 2) return UNARY[under[0].label](value(under[1].label));
      if (under[1].label === '-a') return truth(under[0]) && truth(under[2]);
      if (under[1].label === '-o') return truth(under[0]) || truth(under[2]);
      return BINARY[under[1].label](value(under[0].label), value(under[2].label));
    };
    /** The status the rows give: words that make no one condition are an error of bash. */
    const statusOfRows = (src: string): number => {
      const under = rowsOf(src).flatMap((r) => r.children).filter((r) => r.label !== ']');
      return under.length !== 1 ? 2 : truth(under[0]) ? 0 : 1;
    };

    const WORDS = [
      'a', '""', '-f', '-a', '-o', '!', '=', '\\(', '-t', 'a b', 'a -a', '-q x', 'a b c',
      '-f file', '-f d', '-f nofile', '-d d', '-a file', '-a nofile', '-e d', '-o noclobber', '-v x', '-v nox', '-n "$e"', '-z "$e"', '-t 0', '-f "$x"',
      'file -a nofile', 'file -o nofile', '-a file -a -d d', '-a nofile -o -d d', '-a -a -a', '-o -o -o', '-a = -a', '-f = -f', '! = x', '! -a file', '! -a nofile', '! a', '! ""', '! ! a',
      'a = a', 'a = b', 'a != b', 'a == a', 'abc = "a*"', '"a*" = abc', '"$x" = v', '"$x" != v', '"$e"', '"$x"', 'a \\< b', 'b \\< a', 'a \\> b',
      '010 -eq 10', '010 -eq 8', '1 -lt 2', '2 -lt 1', 'file -ef file',
      '\\( a = b \\)', '\\( a = a \\)', '! \\( a = b \\)', '\\( -f file \\)', '\\( a = a \\) -a -f file', '\\( a = b \\) -o -f file', 'a = a -a c = d -o e = e', 'a = b -o c = c -a d = d',
    ];

    it('has the rows say what bash does, for `[` and `test`, on a table run in one process', async function () {
      this.timeout(60000);
      const lines = WORDS.flatMap((w) => [`[ ${w} ]`, `test ${w}`]);
      const script = `exec </dev/null\nx=v\ne=\n${lines.map((l) => `${l} 2>/dev/null; echo $?`).join('\n')}\n`;
      const run = await runContained(['bash', '--norc', '--noprofile', '-c', script], dir, {}, 60000);
      assert.strictEqual(run.status, 0, run.stderr);
      const got = run.stdout.trim().split('\n').map(Number);
      assert.strictEqual(got.length, lines.length);
      const wrong = lines.flatMap((l, i) => (statusOfRows(l) === got[i] ? [] : [`${l}: rows ${statusOfRows(l)}, bash ${got[i]}`]));
      assert.deepStrictEqual(wrong, []);
    });

    it('is right not to say what a word that may split is: its shape changes what bash reads', async () => {
      const script = 'x=; [ -f $x ]; echo $?; x="a b"; [ -f $x ] 2>/dev/null; echo $?; x=file; [ -f $x ]; echo $?; [ -f "" ]; echo $?\n';
      const run = await runContained(['bash', '--norc', '--noprofile', '-c', script], dir, {}, 20000);
      assert.strictEqual(run.stdout, '0\n2\n0\n1\n');
    });

    it('reads a number as a decimal integer, as the row says', async () => {
      const run = await runContained(['bash', '--norc', '--noprofile', '-c', '[ 010 -eq 10 ]; echo $?; [ 1+1 -eq 2 ] 2>/dev/null; echo $?; [[ 010 -eq 8 ]]; echo $?\n'], dir, {}, 20000);
      assert.strictEqual(run.stdout, '0\n2\n0\n');
    });
  });
});
