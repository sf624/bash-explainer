import { type Shell, shellFromName } from '../dialect';
import { LineOut, Builder } from './builder';
import { wordTable } from '../wordtable';

const MAKE_AUTO: Record<string, [string, string, string]> = wordTable({
  '@': ['make_target', 'ターゲット名', 'the target name'],
  '<': ['make_first_prerequisite', '最初の依存ファイル', 'the first prerequisite'],
  '^': ['make_prerequisites', 'すべての依存ファイル', 'all prerequisites'],
  '?': ['make_newer_prerequisites', 'ターゲットより新しい依存ファイル', 'the prerequisites newer than the target'],
  '*': ['make_stem', 'パターンルールの `%` に当たる部分', 'the stem matched by `%`'],
});

export function makefile(b: Builder): void {
  let shell: Shell = 'sh';
  let inRecipe = false;
  // With `.ONESHELL`, make runs all the lines of a recipe in one shell; otherwise each line in a shell of its own.
  const oneShell = b.lines.some((l) => /^\.ONESHELL\s*:/.test(l));
  let rule = 0;
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const shellVar = /^\s*SHELL\s*:?=\s*(\S+)/.exec(line);
    if (shellVar) {
      const name = shellVar[1].split('/').pop()!;
      shell = shellFromName(name) ?? 'sh';
    }
    if (!line.startsWith('\t')) {
      // A rule line (`target: deps`) starts a recipe; other lines end it.
      if (/^[^\s#=][^=]*:(?!=)/.test(line) && !/^\s*(ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|include|export)\b/.test(line)) { inRecipe = true; rule = i; }
      else if (line.trim() && !line.trimStart().startsWith('#')) inRecipe = false;
      continue;
    }
    if (!inRecipe) continue;
    const start = i;
    makeRecipeLine(b, i, true);
    while (/\\$/.test(b.lines[i]) && i + 1 < b.lines.length) makeRecipeLine(b, ++i, false);
    b.region(start, i, ['Makefile のレシピ', 'Makefile recipe'], shell);
    if (oneShell) b.regions[b.regions.length - 1].script = rule;
  }
}

/** Copy one recipe line, turning make's syntax into plain shell. */
function makeRecipeLine(b: Builder, i: number, first: boolean): void {
  const line = b.lines[i];
  const o = (b.outs[i] ??= new LineOut());
  let k = line.startsWith('\t') ? 1 : 0;
  // `@` (do not echo), `-` (ignore errors) and `+` prefixes are for make.
  if (first) while (/[@+\-\s]/.test(line[k] ?? '') && k < line.length) k++;
  while (k < line.length) {
    if (line[k] !== '$') { o.copy(line, k, k + 1); k++; continue; }
    const next = line[k + 1];
    if (next === '$') {
      // `$$` is a literal `$` for the shell.
      o.insert('$', k, k + 2);
      k += 2;
      continue;
    }
    if (next && MAKE_AUTO[next]) {
      const [name, ja, en] = MAKE_AUTO[next];
      const meaning: [string, string] = [`make の自動変数（${ja}）で、シェルが実行される前に make が展開します`, `make's automatic variable (${en}), expanded by make before the shell runs`];
      o.insert(`\${${name}}`, k, k + 2, meaning);
      b.substitutions.push({ line: i, text: `$${next}`, meaning });
      k += 2;
      continue;
    }
    if (next === '(' || next === '{') {
      const close = matching(line, k + 1);
      if (close < 0) { o.copy(line, k, line.length); break; }
      const inner = line.slice(k + 2, close);
      const simple = /^[\w.]+$/.test(inner);
      const name = simple ? inner.replace(/\./g, '_') : `make_${inner.split(/\s/)[0].replace(/\W/g, '_')}`;
      const meaning: [string, string] = simple
          ? [`make の変数 \`${inner}\` で、シェルが実行される前に make が展開します`, `the make variable \`${inner}\`, expanded by make before the shell runs`]
          : [`make の関数 \`${inner.split(/\s/)[0]}\` の呼び出しで、シェルが実行される前に make が結果に置き換えます`, `a call of the make function \`${inner.split(/\s/)[0]}\`, replaced by its result before the shell runs`];
      o.insert(`\${${name}}`, k, close + 1, meaning);
      b.substitutions.push({ line: i, text: line.slice(k, close + 1), meaning });
      k = close + 1;
      continue;
    }
    // `$X`: a one-letter make variable.
    if (next && /\w/.test(next)) {
      const meaning: [string, string] = [`make の変数 \`${next}\` で、シェルが実行される前に make が展開します`, `the make variable \`${next}\`, expanded by make before the shell runs`];
      o.insert(`\${${next}}`, k, k + 2, meaning);
      b.substitutions.push({ line: i, text: `$${next}`, meaning });
      k += 2;
      continue;
    }
    o.copy(line, k, k + 1);
    k++;
  }
}

/** Index of the bracket closing the one at `open`. */
function matching(s: string, open: number): number {
  const close = s[open] === '(' ? ')' : '}';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === s[open]) depth++;
    else if (s[i] === close && --depth === 0) return i;
  }
  return -1;
}

