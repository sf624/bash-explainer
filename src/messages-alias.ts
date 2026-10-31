// The texts of the catalog's facts about aliases (src/messages.ts: `alias-*`), apart, to keep src/messages.ts short.

/** `alias-not-expanded-in-script`: `off`, turned off by the script; `unread`, after code the model does not read. */
export const aliasNotExpandedText = ({ name, value, off, unread }: { name: string; value: string; off?: boolean; unread?: boolean }): readonly [string, string] => {
  const unless = unread ? ['（この前に実行される、`source` で読み込むファイルや `eval` のようにここでは読まないコードが `expand_aliases` を有効にしていなければ）', ', unless code that runs before it and is not read here, such as a file read with `source` or an `eval`, turns `expand_aliases` on'] : ['', ''];
  return off ? [
    `\`shopt -u expand_aliases\` でエイリアスの展開が無効になっているので、\`${name}\` は対話シェルでも「command not found」になります${unless[0]}。\`shopt -s expand_aliases\` で有効に戻すか、関数 \`${name}() { ${value} "$@"; }\` にします`,
    `alias expansion is turned off (\`shopt -u expand_aliases\`), so \`${name}\` is "command not found", also in an interactive shell${unless[1]}. Turn it on again with \`shopt -s expand_aliases\`, or make it a function: \`${name}() { ${value} "$@"; }\``] : [
    `bash はスクリプトの中ではエイリアスを展開しないので、\`${name}\` は「command not found」になります${unless[0]}。\`shopt -s expand_aliases\` を \`alias\` より前に書くか、関数 \`${name}() { ${value} "$@"; }\` にします（\`.bashrc\` など対話シェルで読むファイルなら問題ありません）`,
    `bash does not expand aliases in scripts, so \`${name}\` is "command not found"${unless[1]}. Put \`shopt -s expand_aliases\` before the \`alias\`, or make it a function: \`${name}() { ${value} "$@"; }\` (fine in files read by interactive shells, such as \`.bashrc\`)`];
};

/** `alias-maybe-not-expanded`: a file with no shebang, which bash may run as a script or an interactive shell may read. */
export const aliasMaybeText = ({ name, value }: { name: string; value: string }): readonly [string, string] => [
  `このファイルにはシバンがありません。\`.bashrc\` のように対話シェルが読むなら \`${name}\` は展開されますが、スクリプトとして実行すると（\`bash ファイル\`）bash はエイリアスを展開しないので「command not found」になります。スクリプトなら \`shopt -s expand_aliases\` を \`alias\` より前に書くか、関数 \`${name}() { ${value} "$@"; }\` にします`,
  `this file has no shebang. Read by an interactive shell, as \`.bashrc\` is, \`${name}\` is expanded; but run as a script (\`bash file\`), bash does not expand aliases, so it is "command not found". Put \`shopt -s expand_aliases\` before the \`alias\` in a script, or make it a function: \`${name}() { ${value} "$@"; }\``];

/** `alias-defined-same-unit` and `alias-defined-later`: the alias is not in effect where the name is read. */
export const aliasDefinedText = (why: 'same-unit' | 'later') => ({ name, line }: { name: string; line: number }): readonly [string, string] => (why === 'same-unit' ? [
  `\`${name}\` は行 ${line} で \`alias\` として定義されますが、bash は行（複合コマンドや関数の本体も）をまとめて読んでから実行するので、同じ行で定義したエイリアスはまだ使えません。ここでは alias ではないので、\`${name}\` というコマンドがなければ「command not found」になります（\`eval\` に渡した文字列は実行時に読み直されるので、エイリアスが使えます）`,
  `\`${name}\` is defined as an alias on line ${line}, but bash reads a whole line (and a whole compound command or function body) before running it, so an alias defined on the same line is not in effect yet. It is not an alias here: without a command named \`${name}\`, this is "command not found" (a string given to \`eval\` is read again when it runs, so it can use the alias)`] : [
  `\`${name}\` は行 ${line} で \`alias\` として定義されますが、これはその前に読まれ、エイリアスは実行された後に読まれるものにだけ効きます。ここでは alias ではないので、\`${name}\` というコマンドがなければ「command not found」になります（\`eval\` に渡した文字列は実行時に読み直されるので、エイリアスが使えます）`,
  `\`${name}\` is defined as an alias on line ${line}, but this is read before that, and an alias works only on what is read after it ran. It is not an alias here: without a command named \`${name}\`, this is "command not found" (a string given to \`eval\` is read again when it runs, so it can use the alias)`]);
