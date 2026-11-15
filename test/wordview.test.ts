// The view of a word (src/semantics/wordview.ts, docs/design/word-source.md, 3.2): what it reads of the word model and
// the field domain, case by case. test/word-probes.test.ts holds it against bash on probes/words.json.
import * as assert from 'assert';
import { shellState } from '../src/semantics/state';
import { wordView, type WordView, wordViewAsWritten, wordViewIn } from '../src/semantics/wordview';
import { EMPTY } from '../src/semantics/shellstate';
import type { WordEnv } from '../src/semantics/words';
import type { Shell } from '../src/shellfeatures';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields, type SyntaxNode } from '../src/syntax/tree';

const parser = createUnbashParser();

/** The words of the last `show` of `text`: its arguments, then its redirections' targets. */
function wordsOf(text: string): { words: SyntaxNode[]; tree: ReturnType<typeof parser.parse> } {
  const tree = parser.parse(text);
  const c = descendants(tree.root, ['command']).filter((x) => field(x, 'name')?.text === 'show').pop()!;
  return { tree, words: [...fields(c, 'argument'), ...fields(c, 'redirect').map((r) => field(r, 'destination')!)] };
}

/** The view of the `i`th word of the last `show` of `text`, in the finished model. */
function view(text: string, i = 0, opts: { shell?: Shell; env?: WordEnv } = {}): WordView {
  const { tree, words } = wordsOf(text);
  return wordView(words[i], shellState(tree, opts.shell ?? 'bash'), opts.env)!;
}

/** The view of the `i`th word of the last `show` of `text`, as written. */
const written = (text: string, i = 0): WordView => wordViewAsWritten(wordsOf(text).words[i], 'bash')!;

/** What a view says, in short: the chars with `<>` for a hole, `[c]` for a pattern character (`[c?]` where it may be). */
function brief(v: WordView): object {
  const chars = (x: WordView['words'][number]): string | undefined => x.chars?.map((c) => (c.hole ? '<>' : c.pattern ? `[${c.c}${c.pattern === 'unknown' ? '?' : ''}]` : c.c)).join('');
  return {
    ...(v.value !== undefined ? { value: v.value } : {}), plain: v.plain, count: v.count, ...(v.start !== undefined ? { start: v.start, end: v.end } : {}),
    globs: v.globs, unknown: v.unknown, words: v.words.map((x) => [x.written, chars(x), x.fields ?? null]),
  };
}

describe('the view of a word (wordview.ts)', () => {
  it('a plain word: its value, one field', () => {
    assert.deepStrictEqual(brief(view('show "b c"')), { value: 'b c', plain: true, count: { min: 1, max: 1 }, start: 'b c', end: 'b c', globs: false, unknown: [], words: [['"b c"', 'b c', ['b c']]] });
    assert.deepStrictEqual(brief(view('show ""')), { value: '', plain: true, count: { min: 1, max: 1 }, start: '', end: '', globs: false, unknown: [], words: [['""', '', ['']]] });
  });

  it('a pattern bash leaves as written (`set -f`, an assignment) is plain', () => {
    assert.deepStrictEqual(brief(view('set -f; show ./x*')), { value: './x*', plain: true, count: { min: 1, max: 1 }, start: './x*', end: './x*', globs: false, unknown: [], words: [['./x*', './x*', ['./x*']]] });
  });

  it('a pattern: its fields with the files of the environment, else what the field domain says', () => {
    assert.deepStrictEqual(brief(view('show *.txt', 0, { env: { files: ['a.txt', 'b.txt'] } })), { plain: false, count: { min: 2, max: 2 }, start: 'a.txt', end: 'b.txt', globs: true, unknown: [], words: [['*.txt', '[*].txt', ['a.txt', 'b.txt']]] });
    const v = view('show *.txt');
    assert.ok(v.shapes);
    assert.deepStrictEqual(brief(v), { plain: false, count: { min: 1 }, start: '', end: '.txt', globs: true, unknown: [], words: [['*.txt', '[*].txt', null]] });
    // (A value of the model counts: `${x}*` gives `a` and the names `b*` matches.)
    assert.deepStrictEqual(brief(view('x="a b"; show ${x}*')), { plain: false, count: { min: 2 }, start: 'a', end: '', globs: true, unknown: [], words: [['${x}*', 'a b[*]', null]] });
    // (failglob with no match: bash fails, no field.)
    assert.deepStrictEqual(view('shopt -s failglob; show *.none', 0, { env: { files: ['a.txt'] } }).count, { min: 0, max: 0 });
  });

  it('bash unquotes the characters of IFS in a word with no unquoted expansion: a pattern, not plain', () => {
    assert.deepStrictEqual(brief(view('IFS="*"; show "*"*', 0, { env: { files: ['a', 'b'] } })), { plain: false, count: { min: 2, max: 2 }, start: 'a', end: 'b', globs: true, unknown: [], words: [['"*"*', '[*][*]', ['a', 'b']]] });
  });

  it('a hole for a value not known; an expansion bash fails on gives no field', () => {
    assert.deepStrictEqual(brief(view('show $y')), { plain: false, count: { min: 0 }, globs: 'unknown', unknown: ['value'], words: [['$y', '<>', null]] });
    assert.deepStrictEqual(brief(view('show "$y"x')), { plain: false, count: { min: 1, max: 1 }, start: '', end: 'x', globs: false, unknown: ['value'], words: [['"$y"x', '<>x', null]] });
    assert.deepStrictEqual(brief(view('a=; show ${a:?}')), { plain: false, count: { min: 0, max: 0 }, globs: 'unknown', unknown: [], words: [['${a:?}', undefined, null]] });
    // (The field domain: every reading fails.)
    assert.deepStrictEqual(view('a=; show $y${a:?}').count, { min: 0, max: 0 });
  });

  it('the words of a brace expansion, one of them empty', () => {
    assert.deepStrictEqual(brief(view('show x{a,b}y')), { plain: false, count: { min: 2, max: 2 }, start: 'xay', end: 'xby', globs: false, unknown: [], words: [['xay', 'xay', ['xay']], ['xby', 'xby', ['xby']]] });
    assert.deepStrictEqual(brief(view('e=; show {$e,$y}')), { plain: false, count: { min: 0 }, globs: 'unknown', unknown: ['value'], words: [['$e', '', []], ['$y', '<>', null]] });
    assert.deepStrictEqual(brief(view('e=; show {$e,"$y"}')), { plain: false, count: { min: 1, max: 1 }, start: '', end: '', globs: false, unknown: ['value'], words: [['$e', '', []], ['"$y"', '<>', null]] });
    // (The field domain: the first word's text starts it; the last may give no field, so nothing is known of the end.)
    assert.deepStrictEqual([view('show {a,$y}').count, view('show {a,$y}').start, view('show {a,$y}').end], [{ min: 1 }, 'a', '']);
    assert.deepStrictEqual(brief(view('e=; show $e')), { plain: false, count: { min: 0, max: 0 }, globs: false, unknown: [], words: [['$e', '', []]] });
  });

  it('what is not known, and why', () => {
    assert.deepStrictEqual(brief(view('[ $1 ] && set -f; show *.txt')), { plain: false, count: { min: 1 }, start: '', end: '.txt', globs: 'unknown', unknown: ['option'], words: [['*.txt', '[*?].txt', null]] });
    assert.deepStrictEqual(view('IFS=$1; x=a; show $x').unknown, ['ifs']);
    // (How bash quotes the `*` here rests on the IFS: the characters are as written.)
    const ifs = view('IFS=$1; x=a; show $x*');
    assert.deepStrictEqual([ifs.words[0].asWritten, ifs.globs, ifs.unknown], [true, 'unknown', ['ifs']]);
    // (On POSIX mode, which may be on.)
    assert.deepStrictEqual(view('IFS="*"; [ $1 ] && set -o posix; show > $x*').unknown, ['value', 'option']);
    assert.deepStrictEqual(brief(view('[ $1 ] && set +B; show {a,b}')), { plain: false, count: { min: 1, max: 2 }, start: '', end: '', globs: 'unknown', unknown: ['option'], words: [] });
    assert.deepStrictEqual(view('show {1..1000}').unknown, ['too-many']);
    assert.deepStrictEqual(view('show {,$x}a').unknown, ['misread']);
    assert.deepStrictEqual(view('show $_{a,b}').unknown, ['misread', 'value']);
    assert.deepStrictEqual(view('show $RANDOM', 0, { shell: 'dash' }).unknown, ['misread', 'value']);
  });

  it('a split not known (an IFS with a mark of bash): a pattern may be one', () => {
    assert.deepStrictEqual(brief(view("IFS=$'\\x01'; x='*'; y=ab; show $x")), { plain: false, count: { min: 0 }, globs: 'unknown', unknown: [], words: [['$x', '[*?]', null]] });
    assert.deepStrictEqual(view("IFS=$'\\x01'; y=ab; show $y").globs, false);
  });

  it('a redirection target that gives two words: bash fails', () => {
    assert.deepStrictEqual(view('show > {a,b}').count, { min: 0, max: 0 });
    assert.deepStrictEqual(written('show > {a,b}').count, { min: 0 });
    assert.deepStrictEqual(written('show > a').count, { min: 1, max: 1 });
  });

  it('as written: no value is known, a command substitution neither', () => {
    assert.deepStrictEqual(brief(written(':() { printf x; }; show $(:)echo')), { plain: false, count: { min: 0 }, globs: 'unknown', unknown: ['value'], words: [['$(:)echo', '<>echo', null]] });
    assert.deepStrictEqual(brief(written('x=1; set -f; show $x *.txt', 1)), { plain: false, count: { min: 0 }, globs: true, unknown: [], words: [['*.txt', '[*].txt', null]] });
    assert.deepStrictEqual(written('show a$((1+2))').value, undefined);
    assert.deepStrictEqual(brief(written('show a$((1+2))')), { plain: false, count: { min: 1, max: 1 }, start: 'a3', end: 'a3', globs: false, unknown: [], words: [['a$((1+2))', 'a3', ['a3']]] });
  });

  it('outside a word: none', () => {
    const tree = parser.parse('show a');
    assert.strictEqual(wordView(tree.root, shellState(tree, 'bash')), undefined);
    assert.strictEqual(wordViewIn(tree.root, EMPTY, { variable: () => undefined, tilde: () => undefined, builtinRuns: () => false, shell: () => undefined }), undefined);
  });
});
