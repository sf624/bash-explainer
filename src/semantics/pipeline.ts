// What a pipeline's last stage loses: the variables it sets in its own subshell (src/semantics/env.ts), which are
// gone after the pipeline, and which of them a command after it reads (`… | while read l; do n=…; done; echo "$n"`).
// Read from the shell state (src/semantics/state.ts) and the environments; said by the analyzer
// (`pipeline-subshell-variable`, src/messages.ts).
import { field, readsVariable, type NodeType, type SyntaxNode } from '../syntax/tree';
import { lastStage, ownSubshells, subshellReasons, type SubshellLink } from './env';
import type { StateModel } from './state';

/** A set of node types, checked against the model's: a name that is not a NodeType does not compile. */
const types = (...names: NodeType[]): ReadonlySet<string> => new Set<string>(names);
/** What can end a pipeline and run in its subshell. */
const LAST_STAGES = types('while_statement', 'for_statement', 'select_statement', 'compound_statement', 'arithmetic_command', 'command');
/** What holds a list of statements. */
const BLOCK_OWNERS = types('program', 'compound_statement', 'do_group', 'subshell', 'if_statement', 'else_clause', 'elif_clause', 'case_item');

/** Every named node under `n`, in document order. */
function everyNode(n: SyntaxNode): SyntaxNode[] {
  return n.namedChildren.flatMap((c) => [c, ...everyNode(c)]);
}

/** A variable that the last stage of a pipeline sets in its subshell and that is read after the pipeline. */
export interface LostVariable {
  /** The variable. */
  name: string;
  /** The last stage, without the redirections after it (`… | while …; done > log`). */
  last: SyntaxNode;
  /** The subshell the last stage runs in (`sure: false`: on some paths only, as with lastpipe on some of them). */
  link: SubshellLink;
}

/**
 * The first variable that the last stage of the pipeline `p` sets in its own subshell and that is read after the
 * pipeline in the same block, before being set again; undefined when there is none, or the last stage runs in the
 * shell itself (lastpipe on). What the stage sets is the model's: not a local (the walk leaves it out of `writes`),
 * not what a subshell inside it sets (`subshellReasons`); a function called there sets what its body sets. A read
 * is an expansion in the tree, not text in a quoted string.
 */
export function lostVariable(model: StateModel, p: SyntaxNode): LostVariable | undefined {
  const stage = lastStage(p);
  const link = ownSubshells(model.env(stage), stage).find((l) => l.why === 'pipeline-stage');
  if (!link) return undefined;
  // The redirections after the last stage (`… | while …; done > log`) are its own.
  const last = stage.type === 'redirected_statement' ? field(stage, 'body')! : stage;
  if (!LAST_STAGES.has(last.type)) return undefined;
  const names = new Set<string>();
  const sets = (region: SyntaxNode): void => {
    for (const m of [region, ...everyNode(region)]) {
      let own = true;
      for (let x: SyntaxNode | null = m; x && x !== region; x = x.parent) if (subshellReasons(x).length) own = false;
      if (own) for (const v of model.writes(m)) names.add(v);
    }
  };
  sets(last);
  for (const m of [last, ...everyNode(last)]) {
    for (const [def, callers] of model.calls) if (callers.has(m)) sets(def);
  }
  if (!names.size) return undefined;
  // Used after the pipeline, in the same block.
  let scope: SyntaxNode = p;
  while (scope.parent && !BLOCK_OWNERS.has(scope.parent.type)) scope = scope.parent;
  // The program at least holds the pipeline.
  const block = scope.parent!;
  const after = everyNode(block).filter((m) => m.startIndex >= scope.endIndex);
  // Read before being set again (a later loop may set the same names for itself).
  const name = [...names].find((n) => {
    const use = after.find((m) => (m.type === 'simple_expansion' || m.type === 'expansion') && readsVariable(m, n));
    const set = after.find((m) => model.writes(m).has(n));
    return use && (!set || use.startIndex < set.startIndex);
  });
  return name === undefined ? undefined : { name, last, link };
}
