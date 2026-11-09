// Records what bazel reads of the rows of test/fixtures/oracles/bazel.json, which test/parsers-real.test.ts compares the
// parser preset `bazel` and the bazel spec with (bazel is a JVM program of about 60 MB that fetches rules from the
// network: CI runs no bazel, and reads this record). Each row of `flags` gets the words after a command as `bazel
// canonicalize-flags --for_command=COMMAND -- WORDS` prints them, one option a line (`canonical`), or the first line
// of its error (`error`); each row of `lines` the exit status of the line, run in a copy of test/fixtures/bazel
// (`status`), and the first line of its error (`says`); each row of `patterns` the targets bazel takes of its target patterns
// (a query's or a cquery's labels, or those a build or an aquery configures: `bazel build --nobuild`, its build events), with the workspace's targets
// (`universe`), which test/bazel-patterns.test.ts resolves the patterns over; each row of `expressions` the exit status of a
// query, a cquery or an aquery of its expression (after its `options`) and the first line of its error, which
// test/bazel-query.test.ts compares the query language's reader with, and what it gave (labels, or an aquery's mnemonics). The bazel is `$BAZEL` (bazel, or bazelisk, which runs the
// release of test/fixtures/bazel/.bazelversion), a separate program.
//
// `examples` is a second workspace, test/fixtures/bazel-cc (about 8 targets in 4 packages, a test, a genrule with a tool, and
// one external library, @abseil-cpp, with rules_cc, both from the Bazel Central Registry: the first record downloads them, once),
// and the commands the examples of bazel query, cquery and aquery show: each row keeps the text bazel printed to stdout, one
// string a line (`output`, normalised: the copy's directory is `<workspace>`, the output base `<output_base>`, an action's
// key `<key>`). What is machine-specific stays and is an example: the configuration hashes of a cquery (`(a7a71fd)`), and
// an aquery's compiler path and flags, which come from the C++ toolchain bazel finds. Nothing else is: test/bazel-examples.test.ts
// reads the record. Add a row as `{ "command": "query", "options": ["--output=label_kind"], "expression": "//..." }`, at
// the end: the rows run in one server, in order, and an aquery also prints the actions of the configurations that the rows
// before it analysed (`mnemonic("CppCompile", //util:strutil)` comes after `cquery //...`, and so shows the actions of
// `//util:strutil` built for a tool too; test/bazel-aquery.test.ts).
//
//   BAZEL=~/.cache/explain-bash-tools/bazelisk/bazelisk-linux-amd64 npx tsx scripts/record-bazel.ts           rewrite the facts
//   BAZEL=… npx tsx scripts/record-bazel.ts --check   fail if a row's facts are not what bazel does
//
// To add a row, add `{ "command": "build", "words": [...] }` or `{ "line": "bazel …" }` (or, to `patterns`, `{ "command":
// "query", "cquery", "aquery" or "build", "cwd": "app", "words": [...] }`, to `expressions`, `{ "command": "cquery",
// "expression": "...", "options": [...] }`) and run the script; then read the facts it wrote before committing them.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ORACLE = path.join(__dirname, '..', 'test', 'fixtures', 'oracles', 'bazel.json');
const WORKSPACE = path.join(__dirname, '..', 'test', 'fixtures', 'bazel');
const EXAMPLES = path.join(__dirname, '..', 'test', 'fixtures', 'bazel-cc');

interface FlagsRow { command: string; words: string[]; canonical?: string[]; error?: string }
interface LineRow { line: string; status?: number; says?: string }
/** Target patterns: the targets bazel takes of `words` (run in `cwd`, a directory of the workspace), or the first line of its error. */
interface PatternRow { command: 'build' | 'query' | 'cquery' | 'aquery'; cwd?: string; words: string[]; targets?: string[]; error?: string }
/** The workspace's targets (`//...:*`), its rules, and those tagged `manual`. */
interface Universe { all: string[]; rules: string[]; manual: string[] }
/**
 * A query expression: the exit status of the command, and the first line of its error; where it ran, what it gave: the labels of
 * a query or a cquery (sorted, a cquery's configuration left out), the mnemonics of an aquery's actions (sorted, each once).
 */
interface ExpressionRow { command: 'query' | 'cquery' | 'aquery'; options?: string[]; expression: string; status?: number; error?: string; targets?: string[]; mnemonics?: string[] }
/** One command of the examples: what it printed (`output`, one string a line, after `normalise`), or the first line of its error. */
interface ExampleRow { command: 'query' | 'cquery' | 'aquery'; options?: string[]; expression: string; status?: number; error?: string; output?: string[] }
/** The examples' workspace: its targets (`//...:*` with `--output=label_kind`, the rule kind and the label of each) and its rows. */
interface Examples { '//': string; targets: string[]; rows: ExampleRow[] }
interface Oracle { '//': string; bazel?: string; flags: FlagsRow[]; lines: LineRow[]; universe?: Universe; patterns: PatternRow[]; expressions: ExpressionRow[]; examples?: Examples }

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

/** Runs the rows of `examples` in a copy of test/fixtures/bazel-cc, and expunges its output base. */
function recordExamples(): Examples {
  const old = oracle.examples;
  if (!old) throw new Error('add "examples": { "//": "…", "targets": [], "rows": [...] } to the oracle first');
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'record-bazel-cc-'));
  fs.cpSync(EXAMPLES, ws, { recursive: true });
  try {
    const run = (args: string[]) => spawnSync(bazel!, args, { cwd: ws, env, encoding: 'utf8', timeout: 900000, maxBuffer: 64 << 20 });
    const base = run(['info', 'output_base']).stdout.trim();
    /** Bazel's stdout with what is of this machine named: the copy, the output base, an action's key, and (bazel pads a `#   file:line:col` frame to the longest, so by the path's length) the padding before `in`. */
    const normalise = (text: string): string[] => text.split(ws).join('<workspace>').split(base).join('<output_base>')
      .split('\n').map((l) => l.replace(/^(\s*ActionKey: ).*$/, '$1<key>').replace(/^(#   \S+) +in /, '$1 in '));
    const rows = old.rows.map((row): ExampleRow => {
      const { command, options, expression } = row;
      const r = run([command, '--noshow_progress', ...(options ?? []), '--', expression]);
      const error = r.status === 0 ? undefined : firstError(r.stderr) ?? `status ${r.status}`;
      let out = normalise(r.stdout);
      while (out.length && out[out.length - 1] === '') out.pop();
      // (A graph's nodes and edges come in an order that changes from run to run: sorted, between its two lines.)
      if (out[0] === 'digraph mygraph {') out = [out[0], out[1], ...out.slice(2, -1).sort(), out[out.length - 1]];
      return { command, ...(options ? { options } : {}), expression, status: r.status ?? -1, ...(error ? { error } : { output: out }) };
    });
    const kinds = run(['query', '--noshow_progress', '--output=label_kind', '//...:*']);
    return { '//': old['//'], targets: normalise(kinds.stdout).filter((l) => l !== '').sort(), rows };
  } finally {
    spawnSync(bazel!, ['clean', '--expunge'], { cwd: ws, env, timeout: 300000 });
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

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
  /** The labels bazel prints of a query (or a cquery, with its configuration left out: `//app:main (a7a71fd)`), one a line, sorted. */
  const query = (expression: string, cwd = dir, command = 'query'): { targets?: string[]; error?: string } => {
    const r = spawnSync(bazel, [command, '--noshow_progress', expression], { cwd, env, encoding: 'utf8', timeout: 300000 });
    return r.status === 0 ? { targets: r.stdout.split('\n').filter((l) => l !== '').map((l) => l.replace(/ \([^)]*\)$/, '')).sort() } : { error: firstError(r.stderr) ?? `status ${r.status}` };
  };
  const universe: Universe = { all: query('//...:*').targets!, rules: query('kind(rule, //...)').targets!, manual: query('attr(tags, manual, //...)').targets! };
  const bep = path.join(dir, '..', `${path.basename(dir)}.bep.json`);
  const patterns = oracle.patterns.map((row): PatternRow => {
    const cwd = path.join(dir, row.cwd ?? '');
    const { command, words } = row;
    const head = { command, ...(row.cwd ? { cwd: row.cwd } : {}), words };
    if (command === 'query' || command === 'cquery') return { ...head, ...query(words.join(' '), cwd, command) };
    // (The targets of a build or an aquery: those bazel configures, from its build events; `--nobuild` runs no action. aquery's
    // own output can list the actions of other targets, a `manual` one that an earlier command analysed.)
    const args = command === 'build' ? ['build', '--nobuild', '--', ...words] : ['aquery', words.join(' ')];
    const r = spawnSync(bazel, [...args.slice(0, 1), '--noshow_progress', `--build_event_json_file=${bep}`, ...args.slice(1)], { cwd, env, encoding: 'utf8', timeout: 300000 });
    if (r.status !== 0) return { ...head, error: firstError(r.stderr) ?? `status ${r.status}` };
    const labels = [...fs.readFileSync(bep, 'utf8').matchAll(/"targetConfigured":\{"label":"([^"]*)"/g)].map((m) => m[1]);
    return { ...head, targets: [...new Set(labels)].sort() };
  });
  fs.rmSync(bep, { force: true });
  const expressions = oracle.expressions.map((row): ExpressionRow => {
    const { command, options, expression } = row;
    const r = spawnSync(bazel, [command, '--noshow_progress', ...(options ?? []), '--', expression], { cwd: dir, env, encoding: 'utf8', timeout: 300000 });
    const error = r.status === 0 ? undefined : firstError(r.stderr) ?? `status ${r.status}`;
    const lines = r.stdout.split('\n');
    const gave = r.status !== 0 ? {} : command === 'aquery'
      ? { mnemonics: [...new Set(lines.flatMap((l) => /^ {2}Mnemonic: (\S+)/.exec(l)?.[1] ?? []))].sort() }
      : { targets: lines.filter((l) => l !== '').map((l) => l.replace(/ \([^)]*\)$/, '')).sort() };
    return { command, ...(options ? { options } : {}), expression, status: r.status ?? -1, ...(error ? { error } : {}), ...gave };
  });
  const examples = recordExamples();
  const next: Oracle = { '//': oracle['//'], bazel: version, flags, lines, universe, patterns, expressions, examples };
  if (check) {
    const was = [...oracle.flags, ...oracle.lines, oracle.universe, ...oracle.patterns, ...oracle.expressions, ...(oracle.examples?.rows ?? []), oracle.examples?.targets];
    const stale = [...flags, ...lines, universe, ...patterns, ...expressions, ...examples.rows, examples.targets].filter((row, i) => JSON.stringify(row) !== JSON.stringify(was[i]));
    for (const row of stale) console.error(`not as recorded: ${JSON.stringify(row)}`);
    if (stale.length || oracle.bazel !== version) process.exitCode = 1;
  } else fs.writeFileSync(ORACLE, `${JSON.stringify(next, null, 2)}\n`);
} finally {
  // (The output base of the copy, and its server.)
  spawnSync(bazel, ['clean', '--expunge'], { cwd: dir, env, timeout: 300000 });
  fs.rmSync(dir, { recursive: true, force: true });
}
