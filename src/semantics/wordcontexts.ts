// The contexts of a word (manual 3.5, with the exceptions of 3.2.5.2, 3.4, 3.6, 4.2, 6.5 and 6.7): which expansions a word
// undergoes where it is. The word model (src/semantics/words.ts) reads them, and gives them again.
import { field, fields, nameText, type SyntaxNode } from '../syntax/tree';

/** Where a word is: its context decides which expansions it undergoes. */
export type WordContext =
  | 'command-name' | 'argument' | 'assignment-value' | 'declaration-argument' | 'array-element' | 'array-element-assignment' | 'array-element-assoc'
  | 'cond-operand' | 'cond-pattern' | 'cond-regex'                    // [[ ]]
  | 'case-word' | 'case-pattern' | 'for-list'
  | 'redirect-target' | 'heredoc-body' | 'herestring'
  | 'arith' | 'subscript-indexed' | 'subscript-assoc'                // $(( )), (( )), a[i] (arithmetic), m[k] (a key)
  | 'declaration-assignment'                                         // `alias a=$v`: a word of `alias` that is an assignment
  | 'param-word' | 'param-pattern';                                  // ${x:-word}, ${x#pattern}

/** One row of the context table. */
export interface ContextRule {
  brace: boolean;
  /**
   * `start`: a tilde prefix at the start; `assignment`: also after each `:` (and the start is after `=`);
   * `argument`: at the start, and in bash mode after the `=` and the `:` of a word that looks like an assignment;
   * `declaration`: as `argument`, in POSIX mode too (a declaration's assignment); `element`: in bash mode, after the
   * `=` of an element with a subscript and after each `:` (none in POSIX mode).
   */
  tilde: 'none' | 'start' | 'assignment' | 'argument' | 'declaration' | 'element';
  /** Word splitting and pathname expansion of the unquoted parts (`inherit`: as the expansion around it). */
  split: boolean | 'inherit';
  glob: boolean | 'inherit';
  /** Unquoted parts are a pattern (`case`, `[[ == ]]`, `${x#p}`) or a regex (`[[ =~ ]]`). */
  match?: 'pattern' | 'regex';
  /** How many fields it may become: `one-or-error`, a redirection target (else "ambiguous redirect"). */
  fields: 'many' | 'one' | 'one-or-error';
  /** In POSIX mode, neither split nor globbed (a redirection target of a non-interactive shell). */
  posixLiteral?: boolean;
  /** The section of the Bash manual. */
  manual: string;
}

const ARGUMENT: ContextRule = { brace: true, tilde: 'argument', split: true, glob: true, fields: 'many', manual: '3.5' };
const ONE = { brace: false, split: false, glob: false, fields: 'one' } as const;

/** The context table (manual 3.5, with the exceptions of 3.2.5.2, 3.4, 3.6, 4.2, 6.5 and 6.7). */
export const CONTEXTS: Readonly<Record<WordContext, ContextRule>> = {
  'command-name': { ...ARGUMENT, manual: '3.7.1' },
  argument: ARGUMENT,
  'for-list': { ...ARGUMENT, manual: '3.2.5.1' },
  // (`a=(x=~/y)` keeps its tilde: only an argument that looks like an assignment has one after `=`.)
  'array-element': { ...ARGUMENT, tilde: 'start', manual: '6.7' },
  'array-element-assignment': { brace: true, tilde: 'element', split: false, glob: false, fields: 'many', manual: '6.7' }, // `a=([0]=$x [1]=*)` (bash 5.2 brace-expands `[2]={a,b}` to the values `[2]=a`, `[2]=b`)
  'array-element-assoc': { ...ONE, tilde: 'none', manual: '6.7' }, // `m=(k {a,b} $x *)` in an associative array (bash 5.3 expands a tilde there, 5.2 not)
  // A declaration builtin's word that looks like an assignment is one (the parser gives it as such); the others are arguments.
  'declaration-argument': { ...ARGUMENT, manual: '4.2' },
  'assignment-value': { ...ONE, tilde: 'assignment', manual: '3.4' },
  'cond-operand': { ...ONE, tilde: 'argument', manual: '3.2.5.2' },
  'cond-pattern': { ...ONE, tilde: 'argument', match: 'pattern', manual: '3.2.5.2' },
  'cond-regex': { ...ONE, tilde: 'argument', match: 'regex', manual: '3.2.5.2' },
  'case-word': { ...ONE, tilde: 'argument', manual: '3.2.5.2' },
  'case-pattern': { ...ONE, tilde: 'argument', match: 'pattern', manual: '3.2.5.2' },
  'redirect-target': { brace: true, tilde: 'argument', split: true, glob: true, fields: 'one-or-error', posixLiteral: true, manual: '3.6' },
  // (bash expands it as the value of an assignment: `x:~` has a tilde after the `:`, `a=~` none after the `=`; in POSIX mode too.)
  herestring: { ...ONE, tilde: 'assignment', manual: '3.6.7' },
  'heredoc-body': { ...ONE, tilde: 'none', manual: '3.6.6' },
  arith: { ...ONE, tilde: 'none', manual: '6.5' },
  'subscript-indexed': { ...ONE, tilde: 'none', manual: '6.7' },
  'subscript-assoc': { ...ONE, tilde: 'none', manual: '6.7' },
  // (bash brace-expands it as a word: `alias z={a,b}` is `alias z=a z=b`.)
  'declaration-assignment': { ...ONE, brace: true, tilde: 'declaration', manual: '4.2' },
  'param-word': { brace: false, tilde: 'start', split: 'inherit', glob: 'inherit', fields: 'many', manual: '3.5.3' },
  'param-pattern': { ...ONE, tilde: 'start', match: 'pattern', manual: '3.5.3' },
};

/**
 * The word `word` (`wordOf`), where it is an assignment given to a declaration builtin (`local x=$1`, `export y="$HOME"`,
 * `declare`, `readonly`, `typeset`; not behind `command`). This is the one place that says how bash reads such a word
 * (manual 4.2, `declare`; 3.5.1). Bash brace-expands the whole word first (`braces`: whether that step applies; a brace
 * of the value is one of this word, `declarationOf`). Where braces change the word, each word they give is an argument
 * like any other (split, globbed, a tilde only at its start: `local x={a,b}$z` with `z='p  q'` declares `x` and `q`;
 * `export X=~{a,b}` gives `X=~b`): undefined, as for any other word, and `assignmentHead` starts it. Else bash
 * expands it as an assignment: its name and `=` (or `+=`) as written (`head`), then its value (`value`; none for
 * `x=`), expanded as an assignment's value is (`assignment-value`: tildes after `=` and `:`, not split nor globbed).
 * `unread` for a subscript in the name, which bash expands too (`a[$i]=1`), for an array (`b=(1 2)`), which the
 * builtin reads itself, and where it is not known whether braces apply. Undefined for any other word.
 */
export function declaredWord(word: { nodes: readonly SyntaxNode[]; context: WordContext } | undefined, braces: boolean | 'unknown'): { head: string; value?: SyntaxNode } | 'unread' | undefined {
  const head = assignmentHead(word);
  if (head === undefined || head === 'unread') return head;
  if (braces === true) return undefined;
  if (braces === 'unknown') return 'unread';
  const v = field(word!.nodes[0], 'value');
  return { head, ...(v ? { value: v } : {}) };
}

/**
 * The head of a declaration's assignment word (`declaredWord`): its name and `=` (or `+=`) as written; `unread` for a
 * subscript in the name or an array value, undefined for any other word.
 */
export function assignmentHead(word: { nodes: readonly SyntaxNode[]; context: WordContext } | undefined): string | 'unread' | undefined {
  const a = word?.nodes[0];
  if (word?.context !== 'declaration-argument' || a!.type !== 'variable_assignment') return undefined;
  const name = field(a!, 'name')!;
  const v = field(a!, 'value');
  if (name.type !== 'variable_name' || v?.type === 'array') return 'unread';
  return nameText(name) + a!.text.slice(name.endIndex - a!.startIndex, (v?.startIndex ?? a!.endIndex) - a!.startIndex);
}

/**
 * The parts of the word of `nodes` that bash reads: a declaration's assignment word (`x={a,b}$z`, `declaredWord`) has
 * a head of plain text, and the parts of its value (none for `x=`); any other word, its nodes.
 */
export const ownParts = (nodes: readonly SyntaxNode[]): readonly SyntaxNode[] => (nodes[0].type === 'variable_assignment' ? fields(nodes[0], 'value') : nodes);

/**
 * The declaration's assignment word whose value is the word `word` (`{a,b}` of `local x={a,b}`), in the context
 * bash reads it in (`declaredWord`): it brace-expands the whole word, so a brace of the value is one of that word.
 * Undefined for any other word.
 */
export function declarationOf(word: { nodes: readonly SyntaxNode[]; context: WordContext }): { nodes: SyntaxNode[]; context: WordContext } | undefined {
  const a = word.nodes[0].parent!;
  return word.context === 'assignment-value' && a.field === 'argument' ? { nodes: [a], context: 'declaration-argument' } : undefined;
}
