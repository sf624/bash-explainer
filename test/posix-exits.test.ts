// What ends a non-interactive shell in POSIX mode (manual 4.4, 6.11; src/semantics/posixexits.ts), and what `exit` does
// with words that give it no status, checked with bash 5.2 (on PATH) and 5.3 (`$BASH_EXPLAINER_BASH53`): a function name
// bash refuses, the errors of a special builtin, an assignment to a readonly variable; and `$?` after a command
// substitution, which bash 5.3's POSIX mode does not change. Each script is read by bash from stdin, line by line as a
// script file is, so an error that ends only the line is told from one that ends the shell.
//
// The tables say, for each release, whether bash ends the shell after the line. The model is checked against the
// tables in both releases with no bash (so that coverage does not depend on a bash 5.3): the note on the line, and the
// code it fades after it, in both directions; then each table is checked against bash, where it can be run.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { BashVersion } from '../src/bashversion';
import { fact } from '../src/messages';
import { builtinExit, definitionExit, exitRefusal } from '../src/semantics/posixexits';
import { shellState } from '../src/semantics/state';
import { statusModel } from '../src/semantics/status';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { run } from './support/run';

const parser = createUnbashParser();
const RELEASES: [BashVersion, string | undefined][] = [['5.2', 'bash'], ['5.3', process.env.BASH_EXPLAINER_BASH53]];
const at = (version: BashVersion) => (version === '5.2' ? 0 : 1);

/** What bash prints for the script (its shebang is a comment to it), run from stdin, in POSIX mode with `posix`. */
function bash(program: string, script: string, posix = true): string {
  const r = run(program, ['--norc', '--noprofile', ...(posix ? ['--posix'] : []), '-s'], { input: script, env: { PATH: '/usr/bin:/bin', HOME: '/home/w', LC_ALL: 'C', FUNCNEST: '50' }, timeout: 10000 });
  return r.stdout.toString();
}

/** The lines of the commands the model of `script` (bash `version`) says never run. */
const faded = (script: string, version: BashVersion): number[] => {
  const tree = parser.parse(script);
  const st = shellState(tree, 'bash', { version });
  return descendants(tree.root, ['command']).filter((c) => st.dead(c)).map((c) => c.startPosition.row);
};

/** The notes of line 1 (the second line) of `script`, as `version` explains it. */
const notes = (script: string, version: BashVersion): string[] => new Analyzer('en').explainLine(parser.parse(script), 1, 'bash', { bashVersion: version }).notes;

const POSIX = '#!/bin/bash --posix\n';

/**
 * A line after the shebang and whether bash 5.2 and 5.3 end the shell there (`exits`). The note (`note`) is said in the
 * releases of `noted` (by default, where it exits); the line after is faded where it exits, unless the script is one
 * the model trusts nothing in (`blind`: an option a builtin lacks) or the model says nothing there (`silent`).
 */
interface Case { line: string; exits: [boolean, boolean]; note?: RegExp; noted?: [boolean, boolean]; blind?: boolean; silent?: [boolean, boolean] }

const CASES: Case[] = [
  { line: 'a-b() { :; }', exits: [true, false], note: /bash 5\.2 refuses a function name that is not a valid name: it says "not a valid identifier" and stops the script here/ },
  { line: 'a.b() { :; }', exits: [true, false], note: /bash 5\.2 refuses a function name/ },
  { line: 'export() { :; }', exits: [true, true], note: /cannot have the name of a special builtin/ },
  { line: 'set -Z', exits: [true, true], note: /here `set` has no option `-Z`, so bash stops the script here \(status 2\)/, blind: true },
  { line: 'set -euo bogus', exits: [true, true], note: /`bogus` is no option name of `set -o`/, blind: true },
  { line: 'exec -a', exits: [true, true], note: /`-a` has no value/ },
  { line: 'exec -a 2>/dev/null', exits: [true, true], note: /`-a` has no value/ },
  { line: '.', exits: [true, true], note: /`\.` is given no file to read/, blind: true },
  { line: 'trap INT', exits: [true, true], note: /a lone word that is no signal number/ },
  { line: 'times -x', exits: [true, true], note: /`times` has no option `-x`/, blind: true },
  { line: 'export 1x=2', exits: [false, true], note: /`1x=2` is not a valid name, so bash stops the script here \(status 1; bash 5\.3 on: bash 5\.2 goes on, with status 1\)/ },
  { line: 'export 1x 2>/dev/null', exits: [false, true], note: /`1x` is not a valid name/ },
  { line: 'export -p a-b', exits: [false, true], note: /`a-b` is not a valid name/ },
  { line: 'unset -v 1x', exits: [false, true], note: /`1x` is not a valid name/ },
  { line: 'readonly r=1; unset r', exits: [false, true], note: /`r` is a read-only variable/ },
  { line: 'shift x', exits: [false, true], note: /`x` is no number/ },
  { line: 'exit x', exits: [true, true], note: /`x` is no number, so bash stops the script here \(status 2; bash 5\.3 on/, noted: [false, true] },
  { line: 'readonly r=1; r=2 :', exits: [true, true], note: /in POSIX mode, bash stops the script here, status 1/ },
  // `set -o` and `set +o` alone list the options; a word that starts with `-` or `+` is no name.
  { line: 'set -o >/dev/null', exits: [false, false] },
  { line: 'set +o >/dev/null', exits: [false, false] },
  { line: 'set -eo >/dev/null; set +e', exits: [false, false] },
  { line: 'set -o -e >/dev/null; set +e', exits: [false, false] },
  { line: 'set -o "" >/dev/null', exits: [false, false] },
  { line: 'x=$(set +o)', exits: [false, false] },
  { line: 'set -o | grep -c . >/dev/null', exits: [false, false] },
  // (Letters after `o`, which bash reads erratically: nothing is said.)
  { line: 'set -oposix >/dev/null 2>&1', exits: [false, false], blind: true },
  { line: 'set -opipefail >/dev/null 2>&1', exits: [true, true], silent: [true, true], blind: true },
  // Not where `set -e` would not stop it, nor behind `command`, nor with what bash accepts.
  { line: 'set -Z || :', exits: [false, false], blind: true },
  { line: 'if export 1x; then :; fi', exits: [false, false] },
  { line: "eval 'export 1x' || :", exits: [false, false] },
  // (bash 5.2 exits on an error in a string `eval` runs in a condition; the walk says nothing there, as for `set -e`.)
  { line: "if eval 'set -Z'; then :; fi", exits: [true, false], silent: [true, false], blind: true },
  { line: 'command set -Z', exits: [false, false], blind: true },
  { line: 'trap 2', exits: [false, false] },
  { line: 'trap "" INT', exits: [false, false] },
  { line: 'unset a-b', exits: [false, false] },
  { line: 'export -f a-b', exits: [false, false] },
  { line: 'shift 1', exits: [false, false] },
  { line: 'f() { :; }', exits: [false, false] },
  { line: 'exit 1 2', exits: [false, false] },
  { line: 'exit x || :', exits: [true, false], noted: [false, false] },
  // In a subshell, only the subshell ends; in a trap's action, when the trap runs.
  { line: '( set -Z )', exits: [false, false], note: /so bash ends this subshell here/, noted: [true, true], blind: true },
  { line: '( a-b() { :; } )', exits: [false, false], note: /and ends this subshell here \(status 2;/, noted: [true, false] },
  { line: "trap 'set -Z' EXIT", exits: [false, false], note: /In a trap's action, that happens when the trap runs; in a trap on `EXIT` the script is ending anyway/, noted: [true, true], blind: true },
];

/**
 * `exit` with words that give it no status, in and out of POSIX mode (`exitRefusal`): whether bash 5.2 and 5.3 end the
 * shell, and the note in each release (`exit-refused`, or the POSIX-mode note of a special builtin).
 */
const EXIT_CASES: { line: string; posix: boolean; exits: [boolean, boolean]; notes: [RegExp | undefined, RegExp | undefined] }[] = [
  { line: 'exit x', posix: false, exits: [true, false], notes: [/`x` is no number: bash 5\.2 says "numeric argument required" and exits, status 2/, /`x` is no number: bash 5\.3 says "numeric argument required" but does not exit; the shell goes on, status 2/] },
  { line: 'exit -- 1x', posix: false, exits: [true, false], notes: [/`1x` is no number/, /`1x` is no number/] },
  { line: 'exit x y', posix: false, exits: [true, false], notes: [/`x` is no number/, /`x` is no number/] },
  { line: 'exit 1 2', posix: false, exits: [false, false], notes: [/given more words, bash says "too many arguments" and does not exit; the shell goes on \(status 1 in bash 5\.2/, /\(status 2 in bash 5\.3/] },
  { line: 'exit 1 2', posix: true, exits: [false, false], notes: [/too many arguments/, /too many arguments/] },
  { line: 'exit x', posix: true, exits: [true, true], notes: [/bash 5\.2 says "numeric argument required" and exits/, /POSIX mode an error of a special builtin/] },
  { line: 'exit x || :', posix: true, exits: [true, false], notes: [/bash 5\.2 says "numeric argument required" and exits/, /bash 5\.3 says "numeric argument required" but does not exit/] },
  { line: 'exit " 3 "', posix: false, exits: [true, true], notes: [undefined, undefined] },
  { line: 'exit', posix: false, exits: [true, true], notes: [undefined, undefined] },
  { line: 'exit -- 3', posix: false, exits: [true, true], notes: [undefined, undefined] },
];

describe('what ends the shell in POSIX mode (6.11, 4.4)', function () {
  this.timeout(60000);

  for (const [version] of RELEASES) {
    it(`the model of bash ${version}: the note on the line, and the code after it, as the table says`, () => {
      for (const { line, exits, note, noted, blind, silent } of CASES) {
        const script = `${POSIX}${line}\necho after`;
        const said = notes(script, version).filter((n) => /: in POSIX mode|in POSIX mode, bash stops/.test(n));
        if ((noted ?? exits)[at(version)] && !silent?.[at(version)]) assert.ok(note && said.some((n) => note.test(n)), `${version} ${line}: ${said.join(' | ')}`);
        else assert.deepStrictEqual(said, [], `${version} ${line}`);
        // (Faded exactly where bash exits, when the model trusts the script and says something.)
        const fades = exits[at(version)] && !blind && !silent?.[at(version)];
        assert.strictEqual(faded(script, version).includes(2), fades, `${version} ${line}: faded`);
      }
      for (const { line, posix, exits, notes: want } of EXIT_CASES) {
        const script = `${posix ? POSIX : '#!/bin/bash\n'}${line}\necho after`;
        const said = notes(script, version).filter((n) => /`exit`|exit|status/.test(n));
        const re = want[at(version)];
        if (re) assert.ok(said.some((n) => re.test(n)), `${version} ${line}: ${said.join(' | ')}`);
        else assert.deepStrictEqual(said, [], `${version} ${line}`);
        assert.strictEqual(faded(script, version).includes(2), exits[at(version)], `${version} ${line} (posix ${posix}): faded`);
      }
    });
  }

  for (const [version, program] of RELEASES) {
    it(`the tables agree with bash ${version}`, function () {
      if (!program) this.skip();
      for (const { line, exits } of CASES) {
        assert.strictEqual(!bash(program!, `${POSIX}${line}\necho after`).includes('after'), exits[at(version)], `bash ${version}: ${line}`);
      }
      for (const { line, posix, exits } of EXIT_CASES) {
        assert.strictEqual(!bash(program!, `${line}\necho after`, posix).includes('after'), exits[at(version)], `bash ${version}: ${line} (posix ${posix})`);
      }
    });
  }

  it('says it may end the shell where POSIX mode is on some paths only', () => {
    const src = 'if [ "$x" ]; then set -o posix; fi\nset -Z\na-b() { :; }';
    const e = new Analyzer('en');
    assert.match(e.explainLine(parser.parse(src), 1, 'bash').notes.join('\n'), /ⓘ Caveat: in POSIX mode an error of a special builtin .* \(status 2; on some paths only/);
    assert.match(e.explainLine(parser.parse(src), 2, 'bash').notes.join('\n'), /ⓘ Caveat: in POSIX mode bash 5\.2 refuses a function name .*only some paths before here turn POSIX mode on/);
    // (Another shell: a special builtin's name only, as before.)
    assert.match(e.explainLine(parser.parse('set -o posix\nexport() { :; }'), 1, 'sh').notes.join('\n'), /cannot have the name of a special builtin: bash says "is a special builtin" and stops the script here/);
    assert.match(e.explainLine(parser.parse('if [ "$x" ]; then set -o posix; fi\nexport() { :; }'), 1, 'bash').notes.join('\n'), /only some paths before here turn POSIX mode on/);
    assert.deepStrictEqual(e.explainLine(parser.parse('set -o posix\nset -Z'), 1, 'dash').notes.filter((n) => /POSIX mode/.test(n)), []);
  });

  it('decides an error only from the words written', () => {
    const exitOf = (src: string, version: BashVersion = '5.3') => {
      const tree = parser.parse(src);
      const st = shellState(tree, 'bash', { posix: true, version });
      const c = descendants(tree.root, ['command', 'function_definition']).pop()!;
      const e = c.type === 'function_definition' ? definitionExit(c, version) : builtinExit(c, c.namedChildren[0].text, c.namedChildren.slice(1), st.at(c).run, version, 'bash');
      return e && `${e.why} ${e.word}`;
    };
    assert.strictEqual(exitOf('set -o "$o"'), undefined);
    assert.strictEqual(exitOf('export "$v"'), undefined);
    assert.strictEqual(exitOf('export a[1]=x'), undefined);
    assert.strictEqual(exitOf('shift "$n"'), undefined);
    assert.strictEqual(exitOf('shift " +1 "'), undefined);
    assert.strictEqual(exitOf('echo -Z'), undefined);
    assert.strictEqual(exitOf('source -p d f', '5.2'), 'invalid-option -p');
    assert.strictEqual(exitOf('source -p d f'), undefined);
    assert.strictEqual(exitOf('unset -n 1x'), undefined);
    assert.strictEqual(exitOf('unset -v x 1x'), 'identifier 1x');
    assert.strictEqual(exitOf('readonly r; unset -v r'), 'readonly r');
    assert.strictEqual(exitOf('exit x'), 'numeric x');
    assert.strictEqual(exitOf('exit x', '5.2'), undefined);
    assert.strictEqual(exitOf('exit 1 2'), undefined);
    // (`exit` with a word not known among several: either.)
    const words = (src: string) => parser.parse(src).root.namedChildren[0].namedChildren.slice(1);
    assert.strictEqual(exitRefusal(words('exit "$s" 2'), '5.3'), 'unknown');
    assert.strictEqual(exitRefusal(words('exit "$s"'), '5.3'), undefined);
    assert.strictEqual(exitRefusal(words('exit --'), '5.3'), undefined);
    assert.ok(!descendants(parser.parse('exit "$s" 2\necho after').root, ['command']).some((c, _, all) => shellState(parser.parse('exit "$s" 2\necho after'), 'bash').dead(all[1])));
    // (A builtin turned off is none; a command name not known here neither.)
    const off = parser.parse('enable -n set\nset -Z\n"$c" -Z');
    const offModel = statusModel(shellState(off, 'bash', { posix: true }));
    assert.deepStrictEqual(off.root.namedChildren.map((c) => offModel.posixExit(c)), [undefined, undefined, undefined]);
    // (An assignment to a readonly variable ends the subshell it is in, or the shell a function runs in.)
    const explained = (src: string, line: number) => new Analyzer('en').explainLine(parser.parse(src), line, 'bash').notes.join('\n');
    assert.match(explained(`${POSIX}readonly r=1\n( r=2 )`, 2), /the subshell ends there, status 1/);
    assert.doesNotMatch(explained(`${POSIX}readonly r=1\nf() { r=2; }\nf; ( f )`, 2), /stops the script|subshell ends/);
    assert.match(fact('en', 'posix-special-builtin-error', { name: 'set', why: 'invalid-option', word: '-Z', status: 2, stops: 'unknown' }).text, /so bash stops the shell that runs it here \(status 2\)$/);
    // (A body no call reached: decided from where it is.)
    const uncalled = parser.parse(`${POSIX}f() { set -Z; }`);
    assert.strictEqual(statusModel(shellState(uncalled, 'bash')).posixExit(descendants(uncalled.root, ['command'])[0])?.active, 'on');
    const activeIn = (src: string, posix = true) => {
      const tree = parser.parse(src);
      const m = statusModel(shellState(tree, 'bash', { posix }));
      return descendants(tree.root, ['command']).map((c) => m.posixExit(c)?.active).filter((a) => a);
    };
    assert.deepStrictEqual(activeIn('f() { set -Z || :; }'), ['off']);
    // (Code that never runs: the walk decides nothing there.)
    assert.deepStrictEqual(activeIn('exit\ntrap INT || :\ntrap INT'), ['off', 'on']);
    assert.deepStrictEqual(activeIn('if [ "$1" ]; then set -o posix; fi\nf() { set -Z; }', false), ['unknown']);
    // (A body run where bash ignores the error and where it does not: on some walks; twice alike: as once.)
    assert.deepStrictEqual(activeIn('f() { set -Z; }\nf || :\nf'), ['unknown']);
    assert.deepStrictEqual(activeIn('f() { set -Z; }\nf || :\nf || :'), ['off']);
    assert.strictEqual(exitRefusal(words('exit 1 "$x"'), '5.2') !== 'unknown' && (exitRefusal(words('exit 1 "$x"'), '5.2') as { word: string }).word, '"$x"');
    // (`local -` makes the options local, and `export x\=1` exports `x`: no names bash refuses.)
    const token = (src: string, label: string) => JSON.stringify(new Analyzer('en').explainLine(parser.parse(src), 0, 'bash').items).includes(`"label":"${label}","explanation":"Bash refuses`);
    assert.deepStrictEqual([token('f() { local -; }', '-'), token('export x\\=1', 'x\\\\=1'), token('export "$v" 1x', '1x')], [false, false, true]);
    // (`exit 256` keeps its note with a redirection.)
    assert.match(explained('exit 256 2>/dev/null', 0), /`exit 256` gives 0/);
    // (The status model's view: none in another shell, or out of POSIX mode.)
    const tree = parser.parse('set -Z');
    assert.strictEqual(statusModel(shellState(tree, 'dash', { posix: true }), 'dash').posixExit(tree.root.namedChildren[0]), undefined);
    assert.strictEqual(statusModel(shellState(tree, 'bash')).posixExit(tree.root.namedChildren[0]), undefined);
  });

  // (The model in each release, with no bash: what the walk decides.)
  it('follows `$?` after a command substitution as each release does in POSIX mode (the model)', () => {
    const script = `${POSIX}false\nif [ "$(true)$?" = 1 ]; then echo yes; else echo no; fi`;
    const tree = parser.parse(script);
    for (const version of ['5.2', '5.3'] as const) {
      const st = shellState(tree, 'bash', { version });
      const [yes, no] = descendants(tree.root, ['command']).filter((c) => c.text.startsWith('echo'));
      assert.deepStrictEqual([st.dead(yes), st.dead(no)], version === '5.3' ? [false, true] : [false, false]);
    }
    // (Not with a `${ …; }`, which sets `$?` in bash 5.3, nor out of POSIX mode.)
    const funsub = parser.parse(`${POSIX}false\nif [ "\${ true; }$?" = 1 ]; then echo yes; fi`);
    assert.ok(!shellState(funsub, 'bash', { version: '5.3' }).dead(descendants(funsub.root, ['command']).pop()!));
    const plain = parser.parse('false\nif [ "$(true)$?" = 1 ]; then echo yes; else echo no; fi');
    assert.ok(!descendants(plain.root, ['command']).some((c) => shellState(plain, 'bash', { version: '5.3' }).dead(c)));
  });

  for (const [version, program] of RELEASES) {
    it(`follows \`$?\` after a command substitution as bash ${version} does in POSIX mode`, function () {
      if (!program) this.skip();
      // (bash 5.3 keeps `$?` of `false`; bash 5.2 sets it to the substitution's, 0.)
      assert.strictEqual(bash(program!, `${POSIX}false\nif [ "$(true)$?" = 1 ]; then echo yes; else echo no; fi`), version === '5.3' ? 'yes\n' : 'no\n');
    });
  }
});
