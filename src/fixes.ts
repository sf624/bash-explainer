import type { Issue } from './dialect';
import { descendants, field, fields } from './syntax/tree';
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
  switch (issue.id) {
    case 'dbracket': {
      const expr = n.namedChildren.length === 1 ? n.namedChildren[0] : undefined;
      const text = expr && testChain(expr);
      return text ? { title: ['`[[ ]]` を `[ ]` に書き換える', 'Rewrite `[[ ]]` as `[ ]`'], edits: [replace(n, text)] } : undefined;
    }
    case 'eqeqTest':
      return { title: ['`==` を `=` に書き換える', 'Replace `==` with `=`'], edits: descendants(n, ['==']).map((op) => replace(op, '=')) };
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
      const dest = field(n, 'destination')!;
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
    const operand = e.namedChildren.filter((c) => c.type !== 'test_operator').pop()!;
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
