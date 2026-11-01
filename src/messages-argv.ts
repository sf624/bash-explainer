// The texts of what a program receives (src/argvline.ts; docs/design/panel-redesign.md, P4): the placeholders for
// values known only when the line runs, and what the parts bash takes out of a simple command do. Part of the message
// catalog (src/messages.ts): each text in ja and en, Japanese after docs/japanese-style.md.
import { fdName, specialVariables, wellKnownVariables } from './dict/syntax';
import type { Lang, Text } from './i18n';
import { codeSpan, shorten } from './label';
import { type HoleSource, writtenPlain } from './semantics/fieldshape';

/** What a placeholder stands for: a part of a word (`HoleSource`), the names a pattern matches, or a whole word not known here. */
export type ArgvHoleKind = HoleSource['kind'] | 'names' | 'word';

/** How long a piece of code is shown in a placeholder; a longer one is cut. */
const CODE_SHOWN = 30;
const code = (c: string): string => codeSpan(shorten(c, CODE_SHOWN));

/**
 * What a parameter is, short, where its value is known only when the line runs: the noun of a special parameter
 * (manual 3.4.2) or of a variable bash sets or the environment usually has (`VariableText.noun`, src/dict/syntax.ts).
 * Another variable is "value of `$x`".
 */
const nounOf = (name: string): Text | undefined => (specialVariables[name] ?? wellKnownVariables[name])?.noun;

/** The tilde prefixes whose value is that of a variable (manual 3.5.2): `~`, `~+`, `~-`. */
const TILDES: Readonly<Record<string, string>> = { '': 'HOME', '+': 'PWD', '-': 'OLDPWD' };

/** A placeholder's text, in `lang`, for what it stands for (`kind`) and its code. */
export function placeholderSaid(lang: Lang, h: HoleSource | { kind: 'names' | 'word'; code: string }): string {
  const ja = lang === 'ja';
  const c = code(h.code);
  switch (h.kind) {
    case 'parameter': {
      const plain = writtenPlain(h);
      // (The arguments or the elements, each a word of its own, or joined into one: `x="$@"`, as `"$*"`.)
      const args = /^[@*]$/.test(h.name);
      if (h.elements === 'each' && args) return ja ? '各引数' : 'each argument';
      if (h.elements === 'each' && /^[A-Za-z_]\w*$/.test(h.name)) return ja ? `${code(h.name)} の各要素` : `each element of ${code(h.name)}`;
      if ((h.elements === 'joined' || plain) && args) return ja ? '引数をつなげた文字列' : 'the arguments joined';
      if (h.elements === 'joined' && /^[A-Za-z_]\w*$/.test(h.name)) return ja ? `${code(h.name)} の要素をつなげた文字列` : `the elements of ${code(h.name)} joined`;
      if (plain && /^[1-9]\d*$/.test(h.name)) return ja ? `${h.name}番目の引数` : `argument ${h.name}`;
      const known = plain ? nounOf(h.name) : undefined;
      if (known) return known[lang];
      return plain ? (ja ? `${c} の値` : `value of ${c}`) : ja ? `${c} の結果` : `what ${c} gives`;
    }
    case 'command': return ja ? `${c} の出力` : `output of ${c}`;
    case 'arithmetic': return ja ? `${c} の計算結果` : `result of ${c}`;
    case 'process': return ja ? `${c} のファイル名` : `file name of ${c}`;
    case 'translation': return ja ? `${c} の翻訳` : `translation of ${c}`;
    case 'tilde': {
      const variable = TILDES[h.user];
      if (variable) return nounOf(variable)![lang];
      return /^[+-]?\d/.test(h.user) ? (ja ? `${c} の結果` : `what ${c} gives`) : ja ? `${code(h.user)} のホームディレクトリ` : `home directory of ${code(h.user)}`;
    }
    case 'names': return ja ? `${c} に一致する各ファイル名` : `each file name matching ${c}`;
    case 'word': return ja ? `${c} から得られる単語` : `the words of ${c}`;
    case 'string': return ja ? `${c} の結果` : `what ${c} gives`;
  }
}

/** The English placeholders above that name a thing without an article (`output of …`, as a placeholder in `‹ ›` reads). */
const BARE = /^(?:value|output|result|file name|translation|home directory) of /;

/** A placeholder's text where it stands alone in a sentence: with its article in English (`the output of …`). */
export const placeholderAlone = (lang: Lang, label: string): string => (lang === 'en' && BARE.test(label) ? `the ${label}` : label);

/** What a prefix assignment does (`AssignmentMeaning.scope`): for the command only, or it stays after it (`maybe`: in POSIX mode only). */
export type AssignmentSaid = 'command' | 'stays' | 'maybe-stays';

/** The text of a prefix assignment of `name`, in `lang`: what bash does with it, and the value when it is known. */
export function assignmentSaid(lang: Lang, how: AssignmentSaid, name: string, value: string | undefined): string {
  const ja = lang === 'ja';
  const v = value === undefined ? '' : value === '' ? (ja ? 'に空文字列を' : ' to the empty string') : ja ? `に ${codeSpan(value)} を` : ` to ${codeSpan(value)}`;
  const n = codeSpan(name);
  if (how === 'command') return ja ? `このコマンドの環境でだけ、${n} ${v || 'を'}設定する` : `Set ${n}${v} in this command's environment only`;
  if (how === 'stays') return ja ? `${n} ${v || 'を'}設定する。コマンドの後も残り、エクスポートされる` : `Set ${n}${v}; it stays after the command, exported`;
  return ja ? `${n} ${v || 'を'}設定する。POSIX モードならコマンドの後も残る` : `Set ${n}${v}; in POSIX mode it stays after the command`;
}

/** The text of a here-document or a here-string (`<<`, `<<<`) on the descriptor `fd`, in `lang`. */
export function hereSaid(lang: Lang, kind: 'heredoc' | 'herestring', fd: string): string {
  const stream = fdName(fd, '0')[lang];
  if (kind === 'heredoc') return lang === 'ja' ? `${stream}をヒアドキュメントから読む` : `Read ${stream} from the here-document`;
  return lang === 'ja' ? `${stream}をヒアストリングから読む` : `Read ${stream} from the here-string`;
}
