import { type Shell, shellFromName } from '../dialect';
import { LineOut, Builder } from './builder';
import { isMakeAutomatic, type HostMeaning, type MakeAutomatic } from '../messages-hosts';
import { builtins } from '../dict/builtins';
import { recipeRun } from './makerun';
import { RESERVED } from '../semantics/names';

/** The shell variable that stands for each of make's automatic variables (what they mean is said by the catalog, src/messages-hosts.ts). */
const MAKE_AUTO: Record<MakeAutomatic, string> = {
  '@': 'make_target',
  '<': 'make_first_prerequisite',
  '^': 'make_prerequisites',
  '?': 'make_newer_prerequisites',
  '*': 'make_stem',
};

/**
 * A line that sets `SHELL` or `.SHELLFLAGS` (`SHELL = x`, `export SHELL := x`, `all: SHELL = x`, `SHELL ?= x`): the one reader of
 * both the dialect a recipe is read in and whether make runs a line with no shell. `local`: set for a rule only. A comment sets nothing.
 */
function setting(line: string): { name: 'SHELL' | '.SHELLFLAGS'; op: string; value: string; local: boolean } | undefined {
  const m = /(^|[:\s])(SHELL|\.SHELLFLAGS)\s*(::?|[?+!])?=\s*(.*)$/.exec(line);
  if (!m || /^\s*#/.test(line)) return undefined;
  return { name: m[2] as 'SHELL' | '.SHELLFLAGS', op: m[3] ?? '', value: m[4].replace(/\s*#.*$/, '').trim(), local: line.slice(0, m.index + m[1].length).includes(':') };
}

/** The `.SHELLFLAGS` with which make still runs a line with no shell: the default, and `-ec`, which `.POSIX` sets. */
const DIRECT_FLAGS = new Set(['-c', '-ec']);

/** An `IFS` set in the makefile, which make exports to the shell it would run. */
const IFS_SET = /^\s*(?:export\s+)?IFS\s*[:?+]*=/;

/** The text of a recipe's logical line as make reads it: the prefixes off, the later lines without their first tab. */
function recipeText(lines: string[], start: number, end: number): string {
  const first = lines[start].slice(1).replace(/^[@+\-\s]*/, '');
  const rest = lines.slice(start + 1, end + 1).map((l) => (l.startsWith('\t') ? l.slice(1) : l));
  return [first, ...rest].join('\n');
}

export function makefile(b: Builder): void {
  let shell: Shell = 'sh';
  let inRecipe = false;
  // With `.ONESHELL`, make runs all the lines of a recipe in one shell; otherwise each line in a shell of its own.
  const oneShell = b.lines.some((l) => /^\.ONESHELL\s*:/.test(l));
  // A `SHELL` other than `/bin/sh` or `.SHELLFLAGS` other than `-c` and `-ec` anywhere (in a rule's own too), or an `IFS`,
  // sends every line through a shell.
  const otherShell = b.lines.some((l) => {
    const set = l.startsWith('\t') ? undefined : setting(l);
    return IFS_SET.test(l) || (set !== undefined && (set.name === 'SHELL' ? set.value !== '/bin/sh' : !DIRECT_FLAGS.has(set.value)));
  });
  let rule = 0;
  const recipes: { start: number; end: number; rule: number; shell: Shell }[] = [];
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const set = line.startsWith('\t') ? undefined : setting(line);
    if (set?.name === 'SHELL' && !set.local && set.op !== '?' && set.op !== '+') {
      const name = set.value.split(/\s/)[0].split('/').pop()!;
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
    while (/\\$/.test(b.lines[i]) && i + 1 < b.lines.length) i++;
    recipes.push({ start, end: i, rule, shell });
  }
  for (const r of recipes) {
    // (With `.ONESHELL`, make joins the lines of a rule and runs them in one shell; a rule of one line is run like any other.)
    const joined = oneShell && recipes.filter((o) => o.rule === r.rule).length > 1;
    const text = recipeText(b.lines, r.start, r.end);
    const run = otherShell || joined ? undefined : recipeRun(text);
    const direct = run?.run === 'direct';
    // (No shell reads the line, so its first word is a program, never a keyword: `time make` runs /usr/bin/time. Quoted, bash's
    // keywords (`time`, `until`…) are the names they are for make; Docker's exec form does the same in `execWords`.)
    const word = run?.run === 'direct' ? run.words[0] : undefined;
    const keyword = word !== undefined && RESERVED.has(word) && text.startsWith(word) && /^(\s|$)/.test(text.slice(word.length)) ? word.length : 0;
    makeRecipeLine(b, r.start, true, direct, keyword);
    for (let i = r.start + 1; i <= r.end; i++) makeRecipeLine(b, i, false, direct, 0);
    if (direct) {
      b.execRegion(r.start, r.end, ['Makefile のレシピ（シェルなし）', 'Makefile recipe (no shell)'], [{ spec: { id: 'makefile-no-shell', params: {} } }]);
    } else {
      // (A variable's value decides: the note is for a name that is a builtin too, where a shell and make run different things.)
      const maybe = run?.run === 'maybe' && run.first !== undefined && Object.hasOwn(builtins, run.first);
      b.region(r.start, r.end, ['Makefile のレシピ', 'Makefile recipe'], r.shell, maybe ? [{ spec: { id: 'makefile-maybe-no-shell', params: {} } }] : undefined);
    }
    if (oneShell) b.regions[b.regions.length - 1].script = r.rule;
  }
}

/**
 * Copy one recipe line, turning make's syntax into plain shell. `direct`: make runs the line with no shell. `keyword`: the
 * length of its first word, a keyword of bash that make runs as a program, which is quoted.
 */
function makeRecipeLine(b: Builder, i: number, first: boolean, direct: boolean, keyword: number): void {
  const line = b.lines[i];
  const o = (b.outs[i] ??= new LineOut());
  let k = line.startsWith('\t') ? 1 : 0;
  // `@` (do not echo), `-` (ignore errors) and `+` prefixes are for make.
  if (first) while (/[@+\-\s]/.test(line[k] ?? '') && k < line.length) k++;
  if (keyword) {
    // (Quotes that stand for no character of the file.)
    o.insert("'", k, k);
    o.copy(line, k, k + keyword);
    o.insert("'", k + keyword, k + keyword);
    k += keyword;
  }
  while (k < line.length) {
    if (line[k] !== '$') { o.copy(line, k, k + 1); k++; continue; }
    const next = line[k + 1];
    if (next === '$') {
      // `$$` is a literal `$` for the shell.
      o.insert('$', k, k + 2);
      k += 2;
      continue;
    }
    if (next && isMakeAutomatic(next)) {
      const meaning: HostMeaning = { kind: 'make-automatic', char: next, ...(direct ? { direct: true } : {}) };
      o.insert(`\${${MAKE_AUTO[next]}}`, k, k + 2, meaning);
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
      const meaning: HostMeaning = simple ? { kind: 'make-variable', name: inner } : { kind: 'make-function', name: inner.split(/\s/)[0] };
      o.insert(`\${${name}}`, k, close + 1, meaning);
      b.substitutions.push({ line: i, text: line.slice(k, close + 1), meaning });
      k = close + 1;
      continue;
    }
    // `$X`: a one-letter make variable.
    if (next && /\w/.test(next)) {
      const meaning: HostMeaning = { kind: 'make-variable', name: next };
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

