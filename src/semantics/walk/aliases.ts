// The aliases of the walk of the shell state (src/semantics/walk/walker.ts): the `alias` commands of the script, and
// a command whose name is an alias, which runs the alias's text with the rest of the command, read again.
import { staticWordValue } from '../../staticword';
import { descendants, field, fields, type SyntaxNode, type SyntaxTree } from '../../syntax/tree';
import { commandName } from '../effects';
import { type AliasState, merge, option, type ShellState, withStatus } from '../shellstate';
import { parser } from './shared';
import type { Walker } from './walker';

/** Trees of alias texts, least recently used first; bounded, as a long-lived process (LSP, web) sees many texts. */
const aliasTrees = new Map<string, SyntaxTree>();
const ALIAS_TREES = 256;

/** `alias name=value` (or `'name=value'`): the name and what it stands for (static, or the text without its outer quotes). */
export function aliasOf(a: SyntaxNode): { name: string; value: string } | undefined {
  const v = staticWordValue(a);
  const text = v ?? a.text;
  const m = /^([\w.:@%+-]+)=(['"]?)([\s\S]*)\2$/.exec(text);
  if (!m) return undefined;
  return { name: m[1], value: v !== undefined ? v.slice(v.indexOf('=') + 1) : m[3] };
}

/** The aliases the walk expands, and the `alias` commands that define them. */
export class WalkAliases {
  constructor(private readonly w: Walker) {}

  /** The `alias` commands that define each name, in the trees the walk reads. */
  readonly defs = new Map<string, SyntaxNode[]>();
  /** The aliases being expanded (an alias is not expanded again inside itself). */
  private readonly expanding = new Set<string>();

  /** Records the `alias` commands under `root`. */
  collect(root: SyntaxNode): void {
    for (const c of descendants(root, ['command'])) {
      if (commandName(c) !== 'alias') continue;
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
   * The state after the simple command `n` named `name`, run from `st` once its words are expanded, when its name is
   * an alias that may be expanded (in the state its aliases come from, `Walker.expand`); undefined otherwise.
   */
  expand(n: SyntaxNode, name: string | undefined, st: ShellState): ShellState | undefined {
    const nameNode = field(n, 'name')!;
    const word = nameNode.namedChildren[0];
    const from = this.w.expand;
    const alias = name !== undefined && word.type === 'word' && word.text === name && !this.expanding.has(name) ? from.aliases.get(name) : undefined;
    const expands = !this.w.bash ? 'on' : option(from, 'shopt', 'expand_aliases');
    if (!alias || alias.state === 'off' || !(expands === 'on' || expands === 'unknown')) return undefined;
    // The alias's text, then the rest of the command, read and run instead.
    const tree = this.parseText(alias.value + n.text.slice(nameNode.endIndex - n.startIndex));
    this.expanding.add(name!);
    const host = this.w.aliasHost;
    this.w.aliasHost ??= n;
    const after = this.w.sequence(tree.root.children, st);
    this.w.aliasHost = host;
    this.expanding.delete(name!);
    return alias.state === 'on' && expands === 'on' ? after : merge([withStatus(st, undefined), after], this.w.posix);
  }

  private parseText(text: string): SyntaxTree {
    let tree = aliasTrees.get(text);
    if (tree) aliasTrees.delete(text);
    else {
      tree = parser().parse(text);
      if (aliasTrees.size >= ALIAS_TREES) aliasTrees.delete(aliasTrees.keys().next().value!);
    }
    aliasTrees.set(text, tree);
    return tree;
  }
}
