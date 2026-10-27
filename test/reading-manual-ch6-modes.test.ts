// The reading tree and the explanation against chapter 6 of the Bash Reference Manual (bash 5.2): the directory stack
// (6.8), the prompt strings (6.9), POSIX mode (6.11) and the compatibility levels (6.12), each checked with bash 5.2
// and 5.3 (`$BASH_EXPLAINER_BASH53`).
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { builtins, shellOptions, shoptOptions } from '../src/dict/builtins';
import { variableLanguages } from '../src/dict/syntax';
import { explainPrompt, PROMPT_ESCAPES } from '../src/embedded/prompt';
import { OPTION_SECTIONS } from '../src/manual';
import { readingNodes, type ReadingNode } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { type BashOptions, runBash } from './support/bash';

const parser = createUnbashParser();
const analyzer = new Analyzer('en');
const explain = (src: string, line = 0) => analyzer.explainLine(parser.parse(src), line, 'bash', { reading: true });
const nodes = (src: string, line = 0): ReadingNode[] => readingNodes(explain(src, line).reading!);
/** The first node with this label (and layer, and kind). */
const find = (src: string, label: string, layer = 'bash', kind?: string, line = 0): ReadingNode =>
  nodes(src, line).find((n) => n.layer === layer && n.label === label && (!kind || n.kind === kind))!;
const programs: BashOptions[] = [{}, ...(process.env.BASH_EXPLAINER_BASH53 ? [{ program: process.env.BASH_EXPLAINER_BASH53 }] : [])];
const each = (f: (p: BashOptions, who: string) => void): void => programs.forEach((p) => f(p, p.program ?? 'bash'));

describe('the reading tree as the Bash manual reads chapter 6 (6.8, 6.9, 6.11, 6.12)', function () {
  this.timeout(30000);

  it('reads the tilde prefixes of the directory stack (6.8, 3.5.2), as bash expands them', () => {
    const src = 'echo ~+1 ~-1 ~2 ~0 x=~+1';
    assert.strictEqual(find(src, '~+1', 'bash', 'argument').text, 'Tilde expansion: `~+1` becomes entry 1 of the directory stack, counted from the left of `dirs` from 0 (what `dirs +1` shows; unchanged if there is no such entry)');
    assert.match(find(src, '~-1', 'bash', 'argument').text!, /entry 1 of the directory stack, counted from the right of `dirs` from 0 \(what `dirs -1` shows;/);
    assert.match(find(src, '~2', 'bash', 'argument').text!, /entry 2 of the directory stack, counted from the left/);
    assert.match(find(src, '~0', 'bash', 'argument').text!, /: entry 0 is the current directory;/);
    for (const w of ['~+1', '~-1', '~2', '~0', 'x=~+1']) assert.deepStrictEqual(find(src, w, 'bash', 'argument').refs, ['3.7.1', '3.5.2', '6.8'], w);
    // (A prefix that is no number nor a name is none of them: `~1x` stays as it is, unexplained.)
    assert.deepStrictEqual(find('echo ~1x', '~1x', 'bash', 'argument').refs, ['3.7.1', '3.5.2']);
    each((p, who) => {
      const b = runBash('cd /tmp; pushd /usr >/dev/null; pushd /var >/dev/null; echo ~+ ~- ~+1 ~-1 ~1 ~0 ~+5 ~1x x=~+1', p);
      assert.strictEqual(b.stdout, '/var /usr /usr /usr /usr /var ~+5 ~1x x=/usr\n', who);
    });
  });

  it('says that `pushd` alone exchanges the top two entries, and that `pushd` and `popd` print the stack (6.8.1)', () => {
    assert.match(find('pushd', 'pushd', 'bash', 'commandName').text!, /^Push a directory onto the stack and cd to it \(with no argument, exchange the top two entries\); on success, print the stack as `dirs` does/);
    assert.match(find('popd', 'popd', 'bash', 'commandName').text!, /^Remove the top of the directory stack and cd to the new top; on success, print the stack as `dirs` does/);
    each((p, who) => {
      const b = runBash('cd /tmp; pushd; echo "st $?"; pushd /usr; pushd; echo "$PWD"; popd; echo "$PWD"; popd; echo "st $?"', p);
      assert.strictEqual(b.stdout, 'st 1\n/usr /tmp\n/tmp /usr\n/tmp\n/usr\n/usr\nst 1\n', who);
      assert.match(b.stderr, /pushd: no other directory\n.*popd: directory stack empty\n$/s, who);
    });
  });

  it('reads the value of a prompt string as bash decodes and expands it (6.9)', () => {
    assert.deepStrictEqual(Object.keys(variableLanguages).sort(), ['PS0', 'PS1', 'PS2', 'PS4']);
    const src = "PS1='\\u@\\h:\\w\\$ '";
    const lang = nodes(src).find((n) => n.layer === 'language' && n.kind === 'language')!;
    assert.deepStrictEqual([lang.label, lang.reader], ['prompt', 'bash']);
    assert.deepStrictEqual(lang.children.map((c) => `${c.label} ${c.text}`), ['u', 'h', 'w', '$'].map((k) => `\\${k} ${PROMPT_ESCAPES[k][1]}`));
    assert.match(find(src, "'\\u@\\h:\\w\\$ '", 'bash', 'quote').text!, / — A prompt string: each time bash prints it, it replaces the backslash escapes, then expands the result as in double quotes/);
    // The expansions bash does when it prints it (why the value is single-quoted), and an escape in double quotes.
    const ps4 = nodes("PS4='+ ${BASH_SOURCE}:${LINENO}: '").filter((n) => n.layer === 'language' && n.kind !== 'language');
    assert.deepStrictEqual(ps4.map((n) => n.label), ['${BASH_SOURCE}', '${LINENO}']);
    assert.match(ps4[1].text!, /^parameter expansion, done each time bash prints the prompt \(not when the value is assigned\)$/);
    const dq = nodes('export PS1="\\[\\e[1;32m\\]\\u\\[\\e[0m\\] \\D{%H:%M} $ "').find((n) => n.kind === 'language')!.children;
    assert.deepStrictEqual(dq.map((n) => n.label), ['\\[', '\\e[1;32m', '\\]', '\\u', '\\[', '\\e[0m', '\\]', '\\D{%H:%M}']);
    assert.match(dq[1].text!, /ANSI escape sequence: bold, green/);
    // (Not a value known before it runs, nor `PS3`, which `select` prints as it is.)
    assert.ok(!nodes('PS1="$USER \\u"').some((n) => n.layer === 'language'));
    assert.ok(!nodes("PS3='\\u> '").some((n) => n.layer === 'language'));
    // Octal: three digits (fewer only at the end), else the backslash stays; an unknown escape stays.
    const of = (text: string) => explainPrompt(text, 'en').map((t) => `${text.slice(t.start, t.end)} ${t.kind}`);
    assert.deepStrictEqual(of('\\101\\033x\\60x\\q\\1'), ['\\101 operator', '\\033 operator', '\\60 string', '\\q string', '\\1 operator']);
    assert.deepStrictEqual(of('\\033[0m $(git branch) `id -u` $((1+2)) $? $ \\D{%Y'), ['\\033[0m operator', '$(git branch) substitution', '`id -u` substitution', '$((1+2)) expansion', '$? variable', '\\D{%Y operator']);
    // (Unclosed, nothing is said of an expansion; `\e` with no `[` after it is ESC alone; a last backslash stays.)
    assert.deepStrictEqual(of('$(a ${b `c $((d \\e\\D{}${x:-(y)}$'), ['\\e operator', '\\D{} operator', '${x:-(y)} variable']);
    assert.deepStrictEqual(of('x\\'), []);
    assert.match(explainPrompt('\\D{}', 'ja')[0].explanation, /ロケールに応じた今の時刻/);
    // (An element or an array is not a prompt string.)
    assert.ok(!nodes("PS1[0]='\\u'; PS2=('\\u')").some((n) => n.layer === 'language'));
    each((p, who) => {
      // The escapes bash decodes (`promptvars` off, so that nothing is expanded after): the table's, `\D{…}` and octal.
      const chars = [...Array(94)].map((_, i) => String.fromCharCode(33 + i)).filter((c) => !/[0-7'"`]/.test(c));
      const script = `shopt -u promptvars; for c in ${chars.map((c) => `'${c}'`).join(' ')}; do x="\\\\$c"; [ "\${x@P}" = "$x" ] || printf '%s ' "$c"; done`;
      assert.deepStrictEqual(runBash(script, p).stdout.trim().split(' ').sort(), Object.keys(PROMPT_ESCAPES).sort(), who);
      // What some become, and the expansions after them.
      const b = runBash("HOME=/tmp; cd /tmp; x='[\\w|\\W|\\s|\\101|\\60x|\\q|\\D{%Y}|\\[\\]|\\\\|$(echo hi)|$((1+2))|\"q\"]'; echo \"${x@P}\"; shopt -u promptvars; x='$HOME'; echo \"${x@P}\"", p);
      assert.match(b.stdout, /^\[~\|~\|bash\|A\|\\60x\|\\q\|\d{4}\|\|\\\|hi\|3\|"q"\]\n\$HOME\n$/, who);
      // `\$`: `#` for root, else `$`.
      assert.strictEqual(runBash("x='\\$'; echo \"${x@P}\" $(id -u)", p).stdout, process.getuid?.() === 0 ? '# 0\n' : `$ ${process.getuid?.()}\n`, who);
    });
  });

  it('follows POSIX mode where it changes what a builtin or an expansion does (6.11)', () => {
    const posix = (line: string) => `set -o posix\n${line}`;
    // `kill -SIGTERM`: a name with `SIG` is refused.
    assert.match(find(posix('kill -SIGTERM 1'), '-SIGTERM', 'command', undefined, 1).text!, /^In POSIX mode bash refuses a signal name that starts with `SIG`: it says `SIGTERM: invalid signal specification`, and fails with status 1, sending nothing. Write `-TERM`$/);
    assert.match(find(posix('kill -s SIGTERM 1'), 'kill', 'bash', 'commandName', 1).text!, /\. In POSIX mode, it refuses a signal name that starts with `SIG` \(`-SIGTERM`, `-s SIGTERM`\)$/);
    assert.match(find('kill -SIGTERM 1', '-SIGTERM', 'command').text!, /^Send the signal `TERM`/);
    // `echo` with `xpg_echo`: escapes by default; in POSIX mode, no options.
    assert.strictEqual(find(posix('shopt -s xpg_echo; echo -n "a\\tb"'), '-n', 'command', undefined, 1).text, 'text to print');
    assert.match(find(posix('shopt -s xpg_echo; echo -n "a\\tb"'), 'echo', 'bash', 'commandName', 1).text!, /In POSIX mode with `xpg_echo` on, it takes no options/);
    assert.strictEqual(find('shopt -s xpg_echo; echo -E "a\\tb"', '-E', 'command').text, 'do not interpret escapes');
    assert.strictEqual(find('echo -n "a"', '-n', 'command').text, 'do not print the trailing newline');
    // `ulimit -f` and `-c`: blocks of 512 bytes.
    assert.match(find(posix('ulimit -f 1'), 'ulimit', 'bash', 'commandName', 1).text!, /In POSIX mode, the sizes of `-c` and `-f` .* count blocks of 512 bytes/);
    assert.doesNotMatch(find('ulimit -f 1', 'ulimit', 'bash', 'commandName').text!, /POSIX/);
    // `${!#}`: no indirection.
    assert.strictEqual(find(posix('echo "${!#}"'), '${!#}', 'bash', 'expansion', 1).text, 'In POSIX mode bash applies no indirection to `#`: `${!#}` expands to nothing (`${@: -1}` gives the last argument)');
    assert.deepStrictEqual(find(posix('echo "${!#}"'), '${!#}', 'bash', 'expansion', 1).refs, ['3.5.3', '6.11']);
    assert.match(find('[ "$1" ] && set -o posix; echo "${!#}"', '${!#}', 'bash', 'expansion').text!, /But in POSIX mode, on on some paths here, it expands to nothing$/);
    // `trap INT`: a usage error, which ends the shell; `trap 2` still resets.
    assert.match(find(posix('trap INT'), 'INT', 'command', undefined, 1).text!, /^In POSIX mode bash does not read a lone word as a signal to reset unless it is a number: this is a usage error \(status 2\)/);
    assert.match(find(posix('trap 2'), '2', 'command', undefined, 1).text!, /^signal to reset to its default/);
    // `. file`: a file not found ends the shell. `time` alone: the shell's times.
    assert.match(find(posix('. ./lib.sh'), '.', 'bash', 'commandName', 1).text!, /\. In POSIX mode, a file it does not find ends the shell \(status 1\)$/);
    assert.match(find(posix('time'), 'time', 'bash', 'keyword', 1).text!, /^`time` with no pipeline: in POSIX mode, it prints the user and system time/);
    assert.match(find('time', 'time', 'bash', 'keyword').text!, /^`time` with no pipeline: it times nothing, and prints zero times/);
    // (Only bash's builtins: another shell's `kill` and `time` are its own.)
    const sh = analyzer.explainLine(parser.parse('set -o posix\nkill -SIGTERM 1; time'), 1, 'sh', { reading: true }).reading!;
    assert.doesNotMatch(readingNodes(sh).map((n) => n.text ?? '').join('\n'), /In POSIX mode, it refuses|: in POSIX mode, it prints/);
    each((p, who) => {
      const run = (script: string, o: BashOptions = {}) => runBash(script, { ...p, ...o });
      let b = run('set -o posix; kill -SIGTERM $$; echo "a $?"; kill -s SIGTERM $$; echo "b $?"');
      assert.deepStrictEqual([b.stdout, (b.stderr.match(/invalid signal specification/g) ?? []).length], ['a 1\nb 1\n', 2], who);
      b = run('set -o posix; shopt -s xpg_echo; echo -n "a\\tb"; echo -e x; set +o posix; echo -n "c\\td"; echo; echo -E "e\\tf"');
      assert.strictEqual(b.stdout, '-n a\tb\n-e x\nc\td\ne\\tf\n', who);
      b = run('(ulimit -f 1; head -c 1000 /dev/zero > f1; wc -c < f1); (set -o posix; ulimit -f 1; head -c 1000 /dev/zero > f2; wc -c < f2)', { files: [] });
      assert.strictEqual(b.stdout.replace(/ /g, ''), '1000\n512\n', who);
      b = run('set -- a b c; echo "[${!#}]"; set -o posix; echo "[${!#}]"');
      assert.strictEqual(b.stdout, '[c]\n[]\n', who);
      b = run("trap 'echo x' INT; trap INT; trap -p INT; echo next; set -o posix; trap 'echo x' INT; trap 2; trap -p INT; trap INT; echo after");
      assert.deepStrictEqual([b.stdout, b.status], ['next\ntrap -- - INT\n', 2], who);
      b = run('. ./none.sh; echo "go on $?"; set -o posix; . ./none.sh; echo after', { files: [] });
      assert.deepStrictEqual([b.stdout, b.status], ['go on 1\n', 1], who);
      assert.match(run('time').stderr, /real/, who);
      assert.doesNotMatch(run('set -o posix; time').stderr, /real/, who);
      assert.match(run('set -o posix; time').stderr, /user/, who);
    });
  });

  it('says that there is one compatibility level at a time (6.12), as bash does', () => {
    for (const w of ['compat31', 'compat44']) {
      const n = find('shopt -s compat31 compat44', w, 'command', 'argument');
      assert.match(n.text!, /There is one level at a time: turning it on turns the other `compat` options off \(and sets `BASH_COMPAT`\)$/, w);
      assert.deepStrictEqual(n.refs, ['6.12'], w);
    }
    assert.match(find('BASH_COMPAT=50', 'BASH_COMPAT=50', 'bash', 'assignment').text!, /`50` and `51` have no `shopt` option\)\. There is one level at a time$/);
    each((p, who) => {
      const b = runBash('shopt -s compat31 compat44; shopt compat31 compat44; BASH_COMPAT=42; shopt compat42 compat44; BASH_COMPAT=50; BASH_COMPAT=51; shopt -s compat50', p);
      assert.deepStrictEqual(b.stdout.split('\n').map((l) => l.replace(/\s+/g, ' ')), ['compat31 off', 'compat44 on', 'compat42 on', 'compat44 off', ''], who);
      assert.match(b.stderr, /^[^\n]*shopt: compat50: invalid shell option name\n$/, who);
      // What the levels the texts name do: `=~` (31), quote removal (42), loops in functions (43) and subshells (44).
      const c = runBash("shopt -s compat31; [[ abc =~ \"a.c\" ]] && echo 31; x=abc; shopt -s compat42; echo \"${x/b/'q'}\"; f() { break; }; shopt -s compat43; for i in 1 2; do echo $i; f; done; shopt -s compat44; for i in 1 2; do (break; echo in); done", p);
      assert.strictEqual(c.stdout, "31\na'q'c\n1\n", who);
    });
  });

  it('cites the section of chapter 6 that describes a shell option named as a value or an operand', () => {
    for (const name of Object.keys(OPTION_SECTIONS)) assert.ok(Object.hasOwn(shellOptions, name) || Object.hasOwn(shoptOptions, name), name);
    const refs = (src: string, w: string) => find(src, w, 'command').refs;
    assert.deepStrictEqual(refs('set -o posix', 'posix'), ['6.11']);
    assert.deepStrictEqual(refs('set +o posix', 'posix'), ['6.11']);
    assert.deepStrictEqual(refs('shopt -s compat42', 'compat42'), ['6.12']);
    assert.deepStrictEqual(refs('shopt restricted_shell', 'restricted_shell'), ['6.10']);
    assert.deepStrictEqual(refs('shopt -s expand_aliases', 'expand_aliases'), ['6.6']);
    assert.deepStrictEqual(refs('shopt -u promptvars', 'promptvars'), ['6.9']);
    assert.deepStrictEqual(refs('shopt -so posix', 'posix'), ['6.11']);
    assert.deepStrictEqual(refs('bash -O compat31 x', 'compat31'), ['6.12']);
    // (Not the others, which 4.3.1 and 4.3.2 describe, nor a word of another command.)
    assert.strictEqual(refs('set -o pipefail', 'pipefail'), undefined);
    assert.strictEqual(refs('echo posix', 'posix'), undefined);
    // The variables whose effect a section of chapter 6 describes cite it after their own.
    assert.deepStrictEqual(find('BASH_COMPAT=42', 'BASH_COMPAT', 'bash', 'name').refs, ['5.2', '6.12']);
    assert.deepStrictEqual(find('POSIXLY_CORRECT=1', 'POSIXLY_CORRECT', 'bash', 'name').refs, ['5.2', '6.11']);
    assert.deepStrictEqual(find("PS4='+ '", 'PS4', 'bash', 'name').refs, ['5.2', '6.9']);
    // (`set -o posix` also sets `POSIXLY_CORRECT`, as it says.)
    assert.match(find('set -o posix', 'posix', 'command').text!, /it also sets `POSIXLY_CORRECT`$/);
    each((p, who) => assert.strictEqual(runBash('set -o posix; echo "[${POSIXLY_CORRECT-unset}]"', p).stdout, '[y]\n', who));
    // (The builtins whose words POSIX mode or `xpg_echo` changes say so only there: `kill`, `echo`, `ulimit`, `trap`, `.`, `source`.)
    assert.deepStrictEqual(Object.keys(builtins).filter((n) => builtins[n].inShell).sort(), ['.', 'echo', 'kill', 'source', 'trap', 'ulimit']);
  });
});
