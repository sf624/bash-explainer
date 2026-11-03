import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { pipedOutput } from '../src/examples/pipeline';
import { posixExec, regexExamples } from '../src/examples/regex';
import { charge, costOf, guarded, longestExec, RegexRefused, scriptRegex } from '../src/examples/regexguard';
import { Parser } from '../src/examples/regexparse';
import { rerun } from '../src/examples/rerun';
import { globToRegex } from '../src/examples/shellwords';
import { fact } from '../src/messages';
import { patternMatches } from '../src/semantics/conditions';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { scoped } from './support/contained';
import { compare, FLAGS, type Found, TABLE } from './support/regexguard-differential';
import { run } from './support/run';
import { ADVERSARIAL, FEW_CHARS, GLOBS, LINES, LOG, MANY, MUST_RUN, ORDINARY, P, type Row, SHORT, SPECS, TOOLS } from './support/regexguard-table';

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
/** A file of test/support, in a process of its own, in a cgroup where there is one. */
function child(file: string, args: string[], ms: number) {
  const node = [process.execPath, '--import', 'tsx', path.join(__dirname, 'support', file), ...args];
  const cmd = scoped ? ['systemd-run', '--user', '--scope', '-q', '-p', 'MemoryMax=3G', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=500', '-p', `RuntimeMaxSec=${Math.ceil(ms / 1000) + 10}`, ...node] : node;
  return spawnSync(cmd[0], cmd.slice(1), { timeout: ms, killSignal: 'SIGKILL', maxBuffer: 1 << 28, env: { ...process.env, NODE_V8_COVERAGE: '' } });
}

describe('the guard of the regexes a script gives', () => {
  describe('what runs in a process of its own', function () {
    // (An engine that does not stop ends here by this timeout, not in a run that never ends. It takes 15 s; with coverage,
    // whose counters slow it ten times, over two minutes: so it is measured by the tests below.)
    this.timeout(180000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let out: any;
    before(() => {
      const r = child('regexguard-table.ts', ['run'], 150000);
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

    it('no match takes the process down: each charged by what it gives, and a line of many registers runs', () => {
      const said = (name: string) => out.checks[name];
      for (const name of ['awk -F, by the size of what it gives', 'perl split, by the size of what it gives', 's///g, by the size of what it gives', 'split by many registers']) assert.deepStrictEqual(said(name), { tokens: true, said: true }, name);
      for (const name of ['many registers on a long text', 'what takes JavaScript long to compile']) assert.deepStrictEqual(said(name), { tokens: true, said: false }, name);
    });

    it('the name of a variable, or of a call in Python, is not read as a regex', () => {
      assert.deepStrictEqual(out.names, [true, true, true]);
      assert.strictEqual(typeof out.python, 'string');
    });

    it('what a tool makes of a match counts too, however many times its size: no process goes down', () => {
      for (const name of ['sed, & many times', 'sed, \\1 many times', 'sed, many matches and & many times', 'perl, $& many times', 'awk, & many times', 'sed, four times again and again', 'awk, twice again and again']) assert.deepStrictEqual(out.checks[name], { tokens: true, said: true }, name);
      // (`${x//a/…}` makes the text it knows, of a size JavaScript can hold.)
      assert.strictEqual(out.checks['bash, a long text many times'].tokens, true);
    });

    it('a pattern that ends in the middle of a name reads as text, as JavaScript reads it', () => {
      for (const name of ['the end of a name, perl', 'the end of a name, grep -P', 'the end of a name, jq']) assert.deepStrictEqual(out.checks[name], { tokens: true, said: false }, name);
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
        it(`and on fifty lines of ${FEW_CHARS} characters: '${p}'`, () => {
          assert.strictEqual(out.many50[i], 'ran');
          assert.deepStrictEqual(out.many50grep[i], lines(run('grep', ['-E', p], { input: MANY.join('\n') + '\n' }).stdout));
          assert.deepStrictEqual(out.many50sed[i], lines(run('sed', ['-E', `s~${p}~X~`], { input: MANY.join('\n') + '\n' }).stdout));
          assert.deepStrictEqual(out.log50sed[i], lines(run('sed', ['-E', `s~${p}~X~g`], { input: LOG.join('\n') + '\n' }).stdout));
        });
      });

      ORDINARY.forEach(([script, text], i) => {
        it(`as a script gives them, with a here-document: sed -E '${script}' on ${text.length} lines of ${text[0].length}`, () => {
          assert.strictEqual(out.ordinary[i].said, false);
          assert.deepStrictEqual(out.ordinary[i].out, lines(run('sed', ['-E', script], { input: text.join('\n') + '\n' }).stdout));
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

  describe('the engine gives what JavaScript gives', function () {
    this.timeout(180000);

    it('in a process of its own, on the table and on patterns and texts of a seed', () => {
      const r = child('regexguard-differential.ts', ['20261103', '1000'], 120000);
      assert.strictEqual(r.status, 0, `${r.signal ?? ''} ${r.stderr}`);
      const found = JSON.parse(r.stdout.toString()) as Found;
      assert.deepStrictEqual(found.wrong, []);
      assert.ok(found.runs > 100000, `${found.runs} runs`);
      assert.ok(found.costly < found.runs / 100, `${found.costly} of ${found.runs} too costly to compare`);
    });

    it('here too, on the table: each use, flag and text', () => {
      const found: Found = { runs: 0, refused: 0, costly: 0, wrong: [], invalid: 0 };
      for (const source of TABLE.engine) for (const flags of FLAGS.slice(0, 7)) for (const text of TABLE.engineTexts.slice(0, 24)) compare(source, flags, text, found);
      assert.deepStrictEqual(found.wrong, []);
      assert.strictEqual(found.refused, 0);
      // (`i` on what has other cases, once each.)
      for (const source of TABLE.engine) for (const text of TABLE.engineTexts.slice(24)) compare(source, 'i', text, found);
      assert.deepStrictEqual(found.wrong, []);
    });

    it('never runs JavaScript\'s matcher: what it last matched stays', () => {
      const legacy = RegExp as unknown as { lastMatch: string };
      const uses: (() => unknown)[] = [
        () => scriptRegex('b').test('abc'), () => scriptRegex('b').exec('abc'), () => 'abc'.replace(scriptRegex('b'), 'x'), () => 'abc'.replace(scriptRegex('b', 'g'), () => 'x'),
        () => 'abc'.split(scriptRegex('b')), () => 'abc'.match(scriptRegex('b')), () => 'abc'.match(scriptRegex('b', 'g')), () => [...'abc'.matchAll(scriptRegex('b', 'g'))], () => 'abc'.search(scriptRegex('b')),
      ];
      // (The first time, the parser reads the patterns, with regexes of its own.)
      for (const use of uses) use();
      assert.ok(/marker/.exec('marker'));
      for (const use of uses) assert.ok(use());
      assert.strictEqual(legacy.lastMatch, 'marker');
    });

    it('its steps: one for each round, and for each character of a back-reference', () => {
      const cost = (source: string, text: string) => costOf(() => scriptRegex(source).test(text));
      assert.ok(cost('(a*)\\1b', 'a'.repeat(40)) > cost('^a*b', 'a'.repeat(40)));
      assert.ok(cost('(){100}', '') >= 100);
      assert.ok(cost('((?=a*b)a)+', 'a'.repeat(40)) > 40 * 40 / 2);
      assert.ok(cost('((?!a*b)a)*c', 'a'.repeat(40)) > 40 * 40 / 2);
    });

    it('all it does costs: a match each capture and what it holds, a run its registers once', () => {
      const G = '()'.repeat(990);
      const each = (text: string, source: string, flags: string) => costOf(() => text.replace(scriptRegex(source, flags), 'x'));
      assert.ok(each('aaa', `a|${G}`, 'g') > 3 * 990 * 8);
      assert.ok(each('a', '(a*)', '') > each('a'.repeat(0), '(a*)', ''));
      assert.ok(costOf(() => scriptRegex('(a*)').exec('a'.repeat(1000))) > 2000);
      // (A start that fails leaves the registers as they were: it need not set them again.)
      assert.ok(guarded(() => {
        scriptRegex(`z${G}`);
        return costOf(() => scriptRegex(`z${G}`).test('a'.repeat(10000)));
      }, () => Infinity) < 30000);
      // (Each round of a repeat clears its groups, and a deep stack costs more than its steps.)
      assert.ok(costOf(() => scriptRegex(`(?:${G}a)*b`).test('aaa')) > 3 * 990 * 2);
      const deep = (n: number) => guarded(() => {
        scriptRegex('^(?:a|b)*');
        return costOf(() => scriptRegex('^(?:a|b)*').test('a'.repeat(n)));
      }, () => Infinity);
      assert.ok(deep(5000) > deep(100) * 50 + 2000);
      // (A character of a class above the small ones is looked for each time, and more so in a long class.)
      assert.ok(costOf(() => scriptRegex('[あ-ん]z').test('亜'.repeat(100))) > 2 * costOf(() => scriptRegex('[a-c]z').test('d'.repeat(100))));
      // (A pattern is paid for once in a limit.)
      const long = `${'x'.repeat(1500)}${Date.now()}`;
      assert.ok(costOf(() => scriptRegex(long)) > 64 * 1500);
      assert.ok(guarded(() => {
        scriptRegex(long);
        return costOf(() => scriptRegex(long));
      }, () => Infinity) < 3000);
    });

    it('`.*x` looks through a line once, not from each character, and goes on after the line\'s end', () => {
      const cost = (source: string, text: string, flags = '') => costOf(() => scriptRegex(source, flags).test(text));
      for (const source of ['.*x', '.+x', '.*?x', '(.*)x', '((.*))x', '(?:.*)x', 'a*x', '[a]*x', 'A*x']) {
        const small = cost(source, 'a'.repeat(100), 'i');
        assert.ok(cost(source, 'a'.repeat(1000), 'i') < 15 * small, source);
      }
      assert.ok(cost('あ*x', 'あ'.repeat(1000)) < 15 * cost('あ*x', 'あ'.repeat(100)));
      assert.ok(cost('[あ]*x', 'あ'.repeat(1000)) < 15 * cost('[あ]*x', 'あ'.repeat(100)));
      assert.strictEqual(scriptRegex('.*x').exec('ab\ncx')?.index, 3);
      assert.strictEqual(scriptRegex('a*x').exec('aay aax')?.index, 4);
      assert.strictEqual(scriptRegex('.*x', 's').exec('ab\ncx')?.index, 0);
      // (A back-reference can tell where it started, and the repeat in a group of its own may start anew.)
      assert.ok(cost('(a*)\\1b', 'a'.repeat(200)) > 15 * cost('(a*)\\1b', 'a'.repeat(20)));
      assert.ok(cost('(?:a*|b)x', 'a'.repeat(200)) > 15 * cost('(?:a*|b)x', 'a'.repeat(20)));
      assert.ok(cost('a{2,}x', 'a'.repeat(200)) > 15 * cost('a{2,}x', 'a'.repeat(20)));
      assert.ok(cost('(?=a)*a*x', 'a'.repeat(200)) > 15 * cost('(?=a)*a*x', 'a'.repeat(20)));
    });

    it('the longest match of those at the first place, by POSIX: as many ends as it takes', () => {
      const m = (source: string, text: string, at = 0, flags = '') => posixExec({ source, flags }, text, at);
      assert.deepStrictEqual([...m('a|ab', 'xab')!], ['ab']);
      assert.deepStrictEqual([...m('a|ab|abc|ab', 'abd')!], ['ab']);
      assert.deepStrictEqual([...m('(a|ab)(c|bcd)?', 'abcd')!], ['abcd', 'a', 'bcd']);
      assert.strictEqual(m('a', 'b'), null);
      assert.strictEqual(m('b|ba', 'abab', 2)?.index, 3);
      // (It ends at the line's end at once, where no other can be longer.)
      assert.ok(costOf(() => m('.*.*.*', 'a'.repeat(200))) < 3000);
      assert.deepStrictEqual([...m('(?<n>a)|ab', 'ab')!], ['ab', undefined]);
      assert.ok(costOf(() => m('.*from ([0-9.]+).*', 'from 1.1.1.1 '.repeat(7))) < 3000);
    });

    it('a parser ends on any text, and what it leaves to `new RegExp` it does not take for more', () => {
      for (const text of ['(', '[', '[a-', '\\', '\\k', '(?<n>a)\\k<n', '(?<n>a)\\k', '\\c', '[\\', '[\\c', ')', '(?', '(?<', 'a{', '|']) {
        assert.ok(new Parser(text).alt(), text);
      }
    });
  });

  describe('what it does not follow is refused', () => {
    it('what the engine does not read', () => {
      for (const p of P.unread) assert.throws(() => scriptRegex(p), RegexRefused, p);
      assert.throws(() => scriptRegex('a'.repeat(2001)), RegexRefused);
      for (const flag of ['u']) assert.throws(() => scriptRegex('a', flag), RegexRefused, flag);
    });

    /** What `source` gives where JavaScript has it: refused, else JavaScript's syntax error. */
    const whereItHasIt = (source: string) => {
      let has = true;
      try {
        new RegExp(source);
      } catch {
        has = false;
      }
      assert.throws(() => scriptRegex(source), has ? RegexRefused : SyntaxError);
    };

    it('modifiers, where JavaScript has them', () => {
      whereItHasIt('(?i:a)');
    });

    it('a name given twice, where JavaScript has it', () => {
      whereItHasIt(P.twice);
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
    const LONG = 'x'.repeat(2001);
    const NO = LONG;
    const parser = createUnbashParser();
    const explain = (line: string) => new Analyzer('en').explainLine(parser.parse(line), 0, 'bash')!;
    const notes = (line: string) => explain(line).examples.filter((x) => x.note === NOTE.en).map((x) => x.kind);
    const LINES_SAID: [string, string][] = [
      [`echo aaa | grep -E '${NO}'`, 'pipeline'],
      [`grep -E '${NO}' f`, 'regex'],
      [`sed -E 's/${NO}/x/' f`, 'sed'],
      [`awk '/${NO}/' f`, 'awk'],
      [`perl -ne 'print if /${NO}/' f`, 'perl'],
      [`jq -n '"a" | test("${NO}")'`, 'jq'],
      [`yq -y '.a | test("${NO}")' f`, 'jq'],
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

    it('of a `{` whose reading depends on the release: no lines', () => {
      assert.strictEqual(regexExamples({ source: P.openBraces[0], flags: '' }), undefined);
      assert.strictEqual(regexExamples({ source: P.openBraces[1], flags: '' }), undefined);
      assert.ok(regexExamples({ source: P.openBraces[2], flags: '' })?.matching.length);
    });
  });

  describe('runs as far as their steps allow', () => {
    it('a long text', () => {
      assert.ok(!refused('a*a*b', 'a'.repeat(100)));
      assert.ok(refused('a*a*b', 'a'.repeat(10000)));
      assert.ok(!refused('(?:a|b)*c', 'a'.repeat(100)));
      assert.ok(refused('(?:a|b)*c', 'a'.repeat(5000)));
      assert.ok(!refused('a*b', 'a'.repeat(100000)));
      assert.ok(!refused('^a*b', 'a'.repeat(50000)));
      assert.ok(!refused('foo', 'a'.repeat(100000)));
    });

    it('a run refused once is refused again only when all that decides it is the same', () => {
      const re = scriptRegex(P.polynomial);
      const text = 'a'.repeat(10000);
      assert.throws(() => re.test(text), RegexRefused);
      assert.strictEqual(guarded(() => costOf(() => scriptRegex(P.polynomial).test(text)), () => -1), Infinity);
      assert.throws(() => scriptRegex(P.polynomial).test(text), RegexRefused);
      assert.ok(!refused(P.polynomial, 'a'.repeat(5)));
      const A = `${'a'.repeat(40)}!`;
      // (From another place, and at one place only.)
      const moved = scriptRegex(P.twoWaysEnd, 'g');
      assert.throws(() => moved.test(A), RegexRefused);
      moved.lastIndex = 40;
      assert.strictEqual(moved.test(A), false);
      assert.throws(() => scriptRegex(P.twoWaysMark).test(`${A}b`), RegexRefused);
      assert.strictEqual(scriptRegex(P.twoWaysMark, 'y').test(`b${A}`), false);
      assert.throws(() => scriptRegex(P.twoWaysMark).test(`b${A}b`), RegexRefused);
      assert.strictEqual(scriptRegex(P.twoWaysMark, 'y').test(`b${A}b`), false);
      // (The longest match, and the first that JavaScript's order comes to.)
      assert.throws(() => longestExec(P.twoWays, '', A, 0), RegexRefused);
      assert.strictEqual(scriptRegex(P.twoWays).exec(A)![0], 'a'.repeat(40));
      assert.throws(() => longestExec(P.twoWays, '', A, 0), RegexRefused);
      // (With less left, and then with more.)
      const costs = costOf(() => scriptRegex('b*a*c').test('a'.repeat(1000)));
      const late = () => guarded(() => {
        charge(1e7 - costs / 2);
        scriptRegex('b*a*c').test('a'.repeat(1000));
        return true;
      }, () => false);
      assert.strictEqual(late(), false);
      assert.ok(!refused('b*a*c', 'a'.repeat(1000)));
    });

    it('what a run costs does not depend on whether its pattern was kept, nor does a refusal', () => {
      const once = (source: string, text: string) => costOf(() => scriptRegex(source).test(text));
      for (const source of ['qz1*q', `${'(?:q|z)'.repeat(285)}q`, '(q)*z\\1']) assert.strictEqual(once(source, 'abc'), once(source, 'abc'), source);
      // (In one limit, it is paid for once; the next limit pays again.)
      const twice = guarded(() => [once('qz2*q', 'abc'), once('qz2*q', 'abc')], () => []);
      assert.ok(twice[0] > twice[1]);
      assert.strictEqual(once('qz2*q', 'abc'), twice[0]);
    });

    it('what is explained does not depend on what was explained before', () => {
      const A = `${'a'.repeat(40)}!`;
      const parser = createUnbashParser();
      const TABLE_OF_LINES = [
        `echo ${A} | perl -lpe 's/${P.twoWays}/x/'`, `echo ${A} | sed -E 's/${P.twoWays}/x/'`, `x=${A}; [[ $x =~ ${P.twoWays} ]]`, `echo ${A} | grep -oE '${P.twoWays}'`,
        `echo ${A} | sed -E 's/${P.twoWays}/x/g'`, `echo ${A} | perl -lpe 's/${P.twoWays}/x/g'`, `echo ${A} | awk '{ sub(/${P.twoWays}/, "x"); print }'`, `echo '"${A}"' | jq 'test("${P.twoWays}")'`,
        `echo ${A} | grep -E '${P.twoWaysEnd}'`, `echo ${A} | grep -cE '${P.twoWaysEnd}'`, `x=${A}; echo "\${x%%*a*a*a*a*a*a*a*b}"`, `x=${A}; echo "\${x//a*a*b/c}"`, `[[ ${A} == +(a|aa) ]]`,
        `echo aaa | sed -E 's/${P.twoWays}/x/'`, `echo aaa | grep -E '${P.twoWaysEnd}'`,
      ];
      const explain = (line: string) => JSON.stringify(new Analyzer('en').explainLine(parser.parse(line), 0, 'bash'));
      const forward = TABLE_OF_LINES.map(explain);
      const backward = [...TABLE_OF_LINES].reverse().map(explain).reverse();
      const differ = TABLE_OF_LINES.filter((_, i) => forward[i] !== backward[i]);
      assert.deepStrictEqual(differ, []);
      // (The first match of JavaScript's order comes at once; the longest takes too long.)
      assert.ok(forward[0].includes('x!') && !forward[0].includes('Not computed'));
      assert.ok(forward[1].includes('Not computed'));
      assert.ok(forward[2].includes(A) && !forward[2].includes('Not computed'));
    });

    it('a start past a leading repeat is not left out where a back-reference tells where the repeat began', () => {
      assert.deepStrictEqual([...scriptRegex(P.backReference).exec('aaba')!], ['aba', 'a']);
      assert.deepStrictEqual([...scriptRegex(P.namedBackReference).exec('aaba')!], ['aba', 'a']);
      assert.strictEqual(scriptRegex(P.backReference).exec('aaba')!.index, 1);
    });

    it('a pattern of many levels takes as long to make as any of its length', function () {
      // (Each level with the groups of those in it was cubic: a second for each of these, and the time of this test was 40 s.)
      this.timeout(15000);
      for (let k = 0; k < 40; k++) scriptRegex(`${'('.repeat(650)}a${')*'.repeat(650)}${String.fromCharCode(0x61 + k)}`);
      assert.ok(costOf(() => scriptRegex(`${'('.repeat(650)}a${')*'.repeat(650)}`)) > 2000 * 64);
      assert.deepStrictEqual([...scriptRegex('((a)|(b))*').exec('ab')!], ['ab', 'b', undefined, 'b']);
      assert.deepStrictEqual([...scriptRegex('(?:(a)|b)*(c)|(d)').exec('abc')!], ['abc', undefined, 'c', undefined]);
    });

    it('the patterns read are kept, but not without bound', () => {
      for (let i = 0; i < 600; i++) assert.ok(scriptRegex(`x${i}${'y'.repeat(1000)}`).test(`x${i}${'y'.repeat(1000)}`));
    });

    it('test, exec, replace, split, match and matchAll all run through it, from where a global regex stands', () => {
      const long = 'a'.repeat(10000);
      assert.throws(() => long.replace(scriptRegex(P.polynomial), 'x'), RegexRefused);
      assert.strictEqual(guarded(() => long.split(scriptRegex(P.polynomial)).length, () => 0), 0);
      assert.throws(() => long.match(scriptRegex(P.polynomial)), RegexRefused);
      assert.throws(() => [...long.matchAll(scriptRegex(P.polynomial, 'g'))], RegexRefused);
      assert.deepStrictEqual('a,b'.split(scriptRegex(',')), ['a', 'b']);
      assert.strictEqual('aXa'.replace(scriptRegex('a', 'g'), 'b'), 'bXb');
      assert.deepStrictEqual([...'aa'.matchAll(scriptRegex('a', 'g'))].map((m) => m.index), [0, 1]);
      assert.strictEqual(scriptRegex('a').exec('xa')?.index, 1);
      const sticky = scriptRegex('a', 'y');
      sticky.lastIndex = 1;
      assert.strictEqual(sticky.exec('xa')?.index, 1);
    });

    it('a deep stack costs nothing later, and throws nothing', () => {
      assert.ok(scriptRegex('^a*').test('a'.repeat(1000000)));
      assert.ok(scriptRegex('^(?:a|b)*$').test('a'.repeat(100000)));
    });
  });

  describe('guarded', () => {
    it('gives what the run gives, or says it was refused', () => {
      assert.strictEqual(guarded(() => 1, () => 2), 1);
      assert.strictEqual(guarded(() => (scriptRegex(P.polynomial).test('a'.repeat(10000)) ? 1 : 0), () => 2), 2);
    });

    it('a string too long for JavaScript is one more thing that costs too much', () => {
      assert.strictEqual(guarded(() => 'a'.repeat(2 ** 30).length, () => -1), -1);
    });

    it('what a tool charges counts, and past the limit is refused where no match was', () => {
      assert.strictEqual(costOf(() => charge(1000)), 1000);
      assert.strictEqual(costOf(() => charge(1e9)), Infinity);
      // (Outside it, each by itself, and the limit is for it alone.)
      assert.throws(() => charge(1e9), RegexRefused);
      charge(1e6);
    });

    it('a run stops as it looks through a run of characters, with nothing left', () => {
      const re = scriptRegex('a*b');
      const text = 'a'.repeat(1000);
      const whole = costOf(() => re.test(text));
      // (Enough for the walk from the first place, and for the run of `a`s up to its last ones.)
      assert.strictEqual(costOf(() => { charge(1e7 - whole + 10); re.test(text); }), Infinity);
      assert.ok(costOf(() => { charge(1e7 - whole); re.test(text); }) <= 1e7);
    });

    it('lets anything else through, a RangeError that is not of a size too', () => {
      assert.throws(() => guarded(() => { throw new TypeError('x'); }, () => 2), TypeError);
      assert.throws(() => guarded(() => (1).toFixed(200), () => '2'), RangeError);
      assert.throws(() => guarded(() => String.fromCodePoint(0x110000), () => '2'), RangeError);
      const deep = (n: number): number => deep(n + 1) + 1;
      assert.strictEqual(guarded(() => deep(0), () => -1), -1);
    });

    it('a note on a pattern only where there is one: numbers print their digits, and nothing is said of a pattern', () => {
      const parser = createUnbashParser();
      for (const line of [`printf '%.200f\\n' 1`, `awk 'BEGIN { printf "%.101f", 1.5 }'`, `jq -n '[1114112] | implode'`, `printf '%.20f\\n' 0.1`, `printf '%99999s' a`, `awk 'BEGIN { printf "%.99999f", 1 }'`]) {
        const said = JSON.stringify(new Analyzer('en').explainLine(parser.parse(line), 0, 'bash').examples);
        assert.ok(!said.includes('Not computed'), line);
      }
    });

    it('the runs in it share one limit, those of one inside it too; the next has its own', () => {
      const re = scriptRegex(P.polynomial);
      const text = 'a'.repeat(1000);
      const many = () => { for (let i = 0; i < 8; i++) re.test(text); return 'done'; };
      assert.strictEqual(guarded(many, () => 'refused'), 'refused');
      assert.strictEqual(guarded(() => guarded(many, () => 'inner'), () => 'outer'), 'inner');
      // (What was spent in one inside it is spent: the run after it, in the same one, has nothing left.)
      assert.strictEqual(guarded(() => { guarded(many, () => 'inner'); return re.test('') ? 'hit' : 'none'; }, () => 'outer'), 'outer');
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
     * Each call in src/ that makes a RegExp in another way than `scriptRegex`, as written up to the end of what it is given,
     * and where what it holds comes from: nothing of a script, so JavaScript's matcher never runs a script's pattern. Anything
     * else is a bug: a new call fails here, one gone, and one changed: another name in a template. A call that is not
     * of constants of ours has no place here: compare the strings, or read them with a constant regex and compare.
     */
    const ALLOWED: Record<string, Record<string, string>> = {
      'src/dict/builtins.ts': {
        "new RegExp(`^-(?!s[A-Za-z])(?:${anyCase('SIG')})?(${anyCase(SIGNALS)})$`)": 'The table of signals.',
        "new RegExp(`^-(?!s[A-Za-z])${anyCase('SIG')}(${anyCase(SIGNALS)})$`)": 'The table of signals.',
        "new RegExp(`^-(?:${anyCase('SIG')})?(${anyCase(SIGNALS)})$`)": 'The table of signals.',
        "new RegExp(`^(?!${ALIAS_NAME}=)[^=]+=`)": 'A constant.',
        "new RegExp(`^${ALIAS_NAME}=[^]*[ \\\\t]$`)": 'A constant.',
      },
      'src/dict/types.ts': {
        "new RegExp(nextIf)": 'A pattern of the dictionary.',
      },
      'src/embedded/gitformat.ts': {
        "new RegExp(`^C(${COLORS.join('|')})`)": 'The table of colours.',
      },
      'src/examples/regex.ts': {
        "new RegExp(out, flags)": 'Only compiled, to see that it is one.',
      },
      'src/hosts/bats.ts': {
        "new RegExp(`[${ALNUM}]`, 'u')": 'A constant.',
        "new RegExp(`(?:^|[/'\"\\\\s])${lib}(?:$|[/'\"\\\\s])`)": 'The names of the table LIBRARIES.',
      },
      'src/hosts/batstags.ts': {
        "new RegExp(`^ *(${TAG})?( *, *${TAG})* *$`, 'u')": 'A constant.',
      },
      'src/hosts/detect.ts': {
        "new RegExp(`^(${k})\\\\s*:(\\\\s|$)`)": 'Keys of YAML, constants.',
        "new RegExp(`^\\\\s+(-\\\\s+)?(${k})\\\\s*:(\\\\s|$)`)": 'Keys of YAML, constants.',
      },
      'src/hosts/python.ts': {
        "new RegExp(`(?<![\\\\w.])(${[...names.keys()].map((n) => n.replace(/\\./g, '\\\\.')).join('|')})\\\\s*\\\\(`, 'g')": 'Names of the table PY_CALLS, or `\\w+` after `as`, which is tested (test/support/regexguard-table.ts).',
        "new RegExp(`^${k}\\\\s*=\\\\s*([\\\\s\\\\S]*)$`)": 'Names of keywords, constants.',
      },
      'src/hosts/yaml.ts': {
        "new RegExp(`\\\\$\\\\{?${name}\\\\b`)": 'The names of the table GITHUB_FILES.',
      },
      'src/levels.ts': {
        "new RegExp(`^[${LEVEL_ORDER.map((l) => LEVELS[l].mark).join('')}]\\\\uFE0F?\\\\s*`, 'u')": 'A constant.',
      },
      'src/semantics/effects.ts': {
        "new RegExp(`^(${ALIAS_NAME})=(['\"]?)([\\\\s\\\\S]*)\\\\2$`)": 'A constant.',
      },
      'src/semantics/fieldshape.ts': {
        "new RegExp(`[${h.kind === 'digits' ? '' : '-'}0-9]`)": 'A constant class, on the characters of IFS.',
      },
    };
    /** The calls of a text, as written up to the end of what they are given, out of comments. */
    const calls = (text: string) => [...text.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').matchAll(/(?<![\w.])(?:new\s+)?RegExp\s*\((?:`(?:[^`\\]|\\.)*`(?:, '[a-z]*')?\)|[^`\n)]*\)?)/g)].map((m) => m[0]);
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));

    it('every regex of a script runs through it', () => {
      const root = path.join(__dirname, '..');
      const found = Object.fromEntries(files(path.join(root, 'src')).map((f) => [path.relative(root, f).replace(/\\/g, '/'), calls(fs.readFileSync(f, 'utf8'))]).filter(([, n]) => n.length));
      assert.deepStrictEqual(found, Object.fromEntries(Object.entries(ALLOWED).map(([f, list]) => [f, Object.keys(list)])));
    });

    it('a variable of a script reaches no regex, as its name or in one: no call that takes a name from it', () => {
      const root = path.join(__dirname, '..');
      for (const f of ['src/explain/line-notes.ts', 'src/explain/scripts.ts', 'src/rewrite.ts', 'src/ui/themeTokens.ts']) assert.deepStrictEqual(calls(fs.readFileSync(path.join(root, f), 'utf8')), [], f);
      // (`RegExp` as a value, which the list above would not see: `const R = RegExp`.)
      const asValue = /(?<![:<|] ?|<\w+, |\b(?:extends|as|instanceof) )\bRegExp\b(?!\s*\()/;
      const seen = files(path.join(root, 'src')).filter((f) => asValue.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
      assert.deepStrictEqual(seen.map((f) => path.relative(root, f).replace(/\\/g, '/')), []);
    });

    /** `.match(x)`, `.matchAll(x)` and `.search(x)` make a RegExp of a string `x`: each of those with other than a literal, a constant in capitals or `scriptRegex(`. */
    const implicit = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').match(/(?<!this)\.(?:match|matchAll|search)\((?!\/|[A-Z_]+[,)]|scriptRegex\()[^)]*\)/g) ?? [];
    /** Those that are no string: a RegExp made here of constants, or by `scriptRegex`. */
    const IMPLICIT: Record<string, string[]> = {
      'src/examples/perlrun.ts': ['.matchAll(re)'],
      'src/hosts/python.ts': ['.matchAll(callRe)'],
    };

    it('no regex comes of a string by itself', () => {
      const root = path.join(__dirname, '..');
      const found = Object.fromEntries(files(path.join(root, 'src')).map((f) => [path.relative(root, f).replace(/\\/g, '/'), implicit(fs.readFileSync(f, 'utf8'))]).filter(([, n]) => n.length));
      assert.deepStrictEqual(found, IMPLICIT);
    });

    it('the engine has no way into JavaScript\'s matcher', () => {
      const source = fs.readFileSync(path.join(__dirname, '../src/examples/regexguard.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
      assert.deepStrictEqual(source.match(/\bsuper\.\w+|RegExp\.prototype|Reflect\.\w+/g), null);
    });

    it('finds each call, as written, and none in a comment', () => {
      assert.deepStrictEqual(calls('const a = new RegExp(\n  x,\n);\n// new RegExp(y)\n/* RegExp(z) */ RegExp(w);\nr.source;'), ['new RegExp(', 'RegExp(w)']);
    });
  });
});
