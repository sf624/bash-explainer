// The shells a script can be written for, and where each feature of bash works in them: a leaf module, so that
// src/staticword.ts (which src/dialect.ts imports) reads the same table as the dialect checks.

/** Shells a script can be written for. `sh` means "any POSIX sh" (dash, busybox ash, …). */
export type Shell = 'bash' | 'sh' | 'dash' | 'ash' | 'yash' | 'ksh' | 'mksh' | 'zsh';
export type RealShell = Exclude<Shell, 'sh'>;

/**
 * Where each bash feature works, measured with bash 5.2, dash 0.5.12, busybox 1.36 ash, yash 2.55,
 * ksh93u+m 1.0.8, mksh R59 and zsh 5.9 (see test/dialect.test.ts, which re-checks the installed ones).
 * The letters are b d a y k m z; none of them is in POSIX sh. A feature of a later bash (`SINCE` in src/bashversion.ts)
 * has no `b`: bash's own check is by its version (`dialectIssues`).
 */
export interface Feature { works: string; ja: string; en: string; altJa?: string; altEn?: string }

export const FEATURES: Record<string, Feature> = {
  dbracket: { works: 'bayk mz', ja: '`[[ ]]`', en: '`[[ ]]`', altJa: '`[ ]` を使う', altEn: 'use `[ ]`' },
  regex: { works: 'b  yk z', ja: '`[[ =~ ]]` の正規表現マッチ', en: '`[[ =~ ]]` regex matching', altJa: '`expr` や `grep -E` を使う', altEn: 'use `expr` or `grep -E`' },
  array: { works: 'b  ykmz', ja: '配列', en: 'arrays', altJa: '位置パラメータ（`set -- …`）を使う', altEn: 'use the positional parameters (`set -- …`)' },
  assoc: { works: 'b   kmz', ja: '連想配列', en: 'associative arrays' },
  plusAssign: { works: 'b   kmz', ja: '`+=` による追加', en: 'appending with `+=`', altJa: '`v="${v}…"` と書く', altEn: 'write `v="${v}…"`' },
  replace: { works: 'b ayk mz', ja: '`${var/pattern/string}` の置換', en: '`${var/pattern/string}` replacement', altJa: '`sed` などを使う', altEn: 'use `sed` or similar' },
  replaceAnchor: { works: 'b  ykmz', ja: '`${var/#…}` / `${var/%…}` の置換', en: '`${var/#…}` / `${var/%…}` replacement' },
  caseMod: { works: 'b', ja: '`${var^^}` などの大文字・小文字変換', en: '`${var^^}`-style case conversion', altJa: '`tr` を使う', altEn: 'use `tr`' },
  substr: { works: 'b a kmz', ja: '`${var:offset:length}` の部分文字列', en: '`${var:offset:length}` substrings', altJa: '`cut` や `expr substr` を使う', altEn: 'use `cut` or `expr substr`' },
  indirect: { works: 'b', ja: '`${!var}` の間接参照', en: '`${!var}` indirection', altJa: '`eval` を使う', altEn: 'use `eval`' },
  prefixNames: { works: 'b   k', ja: '`${!prefix*}` の変数名一覧', en: '`${!prefix*}` name lists' },
  arrayKeys: { works: 'b   km', ja: '`${!array[@]}` のインデックス一覧', en: '`${!array[@]}` index lists' },
  transform: { works: 'b', ja: '`${var@Q}` などの変換', en: '`${var@Q}`-style transformations' },
  negIndex: { works: 'b  yk z', ja: '負の添字 `${a[-1]}`', en: 'negative subscripts `${a[-1]}`' },
  funcKeyword: { works: 'b aykmz', ja: '`function` キーワードによる関数定義', en: 'the `function` keyword', altJa: '`name() { … }` と書く', altEn: 'write `name() { … }`' },
  herestring: { works: 'b  ykmz', ja: 'ヒアストリング `<<<`', en: 'here-strings `<<<`', altJa: '`printf \'%s\\n\' … |` やヒアドキュメントを使う', altEn: 'use `printf \'%s\\n\' … |` or a here-document' },
  ansiC: { works: 'b a kmz', ja: '`$\'…\'` の文字列', en: '`$\'…\'` strings', altJa: '`printf` を使う', altEn: 'use `printf`' },
  procSub: { works: 'b ayk z', ja: 'プロセス置換 `<(…)` / `>(…)`', en: 'process substitution `<(…)` / `>(…)`', altJa: '一時ファイルや名前付きパイプを使う', altEn: 'use a temporary file or a named pipe' },
  ampRedirect: { works: 'b a kmz', ja: '`&>`（標準出力と標準エラー出力をまとめてリダイレクト）', en: '`&>` (redirect stdout and stderr together)', altJa: '`>file 2>&1` と書く（dash では `cmd &> file` が「バックグラウンド実行 + 空のリダイレクト」と解釈される）', altEn: 'write `>file 2>&1` (dash reads `cmd &> file` as "run in the background, then an empty redirection")' },
  ampAppend: { works: 'b    mz', ja: '`&>>`', en: '`&>>`', altJa: '`>>file 2>&1` と書く', altEn: 'write `>>file 2>&1`' },
  // (Measured by the probe in test/dialect.test.ts: bash and yash connect, dash does not (yash in CI, where it is
  // installed). The others are from their documentation: ksh93 connects for `/dev/tcp` and `/dev/udp`; busybox
  // ash, mksh and zsh have no such names.)
  netRedirect: { works: 'b  yk', ja: '`/dev/tcp/ホスト/ポート` へのリダイレクトによるネットワーク接続', en: 'network connections by redirecting to `/dev/tcp/host/port`', altJa: '`nc` などのコマンドを使う', altEn: 'use a command such as `nc`' },
  pipeAmp: { works: 'b     z', ja: '`|&`（標準エラー出力もパイプに流す）', en: '`|&` (pipe stderr too)', altJa: '`2>&1 |` と書く', altEn: 'write `2>&1 |`' },
  eqeqTest: { works: 'b ayk m', ja: '`[ a == b ]` の `==`', en: '`==` in `[ ]`', altJa: '`=` を使う', altEn: 'use `=`' },
  arithCommand: { works: 'b   kmz', ja: '算術コマンド `(( ))`', en: 'the arithmetic command `(( ))`', altJa: '`[ "$((式))" -ne 0 ]` と書く', altEn: 'write `[ "$((expr))" -ne 0 ]`' },
  cFor: { works: 'b   k z', ja: 'C 言語風の `for (( ; ; ))`', en: 'C-style `for (( ; ; ))`', altJa: '`while` と `$(( ))` で書く', altEn: 'use `while` with `$(( ))`' },
  braceRange: { works: 'b   k z', ja: 'ブレース展開 `{1..3}`', en: 'brace ranges `{1..3}`', altJa: '`seq` を使う', altEn: 'use `seq`' },
  braceList: { works: 'b   kmz', ja: 'ブレース展開 `{a,b}`', en: 'brace expansion `{a,b}`' },
  caseFall: { works: 'b   kmz', ja: '`case` の `;&`（次の分岐へ続ける）', en: '`;&` in `case` (fall through)' },
  caseCont: { works: 'b    m', ja: '`case` の `;;&`（続けて次のパターンも調べる）', en: '`;;&` in `case` (test the next patterns too)' },
  extglob: { works: 'b   km', ja: '拡張グロブ `@(…)` など', en: 'extended globs like `@(…)`' },
  select: { works: 'b   kmz', ja: '`select` ループ', en: '`select` loops' },
  local: { works: 'bday mz', ja: '`local`', en: '`local`' },
  declare: { works: 'b     z', ja: '`declare`', en: '`declare`' },
  typeset: { works: 'b  ykmz', ja: '`typeset`', en: '`typeset`' },
  readarray: { works: 'b', ja: '`readarray` / `mapfile`', en: '`readarray` / `mapfile`', altJa: '`while read` で1行ずつ読む', altEn: 'read lines with `while read`' },
  source: { works: 'b a kmz', ja: '`source`', en: '`source`', altJa: '`.` を使う', altEn: 'use `.`' },
  let: { works: 'b a kmz', ja: '`let`', en: '`let`', altJa: '`$(( ))` を使う', altEn: 'use `$(( ))`' },
  shopt: { works: 'b', ja: '`shopt`', en: '`shopt`' },
  pushd: { works: 'b  y  z', ja: '`pushd` / `popd`', en: '`pushd` / `popd`', altJa: '`cd` と変数で戻り先を覚える', altEn: 'remember the directory in a variable and `cd`' },
  exportF: { works: 'b', ja: '`export -f`', en: '`export -f`' },
  waitN: { works: 'b a', ja: '`wait -n`', en: '`wait -n`' },
  coproc: { works: 'b     z', ja: '`coproc`', en: '`coproc`' },
  print: { works: '    kmz', ja: '`print`', en: '`print`', altJa: '`printf \'%s\\n\'` を使う', altEn: 'use `printf \'%s\\n\'`' },
  whence: { works: '    kmz', ja: '`whence`', en: '`whence`', altJa: '`command -v` を使う', altEn: 'use `command -v`' },
  typeT: { works: 'b   k', ja: '`type -t`', en: '`type -t`', altJa: '`command -v` を使う', altEn: 'use `command -v`' },
  printfV: { works: 'b   k z', ja: '`printf -v`', en: '`printf -v`', altJa: '`v=$(printf …)` と書く', altEn: 'write `v=$(printf …)`' },
  printfQ: { works: 'b     z', ja: '`printf %q`', en: '`printf %q`' },
  echoE: { works: 'b a kmz', ja: '`echo -e`', en: '`echo -e`', altJa: '`printf` を使う（dash の echo は `-e` を文字として表示し、`\\t` などは常に解釈する）', altEn: 'use `printf` (dash prints `-e` literally and always interprets `\\t` and friends)' },
  echoN: { works: 'bda kmz', ja: '`echo -n`', en: '`echo -n`', altJa: '`printf` を使う', altEn: 'use `printf`' },
  readA: { works: 'b   k', ja: '`read -a`', en: '`read -a`' },
  readP: { works: 'bday', ja: '`read -p`（プロンプト）', en: '`read -p` (prompt)', altJa: '`printf` でプロンプトを出してから `read` する（ksh/mksh/zsh の `-p` は別の意味）', altEn: 'print the prompt with `printf`, then `read` (`-p` means something else in ksh, mksh and zsh)' },
  readOpts: { works: 'b a kmz', ja: '`read` の `-n` / `-s` / `-t` / `-d`', en: '`read -n` / `-s` / `-t` / `-d`' },
  pipefail: { works: 'b aykmz', ja: '`set -o pipefail`', en: '`set -o pipefail`' },
  trapErr: { works: 'b a kmz', ja: '`trap … ERR`', en: '`trap … ERR`' },
  errtrace: { works: 'bda   z', ja: '`set -E`', en: '`set -E`' },
  random: { works: 'b aykmz', ja: '`$RANDOM`', en: '`$RANDOM`', altJa: '`awk \'BEGIN{srand(); print int(rand()*32768)}\'` などを使う', altEn: 'use e.g. `awk \'BEGIN{srand(); print int(rand()*32768)}\'`' },
  seconds: { works: 'b   kmz', ja: '`$SECONDS`', en: '`$SECONDS`' },
  pipestatus: { works: 'b    m', ja: '`$PIPESTATUS`', en: '`$PIPESTATUS`' },
  bashVar: { works: 'b', ja: 'bash 専用の変数', en: 'bash-only variables' },
  funcname: { works: 'b a', ja: '`$FUNCNAME`', en: '`$FUNCNAME`' },
  uid: { works: 'b     z', ja: '`$UID` / `$EUID`', en: '`$UID` / `$EUID`', altJa: '`$(id -u)` を使う', altEn: 'use `$(id -u)`' },
  hostname: { works: 'b a', ja: '`$HOSTNAME`', en: '`$HOSTNAME`', altJa: '`$(hostname)` を使う', altEn: 'use `$(hostname)`' },
  funsub: { works: '    km', ja: '`${ …; }`（現在のシェルで実行するコマンド置換）', en: '`${ …; }` (command substitution in the current shell)', altJa: '`$(…)` を使う（サブシェルで実行される）', altEn: 'use `$(…)` (it runs in a subshell)' },
  valsub: { works: '     m', ja: '`${| …; }`（`REPLY` の値になるコマンド置換）', en: '`${| …; }` (command substitution that gives the value of `REPLY`)', altJa: '関数の中で `REPLY` を設定し、呼び出したあとで `$REPLY` を読む', altEn: 'set `REPLY` in a function, call it, then read `$REPLY`' },
};

export const LETTER: Record<RealShell, string> = { bash: 'b', dash: 'd', ash: 'a', yash: 'y', ksh: 'k', mksh: 'm', zsh: 'z' };

export function works(f: Feature, shell: RealShell): boolean {
  return f.works.includes(LETTER[shell]);
}

/** Whether feature `id` of FEATURES works in `shell` (bash when absent; POSIX sh has none of them). */
export function featureWorks(id: string, shell?: Shell): boolean {
  return !shell || (shell !== 'sh' && works(FEATURES[id], shell as RealShell));
}

/**
 * Whether the shell brace-expands the word of plain text `text` (one that has a brace expansion): every kind in it must
 * work there. (dash and POSIX sh have no brace expansion, mksh no ranges: `echo {a,b}` prints `{a,b}` in dash.)
 */
export function bracesWork(text: string, shell?: Shell): boolean {
  return (!/\{[^{}]*,[^{}]*\}/.test(text) || featureWorks('braceList', shell)) && (!/\{[^{}]*\.\.[^{}]*\}/.test(text) || featureWorks('braceRange', shell));
}

/**
 * Whether `shell` may brace-expand the plain text `text`, which holds a `{`: the text has a kind of brace expansion the
 * shell has (dash: none; mksh: `{a,b}`, not `{1..3}`), or a `{` that is neither kind where the shell has one (not read here).
 */
export function bracesMayWork(text: string, shell?: Shell): boolean {
  const list = /\{[^{}]*,[^{}]*\}/.test(text);
  const range = /\{[^{}]*\.\.[^{}]*\}/.test(text);
  if (list || range) return (list && featureWorks('braceList', shell)) || (range && featureWorks('braceRange', shell));
  return featureWorks('braceList', shell) || featureWorks('braceRange', shell);
}
