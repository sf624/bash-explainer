// rg, pv, sponge, expect, socat and sshpass against the real tools: the recorded option lines (test/fixtures/small-tools/) are still
// what the tools print, every option of the specs is accepted by the tool, and the rules the specs state hold when the tools run.
// The tools are found through $RG, $PV, $SPONGE, $EXPECT, $SOCAT and $SSHPASS (tools/env.sh of the maintainer's machine); the rows of
// a missing one are skipped. CI does not install them. Nothing here touches the network: socat relays between files and standard
// input, sshpass runs `true` and `false`.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { fixture } from './support/smalltools';

const BIN: Record<string, string | undefined> = {
  rg: process.env.RG, pv: process.env.PV, sponge: process.env.SPONGE, expect: process.env.EXPECT, socat: process.env.SOCAT, sshpass: process.env.SSHPASS,
};
const withTool = (tool: string): typeof it => (BIN[tool] && fs.existsSync(BIN[tool]!) ? it : it.skip) as typeof it;

// (expect needs the Tcl library, which a package unpacked without root keeps next to the binary: <root>/usr/share/tcltk/tcl8.6.)
const tclLibrary = (): string | undefined => {
  if (process.env.TCL_LIBRARY) return process.env.TCL_LIBRARY;
  const dir = BIN.expect ? path.join(path.dirname(BIN.expect), '..', 'share', 'tcltk', 'tcl8.6') : '';
  return fs.existsSync(dir) ? dir : undefined;
};

/** A directory of our own, removed by its exact path. */
function within<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'small-tools-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function run(tool: string, args: string[], cwd: string, input = ''): { out: string; err: string; status: number | null } {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C' };
  delete env.SSHPASS;
  const tcl = tclLibrary();
  if (tcl) env.TCL_LIBRARY = tcl;
  const r = spawnSync(BIN[tool]!, args, { cwd, input, encoding: 'utf8', timeout: 10000, env });
  return { out: r.stdout ?? '', err: r.stderr ?? '', status: r.status };
}

/** Whether the tool refused `name` as an option (its text, when it does). */
const REFUSED: Record<string, RegExp> = {
  rg: /unrecognized flag/, pv: /invalid option|unrecognized option/, socat: /unknown option/, sshpass: /invalid option|unrecognized option/,
};

/** A value for an option that takes one: a number the tools take or refuse in their own way (never as an unknown option); a process that does not exist. */
const valueFor = (tool: string, name: string): string => {
  if (tool === 'pv' && /^(-R|--remote|-d|--watchfd)$/.test(name)) return '999999999';
  // (socat's lock files and logs are files: one each, so that -W does not wait for the lock -L made.)
  return tool === 'socat' && /^-(L|W|r|R|lf)$/.test(name) ? `file${name.slice(1)}` : '1';
};

describe('small tools against the real tools', () => {
  withTool('rg')('rg: the recorded option lines are still what ripgrep prints', () => {
    within((dir) => {
      const short = run('rg', ['-h'], dir).out;
      const long = run('rg', ['--help'], dir).out;
      for (const l of fixture('rg.txt')) assert.ok(l.startsWith('--no-') ? long.includes(l) : short.includes(l), `rg: ${l}`);
    });
  });

  withTool('pv')('pv: the recorded option lines are still what pv prints', () => {
    within((dir) => {
      const help = run('pv', ['--help'], dir).out;
      for (const l of fixture('pv.txt')) assert.ok(help.includes(l), `pv: ${l}`);
    });
  });

  withTool('sshpass')('sshpass and sponge: the recorded usage texts are still what they print', () => {
    within((dir) => {
      const help = run('sshpass', ['-h'], dir).out;
      for (const l of fixture('sshpass.txt')) assert.ok(help.includes(l), `sshpass: ${l}`);
    });
  });

  withTool('sponge')('sponge: the recorded usage text is still what it prints', () => {
    within((dir) => {
      const help = run('sponge', ['-h'], dir);
      assert.ok((help.out + help.err).includes(fixture('sponge.txt')[0]));
    });
  });

  withTool('socat')('socat: the recorded option lines are still what socat prints', () => {
    within((dir) => {
      const help = run('socat', ['-h'], dir).out;
      for (const l of fixture('socat.txt')) assert.ok(help.includes(l), `socat: ${l}`);
    });
  });

  withTool('expect')('expect: -v prints the version the spec was checked with', () => {
    within((dir) => assert.match(run('expect', ['-v'], dir).out, /expect version 5\.45/));
  });

  for (const tool of ['rg', 'pv', 'socat', 'sshpass']) {
    withTool(tool)(`${tool}: the tool takes every option of the spec`, () => {
      within((dir) => {
        // (The check is that a wrong option is refused as one: the tool's own message.)
        const wrong = run(tool, tool === 'socat' ? ['-Q', '/dev/null', '/dev/null'] : [tool === 'rg' ? '--nosuchflag' : '-Q', 'x'], dir);
        assert.match(wrong.err, REFUSED[tool], `${tool}: a wrong option is not refused`);
        const spec = lookupCommand(tool)!;
        const bad: string[] = [];
        for (const o of spec.options!) {
          for (const name of o.names) {
            // (An option that stops the tool, or reads standard input, has an empty input here; sshpass runs `true`.)
            const value = o.value ? [valueFor(tool, name)] : [];
            const args = tool === 'socat' ? [name, ...value, '/dev/null', '/dev/null'] : tool === 'sshpass' ? [name, ...value, 'true'] : tool === 'rg' ? ['--no-config', name, ...value, '--', 'x'] : [name, ...value, '/dev/null'];
            const t0 = Date.now();
            const r = run(tool, args, dir);
            if (Date.now() - t0 > 3000) console.log(`      (slow: ${tool} ${args.join(' ')})`);
            if (REFUSED[tool].test(r.err)) bad.push(`${name}: ${r.err.split('\n')[0]}`);
          }
        }
        assert.deepStrictEqual(bad, []);
      });
    });
  }

  withTool('rg')('rg: -A3, -A=3 and -A 3 are the same; an abbreviated long option is refused; -e gives the pattern', () => {
    within((dir) => {
      fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nb\nc\nd\n');
      const out = (args: string[]): string => run('rg', ['--no-config', ...args], dir).out;
      for (const a of ['-A1', '-A=1', '-A 1', '--after-context=1', '--after-context 1']) assert.strictEqual(out([...a.split(' '), 'b', 'f.txt']), 'b\nc\n', a);
      assert.match(run('rg', ['--no-config', '--after-cont=1', 'b', 'f.txt'], dir).err, /unrecognized flag/);
      assert.strictEqual(out(['-e', 'b', 'f.txt']), 'b\n');
      // (With -e, the first operand is a file, not a pattern.)
      assert.strictEqual(out(['-e', 'b', '-e', 'c', 'f.txt']), 'b\nc\n');
      assert.strictEqual(run('rg', ['--no-config', 'zzz', 'f.txt'], dir).status, 1);
      // (-uu is two -u; --no-heading turns --heading off.)
      assert.strictEqual(out(['-uu', 'b', 'f.txt']), 'b\n');
      assert.strictEqual(out(['--heading', '--no-heading', 'b', 'f.txt']), 'b\n');
    });
  });

  withTool('pv')('pv: copies its input; a prefix of a long option, clusters and attached values are read', () => {
    within((dir) => {
      fs.writeFileSync(path.join(dir, 'f'), 'hello\n');
      assert.strictEqual(run('pv', ['-q', 'f'], dir).out, 'hello\n');
      assert.strictEqual(run('pv', ['--siz', '6', '-q', 'f'], dir).out, 'hello\n');
      assert.strictEqual(run('pv', ['-qs6', 'f'], dir).out, 'hello\n');
      assert.strictEqual(run('pv', ['-qNx', 'f'], dir).out, 'hello\n');
      assert.strictEqual(run('pv', ['-q'], dir, 'from stdin\n').out, 'from stdin\n');
      assert.strictEqual(run('pv', ['-q', '-X', 'f'], dir).out, '');
    });
  });

  withTool('sponge')('sponge: writes after reading everything, so `sort f | sponge f` works; -a appends; no file is standard output', () => {
    within((dir) => {
      const f = path.join(dir, 'f');
      fs.writeFileSync(f, 'b\na\n');
      // (A shell would truncate f before sort reads it.)
      const sorted = spawnSync(process.env.BASH_EXPLAINER_BASH53 ?? 'bash', ['-c', 'sort f | "$0" f', BIN.sponge!], { cwd: dir, encoding: 'utf8' });
      assert.strictEqual(sorted.status, 0);
      assert.strictEqual(fs.readFileSync(f, 'utf8'), 'a\nb\n');
      run('sponge', ['-a', 'f'], dir, 'z\n');
      assert.strictEqual(fs.readFileSync(f, 'utf8'), 'a\nb\nz\n');
      assert.strictEqual(run('sponge', [], dir, 'x\n').out, 'x\n');
    });
  });

  withTool('sshpass')('sshpass: runs the command after its options (here true and false) and gives its status; -e needs $SSHPASS', () => {
    within((dir) => {
      assert.strictEqual(run('sshpass', ['-p', 'x', 'true'], dir).status, 0);
      assert.strictEqual(run('sshpass', ['-p', 'x', 'false'], dir).status, 1);
      assert.strictEqual(run('sshpass', ['-px', 'true'], dir).status, 0);
      fs.writeFileSync(path.join(dir, 'pw'), 'secret\n');
      assert.strictEqual(run('sshpass', ['-f', 'pw', 'true'], dir).status, 0);
      const e = run('sshpass', ['-e', 'true'], dir);
      assert.notStrictEqual(e.status, 0);
      assert.match(e.err, /SSHPASS/);
      // (The first operand ends the options: -p after it belongs to the command.)
      assert.strictEqual(run('sshpass', ['-p', 'x', 'sh', '-c', 'echo "$0"', '-p'], dir).out, '-p\n');
    });
  });

  withTool('expect')('expect: the first operand is the script unless -f or -b gives it; the rest are its arguments; -c runs first', () => {
    within((dir) => {
      fs.writeFileSync(path.join(dir, 's.exp'), 'puts "argv=$argv argv0=$argv0"\n');
      const out = (args: string[]): string => run('expect', args, dir).out;
      assert.strictEqual(out(['s.exp', 'a', 'b']), 'argv=a b argv0=s.exp\n');
      assert.strictEqual(out(['-f', 's.exp', 'a', 'b']), 'argv=a b argv0=s.exp\n');
      assert.strictEqual(out(['-c', 'puts hi', 's.exp', 'x']), 'hi\nargv=x argv0=s.exp\n');
      // (An option after the script is its argument.)
      assert.strictEqual(out(['s.exp', '-d']), 'argv=-d argv0=s.exp\n');
      assert.strictEqual(out(['-D', '0', '-c', 'puts ok']), 'ok\n');
      assert.strictEqual(run('expect', ['-', ], dir, 'puts stdin-script\n').out, 'stdin-script\n');
    });
  });

  withTool('socat')('socat: options come before the two addresses and do not cluster; -t5 and -t 5 both work', () => {
    within((dir) => {
      const relay = (args: string[]): { out: string; err: string; status: number | null } => run('socat', args, dir, 'hi\n');
      assert.strictEqual(relay(['-', '-']).out, 'hi\n');
      for (const t of [['-t5'], ['-t', '5'], ['-T1'], ['-b', '100'], ['-b100'], ['-d'], ['-dd'], ['-d2'], ['-lf', 'log'], ['-lflog2'], ['-u']]) assert.strictEqual(relay([...t, '-', '-']).out, 'hi\n', t.join(' '));
      assert.match(relay(['-vx', '-', '-']).err, /Do not merge single character options/);
      assert.match(relay(['-', '-', '-u']).err, /exactly 2 addresses required/);
      // (A file address: the data goes from standard input to the file.)
      relay(['-u', '-', 'CREATE:out.txt']);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'out.txt'), 'utf8'), 'hi\n');
      relay(['-u', '-r', 'raw', '-', 'CREATE:out2.txt']);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'raw'), 'utf8'), 'hi\n');
    });
  });
});
