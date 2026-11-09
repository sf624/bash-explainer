import type { Lang } from '../i18n';
import { codeSpan } from '../label';
import { tokenSaid } from '../messages-tokens';
import { explainTargetPattern, type TargetFlavor } from './bazel';
import { explainRegex } from './regex';
import { type EmbeddedToken, hasHole, holeStop, holeToken, isHole, pick, shift } from './types';

// The query language of `bazel query`, `cquery` and `aquery`, as bazel 9.3.2 reads it (each fact checked with that release:
// test/fixtures/oracles/bazel.json, `expressions`, which test/bazel-query.test.ts compares this reading with). Words are
// unquoted (letters, digits and `*/@.-_:$~[]`, not starting with `-`; one that starts with `@@` may hold `+`) or quoted
// (`'…'`, `"…"`, with no escapes); `+`, `-`, `^`, `(`, `)`, `,` and `=` end a word. The keywords (`let`, `in`, `set`,
// `except`, `intersect`, `union`) are unquoted words, in lower case. `except`/`-`, `intersect`/`^` and `union`/`+` bind
// alike, from the left; `let v = e in body` binds `$v` for a body that runs as far as it can. A function is a word followed
// by `(`; its arguments are expressions, words or whole numbers, as each function takes them. A word is a target pattern
// (src/embedded/bazel.ts), or a variable where it is `$` and a name (letters, digits, `_`, not a digit first).

/** The command whose expression it is: each knows the functions of `query`, with some of its own and some it refuses. */
export type QueryCommand = 'query' | 'cquery' | 'aquery';

/** What the command line around the expression changes in its reading. */
export interface QueryLine {
  /** `--universe_scope` or `--infer_universe_scope` is given: `bazel query` then knows `allrdeps` and `rbuildfiles`. */
  universe?: boolean;
}

/** What a function's argument is: an expression, a whole number, a regex (searched in a text, or matched by the whole), a word. */
type ArgKind = 'expr' | 'int' | 'find' | 'whole' | 'word';
interface Arg { kind: ArgKind; text?: readonly [string, string] }
interface QueryFunction {
  args: readonly Arg[];
  /** How many arguments it needs; the rest are optional. */
  needs: number;
  /** Its last argument may be repeated (`rbuildfiles(a, b)`). */
  more?: boolean;
  text: readonly [string, string];
}

const EXPR: Arg = { kind: 'expr' };
const depth = (ja: string, en: string): Arg => ({ kind: 'int', text: [ja, en] });
const DEPTH = depth('深さ: 最大でこの段数までの依存だけ（`0` なら元のターゲットだけ）', 'Depth: only the dependencies at most this many steps away (`0`: the targets themselves)');
const RDEPTH = depth('深さ: 最大でこの段数までの逆依存だけ（`0` なら元のターゲットだけ）', 'Depth: only the reverse dependencies at most this many steps away (`0`: the targets themselves)');
const ATTRIBUTE: Arg = { kind: 'word', text: ['属性の名前（`srcs`、`deps`、`tags` など）', 'The name of an attribute (`srcs`, `deps`, `tags`…)'] };
const ACTION = (ja: string, en: string): Arg => ({ kind: 'whole', text: [`Java の正規表現。アクションの${ja}全体と一致するものを選ぶ（一部だけの一致は含まない。\`.*\` で前後を許す）`, `A Java regex, matched by the whole ${en} of an action (not a part of it: \`.*\` lets anything stand around)`] });

/** The functions bazel 9.3.2 knows, by the parser of each command (`query`; `cquery` adds `config`, `aquery` the filters of actions). */
const FUNCTIONS: Readonly<Record<string, QueryFunction>> = {
  allpaths: { args: [EXPR, EXPR], needs: 2, text: ['`allpaths(from, to)`: `from` のターゲットから `to` のターゲットへの依存の経路にあるすべてのターゲット（両端を含む）', '`allpaths(from, to)`: every target on a path of dependencies from a target of `from` to one of `to`, both ends included'] },
  attr: { args: [ATTRIBUTE, { kind: 'find', text: ['Java の正規表現。属性の値（リストなら `[a, b]` の形の文字列）のどこかに一致するものを選ぶ', 'A Java regex, searched anywhere in the attribute\'s value (a list as the text `[a, b]`)'] }, EXPR], needs: 3, text: ['`attr(name, pattern, x)`: `x` のルールのうち、属性 `name` の値が `pattern` に一致するもの', '`attr(name, pattern, x)`: the rules of `x` whose attribute `name` has a value `pattern` matches'] },
  buildfiles: { args: [EXPR], needs: 1, text: ['`buildfiles(x)`: `x` のパッケージの BUILD ファイルと、それが読み込む `.bzl` ファイル', '`buildfiles(x)`: the BUILD files of the packages of `x`, and the `.bzl` files they load'] },
  deps: { args: [EXPR, DEPTH], needs: 1, text: ['`deps(x)`・`deps(x, depth)`: `x` と、`x` が直接または間接に依存するすべてのターゲット', '`deps(x)`, `deps(x, depth)`: `x` and every target it depends on, directly or not'] },
  executables: { args: [EXPR], needs: 1, text: ['`executables(x)`: `x` のうち実行できるルール（`*_binary` など `executable = True` のもの。テストは含まない）', '`executables(x)`: the rules of `x` that are executable (`*_binary` and others of `executable = True`; not tests)'] },
  filter: { args: [{ kind: 'find', text: ['Java の正規表現。ターゲットのラベル（`//app:main`）のどこかに一致するものを選ぶ', 'A Java regex, searched anywhere in each target\'s label (`//app:main`)'] }, EXPR], needs: 2, text: ['`filter(pattern, x)`: `x` のうち、ラベルが `pattern` に一致するターゲット', '`filter(pattern, x)`: the targets of `x` whose label `pattern` matches'] },
  kind: { args: [{ kind: 'find', text: ['Java の正規表現。ターゲットの種類（`cc_library rule`、`source file`、`generated file` など）のどこかに一致するものを選ぶ', 'A Java regex, searched anywhere in each target\'s kind (`cc_library rule`, `source file`, `generated file`…)'] }, EXPR], needs: 2, text: ['`kind(pattern, x)`: `x` のうち、種類が `pattern` に一致するターゲット', '`kind(pattern, x)`: the targets of `x` whose kind `pattern` matches'] },
  labels: { args: [ATTRIBUTE, EXPR], needs: 2, text: ['`labels(name, x)`: `x` のルールの属性 `name` に書かれたターゲット', '`labels(name, x)`: the targets named in the attribute `name` of the rules of `x`'] },
  loadfiles: { args: [EXPR], needs: 1, text: ['`loadfiles(x)`: `x` のパッケージが読み込む `.bzl` ファイル', '`loadfiles(x)`: the `.bzl` files the packages of `x` load'] },
  rdeps: { args: [EXPR, EXPR, RDEPTH], needs: 2, text: ['`rdeps(universe, x)`・`rdeps(universe, x, depth)`: `universe` とその依存のうち、`x` に直接または間接に依存するターゲット（`x` を含む）', '`rdeps(universe, x)`, `rdeps(universe, x, depth)`: the targets of `universe` and its dependencies that depend on `x`, directly or not (`x` included)'] },
  allrdeps: { args: [EXPR, RDEPTH], needs: 1, text: ['`allrdeps(x)`・`allrdeps(x, depth)`: `--universe_scope` の範囲で `x` に依存するすべてのターゲット（`x` を含む）', '`allrdeps(x)`, `allrdeps(x, depth)`: every target of the `--universe_scope` that depends on `x` (`x` included)'] },
  rbuildfiles: { args: [{ kind: 'word', text: ['ファイルのパス（`app/BUILD`、`tools/defs.bzl`。ラベルではない）', 'The path of a file (`app/BUILD`, `tools/defs.bzl`; not a label)'] }], needs: 1, more: true, text: ['`rbuildfiles(path, …)`: `--universe_scope` の範囲で、指定したファイルを読む、またはそのものである BUILD ファイル', '`rbuildfiles(path, …)`: the BUILD files of the `--universe_scope` that are or load the given files'] },
  same_pkg_direct_rdeps: { args: [EXPR], needs: 1, text: ['`same_pkg_direct_rdeps(x)`: `x` と同じパッケージにあって `x` に直接依存するターゲット', '`same_pkg_direct_rdeps(x)`: the targets in the package of a target of `x` that depend on it directly'] },
  siblings: { args: [EXPR], needs: 1, text: ['`siblings(x)`: `x` のパッケージのすべてのターゲット', '`siblings(x)`: every target of the packages of `x`'] },
  some: { args: [EXPR, depth('数: 最大でこの数のターゲット', 'Count: at most this many targets')], needs: 1, text: ['`some(x)`・`some(x, count)`: `x` のどれか1つ（または指定した数）のターゲット。`x` が空なら bazel は「argument set is empty」で止まる', '`some(x)`, `some(x, count)`: one target of `x` (or the given number), any; on an empty `x` bazel stops with "argument set is empty"'] },
  somepath: { args: [EXPR, EXPR], needs: 2, text: ['`somepath(from, to)`: `from` のターゲットから `to` のターゲットへの、依存の経路の1つ', '`somepath(from, to)`: one path of dependencies from a target of `from` to one of `to`'] },
  tests: { args: [EXPR], needs: 1, text: ['`tests(x)`: `x` のテストのルール（`test_suite` はその中のテストになる）', '`tests(x)`: the test rules of `x` (a `test_suite` stands for its tests)'] },
  visible: { args: [EXPR, EXPR], needs: 2, text: ['`visible(from, x)`: `x` のうち、`from` のすべてのターゲットから見える（`visibility` が許す）もの', '`visible(from, x)`: the targets of `x` that every target of `from` may see (their `visibility` allows it)'] },
  config: { args: [EXPR, { kind: 'word', text: ['構成: `target`（最上位のターゲットの構成）、`null`（構成のないソースファイル）、または cquery が表示する構成の ID（`a7a71fd` など）', 'The configuration: `target` (that of the top-level targets), `null` (source files, which have none) or an ID cquery prints (`a7a71fd`…)'] }], needs: 2, text: ['`config(x, configuration)`: `x` のターゲットのうち、指定した構成のもの', '`config(x, configuration)`: the targets of `x` in the given configuration'] },
  inputs: { args: [ACTION('入力のパス', 'path of an input'), EXPR], needs: 1, text: ['`inputs(pattern, x)`: `x` のアクションのうち、入力のパスが `pattern` に一致するもの', '`inputs(pattern, x)`: the actions of `x` with an input whose path `pattern` matches'] },
  outputs: { args: [ACTION('出力のパス', 'path of an output'), EXPR], needs: 1, text: ['`outputs(pattern, x)`: `x` のアクションのうち、出力のパスが `pattern` に一致するもの', '`outputs(pattern, x)`: the actions of `x` with an output whose path `pattern` matches'] },
  mnemonic: { args: [ACTION('種類（mnemonic。`CppCompile`、`FileWrite` など）', 'mnemonic (its kind: `CppCompile`, `FileWrite`…)'), EXPR], needs: 1, text: ['`mnemonic(pattern, x)`: `x` のアクションのうち、種類（mnemonic）が `pattern` に一致するもの', '`mnemonic(pattern, x)`: the actions of `x` whose mnemonic `pattern` matches'] },
};

const QUERY_FUNCTIONS = ['allpaths', 'attr', 'buildfiles', 'deps', 'executables', 'filter', 'kind', 'labels', 'loadfiles', 'rdeps', 'same_pkg_direct_rdeps', 'siblings', 'some', 'somepath', 'tests', 'visible'];
/** The functions each command's parser knows (`bazel query 'nosuch()'` lists them), without the universe's. */
export const KNOWN: Readonly<Record<QueryCommand, readonly string[]>> = {
  query: QUERY_FUNCTIONS, cquery: [...QUERY_FUNCTIONS, 'config'], aquery: [...QUERY_FUNCTIONS, 'inputs', 'outputs', 'mnemonic'],
};
/** `bazel query` with `--universe_scope` or `--infer_universe_scope` (a query of the whole universe) knows these too. */
const UNIVERSE = ['allrdeps', 'rbuildfiles'];
/** What cquery and aquery refuse when they evaluate it, and bazel's words (the parser takes them). */
const POST_ANALYSIS: Readonly<Record<string, string>> = {
  buildfiles: 'buildfiles() doesn\'t make sense for the configured target graph',
  loadfiles: 'buildfiles() doesn\'t make sense for the configured target graph',
  siblings: 'siblings() not supported for post analysis queries',
  same_pkg_direct_rdeps: 'siblings() not supported for post analysis queries',
  visible: 'visible() is not supported on configured targets',
};
const REFUSED: Readonly<Record<QueryCommand, Readonly<Record<string, string>>>> = {
  query: {}, cquery: POST_ANALYSIS, aquery: { ...POST_ANALYSIS, labels: 'labels() is not supported for aquery' },
};

const OPERATORS: Readonly<Record<string, readonly [string, string]>> = {
  except: ['差: 左のターゲットから、右のターゲットを除いたもの（`-` と同じ）', 'Difference: the targets of the left, without those of the right (the same as `-`)'],
  '-': ['差: 左のターゲットから、右のターゲットを除いたもの（`except` と同じ）', 'Difference: the targets of the left, without those of the right (the same as `except`)'],
  intersect: ['積: 左と右の両方にあるターゲット（`^` と同じ）', 'Intersection: the targets both sides have (the same as `^`)'],
  '^': ['積: 左と右の両方にあるターゲット（`intersect` と同じ）', 'Intersection: the targets both sides have (the same as `intersect`)'],
  union: ['和: 左と右のどちらかにあるターゲット（`+` と同じ）', 'Union: the targets of either side (the same as `+`)'],
  '+': ['和: 左と右のどちらかにあるターゲット（`union` と同じ）', 'Union: the targets of either side (the same as `union`)'],
};
const KEYWORDS = new Set(['let', 'in', 'set', 'except', 'intersect', 'union']);

// (A character of an unquoted word; a hole stands for part of one. `+` only in a word that starts with `@@`.)
const WORD_CHAR = /[A-Za-z0-9*/@.\-_:$~[\]﷒-﷯]/;
const VARIABLE = /^\$[A-Za-z_]\w*$/;
const NAME = /^[A-Za-z_]\w*$/;
/** The largest whole number bazel takes (a Java `int`). */
const INT_MAX = 2 ** 31 - 1;

interface Lexeme {
  kind: 'word' | 'keyword' | 'op' | '(' | ')' | ',' | '=' | 'bad';
  start: number;
  end: number;
  /** A word's text, without its quotes. */
  value: string;
  quoted: boolean;
  /** A quote that nothing closes. */
  unclosed?: boolean;
}

function lex(src: string): Lexeme[] {
  const out: Lexeme[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) i++;
    else if ('+-^(),='.includes(c)) {
      out.push({ kind: '+-^'.includes(c) ? 'op' : (c as '(' | ')' | ',' | '='), start: i, end: i + 1, value: c, quoted: false });
      i++;
    } else if (c === '"' || c === '\'') {
      const close = src.indexOf(c, i + 1);
      if (close < 0) {
        out.push({ kind: 'bad', start: i, end: src.length, value: src.slice(i + 1), quoted: true, unclosed: true });
        break;
      }
      out.push({ kind: 'word', start: i, end: close + 1, value: src.slice(i + 1, close), quoted: true });
      i = close + 1;
    } else if (WORD_CHAR.test(c)) {
      const plus = src.startsWith('@@', i);
      let j = i;
      while (j < src.length && (WORD_CHAR.test(src[j]) || (plus && src[j] === '+'))) j++;
      const value = src.slice(i, j);
      out.push({ kind: KEYWORDS.has(value) ? 'keyword' : 'word', start: i, end: j, value, quoted: false });
      i = j;
    } else {
      out.push({ kind: 'bad', start: i, end: i + 1, value: c, quoted: false });
      i++;
    }
  }
  return out;
}

/** A mistake bazel stops at; `says`, the words of its message (test/bazel-query.test.ts finds them in bazel's). */
export interface QueryError { start: number; end: number; says: string }

/** The parse stopped at an error, as bazel's does. */
class Stop extends Error {}

interface State {
  src: string;
  toks: Lexeme[];
  k: number;
  command: QueryCommand;
  line: QueryLine;
  lang: Lang;
  s: (ja: string, en: string) => string;
  flavor: TargetFlavor;
  out: EmbeddedToken[];
  errors: QueryError[];
  /** The `(` that are open, for an end too soon. */
  open: Lexeme[];
}

const stops = (st: State, says: string): string => st.s(`bazel は「${says}」で止まる`, `bazel stops with "${says}"`);

/** An error token over `[start, end)`, and the error: one bazel finds when it evaluates the expression, after the parse. */
function flag(st: State, start: number, end: number, text: string, says: string): void {
  st.out.push({ start, end, kind: 'error', explanation: `${text}${st.s('。', ': ')}${stops(st, says)}`, children: [] });
  st.errors.push({ start, end, says });
}

/** The same for an error of the parse, which ends the reading as it ends bazel's. */
function fail(st: State, start: number, end: number, text: string, says: string): never {
  flag(st, start, end, text, says);
  throw new Stop();
}

/** What bazel says where the text ends too soon, at the `(` left open or at the last lexeme. */
function prematureEnd(st: State): never {
  const open = st.open.at(-1);
  // (An empty text has no lexeme: bazel stops at its end.)
  const at = open ?? st.toks.at(-1) ?? { start: 0, end: st.src.length };
  fail(st, at.start, at.end, open ? st.s('この `(` を閉じる `)` がない', 'No `)` closes this `(`') : st.s('式がここで終わっている', 'The expression ends here, unfinished'), 'premature end of input');
}

/** What bazel says of a lexeme the grammar does not take here. */
function unexpected(st: State, t: Lexeme, after?: boolean): never {
  if (t.unclosed) fail(st, t.start, t.start + 1, st.s('この引用符を閉じる引用符がない（引用符の中にエスケープはない）', 'No quote closes this one (quotes hold no escapes)'), 'unclosed quotation');
  if (t.kind === '=') fail(st, t.start, t.end, st.s('`=` は `let v = …` の名前の後にだけ書ける。語の一部なら、式の中でその語を引用符で囲む（`"//pkg:a=b"`）', '`=` stands only after the name in `let v = …`; as part of a word, quote the word inside the expression (`"//pkg:a=b"`)'), after ? 'unexpected token' : 'syntax error');
  if (t.kind === 'bad') fail(st, t.start, t.end, st.s(`引用符で囲まない語には ${codeSpan(t.value)} を書けない。式の中でその語を引用符で囲む`, `No unquoted word holds ${codeSpan(t.value)}: quote the word inside the expression`), after ? 'unexpected token' : 'syntax error');
  fail(st, t.start, t.end, after ? st.s('式はその前で終わっているので、ここに続けられない', 'The expression ended before this, which cannot follow it') : st.s('ここにこれは書けない', 'This cannot stand here'), after ? 'unexpected token' : 'syntax error');
}

const peek = (st: State): Lexeme | undefined => st.toks[st.k];
function next(st: State): Lexeme {
  const t = st.toks[st.k];
  if (!t) prematureEnd(st);
  st.k++;
  return t;
}
function expect(st: State, kind: Lexeme['kind'], value?: string): Lexeme {
  const t = next(st);
  if (t.kind !== kind || (value !== undefined && t.value !== value)) unexpected(st, t);
  return t;
}

/** `expr`: operands joined by `except`, `intersect`, `union` and their signs, from the left. */
function expression(st: State, env: ReadonlySet<string>): void {
  primary(st, env);
  let chain = 0;
  for (let t = peek(st); t && (t.kind === 'op' || (t.kind === 'keyword' && OPERATORS[t.value])); t = peek(st)) {
    st.k++;
    chain++;
    const [ja, en] = OPERATORS[t.value];
    // (A `+` between two words with no blank: the words end there, which one who meant a name with `+` does not see.)
    const joined = t.value === '+' && /[^\s()]/.test(st.src[t.start - 1]) && /[^\s()]/.test(st.src[t.end] ?? ' ');
    const order = chain > 1 ? st.s('。`except`・`intersect`・`union` の結びつきは同じで、左から順に計算する（`a - b + c` は `(a - b) + c`）', '; `except`, `intersect` and `union` bind alike, from the left (`a - b + c` is `(a - b) + c`)') : '';
    st.out.push({ start: t.start, end: t.end, kind: 'operator', explanation: joined ? tokenSaid(st.lang, 'bazel-query-plus-joined') : st.s(ja, en) + order, children: [] });
    primary(st, env);
  }
}

function primary(st: State, env: ReadonlySet<string>): void {
  const t = next(st);
  if (t.kind === 'keyword' && t.value === 'let') return letExpression(st, t, env);
  if (t.kind === 'keyword' && t.value === 'set') return setExpression(st, t, env);
  if (t.kind === '(') {
    st.open.push(t);
    expression(st, env);
    expect(st, ')');
    st.open.pop();
    return;
  }
  if (t.kind !== 'word') unexpected(st, t);
  if (peek(st)?.kind === '(') return call(st, t, env);
  word(st, t, env);
}

/** `let v = e in body`: `$v` is the targets of `e` in `body`, which runs as far as it can. */
function letExpression(st: State, t: Lexeme, env: ReadonlySet<string>): void {
  const s = st.s;
  const name = next(st);
  if (name.kind !== 'word') unexpected(st, name);
  st.out.push({ start: t.start, end: t.end, kind: 'keyword', explanation: s(`変数 \`${name.value}\` に \`=\` の後の式のターゲットを入れ、\`in\` の後の式で \`$${name.value}\` として使う`, `Binds the variable \`${name.value}\` to the targets of the expression after \`=\`, as \`$${name.value}\` in the expression after \`in\``), children: [] });
  if (hasHole(name.value)) st.out.push(holeStop(name.start));
  else if (!NAME.test(name.value)) flag(st, name.start, name.end, s('変数の名前は英字・数字・`_` で、数字では始まらない', 'A variable\'s name is letters, digits and `_`, not starting with a digit'), `invalid variable name '${name.value}'`);
  else st.out.push({ start: name.start, end: name.end, kind: 'variable', explanation: s(`変数 \`${name.value}\``, `The variable \`${name.value}\``), children: [] });
  expect(st, '=');
  expression(st, env);
  const inn = expect(st, 'keyword', 'in');
  st.out.push({ start: inn.start, end: inn.end, kind: 'keyword', explanation: s(`この後の式（式の終わりか、閉じる \`)\` まで）で \`$${name.value}\` を使える`, `\`$${name.value}\` stands in the expression after it (to the end, or to the closing \`)\`)`), children: [] });
  expression(st, new Set([...env, name.value]));
}

/** `set(a b c)`: the targets of the words, separated by blanks. */
function setExpression(st: State, t: Lexeme, env: ReadonlySet<string>): void {
  st.out.push({ start: t.start, end: t.end, kind: 'keyword', explanation: st.s('かっこの中の語（空白で区切る。`,` ではない）のターゲットを合わせたもの', 'The targets of the words in its parentheses, separated by blanks (not commas)'), children: [] });
  const open = expect(st, '(');
  st.open.push(open);
  for (let w = next(st); w.kind !== ')'; w = next(st)) {
    if (w.kind !== 'word') unexpected(st, w);
    word(st, w, env);
  }
  st.open.pop();
}

/** A word where an expression goes: a variable bound by `let`, or a target pattern. */
function word(st: State, t: Lexeme, env: ReadonlySet<string>): void {
  const s = st.s;
  const { value } = t;
  // (The whole word is a value: bazel reads the value as the query language.)
  if (!t.quoted && value.length === 1 && isHole(value)) {
    st.out.push(holeToken(t.start, 'query-word'));
    return;
  }
  if (value.startsWith('$') && hasHole(value)) {
    st.out.push(holeStop(t.start));
    return;
  }
  if (VARIABLE.test(value)) {
    const name = value.slice(1);
    if (env.has(name)) st.out.push({ start: t.start, end: t.end, kind: 'variable', explanation: s(`\`let\` で変数 \`${name}\` に入れたターゲット`, `The targets \`let\` bound to the variable \`${name}\``), children: [] });
    else flag(st, t.start, t.end, s(`変数 \`${name}\` を入れる \`let\` がこの外にない`, `No \`let\` around this binds \`${name}\``), `undefined variable '${name}'`);
    return;
  }
  // (Quoted too: bazel checks the word's text.)
  if (value.startsWith('*')) fail(st, t.start, t.end, s('ターゲットのパターンは `*` で始められない（`:*` は書ける）', 'A target pattern cannot start with `*` (`:*` can)'), 'target literal must not begin with (*)');
  const r = explainTargetPattern(value, st.lang, st.flavor, !t.quoted);
  const at = t.quoted ? 1 : 0;
  // (A value where the reading starts: the pattern depends on it.)
  if (hasHole(value) && (!r || (!r.tokens.length && !r.note))) {
    st.out.push(holeStop(t.start));
    return;
  }
  const parts = shift(r?.tokens ?? [], t.start + at);
  st.out.push({ start: t.start, end: t.end, kind: 'string', explanation: r?.note ?? s('ターゲットのパターン', 'A target pattern'), children: parts });
}

/** A function and its arguments, as the function takes them. */
function call(st: State, name: Lexeme, env: ReadonlySet<string>): void {
  const s = st.s;
  const f = name.value;
  if (hasHole(f)) {
    st.out.push(holeStop(name.start));
    throw new Stop();
  }
  const known = KNOWN[st.command].includes(f) || (st.command === 'query' && st.line.universe && UNIVERSE.includes(f));
  const fn = FUNCTIONS[f] as QueryFunction | undefined;
  if (!known || !fn) {
    const why = !fn ? s(`\`bazel ${st.command}\` に関数 ${codeSpan(f)} はない`, `\`bazel ${st.command}\` has no function ${codeSpan(f)}`)
      : UNIVERSE.includes(f) ? (st.command === 'query'
        ? s(`${codeSpan(f)} は \`--universe_scope\` か \`--infer_universe_scope\` を付けたときだけ使える`, `${codeSpan(f)} is there only with \`--universe_scope\` or \`--infer_universe_scope\``)
        : s(`${codeSpan(f)} は \`bazel query\` の関数で、\`bazel ${st.command}\` にはない`, `${codeSpan(f)} is a function of \`bazel query\`, not of \`bazel ${st.command}\``))
        : f === 'config' ? s('`config` は `bazel cquery` だけの関数', '`config` is a function of `bazel cquery` only')
          : s(`${codeSpan(f)} は \`bazel aquery\` だけの関数`, `${codeSpan(f)} is a function of \`bazel aquery\` only`);
    fail(st, name.start, name.end, why, `unknown function '${f}'`);
  }
  const refused = REFUSED[st.command][f];
  if (refused) flag(st, name.start, name.end, s(`${codeSpan(f)} は \`bazel ${st.command}\` では使えない（構成を適用した後のグラフにはない）`, `\`bazel ${st.command}\` refuses ${codeSpan(f)} (the configured graph has nothing for it)`), refused);
  else st.out.push({ start: name.start, end: name.end, kind: 'function', explanation: s(...fn.text), children: [] });
  const open = expect(st, '(');
  st.open.push(open);
  let seen = 0;
  for (;;) {
    const t = peek(st);
    if (!t) prematureEnd(st);
    if (t.kind === ')') {
      if (seen < fn.needs) fail(st, t.start, t.end, s(`${codeSpan(f)} の引数が足りない`, `Too few arguments for ${codeSpan(f)}`), `too few arguments to function '${f}'`);
      st.k++;
      break;
    }
    if (seen > 0) {
      if (t.kind !== ',') unexpected(st, t);
      if (seen >= fn.args.length && !fn.more) fail(st, t.start, t.end, s(`${codeSpan(f)} の引数が多すぎる`, `Too many arguments for ${codeSpan(f)}`), `too many arguments to function '${f}'`);
      st.k++;
    }
    argument(st, fn.args[Math.min(seen, fn.args.length - 1)], env);
    seen++;
  }
  st.open.pop();
  // (aquery's filters: one argument only with `--skyframe_state`, which this reading does not follow.)
  if (seen < 2 && (f === 'inputs' || f === 'outputs' || f === 'mnemonic')) {
    flag(st, name.start, name.end, s(`${codeSpan(f)} の引数は2つ（パターンと式）`, `${codeSpan(f)} takes two arguments, a pattern and an expression`), 'must have exactly 2 arguments');
  }
}

function argument(st: State, arg: Arg, env: ReadonlySet<string>): void {
  if (arg.kind === 'expr') return expression(st, env);
  const t = next(st);
  if (t.kind !== 'word') unexpected(st, t);
  const s = st.s;
  const [ja, en] = arg.text!;
  if (arg.kind === 'int') {
    if (hasHole(t.value)) st.out.push(holeStop(t.start));
    else if (!/^\d+$/.test(t.value) || Number(t.value) > INT_MAX) fail(st, t.start, t.end, s('ここには0以上の整数を書く', 'A whole number goes here, 0 or more'), 'expected an integer literal');
    else st.out.push({ start: t.start, end: t.end, kind: 'number', explanation: s(ja, en), children: [] });
    return;
  }
  if (arg.kind === 'word') {
    if (hasHole(t.value)) st.out.push(holeStop(t.start));
    else st.out.push({ start: t.start, end: t.end, kind: 'string', explanation: s(ja, en), children: [] });
    return;
  }
  // (A regex: Java's, which the PCRE reader reads; a value in an unquoted word could end the word, which it does not say.)
  if (hasHole(t.value) && !t.quoted) {
    st.out.push(holeStop(t.start));
    return;
  }
  const children = shift(explainRegex(t.value, 'pcre', st.lang, { unit: 'text' }), t.start + (t.quoted ? 1 : 0));
  st.out.push({ start: t.start, end: t.end, kind: 'pattern', explanation: s(ja, en), children });
}

/** Read a query expression: its tokens, and the mistakes bazel stops at (each an error token too). */
export function readQuery(src: string, command: QueryCommand, line: QueryLine, lang: Lang, flavor: TargetFlavor): { tokens: EmbeddedToken[]; errors: QueryError[] } {
  const st: State = { src, toks: lex(src), k: 0, command, line, lang, s: pick(lang), flavor, out: [], errors: [], open: [] };
  try {
    // (bazel reads the whole text into tokens first: a quote left open is said before any other mistake.)
    const unclosed = st.toks.find((t) => t.unclosed);
    if (unclosed) unexpected(st, unclosed);
    expression(st, new Set());
    const rest = peek(st);
    if (rest) unexpected(st, rest, true);
  } catch (e) {
    /* c8 ignore next */
    if (!(e instanceof Stop)) throw e;
  }
  return { tokens: st.out, errors: st.errors };
}

/**
 * Explain the expression of `bazel query`, `cquery` or `aquery` given as one word. An expression that is one target pattern
 * says what it selects, as the pattern's reader does (`bazel query //app/...`); undefined for an empty text.
 */
export function explainQuery(src: string, command: QueryCommand, line: QueryLine, lang: Lang, flavor: TargetFlavor): { tokens: EmbeddedToken[]; note?: string } | undefined {
  const toks = lex(src);
  if (!toks.length) return undefined;
  // (One unquoted word that is no variable: a target pattern, said on the word.)
  const [only] = toks;
  if (toks.length === 1 && only.kind === 'word' && !only.quoted && !only.value.startsWith('$') && !only.value.startsWith('*') && !(only.value.length === 1 && isHole(only.value))) {
    return explainTargetPattern(src, lang, flavor, true) ?? { tokens: readQuery(src, command, line, lang, flavor).tokens };
  }
  return { tokens: readQuery(src, command, line, lang, flavor).tokens };
}
