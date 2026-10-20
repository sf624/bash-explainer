import * as assert from 'assert';
import { spawnSync } from 'child_process';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

let parser: Parser;
before(() => {
  parser = createUnbashParser();
});

/** The tokens inside the first command of a line, flattened to `label: explanation`. */
function parts(src: string, lang: 'en' | 'ja' = 'en'): Record<string, string> {
  const tree = parser.parse(src);
  const out: Record<string, string> = {};
  for (const t of new Analyzer(lang).explainLine(tree, 0).items[0].children) out[t.label] = t.explanation;
  return out;
}
const bash = (script: string) => spawnSync('bash', ['-c', script], { encoding: 'utf8' });

describe('builtin options that take a value', () => {
  // [line, label of the value, role it must NOT get, the role it must get]
  const cases: [string, string, RegExp][] = [
    ['mapfile -n 10 -s 2 -O 5 arr', '5', /Value for `-O`/], ['mapfile -c 1 -C cb arr', 'cb', /Value for `-C`/], ['mapfile -u 3 arr', '3', /Value for `-u`/],
    ['readarray -t -d , parts', ',', /Value for `-d`/], ['readarray -n 3 arr', '3', /Value for `-n`/], ['readarray -t -s 1 arr', '1', /Value for `-s`/],
    ['read -N 3 buf', '3', /Value for `-N`/], ['read -e -i default ans', 'default', /Value for `-i`/],
    ['kill -n 9 123', '9', /Value for `-n`/], ['wait -n -p id', 'id', /Value for `-p`/], ['exec -a name cmd', 'name', /Value for `-a`/],
  ];
  for (const [src, label, re] of cases) it(src, () => assert.match(parts(src)[label], re));

  it('agrees with bash on mapfile -s/-O and read -N/-i', () => {
    assert.strictEqual(bash('printf "x\\ny\\nz\\n" | { mapfile -t -s 1 -O 5 arr; declare -p arr; }').stdout, 'declare -a arr=([5]="y" [6]="z")\n');
    assert.strictEqual(bash('read -N 3 buf <<< abcdef; echo $buf').stdout, 'abc\n');
  });
  it('names the array, not the values', () => {
    assert.match(parts('mapfile -n 10 -s 2 -O 5 arr').arr, /array name/);
  });
});

describe('kill', () => {
  for (const sig of ['-TERM', '-INT', '-HUP', '-SIGTERM', '-15', '-1', '-term']) {
    it(`${sig} is one signal`, () => {
      const p = parts(`kill ${sig} 123`);
      assert.match(p[sig], /^Send (the signal|signal number)/);
      assert.ok(!/Combined/.test(p[sig]));
      assert.match(p['123'], /target PID/);
    });
  }
  it('-l takes signals to translate', () => {
    assert.match(parts('kill -l 15')['15'], /signal to translate/);
    assert.strictEqual(bash('kill -l 15').stdout, 'TERM\n');
  });
  it('-l after -- is a word', () => {
    assert.match(parts('kill -- -l')['-l'], /target PID/);
  });
  it('job specs', () => {
    assert.match(parts('kill -9 %1')['%1'], /Job spec: job number 1/);
    assert.match(parts('fg %%')['%%'], /current job/);
    assert.match(parts('disown -h %vim')['%vim'], /starts with `vim`/);
    assert.match(parts('kill %?foo')['%?foo'], /contains `foo`/);
    assert.match(parts('kill %-')['%-'], /previous job/);
  });
  it('is in Japanese too', () => {
    assert.match(parts('kill -TERM 1', 'ja')['-TERM'], /送るシグナル/);
  });
});

describe('getopts, source, trap, set', () => {
  it('getopts words to parse', () => {
    assert.match(parts('getopts ab opt -a -b')['-a'], /words to parse/);
    assert.strictEqual(bash('getopts ab opt -b; echo $opt').stdout, 'b\n');
  });
  it('. passes arguments', () => assert.match(parts('. ./lib.sh arg1').arg1, /arguments passed/));
  it('trap with one signal resets it', () => {
    assert.match(parts('trap INT').INT, /signal to reset/);
    assert.match(parts('trap 0')['0'], /signal to reset/);
    assert.match(parts('trap -p INT').INT, /signal to show/);
    assert.match(parts("trap 'echo hi' INT")["'echo hi'"], /command to run/);
    assert.strictEqual(bash('trap "echo hi" INT; trap INT; trap -p INT').stdout, '');
  });
  it('set -o and set +o with no name list the settings', () => {
    assert.match(parts('set -o')['-o'], /list the current option settings/);
    assert.match(parts('set +o')['+o'], /recreate the current settings/);
    assert.match(parts('set -o pipefail')['-o'], /enable an option by name/);
    assert.match(bash('set -o').stdout, /^allexport\s+off/m);
  });
  it('set options by name', () => {
    assert.match(parts('set -o errtrace', 'en')['errtrace'], /ERR/);
  });
  it('fc, bind and suspend are builtins', () => {
    for (const c of ['fc -l', 'bind -x "\\C-l:clear"', 'suspend -f']) {
      const t = new Analyzer('en').explainLine(parser.parse(c), 0).items[0];
      assert.match(t.explanation, /shell builtin/, c);
      assert.strictEqual(spawnSync('bash', ['-c', `type -t ${c.split(' ')[0]}`], { encoding: 'utf8' }).stdout, 'builtin\n');
    }
  });
});

describe('declare, export, unset', () => {
  it('export -n removes the export property', () => {
    assert.match(parts('export -n FOO')['-n'], /remove the export property/);
    assert.strictEqual(bash('export FOO=1; export -n FOO; bash -c \'echo "[$FOO]"\'').stdout, '[]\n');
    assert.match(parts('export -f fn')['-f'], /functions/);
  });
  it('declare -n is still a name reference', () => assert.match(parts('declare -n r=a')['-n'], /name reference/));
  it('declare +x turns the attribute off', () => {
    for (const c of ['declare', 'typeset', 'local']) {
      const p = parts(`${c} +x FOO`);
      assert.match(p['+x'], /stop exporting/);
      assert.match(p.FOO, /Variable `FOO`/);
    }
    assert.strictEqual(bash('declare -x BAR=1; declare +x BAR; declare -p BAR').stdout, 'declare -- BAR="1"\n');
  });
  it('declare -t', () => assert.match(parts('declare -t F')['-t'], /trace/));
  it('unset -n unsets the reference itself', () => {
    const p = parts('unset -n ref');
    assert.match(p['-n'], /name reference itself/);
    assert.match(p.ref, /name reference `ref` itself/);
    assert.strictEqual(bash('a=1; declare -n r=a; unset -n r; declare -p a').stdout, 'declare -- a="1"\n');
  });
});

describe('other options', () => {
  it('are in the dictionary', () => {
    for (const c of ['jobs -l', 'disown -h', 'type -p ls', 'hash -r', 'history -c', 'pwd -L', 'dirs -v', 'enable -n', 'alias -p', 'unalias -a', 'help -s', 'shopt -p']) {
      const label = c.split(' ')[1];
      assert.ok(!/not in the dictionary/.test(parts(c)[label]), c);
    }
  });
});

describe('[ ] and [[ ]] examples', () => {
  it('[ -n $x ] is true for an empty value', () => {
    const tree = parser.parse('[ -n $x ]');
    const e = new Analyzer('en').explainLine(tree, 0);
    const ex = e.examples.find((x) => x.kind === 'test')!;
    assert.deepStrictEqual(ex.sections.map((s) => s.label), ['True when']);
    assert.strictEqual(bash('x=""; [ -n $x ]; echo $?').stdout, '0\n');
  });
  it('[[ != pattern ]] says the right side is a pattern', () => {
    const t = new Analyzer('en').explainLine(parser.parse('[[ $s != a* ]]'), 0);
    assert.match(JSON.stringify(t.items), /glob pattern/);
    assert.strictEqual(bash('[[ abc != a* ]]; echo $?').stdout, '1\n');
  });
});
