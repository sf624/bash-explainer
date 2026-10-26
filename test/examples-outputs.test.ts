// The outputs of the worked examples, compared with the real tools given the files and the standard input the
// examples show: jq's pretty printing and its options, mikefarah/yq's formats, awk's FILENAME, a file written, the
// dates and time zones of date.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { relativeItems } from '../src/examples/dates';
import { jqPrint } from '../src/examples/jq';
import { rerun } from '../src/examples/rerun';
import { exampleOf, has, realOutput } from './support/examples';
import { explain } from './support/explain';
import { run } from './support/run';

/**
 * mikefarah/yq (MIT; a Go program, used as a separate program): `$BASH_EXPLAINER_YQ4`, or a `yq` on PATH that says it
 * is mikefarah's, or the newest `yq-4.*` in `$BASH_EXPLAINER_YQ` (test/yq.test.ts). CI installs a pinned release
 * (.github/actions/install-tools). Undefined when there is none: the comparisons are skipped.
 */
export function mikefarahYq(): string | undefined {
  const says = (bin: string) => /mikefarah/.test(spawnSync(bin, ['--version']).stdout?.toString() ?? '');
  const env = process.env.BASH_EXPLAINER_YQ4;
  if (env) return env;
  const onPath = spawnSync('bash', ['-c', 'command -v yq']).stdout.toString().trim();
  if (onPath && says(onPath)) return onPath;
  const dir = process.env.BASH_EXPLAINER_YQ;
  const newest = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^yq-4\./.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop() : undefined;
  return newest && path.join(dir!, newest);
}

const compare = (tool: string | undefined, lines: string[], bin: Record<string, string> = {}, env: NodeJS.ProcessEnv = {}) => {
  for (const line of lines) {
    (tool ? it : it.skip)(line, () => {
      const ex = exampleOf(line);
      assert.ok(ex, 'has an example');
      const { got, want } = realOutput(line, ex!, bin, env);
      assert.strictEqual(got, want);
    });
  }
};

describe('jq examples print as jq does', () => {
  compare(has('jq') ? 'jq' : undefined, [
    // Two spaces a level by default; one line with -c; a tab, another indent, the keys in order.
    'jq . a.json', 'jq .users a.json', "jq '.items[] | select(.price > 10)' a.json", 'jq -c . a.json', 'jq --tab . a.json', 'jq --indent 3 . a.json',
    'jq --indent 0 . a.json', 'jq --indent 1 -c . a.json', 'jq -c --indent 1 . a.json', 'jq -S . a.json', 'jq . a.json b.json', 'jq . a.json < b.json',
    "jq '.users | map(.age)' u.json", "jq -r '.name' a.json", "jq -j '.[]' a.json", "jq -r '.' a.json", 'jq -s . a.json b.json',
    // -R reads lines as strings; -n with input and inputs reads the files through the filter.
    'jq -R . f.txt', 'jq -Rs . f.txt', "jq -R 'split(\",\")' f.csv", "jq -R 'length' a b", "jq -n '[inputs]' a.json b.json", "jq -n 'input' a.json b.json",
    "jq -n '[inputs | .name]' a.json b.json", "jq '[., input]' a.json", "jq -n '{a:1}'", "jq -nc '[1,2]'", "jq '.a' <<< '{\"a\":{\"b\":1}}'",
    "jq -S '.items' a.json", "jq -n '[inputs]' a.json a.json", 'jq -n input < b.json', "jq -n '[inputs]' - a.json < b.json",
    // `__proto__` is a key and a variable like any other.
    "jq -n --arg __proto__ v '$__proto__'", "jq -nc --argjson __proto__ 1 '{a: $__proto__}'", "jq -nc '{} | .__proto__ = 3'", "jq -nc '{} * {\"__proto__\": {\"a\": 1}}'",
    "jq -nc '[{key: \"__proto__\", value: 1}] | from_entries'", "jq -c '.__proto__ |= 1' <<< '{\"__proto__\": 0, \"b\": 2}'",
  ]);
  it('sorts the keys of objects inside arrays too (-S)', () => {
    assert.deepStrictEqual(jqPrint([{ b: 1, a: [{ d: 1, c: 2 }] }], { indent: 0, sortKeys: true }), ['[{"a":[{"c":2,"d":1}],"b":1}]']);
  });
  it('gives no example for an indent jq refuses or one not known, nor for a filter that cannot run here', () => {
    for (const line of ['jq --indent 9 . a.json', 'jq --indent "$n" . a.json', "jq -R 'select' f", "jq -s 'now' a.json b.json", "yq -y -n '[inputs]' a.yml", "jq -n '[input, input]' a.json"]) {
      assert.strictEqual(exampleOf(line), undefined, line);
    }
  });
});

describe('mikefarah/yq examples print as yq does', () => {
  const yq = mikefarahYq();
  compare(yq, [
    "yq -o json '.' f.yml", "yq '.' f.json", "yq '.users | map(.name)' f.json", "yq -o json -I 4 '.' f.yml", "yq -o json -I 0 '.' f.yml",
    "yq -o yaml '.' f.json", "yq -p json '.' < f.json", "yq '.a' a.yml b.yml", "yq -o json '.' a.yml b.yml", "yq '.' f.yml",
    "yq -o json '.a' <<< '{\"a\":[1]}'", "yq -n '.a = 1'", "yq -o json '.name' f.yml", "yq '.items[] | select(.price > 10) | .name' f.json",
    // -r prints a string bare, also in JSON; -r=false turns it off.
    "yq -r '.name' f.json", "yq -o json -r '.name' f.yml", "yq -r=false '.name' f.json", "yq -o json -r=false '.name' f.yml", "yq --unwrapScalar '.name' f.json",
    "yq -r '.name' f.yml", "yq '.' a.yaml b.yaml", "yq '.name' a.yaml b.yaml",
    // -i writes the result of every file into the first.
    "yq -i '.a' a.yaml b.yaml", "yq -i '.a' a.yaml", "yq -i -o json '.' a.yaml b.yaml", "yq -n '.__proto__ = 3'", "yq -n '.a.__proto__ = 3'",
  ], yq ? { yq } : {});
  it('says in Japanese which file -i rewrites', () => {
    assert.deepStrictEqual(exampleOf("yq -i '.a' a.yaml b.yaml", 'ja')?.sections.pop()?.label, '書き換え後の `a.yaml`');
  });
  it('gives no example for a format it does not follow', () => {
    for (const line of ["yq '.' f.xml", "yq -p csv '.' f", "yq -o xml '.' f.yml", "yq -I 4 '.' f.yml"]) assert.strictEqual(exampleOf(line), undefined, line);
  });
});

describe('awk examples name the file they read', () => {
  compare(has('gawk') ? 'gawk' : undefined, [
    "awk '{ print FILENAME, FNR, NR }' a b", "awk 'FNR == 1 { print FILENAME }' a b c", "awk '{ print FILENAME }'", "awk 'END { print FILENAME, NR }' a b",
    "awk '{ print FILENAME \": \" $0 }' - a < b", "awk '{ print FILENAME, FNR, NR }' a a", "awk '{ print FILENAME, NR }' a - - < b",
  ]);
  it('gives no example of FILENAME for the files of a glob', () => assert.strictEqual(exampleOf("awk '{ print FILENAME }' *.log"), undefined));
});

describe('a command that writes its output to a file shows what the file gets', () => {
  compare(has('uniq') ? 'uniq' : undefined, ['uniq a out.txt', 'uniq -c a out.txt', 'sort -o out.txt a b', 'sort -r -o out.txt a', 'uniq - out.txt < c', 'sort -o out.txt a a']);
  it('gives a pipeline that writes to a file no example of the whole', () => assert.deepStrictEqual(exampleOf('cat a | sort -o out.txt')?.sections.map((s) => s.label), ['Input: stdin (`a` through `cat`, sample contents)', 'Written to `out.txt`']));
});

describe('date examples print what GNU date prints', () => {
  const gnuDate = /GNU/.test(spawnSync('date', ['--version']).stdout?.toString() ?? '');
  // Where the line names no zone, date prints in the local zone: the examples take it to be UTC, and say so.
  const env = { TZ: 'UTC0', LC_ALL: 'C' };
  // A date given with -d that does not depend on when date runs (ISO 8601, `@SECONDS`), in the zone TZ names (also
  // through env); the lines -f reads, from a file or the standard input.
  compare(gnuDate ? 'date' : undefined, [
    "date -d '2024-01-02' +%A", "date --date=@0 '+%F %T'", "date -d @0 '+%F %T %Z %z'", "TZ=Asia/Tokyo date -d @0 '+%F %T'", "TZ=Asia/Tokyo date -d '2024-01-02' +%s",
    "date -u -d '2024-01-02 03:04:05+09:00' '+%F %T %z'", "TZ=:Europe/Paris date -d '2024-07-01T12:00' '+%T %z %s'", "TZ=JST-9 date -d @1700000000 '+%c %Z'",
    "date --date '2024-01-02T03:04:05Z' +%s", "TZ=Asia/Tokyo date -u -d 2024-01-02 '+%s %Z'", 'date -d @-1 +%F_%T', 'date -f a +%A', "TZ=Asia/Tokyo date --file=a '+%s %:z'",
    'echo 2024-01-02 | date -f - +%A', "date -f - '+%F' <<< '@86400'", 'date -d tomorrow -d @0 +%F', "TZ=America/St_Johns date -d '2024-01-02 12:00' '+%T %:::z %::z'",
    "TZ=Europe/Paris date -d '2024-10-27 02:30' '+%s %z'", "date -d '2024-01-02 03:04:05 -0130' +%s", "date -d '2024-01-02 03:04:05 GMT' +%s",
    // (GNU takes an offset of up to 24 hours, and minutes over 59.)
    "date -d '2024-01-02 03:04:05 +24:00' +%s", "date -d '2024-01-02 03:04:05 -2400' +%s", "date -d '2024-01-02 03:04:05 +09:99' +%s",
    // Zones of one word, and of three parts.
    "TZ=EST5EDT date -d '2024-07-01 12:00' '+%T %z'", "TZ=EST date -d @1700000000 '+%T %z'", "TZ=WET date -d @1720000000 '+%T %z'", "TZ=Etc/GMT+5 date -d @0 '+%T %z'", "TZ=Etc/GMT-14 date -d @0 '+%T %z'",
    "TZ=America/Argentina/Buenos_Aires date -d @1700000000 '+%T %z'",
    // A wrapper sets TZ, removes it, or starts with an empty environment.
    "env TZ=Asia/Tokyo date -d @0 '+%F %T'", "env -i TZ=Asia/Tokyo date -d @0 '+%T'", "env TZ=UTC env TZ=Asia/Tokyo date -d @0 '+%T'",
    "env -u TZ TZ=Asia/Tokyo date -d @0 '+%T'", "env 'TZ=Asia/Tokyo' nice date -d @0 '+%T'", "( env TZ=Asia/Tokyo date -d @0 '+%T' )",
    "bash -c 'env TZ=Asia/Tokyo date -d @0 +%T'",
  ], {}, env);

  // The moments date runs at, the modification time -r reads: each sample moment, put in the line for real.
  const momentsAgree = (line: string, put: (line: string, epoch: number) => string, file?: string) => {
    (gnuDate ? it : it.skip)(line, () => {
      const ex = exampleOf(line);
      assert.ok(ex?.interactive, 'has an example');
      const [moments, out] = ex!.sections;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-date-'));
      try {
        const got = moments.lines.map((m) => {
          const epoch = Date.parse(m.replace(' ', 'T') + 'Z') / 1000;
          if (file) {
            fs.writeFileSync(path.join(dir, file), '');
            fs.utimesSync(path.join(dir, file), epoch, epoch);
          }
          return run('bash', ['-c', put(line, epoch)], { cwd: dir, env: { ...process.env, ...env }, check: true }).stdout.toString().replace(/\n$/, '');
        });
        assert.deepStrictEqual(got, out.lines);
        // The panel runs it again on the same moments.
        const again = rerun(ex!.interactive!.spec, ex!.interactive!.inputs.map((b) => b.lines), 'en').sections[0];
        assert.deepStrictEqual([again.label, again.lines], [out.label, out.lines]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  };
  const at = (line: string, epoch: number) => line.replace(/\bdate\b/, `date -d @${epoch}`);
  for (const line of ["TZ=Asia/Tokyo date '+%T'", "TZ=:Europe/Paris date '+%F %T %z'", "TZ=UTC date '+%T %Z'", "date -u '+%T %Z'", 'TZ=Asia/Tokyo date -u +%T',
    'export TZ=Asia/Kolkata; date +%T%:z', "TZ='<+0530>-5:30' date '+%T %Z'", 'TZ=GMT date +%Z', 'TZ=Etc/GMT date +%T', 'date +%F']) momentsAgree(line, at);
  momentsAgree('date -d "$d" +%F', (line, epoch) => line.replace('"$d"', `@${epoch}`));
  momentsAgree('TZ=Asia/Tokyo date -r f +%T', (line) => line, 'f');
  // A date relative to the moment date runs, at each sample moment: GNU reads the items from a date and time given
  // with them as from the moment it runs (`yesterday 2024-03-05 07:08:09`; with a time of day, the date alone). (Not a
  // day of the week: GNU ignores it next to a date. Those are compared with GNU in test/format.test.ts.)
  for (const [line, item] of [["date -d 'yesterday' '+%F %T'", 'yesterday'], ["TZ=Asia/Tokyo date -d '+3 days' '+%F %T'", '+3 days'],
    ["TZ=Europe/Paris date -d '2 hours ago' '+%F %T %z'", '2 hours ago'], ["date -d '10:00' '+%F %T'", '10:00'], ["TZ=America/New_York date -d 'tomorrow 10:30 pm' '+%F %T %z'", 'tomorrow 10:30 pm'],
    ["date -d '-14 months' '+%F %T'", '-14 months'], ["TZ=Asia/Kolkata date -d '10pm 3 days' +%c", '10pm 3 days'], ["date -u -d 'next week' '+%F %T %Z'", 'next week']]) {
    momentsAgree(line, (l, epoch) => {
      const tz = /^TZ=(\S+) /.exec(l)?.[1] ?? 'UTC0';
      const wall = run('date', ['-d', `@${epoch}`, relativeItems(item)!.time ? '+%F' : '+%F %T'], { env: { ...process.env, ...env, TZ: tz }, check: true }).stdout.toString().trim();
      return l.replace(`'${item}'`, `'${item} ${wall}'`);
    });
  }

  it('labels the zone and what the moments stand for', () => {
    const labels = (line: string, lang: 'en' | 'ja' = 'en') => [exampleOf(line, lang)?.title, ...exampleOf(line, lang)?.sections.map((s) => s.label) ?? []];
    assert.deepStrictEqual(labels("TZ=Asia/Tokyo date '+%T'"), ['Example', 'When it runs (made up, UTC)', 'Output (the time in the zone `Asia/Tokyo`)']);
    assert.deepStrictEqual(labels("TZ=Asia/Tokyo date '+%T'", 'ja'), ['例', '実行した時刻（例、UTC）', '出力（タイムゾーン `Asia/Tokyo` の時刻）']);
    assert.deepStrictEqual(labels("date -d '2024-01-02' +%A"), ['Example (the date given with `-d`)', 'Output (if the local zone is UTC)']);
    assert.deepStrictEqual(labels("date -d '2024-01-02' +%A", 'ja'), ['例（`-d` で指定した日時）', '出力（タイムゾーンが UTC のとき）']);
    assert.deepStrictEqual(labels("date -u -d '2024-01-02' +%A"), ['Example (the date given with `-d`)', 'Output (the time in UTC)']);
    assert.deepStrictEqual(labels("date -u -d '2024-01-02' +%A", 'ja'), ['例（`-d` で指定した日時）', '出力（UTC の時刻）']);
    assert.deepStrictEqual(labels("date -d 'next friday' +%F"), ['Example (`next friday` depends on when it runs)', 'When it runs (made up, UTC)', 'Output (if the local zone is UTC)']);
    assert.deepStrictEqual(labels("date -d 'next friday' +%F", 'ja'), ['例（`next friday` は実行した時刻から決まる）', '実行した時刻（例、UTC）', '出力（タイムゾーンが UTC のとき）']);
    assert.deepStrictEqual(labels('date -d "$d" +%F'), ['Example', 'The date `-d "$d"` stands for (made up, UTC)', 'Output (if the local zone is UTC)']);
    assert.deepStrictEqual(labels('date -r f +%T'), ['Example', 'Modification time of `f` (made up, UTC)', 'Output (if the local zone is UTC)']);
    assert.deepStrictEqual(labels('date -r f +%T', 'ja'), ['例', '`f` の更新日時（例、UTC）', '出力（タイムゾーンが UTC のとき）']);
    assert.deepStrictEqual(labels('date -r "$f" +%T')[1], 'Modification time of `"$f"` (made up, UTC)');
    assert.deepStrictEqual(labels('date --reference=f +%T')[1], 'Modification time of `f` (made up, UTC)');
    assert.deepStrictEqual(labels('date -f a +%F'), ['Example', 'Input: `a` (sample contents)', 'Output (if the local zone is UTC)']);
    // A TZ unset, or one the script does not export, or one a wrapper removes: the local zone.
    for (const line of ['unset TZ; date +%T', 'TZ=Asia/Tokyo; date +%T', 'TZ=Asia/Tokyo env -u TZ date +%T', 'env -i date +%T', 'xargs date +%T', 'ssh h date +%T']) {
      assert.deepStrictEqual(explain(line).examples.find((e) => e.kind === 'date')?.sections.map((s) => s.label), ['When it runs (made up, UTC)', 'Output (if the local zone is UTC)'], line);
    }
    assert.deepStrictEqual(labels('sudo TZ=Asia/Tokyo date +%T')[2], 'Output (the time in the zone `Asia/Tokyo`)');
    assert.deepStrictEqual(labels('export TZ=Asia/Tokyo; sudo -E date -d @0 +%T')[1], 'Output (the time in the zone `Asia/Tokyo`)');
    // A day of the week is at midnight, a time of day is that time; both from the day date runs.
    const lines = (line: string) => exampleOf(line)?.sections.at(-1)!.lines;
    assert.deepStrictEqual(lines("date -d 'next friday' '+%A %F %T'"), ['Friday 2024-03-08 00:00:00', 'Friday 2026-01-02 00:00:00']);
    assert.deepStrictEqual(lines("date -d 'tue' '+%A %F %T'"), ['Tuesday 2024-03-05 00:00:00', 'Tuesday 2026-01-06 00:00:00']);
    assert.deepStrictEqual(lines("date -d 'next tue' '+%F'"), ['2024-03-12', '2026-01-06']);
    assert.deepStrictEqual(lines("date -d 'last wednesday' '+%F'"), ['2024-02-28', '2025-12-24']);
    assert.deepStrictEqual(lines("date -d 'monday next week' '+%F %T'"), ['2024-03-18 00:00:00', '2026-01-12 00:00:00']);
    assert.deepStrictEqual(lines('date -d 10:00 +%T'), ['10:00:00', '10:00:00']);
    assert.deepStrictEqual(lines("TZ=Asia/Tokyo date -d 'this sat' '+%F %T %z'"), ['2024-03-09 00:00:00 +0900', '2026-01-03 00:00:00 +0900']);
    // (Lines typed in the panel that date cannot read, and a moment whose date summer time skips.)
    const f = exampleOf('date -f a +%F')!.interactive!;
    assert.deepStrictEqual(rerun(f.spec, [['@0', 'soon']], 'en').sections[0].lines, ['1970-01-01', '(not a date; write it like `2024-03-05 07:08:09`)']);
    const santiago = exampleOf("TZ=America/Santiago date -d 'sunday' +%F")!.interactive!;
    assert.deepStrictEqual(rerun(santiago.spec, [['2024-09-07 12:00', '2024-09-01 12:00']], 'en').sections[0].lines, ['', '2024-09-01']);
  });

  it('gives no example where date prints no format, refuses the line, or reads what the example cannot follow', () => {
    for (const line of [
      'date -I +%F', 'date -R +%F', 'date --rfc-3339=date +%F', 'date -s 2024-01-01 +%F', 'date -d @0 -r f +%F', 'date -d @0 -f a +%F', 'date +%F +%T', 'date -d 2024-01-02 +%F +%T',
      // A zone not known here (glibc reads `asia/tokyo` as UTC, abbreviated `asia`), one of summer-time rules, or an
      // abbreviation not known (`JST` is the tz database's).
      'TZ=$z date +%T', 'TZ=asia/tokyo date +%T', 'TZ=Foo/Bar date +%T', 'TZ=CET-1CEST,M3.5.0,M10.5.0/3 date +%T', 'TZ= date +%T', 'TZ=XYZ-25 date +%T', 'TZ=XYZ-1:61 date +%T',
      "TZ=Asia/Tokyo date '+%Z'", 'TZ=Asia/Tokyo date -d @0 +%Z', 'export TZ=$z; date +%T', 'TZ=Factory date +%T',
      // Names glibc has no file for, and reads as UTC with that abbreviation; backward links, which some systems lack.
      'TZ=JST date +%T', 'TZ=PST date +%T', 'TZ=BST date +%T', 'TZ=CST date +%T', 'TZ=IST date +%T',
      'TZ=Japan date +%T', 'TZ=US/Pacific date +%T', 'TZ=NZ date +%T', 'TZ=ROK date +%T', 'TZ=Cuba date +%T', 'TZ=Asia/Calcutta date +%T', 'TZ=America/Godthab date +%T',
      // Before 1970 in a named zone (the tz data of systems differ), an offset with seconds, a year of five digits.
      'TZ=Asia/Tokyo date -d @-1 +%F', 'TZ=WET date -d @0 +%T', 'TZ=Africa/Monrovia date -d @0 +%T', 'date -d @253402300800 +%F', 'date -d @-62135596800 +%F',
      // A wrapper that sets TZ to a value not known here, may keep it (sudo), or runs date elsewhere.
      'env TZ=$z date +%T', 'env "TZ=$z" date +%T', 'TZ=Asia/Tokyo env -i date +%T', 'export TZ=Asia/Tokyo; sudo date +%T', 'docker run -e TZ=Asia/Tokyo i date +%T', 'TZ=Asia/Tokyo docker run i date +%T',
      'docker run --env-file f i date +%T',
      // A date of another form, one that does not exist, a time summer time skips, lines that are not dates, two files.
      "date -d 'Jan 2 2024' +%F", 'date -d 2024-02-30 +%F', "TZ=Europe/Paris date -d '2024-03-31 02:30' +%T", "date -d '2024-01-02 +3 days' +%F",
      "date -f - +%F <<< 'next week'", 'date -f a -f b +%F', "date -d '2024-01-02 25:00' +%F", "date -d '2024-01-02 10:60' +%F",
      "date -d '2024-01-02 03:04 +24:01' +%F", "date -d '2024-01-02 03:04 +25' +%F", "date -d '2024-01-02 03:04 +99' +%F",
      // Relative dates GNU refuses, or reads otherwise (`-3` after a time is its zone), or that cross a change of summer time.
      "date -d 'satday' +%F", "date -d 'wedday' +%F", "date -d 'thurday' +%F", "date -d 'tueday' +%F", "date -d '25:00' +%F", "date -d '10:99' +%F",
      "date -d 'friday monday' +%F", "date -d '10:00 -3 days' +%F", "TZ=Europe/Paris date -d '+6 months' +%F",
    ]) {
      assert.strictEqual(explain(line, 0).examples.find((e) => e.kind === 'date'), undefined, line);
    }
  });

  (gnuDate ? it : it.skip)('agrees with GNU date on what it refuses and on the relative dates', () => {
    const refused = (line: string) => run('bash', ['-c', line], { env: { ...process.env, ...env } }).status !== 0;
    for (const line of ['date -I +%F', 'date -R +%F', 'date -d @0 -r /dev/null +%F', 'date -d @0 -f /dev/null +%F', 'date -d 2024-02-30 +%F', "TZ=Europe/Paris date -d '2024-03-31 02:30' +%T",
      "date -d '2024-01-02 25:00' +%F", "date -d '2024-01-02 10:60' +%F", 'date +%F +%T', 'date -d 2024-01-02 +%F +%T', "date -d '2024-01-02 03:04 +24:01' +%F", "date -d '2024-01-02 03:04 +25' +%F",
      "date -d '2024-01-02 03:04 +99' +%F", "date -d 'satday' +%F", "date -d 'wedday' +%F", "date -d 'thurday' +%F", "date -d 'tueday' +%F", "date -d '25:00' +%F", "date -d '10:99' +%F",
      "date -d 'friday monday' +%F"]) {
      assert.ok(refused(line), line);
    }
    // A name glibc has no file for is UTC, with that name as its abbreviation.
    for (const tz of ['JST', 'PST', 'BST', 'CST', 'IST']) assert.strictEqual(run('date', ['-d', '@0', '+%T %Z %z'], { env: { ...process.env, ...env, TZ: tz } }).stdout.toString(), `00:00:00 ${tz} +0000\n`, tz);
    // `10:00 -3 days`: `-3` is the zone of the time, and `days` one day.
    assert.strictEqual(run('date', ['-d', '2024-01-02 10:00 -3 days', '+%F %T'], { env: { ...process.env, ...env } }).stdout.toString(), '2024-01-03 13:00:00\n');
    // Read from the moment date runs (accepted, and labelled so), unlike one with a date in it.
    for (const d of ['next friday', 'yesterday', '+3 days', '1 day ago', '10:00', 'last month', 'tomorrow 10:00 pm', 'thursday', 'next week', 'now', 'this sat', 'Wednesday', '10pm', 'monday next week']) {
      assert.ok(!refused(`date -d '${d}' +%F`), d);
      assert.ok(exampleOf(`date -d '${d}' +%F`)?.title.includes('depends on when it runs'), d);
    }
    assert.ok(!refused("date -d '2024-01-02 +3 days' +%F"));
  });
});
