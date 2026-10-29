// The explanation of words and the expansions in them (docs/design/analyzer.md, step 4): plain words and quoted
// strings, quote removal, brace and tilde expansion, globs and the options that change them, variables and what
// word splitting and globbing do to them, arrays and arithmetic. What a word does in its context comes from the
// model (src/semantics/words.ts, through src/explain/reads.ts); a `${…}` is src/expansion-tokens.ts, which reads
// the descriptions and notes of variables from here.
import type { Kind, Token } from '../analyzer-types';
import { type ArithLiteral, arithLiteral, describeArithLiteral, evalArith, evalArithWrapping } from '../arith';
import { DEFAULT_BASH_VERSION, earlier } from '../bashversion';
import { pictureList, visible } from '../ctlchars';
import { ordinal } from '../i18n';
import { ciVariables } from '../dict/ciVariables';
import { bash53Variables, specialVariables, wellKnownVariables } from '../dict/syntax';
import { explainGlob, globIntro, type GlobTarget, hasGlob } from '../embedded/glob';
import type { EmbeddedToken } from '../embedded/types';
import { braceSequence, extglobs, hasGlobstar } from '../examples/shellwords';
import { parseExpansion } from '../expansion';
import { codeSpan, shorten } from '../label';
import { fact } from '../messages';
import { spanOf } from '../noteanchors';
import { braceTexts } from '../semantics/brace';
import { mayGiveNoField } from '../semantics/nofield';
import { replaceRange } from '../rewrite';
import { attribute, docLine } from '../semantics/state';
import { readonlyAtStart } from '../semantics/vars';
import { givesElements } from '../semantics/elements';
import { CONTEXTS, partMeaning, type StepKind, trustedPart, underscoreValue, wordFields, wordOf } from '../semantics/words';
import { type BracketSpan, bracketSpans, decodedText, isPlainWord, setsElement, splitElement, stackTilde, staticWordValue, unquoteWord } from '../staticword';
import { ancestor, assignmentsOnly, braceKind, descendants, field, fields, type SyntaxNode, wordBraces } from '../syntax/tree';
import { claim } from '../tokenmarks';
import type { Explainer } from './context';
import { fromEmbedded, same, sibling, sortTokens } from './nodes';
import { arrayKind, globOff, globState, inArithmetic, isAssoc, shoptAt, unquotedWord, wordAt } from './reads';
import { pidNote, stageCountNote } from './where';

/**
 * The words of the brace expansion of the word `n`: undefined when it has none, null when it gives too many words to
 * list. The braces of a part of a longer word (`'a'{,}`) keep their empty words, which the other parts join.
 */
export function braceExpansion(n: SyntaxNode): string[] | undefined | null {
  return braceTexts([n], n.parent!.type === 'concatenation');
}

/**
 * The `[…]` that a plain part of a word opens or closes, where the parts between are in it (the `[` and `]` of `[$x]`,
 * `bracketSpans`): its text, and where in the part it starts (`opens`) or ends (`closes`; a part can do both, `][` of
 * `[$x][$y]`). The parts are those of a concatenation, or the pieces of a pattern side by side (the right side of `==`
 * in `[[ ]]`).
 */
export function bracketPart(n: SyntaxNode): { opens?: { text: string; at: number }; closes?: { text: string; at: number } } | undefined {
  const found = bracketsOf(n);
  if (!found) return undefined;
  const { p, spans, i } = found;
  const of = (b: BracketSpan | undefined, at: (b: BracketSpan) => number) => b && { text: p.text.slice(b.start - p.startIndex, b.end - p.startIndex), at: at(b) - n.startIndex };
  const opens = of(spans.find((b) => b.open === i), (b) => b.start);
  const closes = of(spans.find((b) => b.close === i), (b) => b.end - 1);
  return opens || closes ? { opens, closes } : undefined;
}

/** The parts of the word that `n` is a part of (as `bracketPart` takes them), their `[…]` across parts, and the index of `n`. */
function bracketsOf(n: SyntaxNode): { p: SyntaxNode; spans: BracketSpan[]; i: number } | undefined {
  const p = n.parent;
  const parts = p?.type === 'concatenation' ? p.namedChildren : p?.type === 'binary_expression' ? fields(p, 'right') : [];
  const i = parts.indexOf(n);
  return i < 0 ? undefined : { p: p!, spans: bracketSpans(parts), i };
}

/** The text of the `[…]` across parts that the part `n` is inside of, between its `[` and `]` (the `$x` of `[$x]`). */
function bracketAround(n: SyntaxNode): string | undefined {
  const found = bracketsOf(n);
  const b = found?.spans.find((s) => s.open < found.i && found.i < s.close);
  return b && found!.p.text.slice(b.start - found!.p.startIndex, b.end - found!.p.startIndex);
}

/**
 * A word written as an element, unquoted, with expansions in its subscript: `a[$i]` (its subscript is a `[…]` of its
 * parts, `bracketPart`). `unset` and `declare` take it as a name and a subscript, once it is not globbed away.
 */
export function elementWord(n: SyntaxNode): boolean {
  const first = n.type === 'concatenation' ? n.namedChildren[0] : undefined;
  const opens = first && bracketPart(first)?.opens;
  return !!opens && /^[A-Za-z_]\w*\[$/.test(first!.text) && n.text === first!.text.slice(0, opens.at) + opens.text;
}

/**
 * A plain part of a word that opens or closes a `[…]` the parts between are in (`bracketPart`): a pattern, matched
 * against file names where the word is globbed, against a string where it is a pattern (`case`, `[[ == ]]`), with the
 * wildcards of its text before the `[` and after the `]` (`]*.txt`). Undefined for any other part, and where the word
 * is neither.
 */
function bracketPiece(cx: Explainer, n: SyntaxNode): Token | undefined {
  const part = bracketPart(n);
  const w = part && wordAt(cx, n);
  if (!w) return undefined;
  const target: GlobTarget | undefined = CONTEXTS[w.context].match === 'pattern' ? 'value' : w.steps.find((s) => s.kind === 'glob')!.applies !== false ? 'file' : undefined;
  if (!target) return undefined;
  const { opens, closes } = part!;
  // (`[!…]`, `[^…]`: an unquoted `!` or `^` first makes it match any other character.)
  const negated = !!opens && /[!^]/.test(n.text[opens.at + 1] ?? '');
  const said = [
    closes && cx.s(`\`]\` は \`${closes.text}\` の \`[…]\` の終わり`, `\`]\` closes the \`[…]\` of \`${closes.text}\``),
    opens && (negated
      ? cx.s(`\`[${n.text[opens.at + 1]}\` は \`${opens.text}\` の \`[…]\` の始まり: 間にある文字（展開した値の文字も含む）以外の1文字に一致する`, `\`[${n.text[opens.at + 1]}\` opens the \`[…]\` of \`${opens.text}\`: it matches any one character except those between, the characters the expansions give included`)
      : cx.s(`\`[\` は \`${opens.text}\` の \`[…]\` の始まり: 間にある文字（展開した値の文字も含む）のどれか1文字に一致する`, `\`[\` opens the \`[…]\` of \`${opens.text}\`: it matches one character of those between, the characters the expansions give included`)),
  ].filter(Boolean);
  const before = closes ? '' : n.text.slice(0, opens!.at);
  const after = opens ? '' : n.text.slice(closes!.at + 1);
  const children = [
    ...(hasGlob(before) ? globChildren(cx, n, before, 0) : []),
    ...(hasGlob(after) ? globChildren(cx, n, after, closes!.at + 1) : []),
  ];
  return { ...cx.tok(n, 'pattern', `${globIntro(cx.lang, target)}${cx.s('。', '. ')}${said.join(cx.s('。', '. '))}`, children), refs: ['3.5.8.1'] };
}

export function word(cx: Explainer, n: SyntaxNode): Token {
  const text = n.text;
  const t = tilde(cx, n);
  if (t) return t;
  const bracket = bracketPiece(cx, n);
  if (bracket) return bracket;
  const off = hasGlob(text) && globOff(cx, n);
  if (off) return cx.tok(n, 'argument', cx.s(`文字列 \`${text}\``, `Word \`${text}\``) + off);
  if (hasGlob(text) && notGlobbedHere(cx, n)) return cx.tok(n, 'argument', cx.s(`文字列 \`${text}\``, `Word \`${text}\``) + notGlobbedHere(cx, n));
  if (hasGlob(text)) return { ...cx.tok(n, 'pattern', globIntro(cx.lang, 'file') + globNotes(cx, text, n), globChildren(cx, n, text, 0)), refs: ['3.5.8'] };
  return cx.tok(n, 'argument', cx.s(`文字列 \`${text}\``, `Word \`${text}\``) + valueNote(cx, n));
}

export function string(cx: Explainer, n: SyntaxNode): Token {
  // `$"…"`: a `$` and a string, in the same node or beside each other.
  const dollar = sibling(n, -1);
  if (dollar?.type === '$' && dollar.endIndex === n.startIndex) {
    const t = cx.tok(n, 'string', cx.s('`$"…"` 文字列: ロケールに応じて翻訳される文字列（翻訳がなければそのまま。中の変数は展開される）', '`$"…"` string: translated according to the locale (as it is when there is no translation; variables inside expand)'), cx.subs(n.namedChildren.filter((c) => c.type !== 'string_content')), shorten('$' + n.text));
    t.span = { start: spanOf(dollar).start, end: t.span.end };
    return t;
  }
  // `"$@"`, `"${a[@]}"`, `"${!pre@}"`, `"${@:2}"` give one word per element, also inside double quotes (not one in a
  // `$( )` in the string: the substitution gives one word), where the word may be many (not an assignment's value).
  const perElement = n.namedChildren.some(givesElements) && manyFields(n);
  // (Text in the quotes joins the first and the last element, and makes one word when there are none: `"pre$@post"`.)
  const text = n.namedChildren.some((c) => c.type === 'string_content');
  unbracedElement(cx, n);
  return cx.tok(n, 'string', (perElement && text ? cx.s(
    'ダブルクォート文字列: 中の `$変数` や `$(…)` は展開され、単語分割やグロブ展開はされない。ただし `"$@"` や `"${配列[@]}"` は、クォートの中でも要素ごとに別々の単語になる。前の文字列は最初の要素に、後ろの文字列は最後の要素にくっつく（要素が無ければ文字列だけで1つの単語になる）',
    'Double-quoted string: `$vars` and `$(…)` expand, with no word splitting or globbing. But `"$@"` and `"${array[@]}"` still give one word per element, even inside the quotes: the text before joins the first element, and the text after the last (with no elements, the text alone makes one word)',
  ) : perElement ? cx.s(
    'ダブルクォート文字列: 中の `$変数` や `$(…)` は展開され、単語分割やグロブ展開はされない。ただし `"$@"` や `"${配列[@]}"` は、クォートの中でも要素ごとに別々の単語になる（要素が無ければ単語は0個）',
    'Double-quoted string: `$vars` and `$(…)` expand, with no word splitting or globbing. But `"$@"` and `"${array[@]}"` still give one word per element, even inside the quotes (no word at all when there are none)',
  ) : cx.s(
    'ダブルクォート文字列: 中の `$変数` や `$(…)` は展開されるが、単語分割やグロブ展開はされない（1つの引数のまま）',
    'Double-quoted string: `$vars` and `$(…)` expand, but no word splitting or globbing (stays one argument)',
  )) + (/\\/.test(n.text) ? valueNote(cx, n) : ''), cx.subs(n.namedChildren.filter((c) => c.type !== 'string_content')));
}

/** Whether the word that holds `n` may be many words (an argument, a `for` list), seen through a `${x:-…}` around it. */
function manyFields(n: SyntaxNode): boolean {
  let w = wordOf(n);
  while (w?.context === 'param-word') w = wordOf(w.nodes[0].parent!);
  return !!w && CONTEXTS[w.context].fields === 'many';
}

/**
 * "Concatenation": the parts are glued into one word, except around `"$@"` and `"${a[@]}"`, which are one word per element:
 * the text before them joins the first element, and the text after them the last.
 */
export function concatenationNote(cx: Explainer, n: SyntaxNode): string {
  const parts = n.namedChildren;
  const each = manyFields(n) ? parts.findIndex((c) => c.type === 'string' && c.namedChildren.length === 1 && givesElements(c.namedChildren[0])) : -1;
  if (each < 0) return concatJoined(cx, n);
  const text = (from: number, to: number): string => (from >= to ? '' : n.text.slice(parts[from].startIndex - n.startIndex, parts[to - 1].endIndex - n.startIndex));
  const before = text(0, each);
  const after = text(each + 1, parts.length);
  const glue = [
    before && cx.s(`前の \`${before}\` は最初の要素の前に`, `\`${before}\` is glued to the start of the first element`),
    after && cx.s(`後ろの \`${after}\` は最後の要素の後ろに`, `\`${after}\` is glued to the end of the last one`),
  ].filter(Boolean);
  // (With no elements, the text around is the word: none when it may expand to nothing, `"${a[@]}"$b`.)
  const none = mayGiveNoField(n, cx.state);
  return cx.s(
    `連結: \`${parts[each].text}\` は要素ごとに別々の単語になるので、全体は1つの単語にならない。${glue.join('、')}くっつく（要素が無ければ前後が1つの単語になる${none ? '。前後も空に展開されると単語は残らない' : ''}）`,
    `Concatenation: \`${parts[each].text}\` gives one word per element, so this is not one word. ${glue.join(' and ')} (with no elements, the text around it makes one word${none ? ', or none when it expands to nothing too' : ''})`);
}

/** An unquoted part that gives one word per element (`$@`, `$*`, `${a[@]}`, `${a[*]}`), even where the IFS is empty. */
function unquotedElements(n: SyntaxNode): boolean {
  if (n.type === 'simple_expansion') return n.text === '$@' || n.text === '$*';
  const p = n.type === 'expansion' ? parseExpansion(n.text) : undefined;
  return !!p && p.prefix !== '#' && (p.name === '@' || p.name === '*' || p.subscript === '@' || p.subscript === '*');
}

/**
 * "Concatenation" of a word with no `"$@"`-like part: the parts are joined, and the word is one word only where bash
 * surely makes one of it (src/semantics/words.ts: the fields the model knows, else the steps of brace expansion, word
 * splitting and globbing that apply or may); else what makes other than one word of it, and how many where known.
 */
function concatJoined(cx: Explainer, n: SyntaxNode): string {
  const one = cx.s('連結: 以下の部分を空白なしでつなげて1つの単語にする', 'Concatenation: the parts below are joined into one word');
  const w = wordAt(cx, n);
  // (A word in no context of the table: a function name, `function c$x"…"`, which bash does not expand.)
  if (!w) return one;
  const { fields, error } = wordFields(n, cx.state);
  if (fields?.length === 1) return one;
  const step = (kind: StepKind) => w.steps.find((x) => x.kind === kind)!;
  // (The text of the word where the model knows its values, before brace expansion: what splitting and globbing act on.)
  const known = trustedPart(n, w, cx.state, false, step('split').applies !== false, 'model');
  const split = step('split').applies !== false && (!known || known.fields.length !== 1);
  const glob = step('glob').applies !== false && (!known || known.fields.some((f) => f.glob));
  const elements = w.rule.fields === 'one' ? [] : n.namedChildren.filter(unquotedElements);
  const names = [
    ...(step('brace').applies !== false ? [['ブレース展開', 'brace expansion']] : []),
    ...elements.map((e) => [`\`${e.text}\`（要素ごとに別の単語）`, `\`${e.text}\` (one word per element)`]),
    ...(split ? [['単語分割', 'word splitting']] : []),
    ...(glob ? [['グロブ展開', 'globbing']] : []),
  ];
  const ja = names.map((x) => x[0]).join('・');
  const en = names.length > 1 ? `${names.slice(0, -1).map((x) => x[1]).join(', ')} and ${names[names.length - 1][1]}` : names[0]?.[1];
  const make = names.length > 1 ? 'make' : 'makes';
  // (An unquoted word that expands to nothing is removed, also where the IFS is empty: `$a$b`; so is a glob that
  // matches nothing, with nullglob: src/semantics/nofield.ts.)
  const empty = mayGiveNoField(n, cx.state);
  if (fields?.length === 0) {
    return cx.s('連結: 以下の部分はどれも空に展開され、クォートしない空の展開は取り除かれるので、単語は残らない', 'Concatenation: the parts below all expand to nothing, and an unquoted empty expansion is removed: no word is left');
  }
  if (fields) {
    const list = fields.length <= 5 ? `: ${fields.map((f) => codeSpan(shown(f) || "''")).join(' ')}` : '';
    return cx.s(`連結: 以下の部分を空白なしでつなげるが、${ja}で ${fields.length} 個の単語になる${list}`, `Concatenation: the parts below are joined, but ${en} ${make} ${fields.length} words of it${list}`);
  }
  if (error === 'ambiguous-redirect' && known?.text === '') {
    return cx.s('連結: 以下の部分はどれも空に展開され、クォートしない空の展開は取り除かれるので単語が残らず、bash はリダイレクトを「ambiguous redirect」のエラーにする',
      'Concatenation: the parts below all expand to nothing, and an unquoted empty expansion is removed: no word is left, which bash refuses here ("ambiguous redirect")');
  }
  if (error === 'ambiguous-redirect') {
    return cx.s(`連結: 以下の部分を空白なしでつなげるが、${ja}で1つの単語にならないので、bash はリダイレクトを「ambiguous redirect」のエラーにする`,
      `Concatenation: the parts below are joined, but ${en} ${make} other than one word of it, which bash refuses here ("ambiguous redirect")`);
  }
  if (!names.length && !empty) return one;
  if (w.rule.fields === 'one-or-error') {
    return cx.s(`連結: 以下の部分を空白なしでつなげるが、${names.length ? `${ja}で` : '空に展開されて'}1つの単語にならないことがあり、そのとき bash はリダイレクトを「ambiguous redirect」のエラーにする`,
      `Concatenation: the parts below are joined, but ${names.length ? `${en} may make other than one word of it` : 'it may expand to no word'}, which bash refuses here ("ambiguous redirect")`);
  }
  if (!names.length) {
    return cx.s('連結: 以下の部分を空白なしでつなげて1つの単語にする。ただし、どれも空に展開されると単語は残らない（クォートしない空の展開は取り除かれる）',
      'Concatenation: the parts below are joined into one word, or none when they all expand to nothing (an unquoted empty expansion is removed)');
  }
  return cx.s(`連結: 以下の部分を空白なしでつなげるが、${ja}で複数の単語になることがある${empty ? '（単語が残らないこともある）' : ''}`,
    `Concatenation: the parts below are joined, but ${en} may make several words of it${empty ? ', or none' : ''}`);
}

/**
 * What quote removal makes of a word (`h\i` is `hi`, `\$HOME` is the text `$HOME`), if it changes the text
 * and the result is known without running anything. Empty or unchanged: nothing to say.
 */
export function valueNote(cx: Explainer, n: SyntaxNode): string {
  const v = staticWordValue(n, false, cx.shell);
  if (!v || v === decodedText(n)) return '';
  const literal = v.includes('$');
  // (A newline is shown as `␊`, so that it is not read as the two characters `\n`; each picture is told once.)
  const text = visible(v).replace(/\n/g, '␊');
  const pictures = pictureList([text], (ja, en) => cx.s(ja, en));
  return cx.s(
    `。クォートやバックスラッシュを取り除くと \`${text}\` という文字列になる${pictures ? `（制御文字は記号で表している: ${pictures}）` : ''}${literal ? '（この `$` は変数展開の記号ではなく、ただの文字なので展開されない）' : ''}`,
    `. After quote removal it is the string \`${text}\`${pictures ? ` (control characters are shown as symbols: ${pictures})` : ''}${literal ? ' (this `$` is plain text, not the start of an expansion, so nothing is expanded)' : ''}`,
  );
}

/** How a value is shown in an explanation: control characters as pictures, a newline as `\n`. */
export function shown(v: string): string {
  return visible(v).replace(/\n/g, '\\n');
}

/**
 * Whether the word model lets the word `n` have brace expansion here (src/semantics/words.ts): not in a shell without
 * it, as dash, nor after `set +B`, nor where bash does not expand braces, as the value of an assignment or a
 * here-string. Where `set +B` is on some paths only, it may (see `bracesMaybeOff`).
 */
export function bracesHere(cx: Explainer, n: SyntaxNode): boolean {
  const step = wordAt(cx, n)?.steps.find((s) => s.kind === 'brace');
  return step?.why !== 'dialect' && step?.why !== 'context' && !(step?.why === 'braceexpand-off' && step.applies === false);
}

/** What to add where brace expansion of `n` may be off (`set +B` on some paths before): a parenthesis; else nothing. */
export function bracesMaybeOff(cx: Explainer, n: SyntaxNode): string {
  const step = wordAt(cx, n)?.steps.find((s) => s.kind === 'brace');
  return step?.why === 'braceexpand-off' && step.applies === 'unknown'
    ? cx.s('（ブレース展開が有効な場合。この前の一部の経路では `set +B` で無効になっていて、そのときは書いたままの1語）', ' (where brace expansion is on: `set +B` turns it off on some paths before, and there the word stays as it is)')
    : '';
}

/** The words a word gives by brace expansion; undefined when it gives none (or too many to list). */
export function braceWords(cx: Explainer, n: SyntaxNode): string[] | undefined {
  return bracesHere(cx, n) ? braceExpansion(n) ?? undefined : undefined;
}

/** A word of plain text, braces included (`x{a,b}`): one read as its text where its braces do not expand (dash). */
export function plainText(n: SyntaxNode): boolean {
  return isPlainWord(n) || (unquotedWord(n) !== undefined && wordBraces(n).length > 0);
}

/** A word with braces (`{a,b\,c}`, `{,}`, `{a..e..2}`), explained as the brace expansion it is (manual 3.5.1). */
export function braceWord(cx: Explainer, n: SyntaxNode): Token | undefined {
  const t = braceWordToken(cx, n);
  if (t) t.refs = ['3.5.1'];
  // (bash expands the braces before the command sees the words: its reading, even in an operand.)
  return t && claim(t, 'shell');
}

function braceWordToken(cx: Explainer, n: SyntaxNode): Token | undefined {
  const text = unquotedWord(n);
  if (text === undefined || !bracesHere(cx, n)) return undefined;
  const words = braceExpansion(n);
  if (words === null) {
    return cx.tok(n, 'expansion', cx.s(`ブレース展開: \`${text}\` は多くの単語に展開される`, `Brace expansion: \`${text}\` expands to many words`));
  }
  if (!words) return undefined;
  // (An empty word that stays is shown as `''`: a lone backslash, as `{Z..a}` makes, is gone after quote removal.)
  // (A word with a backtick, as `{Z..a}` makes, is in a longer fence.)
  const list = (words.length > 12 ? [...words.slice(0, 11), '…'] : words).map((w) => (w === '…' ? w : codeSpan(w || "''"))).join(' ');
  const comma = /\\,/.test(text);
  const sequences = wordBraces(n).filter((b) => braceKind(b) === 'sequence');
  // `{01..10..3}`: a number with a leading 0 makes every number as wide as the widest.
  const pad = sequences.some((s) => s.namedChildren.slice(0, 2).some((c) => /^-?0\d/.test(c.text)));
  const parts = sequences.flatMap((s) => sequenceParts(cx, s)).map((t) => fromEmbedded({ ...t, start: t.start - n.startIndex, end: t.end - n.startIndex }, n, { text, base: 0 }, 'shell'));
  return cx.tok(n, 'expansion', (words.length
    ? cx.s(`ブレース展開: \`${text}\` は ${words.length} 個の単語 ${list} に展開される${comma ? '（\\, は区切りではなく、コンマそのもの）' : ''}${pad ? '（先頭が 0 の数があるので、桁数をそろえて 0 で埋める）' : ''}`,
      `Brace expansion: \`${text}\` expands to ${words.length} ${words.length === 1 ? 'word' : 'words'}: ${list}${comma ? ' (an escaped comma is not a separator, just a comma)' : ''}${pad ? ' (a number with a leading 0 pads all of them with zeros to the same width)' : ''}`)
    : cx.s(`ブレース展開: \`${text}\` は空の単語に展開され、空の単語は取り除かれるので、何も残らない`, `Brace expansion: \`${text}\` expands to empty words, which are dropped, so nothing is left`)) + bracesMaybeOff(cx, n), parts);
}

/**
 * The parts of a sequence expression of braces, `{1..10..3}` (3.5.1): its start, its end and its increment, at their
 * places in the text, with what bash makes of them (checked with bash 5.2): the sign of the increment does not count,
 * the order comes from the start and the end, an increment of 0 counts as 1, the last word is the last step that
 * does not pass the end, and a number with a leading 0 pads every word with zeros to the same width.
 */
function sequenceParts(cx: Explainer, s: SyntaxNode): EmbeddedToken[] {
  const [xn, yn, zn] = s.namedChildren;
  const [x, y] = [xn.text, yn.text];
  const numbers = /\d/.test(x);
  // (A sequence of the word expands to no more words than the word: they were listed.)
  const words = braceSequence(s.text)!;
  const kind = numbers ? 'number' : 'string';
  const value = (v: string): number => (numbers ? Number(v) : v.charCodeAt(0));
  const down = value(x) > value(y);
  const padded = (v: string): string => (numbers && /^-?0\d/.test(v) ? cx.s('。先頭が 0 なので、すべての数を 0 で埋めて同じ桁数にする', '; it has a leading 0, so every number is padded with zeros to the same width') : '');
  const last = words[words.length - 1];
  const stops = last !== y && (!numbers || Number(last) !== Number(y)) ? cx.s(`（増分で届かないので、最後の単語は \`${last}\`）`, ` (the steps do not land on it: the last word is \`${last}\`)`) : '';
  const out: EmbeddedToken[] = [
    { start: xn.startIndex, end: xn.endIndex, kind, explanation: cx.s(`開始: \`${x}\``, `Start: \`${x}\``) + padded(x), children: [] },
    { start: yn.startIndex, end: yn.endIndex, kind, explanation: cx.s(`終わり: \`${y}\``, `End: \`${y}\``) + stops + padded(y), children: [] },
  ];
  if (!zn) return out;
  const z = zn.text;
  const step = Math.abs(Number(z)) || 1;
  const sign = Number(z) < 0 ? cx.s('。符号は使われず、向きは開始と終わりで決まる', '; its sign does not count: the start and the end set the direction') : Number(z) === 0 ? cx.s('。0 は 1 として扱われる', '; 0 counts as 1') : '';
  out.push({
    start: zn.startIndex, end: zn.endIndex, kind: 'number',
    explanation: numbers
      ? cx.s(`増分: \`${z}\`（単語ごとに ${step} ${down ? '減る' : '増える'}）${sign}`, `Increment: \`${z}\` (each word is ${step} ${down ? 'less' : 'more'} than the one before)${sign}`)
      : cx.s(`増分: \`${z}\`（${step} 文字ごとに${down ? '逆向きに' : ''}進む）${sign}`, `Increment: \`${z}\` (${step === 1 ? 'each letter' : `every ${ordinal(step)} letter`}, counting ${down ? 'down' : 'up'})${sign}`),
    children: [],
  });
  return out;
}

/** The kinds of node bash expands after braces, in a word or in a string of it. */
const LATER = ['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion'];

/**
 * The braces of the word `n` that hold a `..` and an expansion, `{1..$n}`, as its pieces show them: braces bash does not
 * expand (the parser makes no brace expression of them), whose text only the expansion would make a sequence.
 */
function braceWithExpansion(n: SyntaxNode): string | undefined {
  let open = -1;
  let later = false;
  // (Such a word is a concatenation: of plain text and the expansions.)
  for (const p of n.namedChildren) {
    if (p.type !== 'word' && p.type !== 'number') {
      later ||= open >= 0 && (LATER.includes(p.type) || descendants(p, LATER).length > 0);
      continue;
    }
    for (let i = 0; i < p.text.length; i++) {
      const c = p.text[i];
      const at = p.startIndex - n.startIndex + i;
      if (c === '\\') i++;
      else if (c === '{') [open, later] = [at, false];
      else if (c === ',') open = -1;
      else if (c === '}' && open >= 0) {
        const text = n.text.slice(open, at + 1);
        if (later && text.includes('..')) return text;
        open = -1;
      }
    }
  }
  return undefined;
}

/** `{1..$n}`: braces are expanded before variables, so a range whose end is a variable is not a range. */
function braceVarNote(cx: Explainer, n: SyntaxNode): string {
  const text = braceWithExpansion(n);
  if (!text) return '';
  if (cx.command?.rereads) {
    return cx.s(
      `。シェルは先に変数を置き換えるので、\`eval\` に渡る文字列は \`{1..3}\` のような形になり、\`eval\` がそれを読み直すときにはじめてブレース展開が連番になる`,
      `. The shell replaces the variable first, so \`eval\` gets a string like \`{1..3}\`, and only when \`eval\` reads it again is the brace expanded to a range`);
  }
  return cx.s(
    `。\`${text}\` は連番ではない: ブレース展開は変数の展開より先に行われるので、\`${text}\` のまま変数だけが置き換わる（例: \`{1..3}\` という文字列）。連番にするには \`eval\` を使うか、\`seq\` や \`for ((…))\` を使う`,
    `. \`${text}\` is not a range: braces are expanded before variables, so the text stays \`{…}\` with only the variable replaced (for example the string \`{1..3}\`). To get a range, use \`eval\`, \`seq\` or a \`for ((…))\` loop`);
}

/**
 * What a tilde prefix becomes (`~`, `~+`, `~-`, `~user`, an entry of the directory stack: `~1`, `~+1`, `~-1`);
 * undefined for the others (`~1x`).
 */
function tildeTarget(cx: Explainer, user: string): string | undefined {
  if (user === '+') return cx.s('`~+` はカレントディレクトリ（`$PWD`）', '`~+` becomes the current directory (`$PWD`)');
  if (user === '-') return cx.s('`~-` は直前のディレクトリ（`$OLDPWD`）', '`~-` becomes the previous directory (`$OLDPWD`)');
  const stack = stackTilde(user);
  if (stack) {
    const { n, right, at } = stack;
    return cx.s(
      `\`~${user}\` はディレクトリスタックの、\`dirs\` の${right ? '右' : '左'}から ${n} 番目（0 始まり）の項目（\`dirs ${at}\` が表示するもの${at === '+0' ? '。0 番目はカレントディレクトリ' : ''}。その項目がなければそのまま）`,
      `\`~${user}\` becomes entry ${n} of the directory stack, counted from the ${right ? 'right' : 'left'} of \`dirs\` from 0 (what \`dirs ${at}\` shows${at === '+0' ? ': entry 0 is the current directory' : ''}; unchanged if there is no such entry)`);
  }
  if (user && !/^[A-Za-z_][\w.-]*$/.test(user)) return undefined;
  return user
    ? cx.s(`\`~${user}\` はユーザー \`${user}\` のホームディレクトリ（そのユーザーがいなければそのまま）`, `\`~${user}\` becomes the home directory of the user \`${user}\` (unchanged if there is no such user)`)
    : cx.s('`~` はホームディレクトリ（`$HOME`）', '`~` becomes the home directory (`$HOME`)');
}

/** The directory stack's section (6.8), for a tilde prefix that is an entry of it. */
const stackSection = (user: string): string[] => (stackTilde(user) ? ['6.8'] : []);

/**
 * Tilde expansion in a plain word (src/semantics/words.ts): at its start (`~`, `~/x`, `~user/x`, `~+`), after the
 * `:` of an assignment (`PATH=~/bin:~/x`), and after the `=` of an argument that looks like an assignment in bash
 * mode (`echo x=~/y`). Not in `--o=~` or a quoted `"~"`.
 */
export function tilde(cx: Explainer, n: SyntaxNode): Token | undefined {
  // (Most words have no tilde: they need not ask the model.)
  if (!n.text.includes('~')) return undefined;
  const w = wordAt(cx, n);
  /* c8 ignore next -- a guard: the plain words explained here are all in a word's place (an argument, a value, a pattern…). */
  if (!w) return undefined;
  const tildes = w.tildes.filter((t) => t.node === n && tildeTarget(cx, t.user));
  if (!tildes.length) return undefined;
  const [first] = tildes;
  // (bash expands the tilde before the command sees the word: its reading, even in an operand.)
  if (tildes.length === 1 && first.start === 0) {
    const rest = n.text.slice(first.end);
    // `~/*.txt`: after the tilde, the word is globbed (unless `set -f` or the place turns that off).
    const globbed = hasGlob(rest) && w.steps.find((s) => s.kind === 'glob')!.applies !== false;
    const after = globbed
      ? cx.s(`。続く \`${rest}\` にはワイルドカードがあるので、展開後のパスがグロブとして一致するファイル名に置き換わる`, `. The rest, \`${rest}\`, has wildcards: the expanded path is then a glob, replaced by the file names it matches`)
      : rest ? cx.s(`。残りの \`${rest}\` はそのまま続く`, `. The rest, \`${rest}\`, stays as it is`) : '';
    return { origin: 'shell', ...cx.tok(n, 'expansion', cx.s(`チルダ展開: ${tildeTarget(cx, first.user)}に置き換わる`, `Tilde expansion: ${tildeTarget(cx, first.user)}`)
      + after + (hasGlob(n.text) ? notGlobbedHere(cx, n) + globOff(cx, n) : ''), globbed ? globChildren(cx, n, rest, first.end) : []), refs: ['3.5.2', ...stackSection(first.user), ...(globbed ? ['3.5.8'] : [])] };
  }
  const row = n.startPosition.row;
  const col = n.startPosition.column;
  const kids = tildes.map((t) => ({
    kind: 'expansion' as Kind, label: n.text.slice(t.start, t.end), children: [], origin: 'shell' as const,
    span: { start: { line: row, character: col + t.start }, end: { line: row, character: col + t.end } },
    explanation: t.after
      ? cx.s(`チルダ展開（\`${t.after}\` の後ろ）: ${tildeTarget(cx, t.user)}に置き換わる`, `Tilde expansion (after \`${t.after}\`): ${tildeTarget(cx, t.user)}`)
      : cx.s(`チルダ展開: ${tildeTarget(cx, t.user)}に置き換わる`, `Tilde expansion: ${tildeTarget(cx, t.user)}`),
  }));
  return cx.tok(n, 'argument', cx.s(`文字列 \`${n.text}\``, `Word \`${n.text}\``) + tildeNote(cx, n), kids);
}

/** An argument that looks like an assignment (`x=~/y`): bash expands a tilde after its `=` and `:`. */
export function tildeNote(cx: Explainer, n: SyntaxNode): string {
  const w = wordAt(cx, n)!;
  return w.context !== 'assignment-value' && w.tildes.some((t) => t.after === '=')
    ? cx.s('。代入の形をした引数なので、bash では `=` と `:` の後ろの `~` も展開される（POSIX モードでは先頭だけ）', '. It looks like an assignment, so bash expands a `~` after the `=` and after each `:` too (in POSIX mode, only at the start)')
    : '';
}

/**
 * A glob pattern as a token: what a glob is, then its parts as children. A text without glob characters is just
 * a pattern that matches itself. `text` starts `base` characters into the node.
 */
export function globToken(cx: Explainer, n: SyntaxNode, target: GlobTarget, text = n.text, base = 0, kind: Kind = 'pattern'): Token {
  // (A part that opens or closes a `[…]` of its word: the `[` of `[$x]` in a `case` pattern.)
  const bracket = bracketPiece(cx, n);
  if (bracket) return bracket;
  if (!hasGlob(text)) return cx.tok(n, kind, cx.s(`パターン \`${text}\`（ワイルドカードを含まないので、この文字列そのものに一致）`, `Pattern \`${text}\` (no wildcards, so it matches exactly this text)`));
  return cx.tok(n, kind, globIntro(cx.lang, target) + extglobNote(cx, text), globChildren(cx, n, text, base));
}

/**
 * A `case` pattern. Plain text is a glob (`*.txt)`); with an expansion, what bash matches depends on the quotes: an
 * unquoted `$p` gives a pattern, and a quoted `"$q"` is matched as literal text (manual 3.2.5.2, 3.5.8.1).
 */
export function casePattern(cx: Explainer, p: SyntaxNode): Token {
  const parts = p.type === 'concatenation' ? p.namedChildren : [p];
  if (!descendants(p, [...EXPANDING]).length && !EXPANDING.has(p.type)) return globToken(cx, p, 'value', p.text, 0);
  const unquoted = parts.some((x) => EXPANDING.has(x.type));
  // (The quoted parts of a default or alternate value are literal too: in `${q:-"*"}`, the `*`.)
  const quoted = parts.some((x) => QUOTED.has(x.type) || (x.type === 'expansion' && /^:?[-+=]$/.test(String(parseExpansion(x.text)!.op)) && x.namedChildren.some((c) => QUOTED.has(c.type))));
  return cx.tok(p, 'pattern', !unquoted
    ? cx.s(`パターン \`${p.text}\`: 展開はクォートされているので、その値は文字列そのものとして照合される（値の中の \`*\` や \`?\` はワイルドカードにならない）`, `Pattern \`${p.text}\`: the expansion is quoted, so its value is matched as literal text (\`*\` and \`?\` in the value are not wildcards)`)
    : quoted
      ? cx.s(`パターン \`${p.text}\`: クォートしていない展開の結果はパターンになり、クォートした部分は文字列そのものとして照合される`, `Pattern \`${p.text}\`: what the unquoted expansions give is a pattern, and the quoted parts are matched as literal text`)
      : cx.s(`パターン \`${p.text}\`: 展開した結果がパターンになる`, `Pattern \`${p.text}\`: what it expands to is the pattern`), cx.sub(p));
}
const EXPANDING = new Set(['simple_expansion', 'expansion', 'command_substitution']);
const QUOTED = new Set(['string', 'raw_string', 'ansi_c_string', 'translated_string']);

/** The parts of a glob pattern as tokens, placed where the pattern is written (`base` characters into `n`); `extglob: false` reads `@(…)` as plain text. */
export function globChildren(cx: Explainer, n: SyntaxNode, text: string, base: number, extglob = true): Token[] {
  return explainGlob(text, cx.lang, extglob).map((t) => fromEmbedded(t, n, { text, base }, 'shell'));
}

/**
 * What a file-name glob does with the glob options in effect: `**` reaches into subdirectories only with globstar on
 * (with a pitfall when it is not seen turned on before: it may be, in a file read with `source`).
 */
export function globNotes(cx: Explainer, text: string, n: SyntaxNode): string {
  return globOptionNote(cx, n, text) + starStarNote(cx, text, n) + extglobNote(cx, text);
}

/**
 * What the glob options in effect change for a file-name glob: dotglob (also turned on by a GLOBIGNORE that is
 * not empty), GLOBIGNORE, nocaseglob, and what happens when nothing matches (nullglob, failglob).
 */
function globOptionNote(cx: Explainer, n: SyntaxNode, text: string): string {
  const notes: string[] = [];
  const shopt = shoptAt(cx, n);
  const word = wordAt(cx, n);
  const ignore = word?.glob.globignore;
  const step = word?.steps.find((s) => s.kind === 'glob');
  // (As for an unquoted `$x` on the same line: `set -f` on some paths only.)
  if (step?.applies === 'unknown' && step.why === 'noglob') notes.push(cx.s('`set -f` でグロブ展開が無効になる経路もある（そこではこの文字のまま渡される）', 'globbing is off on some paths, after `set -f` (there it stays as written)'));
  // (A pattern that starts with `.` matches those names anyway.)
  if (shopt.dotglob === 'on' && !text.startsWith('.')) notes.push(typeof ignore === 'object' || ignore === 'unknown'
    ? cx.s('`GLOBIGNORE` を設定したので dotglob が有効になり、`.` で始まる名前にも一致する（`.` と `..` は除く）', 'setting `GLOBIGNORE` turned dotglob on, so it also matches names starting with `.` (not `.` and `..`)')
    : cx.s('dotglob が有効なので `.` で始まる名前にも一致する', 'with dotglob on, it also matches names starting with `.`'));
  if (ignore && typeof ignore === 'object') {
    const pats = ignore.value.split(':').filter(Boolean).map((p) => `\`${p}\``).join(cx.s('、', ', '));
    notes.push(cx.s(`\`GLOBIGNORE\` の ${pats} に一致する名前は結果から除かれる`, `names that match ${pats} of \`GLOBIGNORE\` are left out`));
  }
  if (shopt.nocaseglob === 'on') notes.push(cx.s('nocaseglob が有効なので大文字と小文字を区別しない', 'with nocaseglob on, case is ignored'));
  if (shopt.failglob === 'on') {
    notes.push(cx.s('failglob が有効なので、一致するものがなければエラーになり、コマンドは実行されない', 'with failglob on, a pattern that matches nothing is an error, and the command does not run'));
  } else if (shopt.nullglob === 'on') {
    notes.push(wordAt(cx, n)?.context === 'for-list'
      ? cx.s('nullglob が有効なので、一致するものがなければこの単語はなくなる（ループはこの単語の分は回らない。ほかに単語がなければ1回も実行されない）',
        'with nullglob on, a pattern that matches nothing goes away (the loop does not run for it, and not at all when there is no other word)')
      : cx.s('nullglob が有効なので、一致するものがなければこの単語はなくなる（引数が1つ減る。ほかに引数がなければ、コマンドは引数なしで実行される）',
        'with nullglob on, a pattern that matches nothing goes away (one argument fewer; with no other argument, the command runs with none)'));
  } else if (shopt.nullglob === 'unknown') {
    notes.push(cx.s('一致するものがないとき、nullglob が有効な経路ではこの単語はなくなり、ほかの経路ではそのままの文字で渡される', 'when nothing matches, it goes away on the paths where nullglob is on, and stays as written on the others'));
  }
  return notes.map((n) => cx.s(`。${n}`, `; ${n}`)).join('');
}

function starStarNote(cx: Explainer, text: string, n: SyntaxNode): string {
  if (!hasGlobstar(text)) return '';
  const globstar = shoptAt(cx, n).globstar;
  const on = cx.shell === 'ksh' ? 'set -o globstar' : 'shopt -s globstar';
  if (globstar === 'unknown') {
    cx.note(fact(cx.lang, 'globstar-maybe-on', { on }), n);
  }
  if (globstar === 'default') {
    cx.note(fact(cx.lang, 'globstar-not-found', { on }), n);
  }
  if (globstar === 'unsupported') {
    cx.note(fact(cx.lang, 'globstar-unsupported', { shell: cx.shell! }), n);
  }
  // (With dotglob on, `**` goes into directories starting with `.` too; the note on dotglob says so.)
  const dotglob = shoptAt(cx, n).dotglob;
  const dots = dotglob === 'on' ? ['', ''] : dotglob === 'unknown' ? ['、`.` で始まるものは dotglob が有効な経路でだけ含む', '; those starting with `.` only where dotglob is on'] : ['、`.` で始まるものは除く', ', not those starting with `.`'];
  const deep = cx.s(`\`**\` は任意の深さのディレクトリ（0階層以上${dots[0]}）に一致する`, `\`**\` matches directories at any depth (zero or more${dots[1]})`);
  if (globstar === 'on') return cx.s(`。${deep}`, `. ${deep}`);
  if (globstar === 'unknown') return cx.s(`。globstar が有効な経路では ${deep}。ほかの経路では \`*\` と同じで、1階層分にしか一致しない`, `. Where globstar is on, ${deep}; elsewhere it is the same as \`*\` and matches one level only`);
  const why = { off: ['globstar が無効なので', 'With globstar off'], default: ['globstar が有効になっていないので', 'With globstar not turned on'], unsupported: ['このシェルでは', 'In this shell'] }[globstar];
  return cx.s(`。${why[0]} \`**\` は \`*\` と同じで、1階層分にしか一致しない`, `. ${why[1]}, \`**\` is the same as \`*\` and matches one level only`);
}

/** The extended globs of a pattern in words: `!(*.txt)` is anything but `*.txt`. */
function extglobNote(cx: Explainer, text: string): string {
  const parts = extglobs(text).map(({ op, text: t, alts }) => {
    const list = alts.map((a) => `\`${a}\``).join(cx.s('、', ', '));
    const one = alts.length === 1;
    const ja = { '@': one ? list : `${list} のどれか`, '!': `${list} の${one ? '' : 'どれにも'}一致しないもの`.replace('` の一致', '` に一致'), '?': `${list} が0回か1回`, '*': `${list} の0回以上の繰り返し`, '+': `${list} の1回以上の繰り返し` }[op];
    const en = { '@': one ? list : `one of ${list}`, '!': `anything but ${list}`, '?': `${list} zero or one time`, '*': `${list} repeated zero or more times`, '+': `${list} repeated one or more times` }[op];
    return cx.s(`\`${t}\` は ${ja}`, `\`${t}\` is ${en}`);
  });
  return parts.length ? cx.s(`。拡張グロブ: ${parts.join('、')}`, `. Extended glob: ${parts.join('; ')}`) : '';
}

/** A word with `*` or `?` where bash does no pathname expansion (the value of an assignment): it stays text. */
export function notGlobbedHere(cx: Explainer, n: SyntaxNode): string {
  const w = wordAt(cx, n);
  return w?.context === 'assignment-value'
    ? cx.s('。代入ではファイル名の展開はされないので、`*` や `?` もそのままの文字として代入される', '. An assignment does no file-name expansion, so `*` and `?` are assigned as they are')
    : '';
}

/** What a variable of bash 5.3 (`bash53Variables`) is in the release explained for: a plain one in bash 5.2. */
export function bash53Variable(cx: Explainer, name: string): string | undefined {
  if (!Object.hasOwn(bash53Variables, name)) return undefined;
  const what = cx.t(bash53Variables[name]);
  return earlier(cx.opts.bashVersion ?? DEFAULT_BASH_VERSION, '5.3')
    ? cx.s(`bash 5.2 では普通の変数（bash 5.3 では${what}）`, `A plain variable in bash 5.2 (in bash 5.3, ${what})`)
    : cx.s(`bash 5.3 では${what}`, `In bash 5.3, ${what}`);
}

export function varDesc(cx: Explainer, name: string, at?: SyntaxNode): string | undefined {
  const own = /^\d+$/.test(name) && at ? stringParam(cx, Number(name), at) : undefined;
  if (own) return own;
  if (specialVariables[name]) return cx.t(specialVariables[name]);
  if (/^\d+$/.test(name)) return cx.s(`位置パラメータ: ${name} 番目の引数`, `Positional parameter: argument #${name}`);
  // (A variable bash makes read-only, `UID`: the script cannot assign it, src/semantics/vars.ts.)
  if (wellKnownVariables[name]) return cx.t(wellKnownVariables[name]) + (readonlyAtStart(name) ? cx.s('（読み取り専用）', ' (read-only)') : '');
  const later = bash53Variable(cx, name);
  if (later) return later;
  // Set by a CI system, unless the script sets it itself (`BRANCH_NAME=…`).
  const ci = Object.hasOwn(ciVariables, name) ? ciVariables[name] : undefined;
  if (ci && !cx.state.assigned.has(name)) {
    return cx.s(`${ci.ci} が設定する環境変数: ${cx.t(ci.meaning)}`, `set by ${ci.ci}: ${cx.t(ci.meaning)}`);
  }
  return undefined;
}

/**
 * `$0`, `$1`… in a string a shell runs (`sh -c 'printf "%s\n" "$1"' sh "$msg"`): that shell's, which start as the
 * words after the string (`ExplainOptions.positional`). Not in a function the string defines: there they are its
 * arguments.
 */
function stringParam(cx: Explainer, k: number, at: SyntaxNode): string | undefined {
  const p = cx.opts.positional;
  if (!p || ancestor(at, (x) => x.type === 'function_definition')) return undefined;
  const w = p.words[k];
  const of = cx.s(`\`${p.via}\` の文字列`, `the \`${p.via}\` string`);
  if (k === 0) {
    return w === undefined ? undefined : cx.s(`${of}の \`$0\`: そのあとに渡した名前 \`${w}\`（エラーメッセージに出る）`, `\`$0\` of ${of}: the name given after it, \`${w}\` (shown in error messages)`);
  }
  const start = w !== undefined ? cx.s(`（最初は \`${w}\`）`, ` (it starts as \`${w}\`)`) : p.more ? '' : cx.s('（渡されていないので、最初は空）', ' (none is given, so it starts empty)');
  return cx.s(`位置パラメータ: ${of}への ${k} 番目の引数${start}`, `Positional parameter: argument #${k} of ${of}${start}`);
}

export function variable(cx: Explainer, name: string, n: SyntaxNode): Token {
  stageCountNote(cx, n, name);
  const d = varDesc(cx, name, n);
  return cx.tok(n, 'variable', d ? `\`$${name}\`: ${d}` : cx.s(`変数 \`${name}\``, `Variable \`${name}\``));
}

export function simpleExpansion(cx: Explainer, n: SyntaxNode): Token {
  const name = n.text.slice(1);
  // (`"$@"` keeps the arguments apart only where words are split: not where the word stays one string.)
  const joined = name === '@' || name === '*' ? joinedNote(cx, n, name, true) : undefined;
  const d = joined ? cx.s('全ての位置パラメータ', 'All positional parameters') : varDesc(cx, name, n);
  const note = splitNote(cx, n);
  stageCountNote(cx, n, name);
  const t = cx.tok(n, 'variable', d ?? (note
    ? cx.s(`変数 \`${name}\` の値に置き換わる（クォートしないと${note.ja.startsWith('`') ? ' ' : ''}${note.ja}）`, `Expands to the value of \`${name}\` (unquoted, ${note.en})`)
    : cx.s(`変数 \`${name}\` の値に置き換わる`, `Expands to the value of \`${name}\``)));
  t.explanation += matchNote(cx, n) + orderNote(cx, n, name) + variableNote(cx, n, name) + (joined ?? '');
  return t;
}

/**
 * What word splitting and globbing do to the unquoted expansion `n` (src/semantics/words.ts): the text after
 * "unquoted, ". Undefined when neither applies there (in quotes, or in a context that does neither).
 */
function splitNote(cx: Explainer, n: SyntaxNode): { ja: string; en: string } | undefined {
  const part = partMeaning(n, cx.state);
  if (!part) return undefined;
  const { split, glob, word } = part;
  if (split.applies === false && (split.why === 'quoted' || split.why === 'context' || split.why === 'zsh')) return undefined; // (zsh: the line's dialect note says it.)
  if (split.applies === false && split.why === 'posix-mode') {
    return { ja: 'POSIX モードではリダイレクト先は単語分割もグロブ展開もされない', en: 'in POSIX mode a redirection target is neither word-split nor globbed' };
  }
  const g = globState(glob);
  const ambiguous = word.rule.fields === 'one-or-error'
    ? { ja: '。結果がちょうど1語にならないとエラー（ambiguous redirect）', en: '; a result that is not exactly one word is an error (ambiguous redirect)' } : { ja: '', en: '' };
  const ifs = word.ifs;
  const line = ifs.kind === 'default' ? 0 : (docLine(ifs.at) + 1);
  // What globbing does, after each way of splitting: [ja, en] for off (`set -f`), may (on some paths) and on.
  const after = {
    split: { off: ['る（`set -f` でグロブ展開は無効）', ' (globbing is off after `set -f`)'], may: ['る（`set -f` でグロブ展開が無効になる経路もある）', ' (globbing is off on some paths, after `set -f`)'], on: ['、グロブ展開もされる', ' and globbed'] },
    ifs: { off: ['る（`set -f` でグロブ展開は無効）', '; globbing is off after `set -f`'], may: ['る（`set -f` でグロブ展開が無効になる経路もある）', '; globbing is off on some paths, after `set -f`'], on: ['、グロブ展開もされる', ', and globbed'] },
    empty: { off: ['（`set -f` でグロブ展開も無効）', ' (and globbing is off after `set -f`)'], may: ['（`set -f` でグロブ展開が無効になる経路もある）', ' (and globbing is off on some paths, after `set -f`)'], on: ['が、グロブ展開はされる', ', but it is globbed'] },
    value: { off: ['。`set -f` でグロブ展開は無効', '; globbing is off after `set -f`'], may: ['。`set -f` でグロブ展開が無効になる経路もある', '; globbing is off on some paths, after `set -f`'], on: ['。グロブ展開もされる', ', and globbed'] },
  };
  let ja: string;
  let en: string;
  if (ifs.kind === 'default') {
    [ja, en] = [`空白で分割され${after.split[g][0]}`, `it is word-split${after.split[g][1]}`];
  } else if (ifs.kind === 'unknown') {
    [ja, en] = [`\`IFS\` は行 ${line} で、ここでは分からない値にしてある。その文字で分割され${after.ifs[g][0]}`, `it is split on the characters of \`IFS\` (set on line ${line} to a value not known here)${after.ifs[g][1]}`];
  } else if (ifs.value === '') {
    [ja, en] = [`\`IFS\` が空（行 ${line}）なので単語分割はされない${after.empty[g][0]}`, `\`IFS\` is empty (line ${line}), so it is not word-split${after.empty[g][1]}`];
  } else {
    const noSpace = !/[ \t\n]/.test(ifs.value);
    [ja, en] = [`\`IFS\`（行 ${line} で \`${shown(ifs.value)}\` にしてある）の文字で分割され${noSpace ? '、空白では分割されない' : ''}${after.value[g][0]}`,
      `it is split on the characters of \`IFS\` (set to \`${shown(ifs.value)}\` on line ${line})${noSpace ? ', not on spaces' : ''}${after.value[g][1]}`];
  }
  return { ja: ja + ambiguous.ja, en: en + ambiguous.en };
}

/** `case $x in $p)`, `[[ $x == $p ]]`, `[[ $x =~ $re ]]`: an unquoted expansion there is read as a pattern or a regex, not as text. */
function matchNote(cx: Explainer, n: SyntaxNode): string {
  const part = partMeaning(n, cx.state);
  const match = part && !part.quoted ? part.word.rule.match : undefined;
  if (!match) return '';
  // (Inside a `[…]` across the parts, its characters are of the set: `x='*'; [[ $s == [$x] ]]` is true only for a `*`.)
  const bracket = match === 'pattern' && bracketAround(n);
  if (bracket) {
    return cx.s(`。クォートしていないので、値はパターンとして読まれる。\`${bracket}\` の \`[…]\` の中なので、値の文字は集合の文字になる（\`*\` や \`?\` はその文字そのもの。\`a-c\` のような範囲は働く。ただし、集合の先頭にある \`!\` か \`^\` は否定、最初の文字より後の \`]\` は集合の終わり、\`[:digit:]\` は文字クラスになる）`,
      `. Unquoted here, its value is read as part of the pattern: inside the \`[…]\` of \`${bracket}\`, its characters join the set (a \`*\` or \`?\` in it is that character; a range such as \`a-c\` works; but a \`!\` or \`^\` at the start of the set negates it, a \`]\` after the first character ends it, and \`[:digit:]\` is a class)`);
  }
  return match === 'pattern'
    ? cx.s('。クォートしていないので、値はパターンとして読まれる（値の中の `*`、`?`、`[…]` が働く。文字列として比べるなら `"$…"` とクォートする）',
      '. Unquoted here, its value is read as a pattern (`*`, `?` and `[…]` in it match; quote it to compare text)')
    : cx.s('。クォートしていないので、値は正規表現として読まれる', '. Unquoted here, its value is read as a regex');
}

/**
 * `z=2 echo $z` expands `$z` before the assignment takes effect; `x=1 y=$x` sets `x` first. A note on a
 * use of a variable that an assignment of the same command sets.
 */
export function orderNote(cx: Explainer, n: SyntaxNode, name: string): string {
  const top = (parent: SyntaxNode) => { let c = n; while (c.parent && !same(c.parent, parent)) c = c.parent; return c; };
  const sets = (a: SyntaxNode) => a.type === 'variable_assignment' && field(a, 'name')?.text === name;
  const cmd = ancestor(n, (a) => a.type === 'command');
  if (!cmd) return '';
  const mine = top(cmd);
  if (assignmentsOnly(cmd)) {
    // (With no name, bash assigns first and then expands the redirections: `>f$a a=1` writes `f1`.)
    if (mine.field === 'redirect') {
      return cmd.namedChildren.some(sets)
        ? cx.s(`。このコマンドには名前がないので、bash は先に \`${name}=…\` の代入を行い、そのあとでリダイレクトを展開する。ここではその値になる`, `. The command has no name, so bash does its assignments first and expands its redirections after them: \`${name}\` already has the value of \`${name}=…\` here`)
        : '';
    }
    return cmd.namedChildren.some((a) => sets(a) && a.endIndex <= mine.startIndex)
      ? cx.s(`。同じ行で先に \`${name}=…\` と代入しているので、代入は左から順に実行され、ここではその値になる`, `. \`${name}=…\` comes earlier on this line, and assignments run from left to right, so it already has that value here`)
      : '';
  }
  // In the arguments (not in an assignment) of a command that is run with the variable set for it only.
  return field(cmd, 'name') && !(mine.type === 'variable_assignment' && mine.field !== 'argument') && cmd.namedChildren.some((a) => sets(a) && a.endIndex <= field(cmd, 'name')!.startIndex)
    ? cx.s(`。\`${name}=…\` はこのコマンドの実行中だけ有効で、引数の展開が先に行われるので、ここでは代入前の値（未設定なら空）になる`, `. \`${name}=…\` only applies while the command runs, and the arguments are expanded first, so this is the value from before the assignment (empty if unset)`)
    : '';
}

/** The places where a word stays one string, and how the notes name them (src/semantics/words.ts, `CONTEXTS`). */
const JOINED: Partial<Record<string, [string, string]>> = {
  'assignment-value': ['代入の値', 'the value of an assignment'],
  herestring: ['ヒアストリング', 'a here-string'],
  'case-word': ['`case` の単語', 'the word of `case`'],
  'cond-operand': ['`[[ ]]` の中', '`[[ ]]`'],
};

/**
 * `t=${a[@]}`, `t=$*`: where a word stays one string, all the elements (or arguments) of `n` are joined into one, with a
 * space for `@` and the first character of `IFS` for `*` (manual 3.4.2, 3.4); undefined elsewhere. `of`: `@` or `*`.
 */
export function joinedNote(cx: Explainer, n: SyntaxNode, of: '@' | '*', args: boolean): string | undefined {
  const part = partMeaning(n, cx.state);
  const where = part && JOINED[part.word.context];
  if (!where) return undefined;
  const items = args ? cx.s('引数', 'arguments') : cx.s('要素', 'elements');
  const ifs = part.word.ifs;
  const sep = of === '@' || ifs.kind === 'default' ? cx.s('空白', 'a space')
    : ifs.kind === 'unknown' ? cx.s(' `IFS` の先頭の文字', 'the first character of `IFS`')
      : ifs.value === '' ? undefined : cx.s(` \`IFS\` の先頭の文字 \`${shown(ifs.value[0])}\` `, `the first character of \`IFS\`, \`${shown(ifs.value[0])}\``);
  return sep
    ? cx.s(`。${where[0]}は単語分割されないので、${items}は${sep}で区切って1つの文字列につながる（クォートしても別々にはならない）`,
      `. In ${where[1]} there is no word splitting: the ${items} are joined into one string, separated by ${sep} (quoting does not keep them apart)`)
    : cx.s(`。${where[0]}は単語分割されないので、${items}は区切りなしで1つの文字列につながる（\`IFS\` が空）`,
      `. In ${where[1]} there is no word splitting: the ${items} are joined into one string with nothing between them (\`IFS\` is empty)`);
}

/** `$y` on an array is its element 0; `$_` after an assignment is empty; `$x` inside `$(( ))` is pasted as text. */
export function variableNote(cx: Explainer, n: SyntaxNode, name: string): string {
  if (name === '$') return pidNote(cx, n);
  const st = cx.state.at(n).run;
  const a = attribute(st, name, 'a');
  const assoc = attribute(st, name, 'A');
  const arr = a === 'on' || assoc === 'on' ? { assoc: assoc === 'on' } : undefined;
  if (!arr && (a === 'unknown' || assoc === 'unknown')) {
    // An array on some paths only (a loop that may not run, a branch).
    return cx.s(`。\`${name}\` は一部の経路（分岐やループ）で配列になる。そのときは \`$${name}\` は先頭の要素だけで、全要素は \`"\${${name}[@]}"\``,
      `. \`${name}\` is an array on some paths (a branch or a loop): there \`$${name}\` is only its first element, and all of them are \`"\${${name}[@]}"\``);
  }
  if (arr) {
    const first = `\${${name}[0]}`;
    return cx.s(`。\`${name}\` は配列なので、\`$${name}\` は${arr.assoc ? 'キー 0 の要素' : '先頭の要素'}だけ（\`${first}\`）になる。全要素は \`"\${${name}[@]}"\``, `. \`${name}\` is an array, so \`$${name}\` is only ${arr.assoc ? 'the element with key 0' : 'its first element'} (\`${first}\`); all of them are \`"\${${name}[@]}"\``);
  }
  if (name === '_' && underscoreValue(n, cx.state) === '') {
    return cx.rests(cx.s('。直前のコマンドは代入だけなので、`$_` は空になる', '. The command before is only an assignment, so `$_` is empty'), 'underscore-after-assignment');
  }
  if (inArithmetic(n) && pastedValue(cx, n, name) !== undefined) {
    const v = shown(pastedValue(cx, n, name)!);
    return cx.s(`。算術式の中の \`$${name}\` は、値（ここでは \`${v}\`）が文字のまま貼り付けられてから式として読まれる。\`${name}\` と名前だけで書くと、値が 1 つの式として計算されてから使われる（\`${name}='1+2'\` なら \`$${name}*2\` は \`1+2*2\` で 5、\`${name}*2\` は 3*2 で 6）`,
      `. Inside arithmetic, \`$${name}\` is pasted as text (here \`${v}\`) and then read as an expression. Written as the bare name \`${name}\`, its value is evaluated as one expression first (with \`${name}='1+2'\`, \`$${name}*2\` is \`1+2*2\`, which is 5, and \`${name}*2\` is 3*2, which is 6)`);
  }
  return '';
}

/** The value of `name` where `n` runs (src/semantics/state.ts), when it is known and not a plain integer (it has operators or names in it). */
function pastedValue(cx: Explainer, n: SyntaxNode, name: string): string | undefined {
  const v = cx.state.at(n).run.variables.get(name);
  const value = v?.set === 'on' ? v.value : undefined;
  return value !== undefined && !/^\s*[-+]?\d+\s*$/.test(value) ? value : undefined;
}

/**
 * A value of a compound assignment that says more than a word (6.7): `[7]=z`, an element with an index of its own, or
 * in the list of an associative array with no `[k]=` first, a key or the value of the key before it (with the tokens of
 * its parts, but for a plain word). bash 5.2 and 5.3 differ on a few (checked with both): bash 5.2 brace-expands
 * `[4]={a,b}` into plain values; a `~` in an associative array's list is expanded by 5.3 only; after a value with no
 * `[k]=` there, 5.3 also abandons the rest of the line.
 */
function arrayValue(cx: Explainer, n: SyntaxNode): Token | undefined {
  const kind = arrayKind(cx, field(n.parent!.parent!, 'name')!.text, n);
  const tilde = kind === 'assoc' && /(?:^|\[|=)~/.test(n.text)
    ? cx.rests(cx.s('。`~` は bash 5.2 では書いたままの文字列で、bash 5.3 ではホームディレクトリに展開される', '. bash 5.2 keeps the `~` as written; bash 5.3 expands it to the home directory'), 'assoc-tilde') : '';
  if (setsElement(n, kind === 'assoc')) return arrayElement(cx, n, kind, tilde);
  if (kind !== 'assoc') return undefined;
  const values = n.parent!.namedChildren.filter((c) => c.type !== 'comment');
  // (After a first value `[k]=v`, each needs its `[k]=`.)
  if (splitElement(values[0].text)) {
    return cx.tok(n, 'error', cx.rests(cx.s(`bash はこの値を受け付けない: 最初の値が \`[キー]=\` で始まるので、どの値にも \`[キー]=\` が要る（「must use subscript when assigning associative array」）。bash 5.2 はそう表示して続けるが、bash 5.3 はさらにこの行の残りを実行しない（終了ステータス 1）`,
      `Bash refuses this value: the first value starts with \`[key]=\`, so each one needs its \`[key]=\` ("must use subscript when assigning associative array"). bash 5.2 says so and goes on; bash 5.3 also abandons the rest of the line (status 1)`), 'assoc-missing-subscript'));
  }
  const i = values.indexOf(n);
  const what = (i % 2 === 0 ? cx.s(`キー \`${n.text}\``, `Key \`${n.text}\``) : cx.s(`キー \`${values[i - 1].text}\` の値 \`${n.text}\``, `Value \`${n.text}\` of the key \`${values[i - 1].text}\``)) + tilde;
  // (A value of one part, `$x` or `"a b"`, whose token says it too; braces are text there, `{a,b}`.)
  const [part] = n.type === 'concatenation' || n.type === 'brace_expression' || isPlainWord(n) ? [] : cx.sub(n);
  return part ? { ...part, explanation: `${what}: ${part.explanation}` } : cx.tok(n, 'argument', what, n.type === 'concatenation' ? cx.sub(n) : []);
}

/** `[7]=z` in `( )`: an element with an index of its own; `kind`: the array's; `more`: what to add. */
function arrayElement(cx: Explainer, n: SyntaxNode, kind: 'assoc' | 'indexed' | 'unknown', more: string): Token {
  const e = splitElement(n.text)!;
  // (bash 5.2 brace-expands the word first, into values with no index of their own.)
  const braces = wordAt(cx, n)!.steps.find((s) => s.kind === 'brace')!.applies === true ? braceExpansion(n) : undefined;
  if (braces) {
    return cx.tok(n, 'argument', cx.rests(cx.s(`bash 5.2 はこの語を先にブレース展開し、${braces.map((w) => `\`${w}\``).join('・')} という添字のない値にする（それぞれが次の要素になる）。bash 5.3 はブレース展開せず、添字 \`${e.key}\` の要素に \`${e.value}\` を${e.plus ? '追記' : '代入'}する`,
      `bash 5.2 brace-expands this word first, into the values ${braces.map((w) => `\`${w}\``).join(', ')}, with no index of their own (each is the next element); bash 5.3 does not, and ${e.plus ? 'appends' : 'sets'} \`${e.value}\` ${e.plus ? 'to' : 'as'} the element with the index \`${e.key}\``), 'array-brace-value'));
  }
  // The key as bash reads it once the quotes are removed (`["a b"]` is `a b`); as written when it holds an expansion.
  const key = unquoteWord(e.key) ?? e.key;
  const m = ['', key, e.plus, e.value];
  // The subscript of an associative array is a key (a string); that of an indexed array is arithmetic (`1+1` is 2).
  // (Arithmetic only when the array is surely not associative: `declare -A` may be in a file read with `source`.)
  const v = evalArith(m[1]);
  const what = kind === 'assoc' ? cx.s(`キー \`${m[1]}\`（文字列で、計算はされない）`, `key \`${m[1]}\` (a string, not evaluated)`)
    : kind === 'unknown' ? cx.s(`添字 \`${m[1]}\`（連想配列ならキー、そうでなければ算術式）`, `subscript \`${m[1]}\` (a key if the array is associative, an arithmetic expression otherwise)`)
    : v !== undefined && String(v) !== m[1] ? cx.s(`添字 \`${m[1]}\`（算術式として計算すると ${v}）`, `index \`${m[1]}\` (an arithmetic expression: ${v})`)
    : v !== undefined ? cx.s(`添字 \`${m[1]}\``, `index \`${m[1]}\``)
    // (`[k]=w` is index 0 when `k` is not set: a name is a variable.)
    : /^[A-Za-z_]\w*$/.test(m[1]) ? cx.s(`添字 \`${m[1]}\`（算術式なので変数 \`${m[1]}\` の値。未設定なら 0）`, `index \`${m[1]}\` (an arithmetic expression: the value of the variable \`${m[1]}\`, 0 when it is not set)`)
      : cx.s(`添字 \`${m[1]}\`（算術式として計算される）`, `index \`${m[1]}\` (an arithmetic expression)`);
  return cx.tok(n, 'argument', cx.s(
    `${what}${what.endsWith('`') ? ' ' : ''}の要素に \`${m[3]}\` を${m[2] ? '追記' : '代入'}する`,
    `Element with ${what}: ${m[2] ? 'append' : 'set it to'} \`${m[3]}\``,
  ) + more);
}

export function subscript(cx: Explainer, n: SyntaxNode): Token {
  const name = field(n, 'name')!.text;
  const idx = field(n, 'index')!.text;
  // (A subscript explained alone is in arithmetic, which takes one element: `(( a[@] ))` fails.)
  if (idx === '@' || idx === '*') {
    return cx.tok(n, 'error', cx.s(`算術式では \`${n.text}\` は使えず、エラーになる（\`bad array subscript\`）。要素は \`${name}[0]\` のように1つずつ指定する`,
      `Not allowed in arithmetic: \`${n.text}\` is an error (\`bad array subscript\`); name one element, such as \`${name}[0]\``));
  }
  // The index is arithmetic (`a[0x1]` is element 1).
  const index = field(n, 'index')!;
  const num = arithNumber(cx, index);
  if (isAssoc(cx, name, n)) return cx.tok(n, 'variable', cx.s(`連想配列 \`${name}\` のキー \`${idx}\`（文字列）の要素`, `Element of associative array \`${name}\` with the key \`${idx}\` (a string)`));
  return cx.tok(n, 'variable', cx.s(`配列 \`${name}\` の要素 \`[${idx}]\``, `Element \`[${idx}]\` of array \`${name}\``), num ? [num] : []);
}

/** The expressions of an arithmetic command or expansion, with its commas. */
export function arithChildren(cx: Explainer, n: SyntaxNode): Token[] {
  const commas = n.children.filter((c) => c.type === ',').map((c) => cx.tok(c, 'operator', cx.s('`,` コンマ演算子: 左の式を評価して値を捨て、右の式に進む', '`,` comma operator: evaluate the left expression, drop its value, go on to the right one')));
  return sortTokens([...cx.subs(n.namedChildren), ...commas]);
}

/** A constant of an arithmetic expression that is not plain decimal (`0x1F`, `010`, `2#1010`), with its value; undefined for anything else. */
export function arithNumber(cx: Explainer, n: SyntaxNode): Token | undefined {
  const lit = arithLiteral(n.text);
  if (!lit || (lit.type === 'number' && lit.style === 'decimal') || !inArithmetic(n)) return undefined;
  return cx.tok(n, 'number', arithLiteralText(cx, n.text, lit));
}

function arithLiteralText(cx: Explainer, text: string, lit: ArithLiteral): string {
  return describeArithLiteral(text, lit, cx.lang);
}

/** The `,` of an arithmetic expression: a note that its parts run left to right and the last one is the value. */
export function commaNote(cx: Explainer, n: SyntaxNode): string {
  if (!n.children.some((c) => c.type === ',')) return '';
  const last = n.namedChildren[n.namedChildren.length - 1].text;
  return n.type === 'arithmetic_command'
    ? cx.s(`。\`,\` で区切られた式は左から順に評価され、結果は最後の式 \`${last}\` の値で決まる`, `. The expressions separated by \`,\` run from left to right, and the result is that of the last one, \`${last}\``)
    : cx.s(`。\`,\` で区切られた式は左から順に評価され、全体の値は最後の式 \`${last}\` の値になる`, `. The expressions separated by \`,\` are evaluated from left to right, and the value is that of the last one, \`${last}\``);
}

/** `$((1<<63))`: bash's integers are 64-bit, and a result beyond them wraps around instead of failing. */
export function wrapNote(cx: Explainer, n: SyntaxNode): string {
  const r = evalArithWrapping(n.text.replace(/^\$(?:\(\(|\[)/, '').replace(/(?:\)\)|\])$/, ''));
  return r?.wrapped
    ? cx.s(`。bash の整数は符号付き 64 ビットで、範囲を超えるとエラーにならず一周して戻るので、この値は ${r.value} になる`,
      `. Bash integers are signed 64-bit, and a result beyond that wraps around instead of failing, so this is ${r.value}`)
    : '';
}

/** `$(( … ))`, and the obsolete `$[ … ]`. */
export function arithmeticExpansion(cx: Explainer, n: SyntaxNode): Token {
  return cx.tok(n, 'substitution', cx.s('算術展開: 中の式を整数として計算した結果に置き換える', 'Arithmetic expansion: replaced by the integer result of the expression')
    + (n.text.startsWith('$[') ? cx.s('。`$[…]` は古い書き方（廃止予定）で、`$((…))` と同じ意味', '. `$[…]` is the obsolete form of `$((…))`') : '') + commaNote(cx, n) + wrapNote(cx, n), arithChildren(cx, n));
}

/** A single-quoted string. */
export function rawString(cx: Explainer, n: SyntaxNode): Token {
  return cx.tok(n, 'string', cx.s('シングルクォート文字列: 中身は一切展開されず、そのままの文字列になる', 'Single-quoted string: taken literally, nothing is expanded'));
}

/**
 * `$a[1]` (also in double quotes), where `a` is an array: `$a`, then the text `[1]`, not the element (6.7: the braces
 * are required, `${a[1]}`).
 */
function unbracedElement(cx: Explainer, n: SyntaxNode): void {
  n.namedChildren.forEach((k, i) => {
    // (The text after it, which may hold expansions: `$a[$i]`.)
    const sub = /^\[[^\]]*\]/.exec(n.text.slice(k.endIndex - n.startIndex))?.[0];
    const name = k.text.slice(1);
    const st = cx.state.at(k).run;
    if (k.type !== 'simple_expansion' || !sub || !/^[A-Za-z_]\w*$/.test(name)) return;
    if (attribute(st, name, 'a') !== 'off' || attribute(st, name, 'A') !== 'off') cx.note(fact(cx.lang, 'unbraced-element', { name, sub, ...(wordAt(cx, n)!.steps.find((s) => s.kind === 'glob')!.applies === false ? {} : { glob: true }), rewrite: [replaceRange(k, k.startIndex, k.endIndex + sub.length, `\${${name}${sub}}`)] }), k);
  });
}

/** A word of several parts (`a"b"$c`): an element of an array assignment that bash splits, a brace expansion, or the parts joined. */
export function concatenation(cx: Explainer, n: SyntaxNode): Token {
  unbracedElement(cx, n);
  // (A word of plain text with braces that do not expand here, `x{a,b}` in dash, is one word.)
  if (plainText(n)) return braceWord(cx, n) ?? word(cx, n);
  return cx.tok(n, 'argument', concatenationNote(cx, n) + valueNote(cx, n) + braceVarNote(cx, n), cx.subs(n.namedChildren));
}

/** A number: a constant of arithmetic that is not plain decimal, with its value (`arithNumber`), or a plain number. */
export function number(cx: Explainer, n: SyntaxNode): Token {
  return arithNumber(cx, n) ?? cx.tok(n, 'number', cx.s('数値', 'Number'));
}

/** `( … )` of an array assignment: its values, which say more than words where `arrayValue` does. */
export function array(cx: Explainer, n: SyntaxNode): Token {
  // (A list over several lines is explained whole: every value is on the line.)
  const values = n.namedChildren.flatMap((c) => (c.type === 'comment' ? cx.sub(c) : [arrayValue(cx, c) ?? cx.full(c)]));
  return cx.tok(n, 'expansion', cx.s('配列: `( )` 内の要素から配列を作る', 'Array: built from the elements inside `( )`'), values);
}
