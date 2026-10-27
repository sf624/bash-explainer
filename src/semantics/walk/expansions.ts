// The expansions of the walk of the shell state (src/semantics/walk/walker.ts): the command and process substitutions
// in a statement's words, and what the words themselves change as bash expands them (`${x:=w}`, `$(( n = 3 ))`,
// `${x?}`), with the redirections made after them (`{fd}>file`).
import { descendants, field, redirectionsOf, type SyntaxNode } from '../../syntax/tree';
import { STATEMENTS } from '../env';
import { merge, option, type ShellState, type Tri, withoutErrexitWhy } from '../shellstate';
import { ArithError, ExpansionError, numberOfLengths, SUBSTITUTIONS } from './shared';
import type { Walker } from './walker';

/** Where an expression is arithmetic: an arithmetic expansion in it is run with the expression. */
const ARITH_HOSTS = ['arithmetic_expansion', 'arithmetic_command', 'c_style_for_statement'];

/** The expansions of the words of a statement, for the walk. */
export class WalkExpansions {
  constructor(private readonly w: Walker) {}

  /**
   * The state a command substitution `c` starts with: bash turns `set -e` off in it, unless inherit_errexit is on
   * (POSIX mode turns it on). It says why (`errexitWhy`) when errexit is on or unknown around it.
   */
  private substitutionState(c: SyntaxNode, st: ShellState): ShellState {
    if (c.type !== 'command_substitution' || !this.w.bash) return st;
    const rest = withoutErrexitWhy(st);
    const errexit = option(st, 'set', 'errexit');
    if (errexit === 'off' || errexit === 'default') return rest;
    const inherit = option(st, 'shopt', 'inherit_errexit');
    if (inherit === 'on') return { ...rest, errexitWhy: option(st, 'set', 'posix') === 'on' ? 'posix' : 'inherit_errexit' };
    return { ...rest, set: st.set.with('errexit', inherit === 'unknown' ? 'unknown' : 'off'), errexitWhy: 'off-in-substitution' };
  }

  /** Walks the command and process substitutions in `n` (not those of statements under it): each is a subshell. */
  substitutions(n: SyntaxNode, st: ShellState): void {
    const sub = (c: SyntaxNode): void => {
      this.w.record(c, st);
      // A command substitution is read again when it runs: its aliases are those of the state then.
      const outer = this.w.expand;
      if (c.type === 'command_substitution') this.w.expand = st;
      this.w.targets.push({ kind: 'subshell' });
      try {
        this.w.sequence(c.children, this.substitutionState(c, st));
      } finally {
        this.w.targets.pop();
        this.w.expand = outer;
      }
    };
    const visit = (x: SyntaxNode): void => {
      for (const c of x.children) {
        if (SUBSTITUTIONS.includes(c.type)) sub(c);
        else if (!STATEMENTS.has(c.type)) visit(c);
      }
    };
    if (SUBSTITUTIONS.includes(n.type)) sub(n);
    else visit(n);
  }

  /**
   * `${x:=word}` and `${x=word}` in the words of `n` set `x` (to a value not known here); an arithmetic expansion
   * runs its assignments (`$(( n = 3 ))`), unless it is in an arithmetic expression, which runs it. Some run only
   * when bash gets to them, so what they assign may be: in an operand of `${…}` (`${s:$(( k = 1 ))}`), on the right
   * of `&&` or `||` in `[[ ]]`. The redirections of a program are expanded in its own process (`program`: whether
   * `n` is one of them). An error in an arithmetic expansion discards the rest of the command (`ExpansionError`).
   */
  defaults(n: SyntaxNode, st: ShellState, program: Tri = 'off'): ShellState {
    let found = descendants(n, ['expansion', 'arithmetic_expansion']);
    // An assignment expands its value before its subscript (`a[$(( i++ ))]=$(( j = i ))` gives j=0; not with `declare`).
    const value = n.type === 'variable_assignment' && n.field !== 'argument' ? field(n, 'value') : undefined;
    if (value) {
      const inValue = (e: SyntaxNode): boolean => e.startIndex >= value.startIndex && e.endIndex <= value.endIndex;
      found = [...found.filter(inValue), ...found.filter((e) => !inValue(e))];
    }
    for (const e of found) {
      let skip = false;
      let maybe = false;
      for (let x = e; x !== n; x = x.parent!) {
        const up = x.parent!;
        if (SUBSTITUTIONS.includes(up.type) || (e.type === 'arithmetic_expansion' && ARITH_HOSTS.includes(up.type))) skip = true;
        // (The word of `${y:-w}` is expanded only when `y` is not set or empty, of `${y:+w}` only when it is, and so on.)
        const operand = up.type !== 'expansion' ? 'on' : e.type === 'arithmetic_expansion' ? 'unknown' : x === up.namedChildren[0] ? 'on' : this.w.conditions.operandRuns(up, st);
        if (operand === 'off') skip = true;
        if (operand === 'unknown' || (up.type === 'binary_expression' && x.field === 'right' && ['&&', '||'].includes(field(up, 'operator')!.type))) maybe = true;
      }
      if (skip || program === 'on') continue;
      if (program === 'unknown') maybe = true;
      let after: ShellState;
      if (e.type === 'arithmetic_expansion') {
        // (Whether it read values decisions do not trust: see `markAssumed`.)
        const assumed = this.w.assumed;
        this.w.assumed = false;
        try {
          const r = this.w.arith.arithScript(e.namedChildren, st);
          after = r.st;
          // (A value not known may come from an error: a division by 0, text that is no expression.)
          if ((r.value === undefined || this.w.arith.unsure) && !numberOfLengths(e)) this.w.abort(st, false);
        } catch (err) {
          /* c8 ignore next -- only an arithmetic error is thrown on purpose */
          if (!(err instanceof ArithError)) throw err;
          const posix = this.w.builtins.posixMode(st);
          throw new ExpansionError(maybe ? merge([st, err.st], this.w.posix) : err.st, !maybe && !this.w.assumed && posix !== 'unknown', posix !== 'off');
        } finally {
          this.w.assumed ||= assumed;
        }
      } else {
        this.unsetError(e, st, maybe);
        this.w.builtins.expansionFails(e, st);
        after = this.w.builtins.checkedSet(this.defaultOf(e, st), e);
      }
      st = maybe && after !== st ? merge([st, after], this.w.posix) : after;
    }
    return st;
  }

  /**
   * `${x?word}` of an unset `x` (`${x:?word}`: or empty) ends the shell (bash: "parameter null or not set"), when the
   * state knows it is so; when that is not sure (a value decisions do not trust, a word that may not be expanded),
   * the shell may end there.
   */
  private unsetError(e: SyntaxNode, st: ShellState, maybe: boolean): void {
    const name = e.namedChildren[0];
    const colon = e.children.some((c) => c.type === ':?');
    if (name?.type !== 'variable_name' || !(colon || e.children.some((c) => c.type === '?'))) return;
    const target = this.w.builtins.resolve(st, name.text);
    const v = target === undefined ? undefined : st.variables.get(target);
    if (!v || !(v.set === 'off' || (colon && v.set === 'on' && v.value === '')) || v.declared === 'unknown') return;
    if (!maybe && this.w.trust.variable(name.text) && this.w.trust.variable(target!)) throw new ExpansionError(st, true, true);
    this.w.jump('shell', undefined, st, false);
  }

  /** `${x:=word}` sets `x`. */
  private defaultOf(e: SyntaxNode, st: ShellState): ShellState {
    const name = e.namedChildren[0];
    if (!e.children.some((c) => c.type === ':=' || c.type === '=') || name?.type !== 'variable_name') return st;
    // (A variable the script has not set keeps a value from the environment.)
    const prev = st.variables.get(name.text);
    return this.w.builtins.setVariable(st, name.text, e, undefined, false, false, undefined, !prev || !!prev.kept);
  }

  /** `defaults` of each of `nodes`, in turn. */
  expandAll(nodes: readonly SyntaxNode[], st: ShellState, program: Tri = 'off'): ShellState {
    for (const r of nodes) st = this.defaults(r, st, program);
    return st;
  }

  /** The redirections of the simple command `n`, made after its words are expanded (`program`: in a process of its own). */
  redirections(n: SyntaxNode, st: ShellState, program: Tri): ShellState {
    const all = redirectionsOf(n);
    return this.fdVariables(all, this.expandAll(all, st, program));
  }

  /**
   * `{name}>file` puts the number of the fd it opens in `name`: set, to a value not known here (may be: a program makes
   * its redirections in its own process).
   */
  fdVariables(redirects: readonly SyntaxNode[], st: ShellState): ShellState {
    for (const r of redirects) {
      const name = /^\{([A-Za-z_]\w*)\}$/.exec(field(r, 'descriptor')?.text ?? '')?.[1];
      if (name) st = merge([st, this.w.builtins.setVariable(st, name, r, undefined)], this.w.posix);
    }
    return st;
  }
}
