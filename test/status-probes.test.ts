// The status model (src/semantics/status.ts) against what bash does: the rows of test/fixtures/probes/status.json,
// recorded by scripts/record-probes.ts under `bash -e` (or without -e when the row says `errexit: false`). The test
// runs each snippet on a small evaluator that takes from the model what a statement's status is made of
// (`StatusRule`) and whether `set -e` stops the shell after a failure there (`ErrexitContext`, and its expansion
// errors); it knows by itself only the status of a few commands (`true`, `false`, `[ -f FILE ]`, `exit 3`…). The
// markers it reaches and the exit status must be bash's. A row the evaluator cannot run (a command it does not
// know, a trap) or the model gets wrong has its reason in `gaps`; a gap the model gets right fails too, so that the
// list stays true. The test reads the table only: it needs no bash.
import * as assert from 'assert';
import { evalArith } from '../src/arith';
import { testSpecAt } from '../src/semantics/names';
import { statusModel, type StatusModel } from '../src/semantics/status';
import { shellState, type StateModel } from '../src/semantics/state';
import { wordFields, type WordEnv } from '../src/semantics/words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { field, fields, type SyntaxNode } from '../src/syntax/tree';
import { BOX, FILES, instrument, PROBE_ENV, readProbeTable } from './support/probe';

interface StatusRow { manual: string; snippet: string; posix?: boolean; errexit?: boolean; note?: string; gaps?: string; facts: { ran: string[]; status: number } }

const ENV: WordEnv = { variables: PROBE_ENV, pwd: BOX, files: FILES };

/** The shell (or subshell) ends with this status. */
class Exit { constructor(readonly status: number) {} }
/** `return` from a function. */
class Return { constructor(readonly status: number) {} }
/** The evaluator cannot go on: what it does not know. */
class Unknown { constructor(readonly why: string) {} }

const STATEMENT_LISTS = new Set(['program', 'compound_statement', 'subshell', 'do_group', 'command_substitution', 'else_clause']);

class Run {
  readonly ran: string[] = [];
  private last = 0;
  private readonly jobs = new Map<SyntaxNode, number>();
  constructor(private readonly state: StateModel, private readonly status: StatusModel) {}

  /** The statements of a block, run in order: the status of the last one. */
  block(nodes: readonly SyntaxNode[]): number {
    let s = 0;
    for (const c of nodes) if (c.named && c.type !== 'comment') s = this.stmt(c);
    return s;
  }

  /** Runs `n` in a subshell: its exit ends only it. */
  sub(f: () => number): number {
    try {
      return f();
    } catch (e) {
      if (e instanceof Exit) return e.status;
      throw e;
    }
  }

  stmt(n: SyntaxNode): number {
    const rule = this.status.status(n);
    if (rule.kind === 'background') {
      this.jobs.set(n, this.sub(() => this.inner(n)));
      return (this.last = 0);
    }
    const s = this.inner(n);
    this.last = s;
    const ctx = this.status.errexit(n);
    if (s !== 0 && ctx.checked === true) {
      if (ctx.active === 'unknown') throw new Unknown(`errexit may be on at ${n.text}`);
      if (ctx.active === 'on') throw new Exit(s);
    }
    return s;
  }

  private expansionError(n: SyntaxNode): void {
    if (this.status.expansionError(n, ENV)) throw new Exit(1);
  }

  /** The command substitutions of `n`, run in order (each in a subshell): the status of the last one. */
  private substitutions(n: SyntaxNode): number | undefined {
    let s: number | undefined;
    const visit = (x: SyntaxNode): void => {
      for (const c of x.children) {
        if (c.type === 'command_substitution') s = this.sub(() => this.block(c.namedChildren));
        else if (c.type !== 'subshell' && c.type !== 'compound_statement') visit(c);
      }
    };
    visit(n);
    return s;
  }

  private value(w: SyntaxNode): string {
    const f = wordFields(w, this.state, ENV);
    if (!f.fields || f.fields.length !== 1) throw new Unknown(`the value of ${w.text}`);
    return f.fields[0];
  }

  private inner(n: SyntaxNode): number {
    const rule = this.status.status(n);
    switch (n.type) {
      case 'redirected_statement': case 'time_statement': return this.stmt(field(n, 'body')!);
      case 'compound_statement': return this.block(n.namedChildren);
      case 'subshell': return this.sub(() => this.block(n.namedChildren));
      case 'list': {
        const [left, right] = n.namedChildren;
        const op = n.children.find((c) => c.type === '&&' || c.type === '||')!.type;
        const l = this.stmt(left);
        return (op === '&&') === (l === 0) ? this.stmt(right) : l;
      }
      case 'pipeline': case 'negated_command': {
        if (rule.kind !== 'pipeline') throw new Error('a pipeline rule');
        if (rule.pipefail === 'unknown') throw new Unknown('pipefail');
        const all = rule.stages.map((s) => this.sub(() => this.stmt(s)));
        const s = rule.pipefail === 'on' ? [...all].reverse().find((x) => x !== 0) ?? 0 : all[all.length - 1];
        return rule.negated ? Number(s === 0) : s;
      }
      case 'if_statement': {
        const clauses = [n, ...n.namedChildren.filter((c) => c.type === 'elif_clause')];
        for (const c of clauses) {
          const then = c.children.findIndex((x) => x.type === 'then');
          const cond = c.children.slice(0, then);
          if (this.block(cond) === 0) {
            const end = c.children.findIndex((x, i) => i > then && ['elif_clause', 'else_clause', 'fi'].includes(x.type));
            return this.block(c.children.slice(then + 1, end < 0 ? undefined : end));
          }
        }
        const other = n.namedChildren.find((c) => c.type === 'else_clause');
        return other ? this.block(other.namedChildren) : 0;
      }
      case 'while_statement': {
        const until = n.children[0].type === 'until';
        let s = 0;
        for (let i = 0; ; i++) {
          if (i > 20) throw new Unknown('a loop');
          if ((this.block(fields(n, 'condition')) === 0) === until) return s;
          s = this.block(field(n, 'body')!.namedChildren);
        }
      }
      case 'for_statement': {
        let s = 0;
        for (const w of fields(n, 'value')) {
          const f = wordFields(w, this.state, ENV).fields;
          if (!f) throw new Unknown(`the fields of ${w.text}`);
          for (let i = 0; i < f.length; i++) s = this.block(field(n, 'body')!.namedChildren);
        }
        return s;
      }
      case 'case_statement': {
        const v = this.value(field(n, 'value')!);
        for (const item of n.namedChildren.filter((c) => c.type === 'case_item')) {
          if (fields(item, 'value').some((p) => p.text === '*' || p.text === v)) return this.block(item.namedChildren.filter((c) => c.field !== 'value'));
        }
        return 0;
      }
      case 'function_definition': return 0;
      case 'command': if (field(n, 'name')) return this.command(n); {
        // (Assignments alone: the status of the last command substitution.)
        this.expansionError(n);
        const s = this.substitutions(n) ?? 0;
        return rule.kind === 'last-substitution' ? s : 0;
      }
      case 'arithmetic_command': {
        const m = /^\(\(\s*(?:([A-Za-z_]\w*)(\+\+|--)|([^)]*?))\s*\)\)$/.exec(n.text)!;
        const v = m[1] ? Number(this.state.at(n).run.variables.get(m[1])?.value ?? NaN) : evalArith(m[3]);
        if (v === undefined || Number.isNaN(v)) throw new Unknown(n.text);
        return Number(v === 0);
      }
      case 'extended_test': {
        this.expansionError(n);
        const words = n.namedChildren.flatMap((c) => (c.type === 'unary_expression' || c.type === 'binary_expression' ? c.children : [c]));
        return this.test(n, words.map((w) => (w.named && w.type !== 'test_operator' ? this.value(w) : w.text)));
      }
    }
    throw new Unknown(n.type);
  }

  /** A test of one operator, `-f`, `-z` or `-n`, and its operand (`words`: their values). */
  private test(n: SyntaxNode, words: string[]): number {
    const [op, arg] = words;
    if (!words.length) return 1;
    if (op === '-f') return Number(!FILES.includes(arg));
    if (op === '-z') return Number(arg !== '');
    if (op === '-n') return Number(arg === '');
    throw new Unknown(n.text);
  }

  private command(n: SyntaxNode): number {
    const rule = this.status.status(n);
    this.expansionError(n);
    const s = this.substitutions(n);
    const name = field(n, 'name')!.text;
    const args = fields(n, 'argument');
    switch (rule.kind) {
      case 'given': throw rule.by === 'exit' ? new Exit(rule.value) : new Return(rule.value);
      case 'previous': throw rule.by === 'exit' ? new Exit(this.last) : new Return(this.last);
      case 'wait': return rule.all ? 0 : rule.job && this.jobs.has(rule.job) ? this.jobs.get(rule.job)! : (() => { throw new Unknown('wait'); })();
      // (`test` and `[`: status 2 when the model says it fails; else the words of `[` up to its `]`.)
      case 'test': {
        if (rule.fails) return 2;
        const words = args.map((w) => this.value(w));
        if (testSpecAt(this.state, n)?.closingOperand) words.pop();
        return this.test(n, words);
      }
      // (`local x=$(false)`: the declaration's own status.)
      case 'masked': return 0;
      case 'arith': {
        const v = evalArith(args[args.length - 1].text.replace(/^[A-Za-z_]\w*=/, ''));
        if (v === undefined) throw new Unknown(n.text);
        return Number(v === 0);
      }
      case 'command': {
        if (rule.functions.length === 1) {
          const body = field(rule.functions[0], 'body')!;
          try {
            return this.stmt(body);
          } catch (e) {
            if (e instanceof Return) return e.status;
            throw e;
          }
        }
        if (rule.functions.length) throw new Unknown(`which ${name}`);
      }
    }
    switch (name) {
      case '__probe': this.ran.push(args[0].text); return 0;
      case 'true': case ':': case 'echo': case 'shopt': case 'set': case 'export': case 'cat': case 'enable': return 0;
      case 'declare': case 'local': case 'readonly': case 'typeset': return 0;
      case 'false': return 1;
      case 'cd': return Number(!FILES.includes(`${this.value(args[0]).replace(/^\.\//, '')}/`));
      case 'nope_not_a_command': return 127;
    }
    throw new Unknown(`${name}${s === undefined ? '' : ''}`);
  }
}

/** What the evaluator says of a row: the markers that ran and the exit status, or why it cannot say. */
export function evaluate(row: StatusRow): { ran: string[]; status: number } | { unknown: string } {
  // (`bash -e` is `set -e` before the first line: on the same line, so that the lines keep their numbers.)
  const script = `${row.errexit === false ? '' : 'set -e; '}${instrument(row.snippet).script}`;
  const tree = createUnbashParser().parse(script);
  const state = shellState(tree, 'bash', { posix: row.posix });
  const run = new Run(state, statusModel(state));
  try {
    const status = run.block(tree.root.namedChildren);
    return { ran: run.ran, status };
  } catch (e) {
    if (e instanceof Exit) return { ran: run.ran, status: e.status };
    if (e instanceof Unknown) return { unknown: e.why };
    throw e;
  }
}

describe('the status model against bash (probes/status.json)', () => {
  const rows = readProbeTable('status') as StatusRow[];
  for (const row of rows) {
    it(`${row.manual}: ${JSON.stringify(row.snippet)}${row.errexit === false ? ' (no -e)' : ''}${row.posix ? ' (bash --posix)' : ''}`, () => {
      const got = evaluate(row);
      const wrong = 'unknown' in got ? got.unknown : JSON.stringify(got) === JSON.stringify({ ran: row.facts.ran, status: row.facts.status }) ? undefined : `model: ${JSON.stringify(got)}`;
      assert.strictEqual(!!wrong, !!row.gaps, wrong ?? `listed as a gap (${row.gaps}), but the model agrees with bash`);
    });
  }
});
