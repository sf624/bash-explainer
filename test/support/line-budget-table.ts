// The lines that made one line stop the whole tool (docs/design/line-budget.md), and a run of them that reports what each cost:
// run as a program, under a memory cap, by test/line-budget.test.ts, as one may still fill the memory (a process abort cannot be caught).
// usage: npx tsx test/support/line-budget-table.ts [lines of each document]
import { Analyzer } from '../../src/analyzer';
import { documentIssues } from '../../src/document';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';

const A40 = `${'a'.repeat(40)}!`;
const many = (n: number, line: (i: number) => string) => Array.from({ length: n }, (_, i) => line(i)).join('\n') + '\n';
/** `n` levels, one inside another. */
const nested = (n: number, open: string, close: string, inner = 'a') => open.repeat(n) + inner + close.repeat(n);
/** The string read as a script, `n` levels of it, each in single quotes (a third of the text is quotes of the level above). */
const shellStrings = (n: number): string => (n === 0 ? 'a' : `bash -c '${shellStrings(n - 1).replace(/'/g, "'\\''")}'`);

/** A script, and the notes (`…-not-computed`) it must say, in English, or none for what shows no example of it. */
export const LINES: { script: string; says?: RegExp }[] = [
  // An endless loop, or one too long.
  { script: `jq -n 'def f: f; f'`, says: /too many steps/ },
  { script: `jq -n 'def f: 1 + f; f'`, says: /too many steps/ },
  { script: `jq -n '[limit(3; repeat(1))]'` },
  { script: `jq -n 'reduce range(1e5) as $i (0; . + 1)'`, says: /too many steps/ },
  { script: `awk 'BEGIN{while(1);}'`, says: /too many steps/ },
  { script: `awk 'BEGIN{for(;;)x++}'`, says: /too many steps/ },
  { script: `echo a | awk '{ while (1) n++ }'`, says: /too many steps/ },
  { script: `echo a | perl -ne 'while(1){}'` },
  { script: `echo a | perl -ne 'for (1..999) { for (1..999) { $n++ } }'`, says: /too many steps/ },
  { script: `sed ':a;ba'` },
  { script: `perl -e 'while(1){}'` },
  // Values too large.
  { script: `jq -n '[range(1e9)] | length'`, says: /too large/ },
  { script: `jq -n '[range(0; 1e9)] | length'`, says: /too large/ },
  { script: `jq -n 'reduce range(28) as $i ("a"; .+.) | length'`, says: /too large/ },
  { script: `jq -n 'reduce range(40) as $i ([1]; [., .]) | length'`, says: /too large/ },
  { script: `jq -n '"a" * 1e9 | length'`, says: /too large/ },
  { script: `jq -n 'null | .[1000000000] = 1 | length'`, says: /too large/ },
  { script: `awk 'BEGIN{s="a"; for(i=0;i<27;i++) s=s s; n=split(s,a,""); print n}'`, says: /too large/ },
  { script: `awk 'BEGIN{$1000000000="x"}'`, says: /too large/ },
  { script: `awk 'BEGIN{NF=1000000000}'`, says: /too large/ },
  { script: `echo a | perl -ne '$x = "a" x 1e9; print length $x'`, says: /too large/ },
  { script: `echo a | perl -ne '$x = "a"; $x .= $x for 1..40; print length $x'`, says: /too large/ },
  { script: `awk 'BEGIN{s="a"; for(i=0;i<40;i++) s=sprintf("%s%s", s, s); print length(s)}'`, says: /too large/ },
  { script: `echo a | perl -ne '$x = "a"; $x = join("", $x, $x) for 1..40; print length $x'`, says: /too large/ },
  // Others that once took long or gave no line.
  { script: `printf '%1000000000d' 1` },
  { script: `printf '%.1000000000f' 1` },
  { script: `printf '%e' 1e999999999` },
  { script: `perl -e 'printf("%1000000000d", 1)'` },
  { script: `seq 1 1000000000 | head -1` },
  { script: `seq 1000000000` },
  { script: `yes | head -1` },
  { script: `echo {1..99999999}` },
  { script: `echo ${'{a,b}'.repeat(30)}` },
  { script: `jq -R 'test("^(?i)foo")'` },
  { script: `x=${'a'.repeat(7700)}; echo "\${x%%*a}"` },
  { script: `x=${'a'.repeat(7700)}; [[ $x == *a*a*a*b ]]` },
  { script: `x=${'a'.repeat(7700)}; y=$x$x$x$x$x$x$x$x$x$x; echo "$y"` },
  { script: `x=a\n${'x=$x$x\n'.repeat(24)}echo "$x"\n` },
  // Many on a line.
  { script: Array.from({ length: 30 }, (_, i) => `echo ${A40} | grep -E '(a+)+$|z${i}'`).join('; '), says: /Not computed/ },
  { script: `x=${A40}; ${Array.from({ length: 11 }, (_, i) => `echo "\${x%%${'*a'.repeat(40)}${i}}"`).join('; ')}`, says: /Not computed/ },
  // Nesting that was read twice at each level: 2^n in about 120 characters. Now once.
  { script: `echo ${nested(60, '\${x:-', '}')}` },
  { script: `x=${nested(60, '\${x:-', '}')}` },
  { script: `[[ ${nested(60, '\${x:-', '}')} ]]` },
  { script: `case ${nested(60, '\${x:-', '}')} in a) ;; esac` },
  { script: `a > ${nested(60, '\${x:-', '}')}` },
  { script: `echo ${nested(60, '\${x:-$(echo ', ')}')}` },
  { script: nested(60, '$(echo \${x:-', '})') },
  { script: nested(40, 'if $(', '); then b; fi') },
  { script: `echo ${nested(60, '\${x/a/', '}')}` },
  { script: `find . ${'-not '.repeat(60)}-name x` },
  { script: `find . ${'( '.repeat(60)}-name x${' )'.repeat(60)}` },
  { script: shellStrings(10) },
  // Each word of a command read again for each: now once, or, for commands that run commands, no deeper than a limit.
  { script: `sudo ${'sudo '.repeat(200)}c` },
  { script: `command ${'command '.repeat(100)}c` },
  { script: `sed ${"-e 's/a/b/' ".repeat(400)}` },
  { script: `grep ${'-e a '.repeat(400)}` },
  { script: `if a; then b; ${'elif a; then b; '.repeat(400)}fi` },
  { script: `eval ${'eval '.repeat(400)}a` },
  { script: `echo ${'a '.repeat(2000)}` },
  { script: `echo "${'$x'.repeat(2000)}"` },
  { script: `${'a; '.repeat(1000)}a` },
  { script: `[ ${'a -a '.repeat(400)}b ]` },
  // What doubles along a chain of definitions.
  { script: `jq '${'.[]'.repeat(60)}'` },
  { script: `jq 'def a0: .; ${Array.from({ length: 40 }, (_, i) => `def a${i + 1}: a${i}|a${i};`).join(' ')} a40'`, says: /too many steps/ },
  { script: `shopt -s expand_aliases\n${Array.from({ length: 40 }, (_, i) => `alias a${i + 1}='a${i}; a${i}'`).join('\n')}\na40` },
  { script: `${Array.from({ length: 300 }, (_, i) => `f${i + 1}() { f${i}; f${i}; }`).join('\n')}\nf300` },
  // Statements over more lines than each should read: each of these takes the square of its lines without the walk kept for the document (src/explain/whole.ts).
  { script: `echo a${' \\\n a'.repeat(3000)}` },
  { script: `cat <<E\n${'$x $(a) ${y:-b}\n'.repeat(1000)}E` },
  { script: `cat <<E\n${'a\n'.repeat(5000)}E` },
  { script: `echo "\n${'a\n'.repeat(5000)}"` },
  { script: `a=(\n${'x\n'.repeat(3000)})` },
  { script: `x=$(\n${'a\n'.repeat(2000)})` },
  { script: `export a${' \\\n b=1'.repeat(2000)}` },
  // A number from the script that sized a loop or an array.
  { script: 'echo a | cut -f 1000000000' },
  { script: 'echo a | cut -f 1-100000000' },
  { script: 'cut -f 1000000000' },
  { script: 'echo a | sort -k 1000000000' },
  { script: 'sort -k 1000000000' },
  { script: 'echo a | uniq -f 1000000000' },
  { script: 'echo a | uniq -s 1000000000' },
  { script: `perl -ane 'print $F[1000000000]'` },
  { script: `git log --format='${'%<(1000000)%s'.repeat(100)}'`, says: /too large/ },
  { script: "echo a | tr a '[b*999999]'" },
  { script: `echo a | tr '${'[a*999999]'.repeat(5)}' b`, says: /too large/ },
  // jq's own operations, and products, charged before they run.
  { script: `jq -n '{a:range(1000),b:range(1000),c:range(1000),d:range(1000)}|empty'`, says: /too large/ },
  { script: `jq -n '"\\(range(1000))\\(range(1000))\\(range(1000))"|empty'`, says: /too large/ },
  { script: `jq -n '[range(90000)]-[range(90000)]|length'` },
  { script: `jq -n '[range(9000)|[.]]-[range(9000)|[.]]|length'`, says: /too many steps/ },
  { script: `jq -n '[range(90000)]|del(.[])|length'`, says: /too many steps/ },
  { script: `jq -n '[range(9e4)]|del(.[range(9e4)])'`, says: /too many steps/ },
  { script: `jq -n '[range(9e4)]|.[]=1|length'`, says: /too many steps/ },
  { script: `jq -n '[range(99999)]|sort|length'`, says: /too many steps/ },
  { script: `jq -n '[range(9e4)]|group_by(.)'`, says: /too many steps/ },
  { script: `jq -n '[range(9e4)]|unique_by(.)'`, says: /too many steps/ },
  { script: `jq -n '[range(9e4)|[.]]|add|length'`, says: /too many steps/ },
  { script: `jq -n '[range(9e4)|[.]]|flatten|length'`, says: /too many steps/ },
  { script: `jq -n '[range(9e4)|{key:tostring,value:.}]|from_entries|to_entries|length'`, says: /too many steps/ },
  { script: `jq -n '[range(9e4)]|contains([range(9e4)])'`, says: /too many steps/ },
  { script: `jq -n '[range(9e4)] as $a|reduce range(9e4) as $i (0;if $a==$a then 1 else 0 end)'`, says: /too many steps/ },
  { script: `jq -n 'reduce range(1e4) as $i ([range(1e4)];.[1:])|length'`, says: /too many steps/ },
  { script: `jq -n 'setpath([range(1e4)];1)|length'` },
  // Rows too many for a spread into a call: these once stopped the output.
  { script: `jq -n '[range(9e4)]|[paths]'` },
  { script: `jq -n '[range(9e4)]|del(.[0])'` },
  { script: `jq -n '[range(9e4)]|[..]|length'` },
  { script: `jq -n '[range(9e4)]|tojson|length'` },
  { script: `jq -n '[range(9e4)]|implode|length'` },
  { script: `jq -n '[range(9e4)]|indices(1)'` },
];

/** Documents of `n` lines, each adversarial in its own way. */
const documentsOf = (n: number): Record<string, string> => ({
  greps: many(n, (i) => `echo ${A40} | grep -E '(a+)+$|z${i}'`),
  expansions: `x=${A40}\n${many(n, (i) => `echo "\${x%%${'*a'.repeat(12)}${i}}"`)}`,
});

if (require.main === module) {
  const parser = createUnbashParser();
  const analyzer = new Analyzer('en');
  const started = Date.now();
  const rows = LINES.map(({ script, says }) => {
    const t0 = Date.now();
    const tree = parser.parse(script);
    const shown: string[] = [];
    script.split('\n').forEach((_, line) => {
      for (const e of analyzer.explainLine(tree, line, 'bash', { reading: true, sentence: true, argv: true }).examples) shown.push(e.note ?? '');
    });
    return { script: script.slice(0, 70), ms: Date.now() - t0, ok: !says || shown.some((n) => says.test(n)), shown: [...new Set(shown)].map((n) => n.slice(0, 40)) };
  });
  const documents = Object.entries(documentsOf(Number(process.argv[2] ?? 5000))).map(([name, script]) => {
    const tree = parser.parse(script);
    const lines = script.split('\n');
    const t0 = Date.now();
    const issues = documentIssues({ lines, tree }, 'en', {}).length;
    const t1 = Date.now();
    for (let line = 0; line < lines.length; line++) analyzer.explainLine(tree, line, 'bash');
    return { name, issues, diagnostics: t1 - t0, lines: Date.now() - t1 };
  });
  console.log(JSON.stringify({ rows, documents, ms: Date.now() - started, rss: Math.round(process.memoryUsage().rss / 1e6) }));
}
