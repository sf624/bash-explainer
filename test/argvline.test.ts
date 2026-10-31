// What the program of each simple command receives (src/argvline.ts; docs/design/panel-redesign.md, P4): the data's
// shape, its placeholders and what bash takes out. test/argv.test.ts checks the same data against the argv bash gives,
// over the capture's corpus.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { ArgvLine, ArgvWord } from '../src/analyzer-types';
import { argvOf } from '../src/argvline';
import { explainDocumentLine } from '../src/document';
import { openDocument } from '../src/document-setup';
import type { Lang } from '../src/i18n';
import { assignmentSaid, hereSaid, placeholderSaid } from '../src/messages-argv';
import { receivedFields, receivedWords } from '../src/semantics/fieldshape';
import { shellState } from '../src/semantics/state';
import { wordFields } from '../src/semantics/words';
import type { Shell } from '../src/shellfeatures';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields, prefixAssignments, redirectionsOf } from '../src/syntax/tree';
import { corpus } from './support/corpus';
import { argvHolds, argvShown } from './support/argvline';

const parser = createUnbashParser();

/** The data of line `line` of `src`. */
const lines = (src: string, line = 0, lang: Lang = 'en', shell?: Shell): ArgvLine[] => new Analyzer(lang).explainLine(parser.parse(src), line, shell, { argv: true }).argv!;
/** The words of the first command with a name on line 0 of `src`, as a text. */
const shown = (src: string, lang: Lang = 'en'): string => argvShown(lines(src, 0, lang)[0].words);
/** What `receivedWords` gives the last word of the last command of `src`. */
const received = (src: string, shell: Shell = 'bash'): ReturnType<typeof receivedWords> => {
  const tree = parser.parse(src);
  const c = descendants(tree.root, ['command']).at(-1)!;
  return receivedWords(fields(c, 'argument').at(-1)!, shellState(tree, shell));
};

describe('what the program receives (src/argvline.ts, panel P4)', () => {
  it('gives each simple command on the line, also in a substitution, and none for a command with no name', () => {
    const got = lines('x=1; ls -l $(date +%F) | sort; >f');
    assert.deepStrictEqual(got.map((l) => argvShown(l.words)), ['ls -l ‹output of `$(date +%F)`›{0,}', 'date +%F', 'sort']);
    assert.deepStrictEqual(got[0].span, { start: { line: 0, character: 5 }, end: { line: 0, character: 22 } });
    // (A command over several lines, on each of its lines; not on another line.)
    assert.deepStrictEqual(lines('echo a \\\n  b; cat\nls', 1).map((l) => argvShown(l.words)), ['echo a b', 'cat']);
    assert.strictEqual(new Analyzer('en').explainLine(parser.parse('ls'), 0).argv, undefined);
  });

  it('gives the fields the model knows as text, a word received as written marked so', () => {
    const [l] = lines('x="a b"; e=; echo "$x" $x \'q\' $e plain');
    const words = l.words.slice(1);
    assert.deepStrictEqual(words.map((w) => [w.parts, w.count, w.asWritten]), [
      [[{ text: 'a b' }], undefined, undefined], [[{ text: 'a' }], undefined, undefined], [[{ text: 'b' }], undefined, undefined],
      [[{ text: 'q' }], undefined, undefined], [[], { min: 0, max: 0 }, undefined], [[{ text: 'plain' }], undefined, true],
    ]);
    // (Both fields of `$x` come from it.)
    assert.deepStrictEqual(words[1].from, words[2].from);
  });

  it('names each value known only when the line runs in a placeholder, with how many words it may give', () => {
    assert.strictEqual(shown('grep -h "$USER" /var/log/*.log'), 'grep -h ‹current user name› ‹each file name matching `/var/log/*.log`›{1,}');
    assert.strictEqual(shown('grep -h "$USER" /var/log/*.log', 'ja'), 'grep -h ‹現在のユーザー名› ‹`/var/log/*.log` に一致する各ファイル名›{1,}');
    assert.strictEqual(shown('echo ~/d ~+ ~- ~bob/x ~2 "$@" $* "$*" "${a[@]}" $1 "$#" "$v" "${v:-d}"'),
      'echo ‹home directory›/d ‹current directory› ‹previous directory› ‹home directory of `bob`›/x ‹what `~2` gives›'
      + ' ‹each argument›{0,} ‹each argument›{0,} ‹the arguments joined› ‹each element of `a`›{0,} ‹argument 1›{0,} ‹number of arguments› ‹value of `$v`› ‹what `${v:-d}` gives›');
    assert.strictEqual(shown('echo ~/d ~+ ~- ~bob/x ~2 "$@" "$*" "${a[@]}" $1 "$v" "${v:-d}"', 'ja'),
      'echo ‹ホームディレクトリ›/d ‹カレントディレクトリ› ‹直前のカレントディレクトリ› ‹`bob` のホームディレクトリ›/x ‹`~2` の結果›'
      + ' ‹各引数›{0,} ‹引数をつなげた文字列› ‹`a` の各要素›{0,} ‹1番目の引数›{0,} ‹`$v` の値› ‹`${v:-d}` の結果›');
    // (A translation is known only with another part not known: `$"hi"` alone is `hi`.)
    assert.strictEqual(shown('echo "$(id -u)" "$((n + 1))" <(ls) $"hi"$v $"hi" $\'\\u00e9\' "${!x@Q}" a"$v"b'),
      'echo ‹output of `$(id -u)`› ‹result of `$((n + 1))`› ‹file name of `<(ls)`› ‹translation of `$"hi"`›‹value of `$v`›{1,} hi ‹what `$\'\\u00e9\'` gives› ‹what `${!x@Q}` gives›{0,} a‹value of `$v`›b');
    assert.strictEqual(shown('echo "$(id -u)" "$((n + 1))" <(ls) $"hi"$v $\'\\u00e9\' "${!x@Q}"', 'ja'),
      'echo ‹`$(id -u)` の出力› ‹`$((n + 1))` の計算結果› ‹`<(ls)` のファイル名› ‹`$"hi"` の翻訳›‹`$v` の値›{1,} ‹`$\'\\u00e9\'` の結果› ‹`${!x@Q}` の結果›{0,}');
    // (A value that may be split is marked so; the elements of `"$@"` are words of their own, not split, unless they are not quoted.)
    const [l] = lines('rm $f "${a[@]}" "$@" ${a[@]} $*');
    assert.deepStrictEqual(l.words.slice(1).map((w) => w.parts), [
      [{ hole: 'parameter', code: '$f', label: 'value of `$f`', splits: true }],
      [{ hole: 'parameter', code: '${a[@]}', label: 'each element of `a`' }], [{ hole: 'parameter', code: '$@', label: 'each argument' }],
      [{ hole: 'parameter', code: '${a[@]}', label: 'each element of `a`', splits: true }], [{ hole: 'parameter', code: '$*', label: 'each argument', splits: true }],
    ]);
    assert.deepStrictEqual(lines('IFS=; rm $*').at(-1)!.words[1].parts, [{ hole: 'parameter', code: '$*', label: 'each argument' }]);
  });

  it('says that an assignment or a here-string joins the arguments and the elements into one word', () => {
    const [l] = lines('args="$@" u=${a[@]} v=$* ls <<<"${a[@]}"');
    assert.deepStrictEqual(l.removed.map((r) => argvShown(r.word!)), ['‹the arguments joined›', '‹the elements of `a` joined›', '‹the arguments joined›', '‹the elements of `a` joined›']);
    assert.deepStrictEqual(lines('f() { local args="$@"; }')[0].words.slice(1).map((w) => [argvShown([w]), w.count]), [['args=‹the arguments joined›', undefined]]);
    assert.strictEqual(argvShown(lines('u=${a[@]} ls', 0, 'ja')[0].removed[0].word!), '‹`a` の要素をつなげた文字列›');
  });

  it('names a pattern by its text: the whole word as written, else the field', () => {
    assert.strictEqual(shown('ls "$d"/*.log'), 'ls ‹each file name matching `"$d"/*.log`›{1,}');
    // (Several fields of one word: each its own pattern, with a quoted glob character behind a backslash.)
    assert.strictEqual(shown('x="a b*"; ls $x"*"$y*'), 'ls a ‹each file name matching `b*\\*$y*`›{1,}');
    assert.strictEqual(argvShown(lines('shopt -s nullglob; ls *.c')[1].words), 'ls ‹each file name matching `*.c`›{0,}');
  });

  it('stands for a word it cannot read with one placeholder, any number of words', () => {
    assert.strictEqual(shown('echo {,$x}a'), 'echo ‹the words of `{,$x}a`›{0,}');
    assert.strictEqual(shown('echo {,$x}a', 'ja'), 'echo ‹`{,$x}a` から得られる単語›{0,}');
  });

  it('gives an assignment to a declaration builtin as one word, its value not split', () => {
    assert.deepStrictEqual(lines('f() { local x=1 y=$1 z= w="$HOME"/a b=(1 2) c[1]=2 d={p,q}$1; }')[0].words.slice(1).map((w) => [argvShown([w]), w.asWritten]), [
      ['x=1', true], ['y=‹argument 1›', undefined], ['z=', true], ['w=‹home directory›/a', undefined],
      ['‹the words of `b=(1 2)`›{0,}', undefined], ['‹the words of `c[1]=2`›{0,}', undefined], ['d=p‹argument 1›', undefined], ['d=q‹argument 1›', undefined],
    ]);
    // (The model knows it: one word, braces expanded; behind `command`, an argument, split.)
    assert.deepStrictEqual(['v="a b"; export x=$v y={c,d} t+=1 u=', 'v="a b"; command export x=$v'].map((s) => argvShown(lines(s).at(-1)!.words)),
      ['export x=a b y=c y=d t+=1 u=', 'command export x=a b']);
    assert.deepStrictEqual(lines('v="a b"; export x=$v').at(-1)!.words.map((w) => w.parts), [[{ text: 'export' }], [{ text: 'x=a b' }]]);
  });

  it('lists what bash takes out, in order: assignments and redirections, with what they do', () => {
    const [l] = lines('LC_ALL=C v=$x sort -u >"$out" 2>&1 <in.txt x', 0);
    assert.deepStrictEqual(l.removed.map((r) => [r.kind, r.text, r.says, r.word && argvShown(r.word)]), [
      ['assignment', 'LC_ALL=C', 'Set `LC_ALL` to `C` in this command\'s environment only', 'C'],
      ['assignment', 'v=$x', 'Set `v` in this command\'s environment only', '‹value of `$x`›'],
      ['redirect', '>"$out"', 'Write stdout (fd 1) to file `"$out"` (overwrite)', '‹value of `$out`›'],
      ['redirect', '2>&1', 'Send stderr (fd 2) to the same place as stdout (fd 1)', '1'],
      ['redirect', '<in.txt', 'Read file `in.txt` as stdin (fd 0)', 'in.txt'],
    ]);
    assert.strictEqual(l.removed[1].says, 'Set `v` in this command\'s environment only');
    const [j] = lines('LC_ALL=C v= sort <<EOF 3<<<"$x"\nb\nEOF', 0, 'ja');
    assert.deepStrictEqual(j.removed.map((r) => [r.says, r.word && argvShown(r.word)]), [
      ['このコマンドの環境でだけ、`LC_ALL` に `C` を設定する', 'C'], ['このコマンドの環境でだけ、`v` に空文字列を設定する', undefined],
      ['標準入力(fd 0)をヒアドキュメントから読む', undefined], ['ファイルディスクリプタ 3をヒアストリングから読む', '‹`$x` の値›'],
    ]);
    // (Before a special builtin in POSIX mode it stays; `export` of its name keeps it, exported.)
    assert.deepStrictEqual([lines('set -o posix; x=1 :'), lines('if a; then set -o posix; fi; x=1 :'), lines('x=1 export x'), lines('x=$v $cmd')].map((r) => r.at(-1)!.removed[0].says), [
      'Set `x` to `1`; it stays after the command, exported', 'Set `x` to `1`; in POSIX mode it stays after the command',
      'Set `x` to `1`; it stays after the command, exported', 'Set `x` in this command\'s environment only',
    ]);
    // (A redirection with no target yet, while typing.)
    assert.deepStrictEqual(lines('ls >')[0].removed.map((r) => [r.says, r.word]), [['Write stdout (fd 1) to file `` (overwrite)', []]]);
    assert.deepStrictEqual([lines('v= ls')[0].removed[0].says, lines('x=1 export x', 0, 'ja')[0].removed[0].says],
      ['Set `v` to the empty string in this command\'s environment only', '`x` に `1` を設定する。コマンドの後も残り、エクスポートされる']);
    // (An array is no word.)
    const array = lines('a=(1) ls')[0].removed[0];
    assert.deepStrictEqual([array.says, array.word, lines('x="a b" ls')[0].removed[0].word!.map((w) => w.parts)], ['Set `a` in this command\'s environment only', undefined, [[{ text: 'a b' }]]]);
  });

  it('says when bash fails on a word, so that the program does not run', () => {
    assert.deepStrictEqual(lines('x=; echo ${x:?} > ${y:?}')[0].fails, { span: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } }, error: 'parameter-null' });
    assert.strictEqual(shown('x=; echo ${x:?}'), 'echo ‹the words of `${x:?}`›{0,}');
    assert.deepStrictEqual(lines('x="a b"; cat < $x')[0].fails?.error, 'ambiguous-redirect');
    assert.strictEqual(lines('ls')[0].fails, undefined);
    // (An assignment's value, a here-string, a here-document; bash expands the words, then the assignments, then the redirections.)
    const at = (src: string): number | undefined => lines(src).at(-1)!.fails?.span.start.character;
    assert.deepStrictEqual(['unset y; x=${y:?no} ls', 'unset y; ls <<<${y:?}', 'unset y; ls <<EOF\n${y:?}\nEOF', 'unset y z; x=${y:?Y} ls > ${z:?Z}', 'unset y z; ls > ${z:?Z} ${y:?Y}', 'unset y; x=$y ls'].map(at),
      [11, 15, 0, 13, 24, undefined]);
    assert.deepStrictEqual(lines('unset y; ls <<EOF\n${y:?}\nEOF').at(-1)!.fails?.span.start, { line: 1, character: 0 });
    // (A here-document with no delimiter yet, while typing.)
    assert.deepStrictEqual(lines('cat <<')[0].fails, undefined);
  });

  it('keeps the places of a host file, as the explanation does', () => {
    const doc = openDocument('FROM x\nRUN x= ls -l $HOME >o\n', 'dockerfile', (t) => parser.parse(t));
    const ex = explainDocumentLine(new Analyzer('en'), doc, 1, 'en', {}, { argv: true });
    const [l] = ex.argv!;
    assert.deepStrictEqual([argvShown(l.words), l.span.start, l.words[2].from.start, l.removed.map((r) => [r.span.start, r.word?.[0].from.start])],
      // (A Dockerfile's RUN is run by sh: a word not known is one placeholder.)
      ['ls -l ‹the words of `$HOME`›{0,}', { line: 1, character: 4 }, { line: 1, character: 13 }, [[{ line: 1, character: 4 }, undefined], [{ line: 1, character: 19 }, { line: 1, character: 20 }]]]);
    const failing = explainDocumentLine(new Analyzer('en'), openDocument('FROM x\nRUN x=; echo ${x:?}\n', 'dockerfile', (t) => parser.parse(t)), 1, 'en', {}, { argv: true });
    assert.deepStrictEqual(failing.argv![0].fails!.span.start, { line: 1, character: 13 });
  });

  it('matches the argv bash gives, as the capture test reads it', () => {
    const w = (parts: ArgvWord['parts'], count?: ArgvWord['count']): ArgvWord => ({ from: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, parts, ...(count ? { count } : {}) });
    const hole = (splits?: true): ArgvWord['parts'][number] => ({ hole: 'parameter', code: '$x', label: 'value of `$x`', ...(splits ? { splits } : {}) });
    assert.deepStrictEqual([
      argvHolds([w([{ text: 'a.b' }])], ['a.b']), argvHolds([w([{ text: 'a.b' }])], ['axb']),
      argvHolds([w([{ text: 'p' }, hole(true), { text: 's' }], { min: 0 })], ['pa', 'b', 'cs']), argvHolds([w([{ text: 'p' }, hole()])], ['pa', 'b']),
      argvHolds([w([hole(true)], { min: 0 }), w([{ text: 'z' }])], ['z']), argvHolds([w([], { min: 0, max: 0 })], []),
    ], [true, false, true, false, true, true]);
  });

  it('reads a word with holes only where the word model reads it as bash does', () => {
    assert.deepStrictEqual(received('echo $x'), [{ parts: [{ hole: { kind: 'parameter', name: 'x', code: '$x' }, splits: true, globs: true }], min: 0 }]);
    // (Not: another shell; braces not known; a word misread, one that assigns IFS or has `$!`; bash fails on it; an
    // IFS with a glob character; text split by an IFS not known.)
    assert.deepStrictEqual(['echo $x', 'if a; then set +B; fi; echo {a,b}$x', 'echo {,$x}a', 'echo ~\\\n/x', 'echo ${IFS=:}$x', 'echo $!', 'x=; echo ${x:?}', "IFS='*'; echo $x'*'", 'x=a; IFS=$v; echo $x$y']
      .map((s, i) => received(s, i === 0 ? 'sh' : 'bash')), Array(9).fill(undefined));
    // (Arithmetic may set IFS to digits: its value may split.)
    assert.deepStrictEqual(received('echo $((x))'), [{ parts: [{ hole: { kind: 'arithmetic', code: '$((x))' }, splits: true, globs: false }], min: 0 }]);
    // (Neither split nor globbed: a field that may be empty, at most one. An IFS of other than ASCII is not followed: the hole may split.)
    assert.strictEqual(argvShown(lines('set -f; IFS=; echo $x').at(-1)!.words), 'echo ‹value of `$x`›{0,1}');
    assert.deepStrictEqual(received('IFS=é; echo $x'), received('echo $x'));
    // (An assignment given to a declaration builtin: one word, the head and its value's field; not an array.)
    assert.deepStrictEqual(['e=; local x=$e', 'local x=', 'local x=$1', 'declare a=(1 2)'].map((s) => received(s)), [
      [{ parts: [{ text: 'x=' }], min: 1, max: 1 }], [{ parts: [{ text: 'x=' }], min: 1, max: 1 }],
      [{ parts: [{ text: 'x=' }, { hole: { kind: 'parameter', name: '1', code: '$1' }, splits: false, globs: false }], min: 1, max: 1 }], undefined,
    ]);
    // (Not split: one field.)
    assert.deepStrictEqual(received('IFS=; echo $x'), [{ parts: [{ hole: { kind: 'parameter', name: 'x', code: '$x' }, splits: false, globs: true }], min: 0 }]);
  });

  it('gives with holes the fields `wordFields` gives, wherever both know them, over the snippets (word-source.md, W-F1)', () => {
    // (`receivedFields` reads `wordFields` first, and `receivedWords` only where it does not know the fields: until step 6
    // of word-source.md folds the second into the first, they must agree where both answer.)
    let both = 0;
    const differ: string[] = [];
    for (const { text } of corpus().snippets) {
      const tree = parser.parse(text);
      const model = shellState(tree, 'bash');
      for (const c of descendants(tree.root, ['command'])) {
        const words = [...(field(c, 'name')?.namedChildren ?? []), ...fields(c, 'argument'), ...prefixAssignments(c).flatMap((a) => fields(a, 'value')),
          ...redirectionsOf(c).flatMap((r) => fields(r, 'destination'))];
        for (const w of words) {
          const known = wordFields(w, model).fields;
          const holed = known && receivedWords(w, model);
          if (!holed) continue;
          both++;
          // (One difference: `wordFields` reads `$"hi"` as its text, as bash does with no message catalog; `receivedWords`
          // keeps it a hole, a translation, which may be any text.)
          const exact = holed.every((f) => f.min === 1 && f.max === 1 && f.pattern === undefined && f.parts.every((p) => 'text' in p || p.hole.kind === 'translation'));
          const got = holed.map((f) => new RegExp(`^${f.parts.map((p) => ('text' in p ? p.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '.*')).join('')}$`, 's'));
          if (!exact || got.length !== known.length || got.some((r, i) => !r.test(known[i]))) differ.push(`${JSON.stringify(text)}: ${w.text} ${got.join(' ')} ${JSON.stringify(known)}`);
        }
      }
    }
    assert.deepStrictEqual(differ, []);
    assert.ok(both > 5000, `${both} words`);
    // (The entry point: the known fields, else the holed ones, and bash's error.)
    const tree = parser.parse('x=1; unset y; ls $x $z ${y:?}');
    const [, , ls] = descendants(tree.root, ['command']);
    assert.deepStrictEqual(fields(ls, 'argument').map((w) => receivedFields(w, shellState(tree, 'bash'))), [
      { fields: ['1'] }, { holed: [{ parts: [{ hole: { kind: 'parameter', name: 'z', code: '$z' }, splits: true, globs: true }], min: 0 }] },
      { error: 'parameter-null', failure: { kind: 'fatal', applies: true } },
    ]);
  });

  it('has a text for every placeholder and part bash takes out', () => {
    const texts = (lang: Lang) => [
      placeholderSaid(lang, { kind: 'parameter', name: '?', code: '$?' }), placeholderSaid(lang, { kind: 'parameter', name: 'x', code: '${x}' }),
      placeholderSaid(lang, { kind: 'tilde', user: '', code: '~' }), placeholderSaid(lang, { kind: 'string', code: "$'\\u00e9'" }),
      placeholderSaid(lang, { kind: 'word', code: 'a'.repeat(40) }),
      assignmentSaid(lang, 'stays', 'x', undefined), assignmentSaid(lang, 'maybe-stays', 'x', undefined), hereSaid(lang, 'herestring', ''),
    ];
    assert.deepStrictEqual(texts('en'), [
      'exit status of the last command', 'value of `${x}`', 'home directory', "what `$'\\u00e9'` gives", `the words of \`${'a'.repeat(29)}…\``,
      'Set `x`; it stays after the command, exported', 'Set `x`; in POSIX mode it stays after the command', 'Read stdin (fd 0) from the here-string',
    ]);
    assert.deepStrictEqual(texts('ja'), [
      '直前のコマンドの終了ステータス', '`${x}` の値', 'ホームディレクトリ', "`$'\\u00e9'` の結果", `\`${'a'.repeat(29)}…\` から得られる単語`,
      '`x` を設定する。コマンドの後も残り、エクスポートされる', '`x` を設定する。POSIX モードならコマンドの後も残る', '標準入力(fd 0)をヒアストリングから読む',
    ]);
    assert.strictEqual(argvOf(descendants(parser.parse('>f').root, ['command'])[0], shellState(parser.parse('>f'), 'bash'), 'en'), undefined);
  });
});
