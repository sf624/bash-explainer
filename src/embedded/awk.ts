import type { Lang } from '../i18n';
import { explainPrintf } from './format';
import { explainRegex } from './regex';
import { EmbeddedToken, pick, shift } from './types';

type S = (ja: string, en: string) => string;

export interface Lex {
  type: 'num' | 'str' | 'regex' | 'ident' | 'kw' | 'op' | 'nl';
  text: string;
  start: number;
  end: number;
}

const KEYWORDS = new Set(['BEGIN', 'END', 'BEGINFILE', 'ENDFILE', 'function', 'func', 'if', 'else', 'while', 'for', 'do', 'break', 'continue', 'next', 'nextfile', 'exit', 'return', 'delete', 'getline', 'print', 'printf', 'in']);
const OPS = ['&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '^=', '==', '!=', '<=', '>=', '!~', '>>', '|&', '~', '|', '?', ':', '!', '<', '>', '=', '+', '-', '*', '/', '%', '^', '$', '{', '}', '(', ')', '[', ']', ',', ';'];

const VARS: Record<string, [string, string]> = {
  NR: ['これまでに読んだ行数（現在の行番号）', 'number of records read so far (the current line number)'],
  FNR: ['現在のファイル内での行番号', 'line number within the current file'],
  NF: ['現在の行のフィールド（列）の数', 'number of fields on the current line'],
  FS: ['入力のフィールド区切り（既定は空白。`-F` で指定）', 'input field separator (whitespace by default; set with `-F`)'],
  OFS: ['出力のフィールド区切り（`print a, b` の `,` の所に入る。既定は空白）', 'output field separator (placed between `print a, b`; a space by default)'],
  RS: ['入力のレコード（行）区切り', 'input record separator'],
  ORS: ['出力のレコード区切り（既定は改行）', 'output record separator (a newline by default)'],
  FILENAME: ['現在の入力ファイル名', 'the current input file name'],
  SUBSEP: ['多次元配列のキーの区切り', 'separator for multi-dimensional array keys'],
  ENVIRON: ['環境変数の配列（`ENVIRON["HOME"]` など）', 'array of environment variables (`ENVIRON["HOME"]`)'],
  ARGV: ['コマンドライン引数の配列', 'array of command-line arguments'],
  ARGC: ['コマンドライン引数の数', 'number of command-line arguments'],
  RSTART: ['`match()` で一致した位置', 'start of the last `match()`'],
  RLENGTH: ['`match()` で一致した長さ', 'length of the last `match()`'],
  CONVFMT: ['数値を文字列にするときの書式', 'number-to-string conversion format'],
  OFMT: ['数値を出力するときの書式', 'output format for numbers'],
};

const FUNCS: Record<string, [string, string]> = {
  length: ['文字列の長さ（引数なしなら現在の行の長さ）', 'length of a string (of the line, without an argument)'],
  substr: ['部分文字列を取り出す（`substr(s, 開始, 長さ)`、位置は1始まり）', 'take a substring (`substr(s, start, len)`, 1-based)'],
  index: ['文字列が最初に現れる位置（1始まり。なければ 0）', 'position of a substring (1-based; 0 if absent)'],
  split: ['文字列を区切りで分割して配列に入れ、要素数を返す', 'split a string into an array and return the count'],
  sub: ['正規表現に最初に一致した部分を置換する（対象を省略すると `$0`）', 'replace the first regex match (in `$0` by default)'],
  gsub: ['正規表現に一致する部分をすべて置換する（対象を省略すると `$0`）', 'replace every regex match (in `$0` by default)'],
  gensub: ['正規表現で置換した結果を返す（GNU awk）', 'return the result of a regex replacement (GNU awk)'],
  match: ['正規表現に一致する位置を返し、RSTART と RLENGTH を設定する', 'find a regex match, setting RSTART and RLENGTH'],
  sprintf: ['書式を指定して文字列を作る', 'format a string'],
  tolower: ['小文字にする', 'lowercase'],
  toupper: ['大文字にする', 'uppercase'],
  system: ['シェルコマンドを実行して終了ステータスを返す', 'run a shell command and return its exit status'],
  close: ['ファイルやパイプを閉じる', 'close a file or pipe'],
  fflush: ['出力をすぐに書き出す', 'flush output'],
  int: ['整数部分（小数点以下を切り捨て）', 'integer part (truncated)'],
  sqrt: ['平方根', 'square root'], exp: ['指数関数', 'exponential'], log: ['自然対数', 'natural logarithm'],
  sin: ['正弦', 'sine'], cos: ['余弦', 'cosine'], atan2: ['逆正接', 'arctangent'],
  rand: ['0 以上 1 未満の乱数', 'a random number in [0, 1)'],
  srand: ['乱数の種を設定する', 'seed the random number generator'],
  strftime: ['日時を書式に従って文字列にする（GNU awk）', 'format a time (GNU awk)'],
  systime: ['現在の UNIX 時刻（GNU awk）', 'current UNIX time (GNU awk)'],
  asort: ['配列の値を並べ替える（GNU awk）', 'sort array values (GNU awk)'],
  asorti: ['配列のキーを並べ替える（GNU awk）', 'sort array indices (GNU awk)'],
};

export function lex(src: string): Lex[] {
  const out: Lex[] = [];
  let i = 0;
  /** Whether a `/` here starts a regex (an operand is expected) rather than meaning division. */
  const regexAllowed = () => {
    const prev = out[out.length - 1];
    if (!prev || prev.type === 'nl') return true;
    if (prev.type === 'op') return !')]'.includes(prev.text) && prev.text !== '$' && prev.text !== '++' && prev.text !== '--';
    if (prev.type === 'kw') return prev.text !== 'getline';
    return false;
  };
  while (i < src.length) {
    const c = src[i];
    const start = i;
    if (c === '\n') { out.push({ type: 'nl', text: '\n', start, end: ++i }); continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
      i = Math.min(i + 1, src.length);
      out.push({ type: 'str', text: src.slice(start, i), start, end: i });
      continue;
    }
    if (c === '/' && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < src.length && (src[i] !== '/' || inClass) && src[i] !== '\n') {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        i++;
      }
      i = Math.min(i + 1, src.length);
      out.push({ type: 'regex', text: src.slice(start, i), start, end: i });
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i)))) {
      i += m[0].length;
      out.push({ type: 'num', text: m[0], start, end: i });
      continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)))) {
      i += m[0].length;
      out.push({ type: KEYWORDS.has(m[0]) ? 'kw' : 'ident', text: m[0], start, end: i });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i)) ?? c;
    i += op.length;
    out.push({ type: 'op', text: op, start, end: i });
  }
  return out;
}

class AwkExplainer {
  private s: S;
  private p = 0;

  constructor(private src: string, private toks: Lex[], private lang: Lang) {
    this.s = pick(lang);
  }

  program(): EmbeddedToken[] {
    const out: EmbeddedToken[] = [];
    while (this.p < this.toks.length) {
      const t = this.toks[this.p];
      if (t.type === 'nl' || t.text === ';') { this.p++; continue; }
      out.push(t.text === 'function' || t.text === 'func' ? this.functionDef() : this.rule());
    }
    return out;
  }

  private tok(start: number, end: number, kind: EmbeddedToken['kind'], explanation: string, children: EmbeddedToken[] = []): EmbeddedToken {
    return { start, end, kind, explanation, children };
  }

  private text(a: Lex[]): string {
    return a.length ? this.src.slice(a[0].start, a[a.length - 1].end) : '';
  }

  /** Index of the token matching the opener at `i` (`{`, `(` or `[`). */
  private matching(i: number): number {
    const open = this.toks[i].text;
    const close = open === '{' ? '}' : open === '(' ? ')' : ']';
    let depth = 0;
    for (let k = i; k < this.toks.length; k++) {
      if (this.toks[k].text === open) depth++;
      else if (this.toks[k].text === close && --depth === 0) return k;
    }
    return this.toks.length - 1;
  }

  // ---------------------------------------------------------------- rules

  private rule(): EmbeddedToken {
    const { s } = this;
    const start = this.p;
    // The pattern runs to `{` or the end of the line.
    while (this.p < this.toks.length && this.toks[this.p].text !== '{' && this.toks[this.p].type !== 'nl' && this.toks[this.p].text !== ';') {
      if (['(', '['].includes(this.toks[this.p].text)) this.p = this.matching(this.p);
      this.p++;
    }
    const pattern = this.toks.slice(start, this.p);
    let action: EmbeddedToken | undefined;
    let actionEnd = pattern[pattern.length - 1]?.end ?? 0;
    if (this.toks[this.p]?.text === '{') {
      const close = this.matching(this.p);
      action = this.block(this.p, close);
      actionEnd = this.toks[close].end;
      this.p = close + 1;
    }
    const children: EmbeddedToken[] = [];
    let when = '';
    if (pattern.length) {
      const pat = this.pattern(pattern);
      children.push(pat.token);
      when = pat.when;
    }
    if (action) children.push(action);
    const first = (pattern[0] ?? this.toks[start]).start;
    let explanation: string;
    if (!action) explanation = s(`${when}を出力する（アクションを省略すると \`print\` と同じ）`, `print ${when} (no action means \`print\`)`);
    else if (!pattern.length) {
      // `{ … }` alone: the rule is just its action.
      return { ...action, explanation: s('ルール: すべての行に対して `{ }` 内の文を順に実行する', 'Rule: run the statements in `{ }` for every line') };
    }
    else if (pattern[0].text === 'BEGIN' || pattern[0].text === 'END') explanation = pattern[0].text === 'BEGIN'
      ? s('最初の行を読む前に1回だけ `{ }` 内を実行する（初期化など）', 'run `{ }` once before reading any input (setup)')
      : s('すべての行を読み終えた後に1回だけ `{ }` 内を実行する（集計結果の出力など）', 'run `{ }` once after all input is read (e.g. print totals)');
    else explanation = s(`${when}に対して \`{ }\` 内を実行する`, `run \`{ }\` for ${when}`);
    return this.tok(first, actionEnd, 'block', s('ルール: ', 'Rule: ') + explanation, children);
  }

  private pattern(toks: Lex[]): { token: EmbeddedToken; when: string } {
    const { s } = this;
    const text = this.text(toks);
    const start = toks[0].start;
    const end = toks[toks.length - 1].end;
    if (toks.length === 1 && (text === 'BEGIN' || text === 'END' || text === 'BEGINFILE' || text === 'ENDFILE')) {
      const d: Record<string, [string, string]> = {
        BEGIN: ['`BEGIN`: 入力を読む前', '`BEGIN`: before any input'],
        END: ['`END`: すべての入力を読んだ後', '`END`: after all input'],
        BEGINFILE: ['`BEGINFILE`: 各ファイルを読む前（GNU awk）', '`BEGINFILE`: before each file (GNU awk)'],
        ENDFILE: ['`ENDFILE`: 各ファイルを読んだ後（GNU awk）', '`ENDFILE`: after each file (GNU awk)'],
      };
      return { token: this.tok(start, end, 'keyword', s(d[text][0], d[text][1])), when: '' };
    }
    // Range pattern `p1, p2`.
    const comma = toks.findIndex((t) => t.text === ',');
    if (comma > 0) {
      const a = this.pattern(toks.slice(0, comma));
      const b = this.pattern(toks.slice(comma + 1));
      const when = s(`${a.when}から ${b.when}までの範囲の行`, `lines from ${a.when} through ${b.when}`);
      return { token: this.tok(start, end, 'pattern', s(`範囲パターン: ${when}`, `Range pattern: ${when}`), [a.token, this.tok(toks[comma].start, toks[comma].end, 'operator', s('`,`: 範囲（左に一致した行から右に一致した行まで）', '`,`: a range from the first match to the second')), b.token]), when };
    }
    if (/^!\s*([A-Za-z_]\w*)\[\$0\]\+\+$/.test(text)) {
      return { token: this.tok(start, end, 'pattern', s(
        `重複行を除く定番の書き方: 配列で各行の出現回数を数え、初めて出てきた行だけを対象にする`,
        'The classic dedupe idiom: count each line in an array and select only its first occurrence',
      ), this.atoms(toks)), when: s('初めて出てきた行', 'the first occurrence of each line') };
    }
    if (toks.length === 1 && toks[0].type === 'regex') {
      const re = toks[0].text.slice(1, -1);
      return { token: this.regexToken(toks[0], s(`正規表現 \`${re}\` に一致する行`, `Lines matching the regex \`${re}\``)), when: s(`\`${re}\` に一致する行`, `lines matching \`${re}\``) };
    }
    if (toks.length === 1 && toks[0].type === 'num') {
      return { token: this.tok(start, end, 'pattern', s(`\`${text}\`: 常に真（0 以外の数値）`, `\`${text}\`: always true (non-zero)`)), when: text === '0' ? s('どの行も', 'no lines') : s('すべての行', 'every line') };
    }
    return {
      token: this.tok(start, end, 'pattern', s(`条件 \`${text}\` が真（0 や空文字以外）になる行`, `Lines where \`${text}\` is true (not 0 or empty)`), this.atoms(toks)),
      when: s(`\`${text}\` が真になる行`, `lines where \`${text}\` is true`),
    };
  }

  private regexToken(t: Lex, explanation: string): EmbeddedToken {
    const body = t.text.endsWith('/') && t.text.length > 1 ? t.text.slice(1, -1) : t.text.slice(1);
    return this.tok(t.start, t.end, 'pattern', explanation, shift(explainRegex(body, 'ere', this.lang), t.start + 1));
  }

  private functionDef(): EmbeddedToken {
    const { s } = this;
    const kw = this.toks[this.p++];
    const name = this.toks[this.p++];
    while (this.p < this.toks.length && this.toks[this.p].text !== '{') this.p++;
    if (this.p >= this.toks.length) return this.tok(kw.start, name?.end ?? kw.end, 'error', s('関数定義が不完全', 'Incomplete function definition'));
    const close = this.matching(this.p);
    const body = this.block(this.p, close);
    this.p = close + 1;
    return this.tok(kw.start, this.toks[close].end, 'function', s(`関数 \`${name?.text}\` を定義する`, `Defines the function \`${name?.text}\``), [body]);
  }

  // ---------------------------------------------------------------- actions

  /** `{ … }` from token index `open` to `close`, split into statements. */
  private block(open: number, close: number): EmbeddedToken {
    const { s } = this;
    const stmts: EmbeddedToken[] = [];
    let k = open + 1;
    while (k < close) {
      const t = this.toks[k];
      if (t.type === 'nl' || t.text === ';') { k++; continue; }
      const end = this.statementEnd(k, close);
      stmts.push(this.statement(k, end));
      k = end;
    }
    return this.tok(this.toks[open].start, this.toks[close].end, 'block', s('アクション `{ }`: 中の文を順に実行する', 'Action `{ }`: runs the statements in order'), stmts);
  }

  /** Index just past the statement starting at `k` (stopping before `close`). */
  private statementEnd(k: number, close: number): number {
    const t = this.toks[k];
    const skipParens = (i: number) => (this.toks[i]?.text === '(' ? this.matching(i) + 1 : i);
    const body = (i: number) => {
      while (i < close && this.toks[i].type === 'nl') i++;
      return i < close ? this.statementEnd(i, close) : i;
    };
    if (t.text === '{') return this.matching(k) + 1;
    if (t.text === 'if') {
      let i = body(skipParens(k + 1));
      let j = i;
      while (j < close && (this.toks[j].type === 'nl' || this.toks[j].text === ';')) j++;
      if (this.toks[j]?.text === 'else') i = body(j + 1);
      return i;
    }
    if (t.text === 'while' || t.text === 'for') return body(skipParens(k + 1));
    let i = k;
    while (i < close && this.toks[i].type !== 'nl' && this.toks[i].text !== ';' && this.toks[i].text !== '}') {
      if (['(', '[', '{'].includes(this.toks[i].text)) i = this.matching(i);
      i++;
    }
    return i;
  }

  private statement(k: number, end: number): EmbeddedToken {
    const { s } = this;
    const toks = this.toks.slice(k, end).filter((t) => t.type !== 'nl');
    const text = this.text(toks);
    const start = toks[0].start;
    const stop = toks[toks.length - 1].end;
    const head = toks[0].text;
    const tok = (expl: string, children = this.atoms(toks)) => this.tok(start, stop, 'command', expl, children);
    switch (head) {
      case '{':
        return this.block(k, end - 1);
      case 'print':
      case 'printf': {
        const redirect = toks.findIndex((t, i) => i > 0 && ['>', '>>', '|'].includes(t.text) && !this.insideParens(toks, i));
        const args = toks.slice(1, redirect < 0 ? undefined : redirect);
        const argText = this.text(args);
        let expl = head === 'print'
          ? (argText ? s(`\`${argText}\` を出力する（\`,\` で区切った値の間には OFS＝既定で空白が入る）`, `print \`${argText}\` (values separated by \`,\` are joined with OFS, a space by default)`) : s('現在の行（`$0`）をそのまま出力する', 'print the current line (`$0`)'))
          : s(`書式を指定して出力する: \`${argText}\`（\`%s\` 文字列, \`%d\` 整数, \`\\n\` 改行。改行は自動で付かない）`, `print with a format: \`${argText}\` (\`%s\` string, \`%d\` integer; no newline is added)`);
        if (redirect >= 0) {
          const target = this.text(toks.slice(redirect + 1));
          const op = toks[redirect].text;
          expl += op === '>' ? s(`。出力先はファイル ${target}（最初に上書き、以降は追記）`, `, to the file ${target} (truncated once, then appended)`)
            : op === '>>' ? s(`。出力先はファイル ${target}（追記）`, `, appended to the file ${target}`)
              : s(`。出力をコマンド ${target} にパイプで渡す`, `, piped to the command ${target}`);
        }
        // printf's format string is broken down like the shell's printf.
        const fmt = head === 'printf' && args[0]?.type === 'str' ? args[0] : undefined;
        const kids = this.atoms(toks);
        if (fmt) kids.unshift(this.tok(fmt.start, fmt.end, 'string', s('書式文字列', 'Format string'), shift(explainPrintf(fmt.text.slice(1, -1), this.lang), fmt.start + 1)));
        return tok(expl, kids);
      }
      case 'next': return tok(s('この行の処理をここで終えて、次の行に進む', 'stop processing this line and move to the next'), []);
      case 'nextfile': return tok(s('このファイルの処理を終えて、次のファイルに進む', 'skip to the next file'), []);
      case 'exit': return tok(s(`awk を終了する${toks[1] ? `（終了ステータス ${this.text(toks.slice(1))}）` : ''}（END があれば実行される）`, `exit awk${toks[1] ? ` with status ${this.text(toks.slice(1))}` : ''} (END still runs)`));
      case 'break': return tok(s('ループを抜ける', 'leave the loop'), []);
      case 'continue': return tok(s('ループの次の繰り返しに進む', 'continue with the next iteration'), []);
      case 'return': return tok(s('関数から値を返す', 'return from the function'));
      case 'delete': return tok(s(`配列の要素 \`${this.text(toks.slice(1))}\` を削除する`, `delete the array element \`${this.text(toks.slice(1))}\``));
      case 'getline': return tok(s('次の行を読み込む', 'read the next line'));
      case 'if': {
        const close = this.matching(k + 1);
        const cond = this.text(this.toks.slice(k + 2, close));
        const thenEnd = this.statementEnd(this.firstNonNl(close + 1, end), end);
        const kids = [...this.atoms(this.toks.slice(k + 1, close + 1)), this.statement(this.firstNonNl(close + 1, end), thenEnd)];
        let j = thenEnd;
        while (j < end && (this.toks[j].type === 'nl' || this.toks[j].text === ';')) j++;
        if (this.toks[j]?.text === 'else') {
          kids.push(this.tok(this.toks[j].start, this.toks[j].end, 'keyword', s('`else`: 条件が偽のとき', '`else`: otherwise')));
          const e = this.firstNonNl(j + 1, end);
          kids.push(this.statement(e, this.statementEnd(e, end)));
        }
        return this.tok(start, stop, 'keyword', s(`条件分岐: \`${cond}\` が真なら次の文を実行する`, `if \`${cond}\` is true, run the next statement`), kids);
      }
      case 'for':
      case 'while': {
        const close = this.matching(k + 1);
        const inner = this.toks.slice(k + 2, close);
        const header = this.text(inner);
        const inLoop = /^\(?\s*([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\s*\)?$/.exec(header);
        const expl = head === 'while' ? s(`\`${header}\` が真の間、次の文を繰り返す`, `repeat the next statement while \`${header}\` is true`)
          : inLoop ? s(`配列 \`${inLoop[2]}\` の各キーを \`${inLoop[1]}\` に入れて繰り返す（順序は不定）`, `loop over each key of the array \`${inLoop[2]}\` as \`${inLoop[1]}\` (in no particular order)`)
            : s(`\`for (${header})\`: 初期化; 条件; 更新 で回数を制御して繰り返す`, `\`for (${header})\`: loop with init; condition; update`);
        const b = this.firstNonNl(close + 1, end);
        const kids = [...this.atoms(this.toks.slice(k + 1, close + 1))];
        if (b < end) kids.push(this.statement(b, this.statementEnd(b, end)));
        return this.tok(start, stop, 'keyword', expl, kids);
      }
    }
    // Assignments and increments.
    const assign = toks.findIndex((t) => ['=', '+=', '-=', '*=', '/=', '%=', '^='].includes(t.text) && !this.insideParens(toks, toks.indexOf(t)));
    if (assign > 0) {
      const target = this.text(toks.slice(0, assign));
      const value = this.text(toks.slice(assign + 1));
      const op = toks[assign].text;
      const d: Record<string, [string, string]> = {
        '=': [`\`${target}\` に \`${value}\` を代入する`, `set \`${target}\` to \`${value}\``],
        '+=': [`\`${target}\` に \`${value}\` を足す（合計の計算などに使う）`, `add \`${value}\` to \`${target}\` (e.g. to sum)`],
        '-=': [`\`${target}\` から \`${value}\` を引く`, `subtract \`${value}\` from \`${target}\``],
        '*=': [`\`${target}\` に \`${value}\` を掛ける`, `multiply \`${target}\` by \`${value}\``],
        '/=': [`\`${target}\` を \`${value}\` で割る`, `divide \`${target}\` by \`${value}\``],
        '%=': [`\`${target}\` を \`${value}\` で割った余りにする`, `set \`${target}\` to the remainder`],
        '^=': [`\`${target}\` を \`${value}\` 乗する`, `raise \`${target}\` to \`${value}\``],
      };
      const extra = /^\$\d+$|^\$NF$/.test(target) ? s('（フィールドを書き換えると `$0` も OFS で組み立て直される）', ' (changing a field rebuilds `$0` with OFS)') : '';
      return tok(s(d[op][0], d[op][1]) + extra);
    }
    if (toks.length >= 2 && (toks[toks.length - 1].text === '++' || toks[toks.length - 1].text === '--' || toks[0].text === '++' || toks[0].text === '--')) {
      const inc = toks[0].text === '++' || toks[toks.length - 1].text === '++';
      const target = this.text(toks.filter((t) => t.text !== '++' && t.text !== '--'));
      return tok(s(`\`${target}\` を1${inc ? '増やす' : '減らす'}（カウントなどに使う）`, `${inc ? 'increment' : 'decrement'} \`${target}\` (e.g. to count)`));
    }
    if (toks[0].type === 'ident' && toks[1]?.text === '(' && this.matching(k + 1) === end - 1) {
      const f = FUNCS[head];
      return tok(f ? s(`\`${head}()\` を呼び出す: ${f[0]}`, `call \`${head}()\`: ${f[1]}`) : s(`関数 \`${head}\` を呼び出す`, `call the function \`${head}\``));
    }
    return tok(s(`式 \`${text}\` を評価する`, `evaluate \`${text}\``));
  }

  private firstNonNl(i: number, end: number): number {
    while (i < end && this.toks[i].type === 'nl') i++;
    return i;
  }

  private insideParens(toks: Lex[], idx: number): boolean {
    let depth = 0;
    for (let i = 0; i < idx; i++) {
      if (toks[i].text === '(' || toks[i].text === '[') depth++;
      else if (toks[i].text === ')' || toks[i].text === ']') depth--;
    }
    return depth > 0;
  }

  // ---------------------------------------------------------------- atoms

  /** Fields, built-in variables and functions, regexes and notable operators within some tokens. */
  private atoms(toks: Lex[]): EmbeddedToken[] {
    const { s } = this;
    const out: EmbeddedToken[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const next = toks[i + 1];
      if (t.text === '$' && next) {
        let end = next.end;
        let expl: string;
        if (next.type === 'num') expl = next.text === '0' ? s('`$0`: 現在の行全体', '`$0`: the whole current line') : s(`\`$${next.text}\`: ${next.text} 番目のフィールド（列）`, `\`$${next.text}\`: field ${next.text}`);
        else if (next.text === 'NF') expl = s('`$NF`: 最後のフィールド（列）', '`$NF`: the last field');
        else if (next.text === '(') {
          const close = toks.findIndex((x, j) => j > i && x.text === ')');
          end = (toks[close] ?? next).end;
          const inner = this.src.slice(next.end, toks[close]?.start ?? next.end);
          expl = inner.replace(/\s/g, '') === 'NF-1' ? s('`$(NF-1)`: 最後から2番目のフィールド', '`$(NF-1)`: the second-to-last field') : s(`\`$(${inner})\`: 計算した番号のフィールド`, `\`$(${inner})\`: the field with the computed number`);
          i = close >= 0 ? close : i + 1;
          out.push(this.tok(t.start, end, 'variable', expl));
          continue;
        } else expl = s(`\`$${next.text}\`: 変数 ${next.text} の値を番号とするフィールド`, `\`$${next.text}\`: the field numbered by ${next.text}`);
        out.push(this.tok(t.start, end, 'variable', expl));
        i++;
        continue;
      }
      if (t.type === 'ident' && VARS[t.text]) {
        out.push(this.tok(t.start, t.end, 'variable', `\`${t.text}\`: ${s(VARS[t.text][0], VARS[t.text][1])}`));
      } else if (t.type === 'ident' && FUNCS[t.text] && next?.text === '(') {
        out.push(this.tok(t.start, t.end, 'function', `\`${t.text}()\`: ${s(FUNCS[t.text][0], FUNCS[t.text][1])}`));
      } else if (t.type === 'kw' && t.text === 'getline') {
        out.push(this.tok(t.start, t.end, 'function', s('`getline`: 次の行を読み込む', '`getline`: read the next line')));
      } else if (t.type === 'regex') {
        out.push(this.regexToken(t, s(`正規表現 \`${t.text}\``, `Regex \`${t.text}\``)));
      } else if (t.type === 'op' || (t.type === 'kw' && t.text === 'in')) {
        const d: Record<string, [string, string]> = {
          '~': ['左が右の正規表現に一致する', 'the left side matches the regex'],
          '!~': ['左が右の正規表現に一致しない', 'the left side does not match the regex'],
          '&&': ['両方が真', 'both are true'], '||': ['どちらかが真', 'either is true'], '!': ['否定', 'not'],
          '==': ['等しい', 'equal'], '!=': ['等しくない', 'not equal'],
          in: ['左のキーが右の配列にあるか', 'whether the key is in the array'],
          '?': ['条件演算子（`条件 ? 真のとき : 偽のとき`）', 'conditional (`cond ? a : b`)'],
        };
        if (d[t.text]) out.push(this.tok(t.start, t.end, 'operator', `\`${t.text}\`: ${s(d[t.text][0], d[t.text][1])}`));
      }
    }
    return out;
  }
}

/** Explain an awk program: its rules, patterns, actions and the notable parts of each statement. */
export function explainAwk(src: string, lang: Lang): EmbeddedToken[] {
  const toks = lex(src);
  if (!toks.length) return [];
  try {
    return new AwkExplainer(src, toks, lang).program();
  } catch {
    const s = pick(lang);
    return [{ start: 0, end: src.length, kind: 'error', children: [], explanation: s('awk プログラムを解析できませんでした', 'Could not parse the awk program') }];
  }
}
