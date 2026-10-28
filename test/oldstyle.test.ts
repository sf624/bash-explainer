import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function top(src: string, lang: 'en' | 'ja' = 'en'): Token[] {
  const tree = parser.parse(src);
  return new Analyzer(lang).explainLine(tree, 0).items[0].children;
}

/** The lines of a command's argument tokens: `label: explanation` (children indented). */
function shape(src: string): string[] {
  const out: string[] = [];
  const walk = (t: Token, d: number) => (out.push(`${'  '.repeat(d)}${t.label}: ${t.explanation}`), t.children.forEach((c) => walk(c, d + 1)));
  top(src).forEach((t) => walk(t, 0));
  return out;
}

const have = (cmd: string) => spawnSync(cmd, ['--version']).status !== null && !spawnSync(cmd, ['--version']).error;

/** Runs `argv` in a copy of a small tree and returns what it prints, its status and the files left behind. */
function run(cmd: string, argv: string[]): { out: string; status: number | null; files: string[]; list: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldstyle-'));
  try {
    fs.mkdirSync(path.join(dir, 'src/sub'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'out'));
    fs.writeFileSync(path.join(dir, 'src/a.txt'), 'a\n');
    fs.writeFileSync(path.join(dir, 'src/sub/b.txt'), 'b\n');
    const r = spawnSync(cmd, argv, { cwd: dir, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
    const files = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => !f.startsWith('src')).sort();
    const archive = ['a.tar', 'a.tgz', 'lib.a'].find((f) => fs.existsSync(path.join(dir, f)));
    const lister = archive === 'lib.a' ? spawnSync('ar', ['t', archive], { cwd: dir }) : archive ? spawnSync('tar', ['tf', archive], { cwd: dir }) : undefined;
    return { out: r.stdout.toString() + r.stderr.toString().replace(/^(tar|ar): /gm, ''), status: r.status, files, list: lister ? lister.stdout.toString() : '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('old-style options: tar', () => {
  // [dashless words, the same with dashes]
  const pairs: [string[], string[]][] = [
    [['cf', 'a.tar', 'src'], ['-c', '-f', 'a.tar', 'src']],
    [['cvf', 'a.tar', 'src'], ['-c', '-v', '-f', 'a.tar', 'src']],
    [['czf', 'a.tgz', 'src'], ['-c', '-z', '-f', 'a.tgz', 'src']],
    [['cfC', 'a.tar', 'src', 'sub'], ['-c', '-f', 'a.tar', '-C', 'src', 'sub']],
    [['cCf', 'src', 'a.tar', 'sub'], ['-c', '-C', 'src', '-f', 'a.tar', 'sub']],
    [['cvfC', 'a.tar', 'src', 'sub'], ['-c', '-v', '-f', 'a.tar', '-C', 'src', 'sub']],
    [['cf', 'a.tar', '--exclude=b.txt', 'src'], ['-c', '-f', 'a.tar', '--exclude=b.txt', 'src']],
    [['cvhf', 'a.tar', 'src'], ['-c', '-v', '-h', '-f', 'a.tar', 'src']],
    [['cPf', 'a.tar', 'src'], ['-c', '-P', '-f', 'a.tar', 'src']],
    [['cbf', '1', 'a.tar', 'src'], ['-c', '-b', '1', '-f', 'a.tar', 'src']],
  ];
  for (const [old, dash] of pairs) {
    it(`tar ${old.join(' ')} behaves as tar ${dash.join(' ')}`, function () {
      if (!have('tar')) return this.skip();
      assert.deepStrictEqual(run('tar', old), run('tar', dash));
      assert.ok(run('tar', old).list.length > 0 || old[0].includes('t') || old[0].includes('x'), 'made an archive');
    });
  }

  it('lists and extracts like the dashed form', function () {
    if (!have('tar')) return this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldstyle-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(path.join(dir, 'src/a.txt'), 'a\n');
      spawnSync('tar', ['cf', 'a.tar', 'src'], { cwd: dir });
      fs.mkdirSync(path.join(dir, 'o1'));
      fs.mkdirSync(path.join(dir, 'o2'));
      for (const [words, o] of [[['xvfC', 'a.tar', 'o1'], 'o1'], [['-x', '-v', '-f', 'a.tar', '-C', 'o2'], 'o2']] as [string[], string][]) {
        const r = spawnSync('tar', words, { cwd: dir });
        assert.strictEqual(r.stdout.toString(), 'src/\nsrc/a.txt\n');
        assert.strictEqual(fs.readFileSync(path.join(dir, o, 'src/a.txt'), 'utf8'), 'a\n');
      }
      assert.strictEqual(spawnSync('tar', ['tf', 'a.tar'], { cwd: dir }).stdout.toString(), spawnSync('tar', ['-t', '-f', 'a.tar'], { cwd: dir }).stdout.toString());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('explains each letter as the dashed option, and gives values to f and C in order', () => {
    const old = top('tar cfvC a.tar dir sub');
    const dash = top('tar -c -f a.tar -v -C dir sub');
    const letters = old[0].children;
    assert.deepStrictEqual(letters.map((t) => t.label), ['c', 'f', 'v', 'C']);
    const dashExpl = new Map(dash.filter((t) => t.kind === 'option').map((t) => [t.label, t.explanation]));
    for (const l of letters) assert.strictEqual(l.explanation, dashExpl.get('-' + l.label), l.label);
    assert.deepStrictEqual(old.slice(1).map((t) => [t.label, t.explanation]), [
      ['a.tar', 'Value for `f`'], ['dir', 'Value for `C`'], ['sub', 'Word `sub`'],
    ]);
    assert.deepStrictEqual(letters.map((t) => t.span.start.character), [4, 5, 6, 7]);
    assert.strictEqual(old[0].explanation, 'Old-style options (no dash): `c` `f` `v` `C`');
  });

  it('reads the letters in Japanese', () => {
    const t = top('tar xzf a.tgz', 'ja');
    assert.match(t[0].explanation, /^旧式のオプション（ハイフンなし）: /);
    assert.deepStrictEqual(t[0].children.map((c) => c.label), ['x', 'z', 'f']);
    assert.strictEqual(t[1].explanation, '`f` の値');
  });

  it('keeps a quoted or expanded value as it is, and a missing value out', () => {
    const t = top('tar cf "$out" dir');
    assert.strictEqual(t[1].label, '"$out"');
    assert.strictEqual(t[1].explanation, 'Value for `f`');
    assert.ok(t[1].children.length > 0);
    assert.deepStrictEqual(top('tar xf').map((x) => x.label), ['xf']);
  });

  it('options after the bundle are ordinary options', () => {
    assert.deepStrictEqual(shape('tar xf a.tar -C out').slice(-2), ['-C: change to the given directory first', 'out: Value for `-C`']);
  });

  it('leaves other first words alone', () => {
    // (A first word of other characters, or of an unknown letter, is no bundle; tar refuses it: test/oldstyle-real.test.ts.)
    for (const src of ['tar --create -f a.tar d', 'tar -xf a.tar', 'tar a.tar', 'tar cfq a', 'tar xf2 a', 'tar $w a']) {
      const first = top(src)[0];
      assert.notStrictEqual(first.kind === 'option' && first.explanation.startsWith('Old-style'), true, src);
    }
    assert.strictEqual(top('tar a.tar')[0].explanation, 'Word `a.tar`');
    // The first word is letters whether or not one of them is an operation (tar then asks for one).
    for (const src of ['tar vf a.tar', 'tar zz a', 'tar f a.tar -t']) assert.match(top(src)[0].explanation, /^Old-style options/, src);
    // Only the first argument is a bundle.
    assert.strictEqual(top('tar -C d xf a.tar')[2].explanation, 'Word `xf`');
  });
});

describe('old-style options: ps', () => {
  it('reads aux and axjf as BSD options', () => {
    const t = top('ps axjf');
    assert.match(t[0].explanation, /^BSD-style options/);
    assert.deepStrictEqual(t[0].children.map((c) => c.label), ['a', 'x', 'j', 'f']);
    assert.match(t[0].children[3].explanation, /tree/);
    assert.deepStrictEqual(top('ps axo pid,comm').map((x) => [x.label, x.explanation]).slice(1), [['pid,comm', 'Value for `o`']]);
    assert.match(top('ps aux', 'ja')[0].explanation, /^BSD 形式のオプション/);
  });

  it('leaves PIDs and UNIX options alone', () => {
    assert.strictEqual(top('ps 1234')[0].explanation, 'process ID (a bare number is a BSD-style PID selection)');
    assert.strictEqual(top('ps -ef')[0].explanation, 'Combined short options `-e` `-f`');
    // (A number must come last in a BSD word: `u1x` is an error in ps.)
    assert.strictEqual(top('ps u1x')[0].explanation, 'Word `u1x`');
    // (procps has no end of options: `--` is an error, test/oldstyle-real.test.ts.)
    assert.strictEqual(top('ps aux --')[1].explanation, 'Not allowed here: procps ps does not take `--`, and fails (exit status 1)');
    assert.match(top('ps -- -ef', 'ja')[0].explanation, /^ここには書けない: procps の ps は `--` を受け付けず/);
  });

  it('reads a number at the end of BSD letters as a PID list, or as the value of a letter that takes one', () => {
    assert.deepStrictEqual(shape('ps u1'), [
      'u1: BSD-style options (no dash; some mean something else than the UNIX forms with `-`): `u` `1`',
      '  u: user-oriented format (user, CPU and memory share…)',
      '  1: process IDs (a number after BSD letters is a PID list, the same as `p`)',
    ]);
    assert.deepStrictEqual(shape('ps ax1,2').slice(-1), ['  1,2: process IDs (a number after BSD letters is a PID list, the same as `p`)']);
    assert.deepStrictEqual(shape('ps t1'), [
      't1: BSD-style options (no dash; some mean something else than the UNIX forms with `-`): `t`',
      '  t: only processes on these terminals',
      '  1: Value for `t`',
    ]);
    assert.match(top('ps u1', 'ja')[0].children[1].explanation, /^プロセス ID を指定/);
    // The words after it are PIDs too (`ps u1 2`).
    assert.strictEqual(top('ps u1 2')[1].explanation, 'process ID (a bare number is a BSD-style PID selection)');
    // A letter with a value before the number reads the rest of the word, the number too.
    assert.deepStrictEqual(shape('ps op1'), [
      'op1: BSD-style options (no dash; some mean something else than the UNIX forms with `-`): `o`',
      '  o: output columns (`o pid,comm`)',
      '  p1: Value for `o`',
    ]);
    // A word that is quoted or not known is read as far as it can be.
    assert.strictEqual(top("ps $'t1'")[0].kind, 'option');
    assert.strictEqual(top('ps u"1"')[0].children.length, 2);
    assert.strictEqual(top('ps $w')[0].kind, 'variable');
  });

  it('gives the rest of a BSD word to the first letter that takes a value, as procps does', () => {
    // (test/oldstyle-real.test.ts compares these with ps.)
    assert.deepStrictEqual(shape('ps opid,comm'), [
      'opid,comm: BSD-style options (no dash; some mean something else than the UNIX forms with `-`): `o`',
      '  o: output columns (`o pid,comm`)',
      '  pid,comm: Value for `o`',
    ]);
    assert.deepStrictEqual(shape('ps rUroot'), [
      'rUroot: BSD-style options (no dash; some mean something else than the UNIX forms with `-`): `r` `U`',
      '  r: only running processes',
      '  U: only processes of these users',
      '  root: Value for `U`',
    ]);
    // The next word is a value only when the letter ends the word.
    assert.deepStrictEqual(shape('ps U root').map((l) => l.trim().split(':')[0]), ['U', 'U', 'root']);
    // A letter that is not one ends the search: the word is plain.
    assert.strictEqual(top('ps a.b')[0].explanation, 'Word `a.b`');
    // (tar's letters take the next words, not the rest of the word.)
    assert.strictEqual(top('tar cfa.tar')[0].explanation.startsWith('Word'), true);
  });

  it('reads BSD letters after other options too, as procps does', () => {
    // `ps -p 1 u` is `ps u -p 1` (test/oldstyle-real.test.ts compares with ps).
    assert.match(top('ps -p 1 u')[2].explanation, /^BSD-style options/);
    assert.deepStrictEqual(shape('ps -o pid -p 1 o comm').slice(-3), [
      'o: BSD-style options (no dash; some mean something else than the UNIX forms with `-`): `o`', '  o: output columns (`o pid,comm`)', 'comm: Value for `o`',
    ]);
    assert.strictEqual(top('ps -C bash 12')[2].explanation, 'process ID (a bare number is a BSD-style PID selection)');
  });

  // What each letter makes ps print: a word of the header it shows with that letter.
  const headers: [string, RegExp][] = [
    ['u', /^USER +PID +%CPU/], ['j', /^ +PPID +PID +PGID +SID/], ['l', /^F +UID +PID +PPID/], ['v', /MAJFL/], ['s', /PENDING +BLOCKED/],
    ['X', /STACKP/], ['Z', /^LABEL/], ['a', /^ +PID TTY/], ['x', /^ +PID TTY/],
  ];
  for (const [letter, re] of headers) {
    it(`ps ${letter} prints ${re}`, function () {
      if (!have('ps')) return this.skip();
      const r = spawnSync('ps', [letter], { env: { ...process.env, COLUMNS: '200' } });
      assert.match(r.stdout.toString().split('\n')[0], re);
      const doc = top(`ps ${letter}`)[0].children[0].explanation;
      assert.ok(doc.length > 5);
    });
  }

  it('the letters ps accepts all have a description (and ps rejects the unknown N, C, y)', function () {
    if (!have('ps')) return this.skip();
    // ps rejects an unknown letter with "error: unsupported option". An accepted one may still print
    // nothing and fail: on CI there is no terminal, so `ps h` finds no process to list.
    const rejected = (l: string) => /unsupported option/.test(spawnSync('ps', [l], { env: { ...process.env, COLUMNS: '200' } }).stderr.toString());
    for (const l of 'axujflvsXZwhrTgmHncSL') assert.strictEqual(rejected(l), false, l);
    for (const l of 'NCy') assert.strictEqual(rejected(l), true, l);
    for (const l of 'NCy') assert.strictEqual(top(`ps ${l}`)[0].explanation, `Word \`${l}\``);
  });
});

describe('old-style options: ar', () => {
  it('rcs lib.a x.o is the dashed -rcs', function () {
    if (!have('ar')) return this.skip();
    // Every run of GNU ar loads the BFD plugins in /usr/lib/bfd-plugins. Where LLVM is installed (the
    // GitHub runners), LLVMgold pulls in libLLVM, over 100 MB. Read from a cold disk cache, after the
    // CI job's package installs, the first run can take more than the default 10 s.
    this.timeout(60000);
    assert.deepStrictEqual(run('ar', ['rcs', 'lib.a', 'src/a.txt']), run('ar', ['-r', '-c', '-s', 'lib.a', 'src/a.txt']));
    assert.deepStrictEqual(run('ar', ['rcs', 'lib.a', 'src/a.txt', 'src/sub/b.txt']), run('ar', ['-rcs', 'lib.a', 'src/a.txt', 'src/sub/b.txt']));
    assert.strictEqual(run('ar', ['rcs', 'lib.a', 'src/a.txt', 'src/sub/b.txt']).list, 'a.txt\nb.txt\n');
  });

  it('explains the letters and the archive', () => {
    const t = top('ar rcs lib.a x.o');
    assert.deepStrictEqual(t[0].children.map((c) => c.label), ['r', 'c', 's']);
    assert.match(t[1].explanation, /^archive/);
    assert.strictEqual(t[2].explanation, 'member file');
    const dashed = top('ar -rcs lib.a x.o')[0];
    assert.deepStrictEqual(dashed.children.map((c) => c.explanation), t[0].children.map((c) => c.explanation));
    assert.strictEqual(top('ar ra m lib.a x.o')[0].explanation.startsWith('Old-style'), true);
    assert.strictEqual(top('ar ra m lib.a x.o')[1].explanation, 'Value for `a`');
    assert.strictEqual(top('ar lib.a')[0].explanation.startsWith('archive'), true);
    assert.strictEqual(top('ar cv lib.a')[0].explanation.startsWith('archive'), true, 'c and v alone do not name an operation');
  });
});

describe('old-style options: jar, dump and restore', () => {
  it('jar cvfm takes the jar and the manifest in order', () => {
    const t = top('jar cvfm a.jar m.mf d');
    assert.deepStrictEqual(t.map((x) => x.explanation).slice(1), ['Value for `f`', 'Value for `m`', 'files to put in (or take out of) the archive']);
    assert.strictEqual(top('jar tf a.jar')[0].children.length, 2);
    assert.strictEqual(top('jar a.jar')[0].explanation.startsWith('files'), true);
  });

  it('dump 0uf and restore rf', () => {
    const d = top('dump 0uf /dev/st0 /home');
    assert.deepStrictEqual(d[0].children.map((c) => c.label), ['0', 'u', 'f']);
    assert.strictEqual(d[1].explanation, 'Value for `f`');
    assert.strictEqual(top('dump 5uf x /home')[0].children[0].explanation.startsWith('level 5'), true);
    assert.strictEqual(top('restore xf b')[0].children.length, 2);
    assert.strictEqual(top('restore u')[0].explanation.startsWith('files'), true);
    assert.strictEqual(top('dump u /home')[0].explanation.startsWith('file system'), true);
  });
});
