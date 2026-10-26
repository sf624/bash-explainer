// Exit statuses and errexit (src/semantics/status.ts). Their agreement with bash is checked on the rows of
// test/fixtures/probes/status.json by test/status-probes.test.ts; this file tests the rules one by one, and the
// notes the analyzer renders from them (each one checked with bash in the comments or in status.json).
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { conditionOf, lastStatements, statusModel } from '../src/semantics/status';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';
import { runBash } from './support/bash';
import { PROBE_ENV } from './support/probe';

const parser = createUnbashParser();
const TYPES = ['command', 'pipeline', 'list', 'negated_command', 'subshell', 'compound_statement', 'if_statement', 'while_statement', 'variable_assignment',
  'arithmetic_command', 'extended_test', 'redirected_statement', 'function_definition', 'coproc_statement',
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
    assert.deepStrictEqual(status('exit 256', 'exit 256'), { kind: 'given', ends: 'shell', value: 0 });
    assert.deepStrictEqual(status('return -1', 'return -1'), { kind: 'given', ends: 'function', value: 255 });
    assert.deepStrictEqual(status('return', 'return'), { kind: 'previous', ends: 'function' });
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
    const u = status('[ -f x ] && set -o pipefail; a | b', 'a | b');
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

  it('knows the functions a command calls (B3), also one named like a builtin', () => {
    const r = status('f() { :; }; f', 'f');
    assert.ok(r.kind === 'command' && r.functions.length === 1);
    const w = status('wait() { :; }; wait', 'wait');
    assert.ok(w.kind === 'command' && w.functions.length === 1);
    const l = status('local() { :; }; local x=$(a)', 'local x=$(a)');
    assert.ok(l.kind === 'command' && l.functions.length === 1, JSON.stringify(l.kind));
    const a = status('f() { :; }; alias g=f; g', 'g');
    assert.ok(a.kind === 'command');
    assert.deepStrictEqual(status('"$cmd" x', '"$cmd" x'), { kind: 'command', functions: [] });
  });
});

describe('errexit contexts (src/semantics/status.ts)', () => {
  it('reads errexit where the statement runs', () => {
    assert.strictEqual(ctx('false', 'false'), 'off');
    assert.strictEqual(ctx('set -e; false', 'false'), 'on');
    assert.strictEqual(ctx('[ -f x ] && set -e; false', 'false'), 'unknown');
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
    assert.strictEqual(ctx('set -e; [ -f x ] && shopt -s inherit_errexit; x=$(a; b)', 'a'), 'unknown');
    assert.strictEqual(ctx('set -e; set -o posix; x=$(a; b)', 'a'), 'on');
    assert.strictEqual(errexit('set -e; x=$(a; b)', 'a', 'bash', true).active, 'on');
    assert.strictEqual(ctx('set -e; x=$(a; b)', 'a', 'sh'), 'on');
    assert.strictEqual(ctx('x=$(set -e; a; b)', 'a'), 'on');
    // (A function called in `$( )`: bash -ec 'f() { false; echo in; }; x=$(f); echo "$x"' prints in.)
    assert.strictEqual(ctx('set -e; f() { a; b; }; x=$(f)', 'a'), 'off');
    assert.strictEqual(ctx('set -e; f() { a; b; }; x=$(f); f', 'a'), 'unknown');
    assert.strictEqual(ctx('set -e; f() { a; b; }; f', 'a'), 'on');
    assert.strictEqual(ctx('set -e; f() { set -e; a; }; x=$(f)', 'a'), 'on');
    assert.strictEqual(ctx('set -e; f() { a; x=$(f); }; x=$(f)', 'a'), 'off');
    // (A recursive call in `$( )`: bash -ec 'f() { m1; …; x=$(f); }; f' runs m1 with errexit on, then off; also
    // through another function, `f() { m1; x=$(g); }; g() { f; }`. Called only in `$( )`, it stays off.)
    assert.strictEqual(ctx('set -e; f() { a; x=$(f); }; f', 'a'), 'unknown');
    assert.strictEqual(ctx('set -e; f() { a; x=$(g); }; g() { f; }; f', 'a'), 'unknown');
    assert.strictEqual(ctx('set -e; f() { a; x=$(g); }; g() { f; }; f', 'f'), 'off');
    assert.strictEqual(ctx('set -e; f() { a; f; }; f', 'a'), 'on');
    assert.strictEqual(ctx('set -e; f() { a; x=$(g); }; g() { b; }; f', 'a'), 'on');
    assert.strictEqual(ctx('set -e; f() { a; set +e; f; }; f', 'a'), 'unknown');
    // (After the call, errexit is what the call left: on. bash -ec runs b, c and d with errexit on; in the cycle
    // f → g → $(h) → f, g's c runs with it on and off.)
    assert.strictEqual(ctx('set -e; f() { a; x=$(f); }; f; b', 'b'), 'on');
    assert.strictEqual(ctx('set -e; f() { a; x=$(f); }; if f; then b; fi', 'b'), 'on');
    assert.strictEqual(ctx('set -e; f() { a; x=$(f) && c; }; f && b', 'b'), 'on');
    assert.strictEqual(ctx('set -e; f() { a; x=$(g); }; g() { h; }; h() { f; }; f; b', 'b'), 'on');
    assert.strictEqual(ctx('set -e; f() { g; }; g() { c; x=$(h); }; h() { f; }; f; b', 'c'), 'unknown');
    assert.strictEqual(ctx('set -e; f() { g; }; g() { c; x=$(h); }; h() { f; }; f; b', 'b'), 'on');
    assert.strictEqual(ctx('set -e; f() { a; x=$(f); }; f; set +e; d; set -e; f; b', 'd'), 'off');
    assert.strictEqual(ctx('set -e; f() { a; x=$(g); }; g() { b; }; f', 'b'), 'off');
  });

  it('says which statements are checked, and which shell stops', () => {
    const e = (src: string, text: string) => {
      const c = errexit(src, text);
      return `${c.checked === true ? 'checked' : c.checked.why} ${c.stops}`;
    };
    assert.strictEqual(e('set -e; a', 'a'), 'checked script');
    assert.strictEqual(e('set -e; { a; }', '{ a; }'), 'compound script');
    assert.strictEqual(e('set -e; (a)', '(a)'), 'checked script');
    assert.strictEqual(e('set -e; (a)', 'a'), 'checked subshell');
    assert.strictEqual(e('set -e; a | b', 'a'), 'pipeline-stage subshell');
    assert.strictEqual(e('set -e; a | b', 'a | b'), 'checked script');
    assert.strictEqual(e('set -e; a &', 'a'), 'job subshell');
    assert.strictEqual(e('set -e; coproc a', 'coproc a'), 'job script');
    assert.strictEqual(e('set -e; local x=1 y=2', 'x=1'), 'part-of-command script');
    assert.strictEqual(e('set -e; [ -f x ] && shopt -s lastpipe; a | { b; c; }', 'b'), 'checked unknown');
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
  it('finds a `set` that turns errexit on, from the state before and after it', () => {
    // (The last `set` command of the snippet.)
    const sets = (src: string) => {
      const tree = parser.parse(src);
      const node = descendants(tree.root, ['command']).filter((c) => /^(set|echo|"\$x")(\s|$)/.test(c.text)).pop()!;
      return statusModel(shellState(tree)).turnsErrexitOn(node);
    };
    for (const yes of ['set -e', 'set -euo pipefail', 'set -o errexit', 'set -xe', 'set -uo errexit', 'f() { set -e; }; if f; then :; fi']) assert.ok(sets(yes), yes);
    // (In the walk of a function called after `set -e`, errexit is on already.)
    for (const no of ['set +e', 'set -u', 'set -o pipefail', 'set -- -e', 'set errexit', 'echo -e', '"$x" -e', 'set -e; set -eu', 'set -e; f() { set -e; }; if f; then :; fi']) assert.ok(!sets(no), no);
  });

  it('says why errexit is what it is', () => {
    const why = (src: string, text: string, posix?: boolean) => errexit(src, text, undefined, posix).errexitWhy;
    assert.strictEqual(why('a', 'a'), 'default');
    assert.strictEqual(why('set -e; a', 'a'), 'set');
    assert.strictEqual(why('set -e; x=$(a)', 'a'), 'off-in-substitution');
    assert.strictEqual(why('set -e; shopt -s inherit_errexit; x=$(a)', 'a'), 'inherit_errexit');
    assert.strictEqual(why('set -e; set -o posix; x=$(a)', 'a'), 'posix');
    assert.strictEqual(why('set -e; x=$(set -e; a)', 'a'), 'set');
    assert.strictEqual(why('x=$(a)', 'a'), 'default');
    // (From the state: a function called in `$( )`, a `$( )` in one, `#!/bin/bash --posix`, a `$( )` in a `$( )` where errexit is off.)
    assert.strictEqual(why('set -e; f() { a; }; x=$(f)', 'a'), 'off-in-substitution');
    assert.strictEqual(why('set -e; f() { a; }; x=$(f); f', 'a'), 'off-in-substitution');
    assert.strictEqual(why('set -e; f() { x=$(a); }; f', 'a'), 'off-in-substitution');
    assert.strictEqual(why('set -e; shopt -s inherit_errexit; f() { a; }; x=$(f); shopt -u inherit_errexit; f', 'a'), 'set');
    assert.strictEqual(why('set -e; shopt -s inherit_errexit; f() { a; }; x=$(f)', 'a'), 'inherit_errexit');
    assert.strictEqual(why('#!/bin/bash --posix\nset -e; x=$(a)', 'a'), 'posix');
    assert.strictEqual(why('set -e; x=$(y=$(a))', 'a'), 'set');
    assert.strictEqual(why('set -e; x=$(if b; then set +e; fi; a)', 'a'), 'off-in-substitution');
  });

  it('finds the pipelines that hide a failure without pipefail', () => {
    const hides = (src: string) => {
      const { node, model } = at(src, src.split('; ').pop()!);
      return model.hidesFailure(node);
    };
    for (const yes of ['a | b', 'echo $(a) | b', 'cat f | b', 'a | grep x', 'a | sed s/a/b/', 'a | head -1 > f'.replace(' head -1', ' tr a b')]) assert.ok(hides(yes), yes);
    for (const no of ['set -o pipefail; a | b', '! a | b', 'echo x | b', 'printf "%s" x | b', 'cat <<EOF | b\nx\nEOF'.replace(/\\n/g, '\n'), 'a | head -1', 'a | grep -q x', 'a | egrep -q x', 'a | fgrep -m1 x',
      'a | grep -m1 x', "a | sed '1q'", 'a b', 'echo x > f | b'.replace(' > f', '') + '; echo x | b']) assert.ok(!hides(no), no);
    assert.ok(hides('cat <<EOF f | b\nx\nEOF'.replace(/\\n/g, '\n')));
    assert.ok(hides('echo x > f | b'));
    assert.ok(hides('a | grep -v x > f'));
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
    assert.ok(explanations('set -e\nx=$(false)$(true)', 1).some((e) => /If it fails, `set -e` does not stop the script \(a command with no name/.test(e)));
    assert.ok(explanations('set -e\necho "$(false)"', 1).some((e) => /the status is that of `echo`/.test(e)));
    assert.ok(explanations('set -e\nlocal x=$(false)', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('x=$(false)', 0).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\nif x=$(false); then :; fi', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\n(x=$(false))', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\nfor f in $(ls); do :; done', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\n"$(cmd)" a', 1).every((e) => !/set -e/.test(e)));
    assert.ok(explanations('set -e\necho $(a $(false))', 1).some((e) => /the status is that of `echo`/.test(e)));
    assert.ok(explanations('set -e\ndiff <(echo $(false)) b', 1).every((e) => !/set -e/.test(e)));
    // bash -ec 'n=$(grep -c x /dev/null || true); echo after' prints after.
    for (const ok of ['n=$(grep -c x f || true)', 'n=$(grep -c x f || :)']) assert.ok(explanations(`set -e\n${ok}`, 1).every((e) => !/set -e/.test(e)), ok);
    assert.ok(explanations('set -e\nn=$(grep -c x f || echo 0)', 1).some((e) => /stops here/.test(e)));
    assert.ok(explanations('set -e\nn=$(grep -c x f && true)', 1).some((e) => /stops here/.test(e)));
  });

  it('points out `local x=$(cmd)`, also quoted, not `export $(cmd)`', () => {
    assert.ok(!notes('export $(cat .env)', 0).some((n) => /hides a failure/.test(n)));
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
    const src = 'set -e\nf() {\n  [ -f x ] && echo found\n}\nf\necho done';
    assert.ok(notes(src, 2).some((n) => /this is the last command of `f`, so when the left side of `&&` fails, `f` returns its non-zero status and `set -e` stops the script at the call on line 5/.test(n)));
    assert.ok(notes(src, 2, 'ja').some((n) => /`set -e` により行 5 の呼び出しでスクリプトが止まる/.test(n)));
    // bash -ec 'f() { [ -f nofile ] && echo found; }; f'; echo $? prints 1.
    const end = 'set -e\nf() {\n  [ -f x ] && echo found\n}\nf > log';
    assert.ok(notes(end, 2).some((n) => /`f` returns its non-zero status, and so does the script, which ends with the call on line 5/.test(n)));
    assert.ok(notes(end, 2, 'ja').some((n) => /終わるスクリプトもその終了ステータスになる/.test(n)));
    for (const left of ['[[ -n $x ]]', '(( n ))', 'test -f x', 'grep -q x f', 'egrep -q x f', 'fgrep --quiet x f', 'grep --quiet x f', '[ -f x ] && [ -r x ]']) {
      assert.ok(notes(`set -e\nf() {\n  ${left} && echo found\n}\nf\n:`, 2).some((n) => /last command of/.test(n)), left);
    }
    for (const left of ['mkdir -p d', 'grep x f', 'cd d', '[ -f x ] && cd d', 'x=1', 'test() { :; }; test x']) {
      assert.ok(!notes(`set -e\nf() {\n  ${left} && echo found\n}\nf\n:`, 2).some((n) => /last command of/.test(n)), left);
    }
    for (const quiet of ['set -e\nf() {\n  [ -f x ] && echo found\n}\nif f; then :; fi', 'f() {\n  [ -f x ] && echo found\n}\nf', 'set -e\nf() {\n  [ -f x ] || echo none\n}\nf',
      'set -e\nf() {\n  [ -f x ] && echo found; :\n}\nf', 'set -e\nf() {\n  [ -f x ] && a || b\n}\nf',
      'set -e\nf() {\n  [ -f x ] && echo found\n}']) {
      assert.ok(!notes(quiet, 2).some((n) => /last command of/.test(n)), quiet);
    }
    assert.ok(!notes('set -e\n[ -f x ] && echo found', 1).some((n) => /last command of/.test(n)));
  });

  it('points out a script run as a program that ends with `test && cmd`', () => {
    const last = (src: string, lang: 'en' | 'ja' = 'en') => notes(src, src.split('\n').length - 1, lang).filter((n) => /last command of the script|スクリプトの最後のコマンド/.test(n));
    assert.deepStrictEqual(last('#!/bin/bash\necho start\n[ -f x ] && echo found'), ['ⓘ Caveat: this is the last command of the script, so when `[ -f x ]` fails, the script ends with its non-zero status, which its caller (CI, `make`, `./script && next`) sees as a failure. Write `if …; then …; fi`, or end the script with `exit 0`']);
    assert.deepStrictEqual(last('#!/bin/bash\n[ -f x ] && echo found', 'ja'), ['ⓘ 注意: これはスクリプトの最後のコマンドなので、`[ -f x ]` が失敗すると、スクリプトはその終了ステータス（0 以外）で終わり、呼び出し元（CI や `make`、`./script && next`）には失敗に見えます。`if …; then …; fi` と書くか、最後に `exit 0` を置きます']);
    for (const src of ['#!/bin/sh\nset -e\n[[ -n $v ]] && echo v', '#!/bin/bash\n{ echo a; (( n )) && echo n; }', '#!/bin/bash\ngrep -q x f && echo x', '#!/bin/bash\n[ -f x ] && [ -r x ] && cat x']) {
      assert.strictEqual(last(src).length, 1, src);
    }
    // Not a file sourced or typed in (no shebang), `||`, a command after it, a command whose failure is an error, nor in a function.
    for (const src of ['echo start\n[ -f x ] && echo found', '#!/bin/bash\n[ -f x ] || echo none', '#!/bin/bash\n[ -f x ] && echo found\nexit 0', '#!/bin/bash\n[ -f x ] && echo found\necho done',
      '#!/bin/bash\nmkdir d && cd d', '#!/bin/bash\nf() { [ -f x ] && echo found; }', '#!/bin/bash\n[ -f x ] && a || b', '#!/bin/bash\nx=$([ -f x ] && echo found)', '#!/bin/bash\n( [ -f x ] && echo found ) &', '#!/bin/bash\n[ -f x ] && echo found &']) {
      assert.deepStrictEqual(last(src), [], src);
    }
  });
  it('a script that ends with `test && cmd` exits with the status of the test, and the rewrites with 0 (bash)', () => {
    for (const program of [undefined, ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])]) {
      // (Run as a program would run it: the file is the script.)
      const run = (body: string) => runBash(`printf '%s\\n' '#!/bin/bash' ${body.split('\n').map((l) => `'${l}'`).join(' ')} > s; ${program ?? 'bash'} s`, { program, files: [] });
      assert.deepStrictEqual(run('echo start\n[ -f nofile ] && echo found'), { stdout: 'start\n', stderr: '', status: 1 });
      assert.strictEqual(run('echo start\nif [ -f nofile ]; then echo found; fi').status, 0);
      assert.strictEqual(run('echo start\n[ -f nofile ] && echo found\nexit 0').status, 0);
      // (In a function under `set -e`: the call stops the script, as the note of the function says.)
      assert.deepStrictEqual(run('f() { [ -f nofile ] && :; }\nset -e\nf\necho after'), { stdout: '', stderr: '', status: 1 });
    }
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
    // A `set -e` that is itself in the ignored place takes effect at once: bash -c 'set -e && false; echo a' prints nothing,
    // and so does bash -c 'if set -e; then false; echo in; fi'; bash -c '{ set -e; false; echo in; } || :' prints in.
    for (const quiet of ['set -e && apt-get update && x=$(false)', 'if set -e; then false; fi', 'a && set -e && b', '! set -e']) assert.ok(!notes(quiet, 0).some((n) => /This `set -e`/.test(n)), quiet);
    assert.ok(notes('{ set -e; false; echo in; } || :', 0).some((n) => /This `set -e` takes effect only when the command that holds it ends: `set -e` is ignored on the left side of `\|\|`/.test(n)));
  });

  it('says that set -e is ignored in a group or a function run where it is ignored', () => {
    // bash -ec '( cd /nowhere; echo in ) || echo or' prints in.
    assert.ok(notes('set -e\n( cd /nowhere; rm x ) || echo failed', 1).some((n) => /`set -e` is ignored in this `\( \)`, since it runs on the left side of `\|\|`/.test(n)));
    assert.ok(notes('set -e\n( cd /nowhere; rm x ) || echo failed', 1, 'ja').some((n) => /`\|\|` の左側で実行されるので、`\( \)`の中でも/.test(n)));
    assert.ok(notes('set -e\nif { a; b; }; then :; fi', 1).some((n) => /ignored in this `\{ \}`/.test(n)));
    assert.ok(notes('set -e\n( a > f; b ) || :', 1).some((n) => /ignored in this `\( \)`/.test(n)));
    for (const quiet of ['( cd /x; rm y ) || echo failed', 'set -e\n( x=1; rm y ) || :', 'set -e\n( > f; rm y ) || :', 'set -e\n( a ) || :', 'set -e\n( { a; }; b ) || :', 'set -e\n( a; b )']) assert.ok(!notes(quiet, quiet.split('\n').length - 1).some((n) => /is ignored in/.test(n)), quiet);
    const fn = 'set -e\nf() {\n  cd /x\n  rm y\n}\nif f; then :; fi';
    assert.ok(notes(fn, 1).some((n) => /`f` is called only where `set -e` is ignored \(line 6\), so it is ignored in all of its body too/.test(n)));
    assert.ok(notes(fn, 1, 'ja').some((n) => /からしか呼ばれないので/.test(n)));
    for (const quiet of ['set -e\nf() {\n  cd /x\n  rm y\n}\nf || :\nf', 'f() {\n  cd /x\n  rm y\n}\nif f; then :; fi', 'set -e\nf() {\n  x=1\n  rm y\n}\nif f; then :; fi',
      'set -e\nf() { rm y; }\nif f; then :; fi', 'f() {\n  set -e\n  rm y\n}\nset -e\nif f; then :; fi', 'set -e\nf() {\n  cd /x\n  rm y\n}']) {
      assert.ok(!notes(quiet, 1).some((n) => /called only where/.test(n)), quiet);
    }
  });

  it('says that bash turns set -e off in `$( )`', () => {
    // status.json: `x=$(false; @in@); @after@` under bash -e runs in and after.
    assert.ok(notes('set -e\nx=$(cd /nowhere; ls)', 1).some((n) => /bash turns `set -e` off inside `\$\( \)` \(without `shopt -s inherit_errexit`\): if `cd \/nowhere` fails/.test(n)));
    assert.ok(notes('set -e\nx=$(cd /nowhere; ls)', 1, 'ja').some((n) => /`\$\( \)` の中では `set -e` を切る/.test(n)));
    assert.ok(notes('set -e\nx=$(cd /a/rather/long/directory/name; ls)', 1).some((n) => /if `cd \/a\/rather\/long\/directory\/n…` fails/.test(n)));
    for (const quiet of ['set -e\nx=$(cd /nowhere && ls)', 'x=$(cd /nowhere; ls)', 'set -e\nshopt -s inherit_errexit\nx=$(cd /nowhere; ls)', 'set -e\nx=$(set -e; ls)']) {
      assert.ok(!notes(quiet, quiet.split('\n').length - 1).some((n) => /inherit_errexit/.test(n)), quiet);
    }
  });

  it('says which branch never runs when the values the script set decide the condition', () => {
    // Each checked with bash 5.2: the branch said never to run does not (test/fixtures/probes/state.json has the rows).
    const one = (src: string, line: number, re: RegExp, lang: 'en' | 'ja' = 'en') => assert.ok(notes(src, line, lang).some((n) => re.test(n)), `${src}\n${notes(src, line, lang).join('\n')}`);
    one('x=1\nif [ "$x" = 2 ]; then :; fi', 1, /^ℹ `\$x` is `1` here, so this condition is always false: the commands after its `then` never run$/);
    one('x=1\nif [ "$x" = 2 ]; then :; fi', 1, /^ℹ ここでは `\$x` は `1` なので、この条件は常に偽になり、`then` の後のコマンドは実行されない$/, 'ja');
    // (Only the branches that are there are named.)
    one('x=1\nif [ "$x" = 1 ]; then :; else :; fi', 1, /always true: the branch after it \(`else`\) never runs$/);
    one('x=1\nif [ "$x" = 1 ]; then :; else :; fi', 1, /常に真になり、後の分岐（`else`）は実行されない$/, 'ja');
    one('x=1\nif [ "$x" = 1 ]; then :; elif [ -f a ]; then :; elif [ -f b ]; then :; fi', 1, /always true: the branches after it \(`elif`\) never run$/);
    one('x=1\nif [ "$x" = 1 ]; then :; elif [ -f a ]; then :; else :; fi', 1, /always true: the branches after it \(`elif`, `else`\) never run$/);
    one('x=1\nif [ "$x" = 1 ]; then :; fi', 1, /always true: the commands after its `then` always run/);
    one('x=1\nif [ "$x" = 2 ]; then :\nelif [[ $x == 1 ]]; then :; fi', 2, /so this condition is always true: the commands after its `then` always run/);
    // (An `if` and an `elif` on one line: each says which.)
    one('x=1\nif [ "$x" = 2 ]; then :; elif [[ $x == 1 ]]; then :; fi', 1, /so the `if` condition is always false/);
    one('x=1\nif [ "$x" = 2 ]; then :; elif [[ $x == 1 ]]; then :; fi', 1, /so the `elif` condition is always true/);
    one('x=1\nif [ "$x" = 2 ]; then :; elif [[ $x == 1 ]]; then :; fi', 1, /`elif` の条件は常に真/, 'ja');
    one('x=; y=a\nif [ -n "$x" ] || [ "$y" = b ]; then :; fi', 1, /`\$x` is empty, `\$y` is `a` here, so this condition is always false/);
    one('x=; y=a\nif [ -n "$x" ] || [ "$y" = b ]; then :; fi', 1, /`\$x` は空、`\$y` は `a` なので/, 'ja');
    one('readonly u\n[ -n "$u" ] && echo set', 1, /`\$u` is not set here, so the left side of `&&` always fails: the command after it never runs/);
    one('x=1\n[ "$x" = 1 ] || echo no', 1, /the left side of `\|\|` always succeeds/);
    one('false\n[ $? -eq 0 ] && echo ok', 1, /`\$\?` is `1` here/);
    one('n=0\nwhile [ "$n" -gt 0 ]; do :; done', 1, /`\$n` is `0` here, so the loop stops at its first test: its body never runs/);
    one('go=1\nwhile [ "$go" = 1 ]; do sleep 1; done', 1, /so the condition never stops this loop: it ends only through `break`, `return`, `exit`, a signal or an error/);
    one('go=1\nwhile [ "$go" = 1 ]; do sleep 1; done', 1, /条件ではこのループは終わらない/, 'ja');
    one('m=ab\ncase $m in a) ;; a*|b) ;& c) ;; esac', 1, /`\$m` is `ab` here, so only `a\*\|b\)` and `c\)` of this `case` run$/);
    one('m=ab\ncase $m in a) ;; a*|b) ;& c) ;; esac', 1, /`a\*\|b\)` と `c\)` の分岐だけ/, 'ja');
    one('m=ab\ncase $m in a*) ;; c) ;; esac', 1, /so only `a\*\)` of this `case` runs$/);
    one('m=ab\ncase $m in a) ;; esac', 1, /so no pattern of this `case` matches: none of its branches runs/);
    one('if false; then f() { :; }; fi\nf', 1, /`f` is defined as a function on line 1, but in code that never runs before this \(a branch whose condition is never met, or after `break`, `continue`, `return` or `exit`\), so it is not the function/);
    one('for i in a; do break; f() { :; }; done\nf', 1, /`f` is defined as a function on line 1, but in code that never runs before this/);
    // The value the state has after `break` (not the one after it in the body, which never runs).
    one('for i in a; do x=1; break; x=2; done\nif [ "$x" = 2 ]; then :; fi', 1, /`\$x` is `1` here, so this condition is always false/);
    one('f() { x=1; [ a = a ] && return; x=2; }\nf; [ "$x" = 1 ] || echo no', 1, /`\$x` is `1` here, so the left side of `\|\|` always succeeds/);
    // Nothing: literals only (their meaning is plain), the environment, files, values that differ between calls, a side that
    // always runs, a value with a backquote; and one note for a condition in a decided one.
    for (const [src, line] of [['if false; then :; fi', 0], ['while true; do break; done', 0], ['if [ "$HOME" = / ]; then :; fi', 0], ['[ -f x ] && :', 0],
      ['f() { [ "$m" = a ] && :; }\nm=a; f; m=b; f', 0], ['x=1\n[ "$x" = 1 ] && :', 1], ['x="a`b"\n[ "$x" = 1 ] && :', 1]] as const) {
      assert.ok(!notes(src, line).some((n) => /here, so/.test(n)), src);
    }
    assert.strictEqual(notes('x=1\nif [ "$x" = 2 ] && [ "$x" = 3 ]; then :; fi', 1).filter((n) => /here, so/.test(n)).length, 1);
  });

  it('drops the `((i++))` pitfall where set -e is surely ignored', () => {
    assert.ok(!notes('((i++)) || true', 0).some((n) => /i\+\+/.test(n)));
    assert.ok(!notes('if ((i--)); then :; fi', 0, 'ja').some((n) => /i--/.test(n)));
    assert.ok(notes('((i++))', 0).some((n) => /under `set -e` the script stops/.test(n)));
  });
});

describe('a failure reported with `|| echo` where the status matters', () => {
  const said = (src: string, lang: 'en' | 'ja' = 'en', shell?: Shell) => notes(src, src.split('\n').length - 1, lang, shell).filter((n) => /status 0|returns 0|goes on|終了ステータス 0|そのまま続き/.test(n));
  it('says that the script ends with status 0, and that `2>/dev/null` leaves only the message', () => {
    assert.deepStrictEqual(said('#!/bin/bash\ncp a b 2>/dev/null || echo "copy failed"'), ['ⓘ Caveat: this is the last command of the script, so when `cp a b 2>/dev/null` fails, the script still ends with status 0, the status of `echo "copy failed"`: what runs it (cron, CI, `./script && next`) sees success. And `2>/dev/null` discards the error message of the command itself, so only this message is left to say why. To pass the failure on, write `… || { echo "copy failed" >&2; exit 1; }`']);
    assert.deepStrictEqual(said('#!/bin/bash\ncp a b 2>/dev/null || echo "copy failed"', 'ja'), ['ⓘ 注意: これはスクリプトの最後のコマンドなので、`cp a b 2>/dev/null` が失敗してもスクリプトは `echo "copy failed"` の終了ステータス 0 で終わり、呼び出し元（cron や CI、`./script && next`）には成功に見えます。また、`2>/dev/null` でコマンド自身のエラーメッセージも捨てられるので、理由を伝えるのはこのメッセージだけです。失敗を伝えるには `… || { echo "copy failed" >&2; exit 1; }` と書きます']);
    // (`&>/dev/null` and `>/dev/null 2>&1` discard it too; `>/dev/null` alone does not.)
    assert.match(said('#!/bin/bash\ncp a b &>/dev/null || echo failed')[0], /And `&>\/dev\/null` discards the error message/);
    assert.match(said('#!/bin/bash\ncp a b >/dev/null 2>&1 || echo failed')[0], /And `>\/dev\/null 2>&1` discards the error message/);
    assert.doesNotMatch(said('#!/bin/bash\ncp a b >/dev/null || echo failed')[0], /discards/);
    assert.match(said('#!/bin/bash\n{ cp a b; } 2>/dev/null || echo failed')[0], /when `\{ cp a b; \} 2>\/dev\/null` fails.* And `2>\/dev\/null` discards/);
  });
  it('says that a function returns 0, and that `set -e` goes on', () => {
    assert.deepStrictEqual(notes('f() {\n  cp a b || echo "copy failed" >&2\n}\nf', 1).filter((n) => /returns 0/.test(n)), ['ⓘ Caveat: this is the last command of `f`, so when `cp a b` fails, `f` still returns 0, the status of `echo "copy failed" >&2`: its caller sees success. To pass the failure on, write `… || { echo "copy failed" >&2; return 1; }`']);
    assert.match(notes('f() {\n  cp a b || echo failed\n}\nf', 1, 'ja').join('\n'), /`f` は `echo failed` の終了ステータス 0 を返し、呼び出し元には成功に見えます。失敗を伝えるには `… \|\| \{ echo failed >&2; return 1; \}` と書きます/);
    assert.deepStrictEqual(said("set -e\ncp a b || printf 'failed\\n'"), ["ⓘ Caveat: when `cp a b` fails, `set -e` does not stop the script (a failure on the left of `||` is ignored), and `printf 'failed\\n'` succeeds, so the script goes on. To stop the script, write `… || { printf 'failed\\n' >&2; exit 1; }`"]);
    assert.match(said('set -e\ncp a b || echo failed', 'ja')[0], /`\|\|` の左側の失敗では `set -e` は止まらず、`echo failed` が成功するので、スクリプトはそのまま続きます。スクリプトを止めるには/);
    // (`a && b || echo`: either failing; `/bin/echo`, the program.)
    assert.strictEqual(said('#!/bin/sh\nmkdir d && cd d || /bin/echo failed').length, 1);
    // (A comment after `||`: the right side is on the next line.)
    assert.match(notes('#!/bin/bash\ncp a b || # c\necho x', 1).join('\n'), /the script still ends with status 0, the status of `echo x`/);
  });
  // Deliberate ignores, tests, values printed in `$( )`, and where the status is not used.
  for (const src of ['#!/bin/bash\ncp a b || true', '#!/bin/bash\ncp a b || :', '#!/bin/bash\n[ -f a ] || echo none', '#!/bin/bash\ngrep -q x f || echo none',
    '#!/bin/bash\ncp a b || { echo failed >&2; exit 1; }', '#!/bin/bash\ncp a b || echo failed; exit 0', 'cp a b || echo failed', '#!/bin/bash\ncp a b || echo failed &',
    '#!/bin/bash\ncp a b || printf "%d\\n" "$n"', '#!/bin/bash\ncp a b || printf -v x failed', '#!/bin/bash\necho() { return 1; }\ncp a b || echo failed',
    '#!/bin/bash\ncp a b || echo failed | tee log', '#!/bin/bash\ncp a b && echo done', 'v() {\n  cat V 2>/dev/null || echo none\n}\nx=$(v)', 'v() {\n  cp a b || echo failed\n}',
    'f() {\n  cp a b || echo failed\n  return 0\n}\nf', 'set -e\nif cp a b || echo failed; then :; fi', 'set -e\nx=$(cp a b || echo failed)', '#!/bin/bash\ntrue || echo never',
    '#!/bin/bash\ncp a b || $say failed', '#!/bin/bash\ncp a b || printf', '#!/bin/bash\ncp a b || printf "$fmt"', '#!/bin/bash\n( cp a b || echo failed ) &', '#!/bin/bash\ncp a b || { }',
    '#!/bin/bash\ncp a b || ( )', '#!/bin/bash\ncp a b ||', '#!/bin/bash\ncp a b || notify failed', 'f() {\n  cp a b || echo failed\n}\ndiff <(f) x']) {
    it(`says nothing about ${JSON.stringify(src)}`, () => assert.deepStrictEqual(src.split('\n').flatMap((_, i) => notes(src, i)).filter((n) => /status 0|returns 0|goes on/.test(n)), []));
  }
  // In bash 5.2 and 5.3: the list's status is echo's, also with the error message discarded; a function returns it, and
  // `set -e` goes on; the rewrite fails with status 1 and the message on stderr.
  for (const program of ['bash', ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])]) {
    it(`agrees with ${program === 'bash' ? 'bash' : 'bash 5.3'}`, function () {
      const run = (script: string) => runBash(script, { program });
      if (run(':').status !== 0) return this.skip();
      assert.deepStrictEqual(run('false 2>/dev/null || echo x; echo $?'), { stdout: 'x\n0\n', stderr: '', status: 0 });
      assert.deepStrictEqual(run('#!/bin/bash\nls /nonexistent 2>/dev/null || echo "copy failed"'), { stdout: 'copy failed\n', stderr: '', status: 0 });
      assert.strictEqual(run('f() {\n  false || echo failed >&2\n}\nf; echo "f=$?"').stdout, 'f=0\n');
      assert.strictEqual(run("set -e\nfalse || printf 'failed\\n'\necho after").stdout, 'failed\nafter\n');
      assert.deepStrictEqual(run('set -e\nfalse || { echo "copy failed" >&2; exit 1; }\necho never'), { stdout: '', stderr: 'copy failed\n', status: 1 });
      assert.strictEqual(run('f() {\n  false || { echo failed >&2; return 1; }\n}\nf; echo "f=$?"').stdout, 'f=1\n');
    });
  }
});

describe('what surely succeeds (`succeeds`), as bash runs it', () => {
  /** Whether the last statement of `src` surely succeeds. */
  const succeeds = (src: string, shell?: Shell): boolean => {
    const tree = parser.parse(src);
    const last = tree.root.namedChildren[tree.root.namedChildren.length - 1];
    return statusModel(shellState(tree, shell), shell).succeeds(last);
  };

  it('is the builtin `true` or `:`, or a program `true`, with no word after it', () => {
    for (const src of ['true', ':', 'command true', 'builtin :', 'command -p true', 'command builtin true', '/bin/true', '/usr/bin/true', 'enable -n true; true']) {
      assert.strictEqual(succeeds(src), true, src);
    }
    assert.strictEqual(succeeds('true', 'dash'), true);
    // A function or an alias of that name, a word that may fail (`: ${x:?}`), a redirection or an assignment that may,
    // a name not known here, `command -v` (it only looks the name up), `:` turned off on some paths, other commands.
    for (const src of ['true() { return 1; }; true', ':() { false; }; :', 'shopt -s expand_aliases\nalias true=false\ntrue', ': "${x:?}"', 'true x',
      'true >/dev/null', 'x=1 true', '$c', 'command "$c"', 'command -v true', 'command', 'if [ -n "$a" ]; then enable -n :; fi; :', 'false', 'echo',
      '/bin/false', 'x=1', 'true | false']) {
      assert.strictEqual(succeeds(src), false, src);
    }
    assert.strictEqual(statusModel(shellState(parser.parse('true'))).succeeds(undefined), false);
  });

  // bash 5.2: whether `set -e` stops the script at `x=$(…)` (`after` is never printed), and what we say of it: the
  // note on `$( )`, and the idiom `|| true` only where it does not stop.
  const cases: [string[], boolean][] = [
    [['x=$(false || true)'], false],
    [['x=$(false || :)'], false],
    [['x=$(false || command true)'], false],
    [['x=$(false || builtin true)'], false],
    [['x=$(false || /bin/true)'], false],
    [['enable -n true', 'x=$(false || true)'], false],
    [['true() { return 1; }', 'x=$(false || true)'], true],
    [[':() { return 1; }', 'x=$(false || :)'], true],
    [['true() { return 1; }', 'x=$(false || command true)'], false],
    [['true() { return 1; }', 'x=$(false || builtin true)'], false],
    [['x=$(false || : "${u:?}")'], true],
  ];
  for (const [lines, stops] of cases) {
    it(lines.join('; '), function () {
      const run = runBash(['set -e', ...lines, 'echo after'].join('\n'));
      if (run.status === -1) return this.skip();
      assert.strictEqual(!run.stdout.includes('after'), stops, 'bash');
      const src = ['set -e', ...lines].join('\n');
      for (const lang of ['en', 'ja'] as const) {
        const said = explanations(src, lines.length, lang).some((e) => (lang === 'en' ? /Under `set -e` the script stops here if it fails/ : /スクリプトはここで止まる/).test(e));
        assert.strictEqual(said, stops, `${lang}: the note on $( )`);
        const idiom = notes(src, lines.length, lang).some((n) => (lang === 'en' ? /Idiom: `\|\| true`/ : /定番の書き方: `\|\| true`/).test(n));
        assert.strictEqual(idiom, !stops, `${lang}: the idiom`);
      }
    });
  }

  it('makes an endless loop of `while true` only when `true` succeeds', function () {
    // bash: the function `true` fails, so the body never runs; `while command true` runs it until `break`.
    const src = 'true() { return 1; }\nwhile true; do echo in; break; done\nwhile command true; do echo again; break; done';
    const run = runBash(src);
    if (run.status === -1) return this.skip();
    assert.strictEqual(run.stdout, 'again\n');
    assert.ok(!notes(src, 1).some((n) => /an endless loop/.test(n)));
    assert.ok(notes(src, 2).some((n) => /an endless loop/.test(n)));
  });
});
