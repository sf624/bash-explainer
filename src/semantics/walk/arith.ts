// The arithmetic of the walk of the shell state (src/semantics/walk/walker.ts): `(( ))`, `$(( ))`, `let`, `for (( ))`
// and the values of variables read as expressions, run with their assignments, when their values are known.
import { arithLiteral, evalArithWrapping } from '../../arith';
import { staticWordValue } from '../../staticword';
import { descendants, field, fields, hasError, type SyntaxNode } from '../../syntax/tree';
import { attribute, merge, option, type ShellState, type VariableState } from '../shellstate';
import { alwaysNumeric, ARITH_ASSIGNED } from '../vars';
import { ArithError, ArithUnknown, NAME, parser } from './shared';
import type { Walker } from './walker';

/** The assignment operators of arithmetic (6.5). */
const ARITH_ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);
const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);
/** How deep the values of variables are run in arithmetic, each as an expression (`y=x`, `x='z + 1'`): deeper is not followed (bash fails past 1024). */
const ARITH_DEPTH = 100;
/** How many steps an expression may take here (`v1='v0+v0'`, `v2='v1+v1'`… doubles at each level): more is not followed. */
const ARITH_STEPS = 10_000;
/** How many steps all the arithmetic of a script may take here: past them, what the rest of it assigns may be set, to values not known. */
const ARITH_WALK_STEPS = 500_000;
/** How deeply operators may nest in arithmetic here, through the values read (`v1='((v0))'`…): deeper is not followed. */
const ARITH_NESTING = 1000;
/** How many values of a variable read as an expression are remembered, each with what it read (`arithValue`). */
const ARITH_MEMO = 8;
/** What may be pasted into an arithmetic expression; bash expands it first. (A single-quoted text is not: it is an error.) */
const PASTES = ['simple_expansion', 'expansion', 'arithmetic_expansion', 'command_substitution', 'process_substitution', 'string', 'ansi_c_string', 'translated_string'];
/**
 * The key, among the reads of a value, of what a read depends on besides the variables (no variable has this name):
 * `set -u`, and whether the path ran what the walk does not read (`ShellState.opaque`), as `context` gives them.
 */
const CONTEXT = '-u';
const context = (st: ShellState): string => `${option(st, 'set', 'nounset')}${st.opaque ? ' opaque' : ''}`;
/** What a value read as an expression has read so far: the variables (and `CONTEXT`), whether it can be remembered, how deep it went. */
interface ArithReads { deps: Map<string, unknown>; pure: boolean; depth: number; unsure: boolean; assumed: boolean }
/**
 * A value read as an expression, remembered with what it read and how deep it went: its value; or `unknown` (`deep`:
 * it went deeper than `ARITH_DEPTH` from where it was read, `depth` is then at least what it needs); `unsure`: it read
 * a value not known; `assumed`: it read a name the script has not set, taken as unset.
 */
interface ArithRemembered { deps: ReadonlyMap<string, unknown>; depth: number; value?: bigint; unknown: false | 'always' | 'deep'; unsure: boolean; assumed: boolean }

/**
 * `text` with each `++` and `--` that bash reads as a sign followed by another one spaced apart, as bash's lexer
 * reads them: after a name (and its subscript), `x++` increments it; before a name (spaces aside), `++x` does;
 * elsewhere it is a sign, and the second character is read again (`5--3` is `5- -3`, 8; `7 ---3` is `7 - - -3`, 4;
 * `1 +++x` is `1 + ++x`). Gives how many are left outside subscripts, or undefined where bash fails (`++x++`).
 */
function incDecText(text: string): { text: string; ops: number } | undefined {
  const name = /[A-Za-z_]\w*/y;
  const number = /\d[\w@#]*/y;
  let out = '';
  let ops = 0;
  let depth = 0;
  // What came before: a name (or its subscript), a name after `++` or `--`, those, or anything else.
  let prev: 'name' | 'counted' | 'incdec' | 'other' = 'other';
  for (let i = 0; i < text.length;) {
    const c = text[i];
    const m = /\d/.test(c) ? number : name;
    m.lastIndex = i;
    const word = m.exec(text)?.[0];
    if (word !== undefined) {
      out += word;
      i += word.length;
      prev = m === number ? 'other' : prev === 'incdec' ? 'counted' : 'name';
    } else if ((c === '+' || c === '-') && text[i + 1] === c) {
      // (bash fails on `++x++`: once incremented, `x` is a number.)
      if (prev === 'counted') return undefined;
      if (prev === 'name' || /^\s*[A-Za-z_]/.test(text.slice(i + 2))) {
        out += c + c;
        i += 2;
        if (!depth) ops++;
        prev = prev === 'name' ? 'other' : 'incdec';
      } else {
        out += `${c} `;
        i += 1;
        prev = 'other';
      }
    } else {
      out += c;
      i += 1;
      if (c === '[') depth++;
      else if (c === ']' && depth) depth--;
      if (!/\s/.test(c)) prev = c === ']' ? 'name' : 'other';
    }
  }
  return { text: out, ops };
}

/** Whether each `(` of `text` is closed by a `)` after it, and each `)` closes one. */
function balanced(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** Whether `v` is a nameref, or may be one. */
const isNameref = (v: VariableState | undefined): boolean => v?.attrs.n !== undefined && v.attrs.n.state !== 'off';

/** How many `++` and `--` the parser read in `n`, outside subscripts. */
function incDecCount(n: SyntaxNode): number {
  if (n.type === 'subscript') return 0;
  const own = (n.type === 'postfix_expression' || n.type === 'unary_expression') && n.children.some((c) => !c.named && (c.type === '++' || c.type === '--')) ? 1 : 0;
  return n.namedChildren.reduce((sum, c) => sum + incDecCount(c), own);
}

/** The source text from the first of `nodes` to the end of the last one. */
function arithSource(nodes: readonly SyntaxNode[]): string {
  let root = nodes[0];
  while (root.parent) root = root.parent;
  return root.text.slice(nodes[0].startIndex - root.startIndex, nodes[nodes.length - 1].endIndex - root.startIndex);
}
/** Whether `op` with the right side `r` is an error in bash. */
const arithError = (op: string, r: bigint): boolean => ((op === '/' || op === '%') && r === 0n) || (op === '**' && r < 0n);
/** Whether a shift by `b` is the same on every machine. */
const shifts = (b: bigint): boolean => b >= 0n && b <= 63n;
/** The binary operators of arithmetic, as bash computes them (after `arithError`); undefined for a result not followed here (it depends on the machine, or is too large to compute). */
const ARITH_OPS: Record<string, (a: bigint, b: bigint) => bigint | undefined> = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
  '/': (a, b) => a / b, '%': (a, b) => a % b,
  '**': (a, b) => (b > 128n && (a > 1n || a < -1n) ? undefined : a ** b),
  '<<': (a, b) => (shifts(b) ? a << b : undefined), '>>': (a, b) => (shifts(b) ? a >> b : undefined),
  '&': (a, b) => a & b, '|': (a, b) => a | b, '^': (a, b) => a ^ b,
  '<': (a, b) => BigInt(a < b), '>': (a, b) => BigInt(a > b), '<=': (a, b) => BigInt(a <= b), '>=': (a, b) => BigInt(a >= b),
  '==': (a, b) => BigInt(a === b), '!=': (a, b) => BigInt(a !== b),
};

/** The arithmetic the walk runs (see `arithScript`), with what it remembers of values read as expressions. */
export class WalkArith {
  constructor(private readonly w: Walker) {}

  /**
   * Runs an arithmetic expression of the script (`(( ))`, a part of `for (( ))`, `$(( ))`), whose parts are `nodes`:
   * first its expansions, as bash does (`$x`, `${x}`, `$(( ))` and double quotes; `$x` is the value before the
   * expression runs, and a `$(( ))` in it runs then), then the text they give. Gives the state after it, and its value
   * when known; throws `ArithError` where bash fails. When what it does is not known here (`ArithUnknown`), the names
   * it seems to assign may be set, to values not known (`mayAssign`).
   */
  arithScript(nodes: readonly SyntaxNode[], st: ShellState, unsure = false): { st: ShellState; value?: bigint } {
    return nodes.length ? this.arithGuard(arithSource(nodes), st, nodes[0], () => this.arithEval(nodes, st), unsure) : { st, value: 0n };
  }

  /** How many steps the expression being run has taken (`ARITH_STEPS`), and all the arithmetic of the script (`ARITH_WALK_STEPS`). */
  private arithSteps = 0;
  private arithWalkSteps = 0;
  /** How deeply the operators being run nest (`ARITH_NESTING`). */
  private arithNesting = 0;
  /**
   * Whether the expression being run has read a value not known here (`HOME`, an element of an array): bash runs it as
   * an expression too, which may fail, so what the expression assigns after it may be (`n='z = 9'` would also set z).
   */
  unsure = false;

  /** Sets `unsure`, also for the value being read, if any. */
  private markUnsure(): void {
    this.unsure = true;
    const top = this.arithReads[this.arithReads.length - 1];
    if (top) top.unsure = true;
  }

  /**
   * Runs `run`, an expression whose text is `source`, from `st`: each expression of the script starts here, with a
   * count of its steps of its own. When what it does is not known, see `mayAssign`; `unsure` is then set, since it may
   * have failed. `unsure`: whether an expression before it in the same command may have failed (see `unsure`).
   */
  private arithGuard(source: string, st: ShellState, at: SyntaxNode, run: () => { st: ShellState; value?: bigint }, unsure = false): { st: ShellState; value?: bigint } {
    this.arithSteps = 0;
    this.unsure = unsure;
    try {
      if (this.arithWalkSteps > ARITH_WALK_STEPS) throw new ArithUnknown('limit');
      return run();
    } catch (e) {
      // (A text nested too deeply for the stack of JavaScript, in the parser or here, is not followed either.)
      if (!(e instanceof ArithUnknown) && !(e instanceof RangeError)) throw e;
      this.unsure = true;
      return { st: this.mayAssign(source, st, at) };
    }
  }

  /**
   * The text given to an integer variable (`declare -i n; n='x = 5'`), run as arithmetic at `at`, as bash does: the
   * state after it (what it assigns), and its value when known (not where bash fails, nor from a value it is unsure of).
   * A constant is read at once (an assignment that arithmetic makes, `(( n = 3 ))`, gives one).
   */
  integer(text: string, st: ShellState, at: SyntaxNode): { st: ShellState; value?: bigint } {
    const constant = evalArithWrapping(text);
    if (constant) return { st, value: constant.value };
    const { unsure } = this;
    try {
      const r = this.arithGuard(text, st, at, () => this.arithText(text, st, at, true));
      return this.unsure ? { st: r.st } : r;
    } catch (e) {
      if (e instanceof ArithError) return { st: e.st };
      /* c8 ignore next -- only an arithmetic error is thrown on purpose */
      throw e;
    } finally {
      this.unsure = unsure;
    }
  }

  /** `arithScript` with no guard: `ArithUnknown` goes up to the expression of the script that holds it. */
  private arithEval(nodes: readonly SyntaxNode[], st: ShellState): { st: ShellState; value?: bigint } {
    if (!nodes.length) return { st, value: 0n };
    const x = this.arithExpand(nodes, st, false);
    return this.arithText(x.text, x.st, nodes[0], false);
  }

  /**
   * The text of the expression `nodes` with its expansions done (`brackets`: only those in a subscript, as in a text
   * read as arithmetic: the others are an error there, when bash gets to them). Throws `ArithUnknown` when a text
   * pasted is not known.
   */
  private arithExpand(nodes: readonly SyntaxNode[], st: ShellState, brackets: boolean): { st: ShellState; text: string } {
    const source = arithSource(nodes);
    const from = nodes[0].startIndex;
    const pastes: SyntaxNode[] = [];
    const visit = (x: SyntaxNode): void => {
      if (PASTES.includes(x.type)) pastes.push(x);
      else x.children.forEach(visit);
    };
    nodes.forEach(visit);
    let text = '';
    let at = from;
    // How many brackets are open before the expansion: in `a[$i] + $j`, `$i` is in a subscript (depth 1), `$j` is not (0).
    let depth = 0;
    for (const p of pastes) {
      const plain = source.slice(at - from, p.startIndex - from);
      for (const c of plain) depth += c === '[' ? 1 : c === ']' ? -1 : 0;
      text += plain;
      at = p.endIndex;
      if (brackets && depth <= 0) {
        text += p.text;
        continue;
      }
      // (bash expands a subscript when it reads it: after what the text assigns before it, which is not followed when
      // the expansion may read it.)
      const reads = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(p.text)?.[1];
      if (brackets && [...text.matchAll(ARITH_ASSIGNED)].some((m) => reads === undefined || (m[1] ?? m[3] ?? m[4]) === reads)) throw new ArithUnknown();
      const r = this.pasteText(p, st);
      st = r.st;
      text += r.text;
    }
    return { st, text: text + source.slice(at - from) };
  }

  /** The text that `p` (`$x`, `${x}`, `$(( ))`, `"…"`) pastes into an arithmetic expression; throws `ArithUnknown` when not known. */
  private pasteText(p: SyntaxNode, st: ShellState): { st: ShellState; text: string } {
    switch (p.type) {
      case 'simple_expansion': case 'expansion': {
        const name = /^\$\{?([A-Za-z_]\w*|\?)\}?$/.exec(p.text)?.[1];
        const text = name === undefined ? undefined : name === '?' ? this.w.conditions.lastStatus(st) : this.w.variableText(st, name);
        if (name !== undefined && name !== '?') this.w.unsetRead(st, name);
        if (text === undefined) throw new ArithUnknown();
        return { st, text: text ?? '' };
      }
      case 'arithmetic_expansion': {
        const r = this.arithEval(p.namedChildren, st);
        if (r.value === undefined) throw new ArithUnknown();
        return { st: r.st, text: String(r.value) };
      }
      case 'string': {
        let text = '';
        for (const c of p.namedChildren) {
          // (A backslash in double quotes is not followed here.)
          if (c.type === 'string_content' && !c.text.includes('\\')) text += c.text;
          else if (c.type === 'string_content') throw new ArithUnknown();
          else {
            const r = this.pasteText(c, st);
            st = r.st;
            text += r.text;
          }
        }
        return { st, text };
      }
    }
    // (Command output, `$'…'`: not known here.)
    throw new ArithUnknown();
  }

  /**
   * The text of `o`, an argument of `let`, once expanded; throws `ArithUnknown` when it is not known here (also when an
   * unquoted expansion may be split or globbed).
   */
  private letText(o: SyntaxNode, st: ShellState): { st: ShellState; text: string } {
    // (A `$(( ))` in it ran with the words of the command: its value is not kept.)
    if (descendants(o, ['arithmetic_expansion']).length) throw new ArithUnknown();
    let text = '';
    for (const p of o.type === 'concatenation' ? o.namedChildren : [o]) {
      const plain = staticWordValue(p) ?? (p.type === 'word' && !/[$`'"\\]/.test(p.text) ? p.text : undefined);
      const r = plain !== undefined ? { st, text: plain } : this.pasteText(p, st);
      if (plain === undefined && p.type !== 'string' && /[\s*?[]/.test(r.text)) throw new ArithUnknown();
      st = r.st;
      text += r.text;
    }
    return { st, text };
  }

  /**
   * `let` with the arguments `operands`: they are expanded (an error there discards the command, see `defaults`), then
   * each is run as an expression (`x*=3` is one, unless a file matches it). What one whose text is not known here
   * seems to assign may be set.
   */
  letCommand(operands: readonly SyntaxNode[], st: ShellState): ShellState {
    const texts = operands.map((o) => {
      try {
        const x = this.letText(o, st);
        st = x.st;
        return x.text;
      } catch (e) {
        /* c8 ignore next -- `letText` throws `ArithUnknown` only */
        if (!(e instanceof ArithUnknown)) throw e;
        return undefined;
      }
    });
    // (bash stops at the first operand that fails: once one may have, what those after it assign may be.)
    let unsure = false;
    operands.forEach((o, i) => {
      const text = texts[i];
      if (text === undefined) {
        // (What its `$(( ))` assign was made with the words.)
        st = this.mayAssign(descendants(o, ['arithmetic_expansion']).reduce((t, a) => t.replace(a.text, ''), o.text), st, o);
        unsure = true;
        return;
      }
      const from = st;
      st = this.arithGuard(o.text, st, o, () => this.arithText(text, from, o, true), unsure).st;
      unsure = this.unsure;
    });
    return st;
  }

  /**
   * The names `text` seems to assign (`x = 1`, `i++`), also through the values of the variables it names (`x='i = 1'`),
   * which may be set from `st`, to values not known here.
   */
  private mayAssign(text: string, st: ShellState, at: SyntaxNode): ShellState {
    const targets = new Set<string>();
    for (const m of text.matchAll(ARITH_ASSIGNED)) targets.add(`${m[1] ?? m[3] ?? m[4]}${m[2] ? '[' : ''}`);
    for (const name of new Set(text.match(/[A-Za-z_]\w*/g))) for (const t of this.valueAssigns(st, name)) targets.add(t);
    let after = st;
    for (const t of targets) after = this.w.builtins.assign(after, t.replace('[', ''), t.endsWith('['), { append: false, text: undefined, array: false }, at, false);
    return after === st ? st : merge([st, after], this.w.posix);
  }

  /** What the values reached from the variable `name` seem to assign, each remembered with the variables it read. */
  private readonly assignsMemo = new Map<string, { deps: ReadonlyMap<string, unknown>; targets: ReadonlySet<string> }>();

  /**
   * What the value of the variable `name` seems to assign, read as an expression, and the values of the variables it
   * names, in turn (see `mayAssign`): each name, followed by `[` for an element.
   */
  private valueAssigns(st: ShellState, name: string): ReadonlySet<string> {
    const hit = this.assignsMemo.get(name);
    if (hit && this.sameReads(st, hit.deps)) return hit.targets;
    const deps = new Map<string, unknown>([[CONTEXT, context(st)]]);
    const targets = new Set<string>();
    const texts: string[] = [];
    const seen = new Set<string>();
    let pure = true;
    const read = (n: string): void => {
      if (seen.has(n)) return;
      seen.add(n);
      const v = st.variables.get(n);
      deps.set(n, v);
      // (A nameref reads other variables: not remembered.)
      if (isNameref(v)) pure = false;
      const text = this.w.variableText(st, n);
      if (text) texts.push(text);
    };
    read(name);
    for (let t = texts.pop(); t !== undefined; t = texts.pop()) {
      for (const m of t.matchAll(ARITH_ASSIGNED)) targets.add(`${m[1] ?? m[3] ?? m[4]}${m[2] ? '[' : ''}`);
      for (const n of t.match(/[A-Za-z_]\w*/g) ?? []) read(n);
    }
    if (pure) this.assignsMemo.set(name, { deps, targets });
    return targets;
  }

  /** Whether the variables (and `CONTEXT`) in `deps` are the same in `st`. */
  private sameReads(st: ShellState, deps: ReadonlyMap<string, unknown>): boolean {
    for (const [k, v] of deps) if ((k === CONTEXT ? context(st) : st.variables.get(k)) !== v) return false;
    return true;
  }

  /** Runs arithmetic (`run`) from `st`: an error stops it, with what was assigned before it. */
  arithRun(run: (st: ShellState) => ShellState, st: ShellState): ShellState {
    try {
      return run(st);
    } catch (e) {
      if (e instanceof ArithError) return e.st;
      /* c8 ignore next -- only an arithmetic error is thrown on purpose */
      throw e;
    }
  }

  /** Runs `run`, a side of an expression bash may not take: an error in it may not happen, so it is not known. */
  private unsureSide(run: () => { st: ShellState; value?: bigint }): { st: ShellState; value?: bigint } {
    try {
      return run();
    } catch (e) {
      throw e instanceof ArithError ? new ArithUnknown() : e;
    }
  }

  /** Runs the arithmetic expressions `nodes` in turn, at `at` (see `arith`). */
  private arithList(nodes: readonly SyntaxNode[], st: ShellState, at: SyntaxNode): ShellState {
    for (const e of nodes) st = this.arith(e, st, at).st;
    return st;
  }

  /**
   * Runs the arithmetic expression `e` (6.5) from `st`: its assignments (`x = 1`, `y += 2`, `i++`), in the order bash
   * makes them, with their values when they are known. `e` is read from text whose expansions are done (`arithText`):
   * one left is an error, as are quotes. `at`: the node the assignments are made at. Gives the state after it, and its
   * value when known; throws `ArithError` where bash fails, `ArithUnknown` where it is not known.
   */
  private arith(e: SyntaxNode, st: ShellState, at: SyntaxNode): { st: ShellState; value?: bigint } {
    if (++this.arithSteps > ARITH_STEPS || ++this.arithWalkSteps > ARITH_WALK_STEPS || this.arithNesting >= ARITH_NESTING) throw new ArithUnknown('limit');
    this.arithNesting++;
    try {
      return this.arithNode(e, st, at);
    } finally {
      this.arithNesting--;
    }
  }

  /** `arith` of `e`, once its steps are counted. */
  private arithNode(e: SyntaxNode, st: ShellState, at: SyntaxNode): { st: ShellState; value?: bigint } {
    const sub = (x: SyntaxNode, s: ShellState): { st: ShellState; value?: bigint } => this.arith(x, s, at);
    switch (e.type) {
      case 'number': return { st, value: this.literal(e.text, st) };
      case 'variable_name': return this.arithValue(st, e.text, at);
      case 'word':
        // A name in `for (( ))`; an index the parser keeps as text (`a[i++]`), read again. Anything else is text the
        // parser could not read (`ArithUnknown`).
        if (NAME.test(e.text)) return this.arithValue(st, e.text, at);
        if (e.field === 'index') return this.arithText(e.text, st, at, false);
        throw new ArithUnknown();
      // An element of an array, once its index has run: its value is not followed (see `unsure`).
      case 'subscript': {
        const after = this.subscriptIndex(e, st, at);
        // (Its value runs as an expression: one the script may not have written may assign any variable.)
        this.w.unsetRead(after, field(e, 'name')!.text);
        this.markUnsure();
        return { st: after };
      }
      case 'parenthesized_expression': {
        // (Its expressions are separated by commas: the last one gives the value.)
        let r: { st: ShellState; value?: bigint } = { st };
        for (const x of e.namedChildren) r = this.arith(x, r.st, at);
        return r;
      }
      case 'postfix_expression': case 'unary_expression': {
        const op = e.children.find((c) => !c.named)!.type;
        const operand = e.namedChildren[0];
        if (op === '++' || op === '--') {
          // (`incDecText` leaves no `++` or `--` before or after what is not a name: bash reads those as signs, or fails.)
          /* c8 ignore next */
          if (!['variable_name', 'subscript', 'word'].includes(operand.type)) throw new ArithUnknown();
          // `i++` is the value before, `++i` the value after.
          const r = this.arithAssign(operand, op === '++' ? '+=' : '-=', 1n, st, at);
          return { st: r.st, value: e.type === 'postfix_expression' ? r.old : r.value };
        }
        const r = sub(operand, st);
        const v = r.value;
        return { st: r.st, value: v === undefined ? undefined : op === '-' ? wrap(-v) : op === '!' ? BigInt(v === 0n) : op === '~' ? ~v : v };
      }
      case 'ternary_expression': {
        const consequence = field(e, 'consequence');
        const alternative = field(e, 'alternative');
        // (An operand missing is a syntax error: `1 ? 2 :`.)
        if (!consequence || !alternative) throw new ArithUnknown();
        const c = sub(field(e, 'condition')!, st);
        if (c.value !== undefined) return sub(c.value !== 0n ? consequence : alternative, c.st);
        // (Not known which branch: what either assigns may be.)
        const a = this.unsureSide(() => sub(consequence, c.st));
        const b = this.unsureSide(() => sub(alternative, c.st));
        return { st: merge([a.st, b.st], this.w.posix), value: a.value === b.value ? a.value : undefined };
      }
      case 'binary_expression': {
        const op = field(e, 'operator')!.type;
        const left = field(e, 'left')!;
        const right = field(e, 'right');
        // (An operand missing is a syntax error: `1 +`.)
        if (!right) throw new ArithUnknown();
        if (ARITH_ASSIGN.has(op)) return this.arithAssign(left, op, right, st, at);
        const l = sub(left, st);
        if (op === '&&' || op === '||') {
          // The right side runs only when the left one does not decide.
          if (l.value !== undefined && (l.value !== 0n) === (op === '||')) return { st: l.st, value: BigInt(op === '||') };
          const r = l.value === undefined ? this.unsureSide(() => sub(right, l.st)) : sub(right, l.st);
          if (l.value === undefined) return { st: r.st === l.st ? l.st : merge([l.st, r.st], this.w.posix) };
          return { st: r.st, value: r.value === undefined ? undefined : BigInt(r.value !== 0n) };
        }
        const r = sub(right, l.st);
        if (r.value !== undefined && arithError(op, r.value)) throw new ArithError(r.st);
        const v = l.value === undefined || r.value === undefined ? undefined : ARITH_OPS[op]?.(l.value, r.value);
        return { st: r.st, value: v === undefined ? undefined : wrap(v) };
      }
    }
    // An expansion left (`$z` from a value), quotes: bash fails, but where is not followed (`ArithUnknown`).
    throw new ArithUnknown();
  }

  /** The value of a constant (`010` is 8, `2#101` is 5); an invalid one (`08`, `0xG`) is an error. */
  private literal(text: string, st: ShellState): bigint | undefined {
    const lit = arithLiteral(text);
    if (lit?.type === 'invalid') throw new ArithError(st);
    return lit && wrap(BigInt(lit.value));
  }

  /** Runs the index of `target` (`a[i++]`): arithmetic, unless the array is associative (`m[i++]` is a key). */
  private subscriptIndex(target: SyntaxNode, st: ShellState, at: SyntaxNode): ShellState {
    const name = field(target, 'name')!.text;
    // (Whether the index runs depends on the array: a value read that reads it is remembered with it.)
    this.noteRead(st, name);
    const assoc = attribute(st, name, 'A');
    if (assoc === 'on') return st;
    if (assoc === 'unknown') {
      const after = this.unsureSide(() => ({ st: this.arithList(fields(target, 'index'), st, at) })).st;
      return after === st ? st : merge([st, after], this.w.posix);
    }
    return this.arithList(fields(target, 'index'), st, at);
  }

  /**
   * `target op right` (`x = 1`, `a[i] += 2`), or `++`/`--` of `target` (`right` is 1): the old value is read before the
   * right side runs, as bash does (not for `=`). `at`: see `arith`. Gives the new value and the old one, when known.
   */
  private arithAssign(target: SyntaxNode, op: string, right: SyntaxNode | bigint, st: ShellState, at: SyntaxNode): { st: ShellState; value?: bigint; old?: bigint } {
    const subscript = target.type === 'subscript';
    const name = subscript ? field(target, 'name')!.text : target.text;
    // Assigning to what is no variable (`(i = 1) = 2`, `x >= c /= 2`) is an error, once it has run.
    if (!NAME.test(name)) throw new ArithError(this.arith(target, st, at).st);
    let old: bigint | undefined;
    if (subscript) st = this.subscriptIndex(target, st, at);
    else if (op !== '=') ({ st, value: old } = this.arithValue(st, name, at));
    const r: { st: ShellState; value?: bigint } = typeof right === 'bigint' ? { st, value: right } : this.arith(right, st, at);
    st = r.st;
    if (r.value !== undefined && arithError(op.slice(0, -1), r.value)) throw new ArithError(st);
    // (Assigning a readonly variable is an error.)
    const resolved = this.w.builtins.resolve(st, name);
    if (resolved && attribute(st, resolved, 'r') === 'on') throw new ArithError(st);
    const by = op === '=' ? undefined : ARITH_OPS[op.slice(0, -1)];
    const v = r.value === undefined ? undefined : !by ? r.value : old === undefined ? undefined : by(old, r.value);
    const value = v === undefined ? undefined : wrap(v);
    const after = this.w.builtins.assign(st, name, subscript, { append: false, text: value === undefined ? undefined : String(value), array: false }, at, false);
    return { st: this.unsure && after !== st ? merge([st, after], this.w.posix) : after, value, old };
  }

  /** The variables whose values are being read as expressions, with the state each was read in. */
  private readonly arithReading: { name: string; st: ShellState }[] = [];
  /** The values read as expressions that are constants (`1 + 2`), or null. */
  private readonly constants = new Map<string, bigint | null>();
  /** What each value being read as an expression has read so far (see `arithValue`). */
  readonly arithReads: ArithReads[] = [];
  /** The values of variables read as expressions, by name, with what each read (`ARITH_MEMO`, most recent first). */
  private readonly arithMemo = new Map<string, ArithRemembered[]>();

  /** Notes that the value being read as an expression (if any) depends on the variable `name` and on `CONTEXT`. */
  noteRead(st: ShellState, name: string): void {
    const top = this.arithReads[this.arithReads.length - 1];
    if (!top) return;
    const v = st.variables.get(name);
    top.deps.set(name, v);
    top.deps.set(CONTEXT, context(st));
    // (A nameref reads other variables: not remembered.)
    if (isNameref(v)) top.pure = false;
  }

  /** The value of `name` remembered for `st`: one whose reads are the same in `st`. */
  private remembered(st: ShellState, name: string): ArithRemembered | undefined {
    return this.arithMemo.get(name)?.find((m) => this.sameReads(st, m.deps));
  }

  /**
   * The value of the variable `name` in arithmetic: an unset or empty one is 0; a value is an expression, run where
   * it is read (`y=x` gives x's value, `y='z = 4'` sets z), with the expansions in its subscripts. `at`: where its
   * assignments are made. A value read that changes nothing is remembered with what it read, so that a value read
   * again (`v2='v1 + v1'`) is not run again, unless those have changed.
   */
  private arithValue(st: ShellState, name: string, at: SyntaxNode): { st: ShellState; value?: bigint } {
    const value = this.w.variableText(st, name);
    this.w.unsetRead(st, name);
    if (value === undefined) {
      // A value not known is an expression too, unless it is surely a number (see `unsure`).
      const target = this.w.builtins.resolve(st, name);
      if (!target || !(alwaysNumeric(target) || attribute(st, target, 'i') === 'on')) this.markUnsure();
      return { st };
    }
    const text = (value ?? '').trim();
    if (text === '') return { st, value: 0n };
    let constant = this.constants.get(text);
    if (constant === undefined) this.constants.set(text, (constant = evalArithWrapping(text)?.value ?? null));
    if (constant !== null) return { st, value: constant };
    const seen = this.remembered(st, name);
    const up = this.arithReads[this.arithReads.length - 1];
    const fits = seen && this.arithReading.length + seen.depth <= ARITH_DEPTH;
    if (seen && (seen.unknown !== 'deep' || !fits)) {
      if (up) {
        for (const [k, v] of seen.deps) up.deps.set(k, v);
        up.depth = Math.max(up.depth, seen.depth + 1);
      }
      if (seen.unknown === 'always') throw new ArithUnknown();
      if (!fits) throw new ArithUnknown('deep');
      if (seen.unsure) this.markUnsure();
      if (seen.assumed) this.w.markAssumed();
      return { st, value: seen.value };
    }
    // A name read again with nothing changed since leads back to itself for ever: bash fails at its recursion
    // limit. (With something changed, `x='i++ < 5 ? x : 0'`, it may end: followed so deep only.)
    if (this.arithReading.some((r) => r.name === name && r.st === st)) throw new ArithError(st);
    if (this.arithReading.length >= ARITH_DEPTH) throw new ArithUnknown('deep');
    const from = this.arithReading.length;
    const reads: ArithReads = { deps: new Map(), pure: true, depth: 1, unsure: false, assumed: false };
    this.arithReading.push({ name, st });
    this.arithReads.push(reads);
    this.noteRead(st, name);
    let r: { st: ShellState; value?: bigint };
    try {
      r = this.arithText(text, st, at, true);
    } catch (e) {
      // What is not known stays so with the same reads, from as deep (`deep`); not when steps so far made it so.
      if (e instanceof ArithUnknown && e.why !== 'limit') {
        if (e.why === 'deep') reads.depth = ARITH_DEPTH - from + 1;
        this.remember(name, reads, undefined, e.why === 'deep' ? 'deep' : 'always');
      }
      throw e;
    } finally {
      this.arithReading.pop();
      this.arithReads.pop();
      if (up) {
        for (const [k, v] of reads.deps) up.deps.set(k, v);
        up.pure &&= reads.pure;
        up.unsure ||= reads.unsure;
        up.assumed ||= reads.assumed;
        up.depth = Math.max(up.depth, reads.depth + 1);
      }
    }
    if (r.st === st && reads.pure) this.remember(name, reads, r.value, false);
    return r;
  }

  private remember(name: string, reads: ArithReads, value: bigint | undefined, unknown: ArithRemembered['unknown']): void {
    const list = this.arithMemo.get(name) ?? [];
    list.unshift({ deps: reads.deps, depth: reads.depth, value, unknown, unsure: reads.unsure, assumed: reads.assumed });
    if (list.length > ARITH_MEMO) list.pop();
    this.arithMemo.set(name, list);
  }

  /** Each arithmetic text read, once per model: its text for the parser (`incDecText`), its nodes, whether bash reads them so; null when bash fails on it. */
  private readonly arithTrees = new Map<string, { text: string; cmd: readonly SyntaxNode[]; valid: boolean } | null>();

  /**
   * Runs an arithmetic expression given as text, at `at`; `brackets`: its subscripts are still to be expanded (a
   * variable's value, an argument of `let`). Text the parser may read otherwise than bash (a syntax error, a `++` it
   * splits otherwise) is not known: bash makes the assignments before the error.
   */
  private arithText(text: string, st: ShellState, at: SyntaxNode, brackets: boolean): { st: ShellState; value?: bigint } {
    let tree = this.arithTrees.get(text);
    if (tree === undefined) {
      // (Parentheses left open would be closed by the `))` around the text: `((x` fails in bash, where it is 2 here.)
      const lexed = balanced(text) ? incDecText(text) : undefined;
      if (lexed) {
        const cmd = parser().parse(`(( ${lexed.text} ))`).root.namedChildren;
        tree = { text: lexed.text, cmd, valid: cmd.length === 1 && cmd[0].type === 'arithmetic_command' && !hasError(cmd[0]) && incDecCount(cmd[0]) === lexed.ops };
      } else tree = null;
      this.arithTrees.set(text, tree);
    }
    if (!tree) throw new ArithUnknown();
    const { cmd } = tree;
    if (brackets && cmd.length === 1 && cmd[0].type === 'arithmetic_command' && cmd[0].namedChildren.length) {
      const x = this.arithExpand(cmd[0].namedChildren, st, true);
      if (x.text !== tree.text) return this.arithText(x.text, x.st, at, false);
    }
    if (!tree.valid) throw new ArithUnknown();
    let r: { st: ShellState; value?: bigint } = { st, value: 0n };
    for (const e of cmd[0].namedChildren) r = this.arith(e, r.st, at);
    return r;
  }
}
