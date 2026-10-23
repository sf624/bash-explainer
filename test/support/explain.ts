import { Analyzer, ExplainOptions, LineExplanation, Token } from '../../src/analyzer';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';

const parser = createUnbashParser();

/** A token and everything below it, in document order, for every token of a list. Works for the embedded tokens too. */
export function allTokens<T extends { children: T[] }>(tokens: readonly T[]): T[] {
  return tokens.flatMap((t) => [t, ...allTokens(t.children)]);
}

/** The explanation of line `line` (0-based) of `src`; `opts` are the analyzer's options (pitfalls, host…). */
export function explain(src: string, line = 0, lang: 'ja' | 'en' = 'en', opts?: ExplainOptions): LineExplanation {
  return new Analyzer(lang).explainLine(parser.parse(src), line, undefined, opts);
}

/** The tokens of line `line` of `src`, flattened. */
export function tokensOf(src: string, line = 0, lang: 'ja' | 'en' = 'en', opts?: ExplainOptions): Token[] {
  return allTokens(explain(src, line, lang, opts).items);
}
