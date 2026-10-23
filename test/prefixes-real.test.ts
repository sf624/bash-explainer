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
];

/** The shortest prefix of `name` that no other name starts with, when it is shorter than the name. */
function uniquePrefix(name: string, all: string[]): string | undefined {
  for (let n = 3; n < name.length; n++) {
    const p = name.slice(0, n);
    if (all.filter((x) => x.startsWith(p)).length === 1) return p;
  }
  return undefined;
}

/** The tool's own reading of a prefix: the option it names (from glibc's message), or `ambiguous`. */
function theirs(tool: string, prefix: string, takesValue: boolean): string | undefined {
  const r = spawnSync(tool, takesValue ? [prefix] : [`${prefix}=x`], { cwd: DIR, env: ENV, encoding: 'utf8', input: '', timeout: 10000 });
  if (/is ambiguous/.test(r.stderr)) return 'ambiguous';
  return /option '(--[\w-]+)' (?:doesn't allow|requires) an argument/.exec(r.stderr)?.[1];
}

/** The names of the option a word is for the entry, or `ambiguous`. */
function ours(spec: CommandSpec, word: string): string[] | 'ambiguous' | undefined {
  const role = interpret(spec, [{ value: word }], { name: 'x', lookup: lookupCommand }).roles[0]?.role;
  if (role?.role === 'unknown-option') return role.ambiguous ? 'ambiguous' : undefined;
  return role?.role === 'option' ? role.spec.names : undefined;
}

/** Options that differ between releases of the tool, left out (util-linux 2.39's flock has no `--command`, only `-c`). */
const DIFFERS: Record<string, string[]> = { flock: ['--command'] };

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
          if (optional(o)) { assert.ok(help.includes(name), `${tool} ${name}`); continue; }
          // (The tool names the option by one of its names: flock says `--nonblocking` for `--nonblock`.)
          const exists = theirs(tool, name, o.value !== undefined);
          assert.ok(exists && o.names.includes(exists), `${tool} ${name}: the tool reads ${exists}`);
          const prefix = uniquePrefix(name, names);
          if (!prefix) continue;
          assert.deepStrictEqual(ours(spec, prefix), o.names, `${tool} ${prefix}`);
          const named = theirs(tool, prefix, o.value !== undefined);
          assert.ok(named && o.names.includes(named), `${tool} ${prefix}: the tool reads ${named}`);
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
