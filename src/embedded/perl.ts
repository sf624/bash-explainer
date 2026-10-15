import type { Lang } from '../i18n';
import { explainRegex } from './regex';
import { EmbeddedToken, pick, shift } from './types';

type S = (ja: string, en: string) => string;

const PAIRS: Record<string, string> = { '{': '}', '(': ')', '[': ']', '<': '>' };

const VARS: Record<string, [string, string]> = {
  '$_': ['現在の行（またはループ中の値）', 'the current line (or loop value)'],
  '$.': ['現在の行番号', 'the current line number'],
  '@F': ['`-a` で分割した各列の配列', 'the fields split by `-a`'],
  '$&': ['正規表現に一致した部分全体', 'the whole regex match'],
  '$0': ['スクリプト名', 'the script name'],
  '@ARGV': ['コマンドライン引数の配列', 'the command-line arguments'],
  '$ARGV': ['現在読んでいるファイル名', 'the current input file name'],
  '%ENV': ['環境変数のハッシュ（`$ENV{HOME}` など）', 'the environment (`$ENV{HOME}`)'],
  '$,': ['print の引数の間に入る区切り', 'separator printed between print arguments'],
  '$\\': ['print の最後に付く文字列', 'appended after each print'],
  '$/': ['入力の行区切り', 'the input record separator'],
};

const FUNCS: Record<string, [string, string]> = {
  print: ['出力する（引数がなければ `$_`）', 'print (`$_` if no arguments)'],
  say: ['改行付きで出力する（引数がなければ `$_`）', 'print with a newline (`$_` if no arguments)'],
  printf: ['書式を指定して出力する', 'print with a format'],
  chomp: ['末尾の改行を取り除く', 'remove the trailing newline'],
  chop: ['末尾の1文字を取り除く', 'remove the last character'],
  lc: ['小文字にする', 'lowercase'], uc: ['大文字にする', 'uppercase'], lcfirst: ['先頭を小文字にする', 'lowercase the first character'], ucfirst: ['先頭を大文字にする', 'uppercase the first character'],
  length: ['文字数', 'the length'], substr: ['部分文字列', 'a substring'], index: ['文字列の位置（0始まり）', 'position of a substring (0-based)'],
  split: ['区切りで分割して配列にする', 'split into a list'], join: ['区切りでつないで文字列にする', 'join a list into a string'],
  sprintf: ['書式を指定して文字列を作る', 'format a string'], push: ['配列の末尾に追加する', 'append to an array'],
  sort: ['並べ替える', 'sort'], reverse: ['逆順にする', 'reverse'], keys: ['ハッシュのキー一覧', 'the keys of a hash'], values: ['ハッシュの値一覧', 'the values of a hash'],
  exists: ['キーがあるか', 'whether a key exists'], defined: ['値が定義されているか', 'whether a value is defined'], delete: ['要素を削除する', 'delete an element'],
  die: ['エラーメッセージを出して終了する', 'exit with an error message'], warn: ['警告を表示する', 'print a warning'], exit: ['終了する', 'exit'],
  map: ['各要素に式を適用したリストを作る', 'apply an expression to each element'], grep: ['条件に合う要素だけを残す', 'keep the elements that match'],
  int: ['整数部分', 'the integer part'], abs: ['絶対値', 'the absolute value'], time: ['現在の UNIX 時刻', 'the current UNIX time'], localtime: ['日時に変換する', 'convert to local time'],
};

/** Index just past a quote-like construct starting at `i` (`'…'`, `"…"`, `/…/`, `s{…}{…}`…), or `i` if none. */
function skipQuoteLike(src: string, i: number): number {
  const rest = src.slice(i);
  const m = /^(s|tr|y|m|qr|q|qq|qw)\s*([^\w\s])/.exec(rest);
  let op = '';
  let open: string;
  let j: number;
  if (m && !/\w/.test(src[i - 1] ?? '')) {
    op = m[1];
    open = m[2];
    j = i + m[0].length;
  } else if (/^[/'"]/.test(rest)) {
    open = rest[0];
    j = i + 1;
  } else {
    return i;
  }
  /** Read up to the delimiter closing `o` (bracket pairs nest); false if unterminated. */
  const readPart = (o: string) => {
    const c = PAIRS[o] ?? o;
    let depth = 1;
    while (j < src.length) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (o !== c && ch === o) depth++;
      else if (ch === c && --depth === 0) { j++; return true; }
      j++;
    }
    return false;
  };
  if (!readPart(open)) return src.length;
  if (op === 's' || op === 'tr' || op === 'y') {
    // `s{a}{b}` has a second bracketed part; `s/a/b/` continues to the next delimiter.
    if (PAIRS[open]) {
      while (/\s/.test(src[j] ?? '')) j++;
      const open2 = src[j++];
      if (!open2 || !readPart(open2)) return src.length;
    } else if (!readPart(open)) return src.length;
  }
  if (op || open === '/') while (/[a-z]/.test(src[j] ?? '')) j++;
  return j;
}

/** Whether `/` at `i` starts a regex (an operand is expected) rather than meaning division. */
function regexAllowed(src: string, i: number): boolean {
  const before = src.slice(0, i).trimEnd();
  return before === '' || /[(,;{=~!&|?:]$|\b(if|unless|and|or|not|split|grep|return|print|say)$/.test(before);
}

/** Top-level ranges split at `sep` (outside quotes, regexes and brackets). */
function splitTop(src: string, start: number, end: number, sep: RegExp): [number, number][] {
  const out: [number, number][] = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < end;) {
    const c = src[i];
    if ((c === '/' && regexAllowed(src, i)) || c === "'" || c === '"' || (/[a-z]/.test(c) && !/\w/.test(src[i - 1] ?? ''))) {
      const j = skipQuoteLike(src, i);
      if (j > i) { i = j; continue; }
    }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (depth === 0) {
      const m = sep.exec(src.slice(i, end));
      if (m && m.index === 0) {
        out.push([from, i]);
        i += m[0].length;
        from = i;
        continue;
      }
    }
    i++;
  }
  out.push([from, end]);
  return out;
}

class PerlExplainer {
  private s: S;

  constructor(private src: string, private lang: Lang) {
    this.s = pick(lang);
  }

  statements(start: number, end: number): EmbeddedToken[] {
    return splitTop(this.src, start, end, /^;/)
      .map(([a, b]) => this.trim(a, b))
      .filter(([a, b]) => b > a)
      .map(([a, b]) => this.statement(a, b));
  }

  private trim(a: number, b: number): [number, number] {
    while (a < b && /\s/.test(this.src[a])) a++;
    while (b > a && /\s/.test(this.src[b - 1])) b--;
    return [a, b];
  }

  private tok(start: number, end: number, kind: EmbeddedToken['kind'], explanation: string, children: EmbeddedToken[] = []): EmbeddedToken {
    return { start, end, kind, explanation, children };
  }

  private statement(start: number, end: number): EmbeddedToken {
    const { s, src } = this;
    const text = src.slice(start, end);
    const block = /^(BEGIN|END)\s*\{/.exec(text);
    if (block && text.endsWith('}')) {
      const open = start + text.indexOf('{');
      const inner = this.statements(open + 1, end - 1);
      return this.tok(start, end, 'block', block[1] === 'BEGIN'
        ? s('`BEGIN { }`: 入力を読む前に1回だけ実行する', '`BEGIN { }`: runs once before any input')
        : s('`END { }`: すべての入力を読んだ後に1回だけ実行する', '`END { }`: runs once after all input'), inner);
    }
    // Statement modifiers: `print if /re/`, `next unless $x`.
    const parts = splitTop(src, start, end, /^\s+(if|unless)\s+/);
    if (parts.length === 2) {
      const kw = /\s+(if|unless)\s+/.exec(src.slice(parts[0][1], parts[1][0]))![1];
      const body = this.statement(...this.trim(parts[0][0], parts[0][1]));
      const [ca, cb] = this.trim(parts[1][0], parts[1][1]);
      const cond = this.condition(ca, cb);
      const condText = src.slice(ca, cb);
      const condWords = /^\/.*\/[a-z]*$/.test(condText) ? s(`現在の行が \`${condText}\` に一致する`, `the line matches \`${condText}\``) : `\`${condText}\``;
      return this.tok(start, end, 'keyword', kw === 'if'
        ? s(`${condWords}なら: ${body.explanation}`, `if ${condWords}: ${body.explanation}`)
        : s(`${condWords}でなければ: ${body.explanation}`, `unless ${condWords}: ${body.explanation}`), [body, cond]);
    }
    const sub = /^(?:(\$\w+)\s*=~\s*)?s\b\s*[^\w\s]/.exec(text);
    if (sub) return this.substitution(start, end, start + sub[0].length - 1, sub[1]);
    const tr = /^(?:(\$\w+)\s*=~\s*)?(tr|y)\s*([^\w\s])/.exec(text);
    if (tr) return this.transliteration(start, end);
    if (/^\/.*\/[a-z]*$/.test(text) || /^m\W/.test(text)) return this.condition(start, end);
    const head = /^[a-z]+/.exec(text)?.[0] ?? '';
    const atoms = this.atoms(start, end);
    if (['next', 'last', 'redo'].includes(head)) {
      const d = { next: ['この行の処理を終えて次の行へ進む', 'skip to the next line'], last: ['ループを抜ける', 'leave the loop'], redo: ['同じ行をやり直す', 'redo this line'] }[head]!;
      return this.tok(start, end, 'keyword', s(d[0], d[1]), atoms);
    }
    if (FUNCS[head]) {
      // The statement already explains its leading function.
      atoms.splice(0, atoms.length, ...atoms.filter((t) => t.start !== start));
      const args = text.slice(head.length).trim();
      const what = s(FUNCS[head][0], FUNCS[head][1]);
      return this.tok(start, end, 'command', args ? s(`\`${head}\`: ${what}（\`${args}\`）`, `\`${head}\`: ${what} (\`${args}\`)`) : `\`${head}\`: ${what}`, atoms);
    }
    const assign = /^(.+?)\s*(\.=|\+=|-=|\*=|\/=|\|\|=|\/\/=|=)(?!=|~)\s*(.+)$/s.exec(text);
    if (assign) {
      const [, target, op, value] = assign;
      const d: Record<string, [string, string]> = {
        '=': [`\`${target}\` に \`${value}\` を代入する`, `set \`${target}\` to \`${value}\``],
        '.=': [`\`${target}\` の末尾に \`${value}\` をつなげる`, `append \`${value}\` to \`${target}\``],
        '+=': [`\`${target}\` に \`${value}\` を足す`, `add \`${value}\` to \`${target}\``],
        '-=': [`\`${target}\` から \`${value}\` を引く`, `subtract \`${value}\` from \`${target}\``],
        '*=': [`\`${target}\` に \`${value}\` を掛ける`, `multiply \`${target}\` by \`${value}\``],
        '/=': [`\`${target}\` を \`${value}\` で割る`, `divide \`${target}\` by \`${value}\``],
        '||=': [`\`${target}\` が偽なら \`${value}\` を代入する`, `set \`${target}\` to \`${value}\` if it is false`],
        '//=': [`\`${target}\` が未定義なら \`${value}\` を代入する`, `set \`${target}\` to \`${value}\` if undefined`],
      };
      return this.tok(start, end, 'assignment', s(d[op][0], d[op][1]), atoms);
    }
    if (/\+\+$|^\+\+/.test(text)) {
      const target = text.replace(/\+\+/g, '').trim();
      return this.tok(start, end, 'assignment', s(`\`${target}\` を1増やす（出現回数を数える定番）`, `increment \`${target}\` (the usual way to count)`), atoms);
    }
    return this.tok(start, end, 'command', s(`式 \`${text}\` を評価する`, `evaluate \`${text}\``), atoms);
  }

  /** A condition; a bare `/re/` or `m{…}` matches against `$_`. */
  private condition(start: number, end: number): EmbeddedToken {
    const { s, src } = this;
    const text = src.slice(start, end);
    const m = /^(m\s*)?([^\w\s])/.exec(text);
    if (m && (m[1] || m[2] === '/') && skipQuoteLike(src, start) === end) {
      const open = m[2];
      const close = PAIRS[open] ?? open;
      const bodyStart = start + m[0].length;
      const bodyEnd = start + text.lastIndexOf(close);
      const flags = text.slice(text.lastIndexOf(close) + 1);
      const fl = flags.includes('i') ? s('（大文字・小文字を区別しない）', ' (case-insensitive)') : '';
      return this.tok(start, end, 'pattern', s(`現在の行（\`$_\`）が正規表現 \`${src.slice(bodyStart, bodyEnd)}\` に一致するか${fl}`, `whether the line (\`$_\`) matches \`${src.slice(bodyStart, bodyEnd)}\`${fl}`),
        shift(explainRegex(src.slice(bodyStart, bodyEnd), 'pcre', this.lang), bodyStart));
    }
    return this.tok(start, end, 'test', s(`条件 \`${text}\``, `condition \`${text}\``), this.atoms(start, end));
  }

  private substitution(start: number, end: number, delimAt: number, target?: string): EmbeddedToken {
    const { s, src } = this;
    const open = src[delimAt];
    const close = PAIRS[open] ?? open;
    const patStart = delimAt + 1;
    let i = patStart;
    while (i < end && src[i] !== close) i += src[i] === '\\' ? 2 : 1;
    const patEnd = i;
    let repStart: number;
    if (open !== close) {
      i++;
      while (i < end && /\s/.test(src[i])) i++;
      repStart = i + 1;
      const c2 = PAIRS[src[i]] ?? src[i];
      i = repStart;
      while (i < end && src[i] !== c2) i += src[i] === '\\' ? 2 : 1;
    } else {
      repStart = patEnd + 1;
      i = repStart;
      while (i < end && src[i] !== close) i += src[i] === '\\' ? 2 : 1;
    }
    const repEnd = i;
    const flags = src.slice(repEnd + 1, end);
    const pat = src.slice(patStart, patEnd);
    const rep = src.slice(repStart, repEnd);
    const kids: EmbeddedToken[] = [
      this.tok(patStart, patEnd, 'pattern', s(`検索パターン（Perl の正規表現）\`${pat}\``, `Pattern (Perl regex) \`${pat}\``), shift(explainRegex(pat, 'pcre', this.lang), patStart)),
      this.tok(repStart, repEnd, 'string', rep ? s(`置換後の文字列 \`${rep}\`（\`$1\` などはグループの内容）`, `Replacement \`${rep}\` (\`$1\`… are the groups)`) : s('置換後の文字列: 空（一致した部分を削除する）', 'Replacement: empty (deletes the match)'), this.atoms(repStart, repEnd)),
    ].filter((t) => t.end > t.start);
    const flagText: Record<string, [string, string]> = {
      g: ['すべて置換する（付けないと最初の1つだけ）', 'replace every match (otherwise only the first)'],
      i: ['大文字・小文字を区別しない', 'case-insensitive'], m: ['`^` `$` を各行に一致させる', '`^`/`$` match at each line'],
      s: ['`.` が改行にも一致する', '`.` also matches newlines'], x: ['パターン中の空白とコメントを無視する', 'ignore whitespace and comments in the pattern'],
      e: ['置換後の文字列を Perl の式として評価する', 'evaluate the replacement as Perl code'],
      r: ['元の値を変えず、置換した結果を返す', 'return the result instead of changing the value'],
    };
    for (let k = 0; k < flags.length; k++) {
      const f = flags[k];
      if (flagText[f]) kids.push(this.tok(repEnd + 1 + k, repEnd + 2 + k, 'option', `\`${f}\`: ${s(flagText[f][0], flagText[f][1])}`));
    }
    const on = target ? `\`${target}\`` : s('現在の行（`$_`）', 'the line (`$_`)');
    const which = flags.includes('g') ? s('すべて', 'every match') : s('最初の1つ', 'the first match');
    return this.tok(start, end, 'command', s(`置換: ${on}の中で \`${pat}\` に一致した部分（${which}）を \`${rep}\` に置き換える`, `Substitute in ${on}: replace ${which} of \`${pat}\` with \`${rep}\``), kids);
  }

  private transliteration(start: number, end: number): EmbeddedToken {
    const { s, src } = this;
    const m = /(tr|y)\s*([^\w\s])(.*?)\2(.*?)\2([a-z]*)$/s.exec(src.slice(start, end));
    if (!m) return this.tok(start, end, 'command', s('文字の変換（tr）', 'Transliterate (tr)'));
    return this.tok(start, end, 'command', s(`文字の変換: \`${m[3]}\` の各文字を \`${m[4]}\` の同じ位置の文字に置き換える（シェルの tr と同じ）`, `Transliterate: each character of \`${m[3]}\` becomes the one at the same position in \`${m[4]}\` (like the tr command)`));
  }

  /** Special variables, fields of @F, capture groups and built-in functions. */
  private atoms(start: number, end: number): EmbeddedToken[] {
    const { s, src } = this;
    const out: EmbeddedToken[] = [];
    const re = /\$F\[(-?\d+)\]|\$(\d)\b|\$_\b|\$\.|\$&|\$ARGV\b|@ARGV\b|@F\b|\$ENV\{\w+\}|<STDIN>|<>|\b([a-z]+)\s*(?=\(|\s|$)/g;
    re.lastIndex = 0;
    const text = src.slice(start, end);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const a = start + m.index;
      const whole = m[0];
      if (m[1] !== undefined) {
        const n = Number(m[1]);
        out.push(this.tok(a, a + whole.length, 'variable', n < 0 ? s(`\`${whole}\`: 後ろから ${-n} 番目の列`, `\`${whole}\`: the ${-n}th field from the end`) : s(`\`${whole}\`: ${n + 1} 列目（\`-a\` で分割した列。0始まり）`, `\`${whole}\`: field ${n + 1} (split by \`-a\`, 0-based index)`)));
      } else if (m[2] !== undefined) {
        out.push(this.tok(a, a + whole.length, 'variable', s(`\`${whole}\`: 直前の一致でグループ ${m[2]} に一致した部分`, `\`${whole}\`: what group ${m[2]} matched`)));
      } else if (whole === '<>' || whole === '<STDIN>') {
        out.push(this.tok(a, a + whole.length, 'variable', s(`\`${whole}\`: 入力から1行読む`, `\`${whole}\`: read a line of input`)));
      } else if (whole.startsWith('$ENV')) {
        out.push(this.tok(a, a + whole.length, 'variable', s(`\`${whole}\`: 環境変数`, `\`${whole}\`: an environment variable`)));
      } else if (VARS[whole]) {
        out.push(this.tok(a, a + whole.length, 'variable', `\`${whole}\`: ${s(VARS[whole][0], VARS[whole][1])}`));
      } else if (m[3] && FUNCS[m[3]]) {
        out.push(this.tok(a, a + m[3].length, 'function', `\`${m[3]}\`: ${s(FUNCS[m[3]][0], FUNCS[m[3]][1])}`));
      }
    }
    return out;
  }
}

/** Explain Perl code given with -e. */
export function explainPerl(src: string, lang: Lang): EmbeddedToken[] {
  try {
    return new PerlExplainer(src, lang).statements(0, src.length);
  } catch {
    return [{ start: 0, end: src.length, kind: 'error', explanation: pick(lang)('Perl のコードを解析できませんでした', 'Could not parse the Perl code'), children: [] }];
  }
}

/** How -n, -p, -a, -l, -i and -0 wrap the code, as one sentence. */
export function perlLoopNote(flags: Set<string>, lang: Lang): string | undefined {
  const s = pick(lang);
  const parts: string[] = [];
  if (flags.has('p')) parts.push(s('入力の各行についてこのコードを実行し、最後に `$_` を出力する（sed のように使える）', 'runs this code for each input line and then prints `$_` (sed-like)'));
  else if (flags.has('n')) parts.push(s('入力の各行についてこのコードを実行する（自動では出力しない）', 'runs this code for each input line (nothing is printed automatically)'));
  if (flags.has('a')) parts.push(s('各行は空白で分割されて `@F` に入る', 'each line is split on whitespace into `@F`'));
  if (flags.has('l')) parts.push(s('各行末の改行は取り除かれ、`print` で改行が付く', 'line endings are removed and `print` adds one'));
  if (flags.has('i')) parts.push(s('ファイルは直接書き換えられる', 'files are edited in place'));
  if (flags.has('0')) parts.push(s('`-0777` ならファイル全体を1つの文字列として読む', 'with `-0777` the whole file is read as one string'));
  return parts.length ? parts.join(s('。', '; ')) : undefined;
}
