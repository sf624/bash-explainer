// buildifier (src/dict/buildifier.ts), compared with the real binary of bazel-contrib/buildtools: found in $BUILDIFIER or
// on PATH, and the rows are skipped without it (CI installs the pinned release 10.2.0). Each row runs on a copy of
// test/fixtures/buildifier, and compares the exit status with what we read of the words.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { ArgRole, interpret } from '../src/argv/interpret';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { argWords } from './support/argwords';

const which = (): string | undefined => {
  if (process.env.BUILDIFIER) return process.env.BUILDIFIER;
  const r = spawnSync('bash', ['--norc', '-c', 'command -v buildifier'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
};
const BIN = which();
const FIXTURES = path.join(__dirname, 'fixtures', 'buildifier');
const real = (BIN ? it : it.skip) as typeof it;

/** Runs buildifier with `args` on a fresh copy of the fixtures; its status, and what it printed. */
function runReal(args: string[], stdin = ''): { status: number | null; out: string; err: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildifier-'));
  try {
    fs.cpSync(FIXTURES, dir, { recursive: true });
    const r = spawnSync(BIN!, args, { cwd: dir, input: stdin, encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: dir, BUILDIFIER_CONFIG: '' } });
    return { status: r.status, out: r.stdout, err: r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

/** What we read of `buildifier ARGS`: `-name` for each option known, `?-name` for an unknown one, and the operands after `--`. */
function reading(line: string): string {
  const { words } = argWords(line);
  const parse = interpret(lookupCommand('buildifier')!, words, { name: 'buildifier', lookup: lookupCommand });
  const opts: string[] = [];
  const operands: string[] = [];
  for (const { word, role } of parse.roles) {
    const r: ArgRole = role;
    if (r.role === 'option') opts.push(r.flag.replace(/^--?/, '-'));
    else if (r.role === 'unknown-option') opts.push('?' + r.flag);
    else if (r.role === 'operand') operands.push(words[word].value ?? '?');
  }
  return [...opts, '--', ...operands].join(' ');
}

describe('buildifier', () => {
  // (CI installs the pinned release: .github/actions/install-tools.)
  (process.env.CI ? it : it.skip)('is found in CI', () => assert.ok(BIN));

  // [words, status of the real buildifier, what we read]
  const ROWS: [string, number, string][] = [
    ['-mode=check BUILD', 4, '-mode -- BUILD'],
    ['-mode=check ok/BUILD', 0, '-mode -- ok/BUILD'],
    ['-mode check BUILD', 4, '-mode -- BUILD'],
    ['--mode=check BUILD', 4, '-mode -- BUILD'],
    ['--mode check BUILD', 4, '-mode -- BUILD'],
    ['-mode=diff BUILD', 4, '-mode -- BUILD'],
    ['-d BUILD', 4, '-d -- BUILD'],
    ['-mode=print_if_changed BUILD', 0, '-mode -- BUILD'],
    ['-mode=check -d BUILD', 2, '-mode -d -- BUILD'],
    ['-mode=bogus BUILD', 2, '-mode -- BUILD'],
    ['-lint=warn lib.bzl', 4, '-lint -- lib.bzl'],
    ['-lint=warn -warnings=-load,-module-docstring lib.bzl', 0, '-lint -warnings -- lib.bzl'],
    ['-lint=warn -warnings=+load lib.bzl', 4, '-lint -warnings -- lib.bzl'],
    ['-lint=off ok/BUILD', 0, '-lint -- ok/BUILD'],
    ['-lint=bogus ok/BUILD', 2, '-lint -- ok/BUILD'],
    ['-mode=check -format=json BUILD', 0, '-mode -format -- BUILD'],
    ['-mode=check -format=sarif BUILD', 0, '-mode -format -- BUILD'],
    ['-mode=check -format=text BUILD', 0, '-mode -format -- BUILD'],
    ['-format=json BUILD', 2, '-format -- BUILD'],
    ['-type=bzl -mode=check BUILD', 4, '-type -mode -- BUILD'],
    ['-type=bogus BUILD', 2, '-type -- BUILD'],
    ['-mode=check -r .', 1, '-mode -r -- .'],
    ['-mode=check -v ok/BUILD', 0, '-mode -v -- ok/BUILD'],
    ['-mode=check bad.bzl', 1, '-mode -- bad.bzl'],
    ['-mode=check missing', 3, '-mode -- missing'],
    ['-bogus', 2, '?-bogus --'],
    ['-version', 0, '-version --'],
    ['-help', 0, '-help --'],
    // The first operand ends the options: the rest is a file name.
    ['BUILD -mode=check', 3, '-- BUILD -mode=check'],
    ['-mode=check -- -x', 3, '-mode -- -x'],
  ];

  real('the exit status and what we read of the words, as the real binary takes them', () => {
    for (const [words, status, read] of ROWS) {
      assert.strictEqual(runReal(words.split(' ')).status, status, `status of: ${words}`);
      assert.strictEqual(reading(`buildifier ${words}`), read, `reading of: ${words}`);
    }
  });

  real('every flag of -help is in the spec, and every option of the spec is a flag', () => {
    const help = runReal(['-help']).err + runReal(['-help']).out;
    const flags = [...help.matchAll(/^ {2}-([A-Za-z_]+)/gm)].map((m) => m[1]);
    assert.ok(flags.length >= 15, flags.join(' '));
    const spec = lookupCommand('buildifier')!;
    const known = new Set(spec.options!.flatMap((o) => o.names));
    for (const f of flags) assert.ok(known.has('-' + f), f);
    for (const n of known) assert.ok(flags.includes(n.slice(1)), n);
  });

  real('the values the spec lists are the ones buildifier accepts (the error of another lists them)', () => {
    const spec = lookupCommand('buildifier')!;
    const valuesOf = (flag: string): string[] => Object.keys((spec.options!.find((o) => o.names.includes(flag))!.value as { values: Record<string, unknown> }).values);
    assert.deepStrictEqual(valuesOf('-mode'), ['check', 'diff', 'fix', 'print_if_changed']);
    const said = (flag: string, value: string): string => runReal([`${flag}=${value}`, 'ok/BUILD']).err;
    assert.match(said('-mode', 'bogus'), /valid modes are check, diff, fix, print_if_changed/);
    assert.match(said('-format', 'bogus'), /valid types are text, json, sarif/);
    assert.deepStrictEqual(valuesOf('-format'), ['text', 'json', 'sarif']);
    const types = /valid types are ([a-z, ]+)\n/.exec(said('-type', 'bogus'))![1].split(', ').sort();
    assert.deepStrictEqual(valuesOf('-type').sort(), types);
    // (`-lint=off` is accepted, though the message names `warn` and `fix`.)
    assert.strictEqual(runReal(['-lint=off', 'ok/BUILD']).status, 0);
    assert.deepStrictEqual(valuesOf('-lint'), ['off', 'warn', 'fix']);
    assert.match(said('-lint', 'bogus'), /valid modes are warn and fix/);
  });

  real('what -mode=check prints, and what fix, diff and print_if_changed do with the files', () => {
    assert.strictEqual(runReal(['-mode=check', 'BUILD']).err, 'BUILD # reformat\n');
    assert.strictEqual(runReal(['-mode=check', '-format=text', 'BUILD']).out, 'BUILD # reformat\n');
    assert.match(runReal(['-mode=diff', 'BUILD']).out, /^--- BUILD\t/);
    assert.strictEqual(runReal(['-mode=print_if_changed', 'BUILD']).out, 'cc_library(\n    name = "lib",\n    deps = [":dep"],\n)\n');
    assert.strictEqual(runReal(['-mode=print_if_changed', 'ok/BUILD']).out, '');
    assert.strictEqual(runReal(['-v', 'BUILD']).err, 'fixed BUILD\n');
    // stdin: fix prints the result; -path says where the file would be.
    assert.strictEqual(runReal(['-type=bzl'], 'x=1\n').out, 'x = 1\n');
  });

  real('-format=json and sarif report with status 0 what check would fail with', () => {
    const json = JSON.parse(runReal(['-mode=check', '-format=json', 'BUILD']).out) as { success: boolean; files: { filename: string; formatted: boolean }[] };
    assert.deepStrictEqual([json.success, json.files[0].filename, json.files[0].formatted], [false, 'BUILD', false]);
    assert.strictEqual((JSON.parse(runReal(['-mode=check', '-format=sarif', 'BUILD']).out) as { version: string }).version, '2.1.0');
  });
});

describe('buildifier explanations', () => {
  const parser = createUnbashParser();
  const parts = (src: string, lang: 'en' | 'ja'): string[] => {
    const out: Token[] = [];
    const walk = (t: Token) => (out.push(t), t.children.forEach(walk));
    new Analyzer(lang).explainLine(parser.parse(src), 0).items.forEach(walk);
    return out.slice(1).filter((t) => t.kind !== 'string').map((t) => `${t.label}: ${t.explanation}`);
  };

  it('options and their values', () => {
    const en = parts('buildifier -mode=check -lint=warn -r .', 'en');
    assert.match(en[0], /^-mode=check: what to do .*\(value: `check` — print the names of the files that need formatting to stderr \(status 4 if there are any; with `-format`, to stdout and the status is 0\)\)$/);
    assert.match(en[1], /^-lint=warn: lint mode .*\(value: `warn` — print warnings about common mistakes/);
    assert.strictEqual(en[2], '-r: find Starlark files recursively below the directories given');
    assert.match(en[3], /^\.: Starlark file/);
    const ja = parts('buildifier -mode=check -lint=warn -r .', 'ja');
    assert.match(ja[0], /^-mode=check: 処理の仕方/);
    assert.strictEqual(ja[2], '-r: ディレクトリの下の Starlark ファイルを再帰的に探す');
  });

  it('`--mode diff`, `-d`, and an option after the first file, which is a file name', () => {
    const en = parts('buildifier --mode diff BUILD', 'en');
    assert.match(en[1], /^diff: diff: show the diff that formatting would make/);
    assert.match(parts('buildifier BUILD -mode=check', 'en')[1], /^-mode=check: Starlark file/);
    assert.match(parts('buildifier -d BUILD', 'en')[0], /^-d: the same as `-mode=diff`/);
  });
});
