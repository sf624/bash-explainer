// bazel's command lines (src/dict/bazel.ts, the parser preset `bazel`): the startup options, the command, its options with
// their `--no` negation, the target patterns and the program's arguments of `bazel run`. What bazel reads of the words
// is compared with a record of bazel 9.3.2 in test/parsers-real.test.ts; these are the explanations.
import * as assert from 'assert';
import { Analyzer, Token } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import { PARSERS } from '../src/argv/parsers';
import type { CommandSpec } from '../src/argv/spec';
import { parseTargetPattern } from '../src/embedded/bazel';
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
const parts = (src: string, lang: 'en' | 'ja' = 'en'): string[] => new Analyzer(lang).explainLine(parser.parse(src), 0).items[0].children.filter((t) => t.kind !== 'string')
  .map((t) => `${t.label}: ${t.explanation.replace(/ \(to the shell it is an argument.*$|（シェルから見れば.*$/, '')}`);
/** The parts of the target pattern `word` (the tokens of its reader), each with its text. */
const pieces = (src: string, word: string, lang: 'en' | 'ja' = 'en'): string[] => {
  const t = tokens(src, lang).find((x) => x.label === word && x.kind === 'argument')!;
  const inner = t.children[0]?.kind === 'string' && t.children[0].label === word && /^['"]/.test(word) ? t.children[0].children : t.children;
  return inner.map((x) => `${x.label}: ${x.explanation}`);
};

const TARGET = 'target pattern';
const TARGET_JA = 'ターゲットのパターン';
const MANUAL = 'without the targets tagged `manual` (`tags = ["manual"]`), which only a pattern that names them takes';
const MANUAL_JA = '`tags = ["manual"]` のターゲットは含まない（名前で指定したときだけ対象になる）';

describe('bazel command lines', () => {
  it('a build of every target', () => {
    assert.deepStrictEqual(parts('bazel build //...'), ['build: Subcommand `bazel build`: Build the targets', `//...: ${TARGET} — Every rule of every package of the repository; ${MANUAL}`]);
    assert.deepStrictEqual(parts('bazel build //...', 'ja'), ['build: サブコマンド `bazel build`: ターゲットをビルドする', `//...: ${TARGET_JA} — リポジトリのすべてのパッケージのすべてのルール。${MANUAL_JA}`]);
    assert.deepStrictEqual(pieces('bazel build //...', '//...'), ['//: The top of the repository', '...: Every package in this directory and below it']);
  });

  it('options after the command, `--config` from the rc files, and a subtractive pattern after `--`', () => {
    const line = 'bazel test --config=ci -k //app/... -- -//app/legacy/...';
    const en = parts(line);
    assert.match(en[1], /^--config=ci: Use a group of settings of the rc files .*so those options are not shown.*"Config value '…' is not defined in any \.rc file" \(value: `ci`\)$/);
    assert.deepStrictEqual([en[0], ...en.slice(2)], [
      'test: Subcommand `bazel test`: Build the targets and run the tests', '-k: go on as far as possible after an error',
      `//app/...: ${TARGET} — Every rule of the packages in the directory \`app\` and below; ${MANUAL}`,
      '--: End of options: everything after is a plain argument', `-//app/legacy/...: ${TARGET} — Takes every rule of the packages in the directory \`app/legacy\` and below out of the targets of the patterns before it`,
    ]);
    assert.deepStrictEqual(pieces(line, '-//app/legacy/...'), [
      '-: Subtractive: takes the targets of this pattern out of those the patterns before it gave (the order counts)',
      '//app/legacy: The directory `app/legacy`, from the top of the repository', '/...: Every package in this directory and below it',
    ]);
    const ja = parts(line, 'ja');
    assert.match(ja[1], /^--config=ci: rc ファイル（`\.bazelrc` など）の設定の組を使う。.*どのオプションになるかは示せない。/);
    assert.deepStrictEqual(ja[2], '-k: エラーがあっても、できるところまでビルドを続ける');
    assert.deepStrictEqual(ja.at(-1), `-//app/legacy/...: ${TARGET_JA} — ディレクトリ \`app/legacy\` とその下のパッケージのすべてのルールを、前のパターンのターゲットから除く`);
  });

  it('the program\'s arguments of `bazel run`', () => {
    assert.deepStrictEqual(parts('bazel run //tools:fmt -- --check'), [
      'run: Subcommand `bazel run`: Build the target and run it (the words after the target are its arguments)', '//tools:fmt: target to run (`//tools:fmt`, a pattern that gives only one target) — One target, `//tools:fmt`',
      '--: End of options: everything after is a plain argument', '--check: argument passed to the program (write words that start with `-` after `--`)',
    ]);
    // (Without `--`, a word after the target is an argument too, and one that starts with `-` an option of bazel.)
    assert.deepStrictEqual(parts('bazel run //tools:fmt a -k').slice(2), ['a: argument passed to the program (write words that start with `-` after `--`)', '-k: go on as far as possible after an error']);
    assert.deepStrictEqual(parts('bazel run //tools:fmt -- --check', 'ja').at(-1), '--check: プログラムに渡す引数（`-` で始まる語は `--` の後に書く）');
  });

  it('a startup option before the command, and a short option with its value', () => {
    assert.deepStrictEqual(parts('bazel --output_base=/tmp/x build -c opt //app:main'), [
      '--output_base=/tmp/x: where the outputs go (the build outputs and the server\'s state; another value starts another server) (value: `/tmp/x`)',
      'build: Subcommand `bazel build`: Build the targets', '-c: compilation mode (`fastbuild`, the default; `dbg`; `opt`)', 'opt: Value for `-c`', `//app:main: ${TARGET} — One target, \`//app:main\``,
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

// What each target pattern selects (src/embedded/bazel.ts); test/bazel-patterns.test.ts checks the reading with what bazel
// 9.3.2 takes of each form in the fixture workspace.
describe('bazel target patterns', () => {
  /** What the line says of each pattern, after the operand's text. */
  const notes = (src: string, lang: 'en' | 'ja' = 'en'): string[] => new Analyzer(lang).explainLine(parser.parse(src), 0).items[0].children.filter((t) => t.kind === 'argument')
    .map((t) => t.explanation.replace(/^(target pattern|ターゲットのパターン|query expression \(.*?one\)|クエリ式（.*?になる）)( — )?/, ''));

  it('a target, a package\'s target, and the wildcards of a package', () => {
    assert.deepStrictEqual(notes('bazel build //app:main //app //app:all \'//app:*\' //app:all-targets'), [
      'One target, `//app:main`', 'One target, `//app:app` (the target named like the package)',
      `Every rule of the package \`app\`; ${MANUAL}`, `Every target of the package \`app\` (rules and files); ${MANUAL}`, `Every target of the package \`app\` (rules and files); ${MANUAL}`,
    ]);
    assert.deepStrictEqual(notes('bazel build //app:main //app //app:all', 'ja'), [
      '1つのターゲット `//app:main`', '1つのターゲット `//app:app`（パッケージと同じ名前のターゲット）', `パッケージ \`app\` のすべてのルール。${MANUAL_JA}`,
    ]);
    assert.deepStrictEqual(pieces('bazel build //app:main \'//app:*\'', '//app:main'), ['//app: The package `app` (its directory from the top of the repository)', ':main: The target `main`']);
    assert.deepStrictEqual(pieces('bazel build //app:main \'//app:*\'', '\'//app:*\'').at(-1), ':*: Every target of the package: its rules and its files');
    assert.deepStrictEqual(pieces('bazel build //app:all', '//app:all', 'ja'), ['//app: パッケージ `app`（リポジトリの最上位からのディレクトリ）', ':all: パッケージのすべてのルール（ファイルは含まない）']);
  });

  it('the packages below a directory, and the patterns relative to the current directory', () => {
    assert.deepStrictEqual(notes('bazel build //app/... :main legacy:all ... legacy/... :all'), [
      `Every rule of the packages in the directory \`app\` and below; ${MANUAL}`, 'One target, `:main` from the current directory',
      `Every rule of the package \`legacy\` below the current directory; ${MANUAL}`, `Every rule of the packages in the current directory and below; ${MANUAL}`,
      `Every rule of the packages in the directory \`legacy\` (from the current directory) and below; ${MANUAL}`, `Every rule of the package of the current directory; ${MANUAL}`,
    ]);
    assert.deepStrictEqual(notes('bazel build //app/... :main ... legacy/...', 'ja'), [
      `ディレクトリ \`app\` とその下のパッケージのすべてのルール。${MANUAL_JA}`, '今のディレクトリからの1つのターゲット `:main`',
      `今のディレクトリとその下のパッケージのすべてのルール。${MANUAL_JA}`, `ディレクトリ \`legacy\`（今のディレクトリから）とその下のパッケージのすべてのルール。${MANUAL_JA}`,
    ]);
    assert.deepStrictEqual(pieces('bazel build legacy/... legacy:all', 'legacy/...'), ['legacy: The directory `legacy` below the current directory', '/...: Every package in this directory and below it']);
    assert.deepStrictEqual(pieces('bazel build legacy/... legacy:all', 'legacy:all')[0], 'legacy: The package `legacy` below the current directory');
    assert.deepStrictEqual(pieces('bazel build //app/...:all', '//app/...:all').at(-1), ':all: Every rule of each package (no files)');
    assert.deepStrictEqual(pieces('bazel build //app/...:all-targets', '//app/...:all-targets', 'ja').at(-1), ':all-targets: 各パッケージのすべてのターゲット（ルールとファイル）');
    // (No `:`: the longest leading part that is a package names the target, `main` in `app` is `//app:main`.)
    assert.deepStrictEqual(notes('bazel build app/main'), ['One target. If `app/main` below the current directory is a package, its target `main` (`app/main:main`); else the target of the longest leading part that is a package, named by the rest (`app:main` and so on)']);
    assert.deepStrictEqual(notes('bazel build main', 'ja'), ['1つのターゲット。今のディレクトリの下のパッケージ `main` があれば、そのターゲット `main`（`main:main`）。なければ、パッケージである最も長い前の部分の、残りを名前とするターゲット（`:main` など）']);
  });

  it('repositories', () => {
    assert.deepStrictEqual(notes('bazel build @repo//pkg:x @@canon//... @//app:data @bazel_tools @repo//pkg/...:all-targets @@//...'), [
      'One target, `@repo//pkg:x`', `Every rule of every package of the repository \`@@canon\`; ${MANUAL}`, 'One target, `@//app:data`',
      'One target, `@bazel_tools//:bazel_tools` (the target named like the repository, in its top package)',
      `Every target of the packages in the directory \`pkg\` of the repository \`@repo\` and below (rules and files); ${MANUAL}`, `Every rule of every package of the repository; ${MANUAL}`,
    ]);
    assert.deepStrictEqual(notes('@bazel_tools @@canon//... @repo//pkg:all'.replace(/^/, 'bazel build '), 'ja'), [
      '1つのターゲット `@bazel_tools//:bazel_tools`（最上位のパッケージの、リポジトリと同じ名前のターゲット）', `リポジトリ \`@@canon\` のすべてのパッケージのすべてのルール。${MANUAL_JA}`,
      `リポジトリ \`@repo\` のパッケージ \`pkg\` のすべてのルール。${MANUAL_JA}`,
    ]);
    const repos = (line: string, lang: 'en' | 'ja' = 'en'): string[] => tokens(line, lang).filter((t) => t.kind === 'keyword').map((t) => `${t.label}: ${t.explanation}`);
    assert.deepStrictEqual(repos('bazel build @repo//x @@canon//x @//x @@//x'), [
      '@repo: The repository `repo` (the name the main module sees it by; the main module\'s own name is the main repository)',
      '@@canon: The repository whose canonical name is `canon`', '@: The main repository', '@@: The main repository (its canonical name is empty)',
    ]);
    assert.deepStrictEqual(repos('bazel build @repo//x @@canon//x @@//x', 'ja'), [
      '@repo: リポジトリ `repo`（メインのモジュールから見える名前。メインのモジュール自身の名前ならメインのリポジトリ）', '@@canon: 正規の名前が `canon` のリポジトリ', '@@: メインのリポジトリ（正規の名前が空のリポジトリ）',
    ]);
  });

  it('the top package of a repository', () => {
    assert.deepStrictEqual(notes('bazel build //:all \'//:*\' @repo//:all //:gazelle'), [
      `Every rule of the top package of the repository; ${MANUAL}`, `Every target of the top package of the repository (rules and files); ${MANUAL}`,
      `Every rule of the top package of the repository \`@repo\`; ${MANUAL}`, 'One target, `//:gazelle`',
    ]);
    assert.deepStrictEqual(notes('bazel build //:all @repo//:all', 'ja'), [`リポジトリの最上位のパッケージのすべてのルール。${MANUAL_JA}`, `リポジトリ \`@repo\` の最上位のパッケージのすべてのルール。${MANUAL_JA}`]);
  });

  it('subtractive patterns, after `--`', () => {
    assert.deepStrictEqual(notes('bazel build -- //app/... -//app:main -//app -:main'), [
      `Every rule of the packages in the directory \`app\` and below; ${MANUAL}`, 'Takes the target `//app:main` out of the targets of the patterns before it',
      'Takes the target `//app:app` (the target named like the package) out of the targets of the patterns before it',
      'Takes the target `:main` (from the current directory) out of the targets of the patterns before it',
    ]);
    assert.deepStrictEqual(notes('bazel build -- //app/... -//app:main -:main', 'ja').slice(1), ['ターゲット `//app:main` を、前のパターンのターゲットから除く', 'ターゲット `:main`（今のディレクトリから）を、前のパターンのターゲットから除く']);
    assert.deepStrictEqual(notes('bazel build -- //app/... -main -:all -... -//app:*').slice(1), [
      'Takes one target out of the targets of the patterns before it. If `main` below the current directory is a package, its target `main` (`main:main`); else the target of the longest leading part that is a package, named by the rest (`:main` and so on)',
      'Takes every rule of the package of the current directory out of the targets of the patterns before it',
      'Takes every rule of the packages in the current directory and below out of the targets of the patterns before it',
      'Takes every target of the package `app` (rules and files) out of the targets of the patterns before it',
    ]);
    assert.deepStrictEqual(notes('bazel build -- //app/... -main -//app:*', 'ja').slice(1), [
      '1つのターゲットを、前のパターンのターゲットから除く。今のディレクトリの下のパッケージ `main` があれば、そのターゲット `main`（`main:main`）。なければ、パッケージである最も長い前の部分の、残りを名前とするターゲット（`:main` など）',
      'パッケージ `app` のすべてのターゲット（ルールとファイル）を、前のパターンのターゲットから除く',
    ]);
    assert.deepStrictEqual(pieces('bazel build -- -//app:main', '-//app:main', 'ja')[0], '-: 除くパターン: このパターンのターゲットを、前のパターンで集めたターゲットから除く（順序に意味がある）');
  });

  it('what bazel refuses', () => {
    assert.deepStrictEqual(notes('bazel build ../x:y //app/...:main //app: //app/'), ['', '', '', '']);
    assert.deepStrictEqual(pieces('bazel build ../x:y', '../x:y'), ['../x: A package name cannot hold a `.` or `..` directory (nothing above the current directory can be named): bazel stops with "invalid package name"', ':y: The target `y`']);
    assert.deepStrictEqual(pieces('bazel build //app/...:main', '//app/...:main').at(-1), ':main: After `...`, only `:all`, `:*` or `:all-targets` may stand: bazel stops with "\'...\' can only be used with wildcard targets"');
    assert.deepStrictEqual(pieces('bazel build //app:', '//app:').at(-1), ':: No name after `:`: bazel stops with "empty target name"');
    assert.deepStrictEqual(pieces('bazel build //app/', '//app/', 'ja'), ['//app/: パッケージの名前は `/` で始まったり終わったりできず、`//` も含められない。bazel は「invalid package name」で止まる']);
    assert.deepStrictEqual(tokens('bazel build //app/...:main', 'en').filter((t) => t.kind === 'error').length, 1);
    // (With no `:`, a refused package is said so, not read as a relative target.)
    assert.deepStrictEqual(pieces('bazel build ./app', './app'), ['./app: A package name cannot hold a `.` or `..` directory (nothing above the current directory can be named): bazel stops with "invalid package name"']);
  });

  it('expansions in a pattern: the parts after its start are read', () => {
    assert.deepStrictEqual(pieces('bazel build "//app:$t"', '"//app:$t"'), ['//app: The package `app` (its directory from the top of the repository)', ':$t: The target\'s name (after `:`)']);
    // (A hole in the package's path and one in the target's name are read apart: `/` and `...` are the package's, a `:` in a name is refused.)
    const holes = (line: string, lang: 'en' | 'ja' = 'en'): string[] => tokens(line, lang).filter((t) => t.kind === 'variable' && /target|ターゲット/.test(t.explanation)).map((t) => `${t.label}: ${t.explanation}`);
    assert.deepStrictEqual(holes('bazel build "//app:$t" "//$pkg/..."'), [
      '$t: The value of `$t` is read as the target\'s name, or part of it: as the whole name, `all` is every rule and `*` or `all-targets` every target of the package; a `/` in it is part of the name, and bazel refuses a `:`',
      '$pkg: The value of `$pkg` is read as part of the package\'s path: a `/` in it separates directories, a `:` ends the package and starts the target\'s name, and `...` as the last directory stands for every package below',
    ]);
    assert.deepStrictEqual(holes('bazel build "//app:$t" "//$pkg/..."', 'ja'), [
      '$t: `$t` の値はターゲットの名前（またはその一部）として読まれる。名前全体が `all` ならすべてのルール、`*`・`all-targets` ならすべてのターゲットになる。値の中の `/` は名前の一部で、`:` は bazel が拒否する',
      '$pkg: `$pkg` の値はパッケージのパスの一部として読まれる。値の中の `/` はディレクトリを区切り、`:` はパッケージを終えてターゲットの名前を始め、最後のディレクトリの `...` はその下のすべてのパッケージになる',
    ]);
    assert.deepStrictEqual(pieces('bazel build "//$pkg/..."', '"//$pkg/..."', 'ja')[0], '//$pkg: リポジトリの最上位からのディレクトリ `$pkg`');
    // (Where the value would decide the reading, the word is left unread: its start, a repository's name.)
    assert.deepStrictEqual(notes('bazel build "$t" "$d/..." "@$r//x" "//app/...:$t"'), ['', '', '', '']);
  });

  it('a query and a cquery take the `manual` targets, an aquery leaves them out, and the words that are no pattern are left to the query', () => {
    assert.deepStrictEqual(notes('bazel query //app/...'), ['Every rule of the packages in the directory `app` and below']);
    assert.deepStrictEqual(notes('bazel cquery //app/...'), ['Every rule of the packages in the directory `app` and below']);
    assert.deepStrictEqual(notes('bazel aquery //app/... //app:main'), [`Every rule of the packages in the directory \`app\` and below; ${MANUAL}`, 'One target, `//app:main`']);
    assert.deepStrictEqual(notes('bazel aquery //app:all', 'ja'), [`パッケージ \`app\` のすべてのルール。${MANUAL_JA}`]);
    assert.deepStrictEqual(notes('bazel cquery @@//app:all', 'ja'), ['パッケージ `app` のすべてのルール']);
    assert.deepStrictEqual(notes('bazel query kind \'deps(//x)\' \'a+b\''), ['', '', '']);
  });

  it('words that are no target pattern', () => {
    assert.deepStrictEqual(notes('bazel build @foo:bar // ""'), ['', '', '']);
    assert.deepStrictEqual(['', 'a b', '-', '@', '@foo:bar', '//', '@repo//'].map((w) => parseTargetPattern(w)), Array(7).fill(undefined));
    assert.deepStrictEqual(parseTargetPattern('-//app/...:*'), { negative: true, absolute: true, pkg: 'app', pkgAt: [1, 6], recursive: true, dotsAt: [6, 10], name: '*', nameAt: [10, 12], wildcard: 'targets' });
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
