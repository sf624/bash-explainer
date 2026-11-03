// The panel's box "Problems on this line" (docs/design/panel-redesign.md, P7b), as data: each problem of the line with its
// level's mark and word, its headline, what "more" holds (the whole text and the fixes to copy), and the rows it links to;
// then a pointer to each problem on the line of a construct around this one. media/panel.js only draws it.
import type { LineExplanation, Token } from '../analyzer-types';
import type { DocumentIssue } from '../document';
import type { Lang } from '../i18n';
import { LEVELS, type NoteLevel, problemLevel, type ProblemSeverity } from '../levels';
import { isProblemNote, problemText } from '../messages';
import { tokenAtSpan } from '../tokenmarks';
import { type NoteBasis } from './tokenRow';
import { noteBasis, noteRefs, notesByLevel } from './render';
import { ui } from './texts';

/** A problem of the line, in the box. */
export interface BoxProblem {
  /** Its level's look, from the level table (src/levels.ts). */
  level: NoteLevel; className: string; icon: string;
  /** The level's word: "Error", 「警告」. */
  word: string;
  /** One sentence with what happens (`Note.head`). */
  head: string;
  /** "More": the note's own word ("Pitfall:", "Portability:"), its whole text, and what it cites and rests on. */
  label: string; body: string; refs: readonly string[]; basis?: NoteBasis;
  /** "More": the same text as the problem's in the Problems lists (`DocumentIssue.message`). */
  text: string;
  /** "More": the code of each fix it suggests, the first the one it recommends (`NoteAnchor.rewrite`, P3). */
  fixes: readonly string[];
  /** The rows of the line it is about, by their paths in the list (`0.1`: the second part of the first row). */
  rows: readonly string[];
}

/** A problem on the line of a construct around this one (the `for` of a loop body), which a click goes to. */
export interface ProblemPointer {
  level: ProblemSeverity; className: string; icon: string;
  /** The level's word and the line: "Warning on line 3". */
  where: string;
  /** Its tooltip: "Go to line 3". */
  title: string;
  head: string;
  /** Its place, 0-based. */
  line: number; column: number; endColumn: number;
}

/** The path of each token, as the list numbers its rows (media/panel.js `item`). */
function tokenPaths(items: readonly Token[], prefix = ''): Map<Token, string> {
  return new Map(items.flatMap((t, i) => [[t, `${prefix}${i}`] as const, ...tokenPaths(t.children, `${prefix}${i}.`)]));
}

/** The problems of the line, errors first; the notes that are no problems stay notes (`isProblemNote`). */
export function boxProblems(ex: LineExplanation, items: readonly Token[], lang: Lang): BoxProblem[] {
  const paths = tokenPaths(items);
  const tokens = [...paths.keys()];
  return notesByLevel(ex).filter(isProblemNote).map((n) => {
    const { className, codicon, name } = LEVELS[n.level];
    const anchors = ex.anchors?.filter((a) => a.text === n.text) ?? [];
    const rows = anchors.map((a) => tokenAtSpan(tokens, a.span)).filter((t) => t !== undefined).map((t) => paths.get(t)!);
    const basis = noteBasis(ex, n.text, lang);
    return {
      level: n.level, className, icon: codicon, word: name[lang],
      // (Every note that can be a problem has its headline: the catalog's type, and test/problem-heads.test.ts on the corpus.)
      head: n.head!,
      label: n.label, body: n.body, refs: noteRefs(ex, n.text) ?? [], ...(basis ? { basis } : {}), text: problemText(n, lang),
      fixes: [...new Set(anchors.flatMap((a) => a.rewrite ?? []).map((r) => r.code))],
      rows: [...new Set(rows)],
    };
  });
}

/**
 * The problems on the lines of the constructs around the line (`LineExplanation.context`), read from the document's
 * problems, cached per tree (`noteIssues`): none explains another line. One the line says too is in its box already.
 */
export function problemsAround(ex: Pick<LineExplanation, 'line' | 'context'>, issues: readonly DocumentIssue[], own: readonly BoxProblem[], lang: Lang): ProblemPointer[] {
  const lines = new Set(ex.context.map((c) => c.line));
  lines.delete(ex.line);
  const said = new Set(own.map((p) => p.text));
  const t = ui[lang].panel.problems;
  return issues.filter((i) => lines.has(i.startLine) && !said.has(i.message)).map((i) => {
    const { className, codicon, name } = problemLevel(i.severity);
    const n = String(i.startLine + 1);
    return {
      level: i.severity, className, icon: codicon,
      where: t.onLine.replace('{word}', name[lang]).replace('{n}', n), title: t.toLine.replace('{n}', n), head: i.head,
      line: i.startLine, column: i.startCol, endColumn: i.endCol,
    };
  });
}
