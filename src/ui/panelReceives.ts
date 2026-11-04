// What the switch "What the program receives" adds to the panel's rows (docs/design/panel-redesign.md, P9), and the marks of what no
// program receives or POSIX sh lacks: pure functions over the rows of src/ui/panelRows.ts, from the data of the explanation (`ArgvLine`, src/argvline.ts;
// `NotPosix`, src/dialect.ts). media/panel.js draws them and decides none of it.
import type { ArgvLine, ArgvWord, NotPosix, Span } from '../analyzer-types';
import type { Lang } from '../i18n';
import { shownWord } from '../messages';
import { keyOf } from '../reading';
import { ui } from './texts';

/** A piece of a word a program receives: text as `shownWord` shows it (`ends`: its marks of a space), or a value known only when the line runs (`hole`: marked text). */
export type ChipPart = { text: string; ends: readonly [number, number] } | { hole: string };

/** A word a program receives. `asWritten`: the very text of the script (tinted); `many`: it stands for any number of words, or for not exactly one. */
export interface ReceivedChip { parts: ChipPart[]; asWritten?: true; many?: true }

/**
 * The line under a command with the switch on: what comes before the words, the words, and where bash stops before the program runs. A word of
 * the script that gives no word has no chip: the program does not see it.
 */
export interface ReceivesLine { span: Span; lead: string; chips: ReceivedChip[]; more?: string; fails?: string }

/** How many words a line shows: a brace expansion can give thousands, and a screen says what they are with far fewer. */
const CHIPS_SHOWN = 30;

/** A word as a chip. */
function chipOf(w: ArgvWord): ReceivedChip {
  // (An empty text beside a placeholder is no part: only a word that is all empty shows as empty.)
  const parts = w.parts.filter((p) => w.parts.length === 1 || !('text' in p) || p.text).map((p): ChipPart => ('text' in p ? shownWord(p.text) : { hole: p.label }));
  return { parts, ...(w.asWritten ? { asWritten: true as const } : {}), ...(w.count ? { many: true as const } : {}) };
}

/** What a word of the script leaves for the program: nothing where it gives no word. */
const gives = (w: ArgvWord): boolean => w.parts.length > 0;

/** The chips of a line, and how many more it leaves out. */
function shownChips(chips: ReceivedChip[], lang: Lang): Pick<ReceivesLine, 'chips' | 'more'> {
  if (chips.length <= CHIPS_SHOWN) return { chips };
  return { chips: chips.slice(0, CHIPS_SHOWN), more: ui[lang].panel.receives.more.replace('{n}', String(chips.length - CHIPS_SHOWN)) };
}

/** The line a simple command shows: its program's words with the name first; a builtin's or a function's without it, as it runs inside the shell and has no `argv[0]`. */
export function receivesLine(l: ArgvLine, lang: Lang, shell: string): ReceivesLine {
  const t = ui[lang].panel.receives;
  const fails = l.fails ? { fails: t.fails.replace('{error}', () => t.errors[l.fails!.error]) } : {};
  if (l.inside) {
    const chips = l.words.slice(1).filter(gives).map(chipOf);
    const says = t.inside[l.inside];
    return { span: l.span, lead: (chips.length ? says.some : says.none).replace('{shell}', () => shell), ...shownChips(chips, lang), ...fails };
  }
  const chips = l.words.filter(gives).map(chipOf);
  return { span: l.span, lead: chips.length === 0 ? t.nothing : chips.length === 1 && !chips[0].many ? t.onlyName : t.program, ...shownChips(chips, lang), ...fails };
}

/** What a row needs to be marked. */
export interface Markable {
  span: Span;
  kind: string;
  comesAt: 1 | 2;
  frame?: string;
  receives?: unknown;
  received?: unknown;
  /** A token of a string read as a script: that shell's reading, not this one's. */
  inScript?: true;
  handled?: true;
  notPosix?: string[];
  children: this[];
}

/** Rows bash does not read as a part of a command at all. */
const NO_CONSTRUCT: ReadonlySet<string> = new Set(['comment', 'shebang', 'error']);

const sameEnd = (a: Span, b: Span): boolean => a.end.line === b.end.line && a.end.character === b.end.character;

/**
 * The mark "handled by bash", by one rule: once per construct that no program receives (not in any `ArgvLine`, not a command name), on its
 * first row. A construct is a compound command, a pipeline or a list; a command with no name, as nothing runs; what bash takes out of a simple
 * command (`ArgvLine.removed`); and, at the top of a line of a construct over several lines, the rows of that construct on the line (`then`,
 * `done < f`), one run of rows. What lies inside one is no construct of its own, nor is the word of a command, however bash expands it; a command
 * in a substitution is. A string another shell reads is that shell's reading.
 */
export function markHandled<R extends Markable>(rows: readonly R[], lines: readonly ArgvLine[]): void {
  // (By where it starts: the range of a here-document's redirection ends with its body, its row's with `<<E`. A row of no frame that starts there is that part.)
  const placeOf = (s: Span): string => `${s.start.line}:${s.start.character}`;
  const removed = new Set(lines.flatMap((l) => l.removed.map((r) => placeOf(r.span))));
  const isRemoved = (r: R, up?: R): boolean => !r.frame && !up?.handled && removed.has(placeOf(r.span));
  const inside = (r: R): void => r.children.forEach((c) => visit(c, r));
  const visit = (r: R, up: R | undefined): void => {
    if (r.inScript) return;
    const samePipeline = up?.handled && !up.frame && r.frame === 'group' && sameEnd(up.span, r.span);
    if (((r.frame === 'command' && !r.receives) || r.frame === 'compound' || r.frame === 'group') && !samePipeline) r.handled = true;
    else if (isRemoved(r, up)) r.handled = true;
    inside(r);
  };
  // (A depth only adds: where a run has rows of depth 1, the first of those has the mark at both depths.)
  let run: R[] = [];
  const endRun = (): void => {
    const first = run.find((r) => r.comesAt === 1) ?? run[0];
    if (first) first.handled = true;
    run = [];
  };
  for (const r of rows) {
    if (r.frame || r.inScript || r.received || isRemoved(r) || NO_CONSTRUCT.has(r.kind)) endRun();
    else run.push(r);
  }
  endRun();
  for (const r of rows) {
    if (r.frame || r.inScript || isRemoved(r)) visit(r, undefined);
    else inside(r);
  }
}

const within = (outer: Span, inner: Span): boolean => (outer.start.line < inner.start.line || (outer.start.line === inner.start.line && outer.start.character <= inner.start.character))
  && (outer.end.line > inner.end.line || (outer.end.line === inner.end.line && outer.end.character >= inner.end.character));

/** The row of a construct: the outermost of its range, else the deepest around it, else the outermost that starts where it does (a compound command's first line). */
function rowOfConstruct<R extends Markable>(rows: readonly R[], span: Span): R | undefined {
  const all = (rs: readonly R[]): R[] => rs.flatMap((r) => [r, ...all(r.children)]);
  const every = all(rows);
  const key = keyOf(span);
  const starts = (r: R): boolean => r.span.start.line === span.start.line && r.span.start.character === span.start.character;
  return every.find((r) => keyOf(r.span) === key) ?? every.filter((r) => within(r.span, span)).pop() ?? every.find(starts);
}

/** The mark "not in POSIX sh": on the row of each construct of the line that uses a feature POSIX sh has not. It says what the problems of a sh script say of it. */
export function markNotPosix<R extends Markable>(rows: readonly R[], found: readonly NotPosix[]): void {
  for (const { span, says } of found) {
    const row = rowOfConstruct(rows, span);
    if (row && !row.notPosix?.includes(says)) row.notPosix = [...row.notPosix ?? [], says];
  }
}
