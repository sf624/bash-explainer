// The aliases of the walk of the shell state (src/semantics/walk/walker.ts): the `alias` commands of the script, and
// a command whose name is an alias, which runs the alias's text with the rest of the command, read again. The trees of
// those texts are the model's (`Scripts.expansion`): the trust scan reads the same ones (src/semantics/trust.ts).
import { fields, type SyntaxNode } from '../../syntax/tree';
import { aliasName, aliasOf, commandName } from '../effects';
import { type AliasState, merge, option, type ShellState, withStatus } from '../shellstate';
import type { Walker } from './walker';

/** The aliases the walk expands, and the `alias` commands that define them. */
export class WalkAliases {
  constructor(private readonly w: Walker) {}

  /** The `alias` commands that define each name, in the trees the walk reads. */
  readonly defs = new Map<string, SyntaxNode[]>();
  /** The aliases being expanded (an alias is not expanded again inside itself). */
  private readonly expanding = new Set<string>();

  /** Records the `alias` commands among `nodes`. */
  collect(nodes: readonly SyntaxNode[]): void {
    for (const c of nodes) {
      if (c.type !== 'command' || commandName(c) !== 'alias') continue;
      for (const a of fields(c, 'argument')) {
        const name = aliasOf(a)?.name;
        const defs = name ? this.defs.get(name) ?? [] : [];
        if (name && !defs.includes(c)) this.defs.set(name, [...defs, c]);
      }
    }
  }

  /**
   * The alias `name` as something the script may have changed unseen (`Walker.widen`): `a`, its state in `st`, as not
   * known; or, when `st` has none, the last `alias` command of the name, as one that may have run. Undefined when it
   * is already so, or no command defines it.
   */
  unknown(name: string, a: AliasState | undefined): AliasState | undefined {
    if (a) return a.state !== 'unknown' ? { ...a, state: 'unknown' } : undefined;
    const defs = this.defs.get(name);
    const def = defs?.[defs.length - 1];
    const value = def ? fields(def, 'argument').map(aliasOf).find((x) => x?.name === name)?.value : undefined;
    return def && value !== undefined ? { state: 'unknown', value, at: def } : undefined;
  }

  /**
   * The state after the simple command `n`, run from `st` once its words are expanded, when its name is an alias that
   * may be expanded (in the state its aliases come from, `Walker.expand`): the alias's text, then the rest of the
   * command, read and run instead. Undefined otherwise.
   */
  expand(n: SyntaxNode, st: ShellState): ShellState | undefined {
    const name = aliasName(n);
    const from = this.w.expand;
    const alias = name !== undefined && !this.expanding.has(name) ? from.aliases.get(name) : undefined;
    const expands = !this.w.bash ? 'on' : option(from, 'shopt', 'expand_aliases');
    if (!alias || alias.state === 'off' || !(expands === 'on' || expands === 'unknown')) return undefined;
    const root = this.w.scripts.expansion(n, alias.value);
    this.expanding.add(name!);
    const host = this.w.aliasHost;
    this.w.aliasHost ??= n;
    const after = this.w.sequence(root.children, st);
    this.w.aliasHost = host;
    this.expanding.delete(name!);
    return alias.state === 'on' && expands === 'on' ? after : merge([withStatus(st, undefined), after], this.w.posix);
  }
}
