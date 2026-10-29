import type { CommandSpec } from '../argv/spec';
import { tx } from '../i18n';
import { cmd, operand, runs, wordTable } from './types';

// The commands bats-core defines for its test files (docs/design/bats.md): shell functions of bats itself, read
// with these specs only in a bats file (the `bats` host kind, src/hosts.ts). In a shell script the names are
// ordinary commands. The texts follow bats-core 1.13 (lib/bats-core/test_functions.bash, man 7 bats).

export const BATS_COMMANDS: Record<string, CommandSpec> = wordTable({
  // `run` reads its options up to the first word that is not one (`!`, `-N`, or one of its long options), or
  // up to `--`; an unknown option is an error. It runs the command inside `$( )`, so in a subshell. Any option
  // (`--` too) makes bats warn (BW02) unless `bats_require_minimum_version 1.5.0` comes first.
  run: cmd('bats の関数: コマンドをサブシェルで実行し、終了ステータスを `$status` に、出力（標準エラー出力も含む）を `$output` と配列 `$lines` に入れる。`run` 自身は 0 を返すので、コマンドが失敗してもテストは止まらない（`!` や `-N` を付けたときを除く）。オプション（`--` も）は bats 1.5.0 からで、先に `bats_require_minimum_version 1.5.0` がないと警告(BW02)が出る',
    'bats function: runs a command in a subshell and keeps its exit status in `$status` and its output (stderr included) in `$output` and the array `$lines`. `run` itself returns 0, so a failing command does not stop the test (unless `!` or `-N` is given). Its options (`--` too) are from bats 1.5.0, and bats warns (BW02) unless `bats_require_minimum_version 1.5.0` comes first', [
    ['!', 'コマンドが失敗（0 以外）しなければ `run` が失敗し、テストが失敗する', 'fail, and so fail the test, unless the command fails (a non-zero status)'],
    ['--separate-stderr', '標準エラー出力(fd 2)を `$output` に混ぜず、`$stderr` と配列 `$stderr_lines` に入れる', 'keep stderr out of `$output`, in `$stderr` and the array `$stderr_lines`'],
    ['--keep-empty-lines', '`$lines` に空行も残す（出力の末尾の改行も `$output` に残す）', 'keep empty lines in `$lines` (and trailing newlines in `$output`)'],
  ], {
    optionsFirst: true,
    patternOptions: [{
      pattern: /^-(\d+)$/,
      text: ([, n]) => tx(`終了ステータスが ${n} でなければ \`run\` が失敗し、テストが失敗する`, `fail, and so fail the test, unless the exit status is ${n}`),
    }],
    unknownOption: tx('`run` が知らないオプション: bats は「unknown flag」のエラーにして、`run` は失敗する', 'an option `run` does not know: bats says "unknown flag", and `run` fails'),
    operands: [{ pattern: [runs({ run: 'subshell' })] }],
    // (bats-core 1.13, lib/bats-core/test_functions.bash: `stderr` and `stderr_lines` are set with --separate-stderr, else unset.)
    shellEffect: {
      does: 'changes',
      always: [{ name: 'status', sets: 'string' }, { name: 'output', sets: 'string' }, { name: 'lines', sets: 'lines' }, { name: 'BATS_RUN_COMMAND', sets: 'string' },
        { name: 'stderr', sets: 'string', maybe: true }, { name: 'stderr_lines', sets: 'lines', maybe: true }],
    },
  }),
  load: cmd('bats の関数: テストファイルのディレクトリ（または絶対パス）からファイル `NAME.bash`（なければ `NAME`）を読み込み、今のシェルで実行する（`source` と同じ）。見つからなければ、読み込んだシェルを `exit 1` で終える（ファイルの先頭ならテストファイル全体が止まり、`setup` やテストの中ならそのテストだけが失敗する）',
    'bats function: reads the file `NAME.bash` (or else `NAME`) from the directory of the test file (or an absolute path) and runs it in the current shell, as `source` does. If it is missing, it ends the shell that runs it with `exit 1`: at the top of the file this stops the whole test file; in `setup` or a test, only that test fails', [], {
    operands: [{ pattern: [operand('NAME', '読み込むファイル（`.bash` は省ける）', 'file to read (`.bash` may be left out)', { type: 'file' })] }],
    shellEffect: { does: 'changes', runsUnread: 'file' },
  }),
  bats_load_library: cmd('bats の関数: ライブラリを `$BATS_LIB_PATH` のディレクトリ（とテストファイルのディレクトリ）から探して読み込む（ファイルか、ディレクトリの `load.bash`）。見つからなければ、読み込んだシェルを `exit 1` で終える（ファイルの先頭ならテストファイル全体が止まり、`setup` やテストの中ならそのテストだけが失敗する）',
    'bats function: finds a library in the directories of `$BATS_LIB_PATH` (and that of the test file) and reads it (a file, or the `load.bash` of a directory). If it is missing, it ends the shell that runs it with `exit 1`: at the top of the file this stops the whole test file; in `setup` or a test, only that test fails', [], {
    operands: [{ pattern: [operand('NAME', 'ライブラリの名前（`bats-assert` など）', 'name of the library (`bats-assert`…)')] }],
    shellEffect: { does: 'changes', runsUnread: 'file' },
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
  bats_pipe: cmd('bats の関数: `\\|` で区切ったコマンドをパイプでつないで実行する。`run bats_pipe cmd \\| …` と書くと、パイプライン全体を `run` で実行できる。終了ステータスは、最後に失敗したコマンドのもの（`set -o pipefail` と同じ）。bats 1.10.0 から',
    'bats function: runs the commands separated by `\\|` joined by pipes. `run bats_pipe cmd \\| …` runs the whole pipeline under `run`. The exit status is that of the last command that failed (as with `set -o pipefail`). Since bats 1.10.0', [
    ['--returned-status', '終了ステータスを、この位置のコマンドのものにする（負の数は後ろから数える）', 'take the exit status of the command at this position (a negative number counts from the end)', 'arg'],
  ], {
    optionsFirst: true,
    patternOptions: [{
      pattern: /^-(\d+)$/,
      text: ([, n]) => tx(`終了ステータスを、${n} 番目（0 から数える）のコマンドのものにする`, `take the exit status of command ${n} (counting from 0)`),
    }],
    operands: [{ pattern: [operand('COMMANDS', '`\\|` で区切ったコマンドと引数（`bats_pipe` がパイプラインにする）', 'commands and their arguments, separated by `\\|` (bats_pipe makes them a pipeline)', { repeat: '+' })] }],
    // (It `eval`s the pipeline in the shell that calls it: with `lastpipe`, the last stage runs there, and may set anything.)
    shellEffect: { does: 'changes', runsUnread: 'command-line' },
  }),
});

// The functions of the three bats libraries (bats-support, bats-assert, bats-file; CC0-1.0, not installed here and
// not a dependency: the texts are written from their READMEs). Each library is a table of its own, read only in a
// bats file that can have the library (`batsLibraryTables` in src/hosts/bats.ts). None of them sets a variable the
// model follows. An assertion returns 0 when it holds; when it does not, it prints a report to stderr and returns 1,
// and bats, which runs a test with `set -e`, fails the test there.

type Opts = NonNullable<Parameters<typeof cmd>[2]>;

const FAILS_JA = '成り立たなければ、報告を標準エラー出力に出して 1 を返し、テストが失敗する（bats はテストを `set -e` で実行する）';
const FAILS_EN = 'if it does not hold, it prints a report to stderr and returns 1, which fails the test (bats runs a test with `set -e`)';

/** A function of a library that checks something: what it does and reads (`ja`, `en`), then the failure, which is always the same. */
const check = (lib: string, ja: string, en: string, opts: Opts = [], rest: Parameters<typeof cmd>[3] = {}) =>
  cmd(`${lib} の関数: ${ja}。${FAILS_JA}`, `${lib} function: ${en}; ${FAILS_EN}`, opts, rest);

const word = (name: string, ja: string, en: string, repeat?: '?' | '*' | '+') => operand(name, ja, en, repeat ? { repeat } : {});

// ---- bats-support ----

export const BATS_SUPPORT_COMMANDS: Record<string, CommandSpec> = wordTable({
  fail: cmd('bats-support の関数: メッセージ（引数、なければ標準入力）をそのまま標準エラー出力に出し、必ず失敗（1）を返すので、テストはそこで失敗する。自分で作る確認用の関数に使える',
    'bats-support function: prints the message (the arguments, or else stdin) as it is to stderr and always fails (returns 1), so the test fails there. For the checks you write yourself', [], {
    operands: [{ pattern: [word('MESSAGE', '表示するメッセージ（省くと標準入力から読む）', 'the message to show (left out: read from stdin)', '*')] }],
  }),
  batslib_is_caller: cmd('bats-support の関数: 呼び出しの履歴を調べ、今の関数が、指定した関数から呼ばれたかを確かめる（`setup`・`teardown`・テストの中だけで使える関数を作るのに使う）。そうなら 0、そうでなければ 1 を返す',
    'bats-support function: looks at the call stack and checks whether the current function was called from the one named (to limit a helper to `setup`, `teardown` or a test). Returns 0 if so, 1 if not', [
    ['--indirect', '直接の呼び出し元だけでなく、呼び出しの途中のどこかにその関数があればよい', 'the function may be anywhere up the call chain, not only the direct caller'],
  ], {
    operands: [{ pattern: [word('FUNCTION', '呼び出し元として探す関数の名前（テスト自身なら `$BATS_TEST_NAME`）', 'the name of the function to look for (the test itself: `$BATS_TEST_NAME`)')] }],
  }),
  batslib_decorate: cmd('bats-support の関数: 標準入力のメッセージを、見出し（引数）を付けた枠 `-- 見出し --` … `--` で囲んで出力する。失敗の報告を目立たせるのに使う',
    'bats-support function: wraps the message on stdin in a frame, `-- HEADER --` … `--`, to make a failure report stand out', [], {
    operands: [{ pattern: [word('HEADER', '枠の見出し', 'the header of the frame')] }],
  }),
});

// ---- bats-assert ----

// `--partial` and `--regexp` cannot be given together (an error); `--` ends the options, so that a text can start
// with `-`; the argument `-` (or `--stdin`) reads the expected text from standard input.
const MODES: Opts = [
  ['-p|--partial', '文字列が一部分として含まれていればよい（部分一致）。`--regexp` とは一緒に使えない（エラー）', 'the text only has to be contained (a substring match); not together with `--regexp` (an error)'],
  ['-e|--regexp', '文字列を POSIX 拡張正規表現として照合する（`\\d`・`(?:…)` などは使えない）。`--partial` とは一緒に使えない（エラー）', 'match with the text as a POSIX extended regular expression (no `\\d`, `(?:…)`…); not together with `--partial` (an error)'],
];
const STDIN: Opts = [
  ['--stdin', '文字列を引数ではなく標準入力から読む（引数に `-` を書くのと同じ。ヒアドキュメントや here-string で渡せる）', 'read the text from standard input, not from an argument (the same as the argument `-`; a here-document or here-string can feed it)'],
];
const INDEX: Opts = [
  ['-n|--index', '行の番号（0 から数える）。全ての行ではなく、この番号の行だけを調べる', 'the number of the line (counted from 0): look at that line only, not at every line', 'arg'],
];

/** assert_output, refute_output, assert_stderr, refute_stderr. */
const outputCheck = (v: 'output' | 'stderr', negate: boolean) => check('bats-assert',
  v === 'output'
    ? `\`$output\`（\`run\` が入れた出力）が、与えた文字列と${negate ? '一致しない' : '一致する'}ことを確かめる。引数なしなら、${negate ? '空であること' : '空でないこと'}を確かめる。引数が \`-\` なら文字列を標準入力から読む`
    : `\`$stderr\`（\`run --separate-stderr\` が入れた標準エラー出力）が、与えた文字列と${negate ? '一致しない' : '一致する'}ことを確かめる。引数なしなら、${negate ? '空であること' : '空でないこと'}を確かめる。引数が \`-\` なら文字列を標準入力から読む。\`--separate-stderr\` なしの \`run\` では \`$stderr\` は空`,
  `checks that \`$${v}\` (${v === 'output' ? 'what `run` kept' : 'the stderr that `run --separate-stderr` kept; empty after a `run` without it'}) ${negate ? 'does not match' : 'matches'} the text given; with no argument, it checks that it is ${negate ? 'empty' : 'not empty'}; the argument \`-\` reads the text from stdin`,
  [...MODES, ...STDIN], {
    operands: [{ pattern: [word('TEXT', negate ? '一致してはいけない文字列（`-` なら標準入力、省くと空であることを確かめる）' : '期待する文字列（`-` なら標準入力、省くと空でないことを確かめる）',
      negate ? 'the text that must not match (`-` reads it from stdin, left out it checks that the output is empty)' : 'the expected text (`-` reads it from stdin, left out it checks that the output is not empty)', '?')] }],
  });

/** assert_line, refute_line, assert_stderr_line, refute_stderr_line. */
const lineCheck = (v: 'lines' | 'stderr_lines', negate: boolean) => check('bats-assert',
  `\`$${v}\`（\`run\` が出力を行に分けた配列。空行は入らないので、番号がずれる${v === 'lines' ? '' : '。`run --separate-stderr` が必要'}）に、与えた行と${negate ? '一致する行がない' : '一致する行がある'}ことを確かめる。\`--index\` を付けると、その番号の行だけを調べる`,
  `checks that ${negate ? 'no line of' : 'a line of'} \`$${v}\` (the output split into lines by \`run\`; empty lines are left out, which shifts the numbers${v === 'lines' ? '' : '; needs \`run --separate-stderr\`'}) matches the line given; with \`--index\`, it looks at that line only`,
  [...INDEX, ...MODES], {
    operands: [{ pattern: [word('LINE', negate ? '一致してはいけない行' : '期待する行', negate ? 'the line that must not match' : 'the expected line')] }],
  });

export const BATS_ASSERT_COMMANDS: Record<string, CommandSpec> = wordTable({
  assert: check('bats-assert', '式（コマンド）を実行し、偽（0 以外を返す）なら失敗とする。`[[ ]]` のような複合コマンドは、`bash -c` で包まないと書けない',
    'runs the expression (a command) and fails the test if it is false (returns non-zero); a compound command such as `[[ ]]` has to be wrapped in `bash -c`', [], {
    operands: [{ pattern: [word('EXPRESSION', '調べる式（単純なコマンド）', 'the expression to check (a simple command)', '+')] }],
  }),
  refute: check('bats-assert', '式（コマンド）を実行し、真（0 を返す）なら失敗とする。`assert` の逆',
    'runs the expression (a command) and fails the test if it is true (returns 0); the opposite of `assert`', [], {
    operands: [{ pattern: [word('EXPRESSION', '調べる式（単純なコマンド）', 'the expression to check (a simple command)', '+')] }],
  }),
  assert_equal: check('bats-assert', '2 つの値が等しいことを確かめる（複数行の値は、行に分けて報告する）',
    'checks that the two values are equal (a multi-line value is reported line by line)', [], {
    operands: [{ pattern: [word('ACTUAL', '実際の値', 'the actual value'), word('EXPECTED', '期待する値', 'the expected value')] }],
  }),
  assert_not_equal: check('bats-assert', '2 つの値が等しくないことを確かめる',
    'checks that the two values are not equal', [], {
    operands: [{ pattern: [word('ACTUAL', '実際の値', 'the actual value'), word('UNEXPECTED', '等しくてはいけない値', 'the value it must not equal')] }],
  }),
  assert_success: check('bats-assert', '`$status`（`run` が入れた終了ステータス）が 0 であることを確かめる。失敗の報告には `$status` と `$output` が入る',
    'checks that `$status` (the exit status `run` kept) is 0; the report shows `$status` and `$output`'),
  assert_failure: check('bats-assert', '`$status`（`run` が入れた終了ステータス）が 0 でないことを確かめる。ステータスを与えると、それと等しいことを確かめる。失敗の報告には `$status` と `$output` が入る',
    'checks that `$status` (the exit status `run` kept) is not 0; with a status given, that it equals it; the report shows `$status` and `$output`', [], {
    operands: [{ pattern: [word('STATUS', '期待する終了ステータス（省くと、0 以外ならよい）', 'the exit status expected (left out: any non-zero status)', '?')] }],
  }),
  assert_output: outputCheck('output', false),
  refute_output: outputCheck('output', true),
  assert_line: lineCheck('lines', false),
  refute_line: lineCheck('lines', true),
  assert_stderr: outputCheck('stderr', false),
  refute_stderr: outputCheck('stderr', true),
  assert_stderr_line: lineCheck('stderr_lines', false),
  refute_stderr_line: lineCheck('stderr_lines', true),
  assert_regex: check('bats-assert', '値が正規表現に一致することを確かめる（`[[ 値 =~ 正規表現 ]]` と同じで、POSIX 拡張正規表現。`BASH_REMATCH` が設定される）',
    'checks that the value matches the regular expression (as `[[ VALUE =~ PATTERN ]]`: a POSIX extended regular expression; it sets `BASH_REMATCH`)', [], {
    operands: [{ pattern: [word('VALUE', '調べる値', 'the value to check'), word('PATTERN', '正規表現', 'the regular expression')] }],
    shellEffect: { does: 'changes', always: [{ name: 'BASH_REMATCH', sets: 'lines', maybe: true }] },
  }),
  refute_regex: check('bats-assert', '値が正規表現に一致しないことを確かめる（`assert_regex` の逆。一致したときは、一致した部分を報告する）',
    'checks that the value does not match the regular expression (the opposite of `assert_regex`; on a match, the report shows the matched text)', [], {
    operands: [{ pattern: [word('VALUE', '調べる値', 'the value to check'), word('PATTERN', '正規表現', 'the regular expression')] }],
    shellEffect: { does: 'changes', always: [{ name: 'BASH_REMATCH', sets: 'lines', maybe: true }] },
  }),
});

// ---- bats-file ----

/** A check of bats-file on a path (or the paths its operands name). */
const fileCheck = (ja: string, en: string, operands: [string, string, string][] = [['PATH', '調べるパス', 'the path to check']]) =>
  check('bats-file', ja, en, [], {
    operands: [{ pattern: operands.map(([n, j, e]) => operand(n, j, e, { type: 'file' })) }],
  });

const FILE_KINDS: [string, string, string][] = [
  ['exists', 'ファイルかディレクトリ', 'a file or a directory'],
  ['file', '通常のファイル', 'a regular file'],
  ['dir', 'ディレクトリ', 'a directory'],
  ['link', 'シンボリックリンク', 'a symbolic link'],
  ['block', 'ブロックスペシャルファイル', 'a block special file'],
  ['character', 'キャラクタスペシャルファイル', 'a character special file'],
  ['socket', 'ソケット', 'a socket'],
  ['fifo', '名前付きパイプ（FIFO）', 'a named pipe (FIFO)'],
];

const KIND_TABLE: Record<string, CommandSpec> = {};
for (const [kind, ja, en] of FILE_KINDS) {
  KIND_TABLE[kind === 'exists' ? 'assert_exists' : `assert_${kind}_exists`] = fileCheck(`パスに${ja}があることを確かめる`, `checks that ${en} exists at the path`);
  KIND_TABLE[kind === 'exists' ? 'assert_not_exists' : `assert_${kind}_not_exists`] = fileCheck(`パスに${ja}がないことを確かめる`, `checks that ${en} does not exist at the path`);
}

export const BATS_FILE_COMMANDS: Record<string, CommandSpec> = wordTable({
  ...KIND_TABLE,
  assert_file_executable: fileCheck('ファイルが実行できることを確かめる', 'checks that the file is executable'),
  assert_file_not_executable: fileCheck('ファイルが実行できないことを確かめる', 'checks that the file is not executable'),
  assert_file_owner: fileCheck('ファイルの所有者が、そのユーザーであることを確かめる（報告にはパスと所有者が入る）', 'checks that the user owns the file (the report shows the path and the owner)',
    [['USER', '所有者であるはずのユーザー', 'the user who should own it'], ['PATH', '調べるファイル', 'the file to check']]),
  assert_not_file_owner: fileCheck('ファイルの所有者が、そのユーザーでないことを確かめる', 'checks that the user does not own the file',
    [['USER', '所有者であってはいけないユーザー', 'the user who must not own it'], ['PATH', '調べるファイル', 'the file to check']]),
  assert_file_permission: fileCheck('ファイルのパーミッションが、与えた値（`777` など）であることを確かめる', 'checks that the file has the permission given (`777`…)',
    [['PERMISSION', '期待するパーミッション（8 進数）', 'the permission expected (octal)'], ['PATH', '調べるファイル', 'the file to check']]),
  assert_not_file_permission: fileCheck('ファイルのパーミッションが、与えた値でないことを確かめる', 'checks that the file does not have the permission given',
    [['PERMISSION', '期待しないパーミッション（8 進数）', 'the permission not expected (octal)'], ['PATH', '調べるファイル', 'the file to check']]),
  assert_file_size_equals: fileCheck('ファイルの大きさが、与えたバイト数であることを確かめる', 'checks that the size of the file is the number of bytes given',
    [['PATH', '調べるファイル', 'the file to check'], ['BYTES', '期待するバイト数', 'the size expected, in bytes']]),
  assert_size_zero: fileCheck('ファイルの大きさが 0 バイトであることを確かめる', 'checks that the file is zero bytes'),
  assert_size_not_zero: fileCheck('ファイルの大きさが 0 バイトでないことを確かめる', 'checks that the file is not zero bytes'),
  assert_file_group_id_set: fileCheck('ファイルに setgid ビットが立っていることを確かめる', 'checks that the setgid bit of the file is set'),
  assert_file_not_group_id_set: fileCheck('ファイルに setgid ビットが立っていないことを確かめる', 'checks that the setgid bit of the file is not set'),
  assert_file_user_id_set: fileCheck('ファイルに setuid ビットが立っていることを確かめる', 'checks that the setuid bit of the file is set'),
  assert_file_not_user_id_set: fileCheck('ファイルに setuid ビットが立っていないことを確かめる', 'checks that the setuid bit of the file is not set'),
  assert_sticky_bit: fileCheck('スティッキービットが立っていることを確かめる', 'checks that the sticky bit is set'),
  assert_no_sticky_bit: fileCheck('スティッキービットが立っていないことを確かめる', 'checks that the sticky bit is not set'),
  assert_not_sticky_bit: fileCheck('スティッキービットが立っていないことを確かめる（`assert_no_sticky_bit` の別名で、README の見出しにある名前）', 'checks that the sticky bit is not set (the name in a heading of the README; `assert_no_sticky_bit` is in its index)'),
  assert_file_empty: fileCheck('ファイルが空であることを確かめる（報告にはファイルの中身が入る）', 'checks that the file is empty (the report shows its content)'),
  assert_file_not_empty: fileCheck('ファイルが空でないことを確かめる', 'checks that the file is not empty'),
  assert_file_contains: cmd(`bats-file の関数: ファイルの中身が正規表現に一致することを確かめる。${FAILS_JA}`,
    `bats-file function: checks that the content of the file matches the regular expression; ${FAILS_EN}`, [], {
    operands: [{ pattern: [operand('PATH', '調べるファイル', 'the file to check', { type: 'file' }), word('REGEX', '探す正規表現', 'the regular expression to look for'),
      word('ENGINE', '使う grep（`grep`・`egrep`・`pcregrep` のどれか、入っていること）', 'the grep to use (`grep`, `egrep` or `pcregrep`, which has to be installed)', '?')] }],
  }),
  assert_file_not_contains: cmd(`bats-file の関数: ファイルの中身が正規表現に一致しないことを確かめる（ファイルがなくても失敗する）。${FAILS_JA}`,
    `bats-file function: checks that the content of the file does not match the regular expression (it fails if the file does not exist either); ${FAILS_EN}`, [], {
    operands: [{ pattern: [operand('PATH', '調べるファイル', 'the file to check', { type: 'file' }), word('REGEX', '探してはいけない正規表現', 'the regular expression that must not match')] }],
  }),
  assert_symlink_to: fileCheck('リンクが、与えた先を指すシンボリックリンクであることを確かめる', 'checks that the link is a symbolic link pointing to the target',
    [['TARGET', 'リンクの先', 'the target'], ['LINK', '調べるリンク', 'the link to check']]),
  assert_not_symlink_to: fileCheck('リンクが、与えた先を指すシンボリックリンクでないことを確かめる', 'checks that the link is not a symbolic link pointing to the target',
    [['TARGET', 'リンクの先', 'the target'], ['LINK', '調べるリンク', 'the link to check']]),
  assert_files_equal: fileCheck('2 つのファイルの中身が同じであることを確かめる', 'checks that the two files have the same content',
    [['FILE1', '1 つめのファイル', 'the first file'], ['FILE2', '2 つめのファイル', 'the second file']]),
  temp_make: cmd('bats-file の関数: 一時ディレクトリを `$BATS_TMPDIR` の中に作り、そのパスを標準出力に出す（`dir=$(temp_make)` で受ける）。名前は「接頭辞 + テストのファイル名 + テスト番号 + ランダムな文字」。`setup`・テスト・`teardown` の中でだけ使える。作れなければ、メッセージを標準エラー出力に出して失敗する',
    'bats-file function: makes a temporary directory in `$BATS_TMPDIR` and prints its path to stdout (take it with `dir=$(temp_make)`). Its name is the prefix, the test file name, the test number and random characters. Only in `setup`, a test or `teardown`. If it cannot, it prints an error to stderr and fails', [
    ['-p|--prefix', '名前の先頭に付ける文字列', 'a string put in front of the name', 'arg'],
  ]),
  temp_del: cmd('bats-file の関数: ファイルかディレクトリ（ふつうは `temp_make` で作ったもの）を削除する。`BATSLIB_TEMP_PRESERVE=1` なら何も削除せずに成功する。`BATSLIB_TEMP_PRESERVE_ON_FAILURE=1` なら、テストが失敗したとき削除しない（`teardown` の中だけ）。削除できなければ、メッセージを標準エラー出力に出して失敗する',
    'bats-file function: deletes a file or directory (usually one `temp_make` made). With `BATSLIB_TEMP_PRESERVE=1` it deletes nothing and succeeds; with `BATSLIB_TEMP_PRESERVE_ON_FAILURE=1` it keeps it when the test failed (in `teardown` only). If it cannot delete, it prints an error to stderr and fails', [], {
    operands: [{ pattern: [operand('PATH', '削除するファイルかディレクトリ', 'the file or directory to delete', { type: 'file' })] }],
  }),
});
