// What the models add to the colours of src/highlight.ts, which reads the tree: what a command name runs
// (src/semantics/names.ts `resolveName`, the fact the panel's badge says), which words a command reads as options
// (its spec, read by src/argv/), and the attributes of a variable where it is used (src/semantics/state.ts, when the
// model trusts the script there). Pure: no editor. Offsets are those of the tree's text.
import type { Shell } from './dialect';
import { interpret, type ArgvParse } from './argv/interpret';
import type { CommandSpec } from './argv/spec';
import { argWordFor } from './argv/words';
import { lookupCommand } from './dict/aliases';
import type { HighlightKind } from './highlight';
import { isProgram } from './namefacts';
import { slotEnvs } from './semantics/env';
import { type NameResolution, resolveName, testSpecOf } from './semantics/names';
import type { StateModel } from './semantics/state';
import { staticWordValue } from './staticword';
import { field, fields, type SyntaxNode, type SyntaxTree } from './syntax/tree';

/** What the state says of a variable where it is used or set. */
export type HighlightModifier = 'readonly' | 'exported';

export interface FactSpan {
  readonly from: number;
  readonly to: number;
  /** Paints over the kind the tree gives the span; undefined keeps it (a variable gets modifiers only). */
  readonly kind?: HighlightKind;
  readonly modifiers?: readonly HighlightModifier[];
}

/** The kind of what a command name runs (never a reserved word: the parser has read it as a command name). */
export function nameKind(res: NameResolution): HighlightKind {
  switch (res.kind) {
    case 'alias': return 'alias';
    case 'function': return 'function';
    case 'builtin': return 'builtin';
    // (A program, or nothing: `builtin nosuch`, still a command name to the reader.)
    default: return 'command';
  }
}

/**
 * The spans the models decide, in the order of the tree: command names (what runs there), the words a command's spec
 * reads as options (and those that only look like options: `grep -e -v` searches for `-v`), and variables with their
 * attributes where they are expanded or set. With `range`, only the nodes that overlap these offsets.
 */
export function semanticFacts(tree: SyntaxTree, model: StateModel, shell?: Shell, range?: { from: number; to: number }): FactSpan[] {
  const out: FactSpan[] = [];
  const visit = (n: SyntaxNode): void => {
    if (range && (n.endIndex < range.from || n.startIndex > range.to)) return;
    if (n.type === 'command') command(n, model, shell, out);
    else if (n.type === 'variable_name') variable(n, model, out);
    for (const c of n.namedChildren) visit(c);
  };
  visit(tree.root);
  return out;
}

const resolveOpts = (shell: Shell | undefined) => ({ ...(shell ? { shell } : {}), command: true, program: isProgram });

function command(c: SyntaxNode, model: StateModel, shell: Shell | undefined, out: FactSpan[]): void {
  const nameNode = field(c, 'name');
  const word = nameNode?.namedChildren.length === 1 ? nameNode.namedChildren[0] : undefined;
  const name = word && staticWordValue(word);
  if (!word || name === undefined) return;
  const res = resolveName(model, name, nameNode!, { ...resolveOpts(shell), quoted: word.type !== 'word' || word.text !== name });
  out.push({ from: word.startIndex, to: word.endIndex, kind: nameKind(res) });
  // A function's or an alias's words have no spec, and `test`'s are an expression (`-f`, `-eq` are its operators): the
  // tree's reading of them stays.
  const spec = res.kind === 'function' || res.kind === 'alias' || testSpecOf(res) ? undefined : lookupCommand(name);
  const args = fields(c, 'argument');
  if (!spec || !args.length) return;
  const parse = interpret(spec, args.map(argWordFor(shell)), { name, lookup: lookupCommand });
  // (Where each command it runs runs, read only when it runs one: `sudo ls`.)
  let envs: ReturnType<typeof slotEnvs> | undefined;
  roles(parse, spec, args, (w) => {
    // (A plain word, so it has a value; slotEnvs keys the first word of each command a slot runs.)
    const env = (envs ??= slotEnvs(model.env(c), parse, spec, args, lookupCommand, undefined, shell)).get(w)!;
    return nameKind(resolveName(model, staticWordValue(w)!, w, { ...resolveOpts(shell), env }));
  }, out, shell);
}

/**
 * Option words as options, a word that only looks like one as a plain argument, and the names of commands run by this
 * one (`spec` read `args` into `parse`).
 */
function roles(parse: ArgvParse, spec: CommandSpec | undefined, args: readonly SyntaxNode[], commandKind: (w: SyntaxNode) => HighlightKind, out: FactSpan[], shell: Shell | undefined): void {
  for (const { word, role } of parse.roles) {
    const w = args[word];
    switch (role.role) {
      case 'option': case 'cluster': case 'pattern-option': case 'unknown-option': case 'old-style': case 'open-option': case 'end-of-options': {
        // The option's own text (`--file` of `--file=x`, `-n` of `-n5`), not its attached value.
        const attached = role.role === 'option' ? role.value?.attached : undefined;
        const eq = attached !== undefined ? attached - (w.text[attached - 1] === '=' ? 1 : 0) : w.text.startsWith('--') && w.text.indexOf('=') > 0 ? w.text.indexOf('=') : w.text.length;
        if (w.type === 'word') out.push({ from: w.startIndex, to: w.startIndex + Math.max(1, eq), kind: 'option' });
        break;
      }
      case 'operand': case 'value':
        if (w.type === 'word' && /^-./.test(w.text) && !(role.role === 'value' && role.attached !== undefined)) out.push({ from: w.startIndex, to: w.endIndex, kind: 'argument' });
        break;
      case 'command':
        // The name of a command another one runs (`sudo ls`, `xargs rm`): to bash an argument, to the reader a command.
        if (role.name !== undefined && w.type === 'word') out.push({ from: w.startIndex, to: w.endIndex, kind: commandKind(w) });
        if (role.parse) roles(role.parse, role.spec, args, commandKind, out, shell);
        break;
      case 'subcommand':
        if (role.parse) roles(role.parse, role.spec, args, commandKind, out, shell);
        break;
      case 'expression': {
        // find's expression, read by its own spec from its first word: its tests' values (`-name -x`) and the commands
        // of its actions (`-exec rm -f {} +`).
        if (word !== parse.expression || !spec?.expressionSpec) break;
        const rest = args.slice(word, parse.end);
        roles(interpret(spec.expressionSpec, rest.map(argWordFor(shell)), { name: parse.command, lookup: lookupCommand }), spec.expressionSpec, rest, commandKind, out, shell);
        break;
      }
      default:
        break;
    }
  }
}

/** A variable where it is expanded or set: readonly, exported, from the state there (when the model trusts it). */
function variable(n: SyntaxNode, model: StateModel, out: FactSpan[]): void {
  const owner = n.parent!.type === 'subscript' ? n.parent!.parent! : n.parent!;
  if (owner.type !== 'simple_expansion' && owner.type !== 'expansion' && owner.type !== 'variable_assignment') return;
  if (!model.trusts(n.text)) return;
  const attrs = model.at(owner).run.variables.get(n.text)?.attrs;
  const modifiers: HighlightModifier[] = [];
  if (attrs?.r?.state === 'on') modifiers.push('readonly');
  if (attrs?.x?.state === 'on') modifiers.push('exported');
  // (`$x` whole, as one token; the name only in `${x:-y}` and `x=1`.)
  const span = owner.type === 'simple_expansion' ? owner : n;
  if (modifiers.length) out.push({ from: span.startIndex, to: span.endIndex, modifiers });
}
