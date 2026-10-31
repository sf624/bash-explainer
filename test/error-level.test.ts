// Step 0 of the three note levels (docs/design/three-levels.md, sections 7 and 8): the bash inventory of the checks
// headed for Error, before any level moves. Every id that section 3 puts at Error has a row here: a short script that
// our explanation says the note on (at `warning`, or at `error` for those step 1a moved: the `failure()` facts,
// dialect `unsupported` and `crlf`), run in bash, and in the program a row needs (dash, bats,
// python3), under what question 1 of the rule varies (section 2):
//
// - the values of the variables the row reads from outside (`reads`): unset, empty, `a b`, `*`, and `x`, each
//   exported from the parent (so a name the script sets is also one the environment had);
// - how the file runs (`ways`): directly, as its shebang says; with `bash file`; sourced inside a function; sourced
//   by an interactive shell, after a stand-in `.bashrc` of what a distribution's gives (`ll`, and `extglob` on), and
//   no system file (`--norc`: `/etc/bash.bashrc` would print a banner and install a `command_not_found_handle` that
//   runs Python, and `--rcfile` still reads it on Debian and Ubuntu). A row whose Error rests on
//   the shebang runs only the ways a program runs (section 2); one that rests on an assumed system says so (`assumes`).
//
// Every run must fail: its output misses what the line is written to do (`works`), or the program says an error
// (`error`). A row whose runs do not all fail is a finding, which must be fixed in the check, or kept at a lower
// level; a row kept so says why (`finding`), and the test checks that it still holds. `ssh`, `docker`, `sudo` and `su` are stand-ins (`STUBS`) that run the command in `env -i`, which lacks
// what the remote shell, the container or the new shell lacks; sudo's stand-in passes the names sudo keeps.
//
// Each row's runs are one bash script, run in a cgroup with FUNCNEST set and killed as a process group on a timeout
// (test/support/contained.ts); each run copies the row's files into a fresh directory of its own.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { documentIssues } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { hostKind } from '../src/hosts';
import { MESSAGES } from '../src/messages';
import { STYLE_LEVELS } from '../src/pitfalls';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runContained } from './support/contained';

/** How a row's file is run (section 2). `bats` and `python` run the file with that program. */
type Way = 'direct' | 'file' | 'function' | 'interactive' | 'bats' | 'python';

interface Row {
  /** The id headed for Error (section 3): a fact of the catalog, a style check, `unsupported` (dialect) or `crlf`. */
  id: string;
  /** The problem's code, where it is not the id (a dialect issue: `dbracket`; a host's: `pythonNoShell`). */
  code?: string;
  /** The file's name (`script.sh` when not given): its extension makes it a bats file or Python. */
  file?: string;
  text: string;
  /** The line (from 1) our explanation says the note on. */
  line: number;
  /** What the output holds when the line does what it is written to do: every run must miss it. */
  works?: string;
  /** What the program says when the line fails: every run must say it. */
  error?: RegExp;
  /** The names the row reads that the parent may give (section 2: the values, and the environment). */
  reads?: readonly string[];
  /** The ways it runs; all four of a shell script when not given. */
  ways?: readonly Way[];
  /** The shell that runs a shell script (`sh`: `/bin/sh` and dash; bash when not given). */
  shell?: 'sh';
  /** Other files of the row (relative path: text). */
  files?: Readonly<Record<string, string>>;
  /**
   * The system the Error rests on (section 2), when not every one: `/bin/sh` is dash, the user is not root, or the
   * script is explained for bash 5.2 (the default `bashExplainer.bashVersion`), which runs then only in bash 5.2.
   */
  assumes?: '/bin/sh is dash' | 'the user is not root' | 'bash 5.2';
  /** The level the note has now, where it is not `warning`: an Error since step 1a, an Info case that moves up. */
  level?: 'error' | 'info';
  /** Some run does not fail, as the test checks: why, and the level the note keeps for it. */
  finding?: string;
}

/** The ways of a script whose Error rests on its shebang (section 2: it runs as a program). */
const AS_PROGRAM: readonly Way[] = ['direct', 'file'];

const ROWS: readonly Row[] = [
  // ---- the `failure()` facts
  { id: 'keyword-needs-separator', text: '#!/bin/bash\nif true then echo it-works; fi\n', line: 2, works: 'it-works', level: 'error' },
  { id: 'bracket-missing-close', text: '#!/bin/bash\nif [ -d / ; then echo it-works; fi\n', line: 2, works: 'it-works', level: 'error' },
  { id: 'bracket-close-glued', text: '#!/bin/bash\nif [ -d /]; then echo it-works; fi\n', line: 2, works: 'it-works', level: 'error' },
  { id: 'test-malformed', text: '#!/bin/bash\nif [ 1 -eq ]; then echo it-works; else echo NO; fi\n', line: 2, error: /expected/, level: 'error' },
  { id: 'unset-readonly', text: '#!/bin/bash\nreadonly r=1\nunset r && echo it-works\n', line: 3, works: 'it-works', level: 'error' },
  { id: 'unset-function-and-variable', text: '#!/bin/bash\nx=1\nunset -f -v x && echo it-works\n', line: 3, works: 'it-works', level: 'error' },
  { id: 'bats-tags-invalid', file: 't.bats', text: '# bats test_tags=a,,b\n@test "t" {\n  true\n}\n', line: 1, works: 'ok 1 t', ways: ['bats'], level: 'error' },
  // ---- the pitfalls of the catalog
  { id: 'find-action-refused', text: '#!/bin/bash\nfind . -name script.sh -exec echo it-works {}\n', line: 2, works: 'it-works', level: 'error' },
  { id: 'assign-readonly', text: '#!/bin/bash\nreadonly r=1\nr=2 && echo it-works\n', line: 3, works: 'it-works', level: 'error' },
  { id: 'restricted-refused', text: "#!/bin/bash\nbash -r -c 'cd / && echo it-works'\n", line: 2, works: 'it-works', level: 'error' },
  { id: 'exit-refused', text: '#!/bin/bash\nexit x\n', line: 2, error: /numeric argument required/, level: 'error' },
  { id: 'local-outside-function', text: '#!/bin/bash\nlocal x=1 && echo it-works\n', line: 2, works: 'it-works', ways: AS_PROGRAM },
  { id: 'posix-special-function-name', text: '#!/bin/bash\nset -o posix\nexport() { echo it-works; }\nexport\n', line: 3, works: 'it-works' },
  { id: 'alias-not-expanded-in-script', text: "#!/bin/bash\nalias ok='echo it-works'\nok\n", line: 3, works: 'it-works', ways: AS_PROGRAM },
  { id: 'distro-alias-in-script', text: '#!/bin/bash\nll\n', line: 2, works: 'script.sh', ways: AS_PROGRAM },
  { id: 'extglob-in-same-block', text: '#!/bin/bash\nf() {\n  shopt -s extglob\n  echo !(x)\n}\nf\n', line: 4, works: 'yes-match', files: { 'yes-match': '', x: '' }, ways: AS_PROGRAM },
  { id: 'extglob-turned-off', text: '#!/bin/bash\nshopt -u extglob\necho !(x)\n', line: 3, works: 'yes-match', files: { 'yes-match': '', x: '' } },
  { id: 'extglob-not-in-new-shell', text: "#!/bin/bash\nshopt -s extglob\nbash -c 'echo !(x)'\n", line: 3, works: 'yes-match', files: { 'yes-match': '', x: '' } },
  { id: 'globstar-unsupported', shell: 'sh', text: '#!/bin/sh\nfor f in **/x; do echo "$f"; done\n', line: 2, works: 'd/e/x', files: { 'd/e/x': '' }, assumes: '/bin/sh is dash' },
  { id: 'variable-not-in-remote-shell', text: "#!/bin/bash\nx=it-works\nssh host 'echo $x'\n", line: 3, works: 'it-works', reads: ['x'] },
  { id: 'variable-not-passed-by-wrapper', text: "#!/bin/bash\nexport x=it-works\nenv -i bash -c 'echo \"$x\"'\n", line: 3, works: 'it-works', reads: ['x'] },
  { id: 'variable-not-exported', text: "#!/bin/bash\nunset x\nx=it-works\nbash -c 'echo \"$x\"'\n", line: 4, works: 'it-works', reads: ['x'] },
  { id: 'function-not-in-container', text: '#!/bin/bash\nf() { echo it-works; }\ndocker run img f\n', line: 3, works: 'it-works' },
  { id: 'builtin-or-function-as-program', text: '#!/bin/bash\nf() { echo it-works; }\nsudo f\n', line: 3, works: 'it-works' },
  { id: 'function-not-on-remote', text: '#!/bin/bash\nf() { echo it-works; }\nssh host f\n', line: 3, works: 'it-works' },
  { id: 'function-not-in-new-shell-blocked', text: '#!/bin/bash\nf() { echo it-works; }\nexport -f f\nenv -i bash -c f\n', line: 4, works: 'it-works' },
  { id: 'function-not-in-new-shell', text: '#!/bin/bash\nf() { echo it-works; }\nexport -f f\nsu - -c f\n', line: 4, works: 'it-works' },
  { id: 'function-not-imported', text: '#!/bin/bash\nf() { echo it-works; }\nexport -f f\ndash -c f\n', line: 4, works: 'it-works' },
  { id: 'function-not-in-new-shell-export', text: '#!/bin/bash\nf() { echo it-works; }\nbash -c f\n', line: 3, works: 'it-works' },
  { id: 'wrapper-assignment-expanded-first', text: '#!/bin/bash\nsudo x=it-works bash -c "echo $x"\n', line: 2, works: 'it-works', reads: ['x'] },
  { id: 'prefix-assignment-expanded-first', text: '#!/bin/bash\nx=it-works echo "$x"\n', line: 2, works: 'it-works', reads: ['x'] },
  { id: 'pipeline-subshell-variable', text: '#!/bin/bash\necho it-works | read -r v\necho "[$v]"\n', line: 2, works: '[it-works]', reads: ['v'] },
  { id: 'redirect-by-your-shell', text: '#!/bin/bash\nsudo echo it-works > /etc/explain-bash-error-level.conf\n', line: 2, error: /Permission denied/, assumes: 'the user is not root' },
  { id: 'shebang-refused', text: '#!/bin/bash -e -u\necho it-works\n', line: 1, works: 'it-works', ways: ['direct'] },
  { id: 'shebang-bom', text: '﻿#!/bin/bash\necho it-works\n', line: 1, error: /No such file or directory|not found/ },
  { id: 'bats-test-line-dropped', file: 't.bats', text: 'echo it-works >&3; t() { # @test\n  true\n}\n', line: 1, works: 'it-works', ways: ['bats'] },
  { id: 'bats-negation-ignored', file: 't.bats', text: '@test "t" {\n  ! true\n  true\n}\n', line: 2, works: 'not ok 1', ways: ['bats'] },
  { id: 'bats-run-in-pipeline-stage', file: 't.bats', text: '@test "t" {\n  echo it-works | run cat\n  echo "[$output]" >&3\n}\n', line: 2, works: '[it-works]', ways: ['bats'] },
  { id: 'bats-run-in-pipeline', file: 't.bats', text: '@test "t" {\n  run echo it-works | cat\n  echo "[$output]" >&3\n}\n', line: 2, works: '[it-works]', ways: ['bats'] },
  { id: 'bats-setup-suite-in-test-file', file: 't.bats', text: 'setup_suite() { echo it-works >&3; }\n@test "t" {\n  true\n}\n', line: 1, works: 'it-works', ways: ['bats'] },
  { id: 'regex-backslash-dropped', text: '#!/bin/bash\n[[ a1 =~ ^a\\d$ ]] && echo it-works\n', line: 2, works: 'it-works' },
  { id: 'python-string-without-shell', code: 'pythonNoShell', file: 'run.py', text: 'import subprocess\nsubprocess.run("echo it-works")\n', line: 2, works: 'it-works', error: /FileNotFoundError/, ways: ['python'] },
  { id: 'nounset-unbound', text: '#!/bin/bash\nset -u\nunset x\necho "[$x]" it-works\n', line: 4, works: 'it-works', reads: ['x'] },
  // (Only the command fails, and the script goes on: an Info case that moves up.)
  { id: 'nounset-unbound', text: '#!/bin/bash\nset -u\nunset f\ncat < "$f" && echo it-works\n', line: 4, works: 'it-works', reads: ['f'], level: 'info' },
  { id: 'postfix-increment-status', text: '#!/bin/bash\nset -e\ni=0\n((i++))\necho it-works\n', line: 4, works: 'it-works', reads: ['i'] },
  { id: 'postfix-decrement-status', text: '#!/bin/bash\nset -e\ni=0\n((i--))\necho it-works\n', line: 4, works: 'it-works', reads: ['i'] },
  // ---- the style checks
  { id: 'bracket-no-space', text: '#!/bin/bash\nif [-d / ]; then echo it-works; fi\n', line: 2, works: 'it-works' },
  { id: 'assignment-with-spaces', text: '#!/bin/bash\nx = it-works\necho "[$x]"\n', line: 2, works: '[it-works]', reads: ['x'] },
  { id: 'brace-no-space', text: '#!/bin/bash\n{echo it-works; }\n', line: 2, works: 'it-works' },
  { id: 'brace-close-no-separator', text: '#!/bin/bash\n{ echo it-works }\n', line: 2, works: 'it-works' },
  // (`[ a > b ]` is meant false; bash tests `[ a ]`, true, and writes the file `b`.)
  { id: 'redirect-in-bracket', text: '#!/bin/bash\nif [ a > b ]; then echo true; else echo false-as-meant; fi\n', line: 2, works: 'false-as-meant' },
  { id: 'and-or-in-bracket', text: '#!/bin/bash\n[ -d / && -d / ] && echo it-works\n', line: 2, works: 'it-works' },
  { id: 'bracket-close-in-word', text: '#!/bin/bash\nx=a\n[ -n "$x"] && echo it-works\n', line: 3, works: 'it-works' },
  // ---- dialect issues and other problems
  { id: 'unsupported', code: 'dbracket', shell: 'sh', text: '#!/bin/sh\n[[ -d / ]] && echo it-works\n', line: 2, works: 'it-works', assumes: '/bin/sh is dash', level: 'error' },
  { id: 'unsupported', code: 'funsub', text: '#!/bin/bash\necho "${ echo it-works; }"\n', line: 2, works: 'it-works', assumes: 'bash 5.2', level: 'error' },
  { id: 'crlf', text: '#!/bin/bash\r\nif true; then echo it-works; fi\r\n', line: 1, works: 'it-works', ways: ['direct'], level: 'error' },
  // (A CR on the `#!` line alone: run as a program, the interpreter's name ends with a CR.)
  { id: 'crlf', text: '#!/bin/bash\r\necho it-works\r\n', line: 1, works: 'it-works', ways: ['direct'], level: 'error' },
  // (A `#!` line that ends in LF, and CRLF after it: the program runs, with a CR at the end of its output.)
  {
    id: 'crlf', text: '#!/bin/bash\necho it-works\r\n', line: 2, works: 'it-works',
    finding: 'a file whose `#!` line ends in LF, with no keyword before a CR, runs in every way (`echo it-works\\r` prints `it-works` and a CR): a warning (review of #549)',
  },
  // (With no shebang, a keyword before a CR fails however the file runs: `fi\r` is no keyword.)
  { id: 'crlf', text: 'if true; then echo it-works\r\nfi\r\n', line: 1, works: 'it-works', level: 'error' },
  // (A CR where a command starts, on a blank line or after `;`, `&&` or `&`, is a command of its own, `$'\r'`, which is
  // not found, however the file runs: with no shebang, and with a `#!` line that ends in LF. A file with no shebang run
  // as a program is run by the caller's /bin/sh here, which says `\r: not found`.)
  ...['', '#!/bin/bash\n'].flatMap((shebang): Row[] => {
    const error = /\$'\\r': command not found|: \r: not found/;
    const line = shebang ? 2 : 1;
    return [
      { id: 'crlf', text: `${shebang}echo it;\r\n`, line, error, level: 'error' },
      { id: 'crlf', text: `${shebang}echo it &&\r\n`, line, error, level: 'error' },
      { id: 'crlf', text: `${shebang}echo it\r\n\r\n`, line, error, level: 'error' },
    ];
  }),
  // (With no shebang and no keyword before a CR, bash runs each line with a CR at the end of its last word.)
  {
    id: 'crlf', text: 'echo it-works\r\n', line: 1, works: 'it-works',
    finding: 'a file with no shebang and no keyword before a CR runs (`bash file` prints `it-works` and a CR): a warning there, an error only with a shebang or a keyword before a CR (step 1a)',
  },
];

/** The ids section 3 of docs/design/three-levels.md puts at Error (or at Error in some cases), and the `failure()` facts it left out. */
const HEADED_FOR_ERROR: readonly string[] = [
  'keyword-needs-separator', 'bracket-missing-close', 'bracket-close-glued', 'test-malformed', 'find-action-refused', 'unset-readonly',
  'unset-function-and-variable', 'local-outside-function', 'posix-special-function-name', 'alias-not-expanded-in-script',
  'distro-alias-in-script', 'extglob-in-same-block', 'extglob-turned-off', 'extglob-not-in-new-shell', 'globstar-unsupported',
  'variable-not-in-remote-shell', 'variable-not-passed-by-wrapper', 'variable-not-exported', 'function-not-in-container',
  'builtin-or-function-as-program', 'function-not-on-remote', 'function-not-in-new-shell-blocked', 'function-not-in-new-shell',
  'function-not-imported', 'function-not-in-new-shell-export', 'wrapper-assignment-expanded-first', 'prefix-assignment-expanded-first',
  'pipeline-subshell-variable', 'redirect-by-your-shell', 'shebang-refused', 'shebang-bom', 'bats-tags-invalid', 'bats-test-line-dropped',
  'bats-negation-ignored', 'bats-run-in-pipeline-stage', 'bats-run-in-pipeline', 'bats-setup-suite-in-test-file', 'regex-backslash-dropped',
  'python-string-without-shell', 'nounset-unbound', 'postfix-increment-status', 'postfix-decrement-status',
  'assign-readonly', 'restricted-refused', 'exit-refused',
  'bracket-no-space', 'assignment-with-spaces', 'brace-no-space', 'brace-close-no-separator', 'redirect-in-bracket', 'and-or-in-bracket',
  'bracket-close-in-word', 'unsupported', 'crlf',
];

/**
 * The stand-ins: each runs the command where the real one would, as far as the variables and functions go: in `env -i`,
 * with the names sudo keeps (sudoers(5)) and those it sets. None of them asks for a password or reaches a network.
 */
const STUBS: Readonly<Record<string, string>> = {
  // ssh HOST COMMAND…: the remote shell reads the words joined.
  ssh: '#!/bin/bash\nshift\nexec env -i PATH=/usr/bin:/bin bash -c "$*"\n',
  // docker run [OPTIONS] IMAGE COMMAND…
  docker: '#!/bin/bash\nshift\nwhile [[ $1 == -* ]]; do shift; done\nshift\nexec env -i PATH=/usr/bin:/bin "$@"\n',
  // sudo [NAME=VALUE…] COMMAND…: env reads the assignments as sudo does.
  sudo: '#!/bin/bash\nkeep=()\nfor v in TERM TZ LANG LC_ALL; do [[ -v $v ]] && keep+=("$v=${!v}"); done\nexec env -i "${keep[@]}" PATH=/usr/bin:/bin HOME=/root USER=root LOGNAME=root "$@"\n',
  // su - -c COMMAND: a login shell's fresh environment, with TERM.
  su: '#!/bin/bash\nwhile [[ $1 != -c ]]; do shift; done\nexec env -i ${TERM+TERM="$TERM"} PATH=/usr/bin:/bin bash -c "$2"\n',
};

/**
 * A `.bashrc` with what Debian's and Ubuntu's give a new user (/etc/skel/.bashrc): its aliases, and what the
 * bash-completion it loads turns on (`shopt -s extglob progcomp`, /usr/share/bash-completion/bash_completion).
 */
const BASHRC = "alias ll='ls -alF'\nalias la='ls -A'\nalias l='ls -CF'\nshopt -s extglob progcomp\n";

/** The values each name of `reads` takes, all at once: unset, then exported from the parent. */
const VALUES: readonly (string | undefined)[] = [undefined, '', 'a b', '*', 'x'];

const BATS = path.join(__dirname, '..', 'node_modules', 'bats', 'bin', 'bats');
const has = (program: string): boolean => spawnSync('sh', ['-c', `command -v ${program}`]).status === 0;
const programs = { dash: has('dash'), python3: has('python3'), bats: fs.existsSync(BATS), timeout: has('timeout') };
const root = typeof process.getuid === 'function' && process.getuid() === 0;
const BASH53 = process.env.BASH_EXPLAINER_BASH53;

/** `s` quoted for bash. */
const q = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/** The file name of a row. */
const fileOf = (r: Row): string => r.file ?? 'script.sh';

/** The command of one way of running the row's file, from the directory it is in. */
function command(r: Row, way: Way, bash: string): string[] {
  const file = fileOf(r);
  const shell = r.shell === 'sh' ? 'dash' : bash;
  switch (way) {
    case 'direct': return [`./${file}`];
    case 'file': return [r.shell === 'sh' ? 'sh' : bash, file];
    case 'function': return [shell, '-c', `f() { . ./${file}; }; f`];
    // (bash reads the stand-in `.bashrc` itself, and no system file: `--norc`. dash reads none without `ENV`.)
    case 'interactive': return shell === 'dash' ? [shell, '-i', '-c', `. ./${file}`] : [shell, '--norc', '-i', '-c', `. ~/.bashrc; . ./${file}`];
    case 'bats': return [BATS, '--tap', file];
    case 'python': return ['python3', file];
  }
}

/** One run: the way, the values given, and what came out. */
interface Run { way: string; env: string; stdout: string; stderr: string; status: string }

/** Runs every way and every value of the row, in one contained bash, each run in a fresh copy of the row's files. */
async function runRow(r: Row, dir: string): Promise<Run[]> {
  const base = path.join(dir, 'base');
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'home', '.bashrc'), BASHRC);
  for (const [name, text] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, 'bin', name), text, { mode: 0o755 });
  for (const [name, text] of Object.entries({ ...r.files, [fileOf(r)]: r.text })) {
    fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
    fs.writeFileSync(path.join(base, name), text, { mode: name === fileOf(r) ? 0o755 : 0o644 });
  }
  const ways = (r.ways ?? ['direct', 'file', 'function', 'interactive']).filter((w) => w !== 'direct' || !r.text.startsWith('#!/bin/sh') || programs.dash);
  const bashes = BASH53 && !r.shell && r.assumes !== 'bash 5.2' && ways.some((w) => w === 'file' || w === 'function' || w === 'interactive') ? ['bash', BASH53] : ['bash'];
  const runs: Omit<Run, 'stdout' | 'stderr' | 'status'>[] = [];
  const lines = ['cd "$1" || exit 1'];
  for (const bash of bashes) {
    for (const way of ways) {
      if (bash !== 'bash' && !['file', 'function', 'interactive'].includes(way)) continue;
      for (const value of r.reads ? VALUES : [undefined]) {
        const k = runs.length;
        const env = [`PATH=${path.join(dir, 'bin')}:/usr/bin:/bin`, `HOME=${path.join(dir, 'home')}`, 'LC_ALL=C', 'FUNCNEST=50', 'TERM=dumb',
          ...(value === undefined ? [] : (r.reads ?? []).map((n) => `${n}=${value}`))];
        runs.push({ way: bash === 'bash' ? way : `${way} (bash 5.3)`, env: value === undefined ? 'unset' : JSON.stringify(value) });
        lines.push(`rm -rf w; cp -a base w; (cd w && exec env -i ${env.map(q).join(' ')} timeout 10 ${command(r, way, bash).map(q).join(' ')}) >o.${k} 2>e.${k} </dev/null; echo $? >s.${k}`);
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'runs.sh'), `${lines.join('\n')}\n`);
  const done = await runContained(['bash', '--norc', '--noprofile', path.join(dir, 'runs.sh'), dir], dir, {}, 60000);
  assert.strictEqual(done.status, 0, done.stderr);
  return runs.map((run, k) => ({
    ...run, stdout: fs.readFileSync(path.join(dir, `o.${k}`), 'utf8'), stderr: fs.readFileSync(path.join(dir, `e.${k}`), 'utf8'), status: fs.readFileSync(path.join(dir, `s.${k}`), 'utf8').trim(),
  }));
}

/** Whether a run failed as the row says: it misses what the line is written to do, or the program says the error. */
const failed = (r: Row, run: Run): boolean => (r.works === undefined || !run.stdout.includes(r.works)) && (r.error === undefined || r.error.test(run.stderr));

/** Why a row cannot run here, if so. */
function unrunnable(r: Row): string | undefined {
  if (!programs.timeout) return 'no timeout program';
  if (r.shell === 'sh' && !programs.dash) return 'no dash';
  if (r.ways?.includes('bats') && !programs.bats) return 'no bats';
  if (r.ways?.includes('python') && !programs.python3) return 'no python3';
  if (r.assumes === 'the user is not root' && root) return 'run as root';
  if (r.assumes === '/bin/sh is dash' && !fs.realpathSync('/bin/sh').endsWith('/dash')) return '/bin/sh is not dash';
  return undefined;
}

describe('the checks headed for Error, run in bash (three-levels.md, step 0)', function () {
  this.timeout(120000);
  const parser = createUnbashParser();
  let dir: string;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-error-level-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('has a row for every id headed for Error, and each is one the catalog, the style checks or the problems have', () => {
    assert.deepStrictEqual([...new Set(ROWS.map((r) => r.id))].sort(), [...HEADED_FOR_ERROR].sort());
    for (const id of HEADED_FOR_ERROR) assert.ok(id in MESSAGES || id in STYLE_LEVELS || ['unsupported', 'crlf'].includes(id), id);
  });

  // A finding of this test, fixed: the note is a caveat where a run works.
  it('distro-alias-in-script in a file with no shebang: a caveat, as an interactive shell that reads it has the alias', async function () {
    const r: Row = { id: 'distro-alias-in-script', text: 'll\n', line: 1, works: 'script.sh' };
    const doc = openDocument(r.text, 'shell', (t) => parser.parse(t));
    const issue = documentIssues(doc, 'en', shellsOf(doc.lines, 'script.sh', undefined)).find((x) => x.code === r.id);
    assert.strictEqual(issue?.severity, 'info');
    assert.match(issue.message, /But this file has no shebang: read by an interactive shell, as `\.bashrc` is, it may have it/);
    if (unrunnable(r)) return this.skip();
    fs.mkdirSync(path.join(dir, 'distro'));
    const runs = await runRow(r, path.join(dir, 'distro'));
    assert.deepStrictEqual(runs.filter((run) => !failed(r, run)).map((run) => run.way), ['interactive', ...(BASH53 ? ['interactive (bash 5.3)'] : [])]);
  });

  // The same for `shopt -s extglob` in the block of its glob: an interactive shell that reads the file often has
  // extglob on already (bash-completion turns it on).
  it('extglob-in-same-block in a file with no shebang: a caveat, as an interactive shell that reads it often has extglob on', async function () {
    const r: Row = { id: 'extglob-in-same-block', text: 'f() {\n  shopt -s extglob\n  echo !(x)\n}\nf\n', line: 3, works: 'yes-match', files: { 'yes-match': '', x: '' } };
    const doc = openDocument(r.text, 'shell', (t) => parser.parse(t));
    const issue = documentIssues(doc, 'en', shellsOf(doc.lines, 'script.sh', undefined)).find((x) => x.code === r.id);
    assert.strictEqual(issue?.severity, 'info');
    assert.match(issue.message, /But this file has no shebang: read by an interactive shell, as `\.bashrc` is, `extglob` is often on already/);
    if (unrunnable(r)) return this.skip();
    fs.mkdirSync(path.join(dir, 'extglob'));
    const runs = await runRow(r, path.join(dir, 'extglob'));
    assert.deepStrictEqual(runs.filter((run) => !failed(r, run)).map((run) => run.way), ['interactive', ...(BASH53 ? ['interactive (bash 5.3)'] : [])]);
  });

  // A new shell started with `-i` reads `~/.bashrc` first (here the stand-in, and the system's own `/etc/bash.bashrc`,
  // which this test cannot leave out): it has the distribution's aliases, and often `extglob` on. A caveat, and every
  // way runs the line.
  for (const r of [
    { id: 'extglob-not-in-new-shell', text: "#!/bin/bash\nbash -i -c 'echo !(x)'\n", line: 2, works: 'yes-match', files: { 'yes-match': '', x: '' } },
    { id: 'distro-alias-in-script', text: '#!/bin/bash\nbash -i -c ll\n', line: 2, works: 'script.sh' },
  ] as Row[]) {
    it(`${r.id} in \`bash -i -c\`: a caveat, as the interactive shell reads .bashrc first`, async function () {
      const doc = openDocument(r.text, 'shell', (t) => parser.parse(t));
      const issue = documentIssues(doc, 'en', shellsOf(doc.lines, 'script.sh', undefined)).find((x) => x.code === r.id && x.startLine === r.line - 1);
      assert.strictEqual(issue?.severity, 'info');
      assert.match(issue.message, /But this shell is interactive \(`-i`\) and reads `\.bashrc` first: /);
      if (unrunnable(r)) return this.skip();
      fs.mkdirSync(path.join(dir, `interactive-${r.id}`));
      const runs = await runRow(r, path.join(dir, `interactive-${r.id}`));
      assert.deepStrictEqual(runs.filter((run) => !failed(r, run)).map((run) => run.way), runs.map((run) => run.way));
    });
  }

  // Where `.bashrc` is not read, `ll` is "command not found" in every run (a warning), and where the file's own shebang says
  // `-i`, it is read before the script (a caveat). `bash --norc` reads none, `--rcfile F` reads F instead (a file the
  // explainer cannot read: still a warning), and a `bash -c` that `#!/bin/bash -i` starts is not interactive.
  for (const [what, r, caveat] of [
    ['`bash --norc -i -c`: no .bashrc', { id: 'distro-alias-in-script', text: '#!/bin/bash\nbash --norc -i -c ll\n', line: 2, works: 'script.sh', ways: ['direct', 'file', 'function'] }, false],
    ['`bash --rcfile F -i -c`: F instead of .bashrc, which cannot be read', { id: 'distro-alias-in-script', text: '#!/bin/bash\nbash --rcfile rc -i -c ll\n', line: 2, works: 'script.sh', ways: ['direct', 'file', 'function'] }, false],
    ["`#!/bin/bash -i`'s `bash -c`: not interactive", { id: 'distro-alias-in-script', text: '#!/bin/bash -i\nbash -c ll\n', line: 2, works: 'script.sh', ways: ['direct'] }, false],
    ['`#!/bin/bash -i`: the file runs as an interactive shell, which reads .bashrc first', { id: 'distro-alias-in-script', text: '#!/bin/bash -i\nll\n', line: 2, works: 'script.sh', ways: ['direct'] }, true],
    ['`#!/usr/bin/env -S bash --norc -i`: no .bashrc', { id: 'distro-alias-in-script', text: '#!/usr/bin/env -S bash --norc -i\nll\n', line: 2, works: 'script.sh', ways: ['direct'] }, false],
  ] as [string, Row, boolean][]) {
    it(`${r.id} in ${what}`, async function () {
      const doc = openDocument(r.text, 'shell', (t) => parser.parse(t));
      const issue = documentIssues(doc, 'en', shellsOf(doc.lines, 'script.sh', undefined)).find((x) => x.code === r.id && x.startLine === r.line - 1);
      assert.strictEqual(issue?.severity, caveat ? 'info' : 'warning');
      assert.strictEqual(/But this shell is interactive \(`-i`\) and reads `\.bashrc` first: /.test(issue.message), caveat);
      if (unrunnable(r)) return this.skip();
      const at = path.join(dir, `rc-${what.replace(/\W+/g, '-')}`);
      fs.mkdirSync(at);
      const runs = await runRow(r, at);
      assert.ok(runs.length > 0);
      assert.deepStrictEqual(runs.filter((run) => !failed(r, run)).map((run) => run.way), caveat ? runs.map((run) => run.way) : []);
    });
  }

  // A `}` that ends a parameter expansion (or a quote, or the `)` of an array) before a CR is a word's, no reserved word:
  // bash runs the line, with a CR at the end of the word, in every way. A warning, not the error of a keyword before a CR.
  for (const text of ['a=it-works\r\necho ${a}\r\n', 'b=it-works\r\nx=${b}\r\necho "$x"\r\n', 'a=it-works\r\necho "${a}"\r\n', '#!/bin/bash\na=it-works\r\narr=(${a})\r\necho "${arr[0]}"\r\n']) {
    // (An array needs bash: the file with no shebang run as a program is run by /bin/sh here.)
    it(`crlf: ${JSON.stringify(text.replace(/^#!.*\n/, '').split('\r\n')[1])} at a CRLF line end runs: a warning`, async function () {
      const r: Row = { id: 'crlf', text, line: 1, works: 'it-works' };
      const doc = openDocument(r.text, 'shell', (t) => parser.parse(t));
      const issue = documentIssues(doc, 'en', shellsOf(doc.lines, 'script.sh', undefined)).find((x) => x.code === 'crlf');
      assert.strictEqual(issue?.severity, 'warning');
      if (unrunnable(r)) return this.skip();
      const at = path.join(dir, `crlf-word-${text.length}-${text.charCodeAt(text.length - 4)}`);
      fs.mkdirSync(at);
      const runs = await runRow(r, at);
      assert.ok(runs.length > 0);
      assert.deepStrictEqual(runs.filter((run) => failed(r, run)).map((run) => `${run.way}: ${JSON.stringify(run.stderr.slice(-200))}`), []);
    });
  }

  ROWS.forEach((r, i) => {
    it(`${r.id}${r.code ? ` (${r.code})` : ''}: ${JSON.stringify(r.text.split('\n')[r.line - 1].replace(/^﻿/, '').replace(/\r$/, ''))}`, async function () {
      // Our side: the explanation says it there, at its level.
      const file = fileOf(r);
      const doc = openDocument(r.text, hostKind('', file, r.text) ?? 'shell', (t) => parser.parse(t));
      const issue = documentIssues(doc, 'en', shellsOf(doc.lines, file, undefined)).find((x) => x.code === (r.code ?? r.id) && x.startLine === r.line - 1);
      assert.ok(issue, `${r.code ?? r.id} is not said on line ${r.line}`);
      assert.strictEqual(issue.severity, r.level ?? 'warning');
      // bash's side: every run fails.
      const why = unrunnable(r);
      if (why) return this.skip();
      const at = path.join(dir, `row${i}`);
      fs.mkdirSync(at);
      const runs = await runRow(r, at);
      assert.ok(runs.length > 0);
      const working = runs.filter((run) => !failed(r, run));
      if (r.finding) {
        assert.ok(working.length > 0, `the finding no longer holds: ${r.finding}`);
        return;
      }
      assert.deepStrictEqual(working.map((run) => `${run.way}, ${run.env}: status ${run.status}, ${JSON.stringify(run.stdout.slice(-200))} ${JSON.stringify(run.stderr.slice(-200))}`), []);
    });
  });
});
