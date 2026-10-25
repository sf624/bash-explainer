// Bracket expressions and the end of the pattern in `${x/p/r}`, `${x#p}` and `${x%p}` (manual 3.5.8.1 and 3.5.3), as
// the word model reads them (the value Meaning shows: src/semantics/words.ts) and the worked examples compute them
// (src/expansion.ts), against bash with LC_ALL=C. A row with `none` gets no value from the model, for the reason given:
// bash reads it by rules of its own, or by the locale. Every other row must get bash's value, and every example of a
// row must give what bash gives on its setup.
import * as assert from 'assert';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, fields } from '../src/syntax/tree';
import { shellState } from '../src/semantics/state';
import { expansionValue } from '../src/semantics/values';
import { describeGlob, exampleFor, globParts, parseExpansion, splitReplacement } from '../src/expansion';
import { Analyzer } from '../src/analyzer';
import { allTokens } from './support/explain';
import { PROBE_BASH, PROBE_ENV } from './support/probe';
import { run } from './support/run';

const S = "s='[section] key'";
const T = "t='a]b[c\\d-e^f!g:h'";
const U = "u='a/b[c]/d'";
const W = "w='a b-c'";

const MISCOUNT = 'bash counts a match of the pattern in `${x/p/r}` otherwise than it matches (its count ends brackets at the first `]` after the first character, and runs over an unclosed `[`)';
const SUBBRACKET = 'a `[:`, `[.` or `[=` that does not close, or a class name that is not a word: bash drops or keeps the `[` by rules of its own';
const LOCALE = 'an equivalence class, or a range with a collating symbol at an end: it depends on the locale';
const COLLSYM = 'a collating symbol of more than one character: a name from bash\'s own table, or nothing';
const RANGE_CLASS = 'a range that ends in a class: bash matches nothing with the whole bracket';
const EMPTY = 'an empty pattern: the model does not follow its rules at the ends of the value';

const ROWS: { setup: string; expr: string; none?: string }[] = [
  // Where the pattern ends: the first unquoted `/`, also inside brackets.
  { setup: S, expr: '${s//[/}' }, { setup: S, expr: '${s//[[]/(}' }, { setup: S, expr: '${s//[[\\]]/}' },
  { setup: S, expr: '${s/#[/x}' }, { setup: S, expr: '${s/#[[]/x}' }, { setup: S, expr: '${s/[s/x}' }, { setup: S, expr: '${s//[[]?/x}' },
  { setup: U, expr: '${u//[/]/x}' }, { setup: U, expr: '${u//[c/]/x}' }, { setup: U, expr: '${u//[c\\/]/x}' }, { setup: U, expr: '${u//[c"/"]/x}' },
  { setup: U, expr: '${u//[b/c]/x}' }, { setup: U, expr: '${u//b[/c]/x}' }, { setup: U, expr: '${u//[]/]/x}' }, { setup: U, expr: '${u//[c]/]/x}' },
  { setup: U, expr: '${u//[/]x}' }, { setup: U, expr: '${u//[/}' }, { setup: U, expr: '${u//(/x}' }, { setup: U, expr: '${u//"/"/x}' },
  { setup: U, expr: "${u//'/'/x}" }, { setup: U, expr: '${u///x}' }, { setup: U, expr: '${u////x}' }, { setup: U, expr: '${u/#//x}', none: EMPTY },
  // Members: `[` and `]`, `!` and `^` not first, quoted or escaped characters, `-`.
  { setup: T, expr: '${t//[a[]/x}' }, { setup: T, expr: '${t//[![]/x}' }, { setup: T, expr: '${t//[[:alpha:][]/x}' }, { setup: T, expr: '${t//[[[:alpha:]]/x}' },
  { setup: T, expr: '${t//[[a]/x}' }, { setup: T, expr: '${t//[[]/x}' }, { setup: T, expr: '${t//[]]/x}' }, { setup: T, expr: '${t//[]abc]/x}' },
  { setup: T, expr: '${t//[\\]]/x}' }, { setup: T, expr: '${t//[\\\\]/x}' }, { setup: T, expr: '${t//[\\[]/x}' }, { setup: T, expr: '${t//[\\]/x}' },
  { setup: T, expr: '${t//[\\!]/x}' }, { setup: T, expr: '${t//[\\^]/x}' }, { setup: T, expr: '${t//[\\!a]/x}' }, { setup: T, expr: '${t//["!"a]/x}' },
  { setup: T, expr: "${t//['!']/x}" }, { setup: T, expr: "${t//['^']/x}" }, { setup: T, expr: '${t//[a!]/x}' }, { setup: T, expr: '${t//[a^]/x}' },
  { setup: T, expr: '${t//["[]"]/x}' }, { setup: T, expr: "${t//['[']/x}" }, { setup: T, expr: "${t//[']']/x}" }, { setup: T, expr: "${t//[!']']/x}" },
  { setup: T, expr: '${t//\\[/x}' }, { setup: T, expr: '${t//"["/x}' }, { setup: T, expr: '${t//"[a]"/x}' }, { setup: T, expr: '${t//[a]"]"/x}' },
  { setup: T, expr: '${t//[!a]/x}' }, { setup: T, expr: '${t//[^a-c]/x}' }, { setup: T, expr: '${t//[*]/x}' }, { setup: T, expr: '${t//[?]/x}' },
  // Ranges.
  { setup: T, expr: '${t//[a-c]/x}' }, { setup: T, expr: '${t//[a-]/x}' }, { setup: T, expr: '${t//[-a]/x}' }, { setup: T, expr: '${t//[]-a]/x}' },
  { setup: T, expr: '${t//[a-]]/x}' }, { setup: T, expr: '${t//[z-a]/x}' }, { setup: T, expr: '${t//[a-c-e]/x}' }, { setup: T, expr: '${t//[a\\-c]/x}' },
  { setup: T, expr: "${t//['a-c']/x}" }, { setup: T, expr: '${t//["a"-c]/x}' }, { setup: T, expr: '${t//[a-"c"]/x}' }, { setup: T, expr: '${t//[\\a-c]/x}' },
  { setup: T, expr: '${t//[a-\\c]/x}' }, { setup: T, expr: '${t//[%-]/x}' }, { setup: T, expr: '${t//[[:digit:]-z]/x}' }, { setup: T, expr: '${t//[[:alpha:]-]/x}' },
  { setup: T, expr: '${t//[a-[:digit:]]/x}', none: RANGE_CLASS }, { setup: T, expr: '${t//[c-[:alpha:]]/x}', none: RANGE_CLASS },
  { setup: T, expr: '${t//[a-[.c.]]/x}', none: LOCALE }, { setup: T, expr: '${t//[[.a.]-c]/x}', none: LOCALE }, { setup: T, expr: '${t//[a-[=c=]]/x}', none: LOCALE },
  // Classes, collating symbols, equivalence classes.
  { setup: T, expr: '${t//[[:alpha:]]/x}' }, { setup: T, expr: '${t//[[:punct:]]/x}' }, { setup: T, expr: '${t//[[:word:]]/x}' }, { setup: T, expr: '${t//[[:ascii:]]/x}' },
  { setup: T, expr: '${t//[[:foo:]]/x}' }, { setup: T, expr: '${t//[[:ALPHA:]]/x}' }, { setup: T, expr: '${t//[![:foo:]]/x}' }, { setup: W, expr: '${w//[[:space:]]/x}' },
  { setup: T, expr: '${t//[[.a.]]/x}' }, { setup: T, expr: '${t//[[.-.]]/x}' }, { setup: T, expr: '${t//[[.].]]/x}' },
  { setup: W, expr: '${w//[[.space.]]/x}', none: COLLSYM }, { setup: W, expr: '${w//[[.hyphen.]]/x}', none: COLLSYM }, { setup: T, expr: '${t//[[.ab.]]/x}', none: COLLSYM },
  { setup: T, expr: '${t//[[=a=]]/x}', none: LOCALE }, { setup: "w='Ab'", expr: '${w//[[=a=]]/x}', none: LOCALE },
  { setup: T, expr: '${t//[[:]/x}', none: SUBBRACKET }, { setup: T, expr: '${t//[[:alp]/x}', none: SUBBRACKET }, { setup: T, expr: '${t//[a[:]/x}', none: SUBBRACKET },
  { setup: T, expr: '${t//[[.\\.]]/x}', none: MISCOUNT }, { setup: T, expr: '${t//"\\\\"/x}' }, { setup: T, expr: '${t//"\\]"/x}' },
  { setup: T, expr: '${t//[[=a]/x}', none: SUBBRACKET }, { setup: T, expr: '${t//[[.a]/x}', none: SUBBRACKET }, { setup: T, expr: '${t//[[:]:]]/x}', none: SUBBRACKET },
  // A `[` that does not close is a character.
  { setup: T, expr: '${t//[a/x}' }, { setup: T, expr: '${t//a[/x}' }, { setup: T, expr: '${t//[!/x}' }, { setup: T, expr: '${t//[]/x}' },
  { setup: "x='[abc'", expr: '${x#[a*}' }, { setup: "x='[a]['", expr: '${x//[[]/y}' },
  // What bash's count of a match in `${x/p/r}` changes; `#` and `%` do not count.
  { setup: T, expr: '${t//[!]]/x}', none: MISCOUNT }, { setup: T, expr: '${t//[!]a]/x}', none: MISCOUNT }, { setup: T, expr: '${t//[^]a]/x}', none: MISCOUNT },
  { setup: T, expr: '${t/#[!]]/x}', none: MISCOUNT }, { setup: T, expr: '${t/%[!]]/x}', none: MISCOUNT }, { setup: T, expr: '${t//[!]]?/x}', none: MISCOUNT },
  { setup: T, expr: '${t//[!]/x}', none: MISCOUNT }, { setup: T, expr: '${t//[!]]*/x}', none: MISCOUNT },
  { setup: "x='[abc'", expr: '${x//[a*/y}', none: MISCOUNT }, { setup: "x='[abxc'", expr: '${x//[a*c/y}', none: MISCOUNT }, { setup: "x='[[:x'", expr: '${x/[[:/y}', none: MISCOUNT },
  { setup: T, expr: '${t#[!]]}' }, { setup: T, expr: '${t%[!]]}' }, { setup: T, expr: '${t%%[!]]*}' }, { setup: S, expr: '${s#[!]]}' }, { setup: S, expr: '${s##[!]]*}' },
  // `#`, `%`, `##`, `%%`.
  { setup: S, expr: '${s#[}' }, { setup: S, expr: '${s#[[]}' }, { setup: S, expr: '${s#[[]*]}' }, { setup: S, expr: '${s##*[]]}' }, { setup: S, expr: '${s%[}' },
  { setup: S, expr: '${s%%[]]*}' }, { setup: S, expr: '${s%[ ]*}' }, { setup: S, expr: '${s#[!]]*]}' }, { setup: U, expr: '${u#*[/]}' }, { setup: U, expr: '${u%%[/]*}' },
];

/** What bash prints for `expr` (in double quotes) after `setup`. */
function bash(setup: string, expr: string): string {
  const r = run(PROBE_BASH, ['--norc', '--noprofile', '-c', `${setup}; printf %s "${expr}"`], { env: PROBE_ENV });
  assert.strictEqual(r.status, 0, `${setup}; ${expr}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

describe('bracket expressions and the end of the pattern in ${x/p/r}, ${x#p}, ${x%p}, against bash', () => {
  const parser = createUnbashParser();
  /** The value the model gives `"${expr}"` after `setup`. */
  const model = (setup: string, expr: string): string | undefined => {
    const tree = parser.parse(`${setup}; echo "${expr}"`);
    const echo = [...descendants(tree.root, ['command'])].pop()!;
    return expansionValue(fields(echo, 'argument')[0].namedChildren[0], shellState(tree, 'bash'))?.text;
  };
  for (const row of ROWS) {
    it(`${row.setup}; ${row.expr}${row.none ? ' (no value)' : ''}`, () => {
      const v = model(row.setup, row.expr);
      if (row.none) assert.strictEqual(v, undefined, row.none);
      else assert.strictEqual(v, bash(row.setup, row.expr));
      for (const c of exampleFor(parseExpansion(row.expr)!, 'en') ?? []) assert.strictEqual(c.result, bash(c.setup!, row.expr), `example: ${c.setup}`);
    });
  }

  it('ends the pattern at the first unquoted slash, also in brackets; after `//`, a slash first is the pattern\'s', () => {
    const parts = (text: string) => parseExpansion(text)!.parts.filter((p) => p.role === 'pattern' || p.role === 'replacement').map((p) => p.text);
    assert.deepStrictEqual(parts('${u//[/]/x}'), ['[', ']/x']);
    assert.deepStrictEqual(parts('${u//[c\\/]/x}'), ['[c\\/]', 'x']);
    assert.deepStrictEqual(parts('${u//"/"/x}'), ['"/"', 'x']);
    assert.deepStrictEqual(parts('${u//"a\\"/"/x}'), ['"a\\"/"', 'x']);
    assert.deepStrictEqual(parts('${u//$(echo /)/x}'), ['$(echo /)', 'x']);
    assert.deepStrictEqual(parts('${u//${v/a/b}/x}'), ['${v/a/b}', 'x']);
    assert.deepStrictEqual(parts('${u//$(echo "a)/b")/x}'), ['$(echo "a)/b")', 'x']);
    assert.deepStrictEqual(parts('${u//$(echo \\)/)/x}'), ['$(echo \\)/)', 'x']);
    assert.deepStrictEqual(parts('${u//`echo /`/x}'), ['`echo /`', 'x']);
    assert.deepStrictEqual(parts('${u///x}'), ['/x']);
    assert.deepStrictEqual(parts('${u////x}'), ['/', 'x']);
    assert.deepStrictEqual(parts('${u/#//x}'), ['', '/x']);
    assert.deepStrictEqual(parts('${u//\'a/b/x}'), ['\'a/b/x']);
    assert.deepStrictEqual(parts('${u//$(echo/x}'), ['$(echo/x']);
    assert.deepStrictEqual(splitReplacement('/x', true), { pattern: '/x' });
    assert.deepStrictEqual(splitReplacement('/x'), { pattern: '', replacement: 'x' });
  });

  it('reads no pattern with a quote that does not close', () => {
    assert.strictEqual(globParts("'a"), undefined);
    assert.strictEqual(globParts('"a'), undefined);
    assert.deepStrictEqual(globParts('"a\\"b"'), [{ type: 'text', text: 'a"b' }]);
  });

  it('says no more of a pattern whose bracket expression it does not read (it is no extended glob)', () => {
    const tokens = allTokens(new Analyzer('en').explainLine(parser.parse('echo "${x#[[.space.]]}"'), 0).items);
    const t = tokens.find((x) => x.label === '[[.space.]]');
    assert.ok(t, tokens.map((x) => x.label).join(' '));
    assert.strictEqual(t.explanation, 'Pattern `[[.space.]]`: Glob pattern (shell wildcards): matched against a string');
  });

  it('describes a bracket expression it does not read by what it is', () => {
    assert.strictEqual(describeGlob([{ type: 'class', body: '[.space.]' }], 'en'), 'one character that `[[.space.]]` matches');
    assert.strictEqual(describeGlob([{ type: 'class', body: '[=a=]' }], 'ja'), '`[[=a=]]` に一致する1文字');
  });
});
