// GPL boundary: bash-ast (https://github.com/cv/bash-ast) is GPL-3.0. This file only runs it as an external
// program and reads the JSON it prints on stdout. None of its code or type definitions is copied here: the
// types below describe the output we observed, written in our own words. It is never a dependency, never
// bundled, and its output is never committed.
import { spawnSync } from 'child_process';
import type { Cond, Redir, Shape } from './shape';
import { andOr, canon, pipeline, seq } from './shape';

/** The path of the bash-ast binary: `$BASH_AST`, else `bash-ast` on PATH; undefined when it cannot be run. */
export function findBashAst(): string | undefined {
  for (const bin of [process.env.BASH_AST, 'bash-ast']) {
    if (!bin) continue;
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return bin;
  }
  return undefined;
}

// What bash-ast prints, as we saw it (fields we do not read are left out).
interface AstRedirect { direction: string; source_fd?: number; target: string | number; here_doc_eof?: string }
interface AstCond { cond_type: string; op?: string; arg?: string; left?: AstCond | string; right?: AstCond | string; expr?: AstCond }
export interface AstNode {
  type: string;
  line?: number;
  words?: ({ word: string } | string)[] | null;
  assignments?: string[] | null;
  redirects?: AstRedirect[];
  commands?: AstNode[];
  negated?: boolean;
  op?: string;
  left?: AstNode;
  right?: AstNode;
  body?: AstNode | null;
  condition?: AstNode;
  then_branch?: AstNode;
  else_branch?: AstNode | null;
  test?: AstNode | string;
  variable?: string;
  name?: string;
  word?: string;
  init?: string;
  step?: string;
  expression?: string;
  expr?: AstCond;
  clauses?: { patterns: string[]; action: AstNode | null; flags?: { fallthrough?: boolean; test_next?: boolean } }[];
}

/** Parse a script with bash-ast: its tree, or the error it printed (a syntax error, or empty input). */
export function runBashAst(bin: string, text: string): { ok: true; ast: AstNode } | { ok: false; message: string } {
  const r = spawnSync(bin, ['--compact'], { input: text, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) return { ok: false, message: (r.stderr || String(r.error)).trim() };
  return { ok: true, ast: JSON.parse(r.stdout) as AstNode };
}

const OPS: Record<string, string> = {
  output: '>', append: '>>', input: '<', input_output: '<>', clobber: '>|', err_and_out: '&>', append_err_and_out: '&>>',
  dup_output: 'dup_output', dup_input: 'dup_input', close: 'close', here_doc: '<<', here_string: '<<<',
};

function redirects(rs: AstRedirect[] | undefined): Redir[] {
  return (rs ?? []).map((r) => ({
    // `{fd}>file` has no source_fd; ours has no number for it either
    // (for `{fd}>file` it prints no number, or a leftover one far out of range)
    fd: r.source_fd === undefined || r.source_fd > 0xffff ? null : r.source_fd,
    op: OPS[r.direction] ?? r.direction,
    target: r.direction === 'close' ? '-' : String(r.target),
  }));
}

const wordText = (w: { word: string } | string): string => canon(typeof w === 'string' ? w : w.word);

function cond(c: AstCond | string): Cond {
  if (typeof c === 'string') throw new Error('bare string in a condition');
  const str = (x: AstCond | string | undefined): string => canon(String(x));
  switch (c.cond_type) {
    case 'and': case 'or': return { c: c.cond_type, left: cond(c.left!), right: cond(c.right!) };
    case 'not': return { c: 'not', expr: cond(c.expr!) };
    case 'expr': return { c: 'paren', expr: cond(c.expr!) };
    case 'unary': return { c: 'unary', op: c.op!, arg: canon(String(c.arg)) };
    default: return { c: 'binary', op: c.op!, left: str(c.left), right: str(c.right) };
  }
}

/** The items of a `;`/`&` list: `a & b; c` is semi(amp(a, b), c), so the left side may be a list too. */
function items(n: AstNode | null | undefined, out: { cmd: Shape; bg: boolean }[] = []): { cmd: Shape; bg: boolean }[] {
  if (!n) return out;
  if (n.type === 'list' && (n.op === 'semi' || n.op === 'amp')) {
    items(n.left, out);
    if (n.op === 'amp' && out.length) out[out.length - 1].bg = true;
    items(n.right, out);
  } else if (n.type === 'simple' && !n.words?.length && !n.assignments?.length && !n.redirects?.length && n.line === undefined) {
    // the empty command after a trailing `&` (a known loss)
  } else out.push({ cmd: shapeOfAst(n), bg: false });
  return out;
}

const body = (n: AstNode | null | undefined): Shape | null => seq(items(n));

/** The shape of a bash-ast tree. */
export function shapeOfAst(n: AstNode): Shape {
  const rd = redirects(n.redirects);
  switch (n.type) {
    case 'simple':
      return { k: 'simple', line: n.line ?? null, assignments: (n.assignments ?? []).map(canon), words: (n.words ?? []).map(wordText), redirects: rd };
    case 'pipeline': return pipeline(!!n.negated, n.commands!.map(shapeOfAst));
    case 'list': {
      if (n.op === 'semi' || n.op === 'amp') return seq(items(n))!;
      const rest: { op: '&&' | '||'; cmd: Shape }[] = [];
      let cur: AstNode = n;
      while (cur.type === 'list' && (cur.op === 'and' || cur.op === 'or')) {
        rest.unshift({ op: cur.op === 'and' ? '&&' : '||', cmd: shapeOfAst(cur.right!) });
        cur = cur.left!;
      }
      return andOr(shapeOfAst(cur), rest);
    }
    case 'subshell': case 'group': return { k: n.type, body: body(n.body), redirects: rd };
    case 'if': return { k: 'if', cond: body(n.condition), then: body(n.then_branch), else: body(n.else_branch), redirects: rd };
    case 'for': case 'select':
      return { k: n.type, variable: n.variable!, words: ((n.words ?? []) as string[]).map((w) => canon(String(w))), body: body(n.body), redirects: rd };
    case 'arithmetic_for': return { k: 'arith-for', init: n.init!.trim(), test: (n.test as string).trim(), step: n.step!.trim(), body: body(n.body), redirects: rd };
    case 'while': case 'until': return { k: n.type, test: body(n.test as AstNode), body: body(n.body), redirects: rd };
    case 'case':
      return {
        k: 'case', word: canon(n.word!), redirects: rd,
        items: n.clauses!.map((c) => ({ patterns: c.patterns.map(canon), body: body(c.action), end: c.flags?.fallthrough ? ';&' : c.flags?.test_next ? ';;&' : ';;' })),
      };
    case 'function_def': return { k: 'function', name: n.name!, body: shapeOfAst(n.body!) };
    case 'arithmetic': return { k: 'arith', expression: n.expression!.trim(), redirects: rd };
    case 'conditional': return { k: 'cond', expr: cond(n.expr!), redirects: rd };
    case 'coproc': return { k: 'coproc', name: n.name!, body: shapeOfAst(n.body!) };
    default: return { k: 'empty' };
  }
}
