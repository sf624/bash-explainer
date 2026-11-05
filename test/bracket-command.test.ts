// `[` is a command with arguments, of the same shape as `test`; `[[` is syntax. (CLAUDE.md, "Explanations": `[` is a
// command and `]` its last argument.) The tokens under the command are the same as `test`'s, apart from `]`, here for
// the two words beside each other, over the corpus, and against the status real bash gives.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { Token } from '../src/analyzer-types';
import { readingNodes } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { problemCodes } from '../src/linesentence';
import { descendants } from '../src/syntax/tree';
import { bracketWords, writtenAsBracket } from '../src/testexpr';
import { type ModelRow, rowModel } from '../src/ui/panelRows';
import { corpus } from './support/corpus';
import { run } from './support/run';

const parser = createUnbashParser();
const explain = (src: string, lang: 'en' | 'ja' = 'en', line = 0, shell?: 'dash' | 'zsh') => new Analyzer(lang).explainLine(parser.parse(src), line, shell, { sentence: true, argv: true, reading: true, script: 'said' })!;
const top = (src: string, lang: 'en' | 'ja' = 'en') => explain(src, lang).items[0];

/** A token as the panel reads it, without where it is: the place shifts with the length of the name. */
const shape = (t: Token): unknown => ({ kind: t.kind, label: t.label, text: t.explanation, refs: t.refs, children: t.children.map(shape) });
/** The tokens under a command `[`, without its last `]`. */
const underBracket = (t: Token): Token[] => {
  const last = t.children[t.children.length - 1];
  assert.strictEqual(last.label, ']');
  assert.strictEqual(last.kind, 'argument');
  return t.children.slice(0, -1);
};

describe('`[` is a command with arguments, as `test` is', () => {
  for (const lang of ['en', 'ja'] as const) {
    it(`has the tokens of \`test\` under it, and its \`]\` (${lang})`, () => {
      const bracket = top('[ -a file ]', lang);
      const test = top('test -a file', lang);
      assert.deepStrictEqual(
        [bracket.kind, bracket.label, bracket.frame, bracket.span.start.character, bracket.span.end.character, bracket.name?.said.kind],
        [test.kind, '[', test.frame, 0, 11, test.name?.said.kind],
      );
      assert.deepStrictEqual(underBracket(bracket).map(shape), test.children.map(shape));
      assert.deepStrictEqual(explain('[ -a file ]', lang).notes, explain('test -a file', lang).notes);
      const [arg, close] = bracket.children;
      assert.deepStrictEqual([arg.kind, arg.label, arg.span.start.character, arg.span.end.character], ['test', '-a file', 2, 9]);
      assert.deepStrictEqual([close.kind, close.label, close.span.start.character, close.span.end.character], ['argument', ']', 10, 11]);
      assert.strictEqual(close.explanation, lang === 'en' ? 'The last argument passed to `[`. `[` checks it to find the end of the expression (without it, an error)' : '`[` に渡す最後の引数。`[` はこれで式の終わりを確かめる（ないとエラー）');
    });

    it(`says once what it is, with the summary of a command (${lang})`, () => {
      const t = top('[ -a file ]', lang);
      assert.strictEqual(t.explanation, lang === 'en'
        ? 'Command `[` (an alias of `test`): evaluates the condition in its arguments and succeeds (0) if it is true. It is an ordinary command, not shell syntax, so `[` and `]` need spaces around them, and the arguments inside undergo word splitting and globbing (`[[ ]]` does not)'
        : 'コマンド `[`（`test` の別名）: 引数の条件を評価し、真なら成功(0)を返す。シェルの構文ではなく普通のコマンドなので、`[` と `]` の前後に空白が要り、中の引数には単語分割とグロブ展開がかかる（`[[ ]]` ならかからない）');
      assert.deepStrictEqual(t.children.filter((c) => c.label === '['), [], 'no row of the name under the command');
      // (The summary of the line, and so `--format json`'s `summary`, says the test as it did: `test` and the words.)
      assert.strictEqual(explain('[ -a file ]', lang).summary, lang === 'en' ? 'test [ -a file ]' : '条件判定 [ -a file ]');
    });
  }

  it('is said in "In short" as the test it is, not as a command that is run', () => {
    const said = (src: string, lang: 'en' | 'ja' = 'en', line = 0) => explain(src, lang, line).sentence;
    assert.strictEqual(said('[ -a file ]'), 'Tests the condition in `[ … ]`.');
    assert.strictEqual(said('[ -a file ]', 'ja'), '`[ … ]` の条件を判定する。');
    assert.strictEqual(said('[ -a file ] > o'), 'Tests the condition in `[ … ]`, with stdout (fd 1) to `o`.');
    assert.strictEqual(said('[ -f x ] && echo y'), 'Tests the condition in `[ … ]`; if that succeeds, runs `echo` (print arguments to stdout, separated by spaces).');
    assert.strictEqual(said('[ -f x ] && echo y', 'ja'), '`[ … ]` の条件を判定する。成功したら、`echo`（引数を空白区切りで標準出力に表示する）を実行する。');
    assert.strictEqual(said('if [ -a f ]; then :; fi'), 'If the test `[ … ]` succeeds, runs `:` (no-op that always succeeds; used in `while :` or to evaluate expansions).');
    // (A line that closes the block has no record of the command, which the name says.)
    assert.strictEqual(said('while [ -a f ]\ndo\n  :\ndone', 'en', 3), '`done` ends the `while` loop of line 1: repeats line 3 while the test `[ … ]` succeeds.');
    // (The other commands of the line keep what they were said with: `-p` of `mkdir`.)
    assert.ok(said('[ -d "$d" ] || mkdir -p "$d"')!.includes('`-p`'), said('[ -d "$d" ] || mkdir -p "$d"'));
  });

  it('is the connector of a pipeline with its words, as `test` is with its name', () => {
    const connector = (src: string, lang: 'en' | 'ja' = 'en') => {
      const all = (rs: ModelRow[]): ModelRow[] => rs.flatMap((r) => [r, ...all(r.children)]);
      return all(rowModel(explain(src, lang), { depth: 2, receives: false }, lang).rows).filter((r) => r.connector).map((r) => r.text);
    };
    assert.deepStrictEqual(connector('[ -f c ] | cat'), ['stdout of `[ -f c ]` → stdin of `cat`']);
    assert.deepStrictEqual(connector('[ -f c ] | [ -r d ]'), ['stdout of `[ -f c ]` → stdin of `[ -r d ]`']);
    assert.deepStrictEqual(connector('/usr/bin/[ a ] | cat'), ['stdout of `/usr/bin/[ a ]` → stdin of `cat`']);
    assert.deepStrictEqual(connector('[ -f c ] |& cat'), ['stdout and stderr of `[ -f c ]` → stdin of `cat`']);
    assert.deepStrictEqual(connector('[ -f c ] | cat', 'ja'), ['`[ -f c ]` の標準出力 → `cat` の標準入力']);
    assert.deepStrictEqual(connector('[ "$some_long_variable_name" = "another long value here" ] | cat'), ['stdout of `[ ‹expression› ]` → stdin of `cat`']);
    assert.deepStrictEqual(connector('test -f c | cat'), ['stdout of `test` → stdin of `cat`']);
  });

  it('says the word `[` by itself in the reading tree, as it did when the word had a token of its own', () => {
    const name = (src: string, line = 0) => readingNodes(explain(src, 'en', line).reading!).find((n) => n.kind === 'commandName' && n.label === '[')!;
    const builtin = name('[ -a file ]');
    assert.strictEqual(builtin.text, 'Command `[` (an alias of `test`)');
    assert.deepStrictEqual(builtin.refs, ['3.7.1', '3.7.2', '4.1']);
    assert.strictEqual(builtin.basis, undefined);
    assert.strictEqual(builtin.name?.runs, 'builtin');
    const program = name('enable -n [\n[ -f x ]', 1);
    assert.strictEqual(program.text, 'The program `[` (the same as `test`)');
    assert.strictEqual(program.basis, undefined);
  });

  it('receives its words as `test` does: the name, the words, `]`; the name is no chip of a builtin, and is one of a program', () => {
    for (const [src, words] of [['[ -a file ]', ['[', '-a', 'file', ']']], ['test -a file', ['test', '-a', 'file']]] as const) {
      const [line] = explain(src).argv!;
      assert.deepStrictEqual(line.words.map((w) => w.parts.map((p) => ('text' in p ? p.text : '')).join('')), words);
    }
    const chips = (src: string, line = 0) => rowModel(explain(src, 'en', line), { depth: 1, receives: true }, 'en').rows[0].receives!.chips.map((c) => c.parts.map((p) => ('text' in p ? p.text : '')).join(''));
    assert.deepStrictEqual(chips('[ -a file ]'), ['-a', 'file', ']']);
    assert.deepStrictEqual(chips('test -a file'), ['-a', 'file']);
    assert.deepStrictEqual(chips('/usr/bin/[ -a file ]'), ['/usr/bin/[', '-a', 'file', ']']);
    const argv = (src: string) => explain(src).argv?.length ?? 0;
    assert.strictEqual(argv('[[ -a file ]]'), 0, '`[[` is no command');
  });

  it('keeps `[[` as syntax: no program, no name, the condition below', () => {
    const t = top('[[ -a file ]]');
    assert.deepStrictEqual([t.kind, t.label, t.frame, t.name], ['test', '[[ -a file ]]', 'compound', undefined]);
    assert.ok(t.explanation.includes('shell syntax, not a command'), t.explanation);
    assert.strictEqual(explain('[[ -a file ]]').sentence, 'Tests the condition in `[[ … ]]`.');
    assert.strictEqual(explain('[[ -a file ]]').summary, 'test [[ -a file ]]');
    assert.deepStrictEqual(t.children.filter((c) => c.kind === 'test').map((c) => c.label), ['-a file']);
  });

  it('cites the builtin and the conditional expressions, and so does a program `[`', () => {
    assert.deepStrictEqual(top('[ -a file ]').refs, ['4.1', '6.4']);
    // (Words not known: no condition is explained, and the command still says it evaluates one.)
    assert.deepStrictEqual(top('[ "$@" ]').refs, ['4.1', '6.4']);
    const program = explain('enable -n [\n[ -f x ]', 'en', 1).items[0];
    assert.deepStrictEqual([program.kind, program.label, program.refs], ['command', '[', ['3.7.2', '6.4']]);
  });

  it('keeps the problems attached to `[`', () => {
    const codes = (src: string, shell?: 'dash' | 'zsh') => [...problemCodes(explain(src, 'en', 0, shell))];
    const has = (src: string, code: string, shell?: 'dash' | 'zsh') => assert.ok(codes(src, shell).includes(code), `${src}: ${codes(src, shell).join(', ')}`);
    has('[ -f x', 'bracket-missing-close');
    has('[ -f x]', 'bracket-close-glued');
    has('[ $a = b ]', 'unquoted-variable-in-test');
    has('[ a == b ]', 'eqeqTest', 'dash');
    const glued = explain('[ -f x]');
    assert.strictEqual(glued.items[0].kind, 'builtin');
    assert.deepStrictEqual(glued.items[0].children.map((c) => c.label), ['-f', 'x]']);
  });

  it('is the one command row wherever it is written', () => {
    const inner = (src: string, line = 0): Token => {
      const find = (t: Token): Token | undefined => (t.label === '[' ? t : t.children.map(find).find(Boolean));
      return explain(src, 'en', line).items.map(find).find(Boolean)!;
    };
    for (const src of ['if ! [ -f x ]; then :; fi', 'time [ -f x ]', '! [ -f x ]', '[ -f x ] && echo y', 'a=1 [ -f x ]', '[ -f x ] >o', 'x=$([ -f x ] && echo y)']) {
      const t = inner(src);
      assert.deepStrictEqual([t?.kind, t?.label, t?.children.filter((c) => c.kind === 'test').map((c) => c.label)], ['builtin', '[', ['-f x']], src);
    }
    // (By another spelling, the row is that word's; by a wrapper's name, the wrapper's row has it.)
    for (const [src, label] of [['\\[ -f x ]', '\\['], ['"[" -f x ]', '"["']]) {
      const t = top(src);
      assert.deepStrictEqual([t.kind, t.label, t.children.some((c) => c.kind === 'test' && c.label === '-f x')], ['builtin', label, true], src);
    }
    for (const src of ['command [ -f x ]', 'builtin [ -f x ]', 'sudo [ -f x ]', 'env [ -f x ]']) {
      const named = top(src).children.find((c) => c.label === '[')!;
      assert.ok(named.children.some((c) => c.kind === 'test' && c.label === '-f x'), src);
      assert.strictEqual(named.children[named.children.length - 1].label, ']', src);
    }
    // (A function or an alias of that name is a plain call: no condition is read.)
    const fn = explain('[() { :; }\n[ -f x ]', 'en', 1).items[0];
    assert.deepStrictEqual([fn.kind, fn.label, fn.children.some((c) => c.kind === 'test')], ['function', '[', false]);
    const empty = top('[ ]');
    assert.deepStrictEqual([empty.kind, empty.label, empty.children.map((c) => c.label)], ['builtin', '[', [']']]);
    const multi = explain('[ a \\\n  = b ]').items[0];
    assert.deepStrictEqual([multi.kind, multi.label, multi.children.map((c) => c.kind)], ['builtin', '[', ['test', 'argument']]);
    const or = top('[ \\( a = b \\) -o c = d ]');
    assert.deepStrictEqual(or.children.map((c) => [c.kind, c.label]), [['test', '\\( a = b \\) -o c = d'], ['argument', ']']]);
  });

  it('has the same shape in dash and in zsh, where only the text differs', () => {
    for (const shell of ['dash', 'zsh'] as const) {
      const t = explain('[ -a file ]', 'en', 0, shell).items[0];
      assert.deepStrictEqual([t.kind, t.label, t.children.map((c) => c.label)], ['builtin', '[', ['-a file', ']']], shell);
    }
    assert.ok(explain('[ -a file ]', 'en', 0, 'zsh').items[0].explanation.includes('an unquoted variable that is empty is dropped'));
  });

  it('has the same shape in the shell parts of a Makefile, a Dockerfile and a workflow', () => {
    for (const [name, src, line] of [
      ['Makefile', 'all:\n\t[ -f x ]\n', 1],
      ['Dockerfile', 'FROM a\nRUN [ -f x ]\n', 1],
      ['.github/workflows/ci.yml', 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "[ -f x ]"\n', 5],
    ] as const) {
      const extracted = extractShell(hostKind('', name, src)!, src);
      const t = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, src.split('\n'), line, 'en')!.items[0];
      assert.deepStrictEqual([t.kind, t.label, t.children.map((c) => [c.kind, c.label])], ['builtin', '[', [['test', '-f x'], ['argument', ']']]], name);
    }
  });

  it('has the rows of `test` at depth 1 and depth 2, with its receives line', () => {
    const rowsOf = (src: string, depth: 1 | 2) => {
      const flat = (r: ModelRow, d = 0): unknown[] => [[d, r.kind, r.label, !!r.receives, r.frame, r.refs, r.roleLine?.chips.map((c) => c.text).join(' ').replace(/`\[`|\[(?= )/g, 'name').replace(/`test`|\btest\b/g, 'name')], ...r.children.flatMap((c) => flat(c, d + 1))];
      return rowModel(explain(src), { depth, receives: true }, 'en').rows.flatMap((r) => flat(r));
    };
    for (const depth of [1, 2] as const) {
      const closes = (rows: unknown[]) => rows.filter((r) => (r as unknown[])[2] !== ']');
      // (The name, and the conditional expressions that `[` cites on its row: the rest is the same.)
      const named = (rows: unknown[]) => rows.map((r, i) => (i ? r : [...(r as unknown[]).slice(0, 2), 'name', ...(r as unknown[]).slice(3, 5), ...(r as unknown[]).slice(6)]));
      const bracket = rowsOf('[ -a file ]', depth);
      assert.deepStrictEqual((bracket[0] as unknown[]).slice(0, 5), [0, 'builtin', '[', true, 'command']);
      assert.ok(bracket.some((r) => (r as unknown[])[0] === 1 && (r as unknown[])[2] === ']'), `depth ${depth}: the row of \`]\` is under the command`);
      assert.deepStrictEqual(named(closes(bracket)), named(rowsOf('test -a file', depth)), `depth ${depth}`);
    }
  });

  it('has no more text on its top row at depth 2 than `test` has: the reading of the word `[` repeats the row\'s own text', () => {
    for (const lang of ['en', 'ja'] as const) {
      for (const src of ['[ -f c ]', '/usr/bin/[ -f c ]', 'enable -n [\n[ -f c ]']) {
        const rows = rowModel(explain(src, lang, src.split('\n').length - 1), { depth: 2, receives: false }, lang).rows;
        const row = rows[0];
        assert.ok(row.label.endsWith('['), `${lang} ${src}`);
        assert.deepStrictEqual(row.more, [], `${lang} ${src}`);
      }
    }
  });
});

describe('`[ X ]` and `test X` over the corpus', () => {
  it('read the same tokens under the command, apart from the name, `]` and the text on it', function () {
    this.timeout(60000);
    const { files, snippets } = corpus();
    const seen = new Set<string>();
    for (const { text } of [...files, ...snippets]) {
      if (!text.includes('[')) continue;
      for (const c of descendants(parser.parse(text).root, ['command'])) {
        if (!writtenAsBracket(c) || c.text.includes('\n')) continue;
        const { close, words } = bracketWords(c);
        if (!close) continue;
        seen.add(words.length ? text.slice(words[0].startIndex, words[words.length - 1].endIndex) : '');
      }
    }
    assert.ok(seen.size > 100, `only ${seen.size} words`);
    const differ: string[] = [];
    for (const x of seen) {
      const a = top(`[ ${x} ]`);
      const b = top(`test ${x}`);
      if (a.kind !== b.kind || a.frame !== b.frame || JSON.stringify(underBracket(a).map(shape)) !== JSON.stringify(b.children.map(shape))) differ.push(x);
    }
    assert.deepStrictEqual(differ, []);
  });

  it('give the same status in bash, on what they say of the condition', () => {
    const table = ['-a file', '-a none', '-f file', '-d .', '! -f file', 'a = a', 'a = b', 'a != b', '-n a', '-z a', '1 -lt 2', '1 -gt 2', 'a', '', '-f file -a -d .', '-f none -o -d .',
      '\\( a = a \\) -a b = b', '! a = b', 'a b', '1 -lt x'];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bracket-'));
    try {
      fs.writeFileSync(path.join(dir, 'file'), '');
      // (One process: `[ X ]` and `test X` of each row, one status on a line.)
      const script = table.map((x) => `[ ${x} ] 2>/dev/null; echo $?; test ${x} 2>/dev/null; echo $?`).join('\n');
      const out = run('bash', ['-c', script], { cwd: dir, check: true }).stdout.toString().trim().split('\n');
      table.forEach((x, i) => assert.strictEqual(out[2 * i], out[2 * i + 1], x));
      // The explanation reads a condition where bash reads one, and plain words where it fails: for both alike.
      table.forEach((x, i) => {
        const conditions = (t: Token) => t.children.some((c) => c.kind === 'test');
        assert.strictEqual(conditions(top(`[ ${x} ]`)), conditions(top(`test ${x}`)), x);
        // (Status 2: bash cannot read the words, and no condition is explained.)
        if (out[2 * i] === '2' && x !== '1 -lt x') assert.strictEqual(conditions(top(`[ ${x} ]`)), false, x);
      });
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});
