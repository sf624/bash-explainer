// The examples of the line that the explanation of a part adds (docs/design/analyzer.md, step 6): strings that a
// regex matches, values that select a pattern or make a test true, with the glob options in effect, and an
// example's editable form for the panel. The builders are in src/examples/; this module gives them the line
// (its language, the options where a node is) and adds what they make to the line's examples. Step 5 started it
// with the builders the tests call; step 6 moves the others here.
import type { Example, ExampleSection } from '../analyzer-types';
import * as commandExamples from '../examples/commands';
import * as patterns from '../examples/patterns';
import { type JsRegex, regexExamples } from '../examples/regex';
import type { InputBox, Interactive, RerunSpec } from '../examples/rerun';
import type { GlobOpts } from '../examples/shellwords';
import type { SyntaxNode } from '../syntax/tree';
import type { TestShape } from '../testexpr';
import type { Explainer } from './context';
import { shoptAt, type ShoptName, unquotedWord } from './reads';

/** Strings that do and do not match `js` (as grep lines, inverted by -v, or `=~` values). */
export function regexExample(cx: Explainer, js: JsRegex, mode: 'lines' | 'inverted' | 'values'): void {
  const ex = regexExamples(js);
  if (!ex) return;
  const yes = ex.matching;
  const no = ex.nonMatching;
  let sections: ExampleSection[];
  if (mode === 'inverted') {
    sections = [
      { label: cx.s('表示される行（一致しない行）', 'Printed (lines that do not match)'), lines: no },
      { label: cx.s('表示されない行（一致する行）', 'Not printed (lines that match)'), lines: yes },
    ];
  } else if (mode === 'values') {
    sections = [{ label: cx.s('一致する値', 'Matches'), lines: yes }, { label: cx.s('一致しない値', 'Does not match'), lines: no }];
  } else {
    sections = [{ label: cx.s('一致する行', 'Matching lines'), lines: yes }, { label: cx.s('一致しない行', 'Non-matching lines'), lines: no }];
  }
  cx.example({ kind: 'regex',
    title: mode === 'inverted' ? cx.s('例（`-v` なので一致しない行が表示される）', 'Example (with `-v`, lines that do not match are printed)') : cx.s('例', 'Example'),
    sections: sections.filter((s) => s.lines.length),
    interactive: interactive(cx, { kind: 'regex', regex: js, mode }, [{ label: cx.s('試す文字列（1行ずつ判定し、一致した部分を色付け）', 'Test strings (one per line; matches are highlighted)'), lines: [...yes, ...no] }]),
  });
}

/** How globs match on this line: file names, or `case` and `[[ == ]]` patterns (`find -name` takes neither). */
export function globOpts(cx: Explainer, use: 'file' | 'pattern' | 'none', n: SyntaxNode): GlobOpts {
  const shopt = shoptAt(cx, n);
  const on = (name: ShoptName) => shopt[name] === 'on';
  if (use !== 'pattern' && use !== 'none') {
    // (`**` reaches any depth with globstar on; where it may be on, the example says so.)
    const o: GlobOpts = { globstar: on('globstar') || shopt.globstar === 'unknown', dotglob: on('dotglob'), nocase: on('nocaseglob') };
    return Object.fromEntries(Object.entries(o).filter(([, v]) => v));
  }
  return use === 'pattern' && on('nocasematch') ? { nocase: true } : {};
}

export function pushExample(cx: Explainer, ex: Example | undefined): void {
  if (ex) cx.example(ex);
}

/** An example's editable form for the panel (src/examples/commands.ts). */
export function interactive(cx: Explainer, spec: RerunSpec, inputs: InputBox[]): Interactive {
  return commandExamples.interactive(spec, inputs, cx.lang);
}

/** Values that match any of the glob patterns (`case` branches, the right side of `[[ == ]]`) and values that do not: found with the matcher of `case`. */
export function patternExample(cx: Explainer, pats: SyntaxNode[], labels: [string, string]): void {
  const texts = pats.map((p) => unquotedWord(p) ?? (p.type === 'extglob_pattern' ? p.text : undefined));
  pushExample(cx, patterns.patternExample(texts, globOpts(cx, 'pattern', pats[0]), labels, cx.lang));
}

/** Values that make a simple `[ ]` / `[[ ]]` / `(( ))` test true and false. */
export function testExample(cx: Explainer, n: SyntaxNode, bracket: TestShape | undefined, asKind?: '['): void {
  pushExample(cx, patterns.testExample(n, bracket, asKind, cx.lang));
}
