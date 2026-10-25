import { Lang, Text, tx } from './i18n';
import { idiomsFound, simulateRedirects } from './idioms';
import { pitfallFindings } from './pitfalls';
import { wordFindings } from './wordfacts';
import { spanOf } from './noteanchors';
import { ancestor, assignmentsOnly, descendants, field, fields, redirectionsOf, token, wordsText } from './syntax/tree';
import type { NodeType, SyntaxNode, SyntaxTree } from './syntax/tree';
import { distroAliases } from './dict/distroAliases';
import { commands } from './dict/commands';
import { lookupCommand } from './dict/aliases';
import { ArgRole, ArgvParse, interpret } from './argv/interpret';
import type { CommandSpec } from './argv/spec';
import { argWord } from './argv/words';
import { hasExtglob, isGlob } from './examples/shellwords';
import { pictureNote } from './ctlchars';
import { commandTest } from './testexpr';
import { judgeYq, yqNotes } from './embedded/yq';
import { yqSpecsOf } from './dict/yq';
import { customCommandSpec } from './dict/custom';
import { DIRECTIVE } from './directives';
import { dialectFound, Shell } from './dialect';
import { isPlainWord, literalContent, splitElement, staticWordValue } from './staticword';
import { explainExpansion } from './expansion-tokens';
import {
  fdName, keywords, listOps,
} from './dict/syntax';
import { bracket as bracketLabel, labelText, shorten } from './label';
import { explainCommandSubstitution, explainProcessSubstitution, returnInSubstitution, scopeOf } from './substitution-tokens';
import { inFunction, STATEMENTS, shellEffectOf } from './semantics/env';
import { docLine, option, shellState } from './semantics/state';
import { lostVariable } from './semantics/pipeline';
import type { NestedScript } from './semantics/nested';
import { assignmentsOf, definitionFails, type Missed, type NameResolution, testSpecOf } from './semantics/names';
import { nameInfo } from './namefacts';
import { statusModel, type StatusModel } from './semantics/status';
import { statusFacts, type StatusFact } from './statusfacts';
import { anonSections, builtinSections, nodeSections } from './refs';
import { type Fact, fact, factOf, MESSAGES } from './messages';

/**
 * The status facts of a script, by line, computed once per status model and tree (both languages): the strings `eval`
 * runs are in the model of the script around them, in trees of their own.
 */
const statusFactCache = new WeakMap<StatusModel, WeakMap<SyntaxNode, Map<number, StatusFact[]>>>();

export { EXAMPLE_KINDS } from './analyzer-types';
export type { ContextEntry, Example, ExampleKind, ExampleSection, ExplainOptions, Kind, LineExplanation, Pos, ScriptProcess, Span, Token, TokenOrigin } from './analyzer-types';
import type { ExplainOptions, Kind, LineExplanation, Span, Token } from './analyzer-types';
import { readingTree } from './reading';
import { claim, dropLabelEcho, readByCommand } from './tokenmarks';
import { type Explainer, LineExplainer, type Walk } from './explain/context';
import { has, intersects, isBlockLike, onLine, same, skeletal, sortTokens, summaryOf } from './explain/nodes';
import { globOff, hostCommand, NO_SPEC, resolve, shoptAt, specFor, unquotedWord } from './explain/reads';
import { groupSubshell, shellEffectNote } from './explain/where';
import { postfixStatusNote, statusRangeNote } from './explain/status';
import {
  arithChildren, arithNumber, arrayElement, braceWord, braceWords, casePattern, commaNote, concatenationNote, globToken,
  shown, simpleExpansion, string, subscript, valueNote, variable, word, wrapNote,
} from './explain/words';
import { fileRedirect, heredoc, herestring, redirected, redirectInfo, redirectParts } from './explain/redirections';
import { binary, regexNode, test, unary } from './explain/tests';
import { caseExample, commandExampleFor, pipelineExample, titledExamples, unreadStdin, wantsExample, wordExample } from './explain/examples';
import { ansiCChildren } from './explain/embedded';
import { assignment, assignments } from './explain/assignments';
import { bashTest, readArgs, testArgs } from './explain/argv';

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
    const notes = [...this.notes(root, line, items), ...cx.anchored(dialectFound(tree, line, shell ?? 'bash', this.lang, opts.bashVersion)), ...new Set(cx.notes), ...this.statusNotes(line, false), ...(cx.opts.idioms === false ? [] : cx.anchored(idiomsFound(statements, this.lang, cx.status))), ...(cx.opts.pitfalls === false ? [] : cx.anchored(pitfallFindings(root, this.lang, line, line, cx.state, cx.shell))), ...new Set(wordFindings(root, this.lang, cx.state, cx.shell, line, line).flatMap((w) => this.say(w.fact, w.node))), ...this.extglobPitfalls(root, line), ...this.unmatchedGlobPitfalls(root, line), ...this.pipeSubshellPitfalls(root, line), ...this.statusNotes(line, true)];
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
        const k = this.anon(c);
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

  /** Token for an anonymous node (keyword or operator), or undefined for plain punctuation. */
  private anon(n: SyntaxNode): Token | undefined {
    if (n.type === '{' && n.parent?.type === 'compound_statement' && groupSubshell(this.cx, n.parent)) {
      return { ...this.tok(n, 'keyword', this.s('コマンドグループの開始（ここではサブシェルで実行される）', 'Start of a command group (here it runs in a subshell)')), refs: ['3.2.5.3', '3.7.3'] };
    }
    const k = keywords[n.type];
    const op = listOps[n.type];
    const t = k ? this.tok(n, 'keyword', this.t(k)) : op ? this.tok(n, 'operator', this.t(op)) : undefined;
    const refs = t && anonSections(n);
    if (refs) t.refs = refs;
    return t;
  }

  private anonOnLine(nodes: SyntaxNode[]): Token[] {
    return nodes
      .filter((c) => this.cx.onLine(c))
      .map((c) => (c.type === ';' ? undefined : this.anon(c)))
      .filter((t): t is Token => !!t);
  }

  /** Children (keywords and named nodes) in source order, filtered to the current line. */
  private ordered(n: SyntaxNode, skip: (c: SyntaxNode) => boolean = () => false): Token[] {
    const out: Token[] = [];
    for (const c of n.children) {
      if (skip(c)) continue;
      if (c.named) out.push(...this.sub(c));
      else out.push(...this.anonOnLine([c]));
    }
    return out;
  }

  private notes(root: SyntaxNode, line: number, items: Token[]): string[] {
    const notes: string[] = [];
    for (const h of onLine(root, ['heredoc_redirect'], line)) {
      const body = h.namedChildren.find((c) => c.type === 'heredoc_body');
      const end = h.namedChildren.find((c) => c.type === 'heredoc_end');
      const delim = h.namedChildren.find((c) => c.type === 'heredoc_start')?.text;
      if (delim === undefined) continue; // `cat <<` while typing
      // `<<END`, `3<<-END` as written (its descriptor, and the operator may have a tab-stripping `-`).
      const operator = `${field(h, 'descriptor')?.text ?? ''}${/<<-?/.exec(h.text)![0]}${delim}`;
      // The end line itself can be inside the range of the body (with `<<-` it is indented with tabs).
      if (end && end.startPosition.row === line) {
        notes.push(this.s(`\`${end.text.trim()}\` はヒアドキュメント（行 ${(docLine(h) + 1)} の \`${operator}\`）の終わりを示す行です。`, `\`${end.text.trim()}\` marks the end of the here-document started by \`${operator}\` on line ${(docLine(h) + 1)}.`));
      } else if (body && intersects(body, line) && body.startPosition.row <= line && h.startPosition.row < line) {
        notes.push(this.s(
          `この行はヒアドキュメント（行 ${(docLine(h) + 1)} の \`${operator}\`）の本文です。`,
          `This line is part of the here-document started by \`${operator}\` on line ${(docLine(h) + 1)}.`,
        ));
      }
    }
    for (const it of items) {
      if (it.span.start.line < line && !notes.length && it.kind !== 'block') {
        notes.push(this.s(
          `この文は行 ${it.span.start.line + 1} から続いています（行末の \`\\\` による行継続など）。`,
          `This statement starts on line ${it.span.start.line + 1} (e.g. continued with a trailing \`\\\`).`,
        ));
      }
    }
    return notes;
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
      case 'comment': return this.comment(n);
      case 'command': return assignmentsOnly(n) ? assignments(this.cx, n) : this.command(n);
      case 'time_statement': return this.timeStatement(n);
      case 'variable_assignment': return skeletal(assignment(this.cx, n), n, true);
      case 'pipeline': return this.pipeline(n);
      case 'list': return this.list(n);
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
      case 'subshell': return this.block(n, 'block', this.s('サブシェル: `( )` 内を別プロセスで実行する。中での変数変更や cd は外に影響しない', 'Subshell: runs `( )` in a child process; variable changes and cd do not leak out'));
      case 'compound_statement': {
        const why = groupSubshell(this.cx, n);
        return this.block(n, 'block', why
          ? this.s(`コマンドグループ: \`{ }\` 内のコマンドをまとめて実行する。${why.ja}ので、グループはサブシェルで実行され、中で変えた変数は外に残らない`, `Command group: runs the commands in \`{ }\` together. ${why.en}, so the group is a subshell: variables set inside are gone afterwards`)
          : this.s('コマンドグループ: `{ }` 内のコマンドを現在のシェルでまとめて実行する', 'Command group: runs the commands in `{ }` in the current shell'));
      }
      case 'do_group': return this.block(n, 'block', this.s('ループ本体: `do` から `done` までを繰り返し実行する', 'Loop body: the commands between `do` and `done`'));
      case 'function_definition': return this.functionDef(n);
      case 'for_statement': case 'select_statement': return this.missingKeyword(n, this.forStatement(n));
      case 'c_style_for_statement': return this.block(n, 'keyword', this.s('C 言語風 for ループ: `((初期化; 条件; 更新))` で回数を制御して繰り返す', 'C-style for loop: `((init; condition; update))`') + this.lineRef(n));
      case 'while_statement': return this.missingKeyword(n, this.whileStatement(n));
      case 'if_statement': return this.missingKeyword(n, this.block(n, 'keyword', this.s('if 文: 条件コマンドの終了ステータスが 0（成功）なら then 以下を実行', 'if statement: runs the `then` branch if the condition exits 0') + this.lineRef(n)));
      case 'elif_clause': return this.missingKeyword(n, this.block(n, 'keyword', this.t(keywords.elif)));
      case 'else_clause': return this.block(n, 'keyword', this.t(keywords.else));
      case 'coproc_statement': return this.coprocStatement(n);
      case 'case_statement': return this.caseStatement(n);
      case 'case_item': return this.caseItem(n);
      case 'error': return this.tok(n, 'error', this.s('構文エラー: この部分は正しく解析できませんでした（クォートや括弧の閉じ忘れなど）', 'Syntax error: this part could not be parsed (unclosed quote or bracket?)'), this.subs(n.namedChildren));
      // Every type the adapters build is explained above or by its parent. This is for a type added to the model
      // before the analyzer learns it: callers explain keywords and operators themselves, and any other node is shown as itself.
      /* c8 ignore start */
      default:
        if (!n.named) return this.anon(n) ?? this.tok(n, 'operator', n.type);
        return this.tok(n, 'argument', n.type, this.subs(n.namedChildren));
      /* c8 ignore stop */
    }
  }

  // ---------------------------------------------------------------- statements

  private comment(n: SyntaxNode): Token {
    if (n.startPosition.row === 0 && n.text.startsWith('#!')) {
      const interp = n.text.slice(2).trim();
      return this.tok(n, 'comment', this.s(
        `シバン（shebang）: このスクリプトを \`${interp}\` で実行することを指定する`,
        `Shebang: run this script with \`${interp}\``,
      ) + this.shebangEnv(interp));
    }
    const own = DIRECTIVE.exec(n.text);
    if (own) {
      const codes = own[2].split(',').map((c) => `\`${c}\``).join(own[2].includes(',') ? this.s('・', ', ') : '');
      return this.tok(n, 'comment', own[1] === 'disable-file'
        ? this.s(`Bash Explainer への指示コメント: このファイル全体で警告 ${codes} を出さない`, `Bash Explainer directive: no ${codes} warnings in this file`)
        : this.s(`Bash Explainer への指示コメント: ${n.startPosition.column ? 'この行' : '次の行'}で警告 ${codes} を出さない`, `Bash Explainer directive: no ${codes} warnings on ${n.startPosition.column ? 'this' : 'the next'} line`));
    }
    if (/^#\s*shellcheck\s/.test(n.text)) {
      return this.tok(n, 'comment', this.s('ShellCheck への指示コメント（警告の抑制など）', 'ShellCheck directive (e.g. disable a warning)'));
    }
    return this.tok(n, 'comment', this.s('コメント: `#` から行末までは実行されない', 'Comment: everything after `#` is ignored'));
  }

  /**
   * `#!/usr/bin/env -S bash -e`: Linux gives the interpreter the rest of the line as one argument, which
   * `env -S` splits; without `-S`, env looks for a program named with the whole rest (`bash -e`).
   */
  private shebangEnv(interp: string): string {
    const rest = /^(?:\S*\/)?env[ \t]+(.*\S)$/.exec(interp)?.[1];
    if (!rest) return '';
    const env = specFor(this.cx, 'env')!;
    // (One word: `rest` is not empty.)
    const role = interpret(env, [{ value: rest }], { name: 'env', lookup: (name) => specFor(this.cx, name) }).roles[0].role;
    const letters = role.role === 'cluster' ? role.letters : [role];
    const value = letters.map((l) => (l.role === 'option' ? l.value : undefined)).find((v) => v?.split || v?.refused);
    if (value?.refused) {
      return this.s('。⚠ env はこの文字列を分けられず、何も実行せずに終了ステータス 125 で終わる', '. ⚠ env cannot split this string and exits with status 125, running nothing');
    }
    if (!value) {
      if (!/\s/.test(rest)) return '';
      // `#!/usr/bin/env -i bash`: env reads the whole word as options (`-i`, then ` `: an invalid option).
      if (rest.startsWith('-')) {
        return this.s(
          `。⚠ Linux ではインタープリタの後ろの \`${rest}\` 全体が env への1つの引数になり、env はそれを1つのオプションの並びとして読むので、\`${rest.split(/\s+/).pop()}\` をコマンドとして実行しない（多くは不正なオプションとして終了ステータス 125 で終わる）。分けるには \`env -S\` と書く`,
          `. ⚠ On Linux the whole \`${rest}\` after the interpreter is one argument to env, which reads it as one run of options, so it does not run \`${rest.split(/\s+/).pop()}\` (it mostly fails with an invalid option and status 125); write \`env -S\` to split it`);
      }
      return this.s(
        `。⚠ Linux ではインタープリタの後ろの \`${rest}\` 全体が env への1つの引数になるので、env はその名前のプログラムを探して失敗する。分けるには \`env -S\` と書く`,
        `. ⚠ On Linux the whole \`${rest}\` after the interpreter is one argument to env, which looks for a program of that name and fails; write \`env -S\` to split it`);
    }
    const { words, roles } = value.split!;
    const cmd = roles.find((r) => r.role.role === 'command');
    const shown = (k: number): string => `\`${words[k].value ?? `${words[k].prefix}…`}\``;
    if (!cmd) return this.s('。env -S の文字列にコマンドがないので、スクリプトのパスをコマンドとして実行する', '. The `env -S` string names no command, so env runs the script\'s path as the command');
    const args = words.slice(cmd.word + 1).map((_, k) => shown(cmd.word + 1 + k));
    return this.s(
      `。\`env -S\` が残りを単語に分け、${shown(cmd.word)} を${args.length ? ` ${args.join(' ')} と` : ''}スクリプトのパスを引数にして実行する`,
      `. \`env -S\` splits the rest into words and runs ${shown(cmd.word)} with ${args.length ? `${args.join(' ')} and ` : ''}the script's path as arguments`);
  }

  private block(n: SyntaxNode, kind: Kind, explanation: string): Token {
    return skeletal(this.tok(n, kind, explanation, this.ordered(n)), n);
  }

  /** `coproc [NAME] command`: runs the command in the background, with two pipes to it kept in an array. */
  private coprocStatement(n: SyntaxNode): Token {
    const nameNode = field(n, 'name');
    const arr = nameNode?.text ?? 'COPROC';
    const nameTok = nameNode ? [this.tok(nameNode, 'variable', this.s(`コプロセスの名前: 配列 \`${arr}\` と変数 \`${arr}_PID\` の名前になる`, `Name of the co-process: names the array \`${arr}\` and the variable \`${arr}_PID\``))] : [];
    return skeletal(this.tok(n, 'keyword', this.s(
      `\`coproc\`: コマンドをバックグラウンドのコプロセスとして実行し、その出力と入力につながるファイルディスクリプタを配列 \`${arr}\` に入れる（\`\${${arr}[0]}\` はコプロセスの出力を読む側、\`\${${arr}[1]}\` はその入力に書く側）。プロセス ID は \`${arr}_PID\`${this.lineRef(n)}`,
      `\`coproc\`: runs the command in the background as a co-process and puts the descriptors connected to its output and input in the array \`${arr}\` (\`\${${arr}[0]}\` reads its output, \`\${${arr}[1]}\` writes to its input). Its process ID is \`${arr}_PID\`${this.lineRef(n)}`,
    ), sortTokens([...nameTok, ...this.ordered(n, (c) => same(c, nameNode))])), n);
  }

  private functionDef(n: SyntaxNode): Token {
    const nameNode = field(n, 'name')!;
    const name = nameNode.text;
    // A definition is explained on the line it starts on, where its name is.
    const nameTok = [this.tok(nameNode, 'function', this.s('関数名', 'Function name'))];
    // A redirection after the body is part of the function: it is applied on every call.
    const redirected = n.namedChildren.some((c) => c.type === 'file_redirect' || c.type === 'heredoc_redirect' || c.type === 'herestring_redirect' || c.type === 'redirected_statement');
    const stored = redirected ? this.s('。本体のあとのリダイレクトは、定義した時ではなく関数を呼ぶたびに適用される', '. The redirection after the body is applied each time the function is called, not when it is defined') : '';
    // In POSIX mode a function cannot have the name of a special builtin.
    const fails = definitionFails(this.cx.state, n);
    if (fails !== 'off') {
      this.cx.note(fact(this.lang, fails === 'on' ? 'posix-special-function-name' : 'posix-special-function-name-maybe'), nameNode);
    }
    return skeletal(this.tok(n, 'function', this.s(
      `関数 \`${name}\` の定義: 以後 \`${name}\` をコマンドのように呼び出せる（引数は関数内で $1, $2… になる）${stored}${this.lineRef(n)}`,
      `Defines function \`${name}\`; call it like a command (arguments become $1, $2…)${stored}${this.lineRef(n)}`,
    ), sortTokens([...nameTok, ...this.ordered(n, (c) => same(c, nameNode) || c.type === '(' || c.type === ')')])), n);
  }

  private forStatement(n: SyntaxNode): Token {
    const v = field(n, 'variable');
    const values = fields(n, 'value');
    const list = values.map((c) => c.text).join(' ');
    const select = n.type === 'select_statement';
    // `for i in; …` has an empty list, and its body never runs; only with no `in` at all does the loop take `"$@"`.
    const hasIn = n.children.some((c) => c.type === 'in');
    const name = v?.text;
    const expl = values.length
      ? select
        ? this.s(`select ループ: \`${list}\` を番号付きのメニューに出し、選ばれた値を変数 \`${name}\` に入れて本体を実行する（\`break\` するまで繰り返す）`,
          `select loop: show \`${list}\` as a numbered menu, assign the chosen one to \`${name}\` and run the body (until \`break\`)`)
        : this.s(`for ループ: \`${list}\` の各値を順に変数 \`${name}\` に入れて本体を繰り返す`, `for loop: assign each of \`${list}\` to \`${name}\` and run the body`)
      : hasIn
        ? this.s(`${select ? 'select' : 'for'} ループ: \`in\` のあとの一覧が空なので、本体は一度も実行されない（\`"$@"\` を回すのは \`in\` を省いたときだけ）`,
          `${select ? 'select' : 'for'} loop: the list after \`in\` is empty, so the body never runs (only a loop with no \`in\` goes over \`"$@"\`)`)
        : select
          ? this.s(`select ループ: 位置パラメータ（"$@"）を番号付きのメニューに出し、選ばれた値を \`${name}\` に入れて本体を実行する（\`in\` を省略したとき）`,
            `select loop over the positional parameters ("$@"; there is no \`in\`): show them as a numbered menu and assign the chosen one to \`${name}\``)
          : this.s(`for ループ: 位置パラメータ（"$@"）の各値を順に \`${name}\` に入れて繰り返す（\`in\` を省略したとき）`, `for loop over the positional parameters ("$@") as \`${name}\` (what a loop with no \`in\` does)`);
    const children = this.ordered(n, (c) => same(c, v) || has(values, c));
    const extra: Token[] = [];
    if (v && this.cx.onLine(v)) extra.push(this.tok(v, 'variable', this.s('ループ変数: 繰り返しごとに次の値が入る', 'Loop variable: receives the next value on each iteration')));
    for (const val of values) {
      for (const t of this.sub(val)) {
        t.explanation = this.s('繰り返す値: ', 'Value to iterate: ') + t.explanation;
        extra.push(t);
      }
    }
    return skeletal(this.tok(n, 'keyword', expl + this.lineRef(n), sortTokens([...children, ...extra])), n);
  }

  private whileStatement(n: SyntaxNode): Token {
    const until = n.children[0].type === 'until';
    const expl = until
      ? this.s('until ループ: 条件コマンドが成功（終了ステータス 0）するまで本体を繰り返す', 'until loop: repeat the body until the condition succeeds')
      : this.s('while ループ: 条件コマンドが成功（終了ステータス 0）する間、本体を繰り返す', 'while loop: repeat the body while the condition succeeds');
    return skeletal(this.tok(n, 'keyword', expl + this.lineRef(n), this.ordered(n)), n);
  }

  private caseStatement(n: SyntaxNode): Token {
    const v = field(n, 'value')!;
    const children = this.ordered(n, (c) => same(c, v));
    const vt = v.text ? this.sub(v).map((t) => ({ ...t, explanation: this.s('照合する値: ', 'Value to match: ') + t.explanation })) : []; // (`case` alone: no value yet.)
    for (const c of children) {
      if (c.kind === 'keyword' && c.label === 'in') c.explanation = this.s('値の後に、パターンごとの分岐を並べる', 'Introduces the list of pattern branches');
    }
    // `;&` and `;;&` change what happens after a match.
    const enders = n.namedChildren.flatMap((c) => c.children.filter((t) => t.type === ';&' || t.type === ';;&')).map((t) => t.type);
    const fall = !enders.length ? '' : this.s(
      `。ただしこの文には \`${[...new Set(enders)].join('\` と \`')}\` があり、分岐の終わりが \`;;\` なら終了、\`;&\` なら次の分岐の中身をパターンを調べずに実行、\`;;&\` なら次以降のパターンの照合を続ける`,
      `. This one has \`${[...new Set(enders)].join('\` and \`')}\`: a branch ending in \`;;\` stops the \`case\`, \`;&\` runs the next branch's commands without testing its pattern, and \`;;&\` goes on testing the patterns after it`);
    return skeletal(this.tok(n, 'keyword', this.s(
      `case 文: ${v.text ? `\`${v.text}\` ` : '値（まだ書かれていない）'}を各パターンと上から順に照合し、最初に一致した分岐を実行`,
      `case statement: match ${v.text ? `\`${v.text}\`` : 'the value (not written yet)'} against each pattern in order and run the first match`,
    ) + fall + this.lineRef(n), sortTokens([...children, ...vt])), n);
  }

  private caseItem(n: SyntaxNode): Token {
    const pats = fields(n, 'value');
    const ptext = pats.map((p) => p.text).join(' | ');
    const isDefault = pats.length === 1 && pats[0].text === '*';
    // The branch before it may have sent the flow here (`;&` runs this body, `;;&` tests this pattern too).
    const siblings = n.parent!.namedChildren;
    const before = siblings[siblings.findIndex((x) => same(x, n)) - 1];
    const prev = before?.type === 'case_item' ? before.children.find((t) => t.type === ';&' || t.type === ';;&')?.type : undefined;
    const viaPrev = prev === ';&'
      ? this.s('前の分岐が `;&` で終わっているので、パターンを調べずにここも実行される', 'The branch above ends in `;&`, so this one runs without its pattern being tested')
      : this.s('前の分岐が `;;&` で終わっているので、一致した後でもこのパターンも照合される', 'The branch above ends in `;;&`, so this pattern is tested too after that match');
    const expl = prev && isDefault ? this.s('分岐: `*` は何にでも一致する。', 'Branch: `*` matches anything. ') + viaPrev
      : isDefault
      ? this.s('既定の分岐: どのパターンにも一致しなかった場合に実行（`*` は何にでも一致）', 'Default branch: runs when nothing else matched (`*` matches anything)')
      : this.s(`分岐: 値がパターン \`${ptext}\` に一致した場合に実行（\`|\` は「または」）`, `Branch: runs when the value matches \`${ptext}\` (\`|\` means "or")`);
    const patToks = pats
      .filter((p) => this.cx.onLine(p))
      .map((p) => casePattern(this.cx, p));
    const rest = this.ordered(n, (c) => has(pats, c) || c.type === '|' || c.type === ')' || c.type === '(');
    if (!isDefault && (this.cx.line === null || pats.some((p) => intersects(p, this.cx.line!)))) {
      this.cx.examplesAt(n, () => caseExample(this.cx, pats));
    }
    return skeletal(this.tok(n, 'pattern', expl + (prev && !isDefault ? this.s('。', '. ') + viaPrev : '') + this.lineRef(n), sortTokens([...patToks, ...rest])), n);
  }

  private pipeline(n: SyntaxNode): Token {
    // One example for the whole pipeline replaces the examples of its stages.
    const children = this.cx.examplesReplaced(() => this.ordered(n), () => {
      const whole = pipelineExample(this.cx, n);
      return whole && { ...whole, anchor: spanOf(n), kind: 'pipeline' };
    });
    const cmds = children.filter((c) => c.kind !== 'operator' && c.kind !== 'keyword');
    const t = this.tok(n, 'operator', this.s(
      `パイプライン: 各コマンドの標準出力を次のコマンドの標準入力につないで、同時に実行する`,
      `Pipeline: each command's stdout feeds the next command's stdin; they run concurrently`,
    ), children);
    t.summary = cmds.map(summaryOf).join(' | ');
    return skeletal(t, n);
  }

  private list(n: SyntaxNode): Token {
    // Flatten left-nested lists (`a && b || c`) into one sequence.
    const parts: SyntaxNode[] = [];
    const walk = (x: SyntaxNode) => {
      for (const c of x.children) {
        if (c.type === 'list' && !isBlockLike(c)) walk(c);
        else parts.push(c);
      }
    };
    walk(n);
    const children: Token[] = [];
    for (const c of parts) {
      if (c.named) children.push(...this.sub(c));
      else children.push(...this.anonOnLine([c]));
    }
    const t = this.tok(n, 'operator', this.s(
      'コマンドリスト: `&&`（成功したら次へ）や `||`（失敗したら次へ）で条件付きにつないだコマンド列',
      'Command list joined by `&&` (run next on success) or `||` (run next on failure)',
    ), children);
    t.summary = children.map((c) => (c.kind === 'operator' && !c.children.length ? c.label : summaryOf(c))).join(' ');
    return skeletal(t, n);
  }

  /**
   * The words of a simple command and its redirections, when the words are one range with no redirection
   * among them: the redirections are all before or after them (`tr -d x < a > b`, `>f echo x`). Undefined when
   * there are none, or one stands in the middle (`echo a > f b`).
   */
  private redirectLayout(n: SyntaxNode): Layout | undefined {
    const redirs = redirectionsOf(n);
    const words = n.children.filter((c) => c.field !== 'redirect');
    const first = words[0];
    const last = words[words.length - 1];
    if (!redirs.length || redirs.some((r) => r.startIndex > first.startIndex && r.startIndex < last.endIndex)) return undefined;
    const text = n.text.slice(first.startIndex - n.startIndex, last.endIndex - n.startIndex);
    return {
      redirs, text,
      span: { start: { line: first.startPosition.row, character: first.startPosition.column }, end: { line: last.endPosition.row, character: last.endPosition.column } },
    };
  }

  /** `splitCommand` of a command whose redirections are all before or after its words, if there are any. */
  private redirectLayoutOf(n: SyntaxNode): Token | undefined {
    const layout = this.redirectLayout(n);
    return layout && this.splitCommand(n, n, layout);
  }

  /**
   * A command with redirections, as the shell runs it: it sets the redirections up, then starts the command, which
   * never sees them. So the redirections are one token (`whole`) with two kinds of children: the command (the
   * words only, with its description and examples) and each redirection.
   */
  private splitCommand(whole: SyntaxNode, body: SyntaxNode, layout: Layout): Token {
    const effect = simulateRedirects(layout.redirs.map((r) => redirectInfo(r)), this.lang);
    if (effect) this.cx.note(effect, layout.redirs);
    const inner = this.cx.examplesOf(body, () => this.commandToken(body, true), layout);
    inner.span = layout.span;
    const redirToks = this.subs(layout.redirs);
    const fds = new Set<string>();
    for (const r of layout.redirs) {
      const { op, dest } = r.type === 'file_redirect' ? redirectParts(r) : { op: r.type === 'heredoc_redirect' ? '<<' : '<<<', dest: '' };
      const fd = field(r, 'descriptor')?.text ?? '';
      // `>& file` (no number, no `$`) is the same as `&> file`.
      if (op === '&>' || op === '&>>' || (op === '>&' && fd === '' && !/^\d*-?$|[$`]/.test(dest))) { fds.add('1'); fds.add('2'); } else if (!/^\{/.test(fd)) fds.add(fd || (op.startsWith('<') ? '0' : '1'));
    }
    const names = [...fds].sort().map((fd) => fdName(fd, fd));
    const cmd = shorten(layout.text, 30);
    const w = this.tok(whole, 'redirect', this.s(
      `入出力のリダイレクト: \`${cmd}\` の${names.length ? names.map((x) => x.ja).join('・') + 'を' : '入出力を'}切り替える。シェルがコマンドの起動前に設定するので、コマンド自身にはリダイレクトは見えない`,
      `Redirection applied to \`${cmd}\`${names.length ? `: its ${names.length > 1 ? `${names.slice(0, -1).map((x) => x.en).join(', ')} and ${names[names.length - 1].en}` : names[0].en} ${names.length > 1 ? 'are' : 'is'} redirected` : ''}. The shell sets this up before the command starts, so the command does not see the redirections`,
    ), sortTokens([inner, ...redirToks]));
    w.summary = summaryOf(inner);
    return skeletal(w, whole);
  }

  /**
   * `if [ -f a ] then …` and `for x in a b do …`: with no `;` or newline before it, `then` / `do` is an ordinary
   * word, the construct lacks its keyword and bash stops with a syntax error. Marks the token and adds a note.
   */
  private missingKeyword(n: SyntaxNode, t: Token): Token {
    if (!n.incomplete) return t;
    const kw = n.type === 'if_statement' || n.type === 'elif_clause' ? 'then' : 'do';
    const head = n.type === 'for_statement' || n.type === 'select_statement' ? n.namedChildren : n.namedChildren.slice(0, 1);
    const stray = head.some((h) => [h, ...descendants(h, ['word'])].some((w) => w.type === 'word' && w.text === kw));
    if (!stray) return t;
    const msg = this.s(
      `構文エラー: \`${kw}\` の前に \`;\` か改行が要る。無いと \`${kw}\` はただの引数として読まれ、この構文に \`${kw}\` が無いので、bash は「syntax error near unexpected token」で止まる`,
      `Syntax error: a \`;\` or a newline is needed before \`${kw}\`. Without it \`${kw}\` is read as an ordinary argument, so this construct has no \`${kw}\` and bash stops with "syntax error near unexpected token"`);
    t.kind = 'error';
    t.explanation = `${msg}. ${t.explanation}`;
    this.cx.note(`⚠ ${msg}`, n);
    return t;
  }

  // ---------------------------------------------------------------- commands

  private command(n: SyntaxNode): Token {
    // `>f echo x`, `<<<'1 2' read a b`: redirections before the words.
    const split = this.redirectLayoutOf(n);
    if (split) return split;
    // (`echo a > f b 2>&1`: a redirection among the words, and more of them.)
    const effect = simulateRedirects(redirectionsOf(n).map((r) => redirectInfo(r)), this.lang);
    if (effect) this.cx.note(effect, redirectionsOf(n));
    return this.cx.examplesOf(n, () => {
      const t = this.commandToken(n);
      statusRangeNote(this.cx, n);
      return t;
    });
  }

  /** The assignments before the command name (as tokens), the arguments, and the redirections of a command. */
  private commandParts(n: SyntaxNode, nameNode: SyntaxNode): { prefix: Token[]; args: SyntaxNode[]; redirs: SyntaxNode[] } {
    const prefix: Token[] = [];
    const args: SyntaxNode[] = [];
    const redirs: SyntaxNode[] = [];
    let seenName = false;
    // What each assignment before the name does (src/semantics/names.ts): in POSIX mode (sh, dash, `set -o posix`)
    // one before a special builtin stays after it.
    const word = nameNode.namedChildren[0];
    // (An unquoted expansion alone may give no word: `x=1 $cmd`.)
    const spelled = staticWordValue(word);
    const dynamic = spelled === undefined && ['simple_expansion', 'expansion', 'command_substitution'].includes(word.type);
    const meanings = n.children.some((c) => c.type === 'variable_assignment')
      ? assignmentsOf(this.cx.state, n, dynamic ? 'dynamic' : resolve(this.cx, spelled ?? nameNode.text, nameNode))
      : [];
    for (const c of n.children) {
      if (same(c, nameNode)) { seenName = true; continue; }
      if (c.type.endsWith('redirect')) { redirs.push(c); continue; }
      if (!seenName && c.type === 'variable_assignment') {
        const meaning = meanings.find((m) => m.node === c)!;
        const stays = meaning.scope === 'persists';
        for (const t of this.sub(c)) {
          t.refs = stays ? ['3.7.4', '4.4'] : ['3.7.4'];
          t.explanation = stays && !meaning.sure
            ? this.s(`\`${nameNode.text}\` は POSIX の特殊ビルトインなので、ここで POSIX モードなら（この前で有効にしているのは一部の経路だけ）、この代入はコマンドの後も残る: ${t.explanation}`,
              `\`${nameNode.text}\` is a POSIX special builtin, so if POSIX mode is on here (only some paths before here turn it on), this assignment stays after the command: ${t.explanation}`)
            : stays
            ? this.s(`\`${nameNode.text}\` は POSIX の特殊ビルトインなので、この代入はコマンドの後も残る（bash の通常モードでは実行中だけ）: ${t.explanation}`,
              `\`${nameNode.text}\` is a POSIX special builtin, so this assignment stays after the command (in bash's normal mode it would last only while the command runs): ${t.explanation}`)
            : !meaning.sure
            ? this.s(`このコマンドの実行中だけ設定される環境変数（\`${nameNode.text}\` が何の語にもならなければ、シェルの変数として残る）: ${t.explanation}`,
              `Environment variable set only for this command (if \`${nameNode.text}\` expands to no word at all, it stays as a shell variable): ${t.explanation}`)
            : this.s(
              `このコマンドの実行中だけ設定される環境変数: ${t.explanation}`,
              `Environment variable set only for this command: ${t.explanation}`,
            );
          prefix.push(t);
        }
        continue;
      }
      if (c.named) args.push(c);
    }
    return { prefix, args, redirs };
  }

  private timeStatement(n: SyntaxNode): Token {
    return this.cx.examplesOf(n, () => this.timed(n));
  }

  private commandToken(n: SyntaxNode, redirsOut = false): Token {
    const nameNode = field(n, 'name')!;
    const { prefix, args, redirs } = this.commandParts(n, nameNode);
    // `time` is a keyword at the start of a pipeline (a `time_statement`); `FOO=1 time x` and `a | time x` run the program.
    return this.commandTail(n, nameNode, args, prefix, redirsOut ? [] : redirs);
  }

  /** The keyword `time`, and the option `-p` if there is one: the start of every explanation of it. */
  private timeLead(time: SyntaxNode, posix: SyntaxNode | undefined): Token[] {
    const kw = Object.assign(this.tok(time, 'keyword', this.t(keywords.time)), { name: nameInfo(this.lang, { kind: 'keyword', name: 'time' }, this.cx, time) });
    return posix ? [kw, this.tok(posix, 'option', this.s('POSIX 形式で時間を表示する', 'print the times in the POSIX format'))] : [kw];
  }

  /** `time [-p] command …`: the keyword, and the rest explained as the command it times. */
  private timed(n: SyntaxNode): Token {
    const lead = this.timeLead(token(n, 'time')!, field(n, 'option'));
    const cmd = field(n, 'body');
    if (!cmd) return skeletal(this.tok(n, 'keyword', lead[0].explanation, lead), n);
    // What `time` times, a command or a whole pipeline, is explained as it would be on its own.
    const inner = this.sub(cmd);
    const text = shorten(n.text.slice(cmd.startIndex - n.startIndex).replace(/\s*\\\n\s*/g, ' '), 40);
    const explanation = this.s(
      `\`${text}\` の実行時間を計測する（実時間・ユーザー時間・システム時間を stderr に表示。パイプラインなら全体の時間）`,
      `Time \`${text}\`: run it and report how long it took (real, user and sys time, on stderr; a pipeline is timed as a whole)`,
    );
    const t = this.tok(n, 'keyword', explanation, sortTokens([...lead, ...inner]));
    t.summary = `time ${inner.map(summaryOf).join(' ')}`;
    return skeletal(t, n);
  }

  private commandTail(n: SyntaxNode, nameNode: SyntaxNode, args: SyntaxNode[], prefix: Token[], redirs: SyntaxNode[], word?: SyntaxNode): Token {
    const head = this.commandHead(nameNode, word);
    const yq = yqSpecsOf(head.name);
    if (yq) {
      // Three tools are called yq; explain the arguments as the one this command is for.
      const verdict = judgeYq(args.map((a) => literalContent(a)?.text), { doc: this.cx.source, host: this.cx.opts.host, setting: this.cx.opts.yqFlavor });
      head.spec = yq[verdict.flavor];
      head.explanation = this.t(head.spec.summary);
      // A command over several lines is explained whole, so it always starts on the line explained.
      for (const text of yqNotes(verdict, this.lang)) this.cx.note(text, n);
    }
    if (head.kind === 'builtin' && head.name === 'local' && !inFunction(this.cx.state.env(n)) && scopeOf(n) !== 'substitution') this.cx.note(fact(this.lang, 'local-outside-function'), n);
    if (head.kind === 'builtin' && head.name === 'return') head.explanation = returnInSubstitution(this.cx, n) ?? head.explanation;
    const read = readArgs(this.cx, head.spec, args, head.runs ?? head.name, head.fn);
    let argToks = read.tokens;
    // `test` and `[` read their words as an expression (src/testexpr.ts), when the name runs one of them.
    const bracket = head.test?.closingOperand !== undefined;
    if (head.test) argToks = readByCommand(testArgs(this.cx, n, commandTest(head.test, args, bashTest(this.cx, head.test)), bracket));
    // (A function of the script is not the command its name suggests: no example of that command.)
    if (!head.fn) {
      unreadStdin(this.cx, n, read.parse, args, head.name);
      commandExampleFor(this.cx, n, head.spec, args, read.parse);
    }
    for (const a of args) {
      this.cx.examplesAt(a, () => wordExample(this.cx, a));
    }
    // `[` is a command and `]` its last argument: they get tokens of their own, around the condition.
    const nameToks = bracket ? [this.tok(word ?? nameNode, head.kind, head.kind === 'builtin'
      ? this.s('コマンド `[`（`test` の別名）', 'Command `[` (an alias of `test`)')
      : this.s('プログラム `[`（`test` と同じ）', 'The program `[` (the same as `test`)'), head.nameTokens)] : head.nameTokens;
    const t = this.tok(n, bracket ? 'test' : head.kind, head.explanation, sortTokens([
      ...prefix, ...nameToks, ...argToks, ...this.subs(redirs),
    ]), bracket ? shorten(wordsText(n)) : shorten((word ?? nameNode).text));
    const name = head.res && nameInfo(this.lang, head.res, this.cx, nameNode);
    if (name) (bracket ? nameToks[0] : t).name = name;
    t.summary = bracket ? this.s(`条件判定 ${shorten(wordsText(n), 40)}`, `test ${shorten(wordsText(n), 40)}`) : `${head.name}: ${head.explanation}${name?.runs === 'builtin' ? name.said.short : ''}`;
    if (head.refs?.length) t.refs = bracket ? [...head.refs, '6.4'] : head.refs;
    // (The test itself: `[ a = b ]` of `[ a = b ] >o`.)
    const parts = bracket ? bracketLabel(n) : undefined;
    if (parts?.some((p) => p.placeholder)) {
      t.labelParts = parts;
      t.label = labelText(parts);
    }
    if (head.kind === 'builtin') t.explanation += shellEffectNote(this.cx, n, shellEffectOf(head.spec, read.parse.roles.map((r) => [args[r.word], r.role] as const)));
    // The deepest subcommand gives the summary (`git stash push`, `docker compose -f x run`). (The names are the
    // words' values: `yq 'e'` names `e`.)
    const path: string[] = [];
    let summary: Text | undefined;
    for (let p = read.parse, r = subcommandOf(p); r; p = r.role.parse, r = subcommandOf(p)) {
      path.push(argWord(args[r.word]).value!);
      summary = r.role.spec.summary;
    }
    if (summary) t.summary = `${[head.name, ...path].join(' ')}: ${this.t(summary)}`;
    return t;
  }

  private commandHead(nameNode: SyntaxNode, word = nameNode.namedChildren[0]!): CommandHead {
    // `{echo,hi}` is a brace expansion first: the command is the first word it gives (`echo`), with the others as arguments.
    const braced = isPlainWord(word) ? braceWords(word.text) : undefined;
    if (braced?.length) {
      const head = this.commandHeadFor(nameNode, word, braced[0]);
      head.explanation = this.s(
        `ブレース展開で \`${word.text}\` は \`${braced.join(' ')}\` になるので、コマンド \`${braced[0]}\` を実行する（\`{ }\` のグループではない）。${head.explanation}`,
        `Brace expansion turns \`${word.text}\` into \`${braced.join(' ')}\`, so this runs the command \`${braced[0]}\` (it is not a \`{ }\` group). ${head.explanation}`);
      head.nameTokens = [braceWord(this.cx, word)!];
      return head;
    }
    const head = this.commandHeadFor(nameNode, word);
    const spelled = staticWordValue(word);
    if (spelled && spelled !== word.text) {
      head.explanation = this.s(
        `コマンド名 \`${word.text}\` は、クォートやバックスラッシュ、空の \`$(…)\` を取り除くと \`${shown(spelled)}\` になる。${head.explanation}`,
        `The command name \`${word.text}\` becomes \`${shown(spelled)}\` once the quotes, backslashes and empty \`$(…)\` are removed. ${head.explanation}`,
      );
      if (!isPlainWord(word) && !head.nameTokens.length) head.nameTokens = this.sub(word);
    }
    return head;
  }

  /** `test` or `[`, when `res` runs one of them (src/semantics/names.ts): its spec, for `CommandHead.test`. */
  private testOf(res: NameResolution): { test?: CommandSpec } {
    const test = testSpecOf(res);
    return test ? { test } : {};
  }

  /** A note on a definition of `name` that does not run here (a function defined later, in a subshell, removed). */
  private missedNote(name: string, missed: Missed | undefined, at: SyntaxNode): void {
    if (missed?.kind !== 'function') return;
    const line = (docLine(missed.def) + 1);
    const runs = tx(`組み込みコマンドや外部コマンドの \`${name}\` が動きます`, `the builtin or program \`${name}\` runs`);
    switch (missed.why) {
      case 'later':
        this.cx.note(fact(this.lang, 'function-defined-later', { name, line, runs }), at);
        return;
      case 'subshell':
        this.cx.note(fact(this.lang, 'function-defined-in-subshell', { name, line, runs }), at);
        return;
      case 'in-function':
        this.cx.note(fact(this.lang, 'function-defined-in-uncalled-function', { name, line, by: field(missed.by!, 'name')!.text, runs }), at);
        return;
      case 'never-runs':
        this.cx.note(fact(this.lang, 'function-defined-in-dead-branch', { name, line, runs }), at);
        return;
      case 'unset':
        this.cx.note(fact(this.lang, 'function-removed-by-unset', { name, line: (docLine(missed.by!) + 1), runs }), at);
        return;
      case 'posix-special':
        this.cx.note(fact(this.lang, 'special-builtin-before-function', { name, line }), at);
        return;
    }
  }

  /** "Call the function `f` defined on line N", with what it hides and whether it is sure. */
  private functionCall(res: Extract<NameResolution, { kind: 'function' }>): string {
    const { name } = res;
    const line = (docLine(res.fn.def) + 1);
    const shadows = res.shadows === 'builtin'
      ? this.s(`（同じ名前の組み込みコマンドの代わりに動く。組み込みは \`builtin ${name}\` で呼べる）`, ` (it runs instead of the builtin of that name; \`builtin ${name}\` runs the builtin)`)
      : res.shadows === 'program'
        ? this.s(`（同じ名前のコマンドの代わりに動く。コマンドは \`command ${name}\` で呼べる）`, ` (it runs instead of the command of that name; \`command ${name}\` runs the command)`)
        : '';
    const may = res.sure ? '' : res.maybe === 'import'
      ? this.s('。ただし、`sh` は Debian や Ubuntu では dash で、dash は bash がエクスポートした関数を読まないので、そこでは同じ名前のコマンドが動く',
        '. But `sh` is dash on Debian and Ubuntu, and dash does not read the functions bash exports: there the command of that name runs')
      : res.maybe === 'startup'
      ? this.s(`。ただし、この関数は新しいシェルに渡されないので、定義されているのは起動時に読むファイル（\`-l\`、\`-i\`、\`BASH_ENV\`）${res.sourced ? `か、行 ${docLine(res.sourced) + 1} で読み込むファイル` : ''}が定義する場合だけで、そうでなければ同じ名前のコマンドが動く`,
        `. But this function is not passed to the new shell: it is defined there only if the files it reads at startup (\`-l\`, \`-i\`, \`BASH_ENV\`)${res.sourced ? `, or the file it reads on line ${docLine(res.sourced) + 1},` : ''} define it; otherwise the command of that name runs`)
      : res.maybe === 'branch'
      ? this.s('。ただし、ここまでに定義されているのは一部の経路（分岐など）だけで、そうでなければ同じ名前のコマンドが動く',
        '. But only some paths before here (a branch…) define it; on the others the command of that name runs')
      : this.s('。ただし、それはこれが動くときに定義されていればで、定義はスクリプトのあとの部分の一部の経路にしかない',
        '. That is, if it is defined when this runs: it is defined later in the script, on some paths only');
    return this.s(`このスクリプトの行 ${line} で定義された関数 \`${name}\` を呼び出す${shadows}${may}`, `Call the function \`${name}\` defined on line ${line}${shadows}${may}`);
  }

  private commandHeadFor(nameNode: SyntaxNode, word: SyntaxNode, as?: string): CommandHead {
    // Commands with an empty name (`FOO=1 2>/dev/null`) do not get here.
    // A name made of quotes, escapes or empty `$(:)` is the command it spells once they are removed (`e\c'h'"o"` is `echo`).
    const spelled = staticWordValue(word);
    const sv = spelled && spelled !== word.text ? spelled : undefined;
    const name = as ?? sv ?? (isPlainWord(word) ? word.text : nameNode.text);
    if (sv === undefined && !isPlainWord(word) && word.type !== 'raw_string') {
      return {
        name, kind: 'command', nameTokens: this.sub(word), refs: ['3.7.1'],
        explanation: this.s('変数（展開結果）をコマンド名として実行する', 'Run the expanded value as a command'),
      };
    }
    // What bash runs (src/semantics/names.ts). An alias over a known command that runs that command with more words
    // (`alias grep='grep --color=auto'`) is still explained as that command; one that runs something else (`alias
    // echo=printf`, `alias [=echo`) is the alias. (A quoted name is never an alias.)
    const ran = resolve(this.cx, name, nameNode, { quoted: sv !== undefined });
    const known = !!lookupCommand(name);
    // (Not `test` or `[` with more words, `alias [='[ -n x'`: they change the expression.)
    const same = ran.kind === 'alias' && ran.target?.name === name && (alias1(ran.alias.value) || !testSpecOf(ran.target));
    const res = same && known ? resolve(this.cx, name, nameNode, { quoted: true }) : ran;
    if (res.kind === 'alias') {
      const { alias } = res;
      // The words after the name are read with the spec of the command the alias runs, when its text is that name
      // alone at each step (`alias g=grep`: `g -n x f`). With more words (`alias ll='ls -l'`), they go after those.
      let runs: NameResolution | undefined = res;
      while (runs?.kind === 'alias' && alias1(runs.alias.value)) runs = runs.target;
      const target = runs && runs.kind !== 'alias' && res.sure && (runs.kind === 'builtin' || runs.kind === 'file') && !testSpecOf(runs) ? specFor(this.cx, runs.name) : undefined;
      const spec: CommandSpec = target ?? { ...NO_SPEC, unknownOption: { ja: `エイリアスの置き換え先 \`${alias.value}\` に渡す単語`, en: `A word passed on to \`${alias.value}\`, the text of the alias` } };
      const line = (docLine(alias.at) + 1);
      // (`alias a=b b='echo B'`: `a` runs the alias `b`.)
      const chain = res.target?.kind === 'alias'
        ? this.s(`（\`${res.target.name}\` もエイリアスで、\`${res.target.alias.value}\` に置き換わる）`, ` (\`${res.target.name}\` is an alias too, for \`${res.target.alias.value}\`)`)
        : '';
      return {
        name, res: ran, kind: 'alias', nameTokens: [], refs: ['6.6'], spec, ...(target ? { runs: runs!.name } : {}),
        explanation: res.sure
          ? this.s(`このスクリプトの行 ${line} で定義したエイリアス \`${name}\`: \`${alias.value}\` に置き換わる${chain}`, `The alias \`${name}\` defined on line ${line}: replaced by \`${alias.value}\`${chain}`)
          : alias.state === 'on'
            ? this.s(`このスクリプトの行 ${line} で定義したエイリアス \`${name}\`: \`${alias.value}\` に置き換わる${chain}。ただし、それは \`shopt -s expand_aliases\` が効いているときだけで、この前で有効にしているのは一部の経路（分岐やループ）だけ`,
              `The alias \`${name}\` defined on line ${line}: replaced by \`${alias.value}\`${chain}, but only when \`shopt -s expand_aliases\` is on, and only some paths before here (a branch or a loop) turn it on`)
            : this.s(`このスクリプトの行 ${line} で定義したエイリアス \`${name}\`: \`${alias.value}\` に置き換わる${chain}。ただし、それは定義する行を通ったときだけ（この前で定義しているのは一部の経路だけ）`,
              `The alias \`${name}\` defined on line ${line}: replaced by \`${alias.value}\`${chain}, but only when its definition has run (only some paths before here define it)`),
      };
    }
    // (The parser has read it as a command name: not a keyword.)
    const missed = (res as { missed?: Missed }).missed;
    if (missed?.kind === 'alias' && !known) {
      const first = missed.def.startPosition.row;
      if (missed.why === 'expand_aliases') {
        const value = this.cx.state.at(nameNode).expand.aliases.get(name)!.value;
        this.cx.note(fact(this.lang, 'alias-not-expanded-in-script', { name, value }), nameNode);
        return {
          name, res: ran, kind: 'alias', nameTokens: [], refs: ['6.6'],
          explanation: this.s(`このスクリプトの行 ${first + 1} で定義したエイリアス \`${name}\`（\`${value}\`）。ただし bash はスクリプトの中でエイリアスを展開しない（\`shopt -s expand_aliases\` がない）ので、実際には「command not found」になる。sh や dash なら \`${value}\` に置き換わる`,
            `The alias \`${name}\` defined on line ${first + 1} (\`${value}\`). But bash does not expand aliases in a script (no \`shopt -s expand_aliases\`), so this is "command not found". With sh or dash it would be replaced by \`${value}\``),
        };
      }
      if (missed.why === 'later' || missed.why === 'same-unit') {
        this.cx.note(fact(this.lang, missed.why === 'same-unit' ? 'alias-defined-same-unit' : 'alias-defined-later', { name, line: first + 1 }), nameNode);
        if (res.kind === 'file') return { name, res: ran, kind: 'command', nameTokens: [], refs: ['6.6'], explanation: this.s(`コマンド \`${name}\` を実行する（行 ${first + 1} のエイリアスはここではまだ効かない）`, `Run the command \`${name}\` (the alias of line ${first + 1} is not in effect here)`) };
      }
    }
    if (res.kind === 'function') return { name, res: ran, kind: 'function', fn: res.sure || 'maybe', nameTokens: [], refs: ['3.3'], explanation: this.functionCall(res) };
    this.missedNote(name, missed, nameNode);
    // After `source`, a name the dictionary does not know may be a function of the file read.
    if (res.kind === 'file' && res.sourced) {
      const line = (docLine(res.sourced) + 1);
      return {
        name, res: ran, kind: 'command', nameTokens: [], refs: ['3.7.2'],
        explanation: this.s(`\`${name}\` を実行する。行 ${line} で読み込んだファイルの関数かもしれない（そうでなければ外部コマンド）`,
          `Run \`${name}\`: maybe a function of the file read on line ${line}, else an external command`),
      };
    }
    // A builtin turned off with `enable -n` runs the program of its name; `hash -p` gives a name a path.
    if (res.kind === 'file' && (res.disabled || res.hashed)) {
      const path = res.hashed?.value;
      const spec = lookupCommand(path || name);
      const program = spec?.builtin ? spec.program : spec;
      const by = (docLine((res.hashed ?? res.disabled)!.at) + 1);
      const why = res.hashed
        ? this.s(`行 ${by} の \`hash -p\` で \`${name}\` は \`${path}\` を指す`, `\`hash -p\` on line ${by} gave \`${name}\` the path \`${path}\``)
        : this.s(`行 ${by} の \`enable -n\` で組み込みの \`${name}\` は無効になっている`, `\`enable -n\` on line ${by} turned the builtin \`${name}\` off`);
      return {
        name, res: ran, ...(program ? { spec: program } : {}), ...this.testOf(res), kind: 'command', nameTokens: [], refs: ['3.7.2'],
        explanation: this.s(`外部コマンド \`${path || name}\` を実行する（${why}）${program ? `: ${this.t(program.summary)}` : ''}`, `Run the external command \`${path || name}\` (${why})${program ? `: ${this.t(program.summary)}` : ''}`),
      };
    }
    // A command described in the customCommands setting wins over the built-in dictionary.
    const custom = customCommandSpec(this.cx.opts.customCommands?.[name.split('/').pop()!]);
    if (custom) {
      return { name, res: ran, spec: custom, kind: 'command', nameTokens: [], explanation: this.t(custom.summary) + this.s('（設定 customCommands で定義）', ' (from the customCommands setting)') };
    }
    const spec = hostCommand(this.cx, name) ?? lookupCommand(name);
    if (spec) {
      const builtin = !!spec.builtin;
      return {
        name, res: ran, spec, ...this.testOf(res), kind: builtin ? 'builtin' : 'command', nameTokens: [], ...(builtin ? { refs: builtinSections(name, spec.builtin === 'special') } : {}),
        explanation: builtin && spec.closingOperand // (zsh splits and globs no unquoted variable, but drops one that is empty all the same.)
          ? this.s(`コマンド \`[\`（\`test\` の別名）: 引数の条件を評価し、真なら成功(0)を返す。シェルの構文ではなく普通のコマンドなので、\`[\` と \`]\` の前後に空白が要り、${this.cx.shell === 'zsh' ? '中の引数はほかのコマンドの引数と同じく展開される（クォートしない変数は、空なら引数ごと消える。`[[ ]]` なら消えない）' : '中の引数には単語分割とグロブ展開がかかる（`[[ ]]` ならかからない）'}`,
            `Command \`[\` (an alias of \`test\`): evaluates the condition in its arguments and succeeds (0) if it is true. It is an ordinary command, not shell syntax, so \`[\` and \`]\` need spaces around them, and ${this.cx.shell === 'zsh' ? 'the arguments inside are expanded as any command\'s are (an unquoted variable that is empty is dropped; `[[ ]]` keeps it)' : 'the arguments inside undergo word splitting and globbing (`[[ ]]` does not)'}`)
          : this.t(spec.summary),
      };
    }
    const distro = Object.hasOwn(distroAliases, name) ? distroAliases[name] : undefined;
    if (distro) {
      const where = distro.definitions.map(([os]) => os).join(this.s('・', ', '));
      const defs = distro.definitions.map(([os, v]) => `${os}: \`${v}\``).join(this.s('、', ', '));
      const whatText = distro.kind === 'alias' ? tx('エイリアス', 'alias') : tx('関数', 'function');
      const what = this.t(whatText);
      // In a README the commands are typed into a terminal, where the alias may exist.
      const interactive = this.cx.opts.host?.kind === 'markdown';
      const many = distro.definitions.length > 1;
      this.cx.note(interactive
        ? fact(this.lang, 'distro-alias-interactive', { name, where, what: whatText, many, portable: distro.portable })
        : fact(this.lang, 'distro-alias-in-script', { name, where, what: whatText, many, instead: distro.portable ? tx(`\`${distro.portable}\` と書きます`, `Write \`${distro.portable}\``) : tx('したいことに合ったコマンドをそのまま書きます', 'Write the command you mean') }), nameNode);
      return {
        name, ...(interactive ? {} : { res: ran }), spec: distro.command ? lookupCommand(distro.command) : undefined, kind: 'command', nameTokens: [],
        explanation: this.s(`${what} \`${name}\`: ${this.t(distro.meaning)}（${defs}）`, `${distro.kind === 'alias' ? 'Alias' : 'Function'} \`${name}\`: ${this.t(distro.meaning)} (${defs})`),
      };
    }
    if (name.includes('/')) return { name, res: ran, kind: 'command', nameTokens: [], refs: ['3.7.2'], explanation: this.s(`パス \`${name}\` にあるプログラム・スクリプトを実行する`, `Run the program or script at \`${name}\``) };
    return { name, res: ran, kind: 'command', nameTokens: [], explanation: this.s(`外部コマンド \`${name}\` を実行する（辞書に未登録。\`man ${name}\` や \`${name} --help\` を参照）`, `Run the external command \`${name}\` (not in the dictionary; see \`man ${name}\`)`) };
  }

  /** The notes (`pitfall: false`) and pitfalls on status and errexit of line `line` (src/semantics/status.ts). */
  private statusNotes(line: number, pitfall: boolean): string[] {
    let byRoot = statusFactCache.get(this.cx.status);
    if (!byRoot) statusFactCache.set(this.cx.status, (byRoot = new WeakMap()));
    let byLine = byRoot.get(this.cx.root);
    if (!byLine) byRoot.set(this.cx.root, (byLine = statusFacts(this.cx.root, this.cx.state, this.cx.status, this.cx.shell)));
    return (byLine.get(line) ?? []).filter((f) => (MESSAGES[f.id].kind === 'pitfall') === pitfall).flatMap((f) => this.say(factOf(this.lang, f), f.node));
  }

  /**
   * `… | while read l; do n=…; done; echo "$n"`: each part of a pipeline runs in a subshell (the last
   * one too, in bash without lastpipe, and in dash and the like), so variables set there are gone after
   * it. Pointed out where the pipeline starts, when such a variable is used after it.
   */
  private pipeSubshellPitfalls(root: SyntaxNode, line: number): string[] {
    for (const p of onLine(root, ['pipeline'], line)) {
      if (p.startPosition.row !== line) continue;
      // A variable the last stage sets in its subshell, read after the pipeline (src/semantics/pipeline.ts): with lastpipe on, it runs in the shell.
      const lost = lostVariable(this.cx.state, p);
      if (!lost) continue;
      const { name: used, last, link } = lost;
      const bash = !this.cx.shell || this.cx.shell === 'bash';
      const fix: [string, string] = last.type === 'command'
        ? (bash ? [`\`read ${used} < <(コマンド)\` のようにプロセス置換で渡すか、\`shopt -s lastpipe\` にします`, `Use process substitution, \`read ${used} < <(command)\`, or turn on \`shopt -s lastpipe\``]
          : [`\`${used}=$(コマンド)\` のようにコマンド置換で受け取ります`, `Take the output with command substitution: \`${used}=$(command)\``])
        : (bash ? ['`done < ファイル` や `done < <(コマンド)` のようにリダイレクトで渡すか、`shopt -s lastpipe` にします', 'Feed the loop with a redirection, `done < file` or `done < <(command)`, or turn on `shopt -s lastpipe`']
          : ['`done < ファイル` のようにリダイレクトで渡すか、一時ファイルを使います', 'Feed the loop with a redirection, `done < file`, or use a temporary file']);
      return this.say(fact(this.lang, 'pipeline-subshell-variable', { used, fix: tx(fix[0], fix[1]), partial: !link.sure }), p);
    }
    return [];
  }

  /**
   * `for f in *.log`: when nothing matches, the loop runs once with `*.log` itself (unless nullglob or
   * failglob is on, or zsh, where it is an error). Quiet when the body checks that the file exists.
   */
  private unmatchedGlobPitfalls(root: SyntaxNode, line: number): string[] {
    if (this.cx.shell === 'zsh') return [];
    for (const loop of onLine(root, ['for_statement', 'select_statement'], line)) {
      const shopt = shoptAt(this.cx, loop);
      if (loop.startPosition.row !== line || shopt.nullglob === 'on' || shopt.failglob === 'on') continue;
      // `*.log`, and `"$dir"/*.log` too.
      const glob = fields(loop, 'value').find((v) => ((!!unquotedWord(v) && isGlob(v.text))
        || (v.type === 'concatenation' && v.namedChildren.some((c) => c.type === 'word' && isGlob(c.text)))));
      const v = field(loop, 'variable')?.text;
      if (!glob || !v || globOff(this.cx, glob)) continue;
      const bodyNode = field(loop, 'body');
      // `for f in *` while typing: there is no body to look at yet.
      if (!bodyNode) continue;
      const body = bodyNode.text;
      if (new RegExp(`-[efdrsLh]\\s+"?\\$\\{?${v}\\b`).test(body)) continue;
      const nullglob = shopt.nullglob !== 'unsupported';
      return this.say(fact(this.lang, 'unmatched-glob-runs-once', { glob: glob.text, v, nullglob }), glob);
    }
    return [];
  }

  /**
   * bash reads an extended glob only after `shopt -s extglob` (except in `[[ ]]`), and reads a whole
   * function or block before running it, so turning it on inside the same block is too late.
   */
  private extglobPitfalls(root: SyntaxNode, line: number): string[] {
    if (this.cx.shell && this.cx.shell !== 'bash') return [];
    const uses = onLine(root, ['word', 'extglob_pattern'], line)
      .filter((n) => n.startPosition.row === line && hasExtglob(n.text) && !/^(extended_test|expansion)$/.test(ancestor(n, (a) => /^(extended_test|expansion|command_substitution|process_substitution)$/.test(a.type))?.type ?? '')); // (Not in `[[ ]]` nor in a `${x%…}`: bash reads them anyway.)
    if (!uses.length) return [];
    const use = uses[0];
    let top = use;
    while (top.parent && top.parent.type !== 'program') top = top.parent;
    // On when the block runs up to the glob, but not when bash read the block.
    const state = shoptAt(this.cx, use, 'parse').extglob;
    if (state === 'on') return [];
    if (top !== use && shoptAt(this.cx, top).extglob !== 'on' && shoptAt(this.cx, use).extglob === 'on') {
      return this.say(fact(this.lang, 'extglob-in-same-block', { use: use.text }), use);
    }
    // (A trap's action is read when its signal comes; another shell starts with its own options.)
    const id = state === 'unknown' ? (this.cx.nested === 'later' ? 'extglob-maybe-on-trap' : 'extglob-maybe-on')
      : state === 'off' ? 'extglob-turned-off' : this.cx.nested === 'child' ? 'extglob-not-in-new-shell' : 'extglob-not-found';
    return this.say(fact(this.lang, id, { use: use.text }), use);
  }
}

interface CommandHead {
  /** `res`: what bash runs for the name (src/semantics/names.ts), whose facts the badge shows (src/namefacts.ts). */
  name: string; res?: NameResolution; spec?: CommandSpec; kind: Kind; explanation: string; nameTokens: Token[];
  /** A call of a function defined in the script (`maybe`: on some paths only). */
  fn?: true | 'maybe';
  /** The sections of the manual on what the name runs: a builtin's, a function's (3.3), an alias's (6.6). */
  refs?: readonly string[];
  /** The spec of `test` or `[`, when the name runs one of them (src/semantics/names.ts, `testSpecOf`). */
  test?: CommandSpec;
  /** The command whose spec reads the words, when it is not `name`: what an alias runs (`alias g=grep`). */
  runs?: string;
}

/** An alias whose text is one plain word: the alias runs that command with the same words. */
function alias1(value: string): boolean {
  return /^[^\s;|&<>()'"`$\\=]+$/.test(value);
}
/** The spec of the dictionary's command `name` (`/usr/bin/kill` is `kill`). */
/** The subcommand a parse names, if any (`git stash push`: `stash`, whose parse names `push`). */
const subcommandOf = (p: ArgvParse) => p.roles.find((r): r is { word: number; role: Extract<ArgRole, { role: 'subcommand' }> } => r.role.role === 'subcommand');

/** What `redirectLayout` found: the redirections in source order, and the range and text of the command's words. */
interface Layout { redirs: SyntaxNode[]; span: Span; text: string }

export { lookupCommand };
