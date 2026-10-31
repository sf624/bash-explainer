import type { Issue } from './dialect';
import { parseExpansion } from './expansion';
import { codeSpan, shorten } from './label';
import type { Rewrite } from './rewrite';
import { field, fields } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';

/** A text replacement, in tree positions (0-based rows and columns). */
export interface Edit { startLine: number; startCol: number; endLine: number; endCol: number; text: string }

/** A quick fix for an issue: what it does (ja, en; marked text, code in backticks: `fixTitle` gives it for an editor) and the edits. */
export interface Fix { title: [string, string]; edits: Edit[] }

/**
 * The quick fix of a rewrite a note suggests (src/rewrite.ts; docs/design/panel-redesign.md, P3), with its edits at the
 * places `place` gives for offsets of the document: titled with its code, the code the note shows (its first line,
 * cut at 60 characters), "Add" where the edits only insert, else "Rewrite as".
 */
export function rewriteFix(r: Rewrite, place: (offset: number) => { line: number; col: number }): Fix {
  const code = codeSpan(shorten(r.code, 60));
  const title: Fix['title'] = r.edits.every((e) => e.start === e.end) ? [`${code} を加える`, `Add ${code}`] : [`${code} に書き換える`, `Rewrite as ${code}`];
  return {
    title,
    edits: r.edits.map((e) => {
      const [from, to] = [place(e.start), place(e.end)];
      return { startLine: from.line, startCol: from.col, endLine: to.line, endCol: to.col, text: e.text };
    }),
  };
}

const replace = (n: { startPosition: { row: number; column: number }; endPosition: { row: number; column: number } }, text: string): Edit => ({
  startLine: n.startPosition.row, startCol: n.startPosition.column, endLine: n.endPosition.row, endCol: n.endPosition.column, text,
});

/**
 * A portable rewrite of the construct behind an issue, when one exists that keeps the meaning.
 * Undefined when the construct cannot be rewritten mechanically (e.g. `[[ $f == *.txt ]]`).
 */
export function fixFor(issue: Issue): Fix | undefined {
  const n = issue.node;
  if (!n) return undefined;
  switch (issue.id) {
    case 'dbracket': {
      // (A `[[ ]]` that is not complete, `[[ a b ]]`, is a syntax error: nothing to rewrite.)
      const expr = n.namedChildren.length === 1 && !n.incomplete ? n.namedChildren[0] : undefined;
      const text = expr && testChain(expr);
      return text ? { title: ['`[[ ]]` を `[ ]` に書き換える', 'Rewrite `[[ ]]` as `[ ]`'], edits: [replace(n, text)] } : undefined;
    }
    case 'eqeqTest':
      return { title: ['`==` を `=` に書き換える', 'Replace `==` with `=`'], edits: n.namedChildren.filter((w) => w.text === '==').map((op) => replace(op, '=')) };
    case 'source': {
      return { title: ['`source` を `.` に書き換える', 'Replace `source` with `.`'], edits: [replace(field(n, 'name')!, '.')] };
    }
    case 'funcKeyword': {
      // `function f {` or `function f() {` → `f() {`.
      const kw = n.children[0];
      const name = field(n, 'name')!;
      const close = n.children.find((c) => c.type === ')');
      const end = close ?? name;
      return {
        title: ['`function name` を `name()` に書き換える', 'Rewrite `function name` as `name()`'],
        edits: [{ startLine: kw.startPosition.row, startCol: kw.startPosition.column, endLine: end.endPosition.row, endCol: end.endPosition.column, text: `${name.text}()` }],
      };
    }
    case 'ampRedirect': case 'ampAppend': {
      const op = n.children.find((c) => c.type === '&>' || c.type === '&>>')!;
      const dest = field(n, 'destination');
      if (!dest) return undefined; // `cmd &>` while typing
      const to = op.type === '&>' ? '>' : '>>';
      return { title: [`\`${op.type}\` を \`${to}file 2>&1\` に書き換える`, `Rewrite \`${op.type}\` as \`${to}file 2>&1\``], edits: [replace(n, `${to} ${dest.text} 2>&1`)] };
    }
    case 'pipeAmp':
      return { title: ['`|&` を `2>&1 |` に書き換える', 'Rewrite `|&` as `2>&1 |`'], edits: n.children.filter((c) => c.type === '|&').map((op) => replace(op, '2>&1 |')) };
  }
  return undefined;
}

/**
 * The operators `[ ]` reads as `[[ ]]` does, in POSIX sh (checked against dash): the file tests and `-n`, `-z`, string
 * equality and `-ef`. Left out: `-a`, `-o`, `-v`, `-R`, `-N` (an error in dash: `-o` and `-v` test the shell's options and
 * variables in bash), `-k`, `-O`, `-G` (not in POSIX), and `-nt`, `-ot` (bash's is true when only the first file exists,
 * dash's false).
 */
const SAME_IN_TEST = /^(-[bcdefghLnprSsuwxz]|=|!=|-ef)$/;
/**
 * The arithmetic comparisons, whose operands `[[ ]]` reads as arithmetic expressions (`1+1`, `010` in octal, an empty
 * value as 0) and `[ ]` as decimal integers (status 2 otherwise): the same only when both operands are such integers.
 * `-t` too needs one: bash 5.2's test is false for another word, dash's an error.
 */
const ARITH_IN_TEST = /^(-eq|-ne|-lt|-le|-gt|-ge)$/;

/**
 * Whether an operand of `-eq`… is a decimal integer both tests read alike: a number without a leading 0 (octal in
 * `[[ ]]`) and short enough not to overflow, or `$#`. (Not `${#x}`: dash counts bytes, bash characters.)
 */
function decimalOperand(n: SyntaxNode): boolean {
  const number = /^(0|[1-9]\d{0,17})$/;
  if (n.type === 'raw_string') return number.test(n.text.slice(1, -1));
  const text = n.type === 'string' ? n.text.slice(1, -1) : n.text;
  return number.test(text) || text === '$#' || text === '${#}';
}

/**
 * `[ … ]` commands equivalent to a `[[ … ]]` expression. `&&` / `||` become separate tests joined
 * by the same operator (only one kind, so the shell's left-to-right order matches `[[ ]]`).
 */
export function testChain(e: SyntaxNode): string | undefined {
  const ops = new Set<string>();
  const parts: SyntaxNode[] = [];
  const split = (x: SyntaxNode): void => {
    const op = x.type === 'binary_expression' ? field(x, 'operator')?.text : undefined;
    if (op === '&&' || op === '||') {
      ops.add(op);
      split(field(x, 'left')!);
      split(field(x, 'right')!);
    } else parts.push(x);
  };
  split(e);
  if (ops.size > 1) return undefined;
  const tests = parts.map((p) => single(p));
  if (tests.some((t) => t === undefined)) return undefined;
  return tests.map((t) => `[ ${t} ]`).join(` ${[...ops][0] ?? '&&'} `);
}

/**
 * The inside of one `[ ]` for a `[[ ]]` expression without `&&` / `||`. One `!` at most: dash reads `[ ! ! -n "" ]` as
 * true.
 */
function single(e: SyntaxNode, negated = false): string | undefined {
  if (e.type === 'unary_expression') {
    const op = field(e, 'operator')!.text;
    const operand = e.namedChildren.filter((c) => c.type !== 'test_operator').pop();
    if (!operand) return undefined; // `[[ -f ]]` while typing
    if (op === '!') {
      const inner = negated ? undefined : single(operand, true);
      return inner === undefined ? undefined : `! ${inner}`;
    }
    const w = word(operand);
    const same = SAME_IN_TEST.test(op) || (op === '-t' && decimalOperand(operand));
    return same && w !== undefined ? `${op} ${w}` : undefined;
  }
  if (e.type === 'binary_expression') {
    let op = field(e, 'operator')!.text;
    const left = field(e, 'left')!;
    const right = field(e, 'right')!;
    if (op === '==') op = '=';
    if (fields(e, 'right').length > 1) return undefined;
    if (ARITH_IN_TEST.test(op)) {
      if (!decimalOperand(left) || !decimalOperand(right)) return undefined;
    } else if (!SAME_IN_TEST.test(op)) return undefined;
    // In `[[ ]]` an unquoted right side of `=` / `!=` is a pattern; `[ ]` compares text.
    if ((op === '=' || op === '!=') && (/[*?[]/.test(unquotedText(right)) || hasUnquotedExpansion(right))) return undefined;
    const l = word(left);
    const r = word(right);
    return l !== undefined && r !== undefined ? `${l} ${op} ${r}` : undefined;
  }
  // `[[ $x ]]`: true when non-empty.
  const w = word(e);
  return w !== undefined ? `-n ${w}` : undefined;
}

/** The characters of a word outside quotes (where glob characters would act as a pattern). */
function unquotedText(n: SyntaxNode): string {
  if (n.type === 'string' || n.type === 'raw_string' || n.type === 'ansi_c_string') return '';
  if (n.type === 'concatenation') return n.namedChildren.map(unquotedText).join('');
  if (n.type === 'simple_expansion' || n.type === 'expansion' || n.type === 'command_substitution') return '';
  return n.text;
}

/** Whether an expansion outside quotes is part of the word (its value would act as a pattern, or be split). */
export function hasUnquotedExpansion(n: SyntaxNode): boolean {
  if (['simple_expansion', 'expansion', 'command_substitution'].includes(n.type)) return true;
  return n.type === 'concatenation' && n.namedChildren.some(hasUnquotedExpansion);
}

/** The expansions a pair of double quotes keeps as they are, as one word without splitting or globbing. */
const QUOTABLE = new Set(['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion']);
/** Literal text that means the same inside double quotes: no glob, tilde, brace, quote or escape. */
const PLAIN = /^[\w@%+=:,./-]+$/;

/**
 * A word with its unquoted expansions double-quoted, and the rest as written (`$DIR/*` → `"$DIR"/*`, so the glob
 * still matches; `~/$d` → `~/"$d"`, so the tilde still expands). A word whose other parts mean the same in quotes is
 * quoted whole (`$d/x` → `"$d/x"`). `$*` and `${a[*]}` become `"$@"` and `"${a[@]}"`, which keep the words apart
 * (`"$*"` joins them into one). `replace` gives the text of some of its nodes instead (`${DIR:?}` for `$DIR`).
 *
 * Undefined when no quoting means the same: an expansion whose value word has a glob, a `~`, a quote or a backslash
 * (`${x:-*.txt}`, `${x:-~}`, `${x:-'a b'}`, `${x/a/*}`), which quotes would make literal.
 */
export function quoteExpansions(n: SyntaxNode, replace: ReadonlyMap<SyntaxNode, string> = new Map()): string | undefined {
  const text = (x: SyntaxNode): string => {
    const r = replace.get(x);
    if (r !== undefined) return r;
    let out = '';
    let at = x.startIndex;
    for (const c of x.namedChildren) {
      out += x.text.slice(at - x.startIndex, c.startIndex - x.startIndex) + text(c);
      at = c.endIndex;
    }
    return out + x.text.slice(at - x.startIndex);
  };
  /** An expansion as it reads in double quotes, or undefined when the quotes would change its value word. */
  const quoted = (x: SyntaxNode): string | undefined => {
    if (replace.has(x)) return text(x);
    if (x.type === 'simple_expansion') return x.text === '$*' ? '$@' : x.text;
    if (x.type !== 'expansion') return text(x);
    const p = parseExpansion(x.text);
    if (p?.parts.some((q) => (q.role === 'word' || q.role === 'replacement') && /[*?[~'\\]|[@+!]\(/.test(q.text))) return undefined;
    // `${*…}`, `${a[*]…}` (not `${#a[*]}`, a number): `@` keeps the elements apart in quotes.
    const star = p && p.prefix !== '#' && p.parts.find((q) => (q.role === 'name' && q.text === '*') || (q.role === 'subscript' && q.text === '[*]'));
    const at = star && star.start + (star.role === 'subscript' ? 1 : 0);
    return at ? `${x.text.slice(0, at)}@${x.text.slice(at + 1)}` : text(x);
  };
  if (QUOTABLE.has(n.type)) {
    const q = quoted(n);
    return q === undefined ? undefined : `"${q}"`;
  }
  if (n.type !== 'concatenation') return text(n);
  const parts = n.namedChildren;
  const each = parts.map((c) => (QUOTABLE.has(c.type) ? quoted(c) : text(c)));
  if (each.includes(undefined)) return undefined;
  if (parts.every((c) => QUOTABLE.has(c.type) || (c.type === 'word' && PLAIN.test(c.text)))) return `"${each.join('')}"`;
  // Each run of adjacent expansions in one pair of quotes (`$a$b/*` → `"$a$b"/*`).
  const quotable = (i: number) => i >= 0 && i < parts.length && QUOTABLE.has(parts[i].type);
  let out = '';
  for (const [i, c] of each.entries()) {
    const open = quotable(i) && !quotable(i - 1);
    const close = quotable(i) && !quotable(i + 1);
    out += (open ? '"' : '') + c + (close ? '"' : '');
  }
  return out;
}

/**
 * Whether a word has an expansion of several words (`$@`, `${a[@]}`, `${!a[@]}`, even in quotes): `[[ ]]` joins them
 * into one, `[ ]` gets them apart. (Any `@` in an expansion: the others are not in POSIX sh either.)
 */
const hasList = (n: SyntaxNode): boolean =>
  ((n.type === 'simple_expansion' || n.type === 'expansion') && n.text.includes('@'))
  || ((n.type === 'string' || n.type === 'concatenation') && n.namedChildren.some(hasList));

/** A word as `[ ]` needs it: expansions double-quoted, since `[ ]` splits and globs them. */
function word(n: SyntaxNode): string | undefined {
  if (hasList(n)) return undefined;
  switch (n.type) {
    case 'string': case 'raw_string': case 'number': return n.text;
    case 'word': case 'extglob_pattern': return /^[\w@%+=:,./-]+$/.test(n.text) ? n.text : undefined;
    case 'simple_expansion': case 'expansion': case 'command_substitution': return `"${n.text}"`;
    case 'concatenation':
      // `a$b` → `"a$b"`, when the plain parts need no quoting.
      return n.namedChildren.every((c) => (c.type === 'word' && /^[\w@%+=:,./-]+$/.test(c.text)) || ['simple_expansion', 'expansion', 'command_substitution'].includes(c.type))
        ? `"${n.text}"` : undefined;
  }
  return undefined;
}
