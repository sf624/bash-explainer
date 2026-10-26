// The explanation of a command substitution (`$( )`, backquotes, and bash 5.3's `${ …; }` and `${| …; }`) and of a
// process substitution. What it needs (its texts, its tokens, the status model of the script) it reads from the line's
// context (src/explain/context.ts); what `set -e` does with its status is said by src/explain/status.ts.
import type { Token } from './analyzer-types';
import { unclosedBrace } from './bashversion';
import type { Explainer } from './explain/context';
import { statementTokens } from './explain/lists';
import { substitutionStatus } from './explain/status';
import { ancestor, braceTakenAsWord, field, fileContentsOf, substitutionForm, type SyntaxNode, withLists } from './syntax/tree';

const isBash = (h: Explainer) => h.shell === undefined || h.shell === 'bash';

/**
 * What each form of command substitution does, [Japanese, English] (checked with bash 5.3: test/bash53.test.ts). In a
 * script for ksh93 or mksh, which have the form too, it is said without what only bash 5.3 is checked to do (`local`,
 * a `REPLY` local to it, trailing newlines kept).
 */
function meaning(h: Explainer, n: SyntaxNode): string {
  const form = substitutionForm(n);
  const own = form === '${' ? h.shell === 'ksh' || h.shell === 'mksh' : h.shell === 'mksh';
  // (`$(< f)`: bash reads the file itself.)
  const file = isBash(h) ? fileContentsOf(n) : undefined;
  if (file) {
    const f = field(file, 'destination')!.text;
    const shown = form === '`' ? '`` `< file` ``' : '`$(< file)`';
    return h.s(`コマンド置換 ${shown.replace('file', 'ファイル')}: ファイル \`${f}\` の中身（末尾の改行は除く）に置き換える。\`$(cat ${f})\` と同じだが、\`cat\` を実行しない`,
      `Command substitution ${shown}: replaced by the contents of the file \`${f}\` (trailing newlines removed), as \`$(cat ${f})\`, but without running \`cat\``);
  }
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

export function explainCommandSubstitution(h: Explainer, n: SyntaxNode): Token {
  // (A `}` that does not end it: a syntax error.)
  const brace = braceTakenAsWord(n);
  if (brace) return h.tok(n, 'error', h.s(...unclosedBrace(brace, substitutionForm(n) === '${' ? '${ …; }' : '${| …; }', isBash(h))), h.subs(n.namedChildren));
  return h.tok(n, 'substitution', meaning(h, n) + substitutionStatus(h, n), statementTokens(h, withLists(n)));
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
export function returnInSubstitution(h: Explainer, n: SyntaxNode): string | undefined {
  if (!isBash(h) || scopeOf(n) !== 'substitution') return undefined;
  return h.s('囲んでいる `${ …; }` のコマンドをここで終える（関数での `return` と同じ。終了ステータスは引数の値で、省略すると直前のコマンドのもの）',
    'End the commands of the `${ …; }` around it, as `return` ends a function (the status is the one given, or that of the last command)');
}

export function explainProcessSubstitution(h: Explainer, n: SyntaxNode): Token {
  const out = n.text.startsWith('>(');
  return h.tok(n, 'substitution', out
    ? h.s('プロセス置換 `>(…)`: 書き込むと中のコマンドの標準入力に渡るファイル名（/dev/fd/N）に置き換わる', 'Process substitution `>(…)`: a file name whose writes go to the command\'s stdin')
    : h.s('プロセス置換 `<(…)`: 中のコマンドの出力を、ファイルのように読めるファイル名（/dev/fd/N）に置き換える', 'Process substitution `<(…)`: a file name from which the command\'s output can be read'),
  statementTokens(h, withLists(n)));
}
