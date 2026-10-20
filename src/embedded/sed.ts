import { sedEscapeAt } from '../ctlchars';
import { ordinal, type Lang } from '../i18n';
import { explainRegex } from './regex';
import { EmbeddedToken, pick, shift } from './types';

type S = (ja: string, en: string) => string;

/** One-letter commands without arguments. */
const SIMPLE: Record<string, [string, string]> = {
  d: ['行を削除する（出力せず、次の行の処理に進む）', 'delete the line (print nothing and start the next cycle)'],
  D: ['パターンスペースの最初の行を削除する', 'delete the first line of the pattern space'],
  p: ['行を出力する（`-n` と組み合わせて、選んだ行だけを出力するのに使う）', 'print the line (with `-n`, prints only the selected lines)'],
  P: ['パターンスペースの最初の行を出力する', 'print the first line of the pattern space'],
  n: ['現在の行を出力して、次の行を読み込む', 'print the line and read the next one'],
  N: ['次の行を読み込んで、改行でつないで追加する', 'append the next line, joined with a newline'],
  '=': ['行番号を出力する', 'print the line number'],
  l: ['行を制御文字が見える形で出力する', 'print the line with control characters made visible'],
  h: ['パターンスペースをホールドスペースにコピーする', 'copy the pattern space to the hold space'],
  H: ['パターンスペースをホールドスペースの末尾に追加する', 'append the pattern space to the hold space'],
  g: ['ホールドスペースをパターンスペースにコピーする', 'copy the hold space to the pattern space'],
  G: ['ホールドスペースをパターンスペースの末尾に追加する', 'append the hold space to the pattern space'],
  x: ['パターンスペースとホールドスペースを入れ替える', 'exchange the pattern and hold spaces'],
  z: ['パターンスペースを空にする', 'empty the pattern space'],
  F: ['入力ファイル名を出力する', 'print the input file name'],
};

class SedParser {
  private i = 0;
  private s: S;

  constructor(private src: string, private flavor: 'bre' | 'ere', private lang: Lang) {
    this.s = pick(lang);
  }

  parse(): EmbeddedToken[] {
    const out: EmbeddedToken[] = [];
    const { src } = this;
    while (this.i < src.length) {
      const c = src[this.i];
      if (/[\s;]/.test(c)) { this.i++; continue; }
      if (c === '#') {
        const end = this.lineEnd();
        out.push(this.tok(this.i, end, 'comment', this.s('コメント', 'Comment')));
        this.i = end;
        continue;
      }
      if (c === '}') {
        out.push(this.tok(this.i, this.i + 1, 'keyword', this.s('`}`: コマンドのまとまりの終わり', '`}`: end of the command group')));
        this.i++;
        continue;
      }
      out.push(this.command());
    }
    return out;
  }

  private tok(start: number, end: number, kind: EmbeddedToken['kind'], explanation: string, children: EmbeddedToken[] = []): EmbeddedToken {
    return { start, end, kind, explanation, children };
  }

  private lineEnd(): number {
    const nl = this.src.indexOf('\n', this.i);
    return nl < 0 ? this.src.length : nl;
  }

  private skipSpaces(): void {
    while (this.src[this.i] === ' ' || this.src[this.i] === '\t') this.i++;
  }

  /** Read up to an unescaped delimiter; returns [start, end] of the text (the delimiter is consumed). */
  private delimited(delim: string): [number, number] | undefined {
    const start = this.i;
    while (this.i < this.src.length) {
      const c = this.src[this.i];
      if (c === '\\') { this.i += 2; continue; }
      if (c === delim) {
        this.i++;
        return [start, this.i - 1];
      }
      if (c === '\n' && delim !== '\n') break;
      this.i++;
    }
    return undefined;
  }

  private regex(start: number, end: number): EmbeddedToken[] {
    return shift(explainRegex(this.src.slice(start, end), this.flavor, this.lang, { sedEscapes: true }), start);
  }

  // ---------------------------------------------------------------- addresses

  private address(): { token: EmbeddedToken; text: string } | undefined {
    const { src, s } = this;
    const start = this.i;
    let m: RegExpExecArray | null;
    if ((m = /^(\d+)~(\d+)/.exec(src.slice(start)))) {
      this.i += m[0].length;
      return { token: this.tok(start, this.i, 'pattern', s(`\`${m[0]}\`: ${m[1]} 行目から ${m[2]} 行おきの行`, `\`${m[0]}\`: every ${ordinal(Number(m[2]))} line starting at line ${m[1]}`)), text: s(`${m[1]} 行目から ${m[2]} 行おき`, `every ${ordinal(Number(m[2]))} line from ${m[1]}`) };
    }
    if ((m = /^\d+/.exec(src.slice(start)))) {
      this.i += m[0].length;
      if (/^0+$/.test(m[0])) {
        return { token: this.tok(start, this.i, 'pattern', s('`0`: 1行目より前。`0,/正規表現/` の形でだけ使え、1行目がその正規表現に一致すれば範囲は1行目で終わる（`1,/正規表現/` なら2行目以降で探す）', '`0`: before the first line. Only valid as `0,/regex/`: the range may already end on line 1 if it matches (with `1,/regex/` the end is looked for from line 2)')), text: s('先頭', 'the start') };
      }
      return { token: this.tok(start, this.i, 'pattern', s(`\`${m[0]}\`: ${m[0]} 行目`, `\`${m[0]}\`: line ${m[0]}`)), text: s(`${m[0]} 行目`, `line ${m[0]}`) };
    }
    if (src[start] === '$') {
      this.i++;
      return { token: this.tok(start, this.i, 'pattern', s('`$`: 最終行', '`$`: the last line')), text: s('最終行', 'the last line') };
    }
    if (src[start] === '/' || (src[start] === '\\' && src[start + 1])) {
      const delim = src[start] === '/' ? '/' : src[start + 1];
      this.i += src[start] === '/' ? 1 : 2;
      const body = this.delimited(delim);
      if (!body) {
        this.i = src.length;
        return { token: this.tok(start, this.i, 'error', s('正規表現アドレスが閉じられていない', 'Unterminated regex address')), text: '' };
      }
      let flags = '';
      while (/[IM]/.test(src[this.i] ?? '')) flags += src[this.i++];
      const re = src.slice(body[0], body[1]);
      const ci = flags.includes('I') ? s('（大文字・小文字を区別しない）', ' (case-insensitive)') : '';
      return {
        token: this.tok(start, this.i, 'pattern', s(`正規表現 \`${re}\` に一致する行${ci}`, `Lines matching the regex \`${re}\`${ci}`), this.regex(body[0], body[1])),
        text: s(`\`${re}\` に一致する行`, `lines matching \`${re}\``),
      };
    }
    return undefined;
  }

  /** `addr1,addr2` where addr2 may also be `+N` or `~N`. */
  private addressRange(): { tokens: EmbeddedToken[]; text: string } | undefined {
    const { s, src } = this;
    const a1 = this.address();
    if (!a1) return undefined;
    if (src[this.i] !== ',') return { tokens: [a1.token], text: a1.text };
    const comma = this.i++;
    let m: RegExpExecArray | null;
    let a2: { token: EmbeddedToken; text: string } | undefined;
    const start = this.i;
    if ((m = /^\+(\d+)/.exec(src.slice(start)))) {
      this.i += m[0].length;
      a2 = { token: this.tok(start, this.i, 'pattern', s(`\`${m[0]}\`: そこから ${m[1]} 行後まで`, `\`${m[0]}\`: through ${m[1]} more lines`)), text: s(`その ${m[1]} 行後`, `${m[1]} lines later`) };
    } else if ((m = /^~(\d+)/.exec(src.slice(start)))) {
      this.i += m[0].length;
      a2 = { token: this.tok(start, this.i, 'pattern', s(`\`${m[0]}\`: 次の ${m[1]} の倍数の行まで`, `\`${m[0]}\`: up to the next line that is a multiple of ${m[1]}`)), text: s(`次の ${m[1]} の倍数の行`, `the next multiple of ${m[1]}`) };
    } else {
      a2 = this.address();
    }
    if (!a2) return { tokens: [a1.token], text: a1.text };
    const commaTok = this.tok(comma, comma + 1, 'operator', s('`,`: 範囲。左のアドレスの行から右のアドレスの行まで', '`,`: range from the first address through the second'));
    const from = a1.text;
    return { tokens: [a1.token, commaTok, a2.token], text: s(`${from}から ${a2.text}まで`, `${from} through ${a2.text}`) };
  }

  // ---------------------------------------------------------------- commands

  private command(): EmbeddedToken {
    const { src, s } = this;
    const start = this.i;
    const children: EmbeddedToken[] = [];
    const range = this.addressRange();
    let target = s('すべての行', 'every line');
    if (range) {
      children.push(...range.tokens);
      target = range.text;
    }
    this.skipSpaces();
    if (src[this.i] === '!') {
      children.push(this.tok(this.i, this.i + 1, 'operator', s('`!`: アドレスに一致しない行を対象にする（否定）', '`!`: apply to lines that do NOT match the address')));
      this.i++;
      target = s(`${target}以外`, `all but ${target}`);
      this.skipSpaces();
    }
    const ci = this.i;
    const c = src[ci];
    if (c === undefined) {
      return this.tok(start, this.i, 'error', s('アドレスの後にコマンドがない', 'Address without a command'), children);
    }
    this.i++;
    const cmdTok = (expl: string) => this.tok(ci, ci + 1, 'command', expl);
    const done = (summary: string, extra: EmbeddedToken[] = []) => {
      const forWhom = range ? s(`${target}に対して: `, `For ${target}: `) : '';
      return this.tok(start, this.i, 'command', forWhom + summary, [...children, ...extra]);
    };

    if (c === 's') return this.substitute(start, children, range ? target : undefined);
    if (c === 'y') return this.transliterate(start, children);
    if (c === '{') {
      return done(s('`{`: 以降 `}` までのコマンドをまとめて実行する', '`{`: run the commands up to `}` as a group'), [cmdTok(s('コマンドのまとまりの開始', 'start of a command group'))]);
    }
    if (SIMPLE[c]) {
      const [ja, en] = SIMPLE[c];
      return done(s(ja, en), [cmdTok(`\`${c}\`: ${s(ja, en)}`)]);
    }
    if (c === 'q' || c === 'Q') {
      this.skipSpaces();
      const m = /^\d+/.exec(src.slice(this.i));
      const codeStart = this.i;
      if (m) this.i += m[0].length;
      const expl = c === 'q' ? s('現在の行を出力して終了する', 'print the current line and quit') : s('何も出力せずに終了する', 'quit without printing');
      const extra = [cmdTok(`\`${c}\`: ${expl}`)];
      if (m) extra.push(this.tok(codeStart, this.i, 'number', s(`終了ステータス ${m[0]}`, `exit status ${m[0]}`)));
      return done(expl, extra);
    }
    if (c === 'a' || c === 'i' || c === 'c') {
      // GNU one-liner `a text`, or POSIX `a\` followed by the text on the next line.
      if (src[this.i] === '\\') this.i++;
      if (src[this.i] === '\n') this.i++;
      this.skipSpaces();
      const textStart = this.i;
      this.i = this.lineEnd();
      const text = src.slice(textStart, this.i);
      const expl = c === 'a' ? s(`行の後に「${text}」という行を追加する`, `append the line "${text}" after it`)
        : c === 'i' ? s(`行の前に「${text}」という行を挿入する`, `insert the line "${text}" before it`)
          : s(`行を「${text}」に置き換える`, `replace the line with "${text}"`);
      return done(expl, [cmdTok(`\`${c}\`: ${c === 'a' ? s('後ろに追加', 'append') : c === 'i' ? s('前に挿入', 'insert') : s('置き換え', 'change')}`),
        this.tok(textStart, this.i, 'string', s('追加するテキスト', 'the text'))]);
    }
    if (c === ':' || c === 'b' || c === 't' || c === 'T') {
      this.skipSpaces();
      const labelStart = this.i;
      while (this.i < src.length && !/[;\n}]/.test(src[this.i])) this.i++;
      const label = src.slice(labelStart, this.i).trim();
      const expl = c === ':' ? s(`ラベル「${label}」を定義する（\`b\` や \`t\` の飛び先）`, `define the label "${label}" (a target for \`b\`/\`t\`)`)
        : c === 'b' ? (label ? s(`ラベル「${label}」へ移動する`, `branch to "${label}"`) : s('スクリプトの最後へ移動する（次の行へ）', 'branch to the end of the script'))
          : c === 't' ? s(`直前の \`s\` で置換が起きていれば${label ? `「${label}」` : 'スクリプトの最後'}へ移動する`, `if an \`s\` succeeded, branch to ${label ? `"${label}"` : 'the end'}`)
            : s(`直前の \`s\` で置換が起きていなければ${label ? `「${label}」` : 'スクリプトの最後'}へ移動する`, `if no \`s\` succeeded, branch to ${label ? `"${label}"` : 'the end'}`);
      return done(expl, [cmdTok(`\`${c}\`: ${expl}`)]);
    }
    if (c === 'r' || c === 'R' || c === 'w' || c === 'W' || c === 'e') {
      this.skipSpaces();
      const argStart = this.i;
      this.i = this.lineEnd();
      const arg = src.slice(argStart, this.i);
      const expl = c === 'r' ? s(`ファイル「${arg}」の内容を行の後に出力する`, `output the contents of "${arg}" after the line`)
        : c === 'R' ? s(`ファイル「${arg}」から1行読んで行の後に出力する`, `output one line of "${arg}" after the line`)
          : c === 'w' ? s(`行をファイル「${arg}」に書き込む`, `write the line to "${arg}"`)
            : c === 'W' ? s(`最初の行をファイル「${arg}」に書き込む`, `write the first line to "${arg}"`)
              : s(arg ? `コマンド「${arg}」を実行し、その出力を行の前に出す` : 'パターンスペースをコマンドとして実行する', arg ? `run "${arg}" and output its result first` : 'run the pattern space as a command');
      return done(expl, [cmdTok(`\`${c}\`: ${expl}`)]);
    }
    return this.tok(ci, ci + 1, 'error', s(`不明な sed コマンド \`${c}\``, `Unknown sed command \`${c}\``), children);
  }

  private substitute(start: number, children: EmbeddedToken[], target: string | undefined): EmbeddedToken {
    const { src, s } = this;
    const sAt = this.i - 1;
    const delim = src[this.i];
    const parts: EmbeddedToken[] = [this.tok(sAt, sAt + 1, 'command', s('`s`: 置換コマンド（`s/パターン/置換後/フラグ`）', '`s`: substitute (`s/pattern/replacement/flags`)'))];
    if (!delim || delim === '\n') return this.tok(start, this.i, 'error', s('`s` の後に区切り文字がない', '`s` without a delimiter'), [...children, ...parts]);
    this.i++;
    const pat = this.delimited(delim);
    if (!pat) {
      this.i = this.lineEnd();
      return this.tok(start, this.i, 'error', s('`s` コマンドが閉じられていない', 'Unterminated `s` command'), [...children, ...parts]);
    }
    const sep = (at: number) => this.tok(at, at + 1, 'operator', s(`\`${delim}\`: 区切り文字`, `\`${delim}\`: delimiter`));
    parts.push(sep(sAt + 1));
    const patText = src.slice(pat[0], pat[1]);
    parts.push(this.tok(pat[0], pat[1], 'pattern', patText
      ? s(`検索パターン（正規表現）\`${patText}\``, `Pattern (regex) \`${patText}\``)
      : s('空のパターン: 直前に使った正規表現を再利用する', 'Empty pattern: reuse the last regex'), this.regex(pat[0], pat[1])));
    parts.push(sep(pat[1]));
    const rep = this.delimited(delim);
    if (!rep) {
      this.i = this.lineEnd();
      return this.tok(start, this.i, 'error', s('`s` コマンドが閉じられていない（置換後の文字列の後の区切りがない）', 'Unterminated `s` command'), [...children, ...parts]);
    }
    const repText = src.slice(rep[0], rep[1]);
    if (repText) {
      parts.push(this.tok(rep[0], rep[1], 'string', s(`置換後の文字列 \`${repText}\``, `Replacement \`${repText}\``), this.replacement(rep[0], rep[1], delim)));
      parts.push(sep(rep[1]));
    } else {
      parts.push(this.tok(rep[1], rep[1] + 1, 'operator', s(`\`${delim}\`: 区切り文字。置換後の文字列が空なので、一致した部分は削除される`, `\`${delim}\`: delimiter; the replacement is empty, so matches are deleted`)));
    }

    let global = false;
    let nth: string | undefined;
    while (this.i < src.length && /[gpiIeMm0-9w]/.test(src[this.i])) {
      const f = src[this.i];
      const fs = this.i;
      if (f === 'w') {
        this.i++;
        this.skipSpaces();
        const fileStart = this.i;
        this.i = this.lineEnd();
        parts.push(this.tok(fs, this.i, 'option', s(`\`w\`: 置換が起きた行をファイル「${src.slice(fileStart, this.i)}」に書き込む`, `\`w\`: write changed lines to "${src.slice(fileStart, this.i)}"`)));
        break;
      }
      if (/\d/.test(f)) {
        const m = /^\d+/.exec(src.slice(this.i))![0];
        this.i += m.length;
        nth = m;
        parts.push(this.tok(fs, this.i, 'option', s(`\`${m}\`: ${m} 番目の一致だけを置換する`, `\`${m}\`: replace only the ${ordinal(Number(m))} match`)));
        continue;
      }
      this.i++;
      if (f === 'g') global = true;
      const expl: Record<string, [string, string]> = {
        g: ['`g`: 行の中の一致をすべて置換する（付けないと各行の最初の1つだけ）', '`g`: replace every match on the line (without it, only the first)'],
        p: ['`p`: 置換が起きた行を出力する（`-n` と組み合わせて変更行だけを表示）', '`p`: print the line if a substitution happened (use with `-n`)'],
        i: ['`i`: 大文字・小文字を区別しない', '`i`: case-insensitive'],
        I: ['`I`: 大文字・小文字を区別しない', '`I`: case-insensitive'],
        m: ['`m`: 複数行モード（`^` `$` が各行の先頭・末尾に一致）', '`m`: multi-line mode (`^`/`$` match at each line)'],
        M: ['`M`: 複数行モード（`^` `$` が各行の先頭・末尾に一致）', '`M`: multi-line mode (`^`/`$` match at each line)'],
        e: ['`e`: 置換結果をコマンドとして実行し、その出力に置き換える', '`e`: run the result as a command and use its output'],
      };
      parts.push(this.tok(fs, this.i, 'option', s(expl[f][0], expl[f][1])));
    }
    const which = global && nth ? s(`${nth}番目以降のすべての一致`, `every match from the ${ordinal(Number(nth))} on`) : global ? s('すべて', 'every match') : nth ? s(`${nth}番目の一致`, `the ${ordinal(Number(nth))} match`) : s('最初の1つ', 'the first match');
    const shown = repText ? `\`${repText}\`` : s('空文字', 'nothing');
    const shownPat = patText ? `\`${patText}\`` : s('直前に使った正規表現', 'the last regex');
    const summary = s(
      `置換: ${shownPat} に一致した部分（各行の${which}）を ${shown} に置き換える`,
      `Substitute: replace ${which} of ${shownPat} on each line with ${shown}`,
    );
    const forWhom = target ? s(`${target}に対して: `, `For ${target}: `) : '';
    return this.tok(start, this.i, 'command', forWhom + summary, [...children, ...parts]);
  }

  /** `&`, `\1`… and case conversions in the replacement of `s`. */
  private replacement(start: number, end: number, delim: string): EmbeddedToken[] {
    const { src, s } = this;
    const out: EmbeddedToken[] = [];
    let lit = -1;
    const flush = (at: number) => {
      if (lit >= 0 && at > lit) out.push(this.tok(lit, at, 'string', s(`文字列「${src.slice(lit, at)}」`, `Literal "${src.slice(lit, at)}"`)));
      lit = -1;
    };
    for (let i = start; i < end; i++) {
      const c = src[i];
      if (c === '&') {
        flush(i);
        out.push(this.tok(i, i + 1, 'variable', s('`&`: 一致した部分全体', '`&`: the whole match')));
      } else if (c === '\\' && i + 1 < end) {
        const n = src[i + 1];
        const special: Record<string, [string, string]> = {
          '&': ['文字「&」そのもの', 'a literal "&"'],
          L: ['以降を小文字にする', 'lowercase what follows'], U: ['以降を大文字にする', 'uppercase what follows'],
          l: ['次の1文字を小文字にする', 'lowercase the next character'], u: ['次の1文字を大文字にする', 'uppercase the next character'],
          E: ['`\\L` / `\\U` を終える', 'end `\\L` / `\\U`'],
        };
        if (n === delim || n === '\\') {
          flush(i);
          out.push(this.tok(i, i + 2, 'string', n === delim
            ? s(`\`\\${n}\`: 文字「${n}」そのもの（区切り文字をエスケープしている）`, `\`\\${n}\`: a literal "${n}" (the delimiter, escaped)`)
            : s('`\\\\`: 文字「\\」そのもの', '`\\\\`: a literal backslash')));
          i++;
        } else if (/[0-9]/.test(n)) {
          flush(i);
          out.push({ ...this.tok(i, i + 2, 'variable', n === '0' ? s('`\\0`: 一致した部分全体', '`\\0`: the whole match') : s(`\`\\${n}\`: グループ ${n} に一致した部分`, `\`\\${n}\`: what group ${n} matched`)), ...(n !== '0' ? { group: Number(n) } : {}) });
          i++;
        } else if (sedEscapeAt(src, i)) {
          const se = sedEscapeAt(src, i)!;
          flush(i);
          out.push(this.tok(i, i + se.length, 'string', `\`${src.slice(i, i + se.length)}\`: ${se.text(s)}`));
          i += se.length - 1;
        } else if (special[n]) {
          flush(i);
          out.push(this.tok(i, i + 2, /[LUluE]/.test(n) ? 'operator' : 'string', `\`\\${n}\`: ${s(special[n][0], special[n][1])}`));
          i++;
        } else {
          if (lit < 0) lit = i;
          i++;
        }
      } else if (lit < 0) {
        lit = i;
      }
    }
    flush(end);
    // A plain replacement needs no breakdown.
    if (out.length === 1 && out[0].start === start && out[0].end === end && out[0].kind === 'string' && !src.slice(start, end).includes('\\')) return [];
    return out;
  }

  private transliterate(start: number, children: EmbeddedToken[]): EmbeddedToken {
    const { src, s } = this;
    const delim = src[this.i++];
    const from = this.delimited(delim);
    const to = from && this.delimited(delim);
    if (!from || !to) {
      this.i = this.lineEnd();
      return this.tok(start, this.i, 'error', s('`y` コマンドが閉じられていない', 'Unterminated `y` command'), children);
    }
    const a = src.slice(from[0], from[1]);
    const b = src.slice(to[0], to[1]);
    return this.tok(start, this.i, 'command', s(
      `文字の変換: \`${a}\` の各文字を \`${b}\` の同じ位置の文字に置き換える`,
      `Transliterate: each character of \`${a}\` becomes the one at the same position in \`${b}\``,
    ), [...children,
      this.tok(start, start + 1, 'command', s('`y`: 1文字ずつ変換する', '`y`: transliterate characters')),
      this.tok(from[0], from[1], 'pattern', s('変換元の文字', 'characters to replace')),
      this.tok(to[0], to[1], 'string', s('変換先の文字', 'replacement characters'))]);
  }
}

/** Explain a sed script (one or more commands). */
export function explainSed(src: string, flavor: 'bre' | 'ere', lang: Lang): EmbeddedToken[] {
  return new SedParser(src, flavor, lang).parse();
}
