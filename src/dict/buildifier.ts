import type { CommandSpec } from '../argv/spec';
import { tx } from '../i18n';
import { cmd, OptSpec } from './types';

// buildifier, as `buildifier -help` of buildtools 10.2.0 (bazel-contrib/buildtools) describes it, each fact checked with
// that release (test/buildifier.test.ts). It formats Starlark files (BUILD, .bzl, WORKSPACE, MODULE.bazel) and, with
// `-lint`, reports or fixes common mistakes. Go's `flag` package reads its words: `-name`, `--name`, `-name=value` and
// `-name value`, no clusters, and the first operand ends the options (`buildifier BUILD -mode=check` opens a file named
// `-mode=check`). That is the preset `openssl` with `optionsFirst`. The exit status is 0 on success, 1 for a syntax error
// in an input, 2 for a usage error, 3 for a file or internal error, and 4 when `-mode=check` (or `-lint=warn`) finds
// something to do or report; given `-format` it prints the report on stdout and exits 0.

const OPTIONS: OptSpec[] = [
  ['-mode', '処理の仕方（`check` は整形が必要なファイルの一覧、`diff`、`fix`（既定）、`print_if_changed`）', 'what to do (`check`: list the files that need formatting; `diff`; `fix`, the default; `print_if_changed`)', 'arg', {
    check: tx('整形が必要なファイル名を標準エラー出力に表示する（あれば終了ステータス 4。`-format` を付けると標準出力で、ステータスは 0）', 'print the names of the files that need formatting to stderr (status 4 if there are any; with `-format`, to stdout and the status is 0)'),
    diff: tx('整形したときの差分を表示する（`-d` と同じ）', 'show the diff that formatting would make (the same as `-d`)'),
    fix: tx('ファイルを整形して書き換える（既定。標準入力なら整形した結果を標準出力へ）', 'rewrite the files formatted (the default; for stdin, print the result)'),
    print_if_changed: tx('変わるファイルだけ、整形した内容を表示する', 'print the formatted content of the files that would change'),
  }],
  ['-d', '`-mode=diff` と同じ（整形の差分を表示する）', 'the same as `-mode=diff` (show the diff of the formatting)'],
  ['-lint', '検査の仕方（`off` は検査しない（既定）、`warn` は警告を表示、`fix` は自動で直せるものを直す）', 'lint mode (`off`: none, the default; `warn`: print warnings; `fix`: apply the automatic fixes)', 'arg', {
    off: tx('検査しない（既定）', 'no linting (the default)'),
    warn: tx('よくない書き方の警告を、解説へのリンクと一緒に表示する', 'print warnings about common mistakes, with links that explain them'),
    fix: tx('警告の自動修正を適用してファイルを書き換える', 'apply the automatic fixes of the warnings and rewrite the files'),
  }],
  ['-warnings', '検査する警告（`all`、または `+名前,-名前` の形で既定の組に足し引きする。`+` `-` と素の名前は混ぜられない）', 'warnings to use with `-lint` (`all`, or `+name,-name` to add to and remove from the default set; the two forms cannot be mixed)', 'arg'],
  ['-r', 'ディレクトリの下の Starlark ファイルを再帰的に探す', 'find Starlark files recursively below the directories given'],
  ['-v', '詳しい情報を標準エラー出力に表示する（`fix` なら書き換えたファイル名）', 'print verbose information to stderr (in `fix` mode, the names of the files it rewrote)'],
  ['-type', '入力の種類（`build`、`bzl`、`workspace`、`module`、`repo`、`vendor`、`default`、`auto`＝ファイル名から判断（既定））', 'type of the input (`build`, `bzl`, `workspace`, `module`, `repo`, `vendor`, `default`, `auto`: from the file name, the default)', 'arg', {
    build: tx('BUILD ファイル', 'a BUILD file'),
    bzl: tx('`.bzl` ファイル', 'a `.bzl` file'),
    workspace: tx('WORKSPACE ファイル', 'a WORKSPACE file'),
    module: tx('`MODULE.bazel`', 'a `MODULE.bazel` file'),
    repo: tx('`REPO.bazel`', 'a `REPO.bazel` file'),
    vendor: tx('`VENDOR.bazel`', 'a `VENDOR.bazel` file'),
    default: tx('一般の Starlark ファイル', 'a generic Starlark file'),
    auto: tx('ファイル名から判断する（既定）', 'decide from the file name (the default)'),
  }],
  ['-format', '`-mode=check` の診断の形式（`text`、`json`、`sarif`）。書くと、見つけても終了ステータスは 0 になる。`check` 以外とは使えない（ステータス 2）', 'format of the diagnostics of `-mode=check` (`text`, `json`, `sarif`); given, the status is 0 even when it finds something; not with another mode (status 2)', 'arg', {
    text: tx('テキストを標準出力に表示する', 'text, on stdout'),
    json: tx('JSON（ファイルごとの整形の要否と警告）', 'JSON (per file: formatted or not, and the warnings)'),
    sarif: tx('SARIF 2.1.0', 'SARIF 2.1.0'),
  }],
  ['-path', 'ファイルが、指定したワークスペースからのパスにあるものとして扱う（標準入力や一時コピーの整形に使う）', 'treat the file as if it were at the given path from the workspace (for stdin or a temporary copy)', 'arg'],
  ['-config', '`.buildifier.json` の設定ファイル（`off` で設定ファイルを読まない、`example` で見本を表示）', 'path of a `.buildifier.json` configuration file (`off`: read none; `example`: print a sample)', 'arg'],
  ['-diff_command', '`diff` モードで差分を取るコマンド（既定は環境変数 `BUILDIFIER_DIFF` などから決まる）', 'command that makes the diff in `diff` mode (the default comes from `BUILDIFIER_DIFF` and the like)', 'arg'],
  ['-multi_diff', '`-diff_command` が tkdiff のように複数のファイルを一度に比べられる', 'the `-diff_command` can compare several files at once, as tkdiff does'],
  ['-tables', '組み込みの表を置き換える表の JSON ファイル', 'JSON file of tables that replace the built-in ones', 'arg'],
  ['-add_tables', '組み込みの表に足す表の JSON ファイル', 'JSON file of tables merged with the built-in ones', 'arg'],
  ['-allowsort', '並べ替えてよいとみなす文脈を足す', 'additional sort contexts to treat as safe', 'arg'],
  ['-buildifier_disable', '無効にする整形の書き換え', 'buildifier rewrites to disable', 'arg'],
  ['-disable_symlink_safety', 'ワークスペースの外を指すシンボリックリンクにも書き込む（既定では書かない）', 'also write through symlinks that point outside the workspace (by default it does not)'],
  ['-version', '版を表示する', 'print the version'],
  ['-help', '使い方を表示する', 'print the usage'],
];

export const buildifier: Record<string, CommandSpec> = {
  buildifier: cmd('Bazel の Starlark ファイル（BUILD、`.bzl`…）を整形し、検査する', 'Format and lint Bazel\'s Starlark files (BUILD, `.bzl`…)', OPTIONS, {
    parser: 'openssl',
    optionsFirst: true,
    helpCommand: 'buildifier -help',
    positional: [tx('Starlark ファイル（`-r` ならディレクトリも、省略すると標準入力）', 'Starlark file or, with `-r`, directory (stdin if none)')],
  }),
};
