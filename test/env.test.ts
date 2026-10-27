// Execution environments (src/semantics/env.ts): where each node runs, as a chain of links. Their agreement with
// bash is checked on the rows of test/fixtures/probes/env.json by test/env-probes.test.ts; this file tests the
// chains, the slots that cannot be probed (sudo, ssh, containers) and what each link passes on.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { interpret } from '../src/argv/interpret';
import { argWord } from '../src/argv/words';
import { Analyzer, lookupCommand, type Token } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { type CallLink, type ExecEnv, lastStage, type SlotLink, type SubshellLink, processOf, reachOf, slotEnvs, subshellReasons, whereOf } from '../src/semantics/env';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { CommandSpec } from '../src/argv/spec';
import { BATS_COMMANDS } from '../src/dict/bats';
import { descendants, field, fields, type SyntaxNode } from '../src/syntax/tree';
import { allTokens } from './support/explain';

const parser = createUnbashParser();

/** The command of `src` whose text is `text`, and where it runs. */
function at(src: string, text: string, shell?: Shell): { node: SyntaxNode; env: ExecEnv } {
  const tree = parser.parse(src);
  const node = descendants(tree.root, ['command']).find((c) => c.text === text)!;
  assert.ok(node, text);
  return { node, env: shellState(tree, shell).env(node) };
}

/** What runs `text` in `src`: main, subshell (`?` when on some paths only), shell or program. */
const kind = (src: string, text: string, shell?: Shell): string => {
  const p = processOf(at(src, text, shell).env);
  return p.kind + (p.sure ? '' : '?');
};

/** The reasons of the subshell links where `text` runs, outermost first. */
const whys = (src: string, text: string): string[] => at(src, text).env.links.map((l) => (l.kind === 'subshell' ? l.why + (l.sure ? '' : '?') : l.kind));

/** The environments of the commands that the words of the command `text` run through slots, by the slot's first word. */
function slots(src: string, text: string, spec?: CommandSpec, lookup: typeof lookupCommand = lookupCommand): Map<string, ExecEnv> {
  const { node, env } = at(src, text);
  const name = field(node, 'name')!.text;
  const words = fields(node, 'argument');
  spec ??= lookup(name)!;
  const parse = interpret(spec, words.map(argWord), { name, lookup });
  return new Map([...slotEnvs(env, parse, spec, words, 'bash', lookup)].map(([w, e]) => [w.text, e]));
}

describe('execution environments: the shell a program name stands for', () => {
  // (Which names have a spec is lookupCommand's business; here every shell name has the `sh` one.)
  const lookup: typeof lookupCommand = (n) => (/^(ksh93|mksh|posh|dash|zsh|bash|myshell)$/.test(n.split('/').pop()!) ? lookupCommand('sh') : lookupCommand(n));
  const shellOf = (name: string): string | undefined => {
    const src = `sudo ${name} -c 'f'`;
    const e = slots(src, src, undefined, lookup).get("'f'")! as ExecEnv;
    return (e.links.find((l) => l.kind === 'slot' && l.slot.run === 'shell-string') as SlotLink).shell;
  };
  it('reads ksh93, mksh, posh... as the shell they are, and an unknown program as unknown', () => {
    assert.strictEqual(shellOf('ksh93'), 'ksh');
    assert.strictEqual(shellOf('mksh'), 'mksh');
    assert.strictEqual(shellOf('posh'), 'sh');
    assert.strictEqual(shellOf('/bin/dash'), 'dash');
    assert.strictEqual(shellOf('bash'), 'bash');
    assert.strictEqual(shellOf('myshell'), 'unknown');
  });
  it('a shell that is not bash does not get the exported functions', () => {
    for (const sh of ['ksh93', 'mksh', 'dash', 'zsh']) {
      const src = `f() { a; }; export -f f; sudo ${sh} -c 'f'`;
      assert.strictEqual(reachOf(slots(src, src.slice(src.indexOf('sudo')), undefined, lookup).get("'f'")!).functions, 'none', sh);
    }
  });
});

describe('execution environments: subshells', () => {
  it('gives the reasons of the subshells around a node, outermost first', () => {
    assert.deepStrictEqual(whys('( a ) &', 'a'), ['background', 'parentheses']);
    // The innermost subshell gives the reason.
    assert.strictEqual((processOf(at('( a ) &', 'a').env).link as SubshellLink).why, 'parentheses');
    assert.deepStrictEqual(whys('x | y $(a)', 'a'), ['pipeline-stage', 'command-substitution']);
    assert.deepStrictEqual(whys('b && { a; } & wait', 'a'), ['background']);
    assert.deepStrictEqual(whys('coproc a', 'a'), ['coproc']);
    assert.deepStrictEqual(whys('cat <(a) > >(b)', 'b'), ['process-substitution']);
    assert.deepStrictEqual(whys('a | b', 'a'), ['pipeline-stage']);
    assert.deepStrictEqual(whys('a | b', 'b'), ['pipeline-stage']);
    assert.deepStrictEqual(whys('{ a; }; b', 'a'), []);
  });
  it('reads the last stage of a pipeline with lastpipe and job control from the state', () => {
    assert.strictEqual(kind('shopt -s lastpipe; x | a', 'a'), 'main');
    assert.strictEqual(kind('shopt -s lastpipe; set -m; x | a', 'a'), 'subshell');
    assert.strictEqual(kind('[ "$1" ] && shopt -s lastpipe; x | a', 'a'), 'subshell?');
    assert.strictEqual(kind('x | a', 'a', 'zsh'), 'main');
    assert.strictEqual(kind('x | a', 'a', 'dash'), 'subshell');
    // A subshell for sure, around one that may be.
    assert.strictEqual(kind('[ "$1" ] && shopt -s lastpipe; ( x | a )', 'a'), 'subshell');
    assert.strictEqual(lastStage(parser.parse('a | b # c').root.namedChildren[0]).text, 'b');
  });
  it('runs a function body where it is called', () => {
    assert.strictEqual(kind('f() { a; }; f', 'a'), 'main');
    assert.strictEqual(kind('f() { a; }; x=$(f)', 'a'), 'subshell');
    assert.strictEqual(kind('f() { a; }; f; f | cat', 'a'), 'subshell?');
    // Called through another function, and from different subshells: a subshell every time.
    assert.strictEqual(kind('f() { a; }; g() { f; }; g | cat; h() { x=$(f); }; h', 'a'), 'subshell');
    // `f() ( … )`: a subshell wherever it is called.
    assert.strictEqual(kind('f() ( a ); f', 'a'), 'subshell');
    // Not called: where it is defined, but not for sure (it may be called where the model does not see).
    assert.strictEqual(kind('( f() { a; } )', 'a'), 'subshell');
    assert.strictEqual(kind('f() { a; }', 'a'), 'main?');
    assert.strictEqual(kind("f() { a; }; export -f f; bash -c f", 'a'), 'main?');
    // A recursive call: wherever the function is entered, with the subshells around the call.
    assert.strictEqual(kind('f() { a; f; }; f | cat', 'a'), 'subshell');
    assert.strictEqual(kind('f() { a; f | cat; }; f', 'a'), 'subshell?');
    assert.strictEqual(kind('f() { a; f; }', 'a'), 'main?');
    // Functions that call each other run where either is called from outside.
    const mutual = 'f() { [ "$1" ] && return; a; g; }; g() { b; f x; }; echo | f';
    assert.deepStrictEqual([kind(mutual, 'a'), kind(mutual, 'b')], ['subshell', 'subshell']);
    assert.deepStrictEqual([kind(`${mutual}; g`, 'a'), kind(`${mutual}; g`, 'b')], ['subshell?', 'subshell?']);
    // Called by `eval` or a trap: from where they run. Not for sure where it may be called where the walk does not
    // see (src/semantics/trust.ts, `closed`): a trap's action, a command name not known, a sourced file.
    assert.strictEqual(kind('m() { a; }; echo | m; eval m', 'a'), 'subshell?');
    assert.strictEqual(kind('m() { a; }; x=$(builtin eval "m")', 'a'), 'subshell');
    assert.strictEqual(kind('m() { a; }; echo | m; trap m EXIT', 'a'), 'subshell?');
    assert.strictEqual(kind('m() { a; }; echo | m; "${1:-m}"', 'a'), 'subshell?');
    assert.strictEqual(kind('m() { a; }; echo | m; . ./lib.sh', 'a'), 'subshell?');
    // (A name that runs nothing: in a comment, printed, looked up; `command m` runs no function.)
    for (const more of ['# m', 'declare -f m', 'type m', 'command -v m', 'command m', 'unset -f x m']) assert.strictEqual(kind(`m() { a; }; echo | m; ${more}`, 'a'), 'subshell', more);
    // A call where the function may not be defined yet.
    const sites = (at('[ "$1" ] && m() { :; }; m', ':').env.links[0] as CallLink).sites;
    assert.deepStrictEqual(sites.map((x) => x.sure), [false]);
    // Called through an alias: from where the alias is used, but not for sure. The trust scan reads an alias's text
    // where it is defined and does not expand aliases inside other strings, so it cannot tell which uses it sees
    // (`trap g EXIT`, whose action calls `f` through the alias): src/semantics/trust.ts takes such a call as unseen.
    assert.strictEqual(kind('shopt -s expand_aliases\nalias g=f\nf() { a; }\nx=$(g)', 'a'), 'subshell?');
  });
  it('does not take the syntax around a statement for a subshell', () => {
    assert.deepStrictEqual(subshellReasons(parser.parse('a &').root), []);
    assert.deepStrictEqual(subshellReasons(parser.parse('echo $x').root.namedChildren[0]), []);
  });
});

describe('execution environments: command slots', () => {
  it('chains the slots of wrappers, and says what each passes on', () => {
    const s = slots("sudo env -i bash -c 'f'", "sudo env -i bash -c 'f'");
    assert.deepStrictEqual([...s.keys()], ['env', 'bash', "'f'"]);
    const inner = s.get("'f'")!;
    assert.deepStrictEqual(inner.links.map((l) => (l.kind === 'slot' ? l.via : l.kind)), ['sudo', 'env', 'bash -c']);
    assert.strictEqual(processOf(inner).kind, 'shell');
    assert.deepStrictEqual(inner.links.map((l) => (l.kind === 'slot' ? l.shell : undefined)), [undefined, undefined, 'bash']);
    assert.deepStrictEqual(['dash -c x', '/bin/sh -c x', 'zsh -c x', 'ksh -c x', 'ssh h x'].map((src) => (slots(src, src).values().next().value!.links[0] as SlotLink).shell), ['dash', 'sh', 'zsh', 'ksh', 'unknown']);
    assert.strictEqual(processOf(s.get('env')!).kind, 'program');
    const reach = reachOf(inner);
    assert.deepStrictEqual([reach.functions, reach.variables, reach.blocker?.kind === 'slot' && reach.blocker.via], ['none', 'none', 'sudo']);
  });
  it('passes exported functions and variables through programs and shells that keep the environment', () => {
    const s = slots("echo x | xargs bash -c 'f'", "xargs bash -c 'f'");
    assert.deepStrictEqual(reachOf(s.get("'f'")!), { functions: 'exported', variables: 'exported', options: 'none', aliases: 'none' });
    assert.strictEqual(reachOf(s.get("'f'")!, true).options, 'exported');
    assert.deepStrictEqual(reachOf(at('( a )', 'a').env), { functions: 'all', variables: 'all', options: 'all', aliases: 'all' });
    // sudo -E: the variables, but no function.
    const e = slots("sudo -E bash -c 'f'", "sudo -E bash -c 'f'").get("'f'")!;
    assert.deepStrictEqual([reachOf(e).functions, reachOf(e).variables], ['none', 'exported']);
    // eval and command run in this shell.
    const c = slots('command eval f', 'command eval f').get('f')!;
    assert.deepStrictEqual([processOf(c).kind, reachOf(c).functions], ['main', 'all']);
    // bats' run runs its command in a subshell (`$( )`), which has all of the script.
    const r = slots('run ! f x', 'run ! f x', BATS_COMMANDS.run).get('f')!;
    assert.deepStrictEqual([processOf(r).kind, processOf(r).link?.kind, reachOf(r).functions, reachOf(r).variables], ['subshell', 'slot', 'all', 'all']);
    // `run bash -c S`: the subshell passes everything on, and bash gets what is exported; `run eval S`: eval runs S
    // in run's subshell.
    const rb = slots("run bash -e -c 'f'", "run bash -e -c 'f'", BATS_COMMANDS.run);
    const s2 = rb.get("'f'")! as ExecEnv;
    assert.deepStrictEqual(s2.links.map((l) => (l.kind === 'slot' ? `${l.via}:${l.slot.run}:${l.shell ?? ''}:${(l.invocation ?? []).map((o) => o.flag).join('')}` : l.kind)), ['run:subshell::', 'bash -c:shell-string:bash:-e-c']);
    assert.deepStrictEqual([processOf(s2).kind, reachOf(s2).functions, reachOf(s2).variables], ['shell', 'exported', 'exported']);
    const re = slots("run eval 'f'", "run eval 'f'", BATS_COMMANDS.run).get("'f'")!;
    assert.deepStrictEqual([re.links.map((l) => (l.kind === 'slot' ? l.slot.run : l.kind)), processOf(re).kind, reachOf(re).functions], [['subshell', 'current-shell'], 'subshell', 'all']);
    // su keeps the environment, unless it starts a login shell; docker run -e passes a variable.
    assert.deepStrictEqual(reachOf(slots("su -c 'f' bob", "su -c 'f' bob").get("'f'")!).functions, 'exported');
    for (const src of ["su - -c 'f' bob", "su -l -c 'f' bob", "su --login -c 'f'"]) assert.strictEqual(reachOf(slots(src, src).get("'f'")!).functions, 'none', src);
    const docker = slots("docker run -e x --env y=1 --env=z=2 -ew --env-file f img sh -c 'f'", "docker run -e x --env y=1 --env=z=2 -ew --env-file f img sh -c 'f'").get('sh')!;
    assert.deepStrictEqual(docker.links.map((l) => (l.kind === 'slot' ? l.assigns : [])), [['x', 'y', 'z', 'w', '*']]);
  });
  it('knows where a command runs: here, on another machine, in a container', () => {
    const ssh = slots('ssh host ls -l', 'ssh host ls -l').get('ls')!;
    assert.deepStrictEqual([whereOf(ssh), processOf(ssh).kind, reachOf(ssh).variables], ['remote', 'shell', 'none']);
    const docker = slots("docker exec box sh -c 'f'", "docker exec box sh -c 'f'").get("'f'")!;
    assert.deepStrictEqual([whereOf(docker), reachOf(docker).functions], ['container', 'none']);
    assert.strictEqual(whereOf(slots('nice ls', 'nice ls').get('ls')!), 'local');
  });
  it('reads the commands of find’s actions, and the variables a wrapper sets', () => {
    const s = slots("find . -name '*.c' -exec bash -c 'f' \\;", "find . -name '*.c' -exec bash -c 'f' \\;");
    assert.deepStrictEqual(s.get("'f'")!.links.map((l) => (l.kind === 'slot' ? l.via : l.kind)), ['find -exec', 'bash -c']);
    const env = slots('env -i A=1 B=2 bash -c f', 'env -i A=1 B=2 bash -c f').get('bash')!;
    assert.deepStrictEqual(env.links.map((l) => (l.kind === 'slot' ? l.assigns : [])), [['A', 'B']]);
  });
  it('starts the slots of a command in its own environment', () => {
    const s = slots("x | sudo bash -c 'f'", "sudo bash -c 'f'");
    assert.deepStrictEqual(s.get("'f'")!.links.map((l) => l.kind), ['subshell', 'slot', 'slot']);
  });
});

describe('explanations from the execution environment', () => {
  const explain = (src: string, lang: 'en' | 'ja' = 'en', line = 0) => new Analyzer(lang).explainLine(parser.parse(src), line);
  const about = (src: string, label: string, lang: 'en' | 'ja' = 'en', line = 0): string => allTokens(explain(src, lang, line).items).find((t) => t.label === label)!.explanation;
  const pid = (src: string, lang: 'en' | 'ja' = 'en', line = 0, shell?: Shell): string =>
    allTokens(new Analyzer(lang).explainLine(parser.parse(src), line, shell).items).find((t) => t.label === '$$' && t.kind === 'variable')!.explanation;
  const pitfalls = (src: string, lang: 'en' | 'ja' = 'en', line = 0): string[] => explain(src, lang, line).notes.filter((n) => /^[⚠ⓘ] (落とし穴|注意|Pitfall|Caveat)/.test(n));
  const bash = (code: string): string => spawnSync('bash', ['--norc', '--noprofile', '-c', code], { encoding: 'utf8', cwd: '/tmp', env: { PATH: process.env.PATH } }).stdout;
  const hasBash = spawnSync('bash', ['--version']).status === 0;

  it('says that a builtin which acts on its shell acts on the subshell only', function () {
    assert.match(about('( cd /; ls )', 'cd'), /\. It runs in a subshell \(`\( \)`\), so the change stays in the subshell and is gone when it ends$/);
    assert.match(about('x=$(exit 3)', 'exit'), /\. It runs in a subshell \(`\$\( \)`\), so it ends only the subshell, not the script$/);
    // In a substitution, the change is usually there for the commands after it: said mildly.
    assert.match(about('x=`cd /`', 'cd'), /\. It runs in the subshell of backquotes, so the change holds only for the commands after it there$/);
    assert.match(about('dir=$(cd "$(dirname "$0")" && pwd)', 'cd'), /\. It runs in the subshell of `\$\( \)`, so the change holds only for the commands after it there$/);
    assert.match(about('cat <(cd /)', 'cd'), /the subshell of `<\( \)`/);
    assert.match(about('x=$(cd /)', 'cd', 'ja'), /。`\$\( \)` の中のサブシェルで実行されるので、この変更はその中のあとのコマンドにだけ効く$/);
    // A call that only prints changes nothing.
    for (const [src, label] of [['saved=$(set +o)', 'set'], ['x=$(set -o)', 'set'], ['m=$(umask)', 'umask'], ['t=$(trap -p EXIT)', 'trap'], ['x=$(trap -l)', 'trap'], ['a=$(alias)', 'alias'], ['a=$(alias ll)', 'alias'],
      ['e=$(export -p)', 'export'], ['e=$(export)', 'export'], ['s=$(shopt -p)', 'shopt'], ['s=$(shopt -s)', 'shopt'], ['s=$(shopt extglob)', 'shopt'], ['h=$(hash -t ls)', 'hash'], ['h=$(hash)', 'hash'], ['l=$(ulimit -n)', 'ulimit'],
      ['d=$(declare -p x)', 'declare'], ['d=$(declare -f f)', 'declare'], ['d=$(typeset -F)', 'typeset'], ['d=$(declare)', 'declare'], ['r=$(readonly -p)', 'readonly'], ['x=$(enable -a)', 'enable'], ['f() { x=$(local); }; f', 'local']]) {
      assert.doesNotMatch(about(src, label), /subshell/, src);
    }
    for (const [src, label] of [['( set -e )', 'set'], ['( set -- a )', 'set'], ['( umask 022 )', 'umask'], ['( trap - INT )', 'trap'], ['( trap -- "" INT )', 'trap'], ['( alias ll="ls -l" )', 'alias'], ['( alias $x )', 'alias'],
      ['( export -n x )', 'export'], ['( shopt -s extglob )', 'shopt'], ['( hash -r )', 'hash'], ['( hash ls )', 'hash'], ['( ulimit -n 100 )', 'ulimit'], ['( declare -fx f )', 'declare'], ['( declare -i n )', 'declare'],
      ['( readonly x )', 'readonly'], ['( enable -n echo )', 'enable'], ['( unset x )', 'unset']]) {
      assert.match(about(src, label), /subshell/, src);
    }
    assert.match(about('cd / &', 'cd'), /\(`&`\)/);
    assert.match(about('coproc { cd /; }', 'cd'), /\(`coproc`\)/);
    assert.match(about('echo x | read -r v', 'read'), /\(a pipeline stage\)/);
    assert.match(about('export A=1 | cat', 'export'), /It runs in a subshell \(a pipeline stage\)/);
    assert.match(about('unset A | cat', 'unset'), /It runs in a subshell \(a pipeline stage\)/);
    assert.match(about('[ "$1" ] && shopt -s lastpipe\necho x | read -r v', 'read', 'en', 1), /\. It may run in a subshell \(the last stage of a pipeline, when lastpipe is off\); then the change stays in the subshell and is gone when it ends$/);
    assert.match(about('[ "$1" ] && shopt -s lastpipe\necho x | exit', 'exit', 'en', 1), /\. It may run in a subshell \(.*\); then it ends only the subshell, not the script$/);
    assert.match(about('f() { cd /; }\nf; f | cat', 'cd'), /may run in a subshell \(some of the places its function is called from\)/);
    assert.match(about('f() { cd /; }\nx=$(f); f | cat', 'cd'), /It runs in a subshell \(where its function is called\)/);
    assert.match(about('f() { cd /; }\nx=$(f)', 'cd'), /It runs in a subshell \(where its function is called: `\$\( \)`\)/);
    assert.strictEqual(about('( cd / )', 'cd', 'ja'), 'カレントディレクトリを移動する。サブシェル（`( )`）で実行されるので、この変更はサブシェルの中だけで、サブシェルが終わると消える');
    assert.match(about('x=$(exit 1)', 'exit', 'ja'), /。サブシェル（`\$\( \)`）で実行されるので、終わるのはサブシェルだけ（スクリプト全体は終わらない）$/);
    assert.match(about('[ "$1" ] && shopt -s lastpipe\necho | cd /', 'cd', 'ja', 1), /。サブシェル（パイプラインの最後の段で、lastpipe が無効のとき）で実行されることがあり、そのときこの変更はサブシェルの中だけで、サブシェルが終わると消える$/);
    assert.match(about('[ "$1" ] && shopt -s lastpipe\necho | exit', 'exit', 'ja', 1), /で実行されることがあり、そのとき終わるのはサブシェルだけ（スクリプト全体は終わらない）$/);
    assert.match(about('f() { cd /; }\nx=$(f); f | cat', 'cd', 'ja'), /サブシェル（関数の呼び出し元）/);
    assert.match(about('f() { cd /; }\nx=$(f)', 'cd', 'ja'), /サブシェル（関数の呼び出し元: `\$\( \)`）/);
    assert.match(about('f() { cd /; }\nf; f | cat', 'cd', 'ja'), /サブシェル（関数の呼び出し元の一部）/);
    // (Every call it sees is in a subshell, but a sourced file may call it in the shell itself.)
    assert.match(about('f() { cd /; }\necho | f; . ./lib.sh', 'cd'), /\. It may run in a subshell \(where its function is called; what the script does not show may call it too\);/);
    assert.match(about('f() { cd /; }\necho | f; . ./lib.sh', 'cd', 'ja'), /サブシェル（関数の呼び出し元。スクリプトに見えない所からも呼ばれうる）で実行されることがあり/);
    assert.match(about('x | y; cd /', 'cd', 'ja', 0), /^カレントディレクトリを移動する$/);
    assert.match(about('cd / | y', 'cd', 'ja'), /サブシェル（パイプラインの段）/);
    assert.match(about('x=`cd /`', 'cd', 'ja'), /バッククォート の中のサブシェル/);
    // In the shell itself, or as a function: nothing to say.
    for (const [src, label] of [['cd /', 'cd'], ['shopt -s lastpipe; echo | read v', 'read'], ['cd() { :; }; ( cd / )', 'cd'], ['( ls )', 'ls']]) assert.doesNotMatch(about(src, label), /subshell/, src);
    if (!hasBash) this.skip();
    // What bash does: the directory and the script are those of the shell after the subshell.
    assert.strictEqual(bash('( cd /; exit 2 ); echo "$PWD $?"; x=$(exit 3); echo after; echo x | read -r v; echo "[$v]"'), '/tmp 2\nafter\n[]\n');
  });
  it('says that `$$` in a subshell is still the PID of the script’s shell', function () {
    assert.match(pid('x=$(echo $$)'), /\. This is in a subshell \(`\$\( \)`\), but it is still the PID of the script's shell \(the subshell's own is `\$BASHPID`\)$/);
    assert.match(pid('[ "$1" ] && shopt -s lastpipe\necho | echo $$', 'en', 1), /\. This may run in a subshell \(.*\); it is still the PID of the script's shell there/);
    assert.match(pid('( echo $$ )', 'ja'), /。ここはサブシェル（`\( \)`）の中だが、値はスクリプトのシェルのプロセス ID のまま（サブシェル自身の ID は `\$BASHPID`）$/);
    assert.match(pid('[ "$1" ] && shopt -s lastpipe\necho | echo $$', 'ja', 1), /で実行されることがあるが、そのときも値はスクリプトのシェルのプロセス ID/);
    // dash has no BASHPID.
    assert.match(pid('( echo $$ )', 'en', 0, 'dash'), /PID of the script's shell$/);
    assert.doesNotMatch(pid('echo $$'), /subshell/);
    if (!hasBash) this.skip();
    assert.strictEqual(bash('[ "$(echo $$)" = "$$" ] && [ "$(echo $BASHPID)" != "$$" ] && echo ok'), 'ok\n');
  });
  it('says when a shell run by a slot does not get a variable its string reads', function () {
    assert.deepStrictEqual(pitfalls("name=x\nbash -c 'echo \"$name\"'", 'en', 1), ['⚠ Pitfall: the new shell expands `$name` in the string, and `name` is a variable of this script that is not exported, so it is empty there. Run `export name` first']);
    assert.deepStrictEqual(pitfalls("name=x\nbash -c 'echo \"$name\"'", 'ja', 1), ['⚠ 落とし穴: 文字列の中の `$name` は新しいシェルが展開します。`name` はこのスクリプトの変数で、エクスポートされていないので、そこでは空です。先に `export name` します']);
    assert.deepStrictEqual(pitfalls("export name=x\nenv -i bash -c 'echo $name'", 'en', 1), ["⚠ Pitfall: the new shell expands `$name` in the string, but `env` passes none of this script's variables (not even exported ones), so `name` is not there. To use its value, write it in double quotes, so that it is expanded here"]);
    assert.deepStrictEqual(pitfalls("export name=x\nsudo bash -c 'echo $name'", 'ja', 1), ['⚠ 落とし穴: 文字列の中の `$name` は新しいシェルが展開しますが、`sudo` はこのスクリプトの変数を（エクスポートしたものも）渡さないので、そこには `name` はありません。値を使うなら、こちらで展開されるようダブルクォートの中に書きます']);
    assert.strictEqual(pitfalls("name=x\nx | bash -c 'echo $name'", 'en', 1).length, 1);
    // A variable set by arithmetic is the script's too; not in a subshell.
    for (const src of ['(( n = 1 ))', 'let n++', 'for (( n = 0; n < 3; n++ )); do :; done', ': $(( n = 2 ))']) {
      assert.deepStrictEqual(pitfalls(`${src}\nbash -c 'echo $n'`, 'en', 1), ['⚠ Pitfall: the new shell expands `$n` in the string, and `n` is a variable of this script that is not exported, so it is empty there. Run `export n` first'], src);
    }
    assert.deepStrictEqual(pitfalls("( (( n = 1 )) )\nbash -c 'echo $n'", 'en', 1), []);
    assert.deepStrictEqual(pitfalls("name=x\nssh host 'echo $name'", 'en', 1), ['⚠ Pitfall: the remote shell expands `$name`, but it does not have `name`, a variable of this script. To send its value, write it in double quotes, so that it is expanded here']);
    assert.deepStrictEqual(pitfalls("name=x\nssh host 'echo $name'", 'ja', 1), ['⚠ 落とし穴: `$name` はリモートのシェルが展開しますが、リモートにはこのスクリプトの変数 `name` はありません。値を送るなら、こちらで展開されるようダブルクォートの中に書きます']);
    // Exported, given to the command, set by the string itself, from the environment, not known, or in double quotes: nothing.
    for (const src of ["export name=x\nbash -c 'echo $name'", "name=x\nname=$name bash -c 'echo $name'", "export name=x\nenv -i name=$name bash -c 'echo $name'",
      "name=x\nbash -c 'name=y; echo $name'", "PATH=/bin\nbash -c 'echo $PATH'", "bash -c 'echo $name'", "name=x\nbash -c \"echo $name\"", "export name=x\nsudo -E bash -c 'echo $name'",
      "set -a; name=x\nbash -c 'echo $name'", "export name=x\nx | env name=$name bash -c 'echo $name'", "[ \"$1\" ] && export name\nname=x\nbash -c 'echo $name'"]) {
      assert.deepStrictEqual(pitfalls(src, 'en', 1), [], src);
    }
    // A variable of bash's: not one every bash has (`PS4`, `BASH_ARGV0`) or gets exported (`OLDPWD`, `HOME`), but one
    // that only a builtin or a terminal sets (`COLUMNS`, `REPLY`).
    for (const v of ['PS4', 'BASH_ARGV0', 'OLDPWD', 'HOME']) assert.deepStrictEqual(pitfalls(`${v}=/tmp\nbash -c 'echo "$${v}"'`, 'en', 1), [], v);
    for (const v of ['COLUMNS', 'LINES', 'REPLY', 'OPTARG']) assert.match(pitfalls(`${v}=1\nbash -c 'echo "$${v}"'`, 'en', 1)[0], /is not exported, so it is empty there/, v);
    // A read before the string sets the variable counts; one with a default or a length does not.
    assert.strictEqual(pitfalls("x=1\nbash -c 'echo $x; x=2'", 'en', 1).length, 1);
    assert.deepStrictEqual(pitfalls("y=1\nbash -c 'echo ${y:-none} ${#y} ${y+set} ${y:=d} ${y?}'", 'en', 1), []);
    // (Nor one bash cannot read: "bad substitution", or a `${` left open. `${y}` is read as `$y` is.)
    assert.deepStrictEqual(pitfalls("y=1\nbash -c 'echo ${(f)y}'", 'en', 1), []);
    assert.deepStrictEqual(pitfalls("y=1\nbash -c 'echo ${y'", 'en', 1), []);
    assert.match(pitfalls("y=1\nbash -c 'echo ${y}'", 'en', 1)[0], /expands `\$y` in the string/);
    assert.deepStrictEqual(pitfalls("y=1\nbash -c 'for y in a; do echo $y; done; f() { local y=1; echo $y; }; f'", 'en', 1), []);
    // (The new shell sets `$_` itself; so does a remote one.)
    for (const src of ["_=1\nbash -c 'echo ${_} $_'", "_=1\nenv -i bash -c 'echo $_'", "_=1\nssh h 'echo $_'"]) assert.deepStrictEqual(pitfalls(src, 'en', 1), [], src);
    // su keeps the environment (not with a login shell); docker run -e and --env-file pass variables.
    assert.match(pitfalls("export x=1\nsu -l -c 'echo $x'", 'en', 1)[0], /`su -c` passes none of this script's variables/);
    assert.deepStrictEqual(pitfalls("export x=1\nsu -c 'echo $x'", 'en', 1), []);
    assert.match(pitfalls("x=1\nsu -c 'echo $x'", 'en', 1)[0], /not exported/);
    assert.deepStrictEqual(pitfalls("export x=1\ndocker run -e x img sh -c 'echo $x'", 'en', 1), []);
    assert.deepStrictEqual(pitfalls("export x=1\ndocker run --env-file f img sh -c 'echo $x'", 'en', 1), []);
    assert.strictEqual(pitfalls("export x=1\ndocker run -e y img sh -c 'echo $x'", 'en', 1).length, 1);
    if (!hasBash) this.skip();
    assert.strictEqual(bash("x=1; bash -c 'echo \"[$x]\"; x=2'; y=1; bash -c 'echo ${y:-none} ${#y} ${y+set}'"), '[]\nnone 0\n');
    assert.strictEqual(bash("PS4=/tmp; OLDPWD=/tmp; COLUMNS=1; REPLY=1; bash -c 'echo \"[$PS4] [$OLDPWD] [$COLUMNS] [$REPLY]\"'"), '[+ ] [/tmp] [] []\n');
    // (`$_` starts as the shell's path. The `; true` keeps bash from running the last command in place, which
    // leaves another value in `_`, never `1`.)
    assert.match(bash("_=1; bash -c 'echo \"[${_}] [$_]\"'; true"), /^\[\/\S+\] \[\/\S+\]\n$/);
    assert.strictEqual(bash("y=1; bash -c 'echo ${y' 2>/dev/null; echo $?"), '2\n');
    assert.strictEqual(bash("name=x; bash -c 'echo \"[$name]\"'; export name; bash -c 'echo \"[$name]\"'; env -i bash -c 'echo \"[$name]\"'; env -i name=y bash -c 'echo \"[$name]\"'"), '[]\n[x]\n[]\n[y]\n');
  });
  it('says which words of an ssh command this shell expands before it sends them, as bash does', function () {
    // Each word as written, its text once the quotes are removed, and a prelude: the pitfall is said when bash
    // changes the word here (`*` matches in a directory that holds `ab` and `ac`; `~` is HOME).
    const words: [string, string, string?][] = [
      ["'a'*", 'a*'], ['a=~/x', 'a=~/x'], ['<(echo hi)', '<(echo hi)'], ['"$x"', '$x'], ['$((1+2))', '$((1+2))'], ['~', '~'],
      ["'a*'", 'a*'], ['a\\*', 'a*'], ['plain', 'plain'], ['*', '*', 'set -f'], ['*', '*', 'set -o noglob'],
      ['"a"*', 'a*'], ['x=~', 'x=~'], ['>(cat)', '>(cat)'],
    ];
    const said = words.map(([w, , prelude]) => pitfalls(`${prelude ?? 'x=1'}\nssh h echo ${w}`, 'en', 1).some((p) => /the local shell expands/.test(p)));
    assert.deepStrictEqual(said, [true, true, true, true, true, true, false, false, false, false, false, true, true, true]);
    if (!hasBash) this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-ssh-'));
    try {
      for (const f of ['ab', 'ac']) fs.writeFileSync(path.join(dir, f), '');
      const changed = words.map(([w, literal, prelude]) => spawnSync('bash', ['--norc', '--noprofile', '-c', `${prelude ?? 'x=1'}; printf '%s ' ${w}`],
        { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: '/home/u' } }).stdout !== `${literal} `);
      assert.deepStrictEqual(changed, said);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('reads `$_` after the commands of its own process only', function () {
    const last = (src: string): string => allTokens(explain(src).items).find((t) => t.label === '$_' && t.kind === 'variable')!.explanation;
    assert.match(last('x=$(a=1; echo "$_")'), /The command before is only an assignment, so `\$_` is empty$/);
    assert.match(last('a=1; ( b=2 ); echo $_'), /The command before is only an assignment/);
    assert.doesNotMatch(last('echo a; ( b=2 ); echo $_'), /assignment/);
    if (!hasBash) this.skip();
    assert.strictEqual(bash('x=$(a=1; echo "[$_]"); echo "$x"; echo a; ( b=2 ); echo "[$_]"'), '[]\na\n[a]\n');
  });
  it('says why a group runs in a subshell', () => {
    assert.match(about('{ a; } | cat', '{ ‹commands› }'), /Each stage of a pipeline runs in its own subshell, so the group is a subshell/);
    assert.match(about('b && { a; } &', '{ ‹commands› }'), /It is started in the background with `&`, so the group is a subshell/);
    assert.match(about('coproc { a; }', '{ ‹commands› }'), /A coprocess runs in a subshell/);
    assert.match(about('[ "$1" ] && shopt -s lastpipe\necho | { a; }', '{ ‹commands› }', 'en', 1), /the last one runs in the shell itself on the paths where `shopt -s lastpipe` is on/);
    assert.match(about('( { a; } )', '{ ‹commands› }'), /in the current shell/);
  });
  it('explains a long chain of functions, each called in `$( )` and plainly, in little time', function () {
    // (Where each function runs was read again for each of its callers' calls, which doubled at each function: 40 of
    // them took about a minute.)
    this.timeout(60000);
    const bodies: Record<string, (a: number, b: number) => string> = {
      plain: (a, b) => `local a=$(f${a}); f${b};`,
      'set -e': (a, b) => `local a=$(f${a}); f${b};`,
      if: (a, b) => `if x=$(f${a}); then f${b}; fi;`,
      '||': (a, b) => `a=$(f${a}) || f${b};`,
      '&&': (a, b) => `f${b} && echo "$(f${a})";`,
      '|': (a, b) => `f${a} | cat; f${b};`,
    };
    for (const [shape, body] of Object.entries(bodies)) {
      const lines = [...(shape === 'set -e' ? ['set -e'] : []), 'f0() { cd /; }', 'f1() { f0; }'];
      for (let i = 2; i < 40; i++) lines.push(`f${i}() { ${body(i - 1, i - 2)} }`);
      lines.push('f39');
      const tree = parser.parse(lines.join('\n'));
      const analyzer = new Analyzer('en');
      const t = Date.now();
      lines.forEach((_, i) => analyzer.explainLine(tree, i));
      assert.ok(Date.now() - t < 5000, `${shape}: ${Date.now() - t} ms`);
      // (f0 runs in a subshell on some of its calls only.)
      assert.strictEqual(kind(lines.join('\n'), 'cd /'), 'subshell?', shape);
    }
  });
});
