// The panel's box "Problems on this line" (docs/design/panel-redesign.md, P7b), as data: each problem of the line with its
// level's mark and word, its headline, the fixes to copy (each the whole line fixed), what "more" holds (the whole text), and the rows it links to;
// then a pointer to each problem on the line of a construct around this one. media/panel.js only draws it.
import type { LineExplanation, NoteAnchor, Token } from '../analyzer-types';
import { type DocumentIssue, type IssueFilter, noteAnchors, pitfallOf } from '../document';
import type { Lang } from '../i18n';
import { LEVELS, type NoteLevel, levelWord, NOT_READ_WORD, problemLevel, SEVERITIES, type ProblemSeverity } from '../levels';
import { isProblemNote, type Note, problemText } from '../messages';
import type { ProblemNote } from '../messages-levels';
import { isNotRead } from '../messages-unread';
import { leastOf, mostOf } from '../lists';
import { type Changed, fixedLines, withRewritesOf } from '../rewrite';
import type { SyntaxTree } from '../syntax/tree';
import { tokenAtSpan } from '../tokenmarks';
import { type NoteBasis } from './tokenRow';
import { noteBasis, noteRefs, notesByLevel } from './render';
import { ui } from './texts';

/** A problem of the line, in the box. */
export interface BoxProblem {
  /** Its level's look, from the level table (src/levels.ts). */
  level: NoteLevel; className: string; icon: string;
  /** The level's word, the one a note's own label has ("Error", "Pitfall", "Caveat"), without its colon. */
  word: string;
  /** One sentence with what happens (`Note.head`). */
  head: string;
  /** "More": the note's own word ("Pitfall:", "Portability:"), its whole text, and what it cites and rests on. */
  label: string; body: string; refs: readonly string[]; basis?: NoteBasis;
  /** "More": the same text as the problem's in the Problems lists (`DocumentIssue.message`). */
  text: string;
  /** Each fix it suggests, the first the one it recommends (`NoteAnchor.rewrite`, P3), under the headline. */
  fixes: readonly BoxFix[];
  /** The rows of the line it is about, by their paths in the list (`RowModel.places`, src/ui/panelRows.ts). */
  rows: readonly string[];
}

/**
 * A fix in the box: the whole lines it is about with its edits made, and where its edits put their text, to mark them
 * (`fixedLines`, src/rewrite.ts); for a rewrite with no edits, its code alone, with nothing marked. `why`: a few words
 * on how it stops, where that is not plain (`Rewrite.sourcedOrRun`; marked text). What its Copy copies is `text`.
 */
export interface BoxFix { text: string; changed: readonly Changed[]; why?: string }

/** A problem on the line of a construct around this one (the `for` of a loop body), which a click goes to. */
export interface ProblemPointer {
  level: ProblemSeverity; className: string; icon: string;
  /** The level's word and the line: "Pitfall on line 3". */
  where: string;
  /** Its tooltip: "Go to line 3". */
  title: string;
  head: string;
  /** Its place, 0-based. */
  line: number; column: number; endColumn: number;
}

/**
 * Whether a note is one of the problems the editors list: a problem note (`isProblemNote`) that the settings, `# bash-explainer
 * disable=` comments and `diagnostics.ignore` let through (`shown`, from `issueFilter`: the rule the Problems lists use
 * too), on the line it is about (the line of one of its anchors, or the line itself). The box needs no list of problems to
 * match (the web page's comes a moment after the line), and a problem that was silenced is in the box, the strip and the
 * pointers alike: in none, and a plain note.
 */
export function isListed(ex: Pick<LineExplanation, 'line' | 'anchors'>, n: Note, shown: IssueFilter): n is ProblemNote {
  if (!isProblemNote(n)) return false;
  // (As `noteIssues` does: a note on nodes is judged on their lines only, not on the cursor's own; one on no node, on its line.)
  const at = noteAnchors(ex, n).map((a) => a.span.start.line);
  return (at.length ? at : [ex.line]).some((startLine) => shown({ code: n.code, startLine, ...pitfallOf(n) }));
}

/**
 * The problems of the line, errors first; the notes that are no problems (or were silenced) stay notes. `tree`: the
 * document's text, where the rewrites' edits are (none in a test of the line alone: each fix is then its code).
 */
export function boxProblems(ex: LineExplanation, places: ReadonlyMap<Token, string>, lang: Lang, shown: IssueFilter, tree?: Pick<SyntaxTree, 'text' | 'carriageReturns'>): BoxProblem[] {
  const tokens = [...places.keys()];
  const t = ui[lang].panel.problems;
  /**
   * The fixes of a note about `anchors`: each rewrite with its edits at every place, as a fact's (`withRewritesOf`: a
   * note about two places, `cp $a b; cp $a c`, fixes both), over the lines of them all.
   */
  const fixes = (anchors: readonly NoteAnchor[]): BoxFix[] => {
    if (!anchors.length) return [];
    const first = leastOf(anchors.map((a) => a.span.start.line));
    const last = mostOf(anchors.map((a) => a.span.end.line));
    return (withRewritesOf(anchors[0], anchors).rewrite ?? []).map((r) => ({
      ...(tree && fixedLines(tree.text, r, first, last, tree.carriageReturns)) || { text: r.code, changed: [] },
      ...(r.sourcedOrRun ? { why: t.sourcedOrRun } : {}),
    }));
  };
  return notesByLevel(ex).filter((n) => isListed(ex, n, shown)).map((n) => {
    const { className, codicon } = LEVELS[n.level];
    const anchors = noteAnchors(ex, n);
    const rows = anchors.map((a) => tokenAtSpan(tokens, a.span)).filter((t) => t !== undefined).map((t) => places.get(t)!);
    const basis = noteBasis(ex, n.text, lang);
    return {
      level: n.level, className, icon: codicon, word: isNotRead(n.code) ? NOT_READ_WORD[lang] : levelWord(n.level, lang),
      // (Every note that can be a problem has its headline: the catalog's type, and test/problem-heads.test.ts on the corpus.)
      head: n.head,
      label: n.label, body: n.body, refs: noteRefs(ex, n.text) ?? [], ...(basis ? { basis } : {}), text: problemText(n, lang),
      fixes: fixes(anchors),
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
    const { className, codicon } = problemLevel(i.severity);
    const n = String(i.startLine + 1);
    return {
      level: i.severity, className, icon: codicon,
      where: t.onLine.replace('{word}', isNotRead(i.code) ? NOT_READ_WORD[lang] : levelWord(SEVERITIES[i.severity].level, lang)).replace('{n}', n), title: t.toLine.replace('{n}', n), head: i.head,
      line: i.startLine, column: i.startCol, endColumn: i.endCol,
    };
  });
}
