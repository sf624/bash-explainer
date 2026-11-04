// The context of the explanation of one line (docs/design/analyzer.md, 2.2): what the explanation of each part reads
// (the language, the models of the script, the options), the walk over the line's nodes with its line filter, and the
// one place where the line's notes, facts and examples are collected. src/analyzer.ts makes one per line.
import type { ContextEntry, Example, ExplainOptions, Kind, LineExplanation, NoteAnchor, Span, Token } from '../analyzer-types';
import type { ArgvParse } from '../argv/interpret';
import { type BashVersion, DEFAULT_BASH_VERSION } from '../bashversion';
import type { CommandSpec } from '../argv/spec';
import type { Shell } from '../dialect';
import { type Lang, lineRangeLabel, type Text } from '../i18n';
import { shorten } from '../label';
import { type Fact, type Note, said, warningOf } from '../messages';
import { READ_FAULTS } from '../messages-levels';
import { alwaysFails } from '../levels';
import { tokenSaid, type TokenTextArgs, type TokenTextId } from '../messages-tokens';
import { anchored, type Found, sameSpan, spanOf } from '../noteanchors';
import type { ExecEnv } from '../semantics/env';
import type { NestedScript } from '../semantics/nested';
import { hostReadAs, reachedAt, readAs, type ReadKnown } from '../semantics/scriptstops';
import { docLine, type StateModel } from '../semantics/state';
import type { StatusModel } from '../semantics/status';
import { listOverLines, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
import { isBased, type RestingText, type TokenBasisId } from '../tokenbases';
import { effEndRow, intersects, isBlockLike } from './nodes';
import { pushAll } from '../lists';

/**
 * The command whose arguments are being explained (`Explainer.command`): its name, its words, and their parse
 * (`nodes` are the words the parse's indices count, of which `args` are this command's), which the explanations of
 * embedded languages read; and whether the shell reads the words again (`rereads`, `eval`: set by the rendering of
 * the words, while it reads them).
 */
export interface CommandContext { cmd: string; args: SyntaxNode[]; parse: ArgvParse; nodes: SyntaxNode[]; spec: CommandSpec; rereads?: boolean }

/** A key of a memo kept for one line (`Explainer.memo`); the code that reads the memo makes its key. */
export interface MemoKey<V> { readonly name: string; readonly value?: V }
export const memoKey = <V>(name: string): MemoKey<V> => ({ name });

/**
 * The walk over the nodes, which the line filter of the context calls back (the dispatch, src/explain/dispatch.ts),
 * and the explanation of a line of a string read as a script (src/analyzer.ts gives both).
 */
export interface Walk {
  /** The explanation of a node. */
  explain(n: SyntaxNode): Token;
  /** The parts of a block that are on the line explained. */
  flatten(n: SyntaxNode): Token[];
  /** Line `line` of the script `tree`, explained as src/analyzer.ts explains a script, as a string of kind `kind`. */
  nestedLine(tree: SyntaxTree, line: number, shell: Shell | undefined, kind: NestedScript['kind'], opts: ExplainOptions): LineExplanation;
  /** What `explained` makes of `n`, a statement over several lines, once for the document (src/explain/whole.ts). */
  whole(n: SyntaxNode, explained: (cx: Explainer) => Token): Whole;
}

/**
 * What the explanation of one statement over several lines made, kept for the document: each of its later lines reads this, and does not
 * walk the statement again (src/explain/whole.ts). The token and those under it are finished, and frozen.
 */
export interface Whole {
  readonly token: Token;
  /** What the line says of the token (`summaryOf`), from before `dropLabelEcho`. */
  readonly summary: string;
  /** The notes, facts, anchors, examples and resting texts the walk collected, as `LineOutput` has them. */
  readonly notes: readonly string[];
  readonly facts: readonly Fact[];
  readonly anchors: readonly NoteAnchor[];
  readonly examples: readonly Example[];
  readonly rested: readonly RestingText[];
  /** The data of its notes, by their text. */
  readonly data: ReadonlyMap<string, Note>;
  /** Its notes each once, and what a line of nothing else says with them: their data, its facts, the anchors of its notes. */
  readonly saidNotes: readonly string[];
  readonly noteInfo: readonly Note[];
  readonly saidFacts: readonly Fact[];
  readonly saidAnchors: readonly NoteAnchor[];
  /** Every text it says or could say: a line that says one of them too is worked out in full (`Analyzer.explained`). */
  readonly texts: ReadonlySet<string>;
  /** What each simple command of the statement is (`COMMAND_SAID`). */
  readonly commands: ReadonlyMap<SyntaxNode, unknown>;
  /** What only a line that asks for it reads, made once: its examples (with a title that names their command, or not), its sentences (`SentenceInput.kept`), its reading tree. */
  readonly later: { examples: [Example[]?, Example[]?]; sentences: Map<string, unknown>; reading?: LineExplanation['reading'] };
}

/** What the explanation of a part of a line reads, and the only way it adds to what the line collects. */
export interface Explainer {
  readonly lang: Lang;
  s(ja: string, en: string): string;
  /** A text in the line's language; one that states bash's behaviour (`based`, src/tokenbases.ts) is recorded as `rests` records it. */
  t(text: Text): string;
  /**
   * `text`, which states what the entry `id` of src/tokenbases.ts says: recorded for the line, so that the tokens that
   * show it get its basis and try-it (`withTokenBases`, docs/design/basis.md, step 4).
   */
  rests(text: string, id: TokenBasisId): string;
  /**
   * A text of the catalog of token texts (src/messages-tokens.ts), which carries its id with it, so that the tokens that show it
   * have the id and, for one that warns, its level (`markSaid`, src/tokenmarks.ts).
   */
  text<K extends TokenTextId>(id: K, ...params: TokenTextArgs<K>): string;
  /** What ends a sentence before another in the same text: `。`, or `. `. */
  sep(): string;
  /** What stands between the items of a list inside a text: `、`, or `, `. */
  comma(): string;
  tok(n: SyntaxNode, kind: Kind, explanation: string, children?: Token[], label?: string): Token;
  /**
   * The lines a construct over several lines covers (` (lines 3–5)`), from `n` to the end of `to`; for one line, empty,
   * or ` (line 3)` with `one` (the end line of an empty here-document).
   */
  lineRef(n: SyntaxNode, to?: SyntaxNode, one?: boolean): string;

  /** The shell state along the script (src/semantics/state.ts). */
  readonly state: StateModel;
  /** Exit statuses and errexit (src/semantics/status.ts). */
  readonly status: StatusModel;
  /** The shell the script is for (undefined: bash). */
  readonly shell: Shell | undefined;
  readonly opts: ExplainOptions;
  /** The bash release the explanation follows (`bashExplainer.bashVersion`). */
  readonly bashVersion: BashVersion;
  /** The whole text being explained (for hints such as how yq was installed). */
  readonly source: string;
  readonly root: SyntaxNode;
  readonly tree: SyntaxTree;
  /** The kind of string explained, when the line is in a string read as a script (src/semantics/nested.ts). */
  readonly nested: NestedScript['kind'] | undefined;

  /** The line explained, or null while a construct is explained whole; only `full` changes it. */
  readonly line: number | null;
  /** Whether `n` is on the line explained (always, while a construct is explained whole). */
  onLine(n: SyntaxNode): boolean;
  /** The explanation of a node, not checked against the line filter (its parts are): the dispatch (src/explain/dispatch.ts). */
  explain(n: SyntaxNode): Token;
  /** Explain a child node, respecting the current line filter. */
  sub(n: SyntaxNode | null | undefined): Token[];
  /**
   * The token `explained` makes of `n`, kept for the document (`Whole`): frozen, and an item of the line (`flatten` asks, for one over
   * several lines, past the start of all that holds it). The line adds what it collected to its own.
   */
  whole(n: SyntaxNode, explained: (cx: Explainer) => Token): Token;
  subs(nodes: readonly (SyntaxNode | null | undefined)[]): Token[];
  /** Explain a node ignoring the line filter. */
  full(n: SyntaxNode): Token;
  /**
   * Line `line` of a string read as a script (src/explain/scripts.ts), explained as a script of its own: with its
   * tree, its shell and its kind (`nested`), and the options of this line, but no reading tree.
   */
  nestedLine(script: NestedScript, line: number, positional?: ExplainOptions['positional'], outer?: Pick<ExplainOptions, 'unread' | 'unsure' | 'unreached'>): LineExplanation;

  /**
   * A fact's note: its text, recorded with its id and sections for `LineExplanation.facts`, and with the node or nodes
   * it is about (`at`; none: the line) for `LineExplanation.anchors`, which give each token the facts about it
   * (`Token.facts`). The `notes.pitfalls` setting is applied by `said` (src/messages.ts), the one rule: a pitfall (by
   * its catalog entry) is not said when the pitfalls are off. Every note of a line is a fact of the catalog, or a
   * problem with a code of its own (a style check, a dialect issue: src/messages.ts, `styleNote`, `problemNote`).
   */
  say(f: Fact, at?: SyntaxNode | readonly SyntaxNode[]): string[];
  /** Adds a fact's note to the line's (as `say` says it), about the node or nodes `at`. */
  note(f: Fact, at?: SyntaxNode | readonly SyntaxNode[]): void;
  /**
   * How a fault in the shell's reading of the text at `n` is said (`readAs`, src/semantics/scriptstops.ts): an error, a warning with
   * the same words, or none. A host's code is the shell's whole input, so it is a script (`hostReadAs`). None for a string run by a
   * command the script does not surely read.
   */
  evidenceAt(n: SyntaxNode): ReadKnown | undefined;
  /** Whether the shell gets to the text at `n` (`reachedAt`): not after a sure stop, nor in a string run by a command it does not get to. */
  reachedAt(n: SyntaxNode): boolean;
  /** A note about a range of the line (a token's): its text, recorded with its data and its place. */
  sayAt(n: Note & { code: string }, span: Span): string;
  /** Records a construct around the line (`LineExplanation.context`), outermost first. */
  enclosing(entry: ContextEntry): void;
  /** Adds a worked example to the line's. */
  example(e: Example): void;
  /**
   * The examples added inside `f` belong to the command `n` (inner commands tag theirs first): its text names them,
   * and they are attached to it, or to its words (`words`, when redirections come before them).
   */
  examplesOf<T>(n: SyntaxNode, f: () => T, words?: { span: Span; text: string }): T;
  /** The examples added inside `f` are attached to `n`, unless a more specific node already took them. */
  examplesAt<T>(n: SyntaxNode, f: () => T): T;
  /**
   * The examples added inside `f` give way to the example `whole` gives, if it gives one (a pipeline's), but for those
   * `keeps` keeps, which stay before it.
   */
  examplesReplaced<T>(f: () => T, whole: () => Example | undefined, keeps: (e: Example) => boolean): T;
  /**
   * The examples the words read inside `f` add themselves are dropped (read with a spec that may not be the program's:
   * `hash -p`), those `drops` says from what `f` gives; those of the commands inside them, which those commands have
   * claimed (`examplesOf`), stay.
   */
  examplesDropped<T>(f: () => T, drops: (value: T, e: Example) => boolean): T;
  /** The notes, facts and examples of a line of a string read as a script join this line's; `span` maps its places to the source. */
  adopt(ex: LineExplanation, span: (s: Span) => Span): void;

  /** The command whose words are explained, set only for the time of `withCommand`. */
  readonly command: CommandContext | undefined;
  withCommand<T>(c: CommandContext, f: () => T): T;

  /** Where the commands run by command slots run (src/semantics/env.ts), keyed by their first word or string. */
  readonly slotEnvs: Map<SyntaxNode, ExecEnv>;
  /** A memo kept for this line only, by key. */
  memo<V>(key: MemoKey<V>): Map<SyntaxNode, V>;
}

/** What the line collected, which src/analyzer.ts assembles into the `LineExplanation`. */
export interface LineOutput {
  /** The notes produced while explaining (e.g. the effect of several redirections). */
  readonly notes: readonly string[];
  /** The facts of the message catalog said on this line (src/messages.ts), as `say` records them. */
  readonly facts: readonly Fact[];
  /** The nodes the notes of this line are about (`LineExplanation.anchors`). */
  readonly anchors: readonly NoteAnchor[];
  /** Worked examples produced while explaining (grep, sed, awk, jq). */
  readonly examples: readonly Example[];
  /** The texts said on this line that state bash's behaviour, with what they rest on (`rests`). */
  readonly rested: readonly RestingText[];
  /** Enclosing constructs, outermost first. */
  readonly context: ContextEntry[];
  /** The texts of notes found on nodes, each once; each is recorded in the anchors (see `anchored`), with its data. */
  anchored(found: readonly Found[]): string[];
  /** The data of a note of this line, by its text (`LineExplanation.noteInfo`). */
  noteOf(text: string): Note;
  /** Ends the line: what is explained after it is explained whole. */
  end(): void;
  /** The statements of the line that were explained once for the document, in the order of the walk. */
  readonly wholes: readonly Whole[];
}

/** The models and options a line is explained with. */
export interface LineInit {
  readonly state: StateModel;
  readonly status: StatusModel;
  readonly shell: Shell | undefined;
  readonly opts: ExplainOptions;
  readonly root: SyntaxNode;
  readonly tree: SyntaxTree;
  /** The tree's whole text, which node offsets index (the root's own text starts at its first statement). */
  readonly source: string;
  readonly line: number;
  readonly nested: NestedScript['kind'] | undefined;
}

/**
 * The context of one line. The line filter and the collected lists are on this one object, which is never copied:
 * `full` sets the filter and restores it, for every part that reads it.
 */
export class LineExplainer implements Explainer, LineOutput {
  readonly state: StateModel;
  readonly status: StatusModel;
  readonly shell: Shell | undefined;
  readonly opts: ExplainOptions;
  readonly source: string;
  readonly root: SyntaxNode;
  readonly tree: SyntaxTree;
  readonly nested: NestedScript['kind'] | undefined;
  readonly notes: string[] = [];
  readonly facts: Fact[] = [];
  readonly anchors: NoteAnchor[] = [];
  /** The data of the notes said on this line, by their text. */
  readonly data = new Map<string, Note>();
  readonly examples: Example[] = [];
  readonly rested: RestingText[] = [];
  readonly context: ContextEntry[] = [];
  readonly slotEnvs = new Map<SyntaxNode, ExecEnv>();
  command: CommandContext | undefined = undefined;
  private current: number | null;
  private readonly memos = new Map<MemoKey<unknown>, Map<SyntaxNode, unknown>>();
  readonly wholes: Whole[] = [];
  /** How many nodes the walk is explaining now: at none, it is making the items of the line. */
  private explaining = 0;

  /** The bash release the explanation follows (`bashExplainer.bashVersion`). */
  get bashVersion(): BashVersion {
    return this.opts.bashVersion ?? DEFAULT_BASH_VERSION;
  }

  constructor(readonly lang: Lang, init: LineInit, private readonly walk: Walk) {
    this.state = init.state;
    this.status = init.status;
    this.shell = init.shell;
    this.opts = init.opts;
    this.root = init.root;
    this.tree = init.tree;
    this.source = init.source;
    this.current = init.line;
    this.nested = init.nested;
  }

  s(ja: string, en: string): string {
    return this.lang === 'ja' ? ja : en;
  }

  t(text: Text): string {
    return isBased(text) ? this.rests(text[this.lang], text.basis) : text[this.lang];
  }

  rests(text: string, id: TokenBasisId): string {
    this.rested.push({ text, id });
    return text;
  }
  text<K extends TokenTextId>(id: K, ...params: TokenTextArgs<K>): string {
    return tokenSaid(this.lang, id, ...params);
  }
  sep(): string {
    return this.s('。', '. ');
  }
  comma(): string {
    return this.s('、', ', ');
  }

  tok(n: SyntaxNode, kind: Kind, explanation: string, children: Token[] = [], label = shorten(n.text)): Token {
    return { kind, label, explanation, span: spanOf(n), children };
  }

  lineRef(n: SyntaxNode, to = n, one = false): string {
    const a = docLine(n) + 1;
    const b = a + effEndRow(to) - n.startPosition.row;
    // (Also a here-document that is not ended: its body starts after the end of the script.)
    if (a > b || (a === b && !one)) return '';
    return this.s(`（${lineRangeLabel('ja', a, b)}）`, ` (${lineRangeLabel('en', a, b)})`);
  }

  get line(): number | null {
    return this.current;
  }

  onLine(n: SyntaxNode): boolean {
    return this.current === null || intersects(n, this.current);
  }

  explain(n: SyntaxNode): Token {
    this.explaining++;
    try {
      return this.walk.explain(n);
    } finally {
      this.explaining--;
    }
  }

  sub(n: SyntaxNode | null | undefined): Token[] {
    if (!n) return [];
    if (this.current === null) return [this.walk.explain(n)];
    if (!intersects(n, this.current)) return [];
    const first = n.startPosition.row === this.current;
    if (isBlockLike(n)) {
      // (A list over several lines of a body has no line of its own: each line explains its part, `{ a⏎ b & }`.)
      return first && !(n.type === 'command_list' && listOverLines(n)) ? [this.explain(n)] : this.walk.flatten(n);
    }
    // A multi-line statement that is not a block (`\` continuation, heredoc…) is explained whole, by each of its lines. They read one
    // explanation: a walk for each line would make a script's cost the square of its size. Only where it is an item of the line (a token of a
    // block on its first line may be changed by that block, and those of a string read as a script are placed in its word), or it is explained here.
    return [first && (this.explaining || this.nested || n.endPosition.row === n.startPosition.row) ? this.full(n) : this.whole(n, (cx) => cx.full(n))];
  }

  whole(n: SyntaxNode, explained: (cx: Explainer) => Token): Token {
    const w = this.walk.whole(n, explained);
    this.wholes.push(w);
    pushAll(this.notes, w.notes);
    pushAll(this.facts, w.facts);
    pushAll(this.anchors, w.anchors);
    pushAll(this.examples, w.examples);
    pushAll(this.rested, w.rested);
    return w.token;
  }

  subs(nodes: readonly (SyntaxNode | null | undefined)[]): Token[] {
    return nodes.flatMap((n) => this.sub(n));
  }

  full(n: SyntaxNode): Token {
    const saved = this.current;
    this.current = null;
    try {
      return this.walk.explain(n);
    } finally {
      this.current = saved;
    }
  }

  nestedLine(script: NestedScript, line: number, positional?: ExplainOptions['positional'], outer: Pick<ExplainOptions, 'unread' | 'unsure' | 'unreached'> = {}): LineExplanation {
    // (The positional parameters are those of this string's shell: a string in it has its own, or none.)
    return this.walk.nestedLine(script.tree, line, script.shell, script.kind, { ...this.opts, argv: false, positional, ...outer });
  }

  end(): void {
    this.current = null;
  }

  evidenceAt(n: SyntaxNode): ReadKnown | undefined {
    if (this.opts.unread) return undefined;
    const known = this.opts.host ? hostReadAs(this.tree, n.startIndex, this.opts.stopsFrom) : readAs(this.tree, n.startIndex, this.opts.script, this.state);
    return known && this.opts.unsure ? 'unsure' : known;
  }

  reachedAt(n: SyntaxNode): boolean {
    return !this.opts.unreached && reachedAt(this.tree, n.startIndex, this.opts.stopsFrom, this.opts.host ? undefined : this.state);
  }

  say(f: Fact, at?: SyntaxNode | readonly SyntaxNode[]): string[] {
    const nodes: readonly (SyntaxNode | undefined)[] = !at ? [undefined] : 'type' in at ? [at] : at;
    // (An error says the shell fails on the text: only where it may get there, and a reading of the text at the level of what is known of it.)
    const fails = alwaysFails(f.level) && nodes[0];
    const known = fails && READ_FAULTS.has(f.id) ? this.evidenceAt(nodes[0]!) : fails && !this.reachedAt(nodes[0]!) ? undefined : 'known';
    if (!known) return [];
    const out = said([known === 'unsure' ? warningOf(this.lang, f) : f], this.opts.pitfalls);
    pushAll(this.facts, out);
    return anchored(out.flatMap((x) => nodes.map((node) => ({ ...x, ...(node ? { node } : {}) }))), this.anchors, this.data);
  }

  note(f: Fact, at?: SyntaxNode | readonly SyntaxNode[]): void {
    pushAll(this.notes, this.say(f, at));
  }

  sayAt(n: Note & { code: string }, span: Span): string {
    this.data.set(n.text, n);
    // (A token of a string read as a script: `adopt` already has its place.)
    if (!this.anchors.some((a) => a.text === n.text && sameSpan(a.span, span))) this.anchors.push({ text: n.text, span, code: n.code });
    return n.text;
  }

  anchored(found: readonly Found[]): string[] {
    return anchored(found, this.anchors, this.data);
  }

  noteOf(text: string): Note {
    // (Every note said on a line has its data: a fact's, or a problem's of its own kind. A statement explained once has its own.)
    for (const w of this.wholes) {
      const known = w.data.get(text);
      if (known) return known;
    }
    return this.data.get(text)!;
  }

  enclosing(entry: ContextEntry): void {
    this.context.push(entry);
  }

  example(e: Example): void {
    this.examples.push(e);
  }

  examplesOf<T>(n: SyntaxNode, f: () => T, words?: { span: Span; text: string }): T {
    const before = this.examples.length;
    const value = f();
    const target = shorten((words?.text ?? n.text).replace(/\s*\\\n\s*/g, ' '), 40);
    for (const e of this.examples.slice(before)) e.target ??= target;
    if (words) for (const e of this.examples.slice(before)) e.anchor ??= words.span;
    else this.anchorSince(before, n);
    return value;
  }

  examplesAt<T>(n: SyntaxNode, f: () => T): T {
    const before = this.examples.length;
    const value = f();
    this.anchorSince(before, n);
    return value;
  }

  examplesReplaced<T>(f: () => T, whole: () => Example | undefined, keeps: (e: Example) => boolean): T {
    const before = this.examples.length;
    const value = f();
    const one = whole();
    if (one) {
      const kept = this.examples.slice(before).filter(keeps);
      this.examples.length = before;
      pushAll(this.examples, kept);
      this.examples.push(one);
    }
    return value;
  }

  examplesDropped<T>(f: () => T, drops: (value: T, e: Example) => boolean): T {
    const before = this.examples.length;
    const value = f();
    const kept = this.examples.slice(before).filter((e) => e.target !== undefined || !drops(value, e));
    this.examples.length = before;
    pushAll(this.examples, kept);
    return value;
  }

  adopt(ex: LineExplanation, span: (s: Span) => Span): void {
    pushAll(this.notes, ex.notes);
    pushAll(this.facts, (ex.facts ?? []));
    for (const n of ex.noteInfo) this.data.set(n.text, n);
    pushAll(this.anchors, (ex.anchors ?? []).map((a) => ({ ...a, span: span(a.span) })));
    // (Every example of a line is anchored at its command: `examplesOf`.)
    for (const e of ex.examples) this.examples.push({ ...e, anchor: span(e.anchor!) });
  }

  withCommand<T>(c: CommandContext, f: () => T): T {
    const saved = this.command;
    this.command = c;
    try {
      return f();
    } finally {
      this.command = saved;
    }
  }

  memo<V>(key: MemoKey<V>): Map<SyntaxNode, V> {
    let m = this.memos.get(key);
    if (!m) this.memos.set(key, (m = new Map()));
    return m as Map<SyntaxNode, V>;
  }

  /** Attaches the examples added since `before` to `n`, unless a more specific node already took them. */
  private anchorSince(before: number, n: SyntaxNode): void {
    for (const e of this.examples.slice(before)) e.anchor ??= spanOf(n);
  }
}
