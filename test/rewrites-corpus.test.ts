// The rewrites of the corpus (docs/design/oracles.md, 3.3 and step 5): every fact of a mechanical id that sample.sh,
// the other fixtures and the snippets of the tests raise, its rewrites applied. For each rewrite, the two cheap checks:
// it parses (`bash -n`, in bash 5.2 and 5.3 when `$BASH_EXPLAINER_BASH53` names one), and explaining it raises no fact
// of the same id where it was made. Then the oracles of each id over its states (test/support/rewrite-states.ts,
// `STATES`), where they apply: the meaning is kept, the hazard is gone. The counts are pinned, so that a change of the
// corpus or of an oracle that runs fewer checks shows (update them when the corpus changes them).
import * as assert from 'assert';
import type { FactId } from '../src/messages';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { checkStates, corpusFacts, factsIn, type IdCounts, leavesNoFact, MECHANICAL, parses, runJobs, singles, STATES, subjects, unsafe } from './support/rewrite-states';
import { programs } from './support/rewrites';

const parser = createUnbashParser();

/**
 * For each id: its subjects (the rewrites of an input, applied together), those whose states ran, the checks made, and
 * why the others did not run.
 */
const PINNED: Partial<Record<FactId, IdCounts>> = {
  'array-joined-in-assignment': { subjects: 11, ran: 10, checks: 20, skipped: { 'an assignment in a function, whose variable the epilogue does not see': 1 } },
  'bracket-close-glued': { subjects: 3, ran: 2, checks: 2, skipped: { 'not a plain name before `]`': 1 } },
  'declaration-masks-status': { subjects: 6, ran: 5, checks: 11, skipped: { 'bash does not parse it': 1 } },
  'failure-reported-as-success': { subjects: 2, ran: 2, checks: 16, skipped: {} },
  'for-over-unquoted-args': { subjects: 4, ran: 4, checks: 12, skipped: {} },
  'nounset-unbound': { subjects: 5, ran: 5, checks: 15, skipped: {} },
  'postfix-increment-status': { subjects: 14, ran: 14, checks: 28, skipped: {} },
  'prefix-assignment-expanded-first': { subjects: 1, ran: 1, checks: 2, skipped: {} },
  'regex-backslash-dropped': { subjects: 2, ran: 2, checks: 24, skipped: {} },
  'unbraced-element': { subjects: 1, ran: 1, checks: 1, skipped: {} },
  'unmatched-glob-runs-once': { subjects: 7, ran: 7, checks: 21, skipped: {} },
  'unquoted-variable-as-path': { subjects: 27, ran: 13, checks: 76, skipped: { 'a command named by a path': 2, 'the script sets `BUILD_DIR`': 1, 'the script sets `D`': 5, 'the script sets `DIR`': 5, '`source`': 1 } },
  'unquoted-variable-in-test': { subjects: 9, ran: 9, checks: 51, skipped: {} },
  'wrapper-assignment-expanded-first': { subjects: 1, ran: 1, checks: 2, skipped: {} },
};

/**
 * Inputs for the ids the corpus raises nowhere (the three `*-last-test-*` ids), and for a list of a glob and other
 * words, where the test of the name in the body would skip the words that are no files: the same oracles.
 */
const HAND = [
  '#!/bin/bash\nset -e\nf() {\n  [ -f x ] && echo "@y"\n}\nf\necho @next\n',
  '#!/bin/bash\nset -e\nf() { [[ -f x ]] && echo y; }\necho @start\nf\n',
  '#!/bin/bash\necho @start\n[ -f x ] && echo "@y"\n',
  'for i in a b *.c; do echo "$i"; done\n',
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
    for (const src of ['echo hi > f 2>/dev/null >&2 2>&1 >&-', 'cat < "$f"; cat <<< "$x"', 'FOO=1 bash -c \'echo "$FOO" > f\'', 'command -v x', 'sudo FOO=1 echo $FOO', 'cd "$D"', 'cat <<E\n$(echo a)\nE']) {
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
    it(`parse in ${name}, where the original does`, async () => {
      const [before, after] = await Promise.all([parses(program, one.map((s) => s.original)), parses(program, one.map((s) => s.script))]);
      assert.deepStrictEqual(one.filter((_, i) => before[i] && !after[i]).map((s) => `${s.id} in ${JSON.stringify(s.input)}: ${JSON.stringify(s.codes)}`), []);
      // (One snippet bash does not parse: `@(a|b)` in a `case` without extglob.)
      assert.strictEqual(before.filter((b) => !b).length, 1);
    });
    it(`keep the meaning and remove the hazard over the states of their ids, in ${name}`, async () => {
      const { failures, counts } = await checkStates(program, subjects(facts));
      assert.deepStrictEqual(failures, []);
      assert.deepStrictEqual(Object.fromEntries(Object.entries(counts).sort()), PINNED);
    });
    it(`do so too on inputs for the ids the corpus raises nowhere, in ${name}`, async () => {
      const { failures, counts } = await checkStates(program, subjects(HAND.flatMap((t) => factsIn(t, t))));
      assert.deepStrictEqual(failures, []);
      // (Every mechanical id has run over its states.)
      assert.deepStrictEqual(MECHANICAL.filter((id) => !counts[id]?.ran && !PINNED[id]?.ran), []);
    });
  }
});
