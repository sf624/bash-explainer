// What we say of bash 5.3's constructs, checked with a real bash 5.3 and with bash 5.2 (docs/design/bash-versions.md, 6).
//
// bash 5.3 comes from $BASH_EXPLAINER_BASH53 (a path; CI builds it from the release tarball). Without it, its half is
// skipped; BASH_EXPLAINER_BASH53_REQUIRED=1 makes a missing one fail. bash is GPL: it is only run, as a separate program.
// The bash 5.2 half runs the `bash` on PATH when it is a 5.2. What we say is checked in both cases, so that coverage
// does not depend on either.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer } from '../src/analyzer';
import type { BashVersion } from '../src/bashversion';
import { documentIssues } from '../src/document';
import { dialectNotes, type Shell } from '../src/dialect';
import { processOf } from '../src/semantics/env';
import { shellState } from '../src/semantics/state';
import { expansionValue } from '../src/semantics/values';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { bashPrintf, ShellWordsUnsupported } from '../src/examples/shellwords';
import { runBash } from './support/bash';
import { allTokens, explain } from './support/explain';

const parser = createUnbashParser();

/** The release of a bash program ('5.3'), or undefined when it cannot be run. */
function releaseOf(program: string): string | undefined {
  const r = spawnSync(program, ['--norc', '--noprofile', '-c', 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], { encoding: 'utf8', timeout: 10000 });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

const BASH53 = process.env.BASH_EXPLAINER_BASH53;

/** Skips the test without a bash 5.3 (fails instead when BASH_EXPLAINER_BASH53_REQUIRED is set). */
function needBash53(t: Mocha.Context): void {
  const release = BASH53 ? releaseOf(BASH53) : undefined;
  if (release !== '5.3' && process.env.BASH_EXPLAINER_BASH53_REQUIRED) assert.fail(`BASH_EXPLAINER_BASH53_REQUIRED is set, but $BASH_EXPLAINER_BASH53 is not a bash 5.3 (${BASH53 ?? 'unset'}: ${release})`);
  if (release !== '5.3') t.skip();
}

/** Everything the explanation of line 0 says, as `shell` (undefined: bash) and bash `version` read it. */
function said(script: string, version: BashVersion = '5.3', shell?: Shell): { tokens: string; notes: string } {
  const e = new Analyzer('en').explainLine(parser.parse(script), 0, shell, { bashVersion: version });
  return { tokens: allTokens(e.items).map((t) => t.explanation).join('\n'), notes: e.notes.join('\n') };
}

/**
 * Each case: a script, what bash 5.3 prints, what the explanation of its first line says (`says`), and what its notes
 * say (`notes`) or do not say (`quiet`).
 */
interface Case { script: string; out: string; says: RegExp[]; notes?: RegExp; quiet?: RegExp; form: 'funsub' | 'valsub' }

const CASES: Case[] = [
  // Variables set inside stay set.
  { script: 'v=0; x=${ v=1; echo out; }; echo "$x $v"', out: 'out 1\n', says: [/in the current shell, not in a subshell/, /Variables they set and `cd` stay in effect/], form: 'funsub' },
  { script: 'cd /; x=${ cd /tmp; }; pwd', out: '/tmp\n', says: [/stay in effect afterwards/], form: 'funsub' },
  // No subshell: the same process.
  { script: 'x=${ echo "$BASHPID"; }; [ "$x" = "$BASHPID" ] && echo same', out: 'same\n', says: [/not in a subshell/], form: 'funsub' },
  { script: 'x=${ printf \'a\\n\\n\'; }; printf \'[%s]\\n\' "$x"', out: '[a]\n', says: [/trailing newlines removed/], form: 'funsub' },
  // `local` works in them, as in a function: no pitfall.
  { script: 'x=${ local L=1; echo "$L"; }; echo "$x [${L-unset}]"', out: '1 [unset]\n', says: [/a `local` variable lasts only inside/], quiet: /can be used only inside a function/, form: 'funsub' },
  { script: 'x=${| local REPLY=1; }; echo "[$x]"', out: '[1]\n', says: [/the value they leave in `REPLY`/], quiet: /can be used only inside a function/, form: 'valsub' },
  // `return` ends the substitution, also in a function: the function goes on.
  { script: 'x=${ return 2; echo no; }; echo "$? [$x]"', out: '2 []\n', says: [/End the commands of the `\$\{ …; \}` around it/], form: 'funsub' },
  { script: 'f() { x=${ return 3; }; echo "in f $?"; }; f; echo "after $?"', out: 'in f 3\nafter 0\n', says: [/End the commands of the `\$\{ …; \}` around it/], form: 'funsub' },
  { script: 'false; x=${ false; return; }; echo "$?"', out: '1\n', says: [/or that of the last command/], form: 'funsub' },
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

/**
 * `${ … }` whose `}` does not end it (`braceTakenAsWord`), and what bash 5.3 says: after a simple command, the `}` is
 * one more of its words, and bash looks for another `}`; after a compound command's redirections or a bare `time`, it
 * is out of place.
 */
const UNCLOSED: { script: string; how: 'argument' | 'misplaced' }[] = [
  { script: 'x=${ echo a }; echo "[$x]"', how: 'argument' },
  { script: 'y=${ x}; echo "[$y]"', how: 'argument' },
  { script: 'z=${|REPLY=a }; echo "[$z]"', how: 'argument' },
  { script: 'x=${ echo a | cat }; echo "[$x]"', how: 'argument' },
  { script: 'x=${ true && echo a }; echo "[$x]"', how: 'argument' },
  { script: 'x=${ echo a >/dev/null }; echo "[$x]"', how: 'argument' },
  { script: 'x=${ ! echo a }; echo "[$x]"', how: 'argument' },
  { script: 'x=${ { echo a; } >/dev/null }; echo "[$x]"', how: 'misplaced' },
  { script: 'x=${ time }; echo "[$x]"', how: 'misplaced' },
];

/** `${ … }` that bash 5.3 runs: the `}` follows a terminator, a newline, or a compound command. */
const CLOSED: { script: string; out: string }[] = [
  { script: 'x=${ { echo a; } }; echo "[$x]"', out: '[a]\n' },
  { script: 'x=${ (echo a) }; echo "[$x]"', out: '[a]\n' },
  { script: 'x=${ if true; then echo a; fi }; echo "[$x]"', out: '[a]\n' },
  { script: 'x=${ case a in a) echo a;; esac }; echo "[$x]"', out: '[a]\n' },
  { script: 'x=${ for i in a; do echo $i; done }; echo "[$x]"', out: '[a]\n' },
  { script: 'x=${ ! { echo a; } }; echo "[$x]"', out: '[a]\n' },
  { script: 'x=${ [[ a ]] }; echo "[$x] $?"', out: '[] 0\n' },
  { script: 'x=${ echo a & }; wait; echo "[$x]"', out: '[]\n' },
  { script: 'x=${ echo a;}b; echo "[$x]"', out: '[ab]\n' },
  { script: 'x=${ echo a #c\n}; echo "[$x]"', out: '[a]\n' },
  { script: 'x=${ echo a\n}; echo "[$x]"', out: '[a]\n' },
];

describe('bash 5.3 command substitutions', () => {
  it('runs each one in bash 5.3 as we say', function () {
    needBash53(this);
    for (const c of CASES) assert.strictEqual(runBash(c.script, { program: BASH53 }).stdout, c.out, c.script);
  });

  it('explains each one as bash 5.3 runs it (also without a bash 5.3)', () => {
    for (const c of CASES) {
      const { tokens, notes } = said(c.script);
      for (const re of c.says) assert.match(tokens, re, c.script);
      if (c.notes) assert.match(notes, c.notes, c.script);
      if (c.quiet) assert.doesNotMatch(notes, c.quiet, c.script);
    }
    // (Outside a function and `${ }`, `local` is a pitfall, also in `$( )`; there `return` is a function's.)
    assert.match(said('x=$( local L=1 )').notes, /can be used only inside a function/);
    assert.match(said('f() { x=$( return 1 ); }').tokens, /Return from a function/);
  });

  it('says in a ksh93 or mksh script only what that shell is not known to do differently', () => {
    const ksh = said('x=${ local L=1; echo a; return; }', '5.3', 'ksh').tokens;
    assert.match(ksh, /Command substitution `\$\{ …; \}`: runs the commands in the current shell/);
    assert.doesNotMatch(ksh, /bash 5\.3|`local` variable|End the commands/);
    const mksh = said('x=${| REPLY=1; }', '5.3', 'mksh').tokens;
    assert.match(mksh, /Command substitution `\$\{\| …; \}`: runs the commands in the current shell and is replaced by the value they leave in `REPLY`\. Their stdout/);
    assert.doesNotMatch(mksh, /bash 5\.3|local to it|trailing newlines kept/);
    // (ksh93 has no `${| }`: the explanation is bash 5.3's, and the dialect check says ksh93 lacks it.)
    assert.match(said('x=${| REPLY=1; }', '5.3', 'ksh').tokens, /\(bash 5\.3\)/);
    assert.match(said('x=${ echo a }', '5.3', 'mksh').tokens, /^Syntax error: this `\}` is one more argument of the command before it.*\(`\}` is a reserved word only where a command can start\)/m);
    assert.match(said('x=${ { a; } >f }', '5.3', 'mksh').tokens, /^Syntax error: this `\}` cannot end `\$\{ …; \}` where it is/m);
  });

  it('says that the commands in them run in the shell itself', () => {
    for (const script of ['x=${ cd /tmp; echo a; }', 'x=${| cd /tmp; }']) {
      const tree = parser.parse(script);
      const model = shellState(tree);
      const cd = descendants(tree.root, ['command']).find((c) => c.text.startsWith('cd'))!;
      assert.strictEqual(processOf(model.env(cd)).kind, 'main', script);
      // (Not "runs in the subshell of `$( )`".)
      assert.doesNotMatch(said(script).tokens, /subshell of/, script);
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

  it('rejects a `}` that does not end the substitution, as bash 5.3 does (the warning also without a bash 5.3)', function () {
    const issues = (script: string, version: BashVersion) => documentIssues({ lines: script.split('\n'), tree: parser.parse(script) }, 'en', {}, [], { pitfalls: false, bashVersion: version });
    for (const { script, how } of UNCLOSED) {
      const found = issues(script, '5.3');
      assert.deepStrictEqual(found.map((i) => i.code), ['funsubBrace'], script);
      // (On the `}`.)
      assert.strictEqual(script.slice(found[0].startCol, found[0].endCol), '}', script);
      assert.match(found[0].message, how === 'argument' ? /is one more argument of the command before it.*reads on for a `\}` that does, or reports "unexpected EOF/ : /cannot end `\$\{ …; \}` where it is.*near unexpected token/, script);
      const e = new Analyzer('en').explainLine(parser.parse(script), 0, undefined, { bashVersion: '5.3' });
      assert.ok(allTokens(e.items).some((t) => t.kind === 'error' && t.explanation.startsWith('Syntax error (bash 5.3): ')), script);
      // bash 5.2 fails on it all the same, as the warning of 5.2 says.
      assert.deepStrictEqual(issues(script, '5.2').map((i) => i.code), [script.includes('${|') ? 'valsub' : 'funsub'], script);
    }
    for (const { script } of CLOSED) {
      assert.deepStrictEqual(issues(script, '5.3'), [], script);
      assert.ok(!said(script).tokens.includes('Syntax error'), script);
    }
    assert.match(dialectNotes(parser.parse('x=${ echo a }'), 0, 'bash', 'ja', '5.3')[0], /^⚠ 構文エラー（bash 5\.3）: この `\}` は直前のコマンドの引数になり/);
    needBash53(this);
    for (const { script, how } of UNCLOSED) {
      const r = runBash(script, { program: BASH53 });
      // (Status 2 in a script file; `bash -c` gives 127 for the second kind.)
      assert.notStrictEqual(r.status, 0, script);
      assert.match(r.stderr, how === 'argument' ? /unexpected EOF while looking for matching `\}'/ : /syntax error near unexpected token `\}'/, script);
    }
    for (const { script, out } of CLOSED) assert.deepStrictEqual([runBash(script, { program: BASH53 }).stdout, script], [out, script]);
    // With a later `}`, bash 5.3 reads on to it: the first `}` is an argument of `echo`.
    assert.strictEqual(runBash('x=${ echo a }\n}; echo "[$x]"', { program: BASH53 }).stdout, '[a }]\n');
  });

  it('warns in bash 5.2 mode, as bash 5.2 fails', function () {
    for (const c of CASES) {
      const issues = documentIssues({ lines: c.script.split('\n'), tree: parser.parse(c.script) }, 'en', {}, [], { pitfalls: false });
      assert.deepStrictEqual(issues.map((i) => i.code), [c.form], c.script);
      assert.match(issues[0].message, /bash 5\.3 syntax: bash 5\.2 reports "bad substitution" and stops there: the rest of the line, and the rest of the `if`, loop or function around it, do not run \(status 1\)\. Under `set -e`, and in POSIX mode, the shell exits; in a subshell, only the subshell stops\./);
      assert.deepStrictEqual(documentIssues({ lines: [c.script], tree: parser.parse(c.script) }, 'en', {}, [], { pitfalls: false, bashVersion: '5.3' }), [], c.script);
    }
    if (releaseOf('bash') !== '5.2') this.skip();
    for (const c of CASES) assert.match(runBash(c.script).stderr, /bad substitution/, c.script);
    const run = (script: string, posix = false) => { const r = runBash(script, { posix }); return [r.stdout, r.status]; };
    // The rest of the line, and the rest of the `if`, loop or function around it, do not run; the next line sees status 1.
    assert.deepStrictEqual(run('echo a; x=${ echo hi; }; echo same-line\necho "next $?"\nif true; then\n  echo in-if\n  y=${ echo hi; }\n  echo after\nfi\necho "after-if $?"\n'), ['a\nnext 1\nin-if\nafter-if 1\n', 0]);
    assert.deepStrictEqual(run('for i in 1 2\ndo\n  echo "i$i"\n  x=${ echo hi; }\n  echo after\ndone\necho out'), ['i1\nout\n', 0]);
    assert.deepStrictEqual(run('f() {\n  echo f1\n  x=${ echo hi; }\n  echo f2\n}\nf\necho "after-f $?"'), ['f1\nafter-f 1\n', 0]);
    // Under `set -e`, and in POSIX mode, the shell exits; in a subshell, only the subshell stops.
    assert.deepStrictEqual(run('set -e\nx=${ echo hi; }\necho next'), ['', 1]);
    assert.strictEqual(run('x=${ echo hi; }\necho next', true)[0], '');
    assert.deepStrictEqual(run('( x=${ echo hi; }; echo in-sub ); echo "out $?"'), ['out 1\n', 0]);
  });

  it('gives no value to the variables bash 5.3 changes as the script runs (docs/design/bash-versions.md, 3.3)', function () {
    const script = 'BASH_TRAPSIG=y; trap \'echo "[$BASH_TRAPSIG]"\' USR1; kill -USR1 $$; a=$BASH_MONOSECONDS; [[ $a =~ ^[0-9]+$ ]] && echo n';
    const tree = parser.parse(script);
    const model = shellState(tree);
    for (const e of descendants(tree.root, ['simple_expansion']).filter((x) => x.text.startsWith('$BASH_'))) assert.strictEqual(expansionValue(e, model), undefined, e.text);
    if (releaseOf('bash') === '5.2') assert.strictEqual(runBash(script).stdout, '[y]\n');
    needBash53(this);
    assert.strictEqual(runBash(script, { program: BASH53 }).stdout, '[10]\nn\n');
  });

  it('says the same as a note of the line, in both languages, and nothing in bash 5.3 mode', () => {
    const tree = parser.parse('x=${| REPLY=1; }');
    assert.match(dialectNotes(tree, 0, 'bash', 'ja')[0], /bash 5\.3 からの書き方です。bash 5\.2 では「bad substitution」のエラーになり、そこで止まります/);
    assert.deepStrictEqual(dialectNotes(tree, 0, 'bash', 'en', '5.3'), []);
    assert.match(explain('x=${ echo a; }').notes.join('\n'), /bash 5\.3 syntax/);
    assert.ok(!explain('x=${ echo a; }', 0, 'en', { bashVersion: '5.3' }).notes.some((n) => n.includes('5.3 syntax')));
    // Another shell: the dialect check of that shell.
    assert.match(dialectNotes(tree, 0, 'sh', 'en')[0], /is not POSIX sh \(it fails in dash and busybox ash\)/);
    assert.deepStrictEqual(dialectNotes(parser.parse('x=${ echo a; }'), 0, 'ksh', 'en'), []);
  });
});

/**
 * printf of bash 5.3 and bash 5.2 (docs/design/bash-versions.md, 3.2), in a UTF-8 locale: what each prints (`null`:
 * printf fails with "invalid format character", status 1), what the explanation says in each mode, and in which the
 * example shows nothing (`unshown`: the output depends on the locale or the release, or bash fails).
 */
const PRINTF: { args: string[]; out: Record<BashVersion, string | null>; says: Record<BashVersion, RegExp>; unshown?: BashVersion[] }[] = [
  // `%#q` (and `%#Q`): bash 5.3 quotes in single quotes; bash 5.2 ignores the `#`.
  { args: ['%#q|%q\\n', 'a b', 'a b'], out: { '5.2': 'a\\ b|a\\ b\n', '5.3': "'a b'|a\\ b\n" }, says: { '5.2': /the `#` changes nothing in bash 5\.2; bash 5\.3 quotes in single quotes/, '5.3': /in single quotes: `'a b'`/ } },
  { args: ['%#Q|%#q|%#q|%#q\\n', "it's", "'", '', 'x=~a'], out: { '5.2': "it\\'s|\\'|''|x=\\~a\n", '5.3': "'it'\\''s'|\\'|''|'x=~a'\n" }, says: { '5.2': /changes nothing in bash 5\.2/, '5.3': /in single quotes/ } },
  // The precision: of the quoted text with `%q`, of the value with `%Q`.
  { args: ['%#.3q|%#.2Q|%.2Q|\\n', 'abcdef', 'abc', 'a b c'], out: { '5.2': 'abc|ab|a\\ |\n', '5.3': "'ab|'ab'|a\\ |\n" }, says: { '5.2': /at most 3 bytes\)[^]*at most 2 bytes of the value, before it is quoted/, '5.3': /in single quotes: .*, at most 3 bytes\)/ } },
  // `%ls`: characters in bash 5.3, bytes in bash 5.2 (the `l` is ignored).
  { args: ['%ls|%5ls|%.3ls|%5s|\\n', 'héllo', 'é', 'héllo', 'é'], out: { '5.2': 'héllo|   é|hé|   é|\n', '5.3': 'héllo|    é|hél|   é|\n' }, says: { '5.2': /the `l` changes nothing in bash 5\.2; bash 5\.3 counts characters, not bytes/, '5.3': /the width and precision count characters, not bytes/ }, unshown: ['5.2', '5.3'] },
  { args: ['%lc|%ls|%5ls|\\n', 'ab', 'cd', 'ef'], out: { '5.2': 'a|cd|   ef|\n', '5.3': 'a|cd|   ef|\n' }, says: { '5.2': /changes nothing in bash 5\.2/, '5.3': /the first character, not its first byte/ } },
  // `%S` and `%C` are `%ls` and `%lc` in bash 5.3; bash 5.2 has neither.
  { args: ['%S|%C|%-3C|\\n', 'héllo', 'é', 'x'], out: { '5.2': null, '5.3': 'héllo|é|x  |\n' }, says: { '5.2': /bash 5\.2 has no conversion `S` \(printf reports "invalid format character" and stops, status 1\); bash 5\.3 reads it as `%ls`/, '5.3': /the same as `%ls`: in a multibyte locale/ }, unshown: ['5.3'] },
  { args: ['%S|%C|\\n', 'ab', 'c'], out: { '5.2': null, '5.3': 'ab|c|\n' }, says: { '5.2': /bash 5\.2 has no conversion `C`/, '5.3': /the same as `%lc`/ } },
  // `%Q` with a precision from an argument: bash 5.2 reads it and ignores it.
  { args: ['%.*Q|%*.*Q|\\n', '1', 'a b', '6', '1', 'a b'], out: { '5.2': 'a\\ b|  a\\ b|\n', '5.3': 'a|     a|\n' }, says: { '5.2': /a precision from an argument changes nothing in bash 5\.2 \(the argument is still read\)/, '5.3': /at most as many bytes of the value as an argument says, before it is quoted/ } },
  // `%lc` with a precision: bash 5.3 takes it (0 prints nothing), bash 5.2 ignores it.
  { args: ['%.0lc|%.1lc|%3.0lc|%.0lc|\\n', 'a', 'b', 'd', ''], out: { '5.2': 'a|b|  d|\0|\n', '5.3': '|b|   ||\n' }, says: { '5.2': /the precision changes nothing here/, '5.3': /at most 0 characters, in a multibyte locale/ } },
  // The length modifiers of C change nothing else.
  { args: ['%ld|%hhd|%lu|%zx|%jo|%Lf|%lld\\n', '5', '300', '7', '255', '8', '1.5', '9'], out: { '5.2': '5|300|7|ff|10|1.500000|9\n', '5.3': '5|300|7|ff|10|1.500000|9\n' }, says: { '5.2': /value 1 as an integer \(decimal\) \(the `l` changes nothing\)/, '5.3': /value 2 as an integer \(decimal\) \(the `hh` changes nothing\)/ } },
];

const quoted = (args: string[]) => args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
const UTF8 = { env: { LC_ALL: 'C.UTF-8' } };

/** What the example of `printf ARGS…` shows as `version` runs it, or undefined when it shows nothing. */
function shown(args: string[], version: BashVersion): string | undefined {
  try {
    return bashPrintf(args[0], args.slice(1), version);
  } catch (e) {
    if (e instanceof ShellWordsUnsupported) return undefined;
    /* c8 ignore next */
    throw e;
  }
}

describe('bash 5.3 printf', () => {
  it('explains each format as each release reads it, and shows what it prints (also without a bash 5.3)', () => {
    for (const c of PRINTF) {
      for (const version of ['5.2', '5.3'] as const) {
        const script = `printf ${quoted(c.args)}`;
        assert.match(said(script, version).tokens, c.says[version], `${version}: ${script}`);
        const expected = c.unshown?.includes(version) ? undefined : c.out[version] ?? undefined;
        assert.strictEqual(shown(c.args, version), expected, `${version}: ${script}`);
      }
    }
  });

  it('prints in bash 5.3 what we say', function () {
    needBash53(this);
    for (const c of PRINTF) assert.strictEqual(runBash(`printf ${quoted(c.args)}`, { program: BASH53, ...UTF8 }).stdout, c.out['5.3'], c.args.join(' '));
  });

  it('prints in bash 5.2 what we say', function () {
    if (releaseOf('bash') !== '5.2') this.skip();
    for (const c of PRINTF) {
      const r = runBash(`printf ${quoted(c.args)}`, UTF8);
      if (c.out['5.2'] === null) assert.deepStrictEqual([r.status, /invalid format character/.test(r.stderr)], [1, true], c.args.join(' '));
      else assert.strictEqual(r.stdout, c.out['5.2'], c.args.join(' '));
    }
  });
});
