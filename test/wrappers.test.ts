import * as assert from 'assert';
import { spawnSync } from 'child_process';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, LineExplanation, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

// Commands that run other commands: which word is the command, what `bash -c` numbers its arguments,
// and the pitfalls of starting a program from a shell (functions, builtins, early expansion).

let parser: Parser;
before(async () => {
  parser = createUnbashParser();
});

const explain = (src: string, lang: 'en' | 'ja' = 'en', line = 0): LineExplanation => new Analyzer(lang).explainLine(parser.parse(src), line);
const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
/** The explanation of the token labelled `label`, without its trailing detail. */
const about = (src: string, label: string, lang: 'en' | 'ja' = 'en'): string => {
  const t = all(explain(src, lang).items).find((x) => x.label === label);
  assert.ok(t, `no token ${label} in ${src}`);
  return t.explanation;
};
const notes = (src: string, lang: 'en' | 'ja' = 'en', line = 0): string[] => explain(src, lang, line).notes.filter((n) => /落とし穴|Pitfall/.test(n));
const bash = (code: string): { out: string; status: number } => {
  const r = spawnSync('bash', ['--norc', '-c', code], { encoding: 'utf8', timeout: 10000 });
  return { out: r.stdout + r.stderr, status: r.status ?? -1 };
};
const hasBash = spawnSync('bash', ['--version']).status === 0;

describe('the arguments of a shell run with -c', () => {
  for (const shell of ['bash', 'sh', 'dash', 'zsh', 'ksh']) {
    it(`${shell} -c: the first word after the string is $0, the next is $1`, () => {
      const src = `${shell} -c 'echo $1' a b`;
      assert.match(about(src, 'a'), /^Becomes `\$0`/);
      assert.match(about(src, 'b'), /^Positional parameter `\$1` of the command string/);
      assert.match(about(src, 'a', 'ja'), /^`\$0` になる名前/);
      assert.match(about(src, 'b', 'ja'), /^コマンド文字列の位置パラメータ `\$1`/);
    });
  }
  it('also in combined options and after -o', () => {
    assert.match(about("bash -xc 'echo $1' a b", 'b'), /`\$1`/);
    assert.match(about("sh -ec 'echo $1' a b", 'a'), /\$0/);
    assert.match(about("bash -o pipefail -c 'echo $1' a b", 'a'), /\$0/);
  });
  it('without -c, the first word is the script and the rest are its arguments', () => {
    assert.strictEqual(about('bash script.sh a b', 'script.sh'), 'Script to run');
    assert.strictEqual(about('bash script.sh a b', 'a'), 'Argument to the script (`$1`)');
    assert.strictEqual(about('bash script.sh a b', 'b', 'ja'), 'スクリプトへの引数（`$2`）');
    assert.strictEqual(about('bash script.sh a b', 'script.sh', 'ja'), '実行するスクリプト');
    assert.strictEqual(about('bash -- script.sh a', 'script.sh'), 'Script to run');
  });
  (hasBash ? it : it.skip)('agrees with bash: $0 is the first word, $1 the second', () => {
    assert.strictEqual(bash(`bash -c 'echo "$0|$1"' a b`).out, 'a|b\n');
  });
});

describe('the command a wrapper runs', () => {
  const ran = (src: string, name: string, lang: 'en' | 'ja' = 'en') => about(src, name, lang);
  it('kubectl exec, run and debug: the command follows --', () => {
    assert.match(ran('kubectl exec pod -- ls -la', 'ls'), /^`ls` runs: |^runs `ls`/);
    assert.strictEqual(about('kubectl exec pod -- ls -la', 'pod'), 'pod');
    assert.match(ran('kubectl run x --image=i -- cmd arg', 'cmd'), /runs `cmd`/);
    assert.match(ran('kubectl debug pod -it --image=busybox -- sh', 'sh'), /runs `sh`/);
    assert.match(ran('kubectl exec pod -- ls -la', 'ls', 'ja'), /^`ls` を実行: /);
    assert.strictEqual(about('kubectl run x --image=i -- cmd', 'x'), 'pod name');
  });
  it('docker, podman and compose: the command follows the image or service', () => {
    assert.match(ran('docker run -it --rm image cmd args', 'cmd'), /runs `cmd`/);
    assert.strictEqual(about('docker run image cmd', 'image'), 'image');
    assert.match(ran('docker exec -it ctr cmd args', 'cmd'), /runs `cmd`/);
    assert.strictEqual(about('docker exec ctr cmd', 'ctr'), 'container');
    assert.match(ran('docker compose run --rm svc cmd args', 'cmd'), /runs `cmd`/);
    assert.match(ran('docker compose exec svc cmd', 'cmd'), /runs `cmd`/);
    assert.strictEqual(about('docker compose run svc cmd', 'svc'), 'service');
    assert.match(ran('podman run image cmd', 'cmd'), /runs `cmd`/);
    assert.match(ran('docker exec -it -e A=1 -w /x -u root ctr cmd', 'cmd'), /runs `cmd`/);
  });
  it('timeout, chroot and flock skip their own operand', () => {
    assert.strictEqual(about('timeout 5 ls', '5'), 'time limit (`5`, `30s`, `2m`, `1h`)');
    assert.match(ran('timeout 5 ls', 'ls'), /runs `ls`/);
    assert.match(ran('chroot /new cmd arg', 'cmd'), /runs `cmd`/);
    assert.match(ran('flock /tmp/l cmd arg', 'cmd'), /runs `cmd`/);
    assert.match(about("flock -n /tmp/l -c 'cmd'", "'cmd'"), /^Value for `-c`/);
  });
  it('env, sudo and doas: NAME=value words are assignments, not the command', () => {
    assert.match(about('env -i A=1 cmd arg', 'A=1'), /^Sets the variable `A`/);
    assert.match(about('env -i A=1 cmd arg', 'A=1', 'ja'), /^環境変数 `A` の設定/);
    assert.match(ran('env -i A=1 cmd arg', 'cmd'), /runs `cmd`/);
    assert.match(about('sudo FOO=1 cmd', 'FOO=1'), /Sets the variable `FOO`/);
    assert.match(about('doas -u u FOO=1 cmd', 'FOO=1'), /Sets the variable `FOO`/);
    assert.match(ran('doas -u u cmd', 'cmd'), /runs `cmd`/);
    assert.match(about('doas -u u cmd', 'doas'), /Run a command as another user/);
  });
  it('an assignment may hold an expansion; ssh may end its options with --; su -c needs a value', () => {
    assert.match(about('env A=$x cmd', 'A=$x'), /^Sets the variable `A`/);
    assert.match(notes('f() { :; }\nssh -- host f', 'en', 1)[0], /function `f`/);
    assert.deepStrictEqual(notes('f() { :; }\nsu -c', 'en', 1), []);
    assert.match(notes('find . -ok myfunc {} \\;\nmyfunc() { :; }')[0], /`find -ok` starts `myfunc`/);
  });
  it('uv run and poetry run run the command', () => {
    assert.match(ran('timeout -k 5 10 sleep 1', 'sleep'), /runs `sleep`/);
    assert.match(ran('timeout 5 sleep 10', 'sleep'), /runs `sleep`/);
    assert.strictEqual(about('timeout 5 sleep 10', '5', 'ja'), '制限時間（`5`、`30s`、`2m`、`1h`）');
    assert.match(ran('uv run pytest -x', 'pytest'), /runs `pytest`/);
    assert.match(ran('poetry run pytest -x', 'pytest'), /runs `pytest`/);
  });
  it('timeout: every option, also as a unique prefix; command -v: names, not a command', () => {
    assert.strictEqual(about('timeout --preserve-status 5 ls', '--preserve-status'), 'exit with the status of the command, also on timeout (not 124)');
    assert.match(about('timeout --foreground 5 ls', '--foreground', 'ja'), /^コマンドを前面で動かす/);
    assert.strictEqual(about('timeout --sig KILL 5 ls', '--sig'), 'signal to send on timeout');
    assert.strictEqual(about('timeout --sig KILL 5 ls', 'KILL'), 'Value for `--sig`');
    assert.strictEqual(about('nice --adj 3 ls', '3'), 'Value for `--adj`');
    assert.strictEqual(about('command -v git', 'git'), 'name to look up');
    assert.strictEqual(about('command -V ls cd', 'cd', 'ja'), '調べる名前');
    assert.strictEqual(explain('command -v git').items[0].children.find((t) => t.label === 'git')?.kind, 'argument');
    assert.match(ran('command -p ls -l', 'ls'), /runs `ls`/);
  });
  it('su: a lone dash is the login option', () => {
    assert.strictEqual(about('su - user', '-'), 'as a login shell (fresh environment)');
    assert.match(about('su - user', '-', 'ja'), /^ログインシェルとして/);
    assert.strictEqual(about('su - user', 'user'), 'user name');
  });
  it('still explains the others', () => {
    for (const src of ['nice -n 5 cmd', 'ionice -c3 cmd', 'stdbuf -oL cmd', 'setsid cmd', 'strace -f cmd', 'watch -n 2 -x cmd', 'exec cmd', 'nohup cmd &']) {
      assert.match(ran(src, 'cmd') || ran(src, 'pkg'), /runs `/, src);
    }
    // (Without -x, watch joins the words for `sh -c`: they are the text of the command.)
    assert.strictEqual(about('watch -n 2 cmd', 'cmd'), 'command to run');
    assert.match(ran('sudo -u u cmd arg', 'cmd'), /runs `cmd`/);
    assert.match(ran('command ls -la', 'ls'), /runs `ls`/);
    assert.match(ran('find . -exec ls {} +', 'ls'), /runs `ls`/);
    assert.match(about('ssh -p 22 user@host cmd arg', 'cmd arg'), /^remote command \(the words, joined with spaces, are read as a script\)/);
  });
});

describe('a wrapper cannot run a shell function or builtin', () => {
  const FN = 'myfunc() { echo x; }\n';
  const at = (src: string, line: number, lang: 'en' | 'ja' = 'en') => notes(src, lang, line);
  it('a function defined in the script', () => {
    for (const [src, who] of [
      ['echo a | xargs myfunc', 'xargs'], ['doas myfunc', 'doas'], ['env myfunc', 'env'], ['nohup myfunc', 'nohup'],
      ['timeout 5 myfunc', 'timeout'], ['nice myfunc', 'nice'], ['find . -exec myfunc {} \;', 'find -exec'], ['find . -exec myfunc {} +', 'find -exec'], ['chroot /r myfunc', 'chroot'],
      ['flock /l myfunc', 'flock'], ['setsid myfunc', 'setsid'], ['watch -x myfunc', 'watch'], ['strace myfunc', 'strace'], ['stdbuf -oL myfunc', 'stdbuf'], ['ionice -c3 myfunc', 'ionice'],
    ]) {
      const n = at(FN + src, 1);
      assert.strictEqual(n.length, 1, src);
      assert.match(n[0], new RegExp(`^⚠ Pitfall: \`${who}\` starts \`myfunc\` as a separate program, so it cannot run a shell function`), src);
      assert.match(n[0], /export -f myfunc`, then call it through a shell: `bash -c 'myfunc "\$@"' _ …`/);
    }
  });
  it('a function defined later is still not run by the wrapper', () => {
    assert.strictEqual(at('sudo myfunc\n' + FN, 0).length, 1);
  });
  it('a builtin that only affects the shell', () => {
    for (const b of ['cd /x', 'export A=1', 'source f.sh', '. f.sh', 'alias a=b', 'set -e', 'shopt -s nullglob', 'read x', 'ulimit -n 1', 'umask 022', 'exit 1', 'unset A', 'eval x', 'command -v x']) {
      const n = at('sudo ' + b, 0);
      assert.strictEqual(n.length, 1, b);
      assert.match(n[0], /^⚠ Pitfall: `sudo` starts `\S+` as a separate program, so it cannot run a shell builtin/, b);
    }
    assert.match(at('sudo cd /root', 0)[0], /Use a subshell `\(cd … && …\)`, or `sudo sh -c 'cd … && …'`/);
    assert.match(at('timeout 5 cd /tmp', 0)[0], /^⚠ Pitfall: `timeout` starts `cd`/);
    assert.match(at('xargs export', 0)[0], /`xargs sh -c 'export …'`/);
  });
  it('is explained as what it would run, in sudo and timeout alike', () => {
    assert.match(about('sudo cd /root', 'cd'), /runs `cd`: /);
    assert.match(about('timeout 5 cd /tmp', 'cd'), /runs `cd`: /);
    assert.strictEqual(explain('timeout 5 cd /tmp').items[0].children.find((t) => t.label === 'cd')?.kind, 'builtin');
    // A builtin with a program of its name: the program runs (coreutils echo, procps kill), as it does at a path.
    for (const [src, label] of [['env echo hi', 'echo'], ['sudo kill -9 1', 'kill'], ['exec test -f x', 'test']]) {
      const t = all(explain(src).items).find((x) => x.label === label)!;
      assert.strictEqual(t.kind, 'command', src);
      assert.match(t.explanation, /the (coreutils|procps) program/, src);
    }
    assert.strictEqual(explain('/bin/kill -s TERM 1').items[0].kind, 'command');
    assert.match(explain('/bin/kill -s TERM 1').items[0].explanation, /procps/);
    assert.strictEqual(explain('/bin/cd /tmp').items[0].explanation, 'Run the program or script at `/bin/cd`');
  });
  it('says nothing for builtins that are programs too, and for the keyword time', () => {
    for (const src of ['sudo echo hi', 'sudo printf x', 'sudo test -f x', 'sudo [ -f x ]', 'sudo kill 1', 'sudo pwd', 'sudo true', 'sudo false', 'sudo ls', 'time cd /x', 'time myfunc', 'command cd /x', 'builtin cd /x', 'eval myfunc', 'eval cd /x']) {
      assert.deepStrictEqual(at(FN + src, 1), [], src);
    }
    assert.deepStrictEqual(at('sudo myfunc', 0), [], 'a name that is no function');
    assert.deepStrictEqual(at(FN + 'sudo "myfunc"', 1).length, 0, 'a quoted word is not looked up');
  });
  it('speaks Japanese', () => {
    assert.strictEqual(at(FN + 'echo a | xargs myfunc', 1, 'ja')[0],
      '⚠ 落とし穴: `xargs` は `myfunc` を別のプログラムとして起動するため、シェルの関数は実行できません（`command not found` になるか、今のシェルには効きません）。`export -f myfunc` してから `bash -c \'myfunc "$@"\' _ …` のようにシェル経由で呼びます');
    assert.match(at('sudo cd /root', 0, 'ja')[0], /^⚠ 落とし穴: `sudo` は `cd` を別のプログラムとして起動するため、シェルの組み込みコマンドは実行できません.*サブシェル `\(cd … && …\)` か、`sudo sh -c 'cd … && …'` を使います$/);
  });
  it('can be turned off with the pitfalls setting', () => {
    const src = 'sudo cd /root\nssh h $HOME\nsu -c x\nf() { :; }\nssh h f';
    for (const line of [0, 1, 4]) assert.deepStrictEqual(new Analyzer('en').explainLine(parser.parse(src), line, undefined, { pitfalls: false }).notes.filter((n) => /Pitfall/.test(n)), []);
  });
  it('nice -N is the old way to write nice -n N', () => {
    assert.match(about('nice -10 make', '-10'), /^niceness adjustment 10 \(old way to write `-n 10`/);
    assert.match(about('nice -10 make', '-10', 'ja'), /^優先度の調整値 10/);
    assert.match(about('nice -10 make', 'make'), /runs `make`/);
  });
  (hasBash ? it : it.skip)('agrees with bash: xargs cannot run a function, a builtin or cd', () => {
    const f = bash('f(){ echo x; }; echo a | xargs f');
    assert.notStrictEqual(f.status, 0);
    assert.match(f.out, /No such file or directory/);
    const c = bash('echo a | xargs cd /');
    assert.notStrictEqual(c.status, 0);
    assert.strictEqual(bash('export -f 2>/dev/null; f(){ echo x; }; export -f f; echo a | xargs bash -c \'f "$@"\' _').out, 'x\n');
    assert.strictEqual(bash('echo a | xargs echo').out, 'a\n');
  });
  (hasBash && spawnSync('sudo', ['-n', 'true']).status === 0 ? it : it.skip)('agrees with sudo: it cannot run cd', () => {
    assert.notStrictEqual(bash('sudo -n cd /').status, 0);
  });
});

describe('the pitfalls follow from how the command is run', () => {
  const FN = 'myfunc() { echo x; }\n';
  const at = (src: string, lang: 'en' | 'ja' = 'en') => notes(FN + src, lang, 1);
  it('exec and the other wrappers that start a program: no function, no builtin without a program', () => {
    for (const [src, who] of [['exec myfunc', 'exec'], ['npx myfunc', 'npx'], ['uv run myfunc', 'uv run'], ['poetry run myfunc', 'poetry run'], ['systemd-cat myfunc', 'systemd-cat'], ['/usr/bin/time myfunc', 'time']]) {
      assert.match(at(src)[0], new RegExp(`^⚠ Pitfall: \`${who}\` starts \`myfunc\` as a separate program, so it cannot run a shell function`), src);
    }
    assert.match(at('exec cd /x')[0], /^⚠ Pitfall: `exec` starts `cd` as a separate program, so it cannot run a shell builtin/);
    // Builtins that no program has the name of.
    for (const src of ['env disown', 'xargs :', 'sudo help', 'nohup times']) assert.match(at(src)[0], /cannot run a shell builtin/, src);
  });
  it('in a container: the function is not there', () => {
    for (const [src, who] of [['docker run img myfunc', 'docker run'], ['docker exec ctr myfunc', 'docker exec'], ['docker compose run svc myfunc', 'docker compose run'], ['podman run img myfunc', 'podman run'], ['kubectl exec pod -- myfunc', 'kubectl exec']]) {
      const n = at(src);
      assert.strictEqual(n.length, 1, src);
      assert.strictEqual(n[0], `⚠ Pitfall: \`${who}\` runs \`myfunc\` inside the container, and a function from this script is not available in the container. Write out its body instead`);
    }
    assert.strictEqual(at('docker run img myfunc', 'ja')[0], '⚠ 落とし穴: `docker run` は `myfunc` をコンテナの中で実行します。このスクリプトの関数はコンテナの中にはないので使えません。関数の中身を直接書きます');
    // Builtins depend on the image: nothing is said.
    assert.deepStrictEqual(at('docker run img cd /x'), []);
  });
  it('a new shell: the function is not there, unless bash gets it exported', () => {
    for (const [src, who] of [["bash -c 'myfunc a'", 'bash -c'], ["sh -c 'myfunc'", 'sh -c'], ["bash -xc 'myfunc'", 'bash -c'], ["flock /l -c 'myfunc'", 'flock -c'], ["flock /l --command 'myfunc'", 'flock -c']]) {
      const n = at(src);
      assert.strictEqual(n.length, 1, src);
      assert.strictEqual(n[0], `⚠ Pitfall: \`${who}\` runs the command in a new shell, which does not have this script's function \`myfunc\`. Write out its body, or pass the function with \`export -f myfunc\` first (only when the new shell is bash)`, src);
    }
    assert.strictEqual(at("bash -c 'myfunc'", 'ja')[0], '⚠ 落とし穴: `bash -c` は新しいシェルでコマンドを実行するため、このスクリプトの関数 `myfunc` は使えません。関数の中身を直接書くか、先に `export -f myfunc` で関数を渡します（新しいシェルが bash のときだけ）');
    for (const src of ["export -f myfunc; bash -c 'myfunc'", "declare -fx myfunc; bash -c 'myfunc'", "export -f other myfunc; find . -exec bash -c 'myfunc \"$1\"' _ {} \\;", "bash -c 'cd /x'", "bash -c \"$cmd\"", "bash -c 'ls'"]) {
      assert.deepStrictEqual(at(src), [], src);
    }
  });
  it('a wrapper that passes no exported functions: export -f does not help', () => {
    // env -i and `env -` clear the environment; sudo's policy removes the values that start with `()` (the
    // functions bash exports), with -E too (sudoers(5): env_reset, and `*=()*` in env_delete).
    for (const [src, blocker] of [["env -i bash -c 'myfunc'", 'env'], ['env - bash -c myfunc', 'env'], ['sudo bash -c myfunc', 'sudo'], ['sudo -E bash -c myfunc', 'sudo'], ['export -f myfunc; sudo -u bob bash -c myfunc', 'sudo'], ['env -i timeout 5 bash -c myfunc', 'env']]) {
      assert.deepStrictEqual(at(src), [`⚠ Pitfall: \`bash -c\` runs the command in a new shell, which does not have this script's function \`myfunc\`, and \`${blocker}\` passes no exported functions, so \`export -f myfunc\` does not help either. Write out its body`], src);
    }
    assert.strictEqual(at('sudo bash -c myfunc', 'ja')[0], '⚠ 落とし穴: `bash -c` は新しいシェルでコマンドを実行するため、このスクリプトの関数 `myfunc` は使えません。`sudo` は環境の関数を渡さないので、`export -f myfunc` も効きません。関数の中身を直接書きます');
    for (const src of ['export -f myfunc; env bash -c myfunc', 'export -f myfunc; env -u X bash -c myfunc', 'export -f myfunc; timeout 5 bash -c myfunc']) assert.deepStrictEqual(at(src), [], src);
    // A function run as a program: the fix sends its definition.
    assert.match(at('sudo myfunc')[0], /^⚠ Pitfall: `sudo` starts `myfunc` as a separate program.*Write out its body, or pass the definition along: `sudo bash -c "\$\(declare -f myfunc\); myfunc"` \(`sudo` passes no exported functions, so `export -f` does not help\)$/);
    assert.match(at('env -i myfunc', 'ja')[0], /`env bash -c "\$\(declare -f myfunc\); myfunc"` のように定義ごと渡します（`env` は環境の関数を渡さないので、`export -f` は効きません）$/);
  });
  it('sudo -s and -i: a shell runs the command, so builtins run, and the function is not there', () => {
    for (const src of ['sudo -i cd /tmp', 'sudo -s cd /tmp', 'sudo --login export A=1', 'sudo -iu bob cd ~']) assert.deepStrictEqual(at(src), [], src);
    assert.strictEqual(all(explain('sudo -i cd /tmp').items).find((t) => t.label === 'cd')?.kind, 'builtin');
    assert.deepStrictEqual(at('sudo -s myfunc'), ["⚠ Pitfall: `sudo` runs the command in a new shell, which does not have this script's function `myfunc`. Write out its body"]);
  });
  it('watch: sh -c runs the words joined, unless -x execs them', () => {
    assert.deepStrictEqual(at('watch cd /x'), []);
    assert.match(at('watch -n 1 myfunc')[0], /^⚠ Pitfall: `watch` runs the command in a new shell, which does not have this script's function `myfunc`/);
    assert.match(at('watch -x cd /x')[0], /^⚠ Pitfall: `watch` starts `cd` as a separate program/);
  });
  it('the current shell: eval, command and builtin run functions and builtins', () => {
    for (const src of ['eval myfunc', "eval 'myfunc a'", 'command cd /x', 'builtin cd /x', 'eval export A=1']) assert.deepStrictEqual(at(src), [], src);
  });
  (hasBash ? it : it.skip)('agrees with bash', () => {
    // exec starts a program: `exec: cd: not found`, `exec: f: not found`.
    assert.strictEqual(bash('exec cd /tmp').status, 127);
    assert.strictEqual(bash('f(){ echo x; }; exec f').status, 127);
    // A builtin with no program of its name: env and xargs cannot run it.
    assert.strictEqual(bash('env disown').status, 127);
    assert.strictEqual(bash('echo a | xargs :').status, 127);
    // bash -c finds a function only when it is exported, and not through `env -i` or `env -`.
    assert.strictEqual(bash("f(){ echo x; }; bash -c f").status, 127);
    assert.strictEqual(bash("f(){ echo x; }; export -f f; env -i bash -c f").status, 127);
    assert.strictEqual(bash("f(){ echo x; }; export -f f; env - bash -c f").status, 127);
    assert.strictEqual(bash("f(){ echo x; }; export -f f; env -u X bash -c f").out, 'x\n');
    assert.strictEqual(bash("f(){ echo x; }; export -f f; bash -c f").out, 'x\n');
    assert.strictEqual(bash("f(){ echo x; }; declare -fx f; bash -c f").out, 'x\n');
    // The current shell runs both.
    assert.strictEqual(bash("f(){ echo x; }; eval f; command cd /tmp && builtin cd / && pwd").out, 'x\n/\n');
  });
});

describe('a variable set by a wrapper is not yet set when its words are expanded', () => {
  it('env, sudo and doas', () => {
    const n = notes('env FOO=1 echo $FOO');
    assert.strictEqual(n.length, 1);
    assert.match(n[0], /^⚠ Pitfall: the current shell expands `\$FOO` before `env` sets `FOO` \(to its present value, or nothing\)/);
    assert.match(notes('env FOO=1 echo $FOO', 'ja')[0], /^⚠ 落とし穴: `\$FOO` は、`env` が `FOO` を設定する前に今のシェルが展開します/);
    assert.match(notes('sudo A=1 B=2 echo "${B:-x}"')[0], /expands `"\$\{B:-x\}"` before `sudo` sets `B`/);
    assert.match(notes('doas A=1 echo $A')[0], /before `doas` sets `A`/);
  });
  it('says nothing when the shell is used or the variable is not read', () => {
    for (const src of ["env FOO=1 sh -c 'echo $FOO'", "env FOO=1 echo '$FOO'", 'env FOO=1 echo $BAR', 'env FOO=1 echo $FOOBAR', 'env FOO=1 cmd', 'env echo $FOO']) assert.deepStrictEqual(notes(src), [], src);
  });
  it('the plain prefix form has the same issue', () => {
    assert.match(notes('FOO=1 echo $FOO')[0], /`FOO=…` is set only in the environment of `echo`; the current shell expands `\$FOO` before that/);
    assert.match(notes('FOO=1 echo "${FOO:-x}"')[0], /expands `"\$\{FOO:-x\}"`/);
    assert.match(notes('FOO=1 echo $FOO', 'ja')[0], /^⚠ 落とし穴: `FOO=…` は `echo` の環境にだけ入ります。`\$FOO` は、その前に今のシェルが展開します/);
    for (const src of ["FOO=1 echo '$FOO'", 'FOO=1 echo $BAR', 'FOO=1', 'FOO=$FOO cmd', "FOO=1 sh -c 'echo $FOO'"]) assert.deepStrictEqual(notes(src), [], src);
  });
  (hasBash ? it : it.skip)('agrees with bash', () => {
    assert.strictEqual(bash('FOO=; env FOO=1 bash -c \'echo "[$FOO]"\'').out, '[1]\n');
    assert.strictEqual(bash('unset FOO; env FOO=1 echo "[$FOO]"').out, '[]\n');
    assert.strictEqual(bash('unset FOO; FOO=1 echo "[$FOO]"').out, '[]\n');
  });
});

describe('the command given to ssh and su -c', () => {
  it('ssh: $var, $(…), globs and ~ are expanded by the local shell', () => {
    for (const w of ['$HOME/*.log', '"$HOME"', '$(date)', '*.log', '~/x', '"a $x"', '${x}']) {
      const n = notes(`ssh host ls ${w}`);
      assert.strictEqual(n.length, 1, w);
      assert.match(n[0], /^⚠ Pitfall: the local shell expands `.*` in the command given to `ssh` before it is sent/, w);
    }
    assert.match(notes('ssh -p 22 -i key host ls $HOME')[0], /expands `\$HOME`/);
    assert.match(notes('ssh host -- ls $HOME')[0], /expands `\$HOME`/);
    assert.match(notes('ssh host ls $HOME/*.log', 'ja')[0], /^⚠ 落とし穴: `ssh` に渡すコマンドのうち `\$HOME\/\*\.log` は、送られる前にこちらのシェルが展開します/);
  });
  it('ssh: nothing for single quotes, plain words, or no command', () => {
    for (const src of ["ssh host 'ls $HOME/*.log'", 'ssh host ls -la', 'ssh host', 'ssh -p 22 host', 'ssh -V', 'ssh $HOST ls', 'ssh host "ls -la"']) assert.deepStrictEqual(notes(src), [], src);
  });
  it('ssh and su -c: the remote shell has no function of this script', () => {
    assert.match(notes('f() { :; }\nssh host f', 'en', 1)[0], /remote shell does not have this script's function `f`.*declare -f f/);
    assert.match(notes('f() { :; }\nssh host f', 'ja', 1)[0], /^⚠ 落とし穴: リモートのシェルには、このスクリプトの関数 `f` はありません/);
    assert.match(notes("f() { :; }\nsu -c 'f arg' root", 'en', 1)[0], /`su -c` runs the command in a new shell, which does not have this script's function `f`/);
    assert.match(notes("f() { :; }\nsu -c 'f arg' root", 'ja', 1)[0], /^⚠ 落とし穴: `su -c` は新しいシェルでコマンドを実行するため、このスクリプトの関数 `f` は使えません/);
    assert.match(notes("f() { :; }\nsu --command 'f' root", 'en', 1)[0], /`su -c`/);
    for (const src of ["su -c 'ls' root", 'su - root', "su -c 'cd /x' root", "su -c ls$HOME root"]) assert.deepStrictEqual(notes('f() { :; }\n' + src, 'en', 1).filter((n) => /function/.test(n)), [], src);
    assert.deepStrictEqual(notes("su -c 'f' root"), []);
    assert.deepStrictEqual(notes('ssh host f'), []);
  });
});

describe('a { } group that is not closed', () => {
  it('} needs a ; or a newline before it', () => {
    for (const src of ['{ echo a; echo b }', 'f() { echo a; echo b }', 'if true; then { echo a }']) {
      const n = notes(src);
      assert.strictEqual(n.length, 1, src);
      assert.match(n[0], /^⚠ Pitfall: `\}` needs a `;` or a newline before it\. As written, `\}` is an argument of `echo`/);
    }
    assert.match(notes('{ echo a; echo b }', 'ja')[0], /^⚠ 落とし穴: `\}` の前に `;` か改行が必要です。このままでは `\}` は `echo` の引数で/);
  });
  it('{ needs a space after it', () => {
    const n = notes('{echo a;}');
    assert.strictEqual(n.length, 1);
    assert.match(n[0], /^⚠ Pitfall: there is no space after `\{`, so `\{echo` is a command name, not the start of a group/);
    assert.match(notes('{echo a;}', 'ja')[0], /^⚠ 落とし穴: `\{echo` は `\{` の直後に空白がないので/);
  });
  it('says nothing about a closed group, or a brace expansion', () => {
    for (const src of ['{ echo a; echo b; }', '{ echo a; echo b\n}', 'echo }', 'echo {a,b}', '{echo,hi}', 'echo a }']) assert.deepStrictEqual(notes(src), [], src);
    assert.deepStrictEqual(notes('{ echo a\necho b }\n}', 'en', 1), [], 'closed on a later line, as bash reads it');
  });
  (hasBash ? it : it.skip)('agrees with bash: both forms fail to parse or run', () => {
    assert.notStrictEqual(bash('{ echo a; echo b }').status, 0);
    assert.notStrictEqual(bash('{echo a;}').status, 0);
    assert.strictEqual(bash('{ echo a; echo b; }').out, 'a\nb\n');
  });
});
