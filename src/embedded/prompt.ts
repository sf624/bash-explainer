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
  // (Whether the backslash of the escape at `i` is quoted by the `\\` before it, when bash expands the prompt.)
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      const t = backslashAt(src, i, lang, quoted);
      quoted = !quoted && src.startsWith('\\\\\\', i);
      out.push(t);
      i = t.end;
    } else if ((c === '$' && i + 1 < src.length) || c === '`') {
      const e = expansionAt(src, i, s);
      if (e) out.push(e);
      i = e ? e.end : i + 1;
    } else if (c === '!') {
      // (In POSIX mode, `!` in PS1 and PS2 is the history number, and `!!` a `!` (6.11).)
      const end = src[i + 1] === '!' ? i + 2 : i + 1;
      out.push({ start: i, end, kind: 'operator', children: [], explanation: end > i + 1
        ? s('`!!`: POSIX モードの PS1 と PS2 では `!` 1つになる（それ以外ではそのまま表示される）', '`!!`: in PS1 and PS2 in POSIX mode, a single `!` (elsewhere it is printed as it is)')
        : s('`!`: POSIX モードの PS1 と PS2 では、このコマンドの履歴番号（`\\!` と同じ。それ以外ではそのまま表示される）', '`!`: in PS1 and PS2 in POSIX mode, the history number of this command (as `\\!`; elsewhere it is printed as it is)') });
      i = end;
    } else i++;
  }
  return out;
}

/** Characters a backslash quotes when bash expands the decoded prompt, as in double quotes (besides `\\` itself). */
const DQ_SPECIAL = /[$`"\n]/;

/**
 * The escape at `src[i]` and what the expansion after decoding does with its backslash (`quoted`: the `\\` before it
 * quotes it, so it is printed). Decoding keeps the backslash of an escape it does not know (`\\"`) and makes `\\\\` one
 * backslash; the expansion then removes a backslash before `$`, a backquote, `"`, `\\` or a newline, and prints that
 * character as it is (`\\\\$HOME` prints `$HOME`, `\\"` prints `"`).
 */
function backslashAt(src: string, i: number, lang: Lang, quoted: boolean): EmbeddedToken {
  const s = pick(lang);
  const c = src[i + 1];
  const next = src[i + 2];
  if (!quoted && c === '\\' && DQ_SPECIAL.test(next)) {
    // `\\$`: the backslash decoding gives quotes the character after it.
    const shown = next === '\n' ? '' : next;
    return { start: i, end: i + 3, kind: 'string', children: [], explanation: next === '\n'
      ? s('`\\\\` と改行: 展開のときに、バックスラッシュと改行が取り除かれる（行の継続）', '`\\\\` and a newline: the expansion removes both (a line continuation)')
      : s(`\`\\\\${shown}\`: 置き換えで \`\\\\\` はバックスラッシュ1つになり、それが続く \`${shown}\` をクォートするので、展開のときにバックスラッシュは取り除かれ、\`${shown}\` はそのまま表示される`,
        `\`\\\\${shown}\`: decoding makes \`\\\\\` one backslash, which quotes the \`${shown}\` after it: the expansion removes the backslash, and \`${shown}\` is printed as it is`) };
  }
  if (!quoted && c === '\\' && next === '\\') {
    return { start: i, end: i + 2, kind: 'operator', children: [], explanation: s('`\\\\`: バックスラッシュ。ただし、続くバックスラッシュを展開のときにクォートするので、取り除かれる（2つで1つ表示される）', '`\\\\`: a backslash, which quotes the backslash after it when bash expands the prompt: it is removed, and one backslash is printed for both') };
  }
  if (!quoted && DQ_SPECIAL.test(c) && c !== '$') {
    return { start: i, end: i + 2, kind: 'string', children: [], explanation: c === '\n'
      ? s('バックスラッシュと改行: 展開のときに両方取り除かれる（行の継続）', 'A backslash and a newline: the expansion removes both (a line continuation)')
      : s(`\`\\${c}\`: プロンプトのエスケープではないので置き換えでは残るが、展開のときにバックスラッシュが取り除かれ、\`${c}\` が表示される`, `\`\\${c}\`: not an escape of a prompt, so decoding keeps it; then the expansion removes the backslash, and \`${c}\` is printed`) };
  }
  return escapeAt(src, i, lang);
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
    'プロンプト文字列: bash は表示するたびにバックスラッシュのエスケープを置き換え、その結果をダブルクォートの中のように展開する（パラメータ展開・コマンド置換・算術式展開。`$`・`` ` ``・`"`・`\\`・改行の前のバックスラッシュは取り除かれ、クォートの文字は残る）。`shopt -u promptvars` なら展開しないが、POSIX モードの PS1 と PS2 は展開する。展開を表示のときにさせるには、代入ではその展開をクォートする（シングルクォートで書くなど）',
    'A prompt string: each time bash prints it, it replaces the backslash escapes, then expands the result as in double quotes (parameter expansion, command substitution, arithmetic expansion; a backslash before `$`, a backquote, `"`, `\\` or a newline is removed, and quote characters stay). `shopt -u promptvars` turns the expansion off, but in POSIX mode PS1 and PS2 are expanded all the same. For an expansion to happen when the prompt is printed, the assignment must quote it (single quotes, for instance)');
}
