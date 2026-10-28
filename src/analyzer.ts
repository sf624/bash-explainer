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
import { basisGate, plainNote } from './messages';
import { withoutBases, withTokenBases } from './tokenbases';
import { pictureNote } from './ctlchars';
import { withRewritesOf } from './rewrite';
import { dialectFound, Shell } from './dialect';
import { fileRead } from './semantics/env';
import { shellState } from './semantics/state';
import type { NestedScript } from './semantics/nested';
import { statusModel } from './semantics/status';
import { wordMeaning } from './semantics/words';

export { EXAMPLE_KINDS } from './analyzer-types';
export type { ContextEntry, Example, ExampleKind, ExampleSection, ExplainOptions, Kind, LineExplanation, Pos, ScriptProcess, Span, Token, TokenOrigin } from './analyzer-types';
import type { ExplainOptions, LineExplanation } from './analyzer-types';
import { readingTree } from './reading';
import { claim, dropLabelEcho } from './tokenmarks';
import { LineExplainer, type Walk } from './explain/context';
import { intersects, isBlockLike, onLine, summaryOf } from './explain/nodes';
import { arrayKind, resolve } from './explain/reads';
import { titledExamples, wantsExample } from './explain/examples';
import { explain, flatten } from './explain/dispatch';
import { continuationNotes, extglobPitfalls, pipeSubshellPitfalls, statusNotes, unmatchedGlobPitfalls } from './explain/line-notes';

export { isBlockLike, summaryOf };

export class Analyzer {
  /** The kind of string this analyzer explains, when it explains a string read as a script (`nestedLine`). */
  private nested: NestedScript['kind'] | undefined;

  constructor(private lang: Lang) {}

  explainLine(tree: SyntaxTree, line: number, shell?: Shell, opts: ExplainOptions = {}): LineExplanation {
    const root = tree.root;
    // (`#!/bin/bash --posix` starts bash in POSIX mode: the state reads it.)
    // (How the file is read: a host's code is run as a script, or typed into a terminal. A string read as a script has
    // the model of its file, which this does not change.)
    const state = shellState(tree, shell, { host: opts.hostCommands, run: opts.hostRun, version: opts.bashVersion, ...(opts.host ? { read: fileRead(root, opts.host) } : {}), ...(opts.hostProvided?.length ? { provided: opts.hostProvided } : {}) });
    // The walk the context calls back: the dispatch, with this line's context, and a line of a string read as a script.
    const walk: Walk = {
      explain: (n) => explain(cx, n),
      flatten: (n) => flatten(cx, n),
      nestedLine: (t, l, sh, kind, o) => this.nestedLine(t, l, sh, kind, o),
    };
    const cx = new LineExplainer(this.lang, { opts, root, line, shell, state, status: statusModel(state, shell), nested: this.nested }, walk);
    const items = flatten(cx, root);
    // (A token that shows a text stating bash's behaviour gets its basis and try-it, over the spec a program's token
    // has; with `notes.basis` off, no token has a basis.)
    if (opts.basis === false) withoutBases(items);
    else withTokenBases(items, cx.rested);
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
    // (A fact said twice, or left out with the pitfalls, is listed once, or not. Said twice, it is about two places,
    // `cp $a b; cp $a c`: its rewrites make the edits of both, so that none of them is left.)
    const facts = cx.facts.filter((f, i, all) => notes.includes(f.text) && all.findIndex((g) => g.text === f.text) === i)
      .map((f) => basisGate(withRewritesOf(f, cx.facts), cx.opts.basis));
    const result: LineExplanation = {
      line,
      ...(shell && shell !== 'bash' ? { shell } : {}),
      items,
      context: cx.context,
      notes,
      noteInfo: notes.map((n) => basisGate(cx.noteOf(n), cx.opts.basis)),
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
    if (opts.reading) result.reading = readingTree(tree, items, { lang: this.lang, resolve: resolveAt, meaning: (w) => wordMeaning(w, cx.state), arrayKind: (name, at) => arrayKind(cx, name, at), ...(cx.shell ? { shell: cx.shell } : {}) });
    return result;
  }

  /** Line `line` of a string read as a script (src/explain/scripts.ts): a new `Analyzer`, which explains it as a script of its own. */
  private nestedLine(tree: SyntaxTree, line: number, shell: Shell | undefined, kind: NestedScript['kind'], opts: ExplainOptions): LineExplanation {
    const inner = new Analyzer(this.lang);
    inner.nested = kind;
    return inner.explainLine(tree, line, shell, opts);
  }
}

export { lookupCommand };
