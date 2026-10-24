// Semantic tokens (LSP 3.16, and VS Code's DocumentSemanticTokensProvider) from src/highlight.ts.
// Pure: the VS Code provider (src/ui/semanticTokens.ts) and the Language Server (cli/lsp.ts) send what
// this encodes. Editors draw the tokens over their own grammar (TextMate in VS Code), so the kinds map to
// the standard token types and modifiers, which every theme colours; `exported` and `unquoted` are our own modifiers
// (package.json `semanticTokenModifiers`), which themes ignore unless they style it.
import type { ShellDocument } from './document';
import { documentHighlight, type DocumentHighlightOptions, HighlightKind, LineSpan } from './highlight';

export const TOKEN_TYPES = ['comment', 'keyword', 'function', 'parameter', 'string', 'variable', 'operator', 'number', 'regexp', 'macro'] as const;
export const TOKEN_MODIFIERS = ['declaration', 'modification', 'defaultLibrary', 'readonly', 'exported', 'unquoted'] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];
export type TokenModifier = (typeof TOKEN_MODIFIERS)[number];

/** The legend sent once to the editor: token types and modifiers, by index. */
export const LEGEND: { tokenTypes: string[]; tokenModifiers: string[] } = { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [...TOKEN_MODIFIERS] };

/**
 * Each kind as a standard type and modifiers. The colours come from the TextMate scopes that package.json
 * (`semanticTokenScopes`) gives each type: scopes of VS Code's shell grammar, so that the user's theme colours them
 * as it colours that grammar. A heredoc's delimiter is a string and a substitution's delimiters are a variable. An alias is a
 * `macro` (a name replaced by text). A word that only looks like an option is an `unquoted` `string` (our own modifier), which
 * package.json maps to the grammar's scope of a plain argument, so that it looks like the other words after the command. An `error` gets no token: the grammar's colour stays, and the diagnostics say what is wrong. The modifiers of
 * a span (`readonly`, `exported`) are added to those of its kind.
 */
export const TOKEN_OF: Record<HighlightKind, [TokenType, ...TokenModifier[]] | null> = {
  comment: ['comment'],
  keyword: ['keyword'],
  builtin: ['function', 'defaultLibrary'],
  command: ['function'],
  function: ['function'],
  alias: ['macro'],
  functionName: ['function', 'declaration'],
  option: ['parameter'],
  argument: ['string', 'unquoted'],
  string: ['string'],
  heredoc: ['string'],
  heredocDelimiter: ['string'],
  variable: ['variable'],
  assignment: ['variable', 'modification'],
  substitution: ['variable'],
  number: ['number'],
  operator: ['operator'],
  redirect: ['operator'],
  glob: ['regexp'],
  error: null,
};

/**
 * Spans in lines (sorted, not overlapping) as the integers of semantic tokens: for each token, its line and
 * start relative to the previous token, its length, its type and a bit set of its modifiers.
 */
export function encodeTokens(spans: readonly LineSpan[]): number[] {
  const data: number[] = [];
  let line = 0;
  let start = 0;
  for (const s of spans) {
    const token = TOKEN_OF[s.kind];
    if (!token) continue;
    const [type, ...modifiers] = token;
    data.push(s.line - line, s.line === line ? s.from - start : s.from, s.to - s.from, TOKEN_TYPES.indexOf(type),
      [...modifiers, ...(s.modifiers ?? [])].reduce((bits, m) => bits | (1 << TOKEN_MODIFIERS.indexOf(m)), 0));
    line = s.line;
    start = s.from;
  }
  return data;
}

/**
 * The semantic tokens of a document (none over host syntax that the extraction inserted), read with `shells` as the
 * explanations read it; with `lines`, only those on these lines (inclusive), as a range request asks, and the models
 * are read on those lines only.
 */
export function semanticTokens(doc: ShellDocument, opts: Pick<DocumentHighlightOptions, 'shells' | 'lines'> = {}): number[] {
  const { lines } = opts;
  const spans = documentHighlight(doc, { ...opts, skipInserted: true });
  return encodeTokens(lines ? spans.filter((s) => s.line >= lines.from && s.line <= lines.to) : spans);
}

/** The tokens of encoded integers, as lines, columns and lengths (for tests and tools). */
export function decodeTokens(data: readonly number[]): { line: number; start: number; length: number; type: TokenType; modifiers: TokenModifier[] }[] {
  const out = [];
  let line = 0;
  let start = 0;
  for (let i = 0; i < data.length; i += 5) {
    line += data[i];
    start = data[i] ? data[i + 1] : start + data[i + 1];
    out.push({ line, start, length: data[i + 2], type: TOKEN_TYPES[data[i + 3]], modifiers: TOKEN_MODIFIERS.filter((_, b) => data[i + 4] & (1 << b)) });
  }
  return out;
}
