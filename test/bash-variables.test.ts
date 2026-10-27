// The catalog of the variables bash sets (src/semantics/vars.ts) against bash: the variables a script starts with,
// their attributes, and what bash does with each kind (dynamic, numeric, readonly, set by a builtin).
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { alwaysNumeric, assignmentIgnored, assignsArithmetic, BASH_VARIABLES, changedByBash, changedUnseen, DYNAMIC_SINCE_53, readonlyAtStart, setAtStart, unsetEndsSpecial } from '../src/semantics/vars';

const [BASH, ENV] = execFileSync('bash', ['-c', 'type -P bash env']).toString().trim().split('\n');
const names = Object.keys(BASH_VARIABLES);
const where = (p: (name: string) => boolean): string[] => names.filter(p);

/** The output of `script` run as a file by `bash --norc --noprofile`, with an empty environment (`env -i`: Node adds NODE_V8_COVERAGE to `env: {}` under c8). */
function cleanRun(script: string, bash = BASH): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-variables-'));
  try {
    const file = path.join(dir, 'script');
    fs.writeFileSync(file, script);
    return execFileSync(ENV, ['-i', bash, '--norc', '--noprofile', file], { cwd: dir }).toString();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the variables bash sets (src/semantics/vars.ts)', () => {
  it('lists the variables a script starts with, with their attributes, as `compgen -v` and `declare -p` show them in a clean bash', () => {
    const out = cleanRun('for v in $(compgen -v); do d=$(declare -p "$v"); set -- $d; echo "$v $2"; done\n');
    const got = Object.fromEntries(out.trim().split('\n').map((l) => l.split(' ')));
    const want = Object.fromEntries(where(setAtStart).map((n) => [n, BASH_VARIABLES[n].start]));
    assert.deepStrictEqual(got, want);
  });

  it('has every variable of the manual\'s two lists (bash 5.2, from the bash-doc package when it is there)', function () {
    const doc = '/usr/share/doc/bash/bashref.html';
    if (!fs.existsSync(doc)) this.skip();
    const html = fs.readFileSync(doc, 'utf8');
    const listed: string[] = [];
    for (const id of ['Bourne-Shell-Variables', 'Bash-Variables']) {
      const start = html.indexOf(`id="${id}"`);
      const section = html.slice(start, html.indexOf('<hr>', start + 10));
      for (const m of section.matchAll(/<dt[^>]*>.*?<code[^>]*>([A-Za-z_0-9]+)<\/code>/g)) listed.push(m[1]);
    }
    assert.ok(listed.length > 100);
    // (Besides the manual's: TERM, which bash sets at start, COPROC_PID, the PID of the coprocess COPROC, bash 5.3's
    // GLOBSORT, BASH_MONOSECONDS and BASH_TRAPSIG, and the variables of `$"…"` (3.1.2.5).)
    assert.deepStrictEqual(names.filter((n) => !listed.includes(n)), ['COPROC_PID', 'TERM', 'GLOBSORT', 'BASH_MONOSECONDS', 'BASH_TRAPSIG', 'TEXTDOMAIN', 'TEXTDOMAINDIR']);
    assert.deepStrictEqual(listed.filter((n) => !names.includes(n)), []);
  });

  it('marks readonly, numeric and dynamic variables as bash treats an assignment to them', () => {
    // Each is assigned text in a function (FUNCNAME, BASH_SOURCE… are set there), then read. (`eval`: an assignment to a
    // readonly variable discards the rest of the line.)
    // (Not those that only bash 5.3 changes: this is bash 5.2.)
    const tried = where((n) => (changedByBash(n) || alwaysNumeric(n)) && !DYNAMIC_SINCE_53.has(n));
    const script = `f() {\n${tried.map((v) => `  eval ${v}=zz 2>/dev/null; s=$?; r=("\${${v}[@]}"); echo "${v} $s \${r[*]}"`).join('\n')}\n}\nf\n`;
    const rows = cleanRun(script).trim().split('\n').map((l) => /^(\w+) (\d+) ?(.*)$/.exec(l)!);
    assert.deepStrictEqual(rows.map((r) => r[1]), tried);
    for (const [, name, status, value] of rows) {
      // A readonly variable keeps bash's value; the assignment fails.
      assert.strictEqual(status !== '0', readonlyAtStart(name), `${name}: status ${status}`);
      // A dynamic one does not keep the text assigned (BASH_CMDS does, but it changes as commands run: below).
      if (name !== 'BASH_CMDS') assert.notStrictEqual(value, 'zz', name);
      // A numeric one stays numbers.
      if (alwaysNumeric(name)) assert.match(value, /^(\d+( \d+)*)?$/, name);
    }
    assert.strictEqual(cleanRun('BASH_CMDS=(); cat </dev/null; echo ${#BASH_CMDS[@]}\n').trim(), '1');
    // Which of them read the text assigned as arithmetic (`x=5` sets x).
    const ints = where((n) => /i/.test(BASH_VARIABLES[n].start ?? '') && !readonlyAtStart(n));
    const out = cleanRun(ints.map((v) => `x=1; ${v}='x=5'; echo $x`).join('\n') + '\n');
    assert.deepStrictEqual(out.trim().split('\n'), ints.map((v) => (assignsArithmetic(v) ? '5' : '1')));
    assert.ok(names.filter(assignsArithmetic).every((v) => ints.includes(v)));
  });

  it('marks the variables builtins and constructs set without naming them', () => {
    const script = [
      'read <<< r1; echo "REPLY $REPLY"',
      'mapfile <<< m1; echo "MAPFILE ${MAPFILE[*]}"',
      'getopts a: o -a v; echo "OPTARG $OPTARG"; echo "OPTIND $OPTIND"',
      '[[ ab =~ a(b) ]]; echo "BASH_REMATCH ${BASH_REMATCH[1]}"',
      'cd /; echo "PWD $PWD"; echo "OLDPWD ${OLDPWD:+set}"',
      'alias q=x; echo "BASH_ALIASES ${BASH_ALIASES[q]}"',
      'coproc { :; }; echo "COPROC ${COPROC_PID:+set}"; wait',
    ].join('\n');
    const out = cleanRun(`${script}\n`);
    assert.strictEqual(out, 'REPLY r1\nMAPFILE m1\n\nOPTARG v\nOPTIND 3\nBASH_REMATCH b\nPWD /\nOLDPWD set\nBASH_ALIASES x\nCOPROC set\n');
    for (const n of ['REPLY', 'MAPFILE', 'OPTARG', 'OPTIND', 'BASH_REMATCH', 'PWD', 'OLDPWD', 'BASH_ALIASES', 'COPROC', 'COPROC_PID']) assert.ok(changedUnseen(n), n);
    // (What bash sets only at start, a script that assigns it keeps: `SHLVL=3` stays 3.)
    for (const n of ['SHLVL', 'HOSTNAME', 'BASH_VERSION', 'BASH_ARGV0', 'OPTERR', 'IFS', 'PATH']) assert.ok(!changedUnseen(n), n);
    assert.strictEqual(cleanRun('SHLVL=3 HOSTNAME=h BASH_VERSION=v BASH_ARGV0=a OPTERR=0; echo $SHLVL $HOSTNAME $BASH_VERSION $BASH_ARGV0 $OPTERR\n'), '3 h v a 0\n');
  });

  it('marks the variables whose assignment bash ignores, and those that unset loses their special behaviour (5.2)', () => {
    // Assigned 7 in a function (FUNCNAME is set there) and read on the next lines: bash keeps its own value. (In
    // bash 5.2 and 5.3.)
    const ignored = where(assignmentIgnored);
    assert.deepStrictEqual(ignored, ['BASHPID', 'BASH_COMMAND', 'EPOCHREALTIME', 'EPOCHSECONDS', 'FUNCNAME', 'GROUPS', 'HISTCMD', 'LINENO', 'SRANDOM']);
    const bashes = [BASH, ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])];
    const read = (v: string) => `  x=\${${v}}\n  echo "${v} $x"`;
    for (const bash of bashes) {
      const kept = cleanRun(`f() {\n${ignored.map((v) => `  ${v}=7\n${read(v)}`).join('\n')}\n}\nf\n`, bash).trim().split('\n');
      assert.deepStrictEqual(kept.filter((l) => l.endsWith(' 7')), [], bash);
      // Unset, each of the manual's list is a plain variable: set again, it keeps what is assigned (in a subshell too).
      const plain = where(unsetEndsSpecial).filter((v) => v !== 'COMP_WORDBREAKS');
      const out = cleanRun(`f() {\n${plain.map((v) => `  unset ${v}; ${v}=7\n  (echo "${v} \${${v}}")`).join('\n')}\n}\nf\n`, bash);
      assert.deepStrictEqual(out.trim().split('\n'), plain.map((v) => `${v} 7`), bash);
    }
    // (COMP_WORDBREAKS is Readline's, which a script has no use of; the manual lists it.)
    assert.ok(unsetEndsSpecial('COMP_WORDBREAKS'));
    // What the special behaviour was, for those whose value also stays when assigned: `SECONDS` counts, `BASH_ARGV0`
    // sets `$0`, `BASH_ALIASES` and `BASH_CMDS` define aliases and remembered commands, `BASH_SUBSHELL` counts subshells.
    // (Bash counts whole seconds of the clock from the assignment: 1.1 s later, `SECONDS` is 8, or 9 when it was set
    // late in a second. A plain variable stays 7.)
    const out = cleanRun('SECONDS=7; unset BASH_ARGV0 BASH_ALIASES BASH_CMDS BASH_SUBSHELL; BASH_ARGV0=x; BASH_ALIASES[ll]=y; BASH_CMDS[zz]=/bin/echo; BASH_SUBSHELL=0\n'
      + 'sleep 1.1; echo "$SECONDS $0"; alias ll 2>&1 | grep -c "not found"; hash -t zz 2>&1 | grep -c "not found"; (echo $BASH_SUBSHELL)\n').replace(/ \S*script\n/, ' script\n');
    assert.match(out, /^[89] script\n1\n1\n0\n$/);
  });
});
