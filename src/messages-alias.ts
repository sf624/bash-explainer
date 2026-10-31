// The texts of the catalog's facts about aliases (src/messages.ts: `alias-*`), apart, to keep src/messages.ts short.
import { noShebang, READ_INTERACTIVELY, unreadClause } from './messages-common';

/** What code not read would do to make an alias work: turn `expand_aliases` on (`unreadClause`). */
export const TURNS_ALIASES_ON: readonly [string, string] = ['`expand_aliases` を有効にして', 'turns `expand_aliases` on'];

/**
 * `alias-not-expanded-in-script`: `off`, turned off by the script; `unread`, after code the model does not read, which
 * may turn it on; `fn`, the name is also a function defined on some paths before here, which runs on those.
 */
export const aliasNotExpandedText = ({ name, value, off, unread, fn }: { name: string; value: string; off?: boolean; unread?: boolean; fn?: boolean }): readonly [string, string] => {
  const unless = fn ? [`（この前の一部の経路で定義される関数 \`${name}\` が定義されていれば、その関数が実行されます）`, `, unless the function \`${name}\`, defined on some paths before here, runs instead`] : unreadClause(unread, TURNS_ALIASES_ON);
  return off ? [
    `\`shopt -u expand_aliases\` でエイリアスの展開が無効になっているので、\`${name}\` は対話シェルでも「command not found」になります${unless[0]}。\`shopt -s expand_aliases\` で有効に戻すか、関数 \`${name}() { ${value} "$@"; }\` にします`,
    `alias expansion is turned off (\`shopt -u expand_aliases\`), so \`${name}\` is "command not found", also in an interactive shell${unless[1]}. Turn it on again with \`shopt -s expand_aliases\`, or make it a function: \`${name}() { ${value} "$@"; }\``] : [
    `bash はスクリプトの中ではエイリアスを展開しないので、\`${name}\` は「command not found」になります${unless[0]}。\`shopt -s expand_aliases\` を \`alias\` より前に書くか、関数 \`${name}() { ${value} "$@"; }\` にします（\`.bashrc\` など対話シェルで読むファイルなら問題ありません）`,
    `bash does not expand aliases in scripts, so \`${name}\` is "command not found"${unless[1]}. Put \`shopt -s expand_aliases\` before the \`alias\`, or make it a function: \`${name}() { ${value} "$@"; }\` (fine in files read by interactive shells, such as \`.bashrc\`)`];
};

/** `alias-maybe-not-expanded`: a file with no shebang, which bash may run as a script or an interactive shell may read. */
export const aliasMaybeText = ({ name, value }: { name: string; value: string }): readonly [string, string] => {
  const [ja, en] = noShebang(true, [
    `bash はスクリプトの中ではエイリアスを展開しないので、スクリプトとして実行すると（\`bash ファイル\`）\`${name}\` は「command not found」になります`,
    `bash does not expand aliases in scripts, so run as a script (\`bash file\`), \`${name}\` is "command not found"`],
  [`${READ_INTERACTIVELY[0]}展開されます`, `${READ_INTERACTIVELY[1]} it is expanded`]);
  return [`${ja}。スクリプトなら \`shopt -s expand_aliases\` を \`alias\` より前に書くか、関数 \`${name}() { ${value} "$@"; }\` にします`,
    `${en}. Put \`shopt -s expand_aliases\` before the \`alias\` in a script, or make it a function: \`${name}() { ${value} "$@"; }\``];
};

/** `alias-defined-same-unit` and `alias-defined-later`: the alias is not in effect where the name is read. */
export const aliasDefinedText = (why: 'same-unit' | 'later') => ({ name, line }: { name: string; line: number }): readonly [string, string] => (why === 'same-unit' ? [
  `\`${name}\` は行 ${line} で \`alias\` として定義されますが、bash は行（複合コマンドや関数の本体も）をまとめて読んでから実行するので、同じ行で定義したエイリアスはまだ使えません。ここでは alias ではないので、\`${name}\` というコマンドがなければ「command not found」になります（\`eval\` に渡した文字列は実行時に読み直されるので、エイリアスが使えます）`,
  `\`${name}\` is defined as an alias on line ${line}, but bash reads a whole line (and a whole compound command or function body) before running it, so an alias defined on the same line is not in effect yet. It is not an alias here: without a command named \`${name}\`, this is "command not found" (a string given to \`eval\` is read again when it runs, so it can use the alias)`] : [
  `\`${name}\` は行 ${line} で \`alias\` として定義されますが、これはその前に読まれ、エイリアスは実行された後に読まれるものにだけ効きます。ここでは alias ではないので、\`${name}\` というコマンドがなければ「command not found」になります（\`eval\` に渡した文字列は実行時に読み直されるので、エイリアスが使えます）`,
  `\`${name}\` is defined as an alias on line ${line}, but this is read before that, and an alias works only on what is read after it ran. It is not an alias here: without a command named \`${name}\`, this is "command not found" (a string given to \`eval\` is read again when it runs, so it can use the alias)`]);
