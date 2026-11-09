// A statement over several lines that is not a block (`\` continuations, a here-document, a string) is explained whole by each of its lines.
// Its later lines read one explanation, kept for the document: a walk of the statement for each of them would make a script's cost the square of
// its size (docs/design/line-budget.md). The walk has a context of its own and is finished here, so that the line that reads it only adds what
// is its own: the notes of that line and, by copying the tokens they are about, their facts (`markTokens`). It is finished as a line is (`finishLine`).
import type { NoteAnchor, Token } from '../analyzer-types';
import { withinOwnLine } from '../examples/regexguard';
import { onceBy } from '../lists';
import { basisGate, type Fact } from '../messages';
import { withRewritesOf } from '../rewrite';
import type { StateModel } from '../semantics/state';
import type { SyntaxNode } from '../syntax/tree';
import { keep } from '../tokenkept';
import { finishLine } from '../linefinish';
import { COMMAND_SAID, type CommandSaid } from './commands';
import type { Explainer, LineExplainer, LineInit, Whole } from './context';

type Kept = Whole | { thrown: unknown };

/** By the model of the script (which holds what its options change: src/semantics/state.ts), and by what else a walk reads. */
const kept = new WeakMap<StateModel, Map<string, Map<SyntaxNode, Kept>>>();

/** The facts of `all` that `said` holds, each once, with the rewrites of all those places. */
export function factsSaid(all: readonly Fact[], said: ReadonlySet<string>, basis: boolean | undefined): Fact[] {
  return onceBy(all.filter((f) => said.has(f.text)), (f) => f.text).map((f) => basisGate(withRewritesOf(f, all), basis));
}

function explainedOnce(cx: LineExplainer, explained: (cx: Explainer) => Token): Whole {
  const token = explained(cx);
  // (As a line is finished, `finishLine`: the statement's notes, facts and anchors are those it said itself.)
  let saidNotes: string[] = [];
  let saidFacts: Fact[] = [];
  let saidAnchors: NoteAnchor[] = [];
  // (A statement explained once has no line of its own: only the summary of what is made is read.)
  const { summary } = finishLine({ line: 0, items: [token], own: [token], rested: cx.rested, context: [], origin: 'shell' }, cx.opts, () => {
    saidNotes = [...new Set(cx.notes)];
    const said = new Set(saidNotes);
    saidFacts = factsSaid(cx.facts, said, cx.opts.basis);
    saidAnchors = cx.anchors.filter((a) => said.has(a.text));
    return { notes: saidNotes, noteInfo: [], facts: [], anchors: [], examples: [], marked: { facts: saidFacts, anchors: saidAnchors } };
  }, () => cx.end());
  keep(token);
  return {
    token, summary, notes: cx.notes, facts: cx.facts, anchors: cx.anchors, examples: cx.examples, rested: cx.rested, data: cx.data,
    saidNotes, noteInfo: saidNotes.map((n) => basisGate(cx.noteOf(n), cx.opts.basis)), saidFacts, saidAnchors,
    texts: new Set([...saidNotes, ...cx.facts.map((f) => f.text), ...cx.anchors.map((a) => a.text)]),
    commands: cx.memo(COMMAND_SAID),
    later: { examples: [], sentences: new Map() },
  };
}

/**
 * What `explained` makes of `n`, walked once for the script and these options, in a context of its own (`explainer`) and with a budget of its own: the
 * same on every line, whichever asks first. What failed (a statement nested too deep to walk) fails the same way, and is not walked again.
 */
export function wholeOf(lang: string, init: LineInit, n: SyntaxNode, explained: (cx: Explainer) => Token, explainer: () => LineExplainer): Whole {
  // (The options that change a walk and are not in the model's key, `reading` for a string read as a script in it; the rest are read after it.)
  const { yqFlavor, examples, idioms, pitfalls, basis, customCommands, positional, reading } = init.opts;
  const key = JSON.stringify([lang, init.shell, init.nested, yqFlavor, examples, idioms, pitfalls, basis, customCommands, positional, !!reading]);
  let byKey = kept.get(init.state);
  if (!byKey) kept.set(init.state, (byKey = new Map()));
  let byNode = byKey.get(key);
  if (!byNode) byKey.set(key, (byNode = new Map()));
  let w = byNode.get(n);
  if (!w) {
    try {
      w = withinOwnLine(() => explainedOnce(explainer(), explained));
    } catch (thrown) {
      w = { thrown };
    }
    byNode.set(n, w);
  }
  if ('thrown' in w) throw w.thrown;
  return w;
}

/** What each simple command explained on the line is (`COMMAND_SAID`), with those of the statements it reads. */
export function commandsSaid(cx: LineExplainer): ReadonlyMap<SyntaxNode, CommandSaid> {
  const own = cx.memo(COMMAND_SAID);
  if (cx.wholes.length === 1 && !own.size) return cx.wholes[0].commands as ReadonlyMap<SyntaxNode, CommandSaid>;
  return new Map([...cx.wholes.flatMap((w) => [...w.commands as ReadonlyMap<SyntaxNode, CommandSaid>]), ...own]);
}
