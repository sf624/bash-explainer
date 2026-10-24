import type { Issue } from './dialect';
import { parseExpansion } from './expansion';
import { field, fields } from './syntax/tree';
import type { SyntaxNode } from './syntax/tree';

/** A text replacement, in tree positions (0-based rows and columns). */
export interface Edit { startLine: number; startCol: number; endLine: number; endCol: number; text: string }

/** A quick fix for an issue: what it does (ja, en) and the edits. */
export interface Fix { title: [string, string]; edits: Edit[] }

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

const SAME_IN_TEST = /^(-[a-zA-Z]|=|!=|-eq|-ne|-lt|-le|-gt|-ge|-nt|-ot|-ef)$/;

/**
 * `[ … ]` commands equivalent to a `[[ … ]]` expression. `&&` / `||` become separate tests joined
 * by the same operator (only one kind, so the shell's left-to-right order matches `[[ ]]`).
 */
function testChain(e: SyntaxNode): string | undefined {
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
  const tests = parts.map(single);
  if (tests.some((t) => t === undefined)) return undefined;
  return tests.map((t) => `[ ${t} ]`).join(` ${[...ops][0] ?? '&&'} `);
}

/** The inside of one `[ ]` for a `[[ ]]` expression without `&&` / `||`. */
function single(e: SyntaxNode): string | undefined {
  if (e.type === 'unary_expression') {
    const op = field(e, 'operator')!.text;
    const operand = e.namedChildren.filter((c) => c.type !== 'test_operator').pop();
    if (!operand) return undefined; // `[[ -f ]]` while typing
    if (op === '!') {
      const inner = single(operand);
      return inner === undefined ? undefined : `! ${inner}`;
    }
    const w = word(operand);
    return SAME_IN_TEST.test(op) && w !== undefined ? `${op} ${w}` : undefined;
  }
  if (e.type === 'binary_expression') {
    let op = field(e, 'operator')!.text;
    const left = field(e, 'left')!;
    const right = field(e, 'right')!;
    if (op === '==') op = '=';
    if (!SAME_IN_TEST.test(op) || fields(e, 'right').length > 1) return undefined;
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

/** Whether an expansion outside quotes is part of the word (its value would act as a pattern). */
function hasUnquotedExpansion(n: SyntaxNode): boolean {
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

/** A word as `[ ]` needs it: expansions double-quoted, since `[ ]` splits and globs them. */
function word(n: SyntaxNode): string | undefined {
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
