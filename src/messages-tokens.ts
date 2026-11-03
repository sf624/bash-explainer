import type { Lang, Text } from './i18n';
import type { NoteLevel } from './levels';
import { CARRIED, CLOSE_TEXT, OPEN_TEXT, type TokenEntry, tokenError } from './messages-levels';
import { ARGV_TEXTS } from './messages-tokens-argv';
import { COMMAND_TEXTS } from './messages-tokens-commands';
import { COMPOUND_TEXTS } from './messages-tokens-compound';
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

export const TOKEN_TEXTS = {
  ...ARGV_TEXTS,
  ...COMMAND_TEXTS,
  ...COMPOUND_TEXTS,
  ...SHEBANG_TEXTS,
  ...WORD_TEXTS,
  /** `env -S'"a' s`: the program refuses the string it would split (`why`: what is wrong with it). */
  'splice-refused': tokenError<{ program: string; why: string }>(({ program, why }) => [
    `${program} はこの文字列を受け付けず、何も実行せずに終了ステータス 125 で終わる（${why}）`,
    `${program} refuses this string and exits with status 125, running nothing (${why})`]),
  /** `$((09))`, `$((2#2))`: a constant bash rejects. */
  'arith-invalid-number': tokenError<{ text: string; why: string }>(({ text, why }) => [
    `不正な数 \`${text}\`: ${why}。bash は算術エラーで止まる`,
    `Invalid number \`${text}\`: ${why}. bash stops with an arithmetic error`]),
  /** Before the subcommand terraform takes only `-chdir=DIR`, and the version and help options. */
  'terraform-option-before-subcommand': tokenError(() => [
    'サブコマンドより前のオプション。terraform がここで受け付けるのは `-chdir=…`、`-version`、`-help` だけで、ほかは「Invalid flags before the subcommand」で止まる。サブコマンドの後に書く',
    'an option before the subcommand: terraform takes only `-chdir=…`, `-version` and `-help` there, and stops with "Invalid flags before the subcommand" on any other; write it after the subcommand']),
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
