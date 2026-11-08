// Notes on exit statuses (docs/design/analyzer.md, step 3): `((i++))` at 0, `exit 256`, and whether a failing `$( )`
// stops the script under `set -e`. The statuses and errexit come from the status model (src/semantics/status.ts).
import { DEFAULT_BASH_VERSION } from '../bashversion';
import { shorten } from '../label';
import { fact } from '../messages';
import { inPlaceOf, replaceNode } from '../rewrite';
import { STATEMENTS } from '../semantics/env';
import { commandName } from '../semantics/effects';
import { exitSignal } from '../semantics/walk/shared';
import { staticWordValue } from '../staticword';
import type { ErrexitStopParams, StopWhat } from '../messages-facts-status';
import { ancestor, assignmentsOnly, descendants, field, fields, type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/** `((i++))` is the old value of `i`: 0 makes the status 1, which `set -e` treats as a failure. */
export function postfixStatusNote(cx: Explainer, n: SyntaxNode): void {
  const m = /^\(\(\s*([A-Za-z_]\w*(?:\[[^\]]*\])?)(\+\+|--)\s*\)\)$/.exec(n.text);
  if (!m) return;
  const [, v, op] = m;
  // (Where bash surely ignores `set -e`, `((i++)) || true`, the status 1 is the intent.)
  const { ignored, active, stops } = cx.status.errexit(n); if (ignored?.sure) return;
  const errexit = active === 'on';
  if (op === '--') return cx.note(fact(cx.lang, 'postfix-decrement-status', { v, errexit, stops }), n);
  // The rewrites: an assignment, whose status is 0 whatever the value; `((++v))`, 1 only when the new value is 0 (from
  // -1); and where `set -e` stops there, the status ignored (`|| true`), in a group where a list would take it in. No
  // assignment when the subscript acts (`a[i++]`, `a[$(f)]`): written twice, it would act twice.
  const acts = /\+\+|--|\$\(|`|<<=|>>=|(^|[^=!<>])=(?!=)/.test(v.slice(v.indexOf('[') + 1));
  const rewrite = [...(acts ? [] : [replaceNode(n, `${v}=$((${v}+1))`)]), replaceNode(n, `((++${v}))`), ...(errexit ? [replaceNode(n, inPlaceOf(n, `${n.text} || true`))] : [])];
  cx.note(fact(cx.lang, 'postfix-increment-status', { v, errexit, stops, rewrite }), n);
}

/**
 * In POSIX mode, an error of a special builtin that ends the shell (`posixExit` of the status model: an option it does
 * not have, a name it refuses…); an assignment to a readonly variable before it is said by the assignment.
 */
export function posixExitNote(cx: Explainer, n: SyntaxNode): void {
  const p = cx.status.posixExit(n);
  if (!p || p.active === 'off' || p.exit.why === 'readonly-assignment') return;
  const { why, word, status, at, since } = p.exit;
  cx.note(fact(cx.lang, p.active === 'on' ? 'posix-special-builtin-error' : 'posix-special-builtin-error-maybe', { name: field(n, 'name')!.text, why, word, status, stops: p.stops, ...(since ? { since } : {}), ...(p.trap ? { trap: true } : {}) }), at);
}

/**
 * `exit 1 2` and `exit x`, whose words give no status (`ExitRefusal` of the status rule): what bash does, unless POSIX
 * mode ends the shell there (`posixExitNote` says that).
 */
export function exitRefusedNote(cx: Explainer, n: SyntaxNode): void {
  const rule = cx.status.status(n);
  const refused = (rule.kind === 'given' || rule.kind === 'refused') && rule.refused;
  if (!refused || (cx.status.posixExit(n)?.active ?? 'off') !== 'off') return;
  cx.note(fact(cx.lang, 'exit-refused', { why: refused.why, word: refused.word, status: refused.status, version: cx.opts.bashVersion ?? DEFAULT_BASH_VERSION, exits: refused.exits }), refused.at);
}

/** `exit 256` and `return 300`: the status is taken modulo 256. */
export function statusRangeNote(cx: Explainer, n: SyntaxNode): void {
  const rule = cx.status.status(n);
  if (rule.kind !== 'given' || rule.refused) return;
  const arg = fields(n, 'argument').filter((a) => a.text !== '--')[0];
  const v = Number(arg.text);
  if (v >= 0 && v <= 255) return;
  cx.note(fact(cx.lang, 'exit-modulo', { command: rule.builtin, value: String(v), status: rule.value, ends: rule.ends }), arg);
}

/**
 * Under `set -e`, whether a failure in `$( )` stops the script (src/semantics/status.ts): it does in an assignment
 * with no command, which takes the status of its last substitution; it does not in a command's words, where the
 * command's own status counts (a declaration builtin's is said by a pitfall).
 */
export function substitutionStatus(cx: Explainer, n: SyntaxNode): string {
  // (A word is always in a statement.)
  let stmt = n.parent!;
  while (!STATEMENTS.has(stmt.type)) stmt = stmt.parent!;
  const ctx = cx.status.errexit(stmt);
  if (ctx.active !== 'on' || ctx.checked !== true || ctx.stops !== 'script') return '';
  const rule = cx.status.status(stmt);
  if (rule.kind === 'last-substitution') {
    // (`$(grep -c x f || true)`: the substitution does not fail, unless `true` is a function that does.)
    const last = n.namedChildren.filter((c) => STATEMENTS.has(c.type)).pop();
    const masked = last?.type === 'list' && last.children.some((c) => c.type === '||') && cx.status.succeeds(last.namedChildren[last.namedChildren.length - 1]);
    if (masked && rule.at === n) return '';
    return rule.at === n
      // (Prototype for usability run 4: the line's note `errexit-stops-here` says the stop; the token keeps why.)
      ? cx.s('。名前のないコマンド（代入やリダイレクトだけのコマンド）は、最後のコマンド置換の終了ステータスになる', '. A command with no name, only assignments or redirections, takes the status of its last command substitution')
      : cx.s('。これが失敗しても `set -e` では止まらない（名前の無いコマンドの終了ステータスは、最後に実行されるコマンド置換のもの。リダイレクトの中のものは代入の中のものより後に実行される）', '. If it fails, `set -e` does not stop the script (a command with no name takes the status of the last command substitution it runs; those in its redirections run after those in its assignments)');
  }
  // (In the command's name, it is not an argument: `"$(cmd)" a`.)
  if ((rule.kind !== 'command' && rule.kind !== 'test') || stmt.type !== 'command' || !field(stmt, 'name') || ancestor(n, (x) => x === field(stmt, 'name'))) return '';
  const name = shorten(field(stmt, 'name')!.text, 20);
  return cx.s(`。これが失敗しても \`set -e\` では止まらない（終了ステータスは \`${name}\` のもの）`, `. If it fails, \`set -e\` does not stop the script (the status is that of \`${name}\`)`);
}

// ---------------------------------------------------------------- Prototype for usability run 4 (U11)
// docs/design/errexit-stop.md, section 9. Rough on purpose: the EXIT trap from a scan of `trap … EXIT` with static
// words, the builtins that fail only on a usage or write error by name (G2), no note on a call of a function (G3).

/** The statements whose failure `set -e` checks (status.ts, `CHECKED`). */
export const STOP_TYPES = new Set(['command', 'extended_test', 'arithmetic_command', 'pipeline', 'negated_command', 'subshell']);
/** (G2, rough) Builtins that fail only when their words are refused or their output cannot be written. */
const QUIET = new Set(['continue', 'break', 'trap', 'set', 'shopt', 'export', 'readonly', 'alias', 'unset', 'echo', 'umask', 'local', 'declare', 'typeset']);

/** Under `set -e`, where a failure of `n` stops the script: what fails, the EXIT trap set before, and the status. */
export function errexitStopNote(cx: Explainer, n: SyntaxNode): void {
  const e = cx.status.errexit(n);
  if (e.active !== 'on' || e.checked !== true || e.stops !== 'script' || !cx.status.mayFail(n) || !cx.reachedAt(n) || cx.state.dead(n)) return;
  // (Not in a string another command runs: a trap's action, `eval`, `sh -c`.)
  if (cx.state.env(n).links.some((l) => l.kind === 'slot')) return;
  const what = stopWhat(cx, n);
  if (!what) return;
  const trap = exitTrapBefore(cx, n);
  const params: ErrexitStopParams = { what, ...(trap ? { trap } : {}) };
  cx.note(fact(cx.lang, 'errexit-stops-here', params), n);
}

function stopWhat(cx: Explainer, n: SyntaxNode): StopWhat | undefined {
  switch (n.type) {
    case 'pipeline': case 'negated_command': return { kind: 'pipeline' };
    case 'extended_test': return { kind: 'test', text: '[[ … ]]' };
    case 'arithmetic_command': return { kind: 'test', text: '(( … ))' };
    case 'subshell': return { kind: 'subshell' };
  }
  if (assignmentsOnly(n)) {
    // (The command of a `$( )` of one simple command, by its name: `stamp=$(date +%F)`.)
    const rule = cx.status.status(n);
    const inner = rule.kind === 'last-substitution' && rule.at ? rule.at.namedChildren.filter((c) => STATEMENTS.has(c.type)) : [];
    const name = inner.length === 1 && inner[0].type === 'command' ? commandName(inner[0]) : undefined;
    return { kind: 'substitution', ...(name ? { name: shorten(name, 20) } : {}) };
  }
  const name = commandName(n);
  if (name === undefined || QUIET.has(name)) return undefined;
  // (G3, rough: a call of a function gets none; the lines of its body have theirs.)
  for (const sites of cx.state.calls.values()) if (sites.has(n)) return undefined;
  if (name === '[' || name === 'test') return { kind: 'test', text: name === '[' ? '[ … ]' : 'test' };
  return { kind: 'command', name: shorten(name, 20) };
}

/**
 * (G1, rough) The EXIT trap set before `n` by a `trap` of the script's top level (in a function's body: before its first
 * call), with static words; one set in a block or a function, `maybe`. `trap - EXIT`, `trap EXIT`, `trap '' EXIT` take it back.
 */
function exitTrapBefore(cx: Explainer, n: SyntaxNode): ErrexitStopParams['trap'] {
  const def = ancestor(n, (a) => a.type === 'function_definition');
  let at = n.startIndex;
  if (def) {
    const calls = [...cx.state.calls.get(def)?.keys() ?? []].map((c) => c.startIndex);
    if (!calls.length) return undefined;
    at = Math.min(...calls);
  }
  let root = n;
  while (root.parent) root = root.parent;
  let found: ErrexitStopParams['trap'];
  for (const c of descendants(root, ['command'])) {
    if (c.startIndex >= at || commandName(c) !== 'trap' || ancestor(c, (a) => a === def)) continue;
    const words = fields(c, 'argument').map((w) => staticWordValue(w));
    if (!words.slice(1).some((w) => w !== undefined && exitSignal(w)) && !(words.length === 1 && words[0] !== undefined && exitSignal(words[0]))) continue;
    const top = c.parent?.type === 'program' || (c.parent?.type === 'redirected_statement' && c.parent.parent?.type === 'program');
    if (words.length === 1 || words[0] === '-' || words[0] === '') { if (top) found = undefined; continue; }
    if (words[0] === undefined) continue;
    found = { line: c.startPosition.row + 1, action: shorten(words[0].trim(), 24), maybe: !top };
  }
  return found;
}
