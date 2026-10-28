// The rewrites of the corpus (docs/design/oracles.md, 3.3 and steps 5 and 6): every fact of a mechanical id that
// sample.sh, the other fixtures and the snippets of the tests raise, and every style check whose findings carry
// rewrites (src/pitfalls.ts), its rewrites applied. For each rewrite, the two cheap checks:
// it parses (`bash -n`, in bash 5.2 and 5.3 when `$BASH_EXPLAINER_BASH53` names one), and explaining it raises no fact
// of the same id where it was made. Then the oracles of each id over its states (test/support/rewrite-states.ts,
// `STATES`), where they apply: the meaning is kept, the hazard is gone. The counts are pinned, so that a change of the
// corpus or of an oracle that runs fewer checks shows (update them when the corpus changes them).
import * as assert from 'assert';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { checkStates, corpusFacts, factsIn, type IdCounts, isStyle, leavesNoFact, MECHANICAL, parses, runJobs, singles, STATES, subjects, type SuggestionId, unsafe } from './support/rewrite-states';
import { programs } from './support/rewrites';

const parser = createUnbashParser();

/**
 * For each id: its subjects (the rewrites of an input, applied together), those whose states ran, the checks made, and
 * why the others did not run.
 */
const PINNED: Partial<Record<SuggestionId, IdCounts>> = {
  'and-or-in-bracket': { subjects: 4, ran: 4, checks: 10, skipped: {} },
  'array-joined-in-assignment': { subjects: 11, ran: 10, checks: 20, skipped: { 'an assignment in a function, whose variable the epilogue does not see': 1 } },
  'assignment-with-spaces': { subjects: 11, ran: 9, checks: 18, skipped: { 'an assignment to `PATH`': 1, 'bash does not parse it': 1 } },
  'brace-close-no-separator': { subjects: 3, ran: 3, checks: 3, skipped: {} },
  'brace-no-space': { subjects: 7, ran: 7, checks: 7, skipped: {} },
  'bracket-close-glued': { subjects: 3, ran: 2, checks: 2, skipped: { 'not a plain name before `]`': 1 } },
  'bracket-close-in-word': { subjects: 6, ran: 6, checks: 24, skipped: {} },
  'bracket-no-space': { subjects: 4, ran: 4, checks: 8, skipped: {} },
  'declaration-masks-status': { subjects: 6, ran: 5, checks: 11, skipped: { 'bash does not parse it': 1 } },
  'failure-reported-as-success': { subjects: 2, ran: 2, checks: 16, skipped: {} },
  'for-over-unquoted-args': { subjects: 4, ran: 4, checks: 12, skipped: {} },
  'nounset-unbound': { subjects: 5, ran: 5, checks: 15, skipped: {} },
  'postfix-increment-status': { subjects: 14, ran: 14, checks: 28, skipped: {} },
  'prefix-assignment-expanded-first': { subjects: 1, ran: 1, checks: 2, skipped: {} },
  'read-without-r': { subjects: 16, ran: 9, checks: 27, skipped: { 'its stdin is a pipe': 6, 'its stdin is a redirection': 1 } },
  'redirect-in-bracket': { subjects: 6, ran: 5, checks: 9, skipped: { 'a redirection to a word that is not plain text': 1 } },
  'regex-backslash-dropped': { subjects: 2, ran: 2, checks: 24, skipped: {} },
  'rm-empty-variable-root': { subjects: 41, ran: 28, checks: 84, skipped: { '`source`': 1, '`sudo` with an option': 1, 'a command named by a path': 2, 'the script sets `DIR`': 4, 'the script sets `D`': 5 } },
  'unbraced-element': { subjects: 1, ran: 1, checks: 1, skipped: {} },
  'unmatched-glob-runs-once': { subjects: 7, ran: 7, checks: 21, skipped: {} },
  'unquoted-variable-as-path': { subjects: 58, ran: 41, checks: 214, skipped: { '`source`': 1, 'a command named by a path': 2, 'the script sets `BUILD_DIR`': 1, 'the script sets `DIR`': 5, 'the script sets `D`': 8 } },
  'unquoted-variable-in-test': { subjects: 13, ran: 12, checks: 72, skipped: { 'a redirection to a word that is not plain text': 1 } },
  'wrapper-assignment-expanded-first': { subjects: 1, ran: 1, checks: 2, skipped: {} },
};

/** The ids of the subjects whose original bash does not parse, one for each. */
const UNPARSED: SuggestionId[] = ['assignment-with-spaces', ...Array(3).fill('brace-close-no-separator'), ...Array(3).fill('brace-no-space'), 'declaration-masks-status'];

/**
 * Inputs for the ids the corpus raises nowhere (the three `*-last-test-*` ids), and for a list of a glob and other
 * words, where the test of the name in the body would skip the words that are no files: the same oracles. Then forms
 * of the style checks the corpus lacks: `[[` glued to its first word, a `}` glued to the group's command as a word of
 * its own or at the end of one, `read` from the script's stdin in a loop, `>` in `[ ]` (the original makes a file in
 * the box), the check before `rm` of a value with no `:?` form, a value in quotes after `x =`, `rm` in a function.
 */
const HAND = [
  '#!/bin/bash\nset -e\nf() {\n  [ -f x ] && echo "@y"\n}\nf\necho @next\n',
  '#!/bin/bash\nset -e\nf() { [[ -f x ]] && echo y; }\necho @start\nf\n',
  '#!/bin/bash\necho @start\n[ -f x ] && echo "@y"\n',
  'for i in a b *.c; do echo "$i"; done\n',
  '[[-f x]] && echo y\n', '{echo a }\n', '{echo a}; echo b\n', 'while read line; do echo "$line"; done\n', '[ "$a" > b ] && echo yes\n',
  'rm -rf ${DIR%/}/*\n', 'x = "a b"\necho "$x"\n', 'f() {\n  rm -rf $D/x\n}\nf\n',
];

describe('the walls of the runs of the corpus (test/support/rewrite-states.ts)', function () {
  this.timeout(60000);
  // (Never run: each would act outside the box if its wall did not hold. The first four once did.)
  const refused: [string, RegExp][] = [
    ['PATH=/usr/bin:$PATH; touch $D/x; id -un', /assignment to `PATH`/],
    ['command cd $D && echo hi > f', /`command cd`, which passes the recorder/],
    ['echo hi > $D/f', /redirection to a word that is not plain text/],
    ['PATH=/bin:/usr/bin; rm -rf $DIR/*', /assignment to `PATH`/],
    // (PATH and the other variables that find commands or start a new bash, however they are set.)
    ['export PATH', /`export` of `PATH`/], ['declare -x PATH=/bin', /assignment to `PATH`/], ['read PATH', /`read` of `PATH`/],
    ['printf -v PATH x', /`printf` of `PATH`/], ['f() { local PATH=/bin; }', /assignment to `PATH`/], ['BASH_CMDS[x]=/bin/id; x', /assignment to `BASH_CMDS`/],
    ['BASH_ALIASES[x]=/bin/id', /assignment to `BASH_ALIASES`/], ['BASH_ENV=/x bash -c :', /assignment to `BASH_ENV`/], ['PS4=\'$(id)\'; set -x', /assignment to `PS4`/],
    ['env PATH=/usr/bin id', /`env` given `PATH=`/], ['env LD_PRELOAD=./x.so echo', /`env` given `LD_PRELOAD=`/], ['env -i id', /`env` with an option/],
    ['env -C / echo > f', /`env` with an option/], ['sudo -i id', /`sudo` with an option/], ['env $opt id', /`env` with a word that is not plain text/],
    // (A new bash in posix mode, or with the options of SHELLOPTS, reads no BASH_ENV: the walls would not be there.)
    ['POSIXLY_CORRECT=1 bash -c \'cd /tmp && echo x > f\'', /assignment to `POSIXLY_CORRECT`/], ['env POSIXLY_CORRECT=1 bash -c \'cd .. && echo x > f\'', /`env` given `POSIXLY_CORRECT=`/],
    ['export POSIXLY_CORRECT=1; bash -c \'cd .. && echo x > f\'', /assignment to `POSIXLY_CORRECT`/], ['set -a; POSIXLY_CORRECT=1; bash -c \'cd .. && echo x > f\'', /assignment to `POSIXLY_CORRECT`/],
    ['set -o posix; export SHELLOPTS; bash -c \'cd ..; echo x > f\'', /`export` of `SHELLOPTS`/], ['declare -x BASHOPTS', /`declare` of `BASHOPTS`/],
    ['set -a; set -o posix; bash -c \'cd ..; echo x > f\'', /`set -o posix` with `set -a`/], ['set -o allexport; shopt -so posix', /`set -o posix` with `set -a`/],
    ['export -n BASH_ENV; bash -c \'cd ..\'', /`export` of `BASH_ENV`/], ['declare +x PATH', /`declare` of `PATH`/], ['env -S \'bash --posix -c x\'', /`env` with an option/],
    ['exec -a sh bash -c \'cd ..\'', /`exec`/], ['sh -i', /`sh` other than/], ['./x.sh', /named by a path/],
    // (A function exported by \`set -a\`, which a new bash would define before its set-up: \`enable\` there.)
    ['set -a; enable() { :; }; bash -c \'cd ..\'', /`set -a` with a function definition/], ['set -o allexport; f() { :; }; bash -c f', /`set -a` with a function definition/],
    ['shopt -so allexport\nulimit() { :; }', /`set -a` with a function definition/],
    // (A program by its path, also through a command that runs another, and the builtins that get past the walls.)
    ['/bin/id', /named by a path/], ['command /bin/id', /named by a path/], ['env /bin/id', /named by a path/], ['echo $(/usr/bin/id)', /named by a path/],
    ['command -p id', /`command -p`/], ['builtin cd /', /`builtin`/], ['exec id', /`exec`/], ['hash -p /bin/id x', /`hash`/], ['enable -f x.so y', /`enable`/],
    ['source f', /`source`/], ['. f', /`\.`/], ['eval x', /`eval`/], ['trap x EXIT', /`trap`/], ['compgen -C id x', /`compgen`/], ['mapfile -C id -c 1 a < f', /`mapfile -C`/],
    ['$cmd', /named by an expansion/], ['"$BASH" -c id', /named by an expansion/],
    // (Functions that would replace a recorder, or reach a new bash before its set-up.)
    ['cd() { :; }', /a function `cd`/], ['command_not_found_handle() { "$@"; }', /a function `command_not_found_handle`/], ['f() { :; }; export -f f', /exported function/],
    // (A new bash: only `bash -c STRING`, whose string is checked as a script.)
    ['bash -i -c id', /`bash` other than `bash -c STRING`/], ['bash -p -c id', /other than/], ['bash f.sh', /other than/], ['bash -c "$s"', /other than/],
    ['bash -c \'/bin/id\'', /in `bash -c`: a command named by a path/], ['bash -c "echo > /tmp/x"', /in `bash -c`: a redirection outside/],
    // (Redirections: to a file outside, or to a word that is not text; `<>` and `>|` write too.)
    ['echo > /tmp/x', /outside/], ['echo >| /tmp/x', /outside/], ['echo <> /tmp/x', /outside/], ['echo > ../x', /outside/], ['echo > a/../../x', /outside/],
    ['echo > ~/x', /not plain text/], ['echo >&$fd', /not plain text/], ['echo > >(cat)', /not plain text/], ['echo > "$f"', /not plain text/], ['cat < /dev/tcp/h/80', /network/],
    // (Code in a value, which bash runs where it reads the value as code: an arithmetic subscript, `${x@P}`.)
    ['x=\'a[$(id)]\'; echo $((x))', /code in a string/], ['x=$\'a[\\x24(id)]\'', /code in a string/], ['echo \\$\\(id\\)', /code in a string/],
    ['read x <<\'E\'\n$(id)\nE', /code in a string/], ['echo ${x@P}', /@P/],
    // (A command left running after the run.)
    ['sleep 9 &', /background/], ['coproc { :; }', /background/],
  ];
  for (const [src, why] of refused) it(`refuse ${JSON.stringify(src)}`, () => assert.match(unsafe(parser.parse(src)) ?? 'allowed', why));
  it('allow what stays in the box', () => {
    for (const src of ['set -o posix; bash -c :', 'set -a; x=1', 'f() { :; }; f; set +a', 'export SHELLOPTS_X=1', 'echo hi > f 2>/dev/null >&2 2>&1 >&-', 'cat < "$f"; cat <<< "$x"', 'FOO=1 bash -c \'echo "$FOO" > f\'', 'command -v x', 'sudo FOO=1 echo $FOO', 'cd "$D"', 'cat <<E\n$(echo a)\nE']) {
      assert.strictEqual(unsafe(parser.parse(src)), undefined, src);
    }
  });
  for (const { name, program } of programs) {
    it(`hold at run time too, in ${name}`, async () => {
      // (Harmless runs: the walls the set-up and the wrappers make, which hold even where \`unsafe\` would let a script through.)
      const runs = await runJobs(program, [
        { script: 'PATH=/usr/bin:$PATH; echo "$PATH" | grep -c usr' },
        { script: 'command cd ..; builtin cd ..; pushd ..; pwd' },
        { script: 'cd() { :; }; unset -f cd command_not_found_handle; BASH_CMDS[x]=/bin/echo; x hi' },
        { script: 'exec echo; hash -p /bin/echo x; enable -n command' },
        { script: 'bash -i -c "echo i"; bash -p -c "echo p"; bash --posix -c "echo x"; bash -c "PATH=/usr/bin; echo no"', programs: ['bash'] },
        { script: 'env -i echo i; env -u PATH echo u; env PATH=/usr/bin echo p; env /bin/echo e; env A=1 echo ok', programs: ['env', 'echo'] },
        // (A new bash that would skip the set-up: posix mode, the options of SHELLOPTS, no BASH_ENV or PATH exported.)
        { script: 'POSIXLY_CORRECT=1 bash -c \'cd ..; pwd\'; env POSIXLY_CORRECT=1 bash -c \'cd ..; pwd\'; export POSIXLY_CORRECT=1; bash -c \'cd ..; pwd\'', programs: ['bash', 'env'] },
        { script: 'set -a; set -o posix; bash -c \'cd ..; pwd\'; bash -o posix -c \'cd ..; pwd\'; bash --posix -c \'cd ..; pwd\'; export SHELLOPTS; bash -c \'cd ..; pwd\'', programs: ['bash'] },
        { script: 'export -n BASH_ENV PATH; bash -c \'cd ..; pwd; echo "$PATH" | grep -c usr\'; env bash -c \'cd ..; pwd\'', programs: ['bash', 'env'] },
        // (Functions that a new bash imports before its set-up, named as builtins it runs: the set-up calls them through \`builtin\`.)
        { script: 'set -a; enable() { builtin echo "@enable $*"; }; ulimit() { builtin echo "@ulimit $*"; }; bash -c \'exec echo x; hash -p /bin/echo y; enable -n z\'', programs: ['bash'] },
      ]);
      const out = runs.map((r) => r.out + r.err);
      assert.match(out[0], /PATH: readonly variable/);
      assert.doesNotMatch(out[0], /^1$/m);
      assert.match(out[1], /^@cd <\.\.>\n@cd <\.\.>\nBOX\n.*builtin: cd: not a shell builtin\n$/s);
      // (The assignment to a readonly variable stops the script.)
      assert.match(out[2], /cd: readonly function\n.*cd: cannot unset: readonly function\n.*command_not_found_handle: cannot unset: readonly function\n.*BASH_CMDS: readonly variable\n$/);
      assert.match(out[3], /^@exec <echo>\n@hash <-p> <\/bin\/echo> <x>\n@enable <-n> <command>\n$/);
      assert.deepStrictEqual(out[4].split('\n').filter(Boolean).map((l) => l.replace(/^(@bash refused|bash: line N: PATH: readonly variable).*/, '$1')),
        ['@bash refused', '@bash refused', '@bash refused', 'bash: line N: PATH: readonly variable']);
      assert.deepStrictEqual(out[5].split('\n').filter(Boolean).map((l) => l.replace(/^(@env refused).*/, '$1')), ['ok', '@env refused', '@env refused', '@env refused', '@env refused']);
      // (Each new bash is refused or reads the set-up: \`cd\` is recorded and \`pwd\` stays in the box.)
      const lines = (o: string): string[] => o.split('\n').filter(Boolean).map((l) => l.replace(/^(@\w+ refused|.*: line N: \w+: readonly variable).*/, '$1'));
      const readonly = '../f.sh: line N: POSIXLY_CORRECT: readonly variable';
      assert.deepStrictEqual([runs[6], runs[7], runs[8]].map((r) => [lines(r.out), lines(r.err)]), [
        [['@cd <..>', 'BOX', '@cd <..>', 'BOX'], [readonly, '@env refused', readonly]],
        [['@cd <..>', 'BOX'], [readonly, '@bash refused', '@bash refused', '@bash refused']],
        [['@cd <..>', 'BOX', '@grep <-c> <usr>', '@cd <..>', 'BOX'], []],
      ]);
      // (\`exec\` and \`hash\` are turned off in the new bash: its set-up ran \`enable\` and \`ulimit\`, not the functions,
      // which print nothing there. The script's own \`enable\` is the function.)
      assert.deepStrictEqual([lines(runs[9].out), lines(runs[9].err)], [['@exec <echo> <x>', '@hash <-p> </bin/echo> <y>', '@enable -n z'], []]);
    });
  }
});

describe('the rewrites of the corpus (docs/design/oracles.md, step 5)', function () {
  this.timeout(60000);
  const facts = corpusFacts();
  const one = singles(facts);

  it('has states and an oracle for every mechanical id', () => {
    assert.deepStrictEqual(MECHANICAL.filter((id) => !STATES[id]), []);
  });
  it('leave no fact of the same id where they were made', () => {
    assert.deepStrictEqual(one.flatMap((s) => { const bad = leavesNoFact(s); return bad ? [`${s.id} in ${JSON.stringify(s.input)}, ${JSON.stringify(s.codes)}: ${bad}`] : []; }), []);
  });
  for (const { name, program } of programs) {
    it(`parse in ${name}, where the original does, and always where it may not (\`broken\`)`, async () => {
      const [before, after] = await Promise.all([parses(program, one.map((s) => s.original)), parses(program, one.map((s) => s.script))]);
      assert.deepStrictEqual(one.filter((s, i) => (before[i] || STATES[s.id]!.broken) && !after[i]).map((s) => `${s.id} in ${JSON.stringify(s.input)}: ${JSON.stringify(s.codes)}`), []);
      // (Originals bash does not parse: one snippet, `@(a|b)` in a `case` without extglob; groups the style checks find
      // unclosed, `{echo a; }` and `{ echo a }`.)
      const unparsed = one.filter((_, i) => !before[i]).map((s) => s.id);
      assert.deepStrictEqual(unparsed.sort(), UNPARSED);
    });
    it(`keep the meaning and remove the hazard over the states of their ids, in ${name}`, async () => {
      const { failures, counts } = await checkStates(program, subjects(facts));
      assert.deepStrictEqual(failures, []);
      assert.deepStrictEqual(Object.fromEntries(Object.entries(counts).sort()), PINNED);
    });
    it(`do so too on inputs for the ids the corpus raises nowhere, in ${name}`, async () => {
      const { failures, counts } = await checkStates(program, subjects(HAND.flatMap((t) => factsIn(t, t))));
      assert.deepStrictEqual(failures, []);
      // (Every mechanical id has run over its states; the style checks, on the forms above too.)
      assert.deepStrictEqual(MECHANICAL.filter((id) => !counts[id]?.ran && !PINNED[id]?.ran), []);
      assert.deepStrictEqual(MECHANICAL.filter((id) => isStyle(id) && counts[id]?.ran !== counts[id]?.subjects), []);
    });
  }
});
