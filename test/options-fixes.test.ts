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
  ['pkill -f nginx', { nginx: /pattern/ }],
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
  });
});
