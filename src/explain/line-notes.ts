// Notes on the line as a whole (docs/design/analyzer.md, step 8): a line inside a here-document or at its end, a
// statement that started on a line before; and the notes that follow from the models, each from the message catalog:
// status and errexit (src/semantics/status.ts, src/statusfacts.ts), a variable lost after a pipeline
// (src/semantics/pipeline.ts), a loop over a glob that may match nothing, and an extended glob read before
// `shopt -s extglob` applies.
import type { Token } from '../analyzer-types';
import { hasExtglob } from '../examples/shellwords';
import { tx } from '../i18n';
import { clausesOf, type Fact, fact, factOf, isProblemNote, MESSAGES, tokenNote } from '../messages';
import type { StopWhat } from '../messages-errexit-stop';
import { shorten } from '../label';
import { saysProblem } from '../messages-tokens';
import { statementBefore } from '../rewrite';
import { bashrcReader, STATEMENTS } from '../semantics/env';
import { NAME } from '../semantics/walk/shared';
import { wordPatterns } from '../semantics/globwords';
import { lostVariable } from '../semantics/pipeline';
import { docLine } from '../semantics/state';
import type { StatusModel, StatusRule } from '../semantics/status';
import { statusFacts, type StatusFact } from '../statusfacts';
import { ancestor, assignmentsOnly, field, fields, nameText, type SyntaxNode } from '../syntax/tree';
import type { Explainer, LineExplainer } from './context';
import { intersects, onLine } from './nodes';
import { shoptAt, syntaxFaultOf } from './reads';
import { type StopContext, stopContext } from './status';

/**
 * The status facts of a script, by line, computed once per status model and tree (both languages): the strings `eval`
 * runs are in the model of the script around them, in trees of their own.
 */
const statusFactCache = new WeakMap<StatusModel, WeakMap<SyntaxNode, Map<number, StatusFact[]>>>();

/** The syntax error bash stops at (`syntaxFault`), on the line of what it points at: as a problem, unless another says it. */
export function syntaxErrorNotes(cx: Explainer, line: number): string[] {
  const fault = syntaxFaultOf(cx);
  if (!fault || fault.said || fault.node.startPosition.row !== line) return [];
  return cx.say(fact(cx.lang, cx.evidenceAt(fault.node) === 'known' ? 'syntax-error' : 'syntax-error-if-bash', { what: fault.what }), fault.node);
}

/** The notes on where line `line` is: in a here-document or at its end, or in a statement that started on a line before. */
export function continuationNotes(cx: Explainer, root: SyntaxNode, line: number, items: Token[]): string[] {
  const facts: Fact[] = [];
  for (const h of onLine(root, ['heredoc_redirect'], line)) {
    const body = h.namedChildren.find((c) => c.type === 'heredoc_body');
    const end = h.namedChildren.find((c) => c.type === 'heredoc_end');
    const delim = h.namedChildren.find((c) => c.type === 'heredoc_start')?.text;
    if (delim === undefined) continue; // `cat <<` while typing
    // `<<END`, `3<<-END` as written (its descriptor, and the operator may have a tab-stripping `-`).
    const operator = `${field(h, 'descriptor')?.text ?? ''}${/<<-?/.exec(h.text)![0]}${delim}`;
    // The end line itself can be inside the range of the body (with `<<-` it is indented with tabs).
    if (end && end.startPosition.row === line) facts.push(fact(cx.lang, 'heredoc-end-line', { end: end.text.trim(), operator, line: docLine(h) + 1 }));
    else if (body && intersects(body, line) && body.startPosition.row <= line && h.startPosition.row < line) facts.push(fact(cx.lang, 'heredoc-body-line', { operator, line: docLine(h) + 1 }));
  }
  const started = items.find((it) => it.span.start.line < line && it.kind !== 'block');
  if (!facts.length && started) facts.push(fact(cx.lang, 'statement-continued', { line: started.span.start.line + 1 }));
  // (About the line, not a part of it.)
  return facts.flatMap((f) => cx.say(f));
}

/** The notes (`pitfall: false`) and pitfalls on status and errexit of line `line` (src/semantics/status.ts). */
export function statusNotes(cx: Explainer, line: number, pitfall: boolean): string[] {
  let byRoot = statusFactCache.get(cx.status);
  if (!byRoot) statusFactCache.set(cx.status, (byRoot = new WeakMap()));
  let byLine = byRoot.get(cx.root);
  if (!byLine) byRoot.set(cx.root, (byLine = statusFacts(cx.root, cx.state, cx.status, cx.shell)));
  return (byLine.get(line) ?? []).filter((f) => (MESSAGES[f.id].kind === 'pitfall') === pitfall).flatMap((f) => cx.say(factOf(cx.lang, f), f.node));
}

/**
 * `… | while read l; do n=…; done; echo "$n"`: each part of a pipeline runs in a subshell (the last
 * one too, in bash without lastpipe, and in dash and the like), so variables set there are gone after
 * it. Pointed out where the pipeline starts, when such a variable is used after it.
 */
export function pipeSubshellPitfalls(cx: Explainer, root: SyntaxNode, line: number): string[] {
  for (const p of onLine(root, ['pipeline'], line)) {
    if (p.startPosition.row !== line) continue;
    // A variable the last stage sets in its subshell, read after the pipeline (src/semantics/pipeline.ts): with lastpipe on, it runs in the shell.
    const lost = lostVariable(cx.state, p);
    if (!lost) continue;
    const { name: used, last, link } = lost;
    const bash = !cx.shell || cx.shell === 'bash';
    const fix: [string, string] = last.type === 'command'
      ? (bash ? [`\`read ${used} < <(コマンド)\` のようにプロセス置換で渡すか、\`shopt -s lastpipe\` にします`, `Use process substitution, \`read ${used} < <(command)\`, or turn on \`shopt -s lastpipe\``]
        : [`\`${used}=$(コマンド)\` のようにコマンド置換で受け取ります`, `Take the output with command substitution: \`${used}=$(command)\``])
      : (bash ? ['`done < ファイル` や `done < <(コマンド)` のようにリダイレクトで渡すか、`shopt -s lastpipe` にします', 'Feed the loop with a redirection, `done < file` or `done < <(command)`, or turn on `shopt -s lastpipe`']
        : ['`done < ファイル` のようにリダイレクトで渡すか、一時ファイルを使います', 'Feed the loop with a redirection, `done < file`, or use a temporary file']);
    return cx.say(fact(cx.lang, 'pipeline-subshell-variable', { used, fix: tx(fix[0], fix[1]), partial: !link.sure }), p);
  }
  return [];
}

/** The statements a loop can be part of, before which another statement cannot go: `a && for …`, `for … | sort`, `time for …`. */
const HOLDERS: ReadonlySet<string> = new Set(['list', 'pipeline', 'redirected_statement', 'negated_command', 'time_statement', 'coproc_statement']);

/**
 * `for f in *.log`: when nothing matches, the loop runs once with `*.log` itself (unless nullglob or
 * failglob is on, or zsh, where it is an error). Quiet when the body checks that the file exists.
 */
export function unmatchedGlobPitfalls(cx: Explainer, root: SyntaxNode, line: number): string[] {
  if (cx.shell === 'zsh') return [];
  for (const loop of onLine(root, ['for_statement', 'select_statement'], line)) {
    const shopt = shoptAt(cx, loop);
    if (loop.startPosition.row !== line || shopt.nullglob === 'on' || shopt.failglob === 'on') continue;
    // (The words of the list as bash reads them where the loop runs, from the word model: the words each makes by
    // brace expansion, and their fields that are patterns. `*.log`, `"$dir"/*.log` and `*.{c,h}` are, a quoted `*`
    // is not: `{"*",*.c}`.)
    const words = fields(loop, 'value');
    const lists = words.map((w) => wordPatterns(w, cx.state));
    const at = lists.findIndex((l) => l?.some((x) => x.patterns.length));
    const v = field(loop, 'variable')?.text;
    // (`for a+ in *.c`: bash rejects the name, and the loop never runs.)
    if (at < 0 || !v || !NAME.test(v)) continue;
    const glob = words[at];
    const bodyNode = field(loop, 'body');
    // `for f in *` while typing: there is no body to look at yet.
    if (!bodyNode) continue;
    const body = bodyNode.text;
    if ([...body.matchAll(/-[efdrsLh]\s+"?\$\{?(\w+)/g)].some((m) => m[1] === v)) continue;
    // The rewrites: a test first in the body (`do` with no command is a syntax error: nothing runs once), where each
    // pass of the loop is over a pattern (it would skip the others too, `for i in a *.c` or `for i in {a,*.c}`, which
    // are no files), and not in a `select`, whose menu shows the pattern still (choosing it would only ask again); and
    // where the shell has nullglob, `shopt -s nullglob` before the statement that holds the loop (`a && for … | sort`),
    // unless the loop is a function's body (`f() for …`).
    const first = bodyNode.namedChildren.find((c) => STATEMENTS.has(c.type));
    if (!first) continue;
    let holder = loop;
    while (HOLDERS.has(holder.parent!.type)) holder = holder.parent!;
    const menu = loop.type === 'select_statement';
    const rewrite = !menu && lists.every((l) => l?.every((x) => x.patterns.length && x.others === 0)) ? [statementBefore(first, `[ -e "$${v}" ] || continue`)] : [];
    if (shopt.nullglob !== 'unsupported' && holder.parent!.type !== 'function_definition') rewrite.push(statementBefore(holder, 'shopt -s nullglob'));
    // (Each pattern of the word runs the loop once when no file matches it, with its text after the expansions; they
    // are the whole list, so that with one the loop runs once in all, where the word makes nothing else. A pattern is
    // named by its text, but as written where the text is not known or reads otherwise as a pattern, `"$d"/*.c`. A
    // word with a pattern but other fields not known gives several words, some of which may be patterns:
    // `"${a[@]}"*.c`.)
    const made = lists[at]!;
    const several = made.some((x) => x.patterns.length && x.others === 'unknown');
    const patterns = made.flatMap((x) => x.patterns.map((p) => ({ name: p.text !== undefined && p.text === p.pattern ? p.text : x.written, text: p.text })));
    const alone = words.length === 1 && made.every((x) => x.others === 0);
    const name = patterns.length === 1 && (made.length > 1 || made[0].others !== 0) ? patterns[0].name : glob.text;
    return cx.say(fact(cx.lang, 'unmatched-glob-runs-once', { glob: name, patterns, v, alone, rewrite, how: { menu, several } }), glob);
  }
  return [];
}

/**
 * bash reads an extended glob only after `shopt -s extglob` (except in `[[ ]]`), and reads a whole
 * function or block before running it, so turning it on inside the same block is too late.
 */
export function extglobPitfalls(cx: Explainer, root: SyntaxNode, line: number): string[] {
  if (cx.shell && cx.shell !== 'bash') return [];
  const uses = onLine(root, ['word', 'extglob_pattern'], line)
    .filter((n) => n.startPosition.row === line && hasExtglob(n.text) && !/^(extended_test|expansion)$/.test(ancestor(n, (a) => /^(extended_test|expansion|command_substitution|process_substitution)$/.test(a.type))?.type ?? '')); // (Not in `[[ ]]` nor in a `${x%…}`: bash reads them anyway.)
  if (!uses.length) return [];
  const use = uses[0];
  let top = use;
  while (top.parent && top.parent.type !== 'program') top = top.parent;
  // On when the block runs up to the glob, but not when bash read the block.
  const state = shoptAt(cx, use, 'parse').extglob;
  if (state === 'on') return [];
  if (top !== use && shoptAt(cx, top).extglob !== 'on' && shoptAt(cx, use).extglob === 'on') {
    // (Where `.bashrc` may have run first, a file with no shebang or `bash -i -c` (`bashrcReader`), extglob is often
    // on: a caveat.)
    const reader = bashrcReader(cx.state.env(use), cx.state.read, cx.state.interactiveStart);
    return cx.say(fact(cx.lang, 'extglob-in-same-block', { use: use.text, ...(reader ? { reader } : {}) }), use);
  }
  // (A trap's action is read when its signal comes; another shell starts with its own options.)
  const id = state === 'unknown' ? (cx.nested === 'later' ? 'extglob-maybe-on-trap' : 'extglob-maybe-on')
    : state === 'off' ? 'extglob-turned-off' : cx.nested === 'child' ? 'extglob-not-in-new-shell' : 'extglob-not-found';
  // (A new shell started with `-i` reads `.bashrc` first, which often turns extglob on: a caveat.)
  if (id === 'extglob-not-in-new-shell' && bashrcReader(cx.state.env(use), cx.state.read, cx.state.interactiveStart) === 'interactive') return cx.say(fact(cx.lang, id, { use: use.text, reader: 'interactive' }), use);
  return cx.say(fact(cx.lang, id, { use: use.text }), use);
}

/**
 * The errors the tokens of a line say (`tokenError`, `Token.marks`), as notes about each token: a token warning stays on
 * its row, but "fails every time" is a problem of the line (docs/design/panel-redesign.md, P7b). From here it goes the way
 * of every note: the box, the hover, Markdown, the Problems strip, `--check`.
 */
export function tokenErrorNotes(cx: Explainer, items: readonly Token[]): string[] {
  const found: string[] = [];
  const walk = (t: Token) => {
    for (const m of t.marks ?? []) if (saysProblem(m)) found.push(cx.sayAt(tokenNote(cx.lang, m), t.span));
    t.children.forEach(walk);
  };
  items.forEach(walk);
  return [...new Set(found)];
}

/** The statements whose own failure `set -e` checks (`CHECKED` of src/semantics/status.ts, but `!`), where a stop note may go. */
const STOPPING = ['command', 'extended_test', 'arithmetic_command', 'pipeline', 'subshell'];

/** What fails in a stop note: the command's name, the one command of an assignment's `$( )`, a test, a pipeline, a subshell. */
function stopWhat(status: StatusModel, n: SyntaxNode): StopWhat {
  switch (n.type) {
    case 'pipeline': return { kind: 'pipeline' };
    case 'extended_test': return { kind: 'test', text: '[[ … ]]' };
    case 'arithmetic_command': return { kind: 'test', text: '(( … ))' };
    case 'subshell': return { kind: 'subshell' };
  }
  // (A command that is not only assignments has a name.)
  const nameOf = (c: SyntaxNode): string => shorten(nameText(field(c, 'name')!), 32);
  const rule = status.status(n);
  if (assignmentsOnly(n)) {
    // (One that may fail has the status of its last substitution, `at`: src/semantics/status.ts.)
    const { at } = rule as Extract<StatusRule, { kind: 'last-substitution' }>;
    const inner = at!.namedChildren.filter((c) => STATEMENTS.has(c.type));
    return { kind: 'substitution', ...(inner.length === 1 && inner[0].type === 'command' && !assignmentsOnly(inner[0]) ? { name: nameOf(inner[0]) } : {}) };
  }
  // (A command that fails no other way, or ends the shell or the function itself, fails by a redirection: `exec cmd >> "$log"`.)
  if (rule.kind === 'command' && (rule.ends || rule.fails === 'never')) return { kind: 'redirection', name: nameOf(n) };
  // (A test that is well formed is false with 1, as written; a malformed one gives 2, the command's status.)
  if (rule.kind === 'test' && !rule.fails) return { kind: 'test', text: shorten(n.text, 32) };
  const name = nameOf(n);
  return { kind: 'command', name };
}

/** How many statements a stop note names; more are "another". */
const NAMED = 3;

/**
 * The notes of line `line` on where `set -e` stops the script (`errexit-stops-here`; docs/design/errexit-stop.md): one
 * for the statements that start on it and stop the same way (`stopContext`), anchored at the first; none in a string
 * read as a script, nor where a problem of the line (in `said`, or one of the host's) says what `set -e` does there,
 * nor for a statement in another that has one.
 */
export function errexitStopNotes(cx: LineExplainer, line: number, said: readonly string[]): string[] {
  if (cx.nested) return [];
  const problems = [...said.map((t) => cx.noteOf(t)).filter(isProblemNote).map((x) => x.code), ...cx.opts.hostProblems ?? []];
  if (problems.some((code) => clausesOf(code).includes('errexit'))) return [];
  const groups: { at: SyntaxNode; key: string; context: StopContext; what: StopWhat[]; more: boolean }[] = [];
  const noted: SyntaxNode[] = [];
  for (const n of onLine(cx.root, STOPPING, line)) {
    if (n.startPosition.row !== line || noted.some((m) => ancestor(n, (a) => a === m)) || !cx.reachedAt(n)) continue;
    const context = stopContext(cx.state, cx.status, n, cx.opts.hostRun);
    if (!context) continue;
    const what = stopWhat(cx.status, n);
    noted.push(n);
    const key = JSON.stringify(context);
    const last = groups.at(-1);
    if (last?.key !== key) groups.push({ at: n, key, context, what: [what], more: false });
    else if (last.what.length < NAMED) last.what.push(what);
    else last.more = true;
  }
  return groups.flatMap((g) => cx.say(fact(cx.lang, 'errexit-stops-here', { ...g.context, what: g.what, ...(g.more ? { more: true } : {}) }), g.at));
}
