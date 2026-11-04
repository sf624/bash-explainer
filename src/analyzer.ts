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
import { basisGate, type Fact, fact, pitfallSaid } from './messages';
import { onceBy } from './lists';
import { withoutBases, withTokenBases } from './tokenbases';
import { pictureNote } from './ctlchars';
import { dialectFound, Shell } from './dialect';
import { fileRead } from './semantics/env';
import { shellState } from './semantics/state';
import type { NestedScript } from './semantics/nested';
import { statusModel } from './semantics/status';
import { plainPatternText } from './semantics/globwords';
import { wordMeaning } from './semantics/words';

export { EXAMPLE_KINDS } from './analyzer-types';
export type { ContextEntry, Example, ExampleKind, ExampleSection, ExplainOptions, Kind, LineExplanation, Pos, ScriptProcess, Span, Token, TokenOrigin } from './analyzer-types';
import type { Token } from './analyzer-types';
import type { Example, ExplainOptions, LineExplanation } from './analyzer-types';
import { withinLine } from './examples/regexguard';
import { contained, stackFull } from './failures';
import { shorten } from './label';
import { readingTree } from './reading';
import { KIND_ROLES } from './roles';
import { argvLines } from './argvline';
import { lineSentence, problemCodes } from './linesentence';
import { claim, dropLabelEcho, markSaid, markTokens } from './tokenmarks';
import { LineExplainer, type LineInit, type Walk } from './explain/context';
import { intersects, isBlockLike, onLine, summaryOf } from './explain/nodes';
import { arrayKind, resolve, syntaxFaultOf } from './explain/reads';
import { runsSeveral, titledExamples, wantsExample } from './explain/examples';
import { commandsSaid, factsSaid, wholeOf } from './explain/whole';
import { explain, flatten } from './explain/dispatch';
import { continuationNotes, extglobPitfalls, pipeSubshellPitfalls, statusNotes, syntaxErrorNotes, tokenErrorNotes, unmatchedGlobPitfalls } from './explain/line-notes';

export { isBlockLike, summaryOf };

/**
 * The line a bug stopped from being explained: all it can say is that, on a token of the line, where every product shows a line's
 * explanation. Nothing in it reads the tree but the line's text, in case the tree is what fails.
 */
function lineNotExplained(said: Fact, tree: SyntaxTree, line: number, shell: Shell | undefined): LineExplanation {
  const text = tree.text.split('\n')[line] ?? '';
  const at = (character: number) => ({ line, character });
  const code = text.trim();
  const start = text.length - text.trimStart().length;
  const token: Token = { kind: 'error', role: KIND_ROLES.error, label: shorten(code, 40), explanation: said.text, children: [], span: { start: at(start), end: at(start + code.length) } };
  return {
    line,
    ...(shell && shell !== 'bash' ? { shell } : {}),
    items: code ? [token] : [],
    context: [],
    notes: [said.text],
    noteInfo: [{ text: said.text, level: said.level, label: said.label, body: said.body, code: said.code, ...(said.head ? { head: said.head } : {}) }],
    // (Where a line is too deep, it is a problem there: `noteIssues`. A file not read is one problem, not one for each line.)
    ...(code && said.code === 'line-too-deep' ? { anchors: [{ text: said.text, span: token.span }] } : {}),
    examples: [],
    summary: code ? summaryOf(token) : '',
  };
}

export class Analyzer {
  /** The kind of string this analyzer explains, when it explains a string read as a script (`nestedLine`). */
  private nested: NestedScript['kind'] | undefined;

  constructor(private lang: Lang) {}

  /**
   * The explanation of a line, within the line's budget (src/examples/regexguard.ts). This is the boundary of a line: a bug
   * that throws in it gives a line that says so, and not a product that stops (src/failures.ts).
   */
  explainLine(tree: SyntaxTree, line: number, shell?: Shell, opts: ExplainOptions = {}): LineExplanation {
    if (tree.unread) return lineNotExplained(fact(this.lang, 'file-not-read', { why: tree.unread }), tree, line, shell);
    return contained(`line ${line + 1}`, () => {
      try {
        return withinLine(tree.root, () => this.explained(tree, line, shell, opts));
      } catch (e) {
        // (No bug: what is nested in the line goes deeper than a walk can follow.)
        if (!stackFull(e)) throw e;
        return this.notExplained(tree, line, shell, e);
      }
    }, (e) => this.notExplained(tree, line, shell, e));
  }

  /** What is said of a line a bug stopped from being explained. */
  notExplained(tree: SyntaxTree, line: number, shell: Shell | undefined, error: unknown): LineExplanation {
    return lineNotExplained(fact(this.lang, stackFull(error) ? 'line-too-deep' : 'line-not-explained'), tree, line, shell);
  }

  private explained(tree: SyntaxTree, line: number, shell: Shell | undefined, opts: ExplainOptions): LineExplanation {
    const root = tree.root;
    // (`#!/bin/bash --posix` starts bash in POSIX mode: the state reads it.)
    // (How the file is read: a host's code is run as a script, or typed into a terminal. A string read as a script has
    // the model of its file, which this does not change.)
    const state = shellState(tree, shell, { host: opts.hostCommands, run: opts.hostRun, version: opts.bashVersion, ...(opts.host ? { read: fileRead(root, opts.host) } : {}), ...(opts.hostProvided?.length ? { provided: opts.hostProvided } : {}), ...(opts.noShell ? { noShell: true } : {}) });
    const cx = this.explainer({ opts, root, tree, source: tree.text, line, shell, state, status: statusModel(state, shell), nested: this.nested });
    const items = flatten(cx, root);
    // (The tokens of a statement over several lines, `cx.whole`, are finished.)
    const own = items.filter((t) => !Object.isFrozen(t));
    // (A token that shows a text stating bash's behaviour gets its basis and try-it, over the spec a program's token
    // has; with `notes.basis` off, no token has a basis.)
    if (opts.basis === false) withoutBases(own);
    else withTokenBases(own, cx.rested);
    markSaid(own);
    const walkedFacts = cx.facts.length;
    const walkedAnchors = cx.anchors.length;
    // (The one statement all that the line collected comes from, when there is one: what it says it says on all its lines.)
    const alone = cx.wholes.length === 1 && !own.length ? cx.wholes[0] : undefined;
    const statements = onLine(root, ['command', 'redirected_statement', 'list', 'pipeline', 'extended_test', 'while_statement'], line).filter((n) => intersects(n, line));
    const before = [
      ...continuationNotes(cx, root, line, items),
      ...tokenErrorNotes(cx, items),
      ...syntaxErrorNotes(cx, line),
      ...cx.anchored(dialectFound(tree, line, shell ?? 'bash', this.lang, opts.bashVersion)),
    ];
    const walked = alone ? alone.saidNotes : [...new Set(cx.notes)];
    const after = [
      ...statusNotes(cx, line, false),
      ...(cx.opts.idioms === false ? [] : idiomsFound(statements, this.lang, cx.status).flatMap((f) => cx.say(f.fact, f.node))),
      ...cx.anchored(pitfallFindings(root, this.lang, line, line, cx.state, cx.shell).filter((f) => pitfallSaid(f.level, cx.opts.pitfalls))),
      ...new Set(wordFindings(root, this.lang, cx.state, cx.shell, line, line).flatMap((w) => cx.say(w.fact, w.node))),
      ...extglobPitfalls(cx, root, line),
      ...unmatchedGlobPitfalls(cx, root, line),
      ...pipeSubshellPitfalls(cx, root, line),
      ...statusNotes(cx, line, true),
    ];
    const notes = [...before, ...walked, ...after];
    // (A fact said twice, or left out with the pitfalls, is listed once, or not. Said twice, it is about two places,
    // `cp $a b; cp $a c`: its rewrites make the edits of both, so that none of them is left.
    // A line that says nothing its statement says has that statement's facts and anchors as they are, and only its own to work out.)
    const apart = alone && ![...before, ...after, ...cx.facts.slice(walkedFacts).map((f) => f.text)].some((text) => alone.texts.has(text)) ? alone : undefined;
    const said = new Set(apart ? [...before, ...after] : notes);
    const factsOfLine = apart ? cx.facts.slice(walkedFacts) : cx.facts;
    const anchorsOfLine = (apart ? cx.anchors.slice(walkedAnchors) : cx.anchors).filter((a) => said.has(a.text));
    const lineFacts = factsSaid(factsOfLine, said, opts.basis);
    const facts = [...apart?.saidFacts ?? [], ...lineFacts];
    const anchors = [...apart?.saidAnchors ?? [], ...anchorsOfLine];
    const info = (texts: readonly string[]) => texts.map((n) => basisGate(cx.noteOf(n), opts.basis));
    const examplesOf = (examples: readonly Example[], several: boolean) =>
      onceBy((several ? titledExamples(cx, examples) : examples).filter((e) => wantsExample(cx, e)), (e) => JSON.stringify(e))
        .map((e) => {
          const note = pictureNote(e.sections.flatMap((sec) => sec.lines), (ja, en) => cx.s(ja, en));
          return note ? { ...e, note } : e;
        });
    const several = runsSeveral(root, line);
    const wholeSummary = new Map(cx.wholes.map((w) => [w.token, w.summary]));
    const result: LineExplanation = {
      line,
      ...(shell && shell !== 'bash' ? { shell } : {}),
      items,
      context: cx.context,
      notes,
      noteInfo: alone ? [...info(before), ...alone.noteInfo, ...info(after)] : info(notes),
      ...(facts.length ? { facts } : {}),
      ...(anchors.length ? { anchors } : {}),
      // Each -e of sed explains the same combined script, at the command: drop repeated examples.
      examples: alone ? (alone.later.examples[+several] ??= examplesOf(alone.examples, several)) : examplesOf(cx.examples, several),
      summary: items.filter((t) => t.kind !== 'comment' || items.length === 1).map((t) => wholeSummary.get(t) ?? summaryOf(t)).join(' ; '),
    };
    cx.end();
    // The summary above was made with the full explanations; the tree drops what its labels already say.
    for (const item of own) dropLabelEcho(claim(item, 'shell'));
    // (Each token's role and the facts about it, now that every kind is final; those of a finished token from its statement it has.)
    const marked = new Set(apart ? [] : cx.wholes.flatMap((w) => w.saidAnchors));
    result.items = markTokens(items, { facts: lineFacts, anchors: anchorsOfLine.filter((a) => !marked.has(a)) });
    const resolveAt = (name: string, w: SyntaxNode) => resolve(cx, name, w, { quoted: w.type !== 'word' || w.text !== name });
    if (opts.argv) result.argv = argvLines(root, line, cx.state, this.lang);
    // (A string read as a script has none: the line's sentence says the command that reads it.)
    if (opts.sentence && !this.nested) {
      const fault = syntaxFaultOf(cx);
      // (A blank line or a comment of the command says nothing, as any.)
      const said = lineSentence({ root, line, lang: this.lang, status: cx.status, commands: commandsSaid(cx), problems: new Set([...problemCodes(result), ...opts.hostProblems ?? []]), kept: alone?.later.sentences, syntaxError });
      if (said) result.sentence = said.text;
    }
    if (opts.reading) {
      const reading = () => readingTree(tree, result.items, { lang: this.lang, resolve: resolveAt, meaning: (w) => wordMeaning(w, cx.state), plainPattern: (w) => plainPatternText(w, cx.state), arrayKind: (name, at) => arrayKind(cx, name, at), ...(cx.shell ? { shell: cx.shell } : {}) });
      result.reading = alone && result.items[0] === alone.token ? (alone.later.reading ??= reading()) : reading();
    }
    return result;
  }

  /** The context of a line, with the walk it calls back: the dispatch, with this context; a line of a string read as a script; a statement over several lines. */
  private explainer(init: LineInit): LineExplainer {
    const walk: Walk = {
      explain: (n) => explain(cx, n),
      flatten: (n) => flatten(cx, n),
      nestedLine: (t, l, sh, kind, o) => this.nestedLine(t, l, sh, kind, o),
      whole: (n, explained) => wholeOf(this.lang, init, n, explained, () => this.explainer(init)),
    };
    const cx = new LineExplainer(this.lang, init, walk);
    return cx;
  }

  /** Line `line` of a string read as a script (src/explain/scripts.ts): a new `Analyzer`, which explains it as a script of its own. */
  private nestedLine(tree: SyntaxTree, line: number, shell: Shell | undefined, kind: NestedScript['kind'], opts: ExplainOptions): LineExplanation {
    const inner = new Analyzer(this.lang);
    inner.nested = kind;
    return inner.explainLine(tree, line, shell, opts);
  }
}

export { lookupCommand };
