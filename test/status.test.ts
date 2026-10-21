// Exit statuses and errexit (src/semantics/status.ts). Their agreement with bash is checked on the rows of
// test/fixtures/probes/status.json by test/status-probes.test.ts; this file tests the rules one by one, and the
// notes the analyzer renders from them (each one checked with bash in the comments or in status.json).
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { conditionOf, lastStatements, setsErrexit, statusModel } from '../src/semantics/status';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';
import { PROBE_ENV } from './support/probe';

const parser = createUnbashParser();
const TYPES = ['command', 'pipeline', 'list', 'negated_command', 'subshell', 'compound_statement', 'if_statement', 'while_statement', 'variable_assignment',
  'variable_assignments', 'declaration_command', 'arithmetic_command', 'extended_test', 'test_command', 'redirected_statement', 'function_definition', 'coproc_statement',
  'time_statement', 'case_statement', 'for_statement'];

/** The model of `src`, and its first statement whose text is `text`. */
function at(src: string, text: string, shell?: Shell, posix?: boolean): { node: SyntaxNode; model: ReturnType<typeof statusModel> } {
  const tree = parser.parse(src);
  const node = descendants(tree.root, TYPES).find((c) => c.text === text)!;
  assert.ok(node, text);
  return { node, model: statusModel(shellState(tree, shell, { posix }), shell) };
}
const status = (src: string, text: string) => {
  const { node, model } = at(src, text);
  return model.status(node);
};
const errexit = (src: string, text: string, shell?: Shell, posix?: boolean) => {
  const { node, model } = at(src, text, shell, posix);
  return model.errexit(node);
};
/** `active`, and the reason with `?` when on some paths only. */
const ctx = (src: string, text: string, shell?: Shell): string => {
  const e = errexit(src, text, shell);
  return `${e.active}${e.ignored ? ` ${e.ignored.why}${e.ignored.sure ? '' : '?'}` : ''}`;
};

describe('status rules (src/semantics/status.ts)', () => {
  it('gives each kind of statement its rule', () => {
    assert.deepStrictEqual(status('exit 256', 'exit 256'), { kind: 'given', by: 'exit', value: 0 });
    assert.deepStrictEqual(status('return -1', 'return -1'), { kind: 'given', by: 'return', value: 255 });
    assert.deepStrictEqual(status('return', 'return'), { kind: 'previous', by: 'return' });
    assert.deepStrictEqual(status('exit $code', 'exit $code'), { kind: 'command', functions: [] });
    assert.deepStrictEqual(status('let i=0', 'let i=0'), { kind: 'arith' });
    assert.deepStrictEqual(status('(( i ))', '(( i ))'), { kind: 'arith' });
    assert.deepStrictEqual(status('[[ x ]]', '[[ x ]]'), { kind: 'test' });
    assert.deepStrictEqual(status('[ x ]', '[ x ]'), { kind: 'test' });
    assert.deepStrictEqual(status('wait', 'wait'), { kind: 'wait', all: true });
    assert.deepStrictEqual(status('wait %1', 'wait %1'), { kind: 'wait', all: false });
    assert.deepStrictEqual(status('f() { :; }', 'f() { :; }'), { kind: 'definition' });
    assert.deepStrictEqual(status('x=1', 'x=1'), { kind: 'last-substitution' });
    assert.deepStrictEqual(status('> f', '> f'), { kind: 'last-substitution' });
    assert.deepStrictEqual(status('declare x=1', 'declare x=1'), { kind: 'command', functions: [] });
    assert.deepStrictEqual(status('if :; then :; fi', 'if :; then :; fi'), { kind: 'last-run' });
    assert.deepStrictEqual(status('time false', 'time false'), { kind: 'last-run' });
  });

  it('reads the last command substitution of an assignment, not one inside it', () => {
    const r = status('x=$(a $(b)) y=$(c)', 'x=$(a $(b)) y=$(c)');
    assert.ok(r.kind === 'last-substitution' && r.at?.text === '$(c)');
    const m = status('local x=$(a) y="$(b)"', 'local x=$(a) y="$(b)"');
    assert.ok(m.kind === 'masked' && m.by === 'local' && m.substitutions.map((s) => s.text).join() === '$(a),$(b)');
  });

  it('reads pipefail where the pipeline runs, and `!`', () => {
    assert.deepStrictEqual(status('a | b', 'a | b'), { ...status('a | b', 'a | b'), pipefail: 'off', negated: false });
    const p = status('set -o pipefail; a | b', 'a | b');
    assert.ok(p.kind === 'pipeline' && p.pipefail === 'on');
    const u = status('[ x ] && set -o pipefail; a | b', 'a | b');
    assert.ok(u.kind === 'pipeline' && u.pipefail === 'unknown');
    const n = status('! a | b', '! a | b');
    assert.ok(n.kind === 'pipeline' && n.negated && n.stages.length === 2);
    const one = status('! a', '! a');
    assert.ok(one.kind === 'pipeline' && one.negated && one.stages.length === 1);
    // (`!` alone, while typing.)
    const bare = status('!', '!');
    assert.ok(bare.kind === 'pipeline' && !bare.stages.length);
    const redirected = status('a | b > f', 'a | b > f');
    assert.strictEqual(redirected.kind, 'pipeline');
  });

  it('gives a job 0, with its own rule for `wait`', () => {
    const r = status('false &', 'false');
    assert.ok(r.kind === 'background' && r.job.kind === 'command');
    const c = status('coproc cat', 'coproc cat');
    const named = status('coproc C { cat; }', 'coproc C { cat; }');
    assert.ok(named.kind === 'background' && named.job.kind === 'last-run');
    assert.ok(c.kind === 'background');
    const w = status('a &\nb &\nwait $!', 'wait $!');
    assert.ok(w.kind === 'wait' && w.job?.text === 'b');
    // (A job of a function body or of a subshell is not the one `$!` names outside it.)
    const f = status('f() { a & }\n( b & )\nc &\n( wait $! )', 'wait $!');
    assert.ok(f.kind === 'wait' && !f.job);
    const g = status('f() { a & wait $!; }', 'wait $!');
    assert.ok(g.kind === 'wait' && g.job?.text === 'a');
  });

  it('knows the functions a command calls', () => {
    const r = status('f() { :; }; f', 'f');
    assert.ok(r.kind === 'command' && r.functions.length === 1);
  });
});

describe('errexit contexts (src/semantics/status.ts)', () => {
  it('reads errexit where the statement runs', () => {
    assert.strictEqual(ctx('false', 'false'), 'off');
    assert.strictEqual(ctx('set -e; false', 'false'), 'on');
    assert.strictEqual(ctx('[ x ] && set -e; false', 'false'), 'unknown');
  });

  it('ignores it in conditions, left of && and ||, after !', () => {
    assert.strictEqual(ctx('set -e; if a; b; then c; elif d; then e; fi', 'b'), 'off condition');
    assert.strictEqual(ctx('set -e; if a; then c; elif d; then e; fi', 'd'), 'off condition');
    assert.strictEqual(ctx('set -e; if a; then c; elif d; then e; fi', 'e'), 'on');
    assert.strictEqual(ctx('set -e; while a; do b; done', 'a'), 'off condition');
    assert.strictEqual(ctx('set -e; until a; do b; done', 'b'), 'on');
    assert.strictEqual(ctx('set -e; a && b || c', 'b'), 'off and-or');
    assert.strictEqual(ctx('set -e; a && b || c', 'c'), 'on');
    assert.strictEqual(ctx('set -e; ! a', '! a'), 'off negated');
    assert.strictEqual(ctx('set -e; ! a', 'a'), 'off negated');
    // (It reaches into a subshell: `if (false; echo in)` prints in.)
    assert.strictEqual(ctx('set -e; if (a; b); then :; fi', 'a'), 'off condition');
  });

  it('ignores it in a function called where it is ignored, on every call or some', () => {
    assert.strictEqual(ctx('set -e; f() { a; b; }; if f; then :; fi', 'a'), 'off called-in-condition');
    assert.strictEqual(ctx('set -e; f() { a; b; }; f || :; f', 'a'), 'unknown called-in-condition?');
    assert.strictEqual(ctx('set -e; f() { a; b; }; f', 'a'), 'on');
    assert.strictEqual(ctx('set -e; f() { a; b; }', 'a'), 'on');
    // (A function that calls itself: the inner call does not make it ignored.)
    assert.strictEqual(ctx('set -e; f() { a; f; }; f', 'a'), 'on');
    assert.strictEqual(ctx('set -e; f() { a; f || :; }; f', 'a'), 'unknown called-in-condition?');
  });

  it('turns errexit off in `$( )` in bash, unless inherit_errexit or POSIX mode', () => {
    assert.strictEqual(ctx('set -e; x=$(a; b)', 'a'), 'off');
    assert.strictEqual(ctx('set -e; shopt -s inherit_errexit; x=$(a; b)', 'a'), 'on');
    assert.strictEqual(ctx('set -e; [ x ] && shopt -s inherit_errexit; x=$(a; b)', 'a'), 'unknown');
    assert.strictEqual(ctx('set -e; set -o posix; x=$(a; b)', 'a'), 'on');
    assert.strictEqual(errexit('set -e; x=$(a; b)', 'a', 'bash', true).active, 'on');
    assert.strictEqual(ctx('set -e; x=$(a; b)', 'a', 'sh'), 'on');
    assert.strictEqual(ctx('x=$(set -e; a; b)', 'a'), 'on');
  });

  it('says which statements are checked, and which shell stops', () => {
    const e = (src: string, text: string) => {
      const c = errexit(src, text);
      return `${c.checked ? 'checked' : '-'} ${c.stops}`;
    };
    assert.strictEqual(e('set -e; a', 'a'), 'checked script');
    assert.strictEqual(e('set -e; { a; }', '{ a; }'), '- script');
    assert.strictEqual(e('set -e; (a)', '(a)'), 'checked script');
    assert.strictEqual(e('set -e; (a)', 'a'), 'checked subshell');
    assert.strictEqual(e('set -e; a | b', 'a'), '- subshell');
    assert.strictEqual(e('set -e; a | b', 'a | b'), 'checked script');
    assert.strictEqual(e('set -e; a &', 'a'), '- subshell');
    assert.strictEqual(e('set -e; local x=1 y=2', 'x=1'), '- script');
    assert.strictEqual(e('set -e; [ x ] && shopt -s lastpipe; a | { b; c; }', 'b'), 'checked unknown');
  });

  it('finds a word bash surely fails on, with what is known of the environment', () => {
    const { node, model } = at('set -u; echo "$nope" $(echo $inner)', 'echo "$nope" $(echo $inner)');
    assert.strictEqual(model.expansionError(node), undefined);
    assert.strictEqual(model.expansionError(node, { variables: PROBE_ENV })?.word.text, '"$nope"');
    const set = at('set -u; nope=1; echo "$nope" > $out', 'echo "$nope" > $out');
    assert.strictEqual(set.model.expansionError(set.node, { variables: PROBE_ENV })?.word.text, '$out');
    const fine = at('set -u; x=1; echo "$x" a', 'echo "$x" a');
    assert.strictEqual(fine.model.expansionError(fine.node, { variables: PROBE_ENV }), undefined);
  });
});

describe('helpers of the status model', () => {
  it('finds a `set` that turns errexit on', () => {
    const sets = (src: string) => setsErrexit(descendants(parser.parse(src).root, ['command'])[0]);
    for (const yes of ['set -e', 'set -euo pipefail', 'set -o errexit', 'set -xe', 'set -uo errexit']) assert.ok(sets(yes), yes);
    for (const no of ['set +e', 'set -u', 'set -o pipefail', 'set -- -e', 'set errexit', 'echo -e', '"$x" -e']) assert.ok(!sets(no), no);
  });

  it('finds the condition of an `if` that is not closed', () => {
    const tree = parser.parse('if a; b');
    const n = descendants(tree.root, ['if_statement'])[0];
    assert.deepStrictEqual(conditionOf(n)!.map((c) => c.text), ['a', 'b']);
    assert.strictEqual(conditionOf(descendants(tree.root, ['command'])[0]), undefined);
  });

  it('finds the last statements of a body', () => {
    const last = (src: string, type: string) => lastStatements(descendants(parser.parse(src).root, [type])[0]).map((n) => n.text);
    assert.deepStrictEqual(last('{ a; b && c; }', 'compound_statement'), ['b && c']);
    assert.deepStrictEqual(last('(a; { b; c; })', 'subshell'), ['c']);
    assert.deepStrictEqual(last('{ a; } > f', 'redirected_statement'), ['a']);
    assert.deepStrictEqual(last('a; b', 'program'), ['b']);
    assert.deepStrictEqual(last('# c', 'program'), []);
    assert.deepStrictEqual(last('{ a; > f; }', 'compound_statement'), ['> f']);
  });
});

/** The notes of line `line` of `src`. */
function notes(src: string, line: number, lang: 'en' | 'ja' = 'en', shell?: Shell): string[] {
  return new Analyzer(lang).explainLine(parser.parse(src), line, shell).notes;
}
/** The explanations of the tokens of line `line`, flattened. */
function explanations(src: string, line: number, lang: 'en' | 'ja' = 'en'): string[] {
  const out: string[] = [];
  const walk = (t: { explanation: string; children: unknown[] }) => {
    out.push(t.explanation);
    (t.children as typeof t[]).forEach(walk);
  };
  new Analyzer(lang).explainLine(parser.parse(src), line).items.forEach(walk);
  return out;
}

describe('the notes on status and errexit', () => {
  it('says that `x=$(cmd)` stops the script under set -e, and `echo $(cmd)` does not', () => {
    // bash -ec 'x=$(false); echo after' prints nothing; 'echo $(false); echo after' prints after.
    assert.ok(explanations('set -e\nx=$(false)', 1).some((e) => /Under `set -e` the script stops here if it fails/.test(e)));
    assert.ok(explanations('set -e\nx=$(false)', 1, 'ja').some((e) => /スクリプトはここで止まる/.test(e)));
    assert.ok(explanations('set -e\nx=$(false)$(true)', 1).some((e) => /If it fails, `set -e` does not stop the script \(an assignment/.test(e)));
    assert.ok(explanations('set -e\necho "$(false)"', 1).some((e) => /the status is that of `echo`/.test(e)));
    assert.ok(explanations('set -e\nlocal x=$(false)', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('x=$(false)', 0).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\nif x=$(false); then :; fi', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\n(x=$(false))', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\nfor f in $(ls); do :; done', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\n"$(cmd)" a', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\necho $(a $(false))', 1).some((e) => /the status is that of `echo`/.test(e)));
    assert.ok(explanations('set -e\ndiff <(echo $(false)) b', 1).every((e) => !/set -e/.test(e)));
  });

  it('points out `local x=$(cmd)`, also quoted', () => {
    for (const src of ['f() {\nlocal out=$(cmd)\n}', 'f() {\nlocal out="$(cmd)"\n}']) {
      assert.ok(notes(src, 1).some((n) => /the status of `local out=\$\(…\)` is that of `local` \(success\)/.test(n)), src);
      assert.ok(notes(src, 1, 'ja').some((n) => /`local out=\$\(…\)` の終了ステータスは `local` 自身のもの/.test(n)), src);
    }
    assert.deepStrictEqual(new Analyzer('en').explainLine(parser.parse('f() {\nlocal out=$(cmd)\n}'), 1, undefined, { pitfalls: false }).notes, []);
  });

  it('points out a pipeline without pipefail under set -e', () => {
    // bash -ec 'false | tee /dev/null; echo after' prints after.
    assert.ok(notes('set -e\nfalse | tee log', 1).some((n) => /without `set -o pipefail`, the status of a pipeline is that of its last command \(`tee log`\)/.test(n)));
    assert.ok(notes('set -e\nfalse | tee log', 1, 'ja').some((n) => /`set -o pipefail` が無いので/.test(n)));
    for (const src of ['set -eo pipefail\na | b', 'a | b', 'set -e\nif a | b; then :; fi', 'set -e\n! a | b']) assert.ok(!notes(src, src.split('\n').length - 1).some((n) => /pipefail/.test(n)), src);
    assert.ok(!notes('set -e\na | b', 1, 'en', 'sh').some((n) => /pipefail/.test(n)));
  });

  it('points out a function that ends with `test && cmd` under set -e', () => {
    // status.json: `f() { [ -f nofile ] && echo found; }; f` stops the script with status 1.
    const src = 'set -e\nf() {\n  [ -f x ] && echo found\n}\nf';
    assert.ok(notes(src, 2).some((n) => /this is the last command of `f`, so when the left side of `&&` fails, `f` returns its non-zero status and `set -e` stops the script at the call on line 5/.test(n)));
    assert.ok(notes(src, 2, 'ja').some((n) => /関数 `f` の最後のコマンド/.test(n)));
    for (const quiet of ['set -e\nf() {\n  [ -f x ] && echo found\n}\nif f; then :; fi', 'f() {\n  [ -f x ] && echo found\n}\nf', 'set -e\nf() {\n  [ -f x ] || echo none\n}\nf',
      'set -e\nf() {\n  [ -f x ] && echo found; :\n}\nf', 'set -e\nf() {\n  [ -f x ] && a || b\n}\nf',
      'set -e\nf() {\n  [ -f x ] && echo found\n}']) {
      assert.ok(!notes(quiet, 2).some((n) => /last command of/.test(n)), quiet);
    }
    assert.ok(!notes('set -e\n[ -f x ] && echo found', 1).some((n) => /last command of/.test(n)));
  });

  it('says where set -e has no effect', () => {
    // status.json: `set +e; f() { set -e; false; @in@; }; if f; then …` runs in, then stops at the next false.
    const fn = 'f() {\n  set -e\n  false\n}\nif f; then :; fi';
    assert.ok(notes(fn, 1).some((n) => /This `set -e` takes effect only when the call of `f` returns: `f` is called where `set -e` is ignored \(line 5\)/.test(n)));
    assert.ok(notes(fn, 1, 'ja').some((n) => /`f` の呼び出しが終わるまで効かない/.test(n)));
    const some = 'f() {\n  set -e\n  false\n}\nf || :\nf';
    assert.ok(notes(some, 1).some((n) => /`f` is also called where `set -e` is ignored \(line 5\)/.test(n)));
    assert.ok(notes(some, 1, 'ja').some((n) => /からも呼ばれ/.test(n)));
    // status.json: `( set -e; false; @in@ ) || @or@` runs in.
    assert.ok(notes('( set -e; false; echo in ) || echo or', 0).some((n) => /This `set -e` has no effect: this subshell runs on the left side of `\|\|`/.test(n)));
    assert.ok(notes('( set -e; false; echo in ) || echo or', 0, 'ja').some((n) => /このサブシェルは `\|\|` の左側にあり/.test(n)));
    assert.ok(notes('if { set -e; false; }; then :; fi', 0).some((n) => /takes effect only when the command that holds it ends: `set -e` is ignored in the condition of `if` \(line 1\)/.test(n)));
    assert.ok(notes('if { set -e; false; }; then :; fi', 0, 'ja').some((n) => /それを含むコマンドが終わるまで効かない/.test(n)));
    assert.ok(notes('! { set -e; false; }', 0).some((n) => /ignored after `!`/.test(n)));
    assert.ok(notes('! { set -e; false; }', 0, 'ja').some((n) => /`!` のあと/.test(n)));
    assert.ok(notes('while { set -e; false; }; do :; done', 0).some((n) => /condition of `while`/.test(n)));
    assert.ok(!notes('set -e', 0).some((n) => /set -e/.test(n)));
  });

  it('says that set -e is ignored in a group or a function run where it is ignored', () => {
    // bash -ec '( cd /nowhere; echo in ) || echo or' prints in.
    assert.ok(notes('set -e\n( cd /nowhere; rm x ) || echo failed', 1).some((n) => /`set -e` is ignored in this `\( \)`, since it runs on the left side of `\|\|`/.test(n)));
    assert.ok(notes('set -e\n( cd /nowhere; rm x ) || echo failed', 1, 'ja').some((n) => /`\|\|` の左側で実行されるので、`\( \)`の中でも/.test(n)));
    assert.ok(notes('set -e\nif { a; b; }; then :; fi', 1).some((n) => /ignored in this `\{ \}`/.test(n)));
    assert.ok(notes('set -e\n( a > f; b ) || :', 1).some((n) => /ignored in this `\( \)`/.test(n)));
    for (const quiet of ['( cd /x; rm y ) || echo failed', 'set -e\n( x=1; rm y ) || :', 'set -e\n( > f; rm y ) || :', 'set -e\n( a ) || :', 'set -e\n( a; b )']) assert.ok(!notes(quiet, quiet.split('\n').length - 1).some((n) => /is ignored in/.test(n)), quiet);
    const fn = 'set -e\nf() {\n  cd /x\n  rm y\n}\nif f; then :; fi';
    assert.ok(notes(fn, 1).some((n) => /`f` is called only where `set -e` is ignored \(line 6\), so it is ignored in all of its body too/.test(n)));
    assert.ok(notes(fn, 1, 'ja').some((n) => /からしか呼ばれないので/.test(n)));
    for (const quiet of ['set -e\nf() {\n  cd /x\n  rm y\n}\nf || :\nf', 'f() {\n  cd /x\n  rm y\n}\nif f; then :; fi', 'set -e\nf() {\n  x=1\n  rm y\n}\nif f; then :; fi',
      'set -e\nf() { rm y; }\nif f; then :; fi', 'set -e\nf() {\n  set -e\n  rm y\n}\nif f; then :; fi', 'set -e\nf() {\n  cd /x\n  rm y\n}']) {
      assert.ok(!notes(quiet, 1).some((n) => /called only where/.test(n)), quiet);
    }
  });

  it('says that bash turns set -e off in `$( )`', () => {
    // status.json: `x=$(false; @in@); @after@` under bash -e runs in and after.
    assert.ok(notes('set -e\nx=$(cd /nowhere; ls)', 1).some((n) => /bash turns `set -e` off inside `\$\( \)` \(without `shopt -s inherit_errexit`\): if `cd \/nowhere` fails/.test(n)));
    assert.ok(notes('set -e\nx=$(cd /nowhere; ls)', 1, 'ja').some((n) => /`\$\( \)` の中では `set -e` を切る/.test(n)));
    for (const quiet of ['set -e\nx=$(cd /nowhere && ls)', 'x=$(cd /nowhere; ls)', 'set -e\nshopt -s inherit_errexit\nx=$(cd /nowhere; ls)', 'set -e\nx=$(set -e; ls)']) {
      assert.ok(!notes(quiet, quiet.split('\n').length - 1).some((n) => /inherit_errexit/.test(n)), quiet);
    }
  });

  it('drops the set -e part of the `((i++))` pitfall where set -e is ignored', () => {
    assert.ok(notes('((i++)) || true', 0).some((n) => /the exit status is 1 when `i` is 0$/.test(n)));
    assert.ok(notes('((i--)) || true', 0, 'ja').some((n) => /`\(\(i--\)\)` の値は減らす前の値なので、`i` が 0 のとき終了ステータスは 1 になる$/.test(n)));
    assert.ok(notes('((i++))', 0).some((n) => /under `set -e` the script stops/.test(n)));
  });
});
