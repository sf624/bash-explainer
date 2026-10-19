import type { Lang } from '../i18n';
import { explainDate } from './format';
import { controlSuffix } from '../ctlchars';
import { EmbeddedToken, pick, shift } from './types';

const NAMED: Record<string, [string, string]> = {
  oneline: ['1コミット1行（ハッシュと件名）', 'one line per commit (hash and subject)'],
  short: ['ハッシュ・作者・件名', 'hash, author and subject'],
  medium: ['ハッシュ・作者・日時・メッセージ（既定）', 'hash, author, date and message (default)'],
  full: ['ハッシュ・作者・コミッター・メッセージ', 'hash, author, committer and message'],
  fuller: ['full に加えて両方の日時', 'full plus both dates'],
  reference: ['「ハッシュ (件名, 日付)」の形', '"hash (subject, date)"'],
  email: ['メール（パッチ）形式', 'e-mail (patch) format'],
  raw: ['内部の生の形式', 'the raw internal format'],
};

const PLACEHOLDERS: Record<string, [string, string]> = {
  H: ['コミットハッシュ（完全）', 'commit hash'], h: ['コミットハッシュ（短縮）', 'abbreviated commit hash'],
  T: ['ツリーハッシュ', 'tree hash'], t: ['ツリーハッシュ（短縮）', 'abbreviated tree hash'],
  P: ['親コミットのハッシュ', 'parent hashes'], p: ['親コミットのハッシュ（短縮）', 'abbreviated parent hashes'],
  an: ['作者の名前', 'author name'], ae: ['作者のメールアドレス', 'author email'], al: ['作者のメールのローカル部', 'author email local part'],
  ad: ['作者の日時（--date の形式）', 'author date (as --date says)'], ar: ['作者の日時（「3 days ago」のような相対表記）', 'author date, relative ("3 days ago")'],
  at: ['作者の日時（UNIX 時刻）', 'author date, UNIX time'], ai: ['作者の日時（ISO 8601 風）', 'author date, ISO 8601-like'],
  aI: ['作者の日時（厳密な ISO 8601）', 'author date, strict ISO 8601'], as: ['作者の日付（YYYY-MM-DD）', 'author date (YYYY-MM-DD)'],
  cn: ['コミッターの名前', 'committer name'], ce: ['コミッターのメールアドレス', 'committer email'],
  cd: ['コミット日時（--date の形式）', 'committer date (as --date says)'], cr: ['コミット日時（相対表記）', 'committer date, relative'],
  ct: ['コミット日時（UNIX 時刻）', 'committer date, UNIX time'], ci: ['コミット日時（ISO 8601 風）', 'committer date, ISO 8601-like'],
  cI: ['コミット日時（厳密な ISO 8601）', 'committer date, strict ISO 8601'], cs: ['コミット日付（YYYY-MM-DD）', 'committer date (YYYY-MM-DD)'],
  s: ['件名（メッセージの1行目）', 'subject (first line of the message)'], f: ['件名をファイル名に使える形にしたもの', 'subject sanitised for a file name'],
  b: ['本文（件名を除いたメッセージ）', 'body'], B: ['メッセージ全体（加工なし）', 'raw message (subject and body)'],
  d: ['ブランチ・タグ名（「 (HEAD -> main, tag: v1)」の形）', 'ref names, like " (HEAD -> main, tag: v1)"'],
  D: ['ブランチ・タグ名（括弧なし）', 'ref names without the wrapping'], N: ['ノート', 'notes'], e: ['エンコーディング', 'encoding'],
  GG: ['署名の検証結果', 'signature verification output'], G: ['署名の状態（G/B/U/N など）', 'signature status (G/B/U/N…)'], GS: ['署名者の名前', 'signer name'],
  n: ['改行', 'a newline'], '%': ['文字「%」そのもの', 'a literal "%"'],
};

const COLORS = ['red', 'green', 'blue', 'yellow', 'reset', 'normal', 'black', 'magenta', 'cyan', 'white', 'bold'];

/** Explain a `--pretty`/`--format` value: a named format, or `format:`/`tformat:` with placeholders. */
export function explainGitFormat(src: string, lang: Lang): { tokens: EmbeddedToken[]; note?: string } | undefined {
  const s = pick(lang);
  if (NAMED[src]) return { tokens: [], note: s(NAMED[src][0], NAMED[src][1]) };
  const tokens: EmbeddedToken[] = [];
  let i = 0;
  const prefix = /^(t?format):/.exec(src);
  if (prefix) {
    tokens.push({
      start: 0, end: prefix[0].length, kind: 'keyword', children: [],
      explanation: prefix[1] === 'format'
        ? s('`format:`: 以降の書式で各コミットを表示する（コミットの間に区切りの改行）', '`format:`: show each commit with the following template (newline between commits)')
        : s('`tformat:`: 以降の書式で各コミットを表示する（各コミットの後に改行）', '`tformat:`: show each commit with the template (newline after each)'),
    });
    i = prefix[0].length;
  } else if (!src.includes('%')) {
    return undefined;
  }
  let text = i;
  const pushText = (end: number) => {
    if (end > text) tokens.push({ start: text, end, kind: 'string', explanation: s(`そのまま表示する文字列「${src.slice(text, end)}」`, `Literal text "${src.slice(text, end)}"`), children: [] });
  };
  while (i < src.length) {
    if (src[i] !== '%') { i++; continue; }
    const rest = src.slice(i + 1);
    let m: RegExpExecArray | null;
    let len = 0;
    let expl = '';
    let kind: EmbeddedToken['kind'] = 'variable';
    if ((m = /^C\((auto|[a-z ]+)\)/.exec(rest)) || (m = new RegExp(`^C(${COLORS.join('|')})`).exec(rest))) {
      len = m[0].length;
      kind = 'operator';
      expl = m[1] === 'reset' ? s('色を元に戻す', 'reset the colour') : m[1] === 'auto' ? s('以降を git の既定の色にする（端末のときだけ）', 'use git\'s default colours from here (only on a terminal)') : s(`以降の文字を ${m[1]} で色付けする`, `colour what follows ${m[1]}`);
    } else if ((m = /^([<>]{1,2}|><)\((\d+)(?:,(trunc|ltrunc|mtrunc))?\)/.exec(rest))) {
      len = m[0].length;
      kind = 'operator';
      const align = m[1] === '<' ? s('左寄せ', 'left-aligned') : m[1] === '>' || m[1] === '>>' ? s('右寄せ', 'right-aligned') : s('中央寄せ', 'centred');
      expl = s(`次の項目を幅 ${m[2]} で${align}${m[3] ? '（長ければ切り詰める）' : ''}`, `the next item ${align} in ${m[2]} columns${m[3] ? ' (truncated if longer)' : ''}`);
    } else if ((m = /^x([0-9a-fA-F]{2})/.exec(rest))) {
      len = m[0].length;
      kind = 'operator';
      expl = s(`16進数 ${m[1]} の文字${controlSuffix(parseInt(m[1], 16), s)}`, `the byte 0x${m[1]}${controlSuffix(parseInt(m[1], 16), s)}`);
    } else if ((m = /^(GG|GS|an|ae|al|ad|ar|at|ai|aI|as|cn|ce|cd|cr|ct|ci|cI|cs|[HhTtPpsfbBdDNeGn%])/.exec(rest))) {
      len = m[0].length;
      expl = s(PLACEHOLDERS[m[1]][0], PLACEHOLDERS[m[1]][1]);
    }
    if (!len) { i++; continue; }
    pushText(i);
    tokens.push({ start: i, end: i + 1 + len, kind, explanation: `\`%${rest.slice(0, len)}\`: ${expl}`, children: [] });
    i += 1 + len;
    text = i;
  }
  pushText(src.length);
  return { tokens };
}

const DATE_STYLES: Record<string, [string, string]> = {
  relative: ['「3 days ago」のような相対表記', 'relative ("3 days ago")'], local: ['ローカル時刻', 'local time'],
  iso: ['ISO 8601 風（2026-10-16 09:30:00 +0900）', 'ISO 8601-like (2026-10-16 09:30:00 +0900)'], 'iso-strict': ['厳密な ISO 8601', 'strict ISO 8601'],
  rfc: ['RFC 2822 形式（メールの日付）', 'RFC 2822 (e-mail style)'], short: ['日付だけ（2026-10-16）', 'date only (2026-10-16)'],
  raw: ['UNIX 時刻とタイムゾーン', 'UNIX time and zone'], unix: ['UNIX 時刻', 'UNIX time'], human: ['人間に読みやすい形', 'human-friendly'], default: ['既定の形式', 'the default format'],
};

/** Explain a `--date` value: a named style or `format:` with strftime conversions. */
export function explainGitDate(src: string, lang: Lang): { tokens: EmbeddedToken[]; note?: string } | undefined {
  const s = pick(lang);
  const base = src.replace(/-local$/, '');
  if (DATE_STYLES[base]) return { tokens: [], note: s(DATE_STYLES[base][0], DATE_STYLES[base][1]) + (base !== src ? s('（ローカル時刻で）', ' (in local time)') : '') };
  const m = /^format(-local)?:/.exec(src);
  if (!m) return undefined;
  return {
    tokens: [{ start: 0, end: m[0].length, kind: 'keyword', children: [], explanation: s('`format:`: 以降の strftime 書式で日時を表示する', '`format:`: show dates with the following strftime format') },
      ...shift(explainDate(src.slice(m[0].length), lang), m[0].length)],
  };
}
