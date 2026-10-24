// The explanation of a command substitution (`$( )`, backquotes, and bash 5.3's `${ …; }` and `${| …; }`) and of a
// process substitution. What it needs of the analyzer (its texts, its tokens, the status model of the script) it asks
// of the host.
import type { Kind, Token } from './analyzer-types';
import { unclosedBrace } from './bashversion';
import type { Shell } from './dialect';
import { shorten } from './label';
import { STATEMENTS } from './semantics/env';
import type { StatusModel } from './semantics/status';
import { ancestor, braceTakenAsWord, field, substitutionForm, type SyntaxNode } from './syntax/tree';

/** What the explanation of a substitution asks of the analyzer, for the line being explained. */
export interface SubstitutionHost {
  /** The shell the script is for (undefined: bash). */
  readonly shell: Shell | undefined;
  s(ja: string, en: string): string;
  tok(n: SyntaxNode, kind: Kind, explanation: string, children?: Token[], label?: string): Token;
  /** The explanations of these nodes that are on the line explained. */
  subs(nodes: readonly SyntaxNode[]): Token[];
  /** The status model of the script. */
  readonly status: StatusModel;
}

const isBash = (h: SubstitutionHost) => h.shell === undefined || h.shell === 'bash';

/**
 * What each form of command substitution does, [Japanese, English] (checked with bash 5.3: test/bash53.test.ts). In a
 * script for ksh93 or mksh, which have the form too, it is said without what only bash 5.3 is checked to do (`local`,
 * a `REPLY` local to it, trailing newlines kept).
 */
function meaning(h: SubstitutionHost, n: SyntaxNode): string {
  const form = substitutionForm(n);
  const own = form === '${' ? h.shell === 'ksh' || h.shell === 'mksh' : h.shell === 'mksh';
  switch (form) {
    case '`': return h.s('コマンド置換 `` `…` ``（旧式。`$(…)` 推奨）: 中のコマンドを実行し、その標準出力（末尾の改行は除く）に置き換える', 'Command substitution `` `…` `` (legacy; prefer `$(…)`): runs the command and is replaced by its stdout (trailing newlines removed)');
    case '$(': return h.s('コマンド置換 `$(…)`: 中のコマンドを実行し、その標準出力（末尾の改行は除く）に置き換える', 'Command substitution `$(…)`: runs the command and is replaced by its stdout (trailing newlines removed)');
    case '${': return own
      ? h.s('コマンド置換 `${ …; }`: 中のコマンドをサブシェルではなく現在のシェルで実行し、その標準出力（末尾の改行は除く）に置き換える。中で設定した変数や `cd` はあとまで残る',
        'Command substitution `${ …; }`: runs the commands in the current shell, not in a subshell, and is replaced by their stdout (trailing newlines removed). Variables they set and `cd` stay in effect afterwards')
      : h.s('コマンド置換 `${ …; }`（bash 5.3）: 中のコマンドをサブシェルではなく現在のシェルで実行し、その標準出力（末尾の改行は除く）に置き換える。中で設定した変数や `cd` はあとまで残る（`local` で作った変数はこの中だけ）',
        'Command substitution `${ …; }` (bash 5.3): runs the commands in the current shell, not in a subshell, and is replaced by their stdout (trailing newlines removed). Variables they set and `cd` stay in effect afterwards (a `local` variable lasts only inside)');
    case '${|': return own
      ? h.s('コマンド置換 `${| …; }`: 中のコマンドを現在のシェルで実行し、そのあとの変数 `REPLY` の値に置き換える。標準出力は取り込まれずにそのまま出力される',
        'Command substitution `${| …; }`: runs the commands in the current shell and is replaced by the value they leave in `REPLY`. Their stdout is not captured: it is printed as usual')
      : h.s('コマンド置換 `${| …; }`（bash 5.3）: 中のコマンドを現在のシェルで実行し、そのあとの変数 `REPLY` の値（末尾の改行もそのまま）に置き換える。`REPLY` はこの中だけのローカル変数で、標準出力は取り込まれずにそのまま出力される',
        'Command substitution `${| …; }` (bash 5.3): runs the commands in the current shell and is replaced by the value they leave in `REPLY` (trailing newlines kept). `REPLY` is local to it, and their stdout is not captured: it is printed as usual');
  }
}

export function explainCommandSubstitution(h: SubstitutionHost, n: SyntaxNode): Token {
  // (A `}` that does not end it: a syntax error.)
  const brace = braceTakenAsWord(n);
  if (brace) return h.tok(n, 'error', h.s(...unclosedBrace(brace, substitutionForm(n) === '${' ? '${ …; }' : '${| …; }', isBash(h))), h.subs(n.namedChildren));
  return h.tok(n, 'substitution', meaning(h, n) + substitutionStatus(h, n), h.subs(n.namedChildren));
}

/**
 * What `local` and `return` at `n` belong to: the innermost function, or `${ …; }` or `${| …; }`, which bash 5.3 runs
 * as it runs a function's body (local variables of its own; `return` ends it); undefined: neither.
 */
export function scopeOf(n: SyntaxNode): 'function' | 'substitution' | undefined {
  const at = ancestor(n, (a) => a.type === 'function_definition' || (a.type === 'command_substitution' && substitutionForm(a).startsWith('${')));
  return at && (at.type === 'function_definition' ? 'function' : 'substitution');
}

/** What `return` (at `n`) does in a `${ …; }` of a bash script: it ends the substitution (checked with bash 5.3). */
export function returnInSubstitution(h: SubstitutionHost, n: SyntaxNode): string | undefined {
  if (!isBash(h) || scopeOf(n) !== 'substitution') return undefined;
  return h.s('囲んでいる `${ …; }` のコマンドをここで終える（関数での `return` と同じ。終了ステータスは引数の値で、省略すると直前のコマンドのもの）',
    'End the commands of the `${ …; }` around it, as `return` ends a function (the status is the one given, or that of the last command)');
}

/**
 * Under `set -e`, whether a failure in `$( )` stops the script (src/semantics/status.ts): it does in an assignment
 * with no command, which takes the status of its last substitution; it does not in a command's words, where the
 * command's own status counts (a declaration builtin's is said by a pitfall).
 */
function substitutionStatus(h: SubstitutionHost, n: SyntaxNode): string {
  // (A word is always in a statement.)
  let stmt = n.parent!;
  while (!STATEMENTS.has(stmt.type)) stmt = stmt.parent!;
  const ctx = h.status.errexit(stmt);
  if (ctx.active !== 'on' || ctx.checked !== true || ctx.stops !== 'script') return '';
  const rule = h.status.status(stmt);
  if (rule.kind === 'last-substitution') {
    // (`$(grep -c x f || true)`: the substitution does not fail.)
    const last = n.namedChildren.filter((c) => STATEMENTS.has(c.type)).pop();
    const masked = last?.type === 'list' && last.children.some((c) => c.type === '||') && /^(true|:)$/.test(last.namedChildren[last.namedChildren.length - 1].text);
    if (masked && rule.at === n) return '';
    return rule.at === n
      ? h.s('。`set -e` が有効なので、これが失敗するとスクリプトはここで止まる（名前の無いコマンド、つまり代入やリダイレクトだけのコマンドは、最後のコマンド置換の終了ステータスになる）', '. Under `set -e` the script stops here if it fails (a command with no name, only assignments or redirections, takes the status of its last command substitution)')
      : h.s('。これが失敗しても `set -e` では止まらない（名前の無いコマンドの終了ステータスは、最後に実行されるコマンド置換のもの。リダイレクトの中のものは代入の中のものより後に実行される）', '. If it fails, `set -e` does not stop the script (a command with no name takes the status of the last command substitution it runs; those in its redirections run after those in its assignments)');
  }
  // (In the command's name, it is not an argument: `"$(cmd)" a`.)
  if ((rule.kind !== 'command' && rule.kind !== 'test') || stmt.type !== 'command' || !field(stmt, 'name') || ancestor(n, (x) => x === field(stmt, 'name'))) return '';
  const name = shorten(field(stmt, 'name')!.text, 20);
  return h.s(`。これが失敗しても \`set -e\` では止まらない（終了ステータスは \`${name}\` のもの）`, `. If it fails, \`set -e\` does not stop the script (the status is that of \`${name}\`)`);
}

export function explainProcessSubstitution(h: SubstitutionHost, n: SyntaxNode): Token {
  const out = n.text.startsWith('>(');
  return h.tok(n, 'substitution', out
    ? h.s('プロセス置換 `>(…)`: 書き込むと中のコマンドの標準入力に渡るファイル名（/dev/fd/N）に置き換わる', 'Process substitution `>(…)`: a file name whose writes go to the command\'s stdin')
    : h.s('プロセス置換 `<(…)`: 中のコマンドの出力を、ファイルのように読めるファイル名（/dev/fd/N）に置き換える', 'Process substitution `<(…)`: a file name from which the command\'s output can be read'),
  h.subs(n.namedChildren));
}
