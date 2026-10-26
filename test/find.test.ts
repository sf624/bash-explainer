import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { describeFind, parseFind } from '../src/embedded/find';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens } from './support/explain';

const arity = (w: string) => (w === '-exec' ? 'until' as const : ['-name', '-path', '-wholename', '-type', '-mtime', '-newer', '-maxdepth', '-mmin'].includes(w) ? 1 : 0);

let parser: Parser;
before(async () => {
  const root = path.join(__dirname, '..');
  parser = createUnbashParser();
});

function tokens(src: string, lang: 'ja' | 'en' = 'en'): Token[] {
  const tree = parser.parse(src);
  const ex = new Analyzer(lang).explainLine(tree, 0);
  return allTokens(ex.items);
}

describe('find expressions', () => {
  it('parses with -o binding looser than the implicit -a', () => {
    const tree = parseFind('-name a -o -name b -type f'.split(' '), arity)!;
    assert.strictEqual(tree.type, 'or');
    assert.deepStrictEqual(tree.type === 'or' && tree.children.map((c) => c.type), ['primary', 'and']);
  });

  it('describes conditions, groups, negation and the implicit -print', () => {
    const w = '( -name *.log -o -name *.tmp ) -mtime +7'.split(' ');
    assert.strictEqual(describeFind(parseFind(w, arity)!, 'en'),
      'Print what matches: (name matches *.log; or name matches *.tmp) and modified at least 8 days ago (age is counted in whole days, fraction dropped: `+7` means more than 7 whole days) (no action is given, so `-print` is implied)');
    assert.match(describeFind(parseFind('! -newer ref'.split(' '), arity)!, 'en'), /not \(newer than ref\)/);
    assert.match(describeFind(parseFind('-wholename ./a/*'.split(' '), arity)!, 'en'), /path matches \.\/a\/\*/);
    assert.match(describeFind(parseFind('-mmin -5'.split(' '), arity)!, 'en'), /modified less than 5 minutes ago/);
  });

  it('reads actions after conditions and spots the -prune idiom', () => {
    const d = describeFind(parseFind('-path ./node_modules -prune -o -type f -print'.split(' '), arity)!, 'en');
    assert.match(d, /^Conditions and actions: if path matches \.\/node_modules: skip it without descending; or if a regular file: print it/);
    assert.match(d, /usual way to exclude a directory/);
    assert.match(describeFind(parseFind('-name *.gz -exec rm {} +'.split(' '), arity)!, 'en'), /run "rm \{\}" on all at once/);
  });

  it('rejects incomplete expressions', () => {
    assert.strictEqual(parseFind('-name x -o'.split(' '), arity), undefined);
    assert.strictEqual(parseFind('( -name x'.split(' '), arity), undefined);
  });
});

describe('find in a command line', () => {
  it('wraps the expression in one token with grouping, operators and primaries inside', () => {
    const ts = tokens("find . \\( -name '*.log' -o -name '*.tmp' \\) -mtime +7");
    const expr = ts.find((t) => t.kind === 'test')!;
    assert.match(expr.explanation, /^Print what matches: \(name matches \*\.log; or name matches \*\.tmp\)/);
    assert.ok(ts.some((t) => t.kind === 'block' && /^Group/.test(t.explanation)));
    assert.match(ts.find((t) => t.label === '-o')!.explanation, /lower precedence than `-a`/);
    assert.match(ts.find((t) => t.label === "'*.log'" && t.kind === 'argument')!.explanation, /pattern: any string \+ "\.log"/);
    assert.match(ts.find((t) => t.label === '.')!.explanation, /starting directory/);
  });

  it('explains {} in -exec', () => {
    const ts = tokens('find . -name x -exec rm {} \;');
    assert.match(ts.find((t) => t.label === '{}')!.explanation, /replaced with the path/);
  });

  it('ends -exec as GNU find does, at `+` or `;` however it is quoted', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-exec-'));
    try {
      for (const f of ['a', 'b']) fs.writeFileSync(path.join(dir, f), '');
      for (const end of ['+', "'+'", '"+"', '\\+', '\\;', "';'"]) {
        const line = `find . -type f -exec echo {} ${end}`;
        const t = tokens(line).find((x) => x.label === end)!;
        // One echo for both files, or one each.
        const runs = execFileSync('bash', ['-c', line], { cwd: dir }).toString().trim().split('\n').length;
        assert.strictEqual(/pass all matches to one command/.test(t.explanation), runs === 1, `${line}: ${t.explanation}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads the words as find gets them, after the quote removal of bash', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const { execFileSync, spawnSync } = require('child_process') as typeof import('child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-quotes-'));
    try {
      for (const f of ['ab', 'abc', "a'b'c", 'a"b', "'a'b", '\\-name']) fs.writeFileSync(path.join(dir, f), '');
      const bash = (line: string) => execFileSync('bash', ['-c', line], { cwd: dir, timeout: 10000 }).toString();
      const found = (out: string) => out.split('\n').filter(Boolean).sort();
      for (const p of [`'a'"b"`, `'a'b'c'`, `"a"b`, `a\\b`, `'a"b'`, `"'a'b"`, `\\'a\\'b`, `"a'b'c"`]) {
        const line = `find . -type f -name ${p}`;
        // What we say find matches, what bash gives find, and what find finds with it.
        const said = /name matches (.*) \(no action/.exec(tokens(line).find((t) => t.kind === 'test')!.explanation)![1];
        assert.strictEqual(said, bash(`printf %s ${p}`), line);
        assert.deepStrictEqual(found(execFileSync('find', ['.', '-type', 'f', '-name', said], { cwd: dir, timeout: 10000 }).toString()), found(bash(line)), line);
      }
      // `'\-name'` is the path `\-name` (find starts its expression at a word that starts with `-`), not a test.
      const line = "find '\\-name' x";
      assert.ok(!tokens(line).some((t) => t.kind === 'test'), line);
      const run = spawnSync('bash', ['-c', line], { cwd: dir, timeout: 10000, encoding: 'utf8' });
      assert.strictEqual(run.stdout, '\\-name\n');
      assert.match(run.stderr, /'x': No such file or directory|‘x’: No such file or directory/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to per-option explanations when the expression is incomplete', () => {
    const ts = tokens('find . -name x -o');
    assert.ok(!ts.some((t) => t.kind === 'test'));
    assert.ok(ts.some((t) => t.label === '-name'));
  });
});

describe('find numeric tests behave as the explanations say', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const { execFileSync, spawnSync } = require('child_process') as typeof import('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-num-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const make = (name: string, size: number, ageDays: number, mode: number) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, Buffer.alloc(size));
    fs.chmodSync(f, mode);
    const t = (Date.now() - ageDays * 86400000) / 1000;
    fs.utimesSync(f, t, t);
  };
  make('empty', 0, 0.5, 0o644);
  make('one', 1, 6.5, 0o600);
  make('blk', 4609, 7.5, 0o664);
  make('k100', 100 * 1024 + 1, 8.5, 0o666);
  make('m', 1048577, 1.5, 0o755);
  const find = (...a: string[]) => execFileSync('find', [dir, '-type', 'f', ...a]).toString().split('\n').filter(Boolean).map((x) => path.basename(x)).sort();
  const text = (expr: string) => describeFind(parseFind(expr.split(' '), (w) => (['-mtime', '-size', '-perm', '-links'].includes(w) ? 1 : 0))!, 'en');
  it('-mtime counts whole days: +7 is 8 days or more, 7 is from 7 to 8, 0 is the last 24 hours', () => {
    assert.deepStrictEqual(find('-mtime', '+7'), ['k100']);
    assert.deepStrictEqual(find('-mtime', '7'), ['blk']);
    assert.deepStrictEqual(find('-mtime', '0'), ['empty']);
    assert.deepStrictEqual(find('-mtime', '-7'), ['empty', 'm', 'one']);
    assert.match(text('-mtime 7'), /between 7 and 8 days ago/);
    assert.match(text('-mtime 0'), /within the last 24 hours/);
    assert.match(text('-mtime -7'), /less than 7 days \(168 hours\)/);
    assert.match(describeFind(parseFind(['-mtime', '+7'], () => 1)!, 'ja'), /8日以上前に更新/);
  });
  it('-size rounds up to the unit: -1M is only empty files, a bare number counts 512-byte blocks', () => {
    assert.deepStrictEqual(find('-size', '-1k'), ['empty']);
    assert.deepStrictEqual(find('-size', '-1M'), ['empty']);
    assert.deepStrictEqual(find('-size', '-2M'), ['blk', 'empty', 'k100', 'one']);
    assert.deepStrictEqual(find('-size', '10'), ['blk']);
    assert.deepStrictEqual(find('-size', '+100k'), ['k100', 'm']);
    assert.deepStrictEqual(find('-size', '-2k'), ['empty', 'one']);
    assert.deepStrictEqual(find('-size', '-1c'), ['empty']);
    assert.match(text('-size -1k'), /empty files only/);
    assert.match(text('-size -3k'), /at most 2 KiB \(rounded up/);
    assert.match(text('-size 10'), /exactly 10 512-byte blocks after rounding up/);
    assert.match(text('-size +100k'), /over 100 KiB \(rounded up/);
    assert.match(text('-size xyz'), /size xyz/);
    assert.match(describeFind(parseFind(['-size', '-1M'], () => 1)!, 'ja'), /空ファイルだけ/);
    assert.match(describeFind(parseFind(['-size', '-3M'], () => 1)!, 'ja'), /2 MiB以下/);
    assert.match(describeFind(parseFind(['-size', '+3M'], () => 1)!, 'ja'), /3 MiBを超える/);
    assert.match(describeFind(parseFind(['-size', '3M'], () => 1)!, 'ja'), /3 MiBちょうど/);
  });
  it('-perm has three forms', () => {
    assert.deepStrictEqual(find('-perm', '664'), ['blk']);
    assert.deepStrictEqual(find('-perm', '-664'), ['blk', 'k100']);
    assert.deepStrictEqual(find('-perm', '/222'), ['blk', 'empty', 'k100', 'm', 'one']);
    assert.deepStrictEqual(find('-perm', '/020'), ['blk', 'k100']);
    assert.match(text('-perm 664'), /exactly 664/);
    assert.match(text('-perm -664'), /all the bits of 664/);
    assert.match(text('-perm /222'), /at least one of the bits of 222/);
    assert.match(describeFind(parseFind(['-perm', '-664'], () => 1)!, 'ja'), /664 のビット（[^）]*）がすべて/);
  });
  it('-perm names the bits of an octal mode: 4000 is SUID, 2000 SGID, 1000 the sticky bit; `+4000` is refused', () => {
    const special = fs.mkdtempSync(path.join(os.tmpdir(), 'find-perm-'));
    try {
      for (const [name, mode] of [['suid', 0o4755], ['sgid', 0o2755], ['sticky', 0o1777], ['plain', 0o644]] as const) {
        fs.writeFileSync(path.join(special, name), '');
        fs.chmodSync(path.join(special, name), mode);
      }
      const ls = (...a: string[]) => execFileSync('find', [special, '-type', 'f', ...a]).toString().split('\n').filter(Boolean).map((x) => path.basename(x)).sort();
      // (What `stat` calls the bits: `s` in the owner's and the group's execute place, `t` in the others'.)
      assert.strictEqual(execFileSync('stat', ['-c', '%A', path.join(special, 'suid'), path.join(special, 'sgid'), path.join(special, 'sticky')]).toString(), '-rwsr-xr-x\n-rwxr-sr-x\n-rwxrwxrwt\n');
      assert.deepStrictEqual(ls('-perm', '-4000'), ['suid']);
      assert.match(text('-perm -4000'), /all the bits of 4000 \(SUID, set-user-ID\)/);
      assert.deepStrictEqual(ls('-perm', '-2000'), ['sgid']);
      assert.match(text('-perm -2000'), /\(SGID, set-group-ID\)/);
      assert.deepStrictEqual(ls('-perm', '-1000'), ['sticky']);
      assert.match(text('-perm -1000'), /\(the sticky bit\)/);
      assert.deepStrictEqual(ls('-perm', '/6000'), ['sgid', 'suid']);
      assert.match(text('-perm /6000'), /at least one of the bits of 6000 \(SUID, set-user-ID; SGID, set-group-ID\)/);
      assert.deepStrictEqual(ls('-perm', '4755'), ['suid']);
      assert.match(text('-perm 4755'), /exactly 4755 \(SUID, set-user-ID; owner read, write, execute; group read, execute; others read, execute\)/);
      assert.match(text('-perm 644'), /exactly 644 \(owner read, write; group read; others read\)/);
      assert.match(describeFind(parseFind(['-perm', '-4000'], () => 1)!, 'ja'), /4000 のビット（SUID: set-user-ID）がすべて立っている/);
      assert.match(describeFind(parseFind(['-perm', '644'], () => 1)!, 'ja'), /644（所有者の読み・書き、グループの読み、その他の読み）/);
      // A symbolic mode is not named; `-000` has no bits to name.
      assert.match(text('-perm -u+s'), /all the bits of u\+s, whatever/);
      assert.match(text('-perm -000'), /all the bits of 000, whatever/);
      assert.deepStrictEqual(ls('-perm', '-u+s'), ['suid']);
      // GNU find no longer takes `+mode`.
      const r = spawnSync('find', [special, '-perm', '+4000'], { encoding: 'utf8' });
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr, /invalid mode/);
      assert.match(text('-perm +4000'), /GNU find rejects this form with "invalid mode"; any of the bits is `\/4000`/);
    } finally {
      fs.rmSync(special, { recursive: true, force: true });
    }
  });
  it('-links, -samefile and -newerXY are explained', () => {
    assert.deepStrictEqual(find('-links', '1'), ['blk', 'empty', 'k100', 'm', 'one']);
    assert.match(text('-links +1'), /more than 1 hard links/);
    assert.match(text('-links -2'), /fewer than 2 hard links/);
    const all = tokens("find . -newermt '2024-01-01' -newerac ref -samefile a -links 2").map((t) => t.explanation).join('\n');
    assert.ok(!all.includes('not in the dictionary'), all);
    const sentence = tokens("find . -newermt '2024-01-01' -newerac ref -anewer r -cnewer r -samefile a -links 2").find((t) => t.kind === 'test')!.explanation;
    for (const part of ['modified after 2024-01-01', 'accessed more recently than ref was status changed', 'the same file as a', 'exactly 2 hard links', 'accessed more recently than r was modified', 'status changed more recently than r was modified']) assert.ok(sentence.includes(part), sentence);
    assert.match(describeFind(parseFind(['-newerBm', 'r'], () => 1)!, 'en'), /created more recently than r was modified/);
  });
  it('warns when -maxdepth follows a test', () => {
    const t = (src: string, lang: 'ja' | 'en' = 'en') => tokens(src, lang).find((x) => x.kind === 'test')!.explanation;
    assert.match(t("find . -type f -maxdepth 1 -name '*.c'"), /global option/);
    assert.match(t("find . -type f -maxdepth 1 -name '*.c'", 'ja'), /検索全体に効く/);
    assert.doesNotMatch(t("find . -maxdepth 1 -type f"), /global option/);
    assert.doesNotMatch(t("find . -type f"), /global option/);
    assert.doesNotMatch(t("find . -maxdepth 1 -mindepth 1"), /global option/);
    assert.match(t("find . -maxdepth 2 -type f"), /at most 2 levels deep/);
    assert.match(t("find . -maxdepth 1 -type f"), /at most 1 level deep/);
  });
});
