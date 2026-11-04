import type { SyntaxErrorWhat } from '../tree';

// What the words of the parser (unbash's, and the adapter's `Missing "…"`) come to in the terms of the language, so that
// nothing past the adapter reads a parser's English.

export function whatOf(message: string): SyntaxErrorWhat {
  // (`x=(1`: to the parser, a glob.)
  if (message.startsWith('unterminated extended glob')) return { kind: 'missing', token: ')' };
  if (message.includes('subscript')) return { kind: 'subscript' };
  const token = /^unexpected (?:token )?'([^]*)'$/.exec(message)?.[1];
  if (token !== undefined) return /^(?:newline|\s*)$/.test(token) ? { kind: 'line-end' } : { kind: 'token', token };
  const missing = /^Missing "([^]*)"$/.exec(message)?.[1] ?? message;
  const after = /^expected command after '(.*)'/.exec(missing)?.[1];
  if (after) return { kind: 'after', token: after };
  const close = /^expected '(.*)' to close/.exec(missing)?.[1];
  if (close) return { kind: 'missing', token: close };
  if (missing === 'command') return { kind: 'command' };
  // (`cat <<`: no delimiter.)
  if (missing === 'word') return { kind: 'target' };
  if (missing === 'heredoc_end') return { kind: 'heredoc' };
  if (missing === 'compound_statement') return { kind: 'body' };
  // (An operand of `[[ ]]` or a glob not closed: its own words, not the shell's.)
  return /\s/.test(missing) ? { kind: 'unreadable' } : { kind: 'missing', token: missing };
}
