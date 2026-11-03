// What test/examples-regexguard.test.ts runs in a process of its own, so that an engine that does not stop fails by the
// parent's timeout instead of holding the test run: `run` prints, as JSON, what each row gives.
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../../src/analyzer';
import type { LineExplanation } from '../../src/analyzer-types';
import { runAwk } from '../../src/examples/awk';
import { pipedOutput, pipelineExample, runGrep } from '../../src/examples/pipeline';
import { toJsRegex } from '../../src/examples/regex';
import { guarded, RegexRefused, scriptRegex } from '../../src/examples/regexguard';
import { rerun, type RerunSpec } from '../../src/examples/rerun';
import { runSed } from '../../src/examples/sed';
import { patternMatches } from '../../src/semantics/conditions';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';

export const P = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/regexguard-patterns.json'), 'utf8')) as {
  mustRefuse: [string, [string, number, string], string?][]; unread: string[]; twice: string; polynomial: string; openBraces: string[]; words: string; doubling: string[];
};

/** Patterns that take 2^n steps, or n to a high power, on a text of n characters, as a POSIX tool and perl read them. */
export const ADVERSARIAL = ['(a+)+$', '(a|a)*$', '(a|aa)+$', '(a*)*b', '(.*)*x', '([a-z]+)*[0-9]', '(a?){30}a{30}', '(a{1,30}){1,30}$', 'a*a*a*a*a*a*a*a*a*a*b', '^(a*){30}b', '(a{0,30}){30}b', '((a?){30}){30}b', '^((|)(|)(|)a)*$'];

/** How each tool is given a pattern and a text on one line. */
export const TOOLS: Record<string, (re: string, text: string) => string> = {
  'grep -E': (re, text) => `echo "${text}" | grep -E '${re}'`,
  'grep -Ev': (re, text) => `echo "${text}" | grep -Ev '${re}' | wc -l`,
  'grep alone': (re) => `grep -E '${re}' file`,
  'grep -P': (re, text) => `echo "${text}" | grep -P '${re}'`,
  'sed -E': (re, text) => `echo "${text}" | sed -E 's/${re}/x/'`,
  'sed alone': (re) => `sed -E 's/${re}/x/' file`,
  'sed address': (re, text) => `echo "${text}" | sed -En '/${re}/p'`,
  awk: (re, text) => `echo "${text}" | awk '/${re}/'`,
  'awk alone': (re) => `awk '/${re}/ { print $1 }' file`,
  'awk match': (re, text) => `echo "${text}" | awk '{ print match($0, "${re}") }'`,
  'awk gsub': (re, text) => `echo "${text}" | awk '{ gsub(/${re}/, "x"); print }'`,
  'awk -F': (re, text) => `echo "${text}" | awk -F '${re}' '{ print $1 }'`,
  perl: (re, text) => `echo "${text}" | perl -ne 'print if /${re}/'`,
  'perl s': (re, text) => `echo "${text}" | perl -pe 's/${re}/x/'`,
  'perl alone': (re) => `perl -ne 'print if /${re}/' file`,
  '=~': (re, text) => `x="${text}"; [[ $x =~ ${re} ]] && echo y`,
  'jq test': (re, text) => `echo '{"a":"${text}"}' | jq '.a | test("${re}")'`,
  'jq alone': (re) => `jq '.a | test("${re}")' file.json`,
  'yq test': (re, text) => `echo '{"a":"${text}"}' | yq '.a | test("${re}")'`,
  'find -regex': (re) => `find . -regextype egrep -regex '${re}'`,
};

/** Globs that bash reads as patterns, with the value known, and what they are given in. */
export const GLOBS: Record<string, (text: string) => string> = {
  '[[ == +(a|a) ]]': (text) => `shopt -s extglob; x="${text}"; [[ $x == +(a|a) ]] && echo y`,
  'case +(a|aa)': (text) => `shopt -s extglob; x="${text}"; case $x in +(a|aa)) echo y;; esac`,
  '[[ == *a*a… ]]': (text) => `x="${text}"; [[ $x == *a*a*a*a*a*a*a*a*a*a*a*c ]] && echo y`,
  '${x%%*a*a…}': (text) => `x="${text}"; echo "\${x%%*a*a*a*a*a*a*a*a*a*a*a*c}"`,
  '${x//*a*a…/y}': (text) => `x="${text}"; echo "\${x//a*a*a*a*a*a*a*a*a*a*a*c/y}"`,
  '${x^^*a*a…}': (text) => `x="${text}"; echo "\${x^^*a*a*a*a*a*a*a*a*a*a*a*c}"`,
  'ls +(a|a)': () => 'shopt -s extglob; ls +(a|a)',
  'find -name': () => "find . -name '*a*a*a*a*a*a*a*a*a*a*a*c'",
};

const SSHD = 'Nov  3 12:00:01 host sshd[1234]: Failed password for root from 192.168.1.100 port 22 ssh2';
export const IPV4 = '^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$';

/** Lines people give patterns: one of a log, others short. */
export const LINES = ['192.168.1.1', '10.0.0.256', 'alice@example.com', 'ERROR: disk full', 'error: disk', '  # a comment', 'key = value', 'aaa', 'aaa!', 'b', '', '2026-11-03 12:00', 'foo bar foo', '/var/log/syslog', 'a,b,,c', '"a \\" b"', 'abcabc', 'x=1;y=22', 'aa:bb:cc:dd:ee:ff', 'aabbccddeeff', 'hello world and more', SSHD];
export const FEW_CHARS = 90;
/** Fifty lines of 90 characters, in which most of the patterns below find nothing. */
export const MANY = Array.from({ length: 50 }, (_, i) => `Nov  3 12:00:${String(i).padStart(2, '0')} host kernel[${1000 + i}]: usb 1-1.${String(i).padStart(2, '0')}: new device number ${String(i).padStart(2, '0')} using xhci-hcd xx`);
/** Fifty lines of a log, of 90 characters, in which they find something. */
export const LOG = Array.from({ length: 50 }, (_, i) => `Nov  3 12:00:${String(i).padStart(2, '0')} host sshd[1234]: Failed password for root from 192.168.1.${String(i).padStart(3, '0')} port 2222 x`);
/** A line of 1500 characters. */
export const CSV = ['a,b,,c,'.repeat(214) + 'a,'];
/** As a script gives them: what it runs, on a here-document. */
export const ORDINARY: [string, string[]][] = [['s/.*from ([0-9.]+).*/\\1/', LOG], ['s/,+/;/g', CSV], ['s/,+/;/g', MANY], ['s/[0-9]+/N/g', LOG], ['s/ +/ /g', LOG], ['s/^[^ ]+ +//', LOG], ['s/(.*):.*/\\1/', LOG]];

/** Patterns of everyday use: each runs on these lines, and agrees with the real tools. */
export const MUST_RUN = [
  IPV4, '.*Failed.*from', '.*Failed.*from ([0-9.]+).*', '.*from ([0-9.]+).*', ',+', '.*foo.*bar', '^.*foo.*bar.*baz$', '.*a.*b.*c.*', P.words, '^([0-9a-f]{2}){6}$',
  '^([0-9]{1,3}\\.){3}[0-9]{1,3}$', '[a-z]+@[a-z]+\\.[a-z]+', '^(ERROR|WARN):', '^\\s*#', '^[[:space:]]*$', '^[^=]+=[[:space:]]*.*$', '[0-9]{4}-[0-9]{2}-[0-9]{2}',
  '(foo|bar)+', 'foo.*bar', '.*foo.*', '^.*[.]([^.]+)$', '(abc)\\1', '(.)\\1', '"([^"\\\\]|\\\\.)*"', '[a-z]+=[0-9]+(;[a-z]+=[0-9]+)*', '\\<foo\\>', 'a,*b', '^(a|b|c)*$', '[a-z]*[0-9]*', 'o+ ',
  '([0-9a-f]{2}:){5}[0-9a-f]{2}', '^[A-Z][a-z]+ +[0-9]+', 'sshd\\[[0-9]+\\]', '(error|warn|fail)', '^.*:.*:.*$', '[^ ]+ [^ ]+ [^ ]+', 'port [0-9]+', '\\bhost\\b', '^$', '(^| )root( |$)', 'x*',
];
/** Lines on which a pattern whose paths double runs. */
export const SHORT = ['aaa', 'aaa!', 'b', 'ab', '', 'abc1', 'xyz', 'a!a'];

/** A row's text. */
export const textOf = ([unit, count, tail]: [string, number, string]) => unit.repeat(count) + tail;

const said = (t: string | undefined) => !!t && /結果は計算しない|Not computed/.test(t);
const parser = createUnbashParser();
const analyzers = { en: new Analyzer('en'), ja: new Analyzer('ja') };
const explain = (line: string, lang: 'en' | 'ja' = 'en', at = 0): LineExplanation => analyzers[lang].explainLine(parser.parse(line), at, 'bash')!;

/** A run of a regex on a text: refused, or what it gives. */
function verdict(source: string, text: string, flags = ''): string {
  try {
    return String(scriptRegex(source, flags).test(text));
  } catch (e) {
    if (e instanceof RegexRefused) return 'refused';
    throw e;
  }
}

/** `said`: an example says the result is not computed; `claims`: labels of the sections that show a result; `tokens`: what the line's explanation has. */
export interface Row { line: string; tool: string; pattern: string; length: number; ms: number; said: boolean; claims: string[]; tokens: number; lang: string }

function row(line: string, tool: string, pattern: string, length: number, lang: 'en' | 'ja'): Row {
  const start = process.hrtime.bigint();
  const e = explain(line, lang);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const refused = e.examples.filter((x) => said(x.note) || x.sections.some((sec) => sec.lines.some(said)));
  // (What it read is no result: a section of the input stays.)
  const claims = refused.flatMap((x) => x.sections.filter((sec) => !sec.lines.some(said) && !/^(Input|入力)/.test(sec.label)).map((sec) => sec.label));
  return { line, tool, pattern, length, ms, said: refused.length > 0, claims, tokens: e.items.length, lang };
}

const A30 = 'a'.repeat(30);
const G = '()'.repeat(990);
const STARS = '*a*a*a*a*a*a*a*a*a*a*a*c';
const regex = toJsRegex(P.doubling[0], 'ere')!;
export const SPECS: Record<string, RerunSpec> = {
  regex: { kind: 'regex', regex, mode: 'lines' },
  sed: { kind: 'sed', script: `s/${P.doubling[0]}/x/`, quiet: false, extended: true, highlight: regex },
  awk: { kind: 'awk', program: `/${P.doubling[0]}/`, vars: {} },
  perl: { kind: 'perl', code: `print if /${P.doubling[0]}/`, opts: { loop: 'n' } },
  jq: { kind: 'jq', filter: `test("${P.doubling[0]}")`, raw: false, vars: {} },
  pipeline: { kind: 'pipeline', stages: [{ cmd: 'grep', words: ['-E', P.doubling[0]], text: 'grep' }] },
  glob: { kind: 'glob', pattern: '+(a|a)', mode: 'value' },
};

/** What each line shows of what is not run: the parent says what each must be. */
const shown = (e: LineExplanation) => e.examples.map((x) => ({ kind: x.kind, note: x.note, sections: x.sections.length }));
const CHECKS: Record<string, () => unknown> = {
  // (The review's: what took a process down or seconds, by a match's size or a cost the walk did not count.)
  ...Object.fromEntries(Object.entries({
    'awk -F, by the size of what it gives': `echo "${'a'.repeat(100000)}" | awk -F 'a|${G}' '{ print $1 }'`,
    'perl split, by the size of what it gives': `echo "${'a'.repeat(100000)}" | perl -ne 'print split /a|${G}/'`,
    's///g, by the size of what it gives': `echo "${'a'.repeat(50000)}" | sed -E 's/a|${G}/x/g'`,
    'many registers on a long text': `echo "${'a'.repeat(1000000)}" | grep -E 'z${G}'`,
    'split by many registers': `echo "${'a'.repeat(400000)}" | awk -F 'b${G}' '{ print $1 }'`,
    'what takes JavaScript long to compile': `printf 'a\\nb\\nc\\n' | grep -E '^z(${'(a?)'.repeat(490)}a)*b'`,
    'sed, & many times': `echo "${'a'.repeat(1000000)}" | sed -E 's/.*/${'&'.repeat(1000)}/'`,
    'sed, \\1 many times': `echo "${'a'.repeat(1000000)}" | sed -E 's/(.*)/${'\\1'.repeat(1000)}/'`,
    'sed, many matches and & many times': `echo "${'a'.repeat(100000)}" | sed -E 's/a/${'&'.repeat(100)}/g'`,
    'perl, $& many times': `echo "${'a'.repeat(1000000)}" | perl -pe 's/.*/${'$&'.repeat(1000)}/'`,
    'awk, & many times': `echo "${'a'.repeat(1000000)}" | awk '{ gsub(/.*/, "${'&'.repeat(1000)}"); print }'`,
    'sed, four times again and again': `echo a | sed -E '${'s/.*/&&&&/;'.repeat(20)}'`,
    'awk, twice again and again': `echo a | awk '{ x = $0; for (i = 0; i < 40; i++) x = x x; print length(x) }'`,
    'bash, a long text many times': `x="${'a'.repeat(100000)}"; echo "\${x//a/${'a'.repeat(1000)}}"`,
    'the end of a name, perl': `echo abc | perl -ne 'print if /\\k<n/'`,
    'the end of a name, grep -P': `grep -P '\\k<n' file`,
    'the end of a name, jq': `jq '.a | test("\\\\k<n")' file.json`,
  }).map(([name, line]) => [name, () => { const e = explain(line); return { tokens: e.items.length > 0, said: e.examples.some((x) => said(x.note) || x.sections.some((sec) => sec.lines.some(said))) }; }])),
  'pipeline en': () => shown(explain(`echo "${A30}!" | grep -E "${P.doubling[0]}" | wc -l`, 'en')),
  'pipeline ja': () => shown(explain(`echo "${A30}!" | grep -E "${P.doubling[0]}" | wc -l`, 'ja')),
  'the tokens stay': () => { const e = explain(`echo "${A30}!" | sed -E "s/${P.doubling[0]}/x/"`); return [e.items.length > 0, /sed/.test(e.summary)]; },
  'here-string': () => { const e = explain(`sed -E 's/${P.doubling[0]}/x/' <<< "${A30}!"`); return e.examples.some((x) => said(x.note) || x.sections.some((sec) => sec.lines.some(said))); },
  // (Its value is not known, so the example shows only samples.)
  expansion: () => explain(`x=${A30}b; echo "\${x%%${STARS}}"`).examples.filter((x) => x.kind === 'expansion').some((x) => JSON.stringify(x.sections).includes(A30)),
  '=~': () => shown(explain(`x=${A30}!; [[ $x =~ ${P.doubling[0]} ]] && echo y`)).filter((x) => x.kind === 'regex'),
  '[[ == ]]': () => shown(explain(`shopt -s extglob; x=${A30}!; [[ $x == +(a|a) ]] && echo y`)).filter((x) => x.kind === 'glob'),
  'no next stage': () => pipedOutput([{ cmd: 'grep', words: ['-E', P.doubling[0]], text: 'grep' }], [`${A30}!`]) ?? 'none',
  'matches of a glob': () => patternMatches(`${A30}b`, STARS) ?? 'none',
  'two lines with the same pattern, the first run': () => guarded(() => runGrep(['-E', P.doubling[0]], ['aaa', 'aaa!']), () => [] as string[]),
  'too many rounds alone': () => shown(explain("grep -E '(){2000000000}' file")),
  'generator over its steps': () => shown(explain("grep -E '(ab{1000}){1000}' file")),
};

if (process.argv[2] === 'run') {
  const texts = [`${A30}!`, 'a'.repeat(3000) + '!'];
  const rows: Row[] = [];
  for (const text of texts) {
    for (const re of ADVERSARIAL) for (const [tool, make] of Object.entries(TOOLS)) rows.push(row(make(re, text), tool, re, text.length, 'en'));
    for (const [tool, make] of Object.entries(GLOBS)) rows.push(row(make(text), tool, tool, text.length, 'en'));
  }
  for (const re of ADVERSARIAL.slice(0, 2)) for (const [tool, make] of Object.entries(TOOLS)) rows.push(row(make(re, texts[0]), tool, re, texts[0].length, 'ja'));
  // (The review's lines, as written.)
  for (const line of [`echo aaaaaaaaaaaaaa! | grep -E '^(a*){30}b'`, `echo aaaaaaaaaaaaaa! | grep -E '(a{0,30}){30}b'`, `echo aaaaaaaaaa | sed -E 's/(a*){30}b/x/'`, `echo aaaaaaa | grep -E '((a?){30}){30}b'`, `echo aaaaaaaaaaaaa! | grep -E '^((|)(|)(|)a)*$'`, `echo x | grep -E '(a?|b?){1100}(c?){2}d'`, `echo x | grep -E '(){2000000000}'`]) rows.push(row(line, 'review', line, 0, 'en'));
  const big = `${'('.repeat(600)}a${')'.repeat(600)}*b`;
  const results = {
    rows,
    refuse: P.mustRefuse.map(([source, text, flags]) => verdict(source, textOf(text), flags)),
    many: verdict(big, 'a'.repeat(7744)),
    choices: [verdict(`${'a?'.repeat(30)}${'a'.repeat(30)}`, A30), verdict(`${'(a|a)'.repeat(30)}b`, A30), verdict(`${'(|)'.repeat(30)}x`, ''), verdict(`${'(a*|b*)'.repeat(30)}x`, '')],
    grep: MUST_RUN.map((p) => guarded<unknown>(() => runGrep(['-E', p], LINES), () => 'refused')),
    sed: MUST_RUN.map((p) => guarded<unknown>(() => runSed(`s~${p}~X~`, LINES, { quiet: false, extended: true }), () => 'refused')),
    awk: MUST_RUN.map((p) => (/\\[1<b]/.test(p) ? 'left out' : guarded<unknown>(() => runAwk(`/${p.replace(/\//g, '[/]')}/`, LINES, {}), () => 'refused'))),
    many50: MUST_RUN.map((p) => (guarded<unknown>(() => pipelineExample([{ cmd: 'cat', words: [], text: 'cat', copies: true }, { cmd: 'grep', words: ['-E', p], text: 'grep' }], true, MANY), () => undefined) ? 'ran' : 'refused')),
    many50sed: MUST_RUN.map((p) => guarded<unknown>(() => runSed(`s~${p}~X~`, MANY, { quiet: false, extended: true }), () => 'refused')),
    many50grep: MUST_RUN.map((p) => guarded<unknown>(() => runGrep(['-E', p], MANY), () => 'refused')),
    log50sed: MUST_RUN.map((p) => guarded<unknown>(() => runSed(`s~${p}~X~g`, LOG, { quiet: false, extended: true }), () => 'refused')),
    ordinary: ORDINARY.map(([script, text]) => ({
      said: row(`cat <<EOF | sed -E '${script}'\n${text.join('\n')}\nEOF`, 'sed', script, text.length, 'en').said,
      out: guarded<unknown>(() => runSed(script, text, { quiet: false, extended: true }), () => 'refused'),
    })),
    notes: MUST_RUN.filter((p) => !/'/.test(p)).map((p) => [p, row(`echo '${SSHD}' | grep -E '${p}'`, 'grep', p, SSHD.length, 'en').said]),
    doubling: P.doubling.map((p) => [guarded<unknown>(() => runGrep(['-E', p], SHORT), () => 'refused'), guarded<unknown>(() => runSed(`s/${p}/X/`, SHORT, { quiet: false, extended: true }), () => 'refused'), guarded<unknown>(() => runAwk(`/${p}/`, SHORT, {}), () => 'refused')]),
    rerun: Object.fromEntries(Object.entries(SPECS).map(([name, spec]) => {
      const text = name === 'jq' ? JSON.stringify(`${A30}!`) : `${A30}!`;
      return [name, { en: rerun(spec, [[text]], 'en').sections, ja: rerun(spec, [[text]], 'ja').sections }];
    })),
    rerunShort: rerun(SPECS.regex, [['aaa', 'aaa!']], 'en').sections[0].lines,
    checks: Object.fromEntries(Object.entries(CHECKS).map(([name, check]) => [name, check()])),
  };
  process.stdout.write(JSON.stringify(results));
}
