// The texts of the catalog's fact about a syntax error (src/messages.ts: `syntax-error`, from src/semantics/syntaxerror.ts),
// apart, to keep src/messages.ts short. (3.1.1: the shell reads, parses, then executes each command; that it stops there
// the manual only implies, as for `keyword-needs-separator`. No status: bash exits 2, or 1 for `x=(1 2`, and a file sourced
// returns to the script that sources it. "The shell", no file: dash runs `#!/bin/sh`, and `-e` has no file. "If it
// reaches this line": `set -e` or `set -u` may stop it first, with a failing status. Checked: its probe, and
// test/syntax-error.test.ts.)

import type { SyntaxErrorWhat } from './syntax/tree';

export type { SyntaxErrorWhat };

/** What is wrong, [ja, en], as a clause. */
export function syntaxErrorWhat(what: SyntaxErrorWhat): readonly [string, string] {
  switch (what.kind) {
    case 'token': case 'after-paren': return [`ここに \`${what.token}\` は書けない`, `\`${what.token}\` cannot stand here`];
    case 'missing': return [`\`${what.token}\` がない`, `\`${what.token}\` is missing`];
    case 'after': return [`\`${what.token}\` の後にコマンドがない`, `no command follows \`${what.token}\``];
    case 'line-end': return ['行がここで終わってはいけない', 'the line cannot end here'];
    case 'command': return ['ここにコマンドがない', 'a command is missing here'];
    case 'target': case 'heredoc': return ['リダイレクトの行き先がない', 'the redirection has no target'];
    case 'body': return ['関数の本体がない', 'the function has no body'];
    default: return ['シェルはこのコマンドを読めない', 'the shell cannot read this command'];
  }
}

const capitalized = (text: string): string => `${text[0].toUpperCase()}${text.slice(1)}`;

/** `echo (hello)`: why, where it is true of every shape it is said on (the table of test/syntax-error.test.ts). */
const PAREN_HINT = ['。単語の直後の `(` は関数定義の始まりと読まれる。文字としての括弧はクォートする', '. A `(` after a word starts a function definition; parentheses meant as text need quotes'] as const;

export function syntaxErrorText({ what }: { what: SyntaxErrorWhat }): readonly [string, string] {
  const [ja, en] = syntaxErrorWhat(what);
  const [hintJa, hintEn] = what.kind === 'after-paren' ? PAREN_HINT : ['', ''];
  return [
    `${ja}ので、構文エラーになる。シェルはこの行まで来ると、ここで読むのをやめる。それまでに読み終えたコマンドは実行済みで、これを含むコマンドと、それが始まる行のほかのコマンドは実行されない${hintJa}`,
    `${capitalized(en)}: a syntax error. If the shell reaches this line, it stops reading here, having run the commands it read in full before; the command this is in, and the others on the line where it starts, do not run${hintEn}`];
}

/** The headline of the problem (src/messages-heads.ts). */
export function syntaxErrorHead({ what }: { what: SyntaxErrorWhat }): readonly [string, string] {
  const [ja, en] = syntaxErrorWhat(what);
  return [`${ja}ので、シェルはこの行まで来ると構文エラーで止まる。`, `${capitalized(en)}: the shell stops with a syntax error if it reaches this line.`];
}
