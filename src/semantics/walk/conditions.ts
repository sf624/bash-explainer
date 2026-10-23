// The conditions of the walk of the shell state (src/semantics/walk/walker.ts): the status of a statement when it is
// known (`[ ]`, `[[ ]]`, `true`, `(( ))`, assignments), the lists of a `case` that run, and what each condition decided.
import { evalArith } from '../../arith';
import { staticWordValue, substitutionNames } from '../../staticword';
import { descendants, field, fields, type SyntaxNode } from '../../syntax/tree';
import { compareIntegers, patternMatches, plainRegex, testStatus, type TestEnv, unaryTest } from '../conditions';
import { attribute, EMPTY, option, type ShellState, type Tri } from '../shellstate';
import type { Decision } from '../state';
import { interpret } from '../../argv/interpret';
import { has as hasOption } from '../../argv/query';
import { argWord } from '../../argv/words';
import { builtins } from '../../dict/builtins';
import { testSpec } from '../names';
import { type ValueSource, wordIn } from '../words';
import { ArithError, NAME, SUBSTITUTIONS } from './shared';
import type { Walker } from './walker';

/**
 * Whether the redirection `r` cannot fail: to or from `/dev/null`, or a copy of fd 1 or 2 (`2>&1`, `>&2`), with an fd
 * given as a number if any.
 */
function safeRedirect(r: SyntaxNode): boolean {
  if (r.type !== 'file_redirect' || (field(r, 'descriptor') && field(r, 'descriptor')!.type !== 'file_descriptor')) return false;
  const op = r.children.find((c) => !c.named)?.type;
  const to = field(r, 'destination');
  const target = to && staticWordValue(to);
  if (target === '/dev/null') return ['>', '>>', '&>', '&>>', '>|', '<'].includes(op!);
  return op === '>&' && (target === '1' || target === '2');
}

const INTEGER_TESTS = new Set(['-eq', '-ne', '-lt', '-le', '-gt', '-ge']);

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
   * variable: `$debug`), `test`. Not with prefix assignments (one may fail), a redirection that may fail, or a word
   * whose value is not known (its expansion may fail).
   */
  simpleStatus(n: SyntaxNode, st: ShellState): number | undefined {
    if (!this.w.bash || n.namedChildren.some((c) => c.type === 'variable_assignment') || !fields(n, 'redirect').every(safeRedirect)) return undefined;
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
    const parse = interpret(builtins.unset, args.map(argWord), { name: 'unset' });
    if (hasOption(parse, '-f')) return hasOption(parse, '-v') ? 1 : undefined;
    let status = 0;
    for (const { word, role } of parse.roles) {
      if (role.role !== 'operand') continue;
      const name = staticWordValue(args[word]);
      const target = name !== undefined && NAME.test(name) ? (hasOption(parse, '-n') ? name : this.w.builtins.resolve(st, name)) : undefined;
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
    switch (n.type) {
      case 'command': case 'arithmetic_command': case 'list': case 'if_statement': case 'case_statement': case 'pipeline':
      case 'compound_statement': case 'subshell': case 'time_statement':
        return after.status;
      case 'negated_command': return after.status === undefined ? undefined : Number(after.status === 0);
      case 'redirected_statement': return fields(n, 'redirect').every(safeRedirect) ? after.status : undefined;
      case 'extended_test': {
        const v = this.w.bash && n.namedChildren.length === 1 ? this.condExpr(n.namedChildren[0], st) : undefined;
        return v === undefined ? undefined : Number(!v);
      }
      case 'variable_assignment': return this.assignmentStatus(n, [n], st);
      case 'variable_assignments': return this.assignmentStatus(n, n.namedChildren, st);
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
  private readonly source: ValueSource = {
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
  private values(st: ShellState): ValueSource {
    this.valuesState = st;
    return this.source;
  }

  /** Whether the name `name` runs its builtin from `st`: not a function, an alias (in `$( )`, from its parse), or a program after `enable -n`. */
  private builtinRuns(name: string, st: ShellState): boolean {
    const off = (e: { state: Tri } | undefined): boolean => !e || e.state === 'off';
    return !this.w.functionCalled(name, st) && off(st.disabled.get(name)) && off(this.w.expand.aliases.get(name)) && off(st.aliases.get(name));
  }

  /** The text of the word `w`, when nothing in it varies from `st`: `$(true)` prints nothing only when `true` runs the builtin. */
  staticText(w: SyntaxNode, st: ShellState, assignment = false): string | undefined {
    const v = staticWordValue(w, assignment);
    return v !== undefined && substitutionNames(w).every((x) => this.builtinRuns(x, st)) ? v : undefined;
  }

  /** Whether word splitting follows the IFS of `st` in a condition: not one the script set, or may set where the walk does not see it. */
  private ifsFollowed(st: ShellState): boolean {
    return !st.variables.get('IFS') && this.w.trust.variable('IFS');
  }

  /** `$?` in the statement being run, from `st`; not known in a statement with a substitution, which changes it. */
  lastStatus(st: ShellState): string | undefined {
    if (st.status === undefined || descendants(this.w.node!, SUBSTITUTIONS).length) return undefined;
    if (!this.w.mode.dead) for (const r of this.reading) r.set('?', String(st.status));
    return String(st.status);
  }

  /**
   * The items of the `case` statement `n` whose lists run, in order, when the word and the patterns tried are known from
   * `st` (bash: the patterns are tried in turn; `;;` ends, `;&` runs the next list, `;;&` tries the patterns after it).
   */
  caseRuns(n: SyntaxNode, items: readonly SyntaxNode[], st: ShellState): number[] | undefined {
    const nocase = option(st, 'shopt', 'nocasematch');
    const { value: runs, reads } = this.reads((): number[] | undefined => {
      const word = this.w.bash && !this.w.blind && (nocase === 'off' || nocase === 'default') ? wordIn(field(n, 'value')!, st, this.values(st), 'value') : undefined;
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
        i = k + 1;
      }
      return out;
    });
    this.decide(n, runs?.join(','), reads);
    return runs;
  }
}
