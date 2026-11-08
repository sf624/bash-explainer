// The traps of EXIT and ERR in the shell state (docs/design/errexit-stop.md, G1: src/semantics/walk/traps.ts, read
// with src/semantics/traps.ts), what a call and a builtin can fail with (G2, G3: `CommandSpec.fails`,
// `returnsFailure`), what a trap's action does to the status (G5) and what a failure ends (G4, G6: `within`), on
// small scripts. test/errexit-traps.test.ts holds the same facts against bash.
import * as assert from 'assert';
import { shellState, type StateModel } from '../src/semantics/state';
import { statusModel, type StatusModel } from '../src/semantics/status';
import { laterExitTrap, trapAt, trappedName } from '../src/semantics/traps';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';

const parser = createUnbashParser();

function model(src: string): { state: StateModel; status: StatusModel; at: (text: string, i?: number) => SyntaxNode } {
  const tree = parser.parse(src);
  const state = shellState(tree);
  const at = (text: string, i = 0): SyntaxNode => {
    const n = descendants(tree.root, ['command', 'list', 'negated_command', 'pipeline', 'subshell', 'if_statement', 'redirected_statement']).filter((c) => c.text === text)[i];
    assert.ok(n, text);
    return n;
  };
  return { state, status: statusModel(state), at };
}

/** The traps in effect before the command `text`: `EXIT:on@<the trap's text>`, …; `-` for none. */
function traps(src: string, text: string, i = 0): string {
  const { state, at } = model(src);
  const n = at(text, i);
  const out = (['EXIT', 'ERR'] as const).map((name) => {
    const t = trapAt(state, n, name);
    return t && `${name}:${t.state}@${t.at.text.split('\n')[0]}${t.script ? '' : ' (no action)'}`;
  }).filter(Boolean);
  return out.join(', ') || '-';
}

describe('the traps in effect (docs/design/errexit-stop.md, G1)', () => {
  it('reads the words of trap that name EXIT and ERR as bash does', () => {
    assert.deepStrictEqual(['EXIT', 'exit', '0', '00', '+0', ' 0', 'ERR', 'err', 'SIGEXIT', 'INT', '1'].map(trappedName), ['EXIT', 'EXIT', 'EXIT', 'EXIT', 'EXIT', 'EXIT', 'ERR', 'ERR', undefined, undefined, undefined]);
  });

  it('follows trap: set, taken back, nothing to run, printed, a signal not known', () => {
    assert.strictEqual(traps("trap 'echo T' EXIT\necho a", 'echo a'), "EXIT:on@trap 'echo T' EXIT");
    assert.strictEqual(traps("trap 'echo T' EXIT\ntrap - EXIT\necho a", 'echo a'), 'EXIT:off@trap - EXIT (no action)');
    assert.strictEqual(traps("trap 'echo T' EXIT\ntrap EXIT\necho a", 'echo a'), 'EXIT:off@trap EXIT (no action)');
    assert.strictEqual(traps("trap '' EXIT ERR\necho a", 'echo a'), "EXIT:off@trap '' EXIT ERR (no action), ERR:off@trap '' EXIT ERR (no action)");
    assert.strictEqual(traps("trap 'echo T' EXIT\ntrap -p EXIT\necho a", 'echo a'), "EXIT:on@trap 'echo T' EXIT");
    assert.strictEqual(traps("trap 'echo T' INT\necho a", 'echo a'), '-');
    // (A signal word not known may be either: the trap may be set.)
    assert.strictEqual(traps("trap 'echo T' \"$sig\"\necho a", 'echo a'), "EXIT:unknown@trap 'echo T' \"$sig\", ERR:unknown@trap 'echo T' \"$sig\"");
    assert.strictEqual(traps("trap 'echo T' EXIT \"$sig\"\necho a", 'echo a'), "EXIT:on@trap 'echo T' EXIT \"$sig\", ERR:unknown@trap 'echo T' EXIT \"$sig\"");
    // (An action the walk does not read: set, not known.)
    assert.strictEqual(traps('trap "$cmd" EXIT\necho a', 'echo a'), 'EXIT:unknown@trap "$cmd" EXIT (no action), ERR:unknown@trap "$cmd" EXIT (no action)');
  });

  it('merges the paths: set on some, set by different commands', () => {
    assert.strictEqual(traps("if [ \"$1\" ]; then trap 'echo T' EXIT; fi\necho a", 'echo a'), "EXIT:unknown@trap 'echo T' EXIT");
    assert.strictEqual(traps("if [ \"$1\" ]; then trap 'echo T' EXIT; else trap 'echo U' EXIT; fi\necho a", 'echo a'), "EXIT:unknown@trap 'echo U' EXIT (no action)");
    assert.strictEqual(traps("trap 'echo T' EXIT\nif [ \"$1\" ]; then trap - EXIT; fi\necho a", 'echo a'), "EXIT:unknown@trap - EXIT");
    assert.strictEqual(traps("if [ \"$1\" ]; then trap - EXIT; else trap EXIT; fi\necho a", 'echo a'), 'EXIT:off@trap EXIT (no action)');
    assert.strictEqual(traps("if [ \"$1\" ]; then trap - EXIT; fi\necho a", 'echo a'), 'EXIT:off@trap - EXIT (no action)');
    // (One path sets it, the other takes it back: either order.)
    assert.strictEqual(traps("if [ \"$1\" ]; then trap 'echo T' EXIT; else trap - EXIT; fi\necho a", 'echo a'), "EXIT:unknown@trap - EXIT");
    assert.strictEqual(traps("if [ \"$1\" ]; then trap - EXIT; else trap 'echo T' EXIT; fi\necho a", 'echo a'), "EXIT:unknown@trap 'echo T' EXIT");
  });

  it('starts a subshell with none, but ERR under errtrace; a function body without the caller ERR, unless errtrace', () => {
    const src = "trap 'echo T' EXIT\ntrap 'echo E' ERR\n( echo a )\nx=$(echo b)\necho c | cat\nf() { echo d; }\nf";
    assert.strictEqual(traps(src, 'echo a'), '-');
    assert.strictEqual(traps(src, 'echo b'), '-');
    assert.strictEqual(traps(src, 'echo c'), '-');
    assert.strictEqual(traps(src, '( echo a )'), "EXIT:on@trap 'echo T' EXIT, ERR:on@trap 'echo E' ERR");
    assert.strictEqual(traps(src, 'echo d'), "EXIT:on@trap 'echo T' EXIT, ERR:off@f() { echo d; } (no action)");
    assert.strictEqual(traps(`set -E\n${src}`, 'echo a'), "ERR:on@trap 'echo E' ERR");
    assert.strictEqual(traps(`set -E\n${src}`, 'echo d'), "EXIT:on@trap 'echo T' EXIT, ERR:on@trap 'echo E' ERR");
    // (errtrace on some paths only.)
    const maybe = `if [ "$1" ]; then set -E; fi\n${src}`;
    assert.strictEqual(traps(maybe, 'echo a'), "ERR:unknown@trap 'echo E' ERR");
    assert.strictEqual(traps(maybe, 'echo d'), "EXIT:on@trap 'echo T' EXIT, ERR:unknown@trap 'echo E' ERR");
    // (After the body, the caller's ERR again, unless the body set one; the same entry walked twice.)
    assert.strictEqual(traps(`${src}\nf\necho e`, 'echo e'), "EXIT:on@trap 'echo T' EXIT, ERR:on@trap 'echo E' ERR");
    assert.strictEqual(traps("trap 'echo E' ERR\ng() { trap 'echo F' ERR; }\ng\necho e", 'echo e'), "ERR:on@trap 'echo F' ERR");
    assert.strictEqual(traps("g() { trap - ERR; }\ng\necho e", 'echo e'), 'ERR:off@trap - ERR (no action)');
  });

  it('takes the EXIT trap back after exec runs a command, not after exec of redirections', () => {
    assert.strictEqual(traps("trap 'echo T' EXIT\nexec 3>&1\necho a", 'echo a'), "EXIT:on@trap 'echo T' EXIT");
    assert.strictEqual(traps("trap 'echo T' EXIT\nexec true\necho a", 'echo a'), 'EXIT:off@exec true (no action)');
    assert.strictEqual(traps('exec true\necho a', 'echo a'), 'EXIT:off@exec true (no action)');
    assert.strictEqual(traps('exec true\nexec true\necho a', 'echo a'), 'EXIT:off@exec true (no action)');
    // (The command may be no word, or may not run with execfail: the shell may go on, and run the trap.)
    assert.strictEqual(traps("trap 'echo T' EXIT\nexec \"$@\"\necho a", 'echo a'), "EXIT:unknown@trap 'echo T' EXIT");
    assert.strictEqual(traps("trap 'echo T' EXIT\nshopt -s execfail\nexec /x/y\necho a", 'echo a'), "EXIT:unknown@trap 'echo T' EXIT");
    assert.strictEqual(traps('exec "$@"\necho a', 'echo a'), '-');
    assert.strictEqual(traps("trap '' EXIT\nexec \"$@\"\necho a", 'echo a'), "EXIT:off@trap '' EXIT (no action)");
  });

  it('takes a trap as not known after code the walk does not read (`source`, `eval` of a value)', () => {
    assert.strictEqual(traps('source ./lib.sh\necho a', 'echo a'), 'EXIT:unknown@source ./lib.sh (no action), ERR:unknown@source ./lib.sh (no action)');
    assert.strictEqual(traps("trap 'echo T' EXIT\nsource ./lib.sh\necho a", 'echo a'), "EXIT:unknown@trap 'echo T' EXIT, ERR:unknown@source ./lib.sh (no action)");
    assert.strictEqual(traps("trap '' EXIT\nsource ./lib.sh\nsource ./lib.sh\necho a", 'echo a'), "EXIT:unknown@trap '' EXIT (no action), ERR:unknown@source ./lib.sh (no action)");
    assert.strictEqual(traps('eval "$cmd"\necho a', 'echo a'), 'EXIT:unknown@eval "$cmd" (no action), ERR:unknown@eval "$cmd" (no action)');
    // (A trap set after it is set.)
    assert.strictEqual(traps("source ./lib.sh\ntrap 'echo T' EXIT\necho a", 'echo a'), "EXIT:on@trap 'echo T' EXIT, ERR:unknown@source ./lib.sh (no action)");
    const { state, at } = model("set -e\nsource ./lib.sh\necho a\ntrap 'echo T' EXIT");
    assert.strictEqual(laterExitTrap(state, at('echo a')), undefined);
  });

  it('gives a function the caller ERR trap back after `trap - ERR` without errtrace, not after `trap \'\' ERR`', () => {
    assert.strictEqual(traps("trap 'echo E' ERR\nf() { trap - ERR; }\nf\necho a", 'echo a'), "ERR:on@trap 'echo E' ERR");
    assert.strictEqual(traps("trap 'echo E' ERR\nf() { trap ERR; }\nf\necho a", 'echo a'), "ERR:on@trap 'echo E' ERR");
    assert.strictEqual(traps("trap 'echo E' ERR\nf() { trap '' ERR; }\nf\necho a", 'echo a'), "ERR:off@trap '' ERR (no action)");
    assert.strictEqual(traps("set -E\ntrap 'echo E' ERR\nf() { trap - ERR; }\nf\necho a", 'echo a'), 'ERR:off@trap - ERR (no action)');
  });

  it('takes a trap set by the action of another as not known after each statement', () => {
    assert.strictEqual(traps("trap 'echo T' EXIT\ntrap 'trap - EXIT' INT\necho a", 'echo a'), "EXIT:unknown@trap 'echo T' EXIT (no action)");
  });

  it('keeps the trap commands of the walk, once each, with where they ran', () => {
    const { state } = model("f() { trap 'echo T' EXIT; }\nf\nf\n( trap 'echo U' EXIT )\nif false; then trap 'echo V' EXIT; fi\ntrap 'echo W' EXIT INT\ntrap 'trap - ERR' EXIT");
    assert.deepStrictEqual(state.trapSets.map((t) => `${t.at.text}: ${t.names.join(' ')} ${t.state}${t.exitOnly ? ' exit-only' : ''}${t.main ? ' main' : ''}${t.dead ? ' dead' : ''}`), [
      "trap 'echo T' EXIT: EXIT on exit-only main", "trap 'echo U' EXIT: EXIT on exit-only", "trap 'echo V' EXIT: EXIT on exit-only main dead",
      "trap 'echo W' EXIT INT: EXIT on main", "trap 'trap - ERR' EXIT: EXIT on exit-only main",
      // (One in a string the walk runs is said at the command that runs the string.)
      "trap 'trap - ERR' EXIT: ERR off",
    ]);
  });

  it('names the EXIT trap set later, at the top level of the script', () => {
    const later = (src: string, text: string): string | undefined => {
      const { state, at } = model(src);
      return laterExitTrap(state, at(text))?.at.text;
    };
    assert.strictEqual(later("echo a\ntrap 'echo T' EXIT", 'echo a'), "trap 'echo T' EXIT");
    assert.strictEqual(later("echo a\ntrap 'echo T' EXIT || exit", 'echo a'), "trap 'echo T' EXIT");
    assert.strictEqual(later("echo a\nif [ \"$1\" ]; then trap 'echo T' EXIT; fi", 'echo a'), undefined);
    assert.strictEqual(later("echo a\ntrap - EXIT\ntrap 'echo T' EXIT", 'echo a'), "trap 'echo T' EXIT");
    assert.strictEqual(later("trap 'echo T' EXIT\necho a", 'echo a'), undefined);
    assert.strictEqual(later("( echo a )\ntrap 'echo T' EXIT", 'echo a'), undefined);
    // (One that `eval` sets is said at the `eval`.)
    assert.strictEqual(later("echo a\neval \"trap 'echo T' EXIT\"", 'echo a'), "eval \"trap 'echo T' EXIT\"");
    assert.strictEqual(later("echo a\ntrap '' EXIT", 'echo a'), undefined);
    assert.strictEqual(later("echo a\nexit\ntrap 'echo T' EXIT", 'echo a'), undefined);
  });
});

describe('what can fail (docs/design/errexit-stop.md, G2, G3)', () => {
  const mayFail = (src: string, text: string): boolean => {
    const { status, at } = model(src);
    return status.mayFail(at(text));
  };

  it('reads when a builtin fails from its spec: usage errors only, never, or as an option asks', () => {
    for (const c of ['echo hi', 'set -e', "trap 'x' EXIT", 'shopt -s extglob', 'shopt -u extglob', 'continue', 'true', ':', 'echo hi >&2', 'echo hi 2>/dev/null']) assert.strictEqual(mayFail(c, c), false, c);
    for (const c of ['echo hi > f', 'printf %d x', 'cd /x', 'read x', 'grep x f', 'export X=1', 'local v=1', 'shopt extglob', 'shopt -qs extglob', 'shopt -ps extglob', 'enable -n echo; echo hi']) assert.strictEqual(mayFail(c, c.split('; ').at(-1)!), true, c);
    // (A redirected statement: its redirections count too.)
    assert.strictEqual(mayFail('{ echo hi; } > f', '{ echo hi; } > f'), true);
  });

  it('says a call cannot fail where every failure in the body stops the shell inside it', () => {
    const fails = (body: string, extra = 'set -e\n'): boolean => mayFail(`${extra}f() ${body}\nf`, 'f');
    assert.strictEqual(fails('{ echo a; logger b; }'), false);
    // (A test of a declaration, `declare -F "$1" && "$1"`: its failure is not checked, and is the call's.)
    assert.strictEqual(fails('{ declare -F "$1" >/dev/null && "$1"; }'), true);
    assert.strictEqual(fails('{ [ -f x ] && echo a; }'), true);
    assert.strictEqual(fails('{ [ -f x ] || echo a; }'), false);
    assert.strictEqual(fails('{ ! grep x f; }'), true);
    assert.strictEqual(fails('{ return 1; }'), true);
    assert.strictEqual(fails('{ return 0; }'), false);
    assert.strictEqual(fails('{ return; }'), true);
    assert.strictEqual(fails('{ return "$x"; }'), true);
    assert.strictEqual(fails('{ ( return 1 ); }'), false);
    assert.strictEqual(fails('( echo a )'), true);
    assert.strictEqual(fails('{ if a; then [ x ] && b; elif c; then d; else ! e; fi; }'), true);
    assert.strictEqual(fails('{ if a; then b; elif c; then [ x ] && d; fi; }'), true);
    assert.strictEqual(fails('{ if a; then b; else c; fi; }'), false);
    assert.strictEqual(fails('{ case $1 in a) [ x ] && b;; *) c;; esac; }'), true);
    assert.strictEqual(fails('{ case $1 in a) b;; esac; }'), false);
    assert.strictEqual(fails('{ for i in 1; do [ x ] && b; done; }'), true);
    assert.strictEqual(fails('{ while a; do b; done; }'), false);
    assert.strictEqual(fails('{ { [ x ] && b; } > f; }'), true);
    assert.strictEqual(fails('{ g() { return 1; }; }'), false);
    assert.strictEqual(fails('{ x=1; }'), false);
    assert.strictEqual(fails('{ grep x f; }'), false);
    assert.strictEqual(fails('{ grep x f; }', ''), true);
    assert.strictEqual(fails('{ ( grep x f ); }', ''), true);
    assert.strictEqual(fails('{ set +e; grep x f; }'), true);
    assert.strictEqual(fails('{ g() { :; }; }'), false);
    // (A function that calls itself; one not defined on every path.)
    assert.strictEqual(fails('{ f && echo a; }'), true);
    assert.strictEqual(mayFail('if [ "$1" ]; then f() { :; }; fi\nf', 'f'), true);
    assert.strictEqual(mayFail('f() { :; }\nf > out', 'f > out'), true);
  });

  it('gives the ends of a body that return a failure (returnsFailure), for the pitfall of a last test too', () => {
    const { status, at, state } = model('f() {\n  [ -f x ] && echo a\n}\nf');
    const def = state.definitions.functions.get('f')![0];
    assert.deepStrictEqual(status.returnsFailure(def).map((n) => n.text), ['[ -f x ] && echo a']);
    assert.strictEqual(status.returnsFailure(def), status.returnsFailure(def));
    assert.ok(at('f'));
  });
});

describe('what a trap does to the status, and what a failure ends (docs/design/errexit-stop.md, G4 to G6)', () => {
  it('says whether the action of a trap may fail or exit (trapOutcome)', () => {
    const outcome = (src: string): string => {
      const { state, status, at } = model(`set -e\n${src}\necho last`);
      const t = trapAt(state, at('echo last'), 'EXIT')!;
      const o = status.trapOutcome(t.script!);
      assert.strictEqual(status.trapOutcome(t.script!), o);
      return `${o.fails ? 'fails' : ''}${o.exits ? ' exits' : ''}`.trim() || 'neither';
    };
    assert.strictEqual(outcome("trap 'echo T' EXIT"), 'neither');
    assert.strictEqual(outcome("trap 'rm -f x' EXIT"), 'fails');
    assert.strictEqual(outcome("trap 'exit 5' EXIT"), 'exits');
    assert.strictEqual(outcome("trap 'exit' EXIT"), 'exits');
    // (`exit` in a subshell ends only that; the subshell's status 5 then fails under `set -e`.)
    assert.strictEqual(outcome("trap '( exit 5 )' EXIT"), 'fails');
    assert.strictEqual(outcome("trap 'rm -f x || :' EXIT"), 'neither');
    assert.strictEqual(outcome("c() { d; d; }\nd() { echo a; exit 2; }\ntrap c EXIT"), 'exits');
    assert.strictEqual(outcome("c() { g() { rm x; }; echo a; }\ntrap c EXIT"), 'neither');
  });

  it('says a failure in the action of the EXIT trap of the main shell ends that action (within)', () => {
    const within = (src: string, text: string): string | undefined => {
      const { status, at } = model(`set -e\n${src}`);
      const w = status.errexit(at(text)).within;
      return w && `${w.kind}@${'trap' in w ? w.trap.text : w.def.text.split('\n')[0]}`;
    };
    assert.strictEqual(within("c() { rm x; }\ntrap c EXIT", 'rm x'), 'exit-trap@trap c EXIT');
    assert.strictEqual(within("d() { rm x; }\nc() { d; }\ntrap c EXIT", 'rm x'), 'exit-trap@trap c EXIT');
    assert.strictEqual(within("c() { rm x; }\ntrap c EXIT\nc", 'rm x'), undefined);
    assert.strictEqual(within("c() { rm x; }\ntrap c EXIT INT", 'rm x'), undefined);
    assert.strictEqual(within("c() { rm x; }\n( trap c EXIT )", 'rm x'), undefined);
    assert.strictEqual(within("c() { rm x; }\nif false; then trap c EXIT; fi", 'rm x'), undefined);
    assert.strictEqual(within("c() { rm x; }\ntrap c EXIT\ntrap 'c' INT", 'rm x'), undefined);
    assert.strictEqual(within("c() { ( rm x ); }\ntrap c EXIT", 'rm x'), undefined);
    assert.strictEqual(within('rm x', 'rm x'), undefined);
    assert.strictEqual(within('c() { rm x; }\nc', 'rm x'), undefined);
    // (A statement of the action's own string.)
    const { state, status } = model("set -e\ntrap 'rm x; echo y' EXIT");
    const action = state.trapSets[0].script!.tree.root;
    const rm = descendants(action, ['command'])[0];
    assert.strictEqual(status.errexit(rm).within?.kind, 'exit-trap');
  });
});
