// What command names run (src/semantics/names.ts) and how the analyzer says it. The agreement with bash is
// checked on the rows of test/fixtures/probes/names.json by test/names-probes.test.ts; this file tests the
// resolutions that `type -t` cannot show (`command`, `builtin`, slots, other shells), and the texts. Each
// behaviour here was checked with bash 5.2 (and dash for `sh -c`).
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { interpret } from '../src/argv/interpret';
import { argWord } from '../src/argv/words';
import { Analyzer, lookupCommand } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { slotEnvs } from '../src/semantics/env';
import { assignmentsOf, definitionFails, type NameResolution, resolveName, testSpecAt } from '../src/semantics/names';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields, type SyntaxNode } from '../src/syntax/tree';
import { runBash } from './support/bash';

const parser = createUnbashParser();
const program = (name: string): boolean => {
  const spec = lookupCommand(name);
  return !!spec && !spec.builtin;
};

/** The command of `src` whose text is `text`. */
function commandAt(src: string, text: string): { node: SyntaxNode; tree: ReturnType<typeof parser.parse> } {
  const tree = parser.parse(src);
  const node = descendants(tree.root, ['command']).filter((c) => c.text === text).pop()!;
  assert.ok(node, text);
  return { node, tree };
}

/**
 * What `name` runs at the command `text` of `src`; with `slot`, the name is the first word (or the string) that
 * the command `text` runs through a slot (`sudo f`, `bash -c f`).
 */
function resolve(src: string, text: string, opts: { name?: string; slot?: string; shell?: Shell; posix?: boolean; quoted?: boolean } = {}): NameResolution {
  const { node, tree } = commandAt(src, text);
  const model = shellState(tree, opts.shell, { posix: opts.posix });
  if (opts.slot) {
    const name = field(node, 'name')!.text;
    const words = fields(node, 'argument');
    const spec = lookupCommand(name)!;
    const parse = interpret(spec, words.map(argWord), { name, lookup: lookupCommand });
    const word = words.find((w) => w.text === opts.slot)!;
    const env = slotEnvs(model.env(node), parse, spec, words, 'bash', lookupCommand).get(word)!;
    return resolveName(model, opts.name ?? opts.slot.replace(/'/g, ''), word, { env, program, shell: opts.shell });
  }
  return resolveName(model, opts.name ?? field(node, 'name')!.text, node, { command: !opts.name, program, shell: opts.shell, quoted: opts.quoted });
}

/** A short form of a resolution: its kind, `?` when not sure, and what it missed (`file<function:later`). */
function short(r: NameResolution): string {
  const sure = (r.kind === 'alias' || r.kind === 'function') && !r.sure ? '?' : '';
  const missed = r.kind !== 'keyword' && r.kind !== 'alias' && r.missed ? `<${r.missed.kind}:${r.missed.why}` : '';
  const more = r.kind === 'file' ? `:${r.path}${r.known ? '' : '-unknown'}${r.disabled ? '-disabled' : ''}${r.relative ? '-relative' : ''}${r.maybeHashed ? `-maybe-hashed:${r.maybeHashed.plain ?? r.maybeHashed.by.length}${r.maybeHashed.search ? '' : '-nosearch'}` : ''}` : r.kind === 'builtin' && r.special ? ':special' : '';
  return `${r.kind}${more}${sure}${missed}`;
}

describe('NameResolution', () => {
  it('keywords, and not after the parser read a command name, nor quoted', () => {
    assert.strictEqual(short(resolve('if true; then :; fi\nx', 'x', { name: 'if' })), 'keyword');
    assert.strictEqual(short(resolve('FOO=1 time ls', 'FOO=1 time ls')), 'file:search');
    assert.strictEqual(short(resolve('x', 'x', { name: 'if', quoted: true })), 'file:search-unknown');
  });

  it('aliases: expanded with expand_aliases (or POSIX mode, or another shell), chains, and their text', () => {
    const on = 'shopt -s expand_aliases\nalias a=b b=\'echo B\' c=\'FOO=1 env\' d=d e=\'"echo" x\' ls=\'ls -F\'\n';
    const a = resolve(`${on}a`, 'a');
    assert.strictEqual(short(a), 'alias');
    assert.ok(a.kind === 'alias' && a.target?.kind === 'alias' && a.target.target?.kind === 'builtin');
    // (No plain first word: an assignment, a quote; an alias of its own name is not expanded again.)
    for (const n of ['c', 'e']) {
      const r = resolve(`${on}${n}`, n);
      assert.ok(r.kind === 'alias' && !r.target, n);
    }
    const d = resolve(`${on}d`, 'd');
    assert.ok(d.kind === 'alias' && d.target?.kind === 'file');
    assert.strictEqual(short(resolve(`${on}\\ls`, '\\ls', { name: 'ls', quoted: true })), 'file:search<alias:quoted');
    // Without expand_aliases, bash does not expand them; sh does, and POSIX mode turns it on.
    assert.strictEqual(short(resolve('#!/bin/bash\nalias ll=\'ls -l\'\nll', 'll')), 'file:search-unknown<alias:expand_aliases');
    // (A file with no shebang may be `.bashrc`, read by an interactive shell: the alias may be expanded.)
    assert.strictEqual(short(resolve('alias ll=\'ls -l\'\nll', 'll')), 'alias?');
    assert.strictEqual(short(resolve('alias ll=\'ls -l\'\nll', 'll', { shell: 'sh' })), 'alias');
    assert.strictEqual(short(resolve('alias ll=\'ls -l\'\nll', 'll', { posix: true })), 'alias');
    // On some paths only: the alias, or expand_aliases.
    const some = resolve('shopt -s expand_aliases\n[ "$x" ] && alias ll=\'ls -l\'\nll', 'll');
    assert.ok(some.kind === 'alias' && !some.sure && some.otherwise?.kind === 'file');
    assert.strictEqual(short(resolve('[ "$x" ] && shopt -s expand_aliases\nalias ll=\'ls -l\'\nll', 'll')), 'alias?');
    // Defined later, or on the same line, or removed.
    assert.strictEqual(short(resolve('shopt -s expand_aliases\nll\nalias ll=\'ls -l\'', 'll')), 'file:search-unknown<alias:later');
    assert.strictEqual(short(resolve('shopt -s expand_aliases\nalias ll=\'ls -l\'; ll', 'll')), 'file:search-unknown<alias:same-unit');
    assert.strictEqual(short(resolve('shopt -s expand_aliases\nalias ll=\'ls -l\'\nunalias ll\nll', 'll')), 'file:search-unknown<alias:unset');
    // `command` skips them; another shell has none.
    assert.strictEqual(short(resolve(`${on}command a`, 'command a', { slot: 'a' })), 'file:search-unknown');
    assert.strictEqual(short(resolve(`${on}bash -c a`, 'bash -c a', { slot: 'a' })), 'file:search-unknown');
  });

  it('functions: defined on every path or some, shadowing a builtin or a program', () => {
    assert.strictEqual(short(resolve('f() { :; }\nf', 'f')), 'function');
    const cd = resolve('cd() { :; }\ncd /', 'cd /');
    assert.ok(cd.kind === 'function' && cd.shadows === 'builtin');
    const ls = resolve('ls() { :; }\nls', 'ls');
    assert.ok(ls.kind === 'function' && ls.shadows === 'program');
    const maybe = resolve('if [ "$x" ]; then f() { :; }; fi\nf', 'f');
    assert.ok(maybe.kind === 'function' && !maybe.sure && maybe.otherwise?.kind === 'file');
  });

  it('functions that are not there: later, in a subshell, inside a function not run, removed', () => {
    assert.strictEqual(short(resolve('f\nf() { :; }', 'f')), 'file:search-unknown<function:later');
    assert.strictEqual(short(resolve('( f() { :; } )\nf', 'f')), 'file:search-unknown<function:subshell');
    assert.strictEqual(short(resolve('f() { :; } | cat\nf', 'f')), 'file:search-unknown<function:subshell');
    assert.strictEqual(short(resolve('o() { f() { :; }; }\nf', 'f')), 'file:search-unknown<function:in-function');
    assert.strictEqual(short(resolve('o() { f() { :; }; }\no\nf', 'f')), 'function');
    assert.strictEqual(short(resolve('f() { :; }\nunset -f f\nf', 'f')), 'file:search-unknown<function:unset');
    assert.strictEqual(short(resolve('f() { :; }\nunset f\nf', 'f')), 'file:search-unknown<function:unset');
  });

  it('special builtins come before functions in POSIX mode', () => {
    const src = 'eval() { :; }\nset -o posix\neval x';
    assert.strictEqual(short(resolve(src, 'eval x')), 'builtin:special<function:posix-special');
    assert.strictEqual(short(resolve('eval() { :; }\n[ "$x" ] && set -o posix\neval x', 'eval x')), 'function?');
    assert.strictEqual(short(resolve('eval() { :; }\neval x', 'eval x')), 'function');
    // A function cannot get the name in POSIX mode: bash stops there.
    const def = (s: string, posix = false): string => {
      const tree = parser.parse(s);
      return definitionFails(shellState(tree, undefined, { posix }), descendants(tree.root, ['function_definition'])[0]);
    };
    assert.strictEqual(def('set -o posix\neval() { :; }'), 'on');
    assert.strictEqual(def('eval() { :; }', true), 'on');
    assert.strictEqual(def('[ "$x" ] && set -o posix\neval() { :; }'), 'unknown');
    assert.strictEqual(def('eval() { :; }'), 'off');
    assert.strictEqual(def('set -o posix\nf() { :; }'), 'off');
    assert.strictEqual(short(resolve('set -o posix\neval() { :; }\neval x', 'eval x')), 'builtin:special');
  });

  it('`command` and `builtin`', () => {
    const fn = 'cd() { :; }\nf() { :; }\n';
    assert.strictEqual(short(resolve(`${fn}command cd /`, 'command cd /', { slot: 'cd' })), 'builtin<function:command');
    assert.strictEqual(short(resolve(`${fn}builtin cd /`, 'builtin cd /', { slot: 'cd' })), 'builtin<function:builtin');
    assert.strictEqual(short(resolve(`${fn}command f`, 'command f', { slot: 'f' })), 'file:search-unknown<function:command');
    assert.strictEqual(short(resolve(`${fn}builtin f`, 'builtin f', { slot: 'f' })), 'none<function:builtin');
    assert.strictEqual(short(resolve('builtin ls', 'builtin ls', { slot: 'ls' })), 'none');
  });

  it('programs started by another one, and other shells', () => {
    const fn = 'f() { :; }\n';
    assert.strictEqual(short(resolve(`${fn}sudo f`, 'sudo f', { slot: 'f' })), 'file:search-unknown<function:program');
    assert.strictEqual(short(resolve('sudo echo', 'sudo echo', { slot: 'echo' })), 'file:search-unknown');
    assert.strictEqual(short(resolve(`${fn}bash -c f`, 'bash -c f', { slot: 'f' })), 'file:search-unknown<function:not-exported');
    assert.strictEqual(short(resolve(`${fn}export -f f\nbash -c f`, 'bash -c f', { slot: 'f' })), 'function');
    assert.strictEqual(short(resolve(`${fn}[ "$x" ] && export -f f\nbash -c f`, 'bash -c f', { slot: 'f' })), 'function?');
    assert.strictEqual(short(resolve(`${fn}export -f f\nenv -i bash -c f`, 'env -i bash -c f', { slot: 'f' })), 'file:search-unknown<function:not-passed');
    assert.strictEqual(short(resolve(`${fn}export -f f\ndash -c f`, 'dash -c f', { slot: 'f' })), 'file:search-unknown<function:not-imported');
    assert.strictEqual(short(resolve(`${fn}export -f f\nsh -c f`, 'sh -c f', { slot: 'f' })), 'function?<function:not-imported');
    // dash has no `shopt`; bash, and an unknown shell, are taken to.
    assert.strictEqual(short(resolve('dash -c shopt', 'dash -c shopt', { slot: 'shopt' })), 'file:search-unknown');
    assert.strictEqual(short(resolve('shopt', 'shopt', { shell: 'sh' })), 'file:search-unknown');
    assert.strictEqual(short(resolve('bash -c shopt', 'bash -c shopt', { slot: 'shopt' })), 'builtin');
  });

  it('builtins turned off, paths remembered, names with a slash', () => {
    assert.strictEqual(short(resolve('enable -n echo\necho', 'echo')), 'file:search-disabled');
    assert.strictEqual(short(resolve('enable -n echo\nenable echo\necho', 'echo')), 'builtin');
    const some = resolve('[ "$x" ] && enable -n echo\necho', 'echo');
    assert.ok(some.kind === 'builtin' && some.disabled);
    // (Loadable builtins are not followed.)
    assert.strictEqual(short(resolve('enable -f x.so echo\necho', 'echo')), 'builtin');
    assert.strictEqual(short(resolve('x', 'x', { name: '[' })), 'builtin');
    assert.strictEqual(short(resolve('hash -p /bin/echo e\ne', 'e')), 'file:hashed');
    assert.strictEqual(short(resolve('hash -p /x/y e\ne', 'e')), 'file:hashed-unknown');
    for (const forget of ['hash -r', 'hash -d e', 'PATH=/bin', 'hash -d x e', 'hash -d e x']) assert.strictEqual(short(resolve(`hash -p /bin/echo e\n${forget}\ne`, 'e')), 'file:search-unknown', forget);
    // A `hash -p` on some paths only: it runs that path if it ran (`ran`).
    assert.strictEqual(short(resolve('[ "$x" ] && hash -p /bin/echo e\ne', 'e')), 'file:search-unknown-maybe-hashed:ran');
    // Other commands that change the table on some paths: no one plain reading, the commands that differ (2 of them).
    for (const other of ['hash -d e', 'hash -r', 'PATH=/bin']) assert.strictEqual(short(resolve(`hash -p /bin/echo e\n[ "$x" ] && ${other}\ne`, 'e')), 'file:search-unknown-maybe-hashed:2', other);
    // (Two paths, one on each: bash runs one of them, never the name's own program.)
    assert.strictEqual(short(resolve('hash -p /bin/echo e\n[ "$x" ] && hash -p /bin/ls e\ne', 'e')), 'file:search-unknown-maybe-hashed:2-nosearch');
    assert.strictEqual(short(resolve('if [ "$x" ]; then hash -p /bin/ls e; else hash -p /bin/ls e; fi\ne', 'e')), 'file:hashed');
    assert.strictEqual(short(resolve('if [ "$x" ]; then hash -p "$p" e; else hash -p "$q" e; fi\ne', 'e')), 'file:hashed-unknown');
    assert.strictEqual(short(resolve('hash -p /bin/ls e\nif [ "$x" ]; then hash -d e; else hash -r; fi\ne', 'e')), 'file:search-unknown');
    // (In a loop: from the second time round.)
    assert.strictEqual(short(resolve('for i in 1 2; do e; hash -p /bin/ls e; done', 'e')), 'file:search-unknown-maybe-hashed:ran');
    assert.strictEqual(short(resolve('while [ "$x" ]; do e; [ "$y" ] && hash -p /bin/ls e; [ "$z" ] && hash -d e; done', 'e')), 'file:search-unknown-maybe-hashed:2');
    // A body that runs later: what was there, or what the command that changes it last leaves (a path, or none).
    assert.strictEqual(short(resolve('f() { e; }\nhash -p /bin/ls e', 'e')), 'file:search-unknown-maybe-hashed:ran');
    assert.strictEqual(short(resolve('hash -p /bin/ls e\nf() { e; }\nhash -d e', 'e')), 'file:search-unknown-maybe-hashed:2');
    assert.strictEqual(short(resolve('hash -p /bin/ls e\n[ "$x" ] && hash -d e\nf() { e; }\nhash -r', 'e')), 'file:search-unknown-maybe-hashed:3');
    // With hashing off (`set +h`), bash looks in no table, and `hash` fails, changing nothing; `set -h` brings the paths back.
    assert.strictEqual(short(resolve('hash -p /bin/echo e\nset +h\ne', 'e')), 'file:search-unknown');
    assert.strictEqual(short(resolve('set +h\nhash -p /bin/echo e\nset -h\ne', 'e')), 'file:search-unknown');
    for (const forget of ['hash -r', 'hash -d e']) assert.strictEqual(short(resolve(`hash -p /bin/echo e\nset +h\n${forget}\nset -h\ne`, 'e')), 'file:hashed', forget);
    assert.strictEqual(short(resolve('hash -p /bin/echo e\n[ "$x" ] && set +h\ne', 'e')), 'file:search-unknown-maybe-hashed:hashing');
    // (There hashing is on again, and the `hash -p` ran but failed on some paths: no plain "if it ran", its line.)
    assert.strictEqual(short(resolve('[ "$x" ] && set +h\nhash -p /bin/echo e\nset -h\ne', 'e')), 'file:search-unknown-maybe-hashed:1');
    assert.strictEqual(short(resolve('hash -p /bin/echo e\n[ "$x" ] && set +h\nhash -r\ne', 'e')), 'file:search-unknown-maybe-hashed:2');
    // A relative path (any not starting with `/`) runs from the current directory: no program the dictionary knows.
    for (const rel of ['ls', './ls', 'bin/ls', "''"]) assert.strictEqual(short(resolve(`hash -p ${rel} e\ne`, 'e')), 'file:hashed-unknown-relative', rel);
    assert.strictEqual(short(resolve('hash -p /bin/ls a e\ne', 'e')), 'file:hashed');
    assert.strictEqual(short(resolve('/bin/ls', '/bin/ls')), 'file:given');
    // (Words not known here are left alone.)
    assert.strictEqual(short(resolve('hash -p /bin/echo $n\nhash -p "$p" e\nhash -d $x\ne', 'e')), 'file:hashed-unknown');
    // A function no call reaches may run after a change made later in the script.
    for (const src of ['f() { echo; }\nenable -n echo', 'enable -n echo\nf() { echo; }\nenable echo']) {
      const tree = parser.parse(src);
      const model = shellState(tree);
      const echo = descendants(tree.root, ['command']).find((c) => c.text === 'echo')!;
      const r = resolveName(model, 'echo', echo, { command: true });
      assert.ok(r.kind === 'builtin' && r.disabled?.state === 'unknown', src);
    }
    assert.strictEqual(short(resolve('./run', './run')), 'file:given-unknown');
  });
});

describe('NameResolution in bodies that run later, after `source`, and of declaration builtins', () => {
  /** The resolution of every call of the function bodies of `src`, as `name=short`. */
  const calls = (src: string): string[] => {
    const tree = parser.parse(src);
    const model = shellState(tree);
    return descendants(tree.root, ['function_definition']).flatMap((d) => descendants(d, ['command']))
      .map((c) => `${field(c, 'name')!.text}=${short(resolveName(model, field(c, 'name')!.text, c, { command: true, program }))}`);
  };

  it('a library file: functions the top level defines after a body are there when it runs', () => {
    const lib = 'log() { printf "%s\\n" "$*" >&2; }\ndie() { log "error: $*"; exit 1; }\nneed() { command -v "$1" >/dev/null || die "missing $1"; }\nearly() { later_fn; }\nlater_fn() { :; }';
    assert.deepStrictEqual(calls(lib).filter((c) => /^(log|die|later_fn)=/.test(c)), ['log=function', 'die=function', 'later_fn=function']);
  });

  it('a dispatch script: `"cmd_$1"` calls bodies that call functions defined after them', () => {
    const d = 'cmd_build() { compile; package; }\ncompile() { make; }\npackage() { tar czf out.tgz build; }\n"cmd_$1" "${@:2}"';
    assert.deepStrictEqual(calls(d).filter((c) => /^(compile|package)=/.test(c)), ['compile=function', 'package=function']);
  });

  it("git-sh-setup's pattern: a function defined later, first in a list, or in a branch", () => {
    const g = 'die() { die_with_status 1 "$@"; }\ndie_with_status() { exit "$1"; }\nf() { g; h; }\ng() { :; } && complete -F g x\nif [ "$x" ]; then h() { :; }; fi';
    assert.deepStrictEqual(calls(g).filter((c) => /^(die_with_status|g|h)=/.test(c)), ['die_with_status=function', 'g=function', 'h=function?']);
    // (Not when a definition comes after the body but in a subshell, or is removed somewhere: then "may".)
    assert.deepStrictEqual(calls('f() { g; }\n( g() { :; } )').filter((c) => c.startsWith('g=')), ['g=function?']);
    assert.deepStrictEqual(calls('f() { g; }\ng() { :; }\nunset -f g').filter((c) => c.startsWith('g=')), ['g=function?']);
  });

  it('the state of a body no call reaches, with a function defined on some paths before it and by the top level after', () => {
    assert.deepStrictEqual(calls('if [ "$x" ]; then g() { :; }; fi\nf() { g; }\ng() { :; }').filter((c) => c.startsWith('g=')), ['g=function']);
    // (The unit of a node outside the top level's statements is itself.)
    const tree = parser.parse('a; b\nc');
    const model = shellState(tree);
    assert.deepStrictEqual(descendants(tree.root, ['command']).map((c) => model.unit(c).text), ['a', 'a', 'c']);
    assert.strictEqual(model.unit(tree.root), tree.root);
  });

  it('trap actions run later: an EXIT trap with the state at the end', () => {
    assert.deepStrictEqual(calls('on_exit() { report; }\ntrap on_exit EXIT\nreport() { echo done; }').filter((c) => c.startsWith('report')), ['report=function']);
    assert.deepStrictEqual(calls('on_int() { report; }\ntrap on_int INT\nreport() { echo done; }').filter((c) => c.startsWith('report')), ['report=function']);
    assert.deepStrictEqual(calls('f() { trap on_exit EXIT; }\non_exit() { report; }\nf\nreport() { :; }').filter((c) => c.startsWith('report')), ['report=function']);
    // (A signal known only at run time: not taken as EXIT.)
    assert.deepStrictEqual(calls('on_x() { report; }\ntrap on_x "$sig"\nreport() { :; }').filter((c) => c.startsWith('report')), ['report=function']);
  });

  it('after `source`, a name the dictionary does not know may be a function of the file', () => {
    const r = resolve('. ./lib.sh\nlog hello', 'log hello');
    assert.ok(r.kind === 'file' && r.sourced?.text === '. ./lib.sh');
    assert.ok(!(resolve('f() { log x; }\nsource lib.sh', 'log x') as { missed?: unknown }).missed);
    assert.ok((resolve('f() { log x; }\nsource lib.sh', 'log x') as { sourced?: unknown }).sourced);
    // (No `later` note: the function may come from the file.)
    assert.strictEqual(short(resolve('source lib.sh\nlf\nlf() { :; }', 'lf')), 'file:search-unknown');
    assert.strictEqual(short(resolve('lf\nsource lib.sh', 'lf')), 'file:search-unknown');
    assert.ok(!(resolve('source lib.sh\nls', 'ls') as { sourced?: unknown }).sourced);
  });

  it('a function named like a declaration builtin or `unset` runs instead of it, unless POSIX mode finds the special builtin', () => {
    const tree = parser.parse('export() { echo my; }\nexport a=1\nset -o posix\nexport b=2\nlocal() { :; }\nf() { local x=1; }\nf\nunset() { :; }\nx=1\nunset x');
    const model = shellState(tree);
    const decl = descendants(tree.root, ['command']).filter((d) => ['export', 'local', 'unset'].includes(field(d, 'name')?.text ?? ''))
      .map((d) => short(resolveName(model, field(d, 'name')!.text, d, { command: true })));
    assert.deepStrictEqual(decl, ['function', 'builtin:special<function:posix-special', 'function', 'builtin:special']);
    // (`unset() { …; }` after `set -o posix` is not defined: bash stops there.) The walk calls the function:
    // `unset x` leaves x set; `export a=1` does not export it.
    assert.strictEqual(model.end.variables.get('a'), undefined);
    const after = shellState(parser.parse('unset() { :; }\nx=1\nunset x'));
    assert.strictEqual(after.end.variables.get('x')?.set, 'on');
    assert.strictEqual(shellState(parser.parse('[ "$v" ] && export() { :; }\nexport a=1')).end.variables.get('a')?.set, 'unknown');
  });

  it('`PATH=… cmd` looks the name up with that PATH, and forgets the paths of `hash -p`', () => {
    assert.strictEqual(short(resolve('hash -p /bin/echo e\nPATH=/usr/bin:/bin e d', 'PATH=/usr/bin:/bin e d')), 'file:search-unknown');
    assert.strictEqual(short(resolve('hash -p /bin/echo e\nPATH=/usr/bin:/bin e d\ne x', 'e x')), 'file:search-unknown');
  });

  it('an alias defined after its use on the same line is "later"', () => {
    assert.strictEqual(short(resolve('shopt -s expand_aliases\nhi; alias hi=x', 'hi')), 'file:search-unknown<alias:later');
  });
});

describe('AssignmentMeaning', () => {
  const scopes = (src: string, text: string, posix = false, none = false): string => {
    const { node, tree } = commandAt(src, text);
    const model = shellState(tree, undefined, { posix });
    const res = none ? undefined : resolveName(model, field(node, 'name')!.text, node, { command: true, program });
    if (text.includes('$cmd')) return assignmentsOf(model, node, 'dynamic').map((a) => `${a.name}:${a.scope}${a.sure ? '' : '?'}`).join(' ');
    return assignmentsOf(model, node, res).map((a) => `${a.name}:${a.scope}${a.sure ? '' : '?'}`).join(' ');
  };

  it('shell variables, the command\'s environment, or staying after a special builtin in POSIX mode', () => {
    // (`x=1 $empty`: no command name results.)
    assert.strictEqual(scopes('x=1 a[2]=3 $empty', 'x=1 a[2]=3 $empty', false, true), 'x:shell a:shell');
    assert.strictEqual(scopes('x=1 ls', 'x=1 ls'), 'x:command');
    // (A name that may expand to no word: then the assignment is the shell's.)
    assert.strictEqual(scopes('x=1 $cmd', 'x=1 $cmd'), 'x:command?');
    // (A word after it that surely gives one is the command then, with the assignment: `x=1 $cmd env`; one that may
    // also give none leaves it open.)
    assert.strictEqual(scopes('x=1 $cmd env', 'x=1 $cmd env'), 'x:command');
    assert.strictEqual(scopes('x=1 $cmd ""', 'x=1 $cmd ""'), 'x:command');
    assert.strictEqual(scopes('x=1 $cmd $cmd', 'x=1 $cmd $cmd'), 'x:command?');
    assert.strictEqual(scopes('x=1 export y', 'x=1 export y'), 'x:command');
    assert.strictEqual(scopes('x=1 export y', 'x=1 export y', true), 'x:persists');
    assert.strictEqual(scopes('[ "$v" ] && set -o posix\nx=1 :', 'x=1 :'), 'x:persists?');
    // (A function, `command` and `builtin` keep it temporary, also in POSIX mode: bash 5.2.)
    assert.strictEqual(scopes('f() { :; }\nx=1 f', 'x=1 f', true), 'x:command');
    assert.strictEqual(scopes('x=1 command :', 'x=1 command :', true), 'x:command');
  });
});

describe('an assignment before a name that may expand to no word, against bash', () => {
  const said = (src: string, lang: 'en' | 'ja' = 'en'): string => new Analyzer(lang).explainLine(parser.parse(src), 0).items[0].children.find((t) => t.kind === 'assignment')!.explanation;

  it('stays only when no word after the name gives one', () => {
    // With `cmd` empty, `env` is the command and gets `x`; with no word left, `x` is the shell's.
    assert.strictEqual(runBash('cmd=; x=1 $cmd env | grep "^x="; echo "x=$x"').stdout, 'x=1\nx=\n');
    assert.strictEqual(runBash('cmd=; x=1 $cmd ""; echo "st=$? x=$x"').stdout, 'st=127 x=\n');
    assert.strictEqual(runBash('cmd=; x=1 $cmd $cmd; echo "x=$x"').stdout, 'x=1\n');
    assert.strictEqual(runBash('cmd=; x=1 $cmd; echo "x=$x"').stdout, 'x=1\n');
    assert.match(said('x=1 $cmd env'), /^Environment variable set only for this command: /);
    assert.match(said('x=1 $cmd env', 'ja'), /^このコマンドの実行中だけ設定される環境変数: /);
    assert.match(said('x=1 $cmd $cmd'), /^Environment variable set only for this command \(if `\$cmd` and the words after it expand to no word at all, it stays as a shell variable\): /);
    assert.match(said('x=1 $cmd $cmd', 'ja'), /^このコマンドの実行中だけ設定される環境変数（`\$cmd` もその後の語も何の語にもならなければ、シェルの変数として残る）: /);
    assert.match(said('x=1 $cmd'), /^Environment variable set only for this command \(if `\$cmd` expands to no word at all, it stays as a shell variable\): /);
  });
});

describe('the analyzer says what a name runs', () => {
  const explain = (src: string, line: number, lang: 'en' | 'ja' = 'en', opts = {}) => new Analyzer(lang).explainLine(parser.parse(src), line, undefined, opts);
  const head = (src: string, line: number, lang: 'en' | 'ja' = 'en'): string => explain(src, line, lang).items[0].explanation;
  const notes = (src: string, line: number, lang: 'en' | 'ja' = 'en', opts = {}): string => explain(src, line, lang, opts).notes.join('\n');
  const all = (t: { explanation: string; children: unknown[] }): string[] => [t.explanation, ...(t.children as typeof t[]).flatMap(all)];

  it('a body that runs later, and a function from a file read by `source`', () => {
    assert.match(all(explain('f() { g; }\nif [ "$x" ]; then g() { :; }; fi', 0).items[0]).join('\n'), /That is, if it is defined when this runs: it is defined later in the script, on some paths only/);
    assert.match(all(explain('f() { g; }\nif [ "$x" ]; then g() { :; }; fi', 0, 'ja').items[0]).join('\n'), /定義はスクリプトのあとの部分/);
    assert.match(head('. ./lib.sh\nlog hi', 1), /^Run `log`: maybe a function of the file read on line 1, else an external command$/);
    assert.match(head('. ./lib.sh\nlog hi', 1, 'ja'), /行 1 で読み込んだファイルの関数かもしれない/);
  });

  it('a declaration builtin or `unset` shadowed by a function is a call of it', () => {
    const t = explain('export() { :; }\nexport a=1', 1).items[0];
    assert.strictEqual(t.kind, 'function');
    assert.match(all(t).join('\n'), /Call the function `export` defined on line 1.*Argument \$1 to the function/s);
    assert.match(all(explain('export() { :; }\nexport a=1 >/dev/null', 1).items[0]).join('\n'), /Call the function `export`.*stdout/s);
    assert.match(all(explain('unset() { :; }\nunset x', 1).items[0]).join('\n'), /Call the function `unset`/);
    assert.doesNotMatch(notes('local() { :; }\nlocal x', 1), /only inside a function/);
  });

  it('a name `hash -p` gave a path: relative, empty, known only at run time, or on some paths only', () => {
    assert.strictEqual(head('hash -p /usr/bin/tac sort\nsort', 1), 'Run the external command `/usr/bin/tac` (`hash -p` on line 1 gave `sort` the path `/usr/bin/tac`): Print files in reverse line order');
    assert.strictEqual(head('hash -p tac sort\nsort', 1), 'Run `tac` from the current directory (`hash -p` on line 1 gave `sort` the path `tac`; a path that does not start with `/` is not searched in PATH, but run from the current directory)');
    assert.strictEqual(head('hash -p tac sort\nsort', 1, 'ja'), '現在のディレクトリの `tac` を実行する（行 1 の `hash -p` で `sort` は `tac` を指す。`/` で始まらないパスは PATH から探さず、現在のディレクトリから実行する）');
    assert.strictEqual(head('hash -p ./tac sort\nsort', 1), 'Run `./tac` from the current directory (`hash -p` on line 1 gave `sort` the path `./tac`; a path that does not start with `/` is run from the current directory, and one that starts with `./` is forgotten when no file there can run, and PATH searched for `sort`)');
    assert.strictEqual(head('hash -p ./tac sort\nsort', 1, 'ja'), '現在のディレクトリの `./tac` を実行する（行 1 の `hash -p` で `sort` は `./tac` を指す。`/` で始まらないパスは現在のディレクトリから実行し、`./` で始まるパスは、そこに実行できるファイルがなければ忘れて PATH から `sort` を探す）');
    assert.strictEqual(head("hash -p '' sort\nsort", 1), 'Run nothing (`hash -p` on line 1 gave `sort` an empty path: bash fails with "No such file or directory" (status 127))');
    assert.strictEqual(head("hash -p '' sort\nsort", 1, 'ja'), '何も実行できない（行 1 の `hash -p` で `sort` は空のパスを指す。bash は "No such file or directory" で失敗する（終了ステータス 127））');
    assert.strictEqual(head('hash -p "$p" sort\nsort', 1), 'Run an external command (`hash -p` on line 1 gave `sort` a path known only when it runs)');
    assert.strictEqual(head('hash -p "$p" sort\nsort', 1, 'ja'), '外部コマンドを実行する（行 1 の `hash -p` で `sort` は実行時に決まるパスを指す）');
    assert.strictEqual(head('hash -p /usr/bin/tac sort\nset +h\nsort', 2), 'Sort lines');
    const ran = 'if [ "$x" ]; then hash -p /usr/bin/tac sort; fi\nsort';
    assert.strictEqual(head(ran, 1), 'Sort lines (if the `hash -p` on line 1 ran, `sort` runs the path `/usr/bin/tac` instead)');
    assert.strictEqual(head(ran, 1, 'ja'), '行を並べ替える（行 1 の `hash -p` が実行されていれば、`sort` は代わりにパス `/usr/bin/tac` を実行する）');
    assert.strictEqual(head('if [ "$x" ]; then hash -p "$p" sort; fi\nsort', 1), 'Sort lines (if the `hash -p` on line 1 ran, `sort` runs a path known only at run time instead)');
    assert.strictEqual(head('if [ "$x" ]; then hash -p "$p" sort; fi\nsort', 1, 'ja'), '行を並べ替える（行 1 の `hash -p` が実行されていれば、`sort` は代わりに実行時に決まるパスを実行する）');
    const hashing = 'hash -p /usr/bin/tac sort\nif [ "$x" ]; then set +h; fi\nsort';
    assert.strictEqual(head(hashing, 2), 'Sort lines (if hashing is on here, `sort` runs the path `/usr/bin/tac` that `hash -p` on line 1 gave it; `set +h` turns hashing off on some paths)');
    assert.strictEqual(head(hashing, 2, 'ja'), '行を並べ替える（コマンドのハッシュが有効なら、`sort` は行 1 の `hash -p` で指定したパス `/usr/bin/tac` を実行する。`set +h` で無効にする経路がある）');
    assert.strictEqual(head('hash -p "$p" sort\nif [ "$x" ]; then set +h; fi\nsort', 2), 'Sort lines (if hashing is on here, `sort` runs a path known only at run time that `hash -p` on line 1 gave it; `set +h` turns hashing off on some paths)');
    // Another command that changes the table on some paths: the lines that make it differ, and what may run.
    const removed = 'hash -p /usr/bin/tac sort\nif [ -n "$x" ]; then hash -d sort; fi\nsort x';
    assert.strictEqual(head(removed, 2), 'Sort lines (the command path cache may differ here (lines 1 and 2), so `sort` may run the path `/usr/bin/tac` instead)');
    assert.strictEqual(head(removed, 2, 'ja'), '行を並べ替える（ここでのコマンドのパスのキャッシュは一通りに決まらず（行 1、2）、`sort` は代わりにパス `/usr/bin/tac` を実行することもある）');
    // (A body that runs later: tac, or after `hash -d`, PATH; nothing else.)
    const later = (src: string, lang: 'en' | 'ja' = 'en') => all(explain(src, 1, lang).items[0]).find((t) => t.startsWith(lang === 'en' ? 'Sort lines' : '行を並べ替える'));
    assert.strictEqual(later('hash -p /usr/bin/tac sort\ng() { sort i; }\nhash -d sort'), 'Sort lines (the command path cache may differ here (lines 1 and 3), so `sort` may run the path `/usr/bin/tac` instead)');
    assert.strictEqual(later('hash -p /usr/bin/tac sort\ng() { sort i; }\nhash -d sort', 'ja'), '行を並べ替える（ここでのコマンドのパスのキャッシュは一通りに決まらず（行 1、3）、`sort` は代わりにパス `/usr/bin/tac` を実行することもある）');
    assert.strictEqual(all(explain('g() { sort i; }\nhash -p /usr/bin/tac sort', 0).items[0]).find((t) => t.startsWith('Sort lines')), 'Sort lines (if the `hash -p` on line 2 ran, `sort` runs the path `/usr/bin/tac` instead)');
    assert.strictEqual(all(explain('trap \'sort i\' INT\nhash -p /usr/bin/tac sort', 0).items[0]).find((t) => t.startsWith('Sort lines')), 'Sort lines (if the `hash -p` on line 2 ran, `sort` runs the path `/usr/bin/tac` instead)');
    // (The same path on every path, from two commands: sure, with both lines.)
    assert.strictEqual(head('hash -p /usr/bin/tac sort\n[ -n "$x" ] && hash -p /usr/bin/tac sort\nsort', 2), 'Run the external command `/usr/bin/tac` (`hash -p` on lines 1 and 2 gave `sort` the path `/usr/bin/tac`): Print files in reverse line order');
    assert.strictEqual(head('hash -p /usr/bin/tac sort\n[ -n "$x" ] && hash -p /usr/bin/tac sort\nsort', 2, 'ja').split('）')[0], '外部コマンド `/usr/bin/tac` を実行する（行 1、2 の `hash -p` で `sort` は `/usr/bin/tac` を指す');
    // (A `hash -p` where hashing may be off: it ran, and may have failed.)
    assert.strictEqual(head('[ -n "$x" ] && set +h\nhash -p /usr/bin/tac sort\nset -h\nsort i', 3), 'Sort lines (the command path cache may differ here (line 2), so `sort` may run the path `/usr/bin/tac` instead)');
    // One bracket with the explanation's own last one.
    assert.strictEqual(head('[ -n "$x" ] && hash -p /usr/bin/tac tr\ntr a b', 1), 'Translate or delete characters (stdin only; if the `hash -p` on line 1 ran, `tr` runs the path `/usr/bin/tac` instead)');
    assert.strictEqual(head('[ -n "$x" ] && hash -p /usr/bin/tac tr\ntr a b', 1, 'ja'), '文字を置換・削除する（標準入力のみ。行 1 の `hash -p` が実行されていれば、`tr` は代わりにパス `/usr/bin/tac` を実行する）');
    // With checkhash or in POSIX mode, bash forgets a path it cannot run, and searches PATH: an empty one surely.
    assert.strictEqual(head("shopt -s checkhash\nhash -p '' sort\nsort", 2), 'Sort lines');
    assert.strictEqual(head("set -o posix\nhash -p bin/tac sort\nsort", 2), 'Run `bin/tac` from the current directory (`hash -p` on line 2 gave `sort` the path `bin/tac`; a path that does not start with `/` is not searched in PATH, but run from the current directory; with `shopt -s checkhash` or in POSIX mode, bash forgets a path it cannot run and searches PATH for `sort`)');
    assert.strictEqual(head("[ -n \"$x\" ] && shopt -s checkhash\nhash -p '' sort\nsort", 2), 'Run nothing (`hash -p` on line 2 gave `sort` an empty path: bash fails with "No such file or directory" (status 127); if `shopt -s checkhash` or POSIX mode is on, bash forgets a path it cannot run and searches PATH for `sort`)');
    assert.match(head("[ -n \"$x\" ] && shopt -s checkhash\nhash -p '' sort\nsort", 2, 'ja'), /。`shopt -s checkhash` か POSIX モードが有効なら、実行できないパスは忘れて PATH から `sort` を探す）$/);
    assert.match(head('shopt -s checkhash\nhash -p "$p" sort\nsort', 2, 'ja'), /。`shopt -s checkhash` か POSIX モードなので、実行できないパスなら忘れて PATH から `sort` を探す）$/);
    // A word of a program the dictionary does not know names no manual.
    for (const src of ['hash -p tac sort\nsort -n f', 'hash -p "$p" sort\nsort -n f']) {
      assert.strictEqual(all(explain(src, 1).items[0]).find((t) => t.includes('word passed')), 'A word passed to the program `hash -p` on line 1 gave `sort`, which the dictionary does not describe', src);
    }
    assert.ok(all(explain('hash -p tac sort\nsort -n f', 1, 'ja').items[0]).includes('行 1 の `hash -p` で `sort` が指すプログラムに渡す単語（辞書にない）'));
    assert.match(head("if [ -n \"$x\" ]; then hash -p '' sort; fi\nsort", 1), /`sort` runs an empty path instead\)$/);
    assert.match(head("if [ -n \"$x\" ]; then hash -p '' sort; fi\nsort", 1, 'ja'), /`sort` は代わりに空のパスを実行する）$/);
    assert.notStrictEqual(explain('hash -p "$p" t\nt -n x', 1).items[0].children[0].kind, 'test');
    assert.match(head('hash -p /usr/bin/tac sort\nif [ -n "$x" ]; then PATH=/bin; fi\nsort', 2), /\(lines 1 and 2\), so `sort` may run the path `\/usr\/bin\/tac` instead\)$/);
    assert.match(head('hash -p /usr/bin/tac sort\nif [ -n "$x" ]; then hash -r; fi\nif [ -n "$y" ]; then set +h; fi\nsort', 3), /\(lines 1 and 2\), so `sort` may run the path `\/usr\/bin\/tac` instead; `set \+h` turns hashing off on some paths\)$/);
    const either = 'hash -p /usr/bin/tac sort\nif [ -n "$x" ]; then hash -p /usr/bin/rev sort; fi\nsort';
    assert.strictEqual(head(either, 2), 'Run an external command (the command path cache may differ here (lines 1 and 2), so `sort` runs the path `/usr/bin/tac` or the path `/usr/bin/rev`)');
    assert.strictEqual(head(either, 2, 'ja'), '外部コマンドを実行する（ここでのコマンドのパスのキャッシュは一通りに決まらず（行 1、2）、`sort` はパス `/usr/bin/tac` かパス `/usr/bin/rev` を実行する）');
    // (No example of sort there: it may not sort. Nor of a word read with the name's spec: grep may be egrep.)
    assert.strictEqual(explain('if [ "$x" ]; then hash -p /usr/bin/tac sort; fi\nsort <<< "b"', 1).examples.length, 0);
    assert.strictEqual(explain('if [ -n "$x" ]; then hash -p /usr/bin/egrep grep; fi\ngrep -o \'a+\' f', 1).examples.length, 0);
    assert.ok(explain('grep -o \'a+\' f', 0).examples.length > 0);
    // (But the commands inside its words keep theirs, as for a function.)
    const titles = (src: string) => explain(src, src.split('\n').length - 1).examples.map((e) => e.title);
    assert.ok(titles(`grep "$(printf 'b\\na\\nc\\n' | sort)" f`).length && titles('grep -e "$(date +%Y)" f').length);
    for (const hash of ['[ -n "$x" ] && hash -p /usr/bin/egrep grep', 'hash -p /opt/frob grep']) {
      assert.deepStrictEqual(titles(`${hash}\ngrep "$(printf 'b\\na\\nc\\n' | sort)" f`), titles(`grep "$(printf 'b\\na\\nc\\n' | sort)" f`), hash);
      assert.deepStrictEqual(titles(`${hash}\ngrep -e "$(date +%Y)" f`), titles(`grep -e "$(date +%Y)" f`), hash);
      assert.ok(titles(`${hash}\ngrep "$(echo aa | sed 's/a/b/')" f`).length > 0, hash);
    }
    assert.deepStrictEqual(titles('hash -p tac sort\nsort -k "$(printf \'%d\' 2)" f'), titles('f() { :; }\nf "$(printf \'%d\' 2)"'));
    assert.ok(titles('hash -p tac sort\nsort -k "$(printf \'%d\' 2)" f').length > 0);
    // An alias to such a name says so, and reads its words with no one spec.
    const alias = 'shopt -s expand_aliases\nif [ -n "$x" ]; then hash -p /usr/bin/tac sort; fi\nalias s=sort\ns <<< "b"';
    assert.strictEqual(head(alias.replace(' <<< "b"', ''), 3), 'The alias `s` defined on line 3: replaced by `sort` (if the `hash -p` on line 2 ran, `sort` runs the path `/usr/bin/tac` instead)');
    assert.strictEqual(explain(alias, 3).examples.length, 0);
    assert.match(head('shopt -s expand_aliases\nhash -p /usr/bin/tac sort\nif [ -n "$x" ]; then set +h; fi\nalias s=sort\ns', 4), /replaced by `sort` \(if hashing is on here, `sort` runs the path `\/usr\/bin\/tac`/);
    assert.ok(explain('sort <<< "b"', 0).examples.length > 0);
    // `test` by a path with no slash is no `test` the dictionary knows.
    assert.strictEqual(explain('hash -p /usr/bin/test t\nt -n x', 1).items[0].children[0].kind, 'test');
    assert.notStrictEqual(explain('hash -p test t\nt -n x', 1).items[0].children[0].kind, 'test');
  });

  it('`command` runs the program of a builtin turned off; `builtin` of it fails', () => {
    const c = explain('enable -n echo\ncommand echo z', 1).items[0].children.find((x) => x.label === 'echo')!;
    assert.strictEqual(c.kind, 'command');
    assert.match(c.explanation, /the external command `echo` \(`enable -n` on line 1 turned the builtin off\): .*coreutils/);
    assert.match(explain('enable -n echo\ncommand echo z', 1, 'ja').items[0].children.find((x) => x.label === 'echo')!.explanation, /組み込みは無効/);
    assert.match(explain('enable -n read\ncommand read z', 1).items[0].children.find((x) => x.label === 'read')!.explanation, /turned the builtin off\)$/);
    assert.strictEqual(explain('enable -n echo\nbuiltin echo y', 1).items[0].children.find((x) => x.label === 'echo')!.kind, 'command');
  });

  it('a function named like a tool gets no example of the tool', () => {
    assert.strictEqual(explain('read() { :; }\nread -r line <<< "a b"', 1).examples.length, 0);
    assert.ok(explain('read -r line <<< "a b"', 0).examples.length > 0);
  });

  it('a word that names a member of every JavaScript object finds nothing in the dictionary', () => {
    // (bash 5.2: `toString` is not found, `type -t` prints nothing; jq 1.7: `.toString` of `{"a":1}` is null.)
    for (const name of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
      const t = explain(`${name} x`, 0).items[0];
      assert.strictEqual(t.kind, 'command', name);
      assert.match(t.explanation, new RegExp(`external command \`${name}\``), name);
      assert.strictEqual(short(resolve(`${name} x`, `${name} x`)), 'file:search-unknown', name);
    }
    const text = (src: string): string => JSON.stringify(explain(src, 0));
    for (const src of ['set -o constructor', 'cat < constructor', 'echo hi 2> valueOf', 'enable -n toString', "jq 'constructor' a.json", "yq '.a | constructor' a.yaml", 'yq -o constructor . a.yaml']) {
      assert.doesNotMatch(text(src), /undefined/, src);
    }
    assert.match(text(`echo '{"a":1}' | jq '.toString'`), /"null"/);
    assert.match(text(`echo '{"constructor":1}' | jq '.constructor'`), /"1"/);
  });

  it('an assignment before a name that may expand to no word', () => {
    assert.match(all(explain('x=1 $cmd', 0).items[0]).join('\n'), /if `\$cmd` expands to no word at all, it stays as a shell variable/);
    assert.match(all(explain('x=1 $cmd', 0, 'ja').items[0]).join('\n'), /シェルの変数として残る/);
    assert.doesNotMatch(all(explain('x=1 "$cmd"', 0).items[0]).join('\n'), /expands to no word at all/);
  });

  it('a function, what it hides, and "may"', () => {
    assert.match(head('cd() { :; }\ncd /', 1), /function `cd` defined on line 1 \(it runs instead of the builtin of that name; `builtin cd` runs the builtin\)/);
    assert.match(head('ls() { :; }\nls', 1), /\(it runs instead of the command of that name; `command ls` runs the command\)/);
    assert.match(head('ls() { :; }\nls', 1, 'ja'), /`command ls` で呼べる/);
    assert.match(head('cd() { :; }\ncd /', 1, 'ja'), /`builtin cd` で呼べる/);
    assert.match(head('if [ "$x" ]; then f() { :; }; fi\nf', 1), /But only some paths before here \(a branch…\) define it/);
    assert.match(head('if [ "$x" ]; then f() { :; }; fi\nf', 1, 'ja'), /一部の経路/);
  });

  it('why a function of the script is not what runs', () => {
    assert.match(notes('( f() { :; } )\nf', 1), /in a subshell, and what a subshell defines is gone/);
    assert.match(notes('( f() { :; } )\nf', 1, 'ja'), /サブシェルの中/);
    assert.match(notes('o() { f() { :; }; }\nf', 1), /inside the function `o`, which has not run before this/);
    assert.match(notes('o() { f() { :; }; }\nf', 1, 'ja'), /関数 `o` の中で定義され/);
    assert.match(notes('f() { :; }\nunset -f f\nf', 2), /removed by `unset` on line 2/);
    assert.match(notes('f() { :; }\nunset -f f\nf', 2, 'ja'), /行 2 の `unset` で削除/);
    assert.match(notes('eval() { :; }\nset -o posix\neval x', 2), /In POSIX mode a special builtin is found before a function/);
    assert.match(notes('eval() { :; }\nset -o posix\neval x', 2, 'ja'), /特殊ビルトインが関数より先に/);
  });

  it('a function named like a special builtin in POSIX mode stops bash', () => {
    assert.match(notes('set -o posix\neval() { :; }', 1), /bash says "is a special builtin" and stops the script here\. Use another name/);
    assert.match(notes('set -o posix\neval() { :; }', 1, 'ja'), /スクリプトを止めます。別の名前/);
    assert.match(notes('[ "$x" ] && set -o posix\neval() { :; }', 1), /only some paths before here turn POSIX mode on/);
    assert.match(notes('[ "$x" ] && set -o posix\neval() { :; }', 1, 'ja'), /一部の経路だけ/);
    assert.strictEqual(notes('set -o posix\neval() { :; }', 1, 'en', { pitfalls: false }), '');
  });

  it('builtins turned off and paths remembered', () => {
    assert.match(head('enable -n echo\necho hi', 1), /^Run the external command `echo` \(`enable -n` on line 1 turned the builtin `echo` off\): .*coreutils/);
    assert.match(head('enable -n echo\necho hi', 1, 'ja'), /行 1 の `enable -n`/);
    assert.match(head('hash -p /bin/echo e\ne hi', 1), /^Run the external command `\/bin\/echo` \(`hash -p` on line 1 gave `e` the path `\/bin\/echo`\): Print/);
    assert.match(head('hash -p /bin/echo e\ne hi', 1, 'ja'), /`e` は `\/bin\/echo` を指す/);
    assert.match(head('hash -p /opt/x e\ne hi', 1), /^Run the external command `\/opt\/x` \(`hash -p` on line 1 gave `e` the path `\/opt\/x`\)$/);
    assert.match(head('hash -p /usr/bin/jq e\ne .', 1), /jq/);
  });

  it('aliases: chains, and on some paths only', () => {
    assert.match(head('shopt -s expand_aliases\nalias a=b b=\'echo B\'\na', 2), /replaced by `b` \(`b` is an alias too, for `echo B`\)$/);
    assert.match(head('shopt -s expand_aliases\nalias a=b b=\'echo B\'\na', 2, 'ja'), /`b` もエイリアスで/);
    assert.match(head('shopt -s expand_aliases\n[ "$x" ] && alias ll=\'ls -l\'\nll', 2), /only when its definition has run/);
    assert.match(head('shopt -s expand_aliases\n[ "$x" ] && alias ll=\'ls -l\'\nll', 2, 'ja'), /定義する行を通ったときだけ/);
  });

  it('`command` and `builtin` skip the function; `builtin` fails on a name that is no builtin', () => {
    const cmd = all(explain('cd() { :; }\ncommand cd /', 1).items[0]).join('\n');
    assert.match(cmd, /Change the current directory \(not the function of that name, defined on line 1\)/);
    assert.match(all(explain('cd() { :; }\ncommand cd /', 1, 'ja').items[0]).join('\n'), /行 1 の同じ名前の関数は使わない/);
    assert.match(all(explain('builtin nosuch', 0).items[0]).join('\n'), /`nosuch` is not a builtin, so `builtin` fails/);
    assert.match(all(explain('builtin nosuch', 0, 'ja').items[0]).join('\n'), /組み込みコマンドではない/);
    assert.doesNotMatch(all(explain('command ls', 0).items[0]).join('\n'), /not the function/);
  });

  it('a function in a string run by another shell', () => {
    const fn = 'f() { :; }\nexport -f f\n';
    assert.match(notes(`${fn}dash -c f`, 2), /`dash -c` runs the command in dash, which does not read the functions bash exports/);
    assert.match(notes(`${fn}dash -c f`, 2, 'ja'), /dash は bash がエクスポートした関数を読まない/);
    assert.match(notes(`${fn}sh -c f`, 2), /sh, which is dash on Debian and Ubuntu.*may not be there/);
    assert.match(notes(`${fn}sh -c f`, 2, 'ja'), /Debian や Ubuntu の sh は dash/);
    assert.strictEqual(notes(`${fn}bash -c f`, 2), '');
    assert.match(notes('f() { :; }\nbash -c f', 1), /pass the function with `export -f f` first/);
    assert.match(notes('bash -c f\nf() { :; }', 0), /pass the function with `export -f f` first/);
  });

  it('an assignment before a special builtin when POSIX mode is on on some paths', () => {
    const t = all(explain('[ "$v" ] && set -o posix\nx=1 :', 1).items[0]).join('\n');
    assert.match(t, /`:` is a POSIX special builtin, so if POSIX mode is on here \(only some paths before here turn it on\), this assignment stays/);
    assert.match(all(explain('[ "$v" ] && set -o posix\nx=1 :', 1, 'ja').items[0]).join('\n'), /ここで POSIX モードなら/);
    // (A name known only at run time is not a special builtin.)
    assert.match(all(explain('set -o posix\nx=1 $cmd', 1).items[0]).join('\n'), /Environment variable set only for this command/);
  });

  it('`test` reads an expression by its spec, the builtin or the program', () => {
    const builtin = all(explain('test -f a', 0).items[0]).join('\n');
    const turnedOff = all(explain('enable -n test\ntest -f a', 1).items[0]).join('\n');
    assert.match(builtin, /regular file/);
    assert.match(turnedOff, /regular file/);
    assert.doesNotMatch(all(explain('test() { :; }\ntest -f a', 1).items[0]).join('\n'), /regular file/);
  });

  it('declaration options take the texts of the builtin\'s spec', () => {
    const t = (src: string): string => all(explain(src, 0).items[0]).join('\n');
    assert.match(t('declare +x v'), /stop exporting/);
    assert.match(t('declare -ix v'), /treat as integer/);
    assert.match(t('export -n v'), /remove the export property/);
    assert.match(t('readonly -f f'), /make functions read-only/);
    assert.match(t('declare +g v'), /\bOption\b/);
  });

  it('unset removes what bash removes: a variable if there is one, else a function (checked with bash)', () => {
    const bash = (code: string, ...args: string[]): string => execFileSync('bash', ['-c', code, 'bash', ...args]).toString();
    const text = (src: string, line: number): string => all(explain(src, line).items[0]).join('\n');
    // [script before the unset, unset arguments, what bash removes, what stays, the text]
    type Row = [string, string, 'function' | 'variable', 'function' | 'variable' | '', RegExp];
    const rows: Row[] = [
      ['f() { :; }', 'f', 'function', '', /Remove the function `f`/],
      ['f() { :; }; f=1', 'f', 'variable', 'function', /Unset the variable `f`/],
      ['f() { :; }; f=1', '-f f', 'function', 'variable', /Remove the function `f`/],
      ['f() { :; }; f=1', '-v f', 'variable', 'function', /Unset the variable `f`/],
      ['f() { :; }', '-v f', 'variable', 'function', /Unset the variable `f`/],
      ['f=1', 'f', 'variable', '', /Unset the variable `f`/],
      [':', 'f', 'variable', '', /Unset the variable `f`/],
      // (`-n` without a name reference: bash does not fall back to the function.)
      ['f() { :; }', '-n f', 'variable', 'function', /`f` is not a name reference, so nothing is unset/],
      // (A variable that is only maybe set: the variable, or, if there is none, the function.)
      ['f() { :; }; if [ -n "$1" ]; then f=1; fi', 'f', 'variable', 'function', /Unset the variable `f`.*If there is no such variable, the function `f`/],
    ];
    for (const [before, args, removes, stays, expected] of rows) {
      const code = `${before}\nunset ${args}\n`;
      // What is left after the unset: the function f and the variable f (run with an argument, so the maybe-set variable is set).
      const probe = `${code}declare -F f >/dev/null && echo function; [ "\${f+set}" = set ] && echo variable; true`;
      const left = bash(probe, 'x');
      assert.ok(!left.includes(removes), code);
      // The other one is still there, where it existed before.
      if (stays) assert.ok(left.includes(stays), code);
      assert.match(text(code, code.split('\n').length - 2), expected, code);
    }
    // Without the argument the maybe-set variable is not there, and bash removes the function.
    assert.strictEqual(bash('f() { :; }; if [ -n "$1" ]; then f=1; fi; unset f; declare -F f >/dev/null && echo function; true'), '');
  });

  it('`unset` is a command: its words are read with its spec wherever the builtin runs (checked with bash)', () => {
    // Run in an empty directory, but for the files a row makes: an unquoted `a[1]` is a glob.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-unset-'));
    const bash = (code: string): string => execFileSync('bash', ['-c', code], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const text = (src: string): string => all(explain(src, src.split('\n').length - 1).items[0]).join('\n');
    const show = 'declare -p x a 2>/dev/null | sed "s/^declare -[-a] //"; declare -F f; true';
    // [the script, the last line explained, what bash leaves, the text]
    const rows: [string, string, RegExp][] = [
      ['x=5\nx=1 unset x', 'x="5"\n', /Unset the variable `x` that `x=1` set for this command only \(a `x` set before the command, if any, stays/],
      ['true\nx=1 unset x', '', /Unset the variable `x` that `x=1` set for this command only \(a `x` set before the command, if any, stays/],
      ['readonly x=1\nunset x', 'declare -r x="1"\n', /The variable `x` is read-only, so it is not unset \(an error, status 1\)/],
      ['shopt -s nullglob; a=(1 2 3)\nunset a[1]', 'a=([0]="1" [1]="2" [2]="3")\n', /nullglob makes the word go away and nothing is unset/],
      ['shopt -s failglob; a=(1 2 3)\nunset a[1]', 'a=([0]="1" [1]="2" [2]="3")\n', /failglob makes it an error \(`no match`\) and nothing is unset/],
      ['set -f; a=(1 2 3)\nunset a[1]', 'a=([0]="1" [2]="3")\n', /Unset the element `a\[1\]` of the array `a` \(the other elements keep their indices\)\. But `set -f`/],
      ['x=5\n\\unset x', '', /The command name `\\unset` becomes `unset`[\s\S]*Unset the variable `x` \(it becomes undefined\)/],
      ['x=5\ncommand unset x', '', /^(?![\s\S]*runs `unset`)[\s\S]*Unset the variable `x` \(it becomes undefined\)/],
      ['f() { :; }\nbuiltin unset f', '', /Remove the function `f`/],
      ['a=(1 2 3)\nunset \'a[1]\'', 'a=([0]="1" [2]="3")\n', /Unset the element `a\[1\]` of the array `a`/],
      ['a=(1 2 3)\nunset a[1]', 'a=([0]="1" [2]="3")\n', /Unset the element `a\[1\]`[\s\S]*if a file matches it, that file's name is unset instead/],
      ['a=(1 2 3); a1=x; touch a1\nunset a[1]', 'a=([0]="1" [1]="2" [2]="3")\n', /Unset the element `a\[1\]`[\s\S]*if a file matches it, that file's name is unset instead/],
      // (A subscript with an expansion: a glob of its parts, `a[2]` here, which no file matches.)
      ['a=(1 2 3); i=2\nunset a[$i]', 'a=([0]="1" [1]="2")\n', /Unset the element `a\[\$i\]` of the array `a`[\s\S]*if a file matches it, that file's name is unset instead \(write `'a\[\$i\]'`\)/],
      ['a=(1 2 3)\nunset "a[@]"', 'a=()\n', /Remove all the elements of the array `a` \(it stays, empty\)/],
      ['f() { :; }; x=1\nunset -fv x f', 'x="1"\nf\n', /Name to unset \(with both `-f` and `-v`, nothing is unset\)/],
      ['x=1\nunset -- x', '', /End of options[\s\S]*Unset the variable `x`/],
      ['unset() { :; }; x=1\n\\unset x', 'x="1"\n', /Call the function `unset`/],
    ];
    try {
      for (const [src, left, expected] of rows) {
        assert.strictEqual(bash(`${src}\n${show}`).replace(/^declare -a /gm, ''), left, src);
        assert.match(text(src), expected, src);
      }
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
    // A name known only at run time: the role of the word.
    assert.match(text('unset "$y"'), /name to unset/);
    assert.match(text('declare a[$i]'), /Declare the array `a` \(bash ignores the subscript `\[\$i\]`\)\. Unquoted, it is a glob pattern first/);
    assert.match(text('unset "a[$i]" a[$i]x'), /^(?![\s\S]*Unset the element)/);
    assert.match(notes('readonly x=1\nunset x', 1), /`unset` fails \(`cannot unset: readonly variable`, status 1\)/);
    assert.match(text('if [ "$1" ]; then readonly x; fi\nunset x'), /some paths before here make it read-only/);
    assert.match(text('a=(1 2); if [ "$1" ]; then shopt -s nullglob; fi\nunset a[1]'), /on the paths where nullglob or failglob is on/);
    // `-fv` says why nothing is removed, once.
    assert.strictEqual(notes('f() { :; }\nunset -fv x f', 1).match(/cannot simultaneously unset/g)?.length, 1);
    assert.match(notes('unset -fv x', 0, 'ja'), /何も削除されません/);
  });

  it('a pipeline stage that runs a function or an alias has no example of the program of that name', () => {
    const has = (src: string, line: number): boolean => explain(src, line).examples.some((e) => /pipeline/.test(e.title));
    const bash = (code: string): string => execFileSync('bash', ['-c', code]).toString();
    // The program sorts; the function reverses.
    assert.strictEqual(bash("printf 'a\\nb\\n' | sort"), 'a\nb\n');
    assert.strictEqual(bash("sort() { tac; }\nprintf 'a\\nb\\n' | sort"), 'b\na\n');
    assert.ok(has("printf 'a\\nb\\n' | sort", 0));
    assert.ok(!has("sort() { tac; }\nprintf 'a\\nb\\n' | sort", 1));
    assert.ok(!has("shopt -s expand_aliases\nalias sort='sort -r'\nprintf 'a\\nb\\n' | sort", 2));
    assert.ok(has("sort() { tac; }\nunset -f sort\nprintf 'a\\nb\\n' | sort", 2));
  });
});

// Whether a command runs `test` or `[` (`testSpecOf`), the one place that decides it. Checked with bash 5.2: a
// function `[` runs instead, `enable -n [` and `hash -p` run the program (which wants a `]` by what it is, not by
// the name it is called with: `hash -p /usr/bin/[ b; b -f x` says "missing ‘]’").
describe('what runs test', () => {
  const at = (src: string, text: string) => {
    const { node, tree } = commandAt(src, text);
    return testSpecAt(shellState(tree), node);
  };
  const cases: [src: string, text: string, runs: 'builtin [' | 'builtin test' | 'program [' | 'program test' | undefined][] = [
    ['[ a ]', '[ a ]', 'builtin ['],
    ['\\[ a ]', '\\[ a ]', 'builtin ['],
    ['"[" a ]', '"[" a ]', 'builtin ['],
    ['test a', 'test a', 'builtin test'],
    ['/usr/bin/[ a ]', '/usr/bin/[ a ]', 'program ['],
    ['enable -n [\n[ a ]', '[ a ]', 'program ['],
    ['hash -p /usr/bin/test t\nt -f x', 't -f x', 'program test'],
    ['hash -p /usr/bin/[ b\nb -f x', 'b -f x', 'program ['],
    ['[() { :; }\n[ a ]', '[ a ]', undefined],
    ['$c a', '$c a', undefined],
    ['ls a', 'ls a', undefined],
  ];
  for (const [src, text, runs] of cases) {
    it(`${JSON.stringify(src)}: ${runs ?? 'no test'}`, () => {
      const spec = at(src, text);
      const got = spec && `${spec.builtin ? 'builtin' : 'program'} ${spec.closingOperand ? '[' : 'test'}`;
      assert.strictEqual(got, runs);
    });
  }
});
