// One line must not stop the whole tool (docs/design/line-budget.md): a failure stays in its line, a line has one budget, a
// document has a bound, and no value can fill the memory.
import * as assert from 'assert';
import * as fs from 'fs';
import { PassThrough } from 'stream';
import { Analyzer, type LineExplanation } from '../src/analyzer';
import { detectShell } from '../src/dialect';
import { deadCodeHints, documentIssues, explainDocumentLine, type ShellDocument } from '../src/document';
import { rerun } from '../src/examples/rerun';
import { charge, chargeSize, costOf, guarded, guardedApart, guardedResult, modelLimit, modelValueLimit, MODEL_LIMIT, Refused, runnerStep, scriptRegex, withinLine } from '../src/examples/regexguard';
import { LineExplainer } from '../src/explain/context';
import { contained, failuresGoTo, failuresThrow, failureText, loggedOnce, type Failure } from '../src/failures';
import { documentHighlight } from '../src/highlight';
import { fact } from '../src/messages';
import { shellState } from '../src/semantics/state';
import { wordFields } from '../src/semantics/words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { main } from '../cli/main';
import { startLanguageServer } from '../cli/lsp';
import { corpus } from './support/corpus';
import { scoped, runContained } from './support/contained';
import { LINES } from './support/line-budget-table';
// (As the whole suite has it, by .mocharc.cjs, also for a run of this file with `--no-config`.)
import './support/failures-throw';

const parser = createUnbashParser();
const A40 = `${'a'.repeat(40)}!`;
const say = (id: 'regex-not-computed' | 'budget-not-computed' | 'example-failed' | 'line-not-explained') => fact('en', id).text;
const explain = (script: string, line = 0, opts = {}) => new Analyzer('en').explainLine(parser.parse(script), line, 'bash', opts);
const notes = (e: LineExplanation) => e.examples.map((x) => x.note).filter(Boolean);

/** Runs `run` as the products do: a throw stops at a boundary, and goes to the list given. */
function withBoundaries<T>(run: (told: Failure[]) => T): T {
  const told: Failure[] = [];
  const wasThrowing = failuresThrow(false);
  const before = failuresGoTo((f) => told.push(f));
  try {
    return run(told);
  } finally {
    failuresGoTo(before);
    failuresThrow(wasThrowing);
  }
}

/** Plants a throw in a method of the context of a line (for `example`, not in the example that says it failed), until `run` has finished. */
function planted<T>(method: 'example' | 'end', run: () => T, when: (cx: LineExplainer) => boolean = () => true): T {
  const proto = LineExplainer.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const real = proto[method];
  proto[method] = function (this: LineExplainer, ...a: unknown[]) {
    if (when(this) && !(a[0] as { note?: string } | undefined)?.note) throw new Error('planted');
    return real.apply(this, a);
  };
  const restore = () => { proto[method] = real; };
  let result: T;
  try {
    result = run();
  } catch (e) {
    restore();
    throw e;
  }
  if (result instanceof Promise) return result.finally(restore) as T;
  restore();
  return result;
}

describe('one line must not stop the whole tool', () => {
  describe('a failure stays in its line', () => {
    const LINE = 'grep -E "a" f';

    it('the test suite fails on a throw: the boundaries are off here', () => {
      assert.match(fs.readFileSync('.mocharc.cjs', 'utf8'), /require: \['\.\/test\/support\/failures-throw\.ts'\]/);
      assert.throws(() => planted('example', () => explain(LINE)), /planted/);
      assert.throws(() => planted('end', () => explain(LINE)), /planted/);
    });

    it('a throw in an example drops that example only, says so, and tells the maintainer', () => {
      const whole = explain(LINE);
      withBoundaries((told) => {
        const e = planted('example', () => explain(LINE), () => true);
        assert.deepStrictEqual(e.items.map((i) => i.label), whole.items.map((i) => i.label));
        assert.deepStrictEqual(notes(e), [say('example-failed')]);
        assert.ok(told.length > 0 && told.every((f) => /example/.test(f.where) && (f.error as Error).message === 'planted'));
      });
    });

    it('a throw in a line says so, on a token of the line, and the other lines stand', () => {
      const script = 'echo one\n  echo two  \necho three\n';
      const tree = parser.parse(script);
      withBoundaries((told) => {
        const out = planted('end', () => [0, 1, 2, 3, 9].map((l) => new Analyzer('en').explainLine(tree, l, 'bash')), (cx) => cx.line === 1 || cx.line === 3 || cx.line === 9);
        assert.deepStrictEqual(out[1].notes, [say('line-not-explained')]);
        assert.deepStrictEqual(out[1].noteInfo.map((n) => n.text), [say('line-not-explained')]);
        assert.deepStrictEqual(out[1].items.map((i) => [i.label, i.span.start.character, i.span.end.character]), [['echo two', 2, 10]]);
        assert.ok(out[0].items.length && !out[0].notes.includes(say('line-not-explained')));
        assert.ok(out[2].items.length);
        // (A blank line has no token to say it on.)
        assert.deepStrictEqual(out[3].items, []);
        assert.deepStrictEqual(out[4].items, []);
        assert.ok(told.some((f) => f.where === 'line 2'));
      });
      const zsh = withBoundaries(() => planted('end', () => new Analyzer('en').explainLine(parser.parse('echo a'), 0, 'zsh')));
      assert.strictEqual(zsh.shell, 'zsh');
    });

    it('a document whose tree fails gives its lines and no crash, in each function of a document', () => {
      const real = parser.parse('echo a');
      const tree = Object.create(real, { root: { get: () => { throw new Error('planted'); } } }) as typeof real;
      const doc: ShellDocument = { lines: ['echo a'], tree };
      withBoundaries((told) => {
        assert.deepStrictEqual(documentIssues(doc, 'en', {}), []);
        assert.deepStrictEqual(deadCodeHints(doc, 'en', {}), []);
        assert.deepStrictEqual(documentHighlight(doc), []);
        assert.deepStrictEqual(new Analyzer('en').explainLine(tree, 0).notes, [say('line-not-explained')]);
        assert.ok(told.length >= 4);
      });
    });

    it('a host file: what it adds around the line has the same boundary', () => {
      const tree = parser.parse('echo a\n');
      const doc = { lines: ['echo a', ''], tree, extracted: { get regions(): never { throw new Error('planted'); }, maps: [], text: 'echo a\n' } } as unknown as ShellDocument;
      withBoundaries(() => {
        const e = explainDocumentLine(new Analyzer('en'), doc, 0, 'en', {}, {});
        assert.deepStrictEqual(e.notes, [say('line-not-explained')]);
      });
      assert.throws(() => explainDocumentLine(new Analyzer('en'), doc, 0, 'en', {}, {}), /planted/);
    });

    it('the panel: what it runs again says so', () => {
      const spec = { kind: 'regex', regex: { get source(): never { throw new Error('planted'); } }, mode: 'lines' } as never;
      withBoundaries((told) => {
        assert.deepStrictEqual(rerun(spec, [['a']], 'en').sections[0].lines, [fact('en', 'example-failed').body]);
        assert.strictEqual(told[0].where, 'an example run again');
      });
    });

    it('the command-line tool prints what it can, tells the bug once on standard error, and exits with status 2', async () => {
      const run = async (failing: number[], ...argv: string[]) => {
        let out = '';
        let err = '';
        const wasThrowing = failuresThrow(false);
        try {
          const status = await planted('end', () => main([...argv, '--no-config', '--no-color'], { stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, env: {}, isTTY: false }), (cx) => failing.includes(cx.line!));
          return { out, err, status };
        } finally {
          failuresThrow(wasThrowing);
        }
      };
      const lines = await run([1, 2], '-e', 'echo one\necho two\necho three');
      assert.strictEqual(lines.status, 2);
      assert.match(lines.out, /echo one/);
      assert.match(lines.out, /could not be explained/);
      // (Told once, though it failed on two lines.)
      assert.strictEqual(lines.err.match(/internal error \(/g)?.length, 1);
      assert.match(lines.err, /2 internal errors: what they stopped is missing from the output/);
      const one = await run([1], '-e', 'echo one\necho two');
      assert.match(one.err, /1 internal error: what/);
      // (`--check` reads the lines too: a check that could not read one has not passed.)
      assert.strictEqual((await run([1], '--check', '-e', 'echo one\necho two')).status, 2);
      assert.strictEqual((await run([], '--check', '-e', 'echo one\necho two')).status, 0);
    });

    it('the Language Server answers, and logs the bug as an error message', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let wire = '';
      output.on('data', (d: Buffer) => { wire += d.toString('utf8'); });
      const before = failuresGoTo(() => undefined);
      const wasThrowing = failuresThrow(false);
      startLanguageServer({ input, output, env: {}, version: 'test', exit: () => undefined });
      const send = (m: object) => {
        const json = JSON.stringify({ jsonrpc: '2.0', ...m });
        input.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
      };
      const until = async (what: RegExp) => {
        for (let i = 0; i < 200 && !what.test(wire); i++) await new Promise((r) => setTimeout(r, 10));
        assert.match(wire, what);
      };
      try {
        await planted('end', async () => {
          send({ id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
          await until(/"id":1/);
          send({ method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///x.sh', languageId: 'shellscript', version: 1, text: 'echo a\n' } } });
          send({ id: 2, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///x.sh' }, position: { line: 0, character: 1 } } });
          await until(/"id":2/);
        });
        assert.match(wire, /could not be explained/);
        assert.match(wire, /window\/logMessage[^]*Bash Explainer: internal error \(line 1\)/);
      } finally {
        send({ id: 3, method: 'shutdown' });
        send({ method: 'exit' });
        failuresThrow(wasThrowing);
        failuresGoTo(before);
      }
    });

    it('the boundary itself: no sink stops it, a failure is told once, and the default is the console', () => {
      withBoundaries(() => {
        failuresGoTo(() => { throw new Error('the sink'); });
        assert.strictEqual(contained('here', () => { throw new Error('x'); }, () => 1), 1);
      });
      const written: string[] = [];
      const once = loggedOnce((t) => written.push(t));
      const error = new Error('same');
      once({ where: 'a', error });
      once({ where: 'b', error });
      once({ where: 'c', error: 'a string' });
      assert.strictEqual(written.length, 2);
      assert.match(written[0], /internal error \(a\): Error: same/);
      assert.strictEqual(written[1], 'internal error (c): a string');
      const noStack = new Error('no stack');
      noStack.stack = undefined;
      assert.strictEqual(failureText({ where: 'd', error: noStack }), 'internal error (d): no stack');
      once({ where: 'e', error: noStack });
      assert.match(written[2], /no stack/);
      // (The sink a product starts with, for the web page.)
      const logged: unknown[][] = [];
      const real = console.error;
      const { failuresGoTo: goTo } = { failuresGoTo };
      const wasThrowing = failuresThrow(false);
      console.error = (...a: unknown[]) => { logged.push(a); };
      try {
        contained('there', () => { throw new Error('y'); }, () => 0);
      } finally {
        console.error = real;
        failuresThrow(wasThrowing);
      }
      assert.strictEqual(goTo, failuresGoTo);
      assert.match(String(logged[0]?.[0]), /internal error \(there\)/);
    });
  });

  describe('one budget per line, bounded per document', () => {
    it('refused examples on a line share what it has', () => {
      const line = Array.from({ length: 30 }, (_, i) => `echo ${A40} | grep -E '(a+)+$|z${i}'`).join('; ');
      const said = notes(explain(line));
      assert.strictEqual(said.length, 30);
      // (Each first takes a whole limit, until the line has less than one left.)
      assert.ok(said.slice(0, 2).every((n) => n === say('regex-not-computed')));
      assert.ok(said.slice(3).every((n) => n === say('budget-not-computed')));
    });

    it('an example runs with what is left of the line, and a cheap one needs little', () => {
      const line = `${Array.from({ length: 3 }, (_, i) => `echo ${A40} | grep -E '(a+)+$|z${i}'`).join('; ')}; echo ab | grep -E 'a'`;
      assert.strictEqual(notes(explain(line))[3], say('budget-not-computed'));
      // (Nothing else is lost on it: its tokens are there.)
      assert.ok(explain(line).items.length);
    });

    it('the panel of an example that shows has its result: the result does not run on what the example left', () => {
      const e = explain(`x=${'a'.repeat(17)}!; [[ $x =~ (a+)+$ ]]`);
      const ex = e.examples.find((x) => x.kind === 'regex')!;
      assert.ok(ex.sections.length && ex.note === undefined);
      assert.ok(ex.interactive);
      assert.ok(!JSON.stringify(ex.interactive.result).includes('Not computed'));
    });

    it('where the results of a line have no more left, the panel shows the example as it is, and the example stays', () => {
      assert.strictEqual(withinLine({ text: 'x' }, () => {
        for (let i = 0; i < 3; i++) guardedResult(() => charge(1e7));
        return guardedResult(() => 1);
      }), 1);
      assert.strictEqual(withinLine({ text: 'x' }, () => {
        for (let i = 0; i < 3; i++) guardedResult(() => charge(2e7));
        return guardedResult(() => { charge(1); return 1; });
      }), undefined);
      // (The example fits a limit, and what the panel runs of it does not.)
      const ex = explain(`x=${'a'.repeat(18)}!; [[ $x =~ (a+)+$ ]]`).examples[0];
      assert.ok(ex.sections.length && ex.note === undefined);
      assert.strictEqual(ex.interactive, undefined);
    });

    it('what a line says is the same in every product and in any order', function () {
      this.timeout(30000);
      const script = [
        `x=${A40}`, 'y=${x%%*a*a*a*a*a*a*a*b}', `z=$y$y`, `echo "$z" | grep -E '(a+)+$'`,
        `echo ${A40} | sed -E 's/(a|aa)+$/x/'; echo ${A40} | grep -E '(a+)+$|q'`, `[[ $x == *a*a*a*a*a*a*a*b ]] && echo yes`, 'echo "${x%%a*a*a*a*b}"', `echo ${A40} | grep -cE '(a+)+$|r'`,
      ].join('\n');
      const lines = script.split('\n').keys();
      const order = [...lines];
      const whole = (order2: number[]) => {
        const tree = parser.parse(script);
        const a = new Analyzer('en');
        const out = new Map(order2.map((l) => [l, JSON.stringify(a.explainLine(tree, l, 'bash'))]));
        return order.map((l) => out.get(l));
      };
      assert.deepStrictEqual(whole(order), whole([...order].reverse()));
      // (The panel asks for more than the hover: its examples are the same.)
      for (const l of order) {
        const tree = parser.parse(script);
        const hover = new Analyzer('en').explainLine(tree, l, 'bash');
        const panel = new Analyzer('en').explainLine(parser.parse(script), l, 'bash', { reading: true, sentence: true, argv: true });
        assert.deepStrictEqual(panel.examples, hover.examples);
        assert.deepStrictEqual(panel.notes, hover.notes);
      }
    });

    it('a long document gives each line a share, from its size alone, and an ordinary line keeps its examples', function () {
      this.timeout(30000);
      const lines = Array.from({ length: 5000 }, (_, i) => `echo ${A40} | grep -E '(a+)+$|z${i}'`);
      lines[100] = "echo ab | grep -E 'a(b)'";
      const tree = parser.parse(lines.join('\n'));
      const a = new Analyzer('en');
      // (Refused, by the limit of the document.)
      assert.deepStrictEqual(notes(a.explainLine(tree, 0, 'bash')), [say('budget-not-computed')]);
      const ordinary = a.explainLine(tree, 100, 'bash');
      assert.deepStrictEqual(notes(ordinary), []);
      assert.ok(ordinary.examples.some((e) => e.sections.length));
      assert.deepStrictEqual(a.explainLine(tree, 100, 'bash'), ordinary);
      assert.strictEqual(modelLimit({ text: '' }), MODEL_LIMIT);
      assert.ok(modelLimit(tree.root) < MODEL_LIMIT / 10);
      assert.ok(modelValueLimit(tree.root) < 65536);
      // (However long the document, an ordinary expansion stays known.)
      const long = parser.parse(`${'x=$(y)\n'.repeat(50000)}f=a.tar.gz; echo "\${f%.*}"\n`);
      assert.strictEqual(modelLimit(long.root), 2e4);
      assert.strictEqual(modelValueLimit(long.root), 1024);
    });

    it('a model works out each thing on its own limit, whatever is left of the line, and nothing around it pays', () => {
      const costly = () => { charge(5e5); return 'done'; };
      const results = withinLine({ text: 'x' }, () => guarded(() => {
        charge(9e6);
        const apart = guardedApart(MODEL_LIMIT, costly, () => 'refused');
        const cost = costOf(() => charge(1));
        return [apart, cost];
      }, () => ['refused']));
      assert.deepStrictEqual(results, ['done', 1]);
      assert.strictEqual(guardedApart(10, () => { charge(11); return 'done'; }, () => 'refused'), 'refused');
    });

    it('the notes of a line do not depend on its examples: the problems of the corpus are found without them', function () {
      this.timeout(120000);
      const { files, snippets } = corpus();
      const differ: string[] = [];
      for (const input of [...files, ...snippets]) {
        const tree = parser.parse(input.text);
        const shell = detectShell(input.text, input.name.startsWith('snippet') ? '' : input.name);
        const a = new Analyzer('en');
        input.text.split('\n').forEach((_, i) => {
          const whole = a.explainLine(tree, i, shell, { idioms: false });
          const lean = a.explainLine(tree, i, shell, { idioms: false, examples: { enabled: false, disabled: [] } });
          assert.deepStrictEqual(lean.examples, []);
          if (JSON.stringify(whole.noteInfo) !== JSON.stringify(lean.noteInfo)) differ.push(`${input.name}:${i + 1}`);
        });
      }
      assert.deepStrictEqual(differ, []);
    });

    it('the problems of a document run no example', () => {
      for (const script of [`echo ${A40} | grep -E '(a+)+$'`, `x=${A40}; echo "\${x%%*a*a*b}"`, `jq -n 'def f: f; f'`, `echo a | sed 's/a/b/'`, `printf '%s\\n' a`, 'case a in *a) ;; esac', 'read x <<< "a b"']) {
        const tree = parser.parse(script);
        // (`read` says a note from what its example reads, and makes its example; nothing else reaches the line's examples.)
        if (script.startsWith('read')) assert.ok(documentIssues({ lines: [script], tree }, 'en', {}));
        else planted('example', () => documentIssues({ lines: [script], tree }, 'en', {}));
      }
    });

    it('the budget of what no line opened: a whole limit each time', () => {
      assert.strictEqual(guarded(() => { charge(9e6); return 1; }, () => 0), 1);
      assert.strictEqual(guarded(() => { charge(9e6); return 1; }, () => 0), 1);
      assert.strictEqual(guarded(() => { charge(2e7); return 1; }, () => 0), 0);
      // (A line within a line: it draws on the one that is open.)
      assert.strictEqual(withinLine({ text: '' }, () => withinLine({ text: 'x\ny\n' }, () => guarded(() => { charge(9e6); return 1; }, () => 0))), 1);
    });
  });

  describe('limits in the runners and on values', () => {
    const noteOf = (run: () => void) => guarded(() => { run(); return 'ran'; }, (id) => id);

    it('says what ran out', () => {
      assert.strictEqual(noteOf(() => charge(2e7)), 'regex-not-computed');
      assert.strictEqual(noteOf(() => chargeSize(2e7)), 'size-not-computed');
      assert.strictEqual(noteOf(() => runnerStep(2, 1)), 'steps-not-computed');
      assert.strictEqual(noteOf(() => { throw new Refused('steps-not-computed'); }), 'steps-not-computed');
      assert.strictEqual(noteOf(() => { const f = (): number => f() + 1; f(); }), 'steps-not-computed');
      assert.strictEqual(noteOf(() => { 'a'.repeat(2 ** 30); }), 'size-not-computed');
      assert.throws(() => noteOf(() => { (1).toFixed(999); }), RangeError);
      assert.strictEqual(noteOf(() => runnerStep(1, 2)), 'ran');
      assert.ok(costOf(() => runnerStep(1, 2)) > 1);
    });

    it('a stack too deep costs all that is left of the line', () => {
      assert.deepStrictEqual(withinLine({ text: 'x' }, () => {
        const said = [];
        for (let i = 0; i < 4; i++) said.push(guarded(() => { const f = (): number => f() + 1; f(); return 'ran'; }, (id) => id));
        said.push(guarded(() => { charge(1); return 'ran'; }, (id) => id));
        return said;
      }), ['steps-not-computed', 'budget-not-computed', 'budget-not-computed', 'budget-not-computed', 'budget-not-computed'].map((id, i) => (i < 3 ? 'steps-not-computed' : id)));
    });

    for (const { script, says } of LINES) {
      it(`bounded: ${script.slice(0, 60).replace(/\n/g, '; ')}`, function () {
        this.timeout(60000);
        const tree = parser.parse(script);
        const shown: string[] = [];
        script.split('\n').forEach((_, line) => shown.push(...new Analyzer('en').explainLine(tree, line, 'bash').examples.map((e) => e.note ?? '')));
        if (says) assert.ok(shown.some((n) => says.test(n)), JSON.stringify(shown));
      });
    }

    it('a variable\'s value in the model stops being known past its limit', () => {
      const known = (n: number) => {
        const script = `x=a\n${'x=$x$x\n'.repeat(n)}echo "$x"\n`;
        const tree = parser.parse(script);
        const w = descendants(tree.root, ['string']).pop()!;
        return wordFields(w, shellState(tree, 'bash')).fields?.[0]?.length;
      };
      assert.strictEqual(known(4), 16);
      assert.strictEqual(known(16), 65536);
      assert.strictEqual(known(18), undefined);
    });

    it('an expansion refused once is not run again for the same values, and one with an environment of its own has its own run', () => {
      const script = `x=${A40}; echo "\${x%%${'*a'.repeat(40)}b}"`;
      const tree = parser.parse(script);
      const w = descendants(tree.root, ['string']).pop()!;
      const state = shellState(tree, 'bash');
      assert.strictEqual(wordFields(w, state).fields, undefined);
      assert.strictEqual(wordFields(w, state).fields, undefined);
      assert.ok(wordFields(w, state, { variables: new Map() } as never));
      assert.ok(explain(script).examples.length);
    });

    it('a pattern too long to read says so, whatever is left', () => {
      const e = explain(`jq -R 'test("${'a'.repeat(2001)}")'`);
      assert.deepStrictEqual(notes(e), [say('regex-not-computed')]);
    });

    it('a jq range counts past a thousand, and an array past its end stays within the limit', () => {
      const out = explain(`jq -n '[range(0; 2000)] | length'`).examples[0];
      assert.match(JSON.stringify(out.sections), /2000/);
      assert.match(JSON.stringify(explain(`jq -n 'null | .[2] = 1'`).examples[0].sections), /null/);
    });

    it('a regex of the syntax of another engine: no example, and no failure', () => {
      assert.deepStrictEqual(explain(`jq -R 'test("^(?i)foo")'`).examples, []);
      assert.throws(() => scriptRegex('^(?i)foo'), SyntaxError);
      assert.match(JSON.stringify(explain(`jq -R 'test("^foo")'`).examples[0].sections), /"false"/);
    });

    it('no line of the table aborts the process or takes long, in a process of its own', async function () {
      if (!scoped) this.skip();
      this.timeout(120000);
      // (Its documents are for measuring, by hand: each takes the whole bound of a document, 2e9 steps, a minute on a loaded runner.)
      const r = await runContained([process.execPath, '--import', 'tsx', 'test/support/line-budget-table.ts', '3'], process.cwd(), {}, 100000);
      assert.strictEqual(r.status, 0, r.stderr.slice(-2000));
      const { rows, rss } = JSON.parse(r.stdout) as { rows: { script: string; ms: number; ok: boolean; shown: string[] }[]; rss: number };
      assert.deepStrictEqual(rows.filter((row) => !row.ok), []);
      // (Under 1 s here; with coverage, and on a loaded runner, 14 s has been seen. Before, some took minutes or ended the process.)
      assert.deepStrictEqual(rows.filter((row) => row.ms > 60000), []);
      assert.ok(rss < 2000, `${rss} MB`);
    });
  });
});
