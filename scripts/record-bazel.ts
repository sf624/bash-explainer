// Records what bazel reads of the rows of test/fixtures/oracles/bazel.json, which test/parsers-real.test.ts compares the
// parser preset `bazel` and the bazel spec with (bazel is a JVM program of about 60 MB that fetches rules from the
// network: CI runs no bazel, and reads this record). Each row of `flags` gets the words after a command as `bazel
// canonicalize-flags --for_command=COMMAND -- WORDS` prints them, one option a line (`canonical`), or the first line
// of its error (`error`); each row of `lines` the exit status of the line, run in a copy of test/fixtures/bazel
// (`status`), and the first line of its error (`says`); each row of `patterns` the targets bazel takes of its target patterns
// (a query's labels, or those a build configures: `bazel build --nobuild`, its build events), with the workspace's targets
// (`universe`), which test/bazel-patterns.test.ts resolves the patterns over. The bazel is `$BAZEL` (bazel, or bazelisk, which runs the
// release of test/fixtures/bazel/.bazelversion), a separate program.
//
//   BAZEL=~/.cache/explain-bash-tools/bazelisk/bazelisk-linux-amd64 npx tsx scripts/record-bazel.ts           rewrite the facts
//   BAZEL=… npx tsx scripts/record-bazel.ts --check   fail if a row's facts are not what bazel does
//
// To add a row, add `{ "command": "build", "words": [...] }` or `{ "line": "bazel …" }` (or, to `patterns`, `{ "command":
// "query" or "build", "cwd": "app", "words": [...] }`) and run the script; then read the facts it wrote before committing them.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ORACLE = path.join(__dirname, '..', 'test', 'fixtures', 'oracles', 'bazel.json');
const WORKSPACE = path.join(__dirname, '..', 'test', 'fixtures', 'bazel');

interface FlagsRow { command: string; words: string[]; canonical?: string[]; error?: string }
interface LineRow { line: string; status?: number; says?: string }
/** Target patterns: the targets bazel takes of `words` (run in `cwd`, a directory of the workspace), or the first line of its error. */
interface PatternRow { command: 'build' | 'query'; cwd?: string; words: string[]; targets?: string[]; error?: string }
/** The workspace's targets (`//...:*`), its rules, and those tagged `manual`. */
interface Universe { all: string[]; rules: string[]; manual: string[] }
interface Oracle { '//': string; bazel?: string; flags: FlagsRow[]; lines: LineRow[]; universe?: Universe; patterns: PatternRow[] }

const bazel = process.env.BAZEL;
if (!bazel) {
  console.error('Cannot record: set BAZEL to a bazel or bazelisk program');
  process.exit(1);
}
const check = process.argv.includes('--check');
const oracle = JSON.parse(fs.readFileSync(ORACLE, 'utf8')) as Oracle;
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'record-bazel-'));
fs.cpSync(WORKSPACE, dir, { recursive: true });
const version = fs.readFileSync(path.join(WORKSPACE, '.bazelversion'), 'utf8').trim();
const env = { ...process.env, USE_BAZEL_VERSION: version, HOME: process.env.HOME ?? dir };

/** The first line bazel says of an error (its client's `[FATAL …]` prefix and the option before `::` left out, the copy's directory as `<workspace>`). */
const firstError = (text: string): string | undefined => {
  const line = text.split('\n').find((l) => /^(ERROR: |\[FATAL )/.test(l));
  return line?.replace(/^\[FATAL [^\]]*\] /, '').replace(/^ERROR: /, '').replace(/^\S+ :: /, '').split(dir).join('<workspace>');
};

try {
  const flags = oracle.flags.map((row): FlagsRow => {
    const r = spawnSync(bazel, ['canonicalize-flags', `--for_command=${row.command}`, '--', ...row.words], { cwd: dir, env, encoding: 'utf8', timeout: 300000 });
    return r.status === 0
      ? { command: row.command, words: row.words, canonical: r.stdout.split('\n').filter((l) => l !== '') }
      : { command: row.command, words: row.words, error: firstError(r.stderr) ?? `status ${r.status}` };
  });
  const lines = oracle.lines.map((row): LineRow => {
    // (The line as a shell runs it, with `bazel` the program of $BAZEL.)
    const r = spawnSync('bash', ['--norc', '-c', `bazel() { "$BAZEL" "$@"; }; ${row.line}`], { cwd: dir, env, encoding: 'utf8', timeout: 600000 });
    const says = r.status === 0 ? undefined : firstError(r.stderr);
    return { line: row.line, status: r.status ?? -1, ...(says ? { says } : {}) };
  });
  /** The labels bazel prints of a query, one a line, sorted. */
  const query = (expression: string, cwd = dir): { targets?: string[]; error?: string } => {
    const r = spawnSync(bazel, ['query', '--noshow_progress', expression], { cwd, env, encoding: 'utf8', timeout: 300000 });
    return r.status === 0 ? { targets: r.stdout.split('\n').filter((l) => l !== '').sort() } : { error: firstError(r.stderr) ?? `status ${r.status}` };
  };
  const universe: Universe = { all: query('//...:*').targets!, rules: query('kind(rule, //...)').targets!, manual: query('attr(tags, manual, //...)').targets! };
  const bep = path.join(dir, '..', `${path.basename(dir)}.bep.json`);
  const patterns = oracle.patterns.map((row): PatternRow => {
    const cwd = path.join(dir, row.cwd ?? '');
    const { command, words } = row;
    const head = { command, ...(row.cwd ? { cwd: row.cwd } : {}), words };
    if (command === 'query') return { ...head, ...query(words.join(' '), cwd) };
    // (The targets of a build: those bazel configures, from its build events; `--nobuild` runs no action.)
    const r = spawnSync(bazel, ['build', '--nobuild', '--noshow_progress', `--build_event_json_file=${bep}`, '--', ...words], { cwd, env, encoding: 'utf8', timeout: 300000 });
    if (r.status !== 0) return { ...head, error: firstError(r.stderr) ?? `status ${r.status}` };
    const labels = [...fs.readFileSync(bep, 'utf8').matchAll(/"targetConfigured":\{"label":"([^"]*)"/g)].map((m) => m[1]);
    return { ...head, targets: [...new Set(labels)].sort() };
  });
  fs.rmSync(bep, { force: true });
  const next: Oracle = { '//': oracle['//'], bazel: version, flags, lines, universe, patterns };
  if (check) {
    const was = [...oracle.flags, ...oracle.lines, oracle.universe, ...oracle.patterns];
    const stale = [...flags, ...lines, universe, ...patterns].filter((row, i) => JSON.stringify(row) !== JSON.stringify(was[i]));
    for (const row of stale) console.error(`not as recorded: ${JSON.stringify(row)}`);
    if (stale.length || oracle.bazel !== version) process.exitCode = 1;
  } else fs.writeFileSync(ORACLE, `${JSON.stringify(next, null, 2)}\n`);
} finally {
  // (The output base of the copy, and its server.)
  spawnSync(bazel, ['clean', '--expunge'], { cwd: dir, env, timeout: 300000 });
  fs.rmSync(dir, { recursive: true, force: true });
}
