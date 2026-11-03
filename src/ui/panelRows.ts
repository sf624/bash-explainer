// The panel's row model (docs/design/panel-redesign.md, P7a): which rows the panel shows of a line, a pure function of the
// explanation, the depth and the switch "What the program receives". It starts from the record of each token (src/ui/tokenRow.ts),
// which every output reads, and adds what only the panel needs: which depth a row comes in at, one row per range of the line, the
// frames around commands, each row's roles, what the program receives, and the Key of what is drawn.
//
// A deeper depth only adds: the rows of depth 1 are all at depth 2, in the same order, saying the same (test/panel-rows.test.ts).
// Nothing draws the model yet (P7c does); media/panel.js gets `panelRows`.
import type { ArgvLine, Example, LineExplanation, Span, Token } from '../analyzer-types';
import type { Lang } from '../i18n';
import { LEVELS, type NoteLevel } from '../levels';
import { keyOf, type Layer, type ReadingNode } from '../reading';
import type { TextPart } from '../tokenmarks';
import { sameSpan, shown } from './hoverParts';
import { bandOf, chipOf, readerOf, startsBand } from './readingSteps';
import { ui } from './texts';
import { strongestLevel, type TokenRow, tokenRow } from './tokenRow';

/** A row as the panel gets it: the record, with the place it selects, the examples placed under it and its parts. */
export interface PanelRow extends TokenRow { span: Span; examples?: Example[]; children: PanelRow[] }

/** The rows of a line's tokens, for the panel (media/panel.js has no way to make them: it is plain script, and only draws). */
export function panelRows(items: readonly Token[], lang: Lang): PanelRow[] {
  return items.map((t) => ({ ...tokenRow(t, lang), span: t.span, examples: t.examples, children: panelRows(t.children, lang) }));
}

/** How deep the panel reads the line: 1, what it does; 2, how bash reads it. */
export type Depth = 1 | 2;

/** What the row model is asked for: the depth, and the switch "What the program receives". */
export interface RowOptions { depth: Depth; receives: boolean }

/**
 * The frame around a row and its parts: `command`, a box around one simple command (with assignments alone, too); `compound`,
 * a box around a compound command (`if`, `[[ ]]`, `{ }`, a function's definition); `group`, a bracket around the commands of a
 * pipeline or a list.
 */
export type RowFrame = 'command' | 'compound' | 'group';

/** What a part of the line is to one reader, at depth 2 (a node of the reading tree, src/reading.ts). */
export interface RowRole {
  /** The same in both languages: the layer, the kind, and the option it is the value of or how bash changes the word first. */
  id: string;
  layer: Layer;
  /** Its name (`chipOf`). */
  chip: string;
  /** Who reads it, in words (`readerOf`). */
  readBy: string;
  /** Where a new reader takes over: its name at the band's right (`bandOf`; '' for a language's own tokens). */
  band?: string;
}

/** How a program receives the word a row is about: `asWritten`, the very text written; `changed`, what bash makes of it. */
export type Received = 'asWritten' | 'changed';

/** A row of the model. */
export interface ModelRow extends PanelRow {
  /** Which part of the line it is: the same in both languages, at both depths and with the switch either way. */
  key: string;
  /** The first depth that shows it. */
  comesAt: Depth;
  frame?: RowFrame;
  /** What else it says of the same range: the tokens folded into it. A warning at both depths, the rest at depth 2. */
  more: readonly (readonly TextPart[])[];
  /** Its roles, at depth 2, when the explanation has the reading tree. */
  roles: readonly RowRole[];
  /** With the switch on, on a simple command: what its program receives (src/argvline.ts). */
  receives?: ArgvLine;
  /** With the switch on, on a word of a simple command. */
  received?: Received;
  children: ModelRow[];
}

/** A mark drawn on the panel and what it means. `sample`: its text, where it has one (a level's mark, a badge's word). */
export interface KeyEntry { id: string; sample?: string; text: string }

/** The rows of a line, and the Key of what they draw. */
export interface RowModel { rows: ModelRow[]; key: KeyEntry[] }

/** The kinds that are parts of a word. What the word is to its command says what they are for at depth 1; depth 2 reads them. */
const WORD_PARTS: ReadonlySet<TokenRow['kind']> = new Set(['string', 'number', 'pattern', 'expansion']);
/** The texts of a variable that say no more than that it expands. A variable with a meaning of its own (`$USER`) has none of them. */
const ONLY_EXPANDS = new Set(['variable-plain', 'variable-expands', 'variable-expands-with-note']);

/** The depth a token comes in at by what it is: bash's own syntax and the parts of a word at 2, what a command or a language reads at 1. */
function ownDepth(t: Token, r: TokenRow): Depth {
  if (t.origin === 'argv' || t.origin === 'embedded') return 1;
  if (r.texts?.includes('loop-body')) return 2;
  if (r.kind === 'variable') return r.texts?.some((id) => ONLY_EXPANDS.has(id)) ? 2 : 1;
  if (WORD_PARTS.has(r.kind)) return 2;
  return (r.kind === 'keyword' || r.kind === 'operator') && !t.grammar && !t.children.length ? 2 : 1;
}

/** The frame of a token; `up`: the row above it. */
function frameOf(t: Token, r: TokenRow, up: TokenRow | undefined, lang: Lang): RowFrame | undefined {
  if (t.grammar) return 'group';
  // (What a command reads as a command, `sudo ls`, is one of its words: bash's simple command is `sudo`. Its box says where bash's reading ends.)
  if (t.origin === 'embedded' || t.origin === 'argv' || r.texts?.includes('loop-body')) return undefined;
  // (A definition, and a call of the function; the row of the name in a definition has neither: `f() …`.)
  if (r.kind === 'function') return r.name ? 'command' : t.children.length ? 'compound' : undefined;
  // (`[ -f x ]` is a simple command, whose name `[` has a row of its own in the same box; `[[ ]]` a compound one, with its conditions in one box.)
  if (r.kind === 'command' || r.kind === 'builtin' || r.kind === 'alias') return up?.kind === 'test' ? undefined : 'command';
  if (r.kind === 'test') return up?.kind === 'test' ? undefined : t.children.some((c) => tokenRow(c, lang).name) ? 'command' : 'compound';
  if (r.kind === 'keyword' || r.kind === 'block') return t.children.length ? 'compound' : undefined;
  // (`x=1` alone is a simple command; a prefix assignment, `local x=1`, and `a=1 b=2` as parts, are parts of one.)
  return r.kind === 'assignment' && !(up && ['command', 'builtin', 'function', 'alias', 'assignment'].includes(up.kind)) ? 'command' : undefined;
}

/**
 * The tokens of the same range under a token: they say more of one part of the line, which is one row. (Not under a pipeline or a
 * list, whose first command can reach as far: `cat <<E | sort` ends with its here-document.)
 */
const sameRange = (t: Token): Token[] => (t.grammar ? [] : t.children.filter((c) => sameSpan(c.span, t.span)).flatMap((c) => [c, ...sameRange(c)]));

/** What a redirection is around (`tar … 2>/dev/null`, `while … done < f`, `>f cmd`): its one part that is no redirection. */
function aroundOf(t: Token, r: TokenRow, lang: Lang): Token | undefined {
  if (r.kind !== 'redirect') return undefined;
  const others = t.children.filter((c) => tokenRow(c, lang).kind !== 'redirect');
  return others.length === 1 ? others[0] : undefined;
}

const byStart = (a: Token, b: Token): number => a.span.start.line - b.span.start.line || a.span.start.character - b.span.start.character;
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** What the rows of a line read. */
interface Build {
  options: RowOptions;
  lang: Lang;
  roles: ReadonlyMap<string, RowRole[]>;
  lines: ReadonlyMap<string, ArgvLine>;
  words: ReadonlyMap<string, Received>;
}

/**
 * The rows of a token. A redirection around a command is the command's row, with its redirections among its parts: the box is
 * the command, what bash sets up for it included. A token that does not come in at this depth gives its place to its parts,
 * unless it holds what the panel must show (a warning, a fact, a value, an example, a capture group's colour); a line always
 * has its top rows.
 */
function rowsOf(t: Token, up: TokenRow | undefined, b: Build): ModelRow[] {
  const { depth } = b.options;
  const outer = tokenRow(t, b.lang);
  const head = aroundOf(t, outer, b.lang) ?? t;
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
  const holds = !!(marks.length || facts.length || value || group || examples.length);
  const comesAt: Depth = !up || holds ? 1 : ownDepth(head, own);
  const children = parts.flatMap((c) => rowsOf(c, own, b));
  if (comesAt > depth) return children;
  const at = keyOf(t.span);
  const frame = frameOf(head, own, up, b.lang) ?? chain.slice(1).map((x) => frameOf(x, tokenRow(x, b.lang), own, b.lang)).find(Boolean);
  const receives = frame === 'command' ? b.lines.get(at) : undefined;
  const received = receives ? undefined : b.words.get(at);
  return [{
    ...own,
    marks: marks.length ? marks : undefined,
    level: strongestLevel(marks),
    facts: facts.length ? facts : undefined,
    texts: unique(all.flatMap((r) => r.texts ?? [])),
    name: all.find((r) => r.name)?.name,
    value,
    group,
    refs: unique(all.flatMap((r) => r.refs ?? [])),
    basis: all.find((r) => r.basis)?.basis,
    span: t.span,
    examples: examples.length ? examples : undefined,
    key: t.grammar ? `${at}:${t.grammar}` : at,
    comesAt,
    ...(frame ? { frame } : {}),
    more: said.filter((r) => r.text !== own.text && (depth === 2 || r.marks)).map((r) => r.parts),
    roles: b.roles.get(at) ?? [],
    ...(receives ? { receives } : {}),
    ...(received ? { received } : {}),
    children,
  }];
}

/** The word a simple command's name is: to the reader it is the command, which has its row. */
const NAME_KINDS = new Set(['commandName', 'aliasWord', 'expandedName']);

/** The roles of the parts of a line, from the reading tree, by their range. Quoting is a property of a word, not a role of it. */
function rolesOf(root: ReadingNode, lang: Lang): Map<string, RowRole[]> {
  const out = new Map<string, RowRole[]>();
  const walk = (n: ReadingNode, up: ReadingNode): void => {
    if (n.kind !== 'quote') {
      const key = keyOf(NAME_KINDS.has(n.kind) && up.kind === 'command' ? up.span : n.span);
      const id = [n.layer, n.kind, ...(n.valueFor ? [`value:${n.valueFor}`] : []), ...(n.expands ? [n.expands] : [])].join(':');
      const band = startsBand(n, up) ? { band: bandOf(n, lang) } : {};
      out.set(key, [...out.get(key) ?? [], { id, layer: n.layer, chip: chipOf(n, lang), readBy: readerOf(n, lang), ...band }]);
    }
    n.children.forEach((c) => walk(c, n));
  };
  root.children.forEach((c) => walk(c, root));
  return out;
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

/** The rows the panel shows of a line, at a depth and with the switch, and the Key of what they draw. */
export function rowModel(ex: Pick<LineExplanation, 'items' | 'reading' | 'argv' | 'noteInfo'>, options: RowOptions, lang: Lang): RowModel {
  const lines = options.receives ? ex.argv ?? [] : [];
  const build: Build = {
    options,
    lang,
    roles: options.depth === 2 && ex.reading ? rolesOf(ex.reading, lang) : new Map(),
    lines: new Map(lines.map((l) => [keyOf(l.span), l])),
    words: receivedWords(lines),
  };
  const rows = ex.items.flatMap((t) => rowsOf(t, undefined, build));
  return { rows, key: keyEntries(rows, ex.noteInfo.map((n) => n.level), lang) };
}
