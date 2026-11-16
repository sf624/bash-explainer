// The view of a word (src/semantics/wordview.ts, docs/design/word-source.md, 3.2): what it reads of the word model and
// the field domain, case by case. test/word-probes.test.ts holds it against bash on probes/words.json.
import * as assert from 'assert';
import { shellState } from '../src/semantics/state';
import { unmatchedOf, valueAsWritten, valuesAsWritten, valueIn, valueOf, wordView, type WordView, wordViewAsWritten, wordViewIn } from '../src/semantics/wordview';
import { EMPTY } from '../src/semantics/shellstate';
import type { WordEnv } from '../src/semantics/words';
import type { Shell } from '../src/shellfeatures';
import { declaredWord } from '../src/semantics/wordcontexts';
import { placedText } from '../src/staticword';
import { wordFields, wordMeaning } from '../src/semantics/words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields, type SyntaxNode } from '../src/syntax/tree';
import { corpus } from './support/corpus';

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

/** The view of the word written `word` in `text` (the first, top of its word), in the finished model; `as written`, before any. */
function viewAt(text: string, word: string, how: 'model' | 'as written' = 'model'): WordView {
  const tree = parser.parse(text);
  const model = shellState(tree, 'bash');
  const all: SyntaxNode[] = [];
  const walk = (n: SyntaxNode): void => { all.push(n); n.children.forEach(walk); };
  walk(tree.root);
  const n = all.find((x) => x.named && x.text === word && wordMeaning(x, model)?.nodes[0] === x)!;
  return how === 'model' ? wordView(n, model)! : wordViewAsWritten(n, 'bash')!;
}

/** What a view says, in short: the chars with `<>` for a hole, `[c]` for a pattern character (`[c?]` where it may be). */
function brief(v: WordView): { words: unknown } & Record<string, unknown> {
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
    // (Text outside ASCII is copied as it is in every locale, also in `$'…'`; a `\u` or `\U` above 0x7f is written in the
    // locale's encoding (`é` in UTF-8, the escape itself in C), and `\xe9` is a lone byte: no value, so `$x` has none.)
    const fieldsOf = (text: string): string[] | undefined => { const { tree, words } = wordsOf(text); return wordFields(words[0], shellState(tree, 'bash'))?.fields; };
    assert.deepStrictEqual([fieldsOf("x='é'; show \"$x\""), fieldsOf("x=$'é'; show \"$x\""), fieldsOf("x=$'エラー\\tです'; show \"$x\""), fieldsOf("x='é\\u'; show \"$x\"")], [['é'], ['é'], ['エラー\tです'], ['é\\u']]);
    assert.deepStrictEqual([fieldsOf("x=$'\\u00e9'; show \"$x\""), fieldsOf("x=$'\\U000000e9'; show \"$x\""), fieldsOf("x=$'\\xe9'; show \"$x\""), fieldsOf("x=$'\\351'; show \"$x\""), fieldsOf("x=$'é\\u41'; show \"$x\"")], [undefined, undefined, undefined, undefined, ['éA']]);
  });

  it('glob characters pathname expansion does not read are text (`set -f`, an assignment), not where the context matches the word (`case`)', () => {
    assert.deepStrictEqual(brief(view('set -f; show ./x*')), { value: './x*', plain: true, count: { min: 1, max: 1 }, start: './x*', end: './x*', globs: false, unknown: [], words: [['./x*', './x*', ['./x*']]] });
    assert.strictEqual(view('set -f; show ./x* ~').value, './x*');
    assert.strictEqual(view('set -o noglob; show "a"[b]').value, 'a[b]');
    assert.strictEqual(view('show ./x*').value, undefined);
    assert.strictEqual(viewAt('x=*.txt', '*.txt').value, '*.txt');
    assert.strictEqual(viewAt('x=*.txt', '*.txt', 'as written').value, '*.txt');
    assert.strictEqual(viewAt('local f=a[1]', 'a[1]').value, 'a[1]');
    assert.strictEqual(viewAt('case $x in *.txt) ;; esac', '*.txt').value, undefined);
    assert.strictEqual(viewAt('case $x in *.txt) ;; esac', '*.txt').meaning.value, undefined);
    assert.strictEqual(viewAt('[[ $x == a* ]]', 'a*').meaning.value, undefined);
  });

  it('what a word gives where pathname expansion leaves it as it is (`unmatched`): its value, or a pattern as written after quote removal', () => {
    const unmatched = (text: string, i = 0, opts: { shell?: Shell } = {}): string | undefined => view(text, i, opts).unmatched;
    assert.strictEqual(unmatched('show "b c"'), 'b c');
    assert.strictEqual(unmatched('show *.txt'), '*.txt');
    assert.strictEqual(unmatched('show "a"*\\?.zz'), 'a*?.zz');
    assert.strictEqual(unmatched('show foo$'), 'foo$');
    assert.strictEqual(unmatched('set -f; show a*b'), 'a*b');
    assert.strictEqual(unmatched('show $\'\\t\''), '\t');
    // (A context that matches the word itself gives no field: none, but the value where it is plain.)
    assert.strictEqual(viewAt('case $y in *"*".txt) ;; esac', '*"*".txt').unmatched, undefined);
    assert.strictEqual(viewAt('case $y in "*".txt) ;; esac', '"*".txt').unmatched, '*.txt');
    // (An assignment given to a declaration builtin: its name and `=` before what its value gives.)
    assert.strictEqual(viewAt('export a=b*', 'a=b*').unmatched, 'a=b*');
    assert.strictEqual(viewAt('export a=', 'a=').unmatched, 'a=');
    assert.strictEqual(viewAt('export a=~', 'a=~').unmatched, undefined);
    // (Another step changes the word, a part is not known, or a pattern that matches nothing may go: none.)
    for (const text of ['show ~/a.b', 'show a{b,c}', 'show ${x:?}', 'IFS=$1; show $x', 'show $x', 'show "$x"', 'show $(:)', 'shopt -s nullglob; show *.txt', 'shopt -s failglob; show *.txt', 'shopt -s nullglob; set -f; show a', '[ "$1" ] && shopt -s nullglob; show *.txt']) {
      assert.strictEqual(unmatched(text), text.endsWith('show a') ? 'a' : undefined, text);
    }
    // (Nullglob does not matter to a word that is no pattern, or where pathname expansion does not apply.)
    assert.strictEqual(unmatched('shopt -s nullglob; set -f; show a*'), 'a*');
    // (Where each character of that text sits in the source: what a reader of a language places its tokens over.)
    const placed = (text: string): ReturnType<typeof placedText> => { const w = wordsOf(text).words[0]; return placedText(w, view(text).unmatched!); };
    assert.deepStrictEqual(placed('show foo$'), { text: 'foo$', base: 0 });
    assert.deepStrictEqual(placed('show "a"*\\?'), { text: 'a*?', offsets: [1, 3, 4], ends: [2, 4, 6], removed: ['\\?'] });
    for (const text of ["show $'\\t'", 'x=`show \'a\\$b\'`', "show 'a'\\\n'b'"]) assert.deepStrictEqual([typeof view(text).unmatched, placed(text)], ['string', undefined], text);
    assert.strictEqual(placedText(wordsOf('show ab').words[0], 'ba'), undefined);
    // (The view is made once per word of the model.)
    const { tree, words } = wordsOf('show *.txt');
    const model = shellState(tree, 'bash');
    assert.strictEqual(wordView(words[0], model), wordView(words[0], model));
    assert.notStrictEqual(wordView(words[0], model, { files: [] }), wordView(words[0], model, { files: [] }));
  });

  it('where the context matches the word as a pattern or a regex, its wildcards are patterns, and it is not plain', () => {
    assert.deepStrictEqual(brief(viewAt('case $y in *.txt) ;; esac', '*.txt')), { plain: false, count: { min: 1, max: 1 }, start: '*.txt', end: '*.txt', globs: false, unknown: [], words: [['*.txt', '[*].txt', ['*.txt']]] });
    assert.deepStrictEqual(brief(viewAt('case $y in a"*"\\?) ;; esac', 'a"*"\\?')), { value: 'a*?', plain: true, count: { min: 1, max: 1 }, start: 'a*?', end: 'a*?', globs: false, unknown: [], words: [['a"*"\\?', 'a*?', ['a*?']]] });
    // (An unquoted backslash of a value escapes the character after it: `\*` matches a `*`.)
    assert.deepStrictEqual(brief(viewAt("x='\\*'; case $y in $x) ;; esac", '$x')).words, [['$x', '\\*', ['\\*']]]);
    assert.deepStrictEqual(brief(viewAt('[[ $f == @(a|b)"]" ]]', '@(a|b)"]"')).words, [['@(a|b)"]"', '@[(]a[|]b[)]]', ['@(a|b)]']]]);
    assert.deepStrictEqual(brief(viewAt('echo ${x%.*}', '.*')).words, [['.*', '.[*]', ['.*']]]);
    assert.deepStrictEqual(brief(viewAt('[[ $x =~ ^[0-9]+"."$ ]]', '^[0-9]+"."$')).words, [['^[0-9]+"."$', '[^][[]0-9[]][+].[$]', ['^[0-9]+.$']]]);
    assert.strictEqual(viewAt('[[ $x =~ abc ]]', 'abc').value, 'abc');
  });

  it('an assignment given to a declaration builtin: its name and `=`, then the view of its value', () => {
    assert.deepStrictEqual(brief(viewAt('export FOO=bar', 'FOO=bar')), { value: 'FOO=bar', plain: true, count: { min: 1, max: 1 }, start: 'FOO=bar', end: 'FOO=bar', globs: false, unknown: [], words: [['FOO=bar', 'FOO=bar', ['FOO=bar']]] });
    assert.deepStrictEqual(brief(viewAt('x="a b"; export y="$x"', 'y="$x"')), { plain: false, count: { min: 1, max: 1 }, start: 'y=a b', end: 'y=a b', globs: false, unknown: [], words: [['y="$x"', 'y=a b', ['y=a b']]] });
    assert.deepStrictEqual(brief(viewAt('export w=', 'w=')), { value: 'w=', plain: true, count: { min: 1, max: 1 }, start: 'w=', end: 'w=', globs: false, unknown: [], words: [['w=', 'w=', ['w=']]] });
    assert.deepStrictEqual(brief(viewAt('export z="$x"', 'z="$x"', 'as written')), { plain: false, count: { min: 1, max: 1 }, start: 'z=', end: '', globs: false, unknown: ['value'], words: [['z="$x"', 'z=<>', null]] });
    assert.deepStrictEqual(brief(viewAt('export FOO=bar', 'FOO=bar', 'as written')), { value: 'FOO=bar', plain: true, count: { min: 1, max: 1 }, start: 'FOO=bar', end: 'bar', globs: false, unknown: [], words: [['FOO=bar', 'FOO=bar', ['FOO=bar']]] });
    // (A value bash fails on: no field, and no characters.)
    assert.deepStrictEqual(brief(viewAt('x=; export a=${x:?}', 'a=${x:?}')), { plain: false, count: { min: 0, max: 0 }, globs: 'unknown', unknown: [], words: [['a=${x:?}', undefined, null]] });
    // (One the builtin reads itself, an array, or a subscript of the name.)
    assert.deepStrictEqual(brief(viewAt('declare -a b=(1 2)', 'b=(1 2)')), { plain: false, count: { min: 1, max: 1 }, globs: 'unknown', unknown: ['misread'], words: [] });
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
    assert.deepStrictEqual([ifs.words[0].asWritten, ifs.globs, ifs.unknown], ['ifs', 'unknown', ['ifs']]);
    // (A shell that may be bash: its quoting of IFS characters is not known.)
    assert.deepStrictEqual(view('IFS="*"; x=a; show $x*', 0, { shell: 'sh' }).words[0].asWritten, 'misread');
    // (A value the IFS may unquote: not plain, though `WordMeaning.value` has it.)
    assert.deepStrictEqual([view('IFS=$1; show "*"a').plain, view('IFS=$1; show "*"a').meaning.value], [false, '*a']);
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

  it('a shell that may read the word otherwise: quoted words give one field each, of no known start (zsh)', () => {
    // (zsh reads `$a[1]` as an element of `a`: one word, `"$a[1].b"`, which bash reads as `$a` then `[1].b`.)
    assert.deepStrictEqual([view('show "$a[1].b"', 0, { shell: 'zsh' }).count, view('show "$a[1].b"', 0, { shell: 'zsh' }).start], [{ min: 1, max: 1 }, '']);
    assert.deepStrictEqual(view('show {x,"$a[1]"}', 0, { shell: 'zsh' }).count, { min: 2, max: 2 });
    // (Not unquoted, nor `"$@"`.)
    assert.deepStrictEqual([view('show $a[1]', 0, { shell: 'zsh' }).count, view('show "$@$a[1]"', 0, { shell: 'zsh' }).count], [{ min: 0 }, { min: 0 }]);
  });

  it('as written, a view for each shell: `$\'x\'` is `x` in bash, not known in sh, whichever is asked first', () => {
    for (const order of [['sh', 'bash'], ['bash', 'sh']] as const) {
      const { words } = wordsOf("show $'x'");
      const values = Object.fromEntries(order.map((sh) => [sh, wordViewAsWritten(words[0], sh)!.value]));
      assert.deepStrictEqual(values, { bash: 'x', sh: undefined }, order.join());
    }
  });

  it('braces on some paths only: the text before them is the start of every field, but where they are too many to list', () => {
    assert.deepStrictEqual([view('if c; then set +B; fi; show -v{a,b}').lead, view('if c; then set +B; fi; show -v{a,b}').count], ['-v', { min: 1, max: 2 }]);
    assert.deepStrictEqual([view('if c; then set +B; fi; show -v{1..100000}').lead, view('if c; then set +B; fi; show -v{1..100000}').count], [undefined, { min: 0 }]);
  });

  it('a redirection target that gives two words: bash fails', () => {
    assert.deepStrictEqual(view('show > {a,b}').count, { min: 0, max: 0 });
    assert.deepStrictEqual(written('show > {a,b}').count, { min: 0 });
    assert.deepStrictEqual(written('show > a').count, { min: 1, max: 1 });
  });

  it('as written: no value is known, a command substitution neither', () => {
    assert.deepStrictEqual(brief(written(':() { printf x; }; show $(:)echo')), { plain: false, count: { min: 1 }, start: '', end: 'echo', globs: 'unknown', unknown: ['value'], words: [['$(:)echo', '<>echo', null]] });
    assert.deepStrictEqual(brief(written('x=1; set -f; show $x *.txt', 1)), { plain: false, count: { min: 1 }, start: '', end: '.txt', globs: true, unknown: [], words: [['*.txt', '[*].txt', null]] });
    assert.deepStrictEqual(written('show a$((1+2))').value, undefined);
    assert.deepStrictEqual(brief(written('show a$((1+2))')), { plain: false, count: { min: 1, max: 1 }, start: 'a3', end: 'a3', globs: false, unknown: [], words: [['a$((1+2))', 'a3', ['a3']]] });
  });

  it('its value is `WordMeaning.value`, over the corpus: the same, or none where the view is not plain, for a reason listed', () => {
    // (The node types of the top of a word; a test may name them: the guard reads src/ only.)
    const TOPS = new Set(['word', 'number', 'string', 'raw_string', 'ansi_c_string', 'translated_string', 'concatenation', 'simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution', 'brace_expression', 'variable_assignment', 'heredoc_body', 'regex', 'extglob_pattern', 'variable_name']);
    /** Where `WordMeaning.value` has a value and the view has none, on purpose: the snippet, the word, and why. */
    const KNOWN: Record<string, string> = {
      '` `': 'an unterminated backquote, read as a substitution that prints nothing: alone and unquoted, it gives no field, so no value',
      '[[ a == ]] ]]': 'a syntax error in bash ("unexpected argument `]]`"): the parser takes the closing `]]` for a pattern, whose unquoted `]` the view, as `plainPattern`, takes for a wildcard',
    };
    let words = 0;
    const wrong: string[] = [];
    const seen = new Set<string>();
    for (const { text } of corpus().snippets) {
      const tree = parser.parse(text);
      const model = shellState(tree, 'bash');
      const all: SyntaxNode[] = [];
      const walk = (n: SyntaxNode): void => { all.push(n); n.children.forEach(walk); };
      walk(tree.root);
      for (const n of all) {
        const w = n.named && TOPS.has(n.type) ? wordMeaning(n, model) : undefined;
        if (w?.nodes[0] !== n) continue;
        words++;
        // (What a reader of a language asks, `unmatchedOf`, is the view's `unmatched`, asked first, before the view is made.)
        const short = unmatchedOf(n, model);
        const v = wordView(n, model)!;
        if (short !== v.unmatched) wrong.push(`${JSON.stringify(text)} ${n.text}: unmatchedOf ${JSON.stringify(short)}, view ${JSON.stringify(v.unmatched)}`);
        // (What a reader of a name asks, `valueAsWritten` and `valueIn`, is the value of the view they stand for: read at once for most words.)
        const asWritten = wordViewAsWritten(n, 'bash')!.value;
        if (valueAsWritten(n, 'bash') !== asWritten) wrong.push(`${JSON.stringify(text)} ${n.text}: valueAsWritten ${JSON.stringify(valueAsWritten(n, 'bash'))}, view ${JSON.stringify(asWritten)}`);
        const st = model.at(n).run;
        const source = { variable: () => undefined, tilde: () => undefined, builtinRuns: () => true, shell: () => 'bash' as const };
        if (valueIn(n, st, source) !== wordViewIn(n, st, source)!.value) wrong.push(`${JSON.stringify(text)} ${n.text}: valueIn ${JSON.stringify(valueIn(n, st, source))}, view ${JSON.stringify(wordViewIn(n, st, source)!.value)}`);
        const d = declaredWord(w, w.steps[0].applies);
        // (An assignment given to a declaration builtin: its head before the value of its value's word.)
        const value = d && d !== 'unread' ? (d.value ? ((x) => x === undefined ? undefined : d.head + x)(wordMeaning(d.value, model)!.value) : d.head) : w.value;
        if (v.value !== undefined && v.value !== value) wrong.push(`${JSON.stringify(text)} ${n.text}: view ${JSON.stringify(v.value)}, meaning ${JSON.stringify(value)}`);
        if (value !== undefined && v.value === undefined) {
          const key = `${text} ${n.text}`;
          seen.add(key);
          if (!KNOWN[key]) wrong.push(`${JSON.stringify(text)} ${n.text}: meaning ${JSON.stringify(value)}, view none (${v.unknown.join(', ')})`);
        }
      }
    }
    assert.deepStrictEqual({ wrong, stale: Object.keys(KNOWN).filter((k) => !seen.has(k)) }, { wrong: [], stale: [] });
    assert.ok(words > 7000, `${words} words`);
  });

  it('its value alone (`valueOf`, `valueIn`, `valueAsWritten`), for the readers of names and of a builtin\'s words', () => {
    const { tree, words } = wordsOf(':() { printf x; }; set +B; show $(:)echo {a,b} \'x\'y *.txt');
    const model = shellState(tree, 'bash');
    // (bash runs `xecho` there: a command substitution has no value as written, nor in the model, `:` being a function.)
    assert.deepStrictEqual(words.map((w) => valueOf(w, model)), [undefined, '{a,b}', 'xy', undefined]);
    assert.deepStrictEqual(words.map((w) => valueAsWritten(w)), [undefined, undefined, 'xy', undefined]);
    // (Braces are text where the brace step does not apply: dash.)
    assert.strictEqual(valueAsWritten(words[1], 'dash'), '{a,b}');
    // (Kept by the word and the options it is read with: as written first, then in the state of the walk after `set +B`.)
    const source = { variable: () => undefined, tilde: () => undefined, builtinRuns: () => true, shell: () => undefined };
    assert.strictEqual(valueIn(words[1], EMPTY, source), undefined);
    assert.strictEqual(valueIn(words[1], model.at(words[1]).run, source), '{a,b}');
    assert.strictEqual(valueIn(words[1], EMPTY, source), undefined);
    // (A word of text as written is read at once; the right side of `=~` is a regex, where `.` is special: no value.)
    const regex = parser.parse('[[ x =~ a.b ]]');
    const right = descendants(regex.root, ['regex', 'word']).find((w) => w.text === 'a.b')!;
    assert.deepStrictEqual([valueAsWritten(right), wordViewAsWritten(right)!.value], [undefined, undefined]);
    // (Kept by the shell too: dash reads `$'x'` as `$` and `x`, bash as `x`; asked in dash first.)
    const ansi = wordsOf("show $'x'").words[0];
    assert.deepStrictEqual([valueAsWritten(ansi, 'dash'), valueAsWritten(ansi)], ['$x', 'x']);
    // (A part of a word is read as the word that holds it; a function's name is no word.)
    const plainWords = descendants(tree.root, ['word']);
    assert.deepStrictEqual([plainWords[0].parent!.type, valueAsWritten(plainWords[0])], ['function_definition', undefined]);
    assert.strictEqual(valueAsWritten(plainWords.find((w) => w.text === 'y')!), 'xy');
    // (As written, a substitution prints nothing where the reader says its name runs the builtin: the trust scan.)
    assert.deepStrictEqual([valueAsWritten(words[0], 'bash', () => true), valueAsWritten(words[0], 'bash', (n) => n !== ':')], ['echo', undefined]);
  });

  it('the values a word may give as written, braces on or off (`valuesAsWritten`, for the trust scan)', () => {
    const values = (text: string, shell: Shell = 'bash'): (string | undefined)[] => valuesAsWritten(descendants(parser.parse(text).root, ['variable_assignment'])[0], shell);
    // (A declaration's word is brace-expanded as a whole, `declare a={x,}` is `a=x a=`; with `set +B`, `a={x,}` is its text.)
    assert.deepStrictEqual(values("declare a='('{x,y}')'"), ['a=(x)', 'a=(y)', 'a=({x,y})']);
    assert.deepStrictEqual(values("declare a={'(x)',}"), ['a=(x)', 'a=', 'a={(x),}']);
    assert.deepStrictEqual(values('declare a={"$1",b}'), [undefined, 'a=b', undefined]);
    // (An assignment's own value is never brace-expanded, nor a declaration's in dash. Each word braces give is an
    // argument, with a tilde only at its start: `declare a=~/{x,y}` is `a=~/y` at the end; with braces off, `a=$HOME/{x,y}`, not known.)
    assert.deepStrictEqual(valuesAsWritten(field(descendants(parser.parse('a={x,y}').root, ['variable_assignment'])[0], 'value')!), ['{x,y}']);
    assert.deepStrictEqual(values("declare a='('{x,y}')'", 'dash'), ['a=({x,y})']);
    assert.deepStrictEqual(values('declare a=~/{x,y}'), ['a=~/x', 'a=~/y', undefined]);
    // (Braces whose words are not known, too many: none, then the text with braces off.)
    assert.deepStrictEqual(values('declare a={1..100000}'), [undefined, 'a={1..100000}']);
    // (A substitution prints nothing where the reader says that its name runs the builtin, as for `valueAsWritten`.)
    const o = descendants(parser.parse("declare -a a=$(:)'(x)'{,}").root, ['variable_assignment'])[0];
    assert.deepStrictEqual([valuesAsWritten(o, 'bash', () => true), valuesAsWritten(o)], [['a=(x)', 'a=(x)', 'a=(x){,}'], [undefined, undefined, undefined]]);
  });

  it('outside a word: none', () => {
    const tree = parser.parse('show a');
    assert.strictEqual(wordView(tree.root, shellState(tree, 'bash')), undefined);
    assert.strictEqual(valueOf(tree.root, shellState(tree, 'bash')), undefined);
    assert.strictEqual(valueAsWritten(tree.root), undefined);
    assert.strictEqual(wordViewIn(tree.root, EMPTY, { variable: () => undefined, tilde: () => undefined, builtinRuns: () => false, shell: () => undefined }), undefined);
  });
});
