// Design study (prototype): what the models add to the colours of src/highlight.ts, for semantic tokens.
// highlight.ts reads only the tree (and its own list of builtins); here the facts come from the models:
// what a command name runs (src/semantics/names.ts `resolveName`), which words a command reads as options
// (its spec, src/argv/), and the attributes of a variable where it is used (src/semantics/state.ts).
// Pure: no VS Code. Offsets are those of the tree's text.
import type { Shell } from './dialect';
import { interpret, type ArgvParse } from './argv/interpret';
import { argWord } from './argv/words';
import { lookupCommand } from './dict/aliases';
import { isProgram } from './namefacts';
import { resolveName } from './semantics/names';
import { shellState, type StateModel } from './semantics/state';
import { staticWordValue } from './staticword';
import { field, fields, type SyntaxNode, type SyntaxTree } from './syntax/tree';

/** What a span is to an editor: a standard token type, or none (the grammar's colour stays). */
export type FactType = 'keyword' | 'function' | 'macro' | 'parameter' | 'variable' | 'string';
/** Modifiers; `exported` and `unknown` are our own (declared in package.json, ignored by themes unless styled). */
export type FactModifier = 'defaultLibrary' | 'readonly' | 'exported' | 'unknown' | 'declaration' | 'modification';

export interface FactSpan {
  readonly from: number;
  readonly to: number;
  /** Replaces the type highlight.ts gives the span; `null` clears it (an operand that looks like an option). */
  readonly type: FactType | null;
  readonly modifiers: readonly FactModifier[];
}

/**
 * The spans the models decide, sorted by start, not overlapping: command names (what runs), words read as options
 * or not (by the command's spec), and variables with their attributes where they are used or set.
 */
export function semanticFacts(tree: SyntaxTree, shell?: Shell, range?: { from: number; to: number }): FactSpan[] {
  const model = shellState(tree, shell);
  const out: FactSpan[] = [];
  const visit = (n: SyntaxNode): void => {
    if (range && (n.endIndex < range.from || n.startIndex > range.to)) return;
    if (n.type === 'command') command(n, model, shell, out);
    else if (n.type === 'variable_name' && n.parent) variable(n, model, out);
    for (const c of n.namedChildren) visit(c);
  };
  visit(tree.root);
  return out.sort((a, b) => a.from - b.from);
}

function command(c: SyntaxNode, model: StateModel, shell: Shell | undefined, out: FactSpan[]): void {
  const nameNode = field(c, 'name');
  const word = nameNode?.namedChildren.length === 1 ? nameNode.namedChildren[0] : undefined;
  const name = word ? staticWordValue(word) : undefined;
  if (!nameNode || !word || name === undefined || !/^[\w./:[+-]+$/.test(name)) return;
  const quoted = word.text !== name;
  const res = resolveName(model, name, nameNode, { shell, command: true, quoted, program: isProgram });
  const span = (type: FactType, ...modifiers: FactModifier[]): void => void out.push({ from: word.startIndex, to: word.endIndex, type, modifiers });
  switch (res.kind) {
    case 'alias': span('macro'); break;
    case 'function': span('function', ...(res.sure ? [] : ['unknown' as const])); break;
    case 'builtin': span('function', 'defaultLibrary'); break;
    case 'file': span('function', ...(res.known || res.path !== 'search' ? [] : ['unknown' as const])); break;
    case 'keyword': span('keyword'); break;
    case 'none': break;
  }
  // The words the command reads as options, by its spec (and the specs of the commands it runs: `sudo ls -l`).
  const spec = lookupCommand(name);
  if (!spec || res.kind === 'function' || res.kind === 'alias') return;
  const args = fields(c, 'argument');
  const parse = interpret(spec, args.map(argWord), { name, lookup: lookupCommand });
  optionWords(parse, args, out);
}

/** Option words as parameters; a word that looks like an option but is a value or an operand, cleared. */
function optionWords(parse: ArgvParse, args: readonly SyntaxNode[], out: FactSpan[]): void {
  for (const { word, role } of parse.roles) {
    const w = args[word];
    if (!w) continue;
    switch (role.role) {
      case 'option': case 'cluster': case 'pattern-option': case 'unknown-option': case 'old-style': case 'open-option': case 'end-of-options': {
        // The option's own text (`--file` of `--file=x`), not its attached value.
        const eq = role.role === 'option' && role.value?.attached !== undefined ? role.value.attached : w.text.indexOf('=') > 0 && w.text.startsWith('--') ? w.text.indexOf('=') : w.text.length;
        out.push({ from: w.startIndex, to: w.startIndex + Math.max(1, Math.min(eq, w.text.length)), type: 'parameter', modifiers: [] });
        break;
      }
      case 'operand': case 'value':
        if (role.role === 'value' && role.attached !== undefined) break;
        if (/^-./.test(w.text) && w.type === 'word') out.push({ from: w.startIndex, to: w.endIndex, type: 'string', modifiers: [] });
        break;
      case 'command':
        // The name of a command another one runs (`sudo ls`, `xargs rm`): to bash an argument, to the reader a command.
        if (role.name !== undefined && w.type === 'word') out.push({ from: w.startIndex, to: w.endIndex, type: 'function', modifiers: [] });
        if (role.parse) optionWords(role.parse, args, out);
        break;
      case 'subcommand':
        if (role.parse) optionWords(role.parse, args, out);
        break;
      default:
        break;
    }
  }
}

/** A variable where it is expanded or set: readonly, exported, from the state there (when the model trusts it). */
function variable(n: SyntaxNode, model: StateModel, out: FactSpan[]): void {
  const owner = n.parent!.type === 'subscript' ? n.parent!.parent! : n.parent!;
  const expanded = owner.type === 'simple_expansion' || owner.type === 'expansion';
  const set = owner.type === 'variable_assignment';
  if (!expanded && !set) return;
  if (!model.trusts(n.text)) return;
  const v = model.at(owner).run.variables.get(n.text);
  const modifiers: FactModifier[] = [];
  if (v?.attrs.r?.state === 'on') modifiers.push('readonly');
  if (v?.attrs.x?.state === 'on') modifiers.push('exported');
  if (set) modifiers.push('modification');
  if (modifiers.length) out.push({ from: n.startIndex, to: n.endIndex, type: 'variable', modifiers });
}
