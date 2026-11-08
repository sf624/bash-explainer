// Notes on exit statuses (docs/design/analyzer.md, step 3): `((i++))` at 0, `exit 256`, and whether a failing `$( )`
// stops the script under `set -e`. The statuses and errexit come from the status model (src/semantics/status.ts).
import { DEFAULT_BASH_VERSION } from '../bashversion';
import { shorten } from '../label';
import { fact } from '../messages';
import type { ErrexitStopParams, StopTrap } from '../messages-errexit-stop';
import { inPlaceOf, replaceNode } from '../rewrite';
import { STATEMENTS } from '../semantics/env';
import type { NestedScript } from '../semantics/nested';
import { docLine, type StateModel } from '../semantics/state';
import type { StatusModel } from '../semantics/status';
import { laterExitTrap, trapAt, type Trapped } from '../semantics/traps';
import type { HostRun } from '../semantics/walk/host';
import { ancestor, field, fields, type SyntaxNode } from '../syntax/tree';
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
    // (`$(grep -c x f || true)`: the substitution does not fail, unless `true` is a function that does: `mayFail`.)
    if (rule.at === n && !cx.status.mayFail(stmt)) return '';
    return rule.at === n
      // (The line's note `errexit-stops-here` says that `set -e` stops the script here.)
      ? cx.s('。名前のないコマンド（代入やリダイレクトだけのコマンド）は、最後のコマンド置換の終了ステータスになる', '. A command with no name, only assignments or redirections, takes the status of its last command substitution')
      : cx.s('。これが失敗しても `set -e` では止まらない（名前の無いコマンドの終了ステータスは、最後に実行されるコマンド置換のもの。リダイレクトの中のものは代入の中のものより後に実行される）', '. If it fails, `set -e` does not stop the script (a command with no name takes the status of the last command substitution it runs; those in its redirections run after those in its assignments)');
  }
  // (In the command's name, it is not an argument: `"$(cmd)" a`.)
  if ((rule.kind !== 'command' && rule.kind !== 'test') || stmt.type !== 'command' || !field(stmt, 'name') || ancestor(n, (x) => x === field(stmt, 'name'))) return '';
  const name = shorten(field(stmt, 'name')!.text, 20);
  return cx.s(`。これが失敗しても \`set -e\` では止まらない（終了ステータスは \`${name}\` のもの）`, `. If it fails, \`set -e\` does not stop the script (the status is that of \`${name}\`)`);
}

/** What a stop note says besides what fails (`ErrexitStopParams` without `what`). */
export type StopContext = Omit<ErrexitStopParams, 'what' | 'more'>;

/** The name of a trap's action in a note: its text, short (a function's name, or the start of the string). */
const actionName = (script: NestedScript): string => shorten(script.text.trim().replace(/\s*\n\s*/g, '; '), 24);

/**
 * Under `set -e`, what a failure of statement `n` ends, from the models only (docs/design/errexit-stop.md, section 3):
 * undefined where it does not stop a shell (`errexit`: errexit off or not known, the failure not checked), where it
 * cannot fail (`mayFail`), in code that does not run, and in a host's file but in a test (`hostRun`: bats). The traps
 * that run are those in effect at `n` (`ShellState.traps`); after code the model does not read (`opaque`), a trap may
 * run, with no line named.
 */
export function stopContext(state: StateModel, status: StatusModel, n: SyntaxNode, hostRun?: HostRun): StopContext | undefined {
  const e = status.errexit(n);
  if (e.active !== 'on' || e.checked !== true || !status.mayFail(n) || state.dead(n)) return undefined;
  const { within } = e;
  if (within?.kind === 'test') {
    // (A test runs only in a host's run.)
    const after = hostRun!.each.after;
    const down = state.at(n).run.functions.get(after)?.state === 'on' ? after : undefined;
    return { stops: 'test', ...(down ? { teardown: down } : {}) };
  }
  if (within?.kind === 'host' || hostRun) return undefined;
  if (within?.kind === 'exit-trap') return { stops: 'exit-trap' };
  if (e.stops === 'unknown') return { stops: 'unknown' };
  const run = state.at(n).run;
  const trap = (name: Trapped): StopTrap | undefined => {
    const t = trapAt(state, n, name);
    if (!t || t.state === 'off') return undefined;
    // (Its `trap` command, unless code the model does not read may have set another.)
    const known = state.trapSets.some((s) => s.at === t.at) && !(t.state === 'unknown' && run.opaque);
    const out = known && t.script ? status.trapOutcome(t.script) : undefined;
    return {
      sure: t.state === 'on',
      ...(known ? { line: docLine(t.at) + 1 } : {}),
      ...(known && t.script ? { action: actionName(t.script) } : {}),
      ...(out?.fails ? { fails: true } : {}),
      ...(out?.exits ? { exits: true } : {}),
    };
  };
  const err = trap('ERR');
  const exit = trap('EXIT');
  const set = e.stops === 'script' && !exit ? laterExitTrap(state, n) : undefined;
  // (`laterExitTrap` names a trap whose action it reads.)
  const later = set ? { line: docLine(set.at) + 1, action: actionName(set.script!) } : undefined;
  return { stops: e.stops, ...(err ? { err } : {}), ...(exit ? { exit } : {}), ...(later ? { later } : {}) };
}
