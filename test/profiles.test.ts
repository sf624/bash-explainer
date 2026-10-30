// What a word is for every count of the words that may give other than one (src/argv/profiles.ts and
// src/argv/profiletexts.ts, docs/design/count-hedges.md step 3): its profiles by place or by own count, the classes, the
// conditions that say them and the text they fold into; the texts of the cases of section 2.6 in English and Japanese;
// and, over the corpus of the tests, that every clause is sound and the clauses complete, checked on the counts.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { type ArgWord } from '../src/argv/interpret';
import { CLAUSES, CONDITIONS, roleKey, wordReadings, type Atom, type Depends, type Place, type Profile, type Role, type WordReadings } from '../src/argv/profiles';
import { baseText, clauseText, conditionText, dependsText, foldedText, readingsText, type Names } from '../src/argv/profiletexts';
import { readingsOf, type ReadingsTable } from '../src/argv/readings';
import type { CommandSpec } from '../src/argv/spec';
import { argWord } from '../src/argv/words';
import { lookupCommand } from '../src/dict/aliases';
import { tx, type Text } from '../src/i18n';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, type SyntaxNode } from '../src/syntax/tree';
import { argWords } from './support/argwords';

const parser = createUnbashParser();
const ctxOf = (name: string) => ({ name, lookup: lookupCommand });

/** The table of the first command of `line`, and the source texts of its words. */
function table(line: string, ctx: object = {}): ReadingsTable & { texts: string[] } {
  const { name, words, texts } = argWords(line);
  return { ...readingsOf(lookupCommand(name)!, words, { ...ctxOf(name), ...ctx }), texts };
}

/**
 * The names of the tests (the explanation names roles from step 4 on): an operand's text, a value, an option, each "of"
 * the command's word that names the command reading it (`Role.by`).
 */
function namesOf(texts: readonly string[]): Names {
  const word = (k: number): string => `\`${texts[k]}\``;
  const own = ({ role: r }: Role): Text => {
    if (r.role === 'operand') return r.spec ? r.spec.text : tx('引数', 'argument');
    if (r.role === 'value') return Array.isArray(r.option?.value) && !r.index ? tx(`\`${r.of}\` の名前`, `name for \`${r.of}\``) : tx(`\`${r.of}\` の値`, `value for \`${r.of}\``);
    if (r.role === 'command') return r.item ? r.item.text : tx('コマンド', 'command');
    return 'flag' in r ? tx(`\`${r.flag}\` オプション`, `option \`${r.flag}\``) : tx(r.role, r.role);
  };
  const role = (r: Role): Text => {
    const t = own(r);
    if (!r.by.length) return t;
    const by = r.by.at(-1) === undefined ? tx('コマンド', 'the command') : tx(word(r.by.at(-1)!), word(r.by.at(-1)!));
    return tx(`${by.ja} の${/^`/.test(t.ja) ? ' ' : ''}${t.ja}`, `${t.en} of ${by.en}`);
  };
  return { word, role };
}

/** What a word of `line` says, in both languages; `k` its text (the first word with it). */
function says(line: string, word: string): Text {
  const t = table(line);
  const k = t.texts.indexOf(word);
  const r = wordReadings(t, k)!;
  return r.kind === 'depends' ? dependsText(r, namesOf(t.texts)) : readingsText(r, k, namesOf(t.texts));
}
const read = (t: ReadingsTable & { texts: string[] }, word: string): WordReadings => wordReadings(t, t.texts.indexOf(word)) as WordReadings;
const keys = (roles: readonly Role[] | undefined): string[] | undefined => roles?.map((r) => r.key.replace('\0', ' | '));

describe('profiles: what a word is for every count (count-hedges.md, step 3)', function () {
  this.timeout(120000);

  it('profiles by place: the role of each of its words, the same for every own count that has it', () => {
    const t = table('jq --arg $n $v .');
    const v = read(t, '$v');
    assert.deepStrictEqual(v.contexts, Array.from({ length: 7 }, (_, n) => [n, 0]));
    assert.deepStrictEqual(v.places, [{ words: [1], one: true, counted: true, values: Array.from({ length: 7 }, (_, n) => (n === 6 ? { n, orMore: true } : { n })) }]);
    assert.deepStrictEqual(keys(v.base.places), [' | value --arg 1', ' | operand jq filter (e.g. `.items[].name`)', ...Array(4).fill(' | operand input JSON file')]);
    assert.deepStrictEqual([v.base.counts, v.base.orMore], [[1, 2, 3, 4, 5, 6], true]);
    assert.deepStrictEqual(v.clauses.map((c) => [c.conditions, keys(c.profile.places)!.slice(0, 2)]), [
      [[[{ place: 0, from: 0, to: 0 }]], [' | value --arg 0', ' | value --arg 1']],
      [[[{ place: 0, from: 2, to: 2 }]], [' | operand jq filter (e.g. `.items[].name`)', ' | operand input JSON file']],
      [[[{ place: 0, from: 3 }]], [' | operand input JSON file', ' | operand input JSON file']],
    ]);
    // (A word of one word: one role, at each context of the run, capped.)
    const dot = read(t, '.');
    assert.deepStrictEqual(dot.places, [{ words: [1, 2], one: false, counted: true, values: Array.from({ length: 7 }, (_, n) => (n === 6 ? { n, orMore: true } : { n })) }]);
    assert.deepStrictEqual(dot.profiles.map((p) => p.entries[0].outcome), ['refused', 'read', 'read', 'read', 'read', 'read', 'read']);
  });

  it('profiles by own count: a place whose role depends on how many words the word gives (`cp $a`, `cp $b $a`)', () => {
    const a = read(table('cp $a'), '$a');
    assert.strictEqual(a.base.places, undefined);
    assert.deepStrictEqual(a.base.groups.map((g) => [g.from, g.to, g.orMore, keys(g.roles)]), [
      [1, 1, undefined, [' | operand source']], [2, 2, undefined, [' | operand source', ' | operand destination (the new name, or an existing directory)']], [3, 7, true, [' | operand source', ' | operand destination directory']],
    ]);
    assert.deepStrictEqual(a.clauses, []);
    const b = read(table('cp $b $a'), '$b');
    assert.deepStrictEqual(b.clauses.map((c) => [c.conditions, c.profile.groups.length]), [[[[{ place: 0, from: 0, to: 0 }]], 3]]);
  });

  it('classes and conditions: sound, the base class said first, the contexts refused no class', () => {
    // (`jq --arg $n $v .`, of `.`: 0 refused, 1 the value, 2 the filter as written, 3 or more a file.)
    const dot = read(table('jq --arg $n $v .'), '.');
    assert.deepStrictEqual(dot.clauses.map((c) => [c.conditions, keys(c.profile.places)]), [
      [[[{ place: 0, from: 1, to: 1 }]], [' | value --arg 1']], [[[{ place: 0, from: 3 }]], [' | operand input JSON file']],
    ]);
    // (Two atoms of two places: `$b` empty and `$a` a word or more.)
    const f = read(table('cut -d $a -f $b f'), 'f');
    assert.deepStrictEqual(f.clauses.map((c) => c.conditions), [[[{ place: 0, from: 1 }, { place: 1, from: 0, to: 0 }]]]);
    // (A clause may hold where every count is refused: `v` is the name with `$n` empty, `$f` empty or not; jq refuses
    // `jq --arg v`.)
    assert.deepStrictEqual(read(table('jq --arg $n v $f'), 'v').clauses[0].conditions, [[{ place: 0, from: 0, to: 0 }]]);
    // (The base as written refused: `jq --arg $n` with `$n` one word lacks the value. Its roles are still the ones said, and the other
    // readings are told from them: `--arg` is the option in all of them, so no clause. The reading itself stays refused.)
    const arg = read(table('jq --arg $n'), '--arg');
    assert.deepStrictEqual([keys(arg.base.entries[0].roles), arg.base.groups.length, arg.clauses], [[' | option --arg'], 1, []]);
    assert.strictEqual(table('jq --arg $n').reading(table('jq --arg $n').shapes!.find((s) => s.join() === '1')!).outcome, 'refused');
    // (A refused written reading and the readings that run: `sudo -u $u -Z ls y` with `$u` one word is refused by sudo, but `y` is
    // said as written; the reading with several words is a clause of its own, and none says "a word or more", which includes the refused one.)
    const y = read(table('sudo -u $u -Z ls y'), 'y');
    assert.deepStrictEqual(y.clauses.map((c) => c.conditions), [[[{ place: 0, from: 2 }]]]);
    assert.strictEqual(y.profiles[y.contexts.findIndex((c) => c[0] === 1)].entries.length, 1);
    assert.deepStrictEqual(read(table('kill -s $sig -Z 1'), '1').clauses, []);
    // (One profile under two conditions is one clause: `x` with `$d` empty or of several words is a word `git` reads.)
    const x = read(table('git -C $d log -n $b x'), 'x');
    assert.deepStrictEqual(x.clauses.map((c) => c.conditions), [[[{ place: 0, from: 0, to: 0 }], [{ place: 0, from: 2 }]], [[{ place: 0, from: 1, to: 1 }, { place: 1, from: 0, to: 0 }]]]);
    assert.deepStrictEqual([CLAUSES, CONDITIONS], [4, 2]);
  });

  it('folded: past the budget, or a class that no two conditions of two atoms say', () => {
    // (`cp $a $b $a d`, of `d`: its other roles, a source and the new name, folded into one text.)
    const x = read(table('cp $a $b $a d'), 'd');
    assert.deepStrictEqual(x.clauses, []);
    assert.deepStrictEqual([keys(x.folded!.roles), x.folded!.words], [[' | operand source', ' | operand destination (the new name, or an existing directory)'], [0, 1]]);
    // (Four clauses at most: `cmp $a $b x $c`, of `x`, has four.)
    assert.strictEqual(read(table('cmp $a $b x $c'), 'x').clauses.length, 4);
    // (Five: a spec whose last operand is P1 to P6 by how many there are. The word's own count is named too.)
    const item = (n: number) => ({ name: `P${n}`, text: tx(`P${n}`, `P${n}`) });
    const spec: CommandSpec = { summary: tx('', ''), operands: [1, 2, 3, 4, 5, 6].map((n) => ({ pattern: Array.from({ length: n }, (_, i) => item(i + 1)) })) };
    const five = readingsOf(spec, argWords('p $a x').words, {});
    const folded = wordReadings(five, 1) as WordReadings;
    assert.deepStrictEqual([folded.clauses, keys(folded.folded!.roles), folded.folded!.words], [[], [' | operand P1', ' | operand P3', ' | operand P4', ' | operand P5', ' | operand P6'], [0]]);
    const own = wordReadings(readingsOf(spec, argWords('p $a $b').words, {}), 1) as WordReadings;
    assert.deepStrictEqual(own.folded?.words, [0, 1]);
    // (A class no two conditions say: the last `x` of `p $a x $b x $c x` is P3 only where all three give none.)
    const three = readingsOf(spec, argWords('p $a x $b x $c x').words, {});
    const last = wordReadings(three, 5) as WordReadings;
    assert.deepStrictEqual([last.clauses, keys(last.folded!.roles)], [[], [' | operand P3', ' | operand P4', ' | operand P5']]);
  });

  it('names: each variable once; a sum that holds one twice says only "nothing" and "a word or more"', () => {
    const d = read(table('cp $a $b $a d'), 'd');
    assert.deepStrictEqual(d.places.map((p) => [p.words, p.one, p.counted]), [[[0, 1], false, false]]);
    assert.deepStrictEqual(d.folded?.words, [0, 1]);
    const c = read(table('cp $a $b $a c d'), 'c');
    assert.ok(c.clauses.every((x) => x.conditions.flat().every((a) => (a.from === 0 && a.to === 0) || (a.from === 1 && a.to === undefined))));
  });

  it('depends: past the cap, or where the matcher gave up, a word whose role may depend on the counts says only that', () => {
    const big = table('cp -r $a $b $c x $d y $e');
    assert.deepStrictEqual(wordReadings(big, 0), undefined);
    assert.deepStrictEqual(wordReadings(big, 4), { kind: 'depends', words: [1, 2, 3, 5, 7] });
    assert.deepStrictEqual(wordReadings(table('cp $a b', { maxSteps: 1 }), 1), { kind: 'depends', words: [0] });
    // (A word in parts: nothing where every word of every shape has one role, `echo {1..$n}`; that its role
    // may depend on the counts where a shape is refused or another role, `cp -v*$x`, or where no shape is read, `cp -v*$x -*`.)
    assert.deepStrictEqual(['echo {1..$n}', 'cp -v*$x', 'cp -v*$x -*', 'cp {1..$n} x'].map((l) => wordReadings(table(l), 0)?.kind), [undefined, 'depends', 'depends', 'depends']);
  });

  it('roles: told apart by the command words that read them, as `sameRole` keys them', () => {
    // (`nice $a -n 5 ls`: with `$a` one word, `-n` is read by the command `$a` runs; empty, nice's own.)
    const n = read(table('nice $a -n 5 ls'), '-n');
    assert.deepStrictEqual([keys(n.base.places), keys(n.clauses[0].profile.places)], [['>0 | unknown-option -n'], [' | option -n']]);
    assert.deepStrictEqual(n.base.places![0].by, [0]);
    assert.deepStrictEqual(keys(read(table('sudo -u $u tar -cf x y'), 'x').base.places), ['>2 | value -f 0']);
    assert.deepStrictEqual(keys(read(table('git log -n $b x'), 'x').base.places), ['>0 | operand ']);
    // (`timeout $a 5 sleep x` with `$a` one word: `5` is the command, and `x` its word; with two, the second of `$a`.)
    const x = read(table('timeout $a 5 sleep x'), 'x');
    assert.deepStrictEqual([keys(x.base.places), x.clauses.map((c) => keys(c.profile.places))], [['>1 | operand '], [['>2 | operand duration in seconds (`1m`, `0.5`… also allowed)'], ['>0 | operand ']]]);
    // (A word of a run of two names a command no word of the shape tells: `>?`.)
    assert.deepStrictEqual(keys(read(table('nice $a $b x'), 'x').base.places), ['>? | operand ']);
    // (A shell string, a command run that fills no operand: `su -c ls`.)
    assert.deepStrictEqual(keys(read(table('su -c ls $a'), 'ls').base.places), [' | command shell-string ']);
    // (Letters, and a role of no flag.)
    assert.strictEqual(roleKey({ role: 'cluster', letters: [{ role: 'unknown-option', flag: 'x' }, { role: 'end-of-options' }] }), 'cluster unknown-option x end-of-options ');
    assert.strictEqual(roleKey({ role: 'joined' }), 'joined ');
  });

  it('a word whose fields the model knows: its words in a row, each read at every context', () => {
    const known = (...fields: string[]): ArgWord => ({ prefix: '', count: { min: 0 }, fields: () => fields });
    const t = readingsOf(lookupCommand('cp')!, [known('-r', 'a'), { prefix: '', count: { min: 0 } }, { value: 'd' }], ctxOf('cp'));
    const r = wordReadings(t, 0) as WordReadings;
    assert.deepStrictEqual([r.base.counts, keys(r.base.places)], [[2], [' | option -r', ' | operand source']]);
    assert.deepStrictEqual(baseText(r.base, 0, namesOf(['$x', '$a', 'd'])), { ja: '順に `-r` オプション・コピー元', en: 'its words are option `-r`, then source' });
  });

  describe('the texts of the cases of section 2.6', () => {
    const CASES: [string, string, string, string][] = [
      ['jq --arg $n $v .', '.', 'jq filter (e.g. `.items[].name`). When `$n` and `$v` expand to one word in all, it is value for `--arg`. When `$n` and `$v` expand to 3 words or more in all, it is input JSON file', 'jq フィルタ（例: `.items[].name`）。`$n`・`$v` が合わせて1語なら `--arg` の値。`$n`・`$v` が合わせて3語以上なら入力 JSON ファイル'],
      ['jq --arg $n $v .', '$v', 'value for `--arg`; when `$v` expands to several words, this is the role of the first word `$v` gives, and the others are jq filter (e.g. `.items[].name`), then input JSON file. When `$n` expands to nothing, its words are name for `--arg`, value for `--arg`, jq filter (e.g. `.items[].name`), then input JSON file. When `$n` expands to 2 words, its words are jq filter (e.g. `.items[].name`), then input JSON file. When `$n` expands to 3 words or more, it is input JSON file', '`--arg` の値。`$v` が2語以上に展開されるときは、その最初の語がこの役割で、残りの語は順に jq フィルタ（例: `.items[].name`）・入力 JSON ファイル。`$n` が0語なら順に `--arg` の名前・`--arg` の値・jq フィルタ（例: `.items[].name`）・入力 JSON ファイル。`$n` が2語なら順に jq フィルタ（例: `.items[].name`）・入力 JSON ファイル。`$n` が3語以上なら入力 JSON ファイル'],
      ['jq --arg $n v $f', '$f', 'jq filter (e.g. `.items[].name`); when `$f` expands to several words, this is the role of the first word `$f` gives, and each of the others is input JSON file. When `$n` expands to nothing, its words are value for `--arg`, jq filter (e.g. `.items[].name`), then input JSON file. When `$n` expands to several words, it is input JSON file', 'jq フィルタ（例: `.items[].name`）。`$f` が2語以上に展開されるときは、その最初の語がこの役割で、残りの各語は入力 JSON ファイル。`$n` が0語なら順に `--arg` の値・jq フィルタ（例: `.items[].name`）・入力 JSON ファイル。`$n` が2語以上なら入力 JSON ファイル'],
      ['jq --arg $n v $f', 'v', 'value for `--arg`. When `$n` expands to nothing, it is name for `--arg`. When `$n` expands to 2 words, it is jq filter (e.g. `.items[].name`). When `$n` expands to 3 words or more, it is input JSON file', '`--arg` の値。`$n` が0語なら `--arg` の名前。`$n` が2語なら jq フィルタ（例: `.items[].name`）。`$n` が3語以上なら入力 JSON ファイル'],
      ['cut -d $a -f $b f', 'f', 'target file. When `$a` expands to a word or more and `$b` to nothing, it is value for `-f`', '対象のファイル。`$a` が1語以上で `$b` が0語なら `-f` の値'],
      ['cp -t $d $a b', 'b', 'source. When `$d` and `$a` expand to nothing, it is value for `-t`', 'コピー元。`$d`・`$a` が0語なら `-t` の値'],
      ['grep -e $p -- -v f', '-v', 'file to search (default: stdin). When `$p` expands to nothing, it is option `-v`', '検索対象のファイル（省略時は標準入力）。`$p` が0語なら `-v` オプション'],
      ['tr $a -d', '-d', 'target character set (e.g. `A-Z`). When `$a` expands to nothing, it is option `-d`. When `$a` expands to several words, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 1, doing nothing)', '変換先の文字集合（例: `A-Z`）。`$a` が0語なら `-d` オプション。`$a` が2語以上なら余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 1 で終わる）'],
      ['getconf $a -a', '-a', 'path (print the value for its file system). When `$a` expands to nothing, it is option `-a`. When `$a` expands to several words, it is extra operand, which the command refuses (it prints `Usage: getconf …` and exits with status 2, doing nothing)', 'パス（そこにあるファイルシステムでの値を表示する）。`$a` が0語なら `-a` オプション。`$a` が2語以上なら余分なオペランド（コマンドは受け付けず、`Usage: getconf …` と表示して何もせずに終了ステータス 2 で終わる）'],
      ['echo $a -n x', '-n', 'text to print. When `$a` expands to nothing, it is option `-n`', '表示する文字列。`$a` が0語なら `-n` オプション'],
      ['/usr/bin/echo $a --version', '--version', 'text to print. When `$a` expands to nothing, it is option `--version`', '表示する文字列。`$a` が0語なら `--version` オプション'],
      ['nice $a -n 5 ls', 'ls', 'argument of `$a`. When `$a` expands to nothing, it is command to run', '`$a` の引数。`$a` が0語なら実行するコマンド'],
      ['timeout $a 5 sleep x', 'x', 'argument of `5`. When `$a` expands to nothing, it is duration in seconds (`1m`, `0.5`… also allowed) of `sleep`. When `$a` expands to several words, it is argument of `$a`', '`5` の引数。`$a` が0語なら `sleep` の待つ時間（秒。`1m`, `0.5` なども可）。`$a` が2語以上なら `$a` の引数'],
      ['cp $a', '$a', 'source when `$a` expands to a single word; when it expands to 2 words, they are source, then destination (the new name, or an existing directory); when it expands to more words, they are source, then destination directory', '`$a` が1語に展開されるならコピー元、2語なら順にコピー元・コピー先（新しい名前、または既存のディレクトリ）、3語以上なら順にコピー元・コピー先のディレクトリ'],
      ['cp $b $a', '$b', 'source. When `$a` expands to nothing: source when `$b` expands to a single word; when it expands to 2 words, they are source, then destination (the new name, or an existing directory); when it expands to more words, they are source, then destination directory', 'コピー元。`$a` が0語のときは、`$b` が1語に展開されるならコピー元、2語なら順にコピー元・コピー先（新しい名前、または既存のディレクトリ）、3語以上なら順にコピー元・コピー先のディレクトリ'],
      ['seq $a x $b', 'x', 'increment. When `$a` expands to nothing and `$b` to nothing, it is last (counting from 1). When `$a` expands to nothing and `$b` to a word or more, it is first. When `$a` expands to 2 words, or when `$a` expands to a single word and `$b` to nothing, it is last. When `$a` expands to 3 words or more, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 1, doing nothing)', '増分。`$a` が0語で `$b` が0語なら終了値（開始値は 1）。`$a` が0語で `$b` が1語以上なら開始値。`$a` が2語、または `$a` が1語で `$b` が0語なら終了値。`$a` が3語以上なら余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 1 で終わる）'],
      ['cp $a $b $a d', 'd', 'destination directory. It can also be source or destination (the new name, or an existing directory), by how many words `$a` and `$b` give', 'コピー先のディレクトリ。`$a`・`$b` が展開される語数により、コピー元・コピー先（新しい名前、または既存のディレクトリ）のどちらかにもなる'],
      // (Every reading reads `--arg` as the option, those jq refuses too: nothing to hedge.)
      ['jq --arg $n', '--arg', 'option `--arg`', '`--arg` オプション'],
      ['cp -r $a $b $c x $d y $e', 'x', 'its role may depend on how many words `$a`, `$b`, `$c`, `$d` and `$e` give', '`$a`・`$b`・`$c`・`$d`・`$e` が展開される語数により役割が変わりうる'],
    ];
    for (const [line, word, en, ja] of CASES) {
      it(`${line}, of ${word}`, () => {
        const text = says(line, word);
        assert.deepStrictEqual([text.en, text.ja], [en, ja]);
      });
    }
    it('(the cases, written out)', function () {
      if (!process.env.PROFILES_GEN) this.skip();
      const lines = fs.readFileSync(process.env.PROFILES_GEN!, 'utf8').trim().split('\n').map((l) => l.split('\t'));
      console.log(JSON.stringify(lines.map(([line, word]) => [line, word, says(line, word).en, says(line, word).ja])));
    });

    it('the phrases of the atoms, of one word and of a sum, and of the own counts', () => {
      const names = namesOf(['$a', '$b', '$c']);
      const one: Place = { words: [0], one: true, counted: true, values: [] };
      const sum: Place = { words: [0, 1, 2], one: false, counted: true, values: [] };
      const say = (place: Place, atom: Omit<Atom, 'place'>): string => conditionText([place], [{ place: 0, ...atom }], names).en;
      assert.deepStrictEqual([{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 3, to: 3 }, { from: 1 }, { from: 2 }, { from: 3 }].map((a) => say(one, a)), [
        '`$a` expands to nothing', '`$a` expands to a single word', '`$a` expands to 3 words', '`$a` expands to a word or more', '`$a` expands to several words', '`$a` expands to 3 words or more',
      ]);
      assert.deepStrictEqual([{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 2, to: 2 }, { from: 1 }, { from: 2 }].map((a) => say(sum, a)), [
        '`$a`, `$b` and `$c` expand to nothing', '`$a`, `$b` and `$c` expand to one word in all', '`$a`, `$b` and `$c` expand to 2 words in all', '`$a`, `$b` and `$c` expand to a word or more in all', '`$a`, `$b` and `$c` expand to 2 words or more in all',
      ]);
      assert.deepStrictEqual(conditionText([sum, one], [{ place: 0, from: 2, to: 2 }, { place: 1, from: 1 }], names), { ja: '`$a`・`$b`・`$c` が合わせて2語で `$a` が1語以上', en: '`$a`, `$b` and `$c` expand to 2 words in all and `$a` to a word or more' });
      assert.deepStrictEqual(conditionText([one, sum], [{ place: 0, from: 0, to: 0 }, { place: 1, from: 0, to: 0 }], names), { ja: '`$a` が0語で `$a`・`$b`・`$c` が0語', en: '`$a` expands to nothing and `$a`, `$b` and `$c` to nothing' });
      // (Own counts: a group of several counts, one that starts past 1, and "4 words or more" where the count before is refused.)
      const r = (role: string): Role => ({ key: role, by: [], role: { role: 'operand', index: 0, spec: { name: role, text: tx(role, role) } } });
      const p = (groups: Profile['groups']): Profile => ({ key: '', counts: [1, 2, 3, 4], entries: [], groups, orMore: true });
      assert.strictEqual(baseText(p([{ from: 1, to: 3, roles: [r('A')] }, { from: 4, to: 4, orMore: true, roles: [r('A'), r('B')] }]), 0, names).en, 'when `$a` expands to 1 to 3 words, they are A; when it expands to more words, they are A, then B');
      assert.strictEqual(baseText(p([{ from: 2, to: 2, roles: [r('A'), r('B')] }, { from: 4, to: 4, orMore: true, roles: [r('B')] }]), 0, names).ja, '`$a` が2語に展開されるなら順に A・B、4語以上なら順に B');
      assert.strictEqual(baseText(p([{ from: 2, to: 2, roles: [r('A'), r('B')] }, { from: 4, to: 4, orMore: true, roles: [r('B')] }]), 0, names).en, 'when `$a` expands to 2 words, they are A, then B; when it expands to 4 words or more, they are B');
      const clause = { profile: p([{ from: 2, to: 3, roles: [r('A')] }]), conditions: [[{ place: 0, from: 0, to: 0 }]] };
      assert.deepStrictEqual(clauseText({ places: [one] } as WordReadings, clause, 1, names), { ja: '`$a` が0語のときは、`$b` が2〜3語に展開されるなら順に A', en: 'when `$a` expands to nothing: when `$b` expands to 2 to 3 words, they are A' });
      assert.deepStrictEqual(foldedText({ roles: [r('A')], words: [1] }, names), { ja: '`$b` が展開される語数により、Aにもなる', en: 'it can also be A, by how many words `$b` gives' });
      assert.deepStrictEqual(foldedText({ roles: [r('A'), r('B')], words: [0, 1] }, names), { ja: '`$a`・`$b` が展開される語数により、A・Bのどちらかにもなる', en: 'it can also be A or B, by how many words `$a` and `$b` give' });
      assert.deepStrictEqual(dependsText({ kind: 'depends', words: [2] } as Depends, names).en, 'its role may depend on how many words `$c` gives');
    });
  });

  describe('over the corpus of the tests (test/fixtures/snippets.json)', function () {
    /** Every command with a spec and a word that may give other than one word, its words as `argWord` reads them. */
    const tables: { text: string; t: ReadingsTable }[] = [];
    before(() => {
      const snippets: string[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'snippets.json'), 'utf8'));
      for (const s of snippets) {
        for (const c of descendants(parser.parse(s).root, ['command'])) {
          const nameNode = field(c, 'name');
          const spec: CommandSpec | undefined = nameNode ? lookupCommand(nameNode.text) : undefined;
          if (!spec) continue;
          const args = c.namedChildren.filter((x: SyntaxNode) => x !== nameNode && !x.type.endsWith('redirect') && x.startIndex > nameNode!.startIndex);
          const t = readingsOf(spec, args.map(argWord), ctxOf(nameNode!.text));
          if (t.variables.length) tables.push({ text: c.text, t });
        }
      }
    });

    /** The count vectors with each variable from its fewest to its top: all of them, or past `most`, that many spread over them. */
    function vectors(t: ReadingsTable, most: number): number[][] {
      const sizes = t.variables.map((v) => v.top - v.min + 1);
      const all = sizes.reduce((n, s) => n * s, 1);
      const vector = (i: number): number[] => t.variables.map((v, j) => {
        const c = v.min + (i % sizes[j]);
        i = Math.floor(i / sizes[j]);
        return c;
      });
      return Array.from({ length: Math.min(all, most) }, (_, i) => vector(all <= most ? i : Math.floor((i * all) / most)));
    }

    it('every clause is sound and the clauses complete, on the counts; the cost', () => {
      const start = performance.now();
      const wrong: string[] = [];
      let [words, withClauses, clauses, conditions, folded, parted] = [0, 0, 0, 0, 0, 0];
      for (const { text, t } of tables) {
        for (let k = 0; k < t.back(t.line.length - 1) + 1; k++) {
          const r = wordReadings(t, k);
          // (A word in parts says only that its role may depend on the counts (`cp -v{a,b}$x`), or nothing where every word of
          // every shape has one role (`echo {1..$n}`); past the cap, every word whose role may.)
          if (!t.shapes) {
            assert.strictEqual(r?.kind ?? 'depends', 'depends');
            continue;
          }
          if (t.parted[k]) {
            assert.ok(!r || r.kind === 'depends', `${text}: word ${k}`);
            parted++;
            continue;
          }
          assert.ok(r && r.kind === 'read', `${text}: word ${k}`);
          words++;
          withClauses += r.clauses.length ? 1 : 0;
          clauses += r.clauses.length;
          conditions += r.clauses.reduce((n, c) => n + c.conditions.length, 0);
          folded += r.folded ? 1 : 0;
          assert.ok(r.clauses.length <= CLAUSES && r.clauses.every((c) => c.conditions.length <= CONDITIONS && c.conditions.every((x) => x.length >= 1 && x.length <= 2)));
          // (What each place sums, read on the counts, not on the contexts: the words of each variable, or of all.)
          const cx = t.contexts(k)!;
          const named = cx.coordinates.filter((c) => c.mult.size);
          const holdsAt = (a: Atom, counts: readonly number[]): boolean => {
            const c = named[a.place];
            const n = c.mult.size === 1 ? counts[[...c.mult.keys()][0]] : [...c.mult].reduce((s, [v, m]) => s + m * counts[v], 0);
            return n >= a.from && (a.to === undefined || n <= a.to);
          };
          const profileAt = new Map(r.contexts.map((c, i) => [c.join(), r.profiles[i]]));
          for (const counts of vectors(t, 4096)) {
            const values = cx.coordinates.map((c) => c.fixed + [...c.mult].reduce((n, [v, m]) => n + m * counts[v], 0));
            if (values.some((v, i) => v > cx.coordinates[i].top)) continue;
            const p = profileAt.get(values.join())!;
            const refused = !p.entries.some((e) => e.roles);
            const met = r.clauses.filter((c) => c.conditions.some((x) => x.every((a) => holdsAt(a, counts))));
            if (!refused && met.some((c) => c.profile.key !== p.key)) wrong.push(`${text}: word ${k} at ${counts.join(',')}: unsound`);
            const said = p.key === r.base.key || refused || met.length > 0
              || (r.folded && p.entries.every((e) => (e.roles ?? []).every((x) => r.folded!.roles.some((y) => y.key === x.key))));
            if (!said) wrong.push(`${text}: word ${k} at ${counts.join(',')}: not said`);
          }
        }
      }
      const ms = performance.now() - start;
      if (process.env.READINGS_STATS) console.log(JSON.stringify({ commands: tables.length, words, withClauses, clauses, conditions, folded, parted, ms: Math.round(ms) }));
      assert.deepStrictEqual(wrong, []);
      assert.ok(words > 400 && withClauses > 10, `${words} ${withClauses}`);
    });
  });
});
