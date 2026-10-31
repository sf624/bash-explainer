// "In short": one sentence for each line with code (docs/design/panel-redesign.md, P5), at the top of the panel's
// Meaning view (`LineExplanation.sentence`). It is composed, not looked up: from the tree (a list, a pipeline, a loop,
// a condition, the words that open and close a block), from what each command is and does (`CommandSaid`, recorded by
// src/explain/commands.ts with the summary its token shows, and the options given), from the words bash gives
// (src/argvline.ts: the value an assignment gives, a redirection's target, a loop's words, with P4's placeholders for
// what is known only at run time), and from the status model (a pipeline's status, what `set -e` does when the
// statement fails). The shapes with a sentence of their own are idioms (src/idioms.ts, `idiomSaid`). The texts are in
// src/messages-sentence.ts.
//
// Its rules: it never states a fact a problem of the line states (a clause about a section of the manual a problem of
// the line cites is left out: `SentenceInput.problems`); no code span in it holds more than one shell word of the line
// (it names commands by their names and words by what they give, never a stretch of the line); and it is never what a
// row of the line says alone. test/linesentence.test.ts checks them over the corpus.
import type { ArgvWord, LineExplanation } from './analyzer-types';
import { argvWords } from './argvline';
import { redirects } from './dict/syntax';
import type { CommandSaid } from './explain/commands';
import { effEndRow, intersects, isBlockLike } from './explain/nodes';
import { redirectParts } from './explain/redirections';
import type { Lang } from './i18n';
import { idiomSaid, type IdiomSpeaker } from './idioms';
import { codeSpan, shorten } from './label';
import { isProblem } from './messages';
import { placeholderSaid } from './messages-argv';
import { STYLE_REFS, type StyleCode } from './pitfalls';
import { EMPTY, ioSaid, type IoKind, linesSaid, listSaid, NOTHING, S, sentenceEnd } from './messages-sentence';
import { STATEMENTS } from './semantics/env';
import { attribute, docLine } from './semantics/state';
import { CHANGING } from './semantics/walk/temporaries';
import type { StatusModel } from './semantics/status';
import { field, fields, prefixAssignments, redirectionsOf, type SyntaxNode } from './syntax/tree';
import { writtenAsBracket } from './testexpr';

export interface SentenceInput {
  root: SyntaxNode;
  line: number;
  lang: Lang;
  status: StatusModel;
  /** What each simple command explained on the line is (src/explain/commands.ts). */
  commands: ReadonlyMap<SyntaxNode, CommandSaid>;
  /** The sections of the manual the problems of the line cite: a clause about one of them is left out. */
  problems: ReadonlySet<string>;
}

/** The sentence, and the sections of the manual its clauses on the models are about (for the tests of the rules). */
export interface Sentence { text: string; sections: string[] }

/**
 * The sections of the manual the problems of a line cite (a fact's `refs`, a style check's `STYLE_REFS`): the sentence
 * says nothing about them, since the problem says it, in the box (a plain note is no problem: `isProblem`).
 */
export function problemSections(ex: Pick<LineExplanation, 'noteInfo' | 'facts'>): Set<string> {
  const out = new Set<string>();
  for (const n of ex.noteInfo) {
    if (n.level === 'note' || !isProblem(n.code!)) continue;
    for (const r of ex.facts?.find((f) => f.text === n.text)?.refs ?? STYLE_REFS[n.code as StyleCode] ?? []) out.add(r);
  }
  return out;
}

/** How long (without the backticks) a sentence may be with what each command does; a longer one names the commands only. */
const FULL = { en: 180, ja: 110 };
/** `[` and its words, as the sentence names a test (`CommandSaid.test`: the command `[`, closed by `]`). */
const BRACKET = '`[ … ]`';
/** How many items a list names; more are cut with `…`. */
const ITEMS = 4;

/** The sentence of `line`, or none when the line has no code (a comment, a blank line, code bash cannot read). */
export function lineSentence(input: SentenceInput): Sentence | undefined {
  const pieces = piecesOn(input.root, input.line);
  if (!pieces.length) return undefined;
  let said!: Sentence;
  for (const brief of [0, 1, 2] as const) {
    const c = new Composer(input, brief);
    said = { text: sentenceEnd(input.lang, pieces.flatMap((p, i) => c.piece(p, i))), sections: [...c.sections] };
    // (The facts of the models are said whatever the length: the budget is for what the commands do.)
    if (said.text.replace(/`/g, '').length - c.factsLength <= FULL[input.lang]) break;
  }
  return said;
}

/** How much a sentence says of each command: what it does and the options given (0), what it does (1), its name (2). */
type Brief = 0 | 1 | 2;

/**
 * A part of the line the sentence says: a statement on it (or one over several lines, which the line is part of), the
 * head of a block that goes on below (`open`), the word that ends a block (`close`, with the redirections written after
 * it), or a word that goes on with a block (`inside`: `then`, `do` on a line of their own).
 */
type Piece = { kind: 'whole' | 'open' | 'inside'; node: SyntaxNode } | { kind: 'close'; node: SyntaxNode; redirects: SyntaxNode[] };

/** The statements a body holds, as the sentence says them: those of bash, and the clauses of `if` and `case`. */
const PARTS = new Set([...STATEMENTS, 'case_item', 'elif_clause', 'else_clause', 'do_group']);
/** Nodes that only hold statements: the sentence says each. */
const WRAPPERS = new Set(['program', 'list', 'pipeline', 'negated_command', 'time_statement']);
/** Blocks whose first line opens them, and whose last line closes them with a word of their own. */
const OPENS = new Set(['if_statement', 'elif_clause', 'else_clause', 'while_statement', 'for_statement', 'c_style_for_statement', 'select_statement', 'case_statement', 'case_item', 'function_definition', 'compound_statement', 'subshell']);
const CLOSES = new Set(['if_statement', 'while_statement', 'for_statement', 'c_style_for_statement', 'select_statement', 'case_statement', 'case_item', 'function_definition', 'compound_statement', 'subshell']);
/** The body of a function: the function opens and closes it. */
const ownBody = (n: SyntaxNode): boolean => n.parent!.type === 'function_definition';

/** The statements of a block's head (the condition of `if`, `elif`, `while` and `until`), which its first line says. */
function headOf(n: SyntaxNode): SyntaxNode[] {
  if (n.type !== 'elif_clause') return fields(n, 'condition').filter((c) => PARTS.has(c.type));
  const then = n.children.findIndex((c) => c.type === 'then');
  return n.namedChildren.filter((c) => PARTS.has(c.type) && n.children.indexOf(c) < then);
}

/** The statements of a block's body (a loop's or a function's are those of its own block). */
function bodyOf(n: SyntaxNode): SyntaxNode[] {
  const head = headOf(n);
  const kids = n.namedChildren.filter((c) => PARTS.has(c.type) && !head.includes(c) && c.type !== 'elif_clause' && c.type !== 'else_clause');
  return kids.length === 1 && (kids[0].type === 'do_group' || ownBody(kids[0])) ? bodyOf(kids[0]) : kids;
}

function piecesOn(root: SyntaxNode, line: number): Piece[] {
  const out: Piece[] = [];
  let innermost: SyntaxNode | undefined;
  const visit = (n: SyntaxNode, redirs: SyntaxNode[]): void => {
    if (!intersects(n, line) || !(PARTS.has(n.type) || WRAPPERS.has(n.type))) return;
    // (A test or an arithmetic command over several lines is one statement.)
    if (n.type !== 'program' && (!isBlockLike(n) || n.type === 'arithmetic_command')) {
      out.push({ kind: 'whole', node: n });
      return;
    }
    if (n.type === 'redirected_statement') return visit(field(n, 'body')!, redirectionsOf(n));
    if (WRAPPERS.has(n.type)) return n.namedChildren.forEach((c) => visit(c, []));
    innermost = n;
    const own = OPENS.has(n.type) && !ownBody(n);
    if (own && n.startPosition.row === line) out.push({ kind: 'open', node: n });
    const before = out.length;
    const head = headOf(n);
    n.namedChildren.filter((c) => !head.includes(c)).forEach((c) => visit(c, []));
    // (A branch of `case` ends with `;;` on a line of its own, or after its last command: that one says the command.)
    const alone = n.type !== 'case_item' || out.length === before;
    if (own && CLOSES.has(n.type) && alone && effEndRow(n) === line && n.startPosition.row !== line) out.push({ kind: 'close', node: n, redirects: redirs });
  };
  visit(root, []);
  // (A word that goes on with a block, alone on its line; a comment there is no code.)
  if (!out.length && innermost && tokenOf(innermost, line)) out.push({ kind: 'inside', node: innermost });
  return out;
}

/** The first token of `n` on `line` (`then`, `do`), or its last token (the closing word). */
function tokenOf(n: SyntaxNode, line?: number): SyntaxNode | undefined {
  if (line === undefined) {
    let c = n;
    while (c.children.length) c = c.children[c.children.length - 1];
    return c;
  }
  if (!n.children.length) return n.startPosition.row === line && n.type !== 'comment' ? n : undefined;
  for (const c of n.children) {
    const t = intersects(c, line) || c.startPosition.row === line ? tokenOf(c, line) : undefined;
    if (t) return t;
  }
  return undefined;
}

/** The kind of construct a block is, as its closing word names it. */
type ConstructKind = Parameters<typeof S.construct>[1];

class Composer implements IdiomSpeaker {
  readonly sections = new Set<string>();
  /** How long the facts said are, in characters. */
  factsLength = 0;
  private readonly lang: Lang;

  constructor(private readonly input: SentenceInput, private readonly brief: Brief) {
    this.lang = input.lang;
  }

  /** The clauses of a piece of the line. */
  piece(p: Piece, index: number): string[] {
    const { lang } = this;
    switch (p.kind) {
      case 'whole': {
        const [first, ...facts] = this.statement(p.node);
        return [index ? S.then(lang, ';', first) : first, ...facts];
      }
      case 'open': return [this.opens(p.node)];
      case 'close': {
        const what = this.constructName(p.node);
        const io = this.io(p.redirects);
        const does = p.node.type === 'function_definition' ? undefined : this.opens(p.node);
        return [S.ends(lang, codeSpan(tokenOf(p.node)!.text), what, this.row(p.node), does), ...(io ? [S.wholeIo(lang, what, io)] : [])];
      }
      case 'inside': {
        const block = ownBody(p.node) || p.node.type === 'do_group' ? p.node.parent! : p.node;
        return [S.continues(lang, codeSpan(tokenOf(p.node, this.input.line)!.text), this.constructName(block), this.row(block))];
      }
    }
  }

  /** A statement on the line, as clauses: what it does, then the facts of the models about it. */
  private statement(n: SyntaxNode): string[] {
    return [this.background(n, this.describe(n)), ...this.facts(n)];
  }

  /** A clause about sections of the manual is said only when no problem of the line cites one of them. */
  private allowed(...sections: string[]): boolean {
    if (sections.some((s) => this.input.problems.has(s))) return false;
    sections.forEach((s) => this.sections.add(s));
    return true;
  }

  /** The facts of the status model: a pipeline's status (3.2.3), and whether `set -e` stops the shell when it fails (4.3.1). */
  private facts(n: SyntaxNode): string[] {
    const { status } = this.input;
    const out: string[] = [];
    const rule = status.status(n);
    // (Not `! cmd` alone, a pipeline of one command, whose status the clause says.)
    if (rule.kind === 'pipeline' && rule.stages.length > 1 && rule.pipefail !== 'unknown' && this.allowed('3.2.3')) {
      const last = rule.stages[rule.stages.length - 1];
      out.push(S.pipeStatus(this.lang, rule.pipefail === 'off' ? this.nameOf(last) : undefined, rule.negated));
    }
    // (Under `set -e`: a list, whose commands but the last it ignores; a statement where a failure stops a shell other
    // than the script. Where it stops the script, as everywhere under `set -e`, the sentence says nothing.)
    const e = status.errexit(n);
    const fails = !(rule.kind === 'given' || (rule.kind === 'last-substitution' && !rule.at) || status.succeeds(n));
    if (n.type === 'list' && e.errexit === 'on' && !e.ignored && this.allowed('4.3.1')) out.push(S.errexitList(this.lang, e.stops));
    else if (e.active === 'on' && e.checked === true && e.stops !== 'script' && fails && this.allowed('4.3.1')) out.push(S.errexit(this.lang, e.stops));
    this.factsLength += out.join('; ').length;
    return out;
  }

  /** A statement followed by `&`. */
  private background(n: SyntaxNode, clause: string): string {
    const kids = n.parent!.children;
    return kids[kids.indexOf(n) + 1]?.type === '&' ? S.background(this.lang, clause) : clause;
  }

  /** What a statement does, as one clause. */
  private describe(n: SyntaxNode): string {
    const { lang } = this;
    const idiom = idiomSaid(n, this.input.status, lang, this);
    if (idiom) return idiom;
    const body = (): string => this.clauses(n.namedChildren);
    switch (n.type) {
      case 'command': return this.command(n);
      case 'pipeline': return S.pipe(lang, n.namedChildren.map((c) => this.noun(c)));
      case 'list': return this.list(n);
      // (While it is typed, `!` and `a &&` have nothing after them yet.)
      case 'negated_command': return S.negated(lang, n.namedChildren.length ? this.describe(n.namedChildren[0]) : S.nothing(lang));
      case 'time_statement': return S.timed(lang, n.namedChildren.length ? this.describe(n.namedChildren[0]) : S.nothing(lang));
      case 'coproc_statement': return field(n, 'body') ? S.coproc(lang, this.noun(field(n, 'body')!)) : S.nothing(lang);
      case 'redirected_statement': return S.withIo(lang, this.describe(field(n, 'body')!), this.io(redirectionsOf(n)));
      case 'subshell': return S.subshell(lang, body());
      case 'compound_statement': return S.group(lang, body());
      case 'do_group': return body();
      case 'if_statement': {
        const branches = n.namedChildren.filter((c) => c.type === 'elif_clause' || c.type === 'else_clause');
        return [S.ifThen(lang, this.subject(headOf(n)), this.clauses(bodyOf(n)), undefined), ...branches.map((b) => this.describe(b))].join(lang === 'ja' ? '。' : '; ');
      }
      case 'elif_clause': return S.otherwise(lang, S.ifThen(lang, this.subject(headOf(n)), this.clauses(bodyOf(n)), undefined));
      case 'else_clause': return S.otherwise(lang, body());
      case 'case_item': return S.caseItem(lang, this.patterns(n), this.clauses(bodyOf(n)));
      case 'function_definition': return S.defines(lang, codeSpan(field(n, 'name')!.text), undefined);
      case 'arithmetic_command': return S.arith(lang);
      case 'extended_test': return S.testExt(lang);
      default: return this.opens(n);
    }
  }

  /** What a block does, said on its first line (and again by the word that closes it). */
  private opens(n: SyntaxNode): string {
    const { lang } = this;
    switch (n.type) {
      case 'if_statement': {
        const below = [...new Set(n.namedChildren.filter((c) => c.type === 'elif_clause' || c.type === 'else_clause').map((c) => codeSpan(tokenOf(c, c.startPosition.row)!.text)))];
        return S.ifThen(lang, this.subject(headOf(n)), S.thenPart(lang), below.length ? S.branchesBelow(lang, listSaid(lang, below)) : undefined);
      }
      case 'elif_clause': return S.otherwise(lang, S.ifThen(lang, this.subject(headOf(n)), S.thenPart(lang), undefined));
      case 'else_clause': return S.otherwise(lang, S.runsBody(lang, this.body(n)));
      case 'while_statement': {
        const idiom = idiomSaid(n.parent!.type === 'redirected_statement' ? n.parent! : n, this.input.status, lang, this);
        return idiom ?? S.whileLoop(lang, n.children[0].type === 'until', this.subject(headOf(n)), this.body(n));
      }
      case 'for_statement': return S.forLoop(lang, this.loopVariable(n), this.values(n), this.body(n));
      case 'select_statement': return S.select(lang, this.loopVariable(n), this.values(n), this.body(n));
      case 'c_style_for_statement': return S.cFor(lang, this.body(n));
      case 'case_statement': return S.caseOf(lang, this.word(field(n, 'value')!), this.bodyLines(n));
      case 'case_item': return S.caseItem(lang, this.patterns(n), S.runsBody(lang, this.body(n)));
      // (A function on one line is said whole, by `describe`.)
      case 'function_definition': return S.defines(lang, codeSpan(field(n, 'name')!.text), this.lines(n, n));
      case 'compound_statement': return S.groupLines(lang, this.body(n));
      default: return S.subshellLines(lang, this.body(n));
    }
  }

  /** The variable of `for` or `select` (`$f`); none yet while `for` alone is typed. */
  private loopVariable(n: SyntaxNode): string {
    return codeSpan(`$${field(n, 'variable')?.text ?? ''}`);
  }

  /** The patterns of a branch of `case`, each as written (one word). */
  private patterns(n: SyntaxNode): string {
    return S.orPatterns(this.lang, fields(n, 'value').map((v) => codeSpan(v.text)));
  }

  /** The words a `for` or `select` sets its variable to: those after `in`, or the arguments. */
  private values(n: SyntaxNode): string {
    const words = fields(n, 'value');
    if (!words.length) return placeholderSaid(this.lang, { kind: 'parameter', name: '@', code: '"$@"', elements: 'each' });
    return this.items(words.flatMap((w) => argvWords(w, this.input.status.state, this.lang)).map((w) => this.argvWord(w)));
  }

  /** The body of a block: the lines of its statements, or on the line of its first word their commands. */
  body(n: SyntaxNode): string {
    const st = bodyOf(n);
    return this.bodyLines(n) ?? S.bodyOf(this.lang, st.length ? this.names(st) : '');
  }

  /** The lines of a block's statements, when they go on below the line of its first word. */
  private bodyLines(n: SyntaxNode): string | undefined {
    const st = bodyOf(n);
    const end = st.length ? st.reduce((a, b) => (effEndRow(b) > effEndRow(a) ? b : a)) : undefined;
    return end && effEndRow(end) > n.startPosition.row ? this.lines(st[0], end) : undefined;
  }

  /** The lines from the first of `a` to the last of `b`, in the document. */
  private lines(a: SyntaxNode, b: SyntaxNode): string {
    const first = this.row(a);
    return linesSaid(this.lang, first, first + effEndRow(b) - a.startPosition.row);
  }

  /** The line a node starts on, 1-based, in the document. */
  private row(n: SyntaxNode): number {
    return docLine(n) + 1;
  }

  /** What a block is, as its closing word names it. */
  private constructName(n: SyntaxNode): string {
    if (n.type === 'function_definition') return S.functionNamed(this.lang, codeSpan(field(n, 'name')!.text));
    const kinds: Record<string, ConstructKind> = { if_statement: 'if', for_statement: 'for', c_style_for_statement: 'for', select_statement: 'select', case_statement: 'case', case_item: 'branch', compound_statement: 'group', subshell: 'subshell', elif_clause: 'if', else_clause: 'if' };
    const kind = n.type === 'while_statement' ? (n.children[0].type === 'until' ? 'until' : 'while') : kinds[n.type];
    return S.construct(this.lang, kind);
  }

  /** Statements one after the other, as clauses joined in one: nothing when there are none. */
  private clauses(nodes: readonly SyntaxNode[]): string {
    const statements = nodes.filter((c) => PARTS.has(c.type));
    if (!statements.length) return S.nothing(this.lang);
    return statements.map((c, i) => (i ? S.then(this.lang, ';', this.background(c, this.describe(c))) : this.background(c, this.describe(c)))).join(this.lang === 'ja' ? '。' : '; ');
  }

  /** An AND or OR list: each command, after `&&` or `||` (the status so far decides whether it runs). */
  private list(n: SyntaxNode): string {
    const out: string[] = [];
    const walk = (x: SyntaxNode | undefined, op?: '&&' | '||'): void => {
      if (!x) return;
      if (x.type === 'list') {
        const [left, right] = x.namedChildren;
        walk(left, op);
        walk(right, x.children.find((c) => c.type === '&&' || c.type === '||')!.type as '&&' | '||');
        return;
      }
      const clause = this.describe(x);
      out.push(op ? S.then(this.lang, op, clause) : clause);
    };
    walk(n);
    return out.join(this.lang === 'ja' ? '。' : '; ');
  }

  /** The condition of `if`, `while` or `until`, as the subject of "succeeds". */
  private subject(cond: readonly SyntaxNode[]): string {
    const { lang } = this;
    const c = cond.length === 1 ? cond[0] : undefined;
    // (A line that closes the block has no record of the command: `[ … ]` is told by its spelling there.)
    if (c?.type === 'command') return this.commands(c)?.test || writtenAsBracket(c) ? S.testSubject(lang, BRACKET) : this.noun(c);
    if (c?.type === 'extended_test') return S.testSubject(lang, '`[[ … ]]`');
    if (c?.type === 'arithmetic_command') return S.testSubject(lang, '`(( … ))`');
    if (c?.type === 'negated_command') return S.notSubject(lang, this.subject(c.namedChildren));
    if (c?.type === 'pipeline') return S.pipeSubject(lang, this.names(c.namedChildren));
    return S.conditionOf(lang, this.names(cond));
  }

  private commands(c: SyntaxNode): CommandSaid | undefined {
    return this.input.commands.get(c);
  }

  /** A simple command, as a clause. */
  private command(c: SyntaxNode): string {
    const { lang } = this;
    const said = this.commands(c);
    const assignments = prefixAssignments(c);
    if (!field(c, 'name')) {
      const io = this.io(redirectionsOf(c));
      return assignments.length ? S.sets(lang, this.assigned(assignments), io) : S.onlyRedirects(lang, io);
    }
    // (The assignments before the name are said with the redirections: what the command runs with.)
    const io = [...assignments.map((a) => S.prefixSet(lang, codeSpan(field(a, 'name')!.text), this.value(a))), ...(redirectionsOf(c).length ? [this.io(redirectionsOf(c))] : [])].join(lang === 'ja' ? '、' : ', ');
    if (said?.test) return S.tests(lang, BRACKET, io);
    if (said?.kind === 'function') return S.calls(lang, codeSpan(said.names[0]), io);
    // (The options given, each once, of a command whose spec says what it does; a value given with `=` is not the option.)
    const given = said?.what ? [...new Map(said.options.map((o) => [o.name.replace(/=.*/s, ''), o.what])).entries()] : [];
    const options = this.brief === 0 && given.length && given.length <= 2 ? listSaid(lang, given.map(([name, what]) => S.option(lang, codeSpan(name), what))) : '';
    // (`exit 1`, `return 0`: the status it gives, where it is the number written.)
    const rule = this.input.status.status(c);
    const status = rule.kind === 'given' && !rule.refused && fields(c, 'argument').some((a) => a.text === String(rule.value)) ? rule.value : undefined;
    const clause = S.runs(lang, this.noun(c), options, io, status);
    // (A declaration builtin's assignments, `local x=$1`: the values they give.)
    // (Options may change what the builtin stores, `declare -i n=1+1`: then the value is what the word gives.)
    const declared = this.assigned(fields(c, 'argument').filter((x) => x.type === 'variable_assignment'), said!.options.length ? 'changed' : 'declared');
    return declared ? S.declares(lang, clause, declared) : clause;
  }

  /** A command as a noun: its names, with what it does unless the sentence is brief. */
  private noun(c: SyntaxNode): string {
    const said = c.type === 'command' ? this.commands(c) : undefined;
    return S.noun(this.lang, this.nameOf(c), this.brief === 2 ? undefined : said?.what);
  }

  /** The name of a command (each word of it, `git` `log`), or the keyword of another statement, or its first command's. */
  private nameOf(c: SyntaxNode): string {
    const said = c.type === 'command' ? this.commands(c) : undefined;
    if (said) return said.names.map((n) => codeSpan(n)).join(' ');
    const name = c.type === 'command' ? field(c, 'name') : undefined;
    return codeSpan(name ? name.text : tokenOf(c, c.startPosition.row)!.text);
  }

  /** The names of statements, for a list of them (`grep`, `sort`). */
  names(nodes: readonly SyntaxNode[]): string {
    return this.items(nodes.map((n) => this.nameOf(n)));
  }

  /** The variables a command sets, each with its value (from the word model, with placeholders); empty when none. */
  private assigned(assignments: readonly SyntaxNode[], how: 'plain' | 'declared' | 'changed' = 'plain'): string {
    const { lang } = this;
    const st = this.input.status.state;
    const each = assignments.map((a) => {
      const name = codeSpan(field(a, 'name')!.text);
      // (A variable whose attributes change what bash stores, `-i`, `-u`, a nameref, an array, also on some paths: what the word gives.)
      const v = field(a, 'value');
      const changed = how === 'changed' || CHANGING.some((l) => attribute(st.at(a).run, field(a, 'name')!.text, l) !== 'off');
      const value = changed && v && v.type !== 'array' ? placeholderSaid(lang, { kind: 'string', code: v.text }) : how === 'declared' ? this.declaredValue(a) : this.value(a);
      return a.children.some((c) => c.type === '+=') ? S.appendTo(lang, name, value) : S.setTo(lang, name, value);
    });
    return lang === 'ja' ? each.join('、') : listSaid(lang, each);
  }

  /** The value of an assignment: its word's, an array's words, or the empty string. */
  private value(a: SyntaxNode): string {
    const { lang } = this;
    const v = field(a, 'value');
    if (!v) return EMPTY[lang];
    // (A value is one word: where the model does not know what it gives, it says what the word gives.)
    if (v.type !== 'array') {
      const [one, ...more] = argvWords(v, this.input.status.state, lang);
      return !more.length && one.parts.length === 1 && 'hole' in one.parts[0] && one.parts[0].hole === 'word' ? placeholderSaid(lang, { kind: 'string', code: v.text }) : this.word(v);
    }
    return S.array(lang, this.items(v.namedChildren.flatMap((w) => argvWords(w, this.input.status.state, lang)).map((w) => this.argvWord(w))));
  }

  /**
   * The value a declaration builtin's assignment gives (`local x=$1`): the word the builtin receives (src/argvline.ts:
   * bash brace-expands the whole word first), less its name and `=`; where it gives other than one word (`x={a,b}`),
   * what the word gives.
   */
  private declaredValue(a: SyntaxNode): string {
    const { lang } = this;
    const words = argvWords(a, this.input.status.state, lang);
    const [first, ...rest] = words.length === 1 ? words[0].parts : [];
    const text = first && 'text' in first ? first.text : undefined;
    const eq = text?.indexOf('=') ?? -1;
    if (eq < 0) return placeholderSaid(lang, { kind: 'word', code: a.text });
    return this.argvWord({ ...words[0], parts: [{ text: text!.slice(eq + 1) }, ...rest] });
  }

  /** Items in a list, cut after `ITEMS`. */
  private items(items: readonly string[]): string {
    return listSaid(this.lang, items.length > ITEMS ? [...items.slice(0, ITEMS - 1), '…'] : items);
  }

  /** A word, as what it gives: its value, its placeholder, or the words it stands for. */
  word(w: SyntaxNode): string {
    return this.items(argvWords(w, this.input.status.state, this.lang).map((x) => this.argvWord(x)));
  }

  private argvWord(w: ArgvWord): string {
    const { lang } = this;
    // (The empty text around a value, `"$1"`, is no part of what it says.)
    const parts = w.parts.length > 1 ? w.parts.filter((p) => !('text' in p) || p.text !== '') : w.parts;
    if (!parts.length) return NOTHING[lang];
    const part = (p: ArgvWord['parts'][number], alone: boolean): string => ('text' in p ? (p.text === '' ? EMPTY[lang] : codeSpan(shorten(p.text, 40))) : alone ? p.label : `‹${p.label}›`);
    return parts.length === 1 ? part(parts[0], true) : parts.map((p) => part(p, false)).join('');
  }

  /** The redirections of a command, short: where each stream goes or comes from; empty when there are none. */
  private io(redirs: readonly SyntaxNode[]): string {
    const { lang } = this;
    const items = redirs.map((r) => {
      const fd = field(r, 'descriptor')?.text ?? '';
      if (r.type === 'heredoc_redirect') return ioSaid(lang, 'heredoc', fd, '');
      const target = r.namedChildren.find((c) => c.field !== 'descriptor');
      if (r.type === 'herestring_redirect') return ioSaid(lang, 'herestring', fd, this.word(target!));
      const { op, dest } = redirectParts(r);
      const kinds: Record<string, IoKind> = { '<': 'read', '>': 'write', '>|': 'write', '>>': 'append', '&>': 'both', '&>>': 'bothAppend' };
      if (/^\d*$/.test(fd) && target && kinds[op]) return ioSaid(lang, kinds[op], fd, this.word(target));
      if (/^\d*$/.test(fd) && (op === '>&' || op === '<&') && /^\d+$/.test(dest)) return ioSaid(lang, op === '>&' ? 'dup' : 'dupIn', fd, dest);
      // (Any other: a descriptor closed or moved, a named one, `>&word`: the dictionary's text.)
      const text = redirects[op](fd, dest)[lang];
      return lang === 'ja' ? text : text.charAt(0).toLowerCase() + text.slice(1);
    });
    return items.join(lang === 'ja' ? '、' : ', ');
  }
}
