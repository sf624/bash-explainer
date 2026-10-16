import type { Lang } from '../i18n';
import { EmbeddedToken, pick } from './types';
import { JQ_ONLY, YQ_BUILTINS } from './yqfuncs';

/** `yq`: the expression language of mikefarah/yq v4, which is jq-like with its own functions. */
export type JqDialect = 'jq' | 'yq';

type S = (ja: string, en: string) => string;

export interface Lex {
  type: 'str' | 'num' | 'var' | 'fmt' | 'ident' | 'field' | 'op' | 'kw';
  text: string;
  start: number;
  end: number;
}

const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'end', 'as', 'def', 'reduce', 'foreach', 'try', 'catch', 'label', 'import', 'include', 'and', 'or', '__loc__']);
const OPS = ['...', '?//', '|=', '+=', '-=', '*=', '/=', '%=', '//=', '==', '!=', '<=', '>=', '//', '..', '|', ',', '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', '{', '}', ':', ';', '?', '.'];

/** Built-in functions: [ja, en]. */
const BUILTINS: Record<string, [string, string]> = {
  select: ['条件が真の入力だけを通す（偽なら何も出力しない）', 'pass the input through only if the condition is true'],
  map: ['配列の各要素にフィルタを適用した配列を作る（`[.[] | f]` と同じ）', 'apply the filter to every element of an array (same as `[.[] | f]`)'],
  map_values: ['オブジェクト・配列の各値にフィルタを適用する', 'apply the filter to every value'],
  keys: ['キー（配列ならインデックス）の一覧をソートして返す', 'the keys (or indices), sorted'],
  keys_unsorted: ['キーの一覧を元の順序で返す', 'the keys in their original order'],
  values: ['null 以外の値だけを通す', 'pass through values that are not null'],
  length: ['長さ（文字数・要素数・キー数。数値なら絶対値）', 'the length (characters, elements or keys; absolute value for numbers)'],
  utf8bytelength: ['文字列の UTF-8 でのバイト数', 'the UTF-8 byte length of a string'],
  has: ['指定したキー（インデックス）があるか', 'whether the key (or index) exists'],
  in: ['入力が、引数のオブジェクトのキーとして存在するか', 'whether the input is a key of the argument'],
  contains: ['引数の内容を含んでいるか', 'whether the input contains the argument'],
  inside: ['入力が引数に含まれているか', 'whether the input is contained in the argument'],
  to_entries: ['オブジェクトを `{key, value}` の配列に変換する', 'turn an object into an array of `{key, value}`'],
  from_entries: ['`{key, value}` の配列をオブジェクトに戻す', 'turn an array of `{key, value}` back into an object'],
  with_entries: ['オブジェクトの各 `{key, value}` にフィルタを適用する（キーの変更などに使う）', 'apply the filter to each `{key, value}` (e.g. to rename keys)'],
  add: ['配列の要素をすべて足し合わせる（数値は合計、文字列・配列は連結）', 'add up the elements (sum numbers, join strings/arrays)'],
  any: ['どれか1つでも真なら true', 'true if any element is true'],
  all: ['すべて真なら true', 'true if every element is true'],
  flatten: ['入れ子の配列を平らにする', 'flatten nested arrays'],
  range: ['連続した数値を出力する', 'produce a range of numbers'],
  floor: ['小数点以下を切り捨てる', 'round down'],
  sqrt: ['平方根', 'square root'],
  tostring: ['文字列に変換する', 'convert to a string'],
  tonumber: ['数値に変換する', 'convert to a number'],
  type: ['値の型名（"object"、"array"、"string" など）', 'the type name ("object", "array", "string", …)'],
  sort: ['配列を並べ替える', 'sort an array'],
  sort_by: ['指定した値をキーにして配列を並べ替える', 'sort an array by the given expression'],
  group_by: ['指定した値ごとに要素をグループ（配列の配列）にまとめる', 'group elements by the given expression'],
  unique: ['重複を除いて並べ替える', 'remove duplicates (sorted)'],
  unique_by: ['指定した値が重複する要素を除く', 'remove elements with a duplicate key'],
  min: ['最小の要素', 'the smallest element'], max: ['最大の要素', 'the largest element'],
  min_by: ['指定した値が最小の要素', 'the element with the smallest key'], max_by: ['指定した値が最大の要素', 'the element with the largest key'],
  reverse: ['配列（文字列）を逆順にする', 'reverse an array (or string)'],
  first: ['最初の要素（引数があればその最初の出力）', 'the first element (or first output of the argument)'],
  last: ['最後の要素（引数があればその最後の出力）', 'the last element (or last output of the argument)'],
  nth: ['n 番目の要素', 'the nth element'],
  limit: ['最初の n 個の出力だけを取る', 'take only the first n outputs'],
  until: ['条件が真になるまで更新を繰り返す', 'repeat the update until the condition holds'],
  while: ['条件が真の間、更新を繰り返して各値を出力する', 'repeat the update while the condition holds, outputting each value'],
  repeat: ['フィルタを繰り返し適用し続ける', 'apply the filter repeatedly'],
  recurse: ['入力とその子孫を再帰的に出力する', 'output the input and all of its descendants'],
  walk: ['すべての値に下から順にフィルタを適用する', 'apply the filter to every value, bottom-up'],
  empty: ['何も出力しない', 'output nothing'],
  error: ['エラーを発生させる', 'raise an error'],
  not: ['真偽を反転する', 'negate a boolean'],
  paths: ['すべてのパスを配列で出力する', 'output every path as an array'],
  leaf_paths: ['末端の値へのパスを出力する', 'output paths to leaf values'],
  path: ['式が指すパスを配列で出力する', 'output the path the expression refers to'],
  getpath: ['パス配列で指定した値を取り出す', 'get the value at a path array'],
  setpath: ['パス配列で指定した場所に値を設定する', 'set the value at a path array'],
  del: ['指定した場所を削除する', 'delete the given paths'],
  delpaths: ['パスの一覧で指定した場所を削除する', 'delete a list of paths'],
  ascii_downcase: ['英字を小文字にする', 'lowercase ASCII letters'],
  ascii_upcase: ['英字を大文字にする', 'uppercase ASCII letters'],
  ltrimstr: ['先頭の指定文字列を取り除く', 'remove the given prefix'],
  rtrimstr: ['末尾の指定文字列を取り除く', 'remove the given suffix'],
  trim: ['前後の空白を取り除く', 'trim surrounding whitespace'],
  startswith: ['指定文字列で始まるか', 'whether the string starts with the argument'],
  endswith: ['指定文字列で終わるか', 'whether the string ends with the argument'],
  split: ['文字列を区切り文字で分割して配列にする', 'split a string into an array'],
  join: ['配列の要素を区切り文字でつないで文字列にする', 'join array elements into a string'],
  test: ['正規表現に一致するか（true/false）', 'whether the string matches the regex'],
  match: ['正規表現の一致情報を返す', 'return match information for the regex'],
  capture: ['正規表現の名前付きグループをオブジェクトにして返す', 'return named captures as an object'],
  scan: ['正規表現に一致する部分をすべて出力する', 'output every match of the regex'],
  sub: ['正規表現に最初に一致した部分を置換する', 'replace the first regex match'],
  gsub: ['正規表現に一致する部分をすべて置換する', 'replace every regex match'],
  splits: ['正規表現で分割した各部分を出力する', 'split by a regex, outputting each part'],
  ascii: ['コードポイントを文字にする', 'code point to character'],
  explode: ['文字列をコードポイントの配列にする', 'string to an array of code points'],
  implode: ['コードポイントの配列を文字列にする', 'array of code points to a string'],
  tojson: ['値を JSON 文字列にする', 'encode the value as a JSON string'],
  fromjson: ['JSON 文字列を値に戻す', 'parse a JSON string'],
  todate: ['UNIX 時刻を ISO 8601 の日時文字列にする', 'UNIX time to an ISO 8601 string'],
  fromdate: ['ISO 8601 の日時文字列を UNIX 時刻にする', 'ISO 8601 string to UNIX time'],
  now: ['現在の UNIX 時刻', 'the current UNIX time'],
  strftime: ['日時を書式に従って文字列にする', 'format a time'],
  strptime: ['日時文字列を書式に従って解析する', 'parse a time string'],
  env: ['環境変数のオブジェクト', 'the environment variables as an object'],
  input: ['次の入力を1つ読む', 'read the next input'],
  inputs: ['残りの入力をすべて出力する', 'output all remaining inputs'],
  debug: ['値を標準エラーに表示してそのまま通す', 'print the value to stderr and pass it on'],
  halt: ['処理を終了する', 'stop the program'],
  halt_error: ['エラーとして終了する', 'stop with an error'],
  input_filename: ['入力ファイル名', 'the current input file name'],
  isempty: ['フィルタが何も出力しないか', 'whether the filter outputs nothing'],
  indices: ['指定した値が現れる位置の一覧', 'positions where the value occurs'],
  index: ['指定した値が最初に現れる位置', 'the first position of the value'],
  rindex: ['指定した値が最後に現れる位置', 'the last position of the value'],
  tostream: ['値をパスと値のストリームにする', 'turn the value into a stream of path/value events'],
  fromstream: ['ストリームから値を組み立て直す', 'rebuild a value from a stream'],
  objects: ['オブジェクトだけを通す', 'pass through objects only'],
  arrays: ['配列だけを通す', 'pass through arrays only'],
  strings: ['文字列だけを通す', 'pass through strings only'],
  numbers: ['数値だけを通す', 'pass through numbers only'],
  booleans: ['真偽値だけを通す', 'pass through booleans only'],
  nulls: ['null だけを通す', 'pass through nulls only'],
  iterables: ['配列とオブジェクトだけを通す', 'pass through arrays and objects only'],
  scalars: ['配列・オブジェクト以外だけを通す', 'pass through non-container values only'],
  IN: ['入力が、引数の出力のどれかと等しいか', 'whether the input equals any output of the argument'],
  INDEX: ['指定したキーでオブジェクトに索引付けする', 'build an object indexed by the given key'],
};

const FORMATS: Record<string, [string, string]> = {
  '@csv': ['配列を CSV の1行にする', 'format an array as a CSV row'],
  '@tsv': ['配列を TSV の1行にする', 'format an array as a TSV row'],
  '@json': ['JSON 文字列にする', 'format as JSON'],
  '@text': ['文字列にする', 'format as text'],
  '@html': ['HTML エスケープする', 'escape for HTML'],
  '@uri': ['URL エンコードする', 'percent-encode for URLs'],
  '@sh': ['シェルで安全に使えるようにクォートする', 'quote for the shell'],
  '@base64': ['Base64 エンコードする', 'encode as Base64'],
  '@base64d': ['Base64 デコードする', 'decode Base64'],
};

export class ParseError extends Error {
  constructor(public at: number, message: string) {
    super(message);
  }
}

export function lex(src: string): Lex[] {
  const out: Lex[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    const start = i;
    if (c === '"') {
      i = stringEnd(src, i);
      out.push({ type: 'str', text: src.slice(start, i), start, end: i });
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i)))) {
      i += m[0].length;
      out.push({ type: 'num', text: m[0], start, end: i });
      continue;
    }
    if ((m = /^\$(__loc__|[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*)/.exec(src.slice(i)))) {
      i += m[0].length;
      out.push({ type: 'var', text: m[0], start, end: i });
      continue;
    }
    if ((m = /^@[A-Za-z0-9_]+/.exec(src.slice(i)))) {
      i += m[0].length;
      out.push({ type: 'fmt', text: m[0], start, end: i });
      continue;
    }
    if ((m = /^\.([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i)))) {
      i += m[0].length;
      out.push({ type: 'field', text: m[0], start, end: i });
      continue;
    }
    if (c === '.' && src[i + 1] === '"') {
      i = stringEnd(src, i + 1);
      out.push({ type: 'field', text: src.slice(start, i), start, end: i });
      continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i)))) {
      i += m[0].length;
      out.push({ type: KEYWORDS.has(m[0]) ? 'kw' : 'ident', text: m[0], start, end: i });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ParseError(i, `unexpected "${c}"`);
    i += op.length;
    out.push({ type: 'op', text: op, start, end: i });
  }
  return out;
}

/** End offset of the string literal starting at `i`, skipping escapes and `\(…)` interpolations. */
function stringEnd(src: string, i: number): number {
  i++;
  while (i < src.length && src[i] !== '"') {
    if (src[i] === '\\' && src[i + 1] === '(') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '"') i = stringEnd(src, i) - 1;
        else if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
      continue;
    }
    i += src[i] === '\\' ? 2 : 1;
  }
  if (i >= src.length) throw new ParseError(src.length, 'unterminated string');
  return i + 1;
}

type Node = EmbeddedToken & { short?: string; isPipe?: boolean };

/** yq node properties set with `.path prop = value`. */
const YQ_PROPS = new Set(['line_comment', 'head_comment', 'foot_comment', 'style', 'tag', 'anchor', 'alias', 'key']);

class JqParser {
  private p = 0;
  private s: S;

  constructor(private src: string, private toks: Lex[], lang: Lang, private dialect: JqDialect = 'jq') {
    this.s = pick(lang);
  }

  get done(): boolean {
    return this.p >= this.toks.length;
  }

  private peek(text?: string): Lex | undefined {
    const t = this.toks[this.p];
    return text === undefined || t?.text === text ? t : undefined;
  }

  private next(): Lex {
    const t = this.toks[this.p++];
    if (!t) throw new ParseError(this.src.length, 'unexpected end');
    return t;
  }

  private expect(text: string): Lex {
    const t = this.toks[this.p];
    if (t?.text !== text) throw new ParseError(t?.start ?? this.src.length, `expected "${text}"`);
    this.p++;
    return t;
  }

  private node(start: number, end: number, kind: Node['kind'], explanation: string, children: Node[] = [], short?: string): Node {
    return { start, end, kind, explanation, children, short };
  }

  private opNode(t: Lex, explanation: string): Node {
    return this.node(t.start, t.end, 'operator', `\`${t.text}\`: ${explanation}`);
  }

  // ---------------------------------------------------------------- precedence levels

  pipe(): Node {
    const { s } = this;
    if (this.peek('def')) {
      const def = this.definition();
      const rest = this.pipe();
      // Like a pipeline, a definition followed by its body is shown as a flat sequence.
      const n = this.node(def.start, rest.end, 'block', rest.explanation, [def, ...(rest.isPipe ? rest.children : [rest])], rest.short);
      n.isPipe = true;
      return n;
    }
    const left = this.comma();
    const as = this.peek('as');
    if (as) {
      this.p++;
      const pat = this.next();
      // yq: `expr as $x ireduce (init; update)`.
      const ired = this.dialect === 'yq' ? this.peek('ireduce') : undefined;
      if (ired) {
        this.p++;
        this.expect('(');
        const init = this.pipe();
        this.expect(';');
        const update = this.pipe();
        const close = this.expect(')');
        return this.node(left.start, close.end, 'block', s(
          `畳み込み: 初期値 \`${this.text(init)}\` から始めて、\`${this.text(left)}\` の各結果を \`${pat.text}\` に入れて \`${this.text(update)}\` で更新していく（jq の \`reduce\` に当たる）`,
          `Fold: start from \`${this.text(init)}\` and update it with \`${this.text(update)}\` for each result of \`${this.text(left)}\` as \`${pat.text}\` (jq's \`reduce\`)`,
        ), [left, this.opNode(as, s('左の結果を変数に入れる', 'binds the result to a variable')),
          this.node(pat.start, pat.end, 'variable', s(`変数 \`${pat.text}\``, `Variable \`${pat.text}\``)),
          this.node(ired.start, ired.end, 'keyword', s('`ireduce`: 畳み込み', '`ireduce`: fold')), init, update]);
      }
      const bar = this.expect('|');
      const body = this.pipe();
      return this.node(left.start, body.end, 'block', s(
        `変数束縛: \`${this.text(left)}\` の各結果を \`${pat.text}\` に入れて、\`|\` 以降を実行する`,
        `Binding: run what follows \`|\` with each result of \`${this.text(left)}\` as \`${pat.text}\``,
      ), [left, this.opNode(as, s('左の結果を変数に入れる', 'binds the result to a variable')),
        this.node(pat.start, pat.end, 'variable', s(`変数 \`${pat.text}\``, `Variable \`${pat.text}\``)),
        this.opNode(bar, s('以降の式で変数を使える', 'the variable is available from here')), ...(body.isPipe ? body.children : [body])]);
    }
    const bar = this.peek('|');
    if (!bar) return left;
    this.p++;
    const right = this.pipe();
    const parts = [left, this.opNode(bar, s('左の各結果を1つずつ右のフィルタに渡す', 'feeds each result on the left into the filter on the right')), ...(right.isPipe ? right.children : [right])];
    const n = this.node(left.start, right.end, 'operator', s(
      'パイプライン: 左から順に、各フィルタの出力を次のフィルタの入力にする',
      'Pipeline: each filter\'s output becomes the next filter\'s input',
    ), parts);
    n.isPipe = true;
    return n;
  }

  private comma(): Node {
    let left = this.alternative();
    let t: Lex | undefined;
    while ((t = this.peek(','))) {
      this.p++;
      const right = this.alternative();
      left = this.binary(left, t, right, this.s('左右両方の結果を順に出力する', 'outputs the results of both sides'));
    }
    return left;
  }

  private alternative(): Node {
    const left = this.assignment();
    const t = this.peek('//') ?? this.peek('?//');
    if (!t) return left;
    this.p++;
    const right = this.alternative();
    return this.binary(left, t, right, this.s('左が null・false・エラーなら右の値を使う（既定値）', 'use the right side if the left is null, false or an error (a default)'));
  }

  private assignment(): Node {
    const left = this.or();
    const t = this.toks[this.p];
    const ops: Record<string, [string, string]> = {
      '=': ['左のパスに右の値を設定する', 'set the path on the left to the value on the right'],
      '|=': ['左のパスの値を、右のフィルタで更新する', 'update the value at the path with the filter'],
      '+=': ['左のパスの値に右の値を足す', 'add to the value at the path'],
      '-=': ['左のパスの値から右の値を引く', 'subtract from the value at the path'],
      '*=': ['左のパスの値に右の値を掛ける', 'multiply the value at the path'],
      '/=': ['左のパスの値を右の値で割る', 'divide the value at the path'],
      '%=': ['左のパスの値を右の値で割った余りにする', 'set the value at the path to the remainder'],
      '//=': ['左のパスの値が null・false なら右の値を設定する', 'set the path if it is null or false'],
    };
    // yq: `.a line_comment = "x"` sets a property of the node on the left.
    const prop = this.dialect === 'yq' && t?.type === 'ident' && YQ_PROPS.has(t.text) ? t : undefined;
    const propOp = prop && this.toks[this.p + 1];
    if (prop && propOp?.type === 'op' && (propOp.text === '=' || propOp.text === '|=')) {
      this.p += 2;
      const value = this.alternative();
      const d = YQ_BUILTINS[prop.text];
      return this.node(left.start, value.end, 'operator', this.s(
        `\`${this.text(left)}\` の ${prop.text}（${d ? d[0] : ''}）を設定し、文書全体を出力する`,
        `Set the ${prop.text} of \`${this.text(left)}\` (${d ? d[1] : ''}) and output the whole document`,
      ), [left, this.node(prop.start, prop.end, 'function', `\`${prop.text}\`: ${d ? this.s(d[0], d[1]) : ''}`), this.opNode(propOp, this.s('設定する', 'sets it')), value]);
    }
    if (t?.type !== 'op' || !ops[t.text]) return left;
    this.p++;
    const right = this.alternative();
    return this.binary(left, t, right, this.s(ops[t.text][0], ops[t.text][1]));
  }

  private or(): Node {
    let left = this.and();
    let t: Lex | undefined;
    while ((t = this.peek('or'))) {
      this.p++;
      left = this.binary(left, t, this.and(), this.s('どちらかが真なら true', 'true if either side is true'));
    }
    return left;
  }

  private and(): Node {
    let left = this.compare();
    let t: Lex | undefined;
    while ((t = this.peek('and'))) {
      this.p++;
      left = this.binary(left, t, this.compare(), this.s('両方が真なら true', 'true if both sides are true'));
    }
    return left;
  }

  private compare(): Node {
    const left = this.additive();
    const t = this.toks[this.p];
    const ops: Record<string, [string, string]> = {
      '==': ['等しい', 'equal'], '!=': ['等しくない', 'not equal'], '<': ['左が小さい', 'less than'],
      '<=': ['左が以下', 'less than or equal'], '>': ['左が大きい', 'greater than'], '>=': ['左が以上', 'greater than or equal'],
    };
    if (t?.type !== 'op' || !ops[t.text]) return left;
    this.p++;
    return this.binary(left, t, this.additive(), this.s(`比較: ${ops[t.text][0]}なら true`, `comparison: true if ${ops[t.text][1]}`));
  }

  private additive(): Node {
    let left = this.multiplicative();
    let t: Lex | undefined;
    while ((t = this.peek('+') ?? this.peek('-'))) {
      this.p++;
      left = this.binary(left, t, this.multiplicative(), t.text === '+'
        ? this.s('足し算（文字列・配列は連結、オブジェクトはマージ）', 'addition (concatenates strings/arrays, merges objects)')
        : this.s('引き算（配列なら右の要素を取り除く）', 'subtraction (removes elements for arrays)'));
    }
    return left;
  }

  private multiplicative(): Node {
    let left = this.postfix();
    let t: Lex | undefined;
    while ((t = this.peek('*') ?? this.peek('/') ?? this.peek('%'))) {
      this.p++;
      const d = t.text === '*' ? this.s('掛け算（オブジェクトなら深いマージ）', 'multiplication (deep merge for objects)')
        : t.text === '/' ? this.s('割り算（文字列なら分割）', 'division (splits strings)')
          : this.s('割った余り', 'remainder');
      left = this.binary(left, t, this.postfix(), d);
    }
    return left;
  }

  private binary(left: Node, op: Lex, right: Node, meaning: string): Node {
    return this.node(left.start, right.end, 'operator', `\`${op.text}\`: ${meaning}`, [left, this.opNode(op, meaning), right]);
  }

  // ---------------------------------------------------------------- terms and paths

  private postfix(): Node {
    const { s } = this;
    const base = this.term();
    const steps: Node[] = [];
    for (;;) {
      const t = this.toks[this.p];
      if (!t) break;
      const adjacent = t.start === (steps[steps.length - 1] ?? base).end;
      if (t.type === 'field' && adjacent) {
        this.p++;
        steps.push(this.field(t));
      } else if (t.text === '.' && this.toks[this.p + 1]?.text === '[' && adjacent) {
        this.p++;
      } else if (t.text === '[' && adjacent) {
        steps.push(this.bracket());
      } else if (t.text === '?') {
        this.p++;
        steps.push(this.node(t.start, t.end, 'operator', s('`?`: エラーになっても無視して続ける', '`?`: ignore errors'), [], s('（エラーは無視）', '(errors ignored)')));
      } else break;
    }
    if (!steps.length) return base;
    const identity = this.text(base) === '.';
    const chain = [...(identity ? [] : [base]), ...steps];
    const route = chain.map((c) => c.short ?? `\`${this.text(c)}\``).join(' → ');
    return this.node(base.start, steps[steps.length - 1].end, 'variable', s(`パス: ${route}`, `Path: ${route}`), chain);
  }

  private field(t: Lex): Node {
    const name = t.text.slice(1).replace(/^"|"$/g, '');
    return this.node(t.start, t.end, 'variable', this.s(`\`${name}\` フィールドの値`, `the value of field \`${name}\``), [], `\`${name}\``);
  }

  /** `[]`, `[n]`, `[a:b]`, `["key"]` or `[expr]` after a value. */
  private bracket(): Node {
    const { s } = this;
    const open = this.next();
    if (this.peek(']')) {
      const close = this.next();
      return this.node(open.start, close.end, 'operator', s('`[]`: 配列（オブジェクト）の各要素を1つずつ出力する', '`[]`: output each element (or value) one by one'), [], s('各要素', 'each element'));
    }
    const a = this.toks[this.p];
    const b = this.toks[this.p + 1];
    const c = this.toks[this.p + 2];
    if ((a?.type === 'num' || (a?.text === '-' && b?.type === 'num')) && (a.type === 'num' ? b : c)?.text === ']') {
      const neg = a.text === '-';
      const n = Number(neg ? b.text : a.text) * (neg ? -1 : 1);
      this.p += neg ? 2 : 1;
      const close = this.next();
      const what = n < 0 ? s(n === -1 ? '最後の要素' : `後ろから ${-n} 番目の要素`, n === -1 ? 'the last element' : `the ${-n}th element from the end`)
        : s(`${n + 1} 番目の要素（0 始まり）`, `element ${n} (0-based)`);
      return this.node(open.start, close.end, 'operator', `\`[${n}]\`: ${what}`, [], what);
    }
    const sliceEnd = this.findSlice();
    if (sliceEnd !== undefined) {
      const inner = this.src.slice(open.end, sliceEnd.start).trim();
      const [from, to] = inner.split(':').map((x) => x.trim());
      this.p = this.toks.indexOf(sliceEnd) + 1;
      const what = s(`${from || '先頭'} から ${to || '最後'}${to ? ' の手前' : ''}まで`, `from ${from || 'the start'} up to ${to ? `(not including) ${to}` : 'the end'}`);
      return this.node(open.start, sliceEnd.end, 'operator', s(`\`[${inner}]\`: 部分配列（部分文字列）を取り出す: ${what}`, `\`[${inner}]\`: a slice ${what}`), [], s(`[${inner}] の範囲`, `slice [${inner}]`));
    }
    if (a?.type === 'str' && b?.text === ']') {
      this.p++;
      const close = this.next();
      const key = a.text.slice(1, -1);
      return this.node(open.start, close.end, 'variable', s(`\`${key}\` フィールドの値`, `the value of field \`${key}\``), [], `\`${key}\``);
    }
    const expr = this.pipe();
    const close = this.expect(']');
    return this.node(open.start, close.end, 'operator', s('`[式]`: 式の結果をキー（インデックス）にして取り出す', '`[expr]`: index by the result of the expression'), [expr], s('式で指定した要素', 'the indexed element'));
  }

  /** If the bracket at the cursor is a slice `[a:b]`, the closing `]` token. */
  private findSlice(): Lex | undefined {
    let depth = 0;
    let colon = false;
    for (let k = this.p; k < this.toks.length; k++) {
      const t = this.toks[k];
      if (t.text === '[' || t.text === '(' || t.text === '{') depth++;
      else if (t.text === ')' || t.text === '}') depth--;
      else if (t.text === ']') {
        if (depth === 0) return colon ? t : undefined;
        depth--;
      } else if (t.text === ':' && depth === 0) colon = true;
    }
    return undefined;
  }

  private term(): Node {
    const { s } = this;
    const t = this.next();
    switch (t.type) {
      case 'field':
        return this.field(t);
      case 'num':
        return this.node(t.start, t.end, 'number', s(`数値 ${t.text}`, `Number ${t.text}`));
      case 'str':
        return this.node(t.start, t.end, 'string', t.text.includes('\\(')
          ? s('文字列（`\\(…)` の部分に式の結果が埋め込まれる）', 'String (the result of each `\\(…)` is interpolated)')
          : s(`文字列 ${t.text}`, `String ${t.text}`));
      case 'var': {
        const special: Record<string, [string, string]> = {
          $ENV: ['環境変数のオブジェクト', 'the environment variables'],
          $__loc__: ['この位置のファイル名と行番号', 'the current file and line'],
        };
        const d = special[t.text];
        return this.node(t.start, t.end, 'variable', d ? `\`${t.text}\`: ${s(d[0], d[1])}` : s(`変数 \`${t.text}\`（\`--arg\` や \`as\` で設定された値）`, `Variable \`${t.text}\` (set by \`--arg\` or \`as\`)`));
      }
      case 'fmt': {
        const d = FORMATS[t.text];
        const expl = d ? `\`${t.text}\`: ${s(d[0], d[1])}` : s(`書式 \`${t.text}\``, `Format \`${t.text}\``);
        if (this.peek()?.type === 'str') {
          const str = this.next();
          return this.node(t.start, str.end, 'operator', s(`${expl}（文字列中の \`\\(…)\` に適用）`, `${expl} (applied to each \`\\(…)\` in the string)`));
        }
        return this.node(t.start, t.end, 'operator', expl);
      }
      case 'ident':
        return this.call(t);
      case 'kw':
        return this.keyword(t);
      case 'op':
        break;
    }
    switch (t.text) {
      case '.':
        return this.node(t.start, t.end, 'variable', s('`.`: 入力そのもの', '`.`: the input itself'), [], s('入力', 'the input'));
      case '..':
        return this.node(t.start, t.end, 'operator', s('`..`: 入力とそのすべての子孫を再帰的に出力する', '`..`: the input and all of its descendants'));
      case '...':
        if (this.dialect !== 'yq') throw new ParseError(t.start, 'unexpected ...');
        return this.node(t.start, t.end, 'operator', s('`...`: 入力とそのすべての子孫を、マップのキーも含めて再帰的に出力する', '`...`: the input and all of its descendants, map keys included'));
      case '-': {
        const operand = this.postfix();
        return this.node(t.start, operand.end, 'operator', s('符号を反転する', 'negation'), [operand]);
      }
      case '(': {
        const inner = this.pipe();
        const close = this.expect(')');
        return this.node(t.start, close.end, 'block', s('`( )`: 中の式をひとまとめにする', '`( )`: groups the expression'), [inner], inner.short);
      }
      case '[': {
        if (this.peek(']')) {
          const close = this.next();
          return this.node(t.start, close.end, 'block', s('空の配列', 'An empty array'));
        }
        const inner = this.pipe();
        const close = this.expect(']');
        return this.node(t.start, close.end, 'block', s('`[ ]`: 中の式の出力をすべて集めて配列にする', '`[ ]`: collects every output of the expression into an array'), [inner]);
      }
      case '{':
        return this.object(t);
    }
    throw new ParseError(t.start, `unexpected "${t.text}"`);
  }

  private call(t: Lex): Node {
    const { s } = this;
    const name = t.text;
    const lit: Record<string, [string, string]> = { true: ['真偽値 true', 'boolean true'], false: ['真偽値 false', 'boolean false'], null: ['null', 'null'] };
    if (lit[name]) return this.node(t.start, t.end, 'number', s(lit[name][0], lit[name][1]));
    const args: Node[] = [];
    let end = t.end;
    if (this.peek('(') && this.toks[this.p].start === t.end) {
      this.p++;
      for (;;) {
        args.push(this.pipe());
        const sep = this.next();
        if (sep.text === ')') { end = sep.end; break; }
        if (sep.text !== ';') throw new ParseError(sep.start, 'expected ; or )');
      }
    }
    const yq = this.dialect === 'yq';
    const d = (yq ? YQ_BUILTINS[name] : undefined) ?? BUILTINS[name];
    let what = d ? s(d[0], d[1]) : yq ? s('関数', 'a function') : s('関数（jq の組み込み関数か、`def` で定義した関数）', 'a function (built-in or defined with `def`)');
    if (yq && JQ_ONLY.has(name)) what += s('（⚠ jq の関数で、mikefarah/yq にはない）', ' (⚠ a jq function; mikefarah/yq does not have it)');
    // yq: `env(HOME)` takes the name of an environment variable, not a filter.
    if (yq && (name === 'env' || name === 'strenv') && args.length === 1 && /^[A-Za-z_]\w*$/.test(this.text(args[0]))) {
      args[0] = { ...args[0], kind: 'variable', explanation: s(`環境変数名 \`${this.text(args[0])}\``, `the environment variable name \`${this.text(args[0])}\``), children: [] };
    }
    if (!args.length) return this.node(t.start, t.end, 'function', `\`${name}\`: ${what}`, [], `\`${name}\``);
    const nameNode = this.node(t.start, t.end, 'function', s('関数名', 'Function name'));
    return this.node(t.start, end, 'function', `\`${name}(…)\`: ${what}`, [nameNode, ...args.map((a, i) => ({
      ...a, explanation: (args.length > 1 ? s(`引数 ${i + 1}: `, `Argument ${i + 1}: `) : s('引数: ', 'Argument: ')) + a.explanation,
    }))], `\`${name}(…)\``);
  }

  private object(open: Lex): Node {
    const { s } = this;
    const entries: Node[] = [];
    while (!this.peek('}')) {
      const k = this.next();
      let keyText = k.text;
      let keyNode: Node | undefined;
      if (k.type === 'str') keyText = k.text.slice(1, -1);
      else if (k.text === '(') {
        keyNode = this.pipe();
        this.expect(')');
        keyText = s('式の結果', 'the computed key');
      } else if (k.type === 'var') keyText = k.text.slice(1);
      else if (k.type !== 'ident' && k.type !== 'kw') throw new ParseError(k.start, 'bad object key');
      if (this.peek(':')) {
        this.p++;
        const value = this.objectValue();
        entries.push(this.node(k.start, value.end, 'assignment', s(`キー \`${keyText}\` に値 \`${this.text(value)}\` を入れる`, `Key \`${keyText}\` gets \`${this.text(value)}\``), [...(keyNode ? [keyNode] : []), value]));
      } else {
        // `{name}` is short for `{name: .name}`, `{$x}` for `{x: $x}`.
        const from = k.type === 'var' ? k.text : `.${keyText}`;
        entries.push(this.node(k.start, this.toks[this.p - 1].end, 'assignment', s(`キー \`${keyText}\` に \`${from}\` を入れる（\`{${k.text}}\` は \`{${keyText}: ${from}}\` の省略形）`, `Key \`${keyText}\` gets \`${from}\` (short for \`{${keyText}: ${from}}\`)`)));
      }
      if (this.peek(',')) this.p++;
      else if (!this.peek('}')) throw new ParseError(this.toks[this.p]?.start ?? this.src.length, 'expected , or }');
    }
    const close = this.next();
    return this.node(open.start, close.end, 'block', s('`{ }`: オブジェクトを作る', '`{ }`: builds an object'), entries);
  }

  /** An object value stops at `,` and `}` (a pipe needs parentheses there). */
  private objectValue(): Node {
    return this.alternative();
  }

  private keyword(t: Lex): Node {
    const { s } = this;
    switch (t.text) {
      case 'if': {
        const parts: Node[] = [];
        const cond = this.pipe();
        parts.push({ ...cond, explanation: s('条件: ', 'Condition: ') + cond.explanation });
        this.expect('then');
        const then = this.pipe();
        parts.push({ ...then, explanation: s('真のとき: ', 'If true: ') + then.explanation });
        while (this.peek('elif')) {
          this.p++;
          const c = this.pipe();
          parts.push({ ...c, explanation: s('次の条件: ', 'Next condition: ') + c.explanation });
          this.expect('then');
          const b = this.pipe();
          parts.push({ ...b, explanation: s('その条件が真のとき: ', 'If that is true: ') + b.explanation });
        }
        if (this.peek('else')) {
          this.p++;
          const e = this.pipe();
          parts.push({ ...e, explanation: s('偽のとき: ', 'Otherwise: ') + e.explanation });
        }
        const end = this.expect('end');
        return this.node(t.start, end.end, 'keyword', s('条件分岐: 条件が真なら then、偽なら else の式を出力する', 'Conditional: outputs the then branch if the condition is true, else the else branch'), parts);
      }
      case 'reduce':
      case 'foreach': {
        const source = this.postfix();
        this.expect('as');
        const v = this.next();
        this.expect('(');
        const init = this.pipe();
        this.expect(';');
        const update = this.pipe();
        let extract: Node | undefined;
        if (this.peek(';')) {
          this.p++;
          extract = this.pipe();
        }
        const close = this.expect(')');
        const expl = t.text === 'reduce'
          ? s(`畳み込み: \`${this.text(source)}\` の各値を \`${v.text}\` として、初期値から順に更新し、最後の結果を出力する`, `Reduce: fold each value of \`${this.text(source)}\` (as \`${v.text}\`) into an accumulator and output the final result`)
          : s(`\`${this.text(source)}\` の各値を \`${v.text}\` として順に更新し、途中の結果を毎回出力する`, `Foreach: update an accumulator with each value of \`${this.text(source)}\` (as \`${v.text}\`), outputting each step`);
        const kids: Node[] = [
          { ...source, explanation: s('繰り返す値: ', 'Values: ') + source.explanation },
          this.node(v.start, v.end, 'variable', s(`各値が入る変数 \`${v.text}\``, `Each value is bound to \`${v.text}\``)),
          { ...init, explanation: s('初期値（`.` が蓄積値）: ', 'Initial value (`.` is the accumulator): ') + init.explanation },
          { ...update, explanation: s('更新式: ', 'Update: ') + update.explanation },
        ];
        if (extract) kids.push({ ...extract, explanation: s('出力する値: ', 'Output: ') + extract.explanation });
        return this.node(t.start, close.end, 'keyword', expl, kids);
      }
      case 'try': {
        const body = this.postfix();
        const kids = [body];
        let end = body.end;
        if (this.peek('catch')) {
          this.p++;
          const handler = this.postfix();
          kids.push({ ...handler, explanation: s('エラー時: ', 'On error: ') + handler.explanation });
          end = handler.end;
        }
        return this.node(t.start, end, 'keyword', s('`try`: エラーが起きても止めずに続ける（`catch` があればエラー時にそれを実行）', '`try`: keep going on errors (run `catch` on an error)'), kids);
      }
      case 'label': {
        const name = this.next();
        this.expect('|');
        const body = this.pipe();
        return this.node(t.start, body.end, 'keyword', s(`ラベル \`${name.text}\`: \`break ${name.text}\` で抜けられる範囲`, `Label \`${name.text}\`: \`break ${name.text}\` exits here`), [body]);
      }
      case 'def':
        this.p--;
        return this.definition();
    }
    throw new ParseError(t.start, `unexpected "${t.text}"`);
  }

  private definition(): Node {
    const { s } = this;
    const def = this.expect('def');
    const name = this.next();
    let params = '';
    if (this.peek('(')) {
      const open = this.next();
      while (!this.peek(')')) this.p++;
      const close = this.next();
      params = this.src.slice(open.start, close.end);
    }
    this.expect(':');
    const body = this.pipe();
    const semi = this.expect(';');
    return this.node(def.start, semi.end, 'function', s(`関数 \`${name.text}${params}\` を定義する`, `Defines the function \`${name.text}${params}\``), [body]);
  }

  private text(n: Node): string {
    return this.src.slice(n.start, n.end);
  }
}

/** Explain a jq filter. The top-level pipeline is returned as a flat sequence of stages and `|`. */
export function explainJq(src: string, lang: Lang, dialect: JqDialect = 'jq'): EmbeddedToken[] {
  const s = pick(lang);
  try {
    const toks = lex(src);
    if (!toks.length) return [];
    const parser = new JqParser(src, toks, lang, dialect);
    const root = parser.pipe();
    if (!parser.done) throw new ParseError(toks[toks.length - 1].start, 'trailing input');
    return strip(root.isPipe ? root.children : [root]);
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    return [{
      start: 0, end: src.length, kind: 'error', children: [],
      explanation: s('jq フィルタを解析できませんでした（構文の誤りか、未対応の書き方）', 'Could not parse the jq filter (a syntax error, or unsupported syntax)'),
    }];
  }
}

/** Drop parser-only fields. */
function strip(nodes: Node[]): EmbeddedToken[] {
  return nodes.map(({ start, end, kind, explanation, children }) => ({ start, end, kind, explanation, children: strip(children as Node[]) }));
}
