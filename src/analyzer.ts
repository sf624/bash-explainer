import { Lang, Text, tx } from './i18n';
import { idiomsFound } from './idioms';
import { pitfallFindings } from './pitfalls';
import { wordFindings } from './wordfacts';
import { spanOf } from './noteanchors';
import { ancestor, assignmentsOnly, descendants, field, fields } from './syntax/tree';
import type { SyntaxNode, SyntaxTree } from './syntax/tree';
import { lookupCommand } from './dict/aliases';
import { interpret } from './argv/interpret';
import { hasExtglob, isGlob } from './examples/shellwords';
import { pictureNote } from './ctlchars';
import { DIRECTIVE } from './directives';
import { dialectFound, Shell } from './dialect';
import { splitElement } from './staticword';
import { explainExpansion } from './expansion-tokens';
import { keywords, listOps } from './dict/syntax';
import { explainCommandSubstitution, explainProcessSubstitution } from './substitution-tokens';
import { docLine, shellState } from './semantics/state';
import { lostVariable } from './semantics/pipeline';
import type { NestedScript } from './semantics/nested';
import { definitionFails } from './semantics/names';
import { statusModel, type StatusModel } from './semantics/status';
import { statusFacts, type StatusFact } from './statusfacts';
import { anonSections, nodeSections } from './refs';
import { type Fact, fact, factOf, MESSAGES } from './messages';

/**
 * The status facts of a script, by line, computed once per status model and tree (both languages): the strings `eval`
 * runs are in the model of the script around them, in trees of their own.
 */
const statusFactCache = new WeakMap<StatusModel, WeakMap<SyntaxNode, Map<number, StatusFact[]>>>();

export { EXAMPLE_KINDS } from './analyzer-types';
export type { ContextEntry, Example, ExampleKind, ExampleSection, ExplainOptions, Kind, LineExplanation, Pos, ScriptProcess, Span, Token, TokenOrigin } from './analyzer-types';
import type { ExplainOptions, Kind, LineExplanation, Token } from './analyzer-types';
import { readingTree } from './reading';
import { claim, dropLabelEcho } from './tokenmarks';
import { type Explainer, LineExplainer, type Walk } from './explain/context';
import { has, intersects, isBlockLike, onLine, same, skeletal, sortTokens, summaryOf } from './explain/nodes';
import { globOff, resolve, shoptAt, specFor, unquotedWord } from './explain/reads';
import { groupSubshell } from './explain/where';
import { postfixStatusNote } from './explain/status';
import {
  arithChildren, arithNumber, arrayElement, braceWord, casePattern, commaNote, concatenationNote, globToken,
  simpleExpansion, string, subscript, valueNote, variable, word, wrapNote,
} from './explain/words';
import { fileRedirect, heredoc, herestring, redirected } from './explain/redirections';
import { binary, regexNode, test, unary } from './explain/tests';
import { caseExample, pipelineExample, titledExamples, wantsExample } from './explain/examples';
import { ansiCChildren } from './explain/embedded';
import { assignment, assignments } from './explain/assignments';
import { command, timeStatement } from './explain/commands';

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
      case 'command': return assignmentsOnly(n) ? assignments(this.cx, n) : command(this.cx, n);
      case 'time_statement': return timeStatement(this.cx, n);
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

export { lookupCommand };
