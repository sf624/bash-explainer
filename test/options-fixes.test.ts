import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

let parser: Parser;
before(() => { parser = createUnbashParser(); });

function tokens(src: string, lang: 'en' | 'ja' = 'en'): Token[] {
  const out: Token[] = [];
  const walk = (t: Token) => (out.push(t), t.children.forEach(walk));
  new Analyzer(lang).explainLine(parser.parse(src), 0).items.forEach(walk);
  return out;
}
const explain = (src: string, label: string, lang: 'en' | 'ja' = 'en'): string =>
  tokens(src, lang).find((t) => t.label === label)?.explanation ?? `(no token ${label})`;

// Each line: the roles of its words, as `label` -> pattern of the explanation (en).
const roles: [string, Record<string, RegExp>][] = [
  ['kubectl logs -f mypod', { '-f': /stream/, mypod: /^pod/ }],
  ['git tag -a -m "Release" v1.0', { '-a': /annotated/, '"Release"': /Value for `-m`/, 'v1.0': /Word/ }],
  ['rpm -ivh pkg.rpm', { '-i': /^install/ }],
  ['rpm -Uvh pkg.rpm', { '-U': /upgrade/ }],
  ['rpm -qi bash', { '-i': /^show package information/ }],
  ['rpm -q -i bash', { '-i': /^show package information/ }],
  ['rpm --query -i bash', { '-i': /^show package information/ }],
  ['rpm -ql bash', { '-l': /list the files/ }],
  ['rpm -qf /bin/ls', { '-f': /owns/ }],
  ['chmod --reference=ref.txt target.txt', { 'target.txt': /target file/ }],
  ['chown --reference ref.txt a b', { a: /target file/, b: /target file/ }],
  ['chgrp --reference=ref.txt a', { a: /target file/ }],
  ['fdisk -o Device,Size /dev/sdb', { '-o': /columns/, 'Device,Size': /Value for `-o`/ }],
  ['fdisk -w always /dev/sdb', { '-w': /wipe/ }],
  ['fdisk -u -l /dev/sdb', { '-l': /only list/, '/dev/sdb': /disk/ }],
  ['systemctl list-units -r', { '-r': /host and local containers/ }],
  ['date -u -Iseconds', { '-Iseconds': /ISO 8601/, '-u': /UTC/ }],
  ['journalctl -b -1 -n 5', { '-1': /Value for `-b`/ }],
  ['journalctl -b -u nginx', { '-u': /unit/ }],
  ['seq -f %03g 1 10', { '-f': /format/, '1': /first/, '10': /last/ }],
  ['pip uninstall -y requests', { requests: /^package name$/ }],
  ['pip show requests', { requests: /^package name$/ }],
  ['uniq in.txt out.txt', { 'in.txt': /input/, 'out.txt': /output/ }],
  ['zip -r backup.zip dir', { 'backup.zip': /ZIP file/, dir: /add/ }],
  ['unzip -l a.zip', { '-l': /list/, 'a.zip': /ZIP file/ }],
  ['diff -N -w -i -B a b', { '-N': /absent/, '-w': /white space/, '-i': /case/, '-B': /blank/ }],
  ['diff -c a b', { '-c': /context/ }],
  ['mktemp -p /tmp --suffix .log tmp.XXXXXX', { '-p': /directory/, '--suffix': /suffix/, 'tmp.XXXXXX': /template/ }],
  ['xargs -i cp {} /x', { '-i': /replace/ }],
  ['git clone https://x/y.git mydir', { 'https://x/y.git': /repository to clone/, mydir: /directory to clone into/ }],
  ['git push origin main', { origin: /remote name/, main: /branch or ref to push/ }],
  ['git pull origin main', { main: /branch to pull/ }],
  ['git fetch origin', { origin: /remote name/ }],
  ['git remote add origin https://x/y.git', { add: /Add a remote/, origin: /remote name/, 'https://x/y.git': /URL/ }],
  ['git remote rename a b', { a: /remote name/, b: /new name/ }],
  ['git remote remove a', { a: /remote name/ }],
  ['git stash pop', { pop: /Apply a stash and drop/ }],
  ['git stash apply stash@{1}', { 'stash@{1}': /^stash/ }],
  ['git stash drop stash@{1}', { 'stash@{1}': /^stash/ }],
  ['git stash list', { list: /List the stashes/ }],
  ['git stash -u', { '-u': /untracked/ }],
  ['git branch -m old new', { old: /old branch/, new: /new branch/ }],
  ['git branch -d feat', { feat: /branch to delete/ }],
  ['git branch feat main', { feat: /^branch name/, main: /start point/ }],
  ['docker exec web ls', { web: /^container/, ls: /runs `ls`/ }],
  ['docker compose -f c.yml up -d', { '-f': /compose file/, up: /Create and start/, '-d': /background/ }],
  ['docker compose down -v', { '-v': /volumes/ }],
  ['docker compose ps -a', { '-a': /stopped/ }],
  ['docker compose logs -f web', { '-f': /follow/, web: /service/ }],
  ['docker compose exec web sh', { web: /service/, sh: /runs `sh`/ }],
  ['ip a show eth0', { a: /IP addresses/, show: /Show addresses/ }],
  ['ip addr add 10.0.0.1/24 dev eth0', { add: /Add an address/ }],
  ['ip r del default', { r: /routes/, del: /Delete a route/ }],
  ['ip l set eth0 up', { l: /interfaces/, set: /Change an interface/ }],
  ['ip n show', { n: /neighbour/ }],
  ['ip addr flush dev eth0', { flush: /Remove every address/ }],
  ['pkill -f nginx', { nginx: /pattern/ }],
  // GNU seq: a negative number is the first operand, and options end there (checked below).
  ['seq -w -2 2', { '-2': /^first/, 2: /^last/ }],
  ['seq 10 -3 1', { '-3': /^increment/ }],
  // GNU tail: `+2` is `-n +2`.
  ['tail +2 f', { '+2': /from line 2/ }],
  // gawk and perl read options only before the program (or perl's first file).
  ["awk 'NR>1' f -v", { '-v': /target file/ }],
  ["perl -ne 'print' f -l", { '-l': /target file/ }],
  // GNU tr's `-C` is `-c`; GNU cut accepts `-n` and ignores it.
  ['tr -C a x', { '-C': /complement/ }],
  ['cut -n -f1', { '-n': /ignored/ }],
  // perl's `-l` and `-0` take octal digits attached; other letters after them are switches (checked below).
  ["perl -l0 -e 'print 1'", { 0: /Value `0` for `-l`/ }],
  ["perl -0ne 'print'", { '-0ne': /`-0` `-n` `-e`/ }],
  ["perl -lne 'print'", { '-lne': /`-l` `-n` `-e`/ }],
  // util-linux getopt reads its own options only before the first operand: `-u` is an argument it parses (checked below).
  ['getopt -o a x -u', { '-u': /arguments to parse/ }],
];

describe('option dictionary fixes (audit)', () => {
  for (const [line, expect] of roles) {
    it(line, () => {
      for (const [label, re] of Object.entries(expect)) assert.match(explain(line, label), re, `${line}: ${label}`);
    });
  }

  it('an option with an attached-only value leaves the next word alone', () => {
    const toks = tokens('fdisk -u -l /dev/sdb');
    assert.ok(!toks.some((t) => /Value for `-u`/.test(t.explanation)));
    assert.match(explain('date -Iseconds', 'seconds'), /Value `seconds` for `-I`/);
  });

  it('journalctl -b takes the next word only when it is a boot offset or ID', () => {
    assert.match(explain('journalctl -b +2', '+2'), /Value for `-b`/);
    assert.match(explain('journalctl -b 0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef'), /Value for `-b`/);
    assert.match(explain('journalctl -b ssh', 'ssh'), /Word|Value/);
    assert.ok(!/Value for `-b`/.test(explain('journalctl -b ssh', 'ssh')));
    assert.ok(!/Value for `-b`/.test(explain('journalctl -b "$x"', '"$x"')));
    assert.ok(!tokens('journalctl -b').some((t) => /Value for/.test(t.explanation)));
  });

  it('--reference leaves every operand a file, and without it the first is the mode', () => {
    assert.match(explain('chmod 600 f', '600'), /mode/);
    assert.match(explain('chown root f', 'root'), /owner/);
    assert.match(explain('chgrp staff f', 'staff'), /group/);
  });

  it('is written in Japanese too', () => {
    assert.match(explain('kubectl logs -f mypod', '-f', 'ja'), /ログ/);
    assert.match(explain('fdisk -w always /dev/sdb', '-w', 'ja'), /署名/);
  });

  // Against the real tools.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'optfix-'));
  const run = (cmd: string, args: string[]): string => execFileSync(cmd, args, { cwd: tmp, encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).trim();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('the real tools agree with the roles', () => {
    assert.strictEqual(run('seq', ['-f', '%03g', '1', '3']), '001\n002\n003');
    assert.strictEqual(run('date', ['-Iseconds', '-d', '@0', '-u']), '1970-01-01T00:00:00+00:00');
    fs.writeFileSync(path.join(tmp, 'ref.txt'), '');
    fs.writeFileSync(path.join(tmp, 'target.txt'), '');
    fs.chmodSync(path.join(tmp, 'ref.txt'), 0o600);
    run('chmod', ['--reference=ref.txt', 'target.txt']);
    assert.strictEqual(run('stat', ['-c', '%a', 'target.txt']), '600');
    fs.writeFileSync(path.join(tmp, 'in.txt'), 'a\na\nb\n');
    run('uniq', ['in.txt', 'out.txt']);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'out.txt'), 'utf8'), 'a\nb\n');
    assert.strictEqual(run('seq', ['-w', '-2', '2']), '-2\n-1\n00\n01\n02');
    assert.strictEqual(run('seq', ['10', '-3', '1']), '10\n7\n4\n1');
    fs.writeFileSync(path.join(tmp, 'f'), 'a\nb\nc\n');
    assert.strictEqual(run('tail', ['+2', 'f']), 'b\nc');
    assert.strictEqual(run('gawk', ['BEGIN { print ARGV[1], ARGV[2] }', 'f', '-v']), 'f -v');
    assert.strictEqual(run('perl', ['-e', 'print "@ARGV"', 'f', '-l']), 'f -l');
    assert.strictEqual(execFileSync('tr', ['-C', 'a', 'x'], { input: 'abc', encoding: 'utf8' }), 'axx');
    assert.strictEqual(run('cut', ['-n', '-f1', 'f']), 'a\nb\nc');
    assert.strictEqual(run('perl', ['-l0', '-e', 'print 1']), '1\u0000');
    assert.strictEqual(run('perl', ['-0ne', 'print', 'f']), 'a\nb\nc');
    assert.strictEqual(run('perl', ['-lne', 'print length', 'f']), '1\n1\n1');
    // (getopt parses `x -u` with `-o a`: "invalid option -- 'u'", status 1; were `-u` its own, it would quote nothing and succeed.)
    assert.throws(() => execFileSync('getopt', ['-o', 'a', 'x', '-u'], { stdio: 'pipe' }));
  });
});

import { soundness } from './support/fuzz';
describe('redirections around assignments', () => {
  it('keeps the children of `>f x=1 >g` in order', () => {
    assert.deepStrictEqual(soundness(createUnbashParser().parse('>f x=1 >g')), []);
  });
});

describe('ssh -o: the values explained, as ssh reads them (`ssh -G` prints the settings and connects to nothing)', () => {
  const hasSsh = (() => { try { execFileSync('ssh', ['-F', '/dev/null', '-G', 'x'], { stdio: 'pipe' }); return true; } catch { return false; } })();
  const rows: [string, RegExp, string][] = [
    ['StrictHostKeyChecking=no', /without checking host keys.*man-in-the-middle.*\(careful\)$/, 'stricthostkeychecking false'],
    ['StrictHostKeyChecking=off', /without checking host keys/, 'stricthostkeychecking false'],
    ['StrictHostKeyChecking=accept-new', /add the keys of unknown hosts automatically, but refuse hosts whose key has changed/, 'stricthostkeychecking accept-new'],
    ['UserKnownHostsFile=/dev/null', /keep no known host keys/, 'userknownhostsfile /dev/null'],
  ];
  for (const [value, said, setting] of rows) {
    (hasSsh ? it : it.skip)(value, () => {
      assert.match(explain(`ssh -o ${value} host`, value), said);
      assert.ok(execFileSync('ssh', ['-F', '/dev/null', '-G', '-o', value, 'host']).toString().split('\n').includes(setting), value);
    });
  }
  it('gives a harmless setting as the example of `-o`', () => {
    assert.match(explain('ssh -o ConnectTimeout=5 host', '-o'), /e\.g\. `ConnectTimeout=5`/);
    assert.match(explain('ssh -o ConnectTimeout=5 host', '-o', 'ja'), /例: `ConnectTimeout=5`/);
    assert.doesNotMatch(explain('ssh -o ConnectTimeout=5 host', '-o'), /StrictHostKeyChecking/);
    assert.match(explain('ssh -o StrictHostKeyChecking=no host', 'StrictHostKeyChecking=no', 'ja'), /なりすまし（中間者攻撃）に気づけない（注意）$/);
  });
});
