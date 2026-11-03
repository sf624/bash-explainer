// One line must not stop the whole tool (docs/design/line-budget.md): a failure stays in its line, a line has one budget, a
// document has a bound, and no value can fill the memory.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import { PassThrough } from 'stream';
import { Analyzer, type LineExplanation } from '../src/analyzer';
import { detectShell } from '../src/dialect';
import { deadCodeHints, documentIssues, explainDocumentLine, type ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import { runJq } from '../src/examples/jq';
import { FILTERS } from '../src/examples/textfilters';
import { rerun } from '../src/examples/rerun';
import { charge, chargeSize, costOf, guarded, guardedApart, guardedResult, modelLimit, modelValueLimit, MODEL_LIMIT, Refused, runnerStep, scriptRegex, withinLine } from '../src/examples/regexguard';
import { LineExplainer } from '../src/explain/context';
import { contained, failuresGoTo, failuresThrow, failureText, loggedOnce, type Failure } from '../src/failures';
import { documentHighlight } from '../src/highlight';
import { interpret } from '../src/argv/interpret';
import { lookupCommand } from '../src/dict/aliases';
import { leastOf, mostOf, pushAll } from '../src/lists';
import { commandWords } from '../src/semantics/effects';
import { fact } from '../src/messages';
import { scriptTrust, type StringTrees } from '../src/semantics/trust';
import { shellState } from '../src/semantics/state';
import { wordFields } from '../src/semantics/words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { main } from '../cli/main';
import { startLanguageServer } from '../cli/lsp';
import { corpus } from './support/corpus';
import { scoped, runContained } from './support/contained';
import { WORST } from './support/line-budget-lsp';
import { LINES } from './support/line-budget-table';
import { run } from './support/run';
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

  describe('what no walk can follow stays where it is', () => {
    const TOO_DEEP = fact('en', 'line-too-deep').text;
    const NOT_READ = fact('en', 'file-not-read', { why: 'too-deep' }).text;
    const OVERFLOW = new RangeError('Maximum call stack size exceeded');
    const parserOf = (t: string) => parser.parse(t);
    // (Far past where any stack ends, however optimised the code is by then. The parser takes a moment for each `"$(`, and none for `coproc `.)
    const DEEP: readonly string[] = [`echo ${'"$('.repeat(5000)}`, 'coproc '.repeat(5e4), '! '.repeat(1e5)];

    it('a text the parser cannot follow is a tree that says so, and the parser reads the next text as ever', function () {
      this.timeout(60000);
      for (const script of DEEP) {
        const tree = parser.parse(script);
        assert.strictEqual(tree.unread, 'too-deep');
        assert.strictEqual(tree.text, script);
        assert.deepStrictEqual(new Analyzer('en').explainLine(tree, 0).notes, [NOT_READ]);
        // (No token of the line's whole text: it may be all of the file.)
        assert.strictEqual(new Analyzer('en').explainLine(tree, 7).items.length, 0);
      }
      // (What the overflow left behind: nothing. The same text explained before and after is the same.)
      const before = explain('x=$(echo "${y:-a}"); echo "$x" | grep -c b');
      for (const script of DEEP) parser.parse(script);
      assert.deepStrictEqual(explain('x=$(echo "${y:-a}"); echo "$x" | grep -c b'), before);
      assert.strictEqual(parser.parse('echo a').unread, undefined);
      // (Another failure of the parser is not taken for this: the boundary of the document has it.)
      assert.throws(() => parser.parse({} as string));
    });

    it('a string read as a script that the parser cannot follow is not read, and nothing is trusted', function () {
      this.timeout(60000);
      const script = `bash -c '${'coproc '.repeat(5e4)}'\nx=1\n[ "$x" = 1 ] && echo a\neval '${'coproc '.repeat(5e4)}'\n`;
      const tree = parser.parse(script);
      assert.strictEqual(tree.unread, undefined);
      assert.match(new Analyzer('en').explainLine(tree, 0).items[0].children.at(-1)!.explanation, /nested this deep/);
      assert.ok(shellState(tree, 'bash').blind);
    });

    it('a file not read is one problem at its first line, with the other documents as ever', function () {
      this.timeout(60000);
      const lines = ['coproc '.repeat(5e4), 'echo b'];
      const doc = openDocument(lines.join('\n'), 'shell', parserOf);
      const issues = documentIssues(doc, 'en', {});
      assert.deepStrictEqual(issues.map((i) => [i.code, i.severity, i.startLine, i.endCol]), [['file-not-read', 'error', 0, lines[0].length]]);
      assert.match(issues[0].message, /could not be read: it nests too deep/);
      assert.deepStrictEqual(deadCodeHints(doc, 'en', {}), []);
      assert.deepStrictEqual(documentHighlight(doc), []);
      assert.deepStrictEqual(explainDocumentLine(new Analyzer('en'), doc, 1, 'en', {}, {}).notes, [NOT_READ]);
    });

    it('a parser or a host that throws leaves a document that says so, and the bug is told', () => {
      withBoundaries((told) => {
        const failing = openDocument('echo a\necho b', 'shell', () => { throw new Error('planted'); });
        assert.strictEqual(failing.tree.unread, 'failed');
        assert.deepStrictEqual(failing.lines, ['echo a', 'echo b']);
        assert.deepStrictEqual(new Analyzer('en').explainLine(failing.tree, 1).notes, [fact('en', 'file-not-read', { why: 'failed' }).text]);
        assert.match(documentIssues(failing, 'en', {})[0].message, /a bug of the tool/);
        assert.strictEqual(told.length, 1);
        // (The stack running out is no bug: not told.)
        const deep = openDocument('echo a', 'shell', () => { throw OVERFLOW; });
        assert.strictEqual(deep.tree.unread, 'too-deep');
        assert.strictEqual(told.length, 1);
      });
      assert.throws(() => openDocument('echo a', 'shell', () => { throw new Error('planted'); }), /planted/);
    });

    it('a line no walk can follow says so, as a problem there, and the lines around it stand', () => {
      const lines = ['echo a', '  echo b  ', 'echo c'];
      const doc = { lines, tree: parser.parse(lines.join('\n')) };
      const proto = LineExplainer.prototype as unknown as { end: () => void };
      const real = proto.end;
      proto.end = function (this: LineExplainer) {
        if ((this as unknown as { line: number }).line === 1) throw OVERFLOW;
        real.call(this);
      };
      try {
        const e = new Analyzer('en').explainLine(doc.tree, 1);
        assert.deepStrictEqual(e.notes, [TOO_DEEP]);
        assert.deepStrictEqual(e.anchors?.map((a) => a.span.start.character), [2]);
        assert.ok(new Analyzer('en').explainLine(doc.tree, 0).items.length);
        const issues = documentIssues({ lines, tree: parser.parse(lines.join('\n')) }, 'en', {}).filter((i) => i.code === 'line-too-deep');
        assert.deepStrictEqual(issues.map((i) => [i.startLine, i.severity]), [[1, 'error']]);
        // (Nothing to say it on.)
        assert.strictEqual(new Analyzer('en').explainLine(parser.parse('a\n\nb'), 1).anchors, undefined);
      } finally {
        proto.end = real;
      }
    });

    it('a scan that goes too deep trusts nothing, and the lines keep what they say', () => {
      const tree = parser.parse('eval a');
      const overflowing: StringTrees = { capped: false, script: () => { throw OVERFLOW; }, alias: () => tree.root, compound: () => tree.root, expansion: () => tree.root };
      assert.match(scriptTrust(tree.root, overflowing, undefined, undefined, 'bash').blind!, /too deep/);
      const failing: StringTrees = { ...overflowing, script: () => { throw new Error('planted'); } };
      assert.throws(() => scriptTrust(tree.root, failing, undefined, undefined, 'bash'), /planted/);
    });

    it('a statement over very many lines: its first line says it whole, and each other line its part', () => {
      const script = `echo a${' \\\n b'.repeat(300)}\n`;
      const tree = parser.parse(script);
      const a = new Analyzer('en');
      const first = a.explainLine(tree, 0, 'bash');
      assert.strictEqual(first.items.length, 1);
      assert.strictEqual(first.items[0].span.end.line, 300);
      const later = a.explainLine(tree, 100, 'bash');
      assert.ok(later.items.every((t) => t.span.start.line === 100 && t.span.end.line === 100), JSON.stringify(later.items.map((t) => t.span)));
      // (A shorter one, as ever, is explained whole on each line.)
      const short = parser.parse(`echo a${' \\\n b'.repeat(60)}\n`);
      assert.strictEqual(a.explainLine(short, 30, 'bash').items[0].span.start.line, 0);
      assert.strictEqual(a.explainLine(short, 30, 'bash').items[0].span.end.line, 60);
      // (What the first line says of the command is said once for the file.)
      assert.deepStrictEqual(documentIssues({ lines: [`set -- ${'-x'}`, ...`${'[ a ] \\\n'.repeat(300)}`.split('\n')], tree: parser.parse(`set -- -x\n${'[ a ] \\\n'.repeat(300)}`) }, 'en', {}).filter((i) => i.code === 'file-not-read'), []);
    });

    it('commands that run each other: read as far as anyone writes them', () => {
      const words = (name: string, n: number) => parser.parse(`${`${name} `.repeat(n)}c`).root.namedChildren[0];
      assert.strictEqual(commandWords(words('command', 8), 'bash').name, 'c');
      assert.strictEqual(commandWords(words('command', 9), 'bash').name, undefined);
      // (Many options before the command it runs are read too.)
      assert.strictEqual(commandWords(parser.parse(`command ${'-p '.repeat(20)}ls a`).root.namedChildren[0], 'bash').name, 'ls');
      assert.strictEqual(commandWords(parser.parse(`command ls ${'a '.repeat(20)}`).root.namedChildren[0], 'bash').args.length, 20);
      // (So nothing is decided past them.)
      assert.ok(shellState(parser.parse(`x=1; ${'command '.repeat(9)}x=2; [ "$x" = 1 ] && echo a`), 'bash').blind);
      const parse = interpret(lookupCommand('sudo')!, Array.from({ length: 20 }, () => ({ value: 'sudo' })), { name: 'sudo', lookup: lookupCommand });
      let depth = 0;
      for (let p = parse, r = p.roles.find((x) => x.role.role === 'command'); r?.role.role === 'command' && r.role.spec; p = r.role.parse!, r = p.roles.find((x) => x.role.role === 'command')) depth++;
      assert.strictEqual(depth, 8);
    });

    it('strings in strings: as deep as the walk reads them, and nothing is trusted past that', () => {
      assert.ok(shellState(parser.parse(`${'eval '.repeat(20)}a`), 'bash').blind);
      assert.strictEqual(shellState(parser.parse('eval eval a'), 'bash').blind, undefined);
    });

    it('aliases that double: a walk follows so many, and then trusts nothing', () => {
      const lines = Array.from({ length: 16 }, (_, i) => `alias a${i + 1}='a${i}; a${i}'`);
      const script = `shopt -s expand_aliases\n${lines.join('\n')}\na16\n`;
      assert.ok(shellState(parser.parse(script), 'bash').blind);
      assert.strictEqual(shellState(parser.parse('shopt -s expand_aliases\nalias a=b\nalias c="a; a"\nc\n'), 'bash').blind, undefined);
    });

    it('the lists that grow with a script fit: a long file is read, and a line of it is explained', function () {
      this.timeout(240000);
      assert.strictEqual(parser.parse('echo a\n'.repeat(250000)).root.children.length, 250000);
      assert.ok(new Analyzer('en').explainLine(parser.parse('echo a\n'.repeat(130000)), 129999).items.length);
      assert.strictEqual(parser.parse('# c\n'.repeat(200000)).root.children.length, 200000);
      const background = parser.parse(`${'a&'.repeat(1e5)}\necho b\n`);
      assert.strictEqual(background.unread, undefined);
      assert.ok(new Analyzer('en').explainLine(background, 1).items.length);
      assert.strictEqual(mostOf([1, 3, 2]), 3);
      assert.strictEqual(leastOf([3, 1, 2]), 1);
      assert.strictEqual(mostOf([]), -Infinity);
      assert.strictEqual(leastOf([]), Infinity);
      const to = [1];
      pushAll(to, Array.from({ length: 3e5 }, () => 2));
      assert.strictEqual(to.length, 300001);
    });

    it('nothing in src/ or cli/ spreads a list into a call', () => {
      // (The colours of a theme come from a file of a few hundred rules, not from a script.)
      const from = ['src', 'cli'].flatMap((d) => (fs.readdirSync(d, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => `${d}/${f}`)).filter((f) => !/src\/lists\.ts|src\/ui\/theme(Tokens|Palette)\.ts/.test(f));
      const spread = /\.(push|unshift)\([^;{]*\.\.\.[a-zA-Z]|\.splice\([^;{]*\.\.\.[a-zA-Z]|Math\.(min|max)\(([^()[]*, )?\.\.\./;
      // (What is spread into an array literal makes no call with its items.)
      const noLiterals = (l: string) => { let was; do { was = l; l = l.replace(/\[[^[\]]*\]/g, '_'); } while (l !== was); return l; };
      const found = from.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').flatMap((l, i) => (spread.test(noLiterals(l)) && !/^\s*(\/\/|\*)/.test(l) ? [`${f}:${i + 1}`] : [])));
      assert.deepStrictEqual(found, []);
    });

    it('the command-line tool: a file that cannot be read says so in one line, and the others print', async function () {
      this.timeout(60000);
      const deep = 'coproc '.repeat(5e4);
      const dir = fs.mkdtempSync(`${os.tmpdir()}/line-budget-`);
      const worst = `${dir}/worst.sh`;
      const other = `${dir}/other.sh`;
      fs.writeFileSync(worst, `${deep}\necho b\n`);
      fs.writeFileSync(other, 'echo other\n');
      const cli = async (...argv: string[]) => {
        let out = '';
        let err = '';
        const status = await main([...argv, '--no-config', '--no-color'], { stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, env: {}, isTTY: false });
        return { out, err, status };
      };
      try {
        const text = await cli(worst, other);
        assert.strictEqual(text.status, 2);
        assert.ok(text.out.startsWith(`${worst}: ${NOT_READ}\n\n`), text.out.slice(0, 200));
        assert.match(text.out, /other\.sh:1 {2}echo other/);
        assert.ok(!text.out.includes(deep));
        assert.match(text.err, /1 file could not be read/);
        assert.doesNotMatch(text.err, /bug/);
        const check = await cli('--check', worst, other);
        assert.strictEqual(check.status, 2);
        assert.match(check.out, /file-not-read/);
        const json = await cli('--format', 'json', worst, other);
        assert.deepStrictEqual((JSON.parse(json.out) as { file: string; line: number }[]).map((r) => [r.file, r.line]), [[worst, 1], [other, 1]]);
        const markdown = await cli('--format', 'markdown', worst, other);
        assert.match(markdown.out, /could not be read[^]*\n---\n[^]*echo other/);
        assert.strictEqual((await cli('--format', 'json', '-e', '')).out, '[]\n');
        assert.match((await cli('-e', 'echo a\n\necho b')).out, /\n\n[^]*echo b[^]*\n$/);
        assert.strictEqual((await cli('-e', '')).out, '');
        const lines = await cli('--line', '2', worst);
        assert.strictEqual(lines.status, 2);
        assert.strictEqual(lines.out, `${worst}: ${NOT_READ}\n`);
        // (A bug in what one file prints leaves the others, and says so.)
        const wasThrowing = failuresThrow(false);
        try {
          const failing = await planted('end', () => cli(worst, other), () => true);
          assert.match(failing.out, /echo other|could not be explained/);
          const proto = LineExplainer.prototype as unknown as { end: () => void };
          const real = proto.end;
          proto.end = function () { throw OVERFLOW; };
          try {
            assert.match((await cli('-e', 'echo a')).out, /nests too deep/);
          } finally {
            proto.end = real;
          }
        } finally {
          failuresThrow(wasThrowing);
        }
      } finally {
        fs.rmSync(worst);
        fs.rmSync(other);
        fs.rmdirSync(dir);
      }
    });

    it('the command-line tool, in a process of its own, on files that each once stopped it: the other files print', async function () {
      this.timeout(150000);
      const dir = fs.mkdtempSync(`${os.tmpdir()}/line-budget-`);
      const files = [`echo ${'"$('.repeat(200)}`, 'coproc '.repeat(1000), `jq -n '[range(99999)]|sort|length'`, `jq -n '[range(9e4)]|group_by(.)'`, `jq -n '[range(9e4)]|[paths]'`, 'echo a | cut -f 1000000000', 'echo a | uniq -f 1000000000'];
      const names = files.flatMap((text, k) => {
        const [worst, other] = [`${dir}/worst${k}.sh`, `${dir}/other${k}.sh`];
        fs.writeFileSync(worst, `${text}\n`);
        fs.writeFileSync(other, `echo other${k}\n`);
        return [worst, other];
      });
      try {
        for (const argv of [[], ['--check']]) {
          const r = await runContained([process.execPath, '--max-old-space-size=2000', '--import', 'tsx', 'cli/main.ts', '--no-config', '--no-color', ...argv, ...names], process.cwd(), {}, 120000);
          assert.ok(r.status === 2, `status ${r.status}: ${r.stderr.slice(-2000)}`);
          assert.doesNotMatch(r.stderr, /internal error/);
          if (!argv.length) files.forEach((_, k) => assert.match(r.stdout, new RegExp(`other${k}\\.sh:1 {2}echo other${k}`)));
          // (A check names what it could not read: an Action reports the file, and goes on with the others.)
          else assert.match(r.stdout, /could not be read/);
        }
      } finally {
        for (const f of names) fs.rmSync(f);
        fs.rmdirSync(dir);
      }
    });

    it('the Language Server, in a process of its own, lives through the worst documents and answers for the others', async function () {
      this.timeout(150000);
      const r = await runContained([process.execPath, '--max-old-space-size=2000', '--import', 'tsx', 'test/support/line-budget-lsp.ts'], process.cwd(), {}, 120000);
      assert.strictEqual(r.status, 0, r.stderr.slice(-2000));
      const rows = JSON.parse(r.stdout) as { name: string; ms: number; error: unknown; other: boolean; said: string }[];
      assert.strictEqual(rows.length, WORST.length);
      for (const row of rows) {
        assert.strictEqual(row.error, null, row.name);
        assert.ok(row.other, row.name);
        assert.ok(row.ms < 60000, `${row.name}: ${row.ms} ms`);
      }
      assert.match(rows[0].said, /could not be read|too deep/);
    });

    it('the Language Server: a timer that fails stays a log message, and the server answers', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let refuse = false;
      let wire = '';
      output.on('data', (d: Buffer) => { wire += d.toString('utf8'); });
      const write = output.write.bind(output);
      output.write = ((...a: Parameters<typeof write>) => {
        if (refuse && String(a[0]).includes('publishDiagnostics')) throw new Error('planted');
        return write(...a);
      }) as typeof output.write;
      const before = failuresGoTo(() => undefined);
      const wasThrowing = failuresThrow(false);
      startLanguageServer({ input, output, env: {}, version: 'test', exit: () => undefined });
      const send = (m: object) => {
        const json = JSON.stringify({ jsonrpc: '2.0', ...m });
        input.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
      };
      const until = async (what: RegExp) => {
        for (let i = 0; i < 400 && !what.test(wire); i++) await new Promise((r) => setTimeout(r, 10));
        assert.match(wire, what);
      };
      try {
        send({ id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
        await until(/"id":1/);
        refuse = true;
        send({ method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///x.sh', languageId: 'shellscript', version: 1, text: 'echo a\n' } } });
        await until(/internal error \(the problems of a document\)/);
        send({ id: 2, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///x.sh' }, position: { line: 0, character: 1 } } });
        await until(/"id":2/);
      } finally {
        send({ id: 3, method: 'shutdown' });
        send({ method: 'exit' });
        failuresThrow(wasThrowing);
        failuresGoTo(before);
      }
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

    it('a value the line gives that the runner does not take: no example, and what a sample of `ps` gives is not its input', () => {
      assert.deepStrictEqual(explain(`yq '. * 1e1000' <<< '"ab"'`, 0, { yqFlavor: 'kislyuk' }).examples, []);
      assert.doesNotMatch(JSON.stringify(explain('sort <(ps aux)').examples), /USER/);
    });

    it('a number of any size: what the example says is what the tool says', () => {
      const output = (script: string) => (explain(script).examples[0].sections.at(-1)?.lines ?? []) as string[];
      for (const [args, input, tool] of [
        [['-f', '1000000000'], 'a\n', 'cut'],
        [['-f', '1000000000'], 'a\tb\n', 'cut'],
        [['-f', '1-100000000'], 'a\tb\n', 'cut'],
        [['-k', '1000000000'], 'b x\na y\n', 'sort'],
        [['-f', '1000000000'], 'a x\nb y\n', 'uniq'],
        [['-s', '1000000000'], 'a\nb\n', 'uniq'],
        [['-w', '1000000000'], 'a\nb\n', 'uniq'],
      ] as [string[], string, keyof typeof FILTERS][]) {
        const real = run(tool, args, { input, env: { LC_ALL: 'C' } }).stdout.toString().split('\n').slice(0, -1);
        assert.deepStrictEqual(FILTERS[tool](args, input.split('\n').slice(0, -1)), real, `${tool} ${args.join(' ')}`);
      }
      // (Its made-up input is no wider for a number that large: a field past the end is empty, as `cut` says.)
      assert.ok(output('cut -f 1000000000').every((l) => l === '' || l === 'no delimiter here'));
      assert.ok(output('sort -k 1000000000').length);
    });

    it('a set of `tr` that fills what is asked, and one refused before it is made', () => {
      assert.deepStrictEqual(explain("echo a | tr a '[b*99]'").examples[0].sections.at(-1)?.lines, ['b']);
      assert.deepStrictEqual(explain("echo abc | tr abc 'x[y*]z'").examples[0].sections.at(-1)?.lines, ['xyz']);
      assert.deepStrictEqual(notes(explain(`echo a | tr '${'[a*999999]'.repeat(5)}' b`)), [fact('en', 'size-not-computed').text]);
    });

    it('a cost that is no number, or below zero, gives nothing back', () => {
      assert.strictEqual(noteOf(() => { charge(9e6); charge(NaN); charge(-1e9); charge(2e6); }), 'regex-not-computed');
    });

    it('`-` of jq: a set for simple values, as `cmp` compares them, and the rest compared', () => {
      const outs = (filter: string) => { const r = runJq(filter, null); return r && 'outputs' in r ? r.outputs : r; };
      assert.deepStrictEqual(outs('[1,2,"a",null,true,1]-[1,"a",null]'), [[2, true]]);
      assert.deepStrictEqual(outs('[1,"1",[1],{"a":1}]-[[1],{"a":1}]'), [[1, '1']]);
      // (A number that is no number equals nothing, as in jq: `[nan]-[nan]` keeps it.)
      assert.strictEqual((outs('[-1|sqrt]-[-1|sqrt]') as unknown[][])[0].length, 1);
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
