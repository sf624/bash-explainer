import { Text, tx } from '../i18n';
import { splitReplacement } from '../expansion';
import { unquoteWord } from '../staticword';

/** The name of `{name}` in `{name}>file`: bash picks a free descriptor (10 or higher) and stores its number in that variable. */
function namedFd(fd: string): string | undefined {
  return /^\{(.+)\}$/.exec(fd)?.[1];
}

/** `{name}>file`, `{name}<file`…: open the file on a new descriptor and keep its number in the variable. */
function openNamed(name: string, d: string, how: Text): Text {
  return tx(
    `ファイル \`${d}\` を${how.ja}で開き、空いているファイルディスクリプタ（10 以上）の番号を変数 \`${name}\` に入れる`,
    `Open file \`${d}\` ${how.en} on a free file descriptor (10 or higher) and store its number in variable \`${name}\``,
  );
}

/** Redirection operators. `fd` is the explicit file descriptor (or the default), `dest` the target text. */
export const redirects: Record<string, (fd: string, dest: string) => Text> = {
  '>': (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('書き込み用（既存の内容は上書き）', 'for writing (overwrite)')) : tx(`${fdName(fd, '1').ja}をファイル \`${d}\` に書き込む（既存の内容は上書き）`, `Write ${fdName(fd, '1').en} to file \`${d}\` (overwrite)`),
  '>>': (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('追記用', 'for appending')) : tx(`${fdName(fd, '1').ja}をファイル \`${d}\` の末尾に追記する`, `Append ${fdName(fd, '1').en} to the end of file \`${d}\``),
  '<': (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('読み込み用', 'for reading')) : tx(`ファイル \`${d}\` の内容を${fdName(fd, '0').ja}として読み込む`, `Read file \`${d}\` as ${fdName(fd, '0').en}`),
  '>|': (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('書き込み用（`noclobber` でも強制的に上書き）', 'for writing (overwrite even with `noclobber`)')) : tx(`${fdName(fd, '1').ja}をファイル \`${d}\` に書き込む（\`set -o noclobber\` でも強制的に上書き）`, `Write ${fdName(fd, '1').en} to \`${d}\`, overwriting even with \`noclobber\` set`),
  '<>': (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('読み書き両用', 'for reading and writing')) : tx(`ファイル \`${d}\` を読み書き両用で${fdName(fd, '0').ja}として開く`, `Open \`${d}\` for reading and writing as ${fdName(fd, '0').en}`),
  '&>': (_fd, d) => tx(`標準出力と標準エラー出力の両方をファイル \`${d}\` に書き込む（上書き）`, `Write both stdout and stderr to \`${d}\` (overwrite)`),
  '&>>': (_fd, d) => tx(`標準出力と標準エラー出力の両方をファイル \`${d}\` に追記する`, `Append both stdout and stderr to \`${d}\``),
  '>&': (fd, d) => dupOut(fd, d),
  '<&': (fd, d) => dup(fd, d, '0', tx('入力元を共有', 'sharing the input')),
};

/**
 * `n>&m`, `n<&m` (duplicate m), `n>&-` (close), `n>&m-` (move: duplicate m, then close m), and the same with
 * `{name}` for n: a new descriptor whose number goes into the variable, or, with `-`, the descriptor the variable holds.
 */
function dup(fd: string, d: string, dflt: string, shared: Text): Text {
  const name = namedFd(fd);
  const move = /^(\d+)-$/.exec(d)?.[1];
  if (name) {
    if (d === '-') return tx(`変数 \`${name}\` に入っている番号のファイルディスクリプタを閉じる`, `Close the file descriptor whose number is in variable \`${name}\``);
    if (move) {
      return tx(`${fdName(move, move).ja}を、空いているファイルディスクリプタ（10 以上）に移し（${move} は閉じる）、その番号を変数 \`${name}\` に入れる`,
        `Move ${fdName(move, move).en} to a free file descriptor (10 or higher), closing ${move}, and store the new number in variable \`${name}\``);
    }
    return tx(`${fdName(d, d).ja}の複製を、空いているファイルディスクリプタ（10 以上）に作り、その番号を変数 \`${name}\` に入れる（${shared.ja}）`,
      `Copy ${fdName(d, d).en} to a free file descriptor (10 or higher) and store its number in variable \`${name}\` (${shared.en})`);
  }
  if (d === '-') return tx(`${fdName(fd, dflt).ja}を閉じる`, `Close ${fdName(fd, dflt).en}`);
  if (move) {
    return tx(`${fdName(move, move).ja}を ${fdName(fd, dflt).ja} に移す（複製したあと ${move} は閉じる）`,
      `Move ${fdName(move, move).en} to ${fdName(fd, dflt).en} (copy it, then close ${move})`);
  }
  return tx(`${fdName(fd, dflt).ja}を ${fdName(d, d).ja} の複製にする（${shared.ja}）`, `Make ${fdName(fd, dflt).en} a copy of ${fdName(d, d).en}`);
}

function dupOut(fd: string, d: string): Text {
  if (namedFd(fd) || d === '-' || /^\d+-$/.test(d)) return dup(fd, d, '1', tx('出力先を共有', 'sharing the output'));
  if (/^\d+$/.test(d)) {
    return tx(
      `${fdName(fd, '1').ja}を ${fdName(d, d).ja} と同じ出力先に向ける`,
      `Send ${fdName(fd, '1').en} to the same place as ${fdName(d, d).en}`,
    );
  }
  return tx(`標準出力と標準エラー出力の両方をファイル \`${d}\` に書き込む`, `Write both stdout and stderr to \`${d}\``);
}

export function fdName(fd: string, dflt: string): Text {
  const n = fd || dflt;
  if (n === '0') return tx('標準入力(fd 0)', 'stdin (fd 0)');
  if (n === '1') return tx('標準出力(fd 1)', 'stdout (fd 1)');
  if (n === '2') return tx('標準エラー出力(fd 2)', 'stderr (fd 2)');
  return tx(`ファイルディスクリプタ ${n}`, `file descriptor ${n}`);
}

export const specialDestinations: Record<string, Text> = {
  '/dev/null': tx('`/dev/null` は書き込んだ内容を捨てる特殊ファイル（出力を捨てる定番）', '`/dev/null` discards everything written to it'),
  '/dev/stderr': tx('`/dev/stderr` は標準エラー出力を指す', '`/dev/stderr` refers to standard error'),
  '/dev/stdout': tx('`/dev/stdout` は標準出力を指す', '`/dev/stdout` refers to standard output'),
};

/** `${var<op>arg}` operators. */
export const expansionOps: Record<string, (v: string, a: string) => Text> = {
  ':-': (v, a) => tx(`\`${v}\` が未設定または空なら \`${a}\` を使う（変数自体は変更しない）`, `Use \`${a}\` if \`${v}\` is unset or empty (does not assign)`),
  '-': (v, a) => tx(`\`${v}\` が未設定なら \`${a}\` を使う（空文字はそのまま）`, `Use \`${a}\` if \`${v}\` is unset (empty is kept)`),
  ':=': (v, a) => tx(`\`${v}\` が未設定または空なら \`${a}\` を代入してその値を使う`, `If \`${v}\` is unset or empty, assign \`${a}\` to it and use that`),
  '=': (v, a) => tx(`\`${v}\` が未設定なら \`${a}\` を代入してその値を使う`, `If \`${v}\` is unset, assign \`${a}\` to it`),
  ':+': (v, a) => tx(`\`${v}\` が設定済みかつ空でなければ \`${a}\` を使い、そうでなければ空`, `Use \`${a}\` if \`${v}\` is set and non-empty, otherwise nothing`),
  '+': (v, a) => tx(`\`${v}\` が設定済みなら \`${a}\` を使い、未設定なら空`, `Use \`${a}\` if \`${v}\` is set, otherwise nothing`),
  ':?': (v, a) => tx(`\`${v}\` が未設定または空ならエラーメッセージ「${a || 'parameter null or not set'}」を出してスクリプトを終了`, `Exit with error "${a || 'parameter null or not set'}" if \`${v}\` is unset or empty`),
  '?': (v, a) => tx(`\`${v}\` が未設定ならエラーメッセージ「${a || 'parameter not set'}」を出して終了`, `Exit with error "${a || 'parameter not set'}" if \`${v}\` is unset`),
  '#': (v, a) => tx(`\`${v}\` の先頭からパターン \`${a}\` に一致する最短部分を削除`, `Remove the shortest prefix of \`${v}\` matching \`${a}\``),
  '##': (v, a) => tx(`\`${v}\` の先頭からパターン \`${a}\` に一致する最長部分を削除`, `Remove the longest prefix of \`${v}\` matching \`${a}\``),
  '%': (v, a) => tx(`\`${v}\` の末尾からパターン \`${a}\` に一致する最短部分を削除（拡張子除去などに使う）`, `Remove the shortest suffix of \`${v}\` matching \`${a}\` (e.g. strip an extension)`),
  '%%': (v, a) => tx(`\`${v}\` の末尾からパターン \`${a}\` に一致する最長部分を削除`, `Remove the longest suffix of \`${v}\` matching \`${a}\``),
  '/': (v, a) => rep(a) === '' ? tx(`\`${v}\` 内で最初に \`${pat(a)}\` に一致した部分を削除`, `Delete the first match of \`${pat(a)}\` in \`${v}\``) : tx(`\`${v}\` 内で最初に \`${pat(a)}\` に一致した部分を \`${rep(a)}\` に置換`, `Replace the first match of \`${pat(a)}\` in \`${v}\` with \`${rep(a)}\``),
  '//': (v, a) => rep(a) === '' ? tx(`\`${v}\` 内で \`${pat(a)}\` に一致する部分をすべて削除`, `Delete every match of \`${pat(a)}\` in \`${v}\``) : tx(`\`${v}\` 内で \`${pat(a)}\` に一致する部分をすべて \`${rep(a)}\` に置換`, `Replace every match of \`${pat(a)}\` in \`${v}\` with \`${rep(a)}\``),
  '/#': (v, a) => rep(a) === '' ? tx(`\`${v}\` の先頭が \`${pat(a)}\` に一致すれば削除`, `Delete \`${pat(a)}\` at the start of \`${v}\``) : tx(`\`${v}\` の先頭が \`${pat(a)}\` に一致すれば \`${rep(a)}\` に置換`, `Replace \`${pat(a)}\` at the start of \`${v}\` with \`${rep(a)}\``),
  '/%': (v, a) => rep(a) === '' ? tx(`\`${v}\` の末尾が \`${pat(a)}\` に一致すれば削除`, `Delete \`${pat(a)}\` at the end of \`${v}\``) : tx(`\`${v}\` の末尾が \`${pat(a)}\` に一致すれば \`${rep(a)}\` に置換`, `Replace \`${pat(a)}\` at the end of \`${v}\` with \`${rep(a)}\``),
  '^': (v, a) => a ? tx(`\`${v}\` の先頭文字が \`${a}\` に一致すれば大文字にする`, `Uppercase the first character of \`${v}\` if it matches \`${a}\``) : tx(`\`${v}\` の先頭文字を大文字にする`, `Uppercase the first character of \`${v}\``),
  '^^': (v, a) => a ? tx(`\`${v}\` の文字のうち \`${a}\` に一致するものだけを大文字にする`, `Uppercase the characters of \`${v}\` that match \`${a}\``) : tx(`\`${v}\` を全て大文字にする`, `Uppercase all of \`${v}\``),
  ',': (v, a) => a ? tx(`\`${v}\` の先頭文字が \`${a}\` に一致すれば小文字にする`, `Lowercase the first character of \`${v}\` if it matches \`${a}\``) : tx(`\`${v}\` の先頭文字を小文字にする`, `Lowercase the first character of \`${v}\``),
  ',,': (v, a) => a ? tx(`\`${v}\` の文字のうち \`${a}\` に一致するものだけを小文字にする`, `Lowercase the characters of \`${v}\` that match \`${a}\``) : tx(`\`${v}\` を全て小文字にする`, `Lowercase all of \`${v}\``),
  '~': (v, a) => a ? tx(`\`${v}\` の先頭文字が \`${a}\` に一致すれば大文字と小文字を入れ替える`, `Swap the case of the first character of \`${v}\` if it matches \`${a}\``) : tx(`\`${v}\` の先頭文字の大文字と小文字を入れ替える`, `Swap the case of the first character of \`${v}\``),
  '~~': (v, a) => a ? tx(`\`${v}\` の文字のうち \`${a}\` に一致するものだけ大文字と小文字を入れ替える`, `Swap the case of the characters of \`${v}\` that match \`${a}\``) : tx(`\`${v}\` の大文字と小文字をすべて入れ替える`, `Swap the case of every character of \`${v}\``),
  ':': (v, a) => tx(`\`${v}\` の部分文字列（オフセット:長さ = \`${a}\`）を取り出す`, `Substring of \`${v}\` (offset:length = \`${a}\`)`),
  '@': (v, a) => tx(`\`${v}\` に変換 \`@${a}\` を適用（Q:クォート, E:エスケープ展開, U/L:大小文字, a:属性 など）`, `Apply transformation \`@${a}\` to \`${v}\` (Q quote, E escapes, U/L case, a attributes…)`),
};

function pat(a: string): string {
  return splitReplacement(a).pattern;
}
/** The replacement of `${v/pat/rep}` as the shell uses it: its quotes and backslashes are removed (`\}` is `}`). */
function rep(a: string): string {
  const raw = splitReplacement(a).replacement ?? '';
  return unquoteWord(raw) ?? raw;
}

/**
 * `&` in the replacement of `${v/p/r}`: since bash 5.2 (`patsub_replacement`) an unquoted one stands for the matched text,
 * and `\&` (or a quoted one) is the character. Undefined when the replacement has no `&`.
 */
function ampersandNote(a: string): Text | undefined {
  const raw = splitReplacement(a).replacement ?? '';
  let special = false;
  let quoted = false;
  let quote = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && quote !== "'") { if (raw[i + 1] === '&') quoted = true; i++; }
    else if (quote) { if (c === quote) quote = ''; else if (c === '&') quoted = true; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '&') special = true;
  }
  if (special) {
    return tx('。置換文字列の `&` は一致した部分そのものを表す（bash 5.2 の `patsub_replacement`。bash 5.1 以前や `shopt -u patsub_replacement` では文字 `&` のまま。文字として入れたいときは `\\&` と書く）',
      '. A `&` in the replacement stands for the matched text (`patsub_replacement`, bash 5.2; in bash 5.1 and older, or after `shopt -u patsub_replacement`, it is just the character `&`; write `\\&` for the character)');
  }
  return quoted ? tx('。クォートされた `&`（`\\&` など）は文字 `&` そのもの。bash 5.2 では、クォートしない `&` が一致した部分を表すので、それと区別するための書き方', '. A quoted `&` (such as `\\&`) is the character itself; in bash 5.2 an unquoted `&` stands for the matched text, so quoting tells them apart') : undefined;
}
for (const op of ['/', '//', '/#', '/%']) {
  const base = expansionOps[op];
  expansionOps[op] = (v, a) => {
    const t = base(v, a);
    const n = ampersandNote(a);
    return n ? tx(t.ja + n.ja, t.en + n.en) : t;
  };
}

export const specialVariables: Record<string, Text> = {
  '?': tx('直前に実行したコマンドの終了ステータス（0 は成功）', 'Exit status of the last command (0 = success)'),
  '@': tx('全ての位置パラメータ。`"$@"` とすると各引数を別々の単語として展開', 'All positional parameters; `"$@"` expands each one as a separate word'),
  '*': tx('全ての位置パラメータ。`"$*"` は IFS の先頭文字で連結した1つの文字列になる', 'All positional parameters; `"$*"` joins them into one string with the first IFS char'),
  '#': tx('位置パラメータ（引数）の個数', 'Number of positional parameters'),
  '$': tx('現在のシェルのプロセスID', 'Process ID of the current shell'),
  '!': tx('最後にバックグラウンド実行したプロセスのID', 'PID of the most recent background job'),
  '0': tx('スクリプト名（またはシェル名）', 'Name of the script or shell'),
  '-': tx('現在有効なシェルオプションのフラグ', 'Current shell option flags'),
  '_': tx('直前のコマンドの最後の引数', 'Last argument of the previous command'),
};

export const wellKnownVariables: Record<string, Text> = {
  HOME: tx('ホームディレクトリのパス', 'Home directory'),
  PATH: tx('コマンドを探すディレクトリの一覧（`:` 区切り）', 'Colon-separated list of directories searched for commands'),
  PWD: tx('カレントディレクトリ', 'Current working directory'),
  OLDPWD: tx('直前のカレントディレクトリ', 'Previous working directory'),
  IFS: tx('単語分割に使う区切り文字（既定は空白・タブ・改行）', 'Field separator used for word splitting'),
  USER: tx('ログインユーザー名', 'Current user name'),
  SHELL: tx('ログインシェルのパス', 'Path of the login shell'),
  RANDOM: tx('参照するたびに 0〜32767 の乱数を返す', 'A random integer 0–32767 on each reference'),
  LINENO: tx('現在の行番号', 'Current line number'),
  SECONDS: tx('シェル起動からの経過秒数', 'Seconds since the shell started'),
  BASH_SOURCE: tx('ソースファイル名の配列（`${BASH_SOURCE[0]}` は現在のスクリプト）', 'Array of source file names; `${BASH_SOURCE[0]}` is the current script'),
  FUNCNAME: tx('実行中の関数名の配列', 'Array of function names on the call stack'),
  BASH_REMATCH: tx('直前の `[[ =~ ]]` の結果の配列: 要素 0 が一致した全体、要素 1 以降が括弧のグループ', 'Result of the last `[[ =~ ]]`: element 0 is the whole match, elements 1 and up are the parenthesized groups'),
  PIPESTATUS: tx('直前のパイプライン各コマンドの終了ステータスの配列', 'Exit statuses of each command in the last pipeline'),
  COPROC: tx('`coproc` が作る配列: `[0]` がコプロセスの出力を読むファイルディスクリプタ、`[1]` がその入力に書くファイルディスクリプタ', 'Array made by `coproc`: `[0]` is the descriptor that reads the co-process output, `[1]` the one that writes to its input'),
  COPROC_PID: tx('`coproc` が起動したコプロセスのプロセス ID', 'Process ID of the co-process started by `coproc`'),
  REPLY: tx('`read` に変数名を渡さなかったときの格納先', 'Default variable set by `read`'),
  OPTARG: tx('`getopts` が処理中のオプションの引数', 'Argument of the option being processed by `getopts`'),
  OPTIND: tx('`getopts` が次に処理する引数の位置', 'Index of the next argument for `getopts`'),
  HOSTNAME: tx('ホスト名', 'Host name'),
  UID: tx('実ユーザーID', 'Real user ID'),
  EUID: tx('実効ユーザーID（0 なら root）', 'Effective user ID (0 = root)'),
  TMPDIR: tx('一時ファイル用ディレクトリ', 'Directory for temporary files'),
  LANG: tx('ロケール設定', 'Locale setting'),
  EDITOR: tx('既定のテキストエディタ', 'Default text editor'),
};

/** Unary test operators used in `[ ]`, `[[ ]]` and `test`. */
export const unaryTestOps: Record<string, Text> = {
  '-a': tx('存在する（`-e` と同じ。非推奨）', 'exists (same as `-e`, obsolescent)'),
  '-g': tx('setgid ビットが付いている', 'has the setgid bit set'),
  '-u': tx('setuid ビットが付いている', 'has the setuid bit set'),
  '-k': tx('スティッキービットが付いている', 'has the sticky bit set'),
  '-O': tx('実効ユーザー ID が所有している', 'is owned by the effective user ID'),
  '-G': tx('実効グループ ID が所有している', 'is owned by the effective group ID'),
  '-N': tx('前回読んでから変更されている', 'was modified since it was last read'),
  '-R': tx('参照変数（nameref）として設定された変数名である', 'is the name of a variable set as a name reference'),
  '-e': tx('存在する（種類は問わない）', 'exists'),
  '-f': tx('通常ファイルとして存在する', 'is an existing regular file'),
  '-d': tx('ディレクトリとして存在する', 'is an existing directory'),
  '-L': tx('シンボリックリンクである', 'is a symbolic link'),
  '-h': tx('シンボリックリンクである', 'is a symbolic link'),
  '-r': tx('読み取り可能である', 'is readable'),
  '-w': tx('書き込み可能である', 'is writable'),
  '-x': tx('実行可能である', 'is executable'),
  '-s': tx('空でないファイルである（サイズ > 0）', 'is a non-empty file'),
  '-p': tx('名前付きパイプ(FIFO)である', 'is a named pipe'),
  '-S': tx('ソケットである', 'is a socket'),
  '-b': tx('ブロックデバイスである', 'is a block device'),
  '-c': tx('キャラクタデバイスである', 'is a character device'),
  '-t': tx('端末に接続されたファイルディスクリプタである', 'is a file descriptor open on a terminal'),
  '-z': tx('空文字列である（長さ 0）', 'is an empty string'),
  '-n': tx('空文字列でない（長さ 1 以上）', 'is a non-empty string'),
  '-v': tx('設定済みの変数名である', 'is the name of a set variable'),
  '-o': tx('有効になっているシェルオプション名である', 'is an enabled shell option'),
};

export const binaryTestOps: Record<string, Text> = {
  '=': tx('文字列が等しい（`[[ ]]` では右辺はグロブパターン）', 'strings are equal (right side is a glob pattern in `[[ ]]`)'),
  '==': tx('文字列が等しい（`[[ ]]` では右辺はグロブパターン）', 'strings are equal (right side is a glob pattern in `[[ ]]`)'),
  '!=': tx('文字列が等しくない', 'strings differ'),
  '=~': tx('左辺が右辺の正規表現(ERE)に一致する。一致結果は `BASH_REMATCH` に入る', 'left side matches the regex (ERE) on the right; captures go to `BASH_REMATCH`'),
  '<': tx('辞書順で左が小さい', 'sorts before (lexicographically)'),
  '>': tx('辞書順で左が大きい', 'sorts after (lexicographically)'),
  '-eq': tx('数値が等しい', 'numbers are equal'),
  '-ne': tx('数値が等しくない', 'numbers are not equal'),
  '-lt': tx('左が右より小さい(<)', 'less than'),
  '-le': tx('左が右以下(<=)', 'less than or equal'),
  '-gt': tx('左が右より大きい(>)', 'greater than'),
  '-ge': tx('左が右以上(>=)', 'greater than or equal'),
  '-nt': tx('左のファイルの方が新しい', 'left file is newer'),
  '-ot': tx('左のファイルの方が古い', 'left file is older'),
  '-ef': tx('同じファイル（同じ inode）を指す', 'refer to the same file'),
  '&&': tx('両方の条件が真', 'both conditions are true'),
  '||': tx('どちらかの条件が真', 'either condition is true'),
  '-a': tx('両方の条件が真（AND、非推奨）', 'both are true (AND, obsolescent)'),
  '-o': tx('どちらかの条件が真（OR、非推奨）', 'either is true (OR, obsolescent)'),
};

export const listOps: Record<string, Text> = {
  '&&': tx('左のコマンドが成功（終了ステータス 0）した場合のみ右を実行', 'Run the right side only if the left succeeds (exit 0)'),
  '||': tx('左のコマンドが失敗（終了ステータス 0 以外）した場合のみ右を実行', 'Run the right side only if the left fails (non-zero exit)'),
  ';': tx('コマンドの区切り。左が終わったら結果に関係なく次を実行', 'Command separator; run the next command regardless of the result'),
  '&': tx('左のコマンドをバックグラウンドで実行し、終了を待たずに次へ進む', 'Run the left command in the background and continue without waiting'),
  '|': tx('パイプ: 左のコマンドの標準出力を右のコマンドの標準入力に渡す', 'Pipe: send stdout of the left command to stdin of the right'),
  '|&': tx('パイプ: 左のコマンドの標準出力と標準エラー出力を右の標準入力に渡す', 'Pipe stdout and stderr of the left command to stdin of the right'),
  ';;': tx('この case 分岐を終了する', 'End this case branch'),
  ';&': tx('次の case 分岐の本体も続けて実行する（フォールスルー）', 'Fall through into the next case branch'),
  ';;&': tx('次の case パターンの判定を続ける', 'Continue testing the following case patterns'),
};

export const keywords: Record<string, Text> = {
  if: tx('条件分岐の開始。続くコマンドの終了ステータスが 0 なら then 節を実行', 'Start a conditional; run the `then` branch if the condition exits 0'),
  then: tx('条件が真のときに実行する部分の開始', 'Start of the branch run when the condition is true'),
  elif: tx('前の条件が偽のとき、次の条件を判定', 'Test another condition if the previous ones were false'),
  else: tx('どの条件も偽のときに実行する部分', 'Branch run when no condition was true'),
  fi: tx('if 文の終わり', 'End of the `if` statement'),
  for: tx('for ループの開始', 'Start of a `for` loop'),
  while: tx('条件が真（終了ステータス 0）の間、繰り返す', 'Repeat while the condition exits 0'),
  until: tx('条件が真になるまで（偽の間）繰り返す', 'Repeat until the condition exits 0'),
  in: tx('ループで順に取り出す値の一覧を指定', 'Introduces the list of values to iterate over'),
  do: tx('ループ本体の開始', 'Start of the loop body'),
  done: tx('ループ本体の終わり', 'End of the loop body'),
  case: tx('値をパターンと順に照合し、一致した分岐を実行', 'Match a value against patterns and run the matching branch'),
  esac: tx('case 文の終わり', 'End of the `case` statement'),
  select: tx('一覧からユーザーに番号で選ばせるメニューを表示', 'Show a numbered menu for the user to pick from'),
  function: tx('関数定義', 'Function definition'),
  '{': tx('コマンドのグループ化の開始（現在のシェルで実行）', 'Start of a command group (runs in the current shell)'),
  '}': tx('コマンドのグループ化の終わり', 'End of a command group'),
  '(': tx('サブシェルの開始（別プロセスで実行され、変数の変更は外に影響しない）', 'Start of a subshell (changes do not affect the parent shell)'),
  ')': tx('サブシェルの終わり', 'End of the subshell'),
  '!': tx('続くコマンドの終了ステータスを反転する', 'Negate the exit status of the following command'),
  // `! a | b` negates the status of the whole pipeline, not of `a`.
  '! pipeline': tx('続くパイプライン全体の終了ステータスを反転する', 'Negate the exit status of the whole pipeline that follows'),
  time: tx('続くパイプラインの実行時間を計測して表示', 'Measure and report the run time of the pipeline'),
  coproc: tx('コプロセス（双方向パイプ付きのバックグラウンド処理）を開始', 'Start a coprocess with a two-way pipe'),
};

export const declarationFlags: Record<string, Text> = {
  '-a': tx('インデックス配列として宣言', 'declare an indexed array'),
  '-A': tx('連想配列として宣言', 'declare an associative array'),
  '-i': tx('整数として扱う（代入時に算術評価）', 'treat as integer (arithmetic on assignment)'),
  '-r': tx('読み取り専用にする', 'make read-only'),
  '-x': tx('環境変数としてエクスポート', 'export to the environment'),
  '-l': tx('代入時に小文字へ変換', 'lowercase on assignment'),
  '-u': tx('代入時に大文字へ変換', 'uppercase on assignment'),
  '-n': tx('名前参照（nameref）にする', 'make a name reference'),
  '-g': tx('関数内でもグローバル変数として宣言', 'declare global even inside a function'),
  '-f': tx('関数名を対象にする', 'operate on function names'),
  '-F': tx('関数名のみ表示', 'show function names only'),
  '-p': tx('属性と値を表示', 'print attributes and values'),
};

export const declarationCommands: Record<string, Text> = {
  export: tx('変数を環境変数としてエクスポートし、子プロセスにも引き継ぐ', 'Export variables so child processes inherit them'),
  local: tx('関数内だけで有効なローカル変数を宣言', 'Declare variables local to the current function'),
  declare: tx('変数を宣言し、属性を設定する', 'Declare variables and set attributes'),
  typeset: tx('変数を宣言し、属性を設定する（declare と同じ）', 'Declare variables and set attributes (same as declare)'),
  readonly: tx('変数を読み取り専用（変更不可）にする', 'Mark variables read-only'),
};
