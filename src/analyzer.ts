import { Lang, Text } from './i18n';
import { findIdioms, Redirect, simulateRedirects } from './idioms';
import type { SyntaxNode, Tree } from './parser';
import { builtins } from './dict/builtins';
import { commands } from './dict/commands';
import { CommandDoc, OptDoc } from './dict/types';
import { explainRegex, Flavor, flavorName } from './embedded/regex';
import { explainAwk } from './embedded/awk';
import { explainDate, explainPrintf, printfNote, sampleDate } from './embedded/format';
import { describeFind, describeFindPattern, FindNode, isExpressionStart, parseFind, unquote } from './embedded/find';
import { explainGetopts } from './embedded/getopts';
import { explainGitDate, explainGitFormat } from './embedded/gitformat';
import { explainJq } from './embedded/jq';
import { explainPerl, perlLoopNote } from './embedded/perl';
import { explainMode, explainUmask } from './embedded/mode';
import { explainCutList, explainSortKey, explainTrSet, trSummary } from './embedded/textutils';
import { explainSed } from './embedded/sed';
import { EmbeddedLang, EmbeddedToken } from './embedded/types';
import { describeGlob, ExpansionPart, exampleFor, globParts, opMeaning, ParsedExpansion, parseExpansion, transformMeaning } from './expansion';
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
}

export interface ContextEntry { label: string; line: number }

export interface LineExplanation {
  line: number;
  summary: string;
  items: Token[];
  /** Enclosing constructs, outermost first (e.g. "for loop (line 3)"). */
  context: ContextEntry[];
  notes: string[];
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
const hasGlob = (s: string) => /(^|[^\\])[*?]|\[[^\]]+\]/.test(s);

export class Analyzer {
  private line: number | null = null;
  private context: ContextEntry[] = [];
  private functions = new Map<string, number>();
  /** Notes produced while explaining (e.g. the effect of several redirections). */
  private extraNotes: string[] = [];
  /** The command whose arguments are being explained (for option-dependent embedded languages). */
  private argCtx: { cmd: string; args: SyntaxNode[] } | undefined;

  constructor(private lang: Lang) {}

  explainLine(tree: Tree, line: number): LineExplanation {
    const root = tree.rootNode;
    this.functions.clear();
    for (const f of root.descendantsOfType('function_definition')) {
      const name = f.childForFieldName('name')?.text;
      if (name && !this.functions.has(name)) this.functions.set(name, f.startPosition.row);
    }
    this.line = line;
    this.context = [];
    this.extraNotes = [];
    const items = this.flatten(root);
    const statements = root
      .descendantsOfType(['command', 'redirected_statement', 'list', 'pipeline', 'variable_assignment', 'test_command', 'while_statement'], { row: line, column: 0 }, { row: line + 1, column: 0 })
      .filter((n) => intersects(n, line))
      .map((n) => (n.type === 'while_statement' ? n.text.split('\n')[0] : n.text));
    const result: LineExplanation = {
      line,
      items,
      context: this.context,
      notes: [...this.notes(root, line, items), ...new Set(this.extraNotes), ...findIdioms(statements, this.lang)],
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
        return this.s('{ } グループ', '{ } group');
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

  private kws(n: SyntaxNode): Token[] {
    return this.anonOnLine(n.children.filter((c) => !c.isNamed));
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
      const delim = h.namedChildren.find((c) => c.type === 'heredoc_start')?.text ?? '';
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
      case 'extglob_pattern': return this.tok(n, 'pattern', this.s('パターン', 'Pattern'));
      case 'variable_name': return this.variable(n.text, n);
      case 'special_variable_name': return this.variable(n.text, n);
      case 'test_operator': return this.tok(n, 'operator', this.t(unaryTestOps[n.text] ?? binaryTestOps[n.text] ?? { ja: '演算子', en: 'Operator' }));
      case 'subshell': return this.block(n, 'block', this.s('サブシェル: `( )` 内を別プロセスで実行する。中での変数変更や cd は外に影響しない', 'Subshell: runs `( )` in a child process; variable changes and cd do not leak out'));
      case 'compound_statement': return this.block(n, 'block', this.s('コマンドグループ: `{ }` 内のコマンドを現在のシェルでまとめて実行する', 'Command group: runs the commands in `{ }` in the current shell'));
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
    if (/^#\s*shellcheck\s/.test(n.text)) {
      return this.tok(n, 'comment', this.s('ShellCheck への指示コメント（警告の抑制など）', 'ShellCheck directive (e.g. disable a warning)'));
    }
    return this.tok(n, 'comment', this.s('コメント: `#` から行末までは実行されない', 'Comment: everything after `#` is ignored'));
  }

  private block(n: SyntaxNode, kind: Kind, explanation: string): Token {
    return this.tok(n, kind, explanation, this.ordered(n));
  }

  private functionDef(n: SyntaxNode): Token {
    const nameNode = n.childForFieldName('name');
    const name = nameNode?.text ?? '?';
    const nameTok = nameNode && (this.line === null || intersects(nameNode, this.line))
      ? [this.tok(nameNode, 'function', this.s('関数名', 'Function name'))]
      : [];
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
    const v = n.childForFieldName('value');
    const children = this.ordered(n, (c) => same(c, v));
    const vt = v ? this.sub(v).map((t) => ({ ...t, explanation: this.s('照合する値: ', 'Value to match: ') + t.explanation })) : [];
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
      .map((p) => this.tok(p, 'pattern', hasGlob(p.text)
        ? this.s(`パターン \`${p.text}\`（グロブ: \`*\` は任意の文字列, \`?\` は任意の1文字）`, `Pattern \`${p.text}\` (glob: \`*\` any string, \`?\` any char)`)
        : this.s(`パターン \`${p.text}\``, `Pattern \`${p.text}\``)));
    const rest = this.ordered(n, (c) => has(pats, c) || c.type === '|' || c.type === ')' || c.type === '(');
    return this.tok(n, 'pattern', expl + this.lineRef(n), sortTokens([...patToks, ...rest]));
  }

  private pipeline(n: SyntaxNode): Token {
    const children = this.ordered(n);
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
      return [{
        op: r.children.find((c) => !c.isNamed)?.type ?? '>',
        fd: r.childForFieldName('descriptor')?.text ?? '',
        dest: fieldChildren(r, 'destination').map((d) => d.text).join(' '),
      }];
    }
    if (r.type === 'heredoc_redirect') {
      // Redirections written after `<<EOF` on the same line are nested in the heredoc node.
      return [{ op: '<<', fd: '', dest: '' }, ...r.namedChildren.filter((c) => c.type === 'file_redirect').flatMap((c) => this.redirectInfo(c))];
    }
    if (r.type === 'herestring_redirect') return [{ op: '<<<', fd: '', dest: '' }];
    return [];
  }

  private fileRedirect(n: SyntaxNode): Token {
    const fd = n.childForFieldName('descriptor')?.text ?? '';
    const op = n.children.find((c) => !c.isNamed)?.type ?? '>';
    const dests = fieldChildren(n, 'destination');
    const dest = dests.map((d) => d.text).join(' ');
    const make = redirects[op];
    let expl = make ? this.t(make(fd, dest)) : this.s(`リダイレクト \`${op}\``, `Redirection \`${op}\``);
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
    const op = n.children.find((c) => !c.isNamed)?.type ?? '<<';
    const start = n.namedChildren.find((c) => c.type === 'heredoc_start')?.text ?? '';
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
      ...(body ? this.subs(body.namedChildren.filter((c) => c.type !== 'heredoc_content')) : []),
      // The grammar nests redirections that follow `<<EOF` on the same line inside the heredoc node.
      ...this.subs(n.namedChildren.filter((c) => c.type.endsWith('redirect'))),
    ];
    // Keep the token span on the operator so highlighting does not swallow the whole body.
    const opEnd = n.namedChildren.find((c) => c.type === 'heredoc_start') ?? n;
    return {
      kind: 'redirect', label, explanation: expl, children,
      span: { start: spanOf(n).start, end: spanOf(opEnd).end },
    };
  }

  private herestring(n: SyntaxNode): Token {
    return this.tok(n, 'redirect', this.s(
      'ヒアストリング `<<<`: 続く文字列（末尾に改行が付く）を標準入力として渡す',
      'Here-string `<<<`: the following word (plus a newline) becomes stdin',
    ), this.subs(n.namedChildren.filter((c) => !isPlainWord(c))));
  }

  private assignment(n: SyntaxNode): Token {
    const name = n.childForFieldName('name');
    const value = n.childForFieldName('value');
    const op = n.children.find((c) => !c.isNamed && (c.type === '=' || c.type === '+='))?.type ?? '=';
    const nm = name?.text ?? '?';
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
    const kw = n.child(0)?.type ?? 'declare';
    const base = declarationCommands[kw];
    const children: Token[] = [];
    for (const c of n.namedChildren) {
      if (this.line !== null && !intersects(c, this.line)) continue;
      if (c.type === 'word' && c.text.startsWith('-')) {
        const flags = c.text.slice(1).split('').map((ch) => declarationFlags['-' + ch]).filter(Boolean);
        children.push(this.tok(c, 'option', flags.length ? flags.map((f) => this.t(f)).join(this.s('、', ', ')) : this.s('オプション', 'Option')));
      } else if (c.type === 'variable_name' || c.type === 'word') {
        children.push(this.tok(c, 'variable', this.s(`変数 \`${c.text}\` を対象にする`, `Variable \`${c.text}\``)));
      } else {
        children.push(...this.sub(c));
      }
    }
    const t = this.tok(n, 'builtin', base ? this.t(base) : kw, children);
    t.summary = `${kw}: ${t.explanation}`;
    return t;
  }

  private unset(n: SyntaxNode): Token {
    const t = this.tok(n, 'builtin', this.t(builtins.unset.summary), this.subs(n.namedChildren.filter((c) => !isPlainWord(c) && c.type !== 'variable_name')));
    t.summary = `unset: ${t.explanation}`;
    return t;
  }

  // ---------------------------------------------------------------- commands

  private command(n: SyntaxNode): Token {
    const nameNode = n.childForFieldName('name');
    const prefix: Token[] = [];
    const args: SyntaxNode[] = [];
    const redirs: SyntaxNode[] = [];
    let seenName = false;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)!;
      if (same(c, nameNode)) { seenName = true; continue; }
      if (c.type.endsWith('redirect')) { redirs.push(c); continue; }
      if (!seenName && c.type === 'variable_assignment') {
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
    const argToks = this.args(head.doc, args, head.name);
    const t = this.tok(n, head.kind, head.explanation, sortTokens([
      ...prefix, ...head.nameTokens, ...argToks, ...this.subs(redirs),
    ]));
    t.summary = `${head.name}: ${head.explanation}`;
    const subTok = head.doc?.subcommands && argToks.find((a) => a.kind === 'command' && !a.children.length);
    if (subTok) t.summary = `${head.name} ${subTok.label}: ${this.t(head.doc!.subcommands![subTok.label]?.summary ?? head.doc!.summary)}`;
    return t;
  }

  private commandHead(nameNode: SyntaxNode): { name: string; doc?: CommandDoc; kind: Kind; explanation: string; nameTokens: Token[] } {
    const word = nameNode.namedChildren[0] ?? nameNode;
    const name = isPlainWord(word) ? word.text : nameNode.text;
    if (!isPlainWord(word) && word.type !== 'raw_string') {
      return {
        name, kind: 'command', nameTokens: this.sub(word),
        explanation: this.s('変数（展開結果）をコマンド名として実行する', 'Run the expanded value as a command'),
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
    const doc = lookupCommand(name);
    if (doc) {
      return { name, doc, kind: doc.builtin ? 'builtin' : 'command', nameTokens: [], explanation: this.t(doc.summary) + (doc.builtin ? this.s('（シェル組み込み）', ' (shell builtin)') : '') };
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
      const quotedLongOpt = a.type === 'concatenation' && /^--[\w-]+=/.test(a.namedChildren[0]?.text ?? '');
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
      else if (doc?.positional?.length) desc = this.t(doc.positional[Math.min(posIndex, doc.positional.length - 1)]);
      const lang = isFn ? undefined : doc?.positionalLang?.[posIndex];
      posIndex++;
      if (this.line !== null && !intersects(a, this.line)) continue;
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
      if (emb) return this.tok(a, 'argument', desc ?? this.s('引数', 'Argument'), emb.tokens);
      const base = this.word(a);
      if (!desc) return base;
      const glob = hasGlob(a.text) ? this.s('（グロブ: 一致するファイル名の一覧に展開される）', ' (glob: expands to matching file names)') : '';
      return this.tok(a, 'argument', desc + glob);
    }
    const inner = this.sub(a);
    // The embedded tokens sit inside the quotes, so they become children of the string token.
    if (emb && inner[0]) inner[0].children = sortTokens([...inner[0].children, ...emb.tokens]);
    if (!desc) return inner[0] ?? this.tok(a, 'argument', this.s('引数', 'Argument'));
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
    let tokens: EmbeddedToken[];
    let note: string | undefined;
    switch (lang) {
      case 'regex': {
        const flavor = this.regexFlavor();
        note = flavorName(flavor, this.lang);
        tokens = flavor === 'fixed' ? [] : explainRegex(lit.text, flavor, this.lang);
        break;
      }
      case 'sed': {
        const flavor = this.regexFlavor();
        tokens = explainSed(lit.text, flavor === 'ere' ? 'ere' : 'bre', this.lang);
        break;
      }
      case 'jq':
        tokens = explainJq(lit.text, this.lang);
        break;
      case 'awk':
        tokens = explainAwk(lit.text, this.lang);
        break;
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
        const summary = role === 'to' ? trSummary(sets[0] ?? '', lit.text, this.lang) : undefined;
        note = summary ? `${r.note}${this.s('。つまり', '; that is, it ')}${summary}` : r.note;
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
        for (const w of this.argCtx?.args ?? []) {
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
        break;
      }
      case 'glob':
        tokens = [];
        note = describeFindPattern(lit.text, this.lang);
        if (!note) return undefined;
        break;
      case 'date': {
        // Only `+FORMAT` is a format; other date arguments set the clock.
        if (!lit.text.startsWith('+')) return undefined;
        tokens = explainDate(lit.text, this.lang);
        const sample = sampleDate(lit.text);
        if (sample !== undefined) note = this.s(`今なら「${sample}」のように表示される`, `right now this prints "${sample}"`);
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
    };
  }

  /**
   * find's arguments: global options, starting points, then an expression explained as a whole
   * (`-o`, implicit `-a`, `!` and `\( \)` grouping) with the usual per-primary tokens inside.
   * Returns undefined when the expression cannot be parsed, so the generic handling applies.
   */
  private findArgs(doc: CommandDoc, args: SyntaxNode[]): Token[] | undefined {
    const out: Token[] = [];
    const opts = doc.options ?? {};
    const visible = (n: SyntaxNode) => this.line === null || intersects(n, this.line);
    let i = 0;
    while (i < args.length && /^-[HLP]$/.test(args[i].text)) i = this.option(doc, args, i, 'find', out) + 1;
    while (i < args.length && !isExpressionStart(args[i].text)) {
      if (visible(args[i])) out.push(this.positional(args[i], this.t(doc.positional![0])));
      i++;
    }
    if (i >= args.length) return out;
    const exprArgs = args.slice(i);
    const words = exprArgs.map((a) => unquote(a.text));
    const tree = parseFind(words, (w) => (opts[w]?.untilTerminator ? 'until' : opts[w]?.arg ? 1 : 0));
    if (!tree) return undefined;

    const opTok = (idx: number, ja: string, en: string): Token[] => (visible(exprArgs[idx]) ? [this.tok(exprArgs[idx], 'operator', this.s(ja, en))] : []);
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
    const args = this.argCtx?.args ?? [];
    const flags = args.filter((w) => /^-[a-zA-Z]+$/.test(w.text)).map((w) => w.text.slice(1)).join('');
    const sets = args.filter((w) => !/^-[a-zA-Z]+$/.test(w.text));
    const idx = sets.findIndex((w) => same(w, a));
    const lits = sets.map((w) => literalContent(w)?.text ?? w.text);
    if (flags.includes('d')) return { role: idx === 0 ? 'delete' : 'squeeze', sets: lits };
    if (flags.includes('s') && sets.length === 1) return { role: 'squeeze', sets: lits };
    return { role: idx === 0 ? 'from' : 'to', sets: lits };
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
    const visible = (n: SyntaxNode) => this.line === null || intersects(n, this.line);
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
    if (text.startsWith('--') && eq > 0) {
      const flag = text.slice(0, eq);
      const opt = opts[flag];
      if (visible(a)) {
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
          if (visible(term)) {
            children.push(this.tok(term, 'operator', term.text === '+'
              ? this.s('`-exec` の終わり: 見つかったファイルをまとめて1回のコマンドに渡す', 'End of `-exec`: pass all matches to one command invocation')
              : this.s('`-exec` の終わり: 見つかったファイル1件ごとにコマンドを実行（`;` はシェルに解釈されないようエスケープが必要）', 'End of `-exec`: run once per match (`;` must be escaped from the shell)')));
          }
        }
        last = Math.min(j, args.length - 1);
      } else if (opt?.arg && i + 1 < args.length) {
        last = i + 1;
        if (visible(args[last])) children.push(valueTok(opt, text, args[last]));
      }
      if (visible(a)) out.push(this.tok(a, 'option', pre + (opt ? this.t(opt.text) : unknown), []));
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
          if (visible(args[last])) parts.push(valueTok(opt, flag, args[last]));
        }
        break;
      }
    }
    const own = parts.filter((p) => p.span.start.line === row && p.span.end.character <= col + text.length);
    const tail = parts.filter((p) => !own.includes(p));
    if (visible(a)) {
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
    const doc = lookupCommand(name);
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

  private test(n: SyntaxNode): Token {
    const open = n.child(0)?.type;
    const expl = open === '[['
      ? this.s('拡張条件式 `[[ ]]`: 条件を評価し、真なら成功(0)を返す（bash 専用。変数をクォートしなくても安全で、`&&` `||` `=~` が使える）',
        'Extended test `[[ ]]`: evaluates a condition (bash-only; safe without quoting, supports `&&`, `||`, `=~`)')
      : open === '(('
        ? this.s('算術評価 `(( ))`: 式を計算し、結果が 0 以外なら成功(0)を返す', 'Arithmetic evaluation `(( ))`: succeeds if the result is non-zero')
        : this.s('条件式 `[ ]`: 条件を評価し、真なら成功(0)を返す（`test` コマンドと同じ。`[` の後と `]` の前には空白が必要）',
          'Test `[ ]`: evaluates a condition (same as `test`; spaces after `[` and before `]` are required)');
    const t = this.tok(n, 'test', expl, this.subs(n.namedChildren));
    t.summary = this.s(`条件判定 ${shorten(n.text, 40)}`, `test ${shorten(n.text, 40)}`);
    return t;
  }

  /** The right side of `[[ x =~ re ]]` (an ERE) is broken down; other `regex` nodes are glob-like patterns. */
  private regexNode(n: SyntaxNode): Token {
    const op = n.parent?.type === 'binary_expression' ? n.parent.childForFieldName('operator')?.text ?? n.parent.children.find((c) => c.type === '=~')?.text : undefined;
    // Unquoted backslashes reach the regex unchanged (`\.` stays an escaped dot), so only quotes and expansions are excluded.
    if (op === '=~' && !/\$[\w{(@*#?!-]|[`"']/.test(n.text) && n.startPosition.row === n.endPosition.row) {
      const tokens = explainRegex(n.text, 'ere', this.lang).map((t) => this.fromEmbedded(t, n, { text: n.text, base: 0 }));
      return this.tok(n, 'pattern', this.s('正規表現（拡張正規表現 ERE）', 'Regular expression (extended, ERE)'), tokens);
    }
    return this.tok(n, 'pattern', this.s('正規表現（またはパターン）', 'Regular expression (or pattern)'));
  }

  private inArithmetic(n: SyntaxNode): boolean {
    for (let p = n.parent; p; p = p.parent) {
      if (p.type === 'arithmetic_expansion' || p.type === 'c_style_for_statement') return true;
      if (p.type === 'test_command') return p.child(0)?.type === '((';
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
    if (hasGlob(text)) return this.tok(n, 'pattern', this.s(`グロブ \`${text}\`: 一致するファイル名の一覧に展開される（\`*\` は任意の文字列, \`?\` は任意の1文字）`, `Glob \`${text}\`: expands to matching file names (\`*\` any string, \`?\` any char)`));
    return this.tok(n, 'argument', this.s(`文字列 \`${text}\``, `Word \`${text}\``));
  }

  private string(n: SyntaxNode): Token {
    return this.tok(n, 'string', this.s(
      'ダブルクォート文字列: 中の `$変数` や `$(…)` は展開されるが、単語分割やグロブ展開はされない（1つの引数のまま）',
      'Double-quoted string: `$vars` and `$(…)` expand, but no word splitting or globbing (stays one argument)',
    ), this.subs(n.namedChildren.filter((c) => c.type !== 'string_content')));
  }

  private varDesc(name: string): string | undefined {
    if (specialVariables[name]) return this.t(specialVariables[name]);
    if (/^\d+$/.test(name)) return this.s(`位置パラメータ: ${name} 番目の引数`, `Positional parameter: argument #${name}`);
    if (wellKnownVariables[name]) return this.t(wellKnownVariables[name]);
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
    const parsed = n.startPosition.row === n.endPosition.row ? parseExpansion(n.text) : undefined;
    if (!parsed) return summary;
    const tf = parsed.op === '@' ? transformMeaning[parsed.parts.find((p) => p.role === 'transform')?.text ?? ''] : undefined;
    if (tf) summary.explanation = this.s(`パラメータ展開: \`${parsed.name}\` の値を${tf[0]}`, `Parameter expansion: take the value of \`${parsed.name}\` and ${tf[1]}`);
    if (parsed.op === ':') summary.explanation = this.s('パラメータ展開: ', 'Parameter expansion: ') + this.substringSummary(parsed);
    const example = exampleFor(parsed, this.lang);
    if (example) summary.explanation += this.s(`。例: ${example}`, `. e.g. ${example}`);
    const row = n.startPosition.row;
    const col = n.startPosition.column;
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
    const inner = n.text.slice(2, -1);
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

export function lookupCommand(name: string): CommandDoc | undefined {
  if (Object.prototype.hasOwnProperty.call(builtins, name)) return builtins[name];
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  if (Object.prototype.hasOwnProperty.call(commands, base)) return commands[base];
  if (base === 'egrep' || base === 'fgrep') return commands.grep;
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
