// What a stage of a pipeline reads of the section before it (src/examples/marks.ts, `stageMarks`), checked against the
// real tools on the made-up outputs (src/examples/layouts.ts) and on lines made to show the edge cases: the matches GNU
// grep prints with `-o -b`, those sed replaces (shown by a substitution that wraps them), the fields gawk splits (its
// `split` with separators) and its `match()`, the fields and characters GNU cut prints, the keys `sort --debug`
// underlines; and the lines each leaves out.
import * as assert from 'assert';
import { explain } from './support/explain';
import { run } from './support/run';
import type { Layout } from '../src/argv/spec';
import { posixMatches } from '../src/examples/regex';
import { pipelineExample, runGrep, type Stage, stageMarks } from '../src/examples/pipeline';
import { layoutSample } from '../src/examples/layouts';
import { rerun } from '../src/examples/rerun';

const C = { ...process.env, LC_ALL: 'C' };
const lines = (out: Buffer) => out.toString().replace(/\n$/, '').split('\n').filter((l, i, a) => !(a.length === 1 && l === ''));
const real = (cmd: string, args: string[], input: string[]) => lines(run(cmd, args, { input: input.map((l) => l + '\n').join(''), env: C }).stdout);
const stage = (cmd: string, ...words: string[]): Stage => ({ cmd, words, text: [cmd, ...words].join(' ') });
/** Ranges that overlap or touch made one, as the marks are drawn. */
const join = (rs: [number, number][]) => [...rs].sort((a, b) => a[0] - b[0]).reduce<[number, number][]>((acc, r) => {
  const last = acc[acc.length - 1];
  if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
  else acc.push([...r]);
  return acc;
}, []);
/** The marked parts of each line, as text: `[[0, 5]]` of `nginx: …` is `nginx`. */
const texts = (input: string[], ranges: [number, number][][]) => ranges.map((rs, i) => rs.map(([a, b]) => input[i].slice(a, b)));

const SAMPLES: [Layout, string[]][] = [['ps-bsd-u', ['ps', 'aux']], ['ps-full', ['ps', '-ef']], ['ls-long', ['ls', '-l']], ['ls-long-all', ['ls', '-la']], ['df-human', ['df', '-h']], ['who', ['who']], ['env', ['env']]];
const samples = SAMPLES.map(([kind, argv]) => layoutSample(kind, [argv, ['grep', 'nginx']], 0));
const EDGES = ['ab abab', 'xx a xxx', 'alice:x:1000:1000::/home/alice:/bin/bash', 'a::b', 'no delimiter here', '', '  lead  trail  ', 'AbC abc ABC', 'a.b.c', '1.5K 220 Mar', '-3 .5x 5.K'];
const ALL = [...samples, EDGES];

describe('pipeline marks: grep, as GNU grep matches', () => {
  /** Each line's matches as `grep -o -b -n` prints them (offsets from the start of the input, made per line). */
  const grepO = (args: string[], input: string[]): [number, number][][] => {
    const starts = input.map((_, i) => input.slice(0, i).reduce((n, l) => n + l.length + 1, 0));
    const out: [number, number][][] = input.map(() => []);
    for (const row of real('grep', ['-o', '-b', '-n', ...args], input)) {
      const m = /^(\d+):(\d+):(.*)$/.exec(row)!;
      const k = Number(m[1]) - 1;
      out[k].push([Number(m[2]) - starts[k], Number(m[2]) - starts[k] + m[3].length]);
    }
    return out.map(join);
  };
  const cases = [
    ['nginx'], ['-i', 'NGINX'], ['-w', 'alice'], ['-x', 'a::b'], ['-E', 'ng(i|x)+'], ['-F', '.'], ['-e', 'a', '-e', 'ab'], ['a\\|ab'],
    ['-E', 'x*'], ['-P', 'a|ab'], ['-w', 'ab'], ['[0-9]\\+'], ['-E', '^[a-z]+'], ['-o', 'b$'], ['-n', 'x'], ['-m', '1', 'a'],
  ];
  for (const args of cases) {
    it(`grep ${args.join(' ')}`, () => {
      for (const input of ALL) {
        const m = stageMarks(stage('grep', ...args), input);
        const want = grepO(args.filter((a) => a !== '-o' && a !== '-n'), input);
        assert.deepStrictEqual(m?.ranges ?? input.map(() => []), want, input[0]);
        // The lines it leaves out are those it does not print.
        const printed = new Set(real('grep', ['-n', ...args.filter((a) => a !== '-o')], input).map((r) => Number(r.split(':')[0]) - 1));
        assert.deepStrictEqual(m?.dropped ?? [], printed.size === input.length ? [] : input.flatMap((_, i) => (printed.has(i) ? [] : [i])));
      }
    });
  }
  it('grep -v: the matches on the lines it leaves out; -c and -q: as many lines as they read', () => {
    const input = samples[0];
    const m = stageMarks(stage('grep', '-v', 'grep'), input)!;
    assert.deepStrictEqual(m.ranges, grepO(['grep'], input));
    assert.deepStrictEqual(m.dropped, input.flatMap((l, i) => (l.includes('grep') ? [i] : [])));
    assert.deepStrictEqual(stageMarks(stage('grep', '-c', 'S'), input), stageMarks(stage('grep', 'S'), input));
    assert.deepStrictEqual(stageMarks(stage('grep', '-q', 'S'), input), stageMarks(stage('grep', '-m1', 'S'), input));
    // (egrep is grep -E.)
    assert.deepStrictEqual(stageMarks(stage('egrep', 'ng(i|x)+'), input), stageMarks(stage('grep', '-E', 'ng(i|x)+'), input));
  });
  it('grep -o prints the longest match, as GNU grep does', () => {
    for (const args of [['a\\|ab'], ['-e', 'a', '-e', 'ab'], ['-F', '-e', 'a', '-e', 'ab'], ['-E', '(a|ab)(c|bcd)']]) {
      const input = ['abcd ab', 'abab'];
      assert.deepStrictEqual(runGrep(['-o', ...args], input), real('grep', ['-o', ...args], input), args.join(' '));
    }
  });
});

describe('pipeline marks: sed, as GNU sed matches', () => {
  /** What sed's `s` replaces, wrapped in \x01 \x02 by the real sed: each line's ranges. */
  const wrapped = (script: string, input: string[], extended: boolean): [number, number][][] =>
    real('sed', [...(extended ? ['-E'] : []), script], input).map((l) => {
      const out: [number, number][] = [];
      let shift = 0;
      for (const m of l.matchAll(/\x01([^\x02]*)\x02/g)) {
        if (m[1]) out.push([m.index - shift, m.index - shift + m[1].length]);
        shift += 2;
      }
      return out;
    });
  const cases: [string[], string, string][] = [
    // [sed's words, the substitution that wraps what it matches, flags]
    [['s/a\\|ab/X/'], 's/a\\|ab/\x01&\x02/', ''],
    [['s/[0-9]\\+/N/g'], 's/[0-9]\\+/\x01&\x02/g', ''],
    [['-E', 's/(a|b)+/X/2'], 's/(a|b)+/\x01&\x02/2', 'E'],
    [['s/x*/-/g'], 's/x*/\x01&\x02/g', ''],
    [['-E', 's/[a-z]+/W/2g'], 's/[a-z]+/\x01&\x02/2g', 'E'],
  ];
  for (const [words, wrap, flags] of cases) {
    it(`sed ${words.join(' ')}`, () => {
      for (const input of ALL) {
        const m = stageMarks(stage('sed', ...words), input);
        assert.deepStrictEqual(m?.ranges ?? input.map(() => []), wrapped(wrap, input, flags === 'E'), input[0]);
        assert.deepStrictEqual(m?.dropped ?? [], []);
      }
    });
  }
  for (const words of [['-n', '/nginx/p'], ['/^total/d'], ['/a/!d'], ['1d'], ['$d'], ['-n', '/a/!p'], ['/x/p'], ['-n', 's/a/A/p'], ['-n', 's/a/A/'], ['#n\n/a/p']]) {
    it(`sed ${words.join(' ')}: the first match of its regex, and the lines it leaves out`, () => {
      const subst = words.some((w) => w.startsWith('s/'));
      for (const input of ALL) {
        const m = stageMarks(stage('sed', ...words), input);
        // (The lines it prints are told by their text: the lines of each input differ.)
        const out = real('sed', words, input);
        const left = input.flatMap((l, i) => (out.includes(subst ? l.replace('a', 'A') : l) ? [] : [i]));
        assert.deepStrictEqual(m?.dropped ?? [], left, `${words.join(' ')} on ${input[0]}`);
        const re = /\/([^/]*)\//.exec(words[words.length - 1])?.[1];
        if (re) assert.deepStrictEqual(m?.ranges ?? input.map(() => []), wrapped(`s/${re}/\x01&\x02/`, input, false));
      }
    });
  }
  it('has no marks for a script of several commands, a range, a step, `!s` or an empty regex', () => {
    for (const script of ['p;p', '/a/,/b/d', '1~2d', '1!s/a/b/', '/a/s/a/b/', '//d', 'y/a/b/', '=']) assert.strictEqual(stageMarks(stage('sed', script), EDGES), undefined, script);
  });
  it('sed s replaces the longest match, as GNU sed does', () => {
    const ex = pipelineExample([stage('sed', 's/a\\|ab/X/g')], true, ['abab', 'ab a']);
    assert.deepStrictEqual(ex?.steps[0].output, real('sed', ['s/a\\|ab/X/g'], ['abab', 'ab a']));
  });
});

describe('pipeline marks: awk, as gawk splits and matches', () => {
  /** Where each field of each line lies, as gawk splits it (`split` with the separators). */
  const spans = (fs: string[], input: string[]): [number, number][][] =>
    real('gawk', [...fs, '{ n = split($0, f, FS, s); p = length(s[0]); for (i = 1; i <= n; i++) { printf "%d %d ", p, p + length(f[i]); p += length(f[i]) + length(s[i]) } print "" }'], input)
      .map((l) => { const n = l.trim() ? l.trim().split(' ').map(Number) : []; return n.flatMap((x, i) => (i % 2 ? [] : [[x, n[i + 1]] as [number, number]])); });
  const cases: [string[], (n: number) => number[], number[], string][] = [
    // [awk's words, the fields it reads of each line of n fields, those it reads of a line it selects, the pattern]
    [['{print $2}'], () => [2], [], ''],
    [['{print $NF}'], (n) => [n], [], ''],
    [['-F:', '{print $1, $3}'], () => [1, 3], [], ''],
    [['-F', '[:=]', '{print $2}'], () => [2], [], ''],
    [['{ s += $5 } END { print s }'], () => [5], [], ''],
    [['NR > 1 {print $9}'], () => [], [9], 'NR > 1'],
    [['$3 > 1 {print $1}'], () => [3], [1], '$3 > 1'],
    [['-v', 'FS=:', '{print $1}'], () => [1], [], ''],
    [['BEGIN { FS = "." } {print $2}'], () => [2], [], ''],
  ];
  for (const [words, read, more, pattern] of cases) {
    it(`awk ${words.join(' ')}`, () => {
      for (const input of ALL) {
        const m = stageMarks(stage('awk', ...words), input);
        const fs = words[0].startsWith('-') ? words.slice(0, words.length - 1) : words[0].startsWith('BEGIN') ? ['-F.'] : [];
        // (`$3 > 1` reads $3 of every line, `$1` of those it selects.)
        const selected = pattern ? new Set(real('gawk', [...fs, `${pattern} { print NR - 1 }`], input).map(Number)) : undefined;
        const want = spans(fs, input).map((sp, k) => join([...read(sp.length), ...(selected?.has(k) ? more : [])].flatMap((f) => (sp[f - 1] && sp[f - 1][1] > sp[f - 1][0] ? [sp[f - 1]] : []))));
        assert.deepStrictEqual(m?.ranges ?? input.map(() => []), want, `${words.join(' ')} on ${input[0]}`);
        assert.deepStrictEqual(m?.dropped ?? [], selected ? input.flatMap((_, i) => (selected.has(i) ? [] : [i])) : []);
        if (m) assert.strictEqual(m.kind, 'field');
      }
    });
  }
  it('a regex alone: its first match, as gawk `match()` finds it; the lines no rule selects are left out', () => {
    for (const [prog, re] of [['/nginx/', 'nginx'], ['!/grep/ {print $11}', 'grep'], ['/a|ab/', 'a|ab'], ['/x*/', 'x*']]) {
      for (const input of ALL) {
        const m = stageMarks(stage('awk', prog), input);
        const found = real('gawk', [`{ if (match($0, /${re}/) && RLENGTH > 0) print RSTART - 1, RSTART - 1 + RLENGTH; else print "" }`], input)
          .map((l) => (l ? [l.split(' ').map(Number) as [number, number]] : []));
        const sel = new Set(real('gawk', [`${prog.split(' ')[0]} { print NR - 1 }`], input).map(Number));
        const fields = prog.includes('$11') ? spans([], input).map((sp, k) => (sel.has(k) && sp[10] ? [sp[10]] : [])) : input.map(() => []);
        const want = found.map((f, k) => join([...f, ...fields[k]]));
        assert.deepStrictEqual((m?.ranges ?? input.map(() => [])).map((r) => r), want, `${prog} on ${input[0]}`);
        assert.deepStrictEqual(m?.dropped ?? [], input.flatMap((_, i) => (sel.has(i) ? [] : [i])));
      }
    }
    assert.strictEqual(stageMarks(stage('awk', '/nginx/'), samples[0])?.kind, 'match');
  });
  it('marks no field of a record awk changed, of none (BEGIN), or past the end; and leaves out the lines after exit', () => {
    const input = ['a b c', 'd e f', 'g h i'];
    assert.deepStrictEqual(stageMarks(stage('awk', '{ $2 = "x"; print $2 }'), input), undefined);
    assert.deepStrictEqual(stageMarks(stage('awk', '{ $0 = "p q"; print $1 }'), input), undefined);
    assert.deepStrictEqual(stageMarks(stage('awk', 'BEGIN { x = $1 } { print $9 }'), input), undefined);
    assert.deepStrictEqual(stageMarks(stage('awk', '{ print $1 } NR == 2 { exit }'), input), { kind: 'field', ranges: [[[0, 1]], [[0, 1]], []], dropped: [2] });
    // (An FS with a group gives its text to split as a field: the fields are not those of the line.)
    assert.deepStrictEqual(stageMarks(stage('awk', '-F', '(b)', '{ print $2 }'), input), undefined);
    assert.deepStrictEqual(stageMarks(stage('awk', '{ $0 = "zz" } /z/'), input), undefined);
    // (A field and a match that start at the same place; an FS that also matches the empty string, which splits nothing.)
    assert.deepStrictEqual(stageMarks(stage('awk', '/a/ {print $1}'), ['ab c']), { kind: 'field', ranges: [[[0, 2]]], dropped: [] });
    assert.deepStrictEqual(stageMarks(stage('awk', '-F', ':*', '{print $2}'), ['a:b']), { kind: 'field', ranges: [[[2, 3]]], dropped: [] });
    assert.deepStrictEqual(real('gawk', ['-F', ':*', '{print $2}'], ['a:b']), ['b']);
    // END reads the last record.
    assert.deepStrictEqual(stageMarks(stage('awk', 'END { print $3 }'), input), { kind: 'field', ranges: [[], [], [[4, 5]]], dropped: [] });
  });
});

describe('pipeline marks: cut and sort, as GNU cut and sort --debug take them', () => {
  /** Where field i (from 1) of each line lies, as GNU cut takes it: its text, after the fields before it. */
  const cutField = (d: string, i: number, input: string[]): ([number, number] | undefined)[] => {
    const own = real('cut', [`-d${d}`, `-f${i}`, '-s'], input);
    const before = i > 1 ? real('cut', [`-d${d}`, `-f1-${i - 1}`], input) : [];
    let k = 0;
    return input.map((l, j) => {
      if (!l.includes(d)) return undefined;
      const text = own[k++];
      const at = i > 1 ? before[j].length + 1 : 0;
      return l.split(d).length >= i ? [at, at + text.length] : undefined;
    });
  };
  for (const [d, list, extra] of [[':', '1', []], [':', '1,3', []], ['=', '2-', []], [' ', '1', ['-s']], [':', '2', ['--complement']], [':', '-2', []]] as [string, string, string[]][]) {
    it(`cut -d${d} -f${list} ${extra.join(' ')}`, () => {
      for (const input of ALL) {
        const m = stageMarks(stage('cut', `-d${d}`, `-f${list}`, ...extra), input);
        const max = Math.max(...input.map((l) => l.split(d).length));
        const out = real('cut', [`-d${d}`, `-f${list}`, ...extra], input);
        const fields = Array.from({ length: max }, (_, i) => cutField(d, i + 1, input));
        const chosen = (i: number) => { const [a, b] = list.includes('-') ? list.split('-').map((x, j) => (x ? Number(x) : j ? Infinity : 1)) : [0, 0]; const yes = list.includes('-') ? i >= a && i <= b : list.split(',').map(Number).includes(i); return extra.includes('--complement') ? !yes : yes; };
        const want = input.map((l, k) => (!l.includes(d) ? (extra.includes('-s') || !l ? [] : [[0, l.length]]) : fields.flatMap((f, i) => (chosen(i + 1) && f[k] && f[k]![1] > f[k]![0] ? [f[k]!] : []))));
        assert.deepStrictEqual(m?.ranges ?? input.map(() => []), want, input[0]);
        // A line it prints whole or in part is kept; with -s, one without the delimiter is left out.
        assert.deepStrictEqual(m?.dropped ?? [], input.flatMap((l, k) => (!l.includes(d) && extra.includes('-s') ? [k] : [])));
        assert.strictEqual(out.length, input.length - (m?.dropped.length ?? 0));
      }
    });
  }
  it('cut -c and -b: the characters it prints', () => {
    for (const args of [['-c1-20'], ['-c', '2,4-6'], ['-b1-3'], ['-c3-', '--complement']]) {
      for (const input of ALL) {
        const m = stageMarks(stage('cut', ...args), input);
        assert.deepStrictEqual(texts(input, m?.ranges ?? input.map(() => [])).map((t) => t.join('')), real('cut', args, input), `${args.join(' ')} on ${input[0]}`);
      }
    }
  });

  /** The keys `sort --debug -s` underlines on each line (one underline a key; none for "no match"), by the line's text. */
  const debug = (args: string[], input: string[]) => {
    const out = real('sort', ['--debug', '-s', ...args], input);
    const keys = new Map<string, [number, number][]>();
    for (let i = 0; i < out.length;) {
      const line = out[i++];
      const ranges: [number, number][] = [];
      while (i < out.length && /^[ _^]*(\^ no match for key|_+)?$/.test(out[i]) && /[_^]/.test(out[i])) {
        const u = /_+/.exec(out[i++]);
        if (u) ranges.push([u.index, u.index + u[0].length]);
      }
      keys.set(line, ranges);
    }
    return keys;
  };
  const sortCases = [['-k5', '-h'], ['-k5,5n'], ['-k2'], ['-k2,2'], ['-k3', '-rn'], ['-t:', '-k3n'], ['-k2b'], ['-b', '-k2,2'], ['-k1.2,1.3'], ['-k2,2f'], ['-k2V'], ['-k1,1', '-k3,3n'], ['-k2,2d'], ['-t', ' ', '-k2']];
  for (const args of sortCases) {
    it(`sort ${args.join(' ')}`, () => {
      for (const input of ALL) {
        // (Lines the same as one before them are left aside: --debug shows each of them.)
        const unique = input.filter((l, i) => input.indexOf(l) === i && !l.includes('\t'));
        const m = stageMarks(stage('sort', ...args), unique);
        const want = debug(args, unique);
        const ranges = m?.ranges ?? unique.map(() => []);
        unique.forEach((l, i) => assert.deepStrictEqual(ranges[i], join(want.get(l) ?? []), `${args.join(' ')}: ${l}`));
        assert.deepStrictEqual(m?.dropped ?? [], []);
      }
    });
  }
  it('sort: no marks without -k, nor for -g or -n with -d', () => {
    for (const args of [['-n'], ['-k2g'], ['-k2,2nd']]) assert.strictEqual(stageMarks(stage('sort', ...args), samples[4]), undefined, args.join(' '));
  });
});

describe('pipeline marks in the examples', () => {
  it('names what is marked, in English and Japanese, and leaves the last section unmarked', () => {
    const ex = (lang: 'en' | 'ja') => explain("ps aux | grep nginx | cut -c1-10 | sort -k1,1 | awk '{print $1}'", 0, lang).examples.find((e) => e.kind === 'pipeline')!;
    assert.deepStrictEqual(ex('en').sections.map((s) => s.marks?.said), ['matched by `grep nginx`', 'taken by `cut -c1-10`', 'compared by `sort -k1,1`', "read by `awk '{print $1}'`", undefined]);
    assert.deepStrictEqual(ex('ja').sections.map((s) => s.marks?.said), ['`grep nginx` が一致する部分', '`cut -c1-10` が取り出す部分', '`sort -k1,1` が比べる部分', "`awk '{print $1}'` が読む部分", undefined]);
  });
  it('marks what the stage after cat reads, in the box of the input and the section before cat', () => {
    const cat = (...words: string[]): Stage => ({ ...stage('cat', ...words), copies: true });
    const ex = pipelineExample([cat('a.txt'), stage('grep', 'x'), cat(), stage('wc', '-l')], true, ['x1', 'y', 'x2'])!;
    assert.deepStrictEqual(ex.inputMarks?.ranges, [[[0, 1]], [], [[0, 1]]]);
    assert.deepStrictEqual(ex.steps.map((s) => !!s.marks), [true, false, false, false]);
    // (Several files read as one stream: each box marks its own lines.)
    const two = explain('cat a.txt b.txt | grep e | wc -l').examples.find((e) => e.kind === 'pipeline')!;
    assert.ok(two.interactive?.result.marks?.some((m) => m.length));
    const echo = explain("printf 'ab\\ncd\\n' | grep a | wc -l").examples.find((e) => e.kind === 'pipeline')!;
    assert.deepStrictEqual(echo.sections[0].marks, { said: 'matched by `grep a`', ranges: [[[0, 1]], []], dropped: [1] });
  });
  it('cuts the marks where a long section is cut', () => {
    const long = explain("seq 30 | grep 1 | awk '{print $1}'").examples.find((e) => e.kind === 'pipeline')!;
    const first = long.sections[0];
    assert.strictEqual(first.lines.length, 12);
    assert.strictEqual(first.marks!.ranges.length, 11);
    assert.ok(first.marks!.dropped!.every((i) => i < 11));
  });
  it('runs the marks again on the input typed in the box', () => {
    const r = rerun({ kind: 'pipeline', stages: [stage('grep', 'a'), stage('cut', '-c1')] }, [['ab', 'b', 'ca']], 'en');
    assert.deepStrictEqual(r.marks, [[{ start: 0, end: 1, group: 0 }], [], [{ start: 1, end: 2, group: 0 }]]);
    assert.deepStrictEqual(r.sections[0].marks, { said: 'taken by `cut -c1`', ranges: [[[0, 1]], [[0, 1]]] });
    assert.strictEqual(r.sections[1].marks, undefined);
    const cut = rerun({ kind: 'filter', cmd: 'cut', words: ['-d:', '-f1'] }, [['1:a', '2:b']], 'en');
    assert.deepStrictEqual(cut.marks, [[{ start: 0, end: 1, group: 0 }], [{ start: 0, end: 1, group: 0 }]]);
    assert.strictEqual(rerun({ kind: 'filter', cmd: 'uniq', words: [] }, [['a']], 'en').marks, undefined);
    // (`/etc/passwd` holds lines of its format: the first field of `root:x:0:0:…` is `root`.)
    assert.deepStrictEqual(explain('cut -d: -f1 /etc/passwd').examples[0].interactive?.result.marks?.[0], [{ start: 0, end: 4, group: 0 }]);
  });
  it('finds matches one after another as POSIX tools do: empty ones skipped after a match, and PCRE first', () => {
    assert.deepStrictEqual(posixMatches([{ source: 'x*', flags: '' }], 'axxb', true), [[0, 0], [1, 3], [4, 4]]);
    assert.deepStrictEqual(posixMatches([{ source: 'a|ab', flags: '' }], 'ab', false), [[0, 1]]);
    assert.deepStrictEqual(posixMatches([{ source: 'a|ab', flags: '' }, { source: 'b', flags: '' }], 'ab b', true), [[0, 2], [3, 4]]);
  });
});
