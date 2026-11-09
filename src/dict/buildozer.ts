import type { CommandSpec } from '../argv/spec';
import { buildozerEdits } from '../embedded/buildozer';
import { tx } from '../i18n';
import { cmd, operand, OptSpec } from './types';

// buildozer, as `buildozer -help` of buildtools 10.2.0 (bazel-contrib/buildtools) lists its flags, each fact checked with
// that release (test/buildozer.test.ts). It edits Bazel's BUILD files with commands (`'add deps //lib:x'`, one word each)
// on the rules that labels name (`//app:main`), every command on every label; src/embedded/buildozer.ts reads both. Go's
// `flag` package reads its words, as buildifier's: `-name`, `--name`, `-name=value` and `-name value`, and the first
// operand ends the options (`'print kind' -quiet` takes `-quiet` for a label). The exit status is 0 when it changed a
// file or ran only commands that print, 1 for a usage error (a command with too few or too many arguments, an empty
// one), 2 when a command failed (a rule not found, a file not read), and 3 when it changed nothing; with `-stdout`, 0.

/** A flag that is on by default: `-name=false` turns it off (Go's `flag`: a value after `=` only). */
const ON = (ja: string, en: string): [string, string] => [`${ja}（既定でオン。\`=false\` で切る）`, `${en} (on by default; \`=false\` turns it off)`];

const OPTIONS: OptSpec[] = [
  ['-f', 'コマンドを読むファイル（`-` は標準入力）。1行に `コマンド|コマンド|ラベル` を `|` で区切って並べ、`#` の行は読まない。ラベルに `*` と書くと、コマンドラインのラベルに使う。繰り返せる', 'file to read commands from (`-`: stdin): each line is `command|command|label`, separated by `|`, and `#` starts a comment line; a label `*` stands for the labels of the command line. May be repeated', 'arg'],
  ['-stdout', '変えた BUILD ファイルを書き換えず、標準出力に出力する（終了ステータスは 0。何も変わらなくても 3 にならない）', 'write the changed BUILD files to stdout instead of rewriting them (status 0, also when nothing changed)'],
  ['-k', 'コマンドが失敗しても、残りのコマンドを適用する（終了ステータスは 2 のまま）', 'apply the other commands even when one fails (the status is still 2)'],
  ['-quiet', '情報のメッセージ（`fixed …`）を表示しない', 'do not print informational messages (`fixed …`)'],
  ['-types', '対象のルールを、指定した種類（`,` 区切り）だけにする（`cc_library,cc_test`）', 'work only on the rules of the given kinds, separated by `,` (`cc_library,cc_test`)', 'arg'],
  ['-buildifier', '結果を整形する buildifier のプログラム（空なら組み込みの整形）', 'the buildifier program that formats the result (empty: the built-in formatter)', 'arg'],
  ['-shorten_labels', ...ON('足したラベルを短い形にする（`//app:util` は `//app` の中で `:util`）', 'shorten the labels it adds (`//app:util` is `:util` in `//app`)')],
  ['-eol-comments', ...ON('足すコメントを、できれば同じ行の後ろに置く', 'put a comment it adds at the end of the line where it can')],
  ['-delete_with_comments', ...ON('コメントの付いたリストの属性も削除する', 'remove a list attribute even if a comment is attached to it')],
  ['-respect_bazelignore', ...ON('`.bazelignore` のディレクトリを `...` で探さない', 'skip the directories of `.bazelignore` when `...` looks for BUILD files')],
  ['-edit-variables', '変数を代入しただけの属性（`hdrs = LIB_HDRS`）では、その変数のほうを書き換える', 'for an attribute that is only a variable (`hdrs = LIB_HDRS`), edit the variable instead'],
  ['-root_dir', 'ワークスペースの最上位を探す起点のディレクトリ（既定は今のディレクトリ）', 'directory to find the top of the workspace from (the default: the current directory)', 'arg'],
  ['-output_json', '`print` の結果を JSON で出力する', 'print the records of `print` as JSON'],
  ['-output_proto', '`print` の結果を protocol buffer で出力する', 'print the records of `print` as a serialized protocol buffer'],
  ['-tables', '組み込みの表を置き換える表の JSON ファイル', 'JSON file of tables that replace the built-in ones', 'arg'],
  ['-add_tables', '組み込みの表に足す表の JSON ファイル', 'JSON file of tables merged with the built-in ones', 'arg'],
  ['-P', '並行して使うコアの数', 'number of cores to use at once', 'arg'],
  ['-numio', '並行して行う入出力の数（既定は 200。0 以下は終了ステータス 1）', 'number of concurrent file operations (default 200; 0 or less is status 1)', 'arg'],
  ['-disable_symlink_safety', 'ワークスペースの外を指すシンボリックリンクにも書き込む（既定では書かない）', 'also write through symlinks that point outside the workspace (by default it does not)'],
  ['-version', '版を表示する', 'print the version'],
  ['-help|-h', '使い方を表示する', 'print the usage'],
];

export const buildozer: Record<string, CommandSpec> = {
  buildozer: cmd('Bazel の BUILD ファイルを、コマンドで書き換える', 'Edit Bazel\'s BUILD files with commands', OPTIONS, {
    parser: 'openssl',
    optionsFirst: true,
    helpCommand: 'buildozer -help',
    operands: [{ pattern: [operand('ARG', 'コマンド（`\'add deps //lib:x\'` のように1語で書く）か、それを適用するルールのラベル（`//app:main`）', 'a command (one word, as `\'add deps //lib:x\'`) or a label of the rules it applies to (`//app:main`)', { repeat: '*', lang: 'buildozer' })] }],
    exits: [{
      status: 3,
      success: true,
      text: tx('変える必要のあるファイルがなかった（buildozer にとっては成功）', 'no file needed a change (a success to buildozer)'),
      // (Not with `-stdout`; nor when every command only prints. Commands read from a file are not known here.)
      when: ({ options, operands }) => (!options.has('-stdout') || options.get('-stdout') === 'false') && (options.has('-f') || operands.some(buildozerEdits)),
    }],
  }),
};
