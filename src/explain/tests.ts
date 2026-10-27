// The explanation of tests (docs/design/analyzer.md, step 5): `[[ ]]` and `(( ))`, the unary, binary and ternary
// expressions in them and in arithmetic, the right side of `=~` (an ERE), and the expression of `[ ]` and `test`
// as bash reads it (src/testexpr.ts; the words of the command itself are argv's, which calls `testTokens`). The
// examples of a test (values that make it true, that match a pattern or a regex) come from src/explain/examples.ts.
import type { Kind, Token } from '../analyzer-types';
import { arithLiteral, evalArith, invalidLiteral } from '../arith';
import { DEFAULT_BASH_VERSION } from '../bashversion';
import { binaryTestOps, collationTexts, extendedEqualOps, unaryTestOps } from '../dict/syntax';
import { hasGlob } from '../embedded/glob';
import { explainRegex } from '../embedded/regex';
import { toJsRegex } from '../examples/regex';
import { shorten } from '../label';
import { fact } from '../messages';
import { spanOf } from '../noteanchors';
import { expressionHost } from '../refs';
import { option, type ShellState } from '../semantics/state';
import { isPlainWord, staticWordValue } from '../staticword';
import { ancestor, descendants, field, fields, type SyntaxNode } from '../syntax/tree';
import { type BracketTest, collation, type TestExpr, testRange } from '../testexpr';
import type { Explainer } from './context';
import { matchExample, regexExample, testExample } from './examples';
import { fromEmbedded, same, skeletal, sortTokens } from './nodes';
import { inArithmetic } from './reads';
import { postfixStatusNote } from './status';
import { arithChildren, arithNumber, commaNote, globToken } from './words';

/**
 * The text of the binary operator `op` of a test at `n`: for `<` and `>` in bash, with how they compare there
 * (`collation`: `[[ ]]` when `double`, else the builtin `test` and `[`; `builtin`, false for the program, which GNU
 * coreutils' `test` is: it has no `<` nor `>`, checked with coreutils 9.4).
 */
function binaryText(cx: Explainer, n: SyntaxNode, op: string, double: boolean, builtin: boolean): string {
  if (op !== '<' && op !== '>') return cx.t(binaryTestOps[op]);
  if (!builtin) {
    return cx.s(`${cx.t(binaryTestOps[op])}。ただし GNU coreutils の \`test\` にこの演算子はなく、「binary operator expected」のエラーになる（終了ステータス 2）`,
      `${cx.t(binaryTestOps[op])}. But GNU coreutils' \`test\` has no such operator: it says "binary operator expected" (status 2)`);
  }
  if (cx.shell && cx.shell !== 'bash') return cx.t(binaryTestOps[op]);
  const st = cx.state.at(n).run;
  const on = (kind: 'set' | 'shopt', name: string): 'on' | 'off' | 'unknown' => {
    const v = option(st, kind, name);
    return v === 'default' ? 'off' : v;
  };
  // (Level 4.0 or lower: `compat31`, `compat32` or `compat40`, or `BASH_COMPAT` of 4.0 or lower: `40`, `4.0`, `31`…;
  // another value keeps the current level.)
  const levels = [...['compat31', 'compat32', 'compat40'].map((o) => on('shopt', o)), compatVariable(st)];
  const c = collation(double, cx.opts.bashVersion ?? DEFAULT_BASH_VERSION, on('set', 'posix'), levels.includes('on') ? 'on' : levels.includes('unknown') ? 'unknown' : 'off');
  const how = cx.t(collationTexts[c.why ? `${c.order} ${c.why}` : c.order]);
  return op === '<' ? cx.s(`辞書順で左が小さい。${how}`, `sorts before, ${how}`) : cx.s(`辞書順で左が大きい。${how}`, `sorts after, ${how}`);
}

/** Whether `BASH_COMPAT` in `st` sets level 4.0 or lower (checked with bash 5.2 and 5.3: `40`, `4.0`, `31`, `3.2`). */
function compatVariable(st: ShellState): 'on' | 'off' | 'unknown' {
  const v = st.variables.get('BASH_COMPAT');
  if (!v || v.set === 'off') return 'off';
  if (v.set === 'unknown' || v.value === undefined) return 'unknown';
  const m = /^(\d)\.?(\d)$/.exec(v.value);
  return m && Number(m[1] + m[2]) <= 40 ? 'on' : 'off';
}

function arithTestExplanation(cx: Explainer): string {
  return cx.s('算術評価 `(( ))`: 式を計算し、結果が 0 以外なら成功(0)を返す', 'Arithmetic evaluation `(( ))`: succeeds if the result is non-zero');
}

export function test(cx: Explainer, n: SyntaxNode): Token {
  // Includes examples from inside the test, such as the regex of `=~`.
  return cx.examplesOf(n, () => {
    // A test over several lines is explained whole (see sub), so it is always where the line starts.
    const open = n.children[0].type;
    testExample(cx, n, undefined);
    const expl = open === '[['
      ? cx.s('拡張条件式 `[[ ]]`: 条件を評価し、真なら成功(0)を返す（bash 専用。コマンドではなくシェルの構文なので、中で単語分割・グロブ展開が起きず、変数をクォートしなくても安全。`&&` `||` `<` `=~` も使える）',
        'Extended test `[[ ]]`: evaluates a condition (bash-only; shell syntax, not a command, so there is no word splitting or globbing inside and variables are safe unquoted; `&&`, `||`, `<` and `=~` work too)')
      : arithTestExplanation(cx) + commaNote(cx, n);
    const children = open === '((' ? arithChildren(cx, n) : cx.subs(n.namedChildren);
    // (No badge on `[[`: its kind, a test, says what it is; the badge is for `time`, which has another meaning.)
    const t = cx.tok(n, 'test', expl, children);
    t.summary = cx.s(`条件判定 ${shorten(n.text, 40)}`, `test ${shorten(n.text, 40)}`);
    skeletal(t, n, true);
    return t;
  });
}

/**
 * The tokens of a `[ ]` test read as bash reads it (see testexpr.ts). `refs`: the sections of each expression, for
 * bash's builtin (4.1, and 6.4 for the primaries).
 */
export function testTokens(cx: Explainer, n: SyntaxNode, b: BracketTest, e: TestExpr, refs?: readonly string[]): Token[] {
  const words = b.words;
  const slice = (from: number, to: number) => n.text.slice(words[from].nodes[0].startIndex - n.startIndex, words[to].nodes[words[to].nodes.length - 1].endIndex - n.startIndex);
  const [first, last] = testRange(e);
  const make = (kind: Kind, explanation: string, children: Token[]): Token => ({
    kind, label: shorten(slice(first, last)), explanation, children, ...(refs ? { refs } : {}),
    span: { start: spanOf(words[first].nodes[0]).start, end: spanOf(words[last].nodes[words[last].nodes.length - 1]).end },
  });
  // Operators and parentheses are not nodes to explain; they get no token of their own, but a word that is one does.
  const wordTokens = (i: number) => words[i].nodes.flatMap((x) => cx.sub(x));
  const operandTokens = (i: number, plain: (x: SyntaxNode) => boolean) => cx.subs(words[i].nodes.filter((x) => !plain(x)));
  switch (e.type) {
    case 'word': return wordTokens(e.at);
    case 'not': {
      const [from, to] = testRange(e.operand);
      return [make('test', cx.s(`否定: \`${slice(from, to)}\` が偽なら真`, `Negation: true if \`${slice(from, to)}\` is false`), testTokens(cx, n, b, e.operand, refs))];
    }
    case 'group': {
      // (bash 5.3 takes the truth of a group of one word from the first word of the test: `TestExpr`, `truth`.)
      const inner = e.inner;
      const odd = inner.type === 'word' && inner.truth !== undefined
        ? cx.s(`。ただし bash 5.3 はここで \`${slice(inner.at, inner.at)}\` ではなく、式の最初の語 \`${slice(inner.truth, inner.truth)}\` が空でないかを調べる（bash 5.3 の不具合）`,
          `. But bash 5.3 tests here whether the first word of the test, \`${slice(inner.truth, inner.truth)}\`, is not empty, not \`${slice(inner.at, inner.at)}\` (a bug of bash 5.3)`)
        : '';
      return [make('operator', cx.s('括弧でまとめた式', 'Parenthesized expression') + odd, testTokens(cx, n, b, inner, refs))];
    }
    case 'unary': {
      const d = unaryTestOps[words[e.op].text!];
      return [make('test', cx.s(`条件: \`${slice(e.arg, e.arg)}\` が${cx.t(d)}`, `Condition: \`${slice(e.arg, e.arg)}\` ${cx.t(d)}`), operandTokens(e.arg, isPlainWord))];
    }
    case 'binary': {
      const op = words[e.op].text!;
      const num = numericTestNote(cx, op, [slice(e.left, e.left), slice(e.right, e.right)], false);
      // (`refs`: bash's builtin, or another shell's.)
      const text = binaryText(cx, n, op, false, !!refs);
      return [make('test', cx.s(
        `条件: \`${slice(e.left, e.left)}\` と \`${slice(e.right, e.right)}\` を比較 — ${text}${num}`,
        `Condition: \`${slice(e.left, e.left)}\` vs \`${slice(e.right, e.right)}\` — ${text}${num}`,
      ), [...operandTokens(e.left, isPlainWord), ...operandTokens(e.right, isPlainWord)])];
    }
    default:
      return [make('test', cx.t(binaryTestOps[e.type === 'and' ? '-a' : '-o']), [...testTokens(cx, n, b, e.left, refs), ...testTokens(cx, n, b, e.right, refs)])];
  }
}

/**
 * How `-eq`, `-lt`… read their operands: `[ ]` takes decimal integers (`010` is ten, `08` eight; `0x10` is an error),
 * `[[ ]]` evaluates them as arithmetic (`010` is octal 8, `0x10` is 16, `08` is an error).
 */
function numericTestNote(cx: Explainer, op: string, operands: string[], double: boolean): string {
  if (!/^-(?:eq|ne|lt|le|gt|ge)$/.test(op)) return '';
  const notes: string[] = [];
  for (const raw of operands) {
    const m = /^([-+]?)(\d[0-9A-Za-z@_#]*)$/.exec(raw);
    const lit = m ? arithLiteral(m[2]) : undefined;
    if (!lit && !double && /^[\w+\-/%.,:^]+$/.test(raw) && !/^[-+]?\d+$/.test(raw)) {
      // A word written out in full that is no integer (`1+1`, `1.5`, `x`): `[` and `test` do not calculate.
      const v = evalArith(raw);
      notes.push(cx.s(`\`[ ]\` の ${op} は整数しか読めないので \`${raw}\` はエラー（integer expression expected）。\`[[ ]]\` なら算術として読める${v === undefined ? '' : `（${v}）`}`,
        `\`[ ]\` reads only integers for ${op}, so \`${raw}\` is an error (integer expression expected); \`[[ ]]\` would read it as arithmetic${v === undefined ? '' : ` (${v})`}`));
      continue;
    }
    if (!lit && double && /^[\d\s+\-*/%()]+$/.test(raw) && !/^\s*[-+]?\d+\s*$/.test(raw)) {
      // An arithmetic expression of constants (`1+1`): `[[ ]]` calculates it.
      const v = evalArith(raw);
      if (v !== undefined) notes.push(cx.s(`\`[[ ]]\` の ${op} は算術として読むので \`${raw}\` は ${v}`, `\`[[ ]]\` reads ${op} operands as arithmetic, so \`${raw}\` is ${v}`));
      continue;
    }
    if (!lit || (lit.type === 'number' && lit.style === 'decimal' && !/^0\d/.test(m![2]))) continue;
    // (Why arithmetic rejects it: `08` with a leading 0 is octal, `1e3` has a letter, `0#1` a base starting with 0.)
    const bad = lit.type === 'invalid' ? invalidLiteral(m![2], lit, cx.lang) : undefined;
    if (!double) {
      // (Digits alone are decimal to `[`, even those arithmetic rejects as octal: `08` is 8, `-08` is -8.)
      const dbl = bad
        ? cx.s(`。\`[[ ]]\` の算術でもエラー（${bad.message}）`, `; \`[[ ]]\` rejects it too, as arithmetic (${bad.message})`)
        : cx.s('。`[[ ]]` なら算術として読める', '; `[[ ]]` would read it as arithmetic');
      notes.push(/^\d+$/.test(m![2])
        ? cx.s(`\`[ ]\` は 10 進の整数として読むので \`${raw}\` は ${Number(raw)}（8 進数ではない）`, `\`[ ]\` reads decimal integers, so \`${raw}\` is ${Number(raw)} (not octal)`)
        : cx.s(`\`[ ]\` は 10 進の整数しか読めないので \`${raw}\` はエラー（integer expression expected）${dbl}`, `\`[ ]\` reads only decimal integers, so \`${raw}\` is an error (integer expression expected)${dbl}`));
    } else if (lit.type === 'invalid') {
      notes.push(cx.s(`\`[[ ]]\` は算術として読むが、\`${raw}\` は数として正しくない（${bad!.why}）のでエラー（${bad!.message}）`, `\`[[ ]]\` reads arithmetic, where \`${raw}\` is no valid number (${bad!.why}): an error (${bad!.message})`));
    } else {
      const kind = { octal: cx.s('8 進数', 'octal'), hex: cx.s('16 進数', 'hexadecimal'), based: cx.s(`${lit.base} 進数`, `base ${lit.base}`), decimal: '' }[lit.style];
      notes.push(cx.s(`\`[[ ]]\` の ${op} は算術として読むので \`${raw}\` は ${kind}で ${m![1] === '-' ? '-' : ''}${lit.value}`, `\`[[ ]]\` reads ${op} operands as arithmetic, so \`${raw}\` is ${kind} ${m![1] === '-' ? '-' : ''}${lit.value}`));
    }
  }
  return notes.length ? cx.s('。', '. ') + notes.join(cx.s('。', '. ')) : '';
}

/** The right side of `[[ x =~ re ]]` (an ERE) is broken down; other `regex` nodes are glob-like patterns. */
export function regexNode(cx: Explainer, n: SyntaxNode): Token {
  // (A `regex` node is only the plain right side of `=~`, without quotes: expansions and quotes make other nodes.)
  const { text, offsets } = regexText(n);
  // (The regex is read by the regex library bash calls, by the rules of an ERE: an embedded language.)
  const tokens = explainRegex(text, 'ere', cx.lang).map((t) => ({ ...fromEmbedded(t, n, { text, offsets }, 'embedded'), language: 'regex' }));
  const js = toJsRegex(text, 'ere');
  const dropped = [...new Set([...n.text.matchAll(/\\([bBwWsSdD<>])/g)].filter((m) => text !== n.text).map((m) => '\\' + m[1]))];
  if (dropped.length) {
    const list = dropped.map((d) => `\`${d}\``).join(cx.s('、', ', '));
    cx.note(fact(cx.lang, 'regex-backslash-dropped', { list }), n);
  }
  // (A part of a right side with quotes or expansions: the example is the whole regex's, made by `binary`.)
  if (js && n.parent?.type !== 'concatenation') regexExample(cx, js, 'values', field(n.parent!, 'left')!);
  return cx.tok(n, 'pattern', cx.s('正規表現（拡張正規表現 ERE）', 'Regular expression (extended, ERE)'), tokens);
}

/**
 * The regex a `regex` node gives after quote removal, with the offset in the node of each of its characters. Quote
 * removal drops a backslash before an ordinary character: `\b` is `b`, `\w` is `w`, `\<` is `<` (bash), not the GNU
 * operators. One before a character special in an ERE stays, and makes it literal.
 */
function regexText(n: SyntaxNode): { text: string; offsets: number[] } {
  let text = '';
  const offsets: number[] = [];
  for (let i = 0; i < n.text.length; i++) {
    if (n.text[i] === '\\' && i + 1 < n.text.length && !/[.[\]{}()\\*+?|^$]/.test(n.text[i + 1])) i++;
    offsets.push(i);
    text += n.text[i];
    if (n.text[i] === '\\' && i + 1 < n.text.length) { offsets.push(++i); text += n.text[i]; }
  }
  return { text, offsets };
}

/**
 * The regex bash matches for a right side of `=~` made of parts (`^"a."c$`): the quoted parts match as literal text,
 * so their special characters are escaped. Undefined when a part is not known without running anything (`$re`).
 */
function wholeRegex(parts: readonly SyntaxNode[]): string | undefined {
  let out = '';
  for (const p of parts) {
    if (p.type === 'regex') {
      out += regexText(p).text;
      continue;
    }
    const v = QUOTED_PARTS.has(p.type) ? staticWordValue(p) : undefined;
    if (v === undefined) return undefined;
    out += v.replace(/[.[\]{}()\\*+?|^$]/g, '\\$&');
  }
  return out;
}
const QUOTED_PARTS = new Set(['string', 'raw_string', 'ansi_c_string']);

export function unary(cx: Explainer, n: SyntaxNode): Token {
  // `!` is not an operator field.
  const opNode = field(n, 'operator')!;
  const op = opNode.text;
  const operand = n.namedChildren.find((c) => !same(c, opNode));
  // `[[ $a && -n` while typing: the operand is not written yet.
  if (!operand) {
    return cx.tok(n, 'test', cx.s(`単項演算 \`${op}\`: 対象がまだ書かれていない`, `Unary operator \`${op}\`: the operand is not written yet`));
  }
  if (op === '!' && !inArithmetic(n)) {
    return cx.tok(n, 'test', cx.s(`否定: \`${operand.text}\` が偽なら真`, `Negation: true if \`${operand.text}\` is false`), cx.sub(operand));
  }
  const d = unaryTestOps[op];
  if (d && !inArithmetic(n)) {
    return cx.tok(n, 'test', cx.s(`条件: \`${operand.text}\` が${cx.t(d)}`, `Condition: \`${operand.text}\` ${cx.t(d)}`), cx.subs([operand].filter((x) => !isPlainWord(x))));
  }
  return cx.tok(n, 'operator', cx.s(`算術の単項演算 \`${op}\``, `Arithmetic unary operator \`${op}\``), cx.subs(n.namedChildren));
}

export function binary(cx: Explainer, n: SyntaxNode): Token {
  const left = field(n, 'left');
  // The right side of `=`, `==` and `!=` in `[[ ]]` can be several fields: `*"$y"*z` is a pattern, a string and a pattern.
  // (The binary expression in `${s:$i+1}` has no fields at all.)
  const rightFields = fields(n, 'right');
  const rights = rightFields.length ? rightFields : [n.namedChildren[n.namedChildren.length - 1]];
  const rightText = n.text.slice(rights[0].startIndex - n.startIndex, rights[rights.length - 1].endIndex - n.startIndex);
  const op = field(n, 'operator')!.text;
  // `$((1 +))`, `((2 *))`: an operator with no operand after it, which the parser keeps. bash refuses the expression.
  if (inArithmetic(n) && !rightFields.length && left && rights[0].startIndex === left.startIndex) {
    return cx.tok(n, 'error', cx.s(
      `算術式の構文エラー: \`${op}\` の後ろに被演算子がない。bash は \`syntax error: operand expected\` と表示し${expressionHost(n) === 'arithmetic_expansion' ? '、それを含むスクリプトのコマンドの残り（この行、または囲む繰り返しや関数呼び出し）を中断する（終了ステータス 1。POSIX モードではスクリプトが終了する）' : '、このコマンドは失敗する（終了ステータス 1）'}`,
      `Arithmetic syntax error: \`${op}\` has no operand after it. bash says \`syntax error: operand expected\`${expressionHost(n) === 'arithmetic_expansion' ? ', and abandons the rest of the command of the script it is in (the line, or the loop or function call around it), status 1 (in POSIX mode, a script ends there)' : ', and the command fails (status 1)'}`));
  }
  // The grammar reads even a plain `a` after `=`, `==` and `!=` as a pattern; it is only a word to explain, and in `[ ]` any text is.
  // (A constant such as `0x1F` is not plain in arithmetic: it has a value to show.)
  const plain = (x: SyntaxNode) => (isPlainWord(x) && !(inArithmetic(n) && arithNumber(cx, x))) || (x.type === 'extglob_pattern' && rights.length === 1 && !hasGlob(x.text));
  // The grammar leaves some patterns as words (`*.txt`, `--?(a)b`, `-@(!(-*)e*|-edit)`); on the right of `==` in `[[ ]]` they are patterns all the same.
  const pattern = (x: SyntaxNode) => x.type === 'word' && ['=', '==', '!='].includes(op) && hasGlob(x.text) && !!ancestor(n, (a) => a.type === 'extended_test');
  const operands = sortTokens([
    ...cx.subs([left, ...rights].filter((x) => x && !plain(x) && !pattern(x))),
    ...rights.filter(pattern).map((x) => globToken(cx, x, 'value')),
  ]);
  // `[[ $x = *.txt ]]`: the values that match, as for a `case` pattern (a pattern with a quoted part is not tried).
  if (['=', '==', '!='].includes(op) && rights.length === 1 && (pattern(rights[0]) || (rights[0].type === 'extglob_pattern' && !plain(rights[0])))) {
    cx.examplesAt(n, () => matchExample(cx, n, rights[0]));
  }
  // `[[ $x =~ ^"a."c$ ]]`: the strings the whole regex matches, its quoted parts as literal text.
  if (op === '=~' && rights.length === 1 && rights[0].type === 'concatenation') {
    const re = wholeRegex(rights[0].namedChildren);
    const js = re === undefined ? undefined : toJsRegex(re, 'ere');
    if (js) regexExample(cx, js, 'values', left!);
  }
  if (!inArithmetic(n) && binaryTestOps[op]) {
    const num = numericTestNote(cx, op, [n.namedChildren[0].text, rightText], true);
    if (op === '&&' || op === '||' || op === '-a' || op === '-o') {
      return cx.tok(n, 'test', cx.t(binaryTestOps[op]), cx.subs([left, ...rights]));
    }
    const text = quotedPatternNote(cx, n, op, rights) ?? (extendedEqualOps[op] ? cx.t(extendedEqualOps[op]) : binaryText(cx, n, op, true, true));
    return cx.tok(n, 'test', cx.s(
      `条件: \`${left?.text}\` と \`${rightText}\` を比較 — ${text}${num}`,
      `Condition: \`${left?.text}\` vs \`${rightText}\` — ${text}${num}`,
    ), operands);
  }
  const assignOps = ['=', '+=', '-=', '*=', '/=', '%='];
  return cx.tok(n, 'operator', assignOps.includes(op)
    ? cx.s(`算術代入: \`${left?.text}\` ${op} \`${rightText}\``, `Arithmetic assignment: \`${left?.text}\` ${op} \`${rightText}\``)
    : cx.s(`算術演算: \`${left?.text}\` ${op} \`${rightText}\``, `Arithmetic: \`${left?.text}\` ${op} \`${rightText}\``), operands);
}

/**
 * In `[[ x == "*" ]]` and `[[ x =~ "a.c" ]]`, a quoted right side is plain text: quoting turns the pattern or the
 * regex off. Undefined when nothing is quoted.
 */
function quotedPatternNote(cx: Explainer, n: SyntaxNode, op: string, rights: SyntaxNode[]): string | undefined {
  const regex = op === '=~';
  if (!['=', '==', '!=', '=~'].includes(op) || !ancestor(n, (a) => a.type === 'extended_test')) return undefined;
  // (In a regex a backslash is no quoting: `a\.c` is the same regex as `a[.]c`.)
  const quoted = (x: SyntaxNode): boolean[] => {
    if (x.type === 'concatenation') return x.namedChildren.flatMap(quoted);
    if (['string', 'raw_string', 'ansi_c_string', 'translated_string'].includes(x.type)) return [true];
    return [!regex && x.text.includes('\\')];
  };
  const kinds = rights.flatMap(quoted);
  if (!kinds.some((q) => q)) return undefined;
  if (regex) {
    const pitfall = rights.some((x) => x.type === 'string' && descendants(x, ['simple_expansion', 'expansion']).length)
      ? cx.s('。正規表現を入れた変数は `"$re"` でなく `$re` とクォートせずに書く', '. A variable that holds a regex is written `$re`, not `"$re"`')
      : '';
    return (kinds.every((q) => q)
      ? cx.s('左辺が右辺の文字列をそのまま含めば真（右辺はクォートされているので正規表現ではなく文字列そのもの。`.` や `*` も普通の文字）',
        'true if the left side contains the right side as it is (the right side is quoted, so it is literal text, not a regex: `.` and `*` are plain characters)')
      : cx.s('左辺が右辺の正規表現(ERE)に一致すれば真（右辺のうちクォートされた部分は文字列そのまま、残りは正規表現）',
        'true if the left side matches the regex (ERE) on the right (the quoted parts of the right side are literal text, the rest is regex)'))
      + pitfall + cx.s('。一致結果は `BASH_REMATCH` に入る', '; captures go to `BASH_REMATCH`');
  }
  const equal = op !== '!=';
  return kinds.every((q) => q)
    ? cx.s(`文字列が${equal ? '等しい' : '等しくない'}（右辺はクォートされているので文字列そのもの。パターンとしては扱われない）`,
      `strings ${equal ? 'are equal' : 'differ'} (the right side is quoted, so it is literal text, not a pattern)`)
    : cx.s(`文字列が${equal ? '等しい' : '等しくない'}（右辺のうちクォートされた部分は文字列そのもの、残りはパターン）`,
      `strings ${equal ? 'are equal' : 'differ'} (the quoted parts of the right side are literal text, the rest is a pattern)`);
}

/** `a ? b : c` in arithmetic. */
export function ternary(cx: Explainer, n: SyntaxNode): Token {
  return cx.tok(n, 'expansion', cx.s('三項演算子: 条件 ? 真のときの値 : 偽のときの値', 'Ternary: cond ? if-true : if-false'), cx.subs(n.namedChildren));
}

/** `i++` and `i--` in arithmetic. */
export function postfix(cx: Explainer, n: SyntaxNode): Token {
  return cx.tok(n, 'operator', cx.s(`算術: \`${n.text}\`（${n.text.endsWith('++') ? '1 増やす' : '1 減らす'}）`, `Arithmetic: \`${n.text}\` (${n.text.endsWith('++') ? 'increment' : 'decrement'})`));
}

/** `( … )` in arithmetic. */
export function parenthesized(cx: Explainer, n: SyntaxNode): Token {
  return cx.tok(n, 'operator', cx.s('括弧でまとめた式', 'Parenthesized expression'), cx.subs(n.namedChildren));
}

/** `(( … ))` as a command, with the note on the status of a postfix `++` or `--`. */
export function arithmeticCommand(cx: Explainer, n: SyntaxNode): Token {
  postfixStatusNote(cx, n);
  return test(cx, n);
}
