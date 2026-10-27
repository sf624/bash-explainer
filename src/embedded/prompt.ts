// The prompt strings of bash (manual 6.9): the values of PS0, PS1, PS2 and PS4, and of `${x@P}`. Each time bash
// prints one, it decodes the backslash escapes of the table below, then expands the result as in double quotes
// (parameter expansion, command substitution, arithmetic; `shopt -u promptvars` turns that off). bash 5.2's
// `decode_prompt_string` reads them; test/reading-manual.test.ts checks each with `${x@P}` in bash 5.2 and 5.3.
import type { Lang } from '../i18n';
import { codeSuffix } from '../ctlchars';
import { ansiSequence, explainDate } from './format';
import { type EmbeddedToken, pick, shift } from './types';

/** The escapes of a prompt string, by the character after the backslash (6.9), and what each becomes. */
export const PROMPT_ESCAPES: Readonly<Record<string, readonly [ja: string, en: string]>> = {
  a: ['ベル文字', 'a bell character'],
  d: ['日付（「曜日 月 日」の形。例: `Tue May 26`）', 'the date, as "Weekday Month Date" (`Tue May 26`)'],
  e: ['ESC（エスケープ文字。色付けなどの制御に使う）', 'ESC, the escape character (used for colours)'],
  h: ['ホスト名の最初の `.` より前', 'the hostname, up to its first `.`'],
  H: ['ホスト名', 'the hostname'],
  j: ['シェルが管理しているジョブの数', 'the number of jobs the shell manages'],
  l: ['シェルの端末のデバイス名のベース名', 'the basename of the shell\'s terminal device'],
  n: ['改行', 'a newline'],
  r: ['復帰文字(CR)', 'a carriage return'],
  s: ['シェルの名前（`$0` のベース名）', 'the name of the shell (the basename of `$0`)'],
  t: ['24時間制の時刻（時:分:秒）', 'the time, 24-hour HH:MM:SS'],
  T: ['12時間制の時刻（時:分:秒）', 'the time, 12-hour HH:MM:SS'],
  '@': ['12時間制の時刻（午前・午後付き。例: `04:22 PM`）', 'the time, 12-hour with am/pm (`04:22 PM`)'],
  A: ['24時間制の時刻（時:分）', 'the time, 24-hour HH:MM'],
  u: ['今のユーザー名', 'the username of the current user'],
  v: ['bash の版（例: `5.2`）', 'the version of bash (`5.2`)'],
  V: ['bash のリリース（版とパッチレベル。例: `5.2.21`）', 'the release of bash, version and patch level (`5.2.21`)'],
  w: ['カレントディレクトリ（`$PWD`。ホームディレクトリは `~` に縮め、`PROMPT_DIRTRIM` があれば末尾のその数のディレクトリだけ残す）', 'the current directory (`$PWD`, with the home directory shortened to `~`, and only that many trailing directories when `PROMPT_DIRTRIM` is set)'],
  W: ['カレントディレクトリのベース名（ホームディレクトリなら `~`）', 'the basename of the current directory (`~` for the home directory)'],
  '!': ['このコマンドの履歴番号', 'the history number of this command'],
  '#': ['このコマンドのコマンド番号（このシェルで実行した何番目のコマンドか）', 'the command number of this command (its place among the commands this shell has run)'],
  $: ['実効ユーザー ID が 0（root）なら `#`、それ以外なら `$`', '`#` if the effective user ID is 0 (root), `$` otherwise'],
  '\\': ['バックスラッシュ', 'a backslash'],
  '[': ['表示されない文字の並びの始まり（端末の制御シーケンスを囲み、行の長さに数えないようにする）', 'the start of a sequence of non-printing characters (it encloses a terminal control sequence, so that it does not count in the length of the line)'],
  ']': ['表示されない文字の並びの終わり', 'the end of a sequence of non-printing characters'],
};

/**
 * Explain a prompt string: its escapes (`\u`, `\w`, `\D{%H}`, `\033`…), and the expansions bash does each time it
 * prints it (`${LINENO}`, `$(git branch)`). Text between them is printed as it is, and has no token.
 */
export function explainPrompt(src: string, lang: Lang): EmbeddedToken[] {
  const s = pick(lang);
  const out: EmbeddedToken[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      const t = escapeAt(src, i, lang);
      out.push(t);
      i = t.end;
    } else if ((c === '$' && i + 1 < src.length) || c === '`') {
      const e = expansionAt(src, i, s);
      if (e) out.push(e);
      i = e ? e.end : i + 1;
    } else i++;
  }
  return out;
}

type S = (ja: string, en: string) => string;

/** The escape at `src[i]`, a backslash with a character after it. */
function escapeAt(src: string, i: number, lang: Lang): EmbeddedToken {
  const s = pick(lang);
  const c = src[i + 1];
  const tok = (end: number, explanation: string, children: EmbeddedToken[] = [], kind: EmbeddedToken['kind'] = 'operator'): EmbeddedToken => ({ start: i, end, kind, explanation, children });
  // `\D{format}`: the format of strftime(3) (an empty one is the locale's time), up to the `}`, or the end.
  if (c === 'D' && src[i + 2] === '{') {
    const close = src.indexOf('}', i + 3);
    const end = close < 0 ? src.length : close + 1;
    const format = src.slice(i + 3, close < 0 ? src.length : close);
    return tok(end, format
      ? s(`\`\\D{…}\`: 書式 \`${format}\` で表した今の日時（strftime(3) の書式）`, `\`\\D{…}\`: the time now, in the format \`${format}\` (a strftime(3) format)`)
      : s('`\\D{}`: ロケールに応じた今の時刻', '`\\D{}`: the time now, as the locale writes it'), shift(explainDate(format, lang), i + 3));
  }
  // `\nnn`: three octal digits (fewer only at the end); otherwise the backslash stays, and so do the digits.
  const octal = /^[0-7]{1,3}/.exec(src.slice(i + 1));
  if (octal) {
    const end = i + 1 + octal[0].length;
    if (octal[0].length < 3 && end < src.length) {
      return tok(end, s(`\`\\${octal[0]}\`: 8進数の3桁ではないので、バックスラッシュも含めてそのまま表示される`, `\`\\${octal[0]}\`: not three octal digits, so it is printed as it is, backslash and all`), [], 'string');
    }
    const code = parseInt(octal[0], 8) & 0xff;
    const t = tok(end, s(`\`\\${octal[0]}\`: 8進数 ${octal[0]} の文字${codeSuffix(code, s)}`, `\`\\${octal[0]}\`: the character with octal code ${octal[0]}${codeSuffix(code, s)}`));
    // (`\033[1m`: a whole ANSI escape sequence.)
    return (code === 0x1b && ansiSequence(src, i, end, [t], s)) || t;
  }
  const known = Object.hasOwn(PROMPT_ESCAPES, c) ? PROMPT_ESCAPES[c] : undefined;
  if (!known) {
    return tok(i + 2, s(`\`\\${c}\`: プロンプトのエスケープではないので、バックスラッシュも含めてそのまま表示される`, `\`\\${c}\`: not an escape of a prompt, so it is printed as it is, backslash and all`), [], 'string');
  }
  const t = tok(i + 2, `\`\\${c}\`: ${s(known[0], known[1])}`);
  return (c === 'e' && ansiSequence(src, i, t.end, [t], s)) || t;
}

/**
 * The expansion at `src[i]` (`$x`, `${…}`, `$(…)`, `$((…))`, a backquote), which bash does each time it prints the
 * prompt; undefined for a `$` that starts none.
 */
function expansionAt(src: string, i: number, s: S): EmbeddedToken | undefined {
  const rest = src.slice(i);
  let end: number | undefined;
  let what: [string, string];
  let kind: EmbeddedToken['kind'] = 'expansion';
  if (rest[0] === '`') {
    const close = src.indexOf('`', i + 1);
    if (close < 0) return undefined;
    end = close + 1;
    what = ['コマンド置換', 'command substitution'];
    kind = 'substitution';
  } else if (rest.startsWith('$((')) {
    end = closing(src, i + 3, '(', ')', 2);
    what = ['算術式展開', 'arithmetic expansion'];
  } else if (rest.startsWith('$(')) {
    end = closing(src, i + 2, '(', ')', 1);
    what = ['コマンド置換', 'command substitution'];
    kind = 'substitution';
  } else if (rest.startsWith('${')) {
    end = closing(src, i + 2, '{', '}', 1);
    what = ['パラメータ展開', 'parameter expansion'];
    kind = 'variable';
  } else {
    const m = /^\$(?:[A-Za-z_]\w*|[0-9#?$!@*-])/.exec(rest);
    if (!m) return undefined;
    end = i + m[0].length;
    what = ['パラメータ展開', 'parameter expansion'];
    kind = 'variable';
  }
  if (end === undefined) return undefined;
  const text = src.slice(i, end);
  return {
    start: i, end, kind, children: [],
    explanation: s(`\`${text}\`: ${what[0]}。代入したときではなく、プロンプトを表示するたびに展開される`, `\`${text}\`: ${what[1]}, done each time bash prints the prompt (not when the value is assigned)`),
  };
}

/** The end of the text after an opening (`depth` of `open` already open at `from`), past its closing ones. */
function closing(src: string, from: number, open: string, close: string, depth: number): number | undefined {
  for (let k = from, d = depth; k < src.length; k++) {
    if (src[k] === open) d++;
    else if (src[k] === close && --d === 0) return k + 1;
  }
  return undefined;
}

/** What bash does with a prompt string as a whole (6.9), the note of the language. */
export function promptNote(lang: Lang): string {
  return pick(lang)(
    'プロンプト文字列: bash は表示するたびにバックスラッシュのエスケープを置き換え、その結果をダブルクォートの中のように展開する（パラメータ展開・コマンド置換・算術式展開。クォートは残る。`shopt -u promptvars` なら展開しない）。展開を表示のときにさせるため、値はシングルクォートで書く',
    'A prompt string: each time bash prints it, it replaces the backslash escapes, then expands the result as in double quotes (parameter expansion, command substitution, arithmetic expansion; quotes stay; no expansion with `shopt -u promptvars`). So the value is written in single quotes, for the expansions to happen when it is printed');
}
