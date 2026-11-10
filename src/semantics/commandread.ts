// How a simple command reads its words (docs/design/known-values.md, section 3; a slice of stage SC2's `commandRead(n)`,
// docs/design/sources.md): the spec of what its name runs (src/semantics/commandhead.ts), and the argument interpreter's
// parse of its words as the model knows them (`argWordIn`), with the words a program reads as an option only alone read as
// their environment makes them (`soleRead`). It is kept for the model and the lookup's inputs, so the line that explains
// the command and any other that asks read the same reading.
import { type ArgRole, type ArgvParse, interpret, swapRoles } from '../argv/interpret';
import type { CommandSpec } from '../argv/spec';
import type { SyntaxNode } from '../syntax/tree';
import { field } from '../syntax/tree';
import { argWordIn } from './argwords';
import { type CommandLookup, headFacts, type HeadFacts, NO_SPEC, specIn } from './commandhead';
import { type ExecEnv, slotEnvs, variableIn } from './env';
import type { StateModel } from './state';

/**
 * Words read by a spec: the spec (none for a function's words), the parse, and where each command a slot of it runs
 * runs (`slotEnvs`, by its first word).
 */
export interface ArgsReading { readonly spec: CommandSpec; readonly parse: ArgvParse; readonly envs: ReadonlyMap<SyntaxNode, ExecEnv> }

/** A simple command as it reads its words: what its name runs (`head`), its words after the name (`args`), and their reading. */
export interface CommandReading extends ArgsReading { readonly head: HeadFacts; readonly args: readonly SyntaxNode[] }

/**
 * The words `args` of the command `cmdName` read with `known`, its spec (none for a function, `isFn`: its options are
 * unknown, and its operands are `$1`, `$2`…), as the model knows them where they run.
 */
export function argsReading(model: StateModel, lookup: CommandLookup, known: CommandSpec | undefined, args: readonly SyntaxNode[], cmdName: string, isFn: boolean | 'maybe' = false): ArgsReading {
  const spec = known && !isFn ? known : NO_SPEC;
  const look = (name: string): CommandSpec | undefined => specIn(lookup, name);
  const parse = interpret(spec, args.map(argWordIn(model)), { name: cmdName, lookup: look });
  if (!args.length) return { spec, parse, envs: new Map() };
  const parses = new Map<ArgvParse, ExecEnv>();
  const envs = slotEnvs(model.env(args[0].parent!), parse, spec, args, model.shell, look, undefined, parses);
  // (`POSIXLY_CORRECT=1 /bin/echo --version`: a word the program reads as an option only alone is text.)
  return { spec, parse: soleRead(model, parse, parses, args[0].parent!), envs };
}

/** The words of the simple command `n` after its name `nameNode`: not the assignments before it, nor the redirections. */
export function commandArgs(n: SyntaxNode, nameNode: SyntaxNode): SyntaxNode[] {
  const args: SyntaxNode[] = [];
  let seenName = false;
  for (const c of n.children) {
    if (c === nameNode) { seenName = true; continue; }
    if (c.type.endsWith('redirect') || (!seenName && c.type === 'variable_assignment')) continue;
    if (c.named) args.push(c);
  }
  return args;
}

const kept = new WeakMap<StateModel, Map<string, WeakMap<SyntaxNode, CommandReading>>>();
/**
 * A key of the inputs of `lookup`, by content, as src/explain/whole.ts keys the settings of a walk: a caller that makes
 * them afresh for each call reads the same reading. The host's commands by their names, as `shellState` keys the model
 * (the names stand for the specs of src/dict/bats.ts).
 */
export function lookupKey(lookup: CommandLookup): string {
  return JSON.stringify([lookup.customCommands, Object.keys(lookup.hostCommands ?? {}).sort(), lookup.yq.host, lookup.yq.setting, lookup.bashVersion]);
}

/**
 * How the simple command `cmd` (a `command` node with a name) reads its words: the spec of what its name runs, and the
 * parse of its words. Kept for the model and the lookup's inputs.
 */
export function commandReading(cmd: SyntaxNode, model: StateModel, lookup: CommandLookup): CommandReading {
  let byKey = kept.get(model);
  if (!byKey) kept.set(model, (byKey = new Map()));
  const key = lookupKey(lookup);
  let byNode = byKey.get(key);
  if (!byNode) byKey.set(key, (byNode = new WeakMap()));
  let reading = byNode.get(cmd);
  if (!reading) byNode.set(cmd, (reading = readCommand(cmd, model, lookup)));
  return reading;
}

function readCommand(cmd: SyntaxNode, model: StateModel, lookup: CommandLookup): CommandReading {
  const nameNode = field(cmd, 'name')!;
  const args = commandArgs(cmd, nameNode);
  const head = headFacts(model, lookup, cmd, nameNode, args);
  return { head, args, ...argsReading(model, lookup, head.spec, args, head.unnamed ? '' : head.runs ?? head.name, head.fn) };
}

/**
 * `parse` (of the command `cmd`) with each word read as one of `soleOptions` (coreutils `echo --version`) as the
 * model knows it where its command runs (`envs`, from `slotEnvs`): with the variable of `soleUnlessEnv` surely in
 * that environment, text, which says why; surely not, the option; else the option, with the caveat.
 */
export function soleRead(model: StateModel, parse: ArgvParse, envs: ReadonlyMap<ArgvParse, ExecEnv>, cmd: SyntaxNode): ArgvParse {
  const swap = new Map<ArgRole, ArgRole>();
  for (const [p, env] of envs) {
    if (!p.sole) continue;
    const { option, env: name } = p.sole;
    const { state } = variableIn(model, cmd, name, env);
    if (state === 'off') continue;
    if (state === 'unknown') {
      swap.set(option, { ...option, text: { ja: `${option.text.ja}（環境に \`${name}\` があると、ただの文字列）`, en: `${option.text.en} (plain text if \`${name}\` is in the environment)` } });
      continue;
    }
    // (echo's words are operands of its spec.)
    const text = p.sole.text as Extract<ArgRole, { role: 'operand' }>;
    const t = text.spec!.text;
    swap.set(option, { ...text, spec: { ...text.spec!, text: { ja: `${t.ja}（環境に \`${name}\` があるので、\`${option.flag}\` はオプションではない）`, en: `${t.en} (\`${name}\` is in its environment, so \`${option.flag}\` is no option)` } } });
  }
  return swap.size ? swapRoles(parse, swap) : parse;
}
