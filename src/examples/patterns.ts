// The examples of a pattern or a test: the file names a glob matches, the values a `case` branch or the right side
// of `[[ == ]]` takes, and the values that make a simple `[ ]` / `[[ ]]` / `(( ))` test true or false. What they
// depend on in the shell state (the glob options, GLOBIGNORE: src/semantics/) the analyzer reads and passes.
import type { Example } from '../analyzer-types';
import { pick } from '../embedded/types';
import type { Lang } from '../i18n';
import { literalContent } from '../staticword';
import { field, fields, type SyntaxNode } from '../syntax/tree';
import type { TestShape } from '../testexpr';
import { interactive } from './commands';
import { type Operand, testCases } from './runtime';
import { globExamples, globMatches, type GlobMode, type GlobOpts, hasGlobstar } from './shellwords';

/**
 * The names a glob matches and some it does not. `opts`: the glob options in effect (`globstar` is dropped when the
 * pattern has no `**`); `ignore`: the value of `GLOBIGNORE` when it is set and known; `labels`: the sections' labels
 * (values, as of `find -name`, always come with theirs).
 */
export function globExample(pattern: string, mode: GlobMode, opts: GlobOpts, ignore: string | undefined, title: string, labels: [string, string] | undefined, lang: Lang): Example | undefined {
  const s = pick(lang);
  if (!hasGlobstar(pattern)) delete opts.globstar;
  const ex = globExamples(pattern, mode, opts);
  if (!ex) return undefined;
  // A name that matches a pattern of GLOBIGNORE is left out.
  if (ignore !== undefined) {
    const pats = ignore.split(':').filter(Boolean);
    const ignored = (name: string) => pats.some((p) => globMatches(p, name, 'file', { dotglob: true }));
    ex.nonMatching.push(...ex.matching.filter(ignored));
    ex.matching = ex.matching.filter((m) => !ignored(m));
  }
  const [yes, no] = labels ?? [s('一致するファイル名', 'Matching file names'), s('一致しないファイル名', 'Non-matching file names')];
  return { kind: 'glob',
    title, sections: [{ label: yes, lines: ex.matching }, { label: no, lines: ex.nonMatching }].filter((sec) => sec.lines.length),
    // (The panel's matcher does not know GLOBIGNORE: no names to try then.)
    ...(ignore !== undefined ? {} : { interactive: interactive({ kind: 'glob', pattern, mode, ...(Object.keys(opts).length ? { opts } : {}) }, [{ label: s('試す名前（1行に1つ）', 'Names to try (one per line)'), lines: [...ex.matching, ...ex.nonMatching] }], lang) }),
  };
}

/**
 * Values that match any of the glob patterns (`case` branches, the right side of `[[ == ]]`) and values that do not:
 * found with the matcher of `case`. `texts`: the patterns, undefined where one is not a plain word (then no example).
 * `known`: the value the script gives the word matched, and whether it is one of the first section (it comes first in
 * its section, in the place of a sample).
 */
export function patternExample(texts: (string | undefined)[], opts: GlobOpts, labels: [string, string], lang: Lang, known?: { value: string; matches: boolean }): Example | undefined {
  const s = pick(lang);
  if (texts.some((t) => t === undefined)) return undefined;
  const all = texts as string[];
  const matching: string[] = [];
  const candidates: string[] = [];
  for (const t of all) {
    const ex = globExamples(t, 'value', opts);
    if (!ex) return undefined;
    matching.push(...ex.matching.slice(0, all.length > 1 ? 1 : 3));
    candidates.push(...ex.nonMatching);
  }
  const nonMatching = [...new Set(candidates)].filter((v) => !all.some((t) => globMatches(t, v, 'value', opts))).slice(0, 2);
  const lines = [[...new Set(matching)], nonMatching];
  if (known) {
    const i = known.matches ? 0 : 1;
    lines[i] = [known.value, ...lines[i].filter((v) => v !== known.value)].slice(0, Math.max(lines[i].length, 1));
  }
  return { kind: 'glob',
    title: s(`例（パターン \`${all.join('|')}\`）`, `Example (pattern \`${all.join('|')}\`)`),
    sections: [{ label: labels[0], lines: lines[0] }, { label: labels[1], lines: lines[1] }].filter((sec) => sec.lines.length),
  };
}

/**
 * Values that make a simple `[ ]` / `[[ ]]` / `(( ))` test true and false. `known`: the value the script gives the
 * operand node where the test runs, when it is known (it takes the place of the sample with the same result).
 */
export function testExample(n: SyntaxNode, bracket: TestShape | undefined, asKind: '[' | undefined, lang: Lang, known: (x: SyntaxNode) => string | undefined): Example | undefined {
  const s = pick(lang);
  const kind = asKind ?? n.children[0].type as '[' | '[[' | '((';
  let shape: TestShape | undefined;
  if (kind === '[') {
    shape = bracket;
  } else if (n.namedChildren.length === 1) {
    const expr = n.namedChildren[0];
    if (expr.type === 'unary_expression') {
      // `[[ -f` while typing: no operand yet.
      const right = expr.namedChildren.find((c) => c.type !== 'test_operator');
      if (right) shape = { op: field(expr, 'operator')!.text, right };
    } else if (expr.type === 'binary_expression' && fields(expr, 'right').length === 1) {
      shape = { left: field(expr, 'left')!, op: field(expr, 'operator')!.text, right: field(expr, 'right')! };
    }
  }
  if (!shape) return undefined;
  const operand = (x: SyntaxNode): Operand | undefined => {
    // (An unquoted `~` at the start expands to a home directory: not text the example may compare.)
    if (x.text.startsWith('~')) return undefined;
    if (x.type === 'simple_expansion' || (x.type === 'expansion' && /^\$\{\w+\}$/.test(x.text))) return { var: x.text.replace(/^\$\{?|\}$/g, '') };
    if (x.type === 'variable_name') return { var: x.text };
    // The grammar reads the right side of `=`, `==` and `!=` as a pattern; `[ ]` compares it as text.
    if (x.type === 'extglob_pattern' && (kind === '[' || /^[\w.@%+:,/-]+$/.test(x.text))) return { lit: x.text };
    if (x.type === 'string' && x.namedChildren.length === 1 && x.namedChildren[0].type === 'simple_expansion' && x.text === `"${x.namedChildren[0].text}"`) return operand(x.namedChildren[0]);
    const lit = literalContent(x);
    return lit ? { lit: lit.text } : undefined;
  };
  const { left, op, right } = shape;
  // (The side that is a variable: the other is text.)
  const side = left && operand(left) && 'var' in operand(left)! ? left : right;
  const value = known(side);
  const cases = left
    ? testCases(kind, op, operand(left), operand(right), right.type === 'string' || right.type === 'raw_string', value)
    : testCases(kind, op, undefined, operand(right), right.type === 'string', value);
  if (!cases) return undefined;
  // `$#` and `$?` cannot be assigned: say it in words.
  const show = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => (k === '#'
    ? s(`引数が ${v} 個`, `${v} argument${v === '1' ? '' : 's'}`)
    : k === '?' ? s(`直前のコマンドの終了ステータスが ${v}`, `the last command exits with ${v}`)
      : /^\d+$/.test(k) ? `$${k}=${JSON.stringify(v)}` : `${k}=${JSON.stringify(v)}`)).join(' ');
  return { kind: 'test',
    title: s('例', 'Example'),
    sections: [
      { label: s('真になる値', 'True when'), lines: cases.filter((c) => c.result).map((c) => show(c.vars)) },
      { label: s('偽になる値', 'False when'), lines: cases.filter((c) => !c.result).map((c) => show(c.vars)) },
    ].filter((sec) => sec.lines.length),
  };
}
