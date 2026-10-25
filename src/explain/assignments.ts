// Assignments (docs/design/analyzer.md, step 7): `a=1`, `a+=x`, `a[i]=v`, `a=(…)`, as a command of their own (with
// the redirections around them) or as a word that a declaration builtin reads (`local -n r=$1`); what each does with
// the attributes the variable has here (an integer, a nameref, an associative array: src/semantics/state.ts), and
// what `IFS` is for.
import type { Token } from '../analyzer-types';
import { evalArith } from '../arith';
import { hasGlob } from '../embedded/glob';
import { shorten } from '../label';
import { spanOf } from '../noteanchors';
import { nodeSections } from '../refs';
import { attribute, docLine } from '../semantics/state';
import { isPlainWord, staticWordValue } from '../staticword';
import { assignmentSpan, field, type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';
import { skeletal } from './nodes';
import { isAssoc, wordAt } from './reads';
import { redirectedWhole } from './redirections';
import { arithNumber, notGlobbedHere, shown } from './words';

/**
 * A command with no name: its assignments (`a=1`, `a=1 b=2`), and any redirections between them; redirections
 * before the first or after the last (`a=1 2>/dev/null`, `>f`) apply to them as a whole.
 */
export function assignments(cx: Explainer, n: SyntaxNode): Token {
  const { inner, outer } = assignmentSpan(n);
  if (!outer.length) return assignmentList(cx, n, inner);
  const text = inner.length ? n.text.slice(inner[0].startIndex - n.startIndex, inner[inner.length - 1].endIndex - n.startIndex) : undefined;
  const body = inner.length ? [assignmentList(cx, n, inner)] : [];
  return redirectedWhole(cx, n, inner[0], text, body, outer.filter((c) => c.children.length));
}

/** The assignments of a command with no name (and the redirections between them): one, or a token for all. */
function assignmentList(cx: Explainer, n: SyntaxNode, inner: SyntaxNode[]): Token {
  const [only, ...rest] = inner;
  if (!rest.length) {
    const t = skeletal(assignment(cx, only), only, true);
    return { ...t, refs: t.refs ?? nodeSections(only) };
  }
  const t = cx.tok(n, 'assignment', cx.s('複数の変数への代入', 'Several variable assignments'), cx.subs(inner));
  t.refs = nodeSections(only);
  if (inner.length === n.namedChildren.length) return t;
  // (Redirections outside them: the token is the assignments' only.)
  const last = rest[rest.length - 1];
  return { ...t, span: { start: spanOf(only).start, end: spanOf(last).end }, label: shorten(n.text.slice(only.startIndex - n.startIndex, last.endIndex - n.startIndex)) };
}

/** An assignment; `decl`: an argument of a declaration that makes the name a nameref (`local -n r=$1`). */
export function assignment(cx: Explainer, n: SyntaxNode, decl = false): Token {
  const name = field(n, 'name')!;
  const value = field(n, 'value');
  const op = n.children.find((c) => !c.named && (c.type === '=' || c.type === '+='))!.type;
  const nm = name.text;
  let expl = op === '+='
    ? cx.s(`変数 \`${nm}\` に値を追記する（配列なら要素を追加）`, `Append to variable \`${nm}\` (adds elements for arrays)`)
    : value
      ? (n.parent?.type === 'c_style_for_statement' ? cx.s(`変数 \`${nm}\` に算術式の値を代入する（算術式の中なので、\`=\` の前後に空白を入れてよい）`, `Assign the value of the arithmetic expression to variable \`${nm}\` (in arithmetic, spaces around \`=\` are allowed)`) : cx.s(`変数 \`${nm}\` に値を代入する（\`=\` の前後に空白は入れられない）`, `Assign a value to variable \`${nm}\` (no spaces around \`=\`)`))
      : cx.s(`変数 \`${nm}\` に空文字を代入する`, `Set variable \`${nm}\` to the empty string`);
  // `local -n r=$1` makes `r` another name for the variable named by `$1`; every later `r=…` then sets that variable.
  // (In a declaration, the state has the attributes it gives: they apply before the value is assigned.)
  const st = cx.state.at(n).run;
  const ref = st.variables.get(nm)?.attrs.n;
  if (decl && value) {
    expl = cx.s(`\`${nm}\` は参照（nameref）になる: 値 \`${value.text}\` を名前とする変数の別名で、\`${nm}\` への代入や参照は、その変数に対して行われる`,
      `\`${nm}\` becomes a nameref: another name for the variable whose name is the value \`${value.text}\`; assigning to or reading \`${nm}\` then acts on that variable`);
  } else if (!decl && ref?.state === 'on' && op === '=') {
    expl += cx.s(`。ただし \`${nm}\` は行 ${(docLine(ref.at) + 1)} で nameref として宣言されているので、参照先の変数に代入される`,
      `. But \`${nm}\` is declared a nameref on line ${(docLine(ref.at) + 1)}, so this sets the variable it points to`);
  }
  // An integer variable (`declare -i n`) takes the value of an arithmetic expression, and `+=` adds.
  const integer = name.type !== 'subscript' && value && value.type !== 'array' && attribute(st, nm, 'i') === 'on';
  let intValueText: string | undefined;
  if (integer) {
    const v = evalArith(value.text);
    const calc = v === undefined || String(v) === value.text.trim() ? '' : ` = ${v}`;
    intValueText = cx.s(`算術式として計算される${calc}`, `Evaluated as an arithmetic expression${calc}`);
    expl = op === '+='
      ? cx.s(`整数変数 \`${nm}\` に値を足す（\`-i\` が付いているので文字列の連結ではなく算術式の足し算になる。\`${nm}\` が 7 なら \`+=1\` で 8 であり、71 ではない）`,
        `Add to the integer variable \`${nm}\` (it has \`-i\`, so this adds instead of appending text: if \`${nm}\` is 7, \`+=1\` makes 8, not 71)`)
      : cx.s(`整数変数 \`${nm}\` に値を代入する（\`-i\` が付いているので、値は算術式として計算される）`,
        `Assign to the integer variable \`${nm}\` (it has \`-i\`, so the value is evaluated as arithmetic)`);
  }
  if (name?.type === 'subscript') {
    const arr = field(name, 'name')!.text;
    const idx = field(name, 'index')!.text;
    const v = evalArith(idx);
    const add = op === '+=';
    // With `declare -i`, `+=` on an element adds numbers; otherwise it appends text to the element.
    const toInt = add && attribute(st, arr, 'i') === 'on';
    const verb = (set: string, plus: string, plusInt: string): string => (toInt ? plusInt : add ? plus : set);
    if (isAssoc(cx, arr, n)) {
      const key = cx.s(`連想配列 \`${arr}\` のキー \`${idx}\`（文字列で、計算はされない）の要素`, `the element of associative array \`${arr}\` with the key \`${idx}\` (a string, not evaluated)`);
      expl = cx.s(`${key}${verb('に代入する', 'に値を追記する（文字列の連結）', 'に値を足す（`-i` が付いているので算術式の足し算）')}`,
        `${verb('Assign to ', 'Append to ', 'Add to ')}${key}${add && !toInt ? ' (text is appended to the existing value)' : toInt ? ' (it has `-i`, so this adds numbers)' : ''}`);
    } else {
      const el = v !== undefined && String(v) !== idx
        ? cx.s(`配列 \`${arr}\` の要素 \`[${idx}]\`（算術式として計算すると ${v}）`, `element \`[${idx}]\` of array \`${arr}\` (an arithmetic expression: ${v})`)
        : cx.s(`配列 \`${arr}\` の要素 \`[${idx}]\``, `element \`[${idx}]\` of array \`${arr}\``);
      expl = cx.s(`${el}${el.endsWith('`') ? ' ' : ''}${verb('に代入する', 'に値を追記する（文字列の連結。`b` に `x` を足すと `bx`）', 'に値を足す（`-i` が付いているので算術式の足し算。7 に `+=1` で 8）')}`,
        `${verb('Assign to ', 'Append to ', 'Add to ')}${el}${add && !toInt ? ' (text is appended to the existing value: `b` plus `x` is `bx`)' : toInt ? ' (it has `-i`, so this adds numbers: 7 plus `+=1` is 8)' : ''}`);
    }
  }
  // `IFS` is the list of characters word splitting, `read` and `"${a[*]}"` use as separators.
  if (nm === 'IFS' && name?.type !== 'subscript' && !(n.parent?.type === 'command' && field(n.parent, 'name')?.text)) {
    const v = value ? staticWordValue(value) : '';
    expl += v === undefined
      ? cx.s('。`IFS` は単語分割（と `read`）が区切りに使う文字の一覧で、`"${a[*]}"` と `"$*"` が要素をつなぐ文字（先頭の1文字）でもある', '. `IFS` lists the characters word splitting and `read` split on, and its first character joins the elements in `"${a[*]}"` and `"$*"`')
      : v === ''
        ? cx.s('。`IFS` が空だと単語分割がされなくなる（`"${a[*]}"` と `"$*"` の要素は区切りなしでつながる）', '. An empty `IFS` turns word splitting off (the elements of `"${a[*]}"` and `"$*"` are joined with nothing between them)')
        : cx.s(`。\`IFS\` は単語分割（と \`read\`）が区切りに使う文字の一覧: これ以降、クォートしない展開は \`${shown(v)}\` で分割される。\`"\${a[*]}"\` と \`"$*"\` は先頭の文字 \`${shown(v[0])}\` で要素をつなぐ`,
          `. \`IFS\` lists the characters word splitting (and \`read\`) split on: from here, unquoted expansions are split on \`${shown(v)}\`. \`"\${a[*]}"\` and \`"$*"\` join their elements with the first character, \`${shown(v[0])}\``);
  }
  const children: Token[] = [];
  if (value) {
    // (A `~` that bash expands keeps its own explanation: `x=~` is the home directory.)
    for (const t of cx.sub(value)) {
      if (!(t.kind === 'expansion' && wordAt(cx, value)?.tildes.length) && isPlainWord(value) && !arithNumber(cx, value)) t.explanation = intValueText ? `\`${value.text}\`: ${intValueText}` : cx.s(`代入する値 \`${value.text}\``, `Value \`${value.text}\``) + (hasGlob(value.text) ? notGlobbedHere(cx, value) : '');
      children.push(t);
    }
  }
  return cx.tok(n, 'assignment', expl, children);
}
