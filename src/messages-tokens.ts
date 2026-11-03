import type { Lang, Text } from './i18n';
import type { NoteLevel } from './levels';
import { type TokenEntry, tokenWarning } from './messages-tokens-entry';
import { ARGV_TEXTS } from './messages-tokens-argv';
import { COMMAND_TEXTS } from './messages-tokens-commands';
import { COMPOUND_TEXTS } from './messages-tokens-compound';
import { SHEBANG_TEXTS } from './messages-tokens-shebang';
import { WORD_TEXTS } from './messages-tokens-words';

// The catalog of what tokens say (docs/design/sources.md, SB3c): each text of a token that is a fact of the explanation, with a stable
// id, its text in ja and en and, for one that warns, its level. The notes of a line have their own catalog (src/messages.ts). The
// dictionary's specs and the embedded languages' grammars hold their own texts, as data of the command or the language.
//
// A text is said with `cx.text(id, params)` in src/explain/: it gives the text and records it for the line, so that each token that shows
// it knows its id and level (`Token.texts`, `Token.marks`; `markSaid`, src/tokenmarks.ts). A row draws the level's mark from the level
// table (src/ui/tokenRow.ts): no text writes a mark.

export const TOKEN_TEXTS = {
  ...ARGV_TEXTS,
  ...COMMAND_TEXTS,
  ...COMPOUND_TEXTS,
  ...SHEBANG_TEXTS,
  ...WORD_TEXTS,
  /** `env -S'"a' s`: the program refuses the string it would split (`why`: what is wrong with it). */
  'splice-refused': tokenWarning<{ program: string; why: string }>(({ program, why }) => [
    `${program} はこの文字列を受け付けず、何も実行せずに終了ステータス 125 で終わる（${why}）`,
    `${program} refuses this string and exits with status 125, running nothing (${why})`]),
  /** `$((09))`, `$((2#2))`: a constant bash rejects. */
  'arith-invalid-number': tokenWarning<{ text: string; why: string }>(({ text, why }) => [
    `不正な数 \`${text}\`: ${why}。bash は算術エラーで止まる`,
    `Invalid number \`${text}\`: ${why}. bash stops with an arithmetic error`]),
  /** Before the subcommand terraform takes only `-chdir=DIR`, and the version and help options. */
  'terraform-option-before-subcommand': tokenWarning(() => [
    'サブコマンドより前のオプション。terraform がここで受け付けるのは `-chdir=…`、`-version`、`-help` だけで、ほかは「Invalid flags before the subcommand」で止まる。サブコマンドの後に書く',
    'an option before the subcommand: terraform takes only `-chdir=…`, `-version` and `-help` there, and stops with "Invalid flags before the subcommand" on any other; write it after the subcommand']),
};

export type TokenTextId = keyof typeof TOKEN_TEXTS;
export type TokenTextParams<K extends TokenTextId> = Parameters<(typeof TOKEN_TEXTS)[K]['text']>[0];
export type TokenTextArgs<K extends TokenTextId> = TokenTextParams<K> extends Record<string, never> ? [] : [TokenTextParams<K>];

/** A text of the catalog, as said in one language. */
export interface TokenSaid { id: TokenTextId; text: string; level?: NoteLevel }

/** A text of the catalog in both languages, for the data that holds its text as a `Text` (a spec). */
export type SaidText = Text & { said: { id: TokenTextId; level?: NoteLevel } };

export const isSaid = (text: Text): text is SaidText => 'said' in text;

const entryOf = (id: TokenTextId) => TOKEN_TEXTS[id] as TokenEntry<unknown>;

/** The text `id` of the catalog with `params`, in `lang`. */
export function tokenSaid<K extends TokenTextId>(lang: Lang, id: K, ...params: TokenTextArgs<K>): TokenSaid {
  const { text, level } = entryOf(id);
  const [ja, en] = text(params[0]);
  return { id, text: lang === 'ja' ? ja : en, ...(level ? { level } : {}) };
}

/** The text `id` of the catalog with `params`, in both languages. */
export function saidText<K extends TokenTextId>(id: K, ...params: TokenTextArgs<K>): SaidText {
  const { text, level } = entryOf(id);
  const [ja, en] = text(params[0]);
  return { ja, en, said: { id, ...(level ? { level } : {}) } };
}
