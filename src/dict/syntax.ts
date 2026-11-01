import { Text, tx } from '../i18n';
import type { EmbeddedLang } from '../embedded/types';
import { splitReplacement } from '../expansion';
import { messageText, unquoteWord } from '../staticword';
import { based } from '../tokenbases';
import { wordTable } from '../wordtable';

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

/**
 * What a redirection operator does to its stream (`RedirectOp.kind`): reads a file, writes it (`>`, `>|`), appends to
 * it, opens it for both (`<>`), sends stdout and stderr to it (`&>`, `&>>`), or works on another descriptor (`>&`, `<&`:
 * `dupTarget` says how).
 */
export type RedirectKind = 'read' | 'write' | 'append' | 'readWrite' | 'both' | 'bothAppend' | 'dup' | 'dupIn';
/** A redirection operator: what it does to its stream, and its text. `fd` is the explicit file descriptor (or the default), `dest` the target text. */
export interface RedirectOp { readonly kind: RedirectKind; says(fd: string, dest: string): Text }

/** Redirection operators. */
export const redirects: Readonly<Record<string, RedirectOp>> = {
  '>': { kind: 'write', says: (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('書き込み用（既存の内容は上書き）', 'for writing (overwrite)')) : tx(`${fdName(fd, '1').ja}をファイル \`${d}\` に書き込む（既存の内容は上書き）`, `Write ${fdName(fd, '1').en} to file \`${d}\` (overwrite)`) },
  '>>': { kind: 'append', says: (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('追記用', 'for appending')) : tx(`${fdName(fd, '1').ja}をファイル \`${d}\` の末尾に追記する`, `Append ${fdName(fd, '1').en} to the end of file \`${d}\``) },
  '<': { kind: 'read', says: (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('読み込み用', 'for reading')) : tx(`ファイル \`${d}\` の内容を${fdName(fd, '0').ja}として読み込む`, `Read file \`${d}\` as ${fdName(fd, '0').en}`) },
  '>|': { kind: 'write', says: (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('書き込み用（`noclobber` でも強制的に上書き）', 'for writing (overwrite even with `noclobber`)')) : tx(`${fdName(fd, '1').ja}をファイル \`${d}\` に書き込む（\`set -o noclobber\` でも強制的に上書き）`, `Write ${fdName(fd, '1').en} to \`${d}\`, overwriting even with \`noclobber\` set`) },
  '<>': { kind: 'readWrite', says: (fd, d) => namedFd(fd) ? openNamed(namedFd(fd)!, d, tx('読み書き両用', 'for reading and writing')) : tx(`ファイル \`${d}\` を読み書き両用で${fdName(fd, '0').ja}として開く`, `Open \`${d}\` for reading and writing as ${fdName(fd, '0').en}`) },
  '&>': { kind: 'both', says: (_fd, d) => tx(`標準出力と標準エラー出力の両方をファイル \`${d}\` に書き込む（上書き）`, `Write both stdout and stderr to \`${d}\` (overwrite)`) },
  '&>>': { kind: 'bothAppend', says: (_fd, d) => tx(`標準出力と標準エラー出力の両方をファイル \`${d}\` に追記する`, `Append both stdout and stderr to \`${d}\``) },
  '>&': { kind: 'dup', says: (fd, d) => dupOut(fd, d) },
  '<&': { kind: 'dupIn', says: (fd, d) => dup(fd, d, '0', tx('入力元を共有', 'sharing the input')) },
};

/**
 * What the target of `>&` or `<&` does (manual 3.6.8, 3.6.9): `-` closes the descriptor, `m-` moves descriptor m to
 * it, a number copies that descriptor; any other word is no descriptor (only `>&word` takes it, as a file name).
 */
export function dupTarget(d: string): { kind: 'close' } | { kind: 'move' | 'copy'; fd: string } | { kind: 'word' } {
  if (d === '-') return { kind: 'close' };
  const move = /^(\d+)-$/.exec(d)?.[1];
  if (move) return { kind: 'move', fd: move };
  return /^\d+$/.test(d) ? { kind: 'copy', fd: d } : { kind: 'word' };
}

/**
 * `n>&m`, `n<&m` (duplicate m), `n>&-` (close), `n>&m-` (move: duplicate m, then close m), and the same with
 * `{name}` for n: a new descriptor whose number goes into the variable, or, with `-`, the descriptor the variable holds.
 */
function dup(fd: string, d: string, dflt: string, shared: Text): Text {
  const name = namedFd(fd);
  const t = dupTarget(d);
  if (t.kind === 'word') return notFd(d);
  if (name) {
    if (t.kind === 'close') return tx(`変数 \`${name}\` に入っている番号のファイルディスクリプタを閉じる`, `Close the file descriptor whose number is in variable \`${name}\``);
    if (t.kind === 'move') {
      return tx(`${fdName(t.fd, t.fd).ja}を、空いているファイルディスクリプタ（10 以上）に移し（${t.fd} は閉じる）、その番号を変数 \`${name}\` に入れる`,
        `Move ${fdName(t.fd, t.fd).en} to a free file descriptor (10 or higher), closing ${t.fd}, and store the new number in variable \`${name}\``);
    }
    return tx(`${fdName(d, d).ja}の複製を、空いているファイルディスクリプタ（10 以上）に作り、その番号を変数 \`${name}\` に入れる（${shared.ja}）`,
      `Copy ${fdName(d, d).en} to a free file descriptor (10 or higher) and store its number in variable \`${name}\` (${shared.en})`);
  }
  if (t.kind === 'close') return tx(`${fdName(fd, dflt).ja}を閉じる`, `Close ${fdName(fd, dflt).en}`);
  if (t.kind === 'move') {
    return tx(`${fdName(t.fd, t.fd).ja}を ${fdName(fd, dflt).ja} に移す（複製したあと ${t.fd} は閉じる）`,
      `Move ${fdName(t.fd, t.fd).en} to ${fdName(fd, dflt).en} (copy it, then close ${t.fd})`);
  }
  return tx(`${fdName(fd, dflt).ja}を ${fdName(d, d).ja} の複製にする（${shared.ja}）`, `Make ${fdName(fd, dflt).en} a copy of ${fdName(d, d).en}`);
}

function dupOut(fd: string, d: string): Text {
  const t = dupTarget(d);
  if (namedFd(fd) || t.kind === 'close' || t.kind === 'move') return dup(fd, d, '1', tx('出力先を共有', 'sharing the output'));
  if (t.kind === 'copy') {
    return tx(
      `${fdName(fd, '1').ja}を ${fdName(d, d).ja} と同じ出力先に向ける`,
      `Send ${fdName(fd, '1').en} to the same place as ${fdName(d, d).en}`,
    );
  }
  // (Only `>&word` and `1>&word` take a file name, as `&>word`: `2>&f` is an error.)
  if (fd !== '' && fd !== '1') return notFd(d, tx('。ファイル名を取れるのは `>&` と `1>&` だけ', '; only `>&` and `1>&` take a file name'));
  return tx(`標準出力と標準エラー出力の両方をファイル \`${d}\` に書き込む`, `Write both stdout and stderr to \`${d}\``);
}

/** `<&f`, `2>&f`, `{v}>&f`: a word that is no descriptor number, which bash reports as an ambiguous redirect. */
function notFd(d: string, why: Text = tx('', '')): Text {
  return tx(`\`${d}\` はファイルディスクリプタの番号ではないので、bash は「ambiguous redirect」のエラーにする${why.ja}`,
    `\`${d}\` is no file descriptor number, so bash reports "ambiguous redirect"${why.en}`);
}

export function fdName(fd: string, dflt: string): Text {
  const n = fd || dflt;
  if (n === '0') return tx('標準入力(fd 0)', 'stdin (fd 0)');
  if (n === '1') return tx('標準出力(fd 1)', 'stdout (fd 1)');
  if (n === '2') return tx('標準エラー出力(fd 2)', 'stderr (fd 2)');
  return tx(`ファイルディスクリプタ ${n}`, `file descriptor ${n}`);
}

/**
 * A redirection target `/dev/tcp/host/port` or `/dev/udp/host/port`, which bash opens as a socket (manual 3.6).
 * bash takes any name under `/dev/tcp/` with another `/`: the host runs to it, the port is the rest. `bad`: that is
 * no host and port (`/dev/tcp//80`, `/dev/tcp/h/80/x`), and the redirection fails. (With an empty port, `/dev/udp/h/`,
 * bash still connects.)
 */
export interface NetworkPath { proto: 'TCP' | 'UDP'; host: string; port: string; bad: boolean }

export function networkPath(dest: string): NetworkPath | undefined {
  const m = /^\/dev\/(tcp|udp)\/([^/]*)\/(.*)$/s.exec(dest);
  return m ? { proto: m[1] === 'tcp' ? 'TCP' : 'UDP', host: m[2], port: m[3], bad: !m[2] || m[3].includes('/') } : undefined;
}

/** The operators that open their target (a duplication `>&` only when it takes a file name: `>&/dev/tcp/h/p`, `1>&…`). */
const NETWORK_OPS = new Set(['<', '>', '>>', '>|', '<>', '&>', '&>>', '>&']);

/** The network path a redirection opens; `target` is the value of its word (a quoted `"/dev/tcp/h/80"` connects too). */
export function networkTarget(op: string, fd: string, target: string): NetworkPath | undefined {
  return NETWORK_OPS.has(op) && (op !== '>&' || fd === '' || fd === '1') ? networkPath(target) : undefined;
}

/**
 * What a redirection to `/dev/tcp/host/port` does in a shell that opens it as a socket (bash, yash, ksh93): no file is
 * opened; the shell connects, and the descriptor reads from or writes to the connection.
 */
export function networkRedirect(op: string, fd: string, net: NetworkPath, target: string): Text {
  const { proto, host, port } = net;
  if (net.bad) {
    const part = (v: string, ja: string, en: string) => (v ? tx(`${ja} \`${v}\``, `${en} \`${v}\``) : tx(`${ja}は空`, `${en} empty`));
    const h = part(host, 'ホスト', 'host');
    const p = part(port, 'ポート', 'port');
    return tx(
      `シェルは \`${target}\` をネットワークの接続先（${h.ja}、${p.ja}）として扱うが、正しいホストとポートではないのでリダイレクトはエラーになる（ファイルは開かない）`,
      `The shell takes \`${target}\` as a network address (${h.en}, ${p.en}), which is no valid host and port: the redirection fails (no file is opened)`,
    );
  }
  const name = namedFd(fd);
  const at = port ? tx(`ポート \`${port}\` `, `port \`${port}\``) : tx('ポート（空）', 'port empty');
  const conn = tx(`${proto} でホスト \`${host}\` の${at.ja}に接続し、`, `Connect to host \`${host}\`, ${at.en}, over ${proto}, and `);
  const use = name
    ? tx(`その接続を空いているファイルディスクリプタ（10 以上）で開き、番号を変数 \`${name}\` に入れる`, `open the connection on a free file descriptor (10 or higher), storing its number in variable \`${name}\``)
    : op === '<'
      ? tx(`${fdName(fd, '0').ja}を接続から読む`, `read ${fdName(fd, '0').en} from the connection`)
      : op === '<>'
        ? tx(`接続を読み書き両用で${fdName(fd, '0').ja}にする`, `use the connection for reading and writing as ${fdName(fd, '0').en}`)
        : op === '&>' || op === '&>>' || op === '>&'
          ? tx('標準出力と標準エラー出力の両方を接続に送る', 'send both stdout and stderr to it')
          : tx(`${fdName(fd, '1').ja}を接続に送る`, `send ${fdName(fd, '1').en} to it`);
  return tx(
    `${conn.ja}${use.ja}（ファイルではない。\`/dev/${proto.toLowerCase()}/ホスト/ポート\` はシェル自身が扱う名前で、接続できなければエラー）`,
    `${conn.en}${use.en} (not a file: the shell itself handles \`/dev/${proto.toLowerCase()}/host/port\`, and fails if it cannot connect)`,
  );
}

/**
 * The same target in a shell that has no such names: an ordinary path, usually missing. `shell` is its name, or
 * undefined for POSIX sh (which does not define the names; bash connects even in POSIX mode).
 */
export function networkPathAsFile(shell: string | undefined): Text {
  if (!shell) {
    return tx(
      'POSIX は `/dev/tcp/…` を定めていない。dash や busybox ash などの sh では普通のファイル名で、ふつうは存在しない（ネットワークに接続するのは bash（POSIX モードでも）・yash・ksh93）',
      'POSIX does not define `/dev/tcp/…`: dash, busybox ash and other sh open it as an ordinary path, usually missing (bash, even in POSIX mode, yash and ksh93 connect to the network)',
    );
  }
  return tx(
    `${shell} では \`/dev/tcp/…\` も普通のファイル名で、ふつうは存在しない（POSIX は定めていない。ネットワークに接続するのは bash・yash・ksh93）`,
    `${shell} opens \`/dev/tcp/…\` as an ordinary path, usually missing (POSIX does not define it; bash, yash and ksh93 connect to the network)`,
  );
}

export const specialDestinations: Record<string, Text> = wordTable({
  '/dev/null': tx('`/dev/null` は書き込んだ内容を捨てる特殊ファイル（出力を捨てる定番）', '`/dev/null` discards everything written to it'),
  '/dev/stderr': tx('`/dev/stderr` は標準エラー出力を指す', '`/dev/stderr` refers to standard error'),
  '/dev/stdout': tx('`/dev/stdout` は標準出力を指す', '`/dev/stdout` refers to standard output'),
});

/** Whether a name as shown (`$1`, `$@`) is a positional parameter, which `${…:=…}` cannot assign to. */
export function cannotAssign(shown: string): boolean {
  return /^\$(?:[1-9]\d*|[@*])$/.test(shown);
}

/** `${var<op>arg}` operators. */
export const expansionOps: Record<string, (v: string, a: string) => Text> = {
  ':-': (v, a) => tx(`\`${v}\` が未設定または空なら \`${a}\` を使う（変数自体は変更しない）`, `Use \`${a}\` if \`${v}\` is unset or empty (does not assign)`),
  '-': (v, a) => tx(`\`${v}\` が未設定なら \`${a}\` を使う（空文字はそのまま）`, `Use \`${a}\` if \`${v}\` is unset (empty is kept)`),
  ':=': (v, a) => cannotAssign(v) ? tx(`\`${v}\` が未設定または空なら、bash は「cannot assign in this way」のエラーにする（位置パラメータには代入できない。\`${a}\` は使われない）`, `If \`${v}\` is unset or empty, bash fails with "cannot assign in this way" (the arguments cannot be assigned to; \`${a}\` is not used)`) : tx(`\`${v}\` が未設定または空なら \`${a}\` を代入してその値を使う`, `If \`${v}\` is unset or empty, assign \`${a}\` to it and use that`),
  '=': (v, a) => cannotAssign(v) ? tx(`\`${v}\` が未設定なら、bash は「cannot assign in this way」のエラーにする（位置パラメータには代入できない。\`${a}\` は使われない）`, `If \`${v}\` is unset, bash fails with "cannot assign in this way" (the arguments cannot be assigned to; \`${a}\` is not used)`) : tx(`\`${v}\` が未設定なら \`${a}\` を代入してその値を使う`, `If \`${v}\` is unset, assign \`${a}\` to it`),
  ':+': (v, a) => tx(`\`${v}\` が設定済みかつ空でなければ \`${a}\` を使い、そうでなければ空`, `Use \`${a}\` if \`${v}\` is set and non-empty, otherwise nothing`),
  '+': (v, a) => tx(`\`${v}\` が設定済みなら \`${a}\` を使い、未設定なら空`, `Use \`${a}\` if \`${v}\` is set, otherwise nothing`),
  ':?': (v, a) => tx(`\`${v}\` が未設定または空ならエラーメッセージ「${a ? messageText(a) : 'parameter null or not set'}」を出してスクリプトを終了`, `Exit with error "${a ? messageText(a) : 'parameter null or not set'}" if \`${v}\` is unset or empty`),
  '?': (v, a) => tx(`\`${v}\` が未設定ならエラーメッセージ「${a ? messageText(a) : 'parameter not set'}」を出して終了`, `Exit with error "${a ? messageText(a) : 'parameter not set'}" if \`${v}\` is unset`),
  '#': (v, a) => tx(`\`${v}\` の先頭からパターン \`${a}\` に一致する最短部分を削除`, `Remove the shortest prefix of \`${v}\` matching \`${a}\``),
  '##': (v, a) => tx(`\`${v}\` の先頭からパターン \`${a}\` に一致する最長部分を削除`, `Remove the longest prefix of \`${v}\` matching \`${a}\``),
  '%': (v, a) => tx(`\`${v}\` の末尾からパターン \`${a}\` に一致する最短部分を削除（拡張子除去などに使う）`, `Remove the shortest suffix of \`${v}\` matching \`${a}\` (e.g. strip an extension)`),
  '%%': (v, a) => tx(`\`${v}\` の末尾からパターン \`${a}\` に一致する最長部分を削除`, `Remove the longest suffix of \`${v}\` matching \`${a}\``),
  '/': (v, a) => rep(a) === '' ? tx(`\`${v}\` 内で最初に \`${pat(a)}\` に一致した部分を削除`, `Delete the first match of \`${pat(a)}\` in \`${v}\``) : tx(`\`${v}\` 内で最初に \`${pat(a)}\` に一致した部分を \`${rep(a)}\` に置換`, `Replace the first match of \`${pat(a)}\` in \`${v}\` with \`${rep(a)}\``),
  '//': (v, a) => rep(a, true) === '' ? tx(`\`${v}\` 内で \`${pat(a, true)}\` に一致する部分をすべて削除`, `Delete every match of \`${pat(a, true)}\` in \`${v}\``) : tx(`\`${v}\` 内で \`${pat(a, true)}\` に一致する部分をすべて \`${rep(a, true)}\` に置換`, `Replace every match of \`${pat(a, true)}\` in \`${v}\` with \`${rep(a, true)}\``),
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

/** The pattern of `${v/pat/rep}` (`global`: of `${v//pat/rep}`, where a `/` first is the pattern's). */
function pat(a: string, global = false): string {
  return splitReplacement(a, global).pattern;
}
/** The replacement of `${v/pat/rep}` as the shell uses it: its quotes and backslashes are removed (`\}` is `}`). */
function rep(a: string, global = false): string {
  const raw = splitReplacement(a, global).replacement ?? '';
  return unquoteWord(raw) ?? raw;
}

/**
 * `&` in the replacement of `${v/p/r}`: since bash 5.2 (`patsub_replacement`) an unquoted one stands for the matched text,
 * and `\&` (or a quoted one) is the character. Undefined when the replacement has no `&`.
 */
function ampersandNote(a: string, global: boolean): Text | undefined {
  const raw = splitReplacement(a, global).replacement ?? '';
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
    const n = ampersandNote(a, op === '//');
    return n ? tx(t.ja + n.ja, t.en + n.en) : t;
  };
}

/**
 * A variable's text, and where its value is a thing with a name, that name as a short noun (`noun`): what a
 * placeholder of what a program receives says for it (`‹current user name›`, src/messages-argv.ts).
 */
export type VariableText = Text & { noun?: Text };
/** The text `text` of a variable whose value the noun `ja`, `en` names (`VariableText`). */
const named = <T extends Text>(text: T, ja: string, en: string): T & { noun: Text } => ({ ...text, noun: tx(ja, en) });

export const specialVariables: Record<string, VariableText> = wordTable({
  '?': named(tx('直前に実行したコマンドの終了ステータス（0 は成功）', 'Exit status of the last command (0 = success)'), '直前のコマンドの終了ステータス', 'exit status of the last command'),
  '@': tx('全ての位置パラメータ。`"$@"` とすると各引数を別々の単語として展開', 'All positional parameters; `"$@"` expands each one as a separate word'),
  '*': tx('全ての位置パラメータ。`"$*"` は IFS の先頭文字で連結した1つの文字列になる', 'All positional parameters; `"$*"` joins them into one string with the first IFS char'),
  '#': named(tx('位置パラメータ（引数）の個数', 'Number of positional parameters'), '引数の個数', 'number of arguments'),
  // (Of the shell, not of a subshell it is in: manual 3.4.2. The explanation says so in a subshell.)
  '$': named(tx('シェルのプロセス ID', 'Process ID of the shell'), 'シェルのプロセス ID', 'process ID of the shell'),
  '!': named(tx('最後にバックグラウンドで実行したジョブのプロセス ID', 'Process ID of the most recent background job'), '最後にバックグラウンドで実行したジョブのプロセス ID', 'process ID of the most recent background job'),
  '0': named(tx('スクリプト名（またはシェル名）', 'Name of the script or shell'), 'スクリプトかシェルの名前', 'name of the script or shell'),
  '-': named(tx('今有効なシェルオプションの文字（`set -e` の後なら `e`、対話シェルなら `i` など）', 'The letters of the shell options in effect (`e` after `set -e`, `i` in an interactive shell…)'), '今有効なシェルオプションの文字', 'letters of the shell options in effect'),
  '_': tx('直前のコマンドの最後の引数', 'Last argument of the previous command'),
});

/**
 * The variables a script meets, each with what it is: every variable of the manual's chapter 5 (5.1 "Bourne Shell
 * Variables", 5.2 "Bash Variables"; the section is in src/manual.ts, what bash does with it in
 * src/semantics/vars.ts), and a few the environment usually has (`USER`, `EDITOR`). The common ones come first: the
 * quick reference lists them in this order.
 */
export const wellKnownVariables: Record<string, VariableText> = wordTable({
  HOME: named(tx('ホームディレクトリ。引数なしの `cd` の移動先で、`~` の値にもなる', 'Home directory: where `cd` with no argument goes, and the value of `~`'), 'ホームディレクトリ', 'home directory'),
  PATH: tx('コマンドを探すディレクトリの一覧（`:` 区切り。空の項目はカレントディレクトリ）', 'Colon-separated list of directories searched for commands (an empty entry is the current directory)'),
  PWD: named(tx('`cd` が設定するカレントディレクトリ', 'Current working directory, as set by `cd`'), 'カレントディレクトリ', 'current directory'),
  OLDPWD: named(tx('`cd` が設定する直前のカレントディレクトリ（`cd -` の移動先）', 'Previous working directory, as set by `cd` (where `cd -` goes)'), '直前のカレントディレクトリ', 'previous directory'),
  IFS: tx('単語分割と `read` が区切りに使う文字の一覧（既定は空白・タブ・改行）', 'Characters word splitting and `read` split on (by default space, tab and newline)'),
  USER: named(tx('現在のユーザー名', 'Current user name'), '現在のユーザー名', 'current user name'),
  LOGNAME: named(tx('現在のユーザー名（ログインしたときに設定される）', 'Current user name, as set at login'), '現在のユーザー名', 'current user name'),
  SHELL: tx('ユーザーのログインシェルのフルパス（環境になければ bash が設定する）', "Full path of the user's login shell (bash sets it when the environment has none)"),
  RANDOM: named(tx('参照するたびに 0〜32767 の乱数になる', 'A random integer 0–32767 on each reference'), '乱数', 'random number'),
  LINENO: tx('実行中の行の番号（スクリプトや関数の中の行）', 'Number of the line running now, in the script or function'),
  SECONDS: tx('シェルの起動からの経過秒数', 'Seconds since the shell started'),
  BASH_SOURCE: based(tx(
    '`FUNCNAME` の各関数を定義したファイル名の配列。`${BASH_SOURCE[0]}` は実行中のコードのファイル（関数の中では、その関数を定義したファイル）',
    'Array of the files that define the functions of `FUNCNAME`: `${BASH_SOURCE[0]}` is the file of the code running now (in a function, the file that defines it)',
  ), 'bash-source-file'),
  FUNCNAME: tx(
    '呼び出し中の関数名の配列。`${FUNCNAME[0]}` が実行中の関数で、スクリプトでは最後の要素が `main`（関数の外では空）',
    'Array of the functions on the call stack: `${FUNCNAME[0]}` is the function running now, and in a script the last element is `main` (empty outside a function)',
  ),
  BASH_REMATCH: based(tx(
    '直前の `[[ =~ ]]` の結果の配列: 要素 0 が一致した全体、要素 1 以降が括弧のグループ（一致しなかったときは空）',
    'Array of the results of the last `[[ =~ ]]`: element 0 is the whole match, elements 1 and up are the parenthesized groups (empty after a match that fails)',
  ), 'rematch-empty-after-failure'),
  PIPESTATUS: tx('直前のフォアグラウンドのパイプラインの各コマンドの終了ステータスの配列。コマンドが1つでも要素が1つある', 'Array of the exit statuses of each command in the last foreground pipeline: one element for a single command'),
  COPROC: tx('`coproc` が作る配列: `[0]` がコプロセスの出力を読むファイルディスクリプタ、`[1]` がその入力に書くファイルディスクリプタ', 'Array made by `coproc`: `[0]` is the descriptor that reads the co-process output, `[1]` the one that writes to its input'),
  COPROC_PID: tx('`coproc` が起動したコプロセスのプロセス ID', 'Process ID of the co-process started by `coproc`'),
  REPLY: tx('変数名を渡さない `read` が読んだ行（前後の空白も残る）と、`select` で入力された行', 'The line `read` reads when given no name (with its leading and trailing spaces), and the line typed to `select`'),
  OPTARG: tx('`getopts` が処理中のオプションの引数', 'Argument of the option being processed by `getopts`'),
  OPTIND: tx('`getopts` が次に処理する引数の位置（最初は 1）', 'Index of the next argument for `getopts` (1 at the start)'),
  HOSTNAME: named(tx('ホスト名', 'Host name'), 'ホスト名', 'host name'),
  UID: tx('実ユーザー ID', 'Real user ID'),
  EUID: tx('実効ユーザー ID。0 なら root', 'Effective user ID, 0 for root'),
  TMPDIR: tx('bash（やほかのプログラム）が一時ファイルを作るディレクトリ', 'Directory where bash (and other programs) make temporary files'),
  LANG: tx('`LC_` の変数で決めないカテゴリーすべてのロケール', 'Locale of every category no `LC_` variable sets'),
  EDITOR: tx('既定のテキストエディター', 'Default text editor'),
  // 5.1 Bourne Shell Variables (the others are above).
  CDPATH: tx('`cd` が相対パスのディレクトリを探すディレクトリの一覧（`:` 区切り）', 'Colon-separated list of directories `cd` searches for a relative directory name'),
  MAIL: tx('対話シェルが新着メールを確かめるファイル（`MAILPATH` がないとき）', 'File an interactive shell checks for new mail (when `MAILPATH` is not set)'),
  MAILPATH: tx('対話シェルが新着メールを確かめるファイルの一覧（`:` 区切り）', 'Colon-separated list of files an interactive shell checks for new mail'),
  PS1: tx('対話シェルのプロンプト（対話シェルでないシェルでは、環境から渡されても未設定になる。`[ -z "$PS1" ]` で対話シェルかどうかを調べられる）', 'Prompt of an interactive shell (a shell that is not interactive, as one running a script, leaves it unset, even when the environment gives it: `[ -z "$PS1" ]` tells which it is)'),
  PS2: tx('コマンドが次の行に続くときの、対話シェルのプロンプト（既定は `> `）', 'Prompt of an interactive shell when a command goes on to the next line (`> ` by default)'),
  // 5.2 Bash Variables (the others are above).
  BASH: tx('この bash を起動したフルパス', 'Full path used to run this bash'),
  BASHOPTS: tx('有効な `shopt` のオプションの一覧（`:` 区切り）', 'Colon-separated list of the `shopt` options that are on'),
  BASHPID: tx('実行中の bash のプロセス ID。`$$` と違い、サブシェルではそのサブシェル自身の ID', "Process ID of the bash process running this code: unlike `$$`, a subshell's own"),
  BASH_ALIASES: tx('エイリアスの連想配列（キーが名前、値がその文字列）', 'Associative array of the aliases: each key is a name, its value the text'),
  BASH_ARGC: tx('呼び出しの各段の引数の個数の配列（`shopt -s extdebug` のときだけ更新される）', 'Array of the number of arguments of each frame of the call stack (kept up to date only with `shopt -s extdebug`)'),
  BASH_ARGV: tx('呼び出しの各段の引数の配列で、最後の呼び出しの最後の引数が先頭（`shopt -s extdebug` のときだけ更新される）', 'Array of the arguments of each frame of the call stack, the last argument of the last call first (kept up to date only with `shopt -s extdebug`)'),
  BASH_ARGV0: tx('シェルやスクリプトの名前（`$0` と同じ）', 'Name of the shell or script (the same as `$0`)'),
  BASH_CMDS: tx('`hash` が覚えたコマンドの連想配列（キーが名前、値がパス）', 'Associative array of the commands `hash` remembers: each key is a name, its value the path'),
  BASH_COMMAND: tx('実行中（または実行直前）のコマンド。trap の中では、trap が起きたときに実行していたコマンド', 'The command running now, or about to run; in a trap, the command that was running when the trap was triggered'),
  BASH_COMPAT: tx('シェルの互換レベル（`4.2` や `42` など）', 'Compatibility level of the shell (such as `4.2` or `42`)'),
  BASH_ENV: tx('非対話の bash がスクリプトを実行する前に読むファイル（環境にあるとき）', 'File a non-interactive bash reads before it runs a script (when it is in the environment)'),
  BASH_EXECUTION_STRING: tx('`bash -c` に渡した文字列', 'The string given to `bash -c`'),
  BASH_LINENO: tx('`FUNCNAME` の各関数を呼び出した行の番号の配列', 'Array of the line numbers where each function of `FUNCNAME` was called'),
  BASH_LOADABLES_PATH: tx('`enable -f` が読み込む組み込みコマンドを探すディレクトリの一覧（`:` 区切り）', 'Colon-separated list of directories `enable -f` searches for loadable builtins'),
  BASH_SUBSHELL: tx('サブシェルの深さ（スクリプトのシェルでは 0 で、サブシェルに入るたびに 1 増える）', "Depth of subshells: 0 in the script's shell, 1 more in each subshell"),
  BASH_VERSINFO: tx('この bash のバージョンの配列（`[0]` がメジャー、`[1]` がマイナー、`[2]` がパッチレベル）', 'Array of the version of this bash: `[0]` the major version, `[1]` the minor, `[2]` the patch level'),
  BASH_VERSION: tx('この bash のバージョン（`5.2.21(1)-release` など）', 'Version of this bash (such as `5.2.21(1)-release`)'),
  BASH_XTRACEFD: tx('`set -x` がトレースを書くファイルディスクリプタ（未設定か空なら標準エラー出力(fd 2)）', 'File descriptor `set -x` writes its trace to (stderr when it is unset or empty)'),
  CHILD_MAX: tx('シェルが覚えておく、終了した子プロセスの終了ステータスの数', 'Number of exited child processes whose status the shell remembers'),
  COLUMNS: based(tx('端末の幅。`select` がメニューを並べるのに使う（端末では、実行したプログラムが終わるたびに bash が設定する: `checkwinsize`。それまでは環境にあるときだけ）', 'Width of the terminal, which `select` uses to lay out its menu (at a terminal, bash sets it each time a program it ran ends, `checkwinsize`; before that, only the environment gives it)'), 'columns-from-environment'),
  COMP_CWORD: tx('補完関数の中で: カーソルがある単語の、`COMP_WORDS` の添字', 'In a completion function: the index in `COMP_WORDS` of the word at the cursor'),
  COMP_LINE: tx('補完関数の中で: 入力中のコマンドライン', 'In a completion function: the current command line'),
  COMP_POINT: tx('補完関数の中で: コマンドラインの先頭から数えたカーソルの位置', 'In a completion function: the position of the cursor from the start of the line'),
  COMP_TYPE: tx('補完関数の中で: 補完の種類を表す文字の番号（TAB・`?`・`!`・`@`・`%`）', 'In a completion function: the type of completion, as the number of a character (TAB, `?`, `!`, `@` or `%`)'),
  COMP_KEY: tx('補完関数の中で: 補完を呼び出したキー', 'In a completion function: the key that called it'),
  COMP_WORDBREAKS: tx('Readline の補完が単語の区切りにする文字', 'Characters Readline completion treats as word separators'),
  COMP_WORDS: tx('補完関数の中で: コマンドラインの単語の配列', 'In a completion function: the array of the words of the command line'),
  COMPREPLY: tx('補完関数が補完の候補を入れる配列', 'Array a completion function fills with the possible completions'),
  DIRSTACK: tx('ディレクトリスタックの配列（`dirs` が表示する順。`pushd` と `popd` で変わる）', 'Array of the directory stack, in the order `dirs` shows (`pushd` and `popd` change it)'),
  EMACS: tx('起動時の環境で値が `t` なら、bash は Emacs のバッファで動いているとみなし、行編集を使わない', 'When the environment has it with the value `t` at start, bash assumes it runs in an Emacs buffer and turns line editing off'),
  ENV: tx('POSIX モードの対話シェルが起動時に読むファイル', 'File an interactive shell in POSIX mode reads at start'),
  EPOCHREALTIME: tx('参照するたびに、Unix エポックからの秒数（マイクロ秒までの小数）になる', 'Seconds since the Unix epoch, with microseconds, each time it is read'),
  EPOCHSECONDS: tx('参照するたびに、Unix エポックからの秒数になる', 'Seconds since the Unix epoch, each time it is read'),
  EXECIGNORE: tx('`PATH` でコマンドを探すときに飛ばすファイルのパターンの一覧（`:` 区切り。フルパスと照合）', 'Colon-separated list of patterns: a file whose full path matches one is skipped when commands are looked up in `PATH`'),
  FCEDIT: tx('`fc` が既定で使うエディター', 'Editor `fc` uses by default'),
  FIGNORE: tx('ファイル名の補完で無視する接尾辞の一覧（`:` 区切り）', 'Colon-separated list of suffixes filename completion ignores'),
  FUNCNEST: tx('関数呼び出しの入れ子の上限（0 より大きい数のとき）', 'Maximum nesting level of function calls (when it is a number greater than 0)'),
  GLOBIGNORE: tx('ファイル名の展開の結果から除くパターンの一覧（`:` 区切り）', 'Colon-separated list of patterns whose matches filename expansion leaves out'),
  GROUPS: tx('ユーザーが属するグループの ID の配列', 'Array of the IDs of the groups the user is in'),
  histchars: tx('履歴展開に使う文字（既定は `!`・`^`・`#`）', 'Characters of history expansion (`!`, `^` and `#` by default)'),
  HISTCMD: tx('現在のコマンドの履歴番号', 'History number of the current command'),
  HISTCONTROL: tx('履歴に保存する行の決め方（`ignorespace`・`ignoredups`・`ignoreboth`・`erasedups`）', 'How lines are saved in the history (`ignorespace`, `ignoredups`, `ignoreboth`, `erasedups`)'),
  HISTFILE: based(tx('コマンドの履歴を保存するファイル（既定は `~/.bash_history`。スクリプトを実行するシェルは履歴を残さない）', 'File the command history is saved to (`~/.bash_history` by default; a shell running a script keeps no history)'), 'histfile-script'),
  HISTFILESIZE: tx('履歴ファイルの最大の行数', 'Maximum number of lines of the history file'),
  HISTIGNORE: tx('履歴に保存しない行のパターンの一覧（`:` 区切り）', 'Colon-separated list of patterns of the lines not saved in the history'),
  HISTSIZE: tx('履歴に覚えておくコマンドの最大数（既定は 500）', 'Maximum number of commands kept in the history (500 by default)'),
  HISTTIMEFORMAT: tx('`history` が各コマンドの時刻を表示する `strftime` の書式（設定すると時刻も保存される）', '`strftime` format in which `history` shows the time of each command (when it is set, the times are saved too)'),
  HOSTFILE: tx('ホスト名の補完に使う、`/etc/hosts` と同じ形式のファイル', 'File in the format of `/etc/hosts` used to complete host names'),
  HOSTTYPE: tx('bash が動いているマシンの種類（`x86_64` など）', 'Type of the machine bash runs on (such as `x86_64`)'),
  IGNOREEOF: tx('対話シェルが終了するまでに無視する EOF（Ctrl-D）の数', 'Number of EOF characters (Ctrl-D) an interactive shell ignores before it exits'),
  INPUTRC: tx('Readline の設定ファイル（`~/.inputrc` の代わり）', "Readline's init file (instead of `~/.inputrc`)"),
  INSIDE_EMACS: tx('起動時の環境にあれば、bash は Emacs のバッファで動いているとみなす（行編集を使わないこともある）', 'When the environment has it at start, bash assumes it runs in an Emacs buffer (and may turn line editing off)'),
  LC_ALL: tx('すべてのカテゴリーのロケール（`LANG` やほかの `LC_` の変数より優先）', 'Locale of every category, over `LANG` and the other `LC_` variables'),
  LC_COLLATE: tx('ファイル名の展開の結果の並べ方と、パターンの範囲（`[a-z]`）を決めるロケール', 'Locale of the order of filename expansion results and of ranges in patterns (`[a-z]`)'),
  LC_CTYPE: tx('文字の解釈と、パターンの文字クラス（`[[:alpha:]]`）を決めるロケール', 'Locale of characters and of character classes in patterns (`[[:alpha:]]`)'),
  LC_MESSAGES: tx('`$"…"` の文字列の翻訳に使うロケール', 'Locale used to translate `$"…"` strings'),
  LC_NUMERIC: tx('数値の書式のロケール', 'Locale of number formatting'),
  LC_TIME: tx('日付と時刻の書式のロケール', 'Locale of date and time formatting'),
  LINES: based(tx('端末の高さ。`select` がメニューを並べるのに使う（端末では、実行したプログラムが終わるたびに bash が設定する: `checkwinsize`。それまでは環境にあるときだけ）', 'Height of the terminal, which `select` uses to lay out its menu (at a terminal, bash sets it each time a program it ran ends, `checkwinsize`; before that, only the environment gives it)'), 'columns-from-environment'),
  MACHTYPE: tx('bash が動いているシステムの種類（`x86_64-pc-linux-gnu` のような cpu-company-system の形式）', 'System type bash runs on, as cpu-company-system (such as `x86_64-pc-linux-gnu`)'),
  MAILCHECK: tx('対話シェルがメールを確かめる間隔の秒数（既定は 60）', 'How often, in seconds, an interactive shell checks for mail (60 by default)'),
  MAPFILE: tx('変数名を渡さない `mapfile`（`readarray`）が行を入れる配列', 'Array `mapfile` (`readarray`) fills when given no name'),
  OPTERR: based(tx('0 でなければ `getopts` がエラーメッセージを表示する（既定は 1）', 'Unless it is 0, `getopts` prints its error messages (it is 1 by default)'), 'opterr-default'),
  OSTYPE: tx('bash が動いている OS（`linux-gnu` など）', 'Operating system bash runs on (such as `linux-gnu`)'),
  POSIXLY_CORRECT: tx('設定されていると、bash は POSIX モードで動く', 'When it is set, bash runs in POSIX mode'),
  PPID: tx('シェルの親プロセスのプロセス ID', "Process ID of the shell's parent process"),
  PROMPT_COMMAND: tx('対話シェルがプロンプトを表示する前に実行するコマンド', 'Commands an interactive shell runs before each prompt'),
  PROMPT_DIRTRIM: tx('プロンプトの `\\w`・`\\W` で残す、末尾のディレクトリの数', 'Number of trailing directories `\\w` and `\\W` keep in the prompt'),
  PS0: tx('対話シェルがコマンドを読んでから実行するまでに表示する文字列', 'String an interactive shell prints after it reads a command, before it runs it'),
  PS3: tx('`select` のプロンプト（設定しなければ `#? `）', 'Prompt of `select` (`#? ` when it is not set)'),
  PS4: tx('`set -x` が表示する各行の前に付く文字列（既定は `+ `。先頭の文字は入れ子の深さだけ繰り返す）', 'Prefix of each line `set -x` prints (`+ ` by default; its first character is repeated for each level of nesting)'),
  READLINE_ARGUMENT: tx('`bind -x` で割り当てたコマンドの中で: 数引数', 'In a command bound with `bind -x`: the numeric argument given'),
  READLINE_LINE: tx('`bind -x` で割り当てたコマンドの中で: Readline で編集中の行', "In a command bound with `bind -x`: the contents of Readline's line"),
  READLINE_MARK: tx('`bind -x` で割り当てたコマンドの中で: マークの位置', 'In a command bound with `bind -x`: the position of the mark'),
  READLINE_POINT: tx('`bind -x` で割り当てたコマンドの中で: カーソルの位置', 'In a command bound with `bind -x`: the position of the cursor'),
  SHELLOPTS: tx('有効な `set -o` のオプションの一覧（`:` 区切り）', 'Colon-separated list of the `set -o` options that are on'),
  SHLVL: tx('bash の入れ子の深さ（bash から bash を起動するたびに 1 増える）', 'Nesting level of bash: 1 more in each bash started from another'),
  SRANDOM: tx('参照するたびに 32 ビットの乱数になる（種は設定できない）', 'A random 32-bit number on each reference (it cannot be seeded)'),
  TIMEFORMAT: tx('`time` が表示する時間の書式（`%R` が経過時間、`%U` がユーザー時間、`%S` がシステム時間）', 'Format of the timing `time` prints (`%R` elapsed, `%U` user and `%S` system time)'),
  TMOUT: tx('`read` と `select` の既定のタイムアウトの秒数（対話シェルでは、コマンドを待って終了するまでの秒数）', 'Default timeout of `read` and `select`, in seconds (in an interactive shell, how long it waits for a command before it exits)'),
});

/**
 * What an assignment to a variable of bash's changes (`PATH=…`, `OPTIND=1`), said after the assignment; `IFS` has
 * its own text (src/explain/assignments.ts). What bash ignores or refuses comes from src/semantics/vars.ts.
 * test/reading-manual.test.ts checks each with bash.
 */
export const variableAssignments: Record<string, Text> = wordTable({
  CDPATH: tx('これ以降、`cd dir` は `dir` をこれらのディレクトリでも探す（そこで見つけたときは、移動先を表示する）', 'From here, `cd dir` also looks for `dir` in these directories (and prints the directory when it finds it there)'),
  HOME: tx('これ以降、引数なしの `cd` と `~` はこのディレクトリになる', 'From here, `cd` with no argument and `~` use this directory'),
  OPTIND: tx('`getopts` はこの位置の引数から読む。`OPTIND=1` で `$1` から読み直す', '`getopts` reads from this argument on: `OPTIND=1` makes it start again at `$1`'),
  OPTERR: tx('これ以降、値が 0 なら `getopts` はエラーメッセージを表示しない', 'From here, `getopts` prints no error messages when this is 0'),
  PATH: based(tx('これ以降、コマンドはこれらのディレクトリから順に探される（覚えていたコマンドのパスは忘れる。`hash`）', 'From here, commands are looked up in these directories, in order (and bash forgets the paths of commands it remembered, `hash`)'), 'path-forgets-hash'),
  OLDPWD: tx('これ以降、`cd -` はこのディレクトリに移動する', 'From here, `cd -` goes to this directory'),
  PWD: based(tx('変数が変わるだけで、カレントディレクトリは変わらない（移動するのは `cd`）', 'Only the variable changes, not the current directory (`cd` changes both)'), 'pwd-variable-only'),
  BASH_ALIASES: tx('要素を加えるとエイリアスが定義される（要素を削除しても、エイリアスは残る）', 'Adding an element defines an alias (unsetting one does not remove it)'),
  BASH_ARGV0: tx('`$0` にも同じ値が入る', '`$0` is set to the same value'),
  BASH_CMDS: tx('要素を加えると、`hash` が覚えるコマンドになる（要素を削除しても残る）', 'Adding an element adds a command `hash` remembers (unsetting one does not remove it)'),
  BASH_COMPAT: tx('これ以降、互換レベルはその版になり、bash はそれより後の版で変わった動作を元に戻す（`4.2` か `42` なら `shopt -s compat42` と同じ。`50` と `51` には `shopt` のオプションがない）。レベルは同時に1つだけ', 'From here, the compatibility level is that release: bash brings back what later releases changed (`4.2` or `42`: as `shopt -s compat42`; `50` and `51` have no `shopt` option). There is one level at a time'),
  BASH_ENV: tx('`export` すると、このスクリプトが起動する非対話の bash が、このファイルを先に読む', 'Exported, it makes a non-interactive bash this script starts read this file first'),
  BASH_XTRACEFD: based(tx('これ以降、`set -x` のトレースはこのファイルディスクリプタに書かれる（前に書いていたディスクリプタは開いたまま）', 'From here, `set -x` writes its trace to this file descriptor (the one it wrote to before stays open)'), 'xtracefd-old-stays-open'),
  EXECIGNORE: tx('これ以降、`PATH` でコマンドを探すとき、これらに一致するファイルは飛ばす', 'From here, the search in `PATH` skips the files that match'),
  FUNCNEST: based(tx('これ以降、この深さを超える関数呼び出しはエラーになり、bash はそれを含むスクリプトのコマンドごと中断する（終了ステータス 1。bash 5.3 では、`bash -c` の文字列ならシェルがそこで終わる）', 'From here, a function call deeper than this is an error, and bash abandons the command of the script it is in (status 1; in bash 5.3, a `bash -c` string ends there instead)'), 'funcnest-status'),
  GLOBIGNORE: tx(
    'これ以降、ファイル名の展開はこれらに一致する名前を除く。空でない値は `dotglob` も有効にする（`.` で始まる名前も一致するが、`.` と `..` は除く）',
    'From here, filename expansion leaves out the names that match; a value that is not empty also turns `dotglob` on (names starting with `.` match too, but never `.` and `..`)',
  ),
  POSIXLY_CORRECT: based(tx('POSIX モードが有効になる（`set -o posix` と同じ。`unset` すると無効になる）', 'This turns POSIX mode on (as `set -o posix`; unsetting it turns it off)'), 'posixly-correct-unset'),
  PS3: tx('これ以降、`select` はこの文字列をプロンプトにする', 'From here, `select` prompts with this text'),
  PS4: tx('これ以降、`set -x` のトレースの各行はこの文字列で始まる（行ごとに展開される）', 'From here, each line of the `set -x` trace starts with this text (expanded for each line)'),
  RANDOM: based(tx('数を代入すると乱数の種になる（同じ種からは同じ数が並ぶ）', 'Assigning a number seeds the generator: the same seed gives the same numbers'), 'random-seed-repeats'),
  SECONDS: tx('数を代入すると、経過秒数をその数から数え直す', 'Assigning a number restarts the count from it'),
  TIMEFORMAT: tx('これ以降、`time` はこの書式で時間を表示する（空なら何も表示しない）', 'From here, `time` prints its timing in this format (nothing when it is empty)'),
  TMOUT: tx('これ以降、`read`（と端末からの `select`）は、この秒数のあいだ入力がなければあきらめる', 'From here, `read` (and `select` at a terminal) gives up after this many seconds without input'),
  // (Checked with the characters of a word: `${#x}` of `é` is 1 in a UTF-8 locale, 2 in C.)
  LANG: tx('これ以降、bash は `LC_` の変数で決めないカテゴリーにこのロケールを使う（`export` されていれば、起動するコマンドも）', 'From here, bash uses this locale for the categories no `LC_` variable sets (and so do the commands it starts, if it is exported)'),
  LC_ALL: tx('これ以降、bash はすべてのカテゴリーにこのロケールを使う（`export` されていれば、起動するコマンドも）', 'From here, bash uses this locale for every category (and so do the commands it starts, if it is exported)'),
  LC_CTYPE: tx('これ以降、`LC_ALL` がなければ、bash はこのロケールで文字を読む（`export` されていれば、起動するコマンドも）', 'From here, unless `LC_ALL` is set, bash reads characters in this locale (and so do the commands it starts, if it is exported)'),
});

/**
 * The variables whose value bash reads in a language of its own each time it uses it: the prompt strings PS0, PS1,
 * PS2 and PS4 (manual 6.9; not PS3, which `select` prints as it is). Their assignments show the value read so.
 */
export const variableLanguages: Readonly<Record<string, EmbeddedLang>> = wordTable({ PS0: 'prompt', PS1: 'prompt', PS2: 'prompt', PS4: 'prompt' });

/**
 * What an empty value does, where it differs from what `variableAssignments` says (`BASH_XTRACEFD=`). test/reading-manual.test.ts
 * checks each with bash.
 */
export const variableEmptied: Record<string, Text> = wordTable({
  BASH_XTRACEFD: tx(
    'これ以降、`set -x` のトレースは標準エラー出力に戻り、bash はそれまで書いていたディスクリプタを閉じる（2 でも閉じる）',
    'From here, `set -x` writes its trace to stderr again, and bash closes the descriptor it wrote to (even 2)',
  ),
});

/**
 * The variables the environment of a shell almost always has, exported, that are not bash's own (those are marked in
 * src/semantics/vars.ts, `BashVariable.environment`: `HOME`, `PATH`, `SHELL`, `LANG`, `TMPDIR`, `TERM`): the `USER`
 * and `LOGNAME` login sets (src/semantics/shellstate.ts, `environmentHas`).
 */
export const usualEnvironment: ReadonlySet<string> = new Set(['USER', 'LOGNAME']);

/**
 * The variables that bash 5.3 sets or reads (docs/design/bash-versions.md, 3.3; checked: test/bash53.test.ts). To
 * bash 5.2 they are plain variables.
 */
export const bash53Variables: Record<string, Text> = wordTable({
  GLOBSORT: tx(
    'グロブの結果の並べ方を決める: `name`（既定）・`numeric`（数字だけの名前を数値順に）・`size`・`mtime`・`atime`・`ctime`・`blocks`。前に `-` で降順、`nosort` で並べない',
    'how the results of a glob are sorted: `name` (the default), `numeric` (names of digits only by their value), `size`, `mtime`, `atime`, `ctime` or `blocks`; a `-` before it sorts in descending order, and `nosort` does not sort',
  ),
  BASH_TRAPSIG: tx('実行中の trap のシグナルの番号になる（`INT` なら 2）', 'the number of the signal whose trap is running, 2 for `INT`'),
  BASH_MONOSECONDS: tx('参照するたびに、システムの単調増加する時計の秒数になる', "the seconds of the system's monotonic clock, each time it is read"),
});

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

/** `=`, `==` and `!=` inside `[[ ]]`, where the right side is a pattern (in `[ ]` and `test` it is plain text: see `binaryTestOps`). */
export const extendedEqualOps: Record<string, Text> = {
  '=': tx('文字列が等しい（右辺はグロブパターン）', 'strings are equal (the right side is a glob pattern)'),
  '==': tx('文字列が等しい（右辺はグロブパターン）', 'strings are equal (the right side is a glob pattern)'),
  '!=': tx('文字列が等しくない（右辺はグロブパターン。パターンに一致すれば偽）', 'strings differ (the right side is a glob pattern; a match makes it false)'),
};

/**
 * `=`, `==` and `!=` inside `[[ ]]` where the pattern on the right has no wildcard and nocasematch is off (the word
 * model's `plainPattern`): it matches only itself, a plain comparison. `condition`: the text of the condition;
 * `operator`: the row of the operator, which says why, once.
 */
export const plainPatternOps: Record<'condition' | 'operator', Record<string, Text>> = {
  condition: {
    '=': tx('文字列が等しい', 'strings are equal'),
    '==': tx('文字列が等しい', 'strings are equal'),
    '!=': tx('文字列が等しくない', 'strings differ'),
  },
  operator: {
    '=': tx('文字列が等しい（右辺のパターンにワイルドカードとして働く文字がないので、普通の比較）', 'strings are equal (nothing in the pattern on the right acts as a wildcard: a plain comparison)'),
    '==': tx('文字列が等しい（右辺のパターンにワイルドカードとして働く文字がないので、普通の比較）', 'strings are equal (nothing in the pattern on the right acts as a wildcard: a plain comparison)'),
    '!=': tx('文字列が等しくない（右辺のパターンにワイルドカードとして働く文字がないので、普通の比較）', 'strings differ (nothing in the pattern on the right acts as a wildcard: a plain comparison)'),
  },
};

/** What the operands of a test operator are (6.4): the file it tests, a string, a variable's name, a number… */
export type TestOperandKind = 'file' | 'string' | 'variable' | 'option' | 'fd' | 'text' | 'number' | 'files';

/** The kind of the operand of each unary operator of a conditional expression (6.4). */
export const unaryTestOperands: Record<string, TestOperandKind> = {
  ...Object.fromEntries(['-a', '-b', '-c', '-d', '-e', '-f', '-g', '-h', '-k', '-p', '-r', '-s', '-u', '-w', '-x', '-G', '-L', '-N', '-O', '-S'].map((o) => [o, 'file' as const])),
  '-z': 'string', '-n': 'string', '-v': 'variable', '-R': 'variable', '-o': 'option', '-t': 'fd',
};

/**
 * The kind of the operands of each binary operator of a conditional expression (6.4), but `=`, `==`, `!=` and `=~`,
 * whose sides differ: `-eq` and the others compare integers (in `[[ ]]`, arithmetic expressions), `-nt` files.
 */
export const binaryTestOperands: Record<string, TestOperandKind> = {
  '<': 'text', '>': 'text',
  '-eq': 'number', '-ne': 'number', '-lt': 'number', '-le': 'number', '-gt': 'number', '-ge': 'number',
  '-nt': 'files', '-ot': 'files', '-ef': 'files',
};

/**
 * What a word of a conditional expression in `[[ ]]` is to its operator `{op}` (6.4, 3.2.5.2), by the kind of the
 * operand, or by its side of `=`, `==`, `!=` and `=~`: the string on the left, the pattern on the right (`plain`: one
 * with no wildcard, whose operator says that it is a plain comparison).
 */
export const testOperandTexts: Record<TestOperandKind | 'compared' | 'pattern' | 'plain', Text> = {
  file: tx('`{op}` で調べるファイル', 'The file `{op}` tests'),
  string: tx('`{op}` で調べる文字列', 'The string `{op}` tests'),
  variable: tx('`{op}` で調べる変数名', 'The variable name `{op}` tests'),
  option: tx('`{op}` で調べるシェルオプション名', 'The shell option name `{op}` tests'),
  fd: tx('`{op}` で調べるファイルディスクリプタ', 'The file descriptor `{op}` tests'),
  text: tx('`{op}` で比べる文字列', 'A string `{op}` compares'),
  number: tx('`{op}` で比べる値: 算術式として評価する', 'A value `{op}` compares: evaluated as an arithmetic expression'),
  files: tx('`{op}` で比べるファイル', 'A file `{op}` compares'),
  compared: tx('`{op}` で比べる左辺の文字列', 'The string on the left of `{op}`'),
  pattern: tx('`{op}` の右辺のパターン: 左辺がこれにパターンとして一致するかを調べる（クォートした部分は書いたとおりに一致）', 'The pattern on the right of `{op}`: the left side is matched against it as a glob pattern (a quoted part matches as written)'),
  plain: tx('`{op}` の右辺のパターン', 'The pattern on the right of `{op}`'),
};

/**
 * How bash's `<` and `>` compare (`collation` in src/testexpr.ts, by its `order` and `why`), after the operator's text.
 * Checked with bash 5.2.21 and 5.3 in en_US.UTF-8 (test/testexpr.test.ts).
 */
export const collationTexts: Record<string, Text> = {
  'locale': tx('ロケールの照合順序（`LC_COLLATE`）で比べる', 'compared in the locale\'s collation order (`LC_COLLATE`)'),
  'locale posix': tx('ロケールの照合順序（`LC_COLLATE`）で比べる（POSIX モードの bash 5.3 の比べ方。POSIX モードの外と bash 5.2 では、バイトの値で比べる）', 'compared in the locale\'s collation order (`LC_COLLATE`), as bash 5.3 does in POSIX mode (outside it, and in bash 5.2, `test` compares byte values)'),
  'bytes': tx('ロケールの照合順序ではなく、バイトの値で比べる', 'compared by byte values, not in the locale\'s collation order'),
  'bytes posix-5.2': tx('ロケールの照合順序ではなく、バイトの値で比べる（POSIX モードの bash 5.3 はロケールの照合順序で比べる）', 'compared by byte values, not in the locale\'s collation order (in POSIX mode, bash 5.3 uses that order)'),
  'bytes compat': tx('compat レベルが 4.0 以下なので、ロケールの照合順序ではなく、バイトの値で比べる', 'compared by byte values, not in the locale\'s collation order, at compatibility level 4.0 or lower'),
  'unknown posix': tx('バイトの値で比べる。POSIX モードになっている経路では、bash 5.3 はロケールの照合順序で比べる', 'compared by byte values; where POSIX mode is on (on some paths), bash 5.3 compares in the locale\'s collation order'),
  'unknown compat': tx('ロケールの照合順序で比べる。compat レベルを 4.0 以下にする経路では、バイトの値で比べる', 'compared in the locale\'s collation order; where the compatibility level is 4.0 or lower (on some paths), by byte values'),
};

export const binaryTestOps: Record<string, Text> = {
  '=': tx('文字列が等しい（右辺もただの文字列で、パターンではない）', 'strings are equal (the right side is plain text, not a pattern)'),
  '==': tx('文字列が等しい（右辺もただの文字列で、パターンではない）', 'strings are equal (the right side is plain text, not a pattern)'),
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
  if: tx('条件の始まり: `then` までのコマンドのうち、最後のコマンドの終了ステータスが 0 なら `then` 節を実行する', 'Start of the condition: if the last of the commands up to `then` exits 0, the `then` branch runs'),
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
  '-t': tx('trace 属性を付ける（関数では DEBUG・RETURN トラップを引き継ぐ）', 'give the trace attribute (a function inherits the DEBUG and RETURN traps)'),
  '-g': tx('関数内でもグローバル変数として宣言', 'declare global even inside a function'),
  '-I': tx('関数内で作るローカル変数に、外側の同じ名前の変数の値と属性を引き継ぐ', 'a local variable made in a function starts with the value and attributes of the variable of the same name outside it'),
  '-f': tx('関数名を対象にする', 'operate on function names'),
  '-F': tx('関数名のみ表示', 'show function names only'),
  '-p': tx('属性と値を表示', 'print attributes and values'),
};

/** `+x` and the like turn the attribute off again (`declare`, `typeset` and `local` only). */
export const declarationOffFlags: Record<string, Text> = {
  '-i': tx('整数の属性を外す', 'remove the integer attribute'),
  '-x': tx('エクスポートをやめる（環境変数でなくなる。値は残る）', 'stop exporting (no longer in the environment; the value stays)'),
  '-l': tx('小文字への変換をやめる', 'stop lowercasing on assignment'),
  '-u': tx('大文字への変換をやめる', 'stop uppercasing on assignment'),
  '-n': tx('名前参照をやめて普通の変数にする', 'make it a plain variable again, not a name reference'),
  '-t': tx('trace 属性を外す', 'remove the trace attribute'),
  '-r': tx('読み取り専用は外せない（エラーになる）', 'read-only cannot be removed (an error)'),
  '-a': tx('配列を普通の変数に戻すことはできない（エラーになる）', 'an array cannot be turned back into a plain variable (an error)'),
  '-A': tx('連想配列を普通の変数に戻すことはできない（エラーになる）', 'an associative array cannot be turned back into a plain variable (an error)'),
};

/** `export` has its own options: `-n` means something else than in `declare`. */
export const exportFlags: Record<string, Text> = {
  '-n': tx('エクスポートをやめる（環境変数でなくなる。値は残る）', 'remove the export property (no longer in the environment; the value stays)'),
  '-f': tx('変数ではなく関数をエクスポートする', 'export functions, not variables'),
  '-p': tx('エクスポート中の変数を `declare -x` の形で表示する', 'list the exported variables as `declare -x` lines'),
};

/** `readonly` options. */
export const readonlyFlags: Record<string, Text> = {
  '-a': tx('インデックス配列を読み取り専用にする', 'make indexed arrays read-only'),
  '-A': tx('連想配列を読み取り専用にする', 'make associative arrays read-only'),
  '-f': tx('変数ではなく関数を読み取り専用にする', 'make functions read-only, not variables'),
  '-p': tx('読み取り専用の変数を一覧表示する', 'list the read-only variables'),
};

export const declarationCommands: Record<string, Text> = {
  export: tx('変数を環境変数としてエクスポートし、子プロセスにも引き継ぐ', 'Export variables so child processes inherit them'),
  local: tx('関数内だけで有効なローカル変数を宣言', 'Declare variables local to the current function'),
  declare: tx('変数を宣言し、属性を設定する', 'Declare variables and set attributes'),
  typeset: tx('変数を宣言し、属性を設定する（declare と同じ）', 'Declare variables and set attributes (same as declare)'),
  readonly: tx('変数を読み取り専用（変更不可）にする', 'Mark variables read-only'),
};
