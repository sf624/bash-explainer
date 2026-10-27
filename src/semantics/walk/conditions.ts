// The conditions of the walk of the shell state (src/semantics/walk/walker.ts): the status of a statement when it is
// known (`[ ]`, `[[ ]]`, `true`, `(( ))`, assignments), the lists of a `case` that run, and what each condition decided.
import type { Shell } from '../../dialect';
import { evalArith } from '../../arith';
import { parseExpansion } from '../../expansion';
import { staticWordValue, substitutionNames } from '../../staticword';
import { assignmentsOnly, descendants, field, fields, prefixAssignments, substitutionForm, type SyntaxNode } from '../../syntax/tree';
import { compareIntegers, patternMatches, plainRegex, testStatus, type TestEnv, unaryTest } from '../conditions';
import { attribute, EMPTY, merge, option, type ShellState, type Tri, withStatus } from '../shellstate';
import type { Decision } from '../state';
import { actedNames, namespaceOf } from '../../argv/query';
import { builtins } from '../../dict/builtins';
import { builtinRow, type Row } from '../allow';
import { builtinParse, callbacks, commandName } from '../effects';
import { writeEffect } from '../vars';
import { testSpec } from '../names';
import { type WalkSource, wordIn } from '../words';
import { redirectionMayFail, safeRedirect } from '../redirects';
import { ArithError, changesWords, NAME, SUBSTITUTIONS } from './shared';
import type { Walker } from './walker';

const INTEGER_TESTS = new Set(['-eq', '-ne', '-lt', '-le', '-gt', '-ge']);

/** The parts of a word that expand to text not written in it. */
const EXPANDING = ['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution'];

/**
 * Whether the simple command `c` (with a static name, `name`) changes no more than variables, by the rows of the
 * allow-list (src/semantics/allow.ts): the builtin's, and that of each variable it assigns, `none` or `names`; and no
 * callback (`complete -F f`). A `followed` row is a construct the walk follows in order (`shopt`, `eval`, `declare`),
 * which a decision made before it runs does not see. (A row of `all`, also one of an option, `jobs -x`, trusts
 * nothing: no decision is made at all.) A program changes nothing of this shell.
 */
function changesOnlyNames(c: SyntaxNode, name: string, shell: Shell | undefined): boolean {
  const quiet = (row: Row): boolean => row.effect.kind === 'none' || row.effect.kind === 'names';
  if (!prefixAssignments(c).every((a) => quiet(writeEffect(field(a, 'name')!.text)))) return false;
  if (!Object.hasOwn(builtins, name)) return true;
  const args = fields(c, 'argument');
  const parse = builtinParse(name, args, shell);
  return quiet(builtinRow(name)) && callbacks(parse, args).length === 0;
}

/** What the walk decides of its conditions, and the values they read (src/semantics/words.ts evaluates their words). */
export class WalkConditions {
  constructor(private readonly w: Walker) {}

  /** What each condition decided on each walk ('?': nothing), and the variables it read (`mixed`: with other values on other walks). */
  private readonly decisions = new Map<SyntaxNode, { outcomes: Set<string>; reads: Map<string, string | null>; mixed: boolean }>();
  /** The variables read by the conditions being decided, with their values (see `variableText`). */
  readonly reading: Map<string, string | null>[] = [];

  /** Runs `run` (a condition), with the variables it reads. */
  reads<T>(run: () => T): { value: T; reads: Map<string, string | null> } {
    const reads = new Map<string, string | null>();
    this.reading.push(reads);
    try {
      return { value: run(), reads };
    } finally {
      this.reading.pop();
    }
  }

  /**
   * What a command with the redirections `redirects` leaves: `ran`, or when one of them may fail, maybe `unrun`, the
   * state after them, with status 1 (bash runs no command after a redirection that fails). Under `set -e` (surely on,
   * and not ignored there: see `Walker.quietly`), that ends the shell (the subshell): what comes after runs only when
   * the command ran.
   */
  mayNotRun(redirects: readonly SyntaxNode[], unrun: ShellState, ran: ShellState): ShellState {
    if (!redirects.some((r) => redirectionMayFail(r, this.w.trust.fdsMayClose))) return ran;
    if (!this.w.mode.quiet && option(unrun, 'set', 'errexit') === 'on' && this.w.jump('shell', undefined, withStatus(unrun, 1)).unreachable) return ran;
    return merge([withStatus(unrun, 1), ran], this.w.posix);
  }

  /** Whether the redirection `r` cannot fail (`safeRedirect`), with what the script may close. */
  private safe(r: SyntaxNode): boolean {
    return safeRedirect(r, this.w.trust.fdsMayClose);
  }

  /** Records what the condition of `n` decided on this walk (undefined: nothing), with what it read. */
  decide(n: SyntaxNode, outcome: string | undefined, reads: ReadonlyMap<string, string | null>): void {
    if (this.w.mode.dead) return;
    let d = this.decisions.get(n);
    if (!d) this.decisions.set(n, (d = { outcomes: new Set(), reads: new Map(), mixed: false }));
    d.outcomes.add(outcome ?? '?');
    for (const [k, v] of reads) {
      if (d.reads.has(k) && d.reads.get(k) !== v) d.mixed = true;
      d.reads.set(k, v);
    }
  }

  /** What the condition of `n` decided on every walk, if anything; `reads` is empty when its values differed between walks. */
  decision(n: SyntaxNode): Decision | undefined {
    const d = this.decisions.get(n);
    if (!d || d.outcomes.size !== 1 || d.outcomes.has('?') || !this.w.everywhere(n)) return undefined;
    return { outcome: [...d.outcomes][0], reads: d.mixed ? new Map() : d.reads };
  }

  /**
   * The status of the simple command `n` run from `st`, when known: `true`, `:` and `false` (also as the value of a
   * variable: `$debug`), `test`. Not with prefix assignments (one may fail), a redirection that may fail, a word
   * whose value is not known (its expansion may fail), or a `${ …; }`, which changes what the words after it read.
   */
  simpleStatus(n: SyntaxNode, st: ShellState): number | undefined {
    if (!this.w.bash || prefixAssignments(n).length || !fields(n, 'redirect').every((r) => this.safe(r)) || changesWords(n)) return undefined;
    const name = wordIn(field(n, 'name')!.namedChildren[0], st, this.values(st), 'fields', this.ifsFollowed(st));
    // (The walk builds the state that `resolveName` reads (src/semantics/names.ts), so it cannot ask it: it looks at
    // the functions and the `enable -n` of `st` itself. An alias does not get here: the walk runs its text instead,
    // `WalkAliases.expand`.)
    if (name?.length !== 1 || st.functions.get(name[0]) || st.disabled.get(name[0])) return undefined;
    const args = fields(n, 'argument');
    // (`test` and `[`, the builtins: their specs, src/semantics/names.ts.)
    const test = testSpec(name[0], false);
    if (test) return this.testCommand(args, st, test.closingOperand);
    if (name[0] === 'unset') return this.unsetStatus(args, st);
    if (!['true', 'false', ':'].includes(name[0]) || args.some((a) => !wordIn(a, st, this.values(st), 'fields', this.ifsFollowed(st)))) return undefined;
    return name[0] === 'false' ? 1 : 0;
  }

  /**
   * The status of `unset` with the words `args` (static names of variables): 1 when one of them is read-only (bash
   * says `cannot unset: readonly variable`, and unsets the others), or with both `-f` and `-v`; else 0. Undefined
   * when it is not known here (a word not known, an element, `-f`, a variable read-only on some paths only).
   */
  private unsetStatus(args: readonly SyntaxNode[], st: ShellState): number | undefined {
    const parse = builtinParse('unset', args, this.w.shell);
    const space = namespaceOf(parse, builtins.unset.operands![0].pattern[0]);
    if (space === 'none') return 1;
    if (space === 'function') return undefined;
    let status = 0;
    for (const { word } of actedNames(parse)) {
      const name = staticWordValue(args[word]);
      const target = name !== undefined && NAME.test(name) ? (space === 'nameref' ? name : this.w.builtins.resolve(st, name)) : undefined;
      const readonly = target === undefined ? 'unknown' : attribute(st, target, 'r');
      if (readonly === 'unknown') return undefined;
      if (readonly === 'on') status = 1;
    }
    return status;
  }

  /**
   * The status of assignments alone (`x=1`, `assignments` of `n`) run from `st`: 0, when none of them can fail (no
   * `$( )`, whose status it would be; no readonly or integer target, no `${x?}`, no expansion under `set -u`).
   */
  private assignmentStatus(n: SyntaxNode, assignments: readonly SyntaxNode[], st: ShellState): number | undefined {
    if (descendants(n, SUBSTITUTIONS).length || descendants(n, ['expansion']).some((e) => e.children.some((c) => c.type === '?' || c.type === ':?'))) return undefined;
    const nounset = option(st, 'set', 'nounset');
    if (nounset !== 'off' && nounset !== 'default' && descendants(n, ['simple_expansion', 'expansion']).length) return undefined;
    for (const a of assignments) {
      const name = field(a, 'name')!.text;
      const target = NAME.test(name) ? this.w.builtins.resolve(st, name) : undefined;
      if (!target || attribute(st, target, 'r') !== 'off') return undefined;
      // (An integer runs its text: only a constant surely gives a number, `OPTIND=1`.)
      const value = field(a, 'value');
      if (attribute(st, target, 'i') !== 'off' && (!value || evalArith(this.staticText(value, st, true) ?? '') === undefined)) return undefined;
    }
    return 0;
  }

  /**
   * The status of the statement `n`, run from `st` and leaving `after`, when known (docs/design/semantics.md, 4.14).
   * Simple commands, `(( ))`, lists, `if`, `case` and pipelines set it themselves; a sequence of statements gives its
   * last one's (see `sequence`).
   */
  statusOf(n: SyntaxNode, st: ShellState, after: ShellState): number | undefined {
    if (assignmentsOnly(n)) return fields(n, 'redirect').every((r) => this.safe(r)) ? this.assignmentStatus(n, prefixAssignments(n), st) : undefined;
    switch (n.type) {
      case 'command': case 'arithmetic_command': case 'list': case 'if_statement': case 'case_statement': case 'pipeline':
      case 'compound_statement': case 'subshell': case 'time_statement':
        return after.status;
      case 'negated_command': return after.status === undefined ? undefined : Number(after.status === 0);
      case 'redirected_statement': return fields(n, 'redirect').every((r) => this.safe(r)) ? after.status : undefined;
      case 'extended_test': {
        const v = this.w.bash && n.namedChildren.length === 1 && !changesWords(n) ? this.condExpr(n.namedChildren[0], st) : undefined;
        return v === undefined ? undefined : Number(!v);
      }
    }
    return undefined;
  }

  /** `(( ))` or the condition of `for (( ))` (`nodes`) run from `st`: the state after it, and its status when known. */
  arithStatus(nodes: readonly SyntaxNode[], st: ShellState, unsure = false): { st: ShellState; status?: number } {
    this.w.assumed = false;
    try {
      const r = this.w.arith.arithScript(nodes, st, unsure);
      // (Not when it read what it is unsure of, or a name the script has not set: see `variableText`; nor in a shell
      // other than bash, where `(( ))` may not be arithmetic.)
      return { st: r.st, status: !this.w.bash || r.value === undefined || this.w.arith.unsure || this.w.assumed ? undefined : Number(r.value === 0n) };
    } catch (e) {
      if (e instanceof ArithError) return { st: e.st };
      /* c8 ignore next -- only an arithmetic error is thrown on purpose */
      throw e;
    }
  }

  /**
   * The status of `test` or `[` with the words `words`, run from `st`, when their values are known. `closer`: the
   * last word `[` wants (`]`), without which it fails (`[: missing ']'`, status 2).
   */
  private testCommand(words: readonly SyntaxNode[], st: ShellState, closer: string | undefined): number | undefined {
    const args: string[] = [];
    for (const w of words) {
      const f = wordIn(w, st, this.values(st), 'fields', this.ifsFollowed(st));
      if (!f) return undefined;
      args.push(...f);
    }
    if (closer && args.pop() !== closer) return 2;
    return testStatus(args, this.testEnv(st));
  }

  /** The options of `st`, for the decisions of src/semantics/conditions.ts. */
  private testEnv(st: ShellState): TestEnv {
    return {
      // (`-o name` only for an option the script set: a default may differ, `bash -e script`.)
      option: (name) => {
        const o = st.set.get(name);
        return o === 'on' ? true : o === 'off' ? false : undefined;
      },
    };
  }

  /** Whether the expression `e` of `[[ ]]` is true, when it is known from `st`. */
  private condExpr(e: SyntaxNode, st: ShellState): boolean | undefined {
    switch (e.type) {
      case 'parenthesized_expression': return this.condExpr(e.namedChildren[0], st);
      case 'unary_expression': {
        const op = field(e, 'operator')!;
        const operand = e.namedChildren.filter((c) => c !== op)[0];
        if (op.type === '!') {
          const v = this.condExpr(operand, st);
          return v === undefined ? undefined : !v;
        }
        // (`[[ -f` while it is typed has no operand.)
        const value = operand && wordIn(operand, st, this.values(st), 'value');
        return value === undefined ? undefined : unaryTest(op.text, value, this.testEnv(st));
      }
      case 'binary_expression': {
        const op = field(e, 'operator')!.text;
        const left = field(e, 'left');
        const right = field(e, 'right');
        if (op === '&&' || op === '||') {
          // The right side is read only when the left one does not decide.
          const decides = op === '||';
          const l = this.condExpr(left!, st);
          if (l === decides) return decides;
          const r = this.condExpr(right!, st);
          return l === undefined && r !== decides ? undefined : r;
        }
        const value = left && wordIn(left, st, this.values(st), 'value');
        if (value === undefined) return undefined;
        if (op === '==' || op === '=' || op === '!=') {
          const nocase = option(st, 'shopt', 'nocasematch');
          const pattern = nocase === 'off' || nocase === 'default' ? right && wordIn(right, st, this.values(st), 'pattern') : undefined;
          const m = pattern === undefined ? undefined : patternMatches(value, pattern);
          return m === undefined ? undefined : m === (op !== '!=');
        }
        if (op === '=~') {
          // A regex that matches plain text, maybe anchored (`^abc`, `abc$`), once expanded (`$p`; quoted characters
          // are plain); not under nocasematch, which it follows.
          const nocase = option(st, 'shopt', 'nocasematch');
          const m = right && (nocase === 'off' || nocase === 'default') ? plainRegex(wordIn(right, st, this.values(st), 'regex')) : undefined;
          if (!m) return undefined;
          return m.start && m.end ? value === m.text : m.start ? value.startsWith(m.text) : m.end ? value.endsWith(m.text) : value.includes(m.text);
        }
        if (INTEGER_TESTS.has(op)) {
          // Arithmetic: decimal integers only (`010` is octal there, `x` a variable), with spaces, tabs and newlines around.
          const other = right && wordIn(right, st, this.values(st), 'value');
          const int = (t: string | undefined): bigint | undefined => {
            const m = t === undefined ? null : /^[ \t\n]*([+-]?(?:0|[1-9]\d{0,17}))[ \t\n]*$/.exec(t);
            return m ? BigInt(m[1]) : undefined;
          };
          const a = int(value);
          const b = int(other);
          return a === undefined || b === undefined ? undefined : compareIntegers(op, a, b);
        }
        // `<` and `>` (the locale's order), the tests of files.
        return undefined;
      }
    }
    // A word alone: true when it is not empty.
    const value = wordIn(e, st, this.values(st), 'value');
    return value === undefined ? undefined : value !== '';
  }

  /** The state `source` reads (set by `values`). */
  private valuesState: ShellState = EMPTY;
  /**
   * The values the words of a condition read (src/semantics/words.ts evaluates them), from `valuesState`: a variable
   * through `variableText` (not one the script has not set, nor one decisions do not trust: see `markAssumed`), `$?`,
   * `~` from HOME, and whether `$(true)` runs the builtin. One object for the walk (a condition is read often).
   */
  private readonly source: WalkSource = {
    variable: (name) => {
      const st = this.valuesState;
      if (name === '?') return this.lastStatus(st);
      if (!NAME.test(name)) return undefined;
      this.w.assumed = false;
      const v = this.w.variableText(st, name);
      return this.w.assumed ? undefined : v;
    },
    tilde: (user) => (user === '' ? this.source.variable('HOME', this.w.node!) ?? undefined : undefined),
    builtinRuns: (name) => this.builtinRuns(name, this.valuesState),
    arith: (n) => this.arithValue(n, this.valuesState),
    shell: () => this.w.shell,
  };

  /**
   * The value of the arithmetic expansion `n` in a word of a condition, run from `st` with the walk's arithmetic: when
   * it assigns nothing, and reads only values decisions trust (see `variableText`). Undefined where bash fails on it.
   */
  private arithValue(n: SyntaxNode, st: ShellState): bigint | undefined {
    const { assumed } = this.w;
    const { unsure } = this.w.arith;
    this.w.assumed = false;
    try {
      const r = this.w.arith.arithScript(n.namedChildren, st);
      return r.st === st && !this.w.arith.unsure && !this.w.assumed ? r.value : undefined;
      // A guard: the walk ran the expansion with the words of the statement (`defaults`), so an error in it ended the
      // statement before its condition is read.
      /* c8 ignore start */
    } catch (e) {
      if (e instanceof ArithError) return undefined;
      throw e;
      /* c8 ignore stop */
    } finally {
      this.w.assumed = assumed;
      this.w.arith.unsure = unsure;
    }
  }

  /** The walk's values (`source`), read from `st`. */
  private values(st: ShellState): WalkSource {
    this.valuesState = st;
    return this.source;
  }

  /** Whether the name `name` runs its builtin from `st`: not a function, an alias (in `$( )`, from its parse), or a program after `enable -n`. */
  private builtinRuns(name: string, st: ShellState): boolean {
    const off = (e: { state: Tri } | undefined): boolean => !e || e.state === 'off';
    return !this.w.functionCalled(name, st) && off(st.disabled.get(name)) && off(this.w.expand.aliases.get(name)) && off(st.aliases.get(name));
  }

  /**
   * Whether bash expands the word of the expansion `outer` from `st`: that of `${y-w}`, `${y=w}` and `${y?w}` when `y`
   * is not set (with `:`, or empty), of `${y+w}` when it is set (with `:`, and not empty); `on` for the other operators
   * (`${y#p}`, `${a[i]:-w}`'s subscript is not its word), `unknown` when `y` is not known here, or not trusted.
   */
  operandRuns(outer: SyntaxNode, st: ShellState): Tri {
    const p = parseExpansion(outer.text);
    if (!p || p.prefix || p.subscript !== undefined || !NAME.test(p.name)) return 'unknown';
    if (!p.op || !/^:?[-=?+]$/.test(p.op)) return 'on';
    const target = this.w.builtins.resolve(st, p.name);
    const v = target === undefined ? undefined : st.variables.get(target);
    const colon = p.op.startsWith(':');
    if (!v || v.declared === 'unknown' || v.set === 'unknown' || (colon && v.set === 'on' && v.value === undefined) || !this.w.trust.variable(p.name)) return 'unknown';
    const empty = v.set === 'off' || (colon && v.value === '');
    return p.op.endsWith('+') === empty ? 'off' : 'on';
  }

  /** The text of the word `w`, when nothing in it varies from `st`: `$(true)` prints nothing only when `true` runs the builtin. */
  staticText(w: SyntaxNode, st: ShellState, assignment = false): string | undefined {
    const v = staticWordValue(w, assignment, this.w.shell);
    return v !== undefined && substitutionNames(w).every((x) => this.builtinRuns(x, st)) ? v : undefined;
  }

  /** The fields of the word `w` of a command, from `st`, when they are known: `\declare a=$v` declares each. */
  fieldsOf(w: SyntaxNode, st: ShellState): string[] | undefined {
    return wordIn(w, st, this.values(st), 'fields', this.ifsFollowed(st));
  }

  /** Whether word splitting follows the IFS of `st` in a condition: not one the script set, or may set where the walk does not see it. */
  private ifsFollowed(st: ShellState): boolean {
    return !st.variables.get('IFS') && this.w.trust.variable('IFS');
  }

  /**
   * `$?` in the statement being run, from `st`; not known in a statement with a substitution, which changes it, but in
   * bash 5.3's POSIX mode a `$( )` does not (manual 6.11; probes/status.json): only a `${ …; }` would.
   */
  lastStatus(st: ShellState): string | undefined {
    const kept = this.w.version !== '5.2' && option(st, 'set', 'posix') === 'on';
    if (st.status === undefined || descendants(this.w.node!, SUBSTITUTIONS).some((s) => !kept || s.type !== 'command_substitution' || substitutionForm(s).startsWith('${'))) return undefined;
    if (!this.w.mode.dead) for (const r of this.reading) r.set('?', String(st.status));
    return String(st.status);
  }

  /**
   * The items of the `case` statement `n` whose lists run, in order, when the word and the patterns tried are known from
   * `st` (bash: the patterns are tried in turn; `;;` ends, `;&` runs the next list, `;;&` tries the patterns after it).
   */
  /**
   * Whether the patterns of the case items `rest` match after the lists of `ran` as they do before them: each is static
   * text, and each command of those lists has a static name that is no function or alias here, and changes no more
   * than variables (`changesOnlyNames`: not `shopt -s nocasematch`, `jobs -x`, `mapfile -C`, `eval`).
   */
  private samePatterns(ran: readonly SyntaxNode[], rest: readonly SyntaxNode[], st: ShellState): boolean {
    // (A pattern with no expansion, and no tilde, whose `HOME` a list may set.)
    const plain = (v: SyntaxNode): boolean => !v.text.startsWith('~') && ![v, ...descendants(v, EXPANDING)].some((x) => EXPANDING.includes(x.type));
    if (!rest.every((item) => fields(item, 'value').every(plain))) return false;
    return ran.every((item) => descendants(item, ['command']).every((c) => {
      const name = commandName(c);
      // (Assignments alone: by the rows of the variables they assign.)
      if (!field(c, 'name')) return changesOnlyNames(c, '', this.w.shell);
      return name !== undefined && !st.functions.get(name) && !st.aliases.get(name) && changesOnlyNames(c, name, this.w.shell);
    }));
  }

  caseRuns(n: SyntaxNode, items: readonly SyntaxNode[], st: ShellState): number[] | undefined {
    const nocase = option(st, 'shopt', 'nocasematch');
    const { value: runs, reads } = this.reads((): number[] | undefined => {
      const word = this.w.bash && !this.w.blind && (nocase === 'off' || nocase === 'default') && ![field(n, 'value')!, ...items.flatMap((i) => fields(i, 'value'))].some(changesWords) ? wordIn(field(n, 'value')!, st, this.values(st), 'value') : undefined;
      if (word === undefined) return undefined;
      const out: number[] = [];
      for (let i = 0; i < items.length;) {
        let found = -1;
        for (let j = i; j < items.length && found < 0; j++) {
          for (const v of fields(items[j], 'value')) {
            const pattern = wordIn(v, st, this.values(st), 'pattern');
            const m = pattern === undefined ? undefined : patternMatches(word, pattern);
            if (m === undefined) return undefined;
            if (m) {
              found = j;
              break;
            }
          }
        }
        if (found < 0) break;
        let k = found;
        out.push(k);
        const end = (item: SyntaxNode): string | undefined => item.children.find((c) => c.type === ';&' || c.type === ';;&')?.type;
        while (end(items[k]) === ';&' && k + 1 < items.length) out.push(++k);
        if (end(items[k]) !== ';;&') break;
        // (bash tests the patterns after it in the state the lists that ran leave, which this decision does not
        // follow: it is not made, unless those patterns are static text and the lists change no option they read.
        // The walk expands them there: see the walker's `case_statement`.)
        if (k + 1 < items.length && !this.samePatterns(items.slice(found, k + 1), items.slice(k + 1), st)) return undefined;
        i = k + 1;
      }
      return out;
    });
    this.decide(n, runs?.join(','), reads);
    return runs;
  }
}
