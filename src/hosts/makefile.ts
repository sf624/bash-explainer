import { type Shell, shellFromName } from '../dialect';
import { LineOut, Builder } from './builder';
import { isMakeAutomatic, type HostMeaning, type MakeAutomatic } from '../messages-hosts';
import { builtins } from '../dict/builtins';
import { recipeRun } from './makerun';

/** The shell variable that stands for each of make's automatic variables (what they mean is said by the catalog, src/messages-hosts.ts). */
const MAKE_AUTO: Record<MakeAutomatic, string> = {
  '@': 'make_target',
  '<': 'make_first_prerequisite',
  '^': 'make_prerequisites',
  '?': 'make_newer_prerequisites',
  '*': 'make_stem',
};

/** A line that sets `SHELL` (`SHELL = x`, `all: SHELL := x`, `export SHELL = x`): the value is group 1. */
const SHELL_VALUE = /(?:^|[:\s])SHELL\s*(?:::?|[?+!])?=\s*(.*)$/;

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
  // A `SHELL` other than `/bin/sh` anywhere (in a rule's own too), or an `IFS`, sends every line through a shell.
  const otherShell = b.lines.some((l) => {
    if (l.startsWith('\t')) return false;
    const value = SHELL_VALUE.exec(l)?.[1].replace(/\s*#.*$/, '').trim();
    return IFS_SET.test(l) || (value !== undefined && value !== '/bin/sh');
  });
  let rule = 0;
  const recipes: { start: number; end: number; rule: number; shell: Shell }[] = [];
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
    while (/\\$/.test(b.lines[i]) && i + 1 < b.lines.length) i++;
    recipes.push({ start, end: i, rule, shell });
  }
  for (const r of recipes) {
    makeRecipeLine(b, r.start, true);
    for (let i = r.start + 1; i <= r.end; i++) makeRecipeLine(b, i, false);
    // (With `.ONESHELL`, make joins the lines of a rule and runs them in one shell; a rule of one line is run like any other.)
    const joined = oneShell && recipes.filter((o) => o.rule === r.rule).length > 1;
    const run = otherShell || joined ? undefined : recipeRun(recipeText(b.lines, r.start, r.end));
    if (run?.run === 'direct') {
      b.execRegion(r.start, r.end, ['Makefile のレシピ（シェルなし）', 'Makefile recipe (no shell)'], [{ spec: { id: 'makefile-no-shell', params: {} } }]);
    } else {
      // (A variable's value decides: the note is for a name that is a builtin too, where a shell and make run different things.)
      const maybe = run?.run === 'maybe' && run.first !== undefined && Object.hasOwn(builtins, run.first);
      b.region(r.start, r.end, ['Makefile のレシピ', 'Makefile recipe'], r.shell, maybe ? [{ spec: { id: 'makefile-maybe-no-shell', params: {} } }] : undefined);
    }
    if (oneShell) b.regions[b.regions.length - 1].script = r.rule;
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
    if (next && isMakeAutomatic(next)) {
      const meaning: HostMeaning = { kind: 'make-automatic', char: next };
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

