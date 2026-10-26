// Which redirections may fail, so that their command does not run (docs/design/trust-allow-list.md, section 2), and
// which may close fd 0, 1 or 2, so that a copy of one of them may fail too: read by the trust's scan
// (src/semantics/trust.ts) and the walk (src/semantics/walk/conditions.ts).
import { staticWordValue } from '../staticword';
import { field, type SyntaxNode } from '../syntax/tree';

/**
 * Whether the redirection `r` cannot fail: to or from `/dev/null`, or a copy of fd 1 or 2 (`2>&1`, `>&2`) when the
 * script closes none of them (`closes`: `Trust.fdsMayClose`), with an fd given as a number if any.
 */
export function safeRedirect(r: SyntaxNode, closes: boolean): boolean {
  if (r.type !== 'file_redirect' || (field(r, 'descriptor') && field(r, 'descriptor')!.type !== 'file_descriptor')) return false;
  const op = r.children.find((c) => !c.named)?.type;
  const to = field(r, 'destination');
  const target = to && staticWordValue(to);
  if (target === '/dev/null') return ['>', '>>', '&>', '&>>', '>|', '<'].includes(op!);
  return !closes && op === '>&' && (target === '1' || target === '2');
}

/**
 * Whether the redirection `r` may fail, so that its command does not run (docs/design/trust-allow-list.md, section 2:
 * a file not found, a directory, `set -C`, a descriptor not open). A here-document and a here-string do not; nor
 * `safeRedirect`'s, a copy of fd 0, 1 or 2 (`<&0`) when the script closes none of them (`closes`), or closing a
 * descriptor (`3>&-`).
 */
export function redirectionMayFail(r: SyntaxNode, closes: boolean): boolean {
  // (Nor one from or to a process substitution, `< <(cmd)`: a pipe bash makes itself.)
  if (r.type !== 'file_redirect' || safeRedirect(r, closes) || field(r, 'destination')?.type === 'process_substitution') return false;
  const op = r.children.find((c) => !c.named)!.type;
  // (One with no word yet, `> >g` while typing, is an error. A copy from a word not known, or with none, `>&`, may close
  // fd 1 itself: `closes` is then set, `closesStandard`.)
  const to = field(r, 'destination');
  const target = to && staticWordValue(to);
  return !((op === '<&' || op === '>&') && (target === '-' || (!closes && ['0', '1', '2'].includes(target!))));
}

/**
 * Whether the redirection `r` may close fd 0, 1 or 2: `>&-`, `2<&-`, `{v}>&-` (`v` may hold any number), a move
 * (`3>&1-` closes 1), or a copy from a word not known (`>&$x`: bash closes for `-`).
 */
export function closesStandard(r: SyntaxNode): boolean {
  const op = r.children.find((c) => !c.named)?.type;
  if (op !== '>&' && op !== '<&') return false;
  const d = field(r, 'descriptor');
  // (`{v}` is a `file_descriptor` too.)
  const fd = d ? (/^\d+$/.test(d.text) ? Number(d.text) : undefined) : op === '>&' ? 1 : 0;
  const to = field(r, 'destination');
  const target = to && staticWordValue(to);
  if (target === undefined) return true;
  if (target === '-') return fd === undefined || fd <= 2;
  const m = /^(\d+)-$/.exec(target);
  return !!m && Number(m[1]) <= 2;
}
