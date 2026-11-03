import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { pipedOutput } from '../src/examples/pipeline';
import { regexExamples } from '../src/examples/regex';
import { guarded, RegexRefused, scriptRegex, walked } from '../src/examples/regexguard';
import { rerun } from '../src/examples/rerun';
import { globToRegex } from '../src/examples/shellwords';
import { fact } from '../src/messages';
import { patternMatches } from '../src/semantics/conditions';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { run } from './support/run';
import { ADVERSARIAL, GLOBS, LINES, MANY, MUST_RUN, P, type Row, SHORT, SPECS, TOOLS } from './support/regexguard-table';

/** Whether one run of `source` on `text` is refused. */
function refused(source: string, text: string, flags = ''): boolean {
  try {
    scriptRegex(source, flags).test(text);
    return false;
  } catch (e) {
    if (e instanceof RegexRefused) return true;
    throw e;
  }
}
const NOTE = { en: fact('en', 'regex-not-computed').text, ja: fact('ja', 'regex-not-computed').text };
const BODY = { en: fact('en', 'regex-not-computed').body, ja: fact('ja', 'regex-not-computed').body };
const lines = (out: Buffer) => out.toString().split('\n').slice(0, -1);

describe('the guard of the regexes a script gives', () => {
  describe('what runs in a process of its own', function () {
    // (A guard that lets a pattern through ends here by this timeout, not in a run that never ends. It takes 15 s; with
    // coverage, whose counters slow the walk ten times, over two minutes: so it is measured by the tests below.)
    this.timeout(180000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let out: any;
    before(() => {
      const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(__dirname, 'support/regexguard-table.ts'), 'run'], { timeout: 150000, maxBuffer: 1 << 28, env: { ...process.env, NODE_V8_COVERAGE: '' } });
      assert.strictEqual(r.status, 0, `${r.signal ?? ''} ${r.stderr}`);
      out = JSON.parse(r.stdout.toString());
    });

    it('every pattern that would take too long is refused', () => {
      const missed = P.mustRefuse.filter((_, i) => out.refuse[i] !== 'refused').map(([source]) => source);
      assert.deepStrictEqual(missed, []);
      assert.strictEqual(out.many, 'refused');
      assert.deepStrictEqual(out.choices, ['refused', 'refused', 'refused', 'refused']);
    });

    it('a tool that reads the text says it is not computed, and the rest of the line is explained', () => {
      const rows: Row[] = out.rows;
      assert.ok(Object.keys(GLOBS).every((g) => rows.some((x) => x.tool === g)) && Object.keys(TOOLS).every((t) => rows.some((x) => x.tool === t)));
      // (yq with JSON text shows no example of it, `find` reads no text here, `=~` does not read a value this long, and on
      // it `(a?){30}a{30}` matches at once.)
      const read = rows.filter((x) => !x.tool.includes('alone') && !['yq test', 'find -regex'].includes(x.tool) && !(x.length > 100 && (x.tool === '=~' || x.pattern === '(a?){30}a{30}')) && ADVERSARIAL.includes(x.pattern));
      assert.ok(read.length > 100);
      assert.deepStrictEqual(read.filter((x) => !x.said).map((x) => x.line.slice(0, 80)), []);
      assert.ok(read.every((x) => x.tokens > 0));
      assert.deepStrictEqual(rows.filter((x) => x.tool === 'review' && !x.said).map((x) => x.line), []);
    });

    it('says no result where it says so: no section but what the line reads', () => {
      assert.deepStrictEqual((out.rows as Row[]).filter((x) => x.said && x.claims.length).map((x) => [x.line.slice(0, 80), x.claims]), []);
    });

    it('says so in Japanese too', () => {
      assert.ok((out.rows as Row[]).some((x) => x.lang === 'ja' && x.said));
    });

    it('a pipeline: one example, with the note and no result, and nothing of the stages after it', () => {
      assert.deepStrictEqual(out.checks['pipeline en'], [{ kind: 'pipeline', note: NOTE.en, sections: 0 }]);
      assert.deepStrictEqual(out.checks['pipeline ja'], [{ kind: 'pipeline', note: NOTE.ja, sections: 0 }]);
      assert.strictEqual(out.checks['no next stage'], 'none');
    });

    it('the line still has its tokens, and the pipeline its stages', () => {
      assert.deepStrictEqual(out.checks['the tokens stay'], [true, true]);
    });

    it('a command alone, with text it reads', () => {
      assert.strictEqual(out.checks['here-string'], true);
    });

    it('[[ =~ ]] and [[ == ]], with the value of the left side', () => {
      assert.deepStrictEqual(out.checks['=~'], [{ kind: 'regex', note: NOTE.en, sections: 0 }]);
      assert.deepStrictEqual(out.checks['[[ == ]]'], [{ kind: 'glob', note: NOTE.en, sections: 0 }]);
    });

    it('a parameter expansion with a value of the script: the value is not made up', () => {
      assert.strictEqual(out.checks.expansion, false);
    });

    it('whether a pattern matches is not known when it is not run', () => {
      assert.strictEqual(out.checks['matches of a glob'], 'none');
    });

    it('a short text runs, on a pattern that doubles', () => {
      assert.deepStrictEqual(out.checks['two lines with the same pattern, the first run'], ['aaa']);
      assert.deepStrictEqual(out.rerunShort, ['aaa']);
    });

    it('what generating lines of a pattern would take too long for is said too', () => {
      assert.deepStrictEqual(out.checks['too many rounds alone'].map((x: { note?: string }) => x.note), [NOTE.en]);
      assert.deepStrictEqual(out.checks['generator over its steps'].map((x: { note?: string }) => x.note), [NOTE.en]);
    });

    for (const name of Object.keys(SPECS)) {
      it(`the panel, ${name}: a long text is not computed, in both languages`, () => {
        assert.deepStrictEqual(out.rerun[name].en, [{ label: 'Result', lines: [BODY.en] }]);
        assert.deepStrictEqual(out.rerun[name].ja, [{ label: '結果', lines: [BODY.ja] }]);
      });
    }

    describe('patterns of everyday use run, and agree with the real tools', () => {
      MUST_RUN.forEach((p, i) => {
        it(`grep -E '${p}'`, () => {
          assert.deepStrictEqual(out.grep[i], lines(run('grep', ['-E', p], { input: LINES.join('\n') + '\n' }).stdout));
        });
        it(`sed -E 's~${p}~X~'`, () => {
          assert.deepStrictEqual(out.sed[i], lines(run('sed', ['-E', `s~${p}~X~`], { input: LINES.join('\n') + '\n' }).stdout));
        });
        // (`\<`, `\b` and a back-reference are gawk's own in part, or not gawk's: left out.)
        if (!/\\[1<b]/.test(p)) {
          it(`gawk '/${p}/'`, () => {
            assert.deepStrictEqual(out.awk[i], lines(run('gawk', ['--re-interval', `/${p.replace(/\//g, '[/]')}/`], { input: LINES.join('\n') + '\n' }).stdout));
          });
        }
        it(`and on fifty lines of 80 characters: '${p}'`, () => {
          assert.strictEqual(out.many50[i], 'ran');
          assert.deepStrictEqual(out.many50grep[i], lines(run('grep', ['-E', p], { input: MANY.join('\n') + '\n' }).stdout));
          assert.deepStrictEqual(out.many50sed[i], lines(run('sed', ['-E', `s~${p}~X~`], { input: MANY.join('\n') + '\n' }).stdout));
        });
      });

      it('and say nothing of not being computed', () => {
        assert.deepStrictEqual(out.notes.filter(([, said]: [string, boolean]) => said), []);
      });

      P.doubling.forEach((p, i) => {
        it(`whose paths double, on short texts: '${p}'`, () => {
          const input = SHORT.join('\n') + '\n';
          assert.deepStrictEqual(out.doubling[i][0], lines(run('grep', ['-E', p], { input }).stdout));
          assert.deepStrictEqual(out.doubling[i][1], lines(run('sed', ['-E', `s/${p}/X/`], { input }).stdout));
          assert.deepStrictEqual(out.doubling[i][2], lines(run('gawk', [`/${p}/`], { input }).stdout));
        });
      });
    });
  });

  it('the note does not say why, nor a result', () => {
    assert.ok(/may take too long on this text/.test(NOTE.en));
    assert.ok(/does not say whether it matches/.test(NOTE.en));
    assert.ok(/時間がかかりすぎるおそれがある/.test(NOTE.ja));
    assert.ok(/一致するかどうかは、この例では示さない/.test(NOTE.ja));
  });

  describe('the walk takes the paths JavaScript takes', () => {
    const TEXTS = ['', 'a', 'ab', 'aab', 'ああ', 'Aa', 'AA', 'aA', 'aaa', 'aab', 'abab', 'abcabc', 'foo bar', 'Foo', 'x1', 'aa aa', 'ab\ncd', 'bab', 'abba', 'ÿa'];
    const PATTERNS = [
      'a', 'a*', 'a+', 'a?', 'a*?', 'a+?', 'a??', 'a{2}', 'a{1,2}', 'a{1,2}?', 'a{2,}', 'ab|a', 'a|ab', '(a|ab)(c|bcd)?', '^a', 'a$', '^$', '^c', 'b$', '^b', 'a.b', '\\bfoo\\b', '\\Boo', '.', '.*', '[a-c]+', '[^a]', '\\w+', '\\s', '\\d',
      '(a)\\1', '(a*)\\1', '(a|b)\\1', '(?<n>a)\\k<n>', '\\k<n>(?<n>a)', '(a)|\\1b', '(a)*\\1', '((a)|b)*', '(a*)*', '(a*)+', '(a|)*', '(|a)*', '(a?){2}', '(a?){2,3}?', '(?:a*?){2}', '()*', '(){2}a',
      '(?=a)a', '(?=(a))\\1', '(?!a).', '(?!(a))\\1b', '(?<=a)b', '(?<!a)b', '(?<=(a))b\\1', '(?<=(.)\\1)a', '(?<=^a*)b', '(?<=(a|b)+)a', '(?<!(a)b)a', 'a(?=b)|a', '(?=a*)a', '((?=a)a)+', '((?!b)a)*', '(?<=\\bfoo) bar', '(?<=a{2})b',
      '.+', 'あ+', '(A)\\1', '(?<=(A)\\1)a', '(?<=\\1(a))b', '\\x61', '\\u0061+', '\\cA', '\\0', 'a{,2}', 'a{}', '[\\377]', 'F|f',
    ];
    it('where it matches, and whether it does', () => {
      const wrong: string[] = [];
      for (const flags of ['', 'i', 's', 'm']) {
        for (const p of PATTERNS) {
          for (const t of TEXTS) {
            const real = new RegExp(p, flags).exec(t);
            const w = walked(p, flags, t);
            const same = real ? w.match?.[0] === real.index && w.match?.[1] === real.index + real[0].length : !w.match;
            if (!same) wrong.push(`/${p}/${flags} on ${JSON.stringify(t)}: ${JSON.stringify(w.match)}, not ${real?.index} ${real?.[0]}`);
          }
        }
      }
      assert.deepStrictEqual(wrong, []);
    });

    it('takes a step for each round and for each character of a back-reference', () => {
      assert.ok(walked('(a*)\\1b', '', 'a'.repeat(40)).steps > walked('a*b', '', 'a'.repeat(40)).steps);
      assert.ok(walked('(){100}', '', '').steps >= 100);
      assert.ok(walked('((?=a*b)a)+', '', 'a'.repeat(40)).steps > 40 * 40 / 2);
      assert.ok(walked('((?!a*b)a)*c', '', 'a'.repeat(40)).steps > 40 * 40 / 2);
    });
  });

  describe('what it does not follow is refused', () => {
    it('what the walk does not read', () => {
      for (const p of P.unread) assert.throws(() => scriptRegex(p), RegexRefused, p);
      assert.throws(() => scriptRegex('a'.repeat(2001)), RegexRefused);
      for (const flag of ['u']) assert.throws(() => scriptRegex('a', flag), RegexRefused, flag);
    });

    it('modifiers, where JavaScript has them', () => {
      let has = true;
      try {
        new RegExp('(?i:a)');
      } catch {
        has = false;
      }
      assert.throws(() => scriptRegex('(?i:a)'), has ? RegexRefused : SyntaxError);
    });

    it('a syntax error stays one', () => {
      assert.throws(() => scriptRegex('('), SyntaxError);
      assert.strictEqual(globToRegex('[', 'value')?.test('['), true);
    });

    it('a glob too long to read is refused where it is made', () => {
      assert.throws(() => globToRegex('x'.repeat(2001), 'value'), RegexRefused);
    });
  });

  describe('what is refused, said in each place (with what it does not read, which cannot hang)', () => {
    const NO = '(a)\\2';
    const LONG = 'x'.repeat(2001);
    const parser = createUnbashParser();
    const explain = (line: string) => new Analyzer('en').explainLine(parser.parse(line), 0, 'bash')!;
    const notes = (line: string) => explain(line).examples.filter((x) => x.note === NOTE.en).map((x) => x.kind);
    const LINES_SAID: [string, string][] = [
      [`echo aaa | grep -E '${NO}'`, 'pipeline'],
      [`grep -E '${NO}' f`, 'regex'],
      [`sed -E 's/${NO}/x/' f`, 'sed'],
      [`awk '/${NO}/' f`, 'awk'],
      [`perl -ne 'print if /${NO}/' f`, 'perl'],
      [`jq -n '"a" | test("(a)\\\\2")'`, 'jq'],
      [`yq -y '.a | test("(a)\\\\2")' f`, 'jq'],
      [`[[ $x =~ ${LONG}+ ]]`, 'regex'],
      [`[[ $x == ${LONG}* ]]`, 'glob'],
      [`case $x in ${LONG}*) ;; esac`, 'glob'],
      [`ls ${LONG}*`, 'glob'],
      [`find . -name '${LONG}*'`, 'glob'],
      [`echo "\${x%${LONG}*}"`, 'expansion'],
    ];
    for (const [line, kind] of LINES_SAID) {
      it(line.slice(0, 40), () => {
        assert.deepStrictEqual(notes(line).filter((k) => k === kind), [kind]);
        assert.ok(explain(line).items.length > 0);
      });
    }

    it('in the panel, and of what a stage gives', () => {
      assert.deepStrictEqual(rerun({ kind: 'regex', regex: { source: NO, flags: '' }, mode: 'lines' }, [['a']], 'en').sections, [{ label: 'Result', lines: [BODY.en] }]);
      assert.deepStrictEqual(rerun({ kind: 'regex', regex: { source: NO, flags: '' }, mode: 'lines' }, [['a']], 'ja').sections, [{ label: '結果', lines: [BODY.ja] }]);
      assert.strictEqual(pipedOutput([{ cmd: 'grep', words: ['-E', NO], text: 'grep' }], ['a']), undefined);
    });

    it('of making lines of a pattern', () => {
      assert.throws(() => regexExamples({ source: '(ab{1000}){1000}', flags: '' }), RegexRefused);
    });

    it('in the models: not known', () => {
      assert.strictEqual(patternMatches('abc', `${LONG}*`), undefined);
      const value = explain(`x=abc; y=\${x%${LONG}*}; echo "$y"`);
      assert.ok(value.items.length > 0);
      assert.ok(explain(`ls -{a,b}${LONG}*`).items.length > 0);
    });
  });

  describe('runs as far as their steps allow', () => {
    it('a long text', () => {
      assert.ok(!refused('a*a*b', 'a'.repeat(100)));
      assert.ok(refused('a*a*b', 'a'.repeat(2000)));
      assert.ok(!refused('a*b', 'a'.repeat(500)));
      assert.ok(refused('a*b', 'a'.repeat(5000)));
      assert.ok(!refused('^a*b', 'a'.repeat(50000)));
      assert.ok(!refused('foo', 'a'.repeat(100000)));
    });

    it('a text refused once is refused at once, when the whole limit was tried', () => {
      const re = scriptRegex('a*b');
      const text = 'a'.repeat(5000);
      assert.throws(() => re.test(text), RegexRefused);
      assert.throws(() => scriptRegex('a*b').test(text), RegexRefused);
      assert.ok(!refused('a*b', 'a'.repeat(5)));
    });

    it('the patterns read are kept, but not without bound', () => {
      for (let i = 0; i < 600; i++) assert.ok(scriptRegex(`x${i}`).test(`x${i}`));
    });

    it('test, exec, replace, split, match and matchAll all run through it, from where a global regex stands', () => {
      const long = 'a'.repeat(5000);
      assert.throws(() => long.replace(scriptRegex('a*b'), 'x'), RegexRefused);
      assert.strictEqual(guarded(() => long.split(scriptRegex('a*b')).length, () => 0), 0);
      assert.throws(() => long.match(scriptRegex('a*b')), RegexRefused);
      assert.throws(() => [...long.matchAll(scriptRegex('a*b', 'g'))], RegexRefused);
      assert.deepStrictEqual('a,b'.split(scriptRegex(',')), ['a', 'b']);
      assert.strictEqual('aXa'.replace(scriptRegex('a', 'g'), 'b'), 'bXb');
      assert.deepStrictEqual([...'aa'.matchAll(scriptRegex('a', 'g'))].map((m) => m.index), [0, 1]);
      assert.strictEqual(scriptRegex('a').exec('xa')?.index, 1);
      const sticky = scriptRegex('a', 'y');
      sticky.lastIndex = 1;
      assert.strictEqual(sticky.exec('xa')?.index, 1);
    });

    it('a deep stack costs nothing later, and throws nothing', () => {
      assert.ok(scriptRegex('^a*').test('a'.repeat(300000)));
      assert.ok(scriptRegex('^(?:a|b)*$').test('a'.repeat(100000)));
    });
  });

  describe('guarded', () => {
    it('gives what the run gives, or says it was refused', () => {
      assert.strictEqual(guarded(() => 1, () => 2), 1);
      assert.strictEqual(guarded(() => (scriptRegex('a*b').test('a'.repeat(5000)) ? 1 : 0), () => 2), 2);
    });

    it('lets anything else through', () => {
      assert.throws(() => guarded(() => { throw new TypeError('x'); }, () => 2), TypeError);
    });

    it('the runs in it share one limit, those of one inside it too; the next has its own', () => {
      const re = scriptRegex('a*b');
      const text = 'a'.repeat(600);
      const many = () => { for (let i = 0; i < 20; i++) re.test(text); return 'done'; };
      assert.strictEqual(guarded(many, () => 'refused'), 'refused');
      assert.strictEqual(guarded(() => guarded(many, () => 'inner'), () => 'outer'), 'inner');
      assert.strictEqual(guarded(() => (re.test(text) ? 'hit' : 'none'), () => 'refused'), 'none');
      // (Outside it, a run alone is limited, and nothing adds up.)
      assert.strictEqual(many(), 'done');
    });
  });

  it('a glob that runs says whether it matches', () => {
    assert.strictEqual(patternMatches('abac', '*a*c'), true);
    assert.strictEqual(patternMatches('abab', '*a*c'), false);
  });

  describe('one source', () => {
    /**
     * Each file of src/ that makes a RegExp in another way than `scriptRegex`, how many times, and why it may: none runs a
     * script's pattern on data. Anything else is a bug: a new one fails here, and so does one gone.
     */
    const ALLOWED: Record<string, [number, string]> = {
      'src/dict/builtins.ts': [5, 'Signal names of the table.'],
      'src/dict/types.ts': [1, 'A pattern of the dictionary.'],
      'src/embedded/gitformat.ts': [1, 'Colour names of the table.'],
      'src/examples/regex.ts': [1, 'Only compiled, to see that it is one.'],
      'src/examples/regexguard.ts': [2, 'One class on one character; only compiled, for the test of the walk.'],
      'src/examples/regexparse.ts': [1, 'One class on one character.'],
      'src/examples/shellwords.ts': [1, 'One bracket expression on one character.'],
      'src/expansion.ts': [1, 'One bracket expression on one character.'],
      'src/explain/line-notes.ts': [1, 'A variable name.'],
      'src/explain/scripts.ts': [1, 'A variable name.'],
      'src/hosts/bats.ts': [2, 'Constants of the file and names of libraries.'],
      'src/hosts/batstags.ts': [1, 'A constant.'],
      'src/hosts/detect.ts': [2, 'Keys of YAML, constants.'],
      'src/hosts/python.ts': [2, 'Function names escaped, and keyword names.'],
      'src/hosts/yaml.ts': [1, 'A variable name of the table.'],
      'src/levels.ts': [1, 'A constant.'],
      'src/rewrite.ts': [1, 'A variable name.'],
      'src/semantics/effects.ts': [1, 'A constant.'],
      'src/semantics/fieldshape.ts': [1, 'One class of the characters of IFS.'],
      'src/ui/themeTokens.ts': [1, 'Theme names of a settings table, not a script.'],
    };
    /** The calls of a text, wherever their lines break, out of comments. */
    const calls = (text: string) => (text.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').match(/(?<![\w.])(?:new\s+)?RegExp\s*\(/g) ?? []).length;
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));

    it('every regex of a script runs through it', () => {
      const root = path.join(__dirname, '..');
      const found = Object.fromEntries(files(path.join(root, 'src')).map((f) => [path.relative(root, f).replace(/\\/g, '/'), calls(fs.readFileSync(f, 'utf8'))]).filter(([, n]) => n));
      assert.deepStrictEqual(found, Object.fromEntries(Object.entries(ALLOWED).map(([f, [n]]) => [f, n])));
    });

    it('finds a call over several lines, and none in a comment', () => {
      assert.strictEqual(calls('const a = new RegExp(\n  x,\n);\n// new RegExp(y)\n/* RegExp(z) */ RegExp(w);\nr.source;'), 2);
    });
  });
});
