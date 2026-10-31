// The texts of the catalog's facts about what a wrapper, a new shell, a remote shell or a container does not get
// (src/messages.ts: `variable-not-*`, `function-not-*`, `builtin-or-function-as-program`, `function-shadowed-by-program`,
// `ssh-local-expansion`; manual 3.7.3, 3.7.4, 3.3), apart, to keep src/messages.ts short.
// (`unread`, here and below: code the model does not read, which runs before, may set it there: `unreadClause`.)
import type { Text } from './i18n';
import { DEFINES_IT, leavesSet, SETS_IT, unlessAny, unreadClause, unreadCode } from './messages-common';

type Texts = readonly [string, string];

/**
 * A variable ssh may send (`sent`: `SendEnv` in ssh_config, `-o SendEnv=…`), which the server takes when its `AcceptEnv`
 * names it: Debian's and Ubuntu's ssh_config send `LANG` and `LC_*`, and their sshd_config accepts them.
 */
const SENT: Texts = ['（ssh が `SendEnv` で送り、サーバーが `AcceptEnv` で受け付けるときを除く。Debian や Ubuntu の設定は `LANG` と `LC_*` を送り、受け付ける）',
  ' (unless ssh sends it with `SendEnv` and the server accepts it with `AcceptEnv`, as Debian\'s and Ubuntu\'s configurations do for `LANG` and `LC_*`)'];

/** `variable-not-in-remote-shell`: `sent`, ssh may send it (`SENT`), a caveat. */
export const variableNotInRemoteText = ({ v, unread, sent }: { v: string; unread?: boolean; sent?: boolean }): Texts => {
  const unless = sent ? SENT : unreadClause(unread, SETS_IT);
  return [
    `\`$${v}\` はリモートのシェルが展開しますが、リモートにはこのスクリプトの変数 \`${v}\` はありません${unless[0]}。値を送るなら、こちらで展開されるようダブルクォートの中に書きます`,
    `the remote shell expands \`$${v}\`, but it does not have \`${v}\`, a variable of this script${unless[1]}. To send its value, write it in double quotes, so that it is expanded here`];
};

/**
 * `variable-not-passed-by-wrapper`: `keeps`, what the wrapper still passes of the environment, up to two names: sudo's
 * `TERM`, `LANG`, `su -l`'s `TERM` (`SlotLink.keeps`).
 */
export const variableNotPassedText = ({ v, via, keeps = [], unread }: { v: string; via: string; keeps?: readonly string[]; unread?: boolean }): Texts => {
  const [a, b] = keeps.map((k) => `\`${k}\``);
  return [
    `文字列の中の \`$${v}\` は新しいシェルが展開しますが、\`${via}\` はこのスクリプトの変数を（エクスポートしたものも${b ? `、${a} や ${b} などいくつかを除いて` : a ? `、${a} を除いて` : ''}）渡さないので、そこには \`${v}\` はありません${unreadClause(unread, SETS_IT)[0]}。値を使うなら、こちらで展開されるようダブルクォートの中に書きます`,
    `the new shell expands \`$${v}\` in the string, but \`${via}\` passes none of this script's variables (not even exported ones${b ? `, but for a few such as ${a} and ${b}` : a ? `, but for ${a}` : ''}), so \`${v}\` is not there${unreadClause(unread, SETS_IT)[1]}. To use its value, write it in double quotes, so that it is expanded here`];
};

/**
 * `variable-not-exported`. `environment`: the script set it with no `unset`, `local` or `export -n` before, so it is
 * exported when it came from the environment, `maybe` (capitals) or `unlikely` (lower case): src/semantics/shellstate.ts,
 * `fromEnvironment`. `array`: bash exports no array, even one `export` marks, `declare -p` showing `-ax`. The Reference
 * Manual does not say it (the man page does, under BUGS: "Array variables may not (yet) be exported"): checked.
 * Without it, 3.7.3 and 3.7.4 say that a command run apart gets only what is exported.
 */
export const variableNotExportedText = ({ v, environment, array, unread }: { v: string; environment?: 'maybe' | 'unlikely'; array?: boolean; unread?: boolean }): Texts => {
  if (array) {
    return [`文字列の中の \`$${v}\` は新しいシェルが展開しますが、\`${v}\` は配列で、bash は配列をエクスポートできない（\`export\` しても渡らない）ので、そこでは空です。値を渡すなら、\`"\${${v}[*]}"\` を引数として渡すか、文字列の変数にします`,
      `the new shell expands \`$${v}\` in the string, but \`${v}\` is an array, and bash cannot export an array (not even with \`export\`), so it is empty there. To pass its values, give \`"\${${v}[*]}"\` as an argument, or use a string variable`];
  }
  if (environment === 'maybe') {
    return [`文字列の中の \`$${v}\` は新しいシェルが展開します。\`${v}\` はこのスクリプトで設定していますが、エクスポートしていないので、そこに値が届くのは \`${v}\` が初めから環境変数にあったとき（環境変数から来た変数はエクスポートされています）だけで、そうでなければ空です。先に \`export ${v}\` します`,
      `the new shell expands \`$${v}\` in the string, and \`${v}\` is set by this script but not exported: its value gets there only when \`${v}\` was in the environment already (a variable from the environment is exported), and it is empty otherwise. Run \`export ${v}\` first`];
  }
  const unless = unlessAny(environment ? [`環境変数に初めから \`${v}\` があるとき`, `the environment already has \`${v}\``] : undefined, unread ? [`${unreadCode(leavesSet(v))[0]}いるとき`, unreadCode(leavesSet(v))[1]] : undefined);
  return [`文字列の中の \`$${v}\` は新しいシェルが展開します。\`${v}\` はこのスクリプトの変数で、エクスポートされていないので、そこでは空です${unless[0]}。先に \`export ${v}\` します`,
    `the new shell expands \`$${v}\` in the string, and \`${v}\` is a variable of this script that is not exported, so it is empty there${unless[1]}. Run \`export ${v}\` first`];
};

export const functionNotInContainerText = ({ via, name }: { via: string; name: string }): Texts => [
  `\`${via}\` は \`${name}\` をコンテナの中で実行します。このスクリプトの関数はコンテナの中にはないので使えません。関数の中身を直接書きます`,
  `\`${via}\` runs \`${name}\` inside the container, and a function from this script is not available in the container. Write out its body instead`];

export const builtinOrFunctionAsProgramText = ({ via, name, isFn, fix }: { via: string; name: string; isFn: boolean; fix: Text }): Texts => [
  `\`${via}\` は \`${name}\` を別のプログラムとして起動するため、シェルの${isFn ? '関数' : '組み込みコマンド'}は実行できません（\`command not found\` になるか、今のシェルには効きません）。${fix.ja}`,
  `\`${via}\` starts \`${name}\` as a separate program, so it cannot run a shell ${isFn ? 'function' : 'builtin'} ("command not found", or no effect on the current shell). ${fix.en}`];

export const sshLocalExpansionText = ({ risky }: { risky: string }): Texts => [
  `\`ssh\` に渡すコマンドのうち \`${risky}\` は、送られる前にこちらのシェルが展開します（\`$変数\`・\`$(…)\`・\`*\`・\`~\` はこちらの値になります）。リモートで展開したいときは全体をシングルクォートで囲みます: \`ssh host '…'\``,
  `the local shell expands \`${risky}\` in the command given to \`ssh\` before it is sent (\`$var\`, \`$(…)\`, \`*\` and \`~\` take local values). To expand them on the remote side, single-quote the whole command: \`ssh host '…'\``];

export const functionNotOnRemoteText = ({ name }: { name: string }): Texts => [
  `リモートのシェルには、このスクリプトの関数 \`${name}\` はありません。中身を直接書くか、\`ssh host "$(declare -f ${name}); ${name}"\` のように定義ごと送ります`,
  `the remote shell does not have this script's function \`${name}\`. Write out its body, or send the definition too: \`ssh host "$(declare -f ${name}); ${name}"\``];

export const functionNotInNewShellBlockedText = ({ via, fn, blocker }: { via: string; fn: string; blocker: string }): Texts => [
  `\`${via}\` は新しいシェルでコマンドを実行するため、このスクリプトの関数 \`${fn}\` は使えません。\`${blocker}\` は環境の関数を渡さないので、\`export -f ${fn}\` も効きません。関数の中身を直接書きます`,
  `\`${via}\` runs the command in a new shell, which does not have this script's function \`${fn}\`, and \`${blocker}\` passes no exported functions, so \`export -f ${fn}\` does not help either. Write out its body`];

export const functionNotInNewShellText = ({ via, fn }: { via: string; fn: string }): Texts => [
  `\`${via}\` は新しいシェルでコマンドを実行するため、このスクリプトの関数 \`${fn}\` は使えません。関数の中身を直接書きます`,
  `\`${via}\` runs the command in a new shell, which does not have this script's function \`${fn}\`. Write out its body`];

export const functionNotImportedText = ({ via, shell, fn }: { via: string; shell: string; fn: string }): Texts => [
  `\`${via}\` はコマンドを ${shell} で実行します。${shell} は bash がエクスポートした関数を読まないので、\`export -f\` してもこのスクリプトの関数 \`${fn}\` は使えません。関数の中身を直接書くか、\`bash -c\` を使います`,
  `\`${via}\` runs the command in ${shell}, which does not read the functions bash exports, so this script's function \`${fn}\` is not there, even with \`export -f\`. Write out its body, or use \`bash -c\``];

export const functionNotInNewShellExportText = ({ via, fn, unread }: { via: string; fn: string; unread?: boolean }): Texts => [
  `\`${via}\` は新しいシェルでコマンドを実行するため、このスクリプトの関数 \`${fn}\` は使えません${unreadClause(unread, DEFINES_IT)[0]}。関数の中身を直接書くか、先に \`export -f ${fn}\` で関数を渡します（新しいシェルが bash のときだけ）`,
  `\`${via}\` runs the command in a new shell, which does not have this script's function \`${fn}\`${unreadClause(unread, DEFINES_IT)[1]}. Write out its body, or pass the function with \`export -f ${fn}\` first (only when the new shell is bash)`];

export const functionNotImportedShText = ({ via, fn }: { via: string; fn: string }): Texts => [
  `\`${via}\` はコマンドを sh で実行します。Debian や Ubuntu の sh は dash で、dash は bash がエクスポートした関数を読まないので、このスクリプトの関数 \`${fn}\` は使えないことがあります。\`bash -c\` を使います`,
  `\`${via}\` runs the command in sh, which is dash on Debian and Ubuntu, and dash does not read the functions bash exports, so this script's function \`${fn}\` may not be there. Use \`bash -c\``];

/**
 * `function-shadowed-by-program`: a function of the script that is also the name of a program (`ls() { command ls -F
 * "$@"; }`), where the function is not there (`where`: a program a wrapper starts, a new shell, a remote shell, a
 * container). The program of that name runs: often what is meant (`sudo ls`), and otherwise only the function's own
 * steps are lost (`curl() { command curl --retry 3 "$@"; }` with `timeout 30 curl …`).
 */
export const functionShadowedText = ({ via, name, where }: { via: string; name: string; where: 'program' | 'shell' | 'remote' | 'container' }): Texts => {
  const [ja, en]: Texts = where === 'program' ? [
    `\`${via}\` は \`${name}\` を別のプログラムとして起動するので、このスクリプトの関数 \`${name}\` ではなく、同じ名前のプログラムが実行されます`,
    `\`${via}\` starts \`${name}\` as a separate program, so the program \`${name}\` runs, not this script's function of that name`] : where === 'shell' ? [
    `\`${via}\` は新しいシェルでコマンドを実行し、そこにはこのスクリプトの関数 \`${name}\` がないので、同じ名前のプログラムが実行されます`,
    `\`${via}\` runs the command in a new shell, which does not have this script's function \`${name}\`, so the program \`${name}\` runs there`] : where === 'remote' ? [
    `リモートのシェルにはこのスクリプトの関数 \`${name}\` がないので、そこでは同じ名前のプログラムが実行されます`,
    `the remote shell does not have this script's function \`${name}\`, so the program \`${name}\` runs there`] : [
    `\`${via}\` は \`${name}\` をコンテナの中で実行し、そこにはこのスクリプトの関数がないので、イメージにある同じ名前のプログラムが実行されます`,
    `\`${via}\` runs \`${name}\` inside the container, which does not have this script's function, so the image's program \`${name}\` runs`];
  return [`${ja}。それが意図どおりなら問題ありません。関数を実行したいところには、その中身を直接書きます`, `${en}. That may be what is meant. Write out its body where the function is meant`];
};
