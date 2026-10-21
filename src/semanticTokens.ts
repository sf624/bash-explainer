// Semantic tokens (LSP 3.16, and VS Code's DocumentSemanticTokensProvider) from src/highlight.ts.
// Pure: the VS Code provider (src/ui/semanticTokens.ts) and the Language Server (cli/lsp.ts) send what
// this encodes. Editors draw the tokens over their own grammar (TextMate in VS Code), so the kinds map to
// the standard token types and modifiers, which every theme colours.
import type { ShellDocument } from './document';
import { documentHighlight, HighlightKind, LineSpan } from './highlight';

export const TOKEN_TYPES = ['comment', 'keyword', 'function', 'parameter', 'string', 'variable', 'operator', 'number', 'regexp'] as const;
export const TOKEN_MODIFIERS = ['declaration', 'modification', 'defaultLibrary'] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];
export type TokenModifier = (typeof TOKEN_MODIFIERS)[number];

/** The legend sent once to the editor: token types and modifiers, by index. */
export const LEGEND: { tokenTypes: string[]; tokenModifiers: string[] } = { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [...TOKEN_MODIFIERS] };

/**
 * Each kind as a standard type and modifiers. The colours come from the TextMate scopes that package.json
 * (`semanticTokenScopes`) gives each type: scopes of VS Code's shell grammar, so that the default themes show the
 * colours of web/editor-colors.ts. A heredoc's delimiter is a string and a substitution's delimiters are a variable,
 * as there. An `error` gets no token: the grammar's colour stays, and the diagnostics say what is wrong.
 */
export const TOKEN_OF: Record<HighlightKind, [TokenType, ...TokenModifier[]] | null> = {
  comment: ['comment'],
  keyword: ['keyword'],
  builtin: ['function', 'defaultLibrary'],
  command: ['function'],
  function: ['function'],
  functionName: ['function', 'declaration'],
  option: ['parameter'],
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
      modifiers.reduce((bits, m) => bits | (1 << TOKEN_MODIFIERS.indexOf(m)), 0));
    line = s.line;
    start = s.from;
  }
  return data;
}

/** The semantic tokens of a document; with `lines`, only those on these lines (inclusive), as a range request asks. */
export function semanticTokens(doc: ShellDocument, lines?: { from: number; to: number }): number[] {
  const spans = documentHighlight(doc);
  return encodeTokens(lines ? spans.filter((s) => s.line >= lines.from && s.line <= lines.to) : spans);
}
