import { fact, type Fact } from '../messages';

// The comment commands of bats-preprocess that give tests tags (`# bats test_tags=a,b`, `# bats file_tags=c`). To
// bash they are comments; bats reads every line of the file, even one inside a here-document or a string.

/** `# bats COMMAND`, as bats-preprocess matches it (a CR is taken off the line first). */
const COMMENT_COMMAND = /^[ \t]*#[ \t]*bats[ \t]+(.*)$/;
/** One tag: `[-_:[:alnum:]]+` (in a UTF-8 locale, a letter is any letter). */
const TAG = '[-_:\\p{L}\\p{N}]+';
/** A list of tags: separated by commas with optional spaces (only spaces, not tabs), or empty. */
const TAGS = new RegExp(`^ *(${TAG})?( *, *${TAG})* *$`, 'u');

export interface TagComment {
  scope: 'test' | 'file';
  /** The tags in the list, trimmed (none when the list is empty or not valid). */
  tags: string[];
  /** Why bats refuses the list (and with it the whole file): no match at all, or a leading comma (an empty tag). */
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
  // (`IFS=, read -ra`: no element for an empty list or after a last comma.)
  const tags = list.trim() ? list.split(',').map((t) => t.trim()) : [];
  return tags.includes('') ? { scope, tags: [], invalid: 'empty' } : { scope, tags };
}

/** `name() { # @test`, or `function name { # @test`: the other form of a test (BATS_TEST_PATTERN_COMMENT). */
export const COMMENT_TEST = /^([ \t]*)((?:function[ \t]+)?)([^ \t()]+)((?:[ \t]*\(\))?)([ \t]+\{[ \t]+#[ \t]*@test[ \t]*)$/;

/** The facts of a tag command on `line`: what it gives which tests, or why bats refuses it. */
export function tagFacts(line: string, lang: 'ja' | 'en'): Fact[] {
  const c = tagComment(line);
  if (!c) return [];
  return [c.invalid ? fact(lang, 'bats-tags-invalid', { scope: c.scope, why: c.invalid }) : fact(lang, 'bats-tags', { scope: c.scope, tags: c.tags })];
}
