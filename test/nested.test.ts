// Nested scripts (docs/design/semantics.md, 4.13): a string that a command slot runs as a script (`eval S`,
// `bash -c S`, `trap S INT`, `ssh host S`) is read as the script it is. This file tests its text and offsets (the
// text against bash's quote removal), the model of each kind of string, and the pitfall that reads another shell's
// model. The state the strings leave is compared with bash on the rows of test/fixtures/probes/state.json.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer, lookupCommand } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { interpret } from '../src/argv/interpret';
import { argWord } from '../src/argv/words';
import { processOf, slotEnvs } from '../src/semantics/env';
import { NESTED_DEPTH, scriptSourceIndex, scriptText, type NestedScript } from '../src/semantics/nested';
import { option, shellState, type StateModel } from '../src/semantics/state';
import { staticWordText, staticWordValue } from '../src/staticword';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, fields, type SyntaxNode, type SyntaxTree } from '../src/syntax/tree';

const parser = createUnbashParser();
const hasBash = spawnSync('bash', ['--version']).status === 0;

/** The arguments of the first command of `src`. */
const argsOf = (src: string): { tree: SyntaxTree; args: SyntaxNode[] } => {
  const tree = parser.parse(src);
  return { tree, args: fields(descendants(tree.root, ['command'])[0], 'argument') };
};

/** The source text of each character of `w`'s value. */
const sources = (src: string, text: { starts: number[]; ends: number[] }): string[] => text.starts.map((s, i) => src.slice(s, text.ends[i]));

/** The script the model keeps for the string that starts with `first` (read by the analyzer or the walk). */
function cached(model: StateModel, first: SyntaxNode): NestedScript {
  // (The environment is not read when the model has the string already.)
  const s = model.script([first], { links: [] });
  assert.ok(!('why' in s), `${first.text} is not read`);
  return s;
}

describe('nested scripts: the text of a string, as bash reads it', () => {
  for (const w of [`'a $b "c"'`, `"a \\$b \\" \\\\ \\x"`, `"a\\\nb"`, `"a\\\\\nb"`, `a\\ b\\$c`, `$'a\\tb\\x41\\u00e9\\cA\\'q'`, `'a'"b"c\\d`, `$'x\\0y'z`, `a\\`,
    `$'\\c?x'`, `$'a\\c@b'c`, `$'\\c\\\\x'`]) {
    it(`reads ${JSON.stringify(w)} as bash does`, function () {
      const { args } = argsOf(`eval ${w}`);
      const text = staticWordText(args[0]);
      assert.ok(text, w);
      assert.strictEqual(text.starts.length, text.text.length);
      assert.strictEqual(text.ends.length, text.text.length);
      assert.strictEqual(staticWordValue(args[0]), text.text, w);
      if (!hasBash) this.skip();
      const r = spawnSync('bash', ['--norc', '-c', `printf %s ${w}`], { encoding: 'utf8' });
      assert.strictEqual(text.text, r.stdout, w);
    });
  }

  it('gives each character the source it comes from', () => {
    const src = `eval "a\\$b" 'c'd`;
    const { args } = argsOf(src);
    const t = scriptText(args)!;
    assert.strictEqual(t.text, 'a$b cd');
    assert.deepStrictEqual(sources(src, t), ['a', '\\$', 'b', ' ', 'c', 'd']);
    // (A backslash-newline is removed; an escape of $'…' is the source of what it gives.)
    const ansi = `eval $'\\x41\\n'`;
    const a = staticWordText(argsOf(ansi).args[0])!;
    assert.deepStrictEqual(sources(ansi, a), ['\\x41', '\\n']);
  });

  it('maps an offset of the text to the source, as the start or the end of a range', () => {
    const { args } = argsOf(`eval 'ab'`);
    const script = { ...scriptText(args)!, words: args };
    assert.deepStrictEqual([0, 1, 2].map((i) => scriptSourceIndex(script, i, false)), [6, 7, 8]);
    assert.deepStrictEqual([0, 1, 2].map((i) => scriptSourceIndex(script, i, true)), [6, 7, 8]);
    const empty = { ...scriptText(argsOf(`eval ''`).args)!, words: argsOf(`eval ''`).args };
    assert.strictEqual(scriptSourceIndex(empty, 0, false), 5);
  });

  it('is not known with an expansion, a glob, a brace, a tilde, a byte above 0x7f, or inside backquotes', () => {
    for (const w of ['"$x"', 'a*', '{a,b}', '~/x', `$'\\xe3'`, '$"x"']) assert.strictEqual(staticWordText(argsOf(`eval ${w}`).args[0]), undefined, w);
    const tree = parser.parse('x=`eval \'a\\$b\'`');
    const inner = descendants(tree.root, ['raw_string'])[0];
    assert.strictEqual(staticWordText(inner), undefined);
    assert.strictEqual(scriptText([argsOf('eval a "$x"').args[0], argsOf('eval a "$x"').args[1]]), undefined);
  });
});

describe('nested scripts: the model', () => {
  const end = (src: string, shell?: Shell) => shellState(parser.parse(src), shell).end;
  const value = (src: string, name: string, shell?: Shell) => {
    const v = end(src, shell).variables.get(name);
    return v ? `${v.set}${v.value !== undefined ? `=${v.value}` : ''}` : 'untouched';
  };

  it('runs a static eval string where eval runs, and keeps what it changes', () => {
    assert.strictEqual(value(`eval 'x=1'`, 'x'), 'on=1');
    assert.strictEqual(value(`eval x=1 y=2`, 'y'), 'on=2');
    assert.strictEqual(end(`eval 'f() { :; }; set -f'`).functions.get('f')?.state, 'on');
    assert.strictEqual(option(end(`eval 'set -f'`), 'set', 'noglob'), 'on');
    // In a subshell, a pipeline stage or another shell, it changes nothing here.
    assert.strictEqual(value(`( eval 'x=1' )`, 'x'), 'untouched');
    assert.strictEqual(value(`bash -c 'x=1'; eval 'bash -c "y=1"'`, 'x'), 'untouched');
    // A string not known here may set any name: what is not set stays not known in arithmetic.
    assert.notStrictEqual(value(`eval "$cmd"; (( z = q + 1 ))`, 'z'), 'on=1');
    assert.strictEqual(value(`(( z = q + 1 ))`, 'z'), 'on=1');
    // (The lines before a syntax error run; the line of the error does not.)
    assert.strictEqual(value(`eval 'a=1\nb=2; if'`, 'a'), 'on=1');
    assert.strictEqual(value(`eval 'a=1\nb=2; if'`, 'b'), 'untouched');
  });

  it('reads the string of an eval in a function once, however many times the body is walked', () => {
    const tree = parser.parse(`f() { eval 'g() { :; }; n=$1'; }; f 1; x=1; f 2`);
    const model = shellState(tree);
    assert.strictEqual(model.definitions.functions.get('g')?.length, 1);
    assert.strictEqual(model.end.functions.get('g')?.state, 'on');
  });

  it('defines what an eval string defines, for the names the script calls', () => {
    const tree = parser.parse(`eval 'g() { :; }'\ng`);
    const model = shellState(tree);
    assert.ok(model.definitions.functions.get('g')?.length);
    const call = descendants(tree.root, ['command']).find((c) => c.text === 'g')!;
    assert.strictEqual(model.at(call).run.functions.get('g')?.state, 'on');
  });

  it('takes the names a trap action changes as unknown after any later statement, but not for an EXIT trap', () => {
    assert.strictEqual(value(`trap 'v=1' INT; v=2`, 'v'), 'unknown');
    assert.strictEqual(value(`trap 'v=1' EXIT; v=2`, 'v'), 'on=2');
    assert.strictEqual(value(`trap '' INT; trap - INT; v=2`, 'v'), 'on=2');
    // (A trap that runs a function: what the function changes.)
    assert.strictEqual(value(`f() { w=1; }; trap f USR1; w=2`, 'w'), 'unknown');
    assert.notStrictEqual(value(`trap "$a" INT; (( z = q + 1 ))`, 'z'), 'on=1');
  });

  it('gives a string another shell runs a model of its own, from what reaches it', () => {
    const src = 'export a=1 u=$(date); b=2; declare -ax c=(1); f() { :; }; export -f f; g() { :; }; k() { :; }\n'
      + "if [ \"$1\" ]; then export d=4; export -f k; fi; export SHELLOPTS; set -u\n"
      + "e=5 bash -c 'echo $a $b $c $d $e $u; f; g; k'; sh -c 'f'; env -i bash -c 'echo $a'";
    const tree = parser.parse(src);
    const model = shellState(tree);
    new Analyzer('en').explainLine(tree, 2);
    const strings = descendants(tree.root, ['raw_string']);
    const inner = (i: number): NestedScript => cached(model, strings[i]);
    const bash = inner(0);
    assert.strictEqual(bash.kind, 'child');
    const st = bash.model.at(bash.tree.root.namedChildren[0]).run;
    const has = (name: string) => {
      const v = st.variables.get(name);
      return v ? `${v.set}${v.value !== undefined ? `=${v.value}` : ''}` : 'none';
    };
    assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e', 'u'].map(has), ['on=1', 'none', 'none', 'unknown', 'on', 'on']);
    assert.strictEqual(st.functions.get('f')?.state, 'on');
    assert.strictEqual(st.functions.get('k')?.state, 'unknown');
    assert.strictEqual(st.functions.get('g'), undefined);
    assert.strictEqual(option(st, 'set', 'nounset'), 'on');
    // sh may be dash, which reads no exported function (or bash, which does); env -i passes nothing.
    assert.strictEqual(inner(1).model.at(inner(1).tree.root.namedChildren[0]).run.functions.get('f')?.state, 'unknown');
    assert.strictEqual(inner(2).model.at(inner(2).tree.root.namedChildren[0]).run.variables.get('a'), undefined);
    // What it changes stays there.
    assert.strictEqual(model.end.variables.get('e'), undefined);
  });

  it('walks an exported function where another bash calls it', () => {
    const src = `f() { local x; h() { :; }; y=1; }; export -f f; bash -c 'f; h'`;
    const tree = parser.parse(src);
    const model = shellState(tree);
    new Analyzer('en').explainLine(tree, 0);
    const s = cached(model, descendants(tree.root, ['raw_string'])[0]);
    assert.strictEqual(s.model.end.variables.get('y')?.set, 'on');
    assert.strictEqual(s.model.end.functions.get('h')?.state, 'on');
  });

  it('runs a nested root where its slot runs', () => {
    const tree = parser.parse(`eval '( : )'; bash -c ': | cat'`);
    const model = shellState(tree);
    new Analyzer('en').explainLine(tree, 0);
    const strings = descendants(tree.root, ['raw_string']);
    const e = cached(model, strings[0]);
    const colon = descendants(e.tree.root, ['command'])[0];
    assert.deepStrictEqual(e.model.env(colon).links.map((l) => (l.kind === 'subshell' ? l.why : l.kind === 'slot' ? l.via : l.kind)), ['eval', 'parentheses']);
    const b = cached(model, strings[1]);
    const first = descendants(b.tree.root, ['command'])[0];
    assert.deepStrictEqual(b.model.env(first).links.map((l) => (l.kind === 'subshell' ? l.why : l.kind === 'slot' ? l.via : l.kind)), ['bash -c', 'pipeline-stage']);
    assert.strictEqual(processOf(b.model.env(first)).kind, 'shell');
    // The model of a string's tree is the one its nodes are in.
    assert.strictEqual(shellState(e.tree), model);
    assert.strictEqual(shellState(b.tree), b.model);
  });

  it('reads no string that no shell runs', () => {
    // `sudo eval s` starts no shell: sudo cannot run a builtin (its slot has the pitfall).
    const tree = parser.parse(`sudo eval 'x=1'`);
    const model = shellState(tree);
    assert.strictEqual(model.end.variables.get('x'), undefined);
    const cmd = descendants(tree.root, ['command'])[0];
    const args = fields(cmd, 'argument');
    const spec = lookupCommand('sudo')!;
    const envs = slotEnvs(model.env(cmd), interpret(spec, args.map(argWord), { name: 'sudo', lookup: lookupCommand }), spec, args, lookupCommand);
    assert.deepStrictEqual(model.script([args[1]], envs.get(args[1])!), { why: 'not-run' });
  });

  it('gives another shell what reaches it, as bash and dash start', () => {
    const src = "export IFS=: v=1 SHELLOPTS; set +h -e; x=1 env -i bash -c 'a'; x=1 env -i x=2 bash -c 'b'; bash -c 'c'; dash -c 'd'; sh -c 'e'; x=1 ssh h 'f'";
    const tree = parser.parse(src);
    const model = shellState(tree);
    new Analyzer('en').explainLine(tree, 0);
    const st = (i: number) => {
      const s = cached(model, descendants(tree.root, ['raw_string'])[i]);
      return s.model.at(s.tree.root.namedChildren[0]).run;
    };
    // (A variable given before `env -i` is not passed; one given to it is. A remote shell gets neither.)
    assert.strictEqual(st(0).variables.get('x'), undefined);
    assert.strictEqual(st(1).variables.get('x')?.set, 'on');
    assert.strictEqual(st(5).variables.get('x'), undefined);
    // (`command` passes them on.)
    const c = parser.parse(`x=1 command bash -c ':'`);
    const cm = shellState(c);
    new Analyzer('en').explainLine(c, 0);
    const cs = cached(cm, descendants(c.root, ['raw_string'])[0]);
    assert.strictEqual(cs.model.at(cs.tree.root.namedChildren[0]).run.variables.get('x')?.set, 'on');
    // (A shell sets IFS itself; SHELLOPTS turns options on in bash only, and may in sh.)
    assert.strictEqual(st(2).variables.get('IFS'), undefined);
    assert.strictEqual(st(2).variables.get('v')?.value, '1');
    assert.deepStrictEqual(['errexit', 'hashall'].map((o) => option(st(2), 'set', o)), ['on', 'default']);
    assert.strictEqual(option(st(3), 'set', 'errexit'), 'default');
    assert.strictEqual(option(st(4), 'set', 'errexit'), 'unknown');
  });

  it('starts another shell with its options, without what a slot removes, and with what its startup files may set', () => {
    const start = (src: string) => {
      const tree = parser.parse(src);
      const model = shellState(tree);
      new Analyzer('en').explainLine(tree, 0);
      const strings = descendants(tree.root, ['raw_string']);
      const s = cached(model, strings[strings.length - 1]);
      return s.model.at(s.tree.root.namedChildren[0]).run;
    };
    // (`env -u x` removes `x`; an assignment after it gives it again.)
    assert.strictEqual(start(`export x=1; env -u x bash -c ':'`).variables.get('x'), undefined);
    assert.strictEqual(start(`export x=1; env --unset=x bash -c ':'`).variables.get('x'), undefined);
    assert.strictEqual(start(`export x=1; env -u x x=2 bash -c ':'`).variables.get('x')?.set, 'on');
    // (Options as the shell is started: `-e`, `-o NAME`, `+o NAME`, `-O NAME`, `--posix`.)
    assert.strictEqual(option(start(`bash -ec ':'`), 'set', 'errexit'), 'on');
    assert.strictEqual(option(start(`bash -e +e -c ':'`), 'set', 'errexit'), 'off');
    assert.strictEqual(option(start(`set -e; export SHELLOPTS; bash +e -c ':'`), 'set', 'errexit'), 'on');
    assert.strictEqual(option(start(`bash -o pipefail -u -c ':'`), 'set', 'pipefail'), 'on');
    assert.strictEqual(option(start(`bash -o pipefail -u -c ':'`), 'set', 'nounset'), 'on');
    assert.strictEqual(option(start(`bash -o pipefail +o pipefail -c ':'`), 'set', 'pipefail'), 'off');
    assert.strictEqual(option(start(`bash -O extglob -c ':'`), 'shopt', 'extglob'), 'on');
    assert.strictEqual(option(start(`bash --posix -c ':'`), 'set', 'posix'), 'on');
    assert.strictEqual(option(start(`bash -o posix -c ':'`), 'shopt', 'inherit_errexit'), 'on');
    assert.strictEqual(option(start(`bash -onounset -c ':'`), 'set', 'nounset'), 'on');
    // (An option after the string is an argument.)
    assert.strictEqual(option(start(`bash -c ':' -e`), 'set', 'errexit'), 'default');
    // (An exported BASHOPTS turns on the shopt options it names, after the options given: `+O` does not turn them off.)
    assert.strictEqual(option(start(`shopt -s extglob; export BASHOPTS; bash +O extglob -c ':'`), 'shopt', 'extglob'), 'on');
    assert.strictEqual(option(start(`shopt -s extglob; bash -c ':'`), 'shopt', 'extglob'), 'default');
    assert.strictEqual(option(start(`shopt -s extglob; export BASHOPTS; sh -c ':'`), 'shopt', 'extglob'), 'unknown');
    // (Startup files, or the file BASH_ENV names, may set any name.)
    assert.strictEqual(start(`x=1; bash -c ':'`).variables.get('x'), undefined);
    for (const src of [`x=1; bash -lc ':'`, `x=1; bash -i -c ':'`, `x=1; export BASH_ENV=f; bash -c ':'`, `x=1; BASH_ENV=f bash -c ':'`]) {
      assert.strictEqual(start(src).variables.get('x')?.set, 'unknown', src);
    }
    assert.strictEqual(start(`x=1; export BASH_ENV=; bash -c ':'`).variables.get('x'), undefined);
    assert.strictEqual(start(`f() { :; }; bash -lc ':'`).functions.get('f')?.state, 'unknown');
    // (The assignments before a function call are exported while it runs.)
    assert.strictEqual(start(`g() { bash -c ':'; }; x=1 g`).variables.get('x')?.set, 'on');
  });

  it('reads a string of 200000 characters', () => {
    const long = `x=${'a'.repeat(200000)}`;
    const tree = parser.parse(`eval '${long}'; bash -c '${long}'`);
    const model = shellState(tree);
    assert.strictEqual(model.end.variables.get('x')?.value?.length, 200000);
    new Analyzer('en').explainLine(tree, 0);
    const s = cached(model, descendants(tree.root, ['raw_string'])[1]);
    assert.strictEqual(s.text.length, long.length);
  });

  it('runs a trap set by a trap action, and widens between the sides of && too', () => {
    const tree = parser.parse(`x=5; trap "trap 'y=\\$x' USR1" INT\ntrap 'z=2' USR1; z=3 && echo "$z"`);
    const model = shellState(tree);
    const inner = cached(model, descendants(tree.root, ['string'])[0]);
    const deeper = cached(inner.model, descendants(inner.tree.root, ['raw_string'])[0]);
    const assign = descendants(deeper.tree.root, ['variable_assignment'])[0];
    assert.strictEqual(deeper.model.at(assign).run.variables.get('x')?.value, '5');
    const echo = descendants(tree.root, ['command']).find((c) => c.text.startsWith('echo'))!;
    assert.strictEqual(model.at(echo).run.variables.get('z')?.set, 'unknown');
    // (`trap - INT` resets: no command runs.)
    assert.strictEqual(shellState(parser.parse('trap - INT; v=2')).end.variables.get('v')?.value, '2');
  });

  it('gives a node of a string the walk did not run the state of its command', () => {
    const tree = parser.parse(`x=1; eval $'y=2\n(\nz=3'`);
    const model = shellState(tree);
    const s = cached(model, descendants(tree.root, ['ansi_c_string'])[0]);
    const z = descendants(s.tree.root, ['variable_assignment']).find((a) => a.text === 'z=3')!;
    assert.strictEqual(model.at(z).run.variables.get('x')?.value, '1');
    assert.strictEqual(model.end.variables.get('z'), undefined);
  });

  it(`reads strings in strings ${NESTED_DEPTH} levels deep, and ends on a function that evals itself`, () => {
    let src = 'x=1';
    for (let i = 0; i < NESTED_DEPTH + 1; i++) src = `eval ${JSON.stringify(src).replace(/\$/g, '\\$')}`;
    const tree = parser.parse(src);
    const model = shellState(tree);
    // (The innermost string is too deep: what it sets is not known.)
    assert.strictEqual(model.end.variables.get('x'), undefined);
    assert.strictEqual(shellState(parser.parse(`f() { eval f; }; f; y=1`)).end.variables.get('y')?.set, 'on');
  });
});

describe('nested scripts: the pitfall of a variable another shell does not get', () => {
  const explain = (src: string, line = 0) => new Analyzer('en').explainLine(parser.parse(src), line);

  it('says the lines of the document, where a string defines a function', () => {
    const all = (ts: { explanation: string; children: never[] }[]): string[] => ts.flatMap((t) => [t.explanation, ...all(t.children)]);
    const text = all(explain(`greet() { :; }\neval 'foo() { :; }'\nfoo`, 2).items as never).join('\n');
    assert.match(text, /defined on line 2/);
    // A call before the definition in the string: defined later.
    assert.ok(explain(`foo\neval 'foo() { :; }'`, 0).notes.some((n) => /defined as a function on line 2, but this runs before that/.test(n)));
    // (`\$x` in double quotes is text: the trap's note does not say it expands now.)
    assert.ok(!all(explain(`trap "echo \\$x" INT`).items as never).some((e) => /Double quotes expand/.test(e)));
    assert.ok(all(explain(`trap "echo $x" INT`).items as never).some((e) => /Double quotes expand `\$x`/.test(e)));
    assert.ok(all(explain(`trap "echo $(date)" INT`).items as never).some((e) => /Double quotes expand `\$\(…\)`/.test(e)));
    assert.ok(!all(explain(`trap 'rm f' INT`).items as never).some((e) => /Single quotes keep/.test(e)));
  });

  it('reads the variables a string another shell runs from its model', () => {
    const notes = (src: string, line: number) => explain(src, line).notes.filter((n) => /Pitfall/.test(n));
    assert.strictEqual(notes(`n=1\nbash -c 'echo $n'`, 1).length, 1);
    assert.strictEqual(notes(`n=1\nbash -c "echo \\$n"`, 1).length, 1);
    assert.deepStrictEqual(notes(`export n=1\nbash -c 'echo $n'`, 1), []);
    // (Set by the string itself, or given to it by the slot or an assignment before it; a file of variables may give any.)
    assert.deepStrictEqual(notes(`n=1\nbash -c 'n=2; echo $n'`, 1), []);
    assert.deepStrictEqual(notes(`n=1\nn=$n bash -c 'echo $n'`, 1), []);
    assert.deepStrictEqual(notes(`n=1\ndocker run --env-file f img sh -c 'echo $n'`, 1), []);
    // A double-quoted string is expanded here: not read for the variables of another shell.
    assert.deepStrictEqual(notes(`n=1\nbash -c "echo $n"`, 1), []);
  });
});

