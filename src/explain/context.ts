// The context of the explanation of one line (docs/design/analyzer.md, 2.2): what the explanation of each part reads
// (the language, the models of the script, the options), the walk over the line's nodes with its line filter, and the
// one place where the line's notes, facts and examples are collected. src/analyzer.ts makes one per line.
import type { ContextEntry, Example, ExplainOptions, Kind, LineExplanation, NoteAnchor, Span, Token } from '../analyzer-types';
import type { ArgvParse } from '../argv/interpret';
import type { CommandSpec } from '../argv/spec';
import type { Shell } from '../dialect';
import type { Lang, Text } from '../i18n';
import { shorten } from '../label';
import { type Fact, said } from '../messages';
import { anchored, type Placed, spanOf } from '../noteanchors';
import type { ExecEnv } from '../semantics/env';
import type { NestedScript } from '../semantics/nested';
import { docLine, type StateModel } from '../semantics/state';
import type { StatusModel } from '../semantics/status';
import type { SyntaxNode, SyntaxTree } from '../syntax/tree';
import { effEndRow, intersects, isBlockLike } from './nodes';

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
 * The walk over the nodes, which the line filter of the context calls back (the dispatch), and the explanation of a
 * line of a string read as a script.
 */
export interface Walk {
  /** The explanation of a node. */
  explain(n: SyntaxNode): Token;
  /** The parts of a block that are on the line explained. */
  flatten(n: SyntaxNode): Token[];
  /** Line `line` of the script `tree`, explained as src/analyzer.ts explains a script, as a string of kind `kind`. */
  nestedLine(tree: SyntaxTree, line: number, shell: Shell | undefined, kind: NestedScript['kind'], opts: ExplainOptions): LineExplanation;
}

/** What the explanation of a part of a line reads, and the only way it adds to what the line collects. */
export interface Explainer {
  readonly lang: Lang;
  s(ja: string, en: string): string;
  t(text: Text): string;
  tok(n: SyntaxNode, kind: Kind, explanation: string, children?: Token[], label?: string): Token;
  /** The lines a construct over several lines covers (` (lines 3–5)`); empty for one line. */
  lineRef(n: SyntaxNode): string;

  /** The shell state along the script (src/semantics/state.ts). */
  readonly state: StateModel;
  /** Exit statuses and errexit (src/semantics/status.ts). */
  readonly status: StatusModel;
  /** The shell the script is for (undefined: bash). */
  readonly shell: Shell | undefined;
  readonly opts: ExplainOptions;
  /** The whole text being explained (for hints such as how yq was installed). */
  readonly source: string;
  readonly root: SyntaxNode;
  /** The kind of string explained, when the line is in a string read as a script (src/semantics/nested.ts). */
  readonly nested: NestedScript['kind'] | undefined;

  /** The line explained, or null while a construct is explained whole; only `full` changes it. */
  readonly line: number | null;
  /** Whether `n` is on the line explained (always, while a construct is explained whole). */
  onLine(n: SyntaxNode): boolean;
  /** The explanation of a node, not checked against the line filter (its parts are): the dispatch of src/analyzer.ts. */
  explain(n: SyntaxNode): Token;
  /** Explain a child node, respecting the current line filter. */
  sub(n: SyntaxNode | null | undefined): Token[];
  subs(nodes: readonly (SyntaxNode | null | undefined)[]): Token[];
  /** Explain a node ignoring the line filter. */
  full(n: SyntaxNode): Token;
  /**
   * Line `line` of a string read as a script (src/explain/scripts.ts), explained as a script of its own: with its
   * tree, its shell and its kind (`nested`), and the options of this line, but no reading tree.
   */
  nestedLine(script: NestedScript, line: number, positional?: ExplainOptions['positional']): LineExplanation;

  /**
   * A fact's note: its text, recorded with its id and sections for `LineExplanation.facts`, and with the node it is
   * about (`at`) for `LineExplanation.anchors`. The `notes.pitfalls` setting is applied by `said` (src/messages.ts),
   * the one rule: a pitfall (by its catalog entry) is not said when the pitfalls are off.
   */
  say(f: Fact, at: SyntaxNode): string[];
  /** Adds a fact's note to the line's (as `say` says it), about the node `at`. */
  note(f: Fact, at: SyntaxNode): void;
  /** Adds a note to the line's, about the node or nodes `at`. */
  note(text: string, at: SyntaxNode | readonly SyntaxNode[]): void;
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
  /** The examples added inside `f` and `whole` give way to the example `whole` gives, if it gives one (a pipeline's). */
  examplesReplaced<T>(f: () => T, whole: () => Example | undefined): T;
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
  /** Enclosing constructs, outermost first. */
  readonly context: ContextEntry[];
  /** The texts of notes found on nodes, each once; each is recorded in the anchors (see `anchored`). */
  anchored(found: readonly { text: string; node?: Placed }[]): string[];
  /** Ends the line: what is explained after it is explained whole. */
  end(): void;
}

/** The models and options a line is explained with. */
export interface LineInit {
  readonly state: StateModel;
  readonly status: StatusModel;
  readonly shell: Shell | undefined;
  readonly opts: ExplainOptions;
  readonly root: SyntaxNode;
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
  readonly nested: NestedScript['kind'] | undefined;
  readonly notes: string[] = [];
  readonly facts: Fact[] = [];
  readonly anchors: NoteAnchor[] = [];
  readonly examples: Example[] = [];
  readonly context: ContextEntry[] = [];
  readonly slotEnvs = new Map<SyntaxNode, ExecEnv>();
  command: CommandContext | undefined = undefined;
  private current: number | null;
  private readonly memos = new Map<MemoKey<unknown>, Map<SyntaxNode, unknown>>();

  constructor(readonly lang: Lang, init: LineInit, private readonly walk: Walk) {
    this.state = init.state;
    this.status = init.status;
    this.shell = init.shell;
    this.opts = init.opts;
    this.root = init.root;
    this.source = init.root.text;
    this.current = init.line;
    this.nested = init.nested;
  }

  s(ja: string, en: string): string {
    return this.lang === 'ja' ? ja : en;
  }

  t(text: Text): string {
    return text[this.lang];
  }

  tok(n: SyntaxNode, kind: Kind, explanation: string, children: Token[] = [], label = shorten(n.text)): Token {
    return { kind, label, explanation, span: spanOf(n), children };
  }

  lineRef(n: SyntaxNode): string {
    const a = docLine(n) + 1;
    const b = a + effEndRow(n) - n.startPosition.row;
    if (a === b) return '';
    return this.s(`（行 ${a}〜${b}）`, ` (lines ${a}–${b})`);
  }

  get line(): number | null {
    return this.current;
  }

  onLine(n: SyntaxNode): boolean {
    return this.current === null || intersects(n, this.current);
  }

  explain(n: SyntaxNode): Token {
    return this.walk.explain(n);
  }

  sub(n: SyntaxNode | null | undefined): Token[] {
    if (!n) return [];
    if (this.current === null) return [this.walk.explain(n)];
    if (!intersects(n, this.current)) return [];
    if (isBlockLike(n)) {
      return n.startPosition.row === this.current ? [this.walk.explain(n)] : this.walk.flatten(n);
    }
    // A multi-line statement that is not a block (`\` continuation, heredoc…) is explained whole.
    return [this.full(n)];
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

  nestedLine(script: NestedScript, line: number, positional?: ExplainOptions['positional']): LineExplanation {
    // (The positional parameters are those of this string's shell: a string in it has its own, or none.)
    return this.walk.nestedLine(script.tree, line, script.shell, script.kind, { ...this.opts, reading: false, positional });
  }

  end(): void {
    this.current = null;
  }

  say(f: Fact, at: SyntaxNode): string[] {
    const out = said([f], this.opts.pitfalls);
    this.facts.push(...out);
    return anchored(out.map((x) => ({ text: x.text, node: at })), this.anchors);
  }

  note(f: Fact, at: SyntaxNode): void;
  note(text: string, at: SyntaxNode | readonly SyntaxNode[]): void;
  note(what: Fact | string, at: SyntaxNode | readonly SyntaxNode[]): void {
    if (typeof what !== 'string') {
      this.notes.push(...this.say(what, at as SyntaxNode));
      return;
    }
    const nodes = 'type' in at ? [at] : at;
    this.notes.push(...anchored(nodes.map((node) => ({ text: what, node })), this.anchors));
  }

  anchored(found: readonly { text: string; node?: Placed }[]): string[] {
    return anchored(found, this.anchors);
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

  examplesReplaced<T>(f: () => T, whole: () => Example | undefined): T {
    const before = this.examples.length;
    const value = f();
    const one = whole();
    if (one) {
      this.examples.length = before;
      this.examples.push(one);
    }
    return value;
  }

  adopt(ex: LineExplanation, span: (s: Span) => Span): void {
    this.notes.push(...ex.notes);
    this.facts.push(...(ex.facts ?? []));
    this.anchors.push(...(ex.anchors ?? []).map((a) => ({ ...a, span: span(a.span) })));
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
