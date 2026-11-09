import type { CommandSpec } from '../argv/spec';
import { cmd, operand, OptSpec } from './types';

// unused_deps, as `unused_deps -h` of buildtools 10.2.0 (bazel-contrib/buildtools) lists its flags, each fact checked with
// that release (test/unused-deps.test.ts). It asks bazel (`bazel query`, or `cquery`) for the Java rules among the target
// patterns, builds them with extra actions, and prints one buildozer command per dependency the compiler did not use
// (`buildozer 'remove deps //lib:x' //app:main`); it changes no file itself. The query it runs is
// `kind('(kt|java|android)_*', PATTERNS)`, an unanchored regular expression: a rule kind that has `kt`, `java` or
// `android` in its name (`java_library`, `java_binary`, `kt_jvm_library`, `android_library`); with no pattern it takes
// `//...`. Go's `flag` package reads its words, as buildozer's (`-name`, `--name`, `-name=value`, `-name value`; the
// first operand ends the options). `-version` prints the version whatever the patterns.

const OPTIONS: OptSpec[] = [
  ['-build_tool', '使う bazel の実行ファイル（既定は `bazel`）', 'the build executable to run (default `bazel`)', 'arg'],
  ['-cquery', '`query` の代わりに `cquery` を使う', 'use `cquery` instead of `query`'],
  ['-extra_action_file', 'bazel を動かさず、指定したファイル（extra action の結果）から使われていない依存だけを表示する', 'do not run bazel: just print the dependencies suspected unused in the given file (the result of an extra action)', 'arg'],
  ['-extra_build_flags', 'ターゲットのビルドに足す bazel のオプション（1語にまとめて書く）', 'extra flags for the build of the targets (given as one word)', 'arg'],
  ['-output_file', '`-extra_action_file` と使い、結果を標準出力でなく指定したファイルに書く', 'with `-extra_action_file`: write the result to the given file', 'arg'],
  ['-disable_symlink_safety', 'ワークスペースの外を指すシンボリックリンクにも書き込む（既定では書かない）', 'also write through symlinks that point outside the workspace (by default it does not)'],
  ['-version', '版を表示する', 'print the version'],
  ['-help|-h', '使い方を表示する（終了ステータスは 2）', 'print the usage (status 2)'],
];

export const unusedDeps: Record<string, CommandSpec> = {
  unused_deps: cmd(
    'ルール（種類の名前に `kt`、`java`、`android` の入ったもの。`java_library`、`java_binary`…）の使われていない依存を調べ、削除する buildozer コマンドを標準出力に表示する（自分では何も書き換えない）',
    'Find the unused dependencies of Java-like rules (kinds with `kt`, `java` or `android` in the name: `java_library`, `java_binary`…) and print the buildozer commands that remove them (it changes nothing itself)',
    OPTIONS,
    {
      parser: 'openssl',
      optionsFirst: true,
      helpCommand: 'unused_deps -h',
      operands: [{ pattern: [operand('TARGET', 'ターゲットのパターン（`//app:main`。省略すると `//...`）', 'target pattern (`//app:main`), `//...` when none is given', { repeat: '*', lang: 'bazeltarget' })] }],
    },
  ),
};
