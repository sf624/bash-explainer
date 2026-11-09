import type { CommandSpec, OptionSpec } from '../argv/spec';
import { Text, tx } from '../i18n';
import { saidText } from '../messages-tokens';
import { cmd, CmdRest, operand, optionOf, OptSpec } from './types';

// bazel, as `bazel help startup_options` and `bazel help <command>` of bazel 9.3.2 describe it, each fact checked with
// that release (test/fixtures/oracles/bazel.json, scripts/record-bazel.ts): `bazel [startup options] COMMAND [options]
// [targets]`. bazel has about a thousand options; these are the common ones, and any other is "not in the dictionary".
// Its parser is the preset `bazel` (src/argv/parsers.ts): `--name=value` or `--name value`, no clusters, a boolean
// turned off by `--noname` (or `-x-`), options after the targets, and `--` before the patterns that start with `-`.

/** The startup options, which bazel's client reads before the command (`bazel help startup_options`). */
const STARTUP: OptSpec[] = [
  ['--output_base', '出力の置き場所（ビルドの出力とサーバーの状態。変えると別のサーバーが起動する）', 'where the outputs go (the build outputs and the server\'s state; another value starts another server)', 'arg'],
  ['--output_user_root', 'ユーザーごとの出力の置き場所（各ワークスペースの出力はその下）', 'the user\'s directory of outputs (each workspace\'s output base is below it)', 'arg'],
  ['--bazelrc', 'ユーザーの rc ファイルとして読むファイル（`/dev/null` でそれ以降の `--bazelrc` を無視する）', 'file to read as the user\'s rc file (`/dev/null`: ignore the `--bazelrc` after it)', 'arg'],
  ['--home_rc', '`$HOME/.bazelrc` を読む（既定。`--nohome_rc` で読まない）', 'read `$HOME/.bazelrc` (the default; `--nohome_rc`: do not)'],
  ['--system_rc', 'システム全体の rc ファイルを読む（既定。`--nosystem_rc` で読まない）', 'read the system-wide rc file (the default; `--nosystem_rc`: do not)'],
  ['--workspace_rc', 'ワークスペースの `.bazelrc` を読む（既定。`--noworkspace_rc` で読まない）', 'read the workspace\'s `.bazelrc` (the default; `--noworkspace_rc`: do not)'],
  ['--ignore_all_rc_files', 'rc ファイルをどれも読まない', 'read no rc file at all'],
  ['--batch', 'サーバーを使わず、クライアントのプロセスだけで実行する（非推奨）', 'run in the client process alone, with no server (deprecated)'],
  ['--batch_cpu_scheduling', 'CPU のスケジューリングを `batch` にする（Linux のみ）', 'use the `batch` CPU scheduling (Linux only)'],
  ['--io_nice_level', 'I/O の優先度（`0`〜`7`、Linux のみ）', 'I/O scheduling level (`0` to `7`, Linux only)', 'arg'],
  ['--block_for_lock', 'ほかのコマンドが終わるのを待つ（既定。`--noblock_for_lock` ですぐ終了する）', 'wait for a running command to finish (the default; `--noblock_for_lock`: exit at once)'],
  ['--max_idle_secs', 'サーバーが何もせずに待つ秒数の上限（`0` で終了しない）', 'seconds the server waits idle before it shuts down (`0`: never)', 'arg'],
  ['--shutdown_on_low_sys_mem', '待機中にシステムのメモリが少なくなるとサーバーを終了する', 'shut the idle server down when the system is low on memory'],
  ['--connect_timeout_secs', 'サーバーにつなぐ1回の試みを待つ秒数', 'seconds to wait for each attempt to connect to the server', 'arg'],
  ['--local_startup_timeout_secs', 'サーバーにつながるまで待つ秒数の上限', 'longest time to wait for the server to start', 'arg'],
  ['--host_jvm_args', 'bazel を動かす JVM に渡すフラグ（複数回指定可）', 'flag passed to the JVM that runs bazel (may be repeated)', 'arg'],
  ['--host_jvm_debug', 'JVM がデバッガー（ポート 5005）を待ってから起動する', 'make the JVM wait for a debugger on port 5005 before it starts'],
  ['--server_javabase', 'bazel 自体を動かす JVM のパス', 'path of the JVM that runs bazel itself', 'arg'],
  ['--server_jvm_out', 'サーバーの JVM の出力を書くファイル', 'file to write the server JVM\'s output to', 'arg'],
  ['--digest_function', 'ファイルのダイジェストに使うハッシュ関数（`SHA256`…）', 'hash function for file digests (`SHA256`…)', 'arg'],
  ['--client_debug', 'クライアントのデバッグ情報を標準エラー出力(fd 2)に出力する', 'log the client\'s debug information to stderr'],
  ['--quiet', '情報のメッセージを出さず、エラーだけを表示する', 'print no informational messages, only errors'],
  ['--unlimit_coredumps', 'コアダンプの上限を引き上げる', 'raise the soft core dump limit to the hard limit'],
];

/** The values of an option that is a boolean with more values (`--subcommands=pretty_print`, `--cache_test_results=auto`): bazel's words for on and off. */
const tristate = (on: Text, off: Text): Record<string, Text> => ({ true: on, yes: on, 1: on, false: off, no: off, 0: off });

/** Options every command takes (bazel's common options). */
const COMMON: OptSpec[] = [
  ['--config', 'rc ファイルの設定の組を使う', 'use a group of settings of the rc files', 'arg'],
  ['--announce_rc', 'rc ファイルから読んだオプションを表示する', 'print the options read from the rc files'],
  ['--color', '色を付けるか（`yes`、`no`、`auto`）', 'whether to use colours (`yes`, `no`, `auto`)', 'arg'],
  ['--curses', '端末のカーソル制御で出力を書き換えるか（`yes`、`no`、`auto`）', 'whether to redraw the output with cursor controls (`yes`, `no`, `auto`)', 'arg'],
  ['--show_progress', '進み具合を表示する（既定。`--noshow_progress` で表示しない）', 'show the progress (the default; `--noshow_progress`: do not)'],
  ['--show_timestamps', 'メッセージに時刻を付ける', 'add timestamps to the messages'],
  ['--tool_tag', '実行を記録するツールの名前', 'name of the tool the run is recorded for', 'arg'],
  ['--disk_cache', 'アクションとその出力を読み書きするディスク上のキャッシュのディレクトリ', 'directory of a disk cache for actions and their outputs', 'arg'],
  ['--remote_cache', 'リモートキャッシュの URI（`grpcs://…`、`https://…`）', 'URI of a remote cache (`grpcs://…`, `https://…`)', 'arg'],
  ['--remote_executor', 'リモート実行のエンドポイント（`grpcs://ホスト:ポート`）', 'remote execution endpoint (`grpcs://HOST:PORT`)', 'arg'],
  ['--remote_download_outputs', 'リモートの出力のどれを手元に取ってくるか（`all`、`toplevel`、`minimal`）', 'which remote outputs to download (`all`, `toplevel`, `minimal`)', 'arg'],
  ['--remote_header', 'リモートの要求に付けるヘッダー（`名前=値`）', 'header sent with remote requests (`NAME=value`)', 'arg'],
  ['--bes_backend', 'ビルドイベントを送るサービスのエンドポイント', 'endpoint of the build event service', 'arg'],
  ['--build_event_json_file', 'ビルドイベントを JSON で書くファイル', 'file to write the build events to, as JSON', 'arg'],
  ['--repo_env', 'リポジトリのルールに見せる環境変数（`名前=値`）', 'environment variable for repository rules (`NAME=value`)', 'arg'],
  ['--registry', 'モジュールを探すレジストリ（複数回指定可。前のものから探す）', 'registry to find modules in (may be repeated; the earlier ones first)', 'arg'],
  ['--override_module', 'モジュールを手元のパスに置き換える（`名前=パス`）', 'replace a module with a local path (`NAME=PATH`)', 'arg'],
  ['--override_repository', 'リポジトリを手元のパスに置き換える（`名前=パス`）', 'replace a repository with a local path (`NAME=PATH`)', 'arg'],
  ['--lockfile_mode', '`MODULE.bazel.lock` の使い方（`update`、`refresh`、`error`、`off`）', 'how to use `MODULE.bazel.lock` (`update`, `refresh`, `error`, `off`)', 'arg'],
];

/** The options of `bazel build`, which the commands that build or analyse take too (test, run, coverage, cquery, aquery, info, clean, fetch, vendor). */
const BUILD: OptSpec[] = [
  ['-c|--compilation_mode', 'コンパイルのモード（`fastbuild`（既定）、`dbg`、`opt`）', 'compilation mode (`fastbuild`, the default; `dbg`; `opt`)', 'arg'],
  ['-k|--keep_going', 'エラーがあっても、できるところまでビルドを続ける', 'go on as far as possible after an error'],
  ['-j|--jobs', '同時に実行するジョブの数（`auto`、`HOST_CPUS*.5`…）', 'number of jobs to run at once (`auto`, `HOST_CPUS*.5`…)', 'arg'],
  ['-s|--subcommands', '実行するコマンドを表示するかどうか（`-s` で表示する）', 'whether to print the commands it runs (`-s`: print them)', 'attached', { ...tristate(tx('表示する', 'print them'), tx('表示しない（既定）', 'do not (the default)')), pretty_print: tx('読みやすく表示する', 'print them readably') }],
  ['--verbose_failures', '失敗したコマンドの行をすべて表示する', 'print the whole command line of a command that fails'],
  ['--define', 'ビルドの変数を設定（`名前=値`、`select` の `config_setting` が読む）', 'set a build variable (`NAME=value`, read by `config_setting` in `select`)', 'arg'],
  ['--copt', 'C と C++ のコンパイラーに渡すオプション', 'option passed to the C and C++ compiler', 'arg'],
  ['--cxxopt', 'C++ のコンパイラーに渡すオプション', 'option passed to the C++ compiler', 'arg'],
  ['--linkopt', 'リンカーに渡すオプション', 'option passed to the linker', 'arg'],
  ['--features', 'ツールチェーンの機能を有効にする（`-名前` で無効）', 'turn a toolchain feature on (`-NAME`: off)', 'arg'],
  ['--platforms', 'ビルドの対象のプラットフォーム（`platform` ルールのラベル）', 'target platform (the label of a `platform` rule)', 'arg'],
  ['--stamp', 'バイナリーに日時・ユーザー・ワークスペースの情報を埋め込む', 'stamp binaries with the date, user and workspace information'],
  ['--workspace_status_command', 'ビルドの初めにワークスペースの情報（キーと値）を出力するプログラム', 'program run at the start of the build that prints the workspace status (keys and values)', 'arg'],
  ['--action_env', 'アクションに見せる環境変数（`名前=値`、`名前` だけで今の値）', 'environment variable for the actions (`NAME=value`; `NAME` alone: its current value)', 'arg'],
  ['--spawn_strategy', 'アクションの実行のしかた（`sandboxed`、`local`、`remote`…、優先順に）', 'how to run actions (`sandboxed`, `local`, `remote`…, by priority)', 'arg'],
  ['--sandbox_debug', 'サンドボックスを残し、そのデバッグ情報を表示する', 'keep the sandboxes and print their debugging information'],
  ['--build', 'ビルドのアクションを実行する（既定。`--nobuild` で解析が済んだところで止まる）', 'run the build\'s actions (the default; `--nobuild`: stop after the analysis)'],
  ['--check_up_to_date', 'ビルドせず、最新かどうかだけを確かめる（最新でなければ失敗する）', 'do not build, only check that the outputs are up to date (fail if not)'],
  ['--output_groups', '作る出力のグループ（`+名前` で追加、`-名前` で除く）', 'output groups to build (`+NAME`: add, `-NAME`: leave out)', 'arg'],
  ['--target_pattern_file', 'ターゲットのパターンを指定したファイルから読む', 'read the target patterns from the given file', 'arg'],
  ['--build_tag_filters', '指定したタグのターゲットだけをビルドする（`-タグ` で除く）', 'build only the targets with these tags (`-TAG`: leave out)', 'arg'],
  ['--build_tests_only', 'テストのターゲットだけをビルドする', 'build only the test targets'],
  ['--test_output', 'テストの出力の見せ方（`summary`、`errors`、`all`、`streamed`）', 'how to show the tests\' output (`summary`, `errors`, `all`, `streamed`)', 'arg'],
  ['--test_filter', 'テストのフレームワークに渡す絞り込み（実行するテストケース）', 'filter passed to the test framework (which test cases run)', 'arg'],
  ['--test_arg', 'テストのプログラムに渡す引数（複数回指定可）', 'argument passed to the test program (may be repeated)', 'arg'],
  ['--test_env', 'テストに見せる環境変数（`名前=値`）', 'environment variable for the tests (`NAME=value`)', 'arg'],
  ['--test_timeout', 'テストの時間の上限の秒数（1つか、大きさごとに4つ）', 'test timeout in seconds (one, or four for the sizes)', 'arg'],
  ['--test_tag_filters', '指定したタグのテストだけを実行する（`-タグ` で除く）', 'run only the tests with these tags (`-TAG`: leave out)', 'arg'],
  ['--test_size_filters', '指定した大きさのテストだけを実行する（`small`、`medium`…）', 'run only the tests of these sizes (`small`, `medium`…)', 'arg'],
  ['--runs_per_test', '各テストを実行する回数（`回数` か `正規表現@回数`）', 'how many times to run each test (`N` or `REGEX@N`)', 'arg'],
  ['--flaky_test_attempts', '失敗したテストを試し直す回数（`回数` か `正規表現@回数`）', 'how many times to retry a failed test (`N` or `REGEX@N`)', 'arg'],
  ['-t|--cache_test_results', 'テストの結果をキャッシュから使うかどうか（`-t` で使う、`-t-`・`--nocache_test_results` で毎回実行する）', 'whether to use cached test results (`-t`: use them; `-t-`, `--nocache_test_results`: run the tests every time)', 'attached', {
    ...tristate(tx('キャッシュの結果を使う', 'use the cached results'), tx('毎回実行する', 'run the tests every time')),
    auto: tx('テストかその依存が変わったときなどだけ実行し直す（既定）', 'run a test again only when it or its dependencies changed, and the like (the default)'),
  }],
  ['--run_under', 'テストや実行するプログラムの前に付けるコマンド（`valgrind`…）', 'command put before the test or the program to run (`valgrind`…)', 'arg'],
  ['--instrumentation_filter', 'カバレッジを計る対象（正規表現の並び、`-` で除く）', 'what coverage is measured for (regular expressions; `-`: leave out)', 'arg'],
  ['--combined_report', 'まとめたカバレッジのレポートの形式（`lcov`、`none`）', 'format of the combined coverage report (`lcov`, `none`)', 'arg'],
];

/** The options of `bazel query` (cquery and aquery have an `--output` of their own). */
const QUERY: OptSpec[] = [
  ['-k|--keep_going', 'エラーがあっても、できるところまで結果を出す', 'go on and print what it can after an error'],
  ['--output', '結果の形式（`label`（既定）、`label_kind`、`package`、`build`、`graph`、`xml`…）', 'format of the results (`label`, the default; `label_kind`, `package`, `build`, `graph`, `xml`…)', 'arg'],
  ['--order_output', '結果の並べ方（`auto`、`deps`、`full`、`no`）', 'order of the results (`auto`, `deps`, `full`, `no`)', 'arg'],
  ['--implicit_deps', 'bazel が加える暗黙の依存も含める（既定。`--noimplicit_deps` で除く）', 'include the implicit dependencies bazel adds (the default; `--noimplicit_deps`: leave them out)'],
  ['--tool_deps', 'ビルドの道具（exec 構成）への依存も含める（既定。`--notool_deps` で除く）', 'include the dependencies on build tools (the exec configuration; the default; `--notool_deps`: leave them out)'],
  ['--universe_scope', '問い合わせの範囲にするターゲットのパターン（カンマ区切り）', 'target patterns whose closure the query works in (comma-separated)', 'arg'],
  ['--infer_universe_scope', '`--universe_scope` がなければ、式のターゲットのパターンを範囲にする', 'with no `--universe_scope`, take the target patterns of the expression as the scope'],
  ['--query_file', 'クエリを指定したファイルから読む', 'read the query from the given file', 'arg'],
  ['--consistent_labels', 'ラベルをいつも同じ形（Starlark の `str(Label)`）で出力する', 'print labels always in one form (Starlark\'s `str(Label)`)'],
];

const CQUERY: OptSpec[] = [
  ['--output', '結果の形式（`label`（既定）、`label_kind`、`transitions`、`starlark`、`jsonproto`…）', 'format of the results (`label`, the default; `label_kind`, `transitions`, `starlark`, `jsonproto`…)', 'arg'],
  ['--starlark:expr', '`--output=starlark` で各ターゲットに使う Starlark の式（`target` に束縛）', 'Starlark expression formatting each target with `--output=starlark` (bound to `target`)', 'arg'],
  ['--starlark:file', '`--output=starlark` で使う Starlark のファイル', 'Starlark file used with `--output=starlark`', 'arg'],
  ['--transitions', '遷移の情報の見せ方（`none`、`lite`、`full`）', 'how to print the transitions (`none`, `lite`, `full`)', 'arg'],
  ['--implicit_deps', '解決したツールチェーンも含める（既定。`--noimplicit_deps` で除く）', 'include the resolved toolchains (the default; `--noimplicit_deps`: leave them out)'],
];

const AQUERY: OptSpec[] = [
  ['--output', '結果の形式（`text`（既定）、`jsonproto`、`textproto`、`proto`）', 'format of the results (`text`, the default; `jsonproto`, `textproto`, `proto`)', 'arg'],
  ['--include_commandline', 'アクションのコマンド行を含める（既定。`--noinclude_commandline` で除く）', 'include the actions\' command lines (the default; `--noinclude_commandline`: leave them out)'],
  ['--include_artifacts', 'アクションの入力と出力の名前を含める（既定。`--noinclude_artifacts` で除く）', 'include the names of the actions\' inputs and outputs (the default; `--noinclude_artifacts`: leave them out)'],
];

// (Each pattern is read by the target patterns' reader, src/embedded/bazel.ts, which says what it selects.)
const TARGETS = operand('TARGET', 'ターゲットのパターン', 'target pattern', { repeat: '*', lang: 'bazeltarget' });
/** query, cquery and aquery join their words with spaces into one expression (`bazel query deps '(//x)'`); a word that is a target pattern is read so. */
const EXPRESSION = operand('EXPRESSION', 'クエリ式（`deps(//app:main)`、語は空白でつないで1つの式になる）', 'query expression (`deps(//app:main)`, the words joined with spaces into one)', { repeat: '*', lang: 'bazelquery' });

/**
 * Options given at the wrong place, which bazel refuses (`refused`): a command's before the command ("Unknown startup
 * option", status 2), a startup option after it ("Unrecognized option", status 2). Each keeps its value.
 */
const misplaced = (opts: OptSpec[], id: 'bazel-command-option-before-command' | 'bazel-startup-option-after-command'): OptionSpec[] =>
  opts.map(optionOf).map((o) => ({ ...o, refused: true, text: saidText(id, { what: o.text }) }));
const AFTER = misplaced(STARTUP, 'bazel-startup-option-after-command');

/** `--config` stands for options of the rc files, which this explanation cannot read. */
const withConfig = (opts: OptionSpec[]): OptionSpec[] => opts.map((o) => (o.names.includes('--config') ? { ...o, text: saidText('bazel-config') } : o));

/** A subtractive pattern before `--` (`-//app/legacy/...`, `-@repo//x`, `-:x`), which bazel reads as an option. */
const NEGATIVE = { pattern: /^-(?:\/\/|@|:)/, text: () => saidText('bazel-negative-pattern-before-dashdash') };

/** A command: its own options, the common ones, and the startup options it refuses. */
const command = (ja: string, en: string, opts: OptSpec[], rest: CmdRest = {}): CommandSpec =>
  cmd(ja, en, [...withConfig([...COMMON, ...opts].map(optionOf)), ...AFTER], { parser: 'bazel', patternOptions: [NEGATIVE], ...rest });
/** Each command, with `bazel help COMMAND` for its options not listed. */
const withHelp = (commands: Record<string, CommandSpec>): Record<string, CommandSpec> =>
  Object.fromEntries(Object.entries(commands).map(([name, spec]) => [name, { ...spec, helpCommand: `bazel help ${name}` }]));
const targets = { operands: [{ pattern: [TARGETS] }] };
const expression = { operands: [{ pattern: [EXPRESSION] }] };
// (aquery's wildcards leave out the `manual` targets, as a build's do; query's and cquery's take them.)
const aqueryExpression = { operands: [{ pattern: [{ ...EXPRESSION, lang: 'bazelaquery' as const }] }] };
// (cquery's functions are query's with `config`, without those of the graph before analysis.)
const cqueryExpression = { operands: [{ pattern: [{ ...EXPRESSION, lang: 'bazelcquery' as const }] }] };

const INFO_KEYS: Record<string, Text> = {
  workspace: tx('ワークスペースの最上位のディレクトリ', 'the top directory of the workspace'),
  execution_root: tx('アクションを実行するディレクトリ（入力と出力がすべて見える）', 'the directory the actions run in (every input and output is visible there)'),
  output_base: tx('出力の置き場所（`--output_base`）', 'the output base (`--output_base`)'),
  output_path: tx('出力のディレクトリ', 'the output directory'),
  'bazel-bin': tx('バイナリーのディレクトリ（構成ごと）', 'the directory of the binaries (per configuration)'),
  'bazel-genfiles': tx('生成したファイルのディレクトリ（構成ごと）', 'the directory of the generated files (per configuration)'),
  'bazel-testlogs': tx('テストのログのディレクトリ（構成ごと）', 'the directory of the test logs (per configuration)'),
  release: tx('bazel の版', 'the bazel release'),
  server_pid: tx('サーバーのプロセス ID', 'the server\'s process ID'),
  install_base: tx('bazel を展開したディレクトリ', 'the installation base'),
  repository_cache: tx('ダウンロードのキャッシュの場所', 'the location of the download cache'),
  command_log: tx('前のコマンドの出力のログ', 'the log of the last command\'s output'),
};

const HELP_TOPICS: Record<string, Text> = {
  startup_options: tx('起動オプション', 'the startup options'),
  'target-syntax': tx('ターゲットの書き方', 'the syntax of targets'),
  'info-keys': tx('`bazel info` のキー', 'the keys of `bazel info`'),
};

const MOD_QUERIES: Record<string, Text> = {
  graph: tx('外部の依存のグラフ全体を表示する', 'show the whole graph of external dependencies'),
  deps: tx('モジュールの直接の依存を表示する', 'show the direct dependencies of modules'),
  path: tx('モジュールへの最短の依存の経路を表示する', 'show the shortest dependency path to modules'),
  all_paths: tx('モジュールへの依存の経路をすべて表示する', 'show every dependency path to modules'),
  explain: tx('モジュールを依存として求めている場所と、版が選ばれた理由を表示する', 'show where a module is required and why its version was selected'),
  show_repo: tx('リポジトリを定義したルールを表示する', 'show the rules that define the repositories'),
  show_extension: tx('モジュール拡張の情報を表示する', 'show information on module extensions'),
  tidy: tx('`MODULE.bazel` を整形し、`use_repo` を更新する', 'format `MODULE.bazel` and update its `use_repo` calls'),
  dump_repo_mapping: tx('リポジトリの名前の対応を NDJSON で表示する', 'print the repository name mappings as NDJSON'),
};

const bazelSpec: CommandSpec = cmd('Bazel: ソースからビルドし、テストする（`bazel 起動オプション コマンド オプション ターゲット`）', 'Bazel: build and test from source (`bazel STARTUP-OPTIONS COMMAND OPTIONS TARGETS`)', [
  ...STARTUP.map(optionOf),
  ...misplaced([...COMMON, ...BUILD], 'bazel-command-option-before-command'),
], {
  parser: 'bazel',
  helpCommand: 'bazel help startup_options',
  // (Alone only: `bazel --version build` is "Unknown startup option"; `bazel --help build` shows the help of `build`.)
  soleOptions: [optionOf(['--version', '版を表示する', 'print the version']), optionOf(['-h|--help', 'コマンドの一覧と使い方を表示する', 'print the commands and how to use bazel'])],
  subcommands: withHelp({
    build: command('ターゲットをビルドする', 'Build the targets', BUILD, targets),
    test: command('ターゲットをビルドし、テストを実行する', 'Build the targets and run the tests', BUILD, targets),
    coverage: command('テストを実行し、コードのカバレッジを集める', 'Run the tests and collect code coverage', BUILD, targets),
    run: command('ターゲットをビルドして実行する（ターゲットの後の語はプログラムの引数）', 'Build the target and run it (the words after the target are its arguments)', [...BUILD,
      ['--script_path', '実行せず、ターゲットを実行するシェルスクリプトを指定したファイルに書く', 'do not run the target; write a shell script that runs it to the given file', 'arg'],
      ['--run_in_cwd', 'runfiles のディレクトリではなく、今のディレクトリで実行する', 'run in the current directory, not in the runfiles tree'],
      ['--run_env', '実行するプログラムに見せる環境変数（`名前=値`）', 'environment variable for the program run (`NAME=value`)', 'arg'],
    ], { operands: [{ pattern: [
      // ("Only a single target can be run" where a wildcard gives several: `bazel run //app/...`, status 2.)
      operand('TARGET', '実行するターゲット（`//tools:fmt`。1つのターゲットになるパターンだけ）', 'target to run (`//tools:fmt`, a pattern that gives only one target)', { repeat: '?', lang: 'bazeltarget' }),
      operand('ARGS', 'プログラムに渡す引数（`-` で始まる語は `--` の後に書く）', 'argument passed to the program (write words that start with `-` after `--`)', { repeat: '*' }),
    ] }] }),
    query: command('ターゲットの依存のグラフを問い合わせる', 'Query the target dependency graph', QUERY, expression),
    cquery: command('構成を適用したターゲットのグラフを問い合わせる', 'Query the configured target graph', [...BUILD, ...CQUERY], cqueryExpression),
    aquery: command('アクションのグラフを問い合わせる', 'Query the action graph', [...BUILD, ...AQUERY], aqueryExpression),
    info: command('サーバーとワークスペースの情報を表示する', 'Show information on the server and the workspace', [...BUILD,
      ['--show_make_env', '「Make」の変数も表示する', 'show the "Make" variables too'],
    ], { operands: [{ pattern: [operand('KEY', '表示する項目（ないときはすべて）', 'key to show (all when none is given)', { repeat: '*', values: INFO_KEYS })] }] }),
    clean: command('出力を削除する', 'Remove the outputs', [...BUILD,
      ['--expunge', '作業ツリー全体を削除し、サーバーも止める（注意）', 'remove the whole working tree and stop the server (careful)'],
      ['--async', '削除をバックグラウンドで続ける', 'go on deleting in the background'],
    ]),
    fetch: command('外部のリポジトリを取ってくる', 'Fetch external repositories', [...BUILD,
      ['--all', 'すべての外部のリポジトリを取ってくる', 'fetch every external repository'],
      ['--configure', 'システムの構成のためのリポジトリだけを取ってくる', 'fetch only the repositories marked `configure`'],
      ['--force', '既にあるリポジトリも取り直す', 'fetch the repositories again, even those already there'],
      ['--repo', '取ってくるリポジトリ（`@名前`、`@@正規の名前`）', 'repository to get (`@NAME`, `@@CANONICAL`)', 'arg'],
    ], targets),
    vendor: command('外部のリポジトリを `--vendor_dir` のディレクトリに取ってくる', 'Fetch external repositories into the directory of `--vendor_dir`', [...BUILD,
      ['--vendor_dir', '取ってきたリポジトリを置くディレクトリ', 'directory to put the fetched repositories in', 'arg'],
      ['--repo', '取ってくるリポジトリ（`@名前`、`@@正規の名前`）', 'repository to get (`@NAME`, `@@CANONICAL`)', 'arg'],
    ], targets),
    mod: command('Bzlmod の外部の依存のグラフを調べる', 'Inspect the Bzlmod external dependency graph', [
      ['--depth', '表示するグラフの深さ', 'depth of the graph shown', 'arg'],
      ['--from', 'グラフの始まりにするモジュール（既定は `<root>`）', 'modules the graph starts from (`<root>` by default)', 'arg'],
      ['--output', '形式（`text`、`json`、`graph`）', 'format (`text`, `json`, `graph`)', 'arg'],
      ['--include_unused', '使われないモジュールも表示する', 'show the unused modules too'],
    ], { operands: [{ pattern: [
      operand('QUERY', '調べ方', 'kind of query', { repeat: '?', values: MOD_QUERIES }),
      operand('ARGS', 'モジュール（`<root>`、`名前@版`、`@リポジトリ`）', 'module (`<root>`, `NAME@VERSION`, `@REPO`)', { repeat: '*' }),
    ] }] }),
    shutdown: command('bazel のサーバーを止める', 'Stop the bazel server', [
      ['--iff_heap_size_greater_than', 'JVM のメモリが指定した MB を超えるときだけ止める', 'stop only when the JVM uses more than the given MB', 'arg'],
    ]),
    version: command('bazel の版を表示する', 'Print the bazel version', [
      ['--gnu_format', 'GNU の決まりの形で表示する', 'print it in the GNU format'],
    ]),
    help: command('コマンドやオプションの説明を表示する', 'Print help on commands and options', [
      ['-l|--long', 'オプションの説明を全文表示する', 'show the whole description of each option'],
      ['--short', 'オプションの名前だけを表示する', 'show only the names of the options'],
    ], { operands: [{ pattern: [operand('TOPIC', 'コマンドの名前か項目', 'command name or topic', { repeat: '?', values: HELP_TOPICS })] }] }),
  }),
});

export const bazel: Record<string, CommandSpec> = { bazel: bazelSpec };
