import { Lang, Text, tx } from './i18n';
import { idiomsFound, Redirect, simulateRedirects } from './idioms';
import { pitfallFindings } from './pitfalls';
import { wordFindings } from './wordfacts';
import { spanOf } from './noteanchors';
import { ancestor, assignmentSpan, assignmentsOnly, descendants, field, fields, prefixAssignments, readsVariable, redirectionsOf, token, wordsText } from './syntax/tree';
import type { NodeType, SyntaxNode, SyntaxTree } from './syntax/tree';
import { builtins } from './dict/builtins';
import { distroAliases } from './dict/distroAliases';
import { commands } from './dict/commands';
import { lookupCommand } from './dict/aliases';
import { ArgRole, ArgvParse, CommandRole, interpret, RoleAt, ValueRole } from './argv/interpret';
import type { CommandSpec, OperandSpec, VariableAct } from './argv/spec';
import { argWord, countOf } from './argv/words';
import { givenOptions, namespaceOf, values } from './argv/query';
import { explainRegex } from './embedded/regex';
import { globIntro, hasGlob } from './embedded/glob';
import { grepWrap, JsRegex, literalRegex, regexExamples, toJsRegex } from './examples/regex';
import { awkExample, awkInvocation, AwkRunOptions } from './examples/awk';
import { MAX_SHOWN_LINES, pipedOutput, pipelineExample, Stage } from './examples/pipeline';
import { InputSource, inputSource, knownLines, NO_INPUT, readsFiles, readOrder, shareOut, shownSource, SourceWord, Stdin, stdinOf, Stream, streamLabel } from './examples/source';
import { jqExample, JqFormat, jqPrint, jqReadsInputs, jqSample, Json, parseJsonValues, runJq, slurpLines, toJson, varyJson } from './examples/jq';
import { sedExample, sedPattern } from './examples/sed';
import { InputBox, Interactive, jqStepSections, RerunSpec } from './examples/rerun';
import { globExample, patternExample, testExample } from './examples/patterns';
import { braceExpand, GlobMode, GlobOpts, hasExtglob, hasGlobstar, isGlob } from './examples/shellwords';
import { pictureNote, visible } from './ctlchars';
import { commandExampleOf, dateExample, gitLogExample, interactive, ioExample, readExample } from './examples/commands';
import { explainEscapes } from './embedded/format';
import { describeFind, FindNode, parseFind } from './embedded/find';
import { type BracketTest, bracketShape, type CommandTest, commandTest, type TestExpr, type TestShape, testRange } from './testexpr';
import { judgeYq, yqNotes, yqSameAsJq } from './embedded/yq';
import { YamlStyle, YamlUnsupported, yamlLines, yqYamlOutput } from './examples/yaml';
import { YQ_SPECS, yqSpecsOf } from './dict/yq';
import { customCommandSpec } from './dict/custom';
import { DIRECTIVE } from './directives';
import { EmbeddedLang } from './embedded/types';
import { EMBEDDED, type EmbeddedContext } from './embedded/registry';
import { dialectFound, Shell } from './dialect';
import { arithLiteral, evalArith } from './arith';
import { isPlainWord, type Literal, literalContent, splitElement, staticWordText, staticWordValue } from './staticword';
import { explainExpansion } from './expansion-tokens';
import {
  binaryTestOps, extendedEqualOps, fdName, keywords, listOps,
  redirects, specialDestinations, specialVariables, unaryTestOps, wellKnownVariables,
} from './dict/syntax';
import { bracket as bracketLabel, labelText, shorten } from './label';
import { explainCommandSubstitution, explainProcessSubstitution, returnInSubstitution, scopeOf } from './substitution-tokens';
import { type ExecEnv, inFunction, STATEMENTS, reachOf, shellEffectOf, type SlotLink, slotEnvs, whereOf } from './semantics/env';
import { attribute, docLine, option, shellState } from './semantics/state';
import { lostVariable } from './semantics/pipeline';
import { readDeclarationWords } from './semantics/vars';
import { type NestedScript, plainReads, scriptSourceIndex } from './semantics/nested';
import { ExpansionStep, wordMeaning } from './semantics/words';
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
import type { Example, ExampleSection, ExplainOptions, Kind, LineExplanation, Span, Token } from './analyzer-types';
import { readingTree } from './reading';
import { claim, dropLabelEcho, readAsScript, readByCommand, scriptProcess } from './tokenmarks';
import { type Explainer, LineExplainer, memoKey, type Walk } from './explain/context';
import { fromEmbedded, has, intersects, isBlockLike, lineStarts, onLine, posOf, same, sameSpan, skeletal, sortTokens, summaryOf } from './explain/nodes';
import { given, globOff, hostCommand, ifsAt, inArithmetic, isAssoc, optionValues, regexFlavor, resolve, shoptAt, type ShoptName, specFor, trContext, unquotedWord, wordAt } from './explain/reads';
import { groupSubshell, shellEffectNote } from './explain/where';
import { postfixStatusNote, statusRangeNote } from './explain/status';
import {
  arithChildren, arithNumber, arrayElement, braceExpansion, braceVarNote, braceWord, braceWords, casePattern, commaNote, concatenationNote, globChildren, globNotes, globToken,
  notGlobbedHere, shown, simpleExpansion, string, subscript, tilde, tildeNote, valueNote, variable, word, wrapNote,
} from './explain/words';

export { isBlockLike, summaryOf };

/** A stage of a pipeline as the pipeline examples run it: whether it names a file to read, or reads one (`< f`). */
/** A stage of a pipeline example; `runs`: its operands are a command it runs (xargs), so its step shows the commands. */
type PipelineStage = { stage: Stage; file: boolean; readsFile: boolean; source: InputSource; runs: boolean };
/** The stages of pipelines read so far on the line (`pipelineStage`). */
const PIPELINE_STAGES = memoKey<PipelineStage | undefined>('pipeline stages');

export class Analyzer {
  /** The kind of string this analyzer explains, when it explains a string read as a script (`scriptTokens`). */
  private nested: NestedScript['kind'] | undefined;
  /** What the current `explainLine` call reads and collects (src/explain/context.ts); made new by each call, so nothing of another line is left. */
  private cx!: Explainer;
  /** The walk the context's line filter calls back. */
  private readonly walk: Walk = { explain: (n) => this.explain(n), flatten: (n) => this.flatten(n) };

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
      // Each -e of sed explains the same combined script, so drop repeated examples.
      examples: this.titledExamples(root, line, cx.examples)
        .filter((e) => this.wantsExample(e))
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

  /** The named sibling before `n`. */
  private previousNamed(n: SyntaxNode): SyntaxNode {
    const kids = n.parent!.namedChildren;
    return kids[kids.indexOf(n) - 1];
  }

  private subs(nodes: readonly (SyntaxNode | null | undefined)[]): Token[] {
    return this.cx.subs(nodes);
  }

  private full(n: SyntaxNode): Token {
    return this.cx.full(n);
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
      // `<<-END` / `<<END` as written (the operator may have a tab-stripping `-`).
      const operator = `${/<<-?/.exec(h.text)![0]}${delim}`;
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
      case 'command': return assignmentsOnly(n) ? this.assignments(n) : this.command(n);
      case 'time_statement': return this.timeStatement(n);
      case 'variable_assignment': return skeletal(this.assignment(n), n, true);
      case 'pipeline': return this.pipeline(n);
      case 'list': return this.list(n);
      case 'redirected_statement': return this.redirected(n);
      case 'file_redirect': return this.fileRedirect(n);
      case 'heredoc_redirect': return this.heredoc(n);
      case 'herestring_redirect': return this.herestring(n);
      case 'negated_command': return skeletal(this.tok(n, 'operator', this.t(keywords[n.namedChildren[0]?.type === 'pipeline' ? '! pipeline' : '!']), this.subs(n.namedChildren)), n);
      case 'extended_test': case 'arithmetic_command':
        if (n.type === 'arithmetic_command') postfixStatusNote(this.cx, n);
        return this.test(n);
      case 'unary_expression': return this.unary(n);
      case 'binary_expression': return this.binary(n);
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
      case 'ansi_c_string': return this.tok(n, 'string', this.s('`$\'…\'` 文字列: `\\n` `\\t` などのエスケープを解釈した文字列になる', '`$\'…\'` string: backslash escapes such as `\\n` are interpreted') + (/\\/.test(n.text) ? valueNote(this.cx, n) : ''), this.ansiCChildren(n));
      // (The model has the `$` and the string in one node; the string takes the `$` in.)
      case 'translated_string': return string(this.cx, n.namedChildren[0]);
      case 'concatenation': if (n.parent!.type === 'array' && splitElement(n.text)) return arrayElement(this.cx, n); return braceWord(this.cx, n) ?? this.tok(n, 'argument', concatenationNote(this.cx, n) + valueNote(this.cx, n), this.subs(n.namedChildren));
      case 'word': return braceWord(this.cx, n) ?? word(this.cx, n);
      case 'number': return arithNumber(this.cx, n) ?? this.tok(n, 'number', this.s('数値', 'Number'));
      // (`{1..x}` is not a brace expansion: it stays a word.)
      case 'brace_expression': return braceWord(this.cx, n) ?? word(this.cx, n);
      case 'array': return this.tok(n, 'expansion', this.s('配列: `( )` 内の要素から配列を作る', 'Array: built from the elements inside `( )`'), this.subs(n.namedChildren));
      case 'subscript': return subscript(this.cx, n);
      case 'regex': return this.regexNode(n);
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
    const vt = this.sub(v).map((t) => ({ ...t, explanation: this.s('照合する値: ', 'Value to match: ') + t.explanation }));
    for (const c of children) {
      if (c.kind === 'keyword' && c.label === 'in') c.explanation = this.s('値の後に、パターンごとの分岐を並べる', 'Introduces the list of pattern branches');
    }
    // `;&` and `;;&` change what happens after a match.
    const enders = n.namedChildren.flatMap((c) => c.children.filter((t) => t.type === ';&' || t.type === ';;&')).map((t) => t.type);
    const fall = !enders.length ? '' : this.s(
      `。ただしこの文には \`${[...new Set(enders)].join('\` と \`')}\` があり、分岐の終わりが \`;;\` なら終了、\`;&\` なら次の分岐の中身をパターンを調べずに実行、\`;;&\` なら次以降のパターンの照合を続ける`,
      `. This one has \`${[...new Set(enders)].join('\` and \`')}\`: a branch ending in \`;;\` stops the \`case\`, \`;&\` runs the next branch's commands without testing its pattern, and \`;;&\` goes on testing the patterns after it`);
    return skeletal(this.tok(n, 'keyword', this.s(
      `case 文: \`${v?.text}\` を各パターンと上から順に照合し、最初に一致した分岐を実行`,
      `case statement: match \`${v?.text}\` against each pattern in order and run the first match`,
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
      this.cx.examplesAt(n, () => this.caseExample(pats));
    }
    return skeletal(this.tok(n, 'pattern', expl + (prev && !isDefault ? this.s('。', '. ') + viaPrev : '') + this.lineRef(n), sortTokens([...patToks, ...rest])), n);
  }

  private pipeline(n: SyntaxNode): Token {
    // One example for the whole pipeline replaces the examples of its stages.
    const children = this.cx.examplesReplaced(() => this.ordered(n), () => {
      const whole = this.pipelineExample(n);
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

  /** A compound command (or `time`) with the redirections after it. */
  private redirected(n: SyntaxNode): Token {
    const body = field(n, 'body')!;
    // (A redirection the parser left without its operator and target is nothing to explain.)
    const redirs = redirectionsOf(n).filter((c) => c.children.length);
    return this.redirectedWhole(n, body, body.text, this.sub(body), redirs);
  }

  /**
   * `body` with redirections that apply to it as a whole: a compound command or `time` (`n` a `redirected_statement`),
   * or the assignments of a command with no name (`body` the first, `text` all of them), none when there are none
   * (`>f`). `bodyToks` explain it.
   */
  private redirectedWhole(n: SyntaxNode, body: SyntaxNode | undefined, text: string | undefined, bodyToks: Token[], redirs: SyntaxNode[]): Token {
    const effect = simulateRedirects(redirs.map((r) => this.redirectInfo(r)), this.lang);
    if (effect) this.cx.note(effect, redirs);
    const redirToks = this.subs(redirs);
    // `time >o`: the keyword carries its redirections.
    if (bodyToks.length === 1 && n.type === 'redirected_statement' && field(n, 'body')!.type === 'time_statement') {
      const t = bodyToks[0];
      return { ...t, span: spanOf(n), children: sortTokens([...t.children, ...redirToks]) };
    }
    // On a line where none of the redirections appear (e.g. a loop header), show the body alone.
    // The label still shows them: `while` *condition* `do` *commands* `done` `< input.txt`.
    if (this.cx.line !== null && redirToks.length === 0 && bodyToks.length === 1) {
      // On the first line of the construct, the redirections (on a later line) are children of the header: they apply to all of it.
      const header = body!.startPosition.row === this.cx.line && isBlockLike(body!);
      const t = { ...bodyToks[0] };
      if (header) t.children = sortTokens([...t.children, ...redirs.map((r) => this.wholeRedirect(r, body!))]);
      return skeletal(t, n);
    }
    // `f() { …; } >&2`: the redirection belongs to the function, not to its definition.
    const ofFunction = n.parent?.type === 'function_definition';
    const w = this.tok(n, 'redirect', this.s(
      `入出力のリダイレクト: ${text !== undefined ? `\`${shorten(text, 30)}\` 全体` : 'コマンド'}の入出力を切り替える${ofFunction ? '。関数に付けたリダイレクトは関数と一緒に保存され、関数を呼ぶたびに適用される' : ''}`,
      `Redirection applied to ${text !== undefined ? `\`${shorten(text, 30)}\` as a whole` : 'the command'}${ofFunction ? '. A redirection on a function is stored with it and applied each time the function is called' : ''}`,
    ), sortTokens([...bodyToks, ...redirToks]));
    w.summary = [...bodyToks.map(summaryOf), ...redirToks.map((r) => r.label)].join(' ');
    return skeletal(w, n);
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
    const effect = simulateRedirects(layout.redirs.map((r) => this.redirectInfo(r)), this.lang);
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

  /** Operator, descriptor and target of a redirection node, for `simulateRedirects`. */
  private redirectInfo(r: SyntaxNode): Redirect {
    if (r.type === 'file_redirect') {
      const { op, dest } = redirectParts(r);
      return { op, fd: field(r, 'descriptor')?.text ?? '', dest };
    }
    // The only others: heredoc_redirect and herestring_redirect.
    return { op: r.type === 'heredoc_redirect' ? '<<' : '<<<', fd: '', dest: '' };
  }

  private fileRedirect(n: SyntaxNode): Token {
    const fd = field(n, 'descriptor')?.text ?? '';
    const { op, dest } = redirectParts(n);
    const dests = fields(n, 'destination');
    // Every operator the grammar has is in the dictionary.
    let expl = this.t(redirects[op](fd, dest));
    const special = specialDestinations[dest];
    if (special) expl += this.s('。', '. ') + this.t(special);
    // `>&$fd` and `<&$fd`: the word is expanded first, and what it gives decides whether this duplicates a descriptor.
    if ((op === '>&' || op === '<&') && /[$`]/.test(dest)) expl = this.fdExpansion(op, fd, dest);
    if (fd === '2' && op === '>&' && dest === '1') {
      expl = this.s('標準エラー出力(fd 2)を標準出力(fd 1)と同じ出力先に向ける（エラーも一緒に出力・パイプする定番の書き方）',
        'Send stderr (fd 2) to wherever stdout (fd 1) goes (the classic way to capture errors too)');
    }
    if ((fd === '' || fd === '1') && op === '>&' && dest === '2') {
      expl = this.s('標準出力を標準エラー出力(fd 2)に向ける（メッセージをエラー出力に出す定番の書き方）',
        'Send stdout to stderr (the usual way to print an error message)');
    }
    const children = dests.filter((d) => !isPlainWord(d)).flatMap((d) => this.sub(d));
    if (dests.length === 1 && (isPlainWord(dests[0]) || dests[0].type === 'brace_expression') && /[*?[{]/.test(dests[0].text)) expl += this.redirectTargetNote(dests[0]);
    return this.tok(n, 'redirect', expl, children);
  }

  /**
   * A redirection target that brace expansion or a glob can turn into other words (`> *.log`, `> {a,b}`): it must
   * become exactly one word, else bash reports an ambiguous redirect. In POSIX mode it is not globbed.
   */
  private redirectTargetNote(d: SyntaxNode): string {
    const w = wordAt(this.cx, d);
    const step = (kind: string) => w?.steps.find((s) => s.kind === kind);
    if (step('brace')!.applies === true) {
      const words = braceExpansion(d.text);
      if (!words || words.length !== 1) return this.s('。ブレース展開で複数の単語になるので、bash は「ambiguous redirect」のエラーにする', '. Brace expansion makes several words of it, so bash reports "ambiguous redirect"');
    }
    const glob = step('glob')!;
    if (!hasGlob(d.text)) return '';
    if (glob.why === 'posix-mode') return globOff(this.cx, d);
    return glob.applies === true
      ? this.s(`。\`${d.text}\` はグロブなので、一致するファイルがちょうど1つならその名前になり、2つ以上なら「ambiguous redirect」のエラーになる（なければこの名前のまま）`,
        `. \`${d.text}\` is a glob: it becomes the one file it matches; matching two or more is an error ("ambiguous redirect"), and matching none leaves the name as it is`)
      : '';
  }

  /** A redirection after the closing word of a compound command, explained on the line where the construct starts: it applies to the whole construct. */
  private wholeRedirect(r: SyntaxNode, body: SyntaxNode): Token {
    const t = this.full(r);
    const kind = this.constructName(body);
    const { op, fd } = this.redirectInfo(r);
    const num = fd !== '' ? Number(fd) : op.startsWith('<') ? 0 : 1;
    const reads = op.startsWith('<') && num === 0;
    const writes = !op.startsWith('<') && (num === 1 || num === 2);
    t.explanation += this.s(
      `。${kind.ja}全体に付いている: 中のコマンドすべてに働く${reads ? '（標準入力を読むコマンド、たとえば `read` は、ここから読む。同じ入力を分け合うので、1つが読んだ分は次のコマンドには届かない）' : writes ? `（中のコマンドが${num === 1 ? '標準出力' : '標準エラー出力'}に出すものはここに出る）` : ''}`,
      `. It applies to the whole ${kind.en}: every command in it${reads ? ' that reads stdin, such as `read`, reads from here; they share this one input, so what one reads is not left for the next' : writes ? ` has its ${num === 1 ? 'stdout' : 'stderr'} sent here` : ' is affected'}`,
    );
    return t;
  }

  private constructName(body: SyntaxNode): { ja: string; en: string } {
    switch (body.type) {
      case 'while_statement': case 'for_statement': case 'c_style_for_statement': case 'select_statement': return { ja: 'ループ', en: 'loop' };
      case 'if_statement': return { ja: '`if` 文', en: '`if` statement' };
      case 'case_statement': return { ja: '`case` 文', en: '`case` statement' };
      case 'subshell': return { ja: 'サブシェル', en: 'subshell' };
      case 'compound_statement': return { ja: 'コマンドグループ', en: 'command group' };
      default: return { ja: 'コマンド', en: 'command' };
    }
  }

  /** `>&${COPROC[1]}`, `<&$fd`: a word that expands to a number is a descriptor to duplicate, not a file. */
  private fdExpansion(op: string, fd: string, dest: string): string {
    const coproc = /\bCOPROC\b/.test(dest)
      ? this.s('。`COPROC` は `coproc` が作る配列で、`[0]` がコプロセスの出力を読む側、`[1]` がコプロセスの入力に書く側のファイルディスクリプタ', '. `COPROC` is the array `coproc` fills in: `[0]` is the descriptor to read the co-process output from, `[1]` the one to write its input to')
      : '';
    if (op === '<&') {
      return this.s(
        `\`${dest}\` を展開した結果がファイルディスクリプタの番号なら、${fdName(fd, '0').ja}をそのディスクリプタの複製にする（入力元を共有）。数字でなければエラー（ambiguous redirect や Bad file descriptor）${coproc}`,
        `If \`${dest}\` expands to a file descriptor number, make ${fdName(fd, '0').en} a copy of it (sharing the input); anything else is an error (ambiguous redirect or Bad file descriptor)${coproc}`);
    }
    const file = fd && fd !== '1'
      ? this.s('数字でなければエラー（ambiguous redirect）', 'anything else is an error (ambiguous redirect)')
      : this.s('数字でなければファイル名とみなし、標準出力と標準エラー出力の両方をそのファイルに書き込む', 'anything else is taken as a file name, and both stdout and stderr are written to that file');
    return this.s(
      `\`${dest}\` を展開した結果がファイルディスクリプタの番号なら、${fdName(fd, '1').ja}をそのディスクリプタと同じ出力先に向ける。${file}${coproc}`,
      `If \`${dest}\` expands to a file descriptor number, send ${fdName(fd, '1').en} to the same place as that descriptor; ${file}${coproc}`);
  }

  private heredoc(n: SyntaxNode): Token {
    const op = n.children.find((c) => !c.named)!.type;
    const startNode = n.namedChildren.find((c) => c.type === 'heredoc_start');
    // `cat <<` while typing: the delimiter is not there yet.
    if (!startNode) {
      return this.tok(n, 'redirect', this.s(
        `ヒアドキュメント \`${op}\`: 区切り語がまだない。次の行から区切り語だけの行までを標準入力として渡す`,
        `Here-document \`${op}\`: the delimiter is not written yet. The following lines up to a line containing only the delimiter become stdin`));
    }
    const start = startNode.text;
    const body = n.namedChildren.find((c) => c.type === 'heredoc_body');
    const delim = start.replace(/^['"\\]|['"]$/g, '');
    const quoted = start !== delim;
    let expl = this.s(
      `ヒアドキュメント: 次の行から \`${delim}\` だけの行までを標準入力として渡す`,
      `Here-document: the following lines up to a line containing only \`${delim}\` become stdin`,
    );
    if (op === '<<-') expl += this.s('。`<<-` なので各行先頭のタブは取り除かれる', '. With `<<-`, leading tabs are stripped');
    expl += quoted
      ? this.s('。区切り語がクォートされているので本文中の変数やコマンド置換は展開されない', '. The delimiter is quoted, so nothing in the body is expanded')
      : this.s('。本文中の `$変数` や `$(…)` は展開される', '. `$vars` and `$(…)` in the body are expanded');
    expl += this.lineRef(n);
    const label = `${op}${start}`;
    // An empty here-document still has a (empty) body.
    const children = this.subs(body!.namedChildren.filter((c) => c.type !== 'heredoc_content'));
    // Keep the token span on the operator so highlighting does not swallow the whole body.
    return {
      kind: 'redirect', label, explanation: expl, children,
      span: { start: spanOf(n).start, end: spanOf(startNode).end },
    };
  }

  private herestring(n: SyntaxNode): Token {
    return this.tok(n, 'redirect', this.s(
      'ヒアストリング `<<<`: 続く文字列（末尾に改行が付く）を標準入力として渡す',
      'Here-string `<<<`: the following word (plus a newline) becomes stdin',
    ), this.subs(n.namedChildren.filter((c) => !isPlainWord(c))));
  }

  /**
   * A command with no name: its assignments (`a=1`, `a=1 b=2`), and any redirections between them; redirections
   * before the first or after the last (`a=1 2>/dev/null`, `>f`) apply to them as a whole.
   */
  private assignments(n: SyntaxNode): Token {
    const { inner, outer } = assignmentSpan(n);
    if (!outer.length) return this.assignmentList(n, inner);
    const text = inner.length ? n.text.slice(inner[0].startIndex - n.startIndex, inner[inner.length - 1].endIndex - n.startIndex) : undefined;
    const body = inner.length ? [this.assignmentList(n, inner)] : [];
    return this.redirectedWhole(n, inner[0], text, body, outer.filter((c) => c.children.length));
  }

  /** The assignments of a command with no name (and the redirections between them): one, or a token for all. */
  private assignmentList(n: SyntaxNode, inner: SyntaxNode[]): Token {
    const [only, ...rest] = inner;
    if (!rest.length) {
      const t = skeletal(this.assignment(only), only, true);
      return { ...t, refs: t.refs ?? nodeSections(only) };
    }
    const t = this.tok(n, 'assignment', this.s('複数の変数への代入', 'Several variable assignments'), this.subs(inner));
    t.refs = nodeSections(only);
    if (inner.length === n.namedChildren.length) return t;
    // (Redirections outside them: the token is the assignments' only.)
    const last = rest[rest.length - 1];
    return { ...t, span: { start: spanOf(only).start, end: spanOf(last).end }, label: shorten(n.text.slice(only.startIndex - n.startIndex, last.endIndex - n.startIndex)) };
  }

  /** An assignment; `decl`: an argument of a declaration that makes the name a nameref (`local -n r=$1`). */
  private assignment(n: SyntaxNode, decl = false): Token {
    const name = field(n, 'name')!;
    const value = field(n, 'value');
    const op = n.children.find((c) => !c.named && (c.type === '=' || c.type === '+='))!.type;
    const nm = name.text;
    let expl = op === '+='
      ? this.s(`変数 \`${nm}\` に値を追記する（配列なら要素を追加）`, `Append to variable \`${nm}\` (adds elements for arrays)`)
      : value
        ? (n.parent?.type === 'c_style_for_statement' ? this.s(`変数 \`${nm}\` に算術式の値を代入する（算術式の中なので、\`=\` の前後に空白を入れてよい）`, `Assign the value of the arithmetic expression to variable \`${nm}\` (in arithmetic, spaces around \`=\` are allowed)`) : this.s(`変数 \`${nm}\` に値を代入する（\`=\` の前後に空白は入れられない）`, `Assign a value to variable \`${nm}\` (no spaces around \`=\`)`))
        : this.s(`変数 \`${nm}\` に空文字を代入する`, `Set variable \`${nm}\` to the empty string`);
    // `local -n r=$1` makes `r` another name for the variable named by `$1`; every later `r=…` then sets that variable.
    // (In a declaration, the state has the attributes it gives: they apply before the value is assigned.)
    const st = this.cx.state.at(n).run;
    const ref = st.variables.get(nm)?.attrs.n;
    if (decl && value) {
      expl = this.s(`\`${nm}\` は参照（nameref）になる: 値 \`${value.text}\` を名前とする変数の別名で、\`${nm}\` への代入や参照は、その変数に対して行われる`,
        `\`${nm}\` becomes a nameref: another name for the variable whose name is the value \`${value.text}\`; assigning to or reading \`${nm}\` then acts on that variable`);
    } else if (!decl && ref?.state === 'on' && op === '=') {
      expl += this.s(`。ただし \`${nm}\` は行 ${(docLine(ref.at) + 1)} で nameref として宣言されているので、参照先の変数に代入される`,
        `. But \`${nm}\` is declared a nameref on line ${(docLine(ref.at) + 1)}, so this sets the variable it points to`);
    }
    // An integer variable (`declare -i n`) takes the value of an arithmetic expression, and `+=` adds.
    const integer = name.type !== 'subscript' && value && value.type !== 'array' && attribute(st, nm, 'i') === 'on';
    let intValueText: string | undefined;
    if (integer) {
      const v = evalArith(value.text);
      const calc = v === undefined || String(v) === value.text.trim() ? '' : ` = ${v}`;
      intValueText = this.s(`算術式として計算される${calc}`, `Evaluated as an arithmetic expression${calc}`);
      expl = op === '+='
        ? this.s(`整数変数 \`${nm}\` に値を足す（\`-i\` が付いているので文字列の連結ではなく算術式の足し算になる。\`${nm}\` が 7 なら \`+=1\` で 8 であり、71 ではない）`,
          `Add to the integer variable \`${nm}\` (it has \`-i\`, so this adds instead of appending text: if \`${nm}\` is 7, \`+=1\` makes 8, not 71)`)
        : this.s(`整数変数 \`${nm}\` に値を代入する（\`-i\` が付いているので、値は算術式として計算される）`,
          `Assign to the integer variable \`${nm}\` (it has \`-i\`, so the value is evaluated as arithmetic)`);
    }
    if (name?.type === 'subscript') {
      const arr = field(name, 'name')!.text;
      const idx = field(name, 'index')!.text;
      const v = evalArith(idx);
      const add = op === '+=';
      // With `declare -i`, `+=` on an element adds numbers; otherwise it appends text to the element.
      const toInt = add && attribute(st, arr, 'i') === 'on';
      const verb = (set: string, plus: string, plusInt: string): string => (toInt ? plusInt : add ? plus : set);
      if (isAssoc(this.cx, arr, n)) {
        const key = this.s(`連想配列 \`${arr}\` のキー \`${idx}\`（文字列で、計算はされない）の要素`, `the element of associative array \`${arr}\` with the key \`${idx}\` (a string, not evaluated)`);
        expl = this.s(`${key}${verb('に代入する', 'に値を追記する（文字列の連結）', 'に値を足す（`-i` が付いているので算術式の足し算）')}`,
          `${verb('Assign to ', 'Append to ', 'Add to ')}${key}${add && !toInt ? ' (text is appended to the existing value)' : toInt ? ' (it has `-i`, so this adds numbers)' : ''}`);
      } else {
        const el = v !== undefined && String(v) !== idx
          ? this.s(`配列 \`${arr}\` の要素 \`[${idx}]\`（算術式として計算すると ${v}）`, `element \`[${idx}]\` of array \`${arr}\` (an arithmetic expression: ${v})`)
          : this.s(`配列 \`${arr}\` の要素 \`[${idx}]\``, `element \`[${idx}]\` of array \`${arr}\``);
        expl = this.s(`${el}${el.endsWith('`') ? ' ' : ''}${verb('に代入する', 'に値を追記する（文字列の連結。`b` に `x` を足すと `bx`）', 'に値を足す（`-i` が付いているので算術式の足し算。7 に `+=1` で 8）')}`,
          `${verb('Assign to ', 'Append to ', 'Add to ')}${el}${add && !toInt ? ' (text is appended to the existing value: `b` plus `x` is `bx`)' : toInt ? ' (it has `-i`, so this adds numbers: 7 plus `+=1` is 8)' : ''}`);
      }
    }
    // `IFS` is the list of characters word splitting, `read` and `"${a[*]}"` use as separators.
    if (nm === 'IFS' && name?.type !== 'subscript' && !(n.parent?.type === 'command' && field(n.parent, 'name')?.text)) {
      const v = value ? staticWordValue(value) : '';
      expl += v === undefined
        ? this.s('。`IFS` は単語分割（と `read`）が区切りに使う文字の一覧で、`"${a[*]}"` と `"$*"` が要素をつなぐ文字（先頭の1文字）でもある', '. `IFS` lists the characters word splitting and `read` split on, and its first character joins the elements in `"${a[*]}"` and `"$*"`')
        : v === ''
          ? this.s('。`IFS` が空だと単語分割がされなくなる（`"${a[*]}"` と `"$*"` の要素は区切りなしでつながる）', '. An empty `IFS` turns word splitting off (the elements of `"${a[*]}"` and `"$*"` are joined with nothing between them)')
          : this.s(`。\`IFS\` は単語分割（と \`read\`）が区切りに使う文字の一覧: これ以降、クォートしない展開は \`${shown(v)}\` で分割される。\`"\${a[*]}"\` と \`"$*"\` は先頭の文字 \`${shown(v[0])}\` で要素をつなぐ`,
            `. \`IFS\` lists the characters word splitting (and \`read\`) split on: from here, unquoted expansions are split on \`${shown(v)}\`. \`"\${a[*]}"\` and \`"$*"\` join their elements with the first character, \`${shown(v[0])}\``);
    }
    const children: Token[] = [];
    if (value) {
      // (A `~` that bash expands keeps its own explanation: `x=~` is the home directory.)
      for (const t of this.sub(value)) {
        if (!(t.kind === 'expansion' && wordAt(this.cx, value)?.tildes.length) && isPlainWord(value) && !arithNumber(this.cx, value)) t.explanation = intValueText ? `\`${value.text}\`: ${intValueText}` : this.s(`代入する値 \`${value.text}\``, `Value \`${value.text}\``) + (hasGlob(value.text) ? notGlobbedHere(this.cx, value) : '');
        children.push(t);
      }
    }
    return this.tok(n, 'assignment', expl, children);
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

  /**
   * An option of a declaration builtin: what each letter gives, from the builtin's spec. `declare +x v` turns an
   * attribute off (its `offText`); `export` and `readonly` have no `+` form and their own letters. (A letter with no
   * text, or `+g`, says nothing.)
   */
  private declarationOption(a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' | 'cluster' }>): Token {
    const flags = (role.role === 'cluster' ? role.letters : [role]).flatMap((l) => (l.role !== 'option' ? [] : l.disables ? (l.spec.offText ? [l.spec.offText] : []) : [l.text]));
    return this.tok(a, 'option', flags.length ? flags.map((f) => this.t(f)).join(this.s('、', ', ')) : this.s('オプション', 'Option'));
  }

  /** The token of `--`, which ends the options of a builtin. */
  private endOfOptions(n: SyntaxNode): Token {
    return this.tok(n, 'option', this.s('オプションの終わり: 以降は `-` で始まっていても通常の引数として扱う', 'End of options: everything after is a plain argument'));
  }

  /** Whether the settings keep this example (examples.enabled / examples.disabled). */
  private wantsExample(e: Example): boolean {
    const o = this.cx.opts.examples;
    if (!o) return true;
    return o.enabled && !(e.kind && o.disabled.includes(e.kind));
  }

  /** When the line runs several commands, names the one each example is for in its title. */
  private titledExamples(root: SyntaxNode, line: number, examples: readonly Example[]): readonly Example[] {
    const commands = onLine(root, ['command', 'extended_test', 'arithmetic_command'], line)
      .filter((c) => intersects(c, line) && !assignmentsOnly(c));
    if (commands.length < 2) return examples;
    return examples.map((e) => {
      if (!e.target) return e;
      const target = `\`${e.target}\``;
      const title = this.lang === 'ja'
        ? e.title.replace(/^例/, `${target} の例`)
        : e.title.replace(/^Example/, `Example for ${target}`);
      return { ...e, title };
    });
  }

  // ---------------------------------------------------------------- commands

  private command(n: SyntaxNode): Token {
    // `>f echo x`, `<<<'1 2' read a b`: redirections before the words.
    const split = this.redirectLayoutOf(n);
    if (split) return split;
    // (`echo a > f b 2>&1`: a redirection among the words, and more of them.)
    const effect = simulateRedirects(redirectionsOf(n).map((r) => this.redirectInfo(r)), this.lang);
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
    const read = this.args(head.spec, args, head.runs ?? head.name, head.fn);
    let argToks = read.tokens;
    // `test` and `[` read their words as an expression (src/testexpr.ts), when the name runs one of them.
    const bracket = head.test?.closingOperand !== undefined;
    if (head.test) argToks = readByCommand(this.testArgs(n, commandTest(head.test, args, this.bashTest(head.test)), bracket));
    // (A function of the script is not the command its name suggests: no example of that command.)
    if (!head.fn) {
      this.unreadStdin(n, read.parse, args, head.name);
      this.commandExampleFor(n, head.spec, args, read.parse);
    }
    for (const a of args) {
      this.cx.examplesAt(a, () => this.wordExample(a));
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

  /**
   * The tokens of the arguments of `test` or `[` (`test`, from src/testexpr.ts): the expression, and the last `]` of `[`
   * (`bracket`). Where the expression is not known to be read (bash fails on it, or a word is not known), the words
   * are plain arguments: no condition is explained that may never be evaluated.
   */
  private testArgs(n: SyntaxNode, test: CommandTest, bracket: boolean): Token[] {
    const last = test.words[test.words.length - 1];
    // (`[ -f x]`, `[ -f $x]`: the `]` is glued to the last word. With a word not known, the pitfall says it.)
    const glued = bracket && !test.close && !!last && /\S\]$/.test(last.text);
    if (test.unclosed && glued) this.cx.note(fact(this.lang, 'bracket-close-glued', { word: last.text }), last);
    else if (test.unclosed) this.cx.note(fact(this.lang, 'bracket-missing-close'), n);
    if (test.malformed) this.cx.note(fact(this.lang, 'test-malformed', { name: bracket ? '[' : 'test' }), n);
    let inner: Token[];
    if (test.test && !test.unclosed && !glued) {
      this.testExample(n, bracketShape(test.test), '[');
      inner = this.testTokens(n, test.test, test.test.expr);
    } else inner = this.subs(test.words);
    if (!test.close) return inner;
    return [...inner, this.tok(test.close, 'argument', this.s('`[` に渡す最後の引数。`[` はこれで式の終わりを確かめる（ないとエラー）', 'The last argument passed to `[`. `[` checks it to find the end of the expression (without it, an error)'))];
  }

  /** Whether `test` (its spec, `testSpecOf`) is bash's builtin, which reads its words by bash's rules (`commandTest`). */
  private bashTest(test: CommandSpec): boolean {
    return !!test.builtin && (!this.cx.shell || this.cx.shell === 'bash');
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
      ? this.s('。ただし、この関数は新しいシェルに渡されないので、定義されているのは起動時に読むファイル（`-l`、`-i`、`BASH_ENV`）が定義する場合だけで、そうでなければ同じ名前のコマンドが動く',
        '. But this function is not passed to the new shell: it is defined there only if the files it reads at startup (`-l`, `-i`, `BASH_ENV`) define it; otherwise the command of that name runs')
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
        const same = missed.why === 'same-unit';
        this.cx.note(fact(this.lang, same ? 'alias-defined-same-unit' : 'alias-defined-later', { name, line: first + 1 }), nameNode);
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

  /**
   * Explain the argument words of a command: the argument interpreter (src/argv/interpret.ts) reads them
   * with the command's spec, and each word's role becomes a token.
   */
  private args(known: CommandSpec | undefined, args: SyntaxNode[], cmdName: string, isFn: boolean | 'maybe' = false): { tokens: Token[]; parse: ArgvParse } {
    // (A function's words are read with no spec: its options are unknown, and its operands are `$1`, `$2`….)
    const spec = known && !isFn ? known : NO_SPEC;
    const lookup = (name: string): CommandSpec | undefined => specFor(this.cx, name);
    const parse = interpret(spec, args.map(argWord), { name: cmdName, lookup });
    if (args.length) for (const [w, env] of slotEnvs(this.cx.state.env(args[0].parent!), parse, spec, args, lookup)) this.cx.slotEnvs.set(w, env);
    return { tokens: this.render(parse, spec, args, args, isFn), parse };
  }

  /**
   * The tokens of the words `nodes` (indexed as the interpreter's words) that `parse` reads with `spec`.
   * `words` are the words of this command, which the explanations of embedded languages look at.
   */
  private render(parse: ArgvParse, spec: CommandSpec, nodes: SyntaxNode[], words: SyntaxNode[], isFn: boolean | 'maybe' = false): Token[] {
    const out: Token[] = [];
    // The names set by `NAME=value` words before the wrapped command (`env FOO=1 cmd`).
    const assigned: string[] = [];
    // `set +o pipefail`: the values of an option turned off say so.
    let disables = false;
    // ssh: the words joined into the remote command have the text of its first word (eval's have none).
    let joined: string | undefined;
    // The joined words are one token, when they are read as a script.
    let joinedWhole = false;
    // Joined words not read as a script: the word that holds an expansion says why (`eval set -- "$args"`).
    let joinedNote: { at: SyntaxNode; note: string } | undefined;
    const ordinals = new Map<OperandSpec, number>();
    this.cx.withCommand({ cmd: parse.command, args: words, parse, nodes, spec }, () => {
      for (const { word, role } of parse.roles) {
        const a = nodes[word];
        switch (role.role) {
          case 'end-of-options':
            out.push(this.endOfOptions(a));
            break;
          case 'option':
          case 'unknown-option':
          case 'cluster':
            disables = (role.role === 'cluster' ? role.letters[0] as { flag: string } : role).flag.startsWith('+');
            out.push(DECLARATION_SPECS.has(spec) ? this.declarationOption(a, role) : this.optionToken(a, role, spec, parse));
            break;
          case 'pattern-option':
            out.push(this.tok(a, 'option', this.t(role.text), this.wordParts(a)));
            break;
          case 'open-option':
            out.push(this.tok(a, 'option', this.s(
              '実行時に決まるオプション（展開した結果を、コマンドがオプションとして読む）',
              'Options known only at run time (the command reads what the expansion gives as options)'), this.wordParts(a)));
            break;
          case 'value':
            out.push(this.valueToken(a, role, disables));
            break;
          case 'old-style': {
            const parts = role.letters.map((l) => {
              const letter = l as Extract<ArgRole, { role: 'option' }>;
              return this.part(a, letter, letter.flag, this.t(letter.text));
            });
            const style = spec.oldStyle!.style ? this.t(spec.oldStyle!.style) : this.s('旧式のオプション（ハイフンなし）', 'Old-style options (no dash)');
            out.push(this.tok(a, 'option', `${style}: ${parts.map((p) => `\`${p.label}\``).join(' ')}`, parts));
            break;
          }
          case 'terminator':
            out.push(this.tok(a, 'operator', role.text === '+'
              ? this.s('`-exec` の終わり: 見つかったファイルをまとめて1回のコマンドに渡す', 'End of `-exec`: pass all matches to one command invocation')
              : this.s('`-exec` の終わり: 見つかったファイル1件ごとにコマンドを実行（`;` はシェルに解釈されないようエスケープが必要）', 'End of `-exec`: run once per match (`;` must be escaped from the shell)')));
            break;
          case 'operand': {
            const n = role.spec ? (ordinals.get(role.spec) ?? 0) + 1 : 0;
            if (role.spec) ordinals.set(role.spec, n);
            out.push(this.operandToken(nodes, word, role, parse, spec, n, assigned, isFn));
            break;
          }
          case 'subcommand': {
            const note = this.s(`（シェルから見れば \`${parse.command}\` への引数で、\`${parse.command}\` 自身が解釈する）`, ` (to the shell it is an argument to \`${parse.command}\`, which interprets it itself)`);
            out.push(this.tok(a, 'subcommand', this.s(`サブコマンド \`${role.parse.command}\`: `, `Subcommand \`${role.parse.command}\`: `) + this.t(role.spec.summary) + note));
            out.push(...this.render(role.parse, role.spec, nodes, nodes.slice(word + 1, role.parse.end)));
            break;
          }
          case 'command':
            if (role.slot.later) {
              // A trap's action: a string this shell runs later, with its expansions then.
              out.push(this.withScript(this.positional(a, this.t(role.item!.text) + this.trapNote(a)), this.scriptTokens([a], this.cx.slotEnvs.get(a)!)));
            } else if (role.slot.joinsWords && !role.slot.escapesWords) {
              // ssh sends the words joined to the remote shell; eval joins them and reads them again here, so they are plain words.
              joined = role.slot.run === 'current-shell' ? undefined : this.t(role.item!.text);
              if (role.slot.run === 'current-shell') this.cx.command!.rereads = true;
              const words = nodes.slice(word, parse.end);
              this.slotNotes(role, this.cx.slotEnvs.get(a)!, words, assigned);
              const script = this.scriptTokens(words, this.cx.slotEnvs.get(a)!);
              joinedWhole = words.length > 1 && !!script.tokens.length;
              const at = script.note && !script.tokens.length ? words.find((w) => !staticWordText(w)) ?? a : a;
              if (at !== a) joinedNote = { at, note: script.note! };
              out.push(joinedWhole ? this.joinedScript(words, joined, script) : this.withScript(this.positional(a, joined), at === a ? script : { tokens: [] }));
            } else if (!role.parse) {
              // A command string (`bash -c 'cmd'`, `su -c 'cmd'`): the value of the option.
              this.slotNotes(role, this.cx.slotEnvs.get(a)!, [a], assigned);
              out.push(this.withScript(this.valueToken(a, { role: 'value', of: role.of ?? '-c', index: 0 }, false), this.scriptTokens([a], this.cx.slotEnvs.get(a)!)));
            } else out.push(this.wrapped(nodes, word, role, assigned));
            break;
          case 'joined':
            if (!joinedWhole) out.push(a === joinedNote?.at ? this.withScript(this.positional(a, joined), { tokens: [], note: joinedNote.note }) : this.positional(a, joined));
            break;
          case 'expression':
            // find's expression, read as a whole from its first word.
            if (word === parse.expression) out.push(...this.findExpression(nodes.slice(word, parse.end), spec.expressionSpec!));
            break;
        }
      }
    });
    return readByCommand(out);
  }

  /** The tokens of an expansion in a word read as an option (`-$opts`), if any. */
  private wordParts(a: SyntaxNode): Token[] {
    return isPlainWord(a) ? [] : this.sub(a);
  }

  /** The text of an option not in the dictionary. */
  private unknownOption(command: string, spec: CommandSpec, ambiguous?: string[]): string {
    if (spec.unknownOption) return this.t(spec.unknownOption);
    if (ambiguous) {
      const names = ambiguous.map((n) => `\`${n}\``).join(this.s('、', ', '));
      return this.s(`あいまいなオプション（先頭が同じ長いオプションが複数ある: ${names}）。${command.split(' ')[0]} は受け付けない`, `Ambiguous option (it starts several long options: ${names}); ${command.split(' ')[0]} refuses it`);
    }
    return this.s(`オプション（辞書に未登録。\`man ${command.split(' ')[0]}\` を参照）`, `Option (not in the dictionary; see \`man ${command.split(' ')[0]}\`)`);
  }

  /**
   * `set +x` is the opposite of `set -x`: what turning the option (or the option named by a value) off does; `off`
   * is what the spec says it does (`set +f`: globbing is on again), when that is more than undoing it.
   */
  private turnedOff(flag: string, what: string, value = false, off?: Text): string {
    const on = off ? this.t(off)
      : this.s(`元に戻す（${value ? '' : `\`${flag}\` は「`}${what}${value ? '' : '」'}）`, `turn it off again (${value ? '' : `\`${flag}\` is "`}${what}${value ? '' : '"'})`);
    return value ? on : this.s(`\`${flag}\` を解除: ${on}`, `Undo \`${flag}\`: ${on}`);
  }

  /** The token of an option word: one option, `--name=value`, or short options together (`-rn`, `-n5`, `-F'|'`). */
  private optionToken(a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' | 'cluster' }>, spec: CommandSpec, parse: ArgvParse): Token {
    if (role.role !== 'cluster' && role.value && !role.part) return this.equalsToken(a, role, spec, parse);
    if (role.role === 'cluster' || role.part) {
      const parts = (role.role === 'cluster' ? role.letters : [role]).flatMap((l) => this.letterParts(a, l, spec, parse));
      const flags = parts.filter((p) => p.kind === 'option');
      // `-F,` / `-n5`: one option with its value attached is not a combination.
      return this.tok(a, 'option', flags.length > 1
        ? this.s(`短いオプション ${flags.map((p) => `\`${p.label}\``).join(' ')} をまとめて指定`, `Combined short options ${flags.map((p) => `\`${p.label}\``).join(' ')}`)
        : flags[0].explanation, flags.length > 1 ? parts : parts.filter((p) => p.kind === 'argument'));
    }
    if (role.role === 'unknown-option') return this.tok(a, 'option', this.unknownOption(parse.command, spec, role.ambiguous));
    const flag = dash(role.flag);
    // `set -o` with no name lists the settings; `set +o` prints commands that restore them.
    const alone = role.missing ? role.spec.noValue : undefined;
    return this.tok(a, 'option', alone
      ? this.t(role.disables ? alone.offText : alone.text)
      : role.disables ? this.turnedOff(flag, this.t(role.text), false, role.spec.offText) : this.t(role.text), this.wordParts(a));
  }

  /** `--name=value` (and `-name=value` for single-dash options): the option, with its value in the text. */
  private equalsToken(a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' }>, spec: CommandSpec, parse: ArgvParse): Token {
    const value = role.value!;
    const whole = literalContent(a);
    const litEq = whole?.text.indexOf('=') ?? -1;
    const val = whole && litEq >= 0 ? whole.text.slice(litEq + 1) : a.text.slice(a.text.indexOf('=') + 1);
    const known = value.spec?.values?.[val];
    const valueLit: Literal | undefined = whole && litEq >= 0
      ? (whole.offsets ? { text: val, offsets: whole.offsets.slice(litEq + 1) } : { text: val, base: whole.base! + litEq + 1 })
      : undefined;
    const emb = value.spec?.lang && valueLit ? this.embeddedText(valueLit, value.spec.lang, a) : undefined;
    const extra = emb?.note ? ` — ${emb.note}` : '';
    const text = role.role === 'option' ? this.t(role.text) : this.unknownOption(parse.command, spec, role.ambiguous);
    return this.tok(a, 'option', text + this.s(`（値: \`${val}\`${known ? ' — ' + this.t(known) : ''}）`, ` (value: \`${val}\`${known ? ' — ' + this.t(known) : ''})`) + extra + this.splicedNote(value), emb?.tokens ?? []);
  }

  /** A letter of an option word (`-e` of `-euo`, `c` of `tar cf`), as a token over its character. */
  private part(a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' }>, label: string, explanation: string): Token {
    const [from, to] = role.part!;
    return this.span(a, from, to, 'option', explanation, label);
  }

  /** A token over the characters `from` to `to` of the value of the word `a`. */
  private span(a: SyntaxNode, from: number, to: number, kind: Kind, explanation: string, label: string): Token {
    const lit = literalContent(a);
    const at = (i: number): number => (lit?.offsets ? lit.offsets[i] : (lit?.base ?? 0) + i);
    const col = a.startPosition.column;
    const row = a.startPosition.row;
    return { kind, label, explanation, children: [], span: { start: { line: row, character: col + at(from) }, end: { line: row, character: to < 0 ? col + a.text.length : col + at(to - 1) + 1 } } };
  }

  /** The tokens of one letter of a cluster: the option, and the value written after it (`-n5`, `-i.bak`, `-F'|'`). */
  private letterParts(a: SyntaxNode, l: ArgRole, spec: CommandSpec, parse: ArgvParse): Token[] {
    const letter = l as Extract<ArgRole, { role: 'option' | 'unknown-option' }>;
    const flag = dash(letter.flag);
    if (letter.role === 'unknown-option') return [this.part(a, letter, flag, this.unknownOption(parse.command, spec))];
    const parts = [this.part(a, letter, flag, letter.disables ? this.turnedOff(flag, this.t(letter.text), false, letter.spec.offText) : this.t(letter.text))];
    const value = letter.value;
    if (!value) return parts;
    // In `-F'|'` the value is what is left after quote removal.
    const lit = literalContent(a);
    const val = lit ? lit.text.slice(value.attached) : a.text.slice(value.attached);
    // The value ends where its text ends, not at the closing quote (`-f='X${Package}'`: the label is `X${Package}`).
    const raw = this.span(a, value.attached!, lit && val ? lit.text.length : -1, 'argument', '', '');
    raw.label = lit && val ? val : a.text.slice(raw.span.start.character - a.startPosition.column);
    if (value.spec?.how === 'attached-only') {
      // `-i.bak`: the rest of the word is the value. In `-pie` that makes `e` the value, not `-e`.
      const trap = /^[a-zA-Z]/.test(val) && spec.options?.some((o) => o.names.includes('-' + val[0]))
        && this.s(`。注意: \`${val}\` は別のオプションではなく \`${flag}\` の値として扱われる`, `. Note: \`${val}\` is taken as the value of \`${flag}\`, not as more options`);
      raw.label = val;
      raw.explanation = this.s(`\`${flag}\` の値 \`${val}\``, `Value \`${val}\` for \`${flag}\``) + (trap || '');
      return [...parts, raw];
    }
    const known = value.spec?.values?.[val];
    const glued = lit && !isPlainWord(a);
    raw.explanation = (known ? `${val}: ${this.t(known)}` : this.s(`\`${flag}\` の値`, `Value for \`${flag}\``) + (glued ? this.s(`（クォートを外すと \`${val}\`）`, ` (\`${val}\` after quote removal)`) : '')) + this.splicedNote(value);
    // `-k3,3nr`, `-f2-4`: the attached value can be broken down like a separate one.
    const lang = value.spec?.lang;
    const emb = lang && lit ? this.embeddedText(lit.offsets ? { text: val, offsets: lit.offsets.slice(value.attached) } : { text: val, base: lit.base! + value.attached! }, lang, a) : undefined;
    if (emb) {
      raw.children = emb.tokens;
      if (emb.note) raw.explanation += ` — ${emb.note}`;
    }
    return [...parts, raw];
  }

  /** The token of an option's value in a word of its own (`-o pipefail`, `-e 's/a/b/'`, `--arg name value`). */
  private valueToken(v: SyntaxNode, role: ValueRole, disables: boolean): Token {
    const flag = dash(role.of);
    const spec = role.spec;
    let t: Token;
    // (`tar cf a.tar`: the value of the letter `f`.)
    const valueFor = /^-/.test(flag) ? this.s(`\`${flag}\` オプションの値`, `Value for \`${flag}\``) : this.s(`\`${flag}\` の値`, `Value for \`${flag}\``);
    if (spec?.lang) t = this.positional(v, valueFor + ': ' + this.t(role.option!.text), spec.lang);
    else {
      const known = spec?.values?.[v.text];
      t = this.tok(v, 'argument', known
        ? `${v.text}: ${disables ? this.turnedOff(v.text, this.t(known), true, spec!.offValues?.[v.text]) : this.t(known)}`
        : valueFor, this.wordParts(v));
    }
    // `jq --arg NAME VALUE`: two words follow; the first is the name.
    if (Array.isArray(role.option?.value) && role.option.value.length === 2) {
      const names = [this.s('名前', 'name'), this.s('値', 'value')];
      const name = names[role.index];
      t.explanation = this.s(`\`${flag}\` の${name}`, `${name[0].toUpperCase()}${name.slice(1)} for \`${flag}\``) + (role.index === 0 ? this.s('（フィルタでは `$` を付けて使う）', ' (use it as `$name` in the filter)') : '');
    }
    t.explanation += this.splicedNote(role);
    return t;
  }

  /**
   * A value whose words the program reads in its place (`env -S'-i bash -e'`): the words and what each is, or
   * why the program refuses it.
   */
  private splicedNote(v: ValueRole): string {
    const program = this.cx.command!.cmd.split(' ')[0].split('/').pop()!;
    if (v.refused) {
      const at = v.refused.at;
      const why: Record<typeof v.refused.error, string> = {
        quote: this.s('閉じるクォートがない', 'a quote is not closed'),
        'backslash-end': this.s('最後がバックスラッシュ', 'it ends in a backslash'),
        sequence: this.s(`\`${at}\` は使えないエスケープ`, `\`${at}\` is not an escape it knows`),
        'c-in-quotes': this.s('ダブルクォートの中に `\\c` がある', '`\\c` is inside double quotes'),
        dollar: this.s('`$` は `${名前}` の形でしか使えない', '`$` is only allowed as `${NAME}`'),
      };
      return this.s(`。⚠ ${program} はこの文字列を受け付けず、何も実行せずに終了ステータス 125 で終わる（${why[v.refused.error]}）`,
        `. ⚠ ${program} refuses this string and exits with status 125, running nothing (${why[v.refused.error]})`);
    }
    if (!v.split) return '';
    const { words, roles } = v.split;
    const shown = (k: number): string => {
      const w = words[k];
      return w.value !== undefined ? `\`${w.value}\`` : this.s(`\`${w.prefix}…\`（\`\${…}\` の値は実行時に決まる）`, `\`${w.prefix}…\` (the value of \`\${…}\` is known at run time)`);
    };
    const what = (role: ArgRole): string => {
      switch (role.role) {
        case 'option': case 'pattern-option': return this.t(role.text);
        case 'cluster': return role.letters.map(what).join(this.s('、', ', '));
        case 'value': return this.s(`\`${dash(role.of)}\` の値`, `value for \`${dash(role.of)}\``);
        case 'operand':
          if (role.spec?.assignment) return this.s('コマンドの環境に入れる変数', 'variable for the command');
          return role.spec ? this.t(role.spec.text) : this.s('引数', 'argument');
        case 'command': return this.s('実行するコマンド', 'the command to run') + (role.spec ? `: ${this.t(role.spec.summary)}` : '');
        case 'subcommand': return this.s('サブコマンド', 'subcommand') + `: ${this.t(role.spec.summary)}`;
        case 'end-of-options': return this.s('オプションの終わり', 'end of options');
        default: return this.s('辞書にないオプション', 'an option not in the dictionary');
      }
    };
    const items: string[] = [];
    const walk = (list: RoleAt[]): void => {
      for (const { word, role } of list) {
        items.push(`${shown(word)}${this.s(`（${what(role)}）`, ` (${what(role)})`)}`);
        if ((role.role === 'command' || role.role === 'subcommand') && role.parse) walk(role.parse.roles);
      }
    };
    walk(roles);
    if (!items.length) return this.s(`。${program} はこれを単語に分けるが、何も残らない`, `. ${program} splits it into no words`);
    return this.s(`。${program} はこれを単語に分けて、この位置で自分の引数として読む: ${items.join('、')}`, `. ${program} splits it into words and reads them here as its own arguments: ${items.join(', ')}`);
  }

  /** The token of an operand: what the spec says it is, numbered (`$1`), or as a job spec, a shell option, an assignment. */
  private operandToken(nodes: SyntaxNode[], word: number, role: Extract<ArgRole, { role: 'operand' }>, parse: ArgvParse, spec: CommandSpec, n: number, assigned: string[], isFn: boolean | 'maybe'): Token {
    const a = nodes[word];
    const item = role.spec;
    // `unset NAME`, `declare NAME=value`: what the name stands for, as bash decides it here.
    if (item?.acts === 'unsets') return this.unsetOperand(nodes, word, namespaceOf(parse, item), parse);
    if (item?.acts === 'declares') return this.declaredOperand(a, namespaceOf(parse, item));
    // `env FOO=1 cmd`: an assignment for the command, not the command.
    if (item?.assignment) {
      const name = a.text.slice(0, a.text.indexOf('='));
      assigned.push(name);
      return this.tok(a, 'argument', this.s(`環境変数 \`${name}\` の設定（実行するコマンドの環境にだけ入る）`, `Sets the variable \`${name}\` for the command to run`), this.wordParts(a));
    }
    // `%1`, `%%`, `%name`: a job, not a file or a PID.
    const job = item?.type === 'job' && isPlainWord(a) ? jobSpec(a.text) : undefined;
    if (job) return this.tok(a, 'argument', this.s(`ジョブ指定: ${job.ja}`, `Job spec: ${job.en}`));
    let desc: string | undefined;
    // (A function gets every word, also those that look like options: `f -g b` gives `b` as $2.)
    if (isFn) desc = this.s(`関数への引数 $${word + 1}`, `Argument $${word + 1} to the function`);
    else if (item?.values && Object.hasOwn(item.values, a.text)) desc = this.t(item.values[a.text]);
    else if (role.assignment) desc = this.t(item!.assignmentText!);
    else if (role.each) desc = this.eachText(a, role.each);
    else if (item) desc = this.t(item.text).replace('`$N`', `\`$${n}\``);
    if (desc && role.several) {
      const roles = role.several.map((o) => this.t(o.text)).join(this.s('、', ', then '));
      desc = this.s(`\`${a.text}\` が1語に展開されるなら${desc}、2語以上なら順に${roles}`, `${desc} when \`${a.text}\` expands to a single word; when it expands to more, they are ${roles}`);
    } else if (desc && role.otherwise) desc = this.uncertainText(desc, this.t(role.otherwise.text), parse, nodes);
    // (A function named like a declaration builtin, or `alias`, given `a=…`: bash's parser marked the word.)
    if (a.type === 'variable_assignment') return this.markedAssignment(a, desc ?? this.s(`引数 \`${a.text}\``, `Argument \`${a.text}\``), parse.command, isFn);
    return this.positional(a, desc, isFn ? undefined : item?.lang);
  }

  /**
   * `a=…` passed to a command that does not declare it, after a name written as a declaration builtin or `alias`:
   * a function of that name (`isFn`; `maybe`: defined on some paths only) or `alias`. bash expands it as an assignment
   * (not split), and gives it whole: nothing is assigned. `a=(…)` is assigned as an array, and the command gets the
   * name `a` only (`alias` then fails on it: `alias: a: not found`). `declare`, `local` and `typeset` assign it as the
   * builtin would, with its options (`-g`: global; else local in a function); `export`, `readonly` and `alias`, to the
   * variable visible here. Checked with bash 5.2.
   */
  private markedAssignment(a: SyntaxNode, desc: string, command: string, isFn: boolean | 'maybe'): Token {
    const name = field(a, 'name')!.text;
    const value = field(a, 'value');
    const sentences: string[] = [];
    if (value?.type === 'array') {
      // (`declare -g b=(…)`: the options count, as for the builtin.)
      const global = readDeclarationWords('declare', fields(a.parent!, 'argument')).on.includes('g');
      const assigns = !['declare', 'local', 'typeset'].includes(command)
        ? this.s(`bash は配列 \`${name}\` を代入する。代入先はここで見える変数（関数のローカル変数があればそれ、なければグローバル変数）で、属性は付かない`,
          `bash assigns the array \`${name}\`. It is the variable visible here: a local one if there is one, else the global one, with no attribute`)
        : global ? this.s(`bash は \`${command} -g\` と同じく、配列 \`${name}\` をグローバル変数として代入する`, `bash assigns the array \`${name}\` as \`${command} -g\` would: a global variable`)
          : this.s(`bash は \`${command}\` と同じく配列 \`${name}\` を代入する。関数の中ならそのローカル変数になる`, `bash assigns the array \`${name}\` as \`${command}\` would. In a function, it is a local variable`);
      if (!isFn) {
        sentences.push(assigns, this.s(`\`alias\` には名前 \`${name}\` だけが渡り、\`alias: ${name}: not found\` で失敗する`, `\`alias\` gets only the name \`${name}\`, and fails: \`alias: ${name}: not found\``));
      } else {
        sentences.push(isFn === 'maybe' ? this.s(`関数が動く場合、${assigns}`, `If the function runs, ${assigns}`) : assigns, this.s(`関数には名前 \`${name}\` だけが渡る`, `The function gets only the name \`${name}\``));
        if (isFn === 'maybe') sentences.push(this.s('動かなければビルトインが代入する', 'Otherwise the builtin assigns it'));
      }
    } else {
      sentences.push(this.s('コマンド名が宣言ビルトインの綴りなので、この語は代入と同じく展開される。単語分割もグロブ展開もされない', 'The command name is spelled as a declaration builtin, so this word is expanded as an assignment would be: no word splitting, no globbing'));
      sentences.push(isFn === 'maybe' ? this.s('関数が動くなら代入はされず、動かなければビルトインが代入する', 'If the function runs, nothing is assigned; otherwise the builtin assigns it')
        : this.s('代入はされない', 'Nothing is assigned'));
    }
    return this.tok(a, 'argument', [desc, ...sentences].join(this.s('。', '. ')), this.sub(value));
  }

  /**
   * A name that a declaration builtin declares (`OperandSpec.acts`): `declare a=1` assigns it (a nameref's target with
   * `-n`), `declare x` names the variable, `declare -f f` the function. A word that is not a plain name is explained
   * as its word (`\declare "a"=$v`: an argument, split as any other).
   */
  private declaredOperand(a: SyntaxNode, space: ReturnType<typeof namespaceOf>): Token {
    if (a.type === 'variable_assignment') {
      const t = skeletal(this.assignment(a, space === 'nameref'), a, true);
      t.refs = nodeSections(a);
      return t;
    }
    if (a.type !== 'word') return this.explain(a);
    const element = /^([A-Za-z_]\w*)\[(.+)\]$/s.exec(a.text);
    if (space === 'function' || !element) {
      return this.tok(a, 'variable', space === 'function' ? this.s(`関数 \`${a.text}\` を対象にする`, `Function \`${a.text}\``) : this.s(`変数 \`${a.text}\` を対象にする`, `Variable \`${a.text}\``));
    }
    const text = element[2] === '@' || element[2] === '*'
      ? this.s(`配列 \`${element[1]}\` の全要素`, `All elements of array \`${element[1]}\``)
      : this.s(`配列 \`${element[1]}\` の要素 \`[${element[2]}]\``, `Element \`[${element[2]}]\` of array \`${element[1]}\``);
    // (Unquoted, it is a glob first: `declare a[1]` with a file `a1` here declares the variable `a1`.)
    return wordAt(this.cx, a)?.steps.find((g) => g.kind === 'glob')?.applies !== false ? this.positional(a, this.nameGlob(a, a.text, text, 'declares')) : this.tok(a, 'variable', text);
  }

  /**
   * An operand of `unset` (`OperandSpec.acts`): what its name stands for comes from the spec's options (`space`: a
   * function with `-f`, a variable with `-v`, the name reference itself with `-n`), else the variable if there is one
   * here, or the function (src/semantics/state.ts). `a[1]` is an element of an array, and a glob pattern too when it
   * is not quoted. A variable that a prefix assignment of the command sets (`x=1 unset x`) is that temporary one: the
   * variable from before stays.
   */
  private unsetOperand(nodes: SyntaxNode[], word: number, space: ReturnType<typeof namespaceOf>, parse: ArgvParse): Token {
    const a = nodes[word];
    const fn = space === 'function';
    if (space === 'none') {
      // (Once for the command, at its first name.)
      if (parse.roles.find((r) => r.role.role === 'operand')!.word === word) this.cx.note(fact(this.lang, 'unset-function-and-variable'), a.parent!);
      return this.positional(a, this.s('削除する名前（`-f` と `-v` を同時に指定しているので、何も削除されない）', 'Name to unset (with both `-f` and `-v`, nothing is unset)'));
    }
    const plain = isPlainWord(a);
    // (An unquoted glob has no value known here: its text, which bash uses when no file matches.)
    const name = staticWordValue(a) ?? (plain ? a.text : undefined);
    if (name === undefined) return this.positional(a, this.t(builtins.unset.operands![0].pattern[0].text));
    const element = /^([A-Za-z_]\w*)\[(.+)\]$/s.exec(name);
    let text: string;
    if (fn) text = this.s(`関数 \`${name}\` を削除する`, `Remove the function \`${name}\``);
    else if (element) {
      text = element[2] === '@' || element[2] === '*'
        ? this.s(`配列 \`${element[1]}\` の要素をすべて削除する（配列は空で残る）`, `Remove all the elements of the array \`${element[1]}\` (it stays, empty)`)
        : this.s(`配列 \`${element[1]}\` の要素 \`${name}\` を削除する（ほかの要素の添字はそのまま）`, `Unset the element \`${name}\` of the array \`${element[1]}\` (the other elements keep their indices)`);
      // (Unquoted, it is a glob first: `unset a[1]` with a file `a1` here unsets the variable `a1`.)
      if (plain && hasGlob(a.text) && wordAt(this.cx, a)?.steps.find((g) => g.kind === 'glob')?.applies !== false) text = this.nameGlob(a, name, text, 'unsets');
    } else {
      const temp = space !== 'nameref' && prefixAssignments(a.parent!).find((c) => field(c, 'name')?.text === name);
      if (temp) {
        text = this.s(`\`${temp.text}\` がこのコマンドのためだけに設定した変数 \`${name}\` を削除する（コマンドの前から \`${name}\` があれば、それはそのまま残る）`,
          `Unset the variable \`${name}\` that \`${temp.text}\` set for this command only (a \`${name}\` set before the command, if any, stays as it was)`);
      } else {
        // `unset` removes a variable if there is one, else a function (`-v`: a variable; with `-n`, bash keeps the function).
        const st = this.cx.state.at(a.parent!).run;
        const declared = st.variables.get(name)?.declared ?? 'off';
        const kind = space !== 'either' || (st.functions.get(name)?.state ?? 'off') === 'off' ? 'variable'
          : declared === 'off' ? 'function' : declared === 'unknown' ? 'maybe' : 'variable';
        text = kind === 'function' ? this.s(`関数 \`${name}\` を削除する`, `Remove the function \`${name}\``)
          : space === 'nameref' ? this.s(`名前参照 \`${name}\` そのものを削除する（参照先の変数は残る）`, `Unset the name reference \`${name}\` itself (the variable it points to stays)`)
            : this.s(`変数 \`${name}\` を削除する（未定義の状態に戻す）`, `Unset the variable \`${name}\` (it becomes undefined)`);
        if (kind === 'maybe') text += this.s(`。変数がなければ、代わりに関数 \`${name}\` を削除する`, `. If there is no such variable, the function \`${name}\` is removed instead`);
        // A read-only variable stays: bash refuses (status 1).
        const readonly = kind === 'function' ? 'off' : attribute(st, name, 'r');
        if (readonly === 'on') {
          this.cx.note(fact(this.lang, 'unset-readonly', { name }), a);
          text = this.s(`変数 \`${name}\` は読み取り専用なので削除されない（エラー、終了ステータス 1）`, `The variable \`${name}\` is read-only, so it is not unset (an error, status 1)`);
        } else if (readonly === 'unknown') {
          text += this.s(`。ただし、この前の一部の経路では読み取り専用になっていて、そこでは削除されずエラーになる（終了ステータス 1）`, `. But some paths before here make it read-only, and there it is not unset (an error, status 1)`);
        }
      }
    }
    // (A plain name is the variable or function itself; a quoted one or a pattern keeps the explanation of its word.)
    return plain && !hasGlob(a.text) ? this.tok(a, 'variable', text) : this.positional(a, text);
  }

  /**
   * `unset a[1]`, `declare a[1]`, unquoted: a glob pattern first, as the glob options in effect say. A file that
   * matches is unset (declared) instead of the element (`text`); with nullglob, a word that matches nothing goes away;
   * with failglob, it is an error.
   */
  private nameGlob(a: SyntaxNode, name: string, text: string, acts: VariableAct): string {
    const shopt = shoptAt(this.cx, a);
    const quoted = `\`'${name}'\``;
    const [ja, en, enDo] = acts === 'unsets' ? ['削除', 'unset', 'unset'] : ['宣言', 'declared', 'declare'];
    if (shopt.failglob === 'on') {
      return this.s(`クォートしていないのでグロブとして展開される。一致するファイルがあればその名前を${ja}し、なければ failglob が有効なので \`no match\` のエラーになり何も${ja}されない。要素 \`${name}\` を${ja}するなら ${quoted} と書く`,
        `Unquoted, this is a glob pattern: a file that matches it has its name ${en}, and when none matches, failglob makes it an error (\`no match\`) and nothing is ${en}. To ${enDo} the element \`${name}\`, write ${quoted}`);
    }
    if (shopt.nullglob === 'on') {
      return this.s(`クォートしていないのでグロブとして展開される。一致するファイルがあればその名前を${ja}し、なければ nullglob が有効なのでこの単語はなくなり何も${ja}されない。要素 \`${name}\` を${ja}するなら ${quoted} と書く`,
        `Unquoted, this is a glob pattern: a file that matches it has its name ${en}, and when none matches, nullglob makes the word go away and nothing is ${en}. To ${enDo} the element \`${name}\`, write ${quoted}`);
    }
    const sometimes = shopt.failglob === 'unknown' || shopt.nullglob === 'unknown'
      ? this.s(`（nullglob や failglob が有効な経路では、一致しなければ何も${ja}されない）`, ` (on the paths where nullglob or failglob is on, nothing is ${en} when none matches)`) : '';
    return text + this.s(`。ただしクォートしていないので先にグロブとして展開され、一致するファイルがあればその名前を${ja}する${sometimes}（${quoted} と書く）`,
      `. Unquoted, it is a glob pattern first: if a file matches it, that file's name is ${en} instead${sometimes} (write ${quoted})`);
  }

  /**
   * The roles an operand may have, which depend on how many words the expansions among the operands give
   * (`cp *.txt dir`): `desc` when they give one word each, `other` when they give more.
   */
  private uncertainText(desc: string, other: string, parse: ArgvParse, nodes: SyntaxNode[]): string {
    // (Any word may be the one: `bash -c $cmd _ a`, where the string is unquoted.)
    const many = parse.roles.filter((r) => countOf(nodes[r.word])?.max !== countOf(nodes[r.word])?.min);
    const list = many.map((r) => `\`${nodes[r.word].text}\``).join(this.s('・', ', '));
    return this.s(`${list} が1語に展開されるなら${desc}、2語以上なら${other}`, `${desc} when ${list} expands to a single word; ${other} when it expands to more`);
  }

  /** The words a brace expansion gives, each with its role (`cp a{,.bak}`: the source, then the destination). */
  private eachText(a: SyntaxNode, each: OperandSpec[]): string {
    // `destination (the new name…)` reads `destination: the new name…` in the parentheses.
    const parts = braceExpand(a.text)!.map((w, k) => `\`${w}\`${this.s(`（${this.t(each[k].text).replace(/（(.*)）$/, ': $1')}）`, ` (${this.t(each[k].text).replace(/ \((.*)\)$/, ': $1')})`)}`);
    const list = `${parts.slice(0, -1).join(this.s('、', ', '))}${this.s('と ', ' and ')}${parts[parts.length - 1]}`;
    return this.s(`${list}に展開される`, `expands to ${list}`);
  }

  /** Words forming a command run by another command (sudo, xargs, find -exec…): the command, with its words read by its spec. */
  private wrapped(nodes: SyntaxNode[], word: number, role: CommandRole, assigned: string[]): Token {
    const parse = role.parse!;
    const words = nodes.slice(word, parse.end);
    const first = nodes[word];
    // `find -exec cmd {} ;`: the words up to the terminator.
    // (What the builtin it names would do to a shell: `sudo cd /x` cannot change this one.)
    const effect = shellEffectOf(role.spec, parse.roles.map((r) => [nodes[r.word], r.role] as const));
    this.slotNotes(role, this.cx.slotEnvs.get(first)!, words, assigned, effect);
    const name = first.text;
    let explanation = role.spec ? this.t(role.spec.summary) : this.s(`コマンド \`${name}\``, `Command \`${name}\``);
    let kind: Kind = role.spec?.builtin ? 'builtin' : 'command';
    // `command` skips functions, `builtin` looks at the builtins only (src/semantics/names.ts).
    if (role.slot.lookup && isPlainWord(first)) {
      const res = resolve(this.cx, name, first, { env: this.cx.slotEnvs.get(first) });
      // (A builtin, a file or nothing: `command` and `builtin` skip aliases and functions.)
      const missed = (res as { missed?: Missed }).missed;
      if (res.kind === 'none') {
        kind = 'command';
        explanation = res.disabled ? this.s(`行 ${docLine(res.disabled.at) + 1} の \`enable -n\` で組み込みの \`${name}\` は無効なので、\`builtin\` はエラーになる`, `\`enable -n\` on line ${docLine(res.disabled.at) + 1} turned the builtin \`${name}\` off, so \`builtin\` fails`)
          : this.s(`\`${name}\` は組み込みコマンドではないので、\`builtin\` はエラーになる`, `\`${name}\` is not a builtin, so \`builtin\` fails`);
      } else if (res.kind === 'file' && res.disabled) {
        // (`enable -n echo; command echo`: the program.)
        kind = 'command';
        const program = role.spec?.program;
        const line = (docLine(res.disabled.at) + 1);
        explanation = this.s(`外部コマンド \`${name}\`（行 ${line} の \`enable -n\` で組み込みは無効）${program ? `: ${this.t(program.summary)}` : ''}`,
          `the external command \`${name}\` (\`enable -n\` on line ${line} turned the builtin off)${program ? `: ${this.t(program.summary)}` : ''}`);
      }
      if (missed?.kind === 'function' && (missed.why === 'command' || missed.why === 'builtin')) {
        explanation += this.s(`（行 ${(docLine(missed.def) + 1)} の同じ名前の関数は使わない）`, ` (not the function of that name, defined on line ${(docLine(missed.def) + 1)})`);
      }
    }
    // `command [ -f x ]`, `env test -f x`: `test` and `[` read their words as an expression, when the name runs one of them.
    const value = staticWordValue(first);
    const res = value === undefined ? undefined : resolve(this.cx, value, first, { env: this.cx.slotEnvs.get(first) });
    const test = res && testSpecOf(res);
    const children = test ? this.testArgs(first.parent!, commandTest(test, words.slice(1), this.bashTest(test)), test.closingOperand !== undefined)
      : this.render(parse, role.spec ?? NO_SPEC, nodes, words.slice(1));
    if (role.of) {
      // `{}` is replaced by find (and `xargs -I{}`) with each path.
      const mark = (ts: Token[]) => ts.forEach((t) => {
        if (t.label === '{}') {
          t.explanation = this.s('`{}`: 見つかったファイルのパスに置き換わる', '`{}`: replaced with the path that was found');
          t.children = [];
        } else mark(t.children);
      });
      mark(children);
    }
    const span: Span = { start: spanOf(first).start, end: spanOf(words[words.length - 1]).end };
    return {
      kind, ...(res ? { name: nameInfo(this.lang, res, this.cx, first, this.cx.slotEnvs.get(first)) } : {}),
      label: shorten(name),
      explanation: (role.of ? this.s('実行するコマンド: ', 'Command to run: ') : '') + this.s(`\`${name}\` を実行: `, `runs \`${name}\`: `) + explanation,
      span, children, summary: `${name}: ${explanation}`,
    };
  }

  private positional(a: SyntaxNode, desc: string | undefined, lang?: EmbeddedLang): Token {
    const emb = lang && this.embedded(a, lang);
    if (emb && desc && emb.note) desc += ` — ${emb.note}`;
    if (isPlainWord(a)) {
      // Arguments in another language are positional ones the dictionary describes.
      if (emb) return this.tok(a, 'argument', desc!, emb.tokens);
      const brace = braceWord(this.cx, a);
      const base = brace ?? word(this.cx, a);
      if (!desc) return base;
      if (brace) return this.tok(a, 'argument', desc, [brace]);
      const tl = tilde(this.cx, a);
      // (Tildes after `=` and `:` come as a word with them as its children.)
      if (tl) return tl.kind === 'expansion' ? this.tok(a, 'argument', desc, [tl]) : this.tok(a, 'argument', desc + tildeNote(this.cx, a), tl.children);
      const off = hasGlob(a.text) && globOff(this.cx, a);
      if (off) return this.tok(a, 'argument', desc + off);
      const glob = hasGlob(a.text) ? ` — ${globIntro(this.lang, 'file')}` + globNotes(this.cx, a.text, a) : '';
      const t = this.tok(a, 'argument', desc + glob + valueNote(this.cx, a) + braceVarNote(this.cx, a.text), hasGlob(a.text) ? globChildren(this.cx, a, a.text, 0) : []);
      if (glob) t.refs = ['3.5.8'];
      return t;
    }
    const inner = this.sub(a);
    // The embedded tokens sit inside the quotes, so they become children of the string token.
    if (emb && inner[0]) inner[0].children = sortTokens([...inner[0].children, ...emb.tokens]);
    if (!desc) return inner[0];
    // Describe the role, then what the quoting/expansion does.
    return this.tok(a, 'argument', desc, inner);
  }

  /**
   * Explain the contents of a quoted or plain word written in another language (a regex, a sed
   * script…). Only literal text is handled: with expansions or escapes inside, the shell changes
   * the text before the command sees it, so offsets would not line up.
   */
  private embedded(a: SyntaxNode, lang: EmbeddedLang): { tokens: Token[]; note?: string } | undefined {
    const lit = literalContent(a, lang);
    return lit && this.embeddedText(lit, lang, a);
  }

  /** Explain `lit.text`, which sits inside `a` as `lit` describes (e.g. after `-k` in `-k3,3n`). */
  private embeddedText(lit: Literal, lang: EmbeddedLang, a: SyntaxNode): { tokens: Token[]; note?: string } | undefined {
    return this.cx.examplesAt(a, () => this.embeddedTextInner(lit, lang, a));
  }

  private embeddedTextInner(lit: Literal, lang: EmbeddedLang, a: SyntaxNode): { tokens: Token[]; note?: string } | undefined {
    // (A line the tool refuses runs no program: `grep -E -F PATTERN` reads the pattern in no flavour.)
    if (this.cx.command?.parse.refused) return undefined;
    const cx: EmbeddedContext = {
      lang: this.cx.lang,
      flavor: () => regexFlavor(this.cx),
      trSet: () => trContext(this.cx, a),
      // The letters given (`-lane`: l, a, n and e; `-pi.bak`: p and i).
      letters: () => new Set(givenOptions(this.cx.command!.parse).map(({ role }) => role.flag.slice(1))),
    };
    const r = EMBEDDED[lang](lit.text, cx);
    if (!r) return undefined;
    this.embeddedExample(lang, lit.text, a);
    return { tokens: r.tokens.map((t) => ({ ...fromEmbedded(t, a, lit, 'embedded'), language: lang })), note: r.note };
  }

  /** The worked example of an embedded text that the explainer read (src/embedded/registry.ts), when its language has one. */
  private embeddedExample(lang: EmbeddedLang, text: string, a: SyntaxNode): void {
    switch (lang) {
      case 'regex': {
        const flavor = regexFlavor(this.cx);
        const ignoreCase = given(this.cx, '-i');
        const js = flavor === 'fixed' ? literalRegex(text, ignoreCase) : toJsRegex(text, flavor, { ignoreCase });
        if (js) this.regexExample(grepWrap(js, given(this.cx, '-x'), given(this.cx, '-w')), given(this.cx, '-v') ? 'inverted' : 'lines');
        break;
      }
      case 'sed': {
        const flavor = regexFlavor(this.cx);
        // With several -e options sed runs them as one script, so the example does too.
        const scripts = this.sedScripts() ?? [text];
        const quiet = given(this.cx, '-n');
        // -z / --null-data: the "lines" are NUL-separated records, which the example runner does not model.
        const ex = given(this.cx, '-z') ? undefined : sedExample(scripts.join('\n'), { quiet, extended: flavor === 'ere' });
        if (ex) {
          // With `-s` or `-i`, sed works on each file apart: the example shows the first (`EachFile`).
          this.ioExample(ex.input, ex.output, {
            kind: 'sed', script: scripts.join('\n'), quiet, extended: flavor === 'ere',
            highlight: sedPattern(scripts.join('\n'), flavor === 'ere' ? 'ere' : 'bre'),
          }, this.inputSource());
        }
        break;
      }
      case 'jq': {
        // kislyuk/yq passes the filter to jq, but reads and (with -y) writes YAML.
        if (this.cx.command!.spec === YQ_SPECS.kislyuk) {
          this.yqExample(text, 'kislyuk');
          break;
        }
        const nullInput = given(this.cx, '-n');
        const rawInput = given(this.cx, '-R');
        const format = this.jqFormat();
        if (!format) break;
        const spec: Extract<RerunSpec, { kind: 'jq' }> = {
          kind: 'jq', filter: text, raw: given(this.cx, '-r'), join: given(this.cx, '-j'), slurp: given(this.cx, '-s') && !nullInput, vars: this.jqVars(), format,
          ...(nullInput ? { nullInput } : {}), ...(rawInput ? { rawInput } : {}),
        };
        // `-n`: jq reads no input, unless the filter's `input` or `inputs` reads it.
        const readBy = jqReadsInputs(text);
        this.jqExamples(spec, nullInput && !readBy ? NO_INPUT : this.inputSource(), readBy);
        break;
      }
      case 'awk': {
        const opts = this.awkOptions();
        const ex = opts && awkExample(text, opts);
        if (!ex) break;
        // A program of `BEGIN` rules alone reads no input.
        const src = ex.readsInput ? this.inputSource() : NO_INPUT;
        // The names of the files a glob gives are not known, so neither is what `FILENAME` holds.
        if (/\bFILENAME\b/.test(text) && src.streams.some((st) => st.kind === 'file' && st.many)) break;
        this.ioExample(ex.input, ex.output, { kind: 'awk', program: text, fs: opts!.fs, vars: opts!.vars, assigns: opts!.assigns }, src);
        break;
      }
      case 'yq4':
        this.yqExample(text, 'mikefarah');
        break;
      case 'gitformat':
      case 'gitdate':
        this.pushExample(gitLogExample(lang, text, this.cx.command!.parse, this.cx.command!.nodes.map((x) => literalContent(x)?.text), this.lang));
        break;
      case 'glob': {
        // Unlike the shell, find matches a leading dot with * too; -path also matches / with *.
        // The test before the pattern: -name, -path…
        const opt = this.previousNamed(a).text;
        if (!/^-i/.test(opt)) {
          this.globExample(a, text, 'value', this.s(`例（\`${opt}\` のパターン）`, `Example (the \`${opt}\` pattern)`),
            opt === '-name' ? [this.s('一致するファイル名', 'Matching names'), this.s('一致しないファイル名', 'Non-matching names')] : [this.s('一致するパス', 'Matching paths'), this.s('一致しないパス', 'Non-matching paths')]);
        }
        break;
      }
      case 'date':
        this.pushExample(dateExample(text, this.lang));
        break;
    }
  }

  /** The escapes inside `$'…'`, each with its meaning. */
  private ansiCChildren(n: SyntaxNode): Token[] {
    const lit: Literal = { text: n.text.slice(2, -1), base: 2 };
    return explainEscapes(lit.text, this.lang, 'ansic').map((t) => fromEmbedded(t, n, lit, 'shell'));
  }

  /**
   * find's expression, explained as a whole (`-o`, implicit `-a`, `!` and `\( \)` grouping) with the tokens
   * of each primary inside. When it cannot be parsed, its words are read as options of find.
   */
  private findExpression(nodes: SyntaxNode[], spec: CommandSpec): Token[] {
    const words = nodes.map((a) => staticWordValue(a) ?? a.text);
    const read = (from: number, to: number): Token[] => {
      const part = nodes.slice(from, to);
      return this.render(interpret(spec, part.map(argWord), { name: 'find', lookup: (name) => specFor(this.cx, name) }), spec, part, this.cx.command!.args);
    };
    // (No option of find has an optional value.)
    const tree = parseFind(words, (w) => {
      const o = spec.options!.find((x) => x.names.includes(w));
      return o?.until ? 'until' : o?.value ? 1 : 0;
    });
    if (!tree) return read(0, nodes.length);
    const exprArgs = nodes;

    const opTok = (idx: number, ja: string, en: string): Token[] => [this.tok(exprArgs[idx], 'operator', this.s(ja, en))];
    const build = (n: FindNode): Token[] => {
      switch (n.type) {
        case 'primary':
          return read(n.from, n.to + 1);
        case 'not':
          return [...opTok(n.op, '`!`: 直後の条件を否定する', '`!`: negates what follows'), ...build(n.child)];
        case 'group': {
          const inner = [
            ...opTok(n.open, '`\\(`: グループの開始（シェルに解釈されないよう `\\` でエスケープする）', '`\\(`: start of a group (escaped so the shell leaves it alone)'),
            ...build(n.child),
            ...opTok(n.close, '`\\)`: グループの終わり', '`\\)`: end of the group'),
          ];
          const span: Span = { start: spanOf(exprArgs[n.open]).start, end: spanOf(exprArgs[n.close]).end };
          return [{ kind: 'block', label: shorten(words.slice(n.open, n.close + 1).join(' ')), span, children: inner, explanation: this.s('グループ: 括弧の中を先にまとめて評価する', 'Group: evaluated as one condition') }];
        }
        case 'and':
        case 'or': {
          const ops = new Set(n.ops);
          const toks = n.children.flatMap(build);
          for (const o of ops) {
            toks.push(...(n.type === 'or'
              ? opTok(o, '`-o`: または（左右どちらかが真なら真。`-a` より優先順位が低い）', '`-o`: or (lower precedence than `-a`)')
              : opTok(o, '`-a`: かつ（省略しても同じ）', '`-a`: and (the default when omitted)')));
          }
          return sortTokens(toks);
        }
      }
    };
    const first = exprArgs[0];
    const last = exprArgs[exprArgs.length - 1];
    return [{
      kind: 'test', label: shorten(words.join(' ')), explanation: describeFind(tree, this.lang),
      span: { start: spanOf(first).start, end: spanOf(last).end }, children: build(tree),
    }];
  }

  /**
   * Whether mikefarah/yq's `-r` (`--unwrapScalar`) is on: it prints a string as it is, also in JSON. The last one given
   * wins; `-r=false` turns it off, as pflag reads a bool (`0`, `f`, `false` in any case).
   */
  private unwrapScalar(): boolean {
    const { parse, nodes } = this.cx.command!;
    const found = givenOptions(parse).filter(({ role }) => role.role === 'option' && role.spec.names.includes('-r'));
    if (!found.length) return false;
    return !/=(0|f|false)$/i.test(nodes[found[found.length - 1].word].text);
  }

  /** Strings that do and do not match `js` (as grep lines, inverted by -v, or `=~` values). */
  private regexExample(js: JsRegex, mode: 'lines' | 'inverted' | 'values'): void {
    const ex = regexExamples(js);
    if (!ex) return;
    const yes = ex.matching;
    const no = ex.nonMatching;
    let sections: ExampleSection[];
    if (mode === 'inverted') {
      sections = [
        { label: this.s('表示される行（一致しない行）', 'Printed (lines that do not match)'), lines: no },
        { label: this.s('表示されない行（一致する行）', 'Not printed (lines that match)'), lines: yes },
      ];
    } else if (mode === 'values') {
      sections = [{ label: this.s('一致する値', 'Matches'), lines: yes }, { label: this.s('一致しない値', 'Does not match'), lines: no }];
    } else {
      sections = [{ label: this.s('一致する行', 'Matching lines'), lines: yes }, { label: this.s('一致しない行', 'Non-matching lines'), lines: no }];
    }
    this.cx.example({ kind: 'regex',
      title: mode === 'inverted' ? this.s('例（`-v` なので一致しない行が表示される）', 'Example (with `-v`, lines that do not match are printed)') : this.s('例', 'Example'),
      sections: sections.filter((s) => s.lines.length),
      interactive: this.interactive({ kind: 'regex', regex: js, mode }, [{ label: this.s('試す文字列（1行ずつ判定し、一致した部分を色付け）', 'Test strings (one per line; matches are highlighted)'), lines: [...yes, ...no] }]),
    });
  }

  /** The scripts given to sed with -e/--expression, in order; undefined when there are none, or one is not plain text. */
  private sedScripts(): string[] | undefined {
    const scripts = optionValues(this.cx, '-e').map((v) => v.text);
    return scripts.length && scripts.every((t) => t !== undefined) ? scripts as string[] : undefined;
  }

  /** --arg / --argjson values of the current jq command. */
  private jqVars(): Record<string, Json> {
    const vars: Record<string, Json> = {};
    const args = optionValues(this.cx, '--arg', '--argjson');
    args.forEach(({ text: name, of, index }, i) => {
      // The name, then its value.
      const value = args[i + 1]?.index === 1 ? args[i + 1].text : undefined;
      if (index !== 0 || name === undefined || value === undefined) return;
      try {
        vars[name] = of === '--arg' ? value : JSON.parse(value);
      } catch {
        // Not valid JSON: leave it out, and the example will not be made.
      }
    });
    return vars;
  }

  /** Input and output of a yq expression, in the YAML each yq reads and prints. */
  private yqExample(filter: string, style: YamlStyle): void {
    // mikefarah/yq: only expressions made of operations that behave as in jq (checked against yq).
    if (style === 'mikefarah' && !yqSameAsJq(filter)) return;
    // `-n`: no input is read. With `-i`, mikefarah/yq writes its result into the first file, and kislyuk/yq rewrites
    // each file apart (`EachFile`).
    const src = shownSource(given(this.cx, '-n') ? NO_INPUT : this.inputSource());
    const inPlace = src.each === 'in-place' || src.each === 'into-first';
    // (The last `-o`, `-p` or `-I` wins, as pflag reads it.)
    const last = (...names: string[]) => {
      const found = optionValues(this.cx, ...names);
      return found.length ? found[found.length - 1].text ?? '?' : undefined;
    };
    const formatOf = (name: string) => ({ json: 'json', j: 'json', yaml: 'yaml', y: 'yaml' } as Record<string, string>)[name];
    let jsonIn = false;
    let json: boolean;
    let format: JqFormat | undefined;
    if (style === 'mikefarah') {
      // mikefarah/yq reads the format `-p` names, or the one of the first file's extension (YAML when it has none it
      // knows), and prints the format `-o` names, or the one of the extension. Formats other than JSON and YAML are not followed.
      const first = src.streams[0];
      const ext = first?.kind === 'file' ? /\.([^./]+)$/.exec(first.name)?.[1].toLowerCase() : undefined;
      const byExt = ext && ['xml', 'csv', 'tsv', 'toml', 'properties', 'props', 'ini', 'lua', 'hcl', 'env', 'kyaml'].includes(ext) ? '?' : ext === 'json' ? 'json' : 'yaml';
      const p = last('-p', '--input-format');
      const input = p === undefined ? byExt : formatOf(p);
      const o = last('-o', '--output-format');
      // (With `-p` and no `-o`, it prints YAML: v4.54 warns that it keeps this for backward compatibility.)
      const output = o === undefined ? (p === undefined ? input : 'yaml') : formatOf(o);
      if ((input !== 'json' && input !== 'yaml') || (output !== 'json' && output !== 'yaml')) return;
      jsonIn = input === 'json';
      json = output === 'json';
      // `-I`: the indent of JSON (0: one line); the YAML of another indent is not followed.
      const i = last('-I', '--indent');
      const indent = i === undefined ? 2 : Number(i);
      if (!Number.isInteger(indent) || indent < 0 || (!json && indent !== 2)) return;
      format = { indent };
    } else {
      json = !given(this.cx, '-y', '-Y');
      // kislyuk/yq passes `-c` and `-S` on to jq. (It has no `--indent`, the one way to an indent jq refuses.)
      format = this.jqFormat()!;
    }
    const raw = style === 'mikefarah' ? !json || this.unwrapScalar() : given(this.cx, '-r');
    let runs = jqExample(filter, { raw, nullInput: given(this.cx, '-n'), vars: style === 'kislyuk' ? this.jqVars() : {}, format });
    // Where jq stops with an error, mikefarah/yq is often lenient (it adds a string and a number), so show nothing.
    if (style === 'mikefarah') runs = runs?.filter((r) => !r.error);
    if (!runs?.length) return;
    const first = src.streams[0];
    const outLabel = !inPlace ? this.s(`出力（${json ? 'JSON' : 'YAML'}）`, `Output (${json ? 'JSON' : 'YAML'})`)
      : src.streams.length > 1 && first.kind === 'file' ? this.s(`書き換え後の \`${first.name}\``, `\`${first.name}\` after`) : this.s('書き換え後', 'After');
    const title = inPlace ? this.s('例（ファイルの中身がこう書き換わる）', 'Example (the file is rewritten like this)') : this.s('例', 'Example');
    const printJson = (vs: Json[]) => vs.flatMap((v) => jqPrint(v, format!, raw));
    const show = (vs: Json[]) => (json ? printJson(vs) : yqYamlOutput(vs, style));
    // A JSON file is shown as jq's input is: short values on one line.
    const inputLines = (v: Json) => (jsonIn ? (toJson(v).length <= 60 ? [toJson(v)] : JSON.stringify(v, null, 2).split('\n')) : yamlLines(v, style));
    if (src.streams.length > 1 || src.streams.some(knownLines) || src.reads) {
      this.yqStreams(filter, style, src, runs[0].input, show, { title, outLabel }, json, inputLines);
      return;
    }
    try {
      runs.forEach((r, i) => {
        const input = inputLines(r.input);
        const output = r.error ? [r.error] : show(r.values);
        this.cx.example({ kind: 'yq',
          title: inPlace || i === 0 ? title : this.s('例（値が無いとき）', 'Example (when the value is missing)'),
          ...(src.streams.length ? {} : { note: this.s('入力は読まない（`.` は `null`）', 'Reads no input (`.` is `null`)') }),
          sections: [
            ...(src.streams.length ? [{ label: streamLabel(src.streams[0], this.lang), lines: input }] : []),
            ...(r.steps && i === 0 ? jqStepSections(r.steps, output, this.lang, (vs) => (json ? vs.flatMap((v) => jqPrint(v, format!)) : yqYamlOutput(vs, style)))
              : [r.error ? { label: this.s('エラー', 'Error'), lines: output } : { label: outLabel, lines: output, empty: this.s('（出力なし）', '(no output)') }]),
          ],
        });
      });
      /* c8 ignore start */
    } catch (e) {
      // The sample inputs, and what filters make of them, fit in YAML so far: a guard.
      if (!(e instanceof YamlUnsupported)) throw e;
    }
    /* c8 ignore stop */
  }

  /**
   * The examples of a jq filter: the runs on sample input (`jqExample`), shown as read from `src`. Several files, or
   * the text of a here-string, make one example, run again on what each holds (src/examples/rerun.ts).
   */
  private jqExamples(spec: Extract<RerunSpec, { kind: 'jq' }>, src: InputSource, readBy: 'input' | 'inputs' | undefined): void {
    // The input as written in a file: short JSON on one line, longer JSON indented.
    const fileLines = (v: Json): string[] => (toJson(v).length <= 60 ? [toJson(v)] : JSON.stringify(v, null, 2).split('\n'));
    const { filter, nullInput, rawInput } = spec;
    // Several files, the text of a here-string, lines read as strings, or inputs read by the filter: one example, run on what each file holds.
    if (src.streams.length > 1 || src.streams.some(knownLines) || src.reads || rawInput || readBy) {
      let contents: string[][];
      const sample = jqSample(filter, { nullInput, rawInput });
      if (!sample) return;
      if (spec.slurp && !rawInput) {
        // A slurped sample is shared out among the files, when it has a value for each; otherwise each holds values like it.
        const [r] = jqExample(filter, { ...spec, vars: spec.vars }) ?? [];
        if (!r) return;
        let k = 0;
        contents = slurpLines(r.input).length >= src.streams.length ? shareOut(src, slurpLines(r.input))
          : src.streams.map((st) => knownLines(st) ?? slurpLines(varyJson(r.input, k++)));
      } else {
        // Each file holds a value like the sample (lines, with `-R`); a lone file read by `input` holds two.
        let k = 0;
        const each = rawInput || (readBy && !nullInput && src.streams.length === 1) ? 2 : 1;
        contents = src.streams.map((st) => knownLines(st) ?? Array.from({ length: each }, () => sample(k++)).flatMap((v) => (rawInput ? [v as string] : fileLines(v))));
      }
      const inputs: InputBox[] = src.streams.map((st, i) => ({ label: streamLabel(st, this.lang, nullInput ? readBy : undefined), lines: contents[i] }));
      // (A file named twice is read twice.)
      const it = this.interactive({ ...spec, ...(src.reads ? { reads: src.reads } : {}) }, inputs);
      // (An input the filter cannot run on here, such as one too few for `input`: no example.)
      if (it.result.sections.some((sec) => sec.lines.includes(this.s('（この入力では実行できません）', '(cannot run on this input)')))) return;
      this.cx.example({ kind: 'jq',
        title: this.s('例', 'Example'),
        sections: [...inputs.map((b) => ({ ...b, empty: this.s('（空）', '(empty)') })), ...it.result.sections],
        interactive: it,
      });
      return;
    }
    const runs = jqExample(filter, { ...spec, nullInput });
    runs?.forEach((r, i) => {
      const input = r.slurp ? slurpLines(r.input) : fileLines(r.input);
      const label = src.streams.length ? streamLabel(src.streams[0], this.lang) : '';
      this.cx.example({ kind: 'jq',
        title: i === 0 ? this.s('例', 'Example') : this.s('例（値が無いとき）', 'Example (when the value is missing)'),
        ...(src.streams.length ? {} : { note: this.s('入力は読まない（`.` は `null`）', 'Reads no input (`.` is `null`)') }),
        sections: [
          ...(src.streams.length ? [{ label, lines: input }] : []),
          ...(r.steps && i === 0 ? jqStepSections(r.steps, r.outputs, this.lang, (vs) => vs.flatMap((v) => jqPrint(v, spec.format!)))
            : [r.error
              ? { label: this.s('エラー', 'Error'), lines: [r.error] }
              : { label: spec.join ? this.s('出力（改行なし）', 'Output (no newlines)') : this.s('出力', 'Output'), lines: r.outputs, empty: this.s('（出力なし）', '(no output)') }]),
        ],
        // Only the first example can be edited; the second shows the missing-value case.
        ...(i === 0 && src.streams.length ? { interactive: this.interactive(spec, [{ label, lines: input }]) } : {}),
      });
    });
  }

  /**
   * The yq example of several files, or of the text of a here-string (when it is JSON, which is YAML too): what yq
   * prints for each. `sample` is the value of the sample input; the other files hold values like it.
   */
  private yqStreams(filter: string, style: YamlStyle, src: InputSource, sample: Json, show: (vs: Json[]) => string[], { title, outLabel }: { title: string; outLabel: string }, json: boolean, inputLines: (v: Json) => string[]): void {
    const vars = style === 'kislyuk' ? this.jqVars() : {};
    let k = 0;
    const docs: Json[][] = [];
    // mikefarah/yq keeps the style of the YAML it reads: JSON text read as YAML prints in flow style (`[1]`), which
    // the example does not follow.
    if (style === 'mikefarah' && !json && src.streams.some(knownLines)) return;
    for (const st of src.streams) {
      const known = knownLines(st);
      try {
        docs.push(known ? parseJsonValues(known.join('\n')) : [varyJson(sample, k++)]);
      } catch {
        // (YAML that is not JSON: the example cannot read it.)
        return;
      }
    }
    const results: Json[][] = [];
    // (A file named twice is read twice.)
    for (const vs of readOrder(src, docs)) {
      const outs: Json[] = [];
      for (const v of vs) {
        // (Values the line gives may make the filter fail, or take too long to run here.)
        const res = runJq(filter, v, vars);
        if (!res || 'error' in res) return;
        outs.push(...res.outputs);
      }
      results.push(outs);
    }
    // mikefarah/yq prints the documents of each file apart, with `---` between files, in YAML.
    const output = style === 'mikefarah' && !json
      ? results.flatMap((vs, i) => [...(i ? ['---'] : []), ...show(vs)])
      : show(results.flat());
    this.cx.example({ kind: 'yq',
      title,
      sections: [
        ...src.streams.map((st, i) => ({ label: streamLabel(st, this.lang), lines: knownLines(st) ?? inputLines(docs[i][0]) })),
        { label: outLabel, lines: output, empty: this.s('（出力なし）', '(no output)') },
      ],
    });
  }

  /**
   * How jq prints its results, from its options: two spaces a level, or one line (`-c`, `--indent 0`), a tab (`--tab`),
   * `--indent n` (the last of them wins), the keys in order (`-S`). Undefined for an indent jq refuses or not known.
   */
  private jqFormat(): JqFormat | undefined {
    const { parse, nodes } = this.cx.command!;
    const set = givenOptions(parse).flatMap(({ word, role }): [number, number | '\t' | undefined][] => {
      const names = role.role === 'option' ? role.spec.names : [];
      return names.includes('-c') ? [[word, 0]] : names.includes('--tab') ? [[word, '\t']] : [];
    });
    for (const { word } of values(parse, '--indent')) {
      const n = Number(literalContent(nodes[word])?.text ?? NaN);
      set.push([word, Number.isInteger(n) && n >= 0 && n <= 7 ? n : undefined]);
    }
    const indent = set.length ? set.sort((a, b) => a[0] - b[0])[set.length - 1][1] : 2;
    return indent === undefined ? undefined : { indent, ...(given(this.cx, '-S') ? { sortKeys: true } : {}) };
  }

  /** -F, -v and `name=value` operands of the current awk command (literal values only); undefined when the example cannot follow them. */
  private awkOptions(): (AwkRunOptions & { vars: Record<string, string> }) | undefined {
    const words = this.cx.command!.args.map((a) => literalContent(a)?.text);
    const inv = awkInvocation(words);
    // Options awk has more of (`--posix`, `-W …`) do not change what the example shows.
    if (inv.unsupported && !inv.unsupported.startsWith('awk -')) return undefined;
    return { fs: inv.fs, vars: inv.vars, assigns: inv.assigns };
  }

  /** Sample data run through every stage of a pipeline, showing what each stage leaves. */
  private pipelineExample(n: SyntaxNode): Example | undefined {
    // A pipeline is explained on the line it is on, or whole (see sub).
    const p = this.pipelineStages(n);
    if (!p) return undefined;
    const { stages, files, readsFile, src, runs } = p;
    // A later stage that reads a file does not read what the stages before it write (`printf … | grep -e -v foo`).
    if (files.slice(1).some(Boolean)) return undefined;
    // Several files read as one stream; a first stage that works on each apart (`EachFile`: head, grep) is not
    // followed, nor one that reads a file twice.
    const streams = src.streams;
    if (streams.length > 1 && src.each) return undefined;
    if (src.reads) return undefined;
    const known = streams.length === 1 ? knownLines(streams[0]) : undefined;
    const ex = pipelineExample(stages, readsFile || !!known, known);
    if (!ex) return undefined;
    const cap = (lines: string[]) => (lines.length > MAX_SHOWN_LINES ? [...lines.slice(0, MAX_SHOWN_LINES - 1), '…'] : lines).map(visible);
    const sections: ExampleSection[] = [];
    const inputs: InputBox[] = ex.input ? shareOut(src, ex.input).map((lines, i) => ({ label: streamLabel(streams[i], this.lang), lines })) : [];
    sections.push(...inputs.map((b) => ({ label: b.label, lines: cap(b.lines), empty: this.s('（空）', '(empty)') })));
    ex.steps.forEach((step, i) => {
      // `cat file` passes the input on unchanged.
      if (step.stage.copies && i < ex.steps.length - 1) return;
      const last = i === ex.steps.length - 1;
      const label = runs.has(step.stage)
        ? this.s(`\`${step.stage.text}\` が実行するコマンド`, `Commands run by \`${step.stage.text}\``)
        : last ? this.s(`出力（\`${step.stage.text}\` の後）`, `Output (after \`${step.stage.text}\`)`)
          : this.s(`\`${step.stage.text}\` の後`, `After \`${step.stage.text}\``);
      sections.push({ label, lines: cap(step.output), empty: this.s('（なし）', '(nothing)') });
    });
    return {
      title: this.s('例（パイプライン全体）', 'Example (the whole pipeline)'), sections,
      // Data from a file can be edited; data made by echo or seq cannot.
      ...(inputs.length ? { interactive: this.interactive({ kind: 'pipeline', stages }, inputs) } : {}),
    };
  }

  /**
   * The stages of pipeline `n` (the first `count`), as the pipeline examples run them: whether each names a file to
   * read, whether the first reads one (`< f`), and what the first reads. Undefined for a stage they cannot follow.
   */
  private pipelineStages(n: SyntaxNode, count = n.namedChildren.length): { stages: Stage[]; files: boolean[]; readsFile: boolean; src: InputSource; runs: ReadonlySet<Stage> } | undefined {
    const read: PipelineStage[] = [];
    for (const [i, cmd] of n.namedChildren.slice(0, count).entries()) {
      const st = this.pipelineStage(n, cmd, i);
      if (!st) return undefined;
      read.push(st);
    }
    return { stages: read.map((st) => st.stage), files: read.map((st) => st.file), readsFile: !!read[0]?.readsFile, src: read[0]?.source, runs: new Set(read.filter((st) => st.runs).map((st) => st.stage)) };
  }

  /**
   * Stage `i` of pipeline `n`, read once per line (`PIPELINE_STAGES`): the stdin of each stage is what the stages before it
   * print, so reading every prefix again would take exponential time in the number of stages.
   */
  private pipelineStage(n: SyntaxNode, cmd: SyntaxNode, i: number): PipelineStage | undefined {
    const stages = this.cx.memo(PIPELINE_STAGES);
    if (stages.has(cmd)) return stages.get(cmd);
    const read = ((): PipelineStage | undefined => {
      if (cmd.type !== 'command') return undefined;
      let readsFile = false;
      // `grep x < file` reads a file; output redirections other than 2>/dev/null change where data goes, wherever they
      // are written (`>f grep x`, `grep >f x`). (Those of the last stage change where the result goes; the example
      // still shows what the stages make.)
      for (const r of i === n.namedChildren.length - 1 ? [] : redirectionsOf(cmd)) {
        const op = r.children.find((x) => !x.named)?.type;
        if (r.type === 'file_redirect' && op === '<' && i === 0) readsFile = true;
        // (The text of a here-string or a here-document is the first stage's input: `inputSource` reads it.)
        else if ((r.type === 'herestring_redirect' || r.type === 'heredoc_redirect') && i === 0 && (field(r, 'descriptor')?.text ?? '0') === '0') continue;
        else if (!(r.type === 'file_redirect' && field(r, 'descriptor')?.text === '2')) return undefined;
      }
      const name = field(cmd, 'name');
      // (An incomplete `echo a |` has a stage with a name of no word.)
      if (!name || (name.namedChildren.length && !isPlainWord(name.namedChildren[0]))) return undefined;
      // A stage that runs a function or an alias of the script is not the program its name suggests (as in commandTail).
      if (['function', 'alias'].includes(resolve(this.cx, name.text, name).kind)) return undefined;
      const args = cmd.namedChildren.filter((x) => !same(x, name) && !prefixAssignments(cmd).includes(x) && x.field !== 'redirect');
      const spec = specFor(this.cx, name.text);
      const stage: Stage = { cmd: name.text.split('/').pop()!, words: args.map((a) => literalContent(a)?.text), text: shorten(stageText(cmd), 40), ...(spec?.copies ? { copies: true } : {}) };
      const parse = interpret(spec ?? NO_SPEC, args.map(argWord), { name: name.text, lookup: (x) => specFor(this.cx, x) });
      const source = this.inputSource(cmd, parse, args, spec);
      // A stage that writes its output to a file (`sort -o f`) hands nothing on.
      const runs = !!spec?.operands?.some((alt) => alt.pattern.some((o) => o.command));
      return source.writes ? undefined : { stage, file: readsFiles(parse, stage.words), readsFile, source, runs };
    })();
    stages.set(cmd, read);
    return read;
  }

  /** The example of a run of the command, when its spec has one (`CommandSpec.example`: printf, xargs, sort…). */
  private commandExampleFor(n: SyntaxNode, spec: CommandSpec | undefined, args: SyntaxNode[], parse: ArgvParse): void {
    const kind = spec?.example;
    if (!kind) return;
    if (kind === 'read') {
      this.readExample(n, args);
      return;
    }
    const src = this.inputSource(n, parse, args, spec);
    // A command that prints what it reads as it is (cat) shows what it does when it joins several streams (`cat a - b`).
    if (spec.copies && src.streams.length < 2 && !src.reads) return;
    this.pushExample(commandExampleOf(kind, args.map((a) => ({ value: literalContent(a)?.text, text: a.text })), this.lang, src));
  }

  /**
   * What a command reads (src/examples/source.ts): the files its words name as its input, or its standard input, from
   * the syntax around it. By default, the command whose words are being read (`cx.command`).
   */
  private inputSource(cmd?: SyntaxNode, parse?: ArgvParse, nodes?: SyntaxNode[], spec?: CommandSpec): InputSource {
    const ctx = this.cx.command!;
    const words = (nodes ?? ctx.nodes).map((a): SourceWord => {
      const value = literalContent(a)?.text;
      const glob = wordAt(this.cx, a)?.steps.find((st) => st.kind === 'glob');
      return { value, text: a.text, ...(value === undefined ? { many: 'unknown' as const } : glob && glob.applies !== false ? { many: 'glob' as const } : {}) };
    });
    return inputSource(parse ?? ctx.parse, words, this.stdinOf(cmd ?? ctx.args[0].parent!), parse ? spec : ctx.spec);
  }

  private stdinOf(cmd: SyntaxNode): Stdin {
    // (A here-string's word is not split or globbed: `$'b\na'` is two lines.)
    return stdinOf(cmd, (w) => literalContent(w)?.text ?? staticWordValue(w), (p, i) => this.pipedLines(p, i));
  }

  /**
   * What the stages of pipeline `n` before the one at `index` print, when it is known: the first reads the text the
   * line gives it (a here-string or a here-document) or prints it (echo, printf), and none reads a file.
   */
  private pipedLines(n: SyntaxNode, index: number): string[] | undefined {
    const p = this.pipelineStages(n, index);
    if (!p || p.readsFile || p.files.some(Boolean)) return undefined;
    return pipedOutput(p.stages, knownLines(p.src.streams[0]));
  }

  /** A note when the command reads files it names, so not the standard input the line gives it (`jq . a.json < b.json`). */
  private unreadStdin(n: SyntaxNode, parse: ArgvParse, args: SyntaxNode[], name: string): void {
    const src = this.inputSource(n, parse, args);
    const file = src.streams.find((st): st is Extract<Stream, { kind: 'file' }> => st.kind === 'file');
    if (!src.unread || !file) return;
    const u = src.unread;
    const stdin: Text = u.from === 'file' ? tx(`\`< ${u.name}\``, `\`< ${u.name}\``)
      : u.from === 'pipe' ? tx('パイプで渡される前のコマンドの出力', 'the output of the previous command, through the pipe')
        : (u as Extract<Stdin, { from: 'here' }>).doc ? tx('ヒアドキュメント', 'the here-document') : tx('ヒアストリング', 'the here-string');
    this.cx.note(fact(this.lang, 'stdin-not-read', { cmd: name.split('/').pop()!, file: file.name, stdin }), n);
  }

  /** How `read` splits a sample line into its variables (with the IFS in effect, or the one given before it). */
  private readExample(n: SyntaxNode, args: SyntaxNode[]): void {
    let ifs = ifsAt(this.cx, n);
    for (const c of n.namedChildren) {
      if (c.type !== 'variable_assignment' || field(c, 'name')?.text !== 'IFS') continue;
      const v = field(c, 'value');
      const lit = v ? literalContent(v) : { text: '' };
      ifs = lit?.text.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
      if (ifs === undefined) break;
    }
    // The line the command reads, when a here-string gives it: `read -a p <<< "a,b,,c,"`.
    const here = n.namedChildren.find((c) => c.type === 'herestring_redirect')?.namedChildren[0];
    const r = readExample(args.map((a) => literalContent(a)?.text), ifs, here && literalContent(here)?.text, this.lang);
    if (!r) return;
    if (r.note) this.cx.note(r.note, n);
    this.cx.example(r.example);
  }

  /** Brace expansion results, or file names a glob matches, for an argument word. */
  private wordExample(a: SyntaxNode): void {
    const text = unquotedWord(a);
    if (!text) return;
    const words = braceExpansion(text);
    if (words === null) return;
    if (words) {
      this.cx.example({ kind: 'glob',
        title: this.s(`例（ブレース展開 \`${text}\`）`, `Example (brace expansion \`${text}\`)`),
        sections: [{ label: this.s('展開後の単語', 'Resulting words'), lines: (words.length > 12 ? [...words.slice(0, 11), '…'] : words).map((w) => w || "''") }],
      });
      return;
    }
    // (Where globstar may be on, the example shows `**` at any depth, and says so.)
    const maybe = hasGlobstar(text) && shoptAt(this.cx, a).globstar === 'unknown';
    if (isGlob(text) && !globOff(this.cx, a)) this.globExample(a, text, 'file', this.s(`例（グロブ \`${text}\`${maybe ? '、globstar が有効なとき' : ''}）`, `Example (glob \`${text}\`${maybe ? ', where globstar is on' : ''})`));
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

  /** How globs match on this line: file names, or `case` and `[[ == ]]` patterns (`find -name` takes neither). */
  private globOpts(use: 'file' | 'pattern' | 'none', n: SyntaxNode): GlobOpts {
    const shopt = shoptAt(this.cx, n);
    const on = (name: ShoptName) => shopt[name] === 'on';
    if (use === 'file') {
      // (`**` reaches any depth with globstar on; where it may be on, the example says so.)
      const o: GlobOpts = { globstar: on('globstar') || shopt.globstar === 'unknown', dotglob: on('dotglob'), nocase: on('nocaseglob') };
      return Object.fromEntries(Object.entries(o).filter(([, v]) => v));
    }
    return use === 'pattern' && on('nocasematch') ? { nocase: true } : {};
  }

  private globExample(n: SyntaxNode, pattern: string, mode: GlobMode, title: string, labels?: [string, string]): void {
    // A name that matches a pattern of GLOBIGNORE is left out.
    const ignore = mode === 'file' ? wordAt(this.cx, n)?.glob.globignore : undefined;
    this.pushExample(globExample(pattern, mode, this.globOpts(mode === 'file' ? 'file' : 'none', n), typeof ignore === 'object' ? ignore.value : undefined, title, labels, this.lang));
  }

  private pushExample(ex: Example | undefined): void {
    if (ex) this.cx.example(ex);
  }

  /** An example's editable form for the panel (src/examples/commands.ts). */
  private interactive(spec: RerunSpec, inputs: InputBox[]): Interactive {
    return interactive(spec, inputs, this.lang);
  }

  /** Values that select a case branch (any of its patterns) and values that do not. */
  private caseExample(pats: SyntaxNode[]): void {
    this.patternExample(pats, [this.s('この分岐に入る値', 'Values that take this branch'), this.s('入らない値', 'Values that do not')]);
  }

  /** Values that match any of the glob patterns (`case` branches, the right side of `[[ == ]]`) and values that do not: found with the matcher of `case`. */
  private patternExample(pats: SyntaxNode[], labels: [string, string]): void {
    const texts = pats.map((p) => unquotedWord(p) ?? (p.type === 'extglob_pattern' ? p.text : undefined));
    this.pushExample(patternExample(texts, this.globOpts('pattern', pats[0]), labels, this.lang));
  }

  /** Values that make a simple `[ ]` / `[[ ]]` / `(( ))` test true and false. */
  private testExample(n: SyntaxNode, bracket: TestShape | undefined, asKind?: '['): void {
    this.pushExample(testExample(n, bracket, asKind, this.lang));
  }

  /** An input → output example (sed, awk, perl, sort…; src/examples/commands.ts). */
  private ioExample(input: string[], output: string[], spec: RerunSpec, src: InputSource): void {
    this.cx.example(ioExample(input, output, spec, this.lang, src));
  }

  /**
   * `x=1; bash -c 'echo "$x"'`: a variable of this script that a string run by another shell reads (in single
   * quotes, so that shell expands it), which that shell does not get: it is not exported, or a link on the way
   * passes no variables (`env -i`, sudo, ssh: src/semantics/env.ts). Not one the string sets itself, nor one the
   * command or a wrapper sets for it (`x=1 bash -c …`, `env x=1 …`), nor one from the environment or set by that shell (`$_`).
   */
  private unpassedVariables(env: ExecEnv, words: SyntaxNode[]): void {
    // The string, read as the script it is (src/semantics/state.ts): the variables it reads, and whether each
    // reached it there (passed by the slots, or set by the string itself before the read).
    const script = this.cx.state.script(words, env);
    if ('why' in script) return;
    const cmd = ancestor(words[0], (x) => x.type === 'command')!;
    const st = this.cx.state.at(cmd).run;
    const { variables, blocker } = reachOf(env);
    const remote = whereOf(env) === 'remote';
    // (Only `$v` and `${v}`: `${v:-x}`, `${v+x}` and `${#v}` are fine with no value. A file of variables may give any.)
    if (env.links.some((l) => l.kind === 'slot' && l.assigns.includes('*'))) return;
    for (const { name: v, at: e } of plainReads(script)) {
      const x = st.variables.get(v);
      if (!x || x.set !== 'on' || wellKnownVariables[v] || specialVariables[v] || script.model.at(e).run.variables.has(v)) continue;
      const exported = x.attrs.x?.state ?? 'off';
      if (variables === 'none') {
        this.cx.note(remote
          ? fact(this.lang, 'variable-not-in-remote-shell', { v })
          : fact(this.lang, 'variable-not-passed-by-wrapper', { v, via: blocker!.via }), words[0]);
        return;
      }
      if (exported === 'off') {
        this.cx.note(fact(this.lang, 'variable-not-exported', { v }), words[0]);
        return;
      }
    }
  }

  /**
   * Pitfalls of a command that another one runs (`words`, from its first word), which follow from how its slot runs
   * it. A separate program (`exec`: sudo, xargs, find -exec…) cannot run a shell function or a builtin that
   * only changes the shell, and `$NAME` of its words is read before the wrapper sets `NAME`; in a container,
   * the script's functions are not there. A new shell (`shell-string`: bash -c, su -c, ssh) does not have the
   * script's functions, and the words ssh joins are expanded here before they are sent. The current shell
   * (`current-shell`: eval, command, builtin) runs both. `env` is where the command runs (src/semantics/env.ts):
   * its last link is this slot, and what reaches it is what every link on the way passes on.
   */
  private slotNotes(role: CommandRole, env: ExecEnv, words: SyntaxNode[], assigned: string[], effect?: 'changes' | 'exits'): void {
    const { slot } = role;
    const link = env.links[env.links.length - 1] as SlotLink;
    const via = link.via;
    const where = whereOf(env);
    // (The first link that passes no exported functions: `env -i`, `su -`, sudo, a container.)
    const { blocker } = reachOf(env);
    const first = words[0];
    const name = first.text;
    // A function of the script that the slot does not run (src/semantics/names.ts): even one defined later.
    const isFn = isPlainWord(first) && (resolve(this.cx, name, first, { env }) as { missed?: Missed }).missed?.kind === 'function';
    if (slot.run === 'exec' && where === 'container') {
      if (isFn) {
        this.cx.note(fact(this.lang, 'function-not-in-container', { via, name }), first);
      }
    } else if (slot.run === 'exec') {
      // (A builtin with a program of its name runs the program: the slot gave its spec.)
      if (isPlainWord(first) && (isFn || role.spec?.builtin)) {
        const fix = isFn && blocker
          ? tx(`関数の中身を直接書くか、\`${via} bash -c "$(declare -f ${name}); ${name}"\` のように定義ごと渡します（\`${blocker.via}\` は環境の関数を渡さないので、\`export -f\` は効きません）`,
            `Write out its body, or pass the definition along: \`${via} bash -c "$(declare -f ${name}); ${name}"\` (\`${blocker.via}\` passes no exported functions, so \`export -f\` does not help)`)
          : isFn
          ? tx(`\`export -f ${name}\` してから \`bash -c '${name} "$@"' _ …\` のようにシェル経由で呼びます`, `Run \`export -f ${name}\`, then call it through a shell: \`bash -c '${name} "$@"' _ …\``)
          : effect === 'changes'
            ? tx(`サブシェル \`(${name} … && …)\` か、\`${via} sh -c '${name} … && …'\` を使います`, `Use a subshell \`(${name} … && …)\`, or \`${via} sh -c '${name} … && …'\``)
            : tx(`\`${via} sh -c '${name} …'\` のようにシェル経由で呼びます（今のシェルの状態を変えるものは、別のプログラムでは変えられません）`, `Go through a shell, as in \`${via} sh -c '${name} …'\` (what changes the state of the current shell cannot be changed by another program)`);
        this.cx.note(fact(this.lang, 'builtin-or-function-as-program', { via, name, isFn, fix }), first);
      }
    } else if (slot.run === 'shell-string' && where === 'remote') {
      // (A word this shell expands before ssh joins the words: src/semantics/words.ts.)
      const risky = words.find((w) => wordMeaning(w, this.cx.state)!.steps.some((x) => LOCAL_EXPANSIONS.has(x.kind) && x.applies !== false));
      if (risky) {
        this.cx.note(fact(this.lang, 'ssh-local-expansion', { risky: risky.text }), risky);
      }
      this.unpassedVariables(env, words);
      if (isFn) {
        this.cx.note(fact(this.lang, 'function-not-on-remote', { name }), first);
      }
    } else if (slot.run === 'shell-string') {
      this.unpassedVariables(env, words);
      // The commands of the string that name a function of this script, when the string is read as a script
      // (src/semantics/state.ts), but not one the string defines itself (`bash -c 'f() { …; }; f'`); otherwise the
      // first word of the string, when it is known (`su -c 'f arg'`).
      const script = this.cx.state.script(words, env);
      let fn: string | undefined;
      if (!('why' in script)) {
        const own = new Set(descendants(script.tree.root, ['function_definition']).map((d) => field(d, 'name')!.text));
        fn = descendants(script.tree.root, ['command']).filter((c) => !assignmentsOnly(c)).map((c) => staticWordValue(field(c, 'name')!.namedChildren[0]))
          .find((n) => n !== undefined && !own.has(n) && this.cx.state.definitions.functions.has(n));
      } else {
        const lit = literalContent(first)?.text;
        fn = lit ? /^\s*([A-Za-z_][\w-]*)/.exec(lit)?.[1] : undefined;
      }
      // What the string's first word runs in the new shell (src/semantics/names.ts): this script's function only
      // when every link passes the exported functions (not `su -c`, `env -i bash -c f`, `sudo bash -c f`) and the
      // shell reads them (bash, not dash). (A function exported on some paths only is taken as exported.)
      const res = fn && this.cx.state.definitions.functions.has(fn) ? resolve(this.cx, fn, first, { env }) : undefined;
      const missed = res && res.kind !== 'keyword' && res.kind !== 'alias' ? res.missed : undefined;
      const shell = link.shell!;
      if (res && res.kind !== 'function') {
        const f = fn!;
        this.cx.note(missed?.why === 'not-passed' && blocker !== link
          ? fact(this.lang, 'function-not-in-new-shell-blocked', { via, fn: f, blocker: blocker!.via })
          : missed?.why === 'not-passed'
          ? fact(this.lang, 'function-not-in-new-shell', { via, fn: f })
          : missed?.why === 'not-imported'
          ? fact(this.lang, 'function-not-imported', { via, shell, fn: f })
          : fact(this.lang, 'function-not-in-new-shell-export', { via, fn: f }), first);
      } else if (missed?.why === 'not-imported') {
        // (`sh` is dash on Debian and Ubuntu, bash elsewhere.)
        this.cx.note(fact(this.lang, 'function-not-imported-sh', { via, fn: fn! }), first);
      }
    }
    for (const v of assigned) {
      const use = words.find((w) => readsVariable(w, v));
      if (use) {
        this.cx.note(fact(this.lang, 'wrapper-assignment-expanded-first', { use: use.text, via, v }), use);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- tests

  private arithTestExplanation(): string {
    return this.s('算術評価 `(( ))`: 式を計算し、結果が 0 以外なら成功(0)を返す', 'Arithmetic evaluation `(( ))`: succeeds if the result is non-zero');
  }

  private test(n: SyntaxNode): Token {
    // Includes examples from inside the test, such as the regex of `=~`.
    return this.cx.examplesOf(n, () => {
      // A test over several lines is explained whole (see sub), so it is always where the line starts.
      const open = n.children[0].type;
      this.testExample(n, undefined);
      const expl = open === '[['
        ? this.s('拡張条件式 `[[ ]]`: 条件を評価し、真なら成功(0)を返す（bash 専用。コマンドではなくシェルの構文なので、中で単語分割・グロブ展開が起きず、変数をクォートしなくても安全。`&&` `||` `<` `=~` も使える）',
          'Extended test `[[ ]]`: evaluates a condition (bash-only; shell syntax, not a command, so there is no word splitting or globbing inside and variables are safe unquoted; `&&`, `||`, `<` and `=~` work too)')
        : this.arithTestExplanation() + commaNote(this.cx, n);
      const children = open === '((' ? arithChildren(this.cx, n) : this.subs(n.namedChildren);
      const t = Object.assign(this.tok(n, 'test', expl, children), open === '[[' ? { name: nameInfo(this.lang, { kind: 'keyword', name: '[[' }, this.cx, n) } : {});
      t.summary = this.s(`条件判定 ${shorten(n.text, 40)}`, `test ${shorten(n.text, 40)}`);
      skeletal(t, n, true);
      return t;
    });
  }

  /** The tokens of a `[ ]` test read as bash reads it (see testexpr.ts). */
  private testTokens(n: SyntaxNode, b: BracketTest, e: TestExpr): Token[] {
    const words = b.words;
    const slice = (from: number, to: number) => n.text.slice(words[from].nodes[0].startIndex - n.startIndex, words[to].nodes[words[to].nodes.length - 1].endIndex - n.startIndex);
    const [first, last] = testRange(e);
    const make = (kind: Kind, explanation: string, children: Token[]): Token => ({
      kind, label: shorten(slice(first, last)), explanation, children,
      span: { start: spanOf(words[first].nodes[0]).start, end: spanOf(words[last].nodes[words[last].nodes.length - 1]).end },
    });
    // Operators and parentheses are not nodes to explain; they get no token of their own, but a word that is one does.
    const wordTokens = (i: number) => words[i].nodes.flatMap((x) => this.sub(x));
    const operandTokens = (i: number, plain: (x: SyntaxNode) => boolean) => this.subs(words[i].nodes.filter((x) => !plain(x)));
    switch (e.type) {
      case 'word': return wordTokens(e.at);
      case 'not': {
        const [from, to] = testRange(e.operand);
        return [make('test', this.s(`否定: \`${slice(from, to)}\` が偽なら真`, `Negation: true if \`${slice(from, to)}\` is false`), this.testTokens(n, b, e.operand))];
      }
      case 'group': return [make('operator', this.s('括弧でまとめた式', 'Parenthesized expression'), this.testTokens(n, b, e.inner))];
      case 'unary': {
        const d = unaryTestOps[words[e.op].text!];
        return [make('test', this.s(`条件: \`${slice(e.arg, e.arg)}\` が${this.t(d)}`, `Condition: \`${slice(e.arg, e.arg)}\` ${this.t(d)}`), operandTokens(e.arg, isPlainWord))];
      }
      case 'binary': {
        const op = words[e.op].text!;
        const num = this.numericTestNote(op, [slice(e.left, e.left), slice(e.right, e.right)], false);
        return [make('test', this.s(
          `条件: \`${slice(e.left, e.left)}\` と \`${slice(e.right, e.right)}\` を比較 — ${this.t(binaryTestOps[op])}${num}`,
          `Condition: \`${slice(e.left, e.left)}\` vs \`${slice(e.right, e.right)}\` — ${this.t(binaryTestOps[op])}${num}`,
        ), [...operandTokens(e.left, isPlainWord), ...operandTokens(e.right, isPlainWord)])];
      }
      default:
        return [make('test', this.t(binaryTestOps[e.type === 'and' ? '-a' : '-o']), [...this.testTokens(n, b, e.left), ...this.testTokens(n, b, e.right)])];
    }
  }

  /**
   * How `-eq`, `-lt`… read their operands: `[ ]` takes decimal integers (`010` is ten; `0x10` is an error),
   * `[[ ]]` evaluates them as arithmetic (`010` is octal 8, `0x10` is 16, `08` is an error).
   */
  private numericTestNote(op: string, operands: string[], double: boolean): string {
    if (!/^-(?:eq|ne|lt|le|gt|ge)$/.test(op)) return '';
    const notes: string[] = [];
    for (const raw of operands) {
      const m = /^([-+]?)(\d[0-9A-Za-z@_#]*)$/.exec(raw);
      const lit = m ? arithLiteral(m[2]) : undefined;
      if (!lit && !double && /^[\w+\-/%.,:^]+$/.test(raw) && !/^[-+]?\d+$/.test(raw)) {
        // A word written out in full that is no integer (`1+1`, `1.5`, `x`): `[` and `test` do not calculate.
        const v = evalArith(raw);
        notes.push(this.s(`\`[ ]\` の ${op} は整数しか読めないので \`${raw}\` はエラー（integer expression expected）。\`[[ ]]\` なら算術として読める${v === undefined ? '' : `（${v}）`}`,
          `\`[ ]\` reads only integers for ${op}, so \`${raw}\` is an error (integer expression expected); \`[[ ]]\` would read it as arithmetic${v === undefined ? '' : ` (${v})`}`));
        continue;
      }
      if (!lit && double && /^[\d\s+\-*/%()]+$/.test(raw) && !/^\s*[-+]?\d+\s*$/.test(raw)) {
        // An arithmetic expression of constants (`1+1`): `[[ ]]` calculates it.
        const v = evalArith(raw);
        if (v !== undefined) notes.push(this.s(`\`[[ ]]\` の ${op} は算術として読むので \`${raw}\` は ${v}`, `\`[[ ]]\` reads ${op} operands as arithmetic, so \`${raw}\` is ${v}`));
        continue;
      }
      if (!lit || (lit.type === 'number' && lit.style === 'decimal' && !/^0\d/.test(m![2]))) continue;
      if (!double) {
        notes.push(lit.type === 'number' && lit.style === 'octal' && /^\d+$/.test(m![2])
          ? this.s(`\`[ ]\` は 10 進の整数として読むので \`${raw}\` は ${Number(m![2])}（8 進数ではない）`, `\`[ ]\` reads decimal integers, so \`${raw}\` is ${Number(m![2])} (not octal)`)
          : this.s(`\`[ ]\` は 10 進の整数しか読めないので \`${raw}\` はエラー（integer expression expected）。\`[[ ]]\` なら算術として読める`, `\`[ ]\` reads only decimal integers, so \`${raw}\` is an error (integer expression expected); \`[[ ]]\` would read it as arithmetic`));
      } else if (lit.type === 'invalid') {
        notes.push(this.s(`\`[[ ]]\` は算術として読むので、先頭が 0 の \`${raw}\` は 8 進数で、\`${lit.digit}\` は使えずエラー（value too great for base）`, `\`[[ ]]\` reads arithmetic, where \`${raw}\` with a leading 0 is octal and \`${lit.digit}\` is not a digit: an error (value too great for base)`));
      } else {
        const kind = { octal: this.s('8 進数', 'octal'), hex: this.s('16 進数', 'hexadecimal'), based: this.s(`${lit.base} 進数`, `base ${lit.base}`), decimal: '' }[lit.style];
        notes.push(this.s(`\`[[ ]]\` の ${op} は算術として読むので \`${raw}\` は ${kind}で ${m![1] === '-' ? '-' : ''}${lit.value}`, `\`[[ ]]\` reads ${op} operands as arithmetic, so \`${raw}\` is ${kind} ${m![1] === '-' ? '-' : ''}${lit.value}`));
      }
    }
    return notes.length ? this.s('。', '. ') + notes.join(this.s('。', '. ')) : '';
  }

  /** The right side of `[[ x =~ re ]]` (an ERE) is broken down; other `regex` nodes are glob-like patterns. */
  private regexNode(n: SyntaxNode): Token {
    // (A `regex` node is only the plain right side of `=~`, without quotes: expansions and quotes make other nodes.)
    // Quote removal drops a backslash before an ordinary character: `\b` is `b`, `\w` is `w`, `\<` is `<` (bash), not the GNU operators.
    // One before a character special in an ERE stays, and makes it literal.
    let text = '';
    const offsets: number[] = [];
    for (let i = 0; i < n.text.length; i++) {
      if (n.text[i] === '\\' && i + 1 < n.text.length && !/[.[\]{}()\\*+?|^$]/.test(n.text[i + 1])) i++;
      offsets.push(i);
      text += n.text[i];
      if (n.text[i] === '\\' && i + 1 < n.text.length) { offsets.push(++i); text += n.text[i]; }
    }
    // (The regex is read by the regex library bash calls, by the rules of an ERE: an embedded language.)
    const tokens = explainRegex(text, 'ere', this.lang).map((t) => ({ ...fromEmbedded(t, n, { text, offsets }, 'embedded'), language: 'regex' }));
    const js = toJsRegex(text, 'ere');
    const dropped = [...new Set([...n.text.matchAll(/\\([bBwWsSdD<>])/g)].filter((m) => text !== n.text).map((m) => '\\' + m[1]))];
    if (dropped.length) {
      const list = dropped.map((d) => `\`${d}\``).join(this.s('、', ', '));
      this.cx.note(fact(this.lang, 'regex-backslash-dropped', { list }), n);
    }
    if (js) this.regexExample(js, 'values');
    return this.tok(n, 'pattern', this.s('正規表現（拡張正規表現 ERE）', 'Regular expression (extended, ERE)'), tokens);
  }

  private unary(n: SyntaxNode): Token {
    // `!` is not an operator field.
    const opNode = field(n, 'operator')!;
    const op = opNode.text;
    const operand = n.namedChildren.find((c) => !same(c, opNode));
    // `[[ $a && -n` while typing: the operand is not written yet.
    if (!operand) {
      return this.tok(n, 'test', this.s(`単項演算 \`${op}\`: 対象がまだ書かれていない`, `Unary operator \`${op}\`: the operand is not written yet`));
    }
    if (op === '!' && !inArithmetic(n)) {
      return this.tok(n, 'test', this.s(`否定: \`${operand.text}\` が偽なら真`, `Negation: true if \`${operand.text}\` is false`), this.sub(operand));
    }
    const d = unaryTestOps[op];
    if (d && !inArithmetic(n)) {
      return this.tok(n, 'test', this.s(`条件: \`${operand.text}\` が${this.t(d)}`, `Condition: \`${operand.text}\` ${this.t(d)}`), this.subs([operand].filter((x) => !isPlainWord(x))));
    }
    return this.tok(n, 'operator', this.s(`算術の単項演算 \`${op}\``, `Arithmetic unary operator \`${op}\``), this.subs(n.namedChildren));
  }

  private binary(n: SyntaxNode): Token {
    const left = field(n, 'left');
    // The right side of `=`, `==` and `!=` in `[[ ]]` can be several fields: `*"$y"*z` is a pattern, a string and a pattern.
    // (The binary expression in `${s:$i+1}` has no fields at all.)
    const rightFields = fields(n, 'right');
    const rights = rightFields.length ? rightFields : [n.namedChildren[n.namedChildren.length - 1]];
    const rightText = n.text.slice(rights[0].startIndex - n.startIndex, rights[rights.length - 1].endIndex - n.startIndex);
    const op = field(n, 'operator')!.text;
    // The grammar reads even a plain `a` after `=`, `==` and `!=` as a pattern; it is only a word to explain, and in `[ ]` any text is.
    // (A constant such as `0x1F` is not plain in arithmetic: it has a value to show.)
    const plain = (x: SyntaxNode) => (isPlainWord(x) && !(inArithmetic(n) && arithNumber(this.cx, x))) || (x.type === 'extglob_pattern' && rights.length === 1 && !hasGlob(x.text));
    // The grammar leaves some patterns as words (`*.txt`, `--?(a)b`, `-@(!(-*)e*|-edit)`); on the right of `==` in `[[ ]]` they are patterns all the same.
    const pattern = (x: SyntaxNode) => x.type === 'word' && ['=', '==', '!='].includes(op) && hasGlob(x.text) && !!ancestor(n, (a) => a.type === 'extended_test');
    const operands = sortTokens([
      ...this.subs([left, ...rights].filter((x) => x && !plain(x) && !pattern(x))),
      ...rights.filter(pattern).map((x) => globToken(this.cx, x, 'value')),
    ]);
    // `[[ $x = *.txt ]]`: the values that match, as for a `case` pattern (a pattern with a quoted part is not tried).
    if (['=', '==', '!='].includes(op) && rights.length === 1 && (pattern(rights[0]) || (rights[0].type === 'extglob_pattern' && !plain(rights[0])))) {
      this.cx.examplesAt(n, () => this.patternExample(rights, [this.s('一致する値', 'Values that match'), this.s('一致しない値', 'Values that do not match')]));
    }
    if (!inArithmetic(n) && binaryTestOps[op]) {
      const num = this.numericTestNote(op, [n.namedChildren[0].text, rightText], true);
      if (op === '&&' || op === '||' || op === '-a' || op === '-o') {
        return this.tok(n, 'test', this.t(binaryTestOps[op]), this.subs([left, ...rights]));
      }
      return this.tok(n, 'test', this.s(
        `条件: \`${left?.text}\` と \`${rightText}\` を比較 — ${this.quotedPatternNote(n, op, rights) ?? this.t(extendedEqualOps[op] ?? binaryTestOps[op])}${num}`,
        `Condition: \`${left?.text}\` vs \`${rightText}\` — ${this.quotedPatternNote(n, op, rights) ?? this.t(extendedEqualOps[op] ?? binaryTestOps[op])}${num}`,
      ), operands);
    }
    const assignOps = ['=', '+=', '-=', '*=', '/=', '%='];
    return this.tok(n, 'operator', assignOps.includes(op)
      ? this.s(`算術代入: \`${left?.text}\` ${op} \`${rightText}\``, `Arithmetic assignment: \`${left?.text}\` ${op} \`${rightText}\``)
      : this.s(`算術演算: \`${left?.text}\` ${op} \`${rightText}\``, `Arithmetic: \`${left?.text}\` ${op} \`${rightText}\``), operands);
  }

  /**
   * In `[[ x == "*" ]]` and `[[ x =~ "a.c" ]]`, a quoted right side is plain text: quoting turns the pattern or the
   * regex off. Undefined when nothing is quoted.
   */
  private quotedPatternNote(n: SyntaxNode, op: string, rights: SyntaxNode[]): string | undefined {
    const regex = op === '=~';
    if (!['=', '==', '!=', '=~'].includes(op) || !ancestor(n, (a) => a.type === 'extended_test')) return undefined;
    // (In a regex a backslash is no quoting: `a\.c` is the same regex as `a[.]c`.)
    const quoted = (x: SyntaxNode): boolean[] => {
      if (x.type === 'concatenation') return x.namedChildren.flatMap(quoted);
      if (['string', 'raw_string', 'ansi_c_string', 'translated_string'].includes(x.type)) return [true];
      return [!regex && x.text.includes('\\')];
    };
    const kinds = rights.flatMap(quoted);
    if (!kinds.some((q) => q)) return undefined;
    if (regex) {
      const pitfall = rights.some((x) => x.type === 'string' && descendants(x, ['simple_expansion', 'expansion']).length)
        ? this.s('。正規表現を入れた変数は `"$re"` でなく `$re` とクォートせずに書く', '. A variable that holds a regex is written `$re`, not `"$re"`')
        : '';
      return (kinds.every((q) => q)
        ? this.s('左辺が右辺の文字列をそのまま含めば真（右辺はクォートされているので正規表現ではなく文字列そのもの。`.` や `*` も普通の文字）',
          'true if the left side contains the right side as it is (the right side is quoted, so it is literal text, not a regex: `.` and `*` are plain characters)')
        : this.s('左辺が右辺の正規表現(ERE)に一致すれば真（右辺のうちクォートされた部分は文字列そのまま、残りは正規表現）',
          'true if the left side matches the regex (ERE) on the right (the quoted parts of the right side are literal text, the rest is regex)'))
        + pitfall + this.s('。一致結果は `BASH_REMATCH` に入る', '; captures go to `BASH_REMATCH`');
    }
    const equal = op !== '!=';
    return kinds.every((q) => q)
      ? this.s(`文字列が${equal ? '等しい' : '等しくない'}（右辺はクォートされているので文字列そのもの。パターンとしては扱われない）`,
        `strings ${equal ? 'are equal' : 'differ'} (the right side is quoted, so it is literal text, not a pattern)`)
      : this.s(`文字列が${equal ? '等しい' : '等しくない'}（右辺のうちクォートされた部分は文字列そのもの、残りはパターン）`,
        `strings ${equal ? 'are equal' : 'differ'} (the quoted parts of the right side are literal text, the rest is a pattern)`);
  }

  /**
   * The tokens of the string `words` hold, read as the script a slot runs (docs/design/semantics.md, 4.13): the
   * items of each of its lines, explained with its shell and model and mapped to the source (a token per line when it
   * has several). Its notes and examples join the line's. `note`: why it is not read, or that its shell is not known.
   */
  private scriptTokens(words: SyntaxNode[], env: ExecEnv): { tokens: Token[]; note?: string } {
    const script = this.cx.state.script(words, env);
    // (A string no shell runs, `sudo eval s`, has the pitfall of its slot.)
    if ('why' in script) {
      return script.why === 'not-run' ? { tokens: [] } : { tokens: [], note: script.why === 'not-static'
        ? this.s('。展開を含み、中身は実行するときに決まるので、スクリプトとしては解説しない', '. It holds an expansion, so its text is known only when it runs: it is not explained as a script')
        : this.s('。文字列の中の文字列が深すぎるので、スクリプトとしては解説しない', '. Strings nested this deep are not explained as scripts') };
    }
    const inner = new Analyzer(this.lang);
    inner.nested = script.kind;
    const tree = script.tree;
    const rows = tree.text.split('\n');
    const lines: Token[][] = [];
    for (let line = 0; line < rows.length; line++) {
      const ex = inner.explainLine(tree, line, script.shell, { ...this.cx.opts, reading: false });
      // (A statement over several lines is explained whole on each of them: keep it, and its notes, on its first.)
      const items = ex.items.filter((t) => t.span.start.line === line);
      lines.push(items.map((t) => this.fromScript(t, script)));
      if (!items.length) continue;
      this.cx.adopt(ex, (span) => this.scriptSpan(span, script));
    }
    const used = lines.map((items, i) => ({ items, i })).filter((l) => l.items.length);
    const tokens = used.length === 1 ? used[0].items : used.map(({ items, i }): Token => ({
      kind: 'block', label: shorten(rows[i].trim()), children: items,
      explanation: this.s(`文字列の ${i + 1} 行目`, `Line ${i + 1} of the string`),
      span: { start: items[0].span.start, end: items[items.length - 1].span.end },
    }));
    const note = script.known ? undefined
      : this.s('。実行するシェルはここではわからない（ユーザーのログインシェル）ので、bash として解説する', ". The shell that runs it is not known here (the user's login shell): it is explained as bash");
    for (const t of tokens) readAsScript(t, scriptProcess(env));
    return { tokens, ...(note ? { note } : {}) };
  }

  /** `t` with the tokens of a string read as a script under the token of its word (the quoted string, when `t` holds it). */
  private withScript(t: Token, script: { tokens: Token[]; note?: string }): Token {
    const only = t.children.length === 1 && sameSpan(t.children[0].span, t.span) ? t.children[0] : t;
    // (The script's tokens take the place of the word's own parts, which cover the same text: `$'…'` escapes.)
    if (script.tokens.length) only.children = sortTokens(script.tokens);
    if (script.note) t.explanation += script.note;
    return t;
  }

  /** One token for the words joined into a script (`eval echo $x`, `ssh host ls -l`), with the script's tokens. */
  private joinedScript(words: SyntaxNode[], desc: string | undefined, script: { tokens: Token[]; note?: string }): Token {
    const span: Span = { start: spanOf(words[0]).start, end: spanOf(words[words.length - 1]).end };
    const text = this.cx.source.slice(words[0].startIndex, words[words.length - 1].endIndex);
    const joinedText = this.s('（単語を空白でつないだ文字列を、スクリプトとして読む）', ' (the words, joined with spaces, are read as a script)');
    return {
      kind: 'argument', label: shorten(text), span, children: script.tokens,
      explanation: (desc ?? this.s('もう一度読んで実行する文字列', 'Text to read and run again')) + joinedText + (script.note ?? ''),
    };
  }

  /** A token of a string read as a script, with its spans moved from the string's text to the source. */
  private fromScript(t: Token, script: NestedScript): Token {
    return { ...t, span: this.scriptSpan(t.span, script), children: t.children.map((c) => this.fromScript(c, script)) };
  }

  /**
   * A span in the text of a string read as a script, in the source: from the start of its first character to the end
   * of its last (`\$x` for `$x` in `"echo \$x"`).
   */
  private scriptSpan(sp: Span, script: NestedScript): Span {
    const inner = lineStarts(script.tree.text);
    const s = inner[sp.start.line] + sp.start.character;
    const e = inner[sp.end.line] + sp.end.character;
    const outer = lineStarts(this.cx.source);
    const start = posOf(outer, scriptSourceIndex(script, s, false));
    // (An empty span ends where it starts.)
    return { start, end: posOf(outer, scriptSourceIndex(script, e, e > s)) };
  }

  /** The command string of `trap`: when its `$variables` are expanded depends on the quotes. */
  private trapNote(a: SyntaxNode): string {
    // (In double quotes, the expansions the parser finds: `\$x` is text.)
    const found = a.type === 'raw_string' ? a.text.match(/\$\{?[A-Za-z_]\w*\}?|\$\(|`/g) ?? []
      : descendants(a, ['simple_expansion', 'expansion', 'command_substitution']).map((e) => (e.type === 'command_substitution' ? '$(' : e.text));
    const vars = [...new Set(found)].map((v) => (v === '$(' || v === '`' ? '$(…)' : v));
    if (!vars.length) return '';
    const shown = [...new Set(vars)].map((v) => `\`${v}\``).join(this.s('、', ', '));
    if (a.type === 'raw_string') {
      return this.s(`。シングルクォートなので ${shown} はここでは展開されず、トラップが実行されるときに展開される（そのときの値が使われる）`,
        `. Single quotes keep ${shown} from being expanded here: it is expanded when the trap runs, with the value it has then`);
    }
    return a.type === 'string'
      ? this.s(`。ダブルクォートなので ${shown} は今ここで展開され、そのときの内容がトラップに固定される（実行時の値にしたいならシングルクォートにする）`,
        `. Double quotes expand ${shown} now, and the trap keeps that text (use single quotes to get the value at run time)`)
      : '';
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

/** The expansions that give a word a value of the shell that expands it (`$x`, `$(…)`, `*`, `~`): not braces or quotes. */
const LOCAL_EXPANSIONS: ReadonlySet<ExpansionStep['kind']> = new Set(['tilde', 'parameter', 'command', 'arithmetic', 'process', 'glob']);

/** What a job spec such as `%1`, `%%`, `%-`, `%vim` or `%?foo` means; undefined for other words. */
function jobSpec(text: string): { ja: string; en: string } | undefined {
  if (!text.startsWith('%') || text.length < 2) return undefined;
  const rest = text.slice(1);
  if (/^\d+$/.test(rest)) return { ja: `ジョブ番号 ${rest}（\`jobs\` の \`[${rest}]\`）`, en: `job number ${rest} (\`[${rest}]\` in \`jobs\`)` };
  if (rest === '%' || rest === '+') return { ja: '現在のジョブ（最後にバックグラウンドへ送った、または停止したジョブ）', en: 'the current job (the last one sent to the background or stopped)' };
  if (rest === '-') return { ja: '1つ前のジョブ', en: 'the previous job' };
  if (rest.startsWith('?')) return { ja: `コマンドに \`${rest.slice(1)}\` を含むジョブ`, en: `the job whose command contains \`${rest.slice(1)}\`` };
  return { ja: `コマンドが \`${rest}\` で始まるジョブ`, en: `the job whose command starts with \`${rest}\`` };
}

const NO_SPEC: CommandSpec = { summary: { ja: '', en: '' } };
/** The specs of the declaration builtins, whose options are explained by the letters they give (`declarationOption`). */
const DECLARATION_SPECS: ReadonlySet<CommandSpec> = new Set(['declare', 'typeset', 'local', 'export', 'readonly'].map((n) => builtins[n]));
/** `+x` (an option turned off) is written as `-x` in texts. */
const dash = (flag: string): string => flag.replace(/^\+/, '-');
/** The spec of the dictionary's command `name` (`/usr/bin/kill` is `kill`). */
/** The subcommand a parse names, if any (`git stash push`: `stash`, whose parse names `push`). */
const subcommandOf = (p: ArgvParse) => p.roles.find((r): r is { word: number; role: Extract<ArgRole, { role: 'subcommand' }> } => r.role.role === 'subcommand');

/** What `redirectLayout` found: the redirections in source order, and the range and text of the command's words. */
interface Layout { redirs: SyntaxNode[]; span: Span; text: string }

/**
 * How an example names a stage of a pipeline: the text of the command without the redirections after its words
 * (`sort > out` is `sort`), but with a here-string, which is what it reads (`grep x <<< y`).
 */
function stageText(n: SyntaxNode): string {
  const kids = n.namedChildren;
  let end = kids.length;
  while (kids[end - 1].type === 'file_redirect' || kids[end - 1].type === 'heredoc_redirect') end--;
  return n.text.slice(0, kids[end - 1].endIndex - n.startIndex);
}

/** The operator and destination of a file redirection (`>&-` and `<&-`, which close a descriptor, are `>&` and `<&` to `-`). */
function redirectParts(n: SyntaxNode): { op: string; dest: string } {
  const op = n.children.find((c) => !c.named)!.type;
  return { op, dest: fields(n, 'destination').map((d) => d.text).join(' ') };
}

export { lookupCommand };
