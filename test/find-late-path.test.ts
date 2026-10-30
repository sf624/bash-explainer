// A word in find's expression that no test, action or operator takes is a path after the expression, which GNU find
// refuses ("paths must precede expression"); a word of unknown text may be a test or an action, so it is not called one.
// The starting points before the expression are read as GNU find reads them (a leading `,` and `)` are starting points).
// The real find is run for each claim (GNU findutils; skipped without it).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { interpret } from '../src/argv/interpret';
import { lookupCommand } from '../src/dict/aliases';
import { allTokens, explain } from './support/explain';

const said = (line: string, word: string, lang: 'ja' | 'en' = 'en'): string =>
  allTokens(explain(line, 0, lang).items).find((t) => t.label === word && ['argument', 'option', 'operator'].includes(t.kind))!.explanation;
/** The summary of the expression of `line` (its `test` token). */
const summary = (line: string, lang: 'ja' | 'en' = 'en'): string => allTokens(explain(line, 0, lang).items).find((t) => t.kind === 'test')!.explanation;
/** The words of the expression that find refuses (operands of the spec of its tests: all of them are late paths). */
const late = (...words: string[]): string[] => {
  const spec = lookupCommand('find')!.expressionSpec!;
  const parse = interpret(spec, words.map((value) => ({ value })), { name: 'find', lookup: lookupCommand });
  return parse.roles.flatMap(({ word, role }) => (role.role === 'operand' && role.spec?.extra?.says === 'paths must precede expression' ? [words[word]] : []));
};

const gnu = /GNU/.test(spawnSync('find', ['--version'], { encoding: 'utf8' }).stdout ?? '');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-late-'));
before(() => { for (const f of ['a', 'b', 'c', ',']) fs.writeFileSync(path.join(dir, f), ''); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
/** What GNU find does with these words in a directory of files a, b, c and `,`: its status and what it printed. */
const real = (...args: string[]): { status: number | null; out: string; err: string } => {
  const r = spawnSync('find', args, { encoding: 'utf8', cwd: dir, timeout: 10000 });
  return { status: r.status, out: r.stdout.trim().split('\n').sort().join(' '), err: r.stderr };
};
const withFind = gnu ? it : it.skip;

describe('a path after the start of find\'s expression', () => {
  it('is refused by find, as the explanation of the word says', () => {
    assert.match(said('find . -name a.txt b.txt -exec rm {} \\;', 'b.txt'), /a path after the expression, which find refuses \(it prints `paths must precede expression`/);
    assert.match(said('find . -name a.txt b.txt -exec rm {} \\;', 'b.txt', 'ja'), /式の後ろに書かれたパス（find は受け付けず、`paths must precede expression`/);
    assert.match(said('find . -name a ""', '""'), /a path after the expression, which find refuses/);
  });
  withFind('is refused by the real find, also an empty word', () => {
    for (const args of [['.', '-name', 'a', 'b'], ['.', '-name', 'a', ''], ['.', '-print', 'b']]) {
      const r = real(...args);
      assert.strictEqual(r.status, 1, args.join(' '));
      assert.match(r.err, /paths must precede expression/);
      assert.strictEqual(r.out, '', args.join(' '));
    }
  });
  it('is not said of a word of unknown text, which may be a test or an action', () => {
    for (const more of ['$more', '"$more"']) {
      const line = `find . -name a ${more}`;
      assert.ok(!allTokens(explain(line).items).some((t) => /refuses/.test(t.explanation)), line);
    }
    assert.match(said('find . -name $f -exec rm {} \\;', '$f'), /this value is the first word `\$f` gives, and the others are read as the words after it/);
  });
  withFind('is what the real find does only when the word is one: `more` empty, `-print`, `-o -name c` run, `b` is refused', () => {
    for (const [more, runs] of [[[], true], [['-print'], true], [['-o', '-name', 'c'], true], [['b'], false]] as const) {
      const r = real('.', '-name', 'a', ...more);
      assert.strictEqual(r.status === 0, runs, more.join(' '));
      if (!runs) assert.match(r.err, /paths must precede expression/);
    }
  });
  it('is an operand of the expression with the spec\'s refusal, and the words before the expression are starting points as before', () => {
    assert.deepStrictEqual(late('-name', 'a.txt', 'b.txt', 'c.txt'), ['b.txt', 'c.txt']);
    assert.deepStrictEqual(late('-name', 'a.txt', '-print'), []);
    assert.match(said('find *.txt -name x', '*.txt'), /^starting directory/);
    assert.match(said('find a b -name x', 'b'), /^starting directory/);
  });
  it('makes the summary of the expression say that find refuses it', () => {
    for (const line of ['find . -name a b', 'find . -print b', 'find . -name a ""', 'find . -name x -- y', 'find . \\( -name a b \\)', 'find . ! b', 'find . -name a , b']) {
      assert.match(summary(line), /^find refuses this expression and exits with status 1, running nothing/, line);
      assert.match(summary(line, 'ja'), /^find はこの式を受け付けず/, line);
    }
    assert.match(summary('find . -name a -o -name b'), /^Print what matches: name matches a; or name matches b/);
    assert.ok(!/refuses/.test(summary('find . -name a $more')));
  });
});

describe('where find\'s expression starts', () => {
  withFind('a leading `,` and `)` are starting points, as find reads them', () => {
    assert.strictEqual(real('.', ',', 'b').status, 0);
    assert.deepStrictEqual(real('.', ',', 'b').out.split(' ').filter((x) => !x.startsWith('.')), [',', 'b']);
    assert.match(real('.', ')', 'b').err, /‘\)’: No such file or directory/);
    for (const [line, words] of [['find . , b', [',', 'b']], ['find . , -name a', [',']], ['find . \\) b', ['\\)', 'b']]] as const) {
      for (const w of words) assert.match(said(line, w), /^starting directory/, `${line}: ${w}`);
    }
    assert.match(summary('find . , -name a'), /^Print what matches: name matches a/);
  });
  withFind('`(` and `!` start it, and a `,` after it is the operator', () => {
    assert.strictEqual(real('.', '!', '-name', 'a').status, 0);
    assert.strictEqual(real('.', '-name', 'a', ',', '-name', 'b').out, './b');
    assert.match(summary('find . -name a , -name b'), /^Print what matches: name matches a, then name matches b/);
    assert.match(said('find . -name a , -name b', ','), /^evaluates both sides, and the value is the right one's/);
    assert.match(summary('find . -name a , -name b', 'ja'), /次に/);
  });
  withFind('`--` ends the options before the starting points, and is an unknown predicate after them', () => {
    assert.strictEqual(real('--', '.', '-name', 'a').out, './a');
    assert.match(real('.', '-name', 'a', '--', 'y').err, /unknown predicate `--'/);
    assert.match(said('find -- . -name a', '--'), /^End of options/);
    assert.match(said('find . -name x -- y', '--'), /^a predicate find does not know \(before the starting points `--` ends the options, but in the expression find says `unknown predicate`/);
  });
});
