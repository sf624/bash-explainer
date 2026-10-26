// Notes on exit statuses (docs/design/analyzer.md, step 3): `((i++))` at 0, `exit 256`, and whether a failing `$( )`
// stops the script under `set -e`. The statuses and errexit come from the status model (src/semantics/status.ts).
import { shorten } from '../label';
import { fact } from '../messages';
import { STATEMENTS } from '../semantics/env';
import { ancestor, field, fields, type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/** `((i++))` is the old value of `i`: 0 makes the status 1, which `set -e` treats as a failure. */
export function postfixStatusNote(cx: Explainer, n: SyntaxNode): void {
  const m = /^\(\(\s*([A-Za-z_]\w*(?:\[[^\]]*\])?)(\+\+|--)\s*\)\)$/.exec(n.text);
  if (!m) return;
  const [, v, op] = m;
  // (Where bash surely ignores `set -e`, `((i++)) || true`, the status 1 is the intent.)
  const { ignored, active, stops } = cx.status.errexit(n); if (ignored?.sure) return;
  cx.note(fact(cx.lang, op === '++' ? 'postfix-increment-status' : 'postfix-decrement-status', { v, errexit: active === 'on', stops }), n);
}

/** `exit 256` and `return 300`: the status is taken modulo 256. */
export function statusRangeNote(cx: Explainer, n: SyntaxNode): void {
  const rule = cx.status.status(n);
  if (rule.kind !== 'given') return;
  const arg = fields(n, 'argument')[0];
  const v = Number(arg.text);
  if (v >= 0 && v <= 255) return;
  cx.note(fact(cx.lang, 'exit-modulo', { value: String(v), status: rule.value }), arg);
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
      ? cx.s('。`set -e` が有効なので、これが失敗するとスクリプトはここで止まる（名前の無いコマンド、つまり代入やリダイレクトだけのコマンドは、最後のコマンド置換の終了ステータスになる）', '. Under `set -e` the script stops here if it fails (a command with no name, only assignments or redirections, takes the status of its last command substitution)')
      : cx.s('。これが失敗しても `set -e` では止まらない（名前の無いコマンドの終了ステータスは、最後に実行されるコマンド置換のもの。リダイレクトの中のものは代入の中のものより後に実行される）', '. If it fails, `set -e` does not stop the script (a command with no name takes the status of the last command substitution it runs; those in its redirections run after those in its assignments)');
  }
  // (In the command's name, it is not an argument: `"$(cmd)" a`.)
  if ((rule.kind !== 'command' && rule.kind !== 'test') || stmt.type !== 'command' || !field(stmt, 'name') || ancestor(n, (x) => x === field(stmt, 'name'))) return '';
  const name = shorten(field(stmt, 'name')!.text, 20);
  return cx.s(`。これが失敗しても \`set -e\` では止まらない（終了ステータスは \`${name}\` のもの）`, `. If it fails, \`set -e\` does not stop the script (the status is that of \`${name}\`)`);
}
