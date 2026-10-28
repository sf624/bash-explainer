// The texts of the catalog's facts about extended globs, globstar and a loop over a glob (src/messages.ts: `extglob-*`,
// `globstar-*`, `unmatched-glob-runs-once`), apart, to keep src/messages.ts short.
import type { Rewrite } from './rewrite';

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

/** A pattern of a `for` list, as the loop note names it, and its text after the expansions where it is known. */
export interface LoopPattern { name: string; text?: string }

/** How the loop of `unmatched-glob-runs-once` takes its list: a `select` menu (`menu`), and a word that may give several (`several`, `"${a[@]}"*.c`). */
export interface LoopHow { menu: boolean; several: boolean }

/**
 * `unmatched-glob-runs-once`: what the loop does when no file matches `glob`, whose patterns are `patterns` (more than
 * one where braces or splitting make them: `*.{c,h}`, `*.c` and `*.h`), each named and with the text the variable
 * gets, where it is known (not for `"$d"/*.c`); `alone`: they are the whole list, so that with one the loop runs only
 * once. `how.several`: each may give several words, of which those that are patterns are not known (`"$@"*.c`);
 * `how.menu`: a `select`, which shows each as an entry of its menu rather than running once for it. And the rewrites
 * there are (a test first in the body, `shopt -s nullglob`): either may be missing, or both (in sh, for a list with a
 * word that is no pattern).
 */
export function unmatchedGlobText(glob: string, patterns: readonly LoopPattern[], v: string, alone: boolean, rewrite: readonly Rewrite[], how: LoopHow): readonly [string, string] {
  const test = rewrite.find((r) => !r.code.startsWith('shopt'));
  const nullglob = rewrite.find((r) => r.code.startsWith('shopt'));
  const ja = test ? `本体の先頭に \`${test.code}\` を${nullglob ? `書くか、ループの前で \`${nullglob.code}\` にします` : '書きます'}` : nullglob ? `ループの前で \`${nullglob.code}\` にします` : '';
  const en = test ? `Start the body with \`${test.code}\`${nullglob ? `, or turn on \`${nullglob.code}\` before the loop` : ''}` : nullglob ? `Turn on \`${nullglob.code}\` before the loop` : '';
  const [{ text: t }] = patterns;
  const known = patterns.every((p) => p.text !== undefined);
  const code = patterns.map((p) => `\`${p.name}\``);
  const enList = `${code.slice(0, -1).join(', ')} and ${code[code.length - 1]}`;
  // (The text the variable gets: the pattern's, after its expansions, which are not known here for `"$d"/*.c`.)
  const [jaText, enText] = t !== undefined ? [` \`${t}\` という文字列`, `the text \`${t}\` itself`] : ['展開後のパターンの文字列', 'the text of the pattern itself, after its expansions'];
  // (What each pattern that no file matches gives, `who`: a pass of the loop, or an entry of the menu of `select`.)
  const after = known ? '' : ', after its expansions';
  const jaEach = `${how.menu ? 'もメニューに表示され、それを選ぶと ' : 'についても1回ずつ実行され、'}\`${v}\` には${known ? '' : '展開後の'}その文字列がそのまま入ります`;
  const enEach = (who: string): string => (how.menu ? `each ${who} is still shown in the menu, and choosing it sets \`${v}\` to its text itself${after}` : `for each ${who}, the loop still runs once, with \`${v}\` set to its text itself${after}`);
  const [jaWhat, enWhat] = how.several
    ? [`\`${glob}\` は${patterns.length > 1 ? ` ${code.join('・')} になり、それぞれ` : ''}ファイルと照合する前に複数の単語になることがあります。そのうちパターンで、一致するファイルが1つもないもの${jaEach}`,
      `\`${glob}\`${patterns.length > 1 ? ` gives ${enList}, each of which` : ''} may give several words before files are matched; ${enEach('of them that is a pattern and that no file matches')}`]
    : patterns.length > 1
      ? [`\`${glob}\` はファイルと照合する前に ${code.join('・')} になります。そのうち一致するファイルが1つもないもの${jaEach}`,
        `\`${glob}\` gives the patterns ${enList} before files are matched; ${enEach('that no file matches')}`]
      : how.menu
        ? [`\`${glob}\` に一致するファイルが1つもなくても、メニューには項目として表示され、それを選ぶと \`${v}\` に${jaText}がそのまま入ります`,
          `when no file matches \`${glob}\`, the menu still shows it as an entry, and choosing it sets \`${v}\` to ${enText}`]
        : alone
          ? [`\`${glob}\` に一致するファイルが1つもないと、\`${v}\` に${jaText}がそのまま入って1回実行されます`,
            `when no file matches \`${glob}\`, the loop runs once with \`${v}\` set to ${enText}`]
          : [`\`${glob}\` に一致するファイルが1つもなくても、その分の1回は実行され、\`${v}\` には${jaText}がそのまま入ります`,
            `when no file matches \`${glob}\`, the loop still runs once for it, with \`${v}\` set to ${enText}`];
  return [`${jaWhat}${ja ? `。${ja}` : ''}`, `${enWhat}${en ? `. ${en}` : ''}`];
}
