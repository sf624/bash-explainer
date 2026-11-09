import type { Lang, Text } from './i18n';
import type { NoteLevel } from './levels';
import { CARRIED, CLOSE_TEXT, OPEN_TEXT, type TokenEntry, tokenError, type TokenProblem, tokenProblemWarning, tokenText, tokenWarning } from './messages-levels';
import { ARGV_TEXTS } from './messages-tokens-argv';
import { COMMAND_TEXTS } from './messages-tokens-commands';
import { COMPOUND_TEXTS } from './messages-tokens-compound';
import { REGEX_TEXTS } from './messages-tokens-regex';
import { SHEBANG_TEXTS } from './messages-tokens-shebang';
import { WORD_TEXTS } from './messages-tokens-words';

// The catalog of what tokens say (docs/design/sources.md, SB3c): each text of a token that is a fact of the explanation, with a stable
// id, its text in ja and en and, for one that warns, its level. The notes of a line have their own catalog (src/messages.ts). The
// dictionary's specs and the embedded languages' grammars hold their own texts, as data of the command or the language.
//
// A text is said with `cx.text(id, params)` in src/explain/, or with `tokenSaid` where there is no context (src/arith.ts). What it gives
// is the text with its id around it, in two invisible characters (`carried`), so the id goes wherever the text goes: into a longer text,
// through a helper, a variable or another token. `markSaid` (src/tokenmarks.ts) reads them when the line's tokens are made, gives each token
// the ids and the levels of what it holds (`Token.texts`, `Token.marks`), and takes them out: nothing outside the explanation of a line sees
// them. A row draws the level's mark from the level table (src/ui/tokenRow.ts): no text writes a mark.
//
// So while a line is being explained, a text may hold them: code in src/explain/ that looks at the first or last character of a text it did
// not write reads `plainOf` of it (src/messages-levels.ts).

/** A constant the shell rejects (`09`), and why. What follows the command depends on too much to say: fork or not, builtin or not, the shell. */
export interface InvalidNumber { text: string; why: string }

const INVALID_NUMBER: TokenProblem = {
  head: ['この数は不正なので、算術エラーになり、このコマンドは本来の処理をしない。', 'This number is not valid: an arithmetic error, and this command does not do its work.'],
  then: ['シェルは算術エラーを出し、このコマンドは本来の処理をしない', 'The shell reports an arithmetic error, and this command does not do its work'],
};
// (A warning: zsh reads `09` as a decimal number and may source the file, or a stop may come first. So it is bash's and sh's, if they get there.)
const INVALID_NUMBER_IF_BASH: TokenProblem = {
  head: ['この数は bash と sh では不正なので、この行まで来ると算術エラーになり、このコマンドは本来の処理をしない。', 'Not valid in bash or sh: if the shell reaches this line, an arithmetic error, and this command does not do its work.'],
  then: ['シェルはこの行まで来ると算術エラーを出し、このコマンドは本来の処理をしない', 'If the shell reaches this line, it reports an arithmetic error, and this command does not do its work'],
};
const spliceRefusedRow = ({ program, why }: { program: string; why: string }): readonly [string, string] => [`${program} はこの文字列を受け付けない（${why}）`, `${program} refuses this string (${why})`];
const invalidNumberRow = ({ text, why }: InvalidNumber): readonly [string, string] => [`不正な数 \`${text}\`: ${why}`, `Invalid number \`${text}\`: ${why}`];

export const TOKEN_TEXTS = {
  ...ARGV_TEXTS,
  ...COMMAND_TEXTS,
  ...COMPOUND_TEXTS,
  ...REGEX_TEXTS,
  ...SHEBANG_TEXTS,
  ...WORD_TEXTS,
  /** `env -S'"a' s`: the program refuses the string it would split (`why`: what is wrong with it). */
  'splice-refused': tokenError<{ program: string; why: string }>({
    head: ['この文字列は拒否され、何も実行されない。', 'This string is refused, and nothing runs.'],
    then: ['何も実行せずに終了ステータス 125 で終わる', 'It exits with status 125, running nothing'],
  }, spliceRefusedRow),
  // (The same after a stop that keeps the shell from it (`reachedAt`): only what it would do, on its row.)
  'splice-refused-if-reached': tokenText<{ program: string; why: string }>(spliceRefusedRow),
  /** `$((09))`, `$((2#2))`: a constant the shell rejects, in a command that reads it whenever it runs. */
  'arith-invalid-number': tokenError<InvalidNumber>(INVALID_NUMBER, invalidNumberRow),
  // (The same, where only a name says the file is one of bash, or a stop may come first, docs/design/three-levels.md.)
  'arith-invalid-number-if-bash': tokenProblemWarning<InvalidNumber>(INVALID_NUMBER_IF_BASH, invalidNumberRow),
  /**
   * `${x:-$((09))}`, `[[ a || $((09)) ]]`: the same, where the command may run without reading it (`readOnlySometimes`, src/explain/reads.ts).
   * It may have done part of its work by then (the update of a C-style `for` comes after the body).
   */
  'arith-invalid-number-if-read': tokenWarning<InvalidNumber>(({ text, why }) => [
    `不正な数 \`${text}\`: ${why}。シェルがここを読むと算術エラーを出し、このコマンドはそこで止まる`,
    `Invalid number \`${text}\`: ${why}. If the shell reads it, it reports an arithmetic error and this command stops there`]),
  /**
   * bazel's client reads only startup options before the command, and stops at any other (`bazel --keep_going build`); its command
   * reads only the command's options, and refuses a startup option (`bazel build --output_base=x`). `what`: what the option does.
   * Warnings, as terraform's: the spec's text says it, and a stop before the line may keep bazel from it.
   */
  'bazel-command-option-before-command': tokenWarning<{ what: Text }>(({ what }) => [
    `${what.ja}。ただし、コマンドのオプションなので、コマンドより前に書くと bazel は「Unknown startup option」で止まる（終了ステータス 2）。コマンドの後に書く`,
    `${what.en}; but as an option of the command, before the command bazel stops with "Unknown startup option" (status 2). Write it after the command`]),
  'bazel-startup-option-after-command': tokenWarning<{ what: Text }>(({ what }) => [
    `${what.ja}。ただし、起動オプションなので、コマンドの後に書くと bazel は「Unrecognized option」で止まる（終了ステータス 2）。\`bazel\` とコマンドの間に書く`,
    `${what.en}; but as a startup option, after the command bazel stops with "Unrecognized option" (status 2). Write it between \`bazel\` and the command`]),
  /** `bazel build //... -//app/legacy/...`: a subtractive pattern before `--` is read as an option, which bazel refuses. */
  'bazel-negative-pattern-before-dashdash': tokenWarning(() => [
    '`-` で始まる、除くターゲットのパターン。`--` より前では bazel はオプションとして読み、「Invalid options syntax」で止まる（終了ステータス 2）。`--` の後に書く（`bazel build -- //... -//app/legacy/...`）',
    'A subtractive target pattern: before `--`, bazel reads it as an option and stops with "Invalid options syntax" (status 2). Write it after `--` (`bazel build -- //... -//app/legacy/...`)']),
  /**
   * `bazel build //app/...`: a wildcard (`...`, `:all`, `:*`) of a command that builds (build, test, coverage, run, fetch, vendor)
   * or of aquery leaves out the targets tagged `manual`; a pattern that names one takes it (`//app:debug`). query and cquery take
   * them (`TARGET_FLAVORS`, src/embedded/bazel.ts).
   */
  'bazel-manual-wildcard': tokenText(() => [
    '`tags = ["manual"]` のターゲットは含まない（名前で指定したときだけ対象になる）',
    'without the targets tagged `manual` (`tags = ["manual"]`), which only a pattern that names them takes']),
  /**
   * `bazel query '//a:b+c'`: a `+` between two words with no blank is still the union (src/embedded/bazelquery.ts), so a name
   * with `+` in it is two words (bazel 9.3.2; a word that starts with `@@` may hold `+`).
   */
  'bazel-query-plus-joined': tokenWarning(() => [
    '`+`（和）: 空白がなくても演算子として読まれ、`a+b` は `a` と `b` のターゲットを合わせたものになる。名前に `+` を含むターゲットは、式の中で引用符で囲む（`bazel query \'"//pkg:a+b"\'`）',
    '`+` (union), even with no blank around it: `a+b` is the targets of `a` and those of `b`. Quote a target whose name holds `+` inside the expression (`bazel query \'"//pkg:a+b"\'`)']),
  /** `--config=ci`: the options it stands for are in the rc files, which the explanation does not read. */
  'bazel-config': tokenText(() => [
    'rc ファイル（`.bazelrc` など）の設定の組を使う。`--config=ci` は、rc ファイルの `build:ci` のような行のオプションに置き換わる。rc ファイルは読まないので、どのオプションになるかは示せない。どの rc ファイルにもなければ、bazel は「Config value \'…\' is not defined in any .rc file」で止まる',
    'Use a group of settings of the rc files (`.bazelrc` and others): `--config=ci` stands for the options of lines like `build:ci` in them. The rc files are not read, so those options are not shown. If no rc file defines it, bazel stops with "Config value \'…\' is not defined in any .rc file"']),
  /**
   * Before the subcommand terraform takes only `-chdir=DIR`, the version and help options, and `-install-autocomplete` and
   * `-uninstall-autocomplete`. A warning, not an error: terraform is not here to run, and another option with one of those may pass.
   */
  'terraform-option-before-subcommand': tokenWarning(() => [
    'サブコマンドより前のオプション。terraform がここで受け付けるのは `-chdir=…`、`-version`、`-help`、`-install-autocomplete`、`-uninstall-autocomplete` だけで、ほかは多くの場合「Invalid flags before the subcommand」で止まる。サブコマンドの後に書く',
    'an option before the subcommand: terraform takes only `-chdir=…`, `-version`, `-help`, `-install-autocomplete` and `-uninstall-autocomplete` there, and mostly stops with "Invalid flags before the subcommand" on any other; write it after the subcommand']),
};

export type TokenTextId = keyof typeof TOKEN_TEXTS;
export type TokenTextParams<K extends TokenTextId> = Parameters<(typeof TOKEN_TEXTS)[K]['text']>[0];
export type TokenTextArgs<K extends TokenTextId> = TokenTextParams<K> extends Record<string, never> ? [] : [TokenTextParams<K>];

/** Which text of the catalog a text opens: the character after the first of those around it (`CARRIED`, src/messages-levels.ts). */
const FIRST_ID = 0xE000;
const IDS = Object.keys(TOKEN_TEXTS) as TokenTextId[];
const ID_CHARS = new Map(IDS.map((id, i) => [id, String.fromCharCode(FIRST_ID + i)]));

const carried = (id: TokenTextId, text: string): string => `${OPEN_TEXT}${ID_CHARS.get(id)!}${text}${CLOSE_TEXT}`;

/** A text of the catalog that a text holds. */
export interface TokenSaid { id: TokenTextId; text: string; level?: NoteLevel }

const entryOf = (id: TokenTextId) => TOKEN_TEXTS[id] as TokenEntry<unknown>;

/**
 * What a text holds of the catalog, outermost first, and the text without the ids. (The same characters in a script's own text, which
 * Unicode says are not for interchange, are taken out too, and a pair of them that holds nothing or opens no known text says nothing.)
 */
export function readSaid(text: string): { text: string; said: TokenSaid[] } {
  const said: TokenSaid[] = [];
  const open: { at: number; said: TokenSaid }[] = [];
  let plain = '';
  let from = 0;
  for (const m of text.matchAll(CARRIED)) {
    plain += text.slice(from, m.index);
    from = m.index + m[0].length;
    const id = m[1] && IDS[m[1].charCodeAt(0) - FIRST_ID];
    if (id) {
      const { level } = entryOf(id);
      const one: TokenSaid = { id, text: '', ...(level ? { level } : {}) };
      said.push(one);
      open.push({ at: plain.length, said: one });
    } else if (!m[1]) {
      const o = open.pop();
      if (o) o.said.text = plain.slice(o.at);
    }
  }
  return { text: plain + text.slice(from), said: said.filter((s) => s.text) };
}

/** The text `id` of the catalog with `params`, in `lang`, with its id. */
export function tokenSaid<K extends TokenTextId>(lang: Lang, id: K, ...params: TokenTextArgs<K>): string {
  const [ja, en] = entryOf(id).text(params[0]);
  return carried(id, lang === 'ja' ? ja : en);
}

/** The text `id` of the catalog with `params`, in both languages, each with its id: for the data that holds its text as a `Text` (a spec). */
export function saidText<K extends TokenTextId>(id: K, ...params: TokenTextArgs<K>): Text {
  const [ja, en] = entryOf(id).text(params[0]);
  return { ja: carried(id, ja), en: carried(id, en) };
}

/** Whether a token's mark is a problem of the line, not only of its row (`tokenError`, `tokenProblemWarning`). */
export const saysProblem = ({ id }: { id: TokenTextId }): boolean => (TOKEN_TEXTS[id] as TokenEntry<never>).problem !== undefined;
