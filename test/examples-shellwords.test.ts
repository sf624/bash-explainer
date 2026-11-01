import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PrintfReader } from '../src/embedded/format';
import { bashPrintf, globExamples, globMatches, globMiss, type GlobMiss, GlobOpts, liftMisses, literalEnds, ShellWordsUnsupported } from '../src/examples/shellwords';
import { globExample } from '../src/examples/patterns';
import { rerun } from '../src/examples/rerun';
import { braceTexts } from '../src/semantics/brace';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const bash = (script: string, ...args: string[]) => execFileSync('bash', ['-c', script, '_', ...args]).toString();

describe('brace expansion agrees with bash', () => {
  const parser = createUnbashParser();
  /** The words brace expansion makes of `w`, read as an argument (src/semantics/brace.ts). */
  const braceExpand = (w: string) => braceTexts([parser.parse(`echo ${w}`).root.namedChildren[0].namedChildren[1]]);
  const words = ['{1..5}', 'file{,.bak}', 'img_{a,b}{1,2}.png', '{01..10..3}', '{a..e}', 'x{a,{b,c}}y', '{10..1..4}', '{a}', '{}', 'a{b..x..5}',
    '{-2..2}', 'dir_{a,b}/{src,test}', '{a,b', 'pre{1..3}post', '\\{a,b\\}', '{,x}{,y}',
    '{a\\,b,c}', 'x{a,b\\}c}', '{1..5..0}', '{-05..3}', '{a..e..2}', '{e..a}', '{e..a..2}', '{a..e..0}',
    '{{a,b}}', '{a,{b,c}', '{a}b,c}', 'x{},a}', '{},a}', '{..},}', '{x..{a,b}}', '{x..{1..2}}', '{+1..3}', '{1..3..+1}', '{1..b}{x,y}'];
  for (const w of words) {
    it(w, () => {
      assert.strictEqual((braceExpand(w) ?? [w.replace(/\\(.)/g, '$1')]).join(' '), bash(`echo ${w}`).trim());
    });
  }
});

describe('the reasons a name does not match a glob agree with bash (panel P6)', () => {
  // Every name of a small tree that a glob does not match, with dotglob and globstar off and on: bash does not match
  // it, and matches it once its reasons are lifted (the option turned on, `[[ == ]]` for a `/`, the end or the start
  // of the name replaced).
  const TREE = ['app.ts', 'app.log', 'app.txt', '.app.log', '.env.ts', 'readme.md', 'src/a.ts', 'src/b.sh', 'src/lib/c.ts', 'src/lib/deep/d.ts', 'src/.hidden/e.ts', '.cache/f.ts',
    'log-2020-aa.md', 'log-2021-ab.txt', 'xsrc/g.ts', 'data_01.csv', 'data_1.csv', '.config/a.conf', '.config/sub/a.conf', '.github/workflows/ci.yml', '.github/workflows/old/a.yml',
    '.github/.hidden.yml'];
  const PATTERNS = ['*.log', '*.ts', '**/*.ts', 'src/*.ts', 'src/**', '*', '*/*.ts', 'log-202[0-4]-??.txt', 'data_??.csv', 'app*', 'src/**/*.ts', '?pp.*', '[a-c]*.ts', '*.[ch]',
    '.config/*.conf', '.github/workflows/*.yml', '.github/*.yml', '**/*.yml'];
  const OPTS: [string, GlobOpts][] = [['', {}], ['dotglob', { dotglob: true }], ['globstar', { globstar: true }], ['dotglob globstar', { dotglob: true, globstar: true }]];
  const shoptOf = (o: GlobOpts) => [o.dotglob ? 'dotglob' : '', o.globstar ? 'globstar' : ''].filter(Boolean).join(' ');
  it('lifts each reason in bash', function () {
    this.timeout(60000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glob-miss-'));
    try {
      type Check = { pattern: string; name: string; mode: 'file' | 'value'; opts: GlobOpts; matches: boolean };
      const checks: Check[] = [];
      const kinds = new Set<string>();
      for (const [, opts] of OPTS) {
        for (const pattern of PATTERNS) {
          for (const name of TREE.filter((n) => !globMatches(pattern, n, 'file', opts))) {
            const misses = globMiss(pattern, name, 'file', opts)!;
            assert.ok(misses, `${pattern} ${name}`);
            misses.forEach((m) => kinds.add(m.kind));
            checks.push({ pattern, name, mode: 'file', opts, matches: false });
            if (!misses.length) continue;
            const lifted = liftMisses(name, 'file', opts, misses);
            assert.ok(globMatches(pattern, lifted.name, lifted.mode, lifted.opts), `${pattern} ${name}`);
            checks.push({ pattern, ...lifted, matches: true });
            // (Each reason is needed: with one left out, it does not match.)
            for (const m of misses) {
              const fewer = liftMisses(name, 'file', opts, misses.filter((x) => x !== m));
              assert.ok(!globMatches(pattern, fewer.name, fewer.mode, fewer.opts), `${pattern} ${name} without ${m.kind}`);
            }
          }
        }
      }
      assert.deepStrictEqual([...kinds].sort(), ['dot', 'end', 'globstar', 'slash', 'start']);
      for (const c of checks) {
        if (c.mode !== 'file') continue;
        const file = path.join(dir, c.name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (!fs.existsSync(file)) fs.writeFileSync(file, '');
      }
      // (One bash for each set of options: for each check, `y` when bash matches the name.)
      const groups = new Map<string, Check[]>();
      for (const c of checks) groups.set(shoptOf(c.opts), [...groups.get(shoptOf(c.opts)) ?? [], c]);
      for (const [shopt, group] of groups) {
        const script = `cd "$1" && shift && shopt -s nullglob ${shopt}
while (($#)); do p=$1 n=$2 m=$3; shift 3
  r=n
  if [[ $m == value ]]; then [[ $n == $p ]] && r=y
  else for f in $p; do [[ $f == "$n" ]] && r=y; done; fi
  echo "$r"
done`;
        const out = execFileSync('bash', ['-c', script, '_', dir, ...group.flatMap((c) => [c.pattern, c.name, c.mode])]).toString().trim().split('\n');
        group.forEach((c, i) => assert.strictEqual(out[i] === 'y', c.matches, `${c.pattern} ${c.name} ${c.mode} ${shopt}`));
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('names the reasons it finds', () => {
    const miss = (p: string, n: string, o: GlobOpts = {}) => globMiss(p, n, 'file', o);
    const cases: [string, string, GlobOpts, GlobMiss[] | undefined][] = [
      ['*.log', 'app.log', {}, undefined], ['*.log', 'app.txt', {}, [{ kind: 'end', text: '.log', cut: 0 }]], ['*.log', '.app.log', {}, [{ kind: 'dot' }]],
      ['*.log', '.app.log', { dotglob: true }, undefined], ['*.log', '.app.txt', {}, [{ kind: 'dot' }, { kind: 'end', text: '.log', cut: 0 }]],
      ['src/*.ts', 'src/lib/a.ts', {}, [{ kind: 'slash' }]], ['**/*.ts', 'src/lib/a.ts', {}, [{ kind: 'globstar' }]], ['**/*.ts', '.cache/a.ts', { globstar: true }, [{ kind: 'dot' }]],
      ['/var/log/*.log', 'app.log', {}, [{ kind: 'start', text: '/var/log/', cut: 0 }]], ['/var/log/*.log', 'x/var/log/app.log', {}, [{ kind: 'start', text: '/var/log/', cut: 10 }]],
      ['log-202[0-4]-??.txt', 'log-2020-aa.md', {}, [{ kind: 'end', text: '.txt', cut: 3 }]], ['*', '.cache/f.ts', {}, [{ kind: 'slash' }]],
      // (A dot the pattern spells is no reason: with dotglob on, bash still does not match.)
      ['.config/*.conf', '.config/sub/a.conf', {}, [{ kind: 'slash' }]], ['.github/workflows/*.yml', '.github/workflows/old/a.yml', {}, [{ kind: 'slash' }]],
      ['.github/*.yml', '.github/.hidden.yml', {}, [{ kind: 'dot' }]],
      ['a?c', 'abbc', {}, []], ['*.LOG', 'app.log', { nocase: true }, undefined], ['*.LOG', 'app.txt', { nocase: true }, [{ kind: 'end', text: '.LOG', cut: 0 }]],
      // (A bracket expression bash reads by the locale has no regex: no reason found.)
      ['[[.space.]]*.log', 'a.txt', {}, []], ['\\**.log', 'x.log', {}, [{ kind: 'start', text: '*', cut: 0 }]], ['\\*.log', 'x.log', {}, []],
    ];
    for (const [p, n, o, want] of cases) assert.deepStrictEqual(miss(p, n, o), want, `${p} ${n}`);
    // (The text at the ends: escapes removed, up to a wildcard, a bracket expression or an extended glob.)
    for (const [p, ends] of [['src/*.log', ['src/', '.log']], ['a\\*b?c', ['a*b', 'c']], ['x[ab]y@(p|q)z', ['x', 'z']], ['a[b*c', ['a[b', 'c']], ['*\\', ['', '\\']], ['abc', ['', '']], ['?(x', ['', '(x']]] as const) {
      assert.deepStrictEqual(Object.values(literalEnds(p)), ends, p);
    }
    // (In the values of `find -name`, `case` and `[[ == ]]`, `*` matches a `/` and a leading dot.)
    assert.deepStrictEqual(globMiss('*.log', 'a/.b.txt', 'value'), [{ kind: 'end', text: '.log', cut: 0 }]);
  });
  it('says the reasons in the sections of the example and of the names typed in the panel', () => {
    const labels = (lang: 'en' | 'ja') => globExample('*.log', 'file', {}, undefined, 'Example', undefined, lang)!.sections.map((x) => `${x.label}: ${x.lines.join(' ')}`);
    assert.deepStrictEqual(labels('en'), ['Matching file names: app.log data.log error.log', 'Not matching: it does not end in `.log`: app.txt', 'Not matching: a leading `.` (`dotglob` is off): .app.log']);
    assert.deepStrictEqual(labels('ja'), ['一致するファイル名: app.log data.log error.log', '一致しない: `.log` で終わらない: app.txt', '一致しない: 先頭が `.`（`dotglob` がオフ）: .app.log']);
    // (Without globstar, `**/*.ts` is `*/*.ts`.)
    const typed = rerun({ kind: 'glob', pattern: '**/*.ts', mode: 'file' }, [['src/a.ts', 'src/lib/b.ts', '.c/a.ts', 'src/d.js', 'x/e.md', 'e.md', '']], 'en').sections.map((x) => `${x.label}: ${x.lines.join(' ')}`);
    assert.deepStrictEqual(typed, ['Matching names: src/a.ts', 'Not matching: `**` is `*` (`globstar` is off): src/lib/b.ts', 'Not matching: a leading `.` (`dotglob` is off): .c/a.ts',
      'Not matching: it does not end in `.ts`: src/d.js x/e.md', 'Not matching: `**` is `*` (`globstar` is off); it does not end in `.ts`: e.md']);
    const ja = rerun({ kind: 'glob', pattern: 'src/*', mode: 'file' }, [['src/a/b', 'lib/a', 'x']], 'ja').sections.map((x) => `${x.label}: ${x.lines.join(' ')}`);
    assert.deepStrictEqual(ja, ['一致する名前: ', '一致しない: `*` と `?` は `/` に一致しない: src/a/b', '一致しない: `src/` で始まらない: lib/a x']);
    // (A name a pattern of GLOBIGNORE leaves out says so.)
    const ignored = globExample('*.log', 'file', {}, '.*:data*', 'Example', undefined, 'en')!.sections.map((x) => `${x.label}: ${x.lines.join(' ')}`);
    assert.ok(ignored.includes('Not matching: a pattern of `GLOBIGNORE` matches it: data.log'), ignored.join('\n'));
    // (Every name it matches left out: no section of matching names.)
    assert.deepStrictEqual(globExample('*.log', 'file', {}, '*', 'Example', undefined, 'en')!.sections.map((x) => x.label), ['Not matching: it does not end in `.log`',
      'Not matching: a leading `.` (`dotglob` is off)', 'Not matching: a pattern of `GLOBIGNORE` matches it']);
    // (A name with no reason found.)
    assert.deepStrictEqual(rerun({ kind: 'glob', pattern: 'a?c', mode: 'value' }, [['abc', 'abbc']], 'en').sections.map((x) => `${x.label}: ${x.lines.join(' ')}`), ['Matching names: abc', 'Not matching: abbc']);
  });
});

describe('printf agrees with bash', () => {
  const cases: string[][] = [
    ['%-10s|%05.2f|%x\\n', 'name', '3.14159', '255'], ['%s=%s\\n', 'a', '1', 'b', '2', 'c'], ['%d%%\\n', '42'], ['\\033[1;32m%s\\033[0m\\n', 'OK'],
    ['%b\\n', 'a\\tb'], ['%b|', 'stop\\chere'], ['%q\\n', "it's a test"], ['%c|%5s|%-5s|\\n', 'hello', 'ab', 'cd'], ['%d\\n', "'A"], ['%x %o %e\\n', '255', '8', '1234.5'],
    ['hello\\n'], ['%s\\n'], ['%5.1f|%-6d|%+d\\n', '2.25', '42', '7'], ['%.0f %.0f %.1f %.2f\\n', '0.5', '1.5', '0.25', '2.675'], ['%s\\n', 'a', 'b', 'c'], ['%*d|\\n', '5', '42'], ['%.3s\\n', 'abcdef'], ['no newline'],
    ['%d\\n', '0x1F'], ['%g %g\\n', '0.0001234', '1e7'], ['\\x41\\u00e9\\n'],
    ['a\\177b\\\\\\n'], ['a\\'], ['a\\\nb\n'], ['\\q\\c\\n'], ['%b|', 'a\\'], ['%b|', '\\0101\\x41\\u00e9'], ['\\400|\\1234\\18\\0\\00001|'], ['\\"\\?\\a\\E\\\''], ['%b|', '\\"\\?\\\'\\\\'],
    ['%x %o %u\\n', '-1', '-8', '-1'], ['%d %d %i\\n', '-010', '+010', '-0x10'], ['%#x %#o %#X %#x\\n', '255', '8', '255', '0'], ['%.3e|%.0e|%.0e|%.1e|%.0e\\n', '12345', '2.5', '3.5', '0.25', '9.5'],
    ['%#5x|%#.3x|%-#8o|%#08x\\n', '255', '5', '8', '255'], ['%5.2d|%.0d|\\n', '3', '0'], ['%d %i\\n', '-0x1f', '0x1f'], ['%e\\n', '1e3'], ['%f\\n', '0x10'],
    ['%d\\n', ' 3'], ['%g %G %g\\n', '100000', '1e-5', '1e6'], ['%+x|% x\\n', '5', '5'], ['%.2e %.1e\\n', '1.005', '1.25'],
    ['%q|%.*f|%b|%q|%c|%d|%d\\n', '', '2', '3.14159', 'a\\qb', '', '', "'", '010'], ['%s|%b|%q|%c|%d\\n'],
    // The same in bash 5.2 and 5.3 (test/bash53.test.ts has what differs): `%Q`, the length modifiers of C, widths and
    // precisions in bytes, what `%q` quotes.
    ['%Q|%.2Q|%5Q|%-6Q|%.1Q|\\n', 'a b', 'a b c', 'x', 'y z', "it's"], ['%ld|%hhd|%lu|%zx|%jo|%Lf|%lld|%lq|%lb\\n', '5', '300', '7', '255', '8', '1.5', '9', 'a b', 'x\\ty'],
    ['%5s|%.2s|%-4s|%5b|%5q|%.3s|\\n', 'é', 'éa', 'é', 'é', 'ab', 'aé'], ['%*s|%-*s|%*c|\\n', '-4', 'ab', '3', 'c', '-2', 'd'], ['%05s|%-05s|%05q|\\n', 'ab', 'cd', 'e f'],
    ['%q|%q|%q|%q|%q|%q\\n', 'a,b^c#d~e', '#a', '~a', 'x=~a:~b', '!a{b}[c]?*$`"<>()&;| ', 'a%b+c=d@e.f:g/h-i_j'], ['%#q|%#Q|%#x|%#o|%#e|%#g|%#d|%#s\\n', '', '', '255', '8', '1', '1', '5', 'ab'],
    ['%lc|%5ls|%.1ls\\n', 'ab', 'cd', 'ef'],
    ['%.s|%ls|%Q|%.2Q|%q|\\n'], ['%#.0f|%#5.0f|%#.0e|%#.0E|%#.0g|%#-6.0f|\\n', '3', '3', '3', '-3', '3', '-2'], ['%.Q|%.0Q|%.q|%.Q|\\n', 'abc', 'abc', 'abc'],
  ];
  for (const [fmt, ...args] of cases) {
    it(JSON.stringify([fmt, ...args]), () => {
      assert.strictEqual(bashPrintf(fmt, args), bash('printf "$@"', fmt, ...args));
    });
  }
});

describe('printf arguments bash rejects are not run', () => {
  for (const [fmt, arg] of [['%d', '1.5'], ['%d', '1e3'], ['%x', '1.5'], ['%u', '5.5'], ['%d', '3 '], ['%d', 'abc'], ['%d', '99999999999999999999'], ['%*d', '1e1'], ['%5%', '1'], ['%l%', '1']]) {
    it(`${fmt} ${arg}`, () => {
      assert.throws(() => bashPrintf(fmt, [arg]), /./);
    });
  }
});

describe('printf output that depends on what is not known is not shown', () => {
  // The bash release (`%#q`, `%S`, `%C`: test/bash53.test.ts), the program, the locale (a character that is not ASCII in
  // `%q`, `%c`, `%ls`), or bytes that are not text (a precision that cuts a character).
  const cases: [string, string, PrintfReader?][] = [
    ['%#q', 'a'], ['%#Q', 'a'], ['%S', 'a'], ['%C', 'a'], ['%S', 'a', '5.2'], ['%q', 'é', '5.2'], ['%c', 'é', '5.3'], ['%ls', 'é', '5.3'], ['%lc', 'é', '5.2'],
    ['%.1s', 'é', '5.2'], ['%.2Q', 'aé', '5.3'], ['%q', 'a b', 'coreutils'], ['%Q', 'a', 'coreutils'], ['%S', 'a', 'coreutils'], ['%5b', 'a', 'coreutils'], ['%#d', '1', 'coreutils'],
    ['%.*Q', '1'], ['%5.Q', 'a', '5.2'],
  ];
  for (const [fmt, arg, reader] of cases) {
    it(`${fmt} ${arg} (${reader ?? 'unknown'})`, () => {
      assert.throws(() => bashPrintf(fmt, [arg], reader), ShellWordsUnsupported);
    });
  }
  it('shows what coreutils printf prints', () => {
    for (const [fmt, ...args] of [['%ld|%ls|%lc|%5s|%.2s|%c|\\n', '5', 'x', 'y', 'é', 'éa', 'z']]) {
      assert.strictEqual(bashPrintf(fmt, args, 'coreutils'), execFileSync('/usr/bin/printf', [fmt, ...args]).toString());
    }
  });
});

describe('glob examples agree with bash and find', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glob-'));
  const shellMatches = (pattern: string, name: string) => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, name), '');
    const out = execFileSync('bash', ['-c', 'cd "$1" && shopt -s nullglob && for f in $2; do echo "$f"; done', '_', dir, pattern]).toString();
    fs.rmSync(dir, { recursive: true });
    return out.trim() === name;
  };
  for (const p of ['*.log', 'data_??.csv', '[abc]*.txt', 'backup-*', '*', 'report[0-9].pdf', '[!.]*']) {
    it(`file ${p}`, () => {
      const ex = globExamples(p, 'file')!;
      for (const n of ex.matching) assert.ok(shellMatches(p, n), `${n} should match`);
      for (const n of ex.nonMatching) assert.ok(!shellMatches(p, n), `${n} should not match`);
    });
  }
  for (const p of ['*.tar.gz', '[0-9]*', 'start', '*/*', '-h', '?']) {
    it(`value ${p}`, () => {
      const ex = globExamples(p, 'value')!;
      const caseMatches = (v: string) => bash('case "$1" in $2) echo y;; *) echo n;; esac', v, p).trim() === 'y';
      for (const v of ex.matching) assert.ok(caseMatches(v), `${v} should match`);
      for (const v of ex.nonMatching) assert.ok(!caseMatches(v), `${v} should not match`);
    });
  }
  // Every file and directory of a small tree, as bash expands the glob, with and without globstar.
  const TREE = ['app.ts', 'readme.md', 'README.MD', '.env.ts', 'src/a.ts', 'src/B.TS', 'src/b.sh', 'src/lib/c.ts', 'src/lib/deep/d.ts', 'src/.hidden/e.ts', '.cache/f.ts', 'test/g.ts', 'Src/h.ts', 'Src/I.TS'];
  const OPTS: [string, GlobOpts][] = [['none', {}], ['globstar', { globstar: true }], ['dotglob', { dotglob: true }], ['nocaseglob', { nocase: true }], ['globstar dotglob nocaseglob', { globstar: true, dotglob: true, nocase: true }]];
  for (const [names, opts] of OPTS) {
    for (const p of ['**/*.ts', 'src/**/*.ts', 'src/**', '**', '*', '*/*.ts', 'src/**/lib/*.ts', '**/lib/*', 'a**.ts', '**/.hidden/*.ts', '*.md', '.*', '?eadme.*', 'src/*.ts', 's[a-z]c/*.ts', 'README.*']) {
      it(`${names}: ${p}`, () => {
        const dir = tmp();
        for (const f of TREE) {
          fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
          fs.writeFileSync(path.join(dir, f), '');
        }
        const shopt = `shopt -s nullglob ${names === 'none' ? '' : names}`;
        const out = execFileSync('bash', ['-c', `cd "$1" && ${shopt} && for f in $2; do echo "$f"; done`, '_', dir, p]).toString();
        const all = execFileSync('find', ['.', '-mindepth', '1', '-printf', '%P\\n'], { cwd: dir }).toString().trim().split('\n');
        fs.rmSync(dir, { recursive: true });
        // bash lists `src/` itself for `src/**`, and `.` and `..` for `.*`; this matcher only answers for names in the tree.
        const expected = out.trim().split('\n').filter((n) => n && !n.endsWith('/') && n !== '.' && n !== '..').sort();
        assert.deepStrictEqual(all.filter((n) => globMatches(p, n, 'file', opts)).sort(), expected);
        const ex = globExamples(p, 'file', opts);
        if (ex) {
          for (const n of ex.matching) assert.ok(globMatches(p, n, 'file', opts), n);
          for (const n of ex.nonMatching) assert.ok(!globMatches(p, n, 'file', opts), n);
        }
      });
    }
  }
  const EXT_TREE = ['a.txt', 'b.md', 'app.ts', 'keep.log', 'old.log', 'ab.txt', 'aab.txt', 'c.txt', 'y', 'xy', 'xxy', '.hidden.ts', 'ababc', 'c', 'src/lib/x.ts', 'src/app/y.ts'];
  for (const p of ['!(*.txt)', '*.@(ts|md)', '+(a|b).txt', '?(x)y', 'src/!(lib)', '!(keep).log', '@(app|old)*', '*(ab)c', '!(*.@(txt|md))', 'src/@(lib|app)/*.ts']) {
    it(`extglob file ${p}`, () => {
      const dir = tmp();
      for (const f of EXT_TREE) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.writeFileSync(path.join(dir, f), '');
      }
      // extglob must be on when bash reads the line, so the pattern comes from a variable.
      const out = execFileSync('bash', ['-c', 'shopt -s extglob nullglob\ncd "$1" && for f in $2; do echo "$f"; done', '_', dir, p]).toString();
      const all = execFileSync('find', ['.', '-mindepth', '1', '-printf', '%P\\n'], { cwd: dir }).toString().trim().split('\n');
      fs.rmSync(dir, { recursive: true });
      const expected = out.trim().split('\n').filter(Boolean).sort();
      assert.deepStrictEqual(all.filter((n) => globMatches(p, n, 'file')).sort(), expected);
      const ex = globExamples(p, 'file')!;
      assert.ok(ex, 'examples');
      for (const n of ex.matching) assert.ok(globMatches(p, n, 'file'), n);
      for (const n of ex.nonMatching) assert.ok(!globMatches(p, n, 'file'), n);
    });
  }
  for (const p of ['@(start|stop)', '!(*.bak)', '+([0-9])', 'v?(.)+([0-9])', '*.@(jpg|png)', '*.!(x)', 'a!(b)?', '!(x)[ab]']) {
    it(`extglob value ${p}`, () => {
      const ex = globExamples(p, 'value')!;
      assert.ok(ex?.nonMatching.length, 'examples');
      const caseMatches = (v: string) => execFileSync('bash', ['-c', 'shopt -s extglob\neval \'case "$1" in \'"$2"\') echo y;; *) echo n;; esac\'', '_', v, p]).toString().trim() === 'y';
      for (const v of ex.matching) assert.ok(caseMatches(v), `${v} should match`);
      for (const v of ex.nonMatching) assert.ok(!caseMatches(v), `${v} should not match`);
    });
  }
  it('examples show what dotglob and nocase add', () => {
    assert.ok(globExamples('*.ts', 'file', { dotglob: true })!.matching.includes('.app.ts'));
    assert.ok(globExamples('*.ts', 'file', { nocase: true })!.matching.includes('APP.TS'));
    assert.ok(!globExamples('*.ts', 'file', { nocase: true })!.nonMatching.some((n) => n.toLowerCase().endsWith('.ts') && !n.startsWith('.')));
  });
  it('globstar examples reach into subdirectories, without it one level only', () => {
    assert.deepStrictEqual(globExamples('**/*.ts', 'file', { globstar: true })!.matching, ['app.ts', 'src/data.ts', 'src/lib/error.ts']);
    assert.ok(globExamples('**/*.ts', 'file', { globstar: true })!.nonMatching.includes('.cache/app.ts'));
    assert.deepStrictEqual(globExamples('**/*.ts', 'file')!.matching, ['app/app.ts', 'data/data.ts', 'error/error.ts']);
    assert.ok(globExamples('**/*.ts', 'file')!.nonMatching.includes('src/app/app.ts'));
  });
  it('find -name matches names starting with a dot', () => {
    const ex = globExamples('*.tmp', 'value')!;
    const dir = tmp();
    for (const n of [...ex.matching, ...ex.nonMatching, '.hidden.tmp']) fs.writeFileSync(path.join(dir, n), '');
    const found = execFileSync('find', [dir, '-name', '*.tmp', '-printf', '%f\\n']).toString().trim().split('\n').sort();
    fs.rmSync(dir, { recursive: true });
    assert.deepStrictEqual(found, [...ex.matching, '.hidden.tmp'].sort());
  });
});
