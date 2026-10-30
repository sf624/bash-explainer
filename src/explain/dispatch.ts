// The walk over a line's nodes (docs/design/analyzer.md, step 9): the explanation of each node by its type, which
// calls the module of the part of bash it is (src/explain/words.ts, commands.ts, compound.ts…), and the parts of a
// block on the line explained, with the construct around them (`flatten`). A case calls one function, or combines
// two (`braceWord(cx, n) ?? word(cx, n)`); the dispatch makes a text only for a node the parser could not read (an
// `error` node) and for a type no module knows. `flatten` decides which parts of a `case` branch it skips (`|`, `)`,
// `(` after a patterns line) and calls `casePattern` for the patterns. The context calls the walk back (`cx.explain`,
// `cx.sub`): src/analyzer.ts gives it these two.
import type { Token } from '../analyzer-types';
import { explainExpansion } from '../expansion-tokens';
import { nodeSections } from '../refs';
import { explainCommandSubstitution, explainProcessSubstitution } from '../substitution-tokens';
import { assignmentsOnly, childrenOnRows, fields, nameText, type SyntaxNode, withLists } from '../syntax/tree';
import { claim } from '../tokenmarks';
import { assignment, assignments } from './assignments';
import { command, timeStatement } from './commands';
import {
  anon, caseItem, caseStatement, comment, contextLabel, coprocStatement, cStyleFor, doGroup, elifClause, elseClause, forStatement, functionDef,
  group, ifStatement, missingKeyword, negated, pipeline, subshell, whileStatement,
} from './compound';
import type { Explainer } from './context';
import { ansiCString } from './embedded';
import { andOrList, commandList } from './lists';
import { has, skeletal } from './nodes';
import { fileRedirect, heredoc, herestring, redirected } from './redirections';
import { withValue } from './values';
import { arithmeticCommand, binary, parenthesized, postfix, regexNode, ternary, test, unary } from './tests';
import {
  arithmeticExpansion, arithNumber, array, braceWord, casePattern, concatenation, globToken, number, rawString, simpleExpansion, string,
  subscript, variable, word,
} from './words';

/** A node's token, with the sections of the manual it is about when it has none of its own. */
export function explain(cx: Explainer, n: SyntaxNode): Token {
  const t = claim(explainNode(cx, n), 'shell');
  if (n.type === 'simple_expansion' || n.type === 'expansion') withValue(cx, n, t);
  const refs = t.refs ?? nodeSections(n);
  if (refs?.length) t.refs = refs;
  // (A token that cites nothing: braces that do not expand here.)
  else delete t.refs;
  return t;
}

function explainNode(cx: Explainer, n: SyntaxNode): Token {
  switch (n.type) {
    case 'comment': return comment(cx, n);
    case 'command': return assignmentsOnly(n) ? assignments(cx, n) : command(cx, n);
    case 'time_statement': return timeStatement(cx, n);
    case 'variable_assignment': return skeletal(assignment(cx, n), n, true);
    case 'pipeline': return pipeline(cx, n);
    case 'command_list': return commandList(cx, n);
    case 'list': return andOrList(cx, n, (c) => anon(cx, c));
    case 'redirected_statement': return redirected(cx, n);
    case 'file_redirect': return fileRedirect(cx, n);
    case 'heredoc_redirect': return heredoc(cx, n);
    case 'herestring_redirect': return herestring(cx, n);
    case 'negated_command': return negated(cx, n);
    case 'extended_test': return test(cx, n);
    case 'arithmetic_command': return arithmeticCommand(cx, n);
    case 'unary_expression': return unary(cx, n);
    case 'binary_expression': return binary(cx, n);
    case 'ternary_expression': return ternary(cx, n);
    case 'postfix_expression': return postfix(cx, n);
    case 'parenthesized_expression': return parenthesized(cx, n);
    case 'expansion': return explainExpansion(cx, n);
    case 'simple_expansion': return simpleExpansion(cx, n);
    case 'command_substitution': return explainCommandSubstitution(cx, n);
    case 'process_substitution': return explainProcessSubstitution(cx, n);
    case 'arithmetic_expansion': return arithmeticExpansion(cx, n);
    case 'string': return string(cx, n);
    case 'raw_string': return rawString(cx, n);
    case 'ansi_c_string': return ansiCString(cx, n);
    // (The model has the `$` and the string in one node; the string takes the `$` in.)
    case 'translated_string': return string(cx, n.namedChildren[0]);
    case 'concatenation': return concatenation(cx, n);
    case 'word': return word(cx, n);
    case 'number': return number(cx, n);
    // (Where braces do not expand, as in dash or `x={a,b}`, they are text: a word.)
    case 'brace_expression': {
      const t = braceWord(cx, n) ?? word(cx, n);
      return t.refs ? t : { ...t, refs: [] };
    }
    case 'array': return array(cx, n);
    case 'subscript': return subscript(cx, n);
    case 'regex': return regexNode(cx, n);
    case 'extglob_pattern': return globToken(cx, n, 'value');
    case 'variable_name': return arithNumber(cx, n) ?? variable(cx, nameText(n), n);
    case 'subshell': return subshell(cx, n);
    case 'compound_statement': return group(cx, n);
    case 'do_group': return doGroup(cx, n);
    case 'function_definition': return functionDef(cx, n);
    case 'for_statement': case 'select_statement': return missingKeyword(cx, n, forStatement(cx, n));
    case 'c_style_for_statement': return cStyleFor(cx, n);
    case 'while_statement': return missingKeyword(cx, n, whileStatement(cx, n));
    case 'if_statement': return missingKeyword(cx, n, ifStatement(cx, n));
    case 'elif_clause': return missingKeyword(cx, n, elifClause(cx, n));
    case 'else_clause': return elseClause(cx, n);
    case 'coproc_statement': return coprocStatement(cx, n);
    case 'case_statement': return caseStatement(cx, n);
    case 'case_item': return caseItem(cx, n);
    case 'error': return cx.tok(n, 'error', cx.s('構文エラー: この部分は正しく解析できませんでした（クォートや括弧の閉じ忘れなど）', 'Syntax error: this part could not be parsed (unclosed quote or bracket?)'), cx.subs(n.namedChildren));
    // Every type the adapters build is explained above or by its parent. This is for a type added to the model
    // before the analyzer learns it: callers explain keywords and operators themselves, and any other node is shown as itself.
    /* c8 ignore start */
    default:
      if (!n.named) return anon(cx, n) ?? cx.tok(n, 'operator', n.type);
      return cx.tok(n, 'argument', n.type, cx.subs(n.namedChildren));
    /* c8 ignore stop */
  }
}

/** Expose the parts of a block that are on the current line, recording the block as context. */
export function flatten(cx: Explainer, n: SyntaxNode): Token[] {
  const label = contextLabel(cx, n);
  if (label) cx.enclosing({ label, line: n.startPosition.row });
  const out: Token[] = [];
  // The patterns of a case branch go on after a `\` at the end of a line (`a|\` then `b)`): the later lines have
  // patterns, `|` and `)` of the branch, which are not words, pipes and the end of a subshell.
  const patterns = n.type === 'case_item' ? fields(n, 'value') : [];
  // (Only the children that may lie on the line: the statements of a long script are not each looked at. A line is
  // flattened only while there is one: the root of `explainLine`, and a block the line is inside, `Explainer.sub`.
  // The lists of commands are among them, as one node each: `withLists` gives the same array every time.)
  for (const c of childrenOnRows(withLists(n), cx.line!, cx.line!)) {
    if (!cx.onLine(c)) continue;
    if (has(patterns, c)) out.push(casePattern(cx, c));
    else if (patterns.length && (c.type === '|' || c.type === ')' || c.type === '(')) continue;
    else if (c.named) out.push(...cx.sub(c));
    else {
      const k = anon(cx, c);
      if (k) out.push(k);
    }
  }
  return out;
}
