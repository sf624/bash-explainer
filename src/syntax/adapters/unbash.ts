// The unbash adapter: turns unbash's AST into the model of ../tree.ts (see docs/design/syntax-tree.md).
// The only module that imports unbash. unbash gives the structure of executable syntax but no positions
// for comments, keywords and operators, so the adapter builds the named nodes from its AST and gets
// the rest from the text between them (./tokens.ts).
import { forEachChild, parse } from 'unbash';
import type * as U from 'unbash';
import type { BashParser, FieldName, Point, SyntaxError, SyntaxNode, SyntaxTree } from '../tree';
import { type BraceBuilder, bracePieces, type Range } from './braces';
import { type Joined, nameBefore, prepared } from './continuations';
import { extglobLike, NUMBER } from './extglob';
import { attachedSubstitutions, type Children, scriptErrors as errorsOf } from './rereads';
import { scanGap } from './tokens';
import { splitElement } from '../../staticword';

type Mut = {
  -readonly [K in keyof SyntaxNode]: K extends 'children' | 'namedChildren' ? Mut[] : K extends 'parent' ? Mut | null : SyntaxNode[K];
} & {
  /** Where a node with a heredoc ends on its own line, before the body that lies after the lines that follow. */
  lineEnd?: number;
};


// (The parser's own list, for the node it builds: the syntax layer does not import the semantic model's, src/semantics/effects.ts.)
const DECLARATIONS = new Set(['declare', 'typeset', 'export', 'readonly', 'local']);
type ArithCtx = 'cmd' | 'slice';
/** A word part that is a node of its own, not a run of plain text. */
type Part = Exclude<U.WordPart, U.LiteralPart | U.GlobPart | U.ExtendedGlobPart | U.BraceExpansionPart>;
const PLAIN = new Set(['Literal', 'Glob', 'ExtendedGlob', 'BraceExpansion']);
/** The roles of the words bash never brace-expands: patterns, the operands of `[[ ]]` and of `${x:-word}`, arithmetic. */
const NO_BRACES = new Set(['pattern', 'case', 'casealt', 'regex', 'test', 'operand', 'arith', 'index']);
/** What the pattern of ${a#…} may hold and still be one regex. */
const WORDS = new Set(['word', 'number', 'string', 'concatenation']);
const PATTERN_PARTS = new Set(['Literal', 'Glob', 'SimpleExpansion', 'ParameterExpansion']);
const isPart = (p: U.WordPart): p is Part => !PLAIN.has(p.type);
/** A part, or a bracket expression's parts that bash expands (`[$x]`, `["$x"].c`) between the text of its `[` and `]`. */
const unbracket = (p: U.WordPart): readonly U.WordPart[] => (p.type === 'Glob' && p.kind === 'bracket' && p.parts.some(isPart) ? [{ type: 'Literal', pos: p.pos, end: p.pos + 1, text: '[', value: '[' }, ...p.parts, { type: 'Literal', pos: p.end - 1, end: p.end, text: ']', value: ']' }] : [p]);
/** Blanks, line continuations and comments. */
const BLANKS = /(?:\s|\\\n|#[^\n]*)*/y;
/** Blanks that do not end a line, and line continuations. */
const HORIZONTAL = /(?:[ \t]|\\\n)*/y;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** unbash's walk of the children of a node, for ./rereads.ts (which reads the nodes by their shape). */
const children = forEachChild as unknown as Children;
const scriptErrors = (script: U.ParsedScript): U.ParseError[] => errorsOf(script, children);

class Converter {
  readonly errors: SyntaxError[] = [];
  /** Where the `&` is of a `&>` or `&>>` whose target is a process substitution (`&> >(tee log)`); see `parseScript`. */
  private readonly bothOutputs = new Set<number>();
  /** Where the operator is of a process substitution that is part of a longer word (`a<(:)`); see `parseScript`. */
  private readonly attached = new Set<number>();
  private readonly lineStarts: number[] = [0];
  /** Ranges that are not code: heredoc bodies and their closing lines. */
  private readonly skip: (readonly [number, number])[] = [];

  /**
   * `text` is what is parsed and scanned: a CR of a CRLF is a blank, a line continuation that bash removes is removed (`joins`: ./continuations.ts).
   * `original` is what the tree reports (the node texts and `tree.text`). `cr`: where the CRs are in it; no node ends with one. `first`: unbash's reading of `text`, if done.
   */
  constructor(private readonly text: string, private readonly cr: ReadonlySet<number> = new Set(), private readonly original: string = text, private readonly joins?: Joined, private readonly first?: U.ParsedScript) {
    for (let i = original.indexOf('\n'); i >= 0; i = original.indexOf('\n', i + 1)) this.lineStarts.push(i + 1);
  }

  // Nodes

  node(type: string, start: number, end: number, field: FieldName | null = null, parent?: Mut): Mut {
    // (unbash can end a part past the text: a backquote that is not closed skips a backslash at the very end, and the one after it.)
    const m: Mut = {
      type, named: true, text: '', startIndex: Math.min(start, this.text.length), endIndex: Math.min(end, this.text.length), startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 },
      parent: null, children: [], namedChildren: [], field, incomplete: false,
    };
    if (parent) parent.children.push(m);
    return m;
  }

  tok(text: string, start: number, parent: Mut, field: FieldName | null = null): Mut {
    const m = this.node(text, start, start + text.length, field, parent);
    m.named = false;
    return m;
  }

  add(parent: Mut, child: Mut, field?: FieldName | null): Mut {
    if (field !== undefined) child.field = field;
    parent.children.push(child);
    return child;
  }

  point(index: number): Point {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return { row: lo, column: index - this.lineStarts[lo] };
  }

  /** Sorts the children, links the parents and fills in the texts and positions, all the way down. */
  seal(m: Mut, parent: Mut | null): void {
    delete m.lineEnd;
    if (this.joins) Object.assign(m, this.joins.span(m));
    // The blank that was a CR at the end of a line is not part of a comment, a word or any other node.
    if (m.endIndex - m.startIndex > 1 && this.cr.has(m.endIndex - 1)) m.endIndex--;
    m.parent = parent;
    m.children.sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);
    m.namedChildren = m.children.filter((c) => c.named);
    m.text = this.original.slice(m.startIndex, m.endIndex);
    m.startPosition = this.point(m.startIndex);
    m.endPosition = this.point(m.endIndex);
    for (const c of m.children) this.seal(c, m);
  }

  /** Adds the tokens and comments in the text of `owner` that its children do not cover, up to `end`. */
  fill(owner: Mut, end = owner.lineEnd ?? owner.endIndex): void {
    const kids = [...owner.children].sort((a, b) => a.startIndex - b.startIndex);
    // A node covers its children, whatever range its parser gave it.
    for (const k of kids) owner.endIndex = Math.max(owner.endIndex, k.endIndex);
    // A node whose last line ends before a heredoc body that one of its parts holds.
    if (kids.some((k) => k.lineEnd !== undefined)) owner.lineEnd = Math.max(...kids.map((k) => k.lineEnd ?? k.endIndex));
    let at = owner.startIndex;
    const gaps: [number, number][] = [];
    for (const k of kids) {
      if (k.startIndex > at) gaps.push([at, k.startIndex]);
      at = Math.max(at, k.lineEnd ?? k.endIndex);
    }
    if (end > at) gaps.push([at, end]);
    for (const [a, b] of gaps) {
      for (const p of scanGap(this.text, a, b, this.skip, undefined, true)) {
        if (p.kind === 'word') {
          // Text between the parts of a node that no part holds: unbash dropped it.
          this.node('error', p.start, p.end, null, owner);
          this.unreadableAt(`unexpected '${p.text}'`, p.start, p.end);
          continue;
        }
        const m = this.node(p.kind === 'comment' ? 'comment' : p.text, p.start, p.end, null, owner);
        m.named = p.kind === 'comment';
      }
    }
  }

  // Positions of tokens that unbash does not give

  /**
   * Adds the token `text` to `parent` where it is in `[from, to)` and returns where it ends, or returns
   * `from` if it is not there: input that stops early (`(( x ? 1`) lacks its separators.
   */
  tokenIn(text: string, from: number, to: number, parent: Mut, field: FieldName | null = null): number {
    const at = this.text.indexOf(text, from);
    if (at < 0 || at + text.length > to) return from;
    this.tok(text, at, parent, field);
    return at + text.length;
  }

  /** The range of the first word-like chunk in `[from, to)` that is `text`, or undefined. */
  find(text: string, from: number, to = this.text.length): number {
    const pieces = scanGap(this.text, from, to, this.skip, (p) => p.text === text);
    return pieces.find((p) => p.text === text)?.start ?? -1;
  }

  // Script and statements

  run(): SyntaxTree {
    const script = this.parseScript();
    const root = this.node('program', 0, this.text.length);
    this.statements(root, script.commands, this.text.length);
    this.fill(root);
    this.unreadable(root, script);
    // The program starts at its first token: leading blanks are not part of it.
    root.startIndex = Math.min(...root.children.map((c) => c.startIndex), this.text.length);
    this.seal(root, null);
    if (this.joins) this.errors.splice(0, Infinity, ...this.errors.map((e) => ({ ...e, ...this.joins!.span(e) })));
    this.errors.sort((x, y) => x.startIndex - y.startIndex || x.endIndex - y.endIndex);
    return { text: this.original, root, errors: this.errors, arithmetic: (owner, start, end) => this.arithmetic(owner as Mut, start, end) };
  }

  /** `SyntaxTree.arithmetic`: the text read as `(( ))` reads its expression, placed where it is, under `owner`. */
  arithmetic(owner: Mut, start: number, end: number): SyntaxNode | undefined {
    const at = this.joins ? this.joins.inText(start, end) : start;
    if (at === undefined) return undefined; // (Not where a line continuation was removed: the nodes are placed one for one.)
    const tree = new Converter(`((${this.text.slice(at, at + end - start)}))`).run();
    const [cmd, more] = tree.root.namedChildren;
    // (Text unbash does not read as an expression is one `word`: `x y`.)
    if (tree.errors.length || more || cmd.type !== 'arithmetic_command' || cmd.namedChildren.length !== 1 || cmd.namedChildren[0].type === 'word') return undefined;
    const place = (m: Mut, parent: Mut): Mut => {
      Object.assign(m, { startIndex: m.startIndex + start - 2, endIndex: m.endIndex + start - 2, parent });
      Object.assign(m, { startPosition: this.point(m.startIndex), endPosition: this.point(m.endIndex) });
      m.children.forEach((c) => place(c, m));
      return m;
    };
    return place(cmd.namedChildren[0] as Mut, owner);
  }

  /**
   * unbash reads `&> >(tee log)` (and `&>>`, `&> <(…)`) as a redirection with no target, then a word: after a
   * compound command (`{ …; } &> >(tee log)`) that word is an unexpected token, and before a command name it is the
   * name. bash redirects both outputs to the process substitution. Where unbash says such a redirection has no
   * target, the `&` is read as a blank, so that unbash reads `> >(tee log)`; `redirect` puts the `&` back.
   * The `<` or `>` of a process substitution that is part of a longer word (`a<(:)`: see `attachedSubstitutions`)
   * is read as a `$`, so that unbash reads one word with a command substitution; `substitution` puts the operator back.
   * unbash may stop at the first error of a kind, so the text is read again until no new one appears: each
   * reading hides one `&` or operator more, so there are at most as many as the `&>`, `<(` and `>(` in the text.
   */
  parseScript(): U.ParsedScript {
    let script = this.first ?? parse(this.text);
    for (;;) {
      const before = this.bothOutputs.size + this.attached.size;
      for (const e of scriptErrors(script)) {
        const op = e.message === 'expected redirect target' && /^[<>]\(/.test(this.text.slice(e.pos)) ? /&>>?[ \t]*$/.exec(this.text.slice(0, e.pos)) : null;
        if (op) this.bothOutputs.add(op.index);
      }
      for (const at of attachedSubstitutions(script, children, this.text)) this.attached.add(at);
      if (this.bothOutputs.size + this.attached.size === before) break;
      script = parse(this.text.split('').map((c, i) => (this.bothOutputs.has(i) ? ' ' : this.attached.has(i) ? '$' : c)).join(''));
    }
    return script;
  }

  /**
   * What unbash reports and the tree does not say yet. It drops a token it did not expect and records an
   * error at its start: that becomes an `error` node and an error of kind `unreadable` (the other errors,
   * of constructs left open, are marked `incomplete` where the construct is built). An error the tree
   * has not told by itself (`a >` has no target) becomes an error of kind `missing` at its place, and
   * the construct there is `incomplete`.
   */
  unreadable(root: Mut, script: U.ParsedScript): void {
    const errors = scriptErrors(script);
    const unexpected = (e: U.ParseError): RegExpExecArray | null => /^unexpected token '(.*)'$/.exec(e.message);
    // The tokens first: an error after one may be about the same place.
    for (const e of [...errors.filter((x) => unexpected(x)), ...errors.filter((x) => !unexpected(x))]) {
      const m = unexpected(e);
      // Where the input just stops, the construct is open, which `incomplete` says.
      const stops = /^expected command after/.test(e.message) && !/\S/.test(this.text.slice(e.pos));
      const unreadable = m || (!stops && /^unterminated extended glob|^expected command after '(if|then|elif|else|while|until|do|for|in)'/.test(e.message));
      if (!unreadable) {
        if (!this.told(e)) this.untold(root, e);
        continue;
      }
      const len = m ? (m[1] === 'newline' ? 1 : m[1].length) : (/^\S*/.exec(this.text.slice(e.pos))![0].length);
      this.unreadableAt(e.message, e.pos, e.pos + len);
      let holder = root;
      for (let down = true; down;) {
        const inner = holder.children.find((c) => c.named && c.startIndex <= e.pos && c.endIndex >= e.pos + len && c.children.length);
        down = inner !== undefined;
        if (inner) holder = inner;
      }
      // (The scanner has read the token as an operator, or unbash as a word: that is the error.)
      const same = holder.children.find((c) => c.startIndex === e.pos && c.endIndex === e.pos + len && !c.children.length);
      if (same) {
        same.type = 'error';
        same.named = true;
      } else if (len && !holder.children.some((c) => c.startIndex < e.pos + len && c.endIndex > e.pos)) this.node('error', e.pos, e.pos + len, null, holder);
    }
  }

  /** Whether the tree already tells of an error unbash reports: an error entry at its place (also just before it, past blanks, or just after, past the next word), or for the keyword it expects. */
  told(e: U.ParseError): boolean {
    // The place, and the word after it.
    const reach = e.pos + /^\s*\S*/.exec(this.text.slice(e.pos))![0].length;
    // (Before it, up to the end of the last thing that is not a blank or a comment.)
    const before = scanGap(this.text, 0, e.pos, this.skip, undefined, true).filter((p) => p.kind !== 'comment').pop();
    const from = before ? before.end : 0;
    if (this.errors.some((x) => x.startIndex <= reach && x.endIndex >= from)) return true;
    const keyword = /^expected '(\w+)'/.exec(e.message);
    if (keyword !== null && this.errors.some((x) => x.message === `Missing "${keyword[1]}"`)) return true;
    // `unterminated …` is at the start of the construct, which says where it stops.
    return e.message.startsWith('unterminated ') && this.errors.some((x) => x.kind === 'missing' && x.startIndex >= e.pos);
  }

  /** An error of unbash that is nowhere in the tree: a `missing` error, and the innermost node at its place is `incomplete`. */
  untold(root: Mut, e: U.ParseError): void {
    // A group with nothing in it: the command is missing after the opener.
    const at = /^expected command in /.test(e.message) ? e.pos + 1 : e.pos;
    let holder = root;
    for (let down = true; down;) {
      const inner = holder.children.filter((c) => c.named && c.type !== 'comment' && c.type !== 'error' && c.startIndex <= at && c.endIndex >= at).pop();
      down = inner !== undefined;
      if (inner) holder = inner;
    }
    this.missing(holder, /^expected redirect target/.test(e.message) ? 'word' : /^expected command in /.test(e.message) ? 'command' : e.message, at);
  }

  /** An error of kind `unreadable`, once for each place. */
  unreadableAt(message: string, start: number, end: number): void {
    if (!this.errors.some((x) => x.kind === 'unreadable' && x.startIndex === start && x.endIndex === end)) this.errors.push({ kind: 'unreadable', message, startIndex: start, endIndex: end });
  }

  statements(parent: Mut, list: readonly U.Statement[], limit: number): void {
    list.forEach((s, i) => {
      // What an open construct in this statement may reach: up to the next statement.
      const room = i + 1 < list.length ? Math.min(limit, list[i + 1].pos) : limit;
      const n = this.dangling(this.pipelineNode(s.command, room), s, room);
      this.add(parent, n);
      // (An open construct has taken the `&` into its own text.)
      if (s.background && (n.lineEnd ?? n.endIndex) < s.end) this.tok('&', s.end - 1, parent);
    });
  }

  /**
   * unbash drops a trailing `|`, `&&` or `||` that has no command after it (and the pipeline with it).
   * The adapter puts the operator back, in a pipeline or list marked incomplete.
   */
  dangling(n: Mut, s: U.Statement, limit: number): Mut {
    if (s.background) return n;
    // The operator follows on the same line (after blanks and line continuations), or it is not ours.
    HORIZONTAL.lastIndex = n.endIndex;
    const at = n.endIndex + HORIZONTAL.exec(this.text)![0].length;
    if (at >= limit || (this.text[at] !== '|' && this.text[at] !== '&')) return n;
    const next = scanGap(this.text, at, limit, this.skip, () => true)[0];
    // (A `&` that is not a background statement, such as `&>`, is not ours either.)
    /* c8 ignore next */
    if (!['|', '|&', '&&', '||'].includes(next.text)) return n;
    // Something follows the operator: it is not dangling (the statement ends there for another reason).
    BLANKS.lastIndex = next.end;
    if (next.end + BLANKS.exec(this.text)![0].length < limit) return n;
    const piped = next.text[0] === '|' && next.text !== '||';
    // A pipe binds tighter than && and ||: it belongs to the last command of a list.
    const last = n.type === 'list' ? n.children.reduce((a, c) => (c.endIndex >= a.endIndex && c.named ? c : a)) : n;
    const whole = piped && last !== n ? last : n;
    const out = piped && whole.type === 'pipeline' ? whole : this.node(piped ? 'pipeline' : 'list', whole.startIndex, next.end);
    if (out !== whole) this.add(out, whole, null);
    this.tok(next.text, next.start, out);
    out.endIndex = next.end;
    this.missing(out, 'command', next.end);
    if (whole === n) return out;
    // (In a list, the last part is replaced by the pipeline.)
    n.children[n.children.indexOf(whole)] = out;
    n.endIndex = out.endIndex;
    return n;
  }

  /** Marks `n` incomplete: it lacks the `what` that should be at `at`. */
  missing(n: Mut, what: string, at: number): void {
    n.incomplete = true;
    // (`at` can be past the text, where unbash ends a part past it: see `node`.)
    const place = Math.min(at, this.text.length);
    this.errors.push({ kind: 'missing', message: `Missing "${what}"`, startIndex: place, endIndex: place });
  }

  /** How far an open construct in `parts[i]` may reach: up to the operator (`&&`, `|`…) before the next part, or up to `limit` for the last. */
  beforeOperator(parts: readonly Range[], i: number, limit: number): number {
    if (i + 1 >= parts.length) return limit;
    const next = Math.min(limit, parts[i + 1].pos);
    const last = scanGap(this.text, parts[i].pos, next, this.skip).filter((x) => x.kind === 'token').pop();
    // (The operator is always there between two parts.)
    /* c8 ignore next */
    return last && ['&&', '||', '|', '|&'].includes(last.text) ? last.start : next;
  }

  pipelineNode(c: U.PipelineNode | U.AndOr, limit: number): Mut {
    if (c.type === 'AndOr') return this.andOr(c, limit);
    return this.pipeline(c, limit);
  }

  andOr(a: U.AndOr, limit: number): Mut {
    let left = this.pipeline(a.commands[0], this.beforeOperator(a.commands, 0, limit));
    for (let i = 1; i < a.commands.length; i++) {
      const right = this.pipeline(a.commands[i], this.beforeOperator(a.commands, i, limit));
      const list = this.node('list', left.startIndex, right.endIndex);
      this.add(list, left);
      this.add(list, right);
      this.fill(list);
      left = list;
    }
    return left;
  }

  pipeline(p: U.PipelineNode, limit: number): Mut {
    if (p.type !== 'Pipeline') return this.commandNode(p, limit);
    const cmds = p.commands.map((c, i) => this.commandNode(c, this.beforeOperator(p.commands, i, limit)));
    let out: Mut | undefined;
    if (cmds.length > 1) {
      out = this.node('pipeline', cmds[0].startIndex, cmds[cmds.length - 1].endIndex);
      for (const c of cmds) this.add(out, c, null);
      this.fill(out);
    } else out = cmds[0];
    // The prefixes act from the last to the first: `! time a | b` negates the timed pipeline, and `time ! a | b` times the negated one.
    for (const prefix of [...p.prefixes].reverse()) out = prefix.type === 'Time' ? this.time(prefix, out) : this.negate(prefix, out);
    return out!;
  }

  /** `!` before `node`: it negates the whole pipeline. */
  negate(prefix: U.Negation, node: Mut | undefined): Mut {
    const neg = this.node('negated_command', prefix.pos, node ? node.endIndex : prefix.end);
    this.tok('!', prefix.pos, neg);
    if (node) this.add(neg, node, null);
    else this.missing(neg, 'command', prefix.end);
    this.fill(neg);
    return neg;
  }

  /** `time [-p] pipeline`: the timed command or pipeline is the body. */
  time(t: U.Time, body: Mut | undefined): Mut {
    const n = this.node('time_statement', t.pos, t.keywordEnd);
    this.tok('time', t.pos, n);
    let end = t.keywordEnd;
    if (t.posix) {
      this.node('word', t.posix.pos, t.posix.end, 'option', n);
      end = t.posix.end;
    }
    n.endIndex = end;
    if (!body) return n;
    if (body.type === 'command' && body.children.every((c) => c.field === 'redirect')) {
      // `time >o`: nothing to time, only redirections, which belong to the statement.
      body.type = 'redirected_statement';
      body.children.unshift(n);
      n.field = 'body';
      body.startIndex = t.pos;
      return body;
    }
    this.add(n, body, 'body');
    n.endIndex = body.endIndex;
    this.fill(n);
    return n;
  }

  commandNode(c: U.CommandNode, limit: number): Mut {
    switch (c.type) {
      case 'Command': return this.command(c);
      case 'Redirected': {
        const body = this.commandNode(c.command, limit);
        return this.redirected(body, c.redirects, c.end);
      }
      default: return this.compound(c, limit);
    }
  }

  // Commands

  command(c: U.Command): Mut {
    type Item = U.Assignment | U.Word | U.Redirection;
    const before: Item[] = [...c.prefix];
    const after: Item[] = [...c.suffix];
    // (`&> >(tee log) cmd` starts at the `&`, before unbash's start: see `parseScript`.)
    const start = this.startOf(c);
    if (!c.name) {
      // Assignments and redirections only (`a=1 >f b=2`, `>f`): a simple command with no words, as bash parses it.
      const node = this.node('command', start, c.end);
      for (const x of before) {
        if (x.type === 'Assignment') this.add(node, this.assignment(x));
        else this.add(node, this.redirect(x as U.Redirection), 'redirect');
      }
      this.fill(node);
      return node;
    }
    // Every redirection of a simple command is its child, wherever it is written (`>o echo a 2>e`), as in bash.
    const args = [...before, ...after];
    const last = args.length ? args[args.length - 1] : c.name;
    const name = nameBefore(c.name, this.text);
    const node = this.node('command', start, Math.max(last === c.name ? name.end : last.end, name.end));
    for (const p of before) {
      if (p.type === 'Assignment') this.add(node, this.assignment(p));
      else this.add(node, this.redirect(p as U.Redirection), 'redirect');
    }
    const cn = this.node('command_name', name.pos, name.end, 'name', node);
    this.add(cn, this.word(name, 'name'));
    // bash's parser reads `name=value` (and `name=(…)`) as an assignment after a first word written as a declaration
    // builtin (`declare`, not `\declare` or `command declare`): unbash gives those as assignments, and so does the
    // model. (After `alias`, which bash also marks, the word defines an alias, not a variable: it stays a word, unless
    // it is `a=(…)`, which bash assigns as an array.)
    const written = this.text.slice(name.pos, name.end);
    const declares = DECLARATIONS.has(written);
    for (const s of after) {
      if (s.type === 'Assignment' && (declares || (written === 'alias' && s.value.type === 'ArrayValue'))) this.add(node, this.assignment(s), 'argument');
      else this.item(node, s, (w) => this.add(node, this.word(w, 'argument'), 'argument'), 'argument');
    }
    this.fill(node);
    return node;
  }

  redirected(body: Mut, redirects: readonly U.Redirection[], end: number): Mut {
    const r = this.node('redirected_statement', body.startIndex, Math.max(body.endIndex, end));
    this.add(r, body, 'body');
    for (const x of redirects) this.add(r, this.redirect(x), 'redirect');
    r.endIndex = Math.max(r.endIndex, ...r.children.map((x) => x.endIndex));
    this.lineEnd(r, end);
    this.fill(r);
    return r;
  }

  /** `r` ends with a heredoc's body, but its line ends where the last of its parts on that line does. */
  lineEnd(r: Mut, end: number): void {
    if (!r.children.some((x) => x.lineEnd !== undefined)) return;
    r.lineEnd = Math.max(end, ...r.children.map((x) => x.lineEnd ?? x.endIndex));
  }

  /** A word of a command (added by `word`), a word that unbash read as an assignment, or a redirection. */
  item(node: Mut, a: U.Assignment | U.Word | U.Redirection, word: (w: U.Word) => void, field: FieldName | null): void {
    if (a.type === 'Word') word(a);
    else if (a.type === 'Assignment') this.add(node, this.assignmentAsWord(a), field);
    else this.add(node, this.redirect(a), 'redirect');
  }

  assignment(a: U.Assignment): Mut {
    const node = this.node('variable_assignment', a.pos, a.end);
    const nameEnd = a.pos + a.name.length;
    if (a.index) {
      const sub = this.node('subscript', a.pos, a.index.end + 1, 'name', node);
      this.add(sub, this.node('variable_name', a.pos, nameEnd), 'name');
      this.tok('[', nameEnd, sub);
      this.add(sub, this.word(a.index, 'index'), 'index');
      this.tok(']', sub.endIndex - 1, sub);
      this.fill(sub);
    } else this.node('variable_name', a.pos, nameEnd, 'name', node);
    const opStart = a.index ? this.text.indexOf(']', a.index.end) + 1 : nameEnd;
    this.tok(a.append ? '+=' : '=', opStart, node);
    if (a.value.type === 'ArrayValue') {
      const arr = this.node('array', a.value.pos, a.value.end, 'value', node);
      for (const e of a.value.elements) this.add(arr, this.element(e));
      this.fill(arr);
    } else if (a.value.text.startsWith('(') && a.value.parts === undefined && !a.value.text.includes(')')) {
      // `a=(1 2` with no `)`: unbash gives the rest as one word. (With text after the `)`, `a=(x)y`, bash
      // assigns the text `(x)y`: an ordinary value.)
      const arr = this.node('array', a.value.pos, a.value.end, 'value', node);
      this.tok('(', a.value.pos, arr);
      for (const m of a.value.text.matchAll(/[^\s()]+/g)) this.node(NUMBER.test(m[0]) ? 'number' : 'word', a.value.pos + m.index!, a.value.pos + m.index! + m[0].length, null, arr);
      this.missing(arr, ')', a.value.end);
    } else if (a.value.end > a.value.pos) this.add(node, this.word(a.value, 'value'), 'value');
    this.fill(node);
    return node;
  }

  /**
   * An element of an array: `[7]=z` sets the element with index 7, and is a concatenation of `[`, the
   * index, `]` and `=z`, (there is no node for it in the model).
   */
  element(e: U.Word): Mut {
    const m = !e.parts ? splitElement(e.text) : null;
    if (!m) return this.word(e, 'element');
    const c = this.node('concatenation', e.pos, e.end);
    const at = e.pos + 1;
    this.node('word', e.pos, at, null, c);
    this.node(NUMBER.test(m.key) ? 'number' : 'word', at, at + m.key.length, null, c);
    this.node('word', at + m.key.length, at + m.key.length + 1, null, c);
    this.node('word', at + m.key.length + 1, e.end, null, c);
    return c;
  }

  /** An assignment where the grammar has an ordinary word (`alias ll='ls -l'`). */
  assignmentAsWord(a: U.Assignment): Mut {
    if (a.value.type !== 'Word' || a.value.end <= a.value.pos) return this.node('word', a.pos, a.end);
    const w: U.Word = a.value.parts ? { ...a.value, parts: [{ type: 'Literal', pos: a.pos, end: a.value.pos, text: '', value: '' }, ...a.value.parts], pos: a.pos } : { ...a.value, pos: a.pos };
    return this.word(w, 'argument');
  }

  // Words

  /** The pieces of a word: runs of plain text, quoted strings, expansions and brace expressions, in order. */
  pieces(w: U.Word, role: string): Mut[] {
    const parts = w.parts;
    // Where bash expands braces, the braces of the word are read as bash does (./braces.ts), around its parts.
    if (!NO_BRACES.has(role) && this.text.slice(w.pos, w.end).includes('{')) {
      const opaque = new Map<number, Part>();
      const nodes = new Set<number>();
      // (The quotes and expansions inside braces or a bracket are parts too, `["{a,b}"]`; an extended glob's stay text, `@(${v:-a,b})`.)
      const visit = (ps: readonly U.WordPart[], glob: boolean): void => ps.forEach((p) => {
        if (isPart(p)) {
          opaque.set(p.pos, p);
          if (!glob) nodes.add(p.pos);
        } else if (p.type !== 'Literal') visit(p.parts ?? [], glob || p.type === 'ExtendedGlob');
      });
      visit(parts ?? [], false);
      const builder: BraceBuilder<Mut> = {
        text: this.text, node: (t, a, b, parent) => this.node(t, a, b, null, parent), tok: (t, a, parent) => this.tok(t, a, parent),
        add: (parent, c) => this.add(parent, c), joined: (a, b, ps) => this.joined(a, b, ps), part: (at) => this.part(opaque.get(at)!),
        plain: (a, b) => this.plain(a, b, role, false),
      };
      return bracePieces(builder, w.pos, w.end, opaque, nodes);
    }
    if (!parts) return [this.plain(w.pos, w.end, role)];
    const alone = parts.every((x) => !isPart(x) && unbracket(x)[0] === x);
    const out: Mut[] = [];
    let [plainStart, plainEnd] = [-1, -1];
    const flush = (): void => {
      if (plainStart >= 0) out.push(this.plain(plainStart, plainEnd, role, alone));
      plainStart = -1;
    };
    for (const p of parts.flatMap(unbracket)) {
      if (!isPart(p)) {
        if (plainStart < 0) plainStart = p.pos;
        plainEnd = p.end;
      } else {
        flush();
        out.push(this.part(p));
      }
    }
    flush();
    return out;
  }

  /** A word as the node that stands for it: a leaf, a quoted string, an expansion, or a concatenation of these. */
  word(w: U.Word, role: string): Mut {
    return this.joined(w.pos, w.end, this.pieces(w, role));
  }

  /** The node of a word made of `pieces`: the piece, or a concatenation of them. */
  joined(pos: number, end: number, pieces: Mut[]): Mut {
    if (pieces.length === 1) return pieces[0];
    const c = this.node('concatenation', pos, end);
    for (const p of pieces) this.add(c, p);
    return c;
  }

  /**
   * Adds a word to `owner`. Where the shell reads a pattern (the right side of `==` in a test, a `case`
   * pattern), a pattern with glob characters and other parts is not one concatenation but its pieces,
   * side by side, as the grammar has it.
   */
  addWord(owner: Mut, w: U.Word, role: string, field: FieldName | null): void {
    const pieces = this.pieces(w, role);
    const flat = role === 'pattern' && pieces.length > 1 && pieces.some((x) => x.type === 'extglob_pattern');
    if (flat) for (const p of pieces) this.add(owner, p, field);
    else this.add(owner, this.word(w, role), field);
  }

  plain(start: number, end: number, role: string, alone = true): Mut {
    const t = this.text.slice(start, end);
    let type = 'word';
    if (role === 'pattern' || role === 'case' || role === 'casealt') {
      type = /^\d+$/.test(t) ? 'number' : extglobLike(t, alone, role === 'casealt', role === 'case') ? 'extglob_pattern' : 'word';
    }
    else if (role === 'regex') type = /[^\w]/.test(t) ? 'regex' : NUMBER.test(t) ? 'number' : 'word';
    else if (NUMBER.test(t) && role !== 'operand') type = 'number';
    return this.node(type, start, end);
  }

  part(p: Part): Mut {
    switch (p.type) {
      case 'SingleQuoted': case 'AnsiCQuoted': {
        const n = this.node(p.type === 'SingleQuoted' ? 'raw_string' : 'ansi_c_string', p.pos, p.end);
        if (!(this.text[p.end - 1] === "'" && p.end - p.pos > (p.type === 'SingleQuoted' ? 1 : 2))) this.missing(n, "'", p.end);
        return n;
      }
      case 'DoubleQuoted': return this.string(p);
      case 'LocaleString': {
        const t = this.node('translated_string', p.pos, p.end);
        this.tok('$', p.pos, t);
        this.add(t, this.string({ pos: p.pos + 1, end: p.end, parts: p.parts }));
        return t;
      }
      case 'SimpleExpansion': {
        const n = this.node('simple_expansion', p.pos, p.end);
        this.tok('$', p.pos, n);
        const name = p.text.slice(1);
        this.node((IDENTIFIER.test(name) && name !== '_') || /^\d+$/.test(name) ? 'variable_name' : 'special_variable_name', p.pos + 1, p.end, null, n);
        return n;
      }
      case 'ParameterExpansion': return this.expansion(p);
      case 'CommandExpansion': case 'ProcessSubstitution': return this.substitution(p);
      case 'ArithmeticExpansion': {
        const n = this.node('arithmetic_expansion', p.pos, p.end);
        const bracket = this.text[p.pos + 1] === '[';
        this.tok(bracket ? '$[' : '$((', p.pos, n);
        if (p.expression) this.arithInto(n, p.expression, 'cmd');
        const close = bracket ? ']' : '))';
        // (An expression that reaches the end has taken the closer: `$(( x $(( (1) ))` is not closed.)
        if (this.text.startsWith(close, p.end - close.length) && p.end - p.pos >= (bracket ? 3 : 5) && !(p.expression && p.expression.end > p.end - close.length)) this.tok(close, p.end - close.length, n);
        else this.missing(n, close, p.end);
        this.fill(n);
        return n;
      }
    }
  }

  string(p: { pos: number; end: number; parts: readonly U.DoubleQuotedChild[] }): Mut {
    const s = this.node('string', p.pos, p.end);
    this.tok('"', p.pos, s);
    // (The quote is there if no part has taken it: `"${a: -"` ends in the quote of an inner string.)
    const closed = this.text[p.end - 1] === '"' && p.end - 1 > p.pos && !p.parts.some((c) => c.end > p.end - 1);
    if (closed) this.tok('"', p.end - 1, s);
    else this.missing(s, '"', p.end);
    let at = p.pos + 1;
    // The grammar reads the text of a string line by line: a newline is not part of any content.
    const content = (to: number): void => {
      for (let i = at; i < to;) {
        const eol = this.text.indexOf('\n', i);
        const end = eol < 0 || eol > to ? to : eol;
        if (end > i) this.node('string_content', i, end, null, s);
        i = end + 1;
      }
    };
    for (const c of p.parts) {
      if (c.type === 'Literal') continue;
      content(c.pos);
      this.add(s, this.part(c));
      at = c.end;
    }
    content(closed ? p.end - 1 : p.end);
    return s;
  }

  expansion(p: U.ParameterExpansionPart): Mut {
    const n = this.node('expansion', p.pos, p.end);
    this.tok('${', p.pos, n);
    if (p.prefix) this.tok(p.prefix, p.pos + 2, n, 'operator');
    if (p.parameter === '#' && !p.prefix && !p.operation) this.tok('#', p.parameterPos, n, 'operator');
    else if (p.parameterEnd > p.parameterPos) {
      const name = this.node(/^[A-Za-z_]\w*$|^\d+$/.test(p.parameter) ? 'variable_name' : 'special_variable_name', p.parameterPos, p.parameterEnd);
      if (p.index) {
        // (unbash gives an index only when the `]` is there.)
        const sub = this.node('subscript', p.parameterPos, this.text.indexOf(']', p.index.end) + 1, null, n);
        this.add(sub, name, 'name');
        this.tok('[', p.parameterEnd, sub);
        if (/^-\d+$/.test(p.index.text)) {
          const neg = this.node('unary_expression', p.index.pos, p.index.end, 'index', sub);
          this.tok('-', p.index.pos, neg, 'operator');
          this.node('number', p.index.pos + 1, p.index.end, null, neg);
        } else this.add(sub, this.word(p.index, 'index'), 'index');
        this.tok(']', sub.endIndex - 1, sub);
      } else this.add(n, name);
    }
    const o = p.operation;
    if (o) {
      switch (o.type) {
        case 'Default': case 'Names':
          this.tok(o.operator, o.pos, n, 'operator');
          if (o.type === 'Default' && o.operand.end > o.operand.pos) this.add(n, this.word(o.operand, 'operand'));
          break;
        case 'CaseModification':
          this.tok(o.operator, o.pos, n, 'operator');
          if (o.operand) this.pattern(o.operand, n);
          break;
        case 'Remove':
          this.tok(o.operator, o.pos, n, 'operator');
          this.pattern(o.operand, n);
          break;
        case 'Replace':
          this.tok(o.operator, o.pos, n, 'operator');
          this.pattern(o.pattern, n);
          if (o.replacement.pos > o.pattern.end || this.text[o.pattern.end] === '/') this.tok('/', this.text.indexOf('/', o.pattern.end), n, 'operator');
          if (o.replacement.end > o.replacement.pos) this.add(n, this.word(o.replacement, 'operand'));
          break;
        case 'Slice':
          this.tok(':', o.pos, n, 'operator');
          this.sliceOperand(n, o.offset);
          if (o.length) {
            this.tok(':', this.text.indexOf(':', o.offset.end), n, 'operator');
            this.sliceOperand(n, o.length);
          }
          break;
        case 'Transform':
          this.tok('@', o.pos, n, 'operator');
          this.tok(o.operand.text, o.operand.pos, n, 'operator');
          break;
        default: {
          // `${s~~}` and `${s~}` (swap the case) are unknown to unbash; the text after the operator is a pattern.
          const swap = /^~~?/.exec(o.operator);
          this.tok(swap ? swap[0] : o.operator, o.pos, n, 'operator');
          if (swap && o.operatorEnd > o.pos + swap[0].length) this.caseOperand(n, o.pos + swap[0].length, o.operatorEnd);
        }
      }
    }
    // The brace is there when the text ends with it and no part has taken it (`${x#"a}`).
    if (this.text[p.end - 1] === '}' && p.end - p.pos > 2 && !n.children.some((c) => c.endIndex > p.end - 1)) this.tok('}', p.end - 1, n);
    else this.missing(n, '}', p.end);
    this.fill(n);
    return n;
  }

  /** The pattern of `${a~~pat}`: unbash reads it as the pattern of `${a^^pat}`, in a text of its own; the nodes are moved to the place of the text. */
  caseOperand(owner: Mut, start: number, end: number): void {
    const shift = start - 4;
    const src = '${x^' + this.text.slice(start, end) + '}';
    const exp = (parse(src).commands[0].command as U.Command).name!.parts![0] as U.ParameterExpansionPart;
    // (unbash reads `${x^` and any text after it as the pattern of a case modification, also when it is not closed.)
    const operand = (exp.operation as U.ParameterCaseOperation).operand!;
    const sub = new Converter(src);
    const holder = sub.node('program', 0, src.length);
    sub.pattern(operand, holder);
    // The `}` of the wrapper is not in the text: an operand that is not closed takes it, and what it adds is cut off.
    const move = (m: Mut): void => {
      m.startIndex += shift;
      m.endIndex = Math.min(m.endIndex + shift, end);
      m.children = m.children.filter((c) => c.startIndex + shift < end);
      m.children.forEach(move);
    };
    holder.children = holder.children.filter((c) => c.startIndex + shift < end);
    for (const c of holder.children) {
      move(c);
      this.add(owner, c);
    }
  }

  /** The offset or length of `${a:1:2}`, which the shell evaluates as arithmetic. */
  sliceOperand(owner: Mut, w: U.Word): void {
    if (w.end <= w.pos) return;
    // unbash parses arithmetic in `$(( ))`: the text goes there, read by a converter of its own, and the nodes are moved to the place of the text.
    const shift = w.pos - 3;
    const src = '$((' + this.text.slice(w.pos, w.end) + '))';
    const word = (parse(src).commands[0].command as U.Command).name!;
    const exp = (word.parts![0] as U.ArithmeticExpansionPart).expression;
    // (An operand that is not closed, `${a:${b`, takes the `))` of the wrapper: it is a word then.)
    if (exp && exp.end <= w.end - shift) {
      const sub = new Converter(src);
      const holder = sub.node('program', 0, src.length);
      sub.arithInto(holder, exp, 'slice');
      const move = (m: Mut): void => {
        m.startIndex += shift;
        m.endIndex += shift;
        m.children.forEach(move);
      };
      for (const c of holder.children) {
        move(c);
        this.add(owner, c);
      }
      // (The converter of an operand has been seen to report nothing; unbash drops what it cannot read.)
      /* c8 ignore next */
      for (const e of sub.errors) this.errors.push({ ...e, startIndex: e.startIndex + shift, endIndex: e.endIndex + shift });
    } else if (exp) this.add(owner, this.word(w, 'operand'));
  }

  /** The pattern of `${a#…}` and `${a/…}`: a regex leaf, or a word if it holds expansions. */
  pattern(w: U.Word, owner: Mut): void {
    if (w.end <= w.pos) return;
    const simple = !w.parts || w.parts.every((x) => PATTERN_PARTS.has(x.type));
    this.add(owner, simple ? this.node('regex', w.pos, w.end) : this.word(w, 'operand'));
  }

  substitution(p: U.CommandExpansionPart | U.ProcessSubstitutionPart): Mut {
    // `${ cmd; }` and `${| cmd; }` (bash 5.3) are substitutions that run in the current shell.
    const funsub = p.type === 'CommandExpansion' && p.text.startsWith('${');
    // (A process substitution in a longer word was read as a command substitution: see `parseScript`.)
    const process = p.type === 'ProcessSubstitution' || this.attached.has(p.pos);
    const open = process ? (p.type === 'ProcessSubstitution' ? p.operator : this.text[p.pos]) + '(' : funsub ? (p.text[2] === '|' ? '${|' : '${') : p.text.startsWith('`') ? '`' : '$(';
    const type = process ? 'process_substitution' : 'command_substitution';
    const n = this.node(type, p.pos, p.end);
    this.tok(open, p.pos, n);
    const close = open === '`' ? '`' : funsub ? '}' : ')';
    const ends = this.text[p.end - 1] === close && p.end - p.pos > open.length;
    if (p.script) {
      if (p.script.source === undefined) this.statements(n, p.script.commands, ends ? p.end - 1 : p.end);
      else this.decoded(n, p, p.script);
    }
    // The closer is there when the text ends with it and no command has taken it: `$((1 + 2)` ends in the `)` of a subshell.
    if (ends && !n.children.some((c) => c.endIndex > p.end - 1)) this.tok(close, p.end - 1, n);
    else this.missing(n, close, p.end);
    this.fill(n);
    return n;
  }

  /**
   * The script of a backquote substitution with escapes in it (`\``, `\$`, `\\`): unbash parses it with
   * the escapes removed, so its positions are in that text. A converter of its own reads it, and the
   * nodes are moved to the original positions.
   */
  decoded(n: Mut, p: U.CommandExpansionPart | U.ProcessSubstitutionPart, script: U.ParsedScript): void {
    const start = p.pos + 1;
    const end = this.text[p.end - 1] === '`' && p.end - p.pos > 1 ? p.end - 1 : p.end;
    // Where each character of the decoded text came from: bash removes the backslash before a `$`, a
    // backquote and a backslash; in double quotes also before a double quote.
    let origin: number[] = [];
    let decoded = '';
    for (const escapable of ['`$\\', '`$\\"']) {
      origin = [];
      decoded = '';
      for (let i = start; i < end; i++) {
        if (this.text[i] === '\\' && i + 1 < end && escapable.includes(this.text[i + 1])) i++;
        origin.push(i);
        decoded += this.text[i];
      }
      if (decoded === script.source) break;
    }
    origin.push(end);
    // Only when unbash decodes in some other way than bash, which has not been seen.
    /* c8 ignore next */
    if (decoded !== script.source) return;
    const sub = new Converter(decoded);
    const holder = sub.node('program', 0, decoded.length);
    sub.statements(holder, script.commands, decoded.length);
    sub.fill(holder);
    sub.unreadable(holder, script);
    const moveStart = (i: number): number => origin[i];
    // A substitution inside this one starts at the backslash that escapes its backquote.
    const escaped = (i: number): boolean => this.text[origin[i]] === '`' && this.text[origin[i] - 1] === '\\' && origin[i] - 1 >= start && (i === 0 || origin[i - 1] < origin[i] - 1);
    const ends = origin.map((o, i) => (i ? origin[i - 1] + 1 : o));
    // The backslash before the character at `i` was removed by the decoding.
    const eaten = (i: number): boolean => (i ? origin[i - 1] < origin[i] - 1 : origin[0] > start);
    const move = (m: Mut): void => {
      const from = m.startIndex;
      m.startIndex = moveStart(from);
      if (m.type === 'command_substitution' && escaped(from)) m.startIndex--;
      // A word that starts with a character whose backslash was removed includes that backslash, so that its
      // text is whole: the explanation removes one level of backslashes from it (`decodedText`).
      else if (WORDS.has(m.type) && eaten(from)) m.startIndex--;
      m.endIndex = Math.max(m.startIndex, ends[m.endIndex]);
      m.children.forEach(move);
      // A parent starts where its first child does, also when that child took in a removed backslash.
      for (const c of m.children) if (c.startIndex < m.startIndex) m.startIndex = c.startIndex;
    };
    holder.children.forEach((c) => { move(c); this.add(n, c); });
    for (const e of sub.errors) this.errors.push({ ...e, startIndex: moveStart(e.startIndex), endIndex: ends[e.endIndex] });
  }

  // Redirections

  /** Where `x` starts, with the `&` of `&> >(tee log)` that `parseScript` hid from unbash. */
  startOf(x: { pos: number }): number {
    return this.bothOutputs.has(x.pos - 1) ? x.pos - 1 : x.pos;
  }

  redirect(r: U.Redirection): Mut {
    const type = r.type === 'HereDoc' ? 'heredoc_redirect' : r.type === 'HereString' ? 'herestring_redirect' : 'file_redirect';
    // (`&> >(tee log)`, read as `> >(tee log)`: see `parseScript`.)
    const amp = this.startOf(r) < r.pos;
    const n = this.node(type, this.startOf(r), r.end);
    if (r.descriptor) {
      this.node('file_descriptor', r.descriptor.pos, r.descriptor.end, 'descriptor', n);
    }
    const opStart = r.descriptor ? r.descriptor.end : n.startIndex;
    this.tok(amp ? `&${r.operator}` : r.operator, opStart, n);
    if (r.type === 'HereDoc') {
      if (r.delimiter) this.node('heredoc_start', r.delimiter.pos, r.delimiter.end, null, n);
      const closing = r.closing;
      const bodyEnd = closing ? closing.end : r.body.end;
      this.skip.push([r.body.pos, bodyEnd]);
      // With `<<-`, the first line's tabs are not part of the body.
      const bodyStart = r.body.pos + (r.operator === '<<-' ? /^\t*/.exec(this.text.slice(r.body.pos, r.body.end))![0].length : 0);
      const body = this.node('heredoc_body', bodyStart, closing ? closing.pos : r.body.end, null, n);
      this.heredocParts(body, r.body);
      if (closing) this.node('heredoc_end', closing.pos, closing.end, null, n);
      else this.missing(n, 'heredoc_end', bodyEnd);
      n.endIndex = bodyEnd;
      n.lineEnd = r.end;
    } else if (r.target) this.add(n, this.word(r.target, 'destination'), r.type === 'HereString' ? null : 'destination');
    return n;
  }

  /** The expansions in a heredoc body, each followed by the text up to the next one (`heredoc_content`), as the grammar has it. */
  heredocParts(body: Mut, b: U.HereDocBody): void {
    const parts = (b.parts ?? []).filter(isPart);
    parts.forEach((p, i) => {
      this.add(body, this.part(p));
      let start = p.end;
      if (this.text[start] === '\n') start++;
      const end = parts[i + 1] ? parts[i + 1].pos : body.endIndex;
      this.node('heredoc_content', Math.min(start, end), end, null, body);
    });
  }

  // Compound commands

  compound(c: U.CompoundCommand | U.Function | U.Coproc, limit: number): Mut {
    switch (c.type) {
      case 'If': return this.ifStatement(c, limit);
      case 'While': return this.loop(c, limit);
      case 'For': case 'Select': return this.forStatement(c, limit);
      case 'ArithmeticFor': return this.cFor(c, limit);
      case 'Case': return this.caseStatement(c, limit);
      case 'Subshell': return this.group(c, 'subshell', '(', ')', limit);
      case 'BraceGroup': return this.group(c, 'compound_statement', '{', '}', limit);
      case 'Function': return this.functionDefinition(c, limit);
      case 'Coproc': return this.coproc(c, limit);
      case 'TestCommand': return this.extendedTest(c);
      case 'ArithmeticCommand': return this.arithmeticCommand(c);
    }
  }

  /** Closes `n` with `kw` at its end, or, if the input stops before it, marks `n` incomplete and ends it where its content ends. */
  close(n: Mut, closed: boolean, kw: string, limit: number): void {
    if (closed) {
      this.tok(kw, n.endIndex - kw.length, n);
      this.fill(n);
      return;
    }
    this.fill(n, limit);
    this.truncate(n);
    this.missing(n, kw, n.endIndex);
  }

  /**
   * Ends an incomplete `n` where its content ends: after its last child, comments included, and after
   * the newline that ends a last statement.
   */
  truncate(n: Mut): void {
    // (An open node always has its keyword, at least.)
    const last = n.children.reduce((a, c) => (c.endIndex > a.endIndex ? c : a));
    let end = last.endIndex;
    if (this.isStatement(last) && this.text[end] === '\n') end++;
    n.endIndex = end;
  }

  /** The closing keyword is there when the node has a width and ends with it. */
  closed(c: Range, kw: string): boolean {
    return c.end > c.pos && this.text.startsWith(kw, c.end - kw.length);
  }

  /** The limit for what is inside `c`: just before its closing keyword, or the outer limit if it has none. */
  inner(c: Range, kw: string, limit: number): number {
    return this.closed(c, kw) ? c.end - kw.length : limit;
  }

  /** The newline that ends the last statement of a clause (an `else`, an item of a `case`) is part of the clause, as the grammar has it. */
  newline(n: Mut): void {
    const last = n.children.reduce<Mut | undefined>((a, c) => (!a || c.endIndex > a.endIndex ? c : a), undefined);
    if (last && this.isStatement(last) && this.text[n.endIndex] === '\n' && last.endIndex === n.endIndex) n.endIndex++;
  }

  isStatement(m: Mut): boolean {
    return m.named && m.type !== 'comment' && !['variable_name', 'word', 'number'].includes(m.type);
  }

  /** Adds the `;` right after `n` (up to `upTo`) to it. */
  terminate(n: Mut, upTo: number): void {
    for (const p of scanGap(this.text, n.endIndex, upTo, this.skip, (q) => q.text !== ';')) {
      if (p.text !== ';') break;
      this.tok(';', p.start, n);
      n.endIndex = p.end;
    }
  }

  /** Gives `field` to what lies between `from` and `to` in `n`, comments apart. */
  mark(n: Mut, from: number, to: number, field: FieldName): void {
    for (const c of n.children) if (c.startIndex >= from && c.endIndex <= to && c.type !== 'comment' && c.type !== 'if' && c.type !== 'while' && c.type !== 'until') c.field = field;
  }

  list(owner: Mut, l: U.CompoundList, limit: number): void {
    this.statements(owner, l.commands, limit);
  }

  ifStatement(c: U.If, limit: number): Mut {
    const n = this.node('if_statement', c.pos, c.end);
    const closed = this.closed(c, 'fi');
    const inner = this.inner(c, 'fi', limit);
    // The condition does not reach into the part after it (a `(` that is never closed would read `then` and on).
    this.list(n, c.clause, c.then.commands.length ? Math.min(inner, c.then.pos) : inner);
    this.list(n, c.then, inner);
    const clauseEnd = c.clause.end;
    const thenKw = this.find('then', clauseEnd, c.then.commands.length ? c.then.pos : inner);
    // (An input that stops after the condition is told by the `fi` that is missing.)
    const stopsAfter = (from: number): boolean => !closed && !/\S/.test(this.text.slice(from, limit));
    if (thenKw < 0 && !stopsAfter(clauseEnd)) this.missing(n, 'then', clauseEnd);
    // Where each clause may reach: up to where the next one starts. (For a part with no commands, unbash's
    // ends are after the keyword that follows, so the end of the part before it is used instead.)
    const starts = [...c.elif.map((e) => e.pos)];
    const last = c.elif[c.elif.length - 1];
    const lastEnd = last ? (last.then.commands.length ? last.then.end : last.clause.end)
      : c.then.commands.length ? Math.max(c.then.end, c.then.commands[c.then.commands.length - 1].end) : clauseEnd;
    const elseKw = c.else ? this.lastKeyword('else', lastEnd, c.else.commands.length ? c.else.pos : inner) : -1;
    if (c.else) starts.push(elseKw);
    c.elif.forEach((e, i) => {
      const next = starts[i + 1] ?? (closed ? c.end - 2 : inner);
      const en = this.node('elif_clause', e.pos, Math.min(e.end, next), null, n);
      this.list(en, e.clause, e.then.commands.length ? Math.min(inner, e.then.pos) : inner);
      this.list(en, e.then, inner);
      this.fill(en);
      if (this.find('then', e.clause.end, e.then.commands.length ? e.then.pos : next) < 0 && !stopsAfter(e.clause.end)) this.missing(en, 'then', e.clause.end);
      this.terminate(en, next);
      this.newline(en);
    });
    if (c.else) {
      const en = this.node('else_clause', elseKw, c.else.commands.length ? c.else.end : elseKw + 4, null, n);
      this.list(en, c.else, inner);
      this.fill(en);
      this.terminate(en, closed ? c.end - 2 : inner);
      this.newline(en);
    }
    this.close(n, closed, 'fi', limit);
    if (thenKw >= 0) this.mark(n, c.pos + 2, thenKw, 'condition');
    return n;
  }

  /** The last `kw` token in `[from, to)`. */
  lastKeyword(kw: string, from: number, to: number): number {
    const found = scanGap(this.text, from, to, this.skip).filter((p) => p.text === kw);
    // (The keyword is there whenever unbash gives an else part.)
    /* c8 ignore next */
    return found.length ? found[found.length - 1].start : to;
  }

  /**
   * Ends a loop whose head ends at `headEnd`: it is open when its `do` is missing. unbash then ends it at
   * its head, and what follows is for other statements: the loop takes only the `;` and the comments
   * after its head.
   */
  finish(n: Mut, headEnd: number, limit: number): void {
    if (!n.incomplete) {
      this.fill(n);
      return;
    }
    const pieces = scanGap(this.text, headEnd, limit, this.skip, (p) => p.text !== ';' && p.kind !== 'comment', true);
    const last = pieces[pieces.length - 1];
    this.fill(n, last && last.text !== ';' && last.kind !== 'comment' ? last.start : limit);
    this.truncate(n);
  }

  /** The `do … done` of a loop; `from` is where the loop's head ends. */
  doGroup(owner: Mut, c: Range, body: U.CompoundList, from: number, limit: number): void {
    const first = body.commands.length ? body.commands[0].pos : limit;
    const doKw = this.find('do', from, first);
    // `for x in a; { …; }`: bash takes a brace group as the body of a `for` loop too.
    const brace = doKw < 0 ? this.find('{', from, first) : -1;
    if (doKw < 0 && brace < 0) {
      owner.incomplete = true;
      this.errors.push({ kind: 'missing', message: 'Missing "do"', startIndex: from, endIndex: from });
      return;
    }
    const kw = doKw >= 0 ? 'done' : '}';
    const closed = this.closed(c, kw);
    const inner = this.inner(c, kw, limit);
    const g = this.node(doKw >= 0 ? 'do_group' : 'compound_statement', doKw >= 0 ? doKw : brace, closed ? c.end : inner, 'body', owner);
    this.list(g, body, inner);
    this.close(g, closed, kw, limit);
  }

  loop(c: U.While, limit: number): Mut {
    const n = this.node('while_statement', c.pos, c.end);
    const inner = this.inner(c, 'done', limit);
    this.list(n, c.clause, inner);
    this.doGroup(n, c, c.body, c.clause.end, limit);
    this.finish(n, c.clause.end, limit);
    const doGroup = n.children.find((x) => x.type === 'do_group');
    this.mark(n, c.pos + c.kind.length, doGroup ? doGroup.startIndex : n.endIndex, 'condition');
    return n;
  }

  forStatement(c: U.For | U.Select, limit: number): Mut {
    const n = this.node(c.type === 'For' ? 'for_statement' : 'select_statement', c.pos, c.end);
    if (c.name.end > c.name.pos) this.add(n, this.node('variable_name', c.name.pos, c.name.end), 'variable');
    let headEnd = c.name.end;
    for (const w of c.wordlist ?? []) {
      this.add(n, this.word(w, 'value'), 'value');
      headEnd = w.end;
    }
    this.doGroup(n, c, c.body, headEnd, limit);
    this.finish(n, headEnd, limit);
    return n;
  }

  group(c: U.Subshell | U.BraceGroup, type: string, open: string, close: string, limit: number): Mut {
    const n = this.node(type, c.pos, c.end);
    this.tok(open, c.pos, n);
    this.list(n, c.body, this.inner(c, close, limit));
    this.close(n, this.closed(c, close), close, limit);
    return n;
  }

  caseStatement(c: U.Case, limit: number): Mut {
    const n = this.node('case_statement', c.pos, c.end);
    const inner = this.inner(c, 'esac', limit);
    this.add(n, this.word(c.word, 'value'), 'value');
    for (const it of c.items) {
      const m = this.node('case_item', it.pos, it.end, null, n);
      it.pattern.forEach((w, k) => this.addWord(m, w, k < it.pattern.length - 1 ? 'casealt' : 'case', 'value'));
      this.list(m, it.body, inner);
      // (A last item with no `;;` keeps the `;` that ends the list of its body: `y) a; esac`.)
      if (!it.terminator) this.terminate(m, c.items[c.items.indexOf(it) + 1]?.pos ?? inner);
      else this.tok(it.terminator, it.end - it.terminator.length, m, it === c.items[c.items.length - 1] ? null : it.terminator === ';;' ? 'termination' : 'fallthrough');
      this.fill(m);
      this.newline(m);
    }
    this.close(n, this.closed(c, 'esac'), 'esac', limit);
    return n;
  }

  functionDefinition(c: U.Function, limit: number): Mut {
    const n = this.node('function_definition', c.pos, c.end);
    this.add(n, this.word(c.name, 'name'), 'name');
    if (c.body.type === 'CompoundList') {
      // A function with no body: the input stops after `f()`.
      n.incomplete = true;
      this.errors.push({ kind: 'missing', message: 'Missing "compound_statement"', startIndex: c.end, endIndex: c.end });
      // (unbash may end it past what holds it: `if x; then f() fi`, where `fi` closes the `if`.)
      n.endIndex = Math.min(n.endIndex, limit);
      this.fill(n);
      this.truncate(n);
      return n;
    }
    const body = this.commandNode(c.body, limit);
    this.add(n, body, 'body');
    n.endIndex = Math.max(n.endIndex, body.endIndex);
    this.fill(n);
    return n;
  }

  coproc(c: U.Coproc, limit: number): Mut {
    const n = this.node('coproc_statement', c.pos, c.end);
    this.tok('coproc', c.pos, n);
    if (c.name) this.add(n, this.word(c.name, 'name'), 'name');
    if (c.body.type !== 'CompoundList') {
      const body = this.commandNode(c.body, limit);
      this.add(n, body, 'body');
      n.endIndex = Math.max(n.endIndex, body.endIndex);
    }
    this.fill(n);
    return n;
  }

  // Tests

  extendedTest(c: U.TestCommand): Mut {
    const n = this.node('extended_test', c.pos, c.end);
    this.tok('[[', c.pos, n);
    const expression = this.testExpression(c.expression);
    this.add(n, expression);
    // An open test ends with its expression: what follows is for other commands.
    this.close(n, this.closed(c, ']]'), ']]', expression.endIndex);
    return n;
  }

  testExpression(e: U.TestExpression): Mut {
    switch (e.type) {
      case 'TestUnary': {
        // `[[ $x ]]` is `-n $x` to unbash, but has no operator in the text.
        if (e.operand.pos === e.pos) return this.word(e.operand, 'test');
        const operand = e.operand.end > e.operand.pos;
        const n = this.node('unary_expression', e.pos, e.end);
        this.node('test_operator', e.pos, e.pos + e.operator.length, 'operator', n);
        if (operand) this.add(n, this.word(e.operand, 'test'));
        return n;
      }
      case 'TestBinary': {
        const n = this.node('binary_expression', e.pos, e.end);
        this.add(n, this.word(e.left, 'test'), 'left');
        const at = this.text.indexOf(e.operator, e.left.end);
        const op = /^-/.test(e.operator) ? this.node('test_operator', at, at + e.operator.length, 'operator', n) : this.tok(e.operator, at, n, 'operator');
        void op;
        this.addWord(n, e.right, e.operator === '=~' ? 'regex' : /^(==?|!=)$/.test(e.operator) ? 'pattern' : 'test', 'right');
        return n;
      }
      case 'TestLogical': {
        let left = this.testExpression(e.operands[0]);
        for (let i = 1; i < e.operands.length; i++) {
          const right = this.testExpression(e.operands[i]);
          const n = this.node('binary_expression', left.startIndex, right.endIndex);
          this.add(n, left, 'left');
          const at = this.text.indexOf(e.operator, left.endIndex);
          this.tok(e.operator, at, n, 'operator');
          this.add(n, right, 'right');
          left = n;
        }
        return left;
      }
      case 'TestNot': {
        let operand = this.testExpression(e.operand);
        for (const neg of [...e.negations].reverse()) {
          const n = this.node('unary_expression', neg.pos, operand.endIndex);
          this.tok('!', neg.pos, n, 'operator');
          this.add(n, operand);
          operand = n;
        }
        return operand;
      }
      case 'TestGroup': {
        const n = this.node('parenthesized_expression', e.pos, e.end);
        this.add(n, this.testExpression(e.expression));
        this.fill(n);
        return n;
      }
    }
  }

  // Arithmetic

  arithmeticCommand(c: U.ArithmeticCommand): Mut {
    const n = this.node('arithmetic_command', c.pos, c.end);
    this.tok('((', c.pos, n);
    if (c.expression) this.arithInto(n, c.expression, 'cmd');
    // (An unclosed `((` has an expression that reaches the end: a `))` there is the expression's, as in `(( x (( (1) ))`.)
    this.close(n, this.closed(c, '))') && !(c.expression && c.expression.end > c.end - 2), '))', this.text.length);
    return n;
  }

  cFor(c: U.ArithmeticFor, limit: number): Mut {
    const n = this.node('c_style_for_statement', c.pos, c.end);
    this.tok('for', c.pos, n);
    let at = this.tokenIn('((', c.pos + 3, limit, n);
    // The header ends where its body starts; a header that stops early has some of its separators missing.
    let complete = at > c.pos + 3;
    if (!complete) this.missing(n, '((', c.pos + 3);
    const part = (e: U.ArithmeticExpression | undefined, field: FieldName): void => {
      if (e) {
        if (field === 'initializer' && e.type === 'ArithmeticBinary' && e.operator === '=') this.add(n, this.forAssignment(e), field);
        else this.arithInto(n, e, 'cmd', field);
        at = e.end;
      }
      if (!complete) return;
      const sep = field === 'update' ? '))' : ';';
      const next = this.tokenIn(sep, at, c.body.pos, n);
      complete = next > at;
      if (complete) at = next;
      else this.missing(n, sep, at);
    };
    part(c.initialize, 'initializer');
    part(c.test, 'condition');
    part(c.update, 'update');
    if (complete) this.doGroup(n, c, c.body, at, limit);
    this.finish(n, at, limit);
    return n;
  }

  forAssignment(e: U.ArithmeticBinary): Mut {
    const n = this.node('variable_assignment', e.pos, e.end);
    this.add(n, this.arith(e.left, 'cmd'), 'name').type = 'variable_name';
    this.tokenIn('=', e.left.end, e.end, n);
    this.add(n, this.arith(e.right, 'cmd'), 'value');
    return n;
  }

  /** The expression as children of `owner`: a comma list is flat. */
  arithInto(owner: Mut, e: U.ArithmeticExpression, ctx: ArithCtx, field?: FieldName): void {
    if (e.type === 'ArithmeticBinary' && e.operator === ',') {
      this.arithInto(owner, e.left, ctx, field);
      this.tokenIn(',', e.left.end, e.end, owner);
      this.arithInto(owner, e.right, ctx, field);
    } else this.add(owner, this.arith(e, ctx), field);
  }

  /** An arithmetic expression; `ctx` says where it is: a `${a:1:2}` slice has no fields. */
  arith(e: U.ArithmeticExpression, ctx: ArithCtx): Mut {
    switch (e.type) {
      case 'ArithmeticBinary': {
        const n = this.node('binary_expression', e.pos, e.end);
        const f = (name: FieldName): FieldName | null => (ctx === 'slice' ? null : name);
        this.add(n, this.arith(e.left, ctx), f('left'));
        this.tokenIn(e.operator, e.left.end, e.end, n, 'operator');
        if (e.right.end > e.right.pos) this.add(n, this.arith(e.right, ctx), f('right'));
        return n;
      }
      case 'ArithmeticUnary': {
        if (ctx === 'slice' && e.operator === '-' && e.prefix && e.operand.type === 'ArithmeticWord' && NUMBER.test(e.operand.value)) return this.node('number', e.pos, e.end);
        const n = this.node(e.prefix ? 'unary_expression' : 'postfix_expression', e.pos, e.end);
        if (e.prefix) {
          this.tok(e.operator, e.pos, n, 'operator');
          this.add(n, this.arith(e.operand, ctx));
        } else {
          this.add(n, this.arith(e.operand, ctx));
          this.tok(e.operator, e.end - e.operator.length, n, 'operator');
        }
        return n;
      }
      case 'ArithmeticTernary': {
        const n = this.node('ternary_expression', e.pos, e.end);
        this.add(n, this.arith(e.test, ctx), 'condition');
        this.tokenIn('?', e.test.end, e.end, n);
        // (An expression that stops early has no part where the text ends.)
        if (e.consequent.end > e.consequent.pos) this.add(n, this.arith(e.consequent, ctx), 'consequence');
        this.tokenIn(':', e.consequent.end, e.end, n);
        if (e.alternate.end > e.alternate.pos) this.add(n, this.arith(e.alternate, ctx), 'alternative');
        return n;
      }
      case 'ArithmeticGroup': {
        const n = this.node('parenthesized_expression', e.pos, e.end);
        this.tok('(', e.pos, n);
        this.arithInto(n, e.expression, ctx);
        if (e.expression.end < e.end && this.text[e.end - 1] === ')') this.tok(')', e.end - 1, n);
        else this.missing(n, ')', e.end);
        return n;
      }
      case 'ArithmeticCommandExpansion': return this.substitution({ type: 'CommandExpansion', pos: e.pos, end: e.end, text: e.text, script: e.script });
      case 'ArithmeticWord': return this.arithWord(e);
    }
  }

  arithWord(e: U.ArithmeticWord): Mut {
    const t = this.text.slice(e.pos, e.end);
    if (e.parts) return this.word({ type: 'Word', pos: e.pos, end: e.end, text: t, value: e.value, parts: e.parts }, 'arith');
    if (/^\$[A-Za-z_]\w*$/.test(t) || /^\$[0-9@*#?$!_-]$/.test(t)) return this.part({ type: 'SimpleExpansion', pos: e.pos, end: e.end, text: t });
    const sub = /^([A-Za-z_]\w*)\[(.*)\]$/s.exec(t);
    if (sub) {
      const n = this.node('subscript', e.pos, e.end);
      this.node('variable_name', e.pos, e.pos + sub[1].length, 'name', n);
      this.tok('[', e.pos + sub[1].length, n);
      const ix = e.pos + sub[1].length + 1;
      this.node(NUMBER.test(sub[2]) ? 'number' : 'word', ix, ix + sub[2].length, 'index', n);
      this.tok(']', e.end - 1, n);
      return n;
    }
    // A word that starts with a digit is a constant, also when bash rejects it (`08`, `0b11`, `1e3`, `2#2`): the explanation says why.
    if (/^\d[0-9A-Za-z#@_]*$/.test(t)) return this.node('number', e.pos, e.end);
    return this.node(IDENTIFIER.test(t) ? 'variable_name' : 'word', e.pos, e.end);
  }
}

/** The unbash adapter's parser. */
// (The declaration shows as a branch that never runs: it is the getter tsx makes for the export.)
/* c8 ignore next */
export function createUnbashParser(): BashParser {
  return {
    parse(text: string): SyntaxTree {
      // (The text unbash reads: ./continuations.ts.)
      const { masked, carriageReturns, joins, script } = prepared(text, parse, children);
      const tree = new Converter(joins ? joins.text : masked, new Set(carriageReturns), text, joins, script).run();
      return carriageReturns.length ? { ...tree, carriageReturns } : tree;
    },
  };
}
