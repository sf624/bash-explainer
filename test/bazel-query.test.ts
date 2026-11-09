// The query language of `bazel query`, `cquery` and `aquery` (src/embedded/bazelquery.ts) against what bazel 9.3.2 does with
// each expression of test/fixtures/oracles/bazel.json (`expressions`, recorded by scripts/record-bazel.ts in test/fixtures/bazel):
// where bazel runs it, the reader finds no mistake; where bazel stops at the language (a parse error, a function the command
// does not have or refuses, a variable no `let` binds), the reader finds that mistake, in bazel's words. An error of the
// workspace (a target or a package that is not there) is not the language's: the reader says nothing of it.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, Token } from '../src/analyzer';
import { TARGET_FLAVORS } from '../src/embedded/bazel';
import { explainQuery, KNOWN, type QueryCommand, readQuery } from '../src/embedded/bazelquery';
import { type EmbeddedToken, holeChar } from '../src/embedded/types';
import type { BashParser } from '../src/syntax/tree';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

interface ExpressionRow { command: QueryCommand; options?: string[]; expression: string; status: number; error?: string }
const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'oracles', 'bazel.json'), 'utf8')) as { expressions: ExpressionRow[] };
const LANGS = { query: 'bazelquery', cquery: 'bazelcquery', aquery: 'bazelaquery' } as const;
/** What bazel says of the workspace, not of the language: a target, a package or a configuration that is not there, no target to pick; and of a regex, which the regex reader reads. */
const WORKSPACE = /no such (target|package)|couldn't determine target|invalid target name|argument set is empty|illegal '\w+' pattern regexp|Unknown configuration ID|could be found in the 'null' configuration|ambiguous|Skipping/;

const read = ({ command, options, expression }: ExpressionRow) =>
  readQuery(expression, command, { universe: !!options?.some((o) => /^--(universe_scope|infer_universe_scope)\b/.test(o)) }, 'en', TARGET_FLAVORS[LANGS[command]]);

describe('bazel query expressions, as bazel 9.3.2 reads them', () => {
  for (const row of oracle.expressions) {
    it(`${row.command} ${row.options?.join(' ') ?? ''} '${row.expression}'`, () => {
      const said = read(row).errors.map((e) => e.says);
      if (row.status === 0 || WORKSPACE.test(row.error!)) assert.deepStrictEqual(said, [], `bazel: ${row.error ?? 'status 0'}`);
      else assert.ok(said.some((s) => row.error!.includes(s)), `bazel: ${row.error}; the reader: ${JSON.stringify(said)}`);
    });
  }

  it('knows the functions each command\'s parser lists', () => {
    for (const command of ['query', 'cquery', 'aquery'] as const) {
      const row = oracle.expressions.find((r) => r.command === command && r.expression.startsWith('nosuch('))!;
      const listed = /expected one of \[([^\]]*)\]/.exec(row.error!)![1].split(', ').map((f) => f.slice(1, -1));
      assert.deepStrictEqual([...KNOWN[command]].sort(), listed);
    }
  });
});

let parser: BashParser;
before(() => {
  parser = createUnbashParser();
});

/** The tokens the reader gives the expression of `src`, its only operand, each with its text (nested ones indented). */
function pieces(src: string, lang: 'en' | 'ja' = 'en'): string[] {
  const top = new Analyzer(lang).explainLine(parser.parse(src), 0).items[0];
  const arg = top.children.filter((t) => t.kind === 'argument').at(-1)!;
  const quoted = arg.children.length === 1 && arg.children[0].kind === 'string' && /^['"]/.test(arg.children[0].label) ? arg.children[0].children : arg.children;
  const out: string[] = [];
  const walk = (t: Token, d: number): void => {
    if (t.origin === 'shell') return;
    out.push(`${'  '.repeat(d)}${t.label}: ${t.explanation}`);
    t.children.forEach((c) => walk(c, d + 1));
  };
  quoted.forEach((t) => walk(t, 0));
  return out;
}
/** The text on the operand, after the spec's. */
const note = (src: string, lang: 'en' | 'ja' = 'en'): string =>
  new Analyzer(lang).explainLine(parser.parse(src), 0).items[0].children.filter((t) => t.kind === 'argument').at(-1)!.explanation
    .replace(/^(query expression \(.*?one\)|クエリ式（.*?になる）)( — )?/, '');

describe('bazel query expressions explained', () => {
  it('functions, operators and words', () => {
    assert.deepStrictEqual(pieces('bazel query \'deps(//app:main) except //lib:old\''), [
      'deps: `deps(x)`, `deps(x, depth)`: `x` and every target it depends on, directly or not',
      '//app:main: One target, `//app:main`',
      '  //app: The package `app` (its directory from the top of the repository)',
      '  :main: The target `main`',
      'except: Difference: the targets of the left, without those of the right (the same as `-`)',
      '//lib:old: One target, `//lib:old`',
      '  //lib: The package `lib` (its directory from the top of the repository)',
      '  :old: The target `old`',
    ]);
    assert.deepStrictEqual(pieces('bazel query \'deps(//app:main, 2)\'', 'ja').slice(0, 2), [
      'deps: `deps(x)`・`deps(x, depth)`: `x` と、`x` が直接または間接に依存するすべてのターゲット',
      '//app:main: 1つのターゲット `//app:main`',
    ]);
    assert.deepStrictEqual(pieces('bazel query \'deps(//app:main, 2)\'').at(-1), '2: Depth: only the dependencies at most this many steps away (`0`: the targets themselves)');
  });

  it('`let`, `set`, and the operators that bind alike from the left', () => {
    assert.deepStrictEqual(pieces('bazel query \'let v = //a in $v - set(//b //c) + //d\'').filter((p) => !p.startsWith(' ')), [
      'let: Binds the variable `v` to the targets of the expression after `=`, as `$v` in the expression after `in`',
      'v: The variable `v`',
      '//a: One target, `//a:a` (the target named like the package)',
      'in: `$v` stands in the expression after it (to the end, or to the closing `)`)',
      '$v: The targets `let` bound to the variable `v`',
      '-: Difference: the targets of the left, without those of the right (the same as `except`)',
      'set: The targets of the words in its parentheses, separated by blanks (not commas)',
      '//b: One target, `//b:b` (the target named like the package)',
      '//c: One target, `//c:c` (the target named like the package)',
      '+: Union: the targets of either side (the same as `union`); `except`, `intersect` and `union` bind alike, from the left (`a - b + c` is `(a - b) + c`)',
      '//d: One target, `//d:d` (the target named like the package)',
    ]);
  });

  it('the patterns of `filter`, `kind` and `attr` are Java regexes searched in a text; those of aquery\'s filters match it whole', () => {
    assert.deepStrictEqual(pieces('bazel query "filter(\'^//app:ma.*\', //...)"').slice(1, 3), [
      '\'^//app:ma.*\': A Java regex, searched anywhere in each target\'s label (`//app:main`)',
      '  ^: start of the text',
    ]);
    assert.match(pieces('bazel aquery \'mnemonic(CppCompile, //app:main)\'')[1], /^CppCompile: A Java regex, matched by the whole mnemonic/);
  });

  it('an expression that is one target pattern says what it selects, on the word', () => {
    assert.deepStrictEqual(note('bazel query //app/...'), 'Every rule of the packages in the directory `app` and below');
    assert.deepStrictEqual(pieces('bazel query //app/...'), ['//app: The directory `app`, from the top of the repository', '/...: Every package in this directory and below it']);
  });

  it('the mistakes bazel stops at', () => {
    const errors = (src: string): string[] => pieces(src).filter((p) => /bazel stops/.test(p));
    assert.deepStrictEqual(errors('bazel query \'config(//app:main, target)\''), ['config: `config` is a function of `bazel cquery` only: bazel stops with "unknown function \'config\'"']);
    assert.deepStrictEqual(errors('bazel cquery \'siblings(//app:main)\''), ['siblings: `bazel cquery` refuses `siblings` (the configured graph has nothing for it): bazel stops with "siblings() not supported for post analysis queries"']);
    assert.deepStrictEqual(errors('bazel aquery \'labels(srcs, //app:app)\''), ['labels: `bazel aquery` refuses `labels` (the configured graph has nothing for it): bazel stops with "labels() is not supported for aquery"']);
    assert.deepStrictEqual(errors('bazel query \'allrdeps(//x)\''), ['allrdeps: `allrdeps` is there only with `--universe_scope` or `--infer_universe_scope`: bazel stops with "unknown function \'allrdeps\'"']);
    assert.deepStrictEqual(errors('bazel query --universe_scope=//... \'allrdeps(//x)\''), []);
    assert.deepStrictEqual(errors('bazel cquery \'inputs(".*", //x)\''), ['inputs: `inputs` is a function of `bazel aquery` only: bazel stops with "unknown function \'inputs\'"']);
    assert.deepStrictEqual(errors('bazel query \'//app:a=b\''), ['=: `=` stands only after the name in `let v = …`; as part of a word, quote the word inside the expression (`"//pkg:a=b"`): bazel stops with "unexpected token"']);
    assert.deepStrictEqual(errors('bazel query \'deps(//x\''), ['(: No `)` closes this `(`: bazel stops with "premature end of input"']);
    assert.deepStrictEqual(errors('bazel query \'deps(//x, 1, 2)\''), [',: Too many arguments for `deps`: bazel stops with "too many arguments to function \'deps\'"']);
    assert.deepStrictEqual(errors('bazel query \'$v\''), ['$v: No `let` around this binds `v`: bazel stops with "undefined variable \'v\'"']);
    assert.deepStrictEqual(errors('bazel query \'deps(//x, "a\'')[0], '": No quote closes this one (quotes hold no escapes): bazel stops with "unclosed quotation"');
  });

  it('a `+` with no blank around it is still the union, a warning', () => {
    const [plus] = pieces('bazel query \'//app:a+b\'').filter((p) => p.startsWith('+'));
    assert.match(plus, /^\+: `\+` \(union\), even with no blank around it/);
    // (A word that starts with `@@` holds its `+`: a canonical repository's name.)
    assert.deepStrictEqual(pieces('bazel query \'@@rules_cc+//cc:all\'').filter((p) => p.startsWith('+')), []);
  });

  it('several words, which bazel joins: only the words that are target patterns', () => {
    assert.deepStrictEqual(note('bazel query deps \'(//x)\' //app/...'), 'Every rule of the packages in the directory `app` and below');
  });
});

describe('bazel query expressions with a value in them', () => {
  it('a whole word that is a value: bazel reads the value as the query language', () => {
    assert.deepStrictEqual(pieces('bazel query "deps($t)"').slice(0, 2), [
      'deps: `deps(x)`, `deps(x, depth)`: `x` and every target it depends on, directly or not',
      '$t: The value of `$t` is read as part of the query expression: the words in it are target patterns (or functions, keywords), and a blank, `+`, `(`, `,` or a quote in it is the query\'s syntax (`//a + //b` is the union of two patterns)',
    ]);
  });

  it('a value in a target pattern: what ends the word is said once on the line', () => {
    const said = pieces('bazel query "kind(rule, //$a:all) + //$b:all + deps(//app:$t)"').filter((p) => /The value of/.test(p));
    assert.deepStrictEqual(said.map((p) => /a character no unquoted word holds/.test(p)), [true, false, false]);
    // (In a quoted word of the expression, nothing but its quote ends it.)
    assert.doesNotMatch(pieces('bazel query "deps(\'//$a:all\')"').join('\n'), /no unquoted word/);
  });

  it('a value that would decide the reading leaves the word unread', () => {
    for (const src of ['bazel query "$f(//x)"', 'bazel query "kind($k, //x)"', 'bazel query "deps(//x, $n)"', 'bazel query "labels($a, //x)"', 'bazel query "let $v = //x in //y"']) {
      assert.deepStrictEqual(pieces(src), [], src);
    }
    assert.match(pieces('bazel query "kind(\'$k\', //x)"').join('\n'), /The value of `\$k`/);
  });
});

describe('the edges of the query reader', () => {
  const hole = holeChar(0);
  const explain = (src: string) => explainQuery(src, 'query', {}, 'en', 'query');
  const read = (src: string) => readQuery(src, 'query', {}, 'en', 'query').tokens;
  const kinds = (ts: readonly EmbeddedToken[] | undefined): string[] => (ts ?? []).map((t) => `${t.kind}${t.hole ? `:${t.hole.place}${t.hole.query ? '+query' : ''}` : ''}`);

  it('an expression of one word that is no target pattern is read as the language', () => {
    assert.deepStrictEqual(explain(''), undefined);
    assert.deepStrictEqual(kinds(explain('in')?.tokens), ['error']);
    assert.deepStrictEqual(kinds(explain('"//app:main"')?.tokens), ['string']);
    assert.deepStrictEqual(kinds(explain('$v')?.tokens), ['error']);
    assert.deepStrictEqual(kinds(explain('*')?.tokens), ['error']);
    assert.deepStrictEqual(explain('//')?.tokens.map((t) => t.explanation), ['A target pattern']);
  });

  it('holes: a whole word, one in a pattern, and those that decide the reading', () => {
    assert.deepStrictEqual(kinds(explain(hole)?.tokens), ['variable:query-word']);
    assert.deepStrictEqual(read(`deps(//app:${hole})`)[1].children.flatMap((t) => kinds(t.children)), ['variable:target-name+query']);
    assert.deepStrictEqual(read(`deps('//app:${hole}')`)[1].children.flatMap((t) => kinds(t.children)), ['variable:target-name']);
    for (const src of [`$${hole}`, `deps("@a${hole}:b")`, `deps(${hole}/...)`]) assert.deepStrictEqual(kinds(read(src)).at(-1), 'error', src);
  });
});
