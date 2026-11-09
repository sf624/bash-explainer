import type { CommandSpec, PatternOption } from '../argv/spec';
import { tx } from '../i18n';
import { cmd, OptSpec, pos } from './types';

// cc, c++, g++, clang and clang++ read gcc's command line (Clang takes GCC's options): one spec, with the differences of
// each compiler. Each option is checked with the real compilers (test/c-compilers.test.ts).
/** The options of gcc, which g++, cc, c++, clang and clang++ take as their own (Clang takes GCC's command line). */
const C_COMPILER_OPTIONS: OptSpec[] = [
    ['-o', '出力するファイル名', 'output file', 'arg'], ['-c', 'コンパイルだけしてリンクしない（.o を作る）', 'compile only, do not link (make .o files)'],
    ['-g', 'デバッグ情報を入れる', 'include debug information'], ['-O0', '最適化しない', 'no optimisation'], ['-O2', '一般的な最適化', 'usual optimisation'],
    ['-O3', 'より強い最適化', 'more optimisation'], ['-Os', 'サイズを小さくする最適化', 'optimise for size'], ['-Wall', '主な警告を有効にする', 'enable the common warnings'],
    ['-Wextra', '追加の警告を有効にする', 'enable extra warnings'], ['-Werror', '警告をエラーにする', 'treat warnings as errors'],
    ['-shared', '共有ライブラリを作る', 'build a shared library'], ['-fPIC', '位置独立コードを作る（共有ライブラリ向け）', 'position-independent code (for shared libraries)'],
    ['-static', '静的にリンクする', 'link statically'], ['-dumpversion', 'コンパイラの版だけを表示する', 'print only the compiler version'], ['-dumpmachine', '対象のアーキテクチャを表示する', 'print the target triple'],
  ['-std', '言語の規格（`-std=c17`、`-std=c++17`…）', 'language standard (`-std=c17`, `-std=c++17`…)', 'arg'], ['-x', '以降の入力ファイルの言語（`c`、`c++`、`none`…）', 'language of the input files that follow (`c`, `c++`, `none`…)', 'arg'],
  ['-E', 'プリプロセスだけして止まる', 'preprocess only'], ['-S', 'アセンブリ言語にして止まる（.s を作る）', 'stop after generating assembly (make .s files)'],
  ['-I', 'ヘッダーを探すディレクトリを追加する', 'add a directory to search for headers', 'arg'], ['-L', 'ライブラリを探すディレクトリを追加する', 'add a directory to search for libraries', 'arg'],
  ['-l', '指定したライブラリ（`libNAME`）をリンクする', 'link with the library `libNAME`', 'arg'], ['-D', 'マクロを定義する（`NAME` か `NAME=値`）', 'define a macro (`NAME` or `NAME=value`)', 'arg'],
  ['-U', 'マクロを未定義にする', 'undefine a macro', 'arg'], ['-pedantic', '規格に反する書き方に警告を出す', 'warn about code that is not standard'],
  ['-w', '警告をすべて出さない', 'suppress all warnings'], ['-v', '呼び出すプログラムと版を表示する', 'show the programs run and the version'],
  ['-pthread', 'スレッド（POSIX threads）を使う', 'support POSIX threads'], ['-fsanitize', '実行時の検査を入れる（`address`、`undefined`…）', 'add run-time checks (`address`, `undefined`…)', 'arg'],
  ['-fopenmp', 'OpenMP の指示を有効にする', 'enable OpenMP directives'], ['-march', '使う CPU の命令セット（`native`…）', 'target CPU (`native`…)', 'arg'],
];
/** Only GCC has these. */
const GCC_EXTRA: OptSpec[] = [['-fanalyzer', '静的解析をかける', 'run the static analyzer'], ['-fdiagnostics-color', 'メッセージに色を付ける（`=always`、`=never`、`=auto`）', 'colour the messages (`=always`, `=never`, `=auto`)', 'attached']];
/** Only Clang has these. */
const CLANG_EXTRA: OptSpec[] = [['-Weverything', 'すべての警告を有効にする', 'enable every warning'], ['-fcolor-diagnostics', 'メッセージに色を付ける', 'colour the messages']];
/** The options whose value is written in the same word: `-lm`, `-Iinc`, `-DNAME=1`, `-Wl,--as-needed`. */
const C_COMPILER_ATTACHED: PatternOption[] = [
  { pattern: /^-I(.+)$/, text: ([, v]) => tx(`ヘッダーを探すディレクトリ \`${v}\` を追加する`, `add \`${v}\` to the directories searched for headers`) },
  { pattern: /^-L(.+)$/, text: ([, v]) => tx(`ライブラリを探すディレクトリ \`${v}\` を追加する`, `add \`${v}\` to the directories searched for libraries`) },
  { pattern: /^-l(.+)$/, text: ([, v]) => tx(`ライブラリ \`lib${v}\` をリンクする`, `link with the library \`lib${v}\``) },
  { pattern: /^-D(.+)$/, text: ([, v]) => tx(`マクロ \`${v}\` を定義する（\`=\` がなければ 1）`, `define the macro \`${v}\` (as 1 without \`=\`)`) },
  { pattern: /^-U(.+)$/, text: ([, v]) => tx(`マクロ \`${v}\` を未定義にする`, `undefine the macro \`${v}\``) },
  { pattern: /^-Wl,(.+)$/, text: ([, v]) => tx(`リンカーに渡す: \`${v.replace(/,/g, ' ')}\``, `pass to the linker: \`${v.replace(/,/g, ' ')}\``) },
];
const cCompiler = (ja: string, en: string, extra: OptSpec[] = []): CommandSpec => cmd(ja, en, [...C_COMPILER_OPTIONS, ...extra], { positional: [pos('ソースファイル', 'source file')], parser: 'single-dash', patternOptions: C_COMPILER_ATTACHED });

export const cCompilers: Record<string, CommandSpec> = {
  gcc: cCompiler('C コンパイラ（GCC）', 'C compiler (GCC)', GCC_EXTRA),
  // `cc` and `c++` are the system's choice (a link to gcc or g++ on most Linux systems, clang on macOS and FreeBSD).
  cc: cCompiler('C コンパイラ（システムの標準。多くの Linux では GCC）', 'C compiler (the system\'s default; GCC on most Linux systems)'),
  'c++': cCompiler('C++ コンパイラ（システムの標準。多くの Linux では g++）', 'C++ compiler (the system\'s default; g++ on most Linux systems)'),
  'g++': cCompiler('C++ コンパイラ（GCC）。`.c` も C++ として扱い、libstdc++ をリンクする', 'C++ compiler (GCC): reads `.c` files as C++ too and links libstdc++', GCC_EXTRA),
  clang: cCompiler('C コンパイラ（Clang）', 'C compiler (Clang)', CLANG_EXTRA),
  'clang++': cCompiler('C++ コンパイラ（Clang）。`.c` も C++ として扱う', 'C++ compiler (Clang): reads `.c` files as C++ too', CLANG_EXTRA),
};
