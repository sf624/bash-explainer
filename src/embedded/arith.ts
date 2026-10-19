import type { Lang } from '../i18n';
import { arithLiteral, describeArithLiteral, evalArith } from '../arith';
import { EmbeddedToken, pick } from './types';

/**
 * An arithmetic expression given as text, such as an argument of `let` (`"y = x << 1"`, `z=y%3`): the shell
 * reads it as it does the inside of `(( ))`. The same words as for `(( ))` explain it.
 */

type Node =
  | { t: 'num' | 'var'; start: number; end: number }
  | { t: 'un' | 'post' | 'paren'; start: number; end: number; op: string; a: Node }
  | { t: 'bin' | 'assign'; start: number; end: number; op: string; a: Node; b: Node }
  | { t: 'tern'; start: number; end: number; a: Node; b: Node; c: Node }
  | { t: 'comma'; start: number; end: number; items: Node[]; commas: number[] };

interface Tok { text: string; start: number; end: number }

const OPS = ['<<=', '>>=', '**', '++', '--', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '^=', '|=', '<<', '>>'];
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);
/** Binary operators from the loosest (`||`) to the tightest (`*`), `**` apart. */
const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];

function tokenize(src: string): Tok[] | undefined {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    const rest = src.slice(i);
    // A number, or a name with its subscript (`a[i+1]`) or a `$name`, is one token.
    let m = /^\d[0-9A-Za-z@_#]*/.exec(rest) ?? /^\$?[A-Za-z_]\w*/.exec(rest);
    if (m && /^\$?[A-Za-z_]/.test(m[0])) {
      let end = m[0].length;
      if (rest[end] === '[') {
        let depth = 0;
        let k = end;
        for (; k < rest.length; k++) {
          if (rest[k] === '[') depth++;
          else if (rest[k] === ']' && --depth === 0) break;
        }
        if (k >= rest.length) return undefined;
        end = k + 1;
      }
      m = [rest.slice(0, end)] as RegExpExecArray;
    }
    const text = m ? m[0] : OPS.find((o) => rest.startsWith(o)) ?? (/^[-+*/%<>=!~?:,()&|^]/.test(rest) ? rest[0] : undefined);
    if (text === undefined) return undefined;
    out.push({ text, start: i, end: i + text.length });
    i += text.length;
  }
  return out;
}

/** Reads the expression; undefined if it is not one bash accepts. */
function parse(toks: Tok[]): Node | undefined {
  let pos = 0;
  const fail = Symbol('fail');
  const peek = (): string | undefined => toks[pos]?.text;
  const take = (): Tok => {
    if (pos >= toks.length) throw fail;
    return toks[pos++];
  };
  const isOperand = (t: string): boolean => /^[\d$A-Za-z_]/.test(t);
  const primary = (): Node => {
    const t = take();
    if (t.text === '(') {
      const a = comma();
      const close = take();
      if (close.text !== ')') throw fail;
      return { t: 'paren', start: t.start, end: close.end, op: '(', a };
    }
    if (!isOperand(t.text)) throw fail;
    const node: Node = { t: /^\d/.test(t.text) ? 'num' : 'var', start: t.start, end: t.end };
    const next = peek();
    if ((next === '++' || next === '--') && node.t === 'var') {
      const op = take();
      return { t: 'post', start: t.start, end: op.end, op: op.text, a: node };
    }
    return node;
  };
  const unary = (): Node => {
    const t = peek();
    if (t !== undefined && ['!', '~', '+', '-', '++', '--'].includes(t)) {
      const op = take();
      const a = unary();
      return { t: 'un', start: op.start, end: a.end, op: op.text, a };
    }
    return primary();
  };
  // `**` binds less tightly than a unary minus (`-2**2` is 4) and groups to the right.
  const power = (): Node => {
    const a = unary();
    if (peek() !== '**') return a;
    take();
    const b = power();
    return { t: 'bin', start: a.start, end: b.end, op: '**', a, b };
  };
  const binary = (level: number): Node => {
    if (level === LEVELS.length) return power();
    let a = binary(level + 1);
    while (peek() !== undefined && LEVELS[level].includes(peek()!)) {
      const op = take();
      const b = binary(level + 1);
      a = { t: 'bin', start: a.start, end: b.end, op: op.text, a, b };
    }
    return a;
  };
  const ternary = (): Node => {
    const a = binary(0);
    if (peek() !== '?') return a;
    take();
    const b = assign();
    if (take().text !== ':') throw fail;
    const c = ternary();
    return { t: 'tern', start: a.start, end: c.end, a, b, c };
  };
  const assign = (): Node => {
    const a = ternary();
    if (peek() !== undefined && ASSIGN.has(peek()!)) {
      if (a.t !== 'var') throw fail;
      const op = take();
      const b = assign();
      return { t: 'assign', start: a.start, end: b.end, op: op.text, a, b };
    }
    return a;
  };
  const comma = (): Node => {
    const items = [assign()];
    const commas: number[] = [];
    while (peek() === ',') {
      commas.push(take().start);
      items.push(assign());
    }
    return items.length === 1 ? items[0] : { t: 'comma', start: items[0].start, end: items[items.length - 1].end, items, commas };
  };
  try {
    const n = comma();
    return pos === toks.length ? n : undefined;
  } catch (e) {
    if (e === fail) return undefined;
    /* c8 ignore next */
    throw e;
  }
}

/** Explain the arithmetic expression `src`; undefined if it is empty or not an expression. */
export function explainArith(src: string, lang: Lang): { tokens: EmbeddedToken[]; note?: string } | undefined {
  const s = pick(lang);
  const toks = tokenize(src);
  const root = toks?.length ? parse(toks) : undefined;
  if (!root) return undefined;
  const text = (n: { start: number; end: number }): string => src.slice(n.start, n.end);
  /** The token of a node, and for a plain decimal constant none (nothing to say). */
  const tokenOf = (n: Node): EmbeddedToken | undefined => {
    const base = { start: n.start, end: n.end };
    const kids = (...ns: Node[]): EmbeddedToken[] => ns.flatMap((x) => tokenOf(x) ?? []);
    switch (n.t) {
      case 'num': {
        const lit = arithLiteral(text(n));
        if (lit && lit.type === 'number' && lit.style === 'decimal') return undefined;
        return { ...base, kind: 'number', children: [], explanation: lit ? describeArithLiteral(text(n), lit, lang) : s('数値', 'Number') };
      }
      case 'var': {
        const m = /^(\$?\w+)\[(.*)\]$/s.exec(text(n));
        return { ...base, kind: 'variable', children: [], explanation: m ? s(`配列 \`${m[1]}\` の要素 \`[${m[2]}]\``, `Element \`[${m[2]}]\` of array \`${m[1]}\``) : s(`変数 \`${text(n)}\``, `Variable \`${text(n)}\``) };
      }
      case 'un': return { ...base, kind: 'operator', children: kids(n.a), explanation: s(`算術の単項演算 \`${n.op}\``, `Arithmetic unary operator \`${n.op}\``) };
      case 'post': return { ...base, kind: 'operator', children: [], explanation: s(`算術: \`${text(n)}\`（${n.op === '++' ? '1 増やす' : '1 減らす'}）`, `Arithmetic: \`${text(n)}\` (${n.op === '++' ? 'increment' : 'decrement'})`) };
      case 'paren': return { ...base, kind: 'operator', children: kids(n.a), explanation: s('括弧でまとめた式', 'Parenthesized expression') };
      case 'tern': return { ...base, kind: 'expansion', children: kids(n.a, n.b, n.c), explanation: s('三項演算子: 条件 ? 真のときの値 : 偽のときの値', 'Ternary: cond ? if-true : if-false') };
      case 'assign': return { ...base, kind: 'operator', children: kids(n.a, n.b), explanation: s(`算術代入: \`${text(n.a)}\` ${n.op} \`${text(n.b)}\``, `Arithmetic assignment: \`${text(n.a)}\` ${n.op} \`${text(n.b)}\``) };
      case 'bin': return { ...base, kind: 'operator', children: kids(n.a, n.b), explanation: s(`算術演算: \`${text(n.a)}\` ${n.op} \`${text(n.b)}\``, `Arithmetic: \`${text(n.a)}\` ${n.op} \`${text(n.b)}\``) };
      case 'comma': /* c8 ignore next */ throw new Error('a comma list is flat');
    }
  };
  const comma = (at: number): EmbeddedToken => ({
    start: at, end: at + 1, kind: 'operator', children: [],
    explanation: s('`,` コンマ演算子: 左の式を評価して値を捨て、右の式に進む', '`,` comma operator: evaluate the left expression, drop its value, go on to the right one'),
  });
  const top = root.t === 'comma' ? [...root.items.flatMap((x) => tokenOf(x) ?? []), ...root.commas.map(comma)] : [tokenOf(root) ?? {
    start: root.start, end: root.end, kind: 'number' as const, children: [], explanation: s('数値', 'Number'),
  }];
  top.sort((a, b) => a.start - b.start);
  const v = evalArith(src);
  return { tokens: top, note: v === undefined ? undefined : s(`値は ${v}`, `value ${v}`) };
}
