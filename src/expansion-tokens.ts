// The explanation of a parameter expansion `${…}`: what it gives as a whole, a worked example, and each of its parts
// (prefix, name, subscript, operator, word, pattern, offset, length, transform). What it needs of the analyzer (the
// descriptions of variables, the notes on a variable) it asks of the analyzer's words, and the rest of the line's
// context (src/explain/context.ts) and its readers (src/explain/reads.ts: the attributes in effect).
import type { Kind, Span, Token } from './analyzer-types';
import { evalArith, intValue } from './arith';
import { cannotAssign, expansionOps } from './dict/syntax';
import type { Explainer } from './explain/context';
import { isAssoc } from './explain/reads';
import { globIntro, hasGlob } from './embedded/glob';
import { ExpansionPart, exampleFor, globParts, opMeaning, ParsedExpansion, parseExpansion, slicesElements, transformMeaning } from './expansion';
import { Lang, ordinal, Text } from './i18n';
import { isPlainWord, unquoteWord } from './staticword';
import { field, type SyntaxNode } from './syntax/tree';

/** What the explanation of a `${…}` asks of the analyzer's words, for the line being explained. */
export interface ExpansionWords {
  /** What a variable is, when it is a special, positional, well-known or CI variable. */
  varDesc(name: string): string | undefined;
  /** The notes on a use of a variable (its value where it is known, a pasted value…). */
  variableNote(n: SyntaxNode, name: string): string;
  /** A note on a use of a variable that an assignment of the same command sets. */
  orderNote(n: SyntaxNode, name: string): string;
  /** The parts of a glob pattern as tokens, placed where it is written (`base` characters into `n`). */
  globChildren(n: SyntaxNode, text: string, base: number): Token[];
}

/** Nodes inside an expansion's argument that get their own explanation. */
const NESTED = new Set(['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution', 'string', 'raw_string']);

const plural = (n: number, word: string) => `${word}${n === 1 ? '' : 's'}`;

/** Whether the node is in double quotes (a string, or a here-document), not counting those outside a `$(…)` around it. */
function inDoubleQuotes(n: SyntaxNode): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === 'string' || p.type === 'heredoc_body') return true;
    if (p.type === 'command_substitution' || p.type === 'process_substitution') return false;
  }
  return false;
}

/** `${…}`: the overall meaning plus a worked example, broken down into its parts. */
export function explainExpansion(h: Explainer, w: ExpansionWords, n: SyntaxNode): Token {
  // `${#a-b}` and `${#a[1]b}`: the length of a name takes no operator. The parser reads `$#` with an operator; bash says "bad substitution".
  const hash = n.children[1];
  const op = field(n, 'operator');
  if (n.type === 'expansion' && hash?.type === 'special_variable_name' && hash.text === '#' && op && /^[\w[]/.test(op.text)) {
    return h.tok(n, 'error', h.s('パラメータ展開: bash は「bad substitution」のエラーにする（`${#` の後ろに変数名を書いたら、演算子は付けられない）', 'Parameter expansion: bash reports "bad substitution" (a `${#name}` length takes no operator)'));
  }
  // `${(f)var}`: parameter flags are zsh's; bash reads `(f)var` as a name and says "bad substitution" (with zsh as the shell, the dialect check marks the line as not parsed).
  if (n.type === 'expansion' && n.text.startsWith('${(') && h.shell !== 'zsh') {
    return h.tok(n, 'error', h.s('パラメータ展開: bash は「bad substitution」のエラーにする（`${(` のパラメータフラグは zsh の書き方）', 'Parameter expansion: bash reports "bad substitution" (`${(f)var}` parameter flags are zsh syntax)'));
  }
  const summary = expansionSummary(h, w, n);
  const text = n.text;
  const parsed = n.startPosition.row === n.endPosition.row ? parseExpansion(text) : undefined;
  if (!parsed) return summary;
  summary.explanation += w.orderNote(n, parsed.name);
  const special = specialExpansion(h, w, parsed, text);
  if (special) {
    summary.explanation = special;
    if (!parsed.prefix && !parsed.op) summary.kind = 'variable';
  }
  const tf = parsed.op === '@' ? transformMeaning[parsed.parts.find((p) => p.role === 'transform')?.text ?? ''] : undefined;
  if (tf) summary.explanation = h.s(`パラメータ展開: \`${parsed.name}\` の値を${tf[0]}`, `Parameter expansion: take the value of \`${parsed.name}\` and ${tf[1]}`);
  else if (parsed.op === '@' && parsed.parts.some((p) => p.role === 'transform')) summary.explanation = h.s('パラメータ展開: bash は「bad substitution」のエラーにする（`@` の後ろの文字が変換の種類ではない）', 'Parameter expansion: bash reports "bad substitution" (the letter after `@` is not a transform)');
  if (parsed.op === ':') summary.explanation = h.s('パラメータ展開: ', 'Parameter expansion: ') + substringSummary(h, parsed);
  const cases = exampleFor(parsed, h.lang, { quoted: inDoubleQuotes(n), assoc: isAssoc(h, parsed.name, n) });
  // A `${…}` on one line is always on the line explained.
  if (cases) {
    h.example({ kind: 'expansion',
      title: h.s(`\`${text}\` の例`, `Example for \`${text}\``),
      // The title already names the expansion.
      target: '',
      anchor: summary.span,
      sections: cases.map((c) => ({ label: c.when, lines: c.result ? [c.result] : [], empty: h.s('（空文字）', '(empty string)') })),
    });
  }
  const row = n.startPosition.row;
  const col = n.startPosition.column;
  const mainOp = parsed.parts.find((p) => p.role === 'op');
  summary.children = parsed.parts.flatMap((part) => {
    const expl = expansionPart(h, w, parsed, part, part === mainOp, isAssoc(h, parsed.name, n));
    if (!expl || !part.text) return [];
    const span: Span = { start: { line: row, character: col + part.start }, end: { line: row, character: col + part.end } };
    const nested = nestedIn(h, n, col + part.start, col + part.end);
    // The parts of a glob pattern (those with an expansion in them have only the expansions).
    const globbed = part.role === 'pattern' && !nested.length ? w.globChildren(n, part.text, part.start) : [];
    return [{ kind: expl[0], label: part.text, explanation: expl[1], span, children: [...nested, ...globbed] }];
  });
  return summary;
}

/** `${#}`, `${##}`, `${#@}`, `${#-x}`…: the special parameters with a `#` or an operator, which are easy to misread. Undefined for the other expansions. */
function specialExpansion(h: Explainer, w: ExpansionWords, p: ParsedExpansion, text: string): string | undefined {
  const shownName = `$${p.name}`;
  if (p.prefix === '#' && !p.subscript && (p.name === '@' || p.name === '*')) {
    return h.s(`位置パラメータの個数（\`$#\` と同じ。文字数ではない）`, 'Number of positional parameters (the same as `$#`, not a length in characters)');
  }
  if (p.prefix === '#' && !p.subscript && /^[#?$!0-]$/.test(p.name)) {
    return p.name === '#'
      ? h.s('`$#`（引数の個数）の文字数。引数が 10 個以上なら 2 になる', 'Length of `$#` (the number of arguments) in characters: 2 from ten arguments on')
      : h.s(`\`${shownName}\` の文字数（長さ）`, `Length of \`${shownName}\` in characters`);
  }
  if (p.prefix === '!' && p.name === '#' && !p.subscript && !p.op) {
    return h.s('間接参照: `$#`（引数の個数）を番号とみなし、その位置パラメータ、つまり最後の引数を取り出す（引数が 3 個なら `$3`）', 'Indirection through `$#`: the positional parameter numbered `$#` is the last argument (`$3` when there are 3)');
  }
  if (p.prefix || !/^[#?$!@*-]$/.test(p.name)) return undefined;
  if (!p.op) return `\`\${${p.name}}\`: ${w.varDesc(p.name)}`;
  const mainOp = p.parts.find((x) => x.role === 'op')!;
  // `${@:2}` and `${@@Q}` have their own wording.
  if (p.op === ':' || p.op === '@') return undefined;
  return h.s('パラメータ展開: ', 'Parameter expansion: ') + h.t(expansionOps[p.op](shownName, text.slice(mainOp.end, -1)));
}

function substringSummary(h: Explainer, p: ParsedExpansion): string {
  const off = p.parts.find((x) => x.role === 'offset')!.text.trim();
  const len = p.parts.find((x) => x.role === 'length')?.text.trim();
  const name = p.name;
  const o = intValue(off);
  const l = len === undefined ? undefined : intValue(len);
  if (slicesElements(p)) {
    const args = p.name === '@' || p.name === '*';
    const what = args ? h.s('位置パラメータ', 'the positional parameters') : h.s(`配列 \`${name}\` の要素`, `the elements of array \`${name}\``);
    if (o !== undefined && o < 0) {
      const from = args ? h.s(`最後から ${-o} 番目`, `the ${-o === 1 ? 'last one' : `${ordinal(-o)} from the end`}`) : h.s(`最大のインデックス + 1 から ${-o} 戻った位置`, `${-o} before one past the highest index`);
      return h.s(`${what}を、${from}から${len === undefined ? '最後まで' : ` \`${len}\` 個`}取り出す`,
        `take ${len === undefined ? '' : `\`${len}\` of `}${what} starting at ${from}`);
    }
    return h.s(`${what}を、${args ? `\`$${off}\`` : `インデックス \`${off}\``} から${len === undefined ? '最後まで' : ` \`${len}\` 個`}取り出す`,
      `take ${len === undefined ? '' : `\`${len}\` of `}${what} from ${args ? `\`$${off}\`` : `index \`${off}\``}${len === undefined ? ' on' : ''}`);
  }
  if (o === undefined || (len !== undefined && l === undefined)) {
    return h.s(`\`${name}\` の部分文字列を取り出す（開始位置 \`${off}\`${len !== undefined ? `、長さ \`${len}\`` : ''}）`,
      `take a substring of \`${name}\` (offset \`${off}\`${len !== undefined ? `, length \`${len}\`` : ''})`);
  }
  const fromJa = o < 0 ? `末尾から ${-o} 文字目` : ` ${o + 1} 文字目`;
  const fromEn = o < 0 ? `${-o} ${plural(-o, 'character')} from the end` : `the ${ordinal(o + 1)} character`;
  if (l === undefined && o < 0) return h.s(`\`${name}\` の末尾 ${-o} 文字を取り出す`, `take the last ${-o} ${plural(-o, 'character')} of \`${name}\``);
  if (l === undefined) return h.s(`\`${name}\` の${fromJa}から最後までを取り出す`, `take \`${name}\` from ${fromEn} to the end`);
  if (l! < 0) return h.s(`\`${name}\` の${fromJa}から、末尾の ${-l!} 文字を除いた位置までを取り出す`, `take \`${name}\` from ${fromEn} up to ${-l!} ${plural(-l!, 'character')} before the end`);
  return h.s(`\`${name}\` の${fromJa}から ${l} 文字を取り出す`, `take ${l} ${plural(l!, 'character')} of \`${name}\` starting at ${fromEn}`);
}

/** Expansions, substitutions and strings inside a column range of a single-line node. */
function nestedIn(h: Explainer, n: SyntaxNode, from: number, to: number): Token[] {
  const found: SyntaxNode[] = [];
  const visit = (x: SyntaxNode) => {
    for (const c of x.namedChildren) {
      const inside = c.startPosition.column >= from && c.endPosition.column <= to;
      if (inside && NESTED.has(c.type)) found.push(c);
      else visit(c);
    }
  };
  visit(n);
  return found.map((c) => h.full(c));
}

function expansionPart(h: Explainer, w: ExpansionWords, p: ParsedExpansion, part: ExpansionPart, isMainOp: boolean, assoc = false): [Kind, string] | undefined {
  const t = part.text;
  const s = (ja: string, en: string): string => h.s(ja, en);
  switch (part.role) {
    case 'prefix':
      if (t === '#' && !p.subscript && (p.name === '@' || p.name === '*')) return ['operator', s('`#`: 位置パラメータの個数を返す', '`#`: gives the number of positional parameters')];
      if (t === '#') return ['operator', s('`#`: 値の長さ（文字数、配列なら要素数）を返す', '`#`: gives the length (characters, or elements for an array)')];
      if (p.op === '*' || p.op === '@') return ['operator', s('`!`: この名前で始まる変数名の一覧を返す', '`!`: lists variable names starting with this prefix')];
      if (p.subscript === '@' || p.subscript === '*') return ['operator', s('`!`: 配列の値ではなくインデックス（キー）を返す', '`!`: gives the indices (keys) instead of the values')];
      return ['operator', s('`!`: 間接参照。変数の値を別の変数名として使う', '`!`: indirection; use the value as another variable\'s name')];
    case 'name': {
      const d = w.varDesc(t);
      if (p.prefix === '!' && (p.op === '*' || p.op === '@')) return ['variable', s(`変数名の接頭辞 \`${t}\``, `Variable name prefix \`${t}\``)];
      if (p.subscript !== undefined) return ['variable', d ? s(`配列 \`${t}\`: ${d}`, `Array \`${t}\`: ${d}`) : s(`配列 \`${t}\``, `Array \`${t}\``)];
      return ['variable', d ? `\`$${t}\`: ${d}` : s(`変数 \`${t}\``, `Variable \`${t}\``)];
    }
    case 'subscript': {
      const idx = p.subscript!;
      if ((idx === '@' || idx === '*') && p.prefix) return ['variable', s(`\`[${idx}]\`: 配列のすべての要素を対象にする`, `\`[${idx}]\`: applies to every element of the array`)];
      if (idx === '@') return ['variable', s('`[@]`: すべての要素（`"${a[@]}"` とクォートすると各要素が別々の単語になる）', '`[@]`: every element (quoted, `"${a[@]}"` keeps each element a separate word)')];
      if (idx === '*') return ['variable', s('`[*]`: すべての要素（`"${a[*]}"` とクォートすると、`IFS` の先頭の文字で区切った1つの文字列に連結される）', '`[*]`: every element (quoted, `"${a[*]}"` joins them into one string, separated by the first character of `IFS`)')];
      if (p.name === 'BASH_REMATCH' && /^\d+$/.test(idx)) {
        return ['variable', idx === '0'
          ? s('インデックス 0: `=~` で一致した全体', 'Index 0: the whole text the `=~` matched')
          : s(`インデックス ${idx}: 正規表現の ${idx} 番目の括弧 \`( )\` に一致した部分`, `Index ${idx}: the text matched by group ${idx}, the ${ordinal(Number(idx))} \`( )\` of the regex`)];
      }
      if (assoc) return ['variable', s(`キー \`${idx}\`（連想配列のキーは文字列で、計算されない）`, `Key \`${idx}\` (the keys of an associative array are strings, not evaluated)`)];
      const i = evalArith(idx);
      if (i !== undefined) {
        // The index is an arithmetic expression: `1+1` is 2, `010` is 8.
        const calc = String(i) === idx ? '' : s(`（算術式として計算すると ${i}）`, ` (an arithmetic expression: ${i})`);
        return ['variable', i < 0
          ? s(`インデックス ${idx}${calc}: 末尾から ${-i} 番目の要素`, `Index ${idx}${calc}: ${i === -1 ? 'the last element' : `the ${ordinal(-i)} element from the end`}`)
          : s(`インデックス ${idx}${calc}: ${i + 1} 番目の要素（0 始まり）`, `Index ${idx}${calc}: the ${ordinal(i + 1)} element (0-based)`)];
      }
      return ['variable', s(`インデックス（連想配列ならキー） \`${idx}\``, `Index (or key, for associative arrays) \`${idx}\``)];
    }
    case 'op':
      if (!isMainOp) {
        return ['operator', t === ':'
          ? s('`:` 開始位置と長さの区切り', '`:` separates the offset from the length')
          : p.parts.find((x) => x.role === 'replacement')?.text
            ? s('`/` パターンと置換後の文字列の区切り', '`/` separates the pattern from the replacement')
            : s('`/` の後ろ（置換後の文字列）が空なので、一致した部分は削除される', 'Nothing follows this `/`, so the replacement is empty and matches are deleted')];
      }
      if (t === ':' && slicesElements(p)) return ['operator', s('`:`: 要素の一部を取り出す（`:開始位置:個数`）', '`:`: Take some of the elements (`:offset:count`)')];
      if (p.prefix === '!') return ['operator', t === '@' ? s('`@`: 見つかった名前を別々の単語にする（`"$@"` と同じ形。変換の `@` ではない）', '`@`: one word per name (like `"$@"`; not the `@` transform)') : s('`*`: 見つかった名前を1つにつなげる（クォート内では `IFS` の先頭の文字で区切る）', '`*`: join the names (inside double quotes, with the first character of `IFS`)')];
      if ((t === ':=' || t === '=') && !p.subscript && cannotAssign(`$${p.name}`)) return ['operator', s(`\`${t}\`: 位置パラメータには代入できないので、既定値が必要な場面では bash がエラー「cannot assign in this way」にする`, `\`${t}\`: the arguments cannot be assigned to, so where the default would be needed bash fails with "cannot assign in this way"`)];
      return ['operator', `\`${t}\`: ` + opMeaning[t][h.lang === 'ja' ? 0 : 1]];
    case 'word': {
      const op = p.op!;
      if (op === ':-' || op === '-') return ['argument', s(`既定値 \`${t}\`: \`${p.name}\` の代わりに使う値`, `Default \`${t}\`: used instead of \`${p.name}\``)];
      if ((op === ':=' || op === '=') && !p.subscript && cannotAssign(`$${p.name}`)) return ['argument', s(`\`${t}\`: 代入されない（bash はエラーにする）`, `\`${t}\`: never assigned (bash reports an error)`)];
      if (op === ':=' || op === '=') return ['argument', s(`既定値 \`${t}\`: \`${p.name}\` に代入されてから使われる`, `Default \`${t}\`: assigned to \`${p.name}\`, then used`)];
      if (op === ':+' || op === '+') return ['argument', s(`代替値 \`${t}\`: \`${p.name}\` が設定されているときに代わりに使う値`, `Alternate value \`${t}\`: used when \`${p.name}\` is set`)];
      return ['string', s(`エラーメッセージ「${t}」`, `Error message "${t}"`)];
    }
    case 'pattern': {
      const glob = globParts(t);
      const casePat = /^[\^,~]/.test(p.op!);
      const what = casePat ? s('変換する文字のパターン', 'Pattern of characters to convert') : s('パターン', 'Pattern');
      // The pattern is matched against one character at a time.
      const only = casePat ? (p.op!.length === 2
        ? s('。文字を1つずつ調べ、一致した文字だけが変換される', '. Each character is tried on its own; only those that match are converted')
        : s('。先頭の1文字がこれに一致したときだけ変換される', '. The first character is converted only if it matches')) : '';
      if (!glob) {
        // An extended glob (`+(a)`, `@(a|x)`) is a pattern of its own; only `$…` and backquotes are decided at run time.
        if (!/\$|`/.test(t)) return ['pattern', `${what} \`${t}\`: ${globIntro(h.lang, 'value')}` + s('。拡張グロブは `shopt -s extglob` が必要で、これがないと文字どおりの文字列として扱われる', '. An extended glob needs `shopt -s extglob`, or it is taken as literal text') + only]
        return ['pattern', s(`${what} \`${t}\`（変数などを含むため、内容は実行時に決まる）`, `${what} \`${t}\` (contains expansions, so it is decided at run time)`)];
      }
      return ['pattern', hasGlob(t) ? `${what} \`${t}\`: ${globIntro(h.lang, 'value')}${only}` : s(`${what} \`${t}\`（ワイルドカードを含まないので、この文字列そのものに一致）${only}`, `${what} \`${t}\` (no wildcards, so it matches exactly this text)${only}`)];
    }
    case 'replacement': {
      // The quotes and backslashes are removed: `\}` is `}`.
      const shown = unquoteWord(t) ?? t;
      return ['string', t
        ? s(`置換後の文字列 \`${shown}\``, `Replacement \`${shown}\``)
        : s('置換後の文字列: 空（一致した部分を削除する）', 'Replacement: empty (the match is deleted)')];
    }
    case 'offset': {
      const v = t.trim();
      const num = intValue(v);
      if (slicesElements(p)) {
        const args = p.name === '@' || p.name === '*';
        if (num !== undefined && num < 0) {
          return ['number', args
            ? s(`開始位置 ${v}: 最後から ${-num} 番目の引数から（負の値は最後から数える。\`$${v}\` という引数ではない）`, `Offset ${v}: from the ${-num === 1 ? 'last argument' : `${ordinal(-num)} argument from the end`} (a negative value counts from the end; it is not \`$${v}\`)`)
            : s(`開始位置 ${v}: 最大のインデックス + 1 から ${-num} 戻った位置の要素から（要素数ではなくインデックスで数えるので、歯抜けの配列では最後から ${-num} 番目とは限らない）`, `Offset ${v}: from the element ${-num} before one past the highest index (counted by index, not by number of elements, so on a sparse array it is not always the ${ordinal(-num)} from the end)`)];
        }
        return ['number', args
          ? s(`開始位置 ${v}: \`$${v}\` から（\`0\` なら \`$0\`）`, `Offset ${v}: from \`$${v}\` (\`0\` is \`$0\`)`)
          : s(`開始位置 ${v}: インデックス ${v} の要素から`, `Offset ${v}: from the element at index ${v}`)];
      }
      if (num === undefined) {
        // The `:` of a ternary is not the one before the length.
        const ternary = v.includes('?') ? s('。`?` とペアの `:` は三項演算子の一部で、長さの区切りではない', '. The `:` that pairs with the `?` belongs to the ternary; it does not start the length') : '';
        return ['number', s(`開始位置 \`${v}\`（算術式として評価される）${ternary}`, `Offset \`${v}\` (evaluated as arithmetic)${ternary}`)];
      }
      const o = num;
      if (o < 0) {
        return ['number', s(
          `開始位置 ${o}: 末尾から ${-o} 文字目から（負の値は \`:-\` と区別するため、前に空白か括弧が必要）`,
          `Offset ${o}: start ${-o} characters from the end (a space or parentheses is needed before a negative value, to tell it from \`:-\`)`)];
      }
      return ['number', s(`開始位置 ${o}: ${o + 1} 文字目から（0 始まり）`, `Offset ${o}: start at the ${ordinal(o + 1)} character (0-based)`)];
    }
    case 'length': {
      const v = t.trim();
      const l = intValue(v);
      if (slicesElements(p)) return ['number', s(`長さ ${v}: ${v} 個の要素（負の値はエラー）`, `Length ${v}: ${v} ${v === '1' ? 'element' : 'elements'} (a negative value is an error)`)];
      if (l === undefined) return ['number', s(`長さ \`${v}\`（算術式として評価される）`, `Length \`${v}\` (evaluated as arithmetic)`)];
      return ['number', l < 0
        ? s(`長さ ${l}: 末尾の ${-l} 文字を除いた位置まで`, `Length ${l}: up to ${-l} ${plural(-l, 'character')} before the end`)
        : s(`長さ ${l}: ${l} 文字分`, `Length ${l}: ${l} ${plural(l, 'character')}`)];
    }
    // `transform`
    default: {
      const m = transformMeaning[t];
      // Any letter can come after `@`; bash reports the ones it does not have as a bad substitution.
      if (!m) return ['error', h.s(`\`${t}\`: bash にない変換（bad substitution になる）`, `\`${t}\`: not a transform bash has (bash reports "bad substitution")`)];
      return ['operator', `\`${t}\`: ${m[h.lang === 'ja' ? 0 : 1]}`];
    }
  }
}

function expansionSummary(h: Explainer, w: ExpansionWords, n: SyntaxNode): Token {
  const kids = n.children;
  const inner = n.text.slice(2, -1);
  const target = kids.find((c) => ['variable_name', 'subscript', 'special_variable_name'].includes(c.type));
  const targetText = target?.text ?? inner;
  const isArrayAll = target?.type === 'subscript' && /\[[@*]\]$/.test(targetText);
  const prefixOp = kids[1] && !kids[1].named ? kids[1].type : '';

  if (prefixOp === '#' && target) {
    return h.tok(n, 'expansion', isArrayAll
      ? h.s(`配列 \`${targetText.replace(/\[.*/, '')}\` の要素数`, `Number of elements in array \`${targetText.replace(/\[.*/, '')}\``)
        + (targetText.startsWith('BASH_REMATCH[') ? h.s('（正規表現の括弧のグループの数 + 1。要素 0 が一致した全体）', ' (the number of groups in the regex + 1: element 0 is the whole match)') : '')
      : h.s(`変数 \`${targetText}\` の文字数（長さ）`, `Length of \`${targetText}\` in characters`));
  }
  // `${!prefix@}` / `${!prefix*}`: the names of the variables that start with the prefix (no indirection, no transform).
  const names = prefixOp === '!' ? /^!([A-Za-z_][A-Za-z0-9_]*)([@*])$/.exec(inner) : null;
  if (names) {
    const [, pre, sign] = names;
    const form = sign === '@'
      ? h.s('各名前が別々の単語になる（ダブルクォートの中でも別々）', 'each name is a separate word, also inside double quotes')
      : inDoubleQuotes(n)
        ? h.s('ダブルクォートの中なので、`IFS` の先頭の文字で区切った1つの単語になる', 'inside double quotes they form one word, joined with the first character of `IFS`')
        : h.s('クォートすると、`IFS` の先頭の文字で区切った1つの単語になる（クォートなしなら別々の単語）', 'quoted, they form one word joined with the first character of `IFS` (unquoted they are separate words)');
    return h.tok(n, 'expansion', h.s(`変数名の一覧: \`${pre}\` で始まる名前の変数をすべて挙げる（\`${pre}\` という変数の値は使わない）。${form}`,
      `Names of all variables starting with \`${pre}\` (the value of a variable \`${pre}\` is not used); ${form}`));
  }
  // `${!x@Q}`: indirection first, then the transform of the value found.
  const indirectTransform = prefixOp === '!' ? /^!([A-Za-z_][A-Za-z0-9_]*)@([QEPAKaULuk])$/.exec(inner) : null;
  if (indirectTransform) {
    const [, v, letter] = indirectTransform;
    const tf = transformMeaning[letter];
    return h.tok(n, 'expansion', h.s(`間接参照: 変数 \`${v}\` の値を変数名とみなし、その変数の値を${tf[0]}`,
      `Indirection: use the value of \`${v}\` as a variable name, then take that variable's value and ${tf[1]}`));
  }
  // `${!v:-x}`: indirection first, then the operator on the variable found. With `[@]` there is no key list: the value of the whole `a[@]` is taken as a name.
  const indirectOp = prefixOp === '!' && target ? kids.find((c, i) => i > 1 && c.field === 'operator') : undefined;
  if (indirectOp) {
    const arg = n.text.slice(indirectOp.endIndex - n.startIndex, -1);
    const make = expansionOps[indirectOp.type];
    const then = make ? h.t(make('<name>', arg)) : '';
    return h.tok(n, 'expansion', isArrayAll
      ? h.s(`間接参照: インデックスの一覧ではなく、\`${targetText}\` の値を変数名として使う。要素が2つ以上あると bash は「invalid variable name」のエラーにする。それから、\`<name>\` について: ${then}`,
        `Indirection: not the list of indices; the value of \`${targetText}\` is used as a variable name (bash fails with "invalid variable name" when there is more than one element). Then, for \`<name>\`: ${then}`)
      : h.s(`間接参照: 変数 \`${targetText}\` の値を変数名 \`<name>\` とみなす。それから: ${then}`,
        `Indirection: use the value of \`${targetText}\` as a variable name \`<name>\`. Then: ${then}`));
  }
  if (prefixOp === '!' && target) {
    return h.tok(n, 'expansion', isArrayAll
      ? h.s(`配列 \`${targetText.replace(/\[.*/, '')}\` のインデックス（キー）一覧`, `Indices (keys) of array \`${targetText.replace(/\[.*/, '')}\``)
      : h.s(`間接参照: 変数 \`${targetText}\` の値を変数名とみなし、その変数の値を取り出す`, `Indirection: use the value of \`${targetText}\` as a variable name`));
  }

  const opIdx = kids.findIndex((c, i) => i > 0 && c.field === 'operator');
  const base = target?.type === 'subscript' ? h.t(isArrayAll
    ? { ja: `配列 \`${targetText.replace(/\[.*/, '')}\` の全要素`, en: `all elements of array \`${targetText.replace(/\[.*/, '')}\`` }
    : { ja: `配列要素 \`${targetText}\``, en: `array element \`${targetText}\`` }) : undefined;
  if (opIdx > 0) {
    const op = kids[opIdx].type;
    const close = kids[kids.length - 1];
    // The grammar closes every `${` with `}`.
    const arg = n.text.slice(kids[opIdx].endIndex - n.startIndex, close.startIndex - n.startIndex);
    const make = expansionOps[op];
    if (arg === '' && (op === ':-' || op === '-')) {
      return h.tok(n, 'expansion', h.s(
        `パラメータ展開: \`${targetText}\` が未設定なら空文字として扱う（\`set -u\` でもエラーにしないための定番）`,
        `Parameter expansion: empty string if \`${targetText}\` is unset (avoids errors under \`set -u\`)`,
      ));
    }
    if (make) {
      const argNodes = kids.slice(opIdx + 1).filter((c) => c.named && !isPlainWord(c) && c.type !== 'regex');
      // Positional parameters read better as `$2` than as a bare `2`.
      const shownName = /^[1-9]\d*$/.test(targetText) ? `$${targetText}` : targetText;
      return h.tok(n, 'expansion', h.s('パラメータ展開: ', 'Parameter expansion: ') + h.t(make(shownName, arg)), h.subs(argNodes));
    }
  }
  const d = base ?? w.varDesc(targetText);
  const note = base ? '' : w.variableNote(n, targetText);
  return h.tok(n, 'variable', d
    ? h.s(`\`\${${targetText}}\`: ${d}${note}`, `\`\${${targetText}}\`: ${d}${note}`)
    : h.s(`変数 \`${targetText}\` の値に置き換わる（\`{}\` は変数名の範囲を明示する）${note}`, `Value of \`${targetText}\` (braces delimit the name)${note}`));
}
