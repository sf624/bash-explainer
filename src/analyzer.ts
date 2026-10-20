import { Lang, Text } from './i18n';
import { findIdioms, Redirect, simulateRedirects } from './idioms';
import { pitfallNotes } from './pitfalls';
import { ancestor, descendants, field, fields, token } from './syntax/tree';
import type { NodeType, SyntaxNode, SyntaxTree } from './syntax/tree';
import { builtins, shoptOptions } from './dict/builtins';
import { ciVariables } from './dict/ciVariables';
import { distroAliases } from './dict/distroAliases';
import { commands } from './dict/commands';
import { BundleDoc, CommandDoc, OptDoc, PositionalBy } from './dict/types';
import { explainRegex, Flavor, flavorName } from './embedded/regex';
import { explainGlob, globIntro, GlobTarget } from './embedded/glob';
import { grepWrap, JsRegex, literalRegex, regexExamples, toJsRegex } from './examples/regex';
import { awkExample } from './examples/awk';
import { perlExample, perlOptions } from './examples/perlrun';
import { MAX_SHOWN_LINES, pipelineExample, readsFileOperand, Stage } from './examples/pipeline';
import { jqExample, JqRun, Json, toJson } from './examples/jq';
import { sedExample } from './examples/sed';
import { Interactive, jqStepSections, rerun, RerunSpec } from './examples/rerun';
import { commandExample, FILTERS, parseOptions } from './examples/textfilters';
import { Operand, readSampleLine, runRead, testCases, xargsExample } from './examples/runtime';
import { bashPrintf, braceExpand, extglobs, globExamples, globMatches, GlobMode, GlobOpts, hasExtglob, hasGlobstar, isGlob, ShellWordsUnsupported } from './examples/shellwords';
import { explainAwk } from './embedded/awk';
import { pictureNote } from './ctlchars';
import { explainDate, explainEscapes, explainPrintf, formatDate as formatDateCommand, parseSampleDate, printfNote, SAMPLE_DATES } from './embedded/format';
import { describeFind, describeFindPattern, FindNode, isExpressionStart, parseFind, unquote } from './embedded/find';
import { explainArith } from './embedded/arith';
import { explainGetopts } from './embedded/getopts';
import { parseTest, TestExpr, testRange } from './testexpr';
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
import { ArithLiteral, arithLiteral, describeArithLiteral, evalArith, evalArithWrapping, intValue } from './arith';
import { decodedText, splitElement, staticWordValue, unquoteWord } from './staticword';
import { describeGlob, ExpansionPart, exampleFor, globParts, opMeaning, ParsedExpansion, parseExpansion, slicesElements, transformMeaning } from './expansion';
import {
  binaryTestOps, extendedEqualOps, declarationCommands, fdName, declarationFlags, expansionOps, keywords, listOps,
  redirects, specialDestinations, specialVariables, unaryTestOps, wellKnownVariables,
} from './dict/syntax';
import { LabelPart, labelText, skeleton } from './label';

export type Kind =
  | 'command' | 'subcommand' | 'builtin' | 'function' | 'keyword' | 'option' | 'argument' | 'operator'
  | 'redirect' | 'variable' | 'expansion' | 'substitution' | 'string' | 'number'
  | 'comment' | 'assignment' | 'test' | 'pattern' | 'block' | 'error';

export interface Pos { line: number; character: number }
export interface Span { start: Pos; end: Pos }

export interface Token {
  kind: Kind;
  /**
   * Short label shown in lists: usually the source text of the span, truncated. A command is labelled with its
   * name (`grep`), since its explanation describes the program; a construct, with its skeleton (see `labelParts`).
   * The span stays the whole command or construct.
   */
  label: string;
  /**
   * The label as a skeleton, for a construct (`if` *condition* `then` *commands* `fi`): code and placeholders. Absent when
   * the label is one plain text. `label` is always its plain-text form (placeholders as ‹name›).
   */
  labelParts?: LabelPart[];
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
  /** Said once under the title: what the control pictures (␛ ⇥) in the lines stand for. */
  note?: string;
  /** For the panel: input the user can edit, and how to run the example again on it. */
  interactive?: Interactive;
}

/** A set of node types, checked against the model's: a name that is not a NodeType does not compile. */
const types = (...names: NodeType[]): ReadonlySet<string> => new Set<string>(names);
/** Constructs that own a body; when they span lines, each line explains only its own part. */
const BLOCKS = types(
  'for_statement', 'c_style_for_statement', 'while_statement', 'if_statement', 'elif_clause',
  'else_clause', 'case_statement', 'case_item', 'function_definition', 'compound_statement',
  'subshell', 'do_group', 'error', 'arithmetic_command', 'select_statement',
);
/** What can end a pipeline and run in its subshell. */
const LAST_STAGES = types('while_statement', 'for_statement', 'select_statement', 'compound_statement', 'arithmetic_command', 'command');
/** What holds a list of statements. */
const BLOCK_OWNERS = types('program', 'compound_statement', 'do_group', 'subshell', 'if_statement', 'else_clause', 'elif_clause', 'case_item');
/** Nodes that just combine statements; they count as blocks only when they contain one. */
const WRAPPERS = types('list', 'pipeline', 'redirected_statement', 'negated_command', 'program', 'time_statement');

/** Nodes inside an expansion's argument that get their own explanation. */
const NESTED = new Set(['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution', 'string', 'raw_string']);

const plural = (n: number, word: string) => `${word}${n === 1 ? '' : 's'}`;
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
  const [head, ...rest] = text.split('\n');
  const first = head.trimEnd();
  const s = first.length > max ? first.slice(0, max - 1) + '…' : first;
  // " …" says that the text goes on in a later line; trailing blanks (`tr -d ' '`, `"PV "`) are not that.
  return rest.some((l) => l.trim()) && s === first ? s + ' …' : s;
}

function isBlockLike(n: SyntaxNode): boolean {
  if (BLOCKS.has(n.type)) return isMultiline(n);
  if (WRAPPERS.has(n.type)) return n.namedChildren.some(isBlockLike);
  return false;
}

/** Whether the node is in double quotes (a string, or a here-document), not counting those outside a `$(…)` around it. */
function inDoubleQuotes(n: SyntaxNode): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === 'string' || p.type === 'heredoc_body') return true;
    if (p.type === 'command_substitution' || p.type === 'process_substitution') return false;
  }
  return false;
}

const same = (a: SyntaxNode | null | undefined, b: SyntaxNode | null | undefined) => !!a && a === b;
/** The nodes of these types under `n` that overlap `line`; one that ends where the line starts does not. */
const onLine = (n: SyntaxNode, types: string[], line: number): SyntaxNode[] =>
  descendants(n, types, { from: line, to: line }).filter((m) => m.endPosition.row > line || m.endPosition.column > 0);
/** The sibling `by` places away (-1: the one before), or undefined. */
const sibling = (n: SyntaxNode, by: number): SyntaxNode | undefined => {
  const kids = n.parent!.children;
  return kids[kids.indexOf(n) + by];
};
const has = (list: readonly SyntaxNode[], n: SyntaxNode) => list.some((x) => x === n);

const isPlainWord = (n: SyntaxNode) => n.type === 'word' || n.type === 'number';
const hasGlob = (s: string) => /(^|[^\\])([*?]|[+@!]\()|\[[^\]]+\]/.test(s);

export class Analyzer {
  private line: number | null = null;
  /** The shell options in effect on this line (see shoptStates). */
  private shopt: ShoptStates = shoptStates('', 0);
  private shell: Shell | undefined;
  /** Aliases defined in the script (`alias ll='ls -l'`): name → where, and what it stands for. */
  private aliases = new Map<string, { line: number; value: string; readAt: number }[]>();
  private context: ContextEntry[] = [];
  /** Function definitions in the script: name → where each starts and ends, in source order. */
  private functions = new Map<string, { line: number; start: number; end: number }[]>();
  /** Variables declared as namerefs (`local -n r=$1`): name → the line of the declaration. */
  /** Where `set -f` / `set -o noglob` (off: true) and `set +f` / `set +o noglob` (off: false) end, in source order. */
  private noglob: { end: number; off: boolean }[] = [];
  /** Arrays assigned in the script (`y=(a b)`, `declare -A m`, `read -a r`): name → where, and whether it is associative. */
  private arrays = new Map<string, { index: number; assoc: boolean }>();
  /** Standalone assignments to IFS with a known value: where each ends, its value, and the part of the script it is local to. */
  private ifsAssigns: { node: SyntaxNode; value: string; scope: SyntaxNode | undefined }[] = [];
  private namerefs = new Map<string, { line: number; index: number }>();
  /** Variables declared with the integer attribute (`declare -i n`): name → where the declaration starts. */
  private integers = new Map<string, number>();
  /** Associative arrays (`declare -A m`): name → where the declaration starts. */
  private assocs = new Map<string, number>();
  /** Notes produced while explaining (e.g. the effect of several redirections). */
  private extraNotes: string[] = [];
  /** Context of the current explainLine call. */
  private opts: ExplainOptions = {};
  /** The whole text being explained (for hints such as how yq was installed). */
  private source = '';
  private rootNode!: SyntaxNode;
  /** Worked examples produced while explaining (grep, sed, awk, jq). */
  private examples: Example[] = [];
  /** The command whose arguments are being explained (for option-dependent embedded languages). */
  /** The command whose arguments are being explained (set while they are, which is when the helpers that read it run). */
  private argCtx: { cmd: string; args: SyntaxNode[] } | undefined;

  constructor(private lang: Lang) {}

  explainLine(tree: SyntaxTree, line: number, shell?: Shell, opts: ExplainOptions = {}): LineExplanation {
    const root = tree.root;
    this.opts = opts;
    this.source = root.text;
    this.rootNode = root;
    this.functions.clear();
    for (const f of descendants(root, ['function_definition'])) {
      const name = field(f, 'name')?.text;
      if (name) this.functions.set(name, [...(this.functions.get(name) ?? []), { line: f.startPosition.row, start: f.startIndex, end: f.endIndex }]);
    }
    this.arrays.clear();
    const addArray = (name: string | undefined, index: number, assoc: boolean): void => { if (name && !this.arrays.has(name)) this.arrays.set(name, { index, assoc }); };
    for (const a of descendants(root, ['variable_assignment'])) {
      const nameNode = field(a, 'name');
      if (field(a, 'value')?.type === 'array') addArray(nameNode?.text, a.startIndex, a.parent?.type === 'declaration_command' && /^\w+\s+-[a-zA-Z]*A/.test(a.parent.text));
      else if (nameNode?.type === 'subscript') addArray(nameNode.text.replace(/\[.*/s, ''), a.startIndex, false);
    }
    for (const d of descendants(root, ['declaration_command'])) {
      const flags = d.namedChildren.find((c) => c.type === 'word' && /^-[a-zA-Z]+$/.test(c.text))?.text ?? '';
      if (!/[aA]/.test(flags)) continue;
      for (const c of d.namedChildren) addArray(c.type === 'variable_name' ? c.text : undefined, d.startIndex, flags.includes('A'));
    }
    for (const c of descendants(root, ['command'])) {
      const cmd = field(c, 'name')?.text;
      const args = fields(c, 'argument').map((a) => a.text);
      if (cmd === 'read' && args.includes('-a')) addArray(args[args.indexOf('-a') + 1], c.startIndex, false);
      if (cmd === 'mapfile' || cmd === 'readarray') addArray(args.filter((a) => !a.startsWith('-')).pop(), c.startIndex, false);
    }
    this.ifsAssigns = [];
    for (const a of descendants(root, ['variable_assignment'])) {
      if (field(a, 'name')?.text !== 'IFS' || (a.parent?.type === 'command' && field(a.parent, 'name')?.text) || a.parent?.type === 'declaration_command') continue;
      const v = field(a, 'value');
      const value = v ? staticWordValue(v) : '';
      if (value === undefined) continue;
      this.ifsAssigns.push({ node: a, value, scope: ancestor(a, (x) => ['subshell', 'command_substitution', 'process_substitution', 'function_definition'].includes(x.type)) });
    }
    this.noglob = [];
    for (const c of descendants(root, ['command'])) {
      if (field(c, 'name')?.text !== 'set') continue;
      const words = fields(c, 'argument').map((a) => a.text);
      for (let i = 0; i < words.length && words[i] !== '--'; i++) {
        const m = /^([-+])([a-zA-Z]+)$/.exec(words[i]);
        if (!m) break;
        if (m[2].includes('f')) this.noglob.push({ end: c.endIndex, off: m[1] === '-' });
        if (m[2].includes('o') && words[i + 1] === 'noglob') this.noglob.push({ end: c.endIndex, off: m[1] === '-' });
      }
    }
    this.namerefs.clear();
    for (const d of descendants(root, ['declaration_command'])) {
      if (!d.namedChildren.some((c) => c.type === 'word' && /^-[a-zA-Z]*n/.test(c.text))) continue;
      for (const c of d.namedChildren) {
        const name = c.type === 'variable_assignment' ? field(c, 'name')?.text : c.type === 'variable_name' ? c.text : undefined;
        if (name && !this.namerefs.has(name)) this.namerefs.set(name, { line: d.startPosition.row, index: d.startIndex });
      }
    }
    this.integers.clear();
    this.assocs.clear();
    for (const d of descendants(root, ['declaration_command'])) {
      for (const [flag, into] of [['i', this.integers], ['A', this.assocs]] as const) {
        if (!d.namedChildren.some((c) => c.type === 'word' && new RegExp(`^-[a-zA-Z]*${flag}`).test(c.text))) continue;
        for (const c of d.namedChildren) {
          const name = c.type === 'variable_assignment' ? field(c, 'name')?.text : c.type === 'variable_name' ? c.text : undefined;
          if (name && !into.has(name)) into.set(name, d.startIndex);
        }
      }
    }
    this.aliases.clear();
    for (const c of descendants(root, ['command'])) {
      if (field(c, 'name')?.text !== 'alias') continue;
      for (const a of fields(c, 'argument')) {
        const m = /^([\w.:-]+)=(['"]?)([\s\S]*)\2$/.exec(a.text);
        if (m) this.aliases.set(m[1], [...(this.aliases.get(m[1]) ?? []), { line: c.startPosition.row, value: m[3], readAt: unitOf(c).end }]);
      }
    }
    this.line = line;
    this.shell = shell;
    this.shopt = shoptStates(root.text, line, shell);
    this.context = [];
    this.extraNotes = [];
    this.examples = [];
    const items = this.flatten(root);
    const statements = onLine(root, ['command', 'redirected_statement', 'list', 'pipeline', 'variable_assignment', 'test_command', 'extended_test', 'while_statement'], line)
      .filter((n) => intersects(n, line))
      .map((n) => (n.type === 'while_statement' ? n.text.split('\n')[0] : n.text));
    const result: LineExplanation = {
      line,
      ...(shell && shell !== 'bash' ? { shell } : {}),
      items,
      context: this.context,
      notes: [...this.notes(root, line, items), ...(shell ? dialectNotes(tree, line, shell, this.lang) : []), ...new Set(this.extraNotes), ...(this.opts.idioms === false ? [] : findIdioms(statements, this.lang)), ...(this.opts.pitfalls === false ? [] : [...pitfallNotes(root, line, this.lang), ...this.extglobPitfalls(root, line), ...this.unmatchedGlobPitfalls(root, line), ...this.pipeSubshellPitfalls(root, line)])],
      // Each -e of sed explains the same combined script, so drop repeated examples.
      examples: this.titledExamples(root, line)
        .filter((e) => this.wantsExample(e))
        .filter((e, i, all) => all.findIndex((x) => JSON.stringify(x) === JSON.stringify(e)) === i)
        .map((e) => {
          const note = pictureNote(e.sections.flatMap((sec) => sec.lines), (ja, en) => this.s(ja, en));
          return note ? { ...e, note } : e;
        }),
      summary: items.filter((t) => t.kind !== 'comment' || items.length === 1).map(summaryOf).join(' ; '),
    };
    this.line = null;
    // The summary above was made with the full explanations; the tree drops what its labels already say.
    for (const item of items) dropLabelEcho(item);
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

  /** The named sibling before `n`. */
  private previousNamed(n: SyntaxNode): SyntaxNode {
    const kids = n.parent!.namedChildren;
    return kids[kids.indexOf(n) - 1];
  }

  private subs(nodes: readonly (SyntaxNode | null | undefined)[]): Token[] {
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
    // The patterns of a case branch go on after a `\` at the end of a line (`a|\` then `b)`): the later lines have
    // patterns, `|` and `)` of the branch, which are not words, pipes and the end of a subshell.
    const patterns = n.type === 'case_item' ? fields(n, 'value') : [];
    for (const c of n.children) {
      if (this.line !== null && !intersects(c, this.line)) continue;
      if (has(patterns, c)) out.push(this.casePattern(c));
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
      case 'time_statement': return this.timeStatement(n);
      case 'declaration_command': return this.redirectLayoutOf(n) ?? this.declaration(n);
      case 'unset_command': return this.unset(n);
      case 'variable_assignment': return skeletal(this.assignment(n), n, true);
      case 'variable_assignments': return this.tok(n, 'assignment', this.s('複数の変数への代入', 'Several variable assignments'), this.subs(n.namedChildren));
      case 'pipeline': return this.pipeline(n);
      case 'list': return this.list(n);
      case 'redirected_statement': return this.redirected(n);
      case 'file_redirect': return this.fileRedirect(n);
      case 'heredoc_redirect': return this.heredoc(n);
      case 'herestring_redirect': return this.herestring(n);
      case 'negated_command': return skeletal(this.tok(n, 'operator', this.t(keywords[n.namedChildren[0]?.type === 'pipeline' ? '! pipeline' : '!']), this.subs(n.namedChildren)), n);
      case 'test_command': case 'extended_test': case 'arithmetic_command': return this.test(n);
      case 'unary_expression': return this.unary(n);
      case 'binary_expression': return this.binary(n);
      case 'ternary_expression': return this.tok(n, 'expansion', this.s('三項演算子: 条件 ? 真のときの値 : 偽のときの値', 'Ternary: cond ? if-true : if-false'), this.subs(n.namedChildren));
      case 'postfix_expression': return this.tok(n, 'operator', this.s(`算術: \`${n.text}\`（${n.text.endsWith('++') ? '1 増やす' : '1 減らす'}）`, `Arithmetic: \`${n.text}\` (${n.text.endsWith('++') ? 'increment' : 'decrement'})`));
      case 'parenthesized_expression': return this.tok(n, 'operator', this.s('括弧でまとめた式', 'Parenthesized expression'), this.subs(n.namedChildren));
      case 'expansion': return this.expansion(n);
      case 'simple_expansion': return this.simpleExpansion(n);
      case 'command_substitution': return this.commandSubstitution(n);
      case 'process_substitution': return this.processSubstitution(n);
      case 'arithmetic_expansion': return this.tok(n, 'substitution', this.s('算術展開: 中の式を整数として計算した結果に置き換える', 'Arithmetic expansion: replaced by the integer result of the expression')
        + (n.text.startsWith('$[') ? this.s('。`$[…]` は古い書き方（廃止予定）で、`$((…))` と同じ意味', '. `$[…]` is the obsolete form of `$((…))`') : '') + this.commaNote(n) + this.wrapNote(n), this.arithChildren(n));
      case 'string': return this.string(n);
      case 'raw_string': return this.tok(n, 'string', this.s('シングルクォート文字列: 中身は一切展開されず、そのままの文字列になる', 'Single-quoted string: taken literally, nothing is expanded'));
      case 'ansi_c_string': return this.tok(n, 'string', this.s('`$\'…\'` 文字列: `\\n` `\\t` などのエスケープを解釈した文字列になる', '`$\'…\'` string: backslash escapes such as `\\n` are interpreted') + (/\\/.test(n.text) ? this.valueNote(n) : ''), this.ansiCChildren(n));
      // (The model has the `$` and the string in one node; the string takes the `$` in.)
      case 'translated_string': return this.string(n.namedChildren[0]);
      case 'concatenation': if (n.parent!.type === 'array' && splitElement(n.text)) return this.arrayElement(n); return this.braceWord(n) ?? this.tok(n, 'argument', this.concatenationNote(n) + this.valueNote(n), this.subs(n.namedChildren));
      case 'word': return this.braceWord(n) ?? this.word(n);
      case 'number': return this.arithNumber(n) ?? this.tok(n, 'number', this.s('数値', 'Number'));
      // (`{1..x}` is not a brace expansion: it stays a word.)
      case 'brace_expression': return this.braceWord(n) ?? this.word(n);
      case 'array': return this.tok(n, 'expansion', this.s('配列: `( )` 内の要素から配列を作る', 'Array: built from the elements inside `( )`'), this.subs(n.namedChildren));
      case 'subscript': return this.subscript(n);
      case 'regex': return this.regexNode(n);
      case 'extglob_pattern': return this.globToken(n, 'value');
      case 'variable_name': return this.arithNumber(n) ?? this.variable(n.text, n);
      case 'subshell': return this.block(n, 'block', this.s('サブシェル: `( )` 内を別プロセスで実行する。中での変数変更や cd は外に影響しない', 'Subshell: runs `( )` in a child process; variable changes and cd do not leak out'));
      case 'compound_statement': return this.block(n, 'block', this.s('コマンドグループ: `{ }` 内のコマンドを現在のシェルでまとめて実行する', 'Command group: runs the commands in `{ }` in the current shell'));
      case 'do_group': return this.block(n, 'block', this.s('ループ本体: `do` から `done` までを繰り返し実行する', 'Loop body: the commands between `do` and `done`'));
      case 'function_definition': return this.functionDef(n);
      case 'for_statement': case 'select_statement': return this.forStatement(n);
      case 'c_style_for_statement': return this.block(n, 'keyword', this.s('C 言語風 for ループ: `((初期化; 条件; 更新))` で回数を制御して繰り返す', 'C-style for loop: `((init; condition; update))`') + this.lineRef(n));
      case 'while_statement': return this.whileStatement(n);
      case 'if_statement': return this.block(n, 'keyword', this.s('if 文: 条件コマンドの終了ステータスが 0（成功）なら then 以下を実行', 'if statement: runs the `then` branch if the condition exits 0') + this.lineRef(n));
      case 'elif_clause': return this.block(n, 'keyword', this.t(keywords.elif));
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
    if (v && (this.line === null || intersects(v, this.line))) extra.push(this.tok(v, 'variable', this.s('ループ変数: 繰り返しごとに次の値が入る', 'Loop variable: receives the next value on each iteration')));
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

  private casePattern(p: SyntaxNode): Token {
    return this.globToken(p, 'value', p.text, 0);
  }

  /**
   * A glob pattern as a token: what a glob is, then its parts as children. A text without glob characters is just
   * a pattern that matches itself. `text` starts `base` characters into the node.
   */
  private globToken(n: SyntaxNode, target: GlobTarget, text = n.text, base = 0, kind: Kind = 'pattern'): Token {
    if (!hasGlob(text)) return this.tok(n, kind, this.s(`パターン \`${text}\`（ワイルドカードを含まないので、この文字列そのものに一致）`, `Pattern \`${text}\` (no wildcards, so it matches exactly this text)`));
    return this.tok(n, kind, globIntro(this.lang, target) + this.extglobNote(text), this.globChildren(n, text, base));
  }

  /** The parts of a glob pattern as tokens, placed where the pattern is written (`base` characters into `n`). */
  private globChildren(n: SyntaxNode, text: string, base: number): Token[] {
    return explainGlob(text, this.lang).map((t) => this.fromEmbedded(t, n, { text, base }));
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
      .filter((p) => this.line === null || intersects(p, this.line))
      .map((p) => this.casePattern(p));
    const rest = this.ordered(n, (c) => has(pats, c) || c.type === '|' || c.type === ')' || c.type === '(');
    if (!isDefault && (this.line === null || pats.some((p) => intersects(p, this.line!)))) {
      const before = this.examples.length;
      this.caseExample(pats);
      this.anchorExamples(before, n);
    }
    return skeletal(this.tok(n, 'pattern', expl + (prev && !isDefault ? this.s('。', '. ') + viaPrev : '') + this.lineRef(n), sortTokens([...patToks, ...rest])), n);
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

  private redirected(n: SyntaxNode): Token {
    const body = field(n, 'body');
    // (A redirection the parser left without its operator and target is nothing to explain.)
    const redirs = n.namedChildren.filter((c) => !same(c, body) && c.children.length);
    const effect = simulateRedirects(redirs.map((r) => this.redirectInfo(r)), this.lang);
    if (effect) this.extraNotes.push(effect);
    // A command with redirections: the command is one token and the redirections are its siblings (see `splitCommand`).
    const layout = body && this.redirectLayout(body, redirs);
    if (layout) return this.splitCommand(n, body!, layout);
    const bodyToks = this.sub(body);
    const redirToks = this.subs(redirs);
    // Redirections in the middle of the words (`echo a > f b`, or `time cmd > f`) leave no single range for the
    // command: it stays one token that carries its redirections as children.
    if (bodyToks.length === 1 && body && !isBlockLike(body) && ['command', 'declaration_command', 'time_statement'].includes(body.type)) {
      const t = bodyToks[0];
      return { ...t, span: spanOf(n), children: sortTokens([...t.children, ...redirToks]) };
    }
    // On a line where none of the redirections appear (e.g. a loop header), show the body alone.
    // The label still shows them: `while` *condition* `do` *commands* `done` `< input.txt`.
    if (this.line !== null && redirToks.length === 0 && bodyToks.length === 1) {
      return skeletal({ ...bodyToks[0] }, n);
    }
    // `f() { …; } >&2`: the redirection belongs to the function, not to its definition.
    const ofFunction = n.parent?.type === 'function_definition';
    const w = this.tok(n, 'redirect', this.s(
      `入出力のリダイレクト: ${body ? `\`${shorten(body.text, 30)}\` 全体` : 'コマンド'}の入出力を切り替える${ofFunction ? '。関数に付けたリダイレクトは関数と一緒に保存され、関数を呼ぶたびに適用される' : ''}`,
      `Redirection applied to ${body ? `\`${shorten(body.text, 30)}\` as a whole` : 'the command'}${ofFunction ? '. A redirection on a function is stored with it and applied each time the function is called' : ''}`,
    ), sortTokens([...bodyToks, ...redirToks]));
    w.summary = [...bodyToks.map(summaryOf), ...redirToks.map((r) => r.label)].join(' ');
    return skeletal(w, n);
  }

  /**
   * The words of a simple command and its redirections, when the words are one range with no redirection
   * among them: the redirections are all before or after them (`tr -d x < a > b`, `>f echo x`). `redirs` are
   * those outside `body`; the ones inside it (before its words, or between them) are added. Undefined when
   * there are none, or one stands in the middle (`echo a > f b`).
   */
  private redirectLayout(body: SyntaxNode, outer: SyntaxNode[]): Layout | undefined {
    if (body.type !== 'command' && body.type !== 'declaration_command') return undefined;
    const redirs = sortNodes([...body.children.filter((c) => c.type.endsWith('redirect')), ...outer]);
    const words = body.children.filter((c) => !c.type.endsWith('redirect'));
    const first = words[0];
    const last = words[words.length - 1];
    if (!redirs.length || redirs.some((r) => r.startIndex > first.startIndex && r.startIndex < last.endIndex)) return undefined;
    const text = body.text.slice(first.startIndex - body.startIndex, last.endIndex - body.startIndex);
    return {
      redirs, text,
      span: { start: { line: first.startPosition.row, character: first.startPosition.column }, end: { line: last.endPosition.row, character: last.endPosition.column } },
    };
  }

  /** `splitCommand` of a command whose redirections are inside its node (before its words, or a here-string after them), if there are any. */
  private redirectLayoutOf(n: SyntaxNode): Token | undefined {
    const layout = this.redirectLayout(n, []);
    return layout && this.splitCommand(n, n, layout);
  }

  /**
   * A command with redirections, as the shell runs it: it sets the redirections up, then starts the command, which
   * never sees them. So the redirections are one token (`whole`) with two kinds of children: the command (the
   * words only, with its description and examples) and each redirection.
   */
  private splitCommand(whole: SyntaxNode, body: SyntaxNode, layout: Layout): Token {
    const effect = simulateRedirects(layout.redirs.map((r) => this.redirectInfo(r)), this.lang);
    if (effect) this.extraNotes.push(effect);
    const before = this.examples.length;
    const inner = body.type === 'command' ? this.commandToken(body, true) : this.declaration(body, true);
    inner.span = layout.span;
    this.tagExamples(before, body, layout);
    const redirToks = this.subs(layout.redirs);
    const fds = new Set<string>();
    for (const r of layout.redirs) {
      const { op } = r.type === 'file_redirect' ? redirectParts(r) : { op: r.type === 'heredoc_redirect' ? '<<' : '<<<' };
      const fd = field(r, 'descriptor')?.text ?? '';
      if (op === '&>' || op === '&>>') { fds.add('1'); fds.add('2'); } else if (!/^\{/.test(fd)) fds.add(fd || (op.startsWith('<') ? '0' : '1'));
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
    return this.tok(n, 'redirect', expl, children);
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

  private assignment(n: SyntaxNode): Token {
    const name = field(n, 'name')!;
    const value = field(n, 'value');
    const op = n.children.find((c) => !c.named && (c.type === '=' || c.type === '+='))!.type;
    const nm = name.text;
    let expl = op === '+='
      ? this.s(`変数 \`${nm}\` に値を追記する（配列なら要素を追加）`, `Append to variable \`${nm}\` (adds elements for arrays)`)
      : value
        ? this.s(`変数 \`${nm}\` に値を代入する（\`=\` の前後に空白は入れられない）`, `Assign a value to variable \`${nm}\` (no spaces around \`=\`)`)
        : this.s(`変数 \`${nm}\` に空文字を代入する`, `Set variable \`${nm}\` to the empty string`);
    // `local -n r=$1` makes `r` another name for the variable named by `$1`; every later `r=…` then sets that variable.
    const decl = n.parent?.type === 'declaration_command' && n.parent.namedChildren.some((c) => c.type === 'word' && /^-[a-zA-Z]*n/.test(c.text));
    const refLine = this.namerefs.get(nm);
    if (decl && value) {
      expl = this.s(`\`${nm}\` は参照（nameref）になる: 値 \`${value.text}\` を名前とする変数の別名で、\`${nm}\` への代入や参照は、その変数に対して行われる`,
        `\`${nm}\` becomes a nameref: another name for the variable whose name is the value \`${value.text}\`; assigning to or reading \`${nm}\` then acts on that variable`);
    } else if (!decl && refLine !== undefined && refLine.index < n.startIndex && op === '=') {
      expl += this.s(`。ただし \`${nm}\` は行 ${refLine.line + 1} で nameref として宣言されているので、参照先の変数に代入される`,
        `. But \`${nm}\` is declared a nameref on line ${refLine.line + 1}, so this sets the variable it points to`);
    }
    // An integer variable (`declare -i n`) takes the value of an arithmetic expression, and `+=` adds.
    const intAt = this.integers.get(nm);
    const integer = name.type !== 'subscript' && value && value.type !== 'array' && intAt !== undefined && intAt < n.startIndex;
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
      const intAtArr = this.integers.get(arr);
      const toInt = add && intAtArr !== undefined && intAtArr < n.startIndex;
      const verb = (set: string, plus: string, plusInt: string): string => (toInt ? plusInt : add ? plus : set);
      if (this.isAssoc(arr, n.startIndex)) {
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
          : this.s(`。\`IFS\` は単語分割（と \`read\`）が区切りに使う文字の一覧: これ以降、クォートしない展開は \`${this.shown(v)}\` で分割される。\`"\${a[*]}"\` と \`"$*"\` は先頭の文字 \`${this.shown(v[0])}\` で要素をつなぐ`,
            `. \`IFS\` lists the characters word splitting (and \`read\`) split on: from here, unquoted expansions are split on \`${this.shown(v)}\`. \`"\${a[*]}"\` and \`"$*"\` join their elements with the first character, \`${this.shown(v[0])}\``);
    }
    const children: Token[] = [];
    if (value) {
      for (const t of this.sub(value)) {
        if (intValueText && isPlainWord(value) && !this.arithNumber(value)) t.explanation = `\`${value.text}\`: ${intValueText}`;
        else if (isPlainWord(value) && !this.arithNumber(value)) t.explanation = this.s(`代入する値 \`${value.text}\``, `Value \`${value.text}\``);
        children.push(t);
      }
    }
    return this.tok(n, 'assignment', expl, children);
  }

  private declaration(n: SyntaxNode, redirsOut = false): Token {
    // declare, typeset, export, readonly or local, all in the dictionary.
    const kw = n.children[0].type;
    const base = declarationCommands[kw];
    const children: Token[] = [];
    // A declaration over several lines is explained whole (see sub), so every part counts.
    let named = false;
    for (const c of n.namedChildren) {
      if (redirsOut && c.type.endsWith('redirect')) continue;
      // Options end at the first name: `declare x -i` is an error for the name `-i`.
      if (c.type === 'word' && c.text.startsWith('-') && !named) {
        const flags = c.text.slice(1).split('').map((ch) => declarationFlags['-' + ch]).filter(Boolean);
        children.push(this.tok(c, 'option', flags.length ? flags.map((f) => this.t(f)).join(this.s('、', ', ')) : this.s('オプション', 'Option')));
      } else if (c.type === 'variable_name' || c.type === 'word') {
        named = true;
        children.push(this.tok(c, 'variable', this.s(`変数 \`${c.text}\` を対象にする`, `Variable \`${c.text}\``)));
      } else {
        named = true;
        children.push(...this.sub(c));
      }
    }
    const t = this.tok(n, 'builtin', this.t(base), children, kw);
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
    const t = this.tok(n, 'builtin', this.t(builtins.unset.summary), children, 'unset');
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
    const commands = onLine(root, ['command', 'test_command', 'extended_test', 'arithmetic_command'], line)
      .filter((c) => intersects(c, line));
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
    // `>f echo x`, `<<<'1 2' read a b`: redirections before the words.
    const split = this.redirectLayoutOf(n);
    if (split) return split;
    const before = this.examples.length;
    const t = this.commandToken(n);
    this.tagExamples(before, n);
    return t;
  }

  /** Records which command the examples added since `before` belong to (inner commands tag theirs first). */
  private tagExamples(before: number, n: SyntaxNode, words?: Layout): void {
    const target = shorten((words?.text ?? n.text).replace(/\s*\\\n\s*/g, ' '), 40);
    for (const e of this.examples.slice(before)) e.target ??= target;
    if (words) for (const e of this.examples.slice(before)) e.anchor ??= words.span;
    else this.anchorExamples(before, n);
  }

  /** Attaches the examples added since `before` to `n`, unless a more specific node already took them. */
  private anchorExamples(before: number, n: SyntaxNode): void {
    for (const e of this.examples.slice(before)) e.anchor ??= spanOf(n);
  }

  /** The assignments before the command name (as tokens), the arguments, and the redirections of a command. */
  private commandParts(n: SyntaxNode, nameNode: SyntaxNode): { prefix: Token[]; args: SyntaxNode[]; redirs: SyntaxNode[] } {
    const prefix: Token[] = [];
    const args: SyntaxNode[] = [];
    const redirs: SyntaxNode[] = [];
    let seenName = false;
    for (const c of n.children) {
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
      if (c.named) args.push(c);
    }
    return { prefix, args, redirs };
  }

  private timeStatement(n: SyntaxNode): Token {
    const before = this.examples.length;
    const t = this.timed(n);
    this.tagExamples(before, n);
    return t;
  }

  private commandToken(n: SyntaxNode, redirsOut = false): Token {
    // (An assignment with no command, `FOO=1 2>/dev/null`, is a `redirected_statement` of the assignment.)
    const nameNode = field(n, 'name')!;
    const { prefix, args, redirs } = this.commandParts(n, nameNode);
    // `time` is a keyword at the start of a pipeline (a `time_statement`); `FOO=1 time x` and `a | time x` run the program.
    return this.commandTail(n, nameNode, args, prefix, redirsOut ? [] : redirs);
  }

  /** The keyword `time`, and the option `-p` if there is one: the start of every explanation of it. */
  private timeLead(time: SyntaxNode, posix: SyntaxNode | undefined): Token[] {
    const kw = this.tok(time, 'keyword', this.t(keywords.time));
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
    if (head.name.split('/').pop() === 'yq') {
      // Three tools are called yq; explain the arguments as the one this command is for.
      const verdict = judgeYq(args.map((a) => literalContent(a)?.text), { doc: this.source, host: this.opts.host, setting: this.opts.yqFlavor });
      head.doc = YQ_DOCS[verdict.flavor];
      head.explanation = this.t(head.doc.summary);
      // A command over several lines is explained whole, so it always starts on the line explained.
      this.extraNotes.push(...yqNotes(verdict, this.lang));
    }
    const argToks = this.args(head.doc, args, head.name, head.fn);
    this.commandExampleFor(head.name, args);
    if (head.name === 'read') this.readExample(n, args);
    for (const a of args) {
      const before = this.examples.length;
      this.wordExample(a);
      this.anchorExamples(before, a);
    }
    const t = this.tok(n, head.kind, head.explanation, sortTokens([
      ...prefix, ...head.nameTokens, ...argToks, ...this.subs(redirs),
    ]), shorten((word ?? nameNode).text));
    t.summary = `${head.name}: ${head.explanation}`;
    const subTok = head.doc?.subcommands && argToks.find((a) => a.kind === 'subcommand' && !a.children.length);
    // Every subcommand in the dictionary has a summary.
    if (subTok) t.summary = `${head.name} ${subTok.label}: ${this.t(head.doc!.subcommands![subTok.label].summary)}`;
    return t;
  }

  private commandHead(nameNode: SyntaxNode, word = nameNode.namedChildren[0]!): CommandHead {
    // `{echo,hi}` is a brace expansion first: the command is the first word it gives (`echo`), with the others as arguments.
    const braced = isPlainWord(word) ? this.braceWords(word.text) : undefined;
    if (braced?.length) {
      const head = this.commandHeadFor(nameNode, word, braced[0]);
      head.explanation = this.s(
        `ブレース展開で \`${word.text}\` は \`${braced.join(' ')}\` になるので、コマンド \`${braced[0]}\` を実行する（\`{ }\` のグループではない）。${head.explanation}`,
        `Brace expansion turns \`${word.text}\` into \`${braced.join(' ')}\`, so this runs the command \`${braced[0]}\` (it is not a \`{ }\` group). ${head.explanation}`);
      head.nameTokens = [this.braceWord(word)!];
      return head;
    }
    const head = this.commandHeadFor(nameNode, word);
    const spelled = staticWordValue(word);
    if (spelled && spelled !== word.text) {
      head.explanation = this.s(
        `コマンド名 \`${word.text}\` は、クォートやバックスラッシュ、空の \`$(…)\` を取り除くと \`${this.shown(spelled)}\` になる。${head.explanation}`,
        `The command name \`${word.text}\` becomes \`${this.shown(spelled)}\` once the quotes, backslashes and empty \`$(…)\` are removed. ${head.explanation}`,
      );
      if (!isPlainWord(word) && !head.nameTokens.length) head.nameTokens = this.sub(word);
    }
    return head;
  }

  /**
   * The line of the function `name` that exists when `at` runs. A function exists once its definition
   * has run, so a call before it is the builtin or program of that name; a call inside a function body
   * runs later, whenever the function is called, so any definition in the script counts there.
   */
  private functionAt(name: string, at: SyntaxNode): number | undefined {
    const defs = this.functions.get(name);
    if (!defs) return undefined;
    const deferred = ancestor(at, (a) => a.type === 'function_definition') !== undefined;
    const def = defs.find((d) => deferred || d.end <= at.startIndex);
    if (!def) {
      // The call comes first: say that the name is not yet the function.
      this.extraNotes.push(this.s(
        `ℹ \`${name}\` は行 ${defs[0].line + 1} で関数として定義されますが、この行はその前に実行されるので、まだ関数ではありません（組み込みコマンドや外部コマンドの \`${name}\` が動きます）`,
        `ℹ \`${name}\` is defined as a function on line ${defs[0].line + 1}, but this runs before that, so it is not the function yet (the builtin or program \`${name}\` runs)`));
    }
    return def?.line;
  }

  private commandHeadFor(nameNode: SyntaxNode, word: SyntaxNode, as?: string): CommandHead {
    // Commands with an empty name (`FOO=1 2>/dev/null`) do not get here.
    // A name made of quotes, escapes or empty `$(:)` is the command it spells once they are removed (`e\c'h'"o"` is `echo`).
    const spelled = staticWordValue(word);
    const sv = spelled && spelled !== word.text ? spelled : undefined;
    const name = as ?? sv ?? (isPlainWord(word) ? word.text : nameNode.text);
    if (sv === undefined && !isPlainWord(word) && word.type !== 'raw_string') {
      return {
        name, kind: 'command', nameTokens: this.sub(word),
        explanation: this.s('変数（展開結果）をコマンド名として実行する', 'Run the expanded value as a command'),
      };
    }
    // An alias over a known command (`alias grep=ggrep`) is still explained as that command.
    // (A quoted name is never an alias.)
    // bash reads a whole line (or compound command, or function body) before running it, so an alias
    // counts only from the next line on; the last definition before this line wins.
    const known = lookupCommand(name) || sv !== undefined ? undefined : this.aliases.get(name);
    const alias = known?.filter((d) => d.readAt <= unitOf(nameNode).start).pop();
    if (known && !alias) {
      const same = known[0].line <= nameNode.startPosition.row;
      this.extraNotes.push(this.s(
        `ℹ \`${name}\` は行 ${known[0].line + 1} で \`alias\` として定義されますが、${same ? 'bash は行（複合コマンドや関数の本体も）をまとめて読んでから実行するので、同じ行で定義したエイリアスはまだ使えません' : 'これはその前に読まれ、エイリアスは実行された後に読まれるものにだけ効きます'}。ここでは alias ではないので、\`${name}\` というコマンドがなければ「command not found」になります（\`eval\` に渡した文字列は実行時に読み直されるので、エイリアスが使えます）`,
        `ℹ \`${name}\` is defined as an alias on line ${known[0].line + 1}, but ${same ? 'bash reads a whole line (and a whole compound command or function body) before running it, so an alias defined on the same line is not in effect yet' : 'this is read before that, and an alias works only on what is read after it ran'}. It is not an alias here: without a command named \`${name}\`, this is "command not found" (a string given to \`eval\` is read again when it runs, so it can use the alias)`));
    }
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
    const fnLine = this.functionAt(name, nameNode);
    if (fnLine !== undefined) {
      return {
        name, kind: 'function', fn: true, nameTokens: [],
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
  private args(doc: CommandDoc | undefined, args: SyntaxNode[], cmdName: string, isFn = false): Token[] {
    if (doc && cmdName.split('/').pop() === 'find') {
      const found = this.findArgs(doc, args);
      if (found) return found;
    }
    const out: Token[] = [];
    // `grep -e PATTERN file`: the option supplies the pattern, so `file` is the second positional.
    let posIndex = fillsPositional(doc, args) ? 1 : 0;
    let endOfOpts = false;
    // The positional arguments, to describe again once their number is known (`positionalBy`).
    const operands: { index: number; token: Token; desc: string }[] = [];
    const savedCtx = this.argCtx;
    this.argCtx = { cmd: cmdName, args };
    try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const text = a.text;
      if (!endOfOpts && isPlainWord(a) && text === '--' && cmdName !== 'echo') {
        out.push(this.tok(a, 'option', this.s('オプションの終わり: 以降は `-` で始まっていても通常の引数として扱う', 'End of options: everything after is a plain argument')));
        endOfOpts = true;
        continue;
      }
      // `--pretty=format:'%h %s'` is one word made of a plain part and a quoted part.
      const quotedLongOpt = a.type === 'concatenation' && /^--[\w-]+=/.test(a.namedChildren[0]!.text);
      if (i === 0 && doc?.bundle && isPlainWord(a)) {
        const end = this.bundle(doc, doc.bundle, args, out);
        if (end >= 0) { i = end; continue; }
      }
      // A builtin reads options up to its first operand: `printf '%d' -0` and `echo a -n` take `-0` and `-n` as values.
      // `echo` only knows `-n`, `-e` and `-E` (alone or joined); any other word, `-x` or `-nx`, is text to print.
      const echoText = cmdName === 'echo' && !/^-[neE]+$/.test(text);
      const optLike = !endOfOpts && !(doc?.builtin && posIndex > 0) && !echoText && (isPlainWord(a) || quotedLongOpt) && text.length > 1 && (text.startsWith('-') || (cmdName === 'set' && text.startsWith('+')));
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
        // The convention first (it reads as a command), then a note on the syntax: to the shell it is a plain argument.
        const note = this.s(`（シェルから見れば \`${cmdName}\` への引数で、\`${cmdName}\` 自身が解釈する）`, ` (to the shell it is an argument to \`${cmdName}\`, which interprets it itself)`);
        out.push({ ...this.tok(a, 'subcommand', this.s(`サブコマンド \`${cmdName} ${text}\`: `, `Subcommand \`${cmdName} ${text}\`: `) + this.t(sd.summary) + note), children: [] }, ...rest);
        break;
      }
      // Positional argument.
      let desc: string | undefined;
      if (isFn) desc = this.s(`関数への引数 $${posIndex + 1}`, `Argument $${posIndex + 1} to the function`);
      else if (cmdName === 'shopt' && text in shoptOptions) desc = this.s(`シェルオプション \`${text}\`: `, `Shell option \`${text}\`: `) + this.t(shoptOptions[text as keyof typeof shoptOptions]);
      else if (doc?.positional?.length) desc = this.t(doc.positional[Math.min(posIndex, doc.positional.length - 1)]);
      if (cmdName === 'trap' && posIndex === 0 && desc) desc += this.trapNote(a);
      // (Every argument of `let` is an arithmetic expression.)
      const lang = isFn ? undefined : cmdName === 'let' ? 'arith' : cmdName === 'echo' && echoEscapes(args) ? 'echo' : doc?.positionalLang?.[posIndex];
      const token = this.positional(a, desc, lang);
      if (desc && doc?.positionalBy && !isFn) operands.push({ index: posIndex, token, desc });
      posIndex++;
      out.push(token);
    }
    } finally {
      this.argCtx = savedCtx;
    }
    if (doc?.positionalBy) this.describeByCount(doc.positionalBy, args, operands, posIndex);
    return out;
  }

  /** Describe the positional arguments by how many there are (`seq 5` has a last value, `seq 1 5` a first and a last). */
  private describeByCount(rules: PositionalBy[], args: SyntaxNode[], operands: { index: number; token: Token; desc: string }[], count: number): void {
    const words = args.map((a) => a.text);
    const end = words.indexOf('--');
    const given = (names: string): boolean => (end < 0 ? words : words.slice(0, end)).some((w) => names.split('|').some((n) =>
      n.startsWith('--') ? w === n || w.startsWith(n + '=') : new RegExp(`^-[^-]*${n[1]}`).test(w)));
    const rule = rules.find((r) => (r.orMore ? count >= r.count : count === r.count) && !(r.unless && given(r.unless)));
    if (!rule) return;
    for (const { index, token, desc } of operands) {
      const now = this.t(index === count - 1 && rule.last ? rule.last : rule.texts[Math.min(index, rule.texts.length - 1)]);
      token.explanation = now + token.explanation.slice(desc.length);
    }
  }

  /**
   * `tar xzf a.tgz`, `ps aux`: the first argument as options without a dash. Each letter is explained,
   * and those that take a value (`f`, `C`) use the words after the bundle in order. Returns the index of
   * the last word used, or -1 when the word is not such a bundle.
   */
  private bundle(doc: CommandDoc, b: BundleDoc, args: SyntaxNode[], out: Token[]): number {
    const a = args[0];
    const text = a.text;
    const look = (ch: string): OptDoc | undefined => (b.options ? b.options[ch] : doc.options?.['-' + ch]);
    if (!/^[A-Za-z0-9]+$/.test(text) || ![...text].every((ch) => look(ch))) return -1;
    if (b.needs && ![...text].some((ch) => b.needs!.includes(ch))) return -1;
    const col = a.startPosition.column;
    const row = a.startPosition.row;
    const parts: Token[] = [];
    const values: Token[] = [];
    let last = 0;
    [...text].forEach((ch, k) => {
      const opt = look(ch)!;
      parts.push({
        kind: 'option', label: ch, explanation: this.t(opt.text), children: [],
        span: { start: { line: row, character: col + k }, end: { line: row, character: col + k + 1 } },
      });
      if (opt.arg && last + 1 < args.length) {
        last++;
        values.push(this.tok(args[last], 'argument', this.s(`\`${ch}\` の値`, `Value for \`${ch}\``), isPlainWord(args[last]) ? [] : this.sub(args[last])));
      }
    });
    const style = b.style ? this.t(b.style) : this.s('旧式のオプション（ハイフンなし）', 'Old-style options (no dash)');
    out.push(this.tok(a, 'option', `${style}: ${parts.map((p) => `\`${p.label}\``).join(' ')}`, parts), ...values);
    return last;
  }

  private positional(a: SyntaxNode, desc: string | undefined, lang?: EmbeddedLang): Token {
    const emb = lang && this.embedded(a, lang);
    if (emb && desc && emb.note) desc += ` — ${emb.note}`;
    if (isPlainWord(a)) {
      // Arguments in another language are positional ones the dictionary describes.
      if (emb) return this.tok(a, 'argument', desc!, emb.tokens);
      const brace = this.braceWord(a);
      const base = brace ?? this.word(a);
      if (!desc) return base;
      if (brace) return this.tok(a, 'argument', desc, [brace]);
      const tilde = this.tilde(a);
      if (tilde) return this.tok(a, 'argument', desc, [tilde]);
      const off = hasGlob(a.text) && this.globOff(a);
      if (off) return this.tok(a, 'argument', desc + this.noglobNote());
      const glob = hasGlob(a.text) ? ` — ${globIntro(this.lang, 'file')}` + this.globNotes(a.text) : '';
      return this.tok(a, 'argument', desc + glob + this.valueNote(a) + this.braceVarNote(a.text), hasGlob(a.text) ? this.globChildren(a, a.text, 0) : []);
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
      case 'echo':
        tokens = explainEscapes(lit.text, this.lang, 'echo');
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
        note = describeFindPattern(lit.text, this.lang);
        if (!note) return undefined;
        tokens = explainGlob(lit.text, this.lang);
        // Unlike the shell, find matches a leading dot with * too; -path also matches / with *.
        // The test before the pattern: -name, -path…
        const opt = this.previousNamed(a).text;
        if (!/^-i/.test(opt)) {
          this.globExample(lit.text, 'value', this.s(`例（\`${opt}\` のパターン）`, `Example (the \`${opt}\` pattern)`),
            opt === '-name' ? [this.s('一致するファイル名', 'Matching names'), this.s('一致しないファイル名', 'Non-matching names')] : [this.s('一致するパス', 'Matching paths'), this.s('一致しないパス', 'Non-matching paths')]);
        }
        break;
      }
      case 'arith': {
        const r = explainArith(lit.text, this.lang);
        if (!r) return undefined;
        tokens = r.tokens;
        note = r.note;
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

  /** The escapes inside `$'…'`, each with its meaning. */
  private ansiCChildren(n: SyntaxNode): Token[] {
    const lit: Literal = { text: n.text.slice(2, -1), base: 2 };
    return explainEscapes(lit.text, this.lang, 'ansic').map((t) => this.fromEmbedded(t, n, lit));
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
            ...(r.steps && i === 0 ? jqStepSections(r.steps, output, this.lang, (vs) => (json ? vs.map(toJson) : yqYamlOutput(vs, style)))
              : [r.error ? { label: this.s('エラー', 'Error'), lines: output } : { label: this.s(`出力（${json ? 'JSON' : 'YAML'}）`, `Output (${json ? 'JSON' : 'YAML'})`), lines: output, empty: this.s('（出力なし）', '(no output)') }]),
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
          ...(r.steps && i === 0 ? jqStepSections(r.steps, r.outputs, this.lang, (vs) => vs.map(toJson))
            : [r.error
              ? { label: this.s('エラー', 'Error'), lines: [r.error] }
              : { label: this.s('出力', 'Output'), lines: r.outputs, empty: this.s('（出力なし）', '(no output)') }]),
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
        const body = field(c, 'body');
        if (!body || body.type !== 'command') return undefined;
        // `grep x < file` reads a file; output redirections other than 2>/dev/null change where data goes.
        // (Those of the last stage change where the result goes; the example still shows what the stages make.)
        for (const r of i === n.namedChildren.length - 1 ? [] : c.namedChildren.filter((x) => !same(x, body))) {
          const op = r.children.find((x) => !x.named)?.type;
          if (r.type === 'file_redirect' && op === '<' && i === 0) readsFile = true;
          else if (!(r.type === 'file_redirect' && field(r, 'descriptor')?.text === '2')) return undefined;
        }
        cmd = body;
      }
      if (cmd.type !== 'command') return undefined;
      const name = field(cmd, 'name');
      // (An incomplete `echo a |` has a stage with a name of no word.)
      if (!name || (name.namedChildren.length && !isPlainWord(name.namedChildren[0]))) return undefined;
      const args = cmd.namedChildren.filter((x) => !same(x, name) && x.type !== 'variable_assignment' && !x.type.endsWith('redirect'));
      stages.push({ cmd: name.text.split('/').pop()!, words: args.map((a) => literalContent(a)?.text), text: shorten(cmd.text, 40) });
    }
    const ex = pipelineExample(stages, readsFile);
    if (!ex) return undefined;
    const cap = (lines: string[]) => (lines.length > MAX_SHOWN_LINES ? [...lines.slice(0, MAX_SHOWN_LINES - 1), '…'] : lines).map(visible);
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

  /** The words an unquoted word of plain text gives by brace expansion; undefined when it gives none (or too many to list). */
  private braceWords(text: string): string[] | undefined {
    try {
      return braceExpand(text);
      /* c8 ignore start */
    } catch (e) {
      // Too many words to list. (braceExpand throws nothing else.)
      if (!(e instanceof ShellWordsUnsupported)) throw e;
      return undefined;
    }
    /* c8 ignore stop */
  }

  /** A word with braces (`{a,b\,c}`, `{,}`, `{a..e..2}`), explained as the brace expansion it is. */
  private braceWord(n: SyntaxNode): Token | undefined {
    const text = this.unquotedWord(n);
    if (text === undefined) return undefined;
    let words: string[] | undefined;
    try {
      words = braceExpand(text);
    } catch (e) {
      // Too many words to list. (braceExpand throws nothing else.)
      /* c8 ignore next */
      if (!(e instanceof ShellWordsUnsupported)) throw e;
      return this.tok(n, 'expansion', this.s(`ブレース展開: \`${text}\` は多くの単語に展開される`, `Brace expansion: \`${text}\` expands to many words`));
    }
    if (!words) return undefined;
    // (An empty word that stays is shown as `''`: a lone backslash, as `{Z..a}` makes, is gone after quote removal.)
    const list = (words.length > 12 ? [...words.slice(0, 11), '…'] : words).map((w) => (w === '…' ? w : `\`${w || "''"}\``)).join(' ');
    const comma = /\\,/.test(text);
    // `{01..10..3}`: a number with a leading 0 makes every number as wide as the widest.
    const pad = /\{-?0\d+\.\./.test(text) || /\.\.-?0\d+(?:\.\.|\})/.test(text);
    return this.tok(n, 'expansion', words.length
      ? this.s(`ブレース展開: \`${text}\` は ${words.length} 個の単語 ${list} に展開される${comma ? '（\\, は区切りではなく、コンマそのもの）' : ''}${pad ? '（先頭が 0 の数があるので、桁数をそろえて 0 で埋める）' : ''}`,
        `Brace expansion: \`${text}\` expands to ${words.length} ${words.length === 1 ? 'word' : 'words'}: ${list}${comma ? ' (an escaped comma is not a separator, just a comma)' : ''}${pad ? ' (a number with a leading 0 pads all of them with zeros to the same width)' : ''}`)
      : this.s(`ブレース展開: \`${text}\` は空の単語に展開され、空の単語は取り除かれるので、何も残らない`, `Brace expansion: \`${text}\` expands to empty words, which are dropped, so nothing is left`));
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
          sections: [{ label: this.s('展開後の単語', 'Resulting words'), lines: (words.length > 12 ? [...words.slice(0, 11), '…'] : words).map((w) => w || "''") }],
        });
        return;
      }
      /* c8 ignore start */
    } catch (e) {
      // A guard: braceExpand throws nothing else.
      if (!(e instanceof ShellWordsUnsupported)) throw e;
      return;
    }
    /* c8 ignore stop */
    if (isGlob(text) && !this.globOff(a)) this.globExample(text, 'file', this.s(`例（グロブ \`${text}\`）`, `Example (glob \`${text}\`)`));
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
    for (const p of onLine(root, ['pipeline'], line)) {
      if (p.startPosition.row !== line) continue;
      let last = p.namedChildren[p.namedChildren.length - 1];
      // The redirections after the last stage (`… | while …; done > log`) are its own.
      if (last?.type === 'redirected_statement') last = field(last, 'body') ?? last;
      if (!last || !LAST_STAGES.has(last.type)) continue;
      const names = new Set<string>();
      for (const a of descendants(last, ['variable_assignment'])) {
        const n = field(a, 'name')?.text;
        // Not `X=1 cmd`, which only sets X for cmd, nor `local`.
        if (n && a.parent?.type !== 'command' && !ancestorOf(a, (x) => x.type === 'declaration_command' && /^local\b/.test(x.text))) names.add(n);
      }
      for (const c of [last, ...descendants(last, ['command'])]) {
        if (c.type === 'command' && field(c, 'name')?.text === 'read' && (c === last || last.type !== 'while_statement' || !ancestorOf(c, (x) => x === field(last, 'condition')))) {
          for (const w of fields(c, 'argument')) if (/^[A-Za-z_]\w*$/.test(w.text) && !/^-/.test(sibling(w, -1)!.text)) names.add(w.text);
        }
      }
      if (!names.size) continue;
      // Used after the pipeline, in the same block.
      let scope: SyntaxNode = p;
      while (scope.parent && !BLOCK_OWNERS.has(scope.parent.type)) scope = scope.parent;
      // The program at least holds the pipeline.
      const block = scope.parent!;
      const after = block.text.slice(scope.endIndex - block.startIndex);
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
    for (const loop of onLine(root, ['for_statement', 'select_statement'], line)) {
      if (loop.startPosition.row !== line) continue;
      // `*.log`, and `"$dir"/*.log` too.
      const glob = fields(loop, 'value').find((v) => ((!!this.unquotedWord(v) && isGlob(v.text))
        || (v.type === 'concatenation' && v.namedChildren.some((c) => c.type === 'word' && isGlob(c.text)))));
      const v = field(loop, 'variable')?.text;
      if (!glob || !v || this.globOff(glob)) continue;
      const bodyNode = field(loop, 'body');
      // `for f in *` while typing: there is no body to look at yet.
      if (!bodyNode) continue;
      const body = bodyNode.text;
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
    const uses = onLine(root, ['word', 'extglob_pattern'], line)
      .filter((n) => n.startPosition.row === line && hasExtglob(n.text) && !ancestorOf(n, (a) => a.type === 'extended_test'));
    if (!uses.length) return [];
    const use = uses[0];
    let top = use;
    while (top.parent && top.parent.type !== 'program') top = top.parent;
    const inBlock = top !== use && descendants(top, ['command']).some((c) => c.startIndex < use.startIndex && field(c, 'name')?.text === 'shopt'
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
    this.patternExample(pats, [this.s('この分岐に入る値', 'Values that take this branch'), this.s('入らない値', 'Values that do not')]);
  }

  /** Values that match any of the glob patterns (`case` branches, the right side of `[[ == ]]`) and values that do not: found with the matcher of `case`. */
  private patternExample(pats: SyntaxNode[], labels: [string, string]): void {
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
      sections: [{ label: labels[0], lines: [...new Set(matching)] }, { label: labels[1], lines: nonMatching }].filter((s) => s.lines.length),
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
      /* c8 ignore start */
    } catch (e) {
      // A guard: runGitLog throws nothing else.
      if (!(e instanceof GitFormatUnsupported)) throw e;
    }
    /* c8 ignore stop */
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
      if (c.type !== 'variable_assignment' || field(c, 'name')?.text !== 'IFS') continue;
      const v = field(c, 'value');
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
    // The line the command reads, when a here-string gives it: `read -a p <<< "a,b,,c,"`.
    const here = n.namedChildren.find((c) => c.type === 'herestring_redirect')?.namedChildren[0];
    const given = here && literalContent(here)?.text;
    const line = given ?? readSampleLine(names.length, ifs, !!array);
    const r = runRead(line, names, { ifs, raw, array });
    // A separator that is not whitespace (`IFS=,`) keeps empty fields; a trailing one adds no field.
    if (/[^ \t\n]/.test(ifs)) {
      const seps = [...ifs].filter((c) => !/[ \t\n]/.test(c)).map((c) => `\`${c}\``).join(this.s('、', ', '));
      this.extraNotes.push(this.s(
        `\`IFS=${ifs}\` の \`read\`: 空白以外の区切り文字（${seps}）が続くと、間の空のフィールドもそのまま残る（空白の区切りは続いても1つにまとまる）。末尾の区切り文字の後ろには空のフィールドはできない`,
        `\`read\` with \`IFS=${ifs}\`: a separator that is not whitespace (${seps}) keeps the empty field between two of them (whitespace separators merge into one); a separator at the end of the line adds no empty field after it`));
    }
    const lines = r.array ? [`${r.array[0]}=(${r.array[1].map((x) => JSON.stringify(x)).join(' ')})`] : r.vars.map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    this.examples.push({ kind: 'read',
      title: this.s('例', 'Example'),
      sections: [{ label: this.s('読み込む行', 'Line read'), lines: [JSON.stringify(line)] }, { label: this.s('変数に入る値', 'Values stored'), lines }],
    });
  }

  /** Values that make a simple `[ ]` / `[[ ]]` / `(( ))` test true and false. */
  private testExample(n: SyntaxNode, bracket: BracketTest | undefined): void {
    const kind = n.children[0].type as '[' | '[[' | '((';
    let shape: TestShape | undefined;
    if (kind === '[') {
      shape = bracketShape(bracket);
    } else if (n.namedChildren.length === 1) {
      const expr = n.namedChildren[0];
      if (expr.type === 'unary_expression') {
        // `[[ -f` while typing: no operand yet.
        const right = expr.namedChildren.find((c) => c.type !== 'test_operator');
        if (right) shape = { op: field(expr, 'operator')!.text, right };
      } else if (expr.type === 'binary_expression' && fields(expr, 'right').length === 1) {
        shape = { left: field(expr, 'left')!, op: field(expr, 'operator')!.text, right: field(expr, 'right')! };
      }
    }
    if (!shape) return;
    const operand = (x: SyntaxNode): Operand | undefined => {
      if (x.type === 'simple_expansion' || (x.type === 'expansion' && /^\$\{\w+\}$/.test(x.text))) return { var: x.text.replace(/^\$\{?|\}$/g, '') };
      if (x.type === 'variable_name') return { var: x.text };
      // The grammar reads the right side of `=`, `==` and `!=` as a pattern; `[ ]` compares it as text.
      if (x.type === 'extglob_pattern' && (kind === '[' || /^[\w.@%+:,/-]+$/.test(x.text))) return { lit: x.text };
      if (x.type === 'string' && x.namedChildren.length === 1 && x.namedChildren[0].type === 'simple_expansion' && x.text === `"${x.namedChildren[0].text}"`) return operand(x.namedChildren[0]);
      const lit = literalContent(x);
      return lit ? { lit: lit.text } : undefined;
    };
    const { left, op, right } = shape;
    const cases = left
      ? testCases(kind, op, operand(left), operand(right), right.type === 'string' || right.type === 'raw_string')
      : testCases(kind, op, undefined, operand(right));
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
      // A bug in bashPrintf: let it show.
      /* c8 ignore next */
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

  private ioExample(input: string[], output: string[], inPlace: boolean, spec: RerunSpec): void {
    const tabs = (lines: string[]) => lines.map(visible);
    this.examples.push({ kind: spec.kind === 'sed' || spec.kind === 'awk' || spec.kind === 'perl' ? spec.kind : 'textFilters',
      interactive: this.interactive(spec, input),
      title: inPlace ? this.s('例（ファイルの中身がこう書き換わる）', 'Example (the file is rewritten like this)') : this.s('例', 'Example'),
      sections: [
        { label: this.s('入力', 'Input'), lines: tabs(input) },
        { label: inPlace ? this.s('書き換え後', 'After') : this.s('出力', 'Output'), lines: tabs(output), empty: this.s('（出力なし）', '(no output)') },
      ],
    });
  }

  /** Regex dialect implied by the current command and its options. */
  private regexFlavor(): Flavor | 'fixed' {
    const ctx = this.argCtx!;
    const cmd = ctx.cmd.split('/').pop()!;
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
    // `set +f` is the opposite of `set -f`: it turns the option off again.
    const inv = (flag: string, what: string, value = false): string => {
      if (!disable) return what;
      const on = flag === '-f' || flag === 'noglob'
        ? this.s('グロブ（ワイルドカード展開）を再び有効にする', 'enable globbing (wildcard expansion) again')
        : flag === '-o' ? this.s('名前で指定したオプションを無効にする', 'disable an option by name')
          : this.s(`元に戻す（${value ? '' : `\`${flag}\` は「`}${what}${value ? '' : '」'}）`, `turn it off again (${value ? '' : `\`${flag}\` is "`}${what}${value ? '' : '"'})`);
      return value ? on : this.s(`\`${flag}\` を解除: ${on}`, `Undo \`${flag}\`: ${on}`);
    };

    const valueTok = (opt: OptDoc, flag: string, v: SyntaxNode): Token => {
      if (opt.lang) return this.positional(v, this.s(`\`${flag}\` オプションの値`, `Value for \`${flag}\``) + ': ' + this.t(opt.text), opt.lang);
      const known = opt.values?.[v.text];
      return this.tok(v, 'argument', known
        ? `${v.text}: ${inv(v.text, this.t(known), true)}`
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
          ? (whole.offsets ? { text: val, offsets: whole.offsets.slice(litEq + 1) } : { text: val, base: whole.base! + litEq + 1 })
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
      out.push(this.tok(a, 'option', opt ? inv(text, this.t(opt.text)) : unknown, []));
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
    // `set -eou pipefail`: in `set`, every `o` of a bundle takes the next word as its name and the other letters still apply (unlike `tar -fv`).
    const named: [string, OptDoc][] = [];
    for (let k = 0; k < letters.length; k++) {
      const flag = '-' + letters[k];
      const opt = opts[flag];
      const at = k + 1;
      if (opt?.arg && cmdName === 'set') {
        parts.push(sub(at, at + 1, 'option', inv(flag, this.t(opt.text)), flag));
        named.push([flag, opt]);
        continue;
      }
      if (!opt) { parts.push(sub(at, at + 1, 'option', unknown, flag)); continue; }
      parts.push(sub(at, at + 1, 'option', inv(flag, this.t(opt.text)), flag));
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
    for (const [flag, opt] of named) {
      if (last + 1 >= args.length) break;
      last++;
      parts.push(valueTok(opt, flag, args[last]));
    }
    const own = parts.filter((p) => p.span.start.line === row && p.span.end.character <= col + text.length);
    const tail = parts.filter((p) => !own.includes(p));
    {
      const flags = own.filter((p) => p.kind === 'option');
      // `-F,` / `-n5`: one option with its value attached is not a combination.
      out.push(this.tok(a, 'option', flags.length > 1
        ? this.s(`短いオプション ${flags.map((p) => `\`${p.label}\``).join(' ')} をまとめて指定`, `Combined short options ${flags.map((p) => `\`${p.label}\``).join(' ')}`)
        : flags[0].explanation, flags.length > 1 ? own : own.filter((p) => p.kind === 'argument')));
    }
    out.push(...tail);
    return last;
  }

  /** Words forming a command run by another command (sudo, xargs, find -exec…). */
  private wrapped(words: SyntaxNode[], prefix = ''): Token {
    const first = words[0];
    const name = first.text;
    const doc = customCommandDoc(this.opts.customCommands?.[name.split('/').pop()!]) ?? lookupCommand(name);
    const explanation = doc ? this.t(doc.summary) : this.s(`コマンド \`${name}\``, `Command \`${name}\``);
    const children = this.args(doc, words.slice(1), name);
    const span: Span = { start: spanOf(first).start, end: spanOf(words[words.length - 1]).end };
    return {
      kind: doc?.builtin ? 'builtin' : 'command',
      label: shorten(name),
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
    // A test over several lines is explained whole (see sub), so it is always where the line starts.
    const open = n.children[0].type;
    const bracket = open === '[' ? bracketTest(n) : undefined;
    this.testExample(n, bracket);
    const expl = open === '[['
      ? this.s('拡張条件式 `[[ ]]`: 条件を評価し、真なら成功(0)を返す（bash 専用。変数をクォートしなくても安全で、`&&` `||` `=~` が使える）',
        'Extended test `[[ ]]`: evaluates a condition (bash-only; safe without quoting, supports `&&`, `||`, `=~`)')
      : open === '(('
        ? this.arithTestExplanation() + this.commaNote(n)
        : this.s('条件式 `[ ]`: 条件を評価し、真なら成功(0)を返す（`test` コマンドと同じ。`[` の後と `]` の前には空白が必要）',
          'Test `[ ]`: evaluates a condition (same as `test`; spaces after `[` and before `]` are required)');
    const t = this.tok(n, 'test', expl, bracket ? this.testTokens(n, bracket, bracket.expr) : open === '((' ? this.arithChildren(n) : this.subs(n.namedChildren));
    t.summary = this.s(`条件判定 ${shorten(n.text, 40)}`, `test ${shorten(n.text, 40)}`);
    skeletal(t, n, true);
    // Includes examples from inside the test, such as the regex of `=~`.
    this.tagExamples(before, n);
    return t;
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
        // The grammar reads even a plain `a` after `=`, `==` and `!=` as a pattern; in `[ ]` any text is a word.
        const plain = (w: BracketWord) => (x: SyntaxNode) => isPlainWord(x) || (x.type === 'extglob_pattern' && w.nodes.length === 1);
        const num = this.numericTestNote(op, [slice(e.left, e.left), slice(e.right, e.right)], false);
        return [make('test', this.s(
          `条件: \`${slice(e.left, e.left)}\` と \`${slice(e.right, e.right)}\` を比較 — ${this.t(binaryTestOps[op])}${num}`,
          `Condition: \`${slice(e.left, e.left)}\` vs \`${slice(e.right, e.right)}\` — ${this.t(binaryTestOps[op])}${num}`,
        ), [...operandTokens(e.left, plain(words[e.left])), ...operandTokens(e.right, plain(words[e.right]))])];
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
    const tokens = explainRegex(n.text, 'ere', this.lang).map((t) => this.fromEmbedded(t, n, { text: n.text, base: 0 }));
    const js = toJsRegex(n.text, 'ere');
    if (js) this.regexExample(js, 'values');
    return this.tok(n, 'pattern', this.s('正規表現（拡張正規表現 ERE）', 'Regular expression (extended, ERE)'), tokens);
  }

  private inArithmetic(n: SyntaxNode): boolean {
    for (let p = n.parent; p; p = p.parent) {
      if (p.type === 'arithmetic_expansion' || p.type === 'c_style_for_statement') return true;
      if (p.type === 'arithmetic_command') return true;
      if (p.type === 'test_command' || p.type === 'extended_test' || p.type === 'compound_statement') return false;
    }
    // Unary and binary expressions are always inside a test or arithmetic.
    /* c8 ignore next */
    return false;
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
    if (op === '!' && !this.inArithmetic(n)) {
      return this.tok(n, 'test', this.s(`否定: \`${operand.text}\` が偽なら真`, `Negation: true if \`${operand.text}\` is false`), this.sub(operand));
    }
    const d = unaryTestOps[op];
    if (d && !this.inArithmetic(n)) {
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
    const plain = (x: SyntaxNode) => (isPlainWord(x) && !(this.inArithmetic(n) && this.arithNumber(x))) || (x.type === 'extglob_pattern' && rights.length === 1 && !hasGlob(x.text));
    // The grammar leaves some patterns as words (`*.txt`, `--?(a)b`, `-@(!(-*)e*|-edit)`); on the right of `==` in `[[ ]]` they are patterns all the same.
    const pattern = (x: SyntaxNode) => x.type === 'word' && ['=', '==', '!='].includes(op) && hasGlob(x.text) && !!ancestor(n, (a) => a.type === 'extended_test');
    const operands = sortTokens([
      ...this.subs([left, ...rights].filter((x) => x && !plain(x) && !pattern(x))),
      ...rights.filter(pattern).map((x) => this.globToken(x, 'value')),
    ]);
    // `[[ $x = *.txt ]]`: the values that match, as for a `case` pattern (a pattern with a quoted part is not tried).
    if (['=', '==', '!='].includes(op) && rights.length === 1 && (pattern(rights[0]) || (rights[0].type === 'extglob_pattern' && !plain(rights[0])))) {
      const before = this.examples.length;
      this.patternExample(rights, [this.s('一致する値', 'Values that match'), this.s('一致しない値', 'Values that do not match')]);
      this.anchorExamples(before, n);
    }
    if (!this.inArithmetic(n) && binaryTestOps[op]) {
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
   * "Concatenation": the parts are glued into one word, except around `"$@"` and `"${a[@]}"`, which are one word per element:
   * the text before them joins the first element, and the text after them the last.
   */
  private concatenationNote(n: SyntaxNode): string {
    const parts = n.namedChildren;
    const each = parts.findIndex((c) => c.type === 'string' && /^"(?:\$@|\$\{(?:!?[A-Za-z_]\w*\[@\]|@)[^}]*\})"$/.test(c.text));
    if (each < 0) return this.s('連結: 以下の部分を空白なしでつなげて1つの単語にする', 'Concatenation: the parts below are joined into one word');
    const text = (from: number, to: number): string => (from >= to ? '' : n.text.slice(parts[from].startIndex - n.startIndex, parts[to - 1].endIndex - n.startIndex));
    const before = text(0, each);
    const after = text(each + 1, parts.length);
    const glue = [
      before && this.s(`前の \`${before}\` は最初の要素の前に`, `\`${before}\` is glued to the start of the first element`),
      after && this.s(`後ろの \`${after}\` は最後の要素の後ろに`, `\`${after}\` is glued to the end of the last one`),
    ].filter(Boolean);
    return this.s(
      `連結: \`${parts[each].text}\` は要素ごとに別々の単語になるので、全体は1つの単語にならない。${glue.join('、')}くっつく（要素が無ければ前後が1つの単語になる）`,
      `Concatenation: \`${parts[each].text}\` gives one word per element, so this is not one word. ${glue.join(' and ')} (with no elements, the text around it makes one word)`);
  }

  /** Whether `name` is declared an associative array (`declare -A`) before `at`: its subscripts are strings, not arithmetic. */
  private isAssoc(name: string, at: number): boolean {
    const d = this.assocs.get(name);
    return d !== undefined && d < at;
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

  // ---------------------------------------------------------------- words & expansions

  /** `[7]=z` in `( )`: an element with an index of its own. */
  private arrayElement(n: SyntaxNode): Token {
    const e = splitElement(n.text)!;
    // The key as bash reads it once the quotes are removed (`["a b"]` is `a b`); as written when it holds an expansion.
    const key = unquoteWord(e.key) ?? e.key;
    const m = ['', key, e.plus, e.value];
    const assoc = this.isAssoc(field(n.parent!.parent!, 'name')!.text, n.startIndex);
    // The subscript of an associative array is a key (a string); that of an indexed array is arithmetic (`1+1` is 2).
    const v = evalArith(m[1]);
    const what = assoc ? this.s(`キー \`${m[1]}\`（文字列で、計算はされない）`, `key \`${m[1]}\` (a string, not evaluated)`)
      : v !== undefined && String(v) !== m[1] ? this.s(`添字 \`${m[1]}\`（算術式として計算すると ${v}）`, `index \`${m[1]}\` (an arithmetic expression: ${v})`)
      : this.s(`添字 \`${m[1]}\``, `index \`${m[1]}\``);
    return this.tok(n, 'argument', this.s(
      `${what}${what.endsWith('`') ? ' ' : ''}の要素に \`${m[3]}\` を${m[2] ? '追記' : '代入'}する`,
      `Element with ${what}: ${m[2] ? 'append' : 'set it to'} \`${m[3]}\``,
    ));
  }

  /**
   * Tilde expansion of an unquoted word that starts with `~` (`~`, `~/x`, `~user/x`, `~+`, `~-`).
   * Not `x~`, `--o=~` or a quoted `"~"` (those are not plain words starting with `~`).
   */
  private tilde(n: SyntaxNode): Token | undefined {
    const m = /^~([+-]|[A-Za-z_][\w.-]*)?(?=\/|$)/.exec(n.text);
    if (!m || !isPlainWord(n)) return undefined;
    const what = m[1] === '+' ? this.s('`~+` はカレントディレクトリ（`$PWD`）', '`~+` becomes the current directory (`$PWD`)')
      : m[1] === '-' ? this.s('`~-` は直前のディレクトリ（`$OLDPWD`）', '`~-` becomes the previous directory (`$OLDPWD`)')
      : m[1] ? this.s(`\`~${m[1]}\` はユーザー \`${m[1]}\` のホームディレクトリ（そのユーザーがいなければそのまま）`, `\`~${m[1]}\` becomes the home directory of the user \`${m[1]}\` (unchanged if there is no such user)`)
      : this.s('`~` はホームディレクトリ（`$HOME`）', '`~` becomes the home directory (`$HOME`)');
    return this.tok(n, 'expansion', this.s(`チルダ展開: ${what}に置き換わる`, `Tilde expansion: ${what}`) + (m[0].length < n.text.length ? this.s(`。残りの \`${n.text.slice(m[0].length)}\` はそのまま続く`, `. The rest, \`${n.text.slice(m[0].length)}\`, stays as it is`) : ''));
  }

  private word(n: SyntaxNode): Token {
    const text = n.text;
    const tilde = this.tilde(n);
    if (tilde) return tilde;
    if (hasGlob(text) && this.globOff(n)) return this.tok(n, 'argument', this.s(`文字列 \`${text}\``, `Word \`${text}\``) + this.noglobNote());
    if (hasGlob(text)) return this.tok(n, 'pattern', globIntro(this.lang, 'file') + this.globNotes(text), this.globChildren(n, text, 0));
    return this.tok(n, 'argument', this.s(`文字列 \`${text}\``, `Word \`${text}\``) + this.valueNote(n) + this.braceVarNote(text));
  }

  /** `{1..$n}`: braces are expanded before variables, so a range whose end is a variable is not a range. */
  private braceVarNote(text: string): string {
    const m = /\{[^{},]*\.\.[^{},]*\}/.exec(text);
    if (!m || !m[0].includes('$')) return '';
    if (this.argCtx?.cmd === 'eval') {
      return this.s(
        `。シェルは先に変数を置き換えるので、\`eval\` に渡る文字列は \`{1..3}\` のような形になり、\`eval\` がそれを読み直すときにはじめてブレース展開が連番になる`,
        `. The shell replaces the variable first, so \`eval\` gets a string like \`{1..3}\`, and only when \`eval\` reads it again is the brace expanded to a range`);
    }
    return this.s(
      `。\`${m[0]}\` は連番ではない: ブレース展開は変数の展開より先に行われるので、\`${m[0]}\` のまま変数だけが置き換わる（例: \`{1..3}\` という文字列）。連番にするには \`eval\` を使うか、\`seq\` や \`for ((…))\` を使う`,
      `. \`${m[0]}\` is not a range: braces are expanded before variables, so the text stays \`{…}\` with only the variable replaced (for example the string \`{1..3}\`). To get a range, use \`eval\`, \`seq\` or a \`for ((…))\` loop`);
  }

  /** The IFS in effect at `n` when the script assigns it a known value before (`IFS=-`): its text, and the line. */
  private ifsAt(n: SyntaxNode): { value: string; line: number } | undefined {
    const a = this.ifsAssigns.filter((x) => x.node.endIndex <= n.startIndex && (!x.scope || ancestor(n, (p) => p === x.scope))).pop();
    return a && { value: a.value, line: a.node.startPosition.row };
  }

  /** What the splitting of an unquoted expansion at `n` splits on. */
  private splitNote(n: SyntaxNode): string {
    const ifs = this.ifsAt(n);
    if (!ifs) return this.s('空白で分割され、グロブ展開もされる', 'it is word-split and globbed');
    if (ifs.value === '') return this.s(`\`IFS\` が空（行 ${ifs.line + 1}）なので単語分割はされないが、グロブ展開はされる`, `\`IFS\` is empty (line ${ifs.line + 1}), so it is not word-split, but it is globbed`);
    const noSpace = !/[ \t\n]/.test(ifs.value);
    return this.s(`\`IFS\`（行 ${ifs.line + 1} で \`${this.shown(ifs.value)}\` にしてある）の文字で分割され${noSpace ? '、空白では分割されない' : ''}。グロブ展開もされる`,
      `it is split on the characters of \`IFS\` (set to \`${this.shown(ifs.value)}\` on line ${ifs.line + 1})${noSpace ? ', not on spaces' : ''}, and globbed`);
  }

  /** The command string of `trap`: when its `$variables` are expanded depends on the quotes. */
  private trapNote(a: SyntaxNode): string {
    const vars = [...new Set(a.text.match(/\$\{?[A-Za-z_]\w*\}?|\$\(|`/g) ?? [])].map((v) => (v === '$(' || v === '`' ? '$(…)' : v));
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

  /** `$y` on an array is its element 0; `$_` after an assignment is empty; `$x` inside `$(( ))` is pasted as text. */
  private variableNote(n: SyntaxNode, name: string): string {
    const arr = this.arrays.get(name);
    if (arr && arr.index < n.startIndex) {
      const first = `\${${name}[0]}`;
      return this.s(`。\`${name}\` は配列なので、\`$${name}\` は${arr.assoc ? 'キー 0 の要素' : '先頭の要素'}だけ（\`${first}\`）になる。全要素は \`"\${${name}[@]}"\``, `. \`${name}\` is an array, so \`$${name}\` is only ${arr.assoc ? 'the element with key 0' : 'its first element'} (\`${first}\`); all of them are \`"\${${name}[@]}"\``);
    }
    if (name === '_' && this.afterAssignment(n)) {
      return this.s('。直前のコマンドは代入だけなので、`$_` は空になる', '. The command before is only an assignment, so `$_` is empty');
    }
    if (this.inArithmetic(n) && this.pastedValue(n, name) !== undefined) {
      const v = this.shown(this.pastedValue(n, name)!);
      return this.s(`。算術式の中の \`$${name}\` は、値（ここでは \`${v}\`）が文字のまま貼り付けられてから式として読まれる。\`${name}\` と名前だけで書くと、値が 1 つの式として計算されてから使われる（\`${name}='1+2'\` なら \`$${name}*2\` は \`1+2*2\` で 5、\`${name}*2\` は 3*2 で 6）`,
        `. Inside arithmetic, \`$${name}\` is pasted as text (here \`${v}\`) and then read as an expression. Written as the bare name \`${name}\`, its value is evaluated as one expression first (with \`${name}='1+2'\`, \`$${name}*2\` is \`1+2*2\`, which is 5, and \`${name}*2\` is 3*2, which is 6)`);
    }
    return '';
  }

  /** The text assigned to `name` by the last plain assignment before `n`, when it is not a plain integer (it has operators or names in it). */
  private pastedValue(n: SyntaxNode, name: string): string | undefined {
    let value: string | undefined;
    for (const a of descendants(this.rootNode, ['variable_assignment'])) {
      if (a.endIndex > n.startIndex || field(a, 'name')?.text !== name || a.parent?.type === 'declaration_command') continue;
      const v = field(a, 'value');
      value = v ? staticWordValue(v) : '';
    }
    return value !== undefined && !/^\s*[-+]?\d+\s*$/.test(value) ? value : undefined;
  }

  /** Whether the simple command before `n` is only an assignment (it sets `$_` to nothing). */
  private afterAssignment(n: SyntaxNode): boolean {
    let prev: SyntaxNode | undefined;
    for (const c of descendants(this.rootNode, ['command', 'variable_assignment', 'declaration_command'])) {
      if (c.endIndex > n.startIndex || (c.parent?.type === 'command' && c.type === 'variable_assignment')) continue;
      if (ancestor(c, (x) => ['command_substitution', 'process_substitution', 'subshell', 'function_definition'].includes(x.type))) continue;
      if (!prev || c.endIndex >= prev.endIndex) prev = c;
    }
    return !!prev && (prev.type === 'variable_assignment' || (prev.type === 'command' && !field(prev, 'name')?.text));
  }

  /** Whether file-name globbing is off where `n` is (after `set -f` and before any `set +f`). */
  private globOff(n: SyntaxNode): boolean {
    return this.noglob.filter((g) => g.end <= n.startIndex).pop()?.off ?? false;
  }

  /** What to say of a word with `*` or `?` while `set -f` is on: it stays as it is. */
  private noglobNote(): string {
    return this.s('。ただし `set -f`（`set -o noglob`）でグロブが無効になっているので、展開されずこの文字のまま渡される', '. But `set -f` (`set -o noglob`) has turned globbing off, so it is not expanded and stays as written');
  }

  /** How a value is shown in an explanation: control characters as pictures, a newline as `\n`. */
  private shown(v: string): string {
    return visible(v).replace(/\n/g, '\\n');
  }

  /**
   * What quote removal makes of a word (`h\i` is `hi`, `\$HOME` is the text `$HOME`), if it changes the text
   * and the result is known without running anything. Empty or unchanged: nothing to say.
   */
  private valueNote(n: SyntaxNode): string {
    const v = staticWordValue(n);
    if (!v || v === decodedText(n)) return '';
    const literal = v.includes('$');
    return this.s(
      `。クォートやバックスラッシュを取り除くと \`${this.shown(v)}\` という文字列になる${literal ? '（この `$` は変数展開の記号ではなく、ただの文字なので展開されない）' : ''}`,
      `. After quote removal it is the string \`${this.shown(v)}\`${literal ? ' (this `$` is plain text, not the start of an expansion, so nothing is expanded)' : ''}`,
    );
  }

  /** The `,` of an arithmetic expression: a note that its parts run left to right and the last one is the value. */
  private commaNote(n: SyntaxNode): string {
    if (!n.children.some((c) => c.type === ',')) return '';
    const last = n.namedChildren[n.namedChildren.length - 1].text;
    return n.type === 'arithmetic_command'
      ? this.s(`。\`,\` で区切られた式は左から順に評価され、結果は最後の式 \`${last}\` の値で決まる`, `. The expressions separated by \`,\` run from left to right, and the result is that of the last one, \`${last}\``)
      : this.s(`。\`,\` で区切られた式は左から順に評価され、全体の値は最後の式 \`${last}\` の値になる`, `. The expressions separated by \`,\` are evaluated from left to right, and the value is that of the last one, \`${last}\``);
  }

  /** `$((1<<63))`: bash's integers are 64-bit, and a result beyond them wraps around instead of failing. */
  private wrapNote(n: SyntaxNode): string {
    const r = evalArithWrapping(n.text.replace(/^\$(?:\(\(|\[)/, '').replace(/(?:\)\)|\])$/, ''));
    return r?.wrapped
      ? this.s(`。bash の整数は符号付き 64 ビットで、範囲を超えるとエラーにならず一周して戻るので、この値は ${r.value} になる`,
        `. Bash integers are signed 64-bit, and a result beyond that wraps around instead of failing, so this is ${r.value}`)
      : '';
  }

  /** The expressions of an arithmetic command or expansion, with its commas. */
  private arithChildren(n: SyntaxNode): Token[] {
    const commas = n.children.filter((c) => c.type === ',').map((c) => this.tok(c, 'operator', this.s('`,` コンマ演算子: 左の式を評価して値を捨て、右の式に進む', '`,` comma operator: evaluate the left expression, drop its value, go on to the right one')));
    return sortTokens([...this.subs(n.namedChildren), ...commas]);
  }

  /** A constant of an arithmetic expression that is not plain decimal (`0x1F`, `010`, `2#1010`), with its value; undefined for anything else. */
  private arithNumber(n: SyntaxNode): Token | undefined {
    const lit = arithLiteral(n.text);
    if (!lit || (lit.type === 'number' && lit.style === 'decimal') || !this.inArithmetic(n)) return undefined;
    return this.tok(n, 'number', this.arithLiteralText(n.text, lit));
  }

  private arithLiteralText(text: string, lit: ArithLiteral): string {
    return describeArithLiteral(text, lit, this.lang);
  }

  private string(n: SyntaxNode): Token {
    // `$"…"`: a `$` and a string, in the same node or beside each other.
    const dollar = sibling(n, -1);
    if (dollar?.type === '$' && dollar.endIndex === n.startIndex) {
      const t = this.tok(n, 'string', this.s('`$"…"` 文字列: ロケールに応じて翻訳される文字列（翻訳がなければそのまま。中の変数は展開される）', '`$"…"` string: translated according to the locale (as it is when there is no translation; variables inside expand)'), this.subs(n.namedChildren.filter((c) => c.type !== 'string_content')), shorten('$' + n.text));
      t.span = { start: spanOf(dollar).start, end: t.span.end };
      return t;
    }
    return this.tok(n, 'string', this.s(
      'ダブルクォート文字列: 中の `$変数` や `$(…)` は展開されるが、単語分割やグロブ展開はされない（1つの引数のまま）',
      'Double-quoted string: `$vars` and `$(…)` expand, but no word splitting or globbing (stays one argument)',
    ) + (/\\/.test(n.text) ? this.valueNote(n) : ''), this.subs(n.namedChildren.filter((c) => c.type !== 'string_content')));
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
      : this.s(`変数 \`${name}\` の値に置き換わる（クォートしないと${this.splitNote(n)}）`, `Expands to the value of \`${name}\` (unquoted, ${this.splitNote(n)})`));
    if (this.noSplit(n)) {
      t.explanation = d ?? this.s(`変数 \`${name}\` の値に置き換わる`, `Expands to the value of \`${name}\``);
    }
    t.explanation += this.orderNote(n, name) + this.variableNote(n, name);
    return t;
  }

  /**
   * `z=2 echo $z` expands `$z` before the assignment takes effect; `x=1 y=$x` sets `x` first. A note on a
   * use of a variable that an assignment of the same command sets.
   */
  private orderNote(n: SyntaxNode, name: string): string {
    const top = (parent: SyntaxNode) => { let c = n; while (c.parent && !same(c.parent, parent)) c = c.parent; return c; };
    const sets = (a: SyntaxNode) => a.type === 'variable_assignment' && field(a, 'name')?.text === name;
    const cmd = ancestor(n, (a) => a.type === 'command' || a.type === 'variable_assignments');
    if (!cmd) return '';
    const mine = top(cmd);
    if (cmd.type === 'variable_assignments') {
      return cmd.namedChildren.some((a) => sets(a) && a.endIndex <= mine.startIndex)
        ? this.s(`。同じ行で先に \`${name}=…\` と代入しているので、代入は左から順に実行され、ここではその値になる`, `. \`${name}=…\` comes earlier on this line, and assignments run from left to right, so it already has that value here`)
        : '';
    }
    // In the arguments (not in an assignment) of a command that is run with the variable set for it only.
    return field(cmd, 'name') && mine.type !== 'variable_assignment' && cmd.namedChildren.some((a) => sets(a) && a.endIndex <= field(cmd, 'name')!.startIndex)
      ? this.s(`。\`${name}=…\` はこのコマンドの実行中だけ有効で、引数の展開が先に行われるので、ここでは代入前の値（未設定なら空）になる`, `. \`${name}=…\` only applies while the command runs, and the arguments are expanded first, so this is the value from before the assignment (empty if unset)`)
      : '';
  }

  /** Contexts where an unquoted expansion is not word-split (quotes, `[[ ]]`, assignments, heredocs, case). */
  private noSplit(n: SyntaxNode): boolean {
    const p = n.parent!;
    if (['string', 'heredoc_body', 'variable_assignment', 'case_statement'].includes(p.type)) return true;
    for (let a: SyntaxNode | null = p; a; a = a.parent) {
      if (a.type === 'test_command') return false;
      if (a.type === 'extended_test' || a.type === 'arithmetic_command') return true;
      if (a.type === 'arithmetic_expansion') return true;
      if (a.type === 'command' || a.type === 'string') return false;
    }
    return false;
  }

  private subscript(n: SyntaxNode): Token {
    const name = field(n, 'name')!.text;
    const idx = field(n, 'index')!.text;
    if (idx === '@' || idx === '*') return this.tok(n, 'variable', this.s(`配列 \`${name}\` の全要素`, `All elements of array \`${name}\``));
    // The index is arithmetic (`a[0x1]` is element 1).
    const index = field(n, 'index')!;
    const num = this.arithNumber(index);
    if (this.isAssoc(name, n.startIndex)) return this.tok(n, 'variable', this.s(`連想配列 \`${name}\` のキー \`${idx}\`（文字列）の要素`, `Element of associative array \`${name}\` with the key \`${idx}\` (a string)`));
    return this.tok(n, 'variable', this.s(`配列 \`${name}\` の要素 \`[${idx}]\``, `Element \`[${idx}]\` of array \`${name}\``), num ? [num] : []);
  }

  /** `${…}`: the overall meaning plus a worked example, broken down into its parts. */
  private expansion(n: SyntaxNode): Token {
    // `${#a-b}` and `${#a[1]b}`: the length of a name takes no operator. The parser reads `$#` with an operator; bash says "bad substitution".
    const hash = n.children[1];
    const op = field(n, 'operator');
    if (n.type === 'expansion' && hash?.type === 'special_variable_name' && hash.text === '#' && op && /^[\w[]/.test(op.text)) {
      return this.tok(n, 'error', this.s('パラメータ展開: bash は「bad substitution」のエラーにする（`${#` の後ろに変数名を書いたら、演算子は付けられない）', 'Parameter expansion: bash reports "bad substitution" (a `${#name}` length takes no operator)'));
    }
    // `${(f)var}`: parameter flags are zsh's; bash reads `(f)var` as a name and says "bad substitution" (with zsh as the shell, the dialect check marks the line as not parsed).
    if (n.type === 'expansion' && n.text.startsWith('${(') && this.shell !== 'zsh') {
      return this.tok(n, 'error', this.s('パラメータ展開: bash は「bad substitution」のエラーにする（`${(` のパラメータフラグは zsh の書き方）', 'Parameter expansion: bash reports "bad substitution" (`${(f)var}` parameter flags are zsh syntax)'));
    }
    const summary = this.expansionSummary(n);
    const text = n.text;
    const parsed = n.startPosition.row === n.endPosition.row ? parseExpansion(text) : undefined;
    if (!parsed) return summary;
    summary.explanation += this.orderNote(n, parsed.name);
    const special = this.specialExpansion(parsed, text);
    if (special) {
      summary.explanation = special;
      if (!parsed.prefix && !parsed.op) summary.kind = 'variable';
    }
    const tf = parsed.op === '@' ? transformMeaning[parsed.parts.find((p) => p.role === 'transform')?.text ?? ''] : undefined;
    if (tf) summary.explanation = this.s(`パラメータ展開: \`${parsed.name}\` の値を${tf[0]}`, `Parameter expansion: take the value of \`${parsed.name}\` and ${tf[1]}`);
    else if (parsed.op === '@' && parsed.parts.some((p) => p.role === 'transform')) summary.explanation = this.s('パラメータ展開: bash は「bad substitution」のエラーにする（`@` の後ろの文字が変換の種類ではない）', 'Parameter expansion: bash reports "bad substitution" (the letter after `@` is not a transform)');
    if (parsed.op === ':') summary.explanation = this.s('パラメータ展開: ', 'Parameter expansion: ') + this.substringSummary(parsed);
    const cases = exampleFor(parsed, this.lang, { quoted: inDoubleQuotes(n), assoc: this.isAssoc(parsed.name, n.startIndex) });
    // A `${…}` on one line is always on the line explained.
    if (cases) {
      this.examples.push({ kind: 'expansion',
        title: this.s(`\`${text}\` の例`, `Example for \`${text}\``),
        // The title already names the expansion.
        target: '',
        anchor: summary.span,
        sections: cases.map((c) => ({ label: c.when, lines: c.result ? [c.result] : [], empty: this.s('（空文字）', '(empty string)') })),
      });
    }
    const row = n.startPosition.row;
    const col = n.startPosition.column;
    const mainOp = parsed.parts.find((p) => p.role === 'op');
    summary.children = parsed.parts.flatMap((part) => {
      const expl = this.expansionPart(parsed, part, part === mainOp, this.isAssoc(parsed.name, n.startIndex));
      if (!expl || !part.text) return [];
      const span: Span = { start: { line: row, character: col + part.start }, end: { line: row, character: col + part.end } };
      const nested = this.nestedIn(n, col + part.start, col + part.end);
      // The parts of a glob pattern (those with an expansion in them have only the expansions).
      const globbed = part.role === 'pattern' && !nested.length ? this.globChildren(n, part.text, part.start) : [];
      return [{ kind: expl[0], label: part.text, explanation: expl[1], span, children: [...nested, ...globbed] }];
    });
    return summary;
  }

  /** `${#}`, `${##}`, `${#@}`, `${#-x}`…: the special parameters with a `#` or an operator, which are easy to misread. Undefined for the other expansions. */
  private specialExpansion(p: ParsedExpansion, text: string): string | undefined {
    const shownName = `$${p.name}`;
    if (p.prefix === '#' && !p.subscript && (p.name === '@' || p.name === '*')) {
      return this.s(`位置パラメータの個数（\`$#\` と同じ。文字数ではない）`, 'Number of positional parameters (the same as `$#`, not a length in characters)');
    }
    if (p.prefix === '#' && !p.subscript && /^[#?$!0-]$/.test(p.name)) {
      return p.name === '#'
        ? this.s('`$#`（引数の個数）の文字数。引数が 10 個以上なら 2 になる', 'Length of `$#` (the number of arguments) in characters: 2 from ten arguments on')
        : this.s(`\`${shownName}\` の文字数（長さ）`, `Length of \`${shownName}\` in characters`);
    }
    if (p.prefix === '!' && p.name === '#' && !p.subscript && !p.op) {
      return this.s('間接参照: `$#`（引数の個数）を番号とみなし、その位置パラメータ、つまり最後の引数を取り出す（引数が 3 個なら `$3`）', 'Indirection through `$#`: the positional parameter numbered `$#` is the last argument (`$3` when there are 3)');
    }
    if (p.prefix || !/^[#?$!@*-]$/.test(p.name)) return undefined;
    if (!p.op) return `\`\${${p.name}}\`: ${this.varDesc(p.name)}`;
    const mainOp = p.parts.find((x) => x.role === 'op')!;
    // `${@:2}` and `${@@Q}` have their own wording.
    if (p.op === ':' || p.op === '@') return undefined;
    return this.s('パラメータ展開: ', 'Parameter expansion: ') + this.t(expansionOps[p.op](shownName, text.slice(mainOp.end, -1)));
  }

  private substringSummary(p: ParsedExpansion): string {
    const off = p.parts.find((x) => x.role === 'offset')!.text.trim();
    const len = p.parts.find((x) => x.role === 'length')?.text.trim();
    const name = p.name;
    const o = intValue(off);
    const l = len === undefined ? undefined : intValue(len);
    if (slicesElements(p)) {
      const args = p.name === '@' || p.name === '*';
      const what = args ? this.s('位置パラメータ', 'the positional parameters') : this.s(`配列 \`${name}\` の要素`, `the elements of array \`${name}\``);
      if (o !== undefined && o < 0) {
        const from = args ? this.s(`最後から ${-o} 番目`, `the ${-o === 1 ? 'last one' : `${ordinal(-o)} from the end`}`) : this.s(`最大のインデックス + 1 から ${-o} 戻った位置`, `${-o} before one past the highest index`);
        return this.s(`${what}を、${from}から${len === undefined ? '最後まで' : ` \`${len}\` 個`}取り出す`,
          `take ${len === undefined ? '' : `\`${len}\` of `}${what} starting at ${from}`);
      }
      return this.s(`${what}を、${args ? `\`$${off}\`` : `インデックス \`${off}\``} から${len === undefined ? '最後まで' : ` \`${len}\` 個`}取り出す`,
        `take ${len === undefined ? '' : `\`${len}\` of `}${what} from ${args ? `\`$${off}\`` : `index \`${off}\``}${len === undefined ? ' on' : ''}`);
    }
    if (o === undefined || (len !== undefined && l === undefined)) {
      return this.s(`\`${name}\` の部分文字列を取り出す（開始位置 \`${off}\`${len !== undefined ? `、長さ \`${len}\`` : ''}）`,
        `take a substring of \`${name}\` (offset \`${off}\`${len !== undefined ? `, length \`${len}\`` : ''})`);
    }
    const fromJa = o < 0 ? `末尾から ${-o} 文字目` : ` ${o + 1} 文字目`;
    const fromEn = o < 0 ? `${-o} ${plural(-o, 'character')} from the end` : `the ${ordinal(o + 1)} character`;
    if (l === undefined && o < 0) return this.s(`\`${name}\` の末尾 ${-o} 文字を取り出す`, `take the last ${-o} ${plural(-o, 'character')} of \`${name}\``);
    if (l === undefined) return this.s(`\`${name}\` の${fromJa}から最後までを取り出す`, `take \`${name}\` from ${fromEn} to the end`);
    if (l! < 0) return this.s(`\`${name}\` の${fromJa}から、末尾の ${-l!} 文字を除いた位置までを取り出す`, `take \`${name}\` from ${fromEn} up to ${-l!} ${plural(-l!, 'character')} before the end`);
    return this.s(`\`${name}\` の${fromJa}から ${l} 文字を取り出す`, `take ${l} ${plural(l!, 'character')} of \`${name}\` starting at ${fromEn}`);
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

  private expansionPart(p: ParsedExpansion, part: ExpansionPart, isMainOp: boolean, assoc = false): [Kind, string] | undefined {
    const t = part.text;
    const s = this.s.bind(this);
    switch (part.role) {
      case 'prefix':
        if (t === '#' && !p.subscript && (p.name === '@' || p.name === '*')) return ['operator', s('`#`: 位置パラメータの個数を返す', '`#`: gives the number of positional parameters')];
        if (t === '#') return ['operator', s('`#`: 値の長さ（文字数、配列なら要素数）を返す', '`#`: gives the length (characters, or elements for an array)')];
        if (p.op === '*' || p.op === '@') return ['operator', s('`!`: この名前で始まる変数名の一覧を返す', '`!`: lists variable names starting with this prefix')];
        if (p.subscript === '@' || p.subscript === '*') return ['operator', s('`!`: 配列の値ではなくインデックス（キー）を返す', '`!`: gives the indices (keys) instead of the values')];
        return ['operator', s('`!`: 間接参照。変数の値を別の変数名として使う', '`!`: indirection; use the value as another variable\'s name')];
      case 'name': {
        const d = this.varDesc(t);
        if (p.prefix === '!' && (p.op === '*' || p.op === '@')) return ['variable', s(`変数名の接頭辞 \`${t}\``, `Variable name prefix \`${t}\``)];
        if (p.subscript !== undefined) return ['variable', d ? s(`配列 \`${t}\`: ${d}`, `Array \`${t}\`: ${d}`) : s(`配列 \`${t}\``, `Array \`${t}\``)];
        return ['variable', d ? `\`$${t}\`: ${d}` : s(`変数 \`${t}\``, `Variable \`${t}\``)];
      }
      case 'subscript': {
        const idx = p.subscript!;
        if ((idx === '@' || idx === '*') && p.prefix) return ['variable', s(`\`[${idx}]\`: 配列のすべての要素を対象にする`, `\`[${idx}]\`: applies to every element of the array`)];
        if (idx === '@') return ['variable', s('`[@]`: すべての要素（`"${a[@]}"` とクォートすると各要素が別々の単語になる）', '`[@]`: every element (quoted, `"${a[@]}"` keeps each element a separate word)')];
        if (idx === '*') return ['variable', s('`[*]`: すべての要素（`"${a[*]}"` とクォートすると、`IFS` の先頭の文字で区切った1つの文字列に連結される）', '`[*]`: every element (quoted, `"${a[*]}"` joins them into one string, separated by the first character of `IFS`)')];
        if (p.name === 'BASH_REMATCH' && /^\d+$/.test(idx)) {
          return ['variable', idx === '0'
            ? s('インデックス 0: `=~` で一致した全体', 'Index 0: the whole text the `=~` matched')
            : s(`インデックス ${idx}: 正規表現の ${idx} 番目の括弧 \`( )\` に一致した部分`, `Index ${idx}: the text matched by group ${idx}, the ${ordinal(Number(idx))} \`( )\` of the regex`)];
        }
        if (assoc) return ['variable', s(`キー \`${idx}\`（連想配列のキーは文字列で、計算されない）`, `Key \`${idx}\` (the keys of an associative array are strings, not evaluated)`)];
        const i = evalArith(idx);
        if (i !== undefined) {
          // The index is an arithmetic expression: `1+1` is 2, `010` is 8.
          const calc = String(i) === idx ? '' : s(`（算術式として計算すると ${i}）`, ` (an arithmetic expression: ${i})`);
          return ['variable', i < 0
            ? s(`インデックス ${idx}${calc}: 末尾から ${-i} 番目の要素`, `Index ${idx}${calc}: ${i === -1 ? 'the last element' : `the ${ordinal(-i)} element from the end`}`)
            : s(`インデックス ${idx}${calc}: ${i + 1} 番目の要素（0 始まり）`, `Index ${idx}${calc}: the ${ordinal(i + 1)} element (0-based)`)];
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
        if (p.prefix === '!') return ['operator', t === '@' ? s('`@`: 見つかった名前を別々の単語にする（`"$@"` と同じ形。変換の `@` ではない）', '`@`: one word per name (like `"$@"`; not the `@` transform)') : s('`*`: 見つかった名前を1つにつなげる（クォート内では `IFS` の先頭の文字で区切る）', '`*`: join the names (inside double quotes, with the first character of `IFS`)')];
        return ['operator', `\`${t}\`: ` + opMeaning[t][this.lang === 'ja' ? 0 : 1]];
      case 'word': {
        const op = p.op!;
        if (op === ':-' || op === '-') return ['argument', s(`既定値 \`${t}\`: \`${p.name}\` の代わりに使う値`, `Default \`${t}\`: used instead of \`${p.name}\``)];
        if (op === ':=' || op === '=') return ['argument', s(`既定値 \`${t}\`: \`${p.name}\` に代入されてから使われる`, `Default \`${t}\`: assigned to \`${p.name}\`, then used`)];
        if (op === ':+' || op === '+') return ['argument', s(`代替値 \`${t}\`: \`${p.name}\` が設定されているときに代わりに使う値`, `Alternate value \`${t}\`: used when \`${p.name}\` is set`)];
        return ['string', s(`エラーメッセージ「${t}」`, `Error message "${t}"`)];
      }
      case 'pattern': {
        const glob = globParts(t);
        const casePat = /^[\^,~]/.test(p.op!);
        const what = casePat ? s('変換する文字のパターン', 'Pattern of characters to convert') : s('パターン', 'Pattern');
        // The pattern is matched against one character at a time.
        const only = casePat ? (p.op!.length === 2
          ? s('。文字を1つずつ調べ、一致した文字だけが変換される', '. Each character is tried on its own; only those that match are converted')
          : s('。先頭の1文字がこれに一致したときだけ変換される', '. The first character is converted only if it matches')) : '';
        if (!glob) {
          // An extended glob (`+(a)`, `@(a|x)`) is a pattern of its own; only `$…` and backquotes are decided at run time.
          if (!/\$|`/.test(t)) return ['pattern', `${what} \`${t}\`: ${globIntro(this.lang, 'value')}` + s('。拡張グロブは `shopt -s extglob` が必要で、これがないと文字どおりの文字列として扱われる', '. An extended glob needs `shopt -s extglob`, or it is taken as literal text') + only]
          return ['pattern', s(`${what} \`${t}\`（変数などを含むため、内容は実行時に決まる）`, `${what} \`${t}\` (contains expansions, so it is decided at run time)`)];
        }
        return ['pattern', hasGlob(t) ? `${what} \`${t}\`: ${globIntro(this.lang, 'value')}${only}` : s(`${what} \`${t}\`（ワイルドカードを含まないので、この文字列そのものに一致）${only}`, `${what} \`${t}\` (no wildcards, so it matches exactly this text)${only}`)];
      }
      case 'replacement': {
        // The quotes and backslashes are removed: `\}` is `}`.
        const shown = unquoteWord(t) ?? t;
        return ['string', t
          ? s(`置換後の文字列 \`${shown}\``, `Replacement \`${shown}\``)
          : s('置換後の文字列: 空（一致した部分を削除する）', 'Replacement: empty (the match is deleted)')];
      }
      case 'offset': {
        const v = t.trim();
        const num = intValue(v);
        if (slicesElements(p)) {
          const args = p.name === '@' || p.name === '*';
          if (num !== undefined && num < 0) {
            return ['number', args
              ? s(`開始位置 ${v}: 最後から ${-num} 番目の引数から（負の値は最後から数える。\`$${v}\` という引数ではない）`, `Offset ${v}: from the ${-num === 1 ? 'last argument' : `${ordinal(-num)} argument from the end`} (a negative value counts from the end; it is not \`$${v}\`)`)
              : s(`開始位置 ${v}: 最大のインデックス + 1 から ${-num} 戻った位置の要素から（要素数ではなくインデックスで数えるので、歯抜けの配列では最後から ${-num} 番目とは限らない）`, `Offset ${v}: from the element ${-num} before one past the highest index (counted by index, not by number of elements, so on a sparse array it is not always the ${ordinal(-num)} from the end)`)];
          }
          return ['number', args
            ? s(`開始位置 ${v}: \`$${v}\` から（\`0\` なら \`$0\`）`, `Offset ${v}: from \`$${v}\` (\`0\` is \`$0\`)`)
            : s(`開始位置 ${v}: インデックス ${v} の要素から`, `Offset ${v}: from the element at index ${v}`)];
        }
        if (num === undefined) {
          // The `:` of a ternary is not the one before the length.
          const ternary = v.includes('?') ? s('。`?` とペアの `:` は三項演算子の一部で、長さの区切りではない', '. The `:` that pairs with the `?` belongs to the ternary; it does not start the length') : '';
          return ['number', s(`開始位置 \`${v}\`（算術式として評価される）${ternary}`, `Offset \`${v}\` (evaluated as arithmetic)${ternary}`)];
        }
        const o = num;
        if (o < 0) {
          return ['number', s(
            `開始位置 ${o}: 末尾から ${-o} 文字目から（負の値は \`:-\` と区別するため、前に空白か括弧が必要）`,
            `Offset ${o}: start ${-o} characters from the end (a space or parentheses is needed before a negative value, to tell it from \`:-\`)`)];
        }
        return ['number', s(`開始位置 ${o}: ${o + 1} 文字目から（0 始まり）`, `Offset ${o}: start at the ${ordinal(o + 1)} character (0-based)`)];
      }
      case 'length': {
        const v = t.trim();
        const l = intValue(v);
        if (slicesElements(p)) return ['number', s(`長さ ${v}: ${v} 個の要素（負の値はエラー）`, `Length ${v}: ${v} ${v === '1' ? 'element' : 'elements'} (a negative value is an error)`)];
        if (l === undefined) return ['number', s(`長さ \`${v}\`（算術式として評価される）`, `Length \`${v}\` (evaluated as arithmetic)`)];
        return ['number', l < 0
          ? s(`長さ ${l}: 末尾の ${-l} 文字を除いた位置まで`, `Length ${l}: up to ${-l} ${plural(-l, 'character')} before the end`)
          : s(`長さ ${l}: ${l} 文字分`, `Length ${l}: ${l} ${plural(l, 'character')}`)];
      }
      // `transform`
      default: {
        const m = transformMeaning[t];
        // Any letter can come after `@`; bash reports the ones it does not have as a bad substitution.
        if (!m) return ['error', this.s(`\`${t}\`: bash にない変換（bad substitution になる）`, `\`${t}\`: not a transform bash has (bash reports "bad substitution")`)];
        return ['operator', `\`${t}\`: ${m[this.lang === 'ja' ? 0 : 1]}`];
      }
    }
  }

  private expansionSummary(n: SyntaxNode): Token {
    const kids = n.children;
    const inner = n.text.slice(2, -1);
    const target = kids.find((c) => ['variable_name', 'subscript', 'special_variable_name'].includes(c.type));
    const targetText = target?.text ?? inner;
    const isArrayAll = target?.type === 'subscript' && /\[[@*]\]$/.test(targetText);
    const prefixOp = kids[1] && !kids[1].named ? kids[1].type : '';

    if (prefixOp === '#' && target) {
      return this.tok(n, 'expansion', isArrayAll
        ? this.s(`配列 \`${targetText.replace(/\[.*/, '')}\` の要素数`, `Number of elements in array \`${targetText.replace(/\[.*/, '')}\``)
          + (targetText.startsWith('BASH_REMATCH[') ? this.s('（正規表現の括弧のグループの数 + 1。要素 0 が一致した全体）', ' (the number of groups in the regex + 1: element 0 is the whole match)') : '')
        : this.s(`変数 \`${targetText}\` の文字数（長さ）`, `Length of \`${targetText}\` in characters`));
    }
    // `${!prefix@}` / `${!prefix*}`: the names of the variables that start with the prefix (no indirection, no transform).
    const names = prefixOp === '!' ? /^!([A-Za-z_][A-Za-z0-9_]*)([@*])$/.exec(inner) : null;
    if (names) {
      const [, pre, sign] = names;
      const form = sign === '@'
        ? this.s('各名前が別々の単語になる（ダブルクォートの中でも別々）', 'each name is a separate word, also inside double quotes')
        : inDoubleQuotes(n)
          ? this.s('ダブルクォートの中なので、`IFS` の先頭の文字で区切った1つの単語になる', 'inside double quotes they form one word, joined with the first character of `IFS`')
          : this.s('クォートすると、`IFS` の先頭の文字で区切った1つの単語になる（クォートなしなら別々の単語）', 'quoted, they form one word joined with the first character of `IFS` (unquoted they are separate words)');
      return this.tok(n, 'expansion', this.s(`変数名の一覧: \`${pre}\` で始まる名前の変数をすべて挙げる（\`${pre}\` という変数の値は使わない）。${form}`,
        `Names of all variables starting with \`${pre}\` (the value of a variable \`${pre}\` is not used); ${form}`));
    }
    // `${!x@Q}`: indirection first, then the transform of the value found.
    const indirectTransform = prefixOp === '!' ? /^!([A-Za-z_][A-Za-z0-9_]*)@([QEPAKaULuk])$/.exec(inner) : null;
    if (indirectTransform) {
      const [, v, letter] = indirectTransform;
      const tf = transformMeaning[letter];
      return this.tok(n, 'expansion', this.s(`間接参照: 変数 \`${v}\` の値を変数名とみなし、その変数の値を${tf[0]}`,
        `Indirection: use the value of \`${v}\` as a variable name, then take that variable's value and ${tf[1]}`));
    }
    if (prefixOp === '!' && target) {
      return this.tok(n, 'expansion', isArrayAll
        ? this.s(`配列 \`${targetText.replace(/\[.*/, '')}\` のインデックス（キー）一覧`, `Indices (keys) of array \`${targetText.replace(/\[.*/, '')}\``)
        : this.s(`間接参照: 変数 \`${targetText}\` の値を変数名とみなし、その変数の値を取り出す`, `Indirection: use the value of \`${targetText}\` as a variable name`));
    }

    const opIdx = kids.findIndex((c, i) => i > 0 && c.field === 'operator');
    const base = target?.type === 'subscript' ? this.t(isArrayAll
      ? { ja: `配列 \`${targetText.replace(/\[.*/, '')}\` の全要素`, en: `all elements of array \`${targetText.replace(/\[.*/, '')}\`` }
      : { ja: `配列要素 \`${targetText}\``, en: `array element \`${targetText}\`` }) : undefined;
    if (opIdx > 0) {
      const op = kids[opIdx].type;
      const close = kids[kids.length - 1];
      // The grammar closes every `${` with `}`.
      const arg = n.text.slice(kids[opIdx].endIndex - n.startIndex, close.startIndex - n.startIndex);
      const make = expansionOps[op];
      if (arg === '' && (op === ':-' || op === '-')) {
        return this.tok(n, 'expansion', this.s(
          `パラメータ展開: \`${targetText}\` が未設定なら空文字として扱う（\`set -u\` でもエラーにしないための定番）`,
          `Parameter expansion: empty string if \`${targetText}\` is unset (avoids errors under \`set -u\`)`,
        ));
      }
      if (make) {
        const argNodes = kids.slice(opIdx + 1).filter((c) => c.named && !isPlainWord(c) && c.type !== 'regex');
        // Positional parameters read better as `$2` than as a bare `2`.
        const shownName = /^[1-9]\d*$/.test(targetText) ? `$${targetText}` : targetText;
        return this.tok(n, 'expansion', this.s('パラメータ展開: ', 'Parameter expansion: ') + this.t(make(shownName, arg)), this.subs(argNodes));
      }
    }
    const d = base ?? this.varDesc(targetText);
    const note = base ? '' : this.variableNote(n, targetText);
    return this.tok(n, 'variable', d
      ? this.s(`\`\${${targetText}}\`: ${d}${note}`, `\`\${${targetText}}\`: ${d}${note}`)
      : this.s(`変数 \`${targetText}\` の値に置き換わる（\`{}\` は変数名の範囲を明示する）${note}`, `Value of \`${targetText}\` (braces delimit the name)${note}`));
  }

  private commandSubstitution(n: SyntaxNode): Token {
    const backtick = n.children[0].type === '`';
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

interface CommandHead { name: string; doc?: CommandDoc; kind: Kind; explanation: string; nameTokens: Token[]; /** A call of a function defined in the script. */ fn?: boolean }

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
/** A word `[` receives: the nodes that make it up (a pattern with a quoted part is several), and its text, null if it depends on an expansion. */
interface BracketWord { nodes: SyntaxNode[]; text: string | null }
interface BracketTest { words: BracketWord[]; expr: TestExpr }
interface TestShape { left?: SyntaxNode; op: string; right: SyntaxNode }

/**
 * Reads a `[ ]` as bash does, from its words alone: the grammar cannot tell the unary `-a file` / `-o option` from AND / OR,
 * so its groups are wrong with them. Undefined when bash would report an error (the tree is then used as it is).
 */
function bracketTest(n: SyntaxNode): BracketTest | undefined {
  // After the `[`, and before the `]` unless the test is not closed.
  const leaves = n.children.slice(1);
  if (leaves[leaves.length - 1]?.type === ']') leaves.pop();
  const words: BracketWord[] = [];
  for (const x of leaves) {
    const last = words[words.length - 1];
    if (last && last.nodes[last.nodes.length - 1].endIndex === x.startIndex) last.nodes.push(x);
    else words.push({ nodes: [x], text: null });
  }
  for (const w of words) {
    // `\(` and `\)` are the parentheses of a group: after quote removal they are `(` and `)`.
    const parts = w.nodes.map((x) => (x.type === 'number' || x.type === 'extglob_pattern' ? x.text : x.text === '\\(' || x.text === '\\)' ? x.text[1] : literalContent(x)?.text));
    w.text = parts.every((t) => t !== undefined) ? parts.join('') : null;
  }
  const expr = parseTest(words.map((w) => w.text));
  return expr && { words, expr };
}

/** The operator and the operands of a `[ ]` that is a single comparison or unary test of one-node words. */
function bracketShape(b: BracketTest | undefined): TestShape | undefined {
  const e = b?.expr;
  if (e?.type === 'unary' && b!.words[e.arg].nodes.length === 1) return { op: b!.words[e.op].text!, right: b!.words[e.arg].nodes[0] };
  if (e?.type === 'binary' && b!.words[e.left].nodes.length === 1 && b!.words[e.right].nodes.length === 1) {
    return { left: b!.words[e.left].nodes[0], op: b!.words[e.op].text!, right: b!.words[e.right].nodes[0] };
  }
  return undefined;
}

function literalContent(a: SyntaxNode, lang?: EmbeddedLang): Literal | undefined {
  if (a.type === 'raw_string') return { text: a.text.slice(1, -1), base: 1 };
  // `echo -e "\e[1m"`: the shell keeps a backslash before any character but `$`, a backtick, `"` and `\`.
  if (lang === 'echo') {
    return a.type === 'string' && a.namedChildren.every((c) => c.type === 'string_content') && !/[$`]|\\[\\"\n]/.test(a.text) ? { text: a.text.slice(1, -1), base: 1 } : undefined;
  }
  if (a.type === 'string' && a.namedChildren.every((c) => c.type === 'string_content') && !/[\\$`]/.test(a.text)) {
    return { text: a.text.slice(1, -1), base: 1 };
  }
  if (isPlainWord(a) && !/[\\'"$`]/.test(a.text)) return { text: a.text, base: 0 };
  // `$"…"` is a double-quoted string (a translation, when the locale has one for it).
  if (a.type === 'translated_string' && a.namedChildren.length === 1) {
    const inner = literalContent(a.namedChildren[0]);
    return inner && !inner.offsets ? { text: inner.text, base: inner.base! + 1 } : undefined;
  }
  if (a.type === 'concatenation' && a.startPosition.row === a.endPosition.row) {
    let text = '';
    const offsets: number[] = [];
    for (const c of a.namedChildren) {
      const lit = literalContent(c);
      if (!lit || lit.offsets) return undefined;
      const at = c.startIndex - a.startIndex + lit.base!;
      for (let k = 0; k < lit.text.length; k++) offsets.push(at + k);
      text += lit.text;
    }
    return { text, offsets };
  }
  return undefined;
}

/** Whether `echo` reads backslash escapes: its last `-e` or `-E` among the leading options decides. */
function echoEscapes(args: SyntaxNode[]): boolean {
  let on = false;
  for (const a of args) {
    if (!isPlainWord(a) || !/^-[neE]+$/.test(a.text)) break;
    for (const ch of a.text) if (ch === 'e' || ch === 'E') on = ch === 'e';
  }
  return on;
}

/** Position in the node's source of character `offset` of a literal (an end offset maps past the previous character). */
function sourceIndex(lit: Literal, offset: number, isEnd: boolean): number {
  // A literal has a base or offsets, one for each character (tokens lie within its text).
  if (!lit.offsets) return lit.base! + offset;
  if (isEnd) return lit.offsets[offset - 1] + 1;
  return lit.offsets[offset];
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
    if (script[i] === '\\') { pat += script[i] + script[i + 1]; i++; continue; }
    pat += script[i];
  }
  const flags = /^[^;\n]*$/.test(script) ? script.split(delim).pop()! : '';
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

/**
 * Every renderer shows a token's label beside its explanation, so an explanation that opens with the label
 * quoted (`` `%s`: value 1 as a string ``) says it twice: remove that opening. The text stays when it only
 * mentions the label in a sentence. Done on the finished tree, since the same texts stand alone elsewhere
 * (notes, summaries, examples).
 */
function dropLabelEcho(t: Token): void {
  const label = t.label.trim();
  const e = t.explanation;
  if (e.startsWith('`' + label + '`')) {
    const rest = e.slice(label.length + 2);
    const m = /^(?::\s+|：\s*)(?=\S)/.exec(rest);
    if (m) t.explanation = rest.slice(m[0].length);
  }
  for (const c of t.children) dropLabelEcho(c);
}

/** Gives `t` the skeleton of `n` as its label; with `onlyIfCut`, only when it has a placeholder (else the label is the text). */
function skeletal(t: Token, n: SyntaxNode, onlyIfCut = false): Token {
  const parts = skeleton(n);
  if (onlyIfCut && !parts.some((p) => p.placeholder)) return t;
  t.labelParts = parts;
  t.label = labelText(parts);
  return t;
}

export function summaryOf(t: Token): string {
  return t.summary ?? t.explanation;
}

/** What `redirectLayout` found: the redirections in source order, and the range and text of the command's words. */
interface Layout { redirs: SyntaxNode[]; span: Span; text: string }

function sortNodes(ns: SyntaxNode[]): SyntaxNode[] {
  return ns.sort((a, b) => a.startIndex - b.startIndex);
}

function sortTokens(ts: Token[]): Token[] {
  return ts.sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.character - b.span.start.character);
}

/** Whether an ancestor of `n` satisfies `test`. */
/**
 * The text bash reads before it runs anything of `n`: the top-level command that holds it, together
 * with the others that start on the line it ends on (`a; b` is read as one).
 */
function unitOf(n: SyntaxNode): { start: number; end: number } {
  let top = n;
  while (top.parent?.parent) top = top.parent;
  const all = top.parent!.namedChildren;
  let i = all.findIndex((x) => x.startIndex === top.startIndex && x.endIndex === top.endIndex);
  /* c8 ignore next -- a top-level node is always among its parent's children */
  if (i < 0) i = 0;
  let a = i;
  let b = i;
  while (a > 0 && all[a - 1].endPosition.row === all[a].startPosition.row) a--;
  while (b + 1 < all.length && all[b + 1].startPosition.row === all[b].endPosition.row) b++;
  return { start: all[a].startIndex, end: all[b].endIndex };
}

function ancestorOf(n: SyntaxNode, test: (a: SyntaxNode) => boolean): boolean {
  for (let a = n.parent; a; a = a.parent) if (test(a)) return true;
  return false;
}

/** The operator and destination of a file redirection (`>&-` and `<&-`, which close a descriptor, are `>&` and `<&` to `-`). */
function redirectParts(n: SyntaxNode): { op: string; dest: string } {
  const op = n.children.find((c) => !c.named)!.type;
  return { op, dest: fields(n, 'destination').map((d) => d.text).join(' ') };
}
