// buildozer (src/dict/buildozer.ts, src/embedded/buildozer.ts), compared with the real binary of bazel-contrib/buildtools:
// found in $BUILDOZER or on PATH, and the rows are skipped without it (CI installs the pinned release 10.2.0). Each case runs
// on a fresh copy of test/fixtures/buildozer, all of a table in one bash process, and compares the exit status, what we read
// of the words, the status 3 the spec says the call may give, and the rules each label selects.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import { exitMeanings } from '../src/argv/query';
import { BUILDOZER_COMMANDS, type BuildozerLabel, buildozerEdits, explainBuildozerWord, parseBuildozerLabel } from '../src/embedded/buildozer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { argWords } from './support/argwords';

const which = (): string | undefined => {
  if (process.env.BUILDOZER) return process.env.BUILDOZER;
  const r = spawnSync('bash', ['--norc', '-c', 'command -v buildozer'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
};
const BIN = which();
const FIXTURES = path.join(__dirname, 'fixtures', 'buildozer');
const real = (BIN ? it : it.skip) as typeof it;

interface Run { status: number; out: string; err: string }
/** A case: the words after `buildozer`, as shell words; the directory of the copy it runs in; its stdin (a file of the copy). */
interface Case { words: string; cwd?: string; stdin?: string }

/** Runs every case in one bash process, each in a fresh copy of the fixtures; their statuses and outputs, in order. */
function runAll(cases: readonly Case[]): Run[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildozer-'));
  try {
    const ws = path.join(dir, 'ws');
    const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
    const script = cases.map((c) => [
      `rm -rf ${q(ws)}; cp -r ${q(FIXTURES)} ${q(ws)}; cd ${q(path.join(ws, c.cwd ?? ''))}`,
      `"$BIN" ${c.words} < ${c.stdin ? q(path.join(ws, c.stdin)) : '/dev/null'} > ${q(path.join(dir, 'out'))} 2> ${q(path.join(dir, 'err'))}`,
      `echo "@@status $?"; cat ${q(path.join(dir, 'out'))}; echo @@err; cat ${q(path.join(dir, 'err'))}; echo @@end`,
    ].join('\n')).join('\n');
    const r = spawnSync('bash', ['--norc', '-c', script], { encoding: 'utf8', timeout: 120000, env: { ...process.env, BIN, HOME: dir } });
    const runs = [...r.stdout.matchAll(/@@status (\d+)\n([^]*?)@@err\n([^]*?)@@end\n/g)].map((m) => ({ status: Number(m[1]), out: m[2], err: m[3].split(dir).join('') }));
    assert.strictEqual(runs.length, cases.length, r.stderr);
    return runs;
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

/** What we read of `buildozer ARGS`: `-name` for each option known, `?-name` for an unknown one, and the operands after `--`. */
function reading(line: string): string {
  const { words } = argWords(line);
  const parse = interpret(lookupCommand('buildozer')!, words, { name: 'buildozer', lookup: lookupCommand });
  const opts: string[] = [];
  const operands: string[] = [];
  for (const { word, role } of parse.roles) {
    if (role.role === 'option') opts.push(role.spec.names[0]);
    else if (role.role === 'unknown-option') opts.push('?' + role.flag);
    else if (role.role === 'operand') operands.push(words[word].value ?? '?');
  }
  return [...opts, '--', ...operands].join(' ');
}

/** The statuses other than 0 and no error that the spec says the call may give (`CommandSpec.exits`). */
function results(name: string, line: string): number[] {
  const { words } = argWords(line);
  const spec = lookupCommand(name)!;
  return exitMeanings(spec, interpret(spec, words, { name, lookup: lookupCommand }), words.map((w) => w.value)).map((e) => e.status);
}

describe('buildozer', () => {
  // (CI installs the pinned release: .github/actions/install-tools.)
  (process.env.CI ? it : it.skip)('is found in CI', () => assert.ok(BIN));

  // [words, status of the real buildozer, what we read]
  const ROWS: [string, number, string][] = [
    ["'add deps //lib:x' //app:main", 0, '-- add deps //lib:x //app:main'],
    ["'add deps :util' //app:main", 3, '-- add deps :util //app:main'],
    ["//app:main 'add deps //lib:x'", 0, '-- //app:main add deps //lib:x'],
    ["'print kind' //app:main", 0, '-- print kind //app:main'],
    ["'print label deps' //app:main 'remove deps :nope'", 3, '-- print label deps //app:main remove deps :nope'],
    ["-stdout 'add deps :util' //app:main", 0, '-stdout -- add deps :util //app:main'],
    ["--stdout 'add deps :util' //app:main", 0, '-stdout -- add deps :util //app:main'],
    ["-stdout=false 'add deps :util' //app:main", 3, '-stdout -- add deps :util //app:main'],
    ["-quiet 'remove deps :util' //app:main", 0, '-quiet -- remove deps :util //app:main'],
    // The first operand ends the options: `-quiet` is a label, of no file.
    ["'remove deps :util' -quiet //app:main", 2, '-- remove deps :util -quiet //app:main'],
    ["-k 'remove deps :util' //app:nosuch //app:main", 2, '-k -- remove deps :util //app:nosuch //app:main'],
    ["'remove deps :util' //app:nosuch //app:main", 2, '-- remove deps :util //app:nosuch //app:main'],
    ["'add deps' //app:main", 1, '-- add deps //app:main'],
    ["'delete x' //app:main", 1, '-- delete x //app:main'],
    ["'new cc_library z after x extra' //lib:__pkg__", 1, '-- new cc_library z after x extra //lib:__pkg__'],
    ["'' //app:main", 1, '-- ' + ' //app:main'],
    ["'ad deps :x' //app:main", 2, '-- ad deps :x //app:main'],
    ["'set_if_absent kind x' //app:main", 2, '-- set_if_absent kind x //app:main'],
    ["'set deps:bogus x' //app:util", 2, '-- set deps:bogus x //app:util'],
    ["'set srcs:expr glob([\"*.cc\"])' //app:util", 0, '-- set srcs:expr glob(["*.cc"]) //app:util'],
    ["'format' //app:__pkg__", 3, '-- format //app:__pkg__'],
    ["'fix' '//lib:*'", 3, '-- fix //lib:*'],
    ['-f cmds.txt', 0, '-f --'],
    ['-f cmds.txt //app:util', 0, '-f -- //app:util'],
    ["-types cc_test 'print label' '//app:*'", 0, '-types -- print label //app:*'],
    ["-types=cc_test 'set testonly 1' '//app:*'", 0, '-types -- set testonly 1 //app:*'],
    ["-shorten_labels=false 'add deps //app:util' //app:main_test", 0, '-shorten_labels -- add deps //app:util //app:main_test'],
    ["-numio 0 'print label' //app:main", 1, '-numio -- print label //app:main'],
    ['-bogus', 2, '?-bogus --'],
    // (Before the first operand, `-:main` is read as a flag, which Go's `flag` does not know.)
    ["-:main 'print label'", 2, '?-:main -- print label'],
    ["-- -stdout 'print label' //app:main", 2, '-- -stdout print label //app:main'],
    ['-version', 0, '-version --'],
    ['-help', 0, '-help --'],
    ['-h', 0, '-help --'],
  ];

  real('the exit status, what we read of the words, and the status 3 the spec allows', () => {
    const runs = runAll(ROWS.map(([words]) => ({ words })));
    for (const [i, [words, status, read]] of ROWS.entries()) {
      assert.strictEqual(runs[i].status, status, `status of: ${words}\n${runs[i].err}`);
      assert.strictEqual(reading(`buildozer ${words}`), read, `reading of: ${words}`);
      // (The spec says when 3 may come: never where it does not, and wherever it does.)
      const allowed = results('buildozer', `buildozer ${words}`).includes(3);
      if (status === 3) assert.ok(allowed, `3 allowed: ${words}`);
      if (!allowed) assert.notStrictEqual(status, 3, words);
    }
  });

  real('every flag of -help is in the spec, and every option of the spec is a flag', () => {
    const [help] = runAll([{ words: '-help' }]);
    const flags = [...help.err.matchAll(/^ {2}-([A-Za-z_-]+)/gm)].map((m) => m[1]);
    assert.ok(flags.length >= 20, flags.join(' '));
    const spec = lookupCommand('buildozer')!;
    const known = new Set(spec.options!.flatMap((o) => o.names));
    for (const f of flags) assert.ok(known.has('-' + f), f);
    // (`-help` and `-h` are Go's own, not listed.)
    for (const n of known) assert.ok(n === '-help' || n === '-h' || flags.includes(n.slice(1)), n);
  });

  real('each command of the reader is one of buildozer, with the fewest and most arguments it checks', () => {
    const names = Object.keys(BUILDOZER_COMMANDS);
    const cases: Case[] = [];
    for (const name of names) {
      const c = BUILDOZER_COMMANDS[name];
      // Alone, with no label: too few, or nothing to do; a label instead would name no file (status 2).
      cases.push({ words: `'${name}'` });
      if (c.max !== undefined) cases.push({ words: `'${[name, ...Array.from({ length: c.max + 1 }, (_, i) => `a${i}`)].join(' ')}'` });
    }
    cases.push({ words: "'nosuch'" });
    const runs = runAll(cases);
    let k = 0;
    for (const name of names) {
      const c = BUILDOZER_COMMANDS[name];
      const alone = runs[k++];
      if (c.min > 0) assert.strictEqual(alone.err.trim().split('\n')[0], `Too few arguments for command '${name}', expected at least ${c.min}.`, name);
      else assert.ok(alone.status === 0 || alone.status === 3, `${name}: ${alone.status} ${alone.err}`);
      if (c.max !== undefined) assert.strictEqual(runs[k++].err.trim().split('\n')[0], `Too many arguments for command '${name}', expected at most ${c.max}.`, name);
    }
    assert.strictEqual(runs[k].status, 2, 'a word that is no command is a label');
  });

  // The rules of the fixture: for each package, the kind, name and first line of each call.
  const PACKAGES = ['app', 'lib', 'lib/sub'];
  const rules = (pkg: string): { kind: string; name?: string; line: number }[] => {
    const lines = fs.readFileSync(path.join(FIXTURES, pkg, 'BUILD'), 'utf8').split('\n');
    const out: { kind: string; name?: string; line: number }[] = [];
    lines.forEach((l, i) => {
      const call = /^(\w+)\(/.exec(l);
      if (!call) return;
      const name = lines.slice(i).join('\n').match(/^[^)]*?name = "([^"]+)"/)?.[1];
      out.push({ kind: call[1], ...(call[1] === 'package' ? {} : { name }), line: i + 1 });
    });
    return out;
  };
  /** The labels `print label` prints for a label read from `cwd` (`//app:app` is `//app`), and whether it fails, by our reading. */
  const resolve = (l: BuildozerLabel, cwd: string): { labels: string[]; fails: boolean } => {
    if (l.refused) return { labels: [], fails: true };
    const dir = path.posix.normalize(l.from === 'top' ? l.dir : path.posix.join(cwd, l.dir)).replace(/^\.$/, '');
    const pkgs = l.file === 'recursive' ? PACKAGES.filter((p) => !dir || p === dir || p.startsWith(dir + '/')) : [dir];
    let fails = false;
    const labels: string[] = [];
    for (const pkg of pkgs) {
      if (!PACKAGES.includes(pkg)) { fails = true; continue; }
      const rs = rules(pkg);
      const n = l.name;
      const picked = n.kind === 'pkg' ? [] : n.kind === 'all' ? rs : n.kind === 'type' ? rs.filter((r) => r.kind === n.type)
        : n.kind === 'line' ? rs.filter((r) => r.line === n.line) : rs.filter((r) => r.name === n.name);
      if (!picked.length && (n.kind === 'line' || n.kind === 'rule')) fails = true;
      for (const r of picked) if (r.name) labels.push(r.name === path.posix.basename(pkg) ? `//${pkg}` : `//${pkg}:${r.name}`);
    }
    return { labels: labels.sort(), fails };
  };

  // [directory it runs in, label]
  const LABELS: [string, string][] = [
    ['', '//app:main'], ['', '//app'], ['', '//app:*'], ['', '//app:all'], ['', '//app:%cc_library'], ['', '//app:%package'],
    ['', '//app:%cc_nothing'], ['', '//app:%3'], ['', '//app:%4'], ['', '//app:__pkg__'], ['', '//app:nosuch'], ['', '//nosuch:x'],
    ['', '//app/BUILD'], ['', 'app/BUILD'], ['', 'app:main'], ['', '//lib/...:*'], ['', '//lib/...:all'], ['', '//lib/...:x'],
    ['', '//...:%cc_library'], ['', 'lib/...:*'], ['', '@//app:main'], ['', '//app:all-targets'], ['', '//lib/...'], ['', '//app:'],
    ['', '@repo//app:main'], ['app', 'main'], ['app', ':main'], ['app', 'nosuch'], ['lib', 'sub:y'], ['lib', 'sub'], ['lib', '...:*'],
    ['lib', '//:*'], ['', 'lib/sub'],
  ];

  real('what each label selects, as `print label` prints it', () => {
    const runs = runAll(LABELS.map(([cwd, label]) => ({ words: `'print label' '${label}'`, cwd })));
    for (const [i, [cwd, label]] of LABELS.entries()) {
      const l = parseBuildozerLabel(label);
      assert.ok(l, label);
      const want = resolve(l, cwd);
      const got = runs[i].out.split('\n').filter(Boolean).sort();
      assert.deepStrictEqual([got, runs[i].status === 2], [want.labels, want.fails], `${cwd || '.'}: ${label}\n${runs[i].err}`);
    }
  });

  real('the package `-`: the BUILD file on stdin, written to stdout', () => {
    const [read, add, none] = runAll([
      { words: "'print kind' -:y", stdin: 'lib/sub/BUILD' },
      { words: "'add deps :z' -:y", stdin: 'lib/sub/BUILD' },
      { words: "'remove deps :z' -:y", stdin: 'lib/sub/BUILD' },
    ]);
    assert.deepStrictEqual([read.status, read.out], [0, 'cc_library\n']);
    assert.strictEqual(add.status, 0);
    assert.match(add.out, /deps = \[":z"\]/);
    // (Nothing changed: the file is printed, and the status is 3.)
    assert.deepStrictEqual([none.status, none.out], [3, fs.readFileSync(path.join(FIXTURES, 'lib', 'sub', 'BUILD'), 'utf8')]);
    assert.deepStrictEqual(parseBuildozerLabel('-:y'), { from: 'stdin', dir: '', file: 'package', name: { kind: 'rule', name: 'y' }, headAt: [0, 1], nameAt: [1, 3] });
  });
});

describe('the reader of buildozer words (src/embedded/buildozer.ts)', () => {
  /** Each token of a word: its text, its kind, and the start of what it says. */
  const read = (text: string, lang: 'en' | 'ja' = 'en'): string[] => {
    const r = explainBuildozerWord(text, lang);
    return r ? [...r.tokens.map((t) => `${text.slice(t.start, t.end)} ${t.kind} ${t.explanation}`), ...(r.note ? [`note ${r.note}`] : [])] : ['none'];
  };
  // [word, a part of what each token says, in order]
  const ROLES: [string, string[]][] = [
    ['add deps //x', ['add keyword', 'deps variable The attribute `deps`', '//x string The value `//x`']],
    ['add tags:expr FOO', ['add keyword', 'tags:expr variable The attribute `tags`; `:expr`', 'FOO string']],
    ['add tags:list FOO', ['add keyword', 'tags:list variable The attribute `tags`; buildozer knows no type `list`', 'FOO string']],
    ['new_load //t:defs.bzl foo b=bar', ['new_load keyword', '//t:defs.bzl string The `.bzl` file to load', 'foo string A symbol to import', 'b=bar string A symbol']],
    ['substitute_load ^//(.*)$ //x/${1}', ['substitute_load keyword', '^//(.*)$ pattern The regex (RE2)', '//x/${1} string The template']],
    ['comment hi', ['comment keyword', 'hi string The comment']],
    ['comment deps hi', ['comment keyword', 'deps variable The attribute', 'hi string The comment']],
    ['comment deps :x hi', ['comment keyword', 'deps variable', ':x string The value', 'hi string The comment']],
    ['print_comment deps :x', ['print_comment keyword', 'deps variable', ':x string The value']],
    ['fix unusedLoads', ['fix keyword', 'unusedLoads string A fix to apply']],
    ['move deps data *', ['move keyword', 'deps variable The attribute `deps` it comes from', 'data variable The attribute `data` it goes to', '* string Every value']],
    ['new cc_library z after x', ['new keyword', 'cc_library string The kind of the rule', 'z string The name of the rule', 'after string Put it after', 'x string The rule it is put next to']],
    ['new cc_library z here x', ['new keyword', 'cc_library string', 'z string', 'here string Where to put it', 'x string']],
    ['print kind deps', ['print keyword', 'kind variable The kind of the rule', 'deps variable The value of the attribute `deps`']],
    ['remove * :x', ['remove keyword', '* variable Every attribute', ':x string The value']],
    ['replace deps :a :b', ['replace keyword', 'deps variable', ':a string The old value', ':b string The new value']],
    ['copy srcs other', ['copy keyword', 'srcs variable', 'other string The rule to copy from']],
    ['dict_add env A:1', ['dict_add keyword', 'env variable', 'A:1 string A key and value']],
    ['dict_remove env * B', ['dict_remove keyword', 'env variable', '* variable Every key', 'B variable The key `B`']],
    ['dict_replace_if_equal env A 1 2', ['dict_replace_if_equal keyword', 'env variable', 'A variable The key', '1 string The old value', '2 string The new value']],
    ['set_select deps :a //b', ['set_select keyword', 'deps variable', ':a string A key or a value of the `select()`', '//b string A key or a value']],
    ['use_repo_add ext repo1', ['use_repo_add keyword', 'ext string The variable that holds', 'repo1 string The repository']],
    ['use_repo_remove dev @x//:e.bzl e r', ['use_repo_remove keyword', 'dev string The uses of the extension', '@x//:e.bzl string The `.bzl` file that defines', 'e string The name of the extension', 'r string The repository']],
    ['use_repo_add dev r', ['use_repo_add keyword', 'dev string The variable', 'r string The repository']],
    ['set kind java_library', ['set keyword', 'kind variable Not an attribute', 'java_library string The kind of the rule']],
    ['set srcs a.cc b.cc', ['set keyword', 'srcs variable The attribute', 'a.cc string The value', 'b.cc string The value']],
    ['new cc_test t before x', ['new keyword', 'cc_test string', 't string', 'before string Put it before', 'x string']],
    ['@//app:x', ['@ keyword The main repository', '//app string The BUILD file of `app`', ':x string The rule `x`']],
    ['a\\ b\nadd', ['a\\ b error `a\\ b` is no command']],
    ['  ', ['   error An empty command']],
    ['', ['none']],
  ];

  it('gives each argument its role', () => {
    for (const [text, want] of ROLES) {
      const got = read(text).filter((t) => !t.startsWith('note '));
      assert.strictEqual(got.length, want.length, `${text}\n${got.join('\n')}`);
      want.forEach((w, i) => assert.ok(got[i].startsWith(w), `${text}: ${got[i]} / ${w}`));
    }
  });

  it('reads a label: its file and its rules', () => {
    const note = (text: string, lang: 'en' | 'ja' = 'en'): string => read(text, lang).find((t) => t.startsWith('note '))?.slice(5) ?? read(text, lang).join(' | ');
    assert.strictEqual(note('//app:%'), 'Every rule in the BUILD file of `app` (from the top of the workspace)');
    assert.strictEqual(note('//WORKSPACE:all'), 'Every rule (unless a rule is named `all`) in the file `WORKSPACE` (from the top of the workspace), read as a BUILD file');
    assert.strictEqual(note('app/BUILD.bazel'), 'The package itself (its `package()` call; for the commands that work on the whole file, the file) in the BUILD file `app/BUILD.bazel` (from the current directory)');
    assert.strictEqual(note('-:%cc_test'), 'Every rule of the kind `cc_test` in the BUILD file on stdin');
    assert.strictEqual(note('//lib/sub:'), 'The rule named like the package, `sub`, in the BUILD file of `lib/sub` (from the top of the workspace)');
    assert.strictEqual(note('//:x'), 'The rule `x` in the BUILD file of `.` (from the top of the workspace)');
    assert.strictEqual(note('//app:main', 'ja'), 'ワークスペースの最上位からの `app` の BUILD ファイルのルール `main`');
    assert.strictEqual(note('-:x', 'ja'), '標準入力の BUILD ファイルのルール `x`');
    // (Not labels buildozer reads as written: `-:` alone, a relative package with no name, a subtractive pattern.)
    for (const text of ['-:', 'app:', '-//app:x']) assert.deepStrictEqual(read(text), ['none'], text);
    assert.match(read('//lib/...:').join(' | '), /\/\.\.\.: error After `\.\.\.`/);
    assert.match(read('@@canon//a:b').join(' | '), /@@canon error buildozer reads only the files of the main workspace/);
  });

  it('holes: one in the first word leaves the word unread, one in an argument is claimed', () => {
    const hole = String.fromCharCode(0xfdd2);
    assert.deepStrictEqual(explainBuildozerWord(`${hole} x`, 'en'), { tokens: [] });
    assert.deepStrictEqual(explainBuildozerWord(`//app:${hole}`, 'en'), { tokens: [] });
    const r = explainBuildozerWord(`add deps ${hole} :x`, 'en')!;
    assert.deepStrictEqual(r.tokens.map((t) => [t.start, t.kind, t.hole?.place]), [[0, 'keyword', undefined], [4, 'variable', undefined], [9, 'variable', 'buildozer']]);
    // (A count of arguments with a hole is not known: no error.)
    assert.strictEqual(explainBuildozerWord(`delete ${hole}`, 'en')!.tokens[0].kind, 'keyword');
  });

  it('a command that edits, for the status 3; one whose text is not known may', () => {
    assert.deepStrictEqual(['add deps x', 'print kind', '//app:main', undefined].map(buildozerEdits), [true, false, false, true]);
    assert.deepStrictEqual(['buildozer -stdout=false -f c', "buildozer -stdout=true 'add x y' //a", 'buildozer "$c" //a'].map((l) => results('buildozer', l)), [[3], [], [3]]);
    assert.deepStrictEqual(['buildifier -mode="$m" f', 'buildifier -lint="$l" f', 'buildifier -lint=fix f', 'buildifier -mode=fix f', 'buildifier -d -format=json f'].map((l) => results('buildifier', l)), [[4], [4], [], [], []]);
  });
});

describe('buildozer explanations', () => {
  const parser = createUnbashParser();
  const parts = (src: string, lang: 'en' | 'ja'): string[] => {
    const out: Token[] = [];
    const walk = (t: Token) => (out.push(t), t.children.forEach(walk));
    new Analyzer(lang).explainLine(parser.parse(src), 0).items.forEach(walk);
    return out.slice(1).map((t) => `${t.kind} ${t.label}: ${t.explanation}`);
  };
  const find = (all: string[], start: string): string => all.find((p) => p.startsWith(start)) ?? `(none: ${start})`;

  it('a command and its arguments, and a label with its parts', () => {
    const en = parts("buildozer 'add deps //lib:x' //app:main", 'en');
    assert.strictEqual(find(en, 'keyword add'), 'keyword add: buildozer\'s command: Adds the values to a list attribute (a value already in it is not added)');
    assert.strictEqual(find(en, 'variable deps'), 'variable deps: The attribute `deps`');
    assert.strictEqual(find(en, 'string //lib:x'), 'string //lib:x: The value `//lib:x`');
    assert.match(find(en, 'argument //app:main'), / — The rule `main` in the BUILD file of `app` \(from the top of the workspace\)$/);
    assert.strictEqual(find(en, 'string :main'), 'string :main: The rule `main`');
    const ja = parts("buildozer 'add deps //lib:x' //app:main", 'ja');
    assert.strictEqual(find(ja, 'keyword add'), 'keyword add: buildozer のコマンド: 値をリストの属性に足す（すでにある値は足さない）');
    assert.match(find(ja, 'argument //app:main'), / — ワークスペースの最上位からの `app` の BUILD ファイルのルール `main`$/);
  });

  it("buildozer's own label forms", () => {
    const en = parts("buildozer 'print label' '//app:%cc_library' '//app:%3' //app:__pkg__ '//lib/...:*' -:main main //app", 'en');
    assert.strictEqual(find(en, 'operator :%cc_library'), 'operator :%cc_library: Every rule of the kind `cc_library`');
    assert.strictEqual(find(en, 'operator :%3'), 'operator :%3: The rule that starts on line 3');
    assert.match(find(en, 'operator :__pkg__'), /^operator :__pkg__: The package itself/);
    assert.strictEqual(find(en, 'string //lib/...'), 'string //lib/...: Every BUILD file in `lib` (from the top of the workspace) and below');
    assert.strictEqual(find(en, 'keyword -'), 'keyword -: The BUILD file read from stdin (the result goes to stdout)');
    assert.match(find(en, 'argument main'), / — The rule `main` in the BUILD file of the current directory$/);
    assert.match(find(en, 'argument //app: a'), / — The rule named like the package, `app`, in the BUILD file of `app`/);
  });

  it('what buildozer refuses: a count of arguments, a word that is no command, a label it cannot read', () => {
    const en = parts("buildozer 'add deps' 'delete x' 'ad deps x' '' ' ' '//lib/...' '//app:' '@repo//a:b' 'set_if_absent kind x'", 'en');
    assert.match(find(en, 'error add'), /takes at least 2 arguments: buildozer stops with "Too few arguments for command 'add'", changing no file \(status 1\)$/);
    assert.match(find(en, 'error delete'), /`delete` takes no arguments/);
    assert.match(find(en, 'error ad: '), /is no command of buildozer/);
    assert.match(find(en, 'error : An empty'), /"empty command list"/);
    assert.match(find(en, 'error /...'), /After `...`, write `:` and a name/);
    assert.strictEqual(find(en, 'string :: '), 'string :: The rule named like the package, `app`');
    assert.match(find(en, 'error @repo'), /only the files of the main workspace/);
    assert.match(find(en, 'error kind'), /`set_if_absent` cannot set the kind/);
  });

  it('the special attributes of `print`, `set kind`, an attribute with a type, a value with a hole', () => {
    const en = parts("buildozer 'print kind label nosuch' 'set kind java_library' 'add tags:expr FOO' \"add deps $dep\" //app:main", 'en');
    assert.strictEqual(find(en, 'variable kind'), 'variable kind: The kind of the rule (the name of the function called)');
    assert.strictEqual(find(en, 'variable nosuch'), 'variable nosuch: The value of the attribute `nosuch`');
    assert.match(find(en, 'variable kind: Not'), /Not an attribute: `set kind` changes the kind of the rule/);
    assert.match(find(en, 'variable tags:expr'), /`:expr` writes the values as expressions/);
    assert.match(find(en, 'variable $dep'), /buildozer splits at spaces and newlines itself/);
  });

  it('options: Go flags, those on by default, and an option after the first operand, which is a label', () => {
    const en = parts("buildozer -k -shorten_labels=false 'print kind' -quiet", 'en');
    assert.strictEqual(find(en, 'option -k'), 'option -k: apply the other commands even when one fails (the status is still 2)');
    assert.match(find(en, 'option -shorten_labels=false'), /on by default; `=false` turns it off/);
    assert.match(find(en, 'argument -quiet'), /^argument -quiet: a command .* or a label/);
  });

  it('under `set -e`, the status 3 of nothing changed stops the script: a warning, not where it cannot come', () => {
    const notes = (src: string): string[] => {
      const tree = parser.parse(src);
      const a = new Analyzer('en');
      return src.split('\n').flatMap((_, i) => a.explainLine(tree, i).notes ?? []);
    };
    const edit = notes("#!/bin/bash\nset -e\nbuildozer 'add deps //lib:x' //app:main\n");
    assert.ok(edit.some((n) => n.includes('`buildozer` exits with status 3 when no file needed a change, which it counts as a success') && n.includes('`… || [ $? -eq 3 ]`')), edit.join('\n'));
    // (The line keeps its note on where `set -e` stops, which names the status, the trap that runs and the other commands.)
    const trapped = notes("#!/bin/bash\nset -e\ntrap 'echo bye' EXIT\nbuildozer 'add deps //lib:x' //app:main; grep x f\n");
    assert.ok(trapped.some((n) => n.includes('exits with status 3 when no file needed a change')), trapped.join('\n'));
    assert.ok(trapped.some((n) => n.includes('If `buildozer` or `grep` fails, `set -e` stops the script here: the EXIT trap of line 3 runs `echo bye`')), trapped.join('\n'));
    const one = notes("#!/bin/bash\nset -e\ntrap 'echo bye' EXIT\nbuildozer 'add deps //lib:x' //app:main\n");
    assert.ok(one.some((n) => n.includes('If `buildozer` exits with a status other than 0 (3: no file needed a change), `set -e` stops the script here: the EXIT trap of line 3 runs `echo bye`')), one.join('\n'));
    const ja = parser.parse("#!/bin/bash\nset -e\ngrep x f\n");
    assert.ok((new Analyzer('ja').explainLine(ja, 2).notes ?? []).some((n) => n.includes('`grep` が 0 以外の終了ステータスで終わると（1 は一致する行がなかったとき）、')), 'ja');
    for (const line of ["buildozer 'print kind' //app:main", "buildozer -stdout 'add deps :x' //app:main", "buildozer 'add deps :x' //app:main || [ $? -eq 3 ]", "if buildozer 'add deps :x' //a:b; then :; fi"]) {
      const said = notes(`#!/bin/bash\nset -e\n${line}\n`);
      assert.ok(!said.some((n) => n.includes('errexit-stops-on-success') || n.includes('exits with status 3')), `${line}\n${said.join('\n')}`);
    }
    // (Without `set -e`, nothing.)
    assert.ok(!notes("#!/bin/bash\nbuildozer 'add deps :x' //a:b\n").some((n) => n.includes('status 3')));
  });
});
