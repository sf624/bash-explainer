// The entries read with the `getopt_long` parser (src/argv/parsers.ts), compared with the real GNU tools: the
// entry lists every long option of the tool's `--help`, and each unique prefix of a long option names the option
// the tool takes for it, as glibc's messages tell ("option '--invert-match' doesn't allow an argument", "requires
// an argument", "is ambiguous"). Tools that are missing are skipped.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import type { CommandSpec, OptionSpec } from '../src/argv/spec';
import { builtins } from '../src/dict/builtins';
import { commands } from '../src/dict/commands';
import { argWords, render } from './support/argwords';
import { allTokens, explain, tokensOf } from './support/explain';

// (The tools run in a directory of their own, also for TMPDIR, in case one runs: `mktemp --t` makes a file.)
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prefixes-real-'));
const ENV: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', PATH: '/usr/bin:/bin', TMPDIR: DIR };
delete ENV.POSIXLY_CORRECT;
const has = (tool: string): boolean => spawnSync('bash', ['--norc', '-c', `command -v ${tool}`], { env: ENV }).status === 0;
/** GNU's: `--version` says so (sed, grep, coreutils, util-linux, findutils). */
const isGnu = (tool: string): boolean => /GNU|util-linux/.test(spawnSync(tool, ['--version'], { env: ENV, encoding: 'utf8' }).stdout ?? '');

/** The long options of a tool's `--help`: the `--name` words of its lines that start with an option. */
const longNames = (help: string): string[] => [...new Set(help.split('\n').filter((l) => /^\s+-/.test(l)).flatMap((l) => l.match(/--[a-z][a-z0-9-]*/g) ?? []))];

/** The entries read with getopt_long, by name: each must be in this list, so that a new one is compared too. */
const ENTRIES = [
  'timeout', 'env', 'nice', 'xargs', 'stdbuf', 'flock', 'sudo',
  'grep', 'sed', 'cut', 'head', 'tr', 'cat', 'tee', 'paste', 'seq', 'mktemp', 'basename', 'dirname',
  // coreutils in commands.ts
  'ls', 'sort', 'uniq', 'tail', 'wc', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'ln', 'realpath', 'readlink',
  'date', 'sleep', 'nohup', 'stat', 'du', 'df', 'install', 'tac', 'nl', 'comm', 'split', 'md5sum', 'sha256sum', 'base64',
  // diffutils, gzip, and coreutils in basic.ts
  'diff', 'gzip', 'gunzip', 'sdiff', 'diff3', 'users', 'logname', 'pinky', 'unlink', 'link', 'factor', 'sum', 'shred', 'mknod',
  'csplit', 'tsort', 'numfmt', 'pathchk', 'dircolors', 'pr',
  // coreutils and diffutils in distro.ts, system.ts, admin.ts, ops.ts
  'shuf', 'truncate', 'yes', 'printenv', 'fold', 'fmt', 'expand', 'unexpand', 'join', 'chgrp', 'mkfifo', 'b2sum', 'cksum', 'tty',
  'groups', 'who', 'id', 'whoami', 'uname', 'arch', 'nproc', 'stty', 'sha1sum', 'sha224sum', 'sha384sum', 'sha512sum', 'cmp', 'od',
  'chcon', 'runcon', 'sync', 'zcat',
  // GNU tar
  'tar',
];

/** The shortest prefix of `name` that no other name starts with, when it is shorter than the name. */
function uniquePrefix(name: string, all: string[]): string | undefined {
  for (let n = 3; n < name.length; n++) {
    const p = name.slice(0, n);
    if (all.filter((x) => x.startsWith(p)).length === 1) return p;
  }
  return undefined;
}

/** The tool's own reading of a prefix: the option it names (from glibc's message), or `ambiguous`; with the candidates of an ambiguous prefix and whether it does not know the name at all. */
function reading(tool: string, prefix: string, takesValue: boolean): { named?: string; candidates: string[]; unknown: boolean } {
  const r = spawnSync(tool, takesValue ? [prefix] : [`${prefix}=x`], { cwd: DIR, env: ENV, encoding: 'utf8', input: '', timeout: 10000 });
  const candidates = [.../possibilities:(.*)/.exec(r.stderr)?.[1].matchAll(/'(--[\w-]+)'/g) ?? []].map((m) => m[1]);
  if (/is ambiguous/.test(r.stderr)) return { named: 'ambiguous', candidates, unknown: false };
  const named = /option '(--[\w-]+)' (?:doesn't allow|requires) an argument/.exec(r.stderr)?.[1];
  return { named, candidates, unknown: /unrecognized option/.test(r.stderr) };
}

/** The names of the option a word is for the entry, or `ambiguous`. */
function ours(spec: CommandSpec, word: string): string[] | 'ambiguous' | undefined {
  const role = interpret(spec, [{ value: word }], { name: 'x', lookup: lookupCommand }).roles[0]?.role;
  if (role?.role === 'unknown-option') return role.ambiguous ? 'ambiguous' : undefined;
  return role?.role === 'option' ? role.spec.names : undefined;
}

/**
 * Options that differ between releases of the tool, left out (util-linux 2.39's flock has no `--command`, only `-c`).
 * RELEASES: the entries follow the tools of the CI runner (coreutils 9.4, grep 3.11, tar 1.35 on Ubuntu 24.04). When
 * the runner moves, the test only lists what changed: an option of the entry the tool does not know (when its
 * `--help` does not list it either), a long option of `--help` the entry lacks, and a hidden option that makes a
 * prefix ambiguous. Add the new options to the entry, and put an option whose reading differs here.
 */
const DIFFERS: Record<string, string[]> = { flock: ['--command'] };
/**
 * Tools that check their words before getopt_long and refuse a misused option with their own message (stty:
 * "invalid argument '--save=x'"): the names are checked in `--help`, the prefixes with ours only, and a row below
 * runs a prefix.
 */
const OWN_MESSAGES = ['stty'];

describe('getopt_long entries agree with the GNU tools', () => {
  it('lists every entry read with getopt_long', () => {
    const all = { ...commands, ...builtins };
    const found = Object.keys(all).filter((name) => all[name].parser === 'getopt_long');
    assert.deepStrictEqual(found.sort(), [...ENTRIES].sort());
  });

  // Over time a tool gains options, so what is checked is what stays: each long option of the entry is one the
  // tool has (its message names it), and each prefix that is unique among the entry's and the tool's names is read
  // as the tool reads it. The tool's options the entry lacks are only listed.
  for (const tool of ENTRIES) {
    (has(tool) && isGnu(tool) ? it : it.skip)(`${tool}: each long option of the entry, and its prefix, as the tool reads them`, () => {
      const spec = lookupCommand(tool)!;
      const help = spawnSync(tool, ['--help'], { env: ENV, encoding: 'utf8' }).stdout;
      const options = spec.options!.filter((o) => o.names.some((n) => n.startsWith('--')));
      const listed = options.flatMap((o) => o.names).filter((n) => n.startsWith('--'));
      const lacks = longNames(help).filter((n) => !listed.includes(n));
      if (lacks.length) console.log(`      (${tool} has long options the entry lacks: ${lacks.join(' ')})`);
      const names = [...new Set([...listed, ...longNames(help)])];
      const optional = (o: OptionSpec): boolean => [o.value ?? []].flat().some((v) => v.optional || v.how === 'attached-only');
      for (const o of options) {
        for (const name of o.names.filter((n) => n.startsWith('--'))) {
          if (DIFFERS[tool]?.includes(name)) continue;
          // (An option with an optional value is not run: `--name=x` would act. Its name is in --help.)
          if (optional(o) || OWN_MESSAGES.includes(tool)) {
            assert.ok(help.includes(name), `${tool} ${name}`);
            const prefix = uniquePrefix(name, names);
            if (prefix && OWN_MESSAGES.includes(tool)) assert.deepStrictEqual(ours(spec, prefix), o.names, `${tool} ${prefix}`);
            continue;
          }
          // (The tool names the option by one of its names: flock says `--nonblocking` for `--nonblock`.)
          const exists = reading(tool, name, o.value !== undefined);
          // Releases differ (RELEASES below): an option the tool here does not know, and its `--help` does not list,
          // may be one of a newer release (or an older one's, dropped since); it is only listed.
          if (exists.unknown && !help.includes(name)) { console.log(`      (${tool} here does not know ${name})`); continue; }
          assert.ok(exists.named && o.names.includes(exists.named), `${tool} ${name}: the tool reads ${exists.named}`);
          const prefix = uniquePrefix(name, names);
          if (!prefix) continue;
          assert.deepStrictEqual(ours(spec, prefix), o.names, `${tool} ${prefix}`);
          const named = reading(tool, prefix, o.value !== undefined);
          // A hidden option of the tool here that neither the entry nor `--help` names can make a prefix ambiguous.
          const hidden = named.candidates.filter((c) => !names.includes(c));
          if (named.named === 'ambiguous' && hidden.length) { console.log(`      (${tool} ${prefix}: also ${hidden.join(' ')}, which --help does not list)`); continue; }
          assert.ok(named.named && o.names.includes(named.named), `${tool} ${prefix}: the tool reads ${named.named}`);
        }
      }
    });
  }
});

describe('lines with long options, against the GNU tools', () => {
  after(() => fs.rmSync(DIR, { recursive: true, force: true }));
  const read = (line: string): string[] => {
    const { name, words, texts } = argWords(line);
    return render(interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }), texts);
  };
  const run = (line: string, input = ''): string => spawnSync('bash', ['--norc', '-c', line], { cwd: DIR, env: ENV, encoding: 'utf8', input }).stdout;

  (has('grep') ? it : it.skip)('grep --invert is --invert-match', () => {
    assert.strictEqual(run('grep --invert a', 'a\nb\n'), 'b\n');
    assert.match(read('grep --invert a')[0], /^--invert: --invert select non-matching lines$/);
  });
  // A prefix of several options: the tool refuses it, and the entry lists the same candidates.
  for (const [line, tool] of [['grep --in a', 'grep'], ['sed --s p', 'sed'], ['cut --c 1', 'cut'], ['head --v', 'head']]) {
    (has(tool) ? it : it.skip)(`${line}: ambiguous, as ${tool} says`, () => {
      const r = spawnSync('bash', ['--norc', '-c', line], { cwd: DIR, env: ENV, encoding: 'utf8', input: '' });
      assert.notStrictEqual(r.status, 0, line);
      const said = /is ambiguous; possibilities:(.*)/.exec(r.stderr);
      assert.ok(said, line);
      const theirNames = [...said[1].matchAll(/'(--[\w-]+)'/g)].map((m) => m[1]).sort();
      const { name, words } = argWords(line);
      const role = interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }).roles[0].role;
      assert.strictEqual(role.role, 'unknown-option', line);
      assert.deepStrictEqual([...(role.role === 'unknown-option' ? role.ambiguous ?? [] : [])].sort(), theirNames, line);
    });
  }
  (has('grep') ? it : it.skip)('grep --col=never: an optional value after `=`', () => {
    assert.strictEqual(run('grep --col=never a', 'a\nb\n'), 'a\n');
    assert.match(read('grep --col=never a')[0], /^--col=never: --col=6 highlight matches/);
  });
  // GNU grep refuses two different matchers (`-E -F`), but takes one given twice.
  for (const [line, refused] of [
    ['grep -E -G a', true], ['grep -E -F a', true], ['grep -EF a', true], ['grep -P -E a', true], ['grep -G --extended-regexp a', true],
    ['grep -E -E a', false], ['grep -F --fixed-strings a', false], ['grep -i -E a', false], ['grep -G a', false],
  ] as const) {
    (has('grep') && isGnu('grep') ? it : it.skip)(`${line}: ${refused ? 'refused' : 'taken'}, as grep does`, () => {
      const r = spawnSync('bash', ['--norc', '-c', line], { cwd: DIR, env: ENV, encoding: 'utf8', input: 'a\n' });
      assert.strictEqual(r.status, refused ? 2 : 0, line);
      assert.strictEqual(/conflicting matchers specified/.test(r.stderr), refused, line);
      assert.strictEqual(read(line).filter((l) => l.includes('conflicting matchers specified')).length, refused ? 1 : 0, line);
      // A refused line has no example, and its pattern is read in no flavour (not as a fixed string or a regex).
      const piped = `echo a | ${line}`;
      assert.strictEqual(explain(piped).examples.length === 0, refused, piped);
      const dotted = `${line}.`;
      const pattern = allTokens(tokensOf(dotted)).filter((t) => t.label === 'a.').pop()!;
      if (refused) assert.deepStrictEqual(pattern.children, [], dotted);
      else if (!/-F/.test(line)) assert.ok(pattern.children.some((t) => /any (single )?character/i.test(t.explanation)), dotted);
    });
  }
  // GNU tar refuses two different operations (`-c -x`), but takes one given twice.
  for (const [line, refused] of [
    ['tar -c -x -f a.tar', true], ['tar cxf a.tar', true], ['tar --create --get -f a.tar', true], ['tar -t --delete -f a.tar', true],
    ['tar -c -c -f a.tar -T /dev/null', false], ['tar cf a.tar --create -T /dev/null', false],
  ] as const) {
    (has('tar') && isGnu('tar') ? it : it.skip)(`${line}: ${refused ? 'refused' : 'taken'}, as tar does`, () => {
      const r = spawnSync('bash', ['--norc', '-c', line], { cwd: DIR, env: ENV, encoding: 'utf8', input: '' });
      assert.strictEqual(/You may not specify more than one/.test(r.stderr), refused, line);
      if (refused) assert.strictEqual(r.status, 2, line);
      else assert.strictEqual(r.status, 0, line);
      assert.strictEqual(read(line).filter((l) => l.includes('You may not specify more than one')).length, refused ? 1 : 0, line);
    });
  }
  (has('stty') ? it : it.skip)('stty --sa is --save, --fil is --file', () => {
    // (stty reads no terminal from a file: it refuses with an ioctl error, after reading its options.)
    const r = spawnSync('bash', ['--norc', '-c', 'stty --sa; stty --fil /dev/null; stty --sx'], { cwd: DIR, env: ENV, encoding: 'utf8', input: '' });
    assert.deepStrictEqual(r.stderr.split('\n').filter(Boolean).map((l) => /invalid argument|ioctl/.exec(l)?.[0]), ['ioctl', 'ioctl', 'invalid argument', undefined]);
    assert.match(read('stty --sa')[0], /^--sa: --sa print the settings in a form that can restore them$/);
    assert.deepStrictEqual(read('stty --fil /dev/null'), ['--fil: --fil terminal device', '/dev/null: value 0 of --fil VALUE']);
  });
  (has('xargs') ? it : it.skip)('xargs --max-lines takes no next word: the word is the command', () => {
    assert.strictEqual(run('xargs --max-lines echo X', 'a\nb\n'), 'X a\nX b\n');
    assert.strictEqual(run('xargs --max-lines=2 echo X', 'a\nb\n'), 'X a b\n');
    assert.match(read('xargs --max-lines echo X')[1], /^echo: command exec echo$/);
  });
  (has('mktemp') ? it : it.skip)('mktemp --tmpdir takes no next word: the word is the template', () => {
    assert.match(run('mktemp --tmpdir x.XXXX'), new RegExp(`^${DIR}/x\\.\\w{4}\\n$`));
    assert.match(read('mktemp --tmpdir x.XXXX')[1], /^x\.XXXX: /);
    assert.doesNotMatch(read('mktemp --tmpdir x.XXXX')[1], /value/);
  });
});
