import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import type { Lang } from '../src/i18n';
import { readingNodes } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { type ModelRow, rowModel } from '../src/ui/panelRows';

// The role of an AND/OR list (3.2.4) is read from all its operators, nested ones too: `andOrKind` (src/syntax/tree.ts) is the one
// source of the text, `Token.grammar` and the kind of the node in the Reading. The label of the panel's row says it.

const parser = createUnbashParser();
const explain = (src: string, lang: Lang): LineExplanation => new Analyzer(lang).explainLine(parser.parse(src), 0, 'bash', { reading: true, argv: true, script: 'said' });
const tokens = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...tokens(t.children)]);
const rows = (rs: readonly ModelRow[]): ModelRow[] => rs.flatMap((r) => [r, ...rows(r.children)]);
const GRAMMARS = ['andList', 'orList', 'andOrList'];

/** `[grammar, English label, Japanese label]` of each AND/OR list token of the line, outermost first. */
const AND: [string, string, string] = ['andList', 'AND list', 'AND リスト'];
const OR: [string, string, string] = ['orList', 'OR list', 'OR リスト'];
const BOTH: [string, string, string] = ['andOrList', 'AND and OR list', 'AND・OR リスト'];

const CASES: [string, ...[string, string, string][]][] = [
  ['a && b', AND],
  ['a || b', OR],
  ['a && b && c', AND],
  ['a || b || c', OR],
  ['a && b || c', BOTH],
  ['a || b && c', BOTH],
  ['a && b || c && d', BOTH],
  ['grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1', BOTH],
  ['x=$(a && b || c)', BOTH],
  ['x=$(a && b)', AND],
  ['if a && b || c; then d; fi', BOTH],
  ['if a || b; then c && d; fi', OR, AND],
  ['a &&\n  b || c', BOTH],
  ['a ||\n  b || c', OR],
];

describe('the role of an AND/OR list', () => {
  for (const lang of ['en', 'ja'] as const) {
    it(`is the grammar and the label of its token and of the panel's row, from all its operators, ${lang}`, () => {
      for (const [src, ...want] of CASES) {
        const ex = explain(src, lang);
        const lists = tokens(ex.items).filter((t) => t.grammar && GRAMMARS.includes(t.grammar));
        assert.deepStrictEqual(lists.map((t) => t.grammar), want.map((w) => w[0]), src);
        // (The roles are those of the Reading: from depth 2 on; at depth 1 the row has none.)
        for (const depth of [1, 2] as const) {
          for (const receives of [false, true]) {
            const model = rowModel(ex, { depth, receives }, lang);
            const labels = rows(model.rows).filter((r) => GRAMMARS.some((g) => r.key.endsWith(`:${g}`))).map((r) => (r.roleLine?.chips ?? []).map((c) => c.text).join(' | '));
            assert.deepStrictEqual(labels, want.map((w) => (depth === 1 ? '' : lang === 'en' ? w[1] : w[2])), `${src} at depth ${depth}, receives ${receives}`);
          }
        }
      }
    });
  }

  it('is the kind of its node in the Reading, which keeps the node of the AND list inside it', () => {
    const kinds = (src: string): string[] => readingNodes(explain(src, 'en').reading!).filter((n) => GRAMMARS.includes(n.kind)).map((n) => `${n.kind} ${n.label}`);
    assert.deepStrictEqual(kinds('a && b'), ['andList a && b']);
    assert.deepStrictEqual(kinds('a || b || c'), ['orList a || b || c', 'orList a || b']);
    assert.deepStrictEqual(kinds('a && b || c'), ['andOrList a && b || c', 'andList a && b']);
    assert.deepStrictEqual(kinds('a || b && c && d'), ['andOrList a || b && c && d', 'andOrList a || b && c', 'orList a || b']);
    assert.deepStrictEqual(kinds('grep x | sort && echo || exit'), ['andOrList grep x | sort && echo || exit', 'andList grep x | sort && echo']);
  });

  it('says in the text of the token the same as in its role', () => {
    const text = (src: string, lang: Lang): string => tokens(explain(src, lang).items).find((t) => t.grammar && GRAMMARS.includes(t.grammar))!.explanation;
    assert.match(text('a && b', 'en'), /^AND list:/);
    assert.match(text('a || b', 'en'), /^OR list:/);
    assert.match(text('a && b || c', 'en'), /^AND and OR lists, read from the left as `\(a && b\) \|\| c`/);
    assert.match(text('a || b && c', 'ja'), /^AND・OR リスト。左から `\(a \|\| b\) && c` と読む/);
  });
});
