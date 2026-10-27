// The reading tree against the Bash Reference Manual, chapter 6, the sections about bash itself: 6.1 Invoking Bash,
// 6.2 Bash Startup Files, 6.3 Interactive Shells and 6.10 The Restricted Shell. What the explanation says of a `bash`
// or `rbash` invocation, a shebang, the startup-file idioms and the interactive tests, each checked with bash 5.2 and
// 5.3 (`$BASH_EXPLAINER_BASH53`). (test/reading-manual.test.ts has chapters 3 to 5.)
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { lookupCommand } from '../src/dict/aliases';
import { builtins } from '../src/dict/builtins';
import { PROGRAM_SECTIONS } from '../src/manual';
import { readingNodes, type ReadingNode } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { type BashOptions, runBash } from './support/bash';

const parser = createUnbashParser();
const analyzer = new Analyzer('en');
const explain = (src: string, line = 0) => analyzer.explainLine(parser.parse(src), line, 'bash', { reading: true });
const reading = (src: string, line = 0): ReadingNode => explain(src, line).reading!;
/** The text of the first node of the layer `command` with this label: what bash reads a word as. */
const said = (src: string, label: string, line = 0): string => readingNodes(reading(src, line)).find((n) => n.layer === 'command' && n.label === label)!.text!;
const notes = (src: string, line = 0): string => explain(src, line).notes.join('\n');
const programs: BashOptions[] = [{}, ...(process.env.BASH_EXPLAINER_BASH53 ? [{ program: process.env.BASH_EXPLAINER_BASH53 }] : [])];
/** Runs `script` in each bash, in a directory of its own; `"$BASH"` there is that bash. */
const each = (script: string, check: (r: { stdout: string; stderr: string; status: number }, which: string) => void): void => {
  for (const p of programs) check(runBash(script, { ...p, files: [] }), p.program ?? 'bash');
};

describe('the reading tree as the Bash manual reads bash itself (chapter 6: 6.1, 6.2, 6.3, 6.10)', () => {
  it('knows every option of bash --help, and reads the letters of `set` with their texts (6.1)', () => {
    const spec = lookupCommand('bash')!;
    const names = new Set(spec.options!.flatMap((o) => o.names));
    for (const p of programs) {
      const help = runBash('"$BASH" --help', p).stdout;
      const long = help.slice(help.indexOf('GNU long options:'), help.indexOf('Shell options:')).match(/--[\w-]+/g)!;
      assert.deepStrictEqual(long.filter((n) => !names.has(n)), [], p.program ?? 'bash');
      assert.deepStrictEqual([...names].filter((n) => n.startsWith('--')).sort(), [...long].sort());
      // `-ilrsD or -c command or -O shopt_option`, `-abefhkmnptuvxBCEHPT or -o option`.
      const letters = [...help.matchAll(/^\s+-(\w+) or/gm)].map((m) => m[1]).join('') + 'coO';
      assert.deepStrictEqual([...names].filter((n) => /^-\w$/.test(n)).map((n) => n[1]).sort(), [...letters].sort());
    }
    // The letters of `set` mean what they mean to `set` (one source: its spec).
    // (`set -r` is not `bash -r`, which makes the variables read-only too.)
    for (const o of builtins.set.options!.filter((x) => /^-[a-zA-Z]$/.test(x.names[0]) && x.names[0] !== '-r')) assert.strictEqual(spec.options!.find((x) => x.names.includes(o.names[0])), o, o.names[0]);
    each('for l in a b e f h k m n p t u v x B C E H P T; do "$BASH" -$l -c : </dev/null 2>/dev/null || echo "$l failed"; done', (r, which) => assert.strictEqual(r.stdout, '', which));
  });

  it('takes the command string from the first operand, wherever `-c` is (6.1)', () => {
    assert.match(said("bash -c -e 'echo $-' zero", '-c'), /^read the commands from the first argument after the options \(the command string\), not from a file or stdin; the arguments after it become `\$0`, `\$1`…$/);
    assert.match(said("bash -c -e 'echo $-' zero", '-e'), /^exit immediately if a command fails/);
    assert.match(said("bash -c -e 'echo $-' zero", "'echo $-'"), /^The command string/);
    assert.match(said("bash -c -e 'echo $-' zero", 'zero'), /^Becomes `\$0`/);
    // (`-` ends the options as `--` does: the string is the word after it.)
    assert.strictEqual(said("bash -c - 'echo $0' zero", '-'), 'End of options: everything after is a plain argument');
    assert.match(said("bash -c - 'echo $0' zero", "'echo $0'"), /^The command string/);
    each(`"$BASH" -c -e 'echo $-' zero; "$BASH" -c - 'echo $0' zero; "$BASH" - ./s a 2>&1 | grep -c 'No such file'`, (r, which) => assert.strictEqual(r.stdout, 'ehBc\nzero\n1\n', which));
  });

  it('reads long options only before the others, and refuses what bash refuses (6.1)', () => {
    assert.match(said("bash -x --posix -c 'echo hi'", '--posix'), /^A long option after a single-letter one: bash reads long options only before the others, so it reads this word as the letters `-`…, says `--: invalid option` and exits, running nothing \(status 2; after `-e`, status 1, with no usage\)$/);
    // (Before them, `-login` is `--login` too; after them, it is letters.)
    assert.strictEqual(said("bash -login -c 'echo x'", '-login'), said("bash --login -c 'echo x'", '--login'));
    assert.match(said('bash -x -login', '-login'), /^Combined short options `-l` `-o` `-g` `-i` `-n`$/);
    const invalid = /^An option bash does not have: bash says `invalid option`, prints its usage, and exits, running nothing \(status 2; after `-e`, status 1, with no usage\)$/;
    assert.match(said("bash --rcfile=f -c 'echo x'", '--rcfile=f'), invalid);
    assert.match(said("bash -y -c 'echo x'", '-y'), invalid);
    // (`--rcfile` takes the next word: the words after it stay options.)
    assert.strictEqual(said("bash --rcfile f --norc -c 'echo x'", 'f'), 'Value for `--rcfile`');
    assert.match(said("bash --rcfile f --norc -c 'echo x'", '--norc'), /^in an interactive shell, do not read `~\/\.bashrc`$/);
    each([
      `"$BASH" -x --posix -c 'echo hi'; echo "s$?"`, `"$BASH" -e --posix -c 'echo hi'; echo "s$?"`, `"$BASH" --rcfile=f -c 'echo hi'; echo "s$?"`,
      `"$BASH" -y -c 'echo hi'; echo "s$?"`, `"$BASH" --rcfile f --norc -c 'echo hi'; echo "s$?"`, `"$BASH" -login -c 'shopt -q login_shell && echo L' </dev/null`,
    ].join('\n'), (r, which) => {
      assert.strictEqual(r.stdout, 's2\ns1\ns2\ns2\nhi\ns0\nL\n', which);
      assert.match(r.stderr, /--: invalid option[^]*--rcfile=f: invalid option[^]*-y: invalid option/, which);
    });
  });

  it('says what `-O`, `+O`, `-o` and `+o` alone print (6.1)', () => {
    assert.strictEqual(said('bash -O', '-O'), '`-O` alone (no name): list the `shopt` options and their values');
    assert.match(said('bash +O', '+O'), /^`\+O` alone \(no name\): print the `shopt` settings as commands that make them/);
    assert.match(said('bash -o', '-o'), /^`-o` alone \(no name\): list the current option settings/);
    assert.match(said('bash +o', '+o'), /^`\+o` alone \(no name\): print the commands that recreate the current settings/);
    assert.match(said('bash -O extglob +O nullglob x', '+O'), /^Undo `-O`: turn a `shopt` option off by name$/);
    // (`o` and `O` take the next word, never the rest of theirs: `-onounset` gives `-o` the word `-c`, which bash refuses.)
    assert.strictEqual(said("bash -onounset -c 'echo x'", '-c'), 'Value for `-o`');
    each(`"$BASH" -onounset -c 'echo x'; echo "s$?"`, (r, which) => {
      assert.strictEqual(r.stdout, 's2\n', which);
      assert.match(r.stderr, /-c: invalid option name/, which);
    });
    each('"$BASH" -O </dev/null | grep -c "^extglob"; "$BASH" +O </dev/null | grep -c "^shopt -u extglob"; "$BASH" -o </dev/null | grep -c "^errexit"; "$BASH" +o </dev/null | grep -c "^set +o errexit"', (r, which) => assert.strictEqual(r.stdout, '1\n1\n1\n1\n', which));
  });

  it('says what the startup options change (6.1, 6.2, 6.3.1)', () => {
    assert.match(said("bash -i -c 'll'", '-i'), /^act as an interactive shell \(at start it reads `~\/\.bashrc`, but a login shell reads its login files instead, and POSIX mode `\$ENV`; it expands aliases, and `\$-` contains `i`\)$/);
    assert.match(said('bash -l x', '-l'), /even when not interactive; not in POSIX mode\)$/);
    assert.strictEqual(said("bash --pretty-print -c 'x'", '--pretty-print'), 'print the script file reformatted instead of running it (a `-c` string still runs)');
    // (`-i -l` reads the login files only; POSIX mode reads `$ENV`, and no login files.)
    each([
      'echo "echo RC" > .bashrc; echo "echo PROFILE" > .profile; echo "echo ENVF" > envf; export HOME=$PWD',
      '"$BASH" -i -l -c : </dev/null 2>/dev/null | grep -E "^(RC|PROFILE)$"', 'ENV=$PWD/envf "$BASH" --posix -i -c : </dev/null 2>/dev/null',
      '"$BASH" --posix -l -c "echo none" </dev/null', 'printf "echo f1\\n" > s; "$BASH" --pretty-print -c "echo hi"; "$BASH" --pretty-print s',
    ].join('\n'), (r, which) => assert.strictEqual(r.stdout, 'PROFILE\nENVF\nnone\nhi\necho f1\n\n', which));
    assert.match(said('bash -l x', '-l'), /^act as a login shell \(at start it reads `\/etc\/profile`, then the first of `~\/\.bash_profile`, `~\/\.bash_login` and `~\/\.profile` that exists, even when not interactive; not in POSIX mode\)$/);
    assert.match(said('bash -s a', '-s'), /^read the commands from stdin \(also the default when no operand is left\); the operands become `\$1`…$/);
    assert.match(said('bash --version', '--version'), /nothing else runs$/);
    // A HOME with a `.bashrc` that defines an alias, and a `.profile`: `-i` reads one, `-l` the other.
    each([
      'printf \'echo RC; alias ll="echo LL"\\n\' > .bashrc; echo "echo PROFILE" > .profile; export HOME=$PWD',
      '"$BASH" -i -c \'ll; echo "$-"\' </dev/null 2>/dev/null | grep -v sudo | grep .',
      '"$BASH" -l -c \'shopt login_shell\' </dev/null 2>/dev/null',
      '"$BASH" --norc -i -c \'echo norc\' </dev/null 2>/dev/null',
      'echo "echo RCFILE" > r; "$BASH" --rcfile r -i -c : </dev/null 2>/dev/null | grep RCFILE',
      'echo "echo s:\\$0:\\$1" | "$BASH" -s a',
    ].join('\n'), (r, which) => assert.match(r.stdout, /^(?:.*\n)*RC\nLL\nhiBHc\nPROFILE\nlogin_shell\s+on\nnorc\nRCFILE\ns:\S*bash\S*:a\n$/, which));
  });

  it('cites 6.1 for bash and 6.10 for rbash, as a command and in a shebang (6.1, 6.10, 3.8)', () => {
    assert.deepStrictEqual({ ...PROGRAM_SECTIONS }, { bash: ['6.1'], rbash: ['6.1', '6.10'] });
    const name = (src: string, label: string) => readingNodes(reading(src)).find((n) => n.label === label && (n.kind === 'commandName' || n.kind === 'command'))!;
    assert.deepStrictEqual(name("bash -c 'x'", 'bash').refs, ['3.7.1', '3.7.2', '6.1']);
    assert.deepStrictEqual(name("/bin/rbash -c 'x'", '/bin/rbash').refs, ['3.7.1', '3.7.2', '6.1', '6.10']);
    assert.match(name("/bin/rbash -c 'x'", '/bin/rbash').text!, /^Run the restricted shell \(bash started with the name `rbash`: as `bash -r`\)$/);
    assert.deepStrictEqual(name("sudo bash -c 'x'", 'bash').refs, ['6.1']);
    // The shebang's word, as the interpreter reads it (the kernel passes it whole, then the script's path).
    const shebang = (line: string) => readingNodes(reading(`${line}\necho hi\n`)).find((n) => n.kind === 'shebang')!;
    const eu = shebang('#!/bin/bash -eu');
    assert.deepStrictEqual(eu.children.map((c) => `${c.layer}:${c.kind} ${c.label} ${c.refs}`), ['command:option -eu 6.1']);
    assert.deepStrictEqual(eu.children[0].children.map((c) => c.label), ['-e', '-u']);
    assert.strictEqual(eu.children[0].children[1].text, 'treat unset variables as an error');
    assert.strictEqual(shebang('#!/bin/bash --posix').children[0].text, 'start in POSIX mode (as `set -o posix`)');
    assert.match(shebang('#!/bin/bash -r').children[0].text!, /^start a restricted shell: it refuses `cd`/);
    assert.match(shebang('#!/bin/bash +x').children[0].text!, /^Undo `-x`/);
    // (`-o` takes the next argument, the script's path: the pitfall says bash refuses it.)
    assert.match(shebang('#!/bin/bash -o').children[0].text!, / \(its value is the next argument, the script's path\)$/);
    assert.match(shebang('#!/usr/bin/awk -f').children[0].text!, /^read the program from a file \(its value is the next argument, the script's path\)$/);
    // (A letter after `-o` that takes a value has no word left; an option bash does not have; a lone `-`; a value in the word.)
    assert.deepStrictEqual(shebang('#!/bin/bash -oO').children[0].children.map((c) => c.text), ['enable an option by name (its value is the next argument, the script\'s path)', 'turn a `shopt` option on by name']);
    assert.match(shebang('#!/bin/bash -ey').children[0].children[1].text!, /^An option bash does not have: bash says `invalid option`/);
    assert.strictEqual(shebang('#!/bin/bash -').children[0].text, 'End of options');
    assert.match(shebang('#!/usr/bin/perl -i.bak').children[0].text!, / \(value: `\.bak`\)$/);
    assert.deepStrictEqual(shebang('#!/usr/bin/perl -wi.bak').children[0].children.map((c) => `${c.label} ${c.span.end.character}`), ['-w 18', '-i 23']);
    // (Not a word with blanks, which the kernel passes whole: `shebang-refused` says what bash does with it. Nor an
    // interpreter the dictionary does not know, nor a word that is no option.)
    assert.deepStrictEqual(shebang('#!/bin/bash -e -u').children, []);
    assert.deepStrictEqual(shebang('#!/usr/bin/env bash').children, []);
    assert.deepStrictEqual(shebang('#!/usr/bin/nosuch -x').children, []);
    // (The span of each letter is its character.)
    assert.deepStrictEqual(eu.children[0].children[1].span, { start: { line: 0, character: 14 }, end: { line: 0, character: 15 } });
    each('printf "#!$BASH -eu\\necho \\"\\$-\\"\\n" > s; printf "#!$BASH --posix\\nshopt -qo posix && echo posix\\n" > p; chmod +x s p; ./s; ./p', (r, which) => assert.strictEqual(r.stdout, 'ehuB\nposix\n', which));
  });

  it('says what `$-` and `PS1` tell a startup file, and cites 6.3.2', () => {
    const r = reading('case $- in *i*) echo interactive;; esac; [ -z "$PS1" ] && echo non');
    const node = (label: string) => readingNodes(r).find((n) => n.label === label && n.kind === 'expansion')!;
    assert.deepStrictEqual(node('$-').refs, ['3.4.2', '6.3.2']);
    assert.match(node('$-').text!, /The letters of the shell options in effect \(`e` after `set -e`, `i` in an interactive shell…\)$/);
    assert.deepStrictEqual(node('$PS1').refs, ['3.5.3', '5.1', '6.9', '6.3.2']);
    assert.match(node('$PS1').text!, /^Prompt of an interactive shell \(a shell that is not interactive, as one running a script, leaves it unset, even when the environment gives it: `\[ -z "\$PS1" \]` tells which it is\)$/);
    // `i` only in an interactive shell; PS1 unset in one that is not, even exported.
    each('export PS1=x; "$BASH" -c \'echo "$- ${PS1-unset}"\'; "$BASH" --norc -i -c \'echo "$- ${PS1-unset}"\' </dev/null 2>/dev/null | tail -1',(b, which) => assert.strictEqual(b.stdout, 'hBc unset\nhiBHc x\n', which));
  });

  it('warns where a restricted shell refuses, and only there (6.10)', () => {
    const script = (line: string) => `#!/bin/bash -r\n${line}\n`;
    // Each line, and the word bash's message names: the builtin, a command name with `/`, an output redirection.
    const refused: [string, RegExp][] = [
      ['cd /', /bash refuses this `cd` \(`cd: restricted`\): it does nothing, and fails with status 1/],
      ['pushd /tmp', /`pushd: restricted`/], ['pushd -n /tmp; popd', /`popd: restricted`/], ['pushd -n /tmp; popd +0', /`popd: restricted`/],
      ['command -pv ls', /`command: -p: restricted`/], ['builtin cd /', /`cd: restricted`/], ['command cd /', /`cd: restricted`/],
      ['d=/tmp; . "$d/nosuch"', /`\.: "\$d\/nosuch": restricted`/], ['. ~/x', /`\.: ~\/x: restricted`/], ['history -r ~/h', /`history: ~\/h: restricted`/], ['hash -p ~/bin/ls ls', /`hash: ~\/bin\/ls: restricted`/],
      ['d=/bin; "$d/echo" x', /`"\$d\/echo": restricted`: no `\/` in command names/],
      ['exec true', /`exec: restricted`/],
      ['/bin/echo x', /bash refuses a command name with a `\/` \(`\/bin\/echo: restricted`: no `\/` in command names, status 1\) and does not run `\/bin\/echo`/],
      ['./s.sh', /`\.\/s\.sh: restricted`/], ['command /bin/echo x', /`\/bin\/echo: restricted`/],
      ['command -p ls', /`command: -p: restricted`/], ['hash -p /bin/ls ls', /`hash: \/bin\/ls: restricted`/], ['hash -p/bin/ls ls', /`hash: \/bin\/ls: restricted`/],
      ['history -r /tmp/h', /`history: \/tmp\/h: restricted`/], ['enable -f x.so y', /`enable: restricted`/],
      ['. ./g.sh', /`\.: \.\/g\.sh: restricted`/], ['source ./g.sh', /`source: \.\/g\.sh: restricted`/],
      ['echo hi > f', /bash refuses the output redirection `>` \(`f: restricted: cannot redirect output`, status 1\) and does not run the command/],
      ['echo hi >> f', /`>>`/], ['echo hi >| f', /`>\|`/], ['cat <> f', /`<>`/], ['echo hi &> f', /`&>`/], ['echo hi &>> f', /`&>>`/], ['echo hi >& f', /`>&` \(`f:/],
      ['exec 3> f', /`f: restricted: cannot redirect output`/],
    ];
    const fine = ['pushd -n /tmp', 'pushd -n /tmp; pushd -n /usr; popd +1', 'pushd -n /tmp; pushd -n /usr; popd -0', 'command -p', 'hash -p /bin/ls', 'enable -f',
      'f() { :; } > g', 'tool=/bin/echo; "${tool##*/}" x', 'cmd=ecxo; ${cmd/x/h} x', 'echo hi >&2', 'echo hi 2>&1', 'echo hi >&-', 'fd=2; echo hi >&$fd', 'exec 3< /dev/null', 'exec', 'command -v ls', 'command ls', 'hash -p ls ls2',
      'history -s /tmp/h', 'history -r', 'enable -n echo', 'echo hi | cat', 'cat <<< hi'];
    for (const [line, says] of refused) {
      assert.match(notes(script(line), 1), says, line);
      assert.match(notes(script(line), 1), /^⚠ This is a restricted shell \(`bash -r`, `rbash`\), so bash refuses/m, line);
    }
    for (const line of fine) assert.doesNotMatch(notes(script(line), 1), /restricted/, line);
    // (A file whose name is known only at run time: nothing is said.)
    assert.doesNotMatch(notes(script('. "$f"'), 1), /restricted/);
    // Not in a shell that is not restricted; in one `bash -r -c`, `bash --restricted -c`, `rbash` or a shebang start.
    assert.doesNotMatch(notes('cd /'), /restricted/);
    assert.doesNotMatch(notes('command /bin/echo x; echo > f'), /restricted/);
    // (A variable the script exports to it is read-only there too.)
    assert.match(notes("export PATH=/x; bash -r -c 'PATH=/y'"), /The variable `PATH` is read-only/);
    assert.doesNotMatch(notes("bash -c 'cd /'"), /restricted/);
    for (const src of ["bash -r -c 'cd /'", "bash --restricted -c 'cd /'", "bash -er -c 'cd /'", "rbash -c 'cd /'"]) assert.match(notes(src), /`cd: restricted`/, src);
    for (const start of ['#!/bin/rbash', '#!/usr/bin/env rbash', '#!/usr/bin/env -S bash -r', '#!/bin/bash --restricted']) assert.match(notes(`${start}\ncd /\n`, 1), /`cd: restricted`/, start);
    // `shopt -u restricted_shell` changes nothing; the variables bash makes read-only.
    assert.match(notes(script('shopt -u restricted_shell\ncd /'), 2), /`cd: restricted`/);
    assert.match(notes(script('PATH=/x'), 1), /The variable `PATH` is read-only, so this assignment fails/);
    for (const v of ['SHELL', 'HISTFILE', 'ENV', 'BASH_ENV']) assert.match(notes(script(`${v}=/x`), 1), new RegExp(`The variable \`${v}\` is read-only`), v);
    assert.match(notes(script('unset PATH'), 1), /The variable `PATH` is read-only, so `unset` fails/);
    // bash: each refused line says "restricted" and fails; each fine line does not.
    const run = (lines: string[]) => lines.map((l) => `printf '%s\\n' '${l.replace(/'/g, "'\\''")}' > t; "$BASH" -r t </dev/null >/dev/null 2>e; echo "$? $(grep -c restricted e)"; rm -f e`).join('\n');
    each(`printf 'echo s\\n' > s.sh; printf 'echo g\\n' > g.sh; chmod +x s.sh\n${run(refused.map(([l]) => `${l}; echo "[$?]" >&2`))}`, (r, which) => {
      assert.deepStrictEqual(r.stdout.trim().split('\n'), refused.map(() => '0 1'), which);
    });
    each(run(fine), (r, which) => assert.deepStrictEqual(r.stdout.trim().split('\n').map((l) => l.split(' ')[1]), fine.map(() => '0'), which));
    each('"$BASH" -r -c \'PATH=/x; echo same\'; echo "s$?"; "$BASH" -r -c \'shopt -u restricted_shell; echo "$?"; shopt -q restricted_shell && echo still; set +r; echo "set $?"\' 2>/dev/null; "$BASH" -r -c \'declare -p SHELL PATH HISTFILE ENV BASH_ENV\' | cut -c1-11', (r, which) => {
      assert.strictEqual(r.stdout, 's1\n0\nstill\nset 1\ndeclare -r \ndeclare -rx\ndeclare -r \ndeclare -r \ndeclare -r \n', which);
      assert.match(r.stderr, /PATH: readonly variable/, which);
    });
  });

  it('makes the shell restricted from `set -r` on, as bash 5.2 does (6.10)', () => {
    assert.match(said('set -r', '-r'), /^make the shell restricted from here on .*bash 5\.3 also makes `PATH` and the like read-only\)$/);
    assert.match(said('set +r', '+r'), /nothing in a shell that is not restricted; a restricted one refuses it \(`set: \+r: invalid option`, status 1\)$/);
    assert.doesNotMatch(notes('set -r\ncd /'), /restricted/);
    assert.match(notes('set -r\ncd /', 1), /`cd: restricted`/);
    assert.doesNotMatch(notes('set +r\ncd /', 1), /restricted/);
    // (Not read-only there, as bash 5.2: docs/design/bash-versions.md has the 5.3 difference.)
    assert.doesNotMatch(notes('set -r\nPATH=/x', 1), /read-only/);
    each('"$BASH" -c \'set +r; echo "a $?"; set -r; echo "b $? $-"; cd /; echo "c $?"; set +r; echo "e $?"\' 2>&1 | grep -v usage', (r, which) => {
      assert.match(r.stdout, /^a 0\nb 0 hrBc\n.*cd: restricted\nc 1\n.*set: \+r: invalid option\ne 1\n$/, which);
    });
    each('"$BASH" -c \'set -r; PATH=/x; echo "p $?"\' 2>&1', (r, which) => assert.match(r.stdout, which === 'bash' ? /^p 0\n$/ : /PATH: readonly variable\n$/, which));
  });

  it('reads `+c`, `+l`, `+s`, `+D` as their `-` forms, and skips a lone `+` (6.1)', () => {
    assert.strictEqual(said("bash +c 'echo ran'", '+c'), said("bash -c 'echo ran'", '-c'));
    assert.match(said("bash +c 'echo ran'", "'echo ran'"), /^The command string/);
    assert.strictEqual(said('bash +l x', '+l'), said('bash -l x', '-l'));
    assert.deepStrictEqual(readingNodes(reading("bash +lc 'x'")).find((n) => n.layer === 'command' && n.label === '+lc')!.children.map((c) => c.text), [said('bash -l x', '-l'), said("bash -c 'x'", '-c')]);
    assert.strictEqual(said("bash + -c 'echo lone'", '+'), 'A lone `+`: no letters, so it changes nothing (bash skips it)');
    assert.match(said("bash + -c 'echo lone'", "'echo lone'"), /^The command string/);
    each(`"$BASH" +c 'echo ran'; "$BASH" +l -c 'shopt -q login_shell && echo L' </dev/null; echo 'echo x' | "$BASH" +s; "$BASH" + -c 'echo lone'; "$BASH" -e -y -c : 2>&1; echo "s$?"`, (r, which) => {
      assert.match(r.stdout, /^ran\nL\nx\nlone\n.*-y: invalid option\ns1\n$/, which);
    });
  });
});
