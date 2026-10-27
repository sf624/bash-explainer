// The expansions of the walk of the shell state (src/semantics/walk/walker.ts): the command and process substitutions
// in a statement's words, and what the words themselves change as bash expands them (`${x:=w}`, `$(( n = 3 ))`,
// `${x?}`), with the redirections made after them (`{fd}>file`).
import { descendants, field, redirectionsOf, substitutionForm, type SyntaxNode } from '../../syntax/tree';
import { STATEMENTS } from '../env';
import { merge, option, type ShellState, type Tri, type VariableState, withoutErrexitWhy } from '../shellstate';
import { ArithError, ExpansionError, type Frame, inShell, numberOfLengths, SUBSTITUTIONS, type Target } from './shared';
import type { Walker } from './walker';

/** Where an expression is arithmetic: an arithmetic expansion in it is run with the expression. */
const ARITH_HOSTS = ['arithmetic_expansion', 'arithmetic_command', 'c_style_for_statement'];

/**
 * Whether bash may not expand the substitution `c` of `n`: in the word of a parameter expansion (`${x:-$( )}`), on
 * the right of `&&` or `||` in `[[ ]]`.
 */
function mayNotExpand(c: SyntaxNode, n: SyntaxNode): boolean {
  for (let x = c; x !== n; x = x.parent!) {
    const up = x.parent!;
    if (up.type === 'expansion' && x !== up.namedChildren[0]) return true;
    if (up.type === 'binary_expression' && x.field === 'right' && ['&&', '||'].includes(field(up, 'operator')!.type)) return true;
  }
  return false;
}

/** What `${| …; }` gives from its `REPLY` at the end: an empty string when unset; undefined when not known (an array, a nameref). */
function replyText(v: VariableState): string | undefined {
  if (v.declared === 'unknown' || v.set === 'unknown' || ['a', 'A', 'n'].some((l) => (v.attrs[l]?.state ?? 'off') !== 'off')) return undefined;
  return v.set === 'off' ? '' : v.value;
}

/** The expansions of the words of a statement, for the walk. */
export class WalkExpansions {
  constructor(private readonly w: Walker) {}

  /** What each `${| …; }` gave on each walk (its `REPLY` at the end): undefined when not known. */
  readonly replies = new Map<SyntaxNode, (string | undefined)[]>();

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

  /**
   * Walks the command and process substitutions in `n` (not those of statements under it), in order, and gives the
   * state after them. `$( )`, backquotes and `<( )` are subshells, whose changes are dropped; bash 5.3's `${ …; }` and
   * `${| …; }` run in the shell itself (`inShell`), and the words of `n` after one are expanded in the state it leaves
   * (`following`). One bash may not expand (`maybe`, or in the word of `${x:-…}`, on the right of `&&` in `[[ ]]`)
   * may change the state or not.
   */
  substitutions(n: SyntaxNode, st: ShellState, maybe = false, skip: readonly SyntaxNode[] = []): ShellState {
    const before = st;
    const ran: { c: SyntaxNode; before: ShellState; after: ShellState }[] = [];
    const sub = (c: SyntaxNode): void => {
      this.w.record(c, st);
      // A command substitution is read again when it runs: its aliases are those of the state then.
      const outer = this.w.expand;
      if (c.type === 'command_substitution') this.w.expand = st;
      try {
        if (inShell(c)) {
          this.w.statement.before ??= st;
          const after = this.inShell(c, st);
          const next = maybe || mayNotExpand(c, n) ? merge([st, after], this.w.posix) : after;
          ran.push({ c, before: st, after: next });
          st = next;
          return;
        }
        this.w.targets.push({ kind: 'subshell' });
        try {
          this.w.sequence(c.children, this.substitutionState(c, st));
        } finally {
          this.w.targets.pop();
        }
      } finally {
        this.w.expand = outer;
      }
    };
    const visit = (x: SyntaxNode): void => {
      for (const c of x.children) {
        if (skip.includes(c)) continue;
        if (SUBSTITUTIONS.includes(c.type)) sub(c);
        else if (!STATEMENTS.has(c.type)) visit(c);
      }
    };
    if (SUBSTITUTIONS.includes(n.type)) sub(n);
    else visit(n);
    if (ran.length && st !== before) this.following(n, ran);
    return st;
  }

  /**
   * `st`, or with a `${ …; }` in the words of the statement being run, the state before it too: bash expands the words
   * in order, so an error or `exit` in a word before it leaves the shell as it was then (`Walker.jump`, `Walker.abort`).
   */
  beforeWords(st: ShellState): ShellState {
    const { before } = this.w.statement;
    return before ? merge([before, st], this.w.posix) : st;
  }

  /**
   * The words of `n` after a `${ …; }` (`ran`, in order) are expanded in the state it leaves: each word that starts
   * after one gets the state after the last of those, as its run state (`StateModel.at`); a word that holds one, the
   * states before and after it, merged (what it reads may come before or after it).
   */
  private following(n: SyntaxNode, ran: readonly { c: SyntaxNode; before: ShellState; after: ShellState }[]): void {
    // (Not the statements of a substitution that is `n` itself: `case ${ …; } in`.)
    for (const word of n.namedChildren.filter((x) => !STATEMENTS.has(x.type))) {
      const inside = ran.filter((r) => r.c.startIndex >= word.startIndex && r.c.endIndex <= word.endIndex);
      const done = ran.filter((r) => r.c.endIndex <= word.startIndex).pop();
      if (inside.length) this.w.record(word, merge([done?.after ?? inside[0].before, ...inside.map((r) => r.after)], this.w.posix));
      else if (done) this.w.record(word, done.after);
    }
  }

  /**
   * Runs the `${ …; }` or `${| …; }` `c` from `st`, in the shell itself, and gives the state after it (bash 5.3;
   * docs/design/bash-versions.md, 4.1). It is a scope of its own, as a function body is: `local` and `declare` make
   * locals, `local -` local options, and `return` ends it; so does an error in an expansion. `${| }` makes `REPLY`
   * local, unset at the start: its value at the end is what the substitution gives (`replies`). bash turns
   * errexit off in it unless inherit_errexit is on (`substitutionState`), and gives it back as it was after it.
   */
  private inShell(c: SyntaxNode, st: ShellState): ShellState {
    const reply = substitutionForm(c) === '${|';
    const frame: Frame = { def: c, saved: new Map() };
    // (Checked with bash 5.3 only: in a ksh93 or mksh script, the walk follows it as bash does, and nothing is trusted.)
    if (!this.w.bash && !this.w.blind) this.w.walkAgain('a `${ …; }` substitution, which the walk follows only as bash 5.3 runs it');
    const inherit = option(st, 'shopt', 'inherit_errexit');
    // (What it gives back as it ends: with inherit_errexit, errexit as it leaves it; else as it was.)
    const leave = (end: ShellState): ShellState => {
      const out = { ...withoutErrexitWhy(this.w.leaveFrame(frame, end)), ...(st.errexitWhy ? { errexitWhy: st.errexitWhy } : {}) };
      const kept = { ...out, set: out.set.with('errexit', st.set.get('errexit')) };
      return inherit === 'on' ? out : inherit === 'unknown' ? merge([out, kept], this.w.posix) : kept;
    };
    const target: Extract<Target, { kind: 'substitution' }> = { kind: 'substitution', dead: this.w.mode.dead, returns: [], aborts: [], maybes: [], jumps: [] };
    let entry = this.substitutionState(c, st);
    this.w.frames.push(frame);
    this.w.targets.push(target);
    let end: ShellState;
    try {
      if (reply) {
        frame.saved.set('REPLY', entry.variables.get('REPLY'));
        entry = this.w.put(entry, 'variables', 'REPLY', { declared: 'on', set: 'off', attrs: {}, at: c });
      }
      end = this.w.sequence(c.children, entry);
    } finally {
      this.w.targets.pop();
      this.w.frames.pop();
    }
    // (Its status is its last command's, or the one `return` gives.)
    end = merge([end, ...target.returns, ...target.aborts, ...target.maybes], this.w.posix);
    this.w.statement.deferred.push(...target.jumps.map((j) => ({ ...j, st: leave(j.st) })));
    if (reply && !this.w.silent) this.replies.set(c, [...(this.replies.get(c) ?? []), replyText(end.variables.get('REPLY')!)]);
    return leave(end);
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

  /**
   * The substitutions of `redirects`, the redirections of a simple command, from `st`. A program makes them in its own
   * process (`program`), after the fork: what a `${ …; }` there changes is lost, and `exit` there ends only that process.
   */
  redirectSubstitutions(redirects: readonly SyntaxNode[], st: ShellState, program: Tri): ShellState {
    const all = (s: ShellState): ShellState => redirects.reduce((x, r) => this.substitutions(r, x), s);
    if (program === 'off') return all(st);
    this.w.targets.push({ kind: program === 'on' ? 'subshell' : 'maybe' });
    try {
      const after = all(st);
      return program === 'on' ? st : merge([st, after], this.w.posix);
    } finally {
      this.w.targets.pop();
    }
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
