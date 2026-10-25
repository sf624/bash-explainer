import { Lang, Text } from './i18n';
import { idiomsFound } from './idioms';
import { pitfallFindings } from './pitfalls';
import { wordFindings } from './wordfacts';
import { assignmentsOnly, field, fields } from './syntax/tree';
import type { SyntaxNode, SyntaxTree } from './syntax/tree';
import { lookupCommand } from './dict/aliases';
import { pictureNote } from './ctlchars';
import { dialectFound, Shell } from './dialect';
import { splitElement } from './staticword';
import { explainExpansion } from './expansion-tokens';
import { keywords } from './dict/syntax';
import { explainCommandSubstitution, explainProcessSubstitution } from './substitution-tokens';
import { shellState } from './semantics/state';
import type { NestedScript } from './semantics/nested';
import { statusModel } from './semantics/status';
import { nodeSections } from './refs';
import type { Fact } from './messages';

export { EXAMPLE_KINDS } from './analyzer-types';
export type { ContextEntry, Example, ExampleKind, ExampleSection, ExplainOptions, Kind, LineExplanation, Pos, ScriptProcess, Span, Token, TokenOrigin } from './analyzer-types';
import type { ExplainOptions, Kind, LineExplanation, Token } from './analyzer-types';
import { readingTree } from './reading';
import { claim, dropLabelEcho } from './tokenmarks';
import { type Explainer, LineExplainer, type Walk } from './explain/context';
import { has, intersects, isBlockLike, onLine, skeletal, summaryOf } from './explain/nodes';
import { resolve } from './explain/reads';
import { groupSubshell } from './explain/where';
import { postfixStatusNote } from './explain/status';
import {
  arithChildren, arithNumber, arrayElement, braceWord, casePattern, commaNote, concatenationNote, globToken,
  simpleExpansion, string, subscript, valueNote, variable, word, wrapNote,
} from './explain/words';
import { fileRedirect, heredoc, herestring, redirected } from './explain/redirections';
import { binary, regexNode, test, unary } from './explain/tests';
import { titledExamples, wantsExample } from './explain/examples';
import { ansiCChildren } from './explain/embedded';
import { assignment, assignments } from './explain/assignments';
import { command, timeStatement } from './explain/commands';
import { anon, block, caseItem, caseStatement, comment, coprocStatement, forStatement, functionDef, list, missingKeyword, pipeline, whileStatement } from './explain/compound';
import { continuationNotes, extglobPitfalls, pipeSubshellPitfalls, statusNotes, unmatchedGlobPitfalls } from './explain/line-notes';

export { isBlockLike, summaryOf };

export class Analyzer {
  /** The kind of string this analyzer explains, when it explains a string read as a script (`nestedLine` of the walk). */
  private nested: NestedScript['kind'] | undefined;
  /** What the current `explainLine` call reads and collects (src/explain/context.ts); made new by each call, so nothing of another line is left. */
  private cx!: Explainer;
  /**
   * The walk the context's line filter calls back, and the explanation of a line of a string read as a script
   * (src/explain/scripts.ts): a new `Analyzer`, which explains it as a script of its own.
   */
  private readonly walk: Walk = {
    explain: (n) => this.explain(n),
    flatten: (n) => this.flatten(n),
    nestedLine: (tree, line, shell, kind, opts) => {
      const inner = new Analyzer(this.lang);
      inner.nested = kind;
      return inner.explainLine(tree, line, shell, opts);
    },
  };

  constructor(private lang: Lang) {}

  explainLine(tree: SyntaxTree, line: number, shell?: Shell, opts: ExplainOptions = {}): LineExplanation {
    const root = tree.root;
    // (`#!/bin/bash --posix` starts bash in POSIX mode: the state reads it.)
    const state = shellState(tree, shell, { host: opts.hostCommands });
    const cx = new LineExplainer(this.lang, { opts, root, line, shell, state, status: statusModel(state, shell), nested: this.nested }, this.walk);
    this.cx = cx;
    const items = this.flatten(root);
    const statements = onLine(root, ['command', 'redirected_statement', 'list', 'pipeline', 'extended_test', 'while_statement'], line)
      .filter((n) => intersects(n, line));
    const notes = [...continuationNotes(this.cx, root, line, items), ...cx.anchored(dialectFound(tree, line, shell ?? 'bash', this.lang, opts.bashVersion)), ...new Set(cx.notes), ...statusNotes(this.cx, line, false), ...(cx.opts.idioms === false ? [] : cx.anchored(idiomsFound(statements, this.lang, cx.status))), ...(cx.opts.pitfalls === false ? [] : cx.anchored(pitfallFindings(root, this.lang, line, line, cx.state, cx.shell))), ...new Set(wordFindings(root, this.lang, cx.state, cx.shell, line, line).flatMap((w) => this.say(w.fact, w.node))), ...extglobPitfalls(this.cx, root, line), ...unmatchedGlobPitfalls(this.cx, root, line), ...pipeSubshellPitfalls(this.cx, root, line), ...statusNotes(this.cx, line, true)];
    // (A fact said twice, or left out with the pitfalls, is listed once, or not.)
    const facts = cx.facts.filter((f, i, all) => notes.includes(f.text) && all.findIndex((g) => g.text === f.text) === i);
    const result: LineExplanation = {
      line,
      ...(shell && shell !== 'bash' ? { shell } : {}),
      items,
      context: cx.context,
      notes,
      ...(facts.length ? { facts } : {}),
      ...(cx.anchors.some((a) => notes.includes(a.text)) ? { anchors: cx.anchors.filter((a) => notes.includes(a.text)) } : {}),
      // Each -e of sed explains the same combined script, at the command: drop repeated examples.
      examples: titledExamples(this.cx, root, line, cx.examples)
        .filter((e) => wantsExample(this.cx, e))
        .filter((e, i, all) => all.findIndex((x) => JSON.stringify(x) === JSON.stringify(e)) === i)
        .map((e) => {
          const note = pictureNote(e.sections.flatMap((sec) => sec.lines), (ja, en) => this.s(ja, en));
          return note ? { ...e, note } : e;
        }),
      summary: items.filter((t) => t.kind !== 'comment' || items.length === 1).map(summaryOf).join(' ; '),
    };
    cx.end();
    // The summary above was made with the full explanations; the tree drops what its labels already say.
    for (const item of items) dropLabelEcho(claim(item, 'shell'));
    const resolveAt = (name: string, w: SyntaxNode) => resolve(this.cx, name, w, { quoted: w.type !== 'word' || w.text !== name });
    if (opts.reading) result.reading = readingTree(tree, items, { lang: this.lang, resolve: resolveAt });
    return result;
  }

  // ---------------------------------------------------------------- helpers

  private say(f: Fact, at: SyntaxNode): string[] {
    return this.cx.say(f, at);
  }

  private s(ja: string, en: string): string {
    return this.cx.s(ja, en);
  }

  private t(text: Text): string {
    return this.cx.t(text);
  }

  private lineRef(n: SyntaxNode): string {
    return this.cx.lineRef(n);
  }

  private tok(n: SyntaxNode, kind: Kind, explanation: string, children?: Token[], label?: string): Token {
    return this.cx.tok(n, kind, explanation, children, label);
  }

  private sub(n: SyntaxNode | null | undefined): Token[] {
    return this.cx.sub(n);
  }

  private subs(nodes: readonly (SyntaxNode | null | undefined)[]): Token[] {
    return this.cx.subs(nodes);
  }

  /** Expose the parts of a block that are on the current line, recording the block as context. */
  private flatten(n: SyntaxNode): Token[] {
    const label = this.contextLabel(n);
    if (label) this.cx.enclosing({ label, line: n.startPosition.row });
    const out: Token[] = [];
    // The patterns of a case branch go on after a `\` at the end of a line (`a|\` then `b)`): the later lines have
    // patterns, `|` and `)` of the branch, which are not words, pipes and the end of a subshell.
    const patterns = n.type === 'case_item' ? fields(n, 'value') : [];
    for (const c of n.children) {
      if (!this.cx.onLine(c)) continue;
      if (has(patterns, c)) out.push(casePattern(this.cx, c));
      else if (patterns.length && (c.type === '|' || c.type === ')' || c.type === '(')) continue;
      else if (c.named) out.push(...this.sub(c));
      else {
        const k = anon(this.cx, c);
        if (k) out.push(k);
      }
    }
    return out;
  }

  private contextLabel(n: SyntaxNode): string | undefined {
    switch (n.type) {
      case 'for_statement':
      case 'select_statement':
      case 'c_style_for_statement':
        return this.s('for ループ', 'for loop');
      case 'while_statement':
        return n.children[0].type === 'until' ? this.s('until ループ', 'until loop') : this.s('while ループ', 'while loop');
      case 'if_statement':
        return this.s('if 文', 'if statement');
      case 'elif_clause':
        return 'elif';
      case 'else_clause':
        return 'else';
      case 'case_statement':
        return this.s('case 文', 'case statement');
      case 'case_item': {
        const pats = fields(n, 'value').map((c) => c.text);
        return this.s(`case 分岐 \`${pats.join('|')})\``, `case branch \`${pats.join('|')})\``);
      }
      case 'function_definition':
        return this.s(`関数 \`${field(n, 'name')?.text}\``, `function \`${field(n, 'name')?.text}\``);
      case 'arithmetic_command':
        return this.s('(( )) 算術評価', '(( )) arithmetic');
      case 'compound_statement':
        return this.s('{ } グループ', '{ } group');
      case 'subshell':
        return this.s('( ) サブシェル', '( ) subshell');
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------- dispatch

  /** A node's token, with the sections of the manual it is about when it has none of its own. */
  private explain(n: SyntaxNode): Token {
    const t = claim(this.explainNode(n), 'shell');
    const refs = t.refs ?? nodeSections(n);
    if (refs) t.refs = refs;
    return t;
  }

  private explainNode(n: SyntaxNode): Token {
    switch (n.type) {
      case 'comment': return comment(this.cx, n);
      case 'command': return assignmentsOnly(n) ? assignments(this.cx, n) : command(this.cx, n);
      case 'time_statement': return timeStatement(this.cx, n);
      case 'variable_assignment': return skeletal(assignment(this.cx, n), n, true);
      case 'pipeline': return pipeline(this.cx, n);
      case 'list': return list(this.cx, n);
      case 'redirected_statement': return redirected(this.cx, n);
      case 'file_redirect': return fileRedirect(this.cx, n);
      case 'heredoc_redirect': return heredoc(this.cx, n);
      case 'herestring_redirect': return herestring(this.cx, n);
      case 'negated_command': return skeletal(this.tok(n, 'operator', this.t(keywords[n.namedChildren[0]?.type === 'pipeline' ? '! pipeline' : '!']), this.subs(n.namedChildren)), n);
      case 'extended_test': case 'arithmetic_command':
        if (n.type === 'arithmetic_command') postfixStatusNote(this.cx, n);
        return test(this.cx, n);
      case 'unary_expression': return unary(this.cx, n);
      case 'binary_expression': return binary(this.cx, n);
      case 'ternary_expression': return this.tok(n, 'expansion', this.s('三項演算子: 条件 ? 真のときの値 : 偽のときの値', 'Ternary: cond ? if-true : if-false'), this.subs(n.namedChildren));
      case 'postfix_expression': return this.tok(n, 'operator', this.s(`算術: \`${n.text}\`（${n.text.endsWith('++') ? '1 増やす' : '1 減らす'}）`, `Arithmetic: \`${n.text}\` (${n.text.endsWith('++') ? 'increment' : 'decrement'})`));
      case 'parenthesized_expression': return this.tok(n, 'operator', this.s('括弧でまとめた式', 'Parenthesized expression'), this.subs(n.namedChildren));
      case 'expansion': return explainExpansion(this.cx, n);
      case 'simple_expansion': return simpleExpansion(this.cx, n);
      case 'command_substitution': return explainCommandSubstitution(this.cx, n);
      case 'process_substitution': return explainProcessSubstitution(this.cx, n);
      case 'arithmetic_expansion': return this.tok(n, 'substitution', this.s('算術展開: 中の式を整数として計算した結果に置き換える', 'Arithmetic expansion: replaced by the integer result of the expression')
        + (n.text.startsWith('$[') ? this.s('。`$[…]` は古い書き方（廃止予定）で、`$((…))` と同じ意味', '. `$[…]` is the obsolete form of `$((…))`') : '') + commaNote(this.cx, n) + wrapNote(this.cx, n), arithChildren(this.cx, n));
      case 'string': return string(this.cx, n);
      case 'raw_string': return this.tok(n, 'string', this.s('シングルクォート文字列: 中身は一切展開されず、そのままの文字列になる', 'Single-quoted string: taken literally, nothing is expanded'));
      case 'ansi_c_string': return this.tok(n, 'string', this.s('`$\'…\'` 文字列: `\\n` `\\t` などのエスケープを解釈した文字列になる', '`$\'…\'` string: backslash escapes such as `\\n` are interpreted') + (/\\/.test(n.text) ? valueNote(this.cx, n) : ''), ansiCChildren(this.cx, n));
      // (The model has the `$` and the string in one node; the string takes the `$` in.)
      case 'translated_string': return string(this.cx, n.namedChildren[0]);
      case 'concatenation': if (n.parent!.type === 'array' && splitElement(n.text)) return arrayElement(this.cx, n); return braceWord(this.cx, n) ?? this.tok(n, 'argument', concatenationNote(this.cx, n) + valueNote(this.cx, n), this.subs(n.namedChildren));
      case 'word': return braceWord(this.cx, n) ?? word(this.cx, n);
      case 'number': return arithNumber(this.cx, n) ?? this.tok(n, 'number', this.s('数値', 'Number'));
      // (`{1..x}` is not a brace expansion: it stays a word.)
      case 'brace_expression': return braceWord(this.cx, n) ?? word(this.cx, n);
      case 'array': return this.tok(n, 'expansion', this.s('配列: `( )` 内の要素から配列を作る', 'Array: built from the elements inside `( )`'), this.subs(n.namedChildren));
      case 'subscript': return subscript(this.cx, n);
      case 'regex': return regexNode(this.cx, n);
      case 'extglob_pattern': return globToken(this.cx, n, 'value');
      case 'variable_name': return arithNumber(this.cx, n) ?? variable(this.cx, n.text, n);
      case 'subshell': return block(this.cx, n, 'block', this.s('サブシェル: `( )` 内を別プロセスで実行する。中での変数変更や cd は外に影響しない', 'Subshell: runs `( )` in a child process; variable changes and cd do not leak out'));
      case 'compound_statement': {
        const why = groupSubshell(this.cx, n);
        return block(this.cx, n, 'block', why
          ? this.s(`コマンドグループ: \`{ }\` 内のコマンドをまとめて実行する。${why.ja}ので、グループはサブシェルで実行され、中で変えた変数は外に残らない`, `Command group: runs the commands in \`{ }\` together. ${why.en}, so the group is a subshell: variables set inside are gone afterwards`)
          : this.s('コマンドグループ: `{ }` 内のコマンドを現在のシェルでまとめて実行する', 'Command group: runs the commands in `{ }` in the current shell'));
      }
      case 'do_group': return block(this.cx, n, 'block', this.s('ループ本体: `do` から `done` までを繰り返し実行する', 'Loop body: the commands between `do` and `done`'));
      case 'function_definition': return functionDef(this.cx, n);
      case 'for_statement': case 'select_statement': return missingKeyword(this.cx, n, forStatement(this.cx, n));
      case 'c_style_for_statement': return block(this.cx, n, 'keyword', this.s('C 言語風 for ループ: `((初期化; 条件; 更新))` で回数を制御して繰り返す', 'C-style for loop: `((init; condition; update))`') + this.lineRef(n));
      case 'while_statement': return missingKeyword(this.cx, n, whileStatement(this.cx, n));
      case 'if_statement': return missingKeyword(this.cx, n, block(this.cx, n, 'keyword', this.s('if 文: 条件コマンドの終了ステータスが 0（成功）なら then 以下を実行', 'if statement: runs the `then` branch if the condition exits 0') + this.lineRef(n)));
      case 'elif_clause': return missingKeyword(this.cx, n, block(this.cx, n, 'keyword', this.t(keywords.elif)));
      case 'else_clause': return block(this.cx, n, 'keyword', this.t(keywords.else));
      case 'coproc_statement': return coprocStatement(this.cx, n);
      case 'case_statement': return caseStatement(this.cx, n);
      case 'case_item': return caseItem(this.cx, n);
      case 'error': return this.tok(n, 'error', this.s('構文エラー: この部分は正しく解析できませんでした（クォートや括弧の閉じ忘れなど）', 'Syntax error: this part could not be parsed (unclosed quote or bracket?)'), this.subs(n.namedChildren));
      // Every type the adapters build is explained above or by its parent. This is for a type added to the model
      // before the analyzer learns it: callers explain keywords and operators themselves, and any other node is shown as itself.
      /* c8 ignore start */
      default:
        if (!n.named) return anon(this.cx, n) ?? this.tok(n, 'operator', n.type);
        return this.tok(n, 'argument', n.type, this.subs(n.namedChildren));
      /* c8 ignore stop */
    }
  }
}

export { lookupCommand };
