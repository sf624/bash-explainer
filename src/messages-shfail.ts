// The sentences of how a POSIX shell fails where it lacks a form of bash (the `dash` and `ash` of a row of
// FEATURES, src/shellfeatures.ts; usability-9.md, 2.8): the message the shell prints and the status it gives, each
// measured in dash and busybox ash. test/dialect-dash.test.ts runs every one in both and compares `status`, `says`
// and whether the shell stops. A dialect issue is no fact of the catalog (src/messages.ts: `problemNote`), so
// these sentences are the dialect table's; they are here to keep the table short. A leaf module.
import type { Failure } from './shellfeatures';

type Say = (shell: string) => string;

/** "in dash " before a sentence; none where the shell is already named around it (`FEATURES` of one shell: "is not available in dash (…)"). */
const at = (sh: string): string => (sh ? `in ${sh} ` : '');
/** The same in Japanese: "dash では ". */
const atJa = (sh: string): string => (sh ? `${sh} では` : '');

/**
 * How the shell fails. `fault`: `read`, a syntax error as it reads the text, even where the text never runs; `stop`, it
 * fails where it runs and the shell stops; `status`, it fails with a status and the script goes on. `status`: the
 * command's, or the shell's when it stops. `says`: a text of the shell's message (any case) in dash and busybox ash
 * both (compared by the test, never shown).
 */
const failure = (fault: Failure['fault'], status: number, says: string, ja: Say, en: Say): Failure => ({ fault, status, says, ja: (sh) => ja(sh).trimStart(), en });

/** What follows "and" where the shell stops. */
const STOP: readonly [string, string] = ['シェルがそこで止まります', 'the shell stops there'];
/**
 * Where only the subshell the failure is in stops (`$( )`, a stage of a pipeline, `( )`), [ja, en]: the script goes on unless `set -e` stops it
 * (it does, at `( echo "${x^^}" )` and `v=$(…)`). Said once, for a failure and for an unset variable (src/dialect.ts).
 */
export const SUBSHELL_STOPS: readonly [string, string] = ['そのサブシェルだけが止まり、スクリプトは続きます。ただし `set -e` が有効なら、スクリプトも止まります', 'only that subshell stops, and the script goes on unless `set -e` stops it'];

/** A failure that stops the shell, and, in `subshell`, the same where the shell is a subshell: it fails with the status, and the script goes on (`stopsWhere`, src/dialect.ts). */
const stopping = (status: number, says: string, ja: (shell: string, end: string) => string, en: (shell: string, end: string) => string): Failure => ({
  ...failure('stop', status, says, (sh) => ja(sh, STOP[0]), (sh) => en(sh, STOP[1])),
  subshell: failure('status', status, says, (sh) => ja(sh, SUBSHELL_STOPS[0]), (sh) => en(sh, SUBSHELL_STOPS[1])),
});

/** What a syntax error does: the shell reads a line at a time and stops at the one it refuses (`echo a` before it has run). */
export const SYNTAX_ERROR = failure('read', 2, 'syntax error',
  (sh) => `${atJa(sh)}終了ステータス 2 の構文エラーです。実行されない行でも、読んだ時点でシェルが止まります`,
  (sh) => `${at(sh)}it is a syntax error with status 2: the shell stops as it reads the line, even if the line would never run`);

/** A parameter expansion the shell lacks (`${x/a/b}`, `${x^^}`): an error where it runs. */
export const BAD_SUBSTITUTION = stopping(2, 'bad substitution',
  (sh, end) => `${atJa(sh)} \`bad substitution\` エラーで終了ステータス 2 になり、${end}`,
  (sh, end) => `${at(sh)}it fails with \`bad substitution\` and status 2; ${end}`);

/** A command of bash that is no command there (the row's `builtins`): the label names it. */
export const NO_COMMAND = failure('status', 127, 'not found',
  (sh) => `${atJa(sh)}そのコマンドが見つからず、\`not found\` で終了ステータス 127 になります`,
  (sh) => `${at(sh)}the command is not found, with status 127`);

/** A word that is run as a command and is not found; `test`: in a condition, which is then false. */
export const notFound = (what: string, test = false): Failure => failure('status', 127, `${what}: not found`,
  (sh) => `${atJa(sh)} \`${what}\` がコマンドとして実行され、見つからずに終了ステータス 127 になります${test ? '。条件に使うと偽になります' : ''}`,
  (sh) => `${at(sh)}\`${what}\` is run as a command, is not found and gives status 127${test ? ', so a condition with it is false' : ''}`);

/** `a+=2` is a command name (`name+=value`). */
export const PLUS_ASSIGN = failure('status', 127, 'a+=2: not found',
  (sh) => `${atJa(sh)} \`変数名+=値\` がコマンド名とみなされ、見つからずに終了ステータス 127 になります`,
  (sh) => `${at(sh)}\`name+=value\` is taken for a command name, is not found and gives status 127`);

/** `(( ))`: two subshells, and the text inside runs as a command (a `>` in it redirects to a file). */
export const ARITH_COMMAND = failure('status', 127, 'not found',
  (sh) => `${atJa(sh)}入れ子のサブシェルとして読まれ、中の文字列がコマンドとして実行されます。たいていは \`not found\` で終了ステータス 127 になり、中の \`>\` はファイルへのリダイレクトになります。\`(( x > 0 ))\` は \`0\` というファイルを作ります。条件に使うと偽になります`,
  (sh) => `${at(sh)}it is two nested subshells, and the text inside runs as a command: usually \`not found\` with status 127, and a \`>\` in it redirects to a file: \`(( x > 0 ))\` creates a file \`0\`. So a condition with it is false`);

/** A builtin that rejects an option (`illegal option`, status 2); `stops`: a special builtin, which ends the shell. */
export const optionRefused = (cmd: string): Failure => failure('status', 2, 'illegal option',
  (sh) => `${atJa(sh)} \`${cmd}\` がそのオプションを受け付けず、\`illegal option\` で終了ステータス 2 になります`,
  (sh) => `${at(sh)}\`${cmd}\` rejects the option with \`illegal option\` and status 2`);
/** `export -f`: `export` is a special builtin, so the shell stops. */
export const EXPORT_F = stopping(2, 'illegal option',
  (sh, end) => `${atJa(sh)} \`export\` が \`-f\` を受け付けず、\`illegal option\` で終了ステータス 2 になり、${end}`,
  (sh, end) => `${at(sh)}\`export\` rejects \`-f\` with \`illegal option\` and status 2; ${end}`);

/** `printf %q`: dash gives status 2 (`invalid directive`), busybox ash status 1 (`invalid format`). */
const printfQ = (status: number, says: string): Failure => failure('status', status, says,
  (sh) => `${atJa(sh)} \`printf\` が \`%q\` を受け付けず、終了ステータス ${status} になります`,
  (sh) => `${at(sh)}\`printf\` rejects \`%q\` with status ${status}`);
export const PRINTF_Q_DASH = printfQ(2, 'invalid directive');
export const PRINTF_Q_ASH = printfQ(1, 'invalid format');

/** `>/dev/tcp/host/port`: the name is a path, and there is no such directory (dash status 2, busybox ash 1). */
const netRedirect = (status: number): Failure => failure('status', status, '/dev/tcp',
  (sh) => `${atJa(sh)} \`/dev/tcp\` というディレクトリがなく、リダイレクトに失敗して終了ステータス ${status} になります`,
  (sh) => `${at(sh)}the redirection fails, as there is no \`/dev/tcp\` directory, with status ${status}`);
export const NET_REDIRECT_DASH = netRedirect(2);
export const NET_REDIRECT_ASH = netRedirect(1);
/** The same at a special builtin (`exec 3<>/dev/tcp/host/port`, `: </dev/tcp/…`): a redirection that fails ends the shell. */
const netRedirectSpecial = (status: number): Failure => stopping(status, '/dev/tcp',
  (sh, end) => `${atJa(sh)} \`/dev/tcp\` というディレクトリがなく、リダイレクトに失敗して終了ステータス ${status} になります。特殊ビルトインなので、${end}`,
  (sh, end) => `${at(sh)}the redirection fails, as there is no \`/dev/tcp\` directory, with status ${status}; as the command is a special builtin, ${end}`);
export const NET_REDIRECT_DASH_SPECIAL = netRedirectSpecial(2);
export const NET_REDIRECT_ASH_SPECIAL = netRedirectSpecial(1);

/** `[ a == b ]` in dash. */
export const EQEQ_TEST = failure('status', 2, 'unexpected operator',
  (sh) => `${atJa(sh)} \`[\` が \`unexpected operator\` を報告し、終了ステータス 2 になるので、テストは偽になります`,
  (sh) => `${at(sh)}\`[\` reports \`unexpected operator\` and gives status 2, so the test is false`);

/** `type -t ls` in dash: `-t` is a name to look up. */
export const TYPE_T = failure('status', 127, '-t: not found',
  (sh) => `${atJa(sh)} \`-t\` が調べる名前として扱われ、\`-t: not found\` と表示して終了ステータス 127 になります`,
  (sh) => `${at(sh)}\`-t\` is taken for a name to look up: it prints \`-t: not found\` and gives status 127`);

/** `trap … ERR` in dash. */
export const TRAP_ERR = failure('status', 1, 'bad trap',
  (sh) => `${atJa(sh)} \`trap\` が \`ERR\` を受け付けず、\`bad trap\` で終了ステータス 1 になります`,
  (sh) => `${at(sh)}\`trap\` rejects \`ERR\` with \`bad trap\` and status 1`);

/** `set -o pipefail` (and `set +o pipefail`) in dash: `set` is a special builtin, so the shell stops. */
export const SET_PIPEFAIL = stopping(2, 'illegal option',
  (sh, end) => `${atJa(sh)} \`set\` がオプション \`pipefail\` を受け付けず、\`illegal option\` で終了ステータス 2 になり、${end}`,
  (sh, end) => `${at(sh)}\`set\` rejects the option \`pipefail\` with \`illegal option\` and status 2; ${end}`);

/** `a[0]=1`: the word is a command name (`name[index]=value`). */
export const ELEMENT_ASSIGN = failure('status', 127, 'not found',
  (sh) => `${atJa(sh)} \`変数名[添字]=値\` がコマンド名とみなされ、見つからずに終了ステータス 127 になります`,
  (sh) => `${at(sh)}\`name[index]=value\` is taken for a command name, is not found and gives status 127`);

/** An operator of `$(( ))` the shell does not have (`i++`, `2**3` in dash): an error where the expansion runs. */
export const ARITH_OPERATOR = stopping(2, 'arithmetic expression',
  (sh, end) => `${atJa(sh)}算術式を読めず、\`arithmetic expression: expecting primary\` で終了ステータス 2 になり、${end}`,
  (sh, end) => `${sh ? `${sh} cannot` : 'it cannot'} read the expression: \`arithmetic expression: expecting primary\`, status 2; ${end}`);

/** `>& file` in dash: `>&` takes a descriptor there, and a name is an error where the redirection is made. */
export const DUP_FILE = stopping(2, 'bad fd number',
  (sh, end) => `${atJa(sh)} \`>&\` の後ろにはファイルディスクリプタの番号しか書けず、\`Bad fd number\` で終了ステータス 2 になり、${end}`,
  (sh, end) => `${at(sh)}\`>&\` takes only a descriptor number: it fails with \`Bad fd number\` and status 2; ${end}`);

/** `read` with no name in dash: it reads nothing into `REPLY`. */
export const READ_NO_NAME = failure('status', 2, 'arg count',
  (sh) => `${atJa(sh)} \`read\` が変数名を求め、\`arg count\` で終了ステータス 2 になり、\`REPLY\` には何も入りません`,
  (sh) => `${at(sh)}\`read\` needs a name: it fails with \`arg count\` and status 2, and \`REPLY\` is not set`);

/** `$'a\'b'` in dash: the quote ends at the `\'`, and the rest of the script is read as another string. */
export const ANSIC_QUOTE = failure('stop', 2, 'syntax error',
  (sh) => `${atJa(sh)}、あとに閉じる \`'\` がスクリプトになければ終了ステータス 2 の構文エラーになり、シェルが止まります`,
  (sh) => `${at(sh)}it is a syntax error with status 2, and the shell stops, unless a later \`'\` in the script closes the string`);

/**
 * `function f { …; }` in dash: `function` is a command name. The shell reads a line at a time at the top level and the whole of a compound command,
 * so it may run `function f {` (not found, status 127: `set -e` stops there) and the body before it stops at the `}` (status 2), or read the error first.
 * The sentence claims no order but that the stop is at the syntax error, or sooner under `set -e`.
 */
export const FUNCTION_KEYWORD = failure('read', 2, 'syntax error',
  (sh) => `${atJa(sh)} \`function\` がコマンド名として読まれ、見つからずに終了ステータス 127 になり、後ろの \`}\` か \`()\` が終了ステータス 2 の構文エラーになります。シェルは構文エラーで止まり、\`set -e\` が有効ならもっと早く止まることもあります。トップレベルでは、その前の行は実行済みのことがあります`,
  (sh) => `${at(sh)}\`function\` is read as a command name and is not found with status 127, and the \`}\` or \`()\` after it is a syntax error with status 2. The shell stops at the syntax error, or sooner under \`set -e\`; at the top level, lines before it may have run`);
