// PROTOTYPE (branch prototype/key-points, not for main): "key points first". A salience rule that picks at most three points of a line
// from the data the panel already has (the tokens' kinds, their catalog text ids, their marks, how bash expands a word, the notes' levels
// and ids, the problems of the box), ranked; and a mark per row (key, quiet) for variant B. It writes no new prose: each point says the
// row's or the note's own text, shortened by one rule (`shorten`). Off unless the web page is opened with `?keypoints=a` or `?keypoints=b`.
import type { LineExplanation, Span, Token } from '../analyzer-types';
import type { Lang } from '../i18n';
import type { IssueFilter } from '../document';
import { isListed } from './panelProblems';
import type { BoxProblem } from './panelProblems';
import type { ModelRow, RowModel } from './panelRows';
import { notesByLevel } from './render';
import { tokenAtSpan } from '../tokenmarks';
import { LEVELS } from '../levels';

export type KeyVariant = 'a' | 'b';

/** A key point: the source text it is about, one short sentence (marked text), the row it leads to, and why the rule chose it. */
export interface KeyPoint { code: string; text: string; row?: string; score: number; why: string; note?: string }

export interface KeyPoints {
  variant: KeyVariant;
  label: string;
  points: KeyPoint[];
  /** The candidates that scored as key (>= KEY), before the cap: more than the points shown when they competed. */
  candidates: number;
  /** The notes that are points (`Note.text`): the panel leaves them out of its notes, so that a point is not said twice. */
  usedNotes: string[];
  /** Variant B: rows by path, `key` (a point leads there) or `quiet` (a commonplace row). */
  rowMarks: Record<string, 'key' | 'quiet'>;
  /** Variant A: the fold's control, with how much is behind it. */
  details: { label: string; open: string; rows: number; notes: number; examples: number };
}

/** At or above it, a candidate may be a key point; at or below QUIET, a row is commonplace (variant B draws it quieter). */
const KEY = 30;
const QUIET = 10;
/** The fall-back tier: a command's options, shown only when the line has a single command and nothing at KEY. */
const FALLBACK = 18;

/**
 * The notes (facts of the catalog, by id) that are no problem, by what they are worth as a key point. A note at a level (`info`,
 * `warning`, `error`) that the box does not list scores 90. `errexit-stops-here` is left out: a script with `set -e` says it on almost
 * every line (67 of sample.sh's lines), so it is about the script, not the line.
 */
const NOTE_SCORE: Readonly<Record<string, number>> = {
  'errexit-stops-here': 0,
  'redirections-in-order': 75,
  'read-ifs-separators': 70,
  'heredoc-body-line': 35,
  'heredoc-end-line': 35,
  'yq-flavour': 20,
  'yq-compat': 20,
};
const IDIOM = 55;
const OTHER_NOTE = 45;

/** The catalog's token texts that say a construct does other than it looks (`hole-regex`: a variable read as a regex), or less common syntax. */
const TEXT_SCORE: Readonly<Record<string, number>> = {
  'hole-regex': 72,
  'cmd-prefix-assignment-env': 55,
  herestring: 50,
  'arith-expansion': 45,
  'arith-binary': 40,
  'brace-expansion-words': 70,
  'array-compound': 35,
  'test-binary': 52,
  'test-unary': 52,
  'test-negation': 52,
  'string-double-per-element': 40,
  'string-double-per-element-with-text': 40,
  'wrapped-runs': 20,
  'assignments-several': 10,
  // Structure, not meaning: the parts say it.
  'option-combined-short': 0,
  'word-plain': 0,
  'string-double': 5,
  'string-single': 5,
  'variable-expands': 5,
  'test-last-bracket': 0,
  'comment-plain': 0,
  'shebang-line': 0,
};

/** The rest by the token's kind. */
const KIND_SCORE: Readonly<Record<Token['kind'], number>> = {
  error: 90, expansion: 50, substitution: 45, test: 52, redirect: 40, pattern: 40, assignment: 10,
  option: 20, subcommand: 15, keyword: 12, operator: 8, variable: 8, block: 8, string: 5, number: 5,
  command: 10, builtin: 10, function: 10, alias: 10, argument: 3, comment: 0, shebang: 0,
};

const TEXTS = {
  ja: {
    label: '要点', open: '詳しく',
    details: (rows: number, notes: number, examples: number) => `詳しく（項目 ${rows}${notes ? `・注記 ${notes}` : ''}${examples ? `・例 ${examples}` : ''}）`,
  },
  en: {
    label: 'Key points', open: 'Details',
    details: (rows: number, notes: number, examples: number) => `Details (${rows} rows${notes ? `, ${notes} note${notes === 1 ? '' : 's'}` : ''}${examples ? `, ${examples} example${examples === 1 ? '' : 's'}` : ''})`,
  },
} as const;

interface Candidate { note?: string; token?: Token; span?: Span; spans?: Span[]; code: string; text: string; score: number; why: string; at: number; size: number }

const before = (a: Span['start'], b: Span['start']): boolean => a.line < b.line || (a.line === b.line && a.character < b.character);
const within = (o: Span, i: Span): boolean => !before(i.start, o.start) && !before(o.end, i.end);
const posOf = (s: Span): number => s.start.line * 100000 + s.start.character;
const sizeOf = (s: Span): number => posOf({ start: s.end, end: s.end }) - posOf(s);

/** The source text of a span on the line, else the token's label; long ones cut. */
function sourceOf(span: Span | undefined, line: number, lineText: string, label: string): string {
  const raw = span && span.start.line === line && span.end.line === line ? lineText.slice(span.start.character, span.end.character) : label;
  return raw.length > 42 ? raw.slice(0, 40) + '…' : raw;
}

/** Cuts marked text at `at` characters, never inside a code span. */
function cut(text: string, at: number): string {
  if (text.length <= at) return text;
  let s = text.slice(0, at);
  if ((s.match(/`/g) ?? []).length % 2 === 1) s = s.slice(0, s.lastIndexOf('`'));
  const space = s.search(/\s\S*$/);
  return (space > at / 2 ? s.slice(0, space) : s).replace(/[\s,、:：]+$/, '') + '…';
}

/**
 * The one rule that shortens a row's text for a point. A leading "Kind: " goes when enough follows it (what it does, not what it is;
 * a prefix of at most four words with no code). Then, only if it is still longer than 96 characters: of a text joined with " — ", the
 * part that says bash's reading where `bash` (the last: "target file — Glob pattern …"), else the longest; all after the first
 * sentence; a trailing parenthetical; a cut at 96 characters, never inside a code span.
 */
export function shorten(text: string, bash = false): string {
  let s = text.trim();
  const colon = s.match(/^(?:[\p{L}-]+\s){0,3}[\p{L}-]+[:：]\s*(?=\S)/u);
  if (colon && s.length - colon[0].length > 12) s = s.slice(colon[0].length);
  if (s.length <= 96) return s;
  // (Of the parts, bash's reading, else the one that says the most: "`$1` vs `^a` — left side matches the regex …".)
  const parts = s.split(' — ');
  s = (bash ? parts[parts.length - 1] : [...parts].sort((a, b) => b.length - a.length)[0]).trim();
  const end = s.search(/(?<=[.。])\s|(?<=。)/);
  if (end > 0 && end < s.length - 1) s = s.slice(0, end).trim();
  if (s.length > 96) s = s.replace(/\s*(\([^()]*\)|（[^（）]*）)$/, '');
  return cut(s, 96);
}

interface Walked { t: Token; depth: number; embedded: boolean; up?: Token }

/** Every token of the line, in the order of a walk, with the depth below the line's top, its parent, and whether it lies in an embedded language. */
function walk(items: readonly Token[]): Walked[] {
  const out: Walked[] = [];
  const go = (t: Token, depth: number, embedded: boolean, up?: Token): void => {
    out.push({ t, depth, embedded, up });
    const inside = embedded || t.origin === 'embedded';
    t.children.forEach((c) => go(c, depth + 1, inside, t));
  };
  items.forEach((t) => go(t, 0, false));
  return out;
}

const ownRoots = (t: Token): Token[] => t.children.filter((c) => c.origin === 'embedded');

/**
 * How much a token is worth as a point, and why: the highest of what it holds. A program in an embedded language counts once: where the
 * word holds one root (`s/a/b/` of sed, an awk program), the root (50, unless it is only a literal); where it holds several (a regex, a
 * date format, a mode), the word (28: below KEY, a fall-back), with its own text.
 */
function tokenScore(t: Token, depth: number, embedded: boolean, up: Token | undefined): { score: number; why: string; bash: boolean } {
  if (embedded) return { score: 0, why: 'inside an embedded language', bash: false };
  // (What stands around a command's redirections says only that: the redirection itself is the point.)
  if (t.around) return { score: 0, why: 'around', bash: false };
  const found: { score: number; why: string; bash: boolean }[] = [];
  if (t.marks?.length) found.push({ score: 90, why: `row warning (${t.marks[0].id})`, bash: false });
  if (t.expands === 'split' || t.expands === 'glob') found.push({ score: 72, why: `bash ${t.expands === 'split' ? 'splits and globs' : 'globs'} the word`, bash: true });
  if (t.expands === 'brace') found.push({ score: 70, why: 'brace expansion', bash: true });
  for (const id of t.texts ?? []) if (TEXT_SCORE[id] !== undefined) found.push({ score: TEXT_SCORE[id], why: `text ${id}`, bash: false });
  if (t.origin === 'embedded') {
    const single = !up || ownRoots(up).length === 1;
    found.push(single && t.kind !== 'string' ? { score: 50, why: `program${t.language ? ` in ${t.language}` : ''}`, bash: false } : { score: 0, why: 'part of a program', bash: false });
  }
  if (t.origin !== 'embedded' && ownRoots(t).length > 1) found.push({ score: 28, why: 'word holding a program', bash: false });
  // (A command's option: the fall-back tier; one that takes a value scores a little higher, as it carries data: `-o file`, `-C dir`.)
  if (t.kind === 'option') found.push({ score: t.texts?.includes('option-combined-short') ? 0 : FALLBACK, why: 'option', bash: false });
  if (!found.length) found.push({ score: KIND_SCORE[t.kind] ?? 5, why: `kind ${t.kind}`, bash: false });
  return found.sort((a, b) => b.score - a.score)[0];
}

/** The text of the deepest token of the same range (a word's own reading: `{1..10..3}` is "text to print", its part "expands to …"). */
function deepest(t: Token): Token {
  const same = t.children.find((c) => c.span.start.line === t.span.start.line && c.span.start.character === t.span.start.character
    && c.span.end.line === t.span.end.line && c.span.end.character === t.span.end.character);
  return same ? deepest(same) : t;
}

/**
 * The key points of a line. Problems stay in their box (P7b) and take the first places of three: a line with two problems gets one key
 * point at most. No point is about a row a problem names, nor repeats a code span of "In short", nor is the line's top statement (which
 * "In short" says), nor is about a part that starts on another line (the line where it starts says it). Ranked by score, then from the left.
 */
export function keyPoints(
  ex: LineExplanation, items: readonly Token[], model: RowModel, box: readonly BoxProblem[], shown: IssueFilter, lineText: string, lang: Lang, variant: KeyVariant, apart: number,
): KeyPoints {
  const room = Math.max(0, 3 - box.length);
  const boxRows = new Set(box.flatMap((p) => p.rows));
  const onProblem = (path: string | undefined): boolean => !!path && [...boxRows].some((r) => path === r || path.startsWith(r + '.'));
  const said = new Set([...(ex.sentence ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  const all = walk(items);
  const tokens = all.map((x) => x.t);
  const tops = new Set(items);
  const candidates: Candidate[] = [];
  const here = (s: Span): boolean => s.start.line === ex.line;

  // The notes that are no problem of the box, about a part that starts on this line (or about the line itself).
  for (const n of notesByLevel(ex).filter((n) => !isListed(ex, n, shown))) {
    const code = n.code ?? '';
    const score = n.level !== 'note' ? 90 : NOTE_SCORE[code] ?? (code.startsWith('idiom-') ? IDIOM : OTHER_NOTE);
    if (score <= 0) continue;
    const anchors = ex.anchors?.filter((a) => a.text === n.text) ?? [];
    const span = anchors[0]?.span;
    if (span && !here(span)) continue;
    const token = span ? tokenAtSpan(tokens, span) : undefined;
    const text = n.head ?? shorten(n.body);
    // (A note about the whole statement is named by its label: `read`, not the line again.)
    // (A note about several parts of the line is named by all of them: `> build.log 2>&1`.)
    const mine = anchors.map((a) => a.span).filter(here);
    const from = mine.map((a) => a.start).sort((a, b) => (before(a, b) ? -1 : 1))[0];
    const to = mine.map((a) => a.end).sort((a, b) => (before(a, b) ? 1 : -1))[0];
    const source = token && tops.has(token) ? token.label
      : from && to && mine.every((a) => a.end.line === ex.line) ? sourceOf({ start: from, end: to }, ex.line, lineText, token?.label ?? '')
        : token ? sourceOf(token.span, ex.line, lineText, token.label) : sourceOf(undefined, ex.line, lineText.trim(), lineText.trim());
    candidates.push({ note: n.text, token, span, spans: anchors.map((a) => a.span), code: source, text, score, why: `note ${code} (${n.level})`, at: span ? posOf(span) : 0, size: span ? sizeOf(span) : 1e9 });
  }
  // The tokens below the line's top that start on it.
  for (const { t, depth, embedded, up } of all) {
    if ((depth === 0 && items.length === 1) || !here(t.span)) continue;
    const { score, why, bash } = tokenScore(t, depth, embedded, up);
    const mark = t.marks?.[0];
    // (A word that holds a program says what the command reads it as where its parent is the same word: "search pattern (regex)".)
    const own = why === 'word holding a program' && up && sizeOf(up.span) === sizeOf(t.span) && posOf(up.span) === posOf(t.span) ? up : t;
    const text = mark ? `${LEVELS[mark.level].mark} ${shorten(mark.text)}` : shorten((bash ? deepest(t) : own).explanation, bash);
    let code = t.kind === 'option' ? t.label : sourceOf(t.span, ex.line, lineText, t.label);
    let s = score;
    // (An option with its value: the word after it that the command reads as its value.)
    const value = t.kind === 'option' && s > 0 ? tokens.find((v) => v.valueFor === t.label && before(t.span.start, v.span.start)) : undefined;
    if (value) {
      code = `${t.label} ${sourceOf(value.span, ex.line, lineText, value.label)}`;
      s = Math.max(s, 25);
    }
    candidates.push({ token: t, span: t.span, code, text, score: s, why, at: posOf(t.span), size: sizeOf(t.span) });
  }
  // (A redirection, an argument or an option whose target or value "In short" already names in code says nothing new.)
  const repeats = (c: Candidate): boolean => !!c.code && (said.has(c.code) || (!!c.token && c.token.kind === 'redirect' && said.has(c.code.replace(/^[0-9]*[<>&|]+-?\s*/, ''))));
  // (Nor does a text that only says its code.)
  const empty = (c: Candidate): boolean => !c.text || c.text.replace(/[`"「」]/g, '') === c.code;

  const pathOf = (c: Candidate): string | undefined => (c.token ? model.places.get(c.token) : undefined);
  const commands = all.filter((x) => x.t.frame === 'command').length;
  const floor = commands <= 1 && !candidates.some((c) => c.score >= KEY) ? FALLBACK : KEY;
  const eligible = candidates
    .filter((c) => c.score >= floor && !onProblem(pathOf(c)) && !repeats(c) && !empty(c))
    .sort((a, b) => b.score - a.score || a.size - b.size || a.at - b.at);
  const points: KeyPoint[] = [];
  const picked: Candidate[] = [];
  for (const c of eligible) {
    // (Not twice about the same place, nor about a part of a place already picked or around it, nor about a place a note picked is
    // about, nor the same sentence twice.)
    const places = (x: Candidate): Span[] => x.spans?.length ? x.spans : x.span ? [x.span] : [];
    if (picked.some((p) => places(p).some((ps) => places(c).some((cs) => within(ps, cs) || within(cs, ps))))) continue;
    if (points.some((p) => p.text === c.text)) continue;
    picked.push(c);
    points.push({ code: c.code, text: c.text, row: pathOf(c), score: c.score, why: c.why, ...(c.note ? { note: c.note } : {}) });
  }

  // Variant B: the rows the points lead to, and the commonplace rows (every token on the row scores QUIET or less).
  const best = new Map<string, number>();
  for (const c of candidates) {
    const p = pathOf(c);
    if (p !== undefined && c.token && model.places.get(c.token) === p) best.set(p, Math.max(best.get(p) ?? 0, c.score));
  }
  const rowMarks: Record<string, 'key' | 'quiet'> = {};
  const rowsCount = { n: 0, examples: 0 };
  const visit = (rows: readonly ModelRow[], prefix: string): void => rows.forEach((r, i) => {
    const path = prefix ? `${prefix}.${i}` : `${i}`;
    rowsCount.n++;
    rowsCount.examples += r.examples?.length ?? 0;
    if ((best.get(path) ?? 0) <= QUIET && !r.level && !onProblem(path)) rowMarks[path] = 'quiet';
    visit(r.children, path);
  });
  visit(model.rows, '');
  const competing = points.length;
  points.sort((a, b) => b.score - a.score || (picked.find((c) => c.code === a.code)?.at ?? 0) - (picked.find((c) => c.code === b.code)?.at ?? 0));
  points.splice(room);
  for (const p of points) if (p.row !== undefined) rowMarks[p.row] = 'key';

  const t = TEXTS[lang];
  // (The notes behind the fold: not those the points already say.)
  const notes = notesByLevel(ex).filter((n) => !isListed(ex, n, shown) && !points.some((p) => p.note === n.text)).length;
  // (`apart`: the examples not under a row, the whole line's among them.)
  const examples = rowsCount.examples + apart;
  return {
    variant,
    label: t.label,
    points,
    candidates: competing,
    usedNotes: points.flatMap((p) => (p.note ? [p.note] : [])),
    rowMarks,
    details: { label: t.details(rowsCount.n, notes, examples), open: t.open, rows: rowsCount.n, notes, examples },
  };
}
