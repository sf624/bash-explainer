import { Lang, Text } from './i18n';
import { findIdioms, Redirect, simulateRedirects } from './idioms';
import { pitfallNotes } from './pitfalls';
import type { SyntaxNode, Tree } from './parser';
import { builtins, shoptOptions } from './dict/builtins';
import { ciVariables } from './dict/ciVariables';
import { distroAliases } from './dict/distroAliases';
import { commands } from './dict/commands';
import { CommandDoc, OptDoc } from './dict/types';
import { explainRegex, Flavor, flavorName } from './embedded/regex';
import { grepWrap, JsRegex, literalRegex, regexExamples, toJsRegex } from './examples/regex';
import { awkExample } from './examples/awk';
import { perlExample, perlOptions } from './examples/perlrun';
import { pipelineExample, readsFileOperand, Stage } from './examples/pipeline';
import { jqExample, JqRun, Json, toJson } from './examples/jq';
import { sedExample } from './examples/sed';
import { Interactive, rerun, RerunSpec } from './examples/rerun';
import { commandExample, FILTERS, parseOptions } from './examples/textfilters';
import { Operand, readSampleLine, runRead, testCases, xargsExample } from './examples/runtime';
import { bashPrintf, braceExpand, extglobs, globExamples, globMatches, GlobMode, GlobOpts, hasExtglob, hasGlobstar, isGlob, ShellWordsUnsupported } from './examples/shellwords';
import { explainAwk } from './embedded/awk';
import { explainDate, explainPrintf, formatDate as formatDateCommand, parseSampleDate, printfNote, SAMPLE_DATES } from './embedded/format';
import { describeFind, describeFindPattern, FindNode, isExpressionStart, parseFind, unquote } from './embedded/find';
import { explainGetopts } from './embedded/getopts';
import { explainYq3Path, judgeYq, yqNotes, yqSameAsJq } from './embedded/yq';
import { YamlStyle, YamlUnsupported, yamlLines, yqYamlOutput } from './examples/yaml';
import { YQ_DOCS } from './dict/yq';
import { customCommandDoc } from './dict/custom';
import { DIRECTIVE } from './directives';
import { explainGetoptLong, explainGetoptShort } from './embedded/getopt';
import { GetoptSpec, GetoptUnsupported, runGetopt, sampleGetoptArgs } from './examples/getopt';
import { explainGitDate, explainGitFormat } from './embedded/gitformat';
import { formatDate, GitFormatUnsupported, runGitLog, sampleCommits } from './examples/gitlog';
import { explainJq } from './embedded/jq';
import { explainPerl, perlLoopNote } from './embedded/perl';
import { explainMode, explainUmask } from './embedded/mode';
import { explainCutList, explainSortKey, explainTrSet, trSummary } from './embedded/textutils';
import { explainSed } from './embedded/sed';
import { EmbeddedLang, EmbeddedToken } from './embedded/types';
import { dialectNotes, Shell } from './dialect';
import { describeGlob, ExpansionPart, exampleFor, globParts, opMeaning, ParsedExpansion, parseExpansion, slicesElements, transformMeaning } from './expansion';
import {
  binaryTestOps, declarationCommands, declarationFlags, expansionOps, keywords, listOps,
  redirects, specialDestinations, specialVariables, unaryTestOps, wellKnownVariables,
} from './dict/syntax';

export type Kind =
  | 'command' | 'builtin' | 'function' | 'keyword' | 'option' | 'argument' | 'operator'
  | 'redirect' | 'variable' | 'expansion' | 'substitution' | 'string' | 'number'
  | 'comment' | 'assignment' | 'test' | 'pattern' | 'block' | 'error';

export interface Pos { line: number; character: number }
export interface Span { start: Pos; end: Pos }

export interface Token {
  kind: Kind;
  /** Short label shown in lists (usually the source text, truncated). */
  label: string;
  explanation: string;
  span: Span;
  children: Token[];
  /** One-line summary used for the inline display; falls back to `explanation`. */
  summary?: string;
  /** Worked examples shown right under this token (see `placeExamples`). */
  examples?: Example[];
  /** A regex capture group (or a reference to one), coloured alike in the panel and the examples. */
  group?: number;
}

export interface ContextEntry { label: string; line: number }

/** Context for explaining a line. */
export interface ExplainOptions {
  /** The kind of file the shell code is in (e.g. "GitHub Actions `run:` step"). */
  host?: string;
  /** The `bashExplainer.yq.flavor` setting. */
  yqFlavor?: string;
  /** Worked examples: off altogether, or off for some kinds. */
  examples?: { enabled: boolean; disabled: string[] };
  /** Notes about well-known idioms (strict mode…); on unless false. */
  idioms?: boolean;
  /** Notes about common mistakes (unquoted variables, `x = 1`…); on unless false. */
  pitfalls?: boolean;
  /** The `bashExplainer.customCommands` setting: commands the dictionary does not know. */
  customCommands?: Record<string, unknown>;
}

export interface LineExplanation {
  line: number;
  summary: string;
  items: Token[];
  /** Enclosing constructs, outermost first (e.g. "for loop (line 3)"). */
  context: ContextEntry[];
  notes: string[];
  /** Worked examples (e.g. input and output of a sed script), shown line by line. */
  examples: Example[];
  /** The shell the script is written for, when it is not bash (checked for unsupported features). */
  shell?: Shell;
}

export interface ExampleSection {
  label: string;
  lines: string[];
  /** Shown instead when `lines` is empty (e.g. "(no output)"). */
  empty?: string;
}

/** What an example shows, so it can be turned off by kind (`bashExplainer.examples.disabled`). */
export type ExampleKind = 'regex' | 'sed' | 'awk' | 'jq' | 'yq' | 'perl' | 'textFilters' | 'pipeline' | 'expansion' | 'printf' | 'glob'
  | 'test' | 'xargs' | 'read' | 'getopt' | 'gitLog' | 'date';

export const EXAMPLE_KINDS: ExampleKind[] = ['regex', 'sed', 'awk', 'jq', 'yq', 'perl', 'textFilters', 'pipeline', 'expansion', 'printf', 'glob', 'test', 'xargs', 'read', 'getopt', 'gitLog', 'date'];

export interface Example {
  kind?: ExampleKind;
  title: string;
  /** The command the example is for, named in the title when the line has several commands. */
  target?: string;
  /** The source range the example belongs to; the example is shown under the token that covers it. */
  anchor?: Span;
  sections: ExampleSection[];
  /** For the panel: input the user can edit, and how to run the example again on it. */
  interactive?: Interactive;
}

/** Constructs that own a body; when they span lines, each line explains only its own part. */
const BLOCKS = new Set([
  'for_statement', 'c_style_for_statement', 'while_statement', 'if_statement', 'elif_clause',
  'else_clause', 'case_statement', 'case_item', 'function_definition', 'compound_statement',
  'subshell', 'do_group', 'ERROR',
]);
/** Nodes that just combine statements; they count as blocks only when they contain one. */
const WRAPPERS = new Set(['list', 'pipeline', 'redirected_statement', 'negated_command', 'program']);

/** Nodes inside an expansion's argument that get their own explanation. */
const NESTED = new Set(['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution', 'string', 'raw_string']);

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

const TERMINATORS = new Set(['\\;', ';', "';'", '"\\;"', '"; "', '+']);

const effEndRow = (n: SyntaxNode) =>
  n.endPosition.column === 0 && n.endPosition.row > n.startPosition.row ? n.endPosition.row - 1 : n.endPosition.row;
const isMultiline = (n: SyntaxNode) => effEndRow(n) > n.startPosition.row;
const intersects = (n: SyntaxNode, line: number) => n.startPosition.row <= line && effEndRow(n) >= line;

function spanOf(n: SyntaxNode): Span {
  return {
    start: { line: n.startPosition.row, character: n.startPosition.column },
    end: { line: n.endPosition.row, character: n.endPosition.column },
  };
}

function shorten(text: string, max = 60): string {
  const first = text.split('\n')[0];
  const s = first.length > max ? first.slice(0, max - 1) + '…' : first;
  return first.length < text.length && s === first ? s + ' …' : s;
}

function isBlockLike(n: SyntaxNode): boolean {
  if (BLOCKS.has(n.type)) return isMultiline(n);
  if (WRAPPERS.has(n.type)) return n.namedChildren.some(isBlockLike);
  return false;
}

/** web-tree-sitter returns a fresh object on every access, so nodes must be compared by id. */
const same = (a: SyntaxNode | null | undefined, b: SyntaxNode | null | undefined) => !!a && !!b && a.id === b.id;
const has = (list: SyntaxNode[], n: SyntaxNode) => list.some((x) => x.id === n.id);
function fieldChildren(n: SyntaxNode, field: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < n.childCount; i++) if (n.fieldNameForChild(i) === field) out.push(n.child(i)!);
  return out;
}

const isPlainWord = (n: SyntaxNode) => n.type === 'word' || n.type === 'number';
const hasGlob = (s: string) => /(^|[^\\])([*?]|[+@!]\()|\[[^\]]+\]/.test(s);

export class Analyzer {
  private line: number | null = null;
  /** The shell options in effect on this line (see shoptStates). */
  private shopt: ShoptStates = shoptStates('', 0);
  private shell: Shell | undefined;
  /** Aliases defined in the script (`alias ll='ls -l'`): name → where, and what it stands for. */
  private aliases = new Map<string, { line: number; value: string }>();
  private context: ContextEntry[] = [];
  private functions = new Map<string, number>();
  /** Notes produced while explaining (e.g. the effect of several redirections). */
  private extraNotes: string[] = [];
  /** Context of the current explainLine call. */
  private opts: ExplainOptions = {};
  /** The whole text being explained (for hints such as how yq was installed). */
  private source = '';
  /** Worked examples produced while explaining (grep, sed, awk, jq). */
  private examples: Example[] = [];
  /** The command whose arguments are being explained (for option-dependent embedded languages). */
  /** The command whose arguments are being explained (set while they are, which is when the helpers that read it run). */
  private argCtx: { cmd: string; args: SyntaxNode[] } | undefined;

  constructor(private lang: Lang) {}

  explainLine(tree: Tree, line: number, shell?: Shell, opts: ExplainOptions = {}): LineExplanation {
    const root = tree.rootNode;
    this.opts = opts;
    this.source = root.text;
    this.functions.clear();
    for (const f of root.descendantsOfType('function_definition')) {
      const name = f.childForFieldName('name')?.text;
      if (name && !this.functions.has(name)) this.functions.set(name, f.startPosition.row);
    }
    this.aliases.clear();
    for (const c of root.descendantsOfType('command')) {
      if (c?.childForFieldName('name')?.text !== 'alias') continue;
      for (const a of c.childrenForFieldName('argument')) {
        const m = a && /^([\w.:-]+)=(['"]?)([\s\S]*)\2$/.exec(a.text);
        if (m && !this.aliases.has(m[1])) this.aliases.set(m[1], { line: c.startPosition.row, value: m[3] });
      }
    }
    this.line = line;
    this.shell = shell;
    this.shopt = shoptStates(root.text, line, shell);
    this.context = [];
    this.extraNotes = [];
    this.examples = [];
    const items = this.flatten(root);
    const statements = root
      .descendantsOfType(['command', 'redirected_statement', 'list', 'pipeline', 'variable_assignment', 'test_command', 'while_statement'], { row: line, column: 0 }, { row: line + 1, column: 0 })
      .filter((n) => intersects(n, line))
      .map((n) => (n.type === 'while_statement' ? n.text.split('\n')[0] : n.text));
    const result: LineExplanation = {
      line,
      ...(shell && shell !== 'bash' ? { shell } : {}),
      items,
      context: this.context,
      notes: [...this.notes(root, line, items), ...(shell ? dialectNotes(root, line, shell, this.lang) : []), ...new Set(this.extraNotes), ...(this.opts.idioms === false ? [] : findIdioms(statements, this.lang)), ...(this.opts.pitfalls === false ? [] : [...pitfallNotes(root, line, this.lang), ...this.extglobPitfalls(root, line), ...this.unmatchedGlobPitfalls(root, line), ...this.pipeSubshellPitfalls(root, line)])],
      // Each -e of sed explains the same combined script, so drop repeated examples.
      examples: this.titledExamples(root, line)
        .filter((e) => this.wantsExample(e))
        .filter((e, i, all) => all.findIndex((x) => JSON.stringify(x) === JSON.stringify(e)) === i),
      summary: items.filter((t) => t.kind !== 'comment' || items.length === 1).map(summaryOf).join(' ; '),
    };
    this.line = null;
    return result;
  }

  // ---------------------------------------------------------------- helpers

  private s(ja: string, en: string): string {
    return this.lang === 'ja' ? ja : en;
  }

  private t(text: Text): string {
    return text[this.lang];
  }

  private lineRef(n: SyntaxNode): string {
    const a = n.startPosition.row + 1;
    const b = effEndRow(n) + 1;
    if (a === b) return '';
    return this.s(`（行 ${a}〜${b}）`, ` (lines ${a}–${b})`);
  }

  private tok(n: SyntaxNode, kind: Kind, explanation: string, children: Token[] = [], label = shorten(n.text)): Token {
    return { kind, label, explanation, span: spanOf(n), children };
  }

  /** Explain a child node, respecting the current line filter. */
  private sub(n: SyntaxNode | null | undefined): Token[] {
    if (!n) return [];
    if (this.line === null) return [this.explain(n)];
    if (!intersects(n, this.line)) return [];
    if (isBlockLike(n)) {
      return n.startPosition.row === this.line ? [this.explain(n)] : this.flatten(n);
    }
    // A multi-line statement that is not a block (`\` continuation, heredoc…) is explained whole.
    return [this.full(n)];
  }

  private subs(nodes: (SyntaxNode | null | undefined)[]): Token[] {
    return nodes.flatMap((n) => this.sub(n));
  }

  /** Explain a node ignoring the line filter. */
  private full(n: SyntaxNode): Token {
    const saved = this.line;
    this.line = null;
    try {
      return this.explain(n);
    } finally {
      this.line = saved;
    }
  }

  /** Expose the parts of a block that are on the current line, recording the block as context. */
  private flatten(n: SyntaxNode): Token[] {
    const label = this.contextLabel(n);
    if (label) this.context.push({ label, line: n.startPosition.row });
    const out: Token[] = [];
    for (const c of n.children) {
      if (this.line !== null && !intersects(c, this.line)) continue;
      if (c.isNamed) out.push(...this.sub(c));
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
      case 'c_style_for_statement':
        return this.s('for ループ', 'for loop');
      case 'while_statement':
        return n.child(0)?.type === 'until' ? this.s('until ループ', 'until loop') : this.s('while ループ', 'while loop');
      case 'if_statement':
        return this.s('if 文', 'if statement');
      case 'elif_clause':
        return 'elif';
      case 'else_clause':
        return 'else';
      case 'case_statement':
        return this.s('case 文', 'case statement');
      case 'case_item': {
        const pats = fieldChildren(n, 'value').map((c) => c.text);
        return this.s(`case 分岐 \`${pats.join('|')})\``, `case branch \`${pats.join('|')})\``);
      }
      case 'function_definition':
        return this.s(`関数 \`${n.childForFieldName('name')?.text}\``, `function \`${n.childForFieldName('name')?.text}\``);
      case 'compound_statement':
        return n.child(0)?.type === '((' ? this.s('(( )) 算術評価', '(( )) arithmetic') : this.s('{ } グループ', '{ } group');
      case 'subshell':
        return this.s('( ) サブシェル', '( ) subshell');
      case 'ERROR':
        return this.s('構文エラーの範囲', 'syntax error region');
      default:
        return undefined;
    }
  }

  /** Token for an anonymous node (keyword or operator), or undefined for plain punctuation. */
  private anon(n: SyntaxNode): Token | undefined {
    const k = keywords[n.type];
    if (k) return this.tok(n, 'keyword', this.t(k));
    const op = listOps[n.type];
    if (op) return this.tok(n, 'operator', this.t(op));
    return undefined;
  }

  private anonOnLine(nodes: SyntaxNode[]): Token[] {
    return nodes
      .filter((c) => this.line === null || intersects(c, this.line))
      .map((c) => (c.type === ';' ? undefined : this.anon(c)))
      .filter((t): t is Token => !!t);
  }

  /** Children (keywords and named nodes) in source order, filtered to the current line. */
  private ordered(n: SyntaxNode, skip: (c: SyntaxNode) => boolean = () => false): Token[] {
    const out: Token[] = [];
    for (const c of n.children) {
      if (skip(c)) continue;
      if (c.isNamed) out.push(...this.sub(c));
      else out.push(...this.anonOnLine([c]));
    }
    return out;
  }

  private notes(root: SyntaxNode, line: number, items: Token[]): string[] {
    const notes: string[] = [];
    const lineStart = { row: line, column: 0 };
    const lineEnd = { row: line + 1, column: 0 };
    for (const h of root.descendantsOfType('heredoc_redirect', lineStart, lineEnd)) {
      const body = h.namedChildren.find((c) => c.type === 'heredoc_body');
      const end = h.namedChildren.find((c) => c.type === 'heredoc_end');
      const delim = h.namedChildren.find((c) => c.type === 'heredoc_start')!.text;
      if (body && intersects(body, line) && body.startPosition.row <= line && h.startPosition.row < line) {
        notes.push(this.s(
          `この行はヒアドキュメント（行 ${h.startPosition.row + 1} の \`<<${delim}\`）の本文です。`,
          `This line is part of the here-document started by \`<<${delim}\` on line ${h.startPosition.row + 1}.`,
        ));
      } else if (end && end.startPosition.row === line) {
        notes.push(this.s(`\`${end.text}\` はヒアドキュメントの終わりを示す行です。`, `\`${end.text}\` marks the end of the here-document.`));
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

  private explain(n: SyntaxNode): Token {
    switch (n.type) {
      case 'comment': return this.comment(n);
      case 'command': return this.command(n);
      case 'declaration_command': return this.declaration(n);
      case 'unset_command': return this.unset(n);
      case 'variable_assignment': return this.assignment(n);
      case 'variable_assignments': return this.tok(n, 'assignment', this.s('複数の変数への代入', 'Several variable assignments'), this.subs(n.namedChildren));
      case 'pipeline': return this.pipeline(n);
      case 'list': return this.list(n);
      case 'redirected_statement': return this.redirected(n);
      case 'file_redirect': return this.fileRedirect(n);
      case 'heredoc_redirect': return this.heredoc(n);
      case 'herestring_redirect': return this.herestring(n);
      case 'negated_command': return this.tok(n, 'operator', this.t(keywords['!']), this.subs(n.namedChildren));
      case 'test_command': return this.test(n);
      case 'unary_expression': return this.unary(n);
      case 'binary_expression': return this.binary(n);
      case 'ternary_expression': return this.tok(n, 'expansion', this.s('三項演算子: 条件 ? 真のときの値 : 偽のときの値', 'Ternary: cond ? if-true : if-false'), this.subs(n.namedChildren));
      case 'postfix_expression': return this.tok(n, 'operator', this.s(`算術: \`${n.text}\`（${n.text.endsWith('++') ? '1 増やす' : '1 減らす'}）`, `Arithmetic: \`${n.text}\` (${n.text.endsWith('++') ? 'increment' : 'decrement'})`));
      case 'parenthesized_expression': return this.tok(n, 'operator', this.s('括弧でまとめた式', 'Parenthesized expression'), this.subs(n.namedChildren));
      case 'expansion': return this.expansion(n);
      case 'simple_expansion': return this.simpleExpansion(n);
      case 'command_substitution': return this.commandSubstitution(n);
      case 'process_substitution': return this.processSubstitution(n);
      case 'arithmetic_expansion': return this.tok(n, 'substitution', this.s('算術展開: 中の式を整数として計算した結果に置き換える', 'Arithmetic expansion: replaced by the integer result of the expression'), this.subs(n.namedChildren));
      case 'string': return this.string(n);
      case 'raw_string': return this.tok(n, 'string', this.s('シングルクォート文字列: 中身は一切展開されず、そのままの文字列になる', 'Single-quoted string: taken literally, nothing is expanded'));
      case 'ansi_c_string': return this.tok(n, 'string', this.s('`$\'…\'` 文字列: `\\n` `\\t` などのエスケープを解釈した文字列になる', '`$\'…\'` string: backslash escapes such as `\\n` are interpreted'));
      case 'translated_string': return this.tok(n, 'string', this.s('`$"…"` 文字列: ロケールに応じて翻訳される文字列', '`$"…"` string: translated according to the locale'), this.subs(n.namedChildren));
      case 'concatenation': return this.tok(n, 'argument', this.s('連結: 以下の部分を空白なしでつなげて1つの単語にする', 'Concatenation: the parts below are joined into one word'), this.subs(n.namedChildren));
      case 'word': return this.word(n);
      case 'number': return this.tok(n, 'number', this.s('数値', 'Number'));
      case 'brace_expression': return this.tok(n, 'expansion', this.s(`ブレース展開: \`${n.text}\` は連続した値（連番など）に展開される`, `Brace expansion: \`${n.text}\` expands to a sequence`));
      case 'array': return this.tok(n, 'expansion', this.s('配列: `( )` 内の要素から配列を作る', 'Array: built from the elements inside `( )`'), this.subs(n.namedChildren));
      case 'subscript': return this.subscript(n);
      case 'regex': return this.regexNode(n);
      case 'extglob_pattern': return this.tok(n, 'pattern', this.s('パターン', 'Pattern') + this.extglobNote(n.text));
      case 'variable_name': return this.variable(n.text, n);
      case 'subshell': return this.block(n, 'block', this.s('サブシェル: `( )` 内を別プロセスで実行する。中での変数変更や cd は外に影響しない', 'Subshell: runs `( )` in a child process; variable changes and cd do not leak out'));
      // tree-sitter-bash 0.25 parses a standalone `(( expr ))` as a compound statement opened by `((`.
      case 'compound_statement': if (n.child(0)?.type === '((') return this.test(n);
        return this.block(n, 'block', this.s('コマンドグループ: `{ }` 内のコマンドを現在のシェルでまとめて実行する', 'Command group: runs the commands in `{ }` in the current shell'));
      case 'do_group': return this.block(n, 'block', this.s('ループ本体: `do` から `done` までを繰り返し実行する', 'Loop body: the commands between `do` and `done`'));
      case 'function_definition': return this.functionDef(n);
      case 'for_statement': return this.forStatement(n);
      case 'c_style_for_statement': return this.block(n, 'keyword', this.s('C 言語風 for ループ: `((初期化; 条件; 更新))` で回数を制御して繰り返す', 'C-style for loop: `((init; condition; update))`') + this.lineRef(n));
      case 'while_statement': return this.whileStatement(n);
      case 'if_statement': return this.block(n, 'keyword', this.s('if 文: 条件コマンドの終了ステータスが 0（成功）なら then 以下を実行', 'if statement: runs the `then` branch if the condition exits 0') + this.lineRef(n));
      case 'elif_clause': return this.block(n, 'keyword', this.t(keywords.elif));
      case 'else_clause': return this.block(n, 'keyword', this.t(keywords.else));
      case 'case_statement': return this.caseStatement(n);
      case 'case_item': return this.caseItem(n);
      case 'ERROR': return this.tok(n, 'error', this.s('構文エラー: この部分は正しく解析できませんでした（クォートや括弧の閉じ忘れなど）', 'Syntax error: this part could not be parsed (unclosed quote or bracket?)'), this.subs(n.namedChildren));
      default:
        // Callers explain keywords and operators themselves; any other punctuation is shown as itself.
        /* c8 ignore next */
        if (!n.isNamed) return this.anon(n) ?? this.tok(n, 'operator', n.type);
        return this.tok(n, 'argument', n.type, this.subs(n.namedChildren));
    }
  }

  // ---------------------------------------------------------------- statements

  private comment(n: SyntaxNode): Token {
    if (n.startPosition.row === 0 && n.text.startsWith('#!')) {
      const interp = n.text.slice(2).trim();
      return this.tok(n, 'comment', this.s(
        `シバン（shebang）: このスクリプトを \`${interp}\` で実行することを指定する`,
        `Shebang: run this script with \`${interp}\``,
      ));
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

  private block(n: SyntaxNode, kind: Kind, explanation: string): Token {
    return this.tok(n, kind, explanation, this.ordered(n));
  }

  private functionDef(n: SyntaxNode): Token {
    const nameNode = n.childForFieldName('name')!;
    const name = nameNode.text;
    // A definition is explained on the line it starts on, where its name is.
    const nameTok = [this.tok(nameNode, 'function', this.s('関数名', 'Function name'))];
    return this.tok(n, 'function', this.s(
      `関数 \`${name}\` の定義: 以後 \`${name}\` をコマンドのように呼び出せる（引数は関数内で $1, $2… になる）${this.lineRef(n)}`,
      `Defines function \`${name}\`; call it like a command (arguments become $1, $2…)${this.lineRef(n)}`,
    ), sortTokens([...nameTok, ...this.ordered(n, (c) => same(c, nameNode) || c.type === '(' || c.type === ')')]));
  }

  private forStatement(n: SyntaxNode): Token {
    const v = n.childForFieldName('variable');
    const values = fieldChildren(n, 'value');
    const list = values.map((c) => c.text).join(' ');
    const expl = values.length
      ? this.s(`for ループ: \`${list}\` の各値を順に変数 \`${v?.text}\` に入れて本体を繰り返す`, `for loop: assign each of \`${list}\` to \`${v?.text}\` and run the body`)
      : this.s(`for ループ: 位置パラメータ（"$@"）の各値を順に \`${v?.text}\` に入れて繰り返す`, `for loop over the positional parameters ("$@") as \`${v?.text}\``);
    const children = this.ordered(n, (c) => same(c, v) || has(values, c));
    const extra: Token[] = [];
    if (v && (this.line === null || intersects(v, this.line))) extra.push(this.tok(v, 'variable', this.s('ループ変数: 繰り返しごとに次の値が入る', 'Loop variable: receives the next value on each iteration')));
    for (const val of values) {
      for (const t of this.sub(val)) {
        t.explanation = this.s('繰り返す値: ', 'Value to iterate: ') + t.explanation;
        extra.push(t);
      }
    }
    return this.tok(n, 'keyword', expl + this.lineRef(n), sortTokens([...children, ...extra]));
  }

  private whileStatement(n: SyntaxNode): Token {
    const until = n.child(0)?.type === 'until';
    const expl = until
      ? this.s('until ループ: 条件コマンドが成功（終了ステータス 0）するまで本体を繰り返す', 'until loop: repeat the body until the condition succeeds')
      : this.s('while ループ: 条件コマンドが成功（終了ステータス 0）する間、本体を繰り返す', 'while loop: repeat the body while the condition succeeds');
    return this.tok(n, 'keyword', expl + this.lineRef(n), this.ordered(n));
  }

  private caseStatement(n: SyntaxNode): Token {
    const v = n.childForFieldName('value')!;
    const children = this.ordered(n, (c) => same(c, v));
    const vt = this.sub(v).map((t) => ({ ...t, explanation: this.s('照合する値: ', 'Value to match: ') + t.explanation }));
    for (const c of children) {
      if (c.kind === 'keyword' && c.label === 'in') c.explanation = this.s('値の後に、パターンごとの分岐を並べる', 'Introduces the list of pattern branches');
    }
    return this.tok(n, 'keyword', this.s(
      `case 文: \`${v?.text}\` を各パターンと上から順に照合し、最初に一致した分岐を実行`,
      `case statement: match \`${v?.text}\` against each pattern in order and run the first match`,
    ) + this.lineRef(n), sortTokens([...children, ...vt]));
  }

  private caseItem(n: SyntaxNode): Token {
    const pats = fieldChildren(n, 'value');
    const ptext = pats.map((p) => p.text).join(' | ');
    const isDefault = pats.length === 1 && pats[0].text === '*';
    const expl = isDefault
      ? this.s('既定の分岐: どのパターンにも一致しなかった場合に実行（`*` は何にでも一致）', 'Default branch: runs when nothing else matched (`*` matches anything)')
      : this.s(`分岐: 値がパターン \`${ptext}\` に一致した場合に実行（\`|\` は「または」）`, `Branch: runs when the value matches \`${ptext}\` (\`|\` means "or")`);
    const patToks = pats
      .filter((p) => this.line === null || intersects(p, this.line))
      .map((p) => this.tok(p, 'pattern', hasExtglob(p.text) && !hasGlob(p.text.replace(/[?*+@!]\(/g, '(')) ? this.s(`パターン \`${p.text}\``, `Pattern \`${p.text}\``) + this.extglobNote(p.text)
        : hasGlob(p.text)
        ? this.s(`パターン \`${p.text}\`（グロブ: \`*\` は任意の文字列, \`?\` は任意の1文字）`, `Pattern \`${p.text}\` (glob: \`*\` any string, \`?\` any char)`) + this.extglobNote(p.text)
        : this.s(`パターン \`${p.text}\``, `Pattern \`${p.text}\``)));
    const rest = this.ordered(n, (c) => has(pats, c) || c.type === '|' || c.type === ')' || c.type === '(');
    if (!isDefault && (this.line === null || pats.some((p) => intersects(p, this.line!)))) {
      const before = this.examples.length;
      this.caseExample(pats);
      this.anchorExamples(before, n);
    }
    return this.tok(n, 'pattern', expl + this.lineRef(n), sortTokens([...patToks, ...rest]));
  }

  private pipeline(n: SyntaxNode): Token {
    const before = this.examples.length;
    const children = this.ordered(n);
    const whole = this.pipelineExample(n);
    if (whole) {
      // One example for the whole pipeline replaces the examples of its stages.
      this.examples.length = before;
      this.examples.push({ ...whole, anchor: spanOf(n), kind: 'pipeline' });
    }
    const cmds = children.filter((c) => c.kind !== 'operator' && c.kind !== 'keyword');
    const t = this.tok(n, 'operator', this.s(
      `パイプライン: 各コマンドの標準出力を次のコマンドの標準入力につないで、同時に実行する`,
      `Pipeline: each command's stdout feeds the next command's stdin; they run concurrently`,
    ), children);
    t.summary = cmds.map(summaryOf).join(' | ');
    return t;
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
      if (c.isNamed) children.push(...this.sub(c));
      else children.push(...this.anonOnLine([c]));
    }
    const t = this.tok(n, 'operator', this.s(
      'コマンドリスト: `&&`（成功したら次へ）や `||`（失敗したら次へ）で条件付きにつないだコマンド列',
      'Command list joined by `&&` (run next on success) or `||` (run next on failure)',
    ), children);
    t.summary = children.map((c) => (c.kind === 'operator' && !c.children.length ? c.label : summaryOf(c))).join(' ');
    return t;
  }

  private redirected(n: SyntaxNode): Token {
    const body = n.childForFieldName('body');
    const redirs = n.namedChildren.filter((c) => !same(c, body));
    const effect = simulateRedirects(redirs.flatMap((r) => this.redirectInfo(r)), this.lang);
    if (effect) this.extraNotes.push(effect);
    const bodyToks = this.sub(body);
    const redirToks = this.subs(redirs);
    // Simple commands carry their redirections as children so they read as one unit.
    if (bodyToks.length === 1 && body && !isBlockLike(body) && ['command', 'declaration_command'].includes(body.type)) {
      const t = bodyToks[0];
      return { ...t, span: spanOf(n), label: shorten(n.text), children: sortTokens([...t.children, ...redirToks]) };
    }
    // On a line where none of the redirections appear (e.g. a loop header), show the body alone.
    if (this.line !== null && redirToks.length === 0 && bodyToks.length === 1) return bodyToks[0];
    const w = this.tok(n, 'redirect', this.s(
      `入出力のリダイレクト: ${body ? `\`${shorten(body.text, 30)}\` 全体` : 'コマンド'}の入出力を切り替える`,
      `Redirection applied to ${body ? `\`${shorten(body.text, 30)}\` as a whole` : 'the command'}`,
    ), sortTokens([...bodyToks, ...redirToks]));
    w.summary = [...bodyToks.map(summaryOf), ...redirToks.map((r) => r.label)].join(' ');
    return w;
  }

  /** Operator, descriptor and target of a redirection node, for `simulateRedirects`. */
  private redirectInfo(r: SyntaxNode): Redirect[] {
    if (r.type === 'file_redirect') {
      const { op, dest } = redirectParts(r);
      return [{ op, fd: r.childForFieldName('descriptor')?.text ?? '', dest }];
    }
    if (r.type === 'heredoc_redirect') {
      // Redirections written after `<<EOF` on the same line are nested in the heredoc node.
      return [{ op: '<<', fd: '', dest: '' }, ...r.namedChildren.filter((c) => c.type === 'file_redirect').flatMap((c) => this.redirectInfo(c))];
    }
    // The only other redirection: herestring_redirect.
    return [{ op: '<<<', fd: '', dest: '' }];
  }

  private fileRedirect(n: SyntaxNode): Token {
    const fd = n.childForFieldName('descriptor')?.text ?? '';
    const { op, dest } = redirectParts(n);
    const dests = fieldChildren(n, 'destination');
    // Every operator the grammar has is in the dictionary.
    let expl = this.t(redirects[op](fd, dest));
    const special = specialDestinations[dest];
    if (special) expl += this.s('。', '. ') + this.t(special);
    if (fd === '2' && op === '>&' && dest === '1') {
      expl = this.s('標準エラー出力(fd 2)を標準出力(fd 1)と同じ出力先に向ける（エラーも一緒に出力・パイプする定番の書き方）',
        'Send stderr (fd 2) to wherever stdout (fd 1) goes (the classic way to capture errors too)');
    }
    if ((fd === '' || fd === '1') && op === '>&' && dest === '2') {
      expl = this.s('標準出力を標準エラー出力(fd 2)に向ける（メッセージをエラー出力に出す定番の書き方）',
        'Send stdout to stderr (the usual way to print an error message)');
    }
    const children = dests.filter((d) => !isPlainWord(d)).flatMap((d) => this.sub(d));
    return this.tok(n, 'redirect', expl, children);
  }

  private heredoc(n: SyntaxNode): Token {
    const op = n.children.find((c) => !c.isNamed)!.type;
    const startNode = n.namedChildren.find((c) => c.type === 'heredoc_start')!;
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
    const children = [
      // An empty here-document still has a (empty) body.
      ...this.subs(body!.namedChildren.filter((c) => c.type !== 'heredoc_content')),
      // The grammar nests redirections that follow `<<EOF` on the same line inside the heredoc node.
      ...this.subs(n.namedChildren.filter((c) => c.type.endsWith('redirect'))),
    ];
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

  private assignment(n: SyntaxNode): Token {
    const name = n.childForFieldName('name')!;
    const value = n.childForFieldName('value');
    const op = n.children.find((c) => !c.isNamed && (c.type === '=' || c.type === '+='))!.type;
    const nm = name.text;
    let expl = op === '+='
      ? this.s(`変数 \`${nm}\` に値を追記する（配列なら要素を追加）`, `Append to variable \`${nm}\` (adds elements for arrays)`)
      : value
        ? this.s(`変数 \`${nm}\` に値を代入する（\`=\` の前後に空白は入れられない）`, `Assign a value to variable \`${nm}\` (no spaces around \`=\`)`)
        : this.s(`変数 \`${nm}\` に空文字を代入する`, `Set variable \`${nm}\` to the empty string`);
    if (name?.type === 'subscript') expl = this.s(`配列 \`${name.childForFieldName('name')?.text}\` の要素 \`[${name.childForFieldName('index')?.text}]\` に代入する`, `Assign to element \`[${name.childForFieldName('index')?.text}]\` of array \`${name.childForFieldName('name')?.text}\``);
    const children: Token[] = [];
    if (value) {
      for (const t of this.sub(value)) {
        if (isPlainWord(value)) t.explanation = this.s(`代入する値 \`${value.text}\``, `Value \`${value.text}\``);
        children.push(t);
      }
    }
    return this.tok(n, 'assignment', expl, children);
  }

  private declaration(n: SyntaxNode): Token {
    // declare, typeset, export, readonly or local, all in the dictionary.
    const kw = n.child(0)!.type;
    const base = declarationCommands[kw];
    const children: Token[] = [];
    // A declaration over several lines is explained whole (see sub), so every part counts.
    for (const c of n.namedChildren) {
      if (c.type === 'word' && c.text.startsWith('-')) {
        const flags = c.text.slice(1).split('').map((ch) => declarationFlags['-' + ch]).filter(Boolean);
        children.push(this.tok(c, 'option', flags.length ? flags.map((f) => this.t(f)).join(this.s('、', ', ')) : this.s('オプション', 'Option')));
      } else if (c.type === 'variable_name' || c.type === 'word') {
        children.push(this.tok(c, 'variable', this.s(`変数 \`${c.text}\` を対象にする`, `Variable \`${c.text}\``)));
      } else {
        children.push(...this.sub(c));
      }
    }
    const t = this.tok(n, 'builtin', this.t(base), children);
    t.summary = `${kw}: ${t.explanation}`;
    return t;
  }

  private unset(n: SyntaxNode): Token {
    const fn = n.namedChildren.some((c) => c?.type === 'word' && /^-\w*f/.test(c.text));
    const children = n.namedChildren.map((c) => {
      const opt = c.type === 'word' && c.text.startsWith('-') ? builtins.unset.options?.[c.text] : undefined;
      if (opt) return this.tok(c, 'option', this.t(opt.text));
      if (c.type === 'variable_name' || isPlainWord(c)) {
        return this.tok(c, 'variable', fn ? this.s(`関数 \`${c.text}\` を削除する`, `Remove the function \`${c.text}\``) : this.s(`変数 \`${c.text}\` を削除する（未定義の状態に戻す）`, `Unset the variable \`${c.text}\` (it becomes undefined)`));
      }
      return this.explain(c);
    });
    const t = this.tok(n, 'builtin', this.t(builtins.unset.summary), children);
    t.summary = `unset: ${t.explanation}`;
    return t;
  }

  /** Whether the settings keep this example (examples.enabled / examples.disabled). */
  private wantsExample(e: Example): boolean {
    const o = this.opts.examples;
    if (!o) return true;
    return o.enabled && !(e.kind && o.disabled.includes(e.kind));
  }

  /** When the line runs several commands, names the one each example is for in its title. */
  private titledExamples(root: SyntaxNode, line: number): Example[] {
    const commands = root
      .descendantsOfType(['command', 'test_command', 'compound_statement'], { row: line, column: 0 }, { row: line + 1, column: 0 })
      // A compound statement counts only as `(( expr ))`, which tree-sitter-bash 0.25 parses that way.
      .filter((c): c is SyntaxNode => !!c && intersects(c, line) && (c.type !== 'compound_statement' || c.child(0)?.type === '(('));
    if (commands.length < 2) return this.examples;
    return this.examples.map((e) => {
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
    const before = this.examples.length;
    const t = this.commandToken(n);
    this.tagExamples(before, n);
    return t;
  }

  /** Records which command the examples added since `before` belong to (inner commands tag theirs first). */
  private tagExamples(before: number, n: SyntaxNode): void {
    const target = shorten(n.text.replace(/\s*\\\n\s*/g, ' '), 40);
    for (const e of this.examples.slice(before)) e.target ??= target;
    this.anchorExamples(before, n);
  }

  /** Attaches the examples added since `before` to `n`, unless a more specific node already took them. */
  private anchorExamples(before: number, n: SyntaxNode): void {
    for (const e of this.examples.slice(before)) e.anchor ??= spanOf(n);
  }

  private commandToken(n: SyntaxNode): Token {
    // `FOO=1 2>/dev/null`: tree-sitter-bash gives it a command name of zero width.
    const named = n.childForFieldName('name');
    const nameNode = named?.text ? named : null;
    const prefix: Token[] = [];
    const args: SyntaxNode[] = [];
    const redirs: SyntaxNode[] = [];
    let seenName = false;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)!;
      if (same(c, nameNode)) { seenName = true; continue; }
      if (c.type.endsWith('redirect')) { redirs.push(c); continue; }
      if (!seenName && c.type === 'variable_assignment') {
        // Without a command, the assignment stays in the shell.
        if (!nameNode) { prefix.push(...this.sub(c)); continue; }
        for (const t of this.sub(c)) {
          t.explanation = this.s(
            `このコマンドの実行中だけ設定される環境変数: ${t.explanation}`,
            `Environment variable set only for this command: ${t.explanation}`,
          );
          prefix.push(t);
        }
        continue;
      }
      if (c.isNamed) args.push(c);
    }
    if (!nameNode) {
      return this.tok(n, 'assignment', this.s('変数への代入', 'Variable assignment'), [...prefix, ...this.subs(redirs)]);
    }
    const head = this.commandHead(nameNode);
    if (head.name.split('/').pop() === 'yq') {
      // Three tools are called yq; explain the arguments as the one this command is for.
      const verdict = judgeYq(args.map((a) => literalContent(a)?.text), { doc: this.source, host: this.opts.host, setting: this.opts.yqFlavor });
      head.doc = YQ_DOCS[verdict.flavor];
      head.explanation = this.t(head.doc.summary);
      // A command over several lines is explained whole, so it always starts on the line explained.
      this.extraNotes.push(...yqNotes(verdict, this.lang));
    }
    const argToks = this.args(head.doc, args, head.name);
    this.commandExampleFor(head.name, args);
    if (head.name === 'read') this.readExample(n, args);
    for (const a of args) {
      const before = this.examples.length;
      this.wordExample(a);
      this.anchorExamples(before, a);
    }
    const t = this.tok(n, head.kind, head.explanation, sortTokens([
      ...prefix, ...head.nameTokens, ...argToks, ...this.subs(redirs),
    ]));
    t.summary = `${head.name}: ${head.explanation}`;
    const subTok = head.doc?.subcommands && argToks.find((a) => a.kind === 'command' && !a.children.length);
    // Every subcommand in the dictionary has a summary.
    if (subTok) t.summary = `${head.name} ${subTok.label}: ${this.t(head.doc!.subcommands![subTok.label].summary)}`;
    return t;
  }

  private commandHead(nameNode: SyntaxNode): { name: string; doc?: CommandDoc; kind: Kind; explanation: string; nameTokens: Token[] } {
    // Commands with an empty name (`FOO=1 2>/dev/null`) do not get here.
    const word = nameNode.namedChildren[0]!;
    const name = isPlainWord(word) ? word.text : nameNode.text;
    if (!isPlainWord(word) && word.type !== 'raw_string') {
      return {
        name, kind: 'command', nameTokens: this.sub(word),
        explanation: this.s('変数（展開結果）をコマンド名として実行する', 'Run the expanded value as a command'),
      };
    }
    // An alias over a known command (`alias grep=ggrep`) is still explained as that command.
    const alias = lookupCommand(name) ? undefined : this.aliases.get(name);
    if (alias) {
      // bash expands aliases in scripts only with expand_aliases (interactive shells always do);
      // a script that turns it on anywhere is taken to know.
      if ((!this.shell || this.shell === 'bash') && this.shopt.expand_aliases !== 'on' && !/\bshopt\s+-s\b[^\n;]*\bexpand_aliases\b/.test(this.source) && this.opts.pitfalls !== false) {
        this.extraNotes.push(this.s(
          `⚠ 落とし穴: bash はスクリプトの中ではエイリアスを展開しないので、\`${name}\` は「command not found」になります。\`shopt -s expand_aliases\` を \`alias\` より前に書くか、関数 \`${name}() { ${alias.value} "$@"; }\` にします（\`.bashrc\` など対話シェルで読むファイルなら問題ありません）`,
          `⚠ Pitfall: bash does not expand aliases in scripts, so \`${name}\` is "command not found". Put \`shopt -s expand_aliases\` before the \`alias\`, or make it a function: \`${name}() { ${alias.value} "$@"; }\` (fine in files read by interactive shells, such as \`.bashrc\`)`));
      }
      return {
        name, kind: 'function', nameTokens: [],
        explanation: this.s(`このスクリプトの行 ${alias.line + 1} で定義したエイリアス \`${name}\`: \`${alias.value}\` に置き換わる`, `The alias \`${name}\` defined on line ${alias.line + 1}: replaced by \`${alias.value}\``),
        doc: { summary: { ja: '', en: '' }, positional: [] },
      };
    }
    const fnLine = this.functions.get(name);
    if (fnLine !== undefined) {
      return {
        name, kind: 'function', nameTokens: [],
        explanation: this.s(`このスクリプトの行 ${fnLine + 1} で定義された関数 \`${name}\` を呼び出す`, `Call the function \`${name}\` defined on line ${fnLine + 1}`),
        doc: { summary: { ja: '', en: '' }, positional: [] },
      };
    }
    // A command described in the customCommands setting wins over the built-in dictionary.
    const custom = customCommandDoc(this.opts.customCommands?.[name.split('/').pop()!]);
    if (custom) {
      return { name, doc: custom, kind: 'command', nameTokens: [], explanation: this.t(custom.summary) + this.s('（設定 customCommands で定義）', ' (from the customCommands setting)') };
    }
    const doc = lookupCommand(name);
    if (doc) {
      return { name, doc, kind: doc.builtin ? 'builtin' : 'command', nameTokens: [], explanation: this.t(doc.summary) + (doc.builtin ? this.s('（シェル組み込み）', ' (shell builtin)') : '') };
    }
    const distro = Object.hasOwn(distroAliases, name) ? distroAliases[name] : undefined;
    if (distro) {
      const where = distro.definitions.map(([os]) => os).join(this.s('・', ', '));
      const defs = distro.definitions.map(([os, v]) => `${os}: \`${v}\``).join(this.s('、', ', '));
      const what = distro.kind === 'alias' ? this.s('エイリアス', 'alias') : this.s('関数', 'function');
      const instead = distro.portable
        ? this.s(`\`${distro.portable}\` と書きます`, `Write \`${distro.portable}\``)
        : this.s('したいことに合ったコマンドをそのまま書きます', 'Write the command you mean');
      // In a README the commands are typed into a terminal, where the alias may exist.
      const interactive = /^Markdown/.test(this.opts.host ?? '');
      this.extraNotes.push(interactive
        ? this.s(`ℹ 環境依存: \`${name}\` は ${where} が対話シェル用に定義する${what}で、ほかの環境にはありません。どこでも動かすには${distro.portable ? ` \`${distro.portable}\` と書きます` : '、したいことに合ったコマンドをそのまま書きます'}`,
          `ℹ System-dependent: \`${name}\` is an ${what} ${where} define${distro.definitions.length > 1 ? '' : 's'} for interactive shells; other systems lack it. ${distro.portable ? `Write \`${distro.portable}\` to work everywhere` : 'To work everywhere, write the command you mean'}`)
        : this.s(`⚠ 環境依存: \`${name}\` は ${where} が対話シェル用に定義する${what}で、コマンドではありません。ほかの環境にはなく、スクリプトの中では${distro.definitions.length > 1 ? 'これらの' : 'その'}環境でも使えません（command not found）。${instead}`,
          `⚠ System-dependent: \`${name}\` is an ${what} ${where} define${distro.definitions.length > 1 ? '' : 's'} for interactive shells, not a command. Other systems lack it, and scripts do not have it even there ("command not found"). ${instead}`));
      return {
        name, doc: distro.command ? lookupCommand(distro.command) : undefined, kind: 'command', nameTokens: [],
        explanation: this.s(`${what} \`${name}\`: ${this.t(distro.meaning)}（${defs}）`, `${distro.kind === 'alias' ? 'Alias' : 'Function'} \`${name}\`: ${this.t(distro.meaning)} (${defs})`),
      };
    }
    const explanation = name.includes('/')
      ? this.s(`パス \`${name}\` にあるプログラム・スクリプトを実行する`, `Run the program or script at \`${name}\``)
      : this.s(`外部コマンド \`${name}\` を実行する（辞書に未登録。\`man ${name}\` や \`${name} --help\` を参照）`, `Run the external command \`${name}\` (not in the dictionary; see \`man ${name}\`)`);
    return { name, kind: 'command', nameTokens: [], explanation };
  }

  /** Explain the argument words of a command according to its dictionary entry. */
  private args(doc: CommandDoc | undefined, args: SyntaxNode[], cmdName: string): Token[] {
    if (doc && cmdName.split('/').pop() === 'find') {
      const found = this.findArgs(doc, args);
      if (found) return found;
    }
    const out: Token[] = [];
    // `grep -e PATTERN file`: the option supplies the pattern, so `file` is the second positional.
    let posIndex = fillsPositional(doc, args) ? 1 : 0;
    let endOfOpts = false;
    const isFn = this.functions.has(cmdName);
    const savedCtx = this.argCtx;
    this.argCtx = { cmd: cmdName, args };
    try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const text = a.text;
      if (!endOfOpts && isPlainWord(a) && text === '--') {
        out.push(this.tok(a, 'option', this.s('オプションの終わり: 以降は `-` で始まっていても通常の引数として扱う', 'End of options: everything after is a plain argument')));
        endOfOpts = true;
        continue;
      }
      // `--pretty=format:'%h %s'` is one word made of a plain part and a quoted part.
      const quotedLongOpt = a.type === 'concatenation' && /^--[\w-]+=/.test(a.namedChildren[0]!.text);
      const optLike = !endOfOpts && (isPlainWord(a) || quotedLongOpt) && text.length > 1 && (text.startsWith('-') || (cmdName === 'set' && text.startsWith('+')));
      if (optLike) {
        i = this.option(doc, args, i, cmdName, out);
        continue;
      }
      if (posIndex === 0 && doc?.wraps) {
        out.push(this.wrapped(args.slice(i)));
        break;
      }
      if (posIndex === 0 && isPlainWord(a) && doc?.subcommands?.[text]) {
        const sd = doc.subcommands[text];
        const rest = this.args(sd, args.slice(i + 1), `${cmdName} ${text}`);
        out.push({ ...this.tok(a, 'command', this.s(`サブコマンド \`${cmdName} ${text}\`: `, `Subcommand \`${cmdName} ${text}\`: `) + this.t(sd.summary)), children: [] }, ...rest);
        break;
      }
      // Positional argument.
      let desc: string | undefined;
      if (isFn) desc = this.s(`関数への引数 $${posIndex + 1}`, `Argument $${posIndex + 1} to the function`);
      else if (cmdName === 'shopt' && text in shoptOptions) desc = this.s(`シェルオプション \`${text}\`: `, `Shell option \`${text}\`: `) + this.t(shoptOptions[text as keyof typeof shoptOptions]);
      else if (doc?.positional?.length) desc = this.t(doc.positional[Math.min(posIndex, doc.positional.length - 1)]);
      const lang = isFn ? undefined : doc?.positionalLang?.[posIndex];
      posIndex++;
      out.push(this.positional(a, desc, lang));
    }
    } finally {
      this.argCtx = savedCtx;
    }
    return out;
  }

  private positional(a: SyntaxNode, desc: string | undefined, lang?: EmbeddedLang): Token {
    const emb = lang && this.embedded(a, lang);
    if (emb && desc && emb.note) desc += ` — ${emb.note}`;
    if (isPlainWord(a)) {
      // Arguments in another language are positional ones the dictionary describes.
      if (emb) return this.tok(a, 'argument', desc!, emb.tokens);
      const base = this.word(a);
      if (!desc) return base;
      const glob = hasGlob(a.text) ? this.s('（グロブ: 一致するファイル名の一覧に展開される）', ' (glob: expands to matching file names)') + this.globNotes(a.text) : '';
      return this.tok(a, 'argument', desc + glob);
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
    const lit = literalContent(a);
    return lit && this.embeddedText(lit, lang, a);
  }

  /** Explain `lit.text`, which sits inside `a` as `lit` describes (e.g. after `-k` in `-k3,3n`). */
  private embeddedText(lit: Literal, lang: EmbeddedLang, a: SyntaxNode): { tokens: Token[]; note?: string } | undefined {
    const before = this.examples.length;
    const result = this.embeddedTextInner(lit, lang, a);
    this.anchorExamples(before, a);
    return result;
  }

  private embeddedTextInner(lit: Literal, lang: EmbeddedLang, a: SyntaxNode): { tokens: Token[]; note?: string } | undefined {
    let tokens: EmbeddedToken[];
    let note: string | undefined;
    switch (lang) {
      case 'regex': {
        const flavor = this.regexFlavor();
        note = flavorName(flavor, this.lang);
        tokens = flavor === 'fixed' ? [] : explainRegex(lit.text, flavor, this.lang);
        const flags = this.cmdFlags();
        const ignoreCase = flags.has('-i') || flags.has('--ignore-case');
        const js = flavor === 'fixed' ? literalRegex(lit.text, ignoreCase) : toJsRegex(lit.text, flavor, { ignoreCase });
        if (js) {
          const wrapped = grepWrap(js, flags.has('-x') || flags.has('--line-regexp'), flags.has('-w') || flags.has('--word-regexp'));
          this.regexExample(wrapped, flags.has('-v') || flags.has('--invert-match') ? 'inverted' : 'lines');
        }
        break;
      }
      case 'sed': {
        const flavor = this.regexFlavor();
        tokens = explainSed(lit.text, flavor === 'ere' ? 'ere' : 'bre', this.lang);
        const flags = this.cmdFlags();
        // With several -e options sed runs them as one script, so the example does too.
        const scripts = this.sedScripts() ?? [lit.text];
        const ex = sedExample(scripts.join('\n'), {
          quiet: flags.has('-n') || flags.has('--quiet') || flags.has('--silent'),
          extended: flavor === 'ere',
        });
        if (ex) {
          this.ioExample(ex.input, ex.output, flags.has('-i') || flags.has('--in-place'), {
            kind: 'sed', script: scripts.join('\n'), quiet: flags.has('-n') || flags.has('--quiet') || flags.has('--silent'), extended: flavor === 'ere',
            highlight: sedPattern(scripts.join('\n'), flavor === 'ere' ? 'ere' : 'bre'),
          });
        }
        break;
      }
      case 'jq': {
        tokens = explainJq(lit.text, this.lang);
        // kislyuk/yq passes the filter to jq, but reads and (with -y) writes YAML.
        if (this.argCtx!.cmd.split('/').pop() === 'yq') {
          this.yqExample(lit.text, 'kislyuk');
          break;
        }
        const flags = this.cmdFlags();
        const runs = jqExample(lit.text, {
          raw: flags.has('-r') || flags.has('--raw-output') || flags.has('-j') || flags.has('--join-output'),
          nullInput: flags.has('-n') || flags.has('--null-input'),
          vars: this.jqVars(),
        });
        if (runs) this.jqExamples(runs, { kind: 'jq', filter: lit.text, raw: flags.has('-r') || flags.has('--raw-output') || flags.has('-j') || flags.has('--join-output'), vars: this.jqVars() });
        break;
      }
      case 'awk': {
        tokens = explainAwk(lit.text, this.lang);
        const opts = this.awkOptions();
        const ex = awkExample(lit.text, opts);
        if (ex) this.ioExample(ex.input, ex.output, false, { kind: 'awk', program: lit.text, fs: opts.fs, vars: opts.vars });
        break;
      }
      case 'printf':
        tokens = explainPrintf(lit.text, this.lang);
        note = printfNote(lit.text, this.lang);
        break;
      case 'mode':
      case 'umask': {
        const r = lang === 'mode' ? explainMode(lit.text, this.lang) : explainUmask(lit.text, this.lang);
        if (!r) return undefined;
        tokens = r.tokens;
        note = r.note;
        break;
      }
      case 'sortkey':
      case 'cutfields':
      case 'cutchars': {
        const r = lang === 'sortkey' ? explainSortKey(lit.text, this.lang) : explainCutList(lit.text, lang === 'cutfields' ? 'field' : 'char', this.lang);
        if (!r) return undefined;
        tokens = r.tokens;
        note = r.note;
        break;
      }
      case 'trset': {
        const { role, sets } = this.trContext(a);
        const r = explainTrSet(lit.text, role, this.lang);
        if (!r) return undefined;
        tokens = r.tokens;
        const summary = role === 'to' ? trSummary(sets[0], lit.text, this.lang) : undefined;
        note = summary ? `${r.note}${this.s('。つまり', '; that is, it ')}${summary}` : r.note;
        break;
      }
      case 'yq4':
        tokens = explainJq(lit.text, this.lang, 'yq');
        this.yqExample(lit.text, 'mikefarah');
        break;
      case 'yq3path': {
        const r = explainYq3Path(lit.text, this.lang);
        if (!r) return undefined;
        tokens = r.tokens;
        break;
      }
      case 'getoptshort':
      case 'getoptlong': {
        const r = lang === 'getoptshort' ? explainGetoptShort(lit.text, this.lang) : explainGetoptLong(lit.text, this.lang);
        if (!r) return undefined;
        tokens = r.tokens;
        note = r.note;
        break;
      }
      case 'getopts': {
        const r = explainGetopts(lit.text, this.lang);
        if (!r) return undefined;
        tokens = r.tokens;
        note = r.note;
        break;
      }
      case 'perl': {
        tokens = explainPerl(lit.text, this.lang);
        const flags = new Set<string>();
        for (const w of this.argCtx!.args) {
          const m = /^-([a-zA-Z0-9]+)/.exec(w.text);
          // Letters up to the first value-taking one (`-lane`, `-pi.bak`).
          if (m && !w.text.startsWith('--')) for (const ch of m[1]) { flags.add(ch); if ('eEiFM0'.includes(ch)) break; }
        }
        note = perlLoopNote(flags, this.lang);
        break;
      }
      case 'gitformat':
      case 'gitdate': {
        const r = lang === 'gitformat' ? explainGitFormat(lit.text, this.lang) : explainGitDate(lit.text, this.lang);
        if (!r) return undefined;
        tokens = r.tokens;
        note = r.note;
        this.gitLogExample(lang, lit.text);
        break;
      }
      case 'glob': {
        tokens = [];
        note = describeFindPattern(lit.text, this.lang);
        if (!note) return undefined;
        // Unlike the shell, find matches a leading dot with * too; -path also matches / with *.
        // The test before the pattern: -name, -path…
        const opt = a.previousNamedSibling!.text;
        if (!/^-i/.test(opt)) {
          this.globExample(lit.text, 'value', this.s(`例（\`${opt}\` のパターン）`, `Example (the \`${opt}\` pattern)`),
            opt === '-name' ? [this.s('一致するファイル名', 'Matching names'), this.s('一致しないファイル名', 'Non-matching names')] : [this.s('一致するパス', 'Matching paths'), this.s('一致しないパス', 'Non-matching paths')]);
        }
        break;
      }
      case 'date': {
        // Only `+FORMAT` is a format; other date arguments set the clock.
        if (!lit.text.startsWith('+')) return undefined;
        tokens = explainDate(lit.text, this.lang);
        this.dateExample(lit.text);
        break;
      }
    }
    return { tokens: tokens.map((t) => this.fromEmbedded(t, a, lit)), note };
  }

  private fromEmbedded(t: EmbeddedToken, node: SyntaxNode, lit: Literal): Token {
    const text = node.text;
    const at = (offset: number, isEnd = false): Pos => {
      const idx = sourceIndex(lit, offset, isEnd);
      const before = text.slice(0, idx);
      const nl = before.lastIndexOf('\n');
      const rows = before.split('\n').length - 1;
      return rows === 0
        ? { line: node.startPosition.row, character: node.startPosition.column + idx }
        : { line: node.startPosition.row + rows, character: idx - nl - 1 };
    };
    const label = t.label ?? text.slice(sourceIndex(lit, t.start, false), sourceIndex(lit, t.end, true));
    return {
      kind: t.kind, label: shorten(label), explanation: t.explanation,
      span: { start: at(t.start), end: at(t.end, true) },
      children: t.children.map((c) => this.fromEmbedded(c, node, lit)),
      ...(t.group ? { group: t.group } : {}),
    };
  }

  /**
   * find's arguments: global options, starting points, then an expression explained as a whole
   * (`-o`, implicit `-a`, `!` and `\( \)` grouping) with the usual per-primary tokens inside.
   * Returns undefined when the expression cannot be parsed, so the generic handling applies.
   */
  private findArgs(doc: CommandDoc, args: SyntaxNode[]): Token[] | undefined {
    const out: Token[] = [];
    const opts = doc.options!;
    let i = 0;
    while (i < args.length && /^-[HLP]$/.test(args[i].text)) i = this.option(doc, args, i, 'find', out) + 1;
    while (i < args.length && !isExpressionStart(args[i].text)) {
      out.push(this.positional(args[i], this.t(doc.positional![0])));
      i++;
    }
    if (i >= args.length) return out;
    const exprArgs = args.slice(i);
    const words = exprArgs.map((a) => unquote(a.text));
    const tree = parseFind(words, (w) => (opts[w]?.untilTerminator ? 'until' : opts[w]?.arg ? 1 : 0));
    if (!tree) return undefined;

    const opTok = (idx: number, ja: string, en: string): Token[] => [this.tok(exprArgs[idx], 'operator', this.s(ja, en))];
    const build = (n: FindNode): Token[] => {
      switch (n.type) {
        case 'primary': {
          const tmp: Token[] = [];
          this.option(doc, exprArgs, n.from, 'find', tmp);
          return tmp;
        }
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
    out.push({
      kind: 'test', label: shorten(words.join(' ')), explanation: describeFind(tree, this.lang),
      span: { start: spanOf(first).start, end: spanOf(last).end }, children: build(tree),
    });
    return out;
  }

  /** How tr uses the set in `a`: its position among the sets and the -d/-s flags. */
  private trContext(a: SyntaxNode): { role: 'from' | 'to' | 'delete' | 'squeeze'; sets: string[] } {
    const args = this.argCtx!.args;
    const flags = args.filter((w) => /^-[a-zA-Z]+$/.test(w.text)).map((w) => w.text.slice(1)).join('');
    const sets = args.filter((w) => !/^-[a-zA-Z]+$/.test(w.text));
    const idx = sets.findIndex((w) => same(w, a));
    const lits = sets.map((w) => literalContent(w)?.text ?? w.text);
    if (flags.includes('d')) return { role: idx === 0 ? 'delete' : 'squeeze', sets: lits };
    if (flags.includes('s') && sets.length === 1) return { role: 'squeeze', sets: lits };
    return { role: idx === 0 ? 'from' : 'to', sets: lits };
  }

  /** Short (`-v`) and long (`--invert-match`) option names used by the current command. */
  private cmdFlags(): Set<string> {
    const flags = new Set<string>();
    for (const w of this.argCtx!.args) {
      const t = w.text;
      if (t === '--') break;
      if (t.startsWith('--')) flags.add(t.split('=')[0]);
      else if (/^-[A-Za-z]+$/.test(t)) for (const ch of t.slice(1)) flags.add('-' + ch);
    }
    return flags;
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
    this.examples.push({ kind: 'regex',
      title: mode === 'inverted' ? this.s('例（`-v` なので一致しない行が表示される）', 'Example (with `-v`, lines that do not match are printed)') : this.s('例', 'Example'),
      sections: sections.filter((s) => s.lines.length),
      interactive: this.interactive({ kind: 'regex', regex: js, mode }, [...yes, ...no], this.s('試す文字列（1行ずつ判定し、一致した部分を色付け）', 'Test strings (one per line; matches are highlighted)')),
    });
  }

  /** The scripts given to sed with -e/--expression, in order; undefined when there are none. */
  private sedScripts(): string[] | undefined {
    const args = this.argCtx!.args;
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const t = args[i].text;
      if (t.startsWith('--expression=')) out.push(literalContent(args[i])?.text.slice('--expression='.length) ?? '');
      else if (t === '--expression' || /^-[a-zA-Z]*e$/.test(t)) {
        const v = args[++i];
        if (!v) break;
        const lit = literalContent(v);
        if (!lit) return undefined;
        out.push(lit.text);
      }
    }
    return out.length ? out : undefined;
  }

  /** --arg / --argjson values of the current jq command. */
  private jqVars(): Record<string, Json> {
    const args = this.argCtx!.args;
    const vars: Record<string, Json> = {};
    for (let i = 0; i + 2 < args.length; i++) {
      const t = args[i].text;
      if (t !== '--arg' && t !== '--argjson') continue;
      const name = literalContent(args[i + 1])?.text;
      const value = literalContent(args[i + 2])?.text;
      if (name !== undefined && value !== undefined) {
        try {
          vars[name] = t === '--arg' ? value : JSON.parse(value);
        } catch {
          // Not valid JSON: leave it out, and the example will not be made.
        }
      }
      i += 2;
    }
    return vars;
  }

  /** Input and output of a yq expression, in the YAML each yq reads and prints. */
  private yqExample(filter: string, style: YamlStyle): void {
    const flags = this.cmdFlags();
    const words = this.argCtx!.args.map((a) => literalContent(a)?.text ?? '');
    // mikefarah/yq: only expressions made of operations that behave as in jq (checked against yq).
    if (style === 'mikefarah' && !yqSameAsJq(filter)) return;
    const format = words.map((w, i) => (/^(-o|--output-format)$/.test(w) ? words[i + 1] : /^-o=?(.+)$/.exec(w)?.[1] ?? /^--output-format=(.+)$/.exec(w)?.[1])).find(Boolean);
    const json = style === 'mikefarah' ? format === 'json' || format === 'j' : !(flags.has('-y') || flags.has('--yaml-output') || flags.has('-Y') || flags.has('--yaml-roundtrip'));
    if (style === 'mikefarah' && format && !json && format !== 'yaml' && format !== 'y') return;
    const raw = style === 'mikefarah' ? !json : flags.has('-r') || flags.has('--raw-output');
    let runs = jqExample(filter, { raw, nullInput: flags.has('-n') || flags.has('--null-input'), vars: style === 'kislyuk' ? this.jqVars() : {} });
    // Where jq stops with an error, mikefarah/yq is often lenient (it adds a string and a number), so show nothing.
    if (style === 'mikefarah') runs = runs?.filter((r) => !r.error);
    if (!runs?.length) return;
    const inPlace = flags.has('-i') || flags.has('--inplace') || flags.has('--in-place');
    try {
      runs.forEach((r, i) => {
        const input = yamlLines(r.input, style);
        const output = r.error ? [r.error] : json
          ? r.values.map((v) => (raw && typeof v === 'string' ? v : toJson(v)))
          : yqYamlOutput(r.values, style);
        this.examples.push({ kind: 'yq',
          title: inPlace ? this.s('例（ファイルの中身がこう書き換わる）', 'Example (the file is rewritten like this)') : i === 0 ? this.s('例', 'Example') : this.s('例（値が無いとき）', 'Example (when the value is missing)'),
          sections: [
            { label: this.s('入力（YAML）', 'Input (YAML)'), lines: input },
            r.error ? { label: this.s('エラー', 'Error'), lines: output } : { label: this.s(`出力（${json ? 'JSON' : 'YAML'}）`, `Output (${json ? 'JSON' : 'YAML'})`), lines: output, empty: this.s('（出力なし）', '(no output)') },
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

  private jqExamples(runs: JqRun[], spec?: RerunSpec): void {
    runs.forEach((r, i) => {
      // Short JSON stays on one line; longer JSON is indented like jq prints it.
      const compact = toJson(r.input);
      const input = compact.length <= 60 ? [compact] : JSON.stringify(r.input, null, 2).split('\n');
      this.examples.push({ kind: 'jq',
        title: i === 0 ? this.s('例', 'Example') : this.s('例（値が無いとき）', 'Example (when the value is missing)'),
        sections: [
          { label: this.s('入力', 'Input'), lines: input },
          r.error
            ? { label: this.s('エラー', 'Error'), lines: [r.error] }
            : { label: this.s('出力', 'Output'), lines: r.outputs, empty: this.s('（出力なし）', '(no output)') },
        ],
        // Only the first example can be edited; the second shows the missing-value case.
        ...(spec && i === 0 && r.input !== null ? { interactive: this.interactive(spec, JSON.stringify(r.input, null, 2).split('\n'), this.s('入力（JSON）', 'Input (JSON)')) } : {}),
      });
    });
  }

  /** -F and -v of the current awk command (literal values only). */
  private awkOptions(): { fs?: string; vars: Record<string, string> } {
    const args = this.argCtx!.args;
    const opts: { fs?: string; vars: Record<string, string> } = { vars: {} };
    const value = (i: number, prefix: number) => {
      const lit = literalContent(args[i]);
      return lit ? lit.text.slice(prefix) : undefined;
    };
    for (let i = 0; i < args.length; i++) {
      const t = args[i].text;
      let v: string | undefined;
      if (t === '-F' || t === '-v') v = args[i + 1] && value(++i, 0);
      else if (/^-[Fv]./.test(t)) v = value(i, 2);
      else if (t.startsWith('--field-separator=')) v = value(i, '--field-separator='.length);
      else continue;
      if (v === undefined) continue;
      if (t.startsWith('-v')) {
        const eq = v.indexOf('=');
        if (eq > 0) opts.vars[v.slice(0, eq)] = v.slice(eq + 1);
      } else {
        // `-F'\t'` is a tab; `-Ft` is the letter t in gawk and mawk alike.
        opts.fs = v.replace(/\\t/g, '\t');
      }
    }
    return opts;
  }

  /** Sample data run through every stage of a pipeline, showing what each stage leaves. */
  private pipelineExample(n: SyntaxNode): Example | undefined {
    // A pipeline is explained on the line it is on, or whole (see sub).
    const stages: Stage[] = [];
    let readsFile = false;
    for (const [i, c] of n.namedChildren.entries()) {
      let cmd = c;
      if (c.type === 'redirected_statement') {
        const body = c.childForFieldName('body');
        if (!body || body.type !== 'command') return undefined;
        // `grep x < file` reads a file; output redirections other than 2>/dev/null change where data goes.
        for (const r of c.namedChildren.filter((x) => !same(x, body))) {
          const op = r.children.find((x) => !x.isNamed)?.type;
          if (r.type === 'file_redirect' && op === '<' && i === 0) readsFile = true;
          else if (!(r.type === 'file_redirect' && r.childForFieldName('descriptor')?.text === '2')) return undefined;
        }
        cmd = body;
      }
      if (cmd.type !== 'command') return undefined;
      const name = cmd.childForFieldName('name');
      if (!name || !isPlainWord(name.namedChildren[0]!)) return undefined;
      const args = cmd.namedChildren.filter((x) => !same(x, name) && x.type !== 'variable_assignment' && !x.type.endsWith('redirect'));
      stages.push({ cmd: name.text.split('/').pop()!, words: args.map((a) => literalContent(a)?.text), text: shorten(cmd.text, 40) });
    }
    const ex = pipelineExample(stages, readsFile);
    if (!ex) return undefined;
    const cap = (lines: string[]) => (lines.length > 8 ? [...lines.slice(0, 7), '…'] : lines).map(visible);
    const sections: ExampleSection[] = [];
    const fromFile = readsFile || readsFileOperand(stages[0]);
    if (ex.input) sections.push({ label: fromFile ? this.s('入力（ファイルの中身の例）', 'Input (sample file contents)') : this.s('入力', 'Input'), lines: cap(ex.input) });
    ex.steps.forEach((step, i) => {
      // `cat file` passes the input on unchanged.
      if (step.stage.cmd === 'cat' && i < ex.steps.length - 1) return;
      const last = i === ex.steps.length - 1;
      const label = step.stage.cmd === 'xargs'
        ? this.s(`\`${step.stage.text}\` が実行するコマンド`, `Commands run by \`${step.stage.text}\``)
        : last ? this.s(`出力（\`${step.stage.text}\` の後）`, `Output (after \`${step.stage.text}\`)`)
          : this.s(`\`${step.stage.text}\` の後`, `After \`${step.stage.text}\``);
      sections.push({ label, lines: cap(step.output), empty: this.s('（なし）', '(nothing)') });
    });
    return {
      title: this.s('例（パイプライン全体）', 'Example (the whole pipeline)'), sections,
      // Data from a file can be edited; data made by echo or seq cannot.
      ...(ex.input ? { interactive: this.interactive({ kind: 'pipeline', stages }, ex.input, sections[0].label) } : {}),
    };
  }

  /** Examples for coreutils-style commands (sort, uniq, cut, tr, head, tail, seq, basename, dirname). */
  private commandExampleFor(name: string, args: SyntaxNode[]): void {
    const cmd = name.split('/').pop()!;
    if (cmd === 'printf') { this.printfExample(args); return; }
    if (cmd === 'xargs') { this.xargsExample(args); return; }
    if (cmd === 'getopt') { this.getoptExample(args); return; }
    if (cmd === 'perl') {
      const words = args.map((a) => literalContent(a)?.text);
      const parsed = perlOptions(words);
      const ex = parsed && perlExample(parsed.code, parsed.opts);
      if (!ex) return;
      const inPlace = words.some((w) => /^-[a-zA-Z]*i/.test(w ?? ''));
      if (ex.input.length) this.ioExample(ex.input, ex.output, inPlace, { kind: 'perl', code: parsed!.code, opts: parsed!.opts });
      else this.examples.push({ kind: 'perl', title: this.s('例', 'Example'), sections: [{ label: this.s('出力', 'Output'), lines: ex.output.map(visible), empty: this.s('（出力なし）', '(no output)') }] });
      return;
    }
    if (!(cmd in FILTERS) && !['seq', 'basename', 'dirname'].includes(cmd)) return;
    const words = args.map((a) => literalContent(a)?.text);
    const ex = commandExample(cmd, words);
    if (!ex) return;
    // Only the filters take input.
    if (ex.input) this.ioExample(ex.input, ex.output, false, { kind: 'filter', cmd, words });
    else this.examples.push({ kind: 'textFilters', title: this.s('例', 'Example'), sections: [{ label: this.s('出力', 'Output'), lines: ex.output.map(visible) }] });
  }

  /** The text of an unquoted word (or concatenation of unquoted parts), where braces and globs take effect. */
  private unquotedWord(a: SyntaxNode): string | undefined {
    const plain = (x: SyntaxNode) => x.type === 'word' || x.type === 'number' || x.type === 'brace_expression';
    if (plain(a) || (a.type === 'concatenation' && a.namedChildren.every(plain))) return a.text;
    return undefined;
  }

  /** Brace expansion results, or file names a glob matches, for an argument word. */
  private wordExample(a: SyntaxNode): void {
    const text = this.unquotedWord(a);
    if (!text) return;
    try {
      const words = braceExpand(text);
      if (words) {
        this.examples.push({ kind: 'glob',
          title: this.s(`例（ブレース展開 \`${text}\`）`, `Example (brace expansion \`${text}\`)`),
          sections: [{ label: this.s('展開後の単語', 'Resulting words'), lines: words.length > 12 ? [...words.slice(0, 11), '…'] : words }],
        });
        return;
      }
    } catch (e) {
      if (!(e instanceof ShellWordsUnsupported)) throw e;
      return;
    }
    if (isGlob(text)) this.globExample(text, 'file', this.s(`例（グロブ \`${text}\`）`, `Example (glob \`${text}\`)`));
  }

  /**
   * What `**` does in a file-name glob. It is written for any depth, so it is explained that way, with
   * a pitfall when globstar is not seen turned on before (it may be, in a file read with `source`).
   */
  private globNotes(text: string): string {
    return this.globOptionNote() + this.starStarNote(text) + this.extglobNote(text);
  }

  /** The extended globs of a pattern in words: `!(*.txt)` is anything but `*.txt`. */
  private extglobNote(text: string): string {
    const parts = extglobs(text).map(({ op, text: t, alts }) => {
      const list = alts.map((a) => `\`${a}\``).join(this.s('、', ', '));
      const one = alts.length === 1;
      const ja = { '@': one ? list : `${list} のどれか`, '!': `${list} の${one ? '' : 'どれにも'}一致しないもの`.replace('` の一致', '` に一致'), '?': `${list} が0回か1回`, '*': `${list} の0回以上の繰り返し`, '+': `${list} の1回以上の繰り返し` }[op];
      const en = { '@': one ? list : `one of ${list}`, '!': `anything but ${list}`, '?': `${list} zero or one time`, '*': `${list} repeated zero or more times`, '+': `${list} repeated one or more times` }[op];
      return this.s(`\`${t}\` は ${ja}`, `\`${t}\` is ${en}`);
    });
    return parts.length ? this.s(`。拡張グロブ: ${parts.join('、')}`, `. Extended glob: ${parts.join('; ')}`) : '';
  }

  /**
   * `… | while read l; do n=…; done; echo "$n"`: each part of a pipeline runs in a subshell (the last
   * one too, in bash without lastpipe, and in dash and the like), so variables set there are gone after
   * it. Pointed out where the pipeline starts, when such a variable is used after it.
   */
  private pipeSubshellPitfalls(root: SyntaxNode, line: number): string[] {
    if (this.shell === 'zsh' || this.shell === 'ksh' || this.shopt.lastpipe === 'on') return [];
    for (const p of root.descendantsOfType('pipeline', { row: line, column: 0 }, { row: line + 1, column: 0 })) {
      if (!p || p.startPosition.row !== line) continue;
      const last = p.namedChildren[p.namedChildren.length - 1];
      if (!last || !['while_statement', 'until_statement', 'for_statement', 'compound_statement', 'command'].includes(last.type)) continue;
      const names = new Set<string>();
      for (const a of last.descendantsOfType('variable_assignment')) {
        const n = a?.childForFieldName('name')?.text;
        // Not `X=1 cmd`, which only sets X for cmd, nor `local`.
        if (n && a!.parent?.type !== 'command' && !ancestorOf(a!, (x) => x.type === 'declaration_command' && /^local\b/.test(x.text))) names.add(n);
      }
      for (const c of [last, ...last.descendantsOfType('command')]) {
        if (c?.type === 'command' && c.childForFieldName('name')?.text === 'read' && (c === last || last.type !== 'while_statement' || !ancestorOf(c, (x) => x === last.childForFieldName('condition')))) {
          for (const w of c.childrenForFieldName('argument')) if (w && /^[A-Za-z_]\w*$/.test(w.text) && !/^-/.test(w.previousSibling?.text ?? '')) names.add(w.text);
        }
      }
      if (!names.size) continue;
      // Used after the pipeline, in the same block.
      let scope: SyntaxNode = p;
      while (scope.parent && !['program', 'compound_statement', 'do_group', 'subshell', 'if_statement', 'else_clause', 'elif_clause', 'case_item'].includes(scope.parent.type)) scope = scope.parent;
      const after = (scope.parent ?? root).text.slice(scope.endIndex - (scope.parent ?? root).startIndex);
      // Read before being set again (a later loop may set the same names for itself).
      const used = [...names].find((n) => {
        const use = after.search(new RegExp(`\\$\\{?${n}\\b`));
        const set = after.search(new RegExp(`(^|[^\\w$])${n}\\+?=|\\bread\\b[^\\n;|&]*\\s${n}\\b`));
        return use >= 0 && (set < 0 || use < set);
      });
      if (!used) continue;
      const bash = !this.shell || this.shell === 'bash';
      const fix: [string, string] = last.type === 'command'
        ? (bash ? [`\`read ${used} < <(コマンド)\` のようにプロセス置換で渡すか、\`shopt -s lastpipe\` にします`, `Use process substitution, \`read ${used} < <(command)\`, or turn on \`shopt -s lastpipe\``]
          : [`\`${used}=$(コマンド)\` のようにコマンド置換で受け取ります`, `Take the output with command substitution: \`${used}=$(command)\``])
        : (bash ? ['`done < ファイル` や `done < <(コマンド)` のようにリダイレクトで渡すか、`shopt -s lastpipe` にします', 'Feed the loop with a redirection, `done < file` or `done < <(command)`, or turn on `shopt -s lastpipe`']
          : ['`done < ファイル` のようにリダイレクトで渡すか、一時ファイルを使います', 'Feed the loop with a redirection, `done < file`, or use a temporary file']);
      return [this.s(
        `⚠ 落とし穴: パイプ（\`|\`）でつないだコマンドはサブシェルで実行されるので、右側で設定した \`${used}\` はパイプラインが終わると消え、あとの \`$${used}\` には届きません。${fix[0]}`,
        `⚠ Pitfall: the commands of a pipeline (\`|\`) run in subshells, so \`${used}\` set on the right side is gone when the pipeline ends; the later \`$${used}\` does not see it. ${fix[1]}`)];
    }
    return [];
  }

  /**
   * `for f in *.log`: when nothing matches, the loop runs once with `*.log` itself (unless nullglob or
   * failglob is on, or zsh, where it is an error). Quiet when the body checks that the file exists.
   */
  private unmatchedGlobPitfalls(root: SyntaxNode, line: number): string[] {
    if (this.shell === 'zsh' || this.shopt.nullglob === 'on' || this.shopt.failglob === 'on') return [];
    for (const loop of root.descendantsOfType('for_statement', { row: line, column: 0 }, { row: line + 1, column: 0 })) {
      if (!loop || loop.startPosition.row !== line) continue;
      // `*.log`, and `"$dir"/*.log` too.
      const glob = loop.childrenForFieldName('value').find((v) => !!v && ((!!this.unquotedWord(v) && isGlob(v.text))
        || (v.type === 'concatenation' && v.namedChildren.some((c) => c?.type === 'word' && isGlob(c.text)))));
      const v = loop.childForFieldName('variable')?.text;
      if (!glob || !v) continue;
      const body = loop.childForFieldName('body')!.text;
      if (new RegExp(`-[efdrsLh]\\s+"?\\$\\{?${v}\\b`).test(body)) continue;
      const nullglob = this.shopt.nullglob !== 'unsupported';
      const fix = this.s(nullglob ? '書くか、ループの前で `shopt -s nullglob` にします' : '書きます', nullglob ? ', or turn on `shopt -s nullglob` before the loop' : '');
      return [this.s(
        `⚠ 落とし穴: \`${glob.text}\` に一致するファイルが1つもないと、\`${v}\` に \`${glob.text}\` という文字列がそのまま入って1回実行されます。本体の先頭に \`[ -e "$${v}" ] || continue\` を${fix}`,
        `⚠ Pitfall: when no file matches \`${glob.text}\`, the loop runs once with \`${v}\` set to the text \`${glob.text}\` itself. Start the body with \`[ -e "$${v}" ] || continue\`${fix}`)];
    }
    return [];
  }

  /**
   * bash reads an extended glob only after `shopt -s extglob` (except in `[[ ]]`), and reads a whole
   * function or block before running it, so turning it on inside the same block is too late.
   */
  private extglobPitfalls(root: SyntaxNode, line: number): string[] {
    if (this.shell && this.shell !== 'bash') return [];
    const uses = root.descendantsOfType(['word', 'extglob_pattern'], { row: line, column: 0 }, { row: line + 1, column: 0 })
      .filter((n): n is SyntaxNode => !!n && n.startPosition.row === line && hasExtglob(n.text) && !ancestorOf(n, (a) => a.type === 'test_command' && a.child(0)?.type === '[['));
    if (!uses.length) return [];
    const use = uses[0];
    let top = use;
    while (top.parent && top.parent.type !== 'program') top = top.parent;
    const inBlock = top !== use && top.descendantsOfType('command').some((c) => !!c && c.startIndex < use.startIndex && c.childForFieldName('name')?.text === 'shopt'
      && /(^|\s)-\w*s/.test(c.text) && /\bextglob\b/.test(c.text));
    if (inBlock) {
      return [this.s(
        `⚠ 落とし穴: bash は関数や \`if\`・\`{ }\` などのまとまりを最後まで読んでから実行します。そのため、同じまとまりの中の \`shopt -s extglob\` は \`${use.text}\` を読む時点ではまだ効いておらず、構文エラーになります。\`shopt -s extglob\` は、まとまりの外のそれより前の行に書きます`,
        `⚠ Pitfall: bash reads a whole function or block (\`if\`, \`{ }\`…) before running it, so a \`shopt -s extglob\` inside the same block is not yet on when it reads \`${use.text}\`: a syntax error. Put \`shopt -s extglob\` on an earlier line, outside the block`)];
    }
    const state = this.shopt.extglob;
    if (state === 'on') return [];
    return [state === 'off'
      ? this.s(`⚠ 落とし穴: \`${use.text}\` のような拡張グロブは \`shopt -s extglob\` のあとでないと構文エラーになりますが、\`shopt -u extglob\` で無効にされています`,
        `⚠ Pitfall: extended globs like \`${use.text}\` are a syntax error unless \`shopt -s extglob\` is on, and \`shopt -u extglob\` turned it off`)
      : this.s(`⚠ 落とし穴: \`${use.text}\` のような拡張グロブは、\`shopt -s extglob\` のあとでないと構文エラーになります（\`[[ ]]\` の中では不要）。この行より前に見当たりません。\`source\` したファイルなどで有効にしているなら問題ありません`,
        `⚠ Pitfall: extended globs like \`${use.text}\` are a syntax error unless \`shopt -s extglob\` comes first (not needed inside \`[[ ]]\`). It is not found before this line; fine if it is turned on elsewhere, as in a file read with \`source\``)];
  }

  /** What dotglob and nocaseglob, turned on before the line, change for a file-name glob. */
  private globOptionNote(): string {
    const notes: string[] = [];
    if (this.shopt.dotglob === 'on') notes.push(this.s('dotglob が有効なので `.` で始まる名前にも一致する', 'with dotglob on, it also matches names starting with `.`'));
    if (this.shopt.nocaseglob === 'on') notes.push(this.s('nocaseglob が有効なので大文字と小文字を区別しない', 'with nocaseglob on, case is ignored'));
    return notes.map((n) => this.s(`。${n}`, `; ${n}`)).join('');
  }

  private starStarNote(text: string): string {
    if (!hasGlobstar(text)) return '';
    const globstar = this.shopt.globstar;
    if (globstar === 'unknown' && this.opts.pitfalls !== false) {
      const on = this.shell === 'ksh' ? 'set -o globstar' : 'shopt -s globstar';
      this.extraNotes.push(this.s(
        `⚠ 落とし穴: \`**\` がサブディレクトリまでたどるのは \`${on}\` のあとだけです。この行より前に見当たらないので、このままでは \`*\` と同じく1階層分にしか一致しません。\`source\` したファイルなどで有効にしているなら問題ありません`,
        `⚠ Pitfall: \`**\` reaches into subdirectories only after \`${on}\`. It is not found before this line, so as it stands \`**\` is the same as \`*\` and matches one level only. Fine if it is turned on elsewhere, as in a file read with \`source\``));
    }
    if (globstar === 'unsupported' && this.opts.pitfalls !== false) {
      this.extraNotes.push(this.s(
        `⚠ 落とし穴: ${this.shell} には globstar がなく、\`**\` は \`*\` と同じく1階層分にしか一致しません。サブディレクトリまでたどるには \`find\` を使います`,
        `⚠ Pitfall: ${this.shell} has no globstar, so \`**\` is the same as \`*\` and matches one level only. To reach into subdirectories, use \`find\``));
    }
    return globstar === 'off' || globstar === 'unsupported'
      ? this.s(`。${globstar === 'off' ? 'globstar が無効なので' : 'このシェルでは'} \`**\` は \`*\` と同じで、1階層分にしか一致しない`, `. ${globstar === 'off' ? 'With globstar off' : 'In this shell'}, \`**\` is the same as \`*\` and matches one level only`)
      : this.s('。`**` は任意の深さのディレクトリ（0階層以上、`.` で始まるものは除く）に一致する', '. `**` matches directories at any depth (zero or more, not those starting with `.`)');
  }

  /** How globs match on this line: file names, or `case` and `[[ == ]]` patterns (`find -name` takes neither). */
  private globOpts(use: 'file' | 'pattern' | 'none'): GlobOpts {
    const on = (name: ShoptName) => this.shopt[name] === 'on';
    if (use === 'file') {
      const o: GlobOpts = { globstar: this.shopt.globstar === 'on' || this.shopt.globstar === 'unknown', dotglob: on('dotglob'), nocase: on('nocaseglob') };
      return Object.fromEntries(Object.entries(o).filter(([, v]) => v));
    }
    return use === 'pattern' && on('nocasematch') ? { nocase: true } : {};
  }

  private globExample(pattern: string, mode: GlobMode, title: string, labels?: [string, string]): void {
    const opts = this.globOpts(mode === 'file' ? 'file' : 'none');
    if (!hasGlobstar(pattern)) delete opts.globstar;
    const ex = globExamples(pattern, mode, opts);
    if (!ex) return;
    // Values (find -name) always come with their labels.
    const [yes, no] = labels ?? [this.s('一致するファイル名', 'Matching file names'), this.s('一致しないファイル名', 'Non-matching file names')];
    this.examples.push({ kind: 'glob',
      title, sections: [{ label: yes, lines: ex.matching }, { label: no, lines: ex.nonMatching }].filter((s) => s.lines.length),
      interactive: this.interactive({ kind: 'glob', pattern, mode, ...(Object.keys(opts).length ? { opts } : {}) }, [...ex.matching, ...ex.nonMatching], this.s('試す名前（1行に1つ）', 'Names to try (one per line)')),
    });
  }

  /** An example's editable form for the panel: the spec to run it again, and what it gives now. */
  private interactive(spec: RerunSpec, input: string[], inputLabel = this.s('入力', 'Input')): Interactive {
    return { spec, inputLabel, input, result: rerun(spec, input, this.lang) };
  }

  /** Values that select a case branch (any of its patterns) and values that do not. */
  private caseExample(pats: SyntaxNode[]): void {
    const texts = pats.map((p) => this.unquotedWord(p) ?? (p.type === 'extglob_pattern' ? p.text : undefined));
    if (texts.some((t) => t === undefined)) return;
    const all = texts as string[];
    const matching: string[] = [];
    const candidates: string[] = [];
    const opts = this.globOpts('pattern');
    for (const t of all) {
      const ex = globExamples(t, 'value', opts);
      if (!ex) return;
      matching.push(...ex.matching.slice(0, all.length > 1 ? 1 : 3));
      candidates.push(...ex.nonMatching);
    }
    const nonMatching = [...new Set(candidates)].filter((v) => !all.some((t) => globMatches(t, v, 'value', opts))).slice(0, 2);
    this.examples.push({ kind: 'glob',
      title: this.s(`例（パターン \`${all.join('|')}\`）`, `Example (pattern \`${all.join('|')}\`)`),
      sections: [{ label: this.s('この分岐に入る値', 'Values that take this branch'), lines: [...new Set(matching)] }, { label: this.s('入らない値', 'Values that do not'), lines: nonMatching }].filter((s) => s.lines.length),
    });
  }

  /** `git log` output for sample commits, for a `--pretty`/`--format` or `--date` value. */
  private gitLogExample(kind: 'gitformat' | 'gitdate', value: string): void {
    const words = this.argCtx!.args.map((a) => literalContent(a)?.text ?? '');
    const opt = (re: RegExp) => words.map((w) => re.exec(w)?.[1]).filter((v) => v !== undefined).pop();
    const pretty = kind === 'gitformat' ? value : opt(/^--(?:pretty|format)=([\s\S]*)$/) ?? (words.includes('--oneline') ? 'oneline' : undefined);
    const date = kind === 'gitdate' ? value : opt(/^--date=([\s\S]*)$/) ?? 'default';
    const now = Date.now();
    let commits = sampleCommits(now);
    const count = opt(/^(?:-n|--max-count=)(\d+)$/) ?? opt(/^-(\d+)$/) ?? words.find((w, i) => words[i - 1] === '-n' && /^\d+$/.test(w));
    if (count !== undefined) commits = commits.slice(0, Math.max(1, Number(count)));
    try {
      if (kind === 'gitdate') {
        this.examples.push({ kind: 'gitLog',
          title: this.s('例（この形式で表示した日時）', 'Example (dates in this style)'),
          sections: [{
            label: this.s('例のコミットの日時がこう表示される（`%ad`・`%cd` や Date: 行）', 'How the sample commits\' dates are shown (`%ad`, `%cd`, the Date: line)'),
            lines: commits.map((c) => visible(formatDate(c.time, date, now))),
          }],
        });
        return;
      }
      // Multi-line formats get long; two commits show the layout.
      const multi = !pretty || ['short', 'medium', 'full', 'fuller'].includes(pretty);
      const lines = runGitLog(multi ? commits.slice(0, 2) : commits, pretty, date, now);
      this.examples.push({ kind: 'gitLog',
        title: this.s('例（この書式での `git log` の出力）', 'Example (`git log` output with this format)'),
        sections: [{ label: this.s('例のコミットでの出力', 'Output for sample commits'), lines: lines.map(visible) }],
      });
    } catch (e) {
      if (!(e instanceof GitFormatUnsupported)) throw e;
    }
  }

  /** How getopt rearranges sample arguments, from the `-o` / `--long` given. */
  private getoptExample(args: SyntaxNode[]): void {
    const words = args.map((a) => literalContent(a)?.text);
    const spec: GetoptSpec = { short: '', long: [] };
    let i = 0;
    const value = (w: string, short: string, long: string[]): string | undefined => {
      if (w === short || long.includes(w)) return words[++i];
      if (w.startsWith(short) && w.length > 2) return w.slice(2);
      const eq = long.find((l) => w.startsWith(`${l}=`));
      return eq ? w.slice(eq.length + 1) : undefined;
    };
    let shortGiven = false;
    for (; i < words.length; i++) {
      const w = words[i];
      if (w === undefined) return;
      if (w === '--') break;
      if (!w.startsWith('-')) {
        // The old form: `getopt OPTSTRING ARGS…`.
        if (!shortGiven) {
          spec.short = w;
          spec.legacy = true;
        }
        break;
      }
      if (/^-(o|-options)/.test(w)) {
        const v = value(w, '-o', ['--options']);
        if (v === undefined) return;
        spec.short = v;
        shortGiven = true;
      } else if (/^-(l|-long)/.test(w)) {
        const v = value(w, '-l', ['--longoptions', '--long']);
        if (v === undefined) return;
        spec.long.push(...v.split(','));
      } else if (/^-(n|s|-name|-shell)/.test(w)) {
        if (!w.includes('=') && w.length === 2 || ['--name', '--shell'].includes(w)) i++;
      } else if (w === '-a' || w === '--alternative') {
        spec.alternative = true;
      } else if (/^-(Q|T|-quiet-output|-test)$/.test(w)) {
        return;
      }
    }
    if (!spec.short && !spec.long.length) return;
    try {
      const sample = sampleGetoptArgs(spec);
      const output = runGetopt(spec, sample);
      const shown = sample.map((a) => (/^[\w.,=\/-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(' ');
      this.examples.push({ kind: 'getopt',
        title: this.s('例', 'Example'),
        sections: [
          { label: this.s('スクリプトに渡された引数の例', 'Sample arguments given to the script'), lines: [shown] },
          {
            label: spec.legacy
              ? this.s('getopt の出力（`set --` に渡すと引数がこの順に並び直る。旧形式はクォートしないので空白を含む引数が壊れる）', 'What getopt prints (`set --` puts the arguments in this order; the old form does not quote, so arguments with spaces break)')
              : this.s('getopt の出力（`eval set --` に渡すと引数がこの順に並び直る）', 'What getopt prints (`eval set --` puts the arguments in this order)'),
            lines: [output.trimStart()],
          },
        ],
      });
      /* c8 ignore start */
    } catch (e) {
      // The sample arguments are made to fit the spec, so getopt never rejects them: a guard.
      if (!(e instanceof GetoptUnsupported)) throw e;
    }
    /* c8 ignore stop */
  }

  /** The commands xargs runs for a sample input. */
  private xargsExample(args: SyntaxNode[]): void {
    const ex = xargsExample(args.map((a) => literalContent(a)?.text));
    if (!ex) return;
    const input = ex.input.endsWith('\n') ? ex.input.slice(0, -1).split('\n') : [ex.input];
    this.examples.push({ kind: 'xargs',
      title: this.s('例', 'Example'),
      sections: [
        { label: this.s('入力（標準入力）', 'Input (stdin)'), lines: input.map(visible) },
        { label: this.s('実行されるコマンド', 'Commands that run'), lines: ex.commands, empty: this.s('（実行されない）', '(none)') },
      ],
      // Input split on NUL or another delimiter is not one item per line, so it is not editable.
      ...(args.some((a) => /^(-0|--null|-d|--delimiter)/.test(a.text)) ? {} : { interactive: this.interactive({ kind: 'xargs', words: args.map((a) => literalContent(a)?.text) }, input, this.s('入力（標準入力）', 'Input (stdin)')) }),
    });
  }

  /** How `read` splits a sample line into its variables (with the IFS given before it). */
  private readExample(n: SyntaxNode, args: SyntaxNode[]): void {
    let ifs = ' \t\n';
    for (const c of n.namedChildren) {
      if (c.type !== 'variable_assignment' || c.childForFieldName('name')?.text !== 'IFS') continue;
      const v = c.childForFieldName('value');
      const lit = v ? literalContent(v) : { text: '' };
      if (!lit) return;
      ifs = lit.text.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    }
    const words = args.map((a) => literalContent(a)?.text);
    if (words.some((w) => w === undefined)) return;
    let p;
    try {
      p = parseOptions(words, { flags: 'rse', values: 'aptu', long: {} });
    } catch {
      return;
    }
    const array = p.opts.find(([o]) => o === 'a')?.[1];
    const names = (p.operands as string[]).length ? (p.operands as string[]) : array ? [] : ['REPLY'];
    const raw = p.opts.some(([o]) => o === 'r');
    const line = readSampleLine(names.length, ifs, !!array);
    const r = runRead(line, names, { ifs, raw, array });
    const lines = r.array ? [`${r.array[0]}=(${r.array[1].map((x) => JSON.stringify(x)).join(' ')})`] : r.vars.map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    this.examples.push({ kind: 'read',
      title: this.s('例', 'Example'),
      sections: [{ label: this.s('読み込む行', 'Line read'), lines: [JSON.stringify(line)] }, { label: this.s('変数に入る値', 'Values stored'), lines }],
    });
  }

  /** Values that make a simple `[ ]` / `[[ ]]` / `(( ))` test true and false. */
  private testExample(n: SyntaxNode): void {
    if (n.namedChildren.length !== 1) return;
    this.testExampleFor(n.child(0)?.type as '[' | '[[' | '((', n.namedChildren[0]);
  }

  private testExampleFor(kind: '[' | '[[' | '((', expr: SyntaxNode): void {
    const operand = (x: SyntaxNode | null | undefined): Operand | undefined => {
      if (!x) return undefined;
      if (x.type === 'simple_expansion' || (x.type === 'expansion' && /^\$\{\w+\}$/.test(x.text))) return { var: x.text.replace(/^\$\{?|\}$/g, '') };
      if (x.type === 'variable_name') return { var: x.text };
      if (x.type === 'string' && x.namedChildren.length === 1 && x.namedChildren[0].type === 'simple_expansion' && x.text === `"${x.namedChildren[0].text}"`) return operand(x.namedChildren[0]);
      const lit = literalContent(x);
      return lit ? { lit: lit.text } : undefined;
    };
    let cases;
    if (expr.type === 'unary_expression') {
      const op = expr.childForFieldName('operator')?.text ?? expr.child(0)?.text ?? '';
      cases = testCases(kind, op, undefined, operand(expr.namedChildren.find((c) => c.type !== 'test_operator')));
    } else if (expr.type === 'binary_expression') {
      const l = expr.childForFieldName('left');
      const r = expr.childForFieldName('right');
      const op = expr.childForFieldName('operator')?.text ?? '';
      cases = testCases(kind, op, operand(l), operand(r), r?.type === 'string' || r?.type === 'raw_string', !!this.globOpts('pattern').nocase);
    }
    if (!cases) return;
    const show = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => (/^\d+$/.test(k) ? `$${k}=${JSON.stringify(v)}` : `${k}=${JSON.stringify(v)}`)).join(' ');
    this.examples.push({ kind: 'test',
      title: this.s('例', 'Example'),
      sections: [
        { label: this.s('真になる値', 'True when'), lines: cases.filter((c) => c.result).map((c) => show(c.vars)) },
        { label: this.s('偽になる値', 'False when'), lines: cases.filter((c) => !c.result).map((c) => show(c.vars)) },
      ],
    });
  }

  /** What `printf FORMAT ARGS…` prints, when all of them are literal. */
  private printfExample(args: SyntaxNode[]): void {
    const words = args.map((a) => literalContent(a)?.text);
    if (words.some((w) => w === undefined)) return;
    let list = words as string[];
    let target: string | undefined;
    if (list[0] === '-v') {
      target = list[1];
      list = list.slice(2);
    }
    if (list[0] === '--') list = list.slice(1);
    if (!list.length) return;
    let out: string;
    try {
      out = bashPrintf(list[0], list.slice(1));
    } catch (e) {
      if (e instanceof ShellWordsUnsupported) return;
      throw e;
    }
    const endsWithNewline = out.endsWith('\n');
    const lines = (endsWithNewline ? out.slice(0, -1) : out).split('\n').map(visible);
    const label = target
      ? this.s(`変数 \`${target}\` に入る値`, `Value stored in \`${target}\``)
      : endsWithNewline ? this.s('出力', 'Output') : this.s('出力（末尾に改行なし）', 'Output (no trailing newline)');
    this.examples.push({ kind: 'printf', title: this.s('例', 'Example'), sections: [{ label, lines, empty: this.s('（空文字）', '(empty)') }] });
  }

  /** An input → output example (sed, awk, sort…); tabs and control characters are made visible. */
  /** What `date +FORMAT` prints at fixed, made-up moments (in UTC, so the same line always shows the same). */
  private dateExample(format: string): void {
    const outputs = SAMPLE_DATES.map((d) => formatDateCommand(format, parseSampleDate(d)!));
    if (outputs.some((o) => o === undefined)) return;
    const spec: RerunSpec = { kind: 'date', format };
    this.examples.push({ kind: 'date',
      interactive: this.interactive(spec, SAMPLE_DATES),
      title: this.s('例', 'Example'),
      sections: [
        { label: this.s('日時（UTC）', 'Date and time (UTC)'), lines: SAMPLE_DATES },
        { label: this.s('出力', 'Output'), lines: outputs.map((o) => visible(o!)) },
      ],
    });
  }

  private ioExample(input: string[], output: string[], inPlace = false, spec?: RerunSpec): void {
    const tabs = (lines: string[]) => lines.map(visible);
    this.examples.push({ kind: spec?.kind === 'sed' || spec?.kind === 'awk' || spec?.kind === 'perl' ? spec.kind : 'textFilters',
      ...(spec ? { interactive: this.interactive(spec, input) } : {}),
      title: inPlace ? this.s('例（ファイルの中身がこう書き換わる）', 'Example (the file is rewritten like this)') : this.s('例', 'Example'),
      sections: [
        { label: this.s('入力', 'Input'), lines: tabs(input) },
        { label: inPlace ? this.s('書き換え後', 'After') : this.s('出力', 'Output'), lines: tabs(output), empty: this.s('（出力なし）', '(no output)') },
      ],
    });
  }

  /** Regex dialect implied by the current command and its options. */
  private regexFlavor(): Flavor | 'fixed' {
    const ctx = this.argCtx;
    if (!ctx) return 'ere';
    const cmd = ctx.cmd.split('/').pop() ?? ctx.cmd;
    const flags = new Set<string>();
    for (const w of ctx.args) {
      const t = w.text;
      if (t === '--') break;
      if (t.startsWith('--')) flags.add(t.split('=')[0]);
      else if (/^-[A-Za-z]+$/.test(t)) for (const ch of t.slice(1)) flags.add('-' + ch);
    }
    if (cmd === 'sed') return flags.has('-E') || flags.has('-r') || flags.has('--regexp-extended') ? 'ere' : 'bre';
    if (flags.has('-P') || flags.has('--perl-regexp')) return 'pcre';
    if (flags.has('-F') || flags.has('--fixed-strings') || cmd === 'fgrep') return 'fixed';
    if (flags.has('-E') || flags.has('--extended-regexp') || cmd === 'egrep') return 'ere';
    return 'bre';
  }

  /** Explain an option at args[i]; returns the index of the last consumed word. */
  private option(doc: CommandDoc | undefined, args: SyntaxNode[], i: number, cmdName: string, out: Token[]): number {
    const a = args[i];
    let text = a.text;
    const opts = doc?.options ?? {};
    // Options are explained with the whole command, which is on the line (see sub): all of them show.
    const unknown = this.s(`オプション（辞書に未登録。\`man ${cmdName.split(' ')[0]}\` を参照）`, `Option (not in the dictionary; see \`man ${cmdName.split(' ')[0]}\`)`);
    let disable = false;
    if (cmdName === 'set' && text.startsWith('+')) { disable = true; text = '-' + text.slice(1); }
    const pre = disable ? this.s('無効化: ', 'Disable: ') : '';

    const valueTok = (opt: OptDoc, flag: string, v: SyntaxNode): Token => {
      if (opt.lang) return this.positional(v, this.s(`\`${flag}\` オプションの値`, `Value for \`${flag}\``) + ': ' + this.t(opt.text), opt.lang);
      const known = opt.values?.[v.text];
      return this.tok(v, 'argument', known
        ? `${v.text}: ${this.t(known)}`
        : this.s(`\`${flag}\` オプションの値`, `Value for \`${flag}\``), isPlainWord(v) ? [] : this.sub(v));
    };

    // `--name=value`
    const eq = text.indexOf('=');
    // `--name=value`, and `-name=value` for commands with single-dash long options (`terraform -var-file=x`).
    if (eq > 0 && (text.startsWith('--') || (doc?.longSingleDash && opts[text.slice(0, eq)]))) {
      const flag = text.slice(0, eq);
      const opt = opts[flag];
      {
        const whole = literalContent(a);
        const litEq = whole?.text.indexOf('=') ?? -1;
        const val = whole && litEq >= 0 ? whole.text.slice(litEq + 1) : text.slice(eq + 1);
        const known = opt?.values?.[val];
        const valueLit: Literal | undefined = whole && litEq >= 0
          ? (whole.offsets ? { text: val, offsets: whole.offsets.slice(litEq + 1) } : { text: val, base: (whole.base ?? 0) + litEq + 1 })
          : undefined;
        const emb = opt?.lang && valueLit ? this.embeddedText(valueLit, opt.lang, a) : undefined;
        const extra = emb?.note ? ` — ${emb.note}` : '';
        out.push(this.tok(a, 'option', (opt ? this.t(opt.text) : unknown) + this.s(`（値: \`${val}\`${known ? ' — ' + this.t(known) : ''}）`, ` (value: \`${val}\`${known ? ' — ' + this.t(known) : ''})`) + extra, emb?.tokens ?? []));
      }
      return i;
    }

    // `head -5`, `tail -1`, `git log -3`: the old way to write `-n N`.
    const count = /^-(\d+)$/.exec(text)?.[1];
    const countCmd = cmdName.split(' ').map((w, k) => (k ? w : w.split('/').pop())).join(' ');
    if (count && !opts[text] && ['head', 'tail', 'git log', 'git show'].includes(countCmd)) {
      {
        out.push(this.tok(a, 'option', countCmd.startsWith('git')
          ? this.s(`${count} 件だけ（\`-n ${count}\` と同じ）`, `only ${count} (same as \`-n ${count}\`)`)
          : this.s(`${count} 行（\`-n ${count}\` の古い書き方）`, `${count} line${count === '1' ? '' : 's'} (old way to write \`-n ${count}\`)`)));
      }
      return i;
    }

    const exact = opts[text];
    if (exact || text.startsWith('--') || doc?.longSingleDash) {
      const opt = exact;
      let last = i;
      const children: Token[] = [];
      if (opt?.untilTerminator) {
        let j = i + 1;
        while (j < args.length && !TERMINATORS.has(args[j].text)) j++;
        const inner = args.slice(i + 1, j);
        if (inner.length) {
          const run = this.wrapped(inner, this.s('実行するコマンド: ', 'Command to run: '));
          // `{}` is replaced by find (and `xargs -I{}`) with each path.
          const mark = (ts: Token[]) => ts.forEach((t) => {
            if (t.label === '{}') {
              t.explanation = this.s('`{}`: 見つかったファイルのパスに置き換わる', '`{}`: replaced with the path that was found');
              t.children = [];
            } else mark(t.children);
          });
          mark(run.children);
          children.push(run);
        }
        if (j < args.length) {
          const term = args[j];
          {
            children.push(this.tok(term, 'operator', term.text === '+'
              ? this.s('`-exec` の終わり: 見つかったファイルをまとめて1回のコマンドに渡す', 'End of `-exec`: pass all matches to one command invocation')
              : this.s('`-exec` の終わり: 見つかったファイル1件ごとにコマンドを実行（`;` はシェルに解釈されないようエスケープが必要）', 'End of `-exec`: run once per match (`;` must be escaped from the shell)')));
          }
        }
        last = Math.min(j, args.length - 1);
      } else if (opt?.arg && i + 1 < args.length) {
        last = i + 1;
        children.push(valueTok(opt, text, args[last]));
      }
      out.push(this.tok(a, 'option', pre + (opt ? this.t(opt.text) : unknown), []));
      out.push(...children);
      return last;
    }

    // Combined short options: `-rn`, `-euo pipefail`, `-n5`.
    const letters = text.slice(1);
    const parts: Token[] = [];
    let last = i;
    const col = a.startPosition.column;
    const row = a.startPosition.row;
    const sub = (from: number, to: number, kind: Kind, expl: string, label: string): Token => ({
      kind, label, explanation: expl, children: [],
      span: { start: { line: row, character: col + from }, end: { line: row, character: col + to } },
    });
    for (let k = 0; k < letters.length; k++) {
      const flag = '-' + letters[k];
      const opt = opts[flag];
      const at = k + 1;
      if (!opt) { parts.push(sub(at, at + 1, 'option', unknown, flag)); continue; }
      parts.push(sub(at, at + 1, 'option', pre + this.t(opt.text), flag));
      if (opt.attachedOnly) {
        // `-i.bak`: the rest of the word is the value. In `-pie` that makes `e` the value, not `-e`.
        if (k + 1 < letters.length) {
          const val = letters.slice(k + 1);
          const trap = /^[a-zA-Z]/.test(val) && opts['-' + val[0]] && this.s(`。注意: \`${val}\` は別のオプションではなく \`${flag}\` の値として扱われる`, `. Note: \`${val}\` is taken as the value of \`${flag}\`, not as more options`);
          parts.push(sub(at + 1, text.length, 'argument', this.s(`\`${flag}\` の値 \`${val}\``, `Value \`${val}\` for \`${flag}\``) + (trap || ''), val));
        }
        break;
      }
      if (opt.arg) {
        if (k + 1 < letters.length) {
          const val = letters.slice(k + 1);
          const valTok = sub(at + 1, text.length, 'argument', opt.values?.[val] ? `${val}: ${this.t(opt.values[val])}` : this.s(`\`${flag}\` の値`, `Value for \`${flag}\``), val);
          // `-k3,3nr`, `-f2-4`: the attached value can be broken down like a separate one.
          const emb = opt.lang && !/[\\'"$`]/.test(text) ? this.embeddedText({ text: val, base: at + 1 }, opt.lang, a) : undefined;
          if (emb) {
            valTok.children = emb.tokens;
            if (emb.note) valTok.explanation += ` — ${emb.note}`;
          }
          parts.push(valTok);
        } else if (i + 1 < args.length) {
          last = i + 1;
          parts.push(valueTok(opt, flag, args[last]));
        }
        break;
      }
    }
    const own = parts.filter((p) => p.span.start.line === row && p.span.end.character <= col + text.length);
    const tail = parts.filter((p) => !own.includes(p));
    {
      const flags = own.filter((p) => p.kind === 'option');
      // `-F,` / `-n5`: one option with its value attached is not a combination.
      out.push(this.tok(a, 'option', flags.length > 1
        ? this.s(`短いオプション ${flags.map((p) => `\`${p.label}\``).join(' ')} をまとめて指定`, `Combined short options ${flags.map((p) => `\`${p.label}\``).join(' ')}`)
        : flags[0]?.explanation ?? unknown, flags.length > 1 ? own : own.filter((p) => p.kind === 'argument')));
    }
    out.push(...tail);
    return last;
  }

  /** Words forming a command run by another command (sudo, xargs, find -exec…). */
  private wrapped(words: SyntaxNode[], prefix = ''): Token {
    const first = words[0];
    const name = first.text;
    const doc = customCommandDoc(this.opts.customCommands?.[name.split('/').pop() ?? name]) ?? lookupCommand(name);
    const explanation = doc ? this.t(doc.summary) : this.s(`コマンド \`${name}\``, `Command \`${name}\``);
    const children = this.args(doc, words.slice(1), name);
    const span: Span = { start: spanOf(first).start, end: spanOf(words[words.length - 1]).end };
    const text = words.map((w) => w.text).join(' ');
    return {
      kind: doc?.builtin ? 'builtin' : 'command',
      label: shorten(text),
      explanation: prefix + this.s(`\`${name}\` を実行: `, `runs \`${name}\`: `) + explanation,
      span, children, summary: `${name}: ${explanation}`,
    };
  }

  // ---------------------------------------------------------------- tests

  private arithTestExplanation(): string {
    return this.s('算術評価 `(( ))`: 式を計算し、結果が 0 以外なら成功(0)を返す', 'Arithmetic evaluation `(( ))`: succeeds if the result is non-zero');
  }

  private test(n: SyntaxNode): Token {
    const before = this.examples.length;
    if (this.line === null || n.startPosition.row === this.line) this.testExample(n);
    const open = n.child(0)?.type;
    const expl = open === '[['
      ? this.s('拡張条件式 `[[ ]]`: 条件を評価し、真なら成功(0)を返す（bash 専用。変数をクォートしなくても安全で、`&&` `||` `=~` が使える）',
        'Extended test `[[ ]]`: evaluates a condition (bash-only; safe without quoting, supports `&&`, `||`, `=~`)')
      : open === '(('
        ? this.arithTestExplanation()
        : this.s('条件式 `[ ]`: 条件を評価し、真なら成功(0)を返す（`test` コマンドと同じ。`[` の後と `]` の前には空白が必要）',
          'Test `[ ]`: evaluates a condition (same as `test`; spaces after `[` and before `]` are required)');
    const t = this.tok(n, 'test', expl, this.subs(n.namedChildren));
    t.summary = this.s(`条件判定 ${shorten(n.text, 40)}`, `test ${shorten(n.text, 40)}`);
    // Includes examples from inside the test, such as the regex of `=~`.
    this.tagExamples(before, n);
    return t;
  }

  /** The right side of `[[ x =~ re ]]` (an ERE) is broken down; other `regex` nodes are glob-like patterns. */
  private regexNode(n: SyntaxNode): Token {
    const op = n.parent?.type === 'binary_expression' ? n.parent.childForFieldName('operator')?.text ?? n.parent.children.find((c) => c.type === '=~')?.text : undefined;
    // Unquoted backslashes reach the regex unchanged (`\.` stays an escaped dot), so only quotes and expansions are excluded.
    if (op === '=~' && !/\$[\w{(@*#?!-]|[`"']/.test(n.text) && n.startPosition.row === n.endPosition.row) {
      const tokens = explainRegex(n.text, 'ere', this.lang).map((t) => this.fromEmbedded(t, n, { text: n.text, base: 0 }));
      const js = toJsRegex(n.text, 'ere');
      if (js) this.regexExample(js, 'values');
      return this.tok(n, 'pattern', this.s('正規表現（拡張正規表現 ERE）', 'Regular expression (extended, ERE)'), tokens);
    }
    return this.tok(n, 'pattern', this.s('正規表現（またはパターン）', 'Regular expression (or pattern)'));
  }

  private inArithmetic(n: SyntaxNode): boolean {
    for (let p = n.parent; p; p = p.parent) {
      if (p.type === 'arithmetic_expansion' || p.type === 'c_style_for_statement') return true;
      if (p.type === 'test_command' || p.type === 'compound_statement') return p.child(0)?.type === '((';
    }
    return false;
  }

  private unary(n: SyntaxNode): Token {
    const opNode = n.childForFieldName('operator') ?? n.child(0);
    const op = opNode?.text ?? '';
    const operand = n.namedChildren.find((c) => !same(c, opNode));
    if (op === '!' && !this.inArithmetic(n)) {
      return this.tok(n, 'test', this.s(`否定: \`${operand?.text ?? ''}\` が偽なら真`, `Negation: true if \`${operand?.text ?? ''}\` is false`), this.sub(operand));
    }
    const d = unaryTestOps[op];
    if (d && !this.inArithmetic(n)) {
      return this.tok(n, 'test', this.s(`条件: \`${operand?.text ?? ''}\` が${this.t(d)}`, `Condition: \`${operand?.text ?? ''}\` ${this.t(d)}`), this.subs([operand].filter((x) => x && !isPlainWord(x))));
    }
    return this.tok(n, 'operator', this.s(`算術の単項演算 \`${op}\``, `Arithmetic unary operator \`${op}\``), this.subs(n.namedChildren));
  }

  private binary(n: SyntaxNode): Token {
    const left = n.childForFieldName('left');
    const right = n.childForFieldName('right') ?? n.namedChildren[n.namedChildren.length - 1];
    const opNode = n.childForFieldName('operator') ?? n.children.find((c) => !same(c, left) && !same(c, right));
    const op = opNode?.text ?? '';
    const operands = this.subs([left, right].filter((x) => x && !isPlainWord(x)));
    if (!this.inArithmetic(n) && binaryTestOps[op]) {
      if (op === '&&' || op === '||' || op === '-a' || op === '-o') {
        return this.tok(n, 'test', this.t(binaryTestOps[op]), this.subs([left, right]));
      }
      return this.tok(n, 'test', this.s(
        `条件: \`${left?.text}\` と \`${right?.text}\` を比較 — ${this.t(binaryTestOps[op])}`,
        `Condition: \`${left?.text}\` vs \`${right?.text}\` — ${this.t(binaryTestOps[op])}`,
      ), operands);
    }
    const assignOps = ['=', '+=', '-=', '*=', '/=', '%='];
    return this.tok(n, 'operator', assignOps.includes(op)
      ? this.s(`算術代入: \`${left?.text}\` ${op} \`${right?.text}\``, `Arithmetic assignment: \`${left?.text}\` ${op} \`${right?.text}\``)
      : this.s(`算術演算: \`${left?.text}\` ${op} \`${right?.text}\``, `Arithmetic: \`${left?.text}\` ${op} \`${right?.text}\``), operands);
  }

  // ---------------------------------------------------------------- words & expansions

  private word(n: SyntaxNode): Token {
    const text = n.text;
    if (text.startsWith('~')) return this.tok(n, 'expansion', this.s('チルダ展開: `~` はホームディレクトリに置き換わる', 'Tilde expansion: `~` becomes the home directory'));
    if (hasGlob(text)) return this.tok(n, 'pattern', this.s(`グロブ \`${text}\`: 一致するファイル名の一覧に展開される（\`*\` は任意の文字列, \`?\` は任意の1文字）`, `Glob \`${text}\`: expands to matching file names (\`*\` any string, \`?\` any char)`) + this.globNotes(text));
    return this.tok(n, 'argument', this.s(`文字列 \`${text}\``, `Word \`${text}\``));
  }

  private string(n: SyntaxNode): Token {
    // `$"…"`: tree-sitter-bash reads it as `$` and a string.
    const dollar = n.previousSibling;
    if (dollar?.type === '$' && dollar.endIndex === n.startIndex) {
      const t = this.tok(n, 'string', this.s('`$"…"` 文字列: ロケールに応じて翻訳される文字列（翻訳がなければそのまま。中の変数は展開される）', '`$"…"` string: translated according to the locale (as it is when there is no translation; variables inside expand)'), this.subs(n.namedChildren.filter((c) => c.type !== 'string_content')), shorten('$' + n.text));
      t.span = { start: spanOf(dollar).start, end: t.span.end };
      return t;
    }
    return this.tok(n, 'string', this.s(
      'ダブルクォート文字列: 中の `$変数` や `$(…)` は展開されるが、単語分割やグロブ展開はされない（1つの引数のまま）',
      'Double-quoted string: `$vars` and `$(…)` expand, but no word splitting or globbing (stays one argument)',
    ), this.subs(n.namedChildren.filter((c) => c.type !== 'string_content')));
  }

  private varDesc(name: string): string | undefined {
    if (specialVariables[name]) return this.t(specialVariables[name]);
    if (/^\d+$/.test(name)) return this.s(`位置パラメータ: ${name} 番目の引数`, `Positional parameter: argument #${name}`);
    if (wellKnownVariables[name]) return this.t(wellKnownVariables[name]);
    // Set by a CI system, unless the script sets it itself (`BRANCH_NAME=…`).
    const ci = Object.hasOwn(ciVariables, name) ? ciVariables[name] : undefined;
    if (ci && !new RegExp(`(^|[\\s;&|(])(export\\s+)?${name}=|\\bread\\b[^\\n;|&]*\\s${name}\\b`, 'm').test(this.source)) {
      return this.s(`${ci.ci} が設定する環境変数: ${this.t(ci.meaning)}`, `set by ${ci.ci}: ${this.t(ci.meaning)}`);
    }
    return undefined;
  }

  private variable(name: string, n: SyntaxNode): Token {
    const d = this.varDesc(name);
    return this.tok(n, 'variable', d ? `\`$${name}\`: ${d}` : this.s(`変数 \`${name}\``, `Variable \`${name}\``));
  }

  private simpleExpansion(n: SyntaxNode): Token {
    const name = n.text.slice(1);
    const d = this.varDesc(name);
    const t = this.tok(n, 'variable', d
      ? `${d}`
      : this.s(`変数 \`${name}\` の値に置き換わる（クォートしないと空白で分割され、グロブ展開もされる）`, `Expands to the value of \`${name}\` (unquoted, it is word-split and globbed)`));
    if (this.noSplit(n)) {
      t.explanation = d ?? this.s(`変数 \`${name}\` の値に置き換わる`, `Expands to the value of \`${name}\``);
    }
    return t;
  }

  /** Contexts where an unquoted expansion is not word-split (quotes, `[[ ]]`, assignments, heredocs, case). */
  private noSplit(n: SyntaxNode): boolean {
    const p = n.parent;
    if (!p) return false;
    if (['string', 'heredoc_body', 'variable_assignment', 'case_statement'].includes(p.type)) return true;
    for (let a: SyntaxNode | null = p; a; a = a.parent) {
      if (a.type === 'test_command') return a.child(0)?.type === '[[' || a.child(0)?.type === '((';
      if (a.type === 'compound_statement' && a.child(0)?.type === '((') return true;
      if (a.type === 'arithmetic_expansion') return true;
      if (a.type === 'command' || a.type === 'string') return false;
    }
    return false;
  }

  private subscript(n: SyntaxNode): Token {
    const name = n.childForFieldName('name')?.text ?? '';
    const idx = n.childForFieldName('index')?.text ?? '';
    if (idx === '@' || idx === '*') return this.tok(n, 'variable', this.s(`配列 \`${name}\` の全要素`, `All elements of array \`${name}\``));
    return this.tok(n, 'variable', this.s(`配列 \`${name}\` の要素 \`[${idx}]\``, `Element \`[${idx}]\` of array \`${name}\``));
  }

  /** `${…}`: the overall meaning plus a worked example, broken down into its parts. */
  private expansion(n: SyntaxNode): Token {
    const summary = this.expansionSummary(n);
    // Inside a string, tree-sitter-bash starts a `${…}` after a space at the space.
    const text = n.text.trimStart();
    const lead = n.text.length - text.length;
    if (lead && n.startPosition.row === n.endPosition.row) {
      summary.label = shorten(text);
      summary.span = { ...summary.span, start: { ...summary.span.start, character: summary.span.start.character + lead } };
    }
    const parsed = n.startPosition.row === n.endPosition.row ? parseExpansion(text) : undefined;
    if (!parsed) return summary;
    const tf = parsed.op === '@' ? transformMeaning[parsed.parts.find((p) => p.role === 'transform')?.text ?? ''] : undefined;
    if (tf) summary.explanation = this.s(`パラメータ展開: \`${parsed.name}\` の値を${tf[0]}`, `Parameter expansion: take the value of \`${parsed.name}\` and ${tf[1]}`);
    if (parsed.op === ':') summary.explanation = this.s('パラメータ展開: ', 'Parameter expansion: ') + this.substringSummary(parsed);
    const cases = exampleFor(parsed, this.lang);
    if (cases && (this.line === null || n.startPosition.row === this.line)) {
      this.examples.push({ kind: 'expansion',
        title: this.s(`\`${text}\` の例`, `Example for \`${text}\``),
        // The title already names the expansion.
        target: '',
        anchor: summary.span,
        sections: cases.map((c) => ({ label: c.when, lines: c.result ? [c.result] : [], empty: this.s('（空文字）', '(empty string)') })),
      });
    }
    const row = n.startPosition.row;
    const col = n.startPosition.column + lead;
    const mainOp = parsed.parts.find((p) => p.role === 'op');
    summary.children = parsed.parts.flatMap((part) => {
      const expl = this.expansionPart(parsed, part, part === mainOp);
      if (!expl || !part.text) return [];
      const span: Span = { start: { line: row, character: col + part.start }, end: { line: row, character: col + part.end } };
      const nested = this.nestedIn(n, col + part.start, col + part.end);
      return [{ kind: expl[0], label: part.text, explanation: expl[1], span, children: nested }];
    });
    return summary;
  }

  private substringSummary(p: ParsedExpansion): string {
    const off = p.parts.find((x) => x.role === 'offset')?.text ?? '';
    const len = p.parts.find((x) => x.role === 'length')?.text;
    const name = p.name;
    if (slicesElements(p)) {
      const what = p.name === '@' || p.name === '*' ? this.s('位置パラメータ', 'the positional parameters') : this.s(`配列 \`${name}\` の要素`, `the elements of array \`${name}\``);
      return this.s(`${what}を、${p.name === '@' || p.name === '*' ? `\`$${off}\`` : `インデックス \`${off}\``} から${len === undefined ? '最後まで' : ` \`${len}\` 個`}取り出す`,
        `take ${len === undefined ? '' : `\`${len}\` of `}${what} from ${p.name === '@' || p.name === '*' ? `\`$${off}\`` : `index \`${off}\``}${len === undefined ? ' on' : ''}`);
    }
    if (!/^-?\d+$/.test(off) || (len !== undefined && !/^-?\d+$/.test(len))) {
      return this.s(`\`${name}\` の部分文字列を取り出す（開始位置 \`${off}\`${len !== undefined ? `、長さ \`${len}\`` : ''}）`,
        `take a substring of \`${name}\` (offset \`${off}\`${len !== undefined ? `, length \`${len}\`` : ''})`);
    }
    const o = Number(off);
    const fromJa = o < 0 ? `末尾から ${-o} 文字目` : ` ${o + 1} 文字目`;
    const fromEn = o < 0 ? `${-o} characters from the end` : `the ${ordinal(o + 1)} character`;
    if (len === undefined && o < 0) return this.s(`\`${name}\` の末尾 ${-o} 文字を取り出す`, `take the last ${-o} characters of \`${name}\``);
    if (len === undefined) return this.s(`\`${name}\` の${fromJa}から最後までを取り出す`, `take \`${name}\` from ${fromEn} to the end`);
    const l = Number(len);
    if (l < 0) return this.s(`\`${name}\` の${fromJa}から、末尾の ${-l} 文字を除いた位置までを取り出す`, `take \`${name}\` from ${fromEn} up to ${-l} characters before the end`);
    return this.s(`\`${name}\` の${fromJa}から ${l} 文字を取り出す`, `take ${l} characters of \`${name}\` starting at ${fromEn}`);
  }

  /** Expansions, substitutions and strings inside a column range of a single-line node. */
  private nestedIn(n: SyntaxNode, from: number, to: number): Token[] {
    const found: SyntaxNode[] = [];
    const visit = (x: SyntaxNode) => {
      for (const c of x.namedChildren) {
        const inside = c.startPosition.column >= from && c.endPosition.column <= to;
        if (inside && NESTED.has(c.type)) found.push(c);
        else visit(c);
      }
    };
    visit(n);
    return found.map((c) => this.full(c));
  }

  private expansionPart(p: ParsedExpansion, part: ExpansionPart, isMainOp: boolean): [Kind, string] | undefined {
    const t = part.text;
    const s = this.s.bind(this);
    switch (part.role) {
      case 'prefix':
        if (t === '#') return ['operator', s('`#`: 値の長さ（文字数、配列なら要素数）を返す', '`#`: gives the length (characters, or elements for an array)')];
        if (p.op === '*' || p.op === '@') return ['operator', s('`!`: この名前で始まる変数名の一覧を返す', '`!`: lists variable names starting with this prefix')];
        if (p.subscript === '@' || p.subscript === '*') return ['operator', s('`!`: 配列の値ではなくインデックス（キー）を返す', '`!`: gives the indices (keys) instead of the values')];
        return ['operator', s('`!`: 間接参照。変数の値を別の変数名として使う', '`!`: indirection; use the value as another variable\'s name')];
      case 'name': {
        const d = this.varDesc(t);
        if (p.prefix === '!' && (p.op === '*' || p.op === '@')) return ['variable', s(`変数名の接頭辞 \`${t}\``, `Variable name prefix \`${t}\``)];
        if (p.subscript !== undefined) return ['variable', s(`配列 \`${t}\``, `Array \`${t}\``)];
        return ['variable', d ? `\`$${t}\`: ${d}` : s(`変数 \`${t}\``, `Variable \`${t}\``)];
      }
      case 'subscript': {
        const idx = p.subscript ?? '';
        if ((idx === '@' || idx === '*') && p.prefix) return ['variable', s(`\`[${idx}]\`: 配列のすべての要素を対象にする`, `\`[${idx}]\`: applies to every element of the array`)];
        if (idx === '@') return ['variable', s('`[@]`: すべての要素（`"${a[@]}"` とクォートすると各要素が別々の単語になる）', '`[@]`: every element (quoted, `"${a[@]}"` keeps each element a separate word)')];
        if (idx === '*') return ['variable', s('`[*]`: すべての要素（`"${a[*]}"` とクォートすると1つの文字列に連結される）', '`[*]`: every element (quoted, `"${a[*]}"` joins them into one string)')];
        if (/^-?\d+$/.test(idx)) {
          const i = Number(idx);
          return ['variable', i < 0
            ? s(`インデックス ${i}: 末尾から ${-i} 番目の要素`, `Index ${i}: the ${ordinal(-i)} element from the end`)
            : s(`インデックス ${i}: ${i + 1} 番目の要素（0 始まり）`, `Index ${i}: the ${ordinal(i + 1)} element (0-based)`)];
        }
        return ['variable', s(`インデックス（連想配列ならキー） \`${idx}\``, `Index (or key, for associative arrays) \`${idx}\``)];
      }
      case 'op':
        if (!isMainOp) {
          return ['operator', t === ':'
            ? s('`:` 開始位置と長さの区切り', '`:` separates the offset from the length')
            : p.parts.find((x) => x.role === 'replacement')?.text
              ? s('`/` パターンと置換後の文字列の区切り', '`/` separates the pattern from the replacement')
              : s('`/` の後ろ（置換後の文字列）が空なので、一致した部分は削除される', 'Nothing follows this `/`, so the replacement is empty and matches are deleted')];
        }
        if (t === ':' && slicesElements(p)) return ['operator', s('`:`: 要素の一部を取り出す（`:開始位置:個数`）', '`:`: Take some of the elements (`:offset:count`)')];
        return ['operator', `\`${t}\`: ` + (opMeaning[t] ? opMeaning[t][this.lang === 'ja' ? 0 : 1] : t)];
      case 'word': {
        const op = p.op ?? '';
        if (op === ':-' || op === '-') return ['argument', s(`既定値 \`${t}\`: \`${p.name}\` の代わりに使う値`, `Default \`${t}\`: used instead of \`${p.name}\``)];
        if (op === ':=' || op === '=') return ['argument', s(`既定値 \`${t}\`: \`${p.name}\` に代入されてから使われる`, `Default \`${t}\`: assigned to \`${p.name}\`, then used`)];
        if (op === ':+' || op === '+') return ['argument', s(`代替値 \`${t}\`: \`${p.name}\` が設定されているときに代わりに使う値`, `Alternate value \`${t}\`: used when \`${p.name}\` is set`)];
        return ['string', s(`エラーメッセージ「${t}」`, `Error message "${t}"`)];
      }
      case 'pattern': {
        const glob = globParts(t);
        const casePat = /^[\^,]/.test(p.op ?? '');
        const what = casePat ? s('変換する文字のパターン', 'Pattern of characters to convert') : s('パターン', 'Pattern');
        if (!glob) return ['pattern', s(`${what} \`${t}\`（変数などを含むため、内容は実行時に決まる）`, `${what} \`${t}\` (contains expansions, so it is decided at run time)`)];
        return ['pattern', `${what} \`${t}\`: ${describeGlob(glob, this.lang)}`];
      }
      case 'replacement':
        return ['string', t
          ? s(`置換後の文字列 \`${t}\``, `Replacement \`${t}\``)
          : s('置換後の文字列: 空（一致した部分を削除する）', 'Replacement: empty (the match is deleted)')];
      case 'offset': {
        const v = t.trim();
        if (slicesElements(p)) {
          return ['number', p.name === '@' || p.name === '*'
            ? s(`開始位置 ${v}: \`$${v}\` から（\`0\` なら \`$0\`、負の値は最後の引数から数える）`, `Offset ${v}: from \`$${v}\` (\`0\` is \`$0\`; a negative value counts from the last argument)`)
            : s(`開始位置 ${v}: インデックス ${v} の要素から（負の値は末尾から数える）`, `Offset ${v}: from the element at index ${v} (a negative value counts from the end)`)];
        }
        if (!/^-?\d+$/.test(v)) return ['number', s(`開始位置 \`${v}\`（算術式として評価される）`, `Offset \`${v}\` (evaluated as arithmetic)`)];
        const o = Number(v);
        if (o < 0) {
          return ['number', s(
            `開始位置 ${o}: 末尾から ${-o} 文字目から（負の値は \`:-\` と区別するため、前に空白か括弧が必要）`,
            `Offset ${o}: start ${-o} characters from the end (a space or parentheses is needed before a negative value, to tell it from \`:-\`)`)];
        }
        return ['number', s(`開始位置 ${o}: ${o + 1} 文字目から（0 始まり）`, `Offset ${o}: start at the ${ordinal(o + 1)} character (0-based)`)];
      }
      case 'length': {
        const v = t.trim();
        if (slicesElements(p)) return ['number', s(`長さ ${v}: ${v} 個の要素（負の値はエラー）`, `Length ${v}: ${v} elements (a negative value is an error)`)];
        if (!/^-?\d+$/.test(v)) return ['number', s(`長さ \`${v}\`（算術式として評価される）`, `Length \`${v}\` (evaluated as arithmetic)`)];
        const l = Number(v);
        return ['number', l < 0
          ? s(`長さ ${l}: 末尾の ${-l} 文字を除いた位置まで`, `Length ${l}: up to ${-l} characters before the end`)
          : s(`長さ ${l}: ${l} 文字分`, `Length ${l}: ${l} characters`)];
      }
      case 'transform': {
        const m = transformMeaning[t];
        return ['operator', m ? `\`${t}\`: ${m[this.lang === 'ja' ? 0 : 1]}` : s(`変換 \`${t}\``, `Transformation \`${t}\``)];
      }
    }
    return undefined;
  }

  private expansionSummary(n: SyntaxNode): Token {
    const kids = n.children;
    const inner = n.text.trimStart().slice(2, -1);
    const target = kids.find((c) => ['variable_name', 'subscript', 'special_variable_name'].includes(c.type));
    const targetText = target?.text ?? inner;
    const isArrayAll = target?.type === 'subscript' && /\[[@*]\]$/.test(targetText);
    const prefixOp = kids[1] && !kids[1].isNamed ? kids[1].type : '';

    if (prefixOp === '#' && target) {
      return this.tok(n, 'expansion', isArrayAll
        ? this.s(`配列 \`${targetText.replace(/\[.*/, '')}\` の要素数`, `Number of elements in array \`${targetText.replace(/\[.*/, '')}\``)
        : this.s(`変数 \`${targetText}\` の文字数（長さ）`, `Length of \`${targetText}\` in characters`));
    }
    if (prefixOp === '!' && target) {
      return this.tok(n, 'expansion', isArrayAll
        ? this.s(`配列 \`${targetText.replace(/\[.*/, '')}\` のインデックス（キー）一覧`, `Indices (keys) of array \`${targetText.replace(/\[.*/, '')}\``)
        : this.s(`間接参照: 変数 \`${targetText}\` の値を変数名とみなし、その変数の値を取り出す`, `Indirection: use the value of \`${targetText}\` as a variable name`));
    }

    const opIdx = kids.findIndex((c, i) => i > 0 && n.fieldNameForChild(i) === 'operator');
    const base = target?.type === 'subscript' ? this.t(isArrayAll
      ? { ja: `配列 \`${targetText.replace(/\[.*/, '')}\` の全要素`, en: `all elements of array \`${targetText.replace(/\[.*/, '')}\`` }
      : { ja: `配列要素 \`${targetText}\``, en: `array element \`${targetText}\`` }) : undefined;
    if (opIdx > 0) {
      const op = kids[opIdx].type;
      const close = kids[kids.length - 1];
      const arg = n.text.slice(kids[opIdx].endIndex - n.startIndex, close.type === '}' ? close.startIndex - n.startIndex : undefined);
      const make = expansionOps[op];
      if (arg === '' && (op === ':-' || op === '-')) {
        return this.tok(n, 'expansion', this.s(
          `パラメータ展開: \`${targetText}\` が未設定なら空文字として扱う（\`set -u\` でもエラーにしないための定番）`,
          `Parameter expansion: empty string if \`${targetText}\` is unset (avoids errors under \`set -u\`)`,
        ));
      }
      if (make) {
        const argNodes = kids.slice(opIdx + 1).filter((c) => c.isNamed && !isPlainWord(c) && c.type !== 'regex');
        // Positional parameters read better as `$2` than as a bare `2`.
        const shownName = /^[1-9]\d*$/.test(targetText) ? `$${targetText}` : targetText;
        return this.tok(n, 'expansion', this.s('パラメータ展開: ', 'Parameter expansion: ') + this.t(make(shownName, arg)), this.subs(argNodes));
      }
    }
    // `${var:offset:length}` has no operator field in some grammar versions.
    const sub = inner.match(/^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-]):(-?\d+|\s*-\d+|[^-=+?][^}]*)$/);
    if (sub) return this.tok(n, 'expansion', this.s('パラメータ展開: ', 'Parameter expansion: ') + this.t(expansionOps[':'](sub[1], sub[2])));
    const d = base ?? this.varDesc(targetText);
    return this.tok(n, 'variable', d
      ? this.s(`\`\${${targetText}}\`: ${d}`, `\`\${${targetText}}\`: ${d}`)
      : this.s(`変数 \`${targetText}\` の値に置き換わる（\`{}\` は変数名の範囲を明示する）`, `Value of \`${targetText}\` (braces delimit the name)`));
  }

  private commandSubstitution(n: SyntaxNode): Token {
    const backtick = n.text.startsWith('`');
    const t = this.tok(n, 'substitution', this.s(
      `コマンド置換 ${backtick ? '`` `…` ``（旧式。`$(…)` 推奨）' : '`$(…)`'}: 中のコマンドを実行し、その標準出力（末尾の改行は除く）に置き換える`,
      `Command substitution ${backtick ? '`` `…` `` (legacy; prefer `$(…)`)' : '`$(…)`'}: runs the command and is replaced by its stdout (trailing newlines removed)`,
    ), this.subs(n.namedChildren));
    return t;
  }

  private processSubstitution(n: SyntaxNode): Token {
    const out = n.text.startsWith('>(');
    return this.tok(n, 'substitution', out
      ? this.s('プロセス置換 `>(…)`: 書き込むと中のコマンドの標準入力に渡るファイル名（/dev/fd/N）に置き換わる', 'Process substitution `>(…)`: a file name whose writes go to the command\'s stdin')
      : this.s('プロセス置換 `<(…)`: 中のコマンドの出力を、ファイルのように読めるファイル名（/dev/fd/N）に置き換える', 'Process substitution `<(…)`: a file name from which the command\'s output can be read'),
    this.subs(n.namedChildren));
  }
}

/**
 * The text a command receives for a word, and where each of its characters sits in the word's
 * source: either a fixed `base` offset, or per-character `offsets` when quotes are interleaved
 * (`--pretty=format:'%h %s'`).
 */
interface Literal {
  text: string;
  base?: number;
  offsets?: number[];
}

/** The literal text inside a raw string, plain double-quoted string, plain word, or a concatenation of those. */
function literalContent(a: SyntaxNode): Literal | undefined {
  if (a.type === 'raw_string') return { text: a.text.slice(1, -1), base: 1 };
  if (a.type === 'string' && a.namedChildren.every((c) => c.type === 'string_content') && !/[\\$`]/.test(a.text)) {
    return { text: a.text.slice(1, -1), base: 1 };
  }
  if (isPlainWord(a) && !/[\\'"$`]/.test(a.text)) return { text: a.text, base: 0 };
  if (a.type === 'concatenation' && a.startPosition.row === a.endPosition.row) {
    let text = '';
    const offsets: number[] = [];
    for (const c of a.namedChildren) {
      const lit = literalContent(c);
      if (!lit || lit.offsets) return undefined;
      const at = c.startIndex - a.startIndex + (lit.base ?? 0);
      for (let k = 0; k < lit.text.length; k++) offsets.push(at + k);
      text += lit.text;
    }
    return { text, offsets };
  }
  return undefined;
}

/** Position in the node's source of character `offset` of a literal (an end offset maps past the previous character). */
function sourceIndex(lit: Literal, offset: number, isEnd: boolean): number {
  if (!lit.offsets) return (lit.base ?? 0) + offset;
  if (isEnd) return offset === 0 ? lit.offsets[0] ?? 0 : lit.offsets[offset - 1] + 1;
  return lit.offsets[offset] ?? (lit.offsets[lit.offsets.length - 1] ?? 0) + 1;
}

/** Tabs as ⇥ and other control characters as their Unicode pictures (CR → ␍), so examples show them. */
function visible(line: string): string {
  return line.replace(/\t/g, '⇥').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) => (c === '\x7f' ? '␡' : String.fromCharCode(0x2400 + c.charCodeAt(0))));
}

const SHOPT_NAMES = ['globstar', 'dotglob', 'nocaseglob', 'nocasematch', 'nullglob', 'failglob', 'extglob', 'lastpipe', 'expand_aliases'] as const;
export type ShoptName = typeof SHOPT_NAMES[number];
/** `unknown`: not set before the line, so the default (off) unless a file read with `source` sets it. */
export type ShoptState = 'on' | 'off' | 'unknown' | 'unsupported';
export type ShoptStates = Record<ShoptName, ShoptState>;

/**
 * The shell options in effect on `line`: bash's `shopt -s` / `-u` before it (the last one wins). zsh
 * always has globstar, ksh93 has it after `set -G` / `set -o globstar`; the other options, and every
 * option in the other shells, are `unsupported`.
 */
export function shoptStates(source: string, line: number, shell?: Shell): ShoptStates {
  const bash = !shell || shell === 'bash';
  const states = Object.fromEntries(SHOPT_NAMES.map((n) => [n, bash ? 'unknown' : 'unsupported'])) as ShoptStates;
  if (shell === 'zsh') states.globstar = 'on';
  if (shell === 'ksh') states.globstar = 'unknown';
  for (const l of source.split('\n').slice(0, line)) {
    const code = l.replace(/(^|\s)#.*/, '');
    if (bash) {
      for (const m of code.matchAll(/\bshopt((?:\s+-[a-z]+)+)((?:\s+\w+)+)/g)) {
        const flags = m[1].replace(/[\s-]/g, '');
        if (!/[su]/.test(flags)) continue;
        for (const n of m[2].trim().split(/\s+/)) if (n in states) states[n as ShoptName] = flags.includes('s') ? 'on' : 'off';
      }
    }
    if (shell === 'ksh' && /\bset\s+(-\w*G|-o\s+globstar)\b/.test(code)) states.globstar = 'on';
    if (shell === 'ksh' && /\bset\s+(\+\w*G|\+o\s+globstar)\b/.test(code)) states.globstar = 'off';
  }
  return states;
}

/** Whether an option such as `grep -e PATTERN` supplies the first positional argument. */
function fillsPositional(doc: CommandDoc | undefined, args: SyntaxNode[]): boolean {
  const opts = doc?.options;
  if (!opts) return false;
  for (const a of args) {
    const t = a.text;
    if (t === '--') break;
    if (opts[t.split('=')[0]]?.fillsPositional) return true;
    if (/^-[A-Za-z]+/.test(t) && !t.startsWith('--')) {
      for (const ch of t.slice(1)) {
        const o = opts['-' + ch];
        if (o?.fillsPositional) return true;
        // In `-pie`, `e` is the value of `-i`, not the `-e` option.
        if (o?.arg || o?.attachedOnly) break;
      }
    }
  }
  return false;
}

/** The pattern of a sed script made of a single `s` command, to highlight what it matches. */
function sedPattern(script: string, flavor: 'ere' | 'bre'): JsRegex | undefined {
  const m = /^\s*s(.)/.exec(script);
  if (!m || /[\s\\\n]/.test(m[1])) return undefined;
  const delim = m[1];
  let i = m[0].length;
  let pat = '';
  for (; i < script.length && script[i] !== delim; i++) {
    if (script[i] === '\\' && script[i + 1] === delim) { pat += delim; i++; continue; }
    if (script[i] === '\\') { pat += script[i] + (script[i + 1] ?? ''); i++; continue; }
    pat += script[i];
  }
  const flags = /^[^;\n]*$/.test(script) ? (script.split(delim).pop() ?? '') : '';
  return toJsRegex(pat, flavor, { ignoreCase: /[Ii]/.test(flags), sedEscapes: true });
}

export function lookupCommand(name: string): CommandDoc | undefined {
  if (Object.prototype.hasOwnProperty.call(builtins, name)) return builtins[name];
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  if (Object.prototype.hasOwnProperty.call(commands, base)) return commands[base];
  if (base === 'egrep' || base === 'fgrep') return commands.grep;
  if (base === 'gawk' || base === 'mawk' || base === 'nawk') return commands.awk;
  if (base === 'python') return commands.python3;
  if (base === 'zsh' || base === 'dash' || base === 'ksh') return commands.sh;
  return undefined;
}

export function summaryOf(t: Token): string {
  return t.summary ?? t.explanation;
}

function sortTokens(ts: Token[]): Token[] {
  return ts.sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.character - b.span.start.character);
}

/** Whether an ancestor of `n` satisfies `test`. */
function ancestorOf(n: SyntaxNode, test: (a: SyntaxNode) => boolean): boolean {
  for (let a = n.parent; a; a = a.parent) if (test(a)) return true;
  return false;
}

/**
 * The operator and destination of a file redirection. tree-sitter-bash reads `>&-` and `<&-` (close
 * a descriptor) as one operator: they are `>&` and `<&` to `-`.
 */
function redirectParts(n: SyntaxNode): { op: string; dest: string } {
  const op = n.children.find((c) => !c.isNamed)?.type ?? '>';
  if (op === '>&-' || op === '<&-') return { op: op.slice(0, 2), dest: '-' };
  return { op, dest: fieldChildren(n, 'destination').map((d) => d.text).join(' ') };
}
