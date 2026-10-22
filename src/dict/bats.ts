import type { CommandSpec } from '../argv/spec';
import { tx } from '../i18n';
import { cmd, operand, runs } from './types';

// The commands bats-core defines for its test files (docs/design/bats.md): shell functions of bats itself, read
// with these specs only in a bats file (the `bats` host kind, src/hosts.ts). In a shell script the names are
// ordinary commands. The texts follow bats-core 1.13 (lib/bats-core/test_functions.bash, man 7 bats).

export const BATS_COMMANDS: Record<string, CommandSpec> = {
  // `run` reads its options up to the first word that is not one (`!`, `-N`, or one of its long options), or
  // up to `--`; an unknown option is an error. It runs the command inside `$( )`, so in a subshell.
  run: cmd('bats の関数: コマンドをサブシェルで実行し、終了ステータスを `$status` に、出力（標準エラー出力も含む）を `$output` と配列 `$lines` に入れる。`run` 自身は 0 を返すので、コマンドが失敗してもテストは止まらない（`!` や `-N` を付けたときを除く）',
    'bats function: runs a command in a subshell and keeps its exit status in `$status` and its output (stderr included) in `$output` and the array `$lines`. `run` itself returns 0, so a failing command does not stop the test (unless `!` or `-N` is given)', [
    ['!', 'コマンドが失敗（0 以外）しなければ `run` が失敗し、テストが失敗する（bats 1.5.0 から。`bats_require_minimum_version 1.5.0` がないと警告が出る）',
      'fail, and so fail the test, unless the command fails (a non-zero status) (since bats 1.5.0; without `bats_require_minimum_version 1.5.0`, bats warns)'],
    ['--separate-stderr', '標準エラー出力(fd 2)を `$output` に混ぜず、`$stderr` と配列 `$stderr_lines` に入れる', 'keep stderr out of `$output`, in `$stderr` and the array `$stderr_lines`'],
    ['--keep-empty-lines', '`$lines` に空行も残す（出力の末尾の改行も `$output` に残す）', 'keep empty lines in `$lines` (and trailing newlines in `$output`)'],
  ], {
    style: 'posix',
    patternOptions: [{
      pattern: /^-(\d+)$/,
      text: ([, n]) => tx(`終了ステータスが ${n} でなければ \`run\` が失敗し、テストが失敗する（bats 1.5.0 から）`, `fail, and so fail the test, unless the exit status is ${n} (since bats 1.5.0)`),
    }],
    operands: [{ pattern: [runs({ run: 'current-shell' })] }],
  }),
  load: cmd('bats の関数: テストファイルのディレクトリ（または絶対パス）からファイル `NAME.bash`（なければ `NAME`）を読み込み、今のシェルで実行する（`source` と同じ）。見つからなければテストファイルが止まる',
    'bats function: reads the file `NAME.bash` (or else `NAME`) from the directory of the test file (or an absolute path) and runs it in the current shell, as `source` does. If it is missing, the test file stops', [], {
    operands: [{ pattern: [operand('NAME', '読み込むファイル（`.bash` は省ける）', 'file to read (`.bash` may be left out)', { type: 'file' })] }],
  }),
  bats_load_library: cmd('bats の関数: ライブラリを `$BATS_LIB_PATH` のディレクトリ（とテストファイルのディレクトリ）から探して読み込む（ファイルか、ディレクトリの `load.bash`）。見つからなければテストファイルが止まる',
    'bats function: finds a library in the directories of `$BATS_LIB_PATH` (and that of the test file) and reads it (a file, or the `load.bash` of a directory). If it is missing, the test file stops', [], {
    operands: [{ pattern: [operand('NAME', 'ライブラリの名前（`bats-assert` など）', 'name of the library (`bats-assert`…)')] }],
  }),
  skip: cmd('bats の関数: テストの残りを実行せず、テストを「スキップ」として報告する（setup の中ならそのテストを）',
    'bats function: skips the rest of the test and reports it as skipped (in setup, the test it runs before)', [], {
    operands: [{ pattern: [operand('REASON', 'スキップの理由（結果に表示される）', 'why it is skipped (shown in the results)', { repeat: '?' })] }],
  }),
  bats_require_minimum_version: cmd('bats の関数: bats がこの版より古ければエラーで止まる。この版までの機能（`run !` など）については警告を出さなくなる',
    'bats function: stops with an error if bats is older than this version, and stops the warnings about the features up to it (`run !`…)', [], {
    operands: [{ pattern: [operand('VERSION', '必要な bats の版（`1.5.0` など）', 'the bats version needed (`1.5.0`…)')] }],
  }),
  // The commands are words with `\|` between them, which bats_pipe joins into a pipeline itself: they are not
  // commands to the shell, so they are not a command slot.
  bats_pipe: cmd('bats の関数: `\\|` で区切ったコマンドをパイプでつないで実行する。`run bats_pipe cmd \\| …` と書くと、パイプライン全体を `run` で実行できる。終了ステータスは、最後に失敗したコマンドのもの（`set -o pipefail` と同じ）',
    'bats function: runs the commands separated by `\\|` joined by pipes. `run bats_pipe cmd \\| …` runs the whole pipeline under `run`. The exit status is that of the last command that failed (as with `set -o pipefail`)', [
    ['--returned-status', '終了ステータスを、この位置のコマンドのものにする（負の数は後ろから数える）', 'take the exit status of the command at this position (a negative number counts from the end)', 'arg'],
  ], {
    style: 'posix',
    patternOptions: [{
      pattern: /^-(\d+)$/,
      text: ([, n]) => tx(`終了ステータスを、${n} 番目（0 から数える）のコマンドのものにする`, `take the exit status of command ${n} (counting from 0)`),
    }],
    operands: [{ pattern: [operand('COMMANDS', '`\\|` で区切ったコマンドと引数（`bats_pipe` がパイプラインにする）', 'commands and their arguments, separated by `\\|` (bats_pipe makes them a pipeline)', { repeat: '+' })] }],
  }),
};
