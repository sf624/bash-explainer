// bazel's command lines (src/dict/bazel.ts, the parser preset `bazel`): the startup options, the command, its options with
// their `--no` negation, the target patterns and the program's arguments of `bazel run`. What bazel reads of the words
// is compared with a record of bazel 9.3.2 in test/parsers-real.test.ts; these are the explanations.
import * as assert from 'assert';
import { Analyzer, Token } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import { PARSERS } from '../src/argv/parsers';
import type { CommandSpec } from '../src/argv/spec';
import type { BashParser } from '../src/syntax/tree';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { argWords } from './support/argwords';

let parser: BashParser;
before(() => {
  parser = createUnbashParser();
});

function tokens(src: string, lang: 'en' | 'ja'): Token[] {
  const out: Token[] = [];
  const walk = (t: Token) => (out.push(t), t.children.forEach(walk));
  new Analyzer(lang).explainLine(parser.parse(src), 0).items.forEach(walk);
  return out;
}
/** The words after `bazel`, each with its text (the shell's note on a subcommand left out). */
const parts = (src: string, lang: 'en' | 'ja' = 'en'): string[] => tokens(src, lang).slice(1).filter((t) => t.kind !== 'string')
  .map((t) => `${t.label}: ${t.explanation.replace(/ \(to the shell it is an argument.*$|（シェルから見れば.*$/, '')}`);

const TARGET = 'target pattern (`//app:main`, `//app/...`, or after `--` one that takes targets out, `-//app/legacy/...`)';
const TARGET_JA = 'ターゲットのパターン（`//app:main`、`//app/...`、`--` の後なら除くもの `-//app/legacy/...`）';

describe('bazel command lines', () => {
  it('a build of every target', () => {
    assert.deepStrictEqual(parts('bazel build //...'), ['build: Subcommand `bazel build`: Build the targets', `//...: ${TARGET}`]);
    assert.deepStrictEqual(parts('bazel build //...', 'ja'), ['build: サブコマンド `bazel build`: ターゲットをビルドする', `//...: ${TARGET_JA}`]);
  });

  it('options after the command, `--config` from the rc files, and a subtractive pattern after `--`', () => {
    const line = 'bazel test --config=ci -k //app/... -- -//app/legacy/...';
    const en = parts(line);
    assert.match(en[1], /^--config=ci: Use a group of settings of the rc files .*so those options are not shown.*"Config value '…' is not defined in any \.rc file" \(value: `ci`\)$/);
    assert.deepStrictEqual([en[0], ...en.slice(2)], [
      'test: Subcommand `bazel test`: Build the targets and run the tests', '-k: go on as far as possible after an error', `//app/...: ${TARGET}`,
      '--: End of options: everything after is a plain argument', `-//app/legacy/...: ${TARGET}`,
    ]);
    const ja = parts(line, 'ja');
    assert.match(ja[1], /^--config=ci: rc ファイル（`\.bazelrc` など）の設定の組を使う。.*どのオプションになるかは示せない。/);
    assert.deepStrictEqual(ja[2], '-k: エラーがあっても、できるところまでビルドを続ける');
    assert.deepStrictEqual(ja.at(-1), `-//app/legacy/...: ${TARGET_JA}`);
  });

  it('the program\'s arguments of `bazel run`', () => {
    assert.deepStrictEqual(parts('bazel run //tools:fmt -- --check'), [
      'run: Subcommand `bazel run`: Build the target and run it (the words after the target are its arguments)', '//tools:fmt: target to run (`//tools:fmt`)',
      '--: End of options: everything after is a plain argument', '--check: argument passed to the program (write words that start with `-` after `--`)',
    ]);
    // (Without `--`, a word after the target is an argument too, and one that starts with `-` an option of bazel.)
    assert.deepStrictEqual(parts('bazel run //tools:fmt a -k').slice(2), ['a: argument passed to the program (write words that start with `-` after `--`)', '-k: go on as far as possible after an error']);
    assert.deepStrictEqual(parts('bazel run //tools:fmt -- --check', 'ja').at(-1), '--check: プログラムに渡す引数（`-` で始まる語は `--` の後に書く）');
  });

  it('a startup option before the command, and a short option with its value', () => {
    assert.deepStrictEqual(parts('bazel --output_base=/tmp/x build -c opt //app:main'), [
      '--output_base=/tmp/x: where the outputs go (the build outputs and the server\'s state; another value starts another server) (value: `/tmp/x`)',
      'build: Subcommand `bazel build`: Build the targets', '-c: compilation mode (`fastbuild`, the default; `dbg`; `opt`)', 'opt: Value for `-c`', `//app:main: ${TARGET}`,
    ]);
    assert.deepStrictEqual(parts('bazel --output_base=/tmp/x build -c opt //app:main', 'ja').slice(2, 4), ['-c: コンパイルのモード（`fastbuild`（既定）、`dbg`、`opt`）', 'opt: `-c` オプションの値']);
  });

  it('a query expression', () => {
    assert.deepStrictEqual(parts('bazel query \'deps(//app:main)\''), [
      'query: Subcommand `bazel query`: Query the target dependency graph', '\'deps(//app:main)\': query expression (`deps(//app:main)`, the words joined with spaces into one)',
    ]);
    assert.deepStrictEqual(parts('bazel query --output=label_kind \'deps(//x)\'', 'ja')[1], '--output=label_kind: 結果の形式（`label`（既定）、`label_kind`、`package`、`build`、`graph`、`xml`…）（値: `label_kind`）');
  });

  it('a boolean turned off by `--no` and by `-x-`', () => {
    assert.deepStrictEqual(parts('bazel build --nostamp //x').slice(1, 2), ['--nostamp: Turns `--stamp` off (`--stamp` is "stamp binaries with the date, user and workspace information")']);
    assert.deepStrictEqual(parts('bazel build --nostamp //x', 'ja').slice(1, 2), ['--nostamp: `--stamp` を無効にする（`--stamp` は「バイナリーに日時・ユーザー・ワークスペースの情報を埋め込む」）']);
    assert.match(parts('bazel test -t- //x')[1], /^-t-: Turns `-t` off \(`-t` is "whether to use cached test results/);
    // (`=false`, `=no`, `=0` turn a boolean off too; a tri-state's values say what each does.)
    assert.deepStrictEqual(parts('bazel build --keep_going=false //x')[1], '--keep_going=false: Turns `--keep_going` off (`--keep_going` is "go on as far as possible after an error") (value: `false`)');
    assert.deepStrictEqual(parts('bazel build --keep_going=1 //x')[1], '--keep_going=1: go on as far as possible after an error (value: `1`)');
    assert.match(parts('bazel test --cache_test_results=no //x')[1], /^--cache_test_results=no: whether to use cached test results .*\(value: `no` — run the tests every time\)$/);
    assert.match(parts('bazel test --cache_test_results=auto //x', 'ja')[1], /^--cache_test_results=auto: テストの結果をキャッシュから使うかどうか.*（値: `auto` — テストかその依存が変わったときなどだけ実行し直す（既定））$/);
    assert.match(parts('bazel --nohome_rc version')[0], /^--nohome_rc: Turns `--home_rc` off/);
    // (`no` before an option that takes a value is no negation: bazel refuses `--nocompilation_mode`.)
    assert.deepStrictEqual(parts('bazel build --nocompilation_mode //x')[1], '--nocompilation_mode: Option (not in the dictionary; see `bazel help build`)');
    assert.match(parts('bazel build --no_keep_going //x')[1], /^--no_keep_going: Option \(not in the dictionary/);
  });

  it('options in the wrong place, which bazel refuses', () => {
    const before = tokens('bazel --keep_going build //x', 'en').find((t) => t.label === '--keep_going')!;
    assert.match(before.explanation, /^go on as far as possible after an error; but as an option of the command, before the command bazel stops with "Unknown startup option" \(status 2\)\. Write it after the command$/);
    assert.ok(before.marks?.length, 'a warning');
    assert.match(parts('bazel build --output_base=/tmp/x //x')[1], /^--output_base=\/tmp\/x: where the outputs go .*; but as a startup option, after the command bazel stops with "Unrecognized option" \(status 2\)\. Write it between `bazel` and the command \(value: `\/tmp\/x`\)$/);
    assert.match(parts('bazel build //x -//y', 'ja')[2], /^-\/\/y: `-` で始まる、除くターゲットのパターン。`--` より前では bazel はオプションとして読み、「Invalid options syntax」で止まる/);
    assert.match(parts('bazel -c opt build //x', 'ja')[0], /^-c: コンパイルのモード.*。ただし、コマンドのオプションなので、コマンドより前に書くと bazel は「Unknown startup option」で止まる/);
  });

  it('`--version` and `--help` alone, and where to find the options not listed', () => {
    assert.deepStrictEqual(parts('bazel --version'), ['--version: print the version']);
    assert.deepStrictEqual(parts('bazel --help', 'ja'), ['--help: コマンドの一覧と使い方を表示する']);
    assert.deepStrictEqual(parts('bazel --version build')[0], '--version: Option (not in the dictionary; see `bazel help startup_options`)');
    assert.deepStrictEqual(parts('bazel query --frob x', 'ja')[1], '--frob: オプション（辞書に未登録。`bazel help query` を参照）');
  });

  it('the keys of `bazel info` and the queries of `bazel mod`', () => {
    assert.deepStrictEqual(parts('bazel info bazel-bin output_base').slice(1), ['bazel-bin: the directory of the binaries (per configuration)', 'output_base: the output base (`--output_base`)']);
    assert.deepStrictEqual(parts('bazel mod graph --depth 1').slice(1, 2), ['graph: show the whole graph of external dependencies']);
  });
});

describe('the parser preset `bazel`', () => {
  const spec: CommandSpec = {
    summary: { ja: 'p', en: 'p' }, parser: 'bazel', options: [
      { names: ['-k', '--keep_going'], text: { ja: 'k', en: 'k' } },
      { names: ['-c', '--compilation_mode'], text: { ja: 'c', en: 'c' }, value: { name: 'MODE' } },
      { names: ['-t', '--cache_test_results'], text: { ja: 't', en: 't' }, value: { name: 'V', how: 'attached-only', optional: true } },
    ],
  };
  const read = (line: string): string[] => {
    const { words } = argWords(line);
    return interpret(spec, words).roles.map(({ word, role }) => `${words[word].value}=${role.role === 'option' ? (role.negated ? `off:${role.negated}` : 'on') : role.role}`);
  };
  it('negates a boolean by `--no` before its long name or `-` after its letter, and nothing else', () => {
    assert.deepStrictEqual(read('p --nokeep_going -k- -k --keep_going'), ['--nokeep_going=off:--keep_going', '-k-=off:-k', '-k=on', '--keep_going=on']);
    assert.deepStrictEqual(read('p --nocompilation_mode -c- --no_keep_going'), ['--nocompilation_mode=unknown-option', '-c-=unknown-option', '--no_keep_going=unknown-option']);
    // (`=false`, `=no` and `=0` turn a boolean off; an option with an optional value is negated by `no`, and its values are its own.)
    assert.deepStrictEqual(read('p --keep_going=false --keep_going=no --keep_going=0 --keep_going=yes'), ['--keep_going=false=off:--keep_going', '--keep_going=no=off:--keep_going', '--keep_going=0=off:--keep_going', '--keep_going=yes=on']);
    assert.deepStrictEqual(read('p --nocache_test_results -t- --cache_test_results=no -t'), ['--nocache_test_results=off:--cache_test_results', '-t-=off:-t', '--cache_test_results=no=on', '-t=on']);
  });
  it('reads no clusters and no attached short values, options after operands, and `--`', () => {
    assert.deepStrictEqual(read('p -copt -c=opt -kc opt'), ['-copt=unknown-option', '-c=opt=unknown-option', '-kc=unknown-option', 'opt=operand']);
    assert.deepStrictEqual(read('p //x -c opt -- -//y -k'), ['//x=operand', '-c=on', 'opt=value', '--=end-of-options', '-//y=operand', '-k=operand']);
    assert.ok(PARSERS.bazel.negation && !PARSERS.git.negation);
  });
});
