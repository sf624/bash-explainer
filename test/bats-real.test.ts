// bats test files, compared with the real bats-core (the devDependency `bats`, run as a separate program): what we
// say of a test, of `run` and of the pitfalls holds when bats runs it. Each row is the body of one test; the row says
// whether bats passes it, and which facts of bats (src/bats.ts) the explanation says on which of its lines.
// Behaviour that differs between bats releases is left out. Skipped when bats or bash cannot be run.
import * as assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { batsTestName, explainHostedLine, extractShell } from '../src/hosts';
import { shellState } from '../src/semantics/state';
import { statusModel } from '../src/semantics/status';
import { tagComment } from '../src/hosts/batstags';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';

const BATS = path.join(__dirname, '..', 'node_modules', 'bats', 'bin', 'bats');
const usable = fs.existsSync(BATS) && spawnSync('bash', ['--norc', '-c', 'true']).status === 0;

/**
 * Runs bats on a file and gives the TAP lines of its tests: in a process group of its own, killed whole on a
 * timeout, with FUNCNEST set so that a runaway recursion stops.
 */
function runBats(file: string, locale = 'C', timeout = 30000, args: string[] = [], env: Record<string, string> = {}): Promise<{ tap: string[]; out: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(BATS, ['--tap', ...args, file], { cwd: path.dirname(file), detached: true, env: { ...process.env, FUNCNEST: '20', LC_ALL: locale, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => { out += d; });
    child.stderr.on('data', (d: Buffer) => { err += d; });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone already */ }
      reject(new Error(`bats timed out on ${file}\n${out}${err}`));
    }, timeout);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ tap: out.split('\n').filter((l) => /^(not )?ok \d/.test(l)), out: out + err, code });
    });
  });
}

interface Row {
  /** What the row shows. */
  title: string;
  /** Lines before the tests (`bats_require_minimum_version`, `load`…). */
  head?: string[];
  /** The lines of the test's body. */
  body: string[];
  /** What bats reports: the test passes, fails, or is skipped. */
  bats: 'ok' | 'not ok' | 'skip';
  /** The facts of bats said on lines of the body (0-based), besides `bats-test` on the `@test` line. */
  says?: Record<number, string[]>;
  /** Files next to the test file. */
  files?: Record<string, string>;
  /** The body of a second test, run after the first, which bats passes. */
  next?: string[];
  /**
   * The conditions decided, by line of the file after its shebang (0-based: the head, the `@test` line, the body, its
   * `}`, then the next test): the facts' ids. No other line has one.
   */
  decides?: Record<number, string[]>;
  /** The facts of bats said on lines of the head (0-based), as `says`. */
  headSays?: Record<number, string[]>;
  /** Whether `set -e` stops the shell when the statement on a line fails (`active`, src/semantics/status.ts), by line as for `decides`. */
  errexit?: Record<number, 'on' | 'off' | 'unknown'>;
}

const ROWS: Row[] = [
  {
    title: 'run returns 0, and keeps the status in $status and the output, stderr included, in $output and $lines',
    body: ["run sh -c 'echo a; echo b >&2; exit 3'", '[ $? -eq 0 ]', '[ "$status" -eq 3 ]', `[ "$output" = "a"$'\\n'"b" ]`, '[ "${lines[1]}" = b ]'],
    bats: 'ok',
  },
  {
    title: "run's command runs in a subshell: what it sets is lost",
    body: ['f() { x=1; }', 'run f', '[ -z "${x-}" ]', 'f', '[ "$x" = 1 ]'],
    bats: 'ok',
  },
  {
    title: 'a test runs with set -e: a command that fails stops it',
    body: ['false', 'true'],
    bats: 'not ok',
  },
  {
    title: 'each test runs in a process of its own: what one sets does not reach the next',
    body: ['X=1', 'export Y=1', 'f() { :; }'],
    bats: 'ok',
    next: ['[ -z "${X-}" ] && [ -z "${Y-}" ]', '! type f'],
  },
  {
    title: 'bats rewrites @test in a here-document or a string too, but bash reads it as text there',
    head: ['cat <<EOF >/dev/null', '@test "inner" {', 'EOF', "x='", '@test "in string" {', "'"],
    body: ['[ -n "$x" ]'],
    bats: 'ok',
  },
  {
    title: 'set -e is ignored on the left of && and in a condition',
    body: ['false && true', 'if false; then :; fi', 'true'],
    bats: 'ok',
  },
  {
    title: '`! cmd` that is not the last command does not fail the test',
    body: ['! true', 'true'],
    bats: 'ok',
    says: { 0: ['bats-negation-ignored'] },
  },
  {
    title: '`! x=1` that is not the last command does not fail the test',
    body: ['! x=1', 'true'],
    bats: 'ok',
    says: { 0: ['bats-negation-ignored'] },
  },
  {
    title: '`! cmd | cmd` that is not the last command does not fail the test',
    body: ['! echo x | grep -q x', 'true'],
    bats: 'ok',
    says: { 0: ['bats-negation-ignored'] },
  },
  {
    title: '`run ! bats_pipe cmd \\| cmd` fails the test when the pipeline succeeds',
    head: ['bats_require_minimum_version 1.5.0'],
    body: ['run ! bats_pipe echo x \\| grep -q x', 'true'],
    bats: 'not ok',
  },
  {
    title: '`! { cmd; } || false` fails the test',
    body: ['! { true; } || false', 'true'],
    bats: 'not ok',
  },
  {
    title: '`! cmd` as the last command fails the test',
    body: ['true', '! true'],
    bats: 'not ok',
  },
  {
    title: '`! cmd || false` fails the test',
    body: ['! true || false', 'true'],
    bats: 'not ok',
  },
  {
    title: '`run ! cmd` fails the test when the command succeeds',
    head: ['bats_require_minimum_version 1.5.0'],
    body: ['run ! true', 'true'],
    bats: 'not ok',
  },
  {
    title: '`run ! cmd` passes when the command fails, and sets $status',
    head: ['bats_require_minimum_version 1.5.0'],
    body: ['run ! false', '[ "$status" -eq 1 ]'],
    bats: 'ok',
  },
  {
    title: '`run -N` fails the test unless the status is N',
    head: ['bats_require_minimum_version 1.5.0'],
    body: ["run -2 sh -c 'exit 2'", 'run -1 true', 'true'],
    bats: 'not ok',
  },
  {
    title: '`run --separate-stderr` keeps stderr in $stderr and $stderr_lines',
    head: ['bats_require_minimum_version 1.5.0'],
    body: ["run --separate-stderr sh -c 'echo out; echo err >&2'", '[ "$output" = out ]', '[ "$stderr" = err ]', '[ "${stderr_lines[0]}" = err ]'],
    bats: 'ok',
  },
  {
    title: '`run cmd | …`: the pipe gets nothing, and $status and $output are lost',
    body: ['status=7 output=old', 'run echo hi | wc -c > count', '[ "$(cat count)" -eq 0 ]', '[ "$status" = 7 ] && [ "$output" = old ]'],
    bats: 'ok',
    says: { 1: ['bats-run-in-pipeline'] },
  },
  {
    title: '`run cmd | grep` fails the test: grep gets nothing',
    body: ['run echo hi | grep -q hi', 'true'],
    bats: 'not ok',
    says: { 0: ['bats-run-in-pipeline'] },
  },
  {
    title: '`… | run cmd`: run reads the pipe, but its $status and $output are lost',
    body: ['status=7 output=old', 'echo hi | run cat', '[ "$status" = 7 ] && [ "$output" = old ]'],
    bats: 'ok',
    says: { 1: ['bats-run-in-pipeline-stage'] },
  },
  {
    title: '`… | run cmd` with lastpipe: the last stage runs in the test, and keeps $output',
    body: ['shopt -s lastpipe', 'echo hi | run cat', '[ "$output" = hi ]'],
    bats: 'ok',
  },
  {
    title: '`run` with an option it does not know fails the test',
    head: ['bats_require_minimum_version 1.5.0'],
    body: ['run -x true', 'true'],
    bats: 'not ok',
  },
  {
    title: '`run bats_pipe cmd \\| cmd` runs the pipeline under run',
    body: ["run bats_pipe printf 'a\\nb\\n' \\| grep b", '[ "$output" = b ]', '[ "$status" -eq 0 ]'],
    bats: 'ok',
  },
  {
    title: 'bats_pipe gives the status of the last command that fails',
    body: ["run bats_pipe sh -c 'exit 3' \\| sh -c 'exit 4' \\| true", '[ "$status" -eq 4 ]', "run bats_pipe -0 sh -c 'exit 3' \\| true", '[ "$status" -eq 3 ]'],
    bats: 'ok',
  },
  {
    title: 'skip stops the test and reports it skipped',
    body: ['skip "not yet"', 'false'],
    bats: 'skip',
  },
  {
    title: 'load reads NAME.bash from the directory of the test file into the current shell',
    head: ['load helper'],
    body: ['[ "$(greet)" = hello ]', '[ "$LOADED" = 1 ]'],
    bats: 'ok',
    files: { 'helper.bash': 'LOADED=1\ngreet() { echo hello; }\n' },
  },
  {
    title: 'load of a missing file in setup fails only the test it runs for',
    head: ['setup() {', '  if [ "$BATS_TEST_DESCRIPTION" != "${BATS_TEST_DESCRIPTION%, next}" ]; then return; fi', '  load no_such_helper', '}'],
    body: ['true'],
    bats: 'not ok',
    next: ['true'],
    headSays: { 0: ['bats-hook'] },
  },
  {
    title: 'load of a missing file at the top stops the whole file',
    head: ['load no_such_helper'],
    body: ['true'],
    bats: 'not ok',
  },
  // bats' functions are read by their specs: `load` runs a file the model does not read, so no condition of the file
  // is decided, and `run` sets `$status`, which no condition is decided from.
  {
    title: 'load may set a variable a later condition reads',
    head: ['x=1', 'load helper', 'if [ "$x" = 1 ]; then exit 3; fi'],
    body: ['[ "$x" = 2 ]'],
    bats: 'ok',
    files: { 'helper.bash': 'x=2\n' },
  },
  {
    title: 'run sets $status, which a later condition reads',
    head: ['status=0', 'run false', 'if [ "$status" = 0 ]; then exit 3; fi'],
    body: ['true'],
    bats: 'ok',
  },
  {
    title: "run's command runs in a subshell: `x=2` there does not reach the test",
    body: ['x=1', "run bash -c 'x=2'", 'if [ "$x" = 1 ]; then true; else false; fi'],
    bats: 'ok',
    decides: { 3: ['condition-always-true'] },
  },
  // The other functions set nothing a condition reads: a file that calls them gets the decisions it has without them.
  {
    title: "run's command runs in a subshell: a condition after it is decided",
    head: ['x=1', "run bash -c 'x=2'", 'if [ "$x" = 1 ]; then :; else exit 3; fi'],
    body: ['true'],
    bats: 'ok',
    decides: { 2: ['condition-always-true'] },
  },
  {
    title: 'skip in a test does not keep a condition of the file from being decided',
    head: ['x=1', 'if [ "$x" = 2 ]; then exit 3; fi'],
    body: ['skip "not yet"', 'false'],
    bats: 'skip',
    decides: { 1: ['condition-always-false'] },
  },
  {
    title: 'bats_require_minimum_version, and bats_pipe run by run (in a subshell), set nothing a condition reads',
    head: ['bats_require_minimum_version 1.5.0', 'x=1', 'if [ "$x" = 2 ]; then exit 3; fi'],
    body: ["run bats_pipe printf 'a\\n' \\| cat", '[ "$output" = a ]'],
    bats: 'ok',
    decides: { 2: ['condition-always-false'] },
  },
  {
    // (bats_pipe evals the pipeline in the shell that calls it: with lastpipe, `read x` sets `x` there.)
    title: 'bats_pipe called by the file runs a command line the model does not read: no condition of the file is decided',
    head: ['shopt -s lastpipe', 'x=1', 'bats_pipe echo 2 \\| read x', 'if [ "$x" = 1 ]; then exit 3; fi'],
    body: ['[ "$x" = 2 ]'],
    bats: 'ok',
  },
  // How bats runs the file: with `set -eET` from its first line, then each test in a process of its own, after
  // `setup` and before `teardown` (bats-exec-test), which the model reads (src/semantics/walk/host.ts).
  {
    title: 'the code outside the tests runs with set -e: a command that fails there stops the file',
    head: ['false'],
    body: ['true'],
    bats: 'not ok',
    errexit: { 0: 'on' },
  },
  {
    title: 'a test sees the variables of the file and of setup, and runs with set -e',
    head: ['x=1', 'setup() {', '  y=2', '}'],
    body: ['if [ "$x$y" = 12 ]; then :; else false; fi', 'false', 'true'],
    bats: 'not ok',
    headSays: { 1: ['bats-hook'] },
    decides: { 5: ['condition-always-true'] },
    errexit: { 2: 'on', 6: 'on' },
  },
  {
    title: 'a test does not see what another test set',
    head: ['x=0 y=0'],
    body: ['x=1', 'export y=1'],
    bats: 'ok',
    next: ['if [ "$x$y" = 00 ]; then :; else false; fi'],
    decides: { 6: ['condition-always-true'] },
  },
  {
    title: 'setup stops at a command that fails, and the test does not run',
    head: ['setup() {', '  false', '  touch ran', '}'],
    body: ['true'],
    bats: 'not ok',
    headSays: { 0: ['bats-hook'] },
    errexit: { 1: 'on' },
  },
  {
    title: 'teardown is called on the left of ||: set -e is ignored in it',
    head: ['teardown() {', '  false', '  true', '}'],
    body: ['true'],
    bats: 'ok',
    headSays: { 0: ['bats-hook'] },
    errexit: { 1: 'off' },
  },
  {
    title: 'teardown fails the test when it returns a status that is not 0',
    head: ['teardown() {', '  true', '  false', '}'],
    body: ['true'],
    bats: 'not ok',
    headSays: { 0: ['bats-hook'] },
  },
  {
    title: 'teardown runs after a test that set -e stopped, with what the test set',
    head: ['teardown() {', '  if [ "$x" = 1 ]; then rm -f "$BATS_TEST_DIRNAME/mark"; fi', '}'],
    body: ['touch "$BATS_TEST_DIRNAME/mark"', 'x=1', 'false'],
    bats: 'not ok',
    headSays: { 0: ['bats-hook'] },
    next: ['[ ! -e "$BATS_TEST_DIRNAME/mark" ]'],
  },
  {
    title: 'setup_file runs in a process of its own: only what it exports reaches the tests',
    head: ['setup_file() {', '  export e=1', '  n=1', '}', 'teardown_file() {', '  false', '  [ "$n" = 1 ]', '}'],
    body: ['[ "$e" = 1 ]', 'if [ -z "${n-}" ]; then :; else false; fi'],
    bats: 'ok',
    headSays: { 0: ['bats-hook'], 4: ['bats-hook'] },
    errexit: { 1: 'on', 5: 'off' },
  },
];

/** The test file of a row: its head, its test, and the next test. */
const source = (row: Row, i: number): string[] => [
  '#!/usr/bin/env bats', ...(row.head ?? []), `@test "row ${i}" {`, ...row.body.map((l) => `  ${l}`), '}',
  ...(row.next ? [`@test "row ${i}, next" {`, ...row.next.map((l) => `  ${l}`), '}'] : []),
];

describe('bats files agree with the real bats', function () {
  this.timeout(120000);
  let dir: string;
  let tap: string[] = [];
  before(async function () {
    if (!usable) return this.skip();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-bats-'));
    // Each row is a file of its own: a `head` line runs for every test of its file.
    tap = [];
    for (const [i, row] of ROWS.entries()) {
      const file = path.join(dir, `row${i}.bats`);
      for (const [name, text] of Object.entries(row.files ?? {})) fs.writeFileSync(path.join(dir, name), text);
      fs.writeFileSync(file, [...source(row, i), ''].join('\n'));
      const out = (await runBats(file)).tap;
      tap.push(out[0] ?? '(no result)');
      if (row.next) assert.match(out[1] ?? '', /^ok 2 /, `the next test of row ${i}: ${out[1]}`);
    }
  });
  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('names a test as bats does in a UTF-8 locale', async function () {
    if (!usable) return this.skip();
    const file = path.join(dir, 'name.bats');
    // (`Ⓐ` is a letter, `٣` a digit, `²` and `½` neither: glibc's `[[:alnum:]]`.)
    fs.writeFileSync(file, '@test "café ü-x²Ⓐ٣½" {\n  echo "name=$BATS_TEST_NAME" >&3\n}\n');
    const { out } = await runBats(file, 'C.UTF-8');
    assert.match(out, new RegExp(`^name=${batsTestName('café ü-x²Ⓐ٣½')}$`, 'm'));
    assert.strictEqual(batsTestName('x²Ⓐ٣½'), 'test_x-b2Ⓐ٣-bd');
  });

  it('warns (BW02) about any option of run without bats_require_minimum_version 1.5.0', async function () {
    if (!usable) return this.skip();
    const file = path.join(dir, 'bw02.bats');
    fs.writeFileSync(file, '@test "a" {\n  run -- true\n}\n');
    assert.match((await runBats(file)).out, /BW02: Using flags on `run` requires at least BATS_VERSION=1\.5\.0/);
  });

  it('calls the hooks in the order, and in the processes, the model reads', async function () {
    if (!usable) return this.skip();
    const file = path.join(dir, 'hooks.bats');
    // (bats gives the tests fd 3 for what they print; the code outside them prints to stderr.)
    const mark = (what: string, fd = 3) => `echo "${what} $BASHPID $-" >&${fd}`;
    const text = [`${mark('file', 2)}`, `setup_file() { ${mark('setup_file')}; }`, `teardown_file() { ${mark('teardown_file')}; }`,
      `setup() { ${mark('setup')}; }`, `teardown() { ${mark('teardown')}; }`, `@test "a" { ${mark('a')}; }`, `@test "b" { ${mark('b')}; }`];
    fs.writeFileSync(file, `${text.join('\n')}\n`);
    // (bats reads the file again in each process: `file` is said once in the process of setup_file, and once in each
    // test's process. It is said on stderr, which comes apart from the rest.)
    const lines = (await runBats(file)).out.split('\n').filter((l) => /^(file|setup|teardown|setup_file|teardown_file|a|b) \d+ /.test(l)).map((l) => l.split(' '));
    const ran = lines.filter((l) => l[0] !== 'file');
    assert.deepStrictEqual(ran.map((l) => l[0]), ['setup_file', 'setup', 'a', 'teardown', 'setup', 'b', 'teardown', 'teardown_file']);
    // (Each test in a process of its own, with its setup and teardown; setup_file and teardown_file in another.)
    const pids = ran.map((l) => l[1]);
    assert.deepStrictEqual([pids[0] === pids[7], pids[1] === pids[3], pids[4] === pids[6], new Set([pids[0], pids[1], pids[4]]).size], [true, true, true, 3]);
    assert.deepStrictEqual(lines.filter((l) => l[0] === 'file').map((l) => l[1]).sort(), [pids[0], pids[1], pids[4]].sort());
    // (`set -eET` in all of them.)
    for (const l of lines) assert.match(l[2], /^(?=.*e)(?=.*E)(?=.*T)/, l.join(' '));
    // The model: the hooks and the tests called by bats, as such.
    const extracted = extractShell('bats', text.join('\n'));
    const tree = createUnbashParser().parse(extracted.text);
    const calls = shellState(tree, undefined, { host: extracted.regions[0].commands, run: extracted.regions[0].run }).hostCalls;
    assert.deepStrictEqual([...calls].map(([d, c]) => `${d.startPosition.row}:${c.process}:${c.role}:${c.ignored}`).sort(),
      ['1:file:before:false', '2:file:after:true', '3:test:before:false', '4:test:after:true', '5:test:test:false', '6:test:test:false']);
  });

  it('warns (BW03) about a setup_suite in a test file, and does not call it', async function () {
    if (!usable) return this.skip();
    const file = path.join(dir, 'bw03.bats');
    fs.writeFileSync(file, 'setup_suite() { echo called >&3; }\n@test "a" {\n  true\n}\n');
    const { out } = await runBats(file);
    assert.match(out, /BW03: `setup_suite` is visible to test file/);
    assert.doesNotMatch(out, /called/);
    const text = ['setup_suite() { :; }'];
    const extracted = extractShell('bats', text.join('\n'));
    const ex = explainHostedLine(new Analyzer('en'), createUnbashParser().parse(extracted.text), extracted, text, 0, 'en')!;
    assert.deepStrictEqual(ex.facts!.map((f) => f.id), ['bats-setup-suite-in-test-file']);
  });

  for (const [i, row] of ROWS.entries()) {
    it(row.title, function () {
      if (!usable) return this.skip();
      const result = tap[i];
      const got = /^ok \d+ .* # skip/.test(result) ? 'skip' : result.startsWith('ok ') ? 'ok' : 'not ok';
      assert.strictEqual(got, row.bats, result);
      // The explanation of the same file: `bats-test` on the test's line, and the facts the row lists.
      const text = source(row, i);
      const extracted = extractShell('bats', text.join('\n'));
      const tree = createUnbashParser().parse(extracted.text);
      const at = 1 + (row.head?.length ?? 0);
      for (let n = 0; n < text.length; n++) {
        const ex = explainHostedLine(new Analyzer('en'), tree, extracted, text, n, 'en')!;
        const ids = (ex.facts ?? []).map((f) => f.id).filter((id) => id.startsWith('bats-'));
        const want = n === at || n === at + row.body.length + 2 ? ['bats-test'] : (n < at ? row.headSays?.[n - 1] : row.says?.[n - at - 1]) ?? [];
        assert.deepStrictEqual(ids, want, `line ${n + 1}: ${text[n]}`);
        // (The conditions decided, on the lines of the head the row names; none elsewhere.)
        assert.deepStrictEqual((ex.facts ?? []).map((f) => f.id).filter((id) => id.startsWith('condition-')), row.decides?.[n - 1] ?? [], `line ${n + 1}: ${text[n]}`);
      }
      // (Whether `set -e` stops the shell at the first statement of a line, in the model the explanation reads.)
      const region = extracted.regions[0];
      const status = statusModel(shellState(tree, undefined, { host: region.commands, run: region.run }));
      for (const [k, want] of Object.entries(row.errexit ?? {})) {
        const n = Number(k) + 1;
        const stmt = descendants(tree.root, ['command']).find((c) => c.startPosition.row === n)!;
        assert.strictEqual(status.errexit(stmt).active, want, `line ${n + 1}: ${text[n]}`);
      }
    });
  }
});

// Tag comments (`# bats test_tags=…`, `# bats file_tags=…`) and the other form of a test (`name() { # @test`).
describe('bats tags and marked functions agree with the real bats', function () {
  this.timeout(120000);
  let dir: string;
  before(function () {
    if (!usable) return this.skip();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-bats-tags-'));
  });
  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, lines: string[]): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, [...lines, ''].join('\n'));
    return file;
  };
  /** Our explanation of a line of a bats file. */
  const explain = (lines: string[], line: number, lang: 'ja' | 'en' = 'en') => {
    const extracted = extractShell('bats', lines.join('\n'));
    const tree = createUnbashParser().parse(extracted.text);
    return explainHostedLine(new Analyzer(lang), tree, extracted, lines, line, lang)!;
  };
  /** What we say of the tags of each test of a file, read from the tag comments as we explain them: the sorted tags. */
  const sayTags = (lines: string[]): string[] => {
    let file: string[] = [];
    let test: string[] = [];
    const out: string[] = [];
    lines.forEach((l, n) => {
      const c = tagComment(l);
      if (c) {
        // (We say the same on the line: the tags in code spans.)
        const said = explain(lines, n).facts!.find((f) => f.id === 'bats-tags')!;
        assert.ok(c.tags.every((t) => said.text.includes(`\`${t}\``)), said.text);
        if (c.scope === 'test') test = c.tags; else file = c.tags;
      } else if (/^@test |# @test$/.test(l)) {
        out.push([...test, ...file].sort().join(' '));
        test = [];
      }
    });
    return out;
  };

  it('gives test_tags to the next test only, and file_tags to every later test, sorted (BATS_TEST_TAGS)', async function () {
    if (!usable) return this.skip();
    const show = ['  echo "T:${BATS_TEST_TAGS[*]}" >&3', '}'];
    const lines = [
      '# bats file_tags=z, y', '# bats test_tags=b,a:1', '@test "one" {', ...show, '@test "two" {', ...show,
      '# bats file_tags=', '# bats test_tags=q', '# bats test_tags=r', '@test "three" {', ...show,
      '# bats test_tags=s', '# bats test_tags=', '@test "four" {', ...show,
      '# bats file_tags=f', 'marked() { # @test', ...show,
    ];
    const { out, tap } = await runBats(write('tags.bats', lines));
    assert.strictEqual(tap.length, 5, out);
    assert.deepStrictEqual(out.split('\n').filter((l) => l.startsWith('T:')).map((l) => l.slice(2)), sayTags(lines));
    assert.deepStrictEqual(sayTags(lines), ['a:1 b y z', 'y z', 'r', '', 'f']);
    // (Of two `test_tags` lines before one test, bats keeps the last: the first says so, and an empty one cancels.)
    const said = (n: number) => explain(lines, n).facts!.find((f) => f.id === 'bats-tags')!.text;
    assert.match(said(lines.indexOf('# bats test_tags=q')), /a later `# bats test_tags=` line before the same test replaces them/);
    assert.match(said(lines.indexOf('# bats test_tags=')), /cancels an earlier `test_tags` before the same test/);
  });

  it('selects tests with --filter-tags: all the tags, !tag, several options as alternatives, an empty list for untagged tests', async function () {
    if (!usable) return this.skip();
    const lines = ['# bats file_tags=z', '# bats test_tags=a', '@test "A" {', '  :', '}', '# bats test_tags=a,b', '@test "AB" {', '  :', '}', '@test "Z" {', '  :', '}', '# bats file_tags=', '@test "none" {', '  :', '}'];
    const file = write('filter.bats', lines);
    const ran = async (...filters: string[]) => (await runBats(file, 'C', 30000, filters.flatMap((f) => ['--filter-tags', f]))).tap.map((l) => l.replace(/^ok \d+ /, ''));
    assert.deepStrictEqual(sayTags(lines), ['a z', 'a b z', 'z', '']);
    assert.deepStrictEqual(await ran('a,b'), ['AB']);
    assert.deepStrictEqual(await ran('z,!b'), ['A', 'Z']);
    assert.deepStrictEqual(await ran('b', '!a,z'), ['AB', 'Z']);
    assert.deepStrictEqual(await ran(''), ['none']);
  });

  const LISTS: [list: string, valid: true | 'syntax' | 'empty'][] = [
    ['', true], ['a', true], [' a , b ', true], ['a-b:c_d,E9', true],
    ['a,,b', 'syntax'], ['a,', 'syntax'], ['a b', 'syntax'], ['a;b', 'syntax'], ['a,  ,c', 'syntax'], [',b', 'empty'], [' ', 'empty'], ['  ', 'empty'],
  ];
  for (const [list, valid] of LISTS) {
    for (const scope of ['test', 'file'] as const) {
      it(`${scope}_tags=${JSON.stringify(list)}: ${valid === true ? 'bats accepts it' : 'bats refuses the whole file'}`, async function () {
        if (!usable) return this.skip();
        const lines = [`# bats ${scope}_tags=${list}`, '@test "one" {', '  :', '}'];
        const { tap, out, code } = await runBats(write(`list-${scope}.bats`, lines));
        const ours = explain(lines, 0).facts!.filter((f) => f.id.startsWith('bats-tags'));
        if (valid === true) {
          assert.deepStrictEqual(tap, ['ok 1 one']);
          assert.deepStrictEqual(ours.map((f) => f.id), ['bats-tags']);
        } else {
          // (Nothing runs: bats fails in gathering the tests, and says which tag list is wrong.)
          assert.match(out, /^not ok 1 bats-gather-tests$/m);
          assert.notStrictEqual(code, 0);
          assert.match(out, valid === 'empty' ? /Tags must not be empty/ : /Valid tags must match/);
          assert.deepStrictEqual(ours.map((f) => f.id), ['bats-tags-invalid']);
          assert.strictEqual(ours[0].level, 'error');
          assert.match(ours[0].text, valid === 'empty' ? /leading comma, or a list of only spaces/ : /not valid/);
          // (The comment says so too, not what tags it gives.)
          assert.match(explain(lines, 0).summary, /refuses its list of tags, and runs none of the tests of this file/);
        }
      });
    }
  }

  it('bats:focus runs only the focused tests and makes the run exit 1, unless BATS_NO_FAIL_FOCUS_RUN=1', async function () {
    if (!usable) return this.skip();
    const lines = ['@test "other" {', '  :', '}', '# bats test_tags=bats:focus', '@test "focused" {', '  :', '}'];
    const file = write('focus.bats', lines);
    const strict = await runBats(file);
    assert.deepStrictEqual(strict.tap, ['ok 1 focused'], strict.out);
    assert.strictEqual(strict.code, 1);
    const relaxed = await runBats(file, 'C', 30000, [], { BATS_NO_FAIL_FOCUS_RUN: '1' });
    assert.deepStrictEqual([relaxed.tap, relaxed.code], [['ok 1 focused'], 0]);
    const said = explain(lines, 3).facts!.find((f) => f.id === 'bats-tags')!.text;
    assert.match(said, /bats:focus.*only the focused tests.*status 1.*BATS_NO_FAIL_FOCUS_RUN=1/);
    // (Not said of other tags.)
    assert.doesNotMatch(explain(['# bats test_tags=a'], 0).facts!.find((f) => f.id === 'bats-tags')!.text, /focus/);
  });

  it('takes a tag of letters and digits of any script, as glibc in a UTF-8 locale, and refuses an other number', async function () {
    if (!usable) return this.skip();
    for (const tag of ['é', 'Ⓐ', '٣', 'Ⅳ', 'x²', '½']) {
      const lines = [`# bats test_tags=${tag}`, '@test "one" {', '  :', '}'];
      const { tap } = await runBats(write('utf8-tag.bats', lines), 'C.UTF-8');
      const valid = tap[0] === 'ok 1 one';
      assert.strictEqual(tagComment(lines[0])!.invalid === undefined, valid, `${tag}: ${tap}`);
      assert.strictEqual(valid, !['x²', '½'].includes(tag), tag);
    }
  });

  it('reads a tag line in a here-document or a string, where bash reads it as text, and says so', async function () {
    if (!usable) return this.skip();
    const lines = ['cat <<EOF >/dev/null', '# bats test_tags=h', 'EOF', 'x="', '# bats file_tags=s', '"', '@test "one" {', '  echo "T:${BATS_TEST_TAGS[*]}" >&3', '}'];
    const { out } = await runBats(write('text-tags.bats', lines));
    assert.deepStrictEqual(out.split('\n').filter((l) => l.startsWith('T:')), ['T:h s']);
    const said = (n: number) => explain(lines, n).facts!.find((f) => f.id === 'bats-tags')!.text;
    assert.match(said(1), /^ℹ to bash this line is text of a here-document, not a command\. bats reads the line/);
    assert.match(said(4), /^ℹ to bash this line is text of a string, not a command\. bats reads the line/);
    assert.match(explain(['# bats test_tags=a'], 0).facts![0].text, /^ℹ to bash this is a comment/);
    // (In a `$( )` of a string, the line is a comment again.)
    assert.match(explain(['x="$(', '# bats test_tags=a', ')"'], 1).facts!.find((f) => f.id === 'bats-tags')!.text, /^ℹ to bash this is a comment/);
  });

  it('runs a function marked `# @test` as a test under the name bats gives @test "name", renamed', async function () {
    if (!usable) return this.skip();
    const lines = [
      'my-test() { # @test', '  echo "N:$BATS_TEST_NAME|$BATS_TEST_DESCRIPTION|$(declare -F my-test || echo undefined)" >&3', '}',
      'function other {   #   @test', '  echo "N:$BATS_TEST_NAME|$BATS_TEST_DESCRIPTION" >&3', '}',
      // (The parentheses are optional, and blanks may come before them: bats normalizes the head.)
      'nomark { # @test', '  echo "N:$BATS_TEST_NAME" >&3', '}',
      'sp () { # @test', '  echo "N:$BATS_TEST_NAME" >&3', '}',
      'function  fk { # @test', '  echo "N:$BATS_TEST_NAME" >&3', '}',
    ];
    const { tap, out } = await runBats(write('marked.bats', lines), 'C.UTF-8');
    assert.deepStrictEqual(tap, ['ok 1 my-test', 'ok 2 other', 'ok 3 nomark', 'ok 4 sp', 'ok 5 fk'], out);
    assert.deepStrictEqual(out.split('\n').filter((l) => l.startsWith('N:')), [
      `N:${batsTestName('my-test')}|my-test|undefined`, `N:${batsTestName('other')}|other`, ...['nomark', 'sp', 'fk'].map((n) => `N:${batsTestName(n)}`)]);
    // We read the lines as bats does: the function is renamed in the code bash reads, and the line is a test.
    const extracted = extractShell('bats', lines.join('\n'));
    assert.deepStrictEqual([0, 3, 6, 9, 12].map((n) => extracted.text.split('\n')[n]), [
      `${batsTestName('my-test')}() { # @test`, `function ${batsTestName('other')} {   #   @test`, `${batsTestName('nomark')}() { # @test`,
      `${batsTestName('sp')}() { # @test`, `function  ${batsTestName('fk')} { # @test`]);
    assert.deepStrictEqual(extracted.regions[0].tests, [0, 3, 6, 9, 12]);
    for (const [n, name, head] of [[0, 'my-test', 'my-test()'], [3, 'other', 'function other'], [6, 'nomark', 'nomark'], [9, 'sp', 'sp()'], [12, 'fk', 'function fk']] as const) {
      const ex = explain(lines, n);
      assert.ok(ex.facts!.some((f) => f.id === 'bats-test'));
      assert.strictEqual(ex.summary, `bats test: because of the comment \`# @test\`, bats runs this function as a test. It renames the function \`${batsTestName(name)}\`, so it can no longer be called as \`${name}\` (lines ${n + 1}–${n + 3})`);
      // (The definition and the context show the head as written, without its blanks.)
      assert.strictEqual(ex.items[0].label, `${head} { ‹commands› }`);
      assert.deepStrictEqual(explain(lines, n + 1).context.map((c) => c.label).slice(1, 2), [head]);
    }
  });

  it('runs a marked function after other text on its line as a test, and drops the text, as bats does', async function () {
    if (!usable) return this.skip();
    const mark = path.join(dir, 'dropped.mark');
    const lines = [': >dropped.mark; inl() { # @test', '  echo "N:$BATS_TEST_NAME" >&3', '}'];
    const { tap, out } = await runBats(write('dropped.bats', lines));
    assert.deepStrictEqual(tap, ['ok 1 inl'], out);
    assert.deepStrictEqual(out.split('\n').filter((l) => l.startsWith('N:')), [`N:${batsTestName('inl')}`]);
    assert.ok(!fs.existsSync(mark));
    const ex = explain(lines, 0);
    assert.deepStrictEqual(ex.facts!.map((f) => f.id), ['bats-test', 'bats-test-line-dropped']);
    assert.match(ex.facts![1].text, /`: >dropped\.mark;` before the function's name never runs\. Put it on a line of its own/);
    // (bash reads no `:` there: what bats drops is blanked out.)
    assert.strictEqual(extractShell('bats', lines.join('\n')).text.split('\n')[0], `${' '.repeat(17)}${batsTestName('inl')}() { # @test`);
    // The rewrite: on a line of its own, the text runs.
    const fixed = [': >dropped.mark', ...lines.map((l, n) => (n ? l : 'inl() { # @test'))];
    const after = await runBats(write('dropped-fixed.bats', fixed));
    assert.deepStrictEqual(after.tap, ['ok 1 inl'], after.out);
    assert.ok(fs.existsSync(mark));
    assert.deepStrictEqual(explain(fixed, 1).facts!.map((f) => f.id), ['bats-test']);
  });

  it('takes as a test a definition inside a function only when that function runs as the file is read', async function () {
    if (!usable) return this.skip();
    const body = ['  inner() { # @test', '    :', '  }', '  @test "nested" {', '    :', '  }'];
    for (const called of [false, true]) {
      const lines = ['outer() {', ...body, '}', ...(called ? ['outer'] : []), '@test "plain" {', '  :', '}'];
      const { tap, out } = await runBats(write('nested.bats', lines));
      assert.deepStrictEqual(tap, called ? ['ok 1 inner', 'ok 2 nested', 'ok 3 plain'] : ['ok 1 plain'], out);
      for (const n of [1, 4]) assert.strictEqual((explain(lines, n).facts ?? []).some((f) => f.id === 'bats-test'), called, `${called}: ${lines[n]}`);
    }
  });

  it('does not take a line as a test that bats does not take: text after the comment, no blank before the brace or the comment', async function () {
    if (!usable) return this.skip();
    const lines = ['f(){ # @test', '  :', '}', 'g() { # @test later', '  :', '}', 'h() { #@testx', '  :', '}', 'm() {   #@test  ', '  :', '}'];
    const { tap, out } = await runBats(write('not-marked.bats', lines));
    assert.deepStrictEqual(tap, ['ok 1 m'], out);
    assert.deepStrictEqual(extractShell('bats', lines.join('\n')).regions[0].tests, [9]);
  });
});
