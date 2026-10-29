// The words of a reading that stand for one word of the line: a word whose fields the semantic model knows, read as
// those fields (`interpret`, bug 7 of docs/design/oracles.md 2.8), and the words a value splices in after it
// (`env -S`, `unsplice`). The roles of the reading are given back in the numbers of the line's words.
import type { ArgRole, ArgvParse, ArgWord, FieldsRole, OperandRole, RoleAt } from './interpret';
import type { OperandSpec } from './spec';

/**
 * The words of a reading that stand for one word of the line (`regroup`): the words `from` to `from + n` (exclusive),
 * which are the word `word` of the line, with `shift` words more than the line has for them: `n - 1` for the fields of
 * a word, which stand in its place (`words`, `interpret`; -1 for none), `n` for the words of a value spliced in after
 * it (`unsplice`).
 */
export interface Group { from: number; n: number; word: number; shift: number; words?: ArgWord[] }

/** The index of the word of the line that the word `j` of a reading stands for, with these `groups` in it (in order). */
export function lineIndex(groups: readonly Group[]): (j: number) => number {
  return (j) => {
    let shift = 0;
    for (const g of groups) {
      if (j < g.from) break;
      if (j < g.from + g.n) return g.word;
      shift += g.shift;
    }
    return j - shift;
  };
}

/** The roles that read a word as an option, or end the options: a field that gives one is said apart (`FieldsRole`). */
export const OPTION_ROLES = new Set<ArgRole['role']>(['option', 'cluster', 'unknown-option', 'pattern-option', 'open-option', 'old-style', 'end-of-options']);

/**
 * The role of a word read as its fields (`interpret`), from their roles (`roles`, numbered from 0): where every field
 * is an operand with no hedge, or the first a command slot that takes one word and the others operands, the role of the
 * first, with the role of each field (`each`, as a brace expansion's: `cp a{,.bak}`) where they differ (the number of
 * fields is not kept in the role: the explanation reads it from the model, `countIn`, for the `$N` of each); where every
 * field is a word of find's expression or of a joined string, that role, which the words around it explain (as for no
 * field, `next`, the role of the word after it), or the command whose string they start; else `FieldsRole`.
 */
function folded(words: ArgWord[], roles: RoleAt[], next?: ArgRole): ArgRole {
  const fields: FieldsRole = { role: 'fields', words, roles };
  const quiet = (r: ArgRole): boolean => r.role === 'expression' || r.role === 'joined';
  if (!words.length) return next && quiet(next) ? { role: next.role } as ArgRole : fields;
  if (roles.length !== words.length) return fields;
  const first = roles[0].role;
  if (quiet(first) && roles.every(({ role }) => role.role === first.role)) return { role: first.role } as ArgRole;
  // (`eval {a,b}`, `ssh h $x`: the words of a joined string, from the first, as for the words of the line.)
  if (first.role === 'command' && first.slot.joinsWords && roles.slice(1).every(({ role }) => role.role === 'joined')) return first;
  // (Nor one with a role of its own when a value before it gives none: `y='p q'; tar -cf $a $y`, only `p` is the archive then.)
  const plain = (r: ArgRole): boolean => r.role === 'operand' && !r.assignment && !r.spec?.assignment && !r.uncertain && !r.none;
  if (roles.every(({ role }) => plain(role) && !(role as OperandRole).spec)) return first;
  const specs = roles.map(({ role }, k) => (k === 0 && role.role === 'command' && !role.parse ? role.item : plain(role) ? (role as OperandRole).spec : undefined));
  if (specs.some((o) => !o)) return fields;
  const each = specs.some((o) => o!.text.en !== specs[0]!.text.en) ? { each: specs as OperandSpec[] } : {};
  return { ...first, ...each } as ArgRole;
}

/**
 * The parse with the role of each word in `own` (a word read as its one field) that reads it as an option given as
 * `FieldsRole`, so that the explanation says what the word gives (`x=-r; cp $x a b`).
 */
export function optionFields(parse: ArgvParse, own: ReadonlySet<number>, words: readonly ArgWord[]): ArgvParse {
  const role = (word: number, r: ArgRole): ArgRole => {
    if (own.has(word) && OPTION_ROLES.has(r.role)) return { role: 'fields', words: [{ value: words[word].fields!()![0] }], roles: [{ word: 0, role: r }] };
    return withParse(r, at);
  };
  const at = (q: ArgvParse): ArgvParse => ({ ...q, roles: q.roles.map(({ word, role: r }) => ({ word, role: role(word, r) })) });
  return at(parse);
}

/** `role` with `f` applied to the parse of its words, when it has one (a subcommand, a command run). */
export const withParse = (role: ArgRole, f: (q: ArgvParse) => ArgvParse): ArgRole =>
  (role.role === 'subcommand' || (role.role === 'command' && role.parse) ? { ...role, parse: f(role.parse!) } as ArgRole : role);

/**
 * A parse read over words some of which stand for one word of the line (`groups`, in order: a value's words spliced
 * in after it, `unsplice`, or a word's fields, `interpret`), in the numbers of the line's words. The roles of the words
 * of each group are given apart (`inner`), numbered from 0, with the roles in the parses of their commands of words of
 * the same group (a command started in them reads the words after them too, whose roles come back to the line). A
 * group of fields has a role of its own (`folded`) where its first role was.
 */
export function regroup(parse: ArgvParse, groups: Group[]): { parse: ArgvParse; inner: RoleAt[][] } {
  const back = lineIndex(groups);
  const groupOf = (j: number): number => groups.findIndex((g) => j >= g.from && j < g.from + g.n);
  /** The word of the line where the words from `j` on start: before the words that give none just before it. */
  const startOf = (j: number): number => {
    let at = back(j);
    for (const g of [...groups].reverse()) if (g.n === 0 && g.from === j && g.word === at - 1) at = g.word;
    return at;
  };
  /** The end of a parse (exclusive) among the words of the line: after the word of its last one. */
  const end = (j: number): number => back(j - 1) + 1;
  const inner: RoleAt[][] = groups.map(() => []);
  /** The role of each group of fields, and where it goes (set once all its roles are known). */
  const slots: { g: number; at: RoleAt; next?: ArgRole }[] = [];
  // (A group of fields that gives none has no role of its own in the reading: its role goes where the next word's is.)
  const line = (q: ArgvParse): ArgvParse => {
    const roles: RoleAt[] = [];
    const place = (g: number, next?: ArgRole): void => {
      if (!groups[g].words || slots.some((s) => s.g === g)) return;
      const at = { word: groups[g].word } as RoleAt;
      slots.push({ g, at, next });
      roles.push(at);
    };
    for (const { word, role } of q.roles) {
      for (const [g, x] of groups.entries()) if (x.n === 0 && x.from <= word && x.word < back(word)) place(g, role);
      const g = groupOf(word);
      if (g < 0) roles.push({ word: back(word), role: withParse(role, line) });
      else {
        place(g);
        inner[g].push({ word: word - groups[g].from, role: inGroup(role, g, roles) });
      }
    }
    roles.sort((a, b) => a.word - b.word);
    // (Where the expression starts: at the words before it that give none, `z=; find . $z -name x`, which are its words.)
    const expression = q.expression === undefined ? {} : { expression: startOf(q.expression) };
    const refusal = q.refusal ? { refusal: { ...q.refusal, at: back(q.refusal.at) } } : {};
    return { ...q, roles, end: end(q.end), unmatched: [...new Set(q.unmatched.filter((j) => groupOf(j) < 0 || groups[groupOf(j)].words).map(back))], ...expression, ...refusal };
  };
  const inGroup = (role: ArgRole, g: number, hoist: RoleAt[]): ArgRole => withParse(role, (q) => {
    const { from, n } = groups[g];
    const roles: RoleAt[] = [];
    for (const { word, role: r } of q.roles) {
      if (groupOf(word) === g) roles.push({ word: word - from, role: inGroup(r, g, hoist) });
      else hoist.push({ word: back(word), role: withParse(r, line) });
    }
    return { ...q, roles, end: Math.min(q.end, from + n) - from, unmatched: q.unmatched.filter((j) => groupOf(j) === g).map((j) => j - from) };
  });
  const out = line(parse);
  // (A group of fields that no role reads, after every word that has one: its role at the end.)
  for (const [g, x] of groups.entries()) {
    if (x.words && !slots.some((s) => s.g === g)) {
      const at = { word: x.word } as RoleAt;
      slots.push({ g, at });
      out.roles.push(at);
    }
  }
  for (const list of inner) list.sort((a, b) => a.word - b.word);
  for (const { g, at, next } of slots) at.role = folded(groups[g].words!, inner[g], next);
  return { parse: out, inner };
}
