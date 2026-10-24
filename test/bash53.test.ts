// What we say of bash 5.3's constructs, checked with a real bash 5.3 and with bash 5.2 (docs/design/bash-versions.md, 6).
//
// bash 5.3 comes from $BASH_EXPLAINER_BASH53 (a path; CI builds it from the release tarball). Without it, its half is
// skipped; BASH_EXPLAINER_BASH53_REQUIRED=1 makes a missing one fail. bash is GPL: it is only run, as a separate program.
// The bash 5.2 half runs the `bash` on PATH when it is a 5.2.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { documentIssues } from '../src/document';
import { dialectNotes } from '../src/dialect';
import { processOf } from '../src/semantics/env';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { runBash } from './support/bash';
import { allTokens, explain } from './support/explain';

const parser = createUnbashParser();

/** The release of a bash program ('5.3'), or undefined when it cannot be run. */
function releaseOf(program: string): string | undefined {
  const r = spawnSync(program, ['--norc', '--noprofile', '-c', 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], { encoding: 'utf8', timeout: 10000 });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

const BASH53 = process.env.BASH_EXPLAINER_BASH53;

/** Each case: a script, what bash 5.3 prints, and what the explanation of its first line says. */
interface Case { script: string; out: string; says: RegExp[]; notes?: RegExp; form: 'funsub' | 'valsub' }

const CASES: Case[] = [
  // Variables set inside stay set.
  { script: 'v=0; x=${ v=1; echo out; }; echo "$x $v"', out: 'out 1\n', says: [/in the current shell, not in a subshell/, /Variables they set and `cd` stay in effect/], form: 'funsub' },
  { script: 'cd /; x=${ cd /tmp; }; pwd', out: '/tmp\n', says: [/stay in effect afterwards/], form: 'funsub' },
  // No subshell: the same process.
  { script: 'x=${ echo "$BASHPID"; }; [ "$x" = "$BASHPID" ] && echo same', out: 'same\n', says: [/not in a subshell/], form: 'funsub' },
  { script: 'x=${ printf \'a\\n\\n\'; }; printf \'[%s]\\n\' "$x"', out: '[a]\n', says: [/trailing newlines removed/], form: 'funsub' },
  { script: 'x=${ local L=1; echo "$L"; }; echo "$x [${L-unset}]"', out: '1 [unset]\n', says: [/a `local` variable lasts only inside/], form: 'funsub' },
  // The value of REPLY, local to it; the output is not captured; trailing newlines kept.
  { script: 'REPLY=old; x=${| REPLY=new; }; echo "$x $REPLY"', out: 'new old\n', says: [/the value they leave in `REPLY`/, /`REPLY` is local to it/], form: 'valsub' },
  { script: 'x=${| echo out; REPLY=v; }; echo "[$x]"', out: 'out\n[v]\n', says: [/their stdout is not captured/], form: 'valsub' },
  { script: 'x=${| REPLY=$\'a\\n\'; }; printf \'[%s]\\n\' "$x"', out: '[a\n]\n', says: [/trailing newlines kept/], form: 'valsub' },
  // `set -e`: a command of assignments only takes the status of its substitution.
  { script: 'set -e; x=${ false; }; echo reached', out: '', says: [/Under `set -e` the script stops here if it fails/], form: 'funsub' },
  { script: 'set -e; x=${| false; }; echo reached', out: '', says: [/Under `set -e` the script stops here if it fails/], form: 'valsub' },
  // Inside, `set -e` is off, as in `$( )`.
  { script: 'set -e; x=${ false; echo after; }; echo "$x"', out: 'after\n', says: [], notes: /bash turns `set -e` off inside `\$\{ …; \}`/, form: 'funsub' },
  { script: 'set -e; x=${| false; REPLY=r; }; echo "$x"', out: 'r\n', says: [], notes: /bash turns `set -e` off inside `\$\{\| …; \}`/, form: 'valsub' },
];

describe('bash 5.3 command substitutions', () => {
  it('explains each one as bash 5.3 runs it', function () {
    const release = BASH53 ? releaseOf(BASH53) : undefined;
    if (release !== '5.3' && process.env.BASH_EXPLAINER_BASH53_REQUIRED) assert.fail(`BASH_EXPLAINER_BASH53_REQUIRED is set, but $BASH_EXPLAINER_BASH53 is not a bash 5.3 (${BASH53 ?? 'unset'}: ${release})`);
    if (release !== '5.3') this.skip();
    for (const c of CASES) {
      assert.strictEqual(runBash(c.script, { program: BASH53 }).stdout, c.out, c.script);
      const e = explain(c.script, 0, 'en', { bashVersion: '5.3' });
      const said = allTokens(e.items).map((t) => t.explanation).join('\n');
      for (const re of c.says) assert.match(said, re, c.script);
      if (c.notes) assert.match(e.notes.join('\n'), c.notes, c.script);
    }
  });

  it('says that the commands in them run in the shell itself', () => {
    for (const script of ['x=${ cd /tmp; echo a; }', 'x=${| cd /tmp; }']) {
      const tree = parser.parse(script);
      const model = shellState(tree);
      const cd = descendants(tree.root, ['command']).find((c) => c.text.startsWith('cd'))!;
      assert.strictEqual(processOf(model.env(cd)).kind, 'main', script);
      // (Not "runs in the subshell of `$( )`".)
      const said = allTokens(explain(script, 0, 'en', { bashVersion: '5.3' }).items).map((t) => t.explanation).join('\n');
      assert.doesNotMatch(said, /subshell of/, script);
    }
  });

  it('decides no condition in a script that has one (the walk does not keep what it changes)', () => {
    const decided = (sub: string) => {
      const tree = parser.parse(`x=0\n: ${sub}\nif [ "$x" = 1 ]; then echo one; fi\n`);
      const model = shellState(tree);
      return { decided: model.condition(descendants(tree.root, ['if_statement'])[0]) !== undefined, blind: model.blind };
    };
    // (In `$( )`, `x=1` is in a subshell: the condition is always false.)
    assert.deepStrictEqual(decided('$( x=1 )'), { decided: true, blind: undefined });
    assert.deepStrictEqual(decided('${ x=1; }'), { decided: false, blind: 'a `${ …; }` substitution changes the shell where the walk does not follow it' });
  });

  it('warns in bash 5.2 mode, as bash 5.2 fails', function () {
    if (releaseOf('bash') !== '5.2') this.skip();
    for (const c of CASES) {
      const r = runBash(c.script);
      assert.match(r.stderr, /bad substitution/, c.script);
      const issues = documentIssues({ lines: c.script.split('\n'), tree: parser.parse(c.script) }, 'en', {}, [], { pitfalls: false });
      assert.deepStrictEqual(issues.map((i) => i.code), [c.form], c.script);
      assert.match(issues[0].message, /bash 5\.3 syntax: bash 5\.2 reports "bad substitution" and drops the commands it read with it \(the rest of the line, and the whole `if` or loop around it\), with status 1/);
      assert.deepStrictEqual(documentIssues({ lines: [c.script], tree: parser.parse(c.script) }, 'en', {}, [], { pitfalls: false, bashVersion: '5.3' }), [], c.script);
    }
    // The rest of the line, and the whole `if` around it, do not run; the next line sees status 1.
    const r = runBash('echo a; x=${ echo hi; }; echo same-line\necho "next $?"\nif true; then\n  echo in-if\n  y=${ echo hi; }\n  echo after\nfi\necho "after-if $?"\n');
    assert.deepStrictEqual([r.stdout, r.status], ['a\nnext 1\nin-if\nafter-if 1\n', 0]);
  });

  it('says the same as a note of the line, in both languages, and nothing in bash 5.3 mode', () => {
    const tree = parser.parse('x=${| REPLY=1; }');
    assert.match(dialectNotes(tree, 0, 'bash', 'ja')[0], /bash 5\.3 からの書き方です。bash 5\.2 では「bad substitution」のエラーになり/);
    assert.deepStrictEqual(dialectNotes(tree, 0, 'bash', 'en', '5.3'), []);
    assert.match(explain('x=${ echo a; }').notes.join('\n'), /bash 5\.3 syntax/);
    assert.ok(!explain('x=${ echo a; }', 0, 'en', { bashVersion: '5.3' }).notes.some((n) => n.includes('5.3 syntax')));
    // Another shell: the dialect check of that shell.
    assert.match(dialectNotes(tree, 0, 'sh', 'en')[0], /is not POSIX sh \(it fails in dash and busybox ash\)/);
    assert.deepStrictEqual(dialectNotes(parser.parse('x=${ echo a; }'), 0, 'ksh', 'en'), []);
  });
});
