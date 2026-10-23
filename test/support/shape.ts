// A neutral "shape" of a shell script: what two parsers must agree on (command boundaries, lists and
// pipelines, compound commands, the words of each simple command as written, redirections). Both our
// syntax tree and the JSON of bash-ast (test/support/bashast.ts) are turned into it, then compared.
import type { SyntaxNode } from '../../src/syntax/tree';
import { field, fields, token } from '../../src/syntax/tree';

export interface Redir { fd: number | null; op: string; target: string }
export type Shape =
  | { k: 'seq'; items: { cmd: Shape; bg: boolean }[] }
  | { k: 'and-or'; first: Shape; rest: { op: '&&' | '||'; cmd: Shape }[] }
  | { k: 'pipeline'; negated: boolean; stages: Shape[] }
  | { k: 'simple'; line: number | null; assignments: string[]; words: string[]; redirects: Redir[] }
  | { k: 'subshell' | 'group'; body: Shape | null; redirects: Redir[] }
  | { k: 'if'; cond: Shape | null; then: Shape | null; else: Shape | null; redirects: Redir[] }
  | { k: 'for' | 'select'; variable: string; words: string[]; body: Shape | null; redirects: Redir[] }
  | { k: 'arith-for'; init: string; test: string; step: string; body: Shape | null; redirects: Redir[] }
  | { k: 'while' | 'until'; test: Shape | null; body: Shape | null; redirects: Redir[] }
  | { k: 'case'; word: string; items: { patterns: string[]; body: Shape | null; end: ';;' | ';&' | ';;&' }[]; redirects: Redir[] }
  | { k: 'function'; name: string; body: Shape | null }
  | { k: 'arith'; expression: string; redirects: Redir[] }
  | { k: 'cond'; expr: Cond; redirects: Redir[] }
  | { k: 'coproc'; name: string; body: Shape | null }
  | { k: 'empty' };
export type Cond =
  | { c: 'and' | 'or'; left: Cond; right: Cond }
  | { c: 'not' | 'paren'; expr: Cond }
  | { c: 'unary'; op: string; arg: string }
  | { c: 'binary'; op: string; left: string; right: string };

/** A sequence of items as a shape: a single foreground item stands for itself. */
export function seq(items: { cmd: Shape; bg: boolean }[]): Shape | null {
  if (!items.length) return null;
  if (items.length === 1 && !items[0].bg) return items[0].cmd;
  return { k: 'seq', items };
}

/** A pipeline with one stage that is not negated is just that stage. */
export function pipeline(negated: boolean, stages: Shape[]): Shape {
  return !negated && stages.length === 1 ? stages[0] : { k: 'pipeline', negated, stages };
}

/** `a && b || c` as the first command and the rest, whatever way the parser nested it. */
export function andOr(first: Shape, rest: { op: '&&' | '||'; cmd: Shape }[]): Shape {
  return rest.length ? { k: 'and-or', first, rest } : first;
}

// --- Our syntax tree ---

const norm = (s: string): string => s.replace(/\\\n/g, '');
/**
 * bash-ast prints a command substitution as bash would re-print it (newlines, spaces after redirection
 * operators), so a word that holds one is compared without its blanks and semicolons.
 */
export function canon(w: string): string {
  return /\$\(|`|[<>]\(/.test(w) ? w.replace(/[\s;]+/g, '') : w;
}

const wordOf = (n: SyntaxNode): string => canon(norm(ansi(n.text)));

/** bash-ast shows `$'a\tb'` as `'a<TAB>b'` and `$"x"` as `"x"`: bash resolves them while parsing. */
function ansi(t: string): string {
  return t
    .replace(/\$'((?:[^'\\]|\\.)*)'/g, (_m, body: string) => `'${body.replace(/\\(.)/g, (_x, c: string) => ({ t: '\t', n: '\n', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b' } as Record<string, string>)[c] ?? c)}'`)
    .replace(/\$"/g, '"');
}

/** Words as bash reads them: pieces that touch (`*`, `"$a"`, `*z`) are one word, whatever the tree makes of them. */
function wordsOf(nodes: readonly SyntaxNode[]): string[] {
  const out: string[] = [];
  let end = -1;
  for (const c of nodes) {
    if (c.startIndex === end && out.length) out[out.length - 1] += wordOf(c);
    else out.push(wordOf(c));
    end = c.endIndex;
  }
  return out;
}
const isStatement = (n: SyntaxNode): boolean => n.named && n.type !== 'comment' && n.type !== 'heredoc_body';

/** The default descriptor of a redirection operator. */
const defaultFd = (op: string): number => (/^(<|<<|<<-|<<<|<&|<>)$/.test(op) ? 0 : 1);

const positions = new WeakMap<Redir, number>();
function redirectOf(n: SyntaxNode): Redir[] {
  const rs = redirectAt(n);
  for (const r of rs) positions.set(r, n.startIndex);
  return rs;
}

function redirectAt(n: SyntaxNode): Redir[] {
  const op = n.children.find((c) => !c.named)!.type;
  const d = field(n, 'descriptor');
  let fd: number | null = d ? (/^\d+$/.test(d.text) ? Number(d.text) : null) : defaultFd(op);
  if (n.type === 'heredoc_redirect') {
    const body = n.children.find((c) => c.type === 'heredoc_body');
    // `<<-` strips the leading tabs of the body
    const text = body ? body.text : '';
    return [{ fd, op: '<<', target: op === '<<-' ? text.replace(/^\t+/gm, '') : text }];
  }
  if (n.type === 'herestring_redirect') return [{ fd, op: '<<<', target: wordOf(n.namedChildren[n.namedChildren.length - 1]) }];
  const dest = field(n, 'destination');
  // (A redirection with no target, as the adapter should never leave one: reported, not thrown.)
  if (!dest) return [{ fd, op, target: '(missing)' }];
  const target = wordOf(dest);
  if (op === '>&' || op === '<&') {
    if (target === '-') return [{ fd, op: 'close', target: '-' }];
    if (/^\d+-$/.test(target)) return [{ fd, op: op === '>&' ? 'move_output' : 'move_input', target: target.slice(0, -1) }];
    return [{ fd, op: op === '>&' ? 'dup_output' : 'dup_input', target }];
  }
  if (op === '&>' || op === '&>>') fd = 1;
  return [{ fd, op, target }];
}

/** The redirections among the children of a node (a `redirected_statement`, a command, a compound statement). */
function redirectsOf(n: SyntaxNode): Redir[] {
  return fields(n, 'redirect').flatMap(redirectOf);
}

/** Statements in a run of children, with `&` marking the one before it as a background command. */
function itemsOf(children: readonly SyntaxNode[]): { cmd: Shape; bg: boolean }[] {
  const items: { cmd: Shape; bg: boolean }[] = [];
  for (const c of children) {
    if (!c.named) {
      if (c.type === '&' && items.length) items[items.length - 1].bg = true;
    } else if (isStatement(c)) items.push({ cmd: fromNode(c), bg: false });
  }
  return items;
}

const bodyOf = (n: SyntaxNode | undefined): Shape | null => (n ? seq(itemsOf(n.children)) : null);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;

function simpleOf(n: SyntaxNode, extra: Redir[]): Shape {
  const assignments: string[] = [];
  const parts: { text: string; start: number; end: number }[] = [];
  const redirects: Redir[] = [...extra];
  const add = (c: SyntaxNode, text: string): void => {
    const last = parts[parts.length - 1];
    // pieces that touch are one word (`*"$a"*z` in a `[ ]`)
    if (last && last.end === c.startIndex) {
      last.text += text;
      last.end = c.endIndex;
    } else parts.push({ text, start: c.startIndex, end: c.endIndex });
  };
  for (const c of n.children) {
    if (c.type === 'variable_assignment') assignments.push(wordOf(c));
    else if (c.type === 'file_redirect' || c.type === 'heredoc_redirect' || c.type === 'herestring_redirect') redirects.push(...redirectOf(c));
    else if (c.named && c.type !== 'comment' && c.type !== 'heredoc_body') add(c, wordOf(c));
  }
  // bash-ast lists any word that looks like an assignment (`awk OFS=, f`) under assignments, not words
  const words: string[] = [];
  parts.forEach((p, i) => (i && ASSIGNMENT.test(p.text) ? assignments : words).push(p.text));
  redirects.sort((x, y) => positions.get(x)! - positions.get(y)!);
  return { k: 'simple', line: n.startPosition.row + 1, assignments, words, redirects };
}

/** Add a redirection to a command that can have them (the others are left as they are). */
export function withRedirect(s: Shape, r: Redir): void {
  if ('redirects' in s) s.redirects.push(r);
}

function condOf(n: SyntaxNode): Cond {
  switch (n.type) {
    case 'binary_expression': {
      const l = field(n, 'left')!;
      const r = field(n, 'right')!;
      const op = field(n, 'operator')!.text;
      if (op === '&&' || op === '||') return { c: op === '&&' ? 'and' : 'or', left: condOf(l), right: condOf(r) };
      return { c: 'binary', op, left: wordOf(l), right: wordsOf(fields(n, 'right')).join('') };
    }
    case 'unary_expression': {
      const op = n.children[0];
      const arg = n.namedChildren.filter((c) => c !== op).pop()!;
      if (op.text === '!') return { c: 'not', expr: condOf(arg) };
      return { c: 'unary', op: op.text, arg: wordOf(arg) };
    }
    case 'parenthesized_expression': return { c: 'paren', expr: condOf(n.namedChildren[0]) };
    default: return { c: 'unary', op: '-n', arg: wordOf(n) };
  }
}

/** While `shapeOfTree` records them: the nodes each shape object was made from (see `shapeOfTree`). */
let origins: Map<Shape, SyntaxNode[]> | undefined;
const record = (s: Shape, ...ns: SyntaxNode[]): Shape => {
  if (origins) origins.set(s, [...(origins.get(s) ?? []), ...ns]);
  return s;
};

function fromNode(n: SyntaxNode | undefined, extra: Redir[] = []): Shape {
  if (!n) return { k: 'empty' };
  return record(shapeOfNode(n, extra), n);
}

function shapeOfNode(n: SyntaxNode, extra: Redir[]): Shape {
  switch (n.type) {
    case 'command':
      return simpleOf(n, extra);
    case 'variable_assignment': case 'variable_assignments': {
      const as = n.type === 'variable_assignment' ? [n] : n.namedChildren;
      return { k: 'simple', line: n.startPosition.row + 1, assignments: as.map(wordOf), words: [], redirects: extra };
    }
    case 'redirected_statement': {
      const body = n.children.find((c) => c.named && c.field === 'body');
      if (!body) return { k: 'simple', line: n.startPosition.row + 1, assignments: [], words: [], redirects: [...extra, ...redirectsOf(n)] };
      return fromNode(body, [...extra, ...redirectsOf(n)]);
    }
    case 'negated_command': {
      const inner = n.namedChildren[0];
      if (!inner) return { k: 'empty' };
      const p = fromNode(inner);
      // `! ! a` is not negated (bash toggles); bash-ast keeps no negation on a compound command
      // (`! a | b` makes a new pipeline: it stands for the nodes of the old one too)
      if (p.k === 'pipeline') return record(p.negated ? pipeline(false, p.stages) : pipeline(true, p.stages), ...origins?.get(p) ?? []);
      return p.k === 'simple' ? pipeline(true, [p]) : p;
    }
    case 'time_statement': {
      const inner = n.namedChildren.find((c) => c.field === 'body');
      // a bare `time` is an empty command in bash-ast
      return inner ? fromNode(inner, extra) : { k: 'simple', line: n.startPosition.row + 1, assignments: [], words: [], redirects: extra };
    }
    case 'pipeline': {
      const stages: Shape[] = [];
      for (const c of n.children) {
        if (c.named) stages.push(fromNode(c));
        // `|&` adds 2>&1 to the stage before it (bash does the same)
        else if (c.type === '|&') withRedirect(stages[stages.length - 1], { fd: 2, op: 'dup_output', target: '1' });
      }
      return pipeline(false, stages);
    }
    case 'list': {
      const rest: { op: '&&' | '||'; cmd: Shape }[] = [];
      let first: Shape | null = null;
      const walk = (l: SyntaxNode): void => {
        let pending: '&&' | '||' | null = null;
        for (const c of l.children) {
          if (!c.named) {
            if (c.type === '&&' || c.type === '||') pending = c.type;
          } else if (c.type === 'list' && !pending) walk(c);
          else if (!isStatement(c)) continue;
          else if (!pending) first = fromNode(c);
          else {
            rest.push({ op: pending, cmd: fromNode(c) });
            pending = null;
          }
        }
      };
      walk(n);
      return andOr(first!, rest);
    }
    case 'subshell': case 'compound_statement':
      return { k: n.type === 'subshell' ? 'subshell' : 'group', body: bodyOf(n), redirects: extra };
    case 'if_statement': {
      const cond = seq(itemsOf(fields(n, 'condition')));
      const then: SyntaxNode[] = [];
      let elseNode: Shape | null = null;
      const afterThen = n.children.slice(n.children.findIndex((c) => c.type === 'then') + 1);
      for (const c of afterThen) {
        if (c.type === 'elif_clause') { elseNode = elifOf(n, c); break; }
        if (c.type === 'else_clause') { elseNode = bodyOf(c); break; }
        if (c.type !== 'fi') then.push(c);
      }
      return { k: 'if', cond, then: seq(itemsOf(then)), else: elseNode, redirects: extra };
    }
    case 'while_statement':
      return { k: n.children[0].type === 'until' ? 'until' : 'while', test: seq(itemsOf(fields(n, 'condition'))), body: bodyOf(field(n, 'body')), redirects: extra };
    case 'for_statement': case 'select_statement': {
      const hasIn = !!token(n, 'in');
      const words = hasIn ? fields(n, 'value').map(wordOf) : ['"$@"'];
      return { k: n.type === 'for_statement' ? 'for' : 'select', variable: field(n, 'variable')!.text, words, body: bodyOf(field(n, 'body')), redirects: extra };
    }
    case 'c_style_for_statement': {
      // an empty expression is 1 to bash
      const t = (f: 'initializer' | 'condition' | 'update'): string => (field(n, f)?.text ?? '').trim() || '1';
      return { k: 'arith-for', init: t('initializer'), test: t('condition'), step: t('update'), body: bodyOf(field(n, 'body')), redirects: [] };
    }
    case 'case_statement': {
      const items = n.namedChildren.filter((c) => c.type === 'case_item').map((ci) => {
        const end = ci.children.find((c) => c.type === ';;' || c.type === ';&' || c.type === ';;&');
        const body = ci.children.filter((c) => c.named && c.field !== 'value' && c.field !== 'termination' && c.field !== 'fallthrough');
        return { patterns: wordsOf(fields(ci, 'value')), body: seq(itemsOf(body)), end: (end ? end.type : ';;') as ';;' | ';&' | ';;&' };
      });
      return { k: 'case', word: wordOf(field(n, 'value')!), items, redirects: extra };
    }
    case 'function_definition': {
      const body = field(n, 'body')!;
      return { k: 'function', name: field(n, 'name')!.text, body: fromNode(body) };
    }
    case 'arithmetic_command': {
      const inner = n.text.replace(/^\(\(/, '').replace(/\)\)$/, '');
      return { k: 'arith', expression: inner.trim(), redirects: [] };
    }
    case 'extended_test': return { k: 'cond', expr: condOf(n.namedChildren[0]), redirects: [] };
    case 'coproc_statement': {
      const name = field(n, 'name');
      return { k: 'coproc', name: name ? name.text : 'COPROC', body: fromNode(field(n, 'body')!) };
    }
    default: return { k: 'empty' };
  }
}

function elifOf(parent: SyntaxNode, c: SyntaxNode): Shape {
  const idx = c.children.findIndex((x) => x.type === 'then');
  const cond = seq(itemsOf(c.children.slice(1, idx)));
  const rest = parent.children.slice(parent.children.indexOf(c) + 1);
  const next = rest.find((x) => x.type === 'elif_clause' || x.type === 'else_clause');
  const elseShape = !next ? null : next.type === 'elif_clause' ? elifOf(parent, next) : bodyOf(next);
  return { k: 'if', cond, then: seq(itemsOf(c.children.slice(idx + 1))), else: elseShape, redirects: [] };
}

/**
 * The shape of a whole script: its statements; null when there are none. With `from`, it also records the nodes
 * each command of the shape was made from: a command node, and the wrappers that get the same shape
 * (`redirected_statement`, `time_statement` with a body, `negated_command` over a compound command or a pipeline).
 */
// bash-ast keeps no redirections on `(( ))`, `[[ ]]` and `for ((;;))`, so ours are left out of their shapes too.
export function shapeOfTree(root: SyntaxNode, from?: Map<Shape, SyntaxNode[]>): Shape | null {
  origins = from;
  try {
    return seq(itemsOf(root.children));
  } finally {
    origins = undefined;
  }
}

// --- Comparison ---

/** Differences between two shapes (JSON-like values) by path, e.g. `seq[0].list.right[1].words[0]`. */
export function diffShapes(a: unknown, b: unknown, path = '$', out: { path: string; ours: unknown; bash: unknown }[] = []): { path: string; ours: unknown; bash: unknown }[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ path: `${path}.length`, ours: a, bash: b });
    else a.forEach((x, i) => diffShapes(x, b[i], `${path}[${i}]`, out));
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    if (x.k !== y.k || x.c !== y.c) out.push({ path: `${path}.kind`, ours: a, bash: b });
    else for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) diffShapes(x[key], y[key], `${path}.${key}`, out);
  } else if (a !== b) out.push({ path, ours: a, bash: b });
  return out;
}
