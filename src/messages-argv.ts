// The texts of what a program receives (src/argvline.ts; docs/design/panel-redesign.md, P4): the placeholders for
// values known only when the line runs, and what the parts bash takes out of a simple command do. Part of the message
// catalog (src/messages.ts): each text in ja and en, Japanese after docs/japanese-style.md.
import { fdName } from './dict/syntax';
import { tx, type Lang, type Text } from './i18n';
import { codeSpan, shorten } from './label';
import type { HoleSource } from './semantics/fieldshape';

/** What a placeholder stands for: a part of a word (`HoleSource`), the names a pattern matches, or a whole word not known here. */
export type ArgvHoleKind = HoleSource['kind'] | 'names' | 'word';

/** How long a piece of code is shown in a placeholder; a longer one is cut. */
const CODE_SHOWN = 30;
const code = (c: string): string => codeSpan(shorten(c, CODE_SHOWN));

/**
 * What a parameter is, short, where its value is known only when the line runs: the special parameters (manual 3.4.2),
 * and the variables bash sets or the environment usually has whose value is a thing with a name. Another variable is
 * "value of `$x`".
 */
const PARAMETERS: Readonly<Record<string, Text>> = {
  '?': tx('直前のコマンドの終了ステータス', 'exit status of the last command'),
  $: tx('シェルのプロセスID', 'process ID of the shell'),
  '!': tx('最後のバックグラウンドジョブのプロセスID', 'process ID of the last background job'),
  '#': tx('引数の個数', 'number of arguments'),
  0: tx('シェルかスクリプトの名前', 'name of the shell or script'),
  '-': tx('今のシェルのオプションの文字', 'letters of the current shell options'),
  USER: tx('ログインユーザー名', 'current user name'),
  LOGNAME: tx('ログインユーザー名', 'current user name'),
  HOME: tx('ホームディレクトリ', 'home directory'),
  PWD: tx('カレントディレクトリ', 'current directory'),
  OLDPWD: tx('直前のカレントディレクトリ', 'previous directory'),
  HOSTNAME: tx('ホスト名', 'host name'),
  RANDOM: tx('乱数', 'a random number'),
};

/** The tilde prefixes whose value is that of a variable (manual 3.5.2): `~`, `~+`, `~-`. */
const TILDES: Readonly<Record<string, string>> = { '': 'HOME', '+': 'PWD', '-': 'OLDPWD' };

/** A placeholder's text, in `lang`, for what it stands for (`kind`) and its code. */
export function placeholderSaid(lang: Lang, h: HoleSource | { kind: 'names' | 'word'; code: string }): string {
  const ja = lang === 'ja';
  const c = code(h.code);
  switch (h.kind) {
    case 'parameter': {
      const plain = h.code === `$${h.name}` || h.code === `\${${h.name}}`;
      if (h.elements && /^[@*]$/.test(h.name)) return ja ? '各引数' : 'each argument';
      if (h.elements && /^[A-Za-z_]\w*$/.test(h.name)) return ja ? `${code(h.name)} の各要素` : `each element of ${code(h.name)}`;
      if (plain && /^[1-9]\d*$/.test(h.name)) return ja ? `${h.name} 番目の引数` : `argument ${h.name}`;
      if (plain && /^[@*]$/.test(h.name)) return ja ? '引数をつなげた文字列' : 'the arguments joined';
      const known = plain ? PARAMETERS[h.name] : undefined;
      if (known) return known[lang];
      return plain ? (ja ? `${c} の値` : `value of ${c}`) : ja ? `${c} の結果` : `what ${c} gives`;
    }
    case 'command': return ja ? `${c} の出力` : `output of ${c}`;
    case 'arithmetic': return ja ? `${c} の計算結果` : `result of ${c}`;
    case 'process': return ja ? `${c} のファイル名` : `file name of ${c}`;
    case 'translation': return ja ? `${c} の翻訳` : `translation of ${c}`;
    case 'tilde': {
      const variable = TILDES[h.user];
      if (variable) return PARAMETERS[variable][lang];
      return /^[+-]?\d/.test(h.user) ? (ja ? `${c} の結果` : `what ${c} gives`) : ja ? `${code(h.user)} のホームディレクトリ` : `home directory of ${code(h.user)}`;
    }
    case 'names': return ja ? `${c} に一致する各名前` : `each name matching ${c}`;
    case 'word': return ja ? `${c} から得られる単語` : `the words of ${c}`;
    case 'string': return ja ? `${c} の結果` : `what ${c} gives`;
  }
}

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
