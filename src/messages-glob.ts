// The texts of the catalog's facts about extended globs and globstar (src/messages.ts: `extglob-*`, `globstar-*`),
// apart, to keep src/messages.ts short.

/** Why an extended glob may be a syntax error where it is read: an `extglob-*` id without its prefix. */
export type ExtglobWhy = 'in-same-block' | 'maybe-on' | 'turned-off' | 'not-found' | 'maybe-on-trap' | 'not-in-new-shell';

const EXTGLOB: Record<ExtglobWhy, (use: string) => readonly [string, string]> = {
  'in-same-block': (use) => [
    `bash は関数や \`if\`・\`{ }\` などのまとまりを最後まで読んでから実行します。そのため、同じまとまりの中の \`shopt -s extglob\` は \`${use}\` を読む時点ではまだ効いておらず、構文エラーになります。\`shopt -s extglob\` は、まとまりの外のそれより前の行に書きます`,
    `bash reads a whole function or block (\`if\`, \`{ }\`…) before running it, so a \`shopt -s extglob\` inside the same block is not yet on when it reads \`${use}\`: a syntax error. Put \`shopt -s extglob\` on an earlier line, outside the block`],
  'maybe-on': (use) => [
    `\`${use}\` のような拡張グロブは、\`shopt -s extglob\` のあとでないと構文エラーになります（\`[[ ]]\` の中では不要）。この前で有効にしているのは一部の経路（分岐やループ）だけなので、ほかの経路では構文エラーになります`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` comes first (not needed inside \`[[ ]]\`), and only some paths before here (a branch or a loop) turn it on`],
  'turned-off': (use) => [
    `\`${use}\` のような拡張グロブは \`shopt -s extglob\` のあとでないと構文エラーになりますが、\`shopt -u extglob\` で無効にされています`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` is on, and \`shopt -u extglob\` turned it off`],
  'not-found': (use) => [
    `\`${use}\` のような拡張グロブは、\`shopt -s extglob\` のあとでないと構文エラーになります（\`[[ ]]\` の中では不要）。この行より前に見当たりません。\`source\` したファイルなどで有効にしているなら問題ありません`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` comes first (not needed inside \`[[ ]]\`). It is not found before this line; fine if it is turned on elsewhere, as in a file read with \`source\``],
  'maybe-on-trap': (use) => [
    `\`${use}\` のような拡張グロブは、\`shopt -s extglob\` のあとでないと構文エラーになります（\`[[ ]]\` の中では不要）。トラップの文字列はシグナルが来たときに読まれるので、\`extglob\` が有効になる前に来れば構文エラーになります`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` comes first (not needed inside \`[[ ]]\`), and a trap's action is read when its signal comes: if that is before \`extglob\` is on, it is a syntax error`],
  'not-in-new-shell': (use) => [
    `\`${use}\` のような拡張グロブは、\`shopt -s extglob\` のあとでないと構文エラーになります（\`[[ ]]\` の中では不要）。新しいシェルは \`extglob\` が無効の状態で始まり、このスクリプトの \`shopt\` は引き継がれません。文字列の中で、グロブより前の行で \`shopt -s extglob\` するか、\`bash -O extglob -c\` で起動します`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` comes first (not needed inside \`[[ ]]\`). The new shell starts with \`extglob\` off: this script's \`shopt\` does not reach it. Turn it on in the string, on a line before the glob, or start the shell with \`bash -O extglob -c\``],
};

/** The text of `extglob-<why>`, [ja, en], for the glob `use`. */
export const extglobText = (why: ExtglobWhy) => ({ use }: { use: string }): readonly [string, string] => EXTGLOB[why](use);

/** Where `**` may not reach into subdirectories: a `globstar-*` id without its prefix (but `unsupported`). */
export type GlobstarWhy = 'maybe-on' | 'not-found';

const GLOBSTAR: Record<GlobstarWhy, (on: string) => readonly [string, string]> = {
  'maybe-on': (on) => [
    `\`**\` がサブディレクトリまでたどるのは \`${on}\` のあとだけです。この前で有効にしているのは一部の経路（分岐やループ）だけなので、ほかの経路では \`*\` と同じく1階層分にしか一致しません`,
    `\`**\` reaches into subdirectories only after \`${on}\`, and only some paths before here (a branch or a loop) turn it on; on the others \`**\` is the same as \`*\` and matches one level only`],
  'not-found': (on) => [
    `\`**\` がサブディレクトリまでたどるのは \`${on}\` のあとだけです。この行より前に見当たらないので、このままでは \`*\` と同じく1階層分にしか一致しません。\`source\` したファイルなどで有効にしているなら問題ありません`,
    `\`**\` reaches into subdirectories only after \`${on}\`. It is not found before this line, so as it stands \`**\` is the same as \`*\` and matches one level only. Fine if it is turned on elsewhere, as in a file read with \`source\``],
};

/** The text of `globstar-<why>`, [ja, en], for the command that turns it on, `on`. */
export const globstarText = (why: GlobstarWhy) => ({ on }: { on: string }): readonly [string, string] => GLOBSTAR[why](on);
