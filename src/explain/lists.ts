// Lists of commands (3.2.4): pipelines joined by `;`, `&`, `&&` and `||`. `&&` and `||` bind tighter, so a list of
// `;` and `&` (a `command_list`, from `commandLists` of src/syntax/tree.ts) has pipelines and AND/OR lists (the
// model's `list`) as its parts; `&` runs the part before it in the background, `;` waits for it. The tokens of the
// list, of an AND/OR list, and of the `;` and `&` that separate or end the parts of a list.
import type { Token } from '../analyzer-types';
import { listOps } from '../dict/syntax';
import { codeSpan, labelText, LABEL_LIMIT, skeleton } from '../label';
import { field, listElements, listOperator, listOverLines, type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';
import { isBlockLike, skeletal, summaryOf } from './nodes';

/**
 * A part as a text names it: its code when it is short and on one line, else its skeleton (`if ‹condition› then
 * ‹commands› fi`, `cat <<E`). (A line continuation is no new line; a here-document's body is past the part's line.)
 */
function shown(p: SyntaxNode): string {
  const text = p.text.replace(/\\\n\s*/g, '').trim();
  return text.length <= LABEL_LIMIT && !text.includes('\n') ? text : labelText(skeleton(p));
}
const code = (p: SyntaxNode): string => codeSpan(shown(p));

/** The operators of an AND/OR list, from the left (`a && b || c`: `&&`, `||`). */
function andOrOperators(n: SyntaxNode): string[] {
  return n.children.flatMap((c) => (c.type === 'list' ? andOrOperators(c) : !c.named && (c.type === '&&' || c.type === '||') ? [c.type] : []));
}

/** What an AND/OR list is, by its operators: an AND list, an OR list, or both (the manual's "AND and OR lists"). */
function andOrKind(n: SyntaxNode): 'and' | 'or' | 'both' {
  const ops = new Set(andOrOperators(n));
  return ops.size > 1 ? 'both' : ops.has('&&') ? 'and' : 'or';
}

/**
 * A part named in the text of a `;` or `&` after it: `b`; the whole pipeline or AND/OR list, which the operator
 * applies to as one (`whole`: the text says so).
 */
function partName(cx: Explainer, p: SyntaxNode, whole: boolean): string {
  const c = code(p);
  if (p.type === 'list') {
    const kind = andOrKind(p);
    const [ja, en] = kind === 'and' ? ['AND リスト', 'AND list'] : kind === 'or' ? ['OR リスト', 'OR list'] : ['AND・OR リスト', 'AND and OR list'];
    return whole ? cx.s(`${ja} ${c} 全体`, `the whole ${en} ${c}`) : cx.s(`${ja} ${c}`, `the ${en} ${c}`);
  }
  if (p.type === 'pipeline') return whole ? cx.s(`パイプライン ${c} 全体`, `the whole pipeline ${c}`) : cx.s(`パイプライン ${c}`, `the pipeline ${c}`);
  return c;
}

/** The space before a Japanese particle: after code, not after a word (`a` を, 全体を). */
const gap = (what: string): string => (what.endsWith('`') ? ' ' : '');

/** The reserved words that a `;` or a newline must come before, since bash knows them only where a command can start. */
const CLOSERS = new Set(['then', 'do', 'done', 'fi', 'elif', 'else', '}', 'esac']);

/** The token of a `;` or `&` that separates or ends a part of a list of commands, or undefined if `op` is not one. */
export function listOperatorToken(cx: Explainer, op: SyntaxNode): Token | undefined {
  const at = listOperator(op);
  if (!at) return undefined;
  if (op.type === '&') {
    const what = partName(cx, at.part, at.part.type === 'list' || at.part.type === 'pipeline');
    return { ...cx.tok(op, 'operator', cx.s(
      `${what}${gap(what)}をバックグラウンドで実行する: シェルはサブシェルで非同期に実行し、終了を待たずに${at.next ? '次へ' : '先へ'}進む（終了ステータスは 0）`,
      `Run ${what} in the background: the shell runs it asynchronously in a subshell and goes on${at.next ? ' to the next' : ''} without waiting (the status is 0)`,
    )), refs: ['3.2.4'] };
  }
  const what = partName(cx, at.part, false);
  // (A coprocess runs in the background as if ended by `&`, 3.2.6: the shell does not wait for it.)
  const co = at.part.type === 'coproc_statement' ? code(field(at.part, 'body') ?? at.part) : undefined;
  const waitJa = co ? `\`coproc\` がバックグラウンドで実行する ${co} は待たない` : `${what}${gap(what)}の終了を待つ`;
  const waitEn = co ? `do not wait for ${co}, which \`coproc\` runs in the background` : `wait for ${what} to end`;
  if (at.next) {
    return { ...cx.tok(op, 'operator', cx.s(co ? `区切り: \`coproc\` がバックグラウンドで実行する ${co} は待たずに、次を実行する` : `区切り: ${what}${gap(what)}の終了を待ってから、次を実行する`, `Separator: ${waitEn}, then run the next`)), refs: ['3.2.4'] };
  }
  // (The reserved word after it, or the one a clause after it starts with: `do` of `do … done`, `else`; at the end of
  // an `elif` or `else` clause or a last `case` item, what comes after it: `fi`, `esac`.)
  const next = (n: SyntaxNode): SyntaxNode | undefined => n.parent!.children.slice(n.parent!.children.indexOf(n) + 1).find((c) => c.type !== 'comment');
  const clause = ['elif_clause', 'else_clause', 'case_item'].includes(op.parent!.type);
  const after = next(op) ?? (clause ? next(op.parent!) : undefined);
  const word = after?.named ? after.children[0] : after;
  const closer = word && !word.named && CLOSERS.has(word.type) ? word.type : undefined;
  if (!closer) return { ...cx.tok(op, 'operator', cx.s(`リストの終わり: ${waitJa}`, `End of the list: ${waitEn}`)), refs: ['3.2.4'] };
  // A reserved word is one only where a command can start: after a simple command's words it would be one more word
  // (`if a then`), but after a compound command it may follow at once (`if [[ a ]] then`).
  // (What `;` says before a reserved word is that the commands before it end there, so that `closer` can be read; not
  // that bash waits, which it does after every command of a list. A coprocess is the exception: bash does not wait.)
  const ja = co ? `\`${closer}\` の前でリストを終え、${waitJa}` : `\`${closer}\` の前でリストを終える`;
  const en = co ? `End of the list before \`${closer}\`: ${waitEn}` : `End of the list before \`${closer}\``;
  const ends = endOf(at.part);
  return { ...cx.tok(op, 'operator', ends === 'words'
    ? cx.s(`${ja}（ここに \`;\` か改行がないと、\`${closer}\` は予約語として読まれない）`, `${en} (without a \`;\` or a newline here, \`${closer}\` would not be read as a reserved word)`)
    : ends === 'coproc'
      ? cx.s(`${ja}（\`coproc\` と単語1つの後では bash が予約語を読むので、ここでは省いてもよい）`, `${en} (bash reads a reserved word after \`coproc\` and one word, so it may be left out here)`)
      : cx.s(`${ja}（複合コマンドの後では bash が \`${closer}\` を予約語として読むので、省いてもよい）`, `${en} (it may be left out: after a compound command, bash reads \`${closer}\` as a reserved word)`)), refs: ['3.2.4'] };
}

/**
 * How a part ends, as bash reads what follows it: with the words of a simple command or the redirections of a command
 * (its last command's), or with a compound command. `coproc` and one word (`coproc cat`) is the exception: bash reads
 * the word as maybe the coprocess's name, and then a reserved word (`{ coproc cat }` runs `cat`, checked with bash 5.2).
 */
function endOf(p: SyntaxNode): 'words' | 'compound' | 'coproc' {
  let last: SyntaxNode | undefined = p;
  // (A function's definition ends with its body, or with the redirections after it: `f() { :; } >/dev/null`.)
  while (last && ['list', 'pipeline', 'negated_command', 'time_statement', 'coproc_statement', 'function_definition'].includes(last.type)) {
    const body = last.type === 'coproc_statement' && !field(last, 'name') ? field(last, 'body') : undefined;
    if (body?.type === 'command' && body.namedChildren.length === 1) return 'coproc';
    last = last.namedChildren.filter((c) => c.type !== 'comment').pop();
  }
  return !last || last.type === 'command' || last.type === 'redirected_statement' || REDIRECTS.has(last.type) ? 'words' : 'compound';
}
const REDIRECTS = new Set(['file_redirect', 'heredoc_redirect', 'herestring_redirect']);

/** The parts of a list, or of an AND/OR list, on the line explained: each node through the walk, each operator here. */
function parts(cx: Explainer, nodes: readonly SyntaxNode[], operator: (c: SyntaxNode) => Token | undefined): Token[] {
  const out: Token[] = [];
  for (const c of nodes) {
    if (c.named) out.push(...cx.sub(c));
    else if (cx.onLine(c)) {
      const t = operator(c);
      if (t) out.push(t);
    }
  }
  return out;
}

/** A summary of the parts: each part's, with the bare operators between them. */
const summary = (children: readonly Token[]): string => children.map((c) => (c.kind === 'operator' && !c.children.length ? c.label : summaryOf(c))).join(' ');

/** A list of commands (`commandLists`): its parts, in order, joined by `;` and `&` (and newlines, in a body). */
export function commandList(cx: Explainer, n: SyntaxNode): Token {
  const children = parts(cx, n.children, (c) => listOperatorToken(cx, c));
  const elements = listElements(n);
  const ops = new Set(n.children.filter((c) => !c.named).map((c) => c.type));
  const lines = listOverLines(n) ? cx.s('。コマンドの間の改行は `;` と同じ区切り', '; a newline between commands separates them as `;` does') : '';
  const coproc = elements.length > 1 && elements.some((e) => e.type === 'coproc_statement') ? cx.s('（`coproc` は例外で、バックグラウンドで実行する）', ' (but not a `coproc`, which runs in the background)') : '';
  const one = elements.length === 1 && partName(cx, elements[0], elements[0].type === 'list' || elements[0].type === 'pipeline');
  const text = one
    ? cx.s(`\`&\` で終わるリスト: ${one}${gap(one)}をバックグラウンドで実行する`, `List ended by \`&\`: ${one} runs in the background`)
    : (ops.has('&')
      ? cx.s('リスト: コマンドを左から順に実行する。`&` が続くものはバックグラウンドで実行してすぐ次へ進み、`;` が続くものは終了を待つ', 'List: runs its commands in order from the left; one followed by `&` runs in the background and the next starts at once, one followed by `;` is waited for')
      : cx.s('リスト: コマンドを左から順に、前のコマンドの終了を待って実行する。終了ステータスは最後のコマンドのもの', 'List: runs its commands one after another, each after the one before it ends; the status is that of the last')) + coproc;
  const t = cx.tok(n, 'operator', text + lines + cx.lineRef(n), children);
  t.grammar = 'list';
  t.refs = ['3.2.4'];
  t.summary = summary(children);
  return skeletal(t, n);
}

/** `(a && b) || c`: how an AND/OR list is grouped, from the left; undefined when it is long. */
function grouping(n: SyntaxNode): string | undefined {
  const inner = (x: SyntaxNode): string => {
    if (x.type !== 'list') return shown(x);
    const [left, right] = x.namedChildren.filter((c) => c.type !== 'comment');
    const op = x.children.find((c) => c.type === '&&' || c.type === '||')!.type;
    const l = `${left.type === 'list' ? `(${inner(left)})` : inner(left)} ${op}`;
    // (A list that is not finished has no right side: `a && b ||`.)
    return right ? `${l} ${inner(right)}` : l;
  };
  const text = inner(n);
  return text.length <= 60 ? text : undefined;
}

/** An AND/OR list (3.2.4: the model's `list`), shown as one sequence (`a && b || c`), left-nested as it is. */
export function andOrList(cx: Explainer, n: SyntaxNode, other: (c: SyntaxNode) => Token | undefined): Token {
  // Flatten left-nested lists (`a && b || c`) into one sequence.
  const flatParts: SyntaxNode[] = [];
  const walk = (x: SyntaxNode) => {
    for (const c of x.children) {
      if (c.type === 'list' && !isBlockLike(c)) walk(c);
      else flatParts.push(c);
    }
  };
  walk(n);
  // (Its operators; another token is one an unfinished construct left there, `while a do b; done && c`: `other` says it.)
  const children = parts(cx, flatParts, (c) => (c.type === '&&' || c.type === '||' ? { ...cx.tok(c, 'operator', cx.t(listOps[c.type])), refs: ['3.2.4'] } : other(c)));
  const kind = andOrKind(n);
  const grouped = kind === 'both' ? grouping(n) : undefined;
  const text = kind === 'and'
    ? cx.s('AND リスト: 前のコマンドが成功（終了ステータス 0）したときだけ次を実行する。終了ステータスは最後に実行したコマンドのもの', 'AND list: runs each command only if the one before it succeeds (exit 0); the status is that of the last one run')
    : kind === 'or'
      ? cx.s('OR リスト: 前のコマンドが失敗（終了ステータス 0 以外）したときだけ次を実行する。終了ステータスは最後に実行したコマンドのもの', 'OR list: runs each command only if the one before it fails (non-zero exit); the status is that of the last one run')
      : cx.s(
        `AND・OR リスト${grouped ? `。左から \`${grouped}\` と読む` : '。左から順に読む'}: \`&&\` の次はそこまでの終了ステータスが 0 のときだけ、\`||\` の次は 0 以外のときだけ実行する`,
        `AND and OR lists, read from the left${grouped ? ` as \`${grouped}\`` : ''}: after \`&&\` the next command runs only if the status so far is 0, after \`||\` only if it is not`);
  const t = cx.tok(n, 'operator', text, children);
  t.refs = ['3.2.4'];
  // (Its own operator: `a && b || c` is an OR list, whose first part is an AND list.)
  t.grammar = n.children.some((c) => c.type === '||') ? 'orList' : 'andList';
  t.summary = summary(children);
  return skeletal(t, n);
}

/** The tokens of the statements of a script or a body on the line (`$( )`, `<( )`): its lists, statements and comments. */
export function statementTokens(cx: Explainer, nodes: readonly SyntaxNode[]): Token[] {
  return parts(cx, nodes.filter((c) => c.named || c.type === ';' || c.type === '&'), (c) => listOperatorToken(cx, c));
}

