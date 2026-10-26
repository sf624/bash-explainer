// The explanation of a script, one line at a time (docs/design/analyzer.md): `Analyzer.explainLine` builds the line's
// context (src/explain/context.ts) from the models of the script, walks the line's nodes (src/explain/dispatch.ts),
// gathers the notes (the dialect, idioms, pitfalls and the notes on the line as a whole) and the examples, and
// returns the `LineExplanation`. What each part of bash means is explained by its module in src/explain/.
import { Lang } from './i18n';
import { idiomsFound } from './idioms';
import { pitfallFindings } from './pitfalls';
import { wordFindings } from './wordfacts';
import type { SyntaxNode, SyntaxTree } from './syntax/tree';
import { lookupCommand } from './dict/aliases';
import { plainNote } from './messages';
import { pictureNote } from './ctlchars';
import { dialectFound, Shell } from './dialect';
import { docLine, documentRoot, shellState, type StateModel } from './semantics/state';
import { wordMeaning } from './semantics/words';
import { parseExpansion } from './expansion';
import { varDesc } from './explain/words';
import type { NestedScript } from './semantics/nested';
import { statusModel } from './semantics/status';

export { EXAMPLE_KINDS } from './analyzer-types';
export type { ContextEntry, Example, ExampleKind, ExampleSection, ExplainOptions, Kind, LineExplanation, Pos, ScriptProcess, Span, Token, TokenOrigin } from './analyzer-types';
import type { ExplainOptions, LineExplanation, Span, Token } from './analyzer-types';
import { argvLine, condLine } from './argvline';
import { lineSummary } from './linesummary';
import { readingTree } from './reading';
import { claim, dropLabelEcho } from './tokenmarks';
import { LineExplainer, type Walk } from './explain/context';
import { intersects, isBlockLike, onLine, summaryOf } from './explain/nodes';
import { resolve } from './explain/reads';
import { titledExamples, wantsExample } from './explain/examples';
import { explain, flatten } from './explain/dispatch';
import { continuationNotes, extglobPitfalls, pipeSubshellPitfalls, statusNotes, unmatchedGlobPitfalls } from './explain/line-notes';

export { isBlockLike, summaryOf };

/**
 * (Prototype B) Where the value of a parameter expansion comes from, for the first step of the panel: what the
 * variable is when it is a well-known one (`$USER`: the user name), else the line of the script that last set it,
 * when the model trusts that it is set there (`backup=…` on line 1).
 */
function variableFrom(cx: LineExplainer, state: StateModel, part: SyntaxNode): { meaning?: string; line?: number; loop?: boolean } | undefined {
  const name = part.type === 'simple_expansion' ? part.text.slice(1) : parseExpansion(part.text)?.name;
  if (!name) return undefined;
  const meaning = varDesc(cx, name, part);
  if (meaning) return { meaning };
  if (!/^[A-Za-z_]\w*$/.test(name)) return undefined;
  const v = state.at(part).run.variables.get(name);
  if (!v || v.set !== 'on' || documentRoot(v.at) !== documentRoot(part)) return undefined;
  // (The variable of a `for` loop around the expansion, which the loop sets on each pass, even where the model does
  // not trust its value: the words it takes may be a glob.)
  const loop = v.at.parent?.type === 'for_statement' && v.at.parent.startIndex <= part.startIndex && part.endIndex <= v.at.parent.endIndex;
  if (!loop && !state.trusts(name)) return undefined;
  return { line: docLine(v.at) + 1, ...(loop ? { loop: true } : {}) };
}

/** (Prototype B) What bash's expansions make of the word `w` before the command reads it: file names (a glob), a home directory (a tilde). */
function wordExpands(state: StateModel, w: SyntaxNode): ('glob' | 'tilde' | 'split')[] {
  const m = wordMeaning(w, state);
  if (!m) return [];
  return (['glob', 'tilde', 'split'] as const).filter((k) => m.steps.some((s) => s.kind === k && s.applies !== false && (k === 'tilde' ? m.tildes.length > 0 : s.parts.length > 0)));
}

/** (Prototype B) The tilde prefixes of the word `w` (3.5.2), from the word model: their ranges and texts. */
function wordTildes(state: StateModel, w: SyntaxNode): { span: Span; text: string; user: string }[] {
  const m = wordMeaning(w, state);
  if (!m || m.steps.find((s) => s.kind === 'tilde')?.applies === false) return [];
  return m.tildes.filter((t) => !t.node.text.slice(0, t.start).includes('\n')).map((t) => {
    const line = t.node.startPosition.row;
    const col = t.node.startPosition.column;
    return { span: { start: { line, character: col + t.start }, end: { line, character: col + t.end } }, text: t.node.text.slice(t.start, t.end), user: t.user };
  });
}

export class Analyzer {
  /** The kind of string this analyzer explains, when it explains a string read as a script (`nestedLine`). */
  private nested: NestedScript['kind'] | undefined;

  constructor(private lang: Lang) {}

  explainLine(tree: SyntaxTree, line: number, shell?: Shell, opts: ExplainOptions = {}): LineExplanation {
    const root = tree.root;
    // (`#!/bin/bash --posix` starts bash in POSIX mode: the state reads it.)
    const state = shellState(tree, shell, { host: opts.hostCommands, run: opts.hostRun });
    // The walk the context calls back: the dispatch, with this line's context, and a line of a string read as a script.
    const walk: Walk = {
      explain: (n) => explain(cx, n),
      flatten: (n) => flatten(cx, n),
      nestedLine: (t, l, sh, kind, o) => this.nestedLine(t, l, sh, kind, o),
    };
    const cx = new LineExplainer(this.lang, { opts, root, line, shell, state, status: statusModel(state, shell), nested: this.nested }, walk);
    const items = flatten(cx, root);
    const statements = onLine(root, ['command', 'redirected_statement', 'list', 'pipeline', 'extended_test', 'while_statement'], line)
      .filter((n) => intersects(n, line));
    const notes = [
      ...continuationNotes(cx, root, line, items),
      ...cx.anchored(dialectFound(tree, line, shell ?? 'bash', this.lang, opts.bashVersion)),
      ...new Set(cx.notes),
      ...statusNotes(cx, line, false),
      ...(cx.opts.idioms === false ? [] : cx.anchored(idiomsFound(statements, this.lang, cx.status).map((f) => ({ ...plainNote(f.text), node: f.node })))),
      ...(cx.opts.pitfalls === false ? [] : cx.anchored(pitfallFindings(root, this.lang, line, line, cx.state, cx.shell))),
      ...new Set(wordFindings(root, this.lang, cx.state, cx.shell, line, line).flatMap((w) => cx.say(w.fact, w.node))),
      ...extglobPitfalls(cx, root, line),
      ...unmatchedGlobPitfalls(cx, root, line),
      ...pipeSubshellPitfalls(cx, root, line),
      ...statusNotes(cx, line, true),
    ];
    // (A fact said twice, or left out with the pitfalls, is listed once, or not.)
    const facts = cx.facts.filter((f, i, all) => notes.includes(f.text) && all.findIndex((g) => g.text === f.text) === i);
    const result: LineExplanation = {
      line,
      ...(shell && shell !== 'bash' ? { shell } : {}),
      items,
      context: cx.context,
      notes,
      noteInfo: notes.map((n) => cx.noteOf(n)),
      ...(facts.length ? { facts } : {}),
      ...(cx.anchors.some((a) => notes.includes(a.text)) ? { anchors: cx.anchors.filter((a) => notes.includes(a.text)) } : {}),
      // Each -e of sed explains the same combined script, at the command: drop repeated examples.
      examples: titledExamples(cx, root, line, cx.examples)
        .filter((e) => wantsExample(cx, e))
        .filter((e, i, all) => all.findIndex((x) => JSON.stringify(x) === JSON.stringify(e)) === i)
        .map((e) => {
          const note = pictureNote(e.sections.flatMap((sec) => sec.lines), (ja, en) => cx.s(ja, en));
          return note ? { ...e, note } : e;
        }),
      summary: items.filter((t) => t.kind !== 'comment' || items.length === 1).map(summaryOf).join(' ; '),
    };
    cx.end();
    // The summary above was made with the full explanations; the tree drops what its labels already say.
    for (const item of items) dropLabelEcho(claim(item, 'shell'));
    const resolveAt = (name: string, w: SyntaxNode) => resolve(cx, name, w, { quoted: w.type !== 'word' || w.text !== name });
    if (opts.reading) {
      result.reading = readingTree(tree, items, {
        lang: this.lang, resolve: resolveAt, meaning: (w) => wordMeaning(w, cx.state), extra: this.otherLines(tree, line, shell, opts, items),
        variable: (part) => variableFrom(cx, state, part), expands: (w) => wordExpands(state, w),
        tildes: (w) => wordTildes(state, w), argv: (c) => argvLine(c, state, this.lang, (name, at) => varDesc(cx, name, at)),
        cond: (c) => condLine(c, state, this.lang, (name, at) => varDesc(cx, name, at)), summary: (tops) => lineSummary(tops, state, this.lang, statusModel(state, shell), shell),
      });
    }
    return result;
  }

  /**
   * (Prototype B) The tokens of the other lines of the statement the reading tree shows (the body of a loop whose
   * first line is the line): each line's own explanation, so that a word says the same whatever line the cursor is on.
   * The lines no token of `items` starts on, up to 100.
   */
  private otherLines(tree: SyntaxTree, line: number, shell: Shell | undefined, opts: ExplainOptions, items: readonly Token[]): Token[] {
    if (!items.length) return [];
    const starts = new Set<number>();
    const walk = (t: Token): void => {
      starts.add(t.span.start.line);
      t.children.forEach(walk);
    };
    items.forEach(walk);
    const last = Math.max(...items.map((t) => t.span.end.line));
    const lean: ExplainOptions = { ...opts, reading: false, examples: { enabled: false, disabled: [] }, idioms: false, pitfalls: false };
    const out: Token[] = [];
    for (let l = items[0].span.start.line; l <= Math.min(last, line + 100); l++) {
      if (l === line || starts.has(l)) continue;
      out.push(...this.explainLine(tree, l, shell, lean).items);
    }
    return out;
  }

  /** Line `line` of a string read as a script (src/explain/scripts.ts): a new `Analyzer`, which explains it as a script of its own. */
  private nestedLine(tree: SyntaxTree, line: number, shell: Shell | undefined, kind: NestedScript['kind'], opts: ExplainOptions): LineExplanation {
    const inner = new Analyzer(this.lang);
    inner.nested = kind;
    return inner.explainLine(tree, line, shell, opts);
  }
}

export { lookupCommand };
