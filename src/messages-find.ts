// The text of the catalog's fact about an action that find refuses (src/messages.ts: `find-action-refused`), apart, to keep
// src/messages.ts short.
import { codeSpan } from './label';
import type { Rewrite } from './rewrite';

/**
 * `find-action-refused`: the action (`-exec`…) and why find refuses it (src/argv/until.ts, `UntilRefusal`): an action that
 * runs a command (`-exec`, `-execdir`, `-ok`, `-okdir`) that its spec does not read as ended. The reasons and the messages
 * are GNU find 4.9's.
 */
export interface FindRefusalParams {
  option: string;
  why: 'missing' | 'empty' | 'alone' | 'once';
  /** With `alone`: the word before the `+`. */
  word?: string;
  /** The option can be ended by a `+` after a `{}` (`-exec`, `-execdir`), not only by `\;`. */
  plus: boolean;
  /** The line ends with a bare `;` (the shell's list operator). */
  bare: boolean;
  /** With `missing`: no word follows the option (`-exec ;`), so it has no command either. */
  noCommand: boolean;
  rewrite: readonly Rewrite[];
}

/** The sections of the manual each case is about: the bare `;` is a list operator (3.2.4); `\;` and `';'` quote it (3.1.2.1, 3.1.2.2). */
export function findRefusalRefs({ why, bare }: FindRefusalParams): readonly string[] {
  return why === 'missing' ? [...(bare ? ['3.2.4'] : []), '3.1.2.1', '3.1.2.2'] : ['3.1.2.1'];
}

export function findRefusalText({ option, why, word, plus, bare, noCommand, rewrite: [fix] }: FindRefusalParams): readonly [string, string] {
  const o = `\`${option}\``;
  const stops = (said: string) => [`find は与えられた引数をすべて受け付けず（${codeSpan(said)}）、何も実行しない。`, `find refuses all its arguments (${codeSpan(said)}) and runs nothing.`] as const;
  if (why === 'missing') {
    const [sj, se] = stops(`find: missing argument to \`${option}'`);
    const [hj, he] = noCommand ? [`${o} の後に、実行するコマンドも、それを終わらせる \`\\;\` もない`, `${o} has no command to run, and no \`\\;\` to end one`]
      : [`${o} のコマンドを終わらせる \`\\;\`${plus ? '（または `{}` の直後の `+`）' : ' '}がない`, `${o} has no \`\\;\`${plus ? ' (or `+` right after a `{}`)' : ''} to end its command`];
    const [bj, be] = bare ? ['。末尾の `;` はシェルのコマンドリストの区切りなので、find には渡らない', ": the `;` at the end is the shell's list separator, so find never gets it"]
      : plus || noCommand ? ['', ''] : ['。`+` で終わらせられるのは `-exec` と `-execdir` だけ', '; only `-exec` and `-execdir` can be ended by a `+`'];
    const [fj, fe] = noCommand ? ['実行するコマンドを書き、`\\;` で終わらせる', 'Write the command to run, and end it with `\\;`']
      : !fix ? ['`\\;` か `\';\'` で終わらせる', 'End it with `\\;` or `\';\'`']
        : fix.code === '\\;' ? ['`\\;` と書く（`\';\'` でもよい）', 'Write `\\;` (or `\';\'`)']
          : [`\`${fix.code}\` と書く。\`\\;\`（または \`';'\`）は独立した1語にする`, `Write \`${fix.code}\`: \`\\;\` (or \`';'\`) must be a word of its own`];
    return [`${hj}${bj}。${sj}${fj}`, `${he}${be}. ${se} ${fe}`];
  }
  if (why === 'empty') {
    const [sj, se] = stops(`find: invalid argument \`;' to \`${option}'`);
    return [`${o} の直後が \`\\;\` で、実行するコマンドがない。${sj}`, `${o} is followed at once by \`\\;\`, so it has no command to run. ${se}`];
  }
  if (why === 'alone') {
    const [sj, se] = stops(`find: In '${option} ... {} +' the '{}' must appear by itself, but you specified '${word}'`);
    return [`\`+\` が ${o} のコマンドを終わらせるのは、直前の語が \`{}\` だけのときに限る。ここでは \`${word}\` なので、\`{}\` だけの語にするか、\`\\;\` で1件ずつ実行する。${sj}`,
      `A \`+\` ends the command of ${o} only after a \`{}\` that stands alone, and here the word before it is \`${word}\`. Put \`{}\` alone before the \`+\`, or end it with \`\\;\` to run it once per file. ${se}`];
  }
  const [sj, se] = stops(`find: Only one instance of {} is supported with ${option} ... +`);
  return [`\`+\` で終わらせる ${o} のコマンドに書ける \`{}\` は1つだけ。2つ以上必要なら \`\\;\` で1件ずつ実行する。${sj}`,
    `The command of ${o} that a \`+\` ends takes only one \`{}\`. Use \`\\;\` to run it once per file if it needs more. ${se}`];
}
