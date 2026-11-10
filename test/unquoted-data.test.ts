// An unquoted expansion whose value the model knows and bash globs or splits, in a word a command reads as data (grep's
// pattern, sed's script): its role says that a file name that matches takes its place (`onlyGlobbed`,
// src/semantics/globwords.ts; src/argv/profiletexts.ts), the note and the value row say that bash also reads it as a glob pattern before the command gets it (where a note says so, the role does not again), and a caveat suggests
// quoting it (`unquoted-value-as-data`, src/wordfacts.ts). Compared with bash: the words grep gets where no file
// matches, where one does, and with nullglob, all in one bash process; the model's fields with those files must be
// bash's.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { onlyGlobbed } from '../src/semantics/globwords';
import { shellState } from '../src/semantics/state';
import { wordFields } from '../src/semantics/words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, type SyntaxNode } from '../src/syntax/tree';
import { runContained } from './support/contained';
import { allTokens, explain } from './support/explain';
import { Analyzer, type LineExplanation, type Token } from '../src/analyzer';

const parser = createUnbashParser();
const VALUE = '^[A-Z]{3}-[0-9]+$';
/** A file whose name the value matches as a glob pattern: `^`, a capital, `{3}-`, a digit, `+$`. */
const MATCH = '^A{3}-1+$';
const SET = `pattern='${VALUE}'`;

/** The word `$pattern` of the grep of the script `src`, and the model of the script. */
function patternWord(src: string): { word: SyntaxNode; model: ReturnType<typeof shellState> } {
  const tree = parser.parse(src);
  const grep = descendants(tree.root, ['command']).find((c) => field(c, 'name')?.text === 'grep')!;
  const word = grep.namedChildren.find((c) => c.field === 'argument' && c.text.includes('pattern'))!;
  return { word, model: shellState(tree, 'bash') };
}

/** The token of the argument `w` of a line's explanation. */
const argOf = (e: LineExplanation, w: string): Token => allTokens(e.items).find((t) => t.kind === 'argument' && t.label === w)!;

describe('an unquoted known value that globs, read as data (`grep -E $pattern`)', () => {
  // (Each case: the shell options set before, the files of the directory, and the words grep gets, as bash gives them.)
  const cases = [
    { name: 'no file matches', before: '', files: ['ids.txt'] },
    { name: 'a file matches', before: '', files: ['ids.txt', MATCH] },
    { name: 'nullglob', before: 'shopt -s nullglob; ', files: ['ids.txt'] },
  ];
  let seen: string[][] = [];
  before(async function () {
    this.timeout(30000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unquoted-data-'));
    try {
      // (One process: each case in a directory of its own, printing the words and grep's status.)
      const script = cases.map((c, i) => [
        `mkdir c${i}; cd c${i}; printf 'ABC-12\\nabc\\n' > ids.txt; ${c.files.filter((f) => f !== 'ids.txt').map((f) => `: > '${f}'; `).join('')}`,
        `( ${c.before}${SET}; words() { printf '<%s>' "$@"; echo; }; words \${pattern} ids.txt; grep -E \${pattern} ids.txt > /dev/null < /dev/null; echo "status $?" ); cd ..`,
      ].join('')).join('\n');
      const r = await runContained(['bash', '--norc', '--noprofile', '-c', script], dir);
      const lines = r.stdout.trim().split('\n');
      seen = cases.map((_, i) => [lines[2 * i], lines[2 * i + 1]]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bash gives grep the value where no file matches, the file name where one does, and nothing with nullglob', () => {
    assert.deepStrictEqual(seen, [
      [`<${VALUE}><ids.txt>`, 'status 0'],
      [`<${MATCH}><ids.txt>`, 'status 1'],
      // (grep then reads `ids.txt` as its pattern, and its stdin.)
      ['<ids.txt>', 'status 1'],
    ]);
  });

  it('the model gives the fields bash gives with those files, and says that only a glob makes the word other than one', () => {
    cases.forEach((c, i) => {
      const { word, model } = patternWord(`${c.before}${SET}\ngrep -E \${pattern} ids.txt\n`);
      assert.strictEqual(onlyGlobbed(word, model), true, c.name);
      const fields = wordFields(word, model, { files: c.files }).fields;
      assert.strictEqual(fields && `${fields.map((f) => `<${f}>`).join('')}<ids.txt>`, seen[i][0], c.name);
    });
  });

  // (The glob is said once, in the note and on the value line, as what bash does before grep gets the value: docs/design/known-values.md, 12.)
  it('says that bash also reads the value as a glob pattern before grep gets it, once: the note and the value line (en, ja)', () => {
    for (const w of ['${pattern}', '$pattern']) {
      const src = `${SET}\ngrep -E ${w} ids.txt\n`;
      const en = explain(src, 1, 'en');
      const arg = argOf(en, w);
      assert.strictEqual(arg.explanation, 'search pattern (regex) — extended regex (ERE)');
      assert.match(JSON.stringify(arg), /Unquoted, bash also reads it as a glob pattern \(its `\[A-Z\]`, `\[0-9\]`\) before `grep` gets it, and matches it against file names/);
      assert.deepStrictEqual(en.notes.filter((n) => n.includes('unquoted-value-as-data') || n.includes('is not quoted')), [
        `ⓘ Caveat: \`${w}\` is not quoted, so its value \`${VALUE}\` may not reach the command as it is: bash also reads it as a glob pattern (its \`[A-Z]\`, \`[0-9]\`) before \`grep\` gets it, and a file name that matches it takes its place. To pass the value as it is, write \`"${w}"\``,
      ]);
      const ja = explain(src, 1, 'ja');
      const argJa = argOf(ja, w);
      assert.strictEqual(argJa.explanation, '検索パターン（正規表現） — 拡張正規表現(ERE)');
      assert.match(JSON.stringify(argJa), /bash は `grep` に渡す前に値をグロブのパターンとしても読み（`\[A-Z\]`・`\[0-9\]`）/);
      assert.deepStrictEqual(ja.notes.filter((n) => n.includes('クォートしていない')), [
        `ⓘ 注意: \`${w}\` をクォートしていないので、値 \`${VALUE}\` はそのままコマンドに渡るとは限らない。bash は \`grep\` に渡す前に値をグロブのパターンとしても読み（\`[A-Z]\`・\`[0-9]\`）、一致するファイルがあるとその名前に置き換わる。値をそのまま渡すには \`"${w}"\` と書く`,
      ]);
    }
  });

  it('without a file operand: the note says the glob, and the row does not again', () => {
    const en = explain(`${SET}\ngrep -E $pattern\n`, 1, 'en');
    const arg = argOf(en, '$pattern');
    assert.doesNotMatch(arg.explanation, /is a glob pattern/);
    assert.ok(en.notes.some((n) => n.includes('may not reach the command as it is')));
  });

  it('keeps the glob on the row where no note says it: the notes on pitfalls off', () => {
    const tree = parser.parse(`${SET}\ngrep -E $pattern ids.txt\n`);
    const e = new Analyzer('en').explainLine(tree, 1, 'bash', { pitfalls: false });
    assert.match(argOf(e, '$pattern').explanation, /unquoted, `\$pattern` is a glob pattern, so a file name that matches it takes its place/);
  });

  it('says nothing more for "$pattern", nor for a value with no glob or split characters', () => {
    for (const [src, w] of [[`${SET}\ngrep -E "$pattern" ids.txt\n`, '"$pattern"'], ["pattern='^ab+$'\ngrep -E $pattern ids.txt\n", '$pattern']]) {
      for (const lang of ['en', 'ja'] as const) {
        const e = explain(src, 1, lang);
        const arg = argOf(e, w);
        assert.strictEqual(arg.explanation, lang === 'en' ? 'search pattern (regex) — extended regex (ERE)' : '検索パターン（正規表現） — 拡張正規表現(ERE)', src);
        assert.ok(!e.notes.some((n) => /is not quoted|クォートしていないので/.test(n)), src);
      }
    }
  });

  it('names the expansion in a word with other parts, reads a subcommand, and gives no rewrite where quotes would change the value', () => {
    const notes = (src: string): string[] => explain(src, 1, 'en').notes.filter((n) => n.includes('is not quoted'));
    assert.deepStrictEqual(notes("r='^x*$'\nsed -n /$r/p f\n"), ['ⓘ Caveat: `$r` is not quoted, so its value `^x*$` may not reach the command as it is: bash also reads it as a glob pattern (its `*`) before `sed` gets it, and a file name that matches it takes its place. To pass the value as it is, write `"/$r/p"`']);
    assert.deepStrictEqual(notes("q='//app/...:*'\nbazel query $q\n"), ['ⓘ Caveat: `$q` is not quoted, so its value `//app/...:*` may not reach the command as it is: bash also reads it as a glob pattern (its `*`) before `bazel` gets it, and a file name that matches it takes its place. To pass the value as it is, write `"$q"`']);
    assert.deepStrictEqual(notes("p='a*'\ngrep ${p:-'x y'} f\n"), ["ⓘ Caveat: `${p:-'x y'}` is not quoted, so its value `a*` may not reach the command as it is: bash also reads it as a glob pattern (its `*`) before `grep` gets it, and a file name that matches it takes its place"]);
    assert.deepStrictEqual(notes("p='a* b'\ngrep $p f\n"), ['ⓘ Caveat: `$p` is not quoted, so its value `a* b` does not reach the command as it is: it is split into 2 arguments, and is a glob pattern too (a file name that matches takes its place). To pass the value as it is, write `"$p"`']);
    assert.deepStrictEqual(notes("p=abc\nsed -n /$p/p f\n"), []);
    // (A value the model does not know: a pattern meant, often.)
    assert.deepStrictEqual(notes('x=1\ngrep $1 f\n'), []);
    // (A file name has its own note: `cat $p` is not data.)
    assert.deepStrictEqual(explain("p='a*'\ncat $p\n", 1, 'en').notes.filter((n) => n.includes('may not reach')), []);
  });

  it('only a word of one known field that globs is said to give other words only by the file names it matches', () => {
    const at = (src: string): boolean => {
      const tree = parser.parse(src);
      const grep = descendants(tree.root, ['command']).find((c) => field(c, 'name')?.text === 'grep')!;
      return onlyGlobbed(grep.namedChildren.filter((c) => c.field === 'argument').at(-1)!, shellState(tree, 'bash'));
    };
    assert.strictEqual(at("p='a*'\ngrep $p\n"), true);
    assert.strictEqual(at('grep [a-z]+\n'), true);
    assert.strictEqual(at('grep "$d"/*.c\n'), true);
    assert.strictEqual(at("p='a*'\ngrep \"$p\"\n"), false, 'quoted');
    assert.strictEqual(at("set -f; p='a*'\ngrep $p\n"), false, 'noglob');
    assert.strictEqual(at("p='a b*'\ngrep $p\n"), false, 'split: another field');
    assert.strictEqual(at('grep {a,b}*\n'), false, 'two words of its braces');
    assert.strictEqual(at('grep $d/*.c\n'), false, 'may be split');
    assert.strictEqual(at('grep abc\n'), false, 'no pattern');
    assert.strictEqual(at('[ -t 0 ] && set +B\ngrep {a,b}*\n'), false, 'braces not known');
    // (Not a word: the command's name.)
    const tree = parser.parse('grep a\n');
    assert.strictEqual(onlyGlobbed(descendants(tree.root, ['command'])[0], shellState(tree, 'bash')), false);
  });

  it('a value that word splitting splits, read as a sed script, is said too', () => {
    const e = explain("s='s/a b/c/'\nsed $s f\n", 1, 'en');
    assert.ok(e.notes.includes('ⓘ Caveat: `$s` is not quoted, so its value `s/a b/c/` does not reach the command as it is: it is split into 2 arguments. To pass the value as it is, write `"$s"`'), e.notes.join('\n'));
  });
});
