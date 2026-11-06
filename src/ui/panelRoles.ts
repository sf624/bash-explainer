// What a node of the reading tree (src/reading.ts) is at depth 2 of the panel: its name, who reads it, where a new reader takes over,
// what its kind is in general and the colour of its code; and the one line a row says of them (docs/design/panel-redesign.md, P8).
import type { Kind, ScriptProcess } from '../analyzer-types';
import type { Lang } from '../i18n';
import type { Layer, ReadingNode } from '../reading';
import { READING_KINDS } from '../roles';
import { panelTexts } from './texts';

/** The shell that reads the script (`LineExplanation.shell`): none is bash. */
export type ScriptShell = string | undefined;
const texts = (lang: Lang, shell?: ScriptShell) => panelTexts(lang, shell).tree;
const of = (table: object, key: string): string | undefined => (table as Record<string, string>)[key];
/** The shell that parses a node of the layer `child` (a substitution's subshell where it is not said). */
const processOf = (n: ReadingNode): ScriptProcess => n.process ?? 'subshell';

/**
 * The key of a node's general text in `about`: what a kind is to bash, so '' for what a command or a language reads (`-q` of `grep` is no
 * option of a reserved word; a language's `keyword` is not bash's reserved word).
 */
export function aboutKey(n: Pick<ReadingNode, 'layer' | 'kind' | 'reader' | 'label'>): string {
  if (n.kind === 'language') return n.reader !== 'bash' ? 'language' : n.label === 'prompt' ? 'promptLanguage' : 'bashLanguage';
  return n.layer === 'bash' || n.layer === 'child' ? n.kind : '';
}

/** What a node's kind is in general, where the table says it. */
export const aboutOf = (n: ReadingNode, lang: Lang, shell?: ScriptShell): string | undefined => of(texts(lang, shell).about, aboutKey(n));

/**
 * The name a node is shown with: where it stands in bash's reading or in its command's (a command name with what it runs), or the language. '' where
 * it stands nowhere that can be named: a token inside a language, whose row says what it is, and a piece of a word bash has no node for (`*` of `*.txt`).
 */
export function chipOf(n: ReadingNode, lang: Lang, shell?: ScriptShell): string {
  const t = texts(lang, shell);
  if (n.kind === 'language') return of(t.languages, n.label) ?? n.label;
  // (A word the command reads that is not an option is an operand: bash's arguments are called arguments.)
  if (n.layer === 'command' && n.valueFor) {
    // (A word that bash expands first: the command reads each word that comes out, not the word as written. Its
    // first word is the value of the option.)
    return (n.expands ? t.valueExpands : t.valueFor).replace('{flag}', n.valueFor);
  }
  // (A command another runs is a command name too, as bash's own are: its badge says what it is, and who runs it.)
  let kind = n.layer === 'command' ? of(t.commandKinds, n.kind) : n.layer === 'language' ? undefined : of(t.kinds, n.kind);
  if (!kind) return '';
  const expands = n.layer === 'command' && n.expands ? t.expands[n.expands] : undefined;
  if (expands) kind = expands.replace('{kind}', kind);
  // (A command name's badge says what it runs.)
  return n.resolves && !n.name ? `${kind} · ${t.resolves[n.resolves]}` : kind;
}

/** Who reads a node, in full: bash, which shell parses it again, the command (a part of the shell, a program, a new bash), or the language and who reads it. */
export function readerOf(n: ReadingNode, lang: Lang, shell?: ScriptShell): string {
  const r = texts(lang, shell).readers;
  if (n.layer === 'child') return r.child[processOf(n)];
  // (bash reads two languages itself: the regex of `=~`, and a prompt string, the value of `PS1` or `PS4`.)
  if (n.layer === 'language' && n.reader === 'bash') return n.label === 'prompt' ? r.promptLanguage : r.bashLanguage;
  // (A builtin or a function is no other than the shell; and a new bash is a bash too: its reader cannot be "not bash".)
  if (n.inShell) return r.inShell.replace('{name}', n.reader!);
  if (n.layer === 'command' && n.reader!.split('/').pop() === 'bash') return r.newBash;
  return r[n.layer].replace('{name}', n.reader ?? '');
}

/** Whether a node starts a band: where the reader changes (another layer, another command, another shell). */
export function startsBand(n: ReadingNode, parent: ReadingNode | undefined): boolean {
  return !parent || parent.layer !== n.layer || (n.layer === 'command' && parent.reader !== n.reader)
    || (n.layer === 'child' && parent.process !== n.process);
}

/** The name at the right of a band: where a new reader takes over. */
export function bandOf(n: ReadingNode, lang: Lang, shell?: ScriptShell): string {
  const t = texts(lang, shell);
  // (A node of the layer `command` always has its reader: the command's name, src/reading.ts.)
  if (n.layer === 'command') return t.reads.replace('{name}', n.reader!);
  if (n.layer === 'language') return chipOf(n, lang, shell);
  if (n.layer === 'child') return t.bands.child[processOf(n)];
  return t.bands.bash;
}

/** The kind a node's code is coloured as, as the rows colour their tokens (`.kind-*`): a node of the other layers has its token's kind (`READING_KINDS`). */
export function roleOf(n: Pick<ReadingNode, 'kind'>): string {
  return READING_KINDS[n.kind] ?? n.kind;
}

/** What a part of the line is to one reader, at depth 2 (a node of the reading tree, src/reading.ts). */
export interface RowRole {
  /** The same in both languages: the layer, the kind, and the option it is the value of or how bash changes the word first. */
  id: string;
  layer: Layer;
  /** Its name (`chipOf`). */
  chip: string;
  /** Who takes over the reading here (`bandOf`), none where the same reader goes on. */
  band?: string;
  /** In the layer `child`: which shell parses it. */
  process?: ScriptProcess;
  /** What its name opens to: what its kind is in general (`aboutOf`), and who reads it, in full (`readerOf`). */
  said: string;
}

/** The role of a node on a row: `up`, the node around it. None where it has no name (`chipOf`). */
export function roleFor(n: ReadingNode, up: ReadingNode | undefined, lang: Lang, shell?: ScriptShell): RowRole | undefined {
  const chip = chipOf(n, lang, shell);
  if (!chip) return undefined;
  const id = [n.layer, n.kind, ...(n.valueFor ? [`value:${n.valueFor}`] : []), ...(n.expands ? [n.expands] : [])].join(':');
  const about = aboutOf(n, lang, shell);
  const reader = readerOf(n, lang, shell);
  const said = about ? about + panelTexts(lang, shell).steps.because.replace('{why}', () => reader) : reader;
  return { id, layer: n.layer, chip, ...(startsBand(n, up) ? { band: bandOf(n, lang, shell) } : {}), ...(n.process ? { process: n.process } : {}), said };
}

/** A name on a row's role line: what comes from another reader starts with an arrow. `said`: what it opens to; `id`: the same in both languages. */
export interface RoleChip { id: string; text: string; said: string; changes: boolean }

/** A row's role line: its names, in the order the readers come to it, and who reads it last when that is not bash. */
export interface RoleLine { chips: RoleChip[]; reader?: string }

/**
 * The one line of a row's roles (`argument → value of -f · tar reads`): the names in order, an arrow where another reader takes it, and the
 * last reader. Two nodes of one reader on one row (a simple command and its name) are one reader's two names.
 */
export function roleLine(roles: readonly RowRole[]): RoleLine | undefined {
  if (!roles.length) return undefined;
  const chips: RoleChip[] = [];
  for (const [i, r] of roles.entries()) {
    if (!chips.some((c) => c.text === r.chip)) chips.push({ id: r.id, text: r.chip, said: r.said, changes: i > 0 && roles[i - 1].layer !== r.layer });
  }
  // (A language's band is its own name, which is on the line already: the reader is the one before it.)
  const last = [...roles].reverse().find((r) => r.band !== undefined && r.band !== r.chip);
  return { chips, ...(last?.band && last.layer !== 'bash' ? { reader: last.band } : {}) };
}

/** A kind of token for a node with no token (`Kind`, as the rows' colours read it). */
export const nodeKind = (n: Pick<ReadingNode, 'kind'>): Kind => roleOf(n) as Kind;
