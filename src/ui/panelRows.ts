// The panel's row model (docs/design/panel-redesign.md, P7a): which rows the panel shows of a line, a pure function of the
// explanation, the depth and the switch "What the program receives". It starts from the record of each token (src/ui/tokenRow.ts),
// which every output reads, and adds what only the panel needs: which depth a row comes in at, one row per range of the line, the
// frames around commands, each row's roles, what the program receives, and the Key of what is drawn.
//
// A deeper depth only adds: the rows of depth 1 are all at depth 2, in the same order, saying the same (test/panel-rows.test.ts).
// At depth 2 the reading tree (src/reading.ts) adds what no token says: each row's role line, bash's steps on a word, and the rows of the
// parts of bash's grammar that have no token (`[[`, `2>`'s parts). media/panel.js draws the rows and decides none of it.
import type { ArgvLine, Example, LineExplanation, Span, Token } from '../analyzer-types';
import type { Lang } from '../i18n';
import type { TokenTextId } from '../messages-tokens';
import { LEVELS, type NoteLevel } from '../levels';
import { keyOf, type Layer, type ReadingNode } from '../reading';
import { KIND_ROLES } from '../roles';
import type { TextPart } from '../tokenmarks';
import { sameSpan, shown } from './hoverParts';
import { aboutOf, nodeKind, roleFor, type RoleLine, roleLine, type RowRole } from './panelRoles';
import { type StepsLine, stepsLine } from './panelSteps';
import { ui } from './texts';
import { partBasis, strongestLevel, type TokenRow, tokenRow } from './tokenRow';

/** How deep the panel reads the line: 1, what it does; 2, how bash reads it. */
export type Depth = 1 | 2;

/** What the row model is asked for: the depth, and the switch "What the program receives". */
export interface RowOptions { depth: Depth; receives: boolean }

/**
 * The frame around a row and its parts: `Token.frame` (a box around one simple command, or around a compound command), or `group`,
 * a bracket around the commands of a pipeline or a list.
 */
export type RowFrame = NonNullable<Token['frame']> | 'group';

export type { RowRole } from './panelRoles';

/** How a program receives the word a row is about: `asWritten`, the very text written; `changed`, what bash makes of it. */
export type Received = 'asWritten' | 'changed';

/** A row of the model. */
export interface ModelRow extends TokenRow {
  /** The place it selects. */
  span: Span;
  /** The references it cites. */
  refs: readonly string[];
  /** The examples placed under it. */
  examples?: (Example & { folded?: true })[];
  /** Which part of the line it is: the same in both languages, at both depths and with the switch either way. */
  key: string;
  /** The first depth that shows it. */
  comesAt: Depth;
  frame?: RowFrame;
  /** What else it says of the same range: the tokens folded into it. A warning at both depths, the rest at depth 2. */
  more: readonly (readonly TextPart[])[];
  /** Its roles, at depth 2, when the explanation has the reading tree. */
  roles: readonly RowRole[];
  /** The one line that says them (`argument → value of -f · tar reads it`), and the sections of the manual they are about. */
  roleLine?: RoleLine & { refs: readonly string[] };
  /** At depth 2, on a word bash does something to: its steps, in bash's order. */
  steps?: StepsLine;
  /** A row between two commands of a pipeline (`|`): it says what goes from one to the other, on one line. */
  connector?: true;
  /** It starts folded: all its parts come at depth 2 (`foldDeep`). */
  folded?: true;
  /** With the switch on, on a simple command: what its program receives (src/argvline.ts). */
  receives?: ArgvLine;
  /** With the switch on, on a word of a simple command. */
  received?: Received;
  children: ModelRow[];
}

/** A mark drawn on the panel and what it means. `sample`: its text, where it has one (a level's mark, a badge's word). */
export interface KeyEntry { id: string; sample?: string; text: string }

/**
 * The rows of a line, the Key of what they draw, and where each token of the line is shown: the path of its row (`0.1`, the second
 * part of the first row), or of the nearest row around it where it has none at this depth. One map, read by whatever goes from a
 * token to its row (a problem's chip, the characters of the line box), so that none decides again which rows there are.
 */
export interface RowModel {
  rows: ModelRow[];
  key: KeyEntry[];
  places: ReadonlyMap<Token, string>;
  /** At depth 2, with the reading tree: the role of the whole line (`bash reads the line`), which no row stands for. */
  line?: RoleLine & { refs: readonly string[] };
}

/**
 * The kinds that are parts of a word. What the word is to its command says what they are for at depth 1; depth 2 reads them. (Not an
 * expansion: `${s:$i:2}`, `~`, `{a,b}` change what the word is, which is what the line does. A variable that only expands is `plain`.)
 */
const WORD_PARTS: ReadonlySet<TokenRow['kind']> = new Set(['string', 'number', 'pattern']);

/** The depth a token comes in at by what it is: bash's own syntax and the parts of a word at 2, what a command or a language reads at 1. */
function ownDepth(t: Token, r: TokenRow): Depth {
  if (t.origin === 'argv' || t.origin === 'embedded') return 1;
  if (t.plain || WORD_PARTS.has(r.kind)) return 2;
  return (r.kind === 'keyword' || r.kind === 'operator') && !t.grammar && !t.children.length ? 2 : 1;
}

/**
 * Whether a token folded into a row says its text at depth 1: what a row of its own would (what a command or a language reads, an expansion:
 * it may change what the line means), but for the word itself, whose text is how bash joins its parts, which depth 1 does not show, and for a
 * text that only repeats its code (`a-z` of `tr a-z`).
 */
const saysAtDepth1 = (t: Token, r: TokenRow): boolean => ownDepth(t, r) === 1 && r.text !== r.label && (t.origin === 'argv' || t.origin === 'embedded' || r.kind !== 'argument');

/** The frame of a token: what bash's grammar makes of it, which the explanation says (`Token.grammar`, `Token.frame`). */
const frameOf = (t: Token): RowFrame | undefined => (t.grammar ? 'group' : t.frame);

/**
 * The tokens of the same range under a token: they say more of one part of the line, which is one row. (Not under a pipeline or a
 * list, whose first command can reach as far: `cat <<E | sort` ends with its here-document.)
 */
const sameRange = (t: Token): Token[] => (t.grammar ? [] : t.children.filter((c) => sameSpan(c.span, t.span)).flatMap((c) => [c, ...sameRange(c)]));

/**
 * The command that a command's redirections stand around (`tar … 2>/dev/null`, `>f cmd`), which the explanation says (`Token.around`): their one
 * part that is no redirection. A redirection itself stands around nothing: the part under `> "$f"` is the word of its target.
 */
const aroundOf = (t: Token): Token | undefined => (t.around === 'redirections' ? t.children.find((c) => c.kind !== 'redirect') : undefined);

/**
 * The examples that run a whole statement of the line (a pipeline's): the view draws them apart, folded, above the rows. A
 * pipeline inside a construct of the line keeps its place, under its row. A statement of a list (`a | b; c | d`) counts, and so does a
 * pipeline after its `time` or `!`, which are parts of it (3.2.3).
 */
export function wholeLineExamples(ex: Pick<LineExplanation, 'items' | 'examples'>): Example[] {
  const statements = (t: Token): Token[] => (t.grammar || t.around === 'pipeline' ? [t, ...t.children.flatMap(statements)] : [t]);
  const whole = ex.items.flatMap(statements);
  return ex.examples.filter((e) => e.kind === 'pipeline' && whole.some((t) => sameSpan(t.span, e.anchor!)));
}

const byStart = (a: Token, b: Token): number => a.span.start.line - b.span.start.line || a.span.start.character - b.span.start.character;
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** What the rows of a line read. */
interface Build {
  options: RowOptions;
  lang: Lang;
  roles: ReadonlyMap<string, RoleOfRange>;
  /** A simple command's name by its own range, where that is not the command's: the role of a row of that word alone (`[` of `[ -f f ]`). */
  names: ReadonlyMap<string, RowRole>;
  lines: ReadonlyMap<string, ArgvLine>;
  words: ReadonlyMap<string, Received>;
  /** The row each token was folded into or made. */
  made: Map<Token, ModelRow>;
  /** What each text in a row's `more` says, by the catalog of token texts, where it has ids there. */
  saying: Map<readonly TextPart[], readonly TokenTextId[]>;
}

/**
 * The rows of a token. A redirection around a command is the command's row, with its redirections among its parts: the box is
 * the command, what bash sets up for it included. A token that does not come in at this depth gives its place to its parts,
 * unless it holds what the panel must show (a warning, a fact, a value, an example, a capture group's colour, what a command name
 * is: the reserved word `time` has its badge on its own row); a line always has its top rows.
 */
function rowsOf(t: Token, up: TokenRow | undefined, b: Build, shell: Layer = 'bash'): ModelRow[] {
  const { depth } = b.options;
  const outer = tokenRow(t, b.lang);
  const head = aroundOf(t) ?? t;
  const own = head === t ? outer : tokenRow(head, b.lang);
  const chain = [head, ...sameRange(head)];
  const folded = [...(head === t ? [] : [t]), ...chain.slice(1)];
  const said = folded.map((x) => tokenRow(x, b.lang));
  const all = [own, ...said];
  const parts = t.grammar ? t.children : head === t ? shown(t) : [...shown(head), ...t.children.filter((c) => c !== head)].sort(byStart);
  const marks = all.flatMap((r) => r.marks ?? []);
  const facts = unique(all.flatMap((r) => r.facts ?? []));
  const value = all.find((r) => r.value)?.value;
  const group = all.find((r) => r.group)?.group;
  const examples = (head === t ? chain : [t, ...chain]).flatMap((x) => x.examples ?? []);
  const name = all.find((r) => r.name)?.name;
  const holds = !!(marks.length || facts.length || value || group || examples.length || name);
  const comesAt: Depth = !up || holds ? 1 : ownDepth(head, own);
  const at = keyOf(t.span);
  const whole = b.roles.get(at);
  const inShell = whole?.roles.find((r) => r.layer === 'child' || r.layer === 'bash')?.layer ?? shell;
  const children = parts.flatMap((c) => rowsOf(c, own, b, inShell));
  if (t.grammar === 'pipeline') connect(children, b.lang);
  if (comesAt > depth) return children;
  const range = b.roles.size ? roleOfRow(t, whole, b.names.get(at), inShell, b.lang) : undefined;
  const frame = [t, ...chain].map(frameOf).find(Boolean);
  const receives = frame === 'command' ? b.lines.get(at) : undefined;
  const received = receives ? undefined : b.words.get(at);
  const row: ModelRow = {
    ...own,
    marks: marks.length ? marks : undefined,
    level: strongestLevel(marks),
    facts: facts.length ? facts : undefined,
    texts: unique(all.flatMap((r) => r.texts ?? [])),
    name,
    value,
    group,
    refs: unique(all.flatMap((r) => r.refs ?? [])),
    ...(range && !range.roles.length ? { refs: unique([...all.flatMap((r) => r.refs ?? []), ...range.refs]) } : {}),
    basis: all.find((r) => r.basis)?.basis,
    span: t.span,
    // (A glob's box of names is long for what it adds: under its title.)
    examples: examples.length ? examples.map((e) => (e.kind === 'glob' ? { ...e, folded: true as const } : e)) : undefined,
    key: t.grammar ? `${at}:${t.grammar}` : at,
    comesAt,
    ...(frame ? { frame } : {}),
    more: folded.flatMap((x, i) => (depth === 2 || said[i].marks || (x !== t && saysAtDepth1(x, said[i])) ? [said[i].parts] : [])),
    roles: range?.roles ?? [],
    ...(range ? roleFields(range, unique(all.flatMap((r) => r.refs ?? [])), b.lang) : {}),
    ...(receives ? { receives } : {}),
    ...(received ? { received } : {}),
    children,
  };
  for (const x of said) if (x.texts?.length) b.saying.set(x.parts, x.texts);
  for (const x of [t, ...chain]) b.made.set(x, row);
  return [row];
}

/** Where each token of the line is shown (`RowModel.places`). */
function placesOf(items: readonly Token[], rows: readonly ModelRow[], made: ReadonlyMap<Token, ModelRow>): Map<Token, string> {
  const paths = new Map<ModelRow, string>();
  const number = (rs: readonly ModelRow[], prefix: string): void => rs.forEach((r, i) => {
    paths.set(r, `${prefix}${i}`);
    number(r.children, `${prefix}${i}.`);
  });
  number(rows, '');
  const places = new Map<Token, string>();
  const walk = (t: Token, up: string): void => {
    // (A line's top rows are always there, so that a token with no row has one around it.)
    const at = paths.get(made.get(t)!) ?? up;
    places.set(t, at);
    t.children.forEach((c) => walk(c, at));
  };
  items.forEach((t) => walk(t, ''));
  return places;
}

/** The word a simple command's name is: to the reader it is the command, which has its row. */
const NAME_KINDS = new Set(['commandName', 'aliasWord', 'expandedName']);

/** The roles of what bash's grammar makes of the commands: a list or a pipeline (`Token.grammar`). */
const GRAMMAR_ROLES: ReadonlySet<string> = new Set(['list', 'andList', 'orList', 'pipeline'].flatMap((k) => [`bash:${k}`, `child:${k}`]));

/** The role of a part of bash's grammar with no node of its range. (Its reader is the one around it: no new one starts here.) */
function grammarRole(kind: string, t: Token, layer: Layer, lang: Lang): RowRole {
  const n: ReadingNode = { layer, kind, label: '', span: t.span, children: [] };
  return roleFor(n, n, lang);
}

/**
 * What a row is in bash's reading: the place its range has there (the nodes of the reading tree), never what its token is lexically, so a row with
 * no place says no role (`/cache` of `$d/cache`, one piece of a word). A list and its first command can have one range (`cat <<E | sort`), and each
 * row has its own roles. A row of bash's grammar is that part of it, with a node or not: `time` and `!` are parts of the pipeline (3.2.3), which
 * has one node, so `ls | wc` of `time ls | wc` has none.
 */
function roleOfRow(t: Token, whole: RoleOfRange | undefined, name: RowRole | undefined, shell: Layer, lang: Lang): RoleOfRange {
  const grammar = t.grammar ?? (t.around === 'pipeline' ? 'pipeline' : undefined);
  const own = (whole?.roles ?? []).filter((r) => (GRAMMAR_ROLES.has(r.id) ? (grammar ? r.id === `${r.layer}:${grammar}` : !t.frame) : !grammar));
  const said = own.length ? own : grammar ? [grammarRole(grammar, t, shell, lang)] : name ? [name] : [];
  return { refs: [], ...whole, roles: said };
}

/** What the reading tree says of a range of the line. */
interface RoleOfRange {
  roles: RowRole[];
  refs: readonly string[];
  steps?: NonNullable<ReadingNode['steps']>;
}

/** The range a node is about on a row: a simple command's name is the command, which has its row. */
const rangeOf = (n: ReadingNode, up: ReadingNode): string => keyOf(NAME_KINDS.has(n.kind) && up.kind === 'command' ? up.span : n.span);

/** The roles of the parts of a line, from the reading tree, by their range, and the names of simple commands by their own. Quoting is a property of a word, not a role of it: it adds its sections. */
function rolesOf(root: ReadingNode, lang: Lang): { roles: Map<string, RoleOfRange>; names: Map<string, RowRole> } {
  const roles = new Map<string, RoleOfRange>();
  const names = new Map<string, RowRole>();
  const walk = (n: ReadingNode, up: ReadingNode): void => {
    const key = rangeOf(n, up);
    const was = roles.get(key);
    const role = n.kind === 'quote' ? [] : [roleFor(n, up, lang)];
    roles.set(key, { ...was, roles: [...was?.roles ?? [], ...role], refs: unique([...was?.refs ?? [], ...n.refs ?? []]), ...(n.steps ? { steps: n.steps } : {}) });
    if (key !== keyOf(n.span) && role.length) names.set(keyOf(n.span), role[0]);
    n.children.forEach((c) => walk(c, n));
  };
  root.children.forEach((c) => walk(c, root));
  return { roles, names };
}

/** What the reading tree adds to a row of a range: its role line and its steps. */
function roleFields(range: RoleOfRange, said: readonly string[], lang: Lang): Pick<ModelRow, 'roleLine' | 'steps'> {
  const line = roleLine(range.roles);
  return {
    ...(line ? { roleLine: { ...line, refs: range.refs.filter((r) => !said.includes(r)) } } : {}),
    ...(range.steps ? { steps: stepsLine(range.steps.list, range.steps.context, lang) } : {}),
  };
}

const samePlace = (a: Span['start'], b: Span['start']): boolean => a.line === b.line && a.character === b.character;
const within = (outer: Span, inner: Span): boolean => (outer.start.line < inner.start.line || (outer.start.line === inner.start.line && outer.start.character <= inner.start.character))
  && (outer.end.line > inner.end.line || (outer.end.line === inner.end.line && outer.end.character >= inner.end.character));
const startsBefore = (a: Span, b: Span): boolean => a.start.line < b.start.line || (a.start.line === b.start.line && a.start.character < b.start.character);

/** The kinds of bash's grammar that have a row whether or not a text is said of them: reserved words, operators, and what makes up a redirection or an assignment. */
const NODE_ROWS: ReadonlySet<string> = new Set(['keyword', 'operator', 'descriptor', 'delimiter', 'name', 'word', 'value', 'expression', 'brace']);

/** Where a row of a node goes: under the deepest row around it, among its parts in the order of the line. False: it holds rows of tokens, so it is no row. */
function placeRow(list: ModelRow[], row: ModelRow): boolean {
  const around = list.find((r) => within(r.span, row.span));
  if (around) return placeRow(around.children, row);
  if (list.some((r) => within(row.span, r.span))) return false;
  const at = list.findIndex((r) => startsBefore(row.span, r.span));
  list.splice(at < 0 ? list.length : at, 0, row);
  return true;
}

/** The deepest row around a range. */
function aroundRow(rows: readonly ModelRow[], span: Span): ModelRow | undefined {
  const around = rows.find((r) => within(r.span, span));
  return around && (aroundRow(around.children, span) ?? around);
}

/** One more role of a row. */
function addRole(row: ModelRow, role: RowRole): void {
  row.roles = [...row.roles, role];
  row.roleLine = { ...roleLine(row.roles)!, refs: row.roleLine?.refs ?? [] };
}

/** Sections a node cites where it has no row of its own: on the role line of the row around it. (Such a row has one: what holds a node with sections is no piece of a word.) */
function addRefs(row: ModelRow | undefined, refs: readonly string[] | undefined): void {
  if (!row?.roleLine || !refs) return;
  const said = [...row.refs, ...row.roleLine.refs];
  row.roleLine = { ...row.roleLine, refs: [...row.roleLine.refs, ...refs.filter((r) => !said.includes(r))] };
}

/**
 * Whether a node with no row of its range is one more role of the row around it: a language in a word; the body of a here-document, under its
 * redirection, on the lines after it; a part the row already says all of (`rm` in `xargs rm -f`), or the word the row is named by (`echo` of
 * `sudo echo hi`, whose row is what `sudo` runs). A reserved word or an operator always has its row (`&&` in `[[ a && b ]]`).
 */
function speaksFor(n: ReadingNode, rows: readonly ModelRow[]): boolean {
  const around = aroundRow(rows, n.span);
  if (!around || n.kind === 'keyword' || n.kind === 'operator') return false;
  return n.kind === 'language' || n.kind === 'heredoc' || n.text === around.text || (n.label === around.label && samePlace(n.span.start, around.span.start));
}

/** The row of a part of bash's grammar with no token (`[[`, `2>`'s parts): its text if the tree has one, and what its kind is, the first time. */
function nodeRow(n: ReadingNode, range: RoleOfRange, about: string | undefined, lang: Lang): ModelRow {
  const text = n.text ?? about ?? '';
  const kind = nodeKind(n);
  const key = keyOf(n.span);
  return {
    kind,
    role: KIND_ROLES[kind],
    label: n.label,
    labelParts: [{ text: n.label }],
    text,
    parts: text ? [{ text }] : [],
    refs: [],
    basis: partBasis(n, lang),
    span: n.span,
    key,
    comesAt: 2,
    more: [],
    roles: range.roles,
    ...roleFields(range, [], lang),
    children: [],
  };
}

/**
 * Adds to the rows what only the reading tree says (depth 2): a text it has of a range that has a row goes in the row's `more`; a part with
 * no row gets one, on the lines the tokens are on (the tree has a whole statement; a row reads only its line).
 */
function addNodeRows(rows: ModelRow[], root: ReadingNode, roles: ReadonlyMap<string, RoleOfRange>, lines: ReadonlySet<number>, lang: Lang): void {
  const byRange = new Map<string, ModelRow>();
  const texts = new Set<string>();
  const index = (r: ModelRow): void => {
    // (The deepest row of a range, which says the most of it: `time >o` has `time` twice.)
    byRange.set(keyOf(r.span), r);
    texts.add(r.text);
    r.more.forEach((m) => texts.add(m.map((p) => p.text).join('')));
    r.children.forEach(index);
  };
  rows.forEach(index);
  const kinds = new Set<string>();
  const walk = (n: ReadingNode, up: ReadingNode): void => {
    const at = rangeOf(n, up);
    const row = byRange.get(at);
    if (lines.has(n.span.start.line) || n.kind === 'heredoc') {
      if (row) {
        if (n.kind !== 'quote' && n.text && !row.connector && !texts.has(n.text)) {
          row.more = [...row.more, [{ text: n.text }]];
          texts.add(n.text);
        }
      } else if (n.kind !== 'quote' && speaksFor(n, rows)) {
        const around = (n.kind === 'heredoc' && byRange.get(keyOf(up.span))) || aroundRow(rows, n.span)!;
        addRole(around, roleFor(n, up, lang));
        addRefs(around, n.refs);
      } else {
        const about = n.text === undefined && !kinds.has(n.kind) ? aboutOf(n, lang) : undefined;
        const made = n.kind !== 'quote' && n.kind !== 'language' && (n.text !== undefined || NODE_ROWS.has(n.kind)) ? nodeRow(n, roles.get(at)!, about, lang) : undefined;
        if (made && placeRow(rows, made)) {
          byRange.set(at, made);
          kinds.add(n.kind);
        } else addRefs(aroundRow(rows, n.span), n.refs);
      }
    }
    n.children.forEach((c) => walk(c, n));
  };
  root.children.forEach((c) => walk(c, root));
}

const onlyDeep = (r: ModelRow): boolean => r.comesAt === 2 && r.children.every(onlyDeep);

/** A row whose parts all come at depth 2 starts folded: the row of the whole says what they make, and one press shows them. (Not with an open example under it, which the fold would hide; a folded one keeps its title.) */
function foldDeep(rows: readonly ModelRow[]): void {
  for (const r of rows) {
    foldDeep(r.children);
    if (r.children.length && r.examples?.every((e) => e.folded) !== false && r.children.every(onlyDeep)) r.folded = true;
  }
}

/**
 * A text folded into several rows of a line is said once, on the first: the same words (what double quotes do), or the same message of the catalog with
 * another name in it (`Redirection applied to \`x\``), which says what such a part is in general. A warning stays on each.
 */
function sayOnce(rows: readonly ModelRow[], saying: Build['saying']): void {
  const said = new Set<string>();
  const walk = (r: ModelRow): void => {
    r.more = r.more.filter((m) => {
      const text = saying.get(m)?.join(' ') ?? m.map((p) => p.text).join('');
      const first = !said.has(text);
      said.add(text);
      return first || m.some((p) => p.level);
    });
    r.children.forEach(walk);
  };
  rows.forEach(walk);
}

/** The rows between the commands of a pipeline: each says what goes from the command before it to the one after. */
function connect(rows: readonly ModelRow[], lang: Lang): void {
  const t = ui[lang].panel.connector;
  rows.forEach((r, i) => {
    if (r.kind !== 'operator' || r.marks || !rows[i - 1] || !rows[i + 1]) return;
    const text = (r.label === '|&' ? t.both : t.pipe).replace('{from}', () => `\`${rows[i - 1].label}\``).replace('{to}', () => `\`${rows[i + 1].label}\``);
    Object.assign(r, { connector: true, text, parts: [{ text }] });
  });
}

/** What each word of the simple commands of a line is to its program, by the range of the word. */
function receivedWords(lines: readonly ArgvLine[]): Map<string, Received> {
  return new Map(lines.flatMap((l) => l.words.map((w): [string, Received] => [keyOf(w.from), w.asWritten ? 'asWritten' : 'changed'])));
}

const LEVEL_ORDER = (Object.keys(LEVELS) as NoteLevel[]).sort((a, b) => LEVELS[a].rank - LEVELS[b].rank);

/**
 * The Key: what each mark drawn means, and only those drawn. Each entry is found on the rows, or among the notes of the line
 * for a level (the problems box draws them, P7b).
 */
function keyEntries(rows: readonly ModelRow[], noteLevels: readonly NoteLevel[], lang: Lang): KeyEntry[] {
  const t = ui[lang].panel.key;
  const all = (rs: readonly ModelRow[]): ModelRow[] => rs.flatMap((r) => [r, ...all(r.children)]);
  const drawn = all(rows);
  const levels = new Set([...noteLevels, ...drawn.flatMap((r) => r.marks?.map((m) => m.level) ?? [])]);
  const frames = new Set(drawn.map((r) => r.frame));
  const names = new Map(drawn.flatMap((r) => (r.name ? [[r.name.runs, r.name.said.kind] as const] : [])));
  const roles = new Set(drawn.map((r) => r.role));
  const received = new Set(drawn.map((r) => r.received));
  const words = drawn.flatMap((r) => r.receives?.words ?? []);
  const basis = drawn.find((r) => r.basis)?.basis;
  const when = (on: boolean, entry: KeyEntry): KeyEntry[] => (on ? [entry] : []);
  return [
    ...LEVEL_ORDER.filter((l) => levels.has(l)).map((l) => ({ id: `level:${l}`, sample: LEVELS[l].mark, text: `${LEVELS[l].name[lang]}: ${LEVELS[l].means[lang]}` })),
    ...(['command', 'compound', 'group'] as const).filter((f) => frames.has(f)).map((f) => ({ id: `frame:${f}`, text: t.frame[f] })),
    ...(Object.keys(t.names) as (keyof typeof t.names)[]).flatMap((n) => { const sample = names.get(n); return sample ? [{ id: `name:${n}`, sample, text: t.names[n] }] : []; }),
    ...(Object.keys(t.roles) as (keyof typeof t.roles)[]).filter((r) => roles.has(r)).map((r) => ({ id: `role:${r}`, text: t.roles[r] })),
    ...when(drawn.some((r) => r.refs?.length), { id: 'ref', text: t.ref }),
    ...(basis ? [{ id: 'basis', sample: basis.label, text: t.basis }] : []),
    ...when(drawn.some((r) => r.roles.length), { id: 'roleLine', text: t.roleLine }),
    ...when(received.has('asWritten'), { id: 'received:asWritten', text: t.received.asWritten }),
    ...when(received.has('changed'), { id: 'received:changed', text: t.received.changed }),
    ...when(words.some((w) => w.parts.some((p) => 'hole' in p)), { id: 'received:hole', text: t.received.hole }),
    ...when(words.some((w) => w.count), { id: 'received:many', text: t.received.many }),
  ];
}

/** The lines the tokens of a line are on. */
const linesOf = (items: readonly Token[]): Set<number> => new Set(items.flatMap(function walk(t: Token): number[] { return [t.span.start.line, ...t.children.flatMap(walk)]; }));

/** The rows the panel shows of a line, at a depth and with the switch, and the Key of what they draw. */
export function rowModel(ex: Pick<LineExplanation, 'items' | 'reading' | 'argv' | 'noteInfo'>, options: RowOptions, lang: Lang): RowModel {
  const lines = options.receives ? ex.argv ?? [] : [];
  const read = options.depth === 2 && ex.reading ? rolesOf(ex.reading, lang) : undefined;
  const build: Build = {
    options,
    lang,
    roles: read?.roles ?? new Map(),
    names: read?.names ?? new Map(),
    lines: new Map(lines.map((l) => [keyOf(l.span), l])),
    words: receivedWords(lines),
    made: new Map(),
    saying: new Map(),
  };
  const rows = ex.items.flatMap((t) => rowsOf(t, undefined, build));
  if (options.depth === 2 && ex.reading) {
    addNodeRows(rows, ex.reading, build.roles, linesOf(ex.items), lang);
    foldDeep(rows);
    sayOnce(rows, build.saying);
  }
  // (A line with nothing to explain has no role either.)
  const whole = read && rows.length ? roleLine([roleFor(ex.reading!, undefined, lang)]) : undefined;
  return { rows, key: keyEntries(rows, ex.noteInfo.map((n) => n.level), lang), places: placesOf(ex.items, rows, build.made), ...(whole ? { line: { ...whole, refs: [] } } : {}) };
}
