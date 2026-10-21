import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { describeFind, parseFind } from '../src/embedded/find';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const arity = (w: string) => (w === '-exec' ? 'until' as const : ['-name', '-path', '-wholename', '-type', '-mtime', '-newer', '-maxdepth', '-mmin'].includes(w) ? 1 : 0);

let parser: Parser;
before(async () => {
  const root = path.join(__dirname, '..');
  parser = createUnbashParser();
});

function tokens(src: string, lang: 'ja' | 'en' = 'en'): Token[] {
  const tree = parser.parse(src);
  const ex = new Analyzer(lang).explainLine(tree, 0);
  const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
  return all(ex.items);
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

  it('falls back to per-option explanations when the expression is incomplete', () => {
    const ts = tokens('find . -name x -o');
    assert.ok(!ts.some((t) => t.kind === 'test'));
    assert.ok(ts.some((t) => t.label === '-name'));
  });
});

describe('find numeric tests behave as the explanations say', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const { execFileSync } = require('child_process') as typeof import('child_process');
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
    assert.match(describeFind(parseFind(['-perm', '-664'], () => 1)!, 'ja'), /ビットがすべて/);
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
