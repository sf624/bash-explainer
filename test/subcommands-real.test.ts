// Commands with subcommands, compared with the real tools: the subcommand git runs and the words it gets
// after the global options (`GIT_TRACE`), `git log -N`, the options ip reads only before the object, and the
// options systemctl reads after the verb, and the subcommand gh finds after options (as cobra does). Tools that
// are missing are skipped.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { ArgRole, ArgvParse, interpret } from '../src/argv/interpret';
import { argWords } from './support/argwords';

const has = (tool: string): boolean => spawnSync('bash', ['--norc', '-c', `command -v ${tool}`]).status === 0;
const ENV = { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const run = (line: string, cwd = os.tmpdir(), env: NodeJS.ProcessEnv = ENV): { out: string; err: string; status: number | null } => {
  const r = spawnSync('bash', ['--norc', '-c', line], { cwd, env, encoding: 'utf8', timeout: 60000 });
  return { out: r.stdout, err: r.stderr, status: r.status };
};

/** Each word with its role, the words of subcommands included; `path` is the subcommand that reads it. */
function roles(line: string): { path: string; word: string; role: ArgRole }[] {
  const { name, words, texts } = argWords(line);
  const out: { path: string; word: string; role: ArgRole }[] = [];
  const walk = (parse: ArgvParse): void => {
    for (const { word, role } of parse.roles) {
      out.push({ path: parse.command, word: words[word].value ?? texts[word], role });
      if (role.role === 'subcommand') walk(role.parse);
    }
  };
  walk(interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }));
  return out;
}
const roleOf = (line: string, word: string) => roles(line).find((r) => r.word === word)!;

describe('git agrees with the real git', () => {
  let dir = '';
  before(function () {
    if (!has('git')) return this.skip();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcommands-real-'));
    const repo = (cmd: string) => assert.strictEqual(run(cmd, dir).status, 0, cmd);
    repo('git init -q -b main repo && git -C repo config user.name t && git -C repo config user.email t@x');
    for (let i = 1; i <= 5; i++) repo(`echo ${i} > repo/f && git -C repo add f && git -C repo commit -q -m c${i}`);
  });
  after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  // GIT_TRACE prints the command line a builtin gets: `git SUBCOMMAND ARGS`, with the global options read.
  const ROWS = [
    'git -C repo log -3 --oneline',
    'git -c core.pager=cat --no-pager -C repo log -n 2',
    'git --no-pager -C repo show -1 --stat',
    'git -C repo -c a.b=c status -s',
    'git -C repo stash list',
    'git -C repo remote -v',
    'git -C repo branch -a',
    'git -C repo diff --cached --stat',
    'git -C repo rev-parse --short HEAD',
    // The other global options of git(1).
    'git --git-dir repo/.git log -1 --oneline',
    'git --git-dir=repo/.git --work-tree=repo status -s',
    'git --work-tree repo --git-dir repo/.git diff --stat',
    'git -P -p --paginate -C repo log -1 --oneline',
    'git --no-replace-objects --literal-pathspecs -C repo log -1',
    'git --glob-pathspecs --icase-pathspecs --no-optional-locks -C repo status -s',
    'git --noglob-pathspecs -C repo status -s',
    'git --namespace x -C repo log -1 --oneline',
    'git --config-env core.pager=HOME --config-env=core.editor=HOME -C repo log -1 --oneline',
    'git --bare --git-dir repo/.git log -1 --oneline',
    'git --exec-path=/nonexistent -C repo log -1 --oneline',
    'git --attr-source HEAD --attr-source=HEAD -C repo log -1 --oneline',
  ];
  for (const line of ROWS) {
    it(`reads the subcommand and its words as git does: ${line}`, () => {
      const r = run(line, dir, { ...ENV, GIT_TRACE: '1' });
      assert.strictEqual(r.status, 0, r.err);
      const traced = /trace: built-in: (git .*)$/m.exec(r.err)![1];
      const all = roles(line);
      const sub = all.find((x) => x.role.role === 'subcommand')!;
      const after = all.slice(all.indexOf(sub) + 1).filter((x) => x.path !== 'git').map((x) => x.word);
      assert.strictEqual(['git', sub.word, ...after].join(' '), traced);
      // The words before it are git's own options and their values.
      for (const x of all.slice(0, all.indexOf(sub))) assert.ok(['option', 'value'].includes(x.role.role), `${x.word}: ${x.role.role}`);
    });
  }

  it('git\'s own short options do not cluster or take an attached value', () => {
    for (const [line, word] of [['git -pP --version', '-pP'], ['git -C. --version', '-C.'], ['git -cx=1 --version', '-cx=1'], ['git -ph --version', '-ph'], ['git -c=x --version', '-c=x'], ['git -C=. --version', '-C=.']]) {
      assert.match(run(line, dir).err, new RegExp(`unknown option: ${word.replace(/[.]/g, '\\$&')}`), line);
      assert.strictEqual(roleOf(line, word).role.role, 'unknown-option', line);
    }
    // Written apart they are fine, and a subcommand's own short options do cluster.
    assert.strictEqual(run('git -p -P --version', dir).status, 0);
    assert.strictEqual(roleOf('git -p -P --version', '-P').role.role, 'option');
    assert.strictEqual(roleOf('git commit -am x', '-am').role.role, 'cluster');
  });

  for (const n of [1, 2, 4]) {
    it(`git log -${n} shows ${n} commits, and -${n} counts them`, () => {
      const r = run(`git -C repo log -${n} --format=%H`, dir);
      assert.strictEqual(r.out.trim().split('\n').length, n);
      for (const line of [`git log -${n}`, `git show -${n}`]) {
        const role = roleOf(line, `-${n}`).role;
        assert.ok(role.role === 'pattern-option' && role.text.en === `only ${n} (same as \`-n ${n}\`)`, line);
      }
    });
  }
});

describe('ip agrees with the real ip', () => {
  // (iproute2's ip; iproute2mac's `ip` on macOS reads its words otherwise.)
  const ip = has('ip') && /iproute2/.test(spawnSync('ip', ['-V'], { env: ENV, encoding: 'utf8' }).stdout ?? '') ? it : it.skip;
  // (`-n NETNS` switches to the namespace at once, so it needs one that exists.)
  const VALUES: Record<string, string> = { '-f': 'inet', '-family': 'inet', '-l': '1', '-loops': '1', '-b': '/dev/null', '-batch': '/dev/null', '-rc': '65536', '-rcvbuf': '65536' };
  ip('accepts every option of the dictionary before the object', () => {
    for (const o of lookupCommand('ip')!.options!) {
      for (const n of o.names.filter((x) => !['-n', '-netns'].includes(x))) {
        const value = o.value ? ` ${VALUES[n]}` : '';
        assert.strictEqual(run(`ip ${n}${value} -V`).status, 0, n);
        const role = roleOf(`ip ${n}${value} addr`, n).role;
        assert.ok(role.role === 'option' && role.spec === o, n);
      }
    }
  });
  // After the object, ip takes an option of its own as a word of the object's command.
  const ROWS: [string, string, boolean][] = [
    ['ip -s addr show lo', '-s', true],
    ['ip -4 a s lo', '-4', true],
    ['ip -d link show lo', '-d', true],
    ['ip addr show -s lo', '-s', false],
    ['ip a -4', '-4', false],
    ['ip link show -d lo', '-d', false],
  ];
  // A prefix of an object, of its command or of an option selects the first one in iproute2's tables:
  // the line does what the full one does.
  const PREFIXES: [string, string][] = [
    ['ip ad s lo', 'ip address show lo'],
    ['ip a l lo', 'ip address list lo'],
    ['ip ro g 127.0.0.1', 'ip route get 127.0.0.1'],
    ['ip r l', 'ip route list'],
    ['ip ne s', 'ip neighbor show'],
    ['ip m help', 'ip maddress help'],
    ['ip t help', 'ip tunnel help'],
    ['ip s help', 'ip sr help'],
    ['ip st help', 'ip stats help'],
    ['ip ntb', 'ip ntable'],
    ['ip -stat a s lo', 'ip -statistics address show lo'],
    ['ip -bri a s lo', 'ip -brief address show lo'],
    ['ip -det link show lo', 'ip -details link show lo'],
    ['ip --stats -human a s lo', 'ip -statistics -human-readable address show lo'],
    ['ip -fam inet a s lo', 'ip -family inet address show lo'],
    ['ip - 3 a s lo', 'ip -loops 3 address show lo'],
  ];
  // The counters of `ip -s` move while the test runs (any traffic on lo), so the two runs of a statistics row
  // compare the counter lines with their digits and spacing masked. The rest of the output is compared as it is.
  const maskCounters = (text: string): string => text
    .split('\n')
    .map((l, i, all) => (i > 0 && /^\s*(RX|TX):/.test(all[i - 1]) ? l.replace(/\d+/g, '#').replace(/\s+/g, ' ') : l))
    .join('\n');
  for (const [line, full] of PREFIXES) {
    ip(`${line}: reads as ${full}`, () => {
      const output = (l: string) => {
        const r = run(l);
        return /(^| )--?stat/.test(l) ? maskCounters(r.out + r.err) : r.out + r.err;
      };
      assert.strictEqual(output(line), output(full), line);
      // The same subcommands and options, by name.
      const names = (l: string) => roles(l).map((x) => (x.role.role === 'subcommand' ? x.role.name : x.role.role === 'option' ? x.role.spec.names.at(-1) : x.word));
      const ours = names(line);
      assert.deepStrictEqual(ours, names(full), line);
    });
  }
  ip('-b is -batch, before -brief', () => {
    assert.match(run('ip -b nosuchfile a').err, /Cannot open file "nosuchfile"/);
    const r = roleOf('ip -b nosuchfile a', '-b').role;
    assert.ok(r.role === 'option' && r.spec.names.includes('-batch'));
  });
  for (const [line, flag, ok] of ROWS) {
    ip(`${line}: ${flag} is ${ok ? '' : 'not '}an option of ip`, () => {
      assert.strictEqual(run(line).status === 0, ok, line);
      const r = roleOf(line, flag);
      if (ok) assert.ok(r.role.role === 'option' && r.path === 'ip', r.role.role);
      else assert.notStrictEqual(r.role.role, 'option');
    });
  }
});

describe('systemctl agrees with the real systemctl', () => {
  const VALUES: Record<string, string> = {
    '-t': 'service', '--type': 'service', '--state': 'failed', '-H': 'host', '--host': 'host', '-p': 'Id', '--property': 'Id',
    '--root': '/', '-n': '5', '--lines': '5', '-o': 'short', '--output': 'short', '--signal': 'TERM', '-M': 'x', '--machine': 'x',
  };
  (has('systemctl') ? it : it.skip)('reads every option of the dictionary after the verb', () => {
    for (const o of lookupCommand('systemctl')!.options!) {
      assert.ok(o.persistent, o.names[0]);
      for (const n of o.names) {
        const value = o.value ? ` ${VALUES[n]}` : '';
        // `--version` ends the reading of the options: an option it does not know is an error before it.
        const r = run(`systemctl status ${n}${value} --version`);
        assert.doesNotMatch(r.err, /unrecognized|invalid option|requires an argument|Unknown/, n);
        const role = roleOf(`systemctl status ${n}${value} nginx`, n);
        assert.ok(['option', 'cluster'].includes(role.role.role) && role.path === 'systemctl status', n);
        if (value) assert.strictEqual(roleOf(`systemctl status ${n}${value} nginx`, value.trim()).role.role, 'value', n);
      }
    }
  });
});

// gh finds its subcommand as cobra does: options before it, its own included, and an option it does not know
// (without `=`) takes the next word as its value. `--help` prints the usage of the command found, offline.
describe('gh agrees with the real gh', () => {
  const ROWS = [
    'gh -R o/r pr list', 'gh pr -R o/r list', 'gh --repo o/r pr', 'gh pr list -R o/r',
    // An option gh does not know takes `pr` as its value: "unknown command".
    'gh -x pr list', 'gh -w pr list', 'gh --foo pr list',
    // ... unless written with `=`, or as several letters: then `pr` is found, and the option is refused.
    'gh --foo=1 pr list', 'gh -xy pr list', 'gh -R o/r api',
    // `--` ends the search, empty words are skipped, and cobra's `-h` is not known yet: it takes `pr`.
    'gh -- pr list', "gh '' pr list", 'gh -h pr list', 'gh --help pr list',
    // The words before a subcommand are searched again with its options: `pr` does not know `--version`.
    'gh --version pr list', 'gh --json number pr list', 'gh pr -s open list', 'gh pr -w list',
  ];
  (has('gh') ? it : it.skip)('finds the subcommand gh runs, and refuses the same options', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'subcommands-gh-'));
    try {
      for (const line of ROWS) {
        const r = run(`${line} --help`, os.tmpdir(), { ...ENV, GH_CONFIG_DIR: home, NO_COLOR: '1', GH_PROMPT_DISABLED: '1' });
        const text = r.out + r.err;
        // The command found, as its usage names it (`gh pr list`), and the subcommands we read. gh prints the whole
        // help (`USAGE`) after an error when it runs under an AI agent (`AI_AGENT`, `CLAUDECODE`), else a line `Usage:  gh …`.
        const found = /^(?:USAGE\n {2}|Usage: {2})gh ((?:[a-z][\w-]*(?: |$))*)/m.exec(text)?.[1].trim();
        const rs = roles(line);
        const chain = rs.filter((x) => x.role.role === 'subcommand');
        const subs = chain.map((x) => x.word).join(' ');
        if (/unknown command/.test(text)) assert.strictEqual(subs, '', `${line}: ${text}`);
        else {
          if (/unknown (shorthand )?flag/.test(text)) assert.ok(rs.some((x) => x.role.role === 'unknown-option' || (x.role.role === 'cluster' && x.role.letters.some((l) => l.role === 'unknown-option'))), line);
          // (The dictionary may stop before gh does: `gh pr list`, with no `list` in it, is `pr`.)
          assert.notStrictEqual(found, undefined, `${line}: no usage in ${JSON.stringify(text)}`);
          const names = found!.split(' ').filter(Boolean);
          assert.strictEqual(names.slice(0, chain.length).join(' '), subs, `${line}: ${text}`);
          const last = chain.at(-1)?.role;
          const deeper = names[chain.length];
          if (deeper !== undefined) assert.ok(!(last?.role === 'subcommand' ? last.spec : lookupCommand('gh')!).subcommands?.[deeper], `${line}: ${deeper}`);
        }
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
