// Which calls of a Python file are methods of a pattern compiled in it (docs/design/python-regex.md, 5.1; docs/design/sources.md,
// row 36): `EMAIL = re.compile(r'…')`, then `EMAIL.findall(s)` further down. A name is linked to its `re.compile` only where the file
// binds it once, by that statement, so that no other value can be the one the method is called on: a name assigned twice, a
// parameter, a loop's target, an import or a name a function binds again (which shadows it there) is not linked anywhere. The
// statement is at the top of the file or in a function (not in a class, whose names its methods do not see); a call sees it
// where Python looks the name up there: anywhere in the file for one at the top (but at the top before it, where the name is not
// bound yet), in that function and the functions inside it for one in a function. It reads the lexer's tokens, as the import table does.
import { dottedAt, type PyImports, pyResolve } from './pyimports';
import { isName, isOp, type PyLexed, type PyToken } from './pylex';

/** The `def` and `class` blocks of a file: the token where each starts, and the last token of its body. */
interface Block { kind: 'def' | 'class'; from: number; to: number }

/** The assignment ops a name before binds (`=` alone only at the top of its statement: `f(a=1)` is a keyword). */
const AUGMENTED: ReadonlySet<string> = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '>>=', '<<=', '&=', '|=', '^=', '@=', ':=']);
/** The words after which a name is bound: `for x`, `as x`, `def x`, `class x`, `import x`, `global x`, `nonlocal x`, `del x`. */
const BINDS_NEXT: ReadonlySet<string> = new Set(['for', 'as', 'def', 'class', 'import', 'global', 'nonlocal', 'del']);

/**
 * The calls of `re.compile` that a method's name is linked to: for the name and the token of a call's name (`EMAIL` of `EMAIL.findall(`),
 * the token where the name `re.compile` of its statement starts, or none.
 */
export function compiledNames(src: string, lx: PyLexed, imports: PyImports): (name: string, at: number) => number | undefined {
  const tokens = lx.tokens;
  const code: number[] = [];
  for (let i = 0; i < tokens.length; i++) if (tokens[i].kind !== 'comment') code.push(i);
  const text = (i: number): string => src.slice(tokens[i].start, tokens[i].end);
  // (The logical lines, as the indexes of their tokens in `code`, and the column each starts at: the lexer ends with a newline token
  // only a line that has tokens.)
  const lines: { from: number; to: number; indent: number }[] = [];
  for (let k = 0; k < code.length;) {
    let end = k;
    while (end < code.length && tokens[code[end]].kind !== 'newline') end++;
    const start = tokens[code[k]].start;
    lines.push({ from: k, to: end - 1, indent: start - (src.lastIndexOf('\n', start - 1) + 1) });
    k = end + 1;
  }
  const blocks = blocksOf(src, tokens, code, lines);
  const count = new Map<string, number>();
  const bind = (i: number) => count.set(text(i), (count.get(text(i)) ?? 0) + 1);
  for (const name of imports.keys()) count.set(name, 1);
  const sites = new Map<string, { at: number; call: number; block?: Block }>();
  // (How deep in brackets each token is, from the start of its line.)
  const depth: number[] = [];
  for (const line of lines) {
    let d = 0;
    for (let k = line.from; k <= line.to; k++) {
      const i = code[k];
      if (lx.pair[i] >= 0 && lx.pair[i] < i) d--;
      depth[k] = d;
      if (lx.pair[i] > i) d++;
    }
    // (Each statement of the line: up to a `;` outside brackets.)
    let from = line.from;
    for (let k = line.from; k <= line.to + 1; k++) {
      if (k <= line.to && !(isOp(src, tokens[code[k]], ';') && depth[k] === 0)) continue;
      statement(from, k - 1);
      from = k + 1;
    }
  }
  /** The bindings of the statement of `code[a..b]`, and the compile it is, if it is `NAME = re.compile(…)` and nothing else. */
  function statement(a: number, b: number): void {
    if (a > b) return;
    let lastEquals = -1;
    for (let k = a; k <= b; k++) if (isOp(src, tokens[code[k]], '=') && depth[k] === depth[a]) lastEquals = k;
    // (The lambdas open, by their depth: their parameters are bound up to the `:` at that depth.)
    const lambdas: number[] = [];
    let forAt = -1;
    for (let k = a; k <= b; k++) {
      const t = tokens[code[k]];
      if (isOp(src, t, ':') && lambdas[lambdas.length - 1] === depth[k]) lambdas.pop();
      if (t.kind !== 'name') continue;
      const before = tokens[code[k - 1]];
      const after = tokens[code[k + 1]];
      const word = text(code[k]);
      if (k > a && isOp(src, before, '.')) continue;
      if (word === 'lambda') lambdas.push(depth[k]);
      if (word === 'for') forAt = k;
      if (word === 'in' && forAt >= 0) forAt = -1;
      if (word === 'def' && isOp(src, tokens[code[k + 2]], '(')) {
        // (The parameters: every name inside the brackets after the function's name.)
        const close = lx.pair[code[k + 2]];
        for (let p = k + 3; p <= b && code[p] < close; p++) if (tokens[code[p]].kind === 'name') bind(code[p]);
      }
      const bound = (k > a && before.kind === 'name' && BINDS_NEXT.has(text(code[k - 1])))
        || (forAt >= 0 && k > forAt) || lambdas.length > 0 || k < lastEquals
        || (after?.kind === 'op' && AUGMENTED.has(text(code[k + 1]))) || (k === a && isOp(src, after, ':'));
      if (bound) bind(code[k]);
    }
    // `NAME = re.compile(…)`, the call ending the statement.
    if (tokens[code[a]].kind !== 'name' || lastEquals !== a + 1) return;
    const call = dottedAt(src, tokens, code[a + 2]);
    if (!call || pyResolve(imports, call.name) !== 're.compile' || !isOp(src, tokens[call.next], '(') || lx.pair[call.next] !== code[b]) return;
    const block = innermost(blocks, code[a]);
    sites.set(text(code[a]), { at: code[a], call: code[a + 2], ...(block ? { block } : {}) });
  }
  return (name, at) => {
    const site = sites.get(name);
    if (!site || count.get(name) !== 1) return undefined;
    if (site.block) return site.block.kind === 'def' && at > site.block.from && at <= site.block.to ? site.call : undefined;
    // (At the top of the file, or in a class there, before the statement, the name is not bound yet.)
    return blocks.some((bl) => bl.kind === 'def' && at > bl.from && at <= bl.to) || at > site.at ? site.call : undefined;
  };
}

/** The `def` and `class` blocks: a line that starts with one (after `async`), and the lines after it indented more, or the rest of its own line. */
function blocksOf(src: string, tokens: readonly PyToken[], code: readonly number[], lines: readonly { from: number; to: number; indent: number }[]): Block[] {
  const out: Block[] = [];
  lines.forEach((line, n) => {
    const first = isName(src, tokens[code[line.from]], 'async') ? line.from + 1 : line.from;
    const t = tokens[code[first]];
    if (!isName(src, t, 'def') && !isName(src, t, 'class')) return;
    let last = n;
    while (last + 1 < lines.length && lines[last + 1].indent > line.indent) last++;
    out.push({ kind: isName(src, t, 'def') ? 'def' : 'class', from: code[line.from], to: code[lines[last].to] });
  });
  return out;
}

/** The block that holds the token `i` most closely: the one that starts last. */
function innermost(blocks: readonly Block[], i: number): Block | undefined {
  let found: Block | undefined;
  for (const b of blocks) if (i > b.from && i <= b.to && (!found || b.from > found.from)) found = b;
  return found;
}
