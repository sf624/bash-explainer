// The texts of the catalog's facts about what ends the shell in POSIX mode and what `exit` does with words that give it
// no status (src/messages.ts: `posix-special-builtin-error`, the function names, `exit-refused`), apart, to keep
// src/messages.ts short.

/** An error of a special builtin that ends the shell in POSIX mode (`PosixExit` of src/semantics/posixexits.ts). */
export interface PosixExitParams { name: string; why: string; word: string; status: number; stops: Stops; since?: string; trap?: boolean }

/** The shell an exit ends: the script, a subshell, or either (`ErrexitContext.stops`). */
export type Stops = 'script' | 'subshell' | 'unknown';

/** What bash ends, [ja, en], after "bash は" / "bash ": the script, this subshell, or the shell that runs it. */
const ENDS: Record<Stops, readonly [string, string]> = {
  script: ['ここでスクリプトを止めます', 'stops the script here'],
  subshell: ['ここでこのサブシェルを終わらせます', 'ends this subshell here'],
  unknown: ['ここで、それを実行しているシェルを止めます', 'stops the shell that runs it here'],
};
export const ends = (stops: Stops): readonly [string, string] => ENDS[stops] ?? ENDS.script;

/** What the error is (`why`), [ja, en]: each part ends where "so" follows. */
function posixExitWhat({ name, why, word }: PosixExitParams): readonly [string, string] {
  switch (why) {
    case 'invalid-option': return [`\`${name}\` に \`${word}\` というオプションはない`, `\`${name}\` has no option \`${word}\``];
    case 'option-value': return [`\`${word}\` の値がない`, `\`${word}\` has no value`];
    case 'option-name': return [`\`${word}\` は \`set -o\` のオプション名ではない`, `\`${word}\` is no option name of \`set -o\``];
    case 'no-file': return [`\`${name}\` に読むファイルの指定がない`, `\`${name}\` is given no file to read`];
    case 'trap-word': return [`\`trap\` にシグナル番号でない語が1つだけ渡されている（使い方の誤り）`, `\`trap\` is given a lone word that is no signal number (a usage error)`];
    case 'identifier': return [`\`${word}\` は名前として正しくない`, `\`${word}\` is not a valid name`];
    case 'readonly': return [`\`${word}\` は読み取り専用の変数である`, `\`${word}\` is a read-only variable`];
    default: return [`\`${word}\` は数ではない`, `\`${word}\` is no number`];
  }
}

export function posixExitText(p: PosixExitParams, maybe: boolean): readonly [string, string] {
  const [ja, en] = posixExitWhat(p);
  const where = ends(p.stops);
  // (A trap's action: when the trap runs; on `EXIT`, the script ends anyway.)
  const trap: readonly [string, string] = p.trap ? ['。トラップの動作の中なので、そうなるのはトラップが動いたときで、`EXIT` のトラップならスクリプトはもともと終わるところで、変わるのは終了ステータスだけです', '. In a trap\'s action, that happens when the trap runs; in a trap on `EXIT` the script is ending anyway, and only its status changes'] : ['', ''];
  const since: readonly [string, string] = p.since ? [`。bash ${p.since} から。bash 5.2 は終了ステータス 1 で続ける`, `; bash ${p.since} on: bash 5.2 goes on, with status 1`] : ['', ''];
  const paths: readonly [string, string] = maybe ? ['。そうなるのは一部の経路だけ（POSIX モードの経路、または `set -e` が無視されない呼び出し）', '; on some paths only (where POSIX mode is on, or a call where bash does not ignore `set -e`)'] : ['', ''];
  return [
    `POSIX モードでは特殊ビルトインのエラーで非対話シェルが終了します。ここでは ${ja}ため、bash は${where[0]}（終了ステータス ${p.status}${since[0]}${paths[0]}）${trap[0]}`,
    `in POSIX mode an error of a special builtin ends a shell that is not interactive: here ${en}, so bash ${where[1]} (status ${p.status}${since[1]}${paths[1]})${trap[1]}`];
}

/** `exit` with words that give it no status (`ExitRefusal` of src/semantics/status.ts). */
export interface ExitRefusedParams { why: string; word: string; status: number; version: string; exits: boolean }

export function exitRefusedText({ why, word, status, version, exits }: ExitRefusedParams): readonly [string, string] {
  return (why === 'too-many' ? [
    `\`exit\` が受け取る終了ステータスは1つだけで、それより多く渡すと bash は「too many arguments」のエラーになり、シェルは終了せずに続きます（bash ${version} では終了ステータス ${status}。bash 5.2 は 1、bash 5.3 は 2）`,
    `\`exit\` takes one status: given more words, bash says "too many arguments" and does not exit; the shell goes on (status ${status} in bash ${version}: 1 in bash 5.2, 2 in bash 5.3)`]
    : exits ? [
      `\`${word}\` は数ではないので、bash ${version} は「numeric argument required」のエラーになり、終了ステータス 2 で終了します（bash 5.3 は POSIX モードの外では終了せずに続ける）`,
      `\`${word}\` is no number: bash ${version} says "numeric argument required" and exits, status 2 (bash 5.3 goes on there, outside POSIX mode)`]
      : [
        `\`${word}\` は数ではないので、bash ${version} は「numeric argument required」のエラーになりますが、終了せずに続きます（終了ステータス 2。bash 5.2 は終了し、POSIX モードの bash 5.3 も \`set -e\` が止めるところでは終了する）`,
        `\`${word}\` is no number: bash ${version} says "numeric argument required" but does not exit; the shell goes on, status 2 (bash 5.2 exits; so does bash 5.3 in POSIX mode, where \`set -e\` would stop it)`]);
}
