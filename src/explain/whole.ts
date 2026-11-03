// A statement over several lines that is not a block (`\` continuations, a here-document, a string) is explained whole by each of its lines.
// Its later lines read one explanation, kept for the document: a walk of the statement for each of them would make a script's cost the square of
// its size (docs/design/line-budget.md). The walk has a context of its own and is finished here, so that the line that reads it only adds what
// is its own: the notes of that line and, by copying the tokens they are about, their facts (`markTokens`).
import type { Token } from '../analyzer-types';
import { withinOwnLine } from '../examples/regexguard';
import { onceBy } from '../lists';
import { basisGate, type Fact } from '../messages';
import { withRewritesOf } from '../rewrite';
import type { StateModel } from '../semantics/state';
import type { SyntaxNode } from '../syntax/tree';
import { withTokenBases, withoutBases } from '../tokenbases';
import { claim, dropLabelEcho, markSaid, markTokens } from '../tokenmarks';
import { COMMAND_SAID, type CommandSaid } from './commands';
import type { Explainer, LineExplainer, LineInit, Whole } from './context';
import { summaryOf } from './nodes';

type Kept = Whole | { thrown: unknown };

/** By the model of the script (which holds what its options change: src/semantics/state.ts), and by what else a walk reads. */
const kept = new WeakMap<StateModel, Map<string, Map<SyntaxNode, Kept>>>();

/** The facts of `all` that `said` holds, each once, with the rewrites of all those places. */
export function factsSaid(all: readonly Fact[], said: ReadonlySet<string>, basis: boolean | undefined): Fact[] {
  return onceBy(all.filter((f) => said.has(f.text)), (f) => f.text).map((f) => basisGate(withRewritesOf(f, all), basis));
}

/** A token and those under it can no longer change: what reads them makes copies (`markTokens`, `remapExplanation`). */
function freeze(t: Token): void {
  Object.freeze(t);
  Object.freeze(t.children);
  t.children.forEach(freeze);
}

function explainedOnce(cx: LineExplainer, explained: (cx: Explainer) => Token): Whole {
  const token = explained(cx);
  // (As `Analyzer.explained` finishes the tokens of a line.)
  if (cx.opts.basis === false) withoutBases([token]);
  else withTokenBases([token], cx.rested);
  markSaid([token]);
  const saidNotes = [...new Set(cx.notes)];
  const said = new Set(saidNotes);
  const saidFacts = factsSaid(cx.facts, said, cx.opts.basis);
  const saidAnchors = cx.anchors.filter((a) => said.has(a.text));
  const summary = summaryOf(token);
  cx.end();
  dropLabelEcho(claim(token, 'shell'));
  markTokens([token], { facts: saidFacts, anchors: saidAnchors });
  freeze(token);
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
  // (The options that change a walk and are not in the model's key; the rest are read after it.)
  const { yqFlavor, examples, idioms, pitfalls, basis, customCommands, positional } = init.opts;
  const key = JSON.stringify([lang, init.shell, init.nested, yqFlavor, examples, idioms, pitfalls, basis, customCommands, positional]);
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
