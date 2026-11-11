// The origin of a value against bash (docs/design/known-values.md, sections 6.1 and 9): where `valueOrigin` names the assignment word an
// expansion copies, bash's value at the use is that word's text, and it comes from that assignment, not from another of the same text. Each
// row's uses are `use K "$x"` (a function of the prelude prints `UK=value`), and the row pins which of them have an origin. bash runs the
// row as it is (each use prints the origin's text, at every run), and once for each origin with the origin's word replaced by a marker
// (each of its uses prints the marker, at every run): an origin taken from the wrong one of two `p=a` would print `a` there. Every run of
// the table is in one process, in a cgroup (`runContained`), with FUNCNEST set.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { shellState } from '../src/semantics/state';
import { expansionValue, valueOrigin, valueUses } from '../src/semantics/values';
import { staticWordText } from '../src/staticword';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { ancestor, descendants, field, fields, type SyntaxNode } from '../src/syntax/tree';
import { runContained } from './support/contained';

interface Row {
  readonly script: string;
  /** The text of the assignment each use copies (`p=a`), or null where it has no origin. */
  readonly origins: Readonly<Record<string, string | null>>;
}

// (`maybe` is a command the model does not know: both paths of an `if` on it are taken. bash runs the prelude's, which succeeds.)
const PRELUDE = "use() { printf 'U%s=%s\\n' \"$1\" \"$2\"; }\nmaybe() { return 0; }\n";

const ROWS: readonly Row[] = [
  // A plain copy only: not another form, nor a positional parameter.
  { script: 'p=a; use 1 "$p"; use 2 "${p}"; use 3 $p; use 4 "${p%a}"; set -- a; use 5 "$1"', origins: { 1: 'p=a', 2: 'p=a', 3: 'p=a', 4: null, 5: null } },
  // `if`/`else`: two words, even of the same text, are no one origin; one assigned before both paths is.
  { script: 'if maybe; then p=a; else p=a; fi; use 1 "$p"', origins: { 1: null } },
  { script: 'if maybe; then p=a; else p=b; fi; use 1 "$p"', origins: { 1: null } },
  { script: 'p=a; if maybe; then use 1 "$p"; fi; use 2 "$p"', origins: { 1: 'p=a', 2: 'p=a' } },
  { script: 'p=a; if maybe; then p=b; use 1 "$p"; fi; use 2 "$p"', origins: { 1: 'p=b', 2: null } },
  // `+=`, and a value made of another variable: no word holds the value.
  { script: 'p=a; p+=b; use 1 "$p"', origins: { 1: null } },
  { script: 'p=a; q=$p; use 1 "$q"; q="$p"; use 2 "$q"', origins: { 1: null, 2: null } },
  // Functions: the walk's order, not the text's.
  { script: "f() { use 1 \"$re\"; }; re='^a'; f", origins: { 1: "re='^a'" } },
  { script: 'f() { use 1 "$p"; }; p=a; f; f', origins: { 1: 'p=a' } },
  { script: 'f() { use 1 "$p"; }; f; p=a; f', origins: { 1: null } },
  { script: 'f() { use 1 "$p"; }; p=a; f; p=b; f', origins: { 1: null } },
  // (Two calls with the same value from two words: the second reuses the first's walk, which holds the first word, in the
  // body and after the call: `p` is in `mixedSources`.)
  { script: 'f() { use 1 "$p"; }; p=a; f; p=a; f; use 2 "$p"', origins: { 1: null, 2: null } },
  // (Five calls, past `WALKS_PER_FUNCTION`: each reuses the first walk, and `re` keeps its one word.)
  { script: `f() { use 1 "$re"; }; re=^a; ${'rc=0; f; '.repeat(5)}use 2 "$re"`, origins: { 1: 're=^a', 2: 're=^a' } },
  { script: 'f() { p=b; }; p=a; use 1 "$p"; f; use 2 "$p"', origins: { 1: 'p=a', 2: 'p=b' } },
  // Subshells: an assignment in one is not seen after it.
  { script: 'p=a; (p=b; use 1 "$p"); use 2 "$p"; (use 3 "$p"); echo "$(use 4 "$p")"', origins: { 1: 'p=b', 2: 'p=a', 3: 'p=a', 4: 'p=a' } },
  // Loops: a pass that assigns again, even the same text, is another word on the next pass.
  { script: 'p=a; for i in 1 2; do use 1 "$p"; done; use 2 "$p"', origins: { 1: 'p=a', 2: 'p=a' } },
  { script: 'p=a; for i in 1 2; do use 1 "$p"; p=a; done', origins: { 1: null } },
  // (A loop whose passes the walk does not count: `p=a` again on a pass is not the first `p=a`, though the value is the same.)
  { script: 'p=a; for i in $(echo 1 2); do use 1 "$p"; p=a; done; use 2 "$p"', origins: { 1: null, 2: null } },
  { script: 'p=a; while maybe; do use 1 "$p"; p=a; [ -n "$i" ] && break; i=1; done', origins: { 1: null } },
  // (A loop over two words runs: after it, `p` is `b`.)
  { script: 'p=a; for i in 1 2; do use 1 "$p"; p=b; done; use 2 "$p"', origins: { 1: null, 2: 'p=b' } },
  { script: 'p=a; for i; do p=b; done; use 1 "$p"', origins: { 1: null } },
  { script: 'for i in 1 2; do p=a; use 1 "$p"; done', origins: { 1: 'p=a' } },
  // Declarations.
  { script: 'f() { local p=b; use 1 "$p"; }; p=a; f; use 2 "$p"', origins: { 1: 'p=b', 2: 'p=a' } },
  { script: 'declare -r p=a; use 1 "$p"', origins: { 1: 'p=a' } },
  { script: 'readonly P=a; use 1 "$P"', origins: { 1: 'P=a' } },
  { script: 'export p=a; use 1 "$p"', origins: { 1: 'p=a' } },
  { script: 'p=a; export p; readonly p; use 1 "$p"', origins: { 1: 'p=a' } },
  { script: 'declare p=a; declare -i n=5; use 1 "$p"; use 2 "$n"', origins: { 1: 'p=a', 2: null } },
  { script: 'declare -l p=a; use 1 "$p"', origins: { 1: null } },
  // Writes the walk follows, though not plain (`Write.followed`): `unset`, a bare `local`, `for`, `read`, `printf -v`,
  // `mapfile`. A use they do not reach keeps its origin; one they reach has none.
  { script: 'p=a; unset p; use 1 "$p"; p=b; use 2 "$p"', origins: { 1: null, 2: 'p=b' } },
  { script: 're=\'^a\'; use 1 "$re"; unset re; use 2 "$re"', origins: { 1: "re='^a'", 2: null } },
  { script: 'f() { local re; re=\'^a\'; use 1 "$re"; }; f; f', origins: { 1: "re='^a'" } },
  { script: 're=\'^a\'; use 1 "$re"; f() { local re; }', origins: { 1: "re='^a'" } },
  { script: 're=\'^a\'; f() { local re; use 1 "$re"; re=b; use 2 "$re"; }; f; use 3 "$re"', origins: { 1: null, 2: 're=b', 3: "re='^a'" } },
  { script: 're=\'^a\'; use 1 "$re"; for re in x; do use 2 "$re"; done; use 3 "$re"', origins: { 1: "re='^a'", 2: null, 3: null } },
  { script: 'for x in a; do x=z; done; use 1 "$x"; for y in a b; do y=c; use 2 "$y"; done; use 3 "$y"', origins: { 1: 'x=z', 2: 'y=c', 3: 'y=c' } },
  { script: 'p=a; use 1 "$p"; read -r p <<< x; use 2 "$p"; q=a; use 3 "$q"; printf -v q %s b; use 4 "$q"; m=a; use 5 "$m"; mapfile -t m <<< b; use 6 "$m"',
    origins: { 1: 'p=a', 2: null, 3: 'q=a', 4: null, 5: 'm=a', 6: null } },
  // (Dynamic scope: a function sees the local of the one that calls it; `unset` of a caller's local shows the global again.)
  { script: 're=g; h() { use 1 "$re"; }; f() { local re=l; h; }; f; h', origins: { 1: null } },
  { script: 'f() { local re; g; use 1 "$re"; }; g() { unset re; }; re=a; f; use 2 "$re"', origins: { 1: 're=a', 2: 're=a' } },
  { script: 'f() { g() { local re; re=b; use 1 "$re"; }; g; use 2 "$re"; }; re=a; f', origins: { 1: 're=b', 2: 're=a' } },
  // (`unset` of a caller's local shows what the nearest such local hides; of a prefix assignment of a call, what it hides.)
  { script: 'f() { local x=5; g; use 1 "$x"; }; g() { unset x; }; h() { local x=7; f; }; h', origins: { 1: 'x=7' } },
  { script: 'f() { local x=5; g; use 1 "$x"; }; g() { unset x; }; x=1; f; h() { local x=7; f; }; h', origins: { 1: null } },
  { script: 'x=g; f() { unset x; use 1 "$x"; x=5; }; x=t f; use 2 "$x"', origins: { 1: 'x=g', 2: 'x=5' } },
  { script: 'x=g; f() { local x; use 1 "$x"; }; x=t f; use 2 "$x"', origins: { 1: 'x=t', 2: 'x=g' } },
  { script: 'x=g; f() { local x=l; x=t g; use 1 "$x"; }; g() { unset x; use 2 "$x"; }; f; use 3 "$x"', origins: { 1: 'x=l', 2: 'x=l', 3: 'x=g' } },
  // (A local made on some paths only, or again on a pass of a loop, is followed on each.)
  { script: 'f() { if maybe; then local x=2; fi; x=9; }; x=1; f; use 1 "$x"', origins: { 1: null } },
  { script: 'f() { local x=2; x=9; }; x=1; f; use 1 "$x"; g() { if maybe; then unset x; fi; }; k() { local x=3; g; use 2 "$x"; }; k', origins: { 1: 'x=1', 2: null } },
  { script: 'x=1; f() { for x in a; do local x; done; use 1 "$x"; }; f; use 2 "$x"', origins: { 1: null, 2: null } },
  // (A `return` before the `local`, and a local in a loop: the caller's variable stays.)
  { script: 'name=world; greet() { [ -n "$1" ] || return 1; local name=$1; use 1 "$name"; }; greet bob; greet; use 2 "$name"', origins: { 1: null, 2: 'name=world' } },
  { script: 'x=1; f() { for i in 1 2; do local x=$i; done; }; f; use 1 "$x"', origins: { 1: 'x=1' } },
  // A prefix assignment: the command's words are expanded before it; a function sees it.
  { script: 'p=a; p=b use 1 "$p"', origins: { 1: 'p=a' } },
  { script: 'p=a; p=b :; use 1 "$p"; q=a; q=b eval :; use 2 "$q"', origins: { 1: 'p=a', 2: 'q=a' } },
  // (A command substitution known to print nothing is no text of the word.)
  { script: 'p=$(true)x; use 1 "$p"', origins: { 1: 'p=$(true)x' } },
  { script: 'f() { use 1 "$p"; }; p=a; p=b f; use 2 "$p"', origins: { 1: 'p=b', 2: 'p=a' } },
  // Quotes and backslashes: the value is the word's text, without them.
  { script: 'p="a\\\\.b"; use 1 "$p"; q=\'x y\'; use 2 "$q"', origins: { 1: 'p="a\\\\.b"', 2: "q='x y'" } },
  // A `case` the walk decides, and one it does not.
  { script: 'p=a; case x in x) p=b ;; esac; use 1 "$p"', origins: { 1: 'p=b' } },
];

const parser = createUnbashParser();

/** The uses of a row, by their number: the expansion in `use K …`, with the origin the model gives. */
function usesOf(script: string): { tree: ReturnType<typeof parser.parse>; uses: Map<string, { part: SyntaxNode; origin?: SyntaxNode }> } {
  const tree = parser.parse(script);
  const model = shellState(tree, 'bash', { read: 'script' });
  const uses = new Map<string, { part: SyntaxNode; origin?: SyntaxNode }>();
  for (const part of descendants(tree.root, ['simple_expansion', 'expansion'])) {
    const cmd = ancestor(part, (a) => a.type === 'command');
    if (field(cmd!, 'name')?.text !== 'use') continue;
    const k = fields(cmd!, 'argument')[0].text;
    assert.ok(!uses.has(k), `${script}: use ${k} has one expansion`);
    uses.set(k, { part, origin: valueOrigin(part, model) });
  }
  // (`valueUses` gives the same, from the origin's side: every expansion with an origin, `use` or not.)
  const all = descendants(tree.root, ['simple_expansion', 'expansion']).flatMap((part) => {
    const origin = valueOrigin(part, model);
    return origin ? [`${origin.startIndex}:${part.startIndex}`] : [];
  });
  assert.strictEqual(valueUses(model), valueUses(model), 'kept by the model');
  assert.deepStrictEqual([...valueUses(model)].flatMap(([o, ps]) => ps.map((p) => `${o.startIndex}:${p.startIndex}`)).sort(), all.sort(), script);
  return { tree, uses };
}

/** bash's output of each script, in one process: the lines `UK=value`, by K. */
async function runAll(scripts: readonly string[]): Promise<Map<string, string[]>[]> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'value-origin-'));
  try {
    scripts.forEach((s, i) => fs.writeFileSync(path.join(cwd, `r${i}.sh`), `${PRELUDE}${s}\n`));
    const driver = scripts.map((_, i) => `FUNCNEST=50 bash --norc --noprofile r${i}.sh > r${i}.out 2>/dev/null`).join('\n');
    await runContained(['bash', '--norc', '-c', driver], cwd, { PATH: process.env.PATH }, 30000);
    return scripts.map((_, i) => {
      const out = new Map<string, string[]>();
      for (const line of fs.readFileSync(path.join(cwd, `r${i}.out`), 'utf8').split('\n').filter(Boolean)) {
        const m = /^U(\d+)=(.*)$/.exec(line)!;
        out.set(m[1], [...(out.get(m[1]) ?? []), m[2]]);
      }
      return out;
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

describe('the origin of a value against bash (valueOrigin, src/semantics/values.ts)', () => {
  it('keeps the value at a use in a function called five times (one walk, reused)', () => {
    const tree = parser.parse(`f() { grep -E "$re" g; }; re=^a; ${'rc=0; f; '.repeat(5)}`);
    const model = shellState(tree, 'bash', { read: 'script' });
    const part = descendants(tree.root, ['simple_expansion'])[0];
    assert.strictEqual(expansionValue(part, model)?.text, '^a');
    assert.strictEqual(valueOrigin(part, model)?.text, '^a');
    assert.ok(model.mixedSources.has('rc') && !model.mixedSources.has('re'));
  });

  it('names the assignments each row pins', () => {
    const wrong = ROWS.flatMap((row) => {
      const { uses } = usesOf(row.script);
      const got = Object.fromEntries([...uses].map(([k, u]) => [k, u.origin ? u.origin.parent!.text : null]));
      return JSON.stringify(got) === JSON.stringify(row.origins) ? [] : [`${row.script}: ${JSON.stringify(got)}`];
    });
    assert.deepStrictEqual(wrong, []);
  });

  it('gives an origin whose text bash has at the use, from that assignment', async function () {
    this.timeout(60000);
    // The scripts: each row, then the row with each origin's word replaced by a marker.
    const runs: { row: number; script: string; marker?: { text: string; origin: SyntaxNode } }[] = [];
    const parsed = ROWS.map((row, i) => {
      const p = usesOf(row.script);
      runs.push({ row: i, script: row.script });
      const origins = [...new Set([...p.uses.values()].flatMap((u) => (u.origin ? [u.origin] : [])))];
      origins.forEach((o, j) => {
        const text = `@${j}@`;
        runs.push({ row: i, script: row.script.slice(0, o.startIndex) + `'${text}'` + row.script.slice(o.endIndex), marker: { text, origin: o } });
      });
      return p;
    });
    const outputs = await runAll(runs.map((r) => r.script));
    const problems: string[] = [];
    runs.forEach((r, i) => {
      for (const [k, u] of parsed[r.row].uses) {
        if (!u.origin || (r.marker && r.marker.origin !== u.origin)) continue;
        const want = r.marker ? r.marker.text : staticWordText(u.origin, 'bash')!.text;
        const got = outputs[i].get(k) ?? [];
        if (!got.length || got.some((g) => g !== want)) problems.push(`${r.script}: use ${k}: ${JSON.stringify(want)}, bash ${JSON.stringify(got)}`);
      }
    });
    assert.deepStrictEqual(problems, []);
  });
});
