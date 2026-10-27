// Argv capture over the fixtures (docs/design/oracles.md, 2 and step 2): each fixture runs in bash with its commands
// replaced by a recorder (test/support/argv.ts), and the fields the word model gives each word of each command
// (`wordFields`: what the explanation says the program receives) are compared with the argv bash gave the recorder.
//
// The inputs: test/fixtures/sample.sh and coverage.sh, each section of sample.sh on its own, and the shell code of each
// host fixture that bash runs (a region, or the regions that run in one shell), each with the model the explanation
// builds for it. posix.sh and ksh.ksh, and the regions of sh and of bats, are not run (another shell, or bats around
// the script). Each input runs twice (`ARGV_ENVS`): in the probes' environment (`ARGV_ENV`: no other variable, no
// positional parameter, stdin empty), and with values for the variables it reads, two positional parameters and lines
// on stdin (a space, a glob, an empty one).
//
// No command may reach a PATH search. A difference (`compareMarker`) is listed in test/fixtures/argv-known.json with its
// reason; an entry that no longer differs fails, and so do counts that changed (update them when the fixtures change).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { extractShell, hostKind } from '../src/hosts';
import { hostProvided } from '../src/hosts/remap';
import { scriptTree } from '../src/hosts/scripts';
import { fileRead } from '../src/semantics/env';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { SyntaxTree } from '../src/syntax/tree';
import { type ArgvCounts, type ArgvEnvName, type ArgvInput, checkArgv, instrumentArgv, runArgvBatch } from './support/argv';
import { probeSkipReason } from './support/probe';

const FIXTURES = path.join(__dirname, 'fixtures');

interface Known {
  counts: Record<ArgvEnvName, ArgvCounts>;
  known: { input: string; command: string; env?: ArgvEnvName; reason: string }[];
}

/**
 * The fixtures bash runs, each with the model the explanation reads (src/analyzer.ts, src/hosts/remap.ts): sample.sh and
 * coverage.sh; each section of sample.sh on its own (in place, the other lines blank), since `set -e` stops the whole
 * file early; and the shell code of the host fixtures that bash runs.
 */
function inputs(): ArgvInput[] {
  const parser = createUnbashParser();
  const out: ArgvInput[] = [];
  const add = (name: string, text: string): void => {
    const tree = parser.parse(text);
    out.push({ name, tree, model: shellState(tree, 'bash'), provided: [] });
  };
  for (const name of ['sample.sh', 'coverage.sh']) add(name, fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
  const lines = fs.readFileSync(path.join(FIXTURES, 'sample.sh'), 'utf8').split('\n');
  const heads = lines.flatMap((l, i) => (/^# --- .* ---$/.test(l) ? [i] : []));
  heads.forEach((from, k) => {
    const to = heads[k + 1] ?? lines.length;
    add(`sample.sh ${lines[from]}`, lines.map((l, i) => (i >= from && i < to ? l : '')).join('\n'));
  });
  for (const file of fs.readdirSync(path.join(FIXTURES, 'hosts')).sort()) {
    const extracted = extractShell(hostKind('', file)!, fs.readFileSync(path.join(FIXTURES, 'hosts', file), 'utf8'));
    const whole = parser.parse(extracted.text);
    const seen = new Set<SyntaxTree>();
    for (const region of extracted.regions) {
      if ((region.shell ?? 'bash') !== 'bash' || region.run || region.commands) continue;
      const tree = scriptTree(whole, extracted, region);
      if (seen.has(tree)) continue;
      seen.add(tree);
      const provided = hostProvided(extracted, region);
      const model = shellState(tree, region.shell, { read: fileRead(tree.root, region.host), ...(provided.length ? { provided } : {}) });
      out.push({ name: `hosts/${file}:${region.start + 1}`, tree, model, provided });
    }
  }
  return out;
}

describe('argv capture: the word model against bash (oracles.md, step 2)', function () {
  this.timeout(120000);

  it('replaces each command by a recorder, keeps state builtins and functions, and sends redirections to /dev/null', () => {
    const script = [
      'f() { x=1 cmd "$1" >out 2>&1; }',
      'f a; set -e; read -r v <in; [ -f a ] && printf -v y %s z',
      'while getopts a o; do :; done; while next; do :; done; until ready; do :; done',
      'cat <(ls) >&$fd {fd}>log; { echo; } >/tmp/o; >o echo $(date >d)',
    ].join('\n');
    const tree = createUnbashParser().parse(script);
    const inst = instrumentArgv(tree, shellState(tree, 'bash'));
    assert.strictEqual(inst.script, [
      'f() { x=1 __probe 1 cmd "$1"  @@R@@ out @@E@@ >/dev/null 2>&1; }',
      'f a; set -e; read -r v  </dev/null; __probe_r 2 [ -f a ] && __probe_r 3 printf -v y %s z',
      'while getopts a o; do __probe_r 4 :; done; while __probe_w 5 next; do __probe_r 6 :; done; until __probe_u 7 ready; do __probe_r 8 :; done',
      '__probe 9 cat <(__probe 10 ls)  >/dev/null  @@R@@ log @@E@@ {fd}>/dev/null; { __probe 11 echo; }  >/dev/null;  >/dev/null __probe 12 echo $(__probe 13 date  @@R@@ d @@E@@ >/dev/null)',
    ].join('\n'));
    assert.deepStrictEqual(inst.unmarked, { function: 1, state: 3 });
    assert.deepStrictEqual(inst.markers.map((m) => [m.kind, m.words.map((w) => w.text).join(' '), m.targets.map((t) => t.text).join(' ')]), [
      ['stub', 'cmd "$1"', 'out'], ['run', '[ -f a ]', ''], ['run', 'printf -v y %s z', ''], ['run', ':', ''], ['while', 'next', ''],
      ['run', ':', ''], ['until', 'ready', ''], ['run', ':', ''], ['stub', 'cat <(ls)', 'log'], ['stub', 'ls', ''], ['stub', 'echo', ''],
      ['stub', 'echo $(date >d)', ''], ['stub', 'date', 'd'],
    ]);
    // A function defined in a string `eval` runs is not defined in the run, where `eval` is recorded.
    const evaluated = createUnbashParser().parse("eval 'g() { :; }'; g; h() { :; }; h");
    assert.deepStrictEqual(instrumentArgv(evaluated, shellState(evaluated, 'bash')).script, "__probe 1 eval 'g() { :; }'; __probe 2 g; h() { __probe_r 3 :; }; h");
  });

  if (probeSkipReason) {
    it.skip(`needs bash 5.2 or later: ${probeSkipReason}`, () => undefined);
    return;
  }

  it('keeps a command it did not replace from running: no PATH, the builtins that reach out turned off', async () => {
    const [run] = await runArgvBatch([{ script: 'ls -l; eval date; source ./x; trap "id" EXIT; __probe 1 "$PATH" "$HOME" ~ * >o\n' }]);
    assert.deepStrictEqual(run.escaped, ['ls', 'eval', 'source', 'trap']);
    assert.deepStrictEqual([...run.records], [['1', [['/nonexistent/explain-bash-argv', '/BOX', '/BOX', 'a.txt', 'b.txt', 'c.log', 'empty', 'sub', 'x y.txt']]]]);
  });

  it('gives every command of the fixtures the fields bash gives it', async () => {
    const known = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'argv-known.json'), 'utf8')) as Known;
    const { found, escaped, counts } = await checkArgv(inputs());
    const used = new Set<number>();
    const unexplained = found.filter((f) => {
      const k = known.known.findIndex((e) => e.input === f.input && e.command === f.command && (!e.env || e.env === f.env));
      if (k >= 0) used.add(k);
      return k < 0;
    }).map((f) => `${f.input} (${f.env}): ${f.command}\n    ${f.what}`);
    const stale = known.known.filter((_, k) => !used.has(k)).map((e) => `${e.input}: ${e.command}`);
    assert.deepStrictEqual({ escaped, unexplained, stale, counts }, { escaped: [], unexplained: [], stale: [], counts: known.counts });
  });
});
