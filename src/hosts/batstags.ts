import { fact, type Fact } from '../messages';
import { descendants, type SyntaxTree } from '../syntax/tree';

// The comment commands of bats-preprocess that give tests tags (`# bats test_tags=a,b`, `# bats file_tags=c`). To
// bash they are comments; bats reads every line of the file, even one inside a here-document or a string.

/** `# bats COMMAND`, as bats-preprocess matches it (a CR is taken off the line first). */
const COMMENT_COMMAND = /^[ \t]*#[ \t]*bats[ \t]+(.*)$/;
/**
 * A letter or a digit, `[[:alnum:]]` as glibc reads it in a UTF-8 locale: a character with the Unicode property
 * Alphabetic (letters, letter numbers like `Ⅳ`, and the marks and symbols that are letters, like `ⓐ`), or a decimal
 * digit of any script. Not `²` or `½` (other numbers). (glibc 2.39 differs only in characters newer than its tables,
 * and in a few combining letters, such as U+0363.)
 */
export const ALNUM = '\\p{Alphabetic}\\p{Nd}';
/** One tag: `[-_:[:alnum:]]+`. */
const TAG = `[-_:${ALNUM}]+`;
/** A list of tags: separated by commas with optional spaces (only spaces, not tabs), or empty. */
const TAGS = new RegExp(`^ *(${TAG})?( *, *${TAG})* *$`, 'u');

export interface TagComment {
  scope: 'test' | 'file';
  /** The tags in the list, trimmed (none when the list is empty or not valid). */
  tags: string[];
  /** Why bats refuses the list (and with it the whole file): no match at all, or an empty tag (a leading comma, only spaces). */
  invalid?: 'syntax' | 'empty';
}

/** The tag command on `line` of a bats file, if it is one. */
export function tagComment(line: string): TagComment | undefined {
  const m = COMMENT_COMMAND.exec(line.replace(/\r/g, ''));
  const command = m?.[1];
  const scope = command?.startsWith('test_tags=') ? 'test' : command?.startsWith('file_tags=') ? 'file' : undefined;
  if (!command || !scope) return undefined;
  const list = command.slice('test_tags='.length);
  if (!TAGS.test(list)) return { scope, tags: [], invalid: 'syntax' };
  // (`IFS=, read -ra`: no element for an empty list; spaces are no separators, so ` ` is one tag, empty once trimmed.)
  const tags = list === '' ? [] : list.split(',').map((t) => t.trim());
  return tags.includes('') ? { scope, tags: [], invalid: 'empty' } : { scope, tags };
}

/**
 * `name() { # @test`: the other form of a test (BATS_TEST_PATTERN_COMMENT), which bats matches anywhere on the line:
 * what comes before the name (1), the name (2), blanks and parentheses, both optional (3), and the brace and the
 * comment. bats replaces the whole line with the definition of the test, `test_name() {`.
 */
export const COMMENT_TEST = /^(.*?)([^ \t()]+)([ \t]*\(?\)?)[ \t]+\{[ \t]+#[ \t]*@test[ \t]*$/;

/** Where bash reads a line as text, not as a comment: in a string or a here-document (not in a `$( )` there). */
function textAt(tree: SyntaxTree, row: number, column: number): 'string' | 'heredoc' | undefined {
  const types = ['string', 'raw_string', 'ansi_c_string', 'translated_string', 'heredoc_body', 'command_substitution', 'process_substitution'];
  const at = (p: { row: number; column: number }) => p.row - row || p.column - column;
  const around = descendants(tree.root, types).filter((n) => at(n.startPosition) <= 0 && at(n.endPosition) > 0);
  // (The innermost: the one that starts last. No two of these start at the same place.)
  const inner = around.sort((a, b) => a.startIndex - b.startIndex).pop();
  if (!inner || inner.type.endsWith('_substitution')) return undefined;
  return inner.type === 'heredoc_body' ? 'heredoc' : 'string';
}

/**
 * The facts of the comment commands of bats on `line` (the text of row `row`, as the tree of the extracted text has it):
 * what a tag command gives which tests, or why bats refuses it; and, on a test marked `# @test` (`test`), the text
 * before the name that bats drops.
 */
export function batsCommentFacts(tree: SyntaxTree, line: string, row: number, test: boolean, lang: 'ja' | 'en'): Fact[] {
  const c = tagComment(line);
  const out: Fact[] = [];
  if (c) out.push(c.invalid ? fact(lang, 'bats-tags-invalid', { scope: c.scope, why: c.invalid }) : fact(lang, 'bats-tags', { scope: c.scope, tags: c.tags, text: textAt(tree, row, line.indexOf('#')) }));
  const dropped = test ? droppedBefore(line) : undefined;
  if (dropped) out.push(fact(lang, 'bats-test-line-dropped', { dropped }));
  return out;
}

/** The text before the name of a function marked `# @test` that bats drops (none: blanks, or the keyword `function`). */
export function droppedBefore(line: string): string | undefined {
  const before = COMMENT_TEST.exec(line.replace(/\r$/, ''))?.[1] ?? '';
  return /^[ \t]*(function[ \t]+)?$/.test(before) ? undefined : before.trim();
}
