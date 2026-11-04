// The shells a script can be written for, and where each feature of bash works in them: a leaf module (but for the
// syntax tree's helpers), so that src/staticword.ts (which src/dialect.ts imports) reads the same table as the dialect checks.
import { braceKind, type SyntaxNode, wordBraces } from './syntax/tree';

/** Shells a script can be written for. `sh` means "any POSIX sh" (dash, busybox ash, …). */
export type Shell = 'bash' | 'sh' | 'dash' | 'ash' | 'yash' | 'ksh' | 'mksh' | 'zsh';
export type RealShell = Exclude<Shell, 'sh'>;

/**
 * Where the shell a script is read as comes from: a ShellCheck directive, the `#!` line, the file name, or none of them
 * (the default, bash); `host`: the file type, for the shell code in a host file (a Dockerfile's RUN runs in sh, a
 * workflow step in its `shell:`), which its host decides part by part.
 */
export type ShellSource = 'directive' | 'shebang' | 'filename' | 'default' | 'host';

/** The shell a script is read as when it is not forced, and where that comes from (`default`: it says none, so bash). */
export interface ShellReading { shell: Shell; source: ShellSource }

/**
 * How a text is known to be a script of the shell it is read as (`surelyScript`, src/dialect.ts). `said`: its first line or a
 * directive says it, or someone chose (`--shell`, `-e`, the web page's reader). `name`: only its file name or an editor's
 * language does, which another shell's file may have too (`aliases.sh`, sourced by zsh), so what it fails is a warning.
 */
export type ScriptEvidence = 'said' | 'name';

/**
 * The automatic shell at a place of a document, as the page and the panel say it: a reading; `parts` in a host file
 * whose parts run in shells of their own, at a line in none of them; or `none` where the host runs the words with no
 * shell (Docker's exec form, a Python list of arguments; `ShellRegion.noShell`). `autoShellAt`, src/document.ts.
 */
export type AutoShell = ShellReading | 'parts' | 'none';

/** The shell a reading says: undefined for the default (and for no reading), the shell the explainers take when the file names none. */
export function saidShell(reading: ShellReading | undefined): Shell | undefined {
  return reading && reading.source !== 'default' ? reading.shell : undefined;
}

/**
 * Where each bash feature works, measured with bash 5.2, dash 0.5.12, busybox 1.36 ash, yash 2.55,
 * ksh93u+m 1.0.8, mksh R59 and zsh 5.9 (see test/dialect.test.ts, which re-checks the installed ones).
 * The letters are b d a y k m z. None is in POSIX before its 2024 edition; a few came in with that edition (`posixSince`),
 * which the shells named here do not all follow yet. A feature of a later bash (`SINCE` in src/bashversion.ts)
 * has no `b`: bash's own check is by its version (`dialectIssues`).
 */
export interface Feature {
  works: string;
  ja: string;
  en: string;
  altJa?: string;
  altEn?: string;
  /** What dash does with a feature it lacks, when it does not simply fail with a status where it runs. test/dialect-dash.test.ts runs every row in dash and in busybox ash. */
  dash?: InShell;
  /** The same in busybox ash. */
  ash?: InShell;
  /** The variables the row is about (`variableFeature`). */
  vars?: readonly string[];
  /** The builtins the row is about: a shell the row says lacks it runs no builtin of that name (`builtinIn`). */
  builtins?: readonly string[];
  /** The edition of POSIX that added it (IEEE Std 1003.1-2024: `$'…'` in 2.2.4, `;&` in 2.9.4.3, `pipefail` in 2.9.2, `read -d`): the sentence says so, as a shell may still lack it. */
  posixSince?: 2024;
}

/**
 * `empty`: a variable the shell does not set: status 0, and the next line runs. `refused`: a syntax error while the shell reads the text, so it stops
 * even where the text never runs (`if false`, a function not called). `stops`: it fails where it runs, and the shell stops there (bad substitution, a special builtin's error).
 * Otherwise, what it does instead, with status 0, in the words of the shell's name.
 */
export type InShell = 'empty' | 'refused' | 'stops' | { ja: (shell: string) => string; en: (shell: string) => string };

/** The rows that keep the braces, in dash and busybox ash. */
const BRACES: InShell = { ja: (sh) => `${sh} ではブレースのまま 1 つの単語になります`, en: (sh) => `in ${sh} the braces stay, as one word` };

/** What dash and busybox ash make of `$"…"`. */
const DOLLAR_THEN_QUOTE: InShell = { ja: (sh) => `${sh} では \`$\` がそのまま残ります`, en: (sh) => `in ${sh} the \`$\` stays, before the string` };

export const FEATURES: Record<string, Feature> = {
  dbracket: { works: 'bayk mz', ja: '`[[ ]]`', en: '`[[ ]]`', altJa: '`[ ]` を使う', altEn: 'use `[ ]`' },
  regex: { works: 'b  yk z', ash: { ja: (sh) => `${sh} は照合しますが、中の \`(\` は構文エラーになります`, en: (sh) => `${sh} matches it, but a \`(\` in it is a syntax error` }, ja: '`[[ =~ ]]` の正規表現マッチ', en: '`[[ =~ ]]` regex matching', altJa: '`expr` や `grep -E` を使う', altEn: 'use `expr` or `grep -E`' },
  array: { works: 'b  ykmz', dash: 'refused', ash: 'refused', ja: '配列', en: 'an array', altJa: '位置パラメータ（`set -- …`）を使う', altEn: 'use the positional parameters (`set -- …`)' },
  assoc: { works: 'b   kmz', ja: '連想配列', en: 'an associative array' },
  plusAssign: { works: 'b   kmz', ja: '`+=` による追加', en: 'appending with `+=`', altJa: '`v="${v}…"` と書く', altEn: 'write `v="${v}…"`' },
  replace: { works: 'b ayk mz', dash: 'stops', ja: '`${var/pattern/string}` の置換', en: '`${var/pattern/string}` replacement', altJa: '`sed` などを使う', altEn: 'use `sed` or similar' },
  replaceAnchor: { works: 'b  ykmz', dash: 'stops', ash: { ja: (sh) => `${sh} では置換されず、値はそのままになります`, en: (sh) => `${sh} replaces nothing, and the value stays as it is` }, ja: '`${var/#…}` / `${var/%…}` の置換', en: '`${var/#…}` / `${var/%…}` replacement' },
  caseMod: { works: 'b', dash: 'stops', ash: 'stops', ja: '`${var^^}` などの大文字・小文字変換', en: '`${var^^}`-style case conversion', altJa: '`tr` を使う', altEn: 'use `tr`' },
  substr: { works: 'b a kmz', dash: 'stops', ja: '`${var:offset:length}` の部分文字列', en: 'a `${var:offset:length}` substring', altJa: '`cut` や `expr substr` を使う', altEn: 'use `cut` or `expr substr`' },
  indirect: { works: 'b', dash: 'stops', ash: 'stops', ja: '`${!var}` の間接参照', en: '`${!var}` indirection', altJa: '`eval` を使う', altEn: 'use `eval`' },
  prefixNames: { works: 'b   k', dash: 'stops', ash: 'stops', ja: '`${!prefix*}` の変数名一覧', en: 'a `${!prefix*}` name list' },
  arrayKeys: { works: 'b   km', dash: 'stops', ash: 'stops', ja: '`${!array[@]}` のインデックス一覧', en: 'a `${!array[@]}` index list' },
  transform: { works: 'b', dash: 'stops', ash: 'stops', ja: '`${var@Q}` などの変換', en: 'a `${var@Q}`-style transformation' },
  negIndex: { works: 'b  yk z', dash: 'stops', ash: 'stops', ja: '負の添字 `${a[-1]}`', en: 'a negative subscript `${a[-1]}`' },
  funcKeyword: { works: 'b aykmz', dash: 'refused', ja: '`function` キーワードによる関数定義', en: 'the `function` keyword', altJa: '`name() { … }` と書く', altEn: 'write `name() { … }`' },
  herestring: { works: 'b  ykmz', dash: 'refused', ash: 'refused', ja: 'ヒアストリング `<<<`', en: 'a here-string `<<<`', altJa: '`printf \'%s\\n\' … |` やヒアドキュメントを使う', altEn: 'use `printf \'%s\\n\' … |` or a here-document' },
  ansiC: { works: 'b a kmz', posixSince: 2024, ja: '`$\'…\'` の文字列', en: 'a `$\'…\'` string', altJa: '`printf` を使う', altEn: 'use `printf`', dash: { ja: (sh) => `${sh} では \`$\` と引用符の中の文字のままになります`, en: (sh) => `${sh} reads a \`$\` and then a quoted string` } },
  // (dash ends the quote at the `\'`: the rest of the word, from the `'` after it, is another quoted string.)
  ansiCQuote: { works: 'b a kmz', posixSince: 2024, dash: 'stops', ja: '`\\\'` を含む `$\'…\'` の文字列', en: 'a `$\'…\'` string with `\\\'` in it', altJa: '`printf` を使う（dash では `\\\'` で引用が終わり、その後の `\'` からスクリプトの次の `\'` までが別の引用になる。次の `\'` が無ければ構文エラー）', altEn: 'use `printf` (dash ends the quote at the `\\\'`, and the `\'` after it opens another quoted string up to the next `\'` of the script, or a syntax error if there is none)' },
  // (What dash and busybox ash do is measured; POSIX leaves a `$` before a quote unspecified. Other shells are not run on this: their letters say nothing is claimed there.)
  translated: { works: 'b  ykmz', dash: DOLLAR_THEN_QUOTE, ash: DOLLAR_THEN_QUOTE, ja: '`$"…"` の文字列', en: 'a `$"…"` string', altJa: '`"…"` と書く', altEn: 'write `"…"`' },
  procSub: { works: 'b ayk z', dash: 'refused', ja: 'プロセス置換 `<(…)` / `>(…)`', en: 'process substitution `<(…)` / `>(…)`', altJa: '一時ファイルや名前付きパイプを使う', altEn: 'use a temporary file or a named pipe' },
  ampRedirect: { works: 'b a kmz', ja: '`&>`（標準出力と標準エラー出力をまとめてリダイレクト）', en: '`&>` (redirect stdout and stderr together)', altJa: '`>file 2>&1` と書く', altEn: 'write `>file 2>&1`', dash: { ja: (sh) => `${sh} では \`cmd &\` と \`>file\` に分かれ、コマンドの出力はそのままで、ファイルは空になります`, en: (sh) => `${sh} reads \`cmd &\` and \`>file\`: the output is not redirected, and the file is emptied` } },
  ampAppend: { works: 'b    mz', ash: 'refused', ja: '`&>>`', en: '`&>>`', altJa: '`>>file 2>&1` と書く', altEn: 'write `>>file 2>&1`', dash: { ja: (sh) => `${sh} では \`cmd &\` と \`>>file\` に分かれ、コマンドの出力はそのままで、ファイルには何も足されません`, en: (sh) => `${sh} reads \`cmd &\` and \`>>file\`: the output is not redirected, and nothing is added to the file` } },
  // (Measured by the probe in test/dialect.test.ts: bash and yash connect, dash does not (yash in CI, where it is
  // installed). The others are from their documentation: ksh93 connects for `/dev/tcp` and `/dev/udp`; busybox
  // ash, mksh and zsh have no such names.)
  netRedirect: { works: 'b  yk', ja: '`/dev/tcp/ホスト/ポート` へのリダイレクトによるネットワーク接続', en: 'a network connection by redirecting to `/dev/tcp/host/port`', altJa: '`nc` などのコマンドを使う', altEn: 'use a command such as `nc`' },
  pipeAmp: { works: 'b     z', dash: 'refused', ash: 'refused', ja: '`|&`（標準エラー出力もパイプに流す）', en: '`|&` (pipe stderr too)', altJa: '`2>&1 |` と書く', altEn: 'write `2>&1 |`' },
  eqeqTest: { works: 'b ayk m', ja: '`[ a == b ]` や `test a == b` の `==`', en: '`==` in `[ ]` or `test`', altJa: '`=` を使う', altEn: 'use `=`' },
  arithCommand: { works: 'b   kmz', ja: '算術コマンド `(( ))`', en: 'the arithmetic command `(( ))`', altJa: '`[ "$((式))" -ne 0 ]` と書く', altEn: 'write `[ "$((expr))" -ne 0 ]`' },
  cFor: { works: 'b   k z', dash: 'refused', ash: 'refused', ja: 'C 言語風の `for (( ; ; ))`', en: 'C-style `for (( ; ; ))`', altJa: '`while` と `$(( ))` で書く', altEn: 'use `while` with `$(( ))`' },
  braceRange: { works: 'b   k z', ja: 'ブレース展開 `{1..3}`', en: 'a brace range `{1..3}`', altJa: '`seq` を使う', altEn: 'use `seq`', dash: BRACES, ash: BRACES },
  braceList: { works: 'b   kmz', ja: 'ブレース展開 `{a,b}`', en: 'brace expansion `{a,b}`', dash: BRACES, ash: BRACES },
  caseFall: { works: 'b   kmz', posixSince: 2024, dash: 'refused', ash: 'refused', ja: '`case` の `;&`（次の分岐へ続ける）', en: '`;&` in `case` (fall through)' },
  caseCont: { works: 'b    m', dash: 'refused', ash: 'refused', ja: '`case` の `;;&`（続けて次のパターンも調べる）', en: '`;;&` in `case` (test the next patterns too)' },
  extglob: { works: 'b   km', dash: 'refused', ash: 'refused', ja: '拡張グロブ `@(…)` など', en: 'an extended glob like `@(…)`' },
  select: { works: 'b   kmz', dash: 'refused', ash: 'refused', ja: '`select` ループ', en: 'a `select` loop' },
  local: { works: 'bday mz', builtins: ['local'], ja: '`local`', en: '`local`' },
  declare: { works: 'b     z', builtins: ['declare'], ja: '`declare`', en: '`declare`' },
  typeset: { works: 'b  ykmz', builtins: ['typeset'], ja: '`typeset`', en: '`typeset`' },
  readarray: { works: 'b', builtins: ['readarray', 'mapfile'], ja: '`readarray` / `mapfile`', en: '`readarray` / `mapfile`', altJa: '`while read` で1行ずつ読む', altEn: 'read lines with `while read`' },
  source: { works: 'b a kmz', builtins: ['source'], ja: '`source`', en: '`source`', altJa: '`.` を使う', altEn: 'use `.`' },
  let: { works: 'b a kmz', builtins: ['let'], ja: '`let`', en: '`let`', altJa: '`$(( ))` を使う', altEn: 'use `$(( ))`' },
  shopt: { works: 'b', builtins: ['shopt'], ja: '`shopt`', en: '`shopt`' },
  pushd: { works: 'b  y  z', builtins: ['pushd', 'popd', 'dirs'], ja: '`pushd` / `popd`', en: '`pushd` / `popd`', altJa: '`cd` と変数で戻り先を覚える', altEn: 'remember the directory in a variable and `cd`' },
  exportF: { works: 'b', dash: 'stops', ash: 'stops', ja: '`export -f`', en: '`export -f`' },
  waitN: { works: 'b a', ja: '`wait -n`', en: '`wait -n`' },
  coproc: { works: 'b     z', ja: '`coproc`', en: '`coproc`' },
  print: { works: '    kmz', builtins: ['print'], ja: '`print`', en: '`print`', altJa: '`printf \'%s\\n\'` を使う', altEn: 'use `printf \'%s\\n\'`' },
  whence: { works: '    kmz', builtins: ['whence'], ja: '`whence`', en: '`whence`', altJa: '`command -v` を使う', altEn: 'use `command -v`' },
  typeT: { works: 'b   k', ash: { ja: (sh) => `${sh} の \`type -t\` は種類ではなく名前を表示します`, en: (sh) => `${sh}'s \`type -t\` prints the name, not the kind` }, ja: '`type -t`', en: '`type -t`', altJa: '`command -v` を使う', altEn: 'use `command -v`' },
  printfV: { works: 'b   k z', ash: { ja: (sh) => `${sh} は \`-v\` を文字として表示し、変数を設定しません`, en: (sh) => `${sh} prints \`-v\` as text, and sets no variable` }, ja: '`printf -v`', en: '`printf -v`', altJa: '`v=$(printf …)` と書く', altEn: 'write `v=$(printf …)`' },
  printfQ: { works: 'b     z', ja: '`printf %q`', en: '`printf %q`' },
  echoE: { works: 'b a kmz', ja: '`echo -e`', en: '`echo -e`', altJa: '`printf` を使う（dash の `echo` は `\\t` などを常に解釈する）', altEn: 'use `printf` (dash\'s `echo` always interprets `\\t` and friends)', dash: { ja: (sh) => `${sh} の \`echo\` は \`-e\` を文字として表示します`, en: (sh) => `${sh}'s \`echo\` prints \`-e\` as text` } },
  echoN: { works: 'bda kmz', ja: '`echo -n`', en: '`echo -n`', altJa: '`printf` を使う', altEn: 'use `printf`' },
  readA: { works: 'b   k', ja: '`read -a`', en: '`read -a`' },
  readP: { works: 'bday', ja: '`read -p`（プロンプト）', en: '`read -p` (prompt)', altJa: '`printf` でプロンプトを出してから `read` する（ksh/mksh/zsh の `-p` は別の意味）', altEn: 'print the prompt with `printf`, then `read` (`-p` means something else in ksh, mksh and zsh)' },
  readOpts: { works: 'b a kmz', ja: '`read` の `-n` / `-s` / `-t`', en: '`read -n` / `-s` / `-t`' },
  readD: { works: 'b a kmz', posixSince: 2024, ja: '`read -d`', en: '`read -d`' },
  pipefail: { works: 'b aykmz', posixSince: 2024, dash: 'stops', ja: '`set -o pipefail`', en: '`set -o pipefail`' },
  trapErr: { works: 'b a kmz', ja: '`trap … ERR`', en: '`trap … ERR`' },
  errtrace: { works: 'bda   z', ja: '`set -E`', en: '`set -E`' },
  random: { works: 'b aykmz', vars: ['RANDOM'], ja: '`$RANDOM`', en: '`$RANDOM`', altJa: '`awk \'BEGIN{srand(); print int(rand()*32768)}\'` などを使う', altEn: 'use e.g. `awk \'BEGIN{srand(); print int(rand()*32768)}\'`', dash: 'empty' },
  seconds: { works: 'b   kmz', vars: ['SECONDS'], ja: '`$SECONDS`', en: '`$SECONDS`', dash: 'empty', ash: 'empty' },
  pipestatus: { works: 'b    m', vars: ['PIPESTATUS'], ja: '`$PIPESTATUS`', en: '`$PIPESTATUS`', dash: 'empty', ash: 'empty' },
  bashVar: { works: 'b', ja: 'bash 専用の変数', en: 'a bash-only variable', dash: 'empty', ash: 'empty' },
  // (busybox ash sets them too; of the shells not run here, mksh has `$EPOCHREALTIME`, as the letters of `bashVar` said nothing of.)
  epoch: { works: 'b a', vars: ['EPOCHSECONDS', 'EPOCHREALTIME'], ja: '`$EPOCHSECONDS` / `$EPOCHREALTIME`', en: '`$EPOCHSECONDS` / `$EPOCHREALTIME`', dash: 'empty' },
  // (Other shells than dash and busybox ash are not run on these: their letters say nothing is claimed there.)
  setByBash: { works: 'b  ykmz', vars: ['OSTYPE', 'HOSTTYPE', 'MACHTYPE', 'REPLY', 'SHELLOPTS', 'GROUPS', 'DIRSTACK'], ja: 'bash が設定する変数', en: 'a variable bash sets', dash: 'empty', ash: 'empty' },
  funcname: { works: 'b a', vars: ['FUNCNAME'], ja: '`$FUNCNAME`', en: '`$FUNCNAME`', dash: 'empty' },
  uid: { works: 'b     z', vars: ['UID', 'EUID'], ja: '`$UID` / `$EUID`', en: '`$UID` / `$EUID`', altJa: '`$(id -u)` を使う', altEn: 'use `$(id -u)`', dash: 'empty', ash: 'empty' },
  hostname: { works: 'b a', vars: ['HOSTNAME'], ja: '`$HOSTNAME`', en: '`$HOSTNAME`', altJa: '`$(hostname)` を使う', altEn: 'use `$(hostname)`', dash: 'empty' },
  funsub: { works: '    km', dash: 'stops', ash: 'stops', ja: '`${ …; }`（現在のシェルで実行するコマンド置換）', en: '`${ …; }` (command substitution in the current shell)', altJa: '`$(…)` を使う（サブシェルで実行される）', altEn: 'use `$(…)` (it runs in a subshell)' },
  valsub: { works: '     m', dash: 'stops', ash: 'stops', ja: '`${| …; }`（`REPLY` の値になるコマンド置換）', en: '`${| …; }` (command substitution that gives the value of `REPLY`)', altJa: '関数の中で `REPLY` を設定し、呼び出したあとで `$REPLY` を読む', altEn: 'set `REPLY` in a function, call it, then read `$REPLY`' },
};

export const LETTER: Record<RealShell, string> = { bash: 'b', dash: 'd', ash: 'a', yash: 'y', ksh: 'k', mksh: 'm', zsh: 'z' };

export function works(f: Feature, shell: RealShell): boolean {
  return f.works.includes(LETTER[shell]);
}

/** Whether feature `id` of FEATURES works in `shell` (bash when absent; `sh` may be any, so none is counted on there). */
export function featureWorks(id: string, shell?: Shell): boolean {
  return !shell || (shell !== 'sh' && works(FEATURES[id], shell as RealShell));
}

/** The row of FEATURES about the builtin `name`, if any. */
const builtinRow = (name: string): Feature | undefined => Object.values(FEATURES).find((f) => f.builtins?.includes(name));

/** The shells run for what they do with what they lack (the rows' `dash` and `ash`). */
export type Measured = 'dash' | 'ash';
/** The common `/bin/sh` implementations: what they both run is counted on in a sh script (`local`, not POSIX, is there in both). */
export const COMMON_SH: readonly Measured[] = ['dash', 'ash'];

/**
 * Whether `shell` (bash when absent) has a builtin of this name, as far as the table says: the row of the builtin, where it has one.
 * In `sh`, where the common shells differ, the one that lacks it decides: `source` fails in dash, so it is not counted on.
 */
export function builtinIn(name: string, shell?: Shell): boolean {
  const row = builtinRow(name);
  if (!row) return true;
  return shell === 'sh' ? COMMON_SH.every((sh) => works(row, sh)) : works(row, shell ?? 'bash');
}

/** The feature of a brace expression: a list (`{a,b}`) or a sequence (`{1..3}`). */
const braceFeature = (b: SyntaxNode): string => (braceKind(b) === 'sequence' ? 'braceRange' : 'braceList');

/**
 * Whether the shell brace-expands the word `n`: every kind of brace expression in it must work there. (dash and POSIX
 * sh have no brace expansion, mksh no ranges: `echo {a,b}` prints `{a,b}` in dash.)
 */
export function bracesWork(n: SyntaxNode, shell?: Shell): boolean {
  return wordBraces(n).every((b) => featureWorks(braceFeature(b), shell));
}

/** Whether `shell` may brace-expand the word `n`: a kind of brace expression in it works there (dash: none; mksh: `{a,b}`, not `{1..3}`). */
export function bracesMayWork(n: SyntaxNode, shell?: Shell): boolean {
  return wordBraces(n).some((b) => featureWorks(braceFeature(b), shell));
}
