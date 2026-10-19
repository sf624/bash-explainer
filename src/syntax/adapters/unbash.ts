// The unbash adapter: turns unbash's AST into the model of ../tree.ts (see docs/design/syntax-tree.md).
// The only module that imports unbash. unbash gives the structure of executable syntax but no positions
// for comments, keywords and operators, so the adapter builds the named nodes from its AST and gets
// the rest from the text between them (./tokens.ts).
import { forEachChild, parse } from 'unbash';
import type * as U from 'unbash';
import type { BashParser, FieldName, Point, SyntaxError, SyntaxNode, SyntaxTree } from '../tree';
import { scanGap } from './tokens';

type Mut = {
  -readonly [K in keyof SyntaxNode]: K extends 'children' | 'namedChildren' ? Mut[] : K extends 'parent' ? Mut | null : SyntaxNode[K];
} & {
  /** Where a node with a heredoc ends on its own line, before the body that lies after the lines that follow. */
  lineEnd?: number;
};

/** A range of the text. */
interface Range { pos: number; end: number }

const DECLARATIONS = new Set(['declare', 'typeset', 'export', 'readonly', 'local']);
const NUMBER = /^-?\d+$/;
const BRACE_RANGE = /^\{(-?\d+|[A-Za-z])\.\.(-?\d+|[A-Za-z])(\.\.-?\d+)?\}$/;
type ArithCtx = 'cmd' | 'for' | 'slice';
/** A word part that is a node of its own, not a run of plain text. */
type Part = Exclude<U.WordPart, U.LiteralPart | U.GlobPart | U.ExtendedGlobPart | U.BraceExpansionPart>;
const PLAIN = new Set(['Literal', 'Glob', 'ExtendedGlob', 'BraceExpansion']);
/** What the pattern of ${a#…} may hold and still be one regex. */
const WORDS = new Set(['word', 'number', 'string', 'concatenation']);
const PATTERN_PARTS = new Set(['Literal', 'Glob', 'SimpleExpansion', 'ParameterExpansion']);
const isPart = (p: U.WordPart): p is Part => !PLAIN.has(p.type);
/** Blanks, line continuations and comments. */
const BLANKS = /(?:\s|\\\n|#[^\n]*)*/y;
/** Blanks that do not end a line, and line continuations. */
const HORIZONTAL = /(?:[ \t]|\\\n)*/y;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Whether tree-sitter-bash reads a plain run of text as an `extglob_pattern` rather than a word: the
 * choice is made by its scanner, which takes a run that starts with a letter or a glob character, whose
 * second character goes on as a word, and that has something besides letters, dots and backslashes in it.
 * `alone` is a run that is a whole pattern. A run before a `|` is always one.
 */
function extglobLike(t: string, alone: boolean, alternative: boolean, closedByParen: boolean): boolean {
  // The scanner starts only on a letter or one of these.
  if (!/^[A-Za-z?*+@!\\\-).[]/.test(t)) return false;
  // A backslash starts it only before a blank or a quote.
  if (t[0] === '\\' && !/^\\["\s]/.test(t)) return false;
  if (/[*?[]/.test(t)) return t.length < 2 || t[0] === '[' || /[A-Za-z0-9("[?/\\_*|]/.test(t[1]);
  if (alternative) return true;
  if (!alone || NUMBER.test(t)) return false;
  if (t.length === 1) return closedByParen ? !/[A-Za-z]/.test(t) : true;
  if (!/[A-Za-z0-9("[?/\\_*]/.test(t[1])) return false;
  return !/[A-Za-z]/.test(t[0]) || [...t.slice(1)].some((c) => !/[A-Za-z.\\]/.test(c));
}

class Converter {
  readonly errors: SyntaxError[] = [];
  private readonly lineStarts: number[] = [0];
  /** Ranges that are not code: heredoc bodies and their closing lines. */
  private readonly skip: (readonly [number, number])[] = [];

  constructor(private readonly text: string) {
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) this.lineStarts.push(i + 1);
  }

  // Nodes

  node(type: string, start: number, end: number, field: FieldName | null = null, parent?: Mut): Mut {
    const m: Mut = {
      type, named: true, text: '', startIndex: start, endIndex: end, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 },
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
    m.parent = parent;
    m.children.sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);
    m.namedChildren = m.children.filter((c) => c.named);
    m.text = this.text.slice(m.startIndex, m.endIndex);
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
    const script = parse(this.text);
    const root = this.node('program', 0, this.text.length);
    this.statements(root, script.commands, this.text.length);
    this.fill(root);
    this.unreadable(root, script);
    // The program starts at its first token: leading blanks are not part of it.
    root.startIndex = Math.min(...root.children.map((c) => c.startIndex), this.text.length);
    this.seal(root, null);
    this.errors.sort((x, y) => x.startIndex - y.startIndex || x.endIndex - y.endIndex);
    return { text: this.text, root, errors: this.errors };
  }

  /**
   * What unbash reports and the tree does not say yet. It drops a token it did not expect and records an
   * error at its start: that becomes an `error` node and an error of kind `unreadable` (the other errors,
   * of constructs left open, are marked `incomplete` where the construct is built). An error the tree
   * has not told by itself (`a >` has no target) becomes an error of kind `missing` at its place, and
   * the construct there is `incomplete`.
   */
  unreadable(root: Mut, script: U.ParsedScript): void {
    const errors: U.ParseError[] = [];
    // The errors of the script and of the scripts of the substitutions in it (a backquote with escapes
    // is parsed apart, by `decoded`, and its errors are in the text without the escapes).
    const walk = (n: U.SyntaxNode): void => {
      if (n.type === 'Script') {
        if (n !== script && (n as U.ParsedScript).source !== undefined) return;
        errors.push(...((n as U.ParsedScript).errors ?? []));
      }
      forEachChild(n, walk);
    };
    walk(script);
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
    this.errors.push({ kind: 'missing', message: `Missing "${what}"`, startIndex: at, endIndex: at });
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
    if (body.type === 'redirected_statement' && body.children[0]?.field !== 'body') {
      // `time >o`: nothing to time, only redirections, which belong to the statement.
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
    const isRedirect = (x: Item): x is U.Redirect | U.HereDoc => x.type === 'Redirect' || x.type === 'HereDoc';
    // Redirections after the last word are the statement's, not the command's; a here string stays in the command.
    let split = after.length;
    while (split > 0 && isRedirect(after[split - 1])) split--;
    let outside = after.splice(split) as U.Redirection[];
    if (!c.name) {
      // Assignments and redirections only.
      outside = before.filter((x): x is U.Redirection => x.type !== 'Assignment');
      const assigns = before.filter((x): x is U.Assignment => x.type === 'Assignment');
      let body: Mut | undefined;
      if (assigns.length === 1) body = this.assignment(assigns[0]);
      else if (assigns.length > 1) {
        body = this.node('variable_assignments', assigns[0].pos, assigns[assigns.length - 1].end);
        for (const a of assigns) this.add(body, this.assignment(a));
        this.fill(body);
      }
      if (!outside.length) return body!;
      const r = this.node('redirected_statement', body?.startIndex ?? c.pos, c.end);
      if (body) this.add(r, body, 'body');
      for (const x of outside) this.add(r, this.redirect(x), 'redirect');
      this.fill(r);
      return r;
    }
    const name = c.name.value;
    const args = [...before, ...after];
    let node: Mut;
    if (DECLARATIONS.has(name) && !before.length) node = this.declaration(c, after);
    else if (name === 'unset' && !before.length) node = this.unset(c, after);
    else if (name === '[' && !before.length) node = this.testCommand(c, after);
    else {
      const last = args.length ? args[args.length - 1] : c.name;
      node = this.node('command', c.pos, Math.max(last.end, c.name.end));
      for (const p of before) {
        if (p.type === 'Assignment') this.add(node, this.assignment(p));
        else this.add(node, this.redirect(p as U.Redirection), 'redirect');
      }
      const cn = this.node('command_name', c.name.pos, c.name.end, 'name', node);
      this.add(cn, this.word(c.name, 'name'));
      for (const s of after) this.item(node, s, (w) => this.add(node, this.word(w, 'argument'), 'argument'), 'argument');
      this.fill(node);
    }
    if (outside.length) return this.redirected(node, outside, c.end);
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

  declaration(c: U.Command, args: readonly (U.Assignment | U.Word | U.Redirection)[]): Mut {
    const node = this.node('declaration_command', c.pos, Math.max(c.name!.end, ...args.map((a) => a.end)));
    this.add(node, this.node(c.name!.value, c.name!.pos, c.name!.end), null).named = false;
    for (const a of args) {
      if (a.type === 'Assignment') this.add(node, this.assignment(a));
      else if (a.type === 'Word') this.add(node, IDENTIFIER.test(a.text) ? this.node('variable_name', a.pos, a.end) : this.word(a, 'declaration'));
      else this.add(node, this.redirect(a), 'redirect');
    }
    this.fill(node);
    return node;
  }

  unset(c: U.Command, args: readonly (U.Assignment | U.Word | U.Redirection)[]): Mut {
    const node = this.node('unset_command', c.pos, Math.max(c.name!.end, ...args.map((a) => a.end)));
    this.tok(c.name!.value, c.name!.pos, node);
    for (const a of args) this.item(node, a, (w) => this.add(node, IDENTIFIER.test(w.text) ? this.node('variable_name', w.pos, w.end) : this.word(w, 'declaration')), null);
    this.fill(node);
    return node;
  }

  testCommand(c: U.Command, args: readonly (U.Assignment | U.Word | U.Redirection)[]): Mut {
    const node = this.node('test_command', c.pos, Math.max(c.name!.end, ...args.map((a) => a.end)));
    this.tok('[', c.name!.pos, node);
    args.forEach((a, i) => {
      if (i === args.length - 1 && a.type === 'Word' && a.text === ']') this.tok(']', a.pos, node);
      else {
        const pattern = i > 0 && ['=', '==', '!='].includes((args[i - 1] as U.Word).text);
        this.item(node, a, (w) => this.addWord(node, w, pattern ? 'pattern' : 'flat', null), null);
      }
    });
    if (!node.children.some((x) => x.type === ']')) this.missing(node, ']', node.endIndex);
    this.fill(node);
    return node;
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
    } else if (a.value.text.startsWith('(') && a.value.parts === undefined) {
      // `a=(1 2` with no `)`: unbash gives the rest as one word.
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
   * index, `]` and `=z`, as tree-sitter reads it (there is no node for it in the model).
   */
  element(e: U.Word): Mut {
    const m = !e.parts ? /^\[([^\]\s]*)\](\+?=)/.exec(e.text) : null;
    if (!m) return this.word(e, 'element');
    const c = this.node('concatenation', e.pos, e.end);
    const at = e.pos + 1;
    this.node('word', e.pos, at, null, c);
    this.node(NUMBER.test(m[1]) ? 'number' : 'word', at, at + m[1].length, null, c);
    this.node('word', at + m[1].length, at + m[1].length + 1, null, c);
    this.node('word', at + m[1].length + 1, e.end, null, c);
    return c;
  }

  /** An assignment where the grammar has an ordinary word (`alias ll='ls -l'`). */
  assignmentAsWord(a: U.Assignment): Mut {
    if (a.value.type !== 'Word' || a.value.end <= a.value.pos) return this.node('word', a.pos, a.end);
    const w: U.Word = a.value.parts ? { ...a.value, parts: [{ type: 'Literal', pos: a.pos, end: a.value.pos, text: '', value: '' }, ...a.value.parts], pos: a.pos } : { ...a.value, pos: a.pos };
    return this.word(w, 'argument');
  }

  // Words

  /** The pieces of a word: runs of plain text, quoted strings and expansions, in order. */
  pieces(w: U.Word, role: string): Mut[] {
    const parts = w.parts;
    if (!parts) return [this.plain(w.pos, w.end, role)];
    const alone = parts.every((x) => !isPart(x));
    const out: Mut[] = [];
    let plainStart = -1;
    let plainEnd = -1;
    const flush = (): void => {
      if (plainStart >= 0) out.push(this.plain(plainStart, plainEnd, role, alone));
      plainStart = -1;
    };
    // Beside a range, a list `{a,b}` is a brace expression too; alone, it stays part of the word.
    const ranged = parts.some((x) => x.type === 'BraceExpansion' && BRACE_RANGE.test(x.text));
    for (const p of parts) {
      if (p.type === 'BraceExpansion' && (BRACE_RANGE.test(p.text) || (ranged && /^\{.*,.*\}$/s.test(p.text)))) {
        flush();
        out.push(BRACE_RANGE.test(p.text) ? this.braceRange(p) : this.braceList(p));
      } else if (!isPart(p)) {
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

  braceRange(p: U.BraceExpansionPart): Mut {
    const n = this.node('brace_expression', p.pos, p.end);
    this.tok('{', p.pos, n);
    const dots = p.text.indexOf('..');
    const second = p.text.indexOf('..', dots + 2);
    const num = (a: number, b: number): void => { this.node(NUMBER.test(this.text.slice(a, b)) ? 'number' : 'word', a, b, null, n); };
    num(p.pos + 1, p.pos + dots);
    this.tok('..', p.pos + dots, n);
    num(p.pos + dots + 2, second < 0 ? p.end - 1 : p.pos + second);
    if (second >= 0) {
      this.tok('..', p.pos + second, n);
      num(p.pos + second + 2, p.end - 1);
    }
    this.tok('}', p.end - 1, n);
    return n;
  }

  /** `{a,b}` next to a range: the items are words, between `,` tokens. */
  braceList(p: U.BraceExpansionPart): Mut {
    const n = this.node('brace_expression', p.pos, p.end);
    this.tok('{', p.pos, n);
    let start = p.pos + 1;
    let depth = 0;
    const item = (end: number): void => {
      if (end > start) this.node('word', start, end, null, n);
    };
    for (let i = p.pos + 1; i < p.end - 1; i++) {
      const c = this.text[i];
      if (c === '\\') i++;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === ',' && depth === 0) {
        item(i);
        this.tok(',', i, n);
        start = i + 1;
      }
    }
    item(p.end - 1);
    this.tok('}', p.end - 1, n);
    return n;
  }

  /** A word as the node that stands for it: a leaf, a quoted string, an expansion, or a concatenation of these. */
  word(w: U.Word, role: string): Mut {
    const pieces = this.pieces(w, role);
    if (pieces.length === 1) return pieces[0];
    const c = this.node('concatenation', w.pos, w.end);
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
        if (this.text.startsWith(close, p.end - close.length) && p.end - p.pos >= (bracket ? 3 : 5)) this.tok(close, p.end - close.length, n);
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
        default:
          this.tok(o.operator, o.pos, n, 'operator');
      }
    }
    // The brace is there when the text ends with it and no part has taken it (`${x#"a}`).
    if (this.text[p.end - 1] === '}' && p.end - p.pos > 2 && !n.children.some((c) => c.endIndex > p.end - 1)) this.tok('}', p.end - 1, n);
    else this.missing(n, '}', p.end);
    this.fill(n);
    return n;
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
    const open = p.type === 'ProcessSubstitution' ? p.operator + '(' : funsub ? (p.text[2] === '|' ? '${|' : '${') : p.text.startsWith('`') ? '`' : '$(';
    const type = p.type === 'CommandExpansion' ? 'command_substitution' : 'process_substitution';
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
    };
    holder.children.forEach((c) => { move(c); this.add(n, c); });
    for (const e of sub.errors) this.errors.push({ ...e, startIndex: moveStart(e.startIndex), endIndex: ends[e.endIndex] });
  }

  // Redirections

  redirect(r: U.Redirection): Mut {
    const type = r.type === 'HereDoc' ? 'heredoc_redirect' : r.type === 'HereString' ? 'herestring_redirect' : 'file_redirect';
    const n = this.node(type, r.pos, r.end);
    if (r.descriptor) {
      this.node('file_descriptor', r.descriptor.pos, r.descriptor.end, 'descriptor', n);
    }
    const opStart = r.descriptor ? r.descriptor.end : r.pos;
    this.tok(r.operator, opStart, n);
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
    this.list(n, c.clause, inner);
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
      this.list(en, e.clause, inner);
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
      if (it.terminator) {
        const kind: FieldName | null = it === c.items[c.items.length - 1] ? null : it.terminator === ';;' ? 'termination' : 'fallthrough';
        this.tok(it.terminator, it.end - it.terminator.length, m, kind);
      }
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
    this.close(n, this.closed(c, '))'), '))', this.text.length);
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
        else this.arithInto(n, e, 'for', field);
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
    this.add(n, this.arith(e.left, 'for'), 'name').type = 'variable_name';
    this.tokenIn('=', e.left.end, e.end, n);
    this.add(n, this.arith(e.right, 'for'), 'value');
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

  /** An arithmetic expression; `ctx` says where it is: a `for ((…))` header names plain words; a `${a:1:2}` slice has no fields. */
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
      case 'ArithmeticWord': return this.arithWord(e, ctx);
    }
  }

  arithWord(e: U.ArithmeticWord, ctx: ArithCtx): Mut {
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
    if (NUMBER.test(t) || /^(0[xX][0-9a-fA-F]+|\d+#[0-9a-zA-Z@_]+)$/.test(t)) return this.node('number', e.pos, e.end);
    return this.node(IDENTIFIER.test(t) && ctx !== 'for' ? 'variable_name' : 'word', e.pos, e.end);
  }
}

/** The unbash adapter's parser. */
// (The declaration shows as a branch that never runs: it is the getter tsx makes for the export.)
/* c8 ignore next */
export function createUnbashParser(): BashParser {
  return {
    parse(text: string): SyntaxTree {
      return new Converter(text).run();
    },
  };
}
