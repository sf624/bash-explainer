// The lines that made one line stop the whole tool (docs/design/line-budget.md), and a run of them that reports what each cost:
// run as a program, under a memory cap, by test/line-budget.test.ts, as one may still fill the memory (a process abort cannot be caught).
// usage: npx tsx test/support/line-budget-table.ts [lines of each document]
import { Analyzer } from '../../src/analyzer';
import { documentIssues } from '../../src/document';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';

const A40 = `${'a'.repeat(40)}!`;
const many = (n: number, line: (i: number) => string) => Array.from({ length: n }, (_, i) => line(i)).join('\n') + '\n';

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
