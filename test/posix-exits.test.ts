// What ends a non-interactive shell in POSIX mode (manual 4.4, 6.11; src/semantics/posixexits.ts), checked with bash
// 5.2 (on PATH) and 5.3 (`$BASH_EXPLAINER_BASH53`, skipped without it): a function name bash refuses, the errors of a
// special builtin, an assignment to a readonly variable; and `$?` after a command substitution, which bash 5.3's POSIX
// mode does not change. Each script is read by bash from stdin, line by line as a script file is, so an error that
// ends only the line is told from one that ends the shell. The explanation's note on the line, and the code it fades
// after it, must agree with what bash prints.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { BashVersion } from '../src/bashversion';
import { fact } from '../src/messages';
import { builtinExit, definitionExit } from '../src/semantics/posixexits';
import { shellState } from '../src/semantics/state';
import { statusModel } from '../src/semantics/status';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { run } from './support/run';

const parser = createUnbashParser();
const RELEASES: [BashVersion, string | undefined][] = [['5.2', 'bash'], ['5.3', process.env.BASH_EXPLAINER_BASH53]];

/** What bash prints for the script (`#!/bin/bash --posix` is a comment to it), run in POSIX mode from stdin. */
function bash(program: string, script: string): string {
  const r = run(program, ['--norc', '--noprofile', '--posix', '-s'], { input: script, env: { PATH: '/usr/bin:/bin', HOME: '/home/w', LC_ALL: 'C', FUNCNEST: '50' }, timeout: 10000 });
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

// Each case: the line after the shebang, which may end the shell, and whether bash 5.2 and 5.3 end it there.
const CASES: { line: string; exits: [boolean, boolean]; note?: RegExp }[] = [
  { line: 'a-b() { :; }', exits: [true, false], note: /bash 5\.2 refuses a function name that is not a valid name/ },
  { line: 'a.b() { :; }', exits: [true, false], note: /bash 5\.2 refuses a function name/ },
  { line: 'export() { :; }', exits: [true, true], note: /cannot have the name of a special builtin/ },
  { line: 'set -Z', exits: [true, true], note: /here `set` has no option `-Z`, so bash stops the script here \(status 2\)/ },
  { line: 'set -euo bogus', exits: [true, true], note: /`bogus` is no option name of `set -o`/ },
  { line: 'exec -a', exits: [true, true], note: /`-a` has no value/ },
  { line: '.', exits: [true, true], note: /`\.` is given no file to read/ },
  { line: 'trap INT', exits: [true, true], note: /a lone word that is no signal number/ },
  { line: 'times -x', exits: [true, true], note: /`times` has no option `-x`/ },
  { line: 'export 1x=2', exits: [false, true], note: /`1x=2` is not a valid name, so bash stops the script here \(status 1; bash 5\.3 on: bash 5\.2 goes on, with status 1\)/ },
  { line: 'export -p a-b', exits: [false, true], note: /`a-b` is not a valid name/ },
  { line: 'unset -v 1x', exits: [false, true], note: /`1x` is not a valid name/ },
  { line: 'readonly r=1; unset r', exits: [false, true], note: /`r` is a read-only variable/ },
  { line: 'shift x', exits: [false, true], note: /`x` is no number/ },
  { line: 'readonly r=1; r=2 :', exits: [true, true], note: /in POSIX mode, bash stops the script here, status 1/ },
  // Not where `set -e` would not stop it, nor behind `command`, nor with what bash accepts.
  { line: 'set -Z || :', exits: [false, false] },
  { line: 'if export 1x; then :; fi', exits: [false, false] },
  { line: 'command set -Z', exits: [false, false] },
  { line: 'trap 2', exits: [false, false] },
  { line: 'trap "" INT', exits: [false, false] },
  { line: 'unset a-b', exits: [false, false] },
  { line: 'export -f a-b', exits: [false, false] },
  { line: 'shift 1', exits: [false, false] },
  { line: 'f() { :; }', exits: [false, false] },
  // In a subshell, only the subshell ends.
  { line: '( set -Z )', exits: [false, false], note: /so bash ends this subshell/ },
];

describe('what ends the shell in POSIX mode (6.11, 4.4)', function () {
  this.timeout(60000);

  for (const [version, program] of RELEASES) {
    it(`agrees with bash ${version}: the note on the line, and the code after it`, function () {
      if (!program) this.skip();
      for (const { line, exits, note } of CASES) {
        const script = `${POSIX}${line}\necho after`;
        const ended: boolean = !bash(program!, script).includes('after');
        const want = exits[version === '5.2' ? 0 : 1];
        assert.strictEqual(ended, want, `bash ${version}: ${line}`);
        const said = notes(script, version).filter((n) => /POSIX mode/.test(n));
        if (want || (note && /subshell/.test(note.source))) assert.ok(note && said.some((n) => note.test(n)), `${version} ${line}: ${said.join(' | ')}`);
        else assert.deepStrictEqual(said, [], `${version} ${line}`);
        // (A script the model trusts has the line after faded; `set -Z` and the like make it trust nothing.)
        if (faded(script, version).includes(2)) assert.ok(ended, `${version} ${line}: faded, but bash goes on`);
      }
    });
  }

  it('fades the code after an exit the model trusts', () => {
    assert.deepStrictEqual(faded(`${POSIX}a-b() { :; }\necho after`, '5.2'), [2]);
    assert.deepStrictEqual(faded(`${POSIX}a-b() { :; }\necho after`, '5.3'), []);
    assert.deepStrictEqual(faded(`${POSIX}export 1x\necho after`, '5.3'), [2]);
    assert.deepStrictEqual(faded(`${POSIX}export 1x\necho after`, '5.2'), []);
  });

  it('says it may end the shell where POSIX mode is on some paths only', () => {
    const src = 'if [ "$x" ]; then set -o posix; fi\nset -Z\na-b() { :; }';
    const e = new Analyzer('en');
    assert.match(e.explainLine(parser.parse(src), 1, 'bash').notes.join('\n'), /ⓘ Caveat: in POSIX mode an error of a special builtin .* \(status 2; on some paths only/);
    assert.match(e.explainLine(parser.parse(src), 2, 'bash').notes.join('\n'), /ⓘ Caveat: in POSIX mode bash 5\.2 refuses a function name .*only some paths before here turn POSIX mode on/);
    // (Another shell: a special builtin's name only, as before.)
    assert.match(e.explainLine(parser.parse('set -o posix\nexport() { :; }'), 1, 'sh').notes.join('\n'), /cannot have the name of a special builtin/);
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
    // (A builtin turned off is none; a command name not known here neither.)
    const off = parser.parse('enable -n set\nset -Z\n"$c" -Z');
    const offModel = statusModel(shellState(off, 'bash', { posix: true }));
    assert.deepStrictEqual(off.root.namedChildren.map((c) => offModel.posixExit(c)), [undefined, undefined, undefined]);
    // (An assignment to a readonly variable ends the subshell it is in, or the shell a function runs in.)
    const explained = (src: string, line: number) => new Analyzer('en').explainLine(parser.parse(src), line, 'bash').notes.join('\n');
    assert.match(explained(`${POSIX}readonly r=1\n( r=2 )`, 2), /the subshell ends there, status 1/);
    assert.doesNotMatch(explained(`${POSIX}readonly r=1\nf() { r=2; }\nf; ( f )`, 2), /stops the script|subshell ends/);
    assert.match(fact('en', 'posix-special-builtin-error', { name: 'set', why: 'invalid-option', word: '-Z', status: 2, stops: 'unknown' }).text, /so bash stops here \(in a subshell, only the subshell\) \(status 2\)$/);
    // (The status model's view: none in another shell, or out of POSIX mode.)
    const tree = parser.parse('set -Z');
    assert.strictEqual(statusModel(shellState(tree, 'dash', { posix: true }), 'dash').posixExit(tree.root.namedChildren[0]), undefined);
    assert.strictEqual(statusModel(shellState(tree, 'bash')).posixExit(tree.root.namedChildren[0]), undefined);
  });

  for (const [version, program] of RELEASES) {
    it(`follows \`$?\` after a command substitution as bash ${version} does in POSIX mode`, function () {
      if (!program) this.skip();
      const script = `${POSIX}false\nif [ "$(true)$?" = 1 ]; then echo yes; else echo no; fi`;
      const out: string = bash(program!, script);
      // (bash 5.3 keeps `$?` of `false`; bash 5.2 sets it to the substitution's, 0.)
      assert.strictEqual(out, version === '5.3' ? 'yes\n' : 'no\n');
      const tree = parser.parse(script);
      const st = shellState(tree, 'bash', { version });
      const [yes, no] = descendants(tree.root, ['command']).filter((c) => c.text.startsWith('echo'));
      assert.deepStrictEqual([st.dead(yes), st.dead(no)], version === '5.3' ? [false, true] : [false, false]);
      // (Not with a `${ …; }`, which sets `$?` in bash 5.3, nor out of POSIX mode.)
      const funsub = parser.parse(`${POSIX}false\nif [ "\${ true; }$?" = 1 ]; then echo yes; fi`);
      assert.ok(!shellState(funsub, 'bash', { version: '5.3' }).dead(descendants(funsub.root, ['command']).pop()!));
      const plain = parser.parse('false\nif [ "$(true)$?" = 1 ]; then echo yes; else echo no; fi');
      assert.ok(!descendants(plain.root, ['command']).some((c) => shellState(plain, 'bash', { version: '5.3' }).dead(c)));
    });
  }
});
